import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
const appDirDeploy = readFileSync('scripts/deploy-app-dir.sh', 'utf8');
const deployments = [
  ['app-dir', appDirDeploy, false],
  ['release', readFileSync('scripts/deploy.sh', 'utf8'), false],
  ['staging', readFileSync('scripts/deploy-staging.sh', 'utf8'), true],
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
assert.match(appDirDeploy, /\{40\}.*\{64\}/u, 'app-dir deploy must require a full SHA-1 or SHA-256 commit OID');
assert.match(appDirDeploy, /TARBALL="build\/ss-erp-app-\$COMMIT_HASH\.tar\.gz"/u);
assert.match(appDirDeploy, /echo "\$COMMIT_HASH" > "\$NEXT_DIR\/DEPLOYED_COMMIT"/u);

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
