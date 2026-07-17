import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const deployAppDir = readFileSync('scripts/deploy-app-dir.sh', 'utf8');
const diagnoseRuntimeEnv = readFileSync('scripts/diagnose-runtime-env.sh', 'utf8');
const verifyCloudRuntime = readFileSync('scripts/verify-cloud-runtime.sh', 'utf8');
const verifyDeployReadiness = readFileSync('scripts/verify-deploy-readiness.sh', 'utf8');

assert.match(
  deployAppDir,
  /--profile 'cloud-bootstrap'/,
  'app-dir deploy should validate only bootstrap env before dependencies and Prisma are available',
);

assert.match(
  deployAppDir,
  /SKIP_SERVICE_CHECKS=1[\s\S]+diagnose-runtime-env\.sh/,
  'app-dir deploy should run runtime config diagnostics in pre-switch mode',
);

const migrateIndex = deployAppDir.indexOf('npx prisma migrate deploy');
const diagnosticsIndex = deployAppDir.indexOf('diagnose-runtime-env.sh');
assert.ok(migrateIndex >= 0, 'app-dir deploy should still run Prisma migration');
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
  'REDIS_URL=redis://127.0.0.1:6379',
  'JWT_SECRET=0123456789abcdef',
  'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
  'RUNTIME_MODE=cloud',
  'NEXT_PUBLIC_RUNTIME_MODE=cloud',
  'LEGAL_PROFILE=cloud-global',
  'NEXT_PUBLIC_API_BASE_URL=https://ss-erp.com',
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

const missingApiBaseEnvPath = join(tempDir, '.env.missing-api-base');
writeFileSync(missingApiBaseEnvPath, [
  'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db?schema=public',
  'REDIS_URL=redis://127.0.0.1:6379',
  'JWT_SECRET=0123456789abcdef',
  'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
  'RUNTIME_MODE=cloud',
  'NEXT_PUBLIC_RUNTIME_MODE=cloud',
  'LEGAL_PROFILE=cloud-global',
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
