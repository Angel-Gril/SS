import { createHash, randomUUID } from 'crypto';

export type OzonAttributeDictionaryEntry = { id: number; value?: string | null };

export type OzonAttributeDictionaryCacheParams = {
  description_category_id: number;
  type_id: number;
  attribute_id: number;
  language?: string;
};

export type OzonAttributeDictionaryCacheRecord = {
  values: OzonAttributeDictionaryEntry[];
  valuesHash: string;
  fetchedAt: Date;
  expiresAt: Date;
  source: string;
};

export type OzonAttributeDictionaryCacheStore = {
  find(params: Required<OzonAttributeDictionaryCacheParams>): Promise<OzonAttributeDictionaryCacheRecord | null>;
  upsert(params: Required<OzonAttributeDictionaryCacheParams>, record: OzonAttributeDictionaryCacheRecord): Promise<void>;
};

export type OzonAttributeDictionaryCacheResult = {
  values: OzonAttributeDictionaryEntry[];
  source: 'cache' | 'ozon_api' | 'stale-cache';
  warning?: string;
};

type GetCachedOzonAttributeValuesDeps = {
  store: OzonAttributeDictionaryCacheStore;
  fetchValues(params: Required<OzonAttributeDictionaryCacheParams>): Promise<OzonAttributeDictionaryEntry[]>;
  now?: () => Date;
  ttlMs?: number;
};

const DEFAULT_DICTIONARY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeParams(params: OzonAttributeDictionaryCacheParams): Required<OzonAttributeDictionaryCacheParams> {
  return {
    description_category_id: Number(params.description_category_id),
    type_id: Number(params.type_id),
    attribute_id: Number(params.attribute_id),
    language: params.language || 'DEFAULT',
  };
}

function normalizeValues(values: OzonAttributeDictionaryEntry[]): OzonAttributeDictionaryEntry[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => ({
      id: Number(entry?.id),
      value: entry?.value == null ? null : String(entry.value),
    }))
    .filter((entry) => Number.isFinite(entry.id) && String(entry.value || '').trim());
}

function hashValues(values: OzonAttributeDictionaryEntry[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export async function getCachedOzonAttributeValues(
  params: OzonAttributeDictionaryCacheParams,
  deps: GetCachedOzonAttributeValuesDeps,
): Promise<OzonAttributeDictionaryCacheResult> {
  const normalizedParams = normalizeParams(params);
  const now = deps.now?.() || new Date();
  const ttlMs = deps.ttlMs ?? DEFAULT_DICTIONARY_CACHE_TTL_MS;
  let cached: OzonAttributeDictionaryCacheRecord | null = null;
  try {
    cached = await deps.store.find(normalizedParams);
  } catch {
    cached = null;
  }
  if (cached && cached.expiresAt.getTime() > now.getTime()) {
    return { values: cached.values, source: 'cache' };
  }

  try {
    const values = normalizeValues(await deps.fetchValues(normalizedParams));
    const record: OzonAttributeDictionaryCacheRecord = {
      values,
      valuesHash: hashValues(values),
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      source: 'ozon_api',
    };
    try {
      await deps.store.upsert(normalizedParams, record);
    } catch {
      // The dictionary cache must never block publishing. A missing migration or
      // transient database issue should fall back to normal Ozon API behavior.
    }
    return { values, source: 'ozon_api' };
  } catch (error) {
    if (cached) {
      return { values: cached.values, source: 'stale-cache', warning: errorMessage(error) };
    }
    throw error;
  }
}

type PrismaWithOzonAttributeDictionaryCache = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: any[]): Promise<number>;
};

export function createPrismaOzonAttributeDictionaryCacheStore(
  prisma: PrismaWithOzonAttributeDictionaryCache,
): OzonAttributeDictionaryCacheStore {
  return {
    async find(params) {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT
          "values_json" AS "values",
          "values_hash" AS "valuesHash",
          "fetched_at" AS "fetchedAt",
          "expires_at" AS "expiresAt",
          "source"
        FROM "ozon_attribute_dictionary_cache"
        WHERE "description_category_id" = ${params.description_category_id}
          AND "type_id" = ${params.type_id}
          AND "attribute_id" = ${params.attribute_id}
          AND "language" = ${params.language}
        LIMIT 1
      `;
      const record = rows[0];
      if (!record) return null;
      return {
        values: normalizeValues(record.values || []),
        valuesHash: String(record.valuesHash || ''),
        fetchedAt: new Date(record.fetchedAt),
        expiresAt: new Date(record.expiresAt),
        source: String(record.source || 'ozon_api'),
      };
    },
    async upsert(params, record) {
      await prisma.$executeRaw`
        INSERT INTO "ozon_attribute_dictionary_cache" (
          "id",
          "description_category_id",
          "type_id",
          "attribute_id",
          "language",
          "values_json",
          "values_hash",
          "fetched_at",
          "expires_at",
          "source",
          "updated_at"
        )
        VALUES (
          ${randomUUID()},
          ${params.description_category_id},
          ${params.type_id},
          ${params.attribute_id},
          ${params.language},
          CAST(${JSON.stringify(record.values)} AS jsonb),
          ${record.valuesHash},
          ${record.fetchedAt},
          ${record.expiresAt},
          ${record.source},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("description_category_id", "type_id", "attribute_id", "language")
        DO UPDATE SET
          "values_json" = EXCLUDED."values_json",
          "values_hash" = EXCLUDED."values_hash",
          "fetched_at" = EXCLUDED."fetched_at",
          "expires_at" = EXCLUDED."expires_at",
          "source" = EXCLUDED."source",
          "updated_at" = CURRENT_TIMESTAMP
      `;
    },
  };
}
