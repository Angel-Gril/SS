import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';

const schemaPath = 'extensions/ss-erp/shared/byok/profile-schema.js';
const permissionPath = 'extensions/ss-erp/shared/byok/permission-broker.js';
const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const inspectorPath = 'extensions/ss-erp/shared/byok/image-input-inspector.js';
const adaptersPath = 'extensions/ss-erp/shared/byok/image-edit-adapters.js';
const clientPath = 'extensions/ss-erp/shared/byok/image-edit-client.js';

const schemaSource = fs.readFileSync(schemaPath, 'utf8');
const permissionSource = fs.readFileSync(permissionPath, 'utf8');
const contractSource = fs.readFileSync(contractPath, 'utf8');
const inspectorSource = fs.existsSync(inspectorPath) ? fs.readFileSync(inspectorPath, 'utf8') : '';
const adaptersSource = fs.existsSync(adaptersPath) ? fs.readFileSync(adaptersPath, 'utf8') : '';
const clientSource = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, 'utf8') : '';

const MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
const NOW = new Date('2026-07-27T08:00:00.000Z');
const CREDENTIAL_REVISION = '1'.repeat(64);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function uint32(value) {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function syntheticPng(width, height, marker = 0x55) {
  assert.ok(Number.isSafeInteger(width) && width > 0);
  assert.ok(Number.isSafeInteger(height) && height > 0);
  const header = Buffer.from([
    ...uint32(width),
    ...uint32(height),
    0x08, 0x06, 0x00, 0x00, 0x00,
  ]);
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    rows.push(Buffer.concat([
      Buffer.from([0]),
      Buffer.alloc(width * 4, marker),
    ]));
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

const outputPng = syntheticPng(4, 4, 0x66);

function imageBlob(width = 4, height = 4, marker = 0x55) {
  return new Blob([syntheticPng(width, height, marker)], { type: 'image/png' });
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

function profile(overrides = {}) {
  return {
    id: 'edit-profile-1',
    name: 'Image edit relay',
    baseUrl: 'https://relay.example/v1',
    model: 'image-edit-model-v1',
    allowedOperations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
    preferences: {
      defaultSize: '1024x1024',
      quality: 'auto',
      outputFormat: 'png',
    },
    ...overrides,
  };
}

function readiness(operation, overrides = {}) {
  return {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    sourcePlatform: '1688',
    sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    providerOrigin: 'https://relay.example',
    model: 'image-edit-model-v1',
    operation,
    policyRevision: 'policy-9',
    ...overrides,
  };
}

function executionIntentReceipt(input, overrides = {}) {
  const binding = input.readinessBinding;
  return {
    contractVersion: 'extension-byok-execution-intent/v1',
    intentId: `intent-${input.providerIdempotencyKey}`,
    replayed: false,
    executionMode: 'BYOK',
    outcome: 'PENDING',
    providerIdempotencyKey: input.providerIdempotencyKey,
    providerRequestHash: input.providerRequestHash,
    context: {
      shopId: binding.shopId,
      workflowId: binding.workflowId,
      draftRevision: binding.draftRevision,
      draftVersion: binding.draftVersion,
      skuKey: binding.skuKey,
      slotKey: binding.slotKey,
    },
    ...overrides,
  };
}

function executionIntentOutcomeReceipt(input, overrides = {}) {
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

function evidence(operation, requestMode = 'multipart', overrides = {}) {
  return {
    contractVersion: 'extension-byok-capability/v1',
    profileIdentity: 'https://relay.example/v1\u0000image-edit-model-v1',
    operation,
    requestMode,
    policyRevision: 'policy-9',
    verifiedAt: '2026-07-27T07:55:00.000Z',
    expiresAt: '2026-07-27T08:05:00.000Z',
    ...overrides,
  };
}

function editRequest(operation, overrides = {}) {
  const mask = operation === 'INPAINT'
    ? { blob: imageBlob(4, 4, 0x22), maskSemantics: MASK_SEMANTICS }
    : null;
  return {
    profileId: 'edit-profile-1',
    operation,
    prompt: 'Keep the exact product and create a clean marketplace image',
    negativePrompt: 'text, watermark',
    size: '1024x1024',
    idempotencyKey: `edit-${operation.toLowerCase()}-0001`,
    readinessBinding: readiness(operation),
    images: [imageBlob(4, 4)],
    mask,
    ...overrides,
  };
}

function createPermissions(grantedOrigins = ['https://relay.example/*']) {
  const granted = new Set(grantedOrigins);
  return {
    async contains(input) {
      return input.origins.length === 1 && granted.has(input.origins[0]);
    },
    async request(input) {
      if (!input || input.origins.length !== 1) return false;
      granted.add(input.origins[0]);
      return true;
    },
    async remove(input) {
      return Boolean(input && input.origins.length === 1 && granted.delete(input.origins[0]));
    },
  };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => (
    [key, JSON.parse(JSON.stringify(value))]
  )));
  return {
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested
        .filter((key) => values.has(key))
        .map((key) => [key, JSON.parse(JSON.stringify(values.get(key)))]));
    },
    async set(input) {
      for (const [key, value] of Object.entries(input)) {
        values.set(key, JSON.parse(JSON.stringify(value)));
      }
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    seed(key, value) {
      values.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

function loadClient(options = {}) {
  class TestEvent {
    constructor(isTrusted) { this.isTrusted = isTrusted; }
  }
  TestEvent.prototype.composedPath = function composedPath() { return []; };
  const context = {
    AbortController, Array, ArrayBuffer, Blob, Boolean, Date, DOMException, Error, Event: TestEvent,
    File, FormData, JSON, Map, Math, Number, Object, Promise, Response, Set, String, TextDecoder,
    TextEncoder, TypeError, URL, URLSearchParams, Uint8Array, WeakMap, WeakSet, atob, btoa,
    clearTimeout, crypto: webcrypto, setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(schemaSource, context, { filename: schemaPath });
  vm.runInNewContext(permissionSource, context, { filename: permissionPath });
  vm.runInNewContext(contractSource, context, { filename: contractPath });
  vm.runInNewContext(inspectorSource, context, { filename: inspectorPath });
  vm.runInNewContext(adaptersSource, context, { filename: adaptersPath });
  vm.runInNewContext(clientSource, context, { filename: clientPath });

  assert.ok(context.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR, 'image-input-inspector global is missing');
  assert.ok(context.SS_ERP_BYOK_IMAGE_EDIT_ADAPTERS, 'image-edit-adapters global is missing');
  assert.ok(context.SS_ERP_BYOK_IMAGE_EDIT_CLIENT, 'image-edit-client global is missing');
  assert.equal(typeof context.SS_ERP_BYOK_IMAGE_EDIT_CLIENT.createClient, 'function');
  assert.equal(context.SS_ERP_BYOK_IMAGE_EDIT_CLIENT.LIMITS.providerTimeoutMs, 240_000);

  const selectedProfile = options.profile || profile();
  const selectedProfileIdentity = context.SS_ERP_BYOK_PROFILE_SCHEMA.profileIdentity(selectedProfile);
  const adapterApi = context.SS_ERP_BYOK_IMAGE_EDIT_ADAPTERS;
  const adapter = options.adapter || adapterApi.OPENAI_MULTIPART_SYNC;
  assert.ok(adapter, 'selected image edit adapter is missing');
  assert.equal(typeof adapter.id, 'string');

  const requestMode = adapter.requestMode;
  const storeCalls = [];
  const executionIntentCalls = [];
  let credentialReads = 0;
  let dispatches = 0;
  const currentEvidence = options.evidence === undefined
    ? ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].map((operation) => evidence(operation, requestMode))
    : options.evidence;
  const profileStore = {
    async getProfile(id) {
      storeCalls.push({ method: 'getProfile', id });
      return id === selectedProfile.id ? selectedProfile : null;
    },
    async getCredentialSnapshotForBackground(id) {
      credentialReads += 1;
      storeCalls.push({ method: 'getCredentialSnapshotForBackground', id });
      return id === selectedProfile.id ? {
        profile: selectedProfile,
        apiKey: 'sk-image-edit-secret-sentinel',
        credentialRevision: CREDENTIAL_REVISION,
        evidence: currentEvidence,
      } : null;
    },
    async assertCredentialRevisionForBackground(id, expectedIdentity, expectedRevision) {
      storeCalls.push({ method: 'assertCredentialRevisionForBackground', id });
      assert.equal(id, selectedProfile.id);
      assert.equal(expectedIdentity, selectedProfileIdentity);
      assert.equal(expectedRevision, CREDENTIAL_REVISION);
      return { current: true };
    },
    async commitWithCredentialRevisionForBackground(id, identity, revision, commit) {
      await this.assertCredentialRevisionForBackground(id, identity, revision);
      return commit();
    },
    async beginProviderDispatch(id, value, expectedRevision) {
      dispatches += 1;
      storeCalls.push({ method: 'beginProviderDispatch', id, value, expectedRevision });
      return { started: true };
    },
    async recordAcceptedProviderTask(id, value, expectedRevision) {
      storeCalls.push({ method: 'recordAcceptedProviderTask', id, value, expectedRevision });
      return { recorded: true };
    },
    async beginCapabilityProbe(id, value, expectedRevision) {
      storeCalls.push({ method: 'beginCapabilityProbe', id, value, expectedRevision });
      return { started: true };
    },
    async markCapabilityProbeUncertain(id, value, expectedRevision) {
      storeCalls.push({ method: 'markCapabilityProbeUncertain', id, value, expectedRevision });
      return { recorded: true };
    },
    async discardPendingCapabilityProbe(id, value, expectedRevision) {
      storeCalls.push({ method: 'discardPendingCapabilityProbe', id, value, expectedRevision });
      return { cleared: true };
    },
    async setCapabilityEvidence(id, value, expectedRevision) {
      storeCalls.push({ method: 'setCapabilityEvidence', id, value, expectedRevision });
      assert.equal(expectedRevision, CREDENTIAL_REVISION);
      return value;
    },
  };
  Object.assign(profileStore, options.profileStoreOverrides || {});

  const executionIntentClient = {
    async claim(value) {
      executionIntentCalls.push({ method: 'claim', value: plain(value) });
      return executionIntentReceipt(value);
    },
    async reportOutcome(value) {
      executionIntentCalls.push({ method: 'reportOutcome', value: plain(value) });
      return executionIntentOutcomeReceipt(value);
    },
  };
  Object.assign(executionIntentClient, options.executionIntentClientOverrides || {});

  const permissionStorage = createStorage();
  const consent = { 'https://relay.example': true };
  for (const origin of options.additionalConsentOrigins || []) consent[origin] = true;
  permissionStorage.seed(
    context.SS_ERP_BYOK_PERMISSION_BROKER.SESSION_CONSENT_STORAGE_KEY,
    consent,
  );
  const permissionBroker = context.SS_ERP_BYOK_PERMISSION_BROKER.createBroker({
    permissions: options.permissions || createPermissions(),
    sessionStorage: permissionStorage,
  });
  const client = context.SS_ERP_BYOK_IMAGE_EDIT_CLIENT.createClient({
    profileStore,
    executionIntentClient,
    stageResult: options.stageResult,
    permissionBroker,
    imageInputInspector: context.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR,
    maskTransformer: {
      async toOpenAiMask(input) {
        return {
          blob: input.blob,
          width: input.width,
          height: input.height,
          maskSemantics: adapter.maskSemantics,
        };
      },
    },
    probeMediaFactory: options.probeMediaFactory,
    adapter,
    fetchImpl: options.fetchImpl,
    authorizeResultOrigin: options.authorizeResultOrigin,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs ?? 0,
    crypto: webcrypto,
    now: options.now || (() => new Date(NOW)),
  });
  return {
    adapterApi,
    client,
    permissionBroker,
    profileStore,
    executionIntentCalls,
    storeCalls,
    get credentialReads() { return credentialReads; },
    get dispatches() { return dispatches; },
  };
}

function formKeys(form) {
  return [...new Set([...form.keys()])].sort();
}

test('prepares an opaque edit request without credential, claim, persistence, or network I/O', async () => {
  let fetchCalls = 0;
  let permissionChecks = 0;
  const loaded = loadClient({
    evidence: [evidence('FULL_EDIT')],
    permissions: {
      async contains() { permissionChecks += 1; return true; },
      async request() { throw new Error('must not request permission'); },
      async remove() { return false; },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] });
    },
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'provider-prepared-edit-0001',
  });

  const prepared = await loaded.client.prepareDispatch(input);

  assert.deepEqual(Object.keys(prepared).sort(), [
    'contractVersion',
    'operation',
    'preparedRequestHandle',
    'providerIdempotencyKey',
    'providerRequestHash',
    'requestMode',
  ]);
  assert.equal(prepared.contractVersion, 'extension-byok-prepared-provider-request/v1');
  assert.equal(prepared.operation, 'FULL_EDIT');
  assert.equal(prepared.requestMode, 'multipart');
  assert.equal(prepared.providerIdempotencyKey, input.idempotencyKey);
  assert.match(prepared.providerRequestHash, /^[a-f0-9]{64}$/u);
  assert.match(prepared.preparedRequestHandle, /^[a-zA-Z0-9:_-]{20,200}$/u);
  assert.equal(JSON.stringify(prepared).includes(input.prompt), false);
  assert.equal(JSON.stringify(prepared).includes('relay.example'), false);
  assert.equal(fetchCalls, 0);
  assert.equal(permissionChecks, 0);
  assert.equal(loaded.credentialReads, 0);
  assert.equal(loaded.dispatches, 0);
  assert.deepEqual(loaded.executionIntentCalls, []);

  const result = await loaded.client.dispatchPrepared(prepared.preparedRequestHandle);
  assert.equal(result.requestHash, prepared.providerRequestHash);
  assert.equal(fetchCalls, 1);
  assert.equal(permissionChecks > 0, true);
  assert.equal(loaded.credentialReads, 1);
  assert.equal(loaded.dispatches, 1);
  assert.deepEqual(
    loaded.executionIntentCalls.map((call) => call.method),
    ['claim', 'reportOutcome'],
  );
  assert.equal(
    loaded.executionIntentCalls[0].value.providerRequestHash,
    prepared.providerRequestHash,
  );
  await assert.rejects(
    loaded.client.dispatchPrepared(prepared.preparedRequestHandle),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_PREPARED_REQUEST_CONSUMED'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(fetchCalls, 1);
});

test('rejects forged or released edit preparation handles without Provider I/O', async () => {
  let fetchCalls = 0;
  const loaded = loadClient({
    evidence: [evidence('FULL_EDIT')],
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('must not dispatch');
    },
  });
  await assert.rejects(
    loaded.client.prepareDispatch({
      ...editRequest('FULL_EDIT', { idempotencyKey: 'provider-forged-hash-edit-0001' }),
      providerRequestHash: 'f'.repeat(64),
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID',
  );
  const prepared = await loaded.client.prepareDispatch(editRequest('FULL_EDIT', {
    idempotencyKey: 'provider-prepared-release-edit-0001',
  }));
  assert.deepEqual(plain(loaded.client.releasePrepared(prepared.preparedRequestHandle)), {
    released: true,
  });
  assert.deepEqual(plain(loaded.client.releasePrepared(prepared.preparedRequestHandle)), {
    released: false,
  });
  for (const forged of [
    prepared,
    'byok-prepared:00000000-0000-4000-8000-000000000000',
    prepared.preparedRequestHandle,
  ]) {
    await assert.rejects(
      loaded.client.dispatchPrepared(forged),
      (error) => error && [
        'SS_ERP_BYOK_IMAGE_EDIT_PREPARED_REQUEST_INVALID',
        'SS_ERP_BYOK_IMAGE_EDIT_PREPARED_REQUEST_UNAVAILABLE',
      ].includes(error.code),
    );
  }
  assert.equal(fetchCalls, 0);
  assert.equal(loaded.credentialReads, 0);
  assert.equal(loaded.dispatches, 0);
  assert.deepEqual(loaded.executionIntentCalls, []);
});

test('uses exact OpenAI multipart fields for reference, full-edit, and inpaint operations', async () => {
  const cases = [
    {
      operation: 'IMAGE_TO_IMAGE',
      images: [imageBlob(4, 4, 0x11), imageBlob(5, 5, 0x12)],
      expectedImageField: 'image[]',
      expectedKeys: ['image[]', 'model', 'n', 'prompt', 'size'],
    },
    {
      operation: 'FULL_EDIT',
      images: [imageBlob(4, 4, 0x13)],
      expectedImageField: 'image',
      expectedKeys: ['image', 'model', 'n', 'prompt', 'size'],
    },
    {
      operation: 'INPAINT',
      images: [imageBlob(4, 4, 0x14)],
      expectedImageField: 'image',
      expectedKeys: ['image', 'mask', 'model', 'n', 'prompt', 'size'],
    },
  ];

  for (const item of cases) {
    const calls = [];
    const loaded = loadClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({
          id: `provider-${item.operation.toLowerCase()}`,
          data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
        });
      },
    });
    const result = await loaded.client.edit(editRequest(item.operation, {
      idempotencyKey: `multipart-${item.operation.toLowerCase()}-0001`,
      images: item.images,
    }));

    assert.equal(result.outcome, 'SUCCEEDED');
    assert.equal(result.operation, item.operation);
    assert.equal(result.requestMode, 'multipart');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://relay.example/v1/images/edits');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'omit');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-image-edit-secret-sentinel');
    assert.equal(calls[0].init.headers['Idempotency-Key'], `multipart-${item.operation.toLowerCase()}-0001`);
    assert.equal('Content-Type' in calls[0].init.headers, false);

    const form = calls[0].init.body;
    assert.ok(form instanceof FormData);
    assert.deepEqual(formKeys(form), item.expectedKeys.slice().sort());
    assert.equal(form.get('model'), 'image-edit-model-v1');
    assert.equal(
      form.get('prompt'),
      'Keep the exact product and create a clean marketplace image\n\nAvoid: text, watermark',
    );
    assert.equal(form.get('n'), '1');
    assert.equal(form.get('size'), '1024x1024');
    assert.equal(form.getAll(item.expectedImageField).length, item.images.length);
    assert.ok(form.getAll(item.expectedImageField).every((value) => value instanceof Blob));
    assert.equal(form.has(item.expectedImageField === 'image' ? 'image[]' : 'image'), false);
    if (item.operation === 'INPAINT') {
      assert.match(form.get('mask').type, /^image\/png$/u);
      assert.equal(form.has('maskSemantics'), false);
      assert.equal(form.has('mask_semantics'), false);
    } else {
      assert.equal(form.has('mask'), false);
    }
  }
});

