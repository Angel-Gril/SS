#!/usr/bin/env node
// Offline browser acceptance for the unchanged workbench page and its shared owners.
// Chrome message transport and ERP authority are fixtures; the runtime handler,
// launch session and edit epoch guard are real. This is not MV3 or live Provider QA.
// Usage: node scripts/extension-ai-workbench-browser-acceptance.mjs [--chrome <exe>]
// All artifacts contain synthetic data and live outside the repository by default.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
const PAGE_ORIGIN = 'https://ss-erp-browser-fixture.invalid';
const PROVIDER_ORIGIN = 'https://ss-erp-provider-fixture.example';
const PAGE_URL = PAGE_ORIGIN + '/pages/ai-image-workbench.html';
const SENTINEL = 'sk-browser-fixture-synthetic-never-use-20260908';
const PROMPT = '保留合成商品的形状与蓝色\n背景改为浅灰色，光线柔和\n不要添加文字';
const NEGATIVE_PROMPT = '水印、额外文字\n变形、虚构产品信息';
const STEP_TIMEOUT_MS = 15_000;
const SHARED_FIXTURE_MODULES = [
  'shared/byok/profile-schema.js',
  'shared/byok/profile-store.js',
  'shared/byok/permission-broker.js',
  'shared/contracts/ai-image-workbench-v1.js',
  'shared/byok/image-input-inspector.js',
  'shared/byok/image-mask-transform.js',
  'shared/byok/image-edit-adapters.js',
  'shared/byok/text-to-image-client.js',
  'shared/byok/image-edit-client.js',
  'shared/byok/generated-result-vault.js',
  'shared/byok/workbench-preview-channel.js',
  'shared/byok/workbench-media-channel.js',
  'shared/byok/workbench-edit-media-store.js',
  'shared/byok/media-job-engine.js',
  'shared/byok/workbench-provider-semaphore.js',
  'shared/byok/workbench-edit-controller.js',
  'shared/byok/workbench-launch-session.js',
  'shared/byok/workbench-edit-epoch-guard.js',
  'shared/byok/workbench-runtime-handler.js',
  'shared/byok/workbench-client.js',
];

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(check, label, timeout = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(75);
  }
  throw new Error(`Timed out: ${label}`);
}

function pngFixture() {
  function chunk(type, bytes) {
    const payload = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, payload, checksum]);
  }
  const side = 256;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(side * (side * 4 + 1));
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const offset = y * (side * 4 + 1) + 1 + x * 4;
      const product = x >= 72 && x <= 184 && y >= 45 && y <= 211;
      rows.set(product ? [31, 101, 196, 255] : [238, 242, 245, 255], offset);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
      } else {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params, message.sessionId);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`CDP closed during ${pending.method}`));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout')); }, 5000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, STEP_TIMEOUT_MS);
      this.pending.set(id, { method, resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, callback) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(callback);
  }
}

