import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sessionPath = 'extensions/ss-erp/shared/erp-adapter/source-workflow-device-session.js';
const listingClientPath = 'extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js';
const adapterPath = 'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-adapter.js';
const clientPath = 'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-client.js';

const context = {
  AbortController, Array, ArrayBuffer, Boolean, Date, Error, JSON, Map, Math, Number,
  Object, Promise, RegExp, Set, String, TextDecoder, TextEncoder, TypeError, URL,
  URLSearchParams, Uint8Array, clearTimeout, crypto: globalThis.crypto, setTimeout,
};
context.globalThis = context;
for (const path of [sessionPath, listingClientPath, adapterPath, clientPath]) {
  vm.runInNewContext(readFileSync(path, 'utf8'), context, { filename: path });
}

const listingContract = context.SS_ERP_LISTING_WORKFLOW_CLIENT;
const adapterApi = context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_ADAPTER;
const api = context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT;
const MODE_LOCK_PATH = '/api/extension-device/source-workbench/hosted-mode-lock';
const PLAN_PATH = '/api/extension-device/source-workbench/plans';
const ASSIGNMENT_PATH =
  '/api/extension-device/source-workbench/ai-image-suite/listing-assignments';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

async function rejectsCode(promise, code, predicate = null) {
  await assert.rejects(promise, (error) => error?.code === code
    && (!predicate || predicate(error)));
}

function binding(overrides = {}) {
  return {
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-workflow-1',
    draftRevision: 11,
    draftVersion: 7,
    ...overrides,
  };
}

function planVersion(id = 'plan-version-1') {
  return {
    id,
    version: 1,
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceSchemaVersion: 'source-capture/v1',
    planSchemaVersion: 'ai-media-plan/v1',
    plannerVersion: 'rule-planner/v1',
    mode: 'RULE_BASED',
    slots: [{
      slotKey: 'hero-primary',
      goal: 'Product hero',
      status: 'PLANNED',
      aspectRatio: '1:1',
      ownership: { level: 'sku', key: 'sku-1' },
      references: [{ candidateId: 'candidate-1' }],
    }],
    createdAt: '2026-07-27T08:00:00.000Z',
  };
}

function planView(overrides = {}) {
  const version = planVersion();
  return {
    id: 'plan-1',
    revision: 1,
    latestVersion: 1,
    currentVersionId: version.id,
    approvedVersionId: null,
    reviewStatus: 'PENDING',
    sourceCurrent: true,
    stale: false,
    currentVersion: version,
    approvedVersion: null,
    reviewedAt: null,
    updatedAt: '2026-07-27T08:00:01.000Z',
    ...overrides,
  };
}

function planResponse(inputBinding, plan = planView(), replayed = false) {
  return {
    state: 'response',
    body: {
      code: 1,
      replayed,
      data: {
        contractVersion: 'extension-hosted-ai-image-plan/v1',
        policyRevision: 3,
        context: plain(inputBinding),
        plan,
      },
    },
  };
}

function modeLockResponse(inputBinding, state = 'NO_SUITE', hostedExecutionEnabled = false) {
  return {
    state: 'response',
    body: {
      code: 1,
      data: {
        contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
        context: plain(inputBinding),
        state,
        hostedExecutionEnabled,
      },
    },
  };
}

