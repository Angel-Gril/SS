import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-bump-'));
const sourceDir = path.join(root, 'source');
const outDir = path.join(root, 'out');
const previousBuildRoot = path.join(root, 'previous');

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
writeManifest(path.join(previousBuildRoot, 'ss-erp-cloud'), '1.0.22');
fs.writeFileSync(path.join(previousBuildRoot, 'ss-erp-cloud-1.0.22.zip'), 'previous zip\n');

const result = spawnSync(process.execPath, ['scripts/package-extension-package.mjs', 'cloud'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    EXTENSION_SOURCE_DIR: sourceDir,
    EXTENSION_OUT_DIR: outDir,
    EXTENSION_PREVIOUS_BUILD_ROOT: previousBuildRoot,
  },
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

const builtManifest = JSON.parse(fs.readFileSync(path.join(outDir, 'ss-erp-cloud', 'manifest.json'), 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));

assert.equal(builtManifest.version, '1.0.23');
assert.equal(sourceManifest.version, '1.0.19', 'source manifest should not be mutated by package builds');
assert.ok(fs.existsSync(path.join(outDir, 'ss-erp-cloud-1.0.23.zip')));

console.log('PASS extension package auto bump');
