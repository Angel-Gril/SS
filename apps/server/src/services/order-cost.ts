import { prisma } from '../lib/prisma.js';
import { convertAmountToCny } from './exchange-rate.js';

/**
 * 为指定订单计算成本快照
 * 调用时机：订单状态变更 / Finance 流水入库 / 手动触发
 */
export async function computeOrderCostSnapshot(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      shop: { select: { id: true, userId: true, config: true } },
    },
  });
  if (!order) return;

  const user = await prisma.user.findUnique({
    where: { id: order.shop.userId },
    select: { accountCode: true },
  });

  const orderDate = order.inProcessAt ?? order.createdAt;
  const yearMonth = orderDate.toISOString().slice(0, 7);

  // 销售额 -> CNY
  const { amountCny: saleAmountCny, rate: exchangeRateUsed } = await convertAmountToCny(
    Number(order.totalAmount),
    order.currency,
    orderDate,
  );

  // 进货成本：从 supply_goods 按 SKU 关联
  let purchaseCostCny = 0;
  const items = order.items as any[];
  if (items?.length) {
    for (const item of items) {
      const sku = item.sku ? String(item.sku) : null;
      if (!sku) continue;
      const sg = await prisma.supplyGoods.findFirst({
        where: { userId: order.shop.userId, sku },
        orderBy: { createdAt: 'desc' },
        select: { purchasePrice: true },
      });
      if (sg?.purchasePrice) {
        purchaseCostCny += Number(sg.purchasePrice) * (item.quantity || 1);
      }
    }
  }

  // 打包费：Shop.config.packageFeePerOrder × 1
  const shopConfig = order.shop.config as any;
  const packageFeeCny = shopConfig?.packageFeePerOrder ? Number(shopConfig.packageFeePerOrder) : 0;

  // 线下物流费：当月该店铺 LogisticsBill 总额 / 当月订单数（均摊）
  const monthStart = new Date(yearMonth + '-01');
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const [billAgg, orderCount] = await Promise.all([
    prisma.logisticsBill.aggregate({
      where: { shopId: order.shopId, createdAt: { gte: monthStart, lt: monthEnd } },
      _sum: { fee: true },
    }),
    prisma.order.count({
      where: {
        shopId: order.shopId,
        status: { notIn: ['cancelled'] },
        createdAt: { gte: monthStart, lt: monthEnd },
      },
    }),
  ]);
  const totalBillFee = Number(billAgg._sum.fee ?? 0);
  const shippingDomesticCny = orderCount > 0 ? Math.round((totalBillFee / orderCount) * 100) / 100 : 0;

  // 从 OzonFinanceTransaction 拉取该订单的佣金/物流/广告/罚款
  const txns = await prisma.ozonFinanceTransaction.findMany({
    where: { shopId: order.shopId, orderId: order.platformOrderId },
  });

  let commissionCny = 0;
  let shippingLastMileCny = 0;
  let shippingIntlCny = 0;
  let shippingPostCny = 0;
  let adCny = 0;
  let penaltyCny = 0;
  let otherFeeCny = 0;

  for (const tx of txns) {
    const amt = Math.abs(Number(tx.amountCny));
    switch (tx.category) {
      case 'commission': commissionCny += amt; break;
      case 'shipping_last': shippingLastMileCny += amt; break;
      case 'shipping_intl': shippingIntlCny += amt; break;
      case 'shipping_post': shippingPostCny += amt; break;
      case 'ad_click': case 'ad_cpa': case 'ad_review':
      case 'ad_quick': case 'ad_premium': case 'ad_brand':
        adCny += amt; break;
      case 'penalty_index': case 'penalty_pickfail':
      case 'dispute': case 'service_other':
        penaltyCny += amt; break;
      default: otherFeeCny += amt;
    }
  }

  // 利润 = 销售额 - 佣金 - 进货 - 打包 - 总物流 - 广告 - 罚款 - 其它
  const totalCost = commissionCny + purchaseCostCny + packageFeeCny
    + shippingDomesticCny + shippingLastMileCny + shippingIntlCny + shippingPostCny
    + adCny + penaltyCny + otherFeeCny;
  const profitCny = Math.round((saleAmountCny - totalCost) * 100) / 100;
  const marginPct = saleAmountCny > 0 ? Math.round((profitCny / saleAmountCny) * 10000) / 100 : 0;

  await prisma.orderCostSnapshot.upsert({
    where: { orderId: order.id },
    create: {
      orderId: order.id,
      shopId: order.shopId,
      userId: order.shop.userId,
      accountCode: user?.accountCode ?? null,
      yearMonth,
      orderDate,
      orderStatus: order.status,
      exchangeRateUsed,
      saleAmountCny,
      commissionCny,
      purchaseCostCny,
      packageFeeCny,
      shippingDomesticCny,
      shippingLastMileCny,
      shippingIntlCny,
      shippingPostCny,
      adCny,
      penaltyCny,
      otherFeeCny,
      profitCny,
      marginPct,
      status: 'provisional',
    },
    update: {
      orderStatus: order.status,
      exchangeRateUsed,
      saleAmountCny,
      commissionCny,
      purchaseCostCny,
      packageFeeCny,
      shippingDomesticCny,
      shippingLastMileCny,
      shippingIntlCny,
      shippingPostCny,
      adCny,
      penaltyCny,
      otherFeeCny,
      profitCny,
      marginPct,
      computedAt: new Date(),
    },
  });
}

/**
 * 批量重算指定月份所有订单的成本快照
 */
export async function recomputeMonthSnapshots(shopId: string, yearMonth: string): Promise<number> {
  const monthStart = new Date(yearMonth + '-01');
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const orders = await prisma.order.findMany({
    where: {
      shopId,
      status: { notIn: ['cancelled'] },
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    select: { id: true },
  });

  for (const order of orders) {
    await computeOrderCostSnapshot(order.id);
  }
  return orders.length;
}
