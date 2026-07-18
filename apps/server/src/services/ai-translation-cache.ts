import { createHash, randomUUID } from 'crypto';

export type AiTranslationCacheStatus = 'success' | 'approved' | 'rejected' | 'stale';
export type AiTranslationCacheSource = 'ai' | 'cache' | 'system_glossary' | 'manual';

export interface AiTranslationCacheRecord {
  namespace: string;
  sourceLang: string;
  targetLang: string;
  inputHash: string;
  inputText: string;
  outputText: string;
  promptHash: string;
  provider: string;
  model: string;
  providerConfigHash?: string;
  status: AiTranslationCacheStatus;
  usage: Record<string, unknown> | null;
  expiresAt: Date | null;
  lastUsedAt: Date;
  hitCount: number;
  source: AiTranslationCacheSource;
}

export interface AiTranslationCacheLookup {
  namespace: string;
  sourceLang: string;
  targetLang: string;
  inputHash: string;
  promptHash: string;
  provider?: string;
  model?: string;
  providerConfigHash?: string;
  providerSuccessOnly?: boolean;
}

export interface AiTranslationCacheStore {
  find(params: AiTranslationCacheLookup): Promise<AiTranslationCacheRecord | null>;
  upsert(record: AiTranslationCacheRecord): Promise<void>;
  markUsed(params: AiTranslationCacheLookup, usedAt: Date): Promise<void>;
}

export interface GetCachedAiTranslationParams {
  namespace: string;
  sourceLang: string;
  targetLang: string;
  inputText: string;
  promptHash: string;
  provider: string;
  model: string;
  providerConfigHash?: string;
  providerSuccessOnly?: boolean;
  now?: () => Date;
  store: AiTranslationCacheStore;
  translate(): Promise<{ outputText: string; usage?: Record<string, unknown> | null; provider?: string; model?: string }>;
  expiresAt?: Date | null;
}

export type GetCachedAiTranslationResult = {
  source: 'cache' | 'provider';
  outputText: string;
  status: AiTranslationCacheStatus;
  record: AiTranslationCacheRecord;
};

export function hashAiTranslationInput(value: unknown): string {
  return createHash('sha256').update(String(value || '').normalize('NFKC').trim()).digest('hex');
}

function cleanText(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeRecord(row: Record<string, any>): AiTranslationCacheRecord {
  return {
    namespace: cleanText(row.namespace),
    sourceLang: cleanText(row.sourceLang),
    targetLang: cleanText(row.targetLang),
    inputHash: cleanText(row.inputHash),
    inputText: cleanText(row.inputText),
    outputText: cleanText(row.outputText),
    promptHash: cleanText(row.promptHash),
    provider: cleanText(row.provider),
    model: cleanText(row.model),
    providerConfigHash: cleanText(row.providerConfigHash),
    status: ['success', 'approved', 'rejected', 'stale'].includes(row.status) ? row.status : 'success',
    usage: row.usage && typeof row.usage === 'object' ? row.usage : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt) : new Date(0),
    hitCount: Number(row.hitCount) || 0,
    source: ['ai', 'cache', 'system_glossary', 'manual'].includes(row.source) ? row.source : 'ai',
  };
}

export async function getCachedAiTranslation(params: GetCachedAiTranslationParams): Promise<GetCachedAiTranslationResult> {
  const now = params.now?.() || new Date();
  const inputText = cleanText(params.inputText);
  const inputHash = hashAiTranslationInput(inputText);
  const lookup: AiTranslationCacheLookup = {
    namespace: params.namespace,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    inputHash,
    promptHash: params.promptHash,
    provider: params.provider,
    model: params.model,
    providerConfigHash: params.providerConfigHash || '',
    providerSuccessOnly: params.providerSuccessOnly,
  };

  const cached = await params.store.find(lookup);
  const providerSuccessEligible = !params.providerSuccessOnly || (
    ['ai', 'cache'].includes(cached?.source || '')
    && cached?.status === 'success'
    && cached.provider === params.provider
    && cached.model === params.model
    && (cached.providerConfigHash || '') === (params.providerConfigHash || '')
  );
  if (cached && providerSuccessEligible && cached.outputText
    && (!cached.expiresAt || cached.expiresAt.getTime() > now.getTime())) {
    await params.store.markUsed({
      ...lookup,
      provider: cached.provider,
      model: cached.model,
    }, now);
    return { source: 'cache', outputText: cached.outputText, status: cached.status, record: cached };
  }

  const translated = await params.translate();
  const outputText = cleanText(translated.outputText);
  if (!outputText) throw new Error('AI translation output is empty');

  const record: AiTranslationCacheRecord = {
    namespace: params.namespace,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    inputHash,
    inputText,
    outputText,
    promptHash: params.promptHash,
    provider: translated.provider || params.provider,
    model: translated.model || params.model,
    providerConfigHash: params.providerConfigHash || '',
    status: 'success',
    usage: translated.usage || null,
    expiresAt: params.expiresAt ?? null,
    lastUsedAt: now,
    hitCount: 0,
    source: 'ai',
  };
  await params.store.upsert(record);
  return { source: 'provider', outputText, status: 'success', record };
}

