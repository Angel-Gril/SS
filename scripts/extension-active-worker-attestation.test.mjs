import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RECEIPT_KIND,
  RECEIPT_SCOPE,
  attestActiveWorkerOverCdp,
  canonicalExtensionActiveWorkerAttestationReceiptJson,
  fetchBrowserIdentity,
  loadExtensionIdentity,
  normalizeCdpOrigin,
  parseCliArgs,
  parseExtensionActiveWorkerAttestationReceipt,
  runCli,
  runExtensionActiveWorkerAttestation,
} from './extension-active-worker-attestation.mjs';

const EXTENSION_ID = 'nkkemglcckgmhmcfnjjmcfbdhciafahl';
const VERSION = '1.0.281';
const WORKER_PATH = 'background/service-worker.js';
const WORKER_URL = `chrome-extension://${EXTENSION_ID}/${WORKER_PATH}`;
const WORKER_SOURCE = "globalThis.SS_ERP_ACTIVE_WORKER = 'ready';\n";
const TARGET_ID = 'ABCDEF0123456789';
const SESSION_ID = 'SESSION_01';
const BROWSER_WS = 'ws://127.0.0.1:9444/devtools/browser/BROWSER_01';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureExtension(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ss-erp-active-worker-attestation-'));
  mkdirSync(path.join(root, 'background'));
  const manifest = {
    manifest_version: 3,
    version: VERSION,
    name: 'SS ERP fixture',
    background: { service_worker: WORKER_PATH },
    ...overrides.manifest,
  };
  writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(root, WORKER_PATH), overrides.workerSource ?? WORKER_SOURCE);
  return root;
}

function protocolInput(overrides = {}) {
  return {
    webSocketDebuggerUrl: BROWSER_WS,
    expectedWorkerUrl: WORKER_URL,
    expectedVersion: VERSION,
    timeoutMs: 1_000,
    ...overrides,
  };
}

function fakeBrowserWebSocket(options = {}) {
  const commands = [];
  const instances = [];
  class FakeWebSocket {
    constructor(url) {
      assert.equal(url, BROWSER_WS);
      this.closed = false;
      instances.push(this);
      queueMicrotask(() => this.onopen?.());
    }

    emit(message) {
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) }));
    }

    respond(command, result = {}) {
      this.emit({ id: command.id, result });
    }

    send(raw) {
      const command = JSON.parse(raw);
      commands.push(command);
      switch (command.method) {
        case 'Target.getTargets':
          this.respond(command, {
            targetInfos: [
              {
                targetId: TARGET_ID,
                type: 'service_worker',
                title: 'Service Worker',
                url: WORKER_URL,
              },
            ],
          });
          break;
        case 'Target.attachToTarget':
          this.respond(command, { sessionId: SESSION_ID });
          break;
        case 'Debugger.enable': {
          const parsed = {
            sessionId: SESSION_ID,
            method: 'Debugger.scriptParsed',
            params: { scriptId: 'SCRIPT_01', url: WORKER_URL },
          };
          if (options.parsedAfterEnable) setTimeout(() => this.emit(parsed), 0);
          else this.emit(parsed);
          if (options.duplicateScript) {
            this.emit({
              ...parsed,
              params: { scriptId: 'SCRIPT_02', url: WORKER_URL },
            });
          }
          if (options.paused) {
            this.emit({
              sessionId: SESSION_ID,
              method: 'Debugger.paused',
              params: { callFrames: [], reason: 'other' },
            });
          }
          this.respond(command, { debuggerId: 'DEBUGGER_01' });
          break;
        }
        case 'Runtime.evaluate':
          if (options.runtimeError) {
            this.emit({ id: command.id, error: { code: -32000, message: 'runtime unavailable' } });
          } else {
            this.respond(command, {
              result: { type: 'string', value: options.runtimeVersion || VERSION },
            });
          }
          break;
        case 'Debugger.getScriptSource':
          if (options.sourceError) {
            this.emit({ id: command.id, error: { code: -32000, message: 'source unavailable' } });
          } else {
            this.respond(command, { scriptSource: options.workerSource ?? WORKER_SOURCE });
          }
          break;
        case 'Debugger.disable':
          this.respond(command);
          break;
        case 'Target.detachFromTarget':
          this.respond(command);
          break;
        default:
          assert.fail(`unexpected CDP command ${command.method}`);
      }
    }

    close() {
      this.closed = true;
      queueMicrotask(() => this.onclose?.());
    }
  }
  return { WebSocketImpl: FakeWebSocket, commands, instances };
}