// This bridge supplies only external dependencies. The actual profile store, Provider
// serializers, result vault, upload/preview channels, editor controller, mask converter,
// runtime handler, launch session, edit epoch guard, page scripts and workspace state
// all run without replacement in Chromium.
function fixtureBridge({ providerOrigin, sentinel }) {
  const clone = (value) => structuredClone(value);
  const assertFixture = (condition, code) => {
    if (!condition) throw Object.assign(new Error(code), { code });
  };
  const diagnostics = { runtimeCalls: [], providerCalls: [], outcomes: [], errors: [], reviews: [],
    activations: [], metadataIgnored: [], ingestCalls: 0 };
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button');
    if (button && ['mediaPrimaryAction', 'approveButton'].includes(button.id)) {
      diagnostics.activations.push({ id: button.id, trusted: event.isTrusted, detail: event.detail });
    }
  }, true);
  const responseMetadata = ['usage', 'background', 'output_format', 'quality', 'size'];
  function assertMetadataIgnored(generated) {
    assertFixture(responseMetadata.every((key) => !Object.hasOwn(generated, key)), 'FIXTURE_PROVIDER_METADATA_EXPOSED');
    diagnostics.metadataIgnored.push(generated.operation);
  }
  async function imagePixels(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, rgba: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
    } finally { bitmap.close(); }
  }
  let originalMask = null;
  function storageArea(persistent) {
    const values = {};
    return {
      async get(keys) {
        const wanted = keys === null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys];
        return clone(Object.fromEntries(wanted.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]])));
      },
      async set(patch) {
        Object.assign(values, clone(patch));
        if (persistent) localStorage.setItem('fixture-chrome-storage-local', JSON.stringify(values));
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        if (persistent) localStorage.setItem('fixture-chrome-storage-local', JSON.stringify(values));
      },
      snapshot() { return clone(values); },
    };
  }
  const local = storageArea(true);
  const session = storageArea(false);
  const sync = storageArea(false);
  const schema = globalThis.SS_ERP_BYOK_PROFILE_SCHEMA;
  const profile = {
    id: 'browser-fixture-profile', name: '浏览器合成验收', baseUrl: providerOrigin + '/v1',
    model: 'fixture-image-model',
    allowedOperations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
    preferences: { defaultSize: '1024x1024', quality: 'auto', outputFormat: 'png' },
  };
  const launch = {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688', sourceProductId: 'synthetic-product',
    sourceCaptureSnapshotId: 'synthetic-capture', supplyGoodsId: 'synthetic-goods',
    shopId: 'synthetic-shop', workflowId: 'synthetic-workflow',
    draftRevision: 3, draftVersion: 4, skuKey: 'fixture-blue',
    slotKey: 'sku:fixture-blue:hero', assignmentMode: 'APPEND', assignmentOrdinal: 0,
  };
  const owner = { tabId: 1, documentId: 'synthetic-document', context: launch };
  const sender = { tabId: owner.tabId, documentId: owner.documentId, frameId: 0 };
  const lifecycleAuthority = { contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 1 };
  const profileStore = globalThis.SS_ERP_BYOK_PROFILE_STORE.createStore({ localStorage: local, sessionStorage: session });
  const permissionApi = globalThis.SS_ERP_BYOK_PERMISSION_BROKER;
  const permissionBroker = permissionApi.createBroker({
    sessionStorage: session,
    permissions: {
      async contains(input) { return input.origins.length === 1 && input.origins[0] === providerOrigin + '/*'; },
      async request() { throw new Error('Fixture never requests browser permissions'); },
      async remove() { return true; },
    },
  });
  function readiness(operation) {
    const value = {
      readinessHandle: 'rh_' + '1'.repeat(48),
      readinessBinding: {
        ...launch, contractVersion: 'extension-byok-readiness-binding/v2',
        ownerUserId: 'synthetic-owner', deviceSessionId: 'synthetic-device',
        providerOrigin, model: profile.model, operation, policyRevision: '17',
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    Object.defineProperty(value, 'concurrencyAuthority', {
      value: Object.freeze({ policyRevision: '17', maxConcurrency: 1 }), enumerable: false,
    });
    return value;
  }
  const executionIntentClient = {
    async claim(input) {
      const binding = input.readinessBinding;
      return {
        contractVersion: 'extension-byok-execution-intent/v1',
        intentId: 'synthetic-intent-' + diagnostics.providerCalls.length,
        replayed: false, executionMode: 'BYOK', outcome: 'PENDING',
        providerIdempotencyKey: input.providerIdempotencyKey,
        providerRequestHash: input.providerRequestHash,
        context: {
          shopId: binding.shopId, workflowId: binding.workflowId,
          draftRevision: binding.draftRevision, draftVersion: binding.draftVersion,
          skuKey: binding.skuKey, slotKey: binding.slotKey,
        },
      };
    },
    async reportOutcome(input) {
      diagnostics.outcomes.push(input.outcome);
      return { contractVersion: 'extension-byok-execution-intent-outcome/v1', replayed: false, ...input };
    },
  };
  async function fixtureFetch(url, init) {
    assertFixture([providerOrigin + '/v1/images/generations', providerOrigin + '/v1/images/edits'].includes(url), 'FIXTURE_UNEXPECTED_PROVIDER_URL');
    assertFixture(init.method === 'POST' && init.redirect === 'error' && init.credentials === 'omit', 'FIXTURE_UNSAFE_FETCH_OPTIONS');
    assertFixture(new Headers(init.headers).get('authorization') === 'Bearer ' + sentinel, 'FIXTURE_AUTH_SENTINEL_MISSING');
    const multipart = init.body instanceof FormData;
    const fields = multipart ? Object.fromEntries(init.body.entries()) : JSON.parse(init.body);
    const images = multipart ? [...init.body.entries()].filter(([key, value]) => key.startsWith('image') && value instanceof Blob) : [];
    const row = { kind: multipart ? 'multipart' : 'json', prompt: fields.prompt, imageCount: images.length, hasMask: fields.mask instanceof Blob };
    if (row.hasMask) {
      const actual = await imagePixels(fields.mask);
      assertFixture(originalMask && actual.width === originalMask.width && actual.height === originalMask.height,
        'FIXTURE_MASK_DIMENSIONS_CHANGED');
      assertFixture(actual.rgba.length === originalMask.rgba.length, 'FIXTURE_MASK_PIXEL_COUNT_CHANGED');
      row.mask = { width: actual.width, height: actual.height, transparent: 0, opaque: 0, softEdge: 0,
        sourceWhite: 0, sourceBlack: 0, sourceSoftEdge: 0, checkedPixels: 0, alphaMismatches: 0,
        rule: 'provider alpha = 255 - original exported mask red; white edits, black preserves',
      };
      for (let offset = 0; offset < actual.rgba.length; offset += 4) {
        const red = originalMask.rgba[offset];
        const alpha = actual.rgba[offset + 3];
        assertFixture(originalMask.rgba[offset + 1] === red && originalMask.rgba[offset + 2] === red
          && originalMask.rgba[offset + 3] === 255, 'FIXTURE_SOURCE_MASK_NOT_OPAQUE_GRAYSCALE');
        if (alpha !== 255 - red) row.mask.alphaMismatches += 1;
        // Canvas decoding canonicalizes fully transparent RGB to zero. For every
        // visible pixel the converter's white RGB channels must remain intact.
        if (alpha > 0) assertFixture(actual.rgba[offset] === 255 && actual.rgba[offset + 1] === 255
          && actual.rgba[offset + 2] === 255, 'FIXTURE_PROVIDER_MASK_COLOR_CHANGED');
        if (alpha === 0) row.mask.transparent += 1;
        else if (alpha === 255) row.mask.opaque += 1;
        else row.mask.softEdge += 1;
        if (red === 255) row.mask.sourceWhite += 1;
        else if (red === 0) row.mask.sourceBlack += 1;
        else row.mask.sourceSoftEdge += 1;
        row.mask.checkedPixels += 1;
      }
      assertFixture(row.mask.alphaMismatches === 0, 'FIXTURE_MASK_ALPHA_SEMANTICS_CHANGED');
      assertFixture(row.mask.transparent > 0 && row.mask.opaque > 0, 'FIXTURE_MASK_EDIT_AND_PRESERVE_REQUIRED');
      originalMask = null;
    }
    diagnostics.providerCalls.push(row);
    return fetch(url, init);
  }
  const common = { profileStore, permissionBroker, executionIntentClient, fetchImpl: fixtureFetch, crypto, timeoutMs: 10_000 };
  const textClient = globalThis.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT.createClient(common);
  const actualMaskTransformer = globalThis.SS_ERP_BYOK_IMAGE_MASK_TRANSFORM.createTransformer({ createImageBitmap, OffscreenCanvas });
  const imageEditClient = globalThis.SS_ERP_BYOK_IMAGE_EDIT_CLIENT.createClient({
    ...common,
    imageInputInspector: globalThis.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR,
    maskTransformer: {
      async toOpenAiMask(input) {
        assertFixture(input.maskSemantics === 'WHITE_EDIT_BLACK_PRESERVE_V1', 'FIXTURE_SOURCE_MASK_SEMANTICS_CHANGED');
        originalMask = await imagePixels(input.blob);
        assertFixture(originalMask.width === input.width && originalMask.height === input.height,
          'FIXTURE_SOURCE_MASK_DIMENSIONS_CHANGED');
        return actualMaskTransformer.toOpenAiMask(input);
      },
    },
    decodeImage: createImageBitmap,
  });
  const vault = globalThis.SS_ERP_BYOK_GENERATED_RESULT_VAULT.createVault({});
  const previewBroker = globalThis.SS_ERP_BYOK_WORKBENCH_PREVIEW_CHANNEL.createBroker({});
  const mediaBroker = globalThis.SS_ERP_BYOK_WORKBENCH_MEDIA_CHANNEL.createBroker({
    imageInspector: globalThis.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR,
    decodeImage: createImageBitmap,
  });
  const mediaStore = globalThis.SS_ERP_BYOK_WORKBENCH_EDIT_MEDIA_STORE.createStore({ broker: mediaBroker });
  const readinessClient = { async getReadiness(input) { return readiness(input.operation); } };
  const providerSemaphore = globalThis.SS_ERP_BYOK_WORKBENCH_PROVIDER_SEMAPHORE.createSemaphore({});
  const authorityGuard = {
    async capture(binding) {
      assertFixture(binding.ownerUserId === 'synthetic-owner' && binding.deviceSessionId === 'synthetic-device'
        && binding.shopId === launch.shopId && binding.workflowId === launch.workflowId
        && binding.draftRevision === launch.draftRevision && binding.draftVersion === launch.draftVersion,
      'FIXTURE_DEVICE_AUTHORITY_MISMATCH');
      return { ...binding, lifecycleAuthority };
    },
    async commitGeneratedResult(input) {
      assertMetadataIgnored(input.generated);
      return input.vault.put(input.generated, input.binding, input.authority.lifecycleAuthority);
    },
    matchesVaultAuthority(entry, binding, authority) {
      return entry.lifecycleEpoch === authority.lifecycleAuthority.epoch
        && JSON.stringify(entry.binding) === JSON.stringify(binding);
    },
  };
  const controller = globalThis.SS_ERP_BYOK_WORKBENCH_EDIT_CONTROLLER.createController({
    mediaJobEngine: globalThis.SS_ERP_BYOK_MEDIA_JOB_ENGINE,
    readinessClient, imageEditClient, generatedResultVault: vault, mediaStore, crypto,
    providerSemaphore, authorityGuard,
  });
  const manager = globalThis.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION.createManager({
    sessionStorage: session,
    tabs: {
      async create() { return { id: sender.tabId }; },
      async update(id) { return { id }; },
      async remove() {},
    },
    runtime: { getURL: (relative) => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + relative },
  });
  const editEpochGuard = globalThis.SS_ERP_BYOK_WORKBENCH_EDIT_EPOCH_GUARD.createGuard({ sessionStorage: session });
  const messageTypes = globalThis.SS_ERP_BYOK_WORKBENCH_CLIENT.MESSAGE_TYPES;
  const disabledExternalAction = async () => {
    throw Object.assign(new Error('External operation is outside this fixture'), { code: 'FIXTURE_EXTERNAL_OPERATION_DISABLED' });
  };
  const dispatcher = globalThis.SS_ERP_BYOK_WORKBENCH_RUNTIME_HANDLER.createDispatcher({
    messageTypes, sessionManager: manager,
    launchClient: { async resolve() {
      return { contractVersion: 'extension-byok-workbench-launch-decision/v2', state: 'READY', context: launch };
    } },
    assertSourceCurrent: async () => {},
    profileStore, permissionBroker, readinessClient, providerClient: textClient,
    vault, authorityGuard, previewBroker, editController: controller, editMediaStore: mediaStore,
    editEpochGuard, providerSemaphore,
    sourceMediaLibrary: {
      async loadCatalog() { return { contractVersion: 'extension-byok-workbench-source-catalog/v1', items: [] }; },
      open: disabledExternalAction,
    },
    ingestClient: {
      async ingest(input, authority) {
        diagnostics.ingestCalls += 1;
        vault.getApprovedForBackground(input.resultId);
        assertFixture(authority.ownerUserId === 'synthetic-owner', 'FIXTURE_INGEST_OWNER_MISMATCH');
        throw Object.assign(new Error('ERP ingest is outside this fixture'), { code: 'FIXTURE_ERP_INGEST_DISABLED' });
      },
      recover: disabledExternalAction, discardResult() {},
      getOperationState() { return { dispatched: false }; },
    },
    publishCoordinator: {
      preview: disabledExternalAction, confirm: disabledExternalAction, recover: disabledExternalAction,
      async getState() { return null; },
    },
    workbenchPublishCoordinator: {
      async getActive() { return null; },
      preview: disabledExternalAction, confirm: disabledExternalAction, recover: disabledExternalAction,
      async getState() { return null; },
    },
  });
  const ready = (async () => {
    await manager.open({ context: launch, sourceTabId: 12, sourceDocumentId: 'synthetic-source-document' });
    await manager.claim(sender);
    await session.set({ [permissionApi.SESSION_CONSENT_STORAGE_KEY]: { [providerOrigin]: true } });
    await profileStore.saveProfile(profile);
    await profileStore.setApiKey(profile.id, sentinel);
    const credential = await profileStore.getCredentialSnapshotForBackground(profile.id);
    for (const operation of profile.allowedOperations) {
      await profileStore.setCapabilityEvidence(profile.id, {
        contractVersion: 'extension-byok-capability/v1',
        profileIdentity: schema.profileIdentity(profile), operation,
        requestMode: operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart', policyRevision: '17',
        verifiedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 240_000).toISOString(),
      }, credential.credentialRevision);
    }
  })();
  async function publicState() {
    const response = await dispatcher.handlers[messageTypes.GET_PUBLIC_STATE]({ payload: {}, sender });
    assertFixture(response.ok === true, response.errorCode || 'FIXTURE_PUBLIC_STATE_FAILED');
    return response.data;
  }
  async function dispatch(message) {
    await ready;
    const input = message.payload || {};
    diagnostics.runtimeCalls.push(message.type);
    if (Object.hasOwn(dispatcher.handlers, message.type)) {
      const context = { payload: input, sender };
      if (message.type === messageTypes.EXECUTE_PROVIDER) {
        const granted = readiness('TEXT_TO_IMAGE');
        assertFixture(message.readinessHandle === granted.readinessHandle
          && JSON.stringify(message.readinessBinding) === JSON.stringify(granted.readinessBinding),
        'FIXTURE_READINESS_BINDING_MISMATCH');
        // The transport authorization is a synthetic ERP boundary. The actual
        // handler still validates and owns operation/session/result transitions.
        context.authorization = { readiness: {
          binding: granted.readinessBinding, expiresAt: granted.expiresAt,
          concurrencyAuthority: granted.concurrencyAuthority,
        } };
      }
      if (message.type === messageTypes.REVIEW_RESULT) diagnostics.reviews.push(input.decision);
      return dispatcher.handlers[message.type](context);
    }
    switch (message.type) {
      case 'SS_ERP_HOSTED_WORKBENCH_GET_MODE_LOCK':
        return { ok: true, data: { contractVersion: 'extension-hosted-ai-image-mode-lock/v1', context: input.binding,
          state: 'NO_SUITE', hostedExecutionEnabled: false } };
      case 'ss-erp:ai-image-workbench-batch-state':
        return { ok: true, data: {
          contractVersion: 'extension-byok-workbench-batch-coordinator/v1', executionMode: 'BYOK', revision: 0,
          scheduler: null, billing: { erpGenerationChargeCents: 0 }, slots: [], ingest: null,
        } };
      default: throw Object.assign(new Error('Unsupported fixture runtime message'), { code: 'FIXTURE_RUNTIME_UNEXPECTED' });
    }
  }
  const runtime = {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    onMessage: { addListener() {}, removeListener() {} },
    sendMessage(message, callback) {
      void dispatch(message).then((response) => {
        if (!response.ok) diagnostics.errors.push({ type: message.type, code: response.errorCode });
        callback(response);
      }, (error) => {
        diagnostics.errors.push({ type: message.type, code: error.code || error.name || 'Error' });
        callback({ ok: false, errorCode: error.code || 'FIXTURE_RUNTIME_FAILED' });
      });
    },
  };
  Object.assign(globalThis.chrome, { runtime, storage: { local, session, sync } });
  globalThis.__workbenchFixture = {
    async snapshot() {
      await ready;
      let edit = null;
      try { edit = controller.getSnapshot(owner); } catch (error) {
        if (error.code !== 'SS_ERP_BYOK_EDIT_OWNER_STALE') throw error;
      }
      const authoritative = await publicState();
      const resultIds = [...new Set([authoritative.result?.resultId,
        ...(edit?.alternatives || []).map((item) => item.candidateId)].filter(Boolean))];
      const results = resultIds.map((id) => {
        const value = vault.getPublic(id);
        let approvalGuard = null;
        try { vault.getApprovedForBackground(id); } catch (error) { approvalGuard = error.code; }
        return { resultId: id, operation: value.operation, reviewState: value.reviewState, approvalGuard };
      });
      const htmlAndInputs = document.documentElement.outerHTML + [...document.querySelectorAll('input,textarea')].map((node) => node.value).join('\n');
      return {
        ...clone(diagnostics), edit: clone(edit), results,
        authoritativeResult: authoritative.result ? {
          resultId: authoritative.result.resultId, reviewState: authoritative.result.reviewState,
          deliveryState: authoritative.result.deliveryState,
        } : null,
        ui: {
          bodyClass: document.body.className, flowStage: document.body.dataset.flowStage,
          resultPanelHidden: document.querySelector('#resultPanel')?.hidden,
          resultPanelDisplay: document.querySelector('#resultPanel') ? getComputedStyle(document.querySelector('#resultPanel')).display : null,
          previewDecoded: document.querySelector('#previewImage')?.naturalWidth > 0,
          approveDisabled: document.querySelector('#approveButton')?.disabled,
        },
        secretChecks: {
          sessionContainsSentinel: JSON.stringify(session.snapshot()).includes(sentinel),
          domContainsSentinel: htmlAndInputs.includes(sentinel),
          persistentContainsSentinel: JSON.stringify([localStorage, sessionStorage, local.snapshot(), sync.snapshot()]).includes(sentinel),
          publicStateContainsSentinel: JSON.stringify(authoritative).includes(sentinel),
        },
      };
    },
  };
}

