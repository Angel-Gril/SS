import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyInstalledUiTree } from './qa04-suite-target-ui-readback.mjs';

test('native UI producer rejects any changed or extra installed file before browser inspection', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-ui-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = Buffer.from('synthetic signed file');
  const entries = [{ parts: ['ss-erp-cloud', 'manifest.json'], data }];
  writeFileSync(path.join(root, 'manifest.json'), data);
  assert.match(verifyInstalledUiTree(root, entries), /^[a-f0-9]{64}$/u);
  writeFileSync(path.join(root, 'extra.js'), 'unapproved script');
  assert.throws(() => verifyInstalledUiTree(root, entries));
  rmSync(path.join(root, 'extra.js')); writeFileSync(path.join(root, 'manifest.json'), 'tampered');
  assert.throws(() => verifyInstalledUiTree(root, entries));
});
test('UI readback command supports help and refuses incomplete arguments without CDP I/O', () => {
  const help = spawnSync(process.execPath, ['scripts/qa04-suite-target-ui-readback.mjs', '--help'], { encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0); assert.match(help.stdout, /already open dedicated browser/u);
  const rejected = spawnSync(process.execPath, ['scripts/qa04-suite-target-ui-readback.mjs', '--commit', 'not-a-commit'], { encoding: 'utf8', windowsHide: true });
  assert.equal(rejected.status, 1); assert.match(rejected.stderr, /QA04_SUITE_TARGET_UI_REQUIRED/u);
});
