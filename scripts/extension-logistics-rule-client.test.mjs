import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const clientSource = fs.readFileSync(
  'extensions/ss-erp/shared/logistics-rules/distribution-client.js',
  'utf8',
);

function response(status, body, headers = {}) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) || null },
    async json() { return body; },
  };
}

function loadClient(options) {
  const context = {
    Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise, URL,
  };
  context.globalThis = context;
  vm.runInNewContext(clientSource, context, { filename: 'distribution-client.js' });
  return context.SS_ERP_LOGISTICS_DISTRIBUTION_CLIENT.createClient(options);
}

function epochCredentials(overrides = {}) {
  const operation = overrides.operation || {
    state: 'paired',
    epoch: 1,
    accessToken: 'device-access-token',
  };
  return {
    async getAccessToken() { return operation.accessToken; },
    async beginOperation() { return operation; },
    async isOperationCurrent(candidate) { return candidate === operation; },
    async clearIfCurrent(candidate) { return candidate === operation; },
    ...overrides,
  };
}

const namespace = {
  deploymentId: 'local-dev',
  tenantSubject: 'tenant-a',
  shopId: 'shop-a',
  ozonCompanyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
  assignmentId: 'assignment-a',
  schemaMajor: 1,
};

function scopedPayload() {
  return {
    scope: {
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      ozonCompanyId: 'company-a',
      warehouseId: 'warehouse-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      destinationCountryUid: 'russia',
      destinationLocationUid: 'moscow',
    },
    revisionPayload: {
      scope: {
        deploymentId: 'local-dev',
        tenantId: 'tenant-a',
        shopId: 'shop-a',
        ozonCompanyId: 'company-a',
        erpWarehouseId: 'warehouse-a',
        originCountryUid: 'china',
        originCityUid: 'xiamen',
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        schemaMajor: 1,
      },
    },
    assignment: { id: 'assignment-a' },
    selectedServiceKeys: ['service-1'],
  };
}

