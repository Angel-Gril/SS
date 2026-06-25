import { createHash } from 'crypto';
import type { AiTextConfig, AiTextResult, AiTextUsage } from './ai-text.js';
import {
  getCachedAiTranslation,
  type AiTranslationCacheStore,
} from './ai-translation-cache.js';
import {
  assertAiDailyLimit,
  normalizeAiUsageDate,
  recordAiUsageEvent,
  type AiUsageStore,
} from './ai-usage.js';

export type ProductContentField = 'title' | 'description';

export interface ProductContentAiItem {
  id: string;
  title?: string | null;
  sourcePlatform?: string | null;
  sourceProductId?: string | null;
  sku?: string | null;
  metadata?: unknown;
  variants?: unknown;
}

export interface ProductContentAiConfig extends AiTextConfig {
  enabled: boolean;
  titlePrompt: string;
  descriptionPrompt: string;
  userDailyProductGenerationLimit: number;
}

export interface ProductContentDraft {
  text: string;
  source: 'cache' | 'provider';
  provider: string;
  model: string;
  promptHash: string;
  generatedAt: string;
  usage: AiTextUsage | null;
}

export type ProductContentDraftResult = {
  ok: true;
  drafts: Partial<Record<ProductContentField, ProductContentDraft>>;
  limit: { used: number; remaining: number; limit: number };
} | {
  ok: false;
  error: string;
  drafts: Partial<Record<ProductContentField, ProductContentDraft>>;
  limit?: { used: number; remaining: number; limit: number };
};

