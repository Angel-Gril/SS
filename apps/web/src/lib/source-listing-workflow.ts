import {
  OZON_LISTING_CURRENCY_CODE_LENGTH,
  OZON_LISTING_DECIMAL_MAX_LENGTH,
  OZON_LISTING_IMPORT_MAX_ITEMS,
  OZON_LISTING_OFFER_ID_MAX_LENGTH,
  OZON_LISTING_PRICING_CONTRACT_VERSION,
  OZON_LISTING_SUPPORTED_CURRENCY_CODES,
  OZON_LISTING_SUPPORTED_VAT_RATES,
  SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
  SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH,
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
  isOzonListingOldPriceAtLeastPrice,
  type OzonListingAiCopyCandidateView as OzonListingAiCopyCandidate,
  type OzonListingDraftView as OzonListingDraft,
  type OzonListingDraftMediaAssignment,
  type OzonListingCurrencyCode,
  type OzonListingPricingV1,
  type OzonListingVatRate,
  type SourceProductCaptureV2,
} from 'shared';
import { api } from '@/lib/api';

const SOURCE_LISTING_API_BASE = '/api/source-listing-workflows';
const SOURCE_CAPTURE_VIEW_API_BASE = '/api/source-capture-views';
const HANDOFF_KEYS = [
  'supplyGoodsId',
  'snapshotId',
  'snapshotVersion',
  'sourceProductId',
  'platform',
  'section',
  'workflowId',
  'attemptId',
] as const;
const HANDOFF_KEY_SET = new Set<string>(HANDOFF_KEYS);
const HANDOFF_ID_MAX_LENGTH = 200;
const CAPTURE_PAGE_LIMIT_MAX = 100;
const CAPTURE_SKU_OFFSET_MAX = 10_000;
const CAPTURE_MEDIA_OFFSET_MAX = 20_000;
const ATTEMPT_LIST_LIMIT_MAX = 100;

export type SourceListingPublishAttemptState =
  | 'PREPARED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'UNKNOWN'
  | 'REJECTED';

export type SourceListingPublishReconciliationState =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'SUCCEEDED'
  | 'PARTIAL_FAILURE'
  | 'FAILED'
  | 'MANUAL_REVIEW';

export interface SourceListingHandoff {
  supplyGoodsId: string;
  snapshotId: string;
  snapshotVersion?: number;
  sourceProductId?: string;
  platform?: '1688' | 'pdd' | 'taobao' | 'tmall';
  section?: 'listing';
  workflowId?: string;
  attemptId?: string;
}

export interface SourceListingAiCopyGenerationResult {
  candidate: OzonListingAiCopyCandidate;
  limit?: { used: number; remaining: number; limit: number };
}

export interface SourceListingAiCopyCapability {
  enabled: boolean;
  revision: number;
  reason:
    | 'master_off'
    | 'tenant_allowed'
    | 'tenant_not_allowed'
    | 'invalid_policy'
    | 'listing_copy_off'
    | 'provider_not_ready';
}

export interface SourceCaptureViewPage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface SourceCaptureViewStageCount {
  observedCount: number | null;
  capturedCount: number;
  submittedCount: number;
  persistedCount: number;
  displayedCount: number;
  truncated: boolean;
  reason: string | null;
}

export interface SourceCaptureViewStageCounts {
  version: 'source-capture-stage-counts-v1';
  fields: Record<string, SourceCaptureViewStageCount>;
}

export interface SourceCaptureView {
  snapshotId: string;
  supplyGoodsId: string;
  version: number;
  capturedAt: string;
  captureHash: string;
  captureVersion: SourceProductCaptureV2['captureVersion'];
  sourceIdentity: SourceProductCaptureV2['sourceIdentity'];
  facts: SourceProductCaptureV2['facts'];
  completeness: SourceProductCaptureV2['completeness'];
  truncations: SourceProductCaptureV2['truncations'];
  counts: SourceCaptureViewStageCounts;
  skus: SourceCaptureViewPage<SourceProductCaptureV2['skus'][number]>;
  media: SourceCaptureViewPage<SourceProductCaptureV2['media'][number] & { displayUrl?: string }>;
}

export interface SourceCaptureViewRequest {
  skuOffset?: number;
  skuLimit?: number;
  mediaOffset?: number;
  mediaLimit?: number;
}

