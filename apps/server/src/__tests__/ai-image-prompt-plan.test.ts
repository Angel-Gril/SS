import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_PROMPT_PLAN_VERSION,
  createRuleBasedImagePromptPlan,
  normalizeAiImagePromptPlanOutput,
  type ImagePromptPlanInput,
} from '../services/ai-image-prompt-plan.js';

function input(): ImagePromptPlanInput {
  return {
    skus: [{
      skuKey: 'red-single',
      attributes: [{ key: 'color', value: 'red', identityImpact: 'color' }],
    }, {
      skuKey: 'blue-single',
      attributes: [{ key: 'color', value: 'blue', identityImpact: 'color' }],
    }, {
      skuKey: 'red-pair',
      attributes: [
        { key: 'color', value: 'red', identityImpact: 'color' },
        { key: 'bundle_count', value: '2', identityImpact: 'bundle' },
      ],
    }],
    images: [{
      candidateId: 'shared-main',
      skuKeys: [],
      contentRole: 'identity',
      evidenceIds: ['capture:/media/shared-main'],
    }, {
      candidateId: 'red-single-image',
      skuKeys: ['red-single'],
      contentRole: 'identity',
      evidenceIds: ['capture:/media/red-single'],
    }, {
      candidateId: 'blue-single-image',
      skuKeys: ['blue-single'],
      contentRole: 'identity',
      evidenceIds: ['capture:/media/blue-single'],
    }, {
      candidateId: 'red-pair-image',
      skuKeys: ['red-pair'],
      contentRole: 'identity',
      evidenceIds: ['capture:/media/red-pair'],
    }, {
      candidateId: 'shared-detail',
      skuKeys: [],
      contentRole: 'detail',
      evidenceIds: ['capture:/media/shared-detail'],
    }],
    verifiedFacts: [{
      path: '/facts/productName',
      value: 'Insulated bottle',
      evidenceIds: ['capture:/facts/title'],
    }],
  };
}