function projectionFixture(kind = 'planned', overrides = {}) {
  const sourceBinding = binding();
  const projection = {
    contractVersion: 'extension-ai-image-suite-projection/v1',
    context: sourceBinding,
    commandAuthority: {
      snapshotId: sourceBinding.snapshotId,
      supplyGoodsId: sourceBinding.supplyGoodsId,
      draftRevision: sourceBinding.draftRevision,
      planId: 'plan-1',
      planVersionId: 'plan-version-1',
      planRevision: 3,
      skuKey: 'sku-1',
      authorityHash: 'b'.repeat(64),
    },
    applyPolicy: { target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false },
    plan: {
      id: 'plan-1',
      versionId: 'plan-version-1',
      revision: 3,
      status: 'APPROVED',
      skuKey: 'sku-1',
      preview: {
        hash: 'a'.repeat(64),
        pricingVersion: 'pricing-v1',
        itemCount: 1,
        estimatedCostCents: 9,
        maximumCostCents: 12,
        slots: [{
          ordinal: 0,
          slotKey: 'hero-primary',
          goal: 'Product hero',
          ownership: { level: 'sku', key: 'sku-1' },
          applicableSkuKeys: ['sku-1'],
          estimatedCostCents: 9,
          maximumCostCents: 12,
        }],
      },
      allowedActions: ['START'],
      commands: {
        START: {
          expectedPreviewHash: 'a'.repeat(64),
          acceptedPricingVersion: 'pricing-v1',
          acceptedEstimatedCostCents: 9,
          acceptedMaximumCostCents: 12,
        },
      },
    },
    suite: null,
  };

  if (kind !== 'planned') {
    projection.plan.allowedActions = [];
    projection.plan.commands = {};
    const succeeded = kind === 'review' || kind === 'approved';
    const suiteRevision = overrides.suiteRevision || 8;
    const slotRevision = overrides.slotRevision || (succeeded ? 5 : 3);
    const output = succeeded ? {
      id: 'asset-1',
      url: 'https://erp.example/generated/asset-1.png',
      storageBackend: 'oss',
      mimeType: 'image/png',
      width: 900,
      height: 1200,
    } : null;
    const slot = {
      id: 'slot-1',
      ordinal: 0,
      slotKey: 'hero-primary',
      goal: 'Product hero',
      ownership: { level: 'sku', key: 'sku-1' },
      applicableSkuKeys: ['sku-1'],
      status: succeeded ? 'SUCCEEDED' : 'FAILED',
      attempt: 1,
      revision: slotRevision,
      estimatedCostCents: 9,
      maximumCostCents: 12,
      workflowId: succeeded ? 'child-workflow-1' : null,
      workflowRevision: succeeded ? 4 : null,
      reviewStatus: kind === 'approved' ? 'APPROVED' : kind === 'review' ? 'PENDING' : 'NOT_READY',
      output,
      application: null,
      allowedActions: [],
      commands: {},
    };
    if (kind === 'retry') {
      slot.allowedActions = ['RETRY_SLOT'];
      slot.commands.RETRY_SLOT = {
        suiteId: 'suite-1',
        slotId: slot.id,
        expectedSuiteRevision: suiteRevision,
        expectedSlotRevision: slot.revision,
        acceptedAdditionalMaximumCostCents: 12,
      };
    } else if (kind === 'review') {
      slot.allowedActions = ['REVIEW_SLOT'];
      slot.commands.REVIEW_SLOT = {
        suiteId: 'suite-1',
        slotId: slot.id,
        workflowId: slot.workflowId,
        outputAssetId: output.id,
        expectedSuiteRevision: suiteRevision,
        expectedSlotRevision: slot.revision,
        expectedWorkflowRevision: slot.workflowRevision,
        decisions: ['APPROVE', 'REJECT'],
      };
    } else if (kind === 'approved') {
      slot.allowedActions = ['APPLY_SLOT'];
      slot.commands.APPLY_SLOT = {
        suiteId: 'suite-1',
        slotId: slot.id,
        workflowId: slot.workflowId,
        outputAssetId: output.id,
        expectedSuiteRevision: suiteRevision,
        expectedSlotRevision: slot.revision,
        expectedWorkflowRevision: slot.workflowRevision,
        mode: 'append',
        target: 'ERP_SOURCE_PRODUCT',
        writesStoreDraft: false,
        expectedTargetUpdatedAt: '2026-07-27T08:00:02.000Z',
      };
    }
    projection.suite = {
      id: 'suite-1',
      status: succeeded ? 'SUCCEEDED' : 'FAILED',
      revision: suiteRevision,
      previewHash: projection.plan.preview.hash,
      pricingVersion: projection.plan.preview.pricingVersion,
      itemCount: 1,
      estimatedCostCents: 9,
      maximumCostCents: 12,
      allowedActions: [],
      commands: {},
      slots: [slot],
    };
  }
  return projection;
}

function approvedBatchProjection() {
  const projection = projectionFixture('approved');
  projection.plan.preview.itemCount = 2;
  projection.plan.preview.estimatedCostCents = 14;
  projection.plan.preview.maximumCostCents = 18;
  projection.plan.preview.slots.push({
    ordinal: 1,
    slotKey: 'group:group-1:gallery:1',
    goal: 'Shared product detail',
    ownership: { level: 'compatibility_group', key: 'group-1' },
    applicableSkuKeys: ['sku-1'],
    estimatedCostCents: 5,
    maximumCostCents: 6,
  });
  projection.suite.itemCount = 2;
  projection.suite.estimatedCostCents = 14;
  projection.suite.maximumCostCents = 18;
  projection.suite.slots.push({
    id: 'slot-2',
    ordinal: 1,
    slotKey: 'group:group-1:gallery:1',
    goal: 'Shared product detail',
    ownership: { level: 'compatibility_group', key: 'group-1' },
    applicableSkuKeys: ['sku-1'],
    status: 'SUCCEEDED',
    attempt: 1,
    revision: 6,
    estimatedCostCents: 5,
    maximumCostCents: 6,
    workflowId: 'child-workflow-2',
    workflowRevision: 3,
    reviewStatus: 'APPROVED',
    output: {
      id: 'asset-2',
      url: 'https://erp.example/generated/asset-2.png',
      storageBackend: 'oss',
      mimeType: 'image/png',
      width: 1200,
      height: 1200,
    },
    application: null,
    allowedActions: ['APPLY_SLOT'],
    commands: {
      APPLY_SLOT: {
        suiteId: 'suite-1',
        slotId: 'slot-2',
        workflowId: 'child-workflow-2',
        outputAssetId: 'asset-2',
        expectedSuiteRevision: 8,
        expectedSlotRevision: 6,
        expectedWorkflowRevision: 3,
        mode: 'append',
        target: 'ERP_SOURCE_PRODUCT',
        writesStoreDraft: false,
        expectedTargetUpdatedAt: '2026-07-27T08:00:02.000Z',
      },
    },
  });
  return projection;
}

