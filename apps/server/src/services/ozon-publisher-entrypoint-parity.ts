import { createHash } from 'node:crypto';

export const OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION =
  'ozon-publisher-entrypoint-parity/v1' as const;

const MAX_DIFF_ROWS = 100;
const MAX_CANONICAL_DEPTH = 40;
const MAX_CANONICAL_NODES = 50_000;
const MAX_CANONICAL_UTF8_BYTES = 4 * 1024 * 1024;
const SUPPORTED_PUBLISHER_CONTRACT_VERSION =
  'ozon-listing-production-compile-adapter/v1';
const SUPPORTED_PAYLOAD_COMPILER_VERSION =
  'ozon-listing-payload-compiler/v1';

export type OzonPublisherEntrypoint =
  | 'COLLECT_PUBLISH_OZON'
  | 'LISTING_BATCH'
  | 'LISTING_IMPORT_BY_SKU'
  | 'BROWSER_ONE_CLICK'
  | 'EXTENSION_ADAPTER';

export interface OzonPublisherParityCompilerVersions {
  publisherContractVersion: string;
  payloadCompilerVersion: string;
}

export interface OzonPublisherParityOfferTrace {
  ordinal: number;
  offerId?: string;
  skuKey?: string;
  traceKey?: string;
}

export type OzonPublisherParityStrictBlockerCode =
  | 'OZON_LISTING_COMPILE_STAGE_INVALID'
  | 'OZON_LISTING_COMPILE_DRAFT_STALE'
  | 'OZON_LISTING_COMPILE_SOURCE_INVALID'
  | 'OZON_LISTING_COMPILE_SKU_INVALID'
  | 'OZON_LISTING_COMPILE_VALIDATION_INVALID'
  | 'OZON_LISTING_COMPILE_VALIDATION_STALE'
  | 'OZON_LISTING_COMPILE_TITLE_INVALID'
  | 'OZON_LISTING_COMPILE_TITLE_UNREVIEWED'
  | 'OZON_LISTING_COMPILE_PRICING_INVALID'
  | 'OZON_LISTING_COMPILE_PACKAGE_INVALID'
  | 'OZON_LISTING_COMPILE_IMAGES_INVALID'
  | 'OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED'
  | 'OZON_LISTING_COMPILE_OFFER_ID_INVALID'
  | 'OZON_LISTING_PRODUCTION_CAPTURE_STALE'
  | 'OZON_LISTING_PRODUCTION_VALIDATION_STALE'
  | 'OZON_LISTING_PRODUCTION_CATALOG_STALE'
  | 'OZON_LISTING_PRODUCTION_SCHEMA_STALE'
  | 'OZON_LISTING_PRODUCTION_MEDIA_INVALID'
  | 'OZON_LISTING_PRODUCTION_PAYLOAD_INVALID';

export type OzonPublisherParityUnavailableReasonCode =
  | 'CATALOG_UNAVAILABLE'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'WORKFLOW_UNAVAILABLE'
  | 'INTERNAL_UNAVAILABLE';

interface OzonPublisherParityLegacyInput {
  endpoint: string;
  payload: unknown;
  offerTrace?: readonly OzonPublisherParityOfferTrace[];
}

interface OzonPublisherParityCompiledInput {
  kind: 'COMPILED';
  endpoint: string;
  payload: unknown;
  compilerVersions: Readonly<OzonPublisherParityCompilerVersions>;
  offerTrace?: readonly OzonPublisherParityOfferTrace[];
}

interface OzonPublisherParityBlockedInput {
  kind: 'BLOCKED';
  blockerCode: OzonPublisherParityStrictBlockerCode;
  compilerVersions?: Readonly<Partial<OzonPublisherParityCompilerVersions>>;
}

interface OzonPublisherParityUnavailableInput {
  kind: 'UNAVAILABLE';
  reasonCode: OzonPublisherParityUnavailableReasonCode;
  compilerVersions?: Readonly<Partial<OzonPublisherParityCompilerVersions>>;
  error?: unknown;
}

export interface OzonPublisherEntrypointParityInput {
  entrypoint: OzonPublisherEntrypoint;
  legacy: Readonly<OzonPublisherParityLegacyInput>;
  v2: Readonly<
    OzonPublisherParityCompiledInput
    | OzonPublisherParityBlockedInput
    | OzonPublisherParityUnavailableInput
  >;
}

