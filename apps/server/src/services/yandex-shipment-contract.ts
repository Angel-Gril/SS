import { z } from 'zod';

const nativeId = z.number().int().positive().safe();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
export const yandexShipmentId = z.string().regex(/^[1-9]\d*$/u).max(16).refine(value => Number.isSafeInteger(Number(value)));
export const yandexShipmentDateRange = z.object({ dateFrom: date, dateTo: date }).strict().refine(value => {
  const days = (Date.parse(value.dateTo) - Date.parse(value.dateFrom)) / 86400000;
  return days >= 0 && days < 31;
}, '每次查询交接批次最多31天，结束日期不能早于开始日期');
export const yandexShipmentConfirmation = z.object({ confirm: z.literal(true), idempotencyKey: z.string().trim().min(16).max(200) }).strict();
export const yandexShipmentDocumentType = z.enum(['ACT', 'INBOUND_ACT', 'DISCREPANCY_ACT', 'TRANSPORTATION_WAYBILL']);
export type YandexShipmentDocumentType = z.infer<typeof yandexShipmentDocumentType>;
const warehouse = z.object({ id: nativeId, name: z.string().max(500).optional(), address: z.string().max(1000).optional() });
const base = z.object({
  id: nativeId, planIntervalFrom: z.string().datetime({ offset: true }), planIntervalTo: z.string().datetime({ offset: true }),
  orderIds: z.array(nativeId).max(2000).refine(ids => new Set(ids).size === ids.length),
  draftCount: z.number().int().nonnegative(), plannedCount: z.number().int().nonnegative(), factCount: z.number().int().nonnegative(),
  signature: z.object({ signed: z.boolean() }), warehouse: warehouse.optional(), warehouseTo: warehouse.optional(),
  palletsCount: z.object({ planned: z.number().int().nonnegative().optional(), fact: z.number().int().nonnegative().optional() }).optional(),
});
const status = z.string().min(1).max(100);
const detail = base.extend({ currentStatus: z.object({ status: status.optional() }).optional(), availableActions: z.array(z.string().min(1).max(100)).max(30) });
const list = base.extend({ status: status.optional() });
export type YandexShipment = {
  id: string; status: string; shipmentDate: string; availableActions: string[]; orderIds: string[];
  planIntervalFrom?: string; planIntervalTo?: string; draftCount: number; plannedCount: number; factCount: number;
  signature: { signed: boolean }; warehouse?: z.infer<typeof warehouse>; warehouseTo?: z.infer<typeof warehouse>;
  palletCount?: number;
};
function project(value: z.infer<typeof base>, currentStatus: string | undefined, availableActions: string[]): YandexShipment {
  return { id: String(value.id), status: currentStatus ?? 'UNKNOWN', shipmentDate: value.planIntervalFrom.slice(0, 10),
    planIntervalFrom: value.planIntervalFrom, planIntervalTo: value.planIntervalTo,
    availableActions, orderIds: value.orderIds.map(String), draftCount: value.draftCount, plannedCount: value.plannedCount,
    factCount: value.factCount, signature: value.signature, ...(value.warehouse ? { warehouse: value.warehouse } : {}),
    ...(value.warehouseTo ? { warehouseTo: value.warehouseTo } : {}),
    ...(value.palletsCount?.planned === undefined ? {} : { palletCount: value.palletsCount.planned }) };
}
export const yandexShipmentResponseSchema = z.object({ status: z.literal('OK'), result: detail }).transform(({ result }) => project(result, result.currentStatus?.status, result.availableActions));
export const yandexShipmentsResponseSchema = z.object({ status: z.literal('OK'), result: z.object({ shipments: z.array(list).max(30), paging: z.object({ nextPageToken: z.string().min(1).max(1000).nullish() }).nullish() }) })
  .transform(({ result }) => ({ shipments: result.shipments.map(value => project(value, value.status, [])), nextPageToken: result.paging?.nextPageToken ?? null }));

/** These official states prove the platform has progressed beyond confirmation. */
export function isYandexShipmentConfirmed(shipment: YandexShipment) {
  return ['OUTBOUND_CONFIRMED', 'OUTBOUND_SIGNED', 'ACCEPTED', 'ACCEPTED_WITH_DISCREPANCIES', 'FINISHED'].includes(shipment.status);
}
