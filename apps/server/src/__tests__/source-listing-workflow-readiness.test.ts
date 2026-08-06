import type { OzonListingDraft, OzonListingPricingV1, OzonListingWorkflowIssue } from 'shared';
import { describe, expect, it } from 'vitest';
import {
  mergeSourceListingWorkflowReadiness,
  sourceListingWorkflowReadinessIssues,
  validateSourceListingPricing,
} from '../services/source-listing-workflow-readiness.js';

function pricing(items: OzonListingPricingV1['items'] = [
  { skuKey: 'sku-a', price: '100.50', oldPrice: '120', currencyCode: 'RUB', vat: '0' },
  { skuKey: 'sku-b', price: '200', oldPrice: '240.00', currencyCode: 'RUB', vat: '0', offerId: 'offer-b' },
]): OzonListingPricingV1 {
  return { contractVersion: 'ozon-listing-pricing/v1', items };
}

function draft(overrides: Partial<OzonListingDraft> = {}): OzonListingDraft {
  const candidate = {
    id: 'candidate-1',
    titleRu: 'Женская хлопковая футболка',
    descriptionRu: 'Описание товара на русском языке.',
    sourcePromptVersion: 'copy-v1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    createdByUserId: 'owner-1',
    createdAt: '2026-07-15T00:00:00.000Z',
  };
  return {
    id: 'draft-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-a', 'sku-b'],
    draftVersion: 4,
    revision: 8,
    stage: 'VALIDATION',
    runState: 'ACTIVE',
    runStateReason: null,
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    attributes: { values: {} },
    copy: {
      publishTitleRu: candidate.titleRu,
      publishDescriptionRu: candidate.descriptionRu,
      candidates: [candidate],
      applyAudit: [{
        id: 'apply-1',
        candidateId: candidate.id,
        actorUserId: 'owner-1',
        operationKey: 'apply-copy-1',
        draftVersion: 4,
        previousTitleRu: null,
        previousDescriptionRu: null,
        appliedAt: '2026-07-15T00:01:00.000Z',
      }],
    },
    media: {
      assignments: [{
        scope: 'PRODUCT', slotKey: 'product-main', assetId: 'asset-main', source: 'SOURCE',
      }],
    },
    pricing: { value: pricing() },
    validation: { status: 'STALE', report: null },
    completedStepHashes: {},
    blockers: [],
    warnings: [],
    publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null },
      attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null },
      media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null },
      validation: { state: 'STALE', reason: 'PRICING_CHANGED' },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [],
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:01:00.000Z',
    ...overrides,
  };
}

function attributeValidation(overrides: {
  status?: 'VALID' | 'INVALID';
  blockers?: OzonListingWorkflowIssue[];
} = {}) {
  const blockers = overrides.blockers || [];
  return {
    status: overrides.status || (blockers.length ? 'INVALID' : 'VALID') as 'VALID' | 'INVALID',
    report: {
      schemaVersion: 'ozon-attribute-validation/v1',
      schemaRevision: 'schema-1',
      normalizedAttributes: [],
      fieldDecisions: [],
      operationReadiness: {
        ozonImport: { status: blockers.length ? 'BLOCKED' : 'READY', issues: [...blockers] },
        inventoryActivation: { status: 'READY', issues: [] },
        costingAutoPricing: { status: 'READY', issues: [] },
      },
      operationalFacts: {
        packageWeightG: 500,
        packageDimensionsMm: { lengthMm: 100, widthMm: 80, heightMm: 20 },
        selectedStock: { known: 2, unknown: 0 },
        shippingCny: 0,
        evidence: {},
        sources: {
          packageWeightG: 'MANUAL',
          packageLengthMm: 'MANUAL',
          packageWidthMm: 'MANUAL',
          packageHeightMm: 'MANUAL',
          selectedStock: 'SOURCE',
          shippingCny: 'SOURCE',
        },
        importContract: {
          contractId: 'ozon-v3-product-import-package',
          contractRevision: '1',
          contractHash: 'b'.repeat(64),
        },
      },
    },
    blockers,
    warnings: [] as OzonListingWorkflowIssue[],
  };
}

