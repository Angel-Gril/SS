import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT,
  AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
} from './ai-image-provider-approval-draft.js';
import {
  AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN,
  resolveAiImageSandboxRepositoryRevision,
} from '../src/services/ai-image-sandbox-code-revision.js';

// All source dependencies of this entry, including the shared media limits, must
// belong to the same clean checkout. Installed third-party packages are unchanged.
export const AI_IMAGE_WANX_TRIAL_PREPARATION_TRACKED_PATHS = [
  'apps/server/scripts/ai-image-provider-approval-draft.ts',
  'apps/server/scripts/ai-image-wanx-trial-prepare.ts',
  'apps/server/src/lib/ai-media-transaction.ts',
  'apps/server/src/services/ai-cost-ledger.ts',
  'apps/server/src/services/ai-image-curation.ts',
  'apps/server/src/services/ai-image-edit-prompt-contract.ts',
  'apps/server/src/services/ai-image-edit-provider-contract.ts',
  'apps/server/src/services/ai-image-job-error.ts',
  'apps/server/src/services/ai-image-jobs.ts',
  'apps/server/src/services/ai-image-task-cost.ts',
  'apps/server/src/services/ai-image-openai-url.ts',
  'apps/server/src/services/ai-image-packy-edit-profile.ts',
  'apps/server/src/services/ai-image-prompt-plan.ts',
  'apps/server/src/services/ai-image-provider-capabilities.ts',
  'apps/server/src/services/ai-image-provider-runtime-contract.ts',
  'apps/server/src/services/ai-image-providers.ts',
  'apps/server/src/services/ai-image-sandbox-approval.ts',
  'apps/server/src/services/ai-image-sandbox-billing-settlement.ts',
  'apps/server/src/services/ai-image-sandbox-code-revision.ts',
  'apps/server/src/services/ai-image-sandbox-guard.ts',
  'apps/server/src/services/ai-image-sandbox-media.ts',
  'apps/server/src/services/ai-image-sandbox-money.ts',
  'apps/server/src/services/ai-image-translation.ts',
  'apps/server/src/services/ai-image-vision.ts',
  'apps/server/src/services/ai-image-wanx-edit-profile.ts',
  'apps/server/src/services/ai-image-wanx-trial-preparation.ts',
  'apps/server/src/services/ai-image-wanx-trial-input.ts',
  'apps/server/src/services/ai-image-wanx-template-source-import.ts',
  'apps/server/src/services/ai-image-xiaoyi-provider.ts',
  'apps/server/src/services/ai-media-planning-contract.ts',
  'apps/server/src/services/ai-prompt-consumer-contracts.ts',
  'apps/server/src/services/ai-prompt-templates.ts',
  'apps/server/src/services/ai-prompt-template-source.ts',
  'packages/shared/package.json',
  'packages/shared/src/ai-image-workbench-contract.ts',
];

const UNSAFE_ENVIRONMENT_NAMES = new Set([
  'AI_IMAGE_SANDBOX_API_KEY', 'AI_IMAGE_SANDBOX_TOKEN', 'AI_IMAGE_SANDBOX_CONFIRM',
  'AI_IMAGE_TRANSLATION_SANDBOX_API_KEY', 'AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM',
  'AUTHORIZATION', 'COOKIE', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY',
  'PACKY_API_KEY', 'PACKY_TOKEN', 'XIAOYI_API_KEY', 'XIAOYI_TOKEN',
  'ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN',
  'ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET', 'ALIYUN_SECURITY_TOKEN',
]);
const MIXED_ENVIRONMENT_NAMES = new Set([
  'AI_IMAGE_SANDBOX_OPERATION_ID', 'AI_IMAGE_SANDBOX_APPROVAL_PATH', 'AI_IMAGE_SANDBOX_APPROVAL_SHA256',
  'AI_IMAGE_SANDBOX_APPROVAL_DRAFT_PATH', 'AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH',
  'AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_SHA256', 'AI_IMAGE_SANDBOX_BILLING_OBSERVATION_PATH',
  'AI_IMAGE_SANDBOX_BILLING_OBSERVATION_SHA256',
  'AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_PATH', 'AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_SHA256',
  'AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_PATH', 'AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_SHA256',
]);
const DRAFT_OVERRIDE_ENVIRONMENT_NAMES = new Set([
  'AI_IMAGE_SANDBOX_BASE_URL', 'AI_IMAGE_SANDBOX_EXPECTED_HOST', 'AI_IMAGE_SANDBOX_MODEL',
  'AI_IMAGE_SANDBOX_REQUEST_PROFILE', 'AI_IMAGE_SANDBOX_SOURCE_PATH', 'AI_IMAGE_SANDBOX_SOURCE_SHA256',
  'AI_IMAGE_SANDBOX_MASK_PATH', 'AI_IMAGE_SANDBOX_MASK_SHA256', 'AI_IMAGE_SANDBOX_MODE',
  'AI_IMAGE_SANDBOX_CURRENCY', 'AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT', 'AI_IMAGE_SANDBOX_MAX_COST_AMOUNT',
  'AI_IMAGE_SANDBOX_COST_SCALE', 'AI_IMAGE_SANDBOX_QUOTED_COST_CENTS', 'AI_IMAGE_SANDBOX_MAX_COST_CENTS',
]);

