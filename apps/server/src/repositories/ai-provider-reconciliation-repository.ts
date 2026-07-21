import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  appendAiCostSettlementInTransaction,
  type AiCostSettlementKind,
} from '../services/ai-cost-ledger.js';
import {
  type AiProviderReconciliationClaim,
  type AiProviderReconciliationRepository,
} from '../services/ai-provider-reconciliation.js';
import { aiMediaPayloadHash } from '../services/ai-media-workflows.js';
import { appendAiProviderReconciliationEvent } from '../services/ai-provider-reconciliation-events.js';

const ACTIVE_RECONCILIATION_STATUSES = ['PENDING', 'RETRY_WAIT'] as const;
const TERMINAL_COST_STATUSES = new Set(['SETTLED', 'RELEASED']);

export class AiProviderReconciliationRepositoryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiProviderReconciliationRepositoryError';
  }
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function bounded(value: unknown, maxLength: number, fallback = '') {
  const text = String(value || '').replace(/[\r\n\t]+/gu, ' ').trim();
  return (text || fallback).slice(0, maxLength);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function eventData(job: any, eventType: string, revision: number, payload: Record<string, unknown>) {
  const jobId = job.id || job.jobId;
  return {
    workflowId: job.workflowId,
    ownerUserId: job.ownerUserId,
    actorUserId: job.actorUserId || job.ownerUserId,
    jobId,
    eventKey: `${job.workflowId}:${eventType}:${jobId}:${revision}`,
    eventType,
    payload,
    payloadHash: aiMediaPayloadHash(payload),
  };
}

async function appendEvent(
  tx: any,
  job: any,
  eventType: string,
  revision: number,
  status: string,
  payload: Record<string, unknown>,
) {
  const jobId = job.id || job.jobId;
  await appendAiProviderReconciliationEvent(tx, {
    jobId,
    ownerUserId: job.ownerUserId,
    actorUserId: job.actorUserId || job.ownerUserId,
    workflowId: job.workflowId || null,
    reconciliationRevision: revision,
    eventType,
    status,
    payload,
  });
  if (!job.workflowId || !tx.aiMediaWorkflowEvent?.createMany) return;
  await tx.aiMediaWorkflowEvent.createMany({
    skipDuplicates: true,
    data: [eventData(job, eventType, revision, payload)],
  });
}

function assertCurrentAttempt(job: any) {
  if (job.workflowId && (
    !job.workflow
    || job.workflow.ownerUserId !== job.ownerUserId
    || Number(job.workflow.currentAttempt) !== Number(job.workflowAttempt)
  )) {
    throw new AiProviderReconciliationRepositoryError(
      'PROVIDER_RECONCILIATION_SUPERSEDED',
      'Provider task does not belong to the current workflow attempt',
    );
  }
}

function asClaim(job: any, leaseToken: string): AiProviderReconciliationClaim {
  if (!job.providerJobId || !validDate(job.providerReconciliationDeadlineAt)) {
    throw new AiProviderReconciliationRepositoryError(
      'PROVIDER_RECONCILIATION_INVALID',
      'Provider reconciliation identity or deadline is missing',
    );
  }
  return {
    jobId: job.id,
    workflowId: job.workflowId || null,
    ownerUserId: job.ownerUserId,
    actorUserId: job.actorUserId || job.ownerUserId,
    operation: job.operation,
    provider: job.provider,
    model: job.model,
    estimatedCostCents: Math.max(0, Number(job.estimatedCostCents || 0)),
    providerJobId: job.providerJobId,
    jobStatus: job.status,
    reconciliationStatus: 'RUNNING',
    reconciliationRevision: Number(job.providerReconciliationRevision || 0) + 1,
    reconciliationAttemptCount: Number(job.providerReconciliationAttemptCount || 0) + 1,
    deadlineAt: job.providerReconciliationDeadlineAt,
    leaseToken,
  };
}

function claimFence(claim: AiProviderReconciliationClaim) {
  return {
    id: claim.jobId,
    ownerUserId: claim.ownerUserId,
    providerJobId: claim.providerJobId,
    providerReconciliationStatus: 'RUNNING',
    providerReconciliationRevision: claim.reconciliationRevision,
    providerReconciliationLeaseTokenHash: tokenHash(claim.leaseToken),
  };
}

function releasedLeaseData() {
  return {
    providerReconciliationLeaseOwner: null,
    providerReconciliationLeaseTokenHash: null,
    providerReconciliationLeaseExpiresAt: null,
  };
}

function ensureLeaseMutation(changed: { count: number }) {
  if (changed.count !== 1) {
    throw new AiProviderReconciliationRepositoryError(
      'PROVIDER_RECONCILIATION_LEASE_LOST',
      'Provider reconciliation lease changed before the result was committed',
    );
  }
}

async function settleRecoveredCost(
  tx: any,
  job: any,
  actualCostCents: number,
  billedUnits: number,
  release: boolean,
) {
  const providerProjection = {
    actualCostCents: release ? 0 : actualCostCents,
    billedUnits: release ? 0 : billedUnits,
    reservationStatus: null as string | null,
    preservedTerminalDecision: false,
    differsFromProvider: false,
  };
  if (!tx.aiCostReservation?.findUnique) return providerProjection;
  const reservation = await tx.aiCostReservation.findUnique({
    where: { ai_cost_reservation_job_owner: { jobId: job.id, ownerUserId: job.ownerUserId } },
    include: { settlements: true },
  });
  if (!reservation) return providerProjection;
  const costProviderJobId = String(reservation.providerRequestId || '').trim();
  if (costProviderJobId && costProviderJobId !== String(job.providerJobId || '').trim()) {
    throw new AiProviderReconciliationRepositoryError(
      'PROVIDER_COST_TASK_ID_MISMATCH',
      'Cost reservation belongs to a different Provider task',
    );
  }
  if (TERMINAL_COST_STATUSES.has(reservation.status)) {
    const expectedKinds = reservation.status === 'SETTLED'
      ? new Set(['CHARGE', 'RECONCILED_CHARGE'])
      : new Set(['RELEASE', 'RECONCILED_RELEASE']);
    const terminalSettlements = Array.isArray(reservation.settlements)
      ? reservation.settlements.filter((settlement: any) => expectedKinds.has(settlement.kind))
      : [];
    if (terminalSettlements.length !== 1) {
      throw new AiProviderReconciliationRepositoryError(
        'PROVIDER_COST_TERMINAL_INVALID',
        'Terminal cost reservation has no unique matching settlement',
      );
    }
    const settlement = terminalSettlements[0]!;
    const terminalActualCostCents = reservation.status === 'RELEASED'
      ? 0
      : Number(settlement.actualCostMinor);
    const terminalBilledUnits = reservation.status === 'RELEASED'
      ? 0
      : Number(settlement.billedUnits);
    if (!Number.isSafeInteger(terminalActualCostCents)
      || terminalActualCostCents < 0
      || !Number.isSafeInteger(terminalBilledUnits)
      || terminalBilledUnits < 0
      || Number(job.actualCostCents) !== terminalActualCostCents
      || Number(job.billedUnits || 0) !== terminalBilledUnits) {
      throw new AiProviderReconciliationRepositoryError(
        'PROVIDER_COST_PROJECTION_MISMATCH',
        'Terminal cost reservation does not match the image job cost projection',
      );
    }
    return {
      actualCostCents: terminalActualCostCents,
      billedUnits: terminalBilledUnits,
      reservationStatus: String(reservation.status),
      preservedTerminalDecision: true,
      differsFromProvider: terminalActualCostCents !== providerProjection.actualCostCents
        || terminalBilledUnits !== providerProjection.billedUnits,
    };
  }
  const reconciled = ['SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(reservation.status);
  const kind: AiCostSettlementKind = release
    ? (reconciled ? 'RECONCILED_RELEASE' : 'RELEASE')
    : (reconciled ? 'RECONCILED_CHARGE' : 'CHARGE');
  const settled = await appendAiCostSettlementInTransaction(tx, {
    reservationId: reservation.id,
    ownerUserId: job.ownerUserId,
    actorUserId: job.actorUserId || reservation.actorUserId || job.ownerUserId,
    idempotencyKey: `${job.id}:cost:provider-reconciliation:${release ? 'release' : 'settle'}`,
    requestFingerprint: reservation.requestFingerprint,
    kind,
    actualCostMinor: release ? 0 : actualCostCents,
    billedUnits: release ? 0 : billedUnits,
    reason: release
      ? 'Provider reconciliation proved no billable output'
      : 'Provider reconciliation recovered the accepted task output',
    expectedReservationUpdatedAt: reservation.updatedAt,
  });
  return { ...providerProjection, reservationStatus: String(settled.reservation.status) };
}

function sourceSnapshotId(inputs: any[]) {
  if (!inputs.length) return null;
  const values = inputs.map((input) => String(input.asset?.sourceCaptureSnapshotId || '').trim());
  if (values.some((value) => !value) || new Set(values).size !== 1) return null;
  return values[0]!;
}

export class PrismaAiProviderReconciliationRepository implements AiProviderReconciliationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claimDue(input: { workerId: string; now: Date; limit: number; leaseMs: number }) {
    const client = this.prisma as any;
    const now = validDate(input.now) ? input.now : new Date();
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit)));
    const candidateLimit = Math.min(400, limit * 4);
    const expiredLeases = await client.aiImageJob.findMany({
      where: {
        providerReconciliationStatus: 'RUNNING',
        providerReconciliationLeaseExpiresAt: { lte: now },
      },
      select: { id: true },
      orderBy: [{ providerReconciliationLeaseExpiresAt: 'asc' }, { id: 'asc' }],
      take: candidateLimit,
    });
    const dueTasks = await client.aiImageJob.findMany({
      where: {
        providerReconciliationStatus: { in: [...ACTIVE_RECONCILIATION_STATUSES] },
        providerReconciliationNextAt: { lte: now },
      },
      select: { id: true },
      orderBy: [{ providerReconciliationNextAt: 'asc' }, { id: 'asc' }],
      take: candidateLimit,
    });
    const seen = new Set<string>();
    const candidates = [...expiredLeases, ...dueTasks].filter((candidate: { id: string }) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    });
    const claims: AiProviderReconciliationClaim[] = [];
    for (const candidate of candidates) {
      if (claims.length >= limit) break;
      const claimed = await runAiMediaSerializableTransaction(client, async (tx: any) => {
        const job = await tx.aiImageJob.findUnique({
          where: { id: candidate.id },
          include: { workflow: { select: { id: true, ownerUserId: true, currentAttempt: true } } },
        });
        if (!job || !['FAILED', 'CANCELLED'].includes(job.status)) return null;
        const status = String(job.providerReconciliationStatus || 'NOT_REQUIRED');
        const due = ACTIVE_RECONCILIATION_STATUSES.includes(status as any)
          && validDate(job.providerReconciliationNextAt)
          && job.providerReconciliationNextAt.getTime() <= now.getTime();
        const reclaim = status === 'RUNNING'
          && validDate(job.providerReconciliationLeaseExpiresAt)
          && job.providerReconciliationLeaseExpiresAt.getTime() <= now.getTime();
        if (!due && !reclaim) return null;
        try {
          assertCurrentAttempt(job);
        } catch (error) {
          const revision = Number(job.providerReconciliationRevision || 0) + 1;
          const changed = await tx.aiImageJob.updateMany({
            where: {
              id: job.id,
              ownerUserId: job.ownerUserId,
              providerJobId: job.providerJobId,
              providerReconciliationStatus: status,
              providerReconciliationRevision: job.providerReconciliationRevision,
            },
            data: {
              providerReconciliationStatus: 'MANUAL_REVIEW',
              providerReconciliationRevision: revision,
              providerReconciliationNextAt: null,
              ...releasedLeaseData(),
              providerReconciliationLastErrorCode: 'PROVIDER_RECONCILIATION_SUPERSEDED',
              providerReconciliationLastErrorMessage: bounded((error as Error).message, 500),
            },
          });
          if (changed.count !== 1) return null;
          await appendEvent(tx, job, 'PROVIDER_RECONCILIATION_MANUAL_REVIEW', revision, 'MANUAL_REVIEW', {
            errorCode: 'PROVIDER_RECONCILIATION_SUPERSEDED',
          });
          return null;
        }
        const leaseToken = randomUUID();
        const revision = Number(job.providerReconciliationRevision || 0) + 1;
        const attemptCount = Number(job.providerReconciliationAttemptCount || 0) + 1;
        const where: Record<string, unknown> = {
          id: job.id,
          providerReconciliationStatus: status,
          providerReconciliationRevision: job.providerReconciliationRevision,
        };
        if (reclaim) where.providerReconciliationLeaseExpiresAt = { lte: now };
        const changed = await tx.aiImageJob.updateMany({
          where,
          data: {
            providerReconciliationStatus: 'RUNNING',
            providerReconciliationRevision: revision,
            providerReconciliationAttemptCount: attemptCount,
            providerReconciliationNextAt: null,
            providerReconciliationLeaseOwner: bounded(input.workerId, 100, 'ai-provider-reconciliation'),
            providerReconciliationLeaseTokenHash: tokenHash(leaseToken),
            providerReconciliationLeaseExpiresAt: new Date(now.getTime() + Math.max(1_000, input.leaseMs)),
          },
        });
        if (changed.count !== 1) return null;
        await appendEvent(tx, job, 'PROVIDER_RECONCILIATION_CLAIMED', revision, 'RUNNING', {
          attemptCount,
          reclaimed: reclaim,
        });
        return asClaim(job, leaseToken);
      });
      if (claimed) claims.push(claimed);
    }
    return claims;
  }

  async defer(input: Parameters<AiProviderReconciliationRepository['defer']>[0]) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const changed = await tx.aiImageJob.updateMany({
        where: claimFence(input.claim),
        data: {
          providerReconciliationStatus: 'RETRY_WAIT',
          providerReconciliationRevision: input.claim.reconciliationRevision + 1,
          providerReconciliationNextAt: input.nextAttemptAt,
          ...releasedLeaseData(),
          providerReconciliationLastProviderStatus: input.providerStatus
            ? bounded(input.providerStatus, 100)
            : null,
          providerReconciliationLastErrorCode: input.errorCode ? bounded(input.errorCode, 100) : null,
          providerReconciliationLastErrorMessage: input.errorMessage
            ? bounded(input.errorMessage, 500)
            : null,
        },
      });
      ensureLeaseMutation(changed);
      await appendEvent(tx, input.claim, 'PROVIDER_RECONCILIATION_DEFERRED', input.claim.reconciliationRevision + 1, 'RETRY_WAIT', {
        providerStatus: input.providerStatus || null,
        errorCode: input.errorCode || null,
        nextAttemptAt: input.nextAttemptAt.toISOString(),
      });
    });
  }

  async markManualReview(input: Parameters<AiProviderReconciliationRepository['markManualReview']>[0]) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const changed = await tx.aiImageJob.updateMany({
        where: claimFence(input.claim),
        data: {
          providerReconciliationStatus: 'MANUAL_REVIEW',
          providerReconciliationRevision: input.claim.reconciliationRevision + 1,
          providerReconciliationNextAt: null,
          ...releasedLeaseData(),
          providerReconciliationLastProviderStatus: input.providerStatus
            ? bounded(input.providerStatus, 100)
            : null,
          providerReconciliationLastErrorCode: bounded(input.errorCode, 100),
          providerReconciliationLastErrorMessage: bounded(input.errorMessage, 500),
        },
      });
      ensureLeaseMutation(changed);
      await appendEvent(tx, input.claim, 'PROVIDER_RECONCILIATION_MANUAL_REVIEW', input.claim.reconciliationRevision + 1, 'MANUAL_REVIEW', {
        providerStatus: input.providerStatus || null,
        errorCode: bounded(input.errorCode, 100),
      });
    });
  }

  async completeNoOutput(input: Parameters<AiProviderReconciliationRepository['completeNoOutput']>[0]) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id: input.claim.jobId } });
      if (!job) ensureLeaseMutation({ count: 0 });
      if (input.billingDisposition === 'NO_CHARGE') {
        await settleRecoveredCost(tx, job, 0, 0, true);
      }
      const reconciledAt = new Date();
      const changed = await tx.aiImageJob.updateMany({
        where: claimFence(input.claim),
        data: {
          providerReconciliationStatus: 'NO_OUTPUT',
          providerReconciliationRevision: input.claim.reconciliationRevision + 1,
          providerReconciliationNextAt: null,
          ...releasedLeaseData(),
          providerReconciliationLastProviderStatus: bounded(input.providerStatus, 100),
          providerReconciliationLastErrorCode: bounded(input.errorCode, 100),
          providerReconciliationLastErrorMessage: bounded(input.errorMessage, 500),
          providerReconciledAt: reconciledAt,
        },
      });
      ensureLeaseMutation(changed);
      await appendEvent(tx, job, 'PROVIDER_RECONCILIATION_NO_OUTPUT', input.claim.reconciliationRevision + 1, 'NO_OUTPUT', {
        providerStatus: bounded(input.providerStatus, 100),
        errorCode: bounded(input.errorCode, 100),
        billingDisposition: input.billingDisposition,
      });
    });
  }

  async completeRecovered(input: Parameters<AiProviderReconciliationRepository['completeRecovered']>[0]) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({
        where: { id: input.claim.jobId },
        include: {
          workflow: {
            include: {
              inputs: {
                include: { asset: { select: { sourceCaptureSnapshotId: true } } },
                orderBy: [{ role: 'asc' }, { ordinal: 'asc' }],
              },
            },
          },
        },
      });
      if (!job
        || job.ownerUserId !== input.claim.ownerUserId
        || job.providerJobId !== input.claim.providerJobId
        || !['FAILED', 'CANCELLED'].includes(job.status)) {
        ensureLeaseMutation({ count: 0 });
      }
      assertCurrentAttempt(job);
      const inputs = job.workflow?.inputs || [];
      const snapshotId = sourceSnapshotId(inputs);
      if (job.workflowId && !snapshotId) {
        throw new AiProviderReconciliationRepositoryError(
          'INVALID_INPUT_OUTPUT_GRAPH',
          'Recovered Provider output requires one frozen source snapshot',
        );
      }
      const costProjection = await settleRecoveredCost(
        tx,
        job,
        input.actualCostCents,
        1,
        false,
      );
      const cancelled = job.status === 'CANCELLED';
      const outputKind = cancelled ? 'AI_PROVIDER_OUTPUT' : 'AI_GENERATED';
      const output = await tx.mediaAsset.create({
        data: {
          ownerUserId: input.asset.ownerUserId,
          aiImageJobId: input.asset.jobId,
          kind: outputKind,
          url: input.asset.url,
          storageBackend: input.asset.storageBackend,
          storageKey: input.asset.storageKey,
          mimeType: input.asset.mimeType,
          sizeBytes: input.asset.sizeBytes,
          width: input.asset.width ?? null,
          height: input.asset.height ?? null,
          sha256: input.asset.sha256,
          ...(snapshotId ? { sourceCaptureSnapshotId: snapshotId } : {}),
          metadata: {
            providerReconciliation: {
              providerJobId: input.claim.providerJobId,
              providerStatus: bounded(input.providerStatus, 100),
            },
          },
        },
      });
      for (const frozenInput of inputs) {
        await tx.mediaAssetLineage.create({
          data: {
            ownerUserId: job.ownerUserId,
            workflowId: job.workflowId,
            jobId: job.id,
            inputAssetId: frozenInput.assetId,
            outputAssetId: output.id,
            inputRole: frozenInput.role,
            ordinal: frozenInput.ordinal,
            operation: job.operation,
          },
        });
      }
      const reconciledAt = new Date();
      const terminalStatus = cancelled ? 'CANCELLED_OUTPUT_RETAINED' : 'RECOVERED';
      const changed = await tx.aiImageJob.updateMany({
        where: {
          ...claimFence(input.claim),
          status: job.status,
          workflowAttempt: job.workflowAttempt,
        },
        data: {
          ...(cancelled ? {} : {
            status: 'SUCCEEDED',
            progress: 100,
            errorCode: null,
            errorMessage: null,
            completedAt: reconciledAt,
          }),
          actualCostCents: costProjection.actualCostCents,
          billedUnits: costProjection.billedUnits,
          providerReconciliationStatus: terminalStatus,
          providerReconciliationRevision: input.claim.reconciliationRevision + 1,
          providerReconciliationNextAt: null,
          ...releasedLeaseData(),
          providerReconciliationLastProviderStatus: bounded(input.providerStatus, 100),
          providerReconciliationLastErrorCode: null,
          providerReconciliationLastErrorMessage: null,
          providerReconciledAt: reconciledAt,
        },
      });
      ensureLeaseMutation(changed);
      if (!cancelled && job.workflowId) {
        const workflowChanged = await tx.aiMediaWorkflow.updateMany({
          where: {
            id: job.workflowId,
            ownerUserId: job.ownerUserId,
            currentAttempt: job.workflowAttempt,
            status: 'FAILED',
          },
          data: {
            status: 'SUCCEEDED',
            reviewStatus: 'PENDING',
            selectedOutputAssetId: null,
            completedAt: reconciledAt,
            revision: { increment: 1 },
          },
        });
        if (workflowChanged.count !== 1) {
          throw new AiProviderReconciliationRepositoryError(
            'PROVIDER_RECONCILIATION_WORKFLOW_CHANGED',
            'Workflow changed before the recovered Provider output was committed',
          );
        }
      }
      await appendEvent(
        tx,
        job,
        cancelled ? 'PROVIDER_RECONCILIATION_CANCELLED_OUTPUT_RETAINED' : 'PROVIDER_RECONCILIATION_RECOVERED',
        input.claim.reconciliationRevision + 1,
        terminalStatus,
        {
          outputAssetId: output.id,
          providerStatus: bounded(input.providerStatus, 100),
          outputSha256: input.asset.sha256,
          cost: {
            reservationStatus: costProjection.reservationStatus,
            projectionSource: costProjection.preservedTerminalDecision
              ? 'TERMINAL_COST_DECISION'
              : 'PROVIDER_RESULT',
            actualCostCents: costProjection.actualCostCents,
            billedUnits: costProjection.billedUnits,
            providerActualCostCents: input.actualCostCents,
            providerBilledUnits: 1,
            differsFromProvider: costProjection.differsFromProvider,
          },
        },
      );
    });
  }
}
