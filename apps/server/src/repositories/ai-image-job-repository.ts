import type { PrismaClient } from '@prisma/client';
import type { AiImageAssetInput, AiImageJobRecord, AiImageJobRepository, ApplyAiImageJobInput, CreateAiImageJobInput, CreateWithQuotaResult } from '../services/ai-image-jobs.js';
import {
  markAiCostSubmissionUncertainInTransaction,
  markAiCostUnknownInTransaction,
  releaseAiCostInTransaction,
  settleAiCostInTransaction,
} from '../services/ai-cost-ledger.js';
import { aiMediaPayloadHash } from '../services/ai-media-workflows.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';

const record = (row: any): AiImageJobRecord => ({
  ...row,
  inputAssets: row.workflow?.inputs
    ? row.workflow.inputs.map((input: any) => ({
      assetId: input.assetId,
      role: input.role,
      ordinal: input.ordinal,
      url: input.assetUrl,
      mimeType: input.mimeType,
      sha256: input.assetSha256,
      sizeBytes: input.asset?.sizeBytes ?? null,
      width: input.width,
      height: input.height,
      storageBackend: input.asset?.storageBackend ?? null,
      storageKey: input.asset?.storageKey ?? null,
      kind: input.asset?.kind,
    }))
    : row.inputAssets,
  estimatedCostCents: Number(row.estimatedCostCents || 0),
  actualCostCents: row.actualCostCents == null ? null : Number(row.actualCostCents),
  billedUnits: Number(row.billedUnits || 0),
});

const INPUT_SOURCE_SNAPSHOT_OPERATIONS = new Set([
  'IMAGE_TO_IMAGE',
  'IMAGE_TRANSLATE',
  'FULL_EDIT',
  'INPAINT',
]);

function uniqueFrozenInputSnapshotId(inputs: Array<{ asset?: { sourceCaptureSnapshotId?: string | null } | null }>) {
  if (!inputs.length) return null;
  const snapshotIds = inputs.map((input) => String(input.asset?.sourceCaptureSnapshotId || '').trim());
  if (snapshotIds.some((id) => !id)) return null;
  const unique = new Set(snapshotIds);
  return unique.size === 1 ? snapshotIds[0]! : null;
}

async function appendWorkflowEvent(client: any, job: any, eventType: string, payload: Record<string, unknown> = {}) {
  if (!job?.workflowId) return;
  await client.aiMediaWorkflowEvent.create({ data: {
    workflowId: job.workflowId,
    ownerUserId: job.ownerUserId,
    actorUserId: job.actorUserId,
    jobId: job.id,
    eventKey: `${job.workflowId}:${eventType}:${job.id}:${job.attemptCount || 0}`,
    eventType,
    payload,
    payloadHash: aiMediaPayloadHash(payload),
  } });
}

async function bindProviderJobIdInTransaction(tx: any, job: any, providerJobId: string, providerAcceptedAt?: Date) {
  const normalized = String(providerJobId || '').trim();
  if (!normalized) return { job, mismatch: false } as const;
  if (normalized.length > 500) {
    throw Object.assign(new Error('Provider job ID exceeds the persistence contract'), {
      code: 'PROVIDER_JOB_ID_INVALID',
    });
  }
  if (job.providerJobId) {
    if (job.providerJobId !== normalized) {
      const failed = await quarantineProviderJobIdMismatchInTransaction(
        tx,
        job,
        normalized,
      );
      return { job: failed, mismatch: true } as const;
    }
    return { job, mismatch: false } as const;
  }
  const terminalReservation = ['FAILED', 'CANCELLED'].includes(job.status)
    ? await loadJobCostReservation(tx, job)
    : null;
  const hasUnresolvedProviderCost = ['SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED']
    .includes(terminalReservation?.status);
  const lateBindingCostAllowed = !terminalReservation || hasUnresolvedProviderCost;
  const dispatchStarted = ['FAILED', 'CANCELLED'].includes(job.status)
    ? await hasProviderDispatchStarted(tx, job)
    : false;
  const lateUncertain = job.status === 'FAILED'
    && job.errorCode === 'PROVIDER_SUBMISSION_UNCERTAIN'
    && lateBindingCostAllowed
    && dispatchStarted;
  const lateCancelled = job.status === 'CANCELLED'
    && lateBindingCostAllowed
    && dispatchStarted;
  const allowedStatuses = ['RUNNING', 'CANCEL_REQUESTED'];
  if (lateUncertain) allowedStatuses.push('FAILED');
  if (lateCancelled) allowedStatuses.push('CANCELLED');
  if (!allowedStatuses.includes(job.status)) {
    throw Object.assign(new Error('Provider job ID could not be persisted for the current job state'), {
      code: 'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT',
    });
  }
  const acceptedAt = providerAcceptedAt instanceof Date && !Number.isNaN(providerAcceptedAt.getTime())
    ? providerAcceptedAt
    : new Date();
  const updated = await tx.aiImageJob.updateMany({
    where: { id: job.id, status: { in: allowedStatuses }, providerJobId: null },
    data: {
      providerJobId: normalized,
      ...(!job.providerDispatchedAt && job.status === 'RUNNING'
        ? { providerDispatchedAt: acceptedAt }
        : {}),
    },
  });
  if (updated.count !== 1) {
    const current = await tx.aiImageJob.findUnique({ where: { id: job.id } });
    if (current?.providerJobId === normalized) return { job: current, mismatch: false } as const;
    if (current?.providerJobId) {
      const failed = await quarantineProviderJobIdMismatchInTransaction(
        tx,
        current,
        normalized,
      );
      return { job: failed, mismatch: true } as const;
    }
    throw Object.assign(new Error('Provider job ID could not be persisted'), {
      code: 'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT',
    });
  }
  const bound = {
    ...job,
    providerJobId: normalized,
    providerDispatchedAt: job.providerDispatchedAt || (job.status === 'RUNNING' ? acceptedAt : null),
  };
  await appendWorkflowEvent(tx, bound, 'PROVIDER_SUBMITTED', {
    providerJobId: normalized,
    providerAcceptedAt: acceptedAt.toISOString(),
  });
  return { job: bound, mismatch: false } as const;
}

