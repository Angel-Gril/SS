import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaExtensionHostedAiImagePlanBindingStore,
  type ExtensionHostedAiImagePlanBindingPrismaClient,
} from '../services/extension-hosted-ai-image-plan-binding-prisma.js';
import { createExtensionHostedAiImagePlanBindingRecord } from '../services/extension-hosted-ai-image-plan.js';
import { createPrismaExtensionByokExecutionIntentRepository } from '../services/extension-byok-execution-intent-prisma.js';
import type { ExtensionByokExecutionIntentRecord } from '../services/extension-byok-execution-intent.js';
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

function dedicatedDatabaseUrl(applicationName: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('application_name', applicationName.slice(0, 63));
  return url.toString();
}

interface ModeFixture {
  ownerUserId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  planId: string;
  planVersionId: string;
  suiteId: string;
  suiteEventId: string;
  suiteEventKey: string;
  suiteRequestFingerprint: string;
  suitePreviewHash: string;
  providerConfigHash: string;
  executionIntent: Record<string, unknown>;
}

async function seedModeFixture(
  client: PrismaClient,
  label: string,
  bindHostedPlan = true,
): Promise<ModeFixture> {
  const prefix = `execution_mode_${label}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const ownerUserId = `${prefix}_owner`;
  const goodsId = `${prefix}_goods`;
  const subjectId = `${prefix}_subject`;
  const snapshotId = `${prefix}_snapshot`;
  const shopId = `${prefix}_shop`;
  const pairingId = `${prefix}_pairing`;
  const deviceSessionId = `${prefix}_session`;
  const assetId = `${prefix}_asset`;
  const planId = `${prefix}_plan`;
  const planningRunId = `${prefix}_run`;
  const planVersionId = `${prefix}_version`;
  const suiteId = `${prefix}_suite`;
  const now = new Date('2026-07-27T13:00:00.000Z');
  const captureHash = digest(`${prefix}:capture`);
  const profileHash = digest(`${prefix}:profile`);
  const resultSha256 = digest(`${prefix}:result`);

  await client.user.create({
    data: { id: ownerUserId, phone: `${prefix}_phone`, passwordHash: 'integration-test' },
  });
  await client.supplyGoods.create({ data: {
    id: goodsId,
    userId: ownerUserId,
    title: 'Execution mode fixture',
    sourcePlatform: '1688',
    sourceProductId: `${prefix}_product`,
  } });
  await client.sourceCaptureSubject.create({ data: {
    id: subjectId,
    ownerUserId,
    sourcePlatform: '1688',
    sourceProductId: `${prefix}_product`,
    legacySupplyGoodsId: goodsId,
  } });
  await client.sourceCaptureSnapshot.create({ data: {
    id: snapshotId,
    subjectId,
    version: 1,
    schemaVersion: 'source-product-capture-v2',
    captureHash,
    payloadBytes: 2,
    payload: {},
    stageCounts: {},
    provenance: {},
    provenanceComplete: true,
    parserVersion: 'execution-mode-integration',
    completeness: {},
    truncations: [],
    hasEstimatedValues: false,
    profile: {},
    profileHash,
    actorUserId: ownerUserId,
    ingestChannel: 'WEB_ACCOUNT',
    rolloutRevision: 'execution-mode-integration',
    rolloutStage: 'v2_only',
    capturedAt: now,
  } });
  await client.shop.create({ data: {
    id: shopId,
    userId: ownerUserId,
    platform: 'OZON',
    name: 'Execution mode shop',
    apiKeyEncrypted: 'integration-test',
  } });
  const listing = createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    now: () => now,
    idFactory: (kind) => `${prefix}_${kind}`,
  });
  const sourceDraft = await listing.createDraft({
    ownerUserId,
    actorUserId: ownerUserId,
    shopId,
    supplyGoodsId: goodsId,
    sourceCaptureSnapshotId: snapshotId,
    sourceCaptureHash: captureHash,
    selectedSkuKeys: ['sku-1'],
  });
  await client.mediaAsset.create({ data: {
    id: assetId,
    ownerUserId,
    kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: snapshotId,
    sourceMediaKey: `extension-byok:${digest(`${prefix}:source-media`)}`,
    url: `/uploads/${assetId}.png`,
    storageBackend: 'local',
    storageKey: `${assetId}.png`,
    mimeType: 'image/png',
    sizeBytes: 100,
    width: 10,
    height: 10,
    sha256: resultSha256,
    metadata: { executionMode: 'BYOK' },
  } });
  await listing.setMediaAssignments({
    draftId: sourceDraft.id,
    ownerUserId,
    actorUserId: ownerUserId,
    expectedRevision: sourceDraft.revision,
    assignments: [{
      scope: 'SKU',
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      assetId,
      source: 'GENERATED',
    }],
  });
  await client.extensionDevicePairingCode.create({ data: {
    id: pairingId,
    deploymentId: 'execution-mode-integration',
    actorUserId: ownerUserId,
    ownerUserId,
    codeDigest: digest(`${prefix}:pairing`),
    shopIds: [shopId],
    scopes: ['byok:media:ingest', 'media:execute'],
    status: 'CLAIMED',
    expiresAt: new Date(now.getTime() + 86_400_000),
    claimedAt: now,
  } });
  await client.extensionDeviceSession.create({ data: {
    id: deviceSessionId,
    pairingCodeId: pairingId,
    deploymentId: 'execution-mode-integration',
    deviceId: `${prefix}_device`,
    actorUserId: ownerUserId,
    ownerUserId,
    scopes: ['byok:media:ingest', 'media:execute'],
    currentJti: `${prefix}_jti`,
    expiresAt: new Date(now.getTime() + 86_400_000),
  } });

  const inputSnapshot = {
    source: { subjectId, snapshotId },
    context: { type: 'collect', id: goodsId },
    skus: [{ skuKey: 'sku-1' }],
    candidates: [{ id: 'candidate-1' }],
  };
  const planPayload = {
    compatibilityGroups: [],
    slots: [{ slotKey: 'sku:sku-1:hero', ownership: { level: 'sku', key: 'sku-1' } }],
  };
  await client.$transaction(async (tx) => {
    for (const table of ['ai_media_plans', 'ai_media_planning_runs', 'ai_media_plan_versions']) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
    }
    try {
      const planFingerprint = digest(`${prefix}:plan-request`);
      const inputFingerprint = digest(`${prefix}:plan-input`);
      await tx.aiMediaPlan.create({ data: {
        id: planId,
        ownerUserId,
        actorUserId: ownerUserId,
        sourceSubjectId: subjectId,
        contextType: 'collect',
        contextId: goodsId,
        idempotencyKey: `${prefix}_plan_key`,
        requestFingerprint: planFingerprint,
      } });
      await tx.aiMediaPlanningRun.create({ data: {
        id: planningRunId,
        planId,
        ownerUserId,
        sourceSubjectId: subjectId,
        actorUserId: ownerUserId,
        sourceCaptureSnapshotId: snapshotId,
        attempt: 1,
        mode: 'RULE_BASED',
        engineVersion: 'execution-mode-integration',
        status: 'SUCCEEDED',
        idempotencyKey: `${prefix}_run_key`,
        requestFingerprint: planFingerprint,
        sourceCaptureHash: captureHash,
        sourceProfileHash: profileHash,
        inputFingerprint,
        inputSnapshot,
        inputHash: digest(`${prefix}:input-hash`),
        inputBytes: JSON.stringify(inputSnapshot).length,
        completedAt: now,
      } });
      await tx.aiMediaPlanVersion.create({ data: {
        id: planVersionId,
        planId,
        ownerUserId,
        sourceSubjectId: subjectId,
        version: 1,
        planningRunId,
        sourceCaptureSnapshotId: snapshotId,
        sourceCaptureHash: captureHash,
        sourceProfileHash: profileHash,
        sourceSchemaVersion: 'source-product-capture-v2',
        selectedSkuHash: digest(JSON.stringify(['sku-1'])),
        inputAssetSetHash: digest(JSON.stringify(['candidate-1'])),
        inputFingerprint,
        planSchemaVersion: 'execution-mode-integration',
        plannerVersion: 'execution-mode-integration',
        mode: 'RULE_BASED',
        inputSnapshot,
        inputHash: digest(`${prefix}:input-hash`),
        curation: {},
        curationHash: digest(`${prefix}:curation`),
        visionEvidence: {},
        visionEvidenceHash: digest(`${prefix}:vision`),
        planPayload,
        planHash: digest(JSON.stringify(planPayload)),
        planBytes: JSON.stringify(planPayload).length,
        provenance: {},
        provenanceHash: digest(`${prefix}:provenance`),
        actorUserId: ownerUserId,
      } });
      await tx.aiMediaPlan.update({
        where: { id: planId },
        data: {
          latestVersion: 1,
          currentVersionId: planVersionId,
          approvedVersionId: planVersionId,
          reviewStatus: 'APPROVED',
          reviewedByUserId: ownerUserId,
          reviewedAt: now,
        },
      });
    } finally {
      for (const table of ['ai_media_plan_versions', 'ai_media_planning_runs', 'ai_media_plans']) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      }
    }
  });

  const planBinding = createExtensionHostedAiImagePlanBindingRecord({
    planId,
    identity: { ownerUserId, actorUserId: ownerUserId, deviceSessionId },
    binding: {
      snapshotId,
      supplyGoodsId: goodsId,
      shopId,
      listingWorkflowId: sourceDraft.id,
      draftRevision: sourceDraft.revision,
      draftVersion: sourceDraft.draftVersion,
    },
    selectedSkuKeys: ['sku-1'],
    candidateMediaKeys: ['candidate-1'],
  });
  const bindingStore = createPrismaExtensionHostedAiImagePlanBindingStore(
    client as unknown as ExtensionHostedAiImagePlanBindingPrismaClient,
    { createId: () => `${prefix}_binding` },
  );
  if (bindHostedPlan) {
    await expect(bindingStore.bind(planBinding)).resolves.toMatchObject({ kind: 'bound' });
  }

  return {
    ownerUserId,
    shopId,
    listingWorkflowId: sourceDraft.id,
    draftRevision: sourceDraft.revision,
    draftVersion: sourceDraft.draftVersion,
    planId,
    planVersionId,
    suiteId,
    suiteEventId: `${prefix}_suite_event`,
    suiteEventKey: `${prefix}:suite:claimed`,
    suiteRequestFingerprint: digest(`${prefix}:suite-request`),
    suitePreviewHash: digest(`${prefix}:suite-preview`),
    providerConfigHash: digest(`${prefix}:provider-config`),
    executionIntent: {
      id: `${prefix}_execution_intent`,
      contractVersion: 'extension-byok-execution-intent/v1',
      executionMode: 'BYOK',
      ownerUserId,
      actorUserId: ownerUserId,
      deviceSessionId,
      shopId,
      listingWorkflowId: sourceDraft.id,
      draftRevision: sourceDraft.revision,
      draftVersion: sourceDraft.draftVersion,
      sourceCaptureSnapshotId: snapshotId,
      supplyGoodsId: goodsId,
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      assignmentMode: 'APPEND',
      assignmentOrdinal: 0,
      policyRevision: 1,
      providerOriginSha256: digest('https://provider.example'),
      model: 'image-model-v1',
      operation: 'TEXT_TO_IMAGE',
      requestMode: 'json',
      providerIdempotencyKey: `${prefix}_provider_attempt`,
      providerRequestHash: digest(`${prefix}:provider-request`),
      requestHash: digest(`${prefix}:byok-request`),
      outcome: 'PENDING',
    },
  };
}

async function insertHostedSuite(
  client: PrismaClient,
  fixture: ModeFixture,
  options: { failAfterInsert?: boolean } = {},
) {
  return client.$transaction(async (tx) => {
    await tx.aiMediaSuite.create({ data: {
      id: fixture.suiteId,
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      planId: fixture.planId,
      planVersionId: fixture.planVersionId,
      sourceSubjectId: (await tx.aiMediaPlan.findUniqueOrThrow({
        where: { id: fixture.planId },
        select: { sourceSubjectId: true },
      })).sourceSubjectId,
      sourceCaptureSnapshotId: (await tx.aiMediaPlanVersion.findUniqueOrThrow({
        where: { id: fixture.planVersionId },
        select: { sourceCaptureSnapshotId: true },
      })).sourceCaptureSnapshotId,
      sourceCaptureHash: (await tx.aiMediaPlanVersion.findUniqueOrThrow({
        where: { id: fixture.planVersionId },
        select: { sourceCaptureHash: true },
      })).sourceCaptureHash,
      sourceProfileHash: (await tx.aiMediaPlanVersion.findUniqueOrThrow({
        where: { id: fixture.planVersionId },
        select: { sourceProfileHash: true },
      })).sourceProfileHash,
      sourceSchemaVersion: 'source-product-capture-v2',
      contextType: 'collect',
      contextId: (await tx.aiMediaPlan.findUniqueOrThrow({
        where: { id: fixture.planId },
        select: { contextId: true },
      })).contextId,
      status: 'PLANNED',
      revision: 1,
      idempotencyKey: `${fixture.suiteId}_key`,
      requestFingerprint: fixture.suiteRequestFingerprint,
      previewHash: fixture.suitePreviewHash,
      provider: 'custom',
      model: 'image-model-v1',
      providerConfigHash: fixture.providerConfigHash,
      pricingVersion: 'execution-mode-integration',
      itemCount: 1,
      estimatedCostCents: 10,
      maximumCostCents: 10,
      concurrencyLimit: 1,
    } });
    await tx.aiMediaSuiteEvent.create({ data: {
      id: fixture.suiteEventId,
      suiteId: fixture.suiteId,
      ownerUserId: fixture.ownerUserId,
      revision: 1,
      actorUserId: fixture.ownerUserId,
      eventKey: fixture.suiteEventKey,
      eventType: 'CLAIMED',
      payload: {},
      payloadHash: digest('{}'),
    } });
    if (options.failAfterInsert) throw new Error('ROLLBACK_MODE_CLAIM');
  }, { isolationLevel: 'Serializable' });
}

async function insertByokIntent(client: PrismaClient, fixture: ModeFixture) {
  return client.$transaction(async (tx) => {
    await (tx as any).extensionByokExecutionIntent.create({ data: fixture.executionIntent });
  }, { isolationLevel: 'Serializable' });
}

async function waitForLockWaiters(
  observer: PrismaClient,
  applicationNames: [string, string],
): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await observer.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count"
       FROM pg_stat_activity
       WHERE "application_name" IN ($1, $2) AND "wait_event_type" = 'Lock'`,
      ...applicationNames,
    );
    if (rows[0]?.count === 2) return 2;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return 0;
}

