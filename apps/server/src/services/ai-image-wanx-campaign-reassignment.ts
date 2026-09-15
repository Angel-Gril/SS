import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AiImageWanxTrialError, type buildAiImageWanxTrialPreparation } from './ai-image-wanx-trial-preparation.js';
import { wanxCampaignArtifactSchema, wanxCampaignHistorySchema, wanxCampaignAuthorizationSchema,
  type WanxCampaignHistory } from './ai-image-wanx-campaign-authorization.js';

// This name intentionally violates the old execution directory allowlist. Older
// frozen readers must stop after the unused FULL_EDIT authorization is revoked.
export const WANX_REASSIGNMENT_FILE = 'FULL_EDIT.reassigned.json';
export const WANX_REASSIGNMENT_STATEMENT = 'I_APPROVE_REASSIGN_UNUSED_WANX_FULL_EDIT_CNY_0_25_TO_ONE_INPAINT';
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u);
const time = z.string().datetime().refine(value => new Date(value).toISOString() === value);
const maximum = z.object({ currency: z.literal('CNY'), amount: z.literal(25), scale: z.literal(2) }).strict();
const ceiling = z.object({ currency: z.literal('CNY'), amount: z.literal(150), scale: z.literal(2) }).strict();
const history = wanxCampaignHistorySchema.extend({ campaignScopeSha256: sha, reservationSha256s: z.array(sha).length(5), tipSha256: sha });
const bindings = {
  originalAuthorizationSha256: sha, history, priorInpaintReportSha256: sha,
  revokedOperation: z.object({ roundId: id.max(64), manifestSha256: sha, operation: z.literal('FULL_EDIT'),
    operationId: id, requestFingerprint: sha }).strict(),
  execution: z.object({ roundId: id.max(64), adapterRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
    providerAccountUidSha256: sha, credentialRevision: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    manifestSha256: sha, operation: z.literal('INPAINT'), operationId: id, requestFingerprint: sha, frozenPromptSha256: sha }).strict(),
  requestCount: z.literal(1), maximumCost: maximum, cumulativeMaximumCost: ceiling,
};
export const wanxReassignmentProposalSchema = z.object({ schemaVersion: z.literal(1),
  kind: z.literal('WANX_TRIAL_SINGLE_INPAINT_REASSIGNMENT_PROPOSAL_V1'), canSubmit: z.literal(false), ...bindings }).strict();
export const wanxReassignmentConsentSchema = z.object({ schemaVersion: z.literal(1),
  kind: z.literal('WANX_TRIAL_FULL_EDIT_TO_INPAINT_REASSIGNMENT_CONSENT_V1'), statement: z.literal(WANX_REASSIGNMENT_STATEMENT),
  approvedAt: time, approverRefSha256: sha, humanApprovalSha256: sha, proposalSha256: sha, ...bindings }).strict();
export const wanxReassignmentRecordSchema = z.object({ schemaVersion: z.literal(1),
  kind: z.literal('WANX_TRIAL_FULL_EDIT_TO_INPAINT_REASSIGNMENT_V1'), canSubmit: z.literal(false), billingReconciliation: z.literal('REQUIRED'),
  proposal: wanxCampaignArtifactSchema, approval: wanxCampaignArtifactSchema, consent: wanxReassignmentConsentSchema }).strict();
export type WanxReassignmentConsent = z.infer<typeof wanxReassignmentConsentSchema>;
export type WanxReassignmentRecord = z.infer<typeof wanxReassignmentRecordSchema>;
type Manifest = Awaited<ReturnType<typeof buildAiImageWanxTrialPreparation>>['manifest'];
type Authorization = z.infer<typeof wanxCampaignAuthorizationSchema>;

function invalid(code = 'WANX_TRIAL_CAMPAIGN_REASSIGNMENT_INVALID'): never {
  throw new AiImageWanxTrialError(code, 'Reassignment requires a new explicit approval for one unused FULL_EDIT quarter and one exact INPAINT');
}

