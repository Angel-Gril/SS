import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const extensionRoot = 'extensions/ss-erp';
const legacyPolicyPath = `${extensionRoot}/shared/message-security/runtime-message-policy.js`;
const authorizationPath = `${extensionRoot}/shared/message-security/runtime-message-authorization.js`;
const serviceWorkerPath = `${extensionRoot}/background/service-worker.js`;
const verifierPath = 'scripts/verify-extension-package.mjs';
const preflightPath = 'scripts/preflight.mjs';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

function loadApi() {
  const context = {
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TypeError,
    URL,
  };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(legacyPolicyPath, 'utf8'),
    context,
    { filename: legacyPolicyPath },
  );
  vm.runInNewContext(
    fs.readFileSync(authorizationPath, 'utf8'),
    context,
    { filename: authorizationPath },
  );
  return {
    api: context.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION,
    policy: context.SS_ERP_RUNTIME_MESSAGE_POLICY,
  };
}

function extensionSender(path, overrides = {}) {
  const url = `chrome-extension://${extensionId}${path}`;
  return {
    id: extensionId,
    url,
    origin: `chrome-extension://${extensionId}`,
    frameId: 0,
    ...overrides,
  };
}

test('limits selected-edit review handoff to the exact workbench page', () => {
  const { api, policy } = loadApi();
  const type = 'ss-erp:ai-image-workbench-edit-review';
  assert.equal(policy.isAllowedRuntimeMessageSender(
    type, extensionSender('/pages/ai-image-workbench.html'), extensionId,
  ), true);
  assert.equal(api.MESSAGE_TYPES.WORKBENCH.EDIT_REVIEW, type);
  for (const sender of [
    extensionSender('/pages/settings.html'),
    extensionSender('/pages/ai-provider-settings.html'),
    extensionSender('/pages/media-editor.html'),
    extensionSender('/pages/ai-image-workbench.html', { frameId: 1 }),
    extensionSender('/pages/ai-image-workbench.html', { id: 'other-extension' }),
    { id: extensionId, frameId: 0, url: 'https://detail.1688.com/offer/1.html' },
    { id: extensionId, frameId: 0, url: 'https://ss-erp.com/image-processing' },
  ]) {
    assert.equal(policy.isAllowedRuntimeMessageSender(type, sender, extensionId), false);
  }
});

function readinessBinding(api, overrides = {}) {
  return {
    contractVersion: api.READINESS_BINDING_VERSION,
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 4,
    draftVersion: 2,
    sourcePlatform: '1688',
    sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    providerOrigin: 'https://relay.example',
    model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    policyRevision: 'policy-17',
    ...overrides,
  };
}

function verifiedReadiness(api, binding, overrides = {}) {
  const value = {
    contractVersion: api.READINESS_VERIFICATION_VERSION,
    authenticated: true,
    handleId: 'readiness-1',
    expiresAt: '2026-07-25T12:10:00.000Z',
    binding,
    ...overrides,
  };
  Object.defineProperty(value, 'concurrencyAuthority', {
    value: Object.freeze({ policyRevision: binding.policyRevision, maxConcurrency: 1 }),
    enumerable: false,
  });
  return value;
}

