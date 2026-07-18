import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY,
  evaluateAiMediaPlanningFixtureSet,
  hashAiMediaPlanningTemplateBindings,
  type AiMediaPlanningEvaluationPolicy,
  type AiMediaPlanningTemplateBinding,
} from '../services/ai-media-planning-evaluation.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import {
  evaluateAiMediaModelPlanningGate,
  evaluateAiMediaModelPlanningGateCandidate,
} from '../services/ai-media-model-planning-gate.js';
import { verifyAiPromptConsumerContract } from '../services/ai-prompt-consumer-contracts.js';
import { createRuleBasedImagePromptPlan } from '../services/ai-image-prompt-plan.js';

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(
    `../../../../scripts/fixtures/ai-media-evaluation/model-planning-v1/${name}`,
    import.meta.url,
  ), 'utf8')) as T;
}

const bindings: AiMediaPlanningTemplateBinding[] = [
  ['curation', 'image-curation.base', '1'],
  ['vision', 'image-vision.base', '2'],
  ['slot_planning', 'image-slot-planning.base', '3'],
].map(([role, templateKey, digit]) => {
  const consumer = verifyAiPromptConsumerContract(templateKey!);
  return {
  role: role as AiMediaPlanningTemplateBinding['role'],
  templateKey: templateKey!,
  releaseId: `release-${digit}`,
  revisionId: `revision-${digit}`,
  sequence: 1,
  checksum: digit!.repeat(64),
  consumerSchemaVersion: consumer.schemaVersion,
  consumerNormalizerVersion: consumer.normalizerVersion,
  consumerContractHash: consumer.contractHash,
  };
});

const contractPolicy: AiMediaPlanningEvaluationPolicy = {
  ...AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY,
  minimumCases: { curation: 1, vision: 1, slotPlanning: 1 },
};

async function contractCases() {
  return Promise.all([
    fixture<any[]>('curation/contract-cases.json'),
    fixture<any[]>('vision/contract-cases.json'),
    fixture<any[]>('slot-plan/contract-cases.json'),
  ]).then((groups) => groups.flat());
}

