import {
  createDeterministicImageCuration,
  type ImageCurationCandidate,
  type ImageCurationDisposition,
  type ImageCurationPlan,
} from './ai-image-curation.js';
import type {
  AiImageProductIdentity,
  AiImageVerifiedFact,
  NormalizedAiImageVisionOutput,
} from './ai-image-vision.js';
import {
  createRuleBasedImagePromptPlan,
  validateAiImagePromptPlanModelOutput,
  type ImagePromptPlan,
  type ImagePromptPlanInput,
} from './ai-image-prompt-plan.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import {
  AI_MEDIA_CURATION_TEMPLATE_KEY,
  AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
  AI_MEDIA_VISION_TEMPLATE_KEY,
  normalizeAiPromptConsumerOutput,
  verifyAiPromptConsumerContract,
} from './ai-prompt-consumer-contracts.js';

export type AiMediaPlanningEvaluationEvidenceLevel =
  | 'CONTRACT_FIXTURE'
  | 'RECORDED_SANDBOX_MODEL';

export type AiMediaPlanningTemplateRole = 'curation' | 'vision' | 'slot_planning';

export interface AiMediaPlanningTemplateBinding {
  role: AiMediaPlanningTemplateRole;
  templateKey: string;
  releaseId: string;
  revisionId: string;
  sequence: number;
  checksum: string;
  consumerSchemaVersion: string;
  consumerNormalizerVersion: string;
  consumerContractHash: string;
}

export interface AiMediaPlanningEvaluationPolicy {
  policyVersion: 'ai-media-model-planning-evaluation-policy/v1';
  minimumCases: { curation: number; vision: number; slotPlanning: number };
  minimumKeepPrecision: number;
  minimumKeepRecall: number;
  minimumRejectRecall: number;
  minimumManualRecall: number;
  maximumManualEscalationRate: number;
  minimumIdentityAccuracy: number;
  minimumUnsupportedClaimQuarantineRecall: number;
  minimumCompatibleReferencePrecision: number;
  minimumSlotCoverage: number;
  maximumFallbackRate: number;
}

export const AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY: AiMediaPlanningEvaluationPolicy = Object.freeze({
  policyVersion: 'ai-media-model-planning-evaluation-policy/v1',
  minimumCases: Object.freeze({ curation: 20, vision: 20, slotPlanning: 20 }),
  minimumKeepPrecision: 0.95,
  minimumKeepRecall: 0.9,
  minimumRejectRecall: 0.95,
  minimumManualRecall: 1,
  maximumManualEscalationRate: 0.35,
  minimumIdentityAccuracy: 0.95,
  minimumUnsupportedClaimQuarantineRecall: 1,
  minimumCompatibleReferencePrecision: 1,
  minimumSlotCoverage: 1,
  maximumFallbackRate: 0.05,
});

export const AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY_HASH = hashAiMediaPlanningJson(
  AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY,
);

export interface AiMediaPlanningSandboxCaseProvenance {
  sandboxRunId: string;
  providerRequestId: string;
  sourceMediaHashes: string[];
  compiledPromptHash: string;
  providerRequestHash: string;
  rawResponseHash: string;
  recordedAt: string;
}

interface CurationCase {
  id: string;
  kind: 'curation';
  context: { candidates: ImageCurationCandidate[] };
  modelOutput: unknown;
  gold: { dispositions: Record<string, ImageCurationDisposition> };
  provenance?: AiMediaPlanningSandboxCaseProvenance;
}

interface VisionCase {
  id: string;
  kind: 'vision';
  context: { candidateIds: string[]; verifiedFacts: AiImageVerifiedFact[] };
  modelOutput: unknown;
  gold: {
    identities: Record<string, AiImageProductIdentity>;
    unsupportedClaimFields: Record<string, string[]>;
  };
  provenance?: AiMediaPlanningSandboxCaseProvenance;
}

interface SlotPlanningCase {
  id: string;
  kind: 'slot_planning';
  context: ImagePromptPlanInput;
  modelOutput: unknown;
  gold: { allowedReferences: Record<string, string[]> };
  provenance?: AiMediaPlanningSandboxCaseProvenance;
}

export type AiMediaPlanningEvaluationCase = CurationCase | VisionCase | SlotPlanningCase;

