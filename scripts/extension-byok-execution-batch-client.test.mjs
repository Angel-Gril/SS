import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/execution-batch-client.js';

function loadApi() {
  const context = {
    Array, Boolean, Error, JSON, Number, Object, Promise, Set, String, URL, encodeURIComponent,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_BYOK_EXECUTION_BATCH_CLIENT;
}

const HASHES = ['a', 'b', 'c', 'd'].map((value) => value.repeat(64));

function binding(index = 0, overrides = {}) {
  const skuKey = `sku-${index + 1}`;
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourcePlatform: '1688',
    sourceProductId: 'source-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey,
    slotKey: `sku:${skuKey}:hero`,
    assignmentMode: 'APPEND',
    assignmentOrdinal: 17 + index,
    providerOrigin: 'https://provider.example',
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE',
    policyRevision: '23',
    ...overrides,
  };
}

function item(index = 0, overrides = {}) {
  return {
    readinessBinding: binding(index),
    requestMode: 'json',
    providerIdempotencyKey: `provider-attempt-000${index + 1}`,
    providerRequestHash: HASHES[index],
    ...overrides,
  };
}

function publicItem(index = 0, overrides = {}) {
  const input = item(index);
  return {
    batchItemId: `batch-item-${index}`,
    itemIndex: index,
    skuKey: input.readinessBinding.skuKey,
    slotKey: input.readinessBinding.slotKey,
    assignmentOrdinal: input.readinessBinding.assignmentOrdinal,
    intent: {
      contractVersion: 'extension-byok-execution-intent/v1',
      intentId: `intent-${index}-0`,
      attemptIndex: 0,
      outcome: 'PENDING',
      providerIdempotencyKey: input.providerIdempotencyKey,
      providerRequestHash: input.providerRequestHash,
    },
    ...overrides,
  };
}

function response(status, data) {
  return { state: 'response', status, body: { code: 1, data } };
}

test('claims a secret-free ordered reservation for exact slot attempts', async () => {
  const api = loadApi();
  const calls = [];
  const client = api.createClient({
    transport: {
      async post(path, body, options) {
        calls.push({ path, body, options });
        return response(201, {
          contractVersion: 'extension-byok-execution-batch/v1',
          batchId: 'batch-1',
          status: 'OPEN',
          replayed: false,
          context: {
            shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
          },
          items: [publicItem(0), publicItem(1)],
        });
      },
    },
  });
  const result = await client.claim({
    idempotencyKey: 'execution-batch-attempt-0001',
    items: [item(0), item(1)],
  });
  assert.equal(result.batchId, 'batch-1');
  assert.equal(result.items.length, 2);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    path: '/api/extension-device/byok-media/execution-batches',
    body: {
      contractVersion: 'extension-byok-execution-batch-request/v1',
      idempotencyKey: 'execution-batch-attempt-0001',
      items: [
        {
          binding: binding(0), requestMode: 'json',
          providerIdempotencyKey: 'provider-attempt-0001', providerRequestHash: HASHES[0],
        },
        {
          binding: binding(1), requestMode: 'json',
          providerIdempotencyKey: 'provider-attempt-0002', providerRequestHash: HASHES[1],
        },
      ],
    },
    options: { requiredScope: 'byok:media:ingest' },
  }]);
  const serialized = JSON.stringify(result).toLowerCase();
  assert.equal(serialized.includes('provider.example'), false);
  assert.equal(serialized.includes('apikey'), false);
});

test('claims one successor only with an explicit current charge confirmation', async () => {
  const api = loadApi();
  let captured;
  const successor = item(1, {
    providerIdempotencyKey: 'provider-successor-0002',
    providerRequestHash: HASHES[3],
  });
  const client = api.createClient({
    transport: {
      async post(path, body, options) {
        captured = { path, body, options };
        return response(201, {
          contractVersion: 'extension-byok-execution-batch-attempt/v1',
          batchId: 'batch-1',
          status: 'OPEN',
          replayed: false,
          context: {
            shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
          },
          item: publicItem(1, {
            intent: {
              contractVersion: 'extension-byok-execution-intent/v1',
              intentId: 'intent-1-1', attemptIndex: 1, outcome: 'PENDING',
              providerIdempotencyKey: successor.providerIdempotencyKey,
              providerRequestHash: successor.providerRequestHash,
            },
          }),
        });
      },
    },
  });
  const result = await client.claimSuccessor({
    batchId: 'batch-1', itemIndex: 1, currentIntentId: 'intent-1-0',
    providerChargeConfirmed: true, item: successor,
  });
  assert.equal(result.item.intent.intentId, 'intent-1-1');
  assert.equal(captured.path, '/api/extension-device/byok-media/execution-batches/batch-1/items/1/attempts');
  assert.equal(captured.body.providerChargeConfirmed, true);
  await assert.rejects(
    client.claimSuccessor({
      batchId: 'batch-1', itemIndex: 1, currentIntentId: 'intent-1-0',
      providerChargeConfirmed: false, item: successor,
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_BATCH_INPUT_INVALID',
  );
});

test('loads and validates the exact persisted batch state for Worker recovery', async () => {
  const api = loadApi();
  const calls = [];
  const client = api.createClient({
    transport: {
      async post() { throw new Error('unexpected POST'); },
      async get(path, options) {
        calls.push({ path, options });
        return response(200, {
          contractVersion: 'extension-byok-execution-batch-status/v1',
          batchId: 'batch-1',
          status: 'OPEN',
          context: {
            shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
            sourcePlatform: '1688', sourceProductId: 'source-1',
            sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          },
          boundDraftRevision: null,
          boundDraftVersion: null,
          items: [
            { ...publicItem(0), status: 'ACTIVE' },
            { ...publicItem(1), status: 'ACTIVE' },
          ],
        });
      },
    },
  });
  const status = await client.status({ batchId: 'batch-1' });
  assert.equal(status.status, 'OPEN');
  assert.equal(status.items[1].intent.outcome, 'PENDING');
  assert.equal(Object.isFrozen(status), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    path: '/api/extension-device/byok-media/execution-batches/batch-1',
    options: { requiredScope: 'byok:media:ingest' },
  }]);

  const malformed = api.createClient({
    transport: {
      async post() {},
      async get() {
        return response(200, {
          ...status,
          items: [{ ...status.items[0], status: 'BOUND' }],
        });
      },
    },
  });
  await assert.rejects(
    malformed.status({ batchId: 'batch-1' }),
    (error) => error?.code === 'SS_ERP_BYOK_EXECUTION_BATCH_RESPONSE_INVALID',
  );
});