async function loadJobCostReservation(tx: any, job: any) {
  if (!tx.aiCostReservation?.findUnique) return null;
  return tx.aiCostReservation.findUnique({
    where: { ai_cost_reservation_job_owner: { jobId: job.id, ownerUserId: job.ownerUserId } },
  });
}

async function loadProviderAcceptedAt(tx: any, job: any, explicit?: Date): Promise<Date> {
  if (job.workflowId && tx.aiMediaWorkflowEvent?.findUnique) {
    const event = await tx.aiMediaWorkflowEvent.findUnique({ where: {
      eventKey: `${job.workflowId}:PROVIDER_SUBMITTED:${job.id}:${job.attemptCount || 0}`,
    } });
    const recorded = typeof event?.payload?.providerAcceptedAt === 'string'
      ? new Date(event.payload.providerAcceptedAt)
      : null;
    if (recorded && !Number.isNaN(recorded.getTime())) return recorded;
    if (event?.createdAt instanceof Date) return event.createdAt;
  }
  if (explicit instanceof Date && !Number.isNaN(explicit.getTime())) return explicit;
  throw Object.assign(new Error('Provider acceptance timestamp is unavailable'), {
    code: 'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING',
  });
}

async function hasProviderDispatchStarted(tx: any, job: any): Promise<boolean> {
  if (job.providerDispatchedAt instanceof Date && !Number.isNaN(job.providerDispatchedAt.getTime())) {
    return true;
  }
  if (!job.workflowId || !tx.aiMediaWorkflowEvent?.findUnique) return false;
  const event = await tx.aiMediaWorkflowEvent.findUnique({ where: {
    eventKey: `${job.workflowId}:PROVIDER_DISPATCH_STARTED:${job.id}:${job.attemptCount || 0}`,
  } });
  return Boolean(event);
}

async function finalizeJobCost(
  tx: any,
  job: any,
  outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED',
  data?: {
    actualCostCents?: number;
    billedUnits?: number;
    providerAcceptedAt?: Date;
    actorUserId?: string;
    providerSubmissionRejected?: boolean;
    providerSubmissionUncertain?: boolean;
  },
) {
  const reservation = await loadJobCostReservation(tx, job);
  if (!reservation) return;
  const common = {
    reservationId: reservation.id,
    ownerUserId: job.ownerUserId,
    actorUserId: data?.actorUserId || job.actorUserId || reservation.actorUserId,
    requestFingerprint: reservation.requestFingerprint,
  };
  if (reservation.status === 'RELEASED' || reservation.status === 'SETTLED') return;
  if (outcome === 'COMPLETED') {
    await settleAiCostInTransaction(tx, {
      ...common,
      idempotencyKey: `${job.id}:cost:settle`,
      actualCostMinor: data?.actualCostCents ?? 0,
      billedUnits: data?.billedUnits ?? 0,
      reason: 'AI image job completed',
    });
    return;
  }
  if (job.providerJobId) {
    const providerAcceptedAt = await loadProviderAcceptedAt(tx, job, data?.providerAcceptedAt);
    await markAiCostUnknownInTransaction(tx, {
      ...common,
      idempotencyKey: `${job.id}:cost:unknown`,
      providerRequestId: job.providerJobId,
      providerAcceptedAt,
      billedUnits: 0,
      reason: `AI image job ${outcome.toLowerCase()} after provider acceptance`,
    });
    return;
  }
  if (reservation.status === 'SUBMISSION_UNCERTAIN') {
    await markAiCostSubmissionUncertainInTransaction(tx, {
      ...common,
      idempotencyKey: `${job.id}:cost:submission-uncertain`,
      billedUnits: 0,
      reason: `AI image job ${outcome.toLowerCase()} with an uncertain provider submission`,
    });
    return;
  }
  if (data?.providerSubmissionUncertain) {
    await markAiCostSubmissionUncertainInTransaction(tx, {
      ...common,
      idempotencyKey: `${job.id}:cost:submission-uncertain`,
      billedUnits: 0,
      reason: `AI image job ${outcome.toLowerCase()} after a paid result without a recoverable provider identity`,
    });
    return;
  }
  if (!data?.providerSubmissionRejected && await hasProviderDispatchStarted(tx, job)) {
    await markAiCostSubmissionUncertainInTransaction(tx, {
      ...common,
      idempotencyKey: `${job.id}:cost:submission-uncertain`,
      billedUnits: 0,
      reason: `AI image job ${outcome.toLowerCase()} with an uncertain provider submission`,
    });
    return;
  }
  await releaseAiCostInTransaction(tx, {
    ...common,
    idempotencyKey: `${job.id}:cost:release`,
    billedUnits: 0,
    reason: `AI image job ${outcome.toLowerCase()} before provider acceptance`,
  });
}

