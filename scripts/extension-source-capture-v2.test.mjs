import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const CONTRACT_PATH = 'extensions/ss-erp/shared/contracts/source-product-capture-v2.js';
const CORE_PATH = 'extensions/ss-erp/shared/collectors/source-product-core.js';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCaptureRuntime() {
  assert.equal(fs.existsSync(CONTRACT_PATH), true, 'generated Capture V2 runtime must exist');
  const context = {
    Array, Boolean, Date, JSON, Map, Math, Number, Object, Set, String, URL,
    TextEncoder,
    crypto: webcrypto,
    module: { exports: {} },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(CONTRACT_PATH, 'utf8'), context, {
    filename: CONTRACT_PATH,
  });
  return {
    context,
    runtime: context.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2 || context.module.exports,
  };
}

function loadCore() {
  const loaded = loadCaptureRuntime();
  vm.runInNewContext(fs.readFileSync(CORE_PATH, 'utf8'), loaded.context, {
    filename: CORE_PATH,
  });
  return {
    runtime: loaded.runtime,
    core: loaded.context.SS_ERP_SOURCE_PRODUCT_CORE,
  };
}

async function validate(runtime, capture) {
  assert.equal(
    typeof runtime?.createSourceProductCaptureV2Submission,
    'function',
    'generated Capture V2 submission builder must be exported',
  );
  const submission = await runtime.createSourceProductCaptureV2Submission(capture);
  const result = runtime.validateSourceProductCaptureV2Submission(submission);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return submission;
}

function boundarySource(input) {
  const skuMap = {};
  const packageInfo = [];
  for (let index = 0; index < input.skuTemplate.count; index += 1) {
    const suffix = String(index).padStart(3, '0');
    skuMap[`${input.skuTemplate.mapKeyPrefix}${index}`] = {
      skuId: `${input.skuTemplate.skuIdPrefix}${suffix}`,
      price: input.skuTemplate.price,
      stock: input.skuTemplate.stock,
    };
    packageInfo.push({
      color: `spec-${suffix}`,
      size: 'one-size',
      weightG: 250 + index,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      unit: 'mm',
      weightUnit: 'g',
    });
  }
  return {
    offerId: input.offerId,
    subject: input.subject,
    skuModel: { skuMap },
    imageList: Array.from(
      { length: input.imageTemplate.mainCount },
      (_, index) => `${input.imageTemplate.baseUrl}/main-${String(index).padStart(3, '0')}.jpg`,
    ),
    detailImages: Array.from(
      { length: input.imageTemplate.detailCount },
      (_, index) => `${input.imageTemplate.baseUrl}/detail-${String(index).padStart(3, '0')}.jpg`,
    ),
    packageInfo,
  };
}

test('1688 Capture V2 preserves all canonical SKU, media, and packaging evidence', async () => {
  const fixture = JSON.parse(fs.readFileSync(
    'scripts/fixtures/source-collect/1688/sku-boundary-236.sanitized.json',
    'utf8',
  ));
  const { runtime, core } = loadCore();
  const result = core.extract1688ProductFromSources({
    url: fixture.sourceUrl,
    host: 'detail.1688.com',
    observedAt: '2026-07-14T08:00:00.000Z',
    parserVersion: '1.0.196',
    sources: [boundarySource(fixture)],
  });

  assert.ok(result.captureV2, '1688 core must return a native V2 capture');
  await validate(runtime, result.captureV2);
  assert.equal(result.captureV2.provenanceMode, 'native_v2');
  assert.equal(result.captureV2.skus.length, 236);
  assert.equal(result.captureV2.media.filter((row) => row.role === 'product_main').length, 36);
  assert.equal(result.captureV2.media.filter((row) => row.role === 'product_detail').length, 55);
  assert.equal(result.captureV2.packaging.length, 236);

  const skuCount = result.captureV2.counts.find((row) => row.fieldPath === '/skus');
  assert.deepEqual(plain(skuCount), {
    fieldPath: '/skus',
    totalCount: 236,
    capturedCount: 236,
    submittedCount: 236,
    truncated: false,
    reason: null,
  });
  assert.ok(
    result.captureV2.truncations.some((row) => (
      row.stage === 'legacy_projection'
      && row.fieldPath === '/skus'
      && row.observedCount === 236
      && row.retainedCount < 236
      && row.recoverability === 'server_refetch'
    )),
    'bounded legacy previews must have an explicit truncation record',
  );
});