test('adds closed workbench and Provider-settings sender matrices without widening legacy pages', () => {
  const { api, policy } = loadApi();
  const settingsList = api.MESSAGE_TYPES.PROVIDER_SETTINGS.LIST_PROFILES;
  const setupContext = api.MESSAGE_TYPES.PROVIDER_SETTINGS.GET_SETUP_CONTEXT;
  const preparePermission = api.MESSAGE_TYPES.PROVIDER_SETTINGS.PREPARE_PERMISSION;
  const setKey = api.MESSAGE_TYPES.PROVIDER_SETTINGS.SET_SESSION_KEY;
  const settingsReadiness = api.MESSAGE_TYPES.PROVIDER_SETTINGS.GET_READINESS;
  const workbenchState = api.MESSAGE_TYPES.WORKBENCH.GET_PUBLIC_STATE;
  const execute = api.MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER;
  const preview = api.MESSAGE_TYPES.WORKBENCH.OPEN_PREVIEW;
  const review = api.MESSAGE_TYPES.WORKBENCH.REVIEW_RESULT;
  const recoverIngest = api.MESSAGE_TYPES.WORKBENCH.RECOVER_INGEST;
  const publish = api.MESSAGE_TYPES.WORKBENCH.PUBLISH;
  const batchTypes = [
    api.MESSAGE_TYPES.WORKBENCH.BATCH_STATE,
    api.MESSAGE_TYPES.WORKBENCH.BATCH_START,
    api.MESSAGE_TYPES.WORKBENCH.BATCH_COMMAND,
    api.MESSAGE_TYPES.WORKBENCH.BATCH_PREVIEW,
    api.MESSAGE_TYPES.WORKBENCH.BATCH_INGEST,
    api.MESSAGE_TYPES.WORKBENCH.BATCH_RECOVER,
    api.MESSAGE_TYPES.WORKBENCH.BATCH_CLEAR,
  ];
  const hostedTypes = Object.values(api.MESSAGE_TYPES.HOSTED_WORKBENCH);

  for (const type of [
    setupContext,
    settingsList,
    setKey,
    settingsReadiness,
    preparePermission,
    workbenchState,
    execute,
    preview,
    review,
    recoverIngest,
    publish,
    ...batchTypes,
    ...hostedTypes,
  ]) {
    assert.equal(policy.isKnownRuntimeMessageType(type), true);
  }
  assert.equal(policy.isAllowedRuntimeMessageSender(
    setupContext,
    extensionSender('/pages/ai-provider-settings.html'),
    extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    settingsList,
    extensionSender('/pages/ai-provider-settings.html'),
    extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    setKey,
    extensionSender('/pages/ai-provider-settings.html'),
    extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    settingsReadiness,
    extensionSender('/pages/ai-provider-settings.html'),
    extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    preparePermission,
    extensionSender('/pages/ai-provider-settings.html'),
    extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    workbenchState,
    extensionSender('/pages/ai-image-workbench.html'),
    extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    execute,
    extensionSender('/pages/ai-image-workbench.html'),
    extensionId,
  ), true);
  for (const type of hostedTypes) {
    assert.equal(policy.isAllowedRuntimeMessageSender(
      type,
      extensionSender('/pages/ai-image-workbench.html'),
      extensionId,
    ), true);
    for (const path of [
      '/pages/ai-provider-settings.html',
      '/pages/settings.html',
      '/pages/media-editor.html',
    ]) {
      assert.equal(policy.isAllowedRuntimeMessageSender(
        type,
        extensionSender(path),
        extensionId,
      ), false);
    }
    assert.equal(policy.isAllowedRuntimeMessageSender(type, {
      id: extensionId,
      url: 'https://detail.1688.com/offer/1.html',
      tab: { url: 'https://detail.1688.com/offer/1.html' },
    }, extensionId), false);
  }
  assert.equal(policy.isAllowedRuntimeMessageSender(
    publish,
    extensionSender('/pages/ai-image-workbench.html'),
    extensionId,
  ), true);
  for (const type of batchTypes) {
    assert.equal(policy.isAllowedRuntimeMessageSender(
      type,
      extensionSender('/pages/ai-image-workbench.html'),
      extensionId,
    ), true);
    assert.equal(policy.isAllowedRuntimeMessageSender(
      type,
      extensionSender('/pages/ai-provider-settings.html'),
      extensionId,
    ), false);
    assert.equal(policy.isAllowedRuntimeMessageSender(type, {
      id: extensionId,
      url: 'https://detail.1688.com/offer/1.html',
      tab: { url: 'https://detail.1688.com/offer/1.html' },
    }, extensionId), false);
  }

  assert.equal(policy.isAllowedRuntimeMessageSender(
    execute,
    extensionSender('/pages/ai-provider-settings.html'),
    extensionId,
  ), false);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    setKey,
    extensionSender('/pages/ai-image-workbench.html'),
    extensionId,
  ), false);
  for (const path of ['/pages/settings.html', '/pages/popup.html', '/pages/media-editor.html']) {
    assert.equal(policy.isAllowedRuntimeMessageSender(setKey, extensionSender(path), extensionId), false);
    assert.equal(policy.isAllowedRuntimeMessageSender(execute, extensionSender(path), extensionId), false);
  }
});

test('allows receipt-only ingest recovery from the exact workbench without a stale draft readiness handle', async () => {
  const { api } = loadApi();
  let verificationCalls = 0;
  const decision = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message: {
      type: api.MESSAGE_TYPES.WORKBENCH.RECOVER_INGEST,
      payload: { resultId: 'br_' + 'a'.repeat(48) },
    },
    async verifyReadinessHandle() { verificationCalls += 1; },
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.readiness, null);
  assert.equal(verificationCalls, 0);
});