function uniqueProductionCases(cases: any[]) {
  const generated = cases.flatMap((entry) => Array.from({ length: 20 }, (_unused, index) => {
    const suffix = index + 1;
    if (entry.kind === 'curation') {
      const idMap = new Map(entry.context.candidates.map((candidate: any) => [
        candidate.id,
        `${candidate.id}-${suffix}`,
      ]));
      return {
        ...structuredClone(entry),
        id: `curation-production-${suffix}`,
        context: {
          candidates: entry.context.candidates.map((candidate: any) => ({
            ...candidate, id: idMap.get(candidate.id), contentHash: `${candidate.contentHash}-${suffix}`,
          })),
        },
        modelOutput: {
          ...entry.modelOutput,
          decisions: entry.modelOutput.decisions.map((decision: any) => ({
            ...decision, candidateId: idMap.get(decision.candidateId),
          })),
        },
        gold: {
          dispositions: Object.fromEntries(Object.entries(entry.gold.dispositions)
            .map(([candidateId, disposition]) => [idMap.get(candidateId), disposition])),
        },
      };
    }
    if (entry.kind === 'vision') {
      const idMap = new Map(entry.context.candidateIds.map((candidateId: string) => [
        candidateId,
        `${candidateId}-${suffix}`,
      ]));
      return {
        ...structuredClone(entry),
        id: `vision-production-${suffix}`,
        context: { ...entry.context, candidateIds: entry.context.candidateIds.map((id: string) => idMap.get(id)) },
        modelOutput: {
          ...entry.modelOutput,
          images: entry.modelOutput.images.map((image: any) => ({
            ...image, candidateId: idMap.get(image.candidateId),
          })),
        },
        gold: {
          identities: Object.fromEntries(Object.entries(entry.gold.identities)
            .map(([candidateId, identity]) => [idMap.get(candidateId), identity])),
          unsupportedClaimFields: Object.fromEntries(Object.entries(entry.gold.unsupportedClaimFields)
            .map(([candidateId, fields]) => [idMap.get(candidateId), fields])),
        },
      };
    }
    const skuKey = `sku-${suffix}`;
    const candidateId = `image-${suffix}`;
    const context = {
      skus: [{ skuKey, attributes: [] }],
      images: [{
        candidateId,
        skuKeys: [skuKey],
        contentRole: 'identity' as const,
        evidenceIds: [`capture:${candidateId}`],
      }],
      verifiedFacts: [],
    };
    const slotKeys = createRuleBasedImagePromptPlan(context).slots.map((slot) => slot.slotKey);
    return {
      id: `slot-production-${suffix}`,
      kind: 'slot_planning',
      context,
      modelOutput: {
        version: '2.0',
        slots: slotKeys.map((slotKey) => ({ slotKey, referenceCandidateIds: [candidateId] })),
      },
      gold: {
        allowedReferences: Object.fromEntries(slotKeys.map((slotKey) => [slotKey, [candidateId]])),
      },
    };
  }));
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  return generated.map((entry, index) => ({
    ...entry,
    provenance: {
      sandboxRunId: 'sandbox-run-unit-test',
      providerRequestId: `provider-request-${index + 1}`,
      sourceMediaHashes: [digest(`source-media-${entry.kind}-${index + 1}`)],
      compiledPromptHash: digest(`compiled-prompt-${entry.kind}-${index + 1}`),
      providerRequestHash: digest(`provider-request-${entry.kind}-${index + 1}`),
      rawResponseHash: hashAiMediaPlanningJson(entry.modelOutput),
      recordedAt: '2026-07-18T11:50:00.000Z',
    },
  }));
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return contractCases().then((cases) => evaluateAiMediaPlanningFixtureSet({
    evidenceLevel: 'CONTRACT_FIXTURE',
    fixtureSetId: 'unit8-contract-fixtures-v1',
    provider: 'contract-fixture',
    model: 'contract-fixture',
    providerConfigHash: 'f'.repeat(64),
    templateBindings: bindings,
    cases,
    policy: contractPolicy,
    evaluatedAt: '2026-07-18T12:00:00.000Z',
    ...overrides,
  } as never));
}

