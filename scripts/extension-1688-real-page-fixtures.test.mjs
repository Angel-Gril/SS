import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FALLBACK_PATH = 'extensions/ss-erp/shared/collectors/1688-dom-fallback.js';
const CORE_PATH = 'extensions/ss-erp/shared/collectors/source-product-core.js';
const CAPTURE_CONTRACT_PATH = 'extensions/ss-erp/shared/contracts/source-product-capture-v2.js';
const FIXTURE_ROOT = 'scripts/fixtures/source-collect/1688-dom';

function fixture(name) {
  return JSON.parse(fs.readFileSync(`${FIXTURE_ROOT}/${name}`, 'utf8'));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function materializeNode(spec = {}, state = { contentDocumentReads: {} }) {
  const queryCache = new Map();
  const queries = spec.queries || {};
  const node = {
    textContent: String(spec.text || ''),
    innerText: String(spec.text || ''),
    className: String(spec.className || ''),
    value: spec.value == null ? '' : String(spec.value),
    fixtureId: String(spec.fixtureId || ''),
    src: String(spec.src || ''),
    currentSrc: String(spec.currentSrc || spec.src || ''),
    style: { ...(spec.style || {}) },
    children: [],
    getAttribute(name) {
      if (name === 'class') return this.className;
      if (name === 'src') return this.src || spec.attrs?.src || null;
      if (name === 'style' && this.style.backgroundImage) {
        return `background-image:${this.style.backgroundImage}`;
      }
      return Object.hasOwn(spec.attrs || {}, name) ? String(spec.attrs[name]) : null;
    },
    hasAttribute(name) {
      return Object.hasOwn(spec.attrs || {}, name);
    },
    querySelectorAll(selector) {
      return resolveQuery(queries, queryCache, selector, state);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  node.classList = {
    contains(name) {
      return node.className.split(/\s+/).includes(name);
    },
  };
  node.children = (spec.children || []).map((child) => materializeNode(child, state));
  if (spec.contentDocument || spec.throwOnContentDocumentAccess) {
    const fixtureId = String(spec.fixtureId || 'anonymous-frame');
    state.contentDocumentReads[fixtureId] = 0;
    const frameDocument = spec.contentDocument
      ? materializeDocument(spec.contentDocument, state)
      : null;
    function readFrameDocument() {
      state.contentDocumentReads[fixtureId] += 1;
      if (spec.throwOnContentDocumentAccess) {
        throw new Error(`cross-origin contentDocument accessed: ${fixtureId}`);
      }
      return frameDocument;
    }
    Object.defineProperty(node, 'contentDocument', { configurable: true, get: readFrameDocument });
    Object.defineProperty(node, 'contentWindow', {
      configurable: true,
      get() {
        const document = readFrameDocument();
        return document ? { document } : null;
      },
    });
  }
  return node;
}

function resolveQuery(queries, cache, selector, state) {
  if (cache.has(selector)) return cache.get(selector);
  const exact = queries[selector];
  if (Array.isArray(exact)) {
    const rows = exact.map((row) => materializeNode(row, state));
    cache.set(selector, rows);
    return rows;
  }
  const rows = [];
  String(selector).split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => {
    if (!Array.isArray(queries[part])) return;
    rows.push(...queries[part].map((row) => materializeNode(row, state)));
  });
  cache.set(selector, rows);
  return rows;
}

function materializeDocument(spec = {}, state = { contentDocumentReads: {} }, input = {}) {
  const cache = new Map();
  const document = {
    title: String(spec.title || ''),
    body: materializeNode(spec.body || { text: spec.bodyText || '' }, state),
    documentElement: { scrollHeight: Number(input.scrollHeight || 0) },
    location: { href: String(spec.locationHref || input.url || '') },
    querySelectorAll(selector) {
      return resolveQuery(spec.queries || {}, cache, selector, state);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  document.__fixtureMetrics = state;
  return document;
}

function createFixtureDocument(input) {
  return materializeDocument(
    input.document || {},
    { contentDocumentReads: {} },
    input,
  );
}

function loadFallback(overrides = {}) {
  if (!fs.existsSync(FALLBACK_PATH)) return null;
  const context = { module: { exports: {} }, URL, ...overrides };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(FALLBACK_PATH, 'utf8'), context, {
    filename: FALLBACK_PATH,
  });
  return context.SS_ERP_1688_DOM_FALLBACK || context.module.exports;
}

function requireFallback(overrides) {
  const api = loadFallback(overrides);
  assert.ok(api, '1688 DOM fallback module must exist and export SS_ERP_1688_DOM_FALLBACK');
  assert.equal(typeof api.collect, 'function', '1688 DOM fallback must export collect(options)');
  assert.equal(typeof api.warmLazyMedia, 'function', '1688 DOM fallback must export warmLazyMedia(options)');
  return api;
}

function loadCore() {
  const context = { module: { exports: {} }, URL };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(CORE_PATH, 'utf8'), context, { filename: CORE_PATH });
  return context.SS_ERP_SOURCE_PRODUCT_CORE || context.module.exports;
}

function loadCaptureContract() {
  const context = { module: { exports: {} }, TextEncoder };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(CAPTURE_CONTRACT_PATH, 'utf8'), context, {
    filename: CAPTURE_CONTRACT_PATH,
  });
  return context.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2 || context.module.exports;
}

async function collectFixture(api, input, overrides = {}) {
  const document = createFixtureDocument(input);
  const location = new URL(input.url);
  return Promise.resolve(api.collect({
    document,
    location,
    url: input.url,
    observedAt: input.observedAt,
    parserVersion: 'ss-erp-1688-dom-v1',
    ...overrides,
  }));
}

async function collectFixtureWithDocument(api, input, overrides = {}) {
  const document = createFixtureDocument(input);
  const location = new URL(input.url);
  const result = await Promise.resolve(api.collect({
    document,
    location,
    url: input.url,
    observedAt: input.observedAt,
    parserVersion: 'ss-erp-1688-dom-v1',
    ...overrides,
  }));
  return { document, result };
}

function extractWithDom(core, input, domFallback, sources = []) {
  return core.extract1688ProductFromSources({
    url: input.url,
    host: new URL(input.url).hostname,
    observedAt: input.observedAt,
    parserVersion: 'ss-erp-1688-dom-v1',
    sources,
    evidenceSources: domFallback.evidenceSources || [],
    domFallback,
    bridgeTruncations: domFallback.truncations || [],
  });
}

test('structured skuModel wins over conflicting industry DOM rows', async () => {
  const input = fixture('industry-ant-table.sanitized.json');
  const fallback = requireFallback();
  const domFallback = await collectFixture(fallback, input);
  const result = extractWithDom(loadCore(), input, domFallback, [input.structuredSource]);

  assert.deepEqual(plain(result.skuItems.map((row) => row.skuId)), ['structured-sku']);
  assert.equal(result.skuItems[0].price, 99);
  assert.equal(result.skuItems[0].stock, 7);
  assert.equal(result.captureV2.skus[0].rowEvidence.sourceType, 'main_world');
  assert.match(result.captureV2.skus[0].rowEvidence.sourcePath, /skuMap/);
  assert.equal(result.captureV2.skus.some((row) => /industry-/.test(row.sourceSkuId || '')), false);
});

test('MAIN-world SKU family wins as a whole even when inline script is listed first', () => {
  const input = fixture('industry-ant-table.sanitized.json');
  const mainWorld = input.structuredSource;
  const inlineScript = {
    offerId: input.structuredSource.offerId,
    skuModel: {
      skuProps: [
        { prop: '颜色', value: [{ id: '9', name: '脚本红色' }] },
        { prop: '尺码', value: [{ id: '10', name: 'S' }] },
      ],
      skuMap: { '9:10': { skuId: 'inline-script-sku', price: '1.00', stock: 999 } },
    },
  };
  const result = loadCore().extract1688ProductFromSources({
    url: input.url,
    observedAt: input.observedAt,
    sources: [inlineScript, mainWorld],
    evidenceSources: [
      {
        id: 'inline-script',
        sourceType: 'script',
        sourcePath: '/pageState/targetedInline/0',
        tier: 20,
        value: inlineScript,
      },
      {
        id: 'main-world',
        sourceType: 'main_world',
        sourcePath: '/pageState/knownGlobals',
        tier: 10,
        value: mainWorld,
      },
    ],
  });

  assert.deepEqual(plain(result.skuItems.map((row) => row.skuId)), ['structured-sku']);
  assert.equal(result.captureV2.skus[0].rowEvidence.sourceType, 'main_world');
  assert.match(result.captureV2.skus[0].rowEvidence.sourcePath, /^\/pageState\/knownGlobals/);
});

test('same-tier duplicate SKU conflicts become explicit incomplete data instead of first-wins', () => {
  const input = fixture('industry-ant-table.sanitized.json');
  const mainWorld = {
    offerId: input.structuredSource.offerId,
    skuModel: {
      skuProps: [
        { prop: '颜色', value: [{ id: '1', name: '黑色' }] },
        { prop: '尺码', value: [{ id: '2', name: 'M' }] },
      ],
      skuList: [
        { skuId: 'duplicate-sku', attrs: { '颜色': '黑色', '尺码': 'M' }, price: 10, stock: 2 },
        { skuId: 'duplicate-sku', attrs: { '颜色': '黑色', '尺码': 'M' }, price: 11, stock: 2 },
      ],
    },
  };
  const result = loadCore().extract1688ProductFromSources({
    url: input.url,
    observedAt: input.observedAt,
    sources: [mainWorld],
    evidenceSources: [{
      id: 'main-world',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals',
      tier: 10,
      value: mainWorld,
    }],
    domFallback: {
      skuFamilies: [{
        familyId: 'lower-dom',
        tier: 30,
        structurallyComplete: true,
        rows: [{
          skuId: 'must-not-fallback',
          specText: '红色 / L',
          attrs: { '颜色': '红色', '尺码': 'L' },
          price: 1,
          stock: 1,
          source: 'dom_industry_table',
          evidence: { sourceType: 'dom', sourcePath: '/dom/lower' },
        }],
      }],
    },
  });

  assert.equal(result.captureV2.skus.length, 0);
  assert.equal(result.extractionDiagnostics.skuSelection.status, 'ambiguous');
  assert.equal(result.skuItems.some((row) => row.skuId === 'must-not-fallback'), false);
});

test('negative structured stock remains unknown instead of becoming a positive observation', () => {
  const source = {
    offerId: '810000000097',
    subject: '负库存真值保护测试商品',
    skuMap: {
      '黑色 / M': {
        skuId: 'negative-stock-sku',
        specText: '黑色 / M',
        attrs: { '颜色': '黑色', '尺码': 'M' },
        price: 10,
        stock: '-1',
      },
    },
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000097.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [source],
    evidenceSources: [{
      id: 'main-world',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals/currentOffer',
      tier: 10,
      value: source,
    }],
  });

  assert.equal(result.skuItems[0].stock, null);
  assert.equal(result.captureV2.skus[0].stock, null);
  assert.notEqual(result.captureV2.skus[0].fieldEvidence.stock.missingReason, null);
});

