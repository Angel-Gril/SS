import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const MODULES = [
  'extensions/ss-erp/shared/byok/profile-schema.js',
  'extensions/ss-erp/shared/byok/permission-broker.js',
  'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js',
  'extensions/ss-erp/shared/byok/generated-result-vault.js',
  'extensions/ss-erp/shared/byok/text-to-image-client.js',
  'extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js',
  'extensions/ss-erp/shared/byok/generated-asset-ingest-client.js',
  'extensions/ss-erp/shared/byok/listing-publish-coordinator.js',
  'extensions/ss-erp/shared/byok/workbench-runtime-handler.js',
];

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

const profileSchema = context.SS_ERP_BYOK_PROFILE_SCHEMA;
const permissionApi = context.SS_ERP_BYOK_PERMISSION_BROKER;
const providerApi = context.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT;
const vaultApi = context.SS_ERP_BYOK_GENERATED_RESULT_VAULT;
const deviceTransportApi = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION;
const ingestApi = context.SS_ERP_BYOK_GENERATED_ASSET_INGEST_CLIENT;
const publishApi = context.SS_ERP_BYOK_LISTING_PUBLISH_COORDINATOR;
const runtimeApi = context.SS_ERP_BYOK_WORKBENCH_RUNTIME_HANDLER;

