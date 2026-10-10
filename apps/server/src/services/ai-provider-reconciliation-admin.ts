import { createHash } from 'node:crypto';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  appendAiCostSettlementInTransaction,
  markAiCostUnknownInTransaction,
} from './ai-cost-ledger.js';
import {
  aiProviderReconciliationEventData,
  aiProviderReconciliationEventKey,
} from './ai-provider-reconciliation-events.js';
import { aiImageSuiteRecoveryAuthorization } from './ai-image-suite-recovery.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import { aiImageProviderEndpointSha256, parseAiImageProviderRuntimeContract } from './ai-image-provider-runtime-contract.js';
import { AI_IMAGE_DONOR_GPT2_COUNT_API_BASE, validDonorGpt2SuiteConfig } from './ai-image-donor-gpt2-profile.js';
import { countUncertainAbandonmentEvidence, isUncertainCountSuite } from './ai-image-count-uncertain-abandonment.js';

const UNRESOLVED_STATUSES = ['PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'] as const;
const LIST_STATUSES = ['ALL', ...UNRESOLVED_STATUSES] as const;
const MAX_RECONCILIATION_AGE_MS = 24 * 60 * 60 * 1000;
const HISTORICAL_ABANDONMENT_AGE_MS = MAX_RECONCILIATION_AGE_MS;

export type AiProviderReconciliationListStatus = typeof LIST_STATUSES[number];

export interface ListAiProviderReconciliationsInput {
  limit?: number;
  status?: AiProviderReconciliationListStatus;
  cursor?: string;
}

export class AiProviderReconciliationAdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
    this.name = 'AiProviderReconciliationAdminError';
  }
}

function required(value: unknown, field: string, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) {
    throw new AiProviderReconciliationAdminError('INVALID_REQUEST', `${field} is invalid`, 400);
  }
  return text;
}

function sha256(value: unknown, field: string) {
  const text = required(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new AiProviderReconciliationAdminError('INVALID_REQUEST', `${field} is invalid`, 400);
  }
  return text;
}

function iso(value: unknown): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function validDate(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    throw new AiProviderReconciliationAdminError('INVALID_REQUEST', `${field} is invalid`, 400);
  }
  return date;
}

function listStatus(value: unknown): AiProviderReconciliationListStatus {
  const status = String(value || 'MANUAL_REVIEW') as AiProviderReconciliationListStatus;
  if (!LIST_STATUSES.includes(status)) {
    throw new AiProviderReconciliationAdminError('INVALID_REQUEST', 'status is invalid', 400);
  }
  return status;
}

function encodeListCursor(status: AiProviderReconciliationListStatus, id: string) {
  return Buffer.from(JSON.stringify({ v: 1, s: status, i: id }), 'utf8').toString('base64url');
}