function invalid(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = String(environment[name] || '').trim();
  if (!value) invalid('WANX_TRIAL_CONFIG_INVALID', 'A required offline trial setting is missing');
  return value;
}

function requiredDigest(environment: NodeJS.ProcessEnv, name: string) {
  const value = required(environment, name);
  if (!/^[a-f0-9]{64}$/u.test(value)) invalid('WANX_TRIAL_CONFIG_INVALID', 'A lowercase pinned SHA-256 digest is required');
  return value;
}

function requiredBoundedText(environment: NodeJS.ProcessEnv, name: string, maximumLength: number) {
  const value = required(environment, name);
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (value.length > maximumLength || hasControlCharacter
    || Buffer.from(value, 'utf8').toString('utf8') !== value) {
    invalid('WANX_TRIAL_CONFIG_INVALID', 'Trial approval metadata must use bounded non-secret references');
  }
  return value;
}

function approvalDraftSettings(environment: NodeJS.ProcessEnv) {
  const operation = required(environment, 'AI_IMAGE_SANDBOX_OPERATION');
  if (operation !== 'FULL_EDIT' && operation !== 'INPAINT') {
    invalid('WANX_TRIAL_OPERATION_INVALID', 'A trial approval draft requires full edit or inpaint');
  }
  const approvalId = requiredBoundedText(environment, 'AI_IMAGE_SANDBOX_APPROVAL_ID', 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u.test(approvalId)) {
    invalid('WANX_TRIAL_CONFIG_INVALID', 'The trial approval ID is invalid');
  }
  return {
    operation,
    metadata: {
      approvalId,
      approverRef: requiredBoundedText(environment, 'AI_IMAGE_SANDBOX_APPROVER_REF', 128),
      providerAccountRef: requiredBoundedText(environment, 'AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF', 160),
      pricingRevision: requiredBoundedText(environment, 'AI_IMAGE_SANDBOX_PRICING_REVISION', 160),
      preCallBillingSnapshotRef: requiredBoundedText(environment, 'AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF', 200),
      billingReconciliationRef: requiredBoundedText(environment, 'AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF', 200),
    },
  };
}

