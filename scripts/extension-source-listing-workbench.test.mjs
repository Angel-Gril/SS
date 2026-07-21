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
assert.match(worker, /readPersistedSourceWorkflowHandoff\(platform, sourceProductId\)/);
assert.match(worker, /handoff\.sourceProductId/);
assert.match(policy, /ss-erp:source-listing-workbench-status/);
assert.match(panel, /data-role=["']source-listing-workbench["']/);
assert.match(panel, /SS_ERP_SOURCE_LISTING_WORKBENCH/);
assert.match(panel, /sourceWorkbenchRequestSeq/);
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
  Set, String, TextDecoder, TextEncoder, Uint8Array, clearTimeout, setTimeout,
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
      scopes: ['listing:review'], accessToken: 'device-access-token',
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
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
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

const approvedContainer = new TestNode('section');
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
});
assert.match(renderedText(approvedContainer), /参考改图 · 审核通过，等待应用/u);

const failedContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(failedContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [{
        operation: 'FULL_EDIT', status: 'FAILED', reviewStatus: 'NOT_READY',
        hasSelectedOutput: false, actionable: true,
      }],
    },
  },
});
assert.match(renderedText(failedContainer), /全图编辑 · 处理失败，请在 ERP 检查/u);
assert.doesNotMatch(renderedText(failedContainer), /可重试/u);

console.log('PASS extension source listing workbench contract');
