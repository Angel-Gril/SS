import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedisErpSourceLaunchGrantStore } from '../services/extension-erp-source-launch.js';

const fixtureUrl = process.env.ERP_LAUNCH_REDIS_TEST_URL;
describe.skipIf(!fixtureUrl)('ERP source launch grants on an isolated real Redis', () => {
  let redis: Redis;
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const makeGrant = (owner: string) => {
    const createdAt = Date.now();
    return JSON.stringify({ schemaVersion: 1, deploymentId: 'synthetic-com', ownerUserId: owner, actorUserId: owner,
      createdAt, expiresAt: createdAt + 120_000,
      request: { deviceSessionId: 'synthetic-device', shopId: 'synthetic-shop', listingWorkflowId: 'synthetic-draft',
        draftRevision: 1, draftVersion: 1, mode: 'WORKBENCH', sourceMediaKeys: [], preferredSkuKey: 'fixture-sku' },
      resolved: { contractVersion: 'extension-erp-source-launch/v1', provenance: 'ERP_SOURCE', apiOrigin: 'https://ss-erp.example.invalid',
        ownerUserId: owner, deviceSessionId: 'synthetic-device', mode: 'WORKBENCH', sourceMediaKeys: [],
        launchRequest: { sourcePlatform: '1688', sourceProductId: 'synthetic-product', sourceCaptureSnapshotId: 'synthetic-snapshot',
          supplyGoodsId: 'synthetic-goods', shopId: 'synthetic-shop', workflowId: 'synthetic-draft', draftRevision: 1,
          draftVersion: 1, preferredSkuKey: 'fixture-sku', selectionKind: 'EXPLICIT' } },
    });
  };
  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    expect(url.protocol).toBe('redis:'); expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).not.toBe('6379'); expect(Number(url.port)).toBeGreaterThan(1024);
    expect(url.pathname).toBe('/0'); expect(url.username).toBe(''); expect(url.password).toBe('');
    redis = new Redis(url.toString(), { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000 });
    await redis.connect();
  });
  afterAll(async () => { if (redis) await redis.quit(); });

  it('uses native atomic CAS so exactly one of 20 concurrent consumers wins', async () => {
    const store = createRedisErpSourceLaunchGrantStore({ redis, enabled: true });
    const key = digest(randomUUID()), raw = makeGrant('synthetic-owner-' + randomUUID());
    expect(await store.put(key, raw, 120)).toBe(true);
    expect(await store.get(key)).toBe(raw);
    const ttl = await redis.ttl('extension-erp-launch:grant:' + key);
    expect(ttl).toBeGreaterThan(115); expect(ttl).toBeLessThanOrEqual(120);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.consume(key, raw)));
    expect(results.filter(Boolean)).toHaveLength(1); expect(await store.get(key)).toBeNull();
  });
  it('does not consume a changed value and honors Redis expiration', async () => {
    const store = createRedisErpSourceLaunchGrantStore({ redis, enabled: true });
    const key = digest(randomUUID()), raw = makeGrant('synthetic-owner-' + randomUUID());
    expect(await store.put(key, raw, 120)).toBe(true);
    expect(await store.consume(key, '{}')).toBe(false); expect(await store.get(key)).toBe(raw);
    await redis.pexpire('extension-erp-launch:grant:' + key, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await store.get(key)).toBeNull(); expect(await store.consume(key, raw)).toBe(false);
  });
  it('bounds one owner/device to 20 issuances in a 120 second window', async () => {
    const store = createRedisErpSourceLaunchGrantStore({ redis, enabled: true });
    const raw = makeGrant('synthetic-rate-owner-' + randomUUID());
    for (let count = 0; count < 20; count++) expect(await store.put(digest(randomUUID()), raw, 120)).toBe(true);
    expect(await store.put(digest(randomUUID()), raw, 120)).toBe(false);
    const disabled = createRedisErpSourceLaunchGrantStore({ redis, enabled: false });
    await expect(disabled.put(digest(randomUUID()), raw, 120)).rejects.toMatchObject({ code: 'ERP_LAUNCH_UNAVAILABLE' });
  });
});
