import { describe, expect, it, vi } from 'vitest';
import {
  assertAiDailyLimit,
  createPrismaAiUsageStore,
  normalizeAiUsageDate,
  recordAiUsageEvent,
  type PrismaAiUsageClient,
} from '../services/ai-usage.js';

describe('AI usage controls', () => {
  it('normalizes usage dates to UTC day keys', () => {
    expect(normalizeAiUsageDate(new Date('2026-06-25T23:59:59.000Z'))).toBe('2026-06-25');
  });

  it('allows cache hits when fresh provider calls are over the daily limit', async () => {
    const store = {
      getDailySummary: vi.fn(async () => ({
        requestCount: 20,
        cacheHitCount: 4,
        failureCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      })),
      record: vi.fn(),
    };

    await expect(assertAiDailyLimit({
      store,
      namespace: 'product_title',
      actorUserId: 'user-1',
      limit: 20,
      cacheHit: true,
    })).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(assertAiDailyLimit({
      store,
      namespace: 'product_title',
      actorUserId: 'user-1',
      limit: 20,
      cacheHit: false,
    })).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it('records request, cache hit, and failure counters through the store', async () => {
    const store = {
      getDailySummary: vi.fn(),
      record: vi.fn(async () => undefined),
    };

    await recordAiUsageEvent(store, {
      namespace: 'product_title',
      provider: 'custom',
      model: 'deepseek-chat',
      actorUserId: 'user-1',
      kind: 'request',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    await recordAiUsageEvent(store, {
      namespace: 'product_title',
      provider: 'custom',
      model: 'deepseek-chat',
      actorUserId: 'user-1',
      kind: 'cache_hit',
    });
    await recordAiUsageEvent(store, {
      namespace: 'product_title',
      provider: 'custom',
      model: 'deepseek-chat',
      actorUserId: 'user-1',
      kind: 'failure',
    });

    expect(store.record).toHaveBeenCalledTimes(3);
    expect(store.record).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: 'request',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    }));
    expect(store.record).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'cache_hit' }));
    expect(store.record).toHaveBeenNthCalledWith(3, expect.objectContaining({ kind: 'failure' }));
  });

  it('creates a Prisma-backed store using daily aggregate upserts', async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [{
        requestCount: 2,
        cacheHitCount: 1,
        failureCount: 0,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      }]),
      $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        expect(String(values[0])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        return 1;
      }),
    };
    const store = createPrismaAiUsageStore(prisma as unknown as PrismaAiUsageClient);

    const summary = await store.getDailySummary({
      namespace: 'product_title',
      actorUserId: 'user-1',
      date: '2026-06-25',
    });
    await store.record({
      namespace: 'product_title',
      provider: 'custom',
      model: 'deepseek-chat',
      actorUserId: 'user-1',
      date: '2026-06-25',
      kind: 'request',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });

    expect(summary.requestCount).toBe(2);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
