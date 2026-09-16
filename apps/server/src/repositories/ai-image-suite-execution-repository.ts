import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  appendAiCostSettlementInTransaction,
  markAiCostSubmissionUncertainInTransaction,
  markAiCostUnknownInTransaction,
  releaseAiCostInTransaction,
  reserveAiCostInTransaction,
  settleAiCostInTransaction,
} from '../services/ai-cost-ledger.js';
import {
  enforceAiImageSuiteCostControlsInTransaction,
  resolveAiImageSuiteCostControls,
  type AiImageSuiteCostControlResolver,
} from '../services/ai-image-suite-cost-controls.js';
import { getStorageBackend } from '../services/image-storage.js';
import {
  createAiImageSuiteCancelRequestFingerprint,
  createAiImageSuiteDispatchRequestFingerprint,
  createAiImageSuiteExecutionEventKey,
  createAiImageSuiteRetryRequestFingerprint,
  type AiImageSuiteCancelResult,
  type AiImageSuiteDispatchResult,
  type AiImageSuiteExecutionRepository,
  type AiImageSuiteExecutionSlot,
  type AiImageSuiteExecutionSlotStatus,
  type AiImageSuiteExecutionStatus,
  type AiImageSuiteExecutionSummary,
  type AiImageSuiteSlotRetryResult,
  type CancelAiImageSuiteInput,
  type DispatchAiImageSuiteInput,
  type RetryAiImageSuiteSlotInput,
} from '../services/ai-image-suite-execution.js';
import {
  AI_IMAGE_SUITE_CHILD_OPERATION_CONFIG_VERSION,
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
  AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION,
} from '../services/ai-image-suite-materialization.js';
import {
  AiImageSuitePaidExecutionError,
  executeAiImageSuitePaidProvider,
  recoverAiImageSuitePaidProvider,
  type AiImageSuitePaidStoredAsset,
} from '../services/ai-image-suite-paid-execution.js';
import { AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION } from '../services/ai-image-suite-output-normalizer.js';
import {
  aiImageSuiteProviderRequestDimensions,
  aiImageSuiteQuoteCurrency,
  hasAdmittedWanxAiImageSuiteOperation,
} from '../services/ai-image-suite-provider-runtime.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import type {
  AiImageSuiteGenerationCoordinator,
  AiImageSuiteGenerationExecutionClaim,
  AiImageSuiteGenerationQueuePayload,
  AiImageSuiteGenerationRuntimeFailure,
} from '../workers/ai-image-suite-generation.js';
import sharp from 'sharp';
import type { AiMediaCapabilityEvidence } from '../services/ai-image-provider-capabilities.js';

export const AI_IMAGE_SUITE_EXECUTION_EVENT_VERSION = 'ai-image-suite-execution-event/v1';

const materializedEventType = 'CHILDREN_MATERIALIZED';
const AI_IMAGE_SUITE_EXECUTION_LEASE_MS = 2 * 60 * 1_000;
const WANX_SUITE_RECOVERY_MAX_AGE_MS = 15 * 60_000;
const WANX_SUITE_RECOVERY_MAX_LOOKUPS = 10;
const executionStatuses = new Set<AiImageSuiteExecutionStatus>([
  'PLANNED',
  'QUEUED',
  'RUNNING',
  'PARTIAL_FAILURE',
  'FAILED',
  'SUCCEEDED',
  'CANCEL_REQUESTED',
  'CANCELLED',
]);
const slotStatuses = new Set<AiImageSuiteExecutionSlotStatus>([
  'PLANNED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED',
]);
const activeSlotStatuses = new Set(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);
const cancellableSuiteStatuses = new Set(['PLANNED', 'QUEUED', 'RUNNING']);

const executionInclude = {
  slots: {
    orderBy: { ordinal: 'asc' },
    include: {
      childWorkflow: {
        include: {
          inputs: { orderBy: { ordinal: 'asc' } },
          jobs: {
            orderBy: { workflowAttempt: 'asc' },
            include: { costReservation: true, assets: true },
          },
        },
      },
    },
  },
} as const;

export interface AiImageSuiteQueueTask {
  suiteId: string;
  slotId: string;
  workflowId: string;
  jobId: string;
  attempt: number;
}

export interface AiImageSuiteExecutionRepositoryOptions {
  runtimeReady?: (suite: {
    provider: string;
    model: string;
    providerConfigHash: string;
    pricingVersion: string;
    concurrencyLimit: number;
    itemCount: number;
    estimatedCostCents: number;
    maximumCostCents: number;
  }) => Promise<boolean>;
  getCostControls?: AiImageSuiteCostControlResolver;
}

export interface AiImageSuiteGenerationCoordinatorOptions {
  executionLeaseMs?: number;
  runtimeReady?: AiImageSuiteExecutionRepositoryOptions['runtimeReady'];
  getRuntimeEvidence?: (
    suite: Parameters<NonNullable<AiImageSuiteExecutionRepositoryOptions['runtimeReady']>>[0],
  ) => Promise<AiMediaCapabilityEvidence | null>;
  outputStorageReady?: () => Promise<boolean>;
  getDispatchAuthorization?: (ownerUserId: string) => Promise<{
    enabled: boolean;
    reasonCode: string;
    reason: string;
  }>;
  uploadBuffer?: (
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: { category?: 'ai-generated'; ownerId?: string; idempotencyKey?: string },
  ) => Promise<{ url: string; backend: string; filename?: string; key?: string }>;
  createFakeImage?: () => Promise<{ buffer: Buffer; mimeType: 'image/png'; filename: string }>;
  executePaidProvider?: typeof executeAiImageSuitePaidProvider;
  recoverPaidProvider?: typeof recoverAiImageSuitePaidProvider;
}

function cleanDiagnostic(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return fallback;
  return normalized.slice(0, 2_000);
}

interface AiImageSuiteExecutionFailure {
  code: string;
  message: string;
  providerSubmissionRejected?: boolean;
  providerResultReceived?: boolean;
  actualCostCents?: number;
  providerJobId?: string;
  providerAcceptedAt?: Date;
  providerResultReceivedAt?: Date;
}

function paidExecutionFailure(error: unknown): AiImageSuiteExecutionFailure {
  const value = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const rawCode = typeof value.code === 'string' ? value.code.trim() : '';
  const actualCostCents = Number(value.actualCostCents);
  const providerJobId = typeof value.providerJobId === 'string'
    ? value.providerJobId.trim()
    : '';
  const providerAcceptedAt = value.providerAcceptedAt instanceof Date
    && !Number.isNaN(value.providerAcceptedAt.getTime())
    ? value.providerAcceptedAt
    : null;
  const providerResultReceivedAt = value.providerResultReceivedAt instanceof Date
    && !Number.isNaN(value.providerResultReceivedAt.getTime())
    ? value.providerResultReceivedAt
    : null;
  return {
    code: /^[A-Z][A-Z0-9_]{0,99}$/u.test(rawCode)
      ? rawCode
      : 'SUITE_PAID_EXECUTION_FAILED',
    message: cleanDiagnostic(
      error instanceof Error ? error.message : null,
      'AI image suite paid execution failed',
    ),
    providerSubmissionRejected: value.providerSubmissionRejected === true,
    providerResultReceived: value.providerResultReceived === true,
    ...(Number.isSafeInteger(actualCostCents) && actualCostCents >= 0
      ? { actualCostCents }
      : {}),
    ...(/^[\x20-\x7e]{1,500}$/u.test(providerJobId) ? { providerJobId } : {}),
    ...(providerAcceptedAt ? { providerAcceptedAt } : {}),
    ...(providerResultReceivedAt ? { providerResultReceivedAt } : {}),
  };
}

function currentJob(slot: any): any | null {
  const workflow = slot?.childWorkflow;
  if (!workflow || !Array.isArray(workflow.jobs)) return null;
  return workflow.jobs.find((job: any) => Number(job.workflowAttempt) === Number(slot.attempt)) || null;
}

function executionCounts(slots: any[]) {
  const counts = {
    planned: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelRequested: 0,
    cancelled: 0,
  };
  for (const slot of slots) {
    if (slot.status === 'PLANNED') counts.planned += 1;
    else if (slot.status === 'QUEUED') counts.queued += 1;
    else if (slot.status === 'RUNNING') counts.running += 1;
    else if (slot.status === 'SUCCEEDED') counts.succeeded += 1;
    else if (slot.status === 'FAILED') counts.failed += 1;
    else if (slot.status === 'CANCEL_REQUESTED') counts.cancelRequested += 1;
    else if (slot.status === 'CANCELLED') counts.cancelled += 1;
  }
  return counts;
}

function eventCounts(slots: any[]) {
  const counts = executionCounts(slots);
  return {
    ...counts,
    total: slots.length,
    active: counts.queued + counts.running + counts.cancelRequested,
  };
}

function executionSummary(row: any): AiImageSuiteExecutionSummary {
  const slots = Array.isArray(row?.slots) ? row.slots : [];
  const status = String(row?.status) as AiImageSuiteExecutionStatus;
  if (!executionStatuses.has(status)) throw new Error('AI media suite execution status is invalid');
  const publicSlots: AiImageSuiteExecutionSlot[] = slots.map((slot: any) => {
    const slotStatus = String(slot.status) as AiImageSuiteExecutionSlotStatus;
    if (!slotStatuses.has(slotStatus)) throw new Error('AI media suite slot status is invalid');
    return {
      slotId: String(slot.id),
      ordinal: Number(slot.ordinal),
      slotKey: String(slot.slotKey),
      status: slotStatus,
      attempt: Number(slot.attempt),
      revision: Number(slot.revision),
      childWorkflowId: String(slot.childWorkflowId || ''),
      error: slot.errorCode
        ? {
          code: cleanDiagnostic(slot.errorCode, 'SUITE_CHILD_FAILED').slice(0, 100),
          message: cleanDiagnostic(slot.errorMessage, 'AI media suite child failed'),
        }
        : null,
    };
  });
  return {
    suiteId: String(row.id),
    revision: Number(row.revision),
    status,
    itemCount: Number(row.itemCount),
    concurrencyLimit: Number(row.concurrencyLimit),
    counts: executionCounts(slots),
    slots: publicSlots,
  };
}

function summaryFromPayload(payload: unknown): AiImageSuiteExecutionSummary | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  try {
    return executionSummary({
      id: (result as any).suiteId,
      revision: (result as any).revision,
      status: (result as any).status,
      itemCount: (result as any).itemCount,
      concurrencyLimit: (result as any).concurrencyLimit,
      slots: Array.isArray((result as any).slots)
        ? (result as any).slots.map((slot: any) => ({
          id: slot.slotId,
          ordinal: slot.ordinal,
          slotKey: slot.slotKey,
          status: slot.status,
          attempt: slot.attempt,
          revision: slot.revision,
          childWorkflowId: slot.childWorkflowId,
          errorCode: slot.error?.code || null,
          errorMessage: slot.error?.message || null,
        }))
        : [],
    });
  } catch {
    return null;
  }
}

async function readCommandReplay(
  client: any,
  input: { suiteId: string; ownerUserId: string; actorUserId: string; operationKey: string },
  fingerprint: string,
) {
  const event = await client.aiMediaSuiteEvent.findUnique({
    where: { eventKey: createAiImageSuiteExecutionEventKey(input) },
  });
  if (!event) return null;
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  const summary = summaryFromPayload(payload);
  if (String(event.suiteId) !== input.suiteId
    || String(event.ownerUserId) !== input.ownerUserId
    || String(event.actorUserId) !== input.actorUserId
    || payload.version !== AI_IMAGE_SUITE_EXECUTION_EVENT_VERSION
    || payload.commandFingerprint !== fingerprint
    || !summary) {
    return { kind: 'conflict' as const };
  }
  return { kind: 'existing' as const, ...summary };
}

