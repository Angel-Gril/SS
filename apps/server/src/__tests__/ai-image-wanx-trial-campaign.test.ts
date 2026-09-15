import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimAiImageWanxTrialOperation, loadAiImageWanxTrialExecution,
} from '../services/ai-image-wanx-trial-execution.js';
import { prepareAiImageWanxTrial } from '../services/ai-image-wanx-trial-preparation.js';
import { writeAiImageSandboxPrivateEvidenceFile } from '../services/ai-image-sandbox-billing-settlement.js';
import * as privateEvidence from '../services/ai-image-sandbox-billing-settlement.js';
import { inspectAiImageWanxTrialCampaign } from '../services/ai-image-wanx-trial-campaign.js';
import * as campaignOwner from '../services/ai-image-wanx-trial-campaign.js';
import { sanitizeAiImageSandboxGitEnvironment } from '../services/ai-image-sandbox-code-revision.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../services/ai-prompt-templates.js';
import { AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE } from '../services/ai-image-edit-prompt-contract.js';
import type { AiImageSandboxApprovalEvidence } from '../services/ai-image-sandbox-approval.js';
import type { AiImageSandboxMoney } from '../services/ai-image-sandbox-money.js';
import { makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from './fixtures/ai-image-wanx-trial.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const revision = 'a'.repeat(40);
const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(root).startsWith('wanx-campaign-'));
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'wanx-campaign-'));
  roots.push(evidenceRoot);
  return evidenceRoot;
}

async function round(evidenceRoot: string, id: string, options: {
  maximum?: AiImageSandboxMoney; account?: string; credential?: string; fingerprintTag?: string;
} = {}) {
  const roundId = `campaign-round-${id}`;
  const request = await makeWanxTrialInput(evidenceRoot, revision, roundId);
  request.providerAccountUidSha256 = options.account || trialAccountDigest;
  request.credentialRevision = options.credential || trialCredentialRevision;
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), {
    getLegacyPrompt: async () => 'Unused synthetic legacy prompt',
  });
  for (const operation of request.operations) {
    const prompt = `Preserve the synthetic item; background fixture ${options.fingerprintTag || id} ${operation.operation}.`;
    const frozen = await registry.resolveTemplate({ templateKey: operation.frozenPrompt.templateKey,
      renderingProfile: AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE,
      variables: { userPrompt: prompt, userNegativePrompt: 'Keep the synthetic fixture identity.' } });
    operation.frozenPrompt = { prompt, negativePrompt: 'Keep the synthetic fixture identity.',
      resolvedPrompt: frozen.resolvedPrompt, resolvedNegativePrompt: frozen.resolvedNegativePrompt,
      templateKey: operation.frozenPrompt.templateKey, templateReleaseId: frozen.release.id,
      templateChecksum: frozen.checksum, templateSnapshot: frozen.snapshot };
    if (operation.operation === 'FULL_EDIT' && options.maximum) {
      operation.maximumCost = options.maximum;
      operation.quotedCost = { currency: 'CNY', amount: 1, scale: options.maximum.scale };
    }
  }
  const bytes = trialJson(request);
  const requestPath = join(evidenceRoot, `${roundId}.input.json`);
  await writeFile(requestPath, bytes, { mode: 0o600 });
  const expected = { roundId, adapterRevision: revision, providerAccountUidSha256: request.providerAccountUidSha256,
    credentialRevision: request.credentialRevision };
  const prepared = await prepareAiImageWanxTrial({ repositoryRoot, evidenceRoot, expected,
    requestPath, requestSha256: trialDigest(bytes), assertRevision: async () => undefined });
  const executionInput = { repositoryRoot, evidenceRoot, expected, manifestSha256: prepared.manifestSha256, operation: 'FULL_EDIT' };
  const execution = await loadAiImageWanxTrialExecution({ ...executionInput, assertRevision: async () => undefined });
  const approval: AiImageSandboxApprovalEvidence = {
    approvalId: `approve-${roundId}`, approvalSha256: trialDigest(`approval-${roundId}`),
    approvedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    approverRefSha256: trialDigest('synthetic-approver'), providerAccountRefSha256: trialAccountDigest,
    pricingRevisionSha256: trialDigest('synthetic-pricing'), currency: 'CNY',
    preCallBillingSnapshotRefSha256: trialDigest('synthetic-before'), billingReconciliationRefSha256: trialDigest('synthetic-pending'),
  };
  return { execution, executionInput, approval, prepared };
}

async function claim(value: Awaited<ReturnType<typeof round>>) {
  return claimAiImageWanxTrialOperation({ execution: value.execution, approval: value.approval,
    requestFingerprint: value.execution.binding.requestFingerprint, now: () => new Date() });
}