describe('strict source listing pricing', () => {
  it('accepts one exact RUB pricing row for every selected canonical SKU', () => {
    const value = pricing();
    const result = validateSourceListingPricing(value, ['sku-a', 'sku-b']);
    expect(result).toEqual(value);
    expect(result).not.toBe(value);
  });

  it('accepts one exact CNY pricing row for every selected canonical SKU', () => {
    const value = pricing([
      { skuKey: 'sku-a', price: '107', oldPrice: '129', currencyCode: 'CNY', vat: '0' },
      { skuKey: 'sku-b', price: '122', oldPrice: '147', currencyCode: 'CNY', vat: '0' },
    ]);
    expect(validateSourceListingPricing(value, ['sku-a', 'sku-b'])).toEqual(value);
  });

  it.each([
    ['null', null],
    ['arbitrary object', { markupPct: 20 }],
    ['extra root field', { ...pricing(), extra: true }],
    ['empty items', pricing([])],
    ['duplicate SKU', pricing([
      { skuKey: 'sku-a', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0' },
      { skuKey: 'sku-a', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
    ['partial coverage', pricing([
      { skuKey: 'sku-a', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0' },
    ])],
    ['noncanonical SKU', pricing([
      { skuKey: ' sku-a', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0' },
      { skuKey: 'sku-b', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
    ['zero price', pricing([
      { skuKey: 'sku-a', price: '0', oldPrice: '120', currencyCode: 'RUB', vat: '0' },
      { skuKey: 'sku-b', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
    ['noncanonical decimal', pricing([
      { skuKey: 'sku-a', price: '0100', oldPrice: '120', currencyCode: 'RUB', vat: '0' },
      { skuKey: 'sku-b', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
    ['unsupported currency', pricing([
      {
        skuKey: 'sku-a', price: '100', oldPrice: '120',
        currencyCode: 'USD' as unknown as 'RUB', vat: '0',
      },
      { skuKey: 'sku-b', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
    ['mixed supported currencies', pricing([
      { skuKey: 'sku-a', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' },
      { skuKey: 'sku-b', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
    ['invalid VAT', pricing([
      { skuKey: 'sku-a', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: 'bad vat' },
      { skuKey: 'sku-b', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
    ['noncanonical offer ID', pricing([
      { skuKey: 'sku-a', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0', offerId: ' offer-a' },
      { skuKey: 'sku-b', price: '200', oldPrice: '220', currencyCode: 'RUB', vat: '0' },
    ])],
  ])('rejects %s', (_label, value) => {
    expect(() => validateSourceListingPricing(value, ['sku-a', 'sku-b']))
      .toThrow(expect.objectContaining({ code: 'OZON_LISTING_PRICING_INVALID', statusCode: 400 }));
  });
});

describe('whole source listing workflow readiness', () => {
  it('preserves the authoritative validation schema when every workflow surface is ready', () => {
    const original = attributeValidation();
    const result = mergeSourceListingWorkflowReadiness({ draft: draft(), validation: original });
    expect(result).toMatchObject({
      status: 'VALID',
      blockers: [],
      report: {
        schemaVersion: 'ozon-attribute-validation/v1',
        schemaRevision: 'schema-1',
        operationReadiness: { ozonImport: { status: 'READY', issues: [] } },
      },
    });
    expect(result.report).not.toBe(original.report);
  });

  it('merges copy, media, pricing and freshness blockers into Ozon import readiness', () => {
    const value = draft({
      copy: {
        publishTitleRu: 'Chinese 标题',
        publishDescriptionRu: null,
        candidates: [],
        applyAudit: [],
      },
      media: {
        assignments: [{
          scope: 'SKU', skuKey: 'sku-a', slotKey: 'sku-a-main', assetId: 'asset-a', source: 'SOURCE',
        }],
      },
      pricing: { value: { markupPct: 20 } },
      freshness: {
        ...draft().freshness,
        content: { state: 'STALE', reason: 'CONTENT_APPLIED' },
        media: { state: 'STALE', reason: 'MEDIA_ASSIGNMENT_CHANGED' },
      },
    });
    const result = mergeSourceListingWorkflowReadiness({
      draft: value,
      validation: attributeValidation(),
    });
    const codes = result.blockers.map((issue) => issue.code);
    expect(result.status).toBe('INVALID');
    expect(codes).toEqual(expect.arrayContaining([
      'OZON_LISTING_COPY_INVALID',
      'OZON_LISTING_MEDIA_SKU_UNCOVERED',
      'OZON_LISTING_PRICING_INVALID',
      'OZON_LISTING_FRESHNESS_STALE',
    ]));
    expect(result.report.operationReadiness.ozonImport).toMatchObject({
      status: 'BLOCKED',
      issues: expect.arrayContaining(codes.map((code) => expect.objectContaining({ code }))),
    });
  });

  it('never treats a new draft with empty copy, media and pricing as publishable', () => {
    const empty = draft({
      copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
      media: { assignments: [] },
      pricing: { value: null },
    });
    expect(sourceListingWorkflowReadinessIssues(empty).map((issue) => issue.code)).toEqual([
      'OZON_LISTING_COPY_INVALID',
      'OZON_LISTING_MEDIA_REQUIRED',
      'OZON_LISTING_PRICING_INVALID',
    ]);
  });

  it('requires an explicitly confirmed official category even when all other surfaces are ready', () => {
    const missingCategory = draft({ category: null });
    expect(sourceListingWorkflowReadinessIssues(missingCategory)).toContainEqual({
      code: 'OZON_LISTING_CATEGORY_REQUIRED',
      message: 'An active official Ozon category and type must be explicitly confirmed',
      fieldPath: 'category',
    });
  });
});
