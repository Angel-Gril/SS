import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageSuiteExecutionRepository } from '../repositories/ai-image-suite-execution-repository.js';
import { createAiImageSuiteExecutionService } from '../services/ai-image-suite-execution.js';

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

interface SlotCounts {
  planned: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelRequested: number;
  cancelled: number;
  total: number;
  active: number;
}

describe.skipIf(!enabled)('AI image suite PostgreSQL execution state machine', () => {
  let client: PrismaClient;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ownerUserId = `suite_exec_owner_${suffix}`;
  const subjectId = `suite_exec_subject_${suffix}`;
  const snapshotId = `suite_exec_snapshot_${suffix}`;
  const planId = `suite_exec_plan_${suffix}`;
  const runId = `suite_exec_run_${suffix}`;
  const versionId = `suite_exec_version_${suffix}`;
  const suiteId = `suite_exec_suite_${suffix}`;
  const workflowIds = [0, 1].map((ordinal) => `suite_exec_workflow_${ordinal}_${suffix}`);
  const slotIds = [0, 1].map((ordinal) => `suite_exec_slot_${ordinal}_${suffix}`);
  const jobIds = [0, 1].map((ordinal) => `suite_exec_job_${ordinal}_${suffix}`);
  const reservationIds = [0, 1].map((ordinal) => `suite_exec_reservation_${ordinal}_${suffix}`);
  const requestFingerprint = digest(`suite-exec-request-${suffix}`);
  const frozenInputAssets = [{ assetId: `source-${suffix}`, role: 'REFERENCE', ordinal: 0 }];
  const frozenOperationConfig = {
    version: 'ai-image-suite-child-operation/v1',
    outputProfile: 'ozon-suite-3x4-900x1200/v1',
    width: 900,
    height: 1200,
  };

  function assertIsolatedDatabaseUrl(): void {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    const schema = new URL(databaseUrl).searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
      throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
    }
  }

  async function counts(tx: any): Promise<SlotCounts> {
    const grouped = await tx.aiMediaSuiteSlot.groupBy({
      by: ['status'],
      where: { suiteId, ownerUserId },
      _count: { _all: true },
    });
    const result: SlotCounts = {
      planned: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelRequested: 0,
      cancelled: 0,
      total: 0,
      active: 0,
    };
    for (const row of grouped) {
      const value = Number(row._count._all);
      if (row.status === 'PLANNED') result.planned = value;
      if (row.status === 'QUEUED') result.queued = value;
      if (row.status === 'RUNNING') result.running = value;
      if (row.status === 'SUCCEEDED') result.succeeded = value;
      if (row.status === 'FAILED') result.failed = value;
      if (row.status === 'CANCEL_REQUESTED') result.cancelRequested = value;
      if (row.status === 'CANCELLED') result.cancelled = value;
      result.total += value;
    }
    result.active = result.queued + result.running + result.cancelRequested;
    return result;
  }

  async function appendSuiteEvent(tx: any, input: {
    beforeRevision: number;
    beforeStatus: string;
    afterStatus: string;
    eventType: string;
    commandFingerprint?: string;
    slotId?: string;
    childWorkflowId?: string;
    jobId?: string;
    reservationId?: string;
    attempt?: number;
  }): Promise<void> {
    const afterRevision = input.beforeRevision + 1;
    const currentCounts = await counts(tx);
    const suite = await tx.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } });
    const slots = await tx.aiMediaSuiteSlot.findMany({
      where: { suiteId, ownerUserId },
      orderBy: { ordinal: 'asc' },
    });
    const result = {
      suiteId,
      revision: Number(suite.revision),
      status: String(suite.status),
      itemCount: Number(suite.itemCount),
      concurrencyLimit: Number(suite.concurrencyLimit),
      counts: {
        planned: currentCounts.planned,
        queued: currentCounts.queued,
        running: currentCounts.running,
        succeeded: currentCounts.succeeded,
        failed: currentCounts.failed,
        cancelRequested: currentCounts.cancelRequested,
        cancelled: currentCounts.cancelled,
      },
      slots: slots.map((slot: any) => ({
        slotId: String(slot.id),
        ordinal: Number(slot.ordinal),
        slotKey: String(slot.slotKey),
        status: String(slot.status),
        attempt: Number(slot.attempt),
        revision: Number(slot.revision),
        childWorkflowId: String(slot.childWorkflowId || ''),
        error: slot.errorCode ? {
          code: String(slot.errorCode).trim().slice(0, 100) || 'SUITE_CHILD_FAILED',
          message: String(slot.errorMessage || '').trim().slice(0, 2_000)
            || 'AI media suite child failed',
        } : null,
      })),
    };
    const payload = {
      version: 'ai-image-suite-execution-event/v1',
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      beforeRevision: input.beforeRevision,
      afterRevision,
      beforeStatus: input.beforeStatus,
      afterStatus: input.afterStatus,
      counts: currentCounts,
      ...(input.commandFingerprint ? { commandFingerprint: input.commandFingerprint } : {}),
      ...(input.slotId ? { slotId: input.slotId } : {}),
      ...(input.childWorkflowId ? { childWorkflowId: input.childWorkflowId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.reservationId ? { reservationId: input.reservationId } : {}),
      ...(input.attempt ? { attempt: input.attempt } : {}),
      result,
    };
    await tx.aiMediaSuiteEvent.create({ data: {
      id: `suite_exec_event_${afterRevision}_${suffix}`,
      suiteId,
      ownerUserId,
      revision: afterRevision,
      actorUserId: ownerUserId,
      eventKey: `${suiteId}:execution:${afterRevision}`,
      eventType: input.eventType,
      payload,
      payloadHash: digest(JSON.stringify(payload)),
    } });
  }

  beforeAll(async () => {
    assertIsolatedDatabaseUrl();
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
    await client.user.create({ data: {
      id: ownerUserId,
      phone: `suite_exec_${suffix}`,
      passwordHash: 'integration-test',
    } });
    await client.sourceCaptureSubject.create({ data: {
      id: subjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `suite-exec-${suffix}`,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshotId,
      subjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash: 'a'.repeat(64),
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
      profileHash: 'b'.repeat(64),
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
      'ai_media_suite_slots',
      'ai_media_suite_events',
      'ai_media_workflows',
      'ai_image_jobs',
      'ai_cost_reservations',
    ];
    await client.$transaction(async (tx: any) => {
      for (const table of triggerTables) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      }
      try {
        await tx.aiMediaPlan.create({ data: {
          id: planId,
          ownerUserId,
          actorUserId: ownerUserId,
          sourceSubjectId: subjectId,
          contextType: 'collect',
          contextId: `goods-${suffix}`,
          idempotencyKey: `suite-exec-plan-${suffix}`,
          requestFingerprint,
          revision: 2,
          latestVersion: 0,
          reviewStatus: 'NOT_READY',
        } });
        await tx.aiMediaPlanningRun.create({ data: {
          id: runId,
          planId,
          ownerUserId,
          sourceSubjectId: subjectId,
          actorUserId: ownerUserId,
          sourceCaptureSnapshotId: snapshotId,
          attempt: 1,
          revision: 1,
          mode: 'RULE_BASED',
          engineVersion: 'integration',
          status: 'SUCCEEDED',
          idempotencyKey: `suite-exec-run-${suffix}`,
          requestFingerprint,
          sourceCaptureHash: 'a'.repeat(64),
          sourceProfileHash: 'b'.repeat(64),
          inputFingerprint: 'c'.repeat(64),
          inputSnapshot: {},
          inputHash: 'd'.repeat(64),
          inputBytes: 2,
          completedAt: new Date(),
        } });
        await tx.aiMediaPlanVersion.create({ data: {
          id: versionId,
          planId,
          ownerUserId,
          sourceSubjectId: subjectId,
          version: 1,
          planningRunId: runId,
          sourceCaptureSnapshotId: snapshotId,
          sourceCaptureHash: 'a'.repeat(64),
          sourceProfileHash: 'b'.repeat(64),
          sourceSchemaVersion: 'source-product-capture-v2',
          selectedSkuHash: 'e'.repeat(64),
          inputAssetSetHash: 'f'.repeat(64),
          inputFingerprint: 'c'.repeat(64),
          planSchemaVersion: 'integration',
          plannerVersion: 'integration',
          mode: 'RULE_BASED',
          inputSnapshot: {},
          inputHash: 'd'.repeat(64),
          curation: {},
          curationHash: '1'.repeat(64),
          visionEvidence: {},
          visionEvidenceHash: '2'.repeat(64),
          planPayload: {},
          planHash: '3'.repeat(64),
          planBytes: 2,
          provenance: {},
          provenanceHash: '4'.repeat(64),
          actorUserId: ownerUserId,
        } });
        await tx.aiMediaPlan.update({ where: { id: planId }, data: {
          latestVersion: 1,
          currentVersionId: versionId,
          approvedVersionId: versionId,
          reviewStatus: 'APPROVED',
          reviewedByUserId: ownerUserId,
          reviewedAt: new Date(),
        } });
        await tx.aiMediaSuite.create({ data: {
          id: suiteId,
          ownerUserId,
          actorUserId: ownerUserId,
          planId,
          planVersionId: versionId,
          sourceSubjectId: subjectId,
          sourceCaptureSnapshotId: snapshotId,
          sourceCaptureHash: 'a'.repeat(64),
          sourceProfileHash: 'b'.repeat(64),
          sourceSchemaVersion: 'source-product-capture-v2',
          contextType: 'collect',
          contextId: `goods-${suffix}`,
          status: 'PLANNED',
          revision: 4,
          idempotencyKey: `suite-exec-suite-${suffix}`,
          requestFingerprint,
          previewHash: '5'.repeat(64),
          provider: 'fake',
          model: 'fake-image-suite-v1',
          providerConfigHash: '6'.repeat(64),
          pricingVersion: 'integration',
          itemCount: 2,
          estimatedCostCents: 0,
          maximumCostCents: 0,
          concurrencyLimit: 1,
        } });

        for (const ordinal of [0, 1]) {
          await tx.aiMediaWorkflow.create({ data: {
            id: workflowIds[ordinal],
            ownerUserId,
            actorUserId: ownerUserId,
            operation: 'IMAGE_TO_IMAGE',
            status: 'QUEUED',
            reviewStatus: 'NOT_READY',
            revision: 1,
            currentAttempt: 1,
            contextType: 'collect',
            contextId: `goods-${suffix}`,
            contextSlotKey: `slot-${ordinal}`,
            idempotencyKey: `suite-exec-workflow-${ordinal}-${suffix}`,
            requestFingerprint,
          } });
          await tx.aiImageJob.create({ data: {
            id: jobIds[ordinal],
            ownerUserId,
            actorUserId: ownerUserId,
            status: 'PENDING',
            operation: 'IMAGE_TO_IMAGE',
            workflowId: workflowIds[ordinal],
            workflowAttempt: 1,
            provider: 'fake',
            model: 'fake-image-suite-v1',
            prompt: `Frozen prompt ${ordinal}`,
            negativePrompt: 'No product identity changes',
            resolvedPrompt: `Frozen prompt ${ordinal}`,
            resolvedNegativePrompt: 'No product identity changes',
            templateKey: 'image-suite-generation.base',
            templateReleaseId: `release-${suffix}`,
            templateChecksum: '7'.repeat(64),
            templateSnapshot: {},
            requestFingerprint,
            inputAssets: frozenInputAssets,
            operationConfig: frozenOperationConfig,
            requestedImageCount: 1,
            width: 900,
            height: 1200,
            attemptCount: 0,
            maxAttempts: 1,
            progress: 0,
            idempotencyKey: `${workflowIds[ordinal]}:attempt:1`,
            estimatedCostCents: 0,
          } });
          await tx.aiCostReservation.create({ data: {
            id: reservationIds[ordinal],
            ownerUserId,
            actorUserId: ownerUserId,
            workflowId: workflowIds[ordinal],
            jobId: jobIds[ordinal],
            idempotencyKey: `${jobIds[ordinal]}:cost`,
            requestFingerprint,
            provider: 'fake',
            model: 'fake-image-suite-v1',
            operation: 'IMAGE_TO_IMAGE',
            currency: 'USD',
            estimatedCostMinor: 0,
            maximumCostMinor: 0,
            status: 'RESERVED',
          } });
          await tx.aiMediaSuiteSlot.create({ data: {
            id: slotIds[ordinal],
            suiteId,
            ownerUserId,
            ordinal,
            slotKey: `slot-${ordinal}`,
            goal: ordinal === 0 ? 'hero' : 'gallery',
            ownershipLevel: 'sku',
            ownershipKey: `sku-${suffix}`,
            slotSnapshot: {},
            slotHash: String(ordinal + 8).repeat(64),
            referencesSnapshot: [],
            referencesHash: 'a'.repeat(64),
            diagnostics: {},
            status: 'PLANNED',
            childWorkflowId: workflowIds[ordinal],
            attempt: 1,
            revision: 2,
            estimatedCostCents: 0,
            maximumCostCents: 0,
          } });
        }
        for (let revision = 1; revision <= 4; revision += 1) {
          await tx.aiMediaSuiteEvent.create({ data: {
            id: `suite_exec_materialization_event_${revision}_${suffix}`,
            suiteId,
            ownerUserId,
            revision,
            actorUserId: ownerUserId,
            eventKey: `${suiteId}:fixture:${revision}`,
            eventType: revision === 4 ? 'CHILDREN_MATERIALIZED' : 'FIXTURE',
            payload: {},
            payloadHash: String(revision).repeat(64),
          } });
        }
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

  it('dispatches a bounded frontier and rejects an over-concurrency commit', async () => {
    await expect(client.$transaction(async (tx: any) => {
      const now = new Date();
      for (const ordinal of [0, 1]) {
        await tx.aiCostSettlement.create({ data: {
          id: `suite_exec_pre_dispatch_release_${ordinal}_${suffix}`,
          reservationId: reservationIds[ordinal],
          ownerUserId,
          actorUserId: ownerUserId,
          kind: 'RELEASE',
          idempotencyKey: `${reservationIds[ordinal]}:pre-dispatch-release`,
          requestFingerprint,
          actualCostMinor: 0,
          billedUnits: 0,
        } });
        await tx.aiCostReservation.update({ where: { id: reservationIds[ordinal] }, data: {
          status: 'RELEASED', releasedAt: now,
        } });
        await tx.aiImageJob.update({ where: { id: jobIds[ordinal] }, data: {
          status: 'CANCELLED', completedAt: now,
          errorCode: 'SUITE_CANCELLED', errorMessage: 'cancelled before dispatch',
        } });
        await tx.aiMediaWorkflow.update({ where: { id: workflowIds[ordinal] }, data: {
          status: 'CANCELLED', cancelRequestedAt: now, completedAt: now,
          revision: { increment: 1 },
        } });
        await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[ordinal] }, data: {
          status: 'CANCELLED', errorCode: 'SUITE_CANCELLED',
          errorMessage: 'cancelled before dispatch', revision: { increment: 1 },
        } });
      }
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'CANCELLED', cancelRequestedAt: now, completedAt: now,
        revision: { increment: 1 },
      } });
      await appendSuiteEvent(tx, {
        beforeRevision: 4,
        beforeStatus: 'PLANNED',
        afterStatus: 'CANCELLED',
        eventType: 'SUITE_CANCELLED',
        commandFingerprint: digest(`cancel-before-dispatch-${suffix}`),
      });
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      throw new Error('ROLLBACK_CANCEL_BEFORE_DISPATCH_FIXTURE');
    })).rejects.toThrow(/ROLLBACK_CANCEL_BEFORE_DISPATCH_FIXTURE/u);
    expect(await client.aiMediaSuite.findUnique({ where: { id: suiteId } })).toMatchObject({
      revision: 4,
      status: 'PLANNED',
    });

    const service = createAiImageSuiteExecutionService(
      new PrismaAiImageSuiteExecutionRepository(client),
    );
    await expect(service.dispatch({
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: 4,
      operationKey: `dispatch-${suffix}`,
    })).resolves.toMatchObject({ status: 'QUEUED', revision: 5, replayed: false });
    expect(await client.aiMediaSuite.findUnique({ where: { id: suiteId } })).toMatchObject({
      revision: 5,
      status: 'QUEUED',
    });

    await expect(client.$transaction(async (tx: any) => {
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'QUEUED', revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[1] }, data: {
        status: 'QUEUED', revision: { increment: 1 },
      } });
      await tx.aiImageJob.update({ where: { id: jobIds[1] }, data: { status: 'QUEUED' } });
      await appendSuiteEvent(tx, {
        beforeRevision: 5,
        beforeStatus: 'QUEUED',
        afterStatus: 'QUEUED',
        eventType: 'SUITE_DISPATCHED',
        commandFingerprint: digest(`forged-second-frontier-${suffix}`),
      });
    })).rejects.toThrow(/concurrency limit is invalid/u);
    expect(await client.aiMediaSuiteSlot.findUnique({ where: { id: slotIds[1] } }))
      .toMatchObject({ status: 'PLANNED', attempt: 1 });
  });

  it('aggregates success, advances the frontier and forbids regenerating the successful slot', async () => {
    await client.$transaction(async (tx: any) => {
      await tx.aiImageJob.update({ where: { id: jobIds[0] }, data: {
        status: 'RUNNING', attemptCount: 1, progress: 10, startedAt: new Date(),
      } });
      await tx.aiMediaWorkflow.update({ where: { id: workflowIds[0] }, data: {
        status: 'RUNNING', revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[0] }, data: {
        status: 'RUNNING',
        executionClaimToken: digest(`claim-0-${suffix}`),
        executionLeaseExpiresAt: new Date(Date.now() + 5 * 60_000),
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'RUNNING', revision: { increment: 1 },
      } });
      await appendSuiteEvent(tx, {
        beforeRevision: 5,
        beforeStatus: 'QUEUED',
        afterStatus: 'RUNNING',
        eventType: 'SUITE_CHILD_RUNNING',
        slotId: slotIds[0], childWorkflowId: workflowIds[0], jobId: jobIds[0],
        reservationId: reservationIds[0], attempt: 1,
      });
    });

    await expect(client.aiMediaSuiteSlot.update({
      where: { id: slotIds[0] },
      data: {
        executionClaimToken: digest(`replacement-claim-0-${suffix}`),
        executionLeaseExpiresAt: new Date(Date.now() + 10 * 60_000),
        revision: { increment: 1 },
      },
    })).rejects.toThrow(/claim cannot be renewed or replaced/u);

    await client.$transaction(async (tx: any) => {
      await tx.aiCostSettlement.create({ data: {
        id: `suite_exec_charge_${suffix}`,
        reservationId: reservationIds[0],
        ownerUserId,
        actorUserId: ownerUserId,
        kind: 'CHARGE',
        idempotencyKey: `${reservationIds[0]}:charge`,
        requestFingerprint,
        actualCostMinor: 0,
        billedUnits: 1,
      } });
      await tx.aiCostReservation.update({ where: { id: reservationIds[0] }, data: {
        status: 'SETTLED', settledAt: new Date(),
      } });
      await tx.aiImageJob.update({ where: { id: jobIds[0] }, data: {
        status: 'SUCCEEDED', progress: 100, actualCostCents: 0, billedUnits: 1,
        completedAt: new Date(),
      } });
      await tx.mediaAsset.create({ data: {
        id: `suite_exec_output_${suffix}`,
        ownerUserId,
        aiImageJobId: jobIds[0],
        kind: 'AI_GENERATED',
        url: `https://storage.example/${suffix}/hero.png`,
        storageBackend: 'local',
        storageKey: `${suffix}/hero.png`,
        mimeType: 'image/png',
        sizeBytes: 68,
        width: 900,
        height: 1200,
        sha256: 'c'.repeat(64),
      } });
      await tx.aiMediaWorkflow.update({ where: { id: workflowIds[0] }, data: {
        status: 'SUCCEEDED', reviewStatus: 'PENDING', completedAt: new Date(),
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[0] }, data: {
        status: 'SUCCEEDED', executionClaimToken: null, executionLeaseExpiresAt: null,
        revision: { increment: 1 },
      } });
      await tx.aiImageJob.update({ where: { id: jobIds[1] }, data: { status: 'QUEUED' } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[1] }, data: {
        status: 'QUEUED', revision: { increment: 1 },
      } });
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'QUEUED', revision: { increment: 1 },
      } });
      await appendSuiteEvent(tx, {
        beforeRevision: 6,
        beforeStatus: 'RUNNING',
        afterStatus: 'QUEUED',
        eventType: 'SUITE_CHILD_SUCCEEDED',
        slotId: slotIds[0], childWorkflowId: workflowIds[0], jobId: jobIds[0],
        reservationId: reservationIds[0], attempt: 1,
      });
    });
    await expect(client.aiMediaSuiteSlot.update({
      where: { id: slotIds[0] },
      data: { status: 'FAILED', attempt: { increment: 1 }, revision: { increment: 1 } },
    })).rejects.toThrow(/AI media suite slot is terminal|terminal AI media suite slot/u);
    expect(await client.mediaAsset.count({ where: { aiImageJobId: jobIds[0] } })).toBe(1);
  });

  it('retries only the failed slot with a new frozen attempt and cancels without losing success', async () => {
    await client.$transaction(async (tx: any) => {
      await tx.aiImageJob.update({ where: { id: jobIds[1] }, data: {
        status: 'RUNNING', attemptCount: 1, progress: 10, startedAt: new Date(),
      } });
      await tx.aiMediaWorkflow.update({ where: { id: workflowIds[1] }, data: {
        status: 'RUNNING', revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[1] }, data: {
        status: 'RUNNING',
        executionClaimToken: digest(`claim-1-${suffix}`),
        executionLeaseExpiresAt: new Date(Date.now() + 5 * 60_000),
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'RUNNING', revision: { increment: 1 },
      } });
      await appendSuiteEvent(tx, {
        beforeRevision: 7,
        beforeStatus: 'QUEUED',
        afterStatus: 'RUNNING',
        eventType: 'SUITE_CHILD_RUNNING',
        slotId: slotIds[1], childWorkflowId: workflowIds[1], jobId: jobIds[1],
        reservationId: reservationIds[1], attempt: 1,
      });
    });

    await client.$transaction(async (tx: any) => {
      await tx.aiCostSettlement.create({ data: {
        id: `suite_exec_release_${suffix}`,
        reservationId: reservationIds[1],
        ownerUserId,
        actorUserId: ownerUserId,
        kind: 'RELEASE',
        idempotencyKey: `${reservationIds[1]}:release`,
        requestFingerprint,
        actualCostMinor: 0,
        billedUnits: 0,
      } });
      await tx.aiCostReservation.update({ where: { id: reservationIds[1] }, data: {
        status: 'RELEASED', releasedAt: new Date(),
      } });
      await tx.aiImageJob.update({ where: { id: jobIds[1] }, data: {
        status: 'FAILED', progress: 0, billedUnits: 0, completedAt: new Date(),
        errorCode: 'PROVIDER_REJECTED', errorMessage: 'integration failure',
      } });
      await tx.aiMediaWorkflow.update({ where: { id: workflowIds[1] }, data: {
        status: 'FAILED', reviewStatus: 'NOT_READY', completedAt: new Date(),
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[1] }, data: {
        status: 'FAILED', errorCode: 'PROVIDER_REJECTED', errorMessage: 'integration failure',
        executionClaimToken: null, executionLeaseExpiresAt: null,
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'PARTIAL_FAILURE', completedAt: new Date(), revision: { increment: 1 },
      } });
      await appendSuiteEvent(tx, {
        beforeRevision: 8,
        beforeStatus: 'RUNNING',
        afterStatus: 'PARTIAL_FAILURE',
        eventType: 'SUITE_CHILD_FAILED',
        slotId: slotIds[1], childWorkflowId: workflowIds[1], jobId: jobIds[1],
        reservationId: reservationIds[1], attempt: 1,
      });
    });

    const retryJobId = `suite_exec_retry_job_${suffix}`;
    const retryReservationId = `suite_exec_retry_reservation_${suffix}`;
    await client.$transaction(async (tx: any) => {
      await tx.aiImageJob.create({ data: {
        id: retryJobId,
        ownerUserId,
        actorUserId: ownerUserId,
        status: 'QUEUED',
        operation: 'IMAGE_TO_IMAGE',
        workflowId: workflowIds[1],
        workflowAttempt: 2,
        provider: 'fake',
        model: 'fake-image-suite-v1',
        prompt: 'Frozen prompt 1',
        negativePrompt: 'No product identity changes',
        resolvedPrompt: 'Frozen prompt 1',
        resolvedNegativePrompt: 'No product identity changes',
        templateKey: 'image-suite-generation.base',
        templateReleaseId: `release-${suffix}`,
        templateChecksum: '7'.repeat(64),
        templateSnapshot: {},
        requestFingerprint,
        inputAssets: frozenInputAssets,
        operationConfig: frozenOperationConfig,
        requestedImageCount: 1,
        width: 900,
        height: 1200,
        attemptCount: 0,
        maxAttempts: 1,
        progress: 0,
        idempotencyKey: `${workflowIds[1]}:attempt:2`,
        estimatedCostCents: 0,
      } });
      await tx.aiCostReservation.create({ data: {
        id: retryReservationId,
        ownerUserId,
        actorUserId: ownerUserId,
        workflowId: workflowIds[1],
        jobId: retryJobId,
        idempotencyKey: `${retryJobId}:cost`,
        requestFingerprint,
        provider: 'fake',
        model: 'fake-image-suite-v1',
        operation: 'IMAGE_TO_IMAGE',
        currency: 'USD',
        estimatedCostMinor: 0,
        maximumCostMinor: 0,
        status: 'RESERVED',
      } });
      await tx.aiMediaWorkflow.update({ where: { id: workflowIds[1] }, data: {
        status: 'QUEUED', reviewStatus: 'NOT_READY', currentAttempt: 2,
        completedAt: null, revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[1] }, data: {
        status: 'QUEUED', attempt: 2, errorCode: null, errorMessage: null,
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'QUEUED', completedAt: null, revision: { increment: 1 },
      } });
      await appendSuiteEvent(tx, {
        beforeRevision: 9,
        beforeStatus: 'PARTIAL_FAILURE',
        afterStatus: 'QUEUED',
        eventType: 'SUITE_SLOT_RETRY_REQUESTED',
        commandFingerprint: digest(`retry-${suffix}`),
        slotId: slotIds[1], childWorkflowId: workflowIds[1], jobId: retryJobId,
        reservationId: retryReservationId, attempt: 2,
      });
    });
    expect(await client.aiImageJob.findMany({
      where: { workflowId: workflowIds[1] }, orderBy: { workflowAttempt: 'asc' },
    })).toMatchObject([{ status: 'FAILED', workflowAttempt: 1 }, { status: 'QUEUED', workflowAttempt: 2 }]);

    await client.$transaction(async (tx: any) => {
      await tx.aiCostSettlement.create({ data: {
        id: `suite_exec_retry_release_${suffix}`,
        reservationId: retryReservationId,
        ownerUserId,
        actorUserId: ownerUserId,
        kind: 'RELEASE',
        idempotencyKey: `${retryReservationId}:release`,
        requestFingerprint,
        actualCostMinor: 0,
        billedUnits: 0,
      } });
      await tx.aiCostReservation.update({ where: { id: retryReservationId }, data: {
        status: 'RELEASED', releasedAt: new Date(),
      } });
      await tx.aiImageJob.update({ where: { id: retryJobId }, data: {
        status: 'CANCELLED', completedAt: new Date(),
        errorCode: 'SUITE_CANCELLED', errorMessage: 'integration cancellation',
      } });
      await tx.aiMediaWorkflow.update({ where: { id: workflowIds[1] }, data: {
        status: 'CANCELLED', cancelRequestedAt: new Date(), completedAt: new Date(),
        revision: { increment: 1 },
      } });
      await tx.aiMediaSuiteSlot.update({ where: { id: slotIds[1] }, data: {
        status: 'CANCELLED', errorCode: 'SUITE_CANCELLED',
        errorMessage: 'integration cancellation', revision: { increment: 1 },
      } });
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: {
        status: 'CANCELLED', cancelRequestedAt: new Date(), completedAt: new Date(),
        revision: { increment: 1 },
      } });
      await appendSuiteEvent(tx, {
        beforeRevision: 10,
        beforeStatus: 'QUEUED',
        afterStatus: 'CANCELLED',
        eventType: 'SUITE_CANCELLED',
        commandFingerprint: digest(`cancel-${suffix}`),
      });
    });
    const finalSlots = await client.aiMediaSuiteSlot.findMany({
      where: { suiteId, ownerUserId }, orderBy: { ordinal: 'asc' },
    });
    expect(finalSlots).toMatchObject([
      { status: 'SUCCEEDED', attempt: 1 },
      { status: 'CANCELLED', attempt: 2 },
    ]);
    expect(await client.mediaAsset.count({ where: { aiImageJobId: jobIds[0] } })).toBe(1);
    await expect(client.aiCostReservation.delete({ where: { id: retryReservationId } }))
      .rejects.toThrow(/cost reservation cannot be deleted/u);
  });
});
