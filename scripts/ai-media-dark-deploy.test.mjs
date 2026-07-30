import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const verifier = 'scripts/verify-ai-media-dark-policy.mjs';
const extensionByokVerifier = 'scripts/verify-extension-byok-rollout-policy.mjs';
const aiMediaDarkPolicy = readFileSync(verifier, 'utf8');
const extensionByokVerifierSource = readFileSync(extensionByokVerifier, 'utf8');
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

function runExtensionByok(expectation, rows, expected) {
  const args = [extensionByokVerifier, expectation, JSON.stringify(rows)];
  if (expected !== undefined) args.push(JSON.stringify(expected));
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

const defaultExtensionByokPolicy = {
  contractVersion: 'extension-byok-admin-policy/v1',
  revision: 0,
  mode: 'off',
  ownerUserIds: [],
  shopIds: [],
  deviceSessionIds: [],
  allowedOrigins: [],
  allowedOperations: [],
  maxConcurrency: 1,
};
const pilotExpectation = {
  hostedAiEnabled: false,
  revision: 17,
  ownerUserIds: ['owner-pilot-1'],
  shopIds: ['shop-pilot-1'],
  deviceSessionIds: ['device-session-pilot-1'],
  allowedOrigins: ['https://provider.example'],
  allowedOperations: ['TEXT_TO_IMAGE', 'INPAINT'],
};

function extensionByokPilotRows(expectation, overrides = {}) {
  const publishPilot = expectation === 'publish-pilot';
  const policy = {
    ...defaultExtensionByokPolicy,
    revision: pilotExpectation.revision,
    mode: 'pilot',
    ownerUserIds: [...pilotExpectation.ownerUserIds],
    shopIds: [...pilotExpectation.shopIds],
    deviceSessionIds: [...pilotExpectation.deviceSessionIds],
    allowedOrigins: [...pilotExpectation.allowedOrigins],
    allowedOperations: [...pilotExpectation.allowedOperations],
    ...(overrides.policy || {}),
  };
  return [
    { key: 'feature_extension_hosted_ai', value: 'false' },
    { key: 'feature_extension_byok_ai', value: 'true' },
    { key: 'feature_extension_byok_ingest', value: publishPilot ? 'true' : 'false' },
    { key: 'feature_extension_byok_publish', value: publishPilot ? 'true' : 'false' },
    { key: 'extension_byok_admin_policy', value: JSON.stringify(policy) },
  ];
}

function composeServiceBlock(compose, service) {
  const match = new RegExp(`^ {2}${service}:\\s*$`, 'mu').exec(compose);
  const start = match?.index ?? -1;
  assert.ok(start >= 0, `Compose service is missing: ${service}`);
  const remainder = compose.slice(start);
  const firstLineEnd = remainder.indexOf('\n');
  const nextService = remainder.slice(firstLineEnd + 1).search(/^ {2}[a-z0-9_-]+:\s*$/mu);
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
    { key: 'feature_ai_media_image_to_image', value: 'false' },
    { key: 'feature_ai_media_suite', value: 'false' },
    { key: 'feature_ai_media_full_edit', value: 'false' },
    { key: 'feature_ai_media_inpaint', value: 'false' },
    { key: 'feature_source_listing_web_media', value: 'false' },
    { key: 'feature_source_listing_extension_workbench', value: 'false' },
    { key: 'feature_source_ozon_publisher_v2', value: 'false' },
    { key: 'ai_image_generation_enabled', value: 'true' },
    { key: 'ai_image_provider', value: 'disabled' },
    { key: 'feature_image_translate', value: 'true' },
    { key: 'ai_image_translation_provider', value: 'disabled' },
    { key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":8,"tenantIds":[]}' },
  ],
]) {
  const result = run(rows);
  assert.equal(result.status, 0, `safe AI Media rollout should pass: ${result.stderr}`);
  assert.match(result.stdout, /PASS AI Media rollout is dark/u);
  assert.match(result.stdout, /master=(?:false|absent); imageToImage=(?:false|absent); suite=(?:false|absent); fullEdit=(?:false|absent); inpaint=(?:false|absent); webMedia=(?:false|absent); extensionWorkbench=(?:false|absent); ozonPublisher=(?:false|absent); legacyGeneration=.+; imageTranslation=.+; extensionByok=off; policy=/u);
}

