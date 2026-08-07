import { readFileSync } from 'node:fs';
import type { SourceCaptureEvidence, SourceProductCaptureV2Submission } from 'shared';
import { describe, expect, it } from 'vitest';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from '../services/source-listing-sku-identity.js';
import { buildSourceListingAttributeSourceContext } from '../services/source-listing-workflow-source-context.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

function evidence(value: SourceCaptureEvidence['value'], sourcePath: string): SourceCaptureEvidence {
  return {
    ...structuredClone(fixture.capture.fieldEvidence.title),
    value,
    sourcePath,
    isEstimated: false,
    missingReason: null,
    derivedFrom: [],
  };
}

function productAttribute(name: string, value: string, ordinal = 0) {
  return {
    key: `product-attribute-${ordinal}`,
    ordinal,
    sourceAttributeId: null,
    name,
    value,
    isSaleAttribute: false,
    rowEvidence: evidence(`${name}:${value}`, `/attributes/${ordinal}`),
    fieldEvidence: {
      sourceAttributeId: evidence(null, `/attributes/${ordinal}/sourceAttributeId`),
      name: evidence(name, `/attributes/${ordinal}/name`),
      value: evidence(value, `/attributes/${ordinal}/value`),
      isSaleAttribute: evidence(false, `/attributes/${ordinal}/isSaleAttribute`),
    },
  };
}

function contextFor(capture: SourceProductCaptureV2Submission['capture'], selectedSkuKeys: string[]) {
  return buildSourceListingAttributeSourceContext({
    capture,
    sourceProfile: buildSourceProductProfileFromCapture(capture, {
      itemId: 'goods-1',
      captureHash: 'a'.repeat(64),
    }),
    selectedSkuKeys,
  });
}

describe('source listing attribute production source context', () => {
  it('builds the product-only SKU standard solely from trusted product evidence and keeps stock unknown', () => {
    const capture = structuredClone(fixture.capture);
    capture.skus = [];
    capture.attributes = [productAttribute('颜色', '白色')];
    const immutableCapture = structuredClone(capture);

    const context = contextFor(capture, [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY]);

    expect(context.skuStandards?.[SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY]).toMatchObject({
      sourceStandard: { colors: ['白色'] },
      sourceStandardEvidence: {
        colors: {
          isEstimated: false,
          path: expect.stringContaining('/attributes/0/value'),
        },
      },
    });
    expect(context.operationalFacts?.selectedStock).toEqual({ known: 0, unknown: 1 });
    expect(context.operationalFacts?.evidence.selectedSkuStock).toBe('');
    expect(capture).toEqual(immutableCapture);
  });

  it('keeps SKU-owned standards scoped to each selected row instead of leaking aggregate values', () => {
    const capture = structuredClone(fixture.capture);
    const template = capture.skus[0]!;
    const sku = (key: string, color: string, ordinal: number) => ({
      ...structuredClone(template),
      key,
      ordinal,
      sourceSkuId: `source-${key}`,
      attributes: [{
        name: '颜色',
        value: color,
        fieldEvidence: {
          name: evidence('颜色', `/skus/${ordinal}/attributes/0/name`),
          value: evidence(color, `/skus/${ordinal}/attributes/0/value`),
        },
      }],
      rowEvidence: evidence(key, `/skus/${ordinal}`),
    });
    capture.skus = [sku('sku-red', '红色', 0), sku('sku-blue', '蓝色', 1)];

    const context = contextFor(capture, ['sku-red', 'sku-blue']);

    expect(context.sourceStandard?.colors).toEqual(['红色', '蓝色']);
    expect(context.skuStandards?.['sku-red']?.sourceStandard.colors).toEqual(['红色']);
    expect(context.skuStandards?.['sku-blue']?.sourceStandard.colors).toEqual(['蓝色']);
    expect(context.skuStandards?.['sku-red']?.sourceStandardEvidence?.colors?.path)
      .not.toContain('/skus/1/');
    expect(context.skuStandards?.['sku-blue']?.sourceStandardEvidence?.colors?.path)
      .not.toContain('/skus/0/');
  });

  it('enforces evidence trust in the production context for attributes and inventory', () => {
    const capture = structuredClone(fixture.capture);
    const untrustedColor = productAttribute('颜色', '不可信颜色');
    untrustedColor.fieldEvidence.value.confidence = 0;
    capture.attributes = [untrustedColor];

    const observed = contextFor(capture, ['sku-0']);
    expect(observed.sourceStandard?.colors).toEqual([]);
    expect(observed.operationalFacts?.selectedStock).toEqual({ known: 1, unknown: 0 });

    capture.skus[0]!.kind = 'derived_attribute_matrix';
    const derived = contextFor(capture, ['sku-0']);
    expect(derived.operationalFacts?.selectedStock).toEqual({ known: 0, unknown: 1 });
    expect(derived.operationalFacts?.evidence.selectedSkuStock).toBe('');
  });

  it('matches NFKC-normalized selected keys to full-width captured SKU keys', () => {
    const capture = structuredClone(fixture.capture);
    const sku = capture.skus[0]!;
    sku.key = 'sku:晚霞肤（1.5cm+4cm胸垫）>M（适合34/75ABC）';
    sku.sourceSkuId = '5777037825166';
    sku.stock = 45162;
    const selectedKey = sku.key.normalize('NFKC');

    const context = contextFor(capture, [selectedKey]);

    expect(context.operationalFacts?.selectedStock).toEqual({ known: 1, unknown: 0 });
    expect(context.operationalFacts?.evidence.selectedSkuStock)
      .toContain('window.skuMap.sku-source-0.stock');
    expect(context.skuStandards?.[selectedKey]).toBeDefined();
  });
});
