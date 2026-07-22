import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const worker = fs.readFileSync(`${root}/background/service-worker.js`, 'utf8');
const panel = fs.readFileSync(`${root}/content/source-costing-panel.js`, 'utf8');
const popup = fs.readFileSync(`${root}/pages/popup.js`, 'utf8');
const policy = fs.readFileSync(`${root}/shared/message-security/runtime-message-policy.js`, 'utf8');
const sessionPath = `${root}/shared/erp-adapter/source-workflow-device-session.js`;
const clientPath = `${root}/shared/erp-adapter/listing-workflow-client.js`;
const viewPath = `${root}/content/source-listing-workbench.js`;
const cssPath = `${root}/content/source-listing-workbench.css`;

for (const path of [sessionPath, clientPath, viewPath, cssPath]) {
  assert.equal(fs.existsSync(path), true, `${path} should exist`);
}

const sourceEntry = manifest.content_scripts.find((entry) => (
  entry.js?.includes('content/source-costing-panel.js')
));
assert.ok(sourceEntry, 'source costing content-script entry should exist');
assert.ok(sourceEntry.js.includes('content/source-listing-workbench.js'));
assert.ok(sourceEntry.js.indexOf('content/source-listing-workbench.js') < sourceEntry.js.indexOf('content/source-costing-panel.js'));
assert.ok(sourceEntry.css.includes('content/source-listing-workbench.css'));
assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-workflow-device-session\.js['"]\)/);
assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/listing-workflow-client\.js['"]\)/);
assert.match(worker, /ss-erp:source-listing-workbench-status/);
assert.match(worker, /ss-erp:source-listing-workbench-media-history/);
assert.match(worker, /ss-erp:source-listing-workbench-media-command/);
assert.match(worker, /readPersistedSourceWorkflowHandoff\(platform, sourceProductId\)/);
assert.match(worker, /handoff\.sourceProductId/);
assert.match(worker, /CREATE_TRANSLATION/);
assert.match(worker, /ss-erp:source-workbench:translation-intents:v1/);
assert.match(worker, /getOrCreateSourceTranslationIntent/);
assert.match(worker, /clearSourceTranslationIntent/);
assert.match(worker, /requestedListingWorkflowId/);
assert.match(worker, /sourceTranslationIntentWriteQueue/);
assert.match(worker, /SS_ERP_SOURCE_TRANSLATION_INTENT_TTL_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
assert.match(worker, /draftRevision: listing\.revision/);
assert.match(worker, /crypto\.getRandomValues/);
assert.match(policy, /ss-erp:source-listing-workbench-status/);
assert.match(policy, /ss-erp:source-listing-workbench-media-history/);
assert.match(policy, /ss-erp:source-listing-workbench-media-command/);
assert.match(panel, /data-role=["']source-listing-workbench["']/);
assert.match(panel, /SS_ERP_SOURCE_LISTING_WORKBENCH/);
assert.match(panel, /sourceWorkbenchRequestSeq/);
assert.match(panel, /listings\.length === 1/);
assert.match(panel, /currentSourcePageKey/);
assert.match(popup, /restoreSourceWorkflowHandoffForCurrentPage/);
assert.match(popup, /ss-erp:source-listing-workbench-status/);
assert.doesNotMatch(
  [worker, panel, fs.readFileSync(sessionPath, 'utf8'), fs.readFileSync(clientPath, 'utf8')].join('\n'),
  /legacyAccountToken|accountBearerToken|accountAccessToken|ozonApiKey|dashscopeApiKey/i,
);

const sessionSource = fs.readFileSync(sessionPath, 'utf8');
const clientSource = fs.readFileSync(clientPath, 'utf8');
const viewSource = fs.readFileSync(viewPath, 'utf8');
const context = {
  URL, URLSearchParams, AbortController, Array, Boolean, Date, Error, JSON, Number, Object,
  Set, String, TextDecoder, TextEncoder, Uint8Array, clearTimeout, crypto: globalThis.crypto, setTimeout,
};
context.globalThis = context;
vm.runInNewContext(sessionSource, context, { filename: sessionPath });
vm.runInNewContext(clientSource, context, { filename: clientPath });

const requests = [];
let current = true;
const credentials = {
  async beginOperation() {
    return {
      state: 'paired', epoch: 1, baseUrl: 'https://erp.example', sessionId: 'session-1',
      scopes: ['listing:review', 'media:execute'], accessToken: 'device-access-token',
    };
  },
  async isOperationCurrent() { return current; },
  async clearIfCurrent() { throw new Error('should not clear a valid device session'); },
};
const transport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials,
  fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return {
      status: 200,
      ok: true,
      headers: { get() { return null; } },
      async text() {
        return JSON.stringify({
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-7' },
            status: {
              contractVersion: 'extension-source-workbench-status/v1',
              snapshot: { id: 'snapshot-1', version: 1, capturedAt: '2026-07-21T00:00:00.000Z', current: true },
              listing: { items: [], truncated: false },
              media: { items: [], truncated: false, actionableCount: 0 },
            },
          },
        });
      },
    };
  },
});
const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport });
const status = await client.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' });
assert.equal(status.state, 'ready');
assert.equal(requests.length, 1);
assert.equal(
  requests[0].url,
  'https://erp.example/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
);
assert.equal(requests[0].init.headers.Authorization, 'Bearer device-access-token');
assert.equal(requests[0].init.credentials, 'omit');
assert.equal(requests[0].init.cache, 'no-store');
assert.equal(requests[0].init.signal instanceof AbortSignal, true);

