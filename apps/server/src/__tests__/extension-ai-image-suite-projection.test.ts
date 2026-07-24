import { describe, expect, it } from 'vitest';
import {
  projectExtensionAiImageSuite,
} from '../services/extension-ai-image-suite-projection.js';

const binding = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  draftRevision: 11,
  draftVersion: 7,
};

function approvedPlanState() {
  return {
    authority: { ...binding },
    targetUpdatedAt: '2026-07-24T00:00:00.000Z',
    executionReady: true,
    plan: {
      id: 'plan-1',
      revision: 3,
      reviewStatus: 'APPROVED',
      staleAt: null,
      contextType: 'collect',
      contextId: 'goods-1',
      currentVersionId: 'plan-version-1',
      approvedVersionId: 'plan-version-1',
      skuKey: null,
      prompt: 'must-not-leak prompt',
      provider: 'must-not-leak provider',
      model: 'must-not-leak model',
      baseUrl: 'https://provider.example/v1',
      apiKey: 'must-not-leak-api-key',
      approvedVersion: {
        id: 'plan-version-1',
        sourceCaptureSnapshotId: 'snapshot-1',
      },
      preview: {
        planId: 'plan-1',
        planVersionId: 'plan-version-1',
        planRevision: 3,
        previewHash: 'a'.repeat(64),
        pricingVersion: 'pricing-2026-07-24',
        itemCount: 2,
        estimatedCostCents: 18,
        maximumCostCents: 24,
        provider: 'must-not-leak provider',
        model: 'must-not-leak model',
        slots: [{
          ordinal: 0,
          slotKey: 'sku:sku-1:hero',
          goal: '商品主图',
          ownership: { level: 'sku', key: 'sku-1' },
          estimatedCostCents: 9,
          maximumCostCents: 12,
          references: [{ source: { url: 'https://external.example/source.jpg' } }],
          resolvedPrompt: 'must-not-leak slot prompt',
        }],
      },
    },
    suite: null,
  };
}

function currentSuiteState() {
  const state = approvedPlanState() as any;
  state.suite = {
    id: 'suite-1',
    planId: 'plan-1',
    planVersionId: 'plan-version-1',
    status: 'PARTIAL_FAILURE',
    revision: 8,
    previewHash: 'a'.repeat(64),
    pricingVersion: 'pricing-2026-07-24',
    itemCount: 2,
    estimatedCostCents: 18,
    maximumCostCents: 24,
    provider: 'must-not-leak provider',
    model: 'must-not-leak model',
    baseUrl: 'https://provider.example/v1',
    apiKey: 'must-not-leak-api-key',
    slots: [{
      id: 'slot-1',
      ordinal: 0,
      slotKey: 'sku:sku-1:hero',
      goal: '商品主图',
      ownershipLevel: 'sku',
      ownershipKey: 'sku-1',
      status: 'SUCCEEDED',
      attempt: 1,
      revision: 5,
      estimatedCostCents: 9,
      maximumCostCents: 12,
      childWorkflowId: 'workflow-1',
      childWorkflow: {
        id: 'workflow-1',
        status: 'SUCCEEDED',
        revision: 4,
        reviewStatus: 'PENDING',
        selectedOutputAssetId: null,
        prompt: 'must-not-leak workflow prompt',
        jobs: [{
          id: 'job-1',
          provider: 'must-not-leak provider',
          assets: [{
            id: 'asset-safe-1',
            ownerUserId: 'owner-1',
            aiImageJobId: 'job-1',
            sourceCaptureSnapshotId: 'snapshot-1',
            kind: 'AI_GENERATED',
            storageBackend: 'local',
            url: 'https://erp.example/generated/asset-safe-1.png',
            mimeType: 'image/png',
            width: 1024,
            height: 1024,
          }, {
            id: 'asset-external-1',
            ownerUserId: 'owner-1',
            aiImageJobId: 'job-1',
            sourceCaptureSnapshotId: 'snapshot-1',
            kind: 'AI_GENERATED',
            storageBackend: 'oss',
            url: 'https://external.example/generated/asset-external-1.png',
            mimeType: 'image/png',
            width: 1024,
            height: 1024,
          }],
        }],
      },
    }, {
      id: 'slot-2',
      ordinal: 1,
      slotKey: 'sku:sku-1:detail-1',
      goal: '商品细节图',
      ownershipLevel: 'sku',
      ownershipKey: 'sku-1',
      status: 'FAILED',
      attempt: 1,
      revision: 3,
      estimatedCostCents: 9,
      maximumCostCents: 12,
      childWorkflowId: 'workflow-2',
      childWorkflow: {
        id: 'workflow-2', status: 'FAILED', revision: 2, reviewStatus: 'NOT_READY',
        jobs: [{
          id: 'job-2', status: 'FAILED', workflowAttempt: 1,
          provider: 'must-not-leak provider', model: 'must-not-leak model',
          requestFingerprint: 'f'.repeat(64),
          providerDispatchedAt: new Date('2026-07-24T00:00:00.000Z'),
          providerJobId: null, providerReconciliationStatus: 'NOT_SUBMITTED',
          providerReconciliationLeaseOwner: null, providerReconciliationLeaseTokenHash: null,
          providerReconciliationLeaseExpiresAt: null,
          providerReconciledAt: new Date('2026-07-24T00:01:00.000Z'),
          actualCostCents: null, billedUnits: 0,
          costReservation: {
            status: 'RELEASED', provider: 'must-not-leak provider', model: 'must-not-leak model',
            requestFingerprint: 'f'.repeat(64),
          },
          _count: { assets: 0 }, assets: [],
        }],
      },
    }],
  };
  return state;
}

