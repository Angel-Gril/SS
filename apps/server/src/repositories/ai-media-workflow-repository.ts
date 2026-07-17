import type { PrismaClient } from '@prisma/client';
import {
  AI_MEDIA_WORKFLOW_MODEL,
  AI_MEDIA_WORKFLOW_PROVIDER,
  aiMediaPayloadHash,
  createAiMediaWorkflowFingerprint,
  normalizeAiMediaWorkflowReferences,
  type AiMediaWorkflowRecord,
  type AiMediaWorkflowRepository,
  type CreateAiMediaWorkflowInput,
} from '../services/ai-media-workflows.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';

function workflowRecord(row: any): AiMediaWorkflowRecord {
  return row as AiMediaWorkflowRecord;
}

function eventData(input: {
  workflowId: string;
  ownerUserId: string;
  actorUserId?: string | null;
  jobId?: string | null;
  assetId?: string | null;
  eventKey: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const payload = input.payload || {};
  return { ...input, payload, payloadHash: aiMediaPayloadHash(payload) };
}

const detailInclude = {
  inputs: { include: { asset: true }, orderBy: { ordinal: 'asc' } },
  jobs: { include: { assets: true }, orderBy: { workflowAttempt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' }, take: 200 },
} as const;

interface FrozenSourceAsset {
  id: string;
  sha256: string | null;
  sourceCaptureSnapshotId: string | null;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

function orderSourceAssets(
  rows: FrozenSourceAsset[],
  references: Array<{ assetId: string }>,
): FrozenSourceAsset[] | null {
  const assetsById = new Map(rows.map((asset) => [String(asset.id), asset]));
  const ordered: FrozenSourceAsset[] = [];
  for (const reference of references) {
    const asset = assetsById.get(reference.assetId);
    if (!asset) return null;
    ordered.push(asset);
  }
  return ordered;
}

export class PrismaAiMediaWorkflowRepository implements AiMediaWorkflowRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createImageToImage(input: CreateAiMediaWorkflowInput) {
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const references = normalizeAiMediaWorkflowReferences(input);
      const assetRows = await tx.mediaAsset.findMany({
        where: {
          id: { in: references.map((reference) => reference.assetId) },
          ownerUserId: input.ownerUserId,
          kind: 'SOURCE_ORIGINAL',
        },
      }) as FrozenSourceAsset[];
      const assets = orderSourceAssets(assetRows, references);
      if (!assets) {
        throw Object.assign(new Error('Owned source asset not found'), { code: 'SOURCE_ASSET_NOT_FOUND' });
      }
      const primaryAsset = assets[0]!;
      if (assets.some((asset) => !/^[a-f0-9]{64}$/u.test(String(asset.sha256 || '')))) {
        throw Object.assign(new Error('Source asset has no immutable content hash'), { code: 'SOURCE_ASSET_INVALID' });
      }
      if (new Set(assets.map((asset) => asset.sha256)).size !== assets.length) {
        throw Object.assign(new Error('Source references must have unique content'), { code: 'SOURCE_ASSET_DUPLICATE' });
      }
      const context = await tx.supplyGoods.findFirst({
        where: { id: input.context.id, userId: input.ownerUserId },
        select: { id: true, sourceCaptureSubject: { select: {
          snapshots: { orderBy: [{ version: 'desc' }, { createdAt: 'desc' }], take: 1, select: { id: true } },
        } } },
      });
      const snapshotId = context?.sourceCaptureSubject?.snapshots[0]?.id;
      if (!context || assets.some((asset) => asset.sourceCaptureSnapshotId !== snapshotId)) {
        throw Object.assign(new Error('Source asset does not belong to the requested collect context'), {
          code: 'AI_MEDIA_CONTEXT_MISMATCH',
        });
      }
      const fingerprint = aiMediaPayloadHash({
        request: createAiMediaWorkflowFingerprint(input),
        ...(input.references
          ? { referenceAssetSha256: assets.map((asset) => asset.sha256) }
          : { sourceAssetSha256: primaryAsset.sha256 }),
      });
      const existing = await tx.aiMediaWorkflow.findUnique({
        where: { ai_media_workflow_owner_idempotency: {
          ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey,
        } },
        include: detailInclude,
      });
      if (existing) {
        const jobId = String(existing.jobs?.[existing.jobs.length - 1]?.id || '');
        return {
          kind: existing.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
          workflow: workflowRecord(existing), jobId,
        };
      }
      const workflow = await tx.aiMediaWorkflow.create({ data: {
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        operation: 'IMAGE_TO_IMAGE',
        status: 'QUEUED',
        reviewStatus: 'NOT_READY',
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        contextType: input.context.type,
        contextId: input.context.id,
        contextSkuKey: input.context.skuKey || null,
        contextSlotKey: input.context.slotKey || null,
      } });
      for (const [ordinal, asset] of assets.entries()) {
        await tx.aiMediaWorkflowInput.create({ data: {
          workflowId: workflow.id,
          ownerUserId: input.ownerUserId,
          assetId: asset.id,
          role: 'REFERENCE',
          ordinal,
          assetSha256: asset.sha256,
          assetUrl: asset.url,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        } });
      }
      const job = await tx.aiImageJob.create({ data: {
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        operation: 'IMAGE_TO_IMAGE',
        workflowId: workflow.id,
        workflowAttempt: 1,
        status: 'QUEUED',
        provider: AI_MEDIA_WORKFLOW_PROVIDER,
        model: AI_MEDIA_WORKFLOW_MODEL,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        requestedImageCount: input.count,
        width: input.width,
        height: input.height,
        maxAttempts: 1,
        idempotencyKey: `${input.idempotencyKey}:attempt:1`,
        requestFingerprint: fingerprint,
        inputAssets: assets.map((asset, ordinal) => ({
          assetId: asset.id,
          role: 'REFERENCE',
          ordinal,
          sha256: asset.sha256,
        })),
        estimatedCostCents: 0,
      } });
      await tx.aiMediaWorkflowEvent.create({ data: eventData({
        workflowId: workflow.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
        jobId: job.id, eventKey: `${workflow.id}:created`, eventType: 'CREATED',
        payload: { operation: 'IMAGE_TO_IMAGE', attempt: 1, referenceCount: assets.length },
      }) });
      const created = await tx.aiMediaWorkflow.findUnique({ where: { id: workflow.id }, include: detailInclude });
      return { kind: 'created' as const, workflow: workflowRecord(created), jobId: job.id };
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const references = normalizeAiMediaWorkflowReferences(input);
      const [assetRows, existing] = await Promise.all([
        (this.prisma as any).mediaAsset.findMany({
          where: {
            id: { in: references.map((reference) => reference.assetId) },
            ownerUserId: input.ownerUserId,
            kind: 'SOURCE_ORIGINAL',
          },
        }),
        (this.prisma as any).aiMediaWorkflow.findUnique({
          where: { ai_media_workflow_owner_idempotency: {
            ownerUserId: input.ownerUserId, idempotencyKey: input.idempotencyKey,
          } },
          include: detailInclude,
        }),
      ]);
      const assets = orderSourceAssets(assetRows as FrozenSourceAsset[], references);
      if (!assets || !existing) throw error;
      const primaryAsset = assets[0]!;
      const fingerprint = aiMediaPayloadHash({
        request: createAiMediaWorkflowFingerprint(input),
        ...(input.references
          ? { referenceAssetSha256: assets.map((asset) => asset.sha256) }
          : { sourceAssetSha256: primaryAsset.sha256 }),
      });
      const jobId = String(existing.jobs?.[existing.jobs.length - 1]?.id || '');
      return {
        kind: existing.requestFingerprint === fingerprint ? 'existing' as const : 'conflict' as const,
        workflow: workflowRecord(existing), jobId,
      };
    }
  }

  async listOwned(input: { ownerUserId: string; contextType?: string; contextId?: string; limit: number }) {
    const rows = await (this.prisma as any).aiMediaWorkflow.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        ...(input.contextType ? { contextType: input.contextType } : {}),
        ...(input.contextId ? { contextId: input.contextId } : {}),
      },
      include: {
        inputs: { include: { asset: true }, orderBy: { ordinal: 'asc' } },
        jobs: { include: { assets: true }, orderBy: { workflowAttempt: 'desc' }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
    });
    return rows.map(workflowRecord);
  }

  async getOwned(id: string, ownerUserId: string) {
    const row = await (this.prisma as any).aiMediaWorkflow.findFirst({
      where: { id, ownerUserId }, include: detailInclude,
    });
    return row ? workflowRecord(row) : null;
  }

  async cancelOwned(id: string, ownerUserId: string, actorUserId: string, expectedRevision: number) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const workflow = await tx.aiMediaWorkflow.findFirst({ where: { id, ownerUserId, revision: expectedRevision } });
      if (!workflow || !['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(workflow.status)) return null;
      if (workflow.status === 'CANCEL_REQUESTED') {
        return workflowRecord(await tx.aiMediaWorkflow.findUnique({ where: { id }, include: detailInclude }));
      }
      const active = await tx.aiImageJob.findFirst({ where: { workflowId: id, workflowAttempt: workflow.currentAttempt } });
      const submitted = Boolean(active?.providerJobId) || active?.status === 'RUNNING';
      const status = submitted ? 'CANCEL_REQUESTED' : 'CANCELLED';
      await tx.aiMediaWorkflow.update({ where: { id }, data: {
        status, revision: { increment: 1 }, cancelRequestedAt: new Date(),
        ...(status === 'CANCELLED' ? { completedAt: new Date() } : {}),
      } });
      if (active) await tx.aiImageJob.update({ where: { id: active.id }, data: { status } });
      await tx.aiMediaWorkflowEvent.create({ data: eventData({
        workflowId: id, ownerUserId, actorUserId, jobId: active?.id,
        eventKey: `${id}:cancel:${expectedRevision}`, eventType: status,
      }) });
      return workflowRecord(await tx.aiMediaWorkflow.findUnique({ where: { id }, include: detailInclude }));
    });
  }

  async retryOwned(input: { id: string; ownerUserId: string; actorUserId: string; expectedRevision: number; idempotencyKey: string }) {
    const eventKey = `${input.id}:retry:${input.idempotencyKey}`;
    try {
      return await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
        const replay = await tx.aiMediaWorkflowEvent.findUnique({ where: { eventKey } });
        if (replay) {
          const workflow = await tx.aiMediaWorkflow.findFirst({ where: { id: input.id, ownerUserId: input.ownerUserId }, include: detailInclude });
          const job = workflow?.jobs?.find((row: any) => row.id === replay.jobId);
          return workflow && job ? { workflow: workflowRecord(workflow), jobId: job.id, replayed: true } : null;
        }
        const workflow = await tx.aiMediaWorkflow.findFirst({ where: { id: input.id, ownerUserId: input.ownerUserId, revision: input.expectedRevision } });
        if (!workflow || workflow.status !== 'FAILED') return null;
        const previous = await tx.aiImageJob.findFirst({ where: { workflowId: input.id, workflowAttempt: workflow.currentAttempt } });
        if (!previous || previous.providerJobId) return null;
        const attempt = workflow.currentAttempt + 1;
        const job = await tx.aiImageJob.create({ data: {
          ownerUserId: previous.ownerUserId, actorUserId: input.actorUserId,
          operation: previous.operation, workflowId: input.id, workflowAttempt: attempt,
          status: 'QUEUED', provider: previous.provider, model: previous.model,
          prompt: previous.prompt, negativePrompt: previous.negativePrompt,
          resolvedPrompt: previous.resolvedPrompt, resolvedNegativePrompt: previous.resolvedNegativePrompt,
          templateKey: previous.templateKey, templateReleaseId: previous.templateReleaseId,
          templateChecksum: previous.templateChecksum, templateSnapshot: previous.templateSnapshot,
          requestFingerprint: previous.requestFingerprint, inputAssets: previous.inputAssets,
          requestedImageCount: previous.requestedImageCount, width: previous.width, height: previous.height,
          maxAttempts: 1, idempotencyKey: `${workflow.id}:attempt:${attempt}`, estimatedCostCents: 0,
        } });
        await tx.aiMediaWorkflow.update({ where: { id: input.id }, data: {
          status: 'QUEUED', reviewStatus: 'NOT_READY', selectedOutputAssetId: null,
          currentAttempt: attempt, revision: { increment: 1 }, completedAt: null,
        } });
        await tx.aiMediaWorkflowEvent.create({ data: eventData({
          workflowId: input.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
          jobId: job.id, eventKey, eventType: 'RETRY_REQUESTED', payload: { attempt },
        }) });
        const updated = await tx.aiMediaWorkflow.findUnique({ where: { id: input.id }, include: detailInclude });
        return { workflow: workflowRecord(updated), jobId: job.id, replayed: false };
      });
    } catch (error: any) {
      if (String(error?.code || '') !== 'P2002') throw error;
      const replay = await (this.prisma as any).aiMediaWorkflowEvent.findUnique({ where: { eventKey } });
      if (replay?.workflowId === input.id && replay.ownerUserId === input.ownerUserId) {
        const workflow = await (this.prisma as any).aiMediaWorkflow.findFirst({
          where: { id: input.id, ownerUserId: input.ownerUserId }, include: detailInclude,
        });
        const job = workflow?.jobs?.find((row: any) => row.id === replay.jobId);
        if (!workflow || !job) throw error;
        return { workflow: workflowRecord(workflow), jobId: job.id, replayed: true };
      }
      const current = await (this.prisma as any).aiMediaWorkflow.findFirst({
        where: { id: input.id, ownerUserId: input.ownerUserId },
        select: { revision: true, status: true },
      });
      if (!current || current.revision !== input.expectedRevision || current.status !== 'FAILED') return null;
      throw error;
    }
  }

  async reviewOwned(input: { id: string; ownerUserId: string; actorUserId: string; expectedRevision: number; outputAssetId: string; decision: 'APPROVE' | 'REJECT'; note: string | null }) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const workflow = await tx.aiMediaWorkflow.findFirst({ where: {
        id: input.id, ownerUserId: input.ownerUserId, revision: input.expectedRevision, status: 'SUCCEEDED', reviewStatus: 'PENDING',
      } });
      if (!workflow) return null;
      const output = await tx.mediaAsset.findFirst({ where: {
        id: input.outputAssetId, ownerUserId: input.ownerUserId,
        aiImageJob: { workflowId: input.id, status: 'SUCCEEDED' },
      } });
      if (!output) return null;
      const reviewStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.aiMediaWorkflow.update({ where: { id: input.id }, data: {
        reviewStatus, revision: { increment: 1 }, selectedOutputAssetId: output.id,
        reviewedByUserId: input.actorUserId, reviewedAt: new Date(),
      } });
      await tx.aiMediaWorkflowEvent.create({ data: eventData({
        workflowId: input.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
        assetId: output.id, eventKey: `${input.id}:review:${input.expectedRevision}`,
        eventType: input.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
        payload: { note: input.note },
      }) });
      return workflowRecord(await tx.aiMediaWorkflow.findUnique({ where: { id: input.id }, include: detailInclude }));
    });
  }
}
