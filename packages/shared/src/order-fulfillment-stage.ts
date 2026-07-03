export type FulfillmentStageKey =
  | 'purchased'
  | 'domestic_transit'
  | 'received'
  | 'warehouse_processing'
  | 'delivering'
  | 'delivered'
  | 'abnormal';

export type FulfillmentStageVariant = 'secondary' | 'warning' | 'success' | 'destructive';

export interface OrderFulfillmentStageInput {
  status?: string | null;
  subStatus?: string | null;
  domesticTrackingNumber?: string | null;
  domesticStatus?: string | null;
  internationalTrackingNumber?: string | null;
  internationalStatus?: string | null;
  trackingNumber?: string | null;
  inProcessAt?: string | Date | null;
  shipmentDate?: string | Date | null;
  deliveringDate?: string | Date | null;
  deliveredAt?: string | Date | null;
  inspectionStatus?: string | null;
  warehouseScanInAt?: string | Date | null;
  warehouseScanOutAt?: string | Date | null;
  labelPrintedAt?: string | Date | null;
}

export interface OrderFulfillmentStage {
  key: FulfillmentStageKey;
  label: string;
  variant: FulfillmentStageVariant;
}

const STAGES: Record<FulfillmentStageKey, OrderFulfillmentStage> = {
  purchased: { key: 'purchased', label: '采购备货', variant: 'secondary' },
  domestic_transit: { key: 'domestic_transit', label: '国内在途', variant: 'warning' },
  received: { key: 'received', label: '到仓入库', variant: 'success' },
  warehouse_processing: { key: 'warehouse_processing', label: '仓库处理', variant: 'warning' },
  delivering: { key: 'delivering', label: '出库发运', variant: 'success' },
  delivered: { key: 'delivered', label: '已送达', variant: 'success' },
  abnormal: { key: 'abnormal', label: '异常', variant: 'destructive' },
};

const ABNORMAL_STATUS_PARTS = ['cancel', 'problem', 'arbitration', 'lost', 'return'];
const DELIVERING_STATUSES = new Set(['delivering', 'driver_pickup', 'sent_by_seller']);
const DELIVERED_STATUSES = new Set(['delivered']);
const AWAITING_LABEL_STATUSES = new Set(['awaiting_deliver']);
const PACKAGING_STATUSES = new Set(['awaiting_packaging']);
const DELIVERING_SUBSTATUS_PARTS = [
  'on_way',
  'courier',
  'driver_pickup',
  'sent_by_seller',
  'in_carriage',
  'in_cariage',
];
const DELIVERED_SUBSTATUS_PARTS = ['delivered', 'received'];
const AWAITING_SHIPMENT_SUBSTATUS_PARTS = [
  'awaiting_registration',
  'not_in_process',
  'awaiting_packaging',
  'in_packaging',
  'awaiting_deliver',
  'awaiting_passport_data',
];

const INSPECTION_DELAY_MS = 30 * 60 * 1000;

export function resolveOrderFulfillmentStage(
  order: OrderFulfillmentStageInput,
  now: Date = new Date(),
): OrderFulfillmentStage {
  const status = normalize(order.status);
  const subStatus = normalize(order.subStatus);
  const domesticStatus = normalize(order.domesticStatus);
  const internationalStatus = normalize(order.internationalStatus);
  const inspectionStatus = normalize(order.inspectionStatus);

  if (
    inspectionStatus === 'failed'
    || hasAnyPart(status, ABNORMAL_STATUS_PARTS)
    || hasAnyPart(subStatus, ABNORMAL_STATUS_PARTS)
  ) {
    return STAGES.abnormal;
  }

  if (
    DELIVERED_STATUSES.has(status)
    || internationalStatus === 'delivered'
    || !!order.deliveredAt
    || hasAnyPart(subStatus, DELIVERED_SUBSTATUS_PARTS)
  ) {
    return STAGES.delivered;
  }

  if (
    DELIVERING_STATUSES.has(status)
    || !!order.deliveringDate
    || !!order.warehouseScanOutAt
    || hasAnyPart(subStatus, DELIVERING_SUBSTATUS_PARTS)
  ) {
    return STAGES.delivering;
  }

  if (AWAITING_LABEL_STATUSES.has(status) || !!order.shipmentDate || !!order.internationalTrackingNumber || !!order.trackingNumber) {
    return STAGES.warehouse_processing;
  }

  if (domesticStatus === 'received') {
    if (isOlderThan(order.warehouseScanInAt, INSPECTION_DELAY_MS, now)) {
      return STAGES.warehouse_processing;
    }
    return STAGES.received;
  }

  if (domesticStatus === 'shipped' || !!order.domesticTrackingNumber) {
    return STAGES.domestic_transit;
  }

  if (PACKAGING_STATUSES.has(status) || !!order.inProcessAt) {
    return STAGES.purchased;
  }

  return STAGES.purchased;
}

export function isOrderAwaitingSellerShipment(order: OrderFulfillmentStageInput): boolean {
  const status = normalize(order.status);
  const subStatus = normalize(order.subStatus);

  if (
    DELIVERED_STATUSES.has(status)
    || DELIVERING_STATUSES.has(status)
    || !!order.deliveringDate
    || !!order.deliveredAt
    || hasAnyPart(status, ABNORMAL_STATUS_PARTS)
    || hasAnyPart(subStatus, ABNORMAL_STATUS_PARTS)
    || hasAnyPart(subStatus, DELIVERING_SUBSTATUS_PARTS)
    || hasAnyPart(subStatus, DELIVERED_SUBSTATUS_PARTS)
  ) {
    return false;
  }

  return (
    PACKAGING_STATUSES.has(status)
    || AWAITING_LABEL_STATUSES.has(status)
    || hasAnyPart(subStatus, AWAITING_SHIPMENT_SUBSTATUS_PARTS)
  );
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function hasAnyPart(value: string, parts: string[]): boolean {
  return parts.some((part) => value.includes(part));
}

function isOlderThan(value: string | Date | null | undefined, delayMs: number, now: Date): boolean {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) && now.getTime() - time >= delayMs;
}
