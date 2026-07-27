import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/execution-intent-client.js';
const context = {
  Array, Boolean, Error, JSON, Number, Object, String, URL, encodeURIComponent,
};
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });

const api = context.SS_ERP_BYOK_EXECUTION_INTENT_CLIENT;
const HASH = {
  request: 'a'.repeat(64),
  providerRequestId: 'b'.repeat(64),
  result: 'c'.repeat(64),
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function binding(overrides = {}) {
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
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    providerOrigin: 'https://relay.example',
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE',
    policyRevision: '23',
    ...overrides,
  };
}

function claimInput(overrides = {}) {
  return {
    readinessBinding: binding(),
    requestMode: 'json',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH.request,
    ...overrides,
  };
}

function claimData(overrides = {}, contextOverrides = {}) {
  return {
    contractVersion: 'extension-byok-execution-intent/v1',
    intentId: 'intent-1',
    replayed: false,
    executionMode: 'BYOK',
    outcome: 'PENDING',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH.request,
    context: {
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 7,
      draftVersion: 11,
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      ...contextOverrides,
    },
    ...overrides,
  };
}

function outcomeInput(overrides = {}) {
  return {
    intentId: 'intent-1',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH.request,
    outcome: 'SUCCEEDED',
    providerRequestIdSha256: HASH.providerRequestId,
    resultSha256: HASH.result,
    ...overrides,
  };
}

function outcomeData(input, overrides = {}) {
  return {
    contractVersion: 'extension-byok-execution-intent-outcome/v1',
    intentId: input.intentId,
    replayed: false,
    outcome: input.outcome,
    providerIdempotencyKey: input.providerIdempotencyKey,
    providerRequestHash: input.providerRequestHash,
    providerRequestIdSha256: input.providerRequestIdSha256,
    resultSha256: input.resultSha256,
    ...overrides,
  };
}

function success(status, data, bodyOverrides = {}) {
  return { state: 'response', status, body: { code: 1, data, ...bodyOverrides } };
}

function errorDump(error) {
  return JSON.stringify({
    name: error && error.name,
    message: error && error.message,
    code: error && error.code,
    outcome: error && error.outcome,
    automaticRetryAllowed: error && error.automaticRetryAllowed,
    operation: error && error.operation,
    state: error && error.state,
    status: error && error.status,
    enumerable: error && Object.fromEntries(Object.keys(error).map((key) => [key, error[key]])),
    stack: error && error.stack,
  });
}

async function expectSafeRejection(promise, expectedCode, sentinels, expectedOutcome) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'operation must reject');
  assert.equal(caught.code, expectedCode);
  if (expectedOutcome) assert.equal(caught.outcome, expectedOutcome);
  const dump = errorDump(caught);
  for (const sentinel of sentinels) {
    assert.equal(dump.includes(sentinel), false, `public error leaked ${sentinel}`);
  }
  return caught;
}

assert.equal(api.CONTRACT_VERSION, 'extension-byok-execution-intent-client/v1');
assert.equal(api.CLAIM_REQUEST_VERSION, 'extension-byok-execution-intent-request/v1');
assert.equal(api.CLAIM_RESPONSE_VERSION, 'extension-byok-execution-intent/v1');
assert.equal(
  api.OUTCOME_REQUEST_VERSION,
  'extension-byok-execution-intent-outcome-request/v1',
);
assert.equal(api.OUTCOME_RESPONSE_VERSION, 'extension-byok-execution-intent-outcome/v1');
assert.deepEqual(plain(api.OUTCOMES), ['SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME']);
assert.throws(
  () => api.createClient({}),
  (error) => error && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_DEPENDENCY_UNAVAILABLE',
);

