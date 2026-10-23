import { describe, expect, it, vi } from 'vitest';
import { createOzonCarriageService, decodeCarriagePdf } from '../services/ozon-carriage.js';
import { OzonApiError } from '../services/ozon-client.js';

function fixture() {
  const rows: any[] = [];
  const shop = { id: 'shop-1', userId: 'owner', status: 'ACTIVE', platform: 'OZON', clientId: 'fixture', apiKeyEncrypted: 'fixture' };
  const warehouse = { id: 'wh-1', shopId: shop.id, platformWarehouseId: '100', name: '仓库' };
  const container: any = { container_id: 20, warehouse_id: 100, status: 'new', cargo_type: 'box', sort_type: 'sort',
    available_actions: ['approve', 'delete', 'place_posting_into_container', 'remove_posting_from_container', 'get_label_container', 'get_documents'], postings: [] };
  const op: any = {
    findUnique: vi.fn(async ({ where }: any) => rows.find(row => where.id ? row.id === where.id
      : row.shopId === where.shopId_idempotencyKey.shopId && row.idempotencyKey === where.shopId_idempotencyKey.idempotencyKey) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => { const row = rows.find(row => row.id === where.id); if (!row) throw new Error('missing'); return row; }),
    findMany: vi.fn(async () => rows.slice().reverse()),
    create: vi.fn(async ({ data }: any) => {
      if (rows.some(row => row.activeScope && row.activeScope === data.activeScope)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      const row = { ...data, id: `op-${rows.length}`, createdAt: new Date(), updatedAt: new Date() }; rows.push(row); return row;
    }),
    update: vi.fn(async ({ where, data }: any) => { const row = rows.find(row => row.id === where.id); Object.assign(row, data); return row; }),
    updateMany: vi.fn(async ({ where, data }: any) => { const row = rows.find(row => row.id === where.id && row.status === where.status); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
  };
  const db: any = { shop: { findFirst: vi.fn(async ({ where }: any) => where.id === shop.id && where.userId === shop.userId && shop.status === 'ACTIVE' ? shop : null) },
    warehouse: { findFirst: vi.fn(async ({ where }: any) => where.id === warehouse.id && where.shopId === shop.id ? warehouse : null) },
    order: { findMany: vi.fn(async () => [{ postingNumber: 'posting-1' }]) }, ozonCarriageOperation: op };
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/get')) return { ...container, postings: [...container.postings] };
    if (path.endsWith('/create')) return { container_ids: ['20'] };
    if (path.endsWith('/info')) return { status: 'completed' };
    return { task_id: 30, error_postings: [], error_containers: [] };
  });
  const client: any = { request, getPostingByNumber: vi.fn(async () => ({ posting_number: 'posting-1', status: 'awaiting_deliver', delivery_method: { warehouse_id: 100 } })) };
  const service = createOzonCarriageService(db, { createClient: () => client });
  const scope = { ownerUserId: 'owner', actorUserId: 'actor', shopId: shop.id, warehouseId: warehouse.id };
  const command = { kind: 'create', cargoType: 'box', sortType: 'sort', count: 1, idempotencyKey: 'fixture-key-001' } as const;
  return { service, scope, command, request, client, db, rows, shop, container };
}

describe('Ozon carriage command owner', () => {
  it('creates once, preserves receipt and replays only the identical command', async () => {
    const f = fixture();
    expect(await f.service.submit(f.scope, f.command)).toMatchObject({ status: 'SUCCEEDED' });
    await f.service.submit(f.scope, f.command);
    expect(f.request.mock.calls.filter(([p]) => p.endsWith('/create'))).toHaveLength(1);
    expect(f.request).toHaveBeenCalledWith('/v1/carriage/container/create', expect.objectContaining({ skipRetry: true,
      body: { warehouse_id: 100, cargo_type: 'box', sort_type: 'sort', containers_count: 1 } }));
    await expect(f.service.submit(f.scope, { ...f.command, count: 2 })).rejects.toThrow('幂等');
  });
  it('rejects foreign ownership, disabled shop, invalid counts and unknown command fields before dispatch', async () => {
    const f = fixture();
    await expect(f.service.submit({ ...f.scope, ownerUserId: 'other' }, f.command)).rejects.toThrow();
    await expect(f.service.submit(f.scope, { ...f.command, count: 101 })).rejects.toThrow();
    await expect(f.service.submit(f.scope, { ...f.command, warehouse_id: 888 })).rejects.toThrow();
    f.shop.status = 'DISABLED';
    await expect(f.service.submit(f.scope, f.command)).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it('keeps unknown writes locked across replay and new request keys', async () => {
    const f = fixture(); f.request.mockRejectedValue(new Error('network failed'));
    expect(await f.service.submit(f.scope, f.command)).toMatchObject({ status: 'UNKNOWN' });
    expect(await f.service.submit(f.scope, f.command)).toMatchObject({ status: 'UNKNOWN' });
    await expect(f.service.submit(f.scope, { ...f.command, idempotencyKey: 'fixture-key-002' })).rejects.toThrow('未完成');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('preserves recognized platform receipts when a partial create or missing task is unknown', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({ container_ids: ['20'] });
    expect(await f.service.submit(f.scope, { ...f.command, count: 2 })).toMatchObject({ status: 'UNKNOWN', result: { container_ids: ['20'] } });
  });
  it('marks only a definite platform 4xx rejection failed, retaining sanitized error', async () => {
    const f = fixture(); f.request.mockRejectedValue(new OzonApiError(403, '{"message":"no permission"}', '/v1/carriage/container/create'));
    expect(await f.service.submit(f.scope, f.command)).toMatchObject({ status: 'FAILED', activeScope: null });
  });
  it('validates platform actions, warehouse and live posting readiness before filling', async () => {
    const f = fixture();
    f.container.warehouse_id = 999;
    const fill = { kind: 'fill', containerId: '20', postingNumbers: ['posting-1'], idempotencyKey: 'fill-fixture-001' };
    await expect(f.service.submit(f.scope, fill)).rejects.toThrow('仓库');
    f.container.warehouse_id = 100; f.container.available_actions = [];
    await expect(f.service.submit(f.scope, fill)).rejects.toThrow('允许');
    f.container.available_actions = ['place_posting_into_container'];
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_packaging', delivery_method: { warehouse_id: 100 } });
    await expect(f.service.submit(f.scope, fill)).rejects.toThrow('备货');
    expect(f.request.mock.calls.some(([p]) => p.endsWith('/fill'))).toBe(false);
  });
  it('records item-level errors and reconciles a known task without repeating fill', async () => {
    const f = fixture();
    f.request.mockImplementation(async (path: string) => path.endsWith('/get') ? f.container : path.endsWith('/info')
      ? { status: 'completed' } : { task_id: 30, error_postings: [{ posting_number: 'posting-1', error_message: 'rejected' }] });
    const row = await f.service.submit(f.scope, { kind: 'fill', containerId: '20', postingNumbers: ['posting-1'], idempotencyKey: 'fill-fixture-001' });
    expect(row.status).toBe('PENDING');
    expect(await f.service.recover(f.scope, row.id)).toMatchObject({ status: 'FAILED', activeScope: null });
    expect(f.request.mock.calls.filter(([p]) => p.endsWith('/fill'))).toHaveLength(1);
    expect(f.rows[0].result.error_postings).toHaveLength(1);
  });
  it('reports a real mixed batch as partial only after accepted postings read back in the container', async () => {
    const f = fixture();
    f.db.order.findMany.mockResolvedValue([{ postingNumber: 'posting-1' }, { postingNumber: 'posting-2' }]);
    f.client.getPostingByNumber.mockImplementation(async (p: string) => ({ posting_number: p, status: 'awaiting_deliver', delivery_method: { warehouse_id: 100 } }));
    f.request.mockImplementation(async (path: string) => path.endsWith('/get') ? { ...f.container } : path.endsWith('/info')
      ? { status: 'completed' } : { task_id: 30, error_postings: [{ posting_number: 'posting-1', error_message: 'rejected' }] });
    const row = await f.service.submit(f.scope, { kind: 'fill', containerId: '20', postingNumbers: ['posting-1', 'posting-2'], idempotencyKey: 'mixed-fill-00001' });
    expect((await f.service.recover(f.scope, row.id)).status).toBe('PENDING');
    f.container.postings = [{ posting_number: 'posting-2' }];
    expect((await f.service.recover(f.scope, row.id)).status).toBe('PARTIAL');
  });
  it('accepts the official empty parent-container zero without relaxing container identity', async () => {
    const f = fixture(); f.container.parent_container_id = 0;
    expect(await f.service.get(f.scope, '20')).toMatchObject({ parent_container_id: null });
  });
  it('rejects error records for a target outside the submitted command', async () => {
    const f = fixture();
    f.request.mockImplementation(async (path: string) => path.endsWith('/get') ? f.container : { task_id: 30, error_containers: [{ container_id: 99, error_message: 'wrong target' }] });
    expect(await f.service.submit(f.scope, { kind: 'approve', containerId: '20', idempotencyKey: 'approve-wrong-error' })).toMatchObject({ status: 'UNKNOWN' });
  });
  it('treats missing/malformed task receipts and 5xx as unknown, never as success', async () => {
    const f = fixture();
    f.request.mockImplementation(async (path: string) => path.endsWith('/get') ? f.container : {});
    expect(await f.service.submit(f.scope, { kind: 'approve', containerId: '20', idempotencyKey: 'approve-key-001' })).toMatchObject({ status: 'UNKNOWN' });
  });
  it('never reconciles an old task using changed shop credentials', async () => {
    const f = fixture();
    const row = await f.service.submit(f.scope, { kind: 'approve', containerId: '20', idempotencyKey: 'approve-key-001' });
    f.shop.clientId = 'changed-client';
    await expect(f.service.recover(f.scope, row.id)).rejects.toThrow('凭据');
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/info'))).toBe(false);
  });
  it('closes unknown tracking only with an explicit audited acknowledgement, preserving the original receipt', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('network failed'));
    const row = await f.service.submit(f.scope, f.command);
    await expect(f.service.closeUnknown(f.scope, row.id, { acknowledged: false, note: '已核对平台货位清单' })).rejects.toThrow();
    const before = f.request.mock.calls.length;
    expect(await f.service.closeUnknown(f.scope, row.id, { acknowledged: true, note: '已核对平台货位清单，结束此请求跟踪' })).toMatchObject({ status: 'CLOSED_UNKNOWN', activeScope: null, resolvedBy: 'actor' });
    expect(await f.service.submit(f.scope, f.command)).toMatchObject({ status: 'CLOSED_UNKNOWN' });
    expect(f.request).toHaveBeenCalledTimes(before);
  });
  it('does not let a late recovery overwrite audited closure after credential rotation', async () => {
    const f = fixture(); f.container.status = 'approved';
    const row = await f.service.submit(f.scope, { kind: 'approve', containerId: '20', idempotencyKey: 'late-recover-0001' });
    let resolveTask!: (v: unknown) => void;
    const task = new Promise(resolve => { resolveTask = resolve; });
    f.request.mockImplementation(async (path: string) => path.endsWith('/info') ? task : f.container);
    const recovering = f.service.recover(f.scope, row.id);
    await vi.waitFor(() => expect(f.request.mock.calls.some(([p]) => p.endsWith('/info'))).toBe(true));
    f.shop.clientId = 'rotated-client';
    await f.service.closeUnknown(f.scope, row.id, { acknowledged: true, note: '已在原店铺核对完成，关闭旧凭据任务跟踪' });
    resolveTask({ status: 'completed' });
    expect(await recovering).toMatchObject({ status: 'CLOSED_UNKNOWN', resolvedBy: 'actor' });
  });
  it('refuses manual closure of a running task or a fresh dispatch and never calls Ozon to close', async () => {
    const f = fixture();
    const row = await f.service.submit(f.scope, { kind: 'approve', containerId: '20', idempotencyKey: 'known-task-00001' });
    const input = { acknowledged: true, note: '已在平台检查货位和任务记录' };
    await expect(f.service.closeUnknown(f.scope, row.id, input)).rejects.toThrow('核对');
    f.rows[0].status = 'DISPATCHING';
    await expect(f.service.closeUnknown(f.scope, row.id, input)).rejects.toThrow('提交');
    f.rows[0].createdAt = new Date(Date.now() - 11 * 60_000);
    expect((await f.service.closeUnknown(f.scope, row.id, input))?.status).toBe('CLOSED_UNKNOWN');
    expect((await f.service.closeUnknown(f.scope, row.id, input))?.status).toBe('CLOSED_UNKNOWN');
    expect(f.request.mock.calls.filter(([p]) => p.endsWith('/approve'))).toHaveLength(1);
  });
  it('blocks duplicate scans, foreign local orders and container duplicate membership', async () => {
    const f = fixture();
    const input = { kind: 'fill', containerId: '20', postingNumbers: ['posting-1'], idempotencyKey: 'fill-fixture-001' };
    await expect(f.service.submit(f.scope, { ...input, postingNumbers: ['posting-1', 'posting-1'] })).rejects.toThrow();
    f.db.order.findMany.mockResolvedValue([]);
    await expect(f.service.submit(f.scope, input)).rejects.toThrow('订单');
    f.db.order.findMany.mockResolvedValue([{ postingNumber: 'posting-1' }]); f.container.postings = [{ posting_number: 'posting-1' }];
    await expect(f.service.submit(f.scope, input)).rejects.toThrow('已在');
  });
  it('bounds interactive scan validation before accessing the platform', async () => {
    const f = fixture();
    await expect(f.service.submit(f.scope, { kind: 'fill', containerId: '20', postingNumbers: Array.from({ length: 31 }, (_, i) => `posting-${i}`), idempotencyKey: 'batch-key-00001' })).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
});

describe('carriage PDF boundary', () => {
  it('accepts only bounded base64 PDF content, rejecting partial errors and non-PDF content', () => {
    const content = { content_type: 'application/pdf', file_content: Buffer.from('%PDF-1.7\nfixture').toString('base64') };
    expect(decodeCarriagePdf({ content, error_containers: [] }, 'label').buffer.toString()).toContain('%PDF');
    expect(() => decodeCarriagePdf({ content, error_containers: [{ container_id: 1 }] }, 'label')).toThrow();
    expect(() => decodeCarriagePdf({ ...content, file_content: 'aHRtbA==' }, 'document')).toThrow();
  });
  it('decodes a normal multi-page PDF without recursive regular-expression overflow', () => {
    const file_content = Buffer.from('%PDF-1.7\n' + 'a'.repeat(2_000_000)).toString('base64');
    expect(decodeCarriagePdf({ content_type: 'application/pdf', file_content }, 'document').buffer.length).toBe(2_000_009);
  });
});