export function validateWanxReassignment(input: {
  proposal: Record<string, unknown>; proposalSha256: string; consent: WanxReassignmentConsent;
  authorization: Authorization; authorizationSha256: string; original: Manifest;
  candidate: Manifest; candidateSha256: string; history: WanxCampaignHistory; now: Date;
}) {
  const { consent, original, candidate, authorization } = input;
  const proposal = wanxReassignmentProposalSchema.parse(input.proposal);
  const full = original.bindings.find(binding => binding.operation === 'FULL_EDIT')!;
  const previousInpaint = original.bindings.find(binding => binding.operation === 'INPAINT')!;
  const next = candidate.bindings.find(binding => binding.operation === 'INPAINT')!;
  const selected = candidate.request.operations.find(operation => operation.operation === 'INPAINT')!;
  if (!Number.isFinite(input.now.getTime()) || Date.parse(consent.approvedAt) > input.now.getTime()
    || Date.parse(consent.approvedAt) < Date.parse(authorization.consent.approvedAt)
    || consent.originalAuthorizationSha256 !== input.authorizationSha256 || consent.proposalSha256 !== input.proposalSha256
    || [authorization.approval.sha256, authorization.consent.approverRefSha256].includes(consent.humanApprovalSha256)
    || !isDeepStrictEqual(consent.history, input.history)
    || candidate.request.roundId === original.request.roundId || candidate.request.adapterRevision === original.request.adapterRevision
    || candidate.request.provider !== original.request.provider || candidate.request.model !== original.request.model
    || candidate.request.apiBase !== original.request.apiBase
    || candidate.request.providerAccountUidSha256 !== original.request.providerAccountUidSha256
    || candidate.request.credentialRevision !== original.request.credentialRevision
    || next.requestFingerprint === previousInpaint.requestFingerprint
    || [full.operationId, previousInpaint.operationId].includes(next.operationId)
    || !isDeepStrictEqual(selected.maximumCost, { currency: 'CNY', amount: 25, scale: 2 })
    || !isDeepStrictEqual(selected.quotedCost, { currency: 'CNY', amount: 14, scale: 2 })) invalid();
  const expected = { originalAuthorizationSha256: input.authorizationSha256, history: input.history,
    priorInpaintReportSha256: consent.priorInpaintReportSha256,
    revokedOperation: { roundId: original.request.roundId, manifestSha256: authorization.consent.execution.manifestSha256,
      operation: 'FULL_EDIT', operationId: full.operationId, requestFingerprint: full.requestFingerprint },
    execution: { roundId: candidate.request.roundId, adapterRevision: candidate.request.adapterRevision,
      providerAccountUidSha256: candidate.request.providerAccountUidSha256, credentialRevision: candidate.request.credentialRevision,
      manifestSha256: input.candidateSha256, operation: 'INPAINT', operationId: next.operationId,
      requestFingerprint: next.requestFingerprint, frozenPromptSha256: next.frozenPromptSha256 },
    requestCount: 1, maximumCost: { currency: 'CNY', amount: 25, scale: 2 }, cumulativeMaximumCost: { currency: 'CNY', amount: 150, scale: 2 } };
  const { schemaVersion: _version, kind: _kind, statement: _statement, approvedAt: _time,
    approverRefSha256: _approver, humanApprovalSha256: _human, proposalSha256: _proposal, ...actual } = consent;
  if (!isDeepStrictEqual(actual, expected)
    || !isDeepStrictEqual(proposal, { schemaVersion: 1, kind: 'WANX_TRIAL_SINGLE_INPAINT_REASSIGNMENT_PROPOSAL_V1', canSubmit: false, ...expected })) invalid();
}

export function validateWanxReassignmentPriorReport(input: {
  report: Record<string, unknown>; original: Manifest; consent: WanxReassignmentConsent;
  allocation: { operationId: string; approvalId: string; approvalSha256: string; requestFingerprint: string };
}) {
  const { report, original, consent, allocation } = input;
  const operation = original.request.operations.find(operation => operation.operation === 'INPAINT')!;
  const binding = original.bindings.find(binding => binding.operation === 'INPAINT')!;
  const approval = report.approvalEvidence as Record<string, unknown> | undefined;
  const completedAt = time.parse(report.completedAt);
  if (report.schemaVersion !== 5 || report.state !== 'SUCCEEDED' || report.actualCost !== null
    || report.operation !== 'INPAINT' || report.operationId !== operation.operationId || allocation.operationId !== operation.operationId
    || allocation.requestFingerprint !== binding.requestFingerprint || approval?.approvalId !== allocation.approvalId
    || approval?.approvalSha256 !== allocation.approvalSha256 || report.provider !== 'dashscope-wanx21-image-edit'
    || report.model !== original.request.model || report.adapterRevision !== original.request.adapterRevision
    || report.credentialRevision !== original.request.credentialRevision || report.requestProfile !== binding.requestProfile
    || report.promptSha256 !== binding.promptSha256 || !isDeepStrictEqual(report.sourceSha256, [binding.sourceSha256])
    || report.maskSha256 !== binding.maskSha256 || !isDeepStrictEqual(report.quotedCost, operation.quotedCost)
    || !isDeepStrictEqual(report.maximumCost, operation.maximumCost) || report.imageCount !== 1 || report.width !== 1024 || report.height !== 1024
    || Date.parse(completedAt) > Date.parse(consent.approvedAt)) invalid('WANX_TRIAL_CAMPAIGN_REASSIGNMENT_PRIOR_OUTCOME_INVALID');
}
