import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const contractPath = `${root}/shared/donor-workbench/workspace-contract.js`;
const bridgePath = `${root}/content/donor-workbench-bridge.js`;
const bridgeCssPath = `${root}/content/donor-workbench-bridge.css`;
const pagePath = `${root}/pages/source-workbench-shell.html`;
const pageCssPath = `${root}/pages/source-workbench-shell.css`;
const pageScriptPath = `${root}/pages/source-workbench-shell.js`;

for (const path of [contractPath, bridgePath, bridgeCssPath, pagePath, pageCssPath, pageScriptPath]) {
  assert.equal(fs.existsSync(path), true, `${path} must exist`);
}

const sourceEntry = manifest.content_scripts.find((entry) => (
  Array.isArray(entry.js) && entry.js.includes('content/source-listing-workbench.js')
));
assert.ok(sourceEntry, 'source product content-script entry must exist');
assert.ok(sourceEntry.js.includes('shared/donor-workbench/workspace-contract.js'));
assert.ok(sourceEntry.js.includes('content/donor-workbench-bridge.js'));
assert.ok(sourceEntry.css.includes('content/donor-workbench-bridge.css'));
assert.ok(
  sourceEntry.js.indexOf('shared/donor-workbench/workspace-contract.js')
    < sourceEntry.js.indexOf('content/donor-workbench-bridge.js'),
  'the projection contract must load before the source bridge',
);

const shellResources = manifest.web_accessible_resources.find((entry) => (
  Array.isArray(entry.resources) && entry.resources.includes('pages/source-workbench-shell.html')
));
assert.ok(shellResources, 'the iframe shell must be web-accessible only on source origins');
for (const forbidden of ['<all_urls>', 'https://*/*', 'http://*/*']) {
  assert.equal(shellResources.matches.includes(forbidden), false);
}

const context = { Array, Boolean, Date, Error, JSON, Number, Object, Set, String, TypeError, URL };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
const contract = context.SS_ERP_DONOR_WORKBENCH_CONTRACT;
assert.ok(contract);
assert.equal(contract.CONTRACT_VERSION, 'ss-erp-donor-workbench/v1');

const projection = contract.createProjection({
  platform: '1688',
  product: {
    title: 'Storage box',
    productId: '9901',
    captureV2: {
      sourceIdentity: { productId: '9901', canonicalUrl: 'https://detail.1688.com/offer/9901.html' },
      sourceCategory: { name: 'Organizer', path: [{ name: 'Home' }, { name: 'Organizer' }] },
      skus: [
        { key: 'sku-white', selectors: [{ name: 'Color', value: 'White' }] },
        { key: 'sku-blue', selectors: [{ name: 'Color', value: 'Blue' }] },
      ],
      media: [
        { key: 'media-main', role: 'product_main', disposition: 'accepted', url: 'https://img.example/main.jpg', skuKeys: [] },
        { key: 'media-rejected', role: 'unknown', disposition: 'rejected', url: null, skuKeys: [] },
      ],
      facts: { title: 'Storage box' },
    },
  },
  shops: [{ id: 'shop-1', name: 'DOTH', status: 'ACTIVE', clientId: 'must-not-leak' }],
  handoff: {
    snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', sourceProductId: '9901', platform: '1688',
  },
  workbench: {
    state: 'ready',
    status: {
      snapshot: { current: true },
      listing: { items: [], truncated: false },
      media: { items: [], actionableCount: 0 },
    },
  },
  busy: false,
  error: '',
});
assert.equal(projection.source.sourceProductId, '9901');
assert.deepEqual(Array.from(projection.skus, (item) => item.key), ['sku-white', 'sku-blue']);
assert.deepEqual(Array.from(projection.media, (item) => item.key), ['media-main']);
assert.deepEqual(JSON.parse(JSON.stringify(projection.shops)), [{ id: 'shop-1', name: 'DOTH', status: 'ACTIVE' }]);
assert.equal(JSON.stringify(projection).includes('must-not-leak'), false);
const reparsed = contract.parseProjection({
  ...JSON.parse(JSON.stringify(projection)),
  media: [{ key: 'unsafe', role: 'product_main', url: 'http://127.0.0.1/private.png', skuKeys: [] }],
  shops: [{ id: 'shop-1', name: 'DOTH', status: 'ACTIVE', clientId: 'must-not-leak' }],
});
assert.equal(reparsed.media.length, 0);
assert.equal(JSON.stringify(reparsed).includes('must-not-leak'), false);