for (const rows of [
  [],
  [
    { key: 'feature_extension_hosted_ai', value: 'false' },
    { key: 'feature_extension_byok_ai', value: 'false' },
    { key: 'feature_extension_byok_ingest', value: 'false' },
    { key: 'feature_extension_byok_publish', value: 'false' },
    { key: 'extension_byok_admin_policy', value: JSON.stringify(defaultExtensionByokPolicy) },
  ],
]) {
  const result = runExtensionByok('off', rows);
  assert.equal(result.status, 0, `extension BYOK off fixture should pass: ${result.stderr}`);
  assert.match(result.stdout, /PASS Extension BYOK rollout matches off/u);
}

for (const expectation of ['sandbox-pilot', 'publish-pilot']) {
  const result = runExtensionByok(
    expectation,
    extensionByokPilotRows(expectation),
    pilotExpectation,
  );
  assert.equal(result.status, 0, `${expectation} fixture should pass: ${result.stderr}`);
  assert.match(result.stdout, new RegExp(`matches ${expectation}`, 'u'));
}

const hostedPilot = {
  ...pilotExpectation,
  hostedAiEnabled: true,
};
const hostedPilotRows = extensionByokPilotRows('sandbox-pilot');
hostedPilotRows[0] = { key: 'feature_extension_hosted_ai', value: 'true' };
assert.equal(
  runExtensionByok('sandbox-pilot', hostedPilotRows, hostedPilot).status,
  0,
  'pilot hosted AI state may vary only when it is explicitly expected',
);

for (const rows of [
  [{ key: 'feature_extension_hosted_ai', value: 'true' }],
  [{ key: 'feature_extension_byok_ai', value: 'true' }],
  [{ key: 'feature_extension_byok_ingest', value: 'true' }],
  [{ key: 'feature_extension_byok_publish', value: 'true' }],
  [{ key: 'feature_extension_byok_ai', value: ' false ' }],
  [{ key: 'extension_byok_admin_policy', value: '{bad json' }],
  [{
    key: 'extension_byok_admin_policy',
    value: JSON.stringify({ ...defaultExtensionByokPolicy, revision: 1 }),
  }],
  [{
    key: 'extension_byok_admin_policy',
    value: JSON.stringify({ ...defaultExtensionByokPolicy, ownerUserIds: ['owner-1'] }),
  }],
  [{
    key: 'extension_byok_admin_policy',
    value: JSON.stringify({ ...defaultExtensionByokPolicy, maxConcurrency: 2 }),
  }],
]) {
  const result = runExtensionByok('off', rows);
  assert.notEqual(result.status, 0, 'extension BYOK off expectation must fail closed');
  assert.match(result.stderr, /FAIL Extension BYOK rollout mismatch/u);
}