async function anotherPlanVersionIsActionable(
  client: any,
  input: { suiteId: string; ownerUserId: string },
): Promise<boolean> {
  const suite = await client.aiMediaSuite.findFirst({
    where: { id: input.suiteId, ownerUserId: input.ownerUserId },
    select: { planId: true, planVersionId: true },
  });
  if (!suite) return false;
  const active = await client.aiMediaSuite.findFirst({
    where: {
      ownerUserId: input.ownerUserId,
      planId: suite.planId,
      id: { not: input.suiteId },
      planVersionId: { not: suite.planVersionId },
      OR: [
        { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
        { status: 'PLANNED', revision: { gte: 4 } },
      ],
    },
    select: { id: true },
  });
  return Boolean(active);
}

async function loadOwnedSuite(client: any, suiteId: string, ownerUserId: string) {
  return client.aiMediaSuite.findFirst({
    where: { id: suiteId, ownerUserId },
    include: executionInclude,
  });
}

function graphIsMaterialized(suite: any): boolean {
  if (!suite || Number(suite.revision) < 4 || !Array.isArray(suite.slots)) return false;
  return suite.slots.length === Number(suite.itemCount)
    && suite.slots.every((slot: any) => {
      const job = currentJob(slot);
      return Boolean(slot.childWorkflowId
        && slot.childWorkflow
        && Number(slot.attempt) >= 1
        && job
        && job.costReservation
        && Number(job.workflowAttempt) === Number(slot.attempt));
    });
}

function paidCostReservationsAreDispatchable(suite: any): boolean {
  if (suite.provider === 'fake') return true;
  let estimatedCostCents = 0;
  let maximumCostCents = 0;
  for (const slot of suite.slots || []) {
    const job = currentJob(slot);
    const reservation = job?.costReservation;
    const estimated = Number(reservation?.estimatedCostMinor);
    const maximum = Number(reservation?.maximumCostMinor);
    if (!job
      || !reservation
      || reservation.status !== 'RESERVED'
      || reservation.provider !== suite.provider
      || reservation.model !== suite.model
      || reservation.operation !== 'IMAGE_TO_IMAGE'
      || String(reservation.currency || 'USD') !== aiImageSuiteQuoteCurrency(String(suite.pricingVersion))
      || String(reservation.requestFingerprint) !== String(job.requestFingerprint)
      || !Number.isSafeInteger(estimated)
      || estimated < 1
      || !Number.isSafeInteger(maximum)
      || maximum < estimated
      || estimated !== Number(slot.estimatedCostCents)
      || maximum !== Number(slot.maximumCostCents)) return false;
    estimatedCostCents += estimated;
    maximumCostCents += maximum;
  }
  return Number.isSafeInteger(estimatedCostCents)
    && Number.isSafeInteger(maximumCostCents)
    && estimatedCostCents === Number(suite.estimatedCostCents)
    && maximumCostCents === Number(suite.maximumCostCents);
}

function paidRetryAttemptHasTerminalAuthority(job: any): boolean {
  const reconciliationStatus = String(job?.providerReconciliationStatus || '');
  const reconciledAt = job?.providerReconciledAt;
  const hasReconciliationLease = job?.providerReconciliationLeaseOwner != null
    || job?.providerReconciliationLeaseTokenHash != null
    || job?.providerReconciliationLeaseExpiresAt != null;
  const neverSubmitted = reconciliationStatus === 'NOT_REQUIRED'
    && job?.providerDispatchedAt == null
    && job?.providerJobId == null;
  const terminalProviderDecision = ['NOT_SUBMITTED', 'NO_OUTPUT'].includes(reconciliationStatus)
    && reconciledAt instanceof Date
    && !Number.isNaN(reconciledAt.getTime());
  return !hasReconciliationLease && (neverSubmitted || terminalProviderDecision);
}

function paidRetryHistoryIsSafe(workflow: any, currentAttempt: number): boolean {
  const jobs = Array.isArray(workflow?.jobs)
    ? workflow.jobs
      .filter((job: any) => Number(job.workflowAttempt) <= currentAttempt)
      .sort((left: any, right: any) => Number(left.workflowAttempt) - Number(right.workflowAttempt))
    : [];
  if (!Number.isSafeInteger(currentAttempt)
    || currentAttempt < 1
    || jobs.length !== currentAttempt) return false;
  const current = jobs[currentAttempt - 1];
  const provider = String(current?.provider || '');
  const model = String(current?.model || '');
  const requestFingerprint = String(current?.requestFingerprint || '');
  return jobs.every((job: any, index: number) => Boolean(
    Number(job.workflowAttempt) === index + 1
    && job.status === 'FAILED'
    && String(job.provider) === provider
    && String(job.model) === model
    && String(job.requestFingerprint) === requestFingerprint
    && /^[a-f0-9]{64}$/u.test(requestFingerprint)
    && job.costReservation?.status === 'RELEASED'
    && String(job.costReservation.provider) === provider
    && String(job.costReservation.model) === model
    && String(job.costReservation.requestFingerprint) === requestFingerprint
    && job.actualCostCents === null
    && Number(job.billedUnits) === 0
    && Array.isArray(job.assets)
    && job.assets.length === 0
    && paidRetryAttemptHasTerminalAuthority(job),
  ));
}

async function materializationEventExists(client: any, suite: any): Promise<boolean> {
  if (!graphIsMaterialized(suite)) return false;
  const event = await client.aiMediaSuiteEvent.findFirst({
    where: {
      suiteId: suite.id,
      ownerUserId: suite.ownerUserId,
      revision: 4,
      eventType: materializedEventType,
    },
    select: { id: true },
  });
  return Boolean(event);
}

async function claimFrontierInTransaction(tx: any, suite: any): Promise<void> {
  const active = suite.slots.filter((slot: any) => activeSlotStatuses.has(String(slot.status))).length;
  const capacity = Math.max(0, Number(suite.concurrencyLimit) - active);
  if (capacity === 0) return;
  const candidates = suite.slots
    .filter((slot: any) => slot.status === 'PLANNED')
    .sort((left: any, right: any) => Number(left.ordinal) - Number(right.ordinal))
    .slice(0, capacity);
  for (const slot of candidates) {
    const job = currentJob(slot);
    if (!job || job.status !== 'PENDING') {
      throw Object.assign(new Error('AI media suite frontier job is not pending'), {
        code: 'AI_MEDIA_SUITE_FRONTIER_INVALID',
      });
    }
    const queuedJob = await tx.aiImageJob.updateMany({
      where: {
        id: job.id,
        ownerUserId: suite.ownerUserId,
        workflowId: slot.childWorkflowId,
        workflowAttempt: slot.attempt,
        status: 'PENDING',
      },
      data: { status: 'QUEUED' },
    });
    const queuedSlot = await tx.aiMediaSuiteSlot.updateMany({
      where: {
        id: slot.id,
        suiteId: suite.id,
        ownerUserId: suite.ownerUserId,
        status: 'PLANNED',
        attempt: slot.attempt,
        revision: slot.revision,
      },
      data: { status: 'QUEUED', revision: { increment: 1 } },
    });
    if (queuedJob.count !== 1 || queuedSlot.count !== 1) {
      throw Object.assign(new Error('AI media suite frontier changed while dispatching'), {
        code: 'AI_MEDIA_SUITE_FRONTIER_CONFLICT',
      });
    }
  }
}

async function appendSuiteEvent(
  tx: any,
  input: { suiteId: string; ownerUserId: string; actorUserId: string; operationKey?: string },
  eventType: string,
  before: { revision: number; status: string },
  suite: any,
  details: Record<string, unknown> = {},
) {
  const summary = executionSummary(suite);
  const commandFingerprint = typeof details.commandFingerprint === 'string'
    ? details.commandFingerprint
    : undefined;
  const payload = {
    version: AI_IMAGE_SUITE_EXECUTION_EVENT_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    beforeRevision: before.revision,
    afterRevision: summary.revision,
    beforeStatus: before.status,
    afterStatus: summary.status,
    counts: eventCounts(suite.slots),
    ...(commandFingerprint ? { commandFingerprint } : {}),
    ...details,
    result: summary,
  };
  const eventKey = input.operationKey
    ? createAiImageSuiteExecutionEventKey({
      ownerUserId: input.ownerUserId,
      operationKey: input.operationKey,
    })
    : `${input.suiteId}:${eventType}:${summary.revision}`;
  await tx.aiMediaSuiteEvent.create({ data: {
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    revision: summary.revision,
    actorUserId: input.actorUserId,
    eventKey,
    eventType,
    payload,
    payloadHash: hashAiMediaPlanningJson(payload),
  } });
  return summary;
}

function retryKey(prefix: string, suiteId: string, slotId: string, attempt: number): string {
  const digest = createHash('sha256')
    .update(`${prefix}\0${suiteId}\0${slotId}\0${attempt}`)
    .digest('hex');
  return `${prefix}:${digest}`;
}

export class PrismaAiImageSuiteExecutionRepository implements AiImageSuiteExecutionRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: AiImageSuiteExecutionRepositoryOptions = {},
  ) {}

  async findDispatchReplay(input: DispatchAiImageSuiteInput) {
    return readCommandReplay(
      this.prisma as any,
      input,
      createAiImageSuiteDispatchRequestFingerprint(input),
    );
  }

  async dispatch(input: DispatchAiImageSuiteInput): Promise<AiImageSuiteDispatchResult> {
    const fingerprint = createAiImageSuiteDispatchRequestFingerprint(input);
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const replay = await readCommandReplay(tx, input, fingerprint);
        if (replay) return replay;
        const suite = await loadOwnedSuite(tx, input.suiteId, input.ownerUserId);
        if (!suite) return { kind: 'not-found' as const };
        if (!await materializationEventExists(tx, suite)) return { kind: 'not-materialized' as const };
        if (Number(suite.revision) !== input.expectedRevision) {
          return Number(suite.revision) > 4
            ? { kind: 'already-dispatched' as const }
            : { kind: 'revision-conflict' as const };
        }
        if (suite.status !== 'PLANNED') return { kind: 'already-dispatched' as const };
        const runtimeReady = this.options.runtimeReady || (async (candidate: any) => (
          process.env.NODE_ENV !== 'production'
          && candidate.provider === 'fake'
          && candidate.model === 'fake-image-suite-v1'
          && Number(candidate.estimatedCostCents) === 0
          && Number(candidate.maximumCostCents) === 0
        ));
        if (!await runtimeReady(suite)) return { kind: 'provider-not-ready' as const };
        if (suite.provider !== 'fake') {
          if (!paidCostReservationsAreDispatchable(suite)) {
            return { kind: 'cost-reservation-invalid' as const };
          }
          const controls = await resolveAiImageSuiteCostControls(
            this.options.getCostControls,
            input.ownerUserId,
          );
          if ('kind' in controls) return controls;
          const costControlFailure = await enforceAiImageSuiteCostControlsInTransaction(tx, {
            ownerUserId: input.ownerUserId,
            controls,
            requestedUnits: 0,
            requestedMaximumCostCents: 0,
            currency: aiImageSuiteQuoteCurrency(String(suite.pricingVersion)),
          });
          if (costControlFailure) return costControlFailure;
        }

        const advanced = await tx.aiMediaSuite.updateMany({
          where: {
            id: suite.id,
            ownerUserId: input.ownerUserId,
            revision: input.expectedRevision,
            status: 'PLANNED',
          },
          data: { status: 'QUEUED', revision: { increment: 1 } },
        });
        if (advanced.count !== 1) return { kind: 'revision-conflict' as const };
        await claimFrontierInTransaction(tx, suite);
        const committed = await loadOwnedSuite(tx, suite.id, input.ownerUserId);
        const summary = await appendSuiteEvent(
          tx,
          input,
          'SUITE_DISPATCHED',
          { revision: Number(suite.revision), status: String(suite.status) },
          committed,
          { commandFingerprint: fingerprint },
        );
        return { kind: 'committed' as const, ...summary };
      });
    } catch (error: any) {
      if (String(error?.code || '') !== 'P2002') throw error;
      return await this.findDispatchReplay(input) || { kind: 'conflict' as const };
    }
  }

  async findCancelReplay(input: CancelAiImageSuiteInput) {
    return readCommandReplay(
      this.prisma as any,
      input,
      createAiImageSuiteCancelRequestFingerprint(input),
    );
  }

  async cancel(input: CancelAiImageSuiteInput): Promise<AiImageSuiteCancelResult> {
    const fingerprint = createAiImageSuiteCancelRequestFingerprint(input);
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const replay = await readCommandReplay(tx, input, fingerprint);
        if (replay) return replay;
        const suite = await loadOwnedSuite(tx, input.suiteId, input.ownerUserId);
        if (!suite) return { kind: 'not-found' as const };
        if (!await materializationEventExists(tx, suite)) return { kind: 'not-materialized' as const };
        if (Number(suite.revision) !== input.expectedRevision) return { kind: 'revision-conflict' as const };
        if (!cancellableSuiteStatuses.has(String(suite.status))) return { kind: 'not-cancellable' as const };

        const now = new Date();
        const directMaterializedCancel = Number(suite.revision) === 4;
        if (directMaterializedCancel) {
          const parentCancelled = await tx.aiMediaSuite.updateMany({
            where: {
              id: suite.id,
              ownerUserId: input.ownerUserId,
              revision: 4,
              status: 'PLANNED',
            },
            data: {
              status: 'CANCELLED',
              revision: { increment: 1 },
              cancelRequestedAt: now,
              completedAt: now,
            },
          });
          if (parentCancelled.count !== 1) return { kind: 'revision-conflict' as const };
        }
        let pendingProvider = false;
        for (const slot of suite.slots) {
          if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(String(slot.status))) continue;
          const workflow = slot.childWorkflow;
          const job = currentJob(slot);
          const reservation = job?.costReservation;
          if (!workflow || !job || !reservation) return { kind: 'conflict' as const };
          const submitted = Boolean(job.providerDispatchedAt || job.providerJobId || job.status === 'RUNNING');
          if (submitted) {
            pendingProvider = true;
            await tx.aiImageJob.updateMany({
              where: { id: job.id, status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
              data: { status: 'CANCEL_REQUESTED' },
            });
            await tx.aiMediaWorkflow.updateMany({
              where: { id: workflow.id, ownerUserId: input.ownerUserId },
              data: {
                status: 'CANCEL_REQUESTED',
                cancelRequestedAt: now,
                revision: { increment: workflow.status === 'CANCEL_REQUESTED' ? 0 : 1 },
              },
            });
            await tx.aiMediaSuiteSlot.updateMany({
              where: { id: slot.id, suiteId: suite.id, ownerUserId: input.ownerUserId },
              data: {
                status: 'CANCEL_REQUESTED',
                revision: { increment: slot.status === 'CANCEL_REQUESTED' ? 0 : 1 },
              },
            });
            continue;
          }
          if (reservation.status !== 'RELEASED') {
            if (reservation.status !== 'RESERVED') return { kind: 'conflict' as const };
            await releaseAiCostInTransaction(tx, {
              reservationId: reservation.id,
              ownerUserId: input.ownerUserId,
              actorUserId: input.actorUserId,
              idempotencyKey: `${job.id}:suite-cancel:release`,
              requestFingerprint: reservation.requestFingerprint,
              billedUnits: 0,
              reason: 'AI media suite cancelled before Provider dispatch',
            });
          }
          await tx.aiImageJob.updateMany({
            where: { id: job.id, status: { in: ['PENDING', 'QUEUED', 'CANCEL_REQUESTED'] } },
            data: {
              status: 'CANCELLED',
              progress: 0,
              billedUnits: 0,
              completedAt: now,
              errorCode: 'SUITE_CANCELLED',
              errorMessage: 'AI media suite was cancelled before Provider dispatch',
            },
          });
          await tx.aiMediaWorkflow.updateMany({
            where: { id: workflow.id, ownerUserId: input.ownerUserId },
            data: {
              status: 'CANCELLED',
              cancelRequestedAt: now,
              completedAt: now,
              revision: { increment: workflow.status === 'CANCELLED' ? 0 : 1 },
            },
          });
          await tx.aiMediaSuiteSlot.updateMany({
            where: { id: slot.id, suiteId: suite.id, ownerUserId: input.ownerUserId },
            data: {
              status: 'CANCELLED',
              errorCode: 'SUITE_CANCELLED',
              errorMessage: 'AI media suite was cancelled before Provider dispatch',
              revision: { increment: slot.status === 'CANCELLED' ? 0 : 1 },
            },
          });
        }

        const afterStatus = pendingProvider ? 'CANCEL_REQUESTED' : 'CANCELLED';
        if (directMaterializedCancel && pendingProvider) {
          throw new Error('Materialized suite contained unexpected Provider dispatch evidence');
        }
        if (!directMaterializedCancel) {
          const advanced = await tx.aiMediaSuite.updateMany({
            where: {
              id: suite.id,
              ownerUserId: input.ownerUserId,
              revision: input.expectedRevision,
              status: suite.status,
            },
            data: {
              status: afterStatus,
              revision: { increment: 1 },
              cancelRequestedAt: now,
              ...(pendingProvider ? {} : { completedAt: now }),
            },
          });
          if (advanced.count !== 1) return { kind: 'revision-conflict' as const };
        }
        const committed = await loadOwnedSuite(tx, suite.id, input.ownerUserId);
        const summary = await appendSuiteEvent(
          tx,
          input,
          afterStatus === 'CANCELLED' ? 'SUITE_CANCELLED' : 'SUITE_CANCEL_REQUESTED',
          { revision: Number(suite.revision), status: String(suite.status) },
          committed,
          { commandFingerprint: fingerprint },
        );
        return { kind: 'committed' as const, ...summary };
      });
    } catch (error: any) {
      if (String(error?.code || '') !== 'P2002') throw error;
      return await this.findCancelReplay(input) || { kind: 'conflict' as const };
    }
  }

  async findRetryReplay(input: RetryAiImageSuiteSlotInput) {
    return readCommandReplay(
      this.prisma as any,
      input,
      createAiImageSuiteRetryRequestFingerprint(input),
    );
  }

  async retryFailedSlot(input: RetryAiImageSuiteSlotInput): Promise<AiImageSuiteSlotRetryResult> {
    const fingerprint = createAiImageSuiteRetryRequestFingerprint(input);
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const replay = await readCommandReplay(tx, input, fingerprint);
        if (replay) return replay;
        const suite = await loadOwnedSuite(tx, input.suiteId, input.ownerUserId);
        if (!suite) return { kind: 'not-found' as const };
        if (!await materializationEventExists(tx, suite)) return { kind: 'not-materialized' as const };
        if (!['FAILED', 'PARTIAL_FAILURE'].includes(String(suite.status))) {
          return { kind: 'retry-not-allowed' as const };
        }
        const slot = suite.slots.find((candidate: any) => String(candidate.id) === input.slotId);
        if (!slot) return { kind: 'slot-not-found' as const };
        if (Number(slot.revision) !== input.expectedSlotRevision) {
          return { kind: 'slot-revision-conflict' as const };
        }
        if (slot.status !== 'FAILED') return { kind: 'slot-not-failed' as const };
        const workflow = slot.childWorkflow;
        const previous = currentJob(slot);
        if (!workflow || !previous || previous.status !== 'FAILED') return { kind: 'conflict' as const };
        if (!previous.costReservation || previous.costReservation.status !== 'RELEASED') {
          return { kind: 'retry-not-allowed' as const };
        }
        if (previous.provider !== 'fake') {
          if (!paidRetryHistoryIsSafe(workflow, Number(slot.attempt))) {
            return { kind: 'retry-not-allowed' as const };
          }
          const controls = await resolveAiImageSuiteCostControls(
            this.options.getCostControls,
            input.ownerUserId,
          );
          if ('kind' in controls) return controls;
          const costControlFailure = await enforceAiImageSuiteCostControlsInTransaction(tx, {
            ownerUserId: input.ownerUserId,
            controls,
            requestedUnits: Number(previous.requestedImageCount || 1),
            requestedMaximumCostCents: Number(previous.costReservation.maximumCostMinor),
            currency: aiImageSuiteQuoteCurrency(String(suite.pricingVersion)),
          });
          if (costControlFailure) return costControlFailure;
        }
        const attempt = Number(slot.attempt) + 1;
        const job = await tx.aiImageJob.create({ data: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          operation: previous.operation,
          workflowId: workflow.id,
          workflowAttempt: attempt,
          status: 'QUEUED',
          provider: previous.provider,
          model: previous.model,
          prompt: previous.prompt,
          negativePrompt: previous.negativePrompt,
          resolvedPrompt: previous.resolvedPrompt,
          resolvedNegativePrompt: previous.resolvedNegativePrompt,
          templateKey: previous.templateKey,
          templateReleaseId: previous.templateReleaseId,
          templateChecksum: previous.templateChecksum,
          templateSnapshot: previous.templateSnapshot,
          requestFingerprint: previous.requestFingerprint,
          inputAssets: previous.inputAssets,
          operationConfig: previous.operationConfig,
          requestedImageCount: previous.requestedImageCount,
          width: previous.width,
          height: previous.height,
          maxAttempts: 1,
          idempotencyKey: retryKey('suite-job-retry', suite.id, slot.id, attempt),
          estimatedCostCents: previous.estimatedCostCents,
        } });
        const reserved = await reserveAiCostInTransaction(tx, {
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          workflowId: workflow.id,
          jobId: job.id,
          idempotencyKey: retryKey('suite-cost-retry', suite.id, slot.id, attempt),
          requestFingerprint: String(previous.requestFingerprint),
          provider: String(previous.provider),
          model: String(previous.model),
          operation: 'IMAGE_TO_IMAGE',
          currency: String(previous.costReservation.currency || 'USD'),
          roundingMode: String(previous.costReservation.roundingMode || 'HALF_UP'),
          estimatedCostMinor: Number(previous.costReservation.estimatedCostMinor),
          maximumCostMinor: Number(previous.costReservation.maximumCostMinor),
        });
        await tx.aiMediaWorkflow.update({
          where: { id: workflow.id },
          data: {
            status: 'QUEUED',
            reviewStatus: 'NOT_READY',
            currentAttempt: attempt,
            completedAt: null,
            cancelRequestedAt: null,
            revision: { increment: 1 },
          },
        });
        const workflowPayload = {
          version: AI_IMAGE_SUITE_EXECUTION_EVENT_VERSION,
          suiteId: suite.id,
          slotId: slot.id,
          attempt,
          previousJobId: previous.id,
          jobId: job.id,
          reservationId: reserved.reservation.id,
        };
        await tx.aiMediaWorkflowEvent.create({ data: {
          workflowId: workflow.id,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          jobId: job.id,
          eventKey: `${workflow.id}:SUITE_RETRY_REQUESTED:${attempt}`,
          eventType: 'SUITE_RETRY_REQUESTED',
          payload: workflowPayload,
          payloadHash: hashAiMediaPlanningJson(workflowPayload),
        } });
        const retried = await tx.aiMediaSuiteSlot.updateMany({
          where: {
            id: slot.id,
            suiteId: suite.id,
            ownerUserId: input.ownerUserId,
            status: 'FAILED',
            attempt: slot.attempt,
            revision: input.expectedSlotRevision,
          },
          data: {
            status: 'QUEUED',
            attempt,
            revision: { increment: 1 },
            errorCode: null,
            errorMessage: null,
          },
        });
        if (retried.count !== 1) return { kind: 'slot-revision-conflict' as const };

        const advanced = await tx.aiMediaSuite.updateMany({
          where: {
            id: suite.id,
            ownerUserId: input.ownerUserId,
            revision: suite.revision,
            status: suite.status,
          },
          data: {
            status: 'QUEUED',
            completedAt: null,
            cancelRequestedAt: null,
            revision: { increment: 1 },
          },
        });
        if (advanced.count !== 1) return { kind: 'conflict' as const };
        const committed = await loadOwnedSuite(tx, suite.id, input.ownerUserId);
        const current = currentJob(committed.slots.find((candidate: any) => candidate.id === slot.id));
        const summary = await appendSuiteEvent(
          tx,
          input,
          'SUITE_SLOT_RETRY_REQUESTED',
          { revision: Number(suite.revision), status: String(suite.status) },
          committed,
          {
            commandFingerprint: fingerprint,
            slotId: slot.id,
            childWorkflowId: workflow.id,
            jobId: current?.id || job.id,
            reservationId: current?.costReservation?.id || reserved.reservation.id,
            attempt,
          },
        );
        return { kind: 'committed' as const, ...summary };
      });
    } catch (error: any) {
      if (String(error?.code || '') !== 'P2002') throw error;
      const replay = await this.findRetryReplay(input);
      if (replay) return replay;
      if (await anotherPlanVersionIsActionable(this.prisma as any, input)) {
        return { kind: 'active-suite-conflict' as const };
      }
      return { kind: 'conflict' as const };
    }
  }

  async listQueueableTasks(suiteId?: string): Promise<AiImageSuiteQueueTask[]> {
    const slots = await (this.prisma as any).aiMediaSuiteSlot.findMany({
      where: {
        status: { in: ['QUEUED', 'CANCEL_REQUESTED'] },
        ...(suiteId ? { suiteId } : {}),
        suite: { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
      },
      orderBy: [{ suiteId: 'asc' }, { ordinal: 'asc' }],
      take: suiteId ? 500 : 100,
      include: {
        childWorkflow: {
          include: { jobs: { orderBy: { workflowAttempt: 'desc' }, take: 1 } },
        },
      },
    });
    return slots.flatMap((slot: any) => {
      const job = slot.childWorkflow?.jobs?.[0];
      if (!job
        || Number(job.workflowAttempt) !== Number(slot.attempt)
        || job.status !== slot.status) return [];
      return [{
        suiteId: String(slot.suiteId),
        slotId: String(slot.id),
        workflowId: String(slot.childWorkflowId),
        jobId: String(job.id),
        attempt: Number(slot.attempt),
      }];
    });
  }
}