test('an authenticated 200 response is staged with the server scope and a durable receipt intent', async () => {
  const calls = [];
  const staged = [];
  const store = {
    async readPointer() { return null; },
    async stageAndActivate(input) { staged.push(input); return { state: 'active' }; },
  };
  const client = loadClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        code: 1,
        data: {
          deploymentId: 'local-dev',
          assignmentId: 'assignment-a',
          releaseId: 'release-1',
          releaseSequence: 1,
          contentChecksum: 'a'.repeat(64),
          effectiveChecksum: 'b'.repeat(64),
          minExtensionVersion: '1.0.0',
          validUntil: '2026-07-19T12:00:00.000Z',
          staleUntil: '2026-07-20T12:00:00.000Z',
          authorizationValidUntil: '2026-07-13T12:00:00.000Z',
          serverTime: '2026-07-12T12:00:00.000Z',
          bundle: scopedPayload(),
        },
      }, { etag: '"release-1"' });
    },
    store,
    credentials: epochCredentials(),
    randomId: () => '0123456789abcdef',
  });

  const result = await client.refresh({
    baseUrl: 'https://erp.example/',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.equal(result.state, 'active');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://erp.example/api/logistics-rules/assignments/assignment-a/effective');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].init.headers)), {
    Accept: 'application/json',
    Authorization: 'Bearer device-access-token',
    'X-SS-ERP-Extension-Version': '1.2.0',
  });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(staged.length, 1);
  assert.equal(staged[0].namespace, namespace);
  assert.equal(staged[0].bundle.releaseId, 'release-1');
  assert.equal(staged[0].bundle.payload.selectedServiceKeys[0], 'service-1');
  assert.equal(staged[0].etag, '"release-1"');
  assert.equal(staged[0].receiptIdempotencyKey, '0123456789abcdef');
});
test('an authenticated 304 renews only the authorization lease for the matching ETag', async () => {
  const applied = [];
  let generatedIds = 0;
  const store = {
    async readPointer() {
      return { etag: '"release-1"', effectiveChecksum: 'b'.repeat(64) };
    },
    async applyNotModified(input) {
      applied.push(input);
      return { state: 'active', generation: 1 };
    },
    async stageAndActivate() {
      throw new Error('304 must not stage a bundle');
    },
  };
  const client = loadClient({
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['If-None-Match'], '"release-1"');
      return response(304, null, {
        etag: '"release-1"',
        'x-ss-erp-server-time': '2026-07-12T13:00:00.000Z',
        'x-ss-erp-authorization-valid-until': '2026-07-13T13:00:00.000Z',
        'x-ss-erp-effective-checksum': 'b'.repeat(64),
      });
    },
    store,
    credentials: epochCredentials(),
    randomId: () => { generatedIds += 1; return 'unused-id-000000'; },
  });

  const result = await client.refresh({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.equal(result.state, 'not_modified');
  assert.equal(generatedIds, 0);
  assert.equal(applied.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(applied[0])), {
    namespace,
    etag: '"release-1"',
    effectiveChecksum: 'b'.repeat(64),
    serverTime: '2026-07-12T13:00:00.000Z',
    authorizationValidUntil: '2026-07-13T13:00:00.000Z',
  });
});
test('a revoked pointer omits If-None-Match so reconfiguration must return a full 200', async () => {
  const staged = [];
  const store = {
    async readPointer() {
      return {
        state: 'revoked',
        etag: '"release-1"',
        effectiveChecksum: 'b'.repeat(64),
      };
    },
    async stageAndActivate(input) {
      staged.push(input);
      return { state: 'active' };
    },
  };
  const client = loadClient({
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['If-None-Match'], undefined);
      return response(200, {
        code: 1,
        data: {
          deploymentId: 'local-dev',
          assignmentId: 'assignment-a',
          releaseId: 'release-1',
          releaseSequence: 1,
          contentChecksum: 'a'.repeat(64),
          effectiveChecksum: 'b'.repeat(64),
          minExtensionVersion: '1.0.0',
          validUntil: '2026-07-19T12:00:00.000Z',
          staleUntil: '2026-07-20T12:00:00.000Z',
          authorizationValidUntil: '2026-07-13T12:05:00.000Z',
          serverTime: '2026-07-12T12:05:00.000Z',
          bundle: scopedPayload(),
        },
      }, { etag: '"release-1-reauthorized"' });
    },
    store,
    credentials: epochCredentials(),
    randomId: () => 'reauthorized-0001',
  });

  const result = await client.refresh({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.equal(result.state, 'active');
  assert.equal(staged.length, 1);
  assert.equal(staged[0].etag, '"release-1-reauthorized"');
  assert.equal(staged[0].bundle.releaseSequence, 1);
});
test('an active pointer without a usable blob omits If-None-Match and stages the same release again', async () => {
  const staged = [];
  const store = {
    async readPointer() {
      return {
        state: 'active',
        etag: '"release-1"',
        effectiveChecksum: 'b'.repeat(64),
      };
    },
    async readActive() { return null; },
    async stageAndActivate(input) {
      staged.push(input);
      return { state: 'active' };
    },
  };
  const client = loadClient({
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['If-None-Match'], undefined);
      return response(200, {
        code: 1,
        data: {
          deploymentId: 'local-dev',
          assignmentId: 'assignment-a',
          releaseId: 'release-1',
          releaseSequence: 1,
          contentChecksum: 'a'.repeat(64),
          effectiveChecksum: 'b'.repeat(64),
          minExtensionVersion: '1.0.0',
          validUntil: '2026-07-19T12:00:00.000Z',
          staleUntil: '2026-07-20T12:00:00.000Z',
          authorizationValidUntil: '2026-07-13T12:05:00.000Z',
          serverTime: '2026-07-12T12:05:00.000Z',
          bundle: scopedPayload(),
        },
      }, { etag: '"release-1-repair"' });
    },
    store,
    credentials: epochCredentials(),
    randomId: () => 'repair-release-001',
  });

  const result = await client.refresh({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.equal(result.state, 'active');
  assert.equal(staged.length, 1);
  assert.equal(staged[0].bundle.releaseSequence, 1);
});
test('401 and 403 revoke the scoped cache and device credentials', async () => {
  for (const status of [401, 403]) {
    const revoked = [];
    const cleared = [];
    const store = {
      async readPointer() {
        return { etag: '"release-1"', effectiveChecksum: 'b'.repeat(64) };
      },
      async markRevoked(scope, input) {
        revoked.push({ scope, input });
      },
      async stageAndActivate() {
        throw new Error('revoked response must not stage');
      },
    };
    const credentials = epochCredentials({
      async clearIfCurrent(_operation, input) { cleared.push(input); return true; },
    });
    const client = loadClient({
      fetchImpl: async () => response(status, {
        code: 0,
        errorCode: status === 410 ? 'assignment_revoked' : 'unauthorized',
        reasonCode: status === 410 ? 'shop_transferred' : undefined,
      }),
      store,
      credentials,
      randomId: () => 'unused-id-000000',
    });

    const result = await client.refresh({
      baseUrl: 'https://erp.example',
      assignmentId: 'assignment-a',
      namespace,
      extensionVersion: '1.2.0',
    });

    assert.equal(result.state, 'revoked');
    assert.equal(result.status, status);
    assert.equal(revoked.length, 1);
    assert.equal(revoked[0].scope, namespace);
    assert.equal(revoked[0].input.status, status);
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0].status, status);
  }
});
test('an assignment-level 410 revokes only the scoped cache', async () => {
  const revoked = [];
  const cleared = [];
  const store = {
    async readPointer() { return null; },
    async markRevoked(scope, input) { revoked.push({ scope, input }); },
    async stageAndActivate() { throw new Error('revoked response must not stage'); },
  };
  const client = loadClient({
    fetchImpl: async () => response(410, {
      code: 0,
      errorCode: 'assignment_revoked',
      reasonCode: 'shop_transferred',
    }),
    store,
    credentials: epochCredentials({
      async clearIfCurrent(_operation, input) { cleared.push(input); return true; },
    }),
    randomId: () => 'unused-id-000000',
  });

  const result = await client.refresh({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.equal(result.state, 'revoked');
  assert.equal(result.status, 410);
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].scope, namespace);
  assert.equal(revoked[0].input.reason, 'shop_transferred');
  assert.equal(cleared.length, 0);
});
test('a pending receipt is retried with the same idempotency key and cleared after confirmation', async () => {
  const requests = [];
  const reported = [];
  const pending = {
    effectiveChecksum: 'b'.repeat(64),
    idempotencyKey: '0123456789abcdef',
    releaseId: 'release-1',
    releaseSequence: 1,
  };
  const store = {
    async readPendingReceipt() { return pending; },
    async markReceiptReported(scope, input) { reported.push({ scope, input }); },
    async stageAndActivate() { throw new Error('receipt flush must not stage'); },
  };
  const client = loadClient({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response(201, {
        code: 1,
        data: { receiptId: 'receipt-1', duplicate: false },
      });
    },
    store,
    credentials: epochCredentials(),
    randomId: () => 'unused-id-000000',
    now: () => new Date('2026-07-12T12:02:00.000Z'),
  });

  const result = await client.flushPendingReceipt({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.equal(result.state, 'reported');
  assert.equal(requests[0].url, 'https://erp.example/api/logistics-rules/assignments/assignment-a/releases/release-1/receipts');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-access-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    idempotencyKey: '0123456789abcdef',
    effectiveChecksum: 'b'.repeat(64),
    status: 'applied',
    extensionVersion: '1.2.0',
    appliedAt: '2026-07-12T12:02:00.000Z',
  });
  assert.equal(reported.length, 1);
  assert.equal(reported[0].scope, namespace);
  assert.equal(reported[0].input.idempotencyKey, pending.idempotencyKey);
  assert.equal(reported[0].input.receiptId, 'receipt-1');
});
test('a receipt network failure leaves the durable pending intent for the next wake', async () => {
  let reported = 0;
  const store = {
    async readPendingReceipt() {
      return {
        effectiveChecksum: 'b'.repeat(64),
        idempotencyKey: '0123456789abcdef',
        releaseId: 'release-1',
        releaseSequence: 1,
      };
    },
    async markReceiptReported() { reported += 1; },
    async stageAndActivate() { throw new Error('receipt flush must not stage'); },
  };
  const client = loadClient({
    fetchImpl: async () => { throw new TypeError('offline'); },
    store,
    credentials: epochCredentials(),
    randomId: () => 'unused-id-000000',
    now: () => new Date('2026-07-12T12:02:00.000Z'),
  });

  const result = await client.flushPendingReceipt({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    state: 'retryable',
    reason: 'network',
  });
  assert.equal(reported, 0);
});
test('receipt retries reuse the durable applied timestamp after a response is lost', async () => {
  const bodies = [];
  const reported = [];
  const pending = {
    effectiveChecksum: 'b'.repeat(64),
    idempotencyKey: '0123456789abcdef',
    releaseId: 'release-1',
    releaseSequence: 1,
    appliedAt: '2026-07-12T12:01:00.000Z',
  };
  let clock = 0;
  const client = loadClient({
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) throw new TypeError('response lost');
      return response(201, {
        code: 1,
        data: { receiptId: 'receipt-1', duplicate: true },
      });
    },
    store: {
      async readPendingReceipt() { return pending; },
      async markReceiptReported(_namespace, value) { reported.push(value); },
      async stageAndActivate() { throw new Error('receipt flush must not stage'); },
    },
    credentials: epochCredentials(),
    randomId: () => 'unused-id-000000',
    now: () => new Date(clock++ === 0
      ? '2026-07-12T12:02:00.000Z'
      : '2026-07-12T12:03:00.000Z'),
  });
  const input = {
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  };

  assert.equal((await client.flushPendingReceipt(input)).state, 'retryable');
  assert.equal((await client.flushPendingReceipt(input)).state, 'reported');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].appliedAt, pending.appliedAt);
  assert.equal(bodies[1].appliedAt, pending.appliedAt);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].reportedAt, '2026-07-12T12:03:00.000Z');
  assert.notEqual(reported[0].reportedAt, pending.appliedAt);
});
test('426 reports upgrade_required without staging or revoking the prior bundle', async () => {
  let staged = 0;
  let revoked = 0;
  const store = {
    async readPointer() {
      return { etag: '"release-1"', effectiveChecksum: 'b'.repeat(64) };
    },
    async stageAndActivate() { staged += 1; },
    async markRevoked() { revoked += 1; },
  };
  const client = loadClient({
    fetchImpl: async () => response(426, {
      code: 0,
      errorCode: 'upgrade_required',
      data: { minExtensionVersion: '2.0.0' },
    }),
    store,
    credentials: epochCredentials(),
    randomId: () => 'unused-id-000000',
  });

  const result = await client.refresh({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    state: 'upgrade_required',
    minExtensionVersion: '2.0.0',
  });
  assert.equal(staged, 0);
  assert.equal(revoked, 0);
});
test('a refresh network failure preserves the active pointer and reports a retryable state', async () => {
  let staged = 0;
  let revoked = 0;
  const store = {
    async readPointer() {
      return { etag: '"release-1"', effectiveChecksum: 'b'.repeat(64) };
    },
    async stageAndActivate() { staged += 1; },
    async markRevoked() { revoked += 1; },
  };
  const client = loadClient({
    fetchImpl: async () => { throw new TypeError('offline'); },
    store,
    credentials: epochCredentials(),
    randomId: () => 'unused-id-000000',
  });

  const result = await client.refresh({
    baseUrl: 'https://erp.example',
    assignmentId: 'assignment-a',
    namespace,
    extensionVersion: '1.2.0',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    state: 'retryable',
    reason: 'network',
  });
  assert.equal(staged, 0);
  assert.equal(revoked, 0);
});
test('device discovery returns only the scoped logistics assignments', async () => {
  const requests = [];
  const client = loadClient({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response(200, {
        code: 1,
        data: {
          assignments: [{
            assignmentId: 'assignment-a',
            shopId: 'shop-a',
            shopName: 'Xiamen pilot',
            companyId: 'company-a',
            warehouseId: 'warehouse-a',
            warehouseName: 'Xiamen warehouse',
            originCountryUid: 'china',
            originCityUid: 'xiamen',
            originLabel: 'China / Xiamen',
            destinationCountryUid: 'russia',
            destinationLocationUid: 'moscow',
            destinationLabel: 'Russia / Moscow',
            releaseSequence: 1,
          }],
        },
      });
    },
    store: { async stageAndActivate() {} },
    credentials: epochCredentials(),
    randomId: () => 'unused-id-000000',
  });

  const result = await client.discover({
    baseUrl: 'https://erp.example',
    extensionVersion: '1.2.0',
  });

  assert.equal(requests[0].url, 'https://erp.example/api/logistics-rules/assignments');
  assert.equal(requests[0].init.credentials, 'omit');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-access-token');
  assert.equal(result.state, 'ready');
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].assignmentId, 'assignment-a');
  assert.equal(result.assignments[0].originCityUid, 'xiamen');
  assert.equal(result.assignments[0].destinationLocationUid, 'moscow');
});