function previewTicket(overrides = {}) {
  return {
    contractVersion: 'extension-hosted-ai-image-suite-candidate-preview-channel/v1',
    channelName: 'ss-erp:hosted-candidate-preview:' + 'c'.repeat(48),
    previewTicket: 'hp_' + 'd'.repeat(48),
    expiresAt: '2026-07-27T08:00:30.000Z',
    metadata: { mimeType: 'image/png', byteLength: null },
    ...overrides,
  };
}

function harness(options = {}) {
  let currentProjection = options.projection || projectionFixture();
  let failNextSuite = false;
  let currentPreviewTicket = previewTicket();
  let assignmentResponseExtra = null;
  const calls = { get: [], post: [], getSuite: [], execute: [], preview: [], revoke: [] };
  const transport = {
    async get(path, requestOptions) {
      calls.get.push({ path, options: plain(requestOptions) });
      if (path.startsWith(MODE_LOCK_PATH + '?')) {
        return options.modeLock || modeLockResponse(binding());
      }
      if (path.startsWith(PLAN_PATH + '/current?')) {
        return planResponse(binding());
      }
      if (path.startsWith(PLAN_PATH + '/plan-1?')) {
        return planResponse(binding());
      }
      throw new Error('unexpected GET path');
    },
    async post(path, body, requestOptions) {
      calls.post.push({ path, body: plain(body), options: plain(requestOptions) });
      if (path === PLAN_PATH) return planResponse(body.context, planView(), true);
      if (path === PLAN_PATH + '/plan-1/review') {
        const version = planVersion();
        return planResponse(body.context, planView({
          revision: 2,
          approvedVersionId: version.id,
          reviewStatus: 'APPROVED',
          approvedVersion: version,
          reviewedAt: '2026-07-27T08:00:03.000Z',
          updatedAt: '2026-07-27T08:00:03.000Z',
        }));
      }
      if (path === ASSIGNMENT_PATH) {
        return {
          state: 'response',
          body: {
            code: 1,
            data: {
              contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
              batchId: 'assignment-batch-1',
              replayed: false,
              shopId: body.shopId,
              listingWorkflowId: body.listingWorkflowId,
              sourceDraftRevision: body.expectedDraftRevision,
              sourceDraftVersion: body.expectedDraftVersion,
              boundDraftRevision: body.expectedDraftRevision + 1,
              boundDraftVersion: body.expectedDraftVersion + 1,
              assignments: body.items.map((item, index) => ({
                assignmentId: `assignment-${index + 1}`,
                skuKey: item.skuKey,
                slotKey: item.slotKey,
                assignmentScope: item.slotKey.startsWith('group:') ? 'PRODUCT' : 'SKU',
                assignmentOrdinal: body.assignmentStartOrdinal + index,
                assetId: item.outputAssetId,
              })),
              validationStatus: 'STALE',
              publishReadiness: 'STALE',
              ...(assignmentResponseExtra || {}),
            },
          },
        };
      }
      throw new Error('unexpected POST path');
    },
  };
  const listingClient = {
    async getAiImageSuite(input) {
      calls.getSuite.push(plain(input));
      if (failNextSuite) {
        failNextSuite = false;
        throw new Error('suite unavailable');
      }
      return { state: 'ready', projection: currentProjection };
    },
    async executeAiImageSuiteCommand(input) {
      calls.execute.push(input);
      return { state: 'completed', replay: false, action: input.action };
    },
  };
  const previewBridge = {
    async open(input) {
      calls.preview.push(plain(input));
      return currentPreviewTicket;
    },
    revoke(input) {
      calls.revoke.push(plain(input));
      return 1;
    },
  };
  const adapter = options.adapterFactory
    ? options.adapterFactory()
    : adapterApi.createAdapter({ intentContract: listingContract });
  return {
    client: api.createClient({ transport, listingClient, adapter, previewBridge }),
    calls,
    setProjection(value) { currentProjection = value; },
    failSuiteOnce() { failNextSuite = true; },
    setPreviewTicket(value) { currentPreviewTicket = value; },
    setAssignmentResponseExtra(value) { assignmentResponseExtra = value; },
  };
}

function fetchJson(payload, status = 200) {
  const serialized = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    async text() { return serialized; },
  };
}