export interface SourceListingPublisherCapability {
  enabled: boolean;
  legacyAllowed: boolean;
  reason: string;
  revision: string;
}

export interface SourceListingInternalizedMediaAsset {
  id: string;
  ownerUserId: string;
  kind?: 'SOURCE_ORIGINAL';
  sourceCaptureSnapshotId: string;
  sourceMediaKey: string;
  sourceUrl: string;
  url: string;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SourceListingMediaInternalizeResult {
  assets: SourceListingInternalizedMediaAsset[];
  assignments: OzonListingDraftMediaAssignment[];
}

export type SourceListingMediaSelection =
  | { sourceMediaKey: string; slotKey: string; scope: 'PRODUCT'; skuKey?: never }
  | { sourceMediaKey: string; slotKey: string; scope: 'SKU'; skuKey: string };

export interface SourceListingPublishOfferTraceEntry {
  ordinal: number;
  offerId: string;
  skuKey: string;
}

export interface SourceListingPublishAttempt {
  id: string;
  workflowId: string;
  draftVersion: number;
  revision: number;
  state: SourceListingPublishAttemptState;
  reconciliationState: SourceListingPublishReconciliationState;
  stateVersion: number;
  ozonTaskId: string | null;
  requestPayloadHash: string;
  itemCount: number;
  offerTrace?: SourceListingPublishOfferTraceEntry[];
  itemResults?: unknown[] | null;
  itemResultCount?: number;
  itemResultsTruncated?: boolean;
  itemErrors: unknown[];
  itemErrorCount?: number;
  itemErrorsTruncated?: boolean;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  nextReconcileAt?: string | null;
  reconcileAttemptCount?: number;
  completedAt?: string | null;
  resolutionNote?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SourceListingPublishAttemptList {
  items: SourceListingPublishAttempt[];
  nextCursor: string | null;
}

export interface SourceListingApiResponse<T> {
  code: number;
  msg?: string;
  data?: T;
  errorCode?: string;
  current?: unknown;
  currentVersion?: number;
  currentDraftVersion?: number;
  maintenance?: boolean;
}

export interface SourceListingApiTransport {
  get<T>(path: string): Promise<SourceListingApiResponse<T>>;
  post<T>(path: string, body?: unknown): Promise<SourceListingApiResponse<T>>;
  put<T>(path: string, body?: unknown): Promise<SourceListingApiResponse<T>>;
  patch<T>(path: string, body?: unknown): Promise<SourceListingApiResponse<T>>;
}

export class SourceListingWorkflowClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SourceListingWorkflowClientError';
  }
}

export class SourceListingWorkflowApiError extends SourceListingWorkflowClientError {
  readonly errorCode: string | undefined;
  readonly current: unknown;
  readonly currentVersion: number | undefined;
  readonly currentDraftVersion: number | undefined;
  readonly response: SourceListingApiResponse<unknown>;

  constructor(response: SourceListingApiResponse<unknown>) {
    super('API_ERROR', response.msg || response.errorCode || '来源商品工作流请求失败');
    this.name = 'SourceListingWorkflowApiError';
    this.errorCode = response.errorCode;
    this.current = response.current;
    this.currentVersion = response.currentVersion;
    this.currentDraftVersion = response.currentDraftVersion;
    this.response = response;
  }
}

export class SourceListingPollLimitError extends SourceListingWorkflowClientError {
  constructor(public readonly lastAttempt: SourceListingPublishAttempt | null) {
    super('POLL_LIMIT', 'Ozon 发布任务轮询已达到本次上限');
    this.name = 'SourceListingPollLimitError';
  }
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

type HandoffQuery = string | {
  entries(): IterableIterator<[string, string]>;
  getAll(name: string): string[];
};

type ParsedHandoffQuery = Exclude<HandoffQuery, string>;

function exactText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', `${field} 必须是字符串`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || normalized.length > maxLength || hasAsciiControl(normalized)) {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', `${field} 不是规范化的有效值`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > max) {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', `${field} 必须是正整数`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', `${field} 必须是非负整数`);
  }
  return Number(value);
}

function uniqueExactStrings(values: unknown, field: string, maximum: number, maxLength: number): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', `${field} 数量无效`);
  }
  const normalized = values.map((value, index) => exactText(value, `${field}[${index}]`, maxLength));
  if (new Set(normalized).size !== normalized.length) {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', `${field} 不能包含重复值`);
  }
  return normalized;
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function queryFromInput(input: HandoffQuery): ParsedHandoffQuery {
  if (typeof input !== 'string') return input;
  const raw = input.startsWith('?') ? input.slice(1) : input;
  return new URLSearchParams(raw);
}