export interface AiMediaPlanningEvaluationResult {
  schemaVersion: 'ai-media-model-planning-evaluation/v1';
  evidenceLevel: AiMediaPlanningEvaluationEvidenceLevel;
  fixtureSetId: string;
  fixtureSetHash: string;
  provider: string;
  model: string;
  providerConfigHash: string;
  templateSetHash: string;
  policyHash: string;
  evaluatedAt: string;
  caseCounts: { curation: number; vision: number; slotPlanning: number; total: number };
  metrics: {
    curation: {
      keepPrecision: number;
      keepRecall: number;
      rejectRecall: number;
      manualRecall: number;
      manualEscalationRate: number;
    };
    vision: {
      identityAccuracy: number;
      unsupportedClaimQuarantineRecall: number;
    };
    slotPlanning: { compatibleReferencePrecision: number; slotCoverage: number };
    fallbackRate: number;
    fallbackRateByRole: { curation: number; vision: number; slotPlanning: number };
    unsafe: {
      unknownCandidateAcceptances: number;
      deterministicRuleBypasses: number;
      manualReviewBypasses: number;
      unsafeIdentityAcceptances: number;
      unsupportedFactPromotions: number;
      incompatibleReferenceAcceptances: number;
    };
  };
  blockers: string[];
  passed: boolean;
  evaluationHash: string;
}

export function hashAiMediaPlanningEvaluationResult(
  result: Omit<AiMediaPlanningEvaluationResult, 'evaluationHash'> | AiMediaPlanningEvaluationResult,
): string {
  const { evaluationHash: _evaluationHash, ...payload } = result as AiMediaPlanningEvaluationResult;
  return hashAiMediaPlanningJson(payload);
}

const ROLE_TEMPLATE_KEYS: Record<AiMediaPlanningTemplateRole, string> = {
  curation: AI_MEDIA_CURATION_TEMPLATE_KEY,
  vision: AI_MEDIA_VISION_TEMPLATE_KEY,
  slot_planning: AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
};

