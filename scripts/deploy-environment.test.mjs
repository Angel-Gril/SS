import assert from 'node:assert/strict';
import {
  chmodSync,
  chownSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const helper = join(process.cwd(), 'scripts', 'deploy-environment.mjs');

function run(args, env = process.env) {
  return spawnSync(process.execPath, [helper, ...args], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
}

test('deployment environment is snapshotted and executed as data', () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-erp-deploy-env-'));
  const privateDirectory = join(root, 'private');
  mkdirSync(privateDirectory, { mode: 0o700 });
  chmodSync(privateDirectory, 0o700);
  const source = join(root, 'source.env');
  const snapshot = join(privateDirectory, 'environment.env');
  writeFileSync(source, 'SAFE_VALUE="literal value"\nMIGRATION_TIMEOUT=15m\n', { mode: 0o600 });
  chmodSync(source, 0o600);
  try {
    assert.equal(run(['snapshot', source, snapshot]).status, 0);
    const composeSource = join(root, 'compose.yml');
    const composeSnapshot = join(privateDirectory, 'compose.yml');
    writeFileSync(composeSource, 'services:\n  api:\n    image: ss-erp:test\n', { mode: 0o600 });
    chmodSync(composeSource, 0o600);
    assert.equal(run(['snapshot-file', composeSource, composeSnapshot]).status, 0);
    assert.equal(readFileSync(composeSnapshot, 'utf8'), readFileSync(composeSource, 'utf8'));
    assert.equal(run(['compare', source, snapshot]).status, 0);
    const read = run(['value', snapshot, 'MIGRATION_TIMEOUT']);
    assert.equal(read.status, 0);
    assert.equal(read.stdout, '15m');
    const executed = run([
      'exec-check', snapshot, root, '--', process.execPath, '-e',
      'process.stdout.write(process.env.SAFE_VALUE || "")',
    ]);
    assert.equal(executed.status, 0);
    assert.equal(executed.stdout, 'literal value');
    const buildEnvironment = run([
      'exec-build', snapshot, root, '--', process.execPath, '-e',
      'process.stdout.write(`${process.env.SAFE_VALUE || ""}|${process.env.DATABASE_URL || ""}`)',
    ]);
    assert.equal(buildEnvironment.status, 0);
    assert.match(buildEnvironment.stdout, /^\|postgresql:\/\/deploy_build:/u);
    writeFileSync(source, 'SAFE_VALUE=changed\n', { mode: 0o600 });
    chmodSync(source, 0o600);
    assert.notEqual(run(['compare', source, snapshot]).status, 0);

    const duplicate = join(root, 'duplicate.env');
    writeFileSync(duplicate, 'SAFE_VALUE=one\n export SAFE_VALUE=two\n', { mode: 0o600 });
    chmodSync(duplicate, 0o600);
    assert.notEqual(run(['value', duplicate, 'SAFE_VALUE']).status, 0);

    const processControl = join(root, 'process-control.env');
    writeFileSync(processControl, 'PATH=/untrusted\n', { mode: 0o600 });
    chmodSync(processControl, 0o600);
    assert.notEqual(run(['value', processControl, 'PATH']).status, 0);

    if (process.platform !== 'win32') {
      const link = join(root, 'environment-link');
      symlinkSync(source, link);
      assert.notEqual(run(['value', link, 'SAFE_VALUE']).status, 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('root executes builds as an isolated non-root identity without runtime secrets', {
  skip: process.platform === 'win32'
    || typeof process.geteuid !== 'function'
    || process.geteuid() !== 0,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-erp-deploy-build-identity-'));
  const buildUid = 41_001;
  const buildGid = 41_002;
  const runtimeGid = 41_003;
  const work = join(root, 'work');
  const home = join(root, 'home');
  const snapshot = join(root, 'environment.env');
  const secret = join(root, 'runtime.secret');
  const output = join(work, 'build-output.txt');
  try {
    chmodSync(root, 0o755);
    mkdirSync(work, { mode: 0o755 });
    mkdirSync(home, { mode: 0o700 });
    chownSync(work, buildUid, buildGid);
    chownSync(home, buildUid, buildGid);
    writeFileSync(snapshot, 'NODE_ENV=production\nRUNTIME_SECRET=must-not-leak\n', { mode: 0o640 });
    writeFileSync(secret, 'runtime-only\n', { mode: 0o640 });
    chownSync(snapshot, 0, runtimeGid);
    chownSync(secret, 0, runtimeGid);
    chmodSync(snapshot, 0o640);
    chmodSync(secret, 0o640);

    const child = `
      const fs = require('node:fs');
      const canRead = (file) => {
        try { fs.readFileSync(file); return true; } catch { return false; }
      };
      fs.writeFileSync(${JSON.stringify(output)}, 'built');
      process.stdout.write(JSON.stringify({
        uid: process.getuid(),
        gid: process.getgid(),
        groups: process.getgroups(),
        snapshotReadable: canRead(${JSON.stringify(snapshot)}),
        secretReadable: canRead(${JSON.stringify(secret)}),
        runtimeSecret: process.env.RUNTIME_SECRET || null,
        databaseUrl: process.env.DATABASE_URL || null,
      }));
    `;
    const executed = run([
      'exec-build-as', snapshot, work, String(buildUid), String(buildGid), home,
      '--', process.execPath, '-e', child,
    ]);
    assert.equal(executed.status, 0, executed.stderr);
    const result = JSON.parse(executed.stdout);
    assert.equal(result.uid, buildUid);
    assert.equal(result.gid, buildGid);
    assert.ok(!result.groups.includes(0), 'build child must not retain the root group');
    assert.ok(
      !result.groups.includes(runtimeGid),
      'build child must not retain the runtime group',
    );
    assert.equal(result.snapshotReadable, false);
    assert.equal(result.secretReadable, false);
    assert.equal(result.runtimeSecret, null);
    assert.match(result.databaseUrl, /^postgresql:\/\/deploy_build:/u);
    assert.equal(readFileSync(output, 'utf8'), 'built');
    const outputMetadata = statSync(output);
    assert.equal(outputMetadata.uid, buildUid);
    assert.equal(outputMetadata.gid, buildGid);
    assert.equal(outputMetadata.mode & 0o777, 0o644);

    assert.notEqual(run([
      'exec-build-as', snapshot, work, '0', String(buildGid), home,
      '--', process.execPath, '-e', '',
    ]).status, 0);
    assert.notEqual(run([
      'exec-build-as', snapshot, work, String(buildUid), '0', home,
      '--', process.execPath, '-e', '',
    ]).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
