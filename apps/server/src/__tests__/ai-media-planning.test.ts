import { describe, expect, it, vi } from 'vitest';
import {
  buildRuleBasedAiMediaPlanningArtifacts,
  createAiMediaPlanningService,
  hashAiMediaPlanningJson,
  resolveRuleBasedAiMediaPlanningInput,
  type AiMediaPlanningAuthority,
  type CreateRuleBasedAiMediaPlanningInput,
} from '../services/ai-media-planning.js';
import { processRuleBasedAiMediaPlanning } from '../workers/ai-media-planning.js';

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
    const artifacts = buildRuleBasedAiMediaPlanningArtifacts(
      resolveRuleBasedAiMediaPlanningInput(planningInput(), authority()),
    );
    const repository = {
      loadRulePlanningAuthority: vi.fn().mockResolvedValue(authority()),
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
});
