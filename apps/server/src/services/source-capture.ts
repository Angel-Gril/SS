import {
  createSourceProductCaptureV2Submission,
  hashSourceProductCaptureV2,
  sourceProductCaptureCanonicalStringify,
  sourceProductCapturePayloadBytes,
  validateSourceProductCaptureV2Submission,
  type SourceCaptureEvidence,
  type SourceCaptureTruncation,
  type SourceProductCaptureV2,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { hashExtensionCommandRequest } from './extension-command-grants.js';
import {
  buildSourceProductProfileFromCapture,
  type SourceProductCaptureProfile,
} from './source-product-profile.js';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from './source-listing-sku-identity.js';

export const SOURCE_CAPTURE_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
export const SOURCE_CAPTURE_PROJECTION_SKU_LIMIT = 100;
export const SOURCE_CAPTURE_PROJECTION_MAIN_IMAGE_LIMIT = 20;
export const SOURCE_CAPTURE_PROJECTION_DETAIL_IMAGE_LIMIT = 20;

export type SourceCaptureIngestChannel = 'EXTENSION_DEVICE' | 'WEB_ACCOUNT' | 'LEGACY_ADAPTER';
export type SourceCaptureRolloutStage = 'shadow_write' | 'dual_read' | 'v2_only';

export class SourceCaptureError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SourceCaptureError';
  }
}

export interface SourceCaptureStageCount {
  observedCount: number | null;
  capturedCount: number;
  submittedCount: number;
  persistedCount: number;
  displayedCount: number;
  truncated: boolean;
  reason: string | null;
}

export interface SourceCaptureStageCounts {
  version: 'source-capture-stage-counts-v1';
  fields: Record<string, SourceCaptureStageCount>;
}

export interface SourceCaptureProvenance {
  mode: SourceProductCaptureV2['provenanceMode'];
  complete: boolean;
  captureChannel: SourceProductCaptureV2['collector']['captureChannel'];
  collectorName: string;
  parserVersion: string;
  contractVersion: string;
  extensionVersion: string | null;
}

export interface SourceCaptureProjection {
  title: string;
  sourceUrl: string;
  sourcePlatform: string;
  sourceProductId: string;
  sku: string;
  images: string[];
  variants: Array<Record<string, unknown>>;
  purchasePrice: number | null;
  currency: string;
  metadata: Record<string, unknown>;
}

export interface PreparedSourceCapture {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string | null;
  tokenId: string | null;
  ingestChannel: SourceCaptureIngestChannel;
  rolloutRevision: string;
  rolloutStage: SourceCaptureRolloutStage;
  capture: SourceProductCaptureV2;
  captureHash: string;
  payloadBytes: number;
  capturedAt: Date;
  stageCounts: SourceCaptureStageCounts;
  provenance: SourceCaptureProvenance;
  parserVersion: string;
  extensionVersion: string | null;
  completeness: SourceProductCaptureV2['completeness'];
  truncations: SourceCaptureTruncation[];
  hasEstimatedValues: boolean;
  profile: SourceProductCaptureProfile;
  projection: SourceCaptureProjection;
}

export interface PreparedNativeSourceCapture extends PreparedSourceCapture {
  ingestChannel: 'EXTENSION_DEVICE';
  deviceSessionId: string;
  tokenId: string;
  grant: {
    token: string;
    idempotencyKey: string;
    requestHash: string;
  };
}

export interface PreparedLegacySourceCapture extends PreparedSourceCapture {
  ingestChannel: 'LEGACY_ADAPTER';
  supplyGoodsId: string;
}

export interface SourceCapturePersistenceResult {
  kind: 'created' | 'replay';
  subjectId: string;
  snapshotId: string;
  snapshotVersion: number;
  supplyGoodsId: string;
  captureHash: string;
}

export interface PreparedLegacyProjection {
  ownerUserId: string;
  actorUserId: string;
  rolloutRevision: string;
  rolloutStage: SourceCaptureRolloutStage;
  sourcePlatform: SourceProductCaptureV2['platform'];
  sourceProductId: string;
  supplier: string | null;
  projection: SourceCaptureProjection;
}

export interface LegacyProjectionResult {
  kind: 'created' | 'reused';
  subjectId: string;
  supplyGoodsId: string;
  createdAt: Date;
}

export interface SourceCaptureRepository {
  ingestNative(input: PreparedNativeSourceCapture): Promise<SourceCapturePersistenceResult>;
  ingestLegacy(input: PreparedLegacySourceCapture): Promise<SourceCapturePersistenceResult>;
  loadLegacyProjection(input: {
    ownerUserId: string;
    supplyGoodsId: string;
  }): Promise<{ id: string; createdAt: Date } | null>;
  ensureLegacyProjection(input: PreparedLegacyProjection): Promise<LegacyProjectionResult>;
}

export interface SourceCaptureTrustedContext {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId?: string | null;
  tokenId?: string | null;
  rolloutRevision: string;
  rolloutStage: SourceCaptureRolloutStage;
  ingestChannel: SourceCaptureIngestChannel;
}

function identifier(value: unknown, field: string, maxLength = 200): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, `${field} is invalid`);
  }
  return text;
}

function nullableIdentifier(value: unknown, field: string, maxLength = 200): string | null {
  if (value == null || value === '') return null;
  return identifier(value, field, maxLength);
}

