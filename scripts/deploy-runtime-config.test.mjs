import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const deployAppDir = readFileSync('scripts/deploy-app-dir.sh', 'utf8');
const deployBackupGate = readFileSync('scripts/deploy-backup-gate.mjs', 'utf8');
const diagnoseRuntimeEnv = readFileSync('scripts/diagnose-runtime-env.sh', 'utf8');
const verifyCloudRuntime = readFileSync('scripts/verify-cloud-runtime.sh', 'utf8');
const verifyDeployReadiness = readFileSync('scripts/verify-deploy-readiness.sh', 'utf8');

assert.match(
  deployAppDir,
  /--profile cloud-bootstrap --env "\$ENV_FILE_NAME"/u,
  'app-dir deploy should validate only bootstrap env before dependencies and Prisma are available',
);

assert.match(
  deployAppDir,
  /SKIP_SERVICE_CHECKS=1[\s\S]+diagnose-runtime-env\.sh/,
  'app-dir deploy should run runtime config diagnostics in pre-switch mode',
);

const migrateIndex = deployAppDir.indexOf('deploy-backup-gate.mjs');
const diagnosticsIndex = deployAppDir.indexOf('diagnose-runtime-env.sh');
assert.ok(migrateIndex >= 0, 'app-dir deploy should invoke the bound migration orchestrator');
assert.match(deployBackupGate, /'pnpm', 'exec', 'prisma', 'migrate', 'deploy'/u);
assert.ok(diagnosticsIndex > migrateIndex, 'runtime config diagnostics must run after Prisma migration');

assert.match(
  diagnoseRuntimeEnv,
  /SKIP_SERVICE_CHECKS/,
  'runtime diagnostics should support config-only checks before systemd services point at the new release',
);

assert.doesNotMatch(
  verifyCloudRuntime,
  /--profile cloud-r2/,
  'cloud runtime verification should not require OSS secrets in env when SystemConfig is the source of truth',
);

assert.match(
  verifyCloudRuntime,
  /--profile cloud-bootstrap/,
  'cloud runtime verification should still validate startup env requirements',
);

assert.match(
  verifyDeployReadiness,
  /diagnose-runtime-env\.sh/,
  'deploy readiness should validate upload runtime config through env or SystemConfig',
);

const tempDir = mkdtempSync(join(tmpdir(), 'ss-erp-bootstrap-env-'));
const bootstrapEnvPath = join(tempDir, '.env.staging');
writeFileSync(bootstrapEnvPath, [
  'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db?schema=public',
  'DEPLOY_DATABASE_ID=test-primary',
  'DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy',
  'REDIS_URL=redis://127.0.0.1:6379',
  'JWT_SECRET=0123456789abcdef',
  'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
  'RUNTIME_MODE=cloud',
  'NEXT_PUBLIC_RUNTIME_MODE=cloud',
  'LEGAL_PROFILE=cloud-global',
  'NEXT_PUBLIC_API_BASE_URL=https://ss-erp.com',
  'EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN=https://app.ss-erp.com',
  'EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN=https://admin.ss-erp.com',
  'EXTENSION_RELEASE_EXPECTED_API_ORIGIN=https://ss-erp.com',
  'EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN=http://127.0.0.1:3001',
  'CORS_ORIGIN=https://ss-erp.com',
  '',
].join('\n'));

const bootstrapCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  bootstrapEnvPath,
], { encoding: 'utf8' });

assert.equal(
  bootstrapCheck.status,
  0,
  `cloud-bootstrap should not require upload storage env when SystemConfig can provide it\nSTDOUT:\n${bootstrapCheck.stdout}\nSTDERR:\n${bootstrapCheck.stderr}`,
);

const missingDeployDatabaseIdPath = join(tempDir, '.env.missing-deploy-database-id');
writeFileSync(
  missingDeployDatabaseIdPath,
  readFileSync(bootstrapEnvPath, 'utf8').replace('DEPLOY_DATABASE_ID=test-primary\n', ''),
);
const missingDeployDatabaseIdCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  missingDeployDatabaseIdPath,
], { encoding: 'utf8' });
assert.notEqual(missingDeployDatabaseIdCheck.status, 0);
assert.match(missingDeployDatabaseIdCheck.stderr, /DEPLOY_DATABASE_ID is required/u);

const missingDeployBackupDirPath = join(tempDir, '.env.missing-deploy-backup-dir');
writeFileSync(
  missingDeployBackupDirPath,
  readFileSync(bootstrapEnvPath, 'utf8')
    .replace('DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy\n', ''),
);
const missingDeployBackupDirCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  missingDeployBackupDirPath,
], { encoding: 'utf8' });
assert.notEqual(missingDeployBackupDirCheck.status, 0);
assert.match(missingDeployBackupDirCheck.stderr, /DEPLOY_BACKUP_LOCAL_DIR is required/u);

