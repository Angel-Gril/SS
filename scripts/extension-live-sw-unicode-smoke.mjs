#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';

export const RECEIPT_KIND = 'SS_ERP_LIVE_SERVICE_WORKER_UNICODE_SMOKE_RECEIPT';
export const PROBE_CONTRACT_VERSION = 'ss-erp-live-service-worker-unicode-slot-probe/v1';
export const HANDLER_CONTRACT_VERSION = 'extension-byok-workbench-batch-runtime-handler/v1';
export const FIXTURE_SKU_KEY = 'sku:live-sw-smoke|晚霞肤>M';
export const FIXTURE_SLOT_KEY = `sku:${FIXTURE_SKU_KEY}:hero`;

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_CDP_RESPONSE_BYTES = 1_000_000;

function fail(message) {
  throw new Error(`Live service worker Unicode smoke failed: ${message}`);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactObject(value, keys, label) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function canonicalString(value, label, pattern, maximum = 500) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.normalize('NFKC').trim() ||
    (pattern && !pattern.test(value))
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function version(value, label) {
  return canonicalString(value, label, VERSION_PATTERN, 50);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function loopbackHostname(value) {
  return value === '127.0.0.1' || value === 'localhost' || value === '[::1]';
}

function cdpHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('CDP URL is invalid');
  }
  if (
    parsed.protocol !== 'http:' ||
    !loopbackHostname(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    fail('CDP URL must be a credential-free loopback HTTP origin');
  }
  return parsed.origin;
}

function cdpWebSocketUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('service worker debugger URL is invalid');
  }
  if (
    parsed.protocol !== 'ws:' ||
    !loopbackHostname(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    fail('service worker debugger URL must use a credential-free loopback WebSocket');
  }
  return parsed.href;
}

function extensionId(value) {
  return canonicalString(value, 'extension ID', EXTENSION_ID_PATTERN, 32);
}

function timeout(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 100 || number > 30_000) {
    fail('timeout must be an integer from 100 to 30000 milliseconds');
  }
  return number;
}

function normalizeInput(input) {
  return Object.freeze({
    cdpUrl: cdpHttpUrl(input.cdpUrl),
    extensionId: extensionId(input.extensionId),
    expectedVersion: version(input.expectedVersion, 'expected version'),
    timeoutMs: timeout(input.timeoutMs ?? 10_000),
  });
}

function serviceWorkerUrl(id) {
  return `chrome-extension://${id}/background/service-worker.js`;
}

function targetId(value) {
  return canonicalString(value, 'service worker target ID', /^[a-zA-Z0-9_-]+$/u, 200);
}

function normalizeTarget(value, expectedUrl) {
  if (!isRecord(value) || value.type !== 'service_worker' || value.url !== expectedUrl) {
    fail('service worker target is invalid');
  }
  return Object.freeze({
    id: targetId(value.id),
    type: 'service_worker',
    url: expectedUrl,
    webSocketDebuggerUrl: cdpWebSocketUrl(value.webSocketDebuggerUrl),
  });
}

