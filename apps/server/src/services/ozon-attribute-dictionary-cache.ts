import { createHash, randomUUID } from 'crypto';
import {
  collectOzonAttributeValuePages,
  type OzonAttributeValuePage,
} from './ozon-client.js';

export type OzonAttributeDictionaryEntry = { id: number; value?: string | null };

export type OzonAttributeDictionaryCacheParams = {
  description_category_id: number;
  type_id: number;
  attribute_id: number;
  language?: string;
  catalogRevision?: string;
};

type NormalizedOzonAttributeDictionaryCacheParams = Required<OzonAttributeDictionaryCacheParams>;

export type OzonAttributeDictionaryPageParams = Omit<
  NormalizedOzonAttributeDictionaryCacheParams,
  'catalogRevision'
> & {
  last_value_id: number;
  limit: number;
};

export type OzonAttributeDictionaryCacheRecord = {
  values: OzonAttributeDictionaryEntry[];
  valuesHash: string;
  fetchedAt: Date;
  expiresAt: Date;
  source: string;
  complete?: boolean;
  catalogRevision?: string;
  pageCount?: number;
  finalCursor?: number | null;
};

export type OzonAttributeDictionaryCacheStore = {
  find(params: NormalizedOzonAttributeDictionaryCacheParams): Promise<OzonAttributeDictionaryCacheRecord | null>;
  upsert(params: NormalizedOzonAttributeDictionaryCacheParams, record: OzonAttributeDictionaryCacheRecord): Promise<void>;
};

export type OzonAttributeDictionaryCacheResult = {
  values: OzonAttributeDictionaryEntry[];
  source: 'cache' | 'ozon_api' | 'stale-cache';
  warning?: string;
  complete?: boolean;
  catalogRevision?: string;
  pageCount?: number;
  finalCursor?: number | null;
};

type GetCachedOzonAttributeValuesDeps = {
  store: OzonAttributeDictionaryCacheStore;
  fetchValues?(params: NormalizedOzonAttributeDictionaryCacheParams): Promise<OzonAttributeDictionaryEntry[]>;
  fetchPage?(params: OzonAttributeDictionaryPageParams): Promise<OzonAttributeValuePage<OzonAttributeDictionaryEntry>>;
  now?: () => Date;
  ttlMs?: number;
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
  forceRefresh?: boolean;
};

const DEFAULT_DICTIONARY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeParams(params: OzonAttributeDictionaryCacheParams): NormalizedOzonAttributeDictionaryCacheParams {
  return {
    description_category_id: Number(params.description_category_id),
    type_id: Number(params.type_id),
    attribute_id: Number(params.attribute_id),
    language: params.language || 'DEFAULT',
    catalogRevision: String(params.catalogRevision || '').trim(),
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

function safeNonNegativeInteger(value: unknown, field: string): number {
  let number: number;
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Ozon attribute dictionary ${field} must be a safe integer`);
    }
    number = Number(value);
  } else {
    number = Number(value);
  }
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Ozon attribute dictionary ${field} must be a safe integer`);
  }
  return number;
}

function safeNullableCursor(value: unknown): number | null {
  return value == null ? null : safeNonNegativeInteger(value, 'finalCursor');
}

