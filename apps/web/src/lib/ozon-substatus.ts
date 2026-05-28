// OZON posting substatus → 中文描述（前端展示用）
// 与 server/src/lib/ozon-substatus.ts 保持一致

export type SubstatusPhase =
  | 'created'
  | 'awaiting_packaging'
  | 'awaiting_deliver'
  | 'in_transit'
  | 'arrived'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'unknown';

export interface SubstatusMeta {
  text: string;
  phase: SubstatusPhase;
}

const MAP: Record<string, SubstatusMeta> = {
  posting_acceptance_in_progress: { text: '订单接收中', phase: 'created' },
  posting_created: { text: '订单已创建', phase: 'created' },
  posting_in_cariage: { text: '已加入运输', phase: 'awaiting_deliver' },
  posting_registered: { text: '订单已登记', phase: 'created' },
  posting_awaiting_registration: { text: '等待登记', phase: 'awaiting_packaging' },
  posting_not_in_process: { text: '等待处理', phase: 'awaiting_packaging' },
  posting_awaiting_packaging: { text: '等待打包', phase: 'awaiting_packaging' },
  posting_in_packaging: { text: '正在打包', phase: 'awaiting_packaging' },
  posting_awaiting_deliver: { text: '等待发货', phase: 'awaiting_deliver' },
  posting_awaiting_passport_data: { text: '等待护照信息', phase: 'awaiting_deliver' },
  posting_on_way_to_city: { text: '运往目的城市', phase: 'in_transit' },
  posting_on_way_to_pvz: { text: '运往自提点', phase: 'in_transit' },
  posting_in_pvz: { text: '已到达自提点', phase: 'arrived' },
  posting_in_courier_service: { text: '已交快递', phase: 'in_transit' },
  posting_driver_pickup: { text: '司机已揽件', phase: 'in_transit' },
  posting_in_carriage: { text: '已转移配送', phase: 'in_transit' },
  posting_sent_by_seller: { text: '卖家已发货', phase: 'in_transit' },
  posting_delivered: { text: '已送达', phase: 'delivered' },
  posting_received: { text: '买家已签收', phase: 'delivered' },
  posting_canceled: { text: '已取消', phase: 'cancelled' },
  posting_cancelled: { text: '已取消', phase: 'cancelled' },
  posting_rejected_by_seller: { text: '卖家已拒单', phase: 'cancelled' },
  posting_canceled_by_client: { text: '买家已取消', phase: 'cancelled' },
  posting_not_accepted: { text: '未被接收', phase: 'cancelled' },
  posting_returned_to_seller: { text: '已退回卖家', phase: 'returned' },
  posting_arbitration: { text: '仲裁中', phase: 'returned' },
  posting_client_arbitration: { text: '客户申诉中', phase: 'returned' },
  posting_lost: { text: '运输丢失', phase: 'returned' },
};

export function describeSubstatus(substatus: string | null | undefined): SubstatusMeta {
  if (!substatus) return { text: '未知', phase: 'unknown' };
  return MAP[substatus] ?? { text: substatus, phase: 'unknown' };
}

export const PHASE_COLORS: Record<SubstatusPhase, string> = {
  created: 'text-slate-600 bg-slate-100 dark:bg-slate-800/60',
  awaiting_packaging: 'text-amber-700 bg-amber-100 dark:bg-amber-900/40',
  awaiting_deliver: 'text-amber-700 bg-amber-100 dark:bg-amber-900/40',
  in_transit: 'text-blue-700 bg-blue-100 dark:bg-blue-900/40',
  arrived: 'text-indigo-700 bg-indigo-100 dark:bg-indigo-900/40',
  delivered: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-900/40',
  cancelled: 'text-rose-700 bg-rose-100 dark:bg-rose-900/40',
  returned: 'text-rose-700 bg-rose-100 dark:bg-rose-900/40',
  unknown: 'text-slate-500 bg-slate-100 dark:bg-slate-800/60',
};