async function quarantineProviderJobIdMismatchInTransaction(
  tx: any,
  job: any,
  observedProviderJobId: string,
) {
  const persistedProviderJobId = String(job.providerJobId || '').trim();
  if (!persistedProviderJobId || persistedProviderJobId === observedProviderJobId) return job;
  const errorMessage = [
    'Provider job ID mismatch requires manual reconciliation.',
    `Persisted: ${JSON.stringify(persistedProviderJobId)}.`,
    `Observed: ${JSON.stringify(observedProviderJobId)}.`,
  ].join(' ');
  const changed = await tx.aiImageJob.updateMany({
    where: {
      id: job.id,
      status: { in: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED'] },
      providerJobId: persistedProviderJobId,
    },
    data: {
      status: 'FAILED',
      progress: 0,
      billedUnits: 0,
      errorCode: 'PROVIDER_JOB_ID_MISMATCH',
      errorMessage,
      completedAt: new Date(),
    },
  });
  const failed = changed.count === 1
    ? { ...job, status: 'FAILED', errorCode: 'PROVIDER_JOB_ID_MISMATCH', errorMessage }
    : await tx.aiImageJob.findUnique({ where: { id: job.id } }) || job;

  if (changed.count === 1) {
    try {
      await finalizeJobCost(tx, failed, 'FAILED');
    } catch (error) {
      if ((error as any)?.code !== 'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING') throw error;
      const reservation = await loadJobCostReservation(tx, failed);
      if (reservation && !['SETTLED', 'RELEASED'].includes(reservation.status)) {
        await markAiCostSubmissionUncertainInTransaction(tx, {
          reservationId: reservation.id,
          ownerUserId: failed.ownerUserId,
          actorUserId: failed.actorUserId || reservation.actorUserId,
          idempotencyKey: `${failed.id}:cost:submission-uncertain`,
          requestFingerprint: reservation.requestFingerprint,
          billedUnits: 0,
          reason: 'Conflicting provider identities require manual reconciliation',
        });
      }
    }
    if (failed.workflowId && tx.aiMediaWorkflow?.updateMany) {
      await tx.aiMediaWorkflow.updateMany({
        where: {
          id: failed.workflowId,
          ownerUserId: failed.ownerUserId,
          currentAttempt: failed.workflowAttempt,
          status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] },
        },
        data: {
          status: 'FAILED',
          reviewStatus: 'NOT_READY',
          completedAt: new Date(),
          revision: { increment: 1 },
        },
      });
    }
  }

  if (failed.workflowId && tx.aiMediaWorkflowEvent?.createMany) {
    const payload = { persistedProviderJobId, observedProviderJobId };
    const payloadHash = aiMediaPayloadHash(payload);
    await tx.aiMediaWorkflowEvent.createMany({
      skipDuplicates: true,
      data: [{
        workflowId: failed.workflowId,
        ownerUserId: failed.ownerUserId,
        actorUserId: failed.actorUserId,
        jobId: failed.id,
        eventKey: `${failed.workflowId}:PROVIDER_JOB_ID_MISMATCH:${failed.id}:${failed.attemptCount || 0}:${payloadHash.slice(0, 16)}`,
        eventType: 'PROVIDER_JOB_ID_MISMATCH',
        payload,
        payloadHash,
      }],
    });
  }
  return failed;
}

function providerJobIdMismatchError() {
  return Object.assign(new Error('Provider job ID does not match the persisted recovery identity'), {
    code: 'PROVIDER_JOB_ID_MISMATCH',
  });
}

