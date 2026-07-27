import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/readiness-handle-cache.js';
const source = readFileSync(modulePath, 'utf8');
const context = { Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Set, String, URL, Uint8Array };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: modulePath });
const api = context.SS_ERP_BYOK_READINESS_HANDLE_CACHE;
let now = new Date('2026-07-25T15:00:00.000Z');
let randomByte = 1;
const cache = api.createCache({
  now: () => now,
  randomValues(bytes) {
    bytes.fill(randomByte);
    randomByte += 1;
    return bytes;
  },
});

function binding(overrides = {}) {
  return {
    contractVersion: api.BINDING_VERSION,
    ownerUserId: 'owner-1',
    deviceSessionId: 'session-1',
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
    policyRevision: '734',
    ...overrides,
  };
}

function draftBinding(slotKey, overrides = {}) {
  return binding({
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    sourcePlatform: '1688',
    sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: 'sku-1',
    slotKey,
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    ...overrides,
  });
}

function attestation(overrides = {}) {
  return {
    contractVersion: api.ATTESTATION_VERSION,
    authenticated: true,
    expiresAt: new Date(now.getTime() + (5 * 60 * 1000)).toISOString(),
    binding: binding(),
    decision: {
      allowed: true,
      providerOrigin: 'https://relay.example',
      policyRevision: 734,
      maxConcurrency: 2,
    },
    ...overrides,
  };
}

const issued = cache.issue(attestation());
assert.match(issued.readinessHandle, /^rh_[a-f0-9]{48}$/u);
assert.equal(Object.isFrozen(issued.concurrencyAuthority), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(issued.concurrencyAuthority)),
  { policyRevision: '734', maxConcurrency: 2 },
);
assert.equal(
  JSON.stringify(issued).includes('concurrencyAuthority'),
  false,
  'server concurrency authority stays background-only across runtime serialization',
);
assert.equal(cache.size(), 1);
const verification = cache.consume({
  handle: issued.readinessHandle,
  expectedBinding: issued.readinessBinding,
  messageType: 'ss-erp:byok-provider-permission-request',
  senderSurface: 'ai_provider_settings',
});
assert.equal(verification.contractVersion, api.VERIFICATION_VERSION);
assert.equal(verification.handleId, issued.readinessHandle);
assert.deepEqual(JSON.parse(JSON.stringify(verification.concurrencyAuthority)), {
  policyRevision: '734', maxConcurrency: 2,
});
assert.equal(JSON.stringify(verification).includes('concurrencyAuthority'), false);
await assert.rejects(
  async () => cache.consume({ handle: issued.readinessHandle, expectedBinding: issued.readinessBinding }),
  /UNAVAILABLE/u,
  'the public handle is one-use even while its verified permission decision is pending',
);
const bridge = cache.createPermissionBridge(verification);
assert.deepEqual(
  JSON.parse(JSON.stringify(bridge.consume(
    issued.readinessHandle,
    issued.readinessBinding,
    'https://relay.example',
  ))),
  {
    allowed: true,
    providerOrigin: 'https://relay.example',
    policyRevision: 734,
    maxConcurrency: 2,
  },
);
assert.throws(
  () => bridge.consume(issued.readinessHandle, issued.readinessBinding, 'https://relay.example'),
  /UNAVAILABLE/u,
  'the synchronous permission bridge is one-use',
);
assert.equal(cache.size(), 0);

for (const slotKey of [
  'sku:sku-1:hero',
  'shared:detail:SCENE',
  'shared:detail:DETAIL',
  'shared:detail:SPEC',
  'shared:detail:PACKAGING',
]) {
  const slotAttestation = cache.issue(attestation({ binding: draftBinding(slotKey) }));
  const slotVerification = cache.consume({
    handle: slotAttestation.readinessHandle,
    expectedBinding: slotAttestation.readinessBinding,
  });
  assert.equal(slotVerification.binding.slotKey, slotKey);
  cache.clear();
}

const mismatch = cache.issue(attestation());
assert.throws(
  () => cache.consume({
    handle: mismatch.readinessHandle,
    expectedBinding: binding({ model: 'different-model' }),
  }),
  /UNAVAILABLE/u,
);
assert.equal(cache.size(), 0, 'a mismatched attempt burns the handle');

assert.throws(
  () => cache.issue(attestation({
    expiresAt: new Date(now.getTime() + (10 * 60 * 1000) + 1).toISOString(),
  })),
  /INVALID/u,
);
const expired = cache.issue(attestation());
now = new Date(now.getTime() + (5 * 60 * 1000) + 1);
assert.throws(
  () => cache.consume({ handle: expired.readinessHandle, expectedBinding: expired.readinessBinding }),
  /UNAVAILABLE/u,
);
assert.equal(cache.size(), 0);

for (const invalid of [
  attestation({ authenticated: false }),
  attestation({
    decision: {
      allowed: true,
      providerOrigin: 'https://other.example',
      policyRevision: 734,
      maxConcurrency: 2,
    },
  }),
  attestation({
    decision: {
      allowed: true,
      providerOrigin: 'https://relay.example',
      policyRevision: 734,
      maxConcurrency: 0,
    },
  }),
  attestation({ binding: binding({ policyRevision: '735' }) }),
  attestation({ binding: binding({ workflowId: 'workflow-1' }) }),
  attestation({ binding: draftBinding('sku:sku-1:detail:1') }),
  attestation({ binding: draftBinding('group:visual-1:detail:SCENE') }),
  attestation({ binding: draftBinding('shared:detail:FUNCTION') }),
  attestation({ binding: draftBinding('shared:detail:SPECIFICATION') }),
  attestation({ binding: draftBinding('shared:detail:scene') }),
  attestation({ binding: draftBinding('shared:detail:SCENE:extra') }),
  attestation({
    binding: draftBinding('shared:detail:SCENE', { assignmentMode: 'REPLACE' }),
  }),
]) {
  assert.throws(() => cache.issue(invalid), /INVALID/u);
}

cache.clear();
assert.equal(cache.size(), 0);
console.log('extension BYOK readiness handle cache tests passed');
