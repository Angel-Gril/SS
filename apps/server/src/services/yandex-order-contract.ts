import { z } from 'zod';
const numericId = z.number().int().positive().safe();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const money = z.object({ value: z.number().finite().min(0).max(100000000), currencyId: z.string().regex(/^[A-Z]{3}$/u) });
const prices = z.object({ payment: money.nullish(), cashback: money.nullish(), subsidy: money.nullish(), delivery: z.object({ payment: money.nullish(), subsidy: money.nullish() }).nullish() });
export const yandexMark = z.object({ cis: z.string().min(1).max(512).optional(), uin: z.string().regex(/^\d{16}$/u).optional(), rnpt: z.string().min(1).max(100).optional(), gtd: z.string().min(1).max(100).optional(), countryCode: z.string().regex(/^[A-Z]{2}$/u).optional() }).strict()
  .refine(v => [v.cis, v.uin, v.rnpt, v.gtd].filter(Boolean).length === 1, '每个标记只填写一种代码');
export const yandexBoxes = z.array(z.object({ items: z.array(z.object({ id: numericId, fullCount: z.number().int().positive().max(1000000), instances: z.array(yandexMark).max(1000).optional() }).strict()).min(1).max(1000) }).strict()).min(1).max(100);
export type YandexBoxes = z.infer<typeof yandexBoxes>;
const readMark = z.object({ cis: z.string().max(512).optional(), cisFull: z.string().max(512).optional(), uin: z.string().max(100).optional(), rnpt: z.string().max(100).optional(), gtd: z.string().max(100).optional(), countryCode: z.string().max(10).optional() });
export const yandexOrder = z.object({
  orderId: numericId, campaignId: numericId, status: z.string().min(1).max(100), substatus: z.string().min(1).max(120),
  creationDate: z.string().datetime({ offset: true }), updateDate: z.string().datetime({ offset: true }).optional(), fake: z.boolean(),
  programType: z.string().max(50).optional(), externalOrderId: z.string().max(255).nullish(), sourcePlatform: z.string().max(50).optional(),
  items: z.array(z.object({ id: numericId, offerId: z.string().min(1).max(255), offerName: z.string().min(1).max(1000), count: z.number().int().positive().max(1000000), prices: prices.nullish(), requiredInstanceTypes: z.array(z.string().max(100)).max(30).nullish() })).min(1).max(1000),
  prices: prices.nullish(),
  delivery: z.object({ type: z.string().max(50), serviceName: z.string().max(500), deliveryServiceId: numericId, deliveryPartnerType: z.string().max(50), warehouseId: z.string().max(255).nullish(),
    dates: z.object({ fromDate: calendarDate, toDate: calendarDate.optional(), realDeliveryDate: calendarDate.optional() }),
    shipment: z.object({ id: numericId.nullish(), shipmentDate: calendarDate, shipmentTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u).nullish() }).nullish(),
    tracks: z.array(z.object({ trackCode: z.string().max(200).optional(), deliveryServiceId: numericId })).max(100).nullish(),
    boxesLayout: z.array(z.object({ boxId: numericId, barcode: z.string().max(200).optional(), items: z.array(z.object({ id: numericId, fullCount: z.number().int().positive().optional(), instances: z.array(readMark).max(1000).nullish() })).max(1000) })).max(100).nullish(),
  }),
});
export type YandexOrder = z.infer<typeof yandexOrder>;

