import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDonorWorkbenchLiveCanaryReceipt,
  parseDonorWorkbenchLiveCanaryOptions,
  recordDonorWorkbenchExtensionMutation,
} from './extension-donor-workbench-live-canary-contract.mjs';

const repoRoot = process.cwd();
const extensionDir = path.join(repoRoot, 'extensions', 'ss-erp');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-donor-live-contract-'));
const output = path.join(tempRoot, 'receipt.json');
const releaseBuildRoot = path.join(tempRoot, 'candidate');
const releaseSignature = path.join(tempRoot, 'signature.json');
const commit = 'a'.repeat(40);
const treeSha256 = 'b'.repeat(64);
const positiveUrl = 'https://detail.1688.com/offer/990499606077.html';
const negativeUrl = 'https://detail.1688.com/offer/990499606078.html';

function args(overrides = {}) {
  const values = {
    '--extension-dir': extensionDir,
    '--release-build-root': releaseBuildRoot,
    '--release-signature': releaseSignature,
    '--expected-release-signature-sha256': 'd'.repeat(64),
    '--expected-version': '1.0.366',
    '--expected-git-commit': commit,
    '--expected-tree-sha256': treeSha256,
    '--expected-title-sha256': 'c'.repeat(64),
    '--expected-negative-title-sha256': '2'.repeat(64),
    '--product-url': positiveUrl,
    '--negative-product-url': negativeUrl,
    '--output': output,
    ...overrides,
  };
  return Object.entries(values).flat();
}

test.after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

test.before(() => {
  writeFileSync(releaseSignature, '{}\n', { flag: 'wx' });
  mkdirSync(releaseBuildRoot);
});

test('parses a release-bound distinct-product 1688 live canary', () => {
  const parsed = parseDonorWorkbenchLiveCanaryOptions(args(), { repoRoot });
  assert.equal(parsed.extensionDir, extensionDir);
  assert.equal(parsed.releaseBuildRoot, releaseBuildRoot);
  assert.equal(parsed.releaseSignature, releaseSignature);
  assert.equal(parsed.releaseSignatureSha256, 'd'.repeat(64));
  assert.equal(parsed.version, '1.0.366');
  assert.equal(parsed.gitCommit, commit);
  assert.equal(parsed.extensionTreeSha256, treeSha256);
  assert.equal(parsed.expectedTitleSha256, 'c'.repeat(64));
  assert.equal(parsed.expectedNegativeTitleSha256, '2'.repeat(64));
  assert.equal(parsed.product.sourceKey, '1688:990499606077');
  assert.equal(parsed.negativeProduct.sourceKey, '1688:990499606078');
  assert.equal(parsed.output, output);
});

test('rejects malformed, duplicate-source, in-repository, and overwrite inputs', () => {
  assert.throws(
    () => parseDonorWorkbenchLiveCanaryOptions(args({
      '--product-url': 'http://detail.1688.com/offer/990499606077.html',
    }), { repoRoot }),
    /product URL/u,
  );
  assert.throws(
    () => parseDonorWorkbenchLiveCanaryOptions(args({
      '--negative-product-url': positiveUrl,
    }), { repoRoot }),
    /another/u,
  );
  assert.throws(
    () => parseDonorWorkbenchLiveCanaryOptions(args({
      '--output': path.join(repoRoot, 'build', 'donor-live.json'),
    }), { repoRoot }),
    /outside/u,
  );
  assert.throws(
    () => parseDonorWorkbenchLiveCanaryOptions([
      ...args(), '--expected-version', '1.0.367',
    ], { repoRoot }),
    /exactly once/u,
  );
});

test('builds a PASS receipt only from complete cutover and rollback evidence', () => {
  const base = {
    observedAt: '2026-09-27T12:00:00.000Z',
    gitCommit: commit,
    version: '1.0.366',
    extensionTreeSha256: treeSha256,
    extensionId: 'a'.repeat(32),
    browser: 'Chrome/147.0.7727.15',
    worktreeClean: true,
    releaseBinding: {
      releaseEvidenceSha256: 'd'.repeat(64),
      releaseSignatureSha256: 'e'.repeat(64),
      cloudZipSha256: 'f'.repeat(64),
      keyId: 'release-key',
      signedAt: '2026-09-27T11:00:00.000Z',
    },
    product: {
      url: positiveUrl,
      sourceKey: '1688:990499606077',
      finalUrl: positiveUrl,
      title: 'Real product',
      titleSha256: '1'.repeat(64),
      mediaCount: 3,
      skuCount: 2,
    },
    negativeProduct: {
      url: negativeUrl,
      sourceKey: '1688:990499606078',
      pageTitle: 'Another real product',
      pageTitleSha256: '2'.repeat(64),
      blocked: true,
    },
    cutover: {
      flagOnlyBlocked: true,
      allowlistedMounted: true,
      iframeOpened: true,
      rollbackUnmounted: true,
      legacyBefore: true,
      legacyAfterRollback: true,
      storageCleared: true,
    },
    network: {
      providerRequests: 0,
      ozonRequests: 0,
      erpMutations: 0,
      unexpectedExtensionMutations: [],
    },
    pageErrors: [],
    screenshotSha256: 'c'.repeat(64),
  };
  const receipt = buildDonorWorkbenchLiveCanaryReceipt(base);
  assert.equal(receipt.kind, 'SS_ERP_DONOR_WORKBENCH_LIVE_CANARY');
  assert.equal(receipt.status, 'PASS');
  assert.throws(
    () => buildDonorWorkbenchLiveCanaryReceipt({
      ...base,
      cutover: { ...base.cutover, rollbackUnmounted: false },
    }),
    /rollbackUnmounted/u,
  );
  assert.throws(
    () => buildDonorWorkbenchLiveCanaryReceipt({
      ...base,
      network: { ...base.network, erpMutations: 1 },
    }),
    /erpMutations/u,
  );
});