test('a 200 response must match every discovered namespace field before staging', async () => {
  const mismatches = [
    ['tenant', (payload) => { payload.scope.tenantId = 'tenant-b'; payload.revisionPayload.scope.tenantId = 'tenant-b'; }],
    ['shop', (payload) => { payload.scope.shopId = 'shop-b'; payload.revisionPayload.scope.shopId = 'shop-b'; }],
    ['company', (payload) => { payload.scope.ozonCompanyId = 'company-b'; payload.revisionPayload.scope.ozonCompanyId = 'company-b'; }],
    ['warehouse', (payload) => { payload.scope.warehouseId = 'warehouse-b'; payload.revisionPayload.scope.erpWarehouseId = 'warehouse-b'; }],
    ['origin country', (payload) => { payload.scope.originCountryUid = 'other-country'; payload.revisionPayload.scope.originCountryUid = 'other-country'; }],
    ['origin city', (payload) => { payload.scope.originCityUid = 'shenzhen'; payload.revisionPayload.scope.originCityUid = 'shenzhen'; }],
    ['destination country', (payload) => { payload.scope.destinationCountryUid = 'belarus'; payload.revisionPayload.scope.destinationCountryUid = 'belarus'; }],
    ['destination location', (payload) => { payload.scope.destinationLocationUid = 'minsk'; payload.revisionPayload.scope.destinationLocationUid = 'minsk'; }],
    ['deployment', (payload) => { payload.revisionPayload.scope.deploymentId = 'other-deployment'; }],
    ['schema major', (payload) => { payload.revisionPayload.scope.schemaMajor = 2; }],
  ];

  for (const [label, mutate] of mismatches) {
    const payload = scopedPayload();
    mutate(payload);
    let staged = 0;
    const client = loadClient({
      fetchImpl: async () => response(200, {
        code: 1,
        data: {
          deploymentId: 'local-dev',
          assignmentId: 'assignment-a',
          releaseId: 'release-1',
          releaseSequence: 1,
          contentChecksum: 'a'.repeat(64),
          effectiveChecksum: 'b'.repeat(64),
          minExtensionVersion: '1.0.0',
          validUntil: '2026-07-19T12:00:00.000Z',
          staleUntil: '2026-07-20T12:00:00.000Z',
          authorizationValidUntil: '2026-07-13T12:00:00.000Z',
          serverTime: '2026-07-12T12:00:00.000Z',
          bundle: payload,
        },
      }, { etag: '"release-1"' }),
      store: {
        async readPointer() { return null; },
        async stageAndActivate() { staged += 1; return { state: 'active' }; },
      },
      credentials: epochCredentials(),
      randomId: () => '0123456789abcdef',
    });

    await assert.rejects(client.refresh({
      baseUrl: 'https://erp.example',
      assignmentId: 'assignment-a',
      namespace,
      extensionVersion: '1.2.0',
    }), /scope mismatch/i, label);
    assert.equal(staged, 0, label);
  }
});

