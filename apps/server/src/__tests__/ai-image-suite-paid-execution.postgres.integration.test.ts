import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

interface SuiteFixture {
  label: string;
  provider: string;
  model: string;
  costCents: number;
  planId: string;
  runId: string;
  versionId: string;
  suiteId: string;
  workflowId: string;
  jobId: string;
  reservationId: string;
  slotId: string;
  claimToken: string;
  providerJobId: string | null;
}

describe.skipIf(!enabled)('paid AI image suite PostgreSQL evidence contract', () => {
  let client: PrismaClient;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ownerUserId = `suite_paid_owner_${suffix}`;
  const subjectId = `suite_paid_subject_${suffix}`;
  const snapshotId = `suite_paid_snapshot_${suffix}`;
  const requestFingerprint = digest(`suite-paid-request-${suffix}`);
  const normalizedSha256 = digest(`suite-paid-normalized-${suffix}`);
  const rawSha256 = digest(`suite-paid-raw-${suffix}`);
  const rawAssetId = `suite_paid_raw_${suffix}`;
  const finalAssetId = `suite_paid_final_${suffix}`;
  const frozenInputAssets = [{ assetId: `source-${suffix}`, role: 'REFERENCE', ordinal: 0 }];
  const frozenOperationConfig = {
    version: 'ai-image-suite-child-operation/v1',
    outputProfile: 'ozon-suite-3x4-900x1200/v1',
    width: 900,
    height: 1200,
  };

  const fixture = (
    label: string,
    provider: string,
    model: string,
    costCents: number,
  ): SuiteFixture => ({
    label,
    provider,
    model,
    costCents,
    planId: `suite_paid_plan_${label}_${suffix}`,
    runId: `suite_paid_run_${label}_${suffix}`,
    versionId: `suite_paid_version_${label}_${suffix}`,
    suiteId: `suite_paid_suite_${label}_${suffix}`,
    workflowId: `suite_paid_workflow_${label}_${suffix}`,
    jobId: `suite_paid_job_${label}_${suffix}`,
    reservationId: `suite_paid_reservation_${label}_${suffix}`,
    slotId: `suite_paid_slot_${label}_${suffix}`,
    claimToken: digest(`suite-paid-claim-${label}-${suffix}`),
    providerJobId: provider === 'fake' ? null : `provider-job-${suffix}`,
  });

  const paid = fixture('openai', 'openai-images', 'gpt-image-1', 24);
  const fake = fixture('fake', 'fake', 'fake-image-suite-v1', 0);
  const retryHistory = fixture('retry_history', 'openai-images', 'gpt-image-1', 24);
  const retryAttempt2JobId = `suite_paid_job_retry_history_2_${suffix}`;
  const retryAttempt2ReservationId = `suite_paid_reservation_retry_history_2_${suffix}`;

  function assertIsolatedDatabaseUrl(): void {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    const schema = new URL(databaseUrl).searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
      throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
    }
  }

  function slotCounts(status: 'RUNNING' | 'SUCCEEDED') {
    return {
      planned: 0,
      queued: 0,
      running: status === 'RUNNING' ? 1 : 0,
      succeeded: status === 'SUCCEEDED' ? 1 : 0,
      failed: 0,
      cancelRequested: 0,
      cancelled: 0,
      total: 1,
      active: status === 'RUNNING' ? 1 : 0,
    };
  }

  function eventPayload(input: {
    target: SuiteFixture;
    beforeRevision: number;
    afterRevision: number;
    beforeStatus: 'QUEUED' | 'RUNNING';
    afterStatus: 'RUNNING' | 'SUCCEEDED';
    slotRevision: number;
    eventType: 'SUITE_CHILD_RUNNING' | 'SUITE_CHILD_SUCCEEDED';
  }) {
    const counts = slotCounts(input.afterStatus);
    return {
      version: 'ai-image-suite-execution-event/v1',
      suiteId: input.target.suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      beforeRevision: input.beforeRevision,
      afterRevision: input.afterRevision,
      beforeStatus: input.beforeStatus,
      afterStatus: input.afterStatus,
      counts,
      slotId: input.target.slotId,
      childWorkflowId: input.target.workflowId,
      jobId: input.target.jobId,
      reservationId: input.target.reservationId,
      attempt: 1,
      result: {
        suiteId: input.target.suiteId,
        revision: input.afterRevision,
        status: input.afterStatus,
        itemCount: 1,
        concurrencyLimit: 1,
        counts: {
          planned: counts.planned,
          queued: counts.queued,
          running: counts.running,
          succeeded: counts.succeeded,
          failed: counts.failed,
          cancelRequested: counts.cancelRequested,
          cancelled: counts.cancelled,
        },
        slots: [{
          slotId: input.target.slotId,
          ordinal: 0,
          slotKey: 'hero',
          status: input.afterStatus,
          attempt: 1,
          revision: input.slotRevision,
          childWorkflowId: input.target.workflowId,
          error: null,
        }],
      },
      eventType: input.eventType,
    };
  }

  function rawAssetData(target: SuiteFixture, id: string, providerJobId = target.providerJobId) {
    return {
      id,
      ownerUserId,
      aiImageJobId: target.jobId,
      kind: 'AI_PROVIDER_OUTPUT' as const,
      sourceCaptureSnapshotId: snapshotId,
      url: `https://storage.example/${suffix}/${id}.png`,
      storageBackend: 'local',
      storageKey: `${suffix}/${id}.png`,
      mimeType: 'image/png',
      sizeBytes: 1_024,
      width: 1_024,
      height: 1_536,
      sha256: rawSha256,
      metadata: {
        version: 'ai-image-suite-provider-output/v1',
        sourceCaptureSnapshotId: snapshotId,
        normalizerVersion: 'ai-image-suite-output-normalizer/v1',
        normalizedSha256,
        actualCostCents: target.costCents,
        providerResultReceivedAt: '2026-07-24T06:00:00.000Z',
        providerJobId,
      },
    };
  }

  function finalAssetData(id: string, providerOutputAssetId: string) {
    return {
      id,
      ownerUserId,
      aiImageJobId: paid.jobId,
      kind: 'AI_GENERATED' as const,
      sourceCaptureSnapshotId: snapshotId,
      url: `https://storage.example/${suffix}/${id}.png`,
      storageBackend: 'local',
      storageKey: `${suffix}/${id}.png`,
      mimeType: 'image/png',
      sizeBytes: 2_048,
      width: 900,
      height: 1_200,
      sha256: normalizedSha256,
      metadata: {
        version: 'ai-image-suite-output/v1',
        sourceCaptureSnapshotId: snapshotId,
        normalizerVersion: 'ai-image-suite-output-normalizer/v1',
        providerOutputAssetId,
      },
    };
  }

  beforeAll(async () => {
    assertIsolatedDatabaseUrl();
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
    await client.user.create({ data: {
      id: ownerUserId,
      phone: `suite_paid_${suffix}`,
      passwordHash: 'integration-test',
    } });
    await client.sourceCaptureSubject.create({ data: {
      id: subjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `suite-paid-${suffix}`,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshotId,
      subjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash: digest(`capture-${suffix}`),
      payloadBytes: 2,
      payload: {},
      stageCounts: {},
      provenance: {},
      provenanceComplete: true,
      parserVersion: 'integration',
      completeness: {},
      truncations: [],
      hasEstimatedValues: false,
      profile: {},
      profileHash: digest(`profile-${suffix}`),
      actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'integration',
      rolloutStage: 'v2_only',
      capturedAt: new Date(),
    } });

    const triggerTables = [
      'ai_media_plans',
      'ai_media_planning_runs',
      'ai_media_plan_versions',
      'ai_media_suites',
      'ai_media_workflows',
      'ai_image_jobs',
      'ai_cost_reservations',
      'ai_media_suite_slots',
      'ai_media_suite_events',
    ];
    await client.$transaction(async (tx: any) => {
      for (const table of triggerTables) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      }
      try {
        for (const target of [paid, fake, retryHistory]) {
          const providerDispatchedAt = target.provider === 'fake' ? null : new Date();
          await tx.aiMediaPlan.create({ data: {
            id: target.planId,
            ownerUserId,
            actorUserId: ownerUserId,
            sourceSubjectId: subjectId,
            contextType: 'collect',
            contextId: `goods-${target.label}-${suffix}`,
            idempotencyKey: `suite-paid-plan-${target.label}-${suffix}`,
            requestFingerprint,
            revision: 2,
            latestVersion: 0,
            reviewStatus: 'NOT_READY',
          } });
          await tx.aiMediaPlanningRun.create({ data: {
            id: target.runId,
            planId: target.planId,
            ownerUserId,
            sourceSubjectId: subjectId,
            actorUserId: ownerUserId,
            sourceCaptureSnapshotId: snapshotId,
            attempt: 1,
            revision: 1,
            mode: 'RULE_BASED',
            engineVersion: 'integration',
            status: 'SUCCEEDED',
            idempotencyKey: `suite-paid-run-${target.label}-${suffix}`,
            requestFingerprint,
            sourceCaptureHash: digest(`capture-${suffix}`),
            sourceProfileHash: digest(`profile-${suffix}`),
            inputFingerprint: digest(`input-${target.label}-${suffix}`),
            inputSnapshot: {},
            inputHash: digest(`input-hash-${target.label}-${suffix}`),
            inputBytes: 2,
            completedAt: new Date(),
          } });
          await tx.aiMediaPlanVersion.create({ data: {
            id: target.versionId,
            planId: target.planId,
            ownerUserId,
            sourceSubjectId: subjectId,
            version: 1,
            planningRunId: target.runId,
            sourceCaptureSnapshotId: snapshotId,
            sourceCaptureHash: digest(`capture-${suffix}`),
            sourceProfileHash: digest(`profile-${suffix}`),
            sourceSchemaVersion: 'source-product-capture-v2',
            selectedSkuHash: digest(`sku-${target.label}-${suffix}`),
            inputAssetSetHash: digest(`assets-${target.label}-${suffix}`),
            inputFingerprint: digest(`input-${target.label}-${suffix}`),
            planSchemaVersion: 'integration',
            plannerVersion: 'integration',
            mode: 'RULE_BASED',
            inputSnapshot: {},
            inputHash: digest(`input-hash-${target.label}-${suffix}`),
            curation: {},
            curationHash: digest(`curation-${target.label}-${suffix}`),
            visionEvidence: {},
            visionEvidenceHash: digest(`vision-${target.label}-${suffix}`),
            planPayload: {},
            planHash: digest(`plan-${target.label}-${suffix}`),
            planBytes: 2,
            provenance: {},
            provenanceHash: digest(`provenance-${target.label}-${suffix}`),
            actorUserId: ownerUserId,
          } });
          await tx.aiMediaPlan.update({ where: { id: target.planId }, data: {
            latestVersion: 1,
            currentVersionId: target.versionId,
            approvedVersionId: target.versionId,
            reviewStatus: 'APPROVED',
            reviewedByUserId: ownerUserId,
            reviewedAt: new Date(),
          } });
          await tx.aiMediaSuite.create({ data: {
            id: target.suiteId,
            ownerUserId,
            actorUserId: ownerUserId,
            planId: target.planId,
            planVersionId: target.versionId,
            sourceSubjectId: subjectId,
            sourceCaptureSnapshotId: snapshotId,
            sourceCaptureHash: digest(`capture-${suffix}`),
            sourceProfileHash: digest(`profile-${suffix}`),
            sourceSchemaVersion: 'source-product-capture-v2',
            contextType: 'collect',
            contextId: `goods-${target.label}-${suffix}`,
            status: 'RUNNING',
            revision: 6,
            idempotencyKey: `suite-paid-suite-${target.label}-${suffix}`,
            requestFingerprint,
            previewHash: digest(`preview-${target.label}-${suffix}`),
            provider: target.provider,
            model: target.model,
            providerConfigHash: digest(`provider-${target.label}-${suffix}`),
            pricingVersion: 'integration',
            itemCount: 1,
            estimatedCostCents: target.costCents,
            maximumCostCents: target.costCents,
            concurrencyLimit: 1,
          } });
          await tx.aiMediaWorkflow.create({ data: {
            id: target.workflowId,
            ownerUserId,
            actorUserId: ownerUserId,
            operation: 'IMAGE_TO_IMAGE',
            status: 'RUNNING',
            reviewStatus: 'NOT_READY',
            revision: 3,
            currentAttempt: 1,
            contextType: 'collect',
            contextId: `goods-${target.label}-${suffix}`,
            contextSlotKey: 'hero',
            idempotencyKey: `suite-paid-workflow-${target.label}-${suffix}`,
            requestFingerprint,
          } });
          await tx.aiImageJob.create({ data: {
            id: target.jobId,
            ownerUserId,
            actorUserId: ownerUserId,
            status: 'RUNNING',
            operation: 'IMAGE_TO_IMAGE',
            workflowId: target.workflowId,
            workflowAttempt: 1,
            provider: target.provider,
            model: target.model,
            prompt: 'Frozen paid suite prompt',
            negativePrompt: 'No product identity changes',
            resolvedPrompt: 'Frozen paid suite prompt',
            resolvedNegativePrompt: 'No product identity changes',
            templateKey: 'image-suite-generation.base',
            templateReleaseId: `release-${suffix}`,
            templateChecksum: digest(`template-${suffix}`),
            templateSnapshot: {},
            requestFingerprint,
            inputAssets: frozenInputAssets,
            operationConfig: frozenOperationConfig,
            requestedImageCount: 1,
            width: 900,
            height: 1_200,
            attemptCount: 1,
            maxAttempts: 1,
            progress: 50,
            idempotencyKey: `${target.workflowId}:attempt:1`,
            providerDispatchedAt,
            providerJobId: target.providerJobId,
            estimatedCostCents: target.costCents,
            actualCostCents: target.provider === 'fake' ? null : target.costCents,
            billedUnits: target.provider === 'fake' ? 0 : 1,
            startedAt: new Date(),
          } });
          await tx.aiCostReservation.create({ data: {
            id: target.reservationId,
            ownerUserId,
            actorUserId: ownerUserId,
            workflowId: target.workflowId,
            jobId: target.jobId,
            idempotencyKey: `${target.jobId}:cost`,
            requestFingerprint,
            provider: target.provider,
            model: target.model,
            operation: 'IMAGE_TO_IMAGE',
            currency: 'USD',
            estimatedCostMinor: target.costCents,
            maximumCostMinor: target.costCents,
            status: 'RESERVED',
          } });
          await tx.aiMediaSuiteSlot.create({ data: {
            id: target.slotId,
            suiteId: target.suiteId,
            ownerUserId,
            ordinal: 0,
            slotKey: 'hero',
            goal: 'hero',
            ownershipLevel: 'sku',
            ownershipKey: `sku-${target.label}-${suffix}`,
            slotSnapshot: {},
            slotHash: digest(`slot-${target.label}-${suffix}`),
            referencesSnapshot: [],
            referencesHash: digest(`references-${target.label}-${suffix}`),
            diagnostics: {},
            status: 'RUNNING',
            childWorkflowId: target.workflowId,
            attempt: 1,
            revision: 4,
            executionClaimToken: target.claimToken,
            executionLeaseExpiresAt: new Date(Date.now() + 10 * 60_000),
            estimatedCostCents: target.costCents,
            maximumCostCents: target.costCents,
          } });
          await tx.aiMediaSuiteEvent.create({ data: {
            id: `suite_paid_event_5_${target.label}_${suffix}`,
            suiteId: target.suiteId,
            ownerUserId,
            revision: 5,
            actorUserId: ownerUserId,
            eventKey: `${target.suiteId}:execution:5`,
            eventType: 'SUITE_DISPATCHED',
            payload: { afterStatus: 'QUEUED' },
            payloadHash: digest(`event-5-${target.label}-${suffix}`),
          } });
          const runningPayload = eventPayload({
            target,
            beforeRevision: 5,
            afterRevision: 6,
            beforeStatus: 'QUEUED',
            afterStatus: 'RUNNING',
            slotRevision: 4,
            eventType: 'SUITE_CHILD_RUNNING',
          });
          await tx.aiMediaSuiteEvent.create({ data: {
            id: `suite_paid_event_6_${target.label}_${suffix}`,
            suiteId: target.suiteId,
            ownerUserId,
            revision: 6,
            actorUserId: ownerUserId,
            eventKey: `${target.suiteId}:execution:6`,
            eventType: 'SUITE_CHILD_RUNNING',
            payload: runningPayload,
            payloadHash: digest(JSON.stringify(runningPayload)),
          } });
        }

        await tx.aiImageJob.update({ where: { id: retryHistory.jobId }, data: {
          status: 'FAILED',
          progress: 0,
          actualCostCents: null,
          billedUnits: 0,
          errorCode: 'PROVIDER_RESULT_UNCERTAIN',
          errorMessage: 'older dispatched attempt requires manual review',
          providerReconciliationStatus: 'MANUAL_REVIEW',
          completedAt: new Date(),
        } });
        await tx.aiCostReservation.update({
          where: { id: retryHistory.reservationId },
          data: { status: 'RELEASED', releasedAt: new Date() },
        });
        await tx.aiImageJob.create({ data: {
          id: retryAttempt2JobId,
          ownerUserId,
          actorUserId: ownerUserId,
          status: 'FAILED',
          operation: 'IMAGE_TO_IMAGE',
          workflowId: retryHistory.workflowId,
          workflowAttempt: 2,
          provider: retryHistory.provider,
          model: retryHistory.model,
          prompt: 'Frozen paid suite prompt',
          negativePrompt: 'No product identity changes',
          resolvedPrompt: 'Frozen paid suite prompt',
          resolvedNegativePrompt: 'No product identity changes',
          templateKey: 'image-suite-generation.base',
          templateReleaseId: `release-${suffix}`,
          templateChecksum: digest(`template-${suffix}`),
          templateSnapshot: {},
          requestFingerprint,
          inputAssets: frozenInputAssets,
          operationConfig: frozenOperationConfig,
          requestedImageCount: 1,
          width: 900,
          height: 1_200,
          attemptCount: 0,
          maxAttempts: 1,
          progress: 0,
          idempotencyKey: `${retryHistory.workflowId}:attempt:2`,
          providerReconciliationStatus: 'NOT_SUBMITTED',
          providerReconciliationRevision: 1,
          providerReconciledAt: new Date(),
          estimatedCostCents: retryHistory.costCents,
          billedUnits: 0,
          errorCode: 'PROVIDER_NOT_SUBMITTED',
          errorMessage: 'latest attempt was proven not submitted',
          completedAt: new Date(),
        } });
        await tx.aiCostReservation.create({ data: {
          id: retryAttempt2ReservationId,
          ownerUserId,
          actorUserId: ownerUserId,
          workflowId: retryHistory.workflowId,
          jobId: retryAttempt2JobId,
          idempotencyKey: `${retryAttempt2JobId}:cost`,
          requestFingerprint,
          provider: retryHistory.provider,
          model: retryHistory.model,
          operation: 'IMAGE_TO_IMAGE',
          currency: 'USD',
          estimatedCostMinor: retryHistory.costCents,
          maximumCostMinor: retryHistory.costCents,
          status: 'RELEASED',
          releasedAt: new Date(),
        } });
        await tx.aiMediaWorkflow.update({ where: { id: retryHistory.workflowId }, data: {
          status: 'FAILED',
          currentAttempt: 2,
          completedAt: new Date(),
          revision: 4,
        } });
        await tx.aiMediaSuiteSlot.update({ where: { id: retryHistory.slotId }, data: {
          status: 'FAILED',
          attempt: 2,
          revision: 5,
          executionClaimToken: null,
          executionLeaseExpiresAt: null,
          errorCode: 'PROVIDER_NOT_SUBMITTED',
          errorMessage: 'latest attempt was proven not submitted',
        } });
        await tx.aiMediaSuite.update({ where: { id: retryHistory.suiteId }, data: {
          status: 'FAILED',
          revision: 7,
          completedAt: new Date(),
        } });
      } finally {
        for (const table of [...triggerTables].reverse()) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
        }
      }
    }, { timeout: 30_000 });
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('renews only a live paid claim with the same fencing token', async () => {
    const stored = await client.aiMediaSuiteSlot.findUniqueOrThrow({ where: { id: paid.slotId } });
    const renewedExpiry = new Date(
      (stored.executionLeaseExpiresAt?.getTime() || Date.now()) + 5 * 60_000,
    );
    await expect(client.aiMediaSuiteSlot.update({
      where: { id: paid.slotId },
      data: {
        executionClaimToken: paid.claimToken,
        executionLeaseExpiresAt: renewedExpiry,
      },
    })).resolves.toMatchObject({
      revision: 4,
      executionClaimToken: paid.claimToken,
      executionLeaseExpiresAt: renewedExpiry,
    });

    await expect(client.aiMediaSuiteSlot.update({
      where: { id: paid.slotId },
      data: {
        executionClaimToken: digest(`replacement-${suffix}`),
        executionLeaseExpiresAt: new Date(renewedExpiry.getTime() + 5 * 60_000),
      },
    })).rejects.toThrow(/lease renewal must preserve a live claim|slot revision must advance by one/u);
  });

  it('accepts one paid raw result and rejects forged, duplicate and fake raw evidence', async () => {
    await expect(client.mediaAsset.create({
      data: rawAssetData(paid, `suite_paid_forged_${suffix}`, `forged-provider-job-${suffix}`),
    })).rejects.toThrow(/raw Provider output is invalid/u);
    expect(await client.mediaAsset.count({ where: { aiImageJobId: paid.jobId } })).toBe(0);

    await expect(client.mediaAsset.create({
      data: rawAssetData(paid, rawAssetId),
    })).resolves.toMatchObject({ id: rawAssetId, kind: 'AI_PROVIDER_OUTPUT' });

    await expect(client.mediaAsset.create({
      data: rawAssetData(paid, `suite_paid_duplicate_${suffix}`),
    })).rejects.toThrow(/raw Provider output is invalid/u);
    await expect(client.mediaAsset.create({
      data: rawAssetData(fake, `suite_fake_raw_${suffix}`, null),
    })).rejects.toThrow(/raw Provider output is invalid/u);
    expect(await client.mediaAsset.count({ where: { aiImageJobId: paid.jobId } })).toBe(1);
    expect(await client.mediaAsset.count({ where: { aiImageJobId: fake.jobId } })).toBe(0);
  });

  it('never permits raw Provider evidence to become the selected or approved output', async () => {
    await expect(client.aiMediaWorkflow.update({
      where: { id: paid.workflowId },
      data: { selectedOutputAssetId: rawAssetId, revision: { increment: 1 } },
    })).rejects.toThrow(/selection requires the normalized current output/u);
    await expect(client.aiMediaWorkflow.update({
      where: { id: paid.workflowId },
      data: {
        reviewStatus: 'APPROVED',
        selectedOutputAssetId: rawAssetId,
        revision: { increment: 1 },
      },
    })).rejects.toThrow(/approval requires the current successful output|selection requires the normalized current output/u);
  });

  it('rejects a final output forged against a different raw Provider result', async () => {
    await expect(client.$transaction(async (tx: any) => {
      await tx.aiCostSettlement.create({ data: {
        id: `suite_paid_forged_charge_${suffix}`,
        reservationId: paid.reservationId,
        ownerUserId,
        actorUserId: ownerUserId,
        kind: 'CHARGE',
        idempotencyKey: `${paid.reservationId}:forged-charge`,
        requestFingerprint,
        actualCostMinor: paid.costCents,
        billedUnits: 1,
      } });
      await tx.aiCostReservation.update({ where: { id: paid.reservationId }, data: {
        status: 'SETTLED',
        settledAt: new Date(),
      } });
      await tx.aiImageJob.update({ where: { id: paid.jobId }, data: {
        status: 'SUCCEEDED',
        progress: 100,
        completedAt: new Date(),
      } });
      await tx.mediaAsset.create({ data: finalAssetData(
        `suite_paid_forged_final_${suffix}`,
        `different-raw-${suffix}`,
      ) });
    })).rejects.toThrow(/final output is not bound to its raw Provider output/u);
    expect(await client.aiImageJob.findUniqueOrThrow({ where: { id: paid.jobId } }))
      .toMatchObject({ status: 'RUNNING' });
  });

  it('commits a paid raw-to-normalized success graph', async () => {
    await client.$transaction(async (tx: any) => {
      await tx.aiCostSettlement.create({ data: {
        id: `suite_paid_charge_${suffix}`,
        reservationId: paid.reservationId,
        ownerUserId,
        actorUserId: ownerUserId,
        kind: 'CHARGE',
        idempotencyKey: `${paid.reservationId}:charge`,
        requestFingerprint,
        actualCostMinor: paid.costCents,
        billedUnits: 1,
      } });
      await tx.aiCostReservation.update({ where: { id: paid.reservationId }, data: {
        status: 'SETTLED',
        settledAt: new Date(),
      } });
      await tx.aiImageJob.update({ where: { id: paid.jobId }, data: {
        status: 'SUCCEEDED',
        progress: 100,
        completedAt: new Date(),
      } });
      await tx.mediaAsset.create({ data: finalAssetData(finalAssetId, rawAssetId) });
      await tx.aiMediaWorkflow.update({ where: { id: paid.workflowId }, data: {
        status: 'SUCCEEDED',
        reviewStatus: 'PENDING',
        completedAt: new Date(),
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: paid.slotId }, data: {
        status: 'SUCCEEDED',
        executionClaimToken: null,
        executionLeaseExpiresAt: null,
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuite.update({ where: { id: paid.suiteId }, data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        revision: { increment: 1 },
      } });
      const succeededPayload = eventPayload({
        target: paid,
        beforeRevision: 6,
        afterRevision: 7,
        beforeStatus: 'RUNNING',
        afterStatus: 'SUCCEEDED',
        slotRevision: 5,
        eventType: 'SUITE_CHILD_SUCCEEDED',
      });
      await tx.aiMediaSuiteEvent.create({ data: {
        id: `suite_paid_event_7_${suffix}`,
        suiteId: paid.suiteId,
        ownerUserId,
        revision: 7,
        actorUserId: ownerUserId,
        eventKey: `${paid.suiteId}:execution:7`,
        eventType: 'SUITE_CHILD_SUCCEEDED',
        payload: succeededPayload,
        payloadHash: digest(JSON.stringify(succeededPayload)),
      } });
    });

    await expect(client.mediaAsset.findMany({
      where: { aiImageJobId: paid.jobId },
      orderBy: { kind: 'asc' },
    })).resolves.toHaveLength(2);
    await expect(client.aiMediaSuite.findUniqueOrThrow({ where: { id: paid.suiteId } }))
      .resolves.toMatchObject({ status: 'SUCCEEDED', revision: 7 });
  });

  it('keeps both raw evidence and normalized output immutable and undeletable', async () => {
    for (const assetId of [rawAssetId, finalAssetId]) {
      await expect(client.mediaAsset.update({
        where: { id: assetId },
        data: { url: `https://storage.example/${suffix}/mutated.png` },
      })).rejects.toThrow(/child output evidence is immutable/u);
      await expect(client.mediaAsset.delete({ where: { id: assetId } }))
        .rejects.toThrow(/child output evidence cannot be deleted/u);
    }
  });

  it('does not revive an expired execution lease', async () => {
    await client.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe('ALTER TABLE "ai_media_suite_slots" DISABLE TRIGGER USER');
      try {
        await tx.$executeRawUnsafe(
          `UPDATE "ai_media_suite_slots"
           SET "execution_lease_expires_at" = statement_timestamp() - interval '1 second'
           WHERE "id" = '${fake.slotId}'`,
        );
      } finally {
        await tx.$executeRawUnsafe('ALTER TABLE "ai_media_suite_slots" ENABLE TRIGGER USER');
      }
    });

    await expect(client.aiMediaSuiteSlot.update({
      where: { id: fake.slotId },
      data: {
        executionClaimToken: fake.claimToken,
        executionLeaseExpiresAt: new Date(Date.now() + 5 * 60_000),
      },
    })).rejects.toThrow(/lease renewal must preserve a live claim|slot revision must advance by one/u);
  });

  it('rejects an ordinary retry when any older attempt still requires reconciliation', async () => {
    const attempts = await client.aiImageJob.findMany({
      where: { workflowId: retryHistory.workflowId },
      orderBy: { workflowAttempt: 'asc' },
    });
    expect(attempts).toMatchObject([
      {
        workflowAttempt: 1,
        status: 'FAILED',
        providerReconciliationStatus: 'MANUAL_REVIEW',
        providerDispatchedAt: expect.any(Date),
        actualCostCents: null,
        billedUnits: 0,
      },
      {
        workflowAttempt: 2,
        status: 'FAILED',
        providerReconciliationStatus: 'NOT_SUBMITTED',
        providerDispatchedAt: null,
        providerJobId: null,
        actualCostCents: null,
        billedUnits: 0,
      },
    ]);
    await expect(client.aiImageJob.create({ data: {
      id: `suite_paid_job_retry_history_3_${suffix}`,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'QUEUED',
      operation: 'IMAGE_TO_IMAGE',
      workflowId: retryHistory.workflowId,
      workflowAttempt: 3,
      provider: retryHistory.provider,
      model: retryHistory.model,
      prompt: 'Frozen paid suite prompt',
      negativePrompt: 'No product identity changes',
      resolvedPrompt: 'Frozen paid suite prompt',
      resolvedNegativePrompt: 'No product identity changes',
      templateKey: 'image-suite-generation.base',
      templateReleaseId: `release-${suffix}`,
      templateChecksum: digest(`template-${suffix}`),
      templateSnapshot: {},
      requestFingerprint,
      inputAssets: frozenInputAssets,
      operationConfig: frozenOperationConfig,
      requestedImageCount: 1,
      width: 900,
      height: 1_200,
      attemptCount: 0,
      maxAttempts: 1,
      progress: 0,
      idempotencyKey: `${retryHistory.workflowId}:attempt:3`,
      estimatedCostCents: retryHistory.costCents,
      billedUnits: 0,
    } })).rejects.toThrow(/retry attempt lacks released no-output authority or frozen identity/u);
    expect(await client.aiImageJob.count({ where: { workflowId: retryHistory.workflowId } }))
      .toBe(2);
  });
});
