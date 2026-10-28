import { z } from 'zod';
const numericId = z.number().int().positive().safe();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const money = z.object({ value: z.number().finite().min(0).max(100000000), currencyId: z.string().regex(/^[A-Z]{3}$/u) });
const prices = z.object({ payment: money.nullish(), cashback: money.nullish(), subsidy: money.nullish(), delivery: z.object({ payment: money.nullish(), subsidy: money.nullish() }).nullish() });
export const yandexOrder = z.object({
  orderId: numericId, campaignId: numericId, status: z.string().min(1).max(100), substatus: z.string().min(1).max(120),
  creationDate: z.string().datetime({ offset: true }), updateDate: z.string().datetime({ offset: true }).optional(), fake: z.boolean(),
  programType: z.string().max(50).optional(), externalOrderId: z.string().max(255).nullish(), sourcePlatform: z.string().max(50).optional(),
  items: z.array(z.object({ id: numericId, offerId: z.string().min(1).max(255), offerName: z.string().min(1).max(1000), count: z.number().int().positive().max(1000000), prices: prices.nullish() })).min(1).max(1000),
  prices: prices.nullish(),
  delivery: z.object({ type: z.string().max(50), serviceName: z.string().max(500), deliveryServiceId: numericId, deliveryPartnerType: z.string().max(50), warehouseId: z.string().max(255).nullish(),
    dates: z.object({ fromDate: calendarDate, toDate: calendarDate.optional(), realDeliveryDate: calendarDate.optional() }),
    shipment: z.object({ id: numericId.nullish(), shipmentDate: calendarDate, shipmentTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u).nullish() }).nullish(),
    tracks: z.array(z.object({ trackCode: z.string().max(200).optional(), deliveryServiceId: numericId })).max(100).nullish(),
  }),
});
export type YandexOrder = z.infer<typeof yandexOrder>;

export function yandexOrderDateWindows(since: string, until: Date = new Date()) {
  const from = new Date(since); if (!Number.isFinite(from.getTime()) || from > until || until.getTime() - from.getTime() > 366 * 86400000) throw new Error('订单同步时间范围须在一年内');
  const windows: { from: string; to: string }[] = [];
  const end = new Date(until); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  from.setUTCHours(0, 0, 0, 0);
  while (from < end) { const to = new Date(Math.min(from.getTime() + 30 * 86400000, end.getTime())); windows.push({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }); from.setTime(to.getTime()); }
  return windows;
}

export function normalizeYandexOrder(raw: YandexOrder, currency: string) {
  const status = raw.status === 'PROCESSING' ? raw.substatus === 'SHIPPED' ? 'delivering' : raw.substatus === 'READY_TO_SHIP' ? 'awaiting_deliver' : 'awaiting_packaging'
    : ({ DELIVERY: 'delivering', PICKUP: 'delivering', DELIVERED: 'delivered', CANCELLED: 'cancelled', RETURNED: 'returned', PARTIALLY_RETURNED: 'partially_returned' } as Record<string, string>)[raw.status] ?? 'yandex_pending';
  const normalizeCurrency = (value: string) => value === 'RUR' ? 'RUB' : value;
  const sum = (p: z.infer<typeof prices> | null | undefined) => {
    if (!p?.payment) return null;
    if ([p.payment, p.cashback, p.subsidy, p.delivery?.payment, p.delivery?.subsidy].some(v => v && normalizeCurrency(v.currencyId) !== normalizeCurrency(currency))) throw new Error('Yandex 订单币种不一致');
    // payment + cashback is item value; subsidy is seller compensation, not another buyer payment.
    return Math.round((p.payment.value + (p.cashback?.value ?? 0)) * 100) / 100;
  };
  const itemAmount = sum(raw.prices);
  const deliveryPayment = raw.prices?.delivery?.payment?.value ?? 0;
  const deliverySubsidy = raw.prices?.delivery?.subsidy?.value ?? 0;
  const amount = itemAmount === null ? null : Math.round((itemAmount + deliveryPayment + deliverySubsidy) * 100) / 100;
  const subStatus = `yandex:${raw.status}:${raw.substatus}`;
  const track = raw.delivery.tracks?.find(t => t.trackCode)?.trackCode ?? null;
  const eventAt = raw.updateDate ? new Date(raw.updateDate) : null;
  return {
    platformOrderId: String(raw.orderId), postingNumber: String(raw.orderId), status, subStatus,
    totalAmount: amount, currency: normalizeCurrency(currency),
    items: raw.items.map(item => ({ platform: 'YANDEX', itemId: item.id, offer_id: item.offerId, sku: item.offerId, name: item.offerName, quantity: item.count,
      price: sum(item.prices) === null ? null : (sum(item.prices)! / item.count).toFixed(2), currency_code: normalizeCurrency(currency), image: null as string | null })),
    trackingNumber: track, shippingMethod: raw.delivery.serviceName, warehouseId: raw.delivery.warehouseId ?? null,
    inProcessAt: new Date(raw.creationDate),
    shipmentDate: raw.delivery.shipment ? new Date(raw.delivery.shipment.shipmentDate + 'T23:59:59.999Z') : null,
    deliveringDate: status === 'delivering' ? eventAt : null,
    deliveredAt: status === 'delivered' ? eventAt : null,
    createdAt: new Date(raw.creationDate),
    shippingInfo: { deliveryMethod: raw.delivery.serviceName, yandexMarket: { campaignId: raw.campaignId, orderId: raw.orderId, status: raw.status, substatus: raw.substatus,
      updateDate: raw.updateDate ?? null, programType: raw.programType ?? null, sourcePlatform: raw.sourcePlatform ?? null, externalOrderId: raw.externalOrderId ?? null,
      fake: raw.fake, deliveryServiceId: raw.delivery.deliveryServiceId, deliveryPartnerType: raw.delivery.deliveryPartnerType,
      tracks: raw.delivery.tracks ?? [], shipmentId: raw.delivery.shipment?.id ?? null, deliveryDates: raw.delivery.dates,
      itemPrice: itemAmount, deliveryPrice: itemAmount === null ? null : Math.round((deliveryPayment + deliverySubsidy) * 100) / 100 } },
  };
}