function persistedCursor(value: unknown): bigint | null {
  const cursor = safeNullableCursor(value);
  return cursor == null ? null : BigInt(cursor);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function cacheMetadata(record: OzonAttributeDictionaryCacheRecord) {
  return {
    complete: record.complete,
    catalogRevision: record.catalogRevision,
    pageCount: record.pageCount,
    finalCursor: record.finalCursor,
  };
}

function isCompleteForRevision(
  record: OzonAttributeDictionaryCacheRecord | null,
  catalogRevision: string,
): record is OzonAttributeDictionaryCacheRecord {
  return !!record
    && record.complete === true
    && String(record.catalogRevision || '') === catalogRevision;
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
  const strictCompleteness = Boolean(deps.fetchPage || normalizedParams.catalogRevision);
  if (!deps.forceRefresh
    && cached
    && cached.expiresAt.getTime() > now.getTime()
    && (strictCompleteness
      ? isCompleteForRevision(cached, normalizedParams.catalogRevision)
      : cached.complete !== false)) {
    return { values: cached.values, source: 'cache', ...cacheMetadata(cached) };
  }

  try {
    let fetched: {
      values: OzonAttributeDictionaryEntry[];
      complete: true;
      pageCount: number;
      finalCursor: number;
    };
    if (deps.fetchPage) {
      fetched = await collectOzonAttributeValuePages(async (cursor, limit) => {
        const page = await deps.fetchPage!({
          description_category_id: normalizedParams.description_category_id,
          type_id: normalizedParams.type_id,
          attribute_id: normalizedParams.attribute_id,
          language: normalizedParams.language,
          last_value_id: cursor,
          limit,
        });
        return { ...page, values: normalizeValues(page.values) };
      }, {
        pageSize: deps.pageSize,
        maxPages: deps.maxPages,
        maxRows: deps.maxRows,
      });
    } else {
      if (!deps.fetchValues) throw new Error('Ozon attribute dictionary fetcher is not configured');
      const values = normalizeValues(await deps.fetchValues(normalizedParams));
      fetched = {
        values,
        complete: true,
        pageCount: 1,
        finalCursor: values.length > 0 ? values[values.length - 1]!.id : 0,
      };
    }
    const record: OzonAttributeDictionaryCacheRecord = {
      values: fetched.values,
      valuesHash: hashValues(fetched.values),
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      source: 'ozon_api',
      complete: true,
      catalogRevision: normalizedParams.catalogRevision,
      pageCount: fetched.pageCount,
      finalCursor: fetched.finalCursor,
    };
    try {
      await deps.store.upsert(normalizedParams, record);
    } catch {
      // The dictionary cache must never block publishing. A missing migration or
      // transient database issue should fall back to normal Ozon API behavior.
    }
    return { values: record.values, source: 'ozon_api', ...cacheMetadata(record) };
  } catch (error) {
    if (isCompleteForRevision(cached, normalizedParams.catalogRevision)) {
      return {
        values: cached.values,
        source: 'stale-cache',
        warning: errorMessage(error),
        ...cacheMetadata(cached),
      };
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
          "source",
          "catalog_revision" AS "catalogRevision",
          "complete",
          "page_count" AS "pageCount",
          "final_cursor" AS "finalCursor"
        FROM "ozon_attribute_dictionary_cache"
        WHERE "description_category_id" = ${params.description_category_id}
          AND "type_id" = ${params.type_id}
          AND "attribute_id" = ${params.attribute_id}
          AND "language" = ${params.language}
          AND "catalog_revision" = ${params.catalogRevision}
        LIMIT 1
      `;
      const record = rows[0];
      if (!record) return null;
      const values = normalizeValues(record.values || []);
      const valuesHash = String(record.valuesHash || '');
      const fetchedAt = new Date(record.fetchedAt);
      const expiresAt = new Date(record.expiresAt);
      const catalogRevision = String(record.catalogRevision || '');
      const pageCount = safeNonNegativeInteger(record.pageCount || 0, 'pageCount');
      const finalCursor = safeNullableCursor(record.finalCursor);
      const metadataValid = Number.isFinite(fetchedAt.getTime())
        && Number.isFinite(expiresAt.getTime())
        && expiresAt.getTime() >= fetchedAt.getTime()
        && catalogRevision === params.catalogRevision
        && valuesHash === hashValues(values)
        && pageCount > 0;
      return {
        values,
        valuesHash,
        fetchedAt,
        expiresAt,
        source: String(record.source || 'ozon_api'),
        catalogRevision,
        complete: record.complete === true && metadataValid,
        pageCount,
        finalCursor,
      };
    },
    async upsert(params, record) {
      const values = normalizeValues(record.values);
      if (hashValues(values) !== record.valuesHash) {
        throw new Error('Ozon attribute dictionary valuesHash does not match values');
      }
      if (String(record.catalogRevision || '') !== params.catalogRevision) {
        throw new Error('Ozon attribute dictionary catalogRevision does not match its key');
      }
      const pageCount = safeNonNegativeInteger(record.pageCount || 0, 'pageCount');
      if (record.complete === true && pageCount === 0) {
        throw new Error('Complete Ozon attribute dictionary records require at least one page');
      }
      const finalCursor = persistedCursor(record.finalCursor);
      await prisma.$executeRaw`
        INSERT INTO "ozon_attribute_dictionary_cache" (
          "id",
          "description_category_id",
          "type_id",
          "attribute_id",
          "language",
          "catalog_revision",
          "values_json",
          "values_hash",
          "complete",
          "page_count",
          "final_cursor",
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
          ${params.catalogRevision},
          CAST(${JSON.stringify(values)} AS jsonb),
          ${record.valuesHash},
          ${record.complete === true},
          ${pageCount},
          ${finalCursor},
          ${record.fetchedAt},
          ${record.expiresAt},
          ${record.source},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("description_category_id", "type_id", "attribute_id", "language", "catalog_revision")
        DO UPDATE SET
          "values_json" = EXCLUDED."values_json",
          "values_hash" = EXCLUDED."values_hash",
          "complete" = EXCLUDED."complete",
          "page_count" = EXCLUDED."page_count",
          "final_cursor" = EXCLUDED."final_cursor",
          "fetched_at" = EXCLUDED."fetched_at",
          "expires_at" = EXCLUDED."expires_at",
          "source" = EXCLUDED."source",
          "updated_at" = CURRENT_TIMESTAMP
      `;
    },
  };
}
