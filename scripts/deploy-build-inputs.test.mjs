import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { materializeGitCommitTree, readGitCommitTree } from './git-commit-tree.mjs';

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

function verifyDeploymentBuildInputs(lineEnding) {
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
    write(root, '.gitattributes', '* text eol=lf\n');
    write(root, 'apps/server/src/index.ts', 'export const server = true;\n');
    write(root, 'apps/web/src/app/page.tsx', 'export default function Page() { return null; }\n');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const filename of ['verify-deploy-build-inputs.mjs', 'git-commit-tree.mjs']) {
      const source = readFileSync(join(process.cwd(), 'scripts', filename), 'utf8')
        .replace(/\r?\n/gu, lineEnding === 'CRLF' ? '\r\n' : '\n');
      write(root, `scripts/${filename}`, source);
    }
    const emptyTemplate = join(root, 'empty-git-template');
    const emptyHooks = join(root, 'empty-git-hooks');
    mkdirSync(emptyTemplate);
    mkdirSync(emptyHooks);
    assert.equal(run('git', [
      'init', '--quiet', '--object-format=sha1', `--template=${emptyTemplate}`,
    ], root).status, 0);
    assert.equal(run('git', ['config', 'core.autocrlf', 'false'], root).status, 0);
    assert.equal(run('git', ['config', 'commit.gpgsign', 'false'], root).status, 0);
    assert.equal(run('git', ['config', 'core.hooksPath', emptyHooks], root).status, 0);
    assert.equal(run('git', ['add', '.'], root).status, 0);
    assert.equal(run('git', [
      '-c',
      'user.name=SS ERP Test',
      '-c',
      'user.email=test@invalid.example',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '-m',
      'fixture',
    ], root).status, 0);
    const head = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();
    // Deployment compares raw blobs, so the fixture must use committed bytes
    // even when its source checkout was converted to CRLF by Windows Git.
    const committed = readGitCommitTree({ repositoryRoot: root, commit: head });
    for (const entry of committed.entries) write(root, entry.pathname, entry.bytes);
    const verify = (allowedRuntimeEnvironment) => run(process.execPath, [
      'scripts/verify-deploy-build-inputs.mjs',
      head,
      ...(allowedRuntimeEnvironment ? [allowedRuntimeEnvironment] : []),
    ], root);

    const baseline = verify();
    assert.equal(baseline.status, 0, baseline.stderr);
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

    rmSync(join(root, '.env.local'));
    rmSync(join(root, '.env'));
    assert.equal(run('git', [
      'update-index', '--assume-unchanged', 'apps/server/src/index.ts',
    ], root).status, 0);
    write(root, 'apps/server/src/index.ts', 'export const server = false;\n');
    assert.equal(
      run('git', ['status', '--porcelain', '--', 'apps/server/src/index.ts'], root).stdout,
      '',
      'the fixture must hide the changed tracked bytes from ordinary Git status',
    );
    result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /worktree bytes differ from Git commit/u);
    assert.equal(run('git', [
      'update-index', '--no-assume-unchanged', 'apps/server/src/index.ts',
    ], root).status, 0);
    assert.equal(run('git', ['checkout', '--', 'apps/server/src/index.ts'], root).status, 0);

    assert.equal(run('git', [
      'update-index', '--skip-worktree', 'apps/server/src/index.ts',
    ], root).status, 0);
    write(root, 'apps/server/src/index.ts', 'export const server = "skip-worktree";\n');
    assert.equal(
      run('git', ['status', '--porcelain', '--', 'apps/server/src/index.ts'], root).stdout,
      '',
      'the fixture must hide skip-worktree bytes from ordinary Git status',
    );
    result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /worktree bytes differ from Git commit/u);
    assert.equal(run('git', [
      'update-index', '--no-skip-worktree', 'apps/server/src/index.ts',
    ], root).status, 0);
    assert.equal(run('git', ['checkout', '--', 'apps/server/src/index.ts'], root).status, 0);

    write(root, '.ignored-build-config', 'mutates build behavior\n');
    write(root, '.git/info/exclude', '.ignored-build-config\n');
    result = verify();
    assert.equal(
      result.status,
      0,
      'irrelevant ignored root files remain outside the explicit build-input scope',
    );
    write(root, '.npmrc', 'dangerously-ignore-scripts=true\n');
    write(root, '.git/info/exclude', '.ignored-build-config\n.npmrc\n');
    result = verify();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.npmrc/u);

    rmSync(join(root, '.npmrc'));
    write(root, '.git/info/exclude', '.ignored-build-config\n');
    write(root, 'apps/server/src/index.ts', 'export const server = "replacement";\n');
    assert.equal(run('git', ['add', 'apps/server/src/index.ts'], root).status, 0);
    assert.equal(run('git', [
      '-c', 'user.name=SS ERP Test',
      '-c', 'user.email=test@invalid.example',
      'commit', '--quiet', '--no-gpg-sign', '-m', 'replacement',
    ], root).status, 0);
    const replacementCommit = run('git', ['rev-parse', 'HEAD'], root).stdout.trim();
    assert.equal(run('git', ['replace', head, replacementCommit], root).status, 0);
    write(root, '.git/info/attributes', 'apps/server/src/index.ts export-ignore\n');
    const snapshot = join(root, 'raw-snapshot');
    mkdirSync(snapshot);
    materializeGitCommitTree({ repositoryRoot: root, commit: head, outputRoot: snapshot });
    assert.equal(
      readFileSync(join(snapshot, 'apps/server/src/index.ts'), 'utf8'),
      'export const server = true;\n',
      'raw snapshots must ignore replacement refs and local export attributes',
    );
    const redirectedSnapshot = join(root, 'redirected-snapshot');
    mkdirSync(redirectedSnapshot);
    result = run(process.execPath, [
      join(process.cwd(), 'scripts', 'git-commit-tree.mjs'),
      'materialize', head, redirectedSnapshot,
    ], root, {
      ...process.env,
      GIT_DIR: join(root, 'attacker-git-dir'),
      GIT_WORK_TREE: join(root, 'attacker-work-tree'),
      GIT_INDEX_FILE: join(root, 'attacker-index'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.bare',
      GIT_CONFIG_VALUE_0: 'true',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(redirectedSnapshot, 'apps/server/src/index.ts'), 'utf8'),
      'export const server = true;\n',
      'inherited Git redirects must not change a deployment snapshot',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const lineEnding of ['LF', 'CRLF']) {
  test(`deployment build input verifier rejects ignored source while allowing generated output (${lineEnding})`, () => {
    verifyDeploymentBuildInputs(lineEnding);
  });
}
