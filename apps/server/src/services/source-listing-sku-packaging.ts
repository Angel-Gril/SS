import {
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
  type OzonListingDraft,
  type OzonListingSkuPackagingItem,
  type OzonListingSkuPackagingMeasurements,
} from 'shared';
import { sourceListingEditorSkuKeysForDraft } from './source-listing-sku-copies.js';

const MEASUREMENT_KEYS = ['weightG', 'lengthMm', 'widthMm', 'heightMm'] as const;
export class SourceListingSkuPackagingError extends Error {
  readonly code = 'OZON_LISTING_DRAFT_INPUT_INVALID';
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SourceListingSkuPackagingError';
  }
}
function fail(message: string): never { throw new SourceListingSkuPackagingError(message); }
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function measurements(value: unknown): OzonListingSkuPackagingMeasurements {
  if (!record(value) || !exactKeys(value, MEASUREMENT_KEYS)
    || MEASUREMENT_KEYS.some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || Number(value[key]) <= 0)) {
    fail('SKU packaging requires exact positive finite weight in g and length, width, height in mm');
  }
  return Object.fromEntries(MEASUREMENT_KEYS.map((key) => [key, value[key]])) as unknown as OzonListingSkuPackagingMeasurements;
}
export function normalizeSourceListingSkuPackagingItems(value: unknown): OzonListingSkuPackagingItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS) {
    fail('SKU packaging must contain a bounded non-empty item list');
  }
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    if (!record(item) || !exactKeys(item, ['skuKey', ...MEASUREMENT_KEYS])) fail('SKU packaging item fields are invalid');
    const skuKey = item.skuKey;
    if (typeof skuKey !== 'string' || !skuKey || skuKey !== skuKey.normalize('NFKC').trim()
      || skuKey.length > SOURCE_LISTING_SKU_KEY_MAX_LENGTH
      || Array.from(skuKey).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
      || seen.has(skuKey)) fail('SKU packaging keys must be exact and unique');
    seen.add(skuKey);
    return { skuKey, ...measurements(Object.fromEntries(MEASUREMENT_KEYS.map((key) => [key, item[key]]))) };
  });
}
export function assertSourceListingSkuPackagingCoverage(items: OzonListingSkuPackagingItem[], selectedSkuKeys: string[]): void {
  const keys = new Set(items.map((item) => item.skuKey));
  if (items.length !== selectedSkuKeys.length || keys.size !== items.length
    || selectedSkuKeys.some((key) => !keys.has(key))) fail('SKU packaging must exactly cover every selected SKU');
}
function reviewedManual(value: unknown): value is Record<string, unknown> {
  return record(value) && value.source === 'MANUAL' && value.reviewed === true
    && (value.manualReview === undefined || value.manualReview === 'CONFIRMED')
    && Array.isArray(value.evidence) && value.evidence.length > 0 && value.evidence.length <= 20
    && value.evidence.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 500 && item === item.trim());
}

export function hasSourceListingSkuPackaging(draft: OzonListingDraft): boolean {
  return Boolean(draft.attributes.values.packaging
    && Object.prototype.hasOwnProperty.call(draft.attributes.values.packaging, 'skuValues'));
}

/** An existing SKU map always owns packaging; malformed maps must never fall back to common facts. */
export function projectSourceListingSkuPackaging(draft: OzonListingDraft): OzonListingSkuPackagingItem[] | null {
  const packaging = draft.attributes.values.packaging;
  if (!hasSourceListingSkuPackaging(draft)) {
    const commonKeys = { weightG: 'packageWeightG', lengthMm: 'packageLengthMm', widthMm: 'packageWidthMm', heightMm: 'packageHeightMm' };
    const common = Object.fromEntries(MEASUREMENT_KEYS.map((key) => {
      const direct = draft.attributes.values[commonKeys[key]];
      const directValue = reviewedManual(direct) && typeof direct.value === 'number' && Number.isFinite(direct.value) && direct.value > 0
        ? direct.value : null;
      const wrapped = reviewedManual(packaging) && record(packaging.value) ? packaging.value[key] : null;
      return [key, directValue ?? (typeof wrapped === 'number' && Number.isFinite(wrapped) && wrapped > 0 ? wrapped : null)];
    }));
    if (MEASUREMENT_KEYS.some((key) => common[key] === null)) return null;
    const value = measurements(common);
    return sourceListingEditorSkuKeysForDraft(draft).map((skuKey) => ({ skuKey, ...value }));
  }
  if (!reviewedManual(packaging) || packaging.value !== null || !record(packaging.skuValues)) {
    fail('SKU packaging is not bound to reviewed manual evidence');
  }
  const items = Object.entries(packaging.skuValues).map(([skuKey, leaf]) => {
    if (!reviewedManual(leaf)) fail('Each SKU packaging leaf requires reviewed manual evidence');
    return { skuKey, ...measurements(leaf.value) };
  });
  const selectedKeys = sourceListingEditorSkuKeysForDraft(draft);
  assertSourceListingSkuPackagingCoverage(items, selectedKeys);
  return selectedKeys.map((skuKey) => items.find((item) => item.skuKey === skuKey)!);
}
