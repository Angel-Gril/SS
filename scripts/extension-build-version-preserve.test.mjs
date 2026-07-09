import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-build-version-'));
const sourceDir = path.join(root, 'source');
const outDir = path.join(root, 'out');

function writeManifest(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({
      manifest_version: 3,
      name: 'SS ERP Test Extension',
      short_name: 'SS ERP',
      version,
      permissions: [],
      content_scripts: [],
      web_accessible_resources: [],
    }, null, 2)}\n`,
  );
}

writeManifest(sourceDir, '1.0.19');
fs.writeFileSync(path.join(sourceDir, 'background.js'), 'console.log("test");\n');
writeManifest(path.join(outDir, 'ss-erp-local'), '1.0.193');
fs.writeFileSync(path.join(outDir, 'ss-erp-local-1.0.194.zip'), 'previous zip\n');

const result = spawnSync(process.execPath, ['scripts/build-extension-package.mjs', 'local'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    EXTENSION_SOURCE_DIR: sourceDir,
    EXTENSION_OUT_DIR: outDir,
  },
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

const builtManifest = JSON.parse(fs.readFileSync(path.join(outDir, 'ss-erp-local', 'manifest.json'), 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));

assert.equal(
  builtManifest.version,
  '1.0.194',
  'unpacked build should preserve the highest existing local package version instead of resetting to source',
);
assert.equal(sourceManifest.version, '1.0.19', 'source manifest should remain a stable template');

console.log('PASS extension build preserves package version');