assert.deepEqual(
  JSON.parse(JSON.stringify(contract.parseFrameCommand({
    contractVersion: contract.CONTRACT_VERSION,
    type: 'CREATE_DRAFT',
    requestId: 'request-1',
    shopId: 'shop-1',
    selectedSkuKeys: ['sku-white', 'sku-blue'],
  }))),
  {
    contractVersion: contract.CONTRACT_VERSION,
    type: 'CREATE_DRAFT',
    requestId: 'request-1',
    shopId: 'shop-1',
    selectedSkuKeys: ['sku-white', 'sku-blue'],
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(contract.parseFrameCommand({
    contractVersion: contract.CONTRACT_VERSION,
    type: 'OPEN_MEDIA_WORKBENCH',
    requestId: 'request-media-1',
    listingWorkflowId: 'draft-1',
    preferredSkuKey: null,
    sourceSelectionKey: null,
    choiceBinding: null,
  }))),
  {
    contractVersion: contract.CONTRACT_VERSION,
    type: 'OPEN_MEDIA_WORKBENCH',
    requestId: 'request-media-1',
    listingWorkflowId: 'draft-1',
    preferredSkuKey: null,
    sourceSelectionKey: null,
    choiceBinding: null,
  },
);
for (const invalid of [
  { contractVersion: contract.CONTRACT_VERSION, type: 'CREATE_DRAFT', requestId: 'r', shopId: 'shop-1', selectedSkuKeys: [] },
  { contractVersion: contract.CONTRACT_VERSION, type: 'CREATE_DRAFT', requestId: 'r', shopId: 'shop-1', selectedSkuKeys: ['sku-white'], ownerUserId: 'forged' },
  { contractVersion: contract.CONTRACT_VERSION, type: 'PUBLISH', requestId: 'r' },
]) {
  assert.throws(() => contract.parseFrameCommand(invalid));
}

const bridge = fs.readFileSync(bridgePath, 'utf8');
assert.match(bridge, /ss-erp:donor-workbench-preview-enabled/);
assert.match(bridge, /enabled\s*!==\s*true/);
assert.match(bridge, /event\.source\s*!==\s*frame\.contentWindow/);
assert.match(bridge, /event\.origin\s*!==\s*extensionOrigin/);
assert.match(bridge, /allowedShopIds\.has\(command\.shopId\)/);
assert.match(bridge, /allowedSkuKeys\.has\(skuKey\)/);
assert.match(bridge, /ss-erp:source-listing-workbench-draft-create/);
assert.match(bridge, /ss-erp:source-ai-workbench-open/);
assert.match(bridge, /hostname\.includes\('tmall\.com'\)\) return 'tmall'/);
assert.match(bridge, /if \(wasOpen\) document\.documentElement\.style\.overflow = pageOverflow/);

const page = fs.readFileSync(pagePath, 'utf8');
const pageScript = fs.readFileSync(pageScriptPath, 'utf8');
assert.match(page, /source-workbench-shell\.css/);
assert.match(page, /shared\/donor-workbench\/workspace-contract\.js/);
assert.match(page, /source-workbench-shell\.js/);
assert.match(page, /data-action="open-ai-workbench"/);
assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)/i);
assert.doesNotMatch(pageScript, /chrome\.runtime/);

const migratedText = [contractPath, bridgePath, pagePath, pageCssPath, pageScriptPath]
  .map((path) => fs.readFileSync(path, 'utf8'))
  .join('\n');
for (const forbidden of [
  /api[_-]?key\s*[:=]/i,
  /client[_-]?secret\s*[:=]/i,
  /chrome\.debugger/i,
  /api\.ozon\.ru/i,
  /Authorization\s*:/i,
  /https:\/\/\*\/\*/i,
]) {
  assert.doesNotMatch(migratedText, forbidden);
}

console.log('PASS extension donor workbench shell contract');
