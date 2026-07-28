import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const MODULES = [
  'extensions/ss-erp/shared/byok/profile-schema.js',
  'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js',
  'extensions/ss-erp/shared/byok/readiness-handle-cache.js',
  'extensions/ss-erp/shared/byok/readiness-client.js',
  'extensions/ss-erp/shared/byok/execution-intent-client.js',
  'extensions/ss-erp/shared/byok/execution-intent-claim-broker.js',
  'extensions/ss-erp/shared/byok/execution-batch-client.js',
  'extensions/ss-erp/shared/byok/workbench-batch-launch-client.js',
  'extensions/ss-erp/shared/byok/runtime-authority.js',
  'extensions/ss-erp/shared/byok/workbench-provider-semaphore.js',
  'extensions/ss-erp/shared/byok/media-job-engine.js',
  'extensions/ss-erp/shared/byok/generated-result-vault.js',
  'extensions/ss-erp/shared/byok/text-to-image-client.js',
  'extensions/ss-erp/shared/byok/generated-asset-batch-ingest-client.js',
  'extensions/ss-erp/shared/byok/workbench-batch-provider-executor.js',
  'extensions/ss-erp/shared/byok/workbench-batch-coordinator.js',
  'extensions/ss-erp/shared/byok/workbench-launch-session.js',
  'extensions/ss-erp/shared/byok/workbench-batch-registry.js',
  'extensions/ss-erp/shared/byok/workbench-batch-runtime-handler.js',
  'extensions/ss-erp/shared/byok/workbench-batch-client.js',
  'extensions/ss-erp/pages/ai-image-workbench-batch.js',
];

const NOW = new Date('2026-07-28T08:00:00.000Z');
const OWNER_USER_ID = 'owner-fixture';
const DEVICE_SESSION_ID = 'device-fixture';
const SHOP_ID = 'shop-fixture';
const WORKFLOW_ID = 'workflow-fixture';
const POLICY_REVISION = '17';
const PROVIDER_ORIGIN = 'https://private-relay.example';
const PROVIDER_BASE_URL = PROVIDER_ORIGIN + '/v1';
const PROVIDER_MODEL = 'fixture-image-model';
const PROFILE_ID = 'fixture-profile';
const API_KEY = 'sk-fixture-secret-never-expose-123456';
const HERO_PROMPT = 'VERTICAL_FIXTURE_HERO_PROMPT_NEVER_PERSIST';
const DETAIL_PROMPT = 'VERTICAL_FIXTURE_DETAIL_PROMPT_NEVER_PERSIST';
const NEGATIVE_PROMPT = 'VERTICAL_FIXTURE_NEGATIVE_PROMPT_NEVER_PERSIST';
const HERO_SLOT = 'sku:sku-fixture:hero';
const DETAIL_SLOT = 'shared:detail:DETAIL';

const PNG_A = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));
const PNG_B = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
));
const PNG_C = new Uint8Array([...PNG_A, 0x43]);

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 5_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for ' + label);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function loadApis() {
  const context = vm.createContext({
    AbortController,
    Array,
    ArrayBuffer,
    Blob,
    Boolean,
    Date,
    DOMException,
    Error,
    Event,
    FormData,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Response,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    TypeError,
    URL,
    URLSearchParams,
    Uint8Array,
    WeakMap,
    WeakSet,
    atob,
    btoa,
    clearTimeout,
    crypto: webcrypto,
    setTimeout,
  });
  context.globalThis = context;
  context.self = context;
  for (const modulePath of MODULES) {
    vm.runInContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  }
  return context;
}

function createStorageArea() {
  const values = Object.create(null);
  const writes = [];
  return {
    values,
    writes,
    async get(keys) {
      const result = {};
      const requested = keys === null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys];
      for (const key of requested) {
        if (Object.hasOwn(values, key)) result[key] = plain(values[key]);
      }
      return result;
    },
    async set(patch) {
      const cloned = plain(patch);
      writes.push(cloned);
      Object.assign(values, cloned);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    snapshot() { return plain(values); },
  };
}

function sourceContext() {
  return {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688',
    sourceProductId: 'source-product-fixture',
    sourceCaptureSnapshotId: 'capture-fixture',
    supplyGoodsId: 'goods-fixture',
    shopId: SHOP_ID,
    workflowId: WORKFLOW_ID,
    draftRevision: 3,
    draftVersion: 4,
    skuKey: 'sku-fixture',
    slotKey: HERO_SLOT,
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
  };
}

function pageBootstrap() {
  return {
    contractVersion: 'extension-byok-workbench-workspace-state/v1',
    executionMode: 'BYOK',
    dispatched: false,
    binding: {
      shopId: SHOP_ID,
      workflowId: WORKFLOW_ID,
      draftRevision: 3,
      draftVersion: 4,
    },
    selectedSlotKey: HERO_SLOT,
    skus: [{
      skuKey: 'sku-fixture',
      label: 'Fixture SKU',
      slots: [
        {
          slotKey: HERO_SLOT,
          role: 'HERO',
          prompt: HERO_PROMPT,
          negativePrompt: NEGATIVE_PROMPT,
        },
        {
          slotKey: DETAIL_SLOT,
          role: 'DETAIL',
          prompt: DETAIL_PROMPT,
          negativePrompt: null,
        },
      ],
    }],
  };
}