function normalizedTrusted(input: SourceCaptureTrustedContext): SourceCaptureTrustedContext {
  if (!['shadow_write', 'dual_read', 'v2_only'].includes(input.rolloutStage)) {
    throw new SourceCaptureError('SOURCE_CAPTURE_IDENTITY_MISMATCH', 422, 'rolloutStage is invalid');
  }
  return {
    ownerUserId: identifier(input.ownerUserId, 'ownerUserId'),
    actorUserId: identifier(input.actorUserId, 'actorUserId'),
    deviceSessionId: nullableIdentifier(input.deviceSessionId, 'deviceSessionId'),
    tokenId: nullableIdentifier(input.tokenId, 'tokenId'),
    rolloutRevision: identifier(input.rolloutRevision, 'rolloutRevision'),
    rolloutStage: input.rolloutStage,
    ingestChannel: input.ingestChannel,
  };
}

function canonicalArrayCount(capture: SourceProductCaptureV2, fieldPath: string): number {
  if (fieldPath === '/media/product_main') {
    return capture.media.filter((media) => media.role === 'product_main' && media.disposition === 'accepted').length;
  }
  if (fieldPath === '/media/product_detail') {
    return capture.media.filter((media) => media.role === 'product_detail' && media.disposition === 'accepted').length;
  }
  if (fieldPath === '/media/rejected') {
    return capture.media.filter((media) => media.disposition === 'rejected').length;
  }
  const counts: Record<string, number> = {
    '/attributes': capture.attributes.length,
    '/prices': capture.prices.length,
    '/skus': capture.skus.length,
    '/media': capture.media.length,
    '/packaging': capture.packaging.length,
    '/truncations': capture.truncations.length,
  };
  return counts[fieldPath] ?? 0;
}

function projectionDisplayedCount(
  fieldPath: string,
  persisted: number,
  projection: SourceCaptureProjection,
): number {
  if (fieldPath === '/skus') return projection.variants.length;
  if (fieldPath === '/media/product_main') return projection.images.length;
  if (fieldPath === '/media/product_detail') {
    return Array.isArray(projection.metadata.sourceDetailImages)
      ? projection.metadata.sourceDetailImages.length
      : 0;
  }
  if (fieldPath === '/media/rejected') return 0;
  if (fieldPath === '/media') {
    const details = Array.isArray(projection.metadata.sourceDetailImages)
      ? projection.metadata.sourceDetailImages.length
      : 0;
    return projection.images.length + details;
  }
  if (fieldPath === '/truncations') return persisted;
  return persisted;
}

function stageCounts(
  capture: SourceProductCaptureV2,
  projection: SourceCaptureProjection,
  persistedTruncationCount: number,
): SourceCaptureStageCounts {
  const fields: Record<string, SourceCaptureStageCount> = {};
  for (const count of capture.counts) {
    const persistedCount = count.fieldPath === '/truncations'
      ? persistedTruncationCount
      : canonicalArrayCount(capture, count.fieldPath);
    fields[count.fieldPath] = {
      observedCount: count.totalCount,
      capturedCount: count.capturedCount,
      submittedCount: count.submittedCount,
      persistedCount,
      displayedCount: projectionDisplayedCount(count.fieldPath, persistedCount, projection),
      truncated: count.truncated,
      reason: count.reason,
    };
  }
  return { version: 'source-capture-stage-counts-v1', fields };
}

function projectionTruncation(
  fieldPath: string,
  observedCount: number,
  retainedCount: number,
  limit: number,
): SourceCaptureTruncation | null {
  if (observedCount <= retainedCount) return null;
  return {
    stage: 'legacy_projection',
    fieldPath,
    observedCount,
    retainedCount,
    limit,
    unit: 'items',
    reason: 'legacy_projection_limit',
    recoverability: 'server_refetch',
    fallbackSourcePath: fieldPath,
  };
}

function truncationIdentity(truncation: SourceCaptureTruncation): string {
  return [
    truncation.stage,
    truncation.fieldPath,
    truncation.reason,
    truncation.observedCount,
    truncation.limit,
    truncation.retainedCount,
    truncation.unit,
  ].join('\u0000');
}

function mediaUrls(
  capture: SourceProductCaptureV2,
  role: 'product_main' | 'product_detail',
  limit: number,
): string[] {
  return capture.media
    .filter((media) => media.kind === 'image'
      && media.role === role
      && media.disposition === 'accepted'
      && typeof media.url === 'string')
    .map((media) => media.url as string)
    .slice(0, limit);
}

