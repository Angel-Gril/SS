import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const worker = fs.readFileSync(`${root}/background/service-worker.js`, 'utf8');
const panel = fs.readFileSync(`${root}/content/source-costing-panel.js`, 'utf8');
const popup = fs.readFileSync(`${root}/pages/popup.js`, 'utf8');
const policy = fs.readFileSync(`${root}/shared/message-security/runtime-message-policy.js`, 'utf8');
const sessionPath = `${root}/shared/erp-adapter/source-workflow-device-session.js`;
const clientPath = `${root}/shared/erp-adapter/listing-workflow-client.js`;
const confirmationContractPath = `${root}/shared/erp-adapter/source-media-confirmation.js`;
const confirmationCoordinatorPath = `${root}/shared/erp-adapter/source-media-confirmation-coordinator.js`;
const mutationIntentPath = `${root}/shared/erp-adapter/source-media-mutation-intent.js`;
const viewPath = `${root}/content/source-listing-workbench.js`;
const cssPath = `${root}/content/source-listing-workbench.css`;
const confirmHtmlPath = `${root}/pages/media-confirm.html`;
const confirmCssPath = `${root}/pages/media-confirm.css`;
const confirmPagePath = `${root}/pages/media-confirm.js`;
const confirmLaunchPath = `${root}/pages/media-confirm-launch.html`;

for (const path of [
  sessionPath, clientPath, confirmationContractPath, confirmationCoordinatorPath,
  mutationIntentPath, viewPath, cssPath,
  confirmHtmlPath, confirmCssPath, confirmPagePath, confirmLaunchPath,
]) {
  assert.equal(fs.existsSync(path), true, `${path} should exist`);
}
assert.ok(Number(manifest.minimum_chrome_version) >= 106, 'document-bound confirmation requires Chrome 106+');

