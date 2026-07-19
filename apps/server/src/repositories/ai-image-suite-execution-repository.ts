import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  markAiCostSubmissionUncertainInTransaction,
  markAiCostUnknownInTransaction,
  releaseAiCostInTransaction,
  reserveAiCostInTransaction,
  settleAiCostInTransaction,
} from '../services/ai-cost-ledger.js';
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
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import type {
  AiImageSuiteGenerationCoordinator,
  AiImageSuiteGenerationExecutionClaim,
  AiImageSuiteGenerationQueuePayload,
  AiImageSuiteGenerationRuntimeFailure,
} from '../workers/ai-image-suite-generation.js';
import sharp from 'sharp';

export const AI_IMAGE_SUITE_EXECUTION_EVENT_VERSION = 'ai-image-suite-execution-event/v1';

const materializedEventType = 'CHILDREN_MATERIALIZED';
const AI_IMAGE_SUITE_EXECUTION_LEASE_MS = 2 * 60 * 1_000;
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
    estimatedCostCents: number;
    maximumCostCents: number;
  }) => Promise<boolean>;
}

export interface AiImageSuiteGenerationCoordinatorOptions {
  runtimeReady?: AiImageSuiteExecutionRepositoryOptions['runtimeReady'];
  uploadBuffer?: (
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: { category?: 'ai-generated'; ownerId?: string; idempotencyKey?: string },
  ) => Promise<{ url: string; backend: string; filename?: string; key?: string }>;
  createFakeImage?: () => Promise<{ buffer: Buffer; mimeType: 'image/png'; filename: string }>;
}

