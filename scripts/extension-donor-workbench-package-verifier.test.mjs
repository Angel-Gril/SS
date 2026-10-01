import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const sourceExtensionDir = path.resolve(repoRoot, 'extensions/ss-erp');
const tempPrefix = path.join(os.tmpdir(), 'ss-erp-donor-package-verifier-');
const tempRoot = mkdtempSync(tempPrefix);
const extensionDir = path.join(tempRoot, 'extension');

function verify() {
  return spawnSync(process.execPath, ['scripts/verify-extension-package.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_DIR: extensionDir,
      EXTENSION_TARGET: 'source',
    },
    maxBuffer: 16 * 1024 * 1024,
  });
}

try {
  cpSync(sourceExtensionDir, extensionDir, { recursive: true });

  unlinkSync(path.join(extensionDir, 'shared/donor-workbench/prompt-adapter.js'));

  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const donorResources = manifest.web_accessible_resources.find((group) => (
    group.resources?.includes('pages/source-workbench-shell.html')
  ));
  assert.ok(donorResources);
  donorResources.matches.push('<all_urls>');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const bridgePath = path.join(extensionDir, 'content/donor-workbench-bridge.js');
  const bridge = readFileSync(bridgePath, 'utf8');
  assert.match(bridge, /enabled !== true/u);
  writeFileSync(bridgePath, bridge.replace('enabled !== true', 'enabled === false'));

  const pagePath = path.join(extensionDir, 'pages/source-workbench-shell.js');
  writeFileSync(
    pagePath,
    `${readFileSync(pagePath, 'utf8')}\nfetch('https://api.ozon.ru/v1/product/import/info');\n`,
  );
  const precisionPath = path.join(extensionDir, 'pages/precision-workbench.js');
  writeFileSync(precisionPath, `${readFileSync(precisionPath, 'utf8')}\nfetch('https://unapproved-provider.invalid');\n`);

  const htmlPath = path.join(extensionDir, 'pages/source-workbench-shell.html');
  const html = readFileSync(htmlPath, 'utf8');
  const contractTag = '  <script src="../shared/donor-workbench/workspace-contract.js"></script>';
  const adapterTag = '  <script src="../shared/donor-workbench/prompt-adapter.js"></script>';
  assert.ok(html.includes(contractTag) && html.includes(adapterTag));
  writeFileSync(
    htmlPath,
    html.replace(contractTag, '').replace(adapterTag, `${adapterTag}\n${contractTag}`),
  );

  const result = verify();
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notEqual(result.status, 0, 'a weakened donor package must fail verification');
  assert.match(output, /donor workbench file shared\/donor-workbench\/prompt-adapter\.js missing/u);
  assert.match(output, /donor workbench web-accessible boundary is not exact/u);
  assert.match(output, /donor workbench entrypoint is not default-off and allowlisted/u);
  assert.match(output, /donor workbench contains a forbidden direct network or broad-permission path/u);
  assert.match(output, /precision workbench contains a forbidden direct network path/u);
  assert.match(
    output,
    /donor workbench page script order invalid: .*workspace-contract\.js must load before .*prompt-adapter\.js/u,
  );
} finally {
  assert.ok(tempRoot.startsWith(tempPrefix));
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('PASS extension donor workbench package verifier contract');