const sourceEntry = manifest.content_scripts.find((entry) => (
  entry.js?.includes('content/source-costing-panel.js')
));
assert.ok(sourceEntry, 'source costing content-script entry should exist');
assert.ok(sourceEntry.js.includes('content/source-listing-workbench.js'));
assert.ok(sourceEntry.js.indexOf('content/source-listing-workbench.js') < sourceEntry.js.indexOf('content/source-costing-panel.js'));
assert.ok(sourceEntry.css.includes('content/source-listing-workbench.css'));
assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-workflow-device-session\.js['"]\)/);
assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/listing-workflow-client\.js['"]\)/);
assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-media-confirmation\.js['"]\)/);
assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-media-confirmation-coordinator\.js['"]\)/);
assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-media-mutation-intent\.js['"]\)/);
assert.match(worker, /ss-erp:source-listing-workbench-status/);
assert.match(worker, /ss-erp:source-listing-workbench-media-history/);
assert.match(worker, /ss-erp:source-listing-workbench-media-command/);
assert.match(worker, /readPersistedSourceWorkflowHandoff\(platform, sourceProductId\)/);
assert.match(worker, /handoff\.sourceProductId/);
assert.match(worker, /CREATE_TRANSLATION/);
assert.match(worker, /ss-erp:source-workbench:translation-intents:v1/);
assert.match(worker, /getOrCreateSourceTranslationIntent/);
assert.match(worker, /clearSourceTranslationIntent/);
assert.match(worker, /requestedListingWorkflowId/);
assert.match(worker, /REVIEW_APPROVE/);
assert.match(worker, /REVIEW_REJECT/);
assert.match(worker, /APPLY_APPEND/);
assert.match(worker, /loadBoundedSourceMediaHistoryItem/);
assert.match(worker, /SS_ERP_SOURCE_MEDIA_MUTATION_HISTORY_MAX_PAGES\s*=\s*5/);
assert.match(worker, /currentSourceListingContext\(current, requestedListingWorkflowId\)/);
assert.match(worker, /client\.reviewMediaOutput/);
assert.match(worker, /client\.applyMediaOutput/);
assert.match(worker, /ss-erp:source-workbench:media-mutation-intents:v1/);
assert.match(worker, /getOrCreateSourceMediaMutationIntent/);
assert.match(worker, /executeSourceMediaMutationIntent/);
assert.match(worker, /SS_ERP_SOURCE_MEDIA_MUTATION_INTENT_TTL_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
assert.match(worker, /ss-erp:source-listing-workbench-media-confirm-prepare/);
assert.match(worker, /ss-erp:source-listing-workbench-media-confirm-read/);
assert.match(worker, /ss-erp:source-listing-workbench-media-confirm-submit/);
assert.match(worker, /ss-erp:source-listing-workbench-media-confirm-cancel/);
assert.match(worker, /SS_ERP_SOURCE_MEDIA_CONFIRMATION_TTL_MS\s*=\s*2\s*\*\s*60\s*\*\s*1000/);
assert.match(worker, /chrome\.storage\.session/);
assert.match(worker, /getSourceMediaConfirmationCoordinator\(\)\.open/);
assert.match(worker, /getSourceMediaConfirmationCoordinator\(\)\.claim/);
assert.match(worker, /getSourceMediaConfirmationCoordinator\(\)\.submit/);
assert.match(worker, /getSourceMediaConfirmationCoordinator\(\)\.cancel/);
assert.match(worker, /executeConfirmedSourceMediaMutation/);
assert.match(worker, /publicConfirmation\(confirmation\)/);
const directMediaCommandHandler = worker.slice(
  worker.indexOf('if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_COMMAND_MESSAGE)'),
  worker.indexOf('if (OZON_CALC_SETTINGS_WRITE_CHANNELS.has(message.type))'),
);
assert.doesNotMatch(directMediaCommandHandler, /REVIEW_APPROVE|REVIEW_REJECT|APPLY_APPEND/);
assert.match(directMediaCommandHandler, /CREATE_TRANSLATION/);
assert.doesNotMatch(panel, /shopId:\s*(?:item|output|task)\./);
assert.match(worker, /sourceTranslationIntentWriteQueue/);
assert.match(worker, /SS_ERP_SOURCE_TRANSLATION_INTENT_TTL_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
assert.match(worker, /draftRevision: listing\.revision/);
assert.match(worker, /crypto\.getRandomValues/);
assert.match(policy, /ss-erp:source-listing-workbench-status/);
assert.match(policy, /ss-erp:source-listing-workbench-media-history/);
assert.match(policy, /ss-erp:source-listing-workbench-media-command/);
assert.match(policy, /SOURCE_MEDIA_CONFIRM_PREPARE_TYPES/);
assert.match(policy, /SOURCE_MEDIA_CONFIRM_PAGE_TYPES/);
assert.match(panel, /data-role=["']source-listing-workbench["']/);
assert.match(panel, /SS_ERP_SOURCE_LISTING_WORKBENCH/);
assert.match(panel, /sourceWorkbenchRequestSeq/);
assert.match(panel, /state:\s*'unavailable',\s*reason:\s*'runtime_unavailable'/);
assert.match(panel, /listings\.length === 1/);
assert.match(panel, /currentSourcePageKey/);
assert.match(panel, /onReviewOutput/);
assert.match(panel, /onApplyOutput/);
assert.match(panel, /sourceWorkbenchHistoryOpen\s*=\s*false/);
const mutationPanelSource = panel.slice(
  panel.indexOf('async function executeSourceWorkbenchMediaMutation'),
  panel.indexOf('function currentSourceMediaInputs'),
);
assert.match(mutationPanelSource, /ss-erp:source-listing-workbench-media-confirm-prepare/);
assert.doesNotMatch(mutationPanelSource, /ss-erp:source-listing-workbench-media-command/);
assert.doesNotMatch(mutationPanelSource, /client\.(?:reviewMediaOutput|applyMediaOutput)/);
assert.match(popup, /restoreSourceWorkflowHandoffForCurrentPage/);
assert.match(popup, /ss-erp:source-listing-workbench-status/);
assert.doesNotMatch(
  [worker, panel, fs.readFileSync(sessionPath, 'utf8'), fs.readFileSync(clientPath, 'utf8')].join('\n'),
  /legacyAccountToken|accountBearerToken|accountAccessToken|ozonApiKey|dashscopeApiKey/i,
);

const sessionSource = fs.readFileSync(sessionPath, 'utf8');
const clientSource = fs.readFileSync(clientPath, 'utf8');
const confirmationContractSource = fs.readFileSync(confirmationContractPath, 'utf8');
const confirmationCoordinatorSource = fs.readFileSync(confirmationCoordinatorPath, 'utf8');
const mutationIntentSource = fs.readFileSync(mutationIntentPath, 'utf8');
const viewSource = fs.readFileSync(viewPath, 'utf8');

const policyContext = { URL, Array, Boolean, Object, Set, String };
policyContext.globalThis = policyContext;
vm.runInNewContext(policy, policyContext, { filename: `${root}/shared/message-security/runtime-message-policy.js` });
const runtimePolicy = policyContext.SS_ERP_RUNTIME_MESSAGE_POLICY;
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const sourceSender = {
  id: extensionId,
  url: 'https://detail.1688.com/offer/123.html',
  tab: { url: 'https://detail.1688.com/offer/123.html' },
};
const confirmSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/pages/media-confirm.html`,
  documentId: 'document-confirm-1',
  frameId: 0,
  tab: {
    id: 91,
    url: `chrome-extension://${extensionId}/pages/media-confirm.html`,
  },
};
const popupSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/pages/popup.html`,
};
assert.equal(runtimePolicy.isAllowedRuntimeMessageSender(
  'ss-erp:source-listing-workbench-media-confirm-prepare', sourceSender, extensionId,
), true);
for (const type of [
  'ss-erp:source-listing-workbench-media-confirm-read',
  'ss-erp:source-listing-workbench-media-confirm-submit',
  'ss-erp:source-listing-workbench-media-confirm-cancel',
]) {
  assert.equal(runtimePolicy.isAllowedRuntimeMessageSender(type, sourceSender, extensionId), false);
  assert.equal(runtimePolicy.isAllowedRuntimeMessageSender(type, popupSender, extensionId), false);
  assert.equal(runtimePolicy.isAllowedRuntimeMessageSender(type, confirmSender, extensionId), true);
}
assert.equal(runtimePolicy.isAllowedRuntimeMessageSender(
  'ss-erp:source-listing-workbench-media-confirm-prepare', confirmSender, extensionId,
), false);

const confirmationContractContext = {
  URL, Array, Date, Number, Object, Set, String, Uint8Array,
};
confirmationContractContext.globalThis = confirmationContractContext;
vm.runInNewContext(confirmationContractSource, confirmationContractContext, {
  filename: confirmationContractPath,
});
vm.runInNewContext(confirmationCoordinatorSource, confirmationContractContext, {
  filename: confirmationCoordinatorPath,
});
const confirmationContract = confirmationContractContext.SS_ERP_SOURCE_MEDIA_CONFIRMATION;
const confirmationCoordinatorContract =
  confirmationContractContext.SS_ERP_SOURCE_MEDIA_CONFIRMATION_COORDINATOR;
let randomByte = 0;
const nonce = confirmationContract.createNonce({
  getRandomValues(bytes) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = randomByte++;
    return bytes;
  },
});
assert.match(nonce, /^[a-f0-9]{64}$/u);
const confirmationNow = Date.parse('2026-07-22T00:00:00.000Z');
const normalizedConfirmation = confirmationContract.normalizeIntent({
  nonce,
  platform: '1688',
  sourceProductId: 'source-1',
  snapshotId: 'snapshot-1',
  listingWorkflowId: 'listing-1',
  shopId: 'shop-1',
  mediaWorkflowId: 'media-1',
  outputAssetId: 'asset-1',
  action: 'APPLY_APPEND',
  operation: 'IMAGE_TRANSLATE',
  expectedWorkflowRevision: 3,
  expectedTargetRevision: 11,
  expectedTargetDraftVersion: 7,
  preview: {
    url: 'https://cdn.example/output.png', mimeType: 'image/png', width: 900, height: 1200,
  },
  sourceTabId: 42,
  confirmationTabId: 91,
  confirmationDocumentId: null,
  createdAt: confirmationNow,
  expiresAt: confirmationNow + 120000,
  completedAt: null,
}, { now: confirmationNow, maximumLifetimeMs: 120000 });
assert.ok(normalizedConfirmation);
const documentBoundConfirmation = confirmationContract.bindSender(normalizedConfirmation, {
  tab: { id: 91 }, frameId: 0, documentId: 'document-confirm-1',
});
assert.ok(documentBoundConfirmation);
assert.equal(confirmationContract.isBoundSender(documentBoundConfirmation, {
  tab: { id: 91 }, frameId: 0, documentId: 'document-confirm-1',
}), true);
assert.equal(confirmationContract.isBoundSender(documentBoundConfirmation, {
  tab: { id: 92 }, frameId: 0, documentId: 'document-confirm-1',
}), false);
assert.equal(confirmationContract.isBoundSender(documentBoundConfirmation, {
  tab: { id: 91 }, frameId: 1, documentId: 'document-confirm-1',
}), false);
assert.equal(confirmationContract.isBoundSender(documentBoundConfirmation, {
  tab: { id: 91 }, frameId: 0, documentId: 'document-confirm-2',
}), false);
assert.deepEqual(JSON.parse(JSON.stringify(
  confirmationContract.publicConfirmation(normalizedConfirmation),
)), {
  action: 'APPLY_APPEND',
  operation: 'IMAGE_TRANSLATE',
  target: {
    platform: '1688', sourceProductId: 'source-1', shopId: 'shop-1', listingWorkflowId: 'listing-1',
  },
  preview: {
    url: 'https://cdn.example/output.png', mimeType: 'image/png', width: 900, height: 1200,
  },
  expiresAt: confirmationNow + 120000,
  completed: false,
});
assert.equal(Object.prototype.hasOwnProperty.call(
  confirmationContract.publicConfirmation(normalizedConfirmation), 'shopId',
), false);
assert.equal(confirmationContract.normalizeIntent(
  { ...normalizedConfirmation, provider: 'must-not-cross-boundary' },
  { now: confirmationNow, maximumLifetimeMs: 120000 },
), null);
assert.equal(confirmationContract.normalizeIntent(
  normalizedConfirmation,
  { now: confirmationNow + 120001, maximumLifetimeMs: 120000 },
), null);
const completedAfterExpiry = confirmationContract.normalizeIntent({
  ...normalizedConfirmation,
  completedAt: confirmationNow + 120001,
}, { now: confirmationNow + 120001, maximumLifetimeMs: 120000 });
assert.ok(completedAfterExpiry, 'an operation authorized before expiry may record its completed state');
assert.equal(confirmationContract.normalizeIntent(
  completedAfterExpiry,
  { now: confirmationNow + 240001, maximumLifetimeMs: 120000 },
), null, 'completed confirmations remain bounded in session storage');
for (const url of [
  'https://cdn.example/output.png?token=secret',
  'https://cdn.example/output.png#candidate',
  'https://cdn.example./output.png',
]) {
  assert.equal(confirmationContract.normalizeIntent({
    ...normalizedConfirmation,
    preview: { ...normalizedConfirmation.preview, url },
  }, { now: confirmationNow, maximumLifetimeMs: 120000 }), null);
}

const confirmationStorageKey = 'test:media-confirmations';
const confirmationInput = {
  platform: '1688',
  sourceProductId: 'source-1',
  snapshotId: 'snapshot-1',
  listingWorkflowId: 'listing-1',
  shopId: 'shop-1',
  mediaWorkflowId: 'media-1',
  outputAssetId: 'asset-1',
  action: 'APPLY_APPEND',
  operation: 'IMAGE_TRANSLATE',
  expectedWorkflowRevision: 3,
  expectedTargetRevision: 11,
  expectedTargetDraftVersion: 7,
  preview: {
    url: 'https://cdn.example/output.png', mimeType: 'image/png', width: 900, height: 1200,
  },
  sourceTabId: 42,
};

function cloneConfirmationHarnessValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createConfirmationCoordinatorHarness(options = {}) {
  const storageState = {};
  const events = [];
  let currentTime = confirmationNow;
  let randomOffset = Number(options.randomOffset || 0);
  const chromeMock = {
    storage: {
      session: {
        async get(keys) {
          events.push({ type: 'storage.get', keys: [...keys] });
          return Object.fromEntries(keys.map((key) => [
            key, cloneConfirmationHarnessValue(storageState[key]),
          ]));
        },
        async set(values) {
          events.push({ type: 'storage.set', values: cloneConfirmationHarnessValue(values) });
          Object.assign(storageState, cloneConfirmationHarnessValue(values));
        },
      },
    },
    windows: {
      async create(createOptions) {
        events.push({ type: 'windows.create', options: cloneConfirmationHarnessValue(createOptions) });
        return {
          id: 701,
          tabs: options.popupIncludesTab === false ? [] : [{ id: 91 }],
        };
      },
      async remove(windowId) {
        events.push({ type: 'windows.remove', windowId });
      },
    },
    tabs: {
      async query(query) {
        events.push({ type: 'tabs.query', query: cloneConfirmationHarnessValue(query) });
        return [{ id: 91 }];
      },
      async update(tabId, update) {
        events.push({ type: 'tabs.update', tabId, update: cloneConfirmationHarnessValue(update) });
        if (options.failNavigation) throw new Error('test navigation failure');
        return { id: tabId, ...update };
      },
    },
    runtime: {
      getURL(path) { return `chrome-extension://${extensionId}/${path}`; },
    },
  };
  const coordinator = confirmationCoordinatorContract.createCoordinator({
    contract: confirmationContract,
    storage: chromeMock.storage.session,
    windows: chromeMock.windows,
    tabs: chromeMock.tabs,
    runtime: chromeMock.runtime,
    crypto: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = (randomOffset + index) % 256;
        }
        randomOffset += bytes.length;
        return bytes;
      },
    },
    storageKey: confirmationStorageKey,
    ttlMs: 120000,
    limit: 20,
    now: () => currentTime,
  });
  return {
    coordinator,
    events,
    storageState,
    setNow(value) { currentTime = value; },
  };
}

async function openAndClaimConfirmation(harness, documentId = 'document-confirm-1') {
  const opened = await harness.coordinator.open(confirmationInput);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), { state: 'confirmation_opened' });
  const records = harness.storageState[confirmationStorageKey];
  const nonces = Object.keys(records || {});
  assert.equal(nonces.length, 1);
  const openedNonce = nonces[0];
  const sender = { tab: { id: 91 }, frameId: 0, documentId };
  const claimed = await harness.coordinator.claim(openedNonce, sender);
  assert.ok(claimed);
  return { nonce: openedNonce, sender, claimed };
}

