import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
const appDirDeploy = readFileSync('scripts/deploy-app-dir.sh', 'utf8');
const stagingDeploy = readFileSync('scripts/deploy-staging.sh', 'utf8');
assert.match(
  stagingDeploy,
  /must run directly as DEPLOY_RUN_USER, never through sudo\/root/u,
  'staging must reject root before any checkout-controlled Git command',
);
const releaseDeploy = readFileSync('scripts/deploy.sh', 'utf8');
const deployBackupGate = readFileSync('scripts/deploy-backup-gate.mjs', 'utf8');
const composeDeploy = readFileSync('scripts/deploy-compose.sh', 'utf8');
const deployments = [
  ['app-dir', appDirDeploy, false],
  ['release', releaseDeploy, false],
  ['staging', stagingDeploy, true],
];

function matchIndex(source, pattern, message) {
  const match = pattern.exec(source);
  assert.ok(match, message);
  return match.index;
}

for (const [label, script, inPlaceBuild] of deployments) {
  const generateIndex = script.indexOf('prisma generate');
  const buildIndex = script.indexOf('pnpm --filter server build');
  const stopIndex = script.indexOf(
    inPlaceBuild ? 'Quiescing application services' : 'Quiescing AI provider services',
  );
  const migrateIndex = script.lastIndexOf('deploy-backup-gate.mjs');
  const restartIndex = script.indexOf('Restarting services', migrateIndex);

  assert.ok(generateIndex >= 0, `${label} deploy must generate Prisma Client`);
  if (inPlaceBuild) {
    assert.ok(stopIndex >= 0 && stopIndex < generateIndex, `${label} deploy must quiesce before mutating active dependencies or generated clients`);
    assert.ok(buildIndex > generateIndex, `${label} deploy must build while all application services are quiesced`);
    assert.ok(migrateIndex > buildIndex, `${label} deploy must migrate after the build succeeds`);
  } else {
    assert.ok(buildIndex > generateIndex, `${label} deploy must build before quiescing services`);
    assert.ok(stopIndex > buildIndex, `${label} deploy must quiesce Worker/API after isolated build`);
    assert.ok(migrateIndex > stopIndex, `${label} deploy must migrate only after Worker/API stop`);
  }
  assert.ok(restartIndex > migrateIndex, `${label} deploy must restore services after migration`);
  assert.match(script, /SERVICES_QUIESCED/u, `${label} deploy must restore old services when migration fails`);
}

