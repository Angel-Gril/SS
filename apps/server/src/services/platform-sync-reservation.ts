import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

type SyncType = 'ORDER_PULL' | 'PRODUCT_PULL';
export interface ReadSyncOptions { syncJobId?: string; jobId?: string; delayMs?: number; automaticIntervalMs?: number }
export function readSyncPayload(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** Shared by manual, notification, publish-follow-up and automatic enqueue paths. */
export async function reservePlatformSync(input: { shopId: string; type: SyncType; payload: Record<string, unknown>; options?: ReadSyncOptions; automaticIntervalMs?: number }) {
  const options = input.options ?? {}, now = new Date();
  const delayMs = Math.min(86400000, Math.max(0, options.delayMs ?? 0));
  const interval = options.automaticIntervalMs ?? input.automaticIntervalMs;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-sync:${input.shopId}:${input.type}`}, 0))`;
    const shop = await tx.shop.findFirst({ where: { id: input.shopId, status: 'ACTIVE', platform: { in: ['OZON', 'YANDEX'] }, user: { status: 'ACTIVE' } }, select: { id: true } });
    if (!shop) throw new Error('店铺已停用、账户异常或平台不支持同步');
    const pending = await tx.syncJob.findMany({ where: { shopId: input.shopId, type: input.type, status: { in: ['PENDING', 'RUNNING'] } }, orderBy: { createdAt: 'asc' }, take: 100 });
    if (pending.length >= 100) throw new Error('店铺未完成的同步任务过多，请先核对任务');
    const existing = pending.find(job => {
      const payload = readSyncPayload(job.payload);
      if (options.syncJobId) return job.id === options.syncJobId;
      if (delayMs > 0) return !!options.jobId && payload.syncCoalescingKey === options.jobId;
      return job.status === 'RUNNING' || !payload.syncNotBefore || Date.parse(String(payload.syncNotBefore)) <= now.getTime();
    });
    if (existing) return { row: existing, dispatch: existing.status === 'PENDING', reused: true };
    if (options.syncJobId) throw new Error('原同步任务不存在或已结束');
    if (interval !== undefined) {
      if (!Number.isInteger(interval) || interval < 300000 || interval > 86400000) throw new Error('自动同步间隔无效');
      const recent = await tx.syncJob.findFirst({ where: { shopId: input.shopId, type: input.type, status: { in: ['SUCCESS', 'FAILED'] }, OR: [{ finishedAt: { gt: new Date(now.getTime() - interval) } }, { createdAt: { gt: new Date(now.getTime() - interval) } }] }, orderBy: { createdAt: 'desc' } });
      if (recent) return { row: recent, dispatch: false, reused: true };
    }
    const payload = { ...input.payload, ...(delayMs ? { syncNotBefore: new Date(now.getTime() + delayMs).toISOString() } : {}), ...(options.jobId ? { syncCoalescingKey: options.jobId } : {}) };
    const row = await tx.syncJob.create({ data: { shopId: input.shopId, type: input.type, status: 'PENDING', payload: payload as Prisma.InputJsonValue } });
    return { row, dispatch: true, reused: false };
  });
}

/** Delayed follow-ups may coexist in the queue, but cannot run on top of another read. */
export async function startPlatformSyncRun(syncJobId: string, shopId: string, type: SyncType) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-sync:${shopId}:${type}`}, 0))`;
    const current = await tx.syncJob.findFirst({ where: { id: syncJobId, shopId, type, shop: { status: 'ACTIVE', platform: { in: ['OZON', 'YANDEX'] }, user: { status: 'ACTIVE' } } } });
    if (!current) throw new Error('同步任务或店铺状态已变化');
    if (current.status === 'SUCCESS') return false;
    const other = await tx.syncJob.findFirst({ where: { shopId, type, status: 'RUNNING', id: { not: syncJobId } }, select: { id: true } });
    if (other) throw new Error('店铺上一条同步仍在运行，稍后核对');
    await tx.syncJob.update({ where: { id: syncJobId }, data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null } });
    return true;
  });
}
