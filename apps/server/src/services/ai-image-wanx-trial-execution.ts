import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { aiImageWanx21EditSubmitEndpoint } from './ai-image-wanx-edit-profile.js';
import {
  assertAiImageSandboxApprovalCurrent,
  type AiImageSandboxApprovalEvidence,
  type AiImageSandboxTrialBinding,
} from './ai-image-sandbox-approval.js';
import {
  readAiImageSandboxPrivateBillingEvidence,
  resolveAiImageSandboxPrivateEvidenceRoot,
  writeAiImageSandboxPrivateEvidenceFile,
} from './ai-image-sandbox-billing-settlement.js';
import {
  AiImageWanxTrialError,
  verifyAiImageWanxTrial,
  type AiImageWanxTrialExpected,
} from './ai-image-wanx-trial-preparation.js';
import { reserveAiImageWanxTrialCampaignOperation } from './ai-image-wanx-trial-campaign.js';

// Additional dependencies reached only by the explicit trial execution mode.
export const AI_IMAGE_WANX_TRIAL_EXECUTION_TRACKED_PATHS = [
  'packages/shared/package.json',
  'apps/server/src/services/ai-image-wanx-trial-execution.ts',
  'apps/server/src/services/ai-image-wanx-trial-campaign.ts',
  'apps/server/src/services/ai-image-wanx-trial-preparation.ts',
  'apps/server/src/services/ai-image-sandbox-billing-settlement.ts',
  'apps/server/src/services/ai-image-sandbox-money.ts',
  'apps/server/src/services/ai-image-edit-prompt-contract.ts',
  'apps/server/src/services/ai-image-edit-provider-contract.ts',
  'apps/server/src/services/ai-image-jobs.ts',
  'apps/server/src/services/ai-image-provider-capabilities.ts',
  'apps/server/src/services/ai-image-provider-runtime-contract.ts',
  'apps/server/src/services/ai-prompt-templates.ts',
  'apps/server/src/services/ai-prompt-consumer-contracts.ts',
  'apps/server/src/services/ai-cost-ledger.ts',
  'apps/server/src/lib/ai-media-transaction.ts',
  'apps/server/src/services/ai-image-curation.ts',
  'apps/server/src/services/ai-image-prompt-plan.ts',
  'apps/server/src/services/ai-image-vision.ts',
  'apps/server/src/services/ai-image-translation.ts',
  'apps/server/src/services/ai-media-planning-contract.ts',
] as const;

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function invalid(code: string, message: string): never {
  throw new AiImageWanxTrialError(code, message);
}

async function rootIdentity(repositoryRoot: string, evidenceRoot: string) {
  const path = await resolveAiImageSandboxPrivateEvidenceRoot(repositoryRoot, evidenceRoot);
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.ino <= 0n) {
    invalid('WANX_TRIAL_ROOT_UNSAFE', 'Trial execution requires a stable private evidence directory');
  }
  return {
    path,
    sha256: digest(JSON.stringify({
      schema: 'ai-image-sandbox-evidence-root/v1',
      path: process.platform === 'win32' ? path.toLowerCase() : path,
      device: metadata.dev.toString(), inode: metadata.ino.toString(), birthtimeNs: metadata.birthtimeNs.toString(),
    })),
  };
}

export async function loadAiImageWanxTrialExecution(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  manifestSha256: string;
  expected: AiImageWanxTrialExpected;
  operation: string;
  assertRevision: () => Promise<void>;
}) {
  if (input.operation !== 'FULL_EDIT' && input.operation !== 'INPAINT') {
    invalid('WANX_TRIAL_OPERATION_INVALID', 'Trial execution supports only full edit and inpaint');
  }
  const root = await rootIdentity(input.repositoryRoot, input.evidenceRoot);
  const verified = await verifyAiImageWanxTrial({ ...input, evidenceRoot: root.path });
  const selected = verified.manifest.request.operations.find((item) => item.operation === input.operation)!;
  const binding = verified.manifest.bindings.find((item) => item.operation === input.operation)!;
  const directory = resolve(root.path, `wanx-trial-${input.expected.roundId}`);
  const trialBinding: Readonly<AiImageSandboxTrialBinding> = Object.freeze({
    roundId: input.expected.roundId,
    manifestSha256: input.manifestSha256,
    evidenceRootSha256: root.sha256,
    providerAccountUidSha256: input.expected.providerAccountUidSha256,
    requestFingerprint: binding.requestFingerprint,
    frozenPromptSha256: binding.frozenPromptSha256,
  });
  const assertCurrent = async () => {
    await input.assertRevision();
    if ((await rootIdentity(input.repositoryRoot, input.evidenceRoot)).sha256 !== root.sha256) {
      invalid('WANX_TRIAL_ROOT_CHANGED', 'The approved private evidence directory changed');
    }
    await readAiImageSandboxPrivateBillingEvidence({
      repositoryRoot: input.repositoryRoot, evidenceRoot: root.path,
      path: resolve(directory, 'manifest.json'), sha256: input.manifestSha256,
    });
  };
  await assertCurrent();
  return {
    repositoryRoot: input.repositoryRoot, evidenceRoot: root.path, directory,
    manifest: verified.manifest, selected, binding, trialBinding, assertCurrent,
    sourcePath: resolve(directory, selected.source.path),
    maskPath: selected.mask ? resolve(directory, selected.mask.path) : null,
  };
}

