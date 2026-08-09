import { createHash } from 'crypto';
import type { OzonAttributeValuePolicy } from 'shared';

export interface OzonAttributeDefinitionCacheKey {
  shopId: string;
  descriptionCategoryId: number;
  typeId: number;
  language: string;
  catalogRevision: string;
}

export interface OzonAttributeDefinition {
  id: number;
  name: string;
  description: string;
  type: string;
  isCollection: boolean;
  isRequired: boolean;
  dictionaryId: number | null;
  valuePolicy?: OzonAttributeValuePolicy;
}

export interface OzonAttributeDefinitionCacheRecord {
  definitions: OzonAttributeDefinition[];
  definitionsHash: string;
  complete: boolean;
  fetchedAt: Date;
  expiresAt: Date;
  source: string;
}

export interface OzonAttributeDefinitionCacheStore {
  find(key: OzonAttributeDefinitionCacheKey): Promise<OzonAttributeDefinitionCacheRecord | null>;
  upsert(key: OzonAttributeDefinitionCacheKey, record: OzonAttributeDefinitionCacheRecord): Promise<void>;
}

export type EmptyOzonAttributeDefinitionsPolicy =
  | { kind: 'block' }
  | { kind: 'validated_clone_follow'; validationReference: string };

export interface GetCachedOzonAttributeDefinitionsDeps {
  store: OzonAttributeDefinitionCacheStore;
  fetchDefinitions(): Promise<unknown[]>;
  now?: () => Date;
  ttlMs?: number;
  emptyDefinitionsPolicy?: EmptyOzonAttributeDefinitionsPolicy;
  forceRefresh?: boolean;
  cacheOnly?: boolean;
}

export interface OzonAttributeDefinitionCacheResult extends OzonAttributeDefinitionCacheRecord {
  source: 'cache' | 'ozon_api' | 'stale-cache';
  warning?: string;
  emptyDefinitionsAllowed?: boolean;
  validationReference?: string;
}

export class OzonAttributeDefinitionsRequiredError extends Error {
  readonly code = 'OZON_ATTRIBUTE_DEFINITIONS_REQUIRED';
  readonly statusCode = 422;
  readonly key: OzonAttributeDefinitionCacheKey;

  constructor(key: OzonAttributeDefinitionCacheKey) {
    super('Official Ozon attribute definitions are required for domestic-source preparation');
    this.name = 'OzonAttributeDefinitionsRequiredError';
    this.key = key;
  }
}

const DEFAULT_ATTRIBUTE_DEFINITION_TTL_MS = 24 * 60 * 60 * 1000;

