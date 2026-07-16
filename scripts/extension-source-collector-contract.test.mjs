import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, ROOT), 'utf8');
}

function fixture(relativePath) {
  return JSON.parse(read(relativePath));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCaptureAndCore() {
  const context = {
    Array, Boolean, Date, JSON, Map, Math, Number, Object, Set, String, URL,
    TextEncoder,
    crypto: webcrypto,
    module: { exports: {} },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(
    read('extensions/ss-erp/shared/contracts/source-product-capture-v2.js'),
    context,
    { filename: 'source-product-capture-v2.js' },
  );
  vm.runInNewContext(
    read('extensions/ss-erp/shared/collectors/source-product-core.js'),
    context,
    { filename: 'source-product-core.js' },
  );
  return {
    contract: context.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2,
    core: context.SS_ERP_SOURCE_PRODUCT_CORE,
  };
}

function expandBoundaryFixture(input) {
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

test('retains the measured V1 loss baseline while V2 preserves the complete canonical capture', async () => {
  const input = fixture('scripts/fixtures/source-collect/1688/sku-boundary-236.sanitized.json');
  const baseline = fixture('scripts/fixtures/source-collect/1688/legacy-v1-measured-baseline.sanitized.json');
  const { contract, core } = loadCaptureAndCore();
  const result = core.extract1688ProductFromSources({
    url: input.sourceUrl,
    host: 'detail.1688.com',
    observedAt: '2026-07-14T08:00:00.000Z',
    extensionVersion: '1.0.196',
    parserVersion: '1.0.196',
    sources: [expandBoundaryFixture(input)],
  });

  assert.equal(baseline.counts.sku.observed, 236);
  assert.equal(baseline.counts.sku.serviceWorker, 100);
  assert.equal(baseline.counts.mainImages.serverTransfer, 20);
  assert.equal(baseline.counts.detailImages.serverTransfer, 20);
  assert.match(baseline.description, /not accepted V2 behavior/);

  assert.equal(result.skuItems.length, baseline.limits.legacyCollectorSkus);
  assert.equal(result.sourceMainImages.length, baseline.limits.legacyCollectorMainImages);
  assert.equal(result.sourceDetailImages.length, baseline.limits.legacyCollectorDetailImages);
  assert.equal(result.sourcePackagingRows.length, baseline.limits.legacyCollectorSkus);
  assert.equal(result.captureV2.skus.length, 236);
  assert.equal(result.captureV2.media.filter((row) => row.role === 'product_main').length, 36);
  assert.equal(result.captureV2.media.filter((row) => row.role === 'product_detail').length, 55);
  assert.equal(result.captureV2.packaging.length, 236);

  const canonicalCount = result.captureV2.counts.find((row) => row.fieldPath === '/skus');
  assert.deepEqual(plain(canonicalCount), {
    fieldPath: '/skus',
    totalCount: 236,
    capturedCount: 236,
    submittedCount: 236,
    truncated: false,
    reason: null,
  });
  const legacySkuTruncation = result.captureV2.truncations.find((row) => (
    row.stage === 'legacy_projection' && row.fieldPath === '/skus'
  ));
  assert.equal(legacySkuTruncation.observedCount, 236);
  assert.equal(legacySkuTruncation.retainedCount, 200);
  assert.equal(legacySkuTruncation.recoverability, 'server_refetch');

  const submission = await contract.createSourceProductCaptureV2Submission(result.captureV2);
  assert.deepEqual(plain(contract.validateSourceProductCaptureV2Submission(submission)), {
    valid: true,
    errors: [],
  });
  assert.deepEqual(plain(await contract.verifySourceProductCaptureV2Submission(submission)), {
    valid: true,
    errors: [],
  });
});

test('V2 preserves stock and freight zero while invalid physical zero remains explicit missing evidence', async () => {
  const input = fixture('scripts/fixtures/source-collect/1688/null-zero.sanitized.json');
  const { contract, core } = loadCaptureAndCore();
  const skuMap = {
    missing: { skuId: 'missing', price: '18.80' },
    unknown: { skuId: 'unknown-null', price: '18.80', stock: null },
    zero: { skuId: 'explicit-zero', price: '18.80', stock: 0 },
  };
  const result = core.extract1688ProductFromSources({
    url: input.sourceUrl,
    host: 'detail.1688.com',
    observedAt: '2026-07-14T08:00:00.000Z',
    extensionVersion: '1.0.196',
    parserVersion: '1.0.196',
    shippingCny: 0,
    shippingFree: true,
    sources: [{
      offerId: input.offerId,
      subject: input.subject,
      skuModel: { skuMap },
      packageInfo: [{ color: 'zero', weightG: 0, lengthMm: 0, widthMm: 0, heightMm: 0 }],
    }],
  });
  const rows = Object.fromEntries(result.captureV2.skus.map((row) => [row.sourceSkuId, row]));

  assert.equal(rows.missing.stock, null);
  assert.equal(rows['unknown-null'].stock, null);
  assert.equal(rows['explicit-zero'].stock, 0);
  assert.equal(rows['explicit-zero'].fieldEvidence.stock.value, 0);
  assert.equal(rows['explicit-zero'].fieldEvidence.stock.missingReason, null);
  assert.equal(result.captureV2.facts.shippingCny, 0);
  assert.equal(result.captureV2.facts.shippingFree, true);
  assert.equal(result.captureV2.facts.packageWeightG, null);
  assert.equal(result.captureV2.fieldEvidence.packageWeightG.missingReason, 'invalid_source_value');
  assert.equal(result.captureV2.fieldEvidence.packageLengthMm.missingReason, 'invalid_source_value');

  const submission = await contract.createSourceProductCaptureV2Submission(result.captureV2);
  assert.equal(contract.validateSourceProductCaptureV2Submission(submission).valid, true);
});

test('loads the generated validator before collection and keeps page evidence credential-free', () => {
  const manifest = JSON.parse(read('extensions/ss-erp/manifest.json'));
  const collectorScript = manifest.content_scripts.find((entry) => (
    Array.isArray(entry.js) && entry.js.includes('content/collect-content-script.js')
  ));
  assert.ok(collectorScript);
  assert.ok(
    collectorScript.js.indexOf('shared/contracts/source-product-capture-v2.js')
      < collectorScript.js.indexOf('shared/collectors/source-product-core.js'),
  );

  const worker = read('extensions/ss-erp/background/service-worker.js');
  assert.ok(
    worker.indexOf("importScripts('../shared/contracts/source-product-capture-v2.js')")
      < worker.indexOf("importScripts('../shared/source-capture/source-capture-submit.js')"),
  );
  const pageBridge = read('extensions/ss-erp/content/page-bridge.js');
  assert.match(pageBridge, /utf8ByteLength/);
  assert.match(pageBridge, /reason:\s*"size_limit"/);
  assert.doesNotMatch(pageBridge, /grantToken|accessToken|refreshToken|Authorization/);
  assert.doesNotMatch(read('extensions/ss-erp/content/collect-content-script.js'), /grantToken|accessToken|refreshToken/);
});