export function parseSourceListingHandoff(input: HandoffQuery): SourceListingHandoff {
  const query = queryFromInput(input);
  for (const [key] of query.entries()) {
    if (!HANDOFF_KEY_SET.has(key)) {
      throw new SourceListingWorkflowClientError('INVALID_HANDOFF', `handoff 参数 ${key || '<empty>'} 不受支持`);
    }
  }
  const values = Object.fromEntries(HANDOFF_KEYS.map((key) => {
    const entries = query.getAll(key);
    if (entries.length > 1) {
      throw new SourceListingWorkflowClientError('INVALID_HANDOFF', `handoff 参数 ${key} 不能重复`);
    }
    if (!entries.length) return [key, undefined];
    try {
      const value = exactText(entries[0], key, HANDOFF_ID_MAX_LENGTH);
      if (key === 'snapshotVersion') {
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('invalid snapshot version');
        return [key, value];
      }
      if (key === 'sourceProductId') {
        if (!/^[1-9]\d*$/.test(value) || BigInt(value) <= 0n) throw new Error('invalid source product ID');
        return [key, value];
      }
      if (key === 'platform') {
        if (!['1688', 'pdd', 'taobao', 'tmall'].includes(value)) throw new Error('invalid handoff platform');
        return [key, value];
      }
      if (key === 'section' && value !== 'listing') throw new Error('invalid handoff section');
      return [key, value];
    } catch {
      throw new SourceListingWorkflowClientError('INVALID_HANDOFF', `handoff 参数 ${key} 无效`);
    }
  })) as Record<(typeof HANDOFF_KEYS)[number], string | undefined>;
  if (!values.supplyGoodsId || !values.snapshotId) {
    throw new SourceListingWorkflowClientError('INVALID_HANDOFF', 'handoff 必须同时包含 supplyGoodsId 和 snapshotId');
  }
  if (values.attemptId && !values.workflowId) {
    throw new SourceListingWorkflowClientError('INVALID_HANDOFF', 'handoff 的 attemptId 必须同时包含 workflowId');
  }
  return {
    supplyGoodsId: values.supplyGoodsId,
    snapshotId: values.snapshotId,
    ...(values.snapshotVersion ? { snapshotVersion: Number(values.snapshotVersion) } : {}),
    ...(values.sourceProductId ? { sourceProductId: values.sourceProductId } : {}),
    ...(values.platform ? { platform: values.platform as SourceListingHandoff['platform'] } : {}),
    ...(values.section ? { section: 'listing' as const } : {}),
    ...(values.workflowId ? { workflowId: values.workflowId } : {}),
    ...(values.attemptId ? { attemptId: values.attemptId } : {}),
  };
}

export function buildSourceListingHandoffSearchParams(handoff: SourceListingHandoff): URLSearchParams {
  const parsed = parseSourceListingHandoff(new URLSearchParams({
    supplyGoodsId: handoff.supplyGoodsId,
    snapshotId: handoff.snapshotId,
    ...(handoff.snapshotVersion !== undefined ? { snapshotVersion: String(handoff.snapshotVersion) } : {}),
    ...(handoff.sourceProductId ? { sourceProductId: handoff.sourceProductId } : {}),
    ...(handoff.platform ? { platform: handoff.platform } : {}),
    ...(handoff.section ? { section: handoff.section } : {}),
    ...(handoff.workflowId ? { workflowId: handoff.workflowId } : {}),
    ...(handoff.attemptId ? { attemptId: handoff.attemptId } : {}),
  }));
  return new URLSearchParams({
    supplyGoodsId: parsed.supplyGoodsId,
    snapshotId: parsed.snapshotId,
    ...(parsed.snapshotVersion !== undefined ? { snapshotVersion: String(parsed.snapshotVersion) } : {}),
    ...(parsed.sourceProductId ? { sourceProductId: parsed.sourceProductId } : {}),
    ...(parsed.platform ? { platform: parsed.platform } : {}),
    ...(parsed.section ? { section: parsed.section } : {}),
    ...(parsed.workflowId ? { workflowId: parsed.workflowId } : {}),
    ...(parsed.attemptId ? { attemptId: parsed.attemptId } : {}),
  });
}

