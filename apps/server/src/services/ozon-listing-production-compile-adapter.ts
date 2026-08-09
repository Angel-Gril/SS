import { createHash } from 'node:crypto';

import {
  canonicalStringify,
  sourceProductCaptureCanonicalStringify,
  type OzonListingDraft,
  type OzonNormalizedAttributeSchema,
  type SourceProductCaptureV2,
} from 'shared';
import type { OzonAttributeValidationResult } from './ozon-attribute-validation.js';
import {
  OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION,
  deriveOzonCategoryCatalogRevision,
  type OzonCategoryCatalogEntry,
  type OzonCategoryCatalogSnapshot,
} from './ozon-category-catalog.js';
import {
  OZON_LISTING_PAYLOAD_COMPILER_VERSION,
  compileOzonListingPayload,
  type OzonListingResolvedImageV1,
  type OzonListingResolvedImagesV1,
} from './ozon-listing-payload-compiler.js';
import type { CompiledOzonListingPublishRequest } from './ozon-listing-publisher.js';
import {
  cloneOzonPublishObject,
  hashOzonPublishJson,
  type OzonPublishJson,
} from './ozon-publish-attempts.js';
import { hashOzonListingPublishState } from './source-listing-workflow.js';
import { SourceListingWorkflowCategoryError } from './source-listing-workflow-category.js';

export const OZON_LISTING_PRODUCTION_COMPILE_ADAPTER_VERSION =
  'ozon-listing-production-compile-adapter/v1' as const;
export const OZON_LISTING_CATALOG_AUTHORITY_VERSION =
  'ozon-listing-catalog-authority/v1' as const;
export const OZON_LISTING_ATTRIBUTE_SCHEMA_AUTHORITY_VERSION =
  'ozon-listing-attribute-schema-authority/v1' as const;

const MAX_ID_LENGTH = 500;
const MAX_URL_LENGTH = 4096;
const CATALOG_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
const ATTRIBUTE_SCHEMA_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_PAYLOAD_MAX_BYTES = 8 * 1024 * 1024;
const DURABLE_MEDIA_BACKENDS = new Set(['oss', 'ozon-cdn']);

export type OzonListingProductionCompileErrorCode =
  | 'OZON_LISTING_PRODUCTION_OWNER_INVALID'
  | 'OZON_LISTING_PRODUCTION_AUTHORITY_UNAVAILABLE'
  | 'OZON_LISTING_PRODUCTION_CAPTURE_STALE'
  | 'OZON_LISTING_PRODUCTION_VALIDATION_STALE'
  | 'OZON_LISTING_PRODUCTION_CATALOG_STALE'
  | 'OZON_LISTING_PRODUCTION_SCHEMA_STALE'
  | 'OZON_LISTING_PRODUCTION_MEDIA_INVALID'
  | 'OZON_LISTING_PRODUCTION_PAYLOAD_INVALID'
  | 'OZON_LISTING_PRODUCTION_OUTPUT_INVALID';

export class OzonListingProductionCompileError extends Error {
  readonly statusCode: 422 | 503;

  constructor(readonly code: OzonListingProductionCompileErrorCode, message: string) {
    super(message);
    this.name = 'OzonListingProductionCompileError';
    this.statusCode = code === 'OZON_LISTING_PRODUCTION_AUTHORITY_UNAVAILABLE' ? 503 : 422;
  }
}

export interface OzonListingOwnedCaptureSnapshot {
  snapshotId: string;
  ownerUserId: string;
  captureHash: string;
  capture: SourceProductCaptureV2;
}

export interface OzonListingCurrentCatalogAuthority {
  snapshotId: string;
  shopId: string;
  snapshot: OzonCategoryCatalogSnapshot;
}

export interface OzonListingAuthoritativeValidation {
  authorityMode?: 'PUBLISH_CACHE_REQUIRED';
  schema: OzonNormalizedAttributeSchema;
  result: OzonAttributeValidationResult;
}

export interface OzonListingOwnedMediaAsset {
  id: string;
  ownerUserId: string;
  url: string;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
}