describe('AI image prompt plan', () => {
  it('shares gallery for color-only variants but splits bundle-changing variants', () => {
    const plan = createRuleBasedImagePromptPlan(input());
    const groups = plan.compatibilityGroups
      .map((group) => [...group.skuKeys].sort())
      .sort((left, right) => left.join(',').localeCompare(right.join(',')));

    expect(plan.version).toBe(AI_IMAGE_PROMPT_PLAN_VERSION);
    expect(groups).toEqual([
      ['blue-single', 'red-single'],
      ['red-pair'],
    ]);
    expect(plan.slots.filter((slot) => slot.goal === 'sku_hero')).toHaveLength(3);
    expect(plan.slots.filter((slot) => slot.ownership.level === 'compatibility_group')).toHaveLength(14);
  });

  it('gives every slot bounded references, evidence, ownership, constraints and acceptance checks', () => {
    const plan = createRuleBasedImagePromptPlan(input());

    expect(plan.mode).toBe('rule_based');
    expect(plan.manualSelectionAllowed).toBe(true);
    expect(plan.recoverable).toBe(true);
    expect(plan.slots).toHaveLength(17);
    for (const slot of plan.slots) {
      expect(slot.slotKey).toBeTruthy();
      expect(slot.goal).toBeTruthy();
      expect(slot.ownership.key).toBeTruthy();
      expect(slot.status).toBe('READY');
      expect(slot.references.length).toBeGreaterThan(0);
      expect(slot.references.length).toBeLessThanOrEqual(5);
      expect(slot.references.every((reference) => reference.evidenceIds.length > 0)).toBe(true);
      expect(slot.safetyConstraints).toContain('preserve_product_identity');
      expect(slot.safetyConstraints).toContain('use_verified_facts_only');
      expect(slot.acceptanceChecks.length).toBeGreaterThan(0);
    }
  });

  it('never leaks a bundle-specific reference into the color-only compatibility group', () => {
    const plan = createRuleBasedImagePromptPlan(input());
    const colorGroup = plan.compatibilityGroups.find((group) => group.skuKeys.length === 2)!;
    const groupSlots = plan.slots.filter((slot) => (
      slot.ownership.level === 'compatibility_group'
      && slot.ownership.key === colorGroup.groupKey
    ));

    expect(groupSlots).not.toHaveLength(0);
    expect(groupSlots.flatMap((slot) => slot.references.map((reference) => reference.candidateId)))
      .not.toContain('red-pair-image');
  });

  it('conservatively splits unknown identity-changing dimensions and marks uncovered slots manual', () => {
    const plan = createRuleBasedImagePromptPlan({
      skus: [{
        skuKey: 'unknown-a',
        attributes: [{ key: 'mystery', value: 'a', identityImpact: 'unknown' }],
      }, {
        skuKey: 'unknown-b',
        attributes: [{ key: 'mystery', value: 'b', identityImpact: 'unknown' }],
      }],
      images: [],
      verifiedFacts: [],
    });

    expect(plan.compatibilityGroups.map((group) => group.skuKeys)).toEqual([
      ['unknown-a'],
      ['unknown-b'],
    ]);
    expect(plan.slots).toHaveLength(16);
    expect(plan.slots.every((slot) => slot.status === 'MANUAL_REQUIRED')).toBe(true);
    expect(plan.manualSelectionAllowed).toBe(true);
  });

  it.each(['structure', 'capacity', 'packaging'] as const)(
    'splits variants when the %s dimension changes',
    (identityImpact) => {
      const plan = createRuleBasedImagePromptPlan({
        skus: [{
          skuKey: 'sku-a',
          attributes: [{ key: identityImpact, value: 'a', identityImpact }],
        }, {
          skuKey: 'sku-b',
          attributes: [{ key: identityImpact, value: 'b', identityImpact }],
        }],
        images: [{
          candidateId: 'shared', skuKeys: [], contentRole: 'identity', evidenceIds: ['capture:/media/0'],
        }],
        verifiedFacts: [],
      });

      expect(plan.compatibilityGroups.map((group) => group.skuKeys)).toEqual([['sku-a'], ['sku-b']]);
    },
  );

  it('marks references without evidence as manual instead of creating an executable slot', () => {
    const plan = createRuleBasedImagePromptPlan({
      skus: [{ skuKey: 'sku-a', attributes: [] }],
      images: [{ candidateId: 'unanchored', skuKeys: [], contentRole: 'identity', evidenceIds: [] }],
      verifiedFacts: [],
    });

    expect(plan.slots.every((slot) => slot.status === 'MANUAL_REQUIRED')).toBe(true);
    expect(plan.slots.every((slot) => slot.references.length === 0)).toBe(true);
  });

  it('emits only exact, bounded, unique evidence IDs on executable references', () => {
    const plan = createRuleBasedImagePromptPlan({
      skus: [{ skuKey: 'sku-a', attributes: [] }],
      images: [{
        candidateId: 'anchored',
        skuKeys: [],
        contentRole: 'identity',
        evidenceIds: ['capture:/media/0', '', ' capture:/media/1 ', 'capture:/media/0', 'x'.repeat(501)],
      }],
      verifiedFacts: [],
    });

    expect(plan.slots.every((slot) => slot.status === 'READY')).toBe(true);
    expect(plan.slots.every((slot) => (
      slot.references[0]?.evidenceIds.length === 1
      && slot.references[0].evidenceIds[0] === 'capture:/media/0'
    ))).toBe(true);
  });

  it('does not merge equally named unknown dimensions across SKUs', () => {
    const plan = createRuleBasedImagePromptPlan({
      skus: ['sku-a', 'sku-b'].map((skuKey) => ({
        skuKey,
        attributes: [{ key: 'unclassified-option', value: 'same', identityImpact: 'unknown' as const }],
      })),
      images: [{
        candidateId: 'shared', skuKeys: [], contentRole: 'identity', evidenceIds: ['capture:/media/0'],
      }],
      verifiedFacts: [],
    });

    expect(plan.compatibilityGroups.map((group) => group.skuKeys)).toEqual([['sku-a'], ['sku-b']]);
  });

  it('cannot collide compatibility signatures through attribute delimiters', () => {
    const plan = createRuleBasedImagePromptPlan({
      skus: [{
        skuKey: 'sku-one',
        attributes: [{
          key: 'a', value: 'b|structure:c=d', identityImpact: 'structure',
        }],
      }, {
        skuKey: 'sku-two',
        attributes: [{
          key: 'a', value: 'b', identityImpact: 'structure',
        }, {
          key: 'c', value: 'd', identityImpact: 'structure',
        }],
      }],
      images: [{
        candidateId: 'shared', skuKeys: [], contentRole: 'identity', evidenceIds: ['capture:/media/0'],
      }],
      verifiedFacts: [],
    });

    expect(plan.compatibilityGroups.map((group) => group.skuKeys)
      .sort((left, right) => left[0]!.localeCompare(right[0]!))).toEqual([
      ['sku-one'],
      ['sku-two'],
    ]);
  });

  it('orders and truncates a real reference pool to five images', () => {
    const plan = createRuleBasedImagePromptPlan({
      skus: [{ skuKey: 'sku-a', attributes: [] }],
      images: Array.from({ length: 8 }, (_, index) => ({
        candidateId: `image-${index + 1}`,
        skuKeys: index === 7 ? ['sku-a'] : [],
        contentRole: index === 7 ? 'identity' as const : 'detail' as const,
        evidenceIds: [`capture:/media/${index}`],
      })),
      verifiedFacts: [],
    });
    const hero = plan.slots.find((slot) => slot.goal === 'sku_hero')!;

    expect(hero.references).toHaveLength(5);
    expect(hero.references[0]?.candidateId).toBe('image-8');
    expect(hero.references.map((reference) => reference.candidateId)).toEqual([
      'image-8', 'image-1', 'image-2', 'image-3', 'image-4',
    ]);
  });

  it('scopes verified fact evidence to the owning SKU and compatible gallery group', () => {
    const source = input();
    source.verifiedFacts = [{
      path: '/facts/productName', value: 'Bottle', evidenceIds: ['capture:/facts/title'],
    }, {
      path: '/skus/red-single/capacity',
      value: '500 ml',
      evidenceIds: ['capture:/skus/red-single/capacity'],
      skuKeys: ['red-single'],
    }];
    const plan = createRuleBasedImagePromptPlan(source);
    const redHero = plan.slots.find((slot) => slot.slotKey === 'sku:red-single:hero')!;
    const blueHero = plan.slots.find((slot) => slot.slotKey === 'sku:blue-single:hero')!;
    const sharedGroup = plan.compatibilityGroups.find((group) => group.skuKeys.length === 2)!;
    const sharedGallery = plan.slots.find((slot) => slot.ownership.key === sharedGroup.groupKey)!;

    expect(redHero.factEvidenceIds).toContain('capture:/skus/red-single/capacity');
    expect(blueHero.factEvidenceIds).not.toContain('capture:/skus/red-single/capacity');
    expect(sharedGallery.factEvidenceIds).not.toContain('capture:/skus/red-single/capacity');
    expect(sharedGallery.factEvidenceIds).toContain('capture:/facts/title');
  });

  it('freezes verified facts as canonical JSON and rejects values that cannot be persisted', () => {
    const value = { z: 2, nested: { stable: true } };
    const source: ImagePromptPlanInput = {
      skus: [{ skuKey: 'sku-a', attributes: [] }],
      images: [{
        candidateId: 'main', skuKeys: [], contentRole: 'identity', evidenceIds: ['capture:/media/0'],
      }],
      verifiedFacts: [{
        path: '/facts/profile', value, evidenceIds: ['capture:/facts/profile'],
      }],
    };
    const plan = createRuleBasedImagePromptPlan(source);
    value.nested.stable = false;

    expect(plan.verifiedFacts[0]?.value).toEqual({ nested: { stable: true }, z: 2 });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);

    const specialKeys = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"literal","prototype":"literal"}',
    ) as Record<string, unknown>;
    const specialPlan = createRuleBasedImagePromptPlan({
      ...source,
      verifiedFacts: [{
        path: '/facts/special', value: specialKeys, evidenceIds: ['capture:/facts/special'],
      }],
    });
    const specialValue = specialPlan.verifiedFacts[0]?.value as Record<string, unknown>;
    expect(Object.keys(specialValue).sort()).toEqual(['__proto__', 'constructor', 'prototype']);
    expect(Object.getPrototypeOf(specialValue)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(specialValue))).toEqual(specialKeys);

    const invalidValues: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, BigInt(1), undefined];
    const sparse: unknown[] = [];
    sparse.length = 1;
    invalidValues.push(sparse);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    invalidValues.push(circular);
    for (const invalidValue of invalidValues) {
      expect(() => createRuleBasedImagePromptPlan({
        ...source,
        verifiedFacts: [{
          path: '/facts/invalid', value: invalidValue, evidenceIds: ['capture:/facts/invalid'],
        }],
      })).toThrow(/JSON|persist/i);
    }
  });

  it('merges identical verified facts and rejects conflicts in the same SKU scope', () => {
    const base: ImagePromptPlanInput = {
      skus: [{ skuKey: 'sku-a', attributes: [] }],
      images: [{
        candidateId: 'main', skuKeys: [], contentRole: 'identity', evidenceIds: ['capture:/media/0'],
      }],
      verifiedFacts: [{
        path: '/facts/material', value: 'steel', evidenceIds: ['capture:/attributes/0'],
      }, {
        path: '/facts/material', value: 'steel', evidenceIds: ['review:/attributes/0'], skuKeys: [],
      }],
    };
    const merged = createRuleBasedImagePromptPlan(base);
    expect(merged.verifiedFacts).toEqual([{
      path: '/facts/material',
      value: 'steel',
      evidenceIds: ['capture:/attributes/0', 'review:/attributes/0'],
    }]);

    expect(() => createRuleBasedImagePromptPlan({
      ...base,
      verifiedFacts: [
        base.verifiedFacts[0]!,
        { path: '/facts/material', value: 'polyester', evidenceIds: ['review:/attributes/0'] },
      ],
    })).toThrow(/conflicting verified facts/i);
  });

  it('round-trips maximum-length SKU and candidate IDs through model slot normalization', () => {
    const skuKey = 's'.repeat(500);
    const candidateId = 'c'.repeat(500);
    const source: ImagePromptPlanInput = {
      skus: [{ skuKey, attributes: [] }],
      images: [{ candidateId, skuKeys: [skuKey], contentRole: 'identity', evidenceIds: ['capture:/media/0'] }],
      verifiedFacts: [],
    };
    const base = createRuleBasedImagePromptPlan(source);
    const hero = base.slots.find((slot) => slot.goal === 'sku_hero')!;
    const normalized = normalizeAiImagePromptPlanOutput(source, {
      version: '2.0',
      slots: [{ slotKey: hero.slotKey, referenceCandidateIds: [candidateId] }],
    });

    expect(hero.slotKey.length).toBeGreaterThan(500);
    expect(normalized.mode).toBe('model');
    expect(normalized.slots.find((slot) => slot.slotKey === hero.slotKey)?.references[0]?.candidateId)
      .toBe(candidateId);
  });

  it('falls back to the complete rule plan when planner JSON is malformed', () => {
    const fallback = normalizeAiImagePromptPlanOutput(input(), '{broken-json');

    expect(fallback.mode).toBe('fallback');
    expect(fallback.fallbackReason).toBe('INVALID_MODEL_OUTPUT');
    expect(fallback.manualSelectionAllowed).toBe(true);
    expect(fallback.recoverable).toBe(true);
    expect(fallback.slots).toHaveLength(17);
  });

  it('drops fabricated slot/reference IDs and uses the safe rule assignment for that slot', () => {
    const base = createRuleBasedImagePromptPlan(input());
    const target = base.slots[0]!;
    const normalized = normalizeAiImagePromptPlanOutput(input(), {
      version: '2.0',
      slots: [{
        slotKey: target.slotKey,
        referenceCandidateIds: ['fabricated-image'],
      }, {
        slotKey: 'fabricated-slot',
        referenceCandidateIds: ['shared-main'],
      }],
    });

    expect(normalized.mode).toBe('model');
    expect(normalized.slots.find((slot) => slot.slotKey === target.slotKey)?.references)
      .toEqual(target.references);
    expect(normalized.slots.some((slot) => slot.slotKey === 'fabricated-slot')).toBe(false);
    expect(normalized.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNKNOWN_REFERENCE_ID', candidateId: 'fabricated-image' }),
      expect.objectContaining({ code: 'UNKNOWN_SLOT_ID', slotKey: 'fabricated-slot' }),
    ]));
  });

  it('rejects a known but incompatible SKU reference and preserves the safe assignment', () => {
    const base = createRuleBasedImagePromptPlan(input());
    const target = base.slots.find((slot) => slot.slotKey === 'sku:red-single:hero')!;
    const normalized = normalizeAiImagePromptPlanOutput(input(), {
      version: '2.0',
      slots: [{ slotKey: target.slotKey, referenceCandidateIds: ['red-pair-image'] }],
    });

    expect(normalized.slots.find((slot) => slot.slotKey === target.slotKey)?.references)
      .toEqual(target.references);
    expect(normalized.diagnostics).toContainEqual({
      code: 'INCOMPATIBLE_REFERENCE_ID',
      slotKey: target.slotKey,
      candidateId: 'red-pair-image',
    });
  });
});
