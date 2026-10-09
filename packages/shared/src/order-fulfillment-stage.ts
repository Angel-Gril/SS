export type CanonicalFulfillmentStageKey = 'purchased' | 'domestic_transit' | 'warehouse_processing' | 'delivering' | 'abnormal';
/** Legacy aliases remain accepted by filters, but never emitted by the pipeline. */
export type FulfillmentStageKey = CanonicalFulfillmentStageKey | 'received' | 'delivered';
export type FulfillmentStageVariant = 'secondary' | 'warning' | 'success' | 'destructive';
export type OrderFulfillmentStatus = 'awaiting_packaging' | 'awaiting_deliver' | 'delivering' | 'delivered' | 'cancelled' | 'exception';

export const ORDER_FULFILLMENT_STAGE_FILTER_KEYS = ['purchased', 'domestic_transit', 'warehouse_processing', 'delivering', 'abnormal', 'received', 'delivered'] as const;
export const ORDER_FULFILLMENT_STATUS_KEYS = ['awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled', 'exception'] as const;

export interface OrderFulfillmentStageInput {
  status?: string | null; subStatus?: string | null; domesticTrackingNumber?: string | null; domesticStatus?: string | null;
  internationalTrackingNumber?: string | null; internationalStatus?: string | null; trackingNumber?: string | null;
  inProcessAt?: string | Date | null; shipmentDate?: string | Date | null; deliveringDate?: string | Date | null;
  deliveredAt?: string | Date | null; inspectionStatus?: string | null; warehouseScanInAt?: string | Date | null;
  warehouseScanOutAt?: string | Date | null; labelPrintedAt?: string | Date | null; stockPreparedAt?: string | Date | null;
}
export interface OrderFulfillmentStage { key: CanonicalFulfillmentStageKey; label: string; variant: FulfillmentStageVariant; }
export interface OrderFulfillmentPipelineStage extends OrderFulfillmentStage { children: readonly { key: OrderFulfillmentStatus; label: string }[]; }

export const ORDER_FULFILLMENT_PIPELINE: readonly OrderFulfillmentPipelineStage[] = [
  { key: 'purchased', label: '采购备货', variant: 'secondary', children: [] },
  { key: 'domestic_transit', label: '国内在途', variant: 'warning', children: [] },
  { key: 'warehouse_processing', label: '仓库处理', variant: 'warning', children: [{ key: 'awaiting_packaging', label: '待打包' }, { key: 'awaiting_deliver', label: '待发货' }] },
  { key: 'delivering', label: '出库发运', variant: 'success', children: [{ key: 'delivering', label: '配送中' }, { key: 'delivered', label: '已送达' }] },
  { key: 'abnormal', label: '异常', variant: 'destructive', children: [{ key: 'cancelled', label: '已取消' }, { key: 'exception', label: '其他异常' }] },
];
const STAGES = Object.fromEntries(ORDER_FULFILLMENT_PIPELINE.map(stage => [stage.key, { key: stage.key, label: stage.label, variant: stage.variant }])) as Record<CanonicalFulfillmentStageKey, OrderFulfillmentStage>;
const ABNORMAL_STATUS_PARTS = ['cancel', 'problem', 'arbitration', 'lost', 'return'];
const DELIVERING_STATUSES = new Set(['shipped', 'delivering', 'driver_pickup', 'sent_by_seller']);
const INTERNATIONAL_DISPATCH_STATUSES = new Set(['shipped', 'in_transit', 'transit', 'delivering', 'dispatched', 'sent']);
const DELIVERING_SUBSTATUS_PARTS = ['shipped', 'posting_shipped', 'posting_in_transit', 'on_way', 'courier', 'driver_pickup', 'sent_by_seller', 'in_carriage', 'in_cariage'];
const DELIVERED_SUBSTATUS_PARTS = ['delivered', 'posting_received', 'client_received'];
const AWAITING_SHIPMENT_SUBSTATUS_PARTS = ['awaiting_registration', 'not_in_process', 'awaiting_packaging', 'in_packaging', 'awaiting_deliver', 'awaiting_passport_data'];

