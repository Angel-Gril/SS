import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const extensionRoot = 'extensions/ss-erp';
const policyPath = `${extensionRoot}/shared/message-security/runtime-message-policy.js`;
const deviceSessionPath = `${extensionRoot}/shared/erp-adapter/source-workflow-device-session.js`;
const threatModelPath = 'docs/security/source-listing-extension-threat-model.md';
const policySource = fs.readFileSync(policyPath, 'utf8');
const deviceSessionSource = fs.readFileSync(deviceSessionPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(`${extensionRoot}/manifest.json`, 'utf8'));

function loadPolicy() {
  const context = { Array, Boolean, Object, Set, String, URL };
  context.globalThis = context;
  vm.runInNewContext(policySource, context, { filename: policyPath });
  return context.SS_ERP_RUNTIME_MESSAGE_POLICY;
}

function loadDeviceSessionTransport() {
  const context = {
    AbortController,
    ArrayBuffer,
    Blob,
    FormData,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    clearTimeout,
    setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(deviceSessionSource, context, { filename: deviceSessionPath });
  return context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION;
}

function runtimeSender(url, extensionId) {
  const parsed = new URL(url);
  return {
    id: extensionId,
    url,
    tab: { url },
    ...(parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? { origin: parsed.origin }
      : {}),
  };
}

function readExtensionSource(relativePath) {
  return fs.readFileSync(`${extensionRoot}/${relativePath}`, 'utf8');
}

function listFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

test('marketplace and ERP page senders cannot select new command-grant, confirm, or publish channels', () => {
  const policy = loadPolicy();
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const pageSenders = [
    runtimeSender('https://detail.1688.com/offer/123.html', extensionId),
    runtimeSender('https://www.ozon.ru/product/123', extensionId),
    runtimeSender('https://app.ss-erp.cn/source-listing', extensionId),
  ];
  const privilegedTypes = [
    'ss-erp:source-workflow-command-grant-issue',
    'ss-erp:source-workflow-listing-confirm',
    'ss-erp:source-workflow-ozon-publish',
    'ss-erp:source-workflow-media-execute',
  ];

  for (const sender of pageSenders) {
    for (const type of privilegedTypes) {
      assert.equal(
        policy.isAllowedRuntimeMessageSender(type, sender, extensionId),
        false,
        `${type} must fail closed for ${sender.url}`,
      );
    }
  }

  const sourcePage = pageSenders[0];
  const ozonPage = pageSenders[1];
  const erpPage = pageSenders[2];
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'spb-self-hosted:publish-ozon-workbench-rows', sourcePage, extensionId,
  ), true, 'source pages retain the rollout-gated legacy message during migration');
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'spb-self-hosted:publish-ozon-workbench-rows', ozonPage, extensionId,
  ), true, 'Ozon pages retain the rollout-gated legacy message during migration');
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'spb-self-hosted:publish-ozon-workbench-rows', erpPage, extensionId,
  ), false, 'the ERP page bridge has never required the legacy one-click publish message');

  const extensionUi = runtimeSender(
    `chrome-extension://${extensionId}/pages/popup.html`,
    extensionId,
  );
  assert.equal(
    policy.isAllowedRuntimeMessageSender(
      'spb-self-hosted:publish-ozon-workbench-rows',
      extensionUi,
      extensionId,
    ),
    true,
    'the legacy type remains extension-owned while server rollout gates retire it',
  );
});

test('source workflow handoff opening is a known extension contract with a narrow sender matrix', () => {
  const policy = loadPolicy();
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const type = 'ss-erp:open-source-workflow-handoff';
  const sourcePage = runtimeSender('https://detail.1688.com/offer/123.html', extensionId);
  const extensionUi = runtimeSender(`chrome-extension://${extensionId}/pages/popup.html`, extensionId);

  assert.equal(policy.isKnownRuntimeMessageType(type), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(type, sourcePage, extensionId), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(type, extensionUi, extensionId), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    type, runtimeSender('https://app.ss-erp.cn/collect/source', extensionId), extensionId,
  ), false);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    type, runtimeSender('https://www.ozon.ru/product/123', extensionId), extensionId,
  ), false);
  assert.equal(policy.isAllowedRuntimeMessageSender(type, {
    url: sourcePage.url,
    tab: sourcePage.tab,
    origin: sourcePage.origin,
  }, extensionId), false, 'a MAIN-world/page sender without the extension id must fail closed');
  assert.equal(policy.isAllowedRuntimeMessageSender(type, sourcePage, 'different-extension-id'), false);
});

