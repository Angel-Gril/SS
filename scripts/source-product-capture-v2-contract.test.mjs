import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { TextEncoder } from 'node:util';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const generatedTsPath = path.join(root, 'packages/shared/src/source-product-capture.ts');
const browserContractPath = path.join(
  root,
  'extensions/ss-erp/shared/contracts/source-product-capture-v2.js',
);
const schemaPath = path.join(
  root,
  'packages/shared/schemas/source-product-capture-v2.schema.json',
);
const fixturePath = path.join(
  root,
  'scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
);
const boundaryFixturePath = path.join(
  root,
  'scripts/fixtures/source-collect/1688/sku-boundary-236.sanitized.json',
);

function loadBrowserContract() {
  const context = {
    console,
    crypto: webcrypto,
    TextEncoder,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(browserContractPath, 'utf8'), context, {
    filename: browserContractPath,
  });
  return context.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2;
}

function loadSharedContract() {
  const source = readFileSync(generatedTsPath, 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: generatedTsPath,
  }).outputText;
  const module = { exports: {} };
  const context = {
    console,
    crypto: webcrypto,
    TextEncoder,
    module,
    exports: module.exports,
    require(specifier) {
      throw new Error(`Generated shared contract has a runtime dependency: ${specifier}`);
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(javascript, context, { filename: generatedTsPath });
  return module.exports;
}

function fixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('generated source capture artifacts are current', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/generate-source-capture-contract.mjs', '--check'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(readFileSync(generatedTsPath, 'utf8'), /\[k: string\]: any/);
  assert.doesNotMatch(readFileSync(browserContractPath, 'utf8'), /\brequire\s*\(/);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  assert.equal(schema.properties.payloadBytes.maximum, 8 * 1024 * 1024);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['capture', 'captureHash', 'payloadBytes']);
});

