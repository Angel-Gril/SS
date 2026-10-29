import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { reservePlatformSync, startPlatformSyncRun } from '../services/platform-sync-reservation.js';

const suite = process.env.RUN_YANDEX_POSTGRES_TESTS === '1' ? describe : describe.skip;
const prefix = 'auto_sync_' + randomUUID().replaceAll('-', ''), owner = prefix + '_owner', shopId = prefix + '_shop';
const input = { shopId, type: 'ORDER_PULL' as const, payload: { trigger: 'scheduled', since: '2026-10-01T00:00:00Z' }, options: { automaticIntervalMs: 300000 } };
suite('automatic sync reservations on isolated PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^yandex_test_[a-z0-9_]+$/u.test(url.searchParams.get('schema') ?? '')) throw Error('isolated local schema required');
    await prisma.user.create({ data: { id: owner, phone: prefix, passwordHash: 'synthetic-hash' } });
    await prisma.shop.create({ data: { id: shopId, userId: owner, platform: 'YANDEX', status: 'ACTIVE', name: 'auto sync isolated shop', apiKeyEncrypted: 'synthetic-encrypted', clientId: '123' } });
  });
  beforeEach(async () => { await prisma.syncJob.deleteMany({ where: { shopId } }); });
  afterAll(async () => { await prisma.syncJob.deleteMany({ where: { shopId } }); await prisma.shop.delete({ where: { id: shopId } }); await prisma.user.delete({ where: { id: owner } }); await prisma.$disconnect(); });
  it('concurrent automatic/manual enqueues share one persistent original request', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => reservePlatformSync({ ...input, payload: { trigger: i ? 'manual' : 'scheduled', since: '2026-10-01T00:00:00Z' } })));
    expect(new Set(results.map(r => r.row.id)).size).toBe(1);
    expect(await prisma.syncJob.count({ where: { shopId } })).toBe(1);
    await startPlatformSyncRun(results[0]!.row.id, shopId, 'ORDER_PULL');
    expect(await reservePlatformSync(input)).toMatchObject({ dispatch: false, row: { id: results[0]!.row.id, status: 'RUNNING' } });
  });
  it('checks finished time per stream and retains an independent delayed post-publish follow-up', async () => {
    const first = await reservePlatformSync(input);
    await prisma.syncJob.update({ where: { id: first.row.id }, data: { status: 'SUCCESS', finishedAt: new Date() } });
    expect(await reservePlatformSync(input)).toMatchObject({ dispatch: false, row: { id: first.row.id } });
    const product = await reservePlatformSync({ shopId, type: 'PRODUCT_PULL', payload: { trigger: 'manual' } });
    const delayed = await reservePlatformSync({ shopId, type: 'PRODUCT_PULL', payload: { trigger: 'post-publish' }, options: { delayMs: 300000, jobId: 'follow-up' } });
    expect(delayed.row.id).not.toBe(product.row.id);
    expect(await reservePlatformSync({ shopId, type: 'PRODUCT_PULL', payload: {}, options: { delayMs: 300000, jobId: 'follow-up' } })).toMatchObject({ row: { id: delayed.row.id }, reused: true });
    await startPlatformSyncRun(product.row.id, shopId, 'PRODUCT_PULL');
    await expect(startPlatformSyncRun(delayed.row.id, shopId, 'PRODUCT_PULL')).rejects.toThrow('上一条');
  });
  it('never reserves work after shop or account deactivation', async () => {
    await prisma.shop.update({ where: { id: shopId }, data: { status: 'DISABLED' } });
    await expect(reservePlatformSync(input)).rejects.toThrow('店铺');
    await prisma.shop.update({ where: { id: shopId }, data: { status: 'ACTIVE' } });
    await prisma.user.update({ where: { id: owner }, data: { status: 'SUSPENDED' } });
    try { await expect(reservePlatformSync(input)).rejects.toThrow('店铺'); }
    finally { await prisma.user.update({ where: { id: owner }, data: { status: 'ACTIVE' } }); }
    expect(await prisma.syncJob.count({ where: { shopId } })).toBe(0);
  });
  it('checks queued task scope and rejects inactive accounts again at execution time', async () => {
    const reservation = await reservePlatformSync(input);
    await expect(startPlatformSyncRun(reservation.row.id, shopId, 'PRODUCT_PULL')).rejects.toThrow('状态');
    await prisma.user.update({ where: { id: owner }, data: { status: 'SUSPENDED' } });
    try { await expect(startPlatformSyncRun(reservation.row.id, shopId, 'ORDER_PULL')).rejects.toThrow('状态'); }
    finally { await prisma.user.update({ where: { id: owner }, data: { status: 'ACTIVE' } }); }
    await prisma.syncJob.update({ where: { id: reservation.row.id }, data: { status: 'SUCCESS' } });
    expect(await startPlatformSyncRun(reservation.row.id, shopId, 'ORDER_PULL')).toBe(false);
  });
});
