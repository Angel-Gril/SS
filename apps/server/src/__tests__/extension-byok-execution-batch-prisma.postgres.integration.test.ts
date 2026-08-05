import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaExtensionByokExecutionBatchRepository,
} from '../services/extension-byok-execution-batch-prisma.js';
import type {
  ExtensionByokExecutionBatchCreateRecord,
} from '../services/extension-byok-execution-batch.js';
import {
  createPrismaExtensionByokExecutionIntentRepository,
} from '../services/extension-byok-execution-intent-prisma.js';
import type {
  ExtensionByokExecutionIntentRecord,
} from '../services/extension-byok-execution-intent.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function digest(value: string): string {
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

interface BatchFixture {
  ownerUserId: string;
  deviceSessionId: string;
  deviceId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  sourceProductId: string;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
}

async function seedFixture(client: PrismaClient, label: string): Promise<BatchFixture> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const prefix = `byok_batch_${label}_${suffix}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const supplyGoodsId = `${prefix}_goods`;
  const subjectId = `${prefix}_subject`;
  const sourceProductId = `${prefix}_product`;
  const sourceCaptureSnapshotId = `${prefix}_snapshot`;
  const pairingCodeId = `${prefix}_pairing`;
  const deviceSessionId = `${prefix}_session`;
  const deviceId = `${prefix}_device`;
  const now = new Date();
  const captureHash = digest(`${prefix}:capture`);

  await client.user.create({ data: {
    id: ownerUserId,
    phone: `${prefix}_phone`,
    passwordHash: 'integration-test',
  } });
  await client.shop.create({ data: {
    id: shopId,
    userId: ownerUserId,
    platform: 'OZON',
    name: `${prefix} shop`,
    apiKeyEncrypted: 'integration-test',
  } });
  await client.supplyGoods.create({ data: {
    id: supplyGoodsId,
    userId: ownerUserId,
    title: 'BYOK batch reservation fixture',
    sourcePlatform: '1688',
    sourceProductId,
  } });
  await client.sourceCaptureSubject.create({ data: {
    id: subjectId,
    ownerUserId,
    sourcePlatform: '1688',
    sourceProductId,
    legacySupplyGoodsId: supplyGoodsId,
  } });
  await client.sourceCaptureSnapshot.create({ data: {
    id: sourceCaptureSnapshotId,
    subjectId,
    version: 1,
    schemaVersion: 'source-product-capture-v2',
    captureHash,
    payloadBytes: 2,
    payload: {},
    stageCounts: {},
    provenance: {},
    provenanceComplete: true,
    parserVersion: 'byok-batch-integration',
    completeness: {},
    truncations: [],
    hasEstimatedValues: false,
    profile: {},
    profileHash: digest(`${prefix}:profile`),
    actorUserId: ownerUserId,
    ingestChannel: 'WEB_ACCOUNT',
    rolloutRevision: 'byok-batch-integration',
    rolloutStage: 'v2_only',
    capturedAt: now,
  } });

  const workflow = createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
  });
  const draft = await workflow.createDraft({
    ownerUserId,
    actorUserId: ownerUserId,
    shopId,
    supplyGoodsId,
    sourceCaptureSnapshotId,
    sourceCaptureHash: captureHash,
    selectedSkuKeys: ['sku-1', 'sku-2'],
  });
  await client.extensionDevicePairingCode.create({ data: {
    id: pairingCodeId,
    deploymentId: 'byok-batch-integration',
    actorUserId: ownerUserId,
    ownerUserId,
    codeDigest: digest(`${prefix}:pairing`),
    shopIds: [shopId],
    scopes: ['byok:media:ingest'],
    status: 'CLAIMED',
    expiresAt: new Date(now.getTime() + 3_600_000),
    claimedAt: now,
  } });
  await client.extensionDeviceSession.create({ data: {
    id: deviceSessionId,
    pairingCodeId,
    deploymentId: 'byok-batch-integration',
    deviceId,
    actorUserId: ownerUserId,
    ownerUserId,
    scopes: ['byok:media:ingest'],
    currentJti: `${prefix}_jti`,
    expiresAt: new Date(now.getTime() + 3_600_000),
  } });
  await client.extensionDeviceShopGrant.create({ data: {
    sessionId: deviceSessionId,
    shopId,
    status: 'ACTIVE',
    grantedAt: now,
  } });

  return {
    ownerUserId,
    deviceSessionId,
    deviceId,
    shopId,
    listingWorkflowId: draft.id,
    draftRevision: draft.revision,
    draftVersion: draft.draftVersion,
    sourceProductId,
    sourceCaptureSnapshotId,
    supplyGoodsId,
  };
}

async function seedSecondDevice(
  client: PrismaClient,
  fixture: BatchFixture,
  label: string,
  deviceId = `${fixture.ownerUserId}_${label}_device`,
): Promise<string> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const pairingCodeId = `${fixture.ownerUserId}_${label}_${suffix}_pairing`;
  const deviceSessionId = `${fixture.ownerUserId}_${label}_${suffix}_session`;
  const now = new Date();
  await client.extensionDevicePairingCode.create({ data: {
    id: pairingCodeId,
    deploymentId: 'byok-batch-integration',
    actorUserId: fixture.ownerUserId,
    ownerUserId: fixture.ownerUserId,
    codeDigest: digest(`${pairingCodeId}:code`),
    shopIds: [fixture.shopId],
    scopes: ['byok:media:ingest'],
    status: 'CLAIMED',
    expiresAt: new Date(now.getTime() + 3_600_000),
    claimedAt: now,
  } });
  await client.extensionDeviceSession.create({ data: {
    id: deviceSessionId,
    pairingCodeId,
    deploymentId: 'byok-batch-integration',
    deviceId,
    actorUserId: fixture.ownerUserId,
    ownerUserId: fixture.ownerUserId,
    scopes: ['byok:media:ingest'],
    currentJti: `${deviceSessionId}_jti`,
    expiresAt: new Date(now.getTime() + 3_600_000),
  } });
  await client.extensionDeviceShopGrant.create({ data: {
    sessionId: deviceSessionId,
    shopId: fixture.shopId,
    status: 'ACTIVE',
    grantedAt: now,
  } });
  return deviceSessionId;
}

function batchInput(
  fixture: BatchFixture,
  label: string,
  options: {
    slotKey?: string;
    skuKey?: string;
    assignmentOrdinal?: number;
  } = {},
): ExtensionByokExecutionBatchCreateRecord {
  const createdAt = new Date();
  const skuKey = options.skuKey || 'sku-1';
  const slotKey = options.slotKey || `sku:${skuKey}:hero`;
  const assignmentOrdinal = options.assignmentOrdinal ?? 0;
  const batchId = `${fixture.listingWorkflowId}_${label}_batch`;
  const itemId = `${fixture.listingWorkflowId}_${label}_item`;
  const intentId = `${fixture.listingWorkflowId}_${label}_intent`;
  return {
    batch: {
      id: batchId,
      contractVersion: 'extension-byok-execution-batch/v1',
      status: 'OPEN',
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      deviceSessionId: fixture.deviceSessionId,
      shopId: fixture.shopId,
      listingWorkflowId: fixture.listingWorkflowId,
      draftRevision: fixture.draftRevision,
      draftVersion: fixture.draftVersion,
      sourcePlatform: '1688',
      sourceProductId: fixture.sourceProductId,
      sourceCaptureSnapshotId: fixture.sourceCaptureSnapshotId,
      supplyGoodsId: fixture.supplyGoodsId,
      firstAssignmentOrdinal: assignmentOrdinal,
      itemCount: 1,
      idempotencyKey: `batch-idempotency-${label}`,
      requestHash: digest(`${fixture.listingWorkflowId}:${label}:batch-request`),
      boundDraftRevision: null,
      boundDraftVersion: null,
      boundAt: null,
      cancelledAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    items: [{
      id: itemId,
      batchId,
      ownerUserId: fixture.ownerUserId,
      listingWorkflowId: fixture.listingWorkflowId,
      draftRevision: fixture.draftRevision,
      draftVersion: fixture.draftVersion,
      itemIndex: 0,
      skuKey,
      slotKey,
      assignmentOrdinal,
      status: 'ACTIVE',
      boundAt: null,
      releasedAt: null,
      createdAt,
      updatedAt: createdAt,
    }],
    intents: [{
      id: intentId,
      contractVersion: 'extension-byok-execution-intent/v1',
      executionMode: 'BYOK',
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      deviceSessionId: fixture.deviceSessionId,
      shopId: fixture.shopId,
      listingWorkflowId: fixture.listingWorkflowId,
      draftRevision: fixture.draftRevision,
      draftVersion: fixture.draftVersion,
      sourceCaptureSnapshotId: fixture.sourceCaptureSnapshotId,
      supplyGoodsId: fixture.supplyGoodsId,
      skuKey,
      slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal,
      policyRevision: 1,
      providerOriginSha256: digest('https://provider.example'),
      model: 'image-model-v1',
      operation: 'TEXT_TO_IMAGE',
      requestMode: 'json',
      providerIdempotencyKey: `provider-attempt-${label}-0001`,
      providerRequestHash: digest(`${fixture.listingWorkflowId}:${label}:provider-request`),
      requestHash: digest(`${fixture.listingWorkflowId}:${label}:intent-request`),
      executionBatchItemId: itemId,
      executionBatchAttemptIndex: 0,
      outcome: 'PENDING',
      providerRequestIdSha256: null,
      resultSha256: null,
      outcomeUpdatedAt: null,
      createdAt,
      updatedAt: createdAt,
    }],
  };
}

function standaloneIntent(
  fixture: BatchFixture,
  label: string,
  options: { slotKey?: string; skuKey?: string; assignmentOrdinal?: number } = {},
): ExtensionByokExecutionIntentRecord {
  const base = batchInput(fixture, `${label}-source`, options).intents[0]!;
  return {
    ...base,
    id: `${fixture.listingWorkflowId}_${label}_standalone_intent`,
    providerIdempotencyKey: `provider-standalone-${label}-0001`,
    providerRequestHash: digest(`${fixture.listingWorkflowId}:${label}:standalone-provider`),
    requestHash: digest(`${fixture.listingWorkflowId}:${label}:standalone-request`),
    executionBatchItemId: null,
    executionBatchAttemptIndex: null,
  };
}

describePostgres('extension BYOK execution batch PostgreSQL reservation', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const schema = assertIsolatedSchema(databaseUrl);
    first = new PrismaClient({ datasourceUrl: databaseUrl });
    second = new PrismaClient({ datasourceUrl: databaseUrl });
    await Promise.all([first.$connect(), second.$connect()]);
    const current = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS "schema"',
    );
    expect(current[0]?.schema).toBe(schema);
    const migration = await first.$queryRawUnsafe<Array<{ migrationName: string }>>(
      `SELECT "migration_name" AS "migrationName"
       FROM "_prisma_migrations"
       WHERE "migration_name" = '20260727153000_add_extension_byok_execution_intents'
         AND "finished_at" IS NOT NULL`,
    );
    expect(migration).toHaveLength(1);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('commits only one of two concurrent batches that reserve the same live slot and ordinal', async () => {
    const fixture = await seedFixture(first, 'overlap');
    const left = batchInput(fixture, 'overlap-left');
    const right = batchInput(fixture, 'overlap-right');
    const leftRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    const rightRepository = createPrismaExtensionByokExecutionBatchRepository(second as never);

    const results = await Promise.all([
      leftRepository.claimBatch(left),
      rightRepository.claimBatch(right),
    ]);

    expect(results.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'reservation_conflict')).toHaveLength(1);
    const counts = await first.$queryRawUnsafe<Array<{
      batches: number;
      items: number;
      intents: number;
    }>>(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM "extension_byok_execution_batches"
          WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2) AS "batches",
         (SELECT COUNT(*)::INTEGER FROM "extension_byok_execution_batch_items"
          WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2) AS "items",
         (SELECT COUNT(*)::INTEGER FROM "extension_byok_execution_intents"
          WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2) AS "intents"`,
      fixture.ownerUserId,
      fixture.listingWorkflowId,
    );
    expect(counts[0]).toEqual({ batches: 1, items: 1, intents: 1 });
  }, 30_000);

  it('commits only one of two different slots that reserve the same live ordinal', async () => {
    const fixture = await seedFixture(first, 'ordinal-overlap');
    const hero = batchInput(fixture, 'ordinal-hero');
    const detail = batchInput(fixture, 'ordinal-detail', {
      skuKey: 'sku-1',
      slotKey: 'shared:detail:SCENE',
      assignmentOrdinal: 0,
    });
    const leftRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    const rightRepository = createPrismaExtensionByokExecutionBatchRepository(second as never);

    const results = await Promise.all([
      leftRepository.claimBatch(hero),
      rightRepository.claimBatch(detail),
    ]);

    expect(results.filter((result) => result.kind === 'created')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'reservation_conflict')).toHaveLength(1);
  }, 30_000);

  it('classifies an exact concurrent retry as one create and one replay', async () => {
    const fixture = await seedFixture(first, 'replay');
    const input = batchInput(fixture, 'same-request');
    const leftRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    const rightRepository = createPrismaExtensionByokExecutionBatchRepository(second as never);

    const results = await Promise.all([
      leftRepository.claimBatch(input),
      rightRepository.claimBatch(input),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(['created', 'replayed']);
    const replay = results.find((result) => result.kind === 'replayed');
    expect(replay).toMatchObject({
      batch: { id: input.batch.id },
      intents: [{ id: input.intents[0]!.id, executionBatchAttemptIndex: 0 }],
    });
  }, 30_000);

  it('returns not-found when another device probes an owner idempotency key', async () => {
    const fixture = await seedFixture(first, 'idempotency-device-fence');
    const input = batchInput(fixture, 'idempotency-device-fence');
    const repository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    await expect(repository.claimBatch(input)).resolves.toMatchObject({ kind: 'created' });
    const otherDeviceSessionId = await seedSecondDevice(first, fixture, 'other-device');

    await expect(repository.loadBatchStateByIdempotency({
      identity: {
        ownerUserId: fixture.ownerUserId,
        actorUserId: fixture.ownerUserId,
        deviceSessionId: otherDeviceSessionId,
      },
      idempotencyKey: input.batch.idempotencyKey,
    })).resolves.toEqual({ kind: 'not_found' });
  }, 30_000);

  it('atomically replaces a terminal orphan reservation from a revoked same-device session', async () => {
    const fixture = await seedFixture(first, 'revoked-same-device');
    const orphan = batchInput(fixture, 'orphan');
    const batchRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    const intentRepository = createPrismaExtensionByokExecutionIntentRepository(first as never);
    await expect(batchRepository.claimBatch(orphan)).resolves.toMatchObject({ kind: 'created' });
    const orphanIntent = orphan.intents[0]!;
    await expect(intentRepository.recordOutcome({
      identity: {
        ownerUserId: fixture.ownerUserId,
        actorUserId: fixture.ownerUserId,
        deviceSessionId: fixture.deviceSessionId,
      },
      intentId: orphanIntent.id,
      providerIdempotencyKey: orphanIntent.providerIdempotencyKey,
      providerRequestHash: orphanIntent.providerRequestHash,
      outcome: 'SUCCEEDED',
      providerRequestIdSha256: null,
      resultSha256: digest(`${orphanIntent.id}:result`),
      outcomeUpdatedAt: new Date(),
    })).resolves.toMatchObject({ kind: 'updated' });
    await first.extensionDeviceSession.update({
      where: { id: fixture.deviceSessionId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'PAIRING_APPROVED' },
    });
    const replacementSessionId = await seedSecondDevice(
      first,
      fixture,
      'replacement',
      fixture.deviceId,
    );
    const replacementFixture = { ...fixture, deviceSessionId: replacementSessionId };
    const replacement = batchInput(replacementFixture, 'replacement');

    await expect(batchRepository.claimBatch(replacement)).resolves.toMatchObject({
      kind: 'created',
      batch: { id: replacement.batch.id },
    });
    const stored = await first.$queryRawUnsafe<Array<{
      batchStatus: string;
      itemStatus: string;
    }>>(
      `SELECT batch."status" AS "batchStatus", item."status" AS "itemStatus"
       FROM "extension_byok_execution_batches" batch
       JOIN "extension_byok_execution_batch_items" item ON item."batch_id" = batch."id"
       WHERE batch."id" = $1`,
      orphan.batch.id,
    );
    expect(stored).toEqual([{ batchStatus: 'CANCELLED', itemStatus: 'RELEASED' }]);
  }, 30_000);

  it('keeps pending attempts fenced after a same-device session replacement', async () => {
    const fixture = await seedFixture(first, 'revoked-same-device-pending');
    const orphan = batchInput(fixture, 'orphan');
    const batchRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    await expect(batchRepository.claimBatch(orphan)).resolves.toMatchObject({ kind: 'created' });
    await first.extensionDeviceSession.update({
      where: { id: fixture.deviceSessionId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'PAIRING_APPROVED' },
    });
    const replacementSessionId = await seedSecondDevice(
      first,
      fixture,
      'replacement',
      fixture.deviceId,
    );
    const replacement = batchInput(
      { ...fixture, deviceSessionId: replacementSessionId },
      'replacement',
    );

    await expect(batchRepository.claimBatch(replacement)).resolves.toEqual({
      kind: 'reservation_conflict',
    });
  }, 30_000);

  it('keeps revoked-session reservations fenced across different physical devices', async () => {
    const fixture = await seedFixture(first, 'revoked-other-device');
    const orphan = batchInput(fixture, 'orphan');
    const batchRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    await expect(batchRepository.claimBatch(orphan)).resolves.toMatchObject({ kind: 'created' });
    await first.extensionDeviceSession.update({
      where: { id: fixture.deviceSessionId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'PAIRING_APPROVED' },
    });
    const replacementSessionId = await seedSecondDevice(first, fixture, 'other-device');
    const replacement = batchInput({ ...fixture, deviceSessionId: replacementSessionId }, 'replacement');

    await expect(batchRepository.claimBatch(replacement)).resolves.toEqual({
      kind: 'reservation_conflict',
    });
  }, 30_000);

  it('lets a standalone pre-dispatch claim block a later overlapping batch reservation', async () => {
    const fixture = await seedFixture(first, 'standalone-first');
    const standalone = standaloneIntent(fixture, 'standalone-first');
    const batch = batchInput(fixture, 'batch-second');
    const intentRepository = createPrismaExtensionByokExecutionIntentRepository(first as never);
    const batchRepository = createPrismaExtensionByokExecutionBatchRepository(second as never);

    await expect(intentRepository.claim(standalone)).resolves.toMatchObject({ kind: 'created' });
    await expect(batchRepository.claimBatch(batch)).resolves.toEqual({
      kind: 'reservation_conflict',
    });

    const counts = await first.$queryRawUnsafe<Array<{ batches: number; intents: number }>>(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM "extension_byok_execution_batches"
          WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2) AS "batches",
         (SELECT COUNT(*)::INTEGER FROM "extension_byok_execution_intents"
          WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2) AS "intents"`,
      fixture.ownerUserId,
      fixture.listingWorkflowId,
    );
    expect(counts[0]).toEqual({ batches: 0, intents: 1 });
  }, 30_000);

  it('lets a batch reservation block a later overlapping standalone pre-dispatch claim', async () => {
    const fixture = await seedFixture(first, 'batch-first');
    const batch = batchInput(fixture, 'batch-first');
    const standalone = standaloneIntent(fixture, 'standalone-second');
    const batchRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    const intentRepository = createPrismaExtensionByokExecutionIntentRepository(second as never);

    await expect(batchRepository.claimBatch(batch)).resolves.toMatchObject({ kind: 'created' });
    await expect(intentRepository.claim(standalone)).resolves.toEqual({
      kind: 'reservation_conflict',
    });

    const counts = await first.$queryRawUnsafe<Array<{ batches: number; intents: number }>>(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM "extension_byok_execution_batches"
          WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2) AS "batches",
         (SELECT COUNT(*)::INTEGER FROM "extension_byok_execution_intents"
          WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2) AS "intents"`,
      fixture.ownerUserId,
      fixture.listingWorkflowId,
    );
    expect(counts[0]).toEqual({ batches: 1, intents: 1 });
  }, 30_000);

  it('allows a terminal successor, replays it exactly, then releases only terminal attempts', async () => {
    const fixture = await seedFixture(first, 'successor');
    const input = batchInput(fixture, 'successor-base');
    const batchRepository = createPrismaExtensionByokExecutionBatchRepository(first as never);
    const intentRepository = createPrismaExtensionByokExecutionIntentRepository(first as never);
    await expect(batchRepository.claimBatch(input)).resolves.toMatchObject({ kind: 'created' });
    const firstIntent = input.intents[0]!;
    await expect(intentRepository.recordOutcome({
      identity: {
        ownerUserId: fixture.ownerUserId,
        actorUserId: fixture.ownerUserId,
        deviceSessionId: fixture.deviceSessionId,
      },
      intentId: firstIntent.id,
      providerIdempotencyKey: firstIntent.providerIdempotencyKey,
      providerRequestHash: firstIntent.providerRequestHash,
      outcome: 'FAILED_FINAL',
      providerRequestIdSha256: null,
      resultSha256: null,
      outcomeUpdatedAt: new Date(),
    })).resolves.toMatchObject({ kind: 'updated' });

    const requested: ExtensionByokExecutionIntentRecord = {
      ...firstIntent,
      id: `${firstIntent.id}_successor`,
      providerIdempotencyKey: `${firstIntent.providerIdempotencyKey}_successor`,
      providerRequestHash: digest(`${firstIntent.id}:successor-provider-request`),
      requestHash: digest(`${firstIntent.id}:successor-request`),
      executionBatchItemId: null,
      executionBatchAttemptIndex: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const successorInput = {
      identity: {
        ownerUserId: fixture.ownerUserId,
        actorUserId: fixture.ownerUserId,
        deviceSessionId: fixture.deviceSessionId,
      },
      batchId: input.batch.id,
      itemIndex: 0,
      currentIntentId: firstIntent.id,
      intent: requested,
    };
    await expect(batchRepository.claimSuccessor(successorInput)).resolves.toMatchObject({
      kind: 'created', intent: { executionBatchAttemptIndex: 1 },
    });
    await expect(batchRepository.claimSuccessor({
      ...successorInput,
      intent: { ...requested, id: `${requested.id}_retry` },
    })).resolves.toMatchObject({
      kind: 'replayed', intent: { id: requested.id, executionBatchAttemptIndex: 1 },
    });
    await expect(batchRepository.cancelBatch({
      identity: successorInput.identity,
      batchId: input.batch.id,
      now: new Date(),
    })).resolves.toEqual({ kind: 'attempt_blocked' });

    await expect(intentRepository.recordOutcome({
      identity: successorInput.identity,
      intentId: requested.id,
      providerIdempotencyKey: requested.providerIdempotencyKey,
      providerRequestHash: requested.providerRequestHash,
      outcome: 'FAILED_FINAL',
      providerRequestIdSha256: null,
      resultSha256: null,
      outcomeUpdatedAt: new Date(),
    })).resolves.toMatchObject({ kind: 'updated' });
    await expect(batchRepository.cancelBatch({
      identity: successorInput.identity,
      batchId: input.batch.id,
      now: new Date(),
    })).resolves.toMatchObject({ kind: 'cancelled', batch: { status: 'CANCELLED' } });
    const released = await first.$queryRawUnsafe<Array<{
      status: string;
      releasedAt: Date | null;
    }>>(
      `SELECT "status", "released_at" AS "releasedAt"
       FROM "extension_byok_execution_batch_items" WHERE "id" = $1`,
      input.items[0]!.id,
    );
    expect(released).toMatchObject([{ status: 'RELEASED' }]);
    expect(released[0]?.releasedAt).toBeInstanceOf(Date);
  }, 30_000);
});