const coordinatorHarness = createConfirmationCoordinatorHarness({ popupIncludesTab: false });
const opened = await coordinatorHarness.coordinator.open(confirmationInput);
assert.deepEqual(JSON.parse(JSON.stringify(opened)), { state: 'confirmation_opened' });
const coordinatorRecords = coordinatorHarness.storageState[confirmationStorageKey];
const coordinatorNonce = Object.keys(coordinatorRecords)[0];
assert.match(coordinatorNonce, /^[a-f0-9]{64}$/u);
assert.equal(coordinatorRecords[coordinatorNonce].confirmationDocumentId, null);
assert.equal(coordinatorRecords[coordinatorNonce].confirmationTabId, 91);
const launchEvent = coordinatorHarness.events.find((event) => event.type === 'windows.create');
assert.equal(
  launchEvent.options.url,
  `chrome-extension://${extensionId}/pages/media-confirm-launch.html`,
);
assert.ok(coordinatorHarness.events.some((event) => event.type === 'tabs.query'));
const persistIndex = coordinatorHarness.events.findIndex((event) => event.type === 'storage.set');
const navigationIndex = coordinatorHarness.events.findIndex((event) => event.type === 'tabs.update');
assert.ok(persistIndex >= 0 && navigationIndex > persistIndex, 'intent persists before confirm navigation');
assert.equal(
  coordinatorHarness.events[navigationIndex].update.url,
  `chrome-extension://${extensionId}/pages/media-confirm.html#nonce=${coordinatorNonce}`,
);

const navigationFailureHarness = createConfirmationCoordinatorHarness({ failNavigation: true });
await assert.rejects(
  navigationFailureHarness.coordinator.open(confirmationInput),
  /test navigation failure/u,
);
assert.deepEqual(
  navigationFailureHarness.storageState[confirmationStorageKey],
  {},
  'failed confirm navigation removes the persisted intent',
);
assert.ok(
  navigationFailureHarness.events.some((event) => (
    event.type === 'windows.remove' && event.windowId === 701
  )),
  'failed confirm navigation closes the orphaned popup',
);

const claimedSender = { tab: { id: 91 }, frameId: 0, documentId: 'document-confirm-1' };
const firstClaim = await coordinatorHarness.coordinator.claim(coordinatorNonce, claimedSender);
assert.equal(firstClaim.confirmationDocumentId, 'document-confirm-1');
for (const wrongSender of [
  { tab: { id: 92 }, frameId: 0, documentId: 'document-confirm-1' },
  { tab: { id: 91 }, frameId: 1, documentId: 'document-confirm-1' },
  { tab: { id: 91 }, frameId: 0, documentId: 'document-confirm-2' },
]) {
  assert.equal(
    await coordinatorHarness.coordinator.claim(coordinatorNonce, wrongSender),
    null,
    'the first top-frame document claim cannot be rebound',
  );
}
assert.equal(
  coordinatorHarness.storageState[confirmationStorageKey][coordinatorNonce].confirmationDocumentId,
  'document-confirm-1',
);
let unauthorizedMutations = 0;
for (const wrongSender of [
  { tab: { id: 42 }, frameId: 0, documentId: 'source-page-document' },
  { tab: { id: 91 }, frameId: 1, documentId: 'document-confirm-1' },
  { tab: { id: 91 }, frameId: 0, documentId: 'document-confirm-2' },
]) {
  await assert.rejects(
    coordinatorHarness.coordinator.submit(coordinatorNonce, wrongSender, async () => {
      unauthorizedMutations += 1;
      return { replay: false };
    }),
    /确认窗口身份无效/u,
  );
}
assert.equal(unauthorizedMutations, 0, 'source-page and mismatched senders cannot mutate');

const cancelFirstHarness = createConfirmationCoordinatorHarness({ randomOffset: 32 });
const cancelFirst = await openAndClaimConfirmation(cancelFirstHarness, 'cancel-first-document');
let cancelFirstMutations = 0;
const [cancelWon, submitAfterCancel] = await Promise.allSettled([
  cancelFirstHarness.coordinator.cancel(cancelFirst.nonce, cancelFirst.sender),
  cancelFirstHarness.coordinator.submit(cancelFirst.nonce, cancelFirst.sender, async () => {
    cancelFirstMutations += 1;
    return { replay: false };
  }),
]);
assert.equal(cancelWon.status, 'fulfilled');
assert.equal(cancelWon.value.state, 'cancelled');
assert.equal(submitAfterCancel.status, 'rejected');
assert.equal(cancelFirstMutations, 0, 'cancel winning the nonce queue prevents mutation');

const submitFirstHarness = createConfirmationCoordinatorHarness({ randomOffset: 64 });
const submitFirst = await openAndClaimConfirmation(submitFirstHarness, 'submit-first-document');
let submitFirstMutations = 0;
const [submitWon, cancelAfterSubmit] = await Promise.all([
  submitFirstHarness.coordinator.submit(submitFirst.nonce, submitFirst.sender, async () => {
    submitFirstMutations += 1;
    await Promise.resolve();
    return { replay: false };
  }),
  submitFirstHarness.coordinator.cancel(submitFirst.nonce, submitFirst.sender),
]);
assert.equal(submitWon.state, 'completed');
assert.equal(submitWon.completedNow, true);
assert.equal(cancelAfterSubmit.state, 'completed');
assert.equal(submitFirstMutations, 1, 'submit winning the nonce queue executes exactly once');
const replayedSubmit = await submitFirstHarness.coordinator.submit(
  submitFirst.nonce,
  submitFirst.sender,
  async () => {
    submitFirstMutations += 1;
    return { replay: false };
  },
);
assert.equal(replayedSubmit.replay, true);
assert.equal(replayedSubmit.completedNow, false);
assert.equal(submitFirstMutations, 1, 'completed confirmation replay does not execute twice');

