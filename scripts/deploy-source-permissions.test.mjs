import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  chownSync,
  closeSync,
  copyFileSync,
  existsSync,
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

test('release deployment atomically transitions systemd units before service verification', () => {
  const deploy = readFileSync(join(process.cwd(), 'scripts', 'deploy.sh'), 'utf8');
  const installer = readFileSync(
    join(process.cwd(), 'scripts', 'install-release-systemd.sh'),
    'utf8',
  );
  const switchIndex = deploy.indexOf('ln -sfnT "$RELEASE_DIR" "$CURRENT_LINK"');
  const installIndex = deploy.indexOf(
    'bash "$RELEASE_DIR/scripts/install-release-systemd.sh"',
    switchIndex,
  );
  const restartLabelIndex = deploy.indexOf('echo "[deploy] Restarting services"', installIndex);
  const restartIndex = deploy.indexOf(
    'systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"',
    restartLabelIndex,
  );
  const runtimeCheckIndex = deploy.indexOf('verify_service_release_cwd "$API_SERVICE"');
  const healthIndex = deploy.indexOf('curl -fsS "$HEALTH_URL"');
  assert.ok(
    switchIndex >= 0 && installIndex > switchIndex
      && restartLabelIndex > installIndex && restartIndex > restartLabelIndex,
    'release units must be installed after the current switch and before service restart',
  );
  assert.ok(
    runtimeCheckIndex > restartIndex && healthIndex > runtimeCheckIndex,
    'live process working directories must be target-bound before health is accepted',
  );
  assert.match(deploy, /UNIT_SNAPSHOT_DIR="\$DEPLOY_SYSTEMD_SNAPSHOT_ROOT\/\$TARGET_GIT_COMMIT"/u);
  assert.match(deploy, /install-release-systemd\.sh" --restore/u);
  assert.match(deploy, /SSH_ARGS\+=\(-F "\$SSH_CONFIG_FILE"\)/u);
  assert.doesNotMatch(deploy, /eval .*SSH|ProxyCommand=/u);
  assert.match(installer, /systemd-analyze verify/u);
  assert.match(installer, /FragmentPath does not use the installed release unit/u);
  assert.match(installer, /WorkingDirectory does not target the current release/u);
  assert.match(installer, /does not use the shared release environment/u);
  assert.match(installer, /Install failed; restoring previous unit files/u);
});

test('release systemd installer snapshots, verifies, restores, and auto-recovers', {
  skip: !linuxRoot,
}, () => {
  const root = mkdtempSync('/opt/ss-erp-release-systemd-test-');
  const base = join(root, 'deploy');
  const release = join(base, 'releases', commit);
  const current = join(base, 'current');
  const source = join(root, 'units');
  const destination = join(root, 'installed');
  const bin = join(root, 'bin');
  const firstSnapshot = join(root, 'snapshot-first');
  const failedSnapshot = join(root, 'snapshot-failed');
  const services = {
    api: `ss-erp-test-${process.pid}-api`,
    worker: `ss-erp-test-${process.pid}-worker`,
    web: `ss-erp-test-${process.pid}-web`,
  };
  const installer = join(process.cwd(), 'scripts', 'install-release-systemd.sh');
  try {
    mkdirSync(join(release, 'apps', 'server'), { recursive: true });
    mkdirSync(join(release, 'apps', 'web'), { recursive: true });
    mkdirSync(join(base, 'shared'), { recursive: true });
    mkdirSync(source);
    mkdirSync(destination);
    mkdirSync(bin);
    symlinkSync(release, current, 'dir');
    writeFileSync(join(base, 'shared', '.env.staging'), 'NODE_ENV=production\n', { mode: 0o640 });
    for (const service of Object.values(services)) {
      writeFileSync(join(source, `${service}.service`), `new-${service}\n`, { mode: 0o644 });
      writeFileSync(join(destination, `${service}.service`), `legacy-${service}\n`, { mode: 0o644 });
    }
    writeFileSync(join(bin, 'systemd-analyze'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'systemctl'), [
      '#!/bin/sh',
      'if [ "$1" != "show" ]; then exit 0; fi',
      'service="$2"',
      'property="$4"',
      'case "$property" in',
      '  FragmentPath) printf "%s/%s.service\\n" "$TEST_UNIT_DST" "$service" ;;',
      '  WorkingDirectory)',
      '    if [ "${TEST_BAD_WORKING_DIRECTORY:-0}" = "1" ]; then printf "/opt/legacy\\n";',
      '    elif [ "$service" = "$TEST_WEB_SERVICE" ]; then printf "%s/current/apps/web\\n" "$TEST_DEPLOY_BASE";',
      '    else printf "%s/current/apps/server\\n" "$TEST_DEPLOY_BASE"; fi ;;',
      '  EnvironmentFiles) printf "%s/shared/.env.staging (ignore_errors=no)\\n" "$TEST_DEPLOY_BASE" ;;',
      '  ExecStart)',
      '    if [ "$service" = "$TEST_API_SERVICE" ]; then printf "/usr/bin/node dist/index.js\\n";',
      '    elif [ "$service" = "$TEST_WORKER_SERVICE" ]; then printf "/usr/bin/node dist/worker.js\\n";',
      '    else printf "/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1\\n"; fi ;;',
      '  *) exit 2 ;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 });
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DEPLOY_BASE: base,
      UNIT_SRC_DIR: source,
      UNIT_DST_DIR: destination,
      API_SERVICE: services.api,
      WORKER_SERVICE: services.worker,
      WEB_SERVICE: services.web,
      TEST_UNIT_DST: destination,
      TEST_DEPLOY_BASE: base,
      TEST_API_SERVICE: services.api,
      TEST_WORKER_SERVICE: services.worker,
      TEST_WEB_SERVICE: services.web,
    };
    let result = run('bash', [installer], {
      env: { ...environment, UNIT_SNAPSHOT_DIR: firstSnapshot },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lstatSync(firstSnapshot).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(firstSnapshot, 'manifest')).mode & 0o777, 0o600);
    for (const service of Object.values(services)) {
      assert.equal(readFileSync(join(destination, `${service}.service`), 'utf8'), `new-${service}\n`);
      assert.equal(readFileSync(join(firstSnapshot, `${service}.service`), 'utf8'), `legacy-${service}\n`);
      assert.equal(readFileSync(join(firstSnapshot, `${service}.enabled`), 'utf8'), 'disabled\n');
    }
    result = run('bash', [installer, '--restore'], {
      env: { ...environment, UNIT_SNAPSHOT_DIR: firstSnapshot },
    });
    assert.equal(result.status, 0, result.stderr);
    for (const service of Object.values(services)) {
      assert.equal(readFileSync(join(destination, `${service}.service`), 'utf8'), `legacy-${service}\n`);
    }

    result = run('bash', [installer], {
      env: {
        ...environment,
        UNIT_SNAPSHOT_DIR: failedSnapshot,
        TEST_BAD_WORKING_DIRECTORY: '1',
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /WorkingDirectory does not target the current release/u);
    assert.match(result.stderr, /Install failed; restoring previous unit files/u);
    for (const service of Object.values(services)) {
      assert.equal(readFileSync(join(destination, `${service}.service`), 'utf8'), `legacy-${service}\n`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('root gate install and deployment source ownership are fail-closed', {
  skip: !linuxRoot,
}, () => {
  const root = mkdtempSync('/opt/ss-erp-deploy-source-test-');
  const source = join(root, 'source');
  const scripts = join(source, 'scripts');
  const gateRoot = join(root, 'gate');
  const required = [
    'deploy-backup-gate.mjs',
    'deploy-backup-attestation.mjs',
    'deploy-database-identity.mjs',
    'postgres-connection-environment.mjs',
    'deploy-environment.mjs',
    'deploy-maintenance-gate.sh',
    'deploy-source-manifest.mjs',
    'freeze-deploy-source.sh',
    'git-commit-tree.mjs',
    'verify-deploy-build-inputs.mjs',
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
    mkdirSync(join(release, 'apps', 'web', '.next'), { recursive: true });
    mkdirSync(join(release, 'build', 'extensions'), { recursive: true });
    writeFileSync(join(release, 'apps', 'server', 'mutable.js'), 'data\n');
    writeFileSync(join(release, 'build', 'extensions', 'release.zip'), 'sealed release\n');
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

    const nobody = run('id', ['-un', '65534']);
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
      if (nobody.status === 0) {
        const nobodyName = nobody.stdout.trim();
        const nobodyGroup = run('id', ['-g', nobodyName]);
        assert.equal(nobodyGroup.status, 0, nobodyGroup.stderr);
        chmodSync(root, 0o755);
        chownSync(join(sealed, '.env.staging'), 0, Number(nobodyGroup.stdout.trim()));
        chmodSync(join(sealed, '.env.staging'), 0o640);
        result = run('bash', [freeze, 'verify', commit, sealed]);
        assert.equal(result.status, 0, result.stderr);
        result = run('runuser', [
          '-u', nobodyName, '--', 'test', '-r', join(sealed, '.env.staging'),
        ]);
        assert.equal(result.status, 0, 'the runtime group must retain read access to the frozen env');
        result = run('runuser', [
          '-u', nobodyName, '--', 'mv', join(sealed, 'build'), join(sealed, 'build-replaced'),
        ]);
        assert.notEqual(result.status, 0, 'the runtime user must not replace the sealed build parent');
        assert.equal(lstatSync(join(sealed, 'build', 'extensions')).isDirectory(), true);

        const inlineCache = join(sealed, 'apps', 'web', '.next', 'cache');
        mkdirSync(inlineCache, { mode: 0o750 });
        chownSync(inlineCache, 65534, Number(nobodyGroup.stdout.trim()));
        writeFileSync(join(inlineCache, 'runtime.bin'), 'cache\n');
        chownSync(join(inlineCache, 'runtime.bin'), 65534, Number(nobodyGroup.stdout.trim()));
        result = run('bash', [freeze, 'verify', commit, sealed]);
        assert.equal(
          result.status,
          0,
          'an exact disposable runtime cache must not invalidate the frozen source',
        );
        rmSync(inlineCache, { recursive: true });
        const externalCache = join(root, 'external-web-cache');
        mkdirSync(externalCache, { mode: 0o750 });
        chownSync(externalCache, 65534, Number(nobodyGroup.stdout.trim()));
        symlinkSync(externalCache, inlineCache, 'dir');
        result = run('bash', [freeze, 'verify', commit, sealed]);
        assert.equal(result.status, 0, 'a root-installed external Web cache link must remain valid');
      }
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

test('persistent maintenance gate survives the deploy process and is idempotent', {
  skip: !linuxRoot || !existsSync('/.dockerenv'),
}, () => {
  const root = mkdtempSync('/opt/ss-erp-maintenance-test-');
  const bin = join(root, 'bin');
  const log = join(root, 'systemctl.log');
  const suffix = String(process.pid);
  const services = [
    `ss-erp-test-${suffix}-worker.service`,
    `ss-erp-test-${suffix}-api.service`,
    `ss-erp-test-${suffix}-web.service`,
  ];
  const runtimeRoot = join(root, 'runtime-root');
  const deployRoot = join(root, 'deploy-root');
  const marker = '/var/lib/ss-erp-deploy-maintenance/in-place-staging';
  const helper = join(process.cwd(), 'scripts', 'deploy-maintenance-gate.sh');
  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SYSTEMCTL_LOG: log,
  };
  try {
    mkdirSync(bin);
    mkdirSync(deployRoot);
    writeFileSync(join(bin, 'systemctl'), [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$SYSTEMCTL_LOG"',
      '[ "$1" = "is-active" ] && exit 3',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o700 });
    let result = run('bash', [
      helper, 'enter', ...services, join(root, 'not-a-sibling', 'runtime'), deployRoot,
    ], { env: environment });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canonical sibling/u);
    for (const mode of ['enter', 'enter', 'verify']) {
      result = run('bash', [
        helper, mode, ...services, runtimeRoot, deployRoot,
      ], { env: environment });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(readFileSync(marker, 'utf8'), [
      'schemaVersion=1',
      `worker=${services[0]}`,
      `api=${services[1]}`,
      `web=${services[2]}`,
      `runtimeRoot=${runtimeRoot}`,
      `deployRoot=${deployRoot}`,
      '',
    ].join('\n'));
    const applicationWritablePaths = [
      'uploads', 'watermarked', 'resized', 'public-tmp', 'backups',
    ].map((name) => `${runtimeRoot}/${name}`).join(' ');
    for (const [service, writablePath] of [
      [services[0], applicationWritablePaths],
      [services[1], applicationWritablePaths],
      [services[2], `${runtimeRoot}/web-cache`],
    ]) {
      assert.equal(
        readFileSync(`/etc/systemd/system/${service}.d/10-ss-erp-deploy-maintenance.conf`, 'utf8'),
        '[Unit]\nConditionPathExists=!/var/lib/ss-erp-deploy-maintenance/in-place-staging\n\n'
          + `[Service]\nReadWritePaths=${writablePath}\n`,
      );
    }
    result = run('bash', [
      helper, 'leave', ...services, runtimeRoot, deployRoot,
    ], { env: environment });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    assert.match(readFileSync(log, 'utf8'), /stop .*worker\.service .*api\.service .*web\.service/u);
  } finally {
    rmSync(marker, { force: true });
    for (const service of services) {
      rmSync(`/etc/systemd/system/${service}.d`, { recursive: true, force: true });
    }
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
