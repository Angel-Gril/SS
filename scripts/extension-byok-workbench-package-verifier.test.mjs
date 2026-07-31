import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

assert.equal(
  packageJson.scripts['verify:extension:cloud'],
  'node scripts/verify-extension-package.mjs --dir build/extensions/ss-erp-cloud --target cloud --strict',
);
assert.equal(
  packageJson.scripts['verify:extension:local'],
  'node scripts/verify-extension-package.mjs --dir build/extensions/ss-erp-local --target local',
);
assert.equal(
  packageJson.scripts['build:extension:cloud'],
  'node scripts/build-extension-package.mjs cloud && pnpm verify:extension:cloud',
);
assert.equal(
  packageJson.scripts['build:extension:local'],
  'node scripts/build-extension-package.mjs local && pnpm verify:extension:local',
);
assert.equal(
  packageJson.scripts['package:extension:cloud'],
  'node scripts/package-extension-package.mjs cloud',
);
assert.equal(
  packageJson.scripts['package:extension:local'],
  'node scripts/package-extension-package.mjs local',
);

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
    writeFileSync(
      path.join(extensionDir, 'pages/escaped-remote-import.mjs'),
      'import("https\\x3a//cdn.example/remote.mjs");\n',
    );
    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'escaped remote module URLs must fail closed');
    assert.match(outputOf(result), /remote dynamic module import found/u);
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    writeFileSync(path.join(extensionDir, 'pages/function-constructor.cjs'), 'Function("x");\n');
    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'CommonJS executable constructors must fail closed');
    assert.match(outputOf(result), /Function constructor found: pages\/function-constructor\.cjs/u);
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    writeFileSync(
      path.join(extensionDir, 'pages/remote-script.svg'),
      '<svg><script src="data:text/javascript,alert(1)"></script></svg>\n',
    );
    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'SVG remote scripts must fail closed');
    assert.match(outputOf(result), /remote script tag found: pages\/remote-script\.svg/u);
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
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
    const dangerousCodeCases = [
      ['eval.js', 'eval("fixture");\n', /eval\(\) found/u],
      [
        'function-constructor.js',
        'Function("return 1")(); new globalThis.Function("return 2");\n',
        /Function constructor found/u,
      ],
      ['indirect-eval.js', '(0, eval)("fixture");\n', /eval\(\) found/u],
      [
        'remote-import-scripts.js',
        'importScripts("https://cdn.example/remote.js");\n',
        /remote importScripts\(\) source found/u,
      ],
      [
        'computed-import-scripts.js',
        'const source = "local.js"; importScripts(source);\n',
        /non-literal importScripts\(\) source found/u,
      ],
      [
        'remote-static-import.js',
        'import "https://cdn.example/remote.mjs";\n',
        /remote static module import found/u,
      ],
      [
        'remote-static-export.js',
        'export * from "//cdn.example/remote.mjs";\n',
        /remote static module import found/u,
      ],
      [
        'remote-dynamic-import.js',
        'import("data:text/javascript,export default 1");\n',
        /remote dynamic module import found/u,
      ],
      [
        'computed-dynamic-import.js',
        'const source = "local.mjs"; import(source);\n',
        /non-literal dynamic module import found/u,
      ],
      [
        'runtime-worker.js',
        'new Worker("https://cdn.example/worker.js");\n',
        /runtime Worker construction found/u,
      ],
      [
        'webassembly.js',
        'WebAssembly.instantiate(new Uint8Array());\n',
        /WebAssembly execution found/u,
      ],
      [
        'remote-script-assignment.js',
        'const script = document.createElement("script"); script.src = "blob:fixture";\n',
        /remote script assignment found/u,
      ],
    ];
    for (const [filename, source] of dangerousCodeCases) {
      writeFileSync(path.join(extensionDir, 'pages', filename), source);
    }
    writeFileSync(
      path.join(extensionDir, 'pages/remote-code-negative.wasm'),
      Buffer.from([0, 97, 115, 109]),
    );
    const manifestPath = path.join(extensionDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.content_security_policy = {
      extension_pages: "script-src 'self' cdn.example; object-src 'self'",
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'the verifier must reject every remote-code execution path');
    const output = outputOf(result);
    for (const [, , expected] of dangerousCodeCases) assert.match(output, expected);
    assert.match(
      output,
      /content_security_policy\.extension_pages permits non-packaged executable code/u,
    );
    assert.match(output, /WebAssembly package file found/u);
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
      /BYOK workbench page script order invalid: .*workbench-batch-client\.js must load before .*ai-image-workbench-workspace\.js/u,
    );
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    unlinkSync(path.join(extensionDir, 'shared/byok/workbench-batch-registry.js'));
    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'the verifier must reject a package without the batch registry');
    assert.match(
      outputOf(result),
      /BYOK module shared\/byok\/workbench-batch-registry\.js missing/u,
    );
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    const workerPath = path.join(extensionDir, 'background/service-worker.js');
    const worker = readFileSync(workerPath, 'utf8');
    const intentImport = "try { importScripts('../shared/byok/execution-intent-client.js'); }";
    const batchImport = "try { importScripts('../shared/byok/execution-batch-client.js'); }";
    assert.ok(worker.includes(intentImport));
    assert.ok(worker.includes(batchImport));
    writeFileSync(
      workerPath,
      worker.replace(intentImport, '').replace(batchImport, `${batchImport}\n${intentImport}`),
    );

    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'the verifier must reject intent client dependency inversion');
    assert.match(
      outputOf(result),
      /BYOK batch service worker script order invalid: .*execution-intent-client\.js must load before .*execution-batch-client\.js/u,
    );
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    writeFileSync(
      path.join(extensionDir, '.env.production'),
      'PROVIDER_API_KEY=sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n',
    );
    writeFileSync(
      path.join(extensionDir, 'pages/accidental-provider-note.txt'),
      'provider_key=sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n',
    );

    const result = verify(extensionDir);
    assert.notEqual(result.status, 0, 'the verifier must reject sensitive files and credential values');
    assert.match(outputOf(result), /sensitive file is not allowed: \.env\.production/u);
    assert.match(
      outputOf(result),
      /OpenAI-compatible API key found in pages\/accidental-provider-note\.txt/u,
    );
    assert.doesNotMatch(outputOf(result), /sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/u);
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    writeFileSync(
      path.join(extensionDir, 'pages/security-sentinel.txt'),
      'synthetic=sk-test-sentinel-never-real-1234567890\n',
    );
    const result = verify(extensionDir);
    assert.equal(
      result.status,
      0,
      `an explicitly synthetic test sentinel must not fail package verification\n${outputOf(result)}`,
    );
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

{
  const { tempRoot, extensionDir } = createPackageCopy();
  try {
    const outRoot = path.join(tempRoot, 'packages');
    writeFileSync(
      path.join(extensionDir, '.env.production'),
      'PROVIDER_API_KEY=sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n',
    );
    const result = spawnSync(
      process.execPath,
      ['scripts/package-extension-package.mjs', 'cloud'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          EXTENSION_SOURCE_DIR: extensionDir,
          EXTENSION_OUT_DIR: outRoot,
          EXTENSION_AUTO_BUMP_VERSION: 'false',
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    assert.notEqual(result.status, 0, 'package creation must stop when package verification fails');
    assert.match(outputOf(result), /sensitive file is not allowed: \.env\.production/u);
    assert.equal(existsSync(outRoot), true);
    assert.equal(
      readdirSync(outRoot).some((name) => name.endsWith('.zip')),
      false,
      'verification failure must not leave a newly generated ZIP',
    );
  } finally {
    assert.ok(tempRoot.startsWith(tempPrefix));
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log('PASS extension BYOK workbench package verifier contract');
