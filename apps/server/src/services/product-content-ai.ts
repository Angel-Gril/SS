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
import { buildSourceProductProfile } from './source-product-profile.js';

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
  titleModel?: string;
  descriptionModel?: string;
  userDailyProductGenerationLimit: number;
}

export interface ProductContentStructuredDraft {
  title?: string;
  description?: string;
  bulletPoints?: string[];
  searchTags?: string[];
  warnings?: string[];
  richContentBlocks?: string[];
  confidence?: number;
}

export interface ProductContentDraft {
  text: string;
  structured?: ProductContentStructuredDraft;
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
  'Ozon localization contract: generate Russian marketplace copy for Ozon buyers, not a literal translation.',
  'Use only facts present in the source JSON. Do not invent materials, cup type, effects, age range, brand, certification, discounts, shipping, or guarantees.',
  'Prefer natural Russian retail wording used by Russian sellers over literal machine translation.',
  'Start the title with the concrete Russian product type, then add only verified attributes such as gender, material, color, size, pack count, or use case.',
  'Do not literally translate livestream, factory, wholesale, hot-sale, SKU noise, or holiday slogans; omit source-platform and supplier wording instead.',
  'Do not mention 1688, PDD, Taobao, wholesale, supplier, factory, JSON, SKU internals, or source-system fields.',
  'Return Russian only, with no Chinese, no markdown, no HTML, no URLs, and no explanation outside the requested JSON contract.',
].join(' ');

const PRODUCT_CONTENT_CACHE_VERSION = 1;
const SOURCE_COMMERCE_NOISE_RE = /(?:1688|pdd|拼多多|taobao|tmall|淘宝|天猫|оптом|поставщик|поставщика|фабрик|завод|производител|дропшип|wholesale|supplier|factory|直播|专供|批发|厂家|货源|跨境专供)/i;
const HTML_OR_URL_RE = /(?:<[^>]+>|https?:\/\/|www\.|\.jpg\b|\.jpeg\b|\.png\b|\.webp\b|\.gif\b)/i;

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

function outputContractForField(field: ProductContentField): string {
  if (field === 'title') {
    return [
      'Output contract for title: return a compact JSON object.',
      'Required key: "title" (Russian Ozon title, 40-160 characters when possible).',
      'Optional keys: "searchTags" (3-8 Russian phrases), "warnings" (review notes for unverifiable or risky claims), "confidence" (0-1).',
      'Example shape: {"title":"Женские трусы из хлопка, высокая посадка","searchTags":["женские трусы"],"warnings":["Размерная сетка требует проверки"],"confidence":0.82}',
    ].join(' ');
  }
  return [
    'Output contract for description: return a compact JSON object.',
    'Required key: "description" (Russian Ozon description based only on source facts).',
    'Optional keys: "bulletPoints" (3-6 concise Russian benefits), "richContentBlocks" (2-6 Russian text blocks for Ozon rich content; no image URLs), "searchTags" (3-8 Russian phrases), "warnings" (review notes for missing facts or risky claims), "confidence" (0-1).',
    'Example shape: {"description":"Краткое описание товара.","bulletPoints":["Мягкий материал"],"richContentBlocks":["Текстовый блок для rich content"],"searchTags":["женское белье"],"warnings":[],"confidence":0.8}',
  ].join(' ');
}

function buildEffectivePrompt(field: ProductContentField, prompt: string): string {
  return `${PRODUCT_COPYWRITING_GUARDRAIL}\n\n${outputContractForField(field)}\n\n${prompt}`.trim();
}

function safeParseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next possible JSON span.
    }
  }
  return null;
}

function cleanDraftList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = cleanText(item).slice(0, maxLength);
    if (!text || CJK_RE.test(text) || HTML_OR_URL_RE.test(text) || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out.length ? out : undefined;
}

function richContentBlockSource(object: Record<string, unknown>): unknown {
  if (object.richContentBlocks) return object.richContentBlocks;
  const richContent = metadataRecord(object.richContent ?? object.ozonRichContent);
  if (Array.isArray(richContent.blocks)) return richContent.blocks;
  if (Array.isArray(richContent.content)) return richContent.content;
  return undefined;
}