describePostgres('extension AI image execution mode PostgreSQL exclusion', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    assertIsolatedSchema(databaseUrl);
    client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$connect();
    await client.$executeRawUnsafe(
      'ALTER TABLE "ai_media_suite_events" DISABLE TRIGGER "ai_media_suite_claim_event_slot_set"',
    );
  }, 30_000);

  afterAll(async () => {
    if (client) {
      await client.$executeRawUnsafe(
        'ALTER TABLE "ai_media_suite_events" ENABLE TRIGGER "ai_media_suite_claim_event_slot_set"',
      ).catch(() => undefined);
      await client.$disconnect();
    }
  });

  it('rejects a BYOK intent after the exact hosted suite claims the draft', async () => {
    const fixture = await seedModeFixture(client, 'hosted_first');
    await expect(insertHostedSuite(client, fixture)).resolves.toBeUndefined();
    await expect(insertByokIntent(client, fixture)).rejects.toThrow(
      /execution mode|ERP-hosted suite/iu,
    );
  }, 30_000);

  it('does not lock ordinary suites whose plan has no extension binding', async () => {
    const fixture = await seedModeFixture(client, 'ordinary_suite', false);
    await expect(insertHostedSuite(client, fixture)).resolves.toBeUndefined();
    const rows = await client.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count"
       FROM "extension_ai_image_execution_mode_locks"
       WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2`,
      fixture.ownerUserId,
      fixture.listingWorkflowId,
    );
    expect(rows[0]?.count).toBe(0);
  }, 30_000);

  it('rolls back a provisional hosted mode claim with its failed transaction', async () => {
    const fixture = await seedModeFixture(client, 'rollback');
    await expect(insertHostedSuite(client, fixture, { failAfterInsert: true })).rejects.toThrow(
      'ROLLBACK_MODE_CLAIM',
    );
    const rows = await client.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count"
       FROM "extension_ai_image_execution_mode_locks"
       WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2`,
      fixture.ownerUserId,
      fixture.listingWorkflowId,
    );
    expect(rows[0]?.count).toBe(0);
    await expect(insertByokIntent(client, fixture)).resolves.toBeUndefined();
  }, 30_000);

  it('rolls back a new draft mode claim when the Provider key belongs to another intent', async () => {
    const fixture = await seedModeFixture(client, 'provider_key_conflict');
    await expect(insertByokIntent(client, fixture)).resolves.toBeUndefined();
    const existing = fixture.executionIntent as Record<string, any>;
    await client.extensionDeviceShopGrant.create({ data: {
      sessionId: existing.deviceSessionId,
      shopId: fixture.shopId,
      status: 'ACTIVE',
      grantedAt: new Date(),
    } });
    const workflow = await client.sourceListingWorkflow.findUniqueOrThrow({
      where: { id: fixture.listingWorkflowId },
      select: { currentRevision: true, currentDraftVersion: true },
    });
    const now = new Date();
    const conflicting: ExtensionByokExecutionIntentRecord = {
      ...(existing as ExtensionByokExecutionIntentRecord),
      id: `${existing.id}_conflict`,
      draftRevision: workflow.currentRevision,
      draftVersion: workflow.currentDraftVersion,
      assignmentOrdinal: 1,
      requestHash: digest(`${existing.id}:conflicting-request`),
      providerRequestIdSha256: null,
      resultSha256: null,
      outcomeUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const repository = createPrismaExtensionByokExecutionIntentRepository(client as never);
    await expect(repository.claim(conflicting)).resolves.toEqual({
      kind: 'idempotency_conflict',
    });

    const lockCount = await client.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count"
       FROM "extension_ai_image_execution_mode_locks"
       WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2
         AND "draft_revision" = $3 AND "draft_version" = $4`,
      fixture.ownerUserId,
      fixture.listingWorkflowId,
      workflow.currentRevision,
      workflow.currentDraftVersion,
    );
    expect(lockCount[0]?.count).toBe(0);
    await expect(client.$queryRawUnsafe(
      `SELECT claim_extension_ai_image_execution_mode(
         $1, $2, $3, $4::INTEGER, $5::INTEGER, 'ERP_HOSTED'::TEXT
       )::TEXT AS "claimed"`,
      fixture.ownerUserId,
      fixture.shopId,
      fixture.listingWorkflowId,
      workflow.currentRevision,
      workflow.currentDraftVersion,
    )).resolves.toBeDefined();
  }, 30_000);

  it('rejects a hosted suite after the pre-dispatch BYOK intent claims the exact draft', async () => {
    const fixture = await seedModeFixture(client, 'byok_first');
    await expect(insertByokIntent(client, fixture)).resolves.toBeUndefined();
    await expect(insertHostedSuite(client, fixture)).rejects.toThrow(
      /execution mode|BYOK media/iu,
    );
  }, 30_000);

  it('commits exactly one mode when both serializable transactions already have snapshots', async () => {
    const fixture = await seedModeFixture(client, 'race');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const applicationNames: [string, string] = [
      `mode_hosted_${suffix}`,
      `mode_byok_${suffix}`,
    ];
    const gate = new PrismaClient({ datasourceUrl: dedicatedDatabaseUrl(`mode_gate_${suffix}`) });
    const hosted = new PrismaClient({ datasourceUrl: dedicatedDatabaseUrl(applicationNames[0]) });
    const byok = new PrismaClient({ datasourceUrl: dedicatedDatabaseUrl(applicationNames[1]) });
    await Promise.all([gate.$connect(), hosted.$connect(), byok.$connect()]);
    let releaseGate = () => {};
    let signalGateReady = () => {};
    const gateRelease = new Promise<void>((resolve) => { releaseGate = resolve; });
    const gateReady = new Promise<void>((resolve) => { signalGateReady = resolve; });
    const gateTransaction = gate.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT 1::int AS "locked"
         FROM pg_advisory_xact_lock(hashtextextended(
           jsonb_build_array(
             'extension-ai-image-execution-mode/v1', $1, $2, $3, $4
           )::text,
           73190427
         ))`,
        fixture.ownerUserId,
        fixture.listingWorkflowId,
        fixture.draftRevision,
        fixture.draftVersion,
      );
      signalGateReady();
      await gateRelease;
    }, { timeout: 15_000 });

    let pending: Promise<PromiseSettledResult<unknown>[]> | null = null;
    let results: PromiseSettledResult<unknown>[];
    try {
      await gateReady;
      pending = Promise.allSettled([
        insertHostedSuite(hosted, fixture),
        insertByokIntent(byok, fixture),
      ]);
      expect(await waitForLockWaiters(client, applicationNames)).toBe(2);
      releaseGate();
      await gateTransaction;
      results = await pending;
    } finally {
      releaseGate();
      await gateTransaction.catch(() => undefined);
      await pending?.catch(() => undefined);
      await Promise.all([gate.$disconnect(), hosted.$disconnect(), byok.$disconnect()]);
    }

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [suiteCount, intentCount, locks] = await Promise.all([
      client.aiMediaSuite.count({ where: { id: fixture.suiteId } }),
      (client as any).extensionByokExecutionIntent.count({
        where: { id: String(fixture.executionIntent.id) },
      }) as Promise<number>,
      client.$queryRawUnsafe<Array<{ executionMode: string }>>(
        `SELECT "execution_mode" AS "executionMode"
         FROM "extension_ai_image_execution_mode_locks"
         WHERE "owner_user_id" = $1 AND "listing_workflow_id" = $2
           AND "draft_revision" = $3 AND "draft_version" = $4`,
        fixture.ownerUserId,
        fixture.listingWorkflowId,
        fixture.draftRevision,
        fixture.draftVersion,
      ),
    ]);
    expect(suiteCount + intentCount).toBe(1);
    expect(locks).toHaveLength(1);
    expect(locks[0]?.executionMode).toBe(suiteCount === 1 ? 'ERP_HOSTED' : 'BYOK');
  }, 30_000);
});
