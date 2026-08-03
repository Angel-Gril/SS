import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const workerPath = 'extensions/ss-erp/background/service-worker.js';
const manifestPath = 'extensions/ss-erp/manifest.json';
const registryPath = 'extensions/ss-erp/shared/byok/workbench-batch-registry.js';
const runtimeHandlerPath =
  'extensions/ss-erp/shared/byok/workbench-batch-runtime-handler.js';

const worker = readFileSync(workerPath, 'utf8');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.ok(
  Number.parseInt(manifest.minimum_chrome_version, 10) >= 114,
  'message-based MV3 lifecycle protection requires Chrome 114 or newer',
);
const dependencyOrder = [
  '../shared/byok/execution-batch-client.js',
  '../shared/byok/execution-intent-claim-broker.js',
  '../shared/byok/text-to-image-client.js',
  '../shared/byok/image-edit-client.js',
  '../shared/byok/media-job-engine.js',
  '../shared/byok/workbench-batch-provider-executor.js',
  '../shared/byok/workbench-batch-coordinator.js',
  '../shared/byok/generated-result-vault-persistence.js',
  '../shared/byok/generated-result-vault.js',
  '../shared/byok/generated-asset-ingest-client.js',
  '../shared/byok/generated-asset-batch-ingest-client.js',
  '../shared/byok/workbench-launch-client.js',
  '../shared/byok/workbench-batch-launch-client.js',
  '../shared/byok/workbench-runtime-handler.js',
  '../shared/byok/workbench-batch-registry.js',
  '../shared/byok/workbench-batch-runtime-handler.js',
];
const batchModules = dependencyOrder.filter((modulePath) => (
  /(?:execution-batch|intent-claim-broker|result-vault-persistence|asset-batch|workbench-batch)/u
    .test(modulePath)
));

assert.equal(existsSync(registryPath), true, 'batch registry module must be packaged');
assert.equal(existsSync(runtimeHandlerPath), true, 'batch runtime handler must be packaged');

const listenerIndex = worker.indexOf('chrome.runtime.onMessage.addListener');
assert.ok(listenerIndex > 0, 'runtime listener is missing');
let previousIndex = worker.indexOf("importScripts('../shared/byok/execution-intent-client.js')");
assert.ok(previousIndex >= 0, 'execution intent client must load before batch modules');
for (const modulePath of dependencyOrder) {
  const importText = `importScripts('${modulePath}')`;
  const moduleIndex = worker.indexOf(importText);
  assert.ok(moduleIndex > previousIndex, `${modulePath} must load in dependency order`);
  assert.ok(moduleIndex < listenerIndex, `${modulePath} must load before runtime dispatch`);
  previousIndex = moduleIndex;
}
for (const modulePath of batchModules) {
  const importText = `importScripts('${modulePath}')`;
  assert.equal(worker.split(importText).length - 1, 1, `${modulePath} must load exactly once`);
}

const providerExecutorIndex = worker.indexOf(
  "importScripts('../shared/byok/workbench-batch-provider-executor.js')",
);
assert.ok(
  worker.indexOf("importScripts('../shared/byok/text-to-image-client.js')")
    < providerExecutorIndex,
  'text Provider client must load before the batch Provider executor',
);
assert.ok(
  worker.indexOf("importScripts('../shared/byok/image-edit-client.js')")
    < providerExecutorIndex,
  'edit Provider client must load before the batch Provider executor',
);
assert.ok(
  worker.indexOf("importScripts('../shared/byok/media-job-engine.js')")
    < worker.indexOf("importScripts('../shared/byok/workbench-batch-coordinator.js')"),
  'media job engine must load before the batch coordinator',
);