function actualMutationChain(options) {
  const requestLog = [];
  let credentialCallCount = 0;
  const transport = context.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
    requestTimeoutMs: 5,
    credentials: {
      async beginOperation() {
        credentialCallCount += 1;
        if (credentialCallCount === options.failCredentialOnCall) {
          throw new Error('credential lookup failed before fetch');
        }
        return {
          state: 'paired', epoch: credentialCallCount, baseUrl: 'https://erp.example',
          accessToken: 'device-token',
          scopes: ['listing:review', 'listing:write', 'media:execute'],
        };
      },
      async isOperationCurrent() { return true; },
      async clearIfCurrent() { return true; },
    },
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      requestLog.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'GET'
        && path === '/api/extension-device/source-workbench/ai-image-suite') {
        return fetchJson({ code: 1, data: options.projection });
      }
      if (path === '/api/extension-device/command-grants') {
        if (options.failAt === 'grant') throw new Error('grant response lost');
        return fetchJson({ code: 1, data: { grantToken: 'q'.repeat(43) } }, 201);
      }
      if (path === '/api/extension-device/media-workflows/execute'
        && options.failAt === 'execute') {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('execute aborted')), {
            once: true,
          });
        });
      }
      if (path === '/api/extension-device/media-workflows/execute'
        && options.failAt === 'execute-502') {
        return fetchJson({ errorCode: 'bad_gateway' }, 502);
      }
      if (path === '/api/extension-device/media-workflows/execute'
        && options.failAt === 'execute-malformed-success') {
        return fetchJson({ code: 1, data: { replay: false } }, 202);
      }
      if (path === '/api/extension-device/media-workflows/execute'
        && options.failAt === 'execute-malformed-failed-receipt') {
        return fetchJson({
          code: 1,
          data: {
            replay: false,
            receipt: {
              status: 'FAILED',
              result: null,
              failureCode: 'AI_IMAGE_SUITE_COMMAND_FAILED',
            },
          },
        }, 200);
      }
      if (path === '/api/extension-device/media-workflows/execute'
        && ['execute-failed-lowercase', 'execute-failed-control', 'execute-failed-oversize']
          .includes(options.failAt)) {
        const failureCode = options.failAt === 'execute-failed-lowercase'
          ? 'command_failed'
          : options.failAt === 'execute-failed-control'
            ? 'COMMAND_\u0000FAILED'
            : 'A'.repeat(101);
        return fetchJson({
          code: 1,
          data: {
            replay: false,
            receipt: {
              id: 'receipt-1',
              status: 'FAILED',
              result: null,
              failureCode,
            },
          },
        }, 200);
      }
      if (path === '/api/extension-device/media-workflows/execute'
        && options.failAt === 'execute-code-zero') {
        return fetchJson({ code: 0, errorCode: 'command_rejected' }, 409);
      }
      if (path === '/api/extension-device/media-workflows/execute' && options.succeedExecution) {
        return fetchJson({ code: 1, data: {
          replay: false,
          receipt: { id: 'receipt-1', status: 'SUCCEEDED', result: {
            action: 'START', suiteId: 'suite-1', status: 'QUEUED', revision: 1, replayed: false,
          } },
        } });
      }
      if (path === ASSIGNMENT_PATH && options.failAt === 'assignment') {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('assignment aborted')), {
            once: true,
          });
        });
      }
      if (path === ASSIGNMENT_PATH && options.failAt === 'assignment-502') {
        return fetchJson({ errorCode: 'bad_gateway' }, 502);
      }
      if (path === ASSIGNMENT_PATH && options.failAt === 'assignment-malformed-success') {
        return fetchJson({ code: 1, data: {} }, 200);
      }
      if (path === ASSIGNMENT_PATH && options.failAt === 'assignment-code-zero') {
        return fetchJson({ code: 0, errorCode: 'assignment_rejected' }, 409);
      }
      throw new Error('unexpected actual-chain request: ' + init.method + ' ' + path);
    },
  });
  const listingClient = listingContract.createClient({ transport });
  const adapter = adapterApi.createAdapter({ intentContract: listingContract });
  const previewBridge = {
    async open() { throw new Error('actual mutation chain must not open a preview'); },
    revoke() { return 0; },
  };
  return {
    requestLog,
    client: api.createClient({ transport, listingClient, adapter, previewBridge }),
  };
}

const clientSource = readFileSync(clientPath, 'utf8');
assert.doesNotMatch(
  clientSource,
  /(?:extension-byok|generated-asset-ingest|\/byok(?:\/|\b)|SS_ERP_BYOK)/iu,
  'hosted client must not contain BYOK ingest paths or symbols',
);