export type OzonPublisherParityStatus =
  | 'MATCH'
  | 'DIFFERENT'
  | 'V2_BLOCKED'
  | 'NOT_COMPARABLE';

export type OzonPublisherParityClassification =
  | 'MATCH'
  | 'INTENTIONAL_STRICTER'
  | 'COMPATIBILITY_TRANSFORM'
  | 'DEFECT'
  | 'NOT_COMPARABLE';

export type OzonPublisherParityDiffKind =
  | 'MISSING_IN_V2'
  | 'MISSING_IN_LEGACY'
  | 'TYPE_MISMATCH'
  | 'VALUE_MISMATCH'
  | 'ORDER_MISMATCH'
  | 'INVALID_PAYLOAD';

export type OzonPublisherParityPresence = 'BOTH' | 'LEGACY_ONLY' | 'V2_ONLY';
export type OzonPublisherParityValueType =
  | 'absent'
  | 'null'
  | 'boolean'
  | 'number'
  | 'string'
  | 'array'
  | 'object';

export interface OzonPublisherParityDiffRow {
  path: string;
  kind: OzonPublisherParityDiffKind;
  classification: Exclude<OzonPublisherParityClassification, 'MATCH' | 'NOT_COMPARABLE'>;
  presence: OzonPublisherParityPresence;
  type: {
    legacy: OzonPublisherParityValueType;
    v2: OzonPublisherParityValueType;
  };
}

type EndpointKind =
  | 'OZON_V3_PRODUCT_IMPORT'
  | 'OZON_V1_PRODUCT_IMPORT_BY_SKU'
  | 'OTHER'
  | 'INVALID';

interface SanitizedCompilerVersions {
  publisherContractVersion: string | null;
  payloadCompilerVersion: string | null;
}

interface PayloadSummary {
  endpointKind: EndpointKind;
  payloadHash: string;
  itemCount: number;
}

interface CompiledPayloadSummary extends PayloadSummary {
  kind: 'COMPILED';
  compilerVersions: SanitizedCompilerVersions;
}

interface BlockedPayloadSummary {
  kind: 'BLOCKED';
  blockerCode: OzonPublisherParityStrictBlockerCode;
  endpointKind: null;
  payloadHash: null;
  itemCount: null;
  compilerVersions: SanitizedCompilerVersions;
}

interface UnavailablePayloadSummary {
  kind: 'UNAVAILABLE';
  reasonCode: OzonPublisherParityUnavailableReasonCode;
  endpointKind: null;
  payloadHash: null;
  itemCount: null;
  compilerVersions: SanitizedCompilerVersions;
}

export interface OzonPublisherEntrypointParityReport {
  contractVersion: typeof OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION;
  entrypoint: OzonPublisherEntrypoint;
  status: OzonPublisherParityStatus;
  classification: OzonPublisherParityClassification;
  switchEligible: boolean;
  legacy: PayloadSummary;
  v2: CompiledPayloadSummary | BlockedPayloadSummary | UnavailablePayloadSummary;
  differences: {
    total: number;
    returned: number;
    truncated: boolean;
    rows: OzonPublisherParityDiffRow[];
  };
}

type CanonicalObject = { [key: string]: CanonicalValue };
type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject;

const MISSING = Symbol('missing');
type ComparableValue = CanonicalValue | typeof MISSING;

const SAFE_PATH_FIELDS = new Set([
  'offer_id', 'description_category_id', 'type_id', 'name', 'title', 'description',
  'price', 'old_price', 'currency_code', 'vat', 'dimension_unit', 'weight_unit',
  'weight', 'height', 'depth', 'width', 'images', 'primary_image', 'color_image',
  'attributes', 'id', 'complex_id', 'values', 'value', 'dictionary_value_id',
  'stock', 'stocks', 'quantity', 'sku', 'manufacturer', 'manufacturer_name',
  'manufacturerName',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function withinCanonicalWorkBudget(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let utf8Bytes = 0;
  while (pending.length) {
    const current = pending.pop();
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES) return false;
    if (typeof current === 'string') {
      if (current.length > MAX_CANONICAL_UTF8_BYTES - utf8Bytes) return false;
      utf8Bytes += Buffer.byteLength(current, 'utf8');
      if (utf8Bytes > MAX_CANONICAL_UTF8_BYTES) return false;
      continue;
    }
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (nodes + pending.length + current.length > MAX_CANONICAL_NODES) return false;
      for (let index = 0; index < current.length; index += 1) pending.push(current[index]);
      continue;
    }
    let keys: string[];
    try {
      keys = Object.keys(current);
    } catch {
      return false;
    }
    if (nodes + pending.length + keys.length > MAX_CANONICAL_NODES) return false;
    for (const key of keys) {
      if (key.length > MAX_CANONICAL_UTF8_BYTES - utf8Bytes) return false;
      utf8Bytes += Buffer.byteLength(key, 'utf8');
      if (utf8Bytes > MAX_CANONICAL_UTF8_BYTES) return false;
      try {
        pending.push((current as Record<string, unknown>)[key]);
      } catch {
        return false;
      }
    }
  }
  return true;
}