const sharedBackupDirPath = join(tempDir, '.env.shared-backup-dir');
writeFileSync(
  sharedBackupDirPath,
  `${readFileSync(bootstrapEnvPath, 'utf8')}BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy\n`,
);
const sharedBackupDirCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  sharedBackupDirPath,
], { encoding: 'utf8' });
assert.notEqual(sharedBackupDirCheck.status, 0);
assert.match(sharedBackupDirCheck.stderr, /must be separate/u);

const aliasedBackupDirPath = join(tempDir, '.env.aliased-backup-dir');
writeFileSync(
  aliasedBackupDirPath,
  `${readFileSync(bootstrapEnvPath, 'utf8')}BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy/./\n`,
);
const aliasedBackupDirCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  aliasedBackupDirPath,
], { encoding: 'utf8' });
assert.notEqual(aliasedBackupDirCheck.status, 0);
assert.match(aliasedBackupDirCheck.stderr, /canonical absolute path/u);

const invalidBackupWindowPath = join(tempDir, '.env.invalid-backup-window');
writeFileSync(
  invalidBackupWindowPath,
  `${readFileSync(bootstrapEnvPath, 'utf8')}DEPLOY_BACKUP_MAX_AGE_MINUTES=1441\n`,
);
const invalidBackupWindowCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  invalidBackupWindowPath,
], { encoding: 'utf8' });
assert.notEqual(invalidBackupWindowCheck.status, 0);
assert.match(invalidBackupWindowCheck.stderr, /integer from 1 through 1440/u);

const invalidBackupTimeoutPath = join(tempDir, '.env.invalid-backup-timeout');
writeFileSync(
  invalidBackupTimeoutPath,
  `${readFileSync(bootstrapEnvPath, 'utf8')}DEPLOY_BACKUP_VERIFY_TIMEOUT=25h\n`,
);
const invalidBackupTimeoutCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  invalidBackupTimeoutPath,
], { encoding: 'utf8' });
assert.notEqual(invalidBackupTimeoutCheck.status, 0);
assert.match(invalidBackupTimeoutCheck.stderr, /no longer than 24 hours/u);

const unsafeBackupMountPath = join(tempDir, '.env.unsafe-backup-mount');
writeFileSync(
  unsafeBackupMountPath,
  readFileSync(bootstrapEnvPath, 'utf8')
    .replace('DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy', 'DEPLOY_BACKUP_LOCAL_DIR=/app'),
);
const unsafeBackupMountCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  unsafeBackupMountPath,
], { encoding: 'utf8' });
assert.notEqual(unsafeBackupMountCheck.status, 0);
assert.match(unsafeBackupMountCheck.stderr, /beneath \/var\/backups/u);

const missingReleaseOriginEnvPath = join(tempDir, '.env.missing-release-origin');
writeFileSync(
  missingReleaseOriginEnvPath,
  readFileSync(bootstrapEnvPath, 'utf8').replace(
    'EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN=https://admin.ss-erp.com\n',
    '',
  ),
);
const missingReleaseOriginCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  missingReleaseOriginEnvPath,
], { encoding: 'utf8' });
assert.notEqual(
  missingReleaseOriginCheck.status,
  0,
  'cloud-bootstrap must require every independently approved extension release origin',
);
assert.match(
  missingReleaseOriginCheck.stderr,
  /formal release expected origins\.admin must be a canonical public HTTPS origin/u,
);

const missingApiBaseEnvPath = join(tempDir, '.env.missing-api-base');
writeFileSync(missingApiBaseEnvPath, [
  'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db?schema=public',
  'DEPLOY_DATABASE_ID=test-primary',
  'DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy',
  'REDIS_URL=redis://127.0.0.1:6379',
  'JWT_SECRET=0123456789abcdef',
  'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
  'RUNTIME_MODE=cloud',
  'NEXT_PUBLIC_RUNTIME_MODE=cloud',
  'LEGAL_PROFILE=cloud-global',
  'EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN=https://app.ss-erp.com',
  'EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN=https://admin.ss-erp.com',
  'EXTENSION_RELEASE_EXPECTED_API_ORIGIN=https://ss-erp.com',
  'EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN=http://127.0.0.1:3001',
  'CORS_ORIGIN=https://ss-erp.com',
  '',
].join('\n'));

const missingApiBaseCheck = spawnSync(process.execPath, [
  'scripts/validate-env.mjs',
  '--profile',
  'cloud-bootstrap',
  '--env',
  missingApiBaseEnvPath,
], { encoding: 'utf8' });

assert.notEqual(missingApiBaseCheck.status, 0, 'cloud-bootstrap should require NEXT_PUBLIC_API_BASE_URL for production web builds');
assert.match(missingApiBaseCheck.stderr, /NEXT_PUBLIC_API_BASE_URL is required/);

console.log('PASS deploy runtime config guards');