for (const operation of ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']) {
  test(`accepts image metadata in ${operation} without leaking it into outcome evidence`, async () => {
    let fetchCalls = 0;
    const loaded = loadClient({
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({
          created: 123,
          data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
          background: 'opaque', output_format: 'png', quality: 'high', size: '1024x1024',
          usage: {
            input_tokens: 25, output_tokens: 100, total_tokens: 125,
            input_tokens_details: { image_tokens: 20, text_tokens: 5 },
          },
        });
      },
    });
    const result = await loaded.client.edit(editRequest(operation));
    assert.equal(result.outcome, 'SUCCEEDED');
    assert.equal(result.image.sha256, createHash('sha256').update(outputPng).digest('hex'));
    assert.equal(fetchCalls, 1);
    assert.deepEqual(loaded.executionIntentCalls.map((call) => call.method), ['claim', 'reportOutcome']);
    assert.equal(loaded.executionIntentCalls[1].value.outcome, 'SUCCEEDED');
    for (const field of ['usage', 'background', 'output_format', 'quality', 'size']) {
      assert.equal(Object.hasOwn(result, field), false);
      assert.equal(Object.hasOwn(loaded.executionIntentCalls[1].value, field), false);
    }
  });

  test(`sends multiline positive and negative prompts in ${operation} multipart requests`, async () => {
    const calls = [];
    const prompt = 'Keep the exact product.\nUse a clean background.\r\nLighting:\tsoft';
    const negativePrompt = 'watermark\nextra text\rDistortion:\tnone';
    const loaded = loadClient({
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] });
      },
    });

    const result = await loaded.client.edit(editRequest(operation, { prompt, negativePrompt }));

    assert.equal(result.outcome, 'SUCCEEDED');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body.get('prompt'), `${prompt}\n\nAvoid: ${negativePrompt}`);
    assert.equal(result.promptHash, sha256Text(prompt));
    assert.equal(result.negativePromptHash, sha256Text(negativePrompt));
  });
}