export type PrismaAiTranslationCacheClient = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: any[]): Promise<number>;
};

export function createPrismaAiTranslationCacheStore(prisma: PrismaAiTranslationCacheClient): AiTranslationCacheStore {
  return {
    async find(params) {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT
          "namespace",
          "source_lang" AS "sourceLang",
          "target_lang" AS "targetLang",
          "input_hash" AS "inputHash",
          "input_text" AS "inputText",
          "output_text" AS "outputText",
          "prompt_hash" AS "promptHash",
          "provider",
          "model",
          "provider_config_hash" AS "providerConfigHash",
          "status",
          "usage_json" AS "usage",
          "expires_at" AS "expiresAt",
          "last_used_at" AS "lastUsedAt",
          "hit_count" AS "hitCount",
          "source"
        FROM "ai_translation_cache"
        WHERE "namespace" = ${params.namespace}
          AND "source_lang" = ${params.sourceLang}
          AND "target_lang" = ${params.targetLang}
          AND "input_hash" = ${params.inputHash}
          AND "prompt_hash" = ${params.promptHash}
          AND (
            (${params.providerSuccessOnly === true}
              AND "source" IN ('ai', 'cache')
              AND "status" = 'success'
              AND "provider" = ${params.provider || ''}
              AND "model" = ${params.model || ''}
              AND "provider_config_hash" = ${params.providerConfigHash || ''})
            OR (${params.providerSuccessOnly !== true} AND (
              "source" IN ('system_glossary', 'manual')
              OR ("provider" = ${params.provider || ''}
                AND "model" = ${params.model || ''}
                AND "provider_config_hash" = ${params.providerConfigHash || ''})
            ))
          )
        ORDER BY CASE WHEN "source" IN ('system_glossary', 'manual') THEN 0 ELSE 1 END, "updated_at" DESC
        LIMIT 1
      `;
      return rows[0] ? normalizeRecord(rows[0]) : null;
    },

    async upsert(record) {
      await prisma.$executeRaw`
        INSERT INTO "ai_translation_cache" (
          "id",
          "namespace",
          "source_lang",
          "target_lang",
          "input_hash",
          "input_text",
          "output_text",
          "prompt_hash",
          "provider",
          "model",
          "provider_config_hash",
          "status",
          "usage_json",
          "expires_at",
          "last_used_at",
          "hit_count",
          "source",
          "updated_at"
        ) VALUES (
          ${randomUUID()},
          ${record.namespace},
          ${record.sourceLang},
          ${record.targetLang},
          ${record.inputHash},
          ${record.inputText},
          ${record.outputText},
          ${record.promptHash},
          ${record.provider},
          ${record.model},
          ${record.providerConfigHash || ''},
          ${record.status},
          CAST(${JSON.stringify(record.usage || null)} AS jsonb),
          ${record.expiresAt},
          ${record.lastUsedAt},
          ${record.hitCount},
          ${record.source},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("namespace", "source_lang", "target_lang", "input_hash", "prompt_hash", "provider", "model", "provider_config_hash")
        DO UPDATE SET
          "input_text" = EXCLUDED."input_text",
          "output_text" = EXCLUDED."output_text",
          "status" = EXCLUDED."status",
          "usage_json" = EXCLUDED."usage_json",
          "expires_at" = EXCLUDED."expires_at",
          "last_used_at" = EXCLUDED."last_used_at",
          "source" = EXCLUDED."source",
          "updated_at" = CURRENT_TIMESTAMP
      `;
    },

    async markUsed(params, usedAt) {
      await prisma.$executeRaw`
        UPDATE "ai_translation_cache"
        SET "hit_count" = "hit_count" + 1,
            "last_used_at" = ${usedAt},
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "namespace" = ${params.namespace}
          AND "source_lang" = ${params.sourceLang}
          AND "target_lang" = ${params.targetLang}
          AND "input_hash" = ${params.inputHash}
          AND "prompt_hash" = ${params.promptHash}
          AND "provider" = ${params.provider || ''}
          AND "model" = ${params.model || ''}
          AND "provider_config_hash" = ${params.providerConfigHash || ''}
      `;
    },
  };
}
