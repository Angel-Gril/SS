import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {
  FIXTURE_SKU_KEY,
  FIXTURE_SLOT_KEY,
  HANDLER_CONTRACT_VERSION,
  PROBE_CONTRACT_VERSION,
  buildLiveServiceWorkerUnicodeProbeExpression,
  canonicalLiveServiceWorkerUnicodeSmokeReceiptJson,
  evaluateServiceWorker,
  listCdpTargets,
  parseCliArgs,
  runLiveServiceWorkerUnicodeSmoke,
  selectServiceWorkerTarget,
} from './extension-live-sw-unicode-smoke.mjs';

const EXTENSION_ID = 'nkkemglcckgmhmcfnjjmcfbdhciafahl';
const SERVICE_WORKER_URL = `chrome-extension://${EXTENSION_ID}/background/service-worker.js`;
const TARGET = Object.freeze({
  id: 'ABC123',
  type: 'service_worker',
  url: SERVICE_WORKER_URL,
  webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/ABC123',
});

function input(overrides = {}) {
  return {
    cdpUrl: 'http://127.0.0.1:9444',
    extensionId: EXTENSION_ID,
    expectedVersion: '1.0.278',
    timeoutMs: 1_000,
    ...overrides,
  };
}

async function liveHandlerObservation(version = '1.0.278') {
  const context = vm.createContext({
    chrome: { runtime: { getManifest: () => ({ version }) } },
  });
  vm.runInContext(
    readFileSync('extensions/ss-erp/shared/byok/workbench-batch-runtime-handler.js', 'utf8'),
    context,
  );
  return vm.runInContext(buildLiveServiceWorkerUnicodeProbeExpression(), context);
}

test('probes a clean install or replacement alike and emits only live SW Unicode evidence', async () => {
  const observation = await liveHandlerObservation();
  let evaluatedTarget = null;
  let evaluatedExpression = '';
  const receipt = await runLiveServiceWorkerUnicodeSmoke(input(), {
    listTargets: async () => [TARGET],
    evaluate: async (target, expression) => {
      evaluatedTarget = target;
      evaluatedExpression = expression;
      return observation;
    },
    now: () => new Date('2026-08-03T08:00:00.000Z'),
  });

  assert.deepEqual(evaluatedTarget, TARGET);
  assert.match(evaluatedExpression, /SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER/u);
  assert.match(evaluatedExpression, /createDispatcher/u);
  assert.match(
    evaluatedExpression,
    new RegExp(FIXTURE_SKU_KEY.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  );
  assert.doesNotMatch(
    evaluatedExpression,
    /\bfetch\s*\(|XMLHttpRequest|chrome\.storage|EXECUTE_PROVIDER/iu,
  );
  assert.equal(receipt.liveServiceWorkerManifestVersion, '1.0.278');
  assert.equal(receipt.expectedVersion, receipt.liveServiceWorkerManifestVersion);
  assert.equal(receipt.kind, 'SS_ERP_LIVE_SERVICE_WORKER_UNICODE_SMOKE_RECEIPT');
  assert.equal(Object.hasOwn(receipt, 'fromVersion'), false);
  assert.equal(receipt.handlerContractVersion, HANDLER_CONTRACT_VERSION);
  assert.equal(receipt.unicodeBatchSlotProbe.accepted, true);
  assert.equal(receipt.unicodeBatchSlotProbe.registryStartCalls, 1);
  assert.equal(
    receipt.unicodeBatchSlotProbe.echoedSlotKeySha256,
    receipt.unicodeBatchSlotProbe.fixtureSlotKeySha256,
  );
  assert.doesNotThrow(() => JSON.parse(canonicalLiveServiceWorkerUnicodeSmokeReceiptJson(receipt)));
});

test('fails closed for an old live handler that rejects the Unicode slot', async () => {
  const stale = await liveHandlerObservation();
  stale.registryStartCalls = 0;
  stale.response = {
    ok: false,
    errorCode: 'SS_ERP_BYOK_BATCH_RUNTIME_INPUT_INVALID',
    error: 'BYOK batch workbench operation failed',
    outcome: 'FAILED_FINAL',
    automaticRetryAllowed: false,
  };
  await assert.rejects(
    runLiveServiceWorkerUnicodeSmoke(input(), {
      listTargets: async () => [TARGET],
      evaluate: async () => stale,
    }),
    /did not reach the isolated registry exactly once/u,
  );
});

test('fails closed when the expected installed manifest is not the live SW manifest', async () => {
  const stale = await liveHandlerObservation('1.0.277');
  await assert.rejects(
    runLiveServiceWorkerUnicodeSmoke(input(), {
      listTargets: async () => [TARGET],
      evaluate: async () => stale,
    }),
    /live service worker manifest is 1\.0\.277/u,
  );
});

test('requires one exact extension service worker target', () => {
  assert.deepEqual(selectServiceWorkerTarget([TARGET], EXTENSION_ID), TARGET);
  assert.throws(() => selectServiceWorkerTarget([], EXTENSION_ID), /exactly one/u);
  assert.throws(() => selectServiceWorkerTarget([TARGET, TARGET], EXTENSION_ID), /found 2/u);
  assert.throws(
    () =>
      selectServiceWorkerTarget(
        [
          {
            ...TARGET,
            webSocketDebuggerUrl: 'ws://192.0.2.10/devtools/page/ABC123',
          },
        ],
        EXTENSION_ID,
      ),
    /loopback WebSocket/u,
  );
  assert.throws(
    () =>
      selectServiceWorkerTarget(
        [
          {
            ...TARGET,
            webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/page/ABC123?token=secret',
          },
        ],
        EXTENSION_ID,
      ),
    /loopback WebSocket/u,
  );
});

test('lists CDP targets through a bounded loopback-only GET', async () => {
  let request = null;
  const targets = await listCdpTargets('http://localhost:9444', {
    timeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { status: 200, text: async () => JSON.stringify([TARGET]) };
    },
  });
  assert.deepEqual(targets, [TARGET]);
  assert.equal(request.url, 'http://localhost:9444/json/list');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.redirect, 'error');
  await assert.rejects(
    listCdpTargets('http://192.0.2.10:9444', { fetchImpl: async () => assert.fail() }),
    /loopback HTTP origin/u,
  );
  await assert.rejects(
    listCdpTargets('http://127.0.0.1:9444/?token=secret', {
      fetchImpl: async () => assert.fail(),
    }),
    /loopback HTTP origin/u,
  );
});

