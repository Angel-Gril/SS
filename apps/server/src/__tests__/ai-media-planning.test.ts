import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared';
import {
  buildRuleBasedAiMediaPlanningArtifacts,
  createAiMediaPlanningService,
  hashAiMediaPlanningJson,
  resolveRuleBasedAiMediaPlanningInput,
  type AiMediaPlanningAuthority,
  type CreateRuleBasedAiMediaPlanningInput,
} from '../services/ai-media-planning.js';
import { processRuleBasedAiMediaPlanning } from '../workers/ai-media-planning.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { sourceListingEditorSkuKeysForDraft } from '../services/source-listing-sku-copies.js';

function planningInput(): CreateRuleBasedAiMediaPlanningInput {
  return {
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    context: { type: 'collect', id: 'goods-1' },
    idempotencyKey: 'rule-plan-1',
    selectedSkuKeys: ['red-single'],
    candidateMediaKeys: ['main-1'],
  };
}

function authority(): AiMediaPlanningAuthority {
  const evidence = (value: string) => ({
    value,
    sourceType: 'network',
    sourcePath: '/trusted/source',
    confidence: 1,
    isEstimated: false,
    missingReason: null,
    observedAt: '2026-07-18T00:00:00.000Z',
    parserVersion: 'test',
    derivedFrom: [],
  });
  return {
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
          name: 'Color',
          value: 'Red',
          fieldEvidence: { name: evidence('Color'), value: evidence('Red') },
        }],
      }],
      media: [{
        key: 'main-1',
        kind: 'image',
        disposition: 'accepted',
        url: 'https://source.example/main-1.png',
        width: 900,
        height: 1200,
        mimeType: 'image/png',
        role: 'product_main',
        skuKeys: ['red-single'],
      }],
    } as never,
  };
}

