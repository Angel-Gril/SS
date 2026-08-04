import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';

export const RECEIPT_KIND = 'SS_ERP_ACTIVE_WORKER_ATTESTATION_RECEIPT';
export const RECEIPT_SCOPE = 'MAIN_SCRIPT_IDENTITY_ONLY';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_WORKER_BYTES = 16 * 1024 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 256 * 1024;
const MAX_CDP_MESSAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactObject(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${field} fields are invalid`);
  }
  return value;
}

function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail(`${field} must be a SHA-256 digest`);
  }
  return value;
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(`${field} must be a positive integer`);
  }
  return value;
}

function zero(value, field) {
  if (value !== 0) fail(`${field} must be zero`);
  return 0;
}

function extensionId(value) {
  if (typeof value !== 'string' || !EXTENSION_ID_PATTERN.test(value)) {
    fail('extension ID is invalid');
  }
  return value;
}

function extensionVersion(value, field = 'extension version') {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    fail(`${field} is invalid`);
  }
  return value;
}

function timestamp(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('observedAt is invalid');
  }
  return value;
}

function timeout(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 60_000) {
    fail('timeout must be an integer from 100 through 60000 milliseconds');
  }
  return parsed;
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
}

export function normalizeCdpOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('CDP URL must be a credential-free loopback HTTP origin');
  }
  if (
    parsed.protocol !== 'http:' ||
    !isLoopbackHostname(parsed.hostname) ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    fail('CDP URL must be a credential-free loopback HTTP origin');
  }
  return parsed.origin;
}

function normalizeBrowserWebSocket(value, cdpOrigin) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('browser debugger URL must be a credential-free loopback WebSocket');
  }
  const cdp = new URL(cdpOrigin);
  if (
    parsed.protocol !== 'ws:' ||
    !isLoopbackHostname(parsed.hostname) ||
    parsed.port !== cdp.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !/^\/devtools\/browser\/[A-Za-z0-9_-]{1,256}$/u.test(parsed.pathname)
  ) {
    fail('browser debugger URL must be a credential-free loopback WebSocket on the CDP port');
  }
  return parsed.href;
}

function normalizedPathDigestInput(value) {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function readStableRegularFile(value, field, maximumBytes) {
  const beforePath = lstatSync(value, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) {
    fail(`${field} must be a regular non-symlink file`);
  }
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const descriptor = openSync(value, constants.O_RDONLY | noFollow);
  try {
    const beforeRead = fstatSync(descriptor, { bigint: true });
    if (!beforeRead.isFile() || !sameFileSnapshot(beforePath, beforeRead)) {
      fail(`${field} changed before its stable snapshot was opened`);
    }
    const size = Number(beforeRead.size);
    positiveInteger(size, `${field} byte length`, maximumBytes);
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(value, { bigint: true });
    if (
      bytes.length !== size ||
      !sameFileSnapshot(beforeRead, afterRead) ||
      afterPath.isSymbolicLink() ||
      !sameFileSnapshot(beforeRead, afterPath)
    ) {
      fail(`${field} changed while its stable snapshot was read`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function safeWorkerRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) {
    fail('manifest background.service_worker is invalid');
  }
  if (
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes('?') ||
    value.includes('#') ||
    value.startsWith('/') ||
    path.posix.normalize(value) !== value
  ) {
    fail('manifest background.service_worker must be a canonical relative path');
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment) =>
        !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/u.test(segment),
    )
  ) {
    fail('manifest background.service_worker must be a canonical relative path');
  }
  return value;
}

function resolveWorkerFile(root, relativePath) {
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) fail('manifest service worker path must not contain symlinks');
  }
  const relative = path.relative(root, current);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('manifest service worker resolves outside the extension directory');
  }
  const actual = realpathSync.native(current);
  const actualRelative = path.relative(root, actual);
  if (!actualRelative || actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) {
    fail('manifest service worker resolves outside the extension directory');
  }
  return actual;
}

export function loadExtensionIdentity(extensionDirectory, expectedVersionValue) {
  if (typeof extensionDirectory !== 'string' || extensionDirectory.trim() !== extensionDirectory) {
    fail('extension directory is required');
  }
  const requestedRoot = path.resolve(extensionDirectory);
  const requestedEntry = lstatSync(requestedRoot);
  if (requestedEntry.isSymbolicLink() || !requestedEntry.isDirectory()) {
    fail('extension directory must be a non-symlink directory');
  }
  const root = realpathSync.native(requestedRoot);
  const expectedVersion = extensionVersion(expectedVersionValue, 'expected version');
  const manifestPath = path.join(root, 'manifest.json');
  const manifestBytes = readStableRegularFile(manifestPath, 'manifest.json', MAX_MANIFEST_BYTES);
  if (
    manifestBytes.length >= 3 &&
    manifestBytes[0] === 0xef &&
    manifestBytes[1] === 0xbb &&
    manifestBytes[2] === 0xbf
  ) {
    fail('manifest.json must not contain a UTF-8 BOM');
  }
  let manifestText;
  try {
    manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  } catch {
    fail('manifest.json must contain valid UTF-8 JSON');
  }
  if (!Buffer.from(manifestText, 'utf8').equals(manifestBytes)) {
    fail('manifest.json must contain canonical UTF-8 bytes');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    fail('manifest.json must contain valid UTF-8 JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest.json must contain an object');
  }
  if (manifest.manifest_version !== 3) fail('extension manifest must use MV3');
  const manifestVersion = extensionVersion(manifest.version, 'manifest version');
  if (manifestVersion !== expectedVersion) {
    fail(`manifest version is ${manifestVersion}, expected ${expectedVersion}`);
  }
  if (
    !manifest.background ||
    typeof manifest.background !== 'object' ||
    Array.isArray(manifest.background)
  ) {
    fail('manifest background is invalid');
  }
  const serviceWorker = safeWorkerRelativePath(manifest.background.service_worker);
  const workerPath = resolveWorkerFile(root, serviceWorker);
  const workerBytes = readStableRegularFile(
    workerPath,
    'manifest service worker',
    MAX_WORKER_BYTES,
  );
  if (resolveWorkerFile(root, serviceWorker) !== workerPath) {
    fail('manifest service worker path changed while its stable snapshot was read');
  }
  return Object.freeze({
    root,
    extensionDirectoryPathSha256: sha256(normalizedPathDigestInput(root)),
    manifest: Object.freeze({
      fileSha256: sha256(manifestBytes),
      fileByteLength: manifestBytes.length,
      manifestVersion: 3,
      version: manifestVersion,
      backgroundServiceWorker: serviceWorker,
    }),
    worker: Object.freeze({
      bytes: workerBytes,
      sha256: sha256(workerBytes),
      byteLength: workerBytes.length,
    }),
  });
}

async function boundedResponseText(response, maximumBytes, field) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        length += chunk.length;
        if (length > maximumBytes) {
          await reader.cancel();
          fail(`${field} response is too large`);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) fail(`${field} response is too large`);
  return text;
}

export async function fetchBrowserIdentity(cdpOrigin, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('fetch is unavailable');
  const timeoutMs = timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${cdpOrigin}/json/version`, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status !== 200) fail(`CDP version endpoint returned HTTP ${response.status}`);
    const raw = await boundedResponseText(response, MAX_HTTP_RESPONSE_BYTES, 'CDP version');
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      fail('CDP version response is not JSON');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('CDP version response is invalid');
    }
    if (
      typeof value.Browser !== 'string' ||
      !/^(?:Chrome|Chromium)\/[0-9]+(?:\.[0-9]+){3}$/u.test(value.Browser)
    ) {
      fail('CDP version response has no supported Chrome version');
    }
    return Object.freeze({
      chromeVersion: value.Browser,
      webSocketDebuggerUrl: normalizeBrowserWebSocket(value.webSocketDebuggerUrl, cdpOrigin),
    });
  } finally {
    clearTimeout(timer);
  }
}

