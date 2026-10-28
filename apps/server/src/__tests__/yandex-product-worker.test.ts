import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ shop: vi.fn(), create: vi.fn(), update: vi.fn(), yandex: vi.fn(), ozon: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true }));
vi.mock('../lib/bullmq-connection.js', () => ({ connection: {} }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findUnique: m.shop }, syncJob: { create: m.create, update: m.update } } }));
vi.mock('../services/yandex-product-sync.js', () => ({ syncYandexProducts: m.yandex }));
vi.mock('../services/ozon-client.js', () => ({ OzonClient: class { constructor() { m.ozon(); } } }));
import { addProductSyncJob } from '../workers/product-sync.js';

describe('shared product queue platform dispatch', () => {
  beforeEach(() => { vi.clearAllMocks(); m.create.mockResolvedValue({ id: 'run1' }); m.update.mockResolvedValue({}); m.shop.mockResolvedValue({ id: 'shop1', platform: 'YANDEX', status: 'ACTIVE' }); });
  it('runs a Yandex job through the Yandex owner and stores completion against the returned run ID', async () => {
    m.yandex.mockResolvedValue(3);
    expect(await addProductSyncJob('shop1')).toMatchObject({ syncJobId: 'run1' });
    await vi.waitFor(() => expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'run1' }, data: expect.objectContaining({ status: 'SUCCESS', result: { totalSynced: 3 } }) })));
    expect(m.yandex).toHaveBeenCalledTimes(1); expect(m.ozon).not.toHaveBeenCalled();
  });
});