test('allows approved Blob ingest to rely on its dedicated server grant instead of generation readiness', async () => {
  const { api } = loadApi();
  let verificationCalls = 0;
  const decision = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message: {
      type: api.MESSAGE_TYPES.WORKBENCH.INGEST,
      payload: { resultId: 'br_' + 'b'.repeat(48) },
    },
    async verifyReadinessHandle() { verificationCalls += 1; },
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.readiness, null);
  assert.equal(verificationCalls, 0);
});

test('allows publish preview and confirmation to rely on the exact live server publish grant', async () => {
  const { api } = loadApi();
  let verificationCalls = 0;
  for (const payload of [
    { action: 'PREVIEW' },
    { action: 'CONFIRM', previewHash: 'a'.repeat(64) },
    { action: 'RECOVER' },
  ]) {
    const decision = await api.authorizeRuntimeMessage({
      runtimeId: extensionId,
      sender: extensionSender('/pages/ai-image-workbench.html'),
      message: { type: api.MESSAGE_TYPES.WORKBENCH.PUBLISH, payload },
      async verifyReadinessHandle() { verificationCalls += 1; },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.readiness, null);
  }
  assert.equal(verificationCalls, 0);
});

test('denies content scripts, externally connected pages and inconsistent extension senders', () => {
  const { api, policy } = loadApi();
  const setKey = api.MESSAGE_TYPES.PROVIDER_SETTINGS.SET_SESSION_KEY;
  const execute = api.MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER;

  for (const sender of [
    { id: extensionId, url: 'https://detail.1688.com/offer/1.html', tab: { url: 'https://detail.1688.com/offer/1.html' } },
    { id: extensionId, url: 'https://app.ss-erp.com/products', tab: { url: 'https://app.ss-erp.com/products' } },
    { id: extensionId, url: 'https://www.ozon.ru/product/1', tab: { url: 'https://www.ozon.ru/product/1' } },
    { url: 'https://app.ss-erp.com/products', origin: 'https://app.ss-erp.com' },
    { id: 'forged', url: `chrome-extension://${extensionId}/pages/ai-provider-settings.html` },
    extensionSender('/pages/ai-provider-settings.html?apiKey=forbidden'),
    extensionSender('/pages/ai-provider-settings.html#secret'),
    extensionSender('/pages/ai-provider-settings.html', { frameId: 2 }),
    extensionSender('/pages/ai-provider-settings.html', {
      tab: { url: `chrome-extension://${extensionId}/pages/ai-image-workbench.html` },
    }),
  ]) {
    assert.equal(policy.isAllowedRuntimeMessageSender(setKey, sender, extensionId), false);
    assert.equal(policy.isAllowedRuntimeMessageSender(execute, sender, extensionId), false);
  }
});

test('allows the unified AI workbench launcher only from an exact supported source-product page', () => {
  const { policy } = loadApi();
  const type = 'ss-erp:source-ai-workbench-open';
  const sourceSender = (url) => ({
    id: extensionId,
    url,
    documentUrl: url,
    origin: new URL(url).origin,
    frameId: 0,
    tab: { id: 12, url },
    documentId: 'source-document-1',
  });
  assert.equal(policy.isKnownRuntimeMessageType(type), true);
  for (const url of [
    'https://detail.1688.com/offer/123.html',
    'https://mobile.yangkeduo.com/goods.html?goods_id=456',
    'https://item.taobao.com/item.htm?id=789',
    'https://detail.tmall.com/item.htm?id=987',
  ]) {
    assert.equal(policy.isAllowedRuntimeMessageSender(type, sourceSender(url), extensionId), true);
  }
  for (const sender of [
    sourceSender('https://s.1688.com/selloffer/offer_search.htm'),
    sourceSender('https://www.taobao.com/'),
    sourceSender('https://detail.1688.com/offer/123.html#changed'),
    extensionSender('/pages/ai-image-workbench.html'),
    { id: extensionId, url: 'https://app.ss-erp.com/products' },
  ]) {
    assert.equal(policy.isAllowedRuntimeMessageSender(type, sender, extensionId), false);
  }
});

test('permits one exact settings-to-background key request without returning or echoing the key', async () => {
  const { api } = loadApi();
  const secret = 'sk-session-secret-sentinel';
  const decision = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-provider-settings.html'),
    message: {
      type: api.MESSAGE_TYPES.PROVIDER_SETTINGS.SET_SESSION_KEY,
      payload: { profileId: 'relay-profile-1', apiKey: secret },
    },
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.senderSurface, api.SENDER_SURFACES.PROVIDER_SETTINGS);
  assert.equal(decision.secretRequest, true);
  assert.equal(JSON.stringify(decision).includes(secret), false);
  assert.equal('message' in decision, false);
  assert.equal('payload' in decision, false);

  for (const message of [
    {
      type: api.MESSAGE_TYPES.PROVIDER_SETTINGS.SAVE_PROFILE,
      payload: { profile: { id: 'relay-profile-1', apiKey: secret } },
    },
    {
      type: api.MESSAGE_TYPES.WORKBENCH.GET_PUBLIC_STATE,
      payload: { nested: { authorization: `Bearer ${secret}` } },
    },
    {
      type: api.MESSAGE_TYPES.WORKBENCH.GET_PUBLIC_STATE,
      payload: { rawBase64: `data:image/png;base64,${secret}` },
    },
    {
      type: api.MESSAGE_TYPES.WORKBENCH.GET_PUBLIC_STATE,
      payload: { note: `sk-proj-${'a'.repeat(28)}` },
    },
    {
      type: api.MESSAGE_TYPES.WORKBENCH.GET_PUBLIC_STATE,
      payload: { note: `ghp_${'b'.repeat(32)}` },
    },
  ]) {
    const rejected = await api.authorizeRuntimeMessage({
      runtimeId: extensionId,
      sender: message.type === api.MESSAGE_TYPES.PROVIDER_SETTINGS.SAVE_PROFILE
        ? extensionSender('/pages/ai-provider-settings.html')
        : extensionSender('/pages/ai-image-workbench.html'),
      message,
    });
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.code, 'SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN');
    assert.equal(JSON.stringify(rejected).includes(secret), false);
  }
});

