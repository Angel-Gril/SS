import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAiImageWanxTrial } from '../../services/ai-image-wanx-trial-preparation.js';
import { claimAiImageWanxTrialOperation, loadAiImageWanxTrialExecution } from '../../services/ai-image-wanx-trial-execution.js';
import { authorizeAiImageWanxTrialCampaign, inspectAiImageWanxTrialCampaignHistory } from '../../services/ai-image-wanx-trial-campaign.js';
import { AiPromptTemplateRegistryService } from '../../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../../services/ai-prompt-templates.js';
import { AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE, AI_IMAGE_WANX21_DIRECTION_FIRST_EXPERIMENTAL_PROFILE } from '../../services/ai-image-edit-prompt-contract.js';
import { makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from './ai-image-wanx-trial.js';

export async function wanxReassignmentFileDigests(path: string): Promise<Array<[string, string]>> {
  if (!(await lstat(path)).isDirectory()) return [[path, trialDigest(await readFile(path))]];
  const entries: Array<[string, string]> = [];
  for (const name of (await readdir(path)).sort()) entries.push(...await wanxReassignmentFileDigests(join(path, name)));
  return entries;
}

export async function makeWanxReassignmentFixture(repositoryRoot: string, roots: string[], executionRevision = 'c'.repeat(40)) {
  const root = await mkdtemp(join(tmpdir(), 'wanx-reassignment-'));
  roots.push(root);
  const save = async (name: string, value: unknown) => {
    const path = join(root, name); const bytes = trialJson(value);
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
    return { path, sha256: trialDigest(bytes) };
  };
  const prepare = async (request: { roundId: string; adapterRevision: string }) => {
    const input = await save(`${request.roundId}.input.json`, request);
    const expected = { roundId: request.roundId, adapterRevision: request.adapterRevision,
      providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision };
    const prepared = await prepareAiImageWanxTrial({ repositoryRoot, evidenceRoot: root, expected,
      requestPath: input.path, requestSha256: input.sha256, assertRevision: async () => undefined });
    return { prepared, expected };
  };
  const round = async (roundId: string, revision: string, directionFirst = false) => {
    const request = await makeWanxTrialInput(root, revision, roundId);
    const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => 'Unused synthetic prompt' });
    for (const operation of request.operations) {
      const prompt = `Preserve the item; synthetic background ${roundId} ${operation.operation}.`;
      const negativePrompt = 'No text or new objects.';
      const frozen = await registry.resolveTemplate({ templateKey: operation.frozenPrompt.templateKey,
        renderingProfile: directionFirst && operation.operation === 'INPAINT'
          ? AI_IMAGE_WANX21_DIRECTION_FIRST_EXPERIMENTAL_PROFILE : AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE,
        variables: { userPrompt: prompt, userNegativePrompt: negativePrompt } });
      operation.frozenPrompt = { prompt, negativePrompt, resolvedPrompt: frozen.resolvedPrompt,
        resolvedNegativePrompt: frozen.resolvedNegativePrompt, templateKey: operation.frozenPrompt.templateKey,
        templateReleaseId: frozen.release.id, templateChecksum: frozen.checksum, templateSnapshot: frozen.snapshot };
    }
    return prepare(request);
  };
  const approvalFor = (execution: Awaited<ReturnType<typeof loadAiImageWanxTrialExecution>>) => ({
    approvalId: `approve-${execution.selected.operationId}`, approvalSha256: trialDigest(`approved-${execution.selected.operationId}`),
    approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    approverRefSha256: trialDigest('synthetic-approver'), providerAccountRefSha256: trialAccountDigest,
    pricingRevisionSha256: trialDigest('synthetic-price'), currency: 'CNY',
    preCallBillingSnapshotRefSha256: trialDigest('synthetic-before'), billingReconciliationRefSha256: trialDigest('synthetic-unsettled'),
  });
  const claim = (execution: Awaited<ReturnType<typeof loadAiImageWanxTrialExecution>>) => claimAiImageWanxTrialOperation({
    execution, approval: approvalFor(execution), requestFingerprint: execution.binding.requestFingerprint, now: () => new Date(),
  });
  for (let index = 0; index < 4; index++) {
    const old = await round(`reassign-history-${index}`, 'a'.repeat(40));
    await claim(await loadAiImageWanxTrialExecution({ repositoryRoot, evidenceRoot: root, expected: old.expected,
      manifestSha256: old.prepared.manifestSha256, operation: 'FULL_EDIT', assertRevision: async () => undefined }));
  }
  const original = await round('reassign-first-proposal', 'a'.repeat(40));
  const prior = original.prepared.manifest;
  const grantRequest = structuredClone(prior.request);
  grantRequest.roundId = `${prior.request.roundId}-exec`;
  grantRequest.adapterRevision = 'b'.repeat(40);
  for (const operation of grantRequest.operations) {
    operation.operationId = `${grantRequest.roundId}-${operation.operation.toLowerCase()}`;
    operation.source.path = `wanx-trial-${prior.request.roundId}/${operation.source.path}`;
    if (operation.mask) operation.mask.path = `wanx-trial-${prior.request.roundId}/${operation.mask.path}`;
  }
  const grantedRound = await prepare(grantRequest);
  const scope = { repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest };
  const initialHistory = (await inspectAiImageWanxTrialCampaignHistory(scope)).history;
  const originalProposal = await save('original-proposal.json', {
    kind: 'WANX_VISUAL_RETEST_INPUT_PROPOSAL', status: 'INPUTS_PREPARED_NOT_AUTHORIZED',
    roundId: prior.request.roundId, inputPreparationRevision: prior.request.adapterRevision,
    requiresFreshFrozenExecutionRevision: true, requiresBudgetExtensionImplementation: true, requiresNewBudgetAuthorization: true,
    historicalAllocatedMaximumCost: { currency: 'CNY', amount: 1, scale: 0 },
    proposedAdditionalMaximumCost: { currency: 'CNY', amount: 50, scale: 2 },
    proposedCumulativeMaximumCost: { currency: 'CNY', amount: 150, scale: 2 }, maximumNewRequests: 2,
    sequence: 'INPAINT_FIRST_STOP_IF_QUALITY_FAILS_THEN_FULL_EDIT', canSubmit: false,
    draftSha256: trialDigest('synthetic-original-draft'), inputSha256: prior.sourceInputSha256, manifestSha256: original.prepared.manifestSha256,
    operations: prior.request.operations.map(operation => ({ operationId: operation.operationId, operation: operation.operation,
      sourceSha256: operation.source.sha256, maskSha256: operation.mask?.sha256 ?? null,
      quotedCost: operation.quotedCost, maximumCost: operation.maximumCost, prompt: operation.frozenPrompt.prompt,
      negativePrompt: operation.frozenPrompt.negativePrompt, renderedCharacters: Array.from(operation.frozenPrompt.resolvedPrompt).length,
      resolvedPromptSha256: trialDigest(operation.frozenPrompt.resolvedPrompt),
      renderingProfile: (operation.frozenPrompt.templateSnapshot as { renderingContract?: { profile?: string } }).renderingContract?.profile })),
    verifiedCanSubmit: false, realProviderRequests: 0,
  });
  const originalConsent = await save('original-consent.json', { schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_BUDGET_CONSENT_V1',
    statement: 'I_APPROVE_EXACT_WANX_VISUAL_RETEST_ADDITIONAL_CNY_0_50',
    approvedAt: new Date(Date.now() - 60_000).toISOString(), approverRefSha256: trialDigest('synthetic-original-human'),
    proposalSha256: originalProposal.sha256, history: initialHistory,
    execution: { ...grantedRound.expected, manifestSha256: grantedRound.prepared.manifestSha256,
      operations: grantedRound.prepared.manifest.bindings.map(binding => ({ operation: binding.operation,
        approvedOperationId: prior.request.operations.find(operation => operation.operation === binding.operation)!.operationId,
        operationId: binding.operationId, requestFingerprint: binding.requestFingerprint })) },
    additionalMaximumCost: { currency: 'CNY', amount: 50, scale: 2 }, cumulativeMaximumCost: { currency: 'CNY', amount: 150, scale: 2 },
    sequence: 'INPAINT_FIRST_STOP_IF_QUALITY_FAILS_THEN_FULL_EDIT',
  });
  const grant = await authorizeAiImageWanxTrialCampaign({ ...scope, expected: grantedRound.expected,
    manifestSha256: grantedRound.prepared.manifestSha256, proposal: originalProposal, approval: originalConsent,
    history: initialHistory, assertRevision: async () => undefined });
  const fifth = await loadAiImageWanxTrialExecution({ ...scope, expected: grantedRound.expected,
    manifestSha256: grantedRound.prepared.manifestSha256, operation: 'INPAINT',
    campaignAuthorizationSha256: grant.authorizationSha256, assertRevision: async () => undefined });
  await claim(fifth);
  const fifthApproval = approvalFor(fifth);
  const report = { schemaVersion: 5, operationId: fifth.selected.operationId, operation: 'INPAINT', state: 'SUCCEEDED',
    provider: 'dashscope-wanx21-image-edit', model: fifth.manifest.request.model, adapterRevision: grantedRound.expected.adapterRevision,
    credentialRevision: trialCredentialRevision, requestProfile: fifth.binding.requestProfile, promptSha256: fifth.binding.promptSha256,
    sourceSha256: [fifth.binding.sourceSha256], maskSha256: fifth.binding.maskSha256,
    quotedCost: fifth.selected.quotedCost, maximumCost: fifth.selected.maximumCost, actualCost: null,
    approvalEvidence: { approvalId: fifthApproval.approvalId, approvalSha256: fifthApproval.approvalSha256 },
    imageCount: 1, width: 1024, height: 1024, completedAt: new Date().toISOString() };
  const reportRef = await save(`${fifth.selected.operationId}.report.json`, report);
  const candidate = await round('reassign-new-inpaint', executionRevision, true);
  const candidateBinding = candidate.prepared.manifest.bindings.find(item => item.operation === 'INPAINT')!;
  const oldFull = grantedRound.prepared.manifest.bindings.find(item => item.operation === 'FULL_EDIT')!;
  const history = (await inspectAiImageWanxTrialCampaignHistory(scope)).history;
  const revokedOperation = { roundId: grantedRound.expected.roundId, manifestSha256: grantedRound.prepared.manifestSha256,
    operation: 'FULL_EDIT' as const, operationId: oldFull.operationId, requestFingerprint: oldFull.requestFingerprint };
  const proposal = { schemaVersion: 1, kind: 'WANX_TRIAL_SINGLE_INPAINT_REASSIGNMENT_PROPOSAL_V1', canSubmit: false,
    originalAuthorizationSha256: grant.authorizationSha256, history, priorInpaintReportSha256: reportRef.sha256,
    revokedOperation, execution: { ...candidate.expected, manifestSha256: candidate.prepared.manifestSha256,
      operation: 'INPAINT' as const, operationId: candidateBinding.operationId, requestFingerprint: candidateBinding.requestFingerprint,
      frozenPromptSha256: candidateBinding.frozenPromptSha256 }, requestCount: 1,
    maximumCost: { currency: 'CNY', amount: 25, scale: 2 }, cumulativeMaximumCost: { currency: 'CNY', amount: 150, scale: 2 } };
  const proposalRef = await save('reassignment-proposal.json', proposal);
  const { canSubmit: _canSubmit, kind: _kind, ...bindings } = proposal;
  const consent = { ...bindings, kind: 'WANX_TRIAL_FULL_EDIT_TO_INPAINT_REASSIGNMENT_CONSENT_V1',
    statement: 'I_APPROVE_REASSIGN_UNUSED_WANX_FULL_EDIT_CNY_0_25_TO_ONE_INPAINT', approvedAt: new Date().toISOString(),
    approverRefSha256: trialDigest('synthetic-reassignment-approver'), humanApprovalSha256: trialDigest('synthetic-explicit-new-human-approval'),
    proposalSha256: proposalRef.sha256 };
  const approvalRef = await save('reassignment-consent.json', consent);
  const input = { ...scope, expected: candidate.expected, manifestSha256: candidate.prepared.manifestSha256,
    originalAuthorizationSha256: grant.authorizationSha256, proposal: proposalRef, approval: approvalRef, history,
    assertRevision: async () => undefined };
  const reassignmentPath = join(fifth.directory, 'execution', 'FULL_EDIT.reassigned.json');
  const execution = (pin?: string, operation = 'INPAINT') => loadAiImageWanxTrialExecution({ ...scope,
    expected: candidate.expected, manifestSha256: candidate.prepared.manifestSha256, operation,
    campaignAuthorizationSha256: grant.authorizationSha256, campaignReassignmentSha256: pin,
    assertRevision: async () => undefined } as Parameters<typeof loadAiImageWanxTrialExecution>[0]);
  return { root, scope, grant, grantedRound, fifth, report, reportRef, candidate, oldFull, history, proposal, consent,
    input, reassignmentPath, execution, claim, save, originalFiles: await wanxReassignmentFileDigests(root) };
}