test('extension build and verify paths fail closed on generated contract drift', () => {
  const buildSource = readFileSync(path.join(root, 'scripts/build-extension-package.mjs'), 'utf8');
  const verifySource = readFileSync(path.join(root, 'scripts/verify-extension-package.mjs'), 'utf8');
  const packageSource = readFileSync(path.join(root, 'scripts/package-extension-package.mjs'), 'utf8');
  assert.match(buildSource, /generate-source-capture-contract\.mjs['"],\s*['"]--check/);
  assert.match(verifySource, /generate-source-capture-contract\.mjs['"],\s*['"]--check/);
  assert.match(packageSource, /build-extension-package\.mjs/);
});

test('shared and classic validators accept null evidence and explicit zero stock', async () => {
  const browser = loadBrowserContract();
  const shared = loadSharedContract();
  const submission = fixture();

  assert.equal(submission.capture.skus[0].stock, 0);
  assert.equal(submission.capture.facts.packageWeightG, null);
  assert.equal(
    submission.capture.fieldEvidence.packageWeightG.missingReason,
    'source_returned_null',
  );

  assert.deepEqual(plain(browser.validateSourceProductCaptureV2Submission(submission)), {
    valid: true,
    errors: [],
  });
  assert.deepEqual(plain(shared.validateSourceProductCaptureV2Submission(submission)), {
    valid: true,
    errors: [],
  });
  assert.deepEqual(plain(await browser.verifySourceProductCaptureV2Submission(submission)), {
    valid: true,
    errors: [],
  });
  assert.deepEqual(plain(await shared.verifySourceProductCaptureV2Submission(submission)), {
    valid: true,
    errors: [],
  });

  assert.equal(
    browser.sourceProductCaptureCanonicalStringify(submission.capture),
    shared.sourceProductCaptureCanonicalStringify(submission.capture),
  );
  assert.equal(
    await browser.hashSourceProductCaptureV2(submission.capture),
    submission.captureHash,
  );
  assert.equal(
    await shared.hashSourceProductCaptureV2(submission.capture),
    submission.captureHash,
  );
});

test('contract rejects fabricated physical zeroes, ambiguous free freight, and extra fields', () => {
  const browser = loadBrowserContract();

  const zeroWeight = clone(fixture());
  zeroWeight.capture.facts.packageWeightG = 0;
  zeroWeight.capture.fieldEvidence.packageWeightG = {
    ...zeroWeight.capture.fieldEvidence.packageWeightG,
    value: 0,
    missingReason: null,
  };
  assert.equal(browser.validateSourceProductCaptureV2Submission(zeroWeight).valid, false);

  const ambiguousFreeFreight = clone(fixture());
  ambiguousFreeFreight.capture.facts.shippingFree = false;
  ambiguousFreeFreight.capture.fieldEvidence.shippingFree.value = false;
  assert.equal(
    browser.validateSourceProductCaptureV2Submission(ambiguousFreeFreight).valid,
    false,
  );

  const extraField = clone(fixture());
  extraField.capture.ownerUserId = 'must-not-cross-the-page-boundary';
  assert.equal(browser.validateSourceProductCaptureV2Submission(extraField).valid, false);

  const authField = clone(fixture());
  authField.grantToken = 'must-remain-in-the-transport-wrapper';
  assert.equal(browser.validateSourceProductCaptureV2Submission(authField).valid, false);

  const missingReason = clone(fixture());
  missingReason.capture.fieldEvidence.packageWeightG.missingReason = null;
  assert.equal(browser.validateSourceProductCaptureV2Submission(missingReason).valid, false);

  const falseRoleCount = clone(fixture());
  falseRoleCount.capture.counts.push({
    fieldPath: '/media/product_main',
    totalCount: 0,
    capturedCount: 0,
    submittedCount: 0,
    truncated: false,
    reason: null,
  });
  const roleCountResult = browser.validateSourceProductCaptureV2Submission(falseRoleCount);
  assert.equal(roleCountResult.valid, false);
  assert.ok(roleCountResult.errors.some((error) => (
    error.instancePath.endsWith('/submittedCount') && error.keyword === 'stageCount'
  )));
});

test('hash verification rejects a changed capture body', async () => {
  const browser = loadBrowserContract();
  const changed = clone(fixture());
  changed.capture.facts.title = 'Changed after grant issuance';
  changed.capture.fieldEvidence.title.value = changed.capture.facts.title;
  changed.payloadBytes = browser.sourceProductCapturePayloadBytes(changed.capture);

  const result = await browser.verifySourceProductCaptureV2Submission(changed);
  assert.equal(result.valid, false);
  assert.match(result.errors.map((error) => error.message).join('\n'), /hash/i);
});

test('the 236-SKU characterization fixture expands without a checked-in large payload', async () => {
  const browser = loadBrowserContract();
  const template = fixture().capture;
  const boundary = JSON.parse(readFileSync(boundaryFixturePath, 'utf8'));
  const capture = clone(template);
  capture.sourceIdentity.productId = boundary.offerId;
  capture.sourceIdentity.canonicalUrl = boundary.sourceUrl;
  capture.sourceIdentity.fieldEvidence.productId.value = boundary.offerId;
  capture.sourceIdentity.fieldEvidence.canonicalUrl.value = boundary.sourceUrl;
  capture.facts.selectedSkuKey = `${boundary.skuTemplate.mapKeyPrefix}0`;
  capture.fieldEvidence.selectedSkuKey.value = capture.facts.selectedSkuKey;
  capture.skus = Array.from({ length: boundary.skuTemplate.count }, (_, index) => {
    const sku = clone(template.skus[0]);
    sku.key = `${boundary.skuTemplate.mapKeyPrefix}${index}`;
    sku.ordinal = index;
    sku.sourceSkuId = `${boundary.skuTemplate.skuIdPrefix}${index}`;
    sku.specText = `规格 ${index}`;
    sku.priceCny = Number(boundary.skuTemplate.price);
    sku.stock = boundary.skuTemplate.stock;
    sku.fieldEvidence.sourceSkuId.value = sku.sourceSkuId;
    sku.fieldEvidence.specText.value = sku.specText;
    sku.fieldEvidence.priceCny.value = sku.priceCny;
    sku.fieldEvidence.stock.value = sku.stock;
    return sku;
  });
  const skuCount = capture.counts.find((entry) => entry.fieldPath === '/skus');
  Object.assign(skuCount, {
    totalCount: boundary.skuTemplate.count,
    capturedCount: boundary.skuTemplate.count,
    submittedCount: boundary.skuTemplate.count,
    truncated: false,
    reason: null,
  });
  const submission = await browser.createSourceProductCaptureV2Submission(capture);

  assert.equal(submission.capture.skus.length, 236);
  assert.equal(browser.validateSourceProductCaptureV2Submission(submission).valid, true);
  assert.equal(
    (await browser.verifySourceProductCaptureV2Submission(submission)).valid,
    true,
  );
});
