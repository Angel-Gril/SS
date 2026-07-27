import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionHostedAiImagePlanService,
  ExtensionHostedAiImagePlanError,
  type ExtensionHostedAiImagePlanAuthority,
} from '../services/extension-hosted-ai-image-plan.js';
import type {
  AiMediaPlanRecord,
  AiMediaPlanVersionRecord,
  ReviewAiMediaPlanInput,
} from '../services/ai-media-planning.js';

const binding = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  draftRevision: 11,
  draftVersion: 7,
};

const identity = {
  ownerUserId: 'owner-1',
  actorUserId: 'owner-1',
  deviceSessionId: 'session-1',
};

function authority(overrides: Partial<ExtensionHostedAiImagePlanAuthority> = {}) {
  return {
    ...binding,
    ownerUserId: 'owner-1',
    sourceSubjectId: 'subject-1',
    sourceCaptureCurrent: true,
    workflowStatus: 'ACTIVE',
    draftStage: 'MEDIA_REVIEW',
    selectedSkuKeys: ['sku-2', 'sku-1'],
    capturedSkuKeys: ['sku-1', 'sku-2'],
    candidateMediaKeys: ['media-2', 'media-1'],
    ...overrides,
  } satisfies ExtensionHostedAiImagePlanAuthority;
}

function version(overrides: Partial<AiMediaPlanVersionRecord> = {}): AiMediaPlanVersionRecord {
  return {
    id: 'version-1',
    planId: 'plan-1',
    ownerUserId: 'owner-1',
    version: 1,
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    inputFingerprint: 'c'.repeat(64),
    planSchemaVersion: 'ai-image-prompt-plan/2.0',
    plannerVersion: 'ai-media-rule-planner/v1',
    mode: 'RULE_BASED',
    fallbackReason: null,
    inputSnapshot: {
      source: { subjectId: 'subject-1', snapshotId: 'snapshot-1' },
      context: { type: 'collect', id: 'goods-1' },
      skus: [{ skuKey: 'sku-1' }, { skuKey: 'sku-2' }],
      candidates: [{ id: 'media-2', url: 'https://must-not-leak.example/2.png' }, { id: 'media-1' }],
      provider: 'must-not-leak',
      model: 'must-not-leak',
      pricing: { maximumCostCents: 99 },
    },
    curation: {},
    curationHash: 'd'.repeat(64),
    visionEvidence: {},
    visionEvidenceHash: 'e'.repeat(64),
    planHash: 'f'.repeat(64),
    planPayload: {
      version: '2.0',
      mode: 'rule_based',
      slots: [{
        slotKey: 'sku:sku-1:hero',
        goal: 'sku_hero',
        status: 'READY',
        aspectRatio: '3:4',
        ownership: { level: 'sku', key: 'sku-1' },
        references: [{ candidateId: 'media-1', evidenceIds: ['secret-evidence'] }],
        factEvidenceIds: ['secret-fact'],
        safetyConstraints: ['preserve_product_identity'],
        acceptanceChecks: ['product_matches_references'],
        compiledPrompt: 'must-not-leak',
      }],
      compiledPrompt: 'must-not-leak',
    },
    provenance: { provider: 'must-not-leak', model: 'must-not-leak' },
    provenanceHash: '1'.repeat(64),
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    ...overrides,
  };
}

function plan(overrides: Partial<AiMediaPlanRecord> = {}): AiMediaPlanRecord {
  const currentVersion = version();
  return {
    id: 'plan-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    sourceSubjectId: 'subject-1',
    contextType: 'collect',
    contextId: 'goods-1',
    revision: 3,
    latestVersion: 1,
    currentVersionId: currentVersion.id,
    approvedVersionId: null,
    reviewStatus: 'PENDING',
    staleAt: null,
    staleAgainstFingerprint: null,
    staleReasons: null,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    updatedAt: new Date('2026-07-27T00:00:00.000Z'),
    currentVersion,
    approvedVersion: null,
    ...overrides,
  };
}

function setup(input: {
  authority?: ExtensionHostedAiImagePlanAuthority | null;
  enabled?: boolean;
  plan?: AiMediaPlanRecord;
} = {}) {
  const currentPlan = input.plan ?? plan();
  const planning = {
    createRuleBased: vi.fn(async () => ({ plan: currentPlan, replayed: false })),
    getWithSourceStatus: vi.fn(async () => ({ plan: currentPlan, sourceCurrent: true })),
    getCurrentByContext: vi.fn(async () => ({ plan: currentPlan, sourceCurrent: true })),
    review: vi.fn(async (_input: ReviewAiMediaPlanInput) => ({
      plan: currentPlan,
      replayed: false,
      sourceCurrent: true,
    })),
  };
  const loadAuthority = vi.fn(async () => (
    input.authority === undefined ? authority() : input.authority
  ));
  const evaluatePolicy = vi.fn(async (request: {
    ownerUserId: string; shopId: string; deviceSessionId: string;
  }) => ({
    ...request,
    enabled: input.enabled ?? true,
    revision: 19,
  }));
  return {
    service: createExtensionHostedAiImagePlanService({
      planning,
      loadAuthority,
      evaluatePolicy,
    }),
    planning,
    loadAuthority,
    evaluatePolicy,
  };
}