function required(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const result = required(value, label, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function requireExactKeys(actual: string[], expected: string[], label: string) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  if (left.length !== actual.length
    || right.length !== expected.length
    || left.length !== right.length
    || left.some((value, index) => value !== right[index])) {
    throw new TypeError(`${label} must cover the complete evaluation scope`);
  }
}

function parsedJsonObject(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function validateSandboxProvenance(
  item: AiMediaPlanningEvaluationCase,
  requestIds: Set<string>,
  evaluatedAt: Date,
) {
  const provenance = item.provenance;
  if (!provenance) throw new TypeError('Recorded sandbox case provenance is required');
  required(provenance.sandboxRunId, 'sandboxRunId', 200);
  const providerRequestId = required(provenance.providerRequestId, 'providerRequestId', 200);
  if (requestIds.has(providerRequestId)) {
    throw new TypeError('Recorded sandbox provider request IDs must be unique');
  }
  requestIds.add(providerRequestId);
  if (!Array.isArray(provenance.sourceMediaHashes)
    || provenance.sourceMediaHashes.length < 1
    || provenance.sourceMediaHashes.length > 25
    || new Set(provenance.sourceMediaHashes).size !== provenance.sourceMediaHashes.length) {
    throw new TypeError('Recorded sandbox source media hashes are invalid');
  }
  provenance.sourceMediaHashes.forEach((value) => sha256(value, 'sourceMediaHash'));
  sha256(provenance.compiledPromptHash, 'compiledPromptHash');
  sha256(provenance.providerRequestHash, 'providerRequestHash');
  const rawResponseHash = sha256(provenance.rawResponseHash, 'rawResponseHash');
  if (rawResponseHash !== hashAiMediaPlanningJson(item.modelOutput)) {
    throw new TypeError('Recorded sandbox raw response hash does not match model output');
  }
  const recordedAt = new Date(provenance.recordedAt);
  if (!Number.isFinite(recordedAt.getTime())
    || recordedAt.toISOString() !== provenance.recordedAt
    || recordedAt > evaluatedAt) {
    throw new TypeError('Recorded sandbox timestamp is invalid');
  }
}

function validatePolicy(policy: AiMediaPlanningEvaluationPolicy) {
  if (policy.policyVersion !== 'ai-media-model-planning-evaluation-policy/v1') {
    throw new TypeError('AI media planning evaluation policy is unsupported');
  }
  for (const value of Object.values(policy.minimumCases)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      throw new TypeError('AI media planning minimum case coverage is invalid');
    }
  }
  for (const value of [
    policy.minimumKeepPrecision,
    policy.minimumKeepRecall,
    policy.minimumRejectRecall,
    policy.minimumManualRecall,
    policy.maximumManualEscalationRate,
    policy.minimumIdentityAccuracy,
    policy.minimumUnsupportedClaimQuarantineRecall,
    policy.minimumCompatibleReferencePrecision,
    policy.minimumSlotCoverage,
    policy.maximumFallbackRate,
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError('AI media planning evaluation threshold is invalid');
    }
  }
}

function normalizedBindings(bindings: AiMediaPlanningTemplateBinding[]) {
  if (!Array.isArray(bindings) || bindings.length !== 3) {
    throw new TypeError('AI media planning requires three template bindings');
  }
  const roles = new Set<AiMediaPlanningTemplateRole>();
  return bindings.map((binding) => {
    if (!(binding.role in ROLE_TEMPLATE_KEYS) || roles.has(binding.role)) {
      throw new TypeError('AI media planning template roles are invalid');
    }
    roles.add(binding.role);
    const expectedKey = ROLE_TEMPLATE_KEYS[binding.role];
    if (binding.templateKey !== expectedKey) {
      throw new TypeError('AI media planning template key does not match its role');
    }
    const consumer = verifyAiPromptConsumerContract(binding.templateKey);
    if (binding.consumerSchemaVersion !== consumer.schemaVersion
      || binding.consumerNormalizerVersion !== consumer.normalizerVersion
      || binding.consumerContractHash !== consumer.contractHash) {
      throw new TypeError('AI media planning consumer binding changed');
    }
    if (!Number.isSafeInteger(binding.sequence) || binding.sequence < 1) {
      throw new TypeError('AI media planning template sequence is invalid');
    }
    return {
      role: binding.role,
      templateKey: binding.templateKey,
      releaseId: required(binding.releaseId, 'releaseId'),
      revisionId: required(binding.revisionId, 'revisionId'),
      sequence: binding.sequence,
      checksum: sha256(binding.checksum, 'checksum'),
      consumerSchemaVersion: binding.consumerSchemaVersion,
      consumerNormalizerVersion: binding.consumerNormalizerVersion,
      consumerContractHash: sha256(binding.consumerContractHash, 'consumerContractHash'),
    };
  }).sort((left, right) => left.role < right.role ? -1 : left.role > right.role ? 1 : 0);
}

export function hashAiMediaPlanningTemplateBindings(
  bindings: AiMediaPlanningTemplateBinding[],
): string {
  return hashAiMediaPlanningJson({
    contractVersion: 'ai-media-planning-template-set/v1',
    templates: normalizedBindings(bindings),
  });
}

export function evaluateAiMediaPlanningFixtureSet(input: {
  evidenceLevel: AiMediaPlanningEvaluationEvidenceLevel;
  fixtureSetId: string;
  provider: string;
  model: string;
  providerConfigHash: string;
  templateBindings: AiMediaPlanningTemplateBinding[];
  cases: AiMediaPlanningEvaluationCase[];
  policy: AiMediaPlanningEvaluationPolicy;
  evaluatedAt: string;
}): AiMediaPlanningEvaluationResult {
  if (input.evidenceLevel !== 'CONTRACT_FIXTURE'
    && input.evidenceLevel !== 'RECORDED_SANDBOX_MODEL') {
    throw new TypeError('AI media planning evidence level is invalid');
  }
  validatePolicy(input.policy);
  const fixtureSetId = required(input.fixtureSetId, 'fixtureSetId', 200);
  const provider = required(input.provider, 'provider', 100);
  const model = required(input.model, 'model', 200);
  const providerConfigHash = sha256(input.providerConfigHash, 'providerConfigHash');
  const evaluatedAt = new Date(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAt.getTime()) || evaluatedAt.toISOString() !== input.evaluatedAt) {
    throw new TypeError('AI media planning evaluatedAt is invalid');
  }
  if (!Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > 10_000) {
    throw new TypeError('AI media planning evaluation cases are invalid');
  }
  const ids = new Set<string>();
  const caseFingerprints = new Set<string>();
  const providerRequestIds = new Set<string>();
  const cases = input.cases.map((item) => {
    const id = required(item?.id, 'case.id', 200);
    if (ids.has(id)) throw new TypeError('AI media planning evaluation case IDs must be unique');
    ids.add(id);
    const { id: _id, ...casePayload } = item;
    const caseFingerprint = hashAiMediaPlanningJson(casePayload);
    if (caseFingerprints.has(caseFingerprint)) {
      throw new TypeError('AI media planning evaluation cases must contain unique evidence');
    }
    caseFingerprints.add(caseFingerprint);
    if (input.evidenceLevel === 'RECORDED_SANDBOX_MODEL') {
      validateSandboxProvenance(item, providerRequestIds, evaluatedAt);
    }
    return item;
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const fixtureSetHash = hashAiMediaPlanningJson({
    schemaVersion: 'ai-media-model-planning-fixture-set/v1', fixtureSetId, cases,
  });
  const templateSetHash = hashAiMediaPlanningTemplateBindings(input.templateBindings);
  const policyHash = hashAiMediaPlanningJson(input.policy);

  const counts = { curation: 0, vision: 0, slotPlanning: 0, total: cases.length };
  let curationFallbacks = 0;
  let visionFallbacks = 0;
  let slotPlanningFallbacks = 0;
  let keepTrue = 0;
  let keepPredicted = 0;
  let keepGold = 0;
  let rejectTrue = 0;
  let rejectGold = 0;
  let manualTrue = 0;
  let manualGold = 0;
  let manualPredicted = 0;
  let curationLabels = 0;
  let identityTrue = 0;
  let identityGold = 0;
  let expectedClaims = 0;
  let quarantinedClaims = 0;
  let goldSlots = 0;
  let coveredSlots = 0;
  let predictedReferences = 0;
  let compatibleReferences = 0;
  const unsafe = {
    unknownCandidateAcceptances: 0,
    deterministicRuleBypasses: 0,
    manualReviewBypasses: 0,
    unsafeIdentityAcceptances: 0,
    unsupportedFactPromotions: 0,
    incompatibleReferenceAcceptances: 0,
  };

  for (const item of cases) {
    if (item.kind === 'curation') {
      counts.curation += 1;
      const scopedCandidateIds = item.context.candidates.map((candidate) => candidate.id);
      requireExactKeys(
        scopedCandidateIds,
        Object.keys(item.gold.dispositions),
        'Curation gold dispositions',
      );
      if (Object.values(item.gold.dispositions).some((value) => (
        value !== 'keep' && value !== 'reject' && value !== 'manual'
      ))) {
        throw new TypeError('Curation gold disposition is invalid');
      }
      const result = normalizeAiPromptConsumerOutput({
        templateKey: AI_MEDIA_CURATION_TEMPLATE_KEY,
        context: item.context,
        modelOutput: item.modelOutput,
      });
      const normalized = result.normalized as ImageCurationPlan;
      if (!result.accepted) curationFallbacks += 1;
      const candidateIds = new Set(scopedCandidateIds);
      unsafe.unknownCandidateAcceptances += normalized.selectedCandidateIds
        .filter((candidateId) => !candidateIds.has(candidateId)).length;
      const deterministic = new Map(createDeterministicImageCuration(item.context.candidates)
        .decisions.map((decision) => [decision.candidateId, decision.disposition]));
      const predicted = new Map(normalized.decisions.map((decision) => [decision.candidateId, decision.disposition]));
      for (const [candidateId, gold] of Object.entries(item.gold.dispositions)) {
        const value = predicted.get(candidateId) || 'manual';
        curationLabels += 1;
        if (gold === 'keep') keepGold += 1;
        if (gold === 'reject') rejectGold += 1;
        if (gold === 'manual') manualGold += 1;
        if (value === 'keep') keepPredicted += 1;
        if (value === 'manual') manualPredicted += 1;
        if (gold === 'keep' && value === 'keep') keepTrue += 1;
        if (gold === 'reject' && value === 'reject') rejectTrue += 1;
        if (gold === 'manual' && value === 'manual') manualTrue += 1;
        if (gold === 'manual' && value !== 'manual') {
          unsafe.manualReviewBypasses += 1;
        }
        if (value === 'keep' && deterministic.get(candidateId) !== 'keep') {
          unsafe.deterministicRuleBypasses += 1;
        }
      }
      continue;
    }

    if (item.kind === 'vision') {
      counts.vision += 1;
      requireExactKeys(
        item.context.candidateIds,
        Object.keys(item.gold.identities),
        'Vision gold identities',
      );
      const scopedCandidateIds = new Set(item.context.candidateIds);
      if (Object.keys(item.gold.unsupportedClaimFields).some((candidateId) => (
        !scopedCandidateIds.has(candidateId)
      ))) {
        throw new TypeError('Vision unsupported-claim gold references an unknown candidate');
      }
      const result = normalizeAiPromptConsumerOutput({
        templateKey: AI_MEDIA_VISION_TEMPLATE_KEY,
        context: item.context,
        modelOutput: item.modelOutput,
      });
      const normalized = result.normalized as NormalizedAiImageVisionOutput;
      if (!result.accepted) visionFallbacks += 1;
      const predicted = new Map(normalized.images.map((image) => [image.candidateId, image.productIdentity]));
      for (const [candidateId, gold] of Object.entries(item.gold.identities)) {
        const value = predicted.get(candidateId) || 'uncertain';
        identityGold += 1;
        if (value === gold) identityTrue += 1;
        if ((gold === 'different_product' || gold === 'uncertain')
          && (value === 'same_product' || value === 'variant')) {
          unsafe.unsafeIdentityAcceptances += 1;
        }
      }
      const claims = new Set(normalized.unsupportedClaims.map((claim) => `${claim.candidateId}\u0000${claim.field}`));
      for (const [candidateId, fields] of Object.entries(item.gold.unsupportedClaimFields)) {
        for (const field of fields) {
          expectedClaims += 1;
          if (claims.has(`${candidateId}\u0000${field}`)) quarantinedClaims += 1;
        }
      }
      if (hashAiMediaPlanningJson(normalized.verifiedFacts)
        !== hashAiMediaPlanningJson(item.context.verifiedFacts)) {
        unsafe.unsupportedFactPromotions += 1;
      }
      continue;
    }

    if (item.kind !== 'slot_planning') throw new TypeError('AI media planning case kind is invalid');
    counts.slotPlanning += 1;
    const baseSlots = createRuleBasedImagePromptPlan(item.context).slots.map((slot) => slot.slotKey);
    const goldSlotKeys = Object.keys(item.gold.allowedReferences);
    requireExactKeys(baseSlots, goldSlotKeys, 'Slot-planning gold references');
    const scopedImageIds = new Set(item.context.images.map((image) => image.candidateId));
    for (const [slotKey, allowedIds] of Object.entries(item.gold.allowedReferences)) {
      if (!Array.isArray(allowedIds)
        || new Set(allowedIds).size !== allowedIds.length
        || allowedIds.some((candidateId) => !scopedImageIds.has(candidateId))) {
        throw new TypeError(`Slot-planning gold references are invalid for ${slotKey}`);
      }
    }
    const result = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
      context: item.context,
      modelOutput: item.modelOutput,
    });
    const normalized = result.normalized as ImagePromptPlan;
    const normalizedSlots = new Map(normalized.slots.map((slot) => [
      slot.slotKey,
      new Set(slot.references.map((reference) => reference.candidateId)),
    ]));
    const raw = validateAiImagePromptPlanModelOutput(item.modelOutput)
      ? parsedJsonObject(item.modelOutput)
      : null;
    const rawSlots = new Map<string, string[]>();
    for (const slot of (raw?.slots as Array<Record<string, unknown>> | undefined) || []) {
      if (typeof slot.slotKey !== 'string' || rawSlots.has(slot.slotKey)) continue;
      rawSlots.set(slot.slotKey, Array.isArray(slot.referenceCandidateIds)
        ? [...new Set(slot.referenceCandidateIds.filter((value): value is string => typeof value === 'string'))]
        : []);
    }
    let caseCoveredSlots = 0;
    for (const [slotKey, allowedIds] of Object.entries(item.gold.allowedReferences)) {
      const allowed = new Set(allowedIds);
      const rawReferences = rawSlots.get(slotKey);
      for (const candidateId of rawReferences || []) {
        predictedReferences += 1;
        const accepted = normalizedSlots.get(slotKey)?.has(candidateId) || false;
        if (allowed.has(candidateId) && accepted) compatibleReferences += 1;
        if (!allowed.has(candidateId) && accepted) unsafe.incompatibleReferenceAcceptances += 1;
      }
      const slotCovered = rawReferences !== undefined && (allowed.size === 0
        ? rawReferences.length === 0
        : rawReferences.some((candidateId) => (
          allowed.has(candidateId) && (normalizedSlots.get(slotKey)?.has(candidateId) || false)
        )));
      if (slotCovered) caseCoveredSlots += 1;
    }
    goldSlots += goldSlotKeys.length;
    coveredSlots += caseCoveredSlots;
    if (!result.accepted || caseCoveredSlots !== goldSlotKeys.length) {
      slotPlanningFallbacks += 1;
    }
  }

  const fallbackRateByRole = {
    curation: ratio(curationFallbacks, counts.curation),
    vision: ratio(visionFallbacks, counts.vision),
    slotPlanning: ratio(slotPlanningFallbacks, counts.slotPlanning),
  };
  const metrics = {
    curation: {
      keepPrecision: ratio(keepTrue, keepPredicted),
      keepRecall: ratio(keepTrue, keepGold),
      rejectRecall: ratio(rejectTrue, rejectGold),
      manualRecall: ratio(manualTrue, manualGold),
      manualEscalationRate: ratio(manualPredicted, curationLabels),
    },
    vision: {
      identityAccuracy: ratio(identityTrue, identityGold),
      unsupportedClaimQuarantineRecall: ratio(quarantinedClaims, expectedClaims),
    },
    slotPlanning: {
      compatibleReferencePrecision: ratio(compatibleReferences, predictedReferences),
      slotCoverage: ratio(coveredSlots, goldSlots),
    },
    fallbackRate: ratio(
      curationFallbacks + visionFallbacks + slotPlanningFallbacks,
      counts.total,
    ),
    fallbackRateByRole,
    unsafe,
  };
  const blockers: string[] = [];
  if (counts.curation < input.policy.minimumCases.curation) blockers.push('insufficient_curation_cases');
  if (counts.vision < input.policy.minimumCases.vision) blockers.push('insufficient_vision_cases');
  if (counts.slotPlanning < input.policy.minimumCases.slotPlanning) blockers.push('insufficient_slot_planning_cases');
  if (metrics.curation.keepPrecision < input.policy.minimumKeepPrecision) blockers.push('keep_precision_below_threshold');
  if (metrics.curation.keepRecall < input.policy.minimumKeepRecall) blockers.push('keep_recall_below_threshold');
  if (metrics.curation.rejectRecall < input.policy.minimumRejectRecall) blockers.push('reject_recall_below_threshold');
  if (metrics.curation.manualRecall < input.policy.minimumManualRecall) blockers.push('manual_recall_below_threshold');
  if (metrics.curation.manualEscalationRate > input.policy.maximumManualEscalationRate) blockers.push('manual_escalation_rate_exceeded');
  if (metrics.vision.identityAccuracy < input.policy.minimumIdentityAccuracy) blockers.push('identity_accuracy_below_threshold');
  if (metrics.vision.unsupportedClaimQuarantineRecall < input.policy.minimumUnsupportedClaimQuarantineRecall) blockers.push('unsupported_claim_quarantine_below_threshold');
  if (metrics.slotPlanning.compatibleReferencePrecision < input.policy.minimumCompatibleReferencePrecision) blockers.push('reference_precision_below_threshold');
  if (metrics.slotPlanning.slotCoverage < input.policy.minimumSlotCoverage) blockers.push('slot_coverage_below_threshold');
  if (metrics.fallbackRate > input.policy.maximumFallbackRate) blockers.push('fallback_rate_exceeded');
  if (metrics.fallbackRateByRole.curation > input.policy.maximumFallbackRate) blockers.push('curation_fallback_rate_exceeded');
  if (metrics.fallbackRateByRole.vision > input.policy.maximumFallbackRate) blockers.push('vision_fallback_rate_exceeded');
  if (metrics.fallbackRateByRole.slotPlanning > input.policy.maximumFallbackRate) blockers.push('slot_planning_fallback_rate_exceeded');
  if (Object.values(unsafe).some((value) => value > 0)) blockers.push('unsafe_acceptance_detected');

  const resultWithoutHash = {
    schemaVersion: 'ai-media-model-planning-evaluation/v1' as const,
    evidenceLevel: input.evidenceLevel,
    fixtureSetId,
    fixtureSetHash,
    provider,
    model,
    providerConfigHash,
    templateSetHash,
    policyHash,
    evaluatedAt: input.evaluatedAt,
    caseCounts: counts,
    metrics,
    blockers,
    passed: blockers.length === 0,
  };
  return {
    ...resultWithoutHash,
    evaluationHash: hashAiMediaPlanningEvaluationResult(resultWithoutHash),
  };
}
