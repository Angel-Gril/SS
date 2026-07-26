import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workerPath = 'extensions/ss-erp/background/service-worker.js';
const worker = fs.readFileSync(workerPath, 'utf8');

test('loads focused edit modules before the Provider settings dispatcher', () => {
  const modules = [
    '../shared/byok/image-input-inspector.js',
    '../shared/byok/image-mask-transform.js',
    '../shared/byok/image-edit-adapters.js',
    '../shared/byok/image-edit-probe-media.js',
    '../shared/byok/image-edit-client.js',
  ];
  let previous = worker.indexOf("../shared/byok/text-to-image-client.js");
  assert.ok(previous >= 0);
  for (const modulePath of modules) {
    const position = worker.indexOf(modulePath);
    assert.ok(position > previous, `${modulePath} must load in dependency order`);
    previous = position;
  }
  assert.ok(previous < worker.indexOf('../shared/byok/provider-settings-handler.js'));
});

test('routes text probes and edit probes through separate background clients', () => {
  assert.match(worker, /function getByokImageEditClient\(\)/u);
  assert.match(worker, /function getByokCapabilityClient\(\)/u);
  const facade = worker.slice(
    worker.indexOf('function getByokCapabilityClient()'),
    worker.indexOf('function getByokProviderSettingsDispatcher()'),
  );
  assert.match(facade, /input\.operation === 'TEXT_TO_IMAGE'/u);
  assert.match(facade, /getByokTextToImageClient\(\)\.probe/u);
  assert.match(facade, /getByokImageEditClient\(\)\.probe/u);
  assert.match(worker, /capabilityClient:\s*getByokCapabilityClient\(\)/u);
});

test('instantiates only the standard synchronous edit adapter in production wiring', () => {
  const getter = worker.slice(
    worker.indexOf('function getByokImageEditClient()'),
    worker.indexOf('function getByokCapabilityClient()'),
  );
  assert.match(getter, /OPENAI_MULTIPART_SYNC/u);
  assert.doesNotMatch(getter, /EXPLICIT_ASYNC_TASK/u);
  assert.match(getter, /authorizeResultOrigin:\s*async \(\) => false/u);
  assert.match(getter, /probeMediaFactory/u);
  assert.match(getter, /maskTransformer/u);
});
