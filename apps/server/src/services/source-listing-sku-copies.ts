import { createHash } from 'node:crypto';
import type {
  OzonListingDraft,
  SourceListingOfferRow,
  SourceListingOfferRows,
  SourceProductCaptureV2,
} from 'shared';
import { SOURCE_LISTING_OFFER_ROWS_CONTRACT_VERSION, SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS, SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
  OZON_LISTING_SUPPORTED_CURRENCY_CODES, OZON_LISTING_SUPPORTED_VAT_RATES, isOzonListingOldPriceAtLeastPrice } from 'shared';
import { inspectSourceListingJsonValue, SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES, SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES } from './source-listing-json-limits.js';

export const SOURCE_LISTING_OFFER_ROWS_MAX = 100;
type OfferRowDraftShape = { selectedSkuKeys: string[]; offerRows?: SourceListingOfferRows;
  id?: string; sourceCaptureSnapshotId?: string; sourceCaptureHash?: string; revision?: number; draftVersion?: number;
  auditEvents?: Array<{ type?: string; draftVersion?: number; details?: Record<string, unknown> }> };
const IDENTIFIER_MAX = SOURCE_LISTING_SKU_KEY_MAX_LENGTH;

export class SourceListingOfferRowsError extends Error {
  readonly code = 'OZON_LISTING_DRAFT_INPUT_INVALID';
  readonly statusCode = 400;
}
function invalid(message: string): never { throw new SourceListingOfferRowsError(message); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function exact(value: unknown, max = IDENTIFIER_MAX): string {
  if (typeof value !== 'string' || !value || value !== value.normalize('NFKC').trim()
    || value.length > max || Array.from(value).some((character) => (character.codePointAt(0) || 0) < 32 || character === '\u007f')) invalid('source listing offer row identifier is invalid');
  return value;
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }

export function deriveSourceListingSkuCopyKey(draftId: string, operationKey: string): string {
  const digest = hash(JSON.stringify({ contractVersion: SOURCE_LISTING_OFFER_ROWS_CONTRACT_VERSION, draftId, operationKey }));
  return `listing-copy:${digest}`;
}

export function normalizeSourceListingOfferRows(value: unknown, selectedSkuKeys: readonly string[]): SourceListingOfferRows {
  const selected = new Set(selectedSkuKeys);
  if (!Array.isArray(value)) invalid('source listing offer rows must be an array');
  if (value.length && value.length + selectedSkuKeys.length > SOURCE_LISTING_OFFER_ROWS_MAX) invalid('source listing offer rows exceed the total limit');
  const rows: SourceListingOfferRow[] = [];
  const rowKeys = new Set<string>();
  const offerIds = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('source listing offer row is invalid');
    const row = raw as Record<string, unknown>;
    if (!exactKeys(row, ['rowKey', 'sourceSkuKey', 'offerId', 'sourceCaptureSnapshotId', 'sourceCaptureHash', 'sourceDraftVersion',
      'sourceDraftRevision', 'pricing', 'packaging', 'attributes'])) invalid('source listing offer row fields are invalid');
    const rowKey = exact(row.rowKey);
    const sourceSkuKey = exact(row.sourceSkuKey);
    const offerId = exact(row.offerId, 50);
    if (selected.has(rowKey) || !selected.has(sourceSkuKey) || rowKeys.has(rowKey) || offerIds.has(offerId)) {
      invalid('source listing offer row identity is duplicated or not source-owned');
    }
    if (row.rowKey === row.sourceSkuKey || !/^listing-copy:[a-f0-9]{64}$/u.test(rowKey)) invalid('source listing offer row key is invalid');
    const snapshot = exact(row.sourceCaptureSnapshotId, 200);
    const sourceHash = exact(row.sourceCaptureHash, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(sourceHash)
      || !Number.isSafeInteger(row.sourceDraftVersion) || Number(row.sourceDraftVersion) < 1
      || !Number.isSafeInteger(row.sourceDraftRevision) || Number(row.sourceDraftRevision) < 1) {
      invalid('source listing offer row provenance is invalid');
    }
    if (row.pricing !== null) {
      if (!record(row.pricing) || !exactKeys(row.pricing, ['skuKey', 'price', 'oldPrice', 'currencyCode', 'vat', 'offerId'])
        || row.pricing.skuKey !== rowKey || row.pricing.offerId !== offerId
        || typeof row.pricing.price !== 'string' || typeof row.pricing.oldPrice !== 'string'
        || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(row.pricing.price) || Number(row.pricing.price) <= 0
        || !isOzonListingOldPriceAtLeastPrice(row.pricing.price, row.pricing.oldPrice)
        || !OZON_LISTING_SUPPORTED_CURRENCY_CODES.includes(row.pricing.currencyCode as any)
        || !OZON_LISTING_SUPPORTED_VAT_RATES.includes(row.pricing.vat as any)) invalid('source listing offer row pricing is invalid');
    }
    if (row.packaging !== null && (!record(row.packaging) || !exactKeys(row.packaging, ['weightG', 'lengthMm', 'widthMm', 'heightMm'])
      || Object.values(row.packaging).some((measurement) => typeof measurement !== 'number' || !Number.isFinite(measurement) || measurement <= 0))) invalid('source listing offer row packaging is invalid');
    if (!row.attributes || typeof row.attributes !== 'object' || Array.isArray(row.attributes)) invalid('source listing offer row attributes are invalid');
    if (!inspectSourceListingJsonValue(row.attributes, { maxBytes: SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES,
      maxNodes: SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES, maxDepth: 16 }).valid) invalid('source listing offer row attributes exceed the limit');
    rowKeys.add(rowKey); offerIds.add(offerId);
    rows.push({ rowKey, sourceSkuKey, offerId, sourceCaptureSnapshotId: snapshot, sourceCaptureHash: sourceHash,
      sourceDraftVersion: Number(row.sourceDraftVersion), sourceDraftRevision: Number(row.sourceDraftRevision),
      pricing: structuredClone(row.pricing) as SourceListingOfferRow['pricing'],
      packaging: structuredClone(row.packaging) as SourceListingOfferRow['packaging'],
      attributes: structuredClone(row.attributes) as SourceListingOfferRow['attributes'] });
  }
  return { contractVersion: SOURCE_LISTING_OFFER_ROWS_CONTRACT_VERSION, rows };
}