function successfulReceipt(root) {
  const identity = loadExtensionIdentity(root, VERSION);
  return runExtensionActiveWorkerAttestation(
    {
      cdpUrl: 'http://127.0.0.1:9444',
      extensionId: EXTENSION_ID,
      extensionDirectory: root,
      expectedVersion: VERSION,
      timeoutMs: 1_000,
    },
    {
      loadExtensionIdentity: () => identity,
      fetchBrowserIdentity: async () => ({
        chromeVersion: 'Chrome/147.0.7727.15',
        webSocketDebuggerUrl: BROWSER_WS,
      }),
      attestActiveWorker: async () => ({
        targetIdSha256: sha256(TARGET_ID),
        runtimeManifestVersion: VERSION,
        activeSha256: identity.worker.sha256,
        activeByteLength: identity.worker.byteLength,
        protocolCleanup: {
          targetAttached: true,
          debuggerEnabled: true,
          debuggerPausedObserved: false,
          debuggerDisabled: true,
          targetDetached: true,
        },
      }),
      now: () => new Date('2026-08-04T09:15:00.000Z'),
    },
  );
}

test('binds the exact extension worker file without exposing private identities', async (t) => {
  const root = fixtureExtension();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = await successfulReceipt(root);
  const serialized = canonicalExtensionActiveWorkerAttestationReceiptJson(receipt);

  assert.equal(receipt.kind, RECEIPT_KIND);
  assert.equal(receipt.scope, RECEIPT_SCOPE);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.expectedVersion, VERSION);
  assert.equal(receipt.manifest.version, VERSION);
  assert.equal(receipt.worker.runtimeManifestVersion, VERSION);
  assert.equal(receipt.worker.diskSha256, receipt.worker.activeSha256);
  assert.equal(receipt.worker.diskByteLength, receipt.worker.activeByteLength);
  assert.equal(receipt.protocolCleanup.debuggerDisabled, true);
  assert.equal(receipt.protocolCleanup.targetDetached, true);
  assert.equal(receipt.attestorCommandEffects.classification, 'READ_ONLY_CDP_COMMAND_SET');
  assert.equal(receipt.attestorCommandEffects.providerPostCommands, 0);
  assert.equal(receipt.scopeLimitations.signedPackageAttested, false);
  assert.equal(receipt.scopeLimitations.upgradeTransitionAttested, false);
  assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.doesNotMatch(serialized, new RegExp(TARGET_ID, 'u'));
  const normalizedRoot = path.resolve(root).replaceAll('\\', '/');
  assert.equal(
    receipt.extensionDirectoryPathSha256,
    sha256(process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot),
  );
});

test('rejects a stale active source after protocol cleanup', async (t) => {
  const root = fixtureExtension();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = loadExtensionIdentity(root, VERSION);
  const fake = fakeBrowserWebSocket({ workerSource: '// stale worker\n' });

  await assert.rejects(
    runExtensionActiveWorkerAttestation(
      {
        cdpUrl: 'http://127.0.0.1:9444',
        extensionId: EXTENSION_ID,
        extensionDirectory: root,
        expectedVersion: VERSION,
        timeoutMs: 1_000,
      },
      {
        loadExtensionIdentity: () => identity,
        fetchBrowserIdentity: async () => ({
          chromeVersion: 'Chrome/147.0.7727.15',
          webSocketDebuggerUrl: BROWSER_WS,
        }),
        WebSocketImpl: fake.WebSocketImpl,
      },
    ),
    /does not match the exact extension directory/u,
  );
  assert.deepEqual(
    fake.commands.slice(-2).map((command) => command.method),
    ['Debugger.disable', 'Target.detachFromTarget'],
  );
  assert.equal(fake.instances[0].closed, true);
});