function targetId(value) {
  if (typeof value !== 'string' || !TARGET_ID_PATTERN.test(value))
    fail('service worker target ID is invalid');
  return value;
}

function serviceWorkerUrl(id, relativePath) {
  return new URL(relativePath, `chrome-extension://${id}/`).href;
}

class BrowserCdpConnection {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.listeners = new Set();
    this.closed = false;
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    socket.onmessage = (event) => this.onMessage(event);
    socket.onerror = () => this.failPending(new Error('browser CDP WebSocket failed'));
    socket.onclose = () => {
      this.closed = true;
      this.failPending(new Error('browser CDP WebSocket closed early'));
      this.resolveClosed();
    };
  }

  onMessage(event) {
    const raw = typeof event.data === 'string' ? event.data : String(event.data || '');
    if (Buffer.byteLength(raw, 'utf8') > MAX_CDP_MESSAGE_BYTES) {
      this.failPending(new Error('browser CDP message is too large'));
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      this.failPending(new Error('browser CDP message is not JSON'));
      return;
    }
    if (Object.hasOwn(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`CDP ${pending.method} failed`));
      else pending.resolve(message.result || {});
      return;
    }
    if (typeof message.method !== 'string') return;
    this.events.push(message);
    if (this.events.length > 1024) this.events.shift();
    for (const listener of this.listeners) listener(message);
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  waitForEvent(predicate, field) {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`${field} timed out`));
      }, this.timeoutMs);
      const listener = (message) => {
        if (!predicate(message)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(message);
      };
      this.listeners.add(listener);
    });
  }

  async close() {
    if (this.closed) return;
    this.socket.close();
    let timer;
    await Promise.race([
      this.closedPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('browser CDP WebSocket close timed out')),
          this.timeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }
}

