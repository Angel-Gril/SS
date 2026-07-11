import type { PrismaClient } from '@prisma/client';
import type { AiImageAssetInput, AiImageJobRecord, AiImageJobRepository, ApplyAiImageJobInput, CreateAiImageJobInput, CreateWithQuotaResult } from '../services/ai-image-jobs.js';

const record = (row: any): AiImageJobRecord => ({ ...row, estimatedCostCents: Number(row.estimatedCostCents || 0), actualCostCents: row.actualCostCents == null ? null : Number(row.actualCostCents), billedUnits: Number(row.billedUnits || 0) });

export class PrismaAiImageJobRepository implements AiImageJobRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async getById(id: string) {
    const row = await (this.prisma as any).aiImageJob.findUnique({ where: { id }, include: { assets: true } });
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
        const created = await tx.aiImageJob.create({ data: { ownerUserId: input.ownerUserId, actorUserId: input.actorUserId, status: 'QUEUED', provider: input.provider, model: input.model, prompt: input.prompt, negativePrompt: input.negativePrompt || null, requestedImageCount: input.count, width: input.width, height: input.height, idempotencyKey: input.idempotencyKey, estimatedCostCents: input.estimatedCostCents } });
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
    const result = await (this.prisma as any).aiImageJob.updateMany({ where: { id, status: { in: ['PENDING', 'QUEUED', 'RETRYING'] } }, data: { status: 'RUNNING', attemptCount, progress: 10, startedAt: new Date(), errorCode: null, errorMessage: null } });
    return result.count === 1;
  }
  async markRetrying(id: string, data: any) { await (this.prisma as any).aiImageJob.update({ where: { id }, data: { status: 'RETRYING', progress: 0, ...data } }); }
  async recordProviderJobId(id: string, providerJobId: string) { await (this.prisma as any).aiImageJob.update({ where: { id }, data: { providerJobId } }); }
  async markFailed(id: string, data: any) { await (this.prisma as any).aiImageJob.update({ where: { id }, data: { status: 'FAILED', progress: 0, billedUnits: 0, completedAt: new Date(), ...data } }); }
  async markCancelled(id: string) { await (this.prisma as any).aiImageJob.update({ where: { id }, data: { status: 'CANCELLED', progress: 0, billedUnits: 0, completedAt: new Date() } }); }
  async complete(id: string, data: { providerJobId: string | null; actualCostCents: number; billedUnits: number; assets: AiImageAssetInput[] }) {
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.mediaAsset.createMany({ data: data.assets.map((asset) => ({ ownerUserId: asset.ownerUserId, aiImageJobId: asset.jobId, kind: 'AI_GENERATED', url: asset.url, storageBackend: asset.storageBackend, storageKey: asset.storageKey, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes })) });
      await tx.aiImageJob.update({ where: { id }, data: { status: 'SUCCEEDED', progress: 100, providerJobId: data.providerJobId, actualCostCents: data.actualCostCents, billedUnits: data.billedUnits, completedAt: new Date(), errorCode: null, errorMessage: null } });
    });
  }
  async requestCancellation(id: string, ownerUserId: string) {
    const result = await (this.prisma as any).aiImageJob.updateMany({ where: { id, ownerUserId, status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] } }, data: { status: 'CANCEL_REQUESTED' } });
    return result.count ? this.getById(id) : null;
  }
  async recordApplication(id: string, data: ApplyAiImageJobInput) {
    return record(await (this.prisma as any).aiImageJob.update({ where: { id }, data: { appliedMode: data.mode, applyTargetType: data.targetType, applyTargetId: data.targetId, appliedAt: new Date() }, include: { assets: true } }));
  }
}