const historyRequests = [];
const historyClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get(path, options) {
      historyRequests.push({ path, options });
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-history-1' },
            history: {
              contractVersion: 'extension-source-media-history/v1',
              context: {
                snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
                listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
              },
              snapshot: { id: 'snapshot-1', version: 4, capturedAt: '2026-07-21T00:00:00.000Z' },
              items: [{
                id: 'media-history-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
                reviewStatus: 'PENDING', revision: 2, contextSkuKey: null,
                contextSlotKey: 'hero', selectedOutputAssetId: 'asset-1',
                outputs: [{
                  id: 'asset-1', url: 'https://cdn.example/output.png', mimeType: 'image/png',
                  width: 900, height: 1200,
                }],
                application: null,
                createdAt: '2026-07-21T00:00:00.000Z',
                updatedAt: '2026-07-21T00:00:01.000Z',
              }],
              nextCursor: 'cursor-1',
            },
          },
        },
      };
    },
    async post() { throw new Error('history client must not POST'); },
  },
});
const history = await historyClient.getMediaHistory({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7, limit: 10,
});
assert.equal(history.state, 'ready');
assert.equal(history.history.items[0].outputs[0].url, 'https://cdn.example/output.png');
assert.equal(historyRequests[0].options.requiredScope, 'listing:review');
assert.match(historyRequests[0].path, /media-history\?/u);
assert.match(historyRequests[0].path, /listingWorkflowId=listing-1/u);

const invalidHistoryClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() {
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-history-1' },
            history: {
              contractVersion: 'extension-source-media-history/v1',
              context: {
                snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
                listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
              },
              snapshot: { id: 'snapshot-1', version: 4, capturedAt: '2026-07-21T00:00:00.000Z' },
              items: [{
                id: 'media-history-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
                reviewStatus: 'PENDING', revision: 2, contextSkuKey: null,
                contextSlotKey: null, selectedOutputAssetId: null,
                outputs: [{
                  id: 'secret', url: 'http://remote.example/private.png', mimeType: 'image/png',
                  width: 1, height: 1,
                }],
                application: null,
                createdAt: '2026-07-21T00:00:00.000Z',
                updatedAt: '2026-07-21T00:00:01.000Z',
              }],
              nextCursor: null,
            },
          },
        },
      };
    },
  },
});
await assert.rejects(
  invalidHistoryClient.getMediaHistory({
    snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
    listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
  }),
  /invalid source media history response/u,
);

const launchRequests = [];
const launchClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get(path) {
      launchRequests.push(path);
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: {
              enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
              revision: 'pilot-1', testOnly: true, operation: 'IMAGE_TRANSLATE',
              sourceLanguage: 'zh', targetLanguage: 'ru',
            },
            context: {
              id: 'listing-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
              snapshotId: 'snapshot-1', revision: 11, draftVersion: 7,
              sourceInputs: [{ sourceMediaKey: 'media-1' }],
              requested: {
                snapshotId: 'snapshot-1', listingWorkflowId: 'listing-1',
                revision: 11, draftVersion: 7,
              },
            },
          },
        },
      };
    },
    async post() { throw new Error('launch test must not POST'); },
  },
});
const launch = await launchClient.getMediaLaunch({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
});
assert.equal(launch.state, 'ready');
assert.match(launchRequests[0], /\/media-launch\?/u);
assert.match(launchRequests[0], /revision=11/u);
assert.match(launchRequests[0], /draftVersion=7/u);

