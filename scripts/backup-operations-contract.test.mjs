import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { postgresConnectionEnvironment } from './postgres-connection-environment.mjs';

const cronExample = readFileSync(new URL('./backup-db.crontab.example', import.meta.url), 'utf8');
const localDevelopment = readFileSync(
  new URL('../docs/local-development.md', import.meta.url),
  'utf8',
);
const verifier = readFileSync(new URL('./verify-vps-deploy.sh', import.meta.url), 'utf8');
const vpsExtensionReleaseVerifier = readFileSync(
  new URL('./verify-vps-extension-release.mjs', import.meta.url),
  'utf8',
);
const cloudVerifier = readFileSync(new URL('./verify-cloud-runtime.sh', import.meta.url), 'utf8');
const appDirDeployer = readFileSync(new URL('./deploy-app-dir.sh', import.meta.url), 'utf8');
const deployReadiness = readFileSync(
  new URL('./verify-deploy-readiness.sh', import.meta.url),
  'utf8',
);
const backupScript = readFileSync(new URL('./backup-db.sh', import.meta.url), 'utf8');
const backupRetention = readFileSync(
  new URL('./prune-backup-retention.mjs', import.meta.url),
  'utf8',
);
const restoreVerifier = readFileSync(
  new URL('./verify-backup-restore.sh', import.meta.url),
  'utf8',
);
const deployBackupVerifier = readFileSync(
  new URL('./verify-deploy-backup.sh', import.meta.url),
  'utf8',
);
const deployBackupGatePath = join(process.cwd(), 'scripts', 'deploy-backup-gate.mjs');
const deployBackupGate = readFileSync(deployBackupGatePath, 'utf8');
const deployDatabaseIdentityScript = join(process.cwd(), 'scripts', 'deploy-database-identity.mjs');
const emptyBootstrapVerifier = join(
  process.cwd(),
  'scripts',
  'verify-empty-bootstrap-database.mjs',
);
const deployPsqlRunner = join(process.cwd(), 'scripts', 'run-deploy-psql.mjs');
const postgresCommandRunner = join(process.cwd(), 'scripts', 'run-postgres-command.mjs');
const preflight = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8');
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const productionEnvExample = readFileSync(
  new URL('../.env.production.example', import.meta.url),
  'utf8',
);
const stagingEnvExample = readFileSync(
  new URL('../.env.staging.example', import.meta.url),
  'utf8',
);
const databaseIdentitySha256 = createHash('sha256').update(`${JSON.stringify({
  schemaVersion: 1,
  databaseId: 'fixture-primary',
  databaseName: 'fixture',
  databaseOid: 16384,
  databaseUuid: '123e4567-e89b-42d3-a456-426614174000',
})}\n`).digest('hex');
const databaseUuidSha256 = createHash('sha256')
  .update('123e4567-e89b-42d3-a456-426614174000\n')
  .digest('hex');

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function databaseIdentityRow({
  databaseId = 'fixture-primary',
  databaseName = 'fixture',
  databaseUuid = '123e4567-e89b-42d3-a456-426614174000',
} = {}) {
  return `${databaseName}\t16384\t${JSON.stringify({ databaseId, databaseUuid })}\n`;
}