type LoadedExecutionGraph = {
  suite: any;
  slot: any;
  workflow: any;
  job: any;
  reservation: any;
};

function queuePayload(graph: LoadedExecutionGraph): AiImageSuiteGenerationQueuePayload {
  return {
    suiteId: String(graph.suite.id),
    slotId: String(graph.slot.id),
    workflowId: String(graph.workflow.id),
    jobId: String(graph.job.id),
    attempt: Number(graph.slot.attempt),
  };
}

async function loadExecutionGraph(
  client: any,
  payload: AiImageSuiteGenerationQueuePayload,
): Promise<LoadedExecutionGraph | null> {
  const slot = await client.aiMediaSuiteSlot.findFirst({
    where: { id: payload.slotId, suiteId: payload.suiteId },
    include: {
      suite: true,
      prompt: true,
      childWorkflow: {
        include: {
          inputs: {
            orderBy: { ordinal: 'asc' },
            include: { asset: true },
          },
          jobs: {
            orderBy: { workflowAttempt: 'asc' },
            include: { costReservation: true, assets: true,
              workflowEvents: { where: { eventType: 'PROVIDER_RECOVERY_CLAIMED' }, select: { id: true }, take: WANX_SUITE_RECOVERY_MAX_LOOKUPS } },
          },
        },
      },
    },
  });
  const workflow = slot?.childWorkflow;
  const job = workflow?.jobs?.find((candidate: any) => (
    Number(candidate.workflowAttempt) === Number(slot.attempt)
  ));
  const reservation = job?.costReservation;
  if (!slot
    || !workflow
    || !job
    || !reservation
    || String(slot.suiteId) !== payload.suiteId
    || String(slot.childWorkflowId) !== payload.workflowId
    || String(workflow.id) !== payload.workflowId
    || String(job.id) !== payload.jobId
    || Number(slot.attempt) !== payload.attempt
    || Number(workflow.currentAttempt) !== payload.attempt
    || Number(job.workflowAttempt) !== payload.attempt) return null;
  return { suite: slot.suite, slot, workflow, job, reservation };
}

async function loadHistoricalExecutionEvidenceGraph(
  client: any,
  payload: AiImageSuiteGenerationQueuePayload,
): Promise<LoadedExecutionGraph | null> {
  const job = await client.aiImageJob.findFirst({
    where: {
      id: payload.jobId,
      workflowId: payload.workflowId,
      workflowAttempt: payload.attempt,
    },
    include: {
      assets: true,
      costReservation: { include: { settlements: true } },
      workflow: {
        include: {
          suiteSlot: { include: { suite: true } },
        },
      },
    },
  });
  const workflow = job?.workflow;
  const slot = workflow?.suiteSlot;
  const suite = slot?.suite;
  const reservation = job?.costReservation;
  const fingerprint = String(job?.requestFingerprint || '');
  const ownerUserId = String(job?.ownerUserId || '');
  if (!job
    || !workflow
    || !slot
    || !suite
    || !reservation
    || String(job.id) !== payload.jobId
    || String(job.workflowId) !== payload.workflowId
    || Number(job.workflowAttempt) !== payload.attempt
    || String(workflow.id) !== payload.workflowId
    || String(slot.id) !== payload.slotId
    || String(slot.suiteId) !== payload.suiteId
    || String(slot.childWorkflowId) !== payload.workflowId
    || String(suite.id) !== payload.suiteId
    || Number(slot.attempt) < payload.attempt
    || Number(workflow.currentAttempt) < payload.attempt
    || !ownerUserId
    || String(workflow.ownerUserId) !== ownerUserId
    || String(slot.ownerUserId) !== ownerUserId
    || String(suite.ownerUserId) !== ownerUserId
    || String(reservation.ownerUserId) !== ownerUserId
    || String(reservation.jobId) !== payload.jobId
    || String(reservation.workflowId) !== payload.workflowId
    || job.operation !== 'IMAGE_TO_IMAGE'
    || workflow.operation !== 'IMAGE_TO_IMAGE'
    || reservation.operation !== 'IMAGE_TO_IMAGE'
    || String(job.provider) !== String(suite.provider)
    || String(reservation.provider) !== String(suite.provider)
    || String(job.model) !== String(suite.model)
    || String(reservation.model) !== String(suite.model)
    || !/^[a-f0-9]{64}$/u.test(fingerprint)
    || String(workflow.requestFingerprint) !== fingerprint
    || String(reservation.requestFingerprint) !== fingerprint) return null;
  return { suite, slot, workflow, job, reservation };
}

