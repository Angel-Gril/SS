import type { PrismaClient } from '@prisma/client';
import type { AiImageAssetInput, AiImageJobRecord, AiImageJobRepository, ApplyAiImageJobInput, CreateAiImageJobInput, CreateWithQuotaResult } from '../services/ai-image-jobs.js';
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
    }))
    : row.inputAssets,
  estimatedCostCents: Number(row.estimatedCostCents || 0),
  actualCostCents: row.actualCostCents == null ? null : Number(row.actualCostCents),
  billedUnits: Number(row.billedUnits || 0),
});

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

export class PrismaAiImageJobRepository implements AiImageJobRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async getById(id: string) {
    const row = await (this.prisma as any).aiImageJob.findUnique({
      where: { id },
      include: { assets: true, workflow: { include: { inputs: { orderBy: { ordinal: 'asc' } } } } },
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
    await (this.prisma as any).aiImageJob.updateMany({
      where: { id, status: 'RUNNING' }, data: { status: 'RETRYING', progress: 0, ...data },
    });
  }
  async recordProviderJobId(id: string, providerJobId: string) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job || !['RUNNING', 'CANCEL_REQUESTED'].includes(job.status)) return;
      const updated = await tx.aiImageJob.updateMany({
        where: { id, status: { in: ['RUNNING', 'CANCEL_REQUESTED'] }, providerJobId: null }, data: { providerJobId },
      });
      if (updated.count === 1) await appendWorkflowEvent(tx, job, 'PROVIDER_SUBMITTED', { providerJobId });
    });
  }
  async markFailed(id: string, data: any) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job) return;
      if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
        await this.markCancelledInTransaction(tx, job);
        return;
      }
      const changed = await tx.aiImageJob.updateMany({
        where: { id, status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } },
        data: { status: 'FAILED', progress: 0, billedUnits: 0, completedAt: new Date(), ...data },
      });
      if (changed.count !== 1 || !job.workflowId) return;
      const parent = await tx.aiMediaWorkflow.updateMany({
        where: { id: job.workflowId, ownerUserId: job.ownerUserId, currentAttempt: job.workflowAttempt, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status: 'FAILED', reviewStatus: 'NOT_READY', completedAt: new Date(), revision: { increment: 1 } },
      });
      if (parent.count !== 1) throw new Error('AI media workflow failure CAS failed');
      await appendWorkflowEvent(tx, { ...job, attemptCount: data.attemptCount }, 'JOB_FAILED', { errorCode: data.errorCode });
    });
  }
  async markCancelled(id: string) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (job) await this.markCancelledInTransaction(tx, job);
    });
  }
  async complete(id: string, data: { providerJobId: string | null; actualCostCents: number; billedUnits: number; assets: AiImageAssetInput[] }) {
    await runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const job = await tx.aiImageJob.findUnique({ where: { id } });
      if (!job) return;
      if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
        await this.markCancelledInTransaction(tx, job);
        return;
      }
      if (job.providerJobId && data.providerJobId && job.providerJobId !== data.providerJobId) {
        throw Object.assign(new Error('Provider job ID does not match the persisted recovery identity'), {
          code: 'PROVIDER_JOB_ID_MISMATCH',
        });
      }
      const providerJobId = job.providerJobId || data.providerJobId;
      const completed = await tx.aiImageJob.updateMany({
        where: { id, status: 'RUNNING' },
        data: { status: 'SUCCEEDED', progress: 100, providerJobId, actualCostCents: data.actualCostCents, billedUnits: data.billedUnits, completedAt: new Date(), errorCode: null, errorMessage: null },
      });
      if (completed.count !== 1) return;
      const outputs = [];
      for (const asset of data.assets) {
        outputs.push(await tx.mediaAsset.create({ data: { ownerUserId: asset.ownerUserId, aiImageJobId: asset.jobId, kind: 'AI_GENERATED', url: asset.url, storageBackend: asset.storageBackend, storageKey: asset.storageKey, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, sha256: asset.sha256 } }));
      }
      if (job.workflowId) {
        const inputs = await tx.aiMediaWorkflowInput.findMany({ where: { workflowId: job.workflowId }, orderBy: { ordinal: 'asc' } });
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
    });
  }
  async requestCancellation(id: string, ownerUserId: string) {
    const result = await (this.prisma as any).aiImageJob.updateMany({ where: { id, ownerUserId, status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } }, data: { status: 'CANCEL_REQUESTED' } });
    return result.count ? this.getById(id) : null;
  }
  async recordApplication(id: string, data: ApplyAiImageJobInput) {
    return record(await (this.prisma as any).aiImageJob.update({ where: { id }, data: { appliedMode: data.mode, applyTargetType: data.targetType, applyTargetId: data.targetId, appliedAt: new Date() }, include: { assets: true } }));
  }

  private async markCancelledInTransaction(tx: any, job: any) {
    if (job.status === 'CANCEL_REQUESTED') {
      await tx.aiImageJob.updateMany({
        where: { id: job.id, status: 'CANCEL_REQUESTED' },
        data: { status: 'CANCELLED', progress: 0, billedUnits: 0, completedAt: new Date() },
      });
    } else if (job.status !== 'CANCELLED') return;
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