export type AiImageWanxTrialExecution = Awaited<ReturnType<typeof loadAiImageWanxTrialExecution>>;

export async function claimAiImageWanxTrialOperation(input: {
  execution: AiImageWanxTrialExecution;
  approval: AiImageSandboxApprovalEvidence;
  requestFingerprint: string;
  now: () => Date;
}) {
  const { execution, approval } = input;
  if (input.requestFingerprint !== execution.trialBinding.requestFingerprint
    || approval.currency !== 'CNY' || !/^[a-f0-9]{64}$/u.test(approval.approvalSha256)) {
    invalid('WANX_TRIAL_CLAIM_MISMATCH', 'Trial allocation must bind the approved exact request');
  }
  await execution.assertCurrent();
  assertAiImageSandboxApprovalCurrent(approval, input.now());
  const roundRecord = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_BUDGET_V1',
    roundId: execution.trialBinding.roundId,
    manifestSha256: execution.trialBinding.manifestSha256,
    evidenceRootSha256: execution.trialBinding.evidenceRootSha256,
    maximumCost: execution.manifest.request.maximumCost,
    allocatedMaximumCost: execution.manifest.allocatedMaximumCost,
    slots: execution.manifest.request.operations.map((operation) => ({
      operation: operation.operation, operationId: operation.operationId,
      maximumCost: operation.maximumCost,
      requestFingerprint: execution.manifest.bindings.find((item) => item.operation === operation.operation)!.requestFingerprint,
    })),
  };
  const directory = resolve(execution.directory, 'execution');
  const roundPath = resolve(directory, 'round.json');
  const roundBytes = jsonBytes(roundRecord);
  const roundSha256 = digest(roundBytes);
  const claim = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_OPERATION_CLAIM_V1', state: 'CLAIMED_FAIL_CLOSED',
    roundSha256, operation: execution.selected.operation, operationId: execution.selected.operationId,
    approvalId: approval.approvalId, approvalSha256: approval.approvalSha256,
    requestFingerprint: input.requestFingerprint,
    maximumCost: execution.selected.maximumCost,
    createdAt: input.now().toISOString(),
  };
  const claimPath = resolve(directory, `${execution.selected.operation}.claim.json`);
  const claimBytes = jsonBytes(claim);
  const claimSha256 = digest(claimBytes);
  // Preserve the existing immutable-round conflict check without claiming a
  // campaign budget or rewriting an older round when its manifest changed.
  try {
    await lstat(roundPath);
    await readAiImageSandboxPrivateBillingEvidence({
      repositoryRoot: execution.repositoryRoot, evidenceRoot: execution.evidenceRoot,
      path: roundPath, sha256: roundSha256,
    });
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  const campaign = await reserveAiImageWanxTrialCampaignOperation({
    repositoryRoot: execution.repositoryRoot, evidenceRoot: execution.evidenceRoot,
    trialBinding: execution.trialBinding, operation: execution.selected.operation,
    operationId: execution.selected.operationId, approvalId: approval.approvalId,
    approvalSha256: approval.approvalSha256, roundSha256, claimSha256,
    now: input.now, assertCurrent: execution.assertCurrent,
  }, async () => {
    // Persist the original records unchanged, after the cumulative reservation
    // and while the campaign lock still excludes concurrent claim writers.
    try {
      await writeAiImageSandboxPrivateEvidenceFile(roundPath, roundBytes, execution.evidenceRoot);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      await readAiImageSandboxPrivateBillingEvidence({
        repositoryRoot: execution.repositoryRoot, evidenceRoot: execution.evidenceRoot,
        path: roundPath, sha256: roundSha256,
      });
    }
    try {
      await writeAiImageSandboxPrivateEvidenceFile(claimPath, claimBytes, execution.evidenceRoot);
    } catch (error: any) {
      if (error?.code === 'EEXIST') invalid('WANX_TRIAL_OPERATION_ALREADY_CLAIMED', 'The trial operation is already claimed; inspect its outcome instead of resubmitting');
      throw error;
    }
  });
  const assertCurrent = async () => {
    await execution.assertCurrent();
    for (const [path, sha256] of [[roundPath, roundSha256], [claimPath, claimSha256]]) {
      await readAiImageSandboxPrivateBillingEvidence({
        repositoryRoot: execution.repositoryRoot, evidenceRoot: execution.evidenceRoot, path: path!, sha256: sha256!,
      });
    }
    await campaign.assertCurrent();
    assertAiImageSandboxApprovalCurrent(approval, input.now());
  };
  await assertCurrent();
  return { roundSha256, claimSha256, campaign: campaign.campaign, assertCurrent };
}