const serialQueue = confirmationContract.createSerialQueue();
let serialState = 'pending';
let serialMutations = 0;
await Promise.all([
  serialQueue.run(async () => { serialState = 'cancelled'; }),
  serialQueue.run(async () => {
    if (serialState === 'pending') {
      serialMutations += 1;
      serialState = 'completed';
    }
  }),
]);
assert.equal(serialMutations, 0, 'cancel winning the confirmation queue prevents mutation');
const submitFirstQueue = confirmationContract.createSerialQueue();
serialState = 'pending';
await Promise.all([
  submitFirstQueue.run(async () => {
    if (serialState === 'pending') {
      serialMutations += 1;
      await Promise.resolve();
      serialState = 'completed';
    }
  }),
  submitFirstQueue.run(async () => {
    if (serialState === 'pending') serialState = 'cancelled';
  }),
]);
assert.equal(serialState, 'completed', 'submit winning the confirmation queue retains completion');
assert.equal(serialMutations, 1);

const mutationIntentContext = { Array, Date, Error, Map, Number, Object, Promise, Set, String };
mutationIntentContext.globalThis = mutationIntentContext;
vm.runInNewContext(mutationIntentSource, mutationIntentContext, { filename: mutationIntentPath });
const mutationIntentContract = mutationIntentContext.SS_ERP_SOURCE_MEDIA_MUTATION_INTENT;
const mutationStorageState = {};
const mutationStorage = {
  async get(keys) {
    return Object.fromEntries(keys.map((key) => [
      key,
      mutationStorageState[key] === undefined
        ? undefined
        : JSON.parse(JSON.stringify(mutationStorageState[key])),
    ]));
  },
  async set(values) {
    Object.assign(mutationStorageState, JSON.parse(JSON.stringify(values)));
  },
};
const mutationStorageKey = 'test:media-mutation-intents';
const mutationTtlMs = 24 * 60 * 60 * 1000;
let mutationNow = confirmationNow;
const mutationBase = {
  platform: '1688', sourceProductId: 'source-1', snapshotId: 'snapshot-1',
  listingWorkflowId: 'listing-1', shopId: 'shop-1', mediaWorkflowId: 'media-1',
  outputAssetId: 'asset-1', action: 'APPLY_APPEND', expectedWorkflowRevision: 3,
  expectedTargetRevision: 11, expectedTargetDraftVersion: 7,
};
const firstMutationStore = mutationIntentContract.createStore({
  storage: mutationStorage, storageKey: mutationStorageKey, ttlMs: mutationTtlMs,
  limit: 20, now: () => mutationNow,
});
const firstMutation = await firstMutationStore.getOrCreate(mutationBase);
assert.equal(firstMutation.replay, false);
assert.ok(await firstMutationStore.read(firstMutation.intent.identity));
const restartedMutationStore = mutationIntentContract.createStore({
  storage: mutationStorage, storageKey: mutationStorageKey, ttlMs: mutationTtlMs,
  limit: 20, now: () => mutationNow,
});
const responseLossReplay = await restartedMutationStore.getOrCreate(mutationBase);
assert.equal(responseLossReplay.replay, true, 'persisted intent recovers response-loss after worker restart');
assert.deepEqual(
  JSON.parse(JSON.stringify(responseLossReplay.intent)),
  JSON.parse(JSON.stringify(firstMutation.intent)),
);
await assert.rejects(
  restartedMutationStore.getOrCreate({ ...mutationBase, snapshotId: 'snapshot-conflict' }),
  /上下文冲突/u,
);
mutationNow += mutationTtlMs;
assert.equal(await restartedMutationStore.read(firstMutation.intent.identity), null, 'intent expires at 24h');
delete mutationStorageState[mutationStorageKey];
mutationNow = confirmationNow;
const boundedMutationStore = mutationIntentContract.createStore({
  storage: mutationStorage, storageKey: mutationStorageKey, ttlMs: mutationTtlMs,
  limit: 20, now: () => mutationNow,
});
let firstBoundedIdentity = '';
for (let index = 0; index < 21; index += 1) {
  mutationNow += 1;
  const created = await boundedMutationStore.getOrCreate({
    ...mutationBase,
    mediaWorkflowId: `media-${index}`,
    outputAssetId: `asset-${index}`,
  });
  if (index === 0) firstBoundedIdentity = created.intent.identity;
}
assert.equal(Object.keys(mutationStorageState[mutationStorageKey]).length, 20);
assert.equal(Object.prototype.hasOwnProperty.call(
  mutationStorageState[mutationStorageKey], firstBoundedIdentity,
), false, 'bounded persistence evicts the oldest valid mutation intent');
const context = {
  URL, URLSearchParams, AbortController, Array, Boolean, Date, Error, JSON, Number, Object,
  Set, String, TextDecoder, TextEncoder, Uint8Array, clearTimeout, crypto: globalThis.crypto, setTimeout,
};
context.globalThis = context;
vm.runInNewContext(sessionSource, context, { filename: sessionPath });
vm.runInNewContext(clientSource, context, { filename: clientPath });

const requests = [];
let current = true;
const credentials = {
  async beginOperation() {
    return {
      state: 'paired', epoch: 1, baseUrl: 'https://erp.example', sessionId: 'session-1',
      scopes: ['listing:review', 'media:execute'], accessToken: 'device-access-token',
    };
  },
  async isOperationCurrent() { return current; },
  async clearIfCurrent() { throw new Error('should not clear a valid device session'); },
};
const transport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials,
  fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return {
      status: 200,
      ok: true,
      headers: { get() { return null; } },
      async text() {
        return JSON.stringify({
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-7' },
            status: {
              contractVersion: 'extension-source-workbench-status/v1',
              snapshot: { id: 'snapshot-1', version: 1, capturedAt: '2026-07-21T00:00:00.000Z', current: true },
              listing: { items: [], truncated: false },
              media: { items: [], truncated: false, actionableCount: 0 },
            },
          },
        });
      },
    };
  },
});
const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport });
const status = await client.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' });
assert.equal(status.state, 'ready');
assert.equal(requests.length, 1);
assert.equal(
  requests[0].url,
  'https://erp.example/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
);
assert.equal(requests[0].init.headers.Authorization, 'Bearer device-access-token');
assert.equal(requests[0].init.credentials, 'omit');
assert.equal(requests[0].init.cache, 'no-store');
assert.equal(requests[0].init.signal instanceof AbortSignal, true);

const historyRequests = [];
const historyClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get(path, options) {
      historyRequests.push({ path, options });
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-history-1' },
            history: {
              contractVersion: 'extension-source-media-history/v1',
              context: {
                snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
                listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
              },
              snapshot: { id: 'snapshot-1', version: 4, capturedAt: '2026-07-21T00:00:00.000Z' },
              items: [{
                id: 'media-history-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
                reviewStatus: 'PENDING', revision: 2, contextSkuKey: null,
                contextSlotKey: 'hero', selectedOutputAssetId: 'asset-1',
                outputs: [{
                  id: 'asset-1', url: 'https://cdn.example/output.png', mimeType: 'image/png',
                  width: 900, height: 1200,
                }],
                application: null,
                createdAt: '2026-07-21T00:00:00.000Z',
                updatedAt: '2026-07-21T00:00:01.000Z',
              }],
              nextCursor: 'cursor-1',
            },
          },
        },
      };
    },
    async post() { throw new Error('history client must not POST'); },
  },
});
const history = await historyClient.getMediaHistory({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7, limit: 10,
});
assert.equal(history.state, 'ready');
assert.equal(history.history.items[0].outputs[0].url, 'https://cdn.example/output.png');
assert.equal(historyRequests[0].options.requiredScope, 'listing:review');
assert.match(historyRequests[0].path, /media-history\?/u);
assert.match(historyRequests[0].path, /listingWorkflowId=listing-1/u);

const invalidHistoryClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() {
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-history-1' },
            history: {
              contractVersion: 'extension-source-media-history/v1',
              context: {
                snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
                listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
              },
              snapshot: { id: 'snapshot-1', version: 4, capturedAt: '2026-07-21T00:00:00.000Z' },
              items: [{
                id: 'media-history-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
                reviewStatus: 'PENDING', revision: 2, contextSkuKey: null,
                contextSlotKey: null, selectedOutputAssetId: null,
                outputs: [{
                  id: 'secret', url: 'http://remote.example/private.png', mimeType: 'image/png',
                  width: 1, height: 1,
                }],
                application: null,
                createdAt: '2026-07-21T00:00:00.000Z',
                updatedAt: '2026-07-21T00:00:01.000Z',
              }],
              nextCursor: null,
            },
          },
        },
      };
    },
  },
});
await assert.rejects(
  invalidHistoryClient.getMediaHistory({
    snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
    listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
  }),
  /invalid source media history response/u,
);

const launchRequests = [];
const launchClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get(path) {
      launchRequests.push(path);
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: {
              enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
              revision: 'pilot-1', testOnly: true, operation: 'IMAGE_TRANSLATE',
              sourceLanguage: 'zh', targetLanguage: 'ru',
            },
            context: {
              id: 'listing-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
              snapshotId: 'snapshot-1', revision: 11, draftVersion: 7,
              sourceInputs: [{ sourceMediaKey: 'media-1' }],
              requested: {
                snapshotId: 'snapshot-1', listingWorkflowId: 'listing-1',
                revision: 11, draftVersion: 7,
              },
            },
          },
        },
      };
    },
    async post() { throw new Error('launch test must not POST'); },
  },
});
const launch = await launchClient.getMediaLaunch({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
});
assert.equal(launch.state, 'ready');
assert.match(launchRequests[0], /\/media-launch\?/u);
assert.match(launchRequests[0], /revision=11/u);
assert.match(launchRequests[0], /draftVersion=7/u);

const createRequests = [];
const createClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() { throw new Error('create test must not GET'); },
    async post(path, body, options) {
      createRequests.push({ path, body, options });
      if (path.endsWith('/command-grants')) {
        return {
          state: 'response', status: 201,
          body: { code: 1, data: { grantToken: 'g'.repeat(43) } },
        };
      }
      return {
        state: 'response', status: 202,
        body: {
          code: 1,
          data: {
            replay: false,
            receipt: {
              id: 'receipt-create-1', status: 'SUCCEEDED', failureCode: null,
              result: {
                workflowId: 'media-created', action: 'CREATE_TRANSLATION',
                operation: 'IMAGE_TRANSLATE', status: 'QUEUED', revision: 1,
              },
            },
          },
        },
      };
    },
  },
});
const createdTranslation = await createClient.createTranslationCommand({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
  sourceMediaKey: 'media-1', workflowOperationKey: 'intent-key-1',
  provider: 'openai', model: 'gpt-image-2', apiKey: 'must-not-be-sent',
  resolvedPrompt: 'must-not-be-sent',
});
assert.equal(createdTranslation.state, 'completed');
assert.equal(createRequests.length, 2);
assert.match(createRequests[0].body.idempotencyKey, /^extension-media-create:[a-f0-9]{64}$/u);
assert.equal(createRequests[1].options.commandGrant, 'g'.repeat(43));
assert.deepEqual(JSON.parse(JSON.stringify(createRequests[0].body.command)), {
  schemaVersion: 'ai-media-workflow-create/v1',
  action: 'CREATE_TRANSLATION',
  sourceMediaKey: 'media-1',
  draftRevision: 11,
  workflowOperationKey: 'intent-key-1',
});
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'provider'), false);
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'model'), false);
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'apiKey'), false);
assert.equal(Object.prototype.hasOwnProperty.call(createRequests[0].body.command, 'resolvedPrompt'), false);

const mutationRequests = [];
const mutationClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() { throw new Error('mutation test must not GET'); },
    async post(path, body, options) {
      mutationRequests.push({ path, body, options });
      if (path.endsWith('/command-grants')) {
        return {
          state: 'response', status: 201,
          body: { code: 1, data: { grantToken: 'm'.repeat(43) } },
        };
      }
      const result = body.operation === 'MEDIA_REVIEW'
        ? {
          workflowId: 'media-history-1', action: 'REVIEW', status: 'SUCCEEDED',
          reviewStatus: 'APPROVED', selectedOutputAssetId: 'asset-1',
          revision: 3, replayed: false,
        }
        : {
          workflowId: 'media-history-1', action: 'APPLY', status: 'SUCCEEDED',
          reviewStatus: 'APPROVED', selectedOutputAssetId: 'asset-1',
          revision: 4, applicationId: 'application-1', targetRevision: 12,
          targetDraftVersion: 8, replayed: false,
        };
      return {
        state: 'response', status: 202,
        body: {
          code: 1,
          data: {
            replay: false,
            receipt: { id: 'receipt-mutation-1', status: 'SUCCEEDED', result },
          },
        },
      };
    },
  },
});
const reviewInput = {
  mediaWorkflowId: 'media-history-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', outputAssetId: 'asset-1',
  expectedRevision: 2, draftRevision: 11, draftVersion: 7,
  decision: 'APPROVE', note: null,
};
await mutationClient.reviewMediaOutput(reviewInput);
await mutationClient.reviewMediaOutput(reviewInput);
assert.equal(mutationRequests[0].body.operation, 'MEDIA_REVIEW');
assert.equal(mutationRequests[0].options.requiredScope, 'listing:review');
assert.equal(mutationRequests[1].options.requiredScope, 'listing:review');
assert.match(mutationRequests[0].body.idempotencyKey, /^extension-media-review:[a-f0-9]{64}$/u);
assert.equal(mutationRequests[2].body.idempotencyKey, mutationRequests[0].body.idempotencyKey);
assert.deepEqual(JSON.parse(JSON.stringify(mutationRequests[0].body.command)), {
  schemaVersion: 'ai-media-workflow-review/v1', action: 'REVIEW',
  mediaWorkflowId: 'media-history-1', expectedRevision: 2, draftRevision: 11,
  outputAssetId: 'asset-1', decision: 'APPROVE', note: null,
});

const applyInput = {
  mediaWorkflowId: 'media-history-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', outputAssetId: 'asset-1',
  expectedWorkflowRevision: 3, expectedTargetRevision: 11,
  expectedTargetDraftVersion: 7,
};
await mutationClient.applyMediaOutput(applyInput);
await mutationClient.applyMediaOutput(applyInput);
assert.equal(mutationRequests[4].body.operation, 'MEDIA_APPLY');
assert.equal(mutationRequests[4].options.requiredScope, 'listing:write');
assert.equal(mutationRequests[5].options.requiredScope, 'listing:write');
assert.match(mutationRequests[4].body.idempotencyKey, /^extension-media-apply:[a-f0-9]{64}$/u);
assert.equal(mutationRequests[6].body.idempotencyKey, mutationRequests[4].body.idempotencyKey);
assert.deepEqual(JSON.parse(JSON.stringify(mutationRequests[4].body.command)), {
  schemaVersion: 'ai-media-workflow-apply/v1', action: 'APPLY',
  mediaWorkflowId: 'media-history-1', expectedWorkflowRevision: 3,
  expectedTargetRevision: 11, expectedTargetDraftVersion: 7,
  outputAssetId: 'asset-1', mode: 'append',
});
for (const request of mutationRequests) {
  assert.equal(Object.prototype.hasOwnProperty.call(request.body, 'provider'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request.body, 'model'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request.body, 'apiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request.body, 'resolvedPrompt'), false);
}

const secretResultClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() { throw new Error('secret result test must not GET'); },
    async post(path) {
      if (path.endsWith('/command-grants')) {
        return { state: 'response', body: { code: 1, data: { grantToken: 's'.repeat(43) } } };
      }
      return {
        state: 'response',
        body: {
          code: 1,
          data: {
            replay: false,
            receipt: {
              status: 'SUCCEEDED',
              result: {
                workflowId: 'media-history-1', action: 'REVIEW', status: 'SUCCEEDED',
                reviewStatus: 'APPROVED', selectedOutputAssetId: 'asset-1',
                revision: 3, replayed: false, apiKey: 'must-not-cross-boundary',
              },
            },
          },
        },
      };
    },
  },
});
await assert.rejects(secretResultClient.reviewMediaOutput(reviewInput), /media review result is invalid/u);

const darkLaunchClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() {
      return {
        state: 'response', status: 200,
        body: {
          code: 1,
          data: {
            capability: {
              enabled: false, ready: false, reasonCode: 'MEDIA_CREATE_DISABLED',
              reason: 'dark', revision: 'off', testOnly: true,
              operation: 'IMAGE_TRANSLATE', sourceLanguage: 'zh', targetLanguage: 'ru',
            },
            context: null,
          },
        },
      };
    },
    async post() { throw new Error('dark launch must not POST'); },
  },
});
assert.equal((await darkLaunchClient.getMediaLaunch({
  snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
})).state, 'disabled');

const commandRequests = [];
const commandClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() { throw new Error('command test must not use GET'); },
    async post(path, body, options) {
      commandRequests.push({ path, body, options });
      if (path.endsWith('/command-grants')) {
        return {
          state: 'response', status: 201,
          body: {
            code: 1,
            data: { grantId: 'grant-1', grantToken: 'g'.repeat(43), expiresAt: '2026-07-21T00:01:00.000Z' },
          },
        };
      }
      return {
        state: 'response', status: 202,
        body: {
          code: 1,
          data: {
            replay: false,
            receipt: {
              id: 'receipt-1', status: 'SUCCEEDED', failureCode: null,
              result: { workflowId: 'media-1', action: 'RETRY', status: 'QUEUED', revision: 4 },
            },
          },
        },
      };
    },
  },
});
const mediaCommandInput = {
  action: 'RETRY', mediaWorkflowId: 'media-1', expectedRevision: 3,
  shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
};
const commandResult = await commandClient.executeMediaCommand(mediaCommandInput);
assert.equal(commandResult.state, 'completed');
assert.equal(commandRequests.length, 2);
assert.equal(commandRequests[0].path, '/api/extension-device/command-grants');
assert.equal(commandRequests[0].body.operation, 'MEDIA_EXECUTE');
assert.match(commandRequests[0].body.idempotencyKey, /^extension-media:[a-f0-9]{64}$/);
assert.equal(commandRequests[1].path, '/api/extension-device/media-workflows/execute');
assert.equal(commandRequests[1].body.idempotencyKey, commandRequests[0].body.idempotencyKey);
assert.equal(commandRequests[1].options.commandGrant, 'g'.repeat(43));
await commandClient.executeMediaCommand(mediaCommandInput);
assert.notEqual(
  commandRequests[2].body.idempotencyKey,
  commandRequests[0].body.idempotencyKey,
  'a failed or response-lost command must be retryable with a fresh attempt key',
);

const invalidClient = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
  transport: {
    async get() {
      return {
        state: 'response',
        status: 200,
        body: {
          code: 1,
          data: {
            capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-7' },
            status: {
              contractVersion: 'extension-source-workbench-status/v1',
              snapshot: { id: 'snapshot-1', version: 1, capturedAt: '2026-07-21T00:00:00.000Z', current: true },
              listing: { items: [], truncated: false },
              media: {
                items: [{
                  id: 'media-1', operation: 'IMAGE_TRANSLATE', status: 'RUNNING',
                  reviewStatus: 'NOT_READY', revision: 1, contextType: null, contextId: null,
                  contextSkuKey: null, contextSlotKey: null, hasSelectedOutput: false,
                  actionable: true, updatedAt: new Date('2026-07-21T00:00:00.000Z'),
                }],
                truncated: false,
                actionableCount: 1,
              },
            },
          },
        },
      };
    },
  },
});
await assert.rejects(
  invalidClient.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' }),
  /invalid source workbench status response/u,
);

const oversized = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials,
  fetchImpl: async () => ({
    status: 200,
    ok: true,
    headers: { get(name) { return name.toLowerCase() === 'content-length' ? '600000' : null; } },
    async text() { throw new Error('oversized response must be rejected before reading'); },
  }),
});
await assert.rejects(
  oversized.get('/api/extension-device/source-workbench/status'),
  /response is too large/u,
);

const timedOut = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials,
  requestTimeoutMs: 5,
  fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }),
});
await assert.rejects(
  timedOut.get('/api/extension-device/source-workbench/status'),
  /request timed out/u,
);

const credentialTimedOut = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    async beginOperation() { return new Promise(() => undefined); },
  },
  requestTimeoutMs: 5,
  fetchImpl: async () => { throw new Error('credential timeout must happen before status fetch'); },
});
await assert.rejects(
  credentialTimedOut.get('/api/extension-device/source-workbench/status'),
  /request timed out/u,
);

current = false;
await assert.rejects(
  client.getStatus({ snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' }),
  /superseded/,
);

const unpaired = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: { async beginOperation() { return { state: 'unpaired', epoch: 1 }; } },
  fetchImpl: async () => { throw new Error('unpaired client must not fetch'); },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(await unpaired.get('/api/extension-device/source-workbench/status'))),
  { state: 'unpaired' },
);

const supersededDuringClear = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
  credentials: {
    async beginOperation() {
      return {
        state: 'paired', baseUrl: 'https://erp.example', scopes: ['listing:review'],
        accessToken: 'old-token',
      };
    },
    async isOperationCurrent() { return true; },
    async clearIfCurrent() { return false; },
  },
  fetchImpl: async () => ({ status: 401, ok: false }),
});
await assert.rejects(
  supersededDuringClear.get('/api/extension-device/source-workbench/status'),
  /superseded/u,
);

class TestNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.hidden = true;
    this.disabled = false;
    this.attributes = {};
    this.listeners = {};
    this.classList = { add: (...names) => names.forEach((name) => { this.className += ` ${name}`; }) };
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  get firstChild() { return this.children[0] || null; }
}
const viewContext = {
  document: { createElement: (tag) => new TestNode(tag) },
  window: {},
};
vm.runInNewContext(viewSource, viewContext, { filename: viewPath });
function renderedText(node) {
  return [node.textContent, ...node.children.map(renderedText)].filter(Boolean).join(' ');
}

const unpairedContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(unpairedContainer, {
  state: 'unpaired',
});
assert.equal(unpairedContainer.hidden, false);
assert.match(renderedText(unpairedContainer), /扩展尚未连接 ERP/u);

const notCollectedContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(notCollectedContainer, {
  state: 'unavailable', reason: 'source_handoff_mismatch',
});
assert.equal(notCollectedContainer.hidden, false);
assert.match(renderedText(notCollectedContainer), /先采集货源到 ERP/u);

const disabledContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(disabledContainer, {
  state: 'disabled', capability: { enabled: false, reason: 'master_off', revision: 'master-off' }, status: null,
});
assert.equal(disabledContainer.hidden, false);
assert.match(renderedText(disabledContainer), /扩展工作台未开放/u);

for (const [scope, label] of [
  ['listing:review', '商品工作台审核'],
  ['media:execute', 'AI 媒体执行'],
]) {
  const scopeContainer = new TestNode('section');
  viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(scopeContainer, {
    state: 'scope_required', scope,
  });
  assert.equal(scopeContainer.hidden, false);
  assert.match(renderedText(scopeContainer), new RegExp(label));
  assert.match(renderedText(scopeContainer), /更新授权/u);
}

const container = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(container, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [
        {
          operation: 'FULL_EDIT', status: 'CANCELLED', reviewStatus: 'NOT_READY',
          actionable: false,
        },
        {
          operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED', reviewStatus: 'PENDING',
          actionable: true,
        },
      ],
    },
  },
});
const rendered = renderedText(container);
assert.equal(container.hidden, false);
assert.match(rendered, /Web ERP 的采集详情中使用 AI 图片工作台/u);
assert.match(rendered, /扩展内处理需先创建店铺草稿/u);
assert.match(rendered, /图片翻译 · 等待审核/u);
assert.doesNotMatch(rendered, /已取消|CANCELLED|PENDING/u);

