import { describe, expect, it, vi } from 'vitest';
import {
  buildRuleBasedAiMediaPlanningArtifacts,
  resolveRuleBasedAiMediaPlanningInput,
} from '../services/ai-media-planning.js';
import {
  AI_IMAGE_SUITE_MAX_COST_CENTS,
  AiImageSuiteError,
  createAiImageSuitePreview,
  createAiImageSuiteService,
  type AiImageSuitePlanAuthority,
} from '../services/ai-image-suite.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
} from '../services/ai-image-provider-capabilities.js';

function reference(candidateId = 'media-1') {
  return { candidateId, evidenceIds: [`evidence:${candidateId}`] };
}

function slot(
  slotKey: string,
  ownership: { level: 'sku' | 'compatibility_group'; key: string },
  goal: string,
) {
  return {
    slotKey,
    goal,
    status: 'READY',
    aspectRatio: '3:4',
    ownership,
    references: [reference()],
    factEvidenceIds: [],
    safetyConstraints: ['preserve_product_identity'],
    acceptanceChecks: ['product_matches_references'],
  };
}

function authority(overrides: Partial<AiImageSuitePlanAuthority> = {}): AiImageSuitePlanAuthority {
  const groups = [{ groupKey: 'group-1', identitySignature: '{}', skuKeys: ['sku-1'] }];
  const slots = [slot('sku:sku-1:hero', { level: 'sku', key: 'sku-1' }, 'sku_hero')];
  for (let index = 1; index <= 7; index += 1) {
    slots.push(slot(
      `group:group-1:gallery:${index}`,
      { level: 'compatibility_group', key: 'group-1' },
      `gallery_${index}`,
    ));
  }
  return {
    planId: 'plan-1',
    planVersionId: 'version-1',
    planRevision: 2,
    planHash: 'f'.repeat(64),
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    contextType: 'collect',
    contextId: 'goods-1',
    inputSnapshot: {
      candidates: [{
        id: 'media-1', url: 'https://source.example/media.png', width: 900, height: 1200,
        mimeType: 'image/png', role: 'product_main', skuKeys: ['sku-1'],
        contentHash: null,
      }],
    },
    planPayload: { compatibilityGroups: groups, slots },
    ...overrides,
  };
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    provider: AI_IMAGE_SUITE_PROVIDER,
    model: AI_IMAGE_SUITE_MODEL,
    providerConfigHash: '9'.repeat(64),
    pricingVersion: 'fake-pricing/v1',
    estimatedCostPerImageCents: 3,
    maximumCostPerImageCents: 5,
    concurrencyLimit: 2,
    ...overrides,
  };
}

