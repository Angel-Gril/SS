import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const verifier = 'scripts/verify-ai-media-dark-policy.mjs';
const verifyAiMediaDark = readFileSync('scripts/verify-ai-media-dark.sh', 'utf8');
const verifyVpsDeploy = readFileSync('scripts/verify-vps-deploy.sh', 'utf8');
const verifyDeployReadiness = readFileSync('scripts/verify-deploy-readiness.sh', 'utf8');
const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const serverDockerfile = readFileSync('docker/server.Dockerfile', 'utf8');
const composeMigrationWrapper = readFileSync('docker/migrate-and-verify-ai-media-dark.sh', 'utf8');
const composeDarkVerifier = readFileSync('docker/verify-ai-media-dark.mjs', 'utf8');
const composeDeploy = readFileSync('scripts/deploy-compose.sh', 'utf8');
const concurrentIndexMigration = readFileSync(
  'apps/server/prisma/migrations/20260720153000_bind_ai_image_edit_outputs/migration.sql',
  'utf8',
);
const deployEntrypoints = [
  {
    name: 'release symlink deploy',
    source: readFileSync('scripts/deploy.sh', 'utf8'),
    boundary: 'echo "[deploy] Switching current symlink"',
  },
  {
    name: 'app directory deploy',
    source: readFileSync('scripts/deploy-app-dir.sh', 'utf8'),
    boundary: 'log "Switching $APP_DIR"',
  },
  {
    name: 'staging deploy',
    source: readFileSync('scripts/deploy-staging.sh', 'utf8'),
    boundary: 'echo "[6/7] Restarting services..."',
  },
];
const composeDeployments = [
  ['production Compose', readFileSync('docker-compose.prod.yml', 'utf8')],
  ['staging Compose', readFileSync('docker-compose.staging.yml', 'utf8')],
];

function run(rows) {
  return spawnSync(process.execPath, [verifier, JSON.stringify(rows)], { encoding: 'utf8' });
}

function composeServiceBlock(compose, service) {
  const match = new RegExp(`^  ${service}:\\s*$`, 'mu').exec(compose);
  const start = match?.index ?? -1;
  assert.ok(start >= 0, `Compose service is missing: ${service}`);
  const remainder = compose.slice(start);
  const firstLineEnd = remainder.indexOf('\n');
  const nextService = remainder.slice(firstLineEnd + 1).search(/^  [a-z0-9_-]+:\s*$/mu);
  return nextService >= 0
    ? remainder.slice(0, firstLineEnd + 1 + nextService)
    : remainder;
}

