import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';

const url = 'https://detail.1688.com/offer/845581683597.html';
function environment() {
  const model = { skuProps: [{ prop: '规格', value: Array.from({ length: 16 }, (_, index) => ({ name: `白色 ${index} / M` })) }], skuInfoMap: {} };
  for (let index = 0; index < 16; index += 1) model.skuInfoMap[`白色 ${index} / M`] = {
    skuId: `native-${index}`, price: index === 2 ? undefined : 11.5,
    canBookCount: index === 0 ? 0 : index === 1 ? undefined : 100,
  };
  const inline = { textContent: `window.__INIT_DATA__=${JSON.stringify({ skuModel: model })};`, getAttribute: () => null };
  const title = { textContent: '长袖上衣', innerText: '长袖上衣' };
  const gallery = { getAttribute: (key) => key === 'src' ? 'https://cbu01.alicdn.com/img/ibank/main-0-cib.jpg' : null, style: {}, querySelectorAll: () => [] };
  const document = {
    title: '长袖上衣', body: { querySelectorAll: () => [] },
    querySelector: (selector) => selector === '.title-text' ? title : null,
    querySelectorAll: (selector) => selector === 'script:not([src])' || selector === 'script' ? [inline]
      : selector === '.detail-gallery-img' ? [gallery] : [],
    createTreeWalker: () => ({ nextNode: () => false }),
  };
  const context = { URL, TextEncoder, Uint8Array, crypto: webcrypto, document, NodeFilter: { SHOW_ELEMENT: 1 }, location: new URL(url) };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/collectors/source-product-core.js', 'utf8'), context);
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/contracts/source-product-capture-v2.js', 'utf8'), context);
  vm.runInNewContext(readFileSync('extensions/ss-erp/content/donor/adapter-1688.js', 'utf8'), context);
  return context;
}

test('the actual donor parser retains sold-out, unknown-stock and unpriced variants', async () => {
  const context = environment();
  const raw = await context.SS_ERP_DONOR_STRATEGIES.adapter1688.scrape();
  assert.equal(raw.sku_matrix.length, 16);
  assert.equal(raw.sku_matrix[0].stock_quantity, 0);
  assert.equal(raw.sku_matrix[1].stock_quantity, null);
  assert.equal(raw.sku_matrix[2].price.amount, null);
  assert.equal(raw.global_data.packaging.defaults.weight_g, null);
  assert.equal(raw.meta_info.sku_source_type, 'script');
});

test('donor capture compiles into a valid canonical snapshot with stable SKU IDs and truthful provenance', async () => {
  const context = environment();
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/collectors/donor-1688-capture.js', 'utf8'), context);
  const api = context.SS_ERP_DONOR_1688_CAPTURE;
  const options = { url, extensionVersion: '1.0.264', observedAt: '2026-09-30T10:00:00.000Z' };
  const first = await api.collect(options);
  const second = await api.collect(options);
  assert.equal(first.captureV2.skus.length, 16);
  assert.deepEqual(Array.from(first.captureV2.skus, (sku) => sku.key), Array.from(second.captureV2.skus, (sku) => sku.key));
  assert.equal(first.captureV2.skus[0].sourceSkuId, 'native-0');
  assert.equal(first.captureV2.skus[0].stock, 0);
  assert.equal(first.captureV2.skus[1].stock, null);
  assert.equal(first.captureV2.skus[2].priceCny, null);
  assert.equal(first.captureV2.skus[0].rowEvidence.sourceType, 'script');
  assert.equal(first.captureV2.fieldEvidence.title.sourceType, 'dom');
  assert.equal(first.captureV2.facts.packageWeightG, null);
  const submission = await context.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2.createSourceProductCaptureV2Submission(first.captureV2);
  const result = context.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2.validateSourceProductCaptureV2Submission(submission);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('a collector does not wait for the old page-state bridge or invoke ERP/Provider calls', async () => {
  const context = environment();
  context.chrome = { runtime: { sendMessage: () => { throw new Error('unexpected network transport'); } } };
  context.fetch = () => { throw new Error('unexpected Provider/ERP request'); };
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/collectors/donor-1688-capture.js', 'utf8'), context);
  const result = await context.SS_ERP_DONOR_1688_CAPTURE.collect({ url, extensionVersion: 'fixture' });
  assert.equal(result.extractionDiagnostics.collector, 'DONOR_1688');
});

test('source category and breadcrumbs from the donor survive the canonical snapshot adaptation', async () => {
  const context = environment();
  const original = context.SS_ERP_DONOR_STRATEGIES.adapter1688.scrape;
  context.SS_ERP_DONOR_STRATEGIES.adapter1688.scrape = async () => {
    const raw = await original();
    raw.meta_info.source_category_path = '服装 > 女装 > 女式T恤';
    raw.global_data.category_hint = '女式T恤';
    return raw;
  };
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/collectors/donor-1688-capture.js', 'utf8'), context);
  const result = await context.SS_ERP_DONOR_1688_CAPTURE.collect({ url, extensionVersion: 'fixture' });
  assert.equal(result.captureV2.sourceCategory.name, '女式T恤');
  assert.deepEqual(Array.from(result.captureV2.sourceCategory.path, item=>item.name), ['服装','女装','女式T恤']);
  assert.equal(result.captureV2.sourceCategory.id, null, 'no Ozon or source category ID is invented');
});

test('navigation during collection and foreign source URLs are rejected', async () => {
  const context = environment();
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/collectors/donor-1688-capture.js', 'utf8'), context);
  await assert.rejects(context.SS_ERP_DONOR_1688_CAPTURE.collect({ url: 'https://other.invalid/offer/1.html' }), /来源/);
  context.SS_ERP_DONOR_STRATEGIES.adapter1688.scrape = async () => {
    context.location = new URL('https://detail.1688.com/offer/999999999999.html');
    return { meta_info: { source_url: url }, global_data: {}, sku_matrix: [] };
  };
  await assert.rejects(context.SS_ERP_DONOR_1688_CAPTURE.collect({ url }), /已变化/);
});