export const yandexOrderCommand = z.object({ action: z.enum(['PACK', 'READY', 'CONFIRM', 'DELIVER', 'PICKUP', 'COMPLETE', 'CANCEL', 'TRACK']),
  confirm: z.literal(true), idempotencyKey: z.string().trim().min(16).max(200), boxes: yandexBoxes.optional(),
  cancelReason: z.enum(['SHOP_FAILED', 'USER_CHANGED_MIND', 'INCORRECT_PERSONAL_DATA', 'PICKUP_EXPIRED']).optional(),
  trackCode: z.string().trim().min(1).max(200).optional(), deliveryServiceId: numericId.optional(),
}).strict().superRefine((c, ctx) => {
  if (c.action === 'PACK' && !c.boxes) ctx.addIssue({ code: 'custom', message: '请填写完整装箱信息' });
  if (c.action === 'CANCEL' && !c.cancelReason) ctx.addIssue({ code: 'custom', message: '请选择平台取消原因' });
  if (c.action !== 'PACK' && c.boxes) ctx.addIssue({ code: 'custom', message: '本操作不接受装箱信息' });
  if (c.action !== 'CANCEL' && c.cancelReason) ctx.addIssue({ code: 'custom', message: '本操作不接受取消原因' });
  if (c.action === 'TRACK' ? !c.trackCode || !c.deliveryServiceId : c.trackCode !== undefined || c.deliveryServiceId !== undefined) ctx.addIssue({ code: 'custom', message: '仅物流单号操作接受完整单号与配送服务ID' });
});
export type YandexOrderCommand = z.infer<typeof yandexOrderCommand>;
export function yandexOrderActions(order: YandexOrder) {
  const mode = order.programType;
  const fbs = mode === 'FBS' || mode === 'EXPRESS', dbs = mode === 'DBS', laas = mode === 'LAAS';
  const editing = order.status === 'PROCESSING' && order.substatus === 'STARTED';
  const inDelivery = order.status === 'DELIVERY' && order.substatus === 'DELIVERY_SERVICE_RECEIVED';
  const inPickup = order.status === 'PICKUP' && order.substatus === 'PICKUP_SERVICE_RECEIVED';
  const cancelReasons: string[] = fbs && order.status === 'PROCESSING' && ['STARTED', 'READY_TO_SHIP'].includes(order.substatus)
    || laas && ['RESERVED', 'PROCESSING'].includes(order.status) ? ['SHOP_FAILED']
    : dbs && (editing || inDelivery || inPickup) ? ['SHOP_FAILED', 'USER_CHANGED_MIND', ...(editing ? ['INCORRECT_PERSONAL_DATA'] : inPickup ? ['PICKUP_EXPIRED'] : [])] : [];
  return { PACK: (fbs || dbs) && editing, READY: fbs && editing,
    CONFIRM: laas && order.status === 'RESERVED', DELIVER: dbs && editing,
    PICKUP: dbs && inDelivery && order.delivery.type === 'PICKUP', COMPLETE: dbs && (inDelivery || inPickup),
    CANCEL: cancelReasons.length > 0, cancelReasons, TRACK: dbs && ['PROCESSING', 'DELIVERY', 'PICKUP'].includes(order.status),
    label: (fbs || dbs) && ['PROCESSING', 'DELIVERY', 'PICKUP'].includes(order.status) && !!order.delivery.boxesLayout?.length,
    mode: mode ?? 'UNKNOWN', reason: fbs || dbs || laas ? null : '此履约模式由平台处理，ERP仅同步；请在平台核对可用操作',
  };
}
export function validateYandexBoxes(order: YandexOrder, boxes: YandexBoxes) {
  const errors: string[] = [], totals = new Map<number, number>(); const marks = new Map<number, Record<string, number>>(); const unique = new Set<string>();
  for (const box of yandexBoxes.parse(boxes)) {
    const ids = new Set<number>();
    for (const item of box.items) {
      if (ids.has(item.id)) errors.push(`箱内商品${item.id}重复`); ids.add(item.id);
      if (!order.items.some(o => o.id === item.id)) errors.push(`箱内商品${item.id}不属于当前订单`);
      totals.set(item.id, (totals.get(item.id) ?? 0) + item.fullCount);
      for (const m of item.instances ?? []) {
        const key = Object.keys(m).find(k => k !== 'countryCode')!, val = m[key as keyof typeof m]!;
        if (['CIS', 'UIN'].includes(key.toUpperCase())) { if (unique.has(`${key}:${val}`)) errors.push('商品标记不能重复'); unique.add(`${key}:${val}`); }
        const counts = marks.get(item.id) ?? {}; counts[key.toUpperCase()] = (counts[key.toUpperCase()] ?? 0) + 1; marks.set(item.id, counts);
      }
    }
  }
  for (const item of order.items) {
    if (totals.get(item.id) !== item.count) errors.push(`商品${item.id}装箱数量必须等于订单数量`);
    for (const kind of item.requiredInstanceTypes ?? []) if (kind !== 'CIS_OPTIONAL' && (marks.get(item.id)?.[kind] ?? 0) !== item.count) errors.push(`商品${item.id}需要${item.count}份${kind}标记`);
  }
  return [...new Set(errors)];
}
export function yandexOrderTarget(action: Exclude<YandexOrderCommand['action'], 'PACK' | 'TRACK'>, reason?: string) {
  return ({ READY: { status: 'PROCESSING', substatus: 'READY_TO_SHIP' }, CONFIRM: { status: 'PROCESSING', substatus: 'STARTED' },
    DELIVER: { status: 'DELIVERY', substatus: 'DELIVERY_SERVICE_RECEIVED' }, PICKUP: { status: 'PICKUP', substatus: 'PICKUP_SERVICE_RECEIVED' },
    COMPLETE: { status: 'DELIVERED', substatus: 'DELIVERY_SERVICE_DELIVERED' }, CANCEL: { status: 'CANCELLED', substatus: reason! } })[action];
}

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
