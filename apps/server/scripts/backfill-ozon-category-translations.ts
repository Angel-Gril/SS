import 'dotenv/config';
import { createHash } from 'crypto';
import { prisma } from '../src/lib/prisma.js';
import { getConfig } from '../src/config/system-config-schema.js';
import { generateAiText } from '../src/services/ai-text.js';
import {
  createPrismaAiTranslationCacheStore,
  hashAiTranslationInput,
  type AiTranslationCacheRecord,
} from '../src/services/ai-translation-cache.js';
import {
  applyOzonCategoryCatalogLocalTranslations,
  backfillOzonCategoryCatalogTranslations,
  createPrismaOzonCategoryCatalogStore,
  isValidOzonCategoryAiTranslation,
  type OzonCategoryCatalogEntry,
} from '../src/services/ozon-category-catalog.js';

type CatalogPair = {
  shopId: string;
  language: string;
};

type Args = {
  limit: number;
  batchSize: number;
  shopId: string;
  language: string;
  dryRun: boolean;
};

function cleanText(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 0,
    batchSize: 40,
    shopId: '',
    language: '',
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--limit=')) args.limit = Math.max(0, Math.trunc(Number(arg.slice('--limit='.length)) || 0));
    else if (arg.startsWith('--batch-size=')) args.batchSize = Math.min(100, Math.max(1, Math.trunc(Number(arg.slice('--batch-size='.length)) || 40)));
    else if (arg.startsWith('--shop-id=')) args.shopId = cleanText(arg.slice('--shop-id='.length));
    else if (arg.startsWith('--language=')) args.language = cleanText(arg.slice('--language='.length));
  }
  return args;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function extractJson(value: string): unknown {
  const text = cleanText(value).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('AI batch response is not JSON');
  }
}

function readTranslationsFromJson(data: unknown, terms: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const normalizedToTerm = new Map(terms.map((term) => [term.toLowerCase(), term]));
  const root = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const translations = root.translations && typeof root.translations === 'object'
    ? root.translations
    : root;

  if (Array.isArray(translations)) {
    for (const row of translations) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const term = cleanText((row as Record<string, unknown>).term || (row as Record<string, unknown>).source);
      const translated = cleanText((row as Record<string, unknown>).translation || (row as Record<string, unknown>).zh);
      const exactTerm = terms.includes(term) ? term : normalizedToTerm.get(term.toLowerCase());
      if (exactTerm && isValidOzonCategoryAiTranslation(translated)) out.set(exactTerm, translated);
    }
    return out;
  }

  if (!translations || typeof translations !== 'object') return out;
  for (const [key, value] of Object.entries(translations as Record<string, unknown>)) {
    const term = cleanText(key);
    const exactTerm = terms.includes(term) ? term : normalizedToTerm.get(term.toLowerCase());
    const translated = cleanText(value);
    if (exactTerm && isValidOzonCategoryAiTranslation(translated)) out.set(exactTerm, translated);
  }
  return out;
}

async function listCatalogPairs(args: Args): Promise<CatalogPair[]> {
  const rows = await prisma.$queryRaw<Array<{ shopId: string; language: string }>>`
    SELECT DISTINCT "shop_id" AS "shopId", "language"
    FROM "ozon_category_catalog"
    ORDER BY "shop_id" ASC, "language" ASC
  `;
  return rows
    .map((row) => ({ shopId: cleanText(row.shopId), language: cleanText(row.language) || 'DEFAULT' }))
    .filter((row) => (!args.shopId || row.shopId === args.shopId) && (!args.language || row.language === args.language));
}

function collectMissingTerms(entriesByPair: Array<{ localEntries: OzonCategoryCatalogEntry[] }>): string[] {
  return unique(entriesByPair.flatMap((row) => row.localEntries.flatMap((entry) => entry.untranslatedTerms)));
}

async function loadCachedTranslations(
  terms: string[],
  promptHash: string,
  provider: string,
  model: string,
): Promise<{ translated: Map<string, string>; uncached: string[] }> {
  const store = createPrismaAiTranslationCacheStore(prisma);
  const translated = new Map<string, string>();
  const uncached: string[] = [];
  for (const term of terms) {
    const cached = await store.find({
      namespace: 'category_term',
      sourceLang: 'ru',
      targetLang: 'zh-CN',
      inputHash: hashAiTranslationInput(term),
      promptHash,
      provider,
      model,
    });
    const output = cleanText(cached?.outputText);
    if (output && isValidOzonCategoryAiTranslation(output)) {
      translated.set(term, output);
    } else {
      uncached.push(term);
    }
  }
  return { translated, uncached };
}

