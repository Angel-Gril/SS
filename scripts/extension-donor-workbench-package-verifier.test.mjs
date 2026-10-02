import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const sourceExtensionDir = path.resolve(repoRoot, 'extensions/ss-erp');
const tempPrefix = path.join(os.tmpdir(), 'ss-erp-donor-package-verifier-');
const tempRoot = mkdtempSync(tempPrefix);
const sourceDir = path.join(tempRoot, 'source');
const outRoot = path.join(tempRoot, 'packages');
const retiredFiles = [
  'pages/source-workbench-shell.html',
  'pages/source-workbench-shell.css',
  'pages/source-workbench-shell.js',
  'content/source-listing-workbench.js',
  'content/source-listing-workbench.css',
];

function verify(extensionDir, target) {
  return spawnSync(process.execPath, ['scripts/verify-extension-package.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_DIR: extensionDir,
      EXTENSION_TARGET: target,
    },
    maxBuffer: 16 * 1024 * 1024,
  });
}

try {
  cpSync(sourceExtensionDir, sourceDir, { recursive: true });

  // Archived source is kept for comparison/rollback; it must not reach either
  // installable target. Retained calculator and execution owners remain present.
  for (const target of ['cloud', 'local']) {
    const build = spawnSync(process.execPath, ['scripts/build-extension-package.mjs', target], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, EXTENSION_SOURCE_DIR: sourceDir, EXTENSION_OUT_DIR: outRoot },
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    const builtDir = path.join(outRoot, `ss-erp-${target}`);
    for (const file of retiredFiles) {
      assert.equal(existsSync(path.join(builtDir, file)), false, `${target} package contains retired UI: ${file}`);
    }
    for (const file of [
      'pages/precision-workbench.html',
      'content/source-costing-panel.js',
      'shared/contracts/ai-image-workbench-v1.js',
      'shared/hosted/ai-image-suite-workbench-client.js',
      'pages/ai-image-workbench.html',
    ]) assert.equal(existsSync(path.join(builtDir, file)), true, `${target} package lost a retained owner: ${file}`);
    const normal = verify(builtDir, target);
    assert.equal(normal.status, 0, `${normal.stdout}\n${normal.stderr}`);
  }

  const extensionDir = path.join(outRoot, 'ss-erp-cloud');

  unlinkSync(path.join(extensionDir, 'shared/donor-workbench/prompt-adapter.js'));

  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const donorResources = manifest.web_accessible_resources.find((group) => (
    group.resources?.includes('pages/precision-workbench.html')
  ));
  assert.ok(donorResources);
  donorResources.matches.push('<all_urls>');
  donorResources.resources.push('pages/source-workbench-shell.html');
  manifest.content_scripts.push({
    matches: ['https://detail.1688.com/*'],
    js: ['content/source-listing-workbench.js'],
    css: ['content/source-listing-workbench.css'],
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of retiredFiles) cpSync(path.join(sourceDir, file), path.join(extensionDir, file));

  const bridgePath = path.join(extensionDir, 'content/donor-workbench-bridge.js');
  const bridge = readFileSync(bridgePath, 'utf8');
  assert.match(bridge, /var precisionEnabled = true/u);
  writeFileSync(
    bridgePath,
    `${bridge.replace('var precisionEnabled = true', 'var precisionEnabled = false')}\nfetch('https://api.ozon.ru/v1/product/import/info');\n`,
  );
  const precisionPath = path.join(extensionDir, 'pages/precision-workbench.js');
  writeFileSync(precisionPath, `${readFileSync(precisionPath, 'utf8')}\nfetch('https://unapproved-provider.invalid');\n`);

  const htmlPath = path.join(extensionDir, 'pages/precision-workbench.html');
  const html = readFileSync(htmlPath, 'utf8');
  const contractTag = '<script src="../shared/donor-workbench/workspace-contract.js"></script>';
  const adapterTag = '<script src="../shared/donor-workbench/prompt-adapter.js"></script>';
  assert.ok(html.includes(contractTag) && html.includes(adapterTag));
  writeFileSync(
    htmlPath,
    html.replace(contractTag, '').replace(adapterTag, `${adapterTag}\n${contractTag}`),
  );

  const result = verify(extensionDir, 'cloud');
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notEqual(result.status, 0, 'a weakened donor package must fail verification');
  assert.match(output, /donor workbench file shared\/donor-workbench\/prompt-adapter\.js missing/u);
  assert.match(output, /donor workbench web-accessible boundary is not exact/u);
  assert.match(output, /donor workbench entrypoint is not the default precision workbench/u);
  assert.match(output, /donor workbench contains a forbidden direct network or broad-permission path/u);
  assert.match(output, /precision workbench contains a forbidden direct network path/u);
  assert.match(output, /retired workbench UI is still loaded by the manifest/u);
  for (const file of retiredFiles) {
    assert.ok(output.includes(`retired workbench UI is included in the installable package: ${file}`));
  }
  assert.match(
    output,
    /precision workbench page script order invalid: .*workspace-contract\.js must load before .*prompt-adapter\.js/u,
  );
} finally {
  assert.ok(tempRoot.startsWith(tempPrefix));
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('PASS extension donor workbench package verifier contract');