export async function listCdpTargets(cdpUrl, options = {}) {
  const origin = cdpHttpUrl(cdpUrl);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('fetch is unavailable');
  const response = await fetchImpl(`${origin}/json/list`, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(timeout(options.timeoutMs ?? 10_000)),
  });
  if (!response || response.status !== 200) fail('CDP target list request failed');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_CDP_RESPONSE_BYTES) {
    fail('CDP target list response is too large');
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail('CDP target list response is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 1_000) fail('CDP target list is invalid');
  return parsed;
}

export function selectServiceWorkerTarget(targets, id) {
  if (!Array.isArray(targets)) fail('CDP targets are invalid');
  const expectedUrl = serviceWorkerUrl(extensionId(id));
  const matches = targets.filter(
    (target) => isRecord(target) && target.type === 'service_worker' && target.url === expectedUrl,
  );
  if (matches.length !== 1) {
    fail(`expected exactly one live service worker target, found ${matches.length}`);
  }
  return normalizeTarget(matches[0], expectedUrl);
}

export function buildLiveServiceWorkerUnicodeProbeExpression() {
  const skuKey = JSON.stringify(FIXTURE_SKU_KEY);
  const slotKey = JSON.stringify(FIXTURE_SLOT_KEY);
  const probeVersion = JSON.stringify(PROBE_CONTRACT_VERSION);
  return `(async function liveServiceWorkerUnicodeSlotProbe() {
    'use strict';
    var api = globalThis.SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER;
    if (!api || typeof api.createDispatcher !== 'function') {
      throw new Error('SS_ERP_LIVE_SW_UNICODE_SMOKE_HANDLER_UNAVAILABLE');
    }
    var messageTypes = {};
    api.MESSAGE_TYPE_NAMES.forEach(function (name, index) {
      messageTypes[name] = 'ss-erp:live-sw-unicode-smoke:' + index;
    });
    var registryStartCalls = 0;
    var unavailable = async function () {
      throw new Error('SS_ERP_LIVE_SW_UNICODE_SMOKE_UNEXPECTED_REGISTRY_CALL');
    };
    var registry = {
      state: unavailable,
      start: async function (_owner, startRequest) {
        registryStartCalls += 1;
        return {
          probeContractVersion: ${probeVersion},
          accepted: true,
          slotKey: startRequest.slots[0].slotKey,
        };
      },
      command: unavailable,
      openPreview: unavailable,
      ingest: unavailable,
      recover: unavailable,
      clear: unavailable,
    };
    var dispatcher = api.createDispatcher({
      messageTypes: messageTypes,
      registry: registry,
    });
    var response = await dispatcher.dispatchAuthorized(messageTypes.BATCH_START, {
      sender: { tabId: 0, documentId: 'live-sw-unicode-smoke' },
      payload: {
        contractVersion: api.REQUEST_VERSION,
        startRequest: {
          contractVersion: 'extension-byok-workbench-batch-user-start/v1',
          profileId: 'live-sw-smoke-profile',
          requestedConcurrency: 1,
          slots: [{
            skuKey: ${skuKey},
            slotKey: ${slotKey},
            operation: 'TEXT_TO_IMAGE',
            providerIdempotencyKey: 'live-sw-smoke-provider-0001',
            intentHash: '${'a'.repeat(64)}',
            prompt: 'Live service worker Unicode slot smoke.',
            negativePrompt: null,
            size: '1024x1024',
          }],
        },
      },
    });
    return {
      manifestVersion: chrome.runtime.getManifest().version,
      handlerContractVersion: api.CONTRACT_VERSION,
      registryStartCalls: registryStartCalls,
      response: response,
    };
  }())`;
}

export async function evaluateServiceWorker(target, expression, options = {}) {
  const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
  if (typeof WebSocketImpl !== 'function') fail('WebSocket is unavailable');
  const timeoutMs = timeout(options.timeoutMs ?? 10_000);
  const debuggerUrl = cdpWebSocketUrl(target.webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const timer = setTimeout(() => finish(new Error('CDP Runtime.evaluate timed out')), timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Preserve the original protocol result.
      }
      if (error) reject(error);
      else resolve(value);
    }

    try {
      socket = new WebSocketImpl(debuggerUrl);
    } catch (error) {
      finish(error);
      return;
    }
    socket.onopen = () => {
      try {
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression,
              awaitPromise: true,
              returnByValue: true,
              userGesture: false,
            },
          }),
        );
      } catch (error) {
        finish(error);
      }
    };
    socket.onerror = () => finish(new Error('service worker CDP WebSocket failed'));
    socket.onclose = () => finish(new Error('service worker CDP WebSocket closed early'));
    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data || '');
      if (Buffer.byteLength(raw, 'utf8') > MAX_CDP_RESPONSE_BYTES) {
        finish(new Error('CDP Runtime.evaluate response is too large'));
        return;
      }
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        finish(new Error('CDP Runtime.evaluate response is not JSON'));
        return;
      }
      if (message.id !== 1) return;
      if (message.error || message.result?.exceptionDetails) {
        finish(new Error('service worker probe raised a CDP exception'));
        return;
      }
      const remoteObject = message.result?.result;
      if (!remoteObject || !Object.prototype.hasOwnProperty.call(remoteObject, 'value')) {
        finish(new Error('service worker probe returned no value'));
        return;
      }
      finish(null, remoteObject.value);
    };
  });
}

