import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const commissionHost = 'https://global-help.ozon.com/*';
const readManifest = (directory) => JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));

function assertPreciseCommissionPermission(manifest) {
  assert.equal(manifest.host_permissions.filter((host) => host === commissionHost).length, 1);
  assert.equal(manifest.host_permissions.includes('https://*.ozon.com/*'), false);
  assert.equal(manifest.host_permissions.includes('https://*/*'), false);
  assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
  assert.equal((manifest.content_scripts || []).some((entry) => entry.matches.includes(commissionHost)), false);
  assert.equal((manifest.web_accessible_resources || []).some((entry) => entry.matches.includes(commissionHost)), false);
  assert.equal((manifest.externally_connectable?.matches || []).includes(commissionHost), false);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
}

test('source manifest permits the exact commission documentation destination without page access', () => {
  assertPreciseCommissionPermission(readManifest('extensions/ss-erp'));
});

for (const target of ['cloud', 'local']) {
  test(`${target} package preserves the exact commission destination permission`, (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), `ss-erp-commission-${target}-`));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, ['scripts/build-extension-package.mjs', target], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
      env: {
        ...process.env,
        EXTENSION_SOURCE_DIR: path.resolve('extensions/ss-erp'),
        EXTENSION_OUT_DIR: directory,
        EXTENSION_PREVIOUS_BUILD_ROOT: '',
        EXTENSION_CLOUD_BASE_URL: 'https://app.ss-erp.com',
        EXTENSION_LOCAL_BASE_URL: 'http://127.0.0.1:3001',
        NEXT_PUBLIC_USER_HOSTNAME: 'app.ss-erp.com',
        NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.ss-erp.com',
        NEXT_PUBLIC_API_BASE_URL: 'https://api.ss-erp.com',
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertPreciseCommissionPermission(readManifest(path.join(directory, `ss-erp-${target}`)));
  });
}