const createContainer = new TestNode('section');
const createEvents = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(createContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  launch: {
    state: 'ready',
    capability: {
      enabled: true, ready: true, testOnly: true, operation: 'IMAGE_TRANSLATE',
    },
    context: {
      id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7,
      sourceInputs: [{ sourceMediaKey: 'media-1' }],
    },
  },
  sourceInputs: [{ sourceMediaKey: 'media-1', label: '主图 1' }],
  onCreateTranslation(source) { createEvents.push(source); },
});
assert.match(renderedText(createContainer), /图片翻译（测试）/u);
const createButton = createContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '翻译为俄文');
assert.ok(createButton);
createButton.listeners.click({ isTrusted: false });
assert.equal(createEvents.length, 0, 'scripted translation clicks must not launch work');
createButton.listeners.click({ isTrusted: true });
assert.equal(createEvents.length, 1);
assert.equal(createEvents[0].sourceMediaKey, 'media-1');

const darkCreateContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(darkCreateContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  launch: { state: 'disabled', capability: { enabled: false, ready: false } },
  sourceInputs: [{ sourceMediaKey: 'media-1', label: '主图 1' }],
  onCreateTranslation(source) { createEvents.push(source); },
});
assert.doesNotMatch(renderedText(darkCreateContainer), /图片翻译（测试）/u);
assert.match(renderedText(darkCreateContainer), /AI 修图与生图/u);
assert.match(renderedText(darkCreateContainer), /媒体能力当前未开放/u);

const providerBlockedContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(providerBlockedContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  selectedListingWorkflowId: 'listing-1',
  launch: {
    state: 'not_ready', contractVersion: 2, context: null,
    operations: {
      IMAGE_TO_IMAGE: {
        enabled: true, ready: false, reasonCode: 'PROVIDER_NOT_READY',
        reason: 'provider has not completed sandbox verification',
      },
      IMAGE_TRANSLATE: {
        enabled: false, ready: false, reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
        reason: 'translation feature disabled',
      },
      FULL_EDIT: {
        enabled: true, ready: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED',
        reason: 'production provider not allowed',
      },
      INPAINT: {
        enabled: false, ready: false, reasonCode: 'MEDIA_STORAGE_NOT_READY',
        reason: 'storage backend is incompatible',
      },
    },
  },
  sourceInputs: [{ sourceMediaKey: 'media-1', label: '主图 1' }],
});
assert.match(renderedText(providerBlockedContainer), /参考生图：Provider 尚未完成生产验证/u);
assert.match(renderedText(providerBlockedContainer), /全图编辑：Provider 尚未完成生产验证/u);
assert.match(renderedText(providerBlockedContainer), /局部重绘：需要可用的对象存储/u);
assert.doesNotMatch(renderedText(providerBlockedContainer), /sandbox|not allowed|incompatible/u);

const multiListingContainer = new TestNode('section');
const selectedListings = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(multiListingContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: {
      items: [
        { id: 'listing-a', shopId: 'shop-a', revision: 1, draftVersion: 1 },
        { id: 'listing-b', shopId: 'shop-b', revision: 2, draftVersion: 3 },
      ],
    },
    media: { actionableCount: 0, items: [] },
  },
}, {
  launch: { state: 'ready', capability: { enabled: true, ready: true, testOnly: true, operation: 'IMAGE_TRANSLATE' }, context: null },
  sourceInputs: [{ sourceMediaKey: 'media-1', label: '主图 1' }],
  selectedListingWorkflowId: '',
  onSelectListing(id) { selectedListings.push(id); },
  onCreateTranslation() { throw new Error('must not create before selecting listing'); },
});
assert.match(renderedText(multiListingContainer), /请选择店铺草稿/u);
const listingSelect = multiListingContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.tag === 'select' && node.attributes['aria-label'] === '选择店铺草稿');
assert.ok(listingSelect);
listingSelect.value = 'listing-b';
listingSelect.listeners.change({ isTrusted: false });
assert.equal(selectedListings.length, 0);
listingSelect.listeners.change({ isTrusted: true });
assert.deepEqual(selectedListings, ['listing-b']);

const historyContainer = new TestNode('section');
const historyEvents = [];
const historyReviewEvents = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(historyContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  selectedListingWorkflowId: 'listing-1',
  historyOpen: true,
  history: {
    context: { listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7 },
    items: [{
      id: 'history-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED', reviewStatus: 'PENDING',
      revision: 2, selectedOutputAssetId: null, outputs: [{
        id: 'asset-1', url: 'https://cdn.example/output.png', mimeType: 'image/png', width: 900, height: 1200,
      }], application: null, updatedAt: '2026-07-21T00:00:01.000Z',
    }],
    nextCursor: 'next-1',
  },
  onLoadHistory() { historyEvents.push('load'); },
  onLoadMoreHistory() { historyEvents.push('more'); },
  onHistoryOpenChange(open) { historyEvents.push(open ? 'open' : 'close'); },
  onReviewOutput(item, output, decision) { historyReviewEvents.push({ item, output, decision }); },
});
assert.match(renderedText(historyContainer), /图片结果与历史/u);
assert.match(renderedText(historyContainer), /图片翻译.*等待审核/u);
assert.match(renderedText(historyContainer), /900 × 1200/u);
assert.doesNotMatch(renderedText(historyContainer), /追加到草稿/u);
const historyNodes = historyContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; });
const previewImage = historyNodes.find((node) => node.tag === 'img');
assert.ok(previewImage);
assert.equal(previewImage.loading, 'lazy');
assert.equal(previewImage.referrerPolicy, 'no-referrer');
const approveButton = historyNodes.find((node) => node.textContent === '通过');
const rejectButton = historyNodes.find((node) => node.textContent === '驳回');
assert.ok(approveButton);
assert.ok(rejectButton);
approveButton.listeners.click({ isTrusted: false });
assert.equal(historyReviewEvents.length, 0, 'scripted review clicks must not mutate media');
approveButton.listeners.click({ isTrusted: true });
rejectButton.listeners.click({ isTrusted: true });
assert.deepEqual(historyReviewEvents.map((entry) => entry.decision), ['APPROVE', 'REJECT']);
const moreButton = historyContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '加载更多');
assert.ok(moreButton);
moreButton.listeners.click({ isTrusted: false });
assert.deepEqual(historyEvents, []);
moreButton.listeners.click({ isTrusted: true });
assert.deepEqual(historyEvents, ['more']);

const applyContainer = new TestNode('section');
const applyEvents = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(applyContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [{ id: 'listing-1', shopId: 'shop-1', revision: 11, draftVersion: 7 }] },
    media: { actionableCount: 0, items: [] },
  },
}, {
  selectedListingWorkflowId: 'listing-1',
  historyOpen: true,
  history: {
    context: { listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7 },
    items: [
      {
        id: 'approved-selected', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
        reviewStatus: 'APPROVED', revision: 3, selectedOutputAssetId: 'asset-selected',
        outputs: [{
          id: 'asset-selected', url: 'https://cdn.example/selected.png',
          mimeType: 'image/png', width: 900, height: 1200,
        }], application: null, updatedAt: '2026-07-21T00:00:03.000Z',
      },
      {
        id: 'approved-unselected', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
        reviewStatus: 'APPROVED', revision: 3, selectedOutputAssetId: 'different-asset',
        outputs: [{
          id: 'asset-unselected', url: 'https://cdn.example/unselected.png',
          mimeType: 'image/png', width: 900, height: 1200,
        }], application: null, updatedAt: '2026-07-21T00:00:02.000Z',
      },
      {
        id: 'approved-applied', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
        reviewStatus: 'APPROVED', revision: 4, selectedOutputAssetId: 'asset-applied',
        outputs: [{
          id: 'asset-applied', url: 'https://cdn.example/applied.png',
          mimeType: 'image/png', width: 900, height: 1200,
        }], application: {
          id: 'application-1', mode: 'append', state: 'APPLIED', targetId: 'listing-1',
          contextSkuKey: null, contextSlotKey: null,
          appliedAt: '2026-07-21T00:00:02.000Z', rolledBackAt: null,
        }, updatedAt: '2026-07-21T00:00:01.000Z',
      },
    ],
    nextCursor: null,
  },
  onLoadHistory() {},
  onApplyOutput(item, output) { applyEvents.push({ item, output }); },
});
const applyButtons = applyContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .filter((node) => node.textContent === '追加到草稿');
assert.equal(applyButtons.length, 1, 'only the approved selected unapplied output can be appended');
applyButtons[0].listeners.click({ isTrusted: false });
assert.equal(applyEvents.length, 0, 'scripted apply clicks must not mutate a listing');
applyButtons[0].listeners.click({ isTrusted: true });
assert.equal(applyEvents.length, 1);
assert.equal(applyEvents[0].item.id, 'approved-selected');
assert.equal(applyEvents[0].output.id, 'asset-selected');