test('always disables and detaches after a script-source protocol error', async () => {
  const fake = fakeBrowserWebSocket({ sourceError: true });
  await assert.rejects(
    attestActiveWorkerOverCdp(protocolInput(), {
      WebSocketImpl: fake.WebSocketImpl,
      timeoutMs: 1_000,
    }),
    /Debugger\.getScriptSource failed/u,
  );
  assert.deepEqual(
    fake.commands.slice(-2).map((command) => command.method),
    ['Debugger.disable', 'Target.detachFromTarget'],
  );
  assert.equal(fake.instances[0].closed, true);
});

test('always disables and detaches after a runtime manifest read error', async () => {
  const fake = fakeBrowserWebSocket({ runtimeError: true });
  await assert.rejects(
    attestActiveWorkerOverCdp(protocolInput(), {
      WebSocketImpl: fake.WebSocketImpl,
      timeoutMs: 1_000,
    }),
    /Runtime\.evaluate failed/u,
  );
  assert.deepEqual(
    fake.commands.slice(-2).map((command) => command.method),
    ['Debugger.disable', 'Target.detachFromTarget'],
  );
  assert.equal(fake.instances[0].closed, true);
});

test('fails on Debugger.paused but still disables and detaches', async () => {
  const fake = fakeBrowserWebSocket({ paused: true });
  await assert.rejects(
    attestActiveWorkerOverCdp(protocolInput(), {
      WebSocketImpl: fake.WebSocketImpl,
      timeoutMs: 1_000,
    }),
    /Debugger\.paused was observed/u,
  );
  assert.deepEqual(
    fake.commands.slice(-2).map((command) => command.method),
    ['Debugger.disable', 'Target.detachFromTarget'],
  );
  assert.equal(fake.instances[0].closed, true);
});

test('uses only the bounded read-only active-worker CDP command set', async () => {
  const fake = fakeBrowserWebSocket();
  const result = await attestActiveWorkerOverCdp(protocolInput(), {
    WebSocketImpl: fake.WebSocketImpl,
    timeoutMs: 1_000,
  });
  assert.equal(result.activeSha256, sha256(WORKER_SOURCE));
  assert.equal(result.activeByteLength, Buffer.byteLength(WORKER_SOURCE));
  assert.equal(result.targetIdSha256, sha256(TARGET_ID));
  assert.deepEqual(
    fake.commands.map((command) => command.method),
    [
      'Target.getTargets',
      'Target.attachToTarget',
      'Debugger.enable',
      'Runtime.evaluate',
      'Debugger.getScriptSource',
      'Debugger.disable',
      'Target.detachFromTarget',
    ],
  );
  const runtime = fake.commands.find((command) => command.method === 'Runtime.evaluate');
  assert.equal(runtime.params.expression, 'chrome.runtime.getManifest().version');
  assert.equal(runtime.params.userGesture, false);
  const attach = fake.commands.find((command) => command.method === 'Target.attachToTarget');
  assert.equal(attach.params.flatten, true);
  assert.equal(fake.instances[0].closed, true);
});

test('waits for bounded script discovery and rejects duplicate exact main-script identities', async () => {
  const delayed = fakeBrowserWebSocket({ parsedAfterEnable: true });
  const result = await attestActiveWorkerOverCdp(protocolInput(), {
    WebSocketImpl: delayed.WebSocketImpl,
    timeoutMs: 1_000,
  });
  assert.equal(result.activeSha256, sha256(WORKER_SOURCE));

  const duplicate = fakeBrowserWebSocket({ duplicateScript: true });
  await assert.rejects(
    attestActiveWorkerOverCdp(protocolInput(), {
      WebSocketImpl: duplicate.WebSocketImpl,
      timeoutMs: 1_000,
    }),
    /exactly one parsed active worker main script, found 2/u,
  );
  assert.deepEqual(
    duplicate.commands.slice(-2).map((command) => command.method),
    ['Debugger.disable', 'Target.detachFromTarget'],
  );
});

