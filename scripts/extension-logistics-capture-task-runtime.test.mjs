import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function response(status, body) {
  return {
    status,
    headers: { get() { return null; } },
    async json() { return body; },
  };
}

function createHarness(options = {}) {
  const context = { Array, Boolean, Date, Error, JSON, Math, Number, Object, Promise, Set, String, TypeError, URL };
  context.globalThis = context;
  context.self = context;
  context.SS_ERP_LOGISTICS_CAPTURE_ADAPTER = {
    async buildCapture() {
      let configured = options.buildResult;
      if (Array.isArray(options.buildResults)) configured = options.buildResults.shift();
      if (typeof configured === 'function') configured = configured();
      return configured || {
        state: 'ready',
        payload: {
          schema: 'ozon-seller-logistics-capture/v1',
          capturedAt: '2026-07-12T10:01:00.000Z',
          responseChecksum: 'a'.repeat(64),
          endpointBatch: {
            expected: ['seller/provider-inventory'],
            attempted: ['seller/provider-inventory'],
            succeeded: ['seller/provider-inventory'], failed: [], empty: [],
          },
          sellerContext: { point: { latitude: 24.48, longitude: 118.08 } },
          providerRows: [{ providerId: '1', name: 'P', source: 'both', status: 'succeeded', pointCount: 1 }],
          selectedServiceKeys: ['svc:v2:["1","p","global","weight","no-battery"]'],
          defaultServiceKeys: ['svc:v2:["1","p","global","weight","no-battery"]'],
          services: [],
        },
      };
    },
  };
  vm.runInNewContext(
    fs.readFileSync('extensions/ss-erp/shared/logistics-rules/capture-task-runtime.js', 'utf8'),
    context,
    { filename: 'capture-task-runtime.js' },
  );
  const statuses = [];
  const requests = [];
  const task = {
    id: 'task-a', version: options.taskVersion || 'logistics-capture-task/v3', kind: 'SELLER',
    scope: {
      tenantId: 'owner-a', shopId: 'shop-a', companyId: 'company-a',
      warehouseId: 'warehouse-a', originCountryUid: 'china', originCityUid: 'xiamen',
    },
    destination: null, officialFingerprint: null,
    expectedEndpoints: options.expectedEndpoints || [
      'seller/template/by-location', 'seller/provider-inventory',
    ], fingerprintChecksum: 'a'.repeat(64),
    claimToken: 'claim.' + 'x'.repeat(40), status: 'ISSUED',
    issuedAt: '2026-07-12T10:00:00.000Z', expiresAt: '2026-07-12T10:10:00.000Z',
  };
  const runtime = context.SS_ERP_LOGISTICS_CAPTURE_RUNTIME.createRuntime({
    credentials: options.credentials || {
      async getStatus() {
        return { state: 'paired', sessionId: 's', deploymentId: 'd', ownerUserId: 'owner-a', scopes: ['logistics:capture'] };
      },
      async getConnection() {
        return { baseUrl: 'https://erp.example', sessionId: 's', deploymentId: 'd', ownerUserId: 'owner-a', deviceId: 'dev' };
      },
      async getAccessToken() { return 'access-secret'; },
      async beginOperation() {
        return {
          state: 'paired', epoch: 1, baseUrl: 'https://erp.example',
          sessionId: 's', deploymentId: 'd', ownerUserId: 'owner-a', deviceId: 'dev',
          scopes: ['logistics:capture'], accessToken: 'access-secret',
        };
      },
      async isOperationCurrent() { return true; },
      async clearIfCurrent() { return true; },
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (typeof options.fetchImpl === 'function') return options.fetchImpl(url, init, task);
      if (url.endsWith('/capture-tasks/pending')) return response(200, { code: 1, data: { tasks: [task] } });
      if (url.endsWith('/capture-tasks/task-a/claim')) return response(200, { code: 1, data: { status: 'CLAIMED' } });
      if (url.endsWith('/capture-tasks/task-a/upload')) return response(201, {
        code: 1, data: { candidateId: 'candidate-a', state: 'CAPTURED', requiresReview: true },
      });
      if (url.endsWith('/capture-tasks/task-a/cancel')) return response(200, { code: 1, data: { status: 'CANCELLED' } });
      throw new Error('unexpected request ' + url);
    },
    readCapturedEntries: async () => [],
    collectProviderInventory: options.collectProviderInventory,
    readSelectedServiceIds: async () => [],
    writeStatus: async (status) => { statuses.push(plain(status)); },
    readStatus: async () => statuses.at(-1) || null,
    now: () => new Date('2026-07-12T10:02:00.000Z'),
  });
  return { runtime, requests, statuses, task };
}