function stableStringify(value: CanonicalValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key]!)}`
  )).join(',')}}`;
}

function digest(value: CanonicalValue): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCanonical(left: CanonicalValue, right: CanonicalValue): number {
  return compareText(stableStringify(left), stableStringify(right));
}

function canonicalize(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): CanonicalValue {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { $parityType: 'non-finite-number' };
  }
  if (typeof value === 'bigint') return { $parityType: 'bigint' };
  if (typeof value === 'undefined') return { $parityType: 'undefined' };
  if (typeof value === 'function') return { $parityType: 'function' };
  if (typeof value === 'symbol') return { $parityType: 'symbol' };
  if (typeof value !== 'object') return { $parityType: 'unknown' };
  if (depth >= MAX_CANONICAL_DEPTH) return { $parityType: 'depth-limit' };
  if (seen.has(value)) return { $parityType: 'cycle' };
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { $parityType: 'unsupported-object' };
    }
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => canonicalize(entry, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  const result: CanonicalObject = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalize((value as Record<string, unknown>)[key], seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

function containsInvalidCanonicalValue(value: CanonicalValue): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsInvalidCanonicalValue);
  if (typeof value.$parityType === 'string') return true;
  return Object.values(value).some(containsInvalidCanonicalValue);
}

function canonicalAttribute(raw: unknown): CanonicalValue {
  const normalized = canonicalize(raw);
  if (!isObject(normalized) || !Array.isArray(normalized.values)) return normalized;
  return {
    ...normalized,
    values: [...normalized.values].sort(compareCanonical),
  };
}

function attributeIdentity(value: CanonicalValue): string {
  if (!isObject(value)) return `invalid:${stableStringify(value)}`;
  return stableStringify({
    id: value.id ?? null,
    complex_id: value.complex_id ?? 0,
  });
}

function canonicalItem(raw: unknown): CanonicalValue {
  const normalized = canonicalize(raw);
  if (!isObject(normalized) || !Array.isArray(normalized.attributes)) return normalized;
  const attributes = normalized.attributes.map(canonicalAttribute).sort((left, right) => {
    const identityOrder = compareText(attributeIdentity(left), attributeIdentity(right));
    return identityOrder || compareCanonical(left, right);
  });
  return { ...normalized, attributes };
}

function unwrapItems(payload: unknown): { valid: boolean; items: unknown[] } {
  if (Array.isArray(payload)) return { valid: true, items: payload };
  const outer = record(payload);
  if (!outer) return { valid: false, items: [] };
  if (Array.isArray(outer.items)) return { valid: true, items: outer.items };
  for (const wrapperKey of ['body', 'requestPayload'] as const) {
    const wrapper = record(outer[wrapperKey]);
    if (wrapper && Array.isArray(wrapper.items)) return { valid: true, items: wrapper.items };
  }
  return { valid: false, items: [] };
}

function normalizedTraceKey(
  trace: readonly OzonPublisherParityOfferTrace[] | undefined,
  ordinal: number,
): string {
  const row = trace?.find((candidate) => candidate.ordinal === ordinal);
  if (!row) return '';
  for (const value of [row.traceKey, row.skuKey, row.offerId]) {
    const text = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
    if (text) return text;
  }
  return '';
}