function decodeListCursor(status: AiProviderReconciliationListStatus, value: unknown) {
  try {
    const cursor = String(value || '');
    if (!cursor || cursor.length > 1_000 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const bytes = Buffer.from(cursor, 'base64url');
    if (!bytes.length || bytes.toString('base64url') !== cursor) throw new Error();
    const serialized = bytes.toString('utf8');
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    if (!payload || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'i,s,v'
      || payload.v !== 1
      || payload.s !== status
      || typeof payload.i !== 'string'
      || !payload.i
      || payload.i.length > 300
      || serialized !== JSON.stringify({ v: 1, s: payload.s, i: payload.i })) {
      throw new Error();
    }
    return { id: payload.i };
  } catch {
    throw new AiProviderReconciliationAdminError(
      'INVALID_REQUEST',
      'cursor is invalid for this reconciliation queue',
      400,
    );
  }
}

function evidenceHash(job: any) {
  return createHash('sha256').update(JSON.stringify({
    id: job.id,
    ownerUserId: job.ownerUserId,
    workflowId: job.workflowId || null,
    workflowAttempt: job.workflowAttempt ?? null,
    jobStatus: job.status,
    provider: job.provider,
    model: job.model,
    providerJobId: job.providerJobId || null,
    costProviderJobId: job.costReservation?.providerRequestId || null,
    providerDispatchedAt: iso(job.providerDispatchedAt),
    reconciliation: {
      status: job.providerReconciliationStatus,
      revision: Number(job.providerReconciliationRevision || 0),
      attemptCount: Number(job.providerReconciliationAttemptCount || 0),
      nextAt: iso(job.providerReconciliationNextAt),
      deadlineAt: iso(job.providerReconciliationDeadlineAt),
      lastProviderStatus: job.providerReconciliationLastProviderStatus || null,
      lastErrorCode: job.providerReconciliationLastErrorCode || null,
      lastErrorMessage: job.providerReconciliationLastErrorMessage || null,
      reconciledAt: iso(job.providerReconciledAt),
    },
    cost: job.costReservation ? {
      status: job.costReservation.status,
      providerRequestId: job.costReservation.providerRequestId || null,
      providerAcceptedAt: iso(job.costReservation.providerAcceptedAt),
      updatedAt: iso(job.costReservation.updatedAt),
    } : null,
    updatedAt: iso(job.updatedAt),
    ...(isRejectedCountSuite(job) || isUncertainCountSuite(job) ? { abandonmentEvidence: {
      workflow: job.workflow, assets: job.assets, operationConfig: job.operationConfig,
      attemptCount: job.attemptCount, maxAttempts: job.maxAttempts, requestedImageCount: job.requestedImageCount,
      actualCostCents: job.actualCostCents, billedUnits: job.billedUnits,
      requestFingerprint: job.requestFingerprint, reservation: job.costReservation,
    } } : {}),
  })).digest('hex');
}

function publicRecord(job: any, now = new Date()) {
  return {
    id: job.id,
    ownerUserId: job.ownerUserId,
    workflowId: job.workflowId || null,
    operation: job.operation,
    provider: job.provider,
    model: job.model,
    jobStatus: job.status,
    providerJobId: job.providerJobId || null,
    costProviderJobId: job.costReservation?.providerRequestId || null,
    providerDispatchedAt: iso(job.providerDispatchedAt),
    providerAcceptedAt: iso(job.costReservation?.providerAcceptedAt),
    status: job.providerReconciliationStatus,
    revision: Number(job.providerReconciliationRevision || 0),
    attemptCount: Number(job.providerReconciliationAttemptCount || 0),
    nextAt: iso(job.providerReconciliationNextAt),
    deadlineAt: iso(job.providerReconciliationDeadlineAt),
    lastProviderStatus: job.providerReconciliationLastProviderStatus || null,
    lastErrorCode: job.providerReconciliationLastErrorCode || null,
    lastErrorMessage: job.providerReconciliationLastErrorMessage || null,
    reconciledAt: iso(job.providerReconciledAt),
    updatedAt: iso(job.updatedAt),
    costStatus: job.costReservation?.status || null,
    context: job.workflow ? {
      type: job.workflow.contextType || null,
      id: job.workflow.contextId || null,
      skuKey: job.workflow.contextSkuKey || null,
      slotKey: job.workflow.contextSlotKey || null,
    } : null,
    allowedActions: allowedActions(job, now),
    evidenceHash: evidenceHash(job),
  };
}

function include() {
  return {
    workflow: {
      select: {
        id: true,
        ownerUserId: true,
        currentAttempt: true,
        contextType: true,
        contextId: true,
        contextSkuKey: true,
        contextSlotKey: true,
        operation: true,
        status: true,
        reviewStatus: true,
        selectedOutputAssetId: true,
        events: { where: { eventType: { in: ['PROVIDER_SUBMITTED', 'PROVIDER_DISPATCH_STARTED'] } }, orderBy: { createdAt: 'desc' }, take: 4 },
        suiteSlot: {
          include: { suite: true },
        },
      },
    },
    assets: { select: { id: true, kind: true } },
    costReservation: {
      include: { settlements: { orderBy: { createdAt: 'desc' }, take: 10 } },
    },
  };
}

function isCurrentAttempt(job: any) {
  return Boolean(job.workflowId && job.workflow
    && job.workflow.ownerUserId === job.ownerUserId
    && Number(job.workflow.currentAttempt) === Number(job.workflowAttempt));
}

function historicalAbandonmentEligible(job: any, now: Date): boolean {
  const providerId = String(job.providerJobId || '').trim();
  const costProviderId = String(job.costReservation?.providerRequestId || '').trim();
  const dispatchedAt = job.providerDispatchedAt instanceof Date ? job.providerDispatchedAt : null;
  const reservation = job.costReservation;
  const terminalSettlements = Array.isArray(reservation?.settlements)
    ? reservation.settlements.filter((row: any) => ['CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE'].includes(row.kind))
    : [];
  const zeroUnits = job.actualCostCents === null && job.billedUnits === 0;
  const unresolvedCost = reservation?.status === 'RECONCILIATION_REQUIRED' && zeroUnits && terminalSettlements.length === 0;
  const releasedCost = reservation?.status === 'RELEASED' && zeroUnits && terminalSettlements.length === 1
    && ['RELEASE', 'RECONCILED_RELEASE'].includes(terminalSettlements[0].kind)
    && terminalSettlements[0].actualCostMinor === 0 && terminalSettlements[0].billedUnits === 0;
  const settledCost = reservation?.status === 'SETTLED' && terminalSettlements.length === 1
    && ['CHARGE', 'RECONCILED_CHARGE'].includes(terminalSettlements[0].kind)
    && job.billedUnits === 1 && Number.isSafeInteger(job.actualCostCents) && job.actualCostCents > 0
    && terminalSettlements[0].actualCostMinor === job.actualCostCents && terminalSettlements[0].billedUnits === 1;
  return job.status === 'FAILED'
    && job.operation === 'IMAGE_TO_IMAGE'
    && job.provider === 'dashscope-wanx'
    && job.model === 'wanx2.1-imageedit'
    && job.errorCode === 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'
    && isCurrentAttempt(job)
    && Boolean(job.workflow?.suiteSlot?.id)
    && job.workflow?.suiteSlot?.suite?.status === 'FAILED'
    && Array.isArray(job.assets) && job.assets.length === 0
    && Boolean(providerId) && providerId === costProviderId
    && (unresolvedCost || releasedCost || settledCost)
    && dispatchedAt !== null
    && now.getTime() - dispatchedAt.getTime() >= HISTORICAL_ABANDONMENT_AGE_MS;
}

function isRejectedCountSuite(job: any): boolean {
  return job.operation === 'IMAGE_TO_IMAGE' && job.provider === 'custom' && job.model === 'gpt-image-2-count'
    && ['INVALID_PROVIDER_RESULT', 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'].includes(job.errorCode)
    && Boolean(job.workflow?.suiteSlot);
}

/** A known synchronous result was rejected before ingest; no Provider lookup can recover it.
 * This only ends ERP recovery. An unsettled reservation is released; an already settled charge
 * is preserved. It makes no claim about Supplier output absence or Supplier billing, and preserves
 * the original failure. */
function countAbandonmentEvidence(job: any, now: Date) {
  if (!isRejectedCountSuite(job)) return null;
  const workflow = job.workflow, slot = workflow.suiteSlot, suite = slot.suite, cost = job.costReservation;
  const submitted = cost?.status === 'SETTLED' && Array.isArray(workflow.events)
    ? workflow.events.find((event: any) => event.eventKey === `${workflow.id}:PROVIDER_SUBMITTED:${job.id}:${job.workflowAttempt}`
      && event.eventType === 'PROVIDER_SUBMITTED' && event.workflowId === workflow.id && event.jobId === job.id
      && event.ownerUserId === job.ownerUserId && event.actorUserId === job.actorUserId
      && event.payload?.providerJobId === job.providerJobId
      && typeof event.payload.providerAcceptedAt === 'string'
      && Object.keys(event.payload).sort().join(',') === 'providerAcceptedAt,providerJobId'
      && hashAiMediaPlanningJson(event.payload) === event.payloadHash) : null;
  const acceptedAt = cost?.status === 'SETTLED' && submitted
    ? new Date(submitted.payload.providerAcceptedAt) : cost?.providerAcceptedAt, dispatchedAt = job.providerDispatchedAt;
  const terminalSettlements = Array.isArray(cost?.settlements)
    ? cost.settlements.filter((row: any) => ['CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE'].includes(row.kind)) : [];
  if (!(acceptedAt instanceof Date) || !(dispatchedAt instanceof Date)
    || !Number.isFinite(acceptedAt.getTime()) || !Number.isFinite(dispatchedAt.getTime())
    || (submitted && acceptedAt.toISOString() !== submitted.payload.providerAcceptedAt)
    || acceptedAt.getTime() > now.getTime() || dispatchedAt.getTime() > now.getTime()
    || job.status !== 'FAILED' || !isCurrentAttempt(job) || workflow.id !== job.workflowId
    || workflow.operation !== job.operation || workflow.status !== 'FAILED' || workflow.reviewStatus !== 'NOT_READY'
    || workflow.selectedOutputAssetId !== null || slot.childWorkflowId !== job.workflowId
    || slot.ownerUserId !== job.ownerUserId || slot.attempt !== job.workflowAttempt || slot.status !== 'FAILED'
    || !suite || suite.ownerUserId !== job.ownerUserId || !['FAILED', 'PARTIAL_FAILURE'].includes(suite.status)
    || suite.cancelRequestedAt || suite.provider !== job.provider || suite.model !== job.model
    || job.attemptCount !== 1 || job.maxAttempts !== 1 || job.requestedImageCount !== 1
    || job.width !== 900 || job.height !== 1200
    || (cost?.status === 'RECONCILIATION_REQUIRED'
      ? (job.actualCostCents !== null || job.billedUnits !== 0)
      : (job.actualCostCents !== 10 || job.billedUnits !== 1))
    || job.estimatedCostCents !== 10 || slot.estimatedCostCents !== 10 || slot.maximumCostCents !== 10
    || !Number.isSafeInteger(suite.itemCount) || suite.itemCount < 1 || suite.itemCount > 2
    || suite.maximumCostCents !== suite.itemCount * 10
    || !Array.isArray(job.assets) || job.assets.length !== 0
    || !cost || !['RECONCILIATION_REQUIRED', 'SETTLED'].includes(cost.status) || cost.ownerUserId !== job.ownerUserId
    || cost.jobId !== job.id || cost.workflowId !== job.workflowId || cost.actorUserId !== job.actorUserId
    || cost.operation !== job.operation || cost.provider !== job.provider || cost.model !== job.model
    || cost.currency !== 'CNY' || cost.estimatedCostMinor !== 10 || cost.maximumCostMinor !== 10
    || !/^[a-f0-9]{64}$/u.test(job.requestFingerprint || '') || cost.requestFingerprint !== job.requestFingerprint
    || !String(job.providerJobId || '').trim()
    || (cost.status === 'SETTLED'
      ? !submitted || (cost.providerRequestId !== null && cost.providerRequestId !== job.providerJobId)
        || (cost.providerAcceptedAt !== null && iso(cost.providerAcceptedAt) !== iso(acceptedAt))
      : cost.providerRequestId !== job.providerJobId)
    || !Array.isArray(cost.settlements)
    || (cost.status === 'RECONCILIATION_REQUIRED'
      ? cost.settlements.some((row: any) => ['CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE'].includes(row.kind))
      : terminalSettlements.length !== 1 || terminalSettlements[0]?.kind !== 'CHARGE'
        || terminalSettlements[0]?.actualCostMinor !== 10 || terminalSettlements[0]?.billedUnits !== 1)) return null;
  try {
    const config = job.operationConfig;
    const runtime = parseAiImageProviderRuntimeContract(config?.providerRuntime);
    if (config?.version !== 'ai-image-suite-child-operation/v2' || !validDonorGpt2SuiteConfig(config)
      || runtime.contractVersion !== 'ai-image-provider-runtime/v3' || runtime.provider !== job.provider || runtime.model !== job.model
      || runtime.baseUrlSha256 !== aiImageProviderEndpointSha256('custom', AI_IMAGE_DONOR_GPT2_COUNT_API_BASE)
      || runtime.currency !== 'CNY' || runtime.imageCount !== 1
      || runtime.unitCostCents !== 10 || runtime.maximumCostCents !== 10 || runtime.width !== 1008 || runtime.height !== 1344) return null;
  } catch { return null; }
  return { version: 'ai-image-count-undelivered-abandonment/v1', suiteId: suite.id, slotId: slot.id,
    jobId: job.id, reservationId: cost.id, attempt: job.workflowAttempt, requestFingerprint: job.requestFingerprint,
    providerJobId: job.providerJobId, providerAcceptedAt: acceptedAt.toISOString(), providerDispatchedAt: dispatchedAt.toISOString(),
    originalErrorCode: job.errorCode, originalErrorMessage: job.errorMessage || '',
    providerOutputDisposition: 'REJECTED_UNRECOVERABLE', providerBillingDisposition: 'UNKNOWN', erpDeliveredImageCount: 0,
    ...(cost.status === 'SETTLED' ? { erpCostDisposition: 'SETTLED_CHARGE_RETAINED' } : {}) };
}

function allowedActions(job: any, now = new Date()): Array<'NOT_SUBMITTED' | 'NO_OUTPUT' | 'RESUME' | 'ABANDON'> {
  if (job.providerReconciliationStatus !== 'MANUAL_REVIEW') return [];
  if (isUncertainCountSuite(job)) return countUncertainAbandonmentEvidence(job, now) ? ['ABANDON'] : [];
  // A known rejected synchronous response cannot honestly become NO_OUTPUT or RESUME.
  if (isRejectedCountSuite(job)) return countAbandonmentEvidence(job, now) ? ['ABANDON'] : [];
  const jobProviderId = String(job.providerJobId || '').trim();
  const costProviderId = String(job.costReservation?.providerRequestId || '').trim();
  const identitiesConflict = Boolean(
    jobProviderId && costProviderId && jobProviderId !== costProviderId,
  );
  const resumeAllowed = (!job.workflowId || isCurrentAttempt(job)) && !identitiesConflict
    && (!job.workflow?.suiteSlot || aiImageSuiteRecoveryAuthorization(job, now) !== null);
  const base: Array<'NOT_SUBMITTED' | 'NO_OUTPUT' | 'RESUME' | 'ABANDON'> = jobProviderId
    ? (resumeAllowed ? ['RESUME', 'NO_OUTPUT'] : ['NO_OUTPUT'])
    : (costProviderId || job.costReservation?.providerAcceptedAt
      ? (resumeAllowed && costProviderId ? ['RESUME'] : [])
      : (resumeAllowed ? ['RESUME', 'NOT_SUBMITTED'] : ['NOT_SUBMITTED']));
  if (historicalAbandonmentEligible(job, now)) base.push('ABANDON');
  return base;
}

function assertCurrentAttempt(job: any) {
  if (job.workflowId && !isCurrentAttempt(job)) {
    throw new AiProviderReconciliationAdminError(
      'RECONCILIATION_CHANGED',
      'Provider reconciliation is not the current workflow attempt',
      409,
    );
  }
}

export interface ResolveAiProviderReconciliationInput {
  jobId: string;
  actorUserId: string;
  requestId: string;
  expectedStatus: 'MANUAL_REVIEW';
  expectedRevision: number;
  expectedEvidenceHash: string;
  action: 'NOT_SUBMITTED' | 'NO_OUTPUT' | 'RESUME' | 'ABANDON';
  providerJobId?: string;
  providerAcceptedAt?: Date | string;
  reason: string;
}

export function createAiProviderReconciliationAdminService(input: {
  database: any;
  now?: () => Date;
}) {
  const database = input.database;
  const now = input.now || (() => new Date());
  return {
    async listReconciliations(query: ListAiProviderReconciliationsInput = {}) {
      const limit = Number(query.limit ?? 50);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new AiProviderReconciliationAdminError('INVALID_REQUEST', 'limit is invalid', 400);
      }
      const status = listStatus(query.status);
      const cursor = query.cursor ? decodeListCursor(status, query.cursor) : null;
      const rows = await database.aiImageJob.findMany({
        where: {
          providerReconciliationStatus: status === 'ALL'
            ? { in: [...UNRESOLVED_STATUSES] }
            : status,
          ...(cursor ? { id: { gt: cursor.id } } : {}),
        },
        orderBy: { id: 'asc' },
        take: limit + 1,
        include: include(),
      });
      const pageRows = rows.slice(0, limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map((job: any) => publicRecord(job, now())),
        limit,
        status,
        nextCursor: rows.length > limit && last ? encodeListCursor(status, last.id) : null,
      };
    },

    async resolveReconciliation(raw: ResolveAiProviderReconciliationInput) {
      const jobId = required(raw.jobId, 'jobId', 300);
      const actorUserId = required(raw.actorUserId, 'actorUserId', 300);
      const requestId = required(raw.requestId, 'requestId', 100);
      const expectedEvidenceHash = sha256(raw.expectedEvidenceHash, 'expectedEvidenceHash');
      if (raw.expectedStatus !== 'MANUAL_REVIEW'
        || !Number.isSafeInteger(raw.expectedRevision)
        || raw.expectedRevision < 0
        || !['NOT_SUBMITTED', 'NO_OUTPUT', 'RESUME', 'ABANDON'].includes(raw.action)) {
        throw new AiProviderReconciliationAdminError('INVALID_REQUEST', 'resolution state is invalid', 400);
      }
      const reason = required(raw.reason, 'reason').replace(/\s+/gu, ' ');
      if (reason.length < 10) {
        throw new AiProviderReconciliationAdminError('INVALID_REQUEST', 'reason is too short', 400);
      }

      try {
        return await runAiMediaSerializableTransaction(database, async (tx: any) => {
          const job = await tx.aiImageJob.findUnique({ where: { id: jobId }, include: include() });
          if (!job) {
            throw new AiProviderReconciliationAdminError('NOT_FOUND', 'Provider reconciliation was not found', 404);
          }
          const eventKey = aiProviderReconciliationEventKey(
            job.id,
            `PROVIDER_RECONCILIATION_MANUAL:${requestId}`,
          );
          const existing = await tx.aiProviderReconciliationEvent.findUnique({ where: { eventKey } });
          const requestedProviderJobId = raw.action === 'RESUME'
            ? required(
              raw.providerJobId || job.providerJobId || job.costReservation?.providerRequestId,
              'providerJobId',
            )
            : job.providerJobId || null;
          const acceptedAt = raw.action === 'RESUME'
            ? validDate(raw.providerAcceptedAt || job.providerDispatchedAt, 'providerAcceptedAt')
            : null;
          const replayPayload = {
            expectedStatus: raw.expectedStatus,
            expectedRevision: raw.expectedRevision,
            expectedEvidenceHash,
            action: raw.action,
            reason,
            providerJobId: requestedProviderJobId,
            providerAcceptedAt: acceptedAt?.toISOString() || null,
            ...(raw.action === 'RESUME' && job.workflow?.suiteSlot
              ? existing
                ? (Object.prototype.hasOwnProperty.call(existing.payload, 'suiteRecovery')
                  ? { suiteRecovery: existing.payload.suiteRecovery } : {})
                : { suiteRecovery: aiImageSuiteRecoveryAuthorization(job, now()) }
              : {}),
            ...(raw.action === 'ABANDON' && (isRejectedCountSuite(job) || isUncertainCountSuite(job))
              ? { abandonment: existing?.payload?.abandonment || countAbandonmentEvidence(job, now())
                || countUncertainAbandonmentEvidence(job, now()) } : {}),
          };
          const nextRevision = Number(job.providerReconciliationRevision) + 1;
          const nextStatus = raw.action === 'RESUME'
            ? 'PENDING'
            : raw.action === 'ABANDON' ? 'CANCELLED_OUTPUT_RETAINED' : raw.action;
          const reconciliationEvent = aiProviderReconciliationEventData({
            jobId: job.id,
            ownerUserId: job.ownerUserId,
            actorUserId,
            workflowId: job.workflowId || null,
            reconciliationRevision: nextRevision,
            eventType: `PROVIDER_RECONCILIATION_${raw.action}`,
            status: nextStatus,
            payload: replayPayload,
            eventDiscriminator: `PROVIDER_RECONCILIATION_MANUAL:${requestId}`,
          });
          if (existing) {
            const exactReplay = existing.actorUserId === actorUserId
              && existing.jobId === job.id
              && Number(existing.reconciliationRevision) === raw.expectedRevision + 1
              && hashAiMediaPlanningJson(existing.payload) === hashAiMediaPlanningJson(reconciliationEvent.payload);
            if (!exactReplay) {
              throw new AiProviderReconciliationAdminError(
                'IDEMPOTENCY_KEY_CONFLICT',
                'Provider reconciliation request was reused for another decision',
                409,
              );
            }
            return publicRecord(job, now());
          }
          if (job.providerReconciliationStatus !== raw.expectedStatus
            || Number(job.providerReconciliationRevision) !== raw.expectedRevision
            || evidenceHash(job) !== expectedEvidenceHash) {
            throw new AiProviderReconciliationAdminError(
              'RECONCILIATION_CHANGED',
              'Provider reconciliation changed before the decision',
              409,
            );
          }
          if (!allowedActions(job, now()).includes(raw.action)) {
            throw new AiProviderReconciliationAdminError(
              'RECONCILIATION_CHANGED',
              'Provider reconciliation action is no longer allowed',
              409,
            );
          }
          if (raw.action === 'RESUME') assertCurrentAttempt(job);
          if (raw.action === 'ABANDON' && !historicalAbandonmentEligible(job, now()) && !countAbandonmentEvidence(job, now())
            && !countUncertainAbandonmentEvidence(job, now())) {
            throw new AiProviderReconciliationAdminError(
              'INVALID_REQUEST',
              'Only an eligible failed suite child with no ERP output may be abandoned',
              400,
            );
          }
          if (raw.action === 'NOT_SUBMITTED' && (
            job.providerJobId
            || job.costReservation?.providerRequestId
            || job.costReservation?.providerAcceptedAt
          )) {
            throw new AiProviderReconciliationAdminError(
              'INVALID_REQUEST',
              'A persisted Provider task cannot be marked not submitted',
              400,
            );
          }
          if (raw.action === 'NO_OUTPUT' && !job.providerJobId) {
            throw new AiProviderReconciliationAdminError(
              'INVALID_REQUEST',
              'No-output resolution requires a Provider task identity',
              400,
            );
          }
          if (raw.action === 'RESUME' && job.providerJobId && job.providerJobId !== requestedProviderJobId) {
            throw new AiProviderReconciliationAdminError(
              'INVALID_REQUEST',
              'The persisted Provider task identity cannot be replaced',
              400,
            );
          }
          if (raw.action === 'RESUME'
            && job.costReservation?.providerRequestId
            && job.costReservation.providerRequestId !== requestedProviderJobId) {
            throw new AiProviderReconciliationAdminError(
              'INVALID_REQUEST',
              'The cost ledger Provider task identity cannot be replaced',
              400,
            );
          }

          const timestamp = now();
          if (acceptedAt && acceptedAt.getTime() > timestamp.getTime() + 5 * 60 * 1000) {
            throw new AiProviderReconciliationAdminError(
              'INVALID_REQUEST',
              'providerAcceptedAt cannot be in the future',
              400,
            );
          }
          if (acceptedAt && job.costReservation?.providerAcceptedAt instanceof Date
            && acceptedAt.getTime() !== job.costReservation.providerAcceptedAt.getTime()) {
            throw new AiProviderReconciliationAdminError(
              'INVALID_REQUEST',
              'Provider acceptance time does not match the persisted evidence',
              400,
            );
          }
          const data = raw.action === 'RESUME' ? {
            providerJobId: requestedProviderJobId,
            providerReconciliationStatus: 'PENDING',
            providerReconciliationRevision: nextRevision,
            providerReconciliationNextAt: timestamp,
            providerReconciliationDeadlineAt: job.workflow?.suiteSlot
              ? new Date(aiImageSuiteRecoveryAuthorization(job, timestamp)!.deadlineAt)
              : new Date(timestamp.getTime() + MAX_RECONCILIATION_AGE_MS),
            providerReconciliationLastErrorCode: null,
            providerReconciliationLastErrorMessage: null,
            providerReconciledAt: null,
          } : {
            providerReconciliationStatus: raw.action === 'ABANDON'
              ? 'CANCELLED_OUTPUT_RETAINED' : raw.action,
            providerReconciliationRevision: nextRevision,
            providerReconciliationNextAt: null,
            providerReconciliationDeadlineAt: null,
            providerReconciliationLastErrorCode: raw.action === 'ABANDON'
              ? 'OPERATOR_ABANDONED_NO_RECOVERY' : `OPERATOR_${raw.action}`,
            providerReconciliationLastErrorMessage: reason,
            providerReconciledAt: timestamp,
            // Unpaid failed suite children retain the graph's null/zero cost
            // projection. An existing settled charge is never rewritten.
            ...(raw.action === 'ABANDON' && job.costReservation?.status === 'RECONCILIATION_REQUIRED'
              ? { actualCostCents: null, billedUnits: 0 } : {}),
          };
          const changed = await tx.aiImageJob.updateMany({
            where: {
              id: job.id,
              ownerUserId: job.ownerUserId,
              providerJobId: job.providerJobId,
              providerReconciliationStatus: raw.expectedStatus,
              providerReconciliationRevision: raw.expectedRevision,
            },
            data,
          });
          if (changed.count !== 1) {
            throw new AiProviderReconciliationAdminError(
              'RECONCILIATION_CHANGED',
              'Provider reconciliation changed before the decision',
              409,
            );
          }

          const reservation = job.costReservation;
          if ((raw.action === 'NOT_SUBMITTED' || raw.action === 'ABANDON') && reservation
            && !['SETTLED', 'RELEASED'].includes(reservation.status)) {
            await appendAiCostSettlementInTransaction(tx, {
              reservationId: reservation.id,
              ownerUserId: job.ownerUserId,
              actorUserId,
              idempotencyKey: `admin-provider-reconcile:${requestId}:cost`,
              requestFingerprint: reservation.requestFingerprint,
              kind: reservation.status === 'RESERVED' ? 'RELEASE' : 'RECONCILED_RELEASE',
              actualCostMinor: 0,
              billedUnits: 0,
              reason,
              expectedReservationUpdatedAt: reservation.updatedAt,
            });
          }
          if (raw.action === 'RESUME' && reservation
            && ['RESERVED', 'SUBMISSION_UNCERTAIN'].includes(reservation.status)) {
            await markAiCostUnknownInTransaction(tx, {
              reservationId: reservation.id,
              ownerUserId: job.ownerUserId,
              actorUserId,
              idempotencyKey: `${job.id}:cost:unknown`,
              requestFingerprint: reservation.requestFingerprint,
              providerRequestId: requestedProviderJobId!,
              providerAcceptedAt: acceptedAt!,
              billedUnits: 0,
              reason: 'Operator restored the accepted Provider task identity',
            });
          }
          await tx.aiProviderReconciliationEvent.create({ data: reconciliationEvent });
          if (job.workflowId) {
            await tx.aiMediaWorkflowEvent.create({ data: {
              workflowId: job.workflowId,
              ownerUserId: job.ownerUserId,
              actorUserId,
              jobId: job.id,
              eventKey,
              eventType: `PROVIDER_RECONCILIATION_${raw.action}`,
              payload: reconciliationEvent.payload,
              payloadHash: reconciliationEvent.payloadHash,
            } });
          }
          const updated = await tx.aiImageJob.findUnique({ where: { id: job.id }, include: include() });
          return publicRecord(updated, now());
        });
      } catch (error) {
        if (error instanceof AiProviderReconciliationAdminError) throw error;
        const code = String((error as { code?: unknown }).code || '');
        if (['CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_KEY_CONFLICT'].includes(code)) {
          throw new AiProviderReconciliationAdminError(
            'RECONCILIATION_CHANGED',
            'Provider reconciliation changed before the decision',
            409,
          );
        }
        throw error;
      }
    },
  };
}

export type AiProviderReconciliationAdminService = ReturnType<
  typeof createAiProviderReconciliationAdminService
>;