function createProfileStore(profileSchema) {
  const selectedProfile = {
    id: PROFILE_ID,
    name: 'Fixture relay',
    baseUrl: PROVIDER_BASE_URL,
    model: PROVIDER_MODEL,
    allowedOperations: ['TEXT_TO_IMAGE'],
    preferences: {
      defaultSize: '1024x1024',
      quality: 'auto',
      outputFormat: 'png',
    },
  };
  const credentialRevision = 'c'.repeat(64);
  const evidence = {
    contractVersion: 'extension-byok-capability/v1',
    profileIdentity: profileSchema.profileIdentity(selectedProfile),
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    policyRevision: POLICY_REVISION,
    verifiedAt: '2026-07-28T07:55:00.000Z',
    expiresAt: '2026-07-28T08:05:00.000Z',
  };
  const dispatches = new Map();
  return {
    selectedProfile,
    dispatches,
    async getProfile(id) { return id === PROFILE_ID ? selectedProfile : null; },
    async getCredentialSnapshotForBackground(id) {
      if (id !== PROFILE_ID) return null;
      return {
        profile: selectedProfile,
        apiKey: API_KEY,
        credentialRevision,
        evidence: [evidence],
      };
    },
    async assertCredentialRevisionForBackground(id, identity, revision) {
      assert.equal(id, PROFILE_ID);
      assert.equal(identity, profileSchema.profileIdentity(selectedProfile));
      assert.equal(revision, credentialRevision);
      return true;
    },
    async commitWithCredentialRevisionForBackground(id, identity, revision, commit) {
      await this.assertCredentialRevisionForBackground(id, identity, revision);
      return commit();
    },
    async beginProviderDispatch(_id, identity, revision) {
      assert.equal(revision, credentialRevision);
      const existing = dispatches.get(identity.idempotencyKey);
      if (existing && JSON.stringify(existing) !== JSON.stringify(identity)) {
        throw Object.assign(new Error('dispatch conflict'), {
          code: 'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
        });
      }
      dispatches.set(identity.idempotencyKey, plain(identity));
      return { replayed: Boolean(existing) };
    },
    async setCapabilityEvidence() { return evidence; },
    async beginCapabilityProbe() { return { replayed: false }; },
    async markCapabilityProbeUncertain() {},
    async discardPendingCapabilityProbe() {},
  };
}

function createPermissionBroker() {
  function canonicalizeOrigin(value) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('invalid Provider origin');
    }
    return parsed.origin;
  }
  return {
    canonicalizeOrigin,
    async hasOriginPermission(value) {
      return { origin: canonicalizeOrigin(value), granted: true };
    },
    async commitWithOriginPermission(value, commit) {
      assert.equal(canonicalizeOrigin(value), PROVIDER_ORIGIN);
      return commit();
    },
  };
}

function providerResponse(bytes, requestIndex) {
  const body = JSON.stringify({ data: [{ b64_json: Buffer.from(bytes).toString('base64') }] });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-request-id': 'fixture-provider-request-' + String(requestIndex + 1),
    },
  });
}

function createProviderFetch() {
  const requests = [];
  const timeline = [];
  let active = 0;
  let maxActive = 0;
  async function fetchImpl(urlValue, init) {
    const index = requests.length;
    const gate = deferred();
    const body = JSON.parse(init.body);
    active += 1;
    maxActive = Math.max(maxActive, active);
    timeline.push('start:' + String(index));
    const record = {
      index,
      url: String(urlValue),
      authorization: init.headers.Authorization,
      body,
      gate,
    };
    requests.push(record);
    try {
      const bytes = await gate.promise;
      return providerResponse(bytes, index);
    } finally {
      active -= 1;
      timeline.push('end:' + String(index));
    }
  }
  return {
    fetchImpl,
    requests,
    timeline,
    get active() { return active; },
    get maxActive() { return maxActive; },
  };
}

function response(status, data) {
  return { state: 'response', status, body: { code: 1, data } };
}

