import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function run(command, args, cwd, env = process.env) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
}

function write(root, relative, contents) {
  const file = join(root, relative);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, contents);
}

test('deployment build input verifier rejects ignored source while allowing generated output', () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-erp-deploy-build-inputs-'));
  try {
    write(root, '.gitignore', [
      '**/tmp/',
      '*.orig',
      '.env*',
      'dist/',
      '.next-dev/',
      '',
    ].join('\n'));
    write(root, 'apps/server/src/index.ts', 'export const server = true;\n');
    write(root, 'apps/web/src/app/page.tsx', 'export default function Page() { return null; }\n');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(
      join(process.cwd(), 'scripts', 'verify-deploy-build-inputs.mjs'),
      join(root, 'scripts', 'verify-deploy-build-inputs.mjs'),
    );
    assert.equal(run('git', ['init', '--quiet'], root).status, 0);
    assert.equal(run('git', ['add', '.'], root).status, 0);
    assert.equal(run('git', [
      '-c',
      'user.name=SS ERP Test',
      '-c',
      'user.email=test@invalid.example',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ], root).status, 0);
    const head = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();
    const verify = (allowedRuntimeEnvironment) => run(process.execPath, [
      'scripts/verify-deploy-build-inputs.mjs',
      head,
      ...(allowedRuntimeEnvironment ? [allowedRuntimeEnvironment] : []),
    ], root);

    assert.equal(verify().status, 0);
    write(root, 'apps/web/.next-dev/cache.bin', 'generated');
    write(root, 'apps/server/dist/index.js', 'generated');
    assert.equal(verify().status, 0, 'known generated outputs must remain excluded');

    write(root, 'apps/web/src/app/tmp/page.tsx', 'export default function Hidden() { return null; }\n');
    let result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /apps\/web\/src\/app\/tmp\/page\.tsx/u);
    rmSync(join(root, 'apps', 'web', 'src', 'app', 'tmp'), { recursive: true, force: true });

    write(root, 'apps/server/.env', 'DATABASE_URL=postgresql://ignored\n');
    result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /apps\/server\/\.env/u);

    rmSync(join(root, 'apps', 'server', '.env'));
    write(root, '.env', 'DATABASE_URL=postgresql://runtime-only\n');
    result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.env/u);
    assert.equal(verify('.env').status, 0, 'only the selected runtime env may be ignored');

    write(root, '.env.local', 'DATABASE_URL=postgresql://unexpected-build-input\n');
    result = verify('.env');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.env\.local/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