const approvedContainer = new TestNode('section');
const reviewEvents = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(approvedContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [{
        operation: 'IMAGE_TO_IMAGE', status: 'SUCCEEDED', reviewStatus: 'APPROVED',
        hasSelectedOutput: true, actionable: true,
      }],
    },
  },
}, {
  onReview(task) { reviewEvents.push(task); },
});
assert.match(renderedText(approvedContainer), /参考改图 · 审核通过，等待应用/u);
assert.match(renderedText(approvedContainer), /在 ERP 审核/u);
const reviewButton = approvedContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '在 ERP 审核');
assert.ok(reviewButton);
reviewButton.listeners.click({ isTrusted: false });
assert.equal(reviewEvents.length, 0);
reviewButton.listeners.click({ isTrusted: true });
assert.equal(reviewEvents.length, 1);

const rejectedContainer = new TestNode('section');
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(rejectedContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [{
        operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED', reviewStatus: 'REJECTED',
        hasSelectedOutput: false, actionable: true,
      }],
    },
  },
}, {});
assert.match(renderedText(rejectedContainer), /图片翻译 · 审核已驳回/u);

const failedContainer = new TestNode('section');
const commands = [];
viewContext.window.SS_ERP_SOURCE_LISTING_WORKBENCH.render(failedContainer, {
  state: 'ready',
  status: {
    snapshot: { current: true },
    listing: { items: [] },
    media: {
      actionableCount: 1,
      items: [{
        operation: 'FULL_EDIT', status: 'FAILED', reviewStatus: 'NOT_READY',
        hasSelectedOutput: false, actionable: true, id: 'media-1', revision: 3,
        allowedActions: ['RETRY'],
        commandContext: {
          shopId: 'shop-1', listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
        },
      }],
    },
  },
}, {
  onCommand(task, action) { commands.push({ task, action }); },
});
assert.match(renderedText(failedContainer), /全图编辑 · 处理失败/u);
assert.match(renderedText(failedContainer), /任务操作/u);
assert.match(renderedText(failedContainer), /重试/u);
const retryButton = failedContainer.children
  .flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)]; })
  .find((node) => node.textContent === '重试');
assert.ok(retryButton);
retryButton.listeners.click({ isTrusted: false });
assert.equal(commands.length, 0, 'scripted page clicks must not execute extension commands');
retryButton.listeners.click({ isTrusted: true });
assert.equal(commands.length, 1);
assert.equal(commands[0].action, 'RETRY');

const confirmHtml = fs.readFileSync(confirmHtmlPath, 'utf8');
const confirmLaunchHtml = fs.readFileSync(confirmLaunchPath, 'utf8');
const confirmPageSource = fs.readFileSync(confirmPagePath, 'utf8');
assert.match(confirmHtml, /media-confirm\.css/u);
assert.match(confirmHtml, /media-confirm\.js/u);
assert.match(confirmHtml, /referrerpolicy=["']no-referrer["']/u);
assert.doesNotMatch(confirmHtml, /<script[^>]*>\s*[^<]/iu, 'confirmation page must not use inline scripts');
assert.doesNotMatch(confirmLaunchHtml, /<script/iu, 'confirmation launch page must remain inert');

async function createConfirmPageHarness(expiresAt) {
  const nodes = Object.fromEntries([
    'confirmTitle', 'confirmSubtitle', 'confirmTarget', 'previewSection', 'previewLink', 'previewImage',
    'previewMeta', 'confirmStatus', 'cancelButton', 'confirmButton',
  ].map((id) => [id, new TestNode(id === 'previewImage' ? 'img' : id.endsWith('Button') ? 'button' : 'div')]));
  const messages = [];
  const timers = [];
  let windowClosed = false;
  const context = {
    URLSearchParams,
    Date,
    Error,
    Number,
    Promise,
    String,
    document: {
      getElementById(id) { return nodes[id] || null; },
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          messages.push(JSON.parse(JSON.stringify(message)));
          if (message.type === 'ss-erp:source-listing-workbench-media-confirm-read') {
            callback({
              ok: true,
              confirmation: {
                action: 'APPLY_APPEND', operation: 'IMAGE_TRANSLATE',
                target: {
                  platform: '1688', sourceProductId: 'source-product-123456789',
                  shopId: 'shop-123456789', listingWorkflowId: 'listing-123456789',
                },
                preview: {
                  url: 'https://cdn.example/output.png', mimeType: 'image/png',
                  width: 900, height: 1200,
                },
                expiresAt,
                completed: false,
              },
            });
            return;
          }
          if (message.type === 'ss-erp:source-listing-workbench-media-confirm-submit') {
            callback({ ok: true, result: { state: 'completed', replay: false } });
            return;
          }
          callback({ ok: true, result: { state: 'cancelled' } });
        },
      },
    },
    window: {
      location: { hash: `#nonce=${nonce}` },
      close() { windowClosed = true; },
      setTimeout(callback, delay) {
        const timer = { callback, delay, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { if (timer) timer.cleared = true; },
    },
  };
  vm.runInNewContext(confirmPageSource, context, { filename: confirmPagePath });
  await new Promise((resolve) => setImmediate(resolve));
  return { nodes, messages, timers, windowClosed: () => windowClosed };
}

const confirmHarness = await createConfirmPageHarness(Date.now() + 120000);
const confirmNodes = confirmHarness.nodes;
const confirmMessages = confirmHarness.messages;
assert.deepEqual(confirmMessages, [{
  type: 'ss-erp:source-listing-workbench-media-confirm-read', nonce,
}]);
assert.equal(confirmNodes.previewImage.src, 'https://cdn.example/output.png');
assert.equal(confirmNodes.confirmButton.textContent, '确认追加');
assert.match(confirmNodes.confirmTarget.textContent, /1688 商品 .* · 店铺 .* · 草稿 /u);
assert.equal(confirmNodes.confirmButton.disabled, true, 'confirmation waits for a visible preview');
confirmNodes.confirmButton.listeners.click({ isTrusted: true });
assert.equal(confirmMessages.length, 1, 'unloaded previews cannot be confirmed');
confirmNodes.previewImage.listeners.error();
assert.equal(confirmNodes.confirmButton.disabled, true);
assert.match(confirmNodes.confirmStatus.textContent, /预览加载失败/u);
confirmNodes.previewImage.listeners.load();
assert.equal(confirmNodes.confirmButton.disabled, false);
confirmNodes.confirmButton.listeners.click({ isTrusted: false });
assert.equal(confirmMessages.length, 1, 'scripted extension-page clicks must not submit');
confirmNodes.confirmButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(confirmMessages[1], {
  type: 'ss-erp:source-listing-workbench-media-confirm-submit', nonce,
});
assert.deepEqual(Object.keys(confirmMessages[1]).sort(), ['nonce', 'type']);
assert.equal(confirmNodes.confirmStatus.textContent, '操作已完成，可以关闭此窗口。');
assert.equal(confirmHarness.windowClosed(), false, 'successful confirmation remains visible for user acknowledgement');

const expiredHarness = await createConfirmPageHarness(Date.now() + 120000);
expiredHarness.nodes.previewImage.listeners.load();
assert.equal(expiredHarness.nodes.confirmButton.disabled, false);
expiredHarness.timers[0].callback();
assert.equal(expiredHarness.nodes.confirmButton.disabled, true);
assert.match(expiredHarness.nodes.confirmStatus.textContent, /确认已过期/u);
expiredHarness.nodes.confirmButton.listeners.click({ isTrusted: true });
assert.equal(expiredHarness.messages.length, 1, 'expired confirmation cannot submit');

console.log('PASS extension source listing workbench contract');
