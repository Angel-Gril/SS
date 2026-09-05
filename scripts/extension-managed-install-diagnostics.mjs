#!/usr/bin/env node
import { createHash, createPublicKey } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensionIdentity } from './extension-active-worker-attestation.mjs';

export const DEFAULT_EXTENSION_ID = 'nkkemglcckgmhmcfnjjmcfbdhciafahl';
export const DEFAULT_CDP_PORTS = Object.freeze([9222, 9223, 9229, 9333, 9385]);

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_KEY_BYTES = 64 * 1024;
const CDP_TIMEOUT_MS = 750;

function fail(message) {
  throw new Error(`Managed extension diagnostics failed: ${message}`);
}

function assertExtensionId(value) {
  if (typeof value !== 'string' || !EXTENSION_ID_PATTERN.test(value)) {
    fail('extension ID is invalid');
  }
  return value;
}

function assertVersion(value, field = 'version') {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    fail(`${field} is invalid`);
  }
  return value;
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function normalizedPath(value) {
  return path.resolve(value).replaceAll('\\', '/').toLowerCase();
}

function isRegularNonSymlink(filePath) {
  try {
    const stat = lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isDirectoryNonSymlink(directoryPath) {
  try {
    const stat = lstatSync(directoryPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function readManifestVersion(directoryPath) {
  const manifestPath = path.join(directoryPath, 'manifest.json');
  if (!isRegularNonSymlink(manifestPath)) return null;
  try {
    const stat = lstatSync(manifestPath);
    if (stat.size > MAX_MANIFEST_BYTES) return null;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest || manifest.manifest_version !== 3 || !VERSION_PATTERN.test(manifest.version)) {
      return null;
    }
    return manifest.version;
  } catch {
    return null;
  }
}

function hasManagedIdentitySegment(directoryPath, extensionId) {
  const expected = extensionId.toLowerCase();
  return normalizedPath(directoryPath)
    .split('/')
    .some((segment) => segment === expected);
}

function safeDirectories(directoryPath) {
  if (!isDirectoryNonSymlink(directoryPath)) return [];
  try {
    return readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(directoryPath, entry.name));
  } catch {
    return [];
  }
}

function defaultProfileRoots() {
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  const programData = String(process.env.PROGRAMDATA || '').trim();
  const roots = [];
  if (localAppData) {
    roots.push(
      path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      path.join(localAppData, 'Google', 'Chrome SxS', 'User Data'),
      path.join(localAppData, 'Chromium', 'User Data'),
    );
  }
  if (programData) {
    roots.push(
      path.join(programData, 'Google', 'Chrome', 'User Data'),
      path.join(programData, 'Chromium', 'User Data'),
    );
  }
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function discoverManagedExtensionDirectories({
  extensionId = DEFAULT_EXTENSION_ID,
  profileRoots = defaultProfileRoots(),
} = {}) {
  assertExtensionId(extensionId);
  const candidates = new Set();
  for (const rawRoot of profileRoots) {
    if (typeof rawRoot !== 'string' || !rawRoot.trim()) continue;
    const root = path.resolve(rawRoot);
    const bases = [path.join(root, 'Extensions', extensionId)];
    for (const profile of safeDirectories(root)) {
      bases.push(path.join(profile, 'Extensions', extensionId));
    }
    for (const base of bases) {
      if (!isDirectoryNonSymlink(base)) continue;
      const directVersion = readManifestVersion(base);
      if (directVersion) candidates.add(path.resolve(base));
      for (const versionDirectory of safeDirectories(base)) {
        if (readManifestVersion(versionDirectory)) candidates.add(path.resolve(versionDirectory));
      }
    }
  }
  return [...candidates].sort((left, right) => normalizedPath(left).localeCompare(normalizedPath(right)));
}

export function deriveExtensionIdFromPublicKey(keyBytes) {
  if (!Buffer.isBuffer(keyBytes) && !(keyBytes instanceof Uint8Array)) {
    fail('public key bytes are required');
  }
  const digest = createHash('sha256').update(keyBytes).digest();
  return [...digest.subarray(0, 16)]
    .map((byte) => `${String.fromCharCode(97 + ((byte >> 4) & 0x0f))}${String.fromCharCode(97 + (byte & 0x0f))}`)
    .join('');
}

export function deriveExtensionIdFromKeyFile(keyPath) {
  if (typeof keyPath !== 'string' || !keyPath.trim()) fail('key path is required');
  const resolved = path.resolve(keyPath);
  if (!isRegularNonSymlink(resolved)) fail('key path must be a regular non-symlink file');
  const stat = lstatSync(resolved);
  if (stat.size > MAX_KEY_BYTES) fail('key file is too large');
  let publicKey;
  try {
    publicKey = createPublicKey(readFileSync(resolved)).export({ type: 'spki', format: 'der' });
  } catch {
    fail('key file is not a supported public or private key');
  }
  return deriveExtensionIdFromPublicKey(publicKey);
}

export function inspectManagedExtensionDirectory(directoryPath, {
  extensionId = DEFAULT_EXTENSION_ID,
  expectedVersion,
} = {}) {
  assertExtensionId(extensionId);
  if (expectedVersion !== undefined) assertVersion(expectedVersion, 'expected version');
  const resolved = path.resolve(directoryPath);
  if (!isDirectoryNonSymlink(resolved)) {
    return Object.freeze({ path: resolved, status: 'MISSING', reason: 'directory_missing_or_symlink' });
  }
  if (!hasManagedIdentitySegment(resolved, extensionId)) {
    return Object.freeze({ path: resolved, status: 'UNBOUND', reason: 'path_not_bound_to_extension_id' });
  }
  const version = readManifestVersion(resolved);
  if (!version) return Object.freeze({ path: resolved, status: 'INVALID', reason: 'manifest_invalid' });
  if (expectedVersion && version !== expectedVersion) {
    return Object.freeze({
      path: resolved,
      status: 'STALE',
      version,
      expectedVersion,
      reason: 'manifest_version_mismatch',
    });
  }
  try {
    const identity = loadExtensionIdentity(resolved, version);
    return Object.freeze({
      path: resolved,
      status: 'FOUND',
      version,
      manifestSha256: identity.manifest.fileSha256,
      workerSha256: identity.worker.sha256,
      workerByteLength: identity.worker.byteLength,
    });
  } catch (error) {
    return Object.freeze({
      path: resolved,
      status: 'INVALID',
      version,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function inspectManagedExtension({
  extensionId = DEFAULT_EXTENSION_ID,
  expectedVersion,
  extensionDirectory,
  profileRoots,
  keyPath,
} = {}) {
  assertExtensionId(extensionId);
  if (expectedVersion !== undefined) assertVersion(expectedVersion, 'expected version');
  const directories = extensionDirectory
    ? [path.resolve(extensionDirectory)]
    : discoverManagedExtensionDirectories({ extensionId, profileRoots });
  const inspections = directories.map((directory) => inspectManagedExtensionDirectory(directory, {
    extensionId,
    expectedVersion,
  }));
  const found = inspections
    .filter((item) => item.status === 'FOUND')
    .sort((left, right) => compareVersions(right.version, left.version));
  let key;
  if (keyPath) {
    try {
      const derivedExtensionId = deriveExtensionIdFromKeyFile(keyPath);
      key = Object.freeze({
        provided: true,
        derivedExtensionId,
        matchesExpected: derivedExtensionId === extensionId,
      });
    } catch (error) {
      key = Object.freeze({
        provided: true,
        matchesExpected: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    key = Object.freeze({ provided: false });
  }
  const status = key.provided && key.matchesExpected === false
    ? 'KEY_MISMATCH'
    : found.length > 0
      ? 'FOUND'
      : inspections.some((item) => item.status === 'STALE')
        ? 'STALE'
        : inspections.some((item) => item.status === 'UNBOUND')
          ? 'UNBOUND'
          : inspections.some((item) => item.status === 'INVALID')
            ? 'INVALID'
            : 'MISSING';
  return Object.freeze({
    extensionId,
    expectedVersion: expectedVersion || null,
    status,
    managedDirectories: Object.freeze(found),
    inspectedDirectories: Object.freeze(inspections),
    key,
  });
}

function cdpPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('CDP port must be 1024-65535');
  return port;
}

export async function probeCdpPort(port, {
  fetchImpl = globalThis.fetch,
  timeoutMs = CDP_TIMEOUT_MS,
} = {}) {
  const normalizedPort = cdpPort(port);
  if (typeof fetchImpl !== 'function') return Object.freeze({ port: normalizedPort, status: 'UNAVAILABLE' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${normalizedPort}/json/version`, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) return Object.freeze({ port: normalizedPort, status: 'UNAVAILABLE' });
    const body = await response.json();
    if (!body || typeof body !== 'object' || typeof body.Browser !== 'string') {
      return Object.freeze({ port: normalizedPort, status: 'INVALID' });
    }
    return Object.freeze({ port: normalizedPort, status: 'READY', browser: body.Browser.slice(0, 128) });
  } catch {
    return Object.freeze({ port: normalizedPort, status: 'UNAVAILABLE' });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeCdpPorts(ports = DEFAULT_CDP_PORTS, dependencies = {}) {
  const uniquePorts = [...new Set(ports.map(cdpPort))];
  const results = await Promise.all(uniquePorts.map((port) => probeCdpPort(port, dependencies)));
  return Object.freeze(results);
}

export function parseCliArgs(argv) {
  const allowed = new Set([
    '--extension-id',
    '--expected-version',
    '--extension-dir',
    '--profile-root',
    '--key',
    '--cdp-port',
    '--json',
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--json') {
      if (values.has(name)) fail('arguments are invalid');
      values.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (!allowed.has(name) || name === '--json' || values.has(name) || typeof value !== 'string' || value.startsWith('--')) {
      fail('arguments are invalid');
    }
    values.set(name, value);
    index += 1;
  }
  const extensionId = values.get('--extension-id') || DEFAULT_EXTENSION_ID;
  assertExtensionId(extensionId);
  const expectedVersion = values.get('--expected-version');
  if (expectedVersion) assertVersion(expectedVersion, 'expected version');
  const profileRoot = values.get('--profile-root');
  const cdpPorts = values.has('--cdp-port') ? [cdpPort(values.get('--cdp-port'))] : DEFAULT_CDP_PORTS;
  return Object.freeze({
    extensionId,
    expectedVersion,
    extensionDirectory: values.get('--extension-dir'),
    profileRoots: profileRoot ? [path.resolve(profileRoot)] : undefined,
    keyPath: values.get('--key'),
    cdpPorts,
    json: values.get('--json') === true,
  });
}

export async function runDiagnostics(options, dependencies = {}) {
  const extension = inspectManagedExtension(options);
  const cdp = await probeCdpPorts(options.cdpPorts || DEFAULT_CDP_PORTS, dependencies);
  return Object.freeze({
    schemaVersion: 1,
    extension,
    cdp: Object.freeze({
      status: cdp.some((item) => item.status === 'READY') ? 'READY' : 'NOT_FOUND',
      ports: cdp,
    }),
  });
}

function printHuman(result) {
  console.log(`EXTENSION_ID=${result.extension.extensionId}`);
  console.log(`EXTENSION_STATUS=${result.extension.status}`);
  if (result.extension.expectedVersion) console.log(`EXPECTED_VERSION=${result.extension.expectedVersion}`);
  for (const item of result.extension.managedDirectories) {
    console.log(`MANAGED_EXTENSION_DIR=${item.path}`);
    console.log(`MANAGED_EXTENSION_VERSION=${item.version}`);
  }
  if (result.extension.key.provided) {
    console.log(`KEY_DERIVED_ID=${result.extension.key.derivedExtensionId || 'unavailable'}`);
    console.log(`KEY_MATCHES_EXPECTED=${result.extension.key.matchesExpected}`);
  }
  console.log(`CDP_STATUS=${result.cdp.status}`);
  for (const port of result.cdp.ports.filter((item) => item.status === 'READY')) {
    console.log(`CDP_PORT=${port.port}`);
    console.log(`CDP_BROWSER=${port.browser}`);
  }
  if (result.extension.status === 'MISSING') {
    console.log('PROVISIONING_REQUIRED=managed extension installation or enterprise policy is missing');
  }
  if (result.cdp.status === 'NOT_FOUND') {
    console.log('CDP_REQUIRED=start Chrome with a dedicated loopback remote-debugging port');
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await runDiagnostics(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  if (result.extension.status !== 'FOUND' || result.cdp.status !== 'READY') process.exitCode = 2;
}

if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
