import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrderStockReadyService } from '../services/order-stock-ready.js';
import { OzonClient } from '../services/ozon-client.js';

const databaseUrl = process.env.ORDER_FULFILLMENT_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_ORDER_FULFILLMENT_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
if (process.env.ORDER_FULFILLMENT_POSTGRES_TARGET_RUNNER === '1' && !enabled) throw new Error('Order fulfillment PostgreSQL runner requires an isolated URL');
const only = enabled ? describe : describe.skip;

only('order stock-ready durable PostgreSQL owner', () => {
  let client: PrismaClient;
  const prefix = `stock_ready_${randomUUID().replaceAll('-', '')}`;
  const owner = `${prefix}_owner`, shop = `${prefix}_shop`, order = `${prefix}_order`;
  let platformStatus = 'awaiting_packaging';
  let submissionCount = 0;
  let ambiguous = false;
  const createClient = () => new OzonClient({ clientId: 'fixture-client', apiKey: 'fixture-key', requestFetch: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/v4/posting/fbs/ship')) {
      submissionCount++;
      if (ambiguous) throw new Error('fixture timeout');
      platformStatus = 'awaiting_deliver';
      return new Response(JSON.stringify({ result: [body.posting_number] }));
    }
    if (!String(url).endsWith('/v3/posting/fbs/get')) throw new Error('unexpected fixture request');
    return new Response(JSON.stringify({ result: { posting_number: body.posting_number, status: platformStatus } }));
  } });
  beforeAll(async () => {
    const url = new URL(databaseUrl); const schema = url.searchParams.get('schema') || '';
    if (!/^order_fulfillment_test_[a-z0-9_]+$/u.test(schema)) throw new Error('Test must use isolated order_fulfillment_test_* schema');
    client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$executeRaw`INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES (${owner}, ${`${prefix}_phone`}, 'fixture-hash', CURRENT_TIMESTAMP)`;
    await client.$executeRaw`INSERT INTO "shops" ("id", "user_id", "platform", "name", "client_id", "api_key_encrypted", "status", "updated_at") VALUES (${shop}, ${owner}, 'OZON', 'stock-ready fixture', 'fixture-client', 'fixture-key', 'ACTIVE', CURRENT_TIMESTAMP)`;
    await client.$executeRaw`INSERT INTO "orders" ("id", "shop_id", "platform_order_id", "posting_number", "status", "domestic_status", "international_status", "items", "updated_at") VALUES (${order}, ${shop}, ${`${prefix}_platform`}, ${`${prefix}_posting`}, 'awaiting_packaging', 'pending', 'pending', '[{"sku":123,"quantity":1}]'::jsonb, CURRENT_TIMESTAMP)`;
  });
  afterAll(async () => {
    if (client) await client.$executeRaw`DELETE FROM "users" WHERE "id" = ${owner}`;
    await client?.$disconnect();
  });

  it('allows exactly one concurrent marker and replays it after reconnect', async () => {
    const service = createOrderStockReadyService(client as never, { createClient });
    const results = await Promise.all([
      service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner }),
      service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner }),
    ]);
    expect(results.some(result => result.kind === 'marked')).toBe(true);
    expect(submissionCount).toBe(1);
    const audit = await client.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "warehouse_logs" WHERE "order_id" = ${order} AND "operation_type" = 'stock_ready'`;
    expect(audit[0]?.count).toBe(1);
    const reconnected = new PrismaClient({ datasourceUrl: databaseUrl });
    const replay = await createOrderStockReadyService(reconnected as never, { createClient }).mark({ orderId: order, ownerUserId: owner, actorUserId: owner });
    await reconnected.$disconnect();
    expect(replay).toMatchObject({ kind: 'marked', replayed: true, id: order });
    expect(submissionCount).toBe(1);
    expect((await client.order.findUnique({ where: { id: order } }))?.status).toBe('awaiting_deliver');
  });

  it('rejects disabled/foreign ownership and physical warehouse transitions', async () => {
    const service = createOrderStockReadyService(client as never, { createClient });
    expect(await service.mark({ orderId: order, ownerUserId: `${prefix}_foreign`, actorUserId: owner })).toMatchObject({ kind: 'not_found' });
    await client.$executeRaw`INSERT INTO "warehouse_logs" ("id", "order_id", "operation_type", "created_at") VALUES (${`${prefix}_scan`}, ${order}, 'scan_in', CURRENT_TIMESTAMP)`;
    const result = await service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner });
    expect(result).toMatchObject({ kind: 'immutable', stage: 'warehouse_processing' });
    await client.shop.update({ where: { id: shop }, data: { status: 'DISABLED' } });
    expect(await service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner })).toMatchObject({ kind: 'not_found' });
    await client.shop.update({ where: { id: shop }, data: { status: 'ACTIVE' } });
  });

  it('persists unknown dispatch across reconnect without duplicating the external write', async () => {
    const pendingOrder = `${prefix}_pending`;
    platformStatus = 'awaiting_packaging'; ambiguous = true;
    await client.$executeRaw`INSERT INTO "orders" ("id", "shop_id", "platform_order_id", "posting_number", "status", "items", "updated_at") VALUES (${pendingOrder}, ${shop}, ${pendingOrder}, ${`${pendingOrder}_posting`}, 'awaiting_packaging', '[{"sku":123,"quantity":1}]'::jsonb, CURRENT_TIMESTAMP)`;
    const input = { orderId: pendingOrder, ownerUserId: owner, actorUserId: owner };
    const before = submissionCount;
    expect(await createOrderStockReadyService(client as never, { createClient }).mark(input)).toMatchObject({ kind: 'pending' });
    const reconnected = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      expect(await createOrderStockReadyService(reconnected as never, { createClient }).mark(input)).toMatchObject({ kind: 'pending' });
      expect(submissionCount - before).toBe(1);
      expect(await client.warehouseLog.count({ where: { orderId: pendingOrder, operationType: 'stock_ready' } })).toBe(0);
      platformStatus = 'awaiting_deliver';
      expect(await createOrderStockReadyService(reconnected as never, { createClient }).mark(input)).toMatchObject({ kind: 'marked', stage: 'domestic_transit' });
      expect(submissionCount - before).toBe(1);
    } finally { await reconnected.$disconnect(); }
  });
});