function cleanRichContentBlocks(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = metadataRecord(item);
    const raw = Object.keys(record).length
      ? record.text ?? record.title ?? record.description ?? record.content ?? record.value
      : item;
    const text = cleanText(raw).slice(0, 600);
    if (!text || CJK_RE.test(text) || HTML_OR_URL_RE.test(text) || SOURCE_COMMERCE_NOISE_RE.test(text) || !CYRILLIC_RE.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 6) break;
  }
  return out.length ? out : undefined;
}

function cleanConfidence(value: unknown): number | undefined {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return undefined;
  return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
}

function structuredFromObject(field: ProductContentField, object: Record<string, unknown>, text: string): ProductContentStructuredDraft | undefined {
  const structured: ProductContentStructuredDraft = {};
  if (field === 'title') structured.title = text;
  else structured.description = text;
  const bulletPoints = cleanDraftList(object.bulletPoints ?? object.bullets, 6, 180);
  const searchTags = cleanDraftList(object.searchTags ?? object.tags ?? object.keywords, 8, 80);
  const warnings = cleanDraftList(object.warnings ?? object.reviewWarnings ?? object.risks, 8, 180);
  const richContentBlocks = cleanRichContentBlocks(richContentBlockSource(object));
  const confidence = cleanConfidence(object.confidence);
  if (bulletPoints) structured.bulletPoints = bulletPoints;
  if (searchTags) structured.searchTags = searchTags;
  if (warnings) structured.warnings = warnings;
  if (richContentBlocks) structured.richContentBlocks = richContentBlocks;
  if (confidence !== undefined) structured.confidence = confidence;
  return Object.keys(structured).length ? structured : undefined;
}

function parseGeneratedProductContent(field: ProductContentField, raw: unknown): { text: string; structured?: ProductContentStructuredDraft } {
  const rawText = String(raw || '').trim();
  const object = safeParseJsonObject(rawText);
  if (!object) return { text: cleanText(rawText) };
  const textKey = field === 'title' ? 'title' : 'description';
  const localizedTextKey = field === 'title' ? 'ruTitle' : 'ruDescription';
  const text = cleanText(object[textKey] ?? object[localizedTextKey] ?? object.text);
  return {
    text,
    structured: structuredFromObject(field, object, text),
  };
}

function serializeProductContentDraftForCache(parsed: { text: string; structured?: ProductContentStructuredDraft }): string {
  if (!parsed.structured) return parsed.text;
  return JSON.stringify({ version: PRODUCT_CONTENT_CACHE_VERSION, text: parsed.text, structured: parsed.structured });
}

function parseCachedProductContentDraft(value: unknown, field: ProductContentField): { text: string; structured?: ProductContentStructuredDraft } {
  const object = safeParseJsonObject(String(value || ''));
  if (object && object.version === PRODUCT_CONTENT_CACHE_VERSION) {
    const text = cleanText(object.text);
    const structured = metadataRecord(object.structured) as ProductContentStructuredDraft;
    return { text, structured: Object.keys(structured).length ? structured : undefined };
  }
  return parseGeneratedProductContent(field, value);
}

function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

