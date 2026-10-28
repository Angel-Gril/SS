import { createHash } from 'node:crypto';
import { isOrderStockPrepared, resolveOrderFulfillmentStage, resolveOrderFulfillmentStatus, type OrderFulfillmentStageInput } from 'shared/order-fulfillment-stage';
import { decrypt } from '../lib/crypto.js';
import { OzonApiError, OzonClient, type OzonPosting } from './ozon-client.js';

type Log = { id: string; operationType?: string; note?: string | null; createdAt: Date };
type Queryable = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  order: { updateMany(args: unknown): Promise<{ count: number }> };
  warehouseLog: { findMany(args: unknown): Promise<Log[]>; create(args: unknown): Promise<Log> };
};
type Database = Queryable & { $transaction<T>(callback: (tx: Queryable) => Promise<T>): Promise<T> };
type StockOrderRow = OrderFulfillmentStageInput & {
  id: string; shopId: string; platform: string; shopStatus: string;
  clientId: string | null; apiKeyEncrypted: string; postingNumber: string | null; items: unknown;
};
type Input = { orderId: string; ownerUserId: string; actorUserId: string };
type Projection = { stage: ReturnType<typeof resolveOrderFulfillmentStage>['key']; status: ReturnType<typeof resolveOrderFulfillmentStatus> };
export type StockReadyResult =
  | { kind: 'not_found' }
  | { kind: 'immutable'; stage: Projection['stage'] }
  | { kind: 'rejected'; message: string }
  | ({ kind: 'pending'; id: string; message: string } & Projection)
  | ({ kind: 'marked'; id: string; stockPreparedAt: Date; replayed: boolean } & Projection);
type StockClient = Pick<OzonClient, 'getPostingByNumber' | 'shipPackage'>;
type Options = { createClient?: (order: StockOrderRow) => StockClient };
type Reservation = { kind: 'ozon'; order: StockOrderRow; dispatchId: string | null; send: boolean };
const DISPATCH = 'ozon_stock_ready_dispatch';
const REJECTED = 'ozon_stock_ready_rejected';
const CONFIRMED = 'ozon_stock_ready_confirmed';

async function loadLocked(tx: Queryable, input: Input): Promise<StockOrderRow | null> {
  const rows = await tx.$queryRaw<StockOrderRow[]>`
    SELECT o.id, o.shop_id AS "shopId", o.status, o.sub_status AS "subStatus",
      o.domestic_status AS "domesticStatus", o.international_status AS "internationalStatus",
      o.domestic_tracking_number AS "domesticTrackingNumber", o.international_tracking_number AS "internationalTrackingNumber",
      o.delivering_date AS "deliveringDate", o.delivered_at AS "deliveredAt", o.inspection_status AS "inspectionStatus",
      o.posting_number AS "postingNumber", o.items, s.platform, s.status AS "shopStatus",
      s.client_id AS "clientId", s.api_key_encrypted AS "apiKeyEncrypted"
    FROM "orders" o JOIN "shops" s ON s.id = o.shop_id
    WHERE o.id = ${input.orderId} AND s.user_id = ${input.ownerUserId} AND s.status <> 'DISABLED'
    FOR UPDATE OF o, s`;
  return rows[0] ?? null;
}
async function physicalFacts(tx: Queryable, orderId: string) {
  const logs = await tx.warehouseLog.findMany({
    where: { orderId, operationType: { in: ['scan_in', 'scan_out'] } }, orderBy: { createdAt: 'asc' },
    select: { operationType: true, createdAt: true },
  });
  return { warehouseScanInAt: logs.find(log => log.operationType === 'scan_in')?.createdAt ?? null,
    warehouseScanOutAt: logs.find(log => log.operationType === 'scan_out')?.createdAt ?? null };
}
const projection = (order: OrderFulfillmentStageInput): Projection => ({ stage: resolveOrderFulfillmentStage(order).key, status: resolveOrderFulfillmentStatus(order) });
function packagesFor(items: unknown) {
  if (!Array.isArray(items) || !items.length || items.length > 1000) return null;
  const products: { product_id: number; quantity: number }[] = [];
  const ids = new Set<number>();
  for (const item of items) {
    const product_id = Number(item?.product_id ?? item?.sku), quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(product_id) || product_id <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 10000 || ids.has(product_id)) return null;
    ids.add(product_id); products.push({ product_id, quantity });
  }
  return [{ products: products.sort((left, right) => left.product_id - right.product_id) }];
}
function validatedPosting(posting: OzonPosting, expected: string): OrderFulfillmentStageInput {
  if (posting?.posting_number !== expected || !/^[a-z_]{1,80}$/u.test(posting.status)
    || (posting.substatus != null && !/^[a-z_]{1,100}$/u.test(posting.substatus))) throw new Error('Invalid Ozon posting readback');
  return { status: posting.status, subStatus: posting.substatus || null };
}

