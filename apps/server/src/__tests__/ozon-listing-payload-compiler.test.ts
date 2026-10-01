import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  OZON_LISTING_OFFER_ID_MAX_LENGTH,
  canonicalStringify,
  sourceProductCaptureCanonicalStringify,
  type OzonListingDraft,
  type OzonListingDraftMediaAssignment,
  type OzonListingPricingV1,
  type SourceProductCaptureV2,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { describe, expect, it } from 'vitest';
import type { OzonAttributeValidationReport } from '../services/ozon-attribute-validation.js';
import {
  OZON_LISTING_PAYLOAD_COMPILER_VERSION,
  OzonListingPayloadCompileError,
  compileOzonListingPayload,
  type OzonListingResolvedImagesV1,
} from '../services/ozon-listing-payload-compiler.js';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from '../services/source-listing-sku-identity.js';
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
  const skuCount = capture.counts.find((count) => count.fieldPath === '/skus')!;
  skuCount.totalCount = 2;
  skuCount.capturedCount = 2;
  skuCount.submittedCount = 2;
  return capture;
}

function validationReport(): OzonAttributeValidationReport {
  return {
    schemaVersion: 'ozon-attribute-validation/v1',
    schemaRevision: 'schema-revision-1',
    normalizedAttributes: [
      {
        key: '10', attributeId: 10,
        values: [{ value: 'Общее значение' }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:review'],
      },
      {
        key: '11', attributeId: 11,
        values: [{ value: 'Красный', dictionaryValueId: 101 }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:dictionary'],
      },
      {
        key: '20', skuKey: 'sku-1', attributeId: 20,
        values: [{ value: 42 }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:sku-1'],
      },
      {
        key: '20', skuKey: 'sku-0', attributeId: 20,
        values: [{ value: false }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:sku-0'],
      },
    ],
    fieldDecisions: [
      {
        key: '10', attributeId: 10, valuePolicy: 'FREE_TEXT',
        readinessImpact: 'OZON_IMPORT', accepted: true, issueCodes: [],
      },
      {
        key: '11', attributeId: 11, valuePolicy: 'STRICT_DICTIONARY',
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
}

function pricing(): OzonListingPricingV1 {
  return {
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
  };
}

function buildInput() {
  const capture = captureWithTwoSkus();
  const report = validationReport();
  const sourceCaptureHash = hashCapture(capture);
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
    category: { categoryId: 17028922, typeId: 9163, catalogRevision: 'catalog-42' },
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
    pricing: { value: pricing() },
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
  const resolvedImages: OzonListingResolvedImagesV1 = {
    contractVersion: 'ozon-listing-resolved-images/v1',
    authority: {
      draftId: draft.id, draftVersion: draft.draftVersion, revision: draft.revision,
      shopId: draft.shopId, sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
      sourceCaptureHash: draft.sourceCaptureHash, resolverVersion: 'media-resolver-v1',
      resolvedAt: '2026-07-15T08:02:00.000Z',
    },
    product: [{
      assetId: 'asset-product', url: 'https://cdn.example.com/product.jpg',
      status: 'VALIDATED_DURABLE',
    }],
    bySku: {
      'sku-0': [{
        assetId: 'asset-sku-0', url: 'https://cdn.example.com/sku-0.jpg',
        status: 'VALIDATED_DURABLE',
      }],
      'sku-1': [{
        assetId: 'asset-sku-1', url: 'https://cdn.example.com/sku-1.jpg',
        status: 'VALIDATED_DURABLE',
      }],
    },
  };
  return { draft, capture, validationReport: report, resolvedImages };
}

function expectCompileCode(input: ReturnType<typeof buildInput>, code: string) {
  expect(() => compileOzonListingPayload(input)).toThrowError(
    expect.objectContaining({ code }) as OzonListingPayloadCompileError,
  );
}

function rebindCaptureAuthority(input: ReturnType<typeof buildInput>) {
  input.draft.sourceCaptureHash = hashCapture(input.capture);
  input.draft.copy.candidates[0]!.sourceCaptureHash = input.draft.sourceCaptureHash;
  input.resolvedImages.authority.sourceCaptureHash = input.draft.sourceCaptureHash;
}

function addUnselectedCaptureSku(input: ReturnType<typeof buildInput>, key: string) {
  const sku = structuredClone(input.capture.skus[0]!);
  sku.key = key;
  sku.sourceSkuId = `source-extra-${input.capture.skus.length}`;
  sku.ordinal = input.capture.skus.length;
  sku.fieldEvidence.sourceSkuId.value = sku.sourceSkuId;
  input.capture.skus.push(sku);
  const skuCount = input.capture.counts.find((count) => count.fieldPath === '/skus')!;
  skuCount.totalCount = input.capture.skus.length;
  skuCount.capturedCount = input.capture.skus.length;
  skuCount.submittedCount = input.capture.skus.length;
  rebindCaptureAuthority(input);
}

describe('Ozon listing payload compiler', () => {
  it('compiles distinct SKU packages from the reviewed leaf and exact validation map', () => {
    const input = buildInput();
    const packages = { 'sku-0': { weightG: 100, lengthMm: 40, widthMm: 30, heightMm: 20 },
      'sku-1': { weightG: 900, lengthMm: 400, widthMm: 300, heightMm: 200 } };
    input.draft.attributes.values.packaging = { value: null, source: 'MANUAL', reviewed: true, evidence: ['owner:measured'],
      skuValues: Object.fromEntries(Object.entries(packages).map(([key, value]) => [key, { value, source: 'MANUAL', reviewed: true, evidence: ['owner:measured'] }])) };
    const operational = input.validationReport.operationalFacts as Record<string, unknown>;
    operational.packageWeightG = null;
    operational.packageDimensionsMm = { lengthMm: null, widthMm: null, heightMm: null };
    operational.skuPackaging = { contractVersion: 'source-listing-sku-packaging/v1', items: structuredClone(packages) };
    input.draft.validation.report = structuredClone(input.validationReport);
    const compiled = compileOzonListingPayload(input);
    expect(compiled.payload.items.map(({ weight, depth, width, height }) => ({ weight, depth, width, height })))
      .toEqual([{ weight: 100, depth: 40, width: 30, height: 20 }, { weight: 900, depth: 400, width: 300, height: 200 }]);
    for (const mutate of [
      (value: typeof input) => { (value.validationReport.operationalFacts as { skuPackaging: { items: Record<string, typeof packages['sku-0']> } }).skuPackaging.items['sku-0']!.weightG = 101; },
      (value: typeof input) => { delete (value.validationReport.operationalFacts as { skuPackaging: { items: Record<string, typeof packages['sku-0']> } }).skuPackaging.items['sku-0']; },
      (value: typeof input) => { (value.validationReport.operationalFacts as { skuPackaging: { items: Record<string, typeof packages['sku-0']> } }).skuPackaging.items.foreign = packages['sku-0']; },
      (value: typeof input) => { value.draft.attributes.values.packaging!.skuValues!['sku-0']!.reviewed = false; },
    ]) {
      const hostile = structuredClone(input);
      mutate(hostile);
      hostile.draft.validation.report = structuredClone(hostile.validationReport);
      expectCompileCode(hostile, 'OZON_LISTING_COMPILE_PACKAGE_INVALID');
    }
  });
  it('compiles one immutable v3 import item per canonical SKU without deriving commercial facts', () => {
    const result = compileOzonListingPayload(buildInput());

    expect(result.compilerVersion).toBe(OZON_LISTING_PAYLOAD_COMPILER_VERSION);
    expect(result.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.authority).toMatchObject({
      draft: { id: 'draft-1', version: 7, revision: 9 },
      catalog: { revision: 'catalog-42', descriptionCategoryId: 17028922, typeId: 9163 },
      schema: { revision: 'schema-revision-1' },
    });
    expect(result.payload.items).toHaveLength(2);
    expect(result.payload.items[0]).toMatchObject({
      offer_id: 'reviewed-offer-0', name: 'Тестовый товар',
      description: 'Проверенное описание', price: '1999.00', old_price: '2399.00',
      currency_code: 'RUB', vat: '0.2', weight: 500,
      depth: 300, width: 200, height: 40, dimension_unit: 'mm', weight_unit: 'g',
      images: ['https://cdn.example.com/product.jpg', 'https://cdn.example.com/sku-0.jpg'],
    });
    expect(result.offerTrace).toEqual([
      { ordinal: 0, skuKey: 'sku-0', offerId: 'reviewed-offer-0', source: 'USER' },
      expect.objectContaining({ ordinal: 1, skuKey: 'sku-1', source: 'DETERMINISTIC' }),
    ]);
    expect(result.offerTrace.map((trace) => result.payload.items[trace.ordinal]?.offer_id))
      .toEqual(result.offerTrace.map((trace) => trace.offerId));
    expect(new Set(result.offerTrace.map((trace) => trace.offerId)).size).toBe(2);
  });

  it('applies product attributes to every item and SKU attributes only to their matching item', () => {
    const { payload } = compileOzonListingPayload(buildInput());
    expect(payload.items[0]?.attributes).toEqual([
      { id: 10, values: [{ value: 'Общее значение' }] },
      { id: 11, values: [{ dictionary_value_id: 101, value: 'Красный' }] },
      { id: 20, values: [{ value: 'false' }] },
    ]);
    expect(payload.items[1]?.attributes).toEqual([
      { id: 10, values: [{ value: 'Общее значение' }] },
      { id: 11, values: [{ dictionary_value_id: 101, value: 'Красный' }] },
      { id: 20, values: [{ value: '42' }] },
    ]);
  });

  it('produces stable item order, offer IDs and hash for reordered set-like inputs', () => {
    const left = buildInput();
    const right = buildInput();
    right.draft.selectedSkuKeys.reverse();
    (right.draft.pricing.value as OzonListingPricingV1).items.reverse();
    right.validationReport.normalizedAttributes.reverse();
    right.draft.validation.report = structuredClone(right.validationReport);
    right.resolvedImages.bySku = {
      'sku-1': right.resolvedImages.bySku['sku-1']!,
      'sku-0': right.resolvedImages.bySku['sku-0']!,
    };

    const first = compileOzonListingPayload(left);
    const second = compileOzonListingPayload(right);
    expect(second.payload).toEqual(first.payload);
    expect(second.offerTrace).toEqual(first.offerTrace);
    expect(second.canonicalHash).toBe(first.canonicalHash);
    expect(second.canonicalHash).toBe(
      createHash('sha256').update(canonicalStringify(second.payload)).digest('hex'),
    );
  });

  it('generates stable unique 50-character offer IDs with 180 bits of digest entropy', () => {
    const firstInput = buildInput();
    const firstPricing = (firstInput.draft.pricing.value as OzonListingPricingV1).items;
    for (const item of firstPricing) delete item.offerId;
    const secondInput = structuredClone(firstInput);

    const first = compileOzonListingPayload(firstInput);
    const second = compileOzonListingPayload(secondInput);
    const firstOfferIds = first.offerTrace.map((trace) => trace.offerId);

    expect(OZON_LISTING_OFFER_ID_MAX_LENGTH).toBe(50);
    expect(first.offerTrace.every((trace) => trace.source === 'DETERMINISTIC')).toBe(true);
    expect(firstOfferIds.every((offerId) => /^ssv2-[a-f0-9]{45}$/.test(offerId))).toBe(true);
    expect(new Set(firstOfferIds).size).toBe(firstOfferIds.length);
    expect(second.offerTrace.map((trace) => trace.offerId)).toEqual(firstOfferIds);
  });

  it('compiles independently reviewed title and description fields from separate candidates', () => {
    const input = buildInput();
    const titleCandidate = {
      ...input.draft.copy.candidates[0]!,
      id: 'copy-title-2',
      fields: ['title'] as Array<'title' | 'description'>,
      titleRu: 'Обновленный тестовый товар',
      descriptionRu: null,
      createdAt: '2026-07-15T08:03:00.000Z',
    };
    input.draft.copy.candidates.push(titleCandidate);
    input.draft.copy.applyAudit.push({
      id: 'apply-title-2', candidateId: titleCandidate.id, actorUserId: 'owner-1',
      operationKey: 'review-title-2', draftVersion: 7,
      previousTitleRu: input.draft.copy.publishTitleRu,
      previousDescriptionRu: input.draft.copy.publishDescriptionRu,
      appliedAt: '2026-07-15T08:04:00.000Z',
    });
    input.draft.copy.publishTitleRu = titleCandidate.titleRu;

    const result = compileOzonListingPayload(input);
    expect(result.payload.items).toHaveLength(2);
    expect(result.payload.items.every((item) => item.name === titleCandidate.titleRu)).toBe(true);
    expect(result.payload.items.every((item) => item.description === 'Проверенное описание')).toBe(true);
  });

  it('rejects non-intent, stale, invalid, or mismatched validation authority', () => {
    const wrongStage = buildInput();
    wrongStage.draft.stage = 'READY_TO_PUBLISH';
    expectCompileCode(wrongStage, 'OZON_LISTING_COMPILE_STAGE_INVALID');

    const blocked = buildInput();
    blocked.validationReport.operationReadiness.ozonImport.status = 'BLOCKED';
    blocked.draft.validation.report = structuredClone(blocked.validationReport);
    expectCompileCode(blocked, 'OZON_LISTING_COMPILE_VALIDATION_INVALID');

    const mismatched = buildInput();
    mismatched.validationReport.schemaRevision = 'other-revision';
    expectCompileCode(mismatched, 'OZON_LISTING_COMPILE_VALIDATION_STALE');
  });

  it('validates the exact Capture V2 schema even when a malformed capture hash is rebound', () => {
    const input = buildInput();
    input.capture.collector.name = '';
    input.draft.sourceCaptureHash = hashCapture(input.capture);
    input.draft.copy.candidates[0]!.sourceCaptureHash = input.draft.sourceCaptureHash;
    input.resolvedImages.authority.sourceCaptureHash = input.draft.sourceCaptureHash;
    expectCompileCode(input, 'OZON_LISTING_COMPILE_SOURCE_INVALID');
  });

  it('rejects unreviewed or non-Russian publish titles', () => {
    const unreviewed = buildInput();
    unreviewed.draft.copy.applyAudit = [];
    expectCompileCode(unreviewed, 'OZON_LISTING_COMPILE_TITLE_UNREVIEWED');

    const untranslated = buildInput();
    untranslated.draft.copy.publishTitleRu = 'Chinese product title';
    untranslated.draft.copy.candidates[0]!.titleRu = 'Chinese product title';
    expectCompileCode(untranslated, 'OZON_LISTING_COMPILE_TITLE_INVALID');
  });

  it('requires exact canonical selected SKU and typed pricing coverage', () => {
    const alias = buildInput();
    alias.draft.selectedSkuKeys = ['source-sku-1', 'sku-0'];
    expectCompileCode(alias, 'OZON_LISTING_COMPILE_SKU_INVALID');

    const missingPrice = buildInput();
    (missingPrice.draft.pricing.value as OzonListingPricingV1).items.pop();
    expectCompileCode(missingPrice, 'OZON_LISTING_COMPILE_PRICING_INVALID');

    const invalidDecimal = buildInput();
    (invalidDecimal.draft.pricing.value as OzonListingPricingV1).items[0]!.price = '0';
    expectCompileCode(invalidDecimal, 'OZON_LISTING_COMPILE_PRICING_INVALID');

    const oldPriceBelowPrice = buildInput();
    (oldPriceBelowPrice.draft.pricing.value as OzonListingPricingV1).items[0]!.oldPrice = '1';
    expectCompileCode(oldPriceBelowPrice, 'OZON_LISTING_COMPILE_PRICING_INVALID');

    const unsupportedVat = buildInput();
    (unsupportedVat.draft.pricing.value as OzonListingPricingV1).items[0]!.vat = '0.20' as '0';
    expectCompileCode(unsupportedVat, 'OZON_LISTING_COMPILE_PRICING_INVALID');

    const missingOldPrice = buildInput();
    const incompletePrice = (
      (missingOldPrice.draft.pricing.value as OzonListingPricingV1).items[0]
    ) as unknown as Record<string, unknown>;
    delete incompletePrice.oldPrice;
    expectCompileCode(missingOldPrice, 'OZON_LISTING_COMPILE_PRICING_INVALID');

    const unsupportedCurrency = buildInput();
    const unsupportedCurrencyItems = (
      unsupportedCurrency.draft.pricing.value as unknown as {
        items: Array<{ currencyCode: string }>;
      }
    ).items;
    unsupportedCurrencyItems[0]!.currencyCode = 'USD';
    expectCompileCode(unsupportedCurrency, 'OZON_LISTING_COMPILE_PRICING_INVALID');

    const mixedCurrency = buildInput();
    (mixedCurrency.draft.pricing.value as OzonListingPricingV1).items[0]!.currencyCode = 'CNY';
    expectCompileCode(mixedCurrency, 'OZON_LISTING_COMPILE_PRICING_INVALID');

    const tooMany = buildInput();
    tooMany.draft.selectedSkuKeys = Array.from({ length: 101 }, (_, index) => `sku-${index}`);
    expectCompileCode(tooMany, 'OZON_LISTING_COMPILE_SKU_INVALID');
  });

  it('maps injective NFKC capture SKU keys to the canonical draft identity', () => {
    const input = buildInput();
    input.capture.skus[0]!.key = '\uff53\uff4b\uff55\uff0d\uff10';
    input.capture.skus[1]!.key = '\uff53\uff4b\uff55\uff0d\uff11';
    input.capture.facts.selectedSkuKey = input.capture.skus[0]!.key;
    input.capture.fieldEvidence.selectedSkuKey.value = input.capture.skus[0]!.key;
    rebindCaptureAuthority(input);

    const result = compileOzonListingPayload(input);

    expect(result.offerTrace.map(({ skuKey }) => skuKey)).toEqual(['sku-0', 'sku-1']);
    expect(input.capture.skus.map(({ key }) => key)).toEqual([
      '\uff53\uff4b\uff55\uff0d\uff10',
      '\uff53\uff4b\uff55\uff0d\uff11',
    ]);
  });

  it('rejects capture SKU keys that collide after NFKC normalization', () => {
    const input = buildInput();
    addUnselectedCaptureSku(input, '\uff53\uff4b\uff55\uff0d\uff10');

    expectCompileCode(input, 'OZON_LISTING_COMPILE_SKU_INVALID');
  });

  it('rejects a noncanonical capture SKU alias for the product-only sentinel', () => {
    const input = buildInput();
    const reservedAlias = Array.from(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY, (character) => {
      if (character === '_') return '\uff3f';
      return String.fromCodePoint(character.codePointAt(0)! + 0xfee0);
    }).join('');
    expect(reservedAlias.normalize('NFKC')).toBe(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY);
    addUnselectedCaptureSku(input, reservedAlias);

    expectCompileCode(input, 'OZON_LISTING_COMPILE_SKU_INVALID');
  });

  it('rejects a capture SKU key that exceeds the limit only after NFKC expansion', () => {
    const input = buildInput();
    const expandingKey = '\ufb03'.repeat(167);
    expect(Array.from(expandingKey)).toHaveLength(167);
    expect(Array.from(expandingKey.normalize('NFKC'))).toHaveLength(501);
    addUnselectedCaptureSku(input, expandingKey);

    expectCompileCode(input, 'OZON_LISTING_COMPILE_SKU_INVALID');
  });

  it('passes one explicit CNY pricing currency through unchanged', () => {
    const input = buildInput();
    for (const item of (input.draft.pricing.value as OzonListingPricingV1).items) {
      item.currencyCode = 'CNY';
    }
    const result = compileOzonListingPayload(input);
    expect(result.payload.items.every((item) => item.currency_code === 'CNY')).toBe(true);
  });

  it('allows the product-only sentinel only when the exact capture has zero SKU rows', () => {
    const invalid = buildInput();
    invalid.draft.selectedSkuKeys = [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY];
    expectCompileCode(invalid, 'OZON_LISTING_COMPILE_SKU_INVALID');

    const input = buildInput();
    input.capture.skus = [];
    input.capture.facts.selectedSkuKey = null;
    input.capture.fieldEvidence.selectedSkuKey.value = null;
    input.capture.fieldEvidence.selectedSkuKey.missingReason = 'not_applicable';
    input.capture.prices[0]!.skuKey = null;
    input.capture.prices[0]!.fieldEvidence.skuKey.value = null;
    input.capture.prices[0]!.fieldEvidence.skuKey.missingReason = 'not_applicable';
    const skuCount = input.capture.counts.find((count) => count.fieldPath === '/skus')!;
    skuCount.totalCount = 0;
    skuCount.capturedCount = 0;
    skuCount.submittedCount = 0;
    input.draft.sourceCaptureHash = hashCapture(input.capture);
    input.draft.selectedSkuKeys = [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY];
    input.draft.copy.candidates[0]!.sourceCaptureHash = input.draft.sourceCaptureHash;
    input.draft.pricing.value = {
      contractVersion: 'ozon-listing-pricing/v1',
      items: [{
        skuKey: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
        price: '1999', oldPrice: '2399', currencyCode: 'RUB', vat: '0',
      }],
    };
    input.validationReport.normalizedAttributes = input.validationReport.normalizedAttributes
      .filter((attribute) => attribute.skuKey == null);
    input.draft.validation.report = structuredClone(input.validationReport);
    input.draft.media.assignments = [input.draft.media.assignments[0]!];
    input.resolvedImages.authority.sourceCaptureHash = input.draft.sourceCaptureHash;
    input.resolvedImages.product = [input.resolvedImages.product[0]!];
    input.resolvedImages.bySku = {};

    const result = compileOzonListingPayload(input);
    expect(result.offerTrace[0]?.skuKey).toBe(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY);
    expect(result.payload.items).toHaveLength(1);
  });

  it('rejects invented package facts, unbound/non-https images, and unsupported attributes', () => {
    const inventedPackage = buildInput();
    const operational = inventedPackage.validationReport.operationalFacts as Record<string, unknown>;
    operational.packageWeightG = 501;
    inventedPackage.draft.validation.report = structuredClone(inventedPackage.validationReport);
    expectCompileCode(inventedPackage, 'OZON_LISTING_COMPILE_PACKAGE_INVALID');

    const insecureImage = buildInput();
    insecureImage.resolvedImages.product[0]!.url = 'http://cdn.example.com/product.jpg';
    expectCompileCode(insecureImage, 'OZON_LISTING_COMPILE_IMAGES_INVALID');

    const unresolvedAssignment = buildInput();
    unresolvedAssignment.draft.media.assignments.push({
      scope: 'PRODUCT', slotKey: 'detail', assetId: 'asset-unresolved', source: 'REVIEWED',
    });
    expectCompileCode(unresolvedAssignment, 'OZON_LISTING_COMPILE_IMAGES_INVALID');

    const staleSkuScope = buildInput();
    staleSkuScope.draft.media.assignments[1] = {
      scope: 'SKU', skuKey: 'sku-cancelled', slotKey: 'hero',
      assetId: 'asset-sku-1', source: 'REVIEWED',
    };
    expectCompileCode(staleSkuScope, 'OZON_LISTING_COMPILE_IMAGES_INVALID');

    const ambiguousProduct = buildInput();
    ambiguousProduct.draft.media.assignments[0] = {
      scope: 'PRODUCT', skuKey: 'sku-0', slotKey: 'main',
      assetId: 'asset-product', source: 'REVIEWED',
    } as unknown as OzonListingDraftMediaAssignment;
    expectCompileCode(ambiguousProduct, 'OZON_LISTING_COMPILE_IMAGES_INVALID');

    const complexAttribute = buildInput();
    complexAttribute.validationReport.normalizedAttributes[0]!.values[0]!.value = { nested: true };
    complexAttribute.draft.validation.report = structuredClone(complexAttribute.validationReport);
    expectCompileCode(complexAttribute, 'OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED');

    const dictionaryZero = buildInput();
    dictionaryZero.validationReport.normalizedAttributes[1]!.values[0]!.dictionaryValueId = 0;
    dictionaryZero.draft.validation.report = structuredClone(dictionaryZero.validationReport);
    expectCompileCode(dictionaryZero, 'OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED');
  });

  it('rejects duplicate explicit offer IDs instead of mutating them', () => {
    const input = buildInput();
    const items = (input.draft.pricing.value as OzonListingPricingV1).items;
    items[0]!.offerId = 'duplicate-offer';
    items[1]!.offerId = 'duplicate-offer';
    expectCompileCode(input, 'OZON_LISTING_COMPILE_OFFER_ID_INVALID');
  });

  it('rejects an explicit offer ID above the Ozon 50-character limit', () => {
    const input = buildInput();
    const items = (input.draft.pricing.value as OzonListingPricingV1).items;
    items[0]!.offerId = 'a'.repeat(51);
    expectCompileCode(input, 'OZON_LISTING_COMPILE_OFFER_ID_INVALID');
  });

  it('preserves an explicit offer ID at the Ozon 50-character limit', () => {
    const input = buildInput();
    const items = (input.draft.pricing.value as OzonListingPricingV1).items;
    const offerId = 'a'.repeat(50);
    items[0]!.offerId = offerId;

    const result = compileOzonListingPayload(input);
    expect(result.offerTrace).toContainEqual(expect.objectContaining({
      offerId,
      source: 'USER',
    }));
    expect(result.payload.items).toContainEqual(expect.objectContaining({ offer_id: offerId }));
  });
});