test('Capture V2 keeps unknown and explicit zero stock distinct', async () => {
  const fixture = JSON.parse(fs.readFileSync(
    'scripts/fixtures/source-collect/1688/null-zero.sanitized.json',
    'utf8',
  ));
  const { runtime, core } = loadCore();
  const skuMap = {};
  for (const [index, row] of fixture.cases.entries()) {
    const sku = { skuId: row.id, price: '18.80' };
    if (Object.hasOwn(row, 'stock')) sku.stock = row.stock;
    skuMap[`case-${index}`] = sku;
  }
  const result = core.extract1688ProductFromSources({
    url: fixture.sourceUrl,
    host: 'detail.1688.com',
    observedAt: '2026-07-14T08:00:00.000Z',
    parserVersion: '1.0.196',
    sources: [{
      offerId: fixture.offerId,
      subject: fixture.subject,
      categoryId: '1038375',
      categoryName: 'Sanitized category',
      categoryPath: ['Apparel', 'Sanitized category'],
      skuModel: { skuMap },
      packageInfo: [{
        color: 'explicit-zero',
        size: 'one-size',
        weightG: 0,
        lengthMm: 0,
        widthMm: 0,
        heightMm: 0,
      }],
    }],
  });

  await validate(runtime, result.captureV2);
  const rows = Object.fromEntries(result.captureV2.skus.map((row) => [row.sourceSkuId, row]));
  assert.equal(rows.missing.stock, null);
  assert.equal(rows['unknown-null'].stock, null);
  assert.equal(rows['explicit-zero'].stock, 0);
  assert.notEqual(rows['unknown-null'].fieldEvidence.stock.missingReason, null);
  assert.equal(rows['explicit-zero'].fieldEvidence.stock.missingReason, null);
  assert.equal(rows['explicit-zero'].fieldEvidence.stock.value, 0);
  assert.equal(result.captureV2.facts.packageWeightG, null);
  assert.equal(result.captureV2.fieldEvidence.packageWeightG.missingReason, 'invalid_source_value');
  assert.equal(result.captureV2.fieldEvidence.packageLengthMm.missingReason, 'invalid_source_value');
  assert.equal(result.captureV2.packaging[0].fieldEvidence.weightG.missingReason, 'invalid_source_value');
  assert.equal(result.captureV2.sourceCategory.id, '1038375');
  assert.equal(result.captureV2.sourceCategory.name, 'Sanitized category');
  assert.deepEqual(
    plain(result.captureV2.sourceCategory.path.map((node) => node.name)),
    ['Apparel', 'Sanitized category'],
  );
});

test('page bridge records oversized candidate evidence instead of silently dropping it', async () => {
  const listeners = new Map();
  const posted = [];
  const windowObject = {
    productOversizedCandidate: { payload: 'x'.repeat(500_100) },
    addEventListener(type, handler) { listeners.set(type, handler); },
    postMessage(message) { posted.push(message); },
  };
  windowObject.window = windowObject;
  const context = {
    URLSearchParams,
    decodeURIComponent,
    document: { cookie: '' },
    location: { href: 'https://detail.1688.com/offer/1.html', host: 'detail.1688.com', hostname: 'detail.1688.com' },
    structuredClone,
    window: windowObject,
  };
  vm.runInNewContext(fs.readFileSync('extensions/ss-erp/content/page-bridge.js', 'utf8'), context, {
    filename: 'page-bridge.js',
  });

  const handler = listeners.get('message');
  assert.equal(typeof handler, 'function');
  await handler({
    source: windowObject,
    data: {
      direction: 'spb-self-hosted:content',
      requestId: 'request-1',
      type: 'GET_PAGE_STATE',
    },
  });
  await Promise.resolve();

  const response = posted.find((message) => message.requestId === 'request-1');
  assert.equal(response?.ok, true);
  assert.ok(
    response.payload.truncations.some((row) => (
      row.stage === 'page_bridge'
      && row.fieldPath.includes('productOversizedCandidate')
      && row.reason === 'size_limit'
    )),
  );
  assert.equal(JSON.stringify(response).includes('grantToken'), false);
  assert.equal(JSON.stringify(response).includes('accessToken'), false);
});
