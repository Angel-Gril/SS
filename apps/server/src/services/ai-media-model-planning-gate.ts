import {
  AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY_HASH,
  hashAiMediaPlanningEvaluationResult,
  hashAiMediaPlanningTemplateBindings,
  type AiMediaPlanningEvaluationResult,
  type AiMediaPlanningTemplateBinding,
} from './ai-media-planning-evaluation.js';

export interface AiMediaModelPlanningGatePolicy {
  state: 'NOT_READY' | 'READY';
  approvedFixtureSetId: string | null;
  approvedFixtureSetHash: string | null;
  provider: string | null;
  model: string | null;
  providerConfigHash: string | null;
  evaluationPolicyHash: string | null;
  maxEvaluationAgeMs: number;
}

export interface AiMediaModelPlanningApproval {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  evaluationHash: string;
  templateSetHash: string;
  fixtureSetHash: string;
  reviewerUserId: string | null;
  reviewedAt: string | null;
}

export type AiMediaModelPlanningGateReason =
  | 'approved'
  | 'policy_not_ready'
  | 'evidence_not_sandbox_recorded'
  | 'evaluation_integrity_invalid'
  | 'evaluation_failed'
  | 'evaluation_policy_changed'
  | 'fixture_binding_changed'
  | 'provider_binding_changed'
  | 'template_binding_changed'
  | 'approval_missing'
  | 'approval_binding_changed'
  | 'freshness_policy_changed'
  | 'evaluation_expired'
  | 'durable_gate_not_implemented';

export const AI_MEDIA_MODEL_PLANNING_GATE_POLICY: AiMediaModelPlanningGatePolicy = Object.freeze({
  state: 'NOT_READY',
  approvedFixtureSetId: null,
  approvedFixtureSetHash: null,
  provider: null,
  model: null,
  providerConfigHash: null,
  evaluationPolicyHash: AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY_HASH,
  maxEvaluationAgeMs: 30 * 24 * 60 * 60 * 1000,
});

export function evaluateAiMediaModelPlanningGateCandidate(input: {
  policy: AiMediaModelPlanningGatePolicy;
  evaluation: AiMediaPlanningEvaluationResult;
  activeTemplateBindings: AiMediaPlanningTemplateBinding[];
  approval: AiMediaModelPlanningApproval | null;
  now?: Date;
}): { eligible: boolean; reason: AiMediaModelPlanningGateReason } {
  if (input.policy.state !== 'READY') return { eligible: false, reason: 'policy_not_ready' };
  if (input.evaluation.evidenceLevel !== 'RECORDED_SANDBOX_MODEL') {
    return { eligible: false, reason: 'evidence_not_sandbox_recorded' };
  }
  if (hashAiMediaPlanningEvaluationResult(input.evaluation) !== input.evaluation.evaluationHash) {
    return { eligible: false, reason: 'evaluation_integrity_invalid' };
  }
  if (!input.evaluation.passed || input.evaluation.blockers.length > 0) {
    return { eligible: false, reason: 'evaluation_failed' };
  }
  if (input.policy.evaluationPolicyHash !== AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY_HASH
    || input.evaluation.policyHash !== AI_MEDIA_MODEL_PLANNING_EVALUATION_POLICY_HASH) {
    return { eligible: false, reason: 'evaluation_policy_changed' };
  }
  if (input.policy.approvedFixtureSetId !== input.evaluation.fixtureSetId
    || input.policy.approvedFixtureSetHash !== input.evaluation.fixtureSetHash) {
    return { eligible: false, reason: 'fixture_binding_changed' };
  }
  if (input.policy.provider !== input.evaluation.provider
    || input.policy.model !== input.evaluation.model
    || input.policy.providerConfigHash !== input.evaluation.providerConfigHash) {
    return { eligible: false, reason: 'provider_binding_changed' };
  }
  const activeTemplateSetHash = hashAiMediaPlanningTemplateBindings(input.activeTemplateBindings);
  if (activeTemplateSetHash !== input.evaluation.templateSetHash) {
    return { eligible: false, reason: 'template_binding_changed' };
  }
  const approval = input.approval;
  if (!approval
    || approval.status !== 'APPROVED'
    || !approval.reviewerUserId
    || !approval.reviewedAt) {
    return { eligible: false, reason: 'approval_missing' };
  }
  if (approval.evaluationHash !== input.evaluation.evaluationHash
    || approval.templateSetHash !== input.evaluation.templateSetHash
    || approval.fixtureSetHash !== input.evaluation.fixtureSetHash) {
    return { eligible: false, reason: 'approval_binding_changed' };
  }
  if (input.policy.maxEvaluationAgeMs !== AI_MEDIA_MODEL_PLANNING_GATE_POLICY.maxEvaluationAgeMs) {
    return { eligible: false, reason: 'freshness_policy_changed' };
  }
  const now = input.now || new Date();
  const evaluatedAt = new Date(input.evaluation.evaluatedAt);
  const reviewedAt = new Date(approval.reviewedAt);
  if (!Number.isFinite(now.getTime())
    || !Number.isFinite(evaluatedAt.getTime())
    || !Number.isFinite(reviewedAt.getTime())
    || reviewedAt < evaluatedAt
    || reviewedAt > now
    || evaluatedAt > now
    || !Number.isSafeInteger(input.policy.maxEvaluationAgeMs)
    || input.policy.maxEvaluationAgeMs < 1
    || now.getTime() - evaluatedAt.getTime() > input.policy.maxEvaluationAgeMs) {
    return { eligible: false, reason: 'evaluation_expired' };
  }
  return { eligible: true, reason: 'approved' };
}

export function evaluateAiMediaModelPlanningGate(
  input: Parameters<typeof evaluateAiMediaModelPlanningGateCandidate>[0],
): { enabled: boolean; reason: AiMediaModelPlanningGateReason } {
  const candidate = evaluateAiMediaModelPlanningGateCandidate(input);
  return candidate.eligible
    ? { enabled: false, reason: 'durable_gate_not_implemented' }
    : { enabled: false, reason: candidate.reason };
}