test('restricts CDP HTTP and browser WebSocket endpoints to the same loopback port', async () => {
  assert.equal(normalizeCdpOrigin('http://127.0.0.1:9444'), 'http://127.0.0.1:9444');
  assert.equal(normalizeCdpOrigin('http://localhost:9444'), 'http://localhost:9444');
  assert.throws(() => normalizeCdpOrigin('https://127.0.0.1:9444'), /loopback HTTP origin/u);
  assert.throws(() => normalizeCdpOrigin('http://192.0.2.10:9444'), /loopback HTTP origin/u);
  assert.throws(
    () => normalizeCdpOrigin('http://127.0.0.1:9444/?token=secret'),
    /loopback HTTP origin/u,
  );

  let request;
  const browser = await fetchBrowserIdentity('http://127.0.0.1:9444', {
    timeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        status: 200,
        text: async () =>
          JSON.stringify({ Browser: 'Chrome/147.0.7727.15', webSocketDebuggerUrl: BROWSER_WS }),
      };
    },
  });
  assert.equal(browser.webSocketDebuggerUrl, BROWSER_WS);
  assert.equal(request.url, 'http://127.0.0.1:9444/json/version');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.credentials, 'omit');

  for (const webSocketDebuggerUrl of [
    'wss://127.0.0.1:9444/devtools/browser/BROWSER_01',
    'ws://192.0.2.10:9444/devtools/browser/BROWSER_01',
    'ws://127.0.0.1:9555/devtools/browser/BROWSER_01',
    'ws://127.0.0.1:9444/devtools/browser/BROWSER_01?token=secret',
    'ws://127.0.0.1:9444/devtools/page/PAGE_01',
  ]) {
    await assert.rejects(
      fetchBrowserIdentity('http://127.0.0.1:9444', {
        timeoutMs: 1_000,
        fetchImpl: async () => ({
          status: 200,
          text: async () =>
            JSON.stringify({ Browser: 'Chrome/147.0.7727.15', webSocketDebuggerUrl }),
        }),
      }),
      /loopback WebSocket on the CDP port/u,
    );
  }
});

test('loads exact manifest and worker bytes and rejects path escape', (t) => {
  const root = fixtureExtension();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = loadExtensionIdentity(root, VERSION);
  const manifestBytes = readFileSync(path.join(root, 'manifest.json'));
  assert.equal(identity.manifest.fileSha256, sha256(manifestBytes));
  assert.equal(identity.manifest.fileByteLength, manifestBytes.length);
  assert.equal(identity.worker.sha256, sha256(WORKER_SOURCE));
  assert.equal(identity.worker.byteLength, Buffer.byteLength(WORKER_SOURCE));

  const escaped = fixtureExtension({
    manifest: { background: { service_worker: '../outside.js' } },
  });
  t.after(() => rmSync(escaped, { recursive: true, force: true }));
  assert.throws(() => loadExtensionIdentity(escaped, VERSION), /canonical relative path/u);

  for (const serviceWorker of ['%2e%2e/service-worker.js', 'C:service-worker.js']) {
    const ambiguous = fixtureExtension({
      manifest: { background: { service_worker: serviceWorker } },
    });
    t.after(() => rmSync(ambiguous, { recursive: true, force: true }));
    assert.throws(() => loadExtensionIdentity(ambiguous, VERSION), /canonical relative path/u);
  }
});

test('rejects a symlinked service worker when the platform permits creating one', (t) => {
  const root = fixtureExtension();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worker = path.join(root, WORKER_PATH);
  const outside = path.join(root, 'outside-worker.js');
  writeFileSync(outside, WORKER_SOURCE);
  rmSync(worker);
  try {
    symlinkSync(outside, worker, 'file');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('the platform does not permit an unprivileged file symlink');
      return;
    }
    throw error;
  }
  assert.throws(() => loadExtensionIdentity(root, VERSION), /must not contain symlinks/u);
});

test('rejects a symlinked extension root and non-three-component versions', (t) => {
  const root = fixtureExtension();
  const linkRoot = mkdtempSync(path.join(tmpdir(), 'ss-erp-active-worker-root-link-'));
  const link = path.join(linkRoot, 'extension-link');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(linkRoot, { recursive: true, force: true }));
  try {
    symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => loadExtensionIdentity(link, VERSION), /non-symlink directory/u);
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
  }
  assert.throws(() => loadExtensionIdentity(root, '1.0'), /expected version is invalid/u);
  assert.throws(() => loadExtensionIdentity(root, '1.0.281.0'), /expected version is invalid/u);
});