assert.match(worker, /let byokWorkbenchBatchRegistry = null;/u);
assert.match(worker, /let byokWorkbenchBatchRuntimeDispatcher = null;/u);
assert.match(worker, /let byokGeneratedResultEscrow = null;/u);
assert.match(worker, /function getByokGeneratedResultEscrow\(\)/u);
assert.match(worker, /SS_ERP_BYOK_GENERATED_RESULT_VAULT_PERSISTENCE/u);
assert.match(worker, /createIndexedDbRepository\(\{[\s\S]*indexedDB:\s*globalThis\.indexedDB/u);
assert.match(worker, /sessionStorage:\s*chrome\.storage\.session/u);
assert.match(worker, /stageResult:\s*stageByokGeneratedResult/u);
assert.match(worker, /function getByokWorkbenchBatchRegistry\(\)/u);
assert.match(worker, /SS_ERP_BYOK_WORKBENCH_BATCH_REGISTRY/u);
assert.match(worker, /byokWorkbenchBatchRegistry = api\.createRegistry\(\{/u);
assert.match(worker, /function getByokWorkbenchBatchRuntimeDispatcher\(\)/u);
assert.match(worker, /SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER/u);

const coordinatorStart = worker.indexOf('function createByokWorkbenchBatchCoordinator(options)');
const registryStart = worker.indexOf('function getByokWorkbenchBatchRegistry()');
assert.ok(coordinatorStart >= 0 && registryStart > coordinatorStart);
const coordinatorFactory = worker.slice(coordinatorStart, registryStart);
assert.match(coordinatorFactory, /SS_ERP_BYOK_WORKBENCH_BATCH_COORDINATOR/u);
assert.match(coordinatorFactory, /SS_ERP_BYOK_WORKBENCH_BATCH_PROVIDER_EXECUTOR/u);
assert.match(coordinatorFactory, /atomicBatchIngest:\s*getByokGeneratedAssetBatchIngestClient\(\)/u);

const registryFactory = worker.slice(registryStart, worker.indexOf(
  'function getByokWorkbenchBatchRuntimeDispatcher()',
));
assert.doesNotMatch(
  registryFactory,
  /readSecretForBackground|apiKey|authorization\s*:/iu,
  'batch registry integration must not read or expose Provider secrets',
);
assert.match(registryFactory, /resultEscrow:\s*getByokGeneratedResultEscrow\(\)/u);

const dispatcherStart = worker.indexOf('function getByokWorkbenchBatchRuntimeDispatcher()');
const installStart = worker.indexOf('function installByokReadinessRuntime()');
assert.ok(dispatcherStart >= 0 && installStart > dispatcherStart);
const dispatcher = worker.slice(dispatcherStart, installStart);
assert.match(dispatcher, /authorization\.MESSAGE_TYPES\.WORKBENCH/u);
assert.match(dispatcher, /api\.createDispatcher\(\{/u);
assert.match(dispatcher, /registry:\s*getByokWorkbenchBatchRegistry\(\)/u);
for (const messageType of [
  'BATCH_STATE', 'BATCH_START', 'BATCH_COMMAND', 'BATCH_PREVIEW',
  'BATCH_INGEST', 'BATCH_RECOVER', 'BATCH_CLEAR',
]) {
  assert.match(
    dispatcher,
    new RegExp(`${messageType}:\\s*workbenchTypes\\.${messageType}`, 'u'),
    `${messageType} must use the authorized workbench message type`,
  );
}

const installEnd = worker.indexOf('installByokReadinessRuntime();', installStart);
assert.ok(installEnd > installStart, 'BYOK runtime installer is incomplete');
const installer = worker.slice(installStart, installEnd);
assert.match(installer, /getByokWorkbenchBatchRuntimeDispatcher\(\)/u);
assert.match(
  installer,
  /\.\.\.workbenchDispatcher\.handlers,[\s\S]*\.\.\.batchWorkbenchDispatcher\.handlers,[\s\S]*\.\.\.hostedWorkbenchDispatcher\.handlers,/u,
);

const clearStart = worker.indexOf('async function clearCachedByokGeneratedResults()');
const clearEnd = worker.indexOf('function clearHostedAiImageSuiteRuntime', clearStart);
assert.ok(clearStart >= 0 && clearEnd > clearStart, 'BYOK runtime cleanup is missing');
const clearRuntime = worker.slice(clearStart, clearEnd);
assert.match(clearRuntime, /async function clearCachedByokGeneratedResults\(\)/u);
assert.match(clearRuntime, /byokWorkbenchBatchRegistry/u);
assert.match(
  clearRuntime,
  /return byokWorkbenchBatchRegistry\.clearAll\(\s*'provider_state_changed',\s*finalize,\s*\)/u,
  'credential reset must pass one closed finalize callback into the Registry global fence',
);
assert.equal(
  clearRuntime.split('byokWorkbenchBatchRegistry.clearAll(').length - 1,
  1,
  'credential reset must not perform a second unfenced Registry cleanup',
);
assert.equal(
  clearRuntime.split('clearAndRotateKey()').length - 1,
  1,
  'credential reset must rotate durable escrow exactly once',
);
const finalizeStart = clearRuntime.indexOf('const finalize = async () => {');
const finalizeEnd = clearRuntime.indexOf('    if (byokWorkbenchBatchRegistry)', finalizeStart);
assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart, 'trusted reset finalize is missing');
const fencedFinalize = clearRuntime.slice(finalizeStart, finalizeEnd);
assert.match(fencedFinalize, /await getByokGeneratedResultEscrow\(\)\.clearAndRotateKey\(\)/u);
assert.match(fencedFinalize, /byokGeneratedResultVault\.clear\(\)/u);
assert.match(fencedFinalize, /byokWorkbenchPreviewBroker\.clear\(\)/u);
assert.match(fencedFinalize, /await byokWorkbenchSessionManager\.clearProviderState\(\)/u);
assert.match(clearRuntime, /if \(byokWorkbenchBatchRegistry\)[\s\S]*return finalize\(\);/u,
  'an uninitialized Registry must execute the same trusted finalize directly');
assert.match(
  clearRuntime,
  /byokGeneratedResultAuthorityResetQueue\.then\(reset, reset\)/u,
  'credential and permission invalidation must serialize durable cleanup and key rotation',
);
assert.doesNotMatch(
  clearRuntime,
  /clearAndRotateKey\(\)\.catch|void getByokGeneratedResultEscrow|void finalize\(\)/u,
  'credential and permission invalidation must await durable escrow key rotation',
);
assert.match(worker, /onCredentialAuthorityChanged:\s*clearCachedByokGeneratedResults/u);
assert.match(worker, /onConsentRevoked:\s*clearCachedByokGeneratedResults/u);

const deviceClearStart = worker.indexOf('async function clearByokDeviceSessionState(input)');
const deviceClearEnd = worker.indexOf('function logisticsDistributionDisabledResult', deviceClearStart);
assert.ok(deviceClearStart >= 0 && deviceClearEnd > deviceClearStart);
const deviceClear = worker.slice(deviceClearStart, deviceClearEnd);
assert.match(deviceClear, /byokWorkbenchBatchRegistry\.clearAll\(/u);
assert.match(deviceClear, /device_session_changed/u);
assert.match(deviceClear, /getByokProfileStore\(\)\.disconnectDevice\(\)/u);
assert.match(deviceClear, /getByokPermissionBroker\(\)\.clearSessionConsent\(\)/u);
assert.doesNotMatch(
  deviceClear,
  /getByokGeneratedResultEscrow\(\)\.clearAndRotateKey\(\)/u,
  'device invalidation must use the serialized credential and consent callbacks',
);

const lifecycleStart = worker.indexOf('chrome.runtime.onConnect.addListener');
const tabCleanupStart = worker.indexOf('chrome.tabs.onRemoved.addListener');
assert.ok(
  lifecycleStart >= 0 && tabCleanupStart > lifecycleStart,
  'exact document lifecycle cleanup listener is missing',
);
const lifecycle = worker.slice(lifecycleStart, tabCleanupStart);
assert.match(lifecycle, /SS_ERP_BYOK_BATCH_LIFECYCLE_PORT_NAME/u);
assert.match(lifecycle, /authorization\.senderSurface\(sender, chrome\.runtime\.id\)/u);
assert.match(lifecycle, /const owner = Object\.freeze\(\{ tabId, documentId \}\)/u);
assert.match(lifecycle, /byokWorkbenchBatchRegistry\.clear\(owner\)/u);
assert.match(lifecycle, /port\.onMessage\.addListener/u);
assert.match(lifecycle, /SS_ERP_BYOK_BATCH_LIFECYCLE_PING/u);
assert.match(lifecycle, /SS_ERP_BYOK_BATCH_LIFECYCLE_ACK/u);
assert.match(lifecycle, /port\.postMessage\(SS_ERP_BYOK_BATCH_LIFECYCLE_ACK\)/u);
assert.doesNotMatch(
  lifecycle,
  /message\.(?:payload|data|secret|token)|JSON\.stringify\(message\)/u,
  'lifecycle heartbeat must not inspect or forward payload data or secrets',
);

const batchPagePath = 'extensions/ss-erp/pages/ai-image-workbench-batch.js';
const batchPage = readFileSync(batchPagePath, 'utf8');
assert.match(batchPage, /SS_ERP_BYOK_BATCH_LIFECYCLE_PING/u);
assert.match(batchPage, /SS_ERP_BYOK_BATCH_LIFECYCLE_ACK/u);
assert.match(batchPage, /LIFECYCLE_ACK_DEADLINE_MS/u);
assert.match(batchPage, /LIFECYCLE_HEARTBEAT_INTERVAL_MS/u);
assert.match(batchPage, /LIFECYCLE_MAXIMUM_ACTIVE_MS/u);
assert.match(batchPage, /port\.postMessage\(SS_ERP_BYOK_BATCH_LIFECYCLE_PING\)/u);
assert.match(batchPage, /port\.onMessage\.addListener/u);
assert.match(batchPage, /ensureLifecycleProtection\(\)/u);
assert.match(batchPage, /scheduleLifecycleHeartbeat\(\)/u);
assert.match(batchPage, /clearLifecycleTimers\(\)/u);
assert.doesNotMatch(
  batchPage,
  /(?:lifecyclePort|port)\.postMessage\(\s*\{/u,
  'lifecycle heartbeat must send only the fixed public sentinel',
);

assert.ok(tabCleanupStart >= 0, 'tab cleanup listener is missing');
const tabCleanup = worker.slice(tabCleanupStart);
assert.match(tabCleanup, /getByokWorkbenchBatchRegistry\(\)\.removeTab\(tabId\)/u);

const registry = readFileSync(registryPath, 'utf8');
assert.match(registry, /SS_ERP_BYOK_WORKBENCH_BATCH_REGISTRY/u);
assert.match(registry, /(?:clearAll:\s*clearAll|\bclearAll,)/u);
assert.match(registry, /(?:removeTab:\s*removeTab|\bremoveTab,)/u);
assert.match(registry, /async function clearAll\(reasonValue, finalize\)/u);
assert.match(
  registry,
  /var releaseCleanupFence = beginGlobalCleanup\(\);[\s\S]*await waitForReadOperations[\s\S]*await waitForRecoveries[\s\S]*if \(finalize\) await finalize\(\);[\s\S]*releaseCleanupFence\(\);/u,
  'Registry global cleanup must drain read/recovery work and await finalize before fence release',
);
assert.doesNotMatch(
  registry,
  /waitForActiveOperations|activeOperations/u,
  'credential reset must not deadlock by draining profile/permission-dependent mutations',
);

console.log('extension BYOK workbench batch service-worker wiring tests passed');