export async function writeAiImageWanxTrialExecutionEvidence(input: {
  execution: AiImageWanxTrialExecution;
  claim: { roundSha256: string; claimSha256: string };
  report: Record<string, unknown>;
}) {
  const { execution, report, claim } = input;
  const approval = report.approvalEvidence as AiImageSandboxApprovalEvidence | undefined;
  if (report.schemaVersion !== 5 || report.operationId !== execution.selected.operationId || report.operation !== execution.selected.operation
    || report.provider !== 'dashscope-wanx21-image-edit' || report.model !== execution.manifest.request.model
    || report.requestProfile !== execution.binding.requestProfile || report.requestedSize !== '1024x1024'
    || report.apiBaseSha256 !== digest(execution.manifest.request.apiBase)
    || report.operationEndpointSha256 !== digest(aiImageWanx21EditSubmitEndpoint(execution.manifest.request.apiBase))
    || report.adapterRevision !== execution.manifest.request.adapterRevision
    || report.credentialRevision !== execution.manifest.request.credentialRevision
    || report.promptSha256 !== execution.binding.promptSha256 || report.actualCost !== null
    || !isDeepStrictEqual(report.sourceSha256, [execution.selected.source.sha256])
    || report.maskSha256 !== (execution.selected.mask?.sha256 ?? null)
    || !isDeepStrictEqual(report.quotedCost, execution.selected.quotedCost)
    || !isDeepStrictEqual(report.maximumCost, execution.selected.maximumCost)
    || !['SUCCEEDED', 'PRE_DISPATCH_FAILED', 'REJECTED', 'RECONCILIATION_REQUIRED'].includes(String(report.state))) {
    invalid('WANX_TRIAL_REPORT_MISMATCH', 'Trial execution evidence requires the exact immutable submit report');
  }
  if ((await rootIdentity(execution.repositoryRoot, execution.evidenceRoot)).sha256 !== execution.trialBinding.evidenceRootSha256) {
    invalid('WANX_TRIAL_ROOT_CHANGED', 'The approved evidence root changed before outcome persistence');
  }
  const reportSha256 = digest(jsonBytes(report));
  await readAiImageSandboxPrivateBillingEvidence({
    repositoryRoot: execution.repositoryRoot, evidenceRoot: execution.evidenceRoot,
    path: resolve(execution.evidenceRoot, `${execution.selected.operationId}.report.json`), sha256: reportSha256,
  });
  const operationClaim = await readAiImageSandboxPrivateBillingEvidence({
    repositoryRoot: execution.repositoryRoot, evidenceRoot: execution.evidenceRoot,
    path: resolve(execution.directory, 'execution', `${execution.selected.operation}.claim.json`), sha256: claim.claimSha256,
  });
  if (operationClaim.record.approvalSha256 !== approval?.approvalSha256 || operationClaim.record.approvalId !== approval?.approvalId
    || operationClaim.record.operationId !== execution.selected.operationId || operationClaim.record.operation !== execution.selected.operation
    || !isDeepStrictEqual(operationClaim.record.maximumCost, execution.selected.maximumCost)
    || operationClaim.record.roundSha256 !== claim.roundSha256
    || operationClaim.record.requestFingerprint !== execution.binding.requestFingerprint) {
    invalid('WANX_TRIAL_REPORT_MISMATCH', 'Trial report and claimed approval do not match');
  }
  const round = await readAiImageSandboxPrivateBillingEvidence({
    repositoryRoot: execution.repositoryRoot, evidenceRoot: execution.evidenceRoot,
    path: resolve(execution.directory, 'execution/round.json'), sha256: claim.roundSha256,
  });
  if (round.record.manifestSha256 !== execution.trialBinding.manifestSha256
    || round.record.evidenceRootSha256 !== execution.trialBinding.evidenceRootSha256
    || round.record.roundId !== execution.trialBinding.roundId) {
    invalid('WANX_TRIAL_REPORT_MISMATCH', 'Trial evidence cannot cross immutable round bindings');
  }
  const evidence = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_EXECUTION_EVIDENCE_V1',
    operationId: execution.selected.operationId, reportSha256, outcome: report.state,
    trialBinding: execution.trialBinding,
    roundClaimSha256: claim.roundSha256, operationClaimSha256: claim.claimSha256,
    executionScope: 'ISOLATED_WANX_TRIAL', sourceVerification: 'OFFLINE_CONSISTENCY_ONLY',
    billingReconciliation: 'REQUIRED',
  };
  const bytes = jsonBytes(evidence);
  const path = resolve(execution.evidenceRoot, `${execution.selected.operationId}.wanx.trial-evidence.json`);
  await writeAiImageSandboxPrivateEvidenceFile(path, bytes, execution.evidenceRoot);
  return { sha256: digest(bytes) };
}
