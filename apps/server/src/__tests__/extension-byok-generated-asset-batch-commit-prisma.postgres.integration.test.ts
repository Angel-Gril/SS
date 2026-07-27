import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaExtensionByokGeneratedAssetBatchCommitter,
  deriveExtensionByokBatchItemIdempotencyKey,
  type CommitExtensionByokGeneratedAssetBatchInput,
} from '../repositories/extension-byok-generated-asset-batch-commit-prisma.js';
import {
  createPrismaExtensionByokGeneratedAssetCommitter,
  type CommitExtensionByokGeneratedAssetInput,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';
import {
  BYOK_GENERATED_ASSET_INGEST_VERSION,
  BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
  deriveByokGeneratedAssetIdentity,
  type ByokGeneratedAssetCreateInput,
} from '../services/byok-generated-asset-ingest.js';
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
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  type ExtensionByokMediaBatchIngestResolvedCommand,
  type ExtensionByokMediaIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  createExtensionCommandGrantService,
  digestExtensionCommandGrantToken,
  hashExtensionCommandRequest,
  type ExtensionCommandBinding,
} from '../services/extension-command-grants.js';
import {
  createPrismaExtensionCommandGrantStore,
} from '../services/extension-command-grants-prisma.js';
import {
  createPrismaSourceListingWorkflowRepository,
} from '../services/source-listing-workflow-prisma.js';
import {
  createSourceListingWorkflowService,
} from '../services/source-listing-workflow.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const commandSecret = 'byok-batch-commit-postgres-command-secret-0123456789';
const providerOrigin = 'https://provider.example';

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

interface Fixture {
  ownerUserId: string;
  deviceSessionId: string;
  tokenId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  sourceProductId: string;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
}

interface ReservedBatch {
  fixture: Fixture;
  record: ExtensionByokExecutionBatchCreateRecord;
  command: ExtensionByokMediaBatchIngestResolvedCommand;
}