test('rejects non-text controls in edit prompts before credentials, intent, or network I/O', async () => {
  let fetchCalls = 0;
  const loaded = loadClient({
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Provider fetch must not run');
    },
  });
  for (const control of ['\u0000', '\u0008', '\u000b', '\u000c', '\u001b', '\u001f', '\u007f']) {
    for (const field of ['prompt', 'negativePrompt']) {
      await assert.rejects(
        loaded.client.edit(editRequest('FULL_EDIT', { [field]: `Keep${control}product` })),
        (error) => error?.code === 'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID'
          && error.outcome === 'FAILED_RETRYABLE',
      );
    }
  }
  assert.equal(loaded.credentialReads, 0);
  assert.equal(loaded.dispatches, 0);
  assert.deepEqual(loaded.executionIntentCalls, []);
  assert.equal(fetchCalls, 0);
});

test('normalizes a bare OpenAI-compatible origin to the effective v1 edits endpoint', async () => {
  const calls = [];
  const loaded = loadClient({
    profile: profile({ baseUrl: 'https://relay.example' }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] });
    },
  });

  await loaded.client.edit(editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-bare-origin-0001',
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://relay.example/v1/images/edits');
});

test('claims an exact execution intent before Provider dispatch and reports the successful result', async () => {
  const events = [];
  let claimInput;
  let outcomeInput;
  const loaded = loadClient({
    executionIntentClientOverrides: {
      async claim(input) {
        events.push('claim');
        claimInput = plain(input);
        return executionIntentReceipt(input);
      },
      async reportOutcome(input) {
        events.push('reportOutcome');
        outcomeInput = plain(input);
        return executionIntentOutcomeReceipt(input);
      },
    },
    fetchImpl: async () => {
      events.push('providerPost');
      return jsonResponse({
        id: 'edit-execution-intent-provider-request-1',
        data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
      });
    },
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-execution-intent-success-0001',
  });
  const result = await loaded.client.edit(input);

  assert.deepEqual(events, ['claim', 'providerPost', 'reportOutcome']);
  assert.deepEqual(claimInput, {
    readinessBinding: readiness('FULL_EDIT'),
    requestMode: 'multipart',
    providerIdempotencyKey: input.idempotencyKey,
    providerRequestHash: result.requestHash,
  });
  assert.equal(result.executionIntentId, `intent-${input.idempotencyKey}`);
  assert.deepEqual(outcomeInput, {
    intentId: result.executionIntentId,
    providerIdempotencyKey: input.idempotencyKey,
    providerRequestHash: result.requestHash,
    outcome: 'SUCCEEDED',
    providerRequestIdSha256: sha256Text('edit-execution-intent-provider-request-1'),
    resultSha256: result.image.sha256,
  });
  assert.equal(
    loaded.client.getOperationState(input.idempotencyKey).executionIntentId,
    result.executionIntentId,
  );
});

