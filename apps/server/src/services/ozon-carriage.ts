import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { decrypt } from '../lib/crypto.js';
import { OzonApiError, OzonClient } from './ozon-client.js';

const id = z.union([z.string().regex(/^[1-9]\d{0,15}$/u), z.number().int().positive().safe()])
  .transform(String).refine(value => Number.isSafeInteger(Number(value)), '平台 ID 超出安全范围');
const key = z.string().regex(/^[a-zA-Z0-9_-]{12,100}$/u);
// Interactive readback is bounded more narrowly than Ozon's 300-item bulk ceiling.
const postings = z.array(z.string().trim().min(1).max(100)).min(1).max(30)
  .refine(values => new Set(values).size === values.length, '不能重复扫码同一订单')
  .transform(values => values.slice().sort());
const oneContainer = { containerId: id, idempotencyKey: key };
export const carriageCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), cargoType: z.enum(['box', 'pallet']), sortType: z.enum(['sort', 'non-sort']), count: z.number().int().min(1).max(100), idempotencyKey: key }).strict(),
  z.object({ kind: z.literal('fill'), ...oneContainer, postingNumbers: postings }).strict(),
  z.object({ kind: z.literal('remove'), ...oneContainer, postingNumbers: postings }).strict(),
  z.object({ kind: z.literal('approve'), ...oneContainer }).strict(),
  z.object({ kind: z.literal('cancel'), ...oneContainer }).strict(),
  z.object({ kind: z.literal('place'), ...oneContainer, childContainerId: id }).strict(),
  z.object({ kind: z.literal('unplace'), ...oneContainer, childContainerId: id }).strict(),
]);
export type CarriageCommand = z.infer<typeof carriageCommandSchema>;
export type CarriageScope = { ownerUserId: string; actorUserId: string; shopId: string; warehouseId: string };
type Database = Pick<PrismaClient, 'shop' | 'warehouse' | 'order' | 'ozonCarriageOperation'>;
type Client = Pick<OzonClient, 'request' | 'getPostingByNumber'>;
type Options = { createClient?: (shop: { clientId: string | null; apiKeyEncrypted: string }) => Client };
const actionFor = { fill: 'place_posting_into_container', remove: 'remove_posting_from_container', approve: 'approve', cancel: 'delete', place: 'place_box_into_pallet', unplace: 'remove_box_from_pallet' } as const;
const terminal = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CLOSED_UNKNOWN']);
const credentialHash = (shop: { clientId: string | null; apiKeyEncrypted: string }) => createHash('sha256').update(JSON.stringify([shop.clientId, shop.apiKeyEncrypted])).digest('hex');
const containerSchema = z.object({
  container_id: id, warehouse_id: id, status: z.string().min(1).max(100), cargo_type: z.string().max(40), sort_type: z.string().max(40),
  available_actions: z.array(z.string().max(100)).max(50),
  postings: z.array(z.object({ posting_number: z.string().min(1).max(100), available_actions: z.array(z.string().max(100)).optional() })).max(10000).default([]),
  parent_container_id: z.preprocess(value => value === 0 || value === '0' ? null : value, id.nullish()), related_container_ids: z.array(id).max(1000).optional(),
  count_of_postings: z.number().int().nonnegative().optional(), weight: z.number().nonnegative().optional(),
  created_at: z.string().max(80).optional(),
});
export type CarriageContainer = z.infer<typeof containerSchema>;
const resultSchema = z.object({ task_id: id.optional(),
  error_postings: z.array(z.object({ posting_number: z.string().max(100), error_message: z.string().max(1000) })).max(300).optional(),
  error_containers: z.array(z.object({ container_id: id, error_message: z.string().max(1000) })).max(300).optional(),
});
const hasErrors = (result: z.infer<typeof resultSchema>) => Boolean(result.error_postings?.length || result.error_containers?.length);
function rejectedCount(command: Exclude<CarriageCommand, { kind: 'create' }>, receipt: z.infer<typeof resultSchema>) {
  if (command.kind === 'fill' || command.kind === 'remove') {
    const errors = receipt.error_postings ?? [];
    if (receipt.error_containers?.length || errors.some(e => !command.postingNumbers.includes(e.posting_number)) || new Set(errors.map(e => e.posting_number)).size !== errors.length) throw new Error('Unexpected posting error target');
    return { rejected: errors.length, total: command.postingNumbers.length };
  }
  const target = 'childContainerId' in command ? command.childContainerId : command.containerId;
  const errors = receipt.error_containers ?? [];
  if (receipt.error_postings?.length || errors.length > 1 || errors.some(e => e.container_id !== target)) throw new Error('Unexpected container error target');
  return { rejected: errors.length, total: 1 };
}

