import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { readYandexBusiness } from './yandex-market-catalog.js';
import { YandexMarketApiError, type YandexMarketCampaign } from './yandex-market-client.js';
import { isYandexShipmentConfirmed, yandexShipmentConfirmation, yandexShipmentDateRange, yandexShipmentDocumentType, yandexShipmentId, type YandexShipment, type YandexShipmentDocumentType } from './yandex-shipment-contract.js';

type Shop = { id: string; userId: string; status: string; clientId: string | null; apiKeyEncrypted: string; config: unknown };
type Client = {
  getCampaign(id: string): Promise<YandexMarketCampaign>;
  getShipments(campaignId: string, range: { dateFrom: string; dateTo: string; pageToken?: string }): Promise<{ shipments: YandexShipment[]; nextPageToken: string | null }>;
  getShipment(campaignId: string, shipmentId: string): Promise<YandexShipment>;
  getOrdersByIds(businessId: string, campaignId: string, orderIds: string[]): Promise<{ orderId: number; campaignId: number; fake: boolean }[]>;
  confirmShipment(campaignId: string, shipmentId: string): Promise<{ status: 'OK' }>;
  getShipmentDocument(campaignId: string, shipmentId: string, type: YandexShipmentDocumentType): Promise<Uint8Array>;
};
type ContextInput = { shop: Shop; ownerUserId: string; shipmentId: string; client: Client };
export class YandexShipmentPreconditionError extends Error { readonly notDispatched = true; }
function checkShop(shop: Shop, ownerUserId: string) {
  if (shop.userId !== ownerUserId || shop.status !== 'ACTIVE') throw new YandexShipmentPreconditionError('Yandex 店铺不可用');
}
async function readScope(input: Omit<ContextInput, 'shipmentId'>) {
  checkShop(input.shop, input.ownerUserId);
  const campaign = await input.client.getCampaign(input.shop.clientId ?? '');
  const businessId = await readYandexBusiness(input.shop, { getCampaign: async () => campaign });
  if (!['FBS', 'EXPRESS'].includes(campaign.placementType ?? '')) throw new YandexShipmentPreconditionError('此履约模式不支持卖家交接批次；请使用平台对应履约流程');
  return { businessId, campaignId: input.shop.clientId! };
}
export async function readYandexShipmentContext(input: ContextInput) {
  yandexShipmentId.parse(input.shipmentId);
  const scope = await readScope(input);
  const shipment = await input.client.getShipment(scope.campaignId, input.shipmentId);
  if (shipment.id !== input.shipmentId) throw new YandexShipmentPreconditionError('Yandex 交接批次归属不匹配');
  return { ...scope, shipment };
}
export async function readYandexShipments(input: Omit<ContextInput, 'shipmentId'> & { range: unknown }) {
  const range = yandexShipmentDateRange.parse(input.range), scope = await readScope(input);
  const shipments: YandexShipment[] = [], seen = new Set<string>(), ids = new Set<string>(); let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await input.client.getShipments(scope.campaignId, { ...range, pageToken });
    for (const shipment of result.shipments) { if (ids.has(shipment.id)) throw new Error('Yandex 交接批次分页重复，未返回部分结果'); ids.add(shipment.id); shipments.push(shipment); }
    if (!result.nextPageToken) return { ...scope, shipments };
    if (seen.has(result.nextPageToken)) break;
    seen.add(result.nextPageToken); pageToken = result.nextPageToken;
  }
  throw new Error('Yandex 交接批次分页未完成，请缩小日期范围');
}
async function checkMembership(client: Client, businessId: string, campaignId: string, shipment: YandexShipment) {
  if (!shipment.orderIds.length || shipment.orderIds.length > 2000) throw new YandexShipmentPreconditionError('每次交接批次须有1至2000个订单；请到平台核对异常批次');
  const members = new Set<string>();
  for (let offset = 0; offset < shipment.orderIds.length; offset += 50) {
    const expected = shipment.orderIds.slice(offset, offset + 50), orders = await client.getOrdersByIds(businessId, campaignId, expected);
    if (orders.length !== expected.length || orders.some(order => String(order.campaignId) !== campaignId || order.fake || !expected.includes(String(order.orderId)) || members.has(String(order.orderId)))) throw new YandexShipmentPreconditionError('交接订单不完整、已变化或不属于当前店铺，请同步核对');
    orders.forEach(order => members.add(String(order.orderId)));
  }
  if (members.size !== shipment.orderIds.length) throw new YandexShipmentPreconditionError('交接订单归属无法核对');
}
function sameMembers(left: string[], right: string[]) {
  const a = [...left].sort(), b = [...right].sort();
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** One persistent reservation per native shipment; unknown writes are observed, never sent again. */
export async function executeYandexShipmentConfirmation(input: ContextInput & { actorUserId: string; body: unknown }) {
  const { shop, ownerUserId, actorUserId, shipmentId, client } = input;
  checkShop(shop, ownerUserId); yandexShipmentId.parse(shipmentId);
  const command = yandexShipmentConfirmation.parse(input.body);
  const requestHash = createHash('sha256').update(JSON.stringify({ kind: 'SHIPMENT_MANAGEMENT', shopId: shop.id, shipmentId, command })).digest('hex');
  const where = { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey: command.idempotencyKey } };
  const previous = await prisma.yandexOfferPublishOperation.findUnique({ where });
  if (previous && (previous.requestHash !== requestHash || previous.shopId !== shop.id)) throw new YandexShipmentPreconditionError('幂等键已用于其他交接操作');
  if (previous && ['SUCCEEDED', 'REJECTED'].includes(previous.state)) return { id: previous.id, state: previous.state, replayed: true };
  let context;
  try { context = await readYandexShipmentContext(input); }
  catch { if (previous) return { id: previous.id, state: previous.state, replayed: true }; throw new YandexShipmentPreconditionError('无法核对交接批次，请刷新店铺及平台状态'); }
  const { businessId, campaignId, shipment } = context;
  if (previous) {
    const saved = previous.requestPayload as { kind?: string; orderIds?: string[] };
    if (previous.businessId !== businessId || saved.kind !== 'SHIPMENT_MANAGEMENT' || !saved.orderIds || !sameMembers(saved.orderIds, shipment.orderIds) || !isYandexShipmentConfirmed(shipment)) return { id: previous.id, state: previous.state, replayed: true };
    try {
      await prisma.yandexOfferPublishOperation.update({ where: { id: previous.id }, data: { state: 'SUCCEEDED', response: { kind: 'SHIPMENT_READBACK', shipmentId, status: shipment.status, observedAt: new Date().toISOString() }, errorMessage: null } });
      return { id: previous.id, state: 'SUCCEEDED' as const, replayed: true };
    } catch { return { id: previous.id, state: previous.state, replayed: true }; }
  }
  if (!shipment.availableActions.includes('CONFIRM') || shipment.status !== 'OUTBOUND_READY_FOR_CONFIRMATION') throw new YandexShipmentPreconditionError('平台当前不允许确认交接，请等待批次形成及截单时间');
  try { await checkMembership(client, businessId, campaignId, shipment); }
  catch (error) { if (error instanceof YandexShipmentPreconditionError) throw error; throw new YandexShipmentPreconditionError('无法核对交接订单，请稍后刷新；尚未发送确认'); }
  const reservation = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`yandex-shipment:${ownerUserId}:${shop.id}:${shipmentId}`}, 0))`;
    for (const orderId of [...shipment.orderIds].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`yandex-order:${ownerUserId}:${shop.id}:${orderId}`}, 0))`;
    const saved = await tx.yandexOfferPublishOperation.findUnique({ where });
    if (saved) { if (saved.requestHash !== requestHash) throw new YandexShipmentPreconditionError('交接幂等键冲突'); return { replay: { id: saved.id, state: saved.state, replayed: true } }; }
    const current = await tx.shop.findFirst({ where: { id: shop.id, userId: ownerUserId, platform: 'YANDEX', status: 'ACTIVE', clientId: shop.clientId, apiKeyEncrypted: shop.apiKeyEncrypted } });
    if (!current) throw new YandexShipmentPreconditionError('Yandex 店铺凭据或状态已变化');
    const pending = await tx.yandexOfferPublishOperation.findFirst({ where: { ownerUserId, shopId: shop.id, state: { in: ['SUBMITTING', 'UNKNOWN'] }, OR: [{ requestPayload: { path: ['shipmentIds'], array_contains: [shipmentId] } }, ...shipment.orderIds.map(orderId => ({ requestPayload: { path: ['orderIds'], array_contains: [orderId] } }))] }, select: { id: true } });
    if (pending) throw new YandexShipmentPreconditionError('交接批次或成员订单存在结果未确认的操作，请先核对原请求');
    return { row: await tx.yandexOfferPublishOperation.create({ data: { id: randomUUID(), ownerUserId, actorUserId, shopId: shop.id, sourceShopId: shop.id, businessId, idempotencyKey: command.idempotencyKey, requestHash, state: 'SUBMITTING',
      requestPayload: { kind: 'SHIPMENT_MANAGEMENT', shipmentIds: [shipmentId], orderIds: shipment.orderIds, command, before: { status: shipment.status, plannedCount: shipment.plannedCount } } } }) };
  }, { timeout: 10000 });
  if (reservation.replay) return reservation.replay;
  const id = reservation.row!.id;
  let state: 'SUCCEEDED' | 'SUBMITTING' | 'REJECTED' | 'UNKNOWN' = 'UNKNOWN';
  let response: { kind: string; shipmentId: string; status?: string; accepted?: boolean; observedAt?: string } = { kind: 'SHIPMENT_CONFIRMATION', shipmentId };
  try {
    const accepted = await client.confirmShipment(campaignId, shipmentId);
    if (accepted.status === 'OK') {
      state = 'SUBMITTING'; response = { ...response, accepted: true };
      try {
        const observed = await client.getShipment(campaignId, shipmentId);
        if (observed.id === shipmentId && sameMembers(shipment.orderIds, observed.orderIds) && isYandexShipmentConfirmed(observed)) { state = 'SUCCEEDED'; response = { kind: 'SHIPMENT_READBACK', shipmentId, status: observed.status, observedAt: new Date().toISOString() }; }
      } catch { /* Accepted confirmation remains pending until a later exact readback. */ }
    }
  } catch (error) {
    state = error instanceof YandexMarketApiError && (!error.dispatched || (error.status >= 400 && error.status < 500 && ![408, 409, 420, 429].includes(error.status))) ? 'REJECTED' : 'UNKNOWN';
  }
  try { await prisma.yandexOfferPublishOperation.update({ where: { id }, data: { state, response, errorMessage: state === 'UNKNOWN' ? '交接确认结果未知，请核对原请求，勿重复发送' : null } }); }
  catch { return { id, state: 'UNKNOWN' as const, replayed: false }; }
  return { id, state, replayed: false };
}

