import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import { projectCollectImageAppend } from '../services/ai-image-application.js';
import {
  type AiImageSuiteCandidateApplication,
  type AiImageSuiteCandidateRepository,
  type AiImageSuiteCandidateRepositoryResult,
  type AiImageSuiteCandidateReview,
  type ApplyAiImageSuiteCandidateInput,
  type ReviewAiImageSuiteCandidateInput,
} from '../services/ai-image-suite-candidates.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

const REVIEW_EVENT_VERSION = 'ai-image-suite-candidate-review/v1';
const APPLICATION_EVENT_VERSION = 'ai-image-suite-candidate-application/v1';
const MAX_APPLICATION_RESULT_ITEMS = 30;
const MAX_APPLICATION_RESULT_BYTES = 128 * 1024;
const SAFE_APPLICATION_IMAGE_VALUE = /^(?:https?:\/\/|\/)/iu;

const slotAuthorityInclude = {
  suite: {
    include: {
      plan: {
        select: {
          id: true,
          ownerUserId: true,
          sourceSubjectId: true,
          currentVersionId: true,
          approvedVersionId: true,
          reviewStatus: true,
          staleAt: true,
        },
      },
    },
  },
  childWorkflow: {
    include: {
      inputs: {
        orderBy: { ordinal: 'asc' },
        include: {
          asset: { select: { id: true, ownerUserId: true, sourceCaptureSnapshotId: true } },
        },
      },
      jobs: {
        orderBy: { workflowAttempt: 'desc' },
        take: 1,
        include: {
          assets: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  },
} as const;

type CandidateFailureKind = Exclude<
  AiImageSuiteCandidateRepositoryResult<never>['kind'],
  'updated' | 'replayed'
>;

class CandidateTransactionAbort extends Error {
  constructor(
    public readonly kind: CandidateFailureKind,
    public readonly targetUpdatedAt?: Date,
  ) {
    super(kind);
    this.name = 'CandidateTransactionAbort';
  }
}

function eventKey(workflowId: string, action: 'review' | 'applied', authorityId: string) {
  return `${workflowId}:suite-candidate-${action}:${authorityId}`;
}

function currentJob(slot: any) {
  return Array.isArray(slot?.childWorkflow?.jobs) ? slot.childWorkflow.jobs[0] || null : null;
}

function currentOutput(job: any, outputAssetId: string) {
  return Array.isArray(job?.assets)
    ? job.assets.find((asset: any) => String(asset?.id) === outputAssetId) || null
    : null;
}

function structurallyValid(slot: any): boolean {
  const suite = slot?.suite;
  const workflow = slot?.childWorkflow;
  const job = currentJob(slot);
  return Boolean(slot
    && suite
    && workflow
    && job
    && String(slot.suiteId) === String(suite.id)
    && String(slot.ownerUserId) === String(suite.ownerUserId)
    && String(slot.childWorkflowId) === String(workflow.id)
    && String(workflow.ownerUserId) === String(suite.ownerUserId)
    && String(workflow.contextType) === 'collect'
    && String(workflow.contextId) === String(suite.contextId)
    && String(workflow.contextSlotKey) === String(slot.slotKey)
    && Number(workflow.currentAttempt) === Number(slot.attempt)
    && workflow.status === 'SUCCEEDED'
    && slot.status === 'SUCCEEDED'
    && String(job.ownerUserId) === String(suite.ownerUserId)
    && String(job.workflowId) === String(workflow.id)
    && Number(job.workflowAttempt) === Number(slot.attempt)
    && job.status === 'SUCCEEDED'
    && job.operation === 'IMAGE_TO_IMAGE'
    && String(job.provider) === String(suite.provider)
    && String(job.model) === String(suite.model));
}

function planAuthorityCurrent(slot: any): boolean {
  const suite = slot.suite;
  const plan = suite.plan;
  return Boolean(plan
    && !plan.staleAt
    && plan.reviewStatus === 'APPROVED'
    && String(plan.id) === String(suite.planId)
    && String(plan.ownerUserId) === String(suite.ownerUserId)
    && String(plan.sourceSubjectId) === String(suite.sourceSubjectId)
    && String(plan.currentVersionId) === String(suite.planVersionId)
    && String(plan.approvedVersionId) === String(suite.planVersionId));
}

function inputsMatchFrozenSource(slot: any): boolean {
  const suite = slot.suite;
  const inputs = slot.childWorkflow?.inputs;
  return Boolean(Array.isArray(inputs)
    && inputs.length > 0
    && inputs.every((input: any) => (
      String(input.ownerUserId) === String(suite.ownerUserId)
      && String(input.asset?.ownerUserId) === String(suite.ownerUserId)
      && String(input.asset?.id) === String(input.assetId)
      && String(input.asset?.sourceCaptureSnapshotId) === String(suite.sourceCaptureSnapshotId)
    )));
}

function latestSourceMatches(slot: any, target: any): boolean {
  const suite = slot.suite;
  const latest = target?.sourceCaptureSubject?.snapshots?.[0];
  return Boolean(latest
    && String(target.sourceCaptureSubject.id) === String(suite.sourceSubjectId)
    && String(latest.id) === String(suite.sourceCaptureSnapshotId)
    && String(latest.captureHash) === String(suite.sourceCaptureHash)
    && String(latest.profileHash) === String(suite.sourceProfileHash)
    && String(latest.schemaVersion) === String(suite.sourceSchemaVersion));
}

async function loadSlot(client: any, input: { suiteId: string; slotId: string; ownerUserId: string }) {
  return client.aiMediaSuiteSlot.findFirst({
    where: {
      id: input.slotId,
      suiteId: input.suiteId,
      ownerUserId: input.ownerUserId,
    },
    include: slotAuthorityInclude,
  });
}

async function loadCollectTarget(client: any, slot: any) {
  return client.supplyGoods.findFirst({
    where: { id: slot.suite.contextId, userId: slot.suite.ownerUserId },
    select: {
      id: true,
      userId: true,
      images: true,
      metadata: true,
      updatedAt: true,
      sourceCaptureSubject: {
        select: {
          id: true,
          snapshots: {
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: {
              id: true,
              captureHash: true,
              profileHash: true,
              schemaVersion: true,
            },
          },
        },
      },
    },
  });
}

function reviewOperation(input: ReviewAiImageSuiteCandidateInput, slot: any, job: any) {
  return {
    version: REVIEW_EVENT_VERSION,
    suiteId: input.suiteId,
    slotId: input.slotId,
    workflowId: String(slot.childWorkflow.id),
    jobId: String(job.id),
    outputAssetId: input.outputAssetId,
    operationKey: input.operationKey,
    expectedWorkflowRevision: input.expectedWorkflowRevision,
    actorUserId: input.actorUserId,
    decision: input.decision,
    note: input.note,
  };
}

function reviewValue(slot: any, outputAssetId: string): AiImageSuiteCandidateReview | null {
  const workflow = slot.childWorkflow;
  if (!['APPROVED', 'REJECTED'].includes(String(workflow.reviewStatus))
    || String(workflow.selectedOutputAssetId) !== outputAssetId
    || !(workflow.reviewedAt instanceof Date)) return null;
  return {
    suiteId: String(slot.suiteId),
    slotId: String(slot.id),
    workflowId: String(workflow.id),
    outputAssetId,
    reviewStatus: workflow.reviewStatus,
    workflowRevision: Number(workflow.revision),
    reviewedAt: workflow.reviewedAt,
  };
}

function exactReviewReplay(event: any, operation: Record<string, unknown>, slot: any) {
  const expectedStatus = operation.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (!event
    || event.payloadHash !== hashAiMediaPlanningJson(operation)
    || event.eventType !== (operation.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED')) {
    return null;
  }
  const value = reviewValue(slot, String(operation.outputAssetId));
  return value?.reviewStatus === expectedStatus ? value : null;
}

function applicationRequest(
  input: ApplyAiImageSuiteCandidateInput,
  slot: any,
  job: any,
  outputAssetId: string,
) {
  return {
    version: `${APPLICATION_EVENT_VERSION}:request`,
    suiteId: input.suiteId,
    slotId: input.slotId,
    workflowId: String(slot.childWorkflow.id),
    jobId: String(job.id),
    outputAssetId,
    targetType: 'collect',
    targetId: String(slot.suite.contextId),
    mode: 'append',
    operationKey: input.operationKey,
    expectedWorkflowRevision: input.expectedWorkflowRevision,
    expectedTargetUpdatedAt: new Date(input.expectedTargetUpdatedAt).toISOString(),
    actorUserId: input.actorUserId,
  };
}

function compactApplicationResult(projection: {
  images: unknown[];
  mainImage: string | null;
  editedImages: unknown[];
}) {
  const result = {
    images: projection.images,
    mainImage: projection.mainImage,
    editedImages: projection.editedImages,
  };
  const imageValues = [...projection.images, ...projection.editedImages];
  const safeValues = imageValues.every((value) => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 4_096
    && SAFE_APPLICATION_IMAGE_VALUE.test(value)
  ));
  let serialized = '';
  try { serialized = JSON.stringify(result); } catch { /* fall through to the digest-only form */ }
  if (safeValues
    && projection.images.length <= MAX_APPLICATION_RESULT_ITEMS
    && projection.editedImages.length <= MAX_APPLICATION_RESULT_ITEMS
    && Buffer.byteLength(serialized, 'utf8') <= MAX_APPLICATION_RESULT_BYTES) {
    return { ...result, resultTruncated: false };
  }
  return {
    images: [],
    mainImage: null,
    editedImages: [],
    resultHash: hashAiMediaPlanningJson(result),
    imageCount: projection.images.length,
    editedImageCount: projection.editedImages.length,
    resultTruncated: true,
  };
}

function applicationValue(event: any, requestFingerprint: string): AiImageSuiteCandidateApplication | null {
  const payload = event?.payload;
  if (!event
    || event.eventType !== 'SUITE_CANDIDATE_APPLIED'
    || !payload || typeof payload !== 'object' || Array.isArray(payload)
    || event.payloadHash !== hashAiMediaPlanningJson(payload)
    || String(payload.version) !== APPLICATION_EVENT_VERSION
    || String(payload.requestFingerprint) !== requestFingerprint
    || String(payload.mode) !== 'append'
    || String(payload.targetType) !== 'collect'
    || String(event.jobId) !== String(payload.jobId)
    || String(event.assetId) !== String(payload.outputAssetId)) return null;
  const targetUpdatedAt = new Date(String(payload.targetUpdatedAt || ''));
  const appliedAt = new Date(String(payload.appliedAt || ''));
  if (Number.isNaN(targetUpdatedAt.getTime()) || Number.isNaN(appliedAt.getTime())) return null;
  return {
    suiteId: String(payload.suiteId),
    slotId: String(payload.slotId),
    workflowId: String(payload.workflowId),
    jobId: String(payload.jobId),
    outputAssetId: String(payload.outputAssetId),
    mode: 'append',
    targetType: 'collect',
    targetId: String(payload.targetId),
    images: Array.isArray(payload.images) ? payload.images : [],
    mainImage: typeof payload.mainImage === 'string' ? payload.mainImage : null,
    editedImages: Array.isArray(payload.editedImages) ? payload.editedImages : [],
    targetUpdatedAt,
    appliedAt,
  };
}

async function readEvent(client: any, key: string) {
  return client.aiMediaWorkflowEvent.findUnique({ where: { eventKey: key } });
}

function failure(kind: CandidateFailureKind, targetUpdatedAt?: Date) {
  return { kind, ...(targetUpdatedAt ? { targetUpdatedAt } : {}) } as const;
}

export class PrismaAiImageSuiteCandidateRepository implements AiImageSuiteCandidateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async review(input: ReviewAiImageSuiteCandidateInput) {
    const execute = async () => runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const slot = await loadSlot(tx, input);
      if (!slot || !structurallyValid(slot)) return failure('not-found');
      if (input.production && slot.suite.provider === 'fake') return failure('provider-not-ready');
      const job = currentJob(slot);
      const output = currentOutput(job, input.outputAssetId);
      if (!output
        || String(output.ownerUserId) !== input.ownerUserId
        || String(output.aiImageJobId) !== String(job.id)) return failure('output-conflict');
      const operation = reviewOperation(input, slot, job);
      const key = eventKey(String(slot.childWorkflow.id), 'review', input.outputAssetId);
      const replay = await readEvent(tx, key);
      if (replay) {
        const value = exactReviewReplay(replay, operation, slot);
        return value ? { kind: 'replayed' as const, value } : failure('operation-conflict');
      }
      const target = await loadCollectTarget(tx, slot);
      if (!target) return failure('not-found');
      if (!planAuthorityCurrent(slot)
        || !inputsMatchFrozenSource(slot)
        || !latestSourceMatches(slot, target)) return failure('stale');
      const workflow = slot.childWorkflow;
      if (Number(workflow.revision) !== input.expectedWorkflowRevision) {
        return failure('revision-conflict');
      }
      if (workflow.reviewStatus !== 'PENDING') return failure('state-conflict');
      const reviewedAt = new Date();
      const changed = await tx.aiMediaWorkflow.updateMany({
        where: {
          id: workflow.id,
          ownerUserId: input.ownerUserId,
          revision: input.expectedWorkflowRevision,
          currentAttempt: slot.attempt,
          status: 'SUCCEEDED',
          reviewStatus: 'PENDING',
        },
        data: {
          reviewStatus: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          selectedOutputAssetId: input.outputAssetId,
          reviewedByUserId: input.actorUserId,
          reviewedAt,
          revision: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new CandidateTransactionAbort('revision-conflict');
      await tx.aiMediaWorkflowEvent.create({ data: {
        workflowId: workflow.id,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        jobId: job.id,
        assetId: input.outputAssetId,
        eventKey: key,
        eventType: input.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
        payload: operation,
        payloadHash: hashAiMediaPlanningJson(operation),
      } });
      const committed = await loadSlot(tx, input);
      const value = committed ? reviewValue(committed, input.outputAssetId) : null;
      if (!value) throw new CandidateTransactionAbort('state-conflict');
      return { kind: 'updated' as const, value };
    });

    try {
      return await execute();
    } catch (error: any) {
      if (error instanceof CandidateTransactionAbort) {
        return failure(error.kind, error.targetUpdatedAt);
      }
      if (String(error?.code || '') !== 'P2002') throw error;
      const replay = await execute();
      return replay.kind === 'replayed' || replay.kind === 'operation-conflict'
        ? replay
        : Promise.reject(error);
    }
  }

  async apply(input: ApplyAiImageSuiteCandidateInput) {
    const execute = async () => runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const slot = await loadSlot(tx, input);
      if (!slot || !structurallyValid(slot)) return failure('not-found');
      if (input.production && slot.suite.provider === 'fake') return failure('provider-not-ready');
      const workflow = slot.childWorkflow;
      const job = currentJob(slot);
      const outputAssetId = String(workflow.selectedOutputAssetId || '');
      const output = currentOutput(job, outputAssetId);
      if (!outputAssetId
        || !output
        || String(output.ownerUserId) !== input.ownerUserId
        || String(output.aiImageJobId) !== String(job.id)) return failure('output-conflict');
      const request = applicationRequest(input, slot, job, outputAssetId);
      const requestFingerprint = hashAiMediaPlanningJson(request);
      const key = eventKey(String(workflow.id), 'applied', String(job.id));
      const replay = await readEvent(tx, key);
      if (replay) {
        const value = applicationValue(replay, requestFingerprint);
        return value ? { kind: 'replayed' as const, value } : failure('operation-conflict');
      }
      const target = await loadCollectTarget(tx, slot);
      if (!target) return failure('not-found');
      if (!planAuthorityCurrent(slot)
        || !inputsMatchFrozenSource(slot)
        || !latestSourceMatches(slot, target)) return failure('stale');
      if (Number(workflow.revision) !== input.expectedWorkflowRevision) {
        return failure('revision-conflict');
      }
      if (workflow.reviewStatus !== 'APPROVED') return failure('state-conflict');
      const expectedTargetUpdatedAt = new Date(input.expectedTargetUpdatedAt);
      if (target.updatedAt.getTime() !== expectedTargetUpdatedAt.getTime()) {
        return failure('target-conflict', target.updatedAt);
      }
      const url = typeof output.url === 'string' ? output.url.trim() : '';
      if (!url || url.length > 8_000) return failure('output-conflict');
      const projection = projectCollectImageAppend(target.images, target.metadata, [url]);
      const appliedAt = new Date();
      const targetChanged = await tx.supplyGoods.updateMany({
        where: {
          id: target.id,
          userId: input.ownerUserId,
          updatedAt: expectedTargetUpdatedAt,
        },
        data: {
          images: projection.images,
          metadata: projection.metadata,
          updatedAt: appliedAt,
        },
      });
      if (targetChanged.count !== 1) {
        throw new CandidateTransactionAbort('target-conflict');
      }
      const workflowChanged = await tx.aiMediaWorkflow.updateMany({
        where: {
          id: workflow.id,
          ownerUserId: input.ownerUserId,
          revision: input.expectedWorkflowRevision,
          currentAttempt: slot.attempt,
          status: 'SUCCEEDED',
          reviewStatus: 'APPROVED',
          selectedOutputAssetId: outputAssetId,
        },
        data: { revision: { increment: 1 } },
      });
      if (workflowChanged.count !== 1) {
        throw new CandidateTransactionAbort('revision-conflict');
      }
      const resultPayload = compactApplicationResult(projection);
      const payload = {
        version: APPLICATION_EVENT_VERSION,
        requestFingerprint,
        suiteId: input.suiteId,
        slotId: input.slotId,
        workflowId: String(workflow.id),
        jobId: String(job.id),
        outputAssetId,
        targetType: 'collect',
        targetId: String(slot.suite.contextId),
        mode: 'append',
        targetUpdatedAt: appliedAt.toISOString(),
        appliedAt: appliedAt.toISOString(),
        ...resultPayload,
      };
      await tx.aiMediaWorkflowEvent.create({ data: {
        workflowId: workflow.id,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        jobId: job.id,
        assetId: outputAssetId,
        eventKey: key,
        eventType: 'SUITE_CANDIDATE_APPLIED',
        payload,
        payloadHash: hashAiMediaPlanningJson(payload),
      } });
      return {
        kind: 'updated' as const,
        value: {
          suiteId: input.suiteId,
          slotId: input.slotId,
          workflowId: String(workflow.id),
          jobId: String(job.id),
          outputAssetId,
          mode: 'append' as const,
          targetType: 'collect' as const,
          targetId: String(slot.suite.contextId),
          images: projection.images,
          mainImage: projection.mainImage,
          editedImages: projection.editedImages,
          targetUpdatedAt: appliedAt,
          appliedAt,
        },
      };
    });

    try {
      return await execute();
    } catch (error: any) {
      if (error instanceof CandidateTransactionAbort) {
        if (error.kind === 'target-conflict' && !error.targetUpdatedAt) {
          try {
            const slot = await loadSlot(this.prisma as any, input);
            const current = slot ? await loadCollectTarget(this.prisma as any, slot) : null;
            return failure('target-conflict', current?.updatedAt);
          } catch {
            return failure('target-conflict');
          }
        }
        return failure(error.kind, error.targetUpdatedAt);
      }
      if (String(error?.code || '') !== 'P2002') throw error;
      const replay = await execute();
      return replay.kind === 'replayed' || replay.kind === 'operation-conflict'
        ? replay
        : Promise.reject(error);
    }
  }
}