test('evaluates only the requested expression on the selected SW debugger target', async () => {
  let command = null;
  class FakeWebSocket {
    constructor(url) {
      assert.equal(url, TARGET.webSocketDebuggerUrl);
      queueMicrotask(() => this.onopen());
    }

    send(raw) {
      command = JSON.parse(raw);
      queueMicrotask(() =>
        this.onmessage({
          data: JSON.stringify({
            id: 1,
            result: { result: { type: 'object', value: { accepted: true } } },
          }),
        }),
      );
    }

    close() {}
  }
  const value = await evaluateServiceWorker(TARGET, 'globalThis.probe()', {
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 1_000,
  });
  assert.deepEqual(value, { accepted: true });
  assert.deepEqual(command, {
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: 'globalThis.probe()',
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    },
  });
});

test('parses an explicit operator invocation and rejects ambiguous arguments', () => {
  const parsed = parseCliArgs([
    '--cdp',
    'http://127.0.0.1:9444',
    '--extension-id',
    EXTENSION_ID,
    '--expected-version',
    '1.0.278',
    '--output',
    'receipt.json',
  ]);
  assert.equal(parsed.input.expectedVersion, '1.0.278');
  assert.equal(Object.hasOwn(parsed.input, 'fromVersion'), false);
  assert.equal(parsed.output.endsWith('receipt.json'), true);
  assert.throws(() => parseCliArgs(['--cdp', 'http://127.0.0.1:9444']), /required/u);
  assert.throws(
    () => parseCliArgs(['--cdp', 'http://127.0.0.1:9444', '--cdp', 'http://localhost:9444']),
    /arguments are invalid/u,
  );
  assert.throws(
    () =>
      parseCliArgs([
        '--cdp',
        'http://127.0.0.1:9444',
        '--extension-id',
        EXTENSION_ID,
        '--from-version',
        '1.0.277',
        '--expected-version',
        '1.0.278',
        '--output',
        'receipt.json',
      ]),
    /arguments are invalid/u,
  );
});

test('the fixed probe fixture remains canonical and exercises non-ASCII slot parsing', () => {
  assert.equal(FIXTURE_SKU_KEY, FIXTURE_SKU_KEY.normalize('NFKC').trim());
  assert.equal(FIXTURE_SLOT_KEY, `sku:${FIXTURE_SKU_KEY}:hero`);
  assert.equal(
    [...FIXTURE_SLOT_KEY].some((character) => character.codePointAt(0) > 127),
    true,
  );
  assert.equal(PROBE_CONTRACT_VERSION, 'ss-erp-live-service-worker-unicode-slot-probe/v1');
});