export class CarriageError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message); }
}

/** Platform content is base64 bytes, never a URL to proxy with shop credentials. */
export function decodeCarriagePdf(value: unknown, kind: 'label' | 'document') {
  const response = z.object({ content: z.unknown().optional(), error_containers: z.array(z.unknown()).max(300).optional() }).passthrough().parse(value);
  if (response.error_containers?.length) throw new CarriageError('部分货位无法生成货签，请先核对平台错误');
  const file = z.object({ content_type: z.string(), file_content: z.string().min(1).max(28_000_000) }).parse(kind === 'label' ? response.content : response);
  if (!['application/pdf', 'application', 'pdf'].includes(file.content_type.toLowerCase())
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.file_content)) throw new CarriageError('平台文件不是有效 PDF');
  const buffer = Buffer.from(file.file_content, 'base64');
  if (buffer.length > 20 * 1024 * 1024 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new CarriageError('平台文件不是有效 PDF 或超过大小限制');
  return { buffer, contentType: 'application/pdf' };
}

/** Owns authorization, command reservation and read-only reconciliation; UI never owns platform state. */
export function createOzonCarriageService(database: Database, options: Options = {}) {
  const createClient = options.createClient ?? (shop => new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted), timeoutMs: 8_000, maxRetries: 0 }));
  async function transition(row: { id: string; status: string; updatedAt: Date }, data: Prisma.OzonCarriageOperationUpdateManyMutationInput) {
    await database.ozonCarriageOperation.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt }, data });
    return database.ozonCarriageOperation.findUniqueOrThrow({ where: { id: row.id } });
  }
  async function context(scope: CarriageScope) {
    const shop = await database.shop.findFirst({ where: { id: scope.shopId, userId: scope.ownerUserId, platform: 'OZON', status: 'ACTIVE' } });
    if (!shop?.clientId || shop.platform !== 'OZON' || shop.status !== 'ACTIVE') throw new CarriageError('未找到可操作的店铺', 404);
    const warehouse = await database.warehouse.findFirst({ where: { id: scope.warehouseId, shopId: shop.id } });
    if (!warehouse || !id.safeParse(warehouse.platformWarehouseId).success) throw new CarriageError('未找到有效的店铺仓库', 404);
    return { shop, warehouse, client: createClient(shop), platformWarehouseId: String(warehouse.platformWarehouseId) };
  }
  async function getContainer(ctx: Awaited<ReturnType<typeof context>>, containerId: string) {
    const c = containerSchema.parse(await ctx.client.request('/v1/carriage/container/get', { maxResponseBytes: 4_000_000, body: { container_id: Number(id.parse(containerId)) } }));
    if (c.container_id !== containerId || c.warehouse_id !== ctx.platformWarehouseId) throw new CarriageError('货位不属于当前仓库');
    return c;
  }
  async function validate(ctx: Awaited<ReturnType<typeof context>>, command: CarriageCommand) {
    if (command.kind === 'create') return;
    const container = await getContainer(ctx, command.containerId);
    if (!container.available_actions.includes(actionFor[command.kind])) throw new CarriageError('Ozon 当前不允许此操作，请刷新货位状态');
    if (command.kind === 'fill' || command.kind === 'remove') {
      const orders = await database.order.findMany({ where: { shopId: ctx.shop.id, postingNumber: { in: command.postingNumbers } }, select: { postingNumber: true } });
      if (orders.length !== command.postingNumbers.length || new Set(orders.map(o => o.postingNumber)).size !== orders.length) throw new CarriageError('订单未同步或不属于当前店铺');
      for (const postingNumber of command.postingNumbers) {
        const member = container.postings.find(p => p.posting_number === postingNumber);
        if (command.kind === 'fill' && member) throw new CarriageError('订单已在当前货位中');
        if (command.kind === 'remove' && !member) throw new CarriageError('订单不在当前货位中');
      }
      if (command.kind === 'fill') for (let offset = 0; offset < command.postingNumbers.length; offset += 5) {
        await Promise.all(command.postingNumbers.slice(offset, offset + 5).map(async postingNumber => {
          const posting = await ctx.client.getPostingByNumber(postingNumber);
          if (posting.posting_number !== postingNumber || String(posting.delivery_method?.warehouse_id) !== ctx.platformWarehouseId) throw new CarriageError('订单不属于当前仓库');
          if (posting.status !== 'awaiting_deliver') throw new CarriageError('订单尚未完成 Ozon 备货或已进入交运，请先同步核对');
        }));
      }
    }
    if (command.kind === 'place' || command.kind === 'unplace') {
      if (command.childContainerId === command.containerId) throw new CarriageError('不能将货位放入自身');
      const child = await getContainer(ctx, command.childContainerId);
      if (container.cargo_type !== 'pallet' || child.cargo_type !== 'box' || child.sort_type !== container.sort_type) throw new CarriageError('请选择同仓库、同分拣类型的箱子和托盘');
      if (command.kind === 'place' && child.parent_container_id) throw new CarriageError('箱子已在托盘中');
      if (command.kind === 'unplace' && child.parent_container_id !== container.container_id) throw new CarriageError('箱子不在当前托盘中');
    }
  }
  async function dispatch(ctx: Awaited<ReturnType<typeof context>>, command: CarriageCommand) {
    const client = ctx.client;
    switch (command.kind) {
      case 'create': return client.request('/v1/carriage/container/create', { skipRetry: true, maxResponseBytes: 1_000_000, body: { warehouse_id: Number(ctx.platformWarehouseId), cargo_type: command.cargoType, sort_type: command.sortType, containers_count: command.count } });
      case 'fill': return client.request('/v1/carriage/container/fill', { skipRetry: true, maxResponseBytes: 1_000_000, body: { container_id: Number(command.containerId), posting_numbers: command.postingNumbers } });
      case 'remove': return client.request('/v1/carriage/container/remove-postings', { skipRetry: true, maxResponseBytes: 1_000_000, body: { container_id: Number(command.containerId), posting_numbers: command.postingNumbers } });
      case 'approve': return client.request('/v1/carriage/container/approve', { skipRetry: true, maxResponseBytes: 1_000_000, body: { container_ids: [command.containerId] } });
      case 'cancel': return client.request('/v1/carriage/container/cancel', { skipRetry: true, maxResponseBytes: 1_000_000, body: { container_ids: [command.containerId] } });
      case 'place': return client.request('/v1/carriage/container/place-into', { skipRetry: true, maxResponseBytes: 1_000_000, body: { parent_container_id: Number(command.containerId), child_container_ids: [command.childContainerId] } });
      case 'unplace': return client.request('/v1/carriage/container/remove-from', { skipRetry: true, maxResponseBytes: 1_000_000, body: { parent_container_id: Number(command.containerId), child_container_ids: [command.childContainerId] } });
    }
  }
  return {
    async operations(scope: CarriageScope) {
      await context(scope);
      return database.ozonCarriageOperation.findMany({ where: { shopId: scope.shopId, warehouseId: scope.warehouseId }, orderBy: { createdAt: 'desc' }, take: 50 });
    },
    async list(scope: CarriageScope, query: { sortType: 'sort' | 'non-sort'; from: string; to: string; cursor?: string }) {
      const ctx = await context(scope);
      const filter = z.object({ sortType: z.enum(['sort', 'non-sort']), from: z.string().datetime(), to: z.string().datetime(), cursor: z.string().max(1000).optional() }).strict().parse(query);
      if (Date.parse(filter.to) < Date.parse(filter.from) || Date.parse(filter.to) - Date.parse(filter.from) > 31 * 86400_000) throw new CarriageError('查询时间范围最多31天', 400);
      const response = z.object({ containers: z.array(containerSchema.omit({ postings: true })).max(300), cursor: z.string().max(1000).optional() }).parse(await ctx.client.request('/v1/carriage/container/list', { maxResponseBytes: 4_000_000, body: {
        filter: { warehouse_id: Number(ctx.platformWarehouseId), sort_type: filter.sortType, created_from: filter.from, created_to: filter.to }, limit: 100, sort_dir: 'DESC', ...(filter.cursor ? { cursor: filter.cursor } : {}),
      } }));
      if (response.containers.some(c => c.warehouse_id !== ctx.platformWarehouseId)) throw new CarriageError('平台列表包含不匹配的仓库');
      return { ...response, operations: await database.ozonCarriageOperation.findMany({ where: { shopId: scope.shopId, warehouseId: scope.warehouseId }, orderBy: { createdAt: 'desc' }, take: 50 }) };
    },
    async get(scope: CarriageScope, containerId: string) { return getContainer(await context(scope), id.parse(containerId)); },
    async submit(scope: CarriageScope, value: unknown) {
      const command = carriageCommandSchema.parse(value), ctx = await context(scope);
      const requestHash = createHash('sha256').update(JSON.stringify({ warehouseId: scope.warehouseId, command })).digest('hex');
      const replay = await database.ozonCarriageOperation.findUnique({ where: { shopId_idempotencyKey: { shopId: scope.shopId, idempotencyKey: command.idempotencyKey } } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new CarriageError('幂等键已用于不同请求');
        return replay;
      }
      await validate(ctx, command);
      let reserved;
      try {
        reserved = { ...await database.ozonCarriageOperation.create({ data: { shopId: ctx.shop.id, warehouseId: ctx.warehouse.id, actorUserId: scope.actorUserId,
          idempotencyKey: command.idempotencyKey, requestHash, credentialHash: credentialHash(ctx.shop), command, kind: command.kind, status: 'DISPATCHING', activeScope: ctx.warehouse.id } }) };
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        const existing = await database.ozonCarriageOperation.findUnique({ where: { shopId_idempotencyKey: { shopId: scope.shopId, idempotencyKey: command.idempotencyKey } } });
        if (existing?.requestHash === requestHash) return existing;
        throw new CarriageError('仓库有未完成的组包操作，请先刷新并恢复原操作');
      }
      let result: Prisma.InputJsonValue | undefined, taskId: string | undefined, status: string;
      try {
        // Credential/ownership may have changed during scan validation; check again before dispatch.
        const fresh = await context(scope);
        if (fresh.shop.clientId !== ctx.shop.clientId || fresh.shop.apiKeyEncrypted !== ctx.shop.apiKeyEncrypted || fresh.platformWarehouseId !== ctx.platformWarehouseId) throw new CarriageError('店铺凭据或仓库已变化，请重新检查');
      } catch {
        return transition(reserved, { status: 'FAILED', activeScope: null, message: '发送前店铺或仓库已变化，未提交平台' });
      }
      try {
        const raw = await dispatch(ctx, command);
        if (command.kind === 'create') {
          const receipt = z.object({ container_ids: z.array(id).min(1).max(100) }).parse(raw);
          result = receipt;
          if (receipt.container_ids.length !== command.count || new Set(receipt.container_ids).size !== command.count) throw new Error('Invalid container count');
          result = receipt; status = 'SUCCEEDED';
        } else {
          const receipt = resultSchema.parse(raw);
          result = receipt;
          const rejected = rejectedCount(command, receipt);
          if (!receipt.task_id) {
            if (!hasErrors(receipt)) throw new Error('Missing asynchronous task ID');
            const allRejected = rejected.rejected === rejected.total;
            if (!allRejected) throw new Error('Incomplete asynchronous receipt');
            status = 'FAILED';
          } else { status = 'PENDING'; taskId = receipt.task_id; }
          result = receipt;
        }
      } catch (error) {
        const definite = error instanceof OzonApiError && error.status >= 400 && error.status < 500 && ![408, 409, 425, 429].includes(error.status);
        return transition(reserved, { status: definite ? 'FAILED' : 'UNKNOWN', activeScope: definite ? null : reserved.activeScope,
          ...(result ? { result } : {}),
          message: definite ? 'Ozon 拒绝了请求，请核对 API Key 权限及仓库业务准入' : '平台处理结果未知。请核对原操作，不要重复提交。' });
      }
      // Database failure here must propagate: DISPATCHING stays locked and cannot resend.
      return transition(reserved, { status, result, ...(taskId ? { taskId } : {}), activeScope: terminal.has(status) ? null : reserved.activeScope, message: null });
    },
    async recover(scope: CarriageScope, operationId: string) {
      const ctx = await context(scope), loaded = await database.ozonCarriageOperation.findUnique({ where: { id: operationId } });
      if (!loaded || loaded.shopId !== scope.shopId || loaded.warehouseId !== scope.warehouseId) throw new CarriageError('操作记录不存在', 404);
      const row = { ...loaded };
      if (terminal.has(row.status)) return row;
      if (row.credentialHash !== credentialHash(ctx.shop)) throw new CarriageError('店铺凭据已变化，不能用新凭据核对旧平台任务');
      const command = carriageCommandSchema.parse(row.command);
      if (!row.taskId) return row; // No provider correlation: do not infer rejection or match a newly found box.
      const task = z.object({ status: z.enum(['pending', 'in_progress', 'completed', 'failed']), error_message: z.string().max(1000).optional() }).parse(await ctx.client.request('/v1/carriage/container/task/info', { maxResponseBytes: 64_000, body: { task_id: Number(id.parse(row.taskId)) } }));
      if (task.status === 'pending' || task.status === 'in_progress') return row;
      const receipt = resultSchema.parse(row.result);
      if (task.status === 'failed') return transition(row, { status: 'FAILED', activeScope: null, result: { ...receipt, task }, message: 'Ozon 异步操作失败，请核对货位后重新操作' });
      if (command.kind === 'create') throw new CarriageError('建箱任务合同不匹配');
      const rejected = rejectedCount(command, receipt);
      const container = await getContainer(ctx, command.containerId);
      let confirmed = true;
      if (command.kind === 'fill' || command.kind === 'remove') {
        const rejected = new Set(receipt.error_postings?.map(e => e.posting_number) ?? []);
        confirmed = command.postingNumbers.filter(p => !rejected.has(p)).every(p => container.postings.some(c => c.posting_number === p) === (command.kind === 'fill'));
      } else if (command.kind === 'approve') confirmed = hasErrors(receipt) || ['formed', 'approved', 'acceptance_in_progress', 'finished', 'added'].includes(container.status);
      else if (command.kind === 'cancel') confirmed = hasErrors(receipt) || container.status === 'cancelled';
      else {
        const child = await getContainer(ctx, command.childContainerId);
        confirmed = hasErrors(receipt) || (child.parent_container_id === container.container_id) === (command.kind === 'place');
      }
      if (!confirmed) return row;
      const status = rejected.rejected === rejected.total ? 'FAILED' : rejected.rejected > 0 ? 'PARTIAL' : 'SUCCEEDED';
      return transition(row, { status, activeScope: null, result: { ...receipt, task }, message: status === 'FAILED' ? '平台拒绝了全部条目，请查看明细' : status === 'PARTIAL' ? '部分条目失败，请查看明细' : null });
    },
    async closeUnknown(scope: CarriageScope, operationId: string, input: unknown) {
      const resolution = z.object({ acknowledged: z.literal(true), note: z.string().trim().min(10).max(1000) }).strict().parse(input);
      const ctx = await context(scope), row = await database.ozonCarriageOperation.findUnique({ where: { id: operationId } });
      if (!row || row.shopId !== scope.shopId || row.warehouseId !== scope.warehouseId) throw new CarriageError('操作记录不存在', 404);
      if (row.status === 'CLOSED_UNKNOWN') return row;
      const staleDispatch = row.status === 'DISPATCHING' && Date.now() - row.createdAt.getTime() >= 10 * 60_000;
      const rotatedPending = row.status === 'PENDING' && row.credentialHash !== credentialHash(ctx.shop);
      if (row.status !== 'UNKNOWN' && !staleDispatch && !rotatedPending) throw new CarriageError('当前操作仍可正常核对，或尚在提交中，不能关闭跟踪');
      await database.ozonCarriageOperation.updateMany({ where: { id: row.id, status: row.status, updatedAt: row.updatedAt }, data: {
        status: 'CLOSED_UNKNOWN', activeScope: null, resolvedBy: scope.actorUserId, resolvedAt: new Date(), resolutionNote: resolution.note,
        message: '人工核对后关闭跟踪，平台结果仍未自动确认；未取消或重发原请求。',
      } });
      return database.ozonCarriageOperation.findUniqueOrThrow({ where: { id: row.id } });
    },
    async pdf(scope: CarriageScope, containerId: string, kind: 'label' | 'document') {
      const ctx = await context(scope), container = await getContainer(ctx, id.parse(containerId));
      if (!container.available_actions.includes(kind === 'label' ? 'get_label_container' : 'get_documents')) throw new CarriageError('Ozon 当前不允许下载该文件');
      const result = kind === 'label'
        ? await ctx.client.request('/v1/carriage/container/label/get', { skipRetry: true, maxResponseBytes: 28_000_000, body: { container_ids: [container.container_id] } })
        : await ctx.client.request('/v1/carriage/container/document/get', { skipRetry: true, maxResponseBytes: 28_000_000, body: { container_ids: [container.container_id] } });
      return decodeCarriagePdf(result, kind);
    },
  };
}
