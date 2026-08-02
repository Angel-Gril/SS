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
  const healthIndex = deploy.indexOf('deploy-health-check.sh" "$HEALTH_URL"');
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
  const systemdInstallerCalls = deploy.match(
    /(?:if ! )?env DEPLOY_BASE="\$\(dirname -- "\$CURRENT_LINK"\)"[\s\S]*?install-release-systemd\.sh"(?: --restore)?/gu,
  ) || [];
  assert.equal(
    systemdInstallerCalls.length,
    2,
    'install and rollback must pass readonly deployment inputs through env',
  );
  assert.match(deploy, /SSH_ARGS\+=\(-F "\$SSH_CONFIG_FILE"\)/u);
  assert.doesNotMatch(deploy, /eval .*SSH|ProxyCommand=/u);
  assert.match(installer, /systemd-analyze verify/u);
  assert.match(installer, /FragmentPath does not use the installed release unit/u);
  assert.match(installer, /WorkingDirectory does not target the current release/u);
  assert.match(installer, /does not use the shared release environment/u);
  assert.match(installer, /Install failed; restoring previous unit files/u);
});

test('all systemd deployment entrypoints use the bounded health retry contract', () => {
  const helper = readFileSync(
    join(process.cwd(), 'scripts', 'deploy-health-check.sh'),
    'utf8',
  );
  assert.match(helper, /readonly MAX_ATTEMPTS=30/u);
  assert.match(helper, /readonly RETRY_DELAY_SECONDS=1/u);
  assert.match(helper, /curl --silent --show-error --max-time 2/u);
  assert.match(helper, /--write-out '%\{http_code\}'/u);
  assert.match(helper, /allowed_statuses="\$\{2:-200\}"/u);
  assert.match(helper, /"\$attempt" -ge "\$MAX_ATTEMPTS"/u);
  assert.doesNotMatch(helper, /MAX_ATTEMPTS="\$\{/u);

  for (const scriptName of ['deploy.sh', 'deploy-app-dir.sh', 'deploy-staging.sh', 'rollback.sh']) {
    const deploy = readFileSync(join(process.cwd(), 'scripts', scriptName), 'utf8');
    if (scriptName === 'rollback.sh') {
      assert.match(deploy, /local max_attempts=30/u);
      assert.match(deploy, /local retry_delay_seconds=1/u);
      assert.match(deploy, /curl --silent --show-error --max-time 2[\s\S]{0,120}--write-out '%\{http_code\}'/u);
      assert.doesNotMatch(deploy, /sleep 3[\s\S]{0,800}curl -fsS "\$HEALTH_URL"/u);
    } else {
      assert.match(
        deploy,
        scriptName === 'deploy-staging.sh'
          ? /deploy-health-check\.sh" "\$[A-Z_]+_URL"/u
          : /run_health_check "\$[A-Z_]+\/scripts\/deploy-health-check\.sh" "\$HEALTH_URL" "200"/u,
        `${scriptName} must use the bounded health retry helper`,
      );
      assert.doesNotMatch(
        deploy,
        /sleep 3[\s\S]{0,800}curl -fsS "\$HEALTH_URL"/u,
        `${scriptName} must not retain the fixed-delay single health probe`,
      );
      if (scriptName !== 'deploy-staging.sh') {
        assert.match(
          deploy,
          /if \[ -f "\$helper" \][\s\S]{0,500}max_attempts=30/u,
          `${scriptName} must retain a fallback for pre-helper target releases`,
        );
      }
    }
  }
  const staging = readFileSync(join(process.cwd(), 'scripts', 'deploy-staging.sh'), 'utf8');
  assert.match(staging, /deploy-health-check\.sh" "\$HEALTH_URL" "200"/u);
  assert.match(staging, /deploy-health-check\.sh" "\$WEB_HEALTH_URL" "200,302"/u);
});

test('staging re-enters persistent maintenance when post-leave health fails', () => {
  const staging = readFileSync(join(process.cwd(), 'scripts', 'deploy-staging.sh'), 'utf8');
  assert.match(staging, /MAINTENANCE_GATE_COMMIT=""/u);
  assert.match(
    staging,
    /assert_installed_target_backup_gate "\$CURRENT_GIT_COMMIT"\r?\nMAINTENANCE_GATE_COMMIT="\$CURRENT_GIT_COMMIT"/u,
  );
  assert.match(
    staging,
    /assert_installed_target_backup_gate "\$TARGET_GIT_COMMIT"\r?\nMAINTENANCE_GATE_COMMIT="\$TARGET_GIT_COMMIT"/u,
  );
  assert.match(
    staging,
    /local maintenance_commit="\$MAINTENANCE_GATE_COMMIT"[\s\S]{0,700}deploy-maintenance-gate\.sh" \\\r?\n\s+enter[\s\S]{0,350}deploy-maintenance-gate\.sh" \\\r?\n\s+verify/u,
  );
  assert.match(staging, /persistent maintenance could not be restored/u);
  assert.doesNotMatch(staging, /maintenance_commit="\$\{TARGET_GIT_COMMIT/u);
});

test('bounded deployment health retry succeeds on recovery and stops at its fixed limit', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join('/tmp', 'ss-erp-deploy-health-test-'));
  const bin = join(root, 'bin');
  const state = join(root, 'attempts');
  const helper = join(process.cwd(), 'scripts', 'deploy-health-check.sh');
  try {
    mkdirSync(bin);
    writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'curl'), [
      '#!/bin/sh',
      'attempts=0',
      '[ ! -f "$TEST_HEALTH_STATE" ] || attempts="$(cat "$TEST_HEALTH_STATE")"',
      'attempts=$((attempts + 1))',
      'printf "%s\\n" "$attempts" > "$TEST_HEALTH_STATE"',
      'if [ "$attempts" -le "${TEST_HEALTH_TRANSPORT_FAILURES:-0}" ]; then exit 7; fi',
      'status="${TEST_HEALTH_STATUS_BEFORE:-503}"',
      'if [ "$attempts" -ge "${TEST_HEALTH_SUCCESS_AT:-999}" ]; then status="${TEST_HEALTH_STATUS_AFTER:-200}"; fi',
      'printf "%s" "$status"',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_HEALTH_STATE: state,
      TEST_HEALTH_SUCCESS_AT: '3',
    };
    let result = run('bash', [helper, 'http://127.0.0.1:3001/ready'], {
      env: { ...environment, TEST_HEALTH_STATUS_AFTER: '200' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS after 3 attempt\(s\) \(HTTP 200\)/u);
    assert.equal(readFileSync(state, 'utf8'), '3\n');

    rmSync(state);
    result = run('bash', [helper, 'http://127.0.0.1:3001/ready'], {
      env: {
        ...environment,
        TEST_HEALTH_SUCCESS_AT: '1',
        TEST_HEALTH_STATUS_AFTER: '200',
        TEST_HEALTH_TRANSPORT_FAILURES: '2',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /attempt 1 returned HTTP 000/u);
    assert.match(result.stdout, /PASS after 3 attempt\(s\) \(HTTP 200\)/u);
    assert.equal(readFileSync(state, 'utf8'), '3\n');

    rmSync(state);
    result = run('bash', [helper, 'http://127.0.0.1:3001/ready'], {
      env: { ...environment, TEST_HEALTH_SUCCESS_AT: '31', TEST_HEALTH_STATUS_AFTER: '200' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /failed after 30 attempts/u);
    assert.equal(readFileSync(state, 'utf8'), '30\n');

    rmSync(state);
    result = run('bash', [helper, 'http://127.0.0.1:3001/ready'], {
      env: { ...environment, TEST_HEALTH_SUCCESS_AT: '1', TEST_HEALTH_STATUS_AFTER: '204' },
    });
    assert.notEqual(result.status, 0, 'API readiness must reject HTTP 204');
    assert.equal(readFileSync(state, 'utf8'), '30\n');

    rmSync(state);
    result = run('bash', [helper, 'http://127.0.0.1:3000', '200,302'], {
      env: { ...environment, TEST_HEALTH_SUCCESS_AT: '1', TEST_HEALTH_STATUS_AFTER: '302' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HTTP 302/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release extraction discards local archive ownership before installing the trusted gate', () => {
  const deploy = readFileSync(join(process.cwd(), 'scripts', 'deploy.sh'), 'utf8');
  const extractionIndex = deploy.indexOf(
    'tar -xzf "$TARBALL" -C "$RELEASE_DIR" --strip-components=1 --no-same-owner',
  );
  const gateIndex = deploy.indexOf('install_target_backup_gate "$RELEASE_DIR"');
  assert.ok(extractionIndex >= 0, 'release extraction must ignore uploader UID/GID metadata');
  assert.ok(gateIndex > extractionIndex, 'root-owned extraction must precede trusted gate install');
});

test('isolated deployment builds use an explicit writable pnpm store', () => {
  for (const scriptName of ['deploy.sh', 'deploy-app-dir.sh', 'deploy-staging.sh']) {
    const deploy = readFileSync(join(process.cwd(), 'scripts', scriptName), 'utf8');
    assert.match(
      deploy,
      /pnpm install --frozen-lockfile(?: --force)?[\s\\]+--store-dir "\$DEPLOY_BUILD_HOME\/pnpm-store"/u,
      `${scriptName} must not make pnpm probe the root-owned deployment directory`,
    );
  }
});

test('deployment build stores use one locked root-owned disk parent while env snapshots remain memory-backed', () => {
  const initializer = readFileSync(join(process.cwd(), 'scripts', 'init-server.sh'), 'utf8');
  assert.match(
    initializer,
    /DEPLOY_BUILD_ROOT="\$\{DEPLOY_BUILD_ROOT:-\/var\/lib\/ss-erp-deploy-build\}"/u,
    'initializer must provision the fixed deployment build root',
  );
  assert.match(
    initializer,
    /install -d -o root -g root -m 0711 "\$DEPLOY_BUILD_ROOT"/u,
    'build root must not be writable by either deployment identity',
  );
  assert.match(
    initializer,
    /tmpfs\|ramfs\) fail "deployment build root must use a disk-backed filesystem"/u,
    'initializer must reject memory-backed build roots',
  );
  assert.match(
    initializer,
    /install -o root -g "\$DEPLOY_GROUP" -m 0660 \/dev\/null "\$DEPLOY_BUILD_LOCK_FILE"/u,
    'initializer must provision the shared systemd-deployment lock',
  );

  for (const scriptName of ['deploy.sh', 'deploy-app-dir.sh', 'deploy-staging.sh']) {
    const deploy = readFileSync(join(process.cwd(), 'scripts', scriptName), 'utf8');
    assert.match(
      deploy,
      /DEPLOY_ENV_SNAPSHOT_DIR="\$\((?:sudo )?mktemp -d \/run\/ss-erp-deploy-env\.XXXXXXXXXX\)"/u,
      `${scriptName} must retain the secret environment snapshot under /run`,
    );
    assert.match(
      deploy,
      /DEPLOY_BUILD_HOME="\$\((?:sudo )?mktemp -d "\$DEPLOY_BUILD_ROOT\/ss-erp-build-home\.XXXXXXXXXX"\)"/u,
      `${scriptName} must place the non-secret build store beneath the protected parent`,
    );
    assert.doesNotMatch(
      deploy,
      /DEPLOY_BUILD_HOME="\$\((?:sudo )?mktemp -d \/run\//u,
      `${scriptName} must not consume the bounded /run tmpfs with the pnpm store`,
    );
    assert.match(
      deploy,
      /exec 9<>"\$DEPLOY_BUILD_LOCK_FILE"[\s\S]{0,80}flock -n 9/u,
      `${scriptName} must hold the shared lock for the deployment lifetime`,
    );
    assert.match(
      deploy,
      /remove_stale_deploy_build_homes[\s\S]+rm -rf --one-file-system -- "\$entry"/u,
      `${scriptName} must remove only validated stale build homes while locked`,
    );
    assert.match(
      deploy,
      /chown "\$DEPLOY_BUILD_USER:\$DEPLOY_BUILD_GROUP" "\$DEPLOY_BUILD_HOME"[\s\S]{0,80}chmod 0700 "\$DEPLOY_BUILD_HOME"/u,
      `${scriptName} must isolate the build home to the dedicated build identity`,
    );
    assert.match(
      deploy,
      /rm -rf -- "\$DEPLOY_BUILD_HOME"/u,
      `${scriptName} must remove the build home from its exit cleanup`,
    );
  }
});

test('initializer prevents the build identity from renaming its persistent build home', {
  skip: !linuxRoot,
}, () => {
  const root = mkdtempSync('/root/ss-erp-deploy-build-root-test-');
  const bin = join(root, 'bin');
  const buildRoot = join(root, 'deploy-build');
  const buildHome = join(buildRoot, 'ss-erp-build-home.ABCDEFGHIJ');
  try {
    mkdirSync(bin);
    writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o700 });
    const result = run('bash', [join(process.cwd(), 'scripts', 'init-server.sh')], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DEPLOY_BASE: join(root, 'deploy'),
        DEPLOY_USER: 'nobody',
        DEPLOY_BUILD_ROOT: buildRoot,
        ENV_FILE_NAME: '.env.staging',
        EXTENSION_RELEASE_BASE: join(root, 'extension-releases'),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(lstatSync(buildRoot).uid, 0);
    assert.equal(lstatSync(buildRoot).mode & 0o777, 0o711);
    const lock = lstatSync(join(buildRoot, 'deploy.lock'));
    assert.equal(lock.uid, 0);
    assert.equal(lock.gid, Number(run('id', ['-g', 'nobody']).stdout.trim()));
    assert.equal(lock.mode & 0o777, 0o660);
    assert.equal(lock.nlink, 1);
    const lockPath = join(buildRoot, 'deploy.lock');
    const lockContention = run('runuser', [
      '-u', 'nobody', '--', 'bash', '-c',
      'exec 9<>"$1"; flock -n 9; ! flock -n "$1" -c true',
      'lock-test', lockPath,
    ]);
    assert.equal(lockContention.status, 0, lockContention.stderr);

    mkdirSync(buildHome, { mode: 0o700 });
    const buildIdentity = 'ss-erp-build';
    const buildUid = Number(run('id', ['-u', buildIdentity]).stdout.trim());
    const buildGid = Number(run('id', ['-g', buildIdentity]).stdout.trim());
    chownSync(buildHome, buildUid, buildGid);
    const rename = run('runuser', [
      '-u', buildIdentity, '--', 'mv', buildHome, `${buildHome}.escaped`,
    ]);
    assert.notEqual(rename.status, 0, 'build identity must not rename its root-owned parent entry');
    assert.equal(existsSync(buildHome), true);
    assert.equal(existsSync(`${buildHome}.escaped`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    mkdirSync(join(release, 'node_modules'), { mode: 0o700 });
    writeFileSync(
      join(release, 'node_modules', '.pnpm-workspace-state-v1.json'),
      '{}\n',
      { mode: 0o600 },
    );
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
    assert.equal(nobody.status, 0, nobody.stderr);
    const nobodyName = nobody.stdout.trim();
    const nobodyGroup = run('id', ['-g', nobodyName]);
    assert.equal(nobodyGroup.status, 0, nobodyGroup.stderr);
    const mutable = join(release, 'apps', 'server', 'mutable.js');
    const sealed = join(root, 'sealed-release');
    const oldDescriptor = openSync(mutable, 'r+');
    try {
      result = run('bash', [
        freeze,
        'seal',
        commit,
        release,
        sealed,
        nobodyName,
        '.env.staging',
      ]);
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
        chmodSync(root, 0o755);
        result = run('bash', [freeze, 'verify', commit, sealed]);
        assert.equal(result.status, 0, result.stderr);
        result = run('runuser', [
          '-u', nobodyName, '--', 'test', '-r', join(sealed, '.env.staging'),
        ]);
        assert.equal(result.status, 0, 'the runtime group must retain read access to the frozen env');
        result = run('runuser', [
          '-u',
          nobodyName,
          '--',
          'test',
          '-r',
          join(sealed, 'node_modules', '.pnpm-workspace-state-v1.json'),
        ]);
        assert.equal(result.status, 0, 'the runtime user must read sealed pnpm workspace state');
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
        DEPLOY_BUILD_ROOT: join(root, 'deploy-build'),
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
        DEPLOY_BUILD_ROOT: join(root, 'deploy-build'),
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
