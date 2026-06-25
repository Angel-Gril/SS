import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaAiTranslationCacheStore,
  getCachedAiTranslation,
  type AiTranslationCacheRecord,
  type PrismaAiTranslationCacheClient,
} from '../services/ai-translation-cache.js';

describe('AI translation cache', () => {
  it('returns cached approved category translations without calling the provider', async () => {
    const now = new Date('2026-06-25T00:00:00.000Z');
    const cached: AiTranslationCacheRecord = {
      namespace: 'category_term',
      sourceLang: 'ru',
      targetLang: 'zh-CN',
      inputHash: 'hash',
      inputText: 'Белье',
      outputText: '内衣',
      promptHash: 'prompt',
      provider: 'system',
      model: 'glossary',
      status: 'approved',
      usage: null,
      expiresAt: null,
      lastUsedAt: now,
      hitCount: 3,
      source: 'system_glossary',
    };
    const store = {
      find: vi.fn(async () => cached),
      upsert: vi.fn(),
      markUsed: vi.fn(),
    };
    const provider = vi.fn();

    const result = await getCachedAiTranslation({
      namespace: 'category_term',
      sourceLang: 'ru',
      targetLang: 'zh-CN',
      inputText: 'Белье',
      promptHash: 'prompt',
      provider: 'custom',
      model: 'deepseek-chat',
      now: () => now,
      store,
      translate: provider,
    });

    expect(result).toMatchObject({ source: 'cache', outputText: '内衣', status: 'approved' });
    expect(provider).not.toHaveBeenCalled();
    expect(store.markUsed).toHaveBeenCalledTimes(1);
  });

  it('uses prompt hash to isolate product generation cache entries', async () => {
    const rows: any[] = [];
    const executeRaw = vi.fn(async () => 1);
    const prisma = {
      $queryRaw: vi.fn(async () => rows),
      $executeRaw: executeRaw,
    } as unknown as PrismaAiTranslationCacheClient;
    const store = createPrismaAiTranslationCacheStore(prisma);

    await store.upsert({
      namespace: 'product_title',
      sourceLang: 'zh-CN',
      targetLang: 'ru',
      inputHash: 'same-input',
      inputText: '女士文胸',
      outputText: 'Бюстгальтер женский',
      promptHash: 'prompt-v1',
      provider: 'custom',
      model: 'deepseek-chat',
      status: 'success',
      usage: { totalTokens: 20 },
      expiresAt: new Date('2026-07-25T00:00:00.000Z'),
      lastUsedAt: new Date('2026-06-25T00:00:00.000Z'),
      hitCount: 0,
      source: 'ai',
    });

    await store.upsert({
      namespace: 'product_title',
      sourceLang: 'zh-CN',
      targetLang: 'ru',
      inputHash: 'same-input',
      inputText: '女士文胸',
      outputText: 'Женский бюстгальтер',
      promptHash: 'prompt-v2',
      provider: 'custom',
      model: 'deepseek-chat',
      status: 'success',
      usage: { totalTokens: 22 },
      expiresAt: new Date('2026-07-25T00:00:00.000Z'),
      lastUsedAt: new Date('2026-06-25T00:00:00.000Z'),
      hitCount: 0,
      source: 'ai',
    });

    const firstSql = String((executeRaw.mock.calls as any[])[0]?.[0]);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(firstSql).toContain('ON CONFLICT');
    expect(firstSql).toContain('prompt_hash');
  });
});
