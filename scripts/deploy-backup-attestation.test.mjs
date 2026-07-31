import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const script = path.resolve('scripts/deploy-backup-attestation.mjs');
const deployVerifier = path.resolve('scripts/verify-deploy-backup.sh');
const commit = 'a'.repeat(40);
const databaseId = 'international-primary';
const databaseIdentitySha256 = sha256(Buffer.from(`${JSON.stringify({
  schemaVersion: 1,
  databaseId,
  databaseName: 'fixture',
  databaseOid: 16384,
  databaseUuid: '123e4567-e89b-42d3-a456-426614174000',
})}\n`, 'utf8'));
const databaseUuidSha256 = sha256(Buffer.from('123e4567-e89b-42d3-a456-426614174000\n', 'utf8'));
const now = '2030-01-01T00:30:00.000Z';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'ss-erp-deploy-backup-attestation-'));
  const filename = 'ss_erp_20300101_000000.sql.gz';
  const backup = gzipSync(Buffer.from('create table public.example(id integer);\n', 'utf8'));
  const backupPath = path.join(directory, filename);
  const statusPath = `${backupPath}.status.json`;
  const attestationPath = path.join(directory, `deploy-backup-${commit}.attestation.json`);
  const proofPath = path.join(
    directory,
    `deploy-backup-${commit}.restore-proof-${'b'.repeat(24)}.json`,
  );
  writeFileSync(backupPath, backup);
  if (process.platform !== 'win32') chmodSync(backupPath, 0o600);
  const status = {
    schemaVersion: 3,
    lastBackupAt: '2030-01-01T00:00:00.000Z',
    lastLocalFile: filename,
    lastLocalSize: `${backup.length}B`,
    lastLocalBytes: backup.length,
    lastLocalSha256: sha256(backup),
    databaseId,
    databaseIdentitySha256,
    databaseUuidSha256,
    targetGitCommit: commit,
    remoteUploaded: false,
    lastRemoteKey: '',
  };
  writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  if (process.platform !== 'win32') chmodSync(statusPath, 0o600);
  return {
    directory,
    filename,
    backup,
    backupPath,
    statusPath,
    attestationPath,
    proofPath,
    status,
  };
}

function run(mode, args, { allowTestClock = true } = {}) {
  const environment = { ...process.env };
  if (allowTestClock) environment.DEPLOY_BACKUP_ATTESTATION_TEST_NOW = '1';
  else delete environment.DEPLOY_BACKUP_ATTESTATION_TEST_NOW;
  return spawnSync(process.execPath, [script, mode, ...args], {
    encoding: 'utf8',
    env: environment,
  });
}

function applyOverrides(args, overrides) {
  const result = [...args];
  for (let index = 0; index < overrides.length; index += 2) {
    const name = overrides[index];
    const existing = result.indexOf(name);
    if (existing >= 0) result[existing + 1] = overrides[index + 1];
    else result.push(name, overrides[index + 1]);
  }
  return result;
}

function recordArguments(value) {
  return [
    '--backup-dir', value.directory,
    '--backup-status', value.statusPath,
    '--output', value.attestationPath,
    '--expected-database-id', databaseId,
    '--expected-database-identity-sha256', databaseIdentitySha256,
    '--expected-database-uuid-sha256', databaseUuidSha256,
    '--expected-target-git-commit', commit,
    '--restore-proof', value.proofPath,
    '--restore-started-at', '2030-01-01T00:10:00.000Z',
    '--restore-completed-at', '2030-01-01T00:20:00.000Z',
    '--table-count', '142',
    '--now', now,
  ];
}

function record(value, overrides = []) {
  const finalArguments = applyOverrides(recordArguments(value), overrides);
  const restoreStartedAt = finalArguments[finalArguments.indexOf('--restore-started-at') + 1];
  const restoreNow = finalArguments[finalArguments.indexOf('--now') + 1];
  const restored = restoreStream(value, restoreStartedAt, restoreNow);
  if (restored.status !== 0) return restored;
  return run('record', finalArguments);
}

