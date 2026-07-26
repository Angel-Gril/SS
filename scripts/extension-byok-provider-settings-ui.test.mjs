import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const htmlPath = `${root}/pages/ai-provider-settings.html`;
const cssPath = `${root}/pages/ai-provider-settings.css`;
const pagePath = `${root}/pages/ai-provider-settings.js`;
const clientPath = `${root}/shared/byok/provider-settings-client.js`;
const handlerPath = `${root}/shared/byok/provider-settings-handler.js`;
const authorizationPath = `${root}/shared/message-security/runtime-message-authorization.js`;
const policyPath = `${root}/shared/message-security/runtime-message-policy.js`;
const settingsPath = `${root}/pages/settings.html`;

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const handler = fs.readFileSync(handlerPath, 'utf8');
const settings = fs.readFileSync(settingsPath, 'utf8');

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function settle(turns = 8) {
  for (let index = 0; index < turns; index += 1) await tick();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

class FixtureElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.listeners = new Map();
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.disabled = false;
    this.checked = false;
    this.name = '';
    this.value = '';
    this._textContent = '';
  }

  get textContent() { return this._textContent; }

  set textContent(value) {
    this._textContent = String(value ?? '');
    if (this._textContent === '') this.children = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, input = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...input,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  focus() { this.focused = true; }

  querySelector() { return null; }

  querySelectorAll() { return []; }

  closest(selector) {
    if (selector === '[data-operation]' && this.dataset.operation) return this;
    return null;
  }
}

function profile(id, name = id, allowedOperations = ['TEXT_TO_IMAGE']) {
  return {
    id,
    name,
    baseUrl: `https://${id}.example/v1`,
    model: 'image-model-v1',
    allowedOperations,
    preferences: {
      defaultSize: '1024x1024',
      quality: 'auto',
      outputFormat: 'png',
    },
  };
}

