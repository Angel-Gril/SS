import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveExtensionIdFromPublicKey,
  deriveExtensionIdFromKeyFile,
  discoverManagedExtensionDirectories,
  inspectManagedExtension,
  inspectManagedExtensionDirectory,
  parseCliArgs,
  probeCdpPort,
  probeCdpPorts,
} from './extension-managed-install-diagnostics.mjs';

const EXTENSION_ID = 'nkkemglcckgmhmcfnjjmcfbdhciafahl';
const VERSION = '1.0.264';

function fixtureManagedExtension(root, version = VERSION) {
  const directory = path.join(root, 'Default', 'Extensions', EXTENSION_ID, version);
  mkdirSync(path.join(directory, 'background'), { recursive: true });
  writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify({
    manifest_version: 3,
    version,
    name: 'SS ERP managed fixture',
    background: { service_worker: 'background/service-worker.js' },
  }, null, 2)}\n`);
  writeFileSync(path.join(directory, 'background/service-worker.js'), 'globalThis.fixture = true;\n');
  return directory;
}

test('discovers only ID-bound managed extension directories and validates the worker', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ss-erp-managed-extension-'));
  try {
    const directory = fixtureManagedExtension(root);
    const discovered = discoverManagedExtensionDirectories({ extensionId: EXTENSION_ID, profileRoots: [root] });
    assert.deepEqual(discovered, [directory]);
    const result = inspectManagedExtension({ extensionId: EXTENSION_ID, expectedVersion: VERSION, profileRoots: [root] });
    assert.equal(result.status, 'FOUND');
    assert.equal(result.managedDirectories[0].version, VERSION);
    assert.match(result.managedDirectories[0].manifestSha256, /^[a-f0-9]{64}$/u);
    assert.match(result.managedDirectories[0].workerSha256, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unpacked paths, stale versions, and symlinked roots', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ss-erp-managed-extension-invalid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const unpacked = path.join(root, 'unpacked');
  mkdirSync(unpacked, { recursive: true });
  writeFileSync(path.join(unpacked, 'manifest.json'), `${JSON.stringify({
    manifest_version: 3,
    version: VERSION,
    background: { service_worker: 'service-worker.js' },
  })}\n`);
  writeFileSync(path.join(unpacked, 'service-worker.js'), 'globalThis.fixture = true;\n');
  assert.equal(inspectManagedExtensionDirectory(unpacked, { extensionId: EXTENSION_ID }).status, 'UNBOUND');

  const misleading = path.join(root, EXTENSION_ID, 'unpacked');
  mkdirSync(misleading, { recursive: true });
  writeFileSync(path.join(misleading, 'manifest.json'), `${JSON.stringify({
    manifest_version: 3,
    version: VERSION,
    background: { service_worker: 'service-worker.js' },
  })}\n`);
  writeFileSync(path.join(misleading, 'service-worker.js'), 'globalThis.fixture = true;\n');
  assert.equal(
    inspectManagedExtensionDirectory(misleading, { extensionId: EXTENSION_ID }).status,
    'UNBOUND',
  );

  const stale = fixtureManagedExtension(root, '1.0.263');
  assert.equal(
    inspectManagedExtensionDirectory(stale, { extensionId: EXTENSION_ID, expectedVersion: VERSION }).status,
    'STALE',
  );

  const link = path.join(root, 'link');
  try {
    symlinkSync(stale, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(inspectManagedExtensionDirectory(link, { extensionId: EXTENSION_ID }).status, 'MISSING');
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    t.skip('platform does not permit an unprivileged directory symlink');
  }
});

test('derives Chrome extension IDs from an external key without exposing key bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ss-erp-managed-extension-key-'));
  try {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicDer = publicKey.export({ type: 'spki', format: 'der' });
    const expected = deriveExtensionIdFromPublicKey(publicDer);
    assert.match(expected, /^[a-p]{32}$/u);
    const keyPath = path.join(root, 'release-key.pem');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    assert.equal(deriveExtensionIdFromKeyFile(keyPath), expected);
    const result = inspectManagedExtension({ extensionId: expected, keyPath, profileRoots: [root] });
    assert.equal(result.key.matchesExpected, true);
    assert.equal(Object.hasOwn(result.key, 'privateKey'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('probes only bounded loopback CDP version endpoints', async () => {
  let request;
  const ready = await probeCdpPort(9385, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => ({ Browser: 'Chrome/152.0.1' }) };
    },
  });
  assert.deepEqual(ready, { port: 9385, status: 'READY', browser: 'Chrome/152.0.1' });
  assert.equal(request.url, 'http://127.0.0.1:9385/json/version');
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.credentials, 'omit');

  const unavailable = await probeCdpPorts([9385, 9385], {
    fetchImpl: async () => { throw new Error('connection refused'); },
  });
  assert.deepEqual(unavailable, [
    { port: 9385, status: 'UNAVAILABLE' },
  ]);
});

test('requires explicit identity bindings while keeping safe defaults for diagnostics', () => {
  const parsed = parseCliArgs([
    '--expected-version', VERSION,
    '--profile-root', 'C:/Chrome/User Data',
    '--cdp-port', '9385',
    '--json',
  ]);
  assert.equal(parsed.extensionId, EXTENSION_ID);
  assert.equal(parsed.expectedVersion, VERSION);
  assert.equal(parsed.cdpPorts[0], 9385);
  assert.equal(parsed.json, true);
  assert.throws(() => parseCliArgs(['--cdp-port', '80']), /CDP port/u);
  assert.throws(() => parseCliArgs(['--extension-id', 'unsafe']), /extension ID/u);
});

test('direct CLI execution emits a missing-install diagnosis and exits nonzero', () => {
  const result = spawnSync(process.execPath, ['scripts/extension-managed-install-diagnostics.mjs', '--cdp-port', '65535'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /EXTENSION_STATUS=MISSING/u);
  assert.match(result.stdout, /CDP_STATUS=NOT_FOUND/u);
  assert.match(result.stdout, /PROVISIONING_REQUIRED=/u);
});

console.log('PASS managed extension install diagnostics contract');