test('parses the exact schema and rejects stale bindings or claimed effects', async (t) => {
  const root = fixtureExtension();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = await successfulReceipt(root);
  assert.deepEqual(
    JSON.parse(canonicalExtensionActiveWorkerAttestationReceiptJson(receipt)),
    receipt,
  );
  assert.throws(
    () => parseExtensionActiveWorkerAttestationReceipt({ ...receipt, unexpected: true }),
    /fields are invalid/u,
  );
  assert.throws(
    () =>
      parseExtensionActiveWorkerAttestationReceipt({
        ...receipt,
        worker: { ...receipt.worker, activeSha256: 'f'.repeat(64) },
      }),
    /active worker byte binding/u,
  );
  assert.throws(
    () =>
      parseExtensionActiveWorkerAttestationReceipt({
        ...receipt,
        attestorCommandEffects: {
          ...receipt.attestorCommandEffects,
          runtimeReloadCommands: 1,
        },
      }),
    /must be zero/u,
  );
});

test('requires every explicit CLI binding including extension directory', () => {
  const parsed = parseCliArgs([
    '--cdp',
    'http://127.0.0.1:9444',
    '--extension-id',
    EXTENSION_ID,
    '--extension-dir',
    'extensions/ss-erp',
    '--expected-version',
    VERSION,
    '--output',
    'active-worker.json',
  ]);
  assert.equal(parsed.input.extensionDirectory, path.resolve('extensions/ss-erp'));
  assert.equal(parsed.input.expectedVersion, VERSION);
  assert.equal(parsed.output, path.resolve('active-worker.json'));
  assert.throws(
    () =>
      parseCliArgs([
        '--cdp',
        'http://127.0.0.1:9444',
        '--extension-id',
        EXTENSION_ID,
        '--expected-version',
        VERSION,
        '--output',
        'active-worker.json',
      ]),
    /--extension-dir is required/u,
  );
  assert.throws(
    () =>
      parseCliArgs([
        '--cdp',
        'http://127.0.0.1:9444',
        '--extension-id',
        EXTENSION_ID,
        '--extension-dir',
        'extensions/ss-erp',
        '--expected-version',
        VERSION,
        '--output',
        'active-worker.json',
        '--extension-dir',
        'other',
      ]),
    /arguments are invalid/u,
  );
});

test('CLI writes one durable exclusive 0600 artifact and refuses replacement', async (t) => {
  const root = fixtureExtension();
  const outputRoot = mkdtempSync(path.join(tmpdir(), 'ss-erp-active-worker-output-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(outputRoot, { recursive: true, force: true }));
  const receipt = await successfulReceipt(root);
  const output = path.join(outputRoot, 'receipt.json');
  const argv = [
    '--cdp',
    'http://127.0.0.1:9444',
    '--extension-id',
    EXTENSION_ID,
    '--extension-dir',
    root,
    '--expected-version',
    VERSION,
    '--output',
    output,
  ];
  const summary = await runCli(argv, { run: async () => receipt });
  assert.equal(summary.kind, RECEIPT_KIND);
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), receipt);
  if (process.platform !== 'win32') {
    const mode = (await import('node:fs')).statSync(output).mode & 0o777;
    assert.equal(mode, 0o600);
  }
  await assert.rejects(runCli(argv, { run: async () => receipt }), /EEXIST|exist/u);
});

test('rejects a runtime manifest version that differs from the explicit expected version', async (t) => {
  const root = fixtureExtension();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = loadExtensionIdentity(root, VERSION);
  await assert.rejects(
    runExtensionActiveWorkerAttestation(
      {
        cdpUrl: 'http://127.0.0.1:9444',
        extensionId: EXTENSION_ID,
        extensionDirectory: root,
        expectedVersion: VERSION,
        timeoutMs: 1_000,
      },
      {
        loadExtensionIdentity: () => identity,
        fetchBrowserIdentity: async () => ({
          chromeVersion: 'Chrome/147.0.7727.15',
          webSocketDebuggerUrl: BROWSER_WS,
        }),
        attestActiveWorker: async () => ({
          targetIdSha256: sha256(TARGET_ID),
          runtimeManifestVersion: '1.0.280',
          activeSha256: identity.worker.sha256,
          activeByteLength: identity.worker.byteLength,
          protocolCleanup: {
            targetAttached: true,
            debuggerEnabled: true,
            debuggerPausedObserved: false,
            debuggerDisabled: true,
            targetDetached: true,
          },
        }),
      },
    ),
    /runtime manifest version is 1\.0\.280/u,
  );
});