function restoreStream(
  value,
  restoreStartedAt = '2030-01-01T00:10:00.000Z',
  restoreNow = now,
) {
  return run('restore-stream', [
    '--backup-dir', value.directory,
    '--backup-status', value.statusPath,
    '--restore-proof', value.proofPath,
    '--expected-database-id', databaseId,
    '--expected-database-identity-sha256', databaseIdentitySha256,
    '--expected-database-uuid-sha256', databaseUuidSha256,
    '--expected-target-git-commit', commit,
    '--restore-started-at', restoreStartedAt,
    '--now', restoreNow,
  ]);
}

function verifyArguments(value) {
  return [
    '--attestation', value.attestationPath,
    '--backup-dir', value.directory,
    '--expected-database-id', databaseId,
    '--expected-database-identity-sha256', databaseIdentitySha256,
    '--expected-database-uuid-sha256', databaseUuidSha256,
    '--expected-target-git-commit', commit,
    '--max-age-minutes', '120',
    '--now', now,
  ];
}

function verify(value, overrides = []) {
  return run('verify', applyOverrides(verifyArguments(value), overrides));
}

function archiveArguments(value) {
  return [
    '--attestation', value.attestationPath,
    '--backup-dir', value.directory,
    '--expected-database-id', databaseId,
    '--expected-database-identity-sha256', databaseIdentitySha256,
    '--expected-database-uuid-sha256', databaseUuidSha256,
    '--expected-target-git-commit', commit,
  ];
}

function archive(value, overrides = []) {
  return run('archive', applyOverrides(archiveArguments(value), overrides));
}