function chromeExecutable(argv) {
  assert.ok(argv.length === 0 || argv.length === 2 && argv[0] === '--chrome', 'Only --chrome <executable> is supported');
  const candidates = argv.length ? [path.resolve(argv[1])] : [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  assert.ok(executable, 'An installed independent Chromium is required; pass --chrome. No browser or dependency is installed automatically.');
  return executable;
}

async function run() {
  const chrome = chromeExecutable(process.argv.slice(2));
  const artifacts = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-ai-browser-evidence-'));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-ai-browser-profile-'));
  const verifiedProfile = await realpath(profile);
  const png = pngFixture();
  const inputPath = path.join(artifacts, 'synthetic-source.png');
  await writeFile(inputPath, png);
  const summary = {
    contractVersion: 'ss-erp-ai-workbench-browser-acceptance/v1', ok: false,
    scope: 'Actual HTML/CSS/page scripts/shared clients/controllers/runtime handler/launch session/epoch in Chromium',
    fixtureBoundaries: ['Chrome message transport/tabs/storage', 'ERP launch/readiness/device authority',
      'ERP execution intent', 'ingest client rejects before network I/O', 'publish coordinator'],
    excluded: ['MV3 Chrome dispatch/transport authorization', 'real ERP ingest', 'real Provider', 'Ozon', 'deployment'],
    artifacts, browser: null, operations: [], reviewFlows: [], generationChecksPassed: false,
    reviewFlowComplete: false, screenshots: [], blockedUnexpectedRequests: [],
    providerFixtureRequests: 0, realProviderRequests: 0, productionMutations: 0,
    sourceHashes: {}, cleanup: { browserClosed: false, profileRemoved: false },
  };
  let proxyRejects = 0;
  const proxy = http.createServer((_request, response) => { proxyRejects += 1; response.writeHead(502); response.end(); });
  proxy.on('connect', (_request, socket) => { proxyRejects += 1; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  let child;
  let cdp;
  let pageSession;
  let failure;
  const routeErrors = [];
  const pageErrors = [];
  try {
    child = spawn(chrome, [
      '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--disable-extensions', '--disable-breakpad',
      `--proxy-server=http://127.0.0.1:${proxy.address().port}`, '--proxy-bypass-list=<-loopback>',
      '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    let launchError;
    child.once('error', (error) => { launchError = error; });
    const activePort = await until(async () => {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Chromium exited with ${child.exitCode}`);
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/u); } catch { return null; }
    }, 'independent Chromium startup');
    cdp = await Cdp.connect(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
    summary.browser = (await cdp.send('Browser.getVersion')).product;
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    pageSession = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    const send = (method, params) => cdp.send(method, params, pageSession);
    const evaluate = async (expression) => {
      const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (value.exceptionDetails) throw new Error(`Browser evaluation: ${value.exceptionDetails.text} ${value.exceptionDetails.exception?.description || ''}`);
      return value.result.value;
    };
    cdp.on('Runtime.exceptionThrown', (event, sessionId) => {
      if (sessionId === pageSession) pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text);
    });
    cdp.on('Fetch.requestPaused', (event, sessionId) => {
      if (sessionId !== pageSession) return;
      void (async () => {
        const url = new URL(event.request.url);
        let body;
        let contentType;
        let responseCode = 200;
        const headers = [];
        if (url.origin === PAGE_ORIGIN && !url.search && !url.hash) {
          const relative = decodeURIComponent(url.pathname).replace(/^\//u, '');
          const filename = path.resolve(EXTENSION_ROOT, relative);
          assert.ok(filename.startsWith(EXTENSION_ROOT + path.sep), 'Fixture resource escapes extension root');
          if (relative === 'favicon.ico') { body = Buffer.alloc(0); responseCode = 204; }
          else {
            assert.ok(/\.(?:html|js|css|svg|png)$/u.test(filename), 'Unexpected fixture resource type');
            body = await readFile(filename);
            summary.sourceHashes[relative] = createHash('sha256').update(body).digest('hex');
          }
          contentType = filename.endsWith('.html') ? 'text/html; charset=utf-8'
            : filename.endsWith('.js') ? 'text/javascript; charset=utf-8'
              : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
        } else if (url.origin === PROVIDER_ORIGIN && ['/v1/images/generations', '/v1/images/edits'].includes(url.pathname)
          && !url.search && !url.hash && ['POST', 'OPTIONS'].includes(event.request.method)) {
          headers.push({ name: 'Access-Control-Allow-Origin', value: PAGE_ORIGIN },
            { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
            { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type,idempotency-key' });
          contentType = 'application/json';
          if (event.request.method === 'OPTIONS') { body = Buffer.alloc(0); responseCode = 204; }
          else {
            summary.providerFixtureRequests += 1;
            body = Buffer.from(JSON.stringify({
              created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString('base64') }],
              background: 'opaque', output_format: 'png', quality: 'high', size: '1024x1024',
              usage: { input_tokens: 25, output_tokens: 50, total_tokens: 75,
                input_tokens_details: { image_tokens: 20, text_tokens: 5 } },
            }));
          }
        } else {
          summary.blockedUnexpectedRequests.push({ origin: url.origin, pathname: url.pathname, method: event.request.method });
          await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
          return;
        }
        await send('Fetch.fulfillRequest', {
          requestId: event.requestId, responseCode,
          responseHeaders: [...headers, { name: 'Content-Type', value: contentType }], body: body.toString('base64'),
        });
      })().catch(async (error) => {
        routeErrors.push(error.message);
        try { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); } catch {}
      });
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const fixtureSource = (await Promise.all(SHARED_FIXTURE_MODULES.map(async (relative) => {
      const source = await readFile(path.join(EXTENSION_ROOT, relative), 'utf8');
      summary.sourceHashes[relative] = createHash('sha256').update(source).digest('hex');
      return source;
    }))).join('\n;\n');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureSource + '\n;(' + fixtureBridge.toString() + ')(' + JSON.stringify({ providerOrigin: PROVIDER_ORIGIN, sentinel: SENTINEL }) + ');',
    });
    const visiblePoint = async (selector) => {
      return evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing element'); node.scrollIntoView({ block: 'center', behavior: 'instant' }); const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height) throw new Error('Element is hidden: ' + ${JSON.stringify(selector)}); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: !!node.disabled }; })()`);
    };
    const click = async (selector) => {
      const point = await visiblePoint(selector);
      assert.equal(point.disabled, false, `Disabled button: ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    };
    const keyboardActivate = async (selector, key = 'Enter') => {
      const point = await visiblePoint(selector);
      assert.equal(point.disabled, false, `Disabled keyboard target: ${selector}`);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`), true,
        `Keyboard focus: ${selector}`);
      const event = key === 'Enter' ? { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
        : { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 };
      const text = key === 'Enter' ? '\r' : ' ';
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...event, text, unmodifiedText: text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
    };
    const fill = async (selector, value) => {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await send('Input.insertText', { text: value });
    };
    const upload = async (selector) => {
      const documentNode = await send('DOM.getDocument');
      const selected = await send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector });
      await send('DOM.setFileInputFiles', { nodeId: selected.nodeId, files: [inputPath] });
    };
    const screenshot = async (label, selector) => {
      if (selector) await visiblePoint(selector);
      else await evaluate('window.scrollTo({ top: 0, behavior: "instant" })');
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const filename = path.join(artifacts, label + '.png');
      await writeFile(filename, Buffer.from(result.data, 'base64'));
      summary.screenshots.push(filename);
    };
    const snapshot = () => evaluate('window.__workbenchFixture.snapshot()');
    const reviewUi = () => evaluate(`(() => {
      const describe = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const bounds = node.getBoundingClientRect();
        return { visible: bounds.width > 0 && bounds.height > 0, disabled: !!node.disabled,
          text: node.textContent.trim().slice(0, 500) };
      };
      return { stage: document.body.dataset.flowStage,
        mainAction: describe('#mediaPrimaryAction'), resultPanel: describe('#resultPanel'),
        editResultPanel: describe('#editResultPanel'), approveButton: describe('#approveButton'),
        editActions: [...document.querySelectorAll('#editResultPanel button')].map((node) => ({
          text: node.textContent.trim(), disabled: node.disabled, visible: node.getBoundingClientRect().width > 0,
        })),
      };
    })()`);
    const reviewMobile = async (operation) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await pause(75);
      const width = await evaluate('({viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth})');
      assert.ok(width.document <= width.viewport && width.body <= width.viewport,
        `${operation} review horizontal overflow: ${JSON.stringify(width)}`);
      await screenshot(operation.toLowerCase() + '-review-mobile', '#resultPanel');
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
      return width;
    };
    for (const [operation, button] of [
      ['TEXT_TO_IMAGE', '#mediaOperationTextToImage'], ['IMAGE_TO_IMAGE', '#mediaOperationImageToImage'],
      ['FULL_EDIT', '#mediaOperationFullEdit'], ['INPAINT', '#mediaOperationInpaint'],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: PAGE_URL });
      await until(() => evaluate('document.body?.classList.contains("is-context-ready") && window.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER?.isByokExecutionAllowed()'), `${operation} ready`);
      await click(button);
      await fill('#promptInput', PROMPT);
      await click('.quick-prompt-options > summary');
      await fill('#negativePromptInput', NEGATIVE_PROMPT);
      if (operation === 'IMAGE_TO_IMAGE') {
        await upload('#referenceFiles');
        await until(() => evaluate('document.querySelectorAll("#referenceList li").length === 1'), 'reference upload');
      } else if (operation !== 'TEXT_TO_IMAGE') {
        await upload('#sourceFile');
        await until(() => evaluate('document.querySelector("#editSourceImage").naturalWidth === 256'), 'source upload and actual image decode');
      }
      let maskPixels = null;
      if (operation === 'INPAINT') {
        await visiblePoint('#editMaskCanvas');
        await evaluate('document.querySelector("#editMaskCanvas").focus()');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        maskPixels = await until(() => evaluate('Number(document.querySelector("#maskEditPixels").textContent.replace(/,/g, ""))'), 'keyboard mask drawing');
        assert.ok(maskPixels > 0 && maskPixels < 256 * 256, 'Mask must edit and preserve pixels');
      }
      await until(() => evaluate(`!document.querySelector(${JSON.stringify(operation === 'TEXT_TO_IMAGE' ? '#generateButton' : '#runEditButton')}).disabled`), 'generation prerequisites');
      await screenshot(operation.toLowerCase() + '-ready-desktop');
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await pause(100);
      const width = await evaluate('({viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth})');
      assert.ok(width.document <= width.viewport && width.body <= width.viewport, `${operation} horizontal overflow: ${JSON.stringify(width)}`);
      await screenshot(operation.toLowerCase() + '-ready-mobile');
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
      await click('#mediaPrimaryAction');
      await until(async () => (await snapshot()).results.length > 0, `${operation} candidate from shared Provider client`);
      await until(() => evaluate(operation === 'TEXT_TO_IMAGE'
        ? 'document.querySelector("#previewImage").naturalWidth === 256 && !document.querySelector("#approveButton").disabled'
        : 'document.querySelector("#editSelectedImage").naturalWidth === 256'), `${operation} decoded candidate preview`);
      const before = await snapshot();
      assert.equal(before.providerCalls.length, 1, 'One Provider fixture request per operation');
      const call = before.providerCalls[0];
      assert.ok(call.prompt.includes(PROMPT.normalize('NFKC')), `${operation} preserves Chinese multiline prompt`);
      assert.ok(call.prompt.includes(NEGATIVE_PROMPT.normalize('NFKC')), `${operation} preserves multiline negative prompt`);
      assert.equal(call.imageCount, operation === 'TEXT_TO_IMAGE' ? 0 : 1);
      assert.equal(call.hasMask, operation === 'INPAINT');
      assert.deepEqual(before.metadataIgnored, [operation], 'Official response metadata is accepted and discarded by the actual client');
      if (operation === 'INPAINT') {
        assert.equal(call.mask.width, 256);
        assert.equal(call.mask.height, 256);
        assert.equal(call.mask.checkedPixels, 256 * 256, 'Compare every original/exported and multipart pixel');
        assert.equal(call.mask.alphaMismatches, 0, 'Every multipart alpha equals 255 minus original mask red');
        assert.ok(call.mask.transparent > 0 && call.mask.opaque > 0, 'Both edited and preserved regions survive conversion');
        assert.ok(call.mask.softEdge > 0, 'The round brush fixture exercises fractional alpha at its edge');
        assert.equal(call.mask.transparent, call.mask.sourceWhite);
        assert.equal(call.mask.opaque, call.mask.sourceBlack);
        assert.equal(call.mask.softEdge, call.mask.sourceSoftEdge);
        assert.equal(call.mask.opaque + call.mask.transparent + call.mask.softEdge, 256 * 256);
      }
      assert.equal(before.results[0].reviewState, 'CANDIDATE_READY');
      assert.ok(before.results[0].approvalGuard, 'Actual vault rejects unapproved apply');
      assert.equal(before.ingestCalls, 0);
      assert.deepEqual(before.secretChecks, {
        sessionContainsSentinel: true, domContainsSentinel: false,
        persistentContainsSentinel: false, publicStateContainsSentinel: false,
      });
      if (operation === 'TEXT_TO_IMAGE') await click('#mediaPrimaryAction');
      await screenshot(operation.toLowerCase() + '-candidate-desktop', operation === 'TEXT_TO_IMAGE' ? '#resultPanel' : undefined);
      const reviewFlow = { operation, steps: [], outcome: null };
      if (operation === 'TEXT_TO_IMAGE') {
        reviewFlow.viewport390 = await reviewMobile(operation);
        assert.equal(await evaluate('document.querySelector("#approveButton").textContent'), '批准候选图');
        await keyboardActivate('#approveButton');
        const approved = await until(async () => { const current = await snapshot(); return current.results[0]?.reviewState === 'APPROVED' && current; }, 'explicit candidate approval');
        assert.equal(approved.ingestCalls, 0, 'Approval alone never ingests');
        assert.equal(approved.results[0].approvalGuard, null);
        assert.ok(approved.activations.some((activation) => activation.id === 'approveButton'
          && activation.trusted && activation.detail === 0), 'Enter causes a trusted approval activation');
        assert.equal(await evaluate('document.querySelector("#approveButton").textContent'), '接收并绑定 ERP');
        await screenshot('text_to_image-approved-desktop', '#resultPanel');
        reviewFlow.steps.push({ action: 'approve', activation: 'keyboard Enter', ui: await reviewUi(), reviewState: 'APPROVED',
          ingestCalls: approved.ingestCalls, trustedKeyboardClick: true });
        await click('#approveButton');
        await until(async () => (await snapshot()).errors.some((item) => item.code === 'FIXTURE_ERP_INGEST_DISABLED'), 'approved candidate reaches fixture-only ingest');
        const refused = await snapshot();
        assert.equal(refused.ingestCalls, 1);
        reviewFlow.steps.push({ action: 'ingest', ui: await reviewUi(), reviewState: refused.results[0].reviewState,
          ingestCalls: refused.ingestCalls, errorCode: 'FIXTURE_ERP_INGEST_DISABLED' });
        reviewFlow.outcome = 'APPROVED_INGEST_REACHED_FIXTURE_REJECTION';
      } else {
        // Observe actual user-facing reachability. Do not fabricate a main-page
        // candidate or dispatch a custom event to bridge a missing product path.
        reviewFlow.steps.push({ action: 'selected_candidate', ui: await reviewUi() });
        await keyboardActivate('#mediaPrimaryAction', 'Space');
        await until(async () => {
          const current = await snapshot();
          const ui = await reviewUi();
          return current.authoritativeResult?.resultId === before.results[0].resultId
            && ui.resultPanel?.visible && ui.approveButton?.visible && !ui.approveButton.disabled;
        }, `${operation} handed-off candidate appears in normal review with decoded preview`);
        const handedOff = await snapshot();
        assert.equal(handedOff.authoritativeResult.reviewState, 'CANDIDATE_READY');
        assert.equal(handedOff.authoritativeResult.deliveryState, 'NOT_INGESTED');
        assert.equal(handedOff.ingestCalls, 0, 'Handoff does not approve or ingest');
        const handoffIndex = handedOff.runtimeCalls.indexOf('ss-erp:ai-image-workbench-edit-review');
        assert.ok(handoffIndex >= 0 && handedOff.runtimeCalls.slice(handoffIndex + 1).includes('ss-erp:ai-image-workbench-state'),
          'The page refreshes authoritative public state after real runtime handoff');
        assert.ok(handedOff.activations.some((activation) => activation.id === 'mediaPrimaryAction'
          && activation.trusted && activation.detail === 0), 'Space causes a trusted edit review activation');
        reviewFlow.steps.push({ action: 'primary_action', activation: 'keyboard Space', trustedKeyboardClick: true,
          ui: await reviewUi(), authoritativeResult: handedOff.authoritativeResult });
        await click('[data-flow-step="review"]');
        const reviewState = await reviewUi();
        reviewFlow.steps.push({ action: 'fourth_step_review', ui: reviewState });
        if (reviewState.resultPanel?.visible) reviewFlow.viewport390 = await reviewMobile(operation);
        if (reviewState.resultPanel?.visible) {
          await screenshot(operation.toLowerCase() + '-fourth-step-review', '#resultPanel');
        } else if (reviewState.editResultPanel?.visible) {
          await screenshot(operation.toLowerCase() + '-fourth-step-review', '#editResultPanel');
        } else await screenshot(operation.toLowerCase() + '-fourth-step-review');
        if (reviewState.approveButton?.visible && !reviewState.approveButton.disabled) {
          await click('#approveButton');
          const reviewed = await until(async () => {
            const current = await snapshot();
            return current.results.some((result) => result.reviewState === 'APPROVED') && current;
          }, `${operation} explicit approval`);
          assert.equal(reviewed.ingestCalls, 0);
          reviewFlow.steps.push({ action: 'approve', ui: await reviewUi(), results: reviewed.results });
          if (reviewed.results.some((result) => result.reviewState === 'APPROVED')) {
            await click('#approveButton');
            await until(async () => (await snapshot()).errors.some((item) => item.code === 'FIXTURE_ERP_INGEST_DISABLED'),
              `${operation} approved candidate reaches fixture-only ingest`);
            const ingested = await snapshot();
            reviewFlow.outcome = ingested.ingestCalls > 0
              ? 'APPROVED_INGEST_REACHED_FIXTURE_REJECTION' : 'APPROVED_INGEST_NOT_REACHED';
          } else reviewFlow.outcome = 'APPROVAL_NOT_REACHED';
        } else reviewFlow.outcome = 'APPROVAL_ACTION_UNAVAILABLE';
        const finalState = await snapshot();
        reviewFlow.finalState = { results: finalState.results, ingestCalls: finalState.ingestCalls,
          runtimeCalls: finalState.runtimeCalls, runtimeErrors: finalState.errors };
      }
      summary.reviewFlows.push(reviewFlow);
      if (operation !== 'TEXT_TO_IMAGE') {
        await writeFile(path.join(artifacts, operation.toLowerCase() + '-review-flow.json'), JSON.stringify(reviewFlow, null, 2) + '\n');
      }
      summary.operations.push({ operation, candidatePreviewDecoded: true, multilinePrompt: true, viewport390: width,
        unapprovedApplyGuard: before.results[0].approvalGuard, secretChecks: before.secretChecks,
        maskUiEstimatedPixels: maskPixels, provider: call, runtimeErrors: before.errors, responseMetadataIgnored: true,
        reviewCoverage: 'Real runtime handler and session; explicit UI approval then fixture ingest rejection',
      });
    }
    assert.deepEqual(routeErrors, [], 'Fixture route failures');
    assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
    assert.deepEqual(summary.blockedUnexpectedRequests, [], 'Unexpected requests are blocked and fail acceptance');
    assert.equal(summary.providerFixtureRequests, 4);
    summary.generationChecksPassed = true;
    summary.reviewFlowComplete = summary.reviewFlows.every((flow) => flow.outcome === 'APPROVED_INGEST_REACHED_FIXTURE_REJECTION');
    summary.ok = summary.reviewFlowComplete;
    if (!summary.ok) summary.error = 'Generation checks passed; candidate approval/ingest path is incomplete. See reviewFlows.';
  } catch (error) {
    failure = error;
    summary.error = error.message;
    if (cdp && pageSession) {
      try {
        const result = await cdp.send('Runtime.evaluate', {
          expression: '(async () => ({ title: document.title, body: document.body?.innerText, fixture: window.__workbenchFixture ? await window.__workbenchFixture.snapshot() : null }))()',
          returnByValue: true, awaitPromise: true,
        }, pageSession);
        const state = result.result.value;
        const serialized = JSON.stringify(state, null, 2);
        assert.ok(!serialized.includes(SENTINEL), 'Do not write secret sentinel to artifacts');
        await writeFile(path.join(artifacts, 'failure-state.json'), serialized);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, pageSession);
        const filename = path.join(artifacts, 'failure.png');
        await writeFile(filename, Buffer.from(shot.data, 'base64'));
        summary.screenshots.push(filename);
      } catch (diagnosticError) { summary.diagnosticError = diagnosticError.message; }
    }
  } finally {
    summary.routeErrors = routeErrors;
    summary.pageErrors = pageErrors;
    summary.proxyRejectedConnections = proxyRejects;
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch {}
      cdp.socket.close();
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      try { await until(() => child.exitCode !== null || child.signalCode !== null, 'test Chromium exit', 3000); }
      catch { child.kill(); await pause(300); }
    }
    summary.cleanup.browserClosed = !child || child.exitCode !== null || child.signalCode !== null;
    await new Promise((resolve) => proxy.close(resolve));
    try {
      const resolved = await realpath(profile);
      assert.equal(resolved, verifiedProfile);
      assert.equal(path.dirname(resolved).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
      assert.ok(path.basename(resolved).startsWith('ss-erp-ai-browser-profile-'));
      await rm(resolved, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 });
      summary.cleanup.profileRemoved = true;
    } catch (error) { summary.cleanup.error = error.message; }
    if (!summary.cleanup.browserClosed || !summary.cleanup.profileRemoved) summary.ok = false;
    await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify({ ok: summary.ok, browser: summary.browser, operations: summary.operations.length,
      generationChecksPassed: summary.generationChecksPassed, reviewFlowComplete: summary.reviewFlowComplete,
      providerFixtureRequests: summary.providerFixtureRequests, realProviderRequests: 0,
      summary: path.join(artifacts, 'summary.json'), cleanup: summary.cleanup, ...(summary.error ? { error: summary.error } : {}),
    }, null, 2));
  }
  if (failure || !summary.ok) process.exitCode = 1;
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