test('structured skuList evidence points to the actual list path instead of a fabricated skuMap', () => {
  const source = {
    offerId: '810000000090',
    subject: 'skuList evidence path test product',
    skuList: [{
      skuId: 'list-sku-1',
      specText: '黑色 / M',
      attrs: { '颜色': '黑色', '尺码': 'M' },
      price: 10,
      stock: 2,
    }],
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000090.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [],
    evidenceSources: [{
      id: 'inline',
      sourceType: 'script',
      sourcePath: '/document/inlineScripts/7',
      tier: 20,
      value: source,
    }],
  });
  const evidence = result.captureV2.skus[0].rowEvidence;

  assert.match(evidence.sourcePath, /\/skuList(?:\/|$)/);
  assert.doesNotMatch(evidence.sourcePath, /\/skuMap(?:\/|$)/);
});

test('empty skuList cannot claim evidence from a contributing skuMap', () => {
  const source = {
    offerId: '810000000091',
    subject: 'empty skuList evidence path test product',
    skuList: [],
    skuMap: {
      '黑色 / M': {
        skuId: 'map-sku-1',
        specText: '黑色 / M',
        attrs: { '颜色': '黑色', '尺码': 'M' },
        price: 10,
        stock: 2,
      },
    },
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000091.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [],
    evidenceSources: [{
      id: 'inline',
      sourceType: 'script',
      sourcePath: '/document/inlineScripts/8',
      tier: 20,
      value: source,
    }],
  });
  const evidence = result.captureV2.skus[0].rowEvidence;

  assert.match(evidence.sourcePath, /\/skuMap(?:\/|$)/);
  assert.doesNotMatch(evidence.sourcePath, /\/skuList(?:\/|$)/);
});

