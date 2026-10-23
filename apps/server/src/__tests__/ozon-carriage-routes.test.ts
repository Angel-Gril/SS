import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ozonCarriageRoutes } from '../routes/ozon-carriage.js';
import { OzonClient } from '../services/ozon-client.js';

const f = vi.hoisted(() => ({ user: { userId: 'owner', role: 'USER', actorUserId: 'owner', tokenUse: 'account_session' } as any,
  shop: vi.fn(), warehouse: vi.fn(), find: vi.fn(), many: vi.fn(), create: vi.fn(), update: vi.fn(), row: null as any }));
vi.mock('../lib/auth.js', () => ({ authenticate: async (request: any, reply: any) => {
  if (!f.user) return reply.status(401).send({ code: 0 }); request.user = f.user;
} }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findFirst: f.shop }, warehouse: { findFirst: f.warehouse },
  order: { findMany: vi.fn() }, ozonCarriageOperation: { findUnique: f.find, findUniqueOrThrow: async () => f.row, findMany: f.many, create: f.create, update: f.update, updateMany: async ({ data }: any) => { Object.assign(f.row, data); return { count: 1 }; } } } }));
vi.mock('../lib/crypto.js', () => ({ decrypt: () => 'synthetic-key' }));
describe('carriage HTTP boundary through the actual owner', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  const body = { shopId: 'shop', warehouseId: 'wh', command: { kind: 'create', cargoType: 'box', sortType: 'sort', count: 1, idempotencyKey: 'route-key-0001' } };
  beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks();
    f.user = { userId: 'owner', role: 'USER', actorUserId: 'child', tokenUse: 'account_session' };
    f.shop.mockImplementation(async ({ where }: any) => where.userId === 'owner' && where.id === 'shop' && where.status === 'ACTIVE'
      ? { id: 'shop', userId: 'owner', status: 'ACTIVE', platform: 'OZON', clientId: 'fixture', apiKeyEncrypted: 'synthetic' } : null);
    f.warehouse.mockImplementation(async ({ where }: any) => where.id === 'wh' && where.shopId === 'shop'
      ? { id: 'wh', shopId: 'shop', platformWarehouseId: '100' } : null);
    f.find.mockResolvedValue(null); f.many.mockResolvedValue([]);
    f.create.mockImplementation(async ({ data }: any) => (f.row = { ...data, id: 'operation', updatedAt: new Date() }));
    f.update.mockImplementation(async ({ data }: any) => ({ ...data, id: 'operation' }));
  });
  afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
  async function call(payload = body, url = '/api/ozon-carriage/commands', method: 'POST' | 'GET' = 'POST') {
    const app = Fastify(); apps.push(app); await app.register(ozonCarriageRoutes, { prefix: '/api/ozon-carriage' });
    return app.inject({ method, url, ...(method === 'POST' ? { payload } : {}) });
  }
  it('dispatches the validated warehouse command once and records the actual actor', async () => {
    const request = vi.spyOn(OzonClient.prototype, 'request').mockResolvedValue({ container_ids: ['20'] });
    const response = await call(); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: { status: 'SUCCEEDED' } });
    expect(request).toHaveBeenCalledOnce(); expect(f.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'child', shopId: 'shop', warehouseId: 'wh' }) });
    expect(response.body).not.toContain('synthetic-key');
  });
  it.each(['STAFF', 'extension_device', 'anonymous'])('rejects disallowed actor %s before loading credentials', async mode => {
    if (mode === 'anonymous') f.user = null;
    else if (mode === 'STAFF') f.user.role = 'STAFF'; else f.user.tokenUse = mode;
    const response = await call(); expect(response.statusCode).toBe(mode === 'anonymous' ? 401 : 403); expect(f.shop).not.toHaveBeenCalled();
  });
  it('does not allow ADMIN cross-tenant access or cross-shop warehouses', async () => {
    f.user = { userId: 'other-owner', actorUserId: 'admin', role: 'ADMIN', tokenUse: 'account_session' };
    expect((await call()).statusCode).toBe(404); expect(f.create).not.toHaveBeenCalled();
    f.user.userId = 'owner'; expect((await call({ ...body, warehouseId: 'foreign-wh' })).statusCode).toBe(404);
  });
  it('rejects extra request fields, oversized counts and duplicate scans', async () => {
    expect((await call({ ...body, ownerUserId: 'other' } as any)).statusCode).toBe(400);
    expect((await call({ ...body, command: { ...body.command, count: 101 } })).statusCode).toBe(400);
    expect(f.create).not.toHaveBeenCalled();
  });
  it('keeps the recovery journal readable even when platform list fails', async () => {
    const request = vi.spyOn(OzonClient.prototype, 'request').mockRejectedValue(new Error('synthetic-secret-in-error'));
    const response = await call(undefined, '/api/ozon-carriage/operations?shopId=shop&warehouseId=wh', 'GET');
    expect(response.json()).toMatchObject({ code: 1, data: [] }); expect(request).not.toHaveBeenCalled();
  });
  it('returns only validated PDF with no-store headers and rejects unrecognized formats', async () => {
    const request = vi.spyOn(OzonClient.prototype, 'request').mockImplementation(async (path: string) => path.endsWith('/label/get')
      ? { content: { content_type: 'application/pdf', file_content: Buffer.from('%PDF-1.7\nfixture').toString('base64') }, error_containers: [] }
      : { container_id: 20, warehouse_id: 100, cargo_type: 'box', sort_type: 'sort', status: 'approved', available_actions: ['get_label_container'] });
    const response = await call(undefined, '/api/ozon-carriage/20/label?shopId=shop&warehouseId=wh', 'GET');
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toContain('no-store'); expect(response.body).toContain('%PDF');
    expect(request.mock.calls.some(([path]) => /create|approve|fill/u.test(path))).toBe(false);
    expect((await call(undefined, '/api/ozon-carriage/20/other?shopId=shop&warehouseId=wh', 'GET')).statusCode).toBe(400);
  });
});