// Reproduce the old writer's closed record format from a real verified preparation.
// These fixtures predate campaign reservations; no arbitrary amount list is imported.
function legacyRecords(value: Awaited<ReturnType<typeof round>>) {
  const { execution, approval } = value;
  const roundRecord = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_BUDGET_V1', roundId: execution.trialBinding.roundId,
    manifestSha256: execution.trialBinding.manifestSha256, evidenceRootSha256: execution.trialBinding.evidenceRootSha256,
    maximumCost: execution.manifest.request.maximumCost, allocatedMaximumCost: execution.manifest.allocatedMaximumCost,
    slots: execution.manifest.request.operations.map(operation => ({ operation: operation.operation,
      operationId: operation.operationId, maximumCost: operation.maximumCost,
      requestFingerprint: execution.manifest.bindings.find(binding => binding.operation === operation.operation)!.requestFingerprint })),
  };
  const roundBytes = trialJson(roundRecord);
  const claimRecord = { schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_OPERATION_CLAIM_V1', state: 'CLAIMED_FAIL_CLOSED',
    roundSha256: trialDigest(roundBytes), operation: execution.selected.operation, operationId: execution.selected.operationId,
    approvalId: approval.approvalId, approvalSha256: approval.approvalSha256,
    requestFingerprint: execution.binding.requestFingerprint, maximumCost: execution.selected.maximumCost,
    createdAt: new Date().toISOString() };
  return { roundRecord, roundBytes, claimRecord };
}

async function legacyClaim(value: Awaited<ReturnType<typeof round>>, outcome = 'SUCCEEDED') {
  const { execution } = value;
  const { roundRecord, roundBytes, claimRecord } = legacyRecords(value);
  const directory = join(execution.directory, 'execution');
  await writeAiImageSandboxPrivateEvidenceFile(join(directory, 'round.json'), roundBytes, execution.evidenceRoot);
  await writeAiImageSandboxPrivateEvidenceFile(join(directory, 'FULL_EDIT.claim.json'), trialJson(claimRecord), execution.evidenceRoot);
  // Status / free-quota observations must never release an authorization ceiling.
  await writeFile(join(execution.evidenceRoot, `${execution.selected.operationId}.observation.json`),
    trialJson({ state: outcome, observedPayable: { currency: 'CNY', amount: 0, scale: 0 } }), { mode: 0o600 });
  return { directory, roundRecord, claimRecord };
}

async function threeLegacy(evidenceRoot: string) {
  const values = [];
  for (const [index, outcome] of ['SUCCEEDED_FREE_QUOTA', 'RECONCILIATION_REQUIRED', 'REJECTED'].entries()) {
    const value = await round(evidenceRoot, `legacy-${index}`);
    const old = await legacyClaim(value, outcome);
    values.push({ value, old });
  }
  return values;
}

async function treeDigests(path: string): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = [];
  for (const name of (await readdir(path)).sort()) {
    const target = join(path, name);
    const metadata = await lstat(target);
    if (metadata.isDirectory()) result.push(...await treeDigests(target));
    else result.push([target, trialDigest(await readFile(target))]);
  }
  return result;
}

function campaignApi(name: string) {
  const fn = (campaignOwner as Record<string, any>)[name];
  expect(typeof fn, `${name} must implement scoped additional authorization`).toBe('function');
  return fn;
}

