import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
const deployments = [
  ['app-dir', readFileSync('scripts/deploy-app-dir.sh', 'utf8'), false],
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

assert.match(preflight, /ai-provider-dispatch-deploy-safety\.test\.mjs/u);

console.log('PASS AI provider dispatch deployment safety contract');