describe('AI media planning rule worker', () => {
  it('preserves every captured SKU owner of a shared image while planning only the selected SKU', () => {
    const source = authority();
    source.capture.skus.push({ ...structuredClone(source.capture.skus[0]!), key: 'red-large' });
    source.capture.media[0]!.skuKeys = ['red-single', 'red-large'];
    const original = structuredClone(source.capture);
    const resolved = resolveRuleBasedAiMediaPlanningInput({ ...planningInput(), galleryGoals: ['scene'] }, source);
    const result = buildRuleBasedAiMediaPlanningArtifacts(resolved);
    expect((result.inputSnapshot.candidates as any[])[0].skuKeys).toEqual(['red-single', 'red-large']);
    expect(result.plan.slots.filter(slot => slot.ownership.level === 'sku').map(slot => slot.ownership.key)).toEqual(['red-single']);
    expect(result.plan.slots).toHaveLength(2);
    expect(source.capture).toEqual(original);
  });
  it('resolves copied offers only through internal current-draft authority, keeping the original capture hash and immutable capture', async () => {
    const source = authority(); source.capture.skus[0]!.mediaKeys = ['main-1'];
    const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
    const initial = await workflow.createDraft({ ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
      sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: source.sourceCaptureHash, selectedSkuKeys: ['red-single'] });
    const draft = await workflow.duplicateSku({ ownerUserId: 'owner-1', actorUserId: 'owner-1', draftId: initial.id,
      expectedRevision: initial.revision, expectedDraftVersion: initial.draftVersion, operationKey: 'planner-copy-operation', sourceSkuKey: 'red-single' });
    const repository = { loadRulePlanningAuthority: vi.fn().mockResolvedValue(source), createRulePlan: vi.fn().mockResolvedValue({ kind: 'created', plan: { id: 'new-copy-plan' } }) };
    const service = createAiMediaPlanningService(repository as never, { sourcePreparation: false, loadListingDraft: workflow.getDraft });
    const input = { ...planningInput(), selectedSkuKeys: sourceListingEditorSkuKeysForDraft(draft),
      listingDraftContext: { id: draft.id, revision: draft.revision, draftVersion: draft.draftVersion } };
    await service.createRuleBased(input);
    const compiled = repository.createRulePlan.mock.calls[0]![0];
    expect(compiled.sourceCaptureHash).toBe(source.sourceCaptureHash);
    expect(compiled.plan.slots.some((slot: any) => slot.ownership.key === draft.offerRows!.rows[0]!.rowKey)).toBe(true);
    expect(source.capture.skus).toHaveLength(1);
    await expect(service.createRuleBased({ ...input, listingDraftContext: { ...input.listingDraftContext, revision: 99 } })).rejects.toMatchObject({ statusCode: 409 });
    await expect(createAiMediaPlanningService(repository as never, { sourcePreparation: false }).createRuleBased(input)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('freezes hero-only goals separately from omitted default goals without generating gallery slots', () => {
    const build = (galleryGoals?: []) => buildRuleBasedAiMediaPlanningArtifacts(resolveRuleBasedAiMediaPlanningInput({
      ...planningInput(), ...(galleryGoals === undefined ? {} : { galleryGoals }),
    }, authority()));
    const mainOnly = build([]);
    const original = build();
    expect(mainOnly.plan.slots.map((slot) => [slot.slotKey, slot.goal])).toEqual([['sku:red-single:hero', 'sku_hero']]);
    expect(mainOnly.inputSnapshot.galleryGoals).toEqual([]);
    expect(original.inputSnapshot.galleryGoals).toBeNull();
    expect(original.plan.slots).toHaveLength(8);
    expect(mainOnly.requestFingerprint).not.toBe(original.requestFingerprint);
    expect(mainOnly.planHash).not.toBe(original.planHash);
    expect(build([])).toEqual(mainOnly);
  });

  it.each([null, ['unknown'], ['scene', 'scene'], ['SCENE'], 'scene', ['scene', 1], Array(8).fill('scene')].map((value) => [value]))(
    'rejects invalid gallery goals %j before freezing a plan', (galleryGoals) => {
      expect(() => resolveRuleBasedAiMediaPlanningInput({ ...planningInput(), galleryGoals } as never, authority()))
        .toThrow(/galleryGoals/u);
    },
  );

  it('persists the server-owned reference scope seal only when explicit references were selected', () => {
    const first = buildRuleBasedAiMediaPlanningArtifacts(resolveRuleBasedAiMediaPlanningInput({
      ...planningInput(), referenceSelectionScopeHash: 'a'.repeat(64),
    } as never, authority()));
    expect(first.inputSnapshot.referenceSelection).toEqual({ authorityCandidateMediaHash: 'a'.repeat(64) });
    const original = buildRuleBasedAiMediaPlanningArtifacts(resolveRuleBasedAiMediaPlanningInput(planningInput(), authority()));
    expect(original.inputSnapshot).not.toHaveProperty('referenceSelection');
    expect(first.inputHash).not.toBe(original.inputHash);
  });
  it('freezes creative direction separately from facts and binds changes to the request', () => {
    const build = (creativeBrief?: { prompt: string; negativePrompt?: string }) => buildRuleBasedAiMediaPlanningArtifacts(
      resolveRuleBasedAiMediaPlanningInput({ ...planningInput(), ...(creativeBrief ? { creativeBrief } : {}) }, authority()),
    );
    const original = build();
    const brief = { prompt: '浅灰背景，柔和侧光', negativePrompt: '不要装饰道具' };
    const first = build(brief);
    const changed = build({ ...brief, prompt: '暖色背景' });
    expect(first.inputSnapshot.creativeBrief).toEqual(brief);
    expect(first.plan).toMatchObject({ creativeBrief: brief });
    expect(first.plan.verifiedFacts).toEqual(original.plan.verifiedFacts);
    expect(first.plan.slots).toEqual(original.plan.slots);
    expect(first.requestFingerprint).not.toBe(original.requestFingerprint);
    expect(changed.requestFingerprint).not.toBe(first.requestFingerprint);
    expect(changed.planHash).not.toBe(first.planHash);
    expect(original.inputSnapshot).not.toHaveProperty('creativeBrief');
    expect(original.plan).not.toHaveProperty('creativeBrief');
    expect(build()).toEqual(original);
  });

  it.each([null, {}, { prompt: '' }, { prompt: 'x'.repeat(301) },
    { prompt: 'scene', negativePrompt: 'x'.repeat(151) }, { prompt: 'scene', apiKey: 'private' },
    { prompt: 'https://private.example' }, { prompt: 'Authorization: Bearer secret' },
    { prompt: 'scene\u0000' }])('rejects invalid creative direction %j before persistence', (creativeBrief) => {
    expect(() => resolveRuleBasedAiMediaPlanningInput({ ...planningInput(), creativeBrief } as never, authority())).toThrow();
  });

  it('uses a locale-independent canonical hash order', () => {
    expect(hashAiMediaPlanningJson({ 'é': 1, Z: 2, '中': 3, a: 4 }))
      .toBe('60ae282b935f7056a4e8ff69d5fff3720d0b2231e5f6fa4141239d85b10b2534');
  });

  it('builds bounded provider-free artifacts with stable hashes', () => {
    const resolved = resolveRuleBasedAiMediaPlanningInput(planningInput(), authority());
    const first = buildRuleBasedAiMediaPlanningArtifacts(resolved);
    const second = buildRuleBasedAiMediaPlanningArtifacts(resolved);

    expect(second).toEqual(first);
    expect(first.curation.mode).toBe('deterministic');
    expect(first.visionEvidence).toMatchObject({
      mode: 'fallback',
      fallbackReason: 'INVALID_MODEL_OUTPUT',
    });
    expect(first.plan).toMatchObject({
      mode: 'rule_based',
      recoverable: true,
      manualSelectionAllowed: true,
    });
    expect(first.plan.slots).toHaveLength(8);
    expect(first.plan.slots.every((slot) => slot.references.length === 1)).toBe(true);
    for (const hash of [
      first.requestFingerprint,
      first.inputFingerprint,
      first.inputHash,
      first.curationHash,
      first.visionEvidenceHash,
      first.planHash,
      first.provenanceHash,
    ]) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('persists through the rule repository without importing queues, providers, prompts or costs', async () => {
    const sourceBuffer = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: '#cfdeed' },
    }).png().toBuffer();
    const sourceSha256 = createHash('sha256').update(sourceBuffer).digest('hex');
    const resolved = resolveRuleBasedAiMediaPlanningInput(planningInput(), authority());
    const artifacts = buildRuleBasedAiMediaPlanningArtifacts(
      { ...resolved, candidates: resolved.candidates.map((candidate) => ({ ...candidate, contentHash: sourceSha256 })) },
    );
    const repository = {
      loadRulePlanningAuthority: vi.fn().mockResolvedValue(authority()),
      loadLatestSourceAuthority: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-1', captureHash: authority().sourceCaptureHash,
        profileHash: authority().sourceProfileHash, schemaVersion: authority().sourceSchemaVersion,
      }),
      findPlanningSourceAssets: vi.fn().mockResolvedValue([{
        id: 'source-asset-1', ownerUserId: 'owner-1', kind: 'SOURCE_ORIGINAL',
        sourceCaptureSnapshotId: 'snapshot-1', sourceMediaKey: 'main-1',
        sourceUrl: 'https://source.example/main-1.png',
        storageBackend: 'oss', storageKey: 'source/main-1.png', url: 'https://assets.example/main-1.png',
        mimeType: 'image/png', width: 900, height: 1200, sizeBytes: sourceBuffer.length,
        sha256: sourceSha256, sourceSha256,
        metadata: {
          lineageVersion: 'ai-media-source/v1', sourceCaptureHash: authority().sourceCaptureHash,
          sourceUrl: 'https://source.example/main-1.png', sourceSha256,
          sourceSizeBytes: sourceBuffer.length, sourceMimeType: 'image/png',
        },
      }]),
      createRulePlan: vi.fn().mockResolvedValue({
        kind: 'created',
        plan: { id: 'plan-1', revision: 1, reviewStatus: 'PENDING' },
      }),
    };

    const result = await processRuleBasedAiMediaPlanning(planningInput(), { repository: repository as never });

    expect(result).toMatchObject({ replayed: false, plan: { id: 'plan-1' } });
    expect(repository.loadRulePlanningAuthority).toHaveBeenCalledWith(planningInput());
    expect(repository.createRulePlan).toHaveBeenCalledWith(artifacts);
  });

  it('binds all planner-affecting source fields into the request fingerprint', () => {
    const base = buildRuleBasedAiMediaPlanningArtifacts(
      resolveRuleBasedAiMediaPlanningInput(planningInput(), authority()),
    );
    const changedAuthority = authority();
    (changedAuthority.capture.skus[0]!.attributes[0] as { value: string }).value = 'Blue';
    (changedAuthority.capture.skus[0]!.attributes[0] as any).fieldEvidence.value.value = 'Blue';
    const changed = buildRuleBasedAiMediaPlanningArtifacts(
      resolveRuleBasedAiMediaPlanningInput(planningInput(), changedAuthority),
    );

    expect(changed.requestFingerprint).not.toBe(base.requestFingerprint);
    expect(changed.planHash).not.toBe(base.planHash);
  });

  it('derives facts and media only from the authoritative source snapshot', () => {
    const request = {
      ...planningInput(),
      candidates: [{ id: 'fabricated', url: 'https://attacker.example/fake.png' }],
      verifiedFacts: [{ path: '/facts/material', value: 'Titanium', evidenceIds: ['fabricated'] }],
    } as CreateRuleBasedAiMediaPlanningInput;
    const resolved = resolveRuleBasedAiMediaPlanningInput(request, authority());

    expect(resolved.candidates.map((candidate) => candidate.id)).toEqual(['main-1']);
    expect(resolved.verifiedFacts).toEqual([expect.objectContaining({
      path: '/facts/title',
      value: 'Insulated bottle',
    }), expect.objectContaining({
      path: '/skus/red-single/attributes/0',
      value: { name: 'Color', value: 'Red' },
    })]);
    expect(resolved.verifiedFacts).not.toContainEqual(expect.objectContaining({ path: '/facts/material' }));
    expect(() => resolveRuleBasedAiMediaPlanningInput({
      ...planningInput(),
      candidateMediaKeys: ['fabricated'],
    }, authority())).toThrow(/media is not present in the source capture/u);
  });

  it('never widens media owned by an unselected SKU into a global reference', () => {
    const scopedAuthority = authority();
    scopedAuthority.capture.skus.push({ key: 'blue-single', attributes: [] } as never);
    scopedAuthority.capture.media.push({
      key: 'blue-main',
      kind: 'image',
      disposition: 'accepted',
      url: 'https://source.example/blue.png',
      width: 900,
      height: 1200,
      mimeType: 'image/png',
      role: 'sku',
      skuKeys: ['blue-single'],
    } as never);
    expect(() => resolveRuleBasedAiMediaPlanningInput({
      ...planningInput(),
      candidateMediaKeys: ['blue-main'],
    }, scopedAuthority)).toThrow(/does not belong to a selected SKU/u);

    const request = planningInput();
    delete request.candidateMediaKeys;
    const resolved = resolveRuleBasedAiMediaPlanningInput(request, scopedAuthority);
    expect(resolved.candidates.map((candidate) => candidate.id)).toEqual(['main-1']);
  });

  it('does not auto-select accepted media whose URL is not image-shaped', () => {
    const scopedAuthority = authority();
    scopedAuthority.capture.media.push({
      key: 'detail-page',
      kind: 'image',
      disposition: 'accepted',
      url: 'https://shop.example.com/page/activity.htm',
      width: null,
      height: null,
      mimeType: null,
      role: 'detail',
      skuKeys: [],
    } as never);
    const resolved = resolveRuleBasedAiMediaPlanningInput({
      ...planningInput(),
      candidateMediaKeys: undefined,
    }, scopedAuthority);
    expect(resolved.candidates.map((candidate) => candidate.id)).toEqual(['main-1']);
  });

  it('plans a stable product-only identity when the source has no explicit SKUs', () => {
    const productOnly = authority();
    productOnly.capture.skus = [];
    productOnly.capture.media[0]!.skuKeys = [];
    const request = {
      ...planningInput(),
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
    };

    const resolved = resolveRuleBasedAiMediaPlanningInput(request, productOnly);
    const artifacts = buildRuleBasedAiMediaPlanningArtifacts(resolved);

    expect(resolved.skus).toEqual([{
      skuKey: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
      attributes: [],
    }]);
    expect(artifacts.plan.compatibilityGroups).toEqual([
      expect.objectContaining({ skuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY] }),
    ]);
    expect(artifacts.plan.slots).toHaveLength(8);
    expect(artifacts.plan.slots.every((slot) => (
      slot.status === 'READY' && slot.references[0]?.candidateId === 'main-1'
    ))).toBe(true);
  });

  it('uses identity-changing attributes beyond the first fifty when grouping SKUs', () => {
    const deepAuthority = authority();
    const evidence = (value: string, path: string) => ({
      value,
      sourceType: 'network' as const,
      sourcePath: path,
      confidence: 1,
      isEstimated: false,
      missingReason: null,
      observedAt: '2026-07-18T00:00:00.000Z',
      parserVersion: 'test',
      derivedFrom: [],
    });
    deepAuthority.capture.skus = ['500 ml', '750 ml'].map((capacity, skuIndex) => ({
      key: `sku-${skuIndex}`,
      attributes: [
        ...Array.from({ length: 50 }, (_, index) => ({
          name: `Color ${index}`,
          value: 'Red',
          fieldEvidence: {
            name: evidence(`Color ${index}`, `/skus/${skuIndex}/attributes/${index}/name`),
            value: evidence('Red', `/skus/${skuIndex}/attributes/${index}/value`),
          },
        })),
        {
          name: 'Capacity',
          value: capacity,
          fieldEvidence: {
            name: evidence('Capacity', `/skus/${skuIndex}/attributes/50/name`),
            value: evidence(capacity, `/skus/${skuIndex}/attributes/50/value`),
          },
        },
      ],
    })) as never;
    const request = {
      ...planningInput(),
      selectedSkuKeys: ['sku-0', 'sku-1'],
      candidateMediaKeys: [],
    };
    const artifacts = buildRuleBasedAiMediaPlanningArtifacts(
      resolveRuleBasedAiMediaPlanningInput(request, deepAuthority),
    );

    expect(artifacts.plan.compatibilityGroups.map((group) => group.skuKeys))
      .toEqual([['sku-0'], ['sku-1']]);
  });

  it('rejects output amplification before persistence', () => {
    const largeAuthority = authority();
    largeAuthority.capture.skus = Array.from({ length: 50 }, (_, index) => ({
      key: `sku-${index}`,
      attributes: [{
        name: 'Unknown identity dimension',
        value: `value-${index}`,
        fieldEvidence: { name: {
          value: 'Unknown identity dimension',
          sourceType: 'network',
          sourcePath: `/skus/${index}/name`,
          confidence: 1,
          isEstimated: false,
          missingReason: null,
          observedAt: '2026-07-18T00:00:00.000Z',
          parserVersion: 'test',
          derivedFrom: [],
        }, value: {
          value: `value-${index}`,
          sourceType: 'network',
          sourcePath: `/skus/${index}`,
          confidence: 1,
          isEstimated: false,
          missingReason: null,
          observedAt: '2026-07-18T00:00:00.000Z',
          parserVersion: 'test',
          derivedFrom: [],
        } },
      }],
    })) as never;
    const request = {
      ...planningInput(),
      selectedSkuKeys: largeAuthority.capture.skus.map((sku) => sku.key),
      candidateMediaKeys: [],
    };

    const resolved = resolveRuleBasedAiMediaPlanningInput(request, largeAuthority);
    const attempt = () => buildRuleBasedAiMediaPlanningArtifacts({
      ...resolved,
      verifiedFacts: Array.from({ length: 32 }, (_, index) => ({
        path: `/facts/${index}`,
        value: 'x'.repeat(1_000),
        evidenceIds: [`capture:snapshot-1:evidence:${String(index).padStart(64, '0')}`],
      })),
    });
    expect(attempt).toThrow(/output exceeds the 1 MiB/u);
  });

  it('rejects invalid review identities before repository dispatch', async () => {
    const repository = { reviewCurrent: vi.fn() };
    const service = createAiMediaPlanningService(repository as never);

    await expect(service.review({
      planId: 'plan-1',
      ownerUserId: 'owner-1',
      actorUserId: '',
      expectedRevision: 1,
      operationKey: 'review-operation-1',
      decision: 'APPROVE',
      note: null,
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_INVALID_INPUT',
      statusCode: 400,
    });
    expect(repository.reviewCurrent).not.toHaveBeenCalled();
  });

  it('resolves the current owned capture before creating a provider-free plan', async () => {
    const source = authority();
    const repository = {
      resolveCurrentRulePlanningTarget: vi.fn().mockResolvedValue({
        sourceSubjectId: 'subject-current',
        sourceCaptureSnapshotId: 'snapshot-current',
        selectedSkuKeys: ['red-single'],
      }),
      loadRulePlanningAuthority: vi.fn().mockResolvedValue(source),
      createRulePlan: vi.fn().mockResolvedValue({
        kind: 'created',
        plan: {
          id: 'plan-current', revision: 1, reviewStatus: 'PENDING', staleAt: null,
          ownerUserId: 'owner-current', sourceSubjectId: 'subject-current',
          contextType: 'collect', contextId: 'goods-current',
          currentVersion: {
            sourceCaptureSnapshotId: 'snapshot-current',
            sourceCaptureHash: source.sourceCaptureHash,
            sourceProfileHash: source.sourceProfileHash,
            sourceSchemaVersion: source.sourceSchemaVersion,
          },
        },
      }),
      loadLatestSourceAuthority: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-current', captureHash: source.sourceCaptureHash,
        profileHash: source.sourceProfileHash, schemaVersion: source.sourceSchemaVersion,
      }),
    };
    const service = createAiMediaPlanningService(repository as never, { sourcePreparation: false });
    const result = await service.createCurrentRuleBased({
      ownerUserId: 'owner-current',
      actorUserId: 'actor-current',
      context: { type: 'collect', id: 'goods-current' },
      idempotencyKey: 'current-plan-create',
      candidateMediaKeys: ['main-1'],
    });

    expect(result).toMatchObject({
      plan: { id: 'plan-current' }, replayed: false, sourceCurrent: true,
    });
    expect(repository.resolveCurrentRulePlanningTarget).toHaveBeenCalledWith({
      ownerUserId: 'owner-current', context: { type: 'collect', id: 'goods-current' },
    });
    expect(repository.loadRulePlanningAuthority).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-current', actorUserId: 'actor-current',
      sourceSubjectId: 'subject-current', sourceCaptureSnapshotId: 'snapshot-current',
      selectedSkuKeys: ['red-single'],
    }));
  });

  it('uses the shared product-only identity when a current target returns an empty SKU list', async () => {
    const source = authority();
    source.capture.skus = [];
    source.capture.media[0]!.skuKeys = [];
    const repository = {
      resolveCurrentRulePlanningTarget: vi.fn().mockResolvedValue({
        sourceSubjectId: 'subject-product-only',
        sourceCaptureSnapshotId: 'snapshot-product-only',
        selectedSkuKeys: [],
      }),
      loadRulePlanningAuthority: vi.fn().mockResolvedValue(source),
      createRulePlan: vi.fn().mockResolvedValue({
        kind: 'created',
        plan: { id: 'plan-product-only', revision: 1, reviewStatus: 'PENDING' },
      }),
    };
    const service = createAiMediaPlanningService(repository as never, { sourcePreparation: false });
    await service.createCurrentRuleBased({
      ownerUserId: 'owner-product-only',
      actorUserId: 'actor-product-only',
      context: { type: 'collect', id: 'goods-product-only' },
      idempotencyKey: 'product-only-current',
      candidateMediaKeys: ['main-1'],
    });

    expect(repository.loadRulePlanningAuthority).toHaveBeenCalledWith(expect.objectContaining({
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
    }));
  });

  it('computes sourceCurrent without mutating the plan and keeps the comparison tenant-scoped', async () => {
    const currentVersion = {
      id: 'version-current', planId: 'plan-current', ownerUserId: 'owner-current', version: 1,
      sourceCaptureSnapshotId: 'snapshot-current', sourceCaptureHash: 'a'.repeat(64),
      sourceProfileHash: 'b'.repeat(64), sourceSchemaVersion: 'source-product-capture-v2',
      inputFingerprint: 'c'.repeat(64), planSchemaVersion: 'plan/v1', plannerVersion: 'rule/v1',
      mode: 'RULE_BASED' as const, fallbackReason: null, curation: {}, curationHash: 'd'.repeat(64),
      visionEvidence: {}, visionEvidenceHash: 'e'.repeat(64), planHash: 'f'.repeat(64),
      planPayload: {}, provenance: {}, provenanceHash: '1'.repeat(64), createdAt: new Date(),
    };
    const currentPlan = {
      id: 'plan-current', ownerUserId: 'owner-current', actorUserId: 'actor-current',
      sourceSubjectId: 'subject-current', contextType: 'collect', contextId: 'goods-current',
      revision: 1, latestVersion: 1, currentVersionId: currentVersion.id, approvedVersionId: null,
      reviewStatus: 'PENDING' as const, staleAt: null, staleAgainstFingerprint: null,
      staleReasons: null, reviewedByUserId: null, reviewedAt: null, createdAt: new Date(), updatedAt: new Date(),
      currentVersion, approvedVersion: null,
    };
    const repository = {
      getLatestOwnedByContext: vi.fn().mockResolvedValue(currentPlan),
      loadLatestSourceAuthority: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-current', captureHash: 'a'.repeat(64),
        profileHash: 'b'.repeat(64), schemaVersion: 'source-product-capture-v2',
      }),
    };
    const service = createAiMediaPlanningService(repository as never);
    const result = await service.getCurrentByContext('owner-current', {
      type: 'collect', id: 'goods-current',
    });

    expect(result).toMatchObject({ plan: { id: 'plan-current' }, sourceCurrent: true });
    expect(repository.getLatestOwnedByContext).toHaveBeenCalledWith({
      ownerUserId: 'owner-current', contextType: 'collect', contextId: 'goods-current',
    });
    expect(repository.loadLatestSourceAuthority).toHaveBeenCalledWith({
      ownerUserId: 'owner-current', sourceSubjectId: 'subject-current',
      contextType: 'collect', contextId: 'goods-current',
    });
  });

  it('projects the current source status on an exact review replay', async () => {
    const currentVersion = {
      id: 'version-replay', planId: 'plan-replay', ownerUserId: 'owner-replay', version: 1,
      sourceCaptureSnapshotId: 'snapshot-old', sourceCaptureHash: 'a'.repeat(64),
      sourceProfileHash: 'b'.repeat(64), sourceSchemaVersion: 'source-product-capture-v2',
      inputFingerprint: 'c'.repeat(64), planSchemaVersion: 'plan/v1', plannerVersion: 'rule/v1',
      mode: 'RULE_BASED' as const, fallbackReason: null, curation: {}, curationHash: 'd'.repeat(64),
      visionEvidence: {}, visionEvidenceHash: 'e'.repeat(64), planHash: 'f'.repeat(64),
      planPayload: {}, provenance: {}, provenanceHash: '1'.repeat(64), createdAt: new Date(),
    };
    const replayPlan = {
      id: 'plan-replay', ownerUserId: 'owner-replay', actorUserId: 'owner-replay',
      sourceSubjectId: 'subject-replay', contextType: 'collect', contextId: 'goods-replay',
      revision: 2, latestVersion: 1, currentVersionId: currentVersion.id, approvedVersionId: currentVersion.id,
      reviewStatus: 'APPROVED' as const, staleAt: null, staleAgainstFingerprint: null,
      staleReasons: null, reviewedByUserId: 'owner-replay', reviewedAt: new Date(),
      createdAt: new Date(), updatedAt: new Date(), currentVersion, approvedVersion: currentVersion,
    };
    const repository = {
      reviewCurrent: vi.fn().mockResolvedValue({ kind: 'replayed', plan: replayPlan }),
      loadLatestSourceAuthority: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-new', captureHash: '9'.repeat(64),
        profileHash: '8'.repeat(64), schemaVersion: 'source-product-capture-v2',
      }),
    };
    const service = createAiMediaPlanningService(repository as never);
    const result = await service.review({
      planId: 'plan-replay', ownerUserId: 'owner-replay', actorUserId: 'owner-replay',
      expectedRevision: 1, operationKey: 'review-replay-1', decision: 'APPROVE', note: null,
    });

    expect(result).toMatchObject({ replayed: true, sourceCurrent: false, plan: { id: 'plan-replay' } });
    expect(repository.loadLatestSourceAuthority).toHaveBeenCalledWith({
      ownerUserId: 'owner-replay', sourceSubjectId: 'subject-replay',
      contextType: 'collect', contextId: 'goods-replay',
    });
  });

  it('maps an evidence-incomplete approval to a stable not-ready error', async () => {
    const repository = {
      reviewCurrent: vi.fn().mockResolvedValue({
        kind: 'not-ready',
        plan: { id: 'plan-not-ready' },
      }),
    };
    const service = createAiMediaPlanningService(repository as never);

    await expect(service.review({
      planId: 'plan-not-ready', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, operationKey: 'not-ready-review', decision: 'APPROVE', note: null,
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_NOT_READY', statusCode: 409,
    });
  });

  it('normalizes a manual slot-reference mutation without reordering references', async () => {
    const currentVersion = {
      id: 'version-2', planId: 'plan-slot-edit', ownerUserId: 'owner-1', version: 2,
      sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
      sourceProfileHash: 'b'.repeat(64), sourceSchemaVersion: 'source-product-capture-v2',
      inputFingerprint: 'c'.repeat(64), planSchemaVersion: 'plan/v1', plannerVersion: 'manual/v1',
      mode: 'RULE_BASED' as const, fallbackReason: null, curation: {}, curationHash: 'd'.repeat(64),
      visionEvidence: {}, visionEvidenceHash: 'e'.repeat(64), planHash: 'f'.repeat(64),
      planPayload: {}, provenance: {}, provenanceHash: '1'.repeat(64), createdAt: new Date(),
    };
    const updatedPlan = {
      id: 'plan-slot-edit', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      sourceSubjectId: 'subject-1', contextType: 'collect', contextId: 'goods-1',
      revision: 2, latestVersion: 2, currentVersionId: currentVersion.id, approvedVersionId: null,
      reviewStatus: 'PENDING' as const, staleAt: null, staleAgainstFingerprint: null,
      staleReasons: null, reviewedByUserId: null, reviewedAt: null,
      createdAt: new Date(), updatedAt: new Date(), currentVersion, approvedVersion: null,
    };
    const repository = {
      updateSlotReferences: vi.fn().mockResolvedValue({
        kind: 'updated', plan: updatedPlan, createdVersionId: 'version-2',
      }),
      loadLatestSourceAuthority: vi.fn().mockResolvedValue({
        snapshotId: 'snapshot-1', captureHash: 'a'.repeat(64),
        profileHash: 'b'.repeat(64), schemaVersion: 'source-product-capture-v2',
      }),
    };
    const service = createAiMediaPlanningService(repository as never);

    const result = await service.updateSlotReferences({
      planId: 'plan-slot-edit', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-edit-operation-1',
      changes: [{
        slotKey: 'sku:sku-1:hero',
        referenceCandidateIds: ['media-secondary', 'media-primary'],
      }],
    });

    expect(result).toMatchObject({
      replayed: false, createdVersionId: 'version-2', sourceCurrent: true,
      plan: { id: 'plan-slot-edit', reviewStatus: 'PENDING' },
    });
    expect(repository.updateSlotReferences).toHaveBeenCalledWith(expect.objectContaining({
      changes: [{
        slotKey: 'sku:sku-1:hero',
        referenceCandidateIds: ['media-secondary', 'media-primary'],
      }],
    }));
  });

  it('rejects duplicate slot changes before repository dispatch', async () => {
    const repository = { updateSlotReferences: vi.fn() };
    const service = createAiMediaPlanningService(repository as never);

    await expect(service.updateSlotReferences({
      planId: 'plan-slot-edit', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-edit-operation-2',
      changes: [
        { slotKey: 'sku:sku-1:hero', referenceCandidateIds: ['media-1'] },
        { slotKey: 'sku:sku-1:hero', referenceCandidateIds: [] },
      ],
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_INVALID_INPUT', statusCode: 400,
    });
    expect(repository.updateSlotReferences).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', null, 'AI_MEDIA_PLANNING_NOT_FOUND', 404],
    ['operation-conflict', { id: 'plan-slot-edit' }, 'AI_MEDIA_PLANNING_OPERATION_CONFLICT', 409],
    ['revision-conflict', { id: 'plan-slot-edit' }, 'AI_MEDIA_PLANNING_REVISION_CONFLICT', 409],
    ['state-conflict', { id: 'plan-slot-edit' }, 'AI_MEDIA_PLANNING_REVIEW_STATE_CONFLICT', 409],
    ['stale', { id: 'plan-slot-edit' }, 'AI_MEDIA_PLANNING_STALE', 409],
    ['no-changes', { id: 'plan-slot-edit' }, 'AI_MEDIA_PLANNING_NO_CHANGES', 409],
    ['invalid-reference', { id: 'plan-slot-edit' }, 'AI_MEDIA_PLANNING_INVALID_INPUT', 400],
    ['active-suite-conflict', { id: 'plan-slot-edit' }, 'AI_MEDIA_PLANNING_ACTIVE_SUITE_CONFLICT', 409],
  ] as const)('maps slot-reference repository result %s to %s', async (
    kind,
    resultPlan,
    code,
    statusCode,
  ) => {
    const repository = {
      updateSlotReferences: vi.fn().mockResolvedValue({
        kind, plan: resultPlan, createdVersionId: null,
      }),
    };
    const service = createAiMediaPlanningService(repository as never);

    await expect(service.updateSlotReferences({
      planId: 'plan-slot-edit', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: `slot-error-${kind}`,
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: ['media-1'] }],
    })).rejects.toMatchObject({ code, statusCode });
  });
});