export interface OzonListingProductionCompileAdapterOptions {
  loadOwnedCapture(input: {
    ownerUserId: string;
    snapshotId: string;
  }): Promise<OzonListingOwnedCaptureSnapshot | null>;
  loadCurrentCatalogAuthority(input: {
    ownerUserId: string;
    shopId: string;
  }): Promise<OzonListingCurrentCatalogAuthority | null>;
  loadAuthoritativeValidation(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<OzonListingAuthoritativeValidation | null>;
  loadOwnedMediaAssets(input: {
    ownerUserId: string;
    assetIds: string[];
  }): Promise<OzonListingOwnedMediaAsset[]>;
  now?: () => Date;
}

export interface OzonListingProductionAuthorityPreflightResult {
  capture: OzonListingOwnedCaptureSnapshot;
  catalog: {
    authority: OzonListingCurrentCatalogAuthority;
    target: OzonCategoryCatalogEntry;
  };
  validation: OzonListingAuthoritativeValidation;
  images: OzonListingResolvedImagesV1;
}

function fail(code: OzonListingProductionCompileErrorCode, message: string): never {
  throw new OzonListingProductionCompileError(code, message);
}

function exactText(value: unknown, label: string, maxLength = MAX_ID_LENGTH): string {
  if (typeof value !== 'string') fail('OZON_LISTING_PRODUCTION_OUTPUT_INVALID', `${label} must be a string`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || Array.from(value).length > maxLength) {
    fail('OZON_LISTING_PRODUCTION_OUTPUT_INVALID', `${label} is not an exact bounded value`);
  }
  return value;
}

function mediaIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', `${label} must be a string`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || Array.from(value).length > MAX_ID_LENGTH) {
    fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', `${label} is not an exact bounded value`);
  }
  return value;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalStringify(left) === canonicalStringify(right);
  } catch {
    return false;
  }
}

function frozenValidationSemantics(report: unknown): Record<string, unknown> | null {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  const {
    schemaSource: _schemaSource,
    officialDataFreshness: _officialDataFreshness,
    ...semantics
  } = report as Record<string, unknown>;
  return semantics;
}

function authorityDictionaryKeys(
  report: unknown,
  requirement: 'OFFICIAL_REFRESH_REQUIRED' | 'PUBLISH_CACHE_REQUIRED',
  source: 'ozon_api' | 'cache',
): string[] | null {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  const record = report as Record<string, unknown>;
  if (record.schemaSource !== source || record.schemaWarning) return null;
  const freshness = record.officialDataFreshness;
  if (!freshness || typeof freshness !== 'object' || Array.isArray(freshness)) return null;
  const metadata = freshness as Record<string, unknown>;
  const dictionarySources = metadata.dictionarySources;
  if (metadata.requirement !== requirement
    || metadata.schemaSource !== source
    || !dictionarySources
    || typeof dictionarySources !== 'object'
    || Array.isArray(dictionarySources)) return null;
  const sources = dictionarySources as Record<string, unknown>;
  const keys = Object.keys(sources).sort();
  return keys.every((key) => sources[key] === source) ? keys : null;
}

function hasFreshPublishCacheAuthority(
  value: OzonListingAuthoritativeValidation,
  frozenReport: unknown,
): boolean {
  if (value.authorityMode !== 'PUBLISH_CACHE_REQUIRED'
    || value.schema.definitionSource !== 'cache'
    || value.schema.definitionWarning) return false;
  const frozenKeys = authorityDictionaryKeys(
    frozenReport,
    'OFFICIAL_REFRESH_REQUIRED',
    'ozon_api',
  );
  const liveKeys = authorityDictionaryKeys(
    value.result.report,
    'PUBLISH_CACHE_REQUIRED',
    'cache',
  );
  if (!frozenKeys || !liveKeys || frozenKeys.length !== liveKeys.length) return false;
  const schemaDictionaryKeys = new Set(value.schema.fields
    .filter((field) => field.valuePolicy !== 'FREE_TEXT' && field.dictionaryId != null)
    .map((field) => String(field.attributeId)));
  return frozenKeys.every((key, index) => (
    key === liveKeys[index] && schemaDictionaryKeys.has(key)
  ));
}

function schemaRevision(schema: OzonNormalizedAttributeSchema): string {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: schema.schemaVersion,
    shopId: schema.shopId,
    descriptionCategoryId: schema.descriptionCategoryId,
    typeId: schema.typeId,
    language: schema.language,
    catalogRevision: schema.catalogRevision,
    definitionsHash: schema.definitionsHash,
  })).digest('hex');
}