function selectedPrice(capture: SourceProductCaptureV2): number | null {
  for (const role of ['selected_sku', 'sku_minimum', 'ladder_tier', 'conservative_fallback'] as const) {
    const value = capture.prices.find((price) => price.role === role)?.amountCny;
    if (value != null && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function buildProjection(
  capture: SourceProductCaptureV2,
  captureHash: string,
  profile: SourceProductCaptureProfile,
): SourceCaptureProjection {
  const mainImages = mediaUrls(capture, 'product_main', SOURCE_CAPTURE_PROJECTION_MAIN_IMAGE_LIMIT);
  const detailImages = mediaUrls(capture, 'product_detail', SOURCE_CAPTURE_PROJECTION_DETAIL_IMAGE_LIMIT);
  const selectedSku = capture.skus.find((sku) => sku.key === capture.facts.selectedSkuKey)
    || capture.skus[0];
  const productOnly = capture.skus.length === 0;
  const variants = productOnly
    ? [{
      key: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
      sku: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
      attrs: {},
      price: selectedPrice(capture),
      stock: null,
      images: [],
      captureEvidence: {
        kind: 'product_only',
        synthetic: true,
        sourcePath: '/skus',
        isEstimated: false,
      },
    }]
    : capture.skus.slice(0, SOURCE_CAPTURE_PROJECTION_SKU_LIMIT).map((sku) => ({
      key: sku.key,
      sku: sku.sourceSkuId || sku.key,
      attrs: Object.fromEntries(sku.attributes.map((attribute) => [attribute.name, attribute.value])),
      price: sku.priceCny,
      stock: sku.stock,
      images: capture.media
        .filter((media) => sku.mediaKeys.includes(media.key)
          && media.disposition === 'accepted'
          && typeof media.url === 'string')
        .map((media) => media.url),
      captureEvidence: {
        kind: sku.kind,
        sourceType: sku.rowEvidence.sourceType,
        isEstimated: sku.rowEvidence.isEstimated,
      },
    }));
  return {
    title: capture.facts.title || `${capture.platform} ${capture.sourceIdentity.productId}`,
    sourceUrl: capture.sourceIdentity.canonicalUrl,
    sourcePlatform: capture.platform,
    sourceProductId: capture.sourceIdentity.productId,
    sku: selectedSku?.sourceSkuId || selectedSku?.key || capture.sourceIdentity.productId,
    images: mainImages,
    variants,
    purchasePrice: selectedPrice(capture),
    currency: capture.facts.currency || 'CNY',
    metadata: {
      sourceCapture: {
        captureVersion: capture.captureVersion,
        captureHash,
        provenanceMode: capture.provenanceMode,
        completenessStatus: capture.completeness.status,
        canonicalSkuCount: capture.skus.length,
        projectedSkuCount: variants.length,
        ...(productOnly ? { productOnlySkuKey: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } : {}),
      },
      sourceCategoryId: capture.sourceCategory.id,
      categoryPath: capture.sourceCategory.path.map((node) => node.name),
      sourceDetailImages: detailImages,
      sourceProductProfile: profile,
    },
  };
}

function buildPrepared(
  trustedInput: SourceCaptureTrustedContext,
  submission: SourceProductCaptureV2Submission,
): PreparedSourceCapture {
  const trusted = normalizedTrusted(trustedInput);
  const capture = structuredClone(submission.capture);
  const profile = buildSourceProductProfileFromCapture(capture, {
    itemId: submission.captureHash,
    captureHash: submission.captureHash,
  });
  const projection = buildProjection(capture, submission.captureHash, profile);
  const generatedTruncations = [
    projectionTruncation(
      '/skus',
      capture.skus.length,
      projection.variants.length,
      SOURCE_CAPTURE_PROJECTION_SKU_LIMIT,
    ),
    projectionTruncation(
      '/media/product_main',
      capture.media.filter((media) => media.role === 'product_main' && media.disposition === 'accepted').length,
      projection.images.length,
      SOURCE_CAPTURE_PROJECTION_MAIN_IMAGE_LIMIT,
    ),
    projectionTruncation(
      '/media/product_detail',
      capture.media.filter((media) => media.role === 'product_detail' && media.disposition === 'accepted').length,
      Array.isArray(projection.metadata.sourceDetailImages) ? projection.metadata.sourceDetailImages.length : 0,
      SOURCE_CAPTURE_PROJECTION_DETAIL_IMAGE_LIMIT,
    ),
  ].filter((value): value is SourceCaptureTruncation => value !== null);
  const truncations = structuredClone(capture.truncations);
  const knownTruncations = new Set(truncations.map(truncationIdentity));
  for (const generated of generatedTruncations) {
    const identity = truncationIdentity(generated);
    if (knownTruncations.has(identity)) continue;
    knownTruncations.add(identity);
    truncations.push(generated);
  }
  const provenance: SourceCaptureProvenance = {
    mode: capture.provenanceMode,
    complete: capture.provenanceMode === 'native_v2',
    captureChannel: capture.collector.captureChannel,
    collectorName: capture.collector.name,
    parserVersion: capture.collector.parserVersion,
    contractVersion: capture.collector.contractVersion,
    extensionVersion: capture.collector.extensionVersion || null,
  };
  return {
    ownerUserId: trusted.ownerUserId,
    actorUserId: trusted.actorUserId,
    deviceSessionId: trusted.deviceSessionId || null,
    tokenId: trusted.tokenId || null,
    ingestChannel: trusted.ingestChannel,
    rolloutRevision: trusted.rolloutRevision,
    rolloutStage: trusted.rolloutStage,
    capture,
    captureHash: submission.captureHash,
    payloadBytes: submission.payloadBytes,
    capturedAt: new Date(capture.capturedAt),
    stageCounts: stageCounts(capture, projection, truncations.length),
    provenance,
    parserVersion: capture.collector.parserVersion,
    extensionVersion: capture.collector.extensionVersion || null,
    completeness: structuredClone(capture.completeness),
    truncations,
    hasEstimatedValues: capture.completeness.hasEstimatedValues,
    profile,
    projection,
  };
}

async function validatedSubmission(
  submission: SourceProductCaptureV2Submission,
): Promise<SourceProductCaptureV2Submission> {
  const captureVersion = (submission as any)?.capture?.captureVersion;
  const platform = (submission as any)?.capture?.platform;
  if (captureVersion !== 'source-product-capture-v2'
    || !['1688', 'ozon', 'pdd', 'taobao', 'tmall'].includes(String(platform || ''))) {
    throw new SourceCaptureError(
      'SOURCE_CAPTURE_VERSION_UNSUPPORTED',
      422,
      'Source capture version or platform is unsupported',
      { captureVersion, platform },
    );
  }
  const declaredBytes = Number(submission?.payloadBytes);
  if (declaredBytes > SOURCE_CAPTURE_MAX_PAYLOAD_BYTES) {
    throw new SourceCaptureError(
      'SOURCE_CAPTURE_TOO_LARGE',
      413,
      'Source capture exceeds 8 MiB',
      { maxPayloadBytes: SOURCE_CAPTURE_MAX_PAYLOAD_BYTES, actualPayloadBytes: declaredBytes },
    );
  }
  const validation = validateSourceProductCaptureV2Submission(submission);
  const contractErrors = validation.valid
    ? []
    : validation.errors.filter((error) => error.keyword !== 'payloadBytes');
  if (contractErrors.length) {
    throw new SourceCaptureError(
      'SOURCE_CAPTURE_INVALID',
      400,
      'Source capture contract validation failed',
      contractErrors,
    );
  }
  const canonicalBytes = sourceProductCapturePayloadBytes(submission.capture);
  if (canonicalBytes > SOURCE_CAPTURE_MAX_PAYLOAD_BYTES) {
    throw new SourceCaptureError(
      'SOURCE_CAPTURE_TOO_LARGE',
      413,
      'Source capture exceeds 8 MiB',
      {
        maxPayloadBytes: SOURCE_CAPTURE_MAX_PAYLOAD_BYTES,
        actualPayloadBytes: canonicalBytes,
      },
    );
  }
  if (canonicalBytes !== submission.payloadBytes) {
    throw new SourceCaptureError(
      'SOURCE_CAPTURE_SIZE_MISMATCH',
      422,
      'Source capture payloadBytes does not match canonical payload',
      { declaredPayloadBytes: submission.payloadBytes, actualPayloadBytes: canonicalBytes },
    );
  }
  const captureHash = await hashSourceProductCaptureV2(submission.capture);
  if (captureHash !== submission.captureHash) {
    throw new SourceCaptureError(
      'SOURCE_CAPTURE_HASH_MISMATCH',
      422,
      'Source capture hash does not match canonical payload',
      { declaredCaptureHash: submission.captureHash, actualCaptureHash: captureHash },
    );
  }
  return {
    capture: JSON.parse(sourceProductCaptureCanonicalStringify(submission.capture)) as SourceProductCaptureV2,
    captureHash: submission.captureHash,
    payloadBytes: submission.payloadBytes,
  };
}

export function buildSourceCaptureCommandEnvelope(submission: SourceProductCaptureV2Submission) {
  const command = {
    schemaVersion: submission.capture.captureVersion,
    platform: submission.capture.platform,
    sourceProductId: submission.capture.sourceIdentity.productId,
    captureHash: submission.captureHash,
    payloadBytes: submission.payloadBytes,
  };
  const envelope = {
    operation: 'SOURCE_CAPTURE' as const,
    shopId: null,
    workflowId: null,
    draftVersion: null,
    command,
  };
  return { command, envelope, requestHash: hashExtensionCommandRequest(envelope) };
}

function legacyText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function legacyNumber(value: unknown, allowZero: boolean): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) return null;
  return number;
}

function legacyEvidence(
  value: string | number | boolean | null,
  sourcePath: string,
  observedAt: string,
  missingReason: SourceCaptureEvidence['missingReason'] = value == null
    ? 'legacy_provenance_missing'
    : null,
): SourceCaptureEvidence {
  return {
    value,
    sourceType: 'legacy',
    sourcePath,
    confidence: value == null ? 0 : 0.5,
    isEstimated: false,
    missingReason,
    observedAt,
    parserVersion: 'ss-erp-legacy-adapter-v1',
    derivedFrom: [],
  };
}

function legacyPlatform(value: unknown): SourceProductCaptureV2['platform'] {
  const platform = String(value || '').trim().toLowerCase();
  const normalized = platform === 'pinduoduo' ? 'pdd' : platform;
  if (!['1688', 'pdd', 'taobao', 'tmall', 'ozon'].includes(normalized)) {
    throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, 'Legacy source platform is unsupported');
  }
  return normalized as SourceProductCaptureV2['platform'];
}