function createFakeErp() {
  const calls = [];
  const batches = new Map();
  const batchesByIdempotency = new Map();
  const grants = new Map();
  const uploadedBatches = [];
  let nextBatch = 1;

  function publicItem(item, index, attemptIndex = 0) {
    return {
      batchItemId: 'batch-item-' + String(index + 1),
      itemIndex: index,
      skuKey: item.binding.skuKey,
      slotKey: item.binding.slotKey,
      assignmentOrdinal: item.binding.assignmentOrdinal,
      intent: {
        contractVersion: 'extension-byok-execution-intent/v1',
        intentId: 'intent-' + String(index + 1) + '-' + String(attemptIndex),
        attemptIndex,
        outcome: 'PENDING',
        providerIdempotencyKey: item.providerIdempotencyKey,
        providerRequestHash: item.providerRequestHash,
      },
    };
  }

  function batchContext(binding) {
    return {
      shopId: binding.shopId,
      workflowId: binding.workflowId,
      draftRevision: binding.draftRevision,
      draftVersion: binding.draftVersion,
    };
  }

  function statusData(batch) {
    const first = batch.items[0].binding;
    return {
      contractVersion: 'extension-byok-execution-batch-status/v1',
      batchId: batch.batchId,
      status: batch.status,
      context: {
        ...batchContext(first),
        sourcePlatform: first.sourcePlatform,
        sourceProductId: first.sourceProductId,
        sourceCaptureSnapshotId: first.sourceCaptureSnapshotId,
        supplyGoodsId: first.supplyGoodsId,
      },
      boundDraftRevision: batch.status === 'BOUND' ? 4 : null,
      boundDraftVersion: batch.status === 'BOUND' ? 5 : null,
      items: batch.publicItems.map((item) => ({
        ...item,
        status: batch.status === 'OPEN' ? 'ACTIVE' : batch.status === 'BOUND' ? 'BOUND' : 'RELEASED',
      })),
    };
  }

  async function post(path, body, options) {
    calls.push({ method: 'POST', path, body: plain(body), options: plain(options) });
    if (path === '/api/extension-device/byok-media/workbench-batch-launch') {
      return response(200, {
        contractVersion: 'extension-byok-workbench-batch-launch-context/v1',
        sourcePlatform: body.sourcePlatform,
        sourceProductId: body.sourceProductId,
        sourceCaptureSnapshotId: body.sourceCaptureSnapshotId,
        supplyGoodsId: body.supplyGoodsId,
        shopId: body.shopId,
        workflowId: body.workflowId,
        draftRevision: body.draftRevision,
        draftVersion: body.draftVersion,
        anchorSkuKey: 'sku-fixture',
        firstAssignmentOrdinal: 0,
        targets: [
          { skuKey: 'sku-fixture', slotKey: HERO_SLOT },
          { skuKey: 'sku-fixture', slotKey: DETAIL_SLOT },
        ],
      });
    }
    if (path === '/api/extension-device/byok-media/readiness') {
      return response(200, {
        contractVersion: 'extension-byok-readiness-attestation/v3',
        authenticated: true,
        expiresAt: '2026-07-28T08:05:00.000Z',
        binding: {
          contractVersion: 'extension-byok-readiness-binding/v2',
          ownerUserId: OWNER_USER_ID,
          deviceSessionId: DEVICE_SESSION_ID,
          shopId: body.shopId,
          workflowId: body.workflowId,
          draftRevision: body.draftRevision,
          draftVersion: body.draftVersion,
          sourcePlatform: body.sourcePlatform,
          sourceProductId: body.sourceProductId,
          sourceCaptureSnapshotId: body.sourceCaptureSnapshotId,
          supplyGoodsId: body.supplyGoodsId,
          skuKey: body.skuKey,
          slotKey: body.slotKey,
          assignmentMode: body.assignmentMode,
          assignmentOrdinal: body.assignmentOrdinal,
          providerOrigin: body.providerOrigin,
          model: body.model,
          operation: body.operation,
          policyRevision: POLICY_REVISION,
        },
        decision: {
          allowed: true,
          providerOrigin: body.providerOrigin,
          policyRevision: Number(POLICY_REVISION),
          maxConcurrency: 1,
        },
      });
    }
    if (path === '/api/extension-device/byok-media/execution-batches') {
      const batchId = 'execution-batch-' + String(nextBatch++);
      const items = body.items.map((item) => ({ ...plain(item) }));
      const batch = {
        batchId,
        idempotencyKey: body.idempotencyKey,
        status: 'OPEN',
        items,
        publicItems: items.map((item, index) => publicItem(item, index)),
      };
      batches.set(batchId, batch);
      batchesByIdempotency.set(body.idempotencyKey, batch);
      return response(201, {
        contractVersion: 'extension-byok-execution-batch/v1',
        batchId,
        status: 'OPEN',
        replayed: false,
        context: batchContext(items[0].binding),
        items: batch.publicItems,
      });
    }
    const successor = path.match(/^\/api\/extension-device\/byok-media\/execution-batches\/([^/]+)\/items\/(\d+)\/attempts$/u);
    if (successor) {
      const batch = batches.get(decodeURIComponent(successor[1]));
      const index = Number(successor[2]);
      assert.ok(batch);
      const attemptIndex = batch.publicItems[index].intent.attemptIndex + 1;
      const item = { ...plain(body.item) };
      batch.items[index] = item;
      batch.publicItems[index] = publicItem(item, index, attemptIndex);
      return response(201, {
        contractVersion: 'extension-byok-execution-batch-attempt/v1',
        batchId: batch.batchId,
        status: 'OPEN',
        replayed: false,
        context: batchContext(item.binding),
        item: batch.publicItems[index],
      });
    }
    const outcome = path.match(/^\/api\/extension-device\/byok-media\/execution-intents\/([^/]+)\/outcome$/u);
    if (outcome) {
      const intentId = decodeURIComponent(outcome[1]);
      for (const batch of batches.values()) {
        const item = batch.publicItems.find((candidate) => candidate.intent.intentId === intentId);
        if (item) item.intent.outcome = body.outcome;
      }
      return response(201, {
        contractVersion: 'extension-byok-execution-intent-outcome/v1',
        intentId,
        replayed: false,
        outcome: body.outcome,
        providerIdempotencyKey: body.providerIdempotencyKey,
        providerRequestHash: body.providerRequestHash,
        providerRequestIdSha256: body.providerRequestIdSha256,
        resultSha256: body.resultSha256,
      });
    }
    if (path === '/api/extension-device/command-grants') {
      const requestHash = sha256(JSON.stringify(body.command));
      grants.set(body.idempotencyKey, { requestHash, command: plain(body.command) });
      return response(201, {
        grantId: 'grant-fixture',
        grantToken: 'g'.repeat(43),
        requestHash,
        expiresAt: '2026-07-28T08:01:00.000Z',
      });
    }
    const cancel = path.match(/^\/api\/extension-device\/byok-media\/execution-batches\/([^/]+)\/cancel$/u);
    if (cancel) {
      const batch = batches.get(decodeURIComponent(cancel[1]));
      assert.ok(batch);
      batch.status = 'CANCELLED';
      return response(200, {
        contractVersion: 'extension-byok-execution-batch-cancel/v1',
        batchId: batch.batchId,
        status: 'CANCELLED',
        replayed: false,
      });
    }
    throw new Error('Unhandled fake ERP POST ' + path);
  }

  async function get(path, options) {
    calls.push({ method: 'GET', path, options: plain(options) });
    const byIdempotency = path.match(/^\/api\/extension-device\/byok-media\/execution-batches\/by-idempotency\/(.+)$/u);
    const batch = byIdempotency
      ? batchesByIdempotency.get(decodeURIComponent(byIdempotency[1]))
      : batches.get(decodeURIComponent(path.split('/').at(-1)));
    if (!batch) {
      return {
        state: 'http_error',
        status: 404,
        body: { code: 0, errorCode: 'byok_execution_batch_not_found', msg: 'not found' },
      };
    }
    return response(200, statusData(batch));
  }

  async function postMultipart(path, form, options) {
    calls.push({ method: 'POST_MULTIPART', path, options: plain(options) });
    assert.equal(path, '/api/extension-device/byok-media/batch-ingest');
    const manifest = JSON.parse(form.get('manifest'));
    const grant = grants.get(manifest.idempotencyKey);
    assert.ok(grant);
    assert.deepEqual(plain(manifest.command), grant.command);
    const files = [];
    for (let index = 0; index < manifest.command.items.length; index += 1) {
      const file = form.get('image-' + String(index));
      assert.ok(file instanceof Blob);
      files.push(new Uint8Array(await file.arrayBuffer()));
    }
    uploadedBatches.push({ manifest: plain(manifest), files });
    const batch = batches.get(manifest.executionBatchId);
    assert.ok(batch);
    batch.status = 'BOUND';
    return response(200, {
      contractVersion: 'extension-byok-media-batch-ingest-receipt/v1',
      executionBatchId: manifest.executionBatchId,
      replayed: false,
      receiptId: 'batch-receipt-fixture',
      requestHash: grant.requestHash,
      sourceDraftRevision: 3,
      sourceDraftVersion: 4,
      boundDraftRevision: 4,
      boundDraftVersion: 5,
      erpAiChargeCents: 0,
      items: manifest.command.items.map((item, index) => {
        const assetId = 'asset-fixture-' + String(index + 1);
        const shared = item.slotKey.startsWith('shared:detail:');
        return {
          assetId,
          provenanceId: 'provenance-fixture-' + String(index + 1),
          executionIntentId: item.executionIntentId,
          providerRequestHash: item.providerRequestHash,
          providerResultSha256: item.resultSha256,
          normalizedSha256: sha256(files[index]),
          mimeType: item.resultMimeType,
          width: 1,
          height: 1,
          skuKey: item.skuKey,
          slotKey: item.slotKey,
          assignmentOrdinal: item.assignmentOrdinal,
          assignmentSha256: sha256(item.slotKey + ':' + assetId),
          assignment: shared ? {
            scope: 'PRODUCT', slotKey: item.slotKey, assetId, source: 'GENERATED',
          } : {
            scope: 'SKU', skuKey: item.skuKey, slotKey: item.slotKey,
            assetId, source: 'GENERATED',
          },
          policyRevision: Number(POLICY_REVISION),
        };
      }),
    });
  }

  return { transport: { post, get, postMultipart }, calls, uploadedBatches, batches };
}