test('multiple contributing SKU collections use their truthful common source root', () => {
  const source = {
    offerId: '810000000092',
    subject: 'multiple SKU collections evidence path test product',
    skuModel: {
      skuList: [{
        skuId: 'list-sku-2',
        specText: '黑色 / M',
        attrs: { '颜色': '黑色', '尺码': 'M' },
        price: 10,
        stock: 2,
      }],
      skuMap: {
        '白色 / L': {
          skuId: 'map-sku-2',
          specText: '白色 / L',
          attrs: { '颜色': '白色', '尺码': 'L' },
          price: 11,
          stock: 3,
        },
      },
    },
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000092.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [],
    evidenceSources: [{
      id: 'main-world',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals/currentOffer',
      tier: 10,
      value: source,
    }],
  });
  const evidencePaths = [...new Set(result.captureV2.skus.map((row) => row.rowEvidence.sourcePath))];

  assert.deepEqual(evidencePaths, ['/pageState/knownGlobals/currentOffer/skuModel']);
});

test('industry table retains sold-out zero and keeps absent stock unknown with DOM evidence', async () => {
  const input = fixture('industry-ant-table.sanitized.json');
  const fallback = requireFallback();
  const first = await collectFixture(fallback, input);
  const second = await collectFixture(fallback, input);

  assert.deepEqual(plain(first.skus), plain(second.skus), 'DOM SKU identities must not depend on time');
  assert.deepEqual(plain(first.skus.map((row) => row.sourceSkuId)), [
    'industry-red-m',
    'industry-blue-l',
  ]);
  assert.deepEqual(plain(first.skus[0].attrs), { '规格1': '红色', '规格2': 'M' });
  assert.equal(first.skus[0].price, 18.8);
  assert.equal(first.skus[0].stock, 0);
  assert.equal(first.skus[1].stock, null);
  assert.equal(first.skus[0].images[0], 'https://cbu01.alicdn.com/img/ibank/industry-red.jpg');
  assert.equal(first.skus[0].evidence.sourceType, 'dom');
  assert.equal(first.skus[0].evidence.sourcePath, '/dom/industry/rows/industry-red-m');

  const result = extractWithDom(loadCore(), input, first);
  const rows = Object.fromEntries(result.captureV2.skus.map((row) => [row.sourceSkuId, row]));
  assert.equal(result.priceCny, 18.8);
  assert.equal(result.priceSourceType, 'dom_sku');
  assert.equal(result.priceConfidence, 'medium');
  assert.equal(result.captureV2.prices[0].fieldEvidence.amountCny.sourceType, 'dom');
  assert.match(result.captureV2.prices[0].fieldEvidence.amountCny.sourcePath, /^\/dom\/industry/);
  assert.equal(rows['industry-red-m'].stock, 0);
  assert.equal(rows['industry-red-m'].fieldEvidence.stock.value, 0);
  assert.equal(rows['industry-red-m'].fieldEvidence.stock.sourceType, 'dom');
  assert.equal(rows['industry-blue-l'].stock, null);
  assert.notEqual(rows['industry-blue-l'].fieldEvidence.stock.missingReason, null);
});

test('DOM packaging rows keep DOM provenance when compiled into Capture V2', async () => {
  const input = fixture('industry-ant-table.sanitized.json');
  const fallback = requireFallback();
  const domFallback = await collectFixture(fallback, input);
  domFallback.packagingRows = [{
    color: '红色',
    size: 'M',
    weightG: 320,
    evidence: {
      sourceType: 'dom',
      sourcePath: '/dom/packaging/rows/0',
      confidence: 0.85,
      isEstimated: false,
      observedAt: input.observedAt,
      parserVersion: 'ss-erp-1688-dom-v1',
      derivedFrom: [],
    },
  }];
  const result = extractWithDom(loadCore(), input, domFallback);

  assert.equal(result.captureV2.packaging.length, 1);
  assert.equal(result.captureV2.packaging[0].weightG, 320);
  assert.equal(result.captureV2.packaging[0].rowEvidence.sourceType, 'dom');
  assert.equal(result.captureV2.packaging[0].rowEvidence.sourcePath, '/dom/packaging/rows/0');
  assert.equal(result.captureV2.packaging[0].fieldEvidence.weightG.sourceType, 'dom');
  assert.equal(result.captureV2.fieldEvidence.packageWeightG.sourceType, 'dom');
  assert.equal(result.captureV2.fieldEvidence.packageWeightG.sourcePath, '/dom/packaging/rows/0');
});

test('PC SKU independent dimensions are derived and never claim confirmed stock', async () => {
  const input = fixture('pc-sku-derived.sanitized.json');
  const fallback = requireFallback();
  const domFallback = await collectFixture(fallback, input);
  const result = extractWithDom(loadCore(), input, domFallback);

  assert.equal(result.captureV2.skus.length, 4);
  const combinations = result.captureV2.skus.map((row) => (
    row.attributes.map((attr) => `${attr.name}=${attr.value}`).sort().join('|')
  )).sort();
  assert.deepEqual(plain(combinations), [
    '尺码=L|颜色=白色',
    '尺码=L|颜色=黑色',
    '尺码=M|颜色=白色',
    '尺码=M|颜色=黑色',
  ].sort());
  for (const row of result.captureV2.skus) {
    assert.equal(row.kind, 'derived_attribute_matrix');
    assert.equal(row.stock, null, 'dimension-only UI stock cannot be assigned to a Cartesian SKU');
    assert.equal(row.rowEvidence.sourceType, 'derived');
    assert.equal(row.rowEvidence.isEstimated, true);
    assert.notEqual(row.fieldEvidence.stock.missingReason, null);
  }
  assert.equal(result.captureV2.completeness.hasEstimatedValues, true);
  assert.equal(
    result.captureV2.completeness.sections.find((section) => section.section === 'skus')?.status,
    'partial',
    'derived-only combinations cannot satisfy observed SKU readiness',
  );
});

test('PC SKU Cartesian expansion stops hashing once the configured row budget is full', async () => {
  const input = fixture('pc-sku-derived.sanitized.json');
  input.document.queries['.pc-sku-wrapper'][0].queries['.sku-item-wrapper'] = Array.from(
    { length: 100 },
    (_, index) => ({
      queries: {
        '.sku-item-name': [{ text: `S${index}` }],
        '.discountPrice-price': [{ text: '¥20.00' }],
      },
    }),
  );
  let hashCharacterCount = 0;
  const countingMath = Object.create(Math);
  countingMath.imul = (left, right) => {
    hashCharacterCount += 1;
    return Math.imul(left, right);
  };
  const fallback = requireFallback({ Math: countingMath });
  const result = await collectFixture(fallback, input, { maxSkuRows: 1 });
  const family = result.skuFamilies.find((row) => row.familyId === 'pc_sku_dimensions');

  assert.ok(family);
  assert.equal(family.observedRowCount, 200);
  assert.equal(family.rows.length, 1);
  assert.ok(hashCharacterCount < 100, `row budget was applied after ${hashCharacterCount} hash operations`);
  assert.equal(result.truncations.find((row) => row.fieldPath === '/skus')?.observedCount, 200);
});