describe('AI image suite preview', () => {
  it('previews exactly one hero and seven gallery jobs with bounded maximum cost', () => {
    const preview = createAiImageSuitePreview(authority(), provider());

    expect(preview).toMatchObject({
      itemCount: 8,
      estimatedCostCents: 24,
      maximumCostCents: 40,
      previewHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(preview.slots.filter((item) => item.goal === 'sku_hero')).toHaveLength(1);
    expect(preview.slots.filter((item) => item.goal.startsWith('gallery_'))).toHaveLength(7);
    expect(preview.slots.map((item) => item.goal)).toEqual([
      'sku_hero', 'gallery_1', 'gallery_2', 'gallery_3',
      'gallery_4', 'gallery_5', 'gallery_6', 'gallery_7',
    ]);
  });

  it('is deterministic and preserves canonical 1024-character slot identities', () => {
    const longSku = 's'.repeat(500);
    const longSlotKey = `sku:${longSku}:hero`;
    const value = authority({
      planPayload: {
        compatibilityGroups: [],
        slots: [slot(longSlotKey, { level: 'sku', key: longSku }, 'sku_hero')],
      },
    });
    const first = createAiImageSuitePreview(value, provider());
    const second = createAiImageSuitePreview(value, provider());

    expect(second).toEqual(first);
    expect(first.slots[0]?.slotKey).toBe(longSlotKey);
    expect(first.slots[0]?.slotKey.length).toBe(509);
  });

  it('rejects manual, duplicate, unknown and capability-incompatible references', () => {
    const manual = authority();
    (manual.planPayload as any).slots[0].status = 'MANUAL_REQUIRED';
    expect(() => createAiImageSuitePreview(manual, provider())).toThrow(AiImageSuiteError);

    const duplicate = authority();
    (duplicate.planPayload as any).slots[0].references.push(reference());
    expect(() => createAiImageSuitePreview(duplicate, provider())).toThrow(/duplicate references/u);

    const unknown = authority();
    (unknown.planPayload as any).slots[0].references = [reference('missing-media')];
    expect(() => createAiImageSuitePreview(unknown, provider())).toThrow(/frozen input/u);

    const tooMany = authority();
    (tooMany.inputSnapshot as any).candidates = Array.from({ length: 6 }, (_, index) => ({
      id: `media-${index + 1}`, url: `https://source.example/${index + 1}.png`, width: 900, height: 1200,
      mimeType: 'image/png', role: 'product_main', skuKeys: ['sku-1'],
      contentHash: null,
    }));
    (tooMany.planPayload as any).slots[0].references = Array.from({ length: 6 }, (_, index) => reference(`media-${index + 1}`));
    expect(() => createAiImageSuitePreview(tooMany, provider())).toThrow(/inputs do not satisfy/u);
  });

  it('deterministically freezes one ordered reference for an exact single-reference Provider', () => {
    const value = authority();
    (value.inputSnapshot as any).candidates = Array.from({ length: 5 }, (_, index) => ({
      id: `media-${index + 1}`,
      url: `https://source.example/${index + 1}.jpg`,
      width: 900,
      height: 1200,
      mimeType: 'image/jpeg',
      role: 'product_main',
      skuKeys: ['sku-1'],
      contentHash: null,
    }));
    (value.planPayload as any).slots.forEach((item: any) => {
      item.references = Array.from(
        { length: 5 },
        (_, index) => reference(`media-${index + 1}`),
      );
    });

    const preview = createAiImageSuitePreview(value, provider({
      provider: 'dashscope-wanx',
      model: 'wanx2.1-imageedit',
      pricingVersion: `ai-image-suite-price-cny/v1:${'c'.repeat(32)}`,
      estimatedCostPerImageCents: 14,
      maximumCostPerImageCents: 14,
    }));

    expect(preview.maximumCostCents).toBe(112);
    expect(preview.slots.every((item) => item.references.length === 1)).toBe(true);
    expect(preview.slots.every((item) => item.references[0]?.candidateId === 'media-1')).toBe(true);
    expect(preview.slots.every((item) => (
      Array.isArray(item.slotSnapshot.references)
      && item.slotSnapshot.references.length === 1
    ))).toBe(true);
  });

  it('requires a positive verified price for paid provider configuration', () => {
    expect(() => createAiImageSuitePreview(authority(), provider({
      provider: 'paid-provider', model: 'paid-model', estimatedCostPerImageCents: 0,
      maximumCostPerImageCents: 0,
    }))).toThrow(/positive maximum price/u);
  });

  it('rejects per-image and aggregate costs outside PostgreSQL integer bounds', () => {
    expect(() => createAiImageSuitePreview(authority(), provider({
      estimatedCostPerImageCents: AI_IMAGE_SUITE_MAX_COST_CENTS + 1,
      maximumCostPerImageCents: AI_IMAGE_SUITE_MAX_COST_CENTS + 1,
    }))).toThrow(/estimatedCostPerImageCents is invalid/u);

    expect(() => createAiImageSuitePreview(authority(), provider({
      estimatedCostPerImageCents: 300_000_000,
      maximumCostPerImageCents: 300_000_000,
    }))).toThrow(/cost exceeds integer limits/u);
  });

  it('previews through a read-only repository path without claiming or creating jobs', async () => {
    const repository = {
      loadApprovedAuthority: vi.fn(async () => authority()),
      claimApproved: vi.fn(),
      getOwned: vi.fn(),
      getCurrentOwnedByPlan: vi.fn(),
      getActiveOwnedByPlan: vi.fn(),
    };
    const service = createAiImageSuiteService(repository as never);

    const preview = await service.preview({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', planId: 'plan-1', providerConfig: provider(),
    });

    expect(preview.itemCount).toBe(8);
    expect(repository.claimApproved).not.toHaveBeenCalled();
  });

  it('expands the exact frozen artifact produced by the rule-based planner', () => {
    const evidence = (value: string) => ({
      value,
      sourceType: 'network' as const,
      sourcePath: '/trusted/source',
      confidence: 1,
      isEstimated: false,
      missingReason: null,
      observedAt: '2026-07-18T00:00:00.000Z',
      parserVersion: 'test',
      derivedFrom: [],
    });
    const sourceAuthority = {
      sourceCaptureHash: 'a'.repeat(64),
      sourceProfileHash: 'b'.repeat(64),
      sourceSchemaVersion: 'source-product-capture-v2',
      capture: {
        captureVersion: 'source-product-capture-v2',
        facts: { title: 'Insulated bottle' },
        fieldEvidence: { title: evidence('Insulated bottle') },
        skus: [{
          key: 'red-single',
          attributes: [{
            name: 'Color', value: 'Red',
            fieldEvidence: { name: evidence('Color'), value: evidence('Red') },
          }],
        }],
        media: [{
          key: 'main-1', kind: 'image', disposition: 'accepted',
          url: 'https://source.example/main-1.png', width: 900, height: 1200,
          mimeType: 'image/png', role: 'product_main', skuKeys: ['red-single'],
        }],
      },
    };
    const planningRequest = {
      ownerUserId: 'owner-1', actorUserId: 'owner-1',
      sourceSubjectId: 'subject-1', sourceCaptureSnapshotId: 'snapshot-1',
      context: { type: 'collect' as const, id: 'goods-1' },
      idempotencyKey: 'rule-plan-suite-artifact',
      selectedSkuKeys: ['red-single'], candidateMediaKeys: ['main-1'],
    };
    const artifacts = buildRuleBasedAiMediaPlanningArtifacts(
      resolveRuleBasedAiMediaPlanningInput(planningRequest, sourceAuthority as never),
    );

    const preview = createAiImageSuitePreview({
      ...authority(),
      planHash: artifacts.planHash,
      sourceCaptureHash: artifacts.sourceCaptureHash,
      sourceProfileHash: artifacts.sourceProfileHash,
      sourceSchemaVersion: artifacts.sourceSchemaVersion,
      inputSnapshot: artifacts.inputSnapshot,
      planPayload: artifacts.plan,
    }, provider());

    expect(preview.itemCount).toBe(8);
    expect(preview.slots.every((item) => item.references[0]?.source.contentHash === null)).toBe(true);
    expect(preview.slots.every((item) => item.references[0]?.candidateId === 'main-1')).toBe(true);
  });

  it('maps rejected or otherwise unavailable authority to not approved without claiming', async () => {
    const repository = {
      loadApprovedAuthority: vi.fn(async () => null),
      claimApproved: vi.fn(),
      getOwned: vi.fn(),
      getCurrentOwnedByPlan: vi.fn(),
      getActiveOwnedByPlan: vi.fn(),
    };
    const service = createAiImageSuiteService(repository as never);

    await expect(service.preview({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', planId: 'rejected-plan',
      providerConfig: provider(),
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_NOT_APPROVED',
      statusCode: 409,
    });
    expect(repository.claimApproved).not.toHaveBeenCalled();
  });

  it('maps another actionable plan-version suite to a stable typed conflict', async () => {
    const repository = {
      loadApprovedAuthority: vi.fn(),
      claimApproved: vi.fn(async () => ({
        kind: 'active-suite-conflict' as const,
        suite: null,
      })),
      getOwned: vi.fn(),
      getCurrentOwnedByPlan: vi.fn(),
      getActiveOwnedByPlan: vi.fn(),
    };
    const service = createAiImageSuiteService(repository as never);
    const expectedPreviewHash = createAiImageSuitePreview(authority(), provider()).previewHash;

    await expect(service.claim({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      planId: 'plan-1',
      expectedPlanRevision: 2,
      idempotencyKey: 'suite-active-plan-conflict',
      expectedPreviewHash,
      providerConfig: provider(),
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT',
      statusCode: 409,
    });
  });

  it('reads the current suite by exact owner and plan without converting an empty result to an error', async () => {
    const current = {
      id: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      planId: 'plan-1', planVersionId: 'version-1', status: 'PLANNED', revision: 1,
      previewHash: 'a'.repeat(64), itemCount: 1, estimatedCostCents: 0, maximumCostCents: 0,
      slots: [], createdAt: new Date(), updatedAt: new Date(),
    };
    const repository = {
      loadApprovedAuthority: vi.fn(),
      claimApproved: vi.fn(),
      getOwned: vi.fn(),
      getCurrentOwnedByPlan: vi.fn()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(null),
      getActiveOwnedByPlan: vi.fn().mockResolvedValueOnce(current),
    };
    const service = createAiImageSuiteService(repository as never);

    await expect(service.getCurrentByPlan('plan-1', 'owner-1')).resolves.toEqual(current);
    await expect(service.getCurrentByPlan('plan-2', 'owner-1')).resolves.toBeNull();
    expect(repository.getCurrentOwnedByPlan).toHaveBeenNthCalledWith(1, 'plan-1', 'owner-1');
    expect(repository.getCurrentOwnedByPlan).toHaveBeenNthCalledWith(2, 'plan-2', 'owner-1');
    await expect(service.getActiveByPlan('plan-1', 'owner-1')).resolves.toEqual(current);
    expect(repository.getActiveOwnedByPlan).toHaveBeenCalledWith('plan-1', 'owner-1');
  });
});