test('escrows the completed edit result before reporting SUCCEEDED', async () => {
  let staged = false;
  const stagedResultId = `br_${'b'.repeat(48)}`;
  const loaded = loadClient({
    stageResult: async (result, binding) => {
      assert.equal(result.outcome, 'SUCCEEDED');
      assert.equal(result.operation, 'FULL_EDIT');
      assert.equal(result.image.blob instanceof Blob, true);
      assert.equal(binding.operation, 'FULL_EDIT');
      staged = true;
      return { resultId: stagedResultId };
    },
    executionIntentClientOverrides: {
      async reportOutcome(value) {
        loaded.executionIntentCalls.push({ method: 'reportOutcome', value: plain(value) });
        assert.equal(staged, true, 'durable escrow must precede the success report');
        return executionIntentOutcomeReceipt(value);
      },
    },
    fetchImpl: async () => jsonResponse({
      data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
    }),
  });

  const edited = await loaded.client.edit(editRequest('FULL_EDIT', {
    idempotencyKey: 'escrow-edit-1',
  }));

  assert.equal(edited.escrowResultId, stagedResultId);
});

test('holds exact permission and credential authority through durable edit-result staging', async () => {
  const events = [];
  let releaseStage;
  let stageStarted = false;
  let authorityQueue = Promise.resolve();
  function enqueueAuthority(operation) {
    const next = authorityQueue.then(operation, operation);
    authorityQueue = next.catch(() => {});
    return next;
  }
  const loaded = loadClient({
    profileStoreOverrides: {
      commitWithCredentialRevisionForBackground(id, identity, revision, commit) {
        return enqueueAuthority(async () => {
          events.push('credential-commit-start');
          assert.equal(id, 'edit-profile-1');
          assert.equal(typeof identity, 'string');
          assert.equal(revision, CREDENTIAL_REVISION);
          try { return await commit(); } finally { events.push('credential-commit-end'); }
        });
      },
    },
    stageResult: async () => {
      events.push('stage-start');
      stageStarted = true;
      await new Promise((resolve) => { releaseStage = resolve; });
      events.push('stage-end');
      return { resultId: `br_${'d'.repeat(48)}` };
    },
    fetchImpl: async () => jsonResponse({
      data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
    }),
  });
  const pending = loaded.client.edit(editRequest('FULL_EDIT', {
    idempotencyKey: 'stage-authority-edit-1',
  }));
  while (!stageStarted) await new Promise((resolve) => setTimeout(resolve, 0));
  let rotationSettled = false;
  const rotation = enqueueAuthority(async () => { events.push('credential-rotation'); })
    .finally(() => { rotationSettled = true; });
  let revocationSettled = false;
  const revocation = loaded.permissionBroker.removeOriginPermission('https://relay.example/v1')
    .finally(() => { revocationSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(rotationSettled, false, 'credential rotation must wait for staging');
  assert.equal(revocationSettled, false, 'permission revocation must wait for staging');
  releaseStage();
  await Promise.all([pending, rotation, revocation]);
  assert.deepEqual(events, [
    'credential-commit-start',
    'stage-start',
    'stage-end',
    'credential-commit-end',
    'credential-rotation',
  ]);
});

test('fails closed without a second edit POST when result escrow is unavailable', async () => {
  let postCount = 0;
  const loaded = loadClient({
    stageResult: async () => {
      throw Object.assign(new Error('escrow unavailable'), {
        code: 'SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE',
      });
    },
    fetchImpl: async () => {
      postCount += 1;
      return jsonResponse({
        data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
      });
    },
  });
  const input = editRequest('FULL_EDIT', { idempotencyKey: 'escrow-edit-failure-1' });

  await assert.rejects(
    loaded.client.edit(input),
    (error) => error?.code === 'SS_ERP_BYOK_IMAGE_EDIT_RESULT_ESCROW_UNAVAILABLE'
      && error?.outcome === 'UNKNOWN_OUTCOME'
      && error?.automaticRetryAllowed === false,
  );
  await assert.rejects(loaded.client.edit(input));
  assert.equal(postCount, 1);
  assert.deepEqual(
    loaded.executionIntentCalls.map((call) => [call.method, call.value.outcome || null]),
    [['claim', null], ['reportOutcome', 'UNKNOWN_OUTCOME']],
  );
});

test('stops without dispatch when execution intent claim fails', async () => {
  let fetchCalls = 0;
  const claimError = Object.assign(new Error('execution intent denied'), {
    code: 'SS_ERP_BYOK_EXECUTION_INTENT_REJECTED',
  });
  const loaded = loadClient({
    executionIntentClientOverrides: {
      async claim() { throw claimError; },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Provider fetch must not run');
    },
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-execution-intent-denied-0001',
  });

  await assert.rejects(loaded.client.edit(input), (error) => error === claimError);
  assert.equal(fetchCalls, 0);
  assert.equal(loaded.dispatches, 0);
  assert.equal(loaded.storeCalls.some((call) => call.method === 'beginProviderDispatch'), false);
  assert.equal(loaded.client.getOperationState(input.idempotencyKey), null);
});

test('reports a claimed edit intent FAILED_FINAL before deleting a tombstone setup failure', async () => {
  const events = [];
  let fetchCalls = 0;
  const loaded = loadClient({
    profileStoreOverrides: {
      async beginProviderDispatch() {
        events.push('dispatch-tombstone');
        throw new Error('session storage write failed');
      },
    },
    executionIntentClientOverrides: {
      async claim(input) {
        events.push('claim');
        return executionIntentReceipt(input, { intentId: 'intent-edit-tombstone-1' });
      },
      async reportOutcome(input) {
        events.push(['report', plain(input)]);
        return executionIntentOutcomeReceipt(input);
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Provider fetch must not run');
    },
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-dispatch-tombstone-failed-0001',
  });
  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_DISPATCH_GUARD_UNAVAILABLE'
      && error.outcome === 'FAILED_RETRYABLE',
  );
  assert.equal(fetchCalls, 0);
  assert.deepEqual(events.slice(0, 2), ['claim', 'dispatch-tombstone']);
  assert.deepEqual(events[2], ['report', {
    intentId: 'intent-edit-tombstone-1',
    providerIdempotencyKey: input.idempotencyKey,
    providerRequestHash: events[2][1].providerRequestHash,
    outcome: 'FAILED_FINAL',
    providerRequestIdSha256: null,
    resultSha256: null,
  }]);
  assert.equal(loaded.client.getOperationState(input.idempotencyKey), null);
});

test('keeps a claimed undispatched edit intent absorbing when FAILED_FINAL cannot be confirmed', async () => {
  let claimCount = 0;
  let reportCount = 0;
  let fetchCalls = 0;
  const loaded = loadClient({
    profileStoreOverrides: {
      async beginProviderDispatch() { throw new Error('session storage write failed'); },
    },
    executionIntentClientOverrides: {
      async claim(input) {
        claimCount += 1;
        return executionIntentReceipt(input, { intentId: 'intent-edit-unresolved-1' });
      },
      async reportOutcome() {
        reportCount += 1;
        throw new Error('execution outcome service unavailable');
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Provider fetch must not run');
    },
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-dispatch-outcome-unresolved-0001',
  });
  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_OUTCOME_UNRESOLVED'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false
      && error.replayed !== true,
  );
  const state = loaded.client.getOperationState(input.idempotencyKey);
  assert.equal(state.status, 'UNKNOWN_OUTCOME');
  assert.equal(state.outcome, 'UNKNOWN_OUTCOME');
  assert.equal(state.dispatched, false);
  assert.equal(state.responseReceived, false);
  assert.equal(state.executionIntentId, 'intent-edit-unresolved-1');
  assert.equal(state.errorCode, 'SS_ERP_BYOK_EXECUTION_INTENT_OUTCOME_UNRESOLVED');
  assert.equal(state.automaticRetryAllowed, false);
  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_OUTCOME_UNRESOLVED'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false
      && error.replayed === true,
  );
  assert.equal(claimCount, 1);
  assert.equal(reportCount, 1);
  assert.equal(fetchCalls, 0);
});

test('does not finalize an edit intent when the dispatch tombstone says POST may have occurred', async () => {
  let claimCount = 0;
  let reportCount = 0;
  let fetchCalls = 0;
  const loaded = loadClient({
    profileStoreOverrides: {
      async beginProviderDispatch() {
        throw Object.assign(new Error('prior dispatch is uncertain'), {
          code: 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME',
        });
      },
    },
    executionIntentClientOverrides: {
      async claim(input) {
        claimCount += 1;
        return executionIntentReceipt(input, { intentId: 'intent-edit-prior-unknown-1' });
      },
      async reportOutcome(input) {
        reportCount += 1;
        return executionIntentOutcomeReceipt(input);
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('Provider fetch must not run');
    },
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-prior-dispatch-unknown-0001',
  });
  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(claimCount, 1);
  assert.equal(reportCount, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(loaded.client.getOperationState(input.idempotencyKey), null);
});

test('never re-dispatches a persisted edit intent after local dispatch state is lost', async () => {
  for (const persistedOutcome of ['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME']) {
    let fetchCalls = 0;
    let reportCalls = 0;
    const loaded = loadClient({
      executionIntentClientOverrides: {
        async claim(input) {
          return executionIntentReceipt(input, {
            replayed: true,
            outcome: persistedOutcome,
          });
        },
        async reportOutcome() { reportCalls += 1; },
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('a replayed edit intent must never reach Provider fetch');
      },
    });
    const input = editRequest('FULL_EDIT', {
      idempotencyKey: `edit-replayed-${persistedOutcome.toLowerCase()}-0001`,
    });
    await assert.rejects(
      loaded.client.edit(input),
      (error) => error
        && error.code === 'SS_ERP_BYOK_EXECUTION_INTENT_REPLAY_BLOCKED'
        && error.outcome === (persistedOutcome === 'FAILED_FINAL'
          ? 'FAILED_FINAL' : 'UNKNOWN_OUTCOME')
        && error.automaticRetryAllowed === false
        && error.replayed === true
        && error.persistedOutcome === persistedOutcome,
    );
    assert.equal(fetchCalls, 0, persistedOutcome);
    assert.equal(reportCalls, 0, persistedOutcome);
    assert.equal(loaded.dispatches, 0, persistedOutcome);
    assert.equal(
      loaded.storeCalls.some((call) => call.method === 'beginProviderDispatch'),
      false,
      persistedOutcome,
    );
  }
});

test('turns an unrecorded successful Provider result into an absorbing unknown outcome', async () => {
  const reportedOutcomes = [];
  let fetchCalls = 0;
  const loaded = loadClient({
    executionIntentClientOverrides: {
      async reportOutcome(input) {
        reportedOutcomes.push(input.outcome);
        if (input.outcome === 'SUCCEEDED') throw new Error('outcome service unavailable');
        return executionIntentOutcomeReceipt(input);
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] });
    },
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-execution-intent-outcome-unknown-0001',
  });

  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  await assert.rejects(loaded.client.edit(input), (error) => error && error.replayed === true);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(reportedOutcomes, ['SUCCEEDED', 'UNKNOWN_OUTCOME']);
});

test('keeps a terminal Provider failure when best-effort outcome reporting is unavailable', async () => {
  const reportedOutcomes = [];
  const loaded = loadClient({
    executionIntentClientOverrides: {
      async reportOutcome(input) {
        reportedOutcomes.push(input.outcome);
        throw new Error('outcome service unavailable');
      },
    },
    fetchImpl: async () => jsonResponse({ error: { code: 'content_rejected' } }, { status: 400 }),
  });
  const input = editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-execution-intent-terminal-report-failure-0001',
  });

  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_HTTP_FAILED'
      && error.outcome === 'FAILED_FINAL'
      && error.status === 400,
  );
  await assert.rejects(loaded.client.edit(input), (error) => error && error.replayed === true);
  assert.deepEqual(reportedOutcomes, ['FAILED_FINAL']);
});