export async function readYandexShipmentDocument(input: ContextInput & { documentType: unknown }) {
  const type = yandexShipmentDocumentType.parse(input.documentType), context = await readYandexShipmentContext(input);
  if (!context.shipment.availableActions.includes(`DOWNLOAD_${type}`)) throw new YandexShipmentPreconditionError('平台尚未开放此交接文档，请先核对批次状态');
  return input.client.getShipmentDocument(context.campaignId, input.shipmentId, type);
}

/** Restore a pending command for the owned native shipment after browser/session loss.
 * Invalid or mismatched journal payloads are deliberately treated as absent so that
 * stored arbitrary JSON never becomes a command source or an information oracle. */
export async function readYandexPendingShipmentCommand(input: Pick<ContextInput, 'shop' | 'ownerUserId' | 'shipmentId'>) {
  checkShop(input.shop, input.ownerUserId);
  yandexShipmentId.parse(input.shipmentId);
  const row = await prisma.yandexOfferPublishOperation.findFirst({
    where: { ownerUserId: input.ownerUserId, shopId: input.shop.id, state: { in: ['SUBMITTING', 'UNKNOWN'] },
      AND: [{ requestPayload: { path: ['kind'], equals: 'SHIPMENT_MANAGEMENT' } }, { requestPayload: { path: ['shipmentIds'], array_contains: [input.shipmentId] } }] },
    orderBy: { createdAt: 'desc' }, select: { requestPayload: true },
  });
  if (!row) return null;
  try {
    const payload = row.requestPayload as { kind?: unknown; shipmentIds?: unknown; command?: unknown };
    if (payload.kind !== 'SHIPMENT_MANAGEMENT' || !Array.isArray(payload.shipmentIds) || payload.shipmentIds.length !== 1 || payload.shipmentIds[0] !== input.shipmentId) return null;
    return yandexShipmentConfirmation.parse(payload.command);
  } catch { return null; }
}