test('receipt authorization failures revoke the scoped cache without clearing credentials for 410', async () => {
  for (const status of [401, 403, 410]) {
    const revoked = [];
    const cleared = [];
    const pending = {
      effectiveChecksum: 'b'.repeat(64),
      idempotencyKey: '0123456789abcdef',
      releaseId: 'release-1',
      releaseSequence: 1,
    };
    const client = loadClient({
      fetchImpl: async () => response(status, {
        code: 0,
        errorCode: status === 403 ? 'insufficient_scope' : 'invalid_device_token',
        reasonCode: status === 410 ? 'assignment_retired' : undefined,
      }),
      store: {
        async readPendingReceipt() { return pending; },
        async markReceiptReported() {
          throw new Error('revoked receipt must not be reported');
        },
        async markRevoked(scope, input) {
          revoked.push({ scope, input });
        },
        async stageAndActivate() {
          throw new Error('not used');
        },
      },
      credentials: epochCredentials({
        async clearIfCurrent(_operation, input) { cleared.push(input); return true; },
      }),
      randomId: () => 'unused-id-000000',
    });

    const result = await client.flushPendingReceipt({
      baseUrl: 'https://erp.example',
      assignmentId: 'assignment-a',
      namespace,
      extensionVersion: '1.2.0',
    });

    assert.equal(result.state, 'revoked');
    assert.equal(result.status, status);
    assert.equal(revoked.length, 1);
    assert.equal(revoked[0].scope, namespace);
    assert.equal(revoked[0].input.status, status);
    assert.equal(cleared.length, status === 410 ? 0 : 1);
    if (status !== 410) {
      assert.equal(cleared[0].status, status);
      assert.equal(cleared[0].assignmentId, 'assignment-a');
    }
  }
});