function legacyAttributes(value: unknown, observedAt: string) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, ordinal) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const name = legacyText(row.name ?? row.key);
    const attributeValue = legacyText(row.value);
    if (!name || !attributeValue) return [];
    return [{
      key: `legacy-attribute-${ordinal}`,
      ordinal,
      sourceAttributeId: legacyText(row.id),
      name,
      value: attributeValue,
      isSaleAttribute: Boolean(row.isSaleAttribute),
      rowEvidence: legacyEvidence(true, `/legacy/attributes/${ordinal}`, observedAt),
      fieldEvidence: {
        sourceAttributeId: legacyEvidence(legacyText(row.id), `/legacy/attributes/${ordinal}/id`, observedAt),
        name: legacyEvidence(name, `/legacy/attributes/${ordinal}/name`, observedAt),
        value: legacyEvidence(attributeValue, `/legacy/attributes/${ordinal}/value`, observedAt),
        isSaleAttribute: legacyEvidence(Boolean(row.isSaleAttribute), `/legacy/attributes/${ordinal}/isSaleAttribute`, observedAt),
      },
    }];
  });
}

function legacySkuAttributes(value: unknown, observedAt: string, skuOrdinal: number) {
  const entries = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
    : [];
  return entries.flatMap(([name, raw], ordinal) => {
    const attributeValue = legacyText(raw);
    if (!attributeValue) return [];
    return [{
      name,
      value: attributeValue,
      fieldEvidence: {
        name: legacyEvidence(name, `/legacy/skus/${skuOrdinal}/attrs/${ordinal}/name`, observedAt),
        value: legacyEvidence(attributeValue, `/legacy/skus/${skuOrdinal}/attrs/${ordinal}/value`, observedAt),
      },
    }];
  });
}