for (const rows of [
  [],
  [{ key: 'feature_ai_media_workflow_v2', value: 'false' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":0,"tenantIds":[]}' }],
  [
    { key: 'feature_ai_media_workflow_v2', value: 'false' },
    { key: 'feature_ai_media_suite', value: 'false' },
    { key: 'feature_ai_media_full_edit', value: 'false' },
    { key: 'feature_ai_media_inpaint', value: 'false' },
    { key: 'feature_source_listing_web_media', value: 'false' },
    { key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":8,"tenantIds":[]}' },
  ],
]) {
  const result = run(rows);
  assert.equal(result.status, 0, `safe AI Media rollout should pass: ${result.stderr}`);
  assert.match(result.stdout, /PASS AI Media rollout is dark/u);
  assert.match(result.stdout, /master=(?:false|absent); suite=(?:false|absent); fullEdit=(?:false|absent); inpaint=(?:false|absent); webMedia=(?:false|absent); policy=/u);
}

for (const rows of [
  [{ key: 'feature_ai_media_workflow_v2', value: 'true' }],
  [{ key: 'feature_ai_media_workflow_v2', value: 'invalid' }],
  [{ key: 'feature_ai_media_suite', value: 'true' }],
  [{ key: 'feature_ai_media_suite', value: 'invalid' }],
  [{ key: 'feature_ai_media_full_edit', value: 'true' }],
  [{ key: 'feature_ai_media_full_edit', value: 'invalid' }],
  [{ key: 'feature_ai_media_inpaint', value: 'true' }],
  [{ key: 'feature_ai_media_inpaint', value: 'invalid' }],
  [{ key: 'feature_source_listing_web_media', value: 'true' }],
  [{ key: 'feature_source_listing_web_media', value: 'invalid' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{}' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{bad json' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":0,"tenantIds":["owner-1"]}' }],
]) {
  const result = run(rows);
  assert.notEqual(result.status, 0, 'unsafe AI Media rollout must fail deployment verification');
  assert.match(result.stderr, /FAIL AI Media rollout is not dark/u);
}

assert.match(
  verifyVpsDeploy,
  /verify-ai-media-dark\.sh/u,
  'VPS verification must assert AI Media remains dark',
);
assert.match(
  verifyDeployReadiness,
  /verify-ai-media-dark\.sh/u,
  'deploy readiness must assert AI Media remains dark before switching releases',
);

for (const entrypoint of deployEntrypoints) {
  const migrationIndex = entrypoint.source.indexOf('npx prisma migrate deploy');
  const darkVerificationIndex = entrypoint.source.indexOf('verify-ai-media-dark.sh', migrationIndex);
  const boundaryIndex = entrypoint.source.indexOf(entrypoint.boundary, migrationIndex);

  assert.ok(migrationIndex >= 0, `${entrypoint.name} must run Prisma migrations`);
  assert.match(
    entrypoint.source,
    /MIGRATION_TIMEOUT="\$\{MIGRATION_TIMEOUT:-20m\}"/u,
    `${entrypoint.name} must set a bounded default migration timeout`,
  );
  assert.match(
    entrypoint.source,
    /timeout --signal=TERM --kill-after=30s ["']?\$MIGRATION_TIMEOUT["']? npx prisma migrate deploy/u,
    `${entrypoint.name} must enforce the migration timeout outside Prisma`,
  );
  assert.ok(
    darkVerificationIndex > migrationIndex,
    `${entrypoint.name} must verify the dark rollout after migrations`,
  );
  assert.ok(
    boundaryIndex > darkVerificationIndex,
    `${entrypoint.name} must verify the dark rollout before switching or restarting services`,
  );
  assert.match(entrypoint.source, /set -euo pipefail/u, `${entrypoint.name} must fail closed`);
  assert.match(
    entrypoint.source,
    /Worker\/API remain stopped after failed [^\r\n]+operator recovery is required/u,
    `${entrypoint.name} must keep provider services stopped after migration or gate failure`,
  );
  assert.doesNotMatch(
    entrypoint.source,
    /Restoring current Worker\/API after failed deploy/u,
    `${entrypoint.name} must not automatically restart services after a failed migration or gate`,
  );
  assert.doesNotMatch(
    entrypoint.source,
    /verify-ai-media-dark\.sh[^\r\n]*(?:\|\|\s*true|&\s*$)/mu,
    `${entrypoint.name} must not ignore dark-rollout verification failures`,
  );
}

const stagingDeploy = deployEntrypoints.find((entrypoint) => entrypoint.name === 'staging deploy').source;
assert.ok(
  stagingDeploy.indexOf('MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"')
    > stagingDeploy.indexOf('. "$ENV_FILE"'),
  'staging must validate the effective migration timeout after loading its environment file',
);
assert.match(
  stagingDeploy,
  /if ! DEPLOY_DIR="\$DEPLOY_DIR" ENV_FILE="\$ENV_FILE" bash scripts\/verify-ai-media-dark\.sh; then[\s\S]*SERVICES_QUIESCED=0[\s\S]*Worker\/API remain stopped[\s\S]*exit 1/u,
  'an in-place staging deploy must leave provider services stopped when the dark check fails',
);

const releaseDeploy = deployEntrypoints.find((entrypoint) => entrypoint.name === 'release symlink deploy').source;
assert.match(
  releaseDeploy,
  /REQUESTED_MIGRATION_TIMEOUT="\$\{14\}"[\s\S]*\. "\$ENV_FILE_NAME"[\s\S]*MIGRATION_TIMEOUT="\$REQUESTED_MIGRATION_TIMEOUT"/u,
  'release deploys must restore the validated timeout after loading the release environment',
);

assert.match(
  preflight,
  /scripts\/ai-media-dark-deploy\.test\.mjs/u,
  'preflight must include the static AI Media dark-deployment contract',
);
assert.match(ciWorkflow, /pnpm --filter server test(?:\s|$)/u, 'CI must run the server test suite');
assert.match(ciWorkflow, /image:\s*postgres:16(?:\s|$)/u, 'CI must use PostgreSQL 16');
assert.match(
  ciWorkflow,
  /pnpm --filter server test:ai-media:postgres/u,
  'CI must replay migrations and run the AI Media PostgreSQL integration suite',
);
assert.match(
  ciWorkflow,
  /node scripts\/ai-media-dark-deploy\.test\.mjs/u,
  'CI must run the static AI Media dark-deployment contract',
);
assert.match(
  ciWorkflow,
  /postgres-integration:[\s\S]*timeout-minutes: 20[\s\S]*image:\s*postgres:16/u,
  'CI must bound the PostgreSQL migration replay job',
);

assert.match(concurrentIndexMigration, /CREATE UNIQUE INDEX CONCURRENTLY/u);
assert.equal(
  concurrentIndexMigration.split(';').filter((statement) => statement.trim()).length,
  1,
  'the concurrent index migration must remain a single autocommit statement',
);
assert.doesNotMatch(concurrentIndexMigration, /\bBEGIN\b|\bCOMMIT\b|\bSET\b|\bRESET\b/u);

assert.match(serverDockerfile, /COPY docker\/migrate-and-verify-ai-media-dark\.sh/u);
assert.match(serverDockerfile, /COPY docker\/verify-ai-media-dark\.mjs/u);
assert.match(serverDockerfile, /COPY scripts\/verify-ai-media-dark-policy\.mjs/u);
for (const [name, compose] of composeDeployments) {
  assert.match(
    compose,
    /migrate:[\s\S]*command:\s*\["sh", "scripts\/migrate-and-verify-ai-media-dark\.sh"\]/u,
    `${name} must run the bounded migrate-and-dark-verify gate`,
  );
  assert.match(
    composeServiceBlock(compose, 'migrate'),
    /MIGRATION_TIMEOUT:\s*\$\{MIGRATION_TIMEOUT:-20m\}/u,
    `${name} must forward the validated migration timeout into the migrate container`,
  );
  assert.match(
    compose.split(/\r?\n/u)[1] || '',
    /deploy-compose\.sh/u,
    `${name} must direct upgrades through the quiescing deployment wrapper`,
  );
  for (const service of ['api', 'worker']) {
    const serviceBlock = composeServiceBlock(compose, service);
    assert.match(
      serviceBlock,
      /migrate:[\s\S]*condition:\s*service_completed_successfully/u,
      `${name} ${service} must wait for the migrate gate to succeed`,
    );
  }
}

const composeMigrationIndex = composeMigrationWrapper.indexOf('npx prisma migrate deploy');
const composeDarkVerificationIndex = composeMigrationWrapper.indexOf(
  'node scripts/verify-ai-media-dark.mjs',
);
assert.match(composeMigrationWrapper, /^set -eu$/mu);
assert.match(composeMigrationWrapper, /MIGRATION_TIMEOUT="\$\{MIGRATION_TIMEOUT:-20m\}"/u);
assert.match(
  composeMigrationWrapper,
  /timeout --signal=TERM --kill-after=30s "\$MIGRATION_TIMEOUT" npx prisma migrate deploy/u,
);
assert.ok(
  composeDarkVerificationIndex > composeMigrationIndex,
  'Compose must verify the dark policy only after migrations succeed',
);
assert.doesNotMatch(composeMigrationWrapper, /\|\|\s*true/u);
assert.match(composeDarkVerifier, /PrismaClient/u);
assert.match(composeDarkVerifier, /verifyAiMediaDarkPolicy/u);

const composeBuildIndex = composeDeploy.indexOf('"${COMPOSE[@]}" build');
const composeStopIndex = composeDeploy.indexOf('stop worker api web');
const composeGateIndex = composeDeploy.indexOf('run --rm --no-deps migrate');
const composeStartIndex = composeDeploy.indexOf(
  'up -d --wait --force-recreate --no-deps api worker web',
);
assert.match(composeDeploy, /^set -euo pipefail$/mu);
const composeProcessTimeoutIndex = composeDeploy.indexOf(
  'PROCESS_MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT-}"',
);
const composeUnsetTimeoutIndex = composeDeploy.indexOf('unset MIGRATION_TIMEOUT');
const composeEnvTimeoutIndex = composeDeploy.indexOf('done < "$ENV_FILE"');
const composeDefaultTimeoutIndex = composeDeploy.indexOf(
  'MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"',
);
const composeExportTimeoutIndex = composeDeploy.indexOf('export ENV_FILE MIGRATION_TIMEOUT');
assert.ok(
  composeProcessTimeoutIndex >= 0
    && composeProcessTimeoutIndex < composeUnsetTimeoutIndex
    && composeUnsetTimeoutIndex < composeEnvTimeoutIndex
    && composeEnvTimeoutIndex < composeDefaultTimeoutIndex
    && composeDefaultTimeoutIndex < composeExportTimeoutIndex,
  'Compose deploys must prefer a non-empty process timeout, otherwise load the env-file timeout before applying the default',
);
assert.match(
  composeDeploy,
  /MIGRATION_TIMEOUT in \$ENV_FILE must be a literal positive duration/u,
  'Compose deploys must reject malformed env-file timeout values before quiescing services',
);
assert.ok(composeBuildIndex >= 0 && composeBuildIndex < composeStopIndex);
assert.ok(composeStopIndex < composeGateIndex, 'Compose must stop old services before migration');
assert.ok(composeGateIndex < composeStartIndex, 'Compose must pass the gate before starting services');
assert.match(
  composeDeploy,
  /API\/Worker\/Web remain stopped; inspect migrate logs and the recovery runbook/u,
);
assert.doesNotMatch(
  composeDeploy,
  /keep_quiesced_on_failure[\s\S]*docker compose[\s\S]*restart/u,
);

for (const key of [
  'feature_ai_media_workflow_v2',
  'feature_ai_media_suite',
  'feature_ai_media_full_edit',
  'feature_ai_media_inpaint',
  'feature_source_listing_web_media',
  'ai_media_workflow_v2_rollout_policy',
]) {
  assert.match(
    verifyAiMediaDark,
    new RegExp(`['"]${key}['"]`, 'u'),
    `AI Media dark query must fetch ${key}`,
  );
  assert.match(
    composeDarkVerifier,
    new RegExp(`['"]${key}['"]`, 'u'),
    `Compose AI Media dark query must fetch ${key}`,
  );
}

console.log('PASS AI Media dark deployment guards');
