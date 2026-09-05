import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {
  assertCdpPortAvailable,
  cleanupFailedLaunch,
  normalizeLaunchInput,
  parseCliArgs,
} from './launch-extension-cdp.mjs';

const EXTENSION_ID = 'nkkemglcckgmhmcfnjjmcfbdhciafahl';
const VERSION = '1.0.311';

test('requires explicit extension identity bindings', () => {
  assert.throws(
    () => parseCliArgs(['--extension-dir', 'extensions/ss-erp']),
    /--extension-id is required/u,
  );
  assert.throws(
    () =>
      parseCliArgs([
        '--extension-dir',
        'extensions/ss-erp',
        '--extension-id',
        EXTENSION_ID,
        '--expected-version',
        '1.0',
      ]),
    /expected version is invalid/u,
  );
});

test('parses a deterministic isolated CDP launch', () => {
  const parsed = parseCliArgs([
    '--extension-dir',
    'C:/managed/ss-erp-cloud',
    '--extension-id',
    EXTENSION_ID,
    '--expected-version',
    VERSION,
    '--port',
    '9385',
    '--profile',
    'C:/tmp/ss-erp-cdp',
    '--url',
    'https://app.ss-erp.com/orders',
  ]);
  assert.equal(parsed.extensionId, EXTENSION_ID);
  assert.equal(parsed.expectedVersion, VERSION);
  assert.equal(parsed.port, 9385);
  assert.equal(parsed.profileDirectory, path.resolve('C:/tmp/ss-erp-cdp'));
  assert.equal(parsed.url, 'https://app.ss-erp.com/orders');
});

test('rejects unsafe or ambiguous launch arguments', () => {
  assert.throws(
    () =>
      parseCliArgs([
        '--extension-dir',
        'extensions/ss-erp',
        '--extension-id',
        EXTENSION_ID,
        '--expected-version',
        VERSION,
        '--port',
        '80',
      ]),
    /port must be 1024-65535/u,
  );
  assert.throws(
    () =>
      parseCliArgs([
        '--extension-dir',
        'extensions/ss-erp',
        '--extension-id',
        EXTENSION_ID,
        '--expected-version',
        VERSION,
        '--port',
        '9385',
        '--port',
        '9386',
      ]),
    /arguments are invalid/u,
  );
  for (const unsafeUrl of [
    'javascript:alert(1)',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'https://operator:secret@example.com/orders',
    'https://example.com/orders?access_token=secret',
    'https://example.com/orders#token',
  ]) {
    assert.throws(
      () =>
        parseCliArgs([
          '--extension-dir',
          'extensions/ss-erp',
          '--extension-id',
          EXTENSION_ID,
          '--expected-version',
          VERSION,
          '--url',
          unsafeUrl,
        ]),
      /URL must be a credential-free HTTP or HTTPS URL/u,
    );
  }
});

test('normalizes direct API input with the same strict bindings as the CLI', () => {
  const normalized = normalizeLaunchInput({
    extensionDirectory: 'C:/managed/ss-erp-cloud',
    extensionId: EXTENSION_ID,
    expectedVersion: VERSION,
  });
  assert.equal(normalized.port, 9385);
  assert.equal(normalized.timeoutMs, 30_000);
  assert.equal(normalized.url, 'about:blank');
  assert.throws(
    () => normalizeLaunchInput({ extensionDirectory: 'x', extensionId: 'bad', expectedVersion: VERSION }),
    /extension ID is invalid/u,
  );
  assert.throws(
    () => normalizeLaunchInput({ extensionDirectory: 'x', extensionId: EXTENSION_ID, expectedVersion: VERSION, port: 80 }),
    /port must be 1024-65535/u,
  );
});

test('launcher guards the CDP evidence boundary before accepting a worker', () => {
  const source = readFileSync(new URL('./launch-extension-cdp.mjs', import.meta.url), 'utf8');
  assert.match(source, /assertCdpPortAvailable\(cdpUrl\)/u);
  assert.match(source, /child\.once\('error'/u);
  assert.match(source, /child\.once\('exit'/u);
  assert.match(source, /MAX_HTTP_RESPONSE_BYTES/u);
  assert.match(source, /getReader\(\)/u);
  assert.match(source, /await cleanupFailedLaunch\(child, temporaryProfileDirectory\)/u);
  assert.doesNotMatch(source, /--window-position=-32000,-32000/u);
});

test('failed launches terminate Chrome and remove only launcher-owned profiles', async () => {
  class FakeChild extends EventEmitter {
    exitCode = null;
    signalCode = null;
    killed = false;

    kill() {
      this.killed = true;
      queueMicrotask(() => {
        this.exitCode = 0;
        this.emit('exit', 0, null);
      });
      return true;
    }
  }

  const profileDirectory = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-launcher-cleanup-'));
  mkdirSync(path.join(profileDirectory, 'Default'));
  writeFileSync(path.join(profileDirectory, 'Default', 'marker'), 'test');
  const child = new FakeChild();

  await cleanupFailedLaunch(child, profileDirectory);

  assert.equal(child.killed, true);
  assert.equal(existsSync(profileDirectory), false);
});

test('rejects a pre-existing CDP endpoint and accepts a refused free port', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    await assert.rejects(
      () => assertCdpPortAvailable('http://127.0.0.1:9385'),
      /CDP port is already in use/u,
    );
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await assertCdpPortAvailable('http://127.0.0.1:9385');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
