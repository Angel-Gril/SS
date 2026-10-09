import { Prisma } from '@prisma/client';
import { isOrderAwaitingSellerShipment, type OrderFulfillmentStageInput } from 'shared/order-fulfillment-stage';

export type OrderListSearchField = 'all' | 'sku' | 'product';
export type ShipmentUrgency = 'overdue' | 'today' | 'tomorrow' | 'within3d';
export type OrderListScopeQuery = {
  shopId?: string; status?: string; subStatus?: string; search?: string; searchField?: 'all' | 'posting' | 'tracking' | 'sku' | 'product' | 'purchase';
  serviceTagId?: string; userColorTagId?: string; shipmentUrgency?: ShipmentUrgency; hasTracking?: 'yes' | 'no';
  purchaseState?: 'linked' | 'unlinked'; shippingMethod?: string; startDate?: string; endDate?: string;
};
type ScopeDatabase = { $queryRaw<T>(query: Prisma.Sql): Promise<T>; order: { findMany(args: unknown): Promise<any[]> } };

export function buildOrderCreatedAtRange(startDate?: string, endDate?: string): Record<string, Date> | undefined {
  const range: Record<string, Date> = {};
  if (startDate) range.gte = parseDateAtUtcStartOfDay(startDate);
  if (endDate) {
    const exclusiveEnd = parseDateAtUtcStartOfDay(endDate); exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1); range.lt = exclusiveEnd;
  }
  return Object.keys(range).length > 0 ? range : undefined;
}
function parseDateAtUtcStartOfDay(value: string): Date {
  const trimmed = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? new Date(`${trimmed}T00:00:00.000Z`) : new Date(trimmed);
  if (!Number.isFinite(date.getTime())) throw new Error('日期参数无效');
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && date.toISOString().slice(0, 10) !== trimmed) throw new Error('日期参数无效');
  date.setUTCHours(0, 0, 0, 0); return date;
}
export function buildShipmentDeadlineRange(urgency: ShipmentUrgency, now: Date): Record<string, Date> {
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const endOfTomorrow = new Date(now); endOfTomorrow.setDate(endOfTomorrow.getDate() + 1); endOfTomorrow.setHours(23, 59, 59, 999);
  const endOfThirdDay = new Date(now); endOfThirdDay.setDate(endOfThirdDay.getDate() + 3); endOfThirdDay.setHours(23, 59, 59, 999);
  if (urgency === 'overdue') return { lt: now }; if (urgency === 'today') return { gte: now, lte: endOfToday }; if (urgency === 'tomorrow') return { gt: endOfToday, lte: endOfTomorrow }; return { gte: now, lte: endOfThirdDay };
}
export function filterOrderIdsByShipmentUrgency(orders: Array<OrderFulfillmentStageInput & { id: string }>, urgency: ShipmentUrgency, now = new Date()): string[] {
  return orders.filter(order => {
    if (!isOrderAwaitingSellerShipment(order) || !order.shipmentDate) return false;
    const deadline = order.shipmentDate instanceof Date ? order.shipmentDate : new Date(order.shipmentDate);
    if (!Number.isFinite(deadline.getTime())) return false;
    const range = buildShipmentDeadlineRange(urgency, now);
    return (range.gte && deadline < range.gte) || (range.gt && deadline <= range.gt) || (range.lt && deadline >= range.lt) || (range.lte && deadline > range.lte) ? false : true;
  }).map(order => order.id);
}
function escapePostgresLike(value: string): string { return value.replace(/[\\%_]/g, '\\$&'); }
export async function findOrderIdsByItemSearch(database: ScopeDatabase, shopIds: string[], term: string, field: OrderListSearchField): Promise<string[]> {
  if (shopIds.length === 0 || !term) return [];
  const pattern = `%${escapePostgresLike(term)}%`; const predicates: Prisma.Sql[] = [];
  if (field === 'all' || field === 'sku') predicates.push(Prisma.sql`item ->> 'sku' ILIKE ${pattern} ESCAPE '\\'`, Prisma.sql`item ->> 'offer_id' ILIKE ${pattern} ESCAPE '\\'`);
  if (field === 'all' || field === 'product') predicates.push(Prisma.sql`item ->> 'name' ILIKE ${pattern} ESCAPE '\\'`);
  if (!predicates.length) return [];
  const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT DISTINCT o."id" FROM "orders" AS o CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o."items") = 'array' THEN o."items" ELSE '[]'::jsonb END) AS item WHERE o."shop_id" IN (${Prisma.join(shopIds)}) AND (${Prisma.join(predicates, ' OR ')})`);
  return rows.map(row => String(row.id)).filter(Boolean);
}

/** Builds only the non-stage scope shared by list and pipeline consumers. */
export async function buildOrderListScope(database: ScopeDatabase, shopIds: string[], query: OrderListScopeQuery): Promise<Record<string, unknown>> {
  const validShopIds = query.shopId ? (shopIds.includes(query.shopId) ? [query.shopId] : []) : shopIds;
  const where: Record<string, unknown> = { shopId: { in: validShopIds } };
  if (query.status) where.status = query.status; if (query.subStatus) where.subStatus = query.subStatus;
  if (query.purchaseState === 'linked') where.purchaseOrderId = { not: null }; if (query.purchaseState === 'unlinked') where.purchaseOrderId = null;
  if (query.shippingMethod) where.shippingMethod = { contains: query.shippingMethod, mode: 'insensitive' };
  if (query.search?.trim()) {
    const term = query.search.trim(); const ci = { contains: term, mode: 'insensitive' as const }; const field = query.searchField || 'all';
    if (field === 'posting') where.OR = [{ postingNumber: ci }, { platformOrderId: ci }];
    else if (field === 'tracking') where.OR = [{ trackingNumber: ci }, { domesticTrackingNumber: ci }, { internationalTrackingNumber: ci }];
    else if (field === 'purchase') where.OR = [{ purchaseOrderId: ci }];
    else if (field === 'sku' || field === 'product') where.id = { in: await findOrderIdsByItemSearch(database, validShopIds, term, field) };
    else where.OR = [{ postingNumber: ci }, { platformOrderId: ci }, { trackingNumber: ci }, { domesticTrackingNumber: ci }, { internationalTrackingNumber: ci }, { purchaseOrderId: ci }, { id: { in: await findOrderIdsByItemSearch(database, validShopIds, term, 'all') } }];
  }
  if (query.serviceTagId) where.serviceTags = { array_contains: [query.serviceTagId] }; if (query.userColorTagId) where.userColorTags = { array_contains: [query.userColorTagId] };
  if (query.hasTracking === 'yes') where.trackingNumber = { not: null }; if (query.hasTracking === 'no') where.trackingNumber = null;
  if (query.shipmentUrgency) {
    const now = new Date(); where.shipmentDate = buildShipmentDeadlineRange(query.shipmentUrgency, now); if (!query.status) where.status = { in: ['awaiting_packaging', 'awaiting_deliver'] };
    const candidates = await database.order.findMany({ where, select: { id: true, status: true, subStatus: true, shipmentDate: true, deliveringDate: true, deliveredAt: true } });
    const ids = new Set(filterOrderIdsByShipmentUrgency(candidates, query.shipmentUrgency, now)); where.id = { in: candidates.map(row => row.id).filter(id => ids.has(id)) };
  }
  if (query.startDate || query.endDate) where.createdAt = buildOrderCreatedAtRange(query.startDate, query.endDate);
  const start = query.startDate ? parseDateAtStart(query.startDate) : null;
  const end = query.endDate ? parseDateAtStart(query.endDate) : null;
  if (start && end && start > end) throw new Error('开始日期不能晚于结束日期');
  return where;
}
function parseDateAtStart(value: string): Date { return parseDateAtUtcStartOfDay(value); }