test('records and verifies one canonical commit/database/restore-bound attestation', () => {
  const value = fixture();
  try {
    const recorded = record(value);
    assert.equal(recorded.status, 0, recorded.stderr);
    const text = readFileSync(value.attestationPath, 'utf8');
    const attestation = JSON.parse(text);
    assert.equal(text, `${JSON.stringify(attestation, null, 2)}\n`);
    assert.deepEqual(attestation, {
      schemaVersion: 2,
      kind: 'SS_ERP_DEPLOY_BACKUP_ATTESTATION',
      databaseId,
      databaseIdentitySha256,
      databaseUuidSha256,
      targetGitCommit: commit,
      backup: {
        filename: value.filename,
        createdAt: value.status.lastBackupAt,
        bytes: value.backup.length,
        sha256: sha256(value.backup),
        statusSha256: sha256(Buffer.from(`${JSON.stringify(value.status, null, 2)}\n`)),
      },
      restoreDrill: {
        status: 'PASSED',
        startedAt: '2030-01-01T00:10:00.000Z',
        completedAt: '2030-01-01T00:20:00.000Z',
        tableCount: 142,
      },
    });
    const verified = verify(value);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /PASS deploy backup attestation verified/u);

    const replay = record(value);
    assert.notEqual(replay.status, 0, 'recording must not overwrite an attestation');
  } finally {
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('archives exact attestation bytes before refreshing the same commit pointer', {
  skip: process.platform === 'win32'
    || typeof process.geteuid !== 'function'
    || process.geteuid() !== 0,
}, () => {
  const value = fixture();
  try {
    const recorded = record(value);
    assert.equal(recorded.status, 0, recorded.stderr);
    const originalBytes = readFileSync(value.attestationPath);
    const originalDigest = sha256(originalBytes);
    const archivePath = path.join(
      value.directory,
      `deploy-backup-${commit}.attestation.archived-${originalDigest}.json`,
    );

    const archived = archive(value);
    assert.equal(archived.status, 0, archived.stderr);
    assert.match(archived.stdout, /PASS deploy backup attestation archived/u);
    assert.equal(existsSync(value.attestationPath), false, 'commit pointer must be removed');
    assert.deepEqual(readFileSync(archivePath), originalBytes);
    const archiveStat = lstatSync(archivePath, { bigint: true });
    assert.equal(archiveStat.nlink, 1n);
    assert.equal(Number(archiveStat.mode & 0o777n), 0o600);

    rmSync(value.proofPath);
    const refreshed = record(value);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.deepEqual(readFileSync(value.attestationPath), originalBytes);
    assert.deepEqual(readFileSync(archivePath), originalBytes);
  } finally {
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('deployment wrapper verifies a fresh real-clock attestation', {
  skip: process.platform === 'win32',
}, () => {
  const value = fixture();
  try {
    const binDirectory = path.join(value.directory, 'bin');
    mkdirSync(binDirectory);
    const psql = path.join(binDirectory, 'psql');
    const installPsql = (databaseUuid = '123e4567-e89b-42d3-a456-426614174000') => {
      const row = `fixture\t16384\t${JSON.stringify({ databaseId, databaseUuid })}\n`;
      writeFileSync(psql, [
        '#!/usr/bin/env bash',
        `printf %s ${shellSingleQuote(row)}`,
        '',
      ].join('\n'));
      chmodSync(psql, 0o755);
    };
    installPsql();
    const current = Date.now();
    value.status.lastBackupAt = new Date(current - 3 * 60_000).toISOString();
    writeFileSync(value.statusPath, `${JSON.stringify(value.status, null, 2)}\n`);
    const recorded = record(value, [
      '--restore-started-at', new Date(current - 2 * 60_000).toISOString(),
      '--restore-completed-at', new Date(current - 60_000).toISOString(),
      '--now', new Date(current).toISOString(),
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);

    const deployed = spawnSync('bash', [deployVerifier, commit], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public',
        DEPLOY_BACKUP_LOCAL_DIR: value.directory,
        DEPLOY_DATABASE_ID: databaseId,
        DEPLOY_BACKUP_MAX_AGE_MINUTES: '120',
      },
    });
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.match(deployed.stdout, /PASS deploy backup attestation verified/u);

    installPsql('223e4567-e89b-42d3-a456-426614174000');
    const wrongDatabaseTarget = spawnSync('bash', [deployVerifier, commit], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public',
        DEPLOY_BACKUP_LOCAL_DIR: value.directory,
        DEPLOY_DATABASE_ID: databaseId,
      },
    });
    assert.notEqual(wrongDatabaseTarget.status, 0);
    assert.match(wrongDatabaseTarget.stderr, /database identity digest/u);

    installPsql();
    const excessiveTimeout = spawnSync('bash', [deployVerifier, commit], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public',
        DEPLOY_BACKUP_LOCAL_DIR: value.directory,
        DEPLOY_DATABASE_ID: databaseId,
        DEPLOY_BACKUP_VERIFY_TIMEOUT: '25h',
      },
    });
    assert.notEqual(excessiveTimeout.status, 0);
    assert.match(excessiveTimeout.stderr, /must not exceed 24 hours/u);
  } finally {
    rmSync(value.directory, { recursive: true, force: true });
  }
});