function itemIdentity(
  raw: unknown,
  ordinal: number,
  trace: readonly OzonPublisherParityOfferTrace[] | undefined,
): string {
  const itemRecord = record(raw);
  const rawOfferId = typeof itemRecord?.offer_id === 'string'
    ? itemRecord.offer_id.normalize('NFKC').trim()
    : '';
  const identity = normalizedTraceKey(trace, ordinal) || rawOfferId;
  if (!identity) return `ordinal:${String(ordinal).padStart(6, '0')}`;
  return `identity:${createHash('sha256').update('ozon-parity-item\0').update(identity).digest('hex')}`;
}

interface CanonicalItemEntry {
  key: string;
  value: CanonicalValue;
}

interface CanonicalPayload {
  valid: boolean;
  entries: CanonicalItemEntry[];
  payloadHash: string;
  itemCount: number;
  inputType: OzonPublisherParityValueType;
}

function canonicalPayload(
  payload: unknown,
  trace: readonly OzonPublisherParityOfferTrace[] | undefined,
): CanonicalPayload {
  const unwrapped = unwrapItems(payload);
  const inputType = valueType(payload);
  if (!unwrapped.valid) {
    return {
      valid: false,
      entries: [],
      payloadHash: digest({ invalidPayloadType: inputType }),
      itemCount: 0,
      inputType,
    };
  }
  if (!withinCanonicalWorkBudget({ items: unwrapped.items })) {
    return {
      valid: false,
      entries: [],
      payloadHash: digest({ invalidPayloadType: 'work-budget' }),
      itemCount: unwrapped.items.length,
      inputType,
    };
  }
  const grouped = new Map<string, CanonicalValue[]>();
  unwrapped.items.forEach((raw, ordinal) => {
    const identity = itemIdentity(raw, ordinal, trace);
    grouped.set(identity, [...(grouped.get(identity) || []), canonicalItem(raw)]);
  });
  const entries: CanonicalItemEntry[] = [];
  for (const identity of [...grouped.keys()].sort()) {
    const values = grouped.get(identity)!.sort(compareCanonical);
    values.forEach((value, occurrence) => {
      entries.push({ key: `${identity}:${String(occurrence).padStart(4, '0')}`, value });
    });
  }
  const valid = !entries.some((entry) => containsInvalidCanonicalValue(entry.value));
  return {
    valid,
    entries,
    payloadHash: digest({ items: entries.map((entry) => entry.value).sort(compareCanonical) }),
    itemCount: entries.length,
    inputType,
  };
}

function normalizedEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string') return '';
  const text = endpoint.normalize('NFKC').trim();
  if (!text || text.length > 4096) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.pathname.replace(/\/+$/, '') || '/'
      : '';
  } catch {
    const path = text.split(/[?#]/u, 1)[0]!.replace(/\/+$/, '') || '/';
    return path.startsWith('/') ? path : '';
  }
}

function endpointKind(endpoint: unknown): EndpointKind {
  const path = normalizedEndpoint(endpoint);
  if (!path) return 'INVALID';
  if (path === '/v3/product/import') return 'OZON_V3_PRODUCT_IMPORT';
  if (path === '/v1/product/import-by-sku') return 'OZON_V1_PRODUCT_IMPORT_BY_SKU';
  return 'OTHER';
}

function sanitizedVersion(value: unknown, supportedVersion: string): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFKC').trim();
  return text === supportedVersion ? supportedVersion : 'REDACTED';
}

function compilerVersions(
  versions: Readonly<Partial<OzonPublisherParityCompilerVersions>> | undefined,
): SanitizedCompilerVersions {
  return {
    publisherContractVersion: sanitizedVersion(
      versions?.publisherContractVersion,
      SUPPORTED_PUBLISHER_CONTRACT_VERSION,
    ),
    payloadCompilerVersion: sanitizedVersion(
      versions?.payloadCompilerVersion,
      SUPPORTED_PAYLOAD_COMPILER_VERSION,
    ),
  };
}

function isObject(value: ComparableValue): value is CanonicalObject {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value: unknown | typeof MISSING): OzonPublisherParityValueType {
  if (value === MISSING) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'object';
}

function deepContainsManufacturerPlaceholder(value: ComparableValue): boolean {
  if (value === MISSING || value === null) return false;
  if (typeof value === 'string') return /^manufacturer-[a-z0-9_-]+$/iu.test(value.trim());
  if (Array.isArray(value)) return value.some(deepContainsManufacturerPlaceholder);
  if (typeof value === 'object') return Object.values(value).some(deepContainsManufacturerPlaceholder);
  return false;
}