function createPageHarness(options = {}) {
  let nowMs = options.nowMs ?? Date.parse('2026-07-26T08:00:00.000Z');
  const profiles = (options.profiles || [profile('relay-profile-1')]).map(plain);
  let setup = options.setup === undefined ? {
    device: {
      state: 'paired',
      scopes: ['byok:media:ingest'],
      expiresAt: '2026-07-27T08:00:00.000Z',
    },
    shops: [{ id: 'shop-1', name: 'Ozon Shop', status: 'ACTIVE' }],
    shopsState: 'available',
  } : options.setup;
  let profileState = options.profileState || {
    profile: profiles[0] || null,
    hasKey: true,
    evidence: [],
  };
  const calls = [];
  const runtimeListeners = [];
  const windowListeners = new Map();
  const timers = [];
  let confirmResult = true;

  class FixtureDate extends Date {
    constructor(value) {
      super(arguments.length ? value : nowMs);
    }

    static now() { return nowMs; }
  }

  const ids = [
    'pageStatus', 'refreshPageBtn', 'readinessSummary', 'generationPolicyState',
    'ingestPolicyState', 'publishPolicyState', 'policyRevision', 'shopSelect', 'shopStatus',
    'profileSelect', 'profileStateSummary', 'newProfileBtn', 'deleteProfileBtn', 'profileForm',
    'profileNameInput', 'baseUrlInput', 'modelInput', 'profileDirtyState', 'saveProfileBtn',
    'sessionKeyForm', 'apiKeyInput', 'setSessionKeyBtn', 'clearSessionKeyBtn', 'keyStatus',
    'permissionStatus', 'providerOrigin', 'requestPermissionBtn', 'revokePermissionBtn',
    'permissionReason', 'capabilitySummary', 'capabilityRows', 'capabilityLiveRegion',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FixtureElement('div', id)]));
  for (const id of [
    'refreshPageBtn', 'newProfileBtn', 'deleteProfileBtn', 'saveProfileBtn', 'setSessionKeyBtn',
    'clearSessionKeyBtn', 'requestPermissionBtn', 'revokePermissionBtn',
  ]) nodes[id].tagName = 'BUTTON';
  nodes.profileSelect.tagName = 'SELECT';
  nodes.shopSelect.tagName = 'SELECT';
  nodes.profileNameInput.tagName = 'INPUT';
  nodes.baseUrlInput.tagName = 'INPUT';
  nodes.modelInput.tagName = 'INPUT';
  nodes.apiKeyInput.tagName = 'INPUT';

  const operationInputs = [
    'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT',
  ].map((operation, index) => {
    const input = new FixtureElement('input', `operation-${operation}`);
    input.name = 'allowedOperations';
    input.value = operation;
    input.checked = index === 0;
    return input;
  });
  const formInputs = [
    nodes.profileNameInput,
    nodes.baseUrlInput,
    nodes.modelInput,
    ...operationInputs,
  ];
  nodes.profileForm.querySelectorAll = (selector) => {
    if (selector === 'input[name="allowedOperations"]:checked') {
      return operationInputs.filter((input) => input.checked);
    }
    if (selector === 'input[name="allowedOperations"]') return operationInputs;
    if (selector === 'input') return formInputs;
    return [];
  };

  const capabilityRows = new Map();
  for (const operation of ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']) {
    const row = new FixtureElement('article', `row-${operation}`);
    row.dataset.operation = operation;
    const fields = {
      '[data-role="capability-status"]': new FixtureElement('span'),
      '[data-role="capability-reason"]': new FixtureElement('p'),
      '[data-field="request-mode"]': new FixtureElement('dd'),
      '[data-field="verified-at"]': new FixtureElement('dd'),
      '[data-field="expires-at"]': new FixtureElement('dd'),
      '[data-action="test-capability"]': new FixtureElement('button'),
    };
    fields['[data-action="test-capability"]'].closest = (selector) => {
      if (selector === '[data-action="test-capability"]') {
        return fields['[data-action="test-capability"]'];
      }
      if (selector === '[data-operation]') return row;
      return null;
    };
    row.querySelector = (selector) => fields[selector] || null;
    row.fields = fields;
    capabilityRows.set(operation, row);
  }
  nodes.capabilityRows.querySelectorAll = (selector) => (
    selector === '[data-operation]' ? [...capabilityRows.values()] : []
  );

  const readinessFor = (operation) => ({
    readinessHandle: `rh_${operation.toLowerCase()}_${'a'.repeat(32)}`,
    readinessBinding: {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: 'owner-1',
      deviceSessionId: 'device-session-1',
      shopId: 'shop-1',
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
      providerOrigin: 'https://relay-profile-1.example',
      model: 'image-model-v1',
      operation,
      policyRevision: options.policyRevision || 'policy-7',
    },
    expiresAt: new FixtureDate(nowMs + 5 * 60 * 1000).toISOString(),
  });
  const client = {
    async getSetupContext() {
      calls.push(['getSetupContext']);
      if (setup instanceof Error) throw setup;
      return plain(setup);
    },
    async listProfiles() {
      calls.push(['listProfiles']);
      return { profiles: profiles.map(plain) };
    },
    async getProfileState(id) {
      calls.push(['getProfileState', id]);
      return plain(typeof profileState === 'function' ? profileState(id) : profileState);
    },
    async getPermissionStatus(id) {
      calls.push(['getPermissionStatus', id]);
      return {
        profileId: id,
        origin: `https://${id}.example`,
        granted: true,
      };
    },
    async getReadiness(input) {
      calls.push(['getReadiness', plain(input)]);
      if (typeof options.getReadiness === 'function') return options.getReadiness(input);
      return readinessFor(input.operation);
    },
    async preparePermission(input) {
      calls.push(['preparePermission', plain(input)]);
      if (typeof options.preparePermission === 'function') {
        return options.preparePermission(input);
      }
      return plain(input.readiness);
    },
    invalidatePreparedPermissions() {
      calls.push(['invalidatePreparedPermissions']);
      return { cleared: 1 };
    },
    discardPreparedPermission(value) {
      calls.push(['discardPreparedPermission', value && value.readinessHandle]);
      return { discarded: true };
    },
    async saveProfile(value) {
      calls.push(['saveProfile', plain(value)]);
      return { profile: plain(value), hasKey: false, evidence: [], rebound: false };
    },
    async removeProfile(id) {
      calls.push(['removeProfile', id]);
      return { profileId: id, deleted: true };
    },
    async setSessionKey(id, apiKey) {
      calls.push(['setSessionKey', id, apiKey]);
      return { profile: profiles.find((item) => item.id === id), hasKey: true, evidence: [] };
    },
    async clearSessionKey(id) {
      calls.push(['clearSessionKey', id]);
      return { profile: profiles.find((item) => item.id === id), hasKey: false, evidence: [] };
    },
    async revokePermission(id) {
      calls.push(['revokePermission', id]);
      return { profileId: id, removed: true };
    },
    requestPermissionFromGesture(input) {
      calls.push(['requestPermissionFromGesture', input.profile.id]);
      return Promise.resolve({ granted: true });
    },
    async testCapability(input) {
      calls.push(['testCapability', plain(input)]);
      return { operation: input.operation };
    },
  };

  const context = {
    Array,
    Boolean,
    Date: FixtureDate,
    Error,
    Intl,
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
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    document: {
      getElementById(id) { return nodes[id] || null; },
      createElement(tagName) { return new FixtureElement(tagName); },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) { runtimeListeners.push(listener); },
        },
      },
      permissions: {},
    },
    location: { href: 'chrome-extension://fixture/pages/ai-provider-settings.html' },
    setTimeout(callback, delay = 0) {
      const timer = { callback, dueAt: nowMs + Number(delay), cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    confirm(message) {
      calls.push(['confirm', message]);
      return confirmResult;
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT: {
      DEVICE_SESSION_INVALIDATED_MESSAGE: 'ss-erp:byok-device-session-invalidated',
      createClient() { return client; },
    },
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(page, context, { filename: pagePath });

  return {
    calls,
    capabilityRows,
    context,
    nodes,
    profiles,
    runtimeListeners,
    windowListeners,
    advance(milliseconds) { nowMs += milliseconds; },
    runDueTimers() {
      for (const timer of timers) {
        if (!timer.cleared && timer.dueAt <= nowMs) {
          timer.cleared = true;
          timer.callback();
        }
      }
    },
    setConfirmResult(value) { confirmResult = value; },
    setProfileState(value) { profileState = value; },
    setSetup(value) { setup = value; },
    emitRuntimeMessage(message) {
      for (const listener of runtimeListeners) listener(message, {}, () => {});
    },
  };
}

function contrast(left, right) {
  function luminance(hex) {
    const channels = hex.match(/[a-f0-9]{2}/giu).map((value) => Number.parseInt(value, 16) / 255);
    const linear = channels.map((value) => (
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('ships a focused settings page with complete accessible control references', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'DOM ids must be unique');
  for (const reference of html.matchAll(/\b(?:for|aria-describedby|aria-labelledby)="([^"]+)"/gu)) {
    for (const id of reference[1].split(/\s+/u)) {
      assert.ok(ids.includes(id), `missing referenced id: ${id}`);
    }
  }
  for (const button of html.matchAll(/<button\b[\s\S]*?<\/button>/gu)) {
    assert.match(button[0], /\btype="button"|\btype="submit"/u);
  }
  assert.match(html, /id="refreshPageBtn"[\s\S]*?aria-label="刷新状态"/u);
  assert.match(html, /id="shopSelect"/u);
  assert.match(html, /id="apiKeyInput"[\s\S]*?type="password"[\s\S]*?autocomplete="off"/u);
  assert.match(html, /<div id="sessionKeyForm"[^>]*role="group"/u);
  assert.doesNotMatch(html, /id="apiKeyInput"[^>]*\bname=/u);
  assert.match(html, /id="setSessionKeyBtn"[^>]*type="button"/u);
  assert.doesNotMatch(html, /\bremember\b|记住密钥|readinessHandle|value="(?:sk-|rk-|Bearer\s)/iu);
});

test('loads only packaged security modules and exposes all exact capability rows', () => {
  const scriptRefs = [...html.matchAll(/<script\s+src="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(scriptRefs, [
    '../shared/byok/permission-broker.js',
    '../shared/byok/permission-readiness-bridge.js',
    '../shared/byok/provider-settings-client.js',
    './ai-provider-settings.js',
  ]);
  assert.deepEqual(
    [...html.matchAll(/data-operation="([A-Z_]+)"/gu)].map((match) => match[1]),
    ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
  );
  assert.doesNotMatch(html, /<script[^>]+src="https?:\/\//iu);
  assert.match(settings, /id="openAiProviderSettingsLink"[\s\S]*?href="\.\/ai-provider-settings\.html"/u);
});

test('keeps secrets out of page state and requests permission directly in the trusted click stack', () => {
  assert.doesNotMatch(page, /chrome\.storage|localStorage|sessionStorage|innerHTML|outerHTML|console\./u);
  const keyHandler = page.slice(
    page.indexOf('async function setSessionKey'),
    page.indexOf('async function clearSessionKey'),
  );
  assert.ok(keyHandler.indexOf("nodes.apiKeyInput.value = ''") >= 0);
  assert.ok(keyHandler.indexOf("nodes.apiKeyInput.value = ''") < keyHandler.indexOf('client.setSessionKey'));
  const permissionHandler = page.slice(
    page.indexOf('function requestPermission(event)'),
    page.indexOf('async function revokePermission'),
  );
  assert.match(permissionHandler, /client\.requestPermissionFromGesture\(\{[\s\S]*?event:\s*event/u);
  assert.doesNotMatch(permissionHandler.split('client.requestPermissionFromGesture')[0], /\bawait\b|\.then\s*\(/u);
  assert.doesNotMatch(page, /MESSAGE_TYPES\.REQUEST_PERMISSION|runtime\.sendMessage/u);
  assert.match(
    page,
    /IMPLEMENTED_OPERATIONS\s*=\s*new Set\(OPERATIONS\)/u,
  );
  assert.match(page, /IMAGE_TO_IMAGE:\s*'multipart'/u);
  assert.match(page, /FULL_EDIT:\s*'multipart'/u);
  assert.match(page, /INPAINT:\s*'multipart'/u);
  assert.doesNotMatch(page, /Provider 编辑适配将在下一阶段开放/u);
});

test('keeps the key surface inert when page dependencies fail before Enter is pressed', () => {
  const keySurface = html.match(/<div id="sessionKeyForm"[\s\S]*?<\/div>\s*<\/div>/u)?.[0] || '';
  assert.ok(keySurface, 'session key surface must remain a non-submitting group');
  assert.doesNotMatch(keySurface, /<form\b|\baction=|\bmethod=|type="submit"/iu);
  assert.doesNotMatch(keySurface, /id="apiKeyInput"[^>]*\bname=/iu);

  let domLookups = 0;
  const location = { href: 'chrome-extension://fixture/pages/ai-provider-settings.html' };
  const context = {
    Error,
    location,
    document: {
      getElementById() {
        domLookups += 1;
        throw new Error('page must stop before DOM wiring');
      },
    },
    chrome: { runtime: {}, permissions: {} },
    SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT: {
      createClient() { throw new Error('dependency unavailable'); },
    },
  };
  context.globalThis = context;
  context.window = context;
  const before = location.href;
  vm.runInNewContext(page, context, { filename: pagePath });
  const keyInput = new FixtureElement('input', 'apiKeyInput');
  keyInput.value = 'sentinel-key-that-must-not-enter-the-url';
  keyInput.dispatch('keydown', { key: 'Enter' });
  assert.equal(domLookups, 0);
  assert.equal(location.href, before);
  assert.equal(location.href.includes(keyInput.value), false);
});

test('invalidates all redacted session state when the paired device authority changes', async () => {
  const expiresAt = '2026-07-26T08:01:00.000Z';
  const selected = profile('relay-profile-1');
  const harness = createPageHarness({
    profileState: {
      profile: selected,
      hasKey: true,
      evidence: [{
        contractVersion: 'extension-byok-capability-evidence/v1',
        operation: 'TEXT_TO_IMAGE',
        requestMode: 'json',
        policyRevision: 'policy-7',
        verifiedAt: '2026-07-26T07:59:00.000Z',
        expiresAt,
      }],
    },
  });
  await settle();
  const textRow = harness.capabilityRows.get('TEXT_TO_IMAGE');
  assert.equal(harness.nodes.keyStatus.textContent, '当前会话已加载');
  assert.equal(textRow.fields['[data-role="capability-status"]'].textContent, '已验证');

  const sentinel = 'sentinel-key-must-not-survive-device-invalidation';
  harness.nodes.apiKeyInput.value = sentinel;
  harness.setProfileState({ profile: selected, hasKey: false, evidence: [] });
  harness.emitRuntimeMessage({
    type: 'ss-erp:byok-device-session-invalidated',
    reason: 'device_authority_revoked',
  });

  assert.ok(
    harness.calls.some(([name]) => name === 'invalidatePreparedPermissions'),
    'prepared one-use permission tickets must be cleared synchronously',
  );
  assert.equal(harness.nodes.apiKeyInput.value, '');
  assert.equal(harness.nodes.keyStatus.textContent, '未加载');
  assert.notEqual(textRow.fields['[data-role="capability-status"]'].textContent, '已验证');
  assert.equal(harness.nodes.requestPermissionBtn.disabled, true);
  assert.equal(harness.context.location.href.includes(sentinel), false);
  await settle();
  assert.equal(harness.nodes.keyStatus.textContent, '未加载');
  assert.notEqual(textRow.fields['[data-role="capability-status"]'].textContent, '已验证');
});

test('discards an exact prepared permission that resolves after the selection epoch changed', async () => {
  const pending = deferred();
  let pendingInput;
  const harness = createPageHarness({
    preparePermission(input) {
      pendingInput = input;
      return pending.promise;
    },
  });
  await settle();
  assert.ok(pendingInput, 'initial readiness should reach background preparation');
  harness.nodes.newProfileBtn.dispatch('click');
  pending.resolve(plain(pendingInput.readiness));
  await settle();
  assert.ok(
    harness.calls.some(([name, handle]) => (
      name === 'discardPreparedPermission'
      && handle === pendingInput.readiness.readinessHandle
    )),
    'the exact stale prepared ticket must be destroyed after it resolves',
  );
  assert.equal(harness.nodes.requestPermissionBtn.disabled, true);
});

test('accepts capability evidence only for the live policy, mode, operation and expiry', async () => {
  const validEvidence = {
    contractVersion: 'extension-byok-capability-evidence/v1',
    operation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    policyRevision: 'policy-7',
    verifiedAt: '2026-07-26T07:59:00.000Z',
    expiresAt: '2026-07-26T08:00:01.000Z',
  };
  const valid = createPageHarness({
    profileState: {
      profile: profile('relay-profile-1'),
      hasKey: true,
      evidence: [validEvidence],
    },
  });
  await settle();
  const validRow = valid.capabilityRows.get('TEXT_TO_IMAGE');
  assert.equal(validRow.fields['[data-role="capability-status"]'].textContent, '已验证');
  assert.equal(valid.nodes.capabilitySummary.textContent, '1 项有效证据');
  valid.advance(1_100);
  valid.runDueTimers();
  await settle();
  assert.notEqual(validRow.fields['[data-role="capability-status"]'].textContent, '已验证');
  assert.equal(valid.nodes.capabilitySummary.textContent, '0 项有效证据');

  const invalidCases = [
    ['stale policy', { ...validEvidence, policyRevision: 'policy-6' }],
    ['wrong request mode', { ...validEvidence, requestMode: 'multipart' }],
    ['expired evidence', { ...validEvidence, expiresAt: '2026-07-26T07:59:59.999Z' }],
  ];
  for (const [label, evidence] of invalidCases) {
    const harness = createPageHarness({
      profileState: {
        profile: profile('relay-profile-1'),
        hasKey: true,
        evidence: [evidence],
      },
    });
    await settle();
    const row = harness.capabilityRows.get('TEXT_TO_IMAGE');
    assert.notEqual(
      row.fields['[data-role="capability-status"]'].textContent,
      '已验证',
      label,
    );
    assert.equal(harness.nodes.capabilitySummary.textContent, '0 项有效证据', label);
  }

  const editEvidence = { ...validEvidence, operation: 'IMAGE_TO_IMAGE', requestMode: 'multipart' };
  const editProfile = profile(
    'relay-profile-1',
    'relay-profile-1',
    ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'],
  );
  const editReady = createPageHarness({
    profiles: [editProfile],
    profileState: {
      profile: editProfile,
      hasKey: true,
      evidence: [editEvidence],
    },
  });
  await settle();
  assert.equal(
    editReady.capabilityRows.get('IMAGE_TO_IMAGE')
      .fields['[data-role="capability-status"]'].textContent,
    '已验证',
  );
  assert.equal(editReady.nodes.capabilitySummary.textContent, '1 项有效证据');
});

test('requires explicit confirmation before dirty profile state is replaced', async () => {
  const first = profile('relay-profile-1', 'First relay');
  const second = profile('relay-profile-2', 'Second relay');
  const harness = createPageHarness({ profiles: [first, second] });
  await settle();

  harness.nodes.profileSelect.value = first.id;
  harness.nodes.profileSelect.dispatch('change');
  await settle();
  assert.equal(harness.nodes.profileNameInput.value, first.name);
  harness.nodes.profileNameInput.value = 'Unsaved profile name';
  harness.nodes.profileForm.dispatch('input');
  assert.equal(harness.nodes.profileDirtyState.textContent, '未保存');
  harness.setConfirmResult(false);

  harness.nodes.newProfileBtn.dispatch('click');
  assert.equal(harness.nodes.profileSelect.value, first.id);
  assert.equal(harness.nodes.profileNameInput.value, 'Unsaved profile name');

  harness.nodes.profileSelect.value = second.id;
  harness.nodes.profileSelect.dispatch('change');
  await settle();
  assert.equal(harness.nodes.profileSelect.value, first.id);
  assert.equal(harness.nodes.profileNameInput.value, 'Unsaved profile name');

  const refreshCallsBefore = harness.calls.filter(([name]) => (
    name === 'getSetupContext' || name === 'listProfiles'
  )).length;
  harness.nodes.refreshPageBtn.dispatch('click');
  await settle();
  const refreshCallsAfter = harness.calls.filter(([name]) => (
    name === 'getSetupContext' || name === 'listProfiles'
  )).length;
  assert.equal(refreshCallsAfter, refreshCallsBefore);
  assert.equal(harness.nodes.profileNameInput.value, 'Unsaved profile name');
  assert.ok(harness.calls.filter(([name]) => name === 'confirm').length >= 3);

  const beforeUnload = harness.windowListeners.get('beforeunload') || [];
  assert.equal(beforeUnload.length, 1);
  let prevented = false;
  const event = {
    returnValue: undefined,
    preventDefault() { prevented = true; },
  };
  beforeUnload[0](event);
  assert.ok(prevented || event.returnValue === '');
});

test('invalidates an in-flight readiness request as soon as the profile form becomes dirty', async () => {
  const pending = deferred();
  const harness = createPageHarness({ getReadiness: () => pending.promise });
  await settle();
  harness.nodes.profileNameInput.value = 'Unsaved change';
  harness.nodes.profileForm.dispatch('input');
  pending.resolve({
    readinessHandle: `rh_${'c'.repeat(48)}`,
    readinessBinding: {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: 'owner-1',
      deviceSessionId: 'device-session-1',
      shopId: 'shop-1',
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
      providerOrigin: 'https://relay-profile-1.example',
      model: 'image-model-v1',
      operation: 'TEXT_TO_IMAGE',
      policyRevision: 'policy-7',
    },
    expiresAt: '2026-07-26T08:05:00.000Z',
  });
  await settle();
  assert.equal(harness.nodes.profileDirtyState.textContent, '未保存');
  assert.notEqual(harness.nodes.readinessSummary.textContent, '允许测试');
  assert.equal(harness.nodes.requestPermissionBtn.disabled, true);
  assert.equal(harness.calls.some(([name]) => name === 'preparePermission'), false);
});

test('preserves Provider profiles when setup or shop discovery is partially unavailable', async () => {
  const setupError = Object.assign(new Error('shop list unavailable'), {
    code: 'SS_ERP_BYOK_PROVIDER_SHOPS_UNAVAILABLE',
  });
  const partial = createPageHarness({ setup: setupError });
  await settle();
  assert.ok(
    partial.nodes.profileSelect.children.some((option) => option.value === 'relay-profile-1'),
    'a setup-context failure must not erase independently loaded profiles',
  );
  assert.equal(partial.nodes.profileNameInput.value, 'relay-profile-1');
  assert.match(partial.nodes.shopStatus.textContent, /无法读取|不可用|稍后重试/u);

  const unavailable = createPageHarness({
    setup: {
      device: {
        state: 'paired',
        scopes: ['byok:media:ingest'],
        expiresAt: '2026-07-27T08:00:00.000Z',
      },
      shops: [],
      shopsState: 'unavailable',
    },
  });
  await settle();
  assert.ok(
    unavailable.nodes.profileSelect.children.some((option) => option.value === 'relay-profile-1'),
  );
  assert.match(unavailable.nodes.shopStatus.textContent, /无法读取|不可用|稍后重试/u);
  assert.doesNotMatch(unavailable.nodes.shopStatus.textContent, /没有可用于测试/u);
});

test('wires lifecycle, stale-ticket, partial-refresh and dirty-navigation guards', () => {
  assert.match(page, /DEVICE_SESSION_INVALIDATED_MESSAGE/u);
  assert.match(page, /invalidatePreparedPermissions/u);
  assert.match(page, /discardPreparedPermission/u);
  assert.match(page, /Promise\.allSettled/u);
  assert.match(page, /shopsState/u);
  assert.match(page, /beforeunload/u);
});

test('communicates uncertain Provider completion and failed permission revocation explicitly', () => {
  assert.match(page, /SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME/u);
  assert.match(page, /结果未知，请勿重复请求/u);
  assert.match(page, /SS_ERP_BYOK_PERMISSION_REVOKE_FAILED/u);
});

test('uses the same closed Provider settings message values as runtime authorization', () => {
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
    clearTimeout,
    setTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(policyPath, 'utf8'), context, { filename: policyPath });
  vm.runInNewContext(fs.readFileSync(authorizationPath, 'utf8'), context, { filename: authorizationPath });
  vm.runInNewContext(client, context, { filename: clientPath });
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT.MESSAGE_TYPES)),
    JSON.parse(JSON.stringify(
      context.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION.MESSAGE_TYPES.PROVIDER_SETTINGS,
    )),
  );
  assert.match(handler, /GET_SETUP_CONTEXT_MESSAGE_TYPE:\s*'ss-erp:byok-provider-setup-context'/u);
  assert.match(handler, /permissions\.request must execute in the extension page's real click task/u);
});

test('meets responsive, focus, motion and text contrast floors', () => {
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media \(max-width:\s*620px\)/u);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|letter-spacing:\s*-/u);
  const brandStrong = css.match(/--brand-strong:\s*(#[a-f0-9]{6})/iu)?.[1];
  const quiet = css.match(/--quiet:\s*(#[a-f0-9]{6})/iu)?.[1];
  assert.ok(contrast(brandStrong, '#ffffff') >= 4.5, 'primary button contrast must meet WCAG AA');
  assert.ok(contrast(quiet, '#ffffff') >= 4.5, 'small metadata on white must meet WCAG AA');
  assert.ok(contrast(quiet, '#f8fafc') >= 4.5, 'small metadata on muted surface must meet WCAG AA');
});

console.log('PASS extension BYOK Provider settings UI contract');