test('rejects wrong deployment identity, stale evidence, and changed backup bytes', async (t) => {
  await t.test('wrong commit or database', () => {
    const value = fixture();
    try {
      assert.equal(record(value).status, 0);
      assert.notEqual(verify(value, ['--expected-target-git-commit', 'b'.repeat(40)]).status, 0);
      assert.notEqual(verify(value, ['--expected-database-id', 'domestic-primary']).status, 0);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('stale restore', () => {
    const value = fixture();
    try {
      assert.equal(record(value).status, 0);
      const result = verify(value, ['--now', '2030-01-01T03:00:01.000Z']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /older than the deployment backup age limit/u);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('changed bytes', () => {
    const value = fixture();
    try {
      assert.equal(record(value).status, 0);
      writeFileSync(value.backupPath, gzipSync(Buffer.from('changed backup\n')));
      const result = verify(value);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /bytes or SHA-256 do not match/u);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('changed canonical status', () => {
    const value = fixture();
    try {
      assert.equal(record(value).status, 0);
      value.status.lastLocalSize = 'changed-display-size';
      writeFileSync(value.statusPath, `${JSON.stringify(value.status, null, 2)}\n`);
      const result = verify(value);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /backup status does not match/u);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('different bytes after the exact restore stream', () => {
    const value = fixture();
    try {
      const restored = restoreStream(value);
      assert.equal(restored.status, 0, restored.stderr);
      const replacement = gzipSync(Buffer.from('create table public.replacement(id integer);\n'));
      value.status.lastLocalBytes = replacement.length;
      value.status.lastLocalSha256 = sha256(replacement);
      writeFileSync(value.backupPath, replacement);
      writeFileSync(value.statusPath, `${JSON.stringify(value.status, null, 2)}\n`);
      const result = run('record', recordArguments(value));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /restore stream proof does not match/u);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });
});

test('rejects non-gzip backup bytes, noncanonical evidence, and symlink inputs', async (t) => {
  await t.test('fake gzip', () => {
    const value = fixture();
    try {
      const fake = Buffer.from('backup');
      writeFileSync(value.backupPath, fake);
      value.status.lastLocalBytes = fake.length;
      value.status.lastLocalSha256 = sha256(fake);
      writeFileSync(value.statusPath, `${JSON.stringify(value.status, null, 2)}\n`);
      const result = record(value);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /valid non-empty gzip stream/u);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('extra attestation field', () => {
    const value = fixture();
    try {
      assert.equal(record(value).status, 0);
      const attestation = JSON.parse(readFileSync(value.attestationPath, 'utf8'));
      attestation.untrusted = true;
      writeFileSync(value.attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
      assert.notEqual(verify(value).status, 0);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('symlink backup', { skip: process.platform === 'win32' }, () => {
    const value = fixture();
    try {
      const realPath = `${value.backupPath}.real`;
      writeFileSync(realPath, value.backup);
      rmSync(value.backupPath);
      symlinkSync(realPath, value.backupPath, 'file');
      const result = record(value);
      assert.notEqual(result.status, 0);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('symlink status and attestation', { skip: process.platform === 'win32' }, () => {
    const value = fixture();
    try {
      const realStatus = `${value.statusPath}.real`;
      writeFileSync(realStatus, readFileSync(value.statusPath), { mode: 0o600 });
      rmSync(value.statusPath);
      symlinkSync(realStatus, value.statusPath, 'file');
      assert.notEqual(record(value).status, 0);

      rmSync(value.statusPath);
      writeFileSync(value.statusPath, readFileSync(realStatus), { mode: 0o600 });
      assert.equal(record(value).status, 0);
      const realAttestation = `${value.attestationPath}.real`;
      writeFileSync(realAttestation, readFileSync(value.attestationPath), { mode: 0o600 });
      rmSync(value.attestationPath);
      symlinkSync(realAttestation, value.attestationPath, 'file');
      assert.notEqual(verify(value).status, 0);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('non-private backup mode', { skip: process.platform === 'win32' }, () => {
    const value = fixture();
    try {
      chmodSync(value.backupPath, 0o644);
      const result = record(value);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /private mode 0600/u);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  await t.test('group-writable evidence directory', { skip: process.platform === 'win32' }, () => {
    const value = fixture();
    try {
      chmodSync(value.directory, 0o770);
      const result = record(value);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must not be group or world writable/u);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });
});

test('rejects duplicate options, excessive age windows, and paths outside the commit binding', () => {
  const value = fixture();
  try {
    assert.equal(record(value).status, 0);

    const duplicate = run('verify', [
      ...verifyArguments(value),
      '--max-age-minutes',
      '30',
    ]);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /must be provided exactly once/u);

    const excessiveAge = verify(value, ['--max-age-minutes', '1441']);
    assert.notEqual(excessiveAge.status, 0);
    assert.match(excessiveAge.stderr, /must not exceed 1440/u);

    const outsidePath = path.join(value.directory, 'unbound.attestation.json');
    writeFileSync(outsidePath, readFileSync(value.attestationPath));
    const outside = verify(value, ['--attestation', outsidePath]);
    assert.notEqual(outside.status, 0);
    assert.match(outside.stderr, /must be exactly/u);

    const testClockDenied = run('verify', verifyArguments(value), { allowTestClock: false });
    assert.notEqual(testClockDenied.status, 0);
    assert.match(testClockDenied.stderr, /--now is available only/u);
  } finally {
    rmSync(value.directory, { recursive: true, force: true });
  }
});
