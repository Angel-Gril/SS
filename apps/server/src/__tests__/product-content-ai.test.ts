import { describe, expect, it, vi } from 'vitest';
import {
  generateProductContentDraft,
  type ProductContentAiItem,
} from '../services/product-content-ai.js';
import type { AiTranslationCacheStore } from '../services/ai-translation-cache.js';
import type { AiUsageStore } from '../services/ai-usage.js';

function memoryCacheStore(): AiTranslationCacheStore {
  const records = new Map<string, any>();
  const keyOf = (params: any) => [
    params.namespace,
    params.sourceLang,
    params.targetLang,
    params.inputHash,
    params.promptHash,
    params.provider || '',
    params.model || '',
  ].join('|');
  return {
    async find(params) {
      return records.get(keyOf(params)) || null;
    },
    async upsert(record) {
      records.set(keyOf(record), record);
    },
    async markUsed(params, usedAt) {
      const record = records.get(keyOf(params));
      if (record) {
        record.lastUsedAt = usedAt;
        record.hitCount += 1;
      }
    },
  };
}

function memoryUsageStore(existing = 0): AiUsageStore {
  let fresh = existing;
  return {
    async getDailySummary() {
      return {
        requestCount: fresh,
        cacheHitCount: 0,
        failureCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
    },
    async record(event) {
      if (event.kind === 'request') fresh += 1;
    },
  };
}

const item: ProductContentAiItem = {
  id: 'item-1',
  title: '无痕聚拢文胸 厚杯',
  sourcePlatform: '1688',
  sourceProductId: '1688-1',
  metadata: {
    sourceTitleRaw: '无痕聚拢文胸 厚杯',
    categoryPath: ['内衣', '文胸'],
    attributes: [{ name: '面料', value: '锦纶' }],
    sourcePackagingRows: [{ size: '32AB 厚杯', weightG: 120 }],
  },
};

const config = {
  enabled: true,
  provider: 'custom' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret',
  model: 'deepseek-chat',
  providerLabel: 'DeepSeek',
  timeoutMs: 1000,
  titlePrompt: 'Generate Russian title',
  descriptionPrompt: 'Generate Russian description',
  userDailyProductGenerationLimit: 20,
};

describe('product content AI drafts', () => {
  it('returns a disabled response without provider calls when product generation is disabled', async () => {
    const generateText = vi.fn();
    const result = await generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title'],
      config: { ...config, enabled: false },
      cacheStore: memoryCacheStore(),
      usageStore: memoryUsageStore(),
      generateText,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('AI product generation disabled');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('generates reviewable title and description drafts and reuses cache without a second provider call', async () => {
    const cacheStore = memoryCacheStore();
    const usageStore = memoryUsageStore();
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: 'Бюстгальтер бесшовный с плотной чашкой', provider: 'custom', model: 'deepseek-chat', usage: { totalTokens: 30 } })
      .mockResolvedValueOnce({ ok: true, text: 'Бесшовный бюстгальтер для повседневной носки.', provider: 'custom', model: 'deepseek-chat', usage: { totalTokens: 40 } });

    const first = await generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title', 'description'],
      config,
      cacheStore,
      usageStore,
      generateText,
    });
    const second = await generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title', 'description'],
      config,
      cacheStore,
      usageStore,
      generateText,
    });

    expect(first.ok).toBe(true);
    expect(first.drafts.title?.text).toBe('Бюстгальтер бесшовный с плотной чашкой');
    expect(first.drafts.description?.text).toContain('Бесшовный');
    expect(first.drafts.title?.source).toBe('provider');
    expect(second.drafts.title?.source).toBe('cache');
    expect(second.drafts.description?.source).toBe('cache');
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('parses constrained Ozon localization JSON into review metadata', async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          title: 'Женские трусы с высокой посадкой, хлопок',
          searchTags: ['женские трусы', 'нижнее белье'],
          warnings: ['Антибактериальный эффект не подтвержден источником'],
          confidence: 0.78,
        }),
        provider: 'custom',
        model: 'deepseek-chat',
        usage: { totalTokens: 120 },
      })
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          description: 'Женские трусы для повседневной носки. Мягкая ткань и высокая посадка подходят для дома и на каждый день.',
          bulletPoints: ['Высокая посадка', 'Материал из источника: хлопок', 'Подходит для повседневной носки'],
          searchTags: ['женское белье', 'трусы женские хлопок'],
          warnings: ['Размерная сетка требует проверки'],
          confidence: 0.81,
        }),
        provider: 'custom',
        model: 'deepseek-chat',
        usage: { totalTokens: 180 },
      });

    const result = await generateProductContentDraft({
      item: {
        ...item,
        title: '【马年直播专供】8215#萌熊贺岁10A抗菌加长底裆本命必备红内裤女',
        metadata: {
          sourceTitleRaw: '【马年直播专供】8215#萌熊贺岁10A抗菌加长底裆本命必备红内裤女',
          categoryPath: ['服饰内衣', '女士内衣', '内裤'],
          sourceStandardAttributes: {
            colors: ['红色'],
            materials: ['棉'],
            gender: { value: 'female' },
          },
        },
      },
      actorUserId: 'user-1',
      fields: ['title', 'description'],
      config,
      cacheStore: memoryCacheStore(),
      usageStore: memoryUsageStore(),
      generateText,
    });

    expect(result.ok).toBe(true);
    expect(result.drafts.title?.text).toBe('Женские трусы с высокой посадкой, хлопок');
    expect(result.drafts.title?.structured).toMatchObject({
      searchTags: ['женские трусы', 'нижнее белье'],
      warnings: ['Антибактериальный эффект не подтвержден источником'],
      confidence: 0.78,
    });
    expect(result.drafts.description?.structured).toMatchObject({
      bulletPoints: ['Высокая посадка', 'Материал из источника: хлопок', 'Подходит для повседневной носки'],
      searchTags: ['женское белье', 'трусы женские хлопок'],
      warnings: ['Размерная сетка требует проверки'],
      confidence: 0.81,
    });

    const titleSystemMessage = generateText.mock.calls[0]?.[0]?.messages.find((message: { role: string; content: string }) => message.role === 'system')?.content || '';
    expect(titleSystemMessage).toContain('Ozon localization contract');
    expect(titleSystemMessage).toContain('Start the title with the concrete Russian product type');
    expect(titleSystemMessage).toContain('Do not literally translate livestream, factory, wholesale, hot-sale, SKU noise, or holiday slogans');
  });

  it('routes product copy fields to field-specific models and parses rich content blocks', async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          title: 'Женские трусы из хлопка, высокая посадка',
          searchTags: ['женские трусы', 'трусы хлопок'],
          confidence: 0.84,
        }),
        provider: 'custom',
        model: 'fast-title-model',
        usage: { totalTokens: 90 },
      })
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          description: 'Женские трусы из мягкого хлопка для повседневной носки.',
          bulletPoints: ['Мягкий хлопок', 'Высокая посадка'],
          richContentBlocks: [
            'Женские трусы для ежедневного использования.',
            'Мягкий хлопковый материал комфортен для дома и на каждый день.',
          ],
          searchTags: ['женское белье', 'нижнее белье'],
          confidence: 0.86,
        }),
        provider: 'custom',
        model: 'strong-copy-model',
        usage: { totalTokens: 220 },
      });

    const result = await generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title', 'description'],
      config: {
        ...config,
        model: 'base-model',
        titleModel: 'fast-title-model',
        descriptionModel: 'strong-copy-model',
      } as any,
      cacheStore: memoryCacheStore(),
      usageStore: memoryUsageStore(),
      generateText,
    });

    expect(result.ok).toBe(true);
    expect(generateText).toHaveBeenNthCalledWith(1, expect.objectContaining({
      config: expect.objectContaining({ model: 'fast-title-model' }),
    }));
    expect(generateText).toHaveBeenNthCalledWith(2, expect.objectContaining({
      config: expect.objectContaining({ model: 'strong-copy-model' }),
    }));
    expect((result.drafts.description?.structured as any)?.richContentBlocks).toEqual([
      'Женские трусы для ежедневного использования.',
      'Мягкий хлопковый материал комфортен для дома и на каждый день.',
    ]);
    const descriptionSystemMessage = generateText.mock.calls[1]?.[0]?.messages.find((message: { role: string; content: string }) => message.role === 'system')?.content || '';
    expect(descriptionSystemMessage).toContain('richContentBlocks');
  });

  it('rejects unsafe generated titles before caching them', async () => {
    const cacheStore = memoryCacheStore();
    const usageStore = memoryUsageStore();
    const recordSpy = vi.spyOn(usageStore, 'record');
    const generateText = vi.fn().mockResolvedValue({
      ok: true,
      text: '无痕聚拢文胸',
      provider: 'custom',
      model: 'deepseek-chat',
      usage: null,
    });

    await expect(generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title'],
      config,
      cacheStore,
      usageStore,
      generateText,
    })).resolves.toMatchObject({
      ok: false,
      error: 'Generated title is unsafe for Ozon',
    });

    const retry = await generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title'],
      config,
      cacheStore,
      usageStore,
      generateText,
    });
    expect(retry.ok).toBe(false);
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'failure' }));
  });

  it('rejects source-platform and wholesale noise in generated titles', async () => {
    const generateText = vi.fn().mockResolvedValue({
      ok: true,
      text: 'Женские трусы 1688 оптом от поставщика',
      provider: 'custom',
      model: 'deepseek-chat',
      usage: null,
    });

    await expect(generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title'],
      config,
      cacheStore: memoryCacheStore(),
      usageStore: memoryUsageStore(),
      generateText,
    })).resolves.toMatchObject({
      ok: false,
      error: 'Generated title is unsafe for Ozon',
    });
  });

  it('blocks fresh provider calls after the user daily limit is reached', async () => {
    const generateText = vi.fn();
    const result = await generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title'],
      config: { ...config, userDailyProductGenerationLimit: 1 },
      cacheStore: memoryCacheStore(),
      usageStore: memoryUsageStore(1),
      generateText,
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'AI product generation daily limit reached',
    });
    expect(generateText).not.toHaveBeenCalled();
  });
  it('allocates enough output tokens for reasoning-capable product models', async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: 'Женская ночная сорочка на бретелях', provider: 'custom', model: 'deepseek-v4-flash', usage: { totalTokens: 240 } })
      .mockResolvedValueOnce({ ok: true, text: 'Женская ночная сорочка на бретелях из мягкой сетки для сна и дома.', provider: 'custom', model: 'deepseek-v4-flash', usage: { totalTokens: 620 } });

    await generateProductContentDraft({
      item,
      actorUserId: 'user-1',
      fields: ['title', 'description'],
      config: { ...config, model: 'deepseek-v4-flash' },
      cacheStore: memoryCacheStore(),
      usageStore: memoryUsageStore(),
      generateText,
    });

    expect(generateText).toHaveBeenNthCalledWith(1, expect.objectContaining({ maxTokens: 600 }));
    expect(generateText).toHaveBeenNthCalledWith(2, expect.objectContaining({ maxTokens: 1800 }));
  });
  it('includes cleaned source description and rich text in product generation input', async () => {
    const generateText = vi.fn().mockResolvedValue({
      ok: true,
      text: 'Бюстгальтер без косточек с тонкими бретелями и открытой спиной.',
      provider: 'custom',
      model: 'deepseek-chat',
      usage: { totalTokens: 80 },
    });

    await generateProductContentDraft({
      item: {
        ...item,
        metadata: {
          sourceTitleRaw: '闪钻细肩带美背内衣无痕无钢圈小胸聚拢显大露背文胸',
          sourceDescriptionRaw: '<div>无钢圈设计，细肩带，美背交叉。<img src="https://img.example.com/detail.jpg"/>适合日常穿搭。</div>',
          sourceRichContentDraft: {
            blocks: [
              { type: 'image', url: 'https://img.example.com/detail.jpg' },
              { type: 'text', text: '<p>可拆卸胸垫，轻薄透气，不勒肩。</p>' },
            ],
          },
        },
      },
      actorUserId: 'user-1',
      fields: ['description'],
      config,
      cacheStore: memoryCacheStore(),
      usageStore: memoryUsageStore(),
      generateText,
    });

    const call = generateText.mock.calls[0]?.[0];
    const systemMessage = call?.messages.find((message: { role: string; content: string }) => message.role === 'system')?.content || '';
    const userMessage = call?.messages.find((message: { role: string; content: string }) => message.role === 'user')?.content || '{}';
    const payload = JSON.parse(userMessage);

    expect(systemMessage).toContain('Use only facts present in the source JSON');
    expect(payload.sourceProfile).toMatchObject({
      sourceTitle: '闪钻细肩带美背内衣无痕无钢圈小胸聚拢显大露背文胸',
      productIntentTerms: expect.arrayContaining(['bra', 'underwear']),
      packaging: expect.objectContaining({ status: 'missing' }),
    });
    expect(payload.sourceProfile.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.description).toContain('无钢圈设计');
    expect(payload.description).toContain('适合日常穿搭');
    expect(payload.richContentSummary).toContain('可拆卸胸垫');
    expect(JSON.stringify(payload)).not.toContain('<img');
    expect(JSON.stringify(payload)).not.toContain('https://img.example.com');
  });
});
