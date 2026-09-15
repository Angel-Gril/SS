import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN,
  resolveAiImageSandboxRepositoryRevision,
} from '../src/services/ai-image-sandbox-code-revision.js';
import {
  authorizeAiImageWanxTrialCampaign,
  authorizeAiImageWanxTrialReassignment,
  inspectAiImageWanxTrialCampaignHistory,
} from '../src/services/ai-image-wanx-trial-campaign.js';
import { AI_IMAGE_WANX_TRIAL_EXECUTION_TRACKED_PATHS } from '../src/services/ai-image-wanx-trial-execution.js';
import { AI_IMAGE_WANX_TRIAL_PREPARATION_TRACKED_PATHS } from './ai-image-wanx-trial-prepare.js';

type CampaignMode = 'inspect' | 'authorize' | 'reassign';
const COMMON_NAMES = [
  'AI_IMAGE_SANDBOX_ADAPTER_REVISION', 'AI_IMAGE_SANDBOX_EVIDENCE_ROOT',
  'AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256',
];
const AUTHORIZATION_NAMES = [
  'AI_IMAGE_SANDBOX_TRIAL_ROUND_ID', 'AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256',
  'AI_IMAGE_SANDBOX_CREDENTIAL_REVISION',
  'AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_PATH', 'AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_SHA256',
  'AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_PATH', 'AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_SHA256',
];
const UNSAFE_NAMES = new Set([
  'AI_IMAGE_SANDBOX_API_KEY', 'AI_IMAGE_SANDBOX_TOKEN', 'AI_IMAGE_SANDBOX_CONFIRM',
  'AI_IMAGE_TRANSLATION_SANDBOX_API_KEY', 'AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM',
  'AUTHORIZATION', 'COOKIE', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY',
  'PACKY_API_KEY', 'PACKY_TOKEN', 'XIAOYI_API_KEY', 'XIAOYI_TOKEN',
  'ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN',
  'ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET', 'ALIYUN_SECURITY_TOKEN',
]);

function invalid(code = 'WANX_TRIAL_CONFIG_INVALID'): never {
  throw Object.assign(new Error('Offline campaign command inputs are invalid'), { code });
}

function required(name: string, environment: NodeJS.ProcessEnv) {
  const value = String(environment[name] || '').trim();
  if (!value) invalid();
  return value;
}

function sha256(name: string, environment: NodeJS.ProcessEnv) {
  const value = required(name, environment);
  if (!/^[a-f0-9]{64}$/u.test(value)) invalid();
  return value;
}

export async function runAiImageWanxCampaignCommand(mode: CampaignMode, options: {
  environment?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
} = {}) {
  const environment = options.environment || process.env;
  if (environment.NODE_ENV !== 'sandbox' || !['inspect', 'authorize', 'reassign'].includes(mode)) invalid();
  const allowed = new Set([...COMMON_NAMES, ...(mode !== 'inspect' ? AUTHORIZATION_NAMES : []),
    ...(mode === 'reassign' ? ['AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256'] : [])]);
  for (const [name, value] of Object.entries(environment)) {
    if (!String(value || '').trim()) continue;
    const normalized = name.toUpperCase();
    if (UNSAFE_NAMES.has(normalized)) invalid('WANX_TRIAL_UNSAFE_ENV');
    if ((normalized.startsWith('AI_IMAGE_SANDBOX_') && !allowed.has(normalized))
      || normalized.startsWith('AI_IMAGE_TRANSLATION_SANDBOX_')) invalid();
  }
  const repositoryRoot = options.repositoryRoot || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const adapterRevision = required('AI_IMAGE_SANDBOX_ADAPTER_REVISION', environment);
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(adapterRevision)) invalid();
  const scope = {
    repositoryRoot, evidenceRoot: required('AI_IMAGE_SANDBOX_EVIDENCE_ROOT', environment),
    providerAccountUidSha256: sha256('AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256', environment),
  };
  const trackedPaths = [...AI_IMAGE_WANX_TRIAL_PREPARATION_TRACKED_PATHS, ...AI_IMAGE_WANX_TRIAL_EXECUTION_TRACKED_PATHS,
    'apps/server/scripts/ai-image-provider-approval-draft.ts',
    'apps/server/scripts/ai-image-wanx-campaign.ts',
    'apps/server/src/services/ai-image-sandbox-code-revision.ts',
  ];
  const assertRevision = async () => {
    if (await resolveAiImageSandboxRepositoryRevision(repositoryRoot, undefined, trackedPaths, true) !== adapterRevision) {
      invalid('SANDBOX_ADAPTER_REVISION_MISMATCH');
    }
  };
  // Parse all mutating inputs before the first owner read. The owner validates their
  // schema, pinned bytes, current history and exact operation bindings under its lock.
  const authorization = mode !== 'inspect' ? {
    expected: {
      adapterRevision, providerAccountUidSha256: scope.providerAccountUidSha256,
      roundId: required('AI_IMAGE_SANDBOX_TRIAL_ROUND_ID', environment),
      credentialRevision: required('AI_IMAGE_SANDBOX_CREDENTIAL_REVISION', environment),
    },
    manifestSha256: sha256('AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256', environment),
    proposal: {
      path: required('AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_PATH', environment),
      sha256: sha256('AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_SHA256', environment),
    },
    approval: {
      path: required('AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_PATH', environment),
      sha256: sha256('AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_SHA256', environment),
    },
  } : null;
  const originalAuthorizationSha256 = mode === 'reassign'
    ? sha256('AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256', environment) : null;
  await assertRevision();
  const observation = await inspectAiImageWanxTrialCampaignHistory(scope);
  if (!authorization) {
    await assertRevision();
    const result = { ...observation, inspectionAdapterRevision: adapterRevision };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  if (originalAuthorizationSha256) {
    const result = await authorizeAiImageWanxTrialReassignment({
      ...scope, ...authorization, originalAuthorizationSha256, history: observation.history, assertRevision,
    });
    await assertRevision();
    const summary = { event: 'AI_IMAGE_WANX_CAMPAIGN_REASSIGNED', reassignmentSha256: result.reassignmentSha256,
      replayed: result.replayed, canSubmit: result.canSubmit };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return summary;
  }
  const result = await authorizeAiImageWanxTrialCampaign({
    ...scope, ...authorization, history: observation.history, assertRevision,
  });
  await assertRevision();
  const summary = { event: 'AI_IMAGE_WANX_CAMPAIGN_AUTHORIZED',
    authorizationSha256: result.authorizationSha256, replayed: result.replayed, canSubmit: result.canSubmit,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