const createRequests = [];
const createClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() { throw new Error('create test must not GET'); },
    async post(path, body, options) {
      createRequests.push({ path, body, options });
      if (path.endsWith('/command-grants')) {
        return {
          state: 'response', status: 201,
          body: { code: 1, data: { grantToken: 'g'.repeat(43) } },
        };
      }
      return {
        state: 'response', status: 202,
        body: {
          code: 1,
          data: {
            replay: false,
            receipt: {
              id: 'receipt-create-1', status: 'SUCCEEDED', failureCode: null,
              result: {
                workflowId: 'media-created', action: 'CREATE_TRANSLATION',
                operation: 'IMAGE_TRANSLATE', status: 'QUEUED', revision: 1,
              },
            },
          },
        },
      };
    },
  },
});
const createdTranslation = await createClient.createTranslationCommand({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
  sourceMediaKey: 'media-1', workflowOperationKey: 'intent-key-1',
  provider: 'openai', model: 'gpt-image-2', apiKey: 'must-not-be-sent',
  resolvedPrompt: 'must-not-be-sent',
});
assert.equal(createdTranslation.state, 'completed');
assert.equal(createRequests.length, 2);
assert.match(createRequests[0].body.idempotencyKey, /^extension-media-create:[a-f0-9]{64}$/u);
assert.equal(createRequests[1].options.commandGrant, 'g'.repeat(43));
assert.deepEqual(JSON.parse(JSON.stringify(createRequests[0].body.command)), {
  schemaVersion: 'ai-media-workflow-create/v1',
  action: 'CREATE_TRANSLATION',
  sourceMediaKey: 'media-1',
  draftRevision: 11,
  workflowOperationKey: 'intent-key-1',
});
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'provider'), false);
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'model'), false);
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'apiKey'), false);
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'resolvedPrompt'), false);

const darkLaunchClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() {
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: {
              enabled: false, ready: false, reasonCode: 'MEDIA_CREATE_DISABLED',
              reason: 'dark', revision: 'off', testOnly: true,
              operation: 'IMAGE_TRANSLATE', sourceLanguage: 'zh', targetLanguage: 'ru',
            },
            context: null,
          },
        },
      };
    },
    async post() { throw new Error('dark launch must not POST'); },
  },
});
assert.equal((await darkLaunchClient.getMediaLaunch({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
})).state, 'disabled');

const commandRequests = [];
const commandClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() { throw new Error('command test must not use GET'); },
    async post(path, body, options) {
      commandRequests.push({ path, body, options });
      if (path.endsWith('/command-grants')) {
        return {
          state: 'response', status: 201,
          body: {
            code: 1,
            data: { grantId: 'grant-1', grantToken: 'g'.repeat(43), expiresAt: '2026-07-21T00:01:00.000Z' },
          },
        };
      }
      return {
        state: 'response', status: 202,
        body: {
          code: 1,
          data: {
            replay: false,
            receipt: {
              id: 'receipt-1', status: 'SUCCEEDED', failureCode: null,
              result: { workflowId: 'media-1', action: 'RETRY', status: 'QUEUED', revision: 4 },
            },
          },
        },
      };
    },
  },
});
const mediaCommandInput = {
  action: 'RETRY', mediaWorkflowId: 'media-1', expectedRevision: 3,
  shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
};
const commandResult = await commandClient.executeMediaCommand(mediaCommandInput);
assert.equal(commandResult.state, 'completed');
assert.equal(commandRequests.length, 2);
assert.equal(commandRequests[0].path, '/api/extension-device/command-grants');
assert.equal(commandRequests[0].body.operation, 'MEDIA_EXECUTE');
assert.match(commandRequests[0].body.idempotencyKey, /^extension-media:[a-f0-9]{64}$/);
assert.equal(commandRequests[1].path, '/api/extension-device/media-workflows/execute');
assert.equal(commandRequests[1].body.idempotencyKey, commandRequests[0].body.idempotencyKey);
assert.equal(commandRequests[1].options.commandGrant, 'g'.repeat(43));
await commandClient.executeMediaCommand(mediaCommandInput);
assert.notEqual(
  commandRequests[2].body.idempotencyKey,
  commandRequests[0].body.idempotencyKey,
  'a failed or response-lost command must be retryable with a fresh attempt key',
);

const invalidClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() {
      return {
        state: 'response',
        status: 200,
        body: {
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-7' },
            status: {
              contractVersion: 'extension-source-workbench-status/v1',
              snapshot: { id: 'snapshot-1', version: 1, capturedAt: '2026-07-21T00:00:00.000Z', current: true },
              listing: { items: [], truncated: false },
              media: {
                items: [{
                  id: 'media-1', operation: 'IMAGE_TRANSLATE', status: 'RUNNING',
                  reviewStatus: 'NOT_READY', revision: 1, contextType: null, contextId: null,
                  contextSkuKey: null, contextSlotKey: null, hasSelectedOutput: false,
                  actionable: true, updatedAt: new Date('2026-07-21T00:00:00.000Z'),
                }],
                truncated: false,
                actionableCount: 1,
              },
            },
          },
        },
      };
    },
  },
});
await assert.rejects(
  invalidClient.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' }),
  /invalid source workbench status response/u,
);