test('backup and restore emit exact commit/database-bound deployment evidence', () => {
  assert.match(backupScript, /gzip -t "\$TMP_FILE"/u);
  assert.match(backupScript, /sha256sum "\$TMP_FILE"/u);
  for (const field of [
    'schemaVersion: 3',
    'lastLocalBytes',
    'lastLocalSha256',
    'databaseId',
    'databaseIdentitySha256',
    'databaseUuidSha256',
    'targetGitCommit',
  ]) {
    assert.ok(backupScript.includes(field), `backup status must retain ${field}`);
  }
  assert.ok(
    backupScript.indexOf('BACKUP_AT=') < backupScript.indexOf('run-postgres-command.mjs'),
    'backup freshness must start before the database snapshot is read',
  );
  assert.match(backupScript, /--url-env BACKUP_DB_URL --command pg_dump/u);
  assert.match(backupScript, /prune-backup-retention\.mjs/u);
  assert.doesNotMatch(backupScript, /-name "ss_erp_\*\.sql\.gz"[^\n]*-delete/u);
  assert.ok(
    backupScript.indexOf('mv -f -- "$LATEST_STATUS_TMP" "$STATUS_FILE"')
      < backupScript.indexOf('prune-backup-retention.mjs'),
    'retention must run only after the new latest status pointer is durable',
  );
  assert.match(backupRetention, /deploy-backup-/u);
  assert.match(backupRetention, /backup-status\.json/u);
  assert.match(backupRetention, /protectedFiles\.has\(entry\.name\)/u);
  assert.doesNotMatch(backupScript, /PGDATABASE="\$BACKUP_DB_URL"/u);
  assert.match(restoreVerifier, /run_postgres_url/u);
  assert.doesNotMatch(restoreVerifier, /PGDATABASE="\$(?:TEMP_DB_URL|MAINTENANCE_URL)"/u);
  const tableCountIndex = restoreVerifier.indexOf('if [ "$TABLE_COUNT" -le 0 ]');
  const attestationIndex = restoreVerifier.indexOf('deploy-backup-attestation.mjs" record');
  const archiveIndex = restoreVerifier.indexOf('deploy-backup-attestation.mjs" archive');
  assert.ok(tableCountIndex >= 0 && attestationIndex > tableCountIndex);
  assert.ok(
    archiveIndex > tableCountIndex && archiveIndex < attestationIndex,
    'an existing same-commit attestation must be archived before its current pointer is refreshed',
  );
  assert.match(restoreVerifier, /deploy-backup-attestation\.mjs" restore-stream/u);
  assert.match(restoreVerifier, /randomBytes\(32\)\.toString\("hex"\)/u);
  assert.match(restoreVerifier, /MAINTENANCE_TEMP_DB_URL/u);
  const routeMarkerCheckIndex = restoreVerifier.indexOf('\nverify_restore_route_marker\n');
  const restoreStreamIndex = restoreVerifier.indexOf('deploy-backup-attestation.mjs" restore-stream');
  assert.ok(
    routeMarkerCheckIndex >= 0 && routeMarkerCheckIndex < restoreStreamIndex,
    'the restore route must prove it can read the maintenance-route marker before restore',
  );
  const routeMarkerRecheckIndex = restoreVerifier.indexOf(
    '\nverify_restore_route_marker\n',
    routeMarkerCheckIndex + 1,
  );
  const finalDropIndex = restoreVerifier.indexOf('if ! drop_temp_database;', tableCountIndex);
  assert.ok(
    routeMarkerRecheckIndex > tableCountIndex && routeMarkerRecheckIndex < finalDropIndex,
    'the restore route marker must remain intact until the bounded maintenance-route drop',
  );
  assert.ok(
    restoreVerifier.indexOf('drop_temp_database') < attestationIndex,
    'the temporary restored database must be deleted before durable attestation',
  );
  assert.doesNotMatch(
    restoreVerifier,
    /dropdb --if-exists/u,
    'a created restore database must be proven deleted rather than treated as optionally absent',
  );
  assert.match(restoreVerifier, /显式备份文件必须与 backup-status\.json 完全一致/u);
  assert.match(deployBackupVerifier, /deploy-backup-\$\{TARGET_GIT_COMMIT\}\.attestation\.json/u);
  assert.match(deployBackupVerifier, /DEPLOY_BACKUP_ATTESTATION_TEST_NOW is forbidden/u);
  assert.match(deployBackupVerifier, /DEPLOY_DATABASE_URL="\$DATABASE_URL"/u);
  assert.doesNotMatch(deployBackupVerifier, /DEPLOY_BACKUP_LOCAL_DIR:-\$\{BACKUP_LOCAL_DIR/u);
  assert.doesNotMatch(appDirDeployer, /RUN_DB_BACKUP/u);
  assert.match(deployReadiness, /deploy-backup-attestation\.mjs/u);
  assert.match(deployReadiness, /deploy-database-identity\.mjs/u);
  assert.match(deployReadiness, /postgres-connection-environment\.mjs/u);
  assert.match(deployReadiness, /run-postgres-command\.mjs/u);
  assert.match(deployReadiness, /verify-deploy-backup\.sh/u);
  assert.match(deployBackupGate, /sameFileSnapshot\(before, openedAfter\)/u);
  assert.ok(
    deployBackupGate.includes('new RegExp(`^[ \\\\t]*(?:export[ \\\\t]+)?'),
    'deployment env duplicate detection must include leading horizontal whitespace',
  );
  for (const source of [preflight, ciWorkflow]) {
    assert.match(source, /deploy-backup-attestation\.test\.mjs/u);
    assert.match(source, /backup-operations-contract\.test\.mjs/u);
    assert.match(source, /prune-backup-retention\.test\.mjs/u);
  }
  for (const source of [productionEnvExample, stagingEnvExample]) {
    assert.match(source, /^DEPLOY_BACKUP_LOCAL_DIR=\/var\/backups\/ss-erp$/mu);
    assert.doesNotMatch(
      source,
      /^BACKUP_LOCAL_DIR=/mu,
      'application env must not redirect the independently managed service backup directory',
    );
  }
});

test('PostgreSQL URLs become discrete libpq fields without retaining Prisma parameters', () => {
  const environment = postgresConnectionEnvironment(
    'postgresql://user:top-secret@db.example:5433/fixture?schema=public&connection_limit=5&sslmode=require',
    { applicationName: 'contract-test' },
  );
  assert.deepEqual(environment, {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    LANG: 'C.UTF-8',
    PGHOST: 'db.example',
    PGPORT: '5433',
    PGDATABASE: 'fixture',
    PGUSER: 'user',
    PGPASSWORD: 'top-secret',
    PGAPPNAME: 'contract-test',
    PGSSLMODE: 'require',
  });
  assert.throws(
    () => postgresConnectionEnvironment('postgresql://user:secret@db.example/fixture?unknown=value'),
    /unsupported/u,
  );
  assert.throws(
    () => postgresConnectionEnvironment('postgresql://user:secret@db.example/fixture?sslmode=require&sslmode=prefer'),
    /duplicated/u,
  );
  for (const encoded of ['a+b', 'a%2Bb']) {
    const parsed = postgresConnectionEnvironment(
      `postgresql://user:secret@db.example/fixture?application_name=${encoded}`,
    );
    assert.equal(parsed.PGAPPNAME, 'a+b');
  }
  assert.throws(
    () => postgresConnectionEnvironment('postgresql://user:secret@db.example/fixture?sslmode=%'),
    /canonically encoded/u,
  );
});

test('root deployment gate rejects whitespace-prefixed duplicate required env keys', {
  skip: process.platform === 'win32'
    || typeof process.geteuid !== 'function'
    || process.geteuid() !== 0,
}, () => {
  const gateDirectory = mkdtempSync(join(tmpdir(), 'ss-erp-deploy-gate-'));
  const targetCommit = 'a'.repeat(40);
  try {
    chmodSync(gateDirectory, 0o700);
    for (const name of [
      'deploy-backup-gate.mjs',
      'deploy-backup-attestation.mjs',
      'deploy-database-identity.mjs',
      'postgres-connection-environment.mjs',
      'deploy-environment.mjs',
      'deploy-source-manifest.mjs',
      'freeze-deploy-source.sh',
      'verify-deploy-backup.sh',
    ]) {
      writeFileSync(
        join(gateDirectory, name),
        name === 'deploy-backup-gate.mjs'
          ? readFileSync(deployBackupGatePath)
          : '# trusted fixture\n',
        { mode: 0o500 },
      );
    }
    writeFileSync(join(gateDirectory, 'TARGET_GIT_COMMIT'), `${targetCommit}\n`, {
      mode: 0o400,
    });
    const envFile = join(gateDirectory, 'deployment.env');
    writeFileSync(envFile, [
      'DATABASE_URL=postgresql://first:secret@127.0.0.1:5432/fixture',
      ' DATABASE_URL=postgresql://second:secret@127.0.0.1:5432/fixture',
      'DEPLOY_DATABASE_ID=fixture-primary',
      'DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy',
      '',
    ].join('\n'), { mode: 0o600 });
    const result = spawnSync(process.execPath, [
      join(gateDirectory, 'deploy-backup-gate.mjs'),
      '--mode',
      'verify',
      '--env-file',
      envFile,
      '--target-git-commit',
      targetCommit,
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATABASE_URL must be assigned exactly once/u);
  } finally {
    rmSync(gateDirectory, { recursive: true, force: true });
  }
});

test('deployment psql runner strips Prisma parameters and keeps credentials out of argv', {
  skip: process.platform === 'win32',
}, () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ss-erp-deploy-psql-'));
  try {
    const psql = join(fixture, 'psql');
    writeFileSync(psql, [
      '#!/usr/bin/env bash',
      'printf "connection=%s|%s|%s|%s|%s|%s\\n" "$PGHOST" "$PGPORT" "$PGUSER" "$PGPASSWORD" "$PGDATABASE" "$PGSSLMODE"',
      'printf "arg=%s\\n" "$@"',
      '',
    ].join('\n'));
    chmodSync(psql, 0o755);
    const databaseUrl = 'postgresql://user:top-secret@127.0.0.1:5432/fixture?schema=public&connection_limit=5&sslmode=require';
    const result = spawnSync(process.execPath, [deployPsqlRunner, '--', '-v', 'ON_ERROR_STOP=1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PATH: `${fixture}:${process.env.PATH}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const [connection, ...args] = result.stdout.trim().split('\n');
    assert.equal(connection, 'connection=127.0.0.1|5432|user|top-secret|fixture|require');
    assert.deepEqual(args, [
      'arg=--no-psqlrc',
      'arg=-v',
      'arg=ON_ERROR_STOP=1',
    ]);
    assert.doesNotMatch(args.join('\n'), /top-secret/u);

    for (const overrideArguments of [
      ['--dbname=other'],
      ['--host', 'attacker.invalid'],
      ['postgresql://attacker:secret@attacker.invalid/other'],
    ]) {
      const override = spawnSync(process.execPath, [deployPsqlRunner, ...overrideArguments], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: databaseUrl },
      });
      assert.notEqual(override.status, 0);
      assert.match(override.stderr, /target overrides are forbidden|positional database targets/u);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('controlled PostgreSQL commands cannot replace their bound server or database', {
  skip: process.platform === 'win32',
}, () => {
  const fixture = mkdtempSync(join(tmpdir(), 'ss-erp-postgres-command-'));
  const marker = join(fixture, 'invoked.log');
  try {
    for (const command of ['createdb', 'dropdb', 'pg_dump', 'psql']) {
      const executable = join(fixture, command);
      writeFileSync(executable, [
        '#!/usr/bin/env bash',
        `printf '%s|%s|%s|%s|%s\\n' ${shellSingleQuote(command)} "$PGHOST" "$PGPORT" "$PGDATABASE" "$*" >> ${shellSingleQuote(marker)}`,
        '',
      ].join('\n'));
      chmodSync(executable, 0o755);
    }
    const environment = {
      ...process.env,
      PATH: `${fixture}:${process.env.PATH}`,
      SS_ERP_POSTGRES_URL:
        'postgresql://fixture:secret@db.example:5433/maintenance?sslmode=require',
    };
    const run = (command, args) => spawnSync(process.execPath, [
      postgresCommandRunner,
      '--url-env', 'SS_ERP_POSTGRES_URL',
      '--command', command,
      '--',
      ...args,
    ], { encoding: 'utf8', env: environment });

    for (const [command, args] of [
      ['psql', ['postgresql://attacker.invalid/other']],
      ['pg_dump', ['other_database']],
      ['createdb', ['--maintenance-db=attacker', '--', 'restore_check']],
      ['dropdb', ['--', 'postgresql://attacker.invalid/other']],
    ]) {
      const rejected = run(command, args);
      assert.notEqual(rejected.status, 0);
    }
    assert.equal(readdirSync(fixture).includes('invoked.log'), false);

    const accepted = run('createdb', ['--', 'restore_check']);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(
      readFileSync(marker, 'utf8'),
      'createdb|db.example|5433|maintenance|-- restore_check\n',
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('database identity binds the actual database target without putting credentials in argv', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-erp-database-identity-'));
  const binDir = join(root, 'bin');
  const argvLog = join(root, 'argv.log');
  const databaseLog = join(root, 'database.log');
  try {
    mkdirSync(binDir, { recursive: true });
    const psql = join(binDir, 'psql');
    const installPsql = ({ databaseId = 'fixture-primary', databaseName = 'fixture' } = {}) => {
      writeFileSync(psql, [
        '#!/usr/bin/env bash',
        `printf "%s\\n" "$*" > ${shellSingleQuote(argvLog)}`,
        `printf "%s|%s|%s|%s|%s|%s\\n" "$PGHOST" "$PGPORT" "$PGUSER" "$PGPASSWORD" "$PGDATABASE" "$PGSSLMODE" > ${shellSingleQuote(databaseLog)}`,
        `printf %s ${shellSingleQuote(databaseIdentityRow({ databaseId, databaseName }))}`,
        '',
      ].join('\n'));
      chmodSync(psql, 0o755);
    };
    installPsql();
    const result = spawnSync(process.execPath, [deployDatabaseIdentityScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        DEPLOY_DATABASE_URL: 'postgresql://fixture:fixture-secret@127.0.0.1:5432/fixture?schema=public&sslmode=require',
        DEPLOY_DATABASE_ID: 'fixture-primary',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), databaseIdentitySha256);
    assert.match(readFileSync(argvLog, 'utf8'), /--no-psqlrc/u);
    assert.doesNotMatch(readFileSync(argvLog, 'utf8'), /fixture-secret/u);
    const database = readFileSync(databaseLog, 'utf8');
    assert.equal(database, '127.0.0.1|5432|fixture|fixture-secret|fixture|require\n');

    installPsql({ databaseName: 'other' });
    const mismatch = spawnSync(process.execPath, [deployDatabaseIdentityScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        DEPLOY_DATABASE_URL: 'postgresql://fixture:fixture-secret@127.0.0.1:5432/fixture',
        DEPLOY_DATABASE_ID: 'fixture-primary',
      },
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /resolved to a different database name/u);

    installPsql({ databaseId: 'other-primary' });
    const labelMismatch = spawnSync(process.execPath, [deployDatabaseIdentityScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        DEPLOY_DATABASE_URL: 'postgresql://fixture:fixture-secret@127.0.0.1:5432/fixture',
        DEPLOY_DATABASE_ID: 'fixture-primary',
      },
    });
    assert.notEqual(labelMismatch.status, 0);
    assert.match(labelMismatch.stderr, /does not match DEPLOY_DATABASE_ID/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty bootstrap verification checks the Prisma target without exposing its URL', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-erp-empty-bootstrap-'));
  const binDir = join(root, 'bin');
  const argvLog = join(root, 'argv.log');
  const databaseLog = join(root, 'database.log');
  try {
    mkdirSync(binDir, { recursive: true });
    const psql = join(binDir, 'psql');
    const installPsql = (tableCount) => {
      writeFileSync(psql, [
        '#!/usr/bin/env bash',
        `printf "%s\\n" "$*" > ${shellSingleQuote(argvLog)}`,
        `printf "%s|%s|%s|%s|%s|%s\\n" "$PGHOST" "$PGPORT" "$PGUSER" "$PGPASSWORD" "$PGDATABASE" "$PGSSLMODE" > ${shellSingleQuote(databaseLog)}`,
        `printf %s ${shellSingleQuote(`${tableCount}\n`)}`,
        '',
      ].join('\n'));
      chmodSync(psql, 0o755);
    };
    installPsql(0);
    const environment = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      DATABASE_URL: 'postgresql://fixture:bootstrap-secret@127.0.0.1:5432/fixture?schema=public&sslmode=require',
    };
    const empty = spawnSync(process.execPath, [emptyBootstrapVerifier], {
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(readFileSync(argvLog, 'utf8'), /--no-psqlrc/u);
    assert.doesNotMatch(readFileSync(argvLog, 'utf8'), /bootstrap-secret/u);
    assert.equal(
      readFileSync(databaseLog, 'utf8'),
      '127.0.0.1|5432|fixture|bootstrap-secret|fixture|require\n',
    );
    installPsql(1);
    const populated = spawnSync(process.execPath, [emptyBootstrapVerifier], {
      encoding: 'utf8',
      env: environment,
    });
    assert.notEqual(populated.status, 0);
    assert.match(populated.stderr, /not empty/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backup script writes a canonical immutable status sidecar for real gzip bytes', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-erp-backup-script-'));
  const backupDir = join(root, 'backups');
  const binDir = join(root, 'bin');
  const pgDump = join(binDir, 'pg_dump');
  const targetCommit = 'a'.repeat(40);
  try {
    mkdirSync(binDir, { recursive: true });
    writeFileSync(pgDump, '#!/usr/bin/env bash\nprintf "create table public.example(id integer);\\n"\n');
    chmodSync(pgDump, 0o755);
    const psql = join(binDir, 'psql');
    writeFileSync(
      psql,
      `#!/usr/bin/env bash\nprintf %s ${shellSingleQuote(databaseIdentityRow())}\n`,
    );
    chmodSync(psql, 0o755);
    const result = spawnSync('bash', ['scripts/backup-db.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DB_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?sslmode=require',
        BACKUP_LOCAL_DIR: backupDir,
        BACKUP_KEEP_DAYS: '7',
        DEPLOY_DATABASE_ID: 'fixture-primary',
        BACKUP_TARGET_GIT_COMMIT: targetCommit,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const statusText = readFileSync(join(backupDir, 'backup-status.json'), 'utf8');
    const status = JSON.parse(statusText);
    assert.equal(statusText, `${JSON.stringify(status, null, 2)}\n`);
    assert.equal(status.schemaVersion, 3);
    assert.equal(status.databaseId, 'fixture-primary');
    assert.equal(status.databaseIdentitySha256, databaseIdentitySha256);
    assert.equal(status.databaseUuidSha256, databaseUuidSha256);
    assert.equal(status.targetGitCommit, targetCommit);
    const backup = readFileSync(join(backupDir, status.lastLocalFile));
    assert.match(gunzipSync(backup).toString('utf8'), /create table public\.example/u);
    assert.equal(status.lastLocalBytes, backup.length);
    assert.equal(status.lastLocalSha256, createHash('sha256').update(backup).digest('hex'));
    assert.equal(
      readFileSync(join(backupDir, `${status.lastLocalFile}.status.json`), 'utf8'),
      statusText,
    );
    assert.equal(
      readdirSync(backupDir).filter((name) => name.endsWith('.status.json')).length,
      1,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('restore drill writes attestation only after a positive restored table count', {
  skip: process.platform === 'win32',
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-erp-restore-script-'));
  const backupDir = join(root, 'backups');
  const binDir = join(root, 'bin');
  const targetCommit = 'b'.repeat(40);
  const filename = 'ss_erp_20300101_000000.sql.gz';
  const dropFailMarker = join(root, 'drop-fail');
  try {
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const backup = gzipSync(Buffer.from('create table public.example(id integer);\n'));
    const status = {
      schemaVersion: 3,
      lastBackupAt: new Date(Date.now() - 60_000).toISOString(),
      lastLocalFile: filename,
      lastLocalSize: `${backup.length}B`,
      lastLocalBytes: backup.length,
      lastLocalSha256: createHash('sha256').update(backup).digest('hex'),
      databaseId: 'fixture-primary',
      databaseIdentitySha256,
      databaseUuidSha256,
      targetGitCommit: targetCommit,
      remoteUploaded: false,
      lastRemoteKey: '',
    };
    const statusText = `${JSON.stringify(status, null, 2)}\n`;
    writeFileSync(join(backupDir, filename), backup);
    writeFileSync(join(backupDir, 'backup-status.json'), statusText);
    writeFileSync(join(backupDir, `${filename}.status.json`), statusText);
    chmodSync(join(backupDir, filename), 0o600);
    chmodSync(join(backupDir, `${filename}.status.json`), 0o600);

    for (const command of ['createdb', 'dropdb']) {
      const executable = join(binDir, command);
      writeFileSync(
        executable,
        command === 'dropdb'
          ? `#!/usr/bin/env bash\n[ ! -f ${shellSingleQuote(dropFailMarker)} ]\n`
          : '#!/usr/bin/env bash\nexit 0\n',
      );
      chmodSync(executable, 0o755);
    }
    const psql = join(binDir, 'psql');
    const routeMarkerState = join(root, 'route-marker-state');
    const installPsql = ({
      restoredDatabaseUuid = '123e4567-e89b-42d3-a456-426614174000',
      tableCount = 142,
    } = {}) => {
      const sourceIdentity = JSON.stringify({
        databaseId: 'fixture-primary',
        databaseUuid: '123e4567-e89b-42d3-a456-426614174000',
      });
      const restoredIdentity = JSON.stringify({
        databaseId: 'fixture-primary',
        databaseUuid: restoredDatabaseUuid,
      });
      writeFileSync(psql, [
        '#!/usr/bin/env bash',
        'DB_HOST="$PGHOST"',
        'ROUTE_MARKER=""',
        'HAS_ROUTE_MARKER=0',
        'HAS_ROUTE_SCHEMA=0',
        'for argument in "$@"; do',
        '  case "$argument" in',
        '    restore_route_marker=*) ROUTE_MARKER="${argument#restore_route_marker=}"; HAS_ROUTE_MARKER=1 ;;',
        '    restore_route_schema=*) HAS_ROUTE_SCHEMA=1 ;;',
        '  esac',
        'done',
        'if [ "$HAS_ROUTE_MARKER" = "1" ]; then',
        '  cat >/dev/null',
        `  printf '%s\\t%s\\n' "$DB_HOST" "$ROUTE_MARKER" > ${shellSingleQuote(routeMarkerState)}`,
        '  exit 0',
        'fi',
        'if [ "$HAS_ROUTE_SCHEMA" = "1" ]; then',
        '  cat >/dev/null',
        `  IFS=$'\\t' read -r MARKER_HOST MARKER_VALUE < ${shellSingleQuote(routeMarkerState)} || exit 1`,
        '  [ "$DB_HOST" = "$MARKER_HOST" ] || exit 1',
        '  printf \'%s\\n\' "$MARKER_VALUE"',
        '  exit 0',
        'fi',
        'case "$*" in',
        '  *"current_database(), database.oid::text"*)',
        '    DB_NAME="$PGDATABASE"',
        `    DB_IDENTITY=${shellSingleQuote(sourceIdentity)}`,
        `    case "$DB_NAME" in ss_erp_restore_check_*) DB_IDENTITY=${shellSingleQuote(restoredIdentity)} ;; esac`,
        '    printf \'%s\\t16384\\t%s\\n\' "$DB_NAME" "$DB_IDENTITY"',
        '    exit 0',
        '    ;;',
        '  *"select current_database();"*)',
        '    printf \'%s\\n\' "$PGDATABASE"',
        '    exit 0',
        '    ;;',
        'esac',
        'for argument in "$@"; do',
        `  if [ "$argument" = "--tuples-only" ]; then printf %s ${shellSingleQuote(`${tableCount}\n`)}; exit 0; fi`,
        'done',
        'cat >/dev/null',
        '',
      ].join('\n'));
      chmodSync(psql, 0o755);
    };
    installPsql();

    const result = spawnSync('bash', ['scripts/verify-backup-restore.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DB_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?sslmode=require',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public&sslmode=require',
        BACKUP_LOCAL_DIR: backupDir,
        DEPLOY_DATABASE_ID: 'fixture-primary',
        BACKUP_TARGET_GIT_COMMIT: targetCommit,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const attestation = JSON.parse(readFileSync(
      join(backupDir, `deploy-backup-${targetCommit}.attestation.json`),
      'utf8',
    ));
    assert.equal(attestation.restoreDrill.status, 'PASSED');
    assert.equal(attestation.restoreDrill.tableCount, 142);
    assert.equal(attestation.backup.statusSha256, createHash('sha256').update(statusText).digest('hex'));

    const routeMismatchCommit = 'e'.repeat(40);
    const routeMismatchStatus = { ...status, targetGitCommit: routeMismatchCommit };
    const routeMismatchStatusText = `${JSON.stringify(routeMismatchStatus, null, 2)}\n`;
    writeFileSync(join(backupDir, 'backup-status.json'), routeMismatchStatusText);
    writeFileSync(join(backupDir, `${filename}.status.json`), routeMismatchStatusText);
    chmodSync(join(backupDir, `${filename}.status.json`), 0o600);
    installPsql();
    const routeMismatch = spawnSync('bash', ['scripts/verify-backup-restore.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DB_URL: 'postgresql://fixture:route-secret@restore.fixture:5432/fixture?sslmode=require',
        DATABASE_URL: 'postgresql://fixture:route-secret@restore.fixture:5432/fixture?schema=public&sslmode=require',
        BACKUP_LOCAL_DIR: backupDir,
        DEPLOY_DATABASE_ID: 'fixture-primary',
        BACKUP_TARGET_GIT_COMMIT: routeMismatchCommit,
        VERIFY_RESTORE_MAINTENANCE_URL: 'postgresql://fixture:route-secret@maintenance.fixture:5432/postgres?sslmode=require',
        VERIFY_RESTORE_TEMP_DB: 'ss_erp_restore_check_same_name',
      },
    });
    assert.notEqual(routeMismatch.status, 0);
    assert.match(routeMismatch.stderr, /维护路由与恢复路由未指向同一临时数据库/u);
    assert.doesNotMatch(`${routeMismatch.stdout}\n${routeMismatch.stderr}`, /route-secret/u);
    assert.throws(() => readFileSync(
      join(backupDir, `deploy-backup-${routeMismatchCommit}.attestation.json`),
    ));

    const uuidMismatchCommit = 'd'.repeat(40);
    const uuidMismatchStatus = { ...status, targetGitCommit: uuidMismatchCommit };
    const uuidMismatchStatusText = `${JSON.stringify(uuidMismatchStatus, null, 2)}\n`;
    writeFileSync(join(backupDir, 'backup-status.json'), uuidMismatchStatusText);
    writeFileSync(join(backupDir, `${filename}.status.json`), uuidMismatchStatusText);
    chmodSync(join(backupDir, `${filename}.status.json`), 0o600);
    installPsql({ restoredDatabaseUuid: '223e4567-e89b-42d3-a456-426614174000' });
    const uuidMismatch = spawnSync('bash', ['scripts/verify-backup-restore.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DB_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?sslmode=require',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public&sslmode=require',
        BACKUP_LOCAL_DIR: backupDir,
        DEPLOY_DATABASE_ID: 'fixture-primary',
        BACKUP_TARGET_GIT_COMMIT: uuidMismatchCommit,
      },
    });
    assert.notEqual(uuidMismatch.status, 0);
    assert.match(uuidMismatch.stderr, /恢复备份中的数据库 UUID/u);
    assert.throws(() => readFileSync(
      join(backupDir, `deploy-backup-${uuidMismatchCommit}.attestation.json`),
    ));

    const rejectedCommit = 'c'.repeat(40);
    const rejectedStatus = { ...status, targetGitCommit: rejectedCommit };
    const rejectedStatusText = `${JSON.stringify(rejectedStatus, null, 2)}\n`;
    writeFileSync(join(backupDir, 'backup-status.json'), rejectedStatusText);
    writeFileSync(join(backupDir, `${filename}.status.json`), rejectedStatusText);
    chmodSync(join(backupDir, `${filename}.status.json`), 0o600);
    installPsql({ tableCount: 0 });
    const rejected = spawnSync('bash', ['scripts/verify-backup-restore.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DB_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?sslmode=require',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public&sslmode=require',
        BACKUP_LOCAL_DIR: backupDir,
        DEPLOY_DATABASE_ID: 'fixture-primary',
        BACKUP_TARGET_GIT_COMMIT: rejectedCommit,
      },
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /public schema 中没有表/u);
    assert.throws(() => readFileSync(
      join(backupDir, `deploy-backup-${rejectedCommit}.attestation.json`),
    ));

    const maliciousName = spawnSync('bash', ['scripts/verify-backup-restore.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DB_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?sslmode=require',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public&sslmode=require',
        BACKUP_LOCAL_DIR: backupDir,
        DEPLOY_DATABASE_ID: 'fixture-primary',
        BACKUP_TARGET_GIT_COMMIT: rejectedCommit,
        VERIFY_RESTORE_TEMP_DB: 'ss_erp_restore_check_%66ixture',
      },
    });
    assert.notEqual(maliciousName.status, 0);
    assert.match(maliciousName.stderr, /临时库名必须使用安全/u);

    const cleanupCommit = 'd'.repeat(40);
    const cleanupStatus = { ...status, targetGitCommit: cleanupCommit };
    const cleanupStatusText = `${JSON.stringify(cleanupStatus, null, 2)}\n`;
    writeFileSync(join(backupDir, 'backup-status.json'), cleanupStatusText);
    writeFileSync(join(backupDir, `${filename}.status.json`), cleanupStatusText);
    chmodSync(join(backupDir, `${filename}.status.json`), 0o600);
    installPsql();
    writeFileSync(dropFailMarker, 'fail\n');
    const cleanupFailure = spawnSync('bash', ['scripts/verify-backup-restore.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DB_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?sslmode=require',
        DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/fixture?schema=public&sslmode=require',
        BACKUP_LOCAL_DIR: backupDir,
        DEPLOY_DATABASE_ID: 'fixture-primary',
        BACKUP_TARGET_GIT_COMMIT: cleanupCommit,
      },
    });
    assert.notEqual(cleanupFailure.status, 0);
    assert.match(cleanupFailure.stderr, /不生成部署认证/u);
    assert.throws(() => readFileSync(
      join(backupDir, `deploy-backup-${cleanupCommit}.attestation.json`),
    ));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backup cron exports its env and follows the active release symlink and commit marker', () => {
  const expected =
    'set -a; . /etc/ss-erp-backup.env; set +a; BACKUP_DEPLOYED_COMMIT_FILE=/opt/ss-erp/current/DEPLOYED_COMMIT bash /opt/ss-erp/current/scripts/backup-db.sh';
  const cronCommands = cronExample.split(/\r?\n/u).filter((line) => line.includes('backup-db.sh'));

  assert.equal(cronCommands.length, 2, 'daily and weekly cron examples must both be present');
  for (const command of cronCommands) {
    assert.ok(
      command.includes(expected),
      'cron must export backup env and bind the active release script and marker: ' + command,
    );
  }
  assert.match(
    localDevelopment,
    /set -a; \. \.\/\.env\.staging; \. \/etc\/ss-erp-backup\.env; set \+a/u,
  );
  assert.match(
    localDevelopment,
    /BACKUP_TARGET_GIT_COMMIT="\$TARGET_COMMIT" bash scripts\/backup-db\.sh/u,
  );
  assert.doesNotMatch(cronExample, /\/opt\/ss-erp\/app\/(?:DEPLOYED_COMMIT|scripts\/backup-db\.sh)/u);
  assert.match(verifier, /rejects legacy or unbound database backup commands/u);
  assert.match(verifier, /BACKUP_DEPLOYED_COMMIT_FILE=\/opt\/ss-erp\/current\/DEPLOYED_COMMIT/u);
  assert.doesNotMatch(
    verifier,
    /pass "cron exports backup env and targets the app-dir backup script"/u,
  );
});


test('deployment creates and verification checks the backup cron log directory', () => {
  assert.match(
    appDirDeployer,
    /BACKUP_LOG_DIR="\$\{BACKUP_LOG_DIR:-\/var\/log\/ss-erp\}"/u,
  );
  assert.match(
    appDirDeployer,
    /assert_root_ancestor_chain "\$BACKUP_LOG_DIR"/u,
  );
  assert.match(appDirDeployer, /chmod 0750 "\$BACKUP_LOG_DIR"/u);
  assert.match(appDirDeployer, /chown root:root "\$BACKUP_LOG_DIR"/u);
  assert.match(
    verifier,
    /fail "backup log directory is missing or not writable: \$BACKUP_LOG_DIR"/u,
  );
  assert.match(
    verifier,
    /fail "backup log directory mode must be 750: \$BACKUP_LOG_DIR/u,
  );
  assert.match(
    verifier,
    /fail "backup log directory owner must be root:root: \$BACKUP_LOG_DIR/u,
  );
});
test('VPS verification keeps logistics distribution dark unless rollout expectations are explicit', () => {
  assert.ok(verifier.includes(
    'VERIFY_EXPECT_LOGISTICS_DISTRIBUTION_ENABLED="${VERIFY_EXPECT_LOGISTICS_DISTRIBUTION_ENABLED:-false}"',
  ));
  assert.ok(verifier.includes(
    'VERIFY_EXPECT_NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED="${VERIFY_EXPECT_NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED:-false}"',
  ));
  assert.ok(verifier.includes(
    'VERIFY_EXPECT_EXTENSION_AUTH_MODE="${VERIFY_EXPECT_EXTENSION_AUTH_MODE:-compat}"',
  ));
  assert.ok(verifier.includes(
    'VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED="${VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED:-false}"',
  ));
  assert.ok(verifier.includes(
    'VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED="${VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED:-false}"',
  ));
  assert.match(verifier, /\r?\ncheck_logistics_rollout_expectations\r?\n/u);
  assert.ok(verifier.includes('LOGISTICS_DISTRIBUTION_ENABLED'));
  assert.ok(verifier.includes('NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED'));
  assert.ok(verifier.includes('EXTENSION_AUTH_MODE'));
  assert.match(verifier, /verify-vps-extension-release\.mjs/u);
  assert.match(verifier, /--build-root "\$DEPLOY_DIR\/build\/extensions"/u);
  assert.match(verifier, /--deployed-commit-file "\$DEPLOY_DIR\/DEPLOYED_COMMIT"/u);
  assert.match(verifier, /--expected-cloud-logistics-enabled "\$expected_cloud_extension"/u);
  assert.match(
    verifier,
    /check_extension_website_distribution_state[\s\\]+"\$expected_website_publication" "\$deployed_commit" "\$expected_api_origin"/u,
  );
  assert.doesNotMatch(
    verifier,
    /check_extension_website_distribution_state[\s\\]+"\$expected_cloud_extension"/u,
  );
  assert.doesNotMatch(verifier, /build\/extensions\/ss-erp-cloud\//u);
  assert.doesNotMatch(verifier, /grep -Eq "\^\[\[:space:\]\]\*enabled:/u);
  assert.match(vpsExtensionReleaseVerifier, /verify-extension-release\.mjs/u);
  assert.match(vpsExtensionReleaseVerifier, /parseStoredZip/u);
  assert.match(preflight, /verify-vps-extension-release\.test\.mjs/u);
  assert.match(vpsExtensionReleaseVerifier, /staged extension release must contain exactly four files/u);
  assert.doesNotMatch(vpsExtensionReleaseVerifier, /(?:exec|spawn).*unzip/u);
  assert.doesNotMatch(vpsExtensionReleaseVerifier, /mkdtemp/u);
});

test('VPS verification accepts the complete IPv4 loopback range', () => {
  assert.match(
    verifier,
    /127\\\.\[0-9\]\{1,3\}\\\.\[0-9\]\{1,3\}\\\.\[0-9\]\{1,3\}/u,
  );
});

test('cloud verification derives the public ready target from the deployed env', () => {
  assert.match(cloudVerifier, /NEXT_PUBLIC_API_BASE_URL/u);
  assert.match(cloudVerifier, /VERIFY_PUBLIC_BASE_URL/u);
  assert.match(cloudVerifier, /VERIFY_READY_URL/u);
  assert.doesNotMatch(cloudVerifier, /VERIFY_DOMAIN:-ss-erp\.com/u);
  for (const source of [verifier, cloudVerifier]) {
    assert.match(source, /\["http:", "https:"\]\.includes\(url\.protocol\)/u);
    assert.match(source, /url\.pathname !== "\/ready"/u);
    assert.match(source, /url\.username/u);
    assert.match(source, /url\.password/u);
    assert.match(source, /url\.search/u);
    assert.match(source, /url\.hash/u);
    assert.match(source, /configured && configured !== host/u);
    assert.match(source, /host === "localhost"/u);
    assert.match(source, /privateIpv4/u);
  }
  assert.doesNotMatch(verifier, /curl -k /u);
});

test('VPS verification rejects stale or missing backup artifacts', () => {
  assert.match(verifier, /BACKUP_MAX_AGE_HOURS="\$\{BACKUP_MAX_AGE_HOURS:-36\}"/u);
  assert.match(verifier, /Date\.parse\(data\.lastBackupAt\)/u);
  assert.match(verifier, /fs\.existsSync\(localFile\)/u);
  assert.match(verifier, /fs\.accessSync\(localFile, fs\.constants\.R_OK\)/u);
  assert.match(verifier, /fs\.lstatSync\(localFile\)/u);
  assert.match(verifier, /data\.schemaVersion !== 3/u);
  assert.match(verifier, /data\.databaseIdentitySha256/u);
  assert.match(verifier, /data\.lastLocalSha256/u);
  assert.match(verifier, /deploy-backup-gate\.mjs[\s\S]*--mode verify/u);
  assert.match(verifier, /data\.remoteUploaded/u);
  assert.match(verifier, /BACKUP_S3_BUCKET/u);
  assert.match(
    verifier,
    /fail "remote backup is configured but latest upload was not successful"/u,
  );
  assert.match(
    verifier,
    /warn "remote backup is not configured; latest status reports a remote upload"/u,
  );
  assert.match(verifier, /warn "remote backup is not configured; latest backup is local only"/u);
});

const validatorMatch = verifier.match(
  /if validation=\$\(node -e '\n([\s\S]*?)\n' "\$status_file"/u,
);
assert.ok(
  validatorMatch,
  'backup status validator must remain executable as an isolated Node check',
);
const backupStatusValidator = validatorMatch[1];

function runBackupStatusValidator({
  ageHours = 1,
  createArtifact = true,
  artifactContent = gzipSync(Buffer.from('backup\n')),
  remoteUploaded = true,
  maxAgeHours = 36,
} = {}) {
  const backupDir = mkdtempSync(join(tmpdir(), 'ss-erp-backup-contract-'));
  const artifactName = 'ss_erp_contract.sql.gz';
  const artifactPath = join(backupDir, artifactName);
  const statusPath = join(backupDir, 'backup-status.json');

  try {
    if (createArtifact) {
      writeFileSync(artifactPath, artifactContent);
    }
    const artifactBytes = Buffer.isBuffer(artifactContent)
      ? artifactContent
      : Buffer.from(artifactContent);
    writeFileSync(
      statusPath,
      `${JSON.stringify({
        schemaVersion: 3,
        lastBackupAt: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
        lastLocalFile: artifactName,
        lastLocalSize: '1K',
        lastLocalBytes: artifactBytes.length,
        lastLocalSha256: createHash('sha256').update(artifactBytes).digest('hex'),
        databaseId: 'fixture-primary',
        databaseIdentitySha256,
        databaseUuidSha256,
        targetGitCommit: 'a'.repeat(40),
        remoteUploaded,
        lastRemoteKey: remoteUploaded ? 'db/ss_erp_contract.sql.gz' : '',
      }, null, 2)}\n`,
    );

    return spawnSync(
      process.execPath,
      [
        '-e',
        backupStatusValidator,
        statusPath,
        backupDir,
        String(maxAgeHours),
        'fixture-primary',
        'a'.repeat(40),
        databaseIdentitySha256,
        databaseUuidSha256,
      ],
      { encoding: 'utf8' },
    );
  } finally {
    rmSync(backupDir, { recursive: true, force: true });
  }
}

test('backup status validator accepts a fresh non-empty local artifact', () => {
  const result = runBackupStatusValidator();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^true\t\d+\.\d{2}\t\d+$/u);
});

test('backup status validator rejects a stale backup', () => {
  const result = runBackupStatusValidator({ ageHours: 37 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lastBackupAt is stale/u);
});

test('backup status validator rejects missing and empty local artifacts', async (t) => {
  await t.test('missing file', () => {
    const result = runBackupStatusValidator({ createArtifact: false });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lastLocalFile does not exist/u);
  });
  await t.test('empty file', () => {
    const result = runBackupStatusValidator({ artifactContent: '' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lastLocalBytes is missing or invalid|lastLocalFile is empty/u);
  });
});