function pricingFailure(message: string): never {
  throw new SourceListingWorkflowClientError('INVALID_PRICING', message);
}

function exactPositiveDecimal(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.length > OZON_LISTING_DECIMAL_MAX_LENGTH
    || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    || !/[1-9]/.test(value.replace('.', ''))) {
    pricingFailure(`${field} 必须是规范化的正十进制字符串`);
  }
  return value;
}

export interface SourceListingPricingBuilderInput {
  selectedSkuKeys: string[];
  items: Array<{
    skuKey: string;
    price: string;
    oldPrice: string;
    currencyCode: OzonListingCurrencyCode;
    vat: string;
    offerId?: string;
  }>;
}

export function buildOzonListingPricingV1(input: SourceListingPricingBuilderInput): OzonListingPricingV1 {
  let selectedSkuKeys: string[];
  try {
    selectedSkuKeys = uniqueExactStrings(
      input?.selectedSkuKeys,
      'selectedSkuKeys',
      OZON_LISTING_IMPORT_MAX_ITEMS,
      SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
    );
  } catch (error) {
    pricingFailure(error instanceof Error ? error.message : 'selectedSkuKeys 无效');
  }
  if (!Array.isArray(input?.items) || input.items.length !== selectedSkuKeys.length) {
    pricingFailure('pricing items 必须精确覆盖已选 canonical SKU');
  }
  const bySku = new Map<string, OzonListingPricingV1['items'][number]>();
  const supportedCurrencies = new Set<string>(OZON_LISTING_SUPPORTED_CURRENCY_CODES);
  const supportedVatRates = new Set<string>(OZON_LISTING_SUPPORTED_VAT_RATES);
  let pricingCurrency: OzonListingCurrencyCode | null = null;
  for (const [index, raw] of input.items.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) pricingFailure(`pricing item ${index} 无效`);
    const keys = Object.keys(raw);
    const supported = new Set(['skuKey', 'price', 'oldPrice', 'currencyCode', 'vat', 'offerId']);
    if (keys.some((key) => !supported.has(key))
      || !['skuKey', 'price', 'oldPrice', 'currencyCode', 'vat'].every((key) => keys.includes(key))) {
      pricingFailure(`pricing item ${index} 包含不支持的字段`);
    }
    let skuKey: string;
    try {
      skuKey = exactText(raw.skuKey, `items[${index}].skuKey`, SOURCE_LISTING_SKU_KEY_MAX_LENGTH);
    } catch (error) {
      pricingFailure(error instanceof Error ? error.message : `pricing item ${index} SKU 无效`);
    }
    if (bySku.has(skuKey)) pricingFailure(`SKU ${skuKey} 的定价重复`);
    if (typeof raw.currencyCode !== 'string'
      || raw.currencyCode.length !== OZON_LISTING_CURRENCY_CODE_LENGTH
      || !supportedCurrencies.has(raw.currencyCode)
      || (pricingCurrency !== null && raw.currencyCode !== pricingCurrency)) {
      pricingFailure(`SKU ${skuKey} 的 currencyCode 必须统一使用 CNY 或 RUB`);
    }
    const currencyCode = raw.currencyCode as OzonListingCurrencyCode;
    pricingCurrency = currencyCode;
    if (typeof raw.vat !== 'string' || !supportedVatRates.has(raw.vat)) {
      pricingFailure(`SKU ${skuKey} 的 VAT 必须使用 Ozon 官方税率`);
    }
    const vat = raw.vat as OzonListingVatRate;
    let offerId: string | undefined;
    if (raw.offerId !== undefined) {
      try {
        offerId = exactText(raw.offerId, `items[${index}].offerId`, OZON_LISTING_OFFER_ID_MAX_LENGTH);
      } catch (error) {
        pricingFailure(error instanceof Error ? error.message : `SKU ${skuKey} 的 offerId 无效`);
      }
    }
    const price = exactPositiveDecimal(raw.price, `SKU ${skuKey} price`);
    const oldPrice = exactPositiveDecimal(raw.oldPrice, `SKU ${skuKey} oldPrice`);
    if (!isOzonListingOldPriceAtLeastPrice(price, oldPrice)) {
      pricingFailure(`SKU ${skuKey} 的划线价不得低于售价`);
    }
    bySku.set(skuKey, {
      skuKey,
      price,
      oldPrice,
      currencyCode,
      vat,
      ...(offerId ? { offerId } : {}),
    });
  }
  if (bySku.size !== selectedSkuKeys.length || selectedSkuKeys.some((key) => !bySku.has(key))) {
    pricingFailure('pricing items 必须精确覆盖已选 canonical SKU');
  }
  return {
    contractVersion: OZON_LISTING_PRICING_CONTRACT_VERSION,
    items: selectedSkuKeys.map((key) => bySku.get(key)!),
  };
}

