import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workerPath = 'extensions/ss-erp/background/service-worker.js';
const worker = fs.readFileSync(workerPath, 'utf8');

test('loads the focused edit workbench modules in dependency order', () => {
  const modules = [
    '../shared/byok/media-job-engine.js',
    '../shared/byok/workbench-provider-semaphore.js',
    '../shared/byok/workbench-media-channel.js',
    '../shared/byok/workbench-edit-media-store.js',
    '../shared/byok/workbench-edit-epoch-guard.js',
    '../shared/byok/workbench-edit-controller.js',
  ];
  let previous = worker.indexOf('../shared/byok/image-edit-client.js');
  assert.ok(previous >= 0);
  modules.forEach((modulePath) => {
    const position = worker.indexOf(modulePath);
    assert.ok(position > previous, `${modulePath} must load in dependency order`);
    previous = position;
  });
  assert.ok(previous < worker.indexOf('../shared/byok/workbench-runtime-handler.js'));
});

test('uses the reviewed owner/purpose adapter instead of inline media projections', () => {
  const getter = worker.slice(
    worker.indexOf('function getByokWorkbenchEditMediaStore()'),
    worker.indexOf('function getByokWorkbenchEditController()'),
  );
  assert.match(getter, /SS_ERP_BYOK_WORKBENCH_EDIT_MEDIA_STORE/u);
  assert.match(getter, /api\.createStore\(\{[\s\S]*broker:\s*getByokWorkbenchMediaBroker\(\)/u);
  assert.doesNotMatch(getter, /ownerIds|IMAGE_TO_IMAGE_REFERENCE|entry\.metadata/u);
});

test('injects the edit controller and media store into the workbench dispatcher', () => {
  const controller = worker.slice(
    worker.indexOf('function getByokWorkbenchEditController()'),
    worker.indexOf('function getByokWorkbenchRuntimeDispatcher()'),
  );
  assert.match(controller, /SS_ERP_BYOK_WORKBENCH_EDIT_CONTROLLER/u);
  assert.match(controller, /mediaJobEngine:\s*engine/u);
  assert.match(controller, /readinessClient:\s*getByokReadinessClient\(\)/u);
  assert.match(controller, /imageEditClient:\s*getByokImageEditClient\(\)/u);
  assert.match(controller, /generatedResultVault:\s*getByokGeneratedResultVault\(\)/u);
  assert.match(controller, /authorityGuard:\s*getByokRuntimeAuthorityGuard\(\)/u);
  assert.match(controller, /mediaStore:\s*getByokWorkbenchEditMediaStore\(\)/u);
  assert.match(controller, /providerSemaphore:\s*getByokWorkbenchProviderSemaphore\(\)/u);

  const dispatcher = worker.slice(
    worker.indexOf('function getByokWorkbenchRuntimeDispatcher()'),
    worker.indexOf('function installByokReadinessRuntime()'),
  );
  assert.match(dispatcher, /editController:\s*getByokWorkbenchEditController\(\)/u);
  assert.match(dispatcher, /editMediaStore:\s*getByokWorkbenchEditMediaStore\(\)/u);
  assert.match(dispatcher, /editEpochGuard:\s*getByokWorkbenchEditEpochGuard\(\)/u);
  assert.match(dispatcher, /providerSemaphore:\s*getByokWorkbenchProviderSemaphore\(\)/u);
});

test('clears controller sessions and media bytes on cached and device authority resets', () => {
  const cachedClear = worker.slice(
    worker.indexOf('function clearCachedByokGeneratedResults()'),
    worker.indexOf('function isLogisticsDistributionFeatureEnabled()'),
  );
  const deviceClear = worker.slice(
    worker.indexOf('async function clearByokDeviceSessionState(input)'),
    worker.indexOf('function logisticsDistributionDisabledResult()'),
  );
  [cachedClear, deviceClear].forEach((source) => {
    assert.match(source, /byokWorkbenchEditController\.clear\(\)/u);
    assert.match(source, /byokWorkbenchEditMediaStore\.clear\(\)/u);
    assert.match(source, /byokWorkbenchEditEpochGuard\.rotate\(\)/u);
    assert.match(source, /byokWorkbenchProviderSemaphore\.invalidateAll\(\)/u);
  });
});
