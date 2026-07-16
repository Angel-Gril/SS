import { describe, expect, it } from 'vitest';

import {
  OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
  compareOzonPublisherEntrypointParity,
  type OzonPublisherEntrypointParityInput,
} from '../services/ozon-publisher-entrypoint-parity.js';

function item(offerId = 'secret-offer-001') {
  return {
    offer_id: offerId,
    description_category_id: 17_028_922,
    type_id: 12_345,
    name: 'Russian product title that must never enter diagnostics',
    description: 'Private product description that must never enter diagnostics',
    price: '1000.00',
    old_price: '1200.00',
    currency_code: 'RUB',
    vat: '0',
    dimension_unit: 'mm',
    weight_unit: 'g',
    weight: 500,
    height: 100,
    depth: 200,
    width: 300,
    images: [
      'https://private-cdn.example.test/secret-first.jpg?token=first-secret',
      'https://private-cdn.example.test/secret-second.jpg?token=second-secret',
    ],
    attributes: [
      { id: 20, complex_id: 0, values: [{ value: 'Wool' }, { value: 'Cotton' }] },
      { id: 10, complex_id: 0, values: [{ value: 'Red', dictionary_value_id: 101 }] },
    ],
  };
}

function compiledInput(
  legacyPayload: unknown,
  v2Payload: unknown,
): OzonPublisherEntrypointParityInput {
  return {
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: {
      endpoint: 'https://api-seller.ozon.ru/v3/product/import?token=must-not-leak',
      payload: legacyPayload,
    },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: v2Payload,
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  };
}

