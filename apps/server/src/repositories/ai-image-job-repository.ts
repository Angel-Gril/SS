import type { PrismaClient } from '@prisma/client';
import { assertAiImageEditRawAsset, matchesAiImageEditRaw, persistAiImageEditRawOutput } from './ai-image-edit-output.js';
import type { AiImageAssetInput, AiImageJobRecord, AiImageJobRepository, ApplyAiImageJobInput, CreateAiImageJobInput, CreateWithQuotaResult } from '../services/ai-image-jobs.js';
import {
  appendAiCostSettlementInTransaction,
  markAiCostSubmissionUncertainInTransaction,
  markAiCostUnknownInTransaction,
  releaseAiCostInTransaction,
  reserveAiCostInTransaction,
  settleAiCostInTransaction,
} from '../services/ai-cost-ledger.js';
import { aiMediaPayloadHash } from '../services/ai-media-workflows.js';
import { calculateAiImageTaskCost, getFrozenAiImageTaskPrice } from '../services/ai-image-task-cost.js';
import {
  aiProviderReconciliationEventData,
  appendAiProviderReconciliationEvent,
} from '../services/ai-provider-reconciliation-events.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import { hasWanxEditReconciliationContract } from '../services/ai-provider-reconciliation.js';
import {
  AI_IMAGE_BILLED_JOB_STATUSES,
  aiImageReservedQuotaWhere,
} from '../services/ai-image-quota.js';
import {
  AiGlobalCostBudgetError,
  lockGlobalAiCostBudgetInTransaction,
  reserveGlobalAiCostBudgetInTransaction,
} from '../services/ai-cost-budget.js';

const costReservationRecord = (reservation: any) => reservation == null
  ? reservation
  : {
    id: reservation.id,
    currency: reservation.currency,
    status: reservation.status,
    estimatedCostMinor: Number(reservation.estimatedCostMinor || 0),
    maximumCostMinor: Number(reservation.maximumCostMinor || 0),
    provider: reservation.provider,
    model: reservation.model,
    requestFingerprint: reservation.requestFingerprint,
  };

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
  ...(row.costReservation !== undefined
    ? { costReservation: costReservationRecord(row.costReservation) }
    : {}),
  estimatedCostCents: Number(row.estimatedCostCents || 0),
  actualCostCents: row.actualCostCents == null ? null : Number(row.actualCostCents),
  billedUnits: Number(row.billedUnits || 0),
});

const COST_RESERVATION_SELECT = {
  id: true,
  currency: true,
  status: true,
  estimatedCostMinor: true,
  maximumCostMinor: true,
  provider: true,
  model: true,
  requestFingerprint: true,
} as const;

function isPaidAiImageJob(input: CreateAiImageJobInput): boolean {
  return input.provider !== 'fake';
}

