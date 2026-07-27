import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const listingClientPath = 'extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js';
const adapterPath = 'extensions/ss-erp/shared/hosted/ai-image-suite-workbench-adapter.js';

for (const path of [listingClientPath, adapterPath]) {
  assert.equal(fs.existsSync(path), true, `${path} must exist`);
}

const context = {
  Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise, RegExp,
  Set, String, TextEncoder, TypeError, URL, URLSearchParams,
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(listingClientPath, 'utf8'), context, {
  filename: listingClientPath,
});
vm.runInNewContext(fs.readFileSync(adapterPath, 'utf8'), context, { filename: adapterPath });

const listingContract = context.SS_ERP_LISTING_WORKFLOW_CLIENT;
const api = context.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_ADAPTER;
const adapter = api.createAdapter({ intentContract: listingContract });

function projectionFixture() {
  return {
    contractVersion: 'extension-ai-image-suite-projection/v1',
    context: {
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
      listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
    },
    commandAuthority: {
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', draftRevision: 11,
      planId: 'plan-1', planVersionId: 'plan-version-1', planRevision: 3,
      skuKey: null, authorityHash: 'b'.repeat(64),
    },
    applyPolicy: { target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false },
    plan: {
      id: 'plan-1', versionId: 'plan-version-1', revision: 3, status: 'APPROVED', skuKey: null,
      preview: {
        hash: 'a'.repeat(64), pricingVersion: 'pricing-v1', itemCount: 2,
        estimatedCostCents: 18, maximumCostCents: 24,
        slots: [{
          ordinal: 0, slotKey: 'sku:sku-1:hero', goal: '商品主图',
          ownership: { level: 'sku', key: 'sku-1' },
          estimatedCostCents: 9, maximumCostCents: 12,
        }, {
          ordinal: 1, slotKey: 'sku:sku-1:detail-1', goal: '商品细节图',
          ownership: { level: 'sku', key: 'sku-1' },
          estimatedCostCents: 9, maximumCostCents: 12,
        }],
      },
      allowedActions: ['START'],
      commands: {
        START: {
          expectedPreviewHash: 'a'.repeat(64), acceptedPricingVersion: 'pricing-v1',
          acceptedEstimatedCostCents: 18, acceptedMaximumCostCents: 24,
        },
      },
    },
    suite: null,
  };
}

function currentSuiteFixture() {
  const projection = projectionFixture();
  projection.plan.allowedActions = [];
  projection.plan.commands = {};
  projection.suite = {
    id: 'suite-1', status: 'PARTIAL_FAILURE', revision: 8,
    previewHash: 'a'.repeat(64), pricingVersion: 'pricing-v1', itemCount: 2,
    estimatedCostCents: 18, maximumCostCents: 24,
    allowedActions: ['CONTINUE', 'CANCEL'],
    commands: {
      CONTINUE: { suiteId: 'suite-1', expectedSuiteRevision: 8 },
      CANCEL: { suiteId: 'suite-1', expectedSuiteRevision: 8 },
    },
    slots: [{
      id: 'slot-review', ordinal: 0, slotKey: 'sku:sku-1:hero', goal: '商品主图',
      ownership: { level: 'sku', key: 'sku-1' }, status: 'SUCCEEDED', attempt: 1,
      revision: 5, estimatedCostCents: 9, maximumCostCents: 12,
      workflowId: 'child-workflow-1', workflowRevision: 4, reviewStatus: 'PENDING',
      output: {
        id: 'asset-1', url: 'https://erp.example/generated/asset-1.png',
        storageBackend: 'oss', mimeType: 'image/png', width: 900, height: 1200,
      },
      application: null,
      allowedActions: ['REVIEW_SLOT'],
      commands: {
        REVIEW_SLOT: {
          suiteId: 'suite-1', slotId: 'slot-review', workflowId: 'child-workflow-1',
          outputAssetId: 'asset-1', expectedSuiteRevision: 8, expectedSlotRevision: 5,
          expectedWorkflowRevision: 4, decisions: ['APPROVE', 'REJECT'],
        },
      },
    }, {
      id: 'slot-retry', ordinal: 1, slotKey: 'sku:sku-1:detail-1', goal: '商品细节图',
      ownership: { level: 'sku', key: 'sku-1' }, status: 'FAILED', attempt: 1,
      revision: 3, estimatedCostCents: 9, maximumCostCents: 12,
      workflowId: null, workflowRevision: null, reviewStatus: 'NOT_READY', output: null,
      application: null,
      allowedActions: ['RETRY_SLOT'],
      commands: {
        RETRY_SLOT: {
          suiteId: 'suite-1', slotId: 'slot-retry', expectedSuiteRevision: 8,
          expectedSlotRevision: 3, acceptedAdditionalMaximumCostCents: 12,
        },
      },
    }],
  };
  return projection;
}