function cleanText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function positiveInt(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid Ozon attribute definition ${field}`);
  }
  return number;
}

function normalizeKey(key: OzonAttributeDefinitionCacheKey): OzonAttributeDefinitionCacheKey {
  const normalized = {
    shopId: cleanText(key.shopId),
    descriptionCategoryId: positiveInt(key.descriptionCategoryId, 'descriptionCategoryId'),
    typeId: positiveInt(key.typeId, 'typeId'),
    language: cleanText(key.language) || 'DEFAULT',
    catalogRevision: cleanText(key.catalogRevision),
  };
  if (!normalized.shopId || !normalized.catalogRevision) {
    throw new Error('Ozon attribute definition cache requires shopId and catalogRevision');
  }
  return normalized;
}

function normalizeDefinition(value: unknown): OzonAttributeDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Ozon attribute definition row');
  }
  const row = value as Record<string, unknown>;
  const name = cleanText(row.name);
  const type = cleanText(row.type);
  if (!name || !type) throw new Error('Invalid Ozon attribute definition name or type');
  const dictionaryValue = row.dictionaryId ?? row.dictionary_id;
  const dictionaryNumber = Number(dictionaryValue);
  const valuePolicy = cleanText(row.valuePolicy ?? row.value_policy).toLocaleUpperCase();
  return {
    id: positiveInt(row.id, 'id'),
    name,
    description: cleanText(row.description),
    type,
    isCollection: (row.isCollection ?? row.is_collection) === true,
    isRequired: (row.isRequired ?? row.is_required) === true,
    dictionaryId: Number.isSafeInteger(dictionaryNumber) && dictionaryNumber > 0
      ? dictionaryNumber
      : null,
    ...(['STRICT_DICTIONARY', 'OPEN_DICTIONARY', 'FREE_TEXT'].includes(valuePolicy)
      ? { valuePolicy: valuePolicy as OzonAttributeValuePolicy }
      : {}),
  };
}

function canonicalDefinitions(definitions: OzonAttributeDefinition[]): string {
  return JSON.stringify(definitions);
}

export function normalizeOzonAttributeDefinitions(values: unknown): OzonAttributeDefinition[] {
  if (!Array.isArray(values)) throw new Error('Invalid Ozon attribute definition response');
  const rows = values.map(normalizeDefinition).sort((left, right) => (
    left.id - right.id || canonicalDefinitions([left]).localeCompare(canonicalDefinitions([right]))
  ));
  const definitions: OzonAttributeDefinition[] = [];
  for (const row of rows) {
    const previous = definitions[definitions.length - 1];
    if (!previous || previous.id !== row.id) {
      definitions.push(row);
      continue;
    }
    if (canonicalDefinitions([previous]) !== canonicalDefinitions([row])) {
      throw new Error(`Conflicting Ozon attribute definition id ${row.id}`);
    }
  }
  return definitions;
}

export function hashOzonAttributeDefinitions(definitions: OzonAttributeDefinition[]): string {
  return createHash('sha256').update(canonicalDefinitions(definitions)).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function isFreshCompleteRecord(
  record: OzonAttributeDefinitionCacheRecord | null,
  now: Date,
): record is OzonAttributeDefinitionCacheRecord {
  if (!record
    || record.complete !== true
    || !(record.fetchedAt instanceof Date)
    || !(record.expiresAt instanceof Date)
    || !(now instanceof Date)) return false;
  const fetchedAt = record.fetchedAt.getTime();
  const expiresAt = record.expiresAt.getTime();
  const currentTime = now.getTime();
  return Number.isFinite(fetchedAt)
    && Number.isFinite(expiresAt)
    && Number.isFinite(currentTime)
    && fetchedAt <= currentTime
    && expiresAt > fetchedAt
    && expiresAt > currentTime;
}

function resultOrBlockingError(
  key: OzonAttributeDefinitionCacheKey,
  record: OzonAttributeDefinitionCacheRecord,
  source: OzonAttributeDefinitionCacheResult['source'],
  policy: EmptyOzonAttributeDefinitionsPolicy,
  warning?: string,
): OzonAttributeDefinitionCacheResult {
  if (record.definitions.length > 0) return { ...record, source, ...(warning ? { warning } : {}) };
  if (policy.kind === 'validated_clone_follow') {
    const validationReference = cleanText(policy.validationReference);
    if (validationReference) {
      return {
        ...record,
        source,
        ...(warning ? { warning } : {}),
        emptyDefinitionsAllowed: true,
        validationReference,
      };
    }
  }
  throw new OzonAttributeDefinitionsRequiredError(key);
}

export async function getCachedOzonAttributeDefinitions(
  rawKey: OzonAttributeDefinitionCacheKey,
  deps: GetCachedOzonAttributeDefinitionsDeps,
): Promise<OzonAttributeDefinitionCacheResult> {
  const key = normalizeKey(rawKey);
  const now = deps.now?.() || new Date();
  const ttlMs = Number.isFinite(deps.ttlMs) && Number(deps.ttlMs) >= 0
    ? Number(deps.ttlMs)
    : DEFAULT_ATTRIBUTE_DEFINITION_TTL_MS;
  const policy = deps.emptyDefinitionsPolicy || { kind: 'block' as const };
  let cached: OzonAttributeDefinitionCacheRecord | null = null;
  try {
    cached = await deps.store.find(key);
  } catch {
    cached = null;
  }

  if (deps.cacheOnly && deps.forceRefresh) {
    throw new Error('Ozon attribute definition cache lookup cannot refresh in cache-only mode');
  }

  if (!deps.forceRefresh && isFreshCompleteRecord(cached, now)) {
    return resultOrBlockingError(key, cached, 'cache', policy);
  }
  if (deps.cacheOnly) throw new OzonAttributeDefinitionsRequiredError(key);

  try {
    const definitions = normalizeOzonAttributeDefinitions(await deps.fetchDefinitions());
    const record: OzonAttributeDefinitionCacheRecord = {
      definitions,
      definitionsHash: hashOzonAttributeDefinitions(definitions),
      complete: true,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      source: 'ozon_api',
    };
    try {
      await deps.store.upsert(key, record);
    } catch {
      // A cache persistence outage must not discard a complete official response.
    }
    return resultOrBlockingError(key, record, 'ozon_api', policy);
  } catch (error) {
    if (error instanceof OzonAttributeDefinitionsRequiredError) throw error;
    if (cached?.complete === true) {
      return resultOrBlockingError(key, cached, 'stale-cache', policy, errorMessage(error));
    }
    throw error;
  }
}

type OzonAttributeDefinitionCacheDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  upsert(args: unknown): Promise<unknown>;
};

export type PrismaOzonAttributeDefinitionCacheClient = {
  ozonAttributeDefinitionCache: OzonAttributeDefinitionCacheDelegate;
};

function storedRecord(value: unknown): OzonAttributeDefinitionCacheRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const definitions = normalizeOzonAttributeDefinitions(row.definitions);
  const definitionsHash = hashOzonAttributeDefinitions(definitions);
  return {
    definitions,
    definitionsHash,
    complete: row.complete === true && cleanText(row.definitionsHash) === definitionsHash,
    fetchedAt: new Date(String(row.fetchedAt || 0)),
    expiresAt: new Date(String(row.expiresAt || 0)),
    source: cleanText(row.source) || 'ozon_api',
  };
}

export function createPrismaOzonAttributeDefinitionCacheStore(
  prisma: PrismaOzonAttributeDefinitionCacheClient,
): OzonAttributeDefinitionCacheStore {
  return {
    async find(key) {
      const row = await prisma.ozonAttributeDefinitionCache.findUnique({
        where: { ozon_attribute_definition_cache_key: key },
      });
      return storedRecord(row);
    },
    async upsert(key, record) {
      const data = {
        definitions: record.definitions,
        definitionsHash: record.definitionsHash,
        complete: record.complete,
        fetchedAt: record.fetchedAt,
        expiresAt: record.expiresAt,
        source: record.source,
      };
      await prisma.ozonAttributeDefinitionCache.upsert({
        where: { ozon_attribute_definition_cache_key: key },
        create: { ...key, ...data },
        update: data,
      });
    },
  };
}