const test = harness();
{
  const raw = projectionFixture();
  const version = `ai-image-suite-price-cny/v1:${'c'.repeat(32)}`;
  Object.assign(raw.plan.preview, { pricingVersion: version, currency: 'CNY' });
  raw.plan.commands.START.acceptedPricingVersion = version;
  const cny = actualMutationChain({ projection: raw, succeedExecution: true });
  const loaded = await cny.client.loadSuite(binding());
  assert.equal(loaded.quote.currency, 'CNY');
  await rejectsCode(cny.client.executeIntent(loaded.plan.startIntent, {
    confirmed: true, maximumCostCents: 12, currency: 'USD',
  }), 'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED');
  const started = await cny.client.executeIntent(loaded.plan.startIntent, {
    confirmed: true, maximumCostCents: 12,
  });
  assert.equal(started.action, 'START');
  const serializedWrites = JSON.stringify(cny.requestLog.filter(row => row.method === 'POST'));
  assert.equal(serializedWrites.includes('"currency"'), false, 'START must keep the server-frozen price command shape');
  assert.equal(serializedWrites.includes(version), true);
}
for (const [pricingVersion, currency] of [
  ['pricing-v1', 'CNY'], ['pricing-v1', 'EUR'],
  [`ai-image-suite-price-cny/v1:${'c'.repeat(32)}`, 'USD'],
  [`ai-image-suite-price-cny/v1:${'c'.repeat(32)}`, 'CNY'],
]) {
  const tampered = harness({
    adapterFactory() {
      const base = adapterApi.createAdapter({ intentContract: listingContract });
      return { project(raw) {
        const projected = plain(base.project(raw));
        Object.assign(projected.quote, { pricingVersion, currency });
        return deepFreeze(projected);
      } };
    },
  });
  await rejectsCode(tampered.client.loadSuite(binding()), 'SS_ERP_HOSTED_WORKBENCH_SUITE_RESPONSE_INVALID');
}
const sourceBinding = binding();
const modeLock = await test.client.getModeLock(sourceBinding);
assert.deepEqual(plain(modeLock), {
  contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
  context: sourceBinding,
  state: 'NO_SUITE',
  hostedExecutionEnabled: false,
});
assert.equal(Object.isFrozen(modeLock), true);