function verifyObservation(value, expectedVersion) {
  const observed = exactObject(
    value,
    ['manifestVersion', 'handlerContractVersion', 'registryStartCalls', 'response'],
    'service worker observation',
  );
  if (observed.manifestVersion !== expectedVersion) {
    fail(
      `live service worker manifest is ${observed.manifestVersion}, expected ${expectedVersion}`,
    );
  }
  if (observed.handlerContractVersion !== HANDLER_CONTRACT_VERSION) {
    fail('live service worker batch runtime handler contract is stale');
  }
  if (observed.registryStartCalls !== 1) {
    fail('Unicode slot did not reach the isolated registry exactly once');
  }
  const response = exactObject(observed.response, ['ok', 'data'], 'Unicode slot probe response');
  if (response.ok !== true) fail('live service worker rejected the Unicode batch slot');
  const data = exactObject(
    response.data,
    ['probeContractVersion', 'accepted', 'slotKey'],
    'Unicode slot probe data',
  );
  if (
    data.probeContractVersion !== PROBE_CONTRACT_VERSION ||
    data.accepted !== true ||
    data.slotKey !== FIXTURE_SLOT_KEY
  ) {
    fail('live service worker did not return the exact Unicode batch slot evidence');
  }
  return observed;
}

function isoTimestamp(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('observedAt is invalid');
  }
  return value;
}

export function parseLiveServiceWorkerUnicodeSmokeReceipt(value) {
  const receipt = exactObject(
    value,
    [
      'schemaVersion',
      'kind',
      'observedAt',
      'extensionId',
      'expectedVersion',
      'serviceWorkerUrl',
      'serviceWorkerTargetId',
      'liveServiceWorkerManifestVersion',
      'handlerContractVersion',
      'unicodeBatchSlotProbe',
    ],
    'receipt',
  );
  if (receipt.schemaVersion !== 1 || receipt.kind !== RECEIPT_KIND)
    fail('receipt identity is invalid');
  const expected = version(receipt.expectedVersion, 'receipt expected version');
  if (
    receipt.liveServiceWorkerManifestVersion !== expected ||
    receipt.serviceWorkerUrl !== serviceWorkerUrl(extensionId(receipt.extensionId)) ||
    receipt.handlerContractVersion !== HANDLER_CONTRACT_VERSION
  ) {
    fail('receipt live service worker binding is invalid');
  }
  targetId(receipt.serviceWorkerTargetId);
  isoTimestamp(receipt.observedAt);
  const probe = exactObject(
    receipt.unicodeBatchSlotProbe,
    [
      'contractVersion',
      'accepted',
      'registryStartCalls',
      'fixtureSkuKeySha256',
      'fixtureSlotKeySha256',
      'echoedSlotKeySha256',
    ],
    'receipt Unicode slot probe',
  );
  if (
    probe.contractVersion !== PROBE_CONTRACT_VERSION ||
    probe.accepted !== true ||
    probe.registryStartCalls !== 1 ||
    !DIGEST_PATTERN.test(probe.fixtureSkuKeySha256) ||
    probe.fixtureSkuKeySha256 !== sha256(FIXTURE_SKU_KEY) ||
    probe.fixtureSlotKeySha256 !== sha256(FIXTURE_SLOT_KEY) ||
    probe.echoedSlotKeySha256 !== probe.fixtureSlotKeySha256
  ) {
    fail('receipt Unicode slot evidence is invalid');
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: RECEIPT_KIND,
    observedAt: receipt.observedAt,
    extensionId: receipt.extensionId,
    expectedVersion: expected,
    serviceWorkerUrl: receipt.serviceWorkerUrl,
    serviceWorkerTargetId: receipt.serviceWorkerTargetId,
    liveServiceWorkerManifestVersion: receipt.liveServiceWorkerManifestVersion,
    handlerContractVersion: HANDLER_CONTRACT_VERSION,
    unicodeBatchSlotProbe: Object.freeze({
      contractVersion: PROBE_CONTRACT_VERSION,
      accepted: true,
      registryStartCalls: 1,
      fixtureSkuKeySha256: probe.fixtureSkuKeySha256,
      fixtureSlotKeySha256: probe.fixtureSlotKeySha256,
      echoedSlotKeySha256: probe.echoedSlotKeySha256,
    }),
  });
}

