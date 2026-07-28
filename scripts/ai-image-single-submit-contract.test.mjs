import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const source = fs.readFileSync(
  'apps/server/scripts/ai-image-provider-single-submit.ts',
  'utf8',
);
const guard = fs.readFileSync(
  'apps/server/src/services/ai-image-sandbox-guard.ts',
  'utf8',
);
const approval = fs.readFileSync(
  'apps/server/src/services/ai-image-sandbox-approval.ts',
  'utf8',
);
const runbook = fs.readFileSync('docs/runbooks/ai-image-provider-sandbox.md', 'utf8');
const approvalRunbook = fs.readFileSync(
  'docs/runbooks/ai-image-provider-sandbox-approval.md',
  'utf8',
);
const preflight = fs.readFileSync('scripts/preflight.mjs', 'utf8');
const sandboxTsconfig = fs.readFileSync('apps/server/tsconfig.sandbox.json', 'utf8');

assert.match(source, /I_ACCEPT_ONE_PAID_IMAGE_REQUEST/u);
assert.match(source, /NODE_ENV\s*!==\s*'sandbox'/u);
assert.match(source, /claimAiImageSandboxOperation/u);
assert.match(source, /createAiImageSandboxFetchGuard/u);
assert.match(source, /createAiImageSandboxEditFetchGuard/u);
assert.match(source, /createOpenAiImagesProvider/u);
assert.match(source, /createOpenAiImageEditProvider/u);
assert.match(source, /AI_IMAGE_SANDBOX_OPERATION_ID/u);
assert.match(source, /AI_IMAGE_SANDBOX_CREDENTIAL_REVISION/u);
assert.match(source, /AI_IMAGE_SANDBOX_ADAPTER_REVISION/u);
assert.match(source, /AI_IMAGE_SANDBOX_APPROVAL_PATH/u);
assert.match(source, /AI_IMAGE_SANDBOX_APPROVAL_SHA256/u);
assert.match(source, /loadAiImageSandboxApproval/u);
assert.match(source, /AI_IMAGE_SANDBOX_OPERATION/u);
assert.match(source, /AI_IMAGE_SANDBOX_REQUEST_PROFILE/u);
assert.match(source, /OPENAI_SQUARE_SINGLE_V1/u);
assert.match(source, /OZON_PORTRAIT_SINGLE_V1/u);
assert.match(source, /IMAGE_TO_IMAGE/u);
assert.match(source, /FULL_EDIT/u);
assert.match(source, /INPAINT/u);
assert.match(source, /TEXT_TO_IMAGE/u);
assert.match(source, /AI_IMAGE_SANDBOX_SOURCE_PATH/u);
assert.match(source, /AI_IMAGE_SANDBOX_SOURCE_SHA256/u);
assert.match(source, /AI_IMAGE_SANDBOX_MASK_PATH/u);
assert.match(source, /AI_IMAGE_SANDBOX_MASK_SHA256/u);
assert.match(source, /AI_IMAGE_SANDBOX_MAX_COST_CENTS/u);
assert.match(source, /'generations'\s*:\s*'edits'/u);
assert.match(source, /tmp\/ai-image-sandbox/u);
assert.match(source, /validateAiImageProviderUrl/u);
assert.match(source, /cloudflare-dns\.com\/dns-query/u);
assert.match(source, /interceptors\.dns/u);
assert.match(source, /endpointSha256/u);
assert.match(source, /credentialRevision/u);
assert.match(source, /adapterRevision/u);
assert.match(source, /sourceSha256/u);
assert.match(source, /maskSha256/u);
assert.match(source, /promptSha256/u);
assert.match(source, /providerRequestIdHash/u);
assert.match(source, /approvalEvidence/u);
assert.match(source, /PRE_DISPATCH_FAILED/u);
assert.match(source, /REJECTED/u);
assert.match(source, /RECONCILIATION_REQUIRED/u);
assert.match(source, /failureCode/u);
assert.match(source, /safeFailureCode/u);
assert.match(source, /atomicWritePrivateJson/u);
assert.match(source, /handle\.sync\(\)/u);
assert.match(source, /syncDirectory\(dirname\(path\)\)/u);
assert.match(source, /repositoryRoot\?:\s*string/u);
assert.match(source, /FULL_GIT_OID_PATTERN/u);
assert.match(source, /DEPLOYED_COMMIT/u);
assert.match(source, /git', \['rev-parse', '--verify', 'HEAD'\]/u);
assert.match(source, /--porcelain=v1/u);
assert.match(source, /SANDBOX_COMMAND_FAILED/u);
assert.match(source, /open\(path,\s*'wx',\s*0o600\)/u);
assert.match(source, /\.report\.json/u);
assert.match(source, /clearly visible soft warm-beige studio background/u);
assert.match(source, /extractChannel\('alpha'\)/u);
assert.match(source, /hasTransparent/u);
assert.match(source, /hasOpaque/u);
assert.match(guard, /createRequests\s*>=\s*1/u);
assert.match(guard, /body\.n\s*!==\s*input\.contract\.n/u);
assert.match(guard, /promptSha256\s*!==\s*input\.contract\.promptSha256/u);
assert.match(guard, /body\.size\s*!==\s*input\.contract\.size/u);
assert.match(guard, /SANDBOX_REQUEST_REPLAY/u);
assert.match(guard, /canonicalJson/u);
assert.match(guard, /\.fingerprints/u);
assert.match(guard, /writeExclusiveDurableFile/u);
assert.match(guard, /handle\.sync\(\)/u);
assert.match(guard, /syncDirectory\(dirname\(path\)\)/u);
assert.match(guard, /'approvalEvidence'/u);
assert.match(approval, /I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST/u);
assert.match(approval, /requestCount\s*!==\s*1/u);
assert.match(approval, /SANDBOX_APPROVAL_DIGEST_MISMATCH/u);
assert.match(approval, /SANDBOX_APPROVAL_MISMATCH/u);
assert.match(approval, /O_NOFOLLOW/u);
assert.match(approval, /metadata\.mode\s*&\s*0o077/u);
assert.match(approval, /preCallBillingSnapshotRefSha256/u);
assert.match(approval, /billingReconciliationRefSha256/u);
assert.match(runbook, /ai-image-provider-sandbox-approval\.md/u);
assert.match(runbook, /AI_IMAGE_SANDBOX_APPROVAL_PATH/u);
assert.match(runbook, /AI_IMAGE_SANDBOX_APPROVAL_SHA256/u);
assert.match(approvalRunbook, /I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST/u);
assert.match(approvalRunbook, /gpt-image-2-i2i-20260724-200300-01/u);
assert.match(approvalRunbook, /requestCount/u);
assert.match(approvalRunbook, /preCallBillingSnapshotRef/u);
assert.match(approvalRunbook, /billingReconciliationRef/u);
assert.match(preflight, /tsconfig\.sandbox\.json/u);
assert.match(sandboxTsconfig, /ai-image-provider-single-submit\.ts/u);
assert.match(sandboxTsconfig, /ai-image-translation-single-submit\.ts/u);
assert.match(sandboxTsconfig, /ai-image-sandbox-approval\.ts/u);
assert.doesNotMatch(source, /endpointPath/u);
assert.doesNotMatch(source, /providerEndpoint\s*:/u);
assert.doesNotMatch(source, /setConfig|uploadBuffer|enqueueAiImageJob/u);
assert.doesNotMatch(source + guard, /gpt-image-2-count|sk-[A-Za-z0-9_.-]{12,}|rawResponse/u);

const outsideSandbox = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/ai-image-provider-single-submit.ts'],
  {
    cwd: 'apps/server',
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development' },
  },
);
assert.notEqual(outsideSandbox.status, 0);
assert.match(outsideSandbox.stderr, /AI image sandbox failed/u);
assert.doesNotMatch(outsideSandbox.stderr, /inspect|report/iu);

const invalidOperation = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/ai-image-provider-single-submit.ts'],
  {
    cwd: 'apps/server',
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.invalid',
      AI_IMAGE_SANDBOX_API_KEY: 'not-a-real-key',
      AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-invalid-operation-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'test-revision-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
      AI_IMAGE_SANDBOX_OPERATION: 'UPSCALE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
    },
  },
);
assert.notEqual(invalidOperation.status, 0);
assert.match(invalidOperation.stderr, /AI image sandbox failed/u);

const textGenerationOperation = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/ai-image-provider-single-submit.ts'],
  {
    cwd: 'apps/server',
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.invalid',
      AI_IMAGE_SANDBOX_API_KEY: 'not-a-real-key',
      AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-text-operation-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'test-revision-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: '',
      AI_IMAGE_SANDBOX_SOURCE_PATH: '',
      AI_IMAGE_SANDBOX_SOURCE_SHA256: '',
      AI_IMAGE_SANDBOX_MASK_PATH: '',
      AI_IMAGE_SANDBOX_MASK_SHA256: '',
    },
  },
);
assert.notEqual(textGenerationOperation.status, 0);
assert.match(textGenerationOperation.stderr, /AI image sandbox failed/u);

console.log('PASS single-submit AI image sandbox contract');