test('alternative DOM SKU families do not inflate canonical SKU loss counts', async () => {
  const industry = fixture('industry-ant-table.sanitized.json');
  const pc = fixture('pc-sku-derived.sanitized.json');
  industry.document.queries['.pc-sku-wrapper'] = pc.document.queries['.pc-sku-wrapper'];
  const result = await collectFixture(requireFallback(), industry, { maxSkuRows: 2 });
  const selected = result.skuFamilies.find((row) => row.familyId === 'industry_table');

  assert.ok(selected);
  assert.equal(selected.rows.length, 2);
  assert.equal(result.skus[0].sourceSkuId, 'industry-red-m');
  assert.equal(result.truncations.some((row) => row.fieldPath === '/skus'), false);
  assert.ok(result.truncations.some((row) => row.fieldPath === '/dom/skuFamilies/pc_sku_dimensions/rows'));
});

test('Capture V2 keeps distinct stable keys when long DOM SKU identities share a prefix', () => {
  const longPrefix = 'A'.repeat(600);
  const domFallback = {
    skuFamilies: [{
      familyId: 'long-derived-rows',
      tier: 45,
      structurallyComplete: true,
      rows: ['X', 'Y'].map((suffix) => ({
        skuId: '',
        sku: '',
        name: `${longPrefix}${suffix}`,
        specText: `${longPrefix}${suffix}`,
        price: 10,
        stock: null,
        attrs: { '规格': `${longPrefix}${suffix}` },
        images: [],
        source: 'attributeMatrix',
        evidence: {
          sourceType: 'derived',
          sourcePath: '/derived/test',
          confidence: 0.5,
          isEstimated: true,
          derivedFrom: ['/attributes'],
        },
      })),
    }],
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000099.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [],
    evidenceSources: [],
    domFallback,
  });
  const keys = result.captureV2.skus.map((row) => row.key);

  assert.equal(keys.length, 2);
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys.every((key) => key.length <= 500));
});

test('industry table does not treat an unlabeled order quantity as observed stock', async () => {
  const input = fixture('industry-ant-table.sanitized.json');
  const row = input.document.queries['#skuSelection .ant-table-body tr[data-row-key]'][1];
  row.queries['td.ant-table-cell'].push({ text: '0' });
  const result = await collectFixture(requireFallback(), input);
  const sku = result.skus.find((item) => item.sourceSkuId === 'industry-blue-l');

  assert.ok(sku);
  assert.equal(sku.stock, null);
});

test('industry table preserves every unlabeled SKU dimension without guessing color or size', async () => {
  const input = fixture('industry-ant-table.sanitized.json');
  const row = input.document.queries['#skuSelection .ant-table-body tr[data-row-key]'][0];
  row.queries['td.ant-table-cell'][0].queries['.gyp-pro-table-title'][0].queries.p[0].text = '红色 / M / 两件套';
  const result = await collectFixture(requireFallback(), input);
  const sku = result.skus.find((item) => item.sourceSkuId === 'industry-red-m');

  assert.ok(sku);
  assert.deepEqual(plain(sku.attrs), {
    '规格1': '红色',
    '规格2': 'M',
    '规格3': '两件套',
  });
});

test('script-only title, image, attribute, and price retain script evidence in Capture V2', () => {
  const source = {
    offerId: '810000000098',
    subject: '脚本证据商品标题',
    imageList: ['https://cbu01.alicdn.com/img/ibank/script-evidence-product.jpg'],
    props: [{ name: '材质', value: '不锈钢' }],
    priceRange: '12.00-15.00',
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000098.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [],
    evidenceSources: [{
      id: 'targeted-inline-0',
      sourceType: 'script',
      sourcePath: '/document/inlineScripts/7',
      tier: 20,
      observedAt: '2026-07-14T10:05:00.000Z',
      parserVersion: 'ss-erp-page-bridge-v2',
      value: source,
    }],
  });
  const titleEvidence = result.captureV2.fieldEvidence.title;
  const imageEvidence = result.captureV2.media.find((row) => row.role === 'product_main')?.rowEvidence;
  const attributeEvidence = result.captureV2.attributes.find((row) => row.name === '材质')?.rowEvidence;
  const priceEvidence = result.captureV2.prices.find((row) => row.role === 'displayed_range')?.fieldEvidence.amountCny;

  for (const row of [titleEvidence, imageEvidence, attributeEvidence, priceEvidence]) {
    assert.ok(row);
    assert.equal(row.sourceType, 'script');
    assert.match(row.sourcePath, /^\/document\/inlineScripts\/7/);
    assert.equal(row.parserVersion, 'ss-erp-page-bridge-v2');
  }
});

test('next-table uses row and column coordinates rather than DOM order', async () => {
  const input = fixture('next-table-coordinates.sanitized.json');
  const fallback = requireFallback();
  const domFallback = await collectFixture(fallback, input);

  assert.deepEqual(plain(domFallback.skus.map((row) => row.sourceSkuId)), ['next-row-3', 'next-row-7']);
  assert.deepEqual(plain(domFallback.skus[0].attrs), { '颜色': '蓝色', '尺码': 'L' });
  assert.equal(domFallback.skus[0].price, 13.5);
  assert.equal(domFallback.skus[0].stock, null);
  assert.deepEqual(plain(domFallback.skus[1].attrs), { '颜色': '红色', '尺码': 'M' });
  assert.equal(domFallback.skus[1].price, 12.8);
  assert.equal(domFallback.skus[1].stock, 0);
  assert.equal(domFallback.skus[1].images[0], 'https://cbu01.alicdn.com/img/ibank/next-red.jpg');
  assert.equal(domFallback.skus[1].evidence.sourcePath, '/dom/nextTable/rows/7');
});

test('DOM breadcrumb produces a category candidate with DOM field evidence', async () => {
  const input = fixture('breadcrumb-category.sanitized.json');
  const fallback = requireFallback();
  const domFallback = await collectFixture(fallback, input);

  assert.equal(domFallback.categories.length, 1);
  const candidate = domFallback.categories[0];
  assert.equal(candidate.name, input.expected.name);
  assert.deepEqual(plain(candidate.path), input.expected.path);
  assert.equal(candidate.fieldEvidence.name.sourceType, 'dom');
  assert.equal(candidate.fieldEvidence.name.sourcePath, input.expected.nameSourcePath);
  assert.equal(candidate.fieldEvidence.path.sourceType, 'dom');
  assert.equal(candidate.fieldEvidence.path.sourcePath, input.expected.pathSourcePath);
  assert.equal(candidate.fieldEvidence.name.isEstimated, false);
  assert.equal(candidate.fieldEvidence.path.isEstimated, false);

  const result = extractWithDom(loadCore(), input, domFallback);
  assert.equal(result.captureV2.sourceCategory.name, input.expected.name);
  assert.deepEqual(
    plain(result.captureV2.sourceCategory.path.map((row) => row.name)),
    input.expected.path,
  );
  assert.equal(result.captureV2.sourceCategory.fieldEvidence.name.sourceType, 'dom');
  assert.equal(result.captureV2.sourceCategory.path[0].fieldEvidence.name.sourceType, 'dom');
});