describe('AI media model-planning evaluation gate', () => {
  it('recomputes structural metrics but never unlocks from contract fixtures', async () => {
    const manifest = await fixture<any>('manifest.json');
    const evaluation = await evaluate({
      evidenceLevel: manifest.evidenceLevel,
      fixtureSetId: manifest.fixtureSetId,
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.metrics).toMatchObject({
      curation: {
        keepPrecision: 1,
        keepRecall: 1,
        rejectRecall: 1,
        manualRecall: 1,
      },
      vision: { identityAccuracy: 1, unsupportedClaimQuarantineRecall: 1 },
      slotPlanning: { compatibleReferencePrecision: 1, slotCoverage: 1 },
      fallbackRateByRole: {
        curation: 0,
        vision: 0,
        slotPlanning: 0,
      },
      unsafe: {
        unknownCandidateAcceptances: 0,
        deterministicRuleBypasses: 0,
        manualReviewBypasses: 0,
        unsafeIdentityAcceptances: 0,
        unsupportedFactPromotions: 0,
        incompatibleReferenceAcceptances: 0,
      },
    });
    expect(evaluateAiMediaModelPlanningGate({
      policy: {
        state: 'READY',
        approvedFixtureSetId: evaluation.fixtureSetId,
        approvedFixtureSetHash: evaluation.fixtureSetHash,
        provider: evaluation.provider,
        model: evaluation.model,
        providerConfigHash: evaluation.providerConfigHash,
        evaluationPolicyHash: evaluation.policyHash,
        maxEvaluationAgeMs: 2_592_000_000,
      },
      evaluation,
      activeTemplateBindings: bindings,
      approval: {
        status: 'APPROVED',
        evaluationHash: evaluation.evaluationHash,
        templateSetHash: evaluation.templateSetHash,
        fixtureSetHash: evaluation.fixtureSetHash,
        reviewerUserId: 'reviewer-1',
        reviewedAt: '2026-07-18T12:05:00.000Z',
      },
      now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'evidence_not_sandbox_recorded' });
  });

  it('keeps production blocked until real corpus coverage exists', async () => {
    const evaluation = await evaluate({ policy: AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      'insufficient_curation_cases',
      'insufficient_vision_cases',
      'insufficient_slot_planning_cases',
    ]));
  });

  it('requires exact sandbox evidence, approval, provider config, and template bindings', async () => {
    const baseCases = await contractCases();
    const productionCases = uniqueProductionCases(baseCases);
    const evaluation = await evaluate({
      evidenceLevel: 'RECORDED_SANDBOX_MODEL',
      fixtureSetId: 'sandbox-fixtures-v1',
      provider: 'multimodal-provider',
      model: 'exact-model-version',
      cases: productionCases,
      policy: AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY,
    });
    const policy = {
      state: 'READY' as const,
      approvedFixtureSetId: evaluation.fixtureSetId,
      approvedFixtureSetHash: evaluation.fixtureSetHash,
      provider: evaluation.provider,
      model: evaluation.model,
      providerConfigHash: evaluation.providerConfigHash,
      evaluationPolicyHash: evaluation.policyHash,
      maxEvaluationAgeMs: 2_592_000_000,
    };
    const approval = {
      status: 'APPROVED' as const,
      evaluationHash: evaluation.evaluationHash,
      templateSetHash: evaluation.templateSetHash,
      fixtureSetHash: evaluation.fixtureSetHash,
      reviewerUserId: 'reviewer-1',
      reviewedAt: '2026-07-18T12:05:00.000Z',
    };
    const input = { policy, evaluation, activeTemplateBindings: bindings, approval };
    expect(evaluateAiMediaModelPlanningGateCandidate({
      ...input, now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ eligible: true, reason: 'approved' });
    expect(evaluateAiMediaModelPlanningGate({
      ...input, now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'durable_gate_not_implemented' });

    const changed = bindings.map((item, index) => index === 0
      ? { ...item, releaseId: 'release-new', sequence: 2 }
      : item);
    expect(hashAiMediaPlanningTemplateBindings(changed)).not.toBe(evaluation.templateSetHash);
    expect(evaluateAiMediaModelPlanningGate({
      ...input, activeTemplateBindings: changed, now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'template_binding_changed' });
    expect(evaluateAiMediaModelPlanningGate({
      ...input,
      policy: { ...policy, providerConfigHash: 'e'.repeat(64) },
      now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'provider_binding_changed' });
    expect(evaluateAiMediaModelPlanningGate({
      ...input,
      policy: { ...policy, evaluationPolicyHash: 'd'.repeat(64) },
      now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'evaluation_policy_changed' });
    expect(evaluateAiMediaModelPlanningGate({
      ...input,
      policy: { ...policy, maxEvaluationAgeMs: Number.MAX_SAFE_INTEGER },
      now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'freshness_policy_changed' });
    expect(evaluateAiMediaModelPlanningGate({
      ...input,
      evaluation: { ...evaluation, passed: false },
      now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'evaluation_integrity_invalid' });
    expect(evaluateAiMediaModelPlanningGate({
      ...input,
      approval: { ...approval, status: 'REVOKED' },
      now: new Date('2026-07-18T12:10:00.000Z'),
    })).toEqual({ enabled: false, reason: 'approval_missing' });
  });

  it('counts malformed output in the denominator and fails closed', async () => {
    const cases = await contractCases();
    const evaluation = await evaluate({
      cases: cases.map((entry, index) => index === 0
        ? { ...entry, modelOutput: '{broken-json' }
        : entry),
    });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.metrics.fallbackRateByRole.curation).toBeGreaterThan(0);
    expect(evaluation.blockers).toContain('fallback_rate_exceeded');
  });

  it('does not let healthy roles dilute a completely failing role', async () => {
    const cases = await contractCases();
    const evaluation = await evaluate({
      cases: cases.map((entry) => entry.kind === 'curation'
        ? { ...entry, modelOutput: '{broken-json' }
        : entry),
      policy: { ...contractPolicy, maximumFallbackRate: 0.4 },
    });

    expect(evaluation.metrics.fallbackRate).toBeCloseTo(1 / 3);
    expect(evaluation.metrics.fallbackRateByRole).toEqual({
      curation: 1,
      vision: 0,
      slotPlanning: 0,
    });
    expect(evaluation.blockers).toContain('curation_fallback_rate_exceeded');
  });

  it('fails when a gold manual candidate is automatically disposed', async () => {
    const cases = await contractCases();
    const evaluation = await evaluate({
      cases: cases.map((entry) => entry.kind === 'curation'
        ? {
          ...entry,
          gold: {
            dispositions: {
              'keep-1': 'manual',
              'reject-1': 'reject',
              'manual-1': 'reject',
            },
          },
          modelOutput: {
            ...entry.modelOutput,
            decisions: entry.modelOutput.decisions.map((decision: any) => (
              decision.candidateId === 'keep-1'
                ? { ...decision, disposition: 'reject' }
                : decision
            )),
          },
        }
        : entry),
    });

    expect(evaluation.metrics.curation.manualRecall).toBe(0);
    expect(evaluation.metrics.unsafe.manualReviewBypasses).toBe(1);
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      'manual_recall_below_threshold',
      'unsafe_acceptance_detected',
    ]));
  });

  it('rejects incomplete gold coverage and does not credit rule fallback as model output', async () => {
    const cases = await contractCases();
    expect(() => evaluateAiMediaPlanningFixtureSet({
      evidenceLevel: 'RECORDED_SANDBOX_MODEL',
      fixtureSetId: 'unproven-sandbox-v1',
      provider: 'multimodal-provider',
      model: 'exact-model-version',
      providerConfigHash: 'f'.repeat(64),
      templateBindings: bindings,
      cases,
      policy: contractPolicy,
      evaluatedAt: '2026-07-18T12:00:00.000Z',
    } as never)).toThrow(/provenance is required/u);

    expect(() => evaluateAiMediaPlanningFixtureSet({
      evidenceLevel: 'CONTRACT_FIXTURE',
      fixtureSetId: 'duplicate-evidence-v1',
      provider: 'contract-fixture',
      model: 'contract-fixture',
      providerConfigHash: 'f'.repeat(64),
      templateBindings: bindings,
      cases: [...cases, { ...structuredClone(cases[0]), id: 'duplicate-with-new-id' }],
      policy: contractPolicy,
      evaluatedAt: '2026-07-18T12:00:00.000Z',
    } as never)).toThrow(/must contain unique evidence/u);

    const slotIndex = cases.findIndex((entry) => entry.kind === 'slot_planning');
    const slotCase = cases[slotIndex];
    const incompleteGold = cases.map((entry, index) => index === slotIndex
      ? {
        ...entry,
        gold: { allowedReferences: { 'sku:sku-1:hero': ['image-1'] } },
      }
      : entry);
    expect(() => evaluateAiMediaPlanningFixtureSet({
      evidenceLevel: 'CONTRACT_FIXTURE',
      fixtureSetId: 'incomplete-gold-v1',
      provider: 'contract-fixture',
      model: 'contract-fixture',
      providerConfigHash: 'f'.repeat(64),
      templateBindings: bindings,
      cases: incompleteGold,
      policy: contractPolicy,
      evaluatedAt: '2026-07-18T12:00:00.000Z',
    } as never)).toThrow(/must cover the complete evaluation scope/u);

    const emptySlots = cases.map((entry, index) => index === slotIndex
      ? { ...slotCase, modelOutput: { version: '2.0', slots: [] } }
      : entry);
    const evaluation = await evaluate({ cases: emptySlots });
    expect(evaluation.passed).toBe(false);
    expect(evaluation.metrics.slotPlanning).toEqual({
      compatibleReferencePrecision: 0,
      slotCoverage: 0,
    });
    expect(evaluation.blockers).toEqual(expect.arrayContaining([
      'reference_precision_below_threshold',
      'slot_coverage_below_threshold',
      'fallback_rate_exceeded',
    ]));
  });
});