function legacyCategoryPath(
  item: Record<string, unknown>,
  observedAt: string,
): SourceProductCaptureV2['sourceCategory']['path'] {
  const input = [
    ['categoryPath', item.categoryPath],
    ['breadcrumb', item.breadcrumb],
    ['breadcrumbs', item.breadcrumbs],
  ].find(([, value]) => (Array.isArray(value) ? value.length > 0 : legacyText(value) !== null));
  if (!input) return [];

  const [inputKey, rawValue] = input;
  const entries = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue).split(/\s*(?:>|\/|»|›)\s*/);
  const path: SourceProductCaptureV2['sourceCategory']['path'] = [];
  for (let inputOrdinal = 0; inputOrdinal < entries.length && path.length < 50; inputOrdinal++) {
    const entry = entries[inputOrdinal];
    const basePath = `/legacy/${inputKey}/${inputOrdinal}`;
    const record = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : null;
    const nameField = record
      ? ['name', 'text', 'title', 'label'].find((key) => legacyText(record[key]) !== null)
      : null;
    const idField = record
      ? ['id', 'categoryId', 'category_id'].find((key) => legacyText(record[key]) !== null)
      : null;
    const name = legacyText(record && nameField ? record[nameField] : entry)?.slice(0, 300) || null;
    if (!name) continue;
    const id = legacyText(record && idField ? record[idField] : null)?.slice(0, 200) || null;
    path.push({
      ordinal: path.length,
      id,
      name,
      fieldEvidence: {
        id: legacyEvidence(id, idField ? `${basePath}/${idField}` : `${basePath}/id`, observedAt),
        name: legacyEvidence(name, nameField ? `${basePath}/${nameField}` : basePath, observedAt),
      },
    });
  }
  return path;
}