test('rejects source and mask contract violations before key access, dispatch persistence, or fetch', async () => {
  const cases = [
    editRequest('IMAGE_TO_IMAGE', { images: [] }),
    editRequest('IMAGE_TO_IMAGE', {
      images: Array.from({ length: 5 }, (_, index) => imageBlob(4, 4, 0x20 + index)),
    }),
    editRequest('FULL_EDIT', { images: [imageBlob(), imageBlob()] }),
    editRequest('INPAINT', { mask: null }),
    editRequest('INPAINT', {
      mask: { blob: imageBlob(), maskSemantics: 'TRANSPARENT_EDIT_V0' },
    }),
  ];
  for (let index = 0; index < cases.length; index += 1) {
    let fetchCalls = 0;
    const loaded = loadClient({
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('fetch must not run');
      },
    });
    await assert.rejects(
      loaded.client.edit({ ...cases[index], idempotencyKey: `invalid-shape-${index}-0001` }),
      (error) => error
        && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_INPUT_INVALID'
        && error.outcome === 'FAILED_RETRYABLE',
    );
    assert.equal(loaded.credentialReads, 0);
    assert.equal(loaded.dispatches, 0);
    assert.equal(fetchCalls, 0);
  }

  let fetchCalls = 0;
  const loaded = loadClient({
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('fetch must not run');
    },
  });
  await assert.rejects(
    loaded.client.edit(editRequest('INPAINT', {
      idempotencyKey: 'dimension-mismatch-0001',
      images: [imageBlob(4, 4, 0x31)],
      mask: { blob: imageBlob(5, 4, 0x32), maskSemantics: MASK_SEMANTICS },
    })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_DIMENSION_MISMATCH'
      && error.outcome === 'FAILED_RETRYABLE',
  );
  assert.equal(loaded.credentialReads, 0);
  assert.equal(loaded.dispatches, 0);
  assert.equal(fetchCalls, 0);
});