function workspaceIntent(action, slot, attemptId, extras = {}) {
  return {
    contractVersion: 'extension-byok-workbench-action-intent/v1',
    binding: pageBootstrap().binding,
    action,
    commandId: 'page-command-' + webcrypto.randomUUID(),
    expectedWorkspaceRevision: 1,
    expectedRuntimeRevision: 1,
    expectedSlotRevision: slot.revision,
    slotKey: slot.slotKey,
    attemptId,
    ...extras,
  };
}

test('composes the BYOK batch page through serial Provider review and atomic zero-charge ingest', async () => {
  const context = loadApis();
  const profileSchema = context.SS_ERP_BYOK_PROFILE_SCHEMA;
  const profileStore = createProfileStore(profileSchema);
  const permissionBroker = createPermissionBroker();
  const provider = createProviderFetch();
  const fakeErp = createFakeErp();
  const executionIntentClient = context.SS_ERP_BYOK_EXECUTION_INTENT_CLIENT.createClient({
    transport: fakeErp.transport,
  });
  const claimBroker = context.SS_ERP_BYOK_EXECUTION_INTENT_CLAIM_BROKER.createBroker({
    fallback: executionIntentClient,
  });
  const textClient = context.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT.createClient({
    profileStore,
    permissionBroker,
    executionIntentClient: claimBroker,
    fetchImpl: provider.fetchImpl,
    timeoutMs: 4_000,
    crypto: webcrypto,
    now: () => NOW,
  });
  let randomByte = 1;
  const vault = context.SS_ERP_BYOK_GENERATED_RESULT_VAULT.createVault({
    now: () => NOW,
    randomValues(bytes) { bytes.fill(randomByte++); return bytes; },
    setTimeout() { return 1; },
    clearTimeout() {},
  });
  const lifecycleAuthority = Object.freeze({
    contractVersion: 'extension-byok-device-session-lifecycle/v1',
    epoch: 9,
  });
  const credentials = {
    captureAuthority() { return lifecycleAuthority; },
    isAuthorityCurrent(value) {
      return value && value.contractVersion === lifecycleAuthority.contractVersion
        && value.epoch === lifecycleAuthority.epoch;
    },
    async getStatus() {
      return { state: 'paired', ownerUserId: OWNER_USER_ID, sessionId: DEVICE_SESSION_ID };
    },
  };
  const authorityGuard = context.SS_ERP_BYOK_RUNTIME_AUTHORITY.createGuard({ credentials });
  const batchIngest = context.SS_ERP_BYOK_GENERATED_ASSET_BATCH_INGEST_CLIENT.createClient({
    transport: fakeErp.transport,
    vault,
    isAuthorityCurrent: async (value) => credentials.isAuthorityCurrent(value),
  });
  const readinessCache = context.SS_ERP_BYOK_READINESS_HANDLE_CACHE.createCache({
    now: () => NOW,
    randomValues(bytes) { bytes.fill(randomByte++); return bytes; },
  });
  const readinessClient = context.SS_ERP_BYOK_READINESS_CLIENT.createClient({
    transport: fakeErp.transport,
    profileStore,
    handleCache: readinessCache,
    profileSchema,
  });
  const sessionStorage = createStorageArea();
  const sessionManager = context.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION.createManager({
    sessionStorage,
    tabs: {
      async create() { return { id: 77 }; },
      async update(id) { return { id }; },
      async remove() {},
    },
    runtime: { getURL(path) { return 'chrome-extension://fixture/' + path; } },
    now: () => NOW.getTime(),
    onDiscardedResult(resultId) { try { vault.release(resultId); } catch {} },
  });
  await sessionManager.open({
    context: sourceContext(),
    sourceTabId: 12,
    sourceDocumentId: 'source-document-fixture',
  });
  const sender = { tabId: 77, documentId: 'workbench-document-fixture', frameId: 0 };
  await sessionManager.claim(sender);

  const providerSemaphore = context.SS_ERP_BYOK_WORKBENCH_PROVIDER_SEMAPHORE.createSemaphore({
    now: () => NOW,
  });
  const coordinatorApi = context.SS_ERP_BYOK_WORKBENCH_BATCH_COORDINATOR;
  function createCoordinator(options) {
    const providerExecutor = context.SS_ERP_BYOK_WORKBENCH_BATCH_PROVIDER_EXECUTOR.createExecutor({
      textClient,
      editClient: textClient,
      authorityGuard,
      vault,
      providerSemaphore,
      ownerToken: 'vertical-fixture:' + webcrypto.randomUUID(),
      concurrencyAuthority: options.concurrencyAuthority,
    });
    return coordinatorApi.createCoordinator({
      mediaJobEngine: context.SS_ERP_BYOK_MEDIA_JOB_ENGINE,
      providerExecutor,
      resultVault: vault,
      atomicBatchIngest: batchIngest,
      requestedConcurrency: options.requestedConcurrency,
      concurrencyAuthority: options.concurrencyAuthority,
      runnerMaxConcurrency: coordinatorApi.MAX_SELECTED_SLOTS,
      resolveDispatchInput: options.resolveDispatchInput,
      resolveRecovery: options.resolveRecovery,
    });
  }
  const registry = context.SS_ERP_BYOK_WORKBENCH_BATCH_REGISTRY.createRegistry({
    sessionManager,
    batchLaunchClient: context.SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_CLIENT.createClient({
      transport: fakeErp.transport,
    }),
    readinessClient,
    executionBatchClient: context.SS_ERP_BYOK_EXECUTION_BATCH_CLIENT.createClient({
      transport: fakeErp.transport,
    }),
    claimBroker,
    textClient,
    editClient: textClient,
    authorityGuard,
    createCoordinator,
    async resolveProviderInput() { return Object.freeze({}); },
    async resolveRecovery() {
      throw Object.assign(new Error('lookup unavailable'), {
        code: 'SS_ERP_BYOK_BATCH_PROVIDER_LOOKUP_UNAVAILABLE',
        outcome: 'UNKNOWN_OUTCOME',
      });
    },
    resultVault: vault,
    previewBroker: {
      open() { throw new Error('preview is outside this fixture'); },
      releaseResult() { return 0; },
    },
    crypto: webcrypto,
  });
  const batchClientApi = context.SS_ERP_BYOK_WORKBENCH_BATCH_CLIENT;
  const dispatcher = context.SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER.createDispatcher({
    messageTypes: batchClientApi.MESSAGE_TYPES,
    registry,
  });
  const runtimeResponses = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      void dispatcher.dispatchAuthorized(message.type, {
        payload: message.payload,
        sender,
      }).then((result) => {
        runtimeResponses.push(plain(result));
        callback(result);
      });
    },
  };
  class FakeBroadcastChannel {
    constructor() { this.onmessage = null; }
    postMessage() {}
    close() {}
  }
  const pageClient = batchClientApi.createClient({
    runtime,
    BroadcastChannel: FakeBroadcastChannel,
    now: () => NOW,
    timeoutMs: 4_000,
  });
  const emitted = [];
  let runtimeRevision = 0;
  const page = context.SS_ERP_BYOK_WORKBENCH_BATCH_PAGE.createController({
    client: pageClient,
    crypto: webcrypto,
    TextEncoder,
    Blob,
    URL: {
      createObjectURL() { return 'blob:fixture-preview'; },
      revokeObjectURL() {},
    },
    nextRuntimeRevision() { runtimeRevision += 1; return runtimeRevision; },
    emit(type, detail) { emitted.push({ type, detail: plain(detail) }); },
  });

  const visibleEvidence = [];
  visibleEvidence.push(page.bootstrap(pageBootstrap()));
  page.setSlotSelected(DETAIL_SLOT, true);
  const startProjection = await page.start({
    profileId: PROFILE_ID,
    size: '1024x1024',
    primaryPrompt: HERO_PROMPT,
    primaryNegativePrompt: NEGATIVE_PROMPT,
  });
  visibleEvidence.push(startProjection, page.getView());
  await waitFor(() => provider.requests.length === 1, 'the first background Provider request');
  assert.equal(provider.requests[0].url, PROVIDER_BASE_URL + '/images/generations');
  assert.equal(provider.requests[0].authorization, 'Bearer ' + API_KEY);
  assert.match(provider.requests[0].body.prompt, new RegExp(HERO_PROMPT, 'u'));
  assert.equal(provider.active, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(provider.requests.length, 1, 'slot two must not dispatch while slot one is active');

  provider.requests[0].gate.resolve(PNG_A);
  await waitFor(() => provider.requests.length === 2, 'the second serial Provider request');
  assert.match(provider.requests[1].body.prompt, new RegExp(DETAIL_PROMPT, 'u'));
  assert.equal(provider.active, 1);
  provider.requests[1].gate.resolve(PNG_B);
  await waitFor(() => provider.active === 0, 'the initial Provider batch to settle');
  let projection;
  await waitFor(async () => {
    projection = await page.refresh();
    return projection && projection.scheduler.state === 'REVIEW';
  }, 'the page review projection');
  visibleEvidence.push(projection, page.getView());

  let hero = projection.slots.find((slot) => slot.slotKey === HERO_SLOT);
  let detail = projection.slots.find((slot) => slot.slotKey === DETAIL_SLOT);
  const firstHeroAttempt = hero.attempts[0];
  const rejectedDetailAttempt = detail.attempts[0];
  projection = await page.handleWorkspaceIntent(workspaceIntent(
    'KEEP_ATTEMPT', hero, firstHeroAttempt.attemptId,
  ));
  visibleEvidence.push(projection);
  detail = projection.slots.find((slot) => slot.slotKey === DETAIL_SLOT);
  projection = await page.handleWorkspaceIntent(workspaceIntent(
    'REJECT_ATTEMPT', detail, rejectedDetailAttempt.attemptId,
  ));
  visibleEvidence.push(projection);
  detail = projection.slots.find((slot) => slot.slotKey === DETAIL_SLOT);
  assert.equal(detail.attempts[0].reviewState, 'REJECTED');
  assert.equal(detail.attempts[0].resultId, null);

  const regeneration = page.handleWorkspaceIntent(workspaceIntent(
    'REGENERATE_SLOT', detail, null, {
      externalChargeAcknowledgement: {
        warningVersion: 'external-provider-charge/v1',
        confirmed: true,
      },
    },
  ));
  await waitFor(() => provider.requests.length === 3, 'the regenerated Provider request');
  assert.equal(provider.active, 1);
  provider.requests[2].gate.resolve(PNG_C);
  visibleEvidence.push(await regeneration);
  await waitFor(() => provider.active === 0, 'the regenerated Provider request to settle');
  await waitFor(async () => {
    projection = await page.refresh();
    const currentDetail = projection && projection.slots.find((slot) => slot.slotKey === DETAIL_SLOT);
    return currentDetail && currentDetail.attempts.at(-1).state === 'CANDIDATE_READY';
  }, 'the regenerated detail candidate');
  visibleEvidence.push(projection);
  detail = projection.slots.find((slot) => slot.slotKey === DETAIL_SLOT);
  const regeneratedDetailAttempt = detail.attempts.at(-1);
  projection = await page.handleWorkspaceIntent(workspaceIntent(
    'KEEP_ATTEMPT', detail, regeneratedDetailAttempt.attemptId,
  ));
  visibleEvidence.push(projection, page.getView());
  assert.equal(page.getView().canIngest, true);

  const ingested = await page.ingest();
  visibleEvidence.push(ingested, page.getView());
  assert.equal(ingested.billing.erpGenerationChargeCents, 0);
  assert.equal(ingested.ingest.erpGenerationChargeCents, 0);
  assert.equal(ingested.ingest.state, 'SUCCEEDED');
  assert.deepEqual(
    ingested.ingest.assignments.map((assignment) => assignment.slotKey),
    [HERO_SLOT, DETAIL_SLOT],
  );
  assert.equal(fakeErp.uploadedBatches.length, 1);
  const upload = fakeErp.uploadedBatches[0];
  assert.deepEqual(upload.manifest.command.items.map((item) => item.slotKey), [
    HERO_SLOT,
    DETAIL_SLOT,
  ]);
  assert.deepEqual(upload.files.map(sha256), [sha256(PNG_A), sha256(PNG_C)]);
  assert.equal(upload.files.map(sha256).includes(sha256(PNG_B)), false);
  assert.equal(vault.size(), 0);

  assert.equal(provider.maxActive, 1);
  assert.deepEqual(provider.timeline, [
    'start:0', 'end:0', 'start:1', 'end:1', 'start:2', 'end:2',
  ]);
  assert.equal(
    fakeErp.calls.some((call) => /ai-(?:image|media).*cost|reservation|settlement/iu.test(call.path)),
    false,
  );
  const publishBootstrap = emitted.find((event) => event.type === 'ss-erp:workspace-bootstrap');
  assert.ok(publishBootstrap, 'the receipt must project one bound publish workspace');
  assert.deepEqual(publishBootstrap.detail.binding, {
    shopId: SHOP_ID,
    workflowId: WORKFLOW_ID,
    draftRevision: ingested.ingest.boundDraftRevision,
    draftVersion: ingested.ingest.boundDraftVersion,
  });
  assert.equal(publishBootstrap.detail.executionMode, 'BYOK');
  assert.deepEqual(
    publishBootstrap.detail.skus.flatMap((sku) => sku.slots).map((slot) => ({
      slotKey: slot.slotKey,
      assetId: slot.alternatives[0].mediaId,
      state: slot.alternatives[0].state,
    })),
    ingested.ingest.assignments.map((assignment) => ({
      slotKey: assignment.slotKey,
      assetId: assignment.assetId,
      state: 'BOUND',
    })),
  );
  assert.equal(
    emitted.some((event) => event.type === 'ss-erp:workspace-authoritative-reload'),
    false,
  );

  const forbidden = [
    API_KEY,
    PROVIDER_ORIGIN,
    PROVIDER_BASE_URL,
    HERO_PROMPT,
    DETAIL_PROMPT,
    NEGATIVE_PROMPT,
  ];
  const pageEvidence = JSON.stringify({
    visibleEvidence,
    runtimeResponses,
    emitted,
    finalView: page.getView(),
  });
  const storageEvidence = JSON.stringify({
    writes: sessionStorage.writes,
    current: sessionStorage.snapshot(),
  });
  for (const sentinel of forbidden) {
    assert.equal(pageEvidence.includes(sentinel), false, 'page projection leaked ' + sentinel);
    assert.equal(storageEvidence.includes(sentinel), false, 'session state leaked ' + sentinel);
  }
  assert.equal(pageEvidence.includes('b64_json'), false);
  assert.equal(storageEvidence.includes('b64_json'), false);
  assert.equal(JSON.stringify([...profileStore.dispatches.values()]).includes(API_KEY), false);
});