test('looks up an ambiguous reservation by exact idempotency key and clears only an exact miss', async () => {
  const api = loadApi();
  const calls = [];
  let mode = 'found';
  const status = {
    contractVersion: 'extension-byok-execution-batch-status/v1',
    batchId: 'batch-1',
    status: 'OPEN',
    context: {
      shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
      sourcePlatform: '1688', sourceProductId: 'source-1',
      sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    },
    boundDraftRevision: null,
    boundDraftVersion: null,
    items: [{ ...publicItem(0), status: 'ACTIVE' }],
  };
  const client = api.createClient({
    transport: {
      async post() { throw new Error('unexpected POST'); },
      async get(path, options) {
        calls.push({ path, options });
        if (mode === 'found') return response(200, status);
        if (mode === 'missing') {
          return {
            state: 'http_error', status: 404,
            body: { code: 0, errorCode: 'byok_execution_batch_not_found', msg: 'not found' },
          };
        }
        return { state: 'http_error', status: 404, body: { code: 0, error: 'route missing' } };
      },
    },
  });
  const key = 'byok-reservation:00000000-0000-4000-8000-000000000001';
  assert.equal((await client.statusByIdempotency({ idempotencyKey: key })).batchId, 'batch-1');
  mode = 'missing';
  assert.equal(await client.statusByIdempotency({ idempotencyKey: key }), null);
  mode = 'generic-404';
  await assert.rejects(
    client.statusByIdempotency({ idempotencyKey: key }),
    (error) => error?.code === 'SS_ERP_BYOK_EXECUTION_BATCH_REJECTED',
  );
  assert.equal(calls.every((call) => (
    call.path === '/api/extension-device/byok-media/execution-batches/by-idempotency/'
      + encodeURIComponent(key)
      && call.options.requiredScope === 'byok:media:ingest'
  )), true);
});

test('cancels by exact batch identity and maps retryable transport failures safely', async () => {
  const api = loadApi();
  let fail = false;
  const client = api.createClient({
    transport: {
      async post() {
        if (fail) throw new Error('private transport detail');
        return response(200, {
          contractVersion: 'extension-byok-execution-batch-cancel/v1',
          batchId: 'batch-1', status: 'CANCELLED', replayed: false,
        });
      },
    },
  });
  assert.equal((await client.cancel({ batchId: 'batch-1' })).status, 'CANCELLED');
  fail = true;
  await assert.rejects(
    client.cancel({ batchId: 'batch-2' }),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_BATCH_UNAVAILABLE'
      && error.outcome === 'FAILED_RETRYABLE'
      && JSON.stringify(error).includes('private transport detail') === false,
  );
});

test('rejects malformed or cross-context responses and never exposes server bodies', async () => {
  const api = loadApi();
  let posts = 0;
  const client = api.createClient({
    transport: {
      async post() {
        posts += 1;
        return response(201, {
          contractVersion: 'extension-byok-execution-batch/v1',
          batchId: 'batch-1', status: 'OPEN', replayed: false,
          context: {
            shopId: 'shop-other', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
          },
          items: [publicItem(0)],
        });
      },
    },
  });
  await assert.rejects(
    client.claim({ idempotencyKey: 'execution-batch-attempt-0001', items: [item(0)] }),
    (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_BATCH_RESPONSE_INVALID'
      && error.outcome === 'FAILED_FINAL',
  );
  await assert.rejects(
    client.claim({ idempotencyKey: 'sk-' + 'a'.repeat(24), items: [item(0)] }),
    (error) => error?.code === 'SS_ERP_BYOK_EXECUTION_BATCH_INPUT_INVALID',
  );
  assert.equal(posts, 1, 'credential-shaped identifiers fail before a second ERP request');
});