function frozenOperationContractValid(graph: LoadedExecutionGraph): boolean {
  const config = graph.job.operationConfig;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  if (config.outputProfile !== AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION
    || config.width !== AI_IMAGE_SUITE_OUTPUT_WIDTH
    || config.height !== AI_IMAGE_SUITE_OUTPUT_HEIGHT) return false;
  if (graph.suite.provider === 'fake') {
    return config.version === AI_IMAGE_SUITE_CHILD_OPERATION_CONFIG_VERSION;
  }
  const dimensions = aiImageSuiteProviderRequestDimensions(String(graph.suite.provider), String(graph.suite.model));
  if (graph.suite.provider === 'dashscope-wanx'
    && (!hasAdmittedWanxAiImageSuiteOperation(graph.job)
      || graph.reservation.currency !== 'CNY'
      || aiImageSuiteQuoteCurrency(String(graph.suite.pricingVersion)) !== 'CNY')) return false;
  return Boolean(
    config.version === AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION
    && config.providerRuntime
    && typeof config.providerRuntime === 'object'
    && !Array.isArray(config.providerRuntime)
    && config.providerRequest?.count === 1
    && config.providerRequest?.width === dimensions.width
    && config.providerRequest?.height === dimensions.height
    && config.finalOutput?.profile === AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION
    && config.finalOutput?.width === AI_IMAGE_SUITE_OUTPUT_WIDTH
    && config.finalOutput?.height === AI_IMAGE_SUITE_OUTPUT_HEIGHT
    && config.finalOutput?.fit === 'contain'
    && config.finalOutput?.background === '#ffffff'
    && config.finalOutput?.format === 'png'
    && config.finalOutput?.normalizerVersion === AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
  );
}

function frozenInputMatchesWorkflowInput(
  frozen: any,
  input: any,
  graph: LoadedExecutionGraph,
): boolean {
  const common = frozen.assetId === input.assetId
    && frozen.role === input.role
    && Number(frozen.ordinal) === Number(input.ordinal)
    && frozen.sha256 === input.assetSha256;
  if (!common || graph.suite.provider === 'fake') return common;
  const asset = input.asset;
  return Boolean(
    asset
    && asset.id === frozen.assetId
    && asset.ownerUserId === graph.suite.ownerUserId
    && asset.kind === 'SOURCE_ORIGINAL'
    && asset.sourceCaptureSnapshotId === graph.suite.sourceCaptureSnapshotId
    && asset.sha256 === frozen.sha256
    && asset.mimeType === frozen.mimeType
    && Number(asset.sizeBytes) === Number(frozen.sizeBytes)
    && Number(asset.width) === Number(frozen.width)
    && Number(asset.height) === Number(frozen.height)
    && asset.storageBackend === frozen.storageBackend
    && asset.storageKey === frozen.storageKey
    && frozen.kind === 'SOURCE_ORIGINAL'
    && frozen.sourceCaptureSnapshotId === graph.suite.sourceCaptureSnapshotId
    && ['local', 'oss'].includes(frozen.storageBackend)
    && typeof frozen.storageKey === 'string'
    && frozen.storageKey.length > 0
    && frozen.storageKey.length <= 2_000
    && ['image/png', 'image/jpeg', 'image/webp'].includes(frozen.mimeType)
    && frozen.mimeType === input.mimeType
    && Number.isSafeInteger(frozen.sizeBytes)
    && frozen.sizeBytes > 0
    && frozen.sizeBytes <= 20 * 1024 * 1024
    && Number.isSafeInteger(frozen.width)
    && Number(frozen.width) === Number(input.width)
    && Number.isSafeInteger(frozen.height)
    && Number(frozen.height) === Number(input.height),
  );
}

function frozenPromptContractValid(graph: LoadedExecutionGraph): boolean {
  const prompt = graph.slot.prompt;
  const config = graph.job.operationConfig;
  if (!prompt || !config || typeof config !== 'object' || Array.isArray(config)) return false;
  return Boolean(
    prompt.id === config.slotPromptId
    && prompt.bindingHash === config.promptBindingHash
    && prompt.slotId === graph.slot.id
    && prompt.suiteId === graph.suite.id
    && prompt.ownerUserId === graph.suite.ownerUserId
    && prompt.ordinal === graph.slot.ordinal
    && prompt.slotKey === graph.slot.slotKey
    && graph.job.prompt === prompt.resolvedPrompt
    && graph.job.resolvedPrompt === prompt.resolvedPrompt
    && graph.job.negativePrompt === prompt.resolvedNegativePrompt
    && graph.job.resolvedNegativePrompt === prompt.resolvedNegativePrompt
    && graph.job.templateKey === prompt.templateKey
    && graph.job.templateReleaseId === prompt.templateReleaseId
    && graph.job.templateChecksum === prompt.templateChecksum
    && hashAiMediaPlanningJson(graph.job.templateSnapshot)
      === hashAiMediaPlanningJson(prompt.templateSnapshot),
  );
}

function frozenExecutionAuthorityValid(graph: LoadedExecutionGraph): boolean {
  const { suite, slot, workflow, job, reservation } = graph;
  const inputs = Array.isArray(workflow.inputs) ? workflow.inputs : [];
  const frozenInputs = Array.isArray(job.inputAssets) ? job.inputAssets : [];
  const claimToken = typeof slot.executionClaimToken === 'string'
    ? slot.executionClaimToken
    : null;
  const claimExpiry = slot.executionLeaseExpiresAt instanceof Date
    ? slot.executionLeaseExpiresAt
    : null;
  const waiting = slot.status === 'QUEUED';
  const claimed = slot.status === 'RUNNING' || slot.status === 'CANCEL_REQUESTED';
  return Boolean(
    Number(suite.revision) >= 5
    && ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(String(suite.status))
    && ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(String(slot.status))
    && ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(String(job.status))
    && workflow.operation === 'IMAGE_TO_IMAGE'
    && job.operation === 'IMAGE_TO_IMAGE'
    && job.provider === suite.provider
    && job.model === suite.model
    && reservation.provider === suite.provider
    && reservation.model === suite.model
    && reservation.operation === 'IMAGE_TO_IMAGE'
    && reservation.status === 'RESERVED'
    && Number(job.estimatedCostCents) === Number(slot.estimatedCostCents)
    && Number(reservation.estimatedCostMinor) === Number(slot.estimatedCostCents)
    && Number(reservation.maximumCostMinor) === Number(slot.maximumCostCents)
    && job.requestedImageCount === 1
    && job.width === AI_IMAGE_SUITE_OUTPUT_WIDTH
    && job.height === AI_IMAGE_SUITE_OUTPUT_HEIGHT
    && job.maxAttempts === 1
    && job.requestFingerprint
    && reservation.requestFingerprint === job.requestFingerprint
    && frozenOperationContractValid(graph)
    && frozenPromptContractValid(graph)
    && inputs.length > 0
    && inputs.length === frozenInputs.length
    && inputs.every((input: any) => frozenInputs.some((frozen: any) => (
      frozenInputMatchesWorkflowInput(frozen, input, graph)
    )))
    && (waiting
      ? claimToken === null && claimExpiry === null
      : !claimed || (Boolean(claimToken?.match(/^[a-f0-9]{64}$/u)) && claimExpiry !== null))
  );
}

function activeClaimToken(graph: LoadedExecutionGraph): string | null {
  return typeof graph.slot.executionClaimToken === 'string'
    && /^[a-f0-9]{64}$/u.test(graph.slot.executionClaimToken)
    ? graph.slot.executionClaimToken
    : null;
}

function claimIsExpired(graph: LoadedExecutionGraph, now = Date.now()): boolean {
  return !(graph.slot.executionLeaseExpiresAt instanceof Date)
    || graph.slot.executionLeaseExpiresAt.getTime() <= now;
}

function executionToken(graph: LoadedExecutionGraph): string {
  return hashAiMediaPlanningJson({
    version: 'ai-image-suite-execution-claim/v1',
    suiteId: graph.suite.id,
    suiteRevision: Number(graph.suite.revision),
    suiteStatus: graph.suite.status,
    slotId: graph.slot.id,
    slotRevision: Number(graph.slot.revision),
    slotStatus: graph.slot.status,
    workflowId: graph.workflow.id,
    workflowRevision: Number(graph.workflow.revision),
    workflowStatus: graph.workflow.status,
    jobId: graph.job.id,
    jobStatus: graph.job.status,
    jobAttemptCount: Number(graph.job.attemptCount),
    reservationId: graph.reservation.id,
    reservationStatus: graph.reservation.status,
    provider: graph.suite.provider,
    model: graph.suite.model,
    providerConfigHash: graph.suite.providerConfigHash,
    pricingVersion: graph.suite.pricingVersion,
  });
}

async function appendWorkflowExecutionEvent(
  tx: any,
  graph: LoadedExecutionGraph,
  eventType: string,
  payload: Record<string, unknown>,
  uniqueClaim?: string,
) {
  const attempt = Number(graph.job.workflowAttempt);
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error('AI media workflow execution attempt is invalid');
  }
  await tx.aiMediaWorkflowEvent.createMany({
    skipDuplicates: true,
    data: [{
      workflowId: graph.workflow.id,
      ownerUserId: graph.suite.ownerUserId,
      actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
      jobId: graph.job.id,
      eventKey: uniqueClaim
        ? `${graph.workflow.id}:${eventType}:${hashAiMediaPlanningJson({ jobId: graph.job.id, attempt, uniqueClaim })}`
        : `${graph.workflow.id}:${eventType}:${graph.job.id}:${attempt}`,
      eventType,
      payload,
      payloadHash: hashAiMediaPlanningJson(payload),
    }],
  });
}

function aggregateSuiteStatus(suite: any): AiImageSuiteExecutionStatus {
  const counts = executionCounts(suite.slots);
  const active = counts.queued + counts.running + counts.cancelRequested;
  if (suite.cancelRequestedAt || suite.status === 'CANCEL_REQUESTED') {
    return active > 0 ? 'CANCEL_REQUESTED' : 'CANCELLED';
  }
  if (counts.running > 0) return 'RUNNING';
  if (counts.queued > 0 || counts.planned > 0) return 'QUEUED';
  if (counts.succeeded === suite.slots.length) return 'SUCCEEDED';
  if (counts.succeeded > 0) return 'PARTIAL_FAILURE';
  if (counts.failed > 0) return 'FAILED';
  return 'CANCELLED';
}

function frontierDifference(before: any, after: any): AiImageSuiteGenerationQueuePayload[] {
  const beforeQueued = new Set((before?.slots || [])
    .filter((slot: any) => slot.status === 'QUEUED')
    .map((slot: any) => String(currentJob(slot)?.id || '')));
  return (after?.slots || []).flatMap((slot: any) => {
    const job = currentJob(slot);
    if (slot.status !== 'QUEUED' || !job || beforeQueued.has(String(job.id))) return [];
    return [{
      suiteId: String(after.id),
      slotId: String(slot.id),
      workflowId: String(slot.childWorkflowId),
      jobId: String(job.id),
      attempt: Number(slot.attempt),
    }];
  });
}

export function createAiImageSuiteOutputAssetData(input: {
  ownerUserId: string;
  jobId: string;
  sourceCaptureSnapshotId: string;
  suiteId: string;
  slotId: string;
  attempt: number;
  asset: {
    url: string;
    storageBackend: string;
    storageKey: string | null;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
  };
}) {
  return {
    ownerUserId: input.ownerUserId,
    aiImageJobId: input.jobId,
    kind: 'AI_GENERATED' as const,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    url: input.asset.url,
    storageBackend: input.asset.storageBackend,
    storageKey: input.asset.storageKey,
    mimeType: input.asset.mimeType,
    sizeBytes: input.asset.sizeBytes,
    width: input.asset.width ?? AI_IMAGE_SUITE_OUTPUT_WIDTH,
    height: input.asset.height ?? AI_IMAGE_SUITE_OUTPUT_HEIGHT,
    sha256: input.asset.sha256,
    metadata: {
      ...(input.asset.metadata || {}),
      version: 'ai-image-suite-output/v1',
      suiteId: input.suiteId,
      slotId: input.slotId,
      attempt: input.attempt,
    },
  };
}

async function createDefaultFakeImage() {
  const buffer = await sharp({
    create: {
      width: 900,
      height: 1200,
      channels: 4,
      background: { r: 244, g: 246, b: 248, alpha: 1 },
    },
  }).png().toBuffer();
  return { buffer, mimeType: 'image/png' as const, filename: 'ai-suite-fake-900x1200.png' };
}

async function resolveCoordinatorRuntimeEvidence(
  options: AiImageSuiteGenerationCoordinatorOptions,
  suite: any,
): Promise<AiMediaCapabilityEvidence | null> {
  if (options.getRuntimeEvidence) return options.getRuntimeEvidence(suite);
  const runtimeReady = options.runtimeReady || (async (candidate: any) => (
    process.env.NODE_ENV !== 'production'
    && candidate.provider === 'fake'
    && candidate.model === 'fake-image-suite-v1'
    && Number(candidate.estimatedCostCents) === 0
    && Number(candidate.maximumCostCents) === 0
  ));
  if (!await runtimeReady(suite)) return null;
  return suite.provider === 'fake' && process.env.NODE_ENV !== 'production'
    ? 'local-test'
    : null;
}

