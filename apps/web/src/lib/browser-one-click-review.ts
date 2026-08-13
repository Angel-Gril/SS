export const BROWSER_ONE_CLICK_V2_HANDOFF_VERSION = 'browser-one-click-v2-handoff/v1' as const;

const BROWSER_ONE_CLICK_MAX_ITEMS = 100;
const HANDOFF_TEXT_MAX_LENGTH = 500;
const SOURCE_LISTING_HANDOFF_ID_MAX_LENGTH = 200;

export interface BrowserOneClickReviewDraft {
  supplyGoodsId: string;
  snapshotId: string;
  draftId: string;
  draftVersion: number;
  revision: number;
  skuKey: string;
  sourceSku: string;
}

export interface BrowserOneClickReviewFailure {
  errorCode: string;
  supplyGoodsId?: string;
}

export interface BrowserOneClickReviewFailureItem extends BrowserOneClickReviewFailure {
  sku?: string;
}

export interface BrowserOneClickReviewFailureSummary {
  errorCode: string;
  failures: BrowserOneClickReviewFailureItem[];
  missingSkus: string[];
  unknownSkus: string[];
  duplicateSkus: string[];
}

export interface BrowserOneClickReviewHandoff {
  contractVersion: typeof BROWSER_ONE_CLICK_V2_HANDOFF_VERSION;
  state: 'REVIEW_REQUIRED';
  drafts: BrowserOneClickReviewDraft[];
  failures: BrowserOneClickReviewFailure[];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function exactText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  return normalized === value
    && normalized.length > 0
    && normalized.length <= maxLength
    && !hasAsciiControl(normalized)
    ? normalized
    : null;
}

function exactId(value: unknown): string | null {
  return exactText(value, SOURCE_LISTING_HANDOFF_ID_MAX_LENGTH);
}

function exactRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function optionalText(value: unknown, maxLength: number): string | undefined | null {
  if (value == null || value === '') return undefined;
  return exactText(value, maxLength);
}

export function parseBrowserOneClickReviewHandoff(value: unknown): BrowserOneClickReviewHandoff | null {
  const candidate = objectValue(value);
  if (!candidate
    || candidate.contractVersion !== BROWSER_ONE_CLICK_V2_HANDOFF_VERSION
    || candidate.state !== 'REVIEW_REQUIRED'
    || !Array.isArray(candidate.drafts)
    || !Array.isArray(candidate.failures)
    || candidate.drafts.length === 0
    || candidate.drafts.length > BROWSER_ONE_CLICK_MAX_ITEMS
    || candidate.failures.length > BROWSER_ONE_CLICK_MAX_ITEMS
    || candidate.drafts.length + candidate.failures.length > BROWSER_ONE_CLICK_MAX_ITEMS) return null;

  const drafts: BrowserOneClickReviewDraft[] = [];
  const supplyGoodsIds = new Set<string>();
  const draftIds = new Set<string>();
  for (const raw of candidate.drafts) {
    const draft = objectValue(raw);
    if (!draft) return null;
    const supplyGoodsId = exactId(draft.supplyGoodsId);
    const snapshotId = exactId(draft.snapshotId);
    const draftId = exactId(draft.draftId);
    const draftVersion = exactRevision(draft.draftVersion);
    const revision = exactRevision(draft.revision);
    const skuKey = exactId(draft.skuKey);
    const sourceSku = exactId(draft.sourceSku);
    if (!supplyGoodsId || !snapshotId || !draftId || draftVersion == null
      || revision == null || !skuKey || !sourceSku
      || supplyGoodsIds.has(supplyGoodsId) || draftIds.has(draftId)) return null;
    supplyGoodsIds.add(supplyGoodsId);
    draftIds.add(draftId);
    drafts.push({
      supplyGoodsId,
      snapshotId,
      draftId,
      draftVersion,
      revision,
      skuKey,
      sourceSku,
    });
  }

  const failures: BrowserOneClickReviewFailure[] = [];
  for (const raw of candidate.failures) {
    const failure = objectValue(raw);
    if (!failure) return null;
    const errorCode = exactId(failure.errorCode);
    const supplyGoodsId = failure.supplyGoodsId == null
      ? undefined
      : exactId(failure.supplyGoodsId);
    if (!errorCode || supplyGoodsId === null) return null;
    failures.push({ errorCode, ...(supplyGoodsId ? { supplyGoodsId } : {}) });
  }

  return {
    contractVersion: BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
    state: 'REVIEW_REQUIRED',
    drafts,
    failures,
  };
}

function parseTextList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > BROWSER_ONE_CLICK_MAX_ITEMS) return null;
  const parsed: string[] = [];
  for (const item of value) {
    const text = exactText(item, HANDOFF_TEXT_MAX_LENGTH);
    if (!text) return null;
    parsed.push(text);
  }
  return parsed;
}

export function parseBrowserOneClickReviewFailure(value: unknown): BrowserOneClickReviewFailureSummary | null {
  const candidate = objectValue(value);
  if (!candidate
    || !Array.isArray(candidate.failures)
    || candidate.failures.length > BROWSER_ONE_CLICK_MAX_ITEMS) return null;
  const errorCode = exactText(candidate.errorCode, HANDOFF_TEXT_MAX_LENGTH);
  const missingSkus = parseTextList(candidate.missingSkus);
  const unknownSkus = parseTextList(candidate.unknownSkus);
  const duplicateSkus = parseTextList(candidate.duplicateSkus);
  if (!errorCode || !missingSkus || !unknownSkus || !duplicateSkus) return null;

  const failures: BrowserOneClickReviewFailureItem[] = [];
  for (const raw of candidate.failures) {
    const failure = objectValue(raw);
    if (!failure) return null;
    const failureErrorCode = exactText(failure.errorCode, HANDOFF_TEXT_MAX_LENGTH);
    const supplyGoodsId = optionalText(failure.supplyGoodsId, SOURCE_LISTING_HANDOFF_ID_MAX_LENGTH);
    const sku = optionalText(failure.sku, HANDOFF_TEXT_MAX_LENGTH);
    if (!failureErrorCode || supplyGoodsId === null || sku === null) return null;
    failures.push({
      errorCode: failureErrorCode,
      ...(supplyGoodsId ? { supplyGoodsId } : {}),
      ...(sku ? { sku } : {}),
    });
  }

  return { errorCode, failures, missingSkus, unknownSkus, duplicateSkus };
}

export function browserOneClickReviewDraftHref(draft: BrowserOneClickReviewDraft): string | null {
  const supplyGoodsId = exactId(draft.supplyGoodsId);
  const snapshotId = exactId(draft.snapshotId);
  const draftId = exactId(draft.draftId);
  if (!supplyGoodsId || !snapshotId || !draftId) return null;
  const query = new URLSearchParams();
  query.set('supplyGoodsId', supplyGoodsId);
  query.set('snapshotId', snapshotId);
  query.set('workflowId', draftId);
  query.set('section', 'listing');
  return `/collect/source?${query.toString()}`;
}