const sandboxRows = extensionByokPilotRows('sandbox-pilot');
const pilotFailureCases = [
  ['missing hosted flag', sandboxRows.slice(1), pilotExpectation],
  [
    'generation disabled',
    sandboxRows.map((row) => row.key === 'feature_extension_byok_ai'
      ? { ...row, value: 'false' }
      : row),
    pilotExpectation,
  ],
  [
    'sandbox ingest enabled',
    sandboxRows.map((row) => row.key === 'feature_extension_byok_ingest'
      ? { ...row, value: 'true' }
      : row),
    pilotExpectation,
  ],
  [
    'sandbox publish enabled',
    sandboxRows.map((row) => row.key === 'feature_extension_byok_publish'
      ? { ...row, value: 'true' }
      : row),
    pilotExpectation,
  ],
  [
    'missing policy',
    sandboxRows.filter((row) => row.key !== 'extension_byok_admin_policy'),
    pilotExpectation,
  ],
  [
    'wrong policy contract',
    extensionByokPilotRows('sandbox-pilot', {
      policy: { contractVersion: 'extension-byok-admin-policy/v2' },
    }),
    pilotExpectation,
  ],
  [
    'wrong revision',
    extensionByokPilotRows('sandbox-pilot', { policy: { revision: 18 } }),
    pilotExpectation,
  ],
  [
    'global policy mode',
    extensionByokPilotRows('sandbox-pilot', { policy: { mode: 'global' } }),
    pilotExpectation,
  ],
  [
    'excess concurrency',
    extensionByokPilotRows('sandbox-pilot', { policy: { maxConcurrency: 2 } }),
    pilotExpectation,
  ],
  [
    'owner allowlist mismatch',
    extensionByokPilotRows('sandbox-pilot', { policy: { ownerUserIds: ['owner-pilot-2'] } }),
    pilotExpectation,
  ],
  [
    'shop allowlist mismatch',
    extensionByokPilotRows('sandbox-pilot', { policy: { shopIds: ['shop-pilot-2'] } }),
    pilotExpectation,
  ],
  [
    'device allowlist mismatch',
    extensionByokPilotRows('sandbox-pilot', {
      policy: { deviceSessionIds: ['device-session-pilot-2'] },
    }),
    pilotExpectation,
  ],
  [
    'origin allowlist mismatch',
    extensionByokPilotRows('sandbox-pilot', {
      policy: { allowedOrigins: ['https://other-provider.example'] },
    }),
    pilotExpectation,
  ],
  [
    'operation allowlist mismatch',
    extensionByokPilotRows('sandbox-pilot', {
      policy: { allowedOperations: ['TEXT_TO_IMAGE'] },
    }),
    pilotExpectation,
  ],
  [
    'operation allowlist order mismatch',
    extensionByokPilotRows('sandbox-pilot', {
      policy: { allowedOperations: [...pilotExpectation.allowedOperations].reverse() },
    }),
    pilotExpectation,
  ],
  [
    'non-canonical policy origin',
    extensionByokPilotRows('sandbox-pilot', {
      policy: { allowedOrigins: ['https://provider.example/v1'] },
    }),
    pilotExpectation,
  ],
  [
    'policy with an extra field',
    extensionByokPilotRows('sandbox-pilot', { policy: { apiKey: 'not-a-secret-value' } }),
    pilotExpectation,
  ],
  [
    'duplicate config row',
    [...sandboxRows, { ...sandboxRows[0] }],
    pilotExpectation,
  ],
];

for (const [name, rows, expected] of pilotFailureCases) {
  const result = runExtensionByok('sandbox-pilot', rows, expected);
  assert.notEqual(result.status, 0, `${name} must fail closed`);
  assert.match(result.stderr, /FAIL Extension BYOK rollout mismatch/u);
}

for (const [name, expectation, rows, expected] of [
  ['unknown expectation', 'pilot', sandboxRows, pilotExpectation],
  ['missing pilot expectations', 'sandbox-pilot', sandboxRows, undefined],
  [
    'missing explicit hosted expectation',
    'sandbox-pilot',
    sandboxRows,
    Object.fromEntries(Object.entries(pilotExpectation).filter(([key]) => key !== 'hostedAiEnabled')),
  ],
  [
    'empty expected identity list',
    'sandbox-pilot',
    sandboxRows,
    { ...pilotExpectation, ownerUserIds: [] },
  ],
  [
    'non-canonical expected origin',
    'sandbox-pilot',
    sandboxRows,
    { ...pilotExpectation, allowedOrigins: ['https://provider.example/v1'] },
  ],
]) {
  const result = runExtensionByok(expectation, rows, expected);
  assert.notEqual(result.status, 0, `${name} must fail closed`);
  assert.match(result.stderr, /FAIL Extension BYOK rollout mismatch/u);
}