test('projects a worker-restart batch through Registry, runtime handler, and page client', async () => {
  const context = loadApis();
  const sender = { tabId: 77, documentId: 'workbench-document-restarted', frameId: 0 };
  const operationId = 'byok_batch_' + webcrypto.randomUUID();
  const reservationId = 'byok-reservation:' + webcrypto.randomUUID();
  const executionBatchId = 'execution-batch-restarted';
  const session = {
    contractVersion: 'extension-byok-workbench-launch-session/v1',
    context: sourceContext(),
    sourceTabId: 12,
    sourceDocumentId: 'source-document-fixture',
    workbenchTabId: sender.tabId,
    workbenchDocumentId: sender.documentId,
    operation: {
      idempotencyKey: operationId,
      state: 'OUTCOME_UNRESOLVED',
      recovery: {
        contractVersion: 'extension-byok-workbench-batch-recovery/v1',
        phase: 'DISPATCHING',
        reservationIdempotencyKey: reservationId,
        executionBatchId,
        context: {
          shopId: SHOP_ID,
          workflowId: WORKFLOW_ID,
          draftRevision: 3,
          draftVersion: 4,
        },
        slots: [{ skuKey: 'sku-fixture', slotKey: HERO_SLOT, operation: 'TEXT_TO_IMAGE' }],
      },
    },
    result: null,
    createdAt: NOW.getTime(),
    expiresAt: NOW.getTime() + 10 * 60 * 1000,
  };
  const providerIdempotencyKey = 'byok-page:' + webcrypto.randomUUID();
  const providerRequestHash = 'a'.repeat(64);
  const statusTransport = {
    async get(path, options) {
      assert.equal(
        path,
        '/api/extension-device/byok-media/execution-batches/' + executionBatchId,
      );
      assert.deepEqual(plain(options), { requiredScope: 'byok:media:ingest' });
      return response(200, {
        contractVersion: 'extension-byok-execution-batch-status/v1',
        batchId: executionBatchId,
        status: 'OPEN',
        context: {
          shopId: SHOP_ID,
          workflowId: WORKFLOW_ID,
          draftRevision: 3,
          draftVersion: 4,
          sourcePlatform: '1688',
          sourceProductId: 'source-product-fixture',
          sourceCaptureSnapshotId: 'capture-fixture',
          supplyGoodsId: 'goods-fixture',
        },
        boundDraftRevision: null,
        boundDraftVersion: null,
        items: [{
          batchItemId: 'batch-item-restarted',
          itemIndex: 0,
          skuKey: 'sku-fixture',
          slotKey: HERO_SLOT,
          assignmentOrdinal: 0,
          status: 'ACTIVE',
          intent: {
            contractVersion: 'extension-byok-execution-intent/v1',
            intentId: 'intent-restarted',
            attemptIndex: 0,
            outcome: 'PENDING',
            providerIdempotencyKey,
            providerRequestHash,
          },
        }],
      });
    },
    async post() { throw new Error('restart projection must not mutate ERP state'); },
  };
  const executionBatchClient = context.SS_ERP_BYOK_EXECUTION_BATCH_CLIENT.createClient({
    transport: statusTransport,
  });
  const unused = async () => { throw new Error('unexpected restart dependency call'); };
  const registry = context.SS_ERP_BYOK_WORKBENCH_BATCH_REGISTRY.createRegistry({
    sessionManager: {
      async claim() { return session; },
      beginOperation: unused,
      updateOperationRecovery: unused,
      clearOperation: unused,
    },
    batchLaunchClient: { resolve: unused },
    readinessClient: { getReadiness: unused },
    executionBatchClient,
    claimBroker: {
      registerBatch: unused,
      registerAttempt: unused,
      releaseBatch() { return false; },
      reportOutcome: unused,
    },
    textClient: { prepareDispatch: unused, releasePrepared() { return false; } },
    editClient: { prepareDispatch: unused, releasePrepared() { return false; } },
    authorityGuard: { capture: unused, assertCurrent: unused },
    createCoordinator() { throw new Error('restart projection must not create a coordinator'); },
    resolveProviderInput: unused,
    resolveRecovery: unused,
    resultVault: { getForBackground: unused, release() { return false; } },
    previewBroker: { open: unused, releaseResult() { return 0; } },
    crypto: webcrypto,
  });
  const batchClientApi = context.SS_ERP_BYOK_WORKBENCH_BATCH_CLIENT;
  const dispatcher = context.SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER.createDispatcher({
    messageTypes: batchClientApi.MESSAGE_TYPES,
    registry,
  });
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      void dispatcher.dispatchAuthorized(message.type, {
        payload: message.payload,
        sender,
      }).then(callback);
    },
  };
  class RestartBroadcastChannel {
    postMessage() {}
    close() {}
  }
  const pageClient = batchClientApi.createClient({
    runtime,
    BroadcastChannel: RestartBroadcastChannel,
    now: () => NOW,
    timeoutMs: 1_000,
  });

  const projection = await pageClient.state();
  assert.equal(projection.revision, 1);
  assert.equal(projection.slots[0].state, 'UNKNOWN_OUTCOME');
  assert.equal(projection.slots[0].attempts[0].automaticRetryAllowed, false);
  assert.equal(
    projection.slots[0].attempts[0].recoveryRequirement,
    'SERVICE_WORKER_RESTART_RECONCILIATION_REQUIRED',
  );
  assert.equal(projection.ingest.state, 'RECOVERY_REQUIRED');
  assert.equal(projection.billing.erpGenerationChargeCents, 0);
});