test('arms paused iframe observation before opening the donor shell', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts', 'extension-donor-workbench-live-canary.mjs'),
    'utf8',
  );
  const attachedHandler = source.indexOf("cdp.on('Target.attachedToTarget'");
  const autoAttach = source.indexOf("'Target.setAutoAttach'");
  const paused = source.indexOf('waitForDebuggerOnStart: true');
  const resume = source.indexOf("'Runtime.runIfWaitingForDebugger'");
  const click = source.indexOf("type: 'mousePressed'");
  assert.ok(attachedHandler >= 0 && resume > attachedHandler && autoAttach > resume
    && paused > autoAttach && click > paused);
});

test('prefers system Chrome with monitored extension loading over older Playwright Chromium', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts', 'extension-donor-workbench-live-canary.mjs'),
    'utf8',
  );
  const systemChrome = source.indexOf("process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES");
  const playwrightChrome = source.indexOf("ms-playwright/chromium-1217/chrome-win64/chrome.exe");
  const capabilityError = source.indexOf('selected Chromium lacks monitored extension loading');
  assert.ok(systemChrome >= 0 && playwrightChrome > systemChrome && capabilityError > playwrightChrome);
});

test('cleanup does not shadow the Node process owner before platform detection', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts', 'extension-donor-workbench-live-canary.mjs'),
    'utf8',
  );
  const cleanup = source.slice(
    source.indexOf('async function terminateProfileChromium'),
    source.indexOf('async function extensionTreeSha256'),
  );
  assert.match(cleanup, /if \(process\.platform !== 'win32'\) return;/u);
  assert.doesNotMatch(cleanup, /const process\s*=/u);
});

test('waits for the resumed Worker context before asserting manifest identity', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts', 'extension-donor-workbench-live-canary.mjs'),
    'utf8',
  );
  assert.match(source, /await until\(async \(\) => \{[\s\S]*typeof chrome ===/u);
  assert.match(source, /release-bound Worker identity[^]*10_000/u);
});

test('binds readyState to the final exact-URL frame-tree loader', () => {
  const source = readFileSync(
    path.join(repoRoot, 'scripts', 'extension-donor-workbench-live-canary.mjs'),
    'utf8',
  );
  assert.match(source, /Page\.frameNavigated/u);
  assert.match(source, /observed\.url === url/u);
  assert.match(source, /Page\.getFrameTree/u);
  assert.match(source, /currentFrame\.loaderId !== finalNavigation\.loaderId/u);
  assert.doesNotMatch(source, /Page\.lifecycleEvent|Page\.setLifecycleEventsEnabled/u);
});

test('attributes mutations from workers, extension iframes, and content-script initiators', () => {
  const extensionId = 'a'.repeat(32);
  const workerSession = 'worker-session';
  const iframeSession = 'iframe-session';
  const extensionSessions = new Set([workerSession, iframeSession]);
  const network = {
    providerRequests: 0,
    ozonRequests: 0,
    erpMutations: 0,
    unexpectedExtensionMutations: [],
  };
  const record = (event, sessionId) => recordDonorWorkbenchExtensionMutation(network, event, {
    extensionId,
    extensionSessions,
    sessionId,
  });
  assert.equal(record({
    request: { method: 'POST', url: 'https://provider.example/v1/images/generations' },
  }, workerSession), true);
  assert.equal(record({
    request: { method: 'POST', url: 'https://api-seller.ozon.ru/v3/product/import' },
  }, iframeSession), true);
  assert.equal(record({
    request: { method: 'PATCH', url: 'https://ss-erp.com/api/source-listing-workflows/one' },
    initiator: {
      stack: { callFrames: [{ url: `chrome-extension://${extensionId}/content/donor-workbench-bridge.js` }] },
    },
  }, 'page-session'), true);
  assert.equal(record({
    request: { method: 'POST', url: 'https://detail.1688.com/event/collect' },
    initiator: { stack: { callFrames: [{ url: 'https://detail.1688.com/app.js' }] } },
  }, 'page-session'), false);
  assert.deepEqual(network, {
    providerRequests: 1,
    ozonRequests: 1,
    erpMutations: 1,
    unexpectedExtensionMutations: [
      { method: 'POST', origin: 'https://provider.example', pathname: '/v1/images/generations' },
      { method: 'POST', origin: 'https://api-seller.ozon.ru', pathname: '/v3/product/import' },
      { method: 'PATCH', origin: 'https://ss-erp.com', pathname: '/api/source-listing-workflows/one' },
    ],
  });
});
