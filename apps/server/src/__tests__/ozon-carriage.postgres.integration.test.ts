import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOzonCarriageService } from '../services/ozon-carriage.js';
import { OzonClient } from '../services/ozon-client.js';

const url = process.env.OZON_CARRIAGE_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_OZON_CARRIAGE_POSTGRES_TESTS === '1' && Boolean(url);
if (process.env.OZON_CARRIAGE_TARGET_RUNNER === '1' && !enabled) throw new Error('Isolated carriage test URL required');
(enabled ? describe : describe.skip)('durable carriage dispatch and recovery', () => {
  let db: PrismaClient;
  const prefix = `carriage_${randomUUID().replaceAll('-', '')}`, owner = `${prefix}_owner`, shop = `${prefix}_shop`, warehouse = `${prefix}_wh`;
  const scope = { ownerUserId: owner, actorUserId: owner, shopId: shop, warehouseId: warehouse };
  let sends = 0, ambiguous = false;
  const client = () => new OzonClient({ clientId: 'fixture', apiKey: 'fixture', requestFetch: async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/v1/carriage/container/create') {
      sends++; if (ambiguous) throw new Error('fixture timeout');
      return new Response(JSON.stringify({ container_ids: ['20'] }));
    }
    if (path === '/v1/carriage/container/approve') { sends++; return new Response('{"task_id":30,"error_containers":[]}'); }
    if (path === '/v1/carriage/container/task/info') return new Response('{"status":"completed"}');
    if (path === '/v1/carriage/container/get') return new Response(JSON.stringify({ container_id: 20, warehouse_id: 100, cargo_type: 'box', sort_type: 'sort', status: 'approved', available_actions: ['approve'], postings: [] }));
    throw new Error(`Unexpected fixture request: ${path}`);
  } });
  const command = (key: string) => ({ kind: 'create', cargoType: 'box', sortType: 'sort', count: 1, idempotencyKey: key });
  beforeAll(async () => {
    if (!/^ozon_carriage_test_[a-z0-9_]+$/u.test(new URL(url).searchParams.get('schema') || '')) throw new Error('Unsafe test schema');
    db = new PrismaClient({ datasourceUrl: url });
    await db.user.create({ data: { id: owner, phone: `${prefix}_phone`, passwordHash: 'synthetic-hash' } });
    await db.shop.create({ data: { id: shop, userId: owner, platform: 'OZON', name: 'synthetic', clientId: 'fixture', apiKeyEncrypted: 'fixture' } });
    await db.warehouse.create({ data: { id: warehouse, shopId: shop, platformWarehouseId: '100', name: 'synthetic warehouse' } });
  });
  afterAll(async () => {
    if (db) { await db.ozonCarriageOperation.deleteMany({ where: { shopId: shop } }); await db.user.delete({ where: { id: owner } }); await db.$disconnect(); }
  });
  it('persists one dispatch during concurrent identical submissions and replays after process reconnect', async () => {
    const service = createOzonCarriageService(db, { createClient: client });
    const input = command('concurrent-create-001');
    const results = await Promise.all([service.submit(scope, input), service.submit(scope, input)]);
    expect(sends).toBe(1); expect(results.every(row => row.id === results[0].id)).toBe(true);
    const reconnect = new PrismaClient({ datasourceUrl: url });
    try { expect(await createOzonCarriageService(reconnect, { createClient: client }).submit(scope, input)).toMatchObject({ status: 'SUCCEEDED' }); }
    finally { await reconnect.$disconnect(); }
    expect(sends).toBe(1);
  });
  it('recovers persisted asynchronous task on a new service instance without resubmitting', async () => {
    const service = createOzonCarriageService(db, { createClient: client });
    const row = await service.submit(scope, { kind: 'approve', containerId: '20', idempotencyKey: 'approve-persisted-001' });
    expect(row.status).toBe('PENDING'); const before = sends;
    const recovered = await createOzonCarriageService(db, { createClient: client }).recover(scope, row.id);
    expect(recovered).toMatchObject({ status: 'SUCCEEDED', activeScope: null }); expect(sends).toBe(before);
  });
  it('keeps an ambiguous write locked after reconnect and blocks a different command key', async () => {
    ambiguous = true; const service = createOzonCarriageService(db, { createClient: client });
    const row = await service.submit(scope, command('unknown-create-001'));
    expect(row.status).toBe('UNKNOWN'); const before = sends;
    const next = createOzonCarriageService(db, { createClient: client });
    expect((await next.recover(scope, row.id)).status).toBe('UNKNOWN');
    await expect(next.submit(scope, command('unknown-create-002'))).rejects.toThrow('未完成');
    expect(sends).toBe(before);
  });
  it('enforces lock-state and same-shop warehouse integrity in PostgreSQL', async () => {
    await expect(db.ozonCarriageOperation.create({ data: { shopId: shop, warehouseId: warehouse, actorUserId: owner, idempotencyKey: 'invalid-lock-state', requestHash: 'hash', credentialHash: 'hash', command: {}, kind: 'create', status: 'PENDING', activeScope: null } })).rejects.toThrow();
    const secondShop = await db.shop.create({ data: { userId: owner, platform: 'OZON', name: 'second', clientId: 'second', apiKeyEncrypted: 'fixture' } });
    await expect(db.ozonCarriageOperation.create({ data: { shopId: secondShop.id, warehouseId: warehouse, actorUserId: owner, idempotencyKey: 'invalid-cross-shop', requestHash: 'hash', credentialHash: 'hash', command: {}, kind: 'create', status: 'FAILED' } })).rejects.toThrow();
  });
  it('rejects foreign ownership before any transport request', async () => {
    const before = sends;
    await expect(createOzonCarriageService(db, { createClient: client }).submit({ ...scope, ownerUserId: 'other-owner' }, command('foreign-command-001'))).rejects.toThrow('店铺');
    expect(sends).toBe(before);
  });
  it('manually closes unknown tracking with an audit, keeps old key immutable and unlocks a new command', async () => {
    const service = createOzonCarriageService(db, { createClient: client });
    const row = await db.ozonCarriageOperation.findUniqueOrThrow({ where: { shopId_idempotencyKey: { shopId: shop, idempotencyKey: 'unknown-create-001' } } });
    const before = sends;
    expect(await service.closeUnknown(scope, row.id, { acknowledged: true, note: '已在平台核对原请求和货位列表，关闭测试跟踪' })).toMatchObject({ status: 'CLOSED_UNKNOWN', resolvedBy: owner, activeScope: null });
    expect(await service.submit(scope, command('unknown-create-001'))).toMatchObject({ status: 'CLOSED_UNKNOWN' });
    expect(sends).toBe(before);
    ambiguous = false;
    expect(await service.submit(scope, command('after-close-create-001'))).toMatchObject({ status: 'SUCCEEDED' });
    await expect(db.ozonCarriageOperation.create({ data: { shopId: shop, warehouseId: warehouse, actorUserId: owner, idempotencyKey: 'invalid-closed-audit', requestHash: 'hash', credentialHash: 'hash', command: {}, kind: 'create', status: 'CLOSED_UNKNOWN' } })).rejects.toThrow();
  });
});