function legacyCapture(item: Record<string, unknown>, observedAt: string): SourceProductCaptureV2 {
  const platform = legacyPlatform(item.sourcePlatform);
  const productId = identifier(item.sourceProductId ?? item.sku, 'sourceProductId');
  const sourceUrl = identifier(item.sourceUrl, 'sourceUrl', 4096);
  const currency = (legacyText(item.currency) || 'CNY').toUpperCase();
  const hasCnyPrice = currency === 'CNY';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, 'Legacy source URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, 'Legacy source URL is invalid');
  }
  const rows = Array.isArray(item.skuItems)
    ? item.skuItems
    : Array.isArray(item.variants) ? item.variants : [];
  const skus = rows.flatMap((entry, ordinal) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const sourceSkuId = legacyText(row.sku ?? row.skuId ?? row.id);
    const specText = legacyText(row.specText ?? row.title ?? row.name);
    const priceCny = hasCnyPrice ? legacyNumber(row.price, false) : null;
    const stockNumber = legacyNumber(row.stock, true);
    const stock = stockNumber == null ? null : Math.floor(stockNumber);
    return [{
      key: sourceSkuId ? `legacy-${sourceSkuId}`.slice(0, 500) : `legacy-sku-${ordinal}`,
      ordinal,
      kind: 'observed' as const,
      sourceSkuId,
      specText,
      priceCny,
      stock,
      attributes: legacySkuAttributes(row.attrs ?? row.attributes, observedAt, ordinal),
      mediaKeys: [],
      packagingKeys: [],
      rowEvidence: legacyEvidence(true, `/legacy/skus/${ordinal}`, observedAt),
      fieldEvidence: {
        sourceSkuId: legacyEvidence(sourceSkuId, `/legacy/skus/${ordinal}/sku`, observedAt),
        specText: legacyEvidence(specText, `/legacy/skus/${ordinal}/specText`, observedAt),
        priceCny: legacyEvidence(priceCny, `/legacy/skus/${ordinal}/price`, observedAt),
        stock: legacyEvidence(stock, `/legacy/skus/${ordinal}/stock`, observedAt),
      },
    }];
  });
  const mainImages = Array.isArray(item.images)
    ? item.images
    : Array.isArray(item.sourceMainImages) ? item.sourceMainImages : [];
  const detailImages = Array.isArray(item.sourceDetailImages) ? item.sourceDetailImages : [];
  const media = [...mainImages.map((url) => ({ url, role: 'product_main' as const })),
    ...detailImages.map((url) => ({ url, role: 'product_detail' as const }))]
    .flatMap((entry, ordinal) => {
      const url = legacyText(entry.url);
      if (!url || !/^https?:\/\//i.test(url)) return [];
      return [{
        key: `legacy-media-${ordinal}`,
        ordinal,
        kind: 'image' as const,
        role: entry.role,
        url,
        width: null,
        height: null,
        mimeType: null,
        skuKeys: [],
        disposition: 'accepted' as const,
        rejectionReason: null,
        duplicateOfMediaKey: null,
        rowEvidence: legacyEvidence(true, `/legacy/media/${ordinal}`, observedAt),
        fieldEvidence: {
          role: legacyEvidence(entry.role, `/legacy/media/${ordinal}/role`, observedAt),
          url: legacyEvidence(url, `/legacy/media/${ordinal}/url`, observedAt),
          width: legacyEvidence(null, `/legacy/media/${ordinal}/width`, observedAt),
          height: legacyEvidence(null, `/legacy/media/${ordinal}/height`, observedAt),
          mimeType: legacyEvidence(null, `/legacy/media/${ordinal}/mimeType`, observedAt),
        },
      }];
    });
  const title = legacyText(item.sourceTitleRaw ?? item.title);
  const shopName = legacyText(item.shopName ?? item.supplier);
  const description = legacyText(item.description);
  const selectedSkuKey = skus[0]?.key || null;
  const shippingCny = legacyNumber(item.shippingCny, true);
  const shippingFree = shippingCny === 0 ? true : (typeof item.shippingFree === 'boolean' ? item.shippingFree : null);
  const totalCostCny = shippingCny == null ? null : legacyNumber(item.totalCostCny, true);
  const packageWeightG = legacyNumber(item.weightG ?? item.packageWeightG, false);
  const packageLengthMm = legacyNumber(item.lengthMm ?? item.packageLengthMm, false);
  const packageWidthMm = legacyNumber(item.widthMm ?? item.packageWidthMm, false);
  const packageHeightMm = legacyNumber(item.heightMm ?? item.packageHeightMm, false);
  const monthlySalesRaw = legacyNumber(item.monthlySales, true);
  const minimumOrderRaw = legacyNumber(item.minimumOrderQuantity, false);
  const facts = {
    title,
    shopName,
    description,
    sourceLocale: legacyText(item.sourceLocale),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    selectedSkuKey,
    shippingCny,
    shippingFree,
    totalCostCny,
    packageWeightG,
    packageLengthMm,
    packageWidthMm,
    packageHeightMm,
    monthlySales: monthlySalesRaw == null ? null : Math.floor(monthlySalesRaw),
    minimumOrderQuantity: minimumOrderRaw == null ? null : Math.max(1, Math.floor(minimumOrderRaw)),
  };
  const fieldEvidence = Object.fromEntries(Object.entries(facts).map(([key, value]) => [
    key,
    legacyEvidence(value, `/legacy/facts/${key}`, observedAt),
  ])) as unknown as SourceProductCaptureV2['fieldEvidence'];
  const priceAmount = hasCnyPrice
    ? skus.find((sku) => sku.priceCny != null)?.priceCny ?? legacyNumber(item.price, false)
    : null;
  const prices = priceAmount == null ? [] : [{
    key: 'legacy-selected-price',
    role: 'selected_sku' as const,
    skuKey: selectedSkuKey,
    minQuantity: null,
    amountCny: priceAmount,
    maxAmountCny: null,
    currency: facts.currency || 'CNY',
    displayText: String(priceAmount),
    fieldEvidence: {
      skuKey: legacyEvidence(selectedSkuKey, '/legacy/prices/0/skuKey', observedAt),
      minQuantity: legacyEvidence(null, '/legacy/prices/0/minQuantity', observedAt, 'not_applicable'),
      amountCny: legacyEvidence(priceAmount, '/legacy/prices/0/amountCny', observedAt),
      maxAmountCny: legacyEvidence(null, '/legacy/prices/0/maxAmountCny', observedAt, 'not_applicable'),
      currency: legacyEvidence(facts.currency || 'CNY', '/legacy/prices/0/currency', observedAt),
      displayText: legacyEvidence(String(priceAmount), '/legacy/prices/0/displayText', observedAt),
    },
  }];
  const attributes = legacyAttributes(item.attributes, observedAt);
  const sourceCategoryIdField = legacyText(item.sourceCategoryId) !== null
    ? 'sourceCategoryId'
    : 'categoryId';
  const sourceCategoryId = legacyText(item[sourceCategoryIdField])?.slice(0, 200) || null;
  const sourceCategoryName = legacyText(item.categoryName)?.slice(0, 300) || null;
  const sourceCategoryPath = legacyCategoryPath(item, observedAt);
  const categoryMissingFieldPaths = [
    sourceCategoryId == null ? '/sourceCategory/id' : null,
    sourceCategoryName == null ? '/sourceCategory/name' : null,
    sourceCategoryPath.length === 0 ? '/sourceCategory/path' : null,
  ].filter((value): value is string => value !== null);
  const categoryStatus = categoryMissingFieldPaths.length === 0
    ? 'complete' as const
    : sourceCategoryId != null || sourceCategoryName != null || sourceCategoryPath.length > 0
      ? 'partial' as const
      : 'missing' as const;
  const counts = [
    ['/attributes', attributes.length],
    ['/prices', prices.length],
    ['/skus', skus.length],
    ['/media', media.length],
    ['/packaging', 0],
    ['/truncations', 0],
  ].map(([fieldPath, count]) => ({
    fieldPath: String(fieldPath),
    totalCount: null,
    capturedCount: Number(count),
    submittedCount: Number(count),
    truncated: false,
    reason: null,
  })) as SourceProductCaptureV2['counts'];
  const missingFieldPaths = Object.entries(facts)
    .filter(([, value]) => value == null)
    .map(([key]) => `/facts/${key}`);
  return {
    captureVersion: 'source-product-capture-v2',
    provenanceMode: 'legacy_adapted',
    platform,
    sourceIdentity: {
      productId,
      canonicalUrl: parsedUrl.toString(),
      host: parsedUrl.hostname,
      fieldEvidence: {
        productId: legacyEvidence(productId, '/legacy/sourceProductId', observedAt),
        canonicalUrl: legacyEvidence(parsedUrl.toString(), '/legacy/sourceUrl', observedAt),
        host: legacyEvidence(parsedUrl.hostname, '/legacy/sourceUrl.host', observedAt),
      },
    },
    collector: {
      name: 'ss-erp-server-legacy-adapter',
      parserVersion: 'ss-erp-legacy-adapter-v1',
      contractVersion: 'source-product-capture-v2',
      extensionVersion: legacyText(item.extensionVersion) || 'legacy-unknown',
      pageBridgeVersion: 'legacy-unknown',
      captureChannel: 'legacy_adapter',
    },
    capturedAt: observedAt,
    sourceCategory: {
      id: sourceCategoryId,
      name: sourceCategoryName,
      path: sourceCategoryPath,
      fieldEvidence: {
        id: legacyEvidence(sourceCategoryId, `/legacy/${sourceCategoryIdField}`, observedAt),
        name: legacyEvidence(sourceCategoryName, '/legacy/categoryName', observedAt),
      },
    },
    facts,
    fieldEvidence,
    attributes,
    prices,
    skus,
    media,
    packaging: [],
    counts,
    completeness: {
      status: 'incomplete',
      hasEstimatedValues: false,
      sections: [
        { section: 'identity', status: 'complete', missingFieldPaths: [] },
        { section: 'category', status: categoryStatus, missingFieldPaths: categoryMissingFieldPaths },
        { section: 'core_facts', status: 'partial', missingFieldPaths },
        { section: 'pricing', status: prices.length ? 'partial' : 'missing', missingFieldPaths: prices.length ? [] : ['/prices'] },
        { section: 'skus', status: skus.length ? 'partial' : 'missing', missingFieldPaths: skus.length ? [] : ['/skus'] },
        { section: 'attributes', status: attributes.length ? 'partial' : 'missing', missingFieldPaths: attributes.length ? [] : ['/attributes'] },
        { section: 'media', status: media.length ? 'partial' : 'missing', missingFieldPaths: media.length ? [] : ['/media'] },
        { section: 'packaging', status: 'missing', missingFieldPaths: ['/packaging'] },
        { section: 'description', status: description ? 'partial' : 'missing', missingFieldPaths: description ? [] : ['/facts/description'] },
      ],
      missingFieldPaths: [...new Set([...missingFieldPaths, ...categoryMissingFieldPaths, '/packaging'])],
      estimatedFieldPaths: [],
    },
    truncations: [],
  };
}

