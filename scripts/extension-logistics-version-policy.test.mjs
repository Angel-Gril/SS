import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sourcePath = 'extensions/ss-erp/shared/logistics-rules/version-policy.js';
const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
const context = { Number, Object, String };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'version-policy.js' });
const policy = context.SS_ERP_LOGISTICS_VERSION_POLICY;

test('three-part extension versions compare numerically', () => {
  assert.ok(policy, 'version policy must be available');
  assert.equal(policy.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(policy.compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(policy.compareVersions('1.9.9', '1.10.0'), -1);
});

test('invalid current or minimum versions fail closed', () => {
  assert.ok(policy, 'version policy must be available');
  assert.equal(policy.compareVersions('1.0', '1.0.0'), null);
  assert.equal(policy.compareVersions('1.0.0', 'latest'), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(policy.evaluateCompatibility('1.0', '1.0.0'))),
    {
      compatible: false,
      reason: 'current_version_invalid',
      currentExtensionVersion: '1.0',
      minExtensionVersion: '1.0.0',
    },
  );
  assert.equal(policy.evaluateCompatibility('1.0.0', 'latest').compatible, false);
  assert.equal(policy.evaluateCompatibility('1.0.0', 'latest').reason, 'minimum_version_invalid');
});