function assertOwnedCapture(
  draft: OzonListingDraft,
  ownerUserId: string,
  value: OzonListingOwnedCaptureSnapshot | null,
): OzonListingOwnedCaptureSnapshot {
  let actualHash = '';
  try {
    actualHash = createHash('sha256')
      .update(sourceProductCaptureCanonicalStringify(value?.capture as SourceProductCaptureV2))
      .digest('hex');
  } catch {
    fail('OZON_LISTING_PRODUCTION_CAPTURE_STALE', 'Owned Capture V2 is not canonical JSON');
  }
  if (!value
    || value.ownerUserId !== ownerUserId
    || value.snapshotId !== draft.sourceCaptureSnapshotId
    || value.captureHash !== draft.sourceCaptureHash
    || actualHash !== value.captureHash
    || value.capture?.captureVersion !== 'source-product-capture-v2') {
    fail('OZON_LISTING_PRODUCTION_CAPTURE_STALE', 'Owned Capture V2 authority does not match the frozen draft');
  }
  return value;
}

function catalogTarget(
  draft: OzonListingDraft,
  authority: OzonListingCurrentCatalogAuthority | null,
  now: Date,
): { authority: OzonListingCurrentCatalogAuthority; target: OzonCategoryCatalogEntry } {
  const snapshot = authority?.snapshot;
  const category = draft.category;
  if (!authority || !snapshot || !category
    || authority.shopId !== draft.shopId
    || snapshot.schemaVersion !== OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION
    || snapshot.authoritative !== true
    || snapshot.complete !== true
    || snapshot.defaultTreeComplete !== true
    || snapshot.zhHansTreeComplete !== true
    || snapshot.stale !== false
    || !Array.isArray(snapshot.entries)
    || !(snapshot.fetchedAt instanceof Date)
    || !(snapshot.expiresAt instanceof Date)
    || !Number.isFinite(snapshot.fetchedAt.getTime())
    || !Number.isFinite(snapshot.expiresAt.getTime())
    || snapshot.fetchedAt.getTime() > now.getTime()
    || snapshot.expiresAt.getTime() <= now.getTime()
    || deriveOzonCategoryCatalogRevision(snapshot.entries) !== snapshot.revision
    || snapshot.revision !== category.catalogRevision) {
    fail('OZON_LISTING_PRODUCTION_CATALOG_STALE', 'Current authoritative Ozon catalog does not match the frozen draft');
  }
  exactText(authority.snapshotId, 'catalog.snapshotId');
  const targets = snapshot.entries.filter((entry) => (
    entry.descriptionCategoryId === category.categoryId && entry.typeId === category.typeId
  ));
  const target = targets[0];
  if (targets.length !== 1 || !target || target.disabled === true || target.selectable === false) {
    fail('OZON_LISTING_PRODUCTION_CATALOG_STALE', 'Frozen category is not one selectable current official target');
  }
  return { authority, target };
}

function authoritativeValidation(
  draft: OzonListingDraft,
  catalogRevision: string,
  value: OzonListingAuthoritativeValidation | null,
): OzonListingAuthoritativeValidation {
  const reportMatches = value?.authorityMode === 'PUBLISH_CACHE_REQUIRED'
    ? canonicalEqual(
        frozenValidationSemantics(value.result.report),
        frozenValidationSemantics(draft.validation.report as OzonAttributeValidationResult['report']),
      )
    : canonicalEqual(value?.result.report, draft.validation.report);
  if (!value
    || value.result.status !== 'VALID'
    || value.result.blockers.length > 0
    || value.result.report.operationReadiness.ozonImport.status !== 'READY'
    || value.result.report.operationReadiness.ozonImport.issues.length > 0
    || !reportMatches
    || (value.authorityMode === 'PUBLISH_CACHE_REQUIRED'
      && !hasFreshPublishCacheAuthority(value, draft.validation.report))) {
    fail('OZON_LISTING_PRODUCTION_VALIDATION_STALE', 'Authoritative validation is not the frozen VALID report');
  }
  const schema = value.schema;
  const category = draft.category;
  const revision = schemaRevision(schema);
  if (!category
    || schema.schemaVersion !== 'ozon-attribute-schema/v1'
    || schema.shopId !== draft.shopId
    || schema.descriptionCategoryId !== category.categoryId
    || schema.typeId !== category.typeId
    || schema.language !== 'DEFAULT'
    || schema.catalogRevision !== catalogRevision
    || schema.catalogRevision !== category.catalogRevision
    || !/^[a-f0-9]{64}$/.test(schema.definitionsHash)
    || !Array.isArray(schema.fields)
    || schema.definitionSource === 'stale-cache'
    || !!schema.definitionWarning
    || revision !== value.result.report.schemaRevision) {
    fail('OZON_LISTING_PRODUCTION_SCHEMA_STALE', 'Current attribute schema authority does not match validation and catalog');
  }
  return value;
}