async function quarantineSubmissionInTransaction(tx: any, job: any, data: any) {
  if (!['RUNNING', 'CANCEL_REQUESTED'].includes(job.status) || job.providerJobId) return false;
  const attemptCount = Number.isSafeInteger(data.attemptCount) ? data.attemptCount : job.attemptCount || 0;
  const changed = await tx.aiImageJob.updateMany({
    where: { id: job.id, status: { in: ['RUNNING', 'CANCEL_REQUESTED'] }, providerJobId: null },
    data: {
      status: 'FAILED',
      progress: 0,
      billedUnits: 0,
      attemptCount,
      errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
      errorMessage: 'Provider submission outcome requires manual reconciliation',
      completedAt: new Date(),
    },
  });
  if (changed.count !== 1) return false;
  const reservation = await loadJobCostReservation(tx, job);
  const cancellationActorUserId = job.status === 'CANCEL_REQUESTED'
    ? await loadCancellationActor(tx, job)
    : null;
  if (reservation) {
    await markAiCostSubmissionUncertainInTransaction(tx, {
      reservationId: reservation.id,
      ownerUserId: job.ownerUserId,
      actorUserId: cancellationActorUserId || job.actorUserId || reservation.actorUserId,
      idempotencyKey: `${job.id}:cost:submission-uncertain`,
      requestFingerprint: reservation.requestFingerprint,
      billedUnits: 0,
      reason: 'Provider submission outcome requires manual reconciliation',
    });
  }
  if (!job.workflowId) return true;
  const parent = await tx.aiMediaWorkflow.updateMany({
    where: {
      id: job.workflowId,
      ownerUserId: job.ownerUserId,
      currentAttempt: job.workflowAttempt,
      status: { in: ['RUNNING', 'CANCEL_REQUESTED'] },
    },
    data: {
      status: 'FAILED',
      reviewStatus: 'NOT_READY',
      completedAt: new Date(),
      revision: { increment: 1 },
    },
  });
  if (parent.count !== 1) throw new Error('AI media workflow submission quarantine CAS failed');
  const payload = { causeCode: data.errorCode, attemptCount };
  const eventKey = `${job.workflowId}:PROVIDER_SUBMISSION_UNCERTAIN:${job.id}:${attemptCount}`;
  await tx.aiMediaWorkflowEvent.createMany({
    skipDuplicates: true,
    data: [{
      workflowId: job.workflowId,
      ownerUserId: job.ownerUserId,
      actorUserId: job.actorUserId,
      jobId: job.id,
      eventKey,
      eventType: 'PROVIDER_SUBMISSION_UNCERTAIN',
      payload,
      payloadHash: aiMediaPayloadHash(payload),
    }],
  });
  return true;
}