function differenceClassification(
  path: string,
  legacy: ComparableValue,
  v2: ComparableValue,
): OzonPublisherParityDiffRow['classification'] {
  if (/^\/items\/\d+\/sku(?:\/|$)/u.test(path)) return 'COMPATIBILITY_TRANSFORM';
  if (path === '/endpoint'
    && normalizedEndpoint(legacy) === '/v1/product/import-by-sku'
    && normalizedEndpoint(v2) === '/v3/product/import') {
    return 'COMPATIBILITY_TRANSFORM';
  }
  const knownPackageDefaults: Record<string, number> = {
    weight: 500,
    height: 100,
    depth: 100,
    width: 100,
  };
  const packageMatch = /^\/items\/\d+\/(weight|height|depth|width)$/u.exec(path);
  if (packageMatch && legacy === knownPackageDefaults[packageMatch[1]!]) {
    return 'INTENTIONAL_STRICTER';
  }
  if (/^\/items\/\d+\/(?:stock|stocks|quantity)(?:\/|$)/u.test(path)
    && deepContainsNumber(legacy, 999)) {
    return 'INTENTIONAL_STRICTER';
  }
  if (/^\/items\/\d+\/price$/u.test(path) && numericTextEquals(legacy, 100)) {
    return 'INTENTIONAL_STRICTER';
  }
  if (/^\/items\/\d+\/old_price$/u.test(path) && numericTextEquals(legacy, 120)) {
    return 'INTENTIONAL_STRICTER';
  }
  if (/^\/items\/\d+\/currency_code$/u.test(path)
    && legacy === 'CNY' && v2 === 'RUB') {
    return 'INTENTIONAL_STRICTER';
  }
  if (!/^\/items\/\d+$/u.test(path)
    && (deepContainsManufacturerPlaceholder(legacy) || deepContainsManufacturerPlaceholder(v2))) {
    return 'INTENTIONAL_STRICTER';
  }
  return 'DEFECT';
}

function deepContainsNumber(value: ComparableValue, expected: number): boolean {
  if (value === MISSING || value === null) return false;
  if (typeof value === 'number') return value === expected;
  if (typeof value === 'string') return numericTextEquals(value, expected);
  if (Array.isArray(value)) return value.some((entry) => deepContainsNumber(entry, expected));
  if (typeof value === 'object') return Object.values(value).some((entry) => deepContainsNumber(entry, expected));
  return false;
}

function numericTextEquals(value: ComparableValue, expected: number): boolean {
  if (typeof value === 'number') return value === expected;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/u.test(value.trim())) return false;
  return Number(value) === expected;
}

