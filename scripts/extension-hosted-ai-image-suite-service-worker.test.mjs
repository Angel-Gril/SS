import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const serviceWorkerPath = 'extensions/ss-erp/background/service-worker.js';
const authorizationPath =
  'extensions/ss-erp/shared/message-security/runtime-message-authorization.js';
const legacyPolicyPath =
  'extensions/ss-erp/shared/message-security/runtime-message-policy.js';
const runtimeClientPath =
  'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-runtime-client.js';
const transportPath =
  'extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js';

const serviceWorker = fs.readFileSync(serviceWorkerPath, 'utf8');
const authorization = fs.readFileSync(authorizationPath, 'utf8');
const transport = fs.readFileSync(transportPath, 'utf8');
const runtimeClient = fs.readFileSync(runtimeClientPath, 'utf8');

for (const modulePath of [
  'shared/hosted/ai-image-suite-workbench-adapter.js',
  'shared/hosted/ai-image-suite-candidate-preview-bridge.js',
  'shared/hosted/ai-image-suite-workbench-client.js',
  'shared/hosted/ai-image-suite-workbench-client-registry.js',
  'shared/hosted/ai-image-suite-workbench-runtime-dispatcher.js',
]) {
  assert.match(serviceWorker, new RegExp(modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
}

const listingImport = serviceWorker.indexOf(
  "importScripts('../shared/erp-adapter/listing-workflow-client.js')",
);
const hostedAdapterImport = serviceWorker.indexOf(
  "importScripts('../shared/hosted/ai-image-suite-workbench-adapter.js')",
);
const listener = serviceWorker.indexOf('chrome.runtime.onMessage.addListener');
assert.ok(listingImport >= 0 && listingImport < hostedAdapterImport && hostedAdapterImport < listener);

assert.match(serviceWorker, /getHostedAiImageSuitePreviewBridge/u);
assert.match(serviceWorker, /candidate-preview/u);
assert.match(serviceWorker, /transport\.postRaw\(/u);
assert.match(serviceWorker, /result\.state !== 'raw_response'/u);
assert.match(serviceWorker, /return result\.response/u);
assert.match(serviceWorker, /requiredScope: 'listing:review'/u);
assert.match(transport, /credentials: 'omit'/u);
assert.match(transport, /redirect: 'error'/u);

assert.match(serviceWorker, /createHostedAiImageSuiteWorkbenchClient/u);
assert.match(serviceWorker, /adapterApi\.createAdapter\(\{ intentContract: listingApi \}\)/u);
assert.match(serviceWorker, /previewBridge: getHostedAiImageSuitePreviewBridge\(\)/u);
assert.match(serviceWorker, /getHostedAiImageSuiteClientRegistry/u);
assert.match(serviceWorker, /getClient\(sender, binding\)/u);
assert.match(serviceWorker, /HOSTED_WORKBENCH/u);
assert.match(
  serviceWorker,
  /workbenchDispatcher\.handlers[\s\S]*hostedWorkbenchDispatcher\.handlers/u,
);

assert.match(serviceWorker, /clearHostedAiImageSuiteRuntime\(input && input\.reason\)/u);
assert.match(serviceWorker, /hostedAiImageSuiteClientRegistry\.clearAll/u);
assert.match(serviceWorker, /hostedAiImageSuitePreviewBridge\.clear/u);
assert.match(serviceWorker, /getHostedAiImageSuiteClientRegistry\(\)\.removeTab\(tabId\)/u);

const context = {
  Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise,
  RegExp, Set, String, TypeError, URL,
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(legacyPolicyPath, 'utf8'), context, {
  filename: legacyPolicyPath,
});
vm.runInNewContext(authorization, context, { filename: authorizationPath });
vm.runInNewContext(runtimeClient, context, { filename: runtimeClientPath });
assert.deepEqual(
  JSON.parse(JSON.stringify(
    context.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION.MESSAGE_TYPES.HOSTED_WORKBENCH,
  )),
  JSON.parse(JSON.stringify(
    context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT.MESSAGE_TYPES,
  )),
  'page and background hosted message contracts must be identical',
);

assert.doesNotMatch(
  serviceWorker.slice(
    serviceWorker.indexOf('function createHostedAiImageSuiteWorkbenchClient'),
    serviceWorker.indexOf('function getByokReadinessClient'),
  ),
  /generated-asset-ingest|\.postBytes\(|BYOK_MEDIA_INGEST/u,
);

console.log('extension hosted AI image suite service-worker wiring tests passed');