async function additionalAuthorizationFixture(historicalAmounts?: number[]) {
  const root = await fixture();
  if (historicalAmounts) {
    for (let index = 0; index < 3; index++) await legacyClaim(await round(root, `legacy-varied-${index}`,
      { maximum: { currency: 'CNY', amount: historicalAmounts[index]!, scale: 2 } }));
  } else await threeLegacy(root);
  const fourth = await round(root, 'fourth-authorized', historicalAmounts
    ? { maximum: { currency: 'CNY', amount: historicalAmounts[3]!, scale: 2 } } : {});
  await claim(fourth);
  const original = await round(root, 'visual-proposal');
  const prior = original.prepared.manifest;
  const executionRoundId = `${prior.request.roundId}-exec`;
  const request = structuredClone(prior.request);
  request.roundId = executionRoundId;
  request.adapterRevision = 'b'.repeat(40);
  for (const operation of request.operations) {
    operation.operationId = `${executionRoundId}-${operation.operation.toLowerCase()}`;
    operation.source.path = `wanx-trial-${prior.request.roundId}/${operation.source.path}`;
    if (operation.mask) operation.mask.path = `wanx-trial-${prior.request.roundId}/${operation.mask.path}`;
  }
  const expected = { roundId: executionRoundId, adapterRevision: request.adapterRevision,
    providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision };
  const requestPath = join(root, 'execution-input.json');
  await writeFile(requestPath, trialJson(request), { mode: 0o600 });
  const prepared = await prepareAiImageWanxTrial({ repositoryRoot, evidenceRoot: root, expected,
    requestPath, requestSha256: trialDigest(trialJson(request)), assertRevision: async () => undefined });
  const proposal = {
    kind: 'WANX_VISUAL_RETEST_INPUT_PROPOSAL', status: 'INPUTS_PREPARED_NOT_AUTHORIZED',
    roundId: prior.request.roundId, inputPreparationRevision: revision,
    requiresFreshFrozenExecutionRevision: true, requiresBudgetExtensionImplementation: true,
    requiresNewBudgetAuthorization: true, historicalAllocatedMaximumCost: { currency: 'CNY', amount: 1, scale: 0 },
    proposedAdditionalMaximumCost: { currency: 'CNY', amount: 50, scale: 2 },
    proposedCumulativeMaximumCost: { currency: 'CNY', amount: 150, scale: 2 }, maximumNewRequests: 2,
    sequence: 'INPAINT_FIRST_STOP_IF_QUALITY_FAILS_THEN_FULL_EDIT', canSubmit: false,
    draftSha256: trialDigest('synthetic-draft'), inputSha256: prior.sourceInputSha256,
    manifestSha256: original.prepared.manifestSha256,
    operations: prior.request.operations.map(operation => ({ operationId: operation.operationId,
      operation: operation.operation, sourceSha256: operation.source.sha256, maskSha256: operation.mask?.sha256 ?? null,
      quotedCost: operation.quotedCost, maximumCost: operation.maximumCost,
      prompt: operation.frozenPrompt.prompt, negativePrompt: operation.frozenPrompt.negativePrompt,
      renderedCharacters: Array.from(operation.frozenPrompt.resolvedPrompt).length,
      resolvedPromptSha256: trialDigest(operation.frozenPrompt.resolvedPrompt),
      renderingProfile: (operation.frozenPrompt.templateSnapshot as any).renderingContract.profile,
    })), verifiedCanSubmit: false, realProviderRequests: 0,
  };
  const save = async (name: string, value: unknown) => {
    const path = join(root, name); const bytes = trialJson(value);
    await writeFile(path, bytes, { mode: 0o600 });
    return { path, sha256: trialDigest(bytes) };
  };
  const proposalRef = await save('proposal.json', proposal);
  const scope = { repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest };
  const observed = await campaignApi('inspectAiImageWanxTrialCampaignHistory')(scope);
  const history = observed.history;
  const consent = { schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_BUDGET_CONSENT_V1',
    statement: 'I_APPROVE_EXACT_WANX_VISUAL_RETEST_ADDITIONAL_CNY_0_50',
    approvedAt: new Date(Date.now() - 120_000).toISOString(), approverRefSha256: trialDigest('synthetic-user-approval'),
    proposalSha256: proposalRef.sha256, history,
    execution: { ...expected, manifestSha256: prepared.manifestSha256,
      operations: prepared.manifest.bindings.map(binding => ({ operation: binding.operation,
        approvedOperationId: prior.request.operations.find(item => item.operation === binding.operation)!.operationId,
        operationId: binding.operationId, requestFingerprint: binding.requestFingerprint })) },
    additionalMaximumCost: proposal.proposedAdditionalMaximumCost,
    cumulativeMaximumCost: proposal.proposedCumulativeMaximumCost, sequence: proposal.sequence,
  };
  const approval = await save('consent.json', consent);
  const input = { ...scope, expected, manifestSha256: prepared.manifestSha256, proposal: proposalRef,
    approval, history, assertRevision: async () => undefined, now: () => new Date() };
  const authorize = () => campaignApi('authorizeAiImageWanxTrialCampaign')(input);
  const execution = async (operation: string, pin?: string, quality?: { path: string; sha256: string }) => loadAiImageWanxTrialExecution({
    repositoryRoot, evidenceRoot: root, expected, manifestSha256: prepared.manifestSha256, operation,
    campaignAuthorizationSha256: pin, inpaintQualityApproval: quality,
    assertRevision: async () => undefined,
  } as any);
  const claimExecution = (execution: Awaited<ReturnType<typeof loadAiImageWanxTrialExecution>>) => {
    const approval = { ...fourth.approval, approvalId: `approve-${execution.selected.operationId}`,
      approvalSha256: trialDigest(`approved-${execution.selected.operationId}`), approvedAt: new Date(Date.now() - 1000).toISOString() };
    return claimAiImageWanxTrialOperation({ execution, approval,
      requestFingerprint: execution.binding.requestFingerprint, now: () => new Date() });
  };
  return { root, original, fourth, expected, prepared, proposal, consent, input, history, scope, save, authorize, execution, claimExecution };
}

async function passingInpaint(value: Awaited<ReturnType<typeof additionalAuthorizationFixture>>, authorizationSha256: string) {
  const execution = await value.execution('INPAINT', authorizationSha256);
  const claimed = await value.claimExecution(execution);
  const image = await readFile(execution.sourcePath);
  const imagePath = join(value.root, 'reviewed-inpaint.png');
  await writeFile(imagePath, image, { mode: 0o600 });
  const report = { schemaVersion: 5, operationId: execution.selected.operationId, operation: 'INPAINT', state: 'SUCCEEDED',
    provider: 'dashscope-wanx21-image-edit', model: execution.manifest.request.model,
    adapterRevision: value.expected.adapterRevision, credentialRevision: trialCredentialRevision,
    requestProfile: execution.binding.requestProfile, promptSha256: execution.binding.promptSha256,
    sourceSha256: [execution.binding.sourceSha256], maskSha256: execution.binding.maskSha256,
    quotedCost: execution.selected.quotedCost, maximumCost: execution.selected.maximumCost, actualCost: null,
    approvalEvidence: { approvalId: `approve-${execution.selected.operationId}`,
      approvalSha256: trialDigest(`approved-${execution.selected.operationId}`) },
    imageCount: 1, width: 1024, height: 1024, mimeType: 'image/png', bytes: image.length, sha256: trialDigest(image), imagePath,
    completedAt: new Date().toISOString(),
  };
  const reportRef = await value.save(`${execution.selected.operationId}.report.json`, report);
  const quality = { schemaVersion: 1, kind: 'WANX_TRIAL_INPAINT_QUALITY_APPROVAL_V1',
    statement: 'I_CONFIRM_THIS_INPAINT_PASSES_BEFORE_FULL_EDIT', authorizationSha256,
    inpaintOperationId: execution.selected.operationId, inpaintRequestFingerprint: execution.binding.requestFingerprint,
    reportSha256: reportRef.sha256, imageSha256: report.sha256, reviewerRefSha256: trialDigest('synthetic-quality-reviewer'),
    reviewedAt: new Date().toISOString(), decision: 'PASS',
    checks: { targetColor: true, boundary: true, productIdentity: true, outsideMaskPixelsUnchanged: true },
  };
  return { execution, claimed, report, quality, qualityRef: await value.save('quality.json', quality) };
}

