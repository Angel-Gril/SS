import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  collectProtectedBackupFiles,
  pruneBackupRetention,
} from './prune-backup-retention.mjs';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const CURRENT_COMMIT = 'a'.repeat(40);

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'ss-erp-backup-retention-'));
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
  const latest = 'ss_erp_20260820_031501.sql.gz';
  const attested = 'ss_erp_20260820_084502.sql.gz';
  const orphan = 'ss_erp_20260819_031501.sql.gz';
  for (const filename of [latest, attested, orphan]) {
    writeFileSync(path.join(directory, filename), `fixture ${filename}\n`);
    writeFileSync(path.join(directory, `${filename}.status.json`), '{}\n');
    const old = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000);
    utimesSync(path.join(directory, filename), old, old);
    utimesSync(path.join(directory, `${filename}.status.json`), old, old);
  }
  writeFileSync(path.join(directory, 'backup-status.json'), canonical({
    schemaVersion: 3,
    lastLocalFile: latest,
  }));
  writeFileSync(
    path.join(directory, `deploy-backup-${CURRENT_COMMIT}.attestation.json`),
    canonical({
      schemaVersion: 2,
      kind: 'SS_ERP_DEPLOY_BACKUP_ATTESTATION',
      targetGitCommit: CURRENT_COMMIT,
      backup: { filename: attested },
    }),
  );
  return { directory, latest, attested, orphan };
}

test('retains latest and deployment-attested backups while pruning expired orphans', () => {
  const value = fixture();
  try {
    assert.deepEqual(collectProtectedBackupFiles(value.directory), [
      value.latest,
      `${value.latest}.status.json`,
      value.attested,
      `${value.attested}.status.json`,
    ].sort());
    const result = pruneBackupRetention({ directory: value.directory, keepDays: 7, now: NOW });
    assert.deepEqual(result.deleted, [value.orphan, `${value.orphan}.status.json`].sort());
    assert.equal(existsSync(path.join(value.directory, value.latest)), true);
    assert.equal(existsSync(path.join(value.directory, value.attested)), true);
    assert.equal(existsSync(path.join(value.directory, value.orphan)), false);
  } finally {
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('fails closed before deletion when a deployment attestation is malformed', () => {
  const value = fixture();
  try {
    writeFileSync(
      path.join(value.directory, `deploy-backup-${'b'.repeat(40)}.attestation.json`),
      '{"schemaVersion":2,"kind":"unexpected"}\n',
    );
    assert.throws(
      () => pruneBackupRetention({ directory: value.directory, keepDays: 7, now: NOW }),
      /canonical JSON|valid deployment backup attestation/u,
    );
    assert.equal(existsSync(path.join(value.directory, value.orphan)), true);
    assert.equal(existsSync(path.join(value.directory, `${value.orphan}.status.json`)), true);
  } finally {
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('does not prune files inside a symlinked or broadly writable backup root', (t) => {
  const value = fixture();
  const parent = mkdtempSync(path.join(tmpdir(), 'ss-erp-backup-retention-link-'));
  const link = path.join(parent, 'linked');
  try {
    if (process.platform !== 'win32') chmodSync(parent, 0o700);
    try {
      symlinkSync(value.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(
        () => pruneBackupRetention({ directory: link, keepDays: 7, now: NOW }),
        /canonical non-symlink/u,
      );
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
      t.skip('platform does not permit an unprivileged directory symlink');
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('CLI runs through a symlinked release directory and emits its deletion count', (t) => {
  const value = fixture();
  const parent = mkdtempSync(path.join(tmpdir(), 'ss-erp-backup-retention-cli-link-'));
  const currentRelease = path.join(parent, 'current');
  const realScript = fileURLToPath(new URL('./prune-backup-retention.mjs', import.meta.url));
  try {
    if (process.platform !== 'win32') chmodSync(parent, 0o700);
    try {
      symlinkSync(
        path.dirname(realScript),
        currentRelease,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
      t.skip('platform does not permit an unprivileged directory symlink');
      return;
    }
    const result = spawnSync(process.execPath, [
      path.join(currentRelease, 'prune-backup-retention.mjs'),
      '--backup-dir',
      value.directory,
      '--keep-days',
      '7',
      '--count',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '1');
    assert.equal(existsSync(path.join(value.directory, value.orphan)), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(value.directory, { recursive: true, force: true });
  }
});
