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
const verifierPath = path.resolve(repoRoot, 'scripts/verify-extension-package.mjs');
const preflightPath = path.resolve(repoRoot, 'scripts/preflight.mjs');
const tempPrefix = path.join(os.tmpdir(), 'ss-erp-hosted-package-verifier-');

const requiredFocusedTests = [
  'extension-hosted-ai-image-suite-workbench-adapter.test.mjs',
  'extension-hosted-ai-image-transport.test.mjs',
  'extension-hosted-ai-image-suite-candidate-preview-bridge.test.mjs',
  'extension-hosted-ai-image-suite-workbench-client.test.mjs',
  'extension-hosted-ai-image-suite-workbench-client-registry.test.mjs',
  'extension-hosted-ai-image-suite-workbench-runtime-dispatcher.test.mjs',
  'extension-hosted-ai-image-suite-service-worker.test.mjs',
  'extension-hosted-ai-image-suite-workbench-runtime-client.test.mjs',
  'extension-hosted-ai-image-suite-candidate-preview-consumer.test.mjs',
  'extension-hosted-ai-image-suite-workspace-projection.test.mjs',
  'extension-hosted-ai-image-workbench-controller.test.mjs',
  'extension-hosted-ai-image-suite-package-verifier.test.mjs',
];

const verifierSource = readFileSync(verifierPath, 'utf8');
const preflightSource = readFileSync(preflightPath, 'utf8');
const workbenchHtml = readFileSync(
  path.join(sourceExtensionDir, 'pages/ai-image-workbench.html'),
  'utf8',
);

assert.match(
  workbenchHtml,
  /ai-image-workbench-workspace\.js[\s\S]*ai-image-workbench-hosted\.js[\s\S]*ai-image-workbench\.js[\s\S]*ai-image-workbench-edit\.js/u,
  'Hosted authority arbitration must load before either BYOK page controller',
);

for (const modulePath of [
  'shared/hosted/ai-image-suite-workbench-adapter.js',
  'shared/hosted/ai-image-suite-candidate-preview-bridge.js',
  'shared/hosted/ai-image-suite-workbench-client.js',
  'shared/hosted/ai-image-suite-workbench-client-registry.js',
  'shared/hosted/ai-image-suite-workbench-runtime-dispatcher.js',
  'shared/hosted/ai-image-suite-workbench-runtime-client.js',
  'shared/hosted/ai-image-suite-candidate-preview-consumer.js',
  'shared/hosted/ai-image-suite-workspace-projection.js',
  'pages/ai-image-workbench-hosted.js',
]) {
  assert.ok(verifierSource.includes(modulePath), `verifier must require ${modulePath}`);
}

for (const testName of requiredFocusedTests) {
  assert.ok(preflightSource.includes(`scripts/${testName}`), `preflight must run ${testName}`);
}

const tempRoot = mkdtempSync(tempPrefix);
const extensionDir = path.join(tempRoot, 'extension');
try {
  cpSync(sourceExtensionDir, extensionDir, { recursive: true });

  unlinkSync(path.join(
    extensionDir,
    'shared/hosted/ai-image-suite-workbench-client-registry.js',
  ));

  const htmlPath = path.join(extensionDir, 'pages/ai-image-workbench.html');
  const html = readFileSync(htmlPath, 'utf8');
  const consumerTag =
    '  <script src="../shared/hosted/ai-image-suite-candidate-preview-consumer.js"></script>';
  const projectionTag =
    '  <script src="../shared/hosted/ai-image-suite-workspace-projection.js"></script>';
  assert.ok(html.includes(consumerTag));
  assert.ok(html.includes(projectionTag));
  writeFileSync(
    htmlPath,
    html.replace(projectionTag, '').replace(consumerTag, `${projectionTag}\n${consumerTag}`),
  );

  const workerPath = path.join(extensionDir, 'background/service-worker.js');
  const worker = readFileSync(workerPath, 'utf8');
  const dispatcherRegistration = '    ...hostedWorkbenchDispatcher.handlers,';
  assert.ok(worker.includes(dispatcherRegistration));
  writeFileSync(workerPath, worker.replace(dispatcherRegistration, ''));

  const result = spawnSync(process.execPath, ['scripts/verify-extension-package.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_DIR: extensionDir,
      EXTENSION_TARGET: 'source',
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notEqual(result.status, 0, 'the verifier must reject incomplete hosted packaging');
  assert.match(
    output,
    /hosted background module shared\/hosted\/ai-image-suite-workbench-client-registry\.js missing/u,
  );
  assert.match(
    output,
    /ERP-hosted workbench page script order invalid: .*candidate-preview-consumer\.js must load before .*workspace-projection\.js/u,
  );
  assert.match(output, /service worker hosted dispatcher wiring is incomplete/u);
} finally {
  assert.ok(tempRoot.startsWith(tempPrefix));
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('PASS extension hosted AI image suite package verifier contract');