test('breadcrumb caps category paths at 50 and excludes the current product title', async () => {
  const productTitle = '当前商品标题';
  const input = {
    url: 'https://detail.1688.com/offer/810000000096.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    document: {
      title: productTitle,
      queries: {
        '.breadcrumb': [{
          queries: {
            'a,span,li': [
              ...Array.from({ length: 55 }, (_, index) => ({ text: `类目${index + 1}` })),
              { text: productTitle },
            ],
          },
        }],
      },
    },
  };
  const domFallback = await collectFixture(requireFallback(), input);
  const result = extractWithDom(loadCore(), input, domFallback);
  const truncation = domFallback.truncations.find((row) => row.fieldPath === '/sourceCategory/path');

  assert.equal(domFallback.categories[0].path.length, 50);
  assert.equal(domFallback.categories[0].path.includes(productTitle), false);
  assert.ok(truncation);
  assert.equal(truncation.observedCount, 55);
  assert.equal(truncation.retainedCount, 50);
  assert.equal(result.captureV2.sourceCategory.path.length, 50);
});

test('conflicting category IDs never combine fields into a false complete category', () => {
  const mainWorld = { offerId: '810000000095', categoryId: '111' };
  const inline = {
    offerId: '810000000095',
    categoryId: '222',
    categoryName: '错误类目',
    categoryPath: ['错误根类目', '错误类目'],
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000095.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [mainWorld, inline],
    evidenceSources: [
      { id: 'main', sourceType: 'main_world', sourcePath: '/pageState/knownGlobals', tier: 10, value: mainWorld },
      { id: 'inline', sourceType: 'script', sourcePath: '/document/inlineScripts/1', tier: 20, value: inline },
    ],
  });
  const section = result.captureV2.completeness.sections.find((row) => row.section === 'category');

  assert.equal(result.captureV2.sourceCategory.id, '111');
  assert.equal(result.captureV2.sourceCategory.name, null);
  assert.deepEqual(plain(result.captureV2.sourceCategory.path), []);
  assert.notEqual(section.status, 'complete');
});

test('structured category paths above schema maxItems are capped with an explicit truncation', () => {
  const source = {
    offerId: '810000000092',
    categoryId: '111',
    categoryName: '叶子类目',
    categoryPath: Array.from({ length: 55 }, (_, index) => `类目${index + 1}`),
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000092.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [source],
    evidenceSources: [{
      id: 'main',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals/currentOffer',
      tier: 10,
      value: source,
    }],
  });
  const truncation = result.captureV2.truncations.find((row) => row.fieldPath === '/sourceCategory/path');

  assert.equal(result.captureV2.sourceCategory.path.length, 50);
  assert.ok(truncation);
  assert.equal(truncation.observedCount, 55);
  assert.equal(truncation.retainedCount, 50);
});

test('DOM videos and detail-container images survive into Capture V2 with DOM evidence', async () => {
  const input = fixture('dom-media.sanitized.json');
  const fallback = requireFallback();
  const domFallback = await collectFixture(fallback, input);
  const detailRows = domFallback.media.filter((row) => row.kind === 'image' && row.role === 'product_detail');
  const videoRows = domFallback.media.filter((row) => row.kind === 'video' && row.role === 'video');

  assert.deepEqual(plain(detailRows.map((row) => row.url).sort()), input.expected.detailImages.slice().sort());
  assert.deepEqual(plain(videoRows.map((row) => row.url).sort()), input.expected.videos.slice().sort());
  assert.equal(videoRows.length, 2, 'duplicate video elements must collapse to one media row per URL');
  for (const row of [...detailRows, ...videoRows]) {
    assert.equal(row.evidence.sourceType, 'dom');
    assert.match(row.evidence.sourcePath, /^\/dom\/(?:detail|video)/);
  }

  const result = extractWithDom(loadCore(), input, domFallback);
  assert.deepEqual(plain(result.sourceDetailImages.slice().sort()), input.expected.detailImages.slice().sort());
  assert.deepEqual(plain(result.sourceVideos.map((row) => row.url).sort()), input.expected.videos.slice().sort());
  const capturedVideos = result.captureV2.media.filter((row) => row.kind === 'video');
  assert.deepEqual(plain(capturedVideos.map((row) => row.url).sort()), input.expected.videos.slice().sort());
  assert.ok(capturedVideos.every((row) => row.rowEvidence.sourceType === 'dom'));
});

test('silicone product image names are not mistaken for icon assets', async () => {
  const input = fixture('dom-media.sanitized.json');
  const url = 'https://cbu01.alicdn.com/img/ibank/silicone-cup.jpg';
  input.document.queries['.content-detail img'] = [{ src: url }];
  const domFallback = await collectFixture(requireFallback(), input);
  const result = extractWithDom(loadCore(), input, domFallback);

  assert.equal(domFallback.media.some((row) => row.url === url), true);
  assert.equal(result.captureV2.media.some((row) => row.url === url && row.disposition === 'accepted'), true);

  const structured = loadCore().extract1688ProductFromSources({
    url: input.url,
    observedAt: input.observedAt,
    sources: [{ offerId: '810000000006', subject: '硅胶杯商品标题', imageList: [url] }],
  });
  assert.equal(structured.captureV2.media.some((row) => row.url === url && row.disposition === 'accepted'), true);
});

test('targeted inline video evidence compiles as script media', () => {
  const input = fixture('dom-media.sanitized.json');
  const inlineValue = {
    offerId: '810000000006',
    videoUrls: ['https://video.example.com/inline-only.mp4'],
  };
  const result = loadCore().extract1688ProductFromSources({
    url: input.url,
    observedAt: input.observedAt,
    sources: [],
    evidenceSources: [{
      id: 'targeted-inline-0',
      sourceType: 'script',
      sourcePath: '/document/inlineScripts/0',
      tier: 20,
      observedAt: input.observedAt,
      parserVersion: 'ss-erp-page-bridge-v2',
      value: inlineValue,
    }],
  });

  assert.deepEqual(plain(result.sourceVideos), [{ url: 'https://video.example.com/inline-only.mp4' }]);
  const video = result.captureV2.media.find((row) => row.kind === 'video');
  assert.ok(video);
  assert.equal(video.rowEvidence.sourceType, 'script');
  assert.match(video.rowEvidence.sourcePath, /^\/document\/inlineScripts\/0/);
});

