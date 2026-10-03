import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js', 'utf8');
const context = { AbortController, Array, Boolean, Date, Error, JSON, Number, Object, Set, String, TextDecoder, TextEncoder,
  Uint8Array, clearTimeout, crypto: globalThis.crypto, setTimeout, URL };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'source-workflow-device-session.js' });
const credentials = {
  async beginOperation() { return { state: 'paired', epoch: 1, baseUrl: 'https://erp.example', scopes: ['listing:review'], accessToken: 'access' }; },
  async isOperationCurrent() { return true; },
};
const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
const transport = (payload, contentLength) => context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({ credentials,
  fetchImpl: async () => ({ status: 200, ok: true, headers: { get(name) { return name.toLowerCase() === 'content-length' ? String(contentLength) : null; } }, async text() { return payload; } }),
});
const accepted = JSON.stringify({ code: 1, data: { padding: 'x'.repeat(1_500_000) } });
const response = await transport(accepted, accepted.length).post('/api/extension-device/source-workbench/editor/catalog', { binding, query: '' }, { requiredScope: 'listing:review' });
assert.equal(response.state, 'response');
const rejected = transport('', 2 * 1024 * 1024 + 1);
await assert.rejects(rejected.post('/api/extension-device/source-workbench/editor/catalog', { binding, query: '' }, { requiredScope: 'listing:review' }), /response is too large/u);
console.log('category response bounds: 2MiB accepted, over-limit rejected');