for (const [label, script, inPlaceBuild] of deployments) {
  assert.match(
    script,
    /DEPLOY_RUN_UID="\$\(id -u -- "\$DEPLOY_RUN_USER"\)"/u,
    `${label} deploy must derive the runtime numeric UID from the trusted account database`,
  );
  assert.match(
    script,
    /DEPLOY_RUN_GID="\$\(id -g -- "\$DEPLOY_RUN_USER"\)"/u,
    `${label} deploy must derive the runtime numeric GID from the trusted account database`,
  );
  assert.match(
    script,
    /DEPLOY_BUILD_UID="\$\(id -u -- "\$DEPLOY_BUILD_USER"\)"/u,
    `${label} deploy must derive the build numeric UID from the trusted account database`,
  );
  assert.match(
    script,
    /DEPLOY_BUILD_GID="\$\(id -g -- "\$DEPLOY_BUILD_USER"\)"/u,
    `${label} deploy must derive the build numeric GID from the trusted account database`,
  );
  for (const forbiddenIdentity of [
    /\[ "\$DEPLOY_RUN_UID" = "0" \]/u,
    /\[ "\$DEPLOY_RUN_GID" = "0" \]/u,
    /\[ "\$DEPLOY_BUILD_UID" = "0" \]/u,
    /\[ "\$DEPLOY_BUILD_GID" = "0" \]/u,
    /\[ "\$DEPLOY_BUILD_UID" = "\$DEPLOY_RUN_UID" \]/u,
    /\[ "\$DEPLOY_BUILD_GID" = "\$DEPLOY_RUN_GID" \]/u,
  ]) {
    assert.match(
      script,
      forbiddenIdentity,
      `${label} deploy must reject root or overlapping build/runtime identities`,
    );
  }
  if (inPlaceBuild) {
    assert.ok(
      (script.match(/exec-build-as/gu) || []).length >= 5,
      `${label} deploy must run every dependency, generation, server, web, and extension build through exec-build-as`,
    );
  } else {
    assert.match(
      script,
      /"\$\{environment_mode\}-as" "(?:\$DEPLOY_ENV_SNAPSHOT|\$NEXT_DIR\/\$ENV_FILE_NAME)"/u,
      `${label} deploy run_in_dir must translate build execution to exec-build-as`,
    );
    for (const command of [
      /run_in_dir "\$(?:NEXT_DIR|RELEASE_DIR)" exec-build pnpm install --frozen-lockfile/u,
      /run_in_dir "\$(?:NEXT_DIR|RELEASE_DIR)\/apps\/server" exec-build npx prisma generate/u,
      /run_in_dir "\$(?:NEXT_DIR|RELEASE_DIR)" exec-build pnpm --filter server build/u,
      /run_in_dir "\$(?:NEXT_DIR|RELEASE_DIR)" exec-build pnpm --filter web build/u,
      /run_in_dir "\$(?:NEXT_DIR|RELEASE_DIR)" exec-build node scripts\/stage-extension-release\.mjs/u,
    ]) {
      assert.match(script, command, `${label} deploy build command must use the isolated build identity`);
    }
  }
  assert.match(
    script,
    /WEB_NEXT_DIR="\$[A-Z_]+\/apps\/web\/\.next"/u,
    `${label} deploy must bind the runtime cache beneath the sealed Web output`,
  );
  assert.match(script, /rm -rf -- "\$WEB_CACHE_DIR"/u);
  assert.match(
    script,
    /install -d -o "\$DEPLOY_RUN_USER" -g "\$DEPLOY_RUN_GROUP" -m 0750 "\$WEB_CACHE_DIR"/u,
    `${label} deploy must create a fresh runtime cache instead of taking ownership of build output`,
  );
  assert.doesNotMatch(
    script,
    /chown -R[^\r\n]*\.next\/cache/u,
    `${label} deploy must not recursively chown build-produced cache entries`,
  );
}

for (const [label, script, sourceRoot, sealedRoot] of [
  ['app-dir', appDirDeploy, 'NEXT_DIR', 'SEALED_NEXT_DIR'],
  ['release', releaseDeploy, 'RELEASE_DIR', 'SEALED_RELEASE_DIR'],
]) {
  const buildIndex = script.indexOf('pnpm --filter server build');
  const preManifestIndex = matchIndex(
    script,
    new RegExp(`deploy-source-manifest\\.mjs" create \\\\\\r?\\n\\s+"\\$${sourceRoot}"`, 'u'),
    `${label} deploy must record a pre-build source manifest`,
  );
  const closedManifestIndex = matchIndex(
    script,
    new RegExp(`deploy-source-manifest\\.mjs" create-closed \\\\\\r?\\n\\s+"\\$${sourceRoot}"`, 'u'),
    `${label} deploy must record a closed post-build manifest`,
  );
  const sealIndex = matchIndex(
    script,
    new RegExp(`freeze-deploy-source\\.sh" \\\\\\r?\\n\\s+seal "\\$TARGET_GIT_COMMIT" "\\$${sourceRoot}" "\\$${sealedRoot}"`, 'u'),
    `${label} deploy must copy the build onto sealed root-owned inodes`,
  );
  const preManifestVerifyIndex = matchIndex(
    script,
    new RegExp(`deploy-source-manifest\\.mjs" verify \\\\\\r?\\n\\s+"\\$${sealedRoot}" "\\$DEPLOY_SOURCE_MANIFEST"`, 'u'),
    `${label} deploy must verify the pre-build manifest against the sealed tree`,
  );
  const closedManifestVerifyIndex = matchIndex(
    script,
    new RegExp(`deploy-source-manifest\\.mjs" verify \\\\\\r?\\n\\s+"\\$${sealedRoot}" "\\$DEPLOY_BUILD_MANIFEST"`, 'u'),
    `${label} deploy must verify the closed post-build manifest against the sealed tree`,
  );
  const runtimeLinkIndex = script.indexOf('install_root_runtime_symlink', sealIndex);
  assert.ok(
    preManifestIndex < buildIndex
      && buildIndex < closedManifestIndex
      && closedManifestIndex < sealIndex
      && sealIndex < preManifestVerifyIndex
      && preManifestVerifyIndex < closedManifestVerifyIndex
      && closedManifestVerifyIndex < runtimeLinkIndex,
    `${label} deploy must create, seal, verify, then install runtime links in that order`,
  );
}