async function seedFixture(client: PrismaClient, label: string): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const prefix = `byok_batch_commit_${label}_${suffix}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const supplyGoodsId = `${prefix}_goods`;
  const subjectId = `${prefix}_subject`;
  const sourceProductId = `${prefix}_product`;
  const sourceCaptureSnapshotId = `${prefix}_snapshot`;
  const pairingCodeId = `${prefix}_pairing`;
  const deviceSessionId = `${prefix}_session`;
  const tokenId = `${prefix}_jti`;
  const now = new Date();
  const captureHash = sha256(`${prefix}:capture`);

  await client.user.create({
    data: { id: ownerUserId, phone: `${prefix}_phone`, passwordHash: 'integration-test' },
  });
  await client.shop.create({
    data: {
      id: shopId,
      userId: ownerUserId,
      platform: 'OZON',
      name: `${prefix} shop`,
      apiKeyEncrypted: 'integration-test',
    },
  });
  await client.supplyGoods.create({
    data: {
      id: supplyGoodsId,
      userId: ownerUserId,
      title: 'BYOK batch commit fixture',
      sourcePlatform: '1688',
      sourceProductId,
    },
  });
  await client.sourceCaptureSubject.create({
    data: {
      id: subjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId,
      legacySupplyGoodsId: supplyGoodsId,
    },
  });
  await client.sourceCaptureSnapshot.create({
    data: {
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
      parserVersion: 'byok-batch-commit-integration',
      completeness: {},
      truncations: [],
      hasEstimatedValues: false,
      profile: {},
      profileHash: sha256(`${prefix}:profile`),
      actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'byok-batch-commit-integration',
      rolloutStage: 'v2_only',
      capturedAt: now,
    },
  });

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
    selectedSkuKeys: ['sku-1'],
  });
  await client.extensionDevicePairingCode.create({
    data: {
      id: pairingCodeId,
      deploymentId: 'byok-batch-commit-integration',
      actorUserId: ownerUserId,
      ownerUserId,
      codeDigest: sha256(`${prefix}:pairing`),
      shopIds: [shopId],
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
      deploymentId: 'byok-batch-commit-integration',
      deviceId: `${prefix}_device`,
      actorUserId: ownerUserId,
      ownerUserId,
      scopes: ['byok:media:ingest'],
      currentJti: tokenId,
      expiresAt: new Date(now.getTime() + 3_600_000),
    },
  });
  await client.extensionDeviceShopGrant.create({
    data: { sessionId: deviceSessionId, shopId, status: 'ACTIVE', grantedAt: now },
  });

  return {
    ownerUserId,
    deviceSessionId,
    tokenId,
    shopId,
    listingWorkflowId: draft.id,
    draftRevision: draft.revision,
    draftVersion: draft.draftVersion,
    sourceProductId,
    sourceCaptureSnapshotId,
    supplyGoodsId,
  };
}

function commandsFor(fixture: Fixture, label: string): ExtensionByokMediaIngestResolvedCommand[] {
  return [
    { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
    { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' },
  ].map((target, index) => ({
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin,
    providerOperation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    model: 'image-model-v1',
    executionIntentId: `${fixture.listingWorkflowId}_${label}_intent_${index + 1}`,
    providerIdempotencyKey: `provider-attempt-${label}-${index + 1}-0001`,
    providerRequestHash: sha256(`${fixture.listingWorkflowId}:${label}:provider:${index}`),
    providerRequestIdSha256: sha256(`${fixture.listingWorkflowId}:${label}:request-id:${index}`),
    promptSha256: sha256(`${fixture.listingWorkflowId}:${label}:prompt:${index}`),
    negativePromptSha256: null,
    draftRevision: fixture.draftRevision,
    skuKey: target.skuKey,
    slotKey: target.slotKey,
    assignmentOrdinal: index,
    assignmentMode: 'APPEND',
    replaceConfirmed: false,
    resultSha256: sha256(`${fixture.listingWorkflowId}:${label}:result:${index}`),
    resultMimeType: 'image/png',
    resultSizeBytes: 68,
    sourceSha256: null,
    referenceSha256s: [],
    maskSha256: null,
    readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 7 },
    authority: { sourceCaptureSnapshotId: fixture.sourceCaptureSnapshotId },
  }));
}

async function reserveBatch(
  client: PrismaClient,
  fixture: Fixture,
  label: string,
  successfulItemIndexes: number[] = [0, 1],
): Promise<ReservedBatch> {
  const commands = commandsFor(fixture, label);
  const batchId = `${fixture.listingWorkflowId}_${label}_batch`;
  const createdAt = new Date();
  const intents: ExtensionByokExecutionIntentRecord[] = commands.map((command, index) => ({
    id: command.executionIntentId,
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
    skuKey: command.skuKey,
    slotKey: command.slotKey,
    assignmentMode: 'APPEND',
    assignmentOrdinal: command.assignmentOrdinal,
    policyRevision: command.readiness.policyRevision,
    providerOriginSha256: sha256(command.providerOrigin),
    model: command.model,
    operation: command.providerOperation,
    requestMode: command.requestMode,
    providerIdempotencyKey: command.providerIdempotencyKey,
    providerRequestHash: command.providerRequestHash,
    requestHash: sha256(`${fixture.listingWorkflowId}:${label}:intent:${index}`),
    executionBatchItemId: `${batchId}_item_${index + 1}`,
    executionBatchAttemptIndex: 0,
    outcome: 'PENDING',
    providerRequestIdSha256: null,
    resultSha256: null,
    outcomeUpdatedAt: null,
    createdAt,
    updatedAt: createdAt,
  }));
  const record: ExtensionByokExecutionBatchCreateRecord = {
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
      firstAssignmentOrdinal: 0,
      itemCount: commands.length,
      idempotencyKey: `batch-reservation-${sha256(batchId).slice(0, 32)}`,
      requestHash: sha256(`${batchId}:reservation`),
      boundDraftRevision: null,
      boundDraftVersion: null,
      boundAt: null,
      cancelledAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    items: commands.map((command, index) => ({
      id: `${batchId}_item_${index + 1}`,
      batchId,
      ownerUserId: fixture.ownerUserId,
      listingWorkflowId: fixture.listingWorkflowId,
      draftRevision: fixture.draftRevision,
      draftVersion: fixture.draftVersion,
      itemIndex: index,
      skuKey: command.skuKey,
      slotKey: command.slotKey,
      assignmentOrdinal: command.assignmentOrdinal,
      status: 'ACTIVE',
      boundAt: null,
      releasedAt: null,
      createdAt,
      updatedAt: createdAt,
    })),
    intents,
  };
  const batchRepository = createPrismaExtensionByokExecutionBatchRepository(client as never);
  await expect(batchRepository.claimBatch(record)).resolves.toMatchObject({ kind: 'created' });

  const intentRepository = createPrismaExtensionByokExecutionIntentRepository(client as never);
  for (const index of successfulItemIndexes) {
    const intent = intents[index]!;
    const command = commands[index]!;
    await expect(intentRepository.recordOutcome({
      identity: {
        ownerUserId: fixture.ownerUserId,
        actorUserId: fixture.ownerUserId,
        deviceSessionId: fixture.deviceSessionId,
      },
      intentId: intent.id,
      providerIdempotencyKey: intent.providerIdempotencyKey,
      providerRequestHash: intent.providerRequestHash,
      outcome: 'SUCCEEDED',
      providerRequestIdSha256: command.providerRequestIdSha256,
      resultSha256: command.resultSha256,
      outcomeUpdatedAt: new Date(),
    })).resolves.toMatchObject({ kind: 'updated' });
  }
  return {
    fixture,
    record,
    command: {
      schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
      executionBatchId: batchId,
      items: commands,
    },
  };
}

async function issueGrant(
  client: PrismaClient,
  fixture: Fixture,
  label: string,
  command: Record<string, unknown>,
): Promise<{ binding: ExtensionCommandBinding; tokenDigest: string }> {
  const binding: ExtensionCommandBinding = {
    sessionId: fixture.deviceSessionId,
    tokenId: fixture.tokenId,
    ownerUserId: fixture.ownerUserId,
    shopId: fixture.shopId,
    operation: 'BYOK_MEDIA_INGEST',
    workflowId: fixture.listingWorkflowId,
    draftVersion: fixture.draftVersion,
    idempotencyKey: `byok-ingest-${label}-${sha256(fixture.listingWorkflowId).slice(0, 24)}`,
    requestHash: hashExtensionCommandRequest({
      operation: 'BYOK_MEDIA_INGEST',
      shopId: fixture.shopId,
      workflowId: fixture.listingWorkflowId,
      draftVersion: fixture.draftVersion,
      command,
    }),
  };
  const service = createExtensionCommandGrantService({
    store: createPrismaExtensionCommandGrantStore({ client }),
    secret: commandSecret,
  });
  const grant = await service.issue(binding);
  return {
    binding,
    tokenDigest: digestExtensionCommandGrantToken(commandSecret, grant.token),
  };
}

function assetFor(
  fixture: Fixture,
  command: ExtensionByokMediaIngestResolvedCommand,
  idempotencyKey: string,
  requestHash: string,
): ByokGeneratedAssetCreateInput {
  const identity = deriveByokGeneratedAssetIdentity({
    ownerUserId: fixture.ownerUserId,
    sourceCaptureSnapshotId: fixture.sourceCaptureSnapshotId,
    idempotencyKey,
    requestHash,
    expectedProviderResultSha256: command.resultSha256,
    declaredMimeType: command.resultMimeType,
    declaredSizeBytes: command.resultSizeBytes,
  });
  return {
    id: identity.assetId,
    ownerUserId: fixture.ownerUserId,
    aiImageJobId: null,
    kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: fixture.sourceCaptureSnapshotId,
    sourceMediaKey: identity.sourceMediaKey,
    sourceUrl: null,
    url: `https://cdn.example/${identity.assetId}.png`,
    storageBackend: 'oss',
    storageKey: `users/${fixture.ownerUserId}/${identity.assetId}.png`,
    mimeType: 'image/png',
    sizeBytes: command.resultSizeBytes,
    width: 1,
    height: 1,
    sha256: command.resultSha256,
    metadata: {
      ingestContractVersion: BYOK_GENERATED_ASSET_INGEST_VERSION,
      normalizerVersion: BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
      generatedAssetSource: 'EXTENSION_BYOK',
      executionMode: 'BYOK',
      outputRole: 'BYOK_ACCEPTED',
      pixelOrientationNormalized: true,
      idempotencyKeySha256: identity.idempotencyKeySha256,
      requestHash,
      providerResultSha256: command.resultSha256,
      providerResultMimeType: command.resultMimeType,
      providerResultSizeBytes: command.resultSizeBytes,
      normalizedSha256: command.resultSha256,
    },
  };
}