test('rejects byte-like arrays and encoded image bodies before a workbench handler runs', async () => {
  const { api } = loadApi();
  for (const payload of [
    { chunks: [0x89, 0x50, 0x4e, 0x47, ...new Array(128).fill(0)] },
    { opaque: `iVBORw0KGgoAAAANSUhEUg${'A'.repeat(2048)}` },
    { nested: { opaque: `/9j/${'A'.repeat(2048)}` } },
  ]) {
    const rejected = await api.authorizeRuntimeMessage({
      runtimeId: extensionId,
      sender: extensionSender('/pages/ai-image-workbench.html'),
      message: {
        type: api.MESSAGE_TYPES.WORKBENCH.GET_PUBLIC_STATE,
        payload,
      },
    });
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.code, 'SS_ERP_RUNTIME_MESSAGE_BINARY_FORBIDDEN');
  }
});

test('requires an authenticated exact ERP readiness binding for Provider actions', async () => {
  const { api } = loadApi();
  const binding = readinessBinding(api);
  const message = {
    type: api.MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
    payload: { profileId: 'relay-profile-1', prompt: 'Create a neutral product image' },
    readinessHandle: 'opaque-erp-readiness-handle',
    readinessBinding: binding,
  };

  const missingVerifier = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message,
  });
  assert.equal(missingVerifier.allowed, false);
  assert.equal(missingVerifier.code, 'SS_ERP_RUNTIME_MESSAGE_READINESS_UNAVAILABLE');

  let verificationCalls = 0;
  const allowed = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message,
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    async verifyReadinessHandle(input) {
      verificationCalls += 1;
      assert.equal(input.handle, 'opaque-erp-readiness-handle');
      assert.equal(input.messageType, message.type);
      assert.equal(input.senderSurface, api.SENDER_SURFACES.WORKBENCH);
      return verifiedReadiness(api, input.expectedBinding);
    },
  });
  assert.equal(verificationCalls, 1);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.readiness.handleId, 'readiness-1');
  assert.equal(allowed.readiness.binding.operation, 'TEXT_TO_IMAGE');
  assert.deepEqual(JSON.parse(JSON.stringify(allowed.readiness.concurrencyAuthority)), {
    policyRevision: binding.policyRevision, maxConcurrency: 1,
  });
  assert.equal(JSON.stringify(allowed).includes('opaque-erp-readiness-handle'), false);

  const mismatch = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message,
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    async verifyReadinessHandle() {
      return verifiedReadiness(api, readinessBinding(api, { shopId: 'other-shop' }));
    },
  });
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.code, 'SS_ERP_RUNTIME_MESSAGE_READINESS_MISMATCH');

  const expired = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message,
    now: () => new Date('2026-07-25T14:00:00.000Z'),
    async verifyReadinessHandle() {
      return verifiedReadiness(api, binding);
    },
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.code, 'SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');

  const tooLong = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message,
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    async verifyReadinessHandle() {
      return verifiedReadiness(api, binding, { expiresAt: '2026-07-25T12:10:00.001Z' });
    },
  });
  assert.equal(tooLong.allowed, false);
  assert.equal(tooLong.code, 'SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
});