type GenerateText = (params: {
  config: AiTextConfig;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<AiTextResult>;

export interface GenerateProductContentDraftParams {
  item: ProductContentAiItem;
  actorUserId: string;
  fields: ProductContentField[];
  config: ProductContentAiConfig;
  cacheStore: AiTranslationCacheStore;
  usageStore: AiUsageStore;
  generateText: GenerateText;
  now?: () => Date;
}

const CJK_RE = /[\u3400-\u9fff]/;
const CYRILLIC_RE = /[А-Яа-яЁё]/;
const PRODUCT_COPYWRITING_GUARDRAIL = [
  'You are generating Russian Ozon product copy for marketplace buyers.',
  'Use only facts present in the source JSON. Do not invent materials, cup type, effects, age range, brand, certification, discounts, shipping, or guarantees.',
  'Prefer natural Russian retail wording over literal machine translation.',
  'Do not mention 1688, wholesale, supplier, JSON, SKU internals, or source-system fields.',
  'Return only the requested Russian output, with no markdown and no explanation.',
].join(' ');

function cleanText(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanSourceCopy(value: unknown, maxLength = 1200): string {
  let text = String(value || '').normalize('NFKC');
  if (!text) return '';
  text = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img\b[^>]*\balt=["']?([^"'>\s][^"'>]*)["']?[^>]*>/gi, ' $1 ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\/\/\S+/g, ' ')
    .replace(/\b[\w.-]+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?/gi, ' ');
  text = cleanText(decodeBasicHtmlEntities(text));
  return text.slice(0, maxLength);
}

function summarizeRichContentDraft(value: unknown): string {
  const draft = metadataRecord(value);
  const blocks = Array.isArray(draft.blocks) ? draft.blocks : [];
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const record = metadataRecord(block);
    const raw = record.text ?? record.content ?? record.description ?? record.title ?? record.value;
    const text = cleanSourceCopy(raw, 400);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    parts.push(text);
    if (parts.join(' ').length >= 1200) break;
  }
  return parts.join(' ').slice(0, 1200);
}

function buildEffectivePrompt(prompt: string): string {
  return `${PRODUCT_COPYWRITING_GUARDRAIL}\n\n${prompt}`.trim();
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

function buildProductContentInput(item: ProductContentAiItem, field: ProductContentField): string {
  const meta = metadataRecord(item.metadata);
  const payload = {
    field,
    sourceTitle: cleanText(meta.sourceTitleRaw || item.title),
    sourceCategory: Array.isArray(meta.categoryPath) ? meta.categoryPath.map(cleanText).filter(Boolean).join(' / ') : cleanText(meta.categoryName),
    attributes: meta.attributes || meta.sourceAttributes || null,
    standardAttributes: meta.standardAttributes || null,
    selectedSku: meta.selectedSku || null,
    variants: item.variants || meta.variants || null,
    packaging: meta.sourcePackagingRows || null,
    description: cleanSourceCopy(meta.description || meta.sourceDescription || meta.sourceDescriptionRaw || ''),
    richContentSummary: summarizeRichContentDraft(meta.sourceRichContentDraft) || cleanSourceCopy(meta.sourceRichContentDraftSummary || ''),
  };
  return JSON.stringify(payload);
}

function validateGeneratedText(field: ProductContentField, text: string): string | null {
  if (!text) return field === 'title' ? 'Generated title is unsafe for Ozon' : 'Generated description is unsafe for Ozon';
  if (field === 'title') {
    if (text.length < 5 || text.length > 200 || CJK_RE.test(text) || !CYRILLIC_RE.test(text)) {
      return 'Generated title is unsafe for Ozon';
    }
  }
  if (field === 'description') {
    if (text.length < 10 || text.length > 5000 || (CJK_RE.test(text) && !CYRILLIC_RE.test(text))) {
      return 'Generated description is unsafe for Ozon';
    }
  }
  return null;
}

function namespaceForField(field: ProductContentField): string {
  return field === 'title' ? 'product_title' : 'product_description';
}

function promptForField(config: ProductContentAiConfig, field: ProductContentField): string {
  return field === 'title' ? config.titlePrompt : config.descriptionPrompt;
}

export async function generateProductContentDraft(params: GenerateProductContentDraftParams): Promise<ProductContentDraftResult> {
  const drafts: Partial<Record<ProductContentField, ProductContentDraft>> = {};
  if (!params.config.enabled) return { ok: false, error: 'AI product generation disabled', drafts };
  if (params.config.provider !== 'custom' || !params.config.baseUrl || !params.config.apiKey || !params.config.model) {
    return { ok: false, error: 'AI provider config incomplete', drafts };
  }

  const now = params.now?.() || new Date();
  const date = normalizeAiUsageDate(now);
  let latestLimit = { used: 0, remaining: 0, limit: Math.max(0, Math.trunc(Number(params.config.userDailyProductGenerationLimit) || 0)) };

  for (const field of params.fields) {
    const prompt = promptForField(params.config, field).trim();
    if (!prompt) return { ok: false, error: `AI ${field} prompt is empty`, drafts, limit: latestLimit };
    const namespace = namespaceForField(field);
    const inputText = buildProductContentInput(params.item, field);
    const effectivePrompt = buildEffectivePrompt(prompt);
    const hash = promptHash(effectivePrompt);

    try {
      const cached = await getCachedAiTranslation({
        namespace,
        sourceLang: 'zh-CN',
        targetLang: 'ru',
        inputText,
        promptHash: hash,
        provider: params.config.provider,
        model: params.config.model,
        store: params.cacheStore,
        now: () => now,
        translate: async () => {
          const limit = await assertAiDailyLimit({
            store: params.usageStore,
            namespace,
            actorUserId: params.actorUserId,
            limit: params.config.userDailyProductGenerationLimit,
            cacheHit: false,
            date,
          });
          latestLimit = { used: limit.used, remaining: limit.remaining, limit: limit.limit };
          if (!limit.allowed) throw new Error('AI product generation daily limit reached');

          const ai = await params.generateText({
            config: params.config,
            messages: [
              { role: 'system', content: effectivePrompt },
              { role: 'user', content: inputText },
            ],
            temperature: field === 'title' ? 0.2 : 0.3,
            maxTokens: field === 'title' ? 600 : 1800,
          });
          if (!ai.ok) {
            await recordAiUsageEvent(params.usageStore, {
              namespace,
              provider: params.config.provider,
              model: params.config.model,
              actorUserId: params.actorUserId,
              date,
              kind: 'failure',
            });
            throw new Error(ai.error || 'AI generation failed');
          }

          const text = cleanText(ai.text);
          const validationError = validateGeneratedText(field, text);
          if (validationError) {
            await recordAiUsageEvent(params.usageStore, {
              namespace,
              provider: ai.provider,
              model: ai.model,
              actorUserId: params.actorUserId,
              date,
              kind: 'failure',
              usage: ai.usage,
            });
            throw new Error(validationError);
          }

          await recordAiUsageEvent(params.usageStore, {
            namespace,
            provider: ai.provider,
            model: ai.model,
            actorUserId: params.actorUserId,
            date,
            kind: 'request',
            usage: ai.usage,
          });
          return { outputText: text, provider: ai.provider, model: ai.model, usage: ai.usage ? { ...ai.usage } : null };
        },
      });

      if (cached.source === 'cache') {
        await recordAiUsageEvent(params.usageStore, {
          namespace,
          provider: params.config.provider,
          model: params.config.model,
          actorUserId: params.actorUserId,
          date,
          kind: 'cache_hit',
        });
      }

      const limit = await assertAiDailyLimit({
        store: params.usageStore,
        namespace,
        actorUserId: params.actorUserId,
        limit: params.config.userDailyProductGenerationLimit,
        cacheHit: true,
        date,
      });
      latestLimit = { used: limit.used, remaining: limit.remaining, limit: limit.limit };
      drafts[field] = {
        text: cached.outputText,
        source: cached.source,
        provider: cached.record.provider,
        model: cached.record.model,
        promptHash: hash,
        generatedAt: now.toISOString(),
        usage: cached.record.usage as AiTextUsage | null,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error || 'AI generation failed'),
        drafts,
        limit: latestLimit,
      };
    }
  }

  return { ok: true, drafts, limit: latestLimit };
}
