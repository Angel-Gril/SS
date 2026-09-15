import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AiImageWanxTrialError, type buildAiImageWanxTrialPreparation } from './ai-image-wanx-trial-preparation.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u);
const time = z.string().datetime().refine(value => new Date(value).toISOString() === value);
const fixedMoney = (amount: number) => z.object({ currency: z.literal('CNY'), amount: z.literal(amount), scale: z.literal(2) }).strict();
export const WANX_ADDITIONAL_AUTHORIZATION_FILE = 'wanx-campaign.authorization.json';
export const WANX_ADDITIONAL_MAXIMUM = Object.freeze({ currency: 'CNY', amount: 50, scale: 2 });
export const WANX_AUTHORIZED_CUMULATIVE_MAXIMUM = Object.freeze({ currency: 'CNY', amount: 150, scale: 2 });
export const WANX_RETEST_SEQUENCE = 'INPAINT_FIRST_STOP_IF_QUALITY_FAILS_THEN_FULL_EDIT';
export const wanxCampaignArtifactSchema = z.object({ path: z.string().min(1).max(2048), sha256: sha }).strict();
export type WanxCampaignArtifact = z.infer<typeof wanxCampaignArtifactSchema>;
export const wanxCampaignHistorySchema = z.object({
  evidenceRootSha256: sha, campaignScopeSha256: sha.nullable(), reservationSha256s: z.array(sha).max(256),
  tipSha256: sha.nullable(), allocationsSha256: sha,
}).strict();
export type WanxCampaignHistory = z.infer<typeof wanxCampaignHistorySchema>;
export const wanxCampaignConsentSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_TRIAL_CAMPAIGN_BUDGET_CONSENT_V1'),
  statement: z.literal('I_APPROVE_EXACT_WANX_VISUAL_RETEST_ADDITIONAL_CNY_0_50'),
  approvedAt: time, approverRefSha256: sha, proposalSha256: sha, history: wanxCampaignHistorySchema,
  execution: z.object({ roundId: id.max(64), manifestSha256: sha,
    adapterRevision: z.string().regex(/^[a-f0-9]{40}$/u), providerAccountUidSha256: sha,
    credentialRevision: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    operations: z.array(z.object({ operation: z.enum(['FULL_EDIT', 'INPAINT']), approvedOperationId: id,
      operationId: id, requestFingerprint: sha }).strict()).length(2),
  }).strict(),
  additionalMaximumCost: fixedMoney(50), cumulativeMaximumCost: fixedMoney(150), sequence: z.literal(WANX_RETEST_SEQUENCE),
}).strict();
export type WanxCampaignConsent = z.infer<typeof wanxCampaignConsentSchema>;
export const wanxCampaignAuthorizationSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_V1'),
  canSubmit: z.literal(false), billingReconciliation: z.literal('REQUIRED'),
  proposal: wanxCampaignArtifactSchema, approval: wanxCampaignArtifactSchema, consent: wanxCampaignConsentSchema,
}).strict();
export const wanxInpaintQualitySchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_TRIAL_INPAINT_QUALITY_APPROVAL_V1'),
  statement: z.literal('I_CONFIRM_THIS_INPAINT_PASSES_BEFORE_FULL_EDIT'), authorizationSha256: sha,
  inpaintOperationId: id, inpaintRequestFingerprint: sha, reportSha256: sha, imageSha256: sha,
  reviewerRefSha256: sha, reviewedAt: time, decision: z.literal('PASS'),
  checks: z.object({ targetColor: z.literal(true), boundary: z.literal(true), productIdentity: z.literal(true),
    outsideMaskPixelsUnchanged: z.literal(true) }).strict(),
}).strict();