async function failBeforeDispatchInTransaction(
  tx: any,
  job: any,
  data: any,
  allowedStatuses: string[],
) {
  if (!allowedStatuses.includes(job.status) || job.providerJobId) return false;
  const changed = await tx.aiImageJob.updateMany({
    where: { id: job.id, status: { in: allowedStatuses }, providerJobId: null },
    data: {
      status: 'FAILED',
      progress: 0,
      billedUnits: 0,
      attemptCount: data.attemptCount,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      completedAt: new Date(),
    },
  });
  if (changed.count !== 1) return false;
  await finalizeJobCost(tx, job, 'FAILED', { providerSubmissionRejected: true });
  if (!job.workflowId) return true;
  const parent = await tx.aiMediaWorkflow.updateMany({
    where: {
      id: job.workflowId,
      ownerUserId: job.ownerUserId,
      currentAttempt: job.workflowAttempt,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    data: {
      status: 'FAILED',
      reviewStatus: 'NOT_READY',
      completedAt: new Date(),
      revision: { increment: 1 },
    },
  });
  if (parent.count !== 1) throw new Error('AI media workflow pre-dispatch failure CAS failed');
  await appendWorkflowEvent(
    tx,
    { ...job, attemptCount: data.attemptCount },
    'JOB_FAILED',
    { errorCode: data.errorCode },
  );
  return true;
}

async function loadCancellationActor(tx: any, job: any): Promise<string | null> {
  if (!job.workflowId || !tx.aiMediaWorkflowEvent?.findFirst) return null;
  const event = await tx.aiMediaWorkflowEvent.findFirst({
    where: {
      workflowId: job.workflowId,
      jobId: job.id,
      eventType: 'CANCEL_REQUESTED',
    },
    orderBy: { createdAt: 'desc' },
    select: { actorUserId: true },
  });
  return typeof event?.actorUserId === 'string' && event.actorUserId ? event.actorUserId : null;
}

export class PrismaAiImageJobRepository implements AiImageJobRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async getById(id: string) {
    const row = await (this.prisma as any).aiImageJob.findUnique({
      where: { id },
      include: {
        assets: true,
        workflow: {
          include: {
            inputs: { include: { asset: true }, orderBy: { ordinal: 'asc' } },
            suiteSlot: { select: { suiteId: true, ownerUserId: true } },
          },
        },
      },
    });
    return row ? record(row) : null;
  }
  async createWithQuota(input: CreateAiImageJobInput, dailyLimit: number): Promise<CreateWithQuotaResult> {
    try {
      return await (this.prisma as any).$transaction(async (tx: any) => {
        if (input.idempotencyKey) {
          const existing = await tx.aiImageJob.findUnique({ where: { ai_image_job_owner_idempotency: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey } } });
          if (existing) return { kind: 'existing', job: record(existing) };
        }
        const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
        const reserved = await tx.aiImageJob.aggregate({ where: { ownerUserId: input.ownerUserId, createdAt: { gte: dayStart }, status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } }, _sum: { requestedImageCount: true } });
        const billed = await tx.aiImageJob.aggregate({ where: { ownerUserId: input.ownerUserId, createdAt: { gte: dayStart }, status: 'SUCCEEDED' }, _sum: { billedUnits: true } });
        const used = Number(reserved._sum.requestedImageCount || 0) + Number(billed._sum.billedUnits || 0);
        if (dailyLimit > 0 && used + input.count > dailyLimit) return { kind: 'quota-exceeded', used, limit: dailyLimit };
        const created = await tx.aiImageJob.create({ data: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          status: 'QUEUED',
          provider: input.provider,
          model: input.model,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt || null,
          resolvedPrompt: input.resolvedPrompt || null,
          resolvedNegativePrompt: input.resolvedNegativePrompt ?? null,
          templateKey: input.templateKey || null,
          templateReleaseId: input.templateReleaseId || null,
          templateChecksum: input.templateChecksum || null,
          templateSnapshot: input.templateSnapshot || undefined,
          requestFingerprint: input.requestFingerprint || null,
          requestedImageCount: input.count,
          width: input.width,
          height: input.height,
          idempotencyKey: input.idempotencyKey,
          estimatedCostCents: input.estimatedCostCents,
        } });
        return { kind: 'created', job: record(created) };
      }, { isolationLevel: 'Serializable' });
    } catch (error: any) {
      if (error?.code === 'P2002' && input.idempotencyKey) {
        const existing = await (this.prisma as any).aiImageJob.findUnique({ where: { ai_image_job_owner_idempotency: { ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey } } });
        if (existing) return { kind: 'existing', job: record(existing) };
      }
      throw error;
    }
  }
  async markRunning(id: string, attemptCount: number) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job || !['PENDING', 'QUEUED', 'RETRYING'].includes(job.status)) return false;
      if (job.workflowId) {
        const workflow = await tx.aiMediaWorkflow.findFirst({ where: {
          id: job.workflowId, ownerUserId: job.ownerUserId,
          currentAttempt: job.workflowAttempt, status: 'QUEUED',
        } });
        if (!workflow) return false;
      }
      const result = await tx.aiImageJob.updateMany({
        where: { id, status: { in: ['PENDING', 'QUEUED', 'RETRYING'] } },
        data: { status: 'RUNNING', attemptCount, progress: 10, startedAt: new Date(), errorCode: null, errorMessage: null },
      });
      if (result.count !== 1) return false;
      const started = { ...job, attemptCount };
      if (job.workflowId) {
        const parent = await tx.aiMediaWorkflow.updateMany({
          where: { id: job.workflowId, ownerUserId: job.ownerUserId, currentAttempt: job.workflowAttempt, status: 'QUEUED' },
          data: { status: 'RUNNING', revision: { increment: 1 } },
        });
        if (parent.count !== 1) throw new Error('AI media workflow start CAS failed');
        await appendWorkflowEvent(tx, started, 'JOB_STARTED', { attempt: job.workflowAttempt });
      }
      return true;
    });
  }
  async markRetrying(id: string, data: any) {
    const {
      providerJobId: _providerJobId,
      providerAcceptedAt: _providerAcceptedAt,
      providerSubmissionUncertain: _providerSubmissionUncertain,
      providerSubmissionRejected: _providerSubmissionRejected,
      ...failure
    } = data;
    await (this.prisma as any).aiImageJob.updateMany({
      where: { id, status: 'RUNNING' }, data: { status: 'RETRYING', progress: 0, ...failure },
    });
  }
  async markEnqueueFailed(id: string, data: any) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job) return false;
      return failBeforeDispatchInTransaction(tx, job, data, ['PENDING', 'QUEUED', 'RETRYING']);
    });
  }
  async markSubmissionUncertain(id: string, data: any) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (job) await quarantineSubmissionInTransaction(tx, job, data);
    });
  }
  async recoverInterruptedJob(id: string, data: any) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job || job.status !== 'RUNNING' || job.providerJobId) return null;
      if (await hasProviderDispatchStarted(tx, job)) {
        const quarantined = await quarantineSubmissionInTransaction(tx, job, data);
        return quarantined ? 'SUBMISSION_UNCERTAIN' as const : null;
      }
      const failed = await failBeforeDispatchInTransaction(tx, job, {
        ...data,
        errorCode: 'WORKER_INTERRUPTED_BEFORE_PROVIDER_DISPATCH',
        errorMessage: 'AI image worker stopped before provider dispatch',
      }, ['RUNNING']);
      return failed ? 'FAILED_PRE_DISPATCH' as const : null;
    });
  }
  async recordProviderDispatchStarted(id: string, providerDispatchedAt: Date) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job || job.status !== 'RUNNING' || job.providerJobId || job.providerDispatchedAt) return false;
      const dispatchedAt = providerDispatchedAt instanceof Date && !Number.isNaN(providerDispatchedAt.getTime())
        ? providerDispatchedAt
        : new Date();
      const changed = await tx.aiImageJob.updateMany({
        where: { id: job.id, status: 'RUNNING', providerJobId: null, providerDispatchedAt: null },
        data: { providerDispatchedAt: dispatchedAt },
      });
      if (changed.count !== 1) return false;
      if (!job.workflowId) return true;
      const payload = { providerDispatchedAt: dispatchedAt.toISOString() };
      const eventKey = `${job.workflowId}:PROVIDER_DISPATCH_STARTED:${job.id}:${job.attemptCount || 0}`;
      await tx.aiMediaWorkflowEvent.createMany({
        skipDuplicates: true,
        data: [{
          workflowId: job.workflowId,
          ownerUserId: job.ownerUserId,
          actorUserId: job.actorUserId,
          jobId: job.id,
          eventKey,
          eventType: 'PROVIDER_DISPATCH_STARTED',
          payload,
          payloadHash: aiMediaPayloadHash(payload),
        }],
      });
      return true;
    });
  }
  async recordProviderJobId(id: string, providerJobId: string, providerAcceptedAt?: Date) {
    const mismatch = await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job) return false;
      const binding = await bindProviderJobIdInTransaction(tx, job, providerJobId, providerAcceptedAt);
      if (binding.mismatch) return true;
      const bound = binding.job;
      if (job.status === 'FAILED') {
        await finalizeJobCost(tx, bound, 'FAILED', { providerAcceptedAt });
      } else if (job.status === 'CANCELLED') {
        await finalizeJobCost(tx, bound, 'CANCELLED', { providerAcceptedAt });
      }
      return false;
    });
    if (mismatch) throw providerJobIdMismatchError();
  }
  async markFailed(id: string, data: any) {
    const mismatch = await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const persisted = await tx.aiImageJob.findUnique({ where: { id } });
      if (!persisted) return false;
      const {
        providerJobId,
        providerAcceptedAt,
        providerSubmissionUncertain: _providerSubmissionUncertain,
        providerSubmissionRejected,
        ...failure
      } = data;
      const binding = providerJobId
        ? await bindProviderJobIdInTransaction(tx, persisted, providerJobId, providerAcceptedAt)
        : { job: persisted, mismatch: false } as const;
      if (binding.mismatch) return true;
      const job = binding.job;
      if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
        await this.markCancelledInTransaction(tx, job, providerAcceptedAt, providerSubmissionRejected);
        return false;
      }
      if (job.status === 'FAILED' && job.providerJobId) {
        await finalizeJobCost(tx, job, 'FAILED', { providerAcceptedAt });
        return false;
      }
      if (!job.providerJobId && !providerSubmissionRejected && await hasProviderDispatchStarted(tx, job)) {
        await quarantineSubmissionInTransaction(tx, job, data);
        return false;
      }
      const changed = await tx.aiImageJob.updateMany({
        where: { id, status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } },
        data: { status: 'FAILED', progress: 0, billedUnits: 0, completedAt: new Date(), ...failure },
      });
      if (changed.count !== 1) return false;
      await finalizeJobCost(tx, job, 'FAILED', { providerAcceptedAt, providerSubmissionRejected });
      if (!job.workflowId) return false;
      const parent = await tx.aiMediaWorkflow.updateMany({
        where: { id: job.workflowId, ownerUserId: job.ownerUserId, currentAttempt: job.workflowAttempt, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'FAILED', reviewStatus: 'NOT_READY', completedAt: new Date(), revision: { increment: 1 } },
      });
      if (parent.count !== 1) throw new Error('AI media workflow failure CAS failed');
      await appendWorkflowEvent(tx, { ...job, attemptCount: failure.attemptCount }, 'JOB_FAILED', { errorCode: failure.errorCode });
      return false;
    });
    if (mismatch) throw providerJobIdMismatchError();
  }
  async markCancelled(id: string, data?: { providerSubmissionUncertain?: boolean }) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (job) await this.markCancelledInTransaction(
        tx,
        job,
        undefined,
        false,
        data?.providerSubmissionUncertain,
      );
    });
  }
  async recordProviderOutput(id: string, asset: AiImageAssetInput) {
    if (
      asset.jobId !== id
      || asset.kind !== 'AI_PROVIDER_OUTPUT'
      || !asset.sha256
      || asset.storageBackend === 'ozon-cdn'
      || !asset.storageKey
    ) {
      throw Object.assign(new Error('Provider output asset does not satisfy the edit persistence contract'), {
        code: 'INVALID_PROVIDER_OUTPUT',
      });
    }
    const matchesPersistedOutput = (existing: any) => Boolean(
      existing
      && existing.aiImageJobId === id
      && existing.ownerUserId === asset.ownerUserId
      && existing.kind === 'AI_PROVIDER_OUTPUT'
      && existing.sha256 === asset.sha256
      && existing.url === asset.url
      && existing.storageBackend === asset.storageBackend
      && existing.storageKey === asset.storageKey
      && existing.mimeType === asset.mimeType
      && Number(existing.sizeBytes) === asset.sizeBytes
      && (existing.width ?? null) === (asset.width ?? null)
      && (existing.height ?? null) === (asset.height ?? null),
    );
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const job = await tx.aiImageJob.findUnique({ where: { id } });
        if (
          !job
          || job.ownerUserId !== asset.ownerUserId
          || !['FULL_EDIT', 'INPAINT'].includes(String(job.operation))
          || !['RUNNING', 'CANCEL_REQUESTED'].includes(String(job.status))
        ) {
          throw Object.assign(new Error('Provider output cannot be persisted for the current job'), {
            code: 'INVALID_STATE',
          });
        }
        const existing = await tx.mediaAsset.findFirst({
          where: { aiImageJobId: id, ownerUserId: asset.ownerUserId, kind: 'AI_PROVIDER_OUTPUT' },
        });
        if (existing) {
          if (!matchesPersistedOutput(existing)) {
            throw Object.assign(new Error('Provider output identity conflicts with the persisted attempt'), {
              code: 'PROVIDER_OUTPUT_CONFLICT',
            });
          }
          return { ...asset, ...existing };
        }
        const created = await tx.mediaAsset.create({ data: {
          ownerUserId: asset.ownerUserId,
          aiImageJobId: asset.jobId,
          kind: 'AI_PROVIDER_OUTPUT',
          url: asset.url,
          storageBackend: asset.storageBackend,
          storageKey: asset.storageKey,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width ?? null,
          height: asset.height ?? null,
          sha256: asset.sha256,
          metadata: asset.metadata || undefined,
        } });
        if (job.workflowId) {
          const inputs = await tx.aiMediaWorkflowInput.findMany({
            where: { workflowId: job.workflowId },
            orderBy: [{ role: 'asc' }, { ordinal: 'asc' }],
          });
          for (const input of inputs) {
            await tx.mediaAssetLineage.create({ data: {
              ownerUserId: job.ownerUserId,
              workflowId: job.workflowId,
              jobId: job.id,
              inputAssetId: input.assetId,
              outputAssetId: created.id,
              inputRole: input.role,
              ordinal: input.ordinal,
              operation: job.operation,
            } });
          }
          await appendWorkflowEvent(tx, job, 'PROVIDER_OUTPUT_PERSISTED', {
            outputAssetId: created.id,
            sha256: asset.sha256,
          });
        }
        return { ...asset, ...created };
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const winner = await (this.prisma as any).mediaAsset.findFirst({
        where: { aiImageJobId: id, ownerUserId: asset.ownerUserId, kind: 'AI_PROVIDER_OUTPUT' },
      });
      if (!matchesPersistedOutput(winner)) throw error;
      return { ...asset, ...winner };
    }
  }
  async complete(id: string, data: {
    providerJobId: string | null;
    providerResultReceivedWithoutIdentity?: boolean;
    actualCostCents: number;
    billedUnits: number;
    assets: AiImageAssetInput[];
  }) {
    if (data.assets.some((asset) => asset.kind && asset.kind !== 'AI_GENERATED')) {
      throw Object.assign(new Error('Job completion accepts only reviewable final assets'), {
        code: 'INVALID_FINAL_OUTPUT',
      });
    }
    const mismatch = await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const persisted = await tx.aiImageJob.findUnique({ where: { id } });
      if (!persisted) return false;
      const binding = data.providerJobId
        ? await bindProviderJobIdInTransaction(tx, persisted, data.providerJobId)
        : { job: persisted, mismatch: false } as const;
      if (binding.mismatch) return true;
      const job = binding.job;
      if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
        await this.markCancelledInTransaction(
          tx,
          job,
          undefined,
          false,
          data.providerResultReceivedWithoutIdentity,
        );
        return false;
      }
      if (job.status === 'FAILED' && job.providerJobId) {
        await finalizeJobCost(tx, job, 'FAILED');
        return false;
      }
      if (['FULL_EDIT', 'INPAINT'].includes(String(job.operation))) {
        const providerOutputCount = await tx.mediaAsset.count({
          where: { aiImageJobId: id, ownerUserId: job.ownerUserId, kind: 'AI_PROVIDER_OUTPUT' },
        });
        if (
          providerOutputCount !== 1
          || data.assets.length !== 1
          || data.assets[0]?.kind !== 'AI_GENERATED'
        ) {
          throw Object.assign(new Error('Edit completion requires one raw output and one final candidate'), {
            code: 'INVALID_EDIT_OUTPUT_GRAPH',
          });
        }
      }
      const providerJobId = job.providerJobId;
      const completed = await tx.aiImageJob.updateMany({
        where: { id, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', progress: 100, providerJobId, actualCostCents: data.actualCostCents, billedUnits: data.billedUnits, completedAt: new Date(), errorCode: null, errorMessage: null },
      });
      if (completed.count !== 1) return false;
      await finalizeJobCost(tx, job, 'COMPLETED', {
        actualCostCents: data.actualCostCents,
        billedUnits: data.billedUnits,
      });
      const inputs = job.workflowId
        ? await tx.aiMediaWorkflowInput.findMany({
          where: { workflowId: job.workflowId },
          orderBy: { ordinal: 'asc' },
          include: { asset: { select: { sourceCaptureSnapshotId: true } } },
        })
        : [];
      const inputSourceSnapshotId = uniqueFrozenInputSnapshotId(inputs);
      const operationRequiresInputSnapshot = Boolean(
        job.workflowId && INPUT_SOURCE_SNAPSHOT_OPERATIONS.has(String(job.operation)),
      );
      if (operationRequiresInputSnapshot && !inputSourceSnapshotId) {
        const isEdit = ['FULL_EDIT', 'INPAINT'].includes(String(job.operation));
        throw Object.assign(new Error(`${isEdit ? 'Edit' : 'Input-based'} completion requires one frozen source snapshot`), {
          code: isEdit ? 'INVALID_EDIT_OUTPUT_GRAPH' : 'INVALID_INPUT_OUTPUT_GRAPH',
        });
      }
      const outputs = [];
      for (const asset of data.assets) {
        outputs.push(await tx.mediaAsset.create({ data: {
          ownerUserId: asset.ownerUserId,
          aiImageJobId: asset.jobId,
          kind: asset.kind || 'AI_GENERATED',
          url: asset.url,
          storageBackend: asset.storageBackend,
          storageKey: asset.storageKey,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          width: asset.width ?? null,
          height: asset.height ?? null,
          sha256: asset.sha256,
          metadata: asset.metadata || undefined,
          ...(inputSourceSnapshotId ? { sourceCaptureSnapshotId: inputSourceSnapshotId } : {}),
        } }));
      }
      if (job.workflowId) {
        for (const output of outputs) {
          for (const input of inputs) {
            await tx.mediaAssetLineage.create({ data: {
              ownerUserId: job.ownerUserId, workflowId: job.workflowId, jobId: job.id,
              inputAssetId: input.assetId, outputAssetId: output.id, inputRole: input.role,
              ordinal: input.ordinal, operation: job.operation,
            } });
          }
        }
        const parent = await tx.aiMediaWorkflow.updateMany({
          where: { id: job.workflowId, ownerUserId: job.ownerUserId, currentAttempt: job.workflowAttempt, status: 'RUNNING' },
          data: { status: 'SUCCEEDED', reviewStatus: 'PENDING', completedAt: new Date(), revision: { increment: 1 } },
        });
        if (parent.count !== 1) throw new Error('AI media workflow completion CAS failed');
        await appendWorkflowEvent(tx, job, 'JOB_SUCCEEDED', { outputAssetIds: outputs.map((asset) => asset.id) });
      }
      return false;
    });
    if (mismatch) throw providerJobIdMismatchError();
  }
  async requestCancellation(id: string, ownerUserId: string) {
    const result = await (this.prisma as any).aiImageJob.updateMany({ where: { id, ownerUserId, status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } }, data: { status: 'CANCEL_REQUESTED' } });
    return result.count ? this.getById(id) : null;
  }
  async recordApplication(id: string, data: ApplyAiImageJobInput) {
    return record(await (this.prisma as any).aiImageJob.update({ where: { id }, data: { appliedMode: data.mode, applyTargetType: data.targetType, applyTargetId: data.targetId, appliedAt: new Date() }, include: { assets: true } }));
  }

  private async markCancelledInTransaction(
    tx: any,
    job: any,
    providerAcceptedAt?: Date,
    providerSubmissionRejected?: boolean,
    providerSubmissionUncertain?: boolean,
  ) {
    const submissionUncertain = !providerSubmissionRejected && Boolean(
      providerSubmissionUncertain
      || (!job.providerJobId && await hasProviderDispatchStarted(tx, job)),
    );
    if (job.status === 'CANCEL_REQUESTED') {
      const cancelled = await tx.aiImageJob.updateMany({
        where: { id: job.id, status: 'CANCEL_REQUESTED' },
        data: {
          status: 'CANCELLED',
          progress: 0,
          billedUnits: 0,
          completedAt: new Date(),
          ...(submissionUncertain ? {
            errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
            errorMessage: 'Provider submission outcome requires manual reconciliation',
          } : {}),
        },
      });
      if (cancelled.count !== 1) return;
    } else if (job.status !== 'CANCELLED') return;
    const cancellationActorUserId = await loadCancellationActor(tx, job);
    await finalizeJobCost(tx, job, 'CANCELLED', {
      providerAcceptedAt,
      providerSubmissionRejected,
      providerSubmissionUncertain: submissionUncertain,
      ...(cancellationActorUserId ? { actorUserId: cancellationActorUserId } : {}),
    });
    if (job.workflowId) {
      const parent = await tx.aiMediaWorkflow.updateMany({
        where: { id: job.workflowId, ownerUserId: job.ownerUserId, currentAttempt: job.workflowAttempt, status: { in: ['CANCEL_REQUESTED', 'CANCELLED'] } },
        data: { status: 'CANCELLED', completedAt: new Date(), revision: { increment: job.status === 'CANCEL_REQUESTED' ? 1 : 0 } },
      });
      if (parent.count === 1 && job.status === 'CANCEL_REQUESTED') {
        await appendWorkflowEvent(tx, job, 'CANCELLED');
      }
    }
  }
}
