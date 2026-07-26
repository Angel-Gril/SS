import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
assert.equal(fs.existsSync(contractPath), true, `${contractPath} should exist`);

const context = {};
context.window = context;
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
const contract = context.SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT;
assert.ok(contract, 'browser contract should expose a single namespace');

assert.equal(contract.CONTRACT_VERSION, 'ai-image-workbench/v1');
assert.deepEqual(Array.from(contract.EXECUTION_MODES), ['ERP_HOSTED', 'BYOK']);
assert.equal(contract.parseExecutionMode('ERP_HOSTED'), 'ERP_HOSTED');
assert.equal(contract.parseExecutionMode('BYOK'), 'BYOK');
assert.throws(
  () => contract.parseExecutionMode('custom'),
  (error) => error && error.code === 'AI_IMAGE_WORKBENCH_MODE_INVALID',
);

assert.equal(
  contract.resolveExecutionMode({
    currentMode: 'ERP_HOSTED', requestedMode: 'BYOK', dispatched: false,
  }),
  'BYOK',
);
assert.throws(
  () => contract.resolveExecutionMode({
    currentMode: 'ERP_HOSTED', requestedMode: 'BYOK', dispatched: true,
  }),
  (error) => error && error.code === 'AI_IMAGE_WORKBENCH_MODE_LOCKED',
);

assert.equal(
  contract.ROUTES.ERP_HOSTED.execute,
  '/api/extension-device/media-workflows/execute',
);
assert.equal(contract.ROUTES.BYOK.ingest, '/api/extension-device/byok-media/ingest');
assert.equal(
  contract.ROUTES.BYOK.ingestStatus,
  '/api/extension-device/byok-media/ingest-status',
);
assert.notEqual(contract.ROUTES.ERP_HOSTED.execute, contract.ROUTES.BYOK.ingest);
assert.deepEqual(JSON.parse(JSON.stringify(contract.BYOK_INGEST_STATUS)), {
  contractVersion: 'extension-byok-media-ingest-status/v1',
  requestHashPattern: '^[a-f0-9]{64}$',
  states: { notCommitted: 'NOT_COMMITTED', pending: 'PENDING', succeeded: 'SUCCEEDED' },
});
assert.equal(contract.COMMANDS.ERP_HOSTED.execute, 'MEDIA_EXECUTE');
assert.equal(contract.COMMANDS.BYOK.execute, 'BYOK_PROVIDER_EXECUTE');
assert.equal(contract.COMMANDS.BYOK.ingest, 'BYOK_MEDIA_INGEST');

for (const payload of [
  { apiKey: 'secret' },
  { nested: { provider_api_key: 'secret' } },
  { authorization: 'Bearer secret' },
  { accessToken: 'secret' },
  { profile: { clientSecret: 'secret' } },
  { credentials: { value: 'secret' } },
  { commandGrant: 'secret' },
  { providerToken: 'secret' },
  { privateKey: 'secret' },
  { sk: 'secret' },
  { authHeader: 'secret' },
]) {
  assert.throws(
    () => contract.assertPublicPayload(payload),
    (error) => error && error.code === 'AI_IMAGE_WORKBENCH_SECRET_FIELD',
  );
}

const publicPayload = {
  schemaVersion: contract.CONTRACT_VERSION,
  executionMode: 'BYOK',
  provider: { origin: 'https://images.example.com', model: 'image-v1', hasKey: true },
};
assert.equal(contract.assertPublicPayload(publicPayload), publicPayload);

assert.equal(Object.isFrozen(contract.GLOBAL_STATES), true);
assert.equal(Object.isFrozen(contract.SLOT_STATES), true);
assert.equal(contract.transitionGlobalState('READY', 'PLANNING'), 'PLANNING');
assert.equal(contract.transitionGlobalState('PAUSING', 'PAUSED'), 'PAUSED');
assert.equal(contract.transitionSlotState('EMPTY', 'QUEUED'), 'QUEUED');
assert.equal(contract.transitionSlotState('CANDIDATE_READY', 'APPROVED'), 'APPROVED');
assert.equal(contract.transitionSlotState('APPROVED', 'INGESTING'), 'INGESTING');
assert.throws(
  () => contract.transitionGlobalState('READY', 'PUBLISHED'),
  (error) => error && error.code === 'AI_IMAGE_WORKBENCH_STATE_TRANSITION_INVALID',
);
assert.throws(
  () => contract.transitionSlotState('QUEUED', 'BOUND'),
  (error) => error && error.code === 'AI_IMAGE_WORKBENCH_SLOT_TRANSITION_INVALID',
);
assert.throws(
  () => contract.transitionGlobalState('UNKNOWN', 'READY'),
  (error) => error && error.code === 'AI_IMAGE_WORKBENCH_STATE_INVALID',
);
assert.throws(
  () => contract.transitionSlotState('EMPTY', 'UNKNOWN'),
  (error) => error && error.code === 'AI_IMAGE_WORKBENCH_SLOT_STATE_INVALID',
);

assert.equal(Object.isFrozen(contract.LIMITS), true);
assert.deepEqual(JSON.parse(JSON.stringify(contract.LIMITS)), {
  maxImagesPerRequest: 4,
  maxReferenceImages: 4,
  maxRequestBytes: 50 * 1024 * 1024,
  maxResultBytes: 20 * 1024 * 1024,
  maxDimension: 4096,
  maxPixels: 4096 * 4096,
  maxPromptCharacters: 8000,
  maxNegativePromptCharacters: 4000,
  maxConcurrency: 4,
  providerTimeoutMs: 120_000,
});
assert.equal(contract.resolveProviderOutcome({
  requestDispatched: false, responseReceived: false, definiteFailure: false,
}), 'FAILED_RETRYABLE');
assert.equal(contract.resolveProviderOutcome({
  requestDispatched: true, responseReceived: false, definiteFailure: false,
}), 'UNKNOWN_OUTCOME');
assert.equal(contract.resolveProviderOutcome({
  requestDispatched: true, responseReceived: true, definiteFailure: false,
}), 'SUCCEEDED');
assert.equal(contract.resolveProviderOutcome({
  requestDispatched: true, responseReceived: true, definiteFailure: true,
}), 'FAILED_FINAL');
assert.deepEqual(JSON.parse(JSON.stringify(contract.UNKNOWN_OUTCOME_POLICY)), {
  automaticRetryAllowed: false,
  recoveryRequirement: 'PROVIDER_LOOKUP_OR_STABLE_IDEMPOTENCY',
});
assert.throws(
  () => contract.resolveProviderOutcome({
    requestDispatched: false, responseReceived: true, definiteFailure: false,
  }),
  (error) => error && error.code === 'AI_IMAGE_WORKBENCH_OUTCOME_INPUT_INVALID',
);

console.log('PASS extension AI image workbench v1 contract');