function cleanDiagnostic(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return fallback;
  return normalized.slice(0, 2_000);
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
      return await this.findRetryReplay(input) || { kind: 'conflict' as const };
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
    && Number(job.estimatedCostCents) === Number(slot.estimatedCostCents)
    && Number(reservation.estimatedCostMinor) === Number(slot.estimatedCostCents)
    && Number(reservation.maximumCostMinor) === Number(slot.maximumCostCents)
    && job.requestedImageCount === 1
    && job.width === 900
    && job.height === 1200
    && job.maxAttempts === 1
    && job.requestFingerprint
    && reservation.requestFingerprint === job.requestFingerprint
    && job.operationConfig?.version === 'ai-image-suite-child-operation/v1'
    && job.operationConfig?.width === 900
    && job.operationConfig?.height === 1200
    && inputs.length > 0
    && inputs.length === frozenInputs.length
    && inputs.every((input: any) => frozenInputs.some((frozen: any) => (
      frozen.assetId === input.assetId
      && frozen.role === input.role
      && Number(frozen.ordinal) === Number(input.ordinal)
      && frozen.sha256 === input.assetSha256
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
) {
  await tx.aiMediaWorkflowEvent.createMany({
    skipDuplicates: true,
    data: [{
      workflowId: graph.workflow.id,
      ownerUserId: graph.suite.ownerUserId,
      actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
      jobId: graph.job.id,
      eventKey: `${graph.workflow.id}:${eventType}:${graph.job.id}:${graph.slot.attempt}`,
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

export class PrismaAiImageSuiteGenerationCoordinator
implements AiImageSuiteGenerationCoordinator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: AiImageSuiteGenerationCoordinatorOptions = {},
  ) {}

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
    return {
      kind: 'ready',
      provider: String(started.suite.provider),
      providerFacing: true,
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
    if (mode === 'cancel') {
      const frontier = await this.finish(payload, 'CANCELLED', {
        code: 'SUITE_CANCELLED',
        message: 'AI media suite child was cancelled',
      }, token);
      return { kind: 'completed' as const, frontier };
    }
    if (mode === 'recover') {
      const frontier = await this.finish(payload, 'FAILED', {
        code: 'WORKER_INTERRUPTED_BEFORE_PROVIDER_ACCEPTANCE',
        message: 'Zero-cost fake suite execution was interrupted before completion',
      }, token);
      return { kind: 'completed' as const, frontier };
    }
    if (mode !== 'execute' || initial.job.status !== 'RUNNING' || initial.slot.status !== 'RUNNING') {
      return { kind: 'ignored' as const };
    }
    const runtimeReady = this.options.runtimeReady || (async (candidate: any) => (
      process.env.NODE_ENV !== 'production'
      && candidate.provider === 'fake'
      && candidate.model === 'fake-image-suite-v1'
      && Number(candidate.estimatedCostCents) === 0
      && Number(candidate.maximumCostCents) === 0
    ));
    if (!await runtimeReady(initial.suite)) {
      const frontier = await this.finish(payload, 'FAILED', {
        code: 'PROVIDER_CONFIG_CHANGED',
        message: 'AI media suite Provider configuration changed before dispatch',
      }, token);
      return { kind: 'completed' as const, frontier };
    }

    try {
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
      const executionLeaseExpiresAt = new Date(now.getTime() + AI_IMAGE_SUITE_EXECUTION_LEASE_MS);
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
    },
    expectedClaimToken: string,
  ) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph || activeClaimToken(graph) !== expectedClaimToken) return [];
      if (graph.job.status === 'CANCEL_REQUESTED' || graph.slot.status === 'CANCEL_REQUESTED') {
        return null;
      }
      if (graph.job.status !== 'RUNNING' || graph.slot.status !== 'RUNNING') return [];
      const beforeSuite = await loadOwnedSuite(tx, graph.suite.id, graph.suite.ownerUserId);
      const before = { revision: Number(graph.suite.revision), status: String(graph.suite.status) };
      const now = new Date();
      await settleAiCostInTransaction(tx, {
        reservationId: graph.reservation.id,
        ownerUserId: graph.suite.ownerUserId,
        actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
        idempotencyKey: `${graph.job.id}:cost:settle`,
        requestFingerprint: graph.reservation.requestFingerprint,
        actualCostMinor: 0,
        billedUnits: 1,
        reason: 'Zero-cost AI media suite child completed',
      });
      const jobChanged = await tx.aiImageJob.updateMany({
        where: { id: graph.job.id, status: 'RUNNING' },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          actualCostCents: 0,
          billedUnits: 1,
          completedAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (jobChanged.count !== 1) throw new Error('AI media suite child completion CAS failed');
      const output = await tx.mediaAsset.create({ data: {
        ownerUserId: graph.suite.ownerUserId,
        aiImageJobId: graph.job.id,
        kind: 'AI_GENERATED',
        url: asset.url,
        storageBackend: asset.storageBackend,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        width: 900,
        height: 1200,
        sha256: asset.sha256,
        metadata: {
          version: 'ai-image-suite-output/v1',
          suiteId: graph.suite.id,
          slotId: graph.slot.id,
          attempt: graph.slot.attempt,
        },
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
      await tx.aiMediaWorkflow.update({
        where: { id: graph.workflow.id },
        data: {
          status: 'SUCCEEDED',
          reviewStatus: 'PENDING',
          completedAt: now,
          revision: { increment: 1 },
        },
      });
      await tx.aiMediaSuiteSlot.update({
        where: { id: graph.slot.id },
        data: {
          status: 'SUCCEEDED',
          executionClaimToken: null,
          executionLeaseExpiresAt: null,
          errorCode: null,
          errorMessage: null,
          revision: { increment: 1 },
        },
      });
      await appendWorkflowExecutionEvent(tx, graph, 'JOB_SUCCEEDED', { outputAssetId: output.id });
      return this.finishSuiteTransition(tx, graph, beforeSuite, before, 'SUITE_CHILD_SUCCEEDED');
    });
  }

  private async finish(
    payload: AiImageSuiteGenerationQueuePayload,
    outcome: 'FAILED' | 'CANCELLED',
    failure: { code: string; message: string },
    expectedClaimToken?: string,
  ) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const graph = await loadExecutionGraph(tx, payload);
      if (!graph || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(String(graph.job.status))) return [];
      if (expectedClaimToken && activeClaimToken(graph) !== expectedClaimToken) return [];
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
      if (graph.reservation.status === 'RESERVED') {
        const common = {
          reservationId: graph.reservation.id,
          ownerUserId: graph.suite.ownerUserId,
          actorUserId: graph.job.actorUserId || graph.suite.actorUserId,
          requestFingerprint: graph.reservation.requestFingerprint,
          billedUnits: 0,
        };
        if (graph.job.providerJobId) {
          await markAiCostUnknownInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:unknown`,
            providerRequestId: graph.job.providerJobId,
            providerAcceptedAt: graph.job.providerDispatchedAt || now,
            reason: 'AI media suite child stopped after Provider acceptance',
          });
        } else if (graph.job.providerDispatchedAt) {
          await markAiCostSubmissionUncertainInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:submission-uncertain`,
            reason: 'AI media suite child stopped with an uncertain Provider submission',
          });
        } else {
          await releaseAiCostInTransaction(tx, {
            ...common,
            idempotencyKey: `${graph.job.id}:cost:release`,
            reason: finalOutcome === 'CANCELLED'
              ? 'AI media suite child cancelled before Provider dispatch'
              : 'AI media suite child failed before Provider dispatch',
          });
        }
      }
      const jobStatus = finalOutcome;
      await tx.aiImageJob.update({
        where: { id: graph.job.id },
        data: {
          status: jobStatus,
          progress: 0,
          billedUnits: 0,
          completedAt: now,
          errorCode: finalFailure.code.slice(0, 100),
          errorMessage: finalFailure.message.slice(0, 2_000),
        },
      });
      await tx.aiMediaWorkflow.update({
        where: { id: graph.workflow.id },
        data: {
          status: jobStatus,
          reviewStatus: 'NOT_READY',
          completedAt: now,
          ...(finalOutcome === 'CANCELLED' ? { cancelRequestedAt: now } : {}),
          revision: { increment: 1 },
        },
      });
      await tx.aiMediaSuiteSlot.update({
        where: { id: graph.slot.id },
        data: {
          status: jobStatus,
          executionClaimToken: null,
          executionLeaseExpiresAt: null,
          errorCode: finalFailure.code.slice(0, 100),
          errorMessage: finalFailure.message.slice(0, 2_000),
          revision: { increment: 1 },
        },
      });
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
