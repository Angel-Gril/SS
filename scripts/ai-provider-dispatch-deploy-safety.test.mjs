import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
const appDirDeploy = readFileSync('scripts/deploy-app-dir.sh', 'utf8');
const stagingDeploy = readFileSync('scripts/deploy-staging.sh', 'utf8');
const deployments = [
  ['app-dir', appDirDeploy, false],
  ['release', readFileSync('scripts/deploy.sh', 'utf8'), false],
  ['staging', stagingDeploy, true],
];

for (const [label, script, inPlaceBuild] of deployments) {
  const generateIndex = script.indexOf('prisma generate');
  const buildIndex = script.indexOf('pnpm --filter server build');
  const stopIndex = script.indexOf('Quiescing AI provider services');
  const migrateIndex = script.indexOf('prisma migrate deploy');
  const restartIndex = script.indexOf('Restarting services', migrateIndex);

  assert.ok(generateIndex >= 0, `${label} deploy must generate Prisma Client`);
  if (inPlaceBuild) {
    assert.ok(stopIndex > generateIndex, `${label} deploy must quiesce before rewriting the active dist`);
    assert.ok(buildIndex > stopIndex, `${label} deploy must build while Worker/API are quiesced`);
    assert.ok(migrateIndex > buildIndex, `${label} deploy must migrate after the build succeeds`);
  } else {
    assert.ok(buildIndex > generateIndex, `${label} deploy must build before quiescing services`);
    assert.ok(stopIndex > buildIndex, `${label} deploy must quiesce Worker/API after isolated build`);
    assert.ok(migrateIndex > stopIndex, `${label} deploy must migrate only after Worker/API stop`);
  }
  assert.ok(restartIndex > migrateIndex, `${label} deploy must restore services after migration`);
  assert.match(script, /SERVICES_QUIESCED/u, `${label} deploy must restore old services when migration fails`);
}

const resolveCommitIndex = appDirDeploy.indexOf('git rev-parse --verify --end-of-options');
const archiveIndex = appDirDeploy.indexOf('git archive');
assert.ok(resolveCommitIndex >= 0, 'app-dir deploy must resolve the requested ref before packaging');
assert.ok(resolveCommitIndex < archiveIndex, 'app-dir deploy must resolve the requested ref before git archive');
assert.match(
  appDirDeploy,
  /COMMIT_HASH="\$\(git rev-parse --verify --end-of-options "\$\{DEPLOY_REF\}\^\{commit\}" 2>\/dev\/null\)"/u,
  'app-dir deploy must reject non-commit refs and capture the resolved commit OID',
);
assert.match(
  appDirDeploy,
  /\[0-9a-fA-F\]\{40\}/u,
  'app-dir deploy must require the full 40-character commit OID used by release evidence',
);
assert.doesNotMatch(appDirDeploy, /\{64\}/u, 'app-dir deploy must not admit an unsupported OID width');
assert.match(appDirDeploy, /TARBALL="build\/ss-erp-app-\$COMMIT_HASH\.tar\.gz"/u);
assert.match(appDirDeploy, /echo "\$COMMIT_HASH" > "\$NEXT_DIR\/DEPLOYED_COMMIT"/u);

const stagingCommitIndex = stagingDeploy.indexOf(
  'git rev-parse --verify --end-of-options "HEAD^{commit}"',
);
const stagingPackageIndex = stagingDeploy.indexOf('pnpm package:extension');
const stagingQuiesceIndex = stagingDeploy.indexOf(
  'sudo systemctl stop "$WORKER_SERVICE" "$API_SERVICE"',
);
const stagingMarkerIndex = stagingDeploy.indexOf(
  'printf \'%s\\n\' "$COMMIT_HASH" > DEPLOYED_COMMIT',
);
const stagingReleaseGateIndex = stagingDeploy.indexOf(
  'node scripts/verify-extension-release.mjs',
);
const stagingMigrationIndex = stagingDeploy.indexOf('npx prisma migrate deploy');
assert.ok(stagingCommitIndex >= 0, 'staging deploy must resolve the post-pull full Git commit');
assert.ok(stagingQuiesceIndex >= 0, 'staging deploy must quiesce the Worker/API');
assert.ok(stagingMarkerIndex >= 0, 'staging deploy must refresh DEPLOYED_COMMIT');
assert.ok(stagingReleaseGateIndex >= 0, 'staging deploy must verify the current release set');
assert.ok(
  stagingCommitIndex < stagingQuiesceIndex
    && stagingQuiesceIndex < stagingMarkerIndex
    && stagingMarkerIndex < stagingPackageIndex,
  'staging deploy must bind DEPLOYED_COMMIT after quiescing and before extension packaging',
);
assert.ok(
  stagingPackageIndex < stagingReleaseGateIndex
    && stagingReleaseGateIndex < stagingMigrationIndex,
  'staging release-set verification must run after the optional build and before migration',
);
assert.match(
  stagingDeploy,
  /--build-root "\$DEPLOY_DIR\/build\/extensions"/u,
  'staging release-set verification must target the serving build root',
);
assert.match(
  stagingDeploy,
  /--expected-local-origin "\$\{EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN:-http:\/\/127\.0\.0\.1:3001\}"/u,
  'staging release-set verification must bind the independently approved local origin',
);
assert.match(
  stagingDeploy,
  /\[0-9a-f\]\{40\}/u,
  'staging deploy must reject a non-SHA-1-width commit marker',
);
assert.match(
  stagingDeploy,
  /printf '%s\\n' "\$COMMIT_HASH" > DEPLOYED_COMMIT/u,
  'staging deploy must refresh the package provenance marker after pulling',
);

const sandboxPersistenceIndex = appDirDeploy.indexOf(
  'for sandbox_dir in ai-image-sandbox ai-image-translation-sandbox',
);
const appDirSwitchIndex = appDirDeploy.indexOf('log "Switching $APP_DIR"');
assert.ok(sandboxPersistenceIndex >= 0, 'app-dir deploy must persist both sandbox evidence directories');
assert.ok(
  sandboxPersistenceIndex < appDirSwitchIndex,
  'app-dir deploy must persist sandbox evidence before switching APP_DIR',
);
assert.match(appDirDeploy, /shared_sandbox_dir="\$DEPLOY_BASE\/shared\/\$sandbox_dir"/u);
assert.match(appDirDeploy, /chmod 0700 "\$shared_sandbox_dir"/u);
assert.match(appDirDeploy, /cp -a -n .*"\$shared_sandbox_dir\/"/u, 'existing shared evidence must not be overwritten');
assert.match(
  appDirDeploy,
  /ln -s "\$shared_sandbox_dir" "\$NEXT_DIR\/tmp\/\$sandbox_dir"/u,
  'the next app dir must link sandbox output paths to private shared storage',
);

assert.match(preflight, /ai-provider-dispatch-deploy-safety\.test\.mjs/u);

console.log('PASS AI provider dispatch deployment safety contract');