describe('extension AI image suite projection', () => {
  it('projects only safe approved-plan fields and START command confirmation data', () => {
    const result = projectExtensionAiImageSuite({
      requested: binding,
      state: approvedPlanState(),
      ownerUserId: 'owner-1',
      scopes: ['listing:review', 'media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(result).toEqual({
      contractVersion: 'extension-ai-image-suite-projection/v1',
      context: binding,
      commandAuthority: {
        snapshotId: 'snapshot-1',
        supplyGoodsId: 'goods-1',
        draftRevision: 11,
        planId: 'plan-1',
        planVersionId: 'plan-version-1',
        planRevision: 3,
        skuKey: null,
        authorityHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      applyPolicy: {
        target: 'ERP_SOURCE_PRODUCT',
        mode: 'append',
        writesStoreDraft: false,
      },
      plan: {
        id: 'plan-1',
        versionId: 'plan-version-1',
        revision: 3,
        status: 'APPROVED',
        skuKey: null,
        preview: {
          hash: 'a'.repeat(64),
          pricingVersion: 'pricing-2026-07-24',
          itemCount: 2,
          estimatedCostCents: 18,
          maximumCostCents: 24,
          slots: [{
            ordinal: 0,
            slotKey: 'sku:sku-1:hero',
            goal: '商品主图',
            ownership: { level: 'sku', key: 'sku-1' },
            estimatedCostCents: 9,
            maximumCostCents: 12,
          }],
        },
        allowedActions: ['START'],
        commands: {
          START: {
            expectedPreviewHash: 'a'.repeat(64),
            acceptedPricingVersion: 'pricing-2026-07-24',
            acceptedEstimatedCostCents: 18,
            acceptedMaximumCostCents: 24,
          },
        },
      },
      suite: null,
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'must-not-leak', 'provider.example', 'external.example', 'resolvedPrompt', 'apiKey',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('projects trusted outputs and state-scoped review/retry commands for the current suite', () => {
    const result = projectExtensionAiImageSuite({
      requested: binding,
      state: currentSuiteState(),
      ownerUserId: 'owner-1',
      scopes: ['listing:review', 'media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(result.plan?.allowedActions).toEqual([]);
    expect(result.suite).toEqual({
      id: 'suite-1',
      status: 'PARTIAL_FAILURE',
      revision: 8,
      previewHash: 'a'.repeat(64),
      pricingVersion: 'pricing-2026-07-24',
      itemCount: 2,
      estimatedCostCents: 18,
      maximumCostCents: 24,
      allowedActions: [],
      commands: {},
      slots: [{
        id: 'slot-1',
        ordinal: 0,
        slotKey: 'sku:sku-1:hero',
        goal: '商品主图',
        ownership: { level: 'sku', key: 'sku-1' },
        status: 'SUCCEEDED',
        attempt: 1,
        revision: 5,
        estimatedCostCents: 9,
        maximumCostCents: 12,
        workflowId: 'workflow-1',
        workflowRevision: 4,
        reviewStatus: 'PENDING',
        output: {
          id: 'asset-safe-1',
          url: 'https://erp.example/generated/asset-safe-1.png',
          storageBackend: 'local',
          mimeType: 'image/png',
          width: 1024,
          height: 1024,
        },
        application: null,
        allowedActions: ['REVIEW_SLOT'],
        commands: {
          REVIEW_SLOT: {
            suiteId: 'suite-1',
            slotId: 'slot-1',
            workflowId: 'workflow-1',
            outputAssetId: 'asset-safe-1',
            expectedSuiteRevision: 8,
            expectedSlotRevision: 5,
            expectedWorkflowRevision: 4,
            decisions: ['APPROVE', 'REJECT'],
          },
        },
      }, {
        id: 'slot-2',
        ordinal: 1,
        slotKey: 'sku:sku-1:detail-1',
        goal: '商品细节图',
        ownership: { level: 'sku', key: 'sku-1' },
        status: 'FAILED',
        attempt: 1,
        revision: 3,
        estimatedCostCents: 9,
        maximumCostCents: 12,
        workflowId: 'workflow-2',
        workflowRevision: 2,
        reviewStatus: 'NOT_READY',
        output: null,
        application: null,
        allowedActions: ['RETRY_SLOT'],
        commands: {
          RETRY_SLOT: {
            suiteId: 'suite-1',
            slotId: 'slot-2',
            expectedSuiteRevision: 8,
            expectedSlotRevision: 3,
            acceptedAdditionalMaximumCostCents: 12,
          },
        },
      }],
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'must-not-leak', 'provider.example', 'external.example', 'prompt', 'apiKey',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('allows only ERP source-product append after approval and never claims store-draft writes', () => {
    const state = currentSuiteState() as any;
    state.suite.status = 'SUCCEEDED';
    state.suite.slots = [state.suite.slots[0]];
    state.suite.slots[0].childWorkflow.reviewStatus = 'APPROVED';
    state.suite.slots[0].childWorkflow.selectedOutputAssetId = 'asset-safe-1';

    const result = projectExtensionAiImageSuite({
      requested: binding,
      state,
      ownerUserId: 'owner-1',
      scopes: ['listing:review', 'listing:write'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(result.suite?.slots[0]).toMatchObject({
      reviewStatus: 'APPROVED',
      allowedActions: ['APPLY_SLOT'],
      commands: {
        APPLY_SLOT: {
          suiteId: 'suite-1',
          slotId: 'slot-1',
          workflowId: 'workflow-1',
          outputAssetId: 'asset-safe-1',
          expectedSuiteRevision: 8,
          expectedSlotRevision: 5,
          expectedWorkflowRevision: 4,
          mode: 'append',
          target: 'ERP_SOURCE_PRODUCT',
          writesStoreDraft: false,
          expectedTargetUpdatedAt: '2026-07-24T00:00:00.000Z',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('STORE_DRAFT');
  });

  it('withholds paid retry while Provider reconciliation or historical evidence is unresolved', () => {
    const state = currentSuiteState() as any;
    state.suite.slots[1].childWorkflow.jobs[0].providerReconciliationStatus = 'MANUAL_REVIEW';
    state.suite.slots[1].childWorkflow.jobs[0].providerReconciledAt = null;

    const result = projectExtensionAiImageSuite({
      requested: binding,
      state,
      ownerUserId: 'owner-1',
      scopes: ['media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(result.suite?.slots[1]).toMatchObject({ allowedActions: [], commands: {} });
  });

  it.each([
    ['job model', (job: any) => { job.model = 'drifted-model'; }],
    ['job fingerprint', (job: any) => { job.requestFingerprint = 'e'.repeat(64); }],
    ['reservation provider', (job: any) => { job.costReservation.provider = 'drifted-provider'; }],
    ['reservation model', (job: any) => { job.costReservation.model = 'drifted-model'; }],
    ['reservation fingerprint', (job: any) => {
      job.costReservation.requestFingerprint = 'e'.repeat(64);
    }],
  ])('withholds paid retry when the terminal %s authority differs', (_label, mutate) => {
    const state = currentSuiteState() as any;
    mutate(state.suite.slots[1].childWorkflow.jobs[0]);

    const result = projectExtensionAiImageSuite({
      requested: binding,
      state,
      ownerUserId: 'owner-1',
      scopes: ['media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(result.suite?.slots[1]).toMatchObject({ allowedActions: [], commands: {} });
  });

  it('withholds APPLY_SLOT when the ERP source-product target version is unavailable', () => {
    const state = currentSuiteState() as any;
    state.suite.status = 'SUCCEEDED';
    state.suite.slots = [state.suite.slots[0]];
    state.suite.slots[0].childWorkflow.reviewStatus = 'APPROVED';
    state.suite.slots[0].childWorkflow.selectedOutputAssetId = 'asset-safe-1';
    state.targetUpdatedAt = null;

    const result = projectExtensionAiImageSuite({
      requested: binding,
      state,
      ownerUserId: 'owner-1',
      scopes: ['listing:review', 'listing:write'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(result.suite?.slots[0]).toMatchObject({
      allowedActions: [],
      commands: {},
    });
  });

  it('keeps historical review and apply actions readable while generation is dark', () => {
    const pending = currentSuiteState() as any;
    pending.executionReady = false;

    const reviewProjection = projectExtensionAiImageSuite({
      requested: binding,
      state: pending,
      ownerUserId: 'owner-1',
      scopes: ['listing:review', 'listing:write', 'media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(reviewProjection.plan?.allowedActions).toEqual([]);
    expect(reviewProjection.suite?.slots[0]).toMatchObject({
      allowedActions: ['REVIEW_SLOT'],
      commands: { REVIEW_SLOT: expect.any(Object) },
    });
    expect(reviewProjection.suite?.slots[1]).toMatchObject({
      allowedActions: [],
      commands: {},
    });

    const approved = currentSuiteState() as any;
    approved.executionReady = false;
    approved.suite.status = 'SUCCEEDED';
    approved.suite.slots = [approved.suite.slots[0]];
    approved.suite.slots[0].childWorkflow.reviewStatus = 'APPROVED';
    approved.suite.slots[0].childWorkflow.selectedOutputAssetId = 'asset-safe-1';

    const applyProjection = projectExtensionAiImageSuite({
      requested: binding,
      state: approved,
      ownerUserId: 'owner-1',
      scopes: ['listing:review', 'listing:write', 'media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(applyProjection.suite?.slots[0]).toMatchObject({
      allowedActions: ['APPLY_SLOT'],
      commands: { APPLY_SLOT: expect.any(Object) },
    });
  });

  it('allows zero-cost fake START and RETRY_SLOT commands', () => {
    const startState = approvedPlanState() as any;
    startState.plan.preview.provider = 'fake';
    startState.plan.preview.model = 'fake-image-suite-v1';
    startState.plan.preview.pricingVersion = 'provider-free-zero/v1';
    startState.plan.preview.estimatedCostCents = 0;
    startState.plan.preview.maximumCostCents = 0;
    startState.plan.preview.slots[0].estimatedCostCents = 0;
    startState.plan.preview.slots[0].maximumCostCents = 0;

    const startProjection = projectExtensionAiImageSuite({
      requested: binding,
      state: startState,
      ownerUserId: 'owner-1',
      scopes: ['media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(startProjection.plan).toMatchObject({
      allowedActions: ['START'],
      commands: {
        START: {
          acceptedEstimatedCostCents: 0,
          acceptedMaximumCostCents: 0,
          acceptedPricingVersion: 'provider-free-zero/v1',
        },
      },
    });

    const retryState = currentSuiteState() as any;
    retryState.plan.preview.pricingVersion = 'provider-free-zero/v1';
    retryState.plan.preview.estimatedCostCents = 0;
    retryState.plan.preview.maximumCostCents = 0;
    retryState.plan.preview.slots[0].estimatedCostCents = 0;
    retryState.plan.preview.slots[0].maximumCostCents = 0;
    retryState.suite.provider = 'fake';
    retryState.suite.model = 'fake-image-suite-v1';
    retryState.suite.pricingVersion = 'provider-free-zero/v1';
    retryState.suite.estimatedCostCents = 0;
    retryState.suite.maximumCostCents = 0;
    retryState.suite.slots[1].estimatedCostCents = 0;
    retryState.suite.slots[1].maximumCostCents = 0;
    retryState.suite.slots[1].childWorkflow.jobs[0].provider = 'fake';
    retryState.suite.slots[1].childWorkflow.jobs[0].model = 'fake-image-suite-v1';
    retryState.suite.slots[1].childWorkflow.jobs[0].costReservation.provider = 'fake';
    retryState.suite.slots[1].childWorkflow.jobs[0].costReservation.model = 'fake-image-suite-v1';

    const retryProjection = projectExtensionAiImageSuite({
      requested: binding,
      state: retryState,
      ownerUserId: 'owner-1',
      scopes: ['media:execute'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(retryProjection.suite?.slots[1]).toMatchObject({
      allowedActions: ['RETRY_SLOT'],
      commands: {
        RETRY_SLOT: { acceptedAdditionalMaximumCostCents: 0 },
      },
    });
  });

  it('never projects raw AI_PROVIDER_OUTPUT assets as reviewable output', () => {
    const state = currentSuiteState() as any;
    const assets = state.suite.slots[0].childWorkflow.jobs[0].assets;
    assets.unshift({
      id: 'asset-provider-raw-1',
      ownerUserId: 'owner-1',
      aiImageJobId: 'job-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      kind: 'AI_PROVIDER_OUTPUT',
      storageBackend: 'oss',
      url: 'https://erp.example/provider-output/asset-provider-raw-1.png',
      mimeType: 'image/png',
      width: 1024,
      height: 1536,
    });

    const withFinal = projectExtensionAiImageSuite({
      requested: binding,
      state,
      ownerUserId: 'owner-1',
      scopes: ['listing:review'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(withFinal.suite?.slots[0]).toMatchObject({
      output: { id: 'asset-safe-1' },
      allowedActions: ['REVIEW_SLOT'],
    });
    expect(JSON.stringify(withFinal)).not.toContain('asset-provider-raw-1');
    expect(JSON.stringify(withFinal)).not.toContain('/provider-output/');

    state.suite.slots[0].childWorkflow.jobs[0].assets = [assets[0]];
    const rawOnly = projectExtensionAiImageSuite({
      requested: binding,
      state,
      ownerUserId: 'owner-1',
      scopes: ['listing:review'],
      trustedPreviewOrigins: ['https://erp.example'],
    });

    expect(rawOnly.suite?.slots[0]).toMatchObject({
      output: null,
      allowedActions: [],
      commands: {},
    });
  });
});