async function openBrowserConnection(url, options = {}) {
  const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
  if (typeof WebSocketImpl !== 'function') fail('WebSocket is unavailable');
  const timeoutMs = timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const timer = setTimeout(
      () => finish(new Error('browser CDP WebSocket open timed out')),
      timeoutMs,
    );
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        try {
          socket?.close();
        } catch {
          // Preserve the connection error.
        }
        reject(error);
      } else {
        resolve(new BrowserCdpConnection(socket, timeoutMs));
      }
    }
    try {
      socket = new WebSocketImpl(url);
    } catch (error) {
      finish(error);
      return;
    }
    socket.onopen = () => finish();
    socket.onerror = () => finish(new Error('browser CDP WebSocket failed to open'));
    socket.onclose = () => finish(new Error('browser CDP WebSocket closed before opening'));
  });
}

function selectExactWorkerTarget(targetInfos, expectedUrl) {
  if (!Array.isArray(targetInfos)) fail('Target.getTargets returned invalid target infos');
  const matches = targetInfos.filter(
    (value) => value && value.type === 'service_worker' && value.url === expectedUrl,
  );
  if (matches.length !== 1) {
    fail(`expected exactly one active extension service worker target, found ${matches.length}`);
  }
  targetId(matches[0].targetId);
  return matches[0];
}

function runtimeVersionFromResult(value) {
  const remote = value?.result;
  if (!remote || remote.type !== 'string' || typeof remote.value !== 'string') {
    fail('active worker returned no runtime manifest version');
  }
  return extensionVersion(remote.value, 'active worker runtime manifest version');
}