function validatedHttpsUrl(value: unknown): string {
  if (typeof value !== 'string'
    || !value || value !== value.normalize('NFKC').trim() || value.length > MAX_URL_LENGTH) {
    fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'MediaAsset URL is not an exact bounded value');
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) throw new Error();
  } catch {
    fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'MediaAsset must have a durable HTTPS URL');
  }
  return value;
}

function resolvedImages(
  draft: OzonListingDraft,
  ownerUserId: string,
  assets: OzonListingOwnedMediaAsset[],
  resolvedAt: string,
): OzonListingResolvedImagesV1 {
  const assignedIds = draft.media.assignments.map((assignment) => assignment.assetId);
  const assignedSet = new Set(assignedIds);
  if (assignedIds.length === 0 || assignedSet.size !== assignedIds.length
    || !Array.isArray(assets) || assets.length !== assignedSet.size) {
    fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'Owned MediaAsset coverage must match assignments exactly');
  }
  const byId = new Map<string, OzonListingOwnedMediaAsset>();
  for (const asset of assets) {
    if (!asset
      || asset.ownerUserId !== ownerUserId
      || mediaIdentifier(asset.id, 'MediaAsset.id') !== asset.id
      || !assignedSet.has(asset.id)
      || byId.has(asset.id)
      || !DURABLE_MEDIA_BACKENDS.has(asset.storageBackend)
      || typeof asset.storageKey !== 'string'
      || !asset.storageKey
      || asset.storageKey !== asset.storageKey.normalize('NFKC').trim()
      || typeof asset.mimeType !== 'string'
      || !asset.mimeType.toLowerCase().startsWith('image/')) {
      fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'MediaAsset is not exact, owned and durably stored');
    }
    validatedHttpsUrl(asset.url);
    byId.set(asset.id, asset);
  }
  if (byId.size !== assignedSet.size) {
    fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'Owned MediaAsset loader returned missing or extra assets');
  }

  const selectedSkuKeys = new Set(draft.selectedSkuKeys);
  const product: OzonListingResolvedImageV1[] = [];
  const bySku: Record<string, OzonListingResolvedImageV1[]> = {};
  for (const assignment of draft.media.assignments) {
    mediaIdentifier(assignment.slotKey, 'media.slotKey');
    const asset = byId.get(assignment.assetId);
    if (!asset) fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'Assigned MediaAsset was not loaded');
    const image: OzonListingResolvedImageV1 = {
      assetId: asset.id,
      url: asset.url,
      status: 'VALIDATED_DURABLE',
    };
    const rawSkuKey = (assignment as { skuKey?: unknown }).skuKey;
    if (assignment.scope === 'PRODUCT') {
      if (rawSkuKey !== undefined) {
        fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'Product media assignment cannot include skuKey');
      }
      product.push(image);
      continue;
    }
    if (assignment.scope !== 'SKU') {
      fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'Media assignment requires an explicit PRODUCT or SKU scope');
    }
    const skuKey = mediaIdentifier(rawSkuKey, 'media.skuKey');
    if (!selectedSkuKeys.has(skuKey)) {
      fail('OZON_LISTING_PRODUCTION_MEDIA_INVALID', 'SKU media assignment targets an unselected canonical SKU');
    }
    (bySku[skuKey] ||= []).push(image);
  }
  return {
    contractVersion: 'ozon-listing-resolved-images/v1',
    authority: {
      draftId: draft.id,
      draftVersion: draft.draftVersion,
      revision: draft.revision,
      shopId: draft.shopId,
      sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
      sourceCaptureHash: draft.sourceCaptureHash,
      resolverVersion: OZON_LISTING_PRODUCTION_COMPILE_ADAPTER_VERSION,
      resolvedAt,
    },
    product,
    bySku,
  };
}