test('all DOM fallback capture families satisfy the generated Capture V2 schema', async () => {
  const fallback = requireFallback();
  const core = loadCore();
  const contract = loadCaptureContract();
  for (const fixtureName of [
    'industry-ant-table.sanitized.json',
    'pc-sku-derived.sanitized.json',
    'breadcrumb-category.sanitized.json',
    'dom-media.sanitized.json',
  ]) {
    const input = fixture(fixtureName);
    const domFallback = await collectFixture(fallback, input);
    const sources = input.structuredSource ? [input.structuredSource] : [];
    const capture = extractWithDom(core, input, domFallback, sources).captureV2;
    const validation = contract.validateSourceProductCaptureV2Submission({
      capture,
      captureHash: 'a'.repeat(64),
      payloadBytes: Buffer.byteLength(JSON.stringify(capture), 'utf8'),
    });
    assert.equal(validation.valid, true, `${fixtureName}: ${JSON.stringify(validation.errors)}`);
  }
});

test('same-origin iframe uses its own base URL and cross-origin iframe is never dereferenced', async () => {
  const input = fixture('detail-iframes.sanitized.json');
  const fallback = requireFallback();
  const { document, result } = await collectFixtureWithDocument(fallback, input);
  const frameImages = result.media
    .filter((row) => row.kind === 'image' && row.role === 'product_detail')
    .map((row) => row.url)
    .sort();

  assert.deepEqual(plain(frameImages), input.expected.sameOriginImages.slice().sort());
  assert.equal(
    document.__fixtureMetrics.contentDocumentReads['same-origin-detail'],
    input.expected.sameOriginReads,
  );
  assert.equal(
    document.__fixtureMetrics.contentDocumentReads['cross-origin-detail'],
    input.expected.crossOriginReads,
    'origin must be checked from iframe.src before contentDocument/contentWindow access',
  );
  assert.ok(result.media.every((row) => row.evidence.sourceType === 'dom'));
  assert.ok(result.media.every((row) => row.evidence.sourcePath.startsWith('/dom/detailIframes/same-origin-detail/')));
});

function assertLegalLimitTruncation(row, fieldPath) {
  assert.ok(row, `missing truncation for ${fieldPath}`);
  assert.equal(row.stage, 'content_script');
  assert.equal(row.fieldPath, fieldPath);
  assert.ok(Number.isSafeInteger(row.observedCount) && row.observedCount >= 0);
  assert.ok(Number.isSafeInteger(row.retainedCount) && row.retainedCount >= 0);
  assert.ok(Number.isSafeInteger(row.limit) && row.limit >= 0);
  assert.ok(row.observedCount > row.retainedCount, 'limited evidence must report actual loss');
  assert.ok(row.retainedCount <= row.limit);
  assert.equal(row.unit, 'items');
  assert.ok(['source_limit', 'candidate_limit'].includes(row.reason));
  assert.ok(['same_page_fallback', 'reload_page', 'manual_recapture'].includes(row.recoverability));
  assert.ok(row.fallbackSourcePath === null || String(row.fallbackSourcePath).startsWith('/'));
}

test('media, iframe, and scanned-node limits each produce a legal truncation row', async () => {
  const input = fixture('scan-limits.sanitized.json');
  const fallback = requireFallback();
  const mediaLimited = await collectFixture(fallback, input, {
    maxMediaRows: input.limits.maxMediaRows,
    maxFrames: 100,
    maxNodes: 100,
  });
  const frameLimited = await collectFixture(fallback, input, {
    maxMediaRows: 100,
    maxFrames: input.limits.maxFrames,
    maxNodes: 100,
  });
  const nodeLimited = await collectFixture(fallback, input, {
    maxMediaRows: 100,
    maxFrames: 100,
    maxNodes: input.limits.maxNodes,
  });

  assertLegalLimitTruncation(
    mediaLimited.truncations.find((row) => row.fieldPath === '/media'),
    '/media',
  );
  assertLegalLimitTruncation(
    frameLimited.truncations.find((row) => row.fieldPath === '/dom/detailIframes'),
    '/dom/detailIframes',
  );
  assertLegalLimitTruncation(
    nodeLimited.truncations.find((row) => row.fieldPath === '/dom/nodes'),
    '/dom/nodes',
  );
});

test('Capture V2 counts reflect upstream media truncation instead of claiming completeness', async () => {
  const input = fixture('scan-limits.sanitized.json');
  const domFallback = await collectFixture(requireFallback(), input, {
    maxMediaRows: 1,
    maxFrames: 0,
    maxNodes: 100,
  });
  const result = extractWithDom(loadCore(), input, domFallback);
  const count = result.captureV2.counts.find((row) => row.fieldPath === '/media');
  const truncation = result.captureV2.truncations.find((row) => row.fieldPath === '/media');

  assert.ok(truncation);
  assert.ok(count.totalCount >= truncation.observedCount);
  assert.equal(count.capturedCount, result.captureV2.media.length);
  assert.equal(count.submittedCount, result.captureV2.media.length);
  assert.equal(count.truncated, true);
  assert.equal(count.reason, 'source_limit');
});

test('canonical attribute arrays cap at schema maxItems with an explicit loss ledger', () => {
  const source = {
    offerId: '810000000094',
    subject: '属性上限测试商品',
    productProps: Array.from({ length: 2001 }, (_, index) => ({
      name: `参数${index}`,
      value: `值${index}`,
    })),
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000094.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [source],
    evidenceSources: [{
      id: 'main',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals/currentOffer',
      tier: 10,
      value: source,
    }],
  });
  const count = result.captureV2.counts.find((row) => row.fieldPath === '/attributes');
  const truncation = result.captureV2.truncations.find((row) => row.fieldPath === '/attributes');

  assert.equal(result.captureV2.attributes.length, 2000);
  assert.ok(truncation);
  assert.equal(truncation.observedCount, 2001);
  assert.equal(truncation.retainedCount, 2000);
  assert.equal(count.totalCount, 2001);
  assert.equal(count.capturedCount, 2000);
  assert.equal(count.truncated, true);
});