function fnv1a64(value: string, seed: bigint): string {
  let hash = seed;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function buildSourceListingPublishIdempotencyKey(input: {
  draftId: string;
  draftVersion: number;
  revision: number;
}): string {
  const draftId = exactText(input?.draftId, 'draftId', HANDOFF_ID_MAX_LENGTH);
  const draftVersion = positiveInteger(input?.draftVersion, 'draftVersion');
  const revision = positiveInteger(input?.revision, 'revision');
  const identity = JSON.stringify({ contractVersion: 'source-listing-publish-idempotency/v1', draftId, draftVersion, revision });
  const digest = `${fnv1a64(identity, 0xcbf29ce484222325n)}${fnv1a64(identity, 0x84222325cbf29ce4n)}`;
  const key = `source-publish-v1-${digest}`;
  if (key.length < SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH
    || key.length > SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', '发布幂等键长度无效');
  }
  return key;
}

function unwrap<T>(response: SourceListingApiResponse<T>): T {
  if (response?.code === 1 && response.data !== undefined) return response.data;
  throw new SourceListingWorkflowApiError(response || { code: 0, msg: '来源商品工作流没有返回结果' });
}

function capturePageRequest(input: SourceCaptureViewRequest = {}) {
  const skuOffset = nonNegativeInteger(input.skuOffset ?? 0, 'skuOffset');
  const mediaOffset = nonNegativeInteger(input.mediaOffset ?? 0, 'mediaOffset');
  if (skuOffset > CAPTURE_SKU_OFFSET_MAX || mediaOffset > CAPTURE_MEDIA_OFFSET_MAX) {
    throw new SourceListingWorkflowClientError('INVALID_INPUT', 'capture view 分页偏移超出范围');
  }
  return {
    skuOffset,
    skuLimit: positiveInteger(input.skuLimit ?? 50, 'skuLimit', CAPTURE_PAGE_LIMIT_MAX),
    mediaOffset,
    mediaLimit: positiveInteger(input.mediaLimit ?? 50, 'mediaLimit', CAPTURE_PAGE_LIMIT_MAX),
  };
}

function validateCaptureView(view: SourceCaptureView, handoff: SourceListingHandoff): SourceCaptureView {
  if (!view || typeof view !== 'object'
    || view.snapshotId !== handoff.snapshotId
    || view.supplyGoodsId !== handoff.supplyGoodsId
    || !Number.isSafeInteger(view.version) || view.version <= 0
    || typeof view.capturedAt !== 'string' || !Number.isFinite(Date.parse(view.capturedAt))
    || !/^[a-f0-9]{64}$/.test(String(view.captureHash || ''))
    || view.captureVersion !== 'source-product-capture-v2'
    || !Array.isArray(view.truncations)
    || !view.counts || typeof view.counts !== 'object' || Array.isArray(view.counts)
    || !view.counts.fields || typeof view.counts.fields !== 'object' || Array.isArray(view.counts.fields)
    || !view.skus || !Array.isArray(view.skus.items)
    || !view.media || !Array.isArray(view.media.items)) {
    throw new SourceListingWorkflowClientError('INVALID_RESPONSE', 'capture view 与 handoff 不匹配');
  }
  return view;
}

function validateCapability(value: SourceListingPublisherCapability): SourceListingPublisherCapability {
  if (!value || typeof value.enabled !== 'boolean' || typeof value.legacyAllowed !== 'boolean'
    || typeof value.reason !== 'string' || typeof value.revision !== 'string') {
    throw new SourceListingWorkflowClientError('INVALID_RESPONSE', 'publisher capability 响应无效');
  }
  return value;
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SourceListingWorkflowClientError('POLL_CANCELLED', 'Ozon 发布任务轮询已取消');
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  abortIfRequested(signal);
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new SourceListingWorkflowClientError('POLL_CANCELLED', 'Ozon 发布任务轮询已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function isTerminalSourceListingPublishAttempt(attempt: SourceListingPublishAttempt): boolean {
  if (attempt.state === 'REJECTED') return true;
  return ['SUCCEEDED', 'PARTIAL_FAILURE', 'FAILED', 'MANUAL_REVIEW'].includes(attempt.reconciliationState);
}

export interface SourceListingAttemptPollOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  isTerminal?: (attempt: SourceListingPublishAttempt) => boolean;
}

export function createSourceListingWorkflowClient(
  transport: SourceListingApiTransport = api as unknown as SourceListingApiTransport,
) {
  const getDraft = async (draftId: string) => unwrap(await transport.get<OzonListingDraft>(
    `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}`,
  ));

  const getPublishAttempt = async (draftId: string, attemptId: string) => unwrap(await transport.get<SourceListingPublishAttempt>(
    `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}`
      + `/publish-attempts/${encoded(exactText(attemptId, 'attemptId', HANDOFF_ID_MAX_LENGTH))}`,
  ));

  return {
    async getCaptureView(handoff: SourceListingHandoff, request: SourceCaptureViewRequest = {}) {
      const trustedHandoff = parseSourceListingHandoff(buildSourceListingHandoffSearchParams(handoff));
      const page = capturePageRequest(request);
      const query = new URLSearchParams({
        supplyGoodsId: trustedHandoff.supplyGoodsId,
        skuOffset: String(page.skuOffset),
        skuLimit: String(page.skuLimit),
        mediaOffset: String(page.mediaOffset),
        mediaLimit: String(page.mediaLimit),
      });
      const view = unwrap(await transport.get<SourceCaptureView>(
        `${SOURCE_CAPTURE_VIEW_API_BASE}/${encoded(trustedHandoff.snapshotId)}?${query}`,
      ));
      return validateCaptureView(view, trustedHandoff);
    },

    async createWorkflowFromSnapshot(input: {
      handoff: SourceListingHandoff;
      shopId: string;
      selectedSkuKeys: string[];
    }) {
      const handoff = parseSourceListingHandoff(buildSourceListingHandoffSearchParams(input.handoff));
      const shopId = exactText(input.shopId, 'shopId', HANDOFF_ID_MAX_LENGTH);
      const selectedSkuKeys = uniqueExactStrings(
        input.selectedSkuKeys,
        'selectedSkuKeys',
        SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
        SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
      );
      return unwrap(await transport.post<OzonListingDraft>(SOURCE_LISTING_API_BASE, {
        supplyGoodsId: handoff.supplyGoodsId,
        shopId,
        sourceCaptureSnapshotId: handoff.snapshotId,
        selectedSkuKeys,
      }));
    },

    getDraft,

    async updateCategory(draftId: string, input: {
      expectedRevision: number;
      category: {
        categoryId: number;
        typeId: number;
        catalogRevision: string;
        categoryName?: string;
        typeName?: string;
      };
    }) {
      return unwrap(await transport.patch<OzonListingDraft>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}`,
        {
          expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'),
          category: {
            categoryId: positiveInteger(input.category.categoryId, 'categoryId'),
            typeId: positiveInteger(input.category.typeId, 'typeId'),
            catalogRevision: exactText(input.category.catalogRevision, 'catalogRevision', HANDOFF_ID_MAX_LENGTH),
            ...(input.category.categoryName
              ? { categoryName: exactText(input.category.categoryName, 'categoryName', 500) }
              : {}),
            ...(input.category.typeName
              ? { typeName: exactText(input.category.typeName, 'typeName', 500) }
              : {}),
          },
        },
      ));
    },

    async getPublisherCapability(shopId: string) {
      const capability = unwrap(await transport.get<SourceListingPublisherCapability>(
        `${SOURCE_LISTING_API_BASE}/publisher-capability?shopId=${encoded(exactText(shopId, 'shopId', HANDOFF_ID_MAX_LENGTH))}`,
      ));
      return validateCapability(capability);
    },

    async createCopyCandidate(draftId: string, input: {
      expectedRevision: number;
      titleRu?: string | null;
      descriptionRu?: string | null;
      sourcePromptVersion: string;
    }) {
      if (input.titleRu === undefined && input.descriptionRu === undefined) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', '文案候选至少需要标题或描述');
      }
      return unwrap(await transport.post<OzonListingAiCopyCandidate>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/ai-candidates`,
        {
          expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'),
          ...(input.titleRu !== undefined ? { titleRu: input.titleRu } : {}),
          ...(input.descriptionRu !== undefined ? { descriptionRu: input.descriptionRu } : {}),
          sourcePromptVersion: exactText(input.sourcePromptVersion, 'sourcePromptVersion', HANDOFF_ID_MAX_LENGTH),
        },
      ));
    },

    async generateCopyCandidate(draftId: string, input: {
      expectedRevision: number;
      operationKey: string;
      fields: Array<'title' | 'description'>;
      userInstructions?: string;
    }) {
      const fields = [...new Set(input.fields)];
      if (!fields.length || fields.length > 2) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', '请选择标题或描述生成范围');
      }
      return unwrap(await transport.post<SourceListingAiCopyGenerationResult>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/ai-candidates/generate`,
        {
          expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'),
          operationKey: exactText(input.operationKey, 'operationKey', HANDOFF_ID_MAX_LENGTH),
          fields,
          ...(input.userInstructions?.trim()
            ? { userInstructions: exactText(input.userInstructions, 'userInstructions', 2000) }
            : {}),
        },
      ));
    },

    async getAiCopyCapability(draftId: string) {
      return unwrap(await transport.get<SourceListingAiCopyCapability>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/ai-copy-capability`,
      ));
    },

    async applyCopyCandidate(draftId: string, input: {
      expectedRevision: number;
      candidateId: string;
      operationKey: string;
    }) {
      return unwrap(await transport.post<OzonListingDraft>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/ai-candidates/apply`,
        {
          expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'),
          candidateId: exactText(input.candidateId, 'candidateId', HANDOFF_ID_MAX_LENGTH),
          operationKey: exactText(input.operationKey, 'operationKey', HANDOFF_ID_MAX_LENGTH),
        },
      ));
    },

    async internalizeMedia(draftId: string, input: {
      expectedRevision: number;
      selections: SourceListingMediaSelection[];
    }) {
      if (!Array.isArray(input.selections) || input.selections.length < 1 || input.selections.length > 50) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', 'media selections 数量无效');
      }
      const mediaKeys = new Set<string>();
      const slotKeys = new Set<string>();
      const selections = input.selections.map((selection, index): SourceListingMediaSelection => {
        const sourceMediaKey = exactText(selection?.sourceMediaKey, `selections[${index}].sourceMediaKey`, HANDOFF_ID_MAX_LENGTH);
        const slotKey = exactText(selection?.slotKey, `selections[${index}].slotKey`, HANDOFF_ID_MAX_LENGTH);
        if (mediaKeys.has(sourceMediaKey) || slotKeys.has(slotKey)) {
          throw new SourceListingWorkflowClientError('INVALID_INPUT', 'media selections 的素材和槽位必须唯一');
        }
        mediaKeys.add(sourceMediaKey);
        slotKeys.add(slotKey);
        const rawSkuKey = (selection as { skuKey?: unknown }).skuKey;
        if (selection.scope === 'PRODUCT') {
          if (rawSkuKey !== undefined) throw new SourceListingWorkflowClientError('INVALID_INPUT', 'PRODUCT media selection 不能包含 skuKey');
          return { sourceMediaKey, slotKey, scope: 'PRODUCT' };
        }
        if (selection.scope !== 'SKU') throw new SourceListingWorkflowClientError('INVALID_INPUT', 'media selection scope 无效');
        return {
          sourceMediaKey,
          slotKey,
          scope: 'SKU',
          skuKey: exactText(rawSkuKey, `selections[${index}].skuKey`, SOURCE_LISTING_SKU_KEY_MAX_LENGTH),
        };
      });
      return unwrap(await transport.post<SourceListingMediaInternalizeResult>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/media/internalize`,
        {
          expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'),
          selections,
        },
      ));
    },

    async assignMedia(draftId: string, input: {
      expectedRevision: number;
      assignments: OzonListingDraftMediaAssignment[];
    }) {
      if (!Array.isArray(input.assignments) || input.assignments.length < 1 || input.assignments.length > 500) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', 'media assignments 数量无效');
      }
      return unwrap(await transport.put<OzonListingDraft>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/media`,
        {
          expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'),
          assignments: input.assignments,
        },
      ));
    },

    async savePricing(draftId: string, input: { expectedRevision: number; value: OzonListingPricingV1 }) {
      if (input.value?.contractVersion !== OZON_LISTING_PRICING_CONTRACT_VERSION) {
        throw new SourceListingWorkflowClientError('INVALID_PRICING', 'pricing contractVersion 无效');
      }
      return unwrap(await transport.put<OzonListingDraft>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/pricing`,
        { expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'), value: input.value },
      ));
    },

    async validateFinalDraft(draftId: string, expectedRevision: number) {
      return unwrap(await transport.post<OzonListingDraft>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/validate`,
        { expectedRevision: positiveInteger(expectedRevision, 'expectedRevision') },
      ));
    },

    async createPublishAttempt(draftId: string, input: { expectedRevision: number; idempotencyKey: string }) {
      const idempotencyKey = exactText(
        input.idempotencyKey,
        'idempotencyKey',
        SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
      );
      if (idempotencyKey.length < SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', 'idempotencyKey 长度不足');
      }
      return unwrap(await transport.post<SourceListingPublishAttempt>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/publish-attempts`,
        {
          expectedRevision: positiveInteger(input.expectedRevision, 'expectedRevision'),
          idempotencyKey,
        },
      ));
    },

    async listPublishAttempts(draftId: string, input: { limit?: number; cursor?: string } = {}) {
      const query = new URLSearchParams({ limit: String(positiveInteger(input.limit ?? 20, 'limit', ATTEMPT_LIST_LIMIT_MAX)) });
      if (input.cursor) query.set('cursor', exactText(input.cursor, 'cursor', HANDOFF_ID_MAX_LENGTH));
      return unwrap(await transport.get<SourceListingPublishAttemptList>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}/publish-attempts?${query}`,
      ));
    },

    getPublishAttempt,

    async resolvePublishAttempt(draftId: string, attemptId: string, input: {
      expectedStateVersion: number;
      decision: 'SUBMITTED' | 'NOT_SUBMITTED';
      taskId?: string;
      note: string;
      evidence: Record<string, unknown>;
    }) {
      if (!input.evidence || typeof input.evidence !== 'object' || Array.isArray(input.evidence)
        || Object.keys(input.evidence).length === 0) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', 'resolution evidence 不能为空');
      }
      if (input.decision === 'SUBMITTED'
        && (!input.taskId || !/^[0-9]{1,40}$/.test(input.taskId) || BigInt(input.taskId) <= 0n)) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', 'SUBMITTED resolution 需要正数 Ozon taskId');
      }
      return unwrap(await transport.post<SourceListingPublishAttempt>(
        `${SOURCE_LISTING_API_BASE}/${encoded(exactText(draftId, 'draftId', HANDOFF_ID_MAX_LENGTH))}`
          + `/publish-attempts/${encoded(exactText(attemptId, 'attemptId', HANDOFF_ID_MAX_LENGTH))}/resolve`,
        {
          expectedStateVersion: positiveInteger(input.expectedStateVersion, 'expectedStateVersion'),
          decision: input.decision,
          ...(input.taskId ? { taskId: input.taskId } : {}),
          note: exactText(input.note, 'note', 2000),
          evidence: input.evidence,
        },
      ));
    },

    async pollPublishAttempt(draftId: string, attemptId: string, options: SourceListingAttemptPollOptions = {}) {
      const maxAttempts = positiveInteger(options.maxAttempts ?? 30, 'maxAttempts', 100);
      const intervalMs = nonNegativeInteger(options.intervalMs ?? 2000, 'intervalMs');
      if (intervalMs > 30_000) {
        throw new SourceListingWorkflowClientError('INVALID_INPUT', 'intervalMs 不能超过 30000');
      }
      const sleep = options.sleep || abortableDelay;
      const isTerminal = options.isTerminal || isTerminalSourceListingPublishAttempt;
      let lastAttempt: SourceListingPublishAttempt | null = null;
      for (let index = 0; index < maxAttempts; index += 1) {
        abortIfRequested(options.signal);
        lastAttempt = await getPublishAttempt(draftId, attemptId);
        abortIfRequested(options.signal);
        if (isTerminal(lastAttempt)) return lastAttempt;
        if (index < maxAttempts - 1) await sleep(intervalMs, options.signal);
      }
      throw new SourceListingPollLimitError(lastAttempt);
    },
  };
}

export const sourceListingWorkflowClient = createSourceListingWorkflowClient();