async function cacheTranslation(
  term: string,
  translated: string,
  promptHash: string,
  provider: string,
  model: string,
  usage: Record<string, unknown> | null,
): Promise<void> {
  const now = new Date();
  const record: AiTranslationCacheRecord = {
    namespace: 'category_term',
    sourceLang: 'ru',
    targetLang: 'zh-CN',
    inputHash: hashAiTranslationInput(term),
    inputText: term,
    outputText: translated,
    promptHash,
    provider,
    model,
    status: 'success',
    usage,
    expiresAt: null,
    lastUsedAt: now,
    hitCount: 0,
    source: 'ai',
  };
  await createPrismaAiTranslationCacheStore(prisma).upsert(record);
}

async function translateBatch(params: {
  terms: string[];
  prompt: string;
  promptHash: string;
  provider: 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  providerLabel: string;
  timeoutMs: number;
}): Promise<Map<string, string>> {
  const messages = [
    {
      role: 'system' as const,
      content: [
        params.prompt,
        'You are translating Ozon marketplace category/type terms from Russian to concise Simplified Chinese.',
        'Return strict JSON only: {"translations":{"<exact Russian term>":"<Chinese translation>"}}.',
        'Keep each value short. Do not include Russian, explanations, punctuation sentences, markdown, or extra keys.',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: JSON.stringify({ terms: params.terms }),
    },
  ];
  const ai = await generateAiText({
    config: {
      provider: params.provider,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      providerLabel: params.providerLabel,
      timeoutMs: params.timeoutMs,
    },
    messages,
    temperature: 0,
    maxTokens: Math.min(6000, Math.max(600, params.terms.length * 60)),
  });
  if (!ai.ok) throw new Error(ai.error);
  const translations = readTranslationsFromJson(extractJson(ai.text), params.terms);
  for (const [term, translated] of translations) {
    await cacheTranslation(term, translated, params.promptHash, params.provider, params.model, ai.usage);
  }
  return translations;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = await getConfig('ai_provider');
  const baseUrl = cleanText(await getConfig('ai_base_url'));
  const apiKey = cleanText(await getConfig('ai_api_key'));
  const model = cleanText(await getConfig('ai_model'));
  const providerLabel = cleanText(await getConfig('ai_provider_label'));
  const timeoutMs = Number(await getConfig('ai_timeout_ms')) || 30000;
  const prompt = cleanText(await getConfig('ai_category_translation_prompt'));
  const promptHash = createHash('sha256').update(prompt).digest('hex');
  const store = createPrismaOzonCategoryCatalogStore(prisma);
  const pairs = await listCatalogPairs(args);
  const entriesByPair = [];

  for (const pair of pairs) {
    const originalEntries = await store.list(pair.shopId, pair.language);
    const localEntries = applyOzonCategoryCatalogLocalTranslations(originalEntries);
    entriesByPair.push({ ...pair, originalEntries, localEntries });
  }

  const missingTerms = collectMissingTerms(entriesByPair);
  const { translated, uncached } = await loadCachedTranslations(missingTerms, promptHash, provider, model);
  const limitedUncached = args.limit > 0 ? uncached.slice(0, args.limit) : uncached;
  let aiTranslated = 0;
  let aiFailedBatches = 0;

  if (provider === 'custom' && baseUrl && apiKey && model && prompt && !args.dryRun) {
    for (let i = 0; i < limitedUncached.length; i += args.batchSize) {
      const batch = limitedUncached.slice(i, i + args.batchSize);
      try {
        const batchTranslations = await translateBatch({
          terms: batch,
          prompt,
          promptHash,
          provider,
          baseUrl,
          apiKey,
          model,
          providerLabel,
          timeoutMs,
        });
        for (const [term, translation] of batchTranslations) translated.set(term, translation);
        aiTranslated += batchTranslations.size;
        console.log(`[ozon-category-backfill] translated ${Math.min(i + args.batchSize, limitedUncached.length)}/${limitedUncached.length}, accepted=${batchTranslations.size}`);
      } catch (error) {
        aiFailedBatches += 1;
        console.warn(`[ozon-category-backfill] batch failed at ${i}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  let persistedPairs = 0;
  let changedPairs = 0;
  let remainingTerms: string[] = [];
  for (const pair of entriesByPair) {
    const result = await backfillOzonCategoryCatalogTranslations(pair.originalEntries, {
      translateTerm: async (term) => {
        const outputText = translated.get(term);
        if (!outputText) throw new Error(`No translation for ${term}`);
        return { outputText, source: 'cache' };
      },
    });
    if (result.changed) {
      changedPairs += 1;
      if (!args.dryRun) {
        await store.replace(pair.shopId, pair.language, result.catalog, new Date());
        persistedPairs += 1;
      }
    }
    remainingTerms = unique([...remainingTerms, ...result.remainingTerms]);
  }

  console.log(JSON.stringify({
    pairs: pairs.length,
    missingTermsBefore: missingTerms.length,
    cachedTerms: translated.size - aiTranslated,
    requestedAiTerms: limitedUncached.length,
    aiTranslated,
    aiFailedBatches,
    changedPairs,
    persistedPairs,
    remainingTerms: remainingTerms.length,
    sampleRemainingTerms: remainingTerms.slice(0, 30),
    dryRun: args.dryRun,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