const NOW = new Date('2026-07-26T10:00:00.000Z');
const API_KEY_SENTINEL = 'sk-qa01-provider-secret-sentinel';
const DEVICE_TOKEN = 'device-token-fixture-only';
const PROVIDER_ORIGIN = 'https://relay.example';
const PROVIDER_BASE_URL = PROVIDER_ORIGIN + '/v1';
const PROVIDER_MODEL = 'image-model-v1';
const POLICY_REVISION = 'policy-7';
const INGEST_REQUEST_HASH = '1'.repeat(64);
const NORMALIZED_SHA256 = '2'.repeat(64);
const ASSIGNMENT_SHA256 = '3'.repeat(64);
const PUBLISH_PREVIEW_HASH = '4'.repeat(64);
const PUBLISH_REQUEST_HASH = '5'.repeat(64);
const PNG_BYTES = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createSessionStore() {
  const values = new Map();
  return {
    async get(keys) {
      if (keys === null) return plain(Object.fromEntries(values.entries()));
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested
        .filter((key) => values.has(key))
        .map((key) => [key, plain(values.get(key))]));
    },
    async set(input) {
      for (const [key, value] of Object.entries(input)) values.set(key, plain(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    snapshot() { return plain(Object.fromEntries(values.entries())); },
  };
}

function profile(overrides = {}) {
  return {
    id: 'relay-profile-1',
    name: 'QA relay',
    baseUrl: PROVIDER_BASE_URL,
    model: PROVIDER_MODEL,
    allowedOperations: ['TEXT_TO_IMAGE'],
    preferences: {
      defaultSize: '1024x1024',
      quality: 'auto',
      outputFormat: 'png',
    },
    ...overrides,
  };
}

function launchContext(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688',
    sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    ...overrides,
  };
}

function readinessBinding(overrides = {}) {
  return {
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    ...launchContext(),
    contractVersion: 'extension-byok-readiness-binding/v2',
    providerOrigin: PROVIDER_ORIGIN,
    model: PROVIDER_MODEL,
    operation: 'TEXT_TO_IMAGE',
    policyRevision: POLICY_REVISION,
    ...overrides,
  };
}

function capabilityEvidence(selectedProfile = profile()) {
  return {
    contractVersion: 'extension-byok-capability/v1',
    profileIdentity: profileSchema.profileIdentity(selectedProfile),
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    policyRevision: POLICY_REVISION,
    verifiedAt: '2026-07-26T09:55:00.000Z',
    expiresAt: '2026-07-26T10:05:00.000Z',
  };
}

function createProfileStore(selectedProfile = profile(), apiKey = API_KEY_SENTINEL) {
  const revision = '6'.repeat(64);
  const evidence = (() => {
    try { return capabilityEvidence(selectedProfile); } catch { return null; }
  })();
  const dispatches = new Map();
  return {
    dispatches,
    async listPublicProfiles() {
      try { return [profileSchema.publicProfile(selectedProfile)]; } catch { return []; }
    },
    async getProfile(id) { return id === selectedProfile.id ? selectedProfile : null; },
    async getPublicState(id) {
      if (id !== selectedProfile.id) return null;
      return {
        profile: selectedProfile,
        hasKey: Boolean(apiKey),
        evidence: evidence ? [evidence] : [],
      };
    },
    async getCredentialSnapshotForBackground(id) {
      if (id !== selectedProfile.id) return null;
      return {
        profile: selectedProfile,
        apiKey,
        credentialRevision: revision,
        evidence: evidence ? [evidence] : [],
      };
    },
    async assertCredentialRevisionForBackground(id, identity, expectedRevision) {
      if (id !== selectedProfile.id
        || identity !== profileSchema.profileIdentity(selectedProfile)
        || expectedRevision !== revision) throw new Error('credential stale');
      return true;
    },
    async commitWithCredentialRevisionForBackground(id, identity, expectedRevision, commit) {
      await this.assertCredentialRevisionForBackground(id, identity, expectedRevision);
      return commit();
    },
    async beginProviderDispatch(_id, identity, expectedRevision) {
      if (expectedRevision !== revision) throw new Error('credential stale');
      const existing = dispatches.get(identity.idempotencyKey);
      if (existing && JSON.stringify(existing) !== JSON.stringify(identity)) {
        throw Object.assign(new Error('idempotency conflict'), {
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

function createPermissionBroker(grantedOrigins = [PROVIDER_ORIGIN]) {
  const granted = new Set(grantedOrigins);
  return {
    canonicalizeOrigin: permissionApi.canonicalizeOrigin,
    async hasOriginPermission(value) {
      const origin = permissionApi.canonicalizeOrigin(value);
      return { origin, granted: granted.has(origin) };
    },
    async commitWithOriginPermission(value, commit) {
      const origin = permissionApi.canonicalizeOrigin(value);
      if (!granted.has(origin)) throw new Error('permission missing');
      return commit();
    },
  };
}

function providerJson(payload, init = {}) {
  const body = JSON.stringify(payload);
  return new Response(body, {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'x-request-id': init.requestId || 'provider-request-1',
      ...(init.headers || {}),
    },
  });
}

function createProviderClient(options = {}) {
  const selectedProfile = options.selectedProfile || profile();
  const profileStore = createProfileStore(selectedProfile, options.apiKey || API_KEY_SENTINEL);
  const permissionBroker = createPermissionBroker(options.grantedOrigins);
  const fetchImpl = options.fetchImpl || (async () => providerJson({
    data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }],
  }));
  return {
    profileStore,
    permissionBroker,
    client: providerApi.createClient({
      profileStore,
      permissionBroker,
      fetchImpl,
      timeoutMs: 2_000,
      crypto: webcrypto,
      now: () => NOW,
    }),
  };
}

function jsonHttpResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestHeader(init, name) {
  const headers = init && init.headers || {};
  const found = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? headers[found] : undefined;
}

function createFakeErp(options = {}) {
  const requests = [];
  const publishReceipts = new Map();
  let ozonSubmissionCount = 0;
  let ingestBinaryCount = 0;
  let dropExecuteResponse = options.dropExecuteResponse === true;

  function safeRequestLog(path, init, body) {
    requests.push({
      path,
      method: init.method,
      headers: plain(init.headers),
      body: body instanceof Blob ? { blobBytes: body.size, mimeType: body.type } : plain(body),
      credentials: init.credentials,
      redirect: init.redirect,
      cache: init.cache,
    });
  }

  function publishBinding(body) {
    return {
      shopId: body.shopId,
      workflowId: body.workflowId,
      sourceDraftRevision: body.sourceDraftRevision,
      sourceDraftVersion: body.sourceDraftVersion,
      boundDraftRevision: body.boundDraftRevision,
      boundDraftVersion: body.boundDraftVersion,
      assetId: body.assetId,
      provenanceId: body.provenanceId,
      normalizedSha256: body.normalizedSha256,
      skuKey: body.skuKey,
      slotKey: body.slotKey,
      assignmentOrdinal: body.assignmentOrdinal,
      assignmentSha256: body.assignmentSha256,
    };
  }

  async function fetchImpl(urlValue, init) {
    const path = new URL(urlValue).pathname;
    const body = init.body instanceof Blob ? init.body : JSON.parse(init.body || '{}');
    safeRequestLog(path, init, body);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(requestHeader(init, 'Authorization'), 'Bearer ' + DEVICE_TOKEN);

    if (path === '/api/extension-device/command-grants') {
      const isIngest = body.operation === 'BYOK_MEDIA_INGEST';
      const isPublish = body.operation === 'OZON_PUBLISH';
      if (!isIngest && !isPublish) {
        return jsonHttpResponse(400, { code: 0, errorCode: 'invalid_request' });
      }
      return jsonHttpResponse(201, {
        code: 1,
        msg: 'command grant issued',
        data: {
          grantId: isIngest ? 'ingest-grant-1' : 'publish-grant-1',
          grantToken: (isIngest ? 'i' : 'p').repeat(43),
          expiresAt: '2026-07-26T10:01:00.000Z',
          ...(isIngest ? { requestHash: INGEST_REQUEST_HASH } : {}),
        },
      });
    }

    if (path === '/api/extension-device/byok-media/ingest') {
      ingestBinaryCount += 1;
      assert.ok(body instanceof Blob);
      assert.equal(body.type, 'image/png');
      assert.equal(requestHeader(init, 'X-SS-ERP-Command-Grant'), 'i'.repeat(43));
      const encodedManifest = requestHeader(init, 'X-SS-ERP-BYOK-Ingest-Manifest');
      const manifest = JSON.parse(Buffer.from(encodedManifest, 'base64url').toString('utf8'));
      assert.equal(manifest.operation, 'BYOK_MEDIA_INGEST');
      assert.equal(manifest.command.resultSha256, sha256(PNG_BYTES));
      return jsonHttpResponse(200, {
        code: 1,
        data: {
          replayed: false,
          receiptId: 'ingest-receipt-1',
          assetId: 'asset-byok-1',
          provenanceId: 'provenance-byok-1',
          normalizedSha256: NORMALIZED_SHA256,
          mimeType: 'image/png',
          width: 1,
          height: 1,
          sourceDraftRevision: 3,
          sourceDraftVersion: 4,
          boundDraftRevision: 4,
          boundDraftVersion: 5,
          assignmentOrdinal: 0,
          assignmentSha256: ASSIGNMENT_SHA256,
          skuKey: 'sku-1',
          slotKey: 'sku:sku-1:hero',
        },
      });
    }

    if (path === '/api/extension-device/byok-publish/preview') {
      if (body.shopId !== 'shop-1') {
        return jsonHttpResponse(403, { code: 0, errorCode: 'byok_publish_shop_denied' });
      }
      if (body.workflowId !== 'workflow-1'
        || body.sourceDraftRevision !== 3 || body.sourceDraftVersion !== 4
        || body.boundDraftRevision !== 4 || body.boundDraftVersion !== 5
        || body.assetId !== 'asset-byok-1' || body.provenanceId !== 'provenance-byok-1') {
        return jsonHttpResponse(409, { code: 0, errorCode: 'byok_publish_context_stale' });
      }
      return jsonHttpResponse(200, {
        code: 1,
        data: {
          contractVersion: 'extension-byok-listing-publish/v1',
          previewHash: PUBLISH_PREVIEW_HASH,
          ...publishBinding(body),
          selectedSkuKeys: ['sku-1'],
          orderedMedia: [{
            ordinal: 0,
            scope: 'SKU',
            skuKey: 'sku-1',
            slotKey: 'sku:sku-1:hero',
            assetId: 'asset-byok-1',
            source: 'GENERATED',
          }],
        },
      });
    }

    if (path === '/api/extension-device/byok-publish/prepare') {
      return jsonHttpResponse(201, {
        code: 1,
        data: {
          contractVersion: 'extension-byok-listing-publish/v1',
          previewHash: PUBLISH_PREVIEW_HASH,
          requestHash: PUBLISH_REQUEST_HASH,
          replayed: false,
          envelope: {
            operation: 'OZON_PUBLISH',
            shopId: body.shopId,
            workflowId: body.workflowId,
            draftVersion: body.boundDraftVersion,
            idempotencyKey: body.idempotencyKey,
            command: {
              schemaVersion: 'ozon-publish-command/v1',
              draftRevision: body.boundDraftRevision + 1,
              publishIntentId: 'publish-intent-1',
              selectedSkuKeys: ['sku-1'],
            },
          },
        },
      });
    }

    if (path === '/api/extension-device/ozon-publish/execute') {
      assert.equal(requestHeader(init, 'X-SS-ERP-Command-Grant'), 'p'.repeat(43));
      let receipt = publishReceipts.get(body.idempotencyKey);
      const replay = Boolean(receipt);
      if (!receipt) {
        ozonSubmissionCount += 1;
        receipt = {
          id: 'publish-receipt-' + String(publishReceipts.size + 1),
          status: 'SUCCEEDED',
          result: {
            rawPublisherResult: 'not exposed by the coordinator',
            resultUrl: 'https://seller-api.example/private-result',
          },
          failureCode: null,
        };
        publishReceipts.set(body.idempotencyKey, receipt);
      }
      if (dropExecuteResponse) {
        dropExecuteResponse = false;
        throw new TypeError('fixture connection dropped after commit');
      }
      return jsonHttpResponse(replay ? 200 : 202, {
        code: 1,
        data: { receipt, replay },
      });
    }

    if (path === '/api/extension-device/byok-publish/status') {
      const receipt = publishReceipts.get(body.envelope.idempotencyKey);
      return jsonHttpResponse(200, {
        code: 1,
        data: receipt ? {
          contractVersion: 'extension-byok-listing-publish/v1',
          state: 'SUCCEEDED',
          receiptId: receipt.id,
          failureCode: null,
        } : {
          contractVersion: 'extension-byok-listing-publish/v1',
          state: 'NOT_COMMITTED',
          receiptId: null,
          failureCode: null,
        },
      });
    }

    return jsonHttpResponse(404, { code: 0, errorCode: 'fixture_route_not_found' });
  }

  return {
    fetchImpl,
    requests,
    get ingestBinaryCount() { return ingestBinaryCount; },
    get ozonSubmissionCount() { return ozonSubmissionCount; },
    get publishReceiptCount() { return publishReceipts.size; },
  };
}

function deviceCredentials() {
  return {
    async beginOperation() {
      return {
        state: 'paired',
        epoch: 1,
        baseUrl: 'https://erp.example',
        accessToken: DEVICE_TOKEN,
        scopes: ['byok:media:ingest', 'listing:publish'],
      };
    },
    async isOperationCurrent() { return true; },
    async clearIfCurrent() { throw new Error('fixture credentials remain current'); },
  };
}

function createTransport(fakeErp) {
  return deviceTransportApi.createTransport({
    credentials: deviceCredentials(),
    fetchImpl: fakeErp.fetchImpl,
  });
}

function createVault() {
  let randomByte = 10;
  return vaultApi.createVault({
    now: () => NOW,
    randomValues(bytes) { bytes.fill(randomByte++); return bytes; },
    setTimeout() { return 1; },
    clearTimeout() {},
    onDiscardedResult() {},
  });
}

function createSessionManager(initialContext) {
  let session = {
    context: initialContext,
    sourceTabId: 12,
    sourceDocumentId: 'source-document-1',
    workbenchTabId: 77,
    workbenchDocumentId: 'workbench-document-1',
    operation: null,
    result: null,
  };
  return {
    get session() { return session; },
    async open() { return { state: 'workbench_opened', tabId: 77 }; },
    async claim() {
      if (!session) throw new Error('session missing');
      return session;
    },
    sameContext(left, right) {
      return Object.keys(initialContext).every((key) => left[key] === right[key]);
    },
    async beginOperation(_sender, idempotencyKey) {
      if (session.operation || session.result) {
        throw Object.assign(new Error('operation conflict'), {
          code: 'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT',
        });
      }
      session = { ...session, operation: { idempotencyKey, state: 'OUTCOME_UNRESOLVED' } };
      return session;
    },
    async clearOperation(_sender, idempotencyKey) {
      if (!session.operation || session.operation.idempotencyKey !== idempotencyKey) throw new Error('operation conflict');
      session = { ...session, operation: null };
      return session;
    },
    async attachResult(_sender, result, idempotencyKey) {
      if (!session.operation || session.operation.idempotencyKey !== idempotencyKey) throw new Error('operation conflict');
      session = {
        ...session,
        operation: null,
        result: {
          ...result,
          deliveryState: 'NOT_INGESTED',
          ingestIdempotencyKey: null,
          ingestRequestHash: null,
          ingestAuthority: null,
          ingest: null,
        },
      };
      return session;
    },
    async setReviewState(_sender, id, state) {
      if (!session.result || session.result.resultId !== id) throw new Error('result conflict');
      session = { ...session, result: { ...session.result, reviewState: state } };
      return session;
    },
    async beginIngest(_sender, id, idempotencyKey, authority) {
      if (!session.result || session.result.resultId !== id || session.result.reviewState !== 'APPROVED') {
        throw new Error('result conflict');
      }
      session = {
        ...session,
        result: {
          ...session.result,
          deliveryState: 'INGESTING',
          ingestIdempotencyKey: idempotencyKey,
          ingestRequestHash: null,
          ingestAuthority: authority,
          ingest: null,
        },
      };
      return session;
    },
    async setIngestRequestHash(_sender, id, idempotencyKey, requestHash) {
      if (!session.result || session.result.resultId !== id
        || session.result.ingestIdempotencyKey !== idempotencyKey) throw new Error('result conflict');
      session = { ...session, result: { ...session.result, ingestRequestHash: requestHash } };
      return session;
    },
    async resetIngest(_sender, id, idempotencyKey) {
      if (!session.result || session.result.resultId !== id
        || session.result.ingestIdempotencyKey !== idempotencyKey) throw new Error('result conflict');
      session = {
        ...session,
        result: {
          ...session.result,
          deliveryState: 'NOT_INGESTED',
          ingestIdempotencyKey: null,
          ingestRequestHash: null,
          ingestAuthority: null,
          ingest: null,
        },
      };
      return session;
    },
    async setIngestResult(_sender, id, idempotencyKey, authority, ingest) {
      if (!session.result || session.result.resultId !== id
        || session.result.ingestIdempotencyKey !== idempotencyKey) throw new Error('result conflict');
      session = {
        ...session,
        result: {
          ...session.result,
          deliveryState: 'BOUND',
          ingestAuthority: authority,
          ingest,
        },
      };
      return session;
    },
    async clearResult(_sender, id) {
      if (session.result && session.result.resultId === id) session = { ...session, result: null };
      return session;
    },
    async takeByTab() {
      const previous = session;
      session = null;
      return previous;
    },
  };
}

function createAuthorityGuard(vault, expectedBinding) {
  let live = true;
  const authority = {
    lifecycleAuthority: {
      contractVersion: 'extension-byok-device-session-lifecycle/v1',
      epoch: 1,
    },
    ownerUserId: expectedBinding.ownerUserId,
    deviceSessionId: expectedBinding.deviceSessionId,
    shopId: expectedBinding.shopId,
    workflowId: expectedBinding.workflowId,
    draftRevision: expectedBinding.draftRevision,
    draftVersion: expectedBinding.draftVersion,
    policyRevision: expectedBinding.policyRevision,
  };
  return {
    setLive(value) { live = value; },
    async capture(candidate = expectedBinding) {
      if (!live
        || candidate.ownerUserId !== authority.ownerUserId
        || candidate.deviceSessionId !== authority.deviceSessionId
        || candidate.shopId !== authority.shopId
        || candidate.workflowId !== authority.workflowId
        || candidate.draftRevision !== authority.draftRevision
        || candidate.draftVersion !== authority.draftVersion
        || candidate.policyRevision !== authority.policyRevision) {
        throw Object.assign(new Error('device authority stale'), {
          code: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
          outcome: 'FAILED_FINAL',
        });
      }
      return authority;
    },
    async commitGeneratedResult(input) {
      return input.vault.put(
        input.generated,
        input.binding,
        input.authority.lifecycleAuthority,
      );
    },
    matchesVaultAuthority(entry, binding, currentAuthority) {
      return entry.lifecycleEpoch === currentAuthority.lifecycleAuthority.epoch
        && entry.binding.ownerUserId === binding.ownerUserId
        && entry.binding.deviceSessionId === binding.deviceSessionId
        && entry.binding.shopId === binding.shopId
        && entry.binding.workflowId === binding.workflowId;
    },
  };
}

const MESSAGE_TYPES = {
  GET_PUBLIC_STATE: 'qa01-state',
  GET_READINESS: 'qa01-readiness',
  EXECUTE_PROVIDER: 'qa01-execute',
  OPEN_PREVIEW: 'qa01-preview',
  REVIEW_RESULT: 'qa01-review',
  INGEST: 'qa01-ingest',
  RECOVER_INGEST: 'qa01-recover-ingest',
  PUBLISH: 'qa01-publish',
  EDIT_MEDIA_PREPARE: 'qa01-edit-media-prepare',
  EDIT_MEDIA_RELEASE: 'qa01-edit-media-release',
  EDIT_STATE: 'qa01-edit-state',
  EDIT_REFERENCES: 'qa01-edit-references',
  EDIT_START: 'qa01-edit-start',
  EDIT_SELECT: 'qa01-edit-select',
  EDIT_REGENERATE: 'qa01-edit-regenerate',
  EDIT_PREVIEW: 'qa01-edit-preview',
  EDIT_CLEANUP: 'qa01-edit-cleanup',
};
const sender = { tabId: 77, documentId: 'workbench-document-1', frameId: 0 };

const providerCalls = [];
const selectedProfile = profile();
const providerFixture = createProviderClient({
  selectedProfile,
  async fetchImpl(url, init) {
    providerCalls.push({ url: String(url), init: plain(init) });
    assert.equal(String(url), PROVIDER_BASE_URL + '/images/generations');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.Authorization, 'Bearer ' + API_KEY_SENTINEL);
    return providerJson({ data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }] });
  },
});
const fakeErp = createFakeErp();
const transport = createTransport(fakeErp);
const vault = createVault();
const ingestClient = ingestApi.createClient({
  transport,
  vault,
  isAuthorityCurrent: async (authority) => authority.epoch === 1,
});
const publishStore = createSessionStore();
const publishCoordinator = publishApi.createCoordinator({
  transport,
  store: publishStore,
  crypto: webcrypto,
  now: () => NOW.getTime(),
});
const sourceContext = launchContext();
const binding = readinessBinding();
const sessionManager = createSessionManager(sourceContext);
const authorityGuard = createAuthorityGuard(vault, binding);
const previewTickets = [];
const runtimeResponses = [];
const editSnapshot = {
  contractVersion: 'extension-byok-workbench-edit-controller/v1',
  executionMode: 'BYOK',
  slotKey: sourceContext.slotKey,
  profileId: null,
  operation: null,
  references: {
    sessionGlobalCount: 0,
    slotOverrideActive: false,
    slotOverrideCount: null,
    effectiveCount: 0,
  },
  operationAvailability: [],
  scheduler: {
    state: 'READY', activeCount: 0, queuedCount: 0,
    pauseRequested: false, effectiveConcurrency: null,
  },
  slot: { revision: 0, attemptIds: [], selectedAttemptId: null, selectedCandidateId: null },
  alternatives: [],
};
const editController = {
  open() { return editSnapshot; },
  setReferences() { return editSnapshot; },
  async start() { return editSnapshot; },
  async regenerate() { return editSnapshot; },
  selectAlternative() { return editSnapshot; },
  getSnapshot() { return editSnapshot; },
  cleanup() {
    return { cleaned: false, releasedResultCount: 0, externalChargeUnresolved: false };
  },
  cleanupByTab() {
    return { cleaned: false, releasedResultCount: 0, externalChargeUnresolved: false };
  },
};
const editMediaStore = {
  prepare() { throw new Error('edit media is outside the text-to-image fixture'); },
  release() { return false; },
};
const editEpochGuard = {
  async assertCurrent() { return { state: 'EMPTY' }; },
  async begin() { throw new Error('edit start is outside the text-to-image fixture'); },
  async clear() { return false; },
  async clearByTab() { return false; },
  async acknowledge() { return { clearedCount: 0 }; },
};
const providerSemaphoreCalls = [];
const providerSemaphore = {
  async acquire(value) {
    providerSemaphoreCalls.push(['acquire', plain(value)]);
    assert.equal(value.ownerUserId, binding.ownerUserId);
    assert.equal(value.deviceSessionId, binding.deviceSessionId);
    assert.equal(value.policyRevision, binding.policyRevision);
    assert.equal(value.maxConcurrency, 1);
    let released = false;
    return {
      release() {
        if (released) return false;
        released = true;
        providerSemaphoreCalls.push(['release']);
        return true;
      },
    };
  },
  cancelOwner() { return 0; },
};
const authorizedReadiness = {
  binding,
  expiresAt: '2026-07-26T10:05:00.000Z',
};
Object.defineProperty(authorizedReadiness, 'concurrencyAuthority', {
  value: Object.freeze({ policyRevision: binding.policyRevision, maxConcurrency: 1 }),
  enumerable: false,
});
const dispatcher = runtimeApi.createDispatcher({
  messageTypes: MESSAGE_TYPES,
  sessionManager,
  launchClient: { async resolve() { return sourceContext; } },
  profileStore: providerFixture.profileStore,
  permissionBroker: providerFixture.permissionBroker,
  readinessClient: {
    async getReadiness() {
      return {
        readinessHandle: 'rh_' + '7'.repeat(48),
        readinessBinding: binding,
        expiresAt: '2026-07-26T10:05:00.000Z',
      };
    },
  },
  providerClient: providerFixture.client,
  vault,
  authorityGuard,
  previewBroker: {
    open(entry) {
      const ticket = {
        contractVersion: 'qa01-preview/v1',
        channelName: 'qa01-channel',
        previewTicket: 'qa01-ticket',
        resultId: entry.resultId,
      };
      previewTickets.push(ticket);
      return ticket;
    },
    releaseResult() { return 1; },
  },
  ingestClient,
  publishCoordinator,
  editController,
  editMediaStore,
  editEpochGuard,
  providerSemaphore,
  now: () => NOW,
  randomValues(bytes) { bytes.fill(8); return bytes; },
});

async function runtime(messageType, payload, authorization) {
  const response = await dispatcher.handlers[messageType]({
    payload,
    sender,
    ...(authorization ? { authorization } : {}),
  });
  runtimeResponses.push(plain(response));
  return response;
}

const publicState = await runtime(MESSAGE_TYPES.GET_PUBLIC_STATE, {});
assert.equal(publicState.ok, true);
assert.equal(publicState.data.executionMode, 'BYOK');
assert.equal(publicState.data.profiles[0].hasKey, true);
assert.equal(JSON.stringify(publicState).includes(API_KEY_SENTINEL), false);

const generated = await runtime(MESSAGE_TYPES.EXECUTE_PROVIDER, {
  profileId: selectedProfile.id,
  prompt: 'Create one neutral catalog hero image',
  negativePrompt: null,
  size: '1024x1024',
  idempotencyKey: 'qa01-provider-generate-1',
}, { readiness: authorizedReadiness });
assert.equal(generated.ok, true);
assert.match(generated.data.resultId, /^br_[a-f0-9]{48}$/u);
assert.equal(generated.data.reviewState, 'CANDIDATE_READY');
assert.equal(providerCalls.length, 1);
assert.deepEqual(providerSemaphoreCalls.map((row) => row[0]), ['acquire', 'release']);

const previewed = await runtime(MESSAGE_TYPES.OPEN_PREVIEW, {
  resultId: generated.data.resultId,
});
assert.equal(previewed.ok, true);
assert.equal(previewed.data.resultId, generated.data.resultId);
assert.equal(previewTickets.length, 1);

const approved = await runtime(MESSAGE_TYPES.REVIEW_RESULT, {
  resultId: generated.data.resultId,
  decision: 'APPROVE',
});
assert.equal(approved.ok, true);
assert.equal(approved.data.reviewState, 'APPROVED');

const ingested = await runtime(MESSAGE_TYPES.INGEST, { resultId: generated.data.resultId });
assert.equal(ingested.ok, true);
assert.equal(ingested.data.deliveryState, 'BOUND');
assert.equal(ingested.data.ingest.assetId, 'asset-byok-1');
assert.equal(ingested.data.ingest.boundDraftRevision, 4);
assert.equal(ingested.data.ingest.boundDraftVersion, 5);
assert.equal(fakeErp.ingestBinaryCount, 1);
assert.equal(vault.size(), 0, 'accepted bytes must leave the temporary vault after ERP binding');

const publishPreview = await runtime(MESSAGE_TYPES.PUBLISH, { action: 'PREVIEW' });
assert.equal(publishPreview.ok, true);
assert.equal(publishPreview.data.previewHash, PUBLISH_PREVIEW_HASH);
assert.equal(publishPreview.data.orderedMedia[0].assetId, 'asset-byok-1');

const firstPublish = runtime(MESSAGE_TYPES.PUBLISH, {
  action: 'CONFIRM',
  previewHash: PUBLISH_PREVIEW_HASH,
});
const duplicatePublish = runtime(MESSAGE_TYPES.PUBLISH, {
  action: 'CONFIRM',
  previewHash: PUBLISH_PREVIEW_HASH,
});
const [firstPublishResponse, duplicatePublishResponse] = await Promise.all([
  firstPublish,
  duplicatePublish,
]);
const publishWinners = [firstPublishResponse, duplicatePublishResponse]
  .filter((candidate) => candidate.ok === true);
const publishLosers = [firstPublishResponse, duplicatePublishResponse]
  .filter((candidate) => candidate.ok !== true);
assert.ok(
  publishWinners.length >= 1,
  JSON.stringify([firstPublishResponse, duplicatePublishResponse]),
);
assert.ok(publishWinners.every((candidate) => candidate.data.state === 'SUCCEEDED'));
assert.ok(publishLosers.every(
  (candidate) => candidate.errorCode === 'SS_ERP_BYOK_PUBLISH_IN_PROGRESS',
));
const replayedPublish = await runtime(MESSAGE_TYPES.PUBLISH, {
  action: 'CONFIRM',
  previewHash: PUBLISH_PREVIEW_HASH,
});
assert.equal(replayedPublish.ok, true);
assert.equal(replayedPublish.data.state, 'SUCCEEDED');
assert.equal(fakeErp.publishReceiptCount, 1);
assert.equal(fakeErp.ozonSubmissionCount, 1);

const erpEvidence = JSON.stringify(fakeErp.requests);
const durableEvidence = JSON.stringify(publishStore.snapshot());
const runtimeEvidence = JSON.stringify(runtimeResponses);
const dispatchEvidence = JSON.stringify([...providerFixture.profileStore.dispatches.values()]);
assert.equal(providerCalls[0].init.headers.Authorization, 'Bearer ' + API_KEY_SENTINEL);
assert.doesNotMatch(erpEvidence, new RegExp(API_KEY_SENTINEL, 'u'));
assert.doesNotMatch(durableEvidence, new RegExp(API_KEY_SENTINEL, 'u'));
assert.doesNotMatch(runtimeEvidence, new RegExp(API_KEY_SENTINEL, 'u'));
assert.doesNotMatch(dispatchEvidence, new RegExp(API_KEY_SENTINEL, 'u'));
assert.doesNotMatch(durableEvidence, /grantToken|seller-api\.example|rawPublisherResult/u);
assert.doesNotMatch(runtimeEvidence, /seller-api\.example|rawPublisherResult/u);
assert.doesNotMatch(durableEvidence + runtimeEvidence, /b64_json|iVBORw0KGgo/u);
assert.ok(fakeErp.requests.every((request) => !/ai-(?:image|media)|cost|reservation/iu.test(request.path)));
assert.ok(fakeErp.requests.every((request) => !/api\.ozon|seller-api/iu.test(request.path)));

const requestsBeforeRevocation = fakeErp.requests.length;
authorityGuard.setLive(false);
const revokedPublish = await runtime(MESSAGE_TYPES.PUBLISH, { action: 'RECOVER' });
assert.equal(revokedPublish.ok, false);
assert.equal(revokedPublish.errorCode, 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE');
assert.equal(fakeErp.requests.length, requestsBeforeRevocation);
authorityGuard.setLive(true);

const publishBinding = {
  shopId: 'shop-1',
  workflowId: 'workflow-1',
  sourceDraftRevision: 3,
  sourceDraftVersion: 4,
  boundDraftRevision: 4,
  boundDraftVersion: 5,
  assetId: 'asset-byok-1',
  provenanceId: 'provenance-byok-1',
  normalizedSha256: NORMALIZED_SHA256,
  skuKey: 'sku-1',
  slotKey: 'sku:sku-1:hero',
  assignmentOrdinal: 0,
  assignmentSha256: ASSIGNMENT_SHA256,
};
await assert.rejects(
  publishCoordinator.preview({ ...publishBinding, shopId: 'shop-other' }),
  (error) => error && error.code === 'SS_ERP_BYOK_PUBLISH_PREVIEW_REJECTED',
);
await assert.rejects(
  publishCoordinator.preview({
    ...publishBinding,
    sourceDraftRevision: 8,
    sourceDraftVersion: 9,
    boundDraftRevision: 9,
    boundDraftVersion: 10,
  }),
  (error) => error && error.code === 'SS_ERP_BYOK_PUBLISH_PREVIEW_REJECTED',
);
assert.equal(fakeErp.publishReceiptCount, 1);

{
  const unknownErp = createFakeErp({ dropExecuteResponse: true });
  const unknownTransport = createTransport(unknownErp);
  const unknownStore = createSessionStore();
  const firstCoordinator = publishApi.createCoordinator({
    transport: unknownTransport,
    store: unknownStore,
    crypto: webcrypto,
    now: () => NOW.getTime(),
  });
  const preview = await firstCoordinator.preview(publishBinding);
  await assert.rejects(
    firstCoordinator.confirm({ ...publishBinding, previewHash: preview.previewHash }),
    (error) => error
      && error.code === 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.equal(unknownErp.publishReceiptCount, 1);
  assert.equal(unknownErp.ozonSubmissionCount, 1);

  const reloadedCoordinator = publishApi.createCoordinator({
    transport: unknownTransport,
    store: unknownStore,
    crypto: webcrypto,
    now: () => NOW.getTime(),
  });
  const recovered = await reloadedCoordinator.getState(publishBinding);
  assert.equal(recovered.state, 'SUCCEEDED');
  assert.equal(unknownErp.publishReceiptCount, 1);
  assert.equal(unknownErp.ozonSubmissionCount, 1);
  assert.equal(
    unknownErp.requests.filter((request) => request.path.endsWith('/ozon-publish/execute')).length,
    1,
  );
}

async function expectProviderFailure(options, expectedCode) {
  const fixture = createProviderClient(options);
  const selectedProfile = options.selectedProfile || profile();
  const origin = (() => {
    try { return permissionApi.canonicalizeOrigin(selectedProfile.baseUrl); } catch { return PROVIDER_ORIGIN; }
  })();
  await assert.rejects(
    fixture.client.generate({
      profileId: selectedProfile.id,
      prompt: 'QA hostile response fixture',
      negativePrompt: null,
      size: '1024x1024',
      idempotencyKey: options.idempotencyKey,
      readinessBinding: readinessBinding({
        providerOrigin: origin,
        model: selectedProfile.model,
      }),
    }),
    (error) => error && (typeof expectedCode === 'function'
      ? expectedCode(error)
      : expectedCode.test(String(error.code || ''))),
  );
  return fixture;
}

{
  let privateFetches = 0;
  await expectProviderFailure({
    selectedProfile: profile({ baseUrl: 'https://127.0.0.1/v1' }),
    idempotencyKey: 'qa01-private-host',
    async fetchImpl() { privateFetches += 1; throw new Error('must not fetch'); },
  }, /PROFILE_(?:INVALID|ENDPOINT_INVALID)/u);
  assert.equal(privateFetches, 0);
}

{
  let resultDownloads = 0;
  let resultDownloadRequest = null;
  await expectProviderFailure({
    idempotencyKey: 'qa01-redirect-result',
    async fetchImpl(url, init) {
      if (init.method === 'POST') {
        return providerJson({ data: [{ url: PROVIDER_ORIGIN + '/result.png' }] });
      }
      resultDownloads += 1;
      resultDownloadRequest = { url: String(url), init };
      throw new TypeError('redirect blocked by fixture');
    },
  }, (error) => error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
    && error.causeCode === 'SS_ERP_BYOK_PROVIDER_FETCH_FAILED');
  assert.equal(resultDownloads, 1);
  assert.equal(resultDownloadRequest.url, PROVIDER_ORIGIN + '/result.png');
  assert.equal(resultDownloadRequest.init.redirect, 'error');
  assert.equal(resultDownloadRequest.init.credentials, 'omit');
  assert.equal(resultDownloadRequest.init.headers.Authorization, undefined);
}

{
  await expectProviderFailure({
    idempotencyKey: 'qa01-response-bomb',
    async fetchImpl() {
      return providerJson({ data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }] }, {
        headers: { 'content-length': String(providerApi.LIMITS.maxJsonBytes + 1) },
      });
    },
  }, (error) => error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
    && error.causeCode === 'SS_ERP_BYOK_PROVIDER_RESPONSE_TOO_LARGE');
}

{
  await expectProviderFailure({
    idempotencyKey: 'qa01-malformed-image',
    async fetchImpl() {
      return providerJson({ data: [{ b64_json: Buffer.from('not-an-image').toString('base64') }] });
    },
  }, (error) => error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
    && error.causeCode === 'SS_ERP_BYOK_PROVIDER_RESULT_INVALID');
}

assert.equal(fakeErp.publishReceiptCount, 1, 'the accepted happy-path confirmation owns one receipt');
assert.equal(fakeErp.ozonSubmissionCount, 1, 'the accepted happy-path confirmation submits once');
assert.equal(
  fakeErp.requests.filter((request) => /ai-(?:image|media)|cost|reservation/iu.test(request.path)).length,
  0,
  'the extension BYOK path must not invoke an ERP-hosted AI or billing endpoint',
);

console.log('extension BYOK text-to-image vertical fixture tests passed');
