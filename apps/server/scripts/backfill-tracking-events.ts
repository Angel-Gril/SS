import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 从已有的时间戳字段反推物流事件，为老订单补充粗粒度时间线
async function main() {
  const batchSize = 500;
  let offset = 0;
  let totalEvents = 0;

  while (true) {
    const orders = await prisma.order.findMany({
      select: {
        id: true,
        subStatus: true,
        status: true,
        inProcessAt: true,
        shipmentDate: true,
        deliveringDate: true,
        deliveredAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      skip: offset,
      take: batchSize,
    });

    if (!orders.length) break;

    for (const order of orders) {
      const events: { substatus: string; statusText: string; occurredAt: Date }[] = [];

      if (order.inProcessAt) {
        events.push({ substatus: 'posting_created', statusText: '订单已创建', occurredAt: order.inProcessAt });
      } else if (order.createdAt) {
        events.push({ substatus: 'posting_created', statusText: '订单已创建', occurredAt: order.createdAt });
      }

      if (order.shipmentDate) {
        events.push({ substatus: 'posting_sent_by_seller', statusText: '卖家已发货', occurredAt: order.shipmentDate });
      }

      if (order.deliveringDate) {
        events.push({ substatus: 'posting_in_carriage', statusText: '已转移配送', occurredAt: order.deliveringDate });
      }

      if (order.deliveredAt) {
        events.push({ substatus: 'posting_delivered', statusText: '已送达', occurredAt: order.deliveredAt });
      }

      // 如果当前 substatus 不在上面的列表中，也补一条
      if (order.subStatus && !events.some((e) => e.substatus === order.subStatus)) {
        const text = SUBSTATUS_TEXT[order.subStatus] || order.subStatus;
        const occurredAt = order.deliveredAt || order.deliveringDate || order.shipmentDate || order.inProcessAt || order.createdAt;
        events.push({ substatus: order.subStatus, statusText: text, occurredAt });
      }

      for (const ev of events) {
        try {
          await prisma.orderTrackingEvent.upsert({
            where: { orderId_substatus: { orderId: order.id, substatus: ev.substatus } },
            create: {
              orderId: order.id,
              substatus: ev.substatus,
              statusText: ev.statusText,
              source: 'backfill',
              occurredAt: ev.occurredAt,
            },
            update: {},
          });
          totalEvents++;
        } catch (_) {
          // skip duplicates or constraint errors
        }
      }
    }

    offset += batchSize;
    process.stdout.write(`\r已处理 ${offset} 条订单，写入 ${totalEvents} 条事件`);
  }

  console.log(`\n完成：共写入 ${totalEvents} 条物流事件`);
}

const SUBSTATUS_TEXT: Record<string, string> = {
  posting_acceptance_in_progress: '订单接收中',
  posting_created: '订单已创建',
  posting_in_cariage: '已加入运输',
  posting_registered: '订单已登记',
  posting_awaiting_registration: '等待登记',
  posting_not_in_process: '等待处理',
  posting_awaiting_packaging: '等待打包',
  posting_in_packaging: '正在打包',
  posting_awaiting_deliver: '等待发货',
  posting_awaiting_passport_data: '等待护照信息',
  posting_on_way_to_city: '运往目的城市',
  posting_on_way_to_pvz: '运往自提点',
  posting_in_pvz: '已到达自提点',
  posting_in_courier_service: '已交快递',
  posting_driver_pickup: '司机已揽件',
  posting_in_carriage: '已转移配送',
  posting_sent_by_seller: '卖家已发货',
  posting_delivered: '已送达',
  posting_received: '买家已签收',
  posting_canceled: '已取消',
  posting_cancelled: '已取消',
  posting_rejected_by_seller: '卖家已拒单',
  posting_canceled_by_client: '买家已取消',
  posting_not_accepted: '未被接收',
  posting_returned_to_seller: '已退回卖家',
  posting_arbitration: '仲裁中',
  posting_client_arbitration: '客户申诉中',
  posting_lost: '运输丢失',
};

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    return prisma.$disconnect().then(() => process.exit(1));
  });