const INPUT_SOURCE_SNAPSHOT_OPERATIONS = new Set([
  'IMAGE_TO_IMAGE',
  'IMAGE_TRANSLATE',
  'FULL_EDIT',
  'INPAINT',
]);
const PROVIDER_RECONCILIATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PROVIDER_RECONCILIATION_MANUAL_ERRORS = new Set([
  'PROVIDER_JOB_ID_INVALID',
  'PROVIDER_JOB_ID_MISMATCH',
  'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT',
  'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
  'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING',
  'PROVIDER_TASK_NOT_FOUND',
  'INVALID_PROVIDER_RESULT',
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

async function appendProviderReconciliationTransition(
  client: any,
  job: any,
  eventType: string,
  data: Record<string, any>,
) {
  if (!data.providerReconciliationStatus || !data.providerReconciliationRevision) return;
  await appendAiProviderReconciliationEvent(client, {
    jobId: job.id,
    ownerUserId: job.ownerUserId,
    actorUserId: job.actorUserId || job.ownerUserId,
    workflowId: job.workflowId || null,
    reconciliationRevision: Number(data.providerReconciliationRevision),
    eventType,
    status: String(data.providerReconciliationStatus),
    payload: {
      providerJobId: job.providerJobId || null,
      errorCode: data.providerReconciliationLastErrorCode || null,
      errorMessage: data.providerReconciliationLastErrorMessage || null,
      ...(data.persistedProviderJobId
        ? { persistedProviderJobId: String(data.persistedProviderJobId) }
        : {}),
      ...(data.observedProviderJobId
        ? { observedProviderJobId: String(data.observedProviderJobId) }
        : {}),
    },
  });
}

async function appendProviderReconciliationIdentityAnomaly(
  client: any,
  job: any,
  persistedProviderJobId: string,
  observedProviderJobId: string,
) {
  if (!client.aiProviderReconciliationEvent?.createMany) return;
  const payload = { persistedProviderJobId, observedProviderJobId };
  const payloadHash = aiMediaPayloadHash(payload);
  await client.aiProviderReconciliationEvent.createMany({
    skipDuplicates: true,
    data: [aiProviderReconciliationEventData({
      jobId: job.id,
      ownerUserId: job.ownerUserId,
      actorUserId: job.actorUserId || job.ownerUserId,
      workflowId: job.workflowId || null,
      reconciliationRevision: Number(job.providerReconciliationRevision),
      eventType: 'PROVIDER_JOB_ID_MISMATCH_OBSERVED',
      status: String(job.providerReconciliationStatus),
      payload,
      eventDiscriminator: `PROVIDER_JOB_ID_MISMATCH_OBSERVED:${payloadHash}`,
    })],
  });
}

function lateProviderReconciliationBindingData(job: any, providerAcceptedAt: Date) {
  const editRecovery = hasWanxEditReconciliationContract(job);
  const eligibleState = (job.status === 'FAILED' && job.errorCode === 'PROVIDER_SUBMISSION_UNCERTAIN')
    || (editRecovery && job.status === 'CANCELLED');
  if (!eligibleState
    || (job.operation !== 'IMAGE_TRANSLATE' && !editRecovery)
    || !['NOT_REQUIRED', 'MANUAL_REVIEW'].includes(
      String(job.providerReconciliationStatus || 'NOT_REQUIRED'),
    )) return {};
  const now = new Date();
  return {
    providerReconciliationStatus: 'PENDING',
    providerReconciliationRevision: Number(job.providerReconciliationRevision || 0) + 1,
    providerReconciliationNextAt: now,
    providerReconciliationDeadlineAt: new Date(
      (editRecovery && job.providerDispatchedAt instanceof Date
        ? job.providerDispatchedAt : providerAcceptedAt).getTime() + PROVIDER_RECONCILIATION_MAX_AGE_MS,
    ),
    providerReconciliationLastErrorCode: null,
    providerReconciliationLastErrorMessage: null,
    providerReconciledAt: null,
  };
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
  const reconciliationBinding = lateProviderReconciliationBindingData(job, acceptedAt);
  const updated = await tx.aiImageJob.updateMany({
    where: { id: job.id, status: { in: allowedStatuses }, providerJobId: null },
    data: {
      providerJobId: normalized,
      ...reconciliationBinding,
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
    ...reconciliationBinding,
    providerDispatchedAt: job.providerDispatchedAt || (job.status === 'RUNNING' ? acceptedAt : null),
  };
  await appendWorkflowEvent(tx, bound, 'PROVIDER_SUBMITTED', {
    providerJobId: normalized,
    providerAcceptedAt: acceptedAt.toISOString(),
  });
  await appendProviderReconciliationTransition(
    tx,
    bound,
    'PROVIDER_RECONCILIATION_RESUMED',
    reconciliationBinding,
  );
  return { job: bound, mismatch: false } as const;
}

async function loadJobCostReservation(tx: any, job: any) {
  if (!tx.aiCostReservation?.findUnique) return null;
  return tx.aiCostReservation.findUnique({
    where: { ai_cost_reservation_job_owner: { jobId: job.id, ownerUserId: job.ownerUserId } },
  });
}

async function loadProviderAcceptedAt(tx: any, job: any, explicit?: Date, reservation?: any): Promise<Date> {
  // Once quarantined, the immutable task-bound ledger already owns this time.
  // A later queue attempt must not require a second acceptance event.
  if (reservation?.status === 'RECONCILIATION_REQUIRED'
    && reservation.providerRequestId === job.providerJobId
    && reservation.providerAcceptedAt instanceof Date
    && !Number.isNaN(reservation.providerAcceptedAt.getTime())) return reservation.providerAcceptedAt;
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

function providerReconciliationFailureData(
  job: any,
  failure: any,
  now = new Date(),
): Record<string, any> {
  if (String(job.providerReconciliationStatus || 'NOT_REQUIRED') !== 'NOT_REQUIRED') return {};
  const revision = Number(job.providerReconciliationRevision || 0) + 1;
  const providerJobId = String(job.providerJobId || '').trim();
  const errorCode = String(failure?.errorCode || '').trim().slice(0, 100) || null;
  const errorMessage = String(failure?.errorMessage || '').replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 500) || null;
  const common = {
    providerReconciliationRevision: revision,
    providerReconciliationLastErrorCode: errorCode,
    providerReconciliationLastErrorMessage: errorMessage,
  };
  if (!providerJobId) {
    if (errorCode !== 'PROVIDER_SUBMISSION_UNCERTAIN') return {};
    return {
      ...common,
      providerReconciliationStatus: 'MANUAL_REVIEW',
      providerReconciliationNextAt: null,
      providerReconciliationDeadlineAt: null,
    };
  }
  const editRecovery = hasWanxEditReconciliationContract(job);
  if (errorCode === 'PROVIDER_TASK_FAILED') {
    return {
      ...common,
      providerReconciliationStatus: 'NO_OUTPUT',
      providerReconciliationLastProviderStatus: 'FAILED',
      providerReconciliationNextAt: null,
      providerReconciliationDeadlineAt: null,
      providerReconciledAt: now,
    };
  }
  if ((job.operation !== 'IMAGE_TRANSLATE' && !editRecovery)
    || PROVIDER_RECONCILIATION_MANUAL_ERRORS.has(errorCode || '')) {
    return {
      ...common,
      providerReconciliationStatus: 'MANUAL_REVIEW',
      providerReconciliationNextAt: null,
      providerReconciliationDeadlineAt: null,
    };
  }
  const acceptedAt = job.providerDispatchedAt instanceof Date
    && !Number.isNaN(job.providerDispatchedAt.getTime())
    ? job.providerDispatchedAt
    : now;
  return {
    ...common,
    providerReconciliationStatus: 'PENDING',
    providerReconciliationNextAt: now,
    providerReconciliationDeadlineAt: new Date(acceptedAt.getTime() + PROVIDER_RECONCILIATION_MAX_AGE_MS),
  };
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
  const confirmedNoOutput = outcome !== 'COMPLETED' && String(job.providerJobId || '').trim()
    && job.errorCode === 'PROVIDER_TASK_FAILED' && job.providerReconciliationStatus === 'NO_OUTPUT';
  if (confirmedNoOutput && !['RELEASED', 'SETTLED'].includes(reservation?.status)) {
    if (reservation) {
      if (reservation.providerRequestId && reservation.providerRequestId !== job.providerJobId) throw providerJobIdMismatchError();
      await appendAiCostSettlementInTransaction(tx, {
        reservationId: reservation.id, ownerUserId: job.ownerUserId,
        actorUserId: data?.actorUserId || job.actorUserId || reservation.actorUserId,
        requestFingerprint: reservation.requestFingerprint, idempotencyKey: `${job.id}:cost:no-output`,
        kind: reservation.status === 'RESERVED' ? 'RELEASE' : 'RECONCILED_RELEASE',
        actualCostMinor: 0, billedUnits: 0,
        reason: 'Confirmed Provider task produced zero valid images; ERP task fee released',
      });
    }
    const projected = await tx.aiImageJob.updateMany({ where: {
      id: job.id, ownerUserId: job.ownerUserId, providerJobId: job.providerJobId,
      status: { in: ['FAILED', 'CANCELLED'] }, providerReconciliationStatus: 'NO_OUTPUT', errorCode: 'PROVIDER_TASK_FAILED',
    }, data: { actualCostCents: 0, billedUnits: 0 } });
    if (projected.count !== 1) throw new Error('AI image no-output fee projection CAS failed');
    return;
  }
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
    const providerAcceptedAt = await loadProviderAcceptedAt(tx, job, data?.providerAcceptedAt, reservation);
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
  const reconciliationStatus = String(job.providerReconciliationStatus || 'NOT_REQUIRED');
  const cancelled = job.status === 'CANCELLED';
  const reconciliationCanQuarantine = [
    'NOT_REQUIRED', 'PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW',
  ].includes(reconciliationStatus);
  const reconciliationFailure = reconciliationCanQuarantine
    ? {
      providerReconciliationStatus: 'MANUAL_REVIEW',
      providerReconciliationRevision: Number(job.providerReconciliationRevision || 0) + 1,
      providerReconciliationNextAt: null,
      providerReconciliationLeaseOwner: null,
      providerReconciliationLeaseTokenHash: null,
      providerReconciliationLeaseExpiresAt: null,
      providerReconciliationLastErrorCode: 'PROVIDER_JOB_ID_MISMATCH',
      providerReconciliationLastErrorMessage: errorMessage.slice(0, 500),
      providerReconciledAt: null,
    }
    : {};
  if (!reconciliationCanQuarantine) {
    await appendProviderReconciliationIdentityAnomaly(
      tx,
      job,
      persistedProviderJobId,
      observedProviderJobId,
    );
  }
  const changed = reconciliationCanQuarantine
    ? await tx.aiImageJob.updateMany({
      where: {
        id: job.id,
        status: { in: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'CANCELLED'] },
        providerJobId: persistedProviderJobId,
      },
      data: {
        status: cancelled ? 'CANCELLED' : 'FAILED',
        progress: 0,
        billedUnits: 0,
        errorCode: 'PROVIDER_JOB_ID_MISMATCH',
        errorMessage,
        ...(cancelled ? {} : { completedAt: new Date() }),
        ...reconciliationFailure,
      },
    })
    : { count: 0 };
  const failed = changed.count === 1
    ? {
      ...job,
      status: cancelled ? 'CANCELLED' : 'FAILED',
      billedUnits: 0,
      errorCode: 'PROVIDER_JOB_ID_MISMATCH',
      errorMessage,
      ...reconciliationFailure,
    }
    : await tx.aiImageJob.findUnique({ where: { id: job.id } }) || job;

  if (changed.count === 1) {
    await appendProviderReconciliationTransition(
      tx,
      failed,
      'PROVIDER_RECONCILIATION_MANUAL_REVIEW',
      {
        ...reconciliationFailure,
        persistedProviderJobId,
        observedProviderJobId,
      },
    );
    try {
      await finalizeJobCost(tx, failed, cancelled ? 'CANCELLED' : 'FAILED');
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
  const reconciliationFailure = providerReconciliationFailureData(job, {
    errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
    errorMessage: 'Provider submission outcome requires manual reconciliation',
  });
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
      ...reconciliationFailure,
    },
  });
  if (changed.count !== 1) return false;
  await appendProviderReconciliationTransition(
    tx,
    job,
    'PROVIDER_RECONCILIATION_MANUAL_REVIEW',
    reconciliationFailure,
  );
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
  async findByOwnerAndIdempotencyKey(ownerUserId: string, idempotencyKey: string) {
    const row = await (this.prisma as any).aiImageJob.findUnique({
      where: { ai_image_job_owner_idempotency: { ownerUserId, idempotencyKey } },
      include: { assets: true, costReservation: { select: COST_RESERVATION_SELECT } },
    });
    return row ? record(row) : null;
  }
  async getById(id: string) {
    const row = await (this.prisma as any).aiImageJob.findUnique({
      where: { id },
      include: {
        assets: true,
        costReservation: { select: COST_RESERVATION_SELECT },
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
  async createWithQuota(
    input: CreateAiImageJobInput,
    dailyLimit: number,
    globalDailyBudgetCents = 0,
  ): Promise<CreateWithQuotaResult> {
    const paid = isPaidAiImageJob(input);
    if (paid && (!Number.isSafeInteger(input.estimatedCostCents) || input.estimatedCostCents <= 0)) {
      return {
        kind: 'invalid-cost',
        reason: 'A verified positive task cost is required before paid AI image generation',
      };
    }
    if (paid && !/^[a-f0-9]{64}$/u.test(String(input.requestFingerprint || ''))) {
      return {
        kind: 'invalid-cost',
        reason: 'A frozen SHA-256 request fingerprint is required before paid AI image generation',
      };
    }
    if (paid && (!Number.isSafeInteger(globalDailyBudgetCents) || globalDailyBudgetCents < 0)) {
      return { kind: 'invalid-cost', reason: 'Global daily AI budget must be a non-negative integer' };
    }
    let currency: 'USD' | 'CNY' = 'USD';
    if (paid) {
      try { currency = getFrozenAiImageTaskPrice({ ...input, requestedImageCount: input.count }).currency; }
      catch (error) { return { kind: 'invalid-cost', reason: error instanceof Error ? error.message : 'The frozen task price is invalid' }; }
    }
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        if (paid) await lockGlobalAiCostBudgetInTransaction(tx);
        if (input.idempotencyKey) {
          const existing = await tx.aiImageJob.findUnique({
            where: { ai_image_job_owner_idempotency: {
              ownerUserId: input.ownerUserId,
              idempotencyKey: input.idempotencyKey,
            } },
            include: { costReservation: { select: COST_RESERVATION_SELECT } },
          });
          if (existing) return { kind: 'existing', job: record(existing) };
        }
        const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
        const reserved = await tx.aiImageJob.aggregate({
          where: {
            ownerUserId: input.ownerUserId,
            createdAt: { gte: dayStart },
            ...aiImageReservedQuotaWhere(),
          },
          _sum: { requestedImageCount: true },
        });
        const billed = await tx.aiImageJob.aggregate({
          where: {
            ownerUserId: input.ownerUserId,
            createdAt: { gte: dayStart },
            status: { in: [...AI_IMAGE_BILLED_JOB_STATUSES] },
            billedUnits: { gt: 0 },
          },
          _sum: { billedUnits: true },
        });
        const used = Number(reserved._sum.requestedImageCount || 0) + Number(billed._sum.billedUnits || 0);
        if (dailyLimit > 0 && used + input.count > dailyLimit) return { kind: 'quota-exceeded', used, limit: dailyLimit };
        if (paid) {
          try {
            const exposure = await reserveGlobalAiCostBudgetInTransaction(tx, {
              limit: globalDailyBudgetCents,
              requestedMaximumCostMinor: input.estimatedCostCents,
              currency,
            }, { alreadyLocked: true });
            void exposure;
          } catch (error) {
            if (error instanceof AiGlobalCostBudgetError && error.code === 'BUDGET_EXCEEDED') {
              const summary = error.summary!;
              return {
                kind: 'budget-exceeded',
                settledCostCents: summary.settledCostMinor,
                pendingMaximumCostCents: summary.pendingMaximumCostMinor,
                requestedMaximumCostCents: summary.requestedMaximumCostMinor,
                limit: summary.limit,
              };
            }
            if (error instanceof AiGlobalCostBudgetError) {
              return { kind: 'invalid-cost', reason: error.message };
            }
            throw error;
          }
        }
        const created = await tx.aiImageJob.create({ data: {
          executionMode: 'ERP_HOSTED',
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
          operationConfig: input.operationConfig || undefined,
          requestedImageCount: input.count,
          width: input.width,
          height: input.height,
          idempotencyKey: input.idempotencyKey,
          estimatedCostCents: input.estimatedCostCents,
        } });
        if (!paid) return { kind: 'created', job: record(created) };
        const reservedCost = await reserveAiCostInTransaction(tx, {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          jobId: created.id,
          idempotencyKey: `${created.id}:cost:reserve`,
          requestFingerprint: input.requestFingerprint!,
          provider: input.provider,
          model: input.model,
          operation: 'TEXT_TO_IMAGE',
          currency,
          estimatedCostMinor: input.estimatedCostCents,
          maximumCostMinor: input.estimatedCostCents,
        });
        return {
          kind: 'created',
          job: record({ ...created, costReservation: reservedCost.reservation }),
        };
      });
    } catch (error: any) {
      if (error?.code === 'P2002' && input.idempotencyKey) {
        const existing = await (this.prisma as any).aiImageJob.findUnique({
          where: { ai_image_job_owner_idempotency: {
            ownerUserId: input.ownerUserId,
            idempotencyKey: input.idempotencyKey,
          } },
          include: { costReservation: { select: COST_RESERVATION_SELECT } },
        });
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
      const reconciliationFailure = providerReconciliationFailureData(job, failure);
      const previousCost = reconciliationFailure.providerReconciliationStatus === 'NO_OUTPUT'
        ? await loadJobCostReservation(tx, job) : null;
      const preserveTerminalCost = ['SETTLED', 'RELEASED'].includes(previousCost?.status);
      const changed = await tx.aiImageJob.updateMany({
        where: { id, status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } },
        data: {
          status: 'FAILED',
          progress: 0,
          billedUnits: preserveTerminalCost ? job.billedUnits : 0,
          completedAt: new Date(),
          ...failure,
          ...reconciliationFailure,
        },
      });
      if (changed.count !== 1) return false;
      await appendProviderReconciliationTransition(
        tx,
        job,
        reconciliationFailure.providerReconciliationStatus === 'NO_OUTPUT'
          ? 'PROVIDER_RECONCILIATION_NO_OUTPUT'
          : reconciliationFailure.providerReconciliationStatus === 'PENDING'
            ? 'PROVIDER_RECONCILIATION_QUEUED'
            : 'PROVIDER_RECONCILIATION_MANUAL_REVIEW',
        reconciliationFailure,
      );
      await finalizeJobCost(tx, { ...job, errorCode: failure.errorCode, errorMessage: failure.errorMessage,
        ...reconciliationFailure, status: 'FAILED' }, 'FAILED', {
        providerAcceptedAt, providerSubmissionRejected,
      });
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
    assertAiImageEditRawAsset(id, asset);
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const job = await tx.aiImageJob.findUnique({ where: { id } });
        if (
          !job
          || job.ownerUserId !== asset.ownerUserId
          || !(['FULL_EDIT', 'INPAINT'].includes(String(job.operation))
            || (job.provider === 'custom' && job.model === 'gpt-image-2-count'
              && ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'].includes(String(job.operation))))
          || !['RUNNING', 'CANCEL_REQUESTED'].includes(String(job.status))
        ) {
          throw Object.assign(new Error('Provider output cannot be persisted for the current job'), {
            code: 'INVALID_STATE',
          });
        }
        const { output, created } = await persistAiImageEditRawOutput(tx, job, asset);
        if (created && job.workflowId) {
          await appendWorkflowEvent(tx, job, 'PROVIDER_OUTPUT_PERSISTED', {
            outputAssetId: output.id,
            sha256: asset.sha256,
          });
        }
        return output;
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const winner = await (this.prisma as any).mediaAsset.findFirst({
        where: { aiImageJobId: id, ownerUserId: asset.ownerUserId, kind: 'AI_PROVIDER_OUTPUT' },
      });
      if (!matchesAiImageEditRaw(winner, id, asset)) throw error;
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
      if (typeof tx.$queryRawUnsafe === 'function') {
        const locked = await tx.$queryRawUnsafe(
          'SELECT "id" FROM "ai_image_jobs" WHERE "id" = $1 FOR UPDATE',
          id,
        ) as Array<{ id: string }>;
        if (!locked[0]) return false;
      }
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
      if (job.status !== 'RUNNING') return false;
      const countOrdinary = job.provider === 'custom' && job.model === 'gpt-image-2-count'
        && ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'].includes(String(job.operation));
      if (['FULL_EDIT', 'INPAINT'].includes(String(job.operation)) || countOrdinary) {
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
        if (countOrdinary) {
          const raw = await tx.mediaAsset.findFirst({
            where: { aiImageJobId: id, ownerUserId: job.ownerUserId, kind: 'AI_PROVIDER_OUTPUT' },
          });
          const final = data.assets[0];
          if (!raw || final?.metadata?.rawProviderOutputAssetId !== raw.id
            || final.width !== job.width || final.height !== job.height
            || final.metadata.normalizerVersion !== 'gpt2-count-ordinary-output-normalizer/v1') {
            throw Object.assign(new Error('Count completion requires the exact original output and normalized canvas'), {
              code: 'INVALID_EDIT_OUTPUT_GRAPH',
            });
          }
        }
      }
      const providerJobId = job.providerJobId;
      if (!data.assets.length) {
        throw Object.assign(new Error('A successful image job requires an effective output'), { code: 'EMPTY_RESULT' });
      }
      const reservation = await loadJobCostReservation(tx, job);
      const taskCost = calculateAiImageTaskCost({ ...job, costReservation: reservation }, data.assets.length);
      await finalizeJobCost(tx, job, 'COMPLETED', {
        actualCostCents: taskCost.actualCostCents,
        billedUnits: taskCost.billedUnits,
      });
      const completed = await tx.aiImageJob.updateMany({
        where: { id, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', progress: 100, providerJobId, actualCostCents: taskCost.actualCostCents, billedUnits: taskCost.billedUnits, completedAt: new Date(), errorCode: null, errorMessage: null },
      });
      if (completed.count !== 1) return false;
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
      const reconciliationFailure = providerReconciliationFailureData(job, {
        errorCode: submissionUncertain
          ? 'PROVIDER_SUBMISSION_UNCERTAIN'
          : job.providerJobId
            ? 'PROVIDER_RECOVERY_REQUIRED'
            : null,
        errorMessage: submissionUncertain
          ? 'Provider submission outcome requires manual reconciliation'
          : job.providerJobId
            ? 'Cancelled Provider task result requires reconciliation'
            : null,
      });
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
          ...reconciliationFailure,
        },
      });
      if (cancelled.count !== 1) return;
      await appendProviderReconciliationTransition(
        tx,
        job,
        reconciliationFailure.providerReconciliationStatus === 'PENDING'
          ? 'PROVIDER_RECONCILIATION_QUEUED'
          : 'PROVIDER_RECONCILIATION_MANUAL_REVIEW',
        reconciliationFailure,
      );
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
