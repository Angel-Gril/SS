import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaOzonPublishAttemptRepository } from '../services/ozon-publish-attempt-prisma.js';
import { hashOzonPublishJson, type OzonPublishJson } from '../services/ozon-publish-attempts.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const runRequested = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1';
const enabled = runRequested && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('LOGISTICS_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

async function seedOwner(client: PrismaClient) {
  const prefix = `publish_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const supplyGoodsId = `${prefix}_goods`;
  const subjectId = `${prefix}_subject`;
  const snapshotId = `${prefix}_snapshot`;
  const catalogSnapshotId = `${prefix}_catalog`;
  const captureHash = 'a'.repeat(64);
  const catalogRevision = 'c'.repeat(64);
  const now = new Date();
  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, $4)',
    ownerUserId, `${prefix}_phone`, 'test-password-hash', now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shops"
      ("id", "user_id", "platform", "name", "api_key_encrypted", "status", "updated_at")
     VALUES ($1, $2, 'OZON', $3, $4, 'ACTIVE', $5)`,
    shopId, ownerUserId, `${prefix} shop`, 'encrypted-test-key', now,
  );
  await client.$executeRawUnsafe(
    'INSERT INTO "supply_goods" ("id", "user_id", "title", "updated_at") VALUES ($1, $2, $3, $4)',
    supplyGoodsId, ownerUserId, `${prefix} goods`, now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "source_capture_subjects"
      ("id", "owner_user_id", "source_platform", "source_product_id",
       "legacy_supply_goods_id", "created_at", "updated_at")
     VALUES ($1, $2, '1688', $3, $4, $5, $5)`,
    subjectId, ownerUserId, `${prefix}_product`, supplyGoodsId, now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "source_capture_snapshots"
      ("id", "subject_id", "version", "schema_version", "capture_hash", "payload_bytes", "payload",
       "stage_counts", "provenance", "provenance_complete", "parser_version", "extension_version",
       "completeness", "truncations", "has_estimated_values", "profile_json", "profile_hash",
       "actor_user_id", "device_session_id", "ingest_channel", "rollout_revision", "rollout_stage",
       "captured_at", "created_at")
     VALUES ($1, $2, 1, 'source-product-capture-v2', $3, 2, '{}'::jsonb, '{}'::jsonb,
             '{}'::jsonb, TRUE, 'unit6a-postgres', NULL, '{}'::jsonb, '[]'::jsonb, FALSE,
             '{}'::jsonb, $4, $5, NULL, 'WEB_ACCOUNT', 'unit6a-postgres', 'v2_only', $6, $6)`,
    snapshotId, subjectId, captureHash, 'b'.repeat(64), ownerUserId, now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "ozon_category_catalog_snapshots"
      ("id", "shop_id", "schema_version", "revision", "fetched_at", "expires_at",
       "complete", "default_tree_complete", "zh_hans_tree_complete", "is_current", "created_at")
     VALUES ($1, $2, 'ozon-category-catalog/v1', $3, $4, $5, TRUE, TRUE, TRUE, TRUE, $4)`,
    catalogSnapshotId, shopId, catalogRevision, now, new Date(now.getTime() + 86_400_000),
  );
  return {
    prefix, ownerUserId, shopId, supplyGoodsId, subjectId, snapshotId, captureHash,
    catalogSnapshotId, catalogRevision, now,
  };
}

function workflowService(
  client: PrismaClient,
  seed: Awaited<ReturnType<typeof seedOwner>>,
  label: string,
) {
  let sequence = 0;
  return createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    now: () => seed.now,
    idFactory: (kind) => `${seed.prefix}_${label}_${kind}_${++sequence}`,
  });
}

function validationReport() {
  return {
    schemaVersion: 'ozon-attribute-validation/v1',
    schemaRevision: 'postgres-fixture-v1',
    normalizedAttributes: [],
    fieldDecisions: [],
    operationReadiness: {
      ozonImport: { status: 'READY', issues: [] },
      inventoryActivation: { status: 'READY', issues: [] },
      costingAutoPricing: { status: 'READY', issues: [] },
    },
  };
}

function strictPricing(skuKeys: string[]) {
  return {
    contractVersion: 'ozon-listing-pricing/v1',
    items: skuKeys.map((skuKey, index) => ({
      skuKey,
      price: String(100 + index),
      oldPrice: String(120 + index),
      currencyCode: 'RUB',
      vat: '0',
    })),
  };
}

async function createPublishIntent(
  client: PrismaClient,
  seed: Awaited<ReturnType<typeof seedOwner>>,
) {
  const service = workflowService(client, seed, 'workflow');
  const draft = await service.createDraft({
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    shopId: seed.shopId,
    supplyGoodsId: seed.supplyGoodsId,
    sourceCaptureSnapshotId: seed.snapshotId,
    sourceCaptureHash: seed.captureHash,
    selectedSkuKeys: ['sku-1'],
  });
  const categorized = await service.setCategory({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: draft.revision,
    category: {
      categoryId: 10,
      typeId: 20,
      catalogRevision: seed.catalogRevision,
    },
  });
  const generated = await service.addAiCopyCandidate({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: categorized.revision,
    titleRu: 'Товар для проверки публикации',
    descriptionRu: 'Описание товара для проверки публикации.',
    sourcePromptVersion: 'unit6a-postgres-v1',
  });
  const copied = await service.applyAiCopyCandidate({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: generated.draft.revision,
    candidateId: generated.candidate.id,
    operationKey: `${seed.prefix}_apply_copy`,
  });
  const hostedAssetId = `${seed.prefix}_erp_hosted_asset_main`;
  const hostedResultSha256 = sha256(`${seed.prefix}:erp-hosted-result`);
  await client.mediaAsset.create({
    data: {
      id: hostedAssetId,
      ownerUserId: seed.ownerUserId,
      kind: 'AI_GENERATED',
      sourceCaptureSnapshotId: seed.snapshotId,
      sourceMediaKey: `erp-hosted:${hostedResultSha256}`,
      sourceUrl: null,
      url: `https://cdn.example/${hostedAssetId}.png`,
      storageBackend: 'oss',
      storageKey: `users/${seed.ownerUserId}/${hostedAssetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 100,
      width: 10,
      height: 10,
      sha256: hostedResultSha256,
      metadata: {
        generatedAssetSource: 'ERP_HOSTED',
        executionMode: 'ERP_HOSTED',
        outputRole: 'HOSTED_ACCEPTED',
      },
    },
  });
  const withMedia = await service.setMediaAssignments({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: copied.revision,
    assignments: [{
      scope: 'PRODUCT',
      slotKey: 'product-main',
      assetId: hostedAssetId,
      source: 'REVIEWED',
    }],
  });
  const priced = await service.setPricing({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: withMedia.revision,
    value: strictPricing(withMedia.selectedSkuKeys),
  });
  const ready = await service.recordValidationResult({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: priced.revision,
    status: 'VALID',
    report: validationReport(),
    blockers: [],
    warnings: [],
  });
  return service.recordPublishIntent({
    draftId: ready.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: ready.revision,
    idempotencyKey: `${seed.prefix}_publish_once`,
  });
}

async function createNextPublishIntent(
  client: PrismaClient,
  seed: Awaited<ReturnType<typeof seedOwner>>,
  input: { draftId: string; currentRevision: number; label: string },
) {
  const service = workflowService(client, seed, input.label);
  const ready = await service.recordValidationResult({
    draftId: input.draftId,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: input.currentRevision,
    status: 'VALID',
    report: validationReport(),
    blockers: [],
    warnings: [],
  });
  return service.recordPublishIntent({
    draftId: ready.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: ready.revision,
    idempotencyKey: `${seed.prefix}_${input.label}_publish_once`,
  });
}

async function createByokPublishFixture(
  client: PrismaClient,
  options: { assetCount?: number } = {},
) {
  const assetCount = options.assetCount ?? 1;
  if (assetCount < 1 || assetCount > 2) {
    throw new Error('BYOK publish fixture supports one or two assets');
  }
  const seed = await seedOwner(client);
  const service = workflowService(client, seed, 'byok_workflow');
  const pairingCodeId = `${seed.prefix}_pairing`;
  const deviceSessionId = `${seed.prefix}_session`;
  const expiresAt = new Date(seed.now.getTime() + 86_400_000);
  await client.extensionDevicePairingCode.create({
    data: {
      id: pairingCodeId,
      deploymentId: 'byok-publish-postgres',
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      codeDigest: sha256(`${seed.prefix}:pairing-code`),
      shopIds: [seed.shopId],
      scopes: ['byok:media:ingest', 'listing:publish'],
      status: 'CLAIMED',
      expiresAt,
      claimedAt: seed.now,
    },
  });
  await client.extensionDeviceSession.create({
    data: {
      id: deviceSessionId,
      pairingCodeId,
      deploymentId: 'byok-publish-postgres',
      deviceId: `${seed.prefix}_device`,
      actorUserId: seed.ownerUserId,
      ownerUserId: seed.ownerUserId,
      scopes: ['byok:media:ingest', 'listing:publish'],
      currentJti: `${seed.prefix}_jti`,
      expiresAt,
    },
  });
  const shopGrant = await client.extensionDeviceShopGrant.create({
    data: { sessionId: deviceSessionId, shopId: seed.shopId },
  });

  const created = await service.createDraft({
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    shopId: seed.shopId,
    supplyGoodsId: seed.supplyGoodsId,
    sourceCaptureSnapshotId: seed.snapshotId,
    sourceCaptureHash: seed.captureHash,
    selectedSkuKeys: ['sku-1'],
  });
  const categorized = await service.setCategory({
    draftId: created.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: created.revision,
    category: {
      categoryId: 10,
      typeId: 20,
      catalogRevision: seed.catalogRevision,
    },
  });
  const generated = await service.addAiCopyCandidate({
    draftId: created.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: categorized.revision,
    titleRu: 'BYOK товар для проверки публикации',
    descriptionRu: 'BYOK описание товара для проверки публикации.',
    sourcePromptVersion: 'byok-postgres-v1',
  });
  const sourceDraft = await service.applyAiCopyCandidate({
    draftId: created.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: generated.draft.revision,
    candidateId: generated.candidate.id,
    operationKey: `${seed.prefix}_byok_apply_copy`,
  });
  const assetIds = Array.from(
    { length: assetCount },
    (_, index) => `${seed.prefix}_byok_asset_${index + 1}`,
  );
  const resultSha256s = assetIds.map((_, index) => sha256(`${seed.prefix}:result:${index}`));
  await Promise.all(assetIds.map((assetId, index) => client.mediaAsset.create({
    data: {
      id: assetId,
      ownerUserId: seed.ownerUserId,
      kind: 'AI_GENERATED',
      sourceCaptureSnapshotId: seed.snapshotId,
      sourceMediaKey: `extension-byok:${resultSha256s[index]}`,
      sourceUrl: null,
      url: `https://cdn.example/${assetId}.png`,
      storageBackend: 'oss',
      storageKey: `users/${seed.ownerUserId}/${assetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 100,
      width: 10,
      height: 10,
      sha256: resultSha256s[index],
      metadata: {
        ingestContractVersion: 'byok-generated-asset-ingest/v1',
        normalizerVersion: 'byok-generated-asset-normalizer/v1',
        generatedAssetSource: 'EXTENSION_BYOK',
        executionMode: 'BYOK',
        outputRole: 'BYOK_ACCEPTED',
        pixelOrientationNormalized: true,
        idempotencyKeySha256: sha256(`${seed.prefix}:asset-idempotency:${index}`),
        requestHash: sha256(`${seed.prefix}:asset-request:${index}`),
        providerResultSha256: resultSha256s[index],
        providerResultMimeType: 'image/png',
        providerResultSizeBytes: 100,
        normalizedSha256: resultSha256s[index],
      },
    },
  })));
  const assignments = assetIds.map((assetId, index) => index === 0
    ? {
        scope: 'SKU' as const,
        skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero',
        assetId,
        source: 'GENERATED' as const,
      }
    : {
        scope: 'PRODUCT' as const,
        slotKey: 'shared:detail:SCENE',
        assetId,
        source: 'GENERATED' as const,
      });
  const boundDraft = await service.setMediaAssignments({
    draftId: created.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: sourceDraft.revision,
    assignments,
  });
  const endpointOriginSha256 = sha256(`${seed.prefix}:provider-origin`);
  for (const [index, assetId] of assetIds.entries()) {
    const assignmentOrdinal = boundDraft.media.assignments
      .findIndex((assignment) => assignment.assetId === assetId);
    if (assignmentOrdinal < 0) throw new Error('BYOK fixture assignment was not persisted');
    const slotKey = assignments[index]!.slotKey;
    const executionIntentId = `${seed.prefix}_execution_intent_${index + 1}`;
    await client.extensionByokExecutionIntent.create({
      data: {
        id: executionIntentId,
        contractVersion: 'extension-byok-execution-intent/v1',
        executionMode: 'BYOK',
        ownerUserId: seed.ownerUserId,
        actorUserId: seed.ownerUserId,
        deviceSessionId,
        shopId: seed.shopId,
        listingWorkflowId: created.id,
        draftRevision: sourceDraft.revision,
        draftVersion: sourceDraft.draftVersion,
        sourceCaptureSnapshotId: seed.snapshotId,
        supplyGoodsId: seed.supplyGoodsId,
        skuKey: 'sku-1',
        slotKey,
        assignmentMode: 'APPEND',
        assignmentOrdinal,
        policyRevision: 7,
        providerOriginSha256: endpointOriginSha256,
        model: 'fixture-image-model',
        operation: 'TEXT_TO_IMAGE',
        requestMode: 'json',
        providerIdempotencyKey: `${seed.prefix}_provider_attempt_${index + 1}`,
        providerRequestHash: sha256(`${seed.prefix}:provider-request:${index}`),
        requestHash: sha256(`${seed.prefix}:execution-request:${index}`),
      },
    });
    await client.extensionByokExecutionIntent.update({
      where: { id: executionIntentId },
      data: {
        outcome: 'SUCCEEDED',
        resultSha256: resultSha256s[index]!,
        outcomeUpdatedAt: seed.now,
      },
    });
    await client.extensionByokMediaProvenance.create({
      data: {
        id: `${seed.prefix}_provenance_${index + 1}`,
        contractVersion: 'extension-byok-media-provenance/v1',
        executionMode: 'BYOK',
        ownerUserId: seed.ownerUserId,
        actorUserId: seed.ownerUserId,
        deviceSessionId,
        shopId: seed.shopId,
        workflowId: created.id,
        draftRevision: sourceDraft.revision,
        draftVersion: sourceDraft.draftVersion,
        boundDraftRevision: boundDraft.revision,
        boundDraftVersion: boundDraft.draftVersion,
        skuKey: 'sku-1',
        slotKey,
        assignmentOrdinal,
        assignmentSha256: sha256(`${seed.prefix}:assignment:${index}`),
        policyRevision: 7,
        endpointOriginSha256,
        model: 'fixture-image-model',
        operation: 'TEXT_TO_IMAGE',
        promptSha256: sha256(`${seed.prefix}:prompt:${index}`),
        referenceSha256s: [],
        resultSha256: resultSha256s[index]!,
        assetId,
        resultMimeType: 'image/png',
        resultWidth: 10,
        resultHeight: 10,
        idempotencyKey: `${seed.prefix}_provenance_once_${index + 1}`,
        requestHash: sha256(`${seed.prefix}:provenance-request:${index}`),
        executionIntentId,
      },
    });
  }
  const priced = await service.setPricing({
    draftId: created.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: boundDraft.revision,
    value: strictPricing(boundDraft.selectedSkuKeys),
  });
  const ready = await service.recordValidationResult({
    draftId: created.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: priced.revision,
    status: 'VALID',
    report: validationReport(),
    blockers: [],
    warnings: [],
  });
  const recorded = await service.recordPublishIntent({
    draftId: ready.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: ready.revision,
    idempotencyKey: `${seed.prefix}_byok_publish_once`,
  });
  return {
    seed,
    service,
    recorded,
    assetIds,
    provenanceIds: assetIds.map((_, index) => `${seed.prefix}_provenance_${index + 1}`),
    deviceSessionId,
    shopGrantId: shopGrant.id,
  };
}

function prepareInput(seed: Awaited<ReturnType<typeof seedOwner>>, publishIntentId: string) {
  const catalogSnapshot = { revision: seed.catalogRevision } as Record<string, OzonPublishJson>;
  const attributeSchemaSnapshot = { fields: [] } as Record<string, OzonPublishJson>;
  const requestPayload = { items: [{ offer_id: `${seed.prefix}_offer_1` }] } as Record<string, OzonPublishJson>;
  return {
    publishIntentId,
    ownerUserId: seed.ownerUserId,
    catalogSnapshotId: seed.catalogSnapshotId,
    catalogRevision: seed.catalogRevision,
    catalogSnapshot,
    catalogSnapshotHash: hashOzonPublishJson(catalogSnapshot),
    attributeSchemaSnapshot,
    attributeSchemaHash: hashOzonPublishJson(attributeSchemaSnapshot),
    publisherContractVersion: 'ozon-listing-publisher/v1',
    requestPayload,
    requestPayloadHash: hashOzonPublishJson(requestPayload),
    offerTrace: [{ ordinal: 0, offerId: `${seed.prefix}_offer_1`, skuKey: 'sku-1' }],
  };
}

describePostgres('Ozon publish attempt PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const schemas = await first.$queryRawUnsafe<Array<{ schema: string }>>('SELECT current_schema() AS schema');
    expect(schemas[0]?.schema).toBe(expectedSchema);
    const migrations = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "_prisma_migrations"
       WHERE "migration_name" = '20260715190000_add_ozon_publish_attempts'
         AND "finished_at" IS NOT NULL`,
    );
    expect(migrations[0]?.count).toBe(1n);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('fences every crash window from concurrent prepare through a late acknowledgement', async () => {
    const seed = await seedOwner(first);
    const recorded = await createPublishIntent(first, seed);
    const firstRepository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const secondRepository = createPrismaOzonPublishAttemptRepository({ client: second as never });
    const input = prepareInput(seed, recorded.intent.id);

    const prepared = await Promise.all([
      firstRepository.prepare(input),
      secondRepository.prepare(input),
    ]);
    expect(prepared.map(({ idempotent }) => idempotent).sort()).toEqual([false, true]);
    expect(prepared[0]!.attempt.id).toBe(prepared[1]!.attempt.id);
    const attemptId = prepared[0]!.attempt.id;

    const submissionClaims = await Promise.all([
      firstRepository.claimSubmission({
        attemptId, workerId: 'submit-first', leaseMs: 30_000,
        byokAssetIds: [], requestingDeviceSessionId: null,
      }),
      secondRepository.claimSubmission({
        attemptId, workerId: 'submit-second', leaseMs: 30_000,
        byokAssetIds: [], requestingDeviceSessionId: null,
      }),
    ]);
    expect(submissionClaims.filter(Boolean)).toHaveLength(1);

    await first.$executeRawUnsafe(
      `UPDATE "ozon_publish_attempts"
       SET "heartbeat_at" = clock_timestamp() - interval '2 seconds',
           "lease_expires_at" = clock_timestamp() - interval '1 second'
       WHERE "id" = $1`,
      attemptId,
    );
    const staleResults = await Promise.all([
      firstRepository.markStaleSubmissionsUnknown({ workerId: 'stale-first', limit: 10 }),
      secondRepository.markStaleSubmissionsUnknown({ workerId: 'stale-second', limit: 10 }),
    ]);
    expect(staleResults.flat()).toHaveLength(1);
    expect(staleResults.flat()).toEqual([attemptId]);
    await expect(firstRepository.getOwned({ attemptId, ownerUserId: seed.ownerUserId }))
      .resolves.toMatchObject({ state: 'UNKNOWN', reconciliationState: 'PENDING' });

    const reconcileClaims = await Promise.all([
      firstRepository.claimReconciliation({ workerId: 'reconcile-first', leaseMs: 30_000, limit: 10 }),
      secondRepository.claimReconciliation({ workerId: 'reconcile-second', leaseMs: 30_000, limit: 10 }),
    ]);
    const matchingClaims = reconcileClaims.flat()
      .filter(({ attempt }) => attempt.id === attemptId);
    expect(matchingClaims).toHaveLength(1);
    const claim = matchingClaims[0]!;

    await expect(firstRepository.attachLateAcknowledgement({
      attemptId,
      workerId: claim.attempt.leaseOwner!,
      leaseToken: 'stale-token',
      leaseEpoch: claim.leaseEpoch,
      taskId: '9007199254740993',
      response: { task_id: '9007199254740993' },
    })).rejects.toMatchObject({ code: 'LEASE_LOST' });

    const acknowledged = await firstRepository.attachLateAcknowledgement({
      attemptId,
      workerId: claim.attempt.leaseOwner!,
      leaseToken: claim.leaseToken,
      leaseEpoch: claim.leaseEpoch,
      taskId: '9007199254740993',
      response: { task_id: '9007199254740993' },
    });
    expect(acknowledged).toMatchObject({
      state: 'SUBMITTED', reconciliationState: 'PENDING', ozonTaskId: '9007199254740993',
      leasePurpose: null, leaseToken: null, leaseOwner: null,
    });

    const firstDiagnosticClaim = (await firstRepository.claimReconciliation({
      workerId: 'diagnostic-first', leaseMs: 30_000, limit: 1,
    }))[0]!;
    const retainedItemResults = [{ offerId: 'offer-1', status: 'pending' }];
    const retainedItemErrors = [{ offerId: 'offer-1', code: 'OZON_PENDING_DETAIL' }];
    await firstRepository.completeReconciliation({
      attemptId,
      workerId: 'diagnostic-first',
      leaseToken: firstDiagnosticClaim.leaseToken,
      leaseEpoch: firstDiagnosticClaim.leaseEpoch,
      outcome: {
        kind: 'RETRY_WAIT',
        nextReconcileAt: new Date(0),
        errorCode: 'OZON_IMPORT_PENDING',
        errorMessage: 'One item is still pending',
        itemResults: retainedItemResults,
        itemErrors: retainedItemErrors,
      },
    });
    const secondDiagnosticClaim = (await firstRepository.claimReconciliation({
      workerId: 'diagnostic-second', leaseMs: 30_000, limit: 1,
    }))[0]!;
    await firstRepository.completeReconciliation({
      attemptId,
      workerId: 'diagnostic-second',
      leaseToken: secondDiagnosticClaim.leaseToken,
      leaseEpoch: secondDiagnosticClaim.leaseEpoch,
      outcome: {
        kind: 'RETRY_WAIT',
        nextReconcileAt: new Date(0),
        errorCode: 'OZON_IMPORT_INFO_UNAVAILABLE',
        errorMessage: 'Temporary status read failure',
      },
    });
    await expect(firstRepository.getOwned({ attemptId, ownerUserId: seed.ownerUserId }))
      .resolves.toMatchObject({
        reconciliationState: 'RETRY_WAIT',
        itemResults: retainedItemResults,
        itemErrors: retainedItemErrors,
      });

    const eventRows = await first.$queryRawUnsafe<Array<{ sequence: number; eventType: string }>>(
      `SELECT "sequence", "event_type" AS "eventType"
       FROM "ozon_publish_attempt_events" WHERE "attempt_id" = $1 ORDER BY "sequence"`,
      attemptId,
    );
    expect(eventRows.map(({ eventType }) => eventType)).toEqual([
      'PREPARED', 'SUBMISSION_CLAIMED', 'STALE_SUBMISSION_UNKNOWN',
      'RECONCILIATION_CLAIMED', 'LATE_ACKNOWLEDGEMENT',
      'RECONCILIATION_CLAIMED', 'RECONCILIATION_RETRY_WAIT',
      'RECONCILIATION_CLAIMED', 'RECONCILIATION_RETRY_WAIT',
    ]);
    expect(eventRows.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  }, 60_000);

  it('recovers a trusted task response after stale recovery wins the submission lease race', async () => {
    const seed = await seedOwner(first);
    const recorded = await createPublishIntent(first, seed);
    const repository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const prepared = await repository.prepare(prepareInput(seed, recorded.intent.id));
    const attemptId = prepared.attempt.id;
    const submissionClaim = await repository.claimSubmission({
      attemptId, workerId: 'recover-submit-worker', leaseMs: 30_000,
      byokAssetIds: [], requestingDeviceSessionId: null,
    });
    expect(submissionClaim).not.toBeNull();

    await first.$executeRawUnsafe(
      `UPDATE "ozon_publish_attempts"
       SET "heartbeat_at" = clock_timestamp() - interval '2 seconds',
           "lease_expires_at" = clock_timestamp() - interval '1 second'
       WHERE "id" = $1`,
      attemptId,
    );
    const staleIds = await repository.markStaleSubmissionsUnknown({
      workerId: 'recover-stale-worker', limit: 100,
    });
    expect(staleIds).toContain(attemptId);
    const reconciliationClaim = (await repository.claimReconciliation({
      workerId: 'recover-reconcile-worker', leaseMs: 30_000, limit: 100,
    })).find(({ attempt }) => attempt.id === attemptId)!;
    expect(reconciliationClaim).toBeDefined();

    const response = { result: { task_id: '9007199254740995' } };
    const recovered = await repository.recoverSubmissionAcknowledgement({
      attemptId,
      workerId: 'recover-submit-worker',
      leaseToken: submissionClaim!.leaseToken,
      leaseEpoch: submissionClaim!.leaseEpoch,
      taskId: '9007199254740995',
      response,
    });
    expect(recovered).toMatchObject({
      state: 'SUBMITTED', reconciliationState: 'PENDING',
      ozonTaskId: '9007199254740995', acceptanceSource: 'RECOVERED_TASK_RESPONSE',
      leasePurpose: null, leaseToken: null, leaseOwner: null,
    });
    await expect(repository.completeReconciliation({
      attemptId,
      workerId: 'recover-reconcile-worker',
      leaseToken: reconciliationClaim.leaseToken,
      leaseEpoch: reconciliationClaim.leaseEpoch,
      outcome: { kind: 'SUCCEEDED', itemResults: [], itemErrors: [] },
    })).rejects.toMatchObject({ code: 'LEASE_LOST' });

    const replay = await repository.recoverSubmissionAcknowledgement({
      attemptId,
      workerId: 'recover-submit-worker',
      leaseToken: submissionClaim!.leaseToken,
      leaseEpoch: submissionClaim!.leaseEpoch,
      taskId: '9007199254740995',
      response,
    });
    expect(replay.stateVersion).toBe(recovered.stateVersion);
    const events = await first.$queryRawUnsafe<Array<{ eventType: string }>>(
      `SELECT "event_type" AS "eventType" FROM "ozon_publish_attempt_events"
       WHERE "attempt_id" = $1 ORDER BY "sequence"`,
      attemptId,
    );
    expect(events.map(({ eventType }) => eventType)).toEqual([
      'PREPARED', 'SUBMISSION_CLAIMED', 'STALE_SUBMISSION_UNKNOWN',
      'RECONCILIATION_CLAIMED', 'SUBMISSION_ACKNOWLEDGEMENT_RECOVERED',
    ]);
  }, 60_000);

  it('allows a new intent to prepare and claim after the same workflow terminally rejects', async () => {
    const seed = await seedOwner(first);
    const firstIntent = await createPublishIntent(first, seed);
    const repository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const oldPrepared = await repository.prepare(prepareInput(seed, firstIntent.intent.id));
    const oldClaim = await repository.claimSubmission({
      attemptId: oldPrepared.attempt.id,
      workerId: 'terminal-rejection-worker',
      leaseMs: 30_000,
      byokAssetIds: [],
      requestingDeviceSessionId: null,
    });
    expect(oldClaim).not.toBeNull();
    const rejected = await repository.completeSubmission({
      attemptId: oldPrepared.attempt.id,
      workerId: 'terminal-rejection-worker',
      leaseToken: oldClaim!.leaseToken,
      leaseEpoch: oldClaim!.leaseEpoch,
      outcome: {
        kind: 'REJECTED',
        errorCode: 'OZON_SUBMIT_REJECTED',
        errorMessage: 'Ozon rejected the request before accepting a task',
      },
    });
    expect(rejected).toMatchObject({
      state: 'REJECTED',
      reconciliationState: 'NOT_REQUIRED',
      ozonTaskId: null,
      acceptanceSource: null,
      leasePurpose: null,
      leaseToken: null,
      leaseOwner: null,
    });

    const nextIntent = await createNextPublishIntent(first, seed, {
      draftId: firstIntent.draft.id,
      currentRevision: firstIntent.draft.revision,
      label: 'after_terminal_rejection',
    });
    const nextPrepared = await repository.prepare(prepareInput(seed, nextIntent.intent.id));
    expect(nextPrepared).toMatchObject({
      idempotent: false,
      attempt: {
        publishIntentId: nextIntent.intent.id,
        ownerUserId: seed.ownerUserId,
        workflowId: firstIntent.draft.id,
        state: 'PREPARED',
        reconciliationState: 'NOT_REQUIRED',
      },
    });
    const nextClaim = await repository.claimSubmission({
      attemptId: nextPrepared.attempt.id,
      workerId: 'terminal-republish-worker',
      leaseMs: 30_000,
      byokAssetIds: [],
      requestingDeviceSessionId: null,
    });
    expect(nextClaim).toMatchObject({
      attempt: {
        id: nextPrepared.attempt.id,
        state: 'SUBMITTING',
        leasePurpose: 'SUBMIT',
        leaseOwner: 'terminal-republish-worker',
      },
    });
  }, 60_000);

  it('claims a real BYOK attempt only with the complete persisted asset set and live authority', async () => {
    const fixture = await createByokPublishFixture(first, { assetCount: 2 });
    const repository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const prepared = await repository.prepare(
      prepareInput(fixture.seed, fixture.recorded.intent.id),
    );

    const claim = await repository.claimSubmission({
      attemptId: prepared.attempt.id,
      workerId: 'byok-exact-set-worker',
      leaseMs: 30_000,
      byokAssetIds: fixture.assetIds,
      requestingDeviceSessionId: fixture.deviceSessionId,
    });

    expect(claim).toMatchObject({
      attempt: {
        id: prepared.attempt.id,
        state: 'SUBMITTING',
        leasePurpose: 'SUBMIT',
        leaseOwner: 'byok-exact-set-worker',
      },
    });
  }, 60_000);

  it.each([
    'empty',
    'missing',
    'extra',
  ] as const)('rejects a %s BYOK asset claim against the frozen draft before submission', async (mode) => {
    const fixture = await createByokPublishFixture(first, { assetCount: 2 });
    const repository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const prepared = await repository.prepare(
      prepareInput(fixture.seed, fixture.recorded.intent.id),
    );
    const byokAssetIds = mode === 'empty'
      ? []
      : mode === 'missing'
        ? fixture.assetIds.slice(0, 1)
        : [...fixture.assetIds, `${fixture.seed.prefix}_unreported_asset`];

    await expect(repository.claimSubmission({
      attemptId: prepared.attempt.id,
      workerId: `byok-${mode}-set-worker`,
      leaseMs: 30_000,
      byokAssetIds,
      requestingDeviceSessionId: byokAssetIds.length ? fixture.deviceSessionId : null,
    })).resolves.toBeNull();
    await expect(repository.getOwned({
      attemptId: prepared.attempt.id,
      ownerUserId: fixture.seed.ownerUserId,
    })).resolves.toMatchObject({
      state: 'REJECTED',
      reconciliationState: 'NOT_REQUIRED',
      lastErrorCode: 'LOCAL_BYOK_PROVENANCE_CONFLICT',
      ozonTaskId: null,
      leasePurpose: null,
      leaseToken: null,
      leaseOwner: null,
    });
  }, 60_000);

  it.each([
    'session',
    'shop-grant',
  ] as const)('rejects BYOK when the %s is revoked after preparation but before final claim', async (authority) => {
    const fixture = await createByokPublishFixture(first);
    const repository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const prepared = await repository.prepare(
      prepareInput(fixture.seed, fixture.recorded.intent.id),
    );
    const revokedAt = new Date();
    if (authority === 'session') {
      await first.extensionDeviceSession.update({
        where: { id: fixture.deviceSessionId },
        data: {
          status: 'REVOKED',
          revokedAt,
          revokedReason: 'OWNER_REVOKED',
        },
      });
    } else {
      await first.extensionDeviceShopGrant.update({
        where: { id: fixture.shopGrantId },
        data: {
          status: 'REVOKED',
          revokedAt,
          revokedReason: 'OWNER_REVOKED',
        },
      });
    }

    await expect(repository.claimSubmission({
      attemptId: prepared.attempt.id,
      workerId: `byok-revoked-${authority}-worker`,
      leaseMs: 30_000,
      byokAssetIds: fixture.assetIds,
      requestingDeviceSessionId: fixture.deviceSessionId,
    })).resolves.toBeNull();
    await expect(repository.getOwned({
      attemptId: prepared.attempt.id,
      ownerUserId: fixture.seed.ownerUserId,
    })).resolves.toMatchObject({
      state: 'REJECTED',
      reconciliationState: 'NOT_REQUIRED',
      lastErrorCode: 'LOCAL_BYOK_SESSION_AUTHORITY_CONFLICT',
      ozonTaskId: null,
    });
  }, 60_000);

  it('claims a new BYOK intent after provenance records a definitive prior rejection', async () => {
    const fixture = await createByokPublishFixture(first);
    const repository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const oldPrepared = await repository.prepare(
      prepareInput(fixture.seed, fixture.recorded.intent.id),
    );
    const oldClaim = await repository.claimSubmission({
      attemptId: oldPrepared.attempt.id,
      workerId: 'byok-terminal-rejection-worker',
      leaseMs: 30_000,
      byokAssetIds: fixture.assetIds,
      requestingDeviceSessionId: fixture.deviceSessionId,
    });
    expect(oldClaim).not.toBeNull();
    await expect(repository.completeSubmission({
      attemptId: oldPrepared.attempt.id,
      workerId: 'byok-terminal-rejection-worker',
      leaseToken: oldClaim!.leaseToken,
      leaseEpoch: oldClaim!.leaseEpoch,
      outcome: {
        kind: 'REJECTED',
        errorCode: 'OZON_SUBMIT_REJECTED',
        errorMessage: 'Ozon rejected the BYOK request before accepting a task',
      },
    })).resolves.toMatchObject({
      state: 'REJECTED',
      reconciliationState: 'NOT_REQUIRED',
      ozonTaskId: null,
    });

    const receiptAt = new Date();
    const grantId = `${fixture.seed.prefix}_terminal_publish_grant`;
    const receiptId = `${fixture.seed.prefix}_terminal_publish_receipt`;
    await first.extensionCommandGrant.create({
      data: {
        id: grantId,
        sessionId: fixture.deviceSessionId,
        tokenId: `${fixture.seed.prefix}_jti`,
        ownerUserId: fixture.seed.ownerUserId,
        shopId: fixture.seed.shopId,
        operation: 'OZON_PUBLISH',
        workflowId: fixture.recorded.draft.id,
        draftVersion: fixture.recorded.intent.draftVersion,
        idempotencyKey: fixture.recorded.intent.idempotencyKey,
        requestHash: sha256(`${fixture.seed.prefix}:terminal-grant-request`),
        tokenDigest: sha256(`${fixture.seed.prefix}:terminal-grant-token`),
        issuedAt: receiptAt,
        expiresAt: new Date(receiptAt.getTime() + 300_000),
        consumedAt: receiptAt,
      },
    });
    await first.extensionCommandReceipt.create({
      data: {
        id: receiptId,
        grantId,
        createdAt: receiptAt,
      },
    });
    await first.extensionCommandReceipt.update({
      where: { id: receiptId },
      data: {
        status: 'FAILED',
        failureCode: 'OZON_SUBMIT_REJECTED',
        completedAt: receiptAt,
      },
    });
    await first.extensionByokMediaProvenance.update({
      where: { id: fixture.provenanceIds[0] },
      data: {
        publishIntentId: fixture.recorded.intent.id,
        publishReceiptId: receiptId,
      },
    });

    const nextIntent = await createNextPublishIntent(first, fixture.seed, {
      draftId: fixture.recorded.draft.id,
      currentRevision: fixture.recorded.draft.revision,
      label: 'byok_after_terminal_rejection',
    });
    const nextPrepared = await repository.prepare(
      prepareInput(fixture.seed, nextIntent.intent.id),
    );
    const nextClaim = await repository.claimSubmission({
      attemptId: nextPrepared.attempt.id,
      workerId: 'byok-terminal-republish-worker',
      leaseMs: 30_000,
      byokAssetIds: fixture.assetIds,
      requestingDeviceSessionId: fixture.deviceSessionId,
    });

    expect(nextClaim).toMatchObject({
      attempt: {
        id: nextPrepared.attempt.id,
        state: 'SUBMITTING',
        leasePurpose: 'SUBMIT',
        leaseOwner: 'byok-terminal-republish-worker',
      },
    });
    await expect(first.extensionByokMediaProvenance.findUnique({
      where: { id: fixture.provenanceIds[0] },
      select: { publishIntentId: true, publishReceiptId: true },
    })).resolves.toEqual({
      publishIntentId: fixture.recorded.intent.id,
      publishReceiptId: receiptId,
    });
  }, 60_000);

  it.each([
    'PREPARED',
    'UNKNOWN',
    'SUCCEEDED',
  ] as const)('blocks a new workflow attempt before Ozon when the prior attempt is %s', async (state) => {
    const seed = await seedOwner(first);
    const firstIntent = await createPublishIntent(first, seed);
    const repository = createPrismaOzonPublishAttemptRepository({ client: first as never });
    const oldPrepared = await repository.prepare(prepareInput(seed, firstIntent.intent.id));

    if (state !== 'PREPARED') {
      const oldClaim = await repository.claimSubmission({
        attemptId: oldPrepared.attempt.id,
        workerId: `prior-${state.toLowerCase()}-worker`,
        leaseMs: 30_000,
        byokAssetIds: [],
        requestingDeviceSessionId: null,
      });
      expect(oldClaim).not.toBeNull();
      if (state === 'UNKNOWN') {
        await expect(repository.completeSubmission({
          attemptId: oldPrepared.attempt.id,
          workerId: `prior-${state.toLowerCase()}-worker`,
          leaseToken: oldClaim!.leaseToken,
          leaseEpoch: oldClaim!.leaseEpoch,
          outcome: {
            kind: 'UNKNOWN',
            errorCode: 'OZON_NETWORK_OUTCOME_UNKNOWN',
            errorMessage: 'The provider outcome cannot be proven',
          },
        })).resolves.toMatchObject({ state: 'UNKNOWN', reconciliationState: 'PENDING' });
      } else {
        await repository.completeSubmission({
          attemptId: oldPrepared.attempt.id,
          workerId: `prior-${state.toLowerCase()}-worker`,
          leaseToken: oldClaim!.leaseToken,
          leaseEpoch: oldClaim!.leaseEpoch,
          outcome: {
            kind: 'SUBMITTED',
            taskId: '9007199254740997',
            response: { task_id: '9007199254740997' },
          },
        });
        const reconciliationClaim = (await repository.claimReconciliation({
          workerId: `prior-${state.toLowerCase()}-reconciliation`,
          leaseMs: 30_000,
          limit: 100,
        })).find(({ attempt }) => attempt.id === oldPrepared.attempt.id);
        expect(reconciliationClaim).toBeDefined();
        await expect(repository.completeReconciliation({
          attemptId: oldPrepared.attempt.id,
          workerId: `prior-${state.toLowerCase()}-reconciliation`,
          leaseToken: reconciliationClaim!.leaseToken,
          leaseEpoch: reconciliationClaim!.leaseEpoch,
          outcome: { kind: 'SUCCEEDED', itemResults: [], itemErrors: [] },
        })).resolves.toMatchObject({
          state: 'SUBMITTED',
          reconciliationState: 'SUCCEEDED',
        });
      }
    }

    const nextIntent = await createNextPublishIntent(first, seed, {
      draftId: firstIntent.draft.id,
      currentRevision: firstIntent.draft.revision,
      label: `after_${state.toLowerCase()}`,
    });
    await expect(repository.prepare(prepareInput(seed, nextIntent.intent.id)))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(repository.getByPublishIntent({
      publishIntentId: nextIntent.intent.id,
      ownerUserId: seed.ownerUserId,
    })).resolves.toBeNull();
  }, 60_000);
});