export function resolveOrderFulfillmentStage(order: OrderFulfillmentStageInput, _now: Date = new Date()): OrderFulfillmentStage {
  const status = normalize(order.status), subStatus = normalize(order.subStatus), domesticStatus = normalize(order.domesticStatus), internationalStatus = normalize(order.internationalStatus);
  if (normalize(order.inspectionStatus) === 'failed' || [status, subStatus, domesticStatus, internationalStatus].some(value => hasAnyPart(value, ABNORMAL_STATUS_PARTS))) return STAGES.abnormal;
  if (isDelivered(order) || isDispatched(order)) return STAGES.delivering;
  if (domesticStatus === 'received' || hasDate(order.warehouseScanInAt)) return STAGES.warehouse_processing;
  if (hasDate(order.stockPreparedAt) || domesticStatus === 'shipped' || domesticStatus === 'in_transit' || !!normalize(order.domesticTrackingNumber)) return STAGES.domestic_transit;
  return STAGES.purchased;
}
export function resolveOrderFulfillmentStatus(order: OrderFulfillmentStageInput): OrderFulfillmentStatus | null {
  const stage = resolveOrderFulfillmentStage(order);
  if (stage.key === 'abnormal') return [order.status, order.subStatus, order.domesticStatus, order.internationalStatus].some(value => normalize(value).includes('cancel')) ? 'cancelled' : 'exception';
  if (stage.key === 'delivering') return isDelivered(order) ? 'delivered' : 'delivering';
  if (stage.key === 'warehouse_processing') return normalize(order.status) === 'awaiting_deliver' || normalize(order.subStatus).includes('awaiting_deliver') ? 'awaiting_deliver' : 'awaiting_packaging';
  return null;
}
export function isOrderFulfillmentFilterCompatible(stage?: FulfillmentStageKey, status?: OrderFulfillmentStatus): boolean {
  if (!stage || !status) return true;
  if (stage === 'delivered') return status === 'delivered';
  const canonical = stage === 'received' ? 'warehouse_processing' : stage;
  return ORDER_FULFILLMENT_PIPELINE.find(item => item.key === canonical)?.children.some(child => child.key === status) ?? false;
}
export function matchesOrderFulfillmentFilter(order: OrderFulfillmentStageInput, stage?: FulfillmentStageKey, status?: OrderFulfillmentStatus): boolean {
  if (!isOrderFulfillmentFilterCompatible(stage, status)) return false;
  const resolved = resolveOrderFulfillmentStage(order);
  if (stage === 'delivered' && !(resolved.key === 'delivering' && resolveOrderFulfillmentStatus(order) === 'delivered')) return false;
  if (stage === 'received' && resolved.key !== 'warehouse_processing') return false;
  if (stage && stage !== 'received' && stage !== 'delivered' && resolved.key !== stage) return false;
  return !status || resolveOrderFulfillmentStatus(order) === status;
}
export function isOrderAwaitingSellerShipment(order: OrderFulfillmentStageInput): boolean {
  if (resolveOrderFulfillmentStage(order).key === 'abnormal' || isDelivered(order) || isDispatched(order)) return false;
  const status = normalize(order.status), subStatus = normalize(order.subStatus);
  return status === 'awaiting_packaging' || status === 'awaiting_deliver' || hasAnyPart(subStatus, AWAITING_SHIPMENT_SUBSTATUS_PARTS);
}
function isDelivered(order: OrderFulfillmentStageInput): boolean { return normalize(order.status) === 'delivered' || normalize(order.internationalStatus) === 'delivered' || hasDate(order.deliveredAt) || hasAnyPart(normalize(order.subStatus), DELIVERED_SUBSTATUS_PARTS); }
function isDispatched(order: OrderFulfillmentStageInput): boolean { return DELIVERING_STATUSES.has(normalize(order.status)) || INTERNATIONAL_DISPATCH_STATUSES.has(normalize(order.internationalStatus)) || hasDate(order.deliveringDate) || hasDate(order.warehouseScanOutAt) || hasAnyPart(normalize(order.subStatus), DELIVERING_SUBSTATUS_PARTS); }
function normalize(value: string | null | undefined): string { return (value || '').trim().toLowerCase(); }
function hasAnyPart(value: string, parts: string[]): boolean { return parts.some(part => value.includes(part)); }
function hasDate(value: string | Date | null | undefined): boolean { return !!value && Number.isFinite(new Date(value).getTime()); }