export function canonicalLiveServiceWorkerUnicodeSmokeReceiptJson(value) {
  return `${JSON.stringify(parseLiveServiceWorkerUnicodeSmokeReceipt(value), null, 2)}\n`;
}

export async function runLiveServiceWorkerUnicodeSmoke(input, dependencies = {}) {
  const normalized = normalizeInput(input);
  const targets = dependencies.listTargets
    ? await dependencies.listTargets(normalized)
    : await listCdpTargets(normalized.cdpUrl, {
        fetchImpl: dependencies.fetchImpl,
        timeoutMs: normalized.timeoutMs,
      });
  const target = selectServiceWorkerTarget(targets, normalized.extensionId);
  const expression = buildLiveServiceWorkerUnicodeProbeExpression();
  const observation = dependencies.evaluate
    ? await dependencies.evaluate(target, expression, normalized)
    : await evaluateServiceWorker(target, expression, {
        WebSocketImpl: dependencies.WebSocketImpl,
        timeoutMs: normalized.timeoutMs,
      });
  verifyObservation(observation, normalized.expectedVersion);
  const now = dependencies.now ? dependencies.now() : new Date();
  const observedAt = now instanceof Date ? now.toISOString() : String(now);
  return parseLiveServiceWorkerUnicodeSmokeReceipt({
    schemaVersion: 1,
    kind: RECEIPT_KIND,
    observedAt,
    extensionId: normalized.extensionId,
    expectedVersion: normalized.expectedVersion,
    serviceWorkerUrl: target.url,
    serviceWorkerTargetId: target.id,
    liveServiceWorkerManifestVersion: observation.manifestVersion,
    handlerContractVersion: observation.handlerContractVersion,
    unicodeBatchSlotProbe: {
      contractVersion: PROBE_CONTRACT_VERSION,
      accepted: true,
      registryStartCalls: observation.registryStartCalls,
      fixtureSkuKeySha256: sha256(FIXTURE_SKU_KEY),
      fixtureSlotKeySha256: sha256(FIXTURE_SLOT_KEY),
      echoedSlotKeySha256: sha256(observation.response.data.slotKey),
    },
  });
}

export function parseCliArgs(argv) {
  const allowed = new Set([
    '--cdp',
    '--extension-id',
    '--expected-version',
    '--output',
    '--timeout-ms',
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !allowed.has(name) ||
      values.has(name) ||
      typeof value !== 'string' ||
      value.startsWith('--')
    ) {
      fail('arguments are invalid');
    }
    values.set(name, value);
  }
  for (const required of ['--cdp', '--extension-id', '--expected-version', '--output']) {
    if (!values.has(required)) fail(`${required} is required`);
  }
  const output = path.resolve(values.get('--output'));
  if (path.extname(output).toLowerCase() !== '.json') fail('output must be a JSON file');
  return {
    input: {
      cdpUrl: values.get('--cdp'),
      extensionId: values.get('--extension-id'),
      expectedVersion: values.get('--expected-version'),
      timeoutMs: values.has('--timeout-ms') ? values.get('--timeout-ms') : 10_000,
    },
    output,
  };
}

async function main() {
  const { input, output } = parseCliArgs(process.argv.slice(2));
  if (!existsSync(path.dirname(output))) fail('output directory does not exist');
  const receipt = await runLiveServiceWorkerUnicodeSmoke(input);
  const bytes = Buffer.from(canonicalLiveServiceWorkerUnicodeSmokeReceiptJson(receipt), 'utf8');
  writeNewArtifactDurably(output, bytes, { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        ok: true,
        output,
        receiptSha256: sha256(bytes),
        extensionId: receipt.extensionId,
        liveServiceWorkerManifestVersion: receipt.liveServiceWorkerManifestVersion,
        unicodeBatchSlotAccepted: receipt.unicodeBatchSlotProbe.accepted,
      },
      null,
      2,
    ),
  );
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
