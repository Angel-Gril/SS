import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  sourceProductCaptureCanonicalStringify,
  type OzonListingDraft,
  type OzonListingDraftMediaAssignment,
  type OzonNormalizedAttributeSchema,
  type SourceProductCaptureV2,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { describe, expect, it, vi } from 'vitest';
import type { OzonAttributeValidationReport } from '../services/ozon-attribute-validation.js';
import {
  OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION,
  deriveOzonCategoryCatalogRevision,
  type OzonCategoryCatalogEntry,
} from '../services/ozon-category-catalog.js';
import {
  OzonListingProductionCompileError,
  createOzonListingProductionCompileAdapter,
  type OzonListingProductionCompileAdapterOptions,
} from '../services/ozon-listing-production-compile-adapter.js';
import { hashOzonPublishJson } from '../services/ozon-publish-attempts.js';
import { OZON_V3_IMPORT_PACKAGE_CONTRACT } from '../services/ozon-v3-import-package-contract.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

function hashCapture(capture: SourceProductCaptureV2): string {
  return createHash('sha256').update(sourceProductCaptureCanonicalStringify(capture)).digest('hex');
}

function captureWithTwoSkus(): SourceProductCaptureV2 {
  const capture = structuredClone(fixture.capture);
  const second = structuredClone(capture.skus[0]!);
  second.key = 'sku-1';
  second.sourceSkuId = 'source-sku-1';
  second.ordinal = 1;
  second.fieldEvidence.sourceSkuId.value = second.sourceSkuId;
  capture.skus.push(second);
  const count = capture.counts.find((entry) => entry.fieldPath === '/skus')!;
  count.totalCount = 2;
  count.capturedCount = 2;
  count.submittedCount = 2;
  return capture;
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

function catalogEntry(): OzonCategoryCatalogEntry {
  return {
    descriptionCategoryId: 17028922,
    typeId: 9163,
    categoryPathRu: ['Одежда'],
    categoryPathZh: ['服装'],
    categoryLevels: [{
      level: 1, categoryId: 17028922, nameRu: 'Одежда', nameZh: '服装', translated: true,
    }],
    categoryNameRu: 'Одежда',
    categoryNameZh: '服装',
    typeNameRu: 'Тестовый тип',
    typeNameZh: '测试类型',
    displayPathRu: 'Одежда / Тестовый тип',
    displayPathZh: '服装 / 测试类型',
    translationStatus: 'complete',
    untranslatedTerms: [],
    keywords: ['одежда'],
    searchText: 'одежда тестовый тип',
    disabled: false,
    selectable: true,
  };
}

function build() {
  const capture = captureWithTwoSkus();
  const sourceCaptureHash = hashCapture(capture);
  const entry = catalogEntry();
  const catalogRevision = deriveOzonCategoryCatalogRevision([entry]);
  const schema: OzonNormalizedAttributeSchema = {
    schemaVersion: 'ozon-attribute-schema/v1',
    shopId: 'shop-1',
    descriptionCategoryId: entry.descriptionCategoryId,
    typeId: entry.typeId,
    language: 'DEFAULT',
    catalogRevision,
    definitionsHash: 'd'.repeat(64),
    definitionSource: 'ozon_api',
    fields: [
      {
        attributeId: 10, name: 'Общее поле', description: '', sourceType: 'String',
        valueType: 'STRING', cardinality: 'SINGLE', required: true, dictionaryId: null,
        valuePolicy: 'FREE_TEXT', ownership: 'EDITOR', editorMode: 'EDITABLE',
        aiSuggestionAllowed: true, readinessImpact: 'OZON_IMPORT',
      },
      {
        attributeId: 20, name: 'SKU поле', description: '', sourceType: 'String',
        valueType: 'STRING', cardinality: 'SINGLE', required: true, dictionaryId: null,
        valuePolicy: 'FREE_TEXT', ownership: 'SKU', editorMode: 'SKU_MATRIX',
        aiSuggestionAllowed: true, readinessImpact: 'OZON_IMPORT',
      },
    ],
  };
  const report: OzonAttributeValidationReport = {
    schemaVersion: 'ozon-attribute-validation/v1',
    schemaRevision: schemaRevision(schema),
    normalizedAttributes: [
      {
        key: '10', attributeId: 10, values: [{ value: 'Общее значение' }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:product'],
      },
      {
        key: '20', skuKey: 'sku-0', attributeId: 20, values: [{ value: 'SKU ноль' }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:sku-0'],
      },
      {
        key: '20', skuKey: 'sku-1', attributeId: 20, values: [{ value: 'SKU один' }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:sku-1'],
      },
    ],
    fieldDecisions: [
      {
        key: '10', attributeId: 10, valuePolicy: 'FREE_TEXT',
        readinessImpact: 'OZON_IMPORT', accepted: true, issueCodes: [],
      },
      {
        key: '20', attributeId: 20, valuePolicy: 'FREE_TEXT',
        readinessImpact: 'OZON_IMPORT', accepted: true, issueCodes: [],
      },
    ],
    operationReadiness: {
      ozonImport: { status: 'READY', issues: [] },
      inventoryActivation: { status: 'READY', issues: [] },
      costingAutoPricing: { status: 'READY', issues: [] },
    },
    operationalFacts: {
      packageWeightG: 500,
      packageDimensionsMm: { lengthMm: 300, widthMm: 200, heightMm: 40 },
      selectedStock: { known: 2, unknown: 0 },
      shippingCny: 0,
      evidence: {
        packageWeightG: 'manual:owner', packageLengthMm: 'manual:owner',
        packageWidthMm: 'manual:owner', packageHeightMm: 'manual:owner',
      },
      sources: {
        packageWeightG: 'MANUAL', packageLengthMm: 'MANUAL',
        packageWidthMm: 'MANUAL', packageHeightMm: 'MANUAL',
        selectedStock: 'SOURCE', shippingCny: 'SOURCE',
      },
      importContract: {
        contractId: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId,
        contractRevision: OZON_V3_IMPORT_PACKAGE_CONTRACT.revision,
        contractHash: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash,
      },
    },
  };
  const candidate = {
    id: 'copy-1', titleRu: 'Тестовый товар', descriptionRu: 'Проверенное описание',
    sourcePromptVersion: 'copy-v1', sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash, createdByUserId: 'worker-1', createdAt: '2026-07-15T08:00:00.000Z',
  };
  const draft: OzonListingDraft = {
    id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash,
    selectedSkuKeys: ['sku-1', 'sku-0'], draftVersion: 7, revision: 9,
    stage: 'PUBLISH_INTENT_RECORDED', runState: 'ACTIVE', runStateReason: null,
    category: {
      categoryId: entry.descriptionCategoryId, typeId: entry.typeId, catalogRevision,
    },
    attributes: { values: {
      packaging: {
        value: { weightG: 500, lengthMm: 300, widthMm: 200, heightMm: 40 },
        source: 'MANUAL', reviewed: true, evidence: ['owner:package-label'],
      },
    } },
    copy: {
      publishTitleRu: candidate.titleRu, publishDescriptionRu: candidate.descriptionRu,
      candidates: [candidate],
      applyAudit: [{
        id: 'apply-1', candidateId: candidate.id, actorUserId: 'owner-1',
        operationKey: 'review-copy-1', draftVersion: 6,
        previousTitleRu: null, previousDescriptionRu: null,
        appliedAt: '2026-07-15T08:01:00.000Z',
      }],
    },
    media: { assignments: [
      { scope: 'PRODUCT', slotKey: 'main', assetId: 'asset-product', source: 'REVIEWED' },
      { scope: 'SKU', skuKey: 'sku-1', slotKey: 'hero', assetId: 'asset-sku-1', source: 'REVIEWED' },
      { scope: 'SKU', skuKey: 'sku-0', slotKey: 'hero', assetId: 'asset-sku-0', source: 'REVIEWED' },
    ] },
    pricing: { value: {
      contractVersion: 'ozon-listing-pricing/v1',
      items: [
        {
          skuKey: 'sku-1', price: '2199.00', oldPrice: '2599.00',
          currencyCode: 'RUB', vat: '0.2',
        },
        {
          skuKey: 'sku-0', price: '1999.00', oldPrice: '2399.00',
          currencyCode: 'RUB', vat: '0.2', offerId: 'reviewed-offer-0',
        },
      ],
    } },
    validation: { status: 'VALID', report: structuredClone(report) },
    completedStepHashes: {}, blockers: [], warnings: [], publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null }, attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null }, media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null }, validation: { state: 'CURRENT', reason: null },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [], createdAt: '2026-07-15T08:00:00.000Z', updatedAt: '2026-07-15T08:02:00.000Z',
  };
  const catalog = {
    snapshotId: 'catalog-snapshot-1',
    shopId: draft.shopId,
    snapshot: {
      schemaVersion: OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION,
      entries: [entry],
      revision: catalogRevision,
      fetchedAt: new Date('2026-07-15T07:00:00.000Z'),
      expiresAt: new Date('2026-07-16T07:00:00.000Z'),
      complete: true,
      defaultTreeComplete: true,
      zhHansTreeComplete: true,
      stale: false,
      authoritative: true,
    },
  };
  const assets = [
    {
      id: 'asset-product', ownerUserId: 'owner-1',
      url: 'https://cdn.example.com/product.jpg', storageBackend: 'oss',
      storageKey: 'owner-1/product.jpg', mimeType: 'image/jpeg',
    },
    {
      id: 'asset-sku-0', ownerUserId: 'owner-1',
      url: 'https://cdn.example.com/sku-0.jpg', storageBackend: 'ozon-cdn',
      storageKey: 'sku-0.jpg', mimeType: 'image/jpeg',
    },
    {
      id: 'asset-sku-1', ownerUserId: 'owner-1',
      url: 'https://cdn.example.com/sku-1.jpg', storageBackend: 'oss',
      storageKey: 'owner-1/sku-1.jpg', mimeType: 'image/jpeg',
    },
  ];
  const options: OzonListingProductionCompileAdapterOptions = {
    loadOwnedCapture: vi.fn(async () => ({
      snapshotId: draft.sourceCaptureSnapshotId,
      ownerUserId: draft.ownerUserId,
      captureHash: draft.sourceCaptureHash,
      capture,
    })),
    loadCurrentCatalogAuthority: vi.fn(async () => catalog),
    loadAuthoritativeValidation: vi.fn(async () => ({
      schema,
      result: { status: 'VALID' as const, report, blockers: [], warnings: [] },
    })),
    loadOwnedMediaAssets: vi.fn(async () => assets),
    now: () => new Date('2026-07-15T08:05:00.000Z'),
  };
  return { draft, capture, report, schema, catalog, assets, options };
}

async function expectCode(
  context: ReturnType<typeof build>,
  code: OzonListingProductionCompileError['code'],
) {
  const compile = createOzonListingProductionCompileAdapter(context.options);
  await expect(compile({ ownerUserId: 'owner-1', draft: context.draft }))
    .rejects.toMatchObject({ code, statusCode: 422 });
}

describe('Ozon listing production compile adapter', () => {
  it('loads exact owner-scoped authorities and returns the publisher request contract', async () => {
    const context = build();
    const compile = createOzonListingProductionCompileAdapter(context.options);
    const result = await compile({ ownerUserId: 'owner-1', draft: context.draft });

    expect(context.options.loadOwnedCapture).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', snapshotId: 'snapshot-1',
    });
    expect(context.options.loadCurrentCatalogAuthority).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', shopId: 'shop-1',
    });
    expect(context.options.loadOwnedMediaAssets).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      assetIds: ['asset-product', 'asset-sku-1', 'asset-sku-0'],
    });
    expect(result).toMatchObject({
      endpoint: '/v3/product/import',
      catalogSnapshotId: 'catalog-snapshot-1',
      catalogRevision: context.catalog.snapshot.revision,
      offerTrace: [
        { ordinal: 0, skuKey: 'sku-0', offerId: 'reviewed-offer-0' },
        { ordinal: 1, skuKey: 'sku-1' },
      ],
    });
    expect(result.requestPayload.items).toHaveLength(2);
  });

  it.each([
    'loadOwnedCapture',
    'loadCurrentCatalogAuthority',
    'loadAuthoritativeValidation',
    'loadOwnedMediaAssets',
  ] as const)('returns a sanitized 503 when %s fails', async (loader) => {
    const context = build();
    vi.mocked(context.options[loader]).mockRejectedValue(
      new Error('password=downstream-secret SELECT * FROM private_table'),
    );

    const promise = createOzonListingProductionCompileAdapter(context.options)({
      ownerUserId: 'owner-1', draft: context.draft,
    });
    await expect(promise).rejects.toMatchObject({
      code: 'OZON_LISTING_PRODUCTION_AUTHORITY_UNAVAILABLE',
      statusCode: 503,
      message: 'Production publish authority is temporarily unavailable',
    });
    await expect(promise).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('downstream-secret'),
    );
    await expect(promise).rejects.not.toHaveProperty(
      'message',
      expect.stringContaining('private_table'),
    );
  });

  it('maps explicit SKU scope by canonical skuKey and keeps slotKey as a role only', async () => {
    const context = build();
    const result = await createOzonListingProductionCompileAdapter(context.options)({
      ownerUserId: 'owner-1', draft: context.draft,
    });
    const items = result.requestPayload.items as Array<Record<string, unknown>>;
    expect(items[0]?.images).toEqual([
      'https://cdn.example.com/product.jpg', 'https://cdn.example.com/sku-0.jpg',
    ]);
    expect(items[1]?.images).toEqual([
      'https://cdn.example.com/product.jpg', 'https://cdn.example.com/sku-1.jpg',
    ]);
  });

  it('freezes bounded catalog/schema authority snapshots and canonical hashes', async () => {
    const context = build();
    const result = await createOzonListingProductionCompileAdapter(context.options)({
      ownerUserId: 'owner-1', draft: context.draft,
    });
    expect(result.catalogSnapshot).toMatchObject({
      contractVersion: 'ozon-listing-catalog-authority/v1',
      snapshotId: 'catalog-snapshot-1',
      revision: context.catalog.snapshot.revision,
      target: {
        descriptionCategoryId: context.draft.category?.categoryId,
        typeId: context.draft.category?.typeId,
      },
    });
    expect(result.attributeSchemaSnapshot).toMatchObject({
      contractVersion: 'ozon-listing-attribute-schema-authority/v1',
      schemaRevision: context.report.schemaRevision,
      schema: context.schema,
    });
    expect(result.catalogSnapshotHash).toBe(hashOzonPublishJson(result.catalogSnapshot));
    expect(result.attributeSchemaHash).toBe(hashOzonPublishJson(result.attributeSchemaSnapshot));
    expect(result.requestPayloadHash).toBe(hashOzonPublishJson(result.requestPayload));
  });

  it('fails closed for a changed frozen report, capture hash, or catalog revision', async () => {
    const report = build();
    (report.draft.validation.report as Record<string, unknown>).schemaRevision = 'changed';
    await expectCode(report, 'OZON_LISTING_PRODUCTION_VALIDATION_STALE');

    const capture = build();
    vi.mocked(capture.options.loadOwnedCapture).mockResolvedValue({
      snapshotId: 'snapshot-1', ownerUserId: 'owner-1', captureHash: 'f'.repeat(64),
      capture: capture.capture,
    });
    await expectCode(capture, 'OZON_LISTING_PRODUCTION_CAPTURE_STALE');

    const capturePayload = build();
    capturePayload.capture.facts.title = 'Tampered capture';
    await expectCode(capturePayload, 'OZON_LISTING_PRODUCTION_CAPTURE_STALE');

    const catalog = build();
    catalog.catalog.snapshot.revision = 'e'.repeat(64);
    await expectCode(catalog, 'OZON_LISTING_PRODUCTION_CATALOG_STALE');
  });

  it('rejects expired/non-authoritative catalog and schema authority drift', async () => {
    const expired = build();
    expired.catalog.snapshot.expiresAt = new Date('2026-07-15T08:00:00.000Z');
    await expectCode(expired, 'OZON_LISTING_PRODUCTION_CATALOG_STALE');

    const schema = build();
    schema.schema.catalogRevision = 'wrong-revision';
    await expectCode(schema, 'OZON_LISTING_PRODUCTION_SCHEMA_STALE');
  });

  it('requires exact owned HTTPS durable MediaAsset coverage', async () => {
    const missing = build();
    vi.mocked(missing.options.loadOwnedMediaAssets).mockResolvedValue(missing.assets.slice(0, 2));
    await expectCode(missing, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');

    const extra = build();
    vi.mocked(extra.options.loadOwnedMediaAssets).mockResolvedValue([
      ...extra.assets,
      {
        id: 'asset-extra', ownerUserId: 'owner-1',
        url: 'https://cdn.example.com/extra.jpg', storageBackend: 'oss',
        storageKey: 'owner-1/extra.jpg', mimeType: 'image/jpeg',
      },
    ]);
    await expectCode(extra, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');

    const crossOwner = build();
    crossOwner.assets[0]!.ownerUserId = 'other-owner';
    await expectCode(crossOwner, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');

    const insecure = build();
    insecure.assets[0]!.url = 'http://cdn.example.com/product.jpg';
    await expectCode(insecure, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');

    const local = build();
    local.assets[0]!.storageBackend = 'local';
    await expectCode(local, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');
  });

  it('rejects missing, contradictory, and stale persisted media scopes', async () => {
    const missingScope = build();
    missingScope.draft.media.assignments[0] = {
      slotKey: 'main', assetId: 'asset-product', source: 'REVIEWED',
    } as OzonListingDraftMediaAssignment;
    await expectCode(missingScope, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');

    const productWithSku = build();
    productWithSku.draft.media.assignments[0] = {
      scope: 'PRODUCT', skuKey: 'sku-0', slotKey: 'main',
      assetId: 'asset-product', source: 'REVIEWED',
    } as unknown as OzonListingDraftMediaAssignment;
    await expectCode(productWithSku, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');

    const cancelledSku = build();
    cancelledSku.draft.media.assignments[1] = {
      scope: 'SKU', skuKey: 'sku-cancelled', slotKey: 'hero',
      assetId: 'asset-sku-1', source: 'REVIEWED',
    };
    await expectCode(cancelledSku, 'OZON_LISTING_PRODUCTION_MEDIA_INVALID');
  });

  it('keeps every persisted offer trace entry bound to the submitted payload ordinal', async () => {
    const context = build();
    const result = await createOzonListingProductionCompileAdapter(context.options)({
      ownerUserId: 'owner-1', draft: context.draft,
    });
    const items = result.requestPayload.items as Array<Record<string, unknown>>;
    expect(result.offerTrace.map((trace) => items[trace.ordinal]?.offer_id))
      .toEqual(result.offerTrace.map((trace) => trace.offerId));
  });
});