const oversized = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials,
  fetchImpl: async () => ({
    status: 200,
    ok: true,
    headers: { get(name) { return name.toLowerCase() === 'content-length' ? '600000' : null; } },
    async text() { throw new Error('oversized response must be rejected before reading'); },
  }),
});
await assert.rejects(
  oversized.get('/api/extension-device/source-workbench/status'),
  /response is too large/u,
);

const timedOut = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials,
  requestTimeoutMs: 5,
  fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }),
});
await assert.rejects(
  timedOut.get('/api/extension-device/source-workbench/status'),
  /request timed out/u,
);

const credentialTimedOut = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    async beginOperation() { return new Promise(() => undefined); },
  },
  requestTimeoutMs: 5,
  fetchImpl: async () => { throw new Error('credential timeout must happen before status fetch'); },
});
await assert.rejects(
  credentialTimedOut.get('/api/extension-device/source-workbench/status'),
  /request timed out/u,
);

current = false;
await assert.rejects(
  client.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' }),
  /superseded/,
);

const unpaired = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: { async beginOperation() { return { state: 'unpaired', epoch: 1 }; } },
  fetchImpl: async () => { throw new Error('unpaired client must not fetch'); },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await unpaired.get('/api/extension-device/source-workbench/status'))),
  { state: 'unpaired' },
);

const supersededDuringClear = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    async beginOperation() {
      return {
        state: 'paired', baseUrl: 'https://erp.example', scopes: ['listing:review'],
        accessToken: 'old-token',
      };
    },
    async isOperationCurrent() { return true; },
    async clearIfCurrent() { return false; },
  },
  fetchImpl: async () => ({ status: 401, ok: false }),
});
await assert.rejects(
  supersededDuringClear.get('/api/extension-device/source-workbench/status'),
  /superseded/u,
);

class TestNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.hidden = true;
    this.disabled = false;
    this.attributes = {};
    this.listeners = {};
    this.classList = { add: (...names) => names.forEach((name) => { this.className += ` ${name}`; }) };
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  get firstChild() { return this.children[0] || null; }
}
const viewContext = {
  document: { createElement: (tag) => new TestNode(tag) },
  window: {},
};
vm.runInNewContext(viewSource, viewContext, { filename: viewPath });
const container = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(container, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [
        {
          operation: 'FULL_EDIT', status: 'CANCELLED', reviewStatus: 'NOT_READY',
          actionable: false,
        },
        {
          operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED', reviewStatus: 'PENDING',
          actionable: true,
        },
      ],
    },
  },
});
function renderedText(node) {
  return [node.textContent, ...node.children.map(renderedText)].filter(Boolean).join(' ');
}
const rendered = renderedText(container);
assert.equal(container.hidden, false);
assert.match(rendered, /前往 ERP 选择店铺和 SKU/u);
assert.match(rendered, /图片翻译 · 等待审核/u);
assert.doesNotMatch(rendered, /已取消|CANCELLED|PENDING/u);

const createContainer = new TestNode('section');
const createEvents = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(createContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  launch: {
    state: 'ready',
    capability: {
      enabled: true, ready: true, testOnly: true, operation: 'IMAGE_TRANSLATE',
    },
    context: {
      id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7,
      sourceInputs: [{ sourceMediaKey: 'media-1' }],
    },
  },
  sourceInputs: [{ sourceMediaKey: 'media-1', label: '主图 1' }],
  onCreateTranslation(source) { createEvents.push(source); },
});
assert.match(renderedText(createContainer), /图片翻译（测试）/u);
const createButton = createContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '翻译为俄文');
assert.ok(createButton);
createButton.listeners.click({ isTrusted: false });
assert.equal(createEvents.length, 0, 'scripted translation clicks must not launch work');
createButton.listeners.click({ isTrusted: true });
assert.equal(createEvents.length, 1);
assert.equal(createEvents[0].sourceMediaKey, 'media-1');

const darkCreateContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(darkCreateContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  launch: { state: 'disabled', capability: { enabled: false, ready: false } },
  sourceInputs: [{ sourceMediaKey: 'media-1', label: '主图 1' }],
  onCreateTranslation(source) { createEvents.push(source); },
});
assert.doesNotMatch(renderedText(darkCreateContainer), /图片翻译（测试）/u);