test('the known legacy page publish exception is gated at all server submission boundaries', () => {
  const listing = fs.readFileSync('apps/server/src/routes/listing.ts', 'utf8');
  const worker = fs.readFileSync('apps/server/src/workers/browser-one-click-listing.ts', 'utf8');
  const collect = fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8');
  const flags = fs.readFileSync('apps/server/src/services/source-workflow-feature-flags.ts', 'utf8');

  const post = listing.slice(
    listing.indexOf("app.post('/browser-one-click-jobs'"),
    listing.indexOf("app.patch('/browser-one-click-jobs/:id'"),
  );
  assert.ok(post.indexOf('enforceLegacySourceOzonPublish') >= 0);
  assert.ok(post.indexOf('enforceLegacySourceOzonPublish') < post.indexOf('prisma.syncJob.create'));

  const patch = listing.slice(
    listing.indexOf("app.patch('/browser-one-click-jobs/:id'"),
    listing.indexOf("app.get('/tasks'"),
  );
  assert.match(patch, /shouldQueueBackendJob[\s\S]*enforceLegacySourceOzonPublish/);
  assert.ok(patch.indexOf('enforceLegacySourceOzonPublish') < patch.indexOf('addBrowserOneClickListingJob'));

  const runWorker = worker.slice(
    worker.indexOf('export async function runBrowserOneClickListingJob'),
    worker.indexOf('export async function addBrowserOneClickListingJob'),
  );
  assert.ok(runWorker.indexOf('payload.taskId') < runWorker.indexOf('assertLegacySourceOzonPublishAllowed'));
  assert.ok(runWorker.indexOf('assertLegacySourceOzonPublishAllowed') < runWorker.indexOf('ensureBrowserOneClickSupplyGoods'));
  assert.match(worker, /async function callPublishOzon[\s\S]*assertLegacySourceOzonPublishAllowed[\s\S]*fetch\(/);

  const publishRoute = collect.slice(
    collect.indexOf("app.post('/publish-ozon'"),
    collect.indexOf("app.get('/debug-metadata/:id'"),
  );
  assert.ok(publishRoute.indexOf('assertCurrentLegacyPublish') >= 0);
  assert.ok(publishRoute.indexOf('await assertCurrentLegacyPublish()') < publishRoute.indexOf('client.importBySku'));
  assert.ok(publishRoute.indexOf('await assertCurrentLegacyPublish()') < publishRoute.indexOf('client.importProducts'));

  assert.match(flags, /if \(!decision\.legacyAllowed\)/);
  assert.match(flags, /SourceWorkflowLegacyPublishError/);
});

test('MAIN-world and injected page bridges expose evidence operations only', () => {
  const manifestMainWorldScripts = (manifest.content_scripts || [])
    .filter((entry) => entry.world === 'MAIN')
    .flatMap((entry) => entry.js || []);
  const injectedPageScripts = [
    'content/page-bridge.js',
    'content/capture-page-hook.js',
    'content/source-search-1688-page.js',
    'content/source-search-pdd-page.js',
    'content/source-search-taobao-page.js',
  ];
  const pageRealmScripts = [...new Set([...manifestMainWorldScripts, ...injectedPageScripts])];
  const forbiddenCommandSurface = /command.?grant|grant.?token|listing:publish|media:execute|confirm.?listing|publish.?ozon/i;

  assert.ok(pageRealmScripts.length > 0, 'the contract must inspect every declared MAIN-world surface');
  for (const relativePath of pageRealmScripts) {
    const source = readExtensionSource(relativePath);
    assert.doesNotMatch(
      source,
      forbiddenCommandSurface,
      `${relativePath} must not carry privileged workflow commands or grants`,
    );
    assert.doesNotMatch(
      source,
      /chrome\.runtime\.(?:sendMessage|connect)/,
      `${relativePath} must not call extension runtime APIs from the page realm`,
    );
  }

  const pageBridge = readExtensionSource('content/page-bridge.js');
  assert.match(pageBridge, /payload\.type\s*!==\s*["']GET_PAGE_STATE["']/);
  assert.match(pageBridge, /knownGlobals:\s*readKnownGlobals\(truncations\)/);
  assert.match(pageBridge, /aliExpressData:\s*await getAliExpressData\(\)/);
  assert.match(pageBridge, /truncations/);
  assert.match(pageBridge, /reason:\s*["']size_limit["']/);

  const captureHook = readExtensionSource('content/capture-page-hook.js');
  assert.match(captureHook, /SUPPORTED_KEYWORDS/);
  assert.match(captureHook, /SENSITIVE_KEYWORDS/);
  assert.match(captureHook, /SAFE_HEADER_NAMES/);
  assert.match(captureHook, /type:\s*['"]network-entry['"]/);
});

test('isolated-world page relays define evidence operations and no privileged grant fields', () => {
  const relayPaths = [
    'content/capture-network-bridge.js',
    'content/erp-collect-bridge.js',
    'content/collect-content-script.js',
  ];
  for (const relativePath of relayPaths) {
    const source = readExtensionSource(relativePath);
    assert.doesNotMatch(
      source,
      /commandGrant|command_grant|grantToken|grant_token|listing:publish|media:execute/i,
      `${relativePath} must not transport command grants from a page`,
    );
  }

  const captureRelay = readExtensionSource('content/capture-network-bridge.js');
  assert.match(captureRelay, /data\.type\s*===\s*['"]network-entry['"]/);
  assert.match(captureRelay, /data\.type\s*===\s*['"]ozon-company-id['"]/);
  assert.doesNotMatch(captureRelay, /data\.type\s*===\s*['"](?:confirm|publish|command)/i);
});

test('new source workflow security surfaces contain no provider, Ozon, or reusable account credential', () => {
  const securitySurfacePaths = [
    'shared/message-security/runtime-message-policy.js',
    'shared/logistics-rules/device-credential-manager.js',
    'shared/config-bridge/config-store.js',
    'background/service-worker.js',
    'background/collect-background.js',
  ];
  const forbiddenCredentialIdentifier = /(?:ai|openai|dashscope|ozon)[_-]?(?:api[_-]?key|secret)|apiKeyEncrypted|legacyAccountToken|accountBearerToken|accountAccessToken|clientSecret/i;
  const commandCredentialPersistence = /(?:chrome\.storage|storageSet|console\.(?:log|info|warn|error))[\s\S]{0,240}(?:commandGrant|grantToken|commandToken)/i;

  for (const relativePath of securitySurfacePaths) {
    const source = readExtensionSource(relativePath);
    assert.doesNotMatch(
      source,
      forbiddenCredentialIdentifier,
      `${relativePath} must not introduce provider/Ozon/reusable account credentials`,
    );
    assert.doesNotMatch(
      source,
      commandCredentialPersistence,
      `${relativePath} must not persist or log short-lived command credentials`,
    );
  }

  const extensionSources = listFiles(extensionRoot)
    .filter((file) => /\.(?:js|json|html)$/i.test(file))
    .map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
  const newWorkflowMarker = /ss-erp:source-workflow|source[-_:]?listing[-_:]?workflow|extension[-_:]?command[-_:]?grant|commandGrant/i;
  for (const { file, source } of extensionSources.filter(({ source }) => newWorkflowMarker.test(source))) {
    assert.doesNotMatch(
      source,
      forbiddenCredentialIdentifier,
      `${file} must not couple the new workflow to a provider/Ozon/reusable account credential`,
    );
  }

  const allExtensionSource = extensionSources.map(({ source }) => source).join('\n');
  assert.doesNotMatch(
    allExtensionSource,
    commandCredentialPersistence,
    'no extension surface may persist or log a short-lived source-workflow command credential',
  );
  assert.doesNotMatch(
    allExtensionSource,
    /(?:sk-[A-Za-z0-9_-]{24,}|AIza[0-9A-Za-z_-]{30,}|dashscope[_-]?api[_-]?key\s*[:=]\s*['"][^'"]{12,})/i,
    'the packaged extension must not contain a provider credential literal',
  );
});

test('the threat model documents trust zones, fail-closed commands, replay, and secret handling', () => {
  assert.equal(fs.existsSync(threatModelPath), true, 'the Unit 0A threat model must exist');
  const source = fs.readFileSync(threatModelPath, 'utf8');
  for (const required of [
    'MAIN world',
    'evidence',
    'ExtensionCommandGrant',
    'ExtensionCommandReceipt',
    'idempotency',
    'listing:publish',
    'reusable account',
    'Ozon',
    'incident',
    'legacy exception',
  ]) {
    assert.match(source, new RegExp(required, 'i'), `threat model must cover ${required}`);
  }
});

test('device transport admits canonical batch status-v2 and preserves source GET queries', async () => {
  const api = loadDeviceSessionTransport();
  const requests = [];
  const transport = api.createTransport({
    credentials: {
      async beginOperation() {
        return {
          state: 'paired',
          epoch: 0,
          baseUrl: 'https://api.ss-erp.example',
          deploymentId: 'deployment-1',
          deviceId: 'device-1',
          ownerUserId: 'owner-1',
          sessionId: 'session-1',
          scopes: ['listing:review', 'byok:media:ingest'],
          expiresAt: '2030-01-01T00:00:00.000Z',
          accessToken: 'fixture-access-token',
        };
      },
      async isOperationCurrent() { return true; },
      async clearIfCurrent() { return true; },
    },
    async fetchImpl(url, init) {
      requests.push({ url, init });
      const body = JSON.stringify({ code: 1, data: {} });
      return {
        status: 200,
        ok: true,
        headers: { get() { return null; } },
        body: null,
        async text() { return body; },
      };
    },
  });
  const statusV2Query = '?contractVersion=extension-byok-execution-batch-status%2Fv2';
  const allowed = [
    '/api/extension-device/byok-media/execution-batches/batch-1',
    `/api/extension-device/byok-media/execution-batches/batch-1${statusV2Query}`,
    `/api/extension-device/byok-media/execution-batches/by-idempotency/reservation-1${statusV2Query}`,
    '/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
  ];
  for (const requestPath of allowed) {
    await transport.get(requestPath, { requiredScope: 'byok:media:ingest' });
  }
  assert.deepEqual(
    requests.map(({ url }) => url),
    allowed.map((requestPath) => `https://api.ss-erp.example${requestPath}`),
  );

  const rejected = [
    '/api/extension-device/byok-media/execution-batches/batch-1?contractVersion=extension-byok-execution-batch-status%2Fv1',
    `/api/extension-device/byok-media/execution-batches/batch-1${statusV2Query}&contractVersion=extension-byok-execution-batch-status%2Fv2`,
    '/api/extension-device/byok-media/execution-batches/batch-1?unknown=1',
    '/api/extension-device/byok-media/execution-batches/batch-1?contractVersion=extension-byok-execution-batch-status%2fv2',
    '/api/extension-device/byok-media/execution-batches/batch-1?contractVersion=extension-byok-execution-batch-status/v2',
    `/api/extension-device/byok-media/execution-batches/batch-1${statusV2Query}#fragment`,
    '/api/extension-device/byok-media/execution-batches/batch-1?',
    '/api/extension-device/source-workbench/status?snapshotId=snapshot-1#fragment',
    '/api/extension-device/source-workbench/status?',
  ];
  for (const requestPath of rejected) {
    await assert.rejects(
      transport.get(requestPath, { requiredScope: 'byok:media:ingest' }),
      /source workbench path is invalid/u,
    );
  }
  assert.equal(requests.length, allowed.length);
});
