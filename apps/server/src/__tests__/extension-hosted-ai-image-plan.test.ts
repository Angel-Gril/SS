import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared';
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
  bindingSkuKeys?: string[];
  bindingMediaKeys?: string[];
} = {}) {
  const currentPlan = input.plan ?? plan();
  const seededBinding = createExtensionHostedAiImagePlanBindingRecord({
    planId: currentPlan.id,
    identity,
    binding,
    selectedSkuKeys: input.bindingSkuKeys ?? ['sku-1', 'sku-2'],
    candidateMediaKeys: input.bindingMediaKeys ?? ['media-1', 'media-2'],
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
    adoptSessionSuccessor: vi.fn(async (): Promise<typeof seededBinding | null> => null),
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
  it('freezes an explicit eligible reference subset while retaining the full authority binding', async () => {
    const current = plan();
    const fixture = setup({ plan: current });
    const frozen = current.currentVersion!.inputSnapshot as Record<string, unknown>;
    frozen.candidates = [{ id: 'media-1' }];
    frozen.referenceSelection = { authorityCandidateMediaHash: fixture.seededBinding.candidateMediaHash };
    await fixture.service.create({ identity, binding, idempotencyKey: 'reference-choice-operation', candidateMediaKeys: ['media-1'] } as never);
    expect(fixture.planning.createRuleBased).toHaveBeenCalledWith(expect.objectContaining({
      candidateMediaKeys: ['media-1'], referenceSelectionScopeHash: fixture.seededBinding.candidateMediaHash,
    }));
    expect(fixture.bindings.bind).toHaveBeenCalledWith(fixture.seededBinding);
    await expect(fixture.service.getCurrent({ identity, binding })).resolves.toMatchObject({ data: { plan: { id: 'plan-1' } } });
    frozen.referenceSelection = { authorityCandidateMediaHash: '0'.repeat(64) };
    await expect(fixture.service.getCurrent({ identity, binding })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE' });
    frozen.candidates = [{ id: 'media-1' }, { id: 'media-2' }];
    await expect(fixture.service.getCurrent({ identity, binding })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE' });
  });

  it('preserves source references without exposing their URLs and is accepted by the shipped MV3 client', async () => {
    const mediaKey = 'media:image|product_main|0|https://cbu01.alicdn.com/img/source.jpg';
    const base = version();
    const basePayload = base.planPayload as Record<string, unknown>;
    const baseSlots = basePayload.slots as Array<Record<string, unknown>>;
    const current = plan({
      currentVersion: version({
        planPayload: {
          ...basePayload,
          slots: [{
            ...baseSlots[0],
            references: [{ candidateId: mediaKey, evidenceIds: ['evidence-1'] }],
          }],
        },
      }),
    });
    const fixture = setup({ plan: current });
    const response = await fixture.service.getCurrent({ identity, binding });
    expect(response).toMatchObject({ data: { plan: { currentVersion: { slots: [{
      references: [{ candidateId: expect.stringMatching(/^media-key-sha256:[a-f0-9]{64}$/u) }],
    }] } } } });
    expect(JSON.stringify(response)).not.toContain('https:');
    const sandbox: Record<string, any> = { Date, JSON, URL, URLSearchParams, setTimeout, clearTimeout };
    runInNewContext(readFileSync(new URL('../../../../extensions/ss-erp/shared/hosted/ai-image-suite-workbench-client.js', import.meta.url), 'utf8'), sandbox);
    const client = sandbox.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT.createClient({
      transport: { get: async () => ({ state: 'response', body: { code: 1, ...response } }), post: vi.fn() },
      listingClient: { getAiImageSuite: vi.fn(), executeAiImageSuiteCommand: vi.fn() },
      adapter: { project: vi.fn() }, previewBridge: { open: vi.fn(), revoke: vi.fn() },
    });
    await expect(client.getCurrentPlan(binding)).resolves.toMatchObject({ plan: { currentVersion: { slots: [{
      references: [{ candidateId: expect.stringMatching(/^media-key-sha256:[a-f0-9]{64}$/u) }],
    }] } } });
  });

  it('resolves selected source aliases to exact frozen media keys while keeping the public plan URL-free', async () => {
    const sourceKey = 'media:image|product_main|0|https://cbu01.alicdn.com/img/source.jpg';
    const alias = `media-key-sha256:${createHash('sha256').update(sourceKey).digest('hex')}`;
    const mediaKeys = [sourceKey, 'media-2'].sort();
    const current = plan();
    const fixture = setup({
      plan: current,
      authority: authority({ candidateMediaKeys: mediaKeys }),
      bindingMediaKeys: mediaKeys,
    });
    const frozen = current.currentVersion!.inputSnapshot as Record<string, unknown>;
    frozen.candidates = [{ id: sourceKey }];
    frozen.referenceSelection = { authorityCandidateMediaHash: fixture.seededBinding.candidateMediaHash };
    (current.currentVersion!.planPayload as any).slots[0].references = [{ candidateId: sourceKey }];

    const result = await fixture.service.create({
      identity, binding, idempotencyKey: 'source-alias-selection', candidateMediaKeys: [alias],
    });
    expect(fixture.planning.createRuleBased).toHaveBeenCalledWith(expect.objectContaining({
      candidateMediaKeys: [sourceKey],
      referenceSelectionScopeHash: fixture.seededBinding.candidateMediaHash,
    }));
    expect(fixture.bindings.bind).toHaveBeenCalledWith(fixture.seededBinding);
    expect(result).toMatchObject({ data: { plan: { currentVersion: { slots: [{
      references: [{ candidateId: alias }],
    }] } } } });
    expect(JSON.stringify(result)).not.toContain('https:');
    await expect(fixture.service.getCurrent({ identity, binding })).resolves.toMatchObject({
      data: { plan: { id: 'plan-1' } },
    });

    fixture.planning.createRuleBased.mockResolvedValueOnce({ plan: current, replayed: true });
    await expect(fixture.service.create({
      identity, binding, idempotencyKey: 'source-alias-replay', candidateMediaKeys: [alias],
    })).resolves.toMatchObject({ replayed: true });
    expect(fixture.planning.createRuleBased.mock.calls[1]![0])
      .toEqual(fixture.planning.createRuleBased.mock.calls[0]![0]);
  });

  it.each([
    ['unknown alias', ['media-key-sha256:' + '0'.repeat(64)]],
    ['other snapshot alias', [`media-key-sha256:${createHash('sha256').update('media:image|product_main|0|https://cbu01.alicdn.com/img/other-snapshot.jpg').digest('hex')}`]],
    ['unselected SKU alias', [`media-key-sha256:${createHash('sha256').update('media:image|sku_main|1|https://cbu01.alicdn.com/img/other-sku.jpg').digest('hex')}`]],
    ['raw structured URL', ['media:image|product_main|0|https://cbu01.alicdn.com/img/source.jpg']],
    ['direct URL', ['https://cbu01.alicdn.com/img/source.jpg']],
    ['over-limit selection', Array.from({ length: 26 }, (_, index) => `media-${index}`)],
  ])('rejects %s before resolving or invoking planning', async (_label, candidateMediaKeys) => {
    const sourceKey = 'media:image|product_main|0|https://cbu01.alicdn.com/img/source.jpg';
    const fixture = setup({ authority: authority({ candidateMediaKeys: [sourceKey] }) });
    await expect(fixture.service.create({
      identity, binding, idempotencyKey: 'invalid-source-selection', candidateMediaKeys,
    } as never)).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST' });
    expect(fixture.planning.createRuleBased).not.toHaveBeenCalled();
    expect(fixture.bindings.bind).not.toHaveBeenCalled();
  });

  it('rejects duplicate or ambiguous source aliases before planning', async () => {
    const sourceKey = 'media:image|product_main|0|https://cbu01.alicdn.com/img/source.jpg';
    const alias = `media-key-sha256:${createHash('sha256').update(sourceKey).digest('hex')}`;
    for (const [mediaKeys, selectedKeys] of [
      [[sourceKey], [alias, alias]],
      [[sourceKey, alias], [alias]],
    ]) {
      const fixture = setup({ authority: authority({ candidateMediaKeys: mediaKeys }) });
      await expect(fixture.service.create({
        identity, binding, idempotencyKey: 'ambiguous-source-selection', candidateMediaKeys: selectedKeys,
      })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST' });
      expect(fixture.planning.createRuleBased).not.toHaveBeenCalled();
      expect(fixture.bindings.bind).not.toHaveBeenCalled();
    }
  });

  it.each([[], ['media-attacker'], ['media-1', 'media-1'], ['https://private.example'], null].map((value) => [value]))(
    'rejects invalid or ineligible explicit reference keys %j before planning', async (candidateMediaKeys) => {
      const fixture = setup();
      await expect(fixture.service.create({ identity, binding, idempotencyKey: 'reference-choice-operation', candidateMediaKeys } as never))
        .rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST' });
      expect(fixture.planning.createRuleBased).not.toHaveBeenCalled();
    },
  );
  it.each([
    'CATEGORY_REVIEW', 'ATTRIBUTE_REVIEW', 'CONTENT_REVIEW',
    'MEDIA_REVIEW', 'PRICING_REVIEW', 'VALIDATION',
  ] as const)('reads, creates, and reviews an exact active %s draft plan', async (draftStage) => {
    const fixture = setup({ authority: authority({ draftStage }) });
    fixture.bindings.find.mockResolvedValueOnce(null);

    await expect(fixture.service.getCurrent({ identity, binding })).resolves.toMatchObject({
      data: { context: binding, plan: null },
    });
    await expect(fixture.service.create({
      identity, binding, idempotencyKey: 'early-draft-plan-create', galleryGoals: ['scene'],
    })).resolves.toMatchObject({ data: { plan: { id: 'plan-1' } } });
    await expect(fixture.service.getCurrent({ identity, binding })).resolves.toMatchObject({
      data: { plan: { id: 'plan-1' } },
    });
    await expect(fixture.service.get({ identity, binding, planId: 'plan-1' })).resolves.toMatchObject({
      data: { plan: { id: 'plan-1' } },
    });
    await fixture.service.review({
      identity, binding, planId: 'plan-1', expectedRevision: 3,
      operationKey: 'early-draft-plan-review', decision: 'APPROVE', note: null,
    });
    expect(fixture.planning.createRuleBased).toHaveBeenCalledOnce();
    expect(fixture.planning.review).toHaveBeenCalledOnce();
  });

  it('adopts an approved same-device successor for an existing suite binding', async () => {
    const fixture = setup();
    fixture.bindings.find.mockResolvedValueOnce(null);
    fixture.bindings.adoptSessionSuccessor.mockResolvedValueOnce(fixture.seededBinding);

    await expect(fixture.service.getCurrent({ identity, binding })).resolves.toMatchObject({
      data: { plan: { id: 'plan-1' } },
    });
    expect(fixture.bindings.adoptSessionSuccessor).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: identity.ownerUserId,
      deviceSessionId: identity.deviceSessionId,
      listingWorkflowId: binding.listingWorkflowId,
    }));
  });

  it('preserves verified product-only SKU and media authority in an early draft plan', async () => {
    const baseVersion = version();
    const productVersion = version({
      inputSnapshot: {
        ...(baseVersion.inputSnapshot as Record<string, unknown>),
        skus: [{ skuKey: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY }],
      },
      planPayload: {
        slots: [{
          slotKey: `sku:${SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY}:hero`,
          goal: 'sku_hero', status: 'READY', aspectRatio: '3:4',
          ownership: { level: 'sku', key: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY },
          references: [{ candidateId: 'media-1' }],
        }],
      },
    });
    const fixture = setup({
      authority: authority({
        draftStage: 'CATEGORY_REVIEW',
        selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
        capturedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      }),
      bindingSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      plan: plan({ currentVersion: productVersion }),
    });

    await expect(fixture.service.create({
      identity, binding, idempotencyKey: 'product-only-plan-create', galleryGoals: ['scene'],
    })).resolves.toMatchObject({ data: { plan: { id: 'plan-1' } } });
    expect(fixture.planning.createRuleBased).toHaveBeenCalledWith(expect.objectContaining({
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      candidateMediaKeys: ['media-1', 'media-2'], galleryGoals: ['scene'],
    }));
    await expect(fixture.service.getCurrent({ identity, binding })).resolves.toMatchObject({
      data: { plan: { currentVersion: { slots: [{ ownership: { key: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } }] } } },
    });
  });

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

  it('forwards explicit hero-only goals and retains the bound initial-plan identity', async () => {
    const fixture = setup();
    await fixture.service.create({ identity, binding, idempotencyKey: 'hero-only-operation-1', galleryGoals: [] });
    const first = fixture.planning.createRuleBased.mock.calls[0]![0];
    expect(first.galleryGoals).toEqual([]);
    fixture.planning.createRuleBased.mockRejectedValueOnce(new AiMediaPlanningError(
      'AI_MEDIA_PLANNING_IDEMPOTENCY_CONFLICT', 'Different frozen goals', 409,
    ));
    await expect(fixture.service.create({ identity, binding, idempotencyKey: 'another-main-operation' }))
      .rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_REQUEST_CONFLICT' });
    const second = fixture.planning.createRuleBased.mock.calls[1]![0];
    expect(second).not.toHaveProperty('galleryGoals');
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(fixture.bindings.bind).toHaveBeenCalledTimes(1);
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

  it('forwards creative direction without creating another plan identity when it changes', async () => {
    const fixture = setup();
    const request = { identity, binding, idempotencyKey: 'client-brief-operation-1' };
    const creativeBrief = { prompt: '浅灰背景，柔和侧光', negativePrompt: '不要道具' };
    await fixture.service.create({ ...request, creativeBrief });
    const first = fixture.planning.createRuleBased.mock.calls[0]![0] as unknown as { idempotencyKey: string; creativeBrief: unknown };
    expect(first.creativeBrief).toEqual(creativeBrief);
    fixture.planning.createRuleBased.mockRejectedValueOnce(new AiMediaPlanningError(
      'AI_MEDIA_PLANNING_IDEMPOTENCY_CONFLICT', 'Different frozen brief', 409,
    ));
    await expect(fixture.service.create({ ...request, creativeBrief: { prompt: '暖色背景' } }))
      .rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_PLAN_REQUEST_CONFLICT' });
    expect((fixture.planning.createRuleBased.mock.calls[1]![0] as unknown as { idempotencyKey: string }).idempotencyKey).toBe(first.idempotencyKey);
    expect(fixture.bindings.bind).toHaveBeenCalledTimes(1);
  });


  it.each([null, ['scene', 'scene'], ['hero'], ['SCENE'], 'scene', ['scene', 1]].map((value) => [value]))(
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
      'ready-to-publish stage',
      authority({ draftStage: 'READY_TO_PUBLISH' }),
      'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE',
    ],
    ['publish intent', authority({ draftStage: 'PUBLISH_INTENT_RECORDED' }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['published stage', authority({ draftStage: 'PUBLISHED' }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
    ['inactive workflow', authority({ workflowStatus: 'CANCELLED' }), 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'],
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
    authority({ selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY] }),
    authority({ selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY], capturedSkuKeys: [] }),
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