function catalogAuthoritySnapshot(
  value: { authority: OzonListingCurrentCatalogAuthority; target: OzonCategoryCatalogEntry },
): Record<string, OzonPublishJson> {
  const snapshot = value.authority.snapshot;
  return cloneOzonPublishObject({
    contractVersion: OZON_LISTING_CATALOG_AUTHORITY_VERSION,
    snapshotId: value.authority.snapshotId,
    schemaVersion: snapshot.schemaVersion,
    shopId: value.authority.shopId,
    revision: snapshot.revision,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    expiresAt: snapshot.expiresAt.toISOString(),
    target: value.target,
  }, 'catalog authority snapshot', CATALOG_SNAPSHOT_MAX_BYTES);
}

function attributeSchemaAuthoritySnapshot(
  value: OzonListingAuthoritativeValidation,
): Record<string, OzonPublishJson> {
  return cloneOzonPublishObject({
    contractVersion: OZON_LISTING_ATTRIBUTE_SCHEMA_AUTHORITY_VERSION,
    schemaRevision: value.result.report.schemaRevision,
    schema: value.schema,
  }, 'attribute schema authority snapshot', ATTRIBUTE_SCHEMA_SNAPSHOT_MAX_BYTES);
}

function assertPayloadTrace(
  requestPayload: Record<string, OzonPublishJson>,
  offerTrace: CompiledOzonListingPublishRequest['offerTrace'],
): void {
  const items = requestPayload.items;
  if (!Array.isArray(items) || items.length !== offerTrace.length) {
    fail('OZON_LISTING_PRODUCTION_OUTPUT_INVALID', 'Offer trace must cover every request item exactly');
  }
  const seenOffers = new Set<string>();
  for (const [index, trace] of offerTrace.entries()) {
    const item = items[index];
    const offerId = item && typeof item === 'object' && !Array.isArray(item)
      ? item.offer_id
      : undefined;
    if (trace.ordinal !== index
      || typeof offerId !== 'string'
      || offerId !== trace.offerId
      || seenOffers.has(trace.offerId)) {
      fail('OZON_LISTING_PRODUCTION_OUTPUT_INVALID', 'Offer trace is not bound to request payload ordinals');
    }
    seenOffers.add(trace.offerId);
  }
}

async function loadAuthorities(
  options: OzonListingProductionCompileAdapterOptions,
  ownerUserId: string,
  draft: OzonListingDraft,
  assetIds: string[],
) {
  try {
    const captureAndAssets = Promise.all([
      Promise.resolve().then(() => options.loadOwnedCapture({
        ownerUserId,
        snapshotId: draft.sourceCaptureSnapshotId,
      })),
      Promise.resolve().then(() => options.loadOwnedMediaAssets({ ownerUserId, assetIds })),
    ]);
    const validationAndCatalog = (async () => {
      const validation = await Promise.resolve().then(() => (
        options.loadAuthoritativeValidation({ ownerUserId, draft })
      ));
      const catalog = await options.loadCurrentCatalogAuthority({
        ownerUserId,
        shopId: draft.shopId,
      });
      return { validation, catalog };
    })();
    const [[capture, assets], { validation, catalog }] = await Promise.all([
      captureAndAssets,
      validationAndCatalog,
    ]);
    return { capture, catalog, validation, assets };
  } catch (error) {
    if (error instanceof OzonListingProductionCompileError) throw error;
    if (error instanceof SourceListingWorkflowCategoryError
      && (error.code === 'SOURCE_LISTING_CATALOG_STALE'
        || error.code === 'SOURCE_LISTING_CATEGORY_NOT_SELECTABLE')) {
      fail(
        'OZON_LISTING_PRODUCTION_CATALOG_STALE',
        'Current authoritative Ozon catalog does not match the frozen draft',
      );
    }
    fail(
      'OZON_LISTING_PRODUCTION_AUTHORITY_UNAVAILABLE',
      'Production publish authority is temporarily unavailable',
    );
  }
}

