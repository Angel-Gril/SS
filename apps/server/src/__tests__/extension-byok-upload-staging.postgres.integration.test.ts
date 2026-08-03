import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaExtensionByokUploadStagingStore,
} from '../services/extension-byok-upload-staging.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
  return schema;
}

describePostgres('extension BYOK upload staging PostgreSQL integration', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    const schema = assertIsolatedSchema(databaseUrl);
    client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$connect();
    const current = await client.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS "schema"',
    );
    expect(current[0]?.schema).toBe(schema);
    const migration = await client.$queryRawUnsafe<Array<{ migrationName: string }>>(
      `SELECT "migration_name" AS "migrationName"
       FROM "_prisma_migrations"
       WHERE "migration_name" = '20260725112000_add_extension_byok_upload_staging'
         AND "finished_at" IS NOT NULL`,
    );
    expect(migration).toHaveLength(1);
  }, 30_000);

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('claims an expired row through UPDATE FROM without an ambiguous RETURNING projection', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const prefix = `byok_upload_claim_${suffix}`;
    const ownerUserId = `${prefix}_owner`;
    const pairingCodeId = `${prefix}_pairing`;
    const deviceSessionId = `${prefix}_session`;
    const stagingId = `${prefix}_stage`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() - 60_000);
    const leaseUntil = new Date(now.getTime() + 45_000);

    await client.user.create({
      data: {
        id: ownerUserId,
        phone: `${prefix}_phone`,
        passwordHash: 'integration-test',
      },
    });
    await client.extensionDevicePairingCode.create({
      data: {
        id: pairingCodeId,
        deploymentId: 'byok-upload-staging-integration',
        actorUserId: ownerUserId,
        ownerUserId,
        codeDigest: sha256(`${prefix}:pairing`),
        shopIds: [`${prefix}_shop`],
        scopes: ['byok:media:ingest'],
        status: 'CLAIMED',
        expiresAt: new Date(now.getTime() + 3_600_000),
        claimedAt: now,
      },
    });
    await client.extensionDeviceSession.create({
      data: {
        id: deviceSessionId,
        pairingCodeId,
        deploymentId: 'byok-upload-staging-integration',
        deviceId: `${prefix}_device`,
        actorUserId: ownerUserId,
        ownerUserId,
        scopes: ['byok:media:ingest'],
        currentJti: `${prefix}_jti`,
        expiresAt: new Date(now.getTime() + 3_600_000),
      },
    });

    const store = createPrismaExtensionByokUploadStagingStore(client as never);
    await expect(store.beginAttempt({
      id: stagingId,
      ownerUserId,
      deviceSessionId,
      assetId: `${prefix}_asset`,
      requestHash: sha256(`${prefix}:request`),
      storageBackend: 'local',
      storageNamespaceId: sha256(`${prefix}:namespace`),
      storageKey: `${prefix}.png`,
      now: expiresAt,
      expiresAt,
    })).resolves.toMatchObject({
      kind: 'created',
      staging: { id: stagingId, status: 'PENDING' },
    });

    await expect(store.claimExpired({
      now,
      limit: 1,
      leaseToken: `${prefix}_lease`,
      leaseMs: 45_000,
    })).resolves.toMatchObject({
      leaseToken: `${prefix}_lease`,
      records: [{
        id: stagingId,
        ownerUserId,
        deviceSessionId,
        status: 'CLEANING',
        cleanupLeaseToken: `${prefix}_lease`,
        cleanupLeaseUntil: leaseUntil,
        cleanupAttemptCount: 1,
        updatedAt: now,
      }],
    });

    await expect(client.extensionByokUploadStaging.findUnique({
      where: { id: stagingId },
      select: {
        status: true,
        cleanupLeaseToken: true,
        cleanupLeaseUntil: true,
        cleanupAttemptCount: true,
        updatedAt: true,
      },
    })).resolves.toEqual({
      status: 'CLEANING',
      cleanupLeaseToken: `${prefix}_lease`,
      cleanupLeaseUntil: leaseUntil,
      cleanupAttemptCount: 1,
      updatedAt: now,
    });
  });
});
