import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ shop: vi.fn(), create: vi.fn(), update: vi.fn(), yandex: vi.fn(), ozon: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
vi.mock('../lib/bullmq-connection.js', () => ({ connection: {} }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findUnique: m.shop }, syncJob: { create: m.create, update: m.update } } }));
vi.mock('../services/yandex-order-sync.js', () => ({ syncYandexOrders: m.yandex }));
vi.mock('../services/platform-sync-reservation.js', () => ({ reservePlatformSync: vi.fn().mockResolvedValue({ row: { id: 'run1', payload: {} }, dispatch: true }), readSyncPayload: (v: unknown) => v ?? {}, startPlatformSyncRun: vi.fn(async (id: string) => { await m.update({ where: { id }, data: { status: 'RUNNING' } }); return true; }) }));
vi.mock('../services/ozon-client.js', () => ({ OzonClient: class { constructor() { m.ozon(); } } }));
import { addOrderSyncJob } from '../workers/order-sync.js';
describe('shared order queue platform dispatch', () => {
  beforeEach(() => { vi.clearAllMocks(); m.create.mockResolvedValue({ id: 'run1' }); m.update.mockResolvedValue({}); m.shop.mockResolvedValue({ id: 'shop1', platform: 'YANDEX', status: 'ACTIVE', user: { tenantType: 'standard', account: null } }); });
  it('runs a Yandex order job through the Yandex owner', async () => {
    m.yandex.mockResolvedValue({ created: 2, updated: 1, orders: 3, windows: 1 });
    expect(await addOrderSyncJob('shop1')).toMatchObject({ syncJobId: 'run1' });
    await vi.waitFor(() => expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'run1' }, data: expect.objectContaining({ status: 'SUCCESS', result: { created: 2, updated: 1, orders: 3, windows: 1 } }) })));
    expect(m.yandex).toHaveBeenCalledTimes(1); expect(m.ozon).not.toHaveBeenCalled();
  });
});
