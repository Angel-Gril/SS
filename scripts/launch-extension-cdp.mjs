#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const DEFAULT_URL = 'about:blank';
const DEFAULT_TIMEOUT_MS = 30_000;
const FAILED_LAUNCH_SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_HTTP_RESPONSE_BYTES = 256 * 1024;

function fail(message) {
  throw new Error(`Extension CDP launcher failed: ${message}`);
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    fail(`${name} is required`);
  }
  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('port must be 1024-65535');
  return port;
}

function parseTimeout(value) {
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120_000) {
    fail('timeout must be 100-120000 milliseconds');
  }
  return timeout;
}

function parseLaunchUrl(value) {
  const raw = requiredString(value, 'URL');
  if (raw.length > 4096) fail('URL must be a credential-free HTTP or HTTPS URL');
  if (raw === 'about:blank') return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('URL must be a credential-free HTTP or HTTPS URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    fail('URL must be a credential-free HTTP or HTTPS URL');
  }
  return url.href;
}

export function normalizeLaunchInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('input is required');
  }
  const extensionDirectory = path.resolve(
    requiredString(input.extensionDirectory, 'extension directory'),
  );
  const extensionId = requiredString(input.extensionId, 'extension ID');
  if (!EXTENSION_ID_PATTERN.test(extensionId)) fail('extension ID is invalid');
  const expectedVersion = requiredString(input.expectedVersion, 'expected version');
  if (!VERSION_PATTERN.test(expectedVersion)) fail('expected version is invalid');
  return Object.freeze({
    chrome: input.chrome === undefined ? undefined : requiredString(input.chrome, 'chrome path'),
    extensionDirectory,
    extensionId,
    expectedVersion,
    port: input.port === undefined ? 9385 : parsePort(input.port),
    profileDirectory:
      input.profileDirectory === undefined
        ? undefined
        : path.resolve(requiredString(input.profileDirectory, 'profile directory')),
    timeoutMs: input.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(input.timeoutMs),
    url: parseLaunchUrl(input.url === undefined ? DEFAULT_URL : input.url),
  });
}

export function parseCliArgs(argv) {
  const allowed = new Set([
    '--chrome',
    '--extension-dir',
    '--extension-id',
    '--expected-version',
    '--port',
    '--profile',
    '--timeout-ms',
    '--url',
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !allowed.has(name) ||
      values.has(name) ||
      typeof value !== 'string' ||
      value.length === 0 ||
      value.startsWith('--')
    ) {
      fail('arguments are invalid');
    }
    values.set(name, value);
  }
  for (const required of ['--extension-dir', '--extension-id', '--expected-version']) {
    if (!values.has(required)) fail(`${required} is required`);
  }
  return normalizeLaunchInput({
    chrome: values.get('--chrome'),
    extensionDirectory: values.get('--extension-dir'),
    extensionId: values.get('--extension-id'),
    expectedVersion: values.get('--expected-version'),
    port: values.get('--port'),
    profileDirectory: values.get('--profile'),
    timeoutMs: values.get('--timeout-ms'),
    url: values.get('--url'),
  });
}

function readManifest(extensionDirectory) {
  const manifestPath = path.join(extensionDirectory, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`manifest.json was not found in ${extensionDirectory}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    fail('manifest.json is not valid JSON');
  }
  if (manifest?.manifest_version !== 3) fail('extension manifest must use MV3');
  if (manifest.version === undefined || !VERSION_PATTERN.test(manifest.version)) {
    fail('manifest version is invalid');
  }
  return manifest;
}

function defaultChromeCandidates() {
  const localAppData = process.env.LOCALAPPDATA;
  return [
    process.env.CHROME_BIN,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    localAppData &&
      path.join(localAppData, 'ms-playwright', 'chromium-1217', 'chrome-win64', 'chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
}

function resolveChrome(value) {
  const candidates = value ? [path.resolve(value)] : defaultChromeCandidates();
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) fail('Chrome executable was not found; pass --chrome <path>');
  return executable;
}

async function readBoundedText(response, maximumBytes) {
  if (!response.body) {
    const text = await response.text();
    return Buffer.byteLength(text, 'utf8') <= maximumBytes ? text : null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

async function fetchJson(url, timeoutMs) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!response || response.status !== 200) return null;
  let body;
  try {
    body = await readBoundedText(response, MAX_HTTP_RESPONSE_BYTES);
  } catch {
    return null;
  }
  if (body === null) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function assertCdpPortAvailable(cdpUrl) {
  let response;
  try {
    response = await fetch(`${cdpUrl}/json/version`, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(500),
    });
  } catch {
    // A connection failure is the expected result for a free loopback port.
    return;
  }
  if (response.body) await response.body.cancel();
  fail(`CDP port is already in use: ${cdpUrl}`);
}

async function waitForBrowser(cdpUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const identity = await fetchJson(`${cdpUrl}/json/version`, Math.min(2_000, timeoutMs));
    if (identity?.Browser && identity.webSocketDebuggerUrl) return identity;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`Chrome did not expose CDP on ${cdpUrl}`);
}

async function waitForWorker(cdpUrl, expectedWorkerUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await fetchJson(`${cdpUrl}/json/list`, Math.min(2_000, timeoutMs));
    if (Array.isArray(targets)) {
      const matches = targets.filter(
        (target) => target?.type === 'service_worker' && target.url === expectedWorkerUrl,
      );
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) fail(`found ${matches.length} live workers for ${expectedWorkerUrl}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`target service worker was not found: ${expectedWorkerUrl}`);
}