const stagingClosedManifestIndex = stagingDeploy.indexOf('deploy-source-manifest.mjs" create-closed');
const stagingSealIndex = matchIndex(
  stagingDeploy,
  /freeze-deploy-source\.sh" \\\r?\n\s+seal "\$TARGET_GIT_COMMIT" "\$DEPLOY_DIR" "\$SEALED_DEPLOY_DIR"/u,
  'staging must copy the build onto sealed root-owned inodes',
);
const stagingClosedVerifyIndex = stagingDeploy.indexOf(
  '"$SEALED_DEPLOY_DIR" "$DEPLOY_BUILD_MANIFEST"',
);
const stagingReservedLinkIndex = stagingDeploy.indexOf('for reserved_runtime_link in');
assert.ok(
  stagingClosedManifestIndex >= 0
    && stagingClosedManifestIndex < stagingSealIndex
    && stagingSealIndex < stagingClosedVerifyIndex
    && stagingClosedVerifyIndex < stagingReservedLinkIndex,
  'staging must close its post-build manifest, seal it, verify it, then reject reserved runtime symlinks',
);
assert.match(stagingDeploy, /if sudo test -L "\$reserved_runtime_link"/u);
for (const reservedPath of [
  '/.env.*',
  '/backups',
  '/apps/server/public/uploads',
  '/apps/server/public/watermarked',
  '/apps/server/public/resized',
  '/apps/server/public/tmp',
  '/tmp/ai-image-sandbox',
  '/tmp/ai-image-translation-sandbox',
]) {
  assert.ok(
    stagingDeploy.includes(`"$SEALED_DEPLOY_DIR"${reservedPath}`)
      || stagingDeploy.includes(`"$SEALED_DEPLOY_DIR${reservedPath}"`),
    `staging must reject a build-created external runtime symlink at ${reservedPath}`,
  );
}
assert.doesNotMatch(
  stagingDeploy,
  /^\s*sudo\b[^\r\n]*(?:\s|\/)git(?:\s|$)/mu,
  'staging must never inspect or mutate Git as root',
);
assert.doesNotMatch(
  stagingDeploy,
  /^\s*sudo\b[^\r\n]*assert_(?:clean_staging_checkout|git_bound_build_inputs)/mu,
  'staging Git verification helpers must run as the deployment user',
);
assert.doesNotMatch(
  stagingDeploy,
  /^\s*sudo\b[^\r\n]*verify-deploy-build-inputs/mu,
  'staging must not invoke its Git-backed build-input verifier as root',
);

const canonicalCurrentIndex = releaseDeploy.indexOf(
  'current_target="$(readlink -f -- "$CURRENT_LINK")"',
);
const previousReleaseIndex = releaseDeploy.indexOf('PREVIOUS_RELEASE="$current_target"');
assert.ok(
  canonicalCurrentIndex >= 0 && canonicalCurrentIndex < previousReleaseIndex,
  'release rollback must retain the canonical current target',
);
assert.doesNotMatch(
  releaseDeploy,
  /PREVIOUS_RELEASE="\$\(readlink/u,
  'release rollback must not re-read a potentially relative current symlink',
);
assert.match(
  releaseDeploy,
  /install_root_runtime_symlink\(\)[\s\S]{0,900}ln -sT -- "\$target_real" "\$link"[\s\S]{0,120}chown -h root:root "\$link"/u,
  'release runtime links must be installed and owned by root',
);

