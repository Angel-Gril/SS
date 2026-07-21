import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiProviderReconciliationRepository } from '../repositories/ai-provider-reconciliation-repository.js';
import { createAiProviderReconciliationAdminService } from '../services/ai-provider-reconciliation-admin.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const first = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;
const second = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

describePostgres('AI Provider reconciliation PostgreSQL authority', () => {
  beforeAll(async () => {
    const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
      throw new Error('AI Provider reconciliation test requires an isolated schema');
    }
    await Promise.all([first!.$connect(), second!.$connect()]);
  });
  afterAll(async () => Promise.all([first!.$disconnect(), second!.$disconnect()]));

  it('fences two claimers, resumes by the same task ID and makes the terminal outcome immutable', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `provider_reconcile_owner_${suffix}`;
    const jobId = `provider_reconcile_job_${suffix}`;
    const dueAt = new Date('2026-07-21T08:00:00.000Z');
    const deadlineAt = new Date('2026-07-22T08:00:00.000Z');
    await first!.user.create({ data: {
      id: ownerUserId,
      phone: `provider_reconcile_${suffix}`,
      passwordHash: 'integration-test',
    } });
    await first!.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'FAILED',
      operation: 'IMAGE_TRANSLATE',
      provider: 'fake',
      model: 'fake-image-translation-v1',
      prompt: 'Provider reconciliation integration',
      width: 1,
      height: 1,
      providerJobId: `provider-task-${suffix}`,
      providerDispatchedAt: dueAt,
      errorCode: 'PROVIDER_POLL_TIMEOUT',
      errorMessage: 'normal polling expired',
      providerReconciliationStatus: 'PENDING',
      providerReconciliationRevision: 1,
      providerReconciliationNextAt: dueAt,
      providerReconciliationDeadlineAt: deadlineAt,
    } });

    const firstRepository = new PrismaAiProviderReconciliationRepository(first!);
    const secondRepository = new PrismaAiProviderReconciliationRepository(second!);
    const results = await Promise.all([
      firstRepository.claimDue({ workerId: 'worker-a', now: dueAt, limit: 10, leaseMs: 60_000 }),
      secondRepository.claimDue({ workerId: 'worker-b', now: dueAt, limit: 10, leaseMs: 60_000 }),
    ]);
    const claims = results.flat();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ jobId, providerJobId: `provider-task-${suffix}` });

    const retryAt = new Date('2026-07-21T08:01:00.000Z');
    await (results[0].length ? firstRepository : secondRepository).defer({
      claim: claims[0]!,
      nextAttemptAt: retryAt,
      providerStatus: 'RUNNING',
    });
    const reclaimed = await secondRepository.claimDue({
      workerId: 'worker-c', now: retryAt, limit: 10, leaseMs: 60_000,
    });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.reconciliationAttemptCount).toBe(2);
    await secondRepository.completeNoOutput({
      claim: reclaimed[0]!,
      providerStatus: 'FAILED',
      errorCode: 'PROVIDER_TASK_FAILED',
      errorMessage: 'Provider task failed',
      billingDisposition: 'UNKNOWN',
    });

    const terminal = await first!.aiImageJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(terminal).toMatchObject({
      status: 'FAILED',
      providerJobId: `provider-task-${suffix}`,
      providerReconciliationStatus: 'NO_OUTPUT',
      providerReconciliationRevision: 5,
      providerReconciliationAttemptCount: 2,
    });
    expect(terminal.providerReconciledAt).toBeInstanceOf(Date);
    await expect(first!.aiImageJob.update({
      where: { id: jobId },
      data: { providerReconciliationLastErrorMessage: 'tampered terminal evidence' },
    })).rejects.toThrow(/terminal AI provider reconciliation is immutable/iu);
  });

  it('audits an idempotent standalone manual decision without a workflow row', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `provider_manual_owner_${suffix}`;
    const jobId = `provider_manual_job_${suffix}`;
    await first!.user.create({ data: {
      id: ownerUserId,
      phone: `provider_manual_${suffix}`,
      passwordHash: 'integration-test',
    } });
    await first!.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'FAILED',
      operation: 'IMAGE_TRANSLATE',
      provider: 'dashscope-qwen-mt-image',
      model: 'qwen-mt-image',
      prompt: 'Standalone Provider reconciliation integration',
      width: 1,
      height: 1,
      errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
      errorMessage: 'submission outcome is unknown',
      providerReconciliationStatus: 'MANUAL_REVIEW',
      providerReconciliationRevision: 1,
      completedAt: new Date(),
    } });
    const service = createAiProviderReconciliationAdminService({ database: first! });
    const listed = await service.listReconciliations({ limit: 100 });
    const item = listed.items.find((entry: any) => entry.id === jobId);
    expect(item).toMatchObject({
      workflowId: null,
      allowedActions: ['RESUME', 'NOT_SUBMITTED'],
    });
    const decision = {
      jobId,
      actorUserId: ownerUserId,
      requestId: randomUUID(),
      expectedStatus: 'MANUAL_REVIEW' as const,
      expectedRevision: 1,
      expectedEvidenceHash: item!.evidenceHash,
      action: 'NOT_SUBMITTED' as const,
      reason: 'Provider dashboard confirms no standalone task was created',
    };

    await expect(service.resolveReconciliation(decision)).resolves.toMatchObject({
      status: 'NOT_SUBMITTED',
      revision: 2,
    });
    await expect(service.resolveReconciliation(decision)).resolves.toMatchObject({
      status: 'NOT_SUBMITTED',
      revision: 2,
    });
    const events = await first!.aiProviderReconciliationEvent.findMany({ where: { jobId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: ownerUserId,
      workflowId: null,
      reconciliationRevision: 2,
      eventType: 'PROVIDER_RECONCILIATION_NOT_SUBMITTED',
    });
    await expect(first!.aiProviderReconciliationEvent.update({
      where: { id: events[0]!.id },
      data: { eventType: 'TAMPERED' },
    })).rejects.toThrow(/provider reconciliation events are immutable/iu);
  });

  it('records repeated terminal identity conflicts without mutating billed cancellation evidence', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `provider_anomaly_owner_${suffix}`;
    const jobId = `provider_anomaly_job_${suffix}`;
    const completedAt = new Date('2026-07-21T07:55:00.000Z');
    await first!.user.create({ data: {
      id: ownerUserId,
      phone: `provider_anomaly_${suffix}`,
      passwordHash: 'integration-test',
    } });
    await first!.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'CANCELLED',
      operation: 'IMAGE_TRANSLATE',
      provider: 'fake',
      model: 'fake-image-translation-v1',
      prompt: 'Terminal Provider identity anomaly integration',
      width: 1,
      height: 1,
      providerJobId: `provider-task-${suffix}`,
      billedUnits: 1,
      completedAt,
      providerReconciliationStatus: 'CANCELLED_OUTPUT_RETAINED',
      providerReconciliationRevision: 1,
      providerReconciledAt: new Date('2026-07-21T07:56:00.000Z'),
    } });
    const repository = new PrismaAiImageJobRepository(first!);
    const observedProviderJobId = `conflicting-task-${suffix}`;

    await expect(repository.recordProviderJobId(jobId, observedProviderJobId))
      .rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_MISMATCH' });
    await expect(repository.recordProviderJobId(jobId, observedProviderJobId))
      .rejects.toMatchObject({ code: 'PROVIDER_JOB_ID_MISMATCH' });

    const [job, events] = await Promise.all([
      first!.aiImageJob.findUniqueOrThrow({ where: { id: jobId } }),
      first!.aiProviderReconciliationEvent.findMany({ where: { jobId } }),
    ]);
    expect(job).toMatchObject({
      status: 'CANCELLED', billedUnits: 1, completedAt,
      providerJobId: `provider-task-${suffix}`,
      providerReconciliationStatus: 'CANCELLED_OUTPUT_RETAINED',
      providerReconciliationRevision: 1,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      reconciliationRevision: 1,
      eventType: 'PROVIDER_JOB_ID_MISMATCH_OBSERVED',
      payload: expect.objectContaining({
        persistedProviderJobId: `provider-task-${suffix}`,
        observedProviderJobId,
      }),
    });
  });
});