export class PrismaAiImageSuiteGenerationCoordinator
implements AiImageSuiteGenerationCoordinator {
  private readonly executionLeaseMs: number;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: AiImageSuiteGenerationCoordinatorOptions = {},
  ) {
    const leaseMs = options.executionLeaseMs ?? AI_IMAGE_SUITE_EXECUTION_LEASE_MS;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > AI_IMAGE_SUITE_EXECUTION_LEASE_MS) {
      throw new RangeError('Suite execution lease must be 1000..120000 milliseconds');
    }
    this.executionLeaseMs = leaseMs;
  }

  async revalidateAndClaim(
    payload: AiImageSuiteGenerationQueuePayload,
  ): Promise<AiImageSuiteGenerationExecutionClaim> {
    const graph = await loadExecutionGraph(this.prisma as any, payload);
    if (!graph || !frozenExecutionAuthorityValid(graph)) return { kind: 'ignored' };
    if (graph.job.status === 'CANCEL_REQUESTED' || graph.slot.status === 'CANCEL_REQUESTED') {
      const claimToken = activeClaimToken(graph);
      if (!claimToken) return { kind: 'ignored' };
      return {
        kind: 'ready',
        provider: String(graph.suite.provider),
        providerFacing: false,
        executionToken: `cancel:${claimToken}`,
      };
    }
    if (graph.job.status === 'RUNNING') {
      const claimToken = activeClaimToken(graph);
      if (!claimToken || !claimIsExpired(graph)) return { kind: 'ignored' };
      if (hasAdmittedWanxAiImageSuiteOperation(graph.job) && graph.job.providerJobId
        && this.wanxRecoveryWindowOpen(graph)) {
        const recoveryToken = await this.claimWanxRecovery(payload, claimToken);
        if (!recoveryToken) return { kind: 'ignored' };
        return { kind: 'ready', provider: String(graph.suite.provider), providerFacing: false,
          executionToken: `recover:${recoveryToken}` };
      }
      return {
        kind: 'ready',
        provider: String(graph.suite.provider),
        providerFacing: false,
        executionToken: `recover:${claimToken}`,
      };
    }
    const started = await this.start(payload, executionToken(graph));
    if (!started) return { kind: 'ignored' };
    const claimToken = activeClaimToken(started);
    if (!claimToken) return { kind: 'ignored' };
    const evidenceLevel = await resolveCoordinatorRuntimeEvidence(this.options, started.suite);
    return {
      kind: 'ready',
      provider: String(started.suite.provider),
      providerFacing: true,
      evidenceLevel,
      ...(started.suite.provider === 'dashscope-wanx'
        ? { model: String(started.job.model), operationConfig: started.job.operationConfig } : {}),
      executionToken: `execute:${claimToken}`,
    };
  }

  async execute(
    payload: AiImageSuiteGenerationQueuePayload,
    claim: Extract<AiImageSuiteGenerationExecutionClaim, { kind: 'ready' }>,
  ) {
    const initial = await loadExecutionGraph(this.prisma as any, payload);
    const separator = claim.executionToken.indexOf(':');
    const mode = separator > 0 ? claim.executionToken.slice(0, separator) : '';
    const token = separator > 0 ? claim.executionToken.slice(separator + 1) : '';
    if (!initial
      || !frozenExecutionAuthorityValid(initial)
      || activeClaimToken(initial) !== token) return { kind: 'ignored' as const };
    const recoveryOnly = mode === 'recover' && hasAdmittedWanxAiImageSuiteOperation(initial.job)
      && Boolean(initial.job.providerJobId) && !claimIsExpired(initial);
    if (mode === 'cancel') {
      const frontier = await this.finish(payload, 'CANCELLED', {
        code: 'SUITE_CANCELLED',
        message: 'AI media suite child was cancelled',
      }, token, true);
      return { kind: 'completed' as const, frontier };
    }
    if (mode === 'recover' && !recoveryOnly) {
      const paid = initial.suite.provider !== 'fake';
      const code = paid && initial.job.providerJobId
        ? 'PROVIDER_RECOVERY_REQUIRED'
        : paid && initial.job.providerDispatchedAt
          ? 'PROVIDER_SUBMISSION_UNCERTAIN'
          : 'WORKER_INTERRUPTED_BEFORE_PROVIDER_DISPATCH';
      const frontier = await this.finish(payload, 'FAILED', {
        code: paid ? code : 'WORKER_INTERRUPTED_BEFORE_PROVIDER_ACCEPTANCE',
        message: paid
          ? 'Paid AI image suite execution was interrupted and requires cost-safe recovery'
          : 'Zero-cost fake suite execution was interrupted before completion',
      }, token, true);
      return { kind: 'completed' as const, frontier };
    }
    if ((!recoveryOnly && mode !== 'execute') || initial.job.status !== 'RUNNING' || initial.slot.status !== 'RUNNING') {
      return { kind: 'ignored' as const };
    }
    if (!recoveryOnly && this.options.getDispatchAuthorization) {
      const authorization = await this.options.getDispatchAuthorization(
        String(initial.suite.ownerUserId),
      );
      if (!authorization.enabled) {
        const frontier = await this.finish(payload, 'FAILED', {
          code: 'AI_MEDIA_SUITE_DISPATCH_REVOKED',
          message: authorization.reason,
        }, token);
        return { kind: 'completed' as const, frontier };
      }
    }
    const runtimeReady = this.options.runtimeReady || (async (candidate: any) => (
      process.env.NODE_ENV !== 'production'
      && candidate.provider === 'fake'
      && candidate.model === 'fake-image-suite-v1'
      && Number(candidate.estimatedCostCents) === 0
      && Number(candidate.maximumCostCents) === 0
    ));
    if (!recoveryOnly && !await runtimeReady(initial.suite)) {
      const frontier = await this.finish(payload, 'FAILED', {
        code: 'PROVIDER_CONFIG_CHANGED',
        message: 'AI media suite Provider configuration changed before dispatch',
      }, token);
      return { kind: 'completed' as const, frontier };
    }

    if (initial.suite.provider === 'fake') try {
      const image = await (this.options.createFakeImage || createDefaultFakeImage)();
      const outputSha256 = createHash('sha256').update(image.buffer).digest('hex');
      const storage = this.options.uploadBuffer ? null : await getStorageBackend();
      const upload = this.options.uploadBuffer || storage!.uploadBuffer.bind(storage);
      const stored = await upload(image.buffer, image.filename, image.mimeType, {
        category: 'ai-generated',
        ownerId: String(initial.suite.ownerUserId),
        idempotencyKey: `${initial.job.id}:${outputSha256}`,
      });
      const completed = await this.complete(payload, {
        url: stored.url,
        storageBackend: stored.backend,
        storageKey: stored.key || stored.filename || null,
        mimeType: image.mimeType,
        sizeBytes: image.buffer.length,
        sha256: outputSha256,
        width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
        height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
      }, token);
      const frontier = completed === null
        ? await this.finish(payload, 'CANCELLED', {
          code: 'SUITE_CANCELLED',
          message: 'AI media suite child was cancelled while the fake result was being stored',
        }, token)
        : completed;
      return { kind: 'completed' as const, frontier };
    } catch {
      const frontier = await this.finish(payload, 'FAILED', {
        code: 'SUITE_FAKE_EXECUTION_FAILED',
        message: 'AI media suite fake execution failed before candidate persistence',
      }, token);
      return { kind: 'completed' as const, frontier };
    }

    if (!recoveryOnly && claim.evidenceLevel !== 'sandbox-verified'
      && !hasAdmittedWanxAiImageSuiteOperation(initial.job)) {
      const frontier = await this.finish(payload, 'FAILED', {
        code: 'AI_MEDIA_SUITE_PAID_PROVIDER_NOT_VERIFIED',
        message: 'Paid AI image suite generation requires sandbox-verified Provider evidence',
      }, token);
      return { kind: 'completed' as const, frontier };
    }

    let heartbeatLost = false;
    let heartbeatInFlight: Promise<void> | null = null;
    const heartbeat = () => {
      if (heartbeatLost || heartbeatInFlight) return;
      heartbeatInFlight = this.renewExecutionClaim(payload, token)
        .then((renewed) => { if (!renewed) heartbeatLost = true; })
        .catch(() => { heartbeatLost = true; })
        .finally(() => { heartbeatInFlight = null; });
    };
    if (!await this.renewExecutionClaim(payload, token)) return { kind: 'ignored' as const };
    const heartbeatTimer = setInterval(heartbeat, Math.floor(this.executionLeaseMs / 3));
    heartbeatTimer.unref();
    try {
      if (!this.options.outputStorageReady || !await this.options.outputStorageReady()) {
        const frontier = await this.finish(payload, 'FAILED', {
          code: 'SUITE_PROVIDER_STORAGE_INVALID',
          message: 'Paid AI image suite outputs require local or OSS storage',
        }, token);
        return { kind: 'completed' as const, frontier };
      }
      const storage = this.options.uploadBuffer ? null : await getStorageBackend();
      const upload = this.options.uploadBuffer || storage!.uploadBuffer.bind(storage);
      const executePaidProvider = recoveryOnly
        ? this.options.recoverPaidProvider || recoverAiImageSuitePaidProvider
        : this.options.executePaidProvider || executeAiImageSuitePaidProvider;
      const completed = await executePaidProvider({
        ownerUserId: String(initial.suite.ownerUserId),
        jobId: String(initial.job.id),
        maximumCostCents: Number(initial.reservation.maximumCostMinor),
        suite: initial.suite,
        job: initial.job,
      }, {
        assertClaim: async () => {
          if (heartbeatLost || !await this.executionClaimIsActive(payload, token)) {
            throw new AiImageSuitePaidExecutionError(
              'SUITE_PROVIDER_DISPATCH_FENCE_LOST',
              'AI image suite execution claim is no longer active',
            );
          }
        },
        ...(this.options.getDispatchAuthorization ? {
          revalidateDispatchAuthorization: () => this.options.getDispatchAuthorization!(
            String(initial.suite.ownerUserId),
          ),
        } : {}),
        markProviderDispatchStarted: (providerDispatchedAt) => (
          this.markProviderDispatchStarted(payload, token, providerDispatchedAt)
        ),
        recordProviderAccepted: (providerJobId, providerAcceptedAt) => (
          this.recordProviderAccepted(payload, providerJobId, providerAcceptedAt)
        ),
        recordProviderResultEvidence: (evidence) => (
          this.recordProviderResultEvidence(payload, evidence)
        ),
        uploadBuffer: upload,
        recordProviderOutput: (asset) => this.recordProviderOutput(payload, token, asset),
        complete: (result) => this.complete(payload, result.output, token, {
          providerJobId: result.providerJobId,
          providerResultReceivedWithoutIdentity: result.providerResultReceivedWithoutIdentity,
          actualCostCents: result.actualCostCents,
          billedUnits: 1,
        }),
      });
      const frontier = completed === null
        ? await this.finish(payload, 'CANCELLED', {
          code: 'SUITE_CANCELLED',
          message: 'AI media suite child was cancelled after Provider completion',
          providerResultReceived: true,
        }, token)
        : completed;
      return { kind: 'completed' as const, frontier };
    } catch (error) {
      const failure = paidExecutionFailure(error);
      if (failure.providerJobId) {
        try {
          await this.recordProviderAccepted(
            payload,
            failure.providerJobId,
            failure.providerAcceptedAt || new Date(),
          );
        } catch {
          // The failure transition below preserves a manual-reconciliation state.
        }
      }
      if (failure.providerResultReceived
        && failure.actualCostCents !== undefined
        && failure.providerResultReceivedAt) {
        try {
          await this.recordProviderResultEvidence(payload, {
            providerJobId: failure.providerJobId || null,
            actualCostCents: failure.actualCostCents,
            providerResultReceivedAt: failure.providerResultReceivedAt,
          });
        } catch (evidenceError) {
          console.error('[ai-image-suite] paid result evidence persistence failed:',
            evidenceError instanceof Error ? evidenceError.message : 'unknown error');
        }
      }
      if (failure.code === 'SUITE_PROVIDER_DISPATCH_FENCE_LOST'
        || heartbeatLost
        || !await this.executionClaimIsActive(payload, token)) {
        return { kind: 'ignored' as const };
      }
      if (!failure.providerResultReceived && failure.providerJobId
        && !['SUITE_PROVIDER_RECOVERY_NO_OUTPUT', 'SUITE_PROVIDER_RUNTIME_CHANGED', 'SUITE_PROVIDER_INPUT_INVALID',
          'SUITE_PROVIDER_INPUT_MISMATCH', 'INVALID_MEDIA_INPUT', 'INVALID_PROVIDER_RESULT'].includes(failure.code)
        && await this.deferWanxRecovery(payload, token, failure)) {
        return { kind: 'pending' as const, frontier: [] };
      }
      const frontier = await this.finish(payload, 'FAILED', failure, token);
      return { kind: 'completed' as const, frontier };
    } finally {
      clearInterval(heartbeatTimer);
      if (heartbeatInFlight) await heartbeatInFlight;
    }
  }

  private wanxRecoveryWindowOpen(graph: LoadedExecutionGraph): boolean {
    const dispatchedAt = graph.job.providerDispatchedAt;
    const attempts = Array.isArray(graph.job.workflowEvents) ? graph.job.workflowEvents.length : 0;
    return dispatchedAt instanceof Date && Number.isFinite(dispatchedAt.getTime())
      && dispatchedAt.getTime() <= Date.now()
      && dispatchedAt.getTime() + WANX_SUITE_RECOVERY_MAX_AGE_MS > Date.now()
      && Number.isSafeInteger(attempts) && attempts >= 0 && attempts < WANX_SUITE_RECOVERY_MAX_LOOKUPS;
  }

  private async claimWanxRecovery(payload: AiImageSuiteGenerationQueuePayload, previousToken: string): Promise<string | null> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph || !frozenExecutionAuthorityValid(graph) || activeClaimToken(graph) !== previousToken
        || !claimIsExpired(graph) || !hasAdmittedWanxAiImageSuiteOperation(graph.job)
        || !graph.job.providerJobId || !this.wanxRecoveryWindowOpen(graph)
        || graph.job.status !== 'RUNNING' || graph.slot.status !== 'RUNNING') return null;
      const now = new Date();
      const token = createHash('sha256').update(randomUUID()).digest('hex');
      const changed = await tx.aiMediaSuiteSlot.updateMany({ where: { id: graph.slot.id, suiteId: graph.suite.id,
        ownerUserId: graph.suite.ownerUserId, executionClaimToken: previousToken, executionLeaseExpiresAt: { lte: now }, status: 'RUNNING' },
      data: { executionClaimToken: token, executionLeaseExpiresAt: new Date(now.getTime() + this.executionLeaseMs), updatedAt: now } });
      if (changed.count !== 1) return null;
      await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_RECOVERY_CLAIMED', {
        providerJobId: graph.job.providerJobId,
      }, token);
      return token;
    });
  }

  private async deferWanxRecovery(payload: AiImageSuiteGenerationQueuePayload, token: string, failure: AiImageSuiteExecutionFailure): Promise<boolean> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph || !frozenExecutionAuthorityValid(graph) || activeClaimToken(graph) !== token
        || claimIsExpired(graph) || !hasAdmittedWanxAiImageSuiteOperation(graph.job)
        || graph.job.providerJobId !== failure.providerJobId || !this.wanxRecoveryWindowOpen(graph)
        || graph.job.status !== 'RUNNING' || graph.slot.status !== 'RUNNING') return false;
      const now = new Date();
      const changed = await tx.aiMediaSuiteSlot.updateMany({ where: { id: graph.slot.id, ownerUserId: graph.suite.ownerUserId,
        executionClaimToken: token, executionLeaseExpiresAt: { gt: now }, status: 'RUNNING' },
      data: { executionLeaseExpiresAt: new Date(Math.max(now.getTime() + this.executionLeaseMs, graph.slot.executionLeaseExpiresAt.getTime() + 1)) } });
      if (changed.count !== 1) return false;
      await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_RECOVERY_PENDING', {
        providerJobId: failure.providerJobId, reasonCode: failure.code.slice(0, 100),
      });
      // Retain the reservation and own suite lease; the generic image reconciliation
      // worker must not claim a suite child or run its separate completion pipeline.
      return true;
    });
  }

  private async executionClaimIsActive(
    payload: AiImageSuiteGenerationQueuePayload,
    expectedClaimToken: string,
  ): Promise<boolean> {
    const graph = await loadExecutionGraph(this.prisma as any, payload);
    return Boolean(
      graph
      && frozenExecutionAuthorityValid(graph)
      && activeClaimToken(graph) === expectedClaimToken
      && !claimIsExpired(graph)
      && graph.slot.status === 'RUNNING'
      && graph.job.status === 'RUNNING',
    );
  }

  private async renewExecutionClaim(
    payload: AiImageSuiteGenerationQueuePayload,
    expectedClaimToken: string,
  ): Promise<boolean> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph
        || !frozenExecutionAuthorityValid(graph)
        || activeClaimToken(graph) !== expectedClaimToken
        || claimIsExpired(graph)
        || !['RUNNING', 'CANCEL_REQUESTED'].includes(String(graph.slot.status))
        || !['RUNNING', 'CANCEL_REQUESTED'].includes(String(graph.job.status))) return false;
      const now = new Date();
      const changed = await tx.aiMediaSuiteSlot.updateMany({
        where: {
          id: graph.slot.id,
          suiteId: graph.suite.id,
          ownerUserId: graph.suite.ownerUserId,
          executionClaimToken: expectedClaimToken,
          executionLeaseExpiresAt: { gt: now },
          status: { in: ['RUNNING', 'CANCEL_REQUESTED'] },
        },
        data: {
          executionLeaseExpiresAt: new Date(now.getTime() + this.executionLeaseMs),
        },
      });
      return changed.count === 1;
    });
  }

  private async markProviderDispatchStarted(
    payload: AiImageSuiteGenerationQueuePayload,
    expectedClaimToken: string,
    providerDispatchedAt: Date,
  ): Promise<boolean> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      const now = new Date();
      if (!graph
        || !frozenExecutionAuthorityValid(graph)
        || graph.suite.provider === 'fake'
        || activeClaimToken(graph) !== expectedClaimToken
        || claimIsExpired(graph, now.getTime())
        || graph.slot.status !== 'RUNNING'
        || graph.job.status !== 'RUNNING'
        || graph.reservation.status !== 'RESERVED'
        || graph.job.providerDispatchedAt
        || graph.job.providerJobId) return false;
      const acceptedDispatchAt = providerDispatchedAt instanceof Date
        && !Number.isNaN(providerDispatchedAt.getTime())
        ? providerDispatchedAt
        : now;
      const leaseChanged = await tx.aiMediaSuiteSlot.updateMany({
        where: {
          id: graph.slot.id,
          suiteId: graph.suite.id,
          ownerUserId: graph.suite.ownerUserId,
          executionClaimToken: expectedClaimToken,
          executionLeaseExpiresAt: { gt: now },
          status: 'RUNNING',
        },
        data: {
          executionLeaseExpiresAt: new Date(now.getTime() + this.executionLeaseMs),
        },
      });
      const jobChanged = await tx.aiImageJob.updateMany({
        where: {
          id: graph.job.id,
          status: 'RUNNING',
          providerDispatchedAt: null,
          providerJobId: null,
        },
        data: { providerDispatchedAt: acceptedDispatchAt },
      });
      if (leaseChanged.count !== 1 || jobChanged.count !== 1) {
        throw new Error('AI media suite Provider dispatch CAS failed');
      }
      await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_DISPATCH_STARTED', {
        providerDispatchedAt: acceptedDispatchAt.toISOString(),
      });
      return true;
    });
  }

  private async recordProviderAccepted(
    payload: AiImageSuiteGenerationQueuePayload,
    providerJobId: string,
    providerAcceptedAt: Date,
  ): Promise<void> {
    const normalized = String(providerJobId || '').trim();
    if (!normalized
      || normalized.length > 500
      || /[\r\n\t]/u.test(normalized)) {
      throw Object.assign(new Error('Provider request identity is invalid'), {
        code: 'PROVIDER_JOB_ID_INVALID',
      });
    }
    const acceptedAt = providerAcceptedAt instanceof Date
      && !Number.isNaN(providerAcceptedAt.getTime())
      ? providerAcceptedAt
      : new Date();
    const mismatch = await runAiMediaSerializableTransaction(
      this.prisma as any,
      async (tx: any) => {
        const graph = await loadHistoricalExecutionEvidenceGraph(tx, payload);
        if (!graph
          || graph.suite.provider === 'fake'
          || !graph.job.providerDispatchedAt) {
          throw Object.assign(new Error('Provider identity has no matching suite dispatch'), {
            code: 'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT',
          });
        }
        if (graph.job.providerJobId) {
          if (graph.job.providerJobId === normalized) return false;
          await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_IDENTITY_CONFLICT', {
            persistedProviderJobId: graph.job.providerJobId,
            conflictingProviderJobId: normalized,
          });
          return true;
        }
        if (!['RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'CANCELLED'].includes(String(graph.job.status))) {
          throw Object.assign(new Error('Provider identity cannot be bound in the current state'), {
            code: 'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT',
          });
        }
        const changed = await tx.aiImageJob.updateMany({
          where: {
            id: graph.job.id,
            providerJobId: null,
            providerDispatchedAt: { not: null },
            status: { in: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'CANCELLED'] },
          },
          data: {
            providerJobId: normalized,
            ...(['FAILED', 'CANCELLED'].includes(String(graph.job.status)) ? {
              providerReconciliationStatus: 'MANUAL_REVIEW',
              providerReconciliationRevision: {
                increment: 1,
              },
              providerReconciliationNextAt: null,
              providerReconciliationDeadlineAt: null,
              providerReconciliationLastErrorCode: 'PROVIDER_RECOVERY_REQUIRED',
              providerReconciliationLastErrorMessage:
                'Provider identity arrived after the suite attempt became terminal',
            } : {}),
          },
        });
        if (changed.count !== 1) {
          const winner = await tx.aiImageJob.findUnique({ where: { id: graph.job.id } });
          if (winner?.providerJobId === normalized) return false;
          return Boolean(winner?.providerJobId);
        }
        await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_SUBMITTED', {
          providerJobId: normalized,
          providerAcceptedAt: acceptedAt.toISOString(),
        });
        if (['FAILED', 'CANCELLED'].includes(String(graph.job.status))
          && graph.reservation.status === 'SUBMISSION_UNCERTAIN') {
          await markAiCostUnknownInTransaction(tx, {
            reservationId: graph.reservation.id,
            ownerUserId: graph.suite.ownerUserId,
            actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
            idempotencyKey: `${graph.job.id}:cost:unknown`,
            requestFingerprint: graph.reservation.requestFingerprint,
            providerRequestId: normalized,
            providerAcceptedAt: acceptedAt,
            billedUnits: 0,
            reason: 'Late Provider identity bound to a terminal AI media suite child',
          });
        }
        return false;
      },
    );
    if (mismatch) {
      throw Object.assign(new Error('Provider request identity conflicts with persisted evidence'), {
        code: 'PROVIDER_JOB_ID_MISMATCH',
      });
    }
  }

  private async recordProviderResultEvidence(
    payload: AiImageSuiteGenerationQueuePayload,
    evidence: {
      providerJobId: string | null;
      actualCostCents: number;
      providerResultReceivedAt: Date;
    },
  ): Promise<void> {
    const outcome = await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadHistoricalExecutionEvidenceGraph(tx, payload);
      const receivedAt = evidence.providerResultReceivedAt instanceof Date
        && !Number.isNaN(evidence.providerResultReceivedAt.getTime())
        ? evidence.providerResultReceivedAt
        : null;
      if (!graph
        || graph.suite.provider === 'fake'
        || !graph.job.providerDispatchedAt
        || !receivedAt
        || !['RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'CANCELLED'].includes(String(graph.job.status))
        || !Number.isSafeInteger(evidence.actualCostCents)
        || evidence.actualCostCents !== Number(graph.job.estimatedCostCents)
        || evidence.actualCostCents > Number(graph.reservation.maximumCostMinor)
        || (evidence.providerJobId !== null
          && evidence.providerJobId !== graph.job.providerJobId)) {
        throw new Error('AI media suite Provider result evidence is invalid');
      }
      const terminalJob = ['FAILED', 'CANCELLED'].includes(String(graph.job.status));
      if (graph.reservation.status === 'RELEASED') {
        if (graph.job.providerReconciliationStatus !== 'MANUAL_REVIEW') {
          const promoted = await tx.aiImageJob.updateMany({
            where: {
              id: graph.job.id,
              status: { in: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'CANCELLED'] },
            },
            data: {
              providerReconciliationStatus: 'MANUAL_REVIEW',
              providerReconciliationRevision: { increment: 1 },
              providerReconciliationNextAt: null,
              providerReconciliationDeadlineAt: null,
              providerReconciliationLeaseOwner: null,
              providerReconciliationLeaseTokenHash: null,
              providerReconciliationLeaseExpiresAt: null,
              providerReconciledAt: null,
              providerReconciliationLastErrorCode: 'PROVIDER_RESULT_AFTER_COST_RELEASE',
              providerReconciliationLastErrorMessage:
                'Provider result arrived after the attempt cost reservation was released',
            },
          });
          if (promoted.count !== 1) {
            throw new Error('AI media suite late Provider result conflict CAS failed');
          }
        }
        await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_RESULT_COST_CONFLICT', {
          providerJobId: evidence.providerJobId,
          persistedProviderJobId: graph.job.providerJobId,
          actualCostCents: evidence.actualCostCents,
          providerResultReceivedAt: receivedAt.toISOString(),
          reservationStatus: 'RELEASED',
        });
        return 'released-conflict' as const;
      }
      if (graph.reservation.status === 'SETTLED') {
        const matchingSettlement = Array.isArray(graph.reservation.settlements)
          && graph.reservation.settlements.some((settlement: any) => (
            ['CHARGE', 'RECONCILED_CHARGE'].includes(String(settlement.kind))
            && Number(settlement.actualCostMinor) === evidence.actualCostCents
            && Number(settlement.billedUnits) === 1
            && String(settlement.requestFingerprint) === String(graph.reservation.requestFingerprint)
          ));
        if (Number(graph.job.actualCostCents) === evidence.actualCostCents
          && Number(graph.job.billedUnits) === 1
          && matchingSettlement) {
          await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_RESULT_RECEIVED', {
            providerJobId: evidence.providerJobId,
            actualCostCents: evidence.actualCostCents,
            providerResultReceivedAt: receivedAt.toISOString(),
          });
          return 'idempotent' as const;
        }
        throw Object.assign(new Error('AI media suite settled Provider result cost conflicts'), {
          code: 'PROVIDER_RESULT_COST_EVIDENCE_CONFLICT',
        });
      }
      if (graph.job.actualCostCents !== null || Number(graph.job.billedUnits) !== 0) {
        if (Number(graph.job.actualCostCents) !== evidence.actualCostCents
          || Number(graph.job.billedUnits) !== 1) {
          throw new Error('AI media suite Provider result cost evidence conflicts');
        }
        await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_RESULT_RECEIVED', {
          providerJobId: evidence.providerJobId,
          actualCostCents: evidence.actualCostCents,
          providerResultReceivedAt: receivedAt.toISOString(),
        });
        return 'idempotent' as const;
      }
      const changed = await tx.aiImageJob.updateMany({
        where: {
          id: graph.job.id,
          providerDispatchedAt: { not: null },
          actualCostCents: null,
          billedUnits: 0,
          status: { in: ['RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'CANCELLED'] },
        },
        data: {
          actualCostCents: evidence.actualCostCents,
          billedUnits: 1,
          ...(terminalJob ? {
            providerReconciliationStatus: 'MANUAL_REVIEW',
            providerReconciliationRevision: { increment: 1 },
            providerReconciliationNextAt: null,
            providerReconciliationDeadlineAt: null,
            providerReconciliationLastErrorCode: 'PROVIDER_RESULT_REQUIRES_RECOVERY',
            providerReconciliationLastErrorMessage:
              'A paid Provider result arrived after the suite attempt became terminal',
          } : {}),
        },
      });
      if (changed.count !== 1) throw new Error('AI media suite Provider result evidence CAS failed');
      if (terminalJob) {
        const common = {
          reservationId: graph.reservation.id,
          ownerUserId: graph.suite.ownerUserId,
          actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
          requestFingerprint: graph.reservation.requestFingerprint,
          actualCostMinor: evidence.actualCostCents,
          billedUnits: 1,
          reason: 'Late known Provider result cost for a terminal AI media suite child',
        };
        if (graph.reservation.status === 'RESERVED') {
          await settleAiCostInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:settle`,
          });
        } else if (['SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(
          String(graph.reservation.status),
        )) {
          await appendAiCostSettlementInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:late-result-settle`,
            kind: 'RECONCILED_CHARGE',
          });
        }
      }
      await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_RESULT_RECEIVED', {
        providerJobId: evidence.providerJobId,
        actualCostCents: evidence.actualCostCents,
        providerResultReceivedAt: receivedAt.toISOString(),
      });
      return 'recorded' as const;
    });
    if (outcome === 'released-conflict') {
      throw Object.assign(
        new Error('Provider result arrived after the attempt cost reservation was released'),
        { code: 'PROVIDER_RESULT_AFTER_COST_RELEASE_CONFLICT' },
      );
    }
  }

  private async recordProviderOutput(
    payload: AiImageSuiteGenerationQueuePayload,
    expectedClaimToken: string,
    asset: AiImageSuitePaidStoredAsset,
  ): Promise<void> {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph
        || !frozenExecutionAuthorityValid(graph)
        || activeClaimToken(graph) !== expectedClaimToken
        || claimIsExpired(graph)
        || graph.suite.provider === 'fake'
        || graph.job.status !== 'RUNNING'
        || graph.slot.status !== 'RUNNING'
        || !graph.job.providerDispatchedAt) {
        throw new AiImageSuitePaidExecutionError(
          'SUITE_PROVIDER_DISPATCH_FENCE_LOST',
          'AI image suite Provider output claim is no longer active',
        );
      }
      const actualCostCents = Number(asset.metadata.actualCostCents);
      const metadataProviderJobId = asset.metadata.providerJobId == null
        ? null
        : String(asset.metadata.providerJobId);
      const resultReceivedAt = new Date(String(asset.metadata.providerResultReceivedAt || ''));
      if (!Number.isSafeInteger(actualCostCents)
        || actualCostCents !== Number(graph.job.estimatedCostCents)
        || actualCostCents > Number(graph.reservation.maximumCostMinor)
        || Number(graph.job.actualCostCents) !== actualCostCents
        || Number(graph.job.billedUnits) !== 1
        || asset.metadata.normalizerVersion !== AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION
        || !/^[a-f0-9]{64}$/u.test(String(asset.metadata.normalizedSha256 || ''))
        || Number.isNaN(resultReceivedAt.getTime())
        || (metadataProviderJobId !== null && metadataProviderJobId !== graph.job.providerJobId)) {
        throw new Error('AI media suite Provider output evidence is invalid');
      }
      const existing = await tx.mediaAsset.findFirst({
        where: {
          aiImageJobId: graph.job.id,
          ownerUserId: graph.suite.ownerUserId,
          kind: 'AI_PROVIDER_OUTPUT',
        },
      });
      if (existing) {
        const matches = existing.url === asset.url
          && existing.storageBackend === asset.storageBackend
          && existing.storageKey === asset.storageKey
          && existing.mimeType === asset.mimeType
          && Number(existing.sizeBytes) === asset.sizeBytes
          && Number(existing.width) === asset.width
          && Number(existing.height) === asset.height
          && existing.sha256 === asset.sha256
          && existing.sourceCaptureSnapshotId === graph.suite.sourceCaptureSnapshotId;
        if (!matches) throw new Error('AI media suite Provider output identity conflicts');
        return;
      }
      const output = await tx.mediaAsset.create({ data: {
        ownerUserId: graph.suite.ownerUserId,
        aiImageJobId: graph.job.id,
        kind: 'AI_PROVIDER_OUTPUT',
        sourceCaptureSnapshotId: graph.suite.sourceCaptureSnapshotId,
        url: asset.url,
        storageBackend: asset.storageBackend,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256,
        metadata: asset.metadata,
      } });
      for (const input of graph.workflow.inputs) {
        await tx.mediaAssetLineage.create({ data: {
          ownerUserId: graph.suite.ownerUserId,
          workflowId: graph.workflow.id,
          jobId: graph.job.id,
          inputAssetId: input.assetId,
          outputAssetId: output.id,
          inputRole: input.role,
          ordinal: input.ordinal,
          operation: 'IMAGE_TO_IMAGE',
        } });
      }
      await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_OUTPUT_PERSISTED', {
        outputAssetId: output.id,
        sha256: asset.sha256,
        actualCostCents,
      });
    });
  }

  async rejectRuntimeGate(
    payload: AiImageSuiteGenerationQueuePayload,
    claim: Extract<AiImageSuiteGenerationExecutionClaim, { kind: 'ready' }>,
    failure: AiImageSuiteGenerationRuntimeFailure,
  ): Promise<void> {
    const graph = await loadExecutionGraph(this.prisma as any, payload);
    const separator = claim.executionToken.indexOf(':');
    const token = separator > 0 ? claim.executionToken.slice(separator + 1) : '';
    if (!graph || activeClaimToken(graph) !== token) return;
    await this.finish(payload, 'FAILED', { code: failure.code, message: failure.message }, token);
  }

  async scanRecoverable(input: { cursor?: string; limit: number }) {
    const rows = await (this.prisma as any).aiMediaSuiteSlot.findMany({
      where: {
        status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] },
        suite: { status: { in: ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'] } },
      },
      orderBy: { id: 'asc' },
      take: input.limit,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: {
        suite: true,
        prompt: true,
        childWorkflow: {
          include: {
            inputs: {
              orderBy: { ordinal: 'asc' },
              include: { asset: true },
            },
            jobs: {
              orderBy: { workflowAttempt: 'asc' },
              include: { costReservation: true, assets: true },
            },
          },
        },
      },
    });
    const items = rows.flatMap((slot: any) => {
      const workflow = slot.childWorkflow;
      const job = currentJob(slot);
      const graph = job?.costReservation
        ? { suite: slot.suite, slot, workflow, job, reservation: job.costReservation }
        : null;
      if (!graph || !frozenExecutionAuthorityValid(graph)) return [];
      if (graph.job.status === 'RUNNING' && !claimIsExpired(graph)) return [];
      return [queuePayload(graph)];
    });
    return {
      items,
      nextCursor: rows.length === input.limit ? String(rows[rows.length - 1]!.id) : null,
    };
  }

  private async start(payload: AiImageSuiteGenerationQueuePayload, token: string) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph
        || graph.job.status !== 'QUEUED'
        || graph.slot.status !== 'QUEUED'
        || executionToken(graph) !== token) return null;
      const before = { revision: Number(graph.suite.revision), status: String(graph.suite.status) };
      const now = new Date();
      const claimToken = createHash('sha256')
        .update(`${graph.suite.id}\0${graph.slot.id}\0${graph.job.id}\0${randomUUID()}`)
        .digest('hex');
      const executionLeaseExpiresAt = new Date(now.getTime() + this.executionLeaseMs);
      const jobChanged = await tx.aiImageJob.updateMany({
        where: { id: graph.job.id, status: 'QUEUED' },
        data: {
          status: 'RUNNING',
          attemptCount: 1,
          progress: 10,
          startedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
      const workflowChanged = await tx.aiMediaWorkflow.updateMany({
        where: {
          id: graph.workflow.id,
          ownerUserId: graph.suite.ownerUserId,
          currentAttempt: graph.slot.attempt,
          status: 'QUEUED',
        },
        data: {
          status: 'RUNNING',
          revision: { increment: 1 },
        },
      });
      const slotChanged = await tx.aiMediaSuiteSlot.updateMany({
        where: {
          id: graph.slot.id,
          suiteId: graph.suite.id,
          ownerUserId: graph.suite.ownerUserId,
          status: 'QUEUED',
          revision: graph.slot.revision,
        },
        data: {
          status: 'RUNNING',
          executionClaimToken: claimToken,
          executionLeaseExpiresAt,
          revision: { increment: 1 },
        },
      });
      const suiteChanged = await tx.aiMediaSuite.updateMany({
        where: {
          id: graph.suite.id,
          ownerUserId: graph.suite.ownerUserId,
          revision: graph.suite.revision,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        data: { status: 'RUNNING', revision: { increment: 1 } },
      });
      if ([jobChanged, workflowChanged, slotChanged, suiteChanged].some((row) => row.count !== 1)) {
        throw new Error('AI media suite child start CAS failed');
      }
      await appendWorkflowExecutionEvent(tx, graph, 'JOB_STARTED', { attempt: graph.slot.attempt });
      const committed = await loadOwnedSuite(tx, graph.suite.id, graph.suite.ownerUserId);
      const current = committed.slots.find((slot: any) => slot.id === graph.slot.id);
      const currentGraph = {
        suite: committed,
        slot: current,
        workflow: current.childWorkflow,
        job: currentJob(current),
        reservation: currentJob(current)?.costReservation,
      };
      await appendSuiteEvent(
        tx,
        {
          suiteId: graph.suite.id,
          ownerUserId: graph.suite.ownerUserId,
          actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
        },
        'SUITE_CHILD_RUNNING',
        before,
        committed,
        {
          slotId: graph.slot.id,
          childWorkflowId: graph.workflow.id,
          jobId: graph.job.id,
          reservationId: graph.reservation.id,
          attempt: Number(graph.slot.attempt),
        },
      );
      return currentGraph as LoadedExecutionGraph;
    });
  }

  private async complete(
    payload: AiImageSuiteGenerationQueuePayload,
    asset: {
      url: string;
      storageBackend: string;
      storageKey: string | null;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      width?: number;
      height?: number;
      metadata?: Record<string, unknown>;
    },
    expectedClaimToken: string,
    completion: {
      providerJobId: string | null;
      providerResultReceivedWithoutIdentity: boolean;
      actualCostCents: number;
      billedUnits: number;
    } = {
      providerJobId: null,
      providerResultReceivedWithoutIdentity: false,
      actualCostCents: 0,
      billedUnits: 1,
    },
  ) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph
        || !frozenExecutionAuthorityValid(graph)
        || activeClaimToken(graph) !== expectedClaimToken
        || claimIsExpired(graph)) return [];
      if (graph.job.status === 'CANCEL_REQUESTED' || graph.slot.status === 'CANCEL_REQUESTED') {
        return null;
      }
      if (graph.job.status !== 'RUNNING' || graph.slot.status !== 'RUNNING') return [];
      const paid = graph.suite.provider !== 'fake';
      const providerOutputs = graph.job.assets.filter((candidate: any) => (
        candidate.kind === 'AI_PROVIDER_OUTPUT'
      ));
      const providerOutput = providerOutputs[0];
      const rawMetadata = providerOutput?.metadata;
      const finalOutputValid = ['local', 'oss'].includes(asset.storageBackend)
        && typeof asset.storageKey === 'string'
        && asset.storageKey.length > 0
        && asset.storageKey.length <= 2_000
        && asset.mimeType === 'image/png'
        && asset.sizeBytes > 0
        && asset.sizeBytes <= 20 * 1024 * 1024
        && asset.width === AI_IMAGE_SUITE_OUTPUT_WIDTH
        && asset.height === AI_IMAGE_SUITE_OUTPUT_HEIGHT
        && /^[a-f0-9]{64}$/u.test(asset.sha256);
      if (!Number.isSafeInteger(completion.actualCostCents)
        || completion.actualCostCents !== Number(graph.job.estimatedCostCents)
        || completion.actualCostCents > Number(graph.reservation.maximumCostMinor)
        || completion.billedUnits !== 1
        || (completion.providerJobId !== null
          && completion.providerJobId !== graph.job.providerJobId)
        || !finalOutputValid
        || (paid && (providerOutputs.length !== 1
          || !providerOutput
          || Number(graph.job.actualCostCents) !== completion.actualCostCents
          || Number(graph.job.billedUnits) !== 1
          || completion.providerResultReceivedWithoutIdentity !== !graph.job.providerJobId
          || rawMetadata?.version !== 'ai-image-suite-provider-output/v1'
          || rawMetadata?.sourceCaptureSnapshotId !== graph.suite.sourceCaptureSnapshotId
          || rawMetadata?.normalizerVersion !== AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION
          || rawMetadata?.normalizedSha256 !== asset.sha256
          || Number(rawMetadata?.actualCostCents) !== completion.actualCostCents
          || (rawMetadata?.providerJobId ?? null) !== (graph.job.providerJobId ?? null)))) {
        throw new Error('AI media suite paid completion evidence is invalid');
      }
      const beforeSuite = await loadOwnedSuite(tx, graph.suite.id, graph.suite.ownerUserId);
      const before = { revision: Number(graph.suite.revision), status: String(graph.suite.status) };
      const now = new Date();
      await settleAiCostInTransaction(tx, {
        reservationId: graph.reservation.id,
        ownerUserId: graph.suite.ownerUserId,
        actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
        idempotencyKey: `${graph.job.id}:cost:settle`,
        requestFingerprint: graph.reservation.requestFingerprint,
        actualCostMinor: completion.actualCostCents,
        billedUnits: completion.billedUnits,
        reason: paid
          ? 'Paid AI media suite child completed with a persisted Provider output'
          : 'Zero-cost AI media suite child completed',
      });
      const jobChanged = await tx.aiImageJob.updateMany({
        where: { id: graph.job.id, status: 'RUNNING' },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          actualCostCents: completion.actualCostCents,
          billedUnits: completion.billedUnits,
          completedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (jobChanged.count !== 1) throw new Error('AI media suite child completion CAS failed');
      const output = await tx.mediaAsset.create({ data: createAiImageSuiteOutputAssetData({
        ownerUserId: graph.suite.ownerUserId,
        jobId: graph.job.id,
        sourceCaptureSnapshotId: graph.suite.sourceCaptureSnapshotId,
         suiteId: graph.suite.id,
         slotId: graph.slot.id,
         attempt: graph.slot.attempt,
         asset: {
           ...asset,
           metadata: {
             ...(asset.metadata || {}),
             ...(paid ? { providerOutputAssetId: providerOutput.id } : {}),
           },
         },
       }) });
      for (const input of graph.workflow.inputs) {
        await tx.mediaAssetLineage.create({ data: {
          ownerUserId: graph.suite.ownerUserId,
          workflowId: graph.workflow.id,
          jobId: graph.job.id,
          inputAssetId: input.assetId,
          outputAssetId: output.id,
          inputRole: input.role,
          ordinal: input.ordinal,
          operation: 'IMAGE_TO_IMAGE',
        } });
      }
      const workflowChanged = await tx.aiMediaWorkflow.updateMany({
        where: {
          id: graph.workflow.id,
          ownerUserId: graph.suite.ownerUserId,
          currentAttempt: graph.slot.attempt,
          status: 'RUNNING',
        },
        data: {
          status: 'SUCCEEDED',
          reviewStatus: 'PENDING',
          completedAt: now,
          revision: { increment: 1 },
        },
      });
      const slotChanged = await tx.aiMediaSuiteSlot.updateMany({
        where: {
          id: graph.slot.id,
          suiteId: graph.suite.id,
          ownerUserId: graph.suite.ownerUserId,
          status: 'RUNNING',
          executionClaimToken: expectedClaimToken,
          executionLeaseExpiresAt: { gt: now },
        },
        data: {
          status: 'SUCCEEDED',
          executionClaimToken: null,
          executionLeaseExpiresAt: null,
          errorCode: null,
          errorMessage: null,
          revision: { increment: 1 },
        },
      });
      if (workflowChanged.count !== 1 || slotChanged.count !== 1) {
        throw new Error('AI media suite paid completion fence was lost');
      }
      await appendWorkflowExecutionEvent(tx, graph, 'JOB_SUCCEEDED', { outputAssetId: output.id });
      return this.finishSuiteTransition(tx, graph, beforeSuite, before, 'SUITE_CHILD_SUCCEEDED');
    });
  }

  private async finish(
    payload: AiImageSuiteGenerationQueuePayload,
    outcome: 'FAILED' | 'CANCELLED',
    failure: AiImageSuiteExecutionFailure,
    expectedClaimToken?: string,
    allowExpiredLease = false,
  ) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(String(graph.job.status))) return [];
      if (expectedClaimToken && activeClaimToken(graph) !== expectedClaimToken) return [];
      if (expectedClaimToken && !allowExpiredLease && claimIsExpired(graph)) return [];
      const cancellationWon = graph.job.status === 'CANCEL_REQUESTED'
        || graph.slot.status === 'CANCEL_REQUESTED';
      const finalOutcome = cancellationWon ? 'CANCELLED' : outcome;
      const finalFailure = cancellationWon
        ? {
          code: 'SUITE_CANCELLED',
          message: 'AI media suite child was cancelled',
        }
        : failure;
      const beforeSuite = await loadOwnedSuite(tx, graph.suite.id, graph.suite.ownerUserId);
      const before = { revision: Number(graph.suite.revision), status: String(graph.suite.status) };
      const now = new Date();
      const persistedKnownCost = Number.isSafeInteger(graph.job.actualCostCents)
        && Number(graph.job.actualCostCents) === Number(graph.job.estimatedCostCents)
        && Number(graph.job.billedUnits) === 1;
      const transientResultReceivedAt = failure.providerResultReceivedAt instanceof Date
        && !Number.isNaN(failure.providerResultReceivedAt.getTime())
        ? failure.providerResultReceivedAt
        : null;
      const transientProviderIdentityValid = !failure.providerJobId
        || !graph.job.providerJobId
        || failure.providerJobId === graph.job.providerJobId;
      const transientKnownCost = failure.providerResultReceived === true
        && Number.isSafeInteger(failure.actualCostCents)
        && Number(failure.actualCostCents) === Number(graph.job.estimatedCostCents)
        && transientResultReceivedAt !== null
        && transientProviderIdentityValid
        && graph.reservation.status !== 'RELEASED';
      const providerResultKnown = graph.reservation.status !== 'RELEASED'
        && (persistedKnownCost || transientKnownCost);
      const knownActualCostCents = persistedKnownCost
        ? Number(graph.job.actualCostCents)
        : transientKnownCost
          ? Number(failure.actualCostCents)
          : null;
      const effectiveProviderJobId = graph.job.providerJobId || failure.providerJobId || null;
      const failureProviderAcceptedAt = failure.providerAcceptedAt instanceof Date
        && !Number.isNaN(failure.providerAcceptedAt.getTime())
        ? failure.providerAcceptedAt
        : null;
      const reservationProviderAcceptedAt = graph.reservation.providerAcceptedAt instanceof Date
        && !Number.isNaN(graph.reservation.providerAcceptedAt.getTime())
        ? graph.reservation.providerAcceptedAt
        : null;
      let eventProviderAcceptedAt: Date | null = null;
      if (effectiveProviderJobId
        && !failureProviderAcceptedAt
        && !reservationProviderAcceptedAt
        && tx.aiMediaWorkflowEvent?.findUnique) {
        const submitted = await tx.aiMediaWorkflowEvent.findUnique({
          where: {
            eventKey: `${graph.workflow.id}:PROVIDER_SUBMITTED:${graph.job.id}:${graph.slot.attempt}`,
          },
          select: { payload: true },
        });
        const rawAcceptedAt = submitted?.payload?.providerAcceptedAt;
        const parsedAcceptedAt = typeof rawAcceptedAt === 'string'
          ? new Date(rawAcceptedAt)
          : null;
        if (parsedAcceptedAt && !Number.isNaN(parsedAcceptedAt.getTime())) {
          eventProviderAcceptedAt = parsedAcceptedAt;
        }
      }
      const providerAcceptedAt = failureProviderAcceptedAt
        || reservationProviderAcceptedAt
        || eventProviderAcceptedAt;
      if (effectiveProviderJobId && !providerAcceptedAt) {
        throw Object.assign(
          new Error('Provider acceptance timestamp evidence is missing for the suite attempt'),
          { code: 'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING' },
        );
      }
      if (!persistedKnownCost && transientKnownCost && transientResultReceivedAt) {
        const evidencePersisted = await tx.aiImageJob.updateMany({
          where: {
            id: graph.job.id,
            status: { in: ['RUNNING', 'CANCEL_REQUESTED'] },
            actualCostCents: null,
            billedUnits: 0,
            ...(graph.job.providerJobId
              ? { providerJobId: graph.job.providerJobId }
              : { providerJobId: null }),
          },
          data: {
            actualCostCents: Number(failure.actualCostCents),
            billedUnits: 1,
            ...(failure.providerJobId && !graph.job.providerJobId
              ? { providerJobId: failure.providerJobId }
              : {}),
          },
        });
        if (evidencePersisted.count !== 1) {
          throw new Error('AI media suite transient Provider result evidence CAS failed');
        }
        await appendWorkflowExecutionEvent(tx, graph, 'PROVIDER_RESULT_RECEIVED', {
          providerJobId: failure.providerJobId || graph.job.providerJobId || null,
          actualCostCents: Number(failure.actualCostCents),
          providerResultReceivedAt: transientResultReceivedAt.toISOString(),
        });
      }
      const definitelyNotSubmitted = graph.suite.provider !== 'fake'
        && failure.providerSubmissionRejected === true
        && !effectiveProviderJobId;
      if (graph.reservation.status === 'RESERVED') {
        const common = {
          reservationId: graph.reservation.id,
          ownerUserId: graph.suite.ownerUserId,
          actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
          requestFingerprint: graph.reservation.requestFingerprint,
        };
        if (providerResultKnown && knownActualCostCents !== null) {
          await settleAiCostInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:settle`,
            actualCostMinor: knownActualCostCents,
            billedUnits: 1,
            reason: 'AI media suite Provider returned a known billable result before terminal processing',
          });
        } else if (effectiveProviderJobId) {
          await markAiCostUnknownInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:unknown`,
            providerRequestId: effectiveProviderJobId,
            providerAcceptedAt: providerAcceptedAt!,
            billedUnits: 0,
            reason: 'AI media suite child stopped after Provider acceptance',
          });
        } else if (failure.providerSubmissionRejected) {
          await releaseAiCostInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:release`,
            billedUnits: 0,
            reason: 'AI media suite Provider definitely rejected the request',
          });
        } else if (graph.job.providerDispatchedAt) {
          await markAiCostSubmissionUncertainInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:submission-uncertain`,
            billedUnits: 0,
            reason: 'AI media suite child stopped with an uncertain Provider submission',
          });
        } else {
          await releaseAiCostInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:release`,
            billedUnits: 0,
            reason: finalOutcome === 'CANCELLED'
              ? 'AI media suite child cancelled before Provider dispatch'
              : 'AI media suite child failed before Provider dispatch',
          });
        }
      } else if (providerResultKnown
        && knownActualCostCents !== null
        && ['SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'].includes(
          String(graph.reservation.status),
        )) {
        await appendAiCostSettlementInTransaction(tx, {
          reservationId: graph.reservation.id,
          ownerUserId: graph.suite.ownerUserId,
          actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
          idempotencyKey: `${graph.job.id}:cost:late-result-settle`,
          requestFingerprint: graph.reservation.requestFingerprint,
          kind: 'RECONCILED_CHARGE',
          actualCostMinor: knownActualCostCents,
          billedUnits: 1,
          reason: 'AI media suite Provider returned a known billable result during terminal recovery',
        });
      }
      const jobStatus = finalOutcome;
      const requiresManualReconciliation = providerResultKnown
        || Boolean(effectiveProviderJobId)
        || Boolean(graph.job.providerDispatchedAt && !failure.providerSubmissionRejected);
      const jobChanged = await tx.aiImageJob.updateMany({
        where: {
          id: graph.job.id,
          status: { in: ['RUNNING', 'CANCEL_REQUESTED'] },
        },
        data: {
          status: jobStatus,
          progress: 0,
          ...(effectiveProviderJobId && !graph.job.providerJobId
            ? { providerJobId: effectiveProviderJobId }
            : {}),
          actualCostCents: providerResultKnown ? knownActualCostCents : graph.job.actualCostCents,
          billedUnits: providerResultKnown ? 1 : Number(graph.job.billedUnits || 0),
          completedAt: now,
          errorCode: finalFailure.code.slice(0, 100),
          errorMessage: finalFailure.message.slice(0, 2_000),
          ...(definitelyNotSubmitted ? {
            providerReconciliationStatus: 'NOT_SUBMITTED',
            providerReconciliationRevision: { increment: 1 },
            providerReconciliationNextAt: null,
            providerReconciliationDeadlineAt: null,
            providerReconciliationLeaseOwner: null,
            providerReconciliationLeaseTokenHash: null,
            providerReconciliationLeaseExpiresAt: null,
            providerReconciliationLastProviderStatus: 'NOT_SUBMITTED',
            providerReconciliationLastErrorCode: null,
            providerReconciliationLastErrorMessage: null,
            providerReconciledAt: now,
          } : requiresManualReconciliation ? {
            providerReconciliationStatus: 'MANUAL_REVIEW',
            providerReconciliationRevision: { increment: 1 },
            providerReconciliationNextAt: null,
            providerReconciliationDeadlineAt: null,
            providerReconciliationLeaseOwner: null,
            providerReconciliationLeaseTokenHash: null,
            providerReconciliationLeaseExpiresAt: null,
            providerReconciliationLastErrorCode: finalFailure.code.slice(0, 100),
            providerReconciliationLastErrorMessage: finalFailure.message.slice(0, 500),
          } : {}),
        },
      });
      const workflowChanged = await tx.aiMediaWorkflow.updateMany({
        where: {
          id: graph.workflow.id,
          ownerUserId: graph.suite.ownerUserId,
          currentAttempt: graph.slot.attempt,
          status: { in: ['RUNNING', 'CANCEL_REQUESTED'] },
        },
        data: {
          status: jobStatus,
          reviewStatus: 'NOT_READY',
          completedAt: now,
          ...(finalOutcome === 'CANCELLED' ? { cancelRequestedAt: now } : {}),
          revision: { increment: 1 },
        },
      });
      const slotChanged = await tx.aiMediaSuiteSlot.updateMany({
        where: {
          id: graph.slot.id,
          suiteId: graph.suite.id,
          ownerUserId: graph.suite.ownerUserId,
          status: { in: ['RUNNING', 'CANCEL_REQUESTED'] },
          ...(expectedClaimToken ? { executionClaimToken: expectedClaimToken } : {}),
        },
        data: {
          status: jobStatus,
          executionClaimToken: null,
          executionLeaseExpiresAt: null,
          errorCode: finalFailure.code.slice(0, 100),
          errorMessage: finalFailure.message.slice(0, 2_000),
          revision: { increment: 1 },
        },
      });
      if (jobChanged.count !== 1 || workflowChanged.count !== 1 || slotChanged.count !== 1) {
        throw new Error('AI media suite terminal transition CAS failed');
      }
      await appendWorkflowExecutionEvent(
        tx,
        graph,
        finalOutcome === 'CANCELLED' ? 'CANCELLED' : 'JOB_FAILED',
        { errorCode: finalFailure.code },
      );
      return this.finishSuiteTransition(
        tx,
        graph,
        beforeSuite,
        before,
        finalOutcome === 'CANCELLED' ? 'SUITE_CHILD_CANCELLED' : 'SUITE_CHILD_FAILED',
      );
    });
  }

  private async finishSuiteTransition(
    tx: any,
    graph: LoadedExecutionGraph,
    beforeSuite: any,
    before: { revision: number; status: string },
    eventType: string,
  ) {
    let prepared = await loadOwnedSuite(tx, graph.suite.id, graph.suite.ownerUserId);
    const cancelling = Boolean(prepared.cancelRequestedAt || prepared.status === 'CANCEL_REQUESTED');
    if (!cancelling) {
      await claimFrontierInTransaction(tx, prepared);
      prepared = await loadOwnedSuite(tx, graph.suite.id, graph.suite.ownerUserId);
    }
    const afterStatus = aggregateSuiteStatus(prepared);
    const terminal = ['SUCCEEDED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED'].includes(afterStatus);
    const changed = await tx.aiMediaSuite.updateMany({
      where: {
        id: graph.suite.id,
        ownerUserId: graph.suite.ownerUserId,
        revision: graph.suite.revision,
      },
      data: {
        status: afterStatus,
        revision: { increment: 1 },
        ...(terminal ? { completedAt: new Date() } : { completedAt: null }),
      },
    });
    if (changed.count !== 1) throw new Error('AI media suite parent aggregation CAS failed');
    const committed = await loadOwnedSuite(tx, graph.suite.id, graph.suite.ownerUserId);
    await appendSuiteEvent(
      tx,
      {
        suiteId: graph.suite.id,
        ownerUserId: graph.suite.ownerUserId,
        actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
      },
      eventType,
      before,
      committed,
      {
        slotId: graph.slot.id,
        childWorkflowId: graph.workflow.id,
        jobId: graph.job.id,
        reservationId: graph.reservation.id,
        attempt: Number(graph.slot.attempt),
      },
    );
    return frontierDifference(beforeSuite, committed);
  }
}
