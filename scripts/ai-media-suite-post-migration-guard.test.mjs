import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'apps/server/prisma/migrations/20260724140000_enable_paid_ai_image_suite_execution/migration.sql',
  'utf8',
);
const verifierPath = 'apps/server/scripts/verify-ai-media-suite-post-migration.mjs';
const verifier = readFileSync(verifierPath, 'utf8');
const contractPath = 'apps/server/scripts/ai-media-suite-post-migration-contract.mjs';
const contract = readFileSync(contractPath, 'utf8');
const guardSource = `${verifier}\n${contract}`;
const deployments = [
  ['release symlink', readFileSync('scripts/deploy.sh', 'utf8'), 'echo "[deploy] Restarting services"'],
  ['app-dir', readFileSync('scripts/deploy-app-dir.sh', 'utf8'), 'log "Restarting services"'],
  ['in-place staging', readFileSync('scripts/deploy-staging.sh', 'utf8'), 'echo "[6/7] Restarting services..."'],
];
const deployBackupGate = readFileSync('scripts/deploy-backup-gate.mjs', 'utf8');
const dockerWrapper = readFileSync('docker/migrate-and-verify-ai-media-dark.sh', 'utf8');
const dockerfile = readFileSync('docker/server.Dockerfile', 'utf8');
const verifyVps = readFileSync('scripts/verify-vps-deploy.sh', 'utf8');
const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const postgresUpgrade = readFileSync(
  'apps/server/scripts/ai-media-postgres-upgrade-integration.mjs',
  'utf8',
);

assert.match(migration.trim(), /^BEGIN;[\s\S]*COMMIT;$/u);
assert.match(
  migration,
  /DISABLE TRIGGER "media_assets_referenced_identity_immutable"[\s\S]*UPDATE "media_assets" AS asset[\s\S]*ENABLE TRIGGER "media_assets_referenced_identity_immutable"/u,
  'the exact legacy backfill and trigger restoration must remain atomic',
);
const finalAssetTrigger = migration.indexOf(
  'CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_asset_graph"',
);
assert.ok(finalAssetTrigger >= 0, 'the final asset graph trigger must still be installed');
const migrationTail = migration.slice(finalAssetTrigger);
assert.doesNotMatch(
  migrationTail,
  /FOR\s+stored_suite\s+IN[\s\S]*FROM\s+"ai_media_suites"[\s\S]*"revision"\s*>=\s*5/iu,
  'the lock-holding migration must not scan every dispatched suite after trigger DDL',
);
assert.doesNotMatch(
  migrationTail,
  /assert_ai_media_suite_execution_graph\(stored_suite\./u,
  'production-cardinality graph validation belongs in the post-migration guard',
);

for (const token of [
  '_prisma_migrations',
  '20260724140000_enable_paid_ai_image_suite_execution',
  'finished_at',
  'rolled_back_at',
  'SET TRANSACTION READ ONLY',
  'tgenabled',
  'tgtype',
  'tgdeferrable',
  'tginitdeferred',
  'tgattr',
  'tgfoid',
  'functionSchema',
  'tableSchema',
  'pg_get_triggerdef',
  'media_assets_referenced_identity_immutable',
  'protect_referenced_media_asset_identity()',
  'protect_ai_media_suite_materialized_slot_lifecycle()',
  'protect_ai_media_suite_slot_identity()',
  'prevent_ai_media_suite_child_output_before_dispatch()',
  'protect_ai_media_suite_child_asset_identity()',
  'protect_ai_media_suite_selected_output()',
  'prevent_ai_media_suite_bound_child_insert()',
  'require_ai_media_suite_execution_graph_from_asset()',
  'source_capture_snapshot_id',
  'assert_ai_media_suite_execution_graph',
  'suitesValidated',
]) {
  assert.ok(guardSource.includes(token), `post-migration verifier must contain ${token}`);
}
assert.match(contract, /enabled\s*!==\s*'O'/u);
assert.match(contract, /row\.functionSchema\s*!==\s*row\.tableSchema/u);
assert.match(contract, /critical trigger has the wrong firing contract/u);
assert.match(verifier, /legacyMissing\s*!==\s*0/u);
assert.match(verifier, /invalidApplied/u);
assert.match(verifier, /extension_hosted_ai_image_listing_assignments/u);
assert.match(verifier, /ai_media_application_mutations/u);
assert.match(verifier, /ai_media_listing_draft_application_mutations/u);
assert.match(verifier, /job\."applied_at"\s+IS\s+NOT\s+NULL/u);
assert.match(postgresUpgrade, /validatePostMigrationTriggerFiringGuard/u);
assert.match(postgresUpgrade, /AFTER UPDATE OF "selected_output_asset_id", "review_status"/u);
assert.match(postgresUpgrade, /accepted a trigger bound to a foreign-schema function/u);
assert.match(postgresUpgrade, /wrong pg_proc binding/u);

for (const [label, source, restartBoundary] of deployments) {
  const migrateIndex = source.indexOf('deploy-backup-gate.mjs');
  const modeIndex = source.indexOf('--mode migrate', migrateIndex);
  const restartIndex = source.indexOf(restartBoundary, migrateIndex);
  assert.ok(migrateIndex >= 0 && modeIndex > migrateIndex, `${label} deploy must use the bound migration gate`);
  assert.ok(restartIndex > modeIndex, `${label} deploy must keep API/Worker quiesced through the DB guard`);
}

const gateMigrateIndex = deployBackupGate.indexOf("['pnpm', 'exec', 'prisma', 'migrate', 'deploy']");
const gateGuardIndex = deployBackupGate.indexOf(
  "['node', 'scripts/verify-ai-media-suite-post-migration.mjs']",
  gateMigrateIndex,
);
assert.ok(gateMigrateIndex >= 0, 'the bound deployment gate must run Prisma migration');
assert.ok(gateGuardIndex > gateMigrateIndex, 'the bound deployment gate must guard after migration');

const dockerMigrateIndex = dockerWrapper.indexOf('npx prisma migrate deploy');
const dockerGuardIndex = dockerWrapper.indexOf('verify-ai-media-suite-post-migration.mjs');
const dockerDarkIndex = dockerWrapper.indexOf('verify-ai-media-dark.mjs');
assert.ok(dockerGuardIndex > dockerMigrateIndex, 'Docker must guard the migrated database');
assert.ok(dockerDarkIndex > dockerGuardIndex, 'Docker must pass the DB guard before later gates');
assert.match(
  dockerfile,
  /COPY --from=build \/app\/apps\/server\/scripts\/verify-ai-media-suite-post-migration\.mjs/u,
  'the runtime migration image must contain the DB guard',
);
assert.match(
  dockerfile,
  /COPY --from=build \/app\/apps\/server\/scripts\/ai-media-suite-post-migration-contract\.mjs \.\/scripts\/ai-media-suite-post-migration-contract\.mjs/u,
  'the runtime migration image must contain the DB guard contract',
);
assert.match(verifyVps, /check_ai_media_suite_post_migration_guard/u);
assert.match(verifyVps, /verify-ai-media-suite-post-migration\.mjs/u);
assert.match(preflight, /ai-media-suite-post-migration-guard\.test\.mjs/u);
assert.match(ci, /node scripts\/ai-media-suite-post-migration-guard\.test\.mjs/u);

console.log('PASS AI media suite post-migration DB guard contract');