function invalid(): never {
  throw new AiImageWanxTrialError('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_INVALID', 'Additional authorization must bind the exact approved retest and unchanged history');
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Manifest = Awaited<ReturnType<typeof buildAiImageWanxTrialPreparation>>['manifest'];

export function validateWanxCampaignConsentTime(consent: WanxCampaignConsent, now: Date) {
  if (!Number.isFinite(now.getTime()) || Date.parse(consent.approvedAt) > now.getTime()) invalid();
}

/** The new identifiers identify execution artifacts, never additional visual samples. */
export function validateWanxCampaignProposal(proposal: Record<string, unknown>, original: Manifest,
  candidate: Manifest, candidateSha256: string, consent: WanxCampaignConsent) {
  if (!sha.safeParse(proposal.draftSha256).success || !sha.safeParse(proposal.manifestSha256).success) invalid();
  const originalOperations = original.request.operations;
  const expectedProposal = {
    kind: 'WANX_VISUAL_RETEST_INPUT_PROPOSAL', status: 'INPUTS_PREPARED_NOT_AUTHORIZED',
    roundId: original.request.roundId, inputPreparationRevision: original.request.adapterRevision,
    requiresFreshFrozenExecutionRevision: true, requiresBudgetExtensionImplementation: true,
    requiresNewBudgetAuthorization: true, historicalAllocatedMaximumCost: { currency: 'CNY', amount: 1, scale: 0 },
    proposedAdditionalMaximumCost: WANX_ADDITIONAL_MAXIMUM,
    proposedCumulativeMaximumCost: WANX_AUTHORIZED_CUMULATIVE_MAXIMUM, maximumNewRequests: 2,
    sequence: WANX_RETEST_SEQUENCE, canSubmit: false, draftSha256: proposal.draftSha256,
    inputSha256: original.sourceInputSha256, manifestSha256: proposal.manifestSha256,
    operations: originalOperations.map(operation => ({ operationId: operation.operationId, operation: operation.operation,
      sourceSha256: operation.source.sha256, maskSha256: operation.mask?.sha256 ?? null,
      quotedCost: operation.quotedCost, maximumCost: operation.maximumCost,
      prompt: operation.frozenPrompt.prompt, negativePrompt: operation.frozenPrompt.negativePrompt,
      renderedCharacters: Array.from(operation.frozenPrompt.resolvedPrompt).length,
      resolvedPromptSha256: digest(operation.frozenPrompt.resolvedPrompt),
      renderingProfile: (operation.frozenPrompt.templateSnapshot as { renderingContract?: { profile?: string } }).renderingContract?.profile,
    })), verifiedCanSubmit: false, realProviderRequests: 0,
  };
  if (!isDeepStrictEqual(proposal, expectedProposal)
    || candidate.request.roundId !== `${original.request.roundId}-exec`
    || candidate.request.adapterRevision === original.request.adapterRevision) invalid();
  const operations = originalOperations.map(operation => ({ ...operation,
    operationId: `${candidate.request.roundId}-${operation.operation.toLowerCase()}` }));
  if (!isDeepStrictEqual(candidate.request, { ...original.request,
    roundId: candidate.request.roundId, adapterRevision: candidate.request.adapterRevision, operations })) invalid();
  for (const operation of candidate.request.operations) {
    if (!isDeepStrictEqual(operation.maximumCost, { currency: 'CNY', amount: 25, scale: 2 })
      || !isDeepStrictEqual(operation.quotedCost, { currency: 'CNY', amount: 14, scale: 2 })) invalid();
  }
  if (!isDeepStrictEqual(consent.execution, {
    roundId: candidate.request.roundId, adapterRevision: candidate.request.adapterRevision,
    providerAccountUidSha256: candidate.request.providerAccountUidSha256,
    credentialRevision: candidate.request.credentialRevision, manifestSha256: candidateSha256,
    operations: candidate.bindings.map(binding => ({ operation: binding.operation,
      approvedOperationId: originalOperations.find(operation => operation.operation === binding.operation)!.operationId,
      operationId: binding.operationId, requestFingerprint: binding.requestFingerprint })),
  })) invalid();
}