assert.match(releaseDeploy, /assert_root_ancestor_chain "\$RELEASES_DIR"/u);
assert.match(releaseDeploy, /assert_root_ancestor_chain "\$SHARED_DIR"/u);
assert.match(releaseDeploy, /assert_root_ancestor_chain "\$\(dirname -- "\$CURRENT_LINK"\)"/u);
assert.match(appDirDeploy, /assert_root_ancestor_chain "\$DEPLOY_BASE"/u);
assert.match(appDirDeploy, /assert_root_ancestor_chain "\$BACKUP_DIR"/u);
assert.match(appDirDeploy, /assert_root_ancestor_chain "\$BACKUP_LOG_DIR"/u);
assert.match(appDirDeploy, /assert_root_ancestor_chain "\$\(dirname -- "\$APP_DIR"\)"/u);
assert.match(stagingDeploy, /CURRENT_ANCESTOR="\$DEPLOY_PARENT"[\s\S]*stat -c '%u'[\s\S]*8#022/u);
assert.match(
  deployBackupGate,
  /'pnpm', 'exec', 'prisma', 'migrate', 'deploy'/u,
  'the immutable deployment gate must own Prisma migration execution',
);
assert.match(appDirDeploy, /deployment runtime user is missing/u);
assert.doesNotMatch(
  appDirDeploy,
  /if id "\$DEPLOY_RUN_USER"[\s\S]*else[\s\S]*bash -lc/u,
  'app-dir deploy must never fall back to running target lifecycle scripts as root',
);
assert.match(
  appDirDeploy,
  /deploy-environment\.mjs" snapshot[\s\S]*"\$CURRENT_ENV_FILE" "\$DEPLOY_ENV_SNAPSHOT"/u,
);
assert.match(
  appDirDeploy,
  /install -o root -g "\$DEPLOY_RUN_GROUP" -m 0640[\s\S]*"\$DEPLOY_ENV_SNAPSHOT" "\$NEXT_DIR\/\$ENV_FILE_NAME"/u,
);
assert.match(appDirDeploy, /\[ -L "\$CURRENT_ENV_FILE" \]/u);
assert.doesNotMatch(appDirDeploy, /cp -p "\$APP_DIR\/\$ENV_FILE_NAME"/u);
assert.match(appDirDeploy, /sudo -u "\$DEPLOY_RUN_USER" cp -a -n/u);
for (const script of deployments.slice(0, 2).map(([, source]) => source)) {
  assert.match(script, /ss-erp-deploy-upload\.XXXXXXXXXX/u);
  assert.match(script, /ARCHIVE_SHA256/u);
  assert.match(script, /sha256sum "\$TARBALL"/u);
  assert.doesNotMatch(script, /@\$DEPLOY_HOST:\/tmp\/\$\(basename/u);
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
assert.doesNotMatch(
  appDirDeploy,
  /COMMIT_HASH[^\r\n]*\{64\}/u,
  'app-dir deploy must not admit an unsupported Git OID width',
);
assert.match(appDirDeploy, /TARBALL="build\/ss-erp-app-\$COMMIT_HASH\.tar\.gz"/u);
assert.match(
  appDirDeploy,
  /printf '%s\\n' "\$TARGET_GIT_COMMIT" > "\$NEXT_DIR\/DEPLOYED_COMMIT"/u,
);

const stagingCommitIndex = stagingDeploy.indexOf(
  'readonly TARGET_GIT_COMMIT="$(assert_clean_staging_checkout)"',
);
const stagingReleaseStageIndex = stagingDeploy.indexOf('node scripts/stage-extension-release.mjs');
const stagingQuiesceIndex = stagingDeploy.indexOf(
  'sudo systemctl stop "$WORKER_SERVICE" "$API_SERVICE"',
);
const stagingMarkerIndex = stagingDeploy.indexOf(
  'printf \'%s\\n\' "$TARGET_GIT_COMMIT" > DEPLOYED_COMMIT',
);
const stagingInstalledGateIndex = stagingDeploy.indexOf(
  'assert_installed_target_backup_gate "$TARGET_GIT_COMMIT"',
);
const stagingReleaseGateIndex = stagingDeploy.indexOf(
  'node scripts/verify-extension-release.mjs',
);
const stagingMigrationIndex = stagingDeploy.lastIndexOf('deploy-backup-gate.mjs');
assert.ok(stagingCommitIndex >= 0, 'staging deploy must resolve the post-pull full Git commit');
assert.ok(stagingQuiesceIndex >= 0, 'staging deploy must quiesce the Worker/API');
assert.ok(stagingMarkerIndex >= 0, 'staging deploy must refresh DEPLOYED_COMMIT');
assert.ok(stagingReleaseGateIndex >= 0, 'staging deploy must verify the current release set');
assert.ok(
  stagingCommitIndex < stagingQuiesceIndex
    && stagingInstalledGateIndex < stagingQuiesceIndex
    && stagingQuiesceIndex < stagingMarkerIndex
    && stagingMarkerIndex < stagingReleaseStageIndex,
  'staging deploy must preflight the installed gate and bind DEPLOYED_COMMIT before staging the release',
);
assert.ok(
  stagingReleaseStageIndex < stagingReleaseGateIndex
    && stagingReleaseGateIndex < stagingMigrationIndex,
  'staging release-set verification must run after immutable staging and before migration',
);
for (const source of [appDirDeploy, releaseDeploy, stagingDeploy]) {
  assert.match(source, /EXTENSION_RELEASE_ROOT/u);
  assert.match(source, /stage-extension-release\.mjs/u);
  assert.doesNotMatch(source, /pnpm package:extension/u);
  assert.match(source, /extension release root must use mode 0755/u);
  assert.match(source, /extension release input must use mode 0644/u);
  assert.match(source, /extension release (?:root )?must contain exactly four files/u);
  assert.match(source, /Revoking build-user writes to the staged extension release/u);
  assert.match(
    source,
    /--verify-output-dir "\$[A-Z_]+\/build\/extensions"/u,
    'sealed output must byte-match the immutable release candidate before activation',
  );
}
assert.match(appDirDeploy, /assert_root_ancestor_chain "\$EXTENSION_RELEASE_ROOT"/u);
assert.match(releaseDeploy, /assert_root_ancestor_chain "\$EXTENSION_RELEASE_ROOT"/u);
assert.match(stagingDeploy, /EXTENSION_RELEASE_ROOT ancestors must be readable root-owned canonical directories/u);
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
  /printf '%s\\n' "\$TARGET_GIT_COMMIT" > DEPLOYED_COMMIT/u,
  'staging deploy must refresh the package provenance marker after pulling',
);
assert.doesNotMatch(stagingDeploy, /--skip-build|SKIP_BUILD/u);
assert.match(stagingDeploy, /assert_installed_target_backup_gate/u);
assert.match(
  stagingDeploy,
  /verify-deploy-build-inputs\.mjs "\$TARGET_GIT_COMMIT" "\$ENV_FILE"/u,
  'staging must reject every ignored root env except its selected runtime env',
);
assert.ok(
  stagingDeploy.indexOf('Quiescing application services')
    < stagingDeploy.indexOf('pnpm install --frozen-lockfile'),
  'staging must stop Worker/API/Web before dependency installation',
);
assert.match(composeDeploy, /--project-name "\$DEPLOY_COMPOSE_PROJECT"/u);
assert.match(composeDeploy, /unset COMPOSE_PROJECT_NAME/u);
assert.match(composeDeploy, /unset COMPOSE_PROJECT_NAME DEPLOY_BACKUP_LOCAL_DIR/u);
assert.equal(
  (composeDeploy.match(/verify-deploy-build-inputs\.mjs/gu) || []).length,
  1,
  'Compose must reject ignored build inputs before creating its target-commit archive',
);
assert.match(
  composeDeploy,
  /verify-deploy-build-inputs\.mjs "\$TARGET_GIT_COMMIT" "\$SOURCE_ENV_FILE"/u,
  'Compose must permit only its selected runtime env outside the target archive',
);
assert.match(composeDeploy, /git archive --format=tar/u);
assert.match(composeDeploy, /DEPLOY_SOURCE_ARCHIVE_SHA256/u);
assert.doesNotMatch(composeDeploy, /CURRENT_WORKTREE_STATUS/u);

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
  /install_root_runtime_symlink \\\r?\n\s+"\$DEPLOY_BASE\/shared\/\$sandbox_dir" "\$NEXT_DIR\/tmp\/\$sandbox_dir"/u,
  'the sealed next app dir must receive root-installed sandbox runtime links',
);

assert.match(preflight, /ai-provider-dispatch-deploy-safety\.test\.mjs/u);

console.log('PASS AI provider dispatch deployment safety contract');
