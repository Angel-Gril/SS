import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const popup = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const sourcePanel = fs.readFileSync('extensions/ss-erp/content/source-costing-panel.js', 'utf8');

const handoffBuilder = serviceWorker.match(
  /function buildSourceWorkflowHandoffPath[\s\S]*?\n}\n\nfunction createSourceWorkflowHandoff/,
)?.[0] || '';
assert.ok(handoffBuilder, 'service worker should define a dedicated source workflow handoff path builder');
for (const key of ['supplyGoodsId', 'snapshotId', 'snapshotVersion', 'sourceProductId', 'platform']) {
  assert.match(handoffBuilder, new RegExp(`params\\.set\\(['"]${key}['"]`), `handoff path should include ${key}`);
}
assert.match(handoffBuilder, /params\.set\(['"]section['"],\s*['"]listing['"]\)/, 'handoff path should open the listing section');
assert.doesNotMatch(
  handoffBuilder,
  /owner(?:User)?Id|shopId|token|grant|accessToken|refreshToken|Authorization/i,
  'handoff path must contain only immutable source business identifiers',
);

const compactBuilder = serviceWorker.match(
  /function createSourceWorkflowHandoff[\s\S]*?\n}\n\nfunction validateSourceWorkflowHandoff/,
)?.[0] || '';
assert.ok(compactBuilder, 'service worker should normalize the capture response into a compact handoff');
for (const field of ['supplyGoodsId', 'snapshotId', 'snapshotVersion', 'sourceProductId', 'platform', 'path']) {
  assert.match(compactBuilder, new RegExp(`\\b${field}\\b`), `compact handoff should account for ${field}`);
}
assert.doesNotMatch(
  compactBuilder,
  /owner(?:User)?Id|shopId|token|grant|profile|captureHash|subjectId/i,
  'compact handoff must not retain identities, credentials, profiles, or mutable capture details',
);

assert.match(
  serviceWorker,
  /const SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY\s*=\s*['"]ss-erp:source-workflow:last-handoff:v1['"]/,
  'service worker should retain one versioned latest-handoff compatibility key',
);
assert.match(
  serviceWorker,
  /\[SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY\]:\s*latestHandoff[\s\S]{0,160}\[SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY\]:\s*boundedRecords/,
  'a successful V2 capture should persist a compact latest handoff and bounded identity map',
);
assert.match(
  serviceWorker,
  /let sourceWorkflowHandoffWriteQueue\s*=\s*Promise\.resolve\(\)/,
  'handoff read-modify-write operations should share one service-worker serialization queue',
);
const v2BatchPersistence = serviceWorker.match(
  /if \(submitted\.length === nativeCaptureItems\.length\)[\s\S]{0,500}notifyErpCollectCompleted/,
)?.[0] || '';
assert.match(
  v2BatchPersistence,
  /persistSourceWorkflowHandoffs\(handoffs\)/,
  'a successful V2 batch should persist every generated handoff together',
);
assert.doesNotMatch(
  v2BatchPersistence,
  /persistSourceWorkflowHandoff\(handoffs\[handoffs\.length - 1\]\)/,
  'a successful V2 batch must not persist only its final handoff',
);
assert.match(
  serviceWorker,
  /sendResponse\(\{[\s\S]{0,500}\bhandoff\b[\s\S]{0,500}captureVersion:\s*['"]source-product-capture-v2['"]/,
  'the V2 response should expose the compact handoff to extension UI callers',
);
const v2Response = serviceWorker.match(
  /sendResponse\(\{\s*ok:\s*true,[\s\S]{0,600}captureVersion:\s*['"]source-product-capture-v2['"][\s\S]{0,80}\}\);/,
)?.[0] || '';
assert.ok(v2Response, 'service worker should have one bounded V2 response envelope');
assert.doesNotMatch(v2Response, /captures\s*:|profile\s*:|captureHash\s*:/, 'V2 UI response should not return the full capture result');

const openHandler = serviceWorker.match(
  /if \(message\.type === SS_ERP_OPEN_SOURCE_WORKFLOW_HANDOFF_MESSAGE\)[\s\S]*?\n\s*return true;\n\s*}/,
)?.[0] || '';
assert.ok(openHandler, 'service worker should handle the explicit source workflow open message');
assert.match(openHandler, /SS_ERP_CONFIG\.getConfig\(\)/, 'open handler should derive the ERP origin from configured runtime state');
assert.match(
  openHandler,
  /readPersistedSourceWorkflowHandoff\(message\.platform, message\.sourceProductId\)/,
  'open handler should read the exact server-issued persisted handoff',
);
assert.match(openHandler, /chrome\.tabs\.create\(/, 'open handler should create the ERP tab itself');
assert.match(
  openHandler,
  /message\.snapshotId[\s\S]{0,240}handoff\.snapshotId/,
  'open handler should reject a stale CTA instead of opening a newer persisted handoff',
);
assert.doesNotMatch(openHandler, /isAllowedRuntimeMessageSender/, 'open handler should rely on the registered runtime message policy');
assert.doesNotMatch(
  openHandler,
  /message\.(?:url|href|path|payload)|payload\.(?:url|href|path)/,
  'open handler must never accept a caller-provided external URL or path',
);

for (const [label, source] of [['popup', popup], ['source panel', sourcePanel]]) {
  assert.match(source, /打开 ERP 继续/, `${label} should expose an explicit continue CTA`);
  assert.match(
    source,
    /type:\s*['"]ss-erp:open-source-workflow-handoff['"][\s\S]{0,120}snapshotId:/,
    `${label} CTA should invoke the controlled service-worker open message with its expected snapshot`,
  );
  assert.match(source, /\.handoff/, `${label} should enable its CTA only from a successful V2 handoff response`);
  assert.doesNotMatch(
    source,
    /已打开 ERP[，,]可继续处理上架信息/u,
    `${label} must not report a reachable ERP page after only creating a browser tab`,
  );
  assert.match(
    source,
    /已创建 ERP 标签页，请确认页面加载后继续创建草稿/u,
    `${label} should describe the exact handoff outcome without claiming page readiness`,
  );
}
assert.match(popup, /sourceWorkflowHandoffBtn\.hidden\s*=\s*!handoff/, 'popup CTA should remain hidden without a V2 handoff');
assert.match(sourcePanel, /open-source-workflow[^\n]*hidden/, 'source panel CTA should be hidden by default');
const popupCollect = popup.match(/function collectSourcePage[\s\S]*?\n\s{2}function quoteSourcePage/)?.[0] || '';
const panelCollect = sourcePanel.match(/async function collectToErp[\s\S]*?\n\s{2}async function collectForMediaWorkflow/)?.[0] || '';
assert.doesNotMatch(popupCollect, /openSourceWorkflowHandoff\(/, 'popup should not auto-open ERP after capture');
assert.doesNotMatch(panelCollect, /openSourceWorkflow\(/, 'source panel should not auto-open ERP after capture');
assert.match(
  serviceWorker,
  /const items = rawItems\.map\(normalizeSourceProductForErpCollect\)[\s\S]{0,1800}sendResponse\(\{ ok: true, data, saved, errorCount: errors\.length }\)/,
  'legacy source collection should retain its existing response without manufacturing a V2 handoff',
);

const helperSource = serviceWorker.slice(
  serviceWorker.indexOf('function sourceWorkflowHandoffText'),
  serviceWorker.indexOf('function validateDeliveryEnvelope'),
);
assert.ok(helperSource.length > 0, 'handoff helpers should form one independently testable block');
const stored = {};
const context = {
  Array,
  Number,
  Object,
  Set,
  String,
  URL,
  URLSearchParams,
  encodeURIComponent,
  chrome: {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, stored[key]]));
        },
        async set(value) {
          Object.assign(stored, value);
        },
      },
    },
  },
};
context.globalThis = context;
vm.runInNewContext(
  `const SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY = 'ss-erp:source-workflow:last-handoff:v1';\nconst SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY = 'ss-erp:source-workflow:handoffs:v2';\nconst SS_ERP_SOURCE_WORKFLOW_HANDOFF_LIMIT = 20;\n${helperSource}\n;globalThis.handoffApi = { createSourceWorkflowHandoff, validateSourceWorkflowHandoff, persistSourceWorkflowHandoff, persistSourceWorkflowHandoffs, readPersistedSourceWorkflowHandoff, buildConfiguredSourceWorkflowUrl };`,
  context,
  { filename: 'service-worker-source-workflow-handoff.js' },
);

const handoff = context.handoffApi.createSourceWorkflowHandoff({
  supplyGoodsId: 'goods/one',
  snapshotId: 'snapshot?one',
  snapshotVersion: 3,
}, '1688 offer 42', '1688');
const plainHandoff = JSON.parse(JSON.stringify(handoff));
assert.deepEqual(plainHandoff, {
  supplyGoodsId: 'goods/one',
  snapshotId: 'snapshot?one',
  snapshotVersion: 3,
  sourceProductId: '1688 offer 42',
  platform: '1688',
  path: '/collect/source?supplyGoodsId=goods%2Fone&snapshotId=snapshot%3Fone&snapshotVersion=3&sourceProductId=1688+offer+42&platform=1688&section=listing',
});
assert.deepEqual(
  [...new URL(`https://erp.example${handoff.path}`).searchParams.keys()].sort(),
  ['platform', 'section', 'snapshotId', 'snapshotVersion', 'sourceProductId', 'supplyGoodsId'],
);
assert.equal(context.handoffApi.validateSourceWorkflowHandoff({ ...handoff, ownerUserId: 'owner-1' }), null);
assert.equal(context.handoffApi.validateSourceWorkflowHandoff({ ...handoff, shopId: 'shop-1' }), null);
assert.equal(context.handoffApi.validateSourceWorkflowHandoff({ ...handoff, grantToken: 'secret' }), null);

await context.handoffApi.persistSourceWorkflowHandoff(handoff);
assert.deepEqual(JSON.parse(JSON.stringify(stored['ss-erp:source-workflow:last-handoff:v1'])), plainHandoff);
assert.deepEqual(
  JSON.parse(JSON.stringify(stored['ss-erp:source-workflow:handoffs:v2']['1688:1688%20offer%2042'])),
  plainHandoff,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(await context.handoffApi.readPersistedSourceWorkflowHandoff())),
  plainHandoff,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(await context.handoffApi.readPersistedSourceWorkflowHandoff('1688', '1688 offer 42'))),
  plainHandoff,
);

function resetPersistedHandoffs() {
  delete stored['ss-erp:source-workflow:last-handoff:v1'];
  delete stored['ss-erp:source-workflow:handoffs:v2'];
}

resetPersistedHandoffs();
stored['ss-erp:source-workflow:last-handoff:v1'] = {
  supplyGoodsId: 'legacy-goods',
  snapshotId: 'legacy-snapshot',
  snapshotVersion: 7,
  sourceProductId: 'legacy-source',
  path: '/collect/source?supplyGoodsId=legacy-goods&snapshotId=legacy-snapshot&snapshotVersion=7&sourceProductId=legacy-source&section=listing',
};
assert.equal(
  await context.handoffApi.readPersistedSourceWorkflowHandoff('1688', 'another-source'),
  null,
  'legacy handoff migration must require the current page product identity',
);
assert.equal(
  await context.handoffApi.readPersistedSourceWorkflowHandoff('pdd', 'legacy-source'),
  null,
  'a legacy 1688 handoff must not migrate for another marketplace with the same product ID',
);
const migratedLegacy = await context.handoffApi.readPersistedSourceWorkflowHandoff('1688', 'legacy-source');
assert.equal(migratedLegacy.platform, '1688');
assert.match(migratedLegacy.path, /[?&]platform=1688(?:&|$)/u);
assert.deepEqual(
  JSON.parse(JSON.stringify(stored['ss-erp:source-workflow:handoffs:v2']['1688:legacy-source'])),
  JSON.parse(JSON.stringify(migratedLegacy)),
  'an exact legacy handoff should migrate once into the bounded V2 identity map',
);

function makeHandoff(index, platform = '1688') {
  return context.handoffApi.createSourceWorkflowHandoff({
    supplyGoodsId: `goods-${index}`,
    snapshotId: `snapshot-${index}`,
    snapshotVersion: index,
  }, `source-${index}`, platform);
}

resetPersistedHandoffs();
const concurrentHandoffs = [makeHandoff(1, '1688'), makeHandoff(2, 'pdd')];
await Promise.all(concurrentHandoffs.map((candidate) => context.handoffApi.persistSourceWorkflowHandoff(candidate)));
assert.deepEqual(
  Object.keys(stored['ss-erp:source-workflow:handoffs:v2']).sort(),
  ['1688:source-1', 'pdd:source-2'],
  'concurrent tab writes should retain both platform/product handoffs',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(stored['ss-erp:source-workflow:last-handoff:v1'])),
  JSON.parse(JSON.stringify(concurrentHandoffs[1])),
  'the serialization queue should preserve invocation order for the latest compatibility handoff',
);

resetPersistedHandoffs();
const batchHandoffs = [makeHandoff(3), makeHandoff(4), makeHandoff(5)];
const persistedBatch = await context.handoffApi.persistSourceWorkflowHandoffs(batchHandoffs);
assert.equal(persistedBatch.length, 3);
assert.deepEqual(
  Object.keys(stored['ss-erp:source-workflow:handoffs:v2']),
  ['1688:source-3', '1688:source-4', '1688:source-5'],
  'one V2 collection batch should retain every successful handoff',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(stored['ss-erp:source-workflow:last-handoff:v1'])),
  JSON.parse(JSON.stringify(batchHandoffs[2])),
  'the final batch item should remain available through the latest compatibility key',
);

resetPersistedHandoffs();
const oversizedBatch = Array.from({ length: 21 }, (_, index) => makeHandoff(index + 1));
await context.handoffApi.persistSourceWorkflowHandoffs(oversizedBatch);
const boundedIdentities = Object.keys(stored['ss-erp:source-workflow:handoffs:v2']);
assert.equal(boundedIdentities.length, 20, 'handoff history should remain bounded to 20 records');
assert.equal(boundedIdentities.includes('1688:source-1'), false, 'the oldest handoff should be evicted at the limit');
assert.equal(boundedIdentities.includes('1688:source-2'), true, 'the second-oldest handoff should remain after one eviction');
assert.equal(boundedIdentities.includes('1688:source-21'), true, 'the newest handoff should remain after pruning');
assert.deepEqual(
  JSON.parse(JSON.stringify(stored['ss-erp:source-workflow:last-handoff:v1'])),
  JSON.parse(JSON.stringify(oversizedBatch[20])),
  'bounded pruning must not change the latest compatibility handoff',
);

assert.equal(
  context.handoffApi.buildConfiguredSourceWorkflowUrl('http://127.0.0.1:3001/api/collect', handoff),
  `http://127.0.0.1:3000${handoff.path}`,
);
assert.equal(
  context.handoffApi.buildConfiguredSourceWorkflowUrl('http://localhost:3001/api/collect?mode=local#api', handoff),
  `http://localhost:3000${handoff.path}`,
);
assert.equal(
  context.handoffApi.buildConfiguredSourceWorkflowUrl('https://erp.example:8443/api/collect?mode=cloud#api', handoff),
  `https://erp.example:8443${handoff.path}`,
);
context.SS_ERP_DEPLOYMENT_DEFAULTS = {
  target: 'cloud',
  erpBaseUrl: 'https://app.ss-erp.com',
  erpAdminBaseUrl: 'https://admin.ss-erp.com',
  erpApiBaseUrl: 'https://ss-erp.com',
};
assert.equal(
  context.handoffApi.buildConfiguredSourceWorkflowUrl('', handoff),
  `https://app.ss-erp.com${handoff.path}`,
  'a fresh cloud package must use its signed Web origin when mutable runtime storage is empty',
);
assert.equal(
  context.handoffApi.buildConfiguredSourceWorkflowUrl('http://127.0.0.1:3001', handoff),
  `https://app.ss-erp.com${handoff.path}`,
  'a cloud package must ignore a stale local endpoint when opening its ERP workflow',
);
stored['ss-erp:source-workflow:last-handoff:v1'] = { ...handoff, path: 'https://attacker.example/' };
assert.equal(await context.handoffApi.readPersistedSourceWorkflowHandoff(), null);
context.SS_ERP_DEPLOYMENT_DEFAULTS = { target: 'source' };
assert.throws(
  () => context.handoffApi.buildConfiguredSourceWorkflowUrl('javascript:alert(1)', handoff),
  /ERP 地址无效/,
);

console.log('PASS extension source workflow handoff contract');
