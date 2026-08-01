import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalizeAiImageSandboxBillingSettlement,
} from '../src/services/ai-image-sandbox-billing-settlement.js';
import {
  AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN,
  resolveAiImageSandboxRepositoryRevision,
} from '../src/services/ai-image-sandbox-code-revision.js';

const UNSAFE_ENVIRONMENT_NAMES = new Set([
  'AI_IMAGE_SANDBOX_API_KEY',
  'AI_IMAGE_SANDBOX_CONFIRM',
  'AI_IMAGE_TRANSLATION_SANDBOX_API_KEY',
  'AI_IMAGE_SANDBOX_TOKEN',
  'AUTHORIZATION',
  'OPENAI_API_KEY',
  'PACKY_API_KEY',
  'PACKY_TOKEN',
  'XIAOYI_API_KEY',
  'XIAOYI_TOKEN',
  'DASHSCOPE_API_KEY',
]);

const BILLING_FINALIZER_TRACKED_PATHS = [
  'apps/server/scripts/ai-image-provider-billing-finalize.ts',
  'apps/server/src/services/ai-image-sandbox-billing-settlement.ts',
  'apps/server/src/services/ai-image-sandbox-money.ts',
  'apps/server/src/services/ai-image-sandbox-code-revision.ts',
  'apps/server/src/services/ai-image-sandbox-guard.ts',
  'apps/server/src/services/ai-image-packy-edit-profile.ts',
  'apps/server/src/services/ai-image-xiaoyi-provider.ts',
];

type FinalizeBilling = typeof finalizeAiImageSandboxBillingSettlement;

export interface AiImageProviderBillingFinalizeOptions {
  environment?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
  evidenceRoot?: string;
  now?: Date;
  resolveRevision?: typeof resolveAiImageSandboxRepositoryRevision;
  finalizeBilling?: FinalizeBilling;
  requireGitCheckout?: boolean;
}

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  const value = String(environment[name] || '').trim();
  if (!value) {
    throw Object.assign(new Error(`${name} is required`), {
      code: 'SANDBOX_BILLING_CONFIG_INVALID',
    });
  }
  return value;
}

function requiredSha256(name: string, environment: NodeJS.ProcessEnv) {
  const value = requiredEnvironment(name, environment).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw Object.assign(new Error(`${name} must be a lowercase SHA-256 digest`), {
      code: 'SANDBOX_BILLING_CONFIG_INVALID',
    });
  }
  return value;
}

function safeFailureCode(error: unknown) {
  const value = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return value.toUpperCase().replace(/[^A-Z0-9_.-]/gu, '').slice(0, 80)
    || 'SANDBOX_BILLING_FAILED';
}

export async function runAiImageProviderBillingFinalize(
  options: AiImageProviderBillingFinalizeOptions = {},
) {
  const environment = options.environment || process.env;
  if (environment.NODE_ENV !== 'sandbox') {
    throw Object.assign(new Error('NODE_ENV must equal sandbox for billing finalization'), {
      code: 'SANDBOX_BILLING_CONFIG_INVALID',
    });
  }
  if (Object.entries(environment).some(([name, value]) => (
    UNSAFE_ENVIRONMENT_NAMES.has(name.toUpperCase()) && String(value || '').trim()
  ))) {
    throw Object.assign(
      new Error('Billing finalization must not receive Provider secrets or paid confirmation'),
      { code: 'SANDBOX_BILLING_UNSAFE_ENV' },
    );
  }
  const repositoryRoot = options.repositoryRoot
    || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const operationId = requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION_ID', environment);
  const finalizationAdapterRevision = requiredEnvironment(
    'AI_IMAGE_SANDBOX_ADAPTER_REVISION',
    environment,
  ).toLowerCase();
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(finalizationAdapterRevision)) {
    throw Object.assign(new Error('AI_IMAGE_SANDBOX_ADAPTER_REVISION must be a full Git object ID'), {
      code: 'SANDBOX_BILLING_CONFIG_INVALID',
    });
  }
  const resolveRevision = options.resolveRevision || resolveAiImageSandboxRepositoryRevision;
  const repositoryRevision = await resolveRevision(
    repositoryRoot,
    undefined,
    BILLING_FINALIZER_TRACKED_PATHS,
    options.requireGitCheckout,
  );
  if (repositoryRevision !== finalizationAdapterRevision) {
    throw Object.assign(new Error('Billing finalizer revision does not match deployed code'), {
      code: 'SANDBOX_ADAPTER_REVISION_MISMATCH',
    });
  }
  const finalizeBilling = options.finalizeBilling || finalizeAiImageSandboxBillingSettlement;
  const result = await finalizeBilling({
    repositoryRoot,
    evidenceRoot: options.evidenceRoot
      || String(environment.AI_IMAGE_SANDBOX_EVIDENCE_ROOT || 'tmp/ai-image-sandbox').trim(),
    operationId,
    settlementPath: requiredEnvironment(
      'AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH',
      environment,
    ),
    settlementSha256: requiredSha256(
      'AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_SHA256',
      environment,
    ),
    finalizationAdapterRevision,
    now: options.now,
  });
  process.stdout.write(`${JSON.stringify({ ...result.receipt, replayed: result.replayed }, null, 2)}\n`);
  return result;
}

const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  runAiImageProviderBillingFinalize({ requireGitCheckout: true }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      event: 'SANDBOX_BILLING_COMMAND_FAILED',
      failureCode: safeFailureCode(error),
    })}\n`);
    process.stderr.write('AI image sandbox billing finalization failed.\n');
    process.exitCode = 1;
  });
}