async function batchCommitInput(
  client: PrismaClient,
  batch: ReservedBatch,
  label: string,
): Promise<CommitExtensionByokGeneratedAssetBatchInput> {
  const grant = await issueGrant(client, batch.fixture, label, batch.command);
  return {
    binding: grant.binding,
    tokenDigest: grant.tokenDigest,
    receiptId: `batch-receipt-${label}-${randomUUID()}`,
    actorUserId: batch.fixture.ownerUserId,
    now: new Date(),
    command: batch.command,
    items: batch.command.items.map((command) => ({
      asset: assetFor(
        batch.fixture,
        command,
        deriveExtensionByokBatchItemIdempotencyKey(
          grant.binding.idempotencyKey,
          command.executionIntentId,
        ),
        grant.binding.requestHash,
      ),
      stagingId: null,
    })),
  };
}

async function singleCommitInput(
  client: PrismaClient,
  batch: ReservedBatch,
  label: string,
): Promise<CommitExtensionByokGeneratedAssetInput> {
  const command = batch.command.items[0]!;
  const grant = await issueGrant(client, batch.fixture, label, command);
  return {
    binding: grant.binding,
    tokenDigest: grant.tokenDigest,
    receiptId: `single-receipt-${label}-${randomUUID()}`,
    actorUserId: batch.fixture.ownerUserId,
    now: new Date(),
    command,
    asset: assetFor(batch.fixture, command, grant.binding.idempotencyKey, grant.binding.requestHash),
    stagingId: null,
  };
}

