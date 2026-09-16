import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionHostedAiImagePlanBindingRecord,
  createExtensionHostedAiImagePlanService,
  ExtensionHostedAiImagePlanError,
  type ExtensionHostedAiImagePlanAuthority,
} from '../services/extension-hosted-ai-image-plan.js';
import {
  AI_MEDIA_GALLERY_GOALS,
  AiMediaPlanningError,
  type AiMediaPlanRecord,
  type AiMediaPlanVersionRecord,
  type CreateRuleBasedAiMediaPlanningInput,
  type ReviewAiMediaPlanInput,
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
  const seededBinding = createExtensionHostedAiImagePlanBindingRecord({
    planId: currentPlan.id,
    identity,
    binding,
    selectedSkuKeys: ['sku-1', 'sku-2'],
    candidateMediaKeys: ['media-1', 'media-2'],
  });
  const planning = {
    createRuleBased: vi.fn(async (_input: CreateRuleBasedAiMediaPlanningInput) => ({ plan: currentPlan, replayed: false })),
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
  const bindings = {
    bind: vi.fn(async (record: typeof seededBinding) => {
      if (record.bindingHash === seededBinding.bindingHash) {
        return { kind: 'replayed' as const, record: seededBinding };
      }
      return { kind: 'conflict' as const };
    }),
    get: vi.fn(async ({ planId }: { ownerUserId: string; planId: string }) => (
      planId === seededBinding.planId ? seededBinding : null
    )),
    find: vi.fn(async (): Promise<typeof seededBinding | null> => seededBinding),
  };
  return {
    service: createExtensionHostedAiImagePlanService({
      planning,
      bindings,
      loadAuthority,
      evaluatePolicy,
    }),
    planning,
    loadAuthority,
    evaluatePolicy,
    bindings,
    seededBinding,
  };
}

describe('extension hosted AI image plan service', () => {
  it('keeps all extension gallery allowlists aligned with the planning owner', () => {
    for (const [file, name] of [
      ['ai-image-suite-workbench-client.js', 'SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT'],
      ['ai-image-suite-workbench-runtime-client.js', 'SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT'],
      ['ai-image-suite-workbench-runtime-dispatcher.js', 'SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_DISPATCHER'],
    ]) {
      const sandbox: Record<string, { GALLERY_GOALS: readonly string[] }> = {};
      runInNewContext(readFileSync(new URL(`../../../../extensions/ss-erp/shared/hosted/${file}`, import.meta.url), 'utf8'), sandbox);
      expect([...sandbox[name!]!.GALLERY_GOALS]).toEqual([...AI_MEDIA_GALLERY_GOALS]);
      expect(Object.isFrozen(sandbox[name!]!.GALLERY_GOALS)).toBe(true);
    }
  });

  it('forwards selected gallery goals without creating a second initial-plan identity', async () => {
    const fixture = setup();
    const request = { identity, binding, idempotencyKey: 'client-gallery-operation-1' };
    await fixture.service.create({ ...request, galleryGoals: ['scene'] });
    const first = fixture.planning.createRuleBased.mock.calls[0]?.[0] as unknown as {
      idempotencyKey: string; galleryGoals: string[];
    };
    expect(first.galleryGoals).toEqual(['scene']);

    fixture.planning.createRuleBased.mockRejectedValueOnce(new AiMediaPlanningError(
      'AI_MEDIA_PLANNING_IDEMPOTENCY_CONFLICT', 'Different frozen goals', 409,
    ));
    await expect(fixture.service.create({
      ...request, idempotencyKey: 'another-client-operation', galleryGoals: ['detail'],
    })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_REQUEST_CONFLICT', statusCode: 409 });
    const second = fixture.planning.createRuleBased.mock.calls[1]?.[0] as unknown as {
      idempotencyKey: string; galleryGoals: string[];
    };
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.galleryGoals).toEqual(['detail']);
    expect(fixture.bindings.bind).toHaveBeenCalledTimes(1);
  });

  it.each([null, [], ['scene', 'scene'], ['hero'], ['SCENE'], 'scene', ['scene', 1]].map((value) => [value]))(
    'rejects invalid gallery goals %j before planning', async (galleryGoals) => {
      const fixture = setup();
      await expect(fixture.service.create({
        identity, binding, idempotencyKey: 'client-gallery-operation-1', ...{ galleryGoals },
      } as never)).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST' });
      expect(fixture.planning.createRuleBased).not.toHaveBeenCalled();
      expect(fixture.bindings.bind).not.toHaveBeenCalled();
    },
  );

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
    expect(fixture.bindings.bind).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-1',
      ownerUserId: 'owner-1',
      deviceSessionId: 'session-1',
      shopId: 'shop-1',
      listingWorkflowId: 'listing-1',
      draftRevision: 11,
      draftVersion: 7,
      authorityHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      bindingHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
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

  it('keeps the paid authority identity device-independent while access stays device-bound', () => {
    const first = createExtensionHostedAiImagePlanBindingRecord({
      planId: 'plan-1',
      identity,
      binding,
      selectedSkuKeys: ['sku-1', 'sku-2'],
      candidateMediaKeys: ['media-1', 'media-2'],
    });
    const second = createExtensionHostedAiImagePlanBindingRecord({
      planId: 'plan-2',
      identity: { ...identity, deviceSessionId: 'session-2' },
      binding,
      selectedSkuKeys: ['sku-1', 'sku-2'],
      candidateMediaKeys: ['media-1', 'media-2'],
    });

    expect(second.authorityHash).toBe(first.authorityHash);
    expect(second.bindingHash).not.toBe(first.bindingHash);
  });

  it('reuses one initial plan identity across devices and client operation keys', async () => {
    const fixture = setup();

    await expect(fixture.service.create({
      identity,
      binding,
      idempotencyKey: 'client-create-operation-1',
    })).resolves.toMatchObject({ data: { plan: { id: 'plan-1' } } });
    await expect(fixture.service.create({
      identity: { ...identity, deviceSessionId: 'session-2' },
      binding,
      idempotencyKey: 'different-client-operation-2',
    })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE' });

    const createCalls = fixture.planning.createRuleBased.mock.calls as unknown as Array<[
      { idempotencyKey: string },
    ]>;
    const firstKey = createCalls[0]?.[0].idempotencyKey;
    const secondKey = createCalls[1]?.[0].idempotencyKey;
    expect(secondKey).toBe(firstKey);
    expect(fixture.bindings.bind).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['draft revision', authority({ draftRevision: 12 }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['draft version', authority({ draftVersion: 8 }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['source snapshot', authority({ snapshotId: 'snapshot-2' }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['shop', authority({ shopId: 'shop-2' }), 'HOSTED_AI_IMAGE_PLAN_FORBIDDEN'],
    ['owner', authority({ ownerUserId: 'owner-2' }), 'HOSTED_AI_IMAGE_PLAN_FORBIDDEN'],
    ['stale source', authority({ sourceCaptureCurrent: false }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    [
      'pre-media-review stage',
      authority({ draftStage: 'CATEGORY_REVIEW' }),
      'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE',
    ],
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

  it('requires the persisted plan binding to match the exact device and listing draft', async () => {
    const fixture = setup();
    fixture.bindings.get.mockResolvedValueOnce({
      ...fixture.seededBinding,
      deviceSessionId: 'session-other',
    });

    await expect(fixture.service.get({ identity, binding, planId: 'plan-1' }))
      .rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE' });
    expect(fixture.planning.getWithSourceStatus).not.toHaveBeenCalled();
  });

  it('does not adopt an unbound collect-context plan as the current listing plan', async () => {
    const fixture = setup();
    fixture.bindings.find.mockResolvedValueOnce(null);

    await expect(fixture.service.getCurrent({ identity, binding })).resolves.toMatchObject({
      replayed: false,
      data: { context: binding, plan: null },
    });
    expect(fixture.planning.getWithSourceStatus).not.toHaveBeenCalled();
    expect(fixture.planning.getCurrentByContext).not.toHaveBeenCalled();
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
