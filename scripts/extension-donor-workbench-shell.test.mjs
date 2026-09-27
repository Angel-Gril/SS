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
      facts: { title: 'Storage box', selectedSkuKey: 'sku-blue' },
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
      listing: {
        items: [{
          id: 'draft-1', shopId: 'shop-1', stage: 'MEDIA_REVIEW', status: 'ACTIVE',
          runState: 'ACTIVE', revision: 2, draftVersion: 3, selectedSkuCount: 2,
          mediaAssignmentCount: 0, blockerCount: 0, warningCount: 0,
          blockers: [], warnings: [], updatedAt: '2026-09-27T08:00:00.000Z',
        }],
        truncated: false,
      },
      media: {
        items: [{
          id: 'media-task-1', operation: 'FULL_EDIT', status: 'FAILED',
          reviewStatus: 'NOT_READY', revision: 5, actionable: true,
          allowedActions: ['RETRY'],
          commandContext: {
            shopId: 'must-not-leak', listingWorkflowId: 'must-not-leak',
            draftRevision: 2, draftVersion: 3,
          },
          updatedAt: '2026-09-27T08:02:00.000Z',
        }],
        actionableCount: 1,
      },
    },
  },
  history: {
    state: 'ready',
    listingWorkflowId: 'draft-1',
    error: '',
    context: {
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
      listingWorkflowId: 'draft-1', revision: 2, draftVersion: 3,
    },
    items: [{
      id: 'media-1', operation: 'IMAGE_TO_IMAGE', status: 'SUCCEEDED',
      reviewStatus: 'PENDING', revision: 4, contextSkuKey: 'sku-blue',
      contextSlotKey: 'sku:sku-blue:hero', selectedOutputAssetId: 'asset-1',
      outputs: [{
        id: 'asset-1', url: 'https://cdn.example/output.png', mimeType: 'image/png',
        width: 900, height: 1200,
      }],
      application: null,
      createdAt: '2026-09-27T08:00:00.000Z', updatedAt: '2026-09-27T08:01:00.000Z',
    }],
    nextCursor: null,
    receipt: null,
  },
  billing: {
    state: 'ready', listingWorkflowId: 'draft-1', error: '',
    projection: {
      contractVersion: 'extension-ai-image-suite-projection/v1',
      context: {
        snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
        listingWorkflowId: 'draft-1', draftRevision: 2, draftVersion: 3,
      },
      plan: {
        id: 'must-not-leak-plan-id',
        preview: {
          pricingVersion: 'must-not-leak-pricing-version', currency: 'CNY', itemCount: 2,
          estimatedCostCents: 28, maximumCostCents: 28,
        },
      },
      suite: {
        id: 'must-not-leak-suite-id', status: 'SUCCEEDED',
        slots: [{
          id: 'must-not-leak-slot-id', slotKey: 'sku:sku-blue:hero', goal: '商品主图',
          status: 'SUCCEEDED',
          billing: {
            mode: 'ERP_HOSTED', currency: 'CNY',
            estimatedCostMinor: 14, maximumCostMinor: 14,
            reservationStatus: 'SETTLED',
            settlement: { kind: 'CHARGE', actualCostMinor: 14, billedUnits: 1 },
          },
        }, {
          id: 'must-not-leak-slot-id-2', slotKey: 'sku:sku-blue:detail-1', goal: '商品细节图',
          status: 'CANCELLED',
          billing: {
            mode: 'ERP_HOSTED', currency: 'CNY',
            estimatedCostMinor: 14, maximumCostMinor: 14,
            reservationStatus: 'RELEASED',
            settlement: { kind: 'RELEASE', actualCostMinor: null, billedUnits: 0 },
          },
        }],
      },
    },
  },
  busy: false,
  error: '',
});
assert.equal(projection.source.sourceProductId, '9901');
assert.equal(projection.source.preferredSkuKey, 'sku-blue');
assert.deepEqual(Array.from(projection.skus, (item) => item.key), ['sku-white', 'sku-blue']);
assert.deepEqual(Array.from(projection.media, (item) => item.key), ['media-main']);
assert.deepEqual(JSON.parse(JSON.stringify(projection.shops)), [{ id: 'shop-1', name: 'DOTH', status: 'ACTIVE' }]);
assert.equal(JSON.stringify(projection).includes('must-not-leak'), false);
assert.deepEqual(JSON.parse(JSON.stringify(projection.workbench.status.media.items[0])), {
  id: 'media-task-1', operation: 'FULL_EDIT', status: 'FAILED',
  reviewStatus: 'NOT_READY', revision: 5, actionable: true,
  allowedActions: ['RETRY'], updatedAt: '2026-09-27T08:02:00.000Z',
});
assert.equal(projection.history.state, 'ready');
assert.equal(projection.history.items[0].outputs[0].id, 'asset-1');
assert.equal(projection.history.items[0].outputs[0].url, 'https://cdn.example/output.png');
assert.deepEqual(JSON.parse(JSON.stringify(projection.billing)), {
  state: 'ready', listingWorkflowId: 'draft-1', error: '', executionMode: 'ERP_HOSTED',
  quote: {
    currency: 'CNY', itemCount: 2, estimatedCostMinor: 28, maximumCostMinor: 28,
  },
  suite: {
    status: 'SUCCEEDED',
    slots: [{
      slotKey: 'sku:sku-blue:hero', goal: '商品主图', status: 'SUCCEEDED',
      billing: {
        mode: 'ERP_HOSTED', currency: 'CNY', estimatedCostMinor: 14, maximumCostMinor: 14,
        reservationStatus: 'SETTLED',
        settlement: { kind: 'CHARGE', actualCostMinor: 14, billedUnits: 1 },
      },
    }, {
      slotKey: 'sku:sku-blue:detail-1', goal: '商品细节图', status: 'CANCELLED',
      billing: {
        mode: 'ERP_HOSTED', currency: 'CNY', estimatedCostMinor: 14, maximumCostMinor: 14,
        reservationStatus: 'RELEASED',
        settlement: { kind: 'RELEASE', actualCostMinor: null, billedUnits: 0 },
      },
    }],
  },
});
assert.equal(JSON.stringify(projection.billing).includes('must-not-leak'), false);
const promptAdapterSource = fs.readFileSync('extensions/ss-erp/shared/donor-workbench/prompt-adapter.js', 'utf8');
assert.match(promptAdapterSource, /SS_ERP_DONOR_PROMPT_ADAPTER/u);
const reparsed = contract.parseProjection({
  ...JSON.parse(JSON.stringify(projection)),
  media: [{ key: 'unsafe', role: 'product_main', url: 'http://127.0.0.1/private.png', skuKeys: [] }],
  shops: [{ id: 'shop-1', name: 'DOTH', status: 'ACTIVE', clientId: 'must-not-leak' }],
});
assert.equal(reparsed.media.length, 0);
assert.equal(JSON.stringify(reparsed).includes('must-not-leak'), false);
const privateHistoryProjection = JSON.parse(JSON.stringify(projection));
privateHistoryProjection.history.items[0].outputs[0].url = 'https://127.0.0.1/private.png';
assert.equal(contract.parseProjection(privateHistoryProjection).history.items[0].outputs.length, 0);

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
    type: 'LOAD_BILLING',
    requestId: 'request-billing-1',
    listingWorkflowId: 'draft-1',
  }))),
  {
    contractVersion: contract.CONTRACT_VERSION,
    type: 'LOAD_BILLING',
    requestId: 'request-billing-1',
    listingWorkflowId: 'draft-1',
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(contract.parseFrameCommand({
    contractVersion: contract.CONTRACT_VERSION,
    type: 'OPEN_MEDIA_WORKBENCH',
    requestId: 'request-media-1',
    listingWorkflowId: 'draft-1',
    preferredSkuKey: 'sku-blue',
    sourceSelectionKey: null,
    choiceBinding: null,
    promptDraft: {
      contractVersion: 'ss-erp-donor-prompt-prefill/v1',
      prompt: '  Preserve the blue SKU.  ',
      negativePrompt: ' watermark ',
    },
  }))),
  {
    contractVersion: contract.CONTRACT_VERSION,
    type: 'OPEN_MEDIA_WORKBENCH',
    requestId: 'request-media-1',
    listingWorkflowId: 'draft-1',
    preferredSkuKey: 'sku-blue',
    sourceSelectionKey: null,
    choiceBinding: null,
    promptDraft: {
      contractVersion: 'ss-erp-donor-prompt-prefill/v1',
      prompt: 'Preserve the blue SKU.',
      negativePrompt: 'watermark',
    },
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(contract.parseFrameCommand({
    contractVersion: contract.CONTRACT_VERSION,
    type: 'LOAD_MEDIA_HISTORY',
    requestId: 'request-history-1',
    listingWorkflowId: 'draft-1',
  }))),
  {
    contractVersion: contract.CONTRACT_VERSION,
    type: 'LOAD_MEDIA_HISTORY',
    requestId: 'request-history-1',
    listingWorkflowId: 'draft-1',
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(contract.parseFrameCommand({
    contractVersion: contract.CONTRACT_VERSION,
    type: 'PREPARE_MEDIA_MUTATION',
    requestId: 'request-review-1',
    listingWorkflowId: 'draft-1',
    mediaWorkflowId: 'media-1',
    outputAssetId: 'asset-1',
    expectedRevision: 4,
    action: 'REVIEW_APPROVE',
  }))),
  {
    contractVersion: contract.CONTRACT_VERSION,
    type: 'PREPARE_MEDIA_MUTATION',
    requestId: 'request-review-1',
    listingWorkflowId: 'draft-1',
    mediaWorkflowId: 'media-1',
    outputAssetId: 'asset-1',
    expectedRevision: 4,
    action: 'REVIEW_APPROVE',
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(contract.parseFrameCommand({
    contractVersion: contract.CONTRACT_VERSION,
    type: 'EXECUTE_MEDIA_TASK',
    requestId: 'request-task-1',
    mediaWorkflowId: 'media-task-1',
    expectedRevision: 5,
    action: 'RETRY',
  }))),
  {
    contractVersion: contract.CONTRACT_VERSION,
    type: 'EXECUTE_MEDIA_TASK',
    requestId: 'request-task-1',
    mediaWorkflowId: 'media-task-1',
    expectedRevision: 5,
    action: 'RETRY',
  },
);
for (const invalid of [
  { contractVersion: contract.CONTRACT_VERSION, type: 'CREATE_DRAFT', requestId: 'r', shopId: 'shop-1', selectedSkuKeys: [] },
  { contractVersion: contract.CONTRACT_VERSION, type: 'CREATE_DRAFT', requestId: 'r', shopId: 'shop-1', selectedSkuKeys: ['sku-white'], ownerUserId: 'forged' },
  {
    contractVersion: contract.CONTRACT_VERSION, type: 'OPEN_MEDIA_WORKBENCH', requestId: 'r',
    listingWorkflowId: 'draft-1', preferredSkuKey: 'sku-blue', sourceSelectionKey: null,
    choiceBinding: null,
    promptDraft: { contractVersion: 'ss-erp-donor-prompt-prefill/v1', prompt: '', negativePrompt: '' },
  },
  {
    contractVersion: contract.CONTRACT_VERSION, type: 'EXECUTE_MEDIA_TASK', requestId: 'r',
    mediaWorkflowId: 'media-task-1', expectedRevision: 5, action: 'CONTINUE',
  },
  {
    contractVersion: contract.CONTRACT_VERSION, type: 'PREPARE_MEDIA_MUTATION', requestId: 'r',
    listingWorkflowId: 'draft-1', mediaWorkflowId: 'media-1', outputAssetId: 'asset-1',
    expectedRevision: 4, action: 'PUBLISH',
  },
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
assert.match(bridge, /ss-erp:source-listing-workbench-media-history/);
assert.match(bridge, /ss-erp:source-listing-workbench-media-confirm-prepare/);
assert.match(bridge, /ss-erp:source-listing-workbench-media-confirmed/);
assert.match(bridge, /ss-erp:source-listing-workbench-media-command/);
assert.match(bridge, /ss-erp:source-listing-workbench-ai-image-suite/);
assert.doesNotMatch(bridge, /currentBilling\s*=\s*currentProjection\.billing/u);
assert.match(bridge, /type:\s*'spb-self-hosted:get-ozon-shops',\s*deviceOnly:\s*true/u);
assert.match(bridge, /response\.result\.state\s*===\s*'choice_required'/);
assert.match(bridge, /preferredSkuKey:\s*command\.preferredSkuKey/);
assert.match(bridge, /choiceBinding:\s*response\.result\.binding/);
assert.match(bridge, /promptDraft:\s*command\.promptDraft/);
assert.match(bridge, /hostname\.includes\('tmall\.com'\)\) return 'tmall'/);
assert.match(bridge, /if \(wasOpen\) document\.documentElement\.style\.overflow = pageOverflow/);

const page = fs.readFileSync(pagePath, 'utf8');
const pageScript = fs.readFileSync(pageScriptPath, 'utf8');
assert.match(page, /source-workbench-shell\.css/);
assert.match(page, /shared\/donor-workbench\/workspace-contract\.js/);
assert.match(page, /source-workbench-shell\.js/);
assert.match(page, /data-action="open-ai-workbench"/);
assert.match(page, /data-role="prompt-text"/);
assert.match(page, /data-role="negative-prompt-text"/);
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