describe('Ozon publisher entry-point parity comparator', () => {
  it('canonicalizes request wrappers and item order while treating attributes as sets', () => {
    const first = item('offer-a');
    const second = item('offer-b');
    const legacy = [first, second];
    const v2First = structuredClone(first);
    const v2Second = structuredClone(second);
    v2First.attributes.reverse();
    v2First.attributes[1]!.values.reverse();
    v2Second.attributes.reverse();

    const input = compiledInput(legacy, { body: { items: [v2Second, v2First] } });
    const before = structuredClone(input);
    const result = compareOzonPublisherEntrypointParity(input);

    expect(result).toMatchObject({
      contractVersion: OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
      entrypoint: 'COLLECT_PUBLISH_OZON',
      status: 'MATCH',
      classification: 'MATCH',
      switchEligible: true,
      legacy: { endpointKind: 'OZON_V3_PRODUCT_IMPORT', itemCount: 2 },
      v2: { kind: 'COMPILED', endpointKind: 'OZON_V3_PRODUCT_IMPORT', itemCount: 2 },
      differences: { total: 0, returned: 0, truncated: false, rows: [] },
    });
    expect(result.legacy.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.v2.payloadHash).toBe(result.legacy.payloadHash);
    expect(input).toEqual(before);
  });

  it('preserves the direct listing import-by-SKU entrypoint', () => {
    const product = item();
    const result = compareOzonPublisherEntrypointParity({
      entrypoint: 'LISTING_IMPORT_BY_SKU',
      legacy: { endpoint: '/v1/product/import-by-sku', payload: { items: [product] } },
      v2: {
        kind: 'COMPILED',
        endpoint: '/v3/product/import',
        payload: { items: [structuredClone(product)] },
        compilerVersions: {
          publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
          payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
        },
      },
    });

    expect(result).toMatchObject({
      entrypoint: 'LISTING_IMPORT_BY_SKU',
      legacy: { endpointKind: 'OZON_V1_PRODUCT_IMPORT_BY_SKU' },
      v2: { endpointKind: 'OZON_V3_PRODUCT_IMPORT' },
    });
  });

  it('preserves image order and treats changed hero ordering as a switch-ineligible defect', () => {
    const legacy = item();
    const v2 = structuredClone(legacy);
    v2.images.reverse();

    const result = compareOzonPublisherEntrypointParity(compiledInput([legacy], { items: [v2] }));

    expect(result).toMatchObject({
      status: 'DIFFERENT',
      classification: 'DEFECT',
      switchEligible: false,
      differences: {
        total: 1,
        returned: 1,
        truncated: false,
        rows: [{
          path: '/items/0/images',
          kind: 'ORDER_MISMATCH',
          classification: 'DEFECT',
          presence: 'BOTH',
          type: { legacy: 'array', v2: 'array' },
        }],
      },
    });
  });

  it('classifies arbitrary title, price, currency, and image changes as defects', () => {
    const v2 = item();
    v2.name = 'A different non-placeholder title';
    v2.price = '999.00';
    v2.currency_code = 'USD';
    v2.images[0] = 'https://another.example.test/a-different-image.jpg';

    const result = compareOzonPublisherEntrypointParity(compiledInput([item()], { items: [v2] }));

    expect(result).toMatchObject({
      status: 'DIFFERENT',
      classification: 'DEFECT',
      switchEligible: false,
      differences: { total: 4, returned: 4, truncated: false },
    });
    expect(result.differences.rows.map((row) => row.path).sort()).toEqual([
      '/items/0/currency_code',
      '/items/0/images/0',
      '/items/0/name',
      '/items/0/price',
    ]);
    expect(result.differences.rows.every(
      (row) => row.classification === 'DEFECT'
        && row.kind === 'VALUE_MISMATCH',
    )).toBe(true);
  });

  it('classifies fabricated package, stock, and manufacturer placeholder differences as stricter', () => {
    const legacy = {
      ...item(),
      weight: 500,
      height: 100,
      depth: 100,
      width: 100,
      stock: 999,
      attributes: [
        ...item().attributes,
        {
          id: 777,
          complex_id: 0,
          values: [{ value: 'manufacturer-private-placeholder' }],
        },
      ],
    };
    const v2 = item() as Partial<ReturnType<typeof item>>;
    delete v2.weight;
    delete v2.height;
    delete v2.depth;
    delete v2.width;
    const result = compareOzonPublisherEntrypointParity(compiledInput([legacy], { items: [v2] }));
    const serialized = JSON.stringify(result);

    expect(result.status).toBe('DIFFERENT');
    expect(result.classification).toBe('INTENTIONAL_STRICTER');
    expect(result.switchEligible).toBe(false);
    expect(result.differences.total).toBe(6);
    expect(result.differences.rows.every(
      (row) => row.classification === 'INTENTIONAL_STRICTER',
    )).toBe(true);
    expect(result.differences.rows.every((row) => (
      Object.keys(row).sort().join(',') === 'classification,kind,path,presence,type'
    ))).toBe(true);
    expect(serialized).not.toContain('secret-offer-001');
    expect(serialized).not.toContain('Russian product title');
    expect(serialized).not.toContain('Private product description');
    expect(serialized).not.toContain('private-cdn');
    expect(serialized).not.toContain('first-secret');
    expect(serialized).not.toContain('manufacturer-private-placeholder');
    expect(serialized).not.toContain('must-not-leak');
  });

  it('recognizes legacy 100/120 CNY pricing as an intentional stricter migration difference', () => {
    const legacy = { ...item(), price: '100', old_price: '120', currency_code: 'CNY' };
    const v2 = { ...item(), price: '780.00', old_price: '936.00', currency_code: 'RUB' };

    const result = compareOzonPublisherEntrypointParity(compiledInput([legacy], { items: [v2] }));

    expect(result).toMatchObject({
      status: 'DIFFERENT',
      classification: 'INTENTIONAL_STRICTER',
      switchEligible: false,
      differences: { total: 3, returned: 3, truncated: false },
    });
    expect(result.differences.rows.every(
      (row) => row.classification === 'INTENTIONAL_STRICTER',
    )).toBe(true);
  });

  it('classifies the known legacy sku representation as a compatibility transform', () => {
    const legacy = { ...item(), sku: 123_456_789 };
    const result = compareOzonPublisherEntrypointParity(compiledInput([legacy], { items: [item()] }));

    expect(result).toMatchObject({
      status: 'DIFFERENT',
      classification: 'COMPATIBILITY_TRANSFORM',
      switchEligible: false,
      differences: {
        total: 1,
        rows: [{
          path: '/items/0/sku',
          kind: 'MISSING_IN_V2',
          classification: 'COMPATIBILITY_TRANSFORM',
          presence: 'LEGACY_ONLY',
          type: { legacy: 'number', v2: 'absent' },
        }],
      },
    });
  });

  it('classifies the known import-by-sku to v3 endpoint change as a compatibility transform', () => {
    const base = compiledInput([item()], { items: [item()] });
    const input: OzonPublisherEntrypointParityInput = {
      ...base,
      legacy: { ...base.legacy, endpoint: '/v1/product/import-by-sku' },
    };

    const result = compareOzonPublisherEntrypointParity(input);

    expect(result).toMatchObject({
      status: 'DIFFERENT',
      classification: 'COMPATIBILITY_TRANSFORM',
      switchEligible: false,
      legacy: { endpointKind: 'OZON_V1_PRODUCT_IMPORT_BY_SKU' },
      v2: { endpointKind: 'OZON_V3_PRODUCT_IMPORT' },
      differences: {
        total: 1,
        rows: [{
          path: '/endpoint',
          kind: 'VALUE_MISMATCH',
          classification: 'COMPATIBILITY_TRANSFORM',
        }],
      },
    });
  });

  it('uses a supplied canonical trace before offer IDs when aligning items', () => {
    const base = compiledInput([item('legacy-offer')], { items: [item('v2-offer')] });
    if (base.v2.kind !== 'COMPILED') throw new Error('test input must be compiled');
    const input: OzonPublisherEntrypointParityInput = {
      ...base,
      legacy: { ...base.legacy, offerTrace: [{ ordinal: 0, skuKey: 'canonical-sku' }] },
      v2: { ...base.v2, offerTrace: [{ ordinal: 0, skuKey: 'canonical-sku' }] },
    };

    const result = compareOzonPublisherEntrypointParity(input);

    expect(result.differences).toMatchObject({
      total: 1,
      rows: [{ path: '/items/0/offer_id', kind: 'VALUE_MISMATCH', classification: 'DEFECT' }],
    });
  });

  it('marks unknown differences as switch-ineligible defects', () => {
    const v2 = item();
    v2.vat = '20';
    const result = compareOzonPublisherEntrypointParity(compiledInput([item()], { items: [v2] }));

    expect(result).toMatchObject({
      status: 'DIFFERENT',
      classification: 'DEFECT',
      switchEligible: false,
      differences: {
        total: 1,
        rows: [{
          path: '/items/0/vat',
          kind: 'VALUE_MISMATCH',
          classification: 'DEFECT',
          presence: 'BOTH',
          type: { legacy: 'string', v2: 'string' },
        }],
      },
    });
  });

  it.each([
    'OZON_LISTING_COMPILE_TITLE_INVALID',
    'OZON_LISTING_COMPILE_PRICING_INVALID',
    'OZON_LISTING_COMPILE_IMAGES_INVALID',
    'OZON_LISTING_COMPILE_PACKAGE_INVALID',
  ] as const)('reports typed strict blocker %s without pretending payload parity', (blockerCode) => {
    const result = compareOzonPublisherEntrypointParity({
      entrypoint: 'LISTING_BATCH',
      legacy: { endpoint: '/v3/product/import', payload: [item()] },
      v2: {
        kind: 'BLOCKED',
        blockerCode,
        compilerVersions: {
          publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
          payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
        },
      },
    });

    expect(result).toMatchObject({
      status: 'V2_BLOCKED',
      classification: 'INTENTIONAL_STRICTER',
      switchEligible: false,
      legacy: { itemCount: 1 },
      v2: { kind: 'BLOCKED', blockerCode, payloadHash: null, itemCount: null },
      differences: { total: 0, returned: 0, truncated: false, rows: [] },
    });
  });

  it('reports infrastructure failure as not comparable and discards raw error text', () => {
    const result = compareOzonPublisherEntrypointParity({
      entrypoint: 'BROWSER_ONE_CLICK',
      legacy: { endpoint: '/v3/product/import', payload: [item()] },
      v2: {
        kind: 'UNAVAILABLE',
        reasonCode: 'CATALOG_UNAVAILABLE',
        error: new Error('Bearer private-token database.internal.example.test'),
      },
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
      v2: {
        kind: 'UNAVAILABLE',
        reasonCode: 'CATALOG_UNAVAILABLE',
        payloadHash: null,
        itemCount: null,
      },
      differences: { total: 0, returned: 0, truncated: false, rows: [] },
    });
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('database.internal');
    expect(serialized).not.toContain('Bearer');
  });

  it('redacts unrecognized compiler-version text instead of persisting token-shaped input', () => {
    const base = compiledInput([item()], { items: [item()] });
    if (base.v2.kind !== 'COMPILED') throw new Error('test input must be compiled');
    const input: OzonPublisherEntrypointParityInput = {
      ...base,
      v2: {
        ...base.v2,
        compilerVersions: {
          publisherContractVersion: 'ozon-private-token/v1',
          payloadCompilerVersion: 'Bearer-secret-value',
        },
      },
    };

    const result = compareOzonPublisherEntrypointParity(input);
    const serialized = JSON.stringify(result);

    expect(result.v2.compilerVersions).toEqual({
      publisherContractVersion: 'REDACTED',
      payloadCompilerVersion: 'REDACTED',
    });
    expect(result).toMatchObject({
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
    });
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('Bearer-secret');
  });

  it('rejects syntactically valid but unsupported compiler contract versions', () => {
    const base = compiledInput([item()], { items: [item()] });
    if (base.v2.kind !== 'COMPILED') throw new Error('test input must be compiled');

    const result = compareOzonPublisherEntrypointParity({
      ...base,
      v2: {
        ...base.v2,
        compilerVersions: {
          publisherContractVersion: 'ozon-listing-production-compile-adapter/v2',
          payloadCompilerVersion: 'ozon-listing-payload-compiler/v1.1',
        },
      },
    });

    expect(result).toMatchObject({
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
      v2: {
        compilerVersions: {
          publisherContractVersion: 'REDACTED',
          payloadCompilerVersion: 'REDACTED',
        },
      },
    });
  });

  it('never marks unknown endpoints or non-JSON canonical sentinels as a match', () => {
    const base = compiledInput([item()], { items: [item()] });
    if (base.v2.kind !== 'COMPILED') throw new Error('test input must be compiled');
    const unknownEndpoint: OzonPublisherEntrypointParityInput = {
      ...base,
      legacy: { ...base.legacy, endpoint: '/private/custom-import' },
      v2: { ...base.v2, endpoint: '/private/custom-import' },
    };
    expect(compareOzonPublisherEntrypointParity(unknownEndpoint)).toMatchObject({
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
    });

    const legacyWithFunction = { ...item(), privateRuntimeValue: () => 'left-secret' };
    const v2WithFunction = { ...item(), privateRuntimeValue: () => 'right-secret' };
    const unsupported = compareOzonPublisherEntrypointParity(compiledInput(
      [legacyWithFunction],
      { items: [v2WithFunction] },
    ));
    expect(unsupported).toMatchObject({
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
    });
    expect(JSON.stringify(unsupported)).not.toContain('left-secret');
    expect(JSON.stringify(unsupported)).not.toContain('right-secret');

    let leftDeep: unknown = 'left-private-leaf';
    let rightDeep: unknown = 'right-private-leaf';
    for (let depth = 0; depth < 45; depth += 1) {
      leftDeep = { nested: leftDeep };
      rightDeep = { nested: rightDeep };
    }
    const depthLimited = compareOzonPublisherEntrypointParity(compiledInput(
      [{ ...item(), privateDeepValue: leftDeep }],
      { items: [{ ...item(), privateDeepValue: rightDeep }] },
    ));
    expect(depthLimited).toMatchObject({
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
    });
    expect(JSON.stringify(depthLimited)).not.toContain('private-leaf');
  });

  it('fails closed before canonicalizing payloads above the comparison work budget', () => {
    const oversized = {
      ...item(),
      images: new Array(50_001).fill('https://private.example.test/secret-image'),
    };

    const result = compareOzonPublisherEntrypointParity(compiledInput(
      [oversized],
      { items: [oversized] },
    ));
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      status: 'NOT_COMPARABLE',
      classification: 'NOT_COMPARABLE',
      switchEligible: false,
      differences: {
        rows: [{ path: '/payload', kind: 'INVALID_PAYLOAD' }],
      },
    });
    expect(serialized).not.toContain('private.example.test');
    expect(serialized).not.toContain('secret-image');
  });

  it('bounds, sorts, and deterministically redacts more than 100 differences', () => {
    const legacy = item() as ReturnType<typeof item> & Record<string, unknown>;
    for (let index = 149; index >= 0; index -= 1) {
      legacy[`private-field-${String(index).padStart(3, '0')}-secret`] = `private-value-${index}`;
    }
    const input = compiledInput([legacy], { items: [item()] });

    const first = compareOzonPublisherEntrypointParity(input);
    const second = compareOzonPublisherEntrypointParity(input);
    const serialized = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'DIFFERENT',
      classification: 'DEFECT',
      switchEligible: false,
      differences: { total: 150, returned: 100, truncated: true },
    });
    expect(first.differences.rows).toHaveLength(100);
    expect(first.differences.rows[0]!.path).toMatch(/^\/items\/0\/\$field-\d+$/);
    expect(serialized).not.toContain('private-field');
    expect(serialized).not.toContain('private-value');
  });
});