const multiListingContainer = new TestNode('section');
const selectedListings = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(multiListingContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: {
      items: [
        { id: 'listing-a', shopId: 'shop-a', revision: 1, draftVersion: 1 },
        { id: 'listing-b', shopId: 'shop-b', revision: 2, draftVersion: 3 },
      ],
    },
    media: { actionableCount: 0, items: [] },
  },
}, {
  launch: { state: 'ready', capability: { enabled: true, ready: true, testOnly: true, operation: 'IMAGE_TRANSLATE' }, context: null },
  sourceInputs: [{ sourceMediaKey: 'media-1', label: '主图 1' }],
  selectedListingWorkflowId: '',
  onSelectListing(id) { selectedListings.push(id); },
  onCreateTranslation() { throw new Error('must not create before selecting listing'); },
});
assert.match(renderedText(multiListingContainer), /请选择店铺草稿/u);
const listingSelect = multiListingContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.tag === 'select' && node.attributes['aria-label'] === '选择店铺草稿');
assert.ok(listingSelect);
listingSelect.value = 'listing-b';
listingSelect.listeners.change({ isTrusted: false });
assert.equal(selectedListings.length, 0);
listingSelect.listeners.change({ isTrusted: true });
assert.deepEqual(selectedListings, ['listing-b']);

const historyContainer = new TestNode('section');
const historyEvents = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(historyContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  selectedListingWorkflowId: 'listing-1',
  historyOpen: true,
  history: {
    context: { listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7 },
    items: [{
      id: 'history-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED', reviewStatus: 'PENDING',
      revision: 2, outputs: [{
        id: 'asset-1', url: 'https://cdn.example/output.png', mimeType: 'image/png', width: 900, height: 1200,
      }], application: null, updatedAt: '2026-07-21T00:00:01.000Z',
    }],
    nextCursor: 'next-1',
  },
  onLoadHistory() { historyEvents.push('load'); },
  onLoadMoreHistory() { historyEvents.push('more'); },
  onHistoryOpenChange(open) { historyEvents.push(open ? 'open' : 'close'); },
});
assert.match(renderedText(historyContainer), /图片结果与历史/u);
assert.match(renderedText(historyContainer), /图片翻译.*等待审核/u);
assert.match(renderedText(historyContainer), /900 × 1200/u);
const moreButton = historyContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '加载更多');
assert.ok(moreButton);
moreButton.listeners.click({ isTrusted: false });
assert.deepEqual(historyEvents, []);
moreButton.listeners.click({ isTrusted: true });
assert.deepEqual(historyEvents, ['more']);

const approvedContainer = new TestNode('section');
const reviewEvents = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(approvedContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [{
        operation: 'IMAGE_TO_IMAGE', status: 'SUCCEEDED', reviewStatus: 'APPROVED',
        hasSelectedOutput: true, actionable: true,
      }],
    },
  },
}, {
  onReview(task) { reviewEvents.push(task); },
});
assert.match(renderedText(approvedContainer), /参考改图 · 审核通过，等待应用/u);
assert.match(renderedText(approvedContainer), /在 ERP 审核/u);
const reviewButton = approvedContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '在 ERP 审核');
assert.ok(reviewButton);
reviewButton.listeners.click({ isTrusted: false });
assert.equal(reviewEvents.length, 0);
reviewButton.listeners.click({ isTrusted: true });
assert.equal(reviewEvents.length, 1);

const failedContainer = new TestNode('section');
const commands = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(failedContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [{
        operation: 'FULL_EDIT', status: 'FAILED', reviewStatus: 'NOT_READY',
        hasSelectedOutput: false, actionable: true, id: 'media-1', revision: 3,
        allowedActions: ['RETRY'],
        commandContext: {
          shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
        },
      }],
    },
  },
}, {
  onCommand(task, action) { commands.push({ task, action }); },
});
assert.match(renderedText(failedContainer), /全图编辑 · 处理失败/u);
assert.match(renderedText(failedContainer), /任务操作/u);
assert.match(renderedText(failedContainer), /重试/u);
const retryButton = failedContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '重试');
assert.ok(retryButton);
retryButton.listeners.click({ isTrusted: false });
assert.equal(commands.length, 0, 'scripted page clicks must not execute extension commands');
retryButton.listeners.click({ isTrusted: true });
assert.equal(commands.length, 1);
assert.equal(commands[0].action, 'RETRY');

console.log('PASS extension source listing workbench contract');