export async function runAiImageWanxTrialCommand(mode: 'prepare' | 'verify' | 'approval-draft' | 'compile-input' | 'import-sources', options: {
  environment?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
  resolveRevision?: typeof resolveAiImageSandboxRepositoryRevision;
} = {}) {
  const environment = options.environment || process.env;
  if (environment.NODE_ENV !== 'sandbox' || !['prepare', 'verify', 'approval-draft', 'compile-input', 'import-sources'].includes(mode)) {
    invalid('WANX_TRIAL_CONFIG_INVALID', 'The offline trial command requires sandbox mode');
  }
  const campaignNames = new Set([
    'AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256',
    'AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256',
    'AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_PATH', 'AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_SHA256',
  ]);
  for (const [name, value] of Object.entries(environment)) {
    if (!String(value || '').trim()) continue;
    if (UNSAFE_ENVIRONMENT_NAMES.has(name.toUpperCase())) invalid('WANX_TRIAL_UNSAFE_ENV', 'Offline trial preparation must not receive credentials or paid confirmation');
    if (MIXED_ENVIRONMENT_NAMES.has(name.toUpperCase())
      || ((mode === 'approval-draft' || mode === 'compile-input' || mode === 'import-sources') && DRAFT_OVERRIDE_ENVIRONMENT_NAMES.has(name.toUpperCase()))
      || (mode !== 'import-sources' && name.toUpperCase() === 'AI_IMAGE_SANDBOX_ERP_ORIGIN')
      || (mode !== 'approval-draft' && campaignNames.has(name.toUpperCase()))
      || (mode === 'import-sources' && name.toUpperCase() === 'AI_IMAGE_SANDBOX_OPERATION')) {
      invalid('WANX_TRIAL_CONFIG_INVALID', 'Trial preparation cannot be combined with approval, submission or request overrides');
    }
  }
  const incompatible = mode === 'prepare' || mode === 'compile-input' || mode === 'import-sources' ? ['AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256']
    : ['AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH', 'AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256'];
  if (incompatible.some((name) => String(environment[name] || '').trim())) invalid('WANX_TRIAL_CONFIG_INVALID', 'Prepare and verify inputs must not be mixed');
  const draftSettings = mode === 'approval-draft' ? approvalDraftSettings(environment) : null;
  const campaignAuthorizationSha256 = String(environment.AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256 || '').trim()
    ? requiredDigest(environment, 'AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256') : undefined;
  const campaignReassignmentSha256 = String(environment.AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256 || '').trim()
    ? requiredDigest(environment, 'AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256') : undefined;
  const qualityPath = String(environment.AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_PATH || '').trim();
  const qualityDigest = String(environment.AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_SHA256 || '').trim();
  if (Boolean(qualityPath) !== Boolean(qualityDigest) || (qualityPath && !campaignAuthorizationSha256)
    || (campaignReassignmentSha256 && (!campaignAuthorizationSha256 || qualityPath))) {
    invalid('WANX_TRIAL_CONFIG_INVALID', 'Quality approval inputs require a path, digest and campaign authorization');
  }
  const inpaintQualityApproval = qualityPath ? {
    path: qualityPath, sha256: requiredDigest(environment, 'AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_SHA256'),
  } : undefined;
  const adapterRevision = required(environment, 'AI_IMAGE_SANDBOX_ADAPTER_REVISION');
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(adapterRevision)) invalid('WANX_TRIAL_CONFIG_INVALID', 'A full Git revision is required');
  const expected = {
    adapterRevision,
    roundId: required(environment, 'AI_IMAGE_SANDBOX_TRIAL_ROUND_ID'),
    providerAccountUidSha256: requiredDigest(environment, 'AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256'),
    credentialRevision: required(environment, 'AI_IMAGE_SANDBOX_CREDENTIAL_REVISION'),
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(expected.roundId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(expected.credentialRevision)) {
    invalid('WANX_TRIAL_CONFIG_INVALID', 'Trial identifiers must be bounded non-secret references');
  }
  const repositoryRoot = options.repositoryRoot || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const evidenceRoot = required(environment, 'AI_IMAGE_SANDBOX_EVIDENCE_ROOT');
  const resolveRevision = options.resolveRevision || resolveAiImageSandboxRepositoryRevision;
  const executionModule = mode === 'approval-draft' ? await import('../src/services/ai-image-wanx-trial-execution.js') : null;
  const trackedPaths = executionModule
    ? [...new Set([...AI_IMAGE_WANX_TRIAL_PREPARATION_TRACKED_PATHS, ...executionModule.AI_IMAGE_WANX_TRIAL_EXECUTION_TRACKED_PATHS])]
    : AI_IMAGE_WANX_TRIAL_PREPARATION_TRACKED_PATHS;
  const assertRevision = async () => {
    if (await resolveRevision(repositoryRoot, undefined, trackedPaths, true) !== adapterRevision) {
      invalid('SANDBOX_ADAPTER_REVISION_MISMATCH', 'Offline trial source revision changed');
    }
  };
  await assertRevision();
  if (mode === 'import-sources') {
    const { importAiImageWanxTemplateSources } = await import('../src/services/ai-image-wanx-template-source-import.js');
    const result = await importAiImageWanxTemplateSources({
      repositoryRoot, evidenceRoot, assertRevision,
      expected: { ...expected, erpOrigin: required(environment, 'AI_IMAGE_SANDBOX_ERP_ORIGIN') },
      requestPath: required(environment, 'AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH'),
      requestSha256: requiredDigest(environment, 'AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256'),
    });
    const summary = { event: 'AI_IMAGE_WANX_TEMPLATE_SOURCES_IMPORTED', ...result };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }
  if (mode === 'compile-input') {
    const { compileAiImageWanxTrialInput } = await import('../src/services/ai-image-wanx-trial-input.js');
    const result = await compileAiImageWanxTrialInput({
      repositoryRoot, evidenceRoot, expected, assertRevision,
      requestPath: required(environment, 'AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH'),
      requestSha256: requiredDigest(environment, 'AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256'),
    });
    const summary = { event: 'AI_IMAGE_WANX_TRIAL_INPUT_COMPILED', ...result };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }
  if (executionModule && draftSettings) {
    const execution = await executionModule.loadAiImageWanxTrialExecution({
      repositoryRoot, evidenceRoot, expected, assertRevision,
      operation: draftSettings.operation,
      manifestSha256: requiredDigest(environment, 'AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256'),
      campaignAuthorizationSha256, campaignReassignmentSha256, inpaintQualityApproval,
    });
    const { aiImageWanx21EditSubmitEndpoint } = await import('../src/services/ai-image-wanx-edit-profile.js');
    const { writeAiImageSandboxPrivateEvidenceFile } = await import('../src/services/ai-image-sandbox-billing-settlement.js');
    const request = execution.manifest.request;
    const selected = execution.selected;
    const endpoint = aiImageWanx21EditSubmitEndpoint(request.apiBase);
    const draft = {
      schemaVersion: 4,
      ...draftSettings.metadata,
      statement: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT,
      approvedAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
      expiresAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
      requestCount: 1,
      operationId: selected.operationId,
      endpoint, expectedHost: new URL(endpoint).hostname,
      model: request.model, operation: selected.operation,
      requestProfile: execution.binding.requestProfile,
      credentialRevision: request.credentialRevision, adapterRevision: request.adapterRevision,
      sourceSha256: [selected.source.sha256], maskSha256: selected.mask?.sha256 ?? null,
      quotedCost: selected.quotedCost, maximumCost: selected.maximumCost,
      trialBinding: execution.trialBinding,
    };
    const bytes = Buffer.from(`${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    const draftSha256 = createHash('sha256').update(bytes).digest('hex');
    await execution.assertCurrent();
    await writeAiImageSandboxPrivateEvidenceFile(
      resolve(execution.directory, 'approval-drafts', `${draft.approvalId}.json`),
      bytes, execution.evidenceRoot,
    );
    await execution.assertCurrent();
    const summary = {
      schemaVersion: 1, event: 'AI_IMAGE_WANX_TRIAL_APPROVAL_DRAFT_CREATED',
      approvalId: draft.approvalId, roundId: execution.trialBinding.roundId,
      operationId: selected.operationId, operation: selected.operation,
      adapterRevision: request.adapterRevision, draftSha256,
      trialBinding: execution.trialBinding,
      canSubmit: false, actualCost: null, sourceVerification: execution.manifest.sourceVerification,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  }
  const { prepareAiImageWanxTrial, verifyAiImageWanxTrial, aiImageWanxTrialSummary } = await import('../src/services/ai-image-wanx-trial-preparation.js');
  const common = { repositoryRoot, evidenceRoot, expected, assertRevision };
  const result = mode === 'prepare'
    ? await prepareAiImageWanxTrial({
        ...common, requestPath: required(environment, 'AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH'),
        requestSha256: requiredDigest(environment, 'AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256'),
      })
    : await verifyAiImageWanxTrial({
        ...common, manifestSha256: requiredDigest(environment, 'AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256'),
      });
  const summary = {
    event: mode === 'prepare' ? 'AI_IMAGE_WANX_TRIAL_PREPARED' : 'AI_IMAGE_WANX_TRIAL_VERIFIED',
    ...aiImageWanxTrialSummary(result),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