test('authorizes only selected-SKU hero and the four exact shared-detail readiness slots', async () => {
  const { api } = loadApi();
  const allowedSlots = [
    'sku:sku-selected:hero',
    'shared:detail:SCENE',
    'shared:detail:DETAIL',
    'shared:detail:SPEC',
    'shared:detail:PACKAGING',
  ];
  let verificationCalls = 0;
  for (const [index, slotKey] of allowedSlots.entries()) {
    const binding = readinessBinding(api, {
      skuKey: 'sku-selected',
      slotKey,
      assignmentOrdinal: index,
    });
    const decision = await api.authorizeRuntimeMessage({
      runtimeId: extensionId,
      sender: extensionSender('/pages/ai-image-workbench.html'),
      message: {
        type: api.MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
        payload: { profileId: 'relay-profile-1' },
        readinessHandle: `readiness-slot-${index + 1}`,
        readinessBinding: binding,
      },
      now: () => new Date('2026-07-25T12:00:00.000Z'),
      async verifyReadinessHandle(input) {
        verificationCalls += 1;
        return verifiedReadiness(api, input.expectedBinding);
      },
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.readiness.binding.slotKey, slotKey);
  }
  assert.equal(verificationCalls, allowedSlots.length);

  for (const [index, bindingOverrides] of [
    { skuKey: 'sku-selected', slotKey: 'sku:sku-other:hero' },
    { skuKey: 'sku-selected', slotKey: 'sku:sku-selected:detail:1' },
    { skuKey: 'sku-selected', slotKey: 'group:visual-1:detail:SCENE' },
    { skuKey: 'sku-selected', slotKey: 'shared:detail:FUNCTION' },
    { skuKey: 'sku-selected', slotKey: 'shared:detail:SPECIFICATION' },
    { skuKey: 'sku-selected', slotKey: 'shared:detail:scene' },
    { skuKey: 'sku-selected', slotKey: 'shared:detail:SCENE:extra' },
    {
      skuKey: 'sku-selected', slotKey: 'shared:detail:SCENE', assignmentMode: 'REPLACE',
    },
  ].entries()) {
    const decision = await api.authorizeRuntimeMessage({
      runtimeId: extensionId,
      sender: extensionSender('/pages/ai-image-workbench.html'),
      message: {
        type: api.MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
        payload: { profileId: 'relay-profile-1' },
        readinessHandle: `invalid-readiness-slot-${index + 1}`,
        readinessBinding: readinessBinding(api, bindingOverrides),
      },
      async verifyReadinessHandle() {
        verificationCalls += 1;
        throw new Error('invalid slot must fail before readiness verification');
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, 'SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
  }
  assert.equal(verificationCalls, allowedSlots.length);
});

test('rejects private, localhost and metadata Provider origins before readiness verification', async () => {
  const { api } = loadApi();
  let verificationCalls = 0;
  for (const providerOrigin of [
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://169.254.169.254',
    'https://metadata.google.internal',
    'https://provider.internal',
    'https://provider.local',
    'https://provider.home.arpa',
    'https://provider',
    'https://[::1]',
  ]) {
    const decision = await api.authorizeRuntimeMessage({
      runtimeId: extensionId,
      sender: extensionSender('/pages/ai-image-workbench.html'),
      message: {
        type: api.MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
        payload: { profileId: 'relay-profile-1' },
        readinessHandle: 'opaque-handle',
        readinessBinding: readinessBinding(api, { providerOrigin }),
      },
      async verifyReadinessHandle() {
        verificationCalls += 1;
        throw new Error('must not run');
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, 'SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
  }
  assert.equal(verificationCalls, 0);
});

test('does not consult readiness for an untrusted sender or a malformed secret-bearing request', async () => {
  const { api } = loadApi();
  let verificationCalls = 0;
  const verifyReadinessHandle = async () => {
    verificationCalls += 1;
    throw new Error('must not run');
  };
  const message = {
    type: api.MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
    payload: { apiKey: 'sk-never-forwarded' },
    readinessHandle: 'handle',
    readinessBinding: readinessBinding(api),
  };
  const denied = await api.authorizeRuntimeMessage({
    runtimeId: extensionId,
    sender: { id: extensionId, url: 'https://detail.1688.com/offer/1.html' },
    message,
    verifyReadinessHandle,
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'SS_ERP_RUNTIME_MESSAGE_SENDER_DENIED');
  assert.equal(verificationCalls, 0);
});

test('rejects secrets from every public runtime response while allowing redacted profile state', () => {
  const { api } = loadApi();
  const secret = 'sk-response-secret-sentinel';
  assert.doesNotThrow(() => api.assertSafeRuntimeResponse({
    ok: true,
    data: {
      profile: { id: 'relay-profile-1', baseUrl: 'https://relay.example/v1', model: 'image-model-v1' },
      hasKey: true,
      evidence: [],
    },
  }, [secret]));

  for (const response of [
    { ok: true, apiKey: secret },
    { ok: false, error: { authorization: `Bearer ${secret}` } },
    { ok: true, data: { rawBase64: `data:image/png;base64,${secret}` } },
    { ok: false, error: `Provider echoed ${secret}` },
    { ok: false, error: `sk-proj-${'a'.repeat(28)}` },
    { ok: false, error: `github_pat_${'b'.repeat(32)}` },
    { ok: false, error: `AKIA${'C'.repeat(16)}` },
    { ok: true, data: { b64_json: 'AAAA-not-a-data-url' } },
    { ok: true, data: { base64: 'AAAA-not-a-data-url' } },
    { ok: true, data: { imageData: 'AAAA-not-a-data-url' } },
    { ok: true, data: { url: 'https://provider.example/result.png' } },
  ]) {
    assert.throws(
      () => api.assertSafeRuntimeResponse(response, [secret]),
      (error) => error && error.code === 'SS_ERP_RUNTIME_RESPONSE_SECRET',
    );
  }
});

test('dispatcher authorizes before invoking handlers and sanitizes handler responses', async () => {
  const { api } = loadApi();
  const secret = 'sk-session-secret-sentinel';
  const keyType = api.MESSAGE_TYPES.PROVIDER_SETTINGS.SET_SESSION_KEY;
  const responses = [];
  let handlerCalls = 0;
  const result = await api.dispatchAuthorizedRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-provider-settings.html'),
    message: {
      type: keyType,
      payload: { profileId: 'relay-profile-1', apiKey: secret },
    },
    handlers: {
      [keyType]: async ({ readSecretPayload }) => {
        handlerCalls += 1;
        const payload = readSecretPayload();
        return { ok: true, apiKey: payload.apiKey };
      },
    },
    sendResponse(value) { responses.push(value); },
  });
  assert.equal(result, true);
  assert.equal(handlerCalls, 1);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].errorCode, 'SS_ERP_RUNTIME_RESPONSE_SECRET');
  assert.equal(responses[0].error, '扩展响应被安全策略阻止');
  assert.equal(JSON.stringify(responses).includes(secret), false);

  const deniedResponses = [];
  let deniedCalls = 0;
  let deniedSecretGuardCalls = 0;
  const denied = await api.dispatchAuthorizedRuntimeMessage({
    runtimeId: extensionId,
    sender: { id: extensionId, url: 'https://evil.example/' },
    message: { type: keyType, payload: { profileId: 'p', apiKey: secret } },
    handlers: { [keyType]: async () => { deniedCalls += 1; return { ok: true }; } },
    forbiddenResponseValues() {
      deniedSecretGuardCalls += 1;
      return [secret];
    },
    sendResponse(value) { deniedResponses.push(value); },
  });
  assert.equal(denied, false);
  assert.equal(deniedCalls, 0);
  assert.equal(deniedSecretGuardCalls, 0);
  assert.equal(deniedResponses[0].errorCode, 'SS_ERP_RUNTIME_MESSAGE_SENDER_DENIED');
  assert.equal(JSON.stringify(deniedResponses).includes(secret), false);

  const opaqueSecret = 'opaque-provider-credential-without-known-prefix';
  const publicType = api.MESSAGE_TYPES.WORKBENCH.GET_PUBLIC_STATE;
  const guardedResponses = [];
  await api.dispatchAuthorizedRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html'),
    message: { type: publicType, payload: { profileId: 'relay-profile-1' } },
    handlers: {
      [publicType]: async () => ({ ok: false, error: `Provider echoed ${opaqueSecret}` }),
    },
    async forbiddenResponseValues() { return [opaqueSecret]; },
    sendResponse(value) { guardedResponses.push(value); },
  });
  assert.equal(guardedResponses[0].errorCode, 'SS_ERP_RUNTIME_RESPONSE_SECRET');
  assert.equal(JSON.stringify(guardedResponses).includes(opaqueSecret), false);

  const senderResponses = [];
  await api.dispatchAuthorizedRuntimeMessage({
    runtimeId: extensionId,
    sender: extensionSender('/pages/ai-image-workbench.html', {
      tab: { id: 77, url: `chrome-extension://${extensionId}/pages/ai-image-workbench.html` },
      documentId: 'workbench-document-1',
    }),
    message: { type: publicType, payload: {} },
    handlers: {
      [publicType]: async ({ sender }) => ({ ok: true, data: sender }),
    },
    sendResponse(value) { senderResponses.push(value); },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(senderResponses[0].data)), {
    tabId: 77,
    documentId: 'workbench-document-1',
    frameId: 0,
  });
});

test('ships the authorization module as a background-only security boundary', () => {
  const authorizationSource = fs.readFileSync(authorizationPath, 'utf8');
  const serviceWorkerSource = fs.readFileSync(serviceWorkerPath, 'utf8');
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const preflightSource = fs.readFileSync(preflightPath, 'utf8');

  assert.doesNotMatch(
    authorizationSource,
    /chrome\.storage\.(?:local|sync)|\blocalStorage\b|\bsessionStorage\b|\bdocument\.|\.innerHTML\b|console\.(?:log|debug|info)|runtime\.sendMessage/u,
  );
  const importIndex = serviceWorkerSource.indexOf('../shared/message-security/runtime-message-authorization.js');
  const listenerIndex = serviceWorkerSource.indexOf('chrome.runtime.onMessage.addListener');
  assert.ok(importIndex >= 0 && importIndex < listenerIndex);
  assert.match(authorizationSource, /dispatchAuthorizedRuntimeMessage/u);
  assert.match(serviceWorkerSource, /dispatchAuthorizedRuntimeMessage/u);
  assert.match(serviceWorkerSource, /handlers:\s*globalThis\.SS_ERP_BYOK_RUNTIME_MESSAGE_HANDLERS/u);
  assert.match(
    serviceWorkerSource,
    /verifyReadinessHandle:\s*globalThis\.SS_ERP_BYOK_READINESS_HANDLE_VERIFIER/u,
  );
  assert.match(
    serviceWorkerSource,
    /forbiddenResponseValues:\s*globalThis\.SS_ERP_BYOK_RESPONSE_SECRET_VALUES/u,
  );
  assert.match(serviceWorkerSource, /shared\/byok\/readiness-handle-cache\.js/u);
  assert.match(serviceWorkerSource, /shared\/byok\/readiness-client\.js/u);
  assert.match(serviceWorkerSource, /shared\/byok\/provider-settings-handler\.js/u);
  assert.match(serviceWorkerSource, /shared\/byok\/workbench-runtime-handler\.js/u);
  assert.match(serviceWorkerSource, /installByokReadinessRuntime/u);
  assert.match(
    serviceWorkerSource,
    /providerSettingsDispatcher\.handlers[\s\S]*workbenchDispatcher\.handlers[\s\S]*batchWorkbenchDispatcher\.handlers/u,
  );
  assert.match(serviceWorkerSource, /SS_ERP_SOURCE_AI_WORKBENCH_OPEN_MESSAGE/u);
  assert.match(serviceWorkerSource, /chrome\.tabs\.onRemoved\.addListener/u);
  assert.doesNotMatch(serviceWorkerSource, /edit and batch handlers remain dark/u);
  assert.match(
    verifierSource,
    /requiredSecurityModules[\s\S]*shared\/message-security\/runtime-message-authorization\.js/u,
  );
  assert.match(preflightSource, /scripts\/extension-runtime-message-authorization\.test\.mjs/u);
});