test('requires operation-specific multipart evidence and records the exact probe evidence', async () => {
  let fetchCalls = 0;
  const denied = loadClient({
    evidence: [evidence('IMAGE_TO_IMAGE', 'multipart')],
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] });
    },
  });
  await assert.rejects(
    denied.client.edit(editRequest('FULL_EDIT', { idempotencyKey: 'wrong-evidence-0001' })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_CAPABILITY_UNAVAILABLE'
      && error.outcome === 'FAILED_RETRYABLE',
  );
  assert.equal(fetchCalls, 0);
  assert.equal(denied.dispatches, 0);

  const probed = loadClient({
    evidence: [],
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] });
    },
  });
  const probe = await probed.client.probe(editRequest('INPAINT', {
    idempotencyKey: 'probe-inpaint-multipart-0001',
  }));
  assert.equal(probe.operation, 'INPAINT');
  assert.equal(probe.requestMode, 'multipart');
  assert.deepEqual(plain(probe.evidence), evidence('INPAINT', 'multipart', {
    verifiedAt: '2026-07-27T08:00:00.000Z',
    expiresAt: '2026-07-28T08:00:00.000Z',
  }));
  const stored = probed.storeCalls.find((call) => call.method === 'setCapabilityEvidence');
  assert.ok(stored);
  assert.equal(stored.value.operation, 'INPAINT');
  assert.equal(stored.value.requestMode, 'multipart');
  assert.equal(probed.client.getOperationState('probe-inpaint-multipart-0001').image.retained, false);
  assert.deepEqual(probed.executionIntentCalls, []);
});

test('creates background-only synthetic media when a capability probe has no image payload', async () => {
  const probeCalls = [];
  const loaded = loadClient({
    evidence: [],
    probeMediaFactory: {
      async create(operation) {
        probeCalls.push(operation);
        return {
          images: [imageBlob(4, 4, 0x47)],
          mask: operation === 'INPAINT'
            ? { blob: imageBlob(4, 4, 0x48), maskSemantics: MASK_SEMANTICS }
            : null,
        };
      },
    },
    fetchImpl: async () => jsonResponse({
      data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
    }),
  });
  const result = await loaded.client.probe({
    profileId: 'edit-profile-1',
    operation: 'INPAINT',
    prompt: 'A neutral catalog product probe image',
    negativePrompt: null,
    size: '1024x1024',
    idempotencyKey: 'probe-synthetic-inpaint-0001',
    readinessBinding: readiness('INPAINT', {
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
    }),
  });
  assert.deepEqual(probeCalls, ['INPAINT']);
  assert.equal(result.operation, 'INPAINT');
  assert.equal(result.requestMode, 'multipart');
});

test('normalizes b64 output and exposes commit/state/release without leaking bytes or secrets', async () => {
  const loaded = loadClient({
    fetchImpl: async () => jsonResponse({
      id: 'edit-provider-request-1',
      data: [{ b64_json: Buffer.from(outputPng).toString('base64') }],
    }),
  });
  const result = await loaded.client.edit(editRequest('FULL_EDIT', {
    idempotencyKey: 'edit-result-lifecycle-0001',
  }));
  assert.equal(result.image.blob instanceof Blob, true);
  assert.equal(result.image.mimeType, 'image/png');
  assert.equal(result.image.source, 'b64_json');
  assert.equal(result.providerRequestIdSha256, sha256Text('edit-provider-request-1'));
  assert.equal(JSON.stringify(result).includes('edit-provider-request-1'), false);
  assert.equal(JSON.stringify(result).includes('sk-image-edit-secret-sentinel'), false);
  assert.equal(JSON.stringify(result).includes(Buffer.from(outputPng).toString('base64')), false);

  const committed = await loaded.client.commitResult(
    result.idempotencyKey,
    result.requestHash,
    async (privateResult) => ({
      byteLength: privateResult.image.blob.size,
      sha256: privateResult.image.sha256,
    }),
  );
  assert.equal(committed.byteLength, outputPng.byteLength);
  assert.match(committed.sha256, /^[a-f0-9]{64}$/u);
  const beforeRelease = loaded.client.getOperationState(result.idempotencyKey);
  assert.equal(beforeRelease.image.retained, true);
  assert.equal('blob' in beforeRelease.image, false);
  assert.equal(JSON.stringify(beforeRelease).includes('sk-image-edit-secret-sentinel'), false);

  assert.deepEqual(
    plain(loaded.client.releaseResult(result.idempotencyKey, result.requestHash)),
    { released: true, outcome: 'SUCCEEDED' },
  );
  assert.equal(loaded.client.getOperationState(result.idempotencyKey).image.retained, false);
});