/** Platform assembly and its audit/recovery belong here; routes never synthesize dispatch. */
export function createOrderStockReadyService(database: Database, options: Options = {}) {
  const createClient = options.createClient ?? (order => new OzonClient({ clientId: order.clientId!, apiKey: decrypt(order.apiKeyEncrypted) }));
  return {
    async mark(input: Input): Promise<StockReadyResult> {
      const reserved = await database.$transaction<StockReadyResult | Reservation>(async tx => {
        const order = await loadLocked(tx, input);
        if (!order) return { kind: 'not_found' };
        if (order.platform === 'YANDEX') return { kind: 'rejected', message: 'Yandex 订单当前只读同步，请在平台处理备货后重新同步' };
        const physical = await physicalFacts(tx, order.id);
        const current = projection({ ...order, ...physical });
        const logs = await tx.warehouseLog.findMany({ where: { orderId: order.id,
          operationType: { in: ['stock_ready', DISPATCH, REJECTED, CONFIRMED] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        if (order.platform !== 'OZON') {
          const existing = (await tx.warehouseLog.findMany({ where: { orderId: order.id, operationType: 'stock_ready' }, orderBy: { createdAt: 'asc' } }))[0];
          if (existing) return { kind: 'marked', id: order.id, stockPreparedAt: existing.createdAt, replayed: true, ...projection({ ...order, ...physical, stockPreparedAt: existing.createdAt }) };
          if (['abnormal', 'warehouse_processing', 'delivering'].includes(current.stage)) return { kind: 'immutable', stage: current.stage };
          const created = await tx.warehouseLog.create({ data: { orderId: order.id, operationType: 'stock_ready', operatorId: input.actorUserId, note: '用户确认已备货' }, select: { createdAt: true } });
          return { kind: 'marked', id: order.id, stockPreparedAt: created.createdAt, replayed: false, ...projection({ ...order, stockPreparedAt: created.createdAt }) };
        }
        if (['abnormal', 'warehouse_processing', 'delivering'].includes(current.stage)) return { kind: 'immutable', stage: current.stage };
        if (order.shopStatus !== 'ACTIVE' || !order.postingNumber || !order.clientId || !order.apiKeyEncrypted) return { kind: 'rejected', message: '请先确认 Ozon 店铺连接和订单编号有效' };
        const lastDispatch = logs.find(log => log.operationType === DISPATCH);
        const unresolved = lastDispatch && !logs.some(log => log.operationType === REJECTED && log.note === lastDispatch.id);
        if (unresolved || isOrderStockPrepared(order)) return { kind: 'ozon', order, dispatchId: unresolved ? lastDispatch.id : null, send: false };
        const packages = packagesFor(order.items);
        if (!packages) return { kind: 'rejected', message: '订单商品或数量不完整，请先同步 Ozon 订单' };
        const dispatch = await tx.warehouseLog.create({ data: { orderId: order.id, operationType: DISPATCH, operatorId: input.actorUserId,
          note: createHash('sha256').update(JSON.stringify({ posting_number: order.postingNumber, packages })).digest('hex') } });
        return { kind: 'ozon', order, dispatchId: dispatch.id, send: true };
      });
      if (reserved.kind !== 'ozon') return reserved;
      const { order, dispatchId } = reserved;
      const pending = (message = 'Ozon 备货结果待确认，请同步订单或再次点击查询；系统不会重复提交') => ({ kind: 'pending' as const, id: order.id, message, ...projection(order) });
      const rejectDispatch = async (message: string): Promise<StockReadyResult> => {
        await database.$transaction(async tx => {
          const current = await loadLocked(tx, input);
          if (!current || current.postingNumber !== order.postingNumber || current.shopId !== order.shopId) return;
          if (dispatchId) await tx.warehouseLog.create({ data: { orderId: order.id, operationType: REJECTED, operatorId: input.actorUserId, note: dispatchId } });
        });
        return { kind: 'rejected', message };
      };
      const persist = async (posting: OzonPosting): Promise<StockReadyResult> => {
        const fields = validatedPosting(posting, order.postingNumber!);
        return database.$transaction(async tx => {
          const current = await loadLocked(tx, input);
          if (!current || current.shopId !== order.shopId || current.postingNumber !== order.postingNumber) return { kind: 'not_found' } as const;
          const physical = await physicalFacts(tx, order.id);
          const currentStage = projection({ ...current, ...physical });
          if (['abnormal', 'delivering'].includes(currentStage.stage)) return { kind: 'immutable', stage: currentStage.stage } as const;
          const stage = projection({ ...current, ...fields, ...physical });
          if (isOrderStockPrepared(current) && !isOrderStockPrepared(fields) && !['abnormal', 'delivering'].includes(stage.stage)) return { ...pending('Ozon 回读落后于最新订单状态，请刷新核对'), ...currentStage };
          const saved = await tx.order.updateMany({ where: { id: order.id, shopId: order.shopId }, data: fields });
          if (saved.count !== 1) return { kind: 'not_found' } as const;
          if (['abnormal', 'warehouse_processing', 'delivering'].includes(stage.stage)) return { kind: 'immutable', stage: stage.stage } as const;
          if (!isOrderStockPrepared(fields)) return { ...pending(), ...stage };
          const markers = await tx.warehouseLog.findMany({ where: { orderId: order.id, operationType: 'stock_ready' }, orderBy: { createdAt: 'asc' } });
          const marker = markers[0] ?? await tx.warehouseLog.create({ data: { orderId: order.id, operationType: 'stock_ready', operatorId: input.actorUserId, note: 'Ozon 回读确认已备货' } });
          const confirmations = await tx.warehouseLog.findMany({ where: { orderId: order.id, operationType: CONFIRMED } });
          if (!confirmations.some(log => log.note === (dispatchId ?? 'seller-portal'))) await tx.warehouseLog.create({ data: { orderId: order.id, operationType: CONFIRMED, operatorId: input.actorUserId, note: dispatchId ?? 'seller-portal' } });
          return { kind: 'marked', id: order.id, stockPreparedAt: marker.createdAt, replayed: Boolean(markers[0]), ...stage } as const;
        });
      };
      let client: StockClient;
      let before: OzonPosting;
      try { client = createClient(order); before = await client.getPostingByNumber(order.postingNumber!); validatedPosting(before, order.postingNumber!); }
      catch { return reserved.send ? rejectDispatch('Ozon 状态读取失败，尚未提交备货，请稍后重试') : pending(); }
      const beforeStage = projection({ ...order, status: before.status, subStatus: before.substatus });
      if (isOrderStockPrepared({ status: before.status, subStatus: before.substatus }) || ['abnormal', 'delivering'].includes(beforeStage.stage)) return persist(before);
      if (!reserved.send) {
        const result = await persist(before);
        return before.substatus === 'ship_failed' && result.kind === 'pending'
          ? rejectDispatch('Ozon 明确返回备货失败，请核对后重试') : result;
      }
      if (before.status !== 'awaiting_packaging') return rejectDispatch('Ozon 当前状态不允许备货，请先同步订单');
      const packages = packagesFor(order.items);
      if (!packages) return rejectDispatch('Ozon 商品或数量不完整，尚未提交备货');
      if (before.products && JSON.stringify(packagesFor(before.products)) !== JSON.stringify(packages)) return rejectDispatch('Ozon 商品或数量已变化，请同步订单后重新确认备货');
      const dispatchGate = await database.$transaction<StockReadyResult | null>(async tx => {
        const current = await loadLocked(tx, input);
        if (!current || current.shopId !== order.shopId || current.postingNumber !== order.postingNumber || current.shopStatus !== 'ACTIVE') return { kind: 'not_found' };
        const stage = projection({ ...current, ...await physicalFacts(tx, order.id) });
        if (['abnormal', 'warehouse_processing', 'delivering'].includes(stage.stage)) return { kind: 'immutable', stage: stage.stage };
        if (isOrderStockPrepared(current) || JSON.stringify(packagesFor(current.items)) !== JSON.stringify(packages)
          || current.apiKeyEncrypted !== order.apiKeyEncrypted || current.clientId !== order.clientId) return pending('订单或店铺连接已变化，请同步后核对');
        return null;
      });
      if (dispatchGate) return dispatchGate;
      let definiteRejection = false;
      try { await client.shipPackage({ posting_number: order.postingNumber!, packages }); }
      catch (error) { definiteRejection = error instanceof OzonApiError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status); }
      let after: OzonPosting;
      try { after = await client.getPostingByNumber(order.postingNumber!); validatedPosting(after, order.postingNumber!); }
      catch { return definiteRejection ? rejectDispatch('Ozon 拒绝备货，请核对商品、标记信息和店铺权限') : pending(); }
      const result = await persist(after);
      if (result.kind !== 'pending') return result;
      if (after.substatus === 'ship_failed' || definiteRejection) return rejectDispatch('Ozon 备货失败，请核对商品、数量及平台要求后重试');
      return result;
    },
  };
}
export type OrderStockReadyService = ReturnType<typeof createOrderStockReadyService>;
