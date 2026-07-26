import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/readiness-client.js';
const source = readFileSync(modulePath, 'utf8');
const context = { Array, Boolean, Error, Number, Object, String, URL };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: modulePath });
const api = context.SS_ERP_BYOK_READINESS_CLIENT;

const posts = [];
const issued = [];
const attestation = {
  contractVersion: 'extension-byok-readiness-attestation/v2',
  authenticated: true,
  expiresAt: '2026-07-25T15:05:00.000Z',
  binding: { contractVersion: 'extension-byok-readiness-binding/v2' },
  decision: { allowed: true },
};
const client = api.createClient({
  transport: {
    async post(path, body, options) {
      posts.push({ path, body, options });
      return { state: 'response', status: 200, body: { code: 1, data: attestation } };
    },
  },
  profileStore: {
    async getProfile(id) {
      return id === 'profile-1' ? {
        id,
        baseUrl: 'https://relay.example/v1',
        model: 'image-model-v1',
        allowedOperations: ['TEXT_TO_IMAGE'],
      } : null;
    },
  },
  profileSchema: {
    canonicalizeEndpoint(value) { return value; },
  },
  handleCache: {
    issue(value) {
      issued.push(value);
      return { readinessHandle: 'rh_1', readinessBinding: { providerOrigin: 'https://relay.example' } };
    },
  },
});

const result = await client.getReadiness({
  profileId: 'profile-1',
  shopId: 'shop-1',
  workflowId: null,
  draftRevision: null,
  draftVersion: null,
  operation: 'TEXT_TO_IMAGE',
});
assert.equal(result.readinessHandle, 'rh_1');
assert.deepEqual(JSON.parse(JSON.stringify(posts)), [{
  path: api.READINESS_PATH,
  body: {
    contractVersion: api.REQUEST_VERSION,
    shopId: 'shop-1',
    workflowId: null,
    draftRevision: null,
    draftVersion: null,
    sourcePlatform: null,
    sourceProductId: null,
    sourceCaptureSnapshotId: null,
    supplyGoodsId: null,
    skuKey: null,
    slotKey: null,
    assignmentMode: null,
    assignmentOrdinal: null,
    providerOrigin: 'https://relay.example',
    model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE',
  },
  options: { requiredScope: 'byok:media:ingest' },
}]);
assert.equal(issued[0], attestation);

for (const invalid of [
  { profileId: 'profile-1', shopId: 'shop-1', workflowId: null, draftRevision: 1, draftVersion: null, operation: 'TEXT_TO_IMAGE' },
  { profileId: 'profile-1', shopId: 'shop-1', workflowId: null, draftRevision: null, draftVersion: null, operation: 'INPAINT' },
  { profileId: 'missing', shopId: 'shop-1', workflowId: null, draftRevision: null, draftVersion: null, operation: 'TEXT_TO_IMAGE' },
  { profileId: 'profile-1', shopId: 'shop-1', workflowId: null, draftRevision: null, draftVersion: null, operation: 'TEXT_TO_IMAGE', providerOrigin: 'https://evil.example' },
]) {
  await assert.rejects(client.getReadiness(invalid), Error);
}
assert.equal(posts.length, 1, 'invalid or page-injected Provider authority must fail before ERP I/O');

let cleared = 0;
const unpaired = api.createClient({
  transport: { async post() { return { state: 'unpaired' }; } },
  profileStore: { async getProfile() { return { baseUrl: 'https://relay.example', model: 'm', allowedOperations: ['TEXT_TO_IMAGE'] }; } },
  profileSchema: { canonicalizeEndpoint(value) { return value; } },
  handleCache: { issue() { throw new Error('must not issue'); }, clear() { cleared += 1; } },
});
await assert.rejects(unpaired.getReadiness({
  profileId: 'profile-1', shopId: 'shop-1', workflowId: null,
  draftRevision: null, draftVersion: null, operation: 'TEXT_TO_IMAGE',
}), /UNAVAILABLE/u);
assert.equal(cleared, 1);

console.log('extension BYOK readiness client tests passed');
