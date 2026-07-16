import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cronExample = readFileSync(new URL('./backup-db.crontab.example', import.meta.url), 'utf8');
const localDevelopment = readFileSync(
  new URL('../docs/local-development.md', import.meta.url),
  'utf8',
);
const verifier = readFileSync(new URL('./verify-vps-deploy.sh', import.meta.url), 'utf8');
const cloudVerifier = readFileSync(new URL('./verify-cloud-runtime.sh', import.meta.url), 'utf8');
const appDirDeployer = readFileSync(new URL('./deploy-app-dir.sh', import.meta.url), 'utf8');

test('backup cron exports its env and targets the app-dir deployment script', () => {
  const expected =
    'set -a; . /etc/ss-erp-backup.env; set +a; bash /opt/ss-erp/app/scripts/backup-db.sh';
  const cronCommands = cronExample.split(/\r?\n/u).filter((line) => line.includes('backup-db.sh'));

  assert.equal(cronCommands.length, 2, 'daily and weekly cron examples must both be present');
  for (const command of cronCommands) {
    assert.ok(
      command.includes(expected),
      'cron must export backup env and use app-dir script: ' + command,
    );
  }
  assert.ok(
    localDevelopment.includes(
      'set -a; . /etc/ss-erp-backup.env; set +a; bash scripts/backup-db.sh',
    ),
  );
  assert.doesNotMatch(cronExample, /\/opt\/ss-erp\/scripts\/backup-db\.sh/u);
});


test('deployment creates and verification checks the backup cron log directory', () => {
  assert.match(
    appDirDeployer,
    /BACKUP_LOG_DIR="\$\{BACKUP_LOG_DIR:-\/var\/log\/ss-erp\}"/u,
  );
  assert.match(
    appDirDeployer,
    /mkdir -p "\$DEPLOY_BASE" "\$BACKUP_DIR" "\$BACKUP_LOG_DIR"/u,
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
  assert.match(verifier, /\r?\ncheck_logistics_rollout_expectations\r?\n/u);
  assert.ok(verifier.includes('LOGISTICS_DISTRIBUTION_ENABLED'));
  assert.ok(verifier.includes('NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED'));
  assert.ok(verifier.includes('EXTENSION_AUTH_MODE'));
  assert.ok(verifier.includes(
    'build/extensions/ss-erp-cloud/shared/logistics-rules/distribution-feature.js',
  ));
  assert.ok(verifier.includes(
    'enabled:[[:space:]]*${expected_cloud_extension}',
  ));
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
    assert.match(source, /\['http:', 'https:'\]\.includes\(url\.protocol\)/u);
    assert.match(source, /url\.pathname !== '\/ready'/u);
    assert.match(source, /url\.username/u);
    assert.match(source, /url\.password/u);
    assert.match(source, /url\.search/u);
    assert.match(source, /url\.hash/u);
    assert.match(source, /configured && configured !== host/u);
    assert.match(source, /host === 'localhost'/u);
    assert.match(source, /privateIpv4/u);
  }
  assert.doesNotMatch(verifier, /curl -k /u);
});

test('VPS verification rejects stale or missing backup artifacts', () => {
  assert.match(verifier, /BACKUP_MAX_AGE_HOURS="\$\{BACKUP_MAX_AGE_HOURS:-36\}"/u);
  assert.match(verifier, /Date\.parse\(data\.lastBackupAt\)/u);
  assert.match(verifier, /fs\.existsSync\(localFile\)/u);
  assert.match(verifier, /fs\.accessSync\(localFile, fs\.constants\.R_OK\)/u);
  assert.match(verifier, /fs\.statSync\(localFile\)/u);
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
  artifactContent = 'backup',
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
    writeFileSync(
      statusPath,
      JSON.stringify({
        lastBackupAt: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
        lastLocalFile: artifactName,
        lastLocalSize: '1K',
        remoteUploaded,
      }),
    );

    return spawnSync(
      process.execPath,
      ['-e', backupStatusValidator, statusPath, backupDir, String(maxAgeHours)],
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
    assert.match(result.stderr, /lastLocalFile is empty/u);
  });
});