function approvedSuiteFixture() {
  const projection = currentSuiteFixture();
  const slot = projection.suite.slots[0];
  slot.reviewStatus = 'APPROVED';
  slot.allowedActions = ['APPLY_SLOT'];
  slot.commands = {
    APPLY_SLOT: {
      suiteId: projection.suite.id,
      slotId: slot.id,
      workflowId: slot.workflowId,
      outputAssetId: slot.output.id,
      expectedSuiteRevision: projection.suite.revision,
      expectedSlotRevision: slot.revision,
      expectedWorkflowRevision: slot.workflowRevision,
      mode: 'append',
      target: 'ERP_SOURCE_PRODUCT',
      writesStoreDraft: false,
      expectedTargetUpdatedAt: '2026-07-27T08:00:00.000Z',
    },
  };
  return projection;
}

const planned = adapter.project(projectionFixture());
assert.equal(planned.contractVersion, api.CONTRACT_VERSION);
assert.equal(planned.executionMode, 'ERP_HOSTED');
assert.deepEqual(JSON.parse(JSON.stringify(planned.binding)), {
  shopId: 'shop-1', workflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
});
assert.deepEqual(JSON.parse(JSON.stringify(planned.quote)), {
  pricingVersion: 'pricing-v1', itemCount: 2,
  estimatedCostCents: 18, maximumCostCents: 24,
});
assert.equal(planned.plan.startIntent.action, 'START');
assert.equal(planned.plan.startIntent.commandTemplate.acceptedMaximumCostCents, 24);
assert.equal(planned.suite, null);
assert.equal(Object.isFrozen(planned), true);

const current = adapter.project(currentSuiteFixture());
assert.equal(current.plan.startIntent, null);
assert.equal(current.suite.continueIntent.action, 'CONTINUE');
assert.equal(current.suite.cancelIntent.action, 'CANCEL');
assert.equal(current.suite.slots[0].previewAvailable, true);
assert.deepEqual(JSON.parse(JSON.stringify(current.suite.slots[0].output)), {
  assetId: 'asset-1', mimeType: 'image/png', width: 900, height: 1200,
});
assert.equal(current.suite.slots[0].reviewIntents.APPROVE.decision, 'APPROVE');
assert.equal(current.suite.slots[0].reviewIntents.REJECT.decision, 'REJECT');
assert.equal(current.suite.slots[1].retryIntent.commandTemplate.acceptedAdditionalMaximumCostCents, 12);
const serialized = JSON.stringify(current);
for (const forbidden of [
  'https://', 'url', 'provider', 'model', 'prompt', 'apiKey', 'authorization',
]) {
  assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
}

const approved = adapter.project(approvedSuiteFixture());
assert.equal(approved.suite.slots[0].applyIntent.action, 'APPLY_SLOT');
assert.equal(approved.suite.slots[0].applyIntent.commandTemplate.target, 'ERP_SOURCE_PRODUCT');
assert.equal(approved.suite.slots[0].applyIntent.commandTemplate.writesStoreDraft, false);
assert.deepEqual(JSON.parse(JSON.stringify(approved.applyPolicy)), {
  target: 'ERP_SOURCE_PRODUCT', mode: 'append', writesStoreDraft: false,
});
assert.equal(Object.isFrozen(approved.suite.slots[0].applyIntent), true);

const empty = projectionFixture();
empty.commandAuthority = null;
empty.plan = null;
const emptyProjected = adapter.project(empty);
assert.equal(emptyProjected.plan, null);
assert.equal(emptyProjected.quote, null);
assert.equal(emptyProjected.suite, null);

for (const mutate of [
  (value) => { value.context.shopId = 'shop-other'; },
  (value) => { value.commandAuthority.snapshotId = 'snapshot-other'; },
  (value) => { value.plan.preview.maximumCostCents = 17; },
  (value) => { value.applyPolicy.writesStoreDraft = true; },
  (value) => { value.suite.slots[0].output.url = 'http://metadata.internal/latest'; },
  (value) => { value.suite.slots[0].prompt = 'must not be accepted'; },
]) {
  const invalid = currentSuiteFixture();
  mutate(invalid);
  assert.throws(
    () => adapter.project(invalid),
    (error) => error?.code === 'SS_ERP_HOSTED_WORKBENCH_PROJECTION_INVALID',
  );
}

console.log('extension hosted AI image suite workbench adapter tests passed');
