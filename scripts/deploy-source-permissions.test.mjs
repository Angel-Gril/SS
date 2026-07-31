import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const linuxRoot = process.platform !== 'win32'
  && typeof process.getuid === 'function'
  && process.getuid() === 0;
const commit = 'a'.repeat(40);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
}

test('root gate install and deployment source ownership are fail-closed', {
  skip: !linuxRoot,
}, () => {
  const root = mkdtempSync('/root/ss-erp-deploy-source-test-');
  const source = join(root, 'source');
  const scripts = join(source, 'scripts');
  const gateRoot = join(root, 'gate');
  const required = [
    'deploy-backup-gate.mjs',
    'deploy-backup-attestation.mjs',
    'deploy-database-identity.mjs',
    'deploy-environment.mjs',
    'deploy-source-manifest.mjs',
    'freeze-deploy-source.sh',
    'verify-deploy-backup.sh',
  ];
  try {
    mkdirSync(scripts, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    chmodSync(source, 0o700);
    chmodSync(scripts, 0o700);
    for (const name of required) {
      copyFileSync(join(process.cwd(), 'scripts', name), join(scripts, name));
      chmodSync(join(scripts, name), 0o500);
    }
    let result = run('bash', [
      join(process.cwd(), 'scripts', 'install-deploy-backup-gate.sh'),
      commit,
      source,
      gateRoot,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(gateRoot, commit, 'TARGET_GIT_COMMIT'), 'utf8'), `${commit}\n`);
    assert.equal(lstatSync(join(gateRoot, commit)).mode & 0o777, 0o755);
    result = run('bash', [
      join(process.cwd(), 'scripts', 'install-deploy-backup-gate.sh'),
      commit,
      source,
      gateRoot,
    ]);
    assert.equal(result.status, 0, result.stderr);

    writeFileSync(join(scripts, 'deploy-database-identity.mjs'), 'changed\n');
    chmodSync(join(scripts, 'deploy-database-identity.mjs'), 0o500);
    result = run('bash', [
      join(process.cwd(), 'scripts', 'install-deploy-backup-gate.sh'),
      commit,
      source,
      gateRoot,
    ]);
    assert.notEqual(result.status, 0);

    const release = join(root, 'release');
    mkdirSync(join(release, 'apps', 'server'), { recursive: true });
    writeFileSync(join(release, 'apps', 'server', 'mutable.js'), 'data\n');
    writeFileSync(join(release, 'DEPLOYED_COMMIT'), `${commit}\n`);
    writeFileSync(join(release, '.env.staging'), 'DATABASE_URL=redacted\n');
    const manifestTool = join(process.cwd(), 'scripts', 'deploy-source-manifest.mjs');
    const openManifest = join(root, 'pre-build-open.manifest.json');
    const closedManifest = join(root, 'post-build-closed.manifest.json');
    result = run('node', [manifestTool, 'create', release, openManifest, commit]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(openManifest, 'utf8')).closed, false);

    const generated = join(release, 'apps', 'server', 'generated.js');
    writeFileSync(generated, 'generated\n');
    result = run('node', [manifestTool, 'verify', release, openManifest, commit]);
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(release, 'apps', 'server', 'mutable.js'), 'modified\n');
    result = run('node', [manifestTool, 'verify', release, openManifest, commit]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /open pre-build manifest/u);
    writeFileSync(join(release, 'apps', 'server', 'mutable.js'), 'data\n');

    result = run('node', [manifestTool, 'create-closed', release, closedManifest, commit]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(closedManifest, 'utf8')).closed, true);
    const closedExtra = join(release, 'apps', 'server', 'after-close');
    mkdirSync(closedExtra);
    result = run('node', [manifestTool, 'verify', release, closedManifest, commit]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /closed post-build manifest/u);
    rmSync(closedExtra, { recursive: true });
    writeFileSync(join(release, 'apps', 'server', 'mutable.js'), 'modified\n');
    result = run('node', [manifestTool, 'verify', release, closedManifest, commit]);
    assert.notEqual(result.status, 0);
    writeFileSync(join(release, 'apps', 'server', 'mutable.js'), 'data\n');
    rmSync(generated);
    result = run('node', [manifestTool, 'verify', release, closedManifest, commit]);
    assert.notEqual(result.status, 0);
    writeFileSync(generated, 'generated\n');
    result = run('node', [manifestTool, 'verify', release, closedManifest, commit]);
    assert.equal(result.status, 0, result.stderr);

    const freeze = join(process.cwd(), 'scripts', 'freeze-deploy-source.sh');
    result = run('bash', [freeze, 'freeze', commit, release]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lstatSync(join(release, 'apps', 'server')).uid, 0);
    assert.equal(lstatSync(join(release, 'apps', 'server')).mode & 0o022, 0);
    result = run('bash', [freeze, 'verify', commit, release]);
    assert.equal(result.status, 0, result.stderr);

    const mutable = join(release, 'apps', 'server', 'mutable.js');
    const sealed = join(root, 'sealed-release');
    const oldDescriptor = openSync(mutable, 'r+');
    try {
      result = run('bash', [freeze, 'seal', commit, release, sealed]);
      assert.equal(result.status, 0, result.stderr);
      assert.notEqual(lstatSync(mutable).ino, lstatSync(join(sealed, 'apps', 'server', 'mutable.js')).ino);
      result = run('node', [manifestTool, 'verify', sealed, closedManifest, commit]);
      assert.equal(result.status, 0, result.stderr);
      writeSync(oldDescriptor, 'old-inode-write\n', 0, 'utf8');
      assert.match(readFileSync(mutable, 'utf8'), /^old-inode-write/u);
      assert.equal(readFileSync(join(sealed, 'apps', 'server', 'mutable.js'), 'utf8'), 'data\n');
      result = run('node', [manifestTool, 'verify', sealed, closedManifest, commit]);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      closeSync(oldDescriptor);
    }

    const escaped = join(root, 'escaped-release');
    mkdirSync(join(escaped, 'apps', 'server'), { recursive: true });
    writeFileSync(join(escaped, 'DEPLOYED_COMMIT'), `${commit}\n`);
    symlinkSync('/etc/passwd', join(escaped, 'apps', 'server', 'external-link'));
    result = run('bash', [freeze, 'freeze', commit, escaped]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink escapes/u);

    const nobody = run('id', ['-un', '65534']);
    if (nobody.status === 0) {
      result = run('bash', [freeze, 'thaw', commit, release, nobody.stdout.trim(), '.env.staging']);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(lstatSync(join(release, 'apps', 'server')).uid, 65534);
      assert.equal(lstatSync(join(release, '.env.staging')).uid, 0);
      assert.equal(lstatSync(join(release, '.env.staging')).mode & 0o777, 0o640);
      assert.equal(lstatSync(join(release, 'DEPLOYED_COMMIT')).mode & 0o777, 0o644);
      writeFileSync(join(release, 'DEPLOYED_COMMIT'), `${commit}\n`);
      result = run('bash', [freeze, 'freeze', commit, release]);
      assert.equal(result.status, 0, result.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release Git verification scopes safe.directory to the validated root-owned checkout', {
  skip: !linuxRoot,
}, () => {
  const root = mkdtempSync('/tmp/ss-erp-release-git-test-');
  const repository = join(root, 'repository');
  const source = join(repository, 'extensions', 'ss-erp');
  try {
    chmodSync(root, 0o755);
    mkdirSync(source, { recursive: true, mode: 0o755 });
    writeFileSync(join(source, 'manifest.json'), '{}\n', { mode: 0o644 });
    let result = run('git', ['init', repository]);
    assert.equal(result.status, 0, result.stderr);
    result = run('git', ['-C', repository, 'add', '.']);
    assert.equal(result.status, 0, result.stderr);
    result = run('git', [
      '-C', repository,
      '-c', 'user.name=SS ERP Test',
      '-c', 'user.email=test@example.invalid',
      'commit', '-m', 'fixture',
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = run('runuser', [
      '-u', 'nobody', '--', 'git', '-C', repository, 'rev-parse', 'HEAD',
    ]);
    assert.notEqual(result.status, 0, 'the fixture must exercise Git dubious ownership');

    const moduleUrl = pathToFileURL(
      join(process.cwd(), 'scripts', 'extension-release-inputs.mjs'),
    ).href;
    const verificationSource = `
      import {
        extensionReleaseGitHead,
        extensionReleaseScopedGitStatus,
      } from ${JSON.stringify(moduleUrl)};
      const [repository, source] = process.argv.slice(1);
      const gitCommit = extensionReleaseGitHead(repository);
      const gitStatus = extensionReleaseScopedGitStatus({ repository, repoRoot: repository, sourceDir: source });
      process.stdout.write(JSON.stringify({ gitCommit, gitStatus }));
    `;
    result = run('runuser', [
      '-u', 'nobody', '--', process.execPath, '--input-type=module', '-e', verificationSource,
      repository, source,
    ], {
      env: {
        ...process.env,
        GIT_DIR: join(root, 'attacker-git-dir'),
        GIT_WORK_TREE: join(root, 'attacker-work-tree'),
        GIT_INDEX_FILE: join(root, 'attacker-index'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.bare',
        GIT_CONFIG_VALUE_0: 'true',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      gitCommit: run('git', ['-C', repository, 'rev-parse', 'HEAD']).stdout.trim(),
      gitStatus: '',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('initializer refuses a legacy shared symlink before changing its target', {
  skip: !linuxRoot,
}, () => {
  const root = mkdtempSync('/root/ss-erp-init-test-');
  const base = join(root, 'deploy');
  const shared = join(base, 'shared');
  const target = join(root, 'target');
  const bin = join(root, 'bin');
  try {
    mkdirSync(shared, { recursive: true });
    mkdirSync(bin);
    writeFileSync(target, 'protected\n', { mode: 0o600 });
    chmodSync(target, 0o600);
    symlinkSync(target, join(shared, 'uploads'));
    writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o700 });
    chmodSync(join(bin, 'sudo'), 0o700);
    const before = lstatSync(target);
    const result = run('bash', [join(process.cwd(), 'scripts', 'init-server.sh')], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DEPLOY_BASE: base,
        DEPLOY_USER: 'nobody',
        ENV_FILE_NAME: '.env.staging',
        EXTENSION_RELEASE_BASE: join(root, 'extension-releases'),
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not be a symlink/u);
    const after = lstatSync(target);
    assert.equal(after.uid, before.uid);
    assert.equal(after.mode & 0o777, before.mode & 0o777);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('initializer rejects a writable extension release ancestor', {
  skip: !linuxRoot,
}, () => {
  const root = mkdtempSync('/root/ss-erp-extension-release-root-test-');
  const bin = join(root, 'bin');
  const writableParent = join(root, 'writable-parent');
  try {
    mkdirSync(bin);
    mkdirSync(writableParent, { mode: 0o777 });
    chmodSync(writableParent, 0o777);
    writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o700 });
    chmodSync(join(bin, 'sudo'), 0o700);
    const result = run('bash', [join(process.cwd(), 'scripts', 'init-server.sh')], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DEPLOY_BASE: join(root, 'deploy'),
        DEPLOY_USER: 'nobody',
        ENV_FILE_NAME: '.env.staging',
        EXTENSION_RELEASE_BASE: join(writableParent, 'extension-releases'),
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /extension release base ancestors must not be group\/world writable/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