export async function preflightOzonListingProductionAuthorities(
  options: OzonListingProductionCompileAdapterOptions,
  input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  },
): Promise<OzonListingProductionAuthorityPreflightResult> {
  const ownerUserId = exactText(input.ownerUserId, 'ownerUserId');
  if (ownerUserId !== input.draft.ownerUserId) {
    fail('OZON_LISTING_PRODUCTION_OWNER_INVALID', 'Compile owner does not own the frozen draft');
  }
  const currentTime = (options.now || (() => new Date()))();
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    fail('OZON_LISTING_PRODUCTION_AUTHORITY_UNAVAILABLE', 'Compile clock is invalid');
  }
  const assetIds = [...new Set(input.draft.media.assignments.map((assignment) => (
    mediaIdentifier(assignment.assetId, 'media.assetId')
  )))];
  const loaded = await loadAuthorities(options, ownerUserId, input.draft, assetIds);
  const capture = assertOwnedCapture(input.draft, ownerUserId, loaded.capture);
  const catalog = catalogTarget(input.draft, loaded.catalog, currentTime);
  const validation = authoritativeValidation(
    input.draft,
    catalog.authority.snapshot.revision,
    loaded.validation,
  );
  const images = resolvedImages(
    input.draft,
    ownerUserId,
    loaded.assets,
    currentTime.toISOString(),
  );
  return { capture, catalog, validation, images };
}

export function createOzonListingProductionCompileAdapter(
  options: OzonListingProductionCompileAdapterOptions,
) {
  return async function compile(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<CompiledOzonListingPublishRequest> {
    const { capture, catalog, validation, images } =
      await preflightOzonListingProductionAuthorities(options, input);

    let compiled;
    try {
      const payloadValidationReport = frozenValidationSemantics(input.draft.validation.report);
      const payloadDraft = structuredClone(input.draft);
      payloadDraft.validation.report = payloadValidationReport as typeof payloadDraft.validation.report;
      compiled = compileOzonListingPayload({
        draft: payloadDraft,
        capture: capture.capture,
        validationReport: payloadValidationReport,
        resolvedImages: images,
      });
    } catch (error) {
      fail(
        'OZON_LISTING_PRODUCTION_PAYLOAD_INVALID',
        `Frozen listing payload was rejected: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    if (compiled.compilerVersion !== OZON_LISTING_PAYLOAD_COMPILER_VERSION) {
      fail('OZON_LISTING_PRODUCTION_OUTPUT_INVALID', 'Unsupported payload compiler version');
    }

    let requestPayload: Record<string, OzonPublishJson>;
    let catalogSnapshot: Record<string, OzonPublishJson>;
    let attributeSchemaSnapshot: Record<string, OzonPublishJson>;
    try {
      requestPayload = cloneOzonPublishObject(
        compiled.payload,
        'compiled Ozon request payload',
        REQUEST_PAYLOAD_MAX_BYTES,
      );
      catalogSnapshot = catalogAuthoritySnapshot(catalog);
      attributeSchemaSnapshot = attributeSchemaAuthoritySnapshot(validation);
    } catch (error) {
      fail(
        'OZON_LISTING_PRODUCTION_OUTPUT_INVALID',
        `Compiled authority snapshot is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    const requestPayloadHash = hashOzonPublishJson(requestPayload);
    if (requestPayloadHash !== compiled.canonicalHash) {
      fail('OZON_LISTING_PRODUCTION_OUTPUT_INVALID', 'Payload compiler and publisher canonical hashes disagree');
    }
    const offerTrace = compiled.offerTrace.map(({ ordinal, skuKey, offerId }) => ({
      ordinal, skuKey, offerId,
    }));
    assertPayloadTrace(requestPayload, offerTrace);

    return {
      publisherContractVersion: OZON_LISTING_PRODUCTION_COMPILE_ADAPTER_VERSION,
      endpoint: '/v3/product/import',
      draftStateHash: hashOzonListingPublishState(input.draft),
      catalogSnapshotId: catalog.authority.snapshotId,
      catalogRevision: catalog.authority.snapshot.revision,
      catalogSnapshot,
      catalogSnapshotHash: hashOzonPublishJson(catalogSnapshot),
      attributeSchemaSnapshot,
      attributeSchemaHash: hashOzonPublishJson(attributeSchemaSnapshot),
      requestPayload,
      requestPayloadHash,
      offerTrace,
    };
  };
}

export type OzonListingProductionCompileAdapter = ReturnType<
  typeof createOzonListingProductionCompileAdapter
>;
