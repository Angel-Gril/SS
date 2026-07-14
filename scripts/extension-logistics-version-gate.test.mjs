import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));

test('logistics distribution ships behind extension version 1.0.196', () => {
  assert.equal(manifest.version, '1.0.196');
});

test('calculator content scripts load version policy before cached logistics state', () => {
  const calculatorScripts = manifest.content_scripts
    .map((entry) => entry.js || [])
    .find((scripts) => scripts.includes('shared/config-bridge/config-store.js'));
  assert.ok(calculatorScripts);
  const policyIndex = calculatorScripts.indexOf('shared/logistics-rules/version-policy.js');
  const storeIndex = calculatorScripts.indexOf('shared/config-bridge/config-store.js');
  assert.ok(policyIndex >= 0);
  assert.ok(policyIndex < storeIndex);
});
