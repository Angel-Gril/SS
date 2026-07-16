import { randomUUID } from 'node:crypto';
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
  const ready = await service.recordValidationResult({
    draftId: draft.id,
    ownerUserId: seed.ownerUserId,
    actorUserId: seed.ownerUserId,
    expectedRevision: draft.revision,
    status: 'VALID',
    report: { fixture: 'unit6a-postgres' },
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
      firstRepository.claimSubmission({ attemptId, workerId: 'submit-first', leaseMs: 30_000 }),
      secondRepository.claimSubmission({ attemptId, workerId: 'submit-second', leaseMs: 30_000 }),
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
});