function buildProductContentInput(item: ProductContentAiItem, field: ProductContentField): string {
  const meta = metadataRecord(item.metadata);
  const sourceProfile = buildSourceProductProfile(item);
  const payload = {
    field,
    sourceProfile: {
      version: sourceProfile.version,
      hash: sourceProfile.hash,
      sourceTitle: sourceProfile.sourceTitle,
      categoryPath: sourceProfile.categoryPath,
      categoryName: sourceProfile.categoryName,
      categoryHints: sourceProfile.categoryHints,
      productIntentTerms: sourceProfile.productIntentTerms,
      productTypeHints: sourceProfile.productTypeHints,
      colors: sourceProfile.colors,
      sizes: sourceProfile.sizes,
      materials: sourceProfile.materials,
      genderSeasonHints: sourceProfile.genderSeasonHints,
      imageEvidence: sourceProfile.imageEvidence,
      variantEvidence: sourceProfile.variantEvidence,
      packaging: sourceProfile.packaging,
      textEvidence: sourceProfile.textEvidence,
      quality: sourceProfile.quality,
    },
    sourceTitle: sourceProfile.sourceTitle || cleanText(meta.sourceTitleRaw || item.title),
    sourceCategory: sourceProfile.categoryPath.length ? sourceProfile.categoryPath.join(' / ') : cleanText(meta.categoryName),
    attributes: meta.attributes || meta.sourceAttributes || null,
    standardAttributes: meta.sourceStandardAttributes || meta.standardAttributes || null,
    selectedSku: meta.selectedSku || null,
    variants: item.variants || meta.variants || null,
    packaging: sourceProfile.packaging,
    sourcePackagingRows: meta.sourcePackagingRows || null,
    description: sourceProfile.textEvidence.description || cleanSourceCopy(meta.description || meta.sourceDescription || meta.sourceDescriptionRaw || ''),
    richContentSummary: sourceProfile.textEvidence.richContentSummary || summarizeRichContentDraft(meta.sourceRichContentDraft) || cleanSourceCopy(meta.sourceRichContentDraftSummary || ''),
  };
  return JSON.stringify(payload);
}

function validateGeneratedText(field: ProductContentField, text: string): string | null {
  if (!text) return field === 'title' ? 'Generated title is unsafe for Ozon' : 'Generated description is unsafe for Ozon';
  if (HTML_OR_URL_RE.test(text) || SOURCE_COMMERCE_NOISE_RE.test(text)) {
    return field === 'title' ? 'Generated title is unsafe for Ozon' : 'Generated description is unsafe for Ozon';
  }
  if (field === 'title') {
    if (text.length < 5 || text.length > 200 || CJK_RE.test(text) || !CYRILLIC_RE.test(text)) {
      return 'Generated title is unsafe for Ozon';
    }
  }
  if (field === 'description') {
    if (text.length < 10 || text.length > 5000 || CJK_RE.test(text) || !CYRILLIC_RE.test(text)) {
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

function modelForField(config: ProductContentAiConfig, field: ProductContentField): string {
  const override = field === 'title' ? config.titleModel : config.descriptionModel;
  return cleanText(override || config.model);
}

function aiConfigForField(config: ProductContentAiConfig, field: ProductContentField): AiTextConfig {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: modelForField(config, field),
    providerLabel: config.providerLabel,
    timeoutMs: config.timeoutMs,
  };
}

export async function generateProductContentDraft(params: GenerateProductContentDraftParams): Promise<ProductContentDraftResult> {
  const drafts: Partial<Record<ProductContentField, ProductContentDraft>> = {};
  if (!params.config.enabled) return { ok: false, error: 'AI product generation disabled', drafts };
  if (params.config.provider !== 'custom' || !params.config.baseUrl || !params.config.apiKey || params.fields.some((field) => !modelForField(params.config, field))) {
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
    const effectivePrompt = buildEffectivePrompt(field, prompt);
    const hash = promptHash(effectivePrompt);
    const fieldConfig = aiConfigForField(params.config, field);

    try {
      const cached = await getCachedAiTranslation({
        namespace,
        sourceLang: 'zh-CN',
        targetLang: 'ru',
        inputText,
        promptHash: hash,
        provider: params.config.provider,
        model: fieldConfig.model,
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
            config: fieldConfig,
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
              provider: fieldConfig.provider,
              model: fieldConfig.model,
              actorUserId: params.actorUserId,
              date,
              kind: 'failure',
            });
            throw new Error(ai.error || 'AI generation failed');
          }

          const parsed = parseGeneratedProductContent(field, ai.text);
          const validationError = validateGeneratedText(field, parsed.text);
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
          return { outputText: serializeProductContentDraftForCache(parsed), provider: ai.provider, model: ai.model, usage: ai.usage ? { ...ai.usage } : null };
        },
      });

      if (cached.source === 'cache') {
        await recordAiUsageEvent(params.usageStore, {
          namespace,
          provider: params.config.provider,
          model: fieldConfig.model,
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
      const parsedCachedDraft = parseCachedProductContentDraft(cached.outputText, field);
      drafts[field] = {
        text: parsedCachedDraft.text,
        structured: parsedCachedDraft.structured,
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
