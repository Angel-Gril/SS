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

fs.cpSync(path.resolve('extensions/ss-erp'), sourceDir, { recursive: true });
const sourceManifestPath = path.join(sourceDir, 'manifest.json');
const sourceTemplateManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
sourceTemplateManifest.version = '1.0.19';
fs.writeFileSync(sourceManifestPath, `${JSON.stringify(sourceTemplateManifest, null, 2)}\n`);
writeManifest(path.join(previousBuildRoot, 'ss-erp-cloud'), '1.0.22');
fs.writeFileSync(path.join(previousBuildRoot, 'ss-erp-cloud-1.0.22.zip'), 'previous zip\n');
writeManifest(path.join(previousBuildRoot, 'ss-erp-local'), '1.0.22');
fs.writeFileSync(path.join(previousBuildRoot, 'ss-erp-local-1.0.22.zip'), 'previous zip\n');

function packageTarget(target) {
  return spawnSync(process.execPath, ['scripts/package-extension-package.mjs', target], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_SOURCE_DIR: sourceDir,
      EXTENSION_OUT_DIR: outDir,
      EXTENSION_PREVIOUS_BUILD_ROOT: previousBuildRoot,
    },
  });
}

for (const target of ['cloud', 'local']) {
  const result = packageTarget(target);
  assert.equal(result.status, 0, `${target}\n${result.stdout}\n${result.stderr}`);
}

const sourceManifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));

for (const target of ['cloud', 'local']) {
  const builtManifest = JSON.parse(
    fs.readFileSync(path.join(outDir, `ss-erp-${target}`, 'manifest.json'), 'utf8'),
  );
  assert.equal(builtManifest.version, '1.0.23');
  assert.ok(fs.existsSync(path.join(outDir, `ss-erp-${target}-1.0.23.zip`)));
}
assert.equal(sourceManifest.version, '1.0.19', 'source manifest should not be mutated by package builds');

for (const file of [
  'scripts/deploy.sh',
  'scripts/deploy-app-dir.sh',
  'scripts/deploy-staging.sh',
]) {
  const deployer = fs.readFileSync(file, 'utf8');
  assert.match(deployer, /package:extension:cloud/u, `${file} must package the cloud extension`);
  assert.match(deployer, /package:extension:local/u, `${file} must package the local extension`);
  assert.ok(
    (deployer.match(/EXTENSION_PREVIOUS_BUILD_ROOT=/gu) || []).length >= 2,
    `${file} must version both extension targets against the previous release`,
  );
}

console.log('PASS extension package auto bump and deployment targets');
