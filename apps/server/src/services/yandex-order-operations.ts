import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { readYandexBusiness } from './yandex-market-catalog.js';
import { YandexMarketApiError, type YandexMarketClient } from './yandex-market-client.js';
import { yandexOrderActions, yandexOrderCommand, yandexOrderTarget, validateYandexBoxes, type YandexOrder, type YandexBoxes } from './yandex-order-contract.js';

type OrderClient = Pick<YandexMarketClient, 'getCampaign' | 'getOrder' | 'setOrderBoxes' | 'updateOrderStatus' | 'getOrderOperation' | 'getOrderIdentifiersStatus' | 'setOrderTrack' | 'getDeliveryServices'>;
type Shop = { id: string; userId: string; clientId: string | null; apiKeyEncrypted: string; status: string; config: unknown };
type Input = { shop: Shop; ownerUserId: string; actorUserId: string; orderId: string; body: unknown; client: OrderClient };
class OrderPreconditionError extends Error { readonly notDispatched = true; }

/** Local order ID must resolve inside the authenticated shop before reading native IDs. */
export async function readYandexOrderContext(input: Pick<Input, 'shop' | 'ownerUserId' | 'orderId' | 'client'>) {
  const { shop, ownerUserId, orderId, client } = input;
  if (shop.userId !== ownerUserId || shop.status !== 'ACTIVE') throw new Error('Yandex 店铺不可用');
  const local = await prisma.order.findFirst({ where: { id: orderId, shopId: shop.id, shop: { userId: ownerUserId, platform: 'YANDEX', status: 'ACTIVE' } }, select: { id: true, platformOrderId: true } });
  if (!local) throw new Error('Yandex 订单不存在');
  const businessId = await readYandexBusiness(shop, client);
  const raw = await client.getOrder(businessId, shop.clientId!, local.platformOrderId);
  if (!raw || String(raw.campaignId) !== shop.clientId || raw.fake || String(raw.orderId) !== local.platformOrderId) throw new Error('Yandex 订单归属或状态已变化，请同步核对');
  const campaign = !raw.programType ? await client.getCampaign(shop.clientId!) : null;
  const order = { ...raw, programType: raw.programType ?? campaign?.placementType ?? undefined };
  return { businessId, order, actions: yandexOrderActions(order), nativeOrderId: local.platformOrderId };
}
function layoutSignature(boxes: YandexBoxes | NonNullable<YandexOrder['delivery']['boxesLayout']>) {
  return JSON.stringify(boxes.map(box => box.items.map(item => ({ id: item.id, fullCount: item.fullCount,
    instances: [...(item.instances ?? [])].map(m => JSON.stringify({ cis: (m as any).cisFull ?? (m as any).cis, uin: (m as any).uin, rnpt: (m as any).rnpt, gtd: (m as any).gtd, countryCode: (m as any).countryCode })).sort() })).sort((a, b) => a.id - b.id)).map(box => JSON.stringify(box)).sort());
}
export async function executeYandexOrderOperation(input: Input) {
  const { shop, ownerUserId, actorUserId, orderId, client } = input;
  const command = yandexOrderCommand.parse(input.body);
  const requestHash = createHash('sha256').update(JSON.stringify({ kind: 'ORDER_MANAGEMENT', shopId: shop.id, orderId, command })).digest('hex');
  const where = { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey: command.idempotencyKey } };
  const previous = await prisma.yandexOfferPublishOperation.findUnique({ where });
  if (previous && (previous.requestHash !== requestHash || previous.shopId !== shop.id)) throw new Error('幂等键已用于其他订单或操作');
  if (previous && ['SUCCEEDED', 'REJECTED'].includes(previous.state)) return { id: previous.id, state: previous.state, replayed: true };
  let context;
  try { context = await readYandexOrderContext(input); }
  catch (e) { if (previous) return { id: previous.id, state: previous.state, replayed: true }; throw new OrderPreconditionError(e instanceof Error ? e.message : '订单读取失败，尚未发送操作'); }
  const { order, actions, businessId, nativeOrderId } = context;
  if (previous) {
    let state = previous.state;
    try {
      if (previous.businessId !== businessId) return { id: previous.id, state, replayed: true };
      const operation = (previous.response as { operation?: { id?: string } } | null)?.operation;
      if (operation?.id) {
        const response = await client.getOrderOperation(businessId, operation.id);
        if (response.status === 'FAILED') state = 'REJECTED';
        // DONE acknowledges the operation; readback must still prove the requested status.
        if (response.status === 'IN_PROGRESS') return { id: previous.id, state: 'SUBMITTING' as const, replayed: true };
      }
      const target = !['PACK', 'TRACK'].includes(command.action) ? yandexOrderTarget(command.action as Exclude<typeof command.action, 'PACK' | 'TRACK'>, command.cancelReason) : null;
      const matched = command.action === 'PACK' ? !!order.delivery.boxesLayout?.length && layoutSignature(order.delivery.boxesLayout) === layoutSignature(command.boxes!)
        : command.action === 'TRACK' ? !!order.delivery.tracks?.some(t => t.trackCode === command.trackCode && t.deliveryServiceId === command.deliveryServiceId)
        : order.status === target!.status && (!target!.substatus || order.substatus === target!.substatus);
      if (matched && state !== 'REJECTED') state = 'SUCCEEDED';
      if (state !== previous.state) await prisma.yandexOfferPublishOperation.update({ where: { id: previous.id }, data: { state,
        response: { kind: 'ORDER_READBACK', operation: operation ?? null, status: order.status, substatus: order.substatus, observedAt: new Date().toISOString() } } });
    } catch { state = previous.state; /* Failed persistence must never report an unrecorded success. */ }
    return { id: previous.id, state, replayed: true };
  }
  if (!actions[command.action]) throw new OrderPreconditionError(`Yandex 当前状态或履约模式不允许${command.action}，请刷新核对`);
  if (command.action === 'PACK') {
    const errors = validateYandexBoxes(order, command.boxes!); if (errors.length) throw new OrderPreconditionError(errors.join('；'));
  }
  if (command.action === 'READY') {
    if (!order.delivery.boxesLayout?.length) throw new OrderPreconditionError('请先完整装箱，再确认已备货');
    const boxes = order.delivery.boxesLayout.map(box => ({ items: box.items.map(item => ({ ...item, fullCount: item.fullCount ?? 0, instances: item.instances?.map(m => ({ ...(m.cisFull || m.cis ? { cis: m.cisFull || m.cis } : {}), ...(m.uin ? { uin: m.uin } : {}), ...(m.rnpt ? { rnpt: m.rnpt } : {}), ...(m.gtd ? { gtd: m.gtd } : {}), ...(m.countryCode ? { countryCode: m.countryCode } : {}) })) })) }));
    const errors = validateYandexBoxes(order, boxes); if (errors.length) throw new OrderPreconditionError(errors.join('；'));
  }
  if (command.action === 'READY' && order.items.some(i => i.requiredInstanceTypes?.some(k => ['CIS', 'UIN'].includes(k)))) {
    const validated = await client.getOrderIdentifiersStatus(shop.clientId!, nativeOrderId);
    for (const item of order.items) for (const type of item.requiredInstanceTypes ?? []) {
      if (type !== 'CIS' && type !== 'UIN') continue;
      const key = type === 'CIS' ? 'cis' : 'uin';
      const expected = order.delivery.boxesLayout!.flatMap(b => b.items.filter(i => i.id === item.id).flatMap(i => (i.instances ?? []).map(m => key === 'cis' ? m.cisFull ?? m.cis : m.uin).filter((v): v is string => !!v)));
      const found = validated.items.find(i => i.id === item.id)?.[key] ?? [];
      if (found.length !== item.count || expected.some(v => !found.some(m => m.value === v && m.status === 'OK'))) throw new OrderPreconditionError('强制商品标记尚未全部通过平台验证，请稍后刷新核对');
    }
  }
  if (command.action === 'CANCEL' && !actions.cancelReasons.includes(command.cancelReason!)) throw new OrderPreconditionError('当前状态不允许此平台取消原因');
  if (command.action === 'TRACK' && !(await client.getDeliveryServices()).some(s => s.id === command.deliveryServiceId)) throw new OrderPreconditionError('配送服务ID不在平台目录，请刷新核对');
  const reservation = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`yandex-order:${ownerUserId}:${shop.id}:${nativeOrderId}`}, 0))`;
    const saved = await tx.yandexOfferPublishOperation.findUnique({ where });
    if (saved) { if (saved.requestHash !== requestHash) throw new Error('订单幂等键冲突'); return { replay: { id: saved.id, state: saved.state, replayed: true } }; }
    const currentShop = await tx.shop.findFirst({ where: { id: shop.id, userId: ownerUserId, platform: 'YANDEX', status: 'ACTIVE', clientId: shop.clientId, apiKeyEncrypted: shop.apiKeyEncrypted } });
    if (!currentShop) throw new OrderPreconditionError('Yandex 店铺凭据或状态已变化');
    const pending = await tx.yandexOfferPublishOperation.findFirst({ where: { ownerUserId, shopId: shop.id, state: { in: ['SUBMITTING', 'UNKNOWN'] }, requestPayload: { path: ['orderIds'], array_contains: [nativeOrderId] } }, select: { id: true } });
    if (pending) throw new OrderPreconditionError('此订单存在结果未确认的操作，请先核对原请求');
    return { row: await tx.yandexOfferPublishOperation.create({ data: { id: randomUUID(), ownerUserId, actorUserId, shopId: shop.id, sourceShopId: shop.id, businessId,
      idempotencyKey: command.idempotencyKey, requestHash, state: 'SUBMITTING', requestPayload: { kind: 'ORDER_MANAGEMENT', orderIds: [nativeOrderId], localOrderId: orderId, command, before: { status: order.status, substatus: order.substatus, programType: order.programType ?? null } } } }) };
  });
  if (reservation.replay) return reservation.replay;
  const id = reservation.row!.id;
  let state: 'SUCCEEDED' | 'REJECTED' | 'SUBMITTING' | 'UNKNOWN' = 'UNKNOWN';
  let response: unknown = null;
  try {
    if (command.action === 'PACK') { response = await client.setOrderBoxes(shop.clientId!, nativeOrderId, command.boxes!); state = layoutSignature((response as { boxes: NonNullable<YandexOrder['delivery']['boxesLayout']> }).boxes) === layoutSignature(command.boxes!) ? 'SUCCEEDED' : 'UNKNOWN'; }
    else if (command.action === 'TRACK') { response = await client.setOrderTrack(shop.clientId!, nativeOrderId, { trackCode: command.trackCode!, deliveryServiceId: command.deliveryServiceId! }); state = 'SUBMITTING'; }
    else { response = await client.updateOrderStatus(shop.clientId!, nativeOrderId, yandexOrderTarget(command.action, command.cancelReason)); state = 'SUBMITTING'; }
  } catch (e) {
    state = e instanceof YandexMarketApiError && (!e.dispatched || e.status >= 400 && e.status < 500 && ![408, 409, 420, 429].includes(e.status)) ? 'REJECTED' : 'UNKNOWN';
  }
  try { await prisma.yandexOfferPublishOperation.update({ where: { id }, data: { state, response: response as any, errorMessage: state === 'UNKNOWN' ? '平台结果未确认，请核对原请求' : null } }); }
  catch { return { id, state: 'UNKNOWN' as const, replayed: false }; }
  return { id, state, replayed: false };
}

/** Restore the exact unresolved native order command after browser/session loss. */
export async function readYandexPendingOrderCommand(input: Pick<Input, 'shop' | 'ownerUserId' | 'orderId'>) {
  if (input.shop.userId !== input.ownerUserId || input.shop.status !== 'ACTIVE') throw new OrderPreconditionError('Yandex 店铺不可用');
  const row = await prisma.yandexOfferPublishOperation.findFirst({
    where: { ownerUserId: input.ownerUserId, shopId: input.shop.id, state: { in: ['SUBMITTING', 'UNKNOWN'] },
      AND: [{ requestPayload: { path: ['kind'], equals: 'ORDER_MANAGEMENT' } }, { requestPayload: { path: ['localOrderId'], equals: input.orderId } }] },
    orderBy: { createdAt: 'desc' }, select: { requestPayload: true },
  });
  if (!row) return null;
  try { const payload = row.requestPayload as { kind?: unknown; localOrderId?: unknown; command?: unknown };
    if (payload.kind !== 'ORDER_MANAGEMENT' || payload.localOrderId !== input.orderId) return null;
    return yandexOrderCommand.parse(payload.command);
  } catch { return null; }
}