const calls = [];
const scripted = [];
const client = api.createClient({
  transport: {
    async post(path, body, options) {
      calls.push({ path, body, options });
      const next = scripted.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  },
});

const claim = claimInput();
scripted.push(success(201, claimData()));
const claimed = await client.claim(claim);
assert.deepEqual(plain(claimed), claimData());
assert.equal(Object.isFrozen(claimed), true);
assert.equal(Object.isFrozen(claimed.context), true);
assert.equal(JSON.stringify(claimed).includes('relay.example'), false);
assert.deepEqual(plain(calls[0]), {
  path: '/api/extension-device/byok-media/execution-intents',
  body: {
    contractVersion: 'extension-byok-execution-intent-request/v1',
    binding: binding(),
    requestMode: 'json',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH.request,
  },
  options: { requiredScope: 'byok:media:ingest' },
});

scripted.push(success(200, claimData({ replayed: true })));
const replayedClaim = await client.claim(claim);
assert.equal(replayedClaim.replayed, true);
assert.equal(calls.length, 2, 'claim replay remains an explicit ERP round trip');

const succeededOutcome = outcomeInput();
scripted.push(success(201, outcomeData(succeededOutcome)));
const reported = await client.reportOutcome(succeededOutcome);
assert.deepEqual(plain(reported), outcomeData(succeededOutcome));
assert.equal(Object.isFrozen(reported), true);
assert.deepEqual(plain(calls[2]), {
  path: '/api/extension-device/byok-media/execution-intents/intent-1/outcome',
  body: {
    contractVersion: 'extension-byok-execution-intent-outcome-request/v1',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH.request,
    outcome: 'SUCCEEDED',
    providerRequestIdSha256: HASH.providerRequestId,
    resultSha256: HASH.result,
  },
  options: { requiredScope: 'byok:media:ingest' },
});

scripted.push(success(200, outcomeData(succeededOutcome, { replayed: true })));
const replayedOutcome = await client.reportOutcome(succeededOutcome);
assert.equal(replayedOutcome.replayed, true);
assert.equal(calls.length, 4, 'outcome replay remains an explicit ERP round trip');

for (const terminalOutcome of ['FAILED_FINAL', 'UNKNOWN_OUTCOME']) {
  const input = outcomeInput({
    intentId: `intent-${terminalOutcome.toLowerCase()}`,
    outcome: terminalOutcome,
    providerRequestIdSha256: null,
    resultSha256: null,
  });
  scripted.push(success(201, outcomeData(input)));
  assert.equal((await client.reportOutcome(input)).outcome, terminalOutcome);
}

for (const slotKey of [
  'sku:sku-1:hero',
  'shared:detail:SCENE',
  'shared:detail:DETAIL',
  'shared:detail:SPEC',
  'shared:detail:PACKAGING',
]) {
  const input = claimInput({ readinessBinding: binding({ slotKey }) });
  scripted.push(success(201, claimData({}, { slotKey })));
  const slotClaim = await client.claim(input);
  assert.equal(slotClaim.context.slotKey, slotKey);
  assert.equal(slotClaim.outcome, 'PENDING');
}

let invalidDispatches = 0;
const invalidClient = api.createClient({
  transport: {
    async post() {
      invalidDispatches += 1;
      throw new Error('must not dispatch');
    },
  },
});

const rawOriginSentinel = 'https://relay.example?api_key=raw-origin-secret';
const invalidClaims = [
  { ...claimInput(), unknown: true },
  claimInput({ readinessBinding: binding({ unknown: true }) }),
  claimInput({ readinessBinding: binding({ providerOrigin: rawOriginSentinel }) }),
  claimInput({ readinessBinding: binding({ slotKey: 'sku:sku-1:detail:1' }) }),
  claimInput({ readinessBinding: binding({ slotKey: 'group:visual-1:detail:SCENE' }) }),
  claimInput({ readinessBinding: binding({ slotKey: 'shared:detail:FUNCTION' }) }),
  claimInput({ readinessBinding: binding({ slotKey: 'shared:detail:SPECIFICATION' }) }),
  claimInput({ readinessBinding: binding({ slotKey: 'shared:detail:scene' }) }),
  claimInput({ readinessBinding: binding({ slotKey: 'shared:detail:SCENE:extra' }) }),
  claimInput({
    readinessBinding: binding({
      slotKey: 'shared:detail:SCENE',
      assignmentMode: 'REPLACE',
    }),
  }),
  claimInput({ readinessBinding: binding({ policyRevision: '0' }) }),
  claimInput({ requestMode: 'multipart' }),
  claimInput({ providerIdempotencyKey: 'too-short' }),
  claimInput({ providerRequestHash: 'A'.repeat(64) }),
];
for (const invalid of invalidClaims) {
  await expectSafeRejection(
    invalidClient.claim(invalid),
    'SS_ERP_BYOK_EXECUTION_INTENT_INPUT_INVALID',
    [rawOriginSentinel, 'raw-origin-secret'],
    'FAILED_FINAL',
  );
}

const invalidOutcomes = [
  { ...outcomeInput(), unknown: true },
  outcomeInput({ outcome: 'FAILED_RETRYABLE' }),
  outcomeInput({ resultSha256: null }),
  outcomeInput({ outcome: 'FAILED_FINAL', resultSha256: HASH.result }),
  outcomeInput({ providerRequestHash: 'A'.repeat(64) }),
  outcomeInput({ providerRequestIdSha256: 'short' }),
  outcomeInput({ providerIdempotencyKey: 'too-short' }),
];
for (const invalid of invalidOutcomes) {
  await expectSafeRejection(
    invalidClient.reportOutcome(invalid),
    'SS_ERP_BYOK_EXECUTION_INTENT_INPUT_INVALID',
    [],
    'FAILED_FINAL',
  );
}
assert.equal(invalidDispatches, 0, 'closed invalid input must fail before ERP I/O');

async function malformedClaim(response) {
  const malformedClient = api.createClient({ transport: { async post() { return response; } } });
  return malformedClient.claim(claimInput());
}

for (const response of [
  success(201, claimData({ rawProviderOrigin: rawOriginSentinel })),
  success(201, claimData({}, { workflowId: 'other-workflow' })),
  success(201, claimData({ replayed: true })),
  success(201, claimData({ intentId: 'x'.repeat(201) })),
  success(201, claimData(), { extra: 'closed-envelope' }),
  { state: 'response', status: 200, body: { code: 0, msg: rawOriginSentinel } },
]) {
  await expectSafeRejection(
    malformedClaim(response),
    'SS_ERP_BYOK_EXECUTION_INTENT_RESPONSE_INVALID',
    [rawOriginSentinel, 'raw-origin-secret'],
    'FAILED_RETRYABLE',
  );
}

const rejectedSecret = 'server-secret-credential';
await expectSafeRejection(
  malformedClaim({
    state: 'http_error',
    status: 409,
    body: {
      code: 0,
      errorCode: `byok_${rejectedSecret}`,
      msg: `${rawOriginSentinel} ${rejectedSecret}`,
    },
  }),
  'SS_ERP_BYOK_EXECUTION_INTENT_REJECTED',
  [rawOriginSentinel, 'raw-origin-secret', rejectedSecret],
  'FAILED_FINAL',
);

const transportSecret = 'transport-stack-secret';
const throwingClient = api.createClient({
  transport: { async post() { throw new Error(`${transportSecret} ${rawOriginSentinel}`); } },
});
await expectSafeRejection(
  throwingClient.claim(claimInput()),
  'SS_ERP_BYOK_EXECUTION_INTENT_UNAVAILABLE',
  [transportSecret, rawOriginSentinel, 'raw-origin-secret'],
  'FAILED_RETRYABLE',
);

await expectSafeRejection(
  malformedClaim({
    state: `${rawOriginSentinel}:${transportSecret}`,
    status: 503,
    body: { msg: transportSecret },
  }),
  'SS_ERP_BYOK_EXECUTION_INTENT_UNAVAILABLE',
  [transportSecret, rawOriginSentinel, 'raw-origin-secret'],
  'FAILED_RETRYABLE',
);

async function malformedOutcome(response, input = outcomeInput()) {
  const malformedClient = api.createClient({ transport: { async post() { return response; } } });
  return malformedClient.reportOutcome(input);
}

for (const response of [
  success(201, outcomeData(succeededOutcome, { contractVersion: 'wrong/v1' })),
  success(201, outcomeData(succeededOutcome, { providerRequestHash: 'd'.repeat(64) })),
  success(201, outcomeData(succeededOutcome, { resultSha256: null })),
  success(201, outcomeData(succeededOutcome, { replayed: true })),
  success(201, { ...outcomeData(succeededOutcome), rawProviderOrigin: rawOriginSentinel }),
]) {
  await expectSafeRejection(
    malformedOutcome(response),
    'SS_ERP_BYOK_EXECUTION_INTENT_RESPONSE_INVALID',
    [rawOriginSentinel, 'raw-origin-secret'],
    'FAILED_RETRYABLE',
  );
}

await expectSafeRejection(
  malformedOutcome({
    state: 'http_error', status: 503, body: { code: 0, msg: rawOriginSentinel },
  }),
  'SS_ERP_BYOK_EXECUTION_INTENT_UNAVAILABLE',
  [rawOriginSentinel, 'raw-origin-secret'],
  'FAILED_RETRYABLE',
);

console.log('extension BYOK execution intent client tests passed');