test('downloads an independently authorized URL without Provider authorization or cookies', async () => {
  const signedUrl = 'https://cdn.example/edit.webp?signature=secret-url-sentinel';
  const calls = [];
  const loaded = loadClient({
    permissions: createPermissions(['https://relay.example/*', 'https://cdn.example/*']),
    additionalConsentOrigins: ['https://cdn.example'],
    authorizeResultOrigin: async (input) => (
      input.providerOrigin === 'https://relay.example'
      && input.resultOrigin === 'https://cdn.example'
      && input.policyRevision === 'policy-9'
    ),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return jsonResponse({ id: 'edit-url-request-1', data: [{ url: signedUrl }] });
      }
      return new Response(outputPng, { headers: { 'content-type': 'image/png' } });
    },
  });
  const result = await loaded.client.edit(editRequest('IMAGE_TO_IMAGE', {
    idempotencyKey: 'edit-url-result-0001',
  }));
  assert.equal(result.outcome, 'SUCCEEDED');
  assert.equal(result.image.source, 'url');
  assert.equal(result.image.resultOrigin, 'https://cdn.example');
  assert.match(result.image.resultUrlHash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes('secret-url-sentinel'), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, signedUrl);
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.cache, 'no-store');
  assert.equal(calls[1].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(plain(calls[1].init.headers), {
    Accept: 'image/png, image/jpeg, image/webp',
  });
  assert.equal(JSON.stringify(calls[1].init).includes('sk-image-edit-secret-sentinel'), false);
});

test('rejects malformed and oversized streamed Provider responses after one dispatch', async () => {
  const cases = [
    {
      idempotencyKey: 'edit-malformed-json-response-0001',
      response() {
        return new Response('{"data":[', {
          headers: { 'content-type': 'application/json' },
        });
      },
      expectedCause: 'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_INVALID',
    },
    {
      idempotencyKey: 'edit-streamed-response-bomb-0001',
      response() {
        const chunk = new Uint8Array(16 * 1024 * 1024);
        let reads = 0;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            getReader() {
              return {
                async read() {
                  reads += 1;
                  return reads <= 3 ? { done: false, value: chunk } : { done: true };
                },
                async cancel() {},
                releaseLock() {},
              };
            },
          },
        };
      },
      expectedCause: 'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_TOO_LARGE',
    },
  ];

  for (const item of cases) {
    let fetchCalls = 0;
    const loaded = loadClient({
      fetchImpl: async () => {
        fetchCalls += 1;
        return item.response();
      },
    });
    await assert.rejects(
      loaded.client.edit(editRequest('FULL_EDIT', { idempotencyKey: item.idempotencyKey })),
      (error) => error
        && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
        && error.outcome === 'UNKNOWN_OUTCOME'
        && error.causeCode === item.expectedCause,
    );
    assert.equal(fetchCalls, 1);
    await assert.rejects(
      loaded.client.edit(editRequest('FULL_EDIT', { idempotencyKey: item.idempotencyKey })),
      (error) => error && error.replayed === true,
    );
    assert.equal(fetchCalls, 1);
  }
});

test('rejects malformed Provider image bytes before exposing a result', async () => {
  const malformedPng = Buffer.from(PNG_SIGNATURE);
  let fetchCalls = 0;
  const loaded = loadClient({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ data: [{ b64_json: malformedPng.toString('base64') }] });
    },
  });
  await assert.rejects(
    loaded.client.edit(editRequest('FULL_EDIT', {
      idempotencyKey: 'edit-malformed-image-result-0001',
    })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.causeCode === 'SS_ERP_BYOK_IMAGE_EDIT_RESULT_INVALID',
  );
  assert.equal(fetchCalls, 1);
  assert.equal(loaded.client.getOperationState('edit-malformed-image-result-0001').image, null);
});

test('stops before a result download when exact Provider permission is revoked', async () => {
  let permissionChecks = 0;
  const permissions = createPermissions();
  permissions.contains = async () => {
    permissionChecks += 1;
    return permissionChecks === 1;
  };
  const calls = [];
  const loaded = loadClient({
    permissions,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'POST') {
        return jsonResponse({ data: [{ url: 'https://relay.example/result.png' }] });
      }
      return new Response(outputPng, { headers: { 'content-type': 'image/png' } });
    },
  });
  await assert.rejects(
    loaded.client.edit(editRequest('FULL_EDIT', {
      idempotencyKey: 'edit-permission-revoked-before-download-0001',
    })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_RESULT_AUTHORITY_STALE'
      && error.outcome === 'FAILED_FINAL'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
});

test('marks a dispatched timeout unknown and replays it without a second POST', async () => {
  let fetchCalls = 0;
  const loaded = loadClient({
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    },
  });
  const input = editRequest('FULL_EDIT', { idempotencyKey: 'edit-timeout-unknown-0001' });
  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  await assert.rejects(
    loaded.client.edit(input),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.replayed === true,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(loaded.dispatches, 1);
  assert.equal(loaded.client.getOperationState(input.idempotencyKey).status, 'UNKNOWN_OUTCOME');
  assert.deepEqual(loaded.executionIntentCalls.map((call) => call.method), [
    'claim',
    'reportOutcome',
  ]);
  assert.deepEqual(loaded.executionIntentCalls[1].value, {
    intentId: `intent-${input.idempotencyKey}`,
    providerIdempotencyKey: input.idempotencyKey,
    providerRequestHash: loaded.client.getOperationState(input.idempotencyKey).requestHash,
    outcome: 'UNKNOWN_OUTCOME',
    providerRequestIdSha256: null,
    resultSha256: null,
  });
});