describe('extension hosted AI image plan service', () => {
  it('creates from exact authoritative draft facts and returns a URL/provider/price-free projection', async () => {
    const fixture = setup();
    const result = await fixture.service.create({
      identity,
      binding,
      idempotencyKey: 'client-create-operation-1',
    });

    expect(fixture.evaluatePolicy).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', shopId: 'shop-1', deviceSessionId: 'session-1',
    });
    expect(fixture.loadAuthority).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', listingWorkflowId: 'listing-1',
    });
    expect(fixture.planning.createRuleBased).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      sourceSubjectId: 'subject-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      context: { type: 'collect', id: 'goods-1' },
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
      selectedSkuKeys: ['sku-1', 'sku-2'],
      candidateMediaKeys: ['media-1', 'media-2'],
    });
    expect(result).toMatchObject({
      replayed: false,
      data: {
        contractVersion: 'extension-hosted-ai-image-plan/v1',
        policyRevision: 19,
        context: binding,
        plan: {
          id: 'plan-1', revision: 3, reviewStatus: 'PENDING', sourceCurrent: true,
          currentVersion: {
            id: 'version-1',
            slots: [{
              slotKey: 'sku:sku-1:hero',
              goal: 'sku_hero',
              references: [{ candidateId: 'media-1' }],
            }],
          },
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/must-not-leak|https?:|provider|model|pricing|maximumCost|compiledPrompt/u);
  });

  it.each([
    ['draft revision', authority({ draftRevision: 12 }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['draft version', authority({ draftVersion: 8 }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['source snapshot', authority({ snapshotId: 'snapshot-2' }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['shop', authority({ shopId: 'shop-2' }), 'HOSTED_AI_IMAGE_PLAN_FORBIDDEN'],
    ['owner', authority({ ownerUserId: 'owner-2' }), 'HOSTED_AI_IMAGE_PLAN_FORBIDDEN'],
    ['stale source', authority({ sourceCaptureCurrent: false }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
  ] as const)('rejects a changed %s before creating a plan', async (_label, loaded, code) => {
    const fixture = setup({ authority: loaded });
    await expect(fixture.service.create({
      identity, binding, idempotencyKey: 'client-create-operation-1',
    })).rejects.toMatchObject({ code });
    expect(fixture.planning.createRuleBased).not.toHaveBeenCalled();
  });

  it.each([
    authority({ selectedSkuKeys: [] }),
    authority({ selectedSkuKeys: ['sku-1', 'sku-1'] }),
    authority({ selectedSkuKeys: ['sku-3'] }),
  ])('rejects missing, duplicate, or capture-foreign SKU authority', async (loaded) => {
    const fixture = setup({ authority: loaded });
    await expect(fixture.service.create({
      identity, binding, idempotencyKey: 'client-create-operation-1',
    })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_SKU_AMBIGUOUS' });
    expect(fixture.planning.createRuleBased).not.toHaveBeenCalled();
  });

  it('fails closed when policy is disabled or bound to another device session', async () => {
    const disabled = setup({ enabled: false });
    await expect(disabled.service.get({ identity, binding, planId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_POLICY_DISABLED' });
    expect(disabled.loadAuthority).not.toHaveBeenCalled();

    const mismatched = setup();
    mismatched.evaluatePolicy.mockResolvedValueOnce({
      enabled: true,
      revision: 20,
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      deviceSessionId: 'session-other',
    });
    await expect(mismatched.service.get({ identity, binding, planId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_POLICY_UNAVAILABLE' });
    expect(mismatched.loadAuthority).not.toHaveBeenCalled();
  });

  it('revalidates frozen SKU/media/source facts before reads and review', async () => {
    const changedPlan = plan();
    (changedPlan.currentVersion!.inputSnapshot as any).skus = [{ skuKey: 'sku-1' }];
    const fixture = setup({ plan: changedPlan });

    await expect(fixture.service.get({ identity, binding, planId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE' });
    await expect(fixture.service.review({
      identity,
      binding,
      planId: 'plan-1',
      expectedRevision: 3,
      operationKey: 'client-review-operation-1',
      decision: 'APPROVE',
      note: null,
    })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE' });
    expect(fixture.planning.review).not.toHaveBeenCalled();
  });

  it('reviews only an exact current plan using a server-derived device/draft operation key', async () => {
    const fixture = setup();
    const result = await fixture.service.review({
      identity,
      binding,
      planId: 'plan-1',
      expectedRevision: 3,
      operationKey: 'client-review-operation-1',
      decision: 'APPROVE',
      note: 'approved',
    });

    expect(fixture.planning.review).toHaveBeenCalledWith({
      planId: 'plan-1',
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: 3,
      operationKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
      decision: 'APPROVE',
      note: 'approved',
    });
    expect((fixture.planning.review.mock.calls[0]?.[0] as any).operationKey)
      .not.toBe('client-review-operation-1');
    expect(result.replayed).toBe(false);
  });

  it('rejects a non-owner device identity before policy or tenant reads', async () => {
    const fixture = setup();
    await expect(fixture.service.create({
      identity: { ...identity, actorUserId: 'actor-2' },
      binding,
      idempotencyKey: 'client-create-operation-1',
    })).rejects.toBeInstanceOf(ExtensionHostedAiImagePlanError);
    expect(fixture.evaluatePolicy).not.toHaveBeenCalled();
    expect(fixture.loadAuthority).not.toHaveBeenCalled();
  });
});
