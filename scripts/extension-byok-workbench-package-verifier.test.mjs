import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const sourceExtensionDir = path.resolve(repoRoot, 'extensions/ss-erp');
const tempPrefix = path.join(os.tmpdir(), 'ss-erp-workbench-package-verifier-');

function createPackageCopy() {
  const tempRoot = mkdtempSync(tempPrefix);
  const extensionDir = path.join(tempRoot, 'extension');
  cpSync(sourceExtensionDir, extensionDir, { recursive: true });
  return { tempRoot, extensionDir };
}

function verify(extensionDir) {
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

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    unlinkSync(path.join(extensionDir, 'shared/contracts/ai-image-workbench-v1.js'));
    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'the verifier must reject a package without the shared contract');
    assert.match(
      outputOf(result),
      /shared contract shared\/contracts\/ai-image-workbench-v1\.js missing/u,
    );
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    const htmlPath = path.join(extensionDir, 'pages/ai-image-workbench.html');
    const html = readFileSync(htmlPath, 'utf8');
    const stateTag = '  <script src="../shared/byok/workbench-workspace-state.js"></script>';
    const workspaceTag = '  <script src="./ai-image-workbench-workspace.js"></script>';
    assert.ok(html.includes(stateTag));
    assert.ok(html.includes(workspaceTag));
    const reordered = html
      .replace(workspaceTag, '')
      .replace(stateTag, `${workspaceTag}\n${stateTag}`);
    writeFileSync(htmlPath, reordered);

    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'the verifier must reject dependency-inverted scripts');
    assert.match(
      outputOf(result),
      /BYOK workbench page script order invalid: .*workbench-client\.js must load before .*ai-image-workbench-workspace\.js/u,
    );
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('PASS extension BYOK workbench package verifier contract');