for (const malformedModeLock of [
  modeLockResponse(binding(), 'UNKNOWN'),
  modeLockResponse(binding({ draftVersion: 8 })),
  {
    ...modeLockResponse(binding()),
    body: {
      ...modeLockResponse(binding()).body,
      data: { ...modeLockResponse(binding()).body.data, unexpected: true },
    },
  },
]) {
  const malformed = harness({ modeLock: malformedModeLock });
  await rejectsCode(
    malformed.client.getModeLock(sourceBinding),
    'SS_ERP_HOSTED_WORKBENCH_MODE_LOCK_RESPONSE_INVALID',
  );
}
const created = await test.client.createPlan({
  binding: sourceBinding,
  idempotencyKey: 'plan-create-0001',
});
{
  const selected = harness();
  const galleryGoals = ['scene'];
  await selected.client.createPlan({ binding: binding(), idempotencyKey: 'gallery-plan-1', galleryGoals });
  assert.deepEqual(selected.calls.post[0].body.galleryGoals, ['scene']);
  galleryGoals.push('detail');
  assert.deepEqual(selected.calls.post[0].body.galleryGoals, ['scene']);
  for (const invalid of [null, [], ['scene', 'scene'], ['hero'], ['SCENE'], 'scene', ['scene', 1]]) {
    await assert.rejects(selected.client.createPlan({
      binding: binding(), idempotencyKey: 'gallery-plan-1', galleryGoals: invalid,
    }), { code: 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID' });
  }
  assert.equal(selected.calls.post.length, 1);
}
assert.equal(created.contractVersion, api.CONTRACT_VERSION);
assert.equal(created.replayed, true);
assert.equal(created.plan.id, 'plan-1');
assert.equal(Object.isFrozen(created), true);

await test.client.getCurrentPlan(sourceBinding);
await test.client.getPlan({ binding: sourceBinding, planId: 'plan-1' });
const reviewed = await test.client.reviewPlan({
  binding: sourceBinding,
  planId: 'plan-1',
  expectedRevision: 1,
  operationKey: 'plan-review-0001',
  decision: 'APPROVE',
  note: null,
});
assert.equal(reviewed.plan.reviewStatus, 'APPROVED');
assert.equal(reviewed.plan.revision, 2);

assert.deepEqual(test.calls.post.slice(0, 2), [{
  path: PLAN_PATH,
  body: {
    contractVersion: 'extension-hosted-ai-image-plan-create/v1',
    context: sourceBinding,
    idempotencyKey: 'plan-create-0001',
  },
  options: { requiredScope: 'media:execute' },
}, {
  path: PLAN_PATH + '/plan-1/review',
  body: {
    contractVersion: 'extension-hosted-ai-image-plan-review/v1',
    context: sourceBinding,
    expectedRevision: 1,
    operationKey: 'plan-review-0001',
    decision: 'APPROVE',
    note: null,
  },
  options: { requiredScope: 'listing:review' },
}]);
const query = new URLSearchParams({
  snapshotId: sourceBinding.snapshotId,
  supplyGoodsId: sourceBinding.supplyGoodsId,
  shopId: sourceBinding.shopId,
  listingWorkflowId: sourceBinding.listingWorkflowId,
  draftRevision: String(sourceBinding.draftRevision),
  draftVersion: String(sourceBinding.draftVersion),
}).toString();
assert.deepEqual(test.calls.get, [{
  path: MODE_LOCK_PATH + '?' + query,
  options: { requiredScope: 'listing:review' },
}, {
  path: PLAN_PATH + '/current?' + query,
  options: { requiredScope: 'listing:review' },
}, {
  path: PLAN_PATH + '/plan-1?' + query,
  options: { requiredScope: 'listing:review' },
}]);

const planCallCount = test.calls.post.length + test.calls.get.length;
await rejectsCode(
  test.client.getCurrentPlan(binding({ shopId: 'shop-other' })),
  'SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE',
);
assert.equal(test.calls.post.length + test.calls.get.length, planCallCount);

const planned = await test.client.loadSuite(sourceBinding);
const startIntent = planned.plan.startIntent;
await rejectsCode(
  test.client.executeIntent(startIntent),
  'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED',
);
await rejectsCode(
  test.client.executeIntent(startIntent, { confirmed: true, maximumCostCents: 11 }),
  'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED',
);
const started = await test.client.executeIntent(startIntent, {
  confirmed: true,
  maximumCostCents: 12,
});
assert.deepEqual(plain(started), {
  contractVersion: api.CONTRACT_VERSION,
  state: 'completed',
  replayed: false,
  action: 'START',
});
assert.equal(test.calls.execute[0].action, 'START');
assert.equal(test.calls.execute[0].costConfirmed, true);
await rejectsCode(
  test.client.executeIntent(startIntent, { confirmed: true, maximumCostCents: 12 }),
  'SS_ERP_HOSTED_WORKBENCH_INTENT_STALE',
);

test.setProjection(projectionFixture('retry'));
const retryProjection = await test.client.loadSuite(sourceBinding);
const staleRetry = retryProjection.suite.slots[0].retryIntent;
await rejectsCode(
  test.client.executeIntent(staleRetry, { confirmed: false, maximumCostCents: 12 }),
  'SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED',
);
test.setProjection(projectionFixture('retry', { suiteRevision: 9, slotRevision: 4 }));
const refreshedRetry = await test.client.loadSuite(sourceBinding);
await rejectsCode(
  test.client.executeIntent(staleRetry, { confirmed: true, maximumCostCents: 12 }),
  'SS_ERP_HOSTED_WORKBENCH_INTENT_STALE',
);
await test.client.executeIntent(refreshedRetry.suite.slots[0].retryIntent, {
  confirmed: true,
  maximumCostCents: 12,
});
assert.equal(test.calls.execute.at(-1).action, 'RETRY_SLOT');

test.setProjection(projectionFixture('review'));
const beforeFailedRefresh = await test.client.loadSuite(sourceBinding);
test.failSuiteOnce();
await rejectsCode(
  test.client.loadSuite(sourceBinding),
  'SS_ERP_HOSTED_WORKBENCH_SUITE_RESPONSE_INVALID',
);
await rejectsCode(
  test.client.executeIntent(beforeFailedRefresh.suite.slots[0].reviewIntents.APPROVE),
  'SS_ERP_HOSTED_WORKBENCH_INTENT_STALE',
);

const reviewProjection = await test.client.loadSuite(sourceBinding);
await rejectsCode(
  test.client.executeIntent(
    reviewProjection.suite.slots[0].reviewIntents.APPROVE,
    { confirmed: true, maximumCostCents: 0 },
  ),
  'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
);
await test.client.executeIntent(reviewProjection.suite.slots[0].reviewIntents.APPROVE);
assert.equal(test.calls.execute.at(-1).action, 'REVIEW_SLOT');
assert.equal(test.calls.execute.at(-1).decision, 'APPROVE');

test.setProjection(approvedBatchProjection());
const approved = await test.client.loadSuite(sourceBinding);
const applyIntent = approved.suite.slots[0].applyIntent;
const sharedApplyIntent = approved.suite.slots[1].applyIntent;
test.setPreviewTicket(previewTicket({ erpToken: 'must-not-escape' }));
await rejectsCode(
  test.client.openPreview('slot-1'),
  'SS_ERP_HOSTED_WORKBENCH_PREVIEW_INVALID',
);
assert.equal(test.calls.revoke.length, 1, 'an invalid opened preview must be revoked');

test.setPreviewTicket(previewTicket());
const ticket = await test.client.openPreview('slot-1');
assert.deepEqual(Object.keys(test.calls.preview.at(-1)).sort(), [
  'draftRevision', 'draftVersion', 'listingWorkflowId', 'outputAssetId',
  'planId', 'planRevision', 'planVersionId', 'shopId', 'slotId', 'slotRevision',
  'snapshotId', 'suiteId', 'suiteRevision', 'supplyGoodsId', 'workflowId',
  'workflowRevision',
].sort());
assert.deepEqual(test.calls.preview.at(-1), {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-workflow-1',
  draftRevision: 11,
  draftVersion: 7,
  planId: 'plan-1',
  planVersionId: 'plan-version-1',
  planRevision: 3,
  suiteId: 'suite-1',
  suiteRevision: 8,
  slotId: 'slot-1',
  slotRevision: 5,
  workflowId: 'child-workflow-1',
  workflowRevision: 4,
  outputAssetId: 'asset-1',
});
const serializedTicket = JSON.stringify(ticket).toLowerCase();
for (const forbidden of [
  'asset-1', 'shop-1', 'child-workflow-1', 'https://', 'token', 'provider',
  'model', 'prompt', 'storage', 'job', 'billing',
]) {
  assert.equal(serializedTicket.includes(forbidden), false, forbidden);
}

await rejectsCode(
  test.client.executeIntent(applyIntent),
  'SS_ERP_HOSTED_WORKBENCH_INTENT_STALE',
);
await rejectsCode(
  test.client.assignApprovedOutputs({
    intents: [applyIntent, sharedApplyIntent],
    assignmentStartOrdinal: 2,
    idempotencyKey: 'assignment-key-0001',
    shopId: 'caller-must-not-supply-identity',
  }),
  'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
);
await rejectsCode(
  test.client.assignApprovedOutputs({
    intents: [applyIntent],
    assignmentStartOrdinal: 2,
    idempotencyKey: 'assignment-key-0001',
  }),
  'SS_ERP_HOSTED_WORKBENCH_INTENT_STALE',
);
await rejectsCode(
  test.client.assignApprovedOutputs({
    intents: [applyIntent, applyIntent],
    assignmentStartOrdinal: 2,
    idempotencyKey: 'assignment-key-0001',
  }),
  'SS_ERP_HOSTED_WORKBENCH_INTENT_STALE',
);
const assignment = await test.client.assignApprovedOutputs({
  intents: [sharedApplyIntent, applyIntent],
  assignmentStartOrdinal: 2,
  idempotencyKey: 'assignment-key-0001',
});
assert.equal(assignment.batchId, 'assignment-batch-1');
assert.equal(assignment.assignments.length, 2);
const assignmentCall = test.calls.post.at(-1);
assert.equal(assignmentCall.path, ASSIGNMENT_PATH);
assert.deepEqual(assignmentCall.options, { requiredScope: 'listing:write' });
assert.deepEqual(assignmentCall.body, {
  contractVersion: 'extension-hosted-ai-image-listing-assignment/v2',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-workflow-1',
  expectedDraftRevision: 11,
  expectedDraftVersion: 7,
  sourceCaptureSnapshotId: 'snapshot-1',
  assignmentStartOrdinal: 2,
  planId: 'plan-1',
  planVersionId: 'plan-version-1',
  expectedPlanRevision: 3,
  suiteId: 'suite-1',
  expectedSuiteRevision: 8,
  idempotencyKey: 'assignment-key-0001',
  items: [
    {
      skuKey: 'sku-1',
      slotKey: 'hero-primary',
      suiteSlotId: 'slot-1',
      expectedSuiteSlotRevision: 5,
      childWorkflowId: 'child-workflow-1',
      expectedChildWorkflowRevision: 4,
      outputAssetId: 'asset-1',
    },
    {
      skuKey: 'sku-1',
      slotKey: 'group:group-1:gallery:1',
      suiteSlotId: 'slot-2',
      expectedSuiteSlotRevision: 6,
      childWorkflowId: 'child-workflow-2',
      expectedChildWorkflowRevision: 3,
      outputAssetId: 'asset-2',
    },
  ],
});
const serializedAssignment = JSON.stringify(assignmentCall.body).toLowerCase();
for (const forbidden of [
  'https://', 'provider', 'model', 'prompt', 'apikey', 'authorization',
  'storagebackend', 'jobid', 'reservationid', 'settlementid', 'billingid',
  'owneruserid', 'devicesessionid',
]) {
  assert.equal(serializedAssignment.includes(forbidden), false, forbidden);
}
assert.equal(test.calls.revoke.length, 2, 'successful assignment revokes live previews');

{
  const responseLeak = harness({ projection: projectionFixture('approved') });
  const loaded = await responseLeak.client.loadSuite(sourceBinding);
  responseLeak.setAssignmentResponseExtra({ jobId: 'job-secret' });
  await rejectsCode(
    responseLeak.client.assignApprovedOutputs({
      intents: [loaded.suite.slots[0].applyIntent],
      assignmentStartOrdinal: 0,
      idempotencyKey: 'assignment-key-0002',
    }),
    'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
    (error) => error.outcome === 'UNKNOWN_OUTCOME',
  );
}

for (const leak of [
  ['previewUrl', 'https://provider.example/private.png'],
  ['providerId', 'provider-secret'],
  ['model', 'model-secret'],
  ['prompt', 'prompt-secret'],
  ['apiKey', 'sk-secret'],
  ['storageBackend', 'private-storage'],
  ['jobId', 'job-secret'],
  ['billingId', 'billing-secret'],
]) {
  const leaking = harness({
    projection: projectionFixture(),
    adapterFactory() {
      const base = adapterApi.createAdapter({ intentContract: listingContract });
      return {
        project(raw) {
          const projected = plain(base.project(raw));
          projected.plan.startIntent.commandTemplate[leak[0]] = leak[1];
          return deepFreeze(projected);
        },
      };
    },
  });
  await rejectsCode(
    leaking.client.loadSuite(sourceBinding),
    'SS_ERP_HOSTED_WORKBENCH_SUITE_RESPONSE_INVALID',
  );
}

{
  const grantFailure = actualMutationChain({
    projection: projectionFixture(),
    failAt: 'grant',
  });
  const loaded = await grantFailure.client.loadSuite(sourceBinding);
  await rejectsCode(
    grantFailure.client.executeIntent(loaded.plan.startIntent, {
      confirmed: true,
      maximumCostCents: 12,
    }),
    'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
    (error) => error.outcome !== 'UNKNOWN_OUTCOME',
  );
  assert.equal(grantFailure.requestLog.some((entry) => (
    entry.path === '/api/extension-device/media-workflows/execute'
  )), false, 'a lost command-grant response cannot imply that execution was submitted');
}

{
  const executeLoss = actualMutationChain({
    projection: projectionFixture(),
    failAt: 'execute',
  });
  const loaded = await executeLoss.client.loadSuite(sourceBinding);
  await rejectsCode(
    executeLoss.client.executeIntent(loaded.plan.startIntent, {
      confirmed: true,
      maximumCostCents: 12,
    }),
    'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
    (error) => error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
  assert.equal(executeLoss.requestLog.filter((entry) => (
    entry.path === '/api/extension-device/media-workflows/execute'
  )).length, 1);
}

for (const failAt of [
  'execute-502',
  'execute-malformed-success',
  'execute-malformed-failed-receipt',
  'execute-failed-lowercase',
  'execute-failed-control',
  'execute-failed-oversize',
]) {
  const ambiguousExecution = actualMutationChain({
    projection: projectionFixture(),
    failAt,
  });
  const loaded = await ambiguousExecution.client.loadSuite(sourceBinding);
  await rejectsCode(
    ambiguousExecution.client.executeIntent(loaded.plan.startIntent, {
      confirmed: true,
      maximumCostCents: 12,
    }),
    'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
    (error) => error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
}

{
  const rejectedExecution = actualMutationChain({
    projection: projectionFixture(),
    failAt: 'execute-code-zero',
  });
  const loaded = await rejectedExecution.client.loadSuite(sourceBinding);
  await rejectsCode(
    rejectedExecution.client.executeIntent(loaded.plan.startIntent, {
      confirmed: true,
      maximumCostCents: 12,
    }),
    'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
    (error) => error.outcome !== 'UNKNOWN_OUTCOME',
  );
}

{
  const assignmentLoss = actualMutationChain({
    projection: approvedBatchProjection(),
    failAt: 'assignment',
  });
  const loaded = await assignmentLoss.client.loadSuite(sourceBinding);
  await rejectsCode(
    assignmentLoss.client.assignApprovedOutputs({
      intents: loaded.suite.slots.map((slot) => slot.applyIntent),
      assignmentStartOrdinal: 2,
      idempotencyKey: 'assignment-key-response-loss',
    }),
    'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
    (error) => error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
}

for (const failAt of ['assignment-502', 'assignment-malformed-success']) {
  const ambiguousAssignment = actualMutationChain({
    projection: approvedBatchProjection(),
    failAt,
  });
  const loaded = await ambiguousAssignment.client.loadSuite(sourceBinding);
  await rejectsCode(
    ambiguousAssignment.client.assignApprovedOutputs({
      intents: loaded.suite.slots.map((slot) => slot.applyIntent),
      assignmentStartOrdinal: 2,
      idempotencyKey: 'assignment-key-' + failAt,
    }),
    'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
    (error) => error.outcome === 'UNKNOWN_OUTCOME'
      && error.automaticRetryAllowed === false,
  );
}

{
  const rejectedAssignment = actualMutationChain({
    projection: approvedBatchProjection(),
    failAt: 'assignment-code-zero',
  });
  const loaded = await rejectedAssignment.client.loadSuite(sourceBinding);
  await rejectsCode(
    rejectedAssignment.client.assignApprovedOutputs({
      intents: loaded.suite.slots.map((slot) => slot.applyIntent),
      assignmentStartOrdinal: 2,
      idempotencyKey: 'assignment-key-code-zero',
    }),
    'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_RESPONSE_INVALID',
    (error) => error.outcome !== 'UNKNOWN_OUTCOME',
  );
}

{
  const assignmentPreSubmit = actualMutationChain({
    projection: approvedBatchProjection(),
    failCredentialOnCall: 2,
  });
  const loaded = await assignmentPreSubmit.client.loadSuite(sourceBinding);
  await rejectsCode(
    assignmentPreSubmit.client.assignApprovedOutputs({
      intents: loaded.suite.slots.map((slot) => slot.applyIntent),
      assignmentStartOrdinal: 2,
      idempotencyKey: 'assignment-key-pre-submit',
    }),
    'SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED',
    (error) => error.outcome !== 'UNKNOWN_OUTCOME',
  );
  assert.equal(assignmentPreSubmit.requestLog.filter((entry) => (
    entry.path === ASSIGNMENT_PATH
  )).length, 0);
}

console.log('extension hosted AI image suite workbench client tests passed');