function safePathSegment(key: string, unknownOrdinal: number): string {
  if (SAFE_PATH_FIELDS.has(key)) return key.replace(/~/gu, '~0').replace(/\//gu, '~1');
  return `$field-${unknownOrdinal}`;
}

function keyedAttributes(values: CanonicalValue[]): Map<string, CanonicalValue> {
  const grouped = new Map<string, CanonicalValue[]>();
  for (const value of values) {
    const identity = attributeIdentity(value);
    grouped.set(identity, [...(grouped.get(identity) || []), value]);
  }
  const result = new Map<string, CanonicalValue>();
  for (const identity of [...grouped.keys()].sort()) {
    const group = grouped.get(identity)!.sort(compareCanonical);
    group.forEach((value, occurrence) => {
      result.set(`${identity}:${String(occurrence).padStart(4, '0')}`, value);
    });
  }
  return result;
}

function sameArraySet(left: CanonicalValue[], right: CanonicalValue[]): boolean {
  if (left.length !== right.length) return false;
  const leftValues = left.map(stableStringify).sort();
  const rightValues = right.map(stableStringify).sort();
  return leftValues.every((value, index) => value === rightValues[index]);
}

interface DiffCollector {
  total: number;
  rows: OzonPublisherParityDiffRow[];
  aggregate: Exclude<OzonPublisherParityClassification, 'MATCH' | 'NOT_COMPARABLE'> | null;
}

const CLASSIFICATION_WEIGHT: Record<Exclude<OzonPublisherParityClassification, 'MATCH' | 'NOT_COMPARABLE'>, number> = {
  COMPATIBILITY_TRANSFORM: 1,
  INTENTIONAL_STRICTER: 2,
  DEFECT: 3,
};

function addDifference(
  collector: DiffCollector,
  path: string,
  kind: OzonPublisherParityDiffKind,
  legacy: ComparableValue,
  v2: ComparableValue,
): void {
  const classification = differenceClassification(path, legacy, v2);
  collector.total += 1;
  if (!collector.aggregate
    || CLASSIFICATION_WEIGHT[classification] > CLASSIFICATION_WEIGHT[collector.aggregate]) {
    collector.aggregate = classification;
  }
  if (collector.rows.length >= MAX_DIFF_ROWS) return;
  collector.rows.push({
    path,
    kind,
    classification,
    presence: legacy === MISSING ? 'V2_ONLY' : v2 === MISSING ? 'LEGACY_ONLY' : 'BOTH',
    type: { legacy: valueType(legacy), v2: valueType(v2) },
  });
}

function compareAttributeArrays(
  legacy: CanonicalValue[],
  v2: CanonicalValue[],
  path: string,
  collector: DiffCollector,
): void {
  const left = keyedAttributes(legacy);
  const right = keyedAttributes(v2);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  keys.forEach((key, ordinal) => {
    compareValues(
      left.has(key) ? left.get(key)! : MISSING,
      right.has(key) ? right.get(key)! : MISSING,
      `${path}/${ordinal}`,
      collector,
    );
  });
}

function compareValues(
  legacy: ComparableValue,
  v2: ComparableValue,
  path: string,
  collector: DiffCollector,
): void {
  if (legacy !== MISSING && v2 !== MISSING && stableStringify(legacy) === stableStringify(v2)) return;
  if (legacy === MISSING) {
    addDifference(collector, path, 'MISSING_IN_LEGACY', legacy, v2);
    return;
  }
  if (v2 === MISSING) {
    addDifference(collector, path, 'MISSING_IN_V2', legacy, v2);
    return;
  }
  if (valueType(legacy) !== valueType(v2)) {
    addDifference(collector, path, 'TYPE_MISMATCH', legacy, v2);
    return;
  }
  if (Array.isArray(legacy) && Array.isArray(v2)) {
    if (/\/images$/u.test(path) && sameArraySet(legacy, v2)) {
      addDifference(collector, path, 'ORDER_MISMATCH', legacy, v2);
      return;
    }
    if (/\/attributes$/u.test(path)) {
      compareAttributeArrays(legacy, v2, path, collector);
      return;
    }
    const length = Math.max(legacy.length, v2.length);
    for (let index = 0; index < length; index += 1) {
      compareValues(
        index < legacy.length ? legacy[index]! : MISSING,
        index < v2.length ? v2[index]! : MISSING,
        `${path}/${index}`,
        collector,
      );
    }
    return;
  }
  if (isObject(legacy) && isObject(v2)) {
    const keys = [...new Set([...Object.keys(legacy), ...Object.keys(v2)])].sort();
    let unknownOrdinal = 0;
    for (const key of keys) {
      const safeSegment = safePathSegment(key, unknownOrdinal);
      if (!SAFE_PATH_FIELDS.has(key)) unknownOrdinal += 1;
      compareValues(
        Object.hasOwn(legacy, key) ? legacy[key]! : MISSING,
        Object.hasOwn(v2, key) ? v2[key]! : MISSING,
        `${path}/${safeSegment}`,
        collector,
      );
    }
    return;
  }
  addDifference(collector, path, 'VALUE_MISMATCH', legacy, v2);
}

function compareCompiled(
  input: OzonPublisherEntrypointParityInput,
  legacy: CanonicalPayload,
  v2Input: Readonly<OzonPublisherParityCompiledInput>,
): OzonPublisherEntrypointParityReport {
  const v2 = canonicalPayload(v2Input.payload, v2Input.offerTrace);
  const collector: DiffCollector = { total: 0, rows: [], aggregate: null };
  if (!legacy.valid || !v2.valid) {
    addDifference(
      collector,
      '/payload',
      'INVALID_PAYLOAD',
      legacy.valid
        ? { items: legacy.entries.map((entry) => entry.value) }
        : { invalidPayloadType: legacy.inputType },
      v2.valid
        ? { items: v2.entries.map((entry) => entry.value) }
        : { invalidPayloadType: v2.inputType },
    );
  } else {
    const legacyByKey = new Map(legacy.entries.map((entry) => [entry.key, entry.value]));
    const v2ByKey = new Map(v2.entries.map((entry) => [entry.key, entry.value]));
    const keys = [...new Set([...legacyByKey.keys(), ...v2ByKey.keys()])].sort();
    keys.forEach((key, ordinal) => {
      compareValues(
        legacyByKey.has(key) ? legacyByKey.get(key)! : MISSING,
        v2ByKey.has(key) ? v2ByKey.get(key)! : MISSING,
        `/items/${ordinal}`,
        collector,
      );
    });
  }
  if (normalizedEndpoint(input.legacy.endpoint) !== normalizedEndpoint(v2Input.endpoint)) {
    addDifference(collector, '/endpoint', 'VALUE_MISMATCH', canonicalize(input.legacy.endpoint), canonicalize(v2Input.endpoint));
  }
  const legacyEndpointKind = endpointKind(input.legacy.endpoint);
  const v2EndpointKind = endpointKind(v2Input.endpoint);
  const sanitizedCompilerVersions = compilerVersions(v2Input.compilerVersions);
  const endpointContractKnown = (
    legacyEndpointKind === 'OZON_V3_PRODUCT_IMPORT'
      && v2EndpointKind === 'OZON_V3_PRODUCT_IMPORT'
  ) || (
    legacyEndpointKind === 'OZON_V1_PRODUCT_IMPORT_BY_SKU'
      && v2EndpointKind === 'OZON_V3_PRODUCT_IMPORT'
  );
  const compilerContractKnown = Object.values(sanitizedCompilerVersions).every((value) => (
    value !== null && value !== 'REDACTED'
  ));
  const comparable = legacy.valid && v2.valid && endpointContractKnown && compilerContractKnown;
  const classification = comparable
    ? collector.aggregate || 'MATCH'
    : 'NOT_COMPARABLE';
  return {
    contractVersion: OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
    entrypoint: input.entrypoint,
    status: comparable ? (collector.total === 0 ? 'MATCH' : 'DIFFERENT') : 'NOT_COMPARABLE',
    classification,
    switchEligible: comparable && collector.total === 0,
    legacy: {
      endpointKind: legacyEndpointKind,
      payloadHash: legacy.payloadHash,
      itemCount: legacy.itemCount,
    },
    v2: {
      kind: 'COMPILED',
      endpointKind: v2EndpointKind,
      payloadHash: v2.payloadHash,
      itemCount: v2.itemCount,
      compilerVersions: sanitizedCompilerVersions,
    },
    differences: {
      total: collector.total,
      returned: collector.rows.length,
      truncated: collector.total > collector.rows.length,
      rows: collector.rows,
    },
  };
}

export function compareOzonPublisherEntrypointParity(
  input: Readonly<OzonPublisherEntrypointParityInput>,
): OzonPublisherEntrypointParityReport {
  const legacy = canonicalPayload(input.legacy.payload, input.legacy.offerTrace);
  const legacySummary: PayloadSummary = {
    endpointKind: endpointKind(input.legacy.endpoint),
    payloadHash: legacy.payloadHash,
    itemCount: legacy.itemCount,
  };
  if (input.v2.kind === 'BLOCKED') {
    return {
      contractVersion: OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
      entrypoint: input.entrypoint,
      status: 'V2_BLOCKED',
      classification: 'INTENTIONAL_STRICTER',
      switchEligible: false,
      legacy: legacySummary,
      v2: {
        kind: 'BLOCKED',
        blockerCode: input.v2.blockerCode,
        endpointKind: null,
        payloadHash: null,
        itemCount: null,
        compilerVersions: compilerVersions(input.v2.compilerVersions),
      },
      differences: { total: 0, returned: 0, truncated: false, rows: [] },
    };
  }
  if (input.v2.kind === 'UNAVAILABLE') {
    return {
      contractVersion: OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
      entrypoint: input.entrypoint,
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
      legacy: legacySummary,
      v2: {
        kind: 'UNAVAILABLE',
        reasonCode: input.v2.reasonCode,
        endpointKind: null,
        payloadHash: null,
        itemCount: null,
        compilerVersions: compilerVersions(input.v2.compilerVersions),
      },
      differences: { total: 0, returned: 0, truncated: false, rows: [] },
    };
  }
  return compareCompiled(input, legacy, input.v2);
}