interface StoredExecutionBatch {
  status: string;
  boundDraftRevision: number | null;
  boundDraftVersion: number | null;
  boundAt: Date | null;
}

interface StoredExecutionBatchItem {
  itemIndex: number;
  status: string;
  boundAt: Date | null;
}

async function executionBatchState(client: PrismaClient, batchId: string): Promise<{
  batch: StoredExecutionBatch | null;
  items: StoredExecutionBatchItem[];
}> {
  const [batches, items] = await Promise.all([
    client.$queryRawUnsafe<StoredExecutionBatch[]>(
      `SELECT
         "status",
         "bound_draft_revision" AS "boundDraftRevision",
         "bound_draft_version" AS "boundDraftVersion",
         "bound_at" AS "boundAt"
       FROM "extension_byok_execution_batches"
       WHERE "id" = $1`,
      batchId,
    ),
    client.$queryRawUnsafe<StoredExecutionBatchItem[]>(
      `SELECT
         "item_index" AS "itemIndex",
         "status",
         "bound_at" AS "boundAt"
       FROM "extension_byok_execution_batch_items"
       WHERE "batch_id" = $1
       ORDER BY "item_index"`,
      batchId,
    ),
  ]);
  return { batch: batches[0] || null, items };
}

async function countExecutionBatchItems(client: PrismaClient, batchId: string): Promise<number> {
  const rows = await client.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::INTEGER AS "count"
     FROM "extension_byok_execution_batch_items"
     WHERE "batch_id" = $1`,
    batchId,
  );
  return Number(rows[0]?.count || 0);
}

async function mutationCounts(client: PrismaClient, batch: ReservedBatch) {
  const ownerUserId = batch.fixture.ownerUserId;
  const workflowId = batch.fixture.listingWorkflowId;
  const batchId = batch.record.batch.id;
  const [
    assets,
    provenance,
    grants,
    receipts,
    draftVersions,
    workflowEvents,
    intents,
    batchItems,
    costReservations,
    costSettlements,
  ] = await Promise.all([
    client.mediaAsset.count({ where: { ownerUserId } }),
    client.extensionByokMediaProvenance.count({ where: { ownerUserId } }),
    client.extensionCommandGrant.count({ where: { ownerUserId } }),
    client.extensionCommandReceipt.count({ where: { grant: { ownerUserId } } }),
    client.sourceListingDraftVersion.count({ where: { workflowId, ownerUserId } }),
    client.sourceListingWorkflowEvent.count({ where: { workflowId, ownerUserId } }),
    client.extensionByokExecutionIntent.count({ where: { ownerUserId, listingWorkflowId: workflowId } }),
    countExecutionBatchItems(client, batchId),
    client.aiCostReservation.count({ where: { ownerUserId } }),
    client.aiCostSettlement.count({ where: { ownerUserId } }),
  ]);
  return {
    assets,
    provenance,
    grants,
    receipts,
    draftVersions,
    workflowEvents,
    intents,
    batchItems,
    costReservations,
    costSettlements,
  };
}

describePostgres('extension BYOK generated asset batch commit PostgreSQL integration', () => {
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
       WHERE "migration_name" = '20260727153000_add_extension_byok_execution_intents'
         AND "finished_at" IS NOT NULL`,
    );
    expect(migration).toHaveLength(1);
  }, 30_000);

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('atomically binds a SKU hero and shared detail, then replays without new rows', async () => {
    const fixture = await seedFixture(client, 'success');
    const batch = await reserveBatch(client, fixture, 'success');
    const input = await batchCommitInput(client, batch, 'success');
    const workflow = createSourceListingWorkflowService({
      repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    });
    const beforeDraft = await workflow.getDraft({
      draftId: fixture.listingWorkflowId,
      ownerUserId: fixture.ownerUserId,
    });
    const commit = createPrismaExtensionByokGeneratedAssetBatchCommitter(client as never);

    const result = await commit(input);

    expect(result).toMatchObject({
      replayed: false,
      receipt: {
        executionBatchId: batch.record.batch.id,
        sourceDraftRevision: fixture.draftRevision,
        sourceDraftVersion: fixture.draftVersion,
        boundDraftRevision: fixture.draftRevision + 1,
        boundDraftVersion: fixture.draftVersion + 1,
        erpAiChargeCents: 0,
      },
    });
    expect(result.receipt.items).toEqual([
      expect.objectContaining({
        executionIntentId: batch.command.items[0]!.executionIntentId,
        skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero',
        assignmentOrdinal: 0,
        assignment: expect.objectContaining({ scope: 'SKU', skuKey: 'sku-1' }),
      }),
      expect.objectContaining({
        executionIntentId: batch.command.items[1]!.executionIntentId,
        skuKey: 'sku-1',
        slotKey: 'shared:detail:DETAIL',
        assignmentOrdinal: 1,
        assignment: expect.objectContaining({ scope: 'PRODUCT' }),
      }),
    ]);

    const [boundDraft, provenance, storedExecutionBatch, storedReceipt, counts] =
      await Promise.all([
        workflow.getDraft({
          draftId: fixture.listingWorkflowId,
          ownerUserId: fixture.ownerUserId,
        }),
        client.extensionByokMediaProvenance.findMany({
          where: { ownerUserId: fixture.ownerUserId },
          orderBy: { assignmentOrdinal: 'asc' },
        }),
        executionBatchState(client, batch.record.batch.id),
        client.extensionCommandReceipt.findUnique({ where: { id: result.receiptId } }),
        mutationCounts(client, batch),
      ]);
    expect(boundDraft).toMatchObject({
      revision: beforeDraft.revision + 1,
      draftVersion: beforeDraft.draftVersion + 1,
      validation: { status: 'STALE' },
      media: {
        assignments: [
          expect.objectContaining({
            scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', source: 'GENERATED',
          }),
          expect.objectContaining({
            scope: 'PRODUCT', slotKey: 'shared:detail:DETAIL', source: 'GENERATED',
          }),
        ],
      },
    });
    expect(provenance).toHaveLength(2);
    expect(provenance.map((row) => row.executionIntentId)).toEqual(
      batch.command.items.map((command) => command.executionIntentId),
    );
    expect(provenance.every((row) => row.erpAiChargeCents === 0)).toBe(true);
    expect(storedExecutionBatch.batch).toMatchObject({
      status: 'BOUND',
      boundDraftRevision: fixture.draftRevision + 1,
      boundDraftVersion: fixture.draftVersion + 1,
      boundAt: expect.any(Date),
    });
    expect(storedExecutionBatch.items).toHaveLength(2);
    expect(storedExecutionBatch.items.every((item) => (
      item.status === 'BOUND' && item.boundAt instanceof Date
    )))
      .toBe(true);
    expect(storedReceipt).toMatchObject({
      status: 'SUCCEEDED', failureCode: null, completedAt: expect.any(Date),
    });
    expect(storedReceipt?.result).toMatchObject({ erpAiChargeCents: 0 });
    expect(storedReceipt?.result).not.toHaveProperty('receiptId');
    expect(counts).toMatchObject({
      assets: 2,
      provenance: 2,
      receipts: 1,
      draftVersions: 2,
      intents: 2,
      batchItems: 2,
      costReservations: 0,
      costSettlements: 0,
    });

    const replay = await commit({ ...input, receiptId: `unused-${randomUUID()}` });
    expect(replay).toMatchObject({ replayed: true, receiptId: result.receiptId });
    expect(replay.receipt).toEqual(result.receipt);
    const [replayCounts, replayedDraft] = await Promise.all([
      mutationCounts(client, batch),
      workflow.getDraft({
        draftId: fixture.listingWorkflowId,
        ownerUserId: fixture.ownerUserId,
      }),
    ]);
    expect(replayCounts).toEqual(counts);
    expect(replayedDraft).toEqual(boundDraft);
  }, 30_000);

  it('recovers the provenance-bound success after a later regeneration fails', async () => {
    const fixture = await seedFixture(client, 'bound-selected-attempt');
    const batch = await reserveBatch(client, fixture, 'bound-selected-attempt');
    const batchRepository = createPrismaExtensionByokExecutionBatchRepository(client as never);
    const intentRepository = createPrismaExtensionByokExecutionIntentRepository(client as never);
    const selectedIntent = batch.record.intents[0]!;
    const laterIntent: ExtensionByokExecutionIntentRecord = {
      ...selectedIntent,
      id: `${selectedIntent.id}_later_failed`,
      providerIdempotencyKey: `${selectedIntent.providerIdempotencyKey}_later`,
      providerRequestHash: sha256(`${selectedIntent.id}:later-provider-request`),
      requestHash: sha256(`${selectedIntent.id}:later-intent-request`),
      executionBatchItemId: null,
      executionBatchAttemptIndex: null,
      outcome: 'PENDING',
      providerRequestIdSha256: null,
      resultSha256: null,
      outcomeUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const identity = {
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      deviceSessionId: fixture.deviceSessionId,
    };
    await expect(batchRepository.claimSuccessor({
      identity,
      batchId: batch.record.batch.id,
      itemIndex: 0,
      currentIntentId: selectedIntent.id,
      intent: laterIntent,
    })).resolves.toMatchObject({
      kind: 'created',
      intent: { id: laterIntent.id, executionBatchAttemptIndex: 1 },
    });
    await expect(intentRepository.recordOutcome({
      identity,
      intentId: laterIntent.id,
      providerIdempotencyKey: laterIntent.providerIdempotencyKey,
      providerRequestHash: laterIntent.providerRequestHash,
      outcome: 'FAILED_FINAL',
      providerRequestIdSha256: null,
      resultSha256: null,
      outcomeUpdatedAt: new Date(),
    })).resolves.toMatchObject({ kind: 'updated' });

    const input = await batchCommitInput(client, batch, 'bound-selected-attempt');
    const commit = createPrismaExtensionByokGeneratedAssetBatchCommitter(client as never);
    await expect(commit(input)).resolves.toMatchObject({ replayed: false });
    await expect(commit({ ...input, receiptId: `unused-${randomUUID()}` }))
      .resolves.toMatchObject({ replayed: true });
    await expect(batchRepository.loadBatchState({
      identity,
      batchId: batch.record.batch.id,
    })).resolves.toMatchObject({
      kind: 'found',
      batch: { status: 'BOUND' },
      items: [
        { item: { itemIndex: 0 }, intent: { id: selectedIntent.id, outcome: 'SUCCEEDED' } },
        { item: { itemIndex: 1 }, intent: { id: batch.record.intents[1]!.id } },
      ],
    });
  }, 30_000);

  it('rolls back the whole batch when any execution intent is not successful', async () => {
    const fixture = await seedFixture(client, 'rollback');
    const batch = await reserveBatch(client, fixture, 'rollback', [0]);
    const input = await batchCommitInput(client, batch, 'rollback');
    const workflow = createSourceListingWorkflowService({
      repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    });
    const before = await mutationCounts(client, batch);
    const beforeDraft = await workflow.getDraft({
      draftId: fixture.listingWorkflowId,
      ownerUserId: fixture.ownerUserId,
    });

    await expect(createPrismaExtensionByokGeneratedAssetBatchCommitter(client as never)(input))
      .rejects.toMatchObject({
        code: 'BYOK_INGEST_EXECUTION_INTENT_OUTCOME_PENDING',
        statusCode: 409,
      });

    const [after, afterDraft, grant, storedExecutionBatch] = await Promise.all([
      mutationCounts(client, batch),
      workflow.getDraft({
        draftId: fixture.listingWorkflowId,
        ownerUserId: fixture.ownerUserId,
      }),
      client.extensionCommandGrant.findFirst({
        where: {
          sessionId: fixture.deviceSessionId,
          idempotencyKey: input.binding.idempotencyKey,
        },
      }),
      executionBatchState(client, batch.record.batch.id),
    ]);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      assets: 0,
      provenance: 0,
      receipts: 0,
      costReservations: 0,
      costSettlements: 0,
    });
    expect(afterDraft).toMatchObject({
      revision: beforeDraft.revision,
      draftVersion: beforeDraft.draftVersion,
      media: { assignments: [] },
    });
    expect(grant?.consumedAt).toBeNull();
    expect(storedExecutionBatch.batch).toMatchObject({
      status: 'OPEN', boundDraftRevision: null, boundDraftVersion: null, boundAt: null,
    });
    expect(storedExecutionBatch.items.every((item) => (
      item.status === 'ACTIVE' && item.boundAt === null
    ))).toBe(true);
  }, 30_000);

  it('leaves a batch intent unchanged when routed through the legacy single-item committer', async () => {
    const fixture = await seedFixture(client, 'legacy');
    const batch = await reserveBatch(client, fixture, 'legacy');
    const input = await singleCommitInput(client, batch, 'legacy');
    const before = await mutationCounts(client, batch);
    const intentId = batch.command.items[0]!.executionIntentId;
    const workflow = createSourceListingWorkflowService({
      repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    });
    const [beforeIntent, beforeDraft] = await Promise.all([
      client.extensionByokExecutionIntent.findUnique({ where: { id: intentId } }),
      workflow.getDraft({
        draftId: fixture.listingWorkflowId,
        ownerUserId: fixture.ownerUserId,
      }),
    ]);

    await expect(createPrismaExtensionByokGeneratedAssetCommitter(client as never)(input))
      .rejects.toMatchObject({ code: 'BYOK_INGEST_EXECUTION_INTENT_MISMATCH', statusCode: 409 });

    const [after, afterIntent, afterDraft, grant, storedExecutionBatch] = await Promise.all([
      mutationCounts(client, batch),
      client.extensionByokExecutionIntent.findUnique({ where: { id: intentId } }),
      workflow.getDraft({
        draftId: fixture.listingWorkflowId,
        ownerUserId: fixture.ownerUserId,
      }),
      client.extensionCommandGrant.findFirst({
        where: {
          sessionId: fixture.deviceSessionId,
          idempotencyKey: input.binding.idempotencyKey,
        },
      }),
      executionBatchState(client, batch.record.batch.id),
    ]);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ assets: 0, provenance: 0, receipts: 0 });
    expect(afterIntent).toEqual(beforeIntent);
    expect(afterDraft).toEqual(beforeDraft);
    expect(grant?.consumedAt).toBeNull();
    expect(storedExecutionBatch.batch).toMatchObject({ status: 'OPEN', boundAt: null });
    expect(storedExecutionBatch.items.every((item) => (
      item.status === 'ACTIVE' && item.boundAt === null
    ))).toBe(true);
  }, 30_000);
});