async function inspectAttachedWorker(connection, input) {
  const targetResult = await connection.send('Target.getTargets', {
    filter: [{ type: 'service_worker' }],
  });
  const target = selectExactWorkerTarget(targetResult.targetInfos, input.expectedWorkerUrl);
  const attach = await connection.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  if (typeof attach.sessionId !== 'string' || !attach.sessionId)
    fail('Target.attachToTarget returned no session');
  const sessionId = attach.sessionId;
  let debuggerEnabled = false;
  let debuggerPausedObserved = false;
  let result = null;
  let primaryError = null;
  const cleanupErrors = [];
  const parsedMainScripts = [];
  const observePaused = (message) => {
    if (message.sessionId === sessionId && message.method === 'Debugger.paused') {
      debuggerPausedObserved = true;
    }
  };
  const observeMainScript = (message) => {
    if (
      message.sessionId === sessionId &&
      message.method === 'Debugger.scriptParsed' &&
      message.params?.url === input.expectedWorkerUrl
    ) {
      parsedMainScripts.push(message);
    }
  };
  connection.listeners.add(observePaused);
  connection.listeners.add(observeMainScript);
  try {
    await connection.send('Debugger.enable', {}, sessionId);
    debuggerEnabled = true;
    if (debuggerPausedObserved)
      fail('Debugger.paused was observed during active worker attestation');
    if (parsedMainScripts.length === 0) {
      await connection.waitForEvent(
        (message) =>
          message.sessionId === sessionId &&
          message.method === 'Debugger.scriptParsed' &&
          message.params?.url === input.expectedWorkerUrl,
        'active worker main script discovery',
      );
    }
    if (parsedMainScripts.length !== 1) {
      fail(
        `expected exactly one parsed active worker main script, found ${parsedMainScripts.length}`,
      );
    }
    const scriptId = parsedMainScripts[0].params?.scriptId;
    if (typeof scriptId !== 'string' || !scriptId) fail('active worker main script ID is invalid');
    const runtime = await connection.send(
      'Runtime.evaluate',
      {
        expression: 'chrome.runtime.getManifest().version',
        returnByValue: true,
        awaitPromise: false,
        userGesture: false,
      },
      sessionId,
    );
    const runtimeManifestVersion = runtimeVersionFromResult(runtime);
    const source = await connection.send('Debugger.getScriptSource', { scriptId }, sessionId);
    if (typeof source.scriptSource !== 'string')
      fail('Debugger.getScriptSource returned no source');
    if (debuggerPausedObserved)
      fail('Debugger.paused was observed during active worker attestation');
    const activeBytes = Buffer.from(source.scriptSource, 'utf8');
    result = {
      targetIdSha256: sha256(target.targetId),
      runtimeManifestVersion,
      activeSha256: sha256(activeBytes),
      activeByteLength: activeBytes.length,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await connection.send('Debugger.disable', {}, sessionId);
    } catch (error) {
      cleanupErrors.push(new Error(`Debugger.disable cleanup failed: ${error.message}`));
    }
    if (parsedMainScripts.length !== 1 && !primaryError) {
      primaryError = new Error(
        `expected exactly one parsed active worker main script, found ${parsedMainScripts.length}`,
      );
    }
    try {
      await connection.send('Target.detachFromTarget', { sessionId });
    } catch (error) {
      cleanupErrors.push(new Error(`Target.detachFromTarget cleanup failed: ${error.message}`));
    }
    connection.listeners.delete(observePaused);
    connection.listeners.delete(observeMainScript);
  }
  if (debuggerPausedObserved && !primaryError) {
    primaryError = new Error('Debugger.paused was observed during active worker attestation');
  }
  if (primaryError || cleanupErrors.length) {
    const errors = [primaryError, ...cleanupErrors].filter(Boolean);
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, 'active worker attestation or protocol cleanup failed');
  }
  return Object.freeze({
    ...result,
    protocolCleanup: Object.freeze({
      targetAttached: true,
      debuggerEnabled,
      debuggerPausedObserved: false,
      debuggerDisabled: true,
      targetDetached: true,
    }),
  });
}

export async function attestActiveWorkerOverCdp(input, options = {}) {
  const connection =
    options.connection || (await openBrowserConnection(input.webSocketDebuggerUrl, options));
  try {
    return await inspectAttachedWorker(connection, input);
  } finally {
    if (!options.connection) await connection.close();
  }
}

function normalizeRunInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('input must be an object');
  return Object.freeze({
    cdpOrigin: normalizeCdpOrigin(input.cdpUrl),
    extensionId: extensionId(input.extensionId),
    extensionDirectory: input.extensionDirectory,
    expectedVersion: extensionVersion(input.expectedVersion, 'expected version'),
    timeoutMs: timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

export async function runExtensionActiveWorkerAttestation(input, dependencies = {}) {
  const normalized = normalizeRunInput(input);
  const extension = (dependencies.loadExtensionIdentity || loadExtensionIdentity)(
    normalized.extensionDirectory,
    normalized.expectedVersion,
  );
  const browser = dependencies.fetchBrowserIdentity
    ? await dependencies.fetchBrowserIdentity(normalized.cdpOrigin, normalized)
    : await fetchBrowserIdentity(normalized.cdpOrigin, {
        fetchImpl: dependencies.fetchImpl,
        timeoutMs: normalized.timeoutMs,
      });
  const expectedWorkerUrl = serviceWorkerUrl(
    normalized.extensionId,
    extension.manifest.backgroundServiceWorker,
  );
  const active = dependencies.attestActiveWorker
    ? await dependencies.attestActiveWorker({
        ...normalized,
        ...browser,
        expectedWorkerUrl,
      })
    : await attestActiveWorkerOverCdp(
        { ...normalized, ...browser, expectedWorkerUrl },
        { WebSocketImpl: dependencies.WebSocketImpl, timeoutMs: normalized.timeoutMs },
      );
  if (active.runtimeManifestVersion !== normalized.expectedVersion) {
    fail(
      `active worker runtime manifest version is ${active.runtimeManifestVersion}, expected ${normalized.expectedVersion}`,
    );
  }
  if (
    active.activeSha256 !== extension.worker.sha256 ||
    active.activeByteLength !== extension.worker.byteLength
  ) {
    fail('active worker main script does not match the exact extension directory worker bytes');
  }
  const now = dependencies.now ? dependencies.now() : new Date();
  const observedAt = now instanceof Date ? now.toISOString() : String(now);
  return parseExtensionActiveWorkerAttestationReceipt({
    schemaVersion: 1,
    kind: RECEIPT_KIND,
    scope: RECEIPT_SCOPE,
    observedAt,
    chromeVersion: browser.chromeVersion,
    cdpOriginSha256: sha256(normalized.cdpOrigin),
    extensionId: normalized.extensionId,
    expectedVersion: normalized.expectedVersion,
    extensionDirectoryPathSha256: extension.extensionDirectoryPathSha256,
    manifest: extension.manifest,
    worker: {
      url: expectedWorkerUrl,
      diskSha256: extension.worker.sha256,
      diskByteLength: extension.worker.byteLength,
      activeSha256: active.activeSha256,
      activeByteLength: active.activeByteLength,
      runtimeManifestVersion: active.runtimeManifestVersion,
      targetIdSha256: active.targetIdSha256,
    },
    protocolCleanup: active.protocolCleanup,
    scopeLimitations: {
      importedScriptGraphAttested: false,
      installedTreeAttested: false,
      signedPackageAttested: false,
      upgradeTransitionAttested: false,
    },
    attestorCommandEffects: {
      classification: 'READ_ONLY_CDP_COMMAND_SET',
      runtimeReloadCommands: 0,
      serviceWorkerStopCommands: 0,
      storageMutationCommands: 0,
      runtimeNetworkCommands: 0,
      providerPostCommands: 0,
      productionPortMessages: 0,
    },
  });
}

export function parseExtensionActiveWorkerAttestationReceipt(value) {
  const receipt = exactObject(
    value,
    [
      'schemaVersion',
      'kind',
      'scope',
      'observedAt',
      'chromeVersion',
      'cdpOriginSha256',
      'extensionId',
      'expectedVersion',
      'extensionDirectoryPathSha256',
      'manifest',
      'worker',
      'protocolCleanup',
      'scopeLimitations',
      'attestorCommandEffects',
    ],
    'receipt',
  );
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== RECEIPT_KIND ||
    receipt.scope !== RECEIPT_SCOPE
  ) {
    fail('receipt identity is invalid');
  }
  timestamp(receipt.observedAt);
  if (
    typeof receipt.chromeVersion !== 'string' ||
    !/^(?:Chrome|Chromium)\/[0-9]+(?:\.[0-9]+){3}$/u.test(receipt.chromeVersion)
  ) {
    fail('receipt Chrome version is invalid');
  }
  digest(receipt.cdpOriginSha256, 'receipt CDP origin');
  const id = extensionId(receipt.extensionId);
  const expectedVersion = extensionVersion(receipt.expectedVersion, 'receipt expected version');
  digest(receipt.extensionDirectoryPathSha256, 'receipt extension directory path');
  const manifest = exactObject(
    receipt.manifest,
    ['fileSha256', 'fileByteLength', 'manifestVersion', 'version', 'backgroundServiceWorker'],
    'receipt manifest',
  );
  digest(manifest.fileSha256, 'receipt manifest file');
  positiveInteger(manifest.fileByteLength, 'receipt manifest file byte length', MAX_MANIFEST_BYTES);
  if (manifest.manifestVersion !== 3) fail('receipt manifest must use MV3');
  if (extensionVersion(manifest.version, 'receipt manifest version') !== expectedVersion) {
    fail('receipt manifest version binding is invalid');
  }
  const workerPath = safeWorkerRelativePath(manifest.backgroundServiceWorker);
  const worker = exactObject(
    receipt.worker,
    [
      'url',
      'diskSha256',
      'diskByteLength',
      'activeSha256',
      'activeByteLength',
      'runtimeManifestVersion',
      'targetIdSha256',
    ],
    'receipt worker',
  );
  if (worker.url !== serviceWorkerUrl(id, workerPath))
    fail('receipt worker URL binding is invalid');
  const diskSha = digest(worker.diskSha256, 'receipt disk worker');
  const activeSha = digest(worker.activeSha256, 'receipt active worker');
  const diskBytes = positiveInteger(
    worker.diskByteLength,
    'receipt disk worker byte length',
    MAX_WORKER_BYTES,
  );
  const activeBytes = positiveInteger(
    worker.activeByteLength,
    'receipt active worker byte length',
    MAX_WORKER_BYTES,
  );
  if (diskSha !== activeSha || diskBytes !== activeBytes)
    fail('receipt active worker byte binding is invalid');
  if (
    extensionVersion(worker.runtimeManifestVersion, 'receipt runtime manifest version') !==
    expectedVersion
  ) {
    fail('receipt runtime manifest version binding is invalid');
  }
  digest(worker.targetIdSha256, 'receipt target ID');
  const cleanup = exactObject(
    receipt.protocolCleanup,
    [
      'targetAttached',
      'debuggerEnabled',
      'debuggerPausedObserved',
      'debuggerDisabled',
      'targetDetached',
    ],
    'receipt protocol cleanup',
  );
  if (
    cleanup.targetAttached !== true ||
    cleanup.debuggerEnabled !== true ||
    cleanup.debuggerPausedObserved !== false ||
    cleanup.debuggerDisabled !== true ||
    cleanup.targetDetached !== true
  ) {
    fail('receipt protocol cleanup is invalid');
  }
  const limitations = exactObject(
    receipt.scopeLimitations,
    [
      'importedScriptGraphAttested',
      'installedTreeAttested',
      'signedPackageAttested',
      'upgradeTransitionAttested',
    ],
    'receipt scope limitations',
  );
  if (
    limitations.importedScriptGraphAttested !== false ||
    limitations.installedTreeAttested !== false ||
    limitations.signedPackageAttested !== false ||
    limitations.upgradeTransitionAttested !== false
  ) {
    fail('receipt scope limitations are invalid');
  }
  const effects = exactObject(
    receipt.attestorCommandEffects,
    [
      'classification',
      'runtimeReloadCommands',
      'serviceWorkerStopCommands',
      'storageMutationCommands',
      'runtimeNetworkCommands',
      'providerPostCommands',
      'productionPortMessages',
    ],
    'receipt attestor command effects',
  );
  if (effects.classification !== 'READ_ONLY_CDP_COMMAND_SET') {
    fail('receipt attestor command classification is invalid');
  }
  zero(effects.runtimeReloadCommands, 'receipt runtime reload commands');
  zero(effects.serviceWorkerStopCommands, 'receipt service worker stop commands');
  zero(effects.storageMutationCommands, 'receipt storage mutation commands');
  zero(effects.runtimeNetworkCommands, 'receipt runtime network commands');
  zero(effects.providerPostCommands, 'receipt Provider POST commands');
  zero(effects.productionPortMessages, 'receipt production port messages');
  return Object.freeze({
    schemaVersion: 1,
    kind: RECEIPT_KIND,
    scope: RECEIPT_SCOPE,
    observedAt: receipt.observedAt,
    chromeVersion: receipt.chromeVersion,
    cdpOriginSha256: receipt.cdpOriginSha256,
    extensionId: id,
    expectedVersion,
    extensionDirectoryPathSha256: receipt.extensionDirectoryPathSha256,
    manifest: Object.freeze({ ...manifest }),
    worker: Object.freeze({ ...worker }),
    protocolCleanup: Object.freeze({ ...cleanup }),
    scopeLimitations: Object.freeze({ ...limitations }),
    attestorCommandEffects: Object.freeze({ ...effects }),
  });
}

export function canonicalExtensionActiveWorkerAttestationReceiptJson(value) {
  return `${JSON.stringify(parseExtensionActiveWorkerAttestationReceipt(value), null, 2)}\n`;
}

export function parseCliArgs(argv) {
  const allowed = new Set([
    '--cdp',
    '--extension-id',
    '--extension-dir',
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
  for (const required of [
    '--cdp',
    '--extension-id',
    '--extension-dir',
    '--expected-version',
    '--output',
  ]) {
    if (!values.has(required)) fail(`${required} is required`);
  }
  const output = path.resolve(values.get('--output'));
  if (path.extname(output).toLowerCase() !== '.json') fail('output must be a JSON file');
  return Object.freeze({
    input: Object.freeze({
      cdpUrl: values.get('--cdp'),
      extensionId: values.get('--extension-id'),
      extensionDirectory: path.resolve(values.get('--extension-dir')),
      expectedVersion: values.get('--expected-version'),
      timeoutMs: values.has('--timeout-ms') ? values.get('--timeout-ms') : DEFAULT_TIMEOUT_MS,
    }),
    output,
  });
}

export async function runCli(argv, dependencies = {}) {
  const { input, output } = parseCliArgs(argv);
  if (!existsSync(path.dirname(output))) fail('output directory does not exist');
  const receipt = dependencies.run
    ? await dependencies.run(input)
    : await runExtensionActiveWorkerAttestation(input, dependencies);
  const bytes = Buffer.from(canonicalExtensionActiveWorkerAttestationReceiptJson(receipt), 'utf8');
  (dependencies.writeArtifact || writeNewArtifactDurably)(output, bytes, { mode: 0o600 });
  return Object.freeze({
    ok: true,
    kind: RECEIPT_KIND,
    receiptSha256: sha256(bytes),
    expectedVersion: receipt.expectedVersion,
  });
}

async function main() {
  const summary = await runCli(process.argv.slice(2));
  console.log(JSON.stringify(summary, null, 2));
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