test('keeps standard sync and explicit async task adapters isolated without a second POST', async () => {
  const syncCalls = [];
  const sync = loadClient({
    fetchImpl: async (url, init) => {
      syncCalls.push({ url, init });
      return jsonResponse({ task_id: 'must-not-be-sniffed', status: 'QUEUED' });
    },
  });
  const syncInput = editRequest('FULL_EDIT', { idempotencyKey: 'sync-rejects-task-0001' });
  await assert.rejects(
    sync.client.edit(syncInput),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  await assert.rejects(sync.client.edit(syncInput), (error) => error && error.replayed === true);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].init.method, 'POST');

  const adapterApi = sync.adapterApi;
  assert.ok(adapterApi.EXPLICIT_ASYNC_TASK, 'explicit async adapter is missing');
  assert.equal(adapterApi.EXPLICIT_ASYNC_TASK.requestMode, 'async');
  const asyncCalls = [];
  const asyncClient = loadClient({
    adapter: adapterApi.EXPLICIT_ASYNC_TASK,
    evidence: [evidence('FULL_EDIT', 'async')],
    pollIntervalMs: 0,
    fetchImpl: async (url, init) => {
      asyncCalls.push({ url, init });
      if (init.method === 'POST') {
        return jsonResponse({
          contractVersion: 'extension-byok-image-edit-async-task/v1',
          taskId: 'edit-task-1',
          state: 'PENDING',
        });
      }
      if (asyncCalls.length === 2) {
        return jsonResponse({
          contractVersion: 'extension-byok-image-edit-async-task/v1',
          taskId: 'edit-task-1',
          state: 'PENDING',
          result: null,
          errorCode: null,
        });
      }
      return jsonResponse({
        contractVersion: 'extension-byok-image-edit-async-task/v1',
        taskId: 'edit-task-1',
        state: 'SUCCEEDED',
        result: { data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] },
        errorCode: null,
      });
    },
  });
  const asyncPrepared = await asyncClient.client.prepareDispatch(editRequest('FULL_EDIT', {
    idempotencyKey: 'explicit-async-prepared-edit-0001',
  }));
  assert.equal(asyncPrepared.requestMode, 'multipart');
  assert.deepEqual(asyncClient.executionIntentCalls, []);
  assert.equal(asyncClient.client.releasePrepared(asyncPrepared.preparedRequestHandle).released, true);
  const result = await asyncClient.client.edit(editRequest('FULL_EDIT', {
    idempotencyKey: 'explicit-async-edit-0001',
  }));
  assert.equal(result.outcome, 'SUCCEEDED');
  assert.equal(result.requestMode, 'async');
  assert.equal(result.image.source, 'b64_json');
  assert.equal(asyncClient.executionIntentCalls[0].value.requestMode, 'multipart');
  assert.equal(asyncCalls.filter((call) => call.init.method === 'POST').length, 1);
  assert.equal(asyncCalls.filter((call) => call.init.method === 'GET').length, 2);
  assert.equal(asyncCalls[0].url, 'https://relay.example/v1/images/edits');
  assert.ok(asyncCalls.slice(1).every((call) => (
    call.url === 'https://relay.example/v1/images/tasks/edit-task-1'
    && call.init.credentials === 'omit'
    && call.init.redirect === 'error'
    && call.init.headers.Authorization === 'Bearer sk-image-edit-secret-sentinel'
  )));
  assert.equal(JSON.stringify(result).includes('edit-task-1'), false);
});

test('revalidates credential authority before every authenticated async poll', async () => {
  const sync = loadClient({
    fetchImpl: async () => jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] }),
  });
  const calls = [];
  const loaded = loadClient({
    adapter: sync.adapterApi.EXPLICIT_ASYNC_TASK,
    evidence: [evidence('FULL_EDIT', 'async')],
    profileStoreOverrides: {
      async assertCredentialRevisionForBackground() {
        const error = new Error('credential rotated');
        error.code = 'SS_ERP_BYOK_CREDENTIAL_AUTHORITY_STALE';
        throw error;
      },
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'POST') {
        return jsonResponse({
          contractVersion: 'extension-byok-image-edit-async-task/v1',
          taskId: 'edit-task-rotated',
          state: 'PENDING',
        });
      }
      throw new Error('poll must not run after credential rotation');
    },
  });
  await assert.rejects(
    loaded.client.edit(editRequest('FULL_EDIT', {
      idempotencyKey: 'async-credential-rotated-0001',
    })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_RESULT_AUTHORITY_STALE'
      && error.outcome === 'FAILED_FINAL'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
});

test('normalizes explicit async failed and cancelled terminal states without retrying', async () => {
  const sync = loadClient({
    fetchImpl: async () => jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] }),
  });
  for (const state of ['FAILED', 'CANCELLED']) {
    let fetchCalls = 0;
    const taskId = `edit-task-${state.toLowerCase()}`;
    const loaded = loadClient({
      adapter: sync.adapterApi.EXPLICIT_ASYNC_TASK,
      evidence: [evidence('FULL_EDIT', 'async')],
      fetchImpl: async (_url, init) => {
        fetchCalls += 1;
        if (init.method === 'POST') {
          return jsonResponse({
            contractVersion: 'extension-byok-image-edit-async-task/v1',
            taskId,
            state: 'PENDING',
          });
        }
        return jsonResponse({
          contractVersion: 'extension-byok-image-edit-async-task/v1',
          taskId,
          state,
          result: null,
          errorCode: state === 'FAILED' ? 'CONTENT_REJECTED' : null,
        });
      },
    });
    const idempotencyKey = `async-${state.toLowerCase()}-terminal-0001`;
    await assert.rejects(
      loaded.client.edit(editRequest('FULL_EDIT', { idempotencyKey })),
      (error) => error
        && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_TASK_FAILED'
        && error.outcome === 'FAILED_FINAL'
        && error.providerTaskIdSha256 === sha256Text(taskId)
        && error.causeCode === (state === 'FAILED' ? 'CONTENT_REJECTED' : 'CANCELLED'),
    );
    await assert.rejects(
      loaded.client.edit(editRequest('FULL_EDIT', { idempotencyKey })),
      (error) => error && error.replayed === true,
    );
    assert.equal(fetchCalls, 2);
    assert.deepEqual(loaded.executionIntentCalls.map((call) => call.method), [
      'claim',
      'reportOutcome',
    ]);
    assert.equal(loaded.executionIntentCalls[1].value.outcome, 'FAILED_FINAL');
    assert.equal(loaded.executionIntentCalls[1].value.resultSha256, null);
  }
});

test('keeps the accepted async task hash when polling times out', async () => {
  const sync = loadClient({
    fetchImpl: async () => jsonResponse({ data: [{ b64_json: Buffer.from(outputPng).toString('base64') }] }),
  });
  const taskId = 'edit-task-timeout';
  let fetchCalls = 0;
  const loaded = loadClient({
    adapter: sync.adapterApi.EXPLICIT_ASYNC_TASK,
    evidence: [evidence('FULL_EDIT', 'async')],
    timeoutMs: 5,
    pollIntervalMs: 20,
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;
      assert.equal(init.method, 'POST');
      return jsonResponse({
        contractVersion: 'extension-byok-image-edit-async-task/v1',
        taskId,
        state: 'PENDING',
      });
    },
  });
  await assert.rejects(
    loaded.client.edit(editRequest('FULL_EDIT', {
      idempotencyKey: 'async-poll-timeout-0001',
    })),
    (error) => error
      && error.code === 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false
      && error.providerTaskIdSha256 === sha256Text(taskId),
  );
  assert.equal(fetchCalls, 1);
});
