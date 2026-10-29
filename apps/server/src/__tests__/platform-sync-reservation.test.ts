import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ shop: vi.fn(), jobs: vi.fn(), latest: vi.fn(), create: vi.fn(), tx: vi.fn(), lock: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { $transaction: m.tx } }));
import { reservePlatformSync } from '../services/platform-sync-reservation.js';
const base = { shopId: 's1', type: 'ORDER_PULL' as const, payload: { since: '2026-10-01T00:00:00Z', trigger: 'scheduled' }, automaticIntervalMs: 300000 };
describe('platform read sync single flight reservation', () => {
  beforeEach(() => { vi.clearAllMocks(); m.shop.mockResolvedValue({ id: 's1' }); m.jobs.mockResolvedValue([]); m.latest.mockResolvedValue(null); m.create.mockImplementation(async ({ data }) => ({ ...data, id: 'run1' })); m.tx.mockImplementation(async f => f({ $executeRaw: m.lock, shop: { findFirst: m.shop }, syncJob: { findMany: m.jobs, findFirst: m.latest, create: m.create } })); });
  it('reuses manual running work so automatic dispatch cannot duplicate it', async () => {
    m.jobs.mockResolvedValue([{ id: 'manual', status: 'RUNNING', payload: { since: 'original' } }]);
    expect(await reservePlatformSync(base)).toMatchObject({ row: { id: 'manual' }, dispatch: false }); expect(m.create).not.toHaveBeenCalled();
  });
  it('keeps an original pending payload and scheduled follow-up separate from immediate work', async () => {
    m.jobs.mockResolvedValue([{ id: 'follow-up', status: 'PENDING', payload: { syncNotBefore: new Date(Date.now() + 300000).toISOString() } }, { id: 'pending', status: 'PENDING', payload: { since: 'original' } }]);
    expect(await reservePlatformSync(base)).toMatchObject({ row: { id: 'pending', payload: { since: 'original' } }, dispatch: true }); expect(m.create).not.toHaveBeenCalled();
  });
  it('checks interval again inside the lock and rejects inactive/foreign-mode shops', async () => {
    m.latest.mockResolvedValue({ id: 'recent', status: 'SUCCESS', payload: {}, finishedAt: new Date(), createdAt: new Date() });
    expect(await reservePlatformSync(base)).toMatchObject({ row: { id: 'recent' }, dispatch: false }); expect(m.create).not.toHaveBeenCalled();
    m.shop.mockResolvedValue(null); await expect(reservePlatformSync(base)).rejects.toThrow('店铺');
  });
});