for (const rows of [
  [{ key: 'feature_ai_media_workflow_v2', value: 'true' }],
  [{ key: 'feature_ai_media_workflow_v2', value: 'invalid' }],
  [{ key: 'feature_ai_media_image_to_image', value: 'true' }],
  [{ key: 'feature_ai_media_image_to_image', value: 'invalid' }],
  [{ key: 'feature_ai_media_suite', value: 'true' }],
  [{ key: 'feature_ai_media_suite', value: 'invalid' }],
  [{ key: 'feature_ai_media_full_edit', value: 'true' }],
  [{ key: 'feature_ai_media_full_edit', value: 'invalid' }],
  [{ key: 'feature_ai_media_inpaint', value: 'true' }],
  [{ key: 'feature_ai_media_inpaint', value: 'invalid' }],
  [{ key: 'feature_source_listing_web_media', value: 'true' }],
  [{ key: 'feature_source_listing_web_media', value: 'invalid' }],
  [{ key: 'feature_source_listing_extension_workbench', value: 'true' }],
  [{ key: 'feature_source_listing_extension_workbench', value: 'invalid' }],
  [{ key: 'feature_source_ozon_publisher_v2', value: 'true' }],
  [{ key: 'feature_source_ozon_publisher_v2', value: 'invalid' }],
  [
    { key: 'ai_image_generation_enabled', value: 'true' },
    { key: 'ai_image_provider', value: 'custom' },
  ],
  [
    { key: 'ai_image_generation_enabled', value: 'true' },
    { key: 'ai_image_provider', value: 'openai-images' },
  ],
  [
    { key: 'ai_image_generation_enabled', value: 'true' },
    { key: 'ai_image_provider', value: 'dashscope-wanx' },
  ],
  [{ key: 'ai_image_generation_enabled', value: 'invalid' }],
  [
    { key: 'feature_image_translate', value: 'true' },
    { key: 'ai_image_translation_provider', value: 'dashscope-qwen-mt-image' },
  ],
  [{ key: 'feature_image_translate', value: 'invalid' }],
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
assert.match(
  verifyDeployReadiness,
  /verify-extension-byok-rollout-policy\.mjs/u,
  'deploy readiness must require the extension BYOK rollout verifier',
);
assert.match(
  aiMediaDarkPolicy,
  /verifyExtensionByokRolloutPolicy\(rows, \{ expectation: 'off' \}\)/u,
  'production AI Media dark verification must fix extension BYOK expectation to off',
);
assert.match(
  extensionByokVerifierSource,
  /off', 'sandbox-pilot', 'publish-pilot/u,
  'the fixture verifier must expose only the named rollout expectations',
);
assert.match(
  extensionByokVerifierSource,
  /pilot expectations require explicit non-empty IDs, origins, and operations/u,
  'pilot CLI expectations must fail closed without explicit scope lists',
);
for (const productionVerifier of [verifyAiMediaDark, composeDarkVerifier]) {
  assert.doesNotMatch(
    productionVerifier,
    /sandbox-pilot|publish-pilot/u,
    'production dark deployment entrypoints must not accept a pilot expectation',
  );
}

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
assert.match(serverDockerfile, /COPY scripts\/verify-extension-byok-rollout-policy\.mjs/u);
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
  'feature_ai_media_image_to_image',
  'feature_ai_media_suite',
  'feature_ai_media_full_edit',
  'feature_ai_media_inpaint',
  'feature_source_listing_web_media',
  'feature_source_listing_extension_workbench',
  'feature_source_ozon_publisher_v2',
  'ai_image_generation_enabled',
  'ai_image_provider',
  'feature_image_translate',
  'ai_image_translation_provider',
  'ai_media_workflow_v2_rollout_policy',
  'feature_extension_hosted_ai',
  'feature_extension_byok_ai',
  'feature_extension_byok_ingest',
  'feature_extension_byok_publish',
  'extension_byok_admin_policy',
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

assert.match(
  composeDarkVerifier,
  /ozonPublisher=\$\{result\.ozonPublisher\}/u,
  'Compose AI Media dark PASS output must report the Ozon publisher state',
);
assert.match(
  composeDarkVerifier,
  /extensionByok=\$\{result\.extensionByok\.expectation\}/u,
  'Compose AI Media dark PASS output must report the extension BYOK off expectation',
);
assert.match(
  verifyAiMediaDark,
  /EXTENSION_BYOK_POLICY_VERIFIER/u,
  'app-dir verification must require the imported extension BYOK verifier',
);
for (const [name, source] of [
  ['app-dir', verifyAiMediaDark],
  ['Compose', composeDarkVerifier],
]) {
  assert.doesNotMatch(
    source,
    /['"]feature_source_ozon_mapping_v2_write['"]/u,
    `${name} dark gate must not disable the internal Ozon mapping write flag`,
  );
  assert.doesNotMatch(
    source,
    /['"]feature_source_listing_workflow['"]/u,
    `${name} dark gate must not disable the source listing workflow master`,
  );
}

console.log('PASS AI Media dark deployment guards');