export function sourceListingOfferRowsForDraft(draft: OfferRowDraftShape): SourceListingOfferRow[] {
  if (draft.offerRows === undefined) return [];
  if (!record(draft.offerRows) || !exactKeys(draft.offerRows, ['contractVersion', 'rows'])
    || draft.offerRows.contractVersion !== SOURCE_LISTING_OFFER_ROWS_CONTRACT_VERSION) invalid('source listing offer rows contract is invalid');
  const rows = normalizeSourceListingOfferRows(draft.offerRows.rows, draft.selectedSkuKeys).rows;
  if (!rows.length) return rows;
  const id = exact(draft.id, 200);
  const snapshotId = exact(draft.sourceCaptureSnapshotId, 200);
  const captureHash = exact(draft.sourceCaptureHash, 64);
  const { revision, draftVersion, auditEvents } = draft;
  if (!/^[a-f0-9]{64}$/u.test(captureHash) || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
    || typeof draftVersion !== 'number' || !Number.isSafeInteger(draftVersion) || draftVersion < 1
    || !Array.isArray(auditEvents)) invalid('Copied SKU rows require the complete current draft authority proof');
  for (const row of rows) {
    if (row.sourceCaptureSnapshotId !== snapshotId || row.sourceCaptureHash !== captureHash
      || row.sourceDraftRevision >= revision || row.sourceDraftVersion >= draftVersion) invalid('source listing offer row context is stale');
    const receipt = auditEvents.find((entry) => record(entry) && entry.type === 'SKU_DUPLICATED' && record(entry.details)
      && entry.details.rowKey === row.rowKey && entry.details.sourceSkuKey === row.sourceSkuKey);
    const operationKey = receipt?.details?.editorOperationKey;
    if (!receipt || receipt.draftVersion !== row.sourceDraftVersion + 1 || typeof operationKey !== 'string'
      || operationKey.length < 8 || operationKey.length > 128 || operationKey !== operationKey.trim()
      || deriveSourceListingSkuCopyKey(id, operationKey) !== row.rowKey) invalid('source listing offer row provenance is invalid');
  }
  return rows;
}

export function sourceListingSkuCopiesForDraft(draft: OzonListingDraft): SourceListingOfferRow[] {
  return sourceListingOfferRowsForDraft(draft);
}

export function sourceListingEditorSkuKeysForDraft(draft: OfferRowDraftShape): string[] {
  return [...draft.selectedSkuKeys, ...sourceListingOfferRowsForDraft(draft).map((row) => row.rowKey)];
}

export function sourceListingSourceSkuKeysForDraft(draft: OzonListingDraft): string[] {
  return [...draft.selectedSkuKeys];
}

/**
 * Creates a read-only capture projection for downstream authorities. The persisted capture is
 * never modified; copied rows retain source evidence and sourceSkuId while using their server
 * row key as the canonical projected key. Media associations are extended to the copy key.
 */
export function projectSourceCaptureForDraft(capture: SourceProductCaptureV2, draft: OzonListingDraft): SourceProductCaptureV2 {
  const rows = sourceListingSkuCopiesForDraft(draft);
  if (!rows.length) return structuredClone(capture);
  const next = structuredClone(capture);
  const sourceByKey = new Map(next.skus.map((sku) => [sku.key, sku]));
  for (const row of rows) {
    const source = sourceByKey.get(row.sourceSkuKey);
    if (!source) invalid('source listing offer row source SKU is absent from capture');
    next.skus.push({ ...structuredClone(source), key: row.rowKey, ordinal: next.skus.length });
  }
  next.media = next.media.map((media) => {
    const expanded = [...media.skuKeys];
    for (const row of rows) {
      const source = sourceByKey.get(row.sourceSkuKey);
      if (source?.mediaKeys.includes(media.key) || media.skuKeys.includes(row.sourceSkuKey)) expanded.push(row.rowKey);
    }
    return { ...media, skuKeys: [...new Set(expanded)] };
  });
  return next;
}

export function assertSourceListingOfferRowsLimit(draft: OzonListingDraft): void {
  if (draft.selectedSkuKeys.length > SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS
    || sourceListingSkuCopiesForDraft(draft).length > SOURCE_LISTING_OFFER_ROWS_MAX) invalid('source listing offer rows exceed the limit');
}