test('large valid SKU inputs are deterministically budgeted below the 8 MiB submission limit', () => {
  const source = {
    offerId: '810000000093',
    subject: '传输预算测试商品',
    skuList: Array.from({ length: 5000 }, (_, index) => ({
      skuId: `budget-sku-${index}`,
      specText: `规格 ${index}`,
      attrs: { '规格': `规格 ${index}` },
      price: 10 + (index % 10),
      stock: index % 3,
    })),
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000093.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [source],
    evidenceSources: [{
      id: 'main',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals/currentOffer',
      tier: 10,
      value: source,
    }],
  });
  const contract = loadCaptureContract();
  const submission = {
    capture: result.captureV2,
    captureHash: 'a'.repeat(64),
    payloadBytes: contract.sourceProductCapturePayloadBytes(result.captureV2),
  };
  const validation = contract.validateSourceProductCaptureV2Submission(submission);
  const count = result.captureV2.counts.find((row) => row.fieldPath === '/skus');

  assert.ok(submission.payloadBytes <= 8 * 1024 * 1024);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(count.totalCount, 5000);
  assert.equal(count.submittedCount, result.captureV2.skus.length);
  if (count.submittedCount < count.totalCount) {
    assert.equal(count.truncated, true);
    assert.equal(count.reason, 'transport_limit');
    assert.ok(result.captureV2.truncations.some((row) => (
      row.fieldPath === '/skus' && row.reason === 'transport_limit'
    )));
  }
});

test('media-dominant payload budgeting keeps role counts aligned with submitted media', () => {
  const source = {
    offerId: '810000000091',
    subject: '媒体传输预算测试商品',
    imageList: Array.from({ length: 6000 }, (_, index) => (
      `https://cbu01.alicdn.com/img/ibank/budget-product-${String(index).padStart(5, '0')}.jpg`
    )),
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000091.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [source],
    evidenceSources: [{
      id: 'main',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals/currentOffer',
      tier: 10,
      value: source,
    }],
    bridgeTruncations: [{
      stage: 'content_script',
      fieldPath: '/media',
      observedCount: 8000,
      retainedCount: 6000,
      limit: 6000,
      unit: 'items',
      reason: 'source_limit',
      recoverability: 'manual_recapture',
      fallbackSourcePath: null,
    }],
  });
  const contract = loadCaptureContract();
  const submission = {
    capture: result.captureV2,
    captureHash: 'a'.repeat(64),
    payloadBytes: contract.sourceProductCapturePayloadBytes(result.captureV2),
  };
  const validation = contract.validateSourceProductCaptureV2Submission(submission);
  const submittedMain = result.captureV2.media.filter((row) => row.role === 'product_main').length;
  const mainCount = result.captureV2.counts.find((row) => row.fieldPath === '/media/product_main');
  const mediaCount = result.captureV2.counts.find((row) => row.fieldPath === '/media');
  const mediaTransport = result.captureV2.truncations.find((row) => (
    row.stage === 'transport' && row.fieldPath === '/media'
  ));

  assert.ok(submission.payloadBytes <= 8 * 1024 * 1024);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(mainCount.submittedCount, submittedMain);
  assert.equal(mediaCount.totalCount, 8000);
  assert.equal(mediaCount.capturedCount, 6000);
  assert.equal(mediaTransport.observedCount, 6000);
});

test('multi-pass media budgeting preserves the original per-role transport loss ledger', () => {
  const source = {
    offerId: '810000000089',
    subject: '多轮媒体预算账本测试商品',
    imageList: Array.from({ length: 2000 }, (_, index) => (
      `https://cbu01.alicdn.com/img/ibank/main-budget-${index}.jpg`
    )),
    detailImages: Array.from({ length: 2000 }, (_, index) => (
      `https://cbu01.alicdn.com/img/ibank/detail-budget-${index}.jpg`
    )),
    skuList: Array.from({ length: 3500 }, (_, index) => ({
      skuId: `mixed-budget-sku-${index}`,
      attrs: { '规格': `规格 ${index}` },
      price: 10,
      stock: 1,
    })),
  };
  const result = loadCore().extract1688ProductFromSources({
    url: 'https://detail.1688.com/offer/810000000089.html',
    observedAt: '2026-07-14T10:05:00.000Z',
    sources: [source],
    evidenceSources: [{
      id: 'main',
      sourceType: 'main_world',
      sourcePath: '/pageState/knownGlobals/currentOffer',
      tier: 10,
      value: source,
    }],
  });
  const detailCount = result.captureV2.counts.find((row) => row.fieldPath === '/media/product_detail');
  const detailTransport = result.captureV2.truncations.find((row) => (
    row.stage === 'transport' && row.fieldPath === '/media/product_detail'
  ));

  assert.ok(detailCount);
  assert.ok(detailTransport);
  assert.equal(detailCount.capturedCount, 2000);
  assert.equal(detailTransport.observedCount, 2000);
  assert.equal(detailTransport.retainedCount, detailCount.submittedCount);
});

function lazyHarness(input, options = {}) {
  let now = 0;
  let mediaIndex = 0;
  const scrollCalls = [];
  const listeners = new Map();
  const removedListeners = [];
  const location = { href: input.url };
  const window = {
    scrollX: input.initialScroll.x,
    scrollY: input.initialScroll.y,
    scrollTo(x, y) {
      this.scrollX = Number(x);
      this.scrollY = Number(y);
      scrollCalls.push([this.scrollX, this.scrollY]);
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
      removedListeners.push(type);
    },
    dispatch(type, event) {
      for (const handler of listeners.get(type) || []) handler(event);
    },
  };
  const document = createFixtureDocument(input);
  return {
    window,
    document,
    location,
    scrollCalls,
    removedListeners,
    listenerCount: () => [...listeners.values()].reduce((count, rows) => count + rows.size, 0),
    now: () => now,
    countMedia: () => input.mediaCounts[Math.min(mediaIndex, input.mediaCounts.length - 1)],
    sleep: async (milliseconds) => {
      now += milliseconds;
      mediaIndex += 1;
      if (options.trustedWheelOnSleep && mediaIndex === options.trustedWheelOnSleep) {
        window.dispatch('wheel', { type: 'wheel', isTrusted: true });
        window.scrollX = input.userScrollAfterWheel.x;
        window.scrollY = input.userScrollAfterWheel.y;
      }
      if (options.trustedSpaceOnSleep && mediaIndex === options.trustedSpaceOnSleep) {
        window.dispatch('keydown', { type: 'keydown', key: ' ', code: 'Space', isTrusted: true });
        window.scrollX = input.userScrollAfterWheel.x;
        window.scrollY = input.userScrollAfterWheel.y;
      }
      if (options.navigateOnSleep && mediaIndex === options.navigateOnSleep) {
        location.href = 'https://detail.1688.com/offer/999999999999.html';
        window.scrollY = 1200;
      }
      if (options.throwOnSleep && mediaIndex === options.throwOnSleep) {
        throw new Error('injected warmup failure');
      }
    },
  };
}