function prepareLegacyProjection(
  trusted: SourceCaptureTrustedContext,
  item: Record<string, unknown>,
): PreparedLegacyProjection {
  const platform = legacyPlatform(item.sourcePlatform);
  const sourceProductId = identifier(item.sourceProductId ?? item.sku, 'sourceProductId');
  const sourceUrl = identifier(item.sourceUrl, 'sourceUrl', 4096);
  const currency = (legacyText(item.currency) || 'CNY').toUpperCase();
  const hasCnyPrice = currency === 'CNY';
  try {
    const parsed = new URL(sourceUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, 'Legacy source URL is invalid');
  }
  const rows = Array.isArray(item.skuItems)
    ? item.skuItems
    : Array.isArray(item.variants) ? item.variants : [];
  const variants = rows.slice(0, SOURCE_CAPTURE_PROJECTION_SKU_LIMIT).flatMap((entry, ordinal) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const stock = legacyNumber(row.stock, true);
    return [{
      sku: legacyText(row.sku ?? row.skuId ?? row.id) || `legacy-sku-${ordinal}`,
      attrs: row.attrs && typeof row.attrs === 'object' && !Array.isArray(row.attrs) ? row.attrs : {},
      price: hasCnyPrice ? legacyNumber(row.price, false) : null,
      stock: stock == null ? null : Math.floor(stock),
    }];
  });
  const images = (Array.isArray(item.images)
    ? item.images
    : Array.isArray(item.sourceMainImages) ? item.sourceMainImages : [])
    .map(legacyText)
    .filter((value): value is string => Boolean(value && /^https?:\/\//i.test(value)))
    .slice(0, SOURCE_CAPTURE_PROJECTION_MAIN_IMAGE_LIMIT);
  const title = legacyText(item.sourceTitleRaw ?? item.title) || `${platform} ${sourceProductId}`;
  const firstSku = variants[0]?.sku || sourceProductId;
  return {
    ownerUserId: trusted.ownerUserId,
    actorUserId: trusted.actorUserId,
    rolloutRevision: trusted.rolloutRevision,
    rolloutStage: trusted.rolloutStage,
    sourcePlatform: platform,
    sourceProductId,
    supplier: legacyText(item.shopName ?? item.supplier),
    projection: {
      title,
      sourceUrl,
      sourcePlatform: platform,
      sourceProductId,
      sku: String(firstSku),
      images,
      variants,
      purchasePrice: hasCnyPrice
        ? legacyNumber(item.price, false)
          ?? (typeof variants[0]?.price === 'number' ? variants[0].price : null)
        : null,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'CNY',
      metadata: {
        sourceCaptureV2: {
          pending: true,
          provenanceMode: 'legacy_adapted',
          rolloutRevision: trusted.rolloutRevision,
          rolloutStage: trusted.rolloutStage,
        },
      },
    },
  };
}

function throwAuditError(message: string): never {
  throw new SourceCaptureError('SOURCE_CAPTURE_IDENTITY_MISMATCH', 422, message);
}

export function createSourceCaptureService(options: { repository: SourceCaptureRepository }) {
  return {
    async ensureLegacyProjection(input: {
      trusted: SourceCaptureTrustedContext & { ingestChannel: 'LEGACY_ADAPTER' };
      item: Record<string, unknown>;
    }) {
      const trusted = normalizedTrusted(input.trusted);
      if (trusted.deviceSessionId || trusted.tokenId) {
        throwAuditError('Legacy capture cannot carry device command identity');
      }
      return options.repository.ensureLegacyProjection(prepareLegacyProjection(trusted, input.item));
    },

    async ingest(input: {
      trusted: SourceCaptureTrustedContext & {
        ingestChannel: 'EXTENSION_DEVICE';
        deviceSessionId: string;
        tokenId: string;
      };
      submission: SourceProductCaptureV2Submission;
      grant: { token: string; idempotencyKey: string; requestHash: string };
    }) {
      const trusted = normalizedTrusted(input.trusted);
      if (trusted.ownerUserId !== trusted.actorUserId) {
        throwAuditError('Native source capture requires a direct owner actor');
      }
      if (!trusted.deviceSessionId || !trusted.tokenId) {
        throwAuditError('Native source capture requires device session identity');
      }
      const token = identifier(input.grant?.token, 'grant.token', 500);
      if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) {
        throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, 'Command grant token is invalid');
      }
      const idempotencyKey = identifier(input.grant?.idempotencyKey, 'grant.idempotencyKey');
      if (idempotencyKey.length < 16) {
        throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, 'Command idempotency key is invalid');
      }
      const submission = await validatedSubmission(input.submission);
      if (submission.capture.provenanceMode !== 'native_v2'
        || submission.capture.collector.captureChannel !== 'extension') {
        throw new SourceCaptureError('SOURCE_CAPTURE_INVALID', 400, 'Native source capture provenance is invalid');
      }
      const prepared = buildPrepared(trusted, submission);
      const command = buildSourceCaptureCommandEnvelope(submission);
      const requestHash = identifier(input.grant?.requestHash, 'grant.requestHash', 64);
      if (!/^[a-f0-9]{64}$/.test(requestHash) || requestHash !== command.requestHash) {
        throw new SourceCaptureError(
          'SOURCE_CAPTURE_IDENTITY_MISMATCH',
          422,
          'Command request hash does not match the source capture',
        );
      }
      const result = await options.repository.ingestNative({
        ...prepared,
        ingestChannel: 'EXTENSION_DEVICE',
        deviceSessionId: trusted.deviceSessionId,
        tokenId: trusted.tokenId,
        grant: { token, idempotencyKey, requestHash },
      });
      return { ...result, profile: prepared.profile };
    },

    async ingestLegacy(input: {
      trusted: SourceCaptureTrustedContext & { ingestChannel: 'LEGACY_ADAPTER' };
      item: Record<string, unknown>;
      supplyGoodsId: string;
    }) {
      const trusted = normalizedTrusted(input.trusted);
      const supplyGoodsId = identifier(input.supplyGoodsId, 'supplyGoodsId');
      if (trusted.deviceSessionId || trusted.tokenId) {
        throwAuditError('Legacy capture cannot carry device command identity');
      }
      const projection = await options.repository.loadLegacyProjection({
        ownerUserId: trusted.ownerUserId,
        supplyGoodsId,
      });
      if (!projection) {
        throw new SourceCaptureError(
          'SOURCE_CAPTURE_LEGACY_PROJECTION_NOT_FOUND',
          404,
          'Legacy supply goods projection not found',
        );
      }
      const capture = legacyCapture(input.item, projection.createdAt.toISOString());
      const submission = await createSourceProductCaptureV2Submission(capture);
      const validated = await validatedSubmission(submission);
      const prepared = buildPrepared(trusted, validated);
      const result = await options.repository.ingestLegacy({
        ...prepared,
        ingestChannel: 'LEGACY_ADAPTER',
        deviceSessionId: null,
        tokenId: null,
        supplyGoodsId,
      });
      return { ...result, profile: prepared.profile };
    },
  };
}
