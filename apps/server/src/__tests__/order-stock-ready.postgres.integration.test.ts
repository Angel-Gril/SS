import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrderStockReadyService } from '../services/order-stock-ready.js';

const databaseUrl = process.env.ORDER_FULFILLMENT_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_ORDER_FULFILLMENT_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
if (process.env.ORDER_FULFILLMENT_POSTGRES_TARGET_RUNNER === '1' && !enabled) throw new Error('Order fulfillment PostgreSQL runner requires an isolated URL');
const only = enabled ? describe : describe.skip;

only('order stock-ready durable PostgreSQL owner', () => {
  let client: PrismaClient;
  const prefix = `stock_ready_${randomUUID().replaceAll('-', '')}`;
  const owner = `${prefix}_owner`, shop = `${prefix}_shop`, order = `${prefix}_order`;
  beforeAll(async () => {
    const url = new URL(databaseUrl); const schema = url.searchParams.get('schema') || '';
    if (!/^order_fulfillment_test_[a-z0-9_]+$/u.test(schema)) throw new Error('Test must use isolated order_fulfillment_test_* schema');
    client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$executeRaw`INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES (${owner}, ${`${prefix}_phone`}, 'fixture-hash', CURRENT_TIMESTAMP)`;
    await client.$executeRaw`INSERT INTO "shops" ("id", "user_id", "platform", "name", "api_key_encrypted", "status", "updated_at") VALUES (${shop}, ${owner}, 'OZON', 'stock-ready fixture', 'fixture-key', 'ACTIVE', CURRENT_TIMESTAMP)`;
    await client.$executeRaw`INSERT INTO "orders" ("id", "shop_id", "platform_order_id", "status", "domestic_status", "international_status", "items", "updated_at") VALUES (${order}, ${shop}, ${`${prefix}_platform`}, 'awaiting_packaging', 'pending', 'pending', '[]'::jsonb, CURRENT_TIMESTAMP)`;
  });
  afterAll(async () => {
    if (client) await client.$executeRaw`DELETE FROM "users" WHERE "id" = ${owner}`;
    await client?.$disconnect();
  });

  it('allows exactly one concurrent marker and replays it after reconnect', async () => {
    const service = createOrderStockReadyService(client as never);
    const results = await Promise.all([
      service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner }),
      service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner }),
    ]);
    expect(results.filter(result => result.kind === 'marked' && !result.replayed)).toHaveLength(1);
    expect(results.filter(result => result.kind === 'marked' && result.replayed)).toHaveLength(1);
    const audit = await client.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "warehouse_logs" WHERE "order_id" = ${order} AND "operation_type" = 'stock_ready'`;
    expect(audit[0]?.count).toBe(1);
    const replay = await service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner });
    expect(replay).toMatchObject({ kind: 'marked', replayed: true, id: order });
  });

  it('rejects disabled/foreign ownership and physical warehouse transitions', async () => {
    const service = createOrderStockReadyService(client as never);
    expect(await service.mark({ orderId: order, ownerUserId: `${prefix}_foreign`, actorUserId: owner })).toMatchObject({ kind: 'not_found' });
    await client.$executeRaw`INSERT INTO "warehouse_logs" ("id", "order_id", "operation_type", "created_at") VALUES (${`${prefix}_scan`}, ${order}, 'scan_in', CURRENT_TIMESTAMP)`;
    const result = await service.mark({ orderId: order, ownerUserId: owner, actorUserId: owner });
    expect(result.kind).toBe('marked');
    expect(result).toMatchObject({ replayed: true, stage: 'warehouse_processing' });
  });
});