test('lazy-media timeout remains non-fatal, records truncation, and restores scroll', async () => {
  const input = fixture('lazy-warmup.sanitized.json');
  const fallback = requireFallback();
  const harness = lazyHarness(input);
  const result = await fallback.warmLazyMedia({
    ...harness,
    maxDurationMs: input.maxDurationMs,
    pollIntervalMs: input.pollIntervalMs,
  });

  assert.equal(result.status, 'timed_out');
  assert.ok(result.steps > 1, 'unchanged media node count must not stall the warmup on its first target');
  assert.equal(result.restored, true);
  assert.deepEqual([harness.window.scrollX, harness.window.scrollY], [37, 640]);
  assert.deepEqual(plain({
    stage: result.truncations[0].stage,
    fieldPath: result.truncations[0].fieldPath,
    reason: result.truncations[0].reason,
    recoverability: result.truncations[0].recoverability,
  }), input.expectedTimeout);
  assert.equal(result.truncations[0].unit, 'items');
  assert.ok(result.truncations[0].observedCount >= result.truncations[0].retainedCount);
  assert.equal(result.truncations[0].fallbackSourcePath, '/dom/media');
});

test('lazy-media warmup restores scroll when an injected wait throws', async () => {
  const input = fixture('lazy-warmup.sanitized.json');
  const fallback = requireFallback();
  const harness = lazyHarness(input, { throwOnSleep: 2 });

  await assert.rejects(fallback.warmLazyMedia({
    ...harness,
    maxDurationMs: input.maxDurationMs,
    pollIntervalMs: input.pollIntervalMs,
  }), /injected warmup failure/);
  assert.deepEqual([harness.window.scrollX, harness.window.scrollY], [37, 640]);
  assert.deepEqual(harness.scrollCalls.at(-1), [37, 640]);
});

test('trusted wheel interrupts warmup without rolling back user scroll and removes every listener', async () => {
  const input = fixture('user-wheel-interrupt.sanitized.json');
  const fallback = requireFallback();
  const harness = lazyHarness(input, { trustedWheelOnSleep: 1 });
  const result = await fallback.warmLazyMedia({
    ...harness,
    maxDurationMs: input.maxDurationMs,
    pollIntervalMs: input.pollIntervalMs,
  });

  assert.equal(result.status, 'user_interrupted');
  assert.equal(result.restored, false);
  assert.deepEqual(
    [harness.window.scrollX, harness.window.scrollY],
    [input.userScrollAfterWheel.x, input.userScrollAfterWheel.y],
  );
  assert.notDeepEqual(
    [harness.window.scrollX, harness.window.scrollY],
    [input.initialScroll.x, input.initialScroll.y],
  );
  assert.equal(harness.listenerCount(), 0);
  assert.deepEqual(harness.removedListeners.slice().sort(), [
    'keydown',
    'pointerdown',
    'touchstart',
    'wheel',
  ]);
  assert.deepEqual(plain(result.truncations), []);
});

test('trusted Space key interrupts warmup without rolling back user scroll', async () => {
  const input = fixture('user-wheel-interrupt.sanitized.json');
  const fallback = requireFallback();
  const harness = lazyHarness(input, { trustedSpaceOnSleep: 1 });
  const result = await fallback.warmLazyMedia({
    ...harness,
    maxDurationMs: input.maxDurationMs,
    pollIntervalMs: input.pollIntervalMs,
  });

  assert.equal(result.status, 'user_interrupted');
  assert.equal(result.restored, false);
  assert.deepEqual(
    [harness.window.scrollX, harness.window.scrollY],
    [input.userScrollAfterWheel.x, input.userScrollAfterWheel.y],
  );
});

test('page navigation interrupts warmup without restoring scroll onto the new offer', async () => {
  const input = fixture('user-wheel-interrupt.sanitized.json');
  const harness = lazyHarness(input, { navigateOnSleep: 1 });
  const result = await requireFallback().warmLazyMedia({
    ...harness,
    maxDurationMs: input.maxDurationMs,
    pollIntervalMs: input.pollIntervalMs,
  });

  assert.equal(result.status, 'page_changed');
  assert.equal(result.restored, false);
  assert.equal(harness.location.href, 'https://detail.1688.com/offer/999999999999.html');
  assert.equal(harness.window.scrollY, 1200);
});

test('maxFrames zero prevents iframe dereference and reports the exact loss', async () => {
  const input = fixture('scan-limits.sanitized.json');
  const { document, result } = await collectFixtureWithDocument(requireFallback(), input, {
    maxFrames: 0,
    maxNodes: 100,
    maxMediaRows: 100,
  });
  const truncation = result.truncations.find((row) => row.fieldPath === '/dom/detailIframes');

  assert.ok(truncation);
  assert.equal(truncation.observedCount, 3);
  assert.equal(truncation.retainedCount, 0);
  assert.equal(truncation.limit, 0);
  assert.deepEqual(plain(document.__fixtureMetrics.contentDocumentReads), {
    'limit-frame-1': 0,
    'limit-frame-2': 0,
    'limit-frame-3': 0,
  });
});

test('processed iframe nodes do not create a false scanned-node truncation', async () => {
  const input = fixture('detail-iframes.sanitized.json');
  const result = await collectFixture(requireFallback(), input, {
    maxFrames: 10,
    maxNodes: 5000,
    maxMediaRows: 100,
  });

  assert.equal(result.truncations.some((row) => row.fieldPath === '/dom/nodes'), false);
});

test('manifest loads the fallback before core and changes no permission baseline', () => {
  const baseline = fixture('manifest-baseline.sanitized.json');
  const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
  const collector = manifest.content_scripts.find((entry) => (
    Array.isArray(entry.matches)
      && entry.matches.includes('https://detail.1688.com/*')
      && Array.isArray(entry.js)
      && entry.js.includes('content/collect-content-script.js')
  ));
  assert.ok(collector, '1688 collector content-script declaration must exist');

  const positions = baseline.scriptOrder.map((script) => collector.js.indexOf(script));
  assert.ok(positions.every((position) => position >= 0), 'collector must load every required script');
  assert.deepEqual(positions.slice().sort((left, right) => left - right), positions);
  assert.deepEqual(plain(manifest.permissions), baseline.permissions);
  assert.deepEqual(plain(manifest.host_permissions), baseline.hostPermissions);
  assert.equal(manifest.permissions.includes('debugger'), false);
});