describe('exact CNY 0.50 additional Wanx authorization', () => {
  it('requires four individual quarters, not merely an aggregate one-yuan history', async () => {
    const value = await additionalAuthorizationFixture([40, 20, 20, 20]);
    await expect(value.authorize()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_AUTHORIZATION_HISTORY_MISMATCH' });
    await expect(lstat(join(value.root, 'wanx-campaign.authorization.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(value.root, 'wanx-campaign.lock.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps empty history inspection read-only', async () => {
    const root = await fixture();
    const result = await campaignApi('inspectAiImageWanxTrialCampaignHistory')({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest });
    expect(result.history.reservationSha256s).toEqual([]);
    expect(result.allocationCount).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it('appends authorization without rewriting the original four allocations and gates the two exact operations in order', async () => {
    const value = await additionalAuthorizationFixture();
    const originalFiles = await treeDigests(join(value.root, 'wanx-campaign'));
    const scopeBytes = await readFile(join(value.root, 'wanx-campaign.scope.json'));
    const authorized = await value.authorize();
    expect(authorized.canSubmit).toBe(false);
    expect(await treeDigests(join(value.root, 'wanx-campaign'))).toEqual(originalFiles);
    expect(await readFile(join(value.root, 'wanx-campaign.scope.json'))).toEqual(scopeBytes);
    await expect(value.execution('INPAINT')).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_AUTHORIZATION_REQUIRED' });
    await expect(value.execution('FULL_EDIT', authorized.authorizationSha256)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_QUALITY_REQUIRED' });
    const inpaint = await passingInpaint(value, authorized.authorizationSha256);
    const full = await value.execution('FULL_EDIT', authorized.authorizationSha256, inpaint.qualityRef);
    const final = await value.claimExecution(full);
    await final.assertCurrent();
    expect(final.campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 15, scale: 1 });
    expect(final.campaign.remainingMaximumCost.amount).toBe(0);
    await expect(value.claimExecution(full)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_ALREADY_RESERVED' });
    await expect(value.authorize()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_AUTHORIZATION_EXISTS' });
    for (const [path, sha256] of originalFiles) expect(trialDigest(await readFile(path))).toBe(sha256);
  }, 30_000);

  it.each(['statement', 'ceiling', 'history tip', 'history digest', 'scope', 'account', 'revision', 'manifest', 'fingerprint', 'future approval'])(
    'rejects an additional consent with changed %s without granting budget', async change => {
      const value = await additionalAuthorizationFixture();
      const consent = value.consent as any;
      if (change === 'statement') consent.statement = 'NOT_APPROVED';
      if (change === 'ceiling') consent.cumulativeMaximumCost.amount = 200;
      if (change === 'history tip') consent.history.tipSha256 = '0'.repeat(64);
      if (change === 'history digest') consent.history.allocationsSha256 = '0'.repeat(64);
      if (change === 'scope') consent.history.campaignScopeSha256 = '0'.repeat(64);
      if (change === 'account') consent.execution.providerAccountUidSha256 = '0'.repeat(64);
      if (change === 'revision') consent.execution.adapterRevision = revision;
      if (change === 'manifest') consent.execution.manifestSha256 = '0'.repeat(64);
      if (change === 'fingerprint') consent.execution.operations[0].requestFingerprint = '0'.repeat(64);
      if (change === 'future approval') consent.approvedAt = '2099-01-01T00:00:00.000Z';
      value.input.approval = await value.save('consent.json', consent);
      await expect(value.authorize()).rejects.toThrow();
      await expect(lstat(join(value.root, 'wanx-campaign.authorization.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it('refuses another round, a wrong pin, and reuse of an earlier operation approval', async () => {
    const value = await additionalAuthorizationFixture();
    const unrelated = await round(value.root, 'not-authorized');
    const authorized = await value.authorize();
    await expect(value.execution('INPAINT', '0'.repeat(64))).rejects.toThrow();
    await expect(loadAiImageWanxTrialExecution({ ...unrelated.executionInput,
      campaignAuthorizationSha256: authorized.authorizationSha256, assertRevision: async () => undefined } as any)).rejects.toThrow();
    const execution = await value.execution('INPAINT', authorized.authorizationSha256);
    await expect(claimAiImageWanxTrialOperation({ execution, approval: value.fourth.approval,
      requestFingerprint: execution.binding.requestFingerprint, now: () => new Date() })).rejects.toThrow();
    expect((await inspectAiImageWanxTrialCampaign(value.scope)).allocationCount).toBe(4);
  }, 20_000);

  it.each(['reject', 'wrong report', 'wrong image', 'changed bytes'])('keeps FULL_EDIT blocked after %s quality evidence', async change => {
    const value = await additionalAuthorizationFixture();
    const authorized = await value.authorize();
    const inpaint = await passingInpaint(value, authorized.authorizationSha256);
    if (change === 'reject') inpaint.quality.decision = 'FAIL';
    if (change === 'wrong report') inpaint.quality.reportSha256 = '0'.repeat(64);
    if (change === 'wrong image') inpaint.quality.imageSha256 = '0'.repeat(64);
    if (change !== 'changed bytes') inpaint.qualityRef = await value.save('quality.json', inpaint.quality);
    else await writeFile(inpaint.report.imagePath, 'changed image bytes');
    await expect(value.execution('FULL_EDIT', authorized.authorizationSha256, inpaint.qualityRef)).rejects.toThrow();
    expect((await inspectAiImageWanxTrialCampaign(value.scope)).allocationCount).toBe(5);
  }, 20_000);

  it('rechecks authorization bytes after reservation and never refunds the fifth operation', async () => {
    const value = await additionalAuthorizationFixture();
    const authorized = await value.authorize();
    const inpaint = await passingInpaint(value, authorized.authorizationSha256);
    await writeFile(authorized.authorizationPath, '{}\n');
    await expect(inpaint.claimed.assertCurrent()).rejects.toThrow();
    expect((await readdir(join(value.root, 'wanx-campaign'))).length).toBe(5);
  }, 20_000);

  it('rejects a copied authorization in another physical root', async () => {
    const value = await additionalAuthorizationFixture();
    const authorized = await value.authorize();
    const copied = await fixture();
    await cp(value.root, copied, { recursive: true });
    await expect(loadAiImageWanxTrialExecution({ repositoryRoot, evidenceRoot: copied, expected: value.expected,
      manifestSha256: value.prepared.manifestSha256, operation: 'INPAINT',
      campaignAuthorizationSha256: authorized.authorizationSha256, assertRevision: async () => undefined }))
      .rejects.toThrow();
  }, 20_000);

  it('keeps the fifth reservation and lock when its operation claim cannot be persisted', async () => {
    const value = await additionalAuthorizationFixture();
    const authorized = await value.authorize();
    const execution = await value.execution('INPAINT', authorized.authorizationSha256);
    const originalWriter = privateEvidence.writeAiImageSandboxPrivateEvidenceFile;
    const writer = vi.spyOn(privateEvidence, 'writeAiImageSandboxPrivateEvidenceFile').mockImplementation(async (path, bytes, root) => {
      if (path.endsWith('INPAINT.claim.json')) throw new Error('Synthetic failure after the additional reservation');
      return originalWriter(path, bytes, root);
    });
    await expect(value.claimExecution(execution)).rejects.toThrow();
    writer.mockRestore();
    const reservations = await readdir(join(value.root, 'wanx-campaign'));
    expect(reservations).toHaveLength(5);
    const fifth = JSON.parse(await readFile(join(value.root, 'wanx-campaign', reservations.sort()[4]!), 'utf8'));
    expect(fifth).toMatchObject({ schemaVersion: 2, campaignAuthorizationSha256: authorized.authorizationSha256,
      maximumCost: { currency: 'CNY', amount: 25, scale: 2 } });
    expect((await lstat(join(value.root, 'wanx-campaign.lock.json'))).isFile()).toBe(true);
    await expect(execution.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
  }, 20_000);

  it('rechecks the quality approval immediately before FULL_EDIT sends', async () => {
    const value = await additionalAuthorizationFixture();
    const authorized = await value.authorize();
    const inpaint = await passingInpaint(value, authorized.authorizationSha256);
    const full = await value.execution('FULL_EDIT', authorized.authorizationSha256, inpaint.qualityRef);
    const claimed = await value.claimExecution(full);
    await writeFile(inpaint.qualityRef.path, '{}\n');
    await expect(claimed.assertCurrent()).rejects.toThrow();
    expect((await readdir(join(value.root, 'wanx-campaign'))).length).toBe(6);
  }, 30_000);
});

describe('Wanx campaign authorization across immutable rounds', () => {
  it.each([['inspect', 0], ['claim', 0], ['inspect', 129]] as const)('allows ordinary wanx-trial-* private files during %s with %s extra notes without counting them as rounds', async (mode, noteCount) => {
    const root = await fixture();
    await threeLegacy(root);
    const files = ['wanx-trial-input.json', 'wanx-trial-preparation-20260913.json',
      ...Array.from({ length: noteCount }, (_, index) => `wanx-trial-private-note-${index}.json`)];
    const bytes = Buffer.from('Synthetic private capture metadata, not an execution directory.\n');
    for (const name of files) await writeFile(join(root, name), bytes, { mode: 0o600 });
    if (mode === 'inspect') {
      const before = await treeDigests(root);
      await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
        .resolves.toMatchObject({ allocatedMaximumCost: { currency: 'CNY', amount: 75, scale: 2 },
          remainingMaximumCost: { currency: 'CNY', amount: 25, scale: 2 }, allocationCount: 3 });
      expect(await treeDigests(root)).toEqual(before);
    } else {
      const accepted = await claim(await round(root, 'ordinary-files-fourth'));
      await accepted.assertCurrent();
      expect(accepted.campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 1, scale: 0 });
    }
    await expect(lstat(join(root, 'wanx-campaign.lock.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const name of files) expect(await readFile(join(root, name))).toEqual(bytes);
  });

  it('observes old allocations without creating a scope, lock or reservation and preserves every old byte', async () => {
    const root = await fixture();
    await threeLegacy(root);
    const before = await treeDigests(root);
    const result = await inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest });
    expect(result).toMatchObject({ observationOnly: true, canSubmit: false, campaignScopeSha256: null,
      maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
      allocatedMaximumCost: { currency: 'CNY', amount: 75, scale: 2 },
      remainingMaximumCost: { currency: 'CNY', amount: 25, scale: 2 },
      allocationCount: 3, legacyClaimCount: 3, reservationCount: 0 });
    expect(await treeDigests(root)).toEqual(before);
    expect((await readdir(root)).some(name => name.startsWith('wanx-campaign'))).toBe(false);
  });

  it('imports three old 0.25 claims, permits the last 0.25 across credential revisions, and refuses any excess before a slot is written', async () => {
    const root = await fixture();
    const old = await threeLegacy(root);
    const original = await Promise.all(old.flatMap(item => ['round.json', 'FULL_EDIT.claim.json'].map(async name => {
      const path = join(item.old.directory, name); return { path, bytes: await readFile(path) };
    })));
    const fourth = await round(root, 'fourth', { credential: 'synthetic-rotated-key-r2' });
    const accepted = await claim(fourth);
    await accepted.assertCurrent();
    const fifth = await round(root, 'fifth');
    await expect(claim(fifth)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED' });
    await expect(lstat(join(fifth.execution.directory, 'execution', 'FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const source of original) expect(await readFile(source.path)).toEqual(source.bytes);
    expect((accepted as any).campaign).toMatchObject({ maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
      allocatedMaximumCost: { currency: 'CNY', amount: 1, scale: 0 }, remainingMaximumCost: { currency: 'CNY', amount: 0, scale: 0 } });
  });

  it('refuses the same paid fingerprint under a new round without allocating it again', async () => {
    const root = await fixture();
    const first = await round(root, 'fingerprint-1', { fingerprintTag: 'same-paid-input' });
    await claim(first);
    const repeat = await round(root, 'fingerprint-2', { fingerprintTag: 'same-paid-input' });
    expect(repeat.execution.binding.requestFingerprint).toBe(first.execution.binding.requestFingerprint);
    await expect(claim(repeat)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_ALREADY_RESERVED' });
    const other = await round(root, 'fingerprint-3');
    const accepted = await claim(other);
    expect((accepted as any).campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 5, scale: 1 });
  });

  it('compares maxima exactly across mixed decimal scales and never releases failed or free legacy claims', async () => {
    const root = await fixture();
    await threeLegacy(root);
    const tooMuch = await round(root, 'precision-over', { maximum: { currency: 'CNY', amount: 25_000_001, scale: 8 } });
    await expect(claim(tooMuch)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED' });
    const exact = await round(root, 'precision-exact', { maximum: { currency: 'CNY', amount: 25_000_000, scale: 8 } });
    const accepted = await claim(exact);
    expect((accepted as any).campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 1, scale: 0 });
  });

  it('binds an account to the physical root and rejects a newly selected account', async () => {
    const root = await fixture();
    await claim(await round(root, 'account-a'));
    const other = await round(root, 'account-b', { account: trialDigest('another-synthetic-account') });
    await expect(claim(other)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH' });
  });

  it.each(['claim amount', 'round amount', 'fingerprint', 'manifest', 'unknown slot'])(
    'rejects corrupted historical %s before allowing another reservation', async change => {
      const root = await fixture();
      const old = await legacyClaim(await round(root, 'corrupt-old'));
      if (change === 'claim amount') old.claimRecord.maximumCost = { currency: 'CNY', amount: 1, scale: 2 };
      if (change === 'fingerprint') old.claimRecord.requestFingerprint = '0'.repeat(64);
      if (change === 'round amount') old.roundRecord.slots[0]!.maximumCost = { currency: 'CNY', amount: 1, scale: 2 };
      if (change === 'manifest') old.roundRecord.manifestSha256 = '0'.repeat(64);
      await writeFile(join(old.directory, 'round.json'), trialJson(old.roundRecord), { mode: 0o600 });
      await writeFile(join(old.directory, 'FULL_EDIT.claim.json'), trialJson(old.claimRecord), { mode: 0o600 });
      if (change === 'unknown slot') await writeFile(join(old.directory, 'HIDDEN.claim.json'), trialJson(old.claimRecord), { mode: 0o600 });
      const next = await round(root, 'after-corrupt');
      await expect(claim(next)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
      await expect(lstat(join(next.execution.directory, 'execution', 'FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('does not charge unrelated ordinary sandbox records but refuses copied legacy scope in a new physical root', async () => {
    const root = await fixture();
    await mkdir(join(root, 'ordinary-sandbox'), { mode: 0o700 });
    await writeFile(join(root, 'ordinary-sandbox', 'report.json'), trialJson({ maximumCost: { currency: 'USD', amount: 99, scale: 0 } }), { mode: 0o600 });
    const old = await legacyClaim(await round(root, 'scope-old'));
    const independent = await fixture();
    const originalRoundDirectory = dirname(old.directory);
    await cp(originalRoundDirectory, join(independent, basename(originalRoundDirectory)), { recursive: true });
    const copied = await round(independent, 'scope-new');
    await expect(claim(copied)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH' });
    const accepted = await claim(await round(root, 'scope-valid'));
    expect((accepted as any).campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 5, scale: 1 });
  });

  it('refuses a linked historical trial directory', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'linked-old'));
    await symlink(dirname(old.directory), join(root, 'wanx-trial-campaign-linked-alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const next = await round(root, 'linked-next');
    await expect(claim(next)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('refuses a junction with the name of an ordinary private capture file', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'linked-capture-old'));
    await symlink(dirname(old.directory), join(root, 'wanx-trial-input.json'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it.each(['regular-file', 'empty-directory'] as const)('does not hide a journaled historical claim by replacing its round with a %s', async replacement => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'journaled-old'));
    const accepted = await claim(await round(root, 'journaled-current'));
    const originalDirectory = dirname(old.directory);
    const archivedDirectory = join(root, 'archived-historical-round');
    for (const path of [originalDirectory, archivedDirectory]) assert.equal(dirname(resolve(path)), resolve(root));
    const ledgerBefore = await treeDigests(join(root, 'wanx-campaign'));
    await rename(originalDirectory, archivedDirectory);
    if (replacement === 'regular-file') await writeFile(originalDirectory, 'Synthetic replacement file\n', { mode: 0o600 });
    else await mkdir(originalDirectory, { mode: 0o700 });
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    await expect(claim(await round(root, 'after-hidden-history'))).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    expect(await treeDigests(join(root, 'wanx-campaign'))).toEqual(ledgerBefore);
  });

  it('rechecks all older claims in the final send assertion', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'assert-old'));
    const accepted = await claim(await round(root, 'assert-new'));
    old.claimRecord.maximumCost = { currency: 'CNY', amount: 1, scale: 2 };
    await writeFile(join(old.directory, 'FULL_EDIT.claim.json'), trialJson(old.claimRecord), { mode: 0o600 });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('keeps the reservation and lock when the operation claim cannot be persisted, without an automatic retry or refund', async () => {
    const root = await fixture();
    const value = await round(root, 'interrupted');
    const originalWriter = privateEvidence.writeAiImageSandboxPrivateEvidenceFile;
    const writer = vi.spyOn(privateEvidence, 'writeAiImageSandboxPrivateEvidenceFile').mockImplementation(async (path, bytes, allowedRoot) => {
      if (path.endsWith(`${process.platform === 'win32' ? '\\' : '/'}FULL_EDIT.claim.json`)) {
        expect((await readdir(join(root, 'wanx-campaign'))).filter(name => name.endsWith('.json'))).toHaveLength(1);
        throw new Error('Synthetic disk failure after campaign reservation');
      }
      return originalWriter(path, bytes, allowedRoot);
    });
    await expect(claim(value)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    writer.mockRestore();
    const entries = (await readdir(join(root, 'wanx-campaign'))).filter(name => name.endsWith('.json'));
    expect(entries).toHaveLength(1);
    const reservation = await readFile(join(root, 'wanx-campaign', entries[0]!));
    expect(JSON.parse(reservation.toString())).toMatchObject({ maximumCost: { currency: 'CNY', amount: 25, scale: 2 }, source: 'RESERVATION' });
    expect((await lstat(join(root, 'wanx-campaign.lock.json'))).isFile()).toBe(true);
    await expect(lstat(join(value.execution.directory, 'execution/FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(claim(await round(root, 'after-interrupted'))).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
    expect(await readFile(join(root, 'wanx-campaign', entries[0]!))).toEqual(reservation);
  });

  it('does not steal an apparently stale lock', async () => {
    const root = await fixture();
    const value = await round(root, 'old-lock');
    const bytes = trialJson({ owner: 'synthetic-exited-process', createdAt: '2000-01-01T00:00:00.000Z' });
    await writeFile(join(root, 'wanx-campaign.lock.json'), bytes, { mode: 0o600 });
    await expect(claim(value)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
    expect(await readFile(join(root, 'wanx-campaign.lock.json'))).toEqual(bytes);
    expect(await readdir(root)).not.toContain('wanx-campaign');
  });

  it('retains a durable reservation and lock after an actual process exits between reservation and slot persistence', async () => {
    const root = await fixture();
    const value = await round(root, 'process-exit');
    const planned = legacyRecords(value);
    const worker = join(root, 'campaign-exit-worker.mjs');
    const inputPath = join(root, 'campaign-exit-input.json');
    await writeFile(inputPath, trialJson({ repositoryRoot, evidenceRoot: root,
      trialBinding: value.execution.trialBinding, operation: 'FULL_EDIT', operationId: value.execution.selected.operationId,
      approvalId: value.approval.approvalId, approvalSha256: value.approval.approvalSha256,
      roundSha256: trialDigest(planned.roundBytes), claimSha256: trialDigest(trialJson(planned.claimRecord)) }), { mode: 0o600 });
    const ownerUrl = pathToFileURL(join(repositoryRoot, 'apps/server/src/services/ai-image-wanx-trial-campaign.ts')).href;
    await writeFile(worker, [
      "import { readFile } from 'node:fs/promises';",
      `import { reserveAiImageWanxTrialCampaignOperation } from ${JSON.stringify(ownerUrl)};`,
      "globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };",
      "const input = JSON.parse(await readFile(process.argv[2], 'utf8'));",
      "await reserveAiImageWanxTrialCampaignOperation({ ...input, assertCurrent: async () => undefined, now: () => new Date() }, async () => process.exit(23));",
    ].join('\n'), { mode: 0o600 });
    const result = await execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(repositoryRoot, 'apps/server/node_modules/tsx/dist/loader.mjs')).href, worker, inputPath,
    ], { cwd: repositoryRoot, windowsHide: true, timeout: 15_000,
      env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'test', DOTENV_CONFIG_PATH: 'NUL', REDIS_DISABLED: '1' },
    }).catch(error => error);
    expect(result.code).toBe(23);
    const entries = await readdir(join(root, 'wanx-campaign'));
    expect(entries).toHaveLength(1);
    expect((await lstat(join(root, 'wanx-campaign.lock.json'))).isFile()).toBe(true);
    await expect(lstat(join(value.execution.directory, 'execution/FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(claim(await round(root, 'after-process-exit'))).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
  }, 30_000);

  it('rejects a changed reservation during both observation and the last send check', async () => {
    const root = await fixture();
    const accepted = await claim(await round(root, 'changed-reservation'));
    const [name] = await readdir(join(root, 'wanx-campaign'));
    const path = join(root, 'wanx-campaign', name!);
    const record = JSON.parse(await readFile(path, 'utf8'));
    record.maximumCost.amount = 1;
    await writeFile(path, trialJson(record), { mode: 0o600 });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('rejects replacing the campaign directory even when all copied bytes match', async () => {
    const root = await fixture();
    const accepted = await claim(await round(root, 'replace-directory'));
    const directory = join(root, 'wanx-campaign');
    const archived = join(root, 'saved-campaign');
    for (const path of [directory, archived]) assert.equal(dirname(resolve(path)), resolve(root));
    await rename(directory, archived);
    await cp(archived, directory, { recursive: true });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH' });
  });

  it('rejects an aliased historical claim with multiple hard links', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'hard-link-old'));
    await link(join(old.directory, 'FULL_EDIT.claim.json'), join(root, 'historical-alias.json'));
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('bounds the number of historical round directories before scanning their contents', async () => {
    const root = await fixture();
    for (let index = 0; index < 129; index++) await mkdir(join(root, `wanx-trial-bounded-round-${index}`), { mode: 0o700 });
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    expect((await readdir(root)).some(name => name.startsWith('wanx-campaign'))).toBe(false);
  });

  it('allows only a budget-sized winner when two actual Node processes compete for the final quarter', async () => {
    const root = await fixture();
    await threeLegacy(root);
    const contenders = await Promise.all([round(root, 'process-a'), round(root, 'process-b')]);
    const gate = join(root, 'start-processes');
    const worker = join(root, 'campaign-worker.mjs');
    const executionUrl = pathToFileURL(join(repositoryRoot, 'apps/server/src/services/ai-image-wanx-trial-execution.ts')).href;
    await writeFile(worker, [
      "import { readFile, writeFile, access } from 'node:fs/promises';",
      `import { loadAiImageWanxTrialExecution, claimAiImageWanxTrialOperation } from ${JSON.stringify(executionUrl)};`,
      "globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };",
      "const input = JSON.parse(await readFile(process.argv[2], 'utf8'));",
      "const execution = await loadAiImageWanxTrialExecution({ ...input.executionInput, assertRevision: async () => undefined });",
      "await writeFile(input.ready, 'ready', { mode: 0o600 });",
      "let ready = false; const deadline = Date.now() + 15000; while (!ready && Date.now() < deadline) { try { await access(input.gate); ready = true; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }",
      "if (!ready) throw new Error('BARRIER_TIMEOUT');",
      "try { const result = await claimAiImageWanxTrialOperation({ execution, approval: input.approval, requestFingerprint: execution.binding.requestFingerprint, now: () => new Date() }); await result.assertCurrent(); process.stdout.write(JSON.stringify({ ok: true })); }",
      "catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code })); }",
    ].join('\n'), { mode: 0o600 });
    const readiness = contenders.map((_, index) => join(root, `ready-${index}`));
    const inputs = await Promise.all(contenders.map(async (value, index) => {
      const path = join(root, `worker-${index}.json`);
      await writeFile(path, trialJson({ executionInput: value.executionInput, approval: value.approval, gate, ready: readiness[index] }), { mode: 0o600 });
      return path;
    }));
    const pending = inputs.map(path => execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(repositoryRoot, 'apps/server/node_modules/tsx/dist/loader.mjs')).href, worker, path,
    ], { cwd: repositoryRoot, windowsHide: true, timeout: 30_000,
      env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'test', DOTENV_CONFIG_PATH: 'NUL', REDIS_DISABLED: '1' } }));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if ((await Promise.all(readiness.map(path => lstat(path).then(() => true, () => false)))).every(Boolean)) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    await writeFile(gate, 'go', { mode: 0o600 });
    const results = (await Promise.all(pending)).map(result => JSON.parse(result.stdout));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok).every(result => ['WANX_TRIAL_CAMPAIGN_LOCKED', 'WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED'].includes(result.code))).toBe(true);
    const written = await Promise.all(contenders.map(value => lstat(join(value.execution.directory, 'execution/FULL_EDIT.claim.json')).then(() => true, () => false)));
    expect(written.filter(Boolean)).toHaveLength(1);
  }, 45_000);
});
