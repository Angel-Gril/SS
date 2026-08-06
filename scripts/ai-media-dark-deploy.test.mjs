import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
const deployBackupVerifier = readFileSync('scripts/verify-deploy-backup.sh', 'utf8');
const deployBackupGate = readFileSync('scripts/deploy-backup-gate.mjs', 'utf8');
const deployBackupGateInstaller = readFileSync('scripts/install-deploy-backup-gate.sh', 'utf8');
const composeDarkVerifier = readFileSync('docker/verify-ai-media-dark.mjs', 'utf8');
const composeDeploy = readFileSync('scripts/deploy-compose.sh', 'utf8');
const dockerIgnore = readFileSync('.dockerignore', 'utf8');
const gitIgnore = readFileSync('.gitignore', 'utf8');
assert.match(
  composeDeploy,
  /must run as a non-root deployment operator/u,
  'Compose deploy must not execute repository-local Git configuration as root',
);
assert.match(composeDeploy, /snapshot-file "\$SOURCE_COMPOSE_FILE" "\$COMPOSE_FILE"/u);
assert.match(composeDeploy, /--project-directory "\$SOURCE_SNAPSHOT_ROOT"/u);
assert.match(composeDeploy, /SNAPSHOT_TOOL" materialize/u);
assert.doesNotMatch(composeDeploy, /git archive/u);
assert.match(composeDeploy, /\/var\/lib\/ss-erp-deploy-locks/u);
assert.match(dockerIgnore, /^\.env\*$/mu);
assert.match(dockerIgnore, /^\*\*\/\.env\*$/mu);
assert.match(dockerIgnore, /^tmp$/mu);
assert.match(dockerIgnore, /^\*\*\/tmp$/mu);
assert.match(gitIgnore, /^\.env\*$/mu);
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

const symlinkRoot = mkdtempSync(join(tmpdir(), 'ss-erp-dark-policy-symlink-'));
try {
  const scriptsLink = join(symlinkRoot, 'scripts');
  symlinkSync(resolve('scripts'), scriptsLink, process.platform === 'win32' ? 'junction' : 'dir');
  const darkResult = spawnSync(process.execPath, [
    join(scriptsLink, 'verify-ai-media-dark-policy.mjs'),
    '[]',
  ], { encoding: 'utf8' });
  assert.equal(darkResult.status, 0, darkResult.stderr);
  assert.match(darkResult.stdout, /PASS AI Media rollout is dark/u);

  const byokResult = spawnSync(process.execPath, [
    join(scriptsLink, 'verify-extension-byok-rollout-policy.mjs'),
    'off',
    '[]',
  ], { encoding: 'utf8' });
  assert.equal(byokResult.status, 0, byokResult.stderr);
  assert.match(byokResult.stdout, /PASS Extension BYOK rollout matches off/u);
} finally {
  rmSync(symlinkRoot, { recursive: true, force: true });
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
  const ingestPilot = expectation === 'ingest-pilot' || expectation === 'publish-pilot';
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
    { key: 'feature_extension_byok_ingest', value: ingestPilot ? 'true' : 'false' },
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

for (const [expectation, expectedFlags] of [
  ['sandbox-pilot', 'generation=true; ingest=false; publish=false'],
  ['ingest-pilot', 'generation=true; ingest=true; publish=false'],
  ['publish-pilot', 'generation=true; ingest=true; publish=true'],
]) {
  const result = runExtensionByok(
    expectation,
    extensionByokPilotRows(expectation),
    pilotExpectation,
  );
  assert.equal(result.status, 0, `${expectation} fixture should pass: ${result.stderr}`);
  assert.match(result.stdout, new RegExp(`matches ${expectation}`, 'u'));
  assert.match(result.stdout, new RegExp(expectedFlags, 'u'));
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
const ingestRows = extensionByokPilotRows('ingest-pilot');
const publishRows = extensionByokPilotRows('publish-pilot');
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
    'ingest pilot ingest disabled',
    ingestRows.map((row) => row.key === 'feature_extension_byok_ingest'
      ? { ...row, value: 'false' }
      : row),
    pilotExpectation,
    'ingest-pilot',
  ],
  [
    'ingest pilot generation disabled',
    ingestRows.map((row) => row.key === 'feature_extension_byok_ai'
      ? { ...row, value: 'false' }
      : row),
    pilotExpectation,
    'ingest-pilot',
  ],
  [
    'ingest pilot publish enabled',
    ingestRows.map((row) => row.key === 'feature_extension_byok_publish'
      ? { ...row, value: 'true' }
      : row),
    pilotExpectation,
    'ingest-pilot',
  ],
  [
    'publish pilot ingest disabled',
    publishRows.map((row) => row.key === 'feature_extension_byok_ingest'
      ? { ...row, value: 'false' }
      : row),
    pilotExpectation,
    'publish-pilot',
  ],
  [
    'publish pilot generation disabled',
    publishRows.map((row) => row.key === 'feature_extension_byok_ai'
      ? { ...row, value: 'false' }
      : row),
    pilotExpectation,
    'publish-pilot',
  ],
  [
    'publish pilot publish disabled',
    publishRows.map((row) => row.key === 'feature_extension_byok_publish'
      ? { ...row, value: 'false' }
      : row),
    pilotExpectation,
    'publish-pilot',
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

for (const [name, rows, expected, expectation = 'sandbox-pilot'] of pilotFailureCases) {
  const result = runExtensionByok(expectation, rows, expected);
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
  /off', 'sandbox-pilot', 'ingest-pilot', 'publish-pilot/u,
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
    /sandbox-pilot|ingest-pilot|publish-pilot/u,
    'production dark deployment entrypoints must not accept a pilot expectation',
  );
}

for (const entrypoint of deployEntrypoints) {
  const migrationIndex = entrypoint.source.indexOf('deploy-backup-gate.mjs');
  const backupGateIndex = entrypoint.source.indexOf('deploy-backup-gate.mjs');
  const darkVerificationIndex = entrypoint.source.indexOf('verify-ai-media-dark.sh', migrationIndex);
  const boundaryIndex = entrypoint.source.indexOf(entrypoint.boundary, migrationIndex);

  assert.ok(migrationIndex >= 0, `${entrypoint.name} must invoke the bound migration orchestrator`);
  assert.ok(
    backupGateIndex >= 0 && backupGateIndex === migrationIndex,
    `${entrypoint.name} must verify commit/database/restore-bound backup evidence before migration`,
  );
  assert.match(
    entrypoint.source,
    /MIGRATION_TIMEOUT="\$\{MIGRATION_TIMEOUT:-20m\}"/u,
    `${entrypoint.name} must set a bounded default migration timeout`,
  );
  assert.match(entrypoint.source, /--migration-timeout "\$MIGRATION_TIMEOUT"/u);
  assert.doesNotMatch(entrypoint.source, /npx prisma migrate deploy/u);
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
    /(?:Worker\/API(?:\/Web)? remain stopped after failed [^\r\n]+|Persistent maintenance remains active after failure; )operator recovery is required/u,
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
    > stagingDeploy.indexOf('deploy-environment.mjs value "$ENV_FILE" MIGRATION_TIMEOUT'),
  'staging must validate the effective migration timeout after parsing its environment as data',
);
assert.doesNotMatch(stagingDeploy, /^\. "\$ENV_FILE"$/mu);
assert.match(stagingDeploy, /pnpm install --frozen-lockfile --force/u);
assert.match(stagingDeploy, /freeze-deploy-source\.sh[\s\S]*freeze/u);
const stagingDarkFailure = stagingDeploy.slice(
  stagingDeploy.indexOf('if ! DEPLOY_DIR="$DEPLOY_DIR"'),
  stagingDeploy.indexOf('echo "[6/7] Restarting services..."'),
);
assert.doesNotMatch(stagingDarkFailure, /SERVICES_QUIESCED=0/u);
assert.match(stagingDarkFailure, /Worker\/API remain stopped[\s\S]*exit 1/u);
assert.match(stagingDeploy, /git[^\r\n]*status --porcelain --untracked-files=all/u);
assert.match(stagingDeploy, /readonly TARGET_GIT_COMMIT="\$\(assert_clean_staging_checkout\)"/u);
assert.match(stagingDeploy, /deploy-source-manifest\.mjs" create-closed/u);
assert.doesNotMatch(stagingDeploy, /^\s*sudo\b[^\r\n]*(?:\s|\/)git(?:\s|$)/mu);
assert.ok(
  stagingDeploy.lastIndexOf('SERVICES_QUIESCED=0')
    > stagingDeploy.indexOf('echo "Web: OK"'),
  'staging must remain fail-closed until API and Web health checks pass',
);

const releaseDeploy = deployEntrypoints.find((entrypoint) => entrypoint.name === 'release symlink deploy').source;
assert.match(
  releaseDeploy,
  /readonly REQUESTED_MIGRATION_TIMEOUT="\$\{REQUESTED_MIGRATION_TIMEOUT:\?\}"[\s\S]*readonly MIGRATION_TIMEOUT="\$REQUESTED_MIGRATION_TIMEOUT"/u,
  'release deploys must freeze the operator-validated migration timeout before app env use',
);
assert.match(releaseDeploy, /readonly TARGET_GIT_COMMIT="\$\{TARGET_GIT_COMMIT:\?\}"/u);
assert.match(releaseDeploy, /deploy-backup-gate\.mjs/u);
assert.doesNotMatch(releaseDeploy, /^\. "\$ENV_FILE_NAME"$/mu);

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

assert.match(serverDockerfile, /COPY[^\r\n]*\/docker\/migrate-and-verify-ai-media-dark\.sh/u);
assert.match(serverDockerfile, /COPY[^\r\n]*\/docker\/verify-ai-media-dark\.mjs/u);
assert.match(serverDockerfile, /COPY[^\r\n]*\/scripts\/deploy-backup-attestation\.mjs/u);
assert.match(serverDockerfile, /COPY[^\r\n]*\/scripts\/deploy-backup-gate\.mjs/u);
assert.match(serverDockerfile, /postgresql-client/u);
assert.match(serverDockerfile, /COPY[^\r\n]*\/scripts\/deploy-database-identity\.mjs/u);
assert.match(serverDockerfile, /COPY[^\r\n]*\/scripts\/verify-deploy-backup\.sh/u);
assert.match(serverDockerfile, /COPY[^\r\n]*\/scripts\/verify-ai-media-dark-policy\.mjs/u);
assert.match(serverDockerfile, /COPY[^\r\n]*\/scripts\/verify-extension-byok-rollout-policy\.mjs/u);
assert.match(serverDockerfile, /\.ss-erp-source\.tar[\s\S]*sha256sum -c -/u);
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
    composeServiceBlock(compose, 'migrate'),
    /DEPLOY_TARGET_GIT_COMMIT:[\s\S]*BACKUP_LOCAL_DIR[\s\S]*read_only:\s*true/u,
    `${name} migrate must receive the exact target commit and a read-only backup evidence mount`,
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
const composeBackupGateIndex = composeMigrationWrapper.indexOf('verify-deploy-backup.sh');
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
  composeBackupGateIndex >= 0 && composeBackupGateIndex < composeMigrationIndex,
  'Compose must verify commit/database/restore-bound backup evidence before migration',
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
assert.match(composeDeploy, /git "\$\{GIT_SAFE_ARGS\[@\]\}" rev-parse --verify --end-of-options 'HEAD\^\{commit\}'/u);
assert.match(composeDeploy, /git "\$\{GIT_SAFE_ARGS\[@\]\}" status --porcelain --untracked-files=all/u);
assert.match(composeDeploy, /could not inspect Compose deployment Git worktree/u);
assert.doesNotMatch(composeDeploy, /CURRENT_WORKTREE_STATUS/u);
assert.match(composeDeploy, /\.ss-erp-source\.tar/u);
assert.match(composeDeploy, /DEPLOY_SOURCE_ARCHIVE_SHA256/u);
assert.match(composeDeploy, /\[ -L DEPLOYED_COMMIT \] \|\| \[ -e DEPLOYED_COMMIT \]/u);
assert.doesNotMatch(composeDeploy, /\. "\$ENV_FILE"/u);
assert.match(composeDeploy, /readonly TARGET_GIT_COMMIT="\$COMMIT_HASH"/u);
assert.match(composeDeploy, /DEPLOY_TARGET_GIT_COMMIT="\$TARGET_GIT_COMMIT"/u);
assert.match(composeMigrationWrapper, /migration image provenance does not match/u);
assert.match(
  composeDeploy,
  /COMPOSE_FILE must be docker-compose\.prod\.yml or docker-compose\.staging\.yml/u,
);
assert.match(composeDeploy, /must run from the exact repository root/u);
assert.match(deployBackupVerifier, /DEPLOY_BACKUP_MAX_AGE_MINUTES:-120/u);
assert.match(deployBackupVerifier, /DEPLOY_DATABASE_URL="\$DATABASE_URL"/u);
assert.doesNotMatch(deployBackupVerifier, /DEPLOY_BACKUP_LOCAL_DIR:-\$\{BACKUP_LOCAL_DIR/u);
assert.match(deployBackupVerifier, /deploy-backup-\$\{TARGET_GIT_COMMIT\}\.attestation\.json/u);
assert.match(deployBackupGate, /parseEnv/u);
assert.match(deployBackupGate, /TARGET_GIT_COMMIT/u);
assert.match(deployBackupGate, /'pnpm', 'exec', 'prisma', 'migrate', 'deploy'/u);
assert.doesNotMatch(deployBackupGate, /\.\.\.process\.env/u);
assert.doesNotMatch(deployBackupGate, /`DATABASE_URL=\$\{/u);
assert.match(deployBackupGate, /DATABASE_URL: environment\.DATABASE_URL/u);
assert.match(deployBackupGate, /--preserve-environment/u);
assert.match(deployBackupGate, /installed deployment gate does not match the target Git commit/u);
const appDirEntrypoint = deployEntrypoints[1].source;
assert.ok(
  appDirEntrypoint.indexOf('install_target_backup_gate "$NEXT_DIR"')
    < appDirEntrypoint.indexOf('chown -hR -P'),
  'app-dir deploy must install the immutable root gate before release ownership changes',
);
assert.ok(
  releaseDeploy.indexOf('install_target_backup_gate "$RELEASE_DIR"')
    < releaseDeploy.indexOf('chown -hR -P "$DEPLOY_BUILD_USER'),
  'release deploy must install the immutable root gate before release ownership changes',
);
for (const entrypoint of deployEntrypoints.slice(0, 2)) {
  assert.match(entrypoint.source, /install-deploy-backup-gate\.sh/u);
  assert.match(entrypoint.source, /ss-erp-deploy-upload\.XXXXXXXXXX/u);
  assert.match(entrypoint.source, /sha256sum "\$TARBALL"/u);
}
assert.match(deployBackupGateInstaller, /\[ "\$\(id -u\)" != "0" \]/u);
assert.match(deployBackupGateInstaller, /source root must be one real canonical directory/u);
assert.match(deployBackupGateInstaller, /assert_trusted_ancestor_chain/u);
assert.match(deployBackupGateInstaller, /mv -T -- "\$STAGE_DIR" "\$TARGET_DIR"/u);
assert.match(appDirEntrypoint, /deployment runtime user is missing/u);
assert.doesNotMatch(
  appDirEntrypoint,
  /if id "\$DEPLOY_RUN_USER"[\s\S]*else[\s\S]*bash -lc/u,
);
assert.match(stagingDeploy, /DEPLOY_BACKUP_GATE_ROOT=\/usr\/local\/lib\/ss-erp-deploy-gate/u);
assert.match(stagingDeploy, /assert_installed_target_backup_gate "\$TARGET_GIT_COMMIT"/u);
assert.doesNotMatch(stagingDeploy, /--skip-build|SKIP_BUILD/u);
assert.match(composeDeploy, /--project-name "\$DEPLOY_COMPOSE_PROJECT"/u);
assert.match(composeDeploy, /unset COMPOSE_PROJECT_NAME/u);
assert.match(composeDeploy, /unset COMPOSE_PROJECT_NAME DEPLOY_BACKUP_LOCAL_DIR/u);
assert.match(composeDeploy, /node "\$DEPLOY_ENV_TOOL" snapshot "\$SOURCE_ENV_FILE" "\$ENV_FILE"/u);
assert.match(composeDeploy, /validate-env\.mjs"[\s\\\r\n]*--profile cloud-bootstrap --env "\$ENV_FILE"/u);
assert.match(composeDeploy, /ss-erp-compose-env\.XXXXXXXXXX/u);
for (const [name, compose] of composeDeployments) {
  assert.match(compose, /target: \/var\/backups\/ss-erp-deploy/u, `${name} must use a fixed backup mount target`);
  assert.doesNotMatch(
    compose,
    /target: \$\{DEPLOY_BACKUP_LOCAL_DIR/u,
    `${name} must not let backup configuration replace image paths`,
  );
}
assert.equal((composeDeploy.match(/verify-deploy-build-inputs\.mjs/gu) || []).length, 1);
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