export async function cleanupFailedLaunch(child, temporaryProfileDirectory) {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      let timeout;
      const finish = () => {
        if (timeout) clearTimeout(timeout);
        child.off?.('exit', finish);
        resolve();
      };
      child.once('exit', finish);
      try {
        if (!child.kill()) {
          finish();
          return;
        }
      } catch {
        finish();
        return;
      }
      timeout = setTimeout(finish, FAILED_LAUNCH_SHUTDOWN_TIMEOUT_MS);
    });
  }
  if (temporaryProfileDirectory) {
    try {
      rmSync(temporaryProfileDirectory, { recursive: true, force: true });
    } catch {
      // The failed browser may briefly retain Windows profile locks; do not mask the root failure.
    }
  }
}

export async function launchExtensionCdp(input) {
  const normalized = normalizeLaunchInput(input);
  const {
    extensionDirectory,
    extensionId,
    expectedVersion,
    chrome: chromePath,
    profileDirectory: requestedProfileDirectory,
    port,
    timeoutMs,
    url,
  } = normalized;
  const manifest = readManifest(extensionDirectory);
  if (manifest.version !== expectedVersion) {
    fail(`manifest version is ${manifest.version}, expected ${expectedVersion}`);
  }
  const workerPath = manifest.background?.service_worker;
  if (typeof workerPath !== 'string' || workerPath.length === 0) {
    fail('manifest background service worker is missing');
  }
  const chrome = resolveChrome(chromePath);
  const cdpUrl = `http://127.0.0.1:${port}`;
  const expectedWorkerUrl = `chrome-extension://${extensionId}/${workerPath}`;

  await assertCdpPortAvailable(cdpUrl);

  const profileDirectory = requestedProfileDirectory
    ? requestedProfileDirectory
    : mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-cdp-'));
  const temporaryProfileDirectory = requestedProfileDirectory ? undefined : profileDirectory;
  mkdirSync(profileDirectory, { recursive: true });

  let child;
  try {
    child = spawn(
      chrome,
      [
        `--user-data-dir=${profileDirectory}`,
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        `--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`,
        url,
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
  } catch (error) {
    await cleanupFailedLaunch(child, temporaryProfileDirectory);
    fail(`Chrome could not be started: ${error instanceof Error ? error.message : String(error)}`);
  }
  const childFailure = new Promise((_, reject) => {
    child.once('error', (error) => {
      reject(new Error(`Extension CDP launcher failed: Chrome could not be started: ${error instanceof Error ? error.message : String(error)}`));
    });
    child.once('exit', (code, signal) => {
      reject(new Error(`Extension CDP launcher failed: Chrome exited before the extension was ready (code=${code}, signal=${signal || 'none'})`));
    });
  });
  childFailure.catch(() => {});
  child.unref();
  let identity;
  let worker;
  try {
    identity = await Promise.race([waitForBrowser(cdpUrl, timeoutMs), childFailure]);
    worker = await Promise.race([waitForWorker(cdpUrl, expectedWorkerUrl, timeoutMs), childFailure]);
  } catch (error) {
    await cleanupFailedLaunch(child, temporaryProfileDirectory);
    throw error;
  }
  return Object.freeze({
    ok: true,
    browser: identity.Browser,
    cdpUrl,
    extensionDirectory,
    extensionId,
    expectedVersion,
    profileDirectory,
    serviceWorkerTargetId: worker.id,
    serviceWorkerUrl: worker.url,
    url,
  });
}

async function main() {
  const input = parseCliArgs(process.argv.slice(2));
  console.log(JSON.stringify(await launchExtensionCdp(input), null, 2));
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
