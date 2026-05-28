// OZON posting substatus → 中文描述映射
// 参考 tracking.ozon.ru 的里程碑用词，覆盖订单从创建到送达/取消的主要节点

export interface SubstatusMeta {
  text: string;
  phase: 'created' | 'awaiting_packaging' | 'awaiting_deliver' | 'in_transit' | 'arrived' | 'delivered' | 'cancelled' | 'returned' | 'unknown';
}

const MAP: Record<string, SubstatusMeta> = {
  // 1. 已创建 / 待付款
  posting_acceptance_in_progress: { text: '订单接收中', phase: 'created' },
  posting_created: { text: '订单已创建', phase: 'created' },
  posting_in_cariage: { text: '已加入运输', phase: 'awaiting_deliver' },
  posting_registered: { text: '订单已登记', phase: 'created' },

  // 2. 待打包
  posting_awaiting_registration: { text: '等待登记', phase: 'awaiting_packaging' },
  posting_not_in_process: { text: '等待处理', phase: 'awaiting_packaging' },
  posting_awaiting_packaging: { text: '等待打包', phase: 'awaiting_packaging' },
  posting_in_packaging: { text: '正在打包', phase: 'awaiting_packaging' },
  posting_awaiting_deliver: { text: '等待发货', phase: 'awaiting_deliver' },

  // 3. 已打包待交接 / 已交接给承运
  posting_awaiting_passport_data: { text: '等待护照信息', phase: 'awaiting_deliver' },
  posting_on_way_to_city: { text: '运往目的城市', phase: 'in_transit' },
  posting_on_way_to_pvz: { text: '运往自提点', phase: 'in_transit' },
  posting_in_pvz: { text: '已到达自提点', phase: 'arrived' },
  posting_in_courier_service: { text: '已交快递', phase: 'in_transit' },
  posting_driver_pickup: { text: '司机已揽件', phase: 'in_transit' },
  posting_in_carriage: { text: '已转移配送', phase: 'in_transit' },
  posting_sent_by_seller: { text: '卖家已发货', phase: 'in_transit' },

  // 4. 已送达 / 已收货
  posting_delivered: { text: '已送达', phase: 'delivered' },
  posting_received: { text: '买家已签收', phase: 'delivered' },

  // 5. 取消
  posting_canceled: { text: '已取消', phase: 'cancelled' },
  posting_cancelled: { text: '已取消', phase: 'cancelled' },
  posting_rejected_by_seller: { text: '卖家已拒单', phase: 'cancelled' },
  posting_canceled_by_client: { text: '买家已取消', phase: 'cancelled' },
  posting_not_accepted: { text: '未被接收', phase: 'cancelled' },

  // 6. 退货 / 失败
  posting_returned_to_seller: { text: '已退回卖家', phase: 'returned' },
  posting_arbitration: { text: '仲裁中', phase: 'returned' },
  posting_client_arbitration: { text: '客户申诉中', phase: 'returned' },
  posting_lost: { text: '运输丢失', phase: 'returned' },
};

export function describeSubstatus(substatus: string | null | undefined): SubstatusMeta {
  if (!substatus) return { text: '未知状态', phase: 'unknown' };
  return MAP[substatus] ?? { text: substatus, phase: 'unknown' };
}

export function isTerminalSubstatus(substatus: string | null | undefined): boolean {
  if (!substatus) return false;
  const meta = MAP[substatus];
  return !!meta && (meta.phase === 'delivered' || meta.phase === 'cancelled' || meta.phase === 'returned');
}
