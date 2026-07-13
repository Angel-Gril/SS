import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const featurePath = 'shared/logistics-rules/distribution-feature.js';

function buildFeature(enabled) {
  const outRoot = mkdtempSync(join(tmpdir(), 'ss-erp-logistics-dark-rollout-'));
  const result = spawnSync(process.execPath, ['scripts/build-extension-package.mjs', 'cloud'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_OUT_DIR: outRoot,
      LOGISTICS_DISTRIBUTION_ENABLED: enabled ? 'true' : 'false',
      NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED: enabled ? 'true' : 'false',
    },
  });
  try {
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    return readFileSync(join(outRoot, 'ss-erp-cloud', featurePath), 'utf8');
  } finally {
    rmSync(outRoot, { recursive: true, force: true });
  }
}

test('extension packages fail closed unless both rollout flags are enabled', () => {
  assert.match(buildFeature(false), /enabled:\s*false/);
  assert.match(buildFeature(true), /enabled:\s*true/);
});

test('settings and worker honor the packaged logistics distribution gate', () => {
  const settingsHtml = readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
  const settingsJs = readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');
  const worker = readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

  assert.match(settingsHtml, /distribution-feature\.js/);
  assert.match(settingsHtml, /id="logisticsDistributionFeatureSection"/);
  assert.match(settingsJs, /SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE/);
  assert.match(settingsJs, /if \(logisticsDistributionEnabled\)/);
  assert.match(worker, /distribution-feature\.js/);
  assert.match(worker, /isLogisticsDistributionFeatureEnabled\(\)/);
  assert.match(worker, /errorCode:\s*'feature_disabled'/);
  assert.match(worker, /disableLogisticsDistributionAlarms\(\)/);
});

test('product calculator enforces the packaged feature gate before reading remote cache', () => {
  const manifest = JSON.parse(readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
  const productScripts = manifest.content_scripts.find((entry) => (
    Array.isArray(entry.js) && entry.js.includes('shared/config-bridge/config-store.js')
  )).js;
  const featureIndex = productScripts.indexOf(featurePath);
  const storeIndex = productScripts.indexOf('shared/config-bridge/config-store.js');
  assert.ok(featureIndex >= 0, 'product calculator must load the packaged feature gate');
  assert.ok(storeIndex > featureIndex, 'feature gate must load before config-store');

  const configStore = readFileSync(
    'extensions/ss-erp/shared/config-bridge/config-store.js',
    'utf8',
  );
  assert.match(configStore, /SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE/);
  assert.match(configStore, /enabled\s*===\s*true/);
});