test('runtime polls, claims, and uploads with ephemeral claimToken proof', async () => {
  const { runtime, requests, statuses, task } = createHarness();
  const result = await runtime.refresh({ reason: 'manual', extensionVersion: '1.2.0' });

  assert.deepEqual(plain(result), {
    state: 'uploaded', taskId: 'task-a', kind: 'SELLER', candidateId: 'candidate-a',
    candidateState: 'CAPTURED', requiresReview: true,
  });
  assert.equal(requests.length, 3);
  const claimBody = JSON.parse(requests[1].init.body);
  const uploadBody = JSON.parse(requests[2].init.body);
  assert.deepEqual(Object.keys(claimBody).sort(), ['claimToken', 'scope', 'taskVersion']);
  assert.equal(uploadBody.claimToken, task.claimToken);
  assert.equal('nonce' in uploadBody, false);
  assert.equal(requests.every((request) => request.init.headers.Authorization === 'Bearer access-secret'), true);
  assert.equal(JSON.stringify({ result, statuses }).includes(task.claimToken), false);
  assert.equal(JSON.stringify({ result, statuses }).includes('access-secret'), false);
  assert.equal((await runtime.getStatus()).state, 'uploaded');
});

test('runtime still accepts a structurally valid legacy v1 task', async () => {
  const { runtime } = createHarness({
    taskVersion: 'logistics-capture-task/v1',
    expectedEndpoints: [
      'seller/template/by-location', 'seller/category/list', 'seller/delivery-speed',
      'seller/provider-inventory',
    ],
  });

  await assert.doesNotReject(
    runtime.refresh({ reason: 'manual', extensionVersion: '1.2.0' }),
  );
});

test('runtime waits for provider inventory and can cancel without persisting proof', async () => {
  const { runtime, requests, statuses, task } = createHarness({
    buildResult: {
      state: 'waiting', reason: 'missing_endpoints',
      missingEndpoints: ['seller/provider-inventory'],
    },
  });
  const waiting = await runtime.refresh({ reason: 'manual', extensionVersion: '1.2.0' });
  const cancelled = await runtime.cancel({ taskId: task.id, extensionVersion: '1.2.0' });

  assert.equal(waiting.state, 'waiting_for_provider_inventory');
  assert.deepEqual(waiting.missingEndpoints, ['seller/provider-inventory']);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(requests.some((request) => request.url.endsWith('/claim')), false);
  assert.equal(requests.some((request) => request.url.endsWith('/upload')), false);
  assert.equal(JSON.stringify(statuses).includes(task.claimToken), false);
});

test('only an explicit manual refresh may run the existing provider collector', async () => {
  let collections = 0;
  const waiting = {
    state: 'waiting', reason: 'missing_endpoints',
    missingEndpoints: ['seller/provider-inventory'],
    collectionContext: { companyId: 'company-a', point: { latitude: 24.48, longitude: 118.08 } },
  };
  const manual = createHarness({
    buildResults: [waiting, null],
    collectProviderInventory: async (input) => {
      collections += 1;
      assert.equal(input.companyId, 'company-a');
      assert.deepEqual(plain(input.point), { latitude: 24.48, longitude: 118.08 });
    },
  });
  const manualResult = await manual.runtime.refresh({
    reason: 'manual', extensionVersion: '1.2.0', allowProviderCollection: true,
  });
  assert.equal(manualResult.state, 'uploaded');
  assert.equal(collections, 1);

  let scheduledCollections = 0;
  const scheduled = createHarness({
    buildResult: waiting,
    collectProviderInventory: async () => { scheduledCollections += 1; },
  });
  const scheduledResult = await scheduled.runtime.refresh({ reason: 'alarm', extensionVersion: '1.2.0' });
  assert.equal(scheduledResult.state, 'waiting_for_provider_inventory');
  assert.equal(scheduledCollections, 0);
});
test('stale capture authorization failures cannot clear or write into a newly paired tenant', async () => {
  for (const status of [401, 403, 410]) {
    const operation = {
      state: 'paired', epoch: 1, baseUrl: 'https://erp.example',
      sessionId: 'old-session', deploymentId: 'old-deployment',
      ownerUserId: 'owner-a', deviceId: 'old-device',
      scopes: ['logistics:capture'], accessToken: 'old-access-token',
    };
    let current = true;
    let legacyClears = 0;
    let conditionalClears = 0;
    const harness = createHarness({
      credentials: {
        async getStatus() {
          return {
            state: 'paired', sessionId: operation.sessionId,
            deploymentId: operation.deploymentId, ownerUserId: operation.ownerUserId,
            scopes: operation.scopes,
          };
        },
        async getConnection() {
          return {
            baseUrl: operation.baseUrl, sessionId: operation.sessionId,
            deploymentId: operation.deploymentId, ownerUserId: operation.ownerUserId,
            deviceId: operation.deviceId,
          };
        },
        async getAccessToken() { return operation.accessToken; },
        async beginOperation() { return operation; },
        async isOperationCurrent(candidate) { return candidate === operation && current; },
        async clearIfCurrent() { conditionalClears += 1; return false; },
        async clear() { legacyClears += 1; },
      },
      fetchImpl: async () => {
        current = false;
        return response(status, { code: 0, error: { code: 'INVALID_DEVICE_TOKEN' } });
      },
    });

    const result = await harness.runtime.refresh({
      reason: 'manual',
      extensionVersion: '1.2.0',
    });

    assert.equal(result.state, 'superseded', String(status));
    assert.equal(legacyClears, 0, String(status));
    assert.equal(conditionalClears, 0, String(status));
    assert.equal(harness.statuses.length, 0, String(status));
    assert.equal(harness.requests.length, 1, String(status));
  }
});
