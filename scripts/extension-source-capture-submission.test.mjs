import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE_PATH = 'extensions/ss-erp/shared/source-capture/source-capture-submit.js';

function loadApi() {
  assert.equal(fs.existsSync(SOURCE_PATH), true, 'source capture submit helper must exist');
  const context = { Array, Boolean, JSON, Number, Object, Promise, String };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(fs.readFileSync(SOURCE_PATH, 'utf8'), context, { filename: SOURCE_PATH });
  return context.SS_ERP_SOURCE_CAPTURE_SUBMIT;
}

function capture() {
  return {
    captureVersion: 'source-product-capture-v2',
    platform: '1688',
    sourceIdentity: { productId: '1000000000236' },
  };
}

function contract() {
  return {
    async createSourceProductCaptureV2Submission(value) {
      return {
        capture: value,
        captureHash: 'a'.repeat(64),
        payloadBytes: 12345,
      };
    },
    validateSourceProductCaptureV2Submission() {
      return { valid: true, errors: [] };
    },
  };
}

function pairedOperation() {
  return {
    state: 'paired',
    epoch: 1,
    baseUrl: 'https://erp.example',
    sessionId: 'session-1',
    accessToken: 'device-token',
    scopes: ['capture:write'],
  };
}

test('unpaired devices explicitly select the legacy compatibility path before grant issuance', async () => {
  const api = loadApi();
  let clientCalls = 0;
  const submitter = api.createSubmitter({
    credentials: {
      beginOperation: async () => ({ state: 'unpaired', epoch: 1 }),
      isOperationCurrent: async () => true,
    },
    client: {
      requestSourceCaptureGrant: async () => { clientCalls += 1; },
      submitSourceCaptureV2: async () => { clientCalls += 1; },
    },
    contract: contract(),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(await submitter.submit(capture()))), {
    state: 'legacy_compatible',
    reason: 'unpaired',
  });
  assert.equal(clientCalls, 0);
});

test('paired capture binds hash and bytes, checks operation epochs, and uses the device endpoint', async () => {
  const api = loadApi();
  const operation = pairedOperation();
  const currentChecks = [];
  const calls = [];
  const submitter = api.createSubmitter({
    credentials: {
      beginOperation: async () => operation,
      isOperationCurrent: async (candidate) => {
        currentChecks.push(candidate);
        return candidate === operation;
      },
    },
    client: {
      async requestSourceCaptureGrant(candidate, payload) {
        calls.push({ type: 'grant', candidate, payload });
        return { code: 1, data: { grantId: 'grant-1', grantToken: 'g'.repeat(43) } };
      },
      async submitSourceCaptureV2(candidate, payload) {
        calls.push({ type: 'capture', candidate, payload });
        return { code: 1, data: { snapshotId: 'snapshot-1', replay: false } };
      },
    },
    contract: contract(),
  });

  const result = await submitter.submit(capture());
  assert.equal(result.state, 'submitted');
  assert.equal(result.data.snapshotId, 'snapshot-1');
  assert.equal(currentChecks.length >= 3, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload.command)), {
    schemaVersion: 'source-product-capture-v2',
    platform: '1688',
    sourceProductId: '1000000000236',
    captureHash: 'a'.repeat(64),
    payloadBytes: 12345,
  });
  assert.equal(calls[0].payload.idempotencyKey, `source-capture-${'a'.repeat(64)}`);
  assert.equal(calls[1].payload.grantToken, 'g'.repeat(43));
  assert.equal(calls[1].payload.idempotencyKey, `source-capture-${'a'.repeat(64)}`);
  assert.equal(calls[1].payload.captureHash, 'a'.repeat(64));
  assert.equal(calls[1].payload.payloadBytes, 12345);
});

test('an explicit feature-off response can use legacy only before a grant is issued', async () => {
  const api = loadApi();
  let captureCalls = 0;
  const submitter = api.createSubmitter({
    credentials: {
      beginOperation: async () => pairedOperation(),
      isOperationCurrent: async () => true,
    },
    client: {
      requestSourceCaptureGrant: async () => ({
        code: 0,
        errorCode: 'source_capture_v2_not_enabled',
        msg: 'feature off',
      }),
      submitSourceCaptureV2: async () => { captureCalls += 1; },
    },
    contract: contract(),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(await submitter.submit(capture()))), {
    state: 'legacy_compatible',
    reason: 'feature_off',
  });
  assert.equal(captureCalls, 0);
});

test('a failure after grant issuance never falls back to a second legacy write', async () => {
  const api = loadApi();
  const submitter = api.createSubmitter({
    credentials: {
      beginOperation: async () => pairedOperation(),
      isOperationCurrent: async () => true,
    },
    client: {
      requestSourceCaptureGrant: async () => ({
        code: 1,
        data: { grantId: 'grant-1', grantToken: 'g'.repeat(43) },
      }),
      submitSourceCaptureV2: async () => ({
        code: 0,
        errorCode: 'capture_hash_mismatch',
        msg: 'changed payload',
      }),
    },
    contract: contract(),
  });

  await assert.rejects(submitter.submit(capture()), /changed payload/);
});