test('stale authorization failures cannot revoke or mutate a newly paired tenant', async () => {
  for (const method of ['discover', 'refresh', 'flushPendingReceipt']) {
    for (const status of [401, 403, 410]) {
      const operation = { state: 'paired', epoch: 1, accessToken: 'old-device-token' };
      let current = true;
      let legacyClears = 0;
      let scopedRevocations = 0;
      let staged = 0;
      let reported = 0;
      const credentials = epochCredentials({
        operation,
        async isOperationCurrent(candidate) { return candidate === operation && current; },
        async clearIfCurrent() { return false; },
        async clear() { legacyClears += 1; },
      });
      const client = loadClient({
        fetchImpl: async () => {
          current = false;
          return response(status, {
            code: 0,
            errorCode: 'invalid_device_token',
            reasonCode: status === 410 ? 'assignment_retired' : undefined,
          });
        },
        store: {
          async readPointer() { return null; },
          async readPendingReceipt() {
            return {
              effectiveChecksum: 'b'.repeat(64),
              idempotencyKey: '0123456789abcdef',
              releaseId: 'release-1',
              releaseSequence: 1,
            };
          },
          async stageAndActivate() { staged += 1; return { state: 'active' }; },
          async markReceiptReported() { reported += 1; },
          async markRevoked() { scopedRevocations += 1; },
        },
        credentials,
        randomId: () => 'unused-id-000000',
      });
      const input = {
        baseUrl: 'https://erp.example',
        assignmentId: 'assignment-a',
        namespace,
        extensionVersion: '1.2.0',
      };

      const result = await client[method](input);

      assert.equal(result.state, 'superseded', `${method} ${status}`);
      assert.equal(legacyClears, 0, `${method} ${status}`);
      assert.equal(scopedRevocations, 0, `${method} ${status}`);
      assert.equal(staged, 0, `${method} ${status}`);
      assert.equal(reported, 0, `${method} ${status}`);
    }
  }
});