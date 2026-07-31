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
const approvalDraft = fs.readFileSync(
  'apps/server/scripts/ai-image-provider-approval-draft.ts',
  'utf8',
);
const sandboxMedia = fs.readFileSync(
  'apps/server/src/services/ai-image-sandbox-media.ts',
  'utf8',
);
const openAiImageUrl = fs.readFileSync(
  'apps/server/src/services/ai-image-openai-url.ts',
  'utf8',
);
const aiImageJobError = fs.readFileSync(
  'apps/server/src/services/ai-image-job-error.ts',
  'utf8',
);
const imageProviders = fs.readFileSync(
  'apps/server/src/services/ai-image-providers.ts',
  'utf8',
);
const billingFinalizer = fs.readFileSync(
  'apps/server/scripts/ai-image-provider-billing-finalize.ts',
  'utf8',
);
const readonlyPreflight = fs.readFileSync(
  'apps/server/scripts/ai-image-provider-readonly-preflight.ts',
  'utf8',
);
const billingSettlement = fs.readFileSync(
  'apps/server/src/services/ai-image-sandbox-billing-settlement.ts',
  'utf8',
);
const codeRevision = fs.readFileSync(
  'apps/server/src/services/ai-image-sandbox-code-revision.ts',
  'utf8',
);
const runbook = fs.readFileSync('docs/runbooks/ai-image-provider-sandbox.md', 'utf8');
const approvalRunbook = fs.readFileSync(
  'docs/runbooks/ai-image-provider-sandbox-approval.md',
  'utf8',
);
const pricingAudit = fs.readFileSync(
  'docs/analysis/qa02-relay-pricing-audit.md',
  'utf8',
);
const billingRunbook = fs.readFileSync(
  'docs/runbooks/ai-image-provider-sandbox-billing.md',
  'utf8',
);
const serverPackage = JSON.parse(fs.readFileSync('apps/server/package.json', 'utf8'));
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
assert.match(source, /VERIFY_APPROVAL/u);
assert.match(source, /--verify-approval/u);
assert.match(source, /SANDBOX_APPROVAL_PREFLIGHT_UNSAFE_ENV/u);
assert.match(source, /AI_IMAGE_SANDBOX_BASE_URL must use HTTPS/u);
assert.match(source, /sanitizeAiImageSandboxGitEnvironment/u);
assert.match(codeRevision, /GIT_CHILD_ENVIRONMENT_ALLOWLIST/u);
assert.match(codeRevision, /core\.hooksPath=/u);
assert.match(codeRevision, /core\.fsmonitor=false/u);
assert.match(source, /delete process\.env\.AI_IMAGE_SANDBOX_API_KEY/u);
assert.match(source, /delete process\.env\.AI_IMAGE_SANDBOX_CONFIRM/u);
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
assert.match(source, /AI_IMAGE_SANDBOX_CURRENCY/u);
assert.match(source, /AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT/u);
assert.match(source, /AI_IMAGE_SANDBOX_MAX_COST_AMOUNT/u);
assert.match(source, /AI_IMAGE_SANDBOX_COST_SCALE/u);
assert.match(source, /must not mix exact money and legacy cents/u);
assert.match(source, /'generations'\s*:\s*'edits'/u);
assert.match(source, /tmp\/ai-image-sandbox/u);
assert.match(source, /validateAiImageProviderUrl/u);
assert.match(source, /cloudflare-dns\.com\/dns-query/u);
assert.match(source, /interceptors\.dns/u);
assert.match(source, /endpointSha256:\s*operationEndpointSha256/u);
assert.match(source, /credentialRevision/u);
assert.match(source, /adapterRevision/u);
assert.match(source, /sourceSha256/u);
assert.match(source, /maskSha256/u);
assert.match(source, /promptSha256/u);
assert.match(source, /providerRequestIdHash/u);
assert.match(source, /startedAt/u);
assert.match(source, /completedAt/u);
assert.match(source, /schemaVersion:[^\n]*\?\s*5\s*:\s*4/u);
assert.match(source, /actualCost:\s*null/u);
assert.match(source, /quotedCost:\s*claim\.intent\.quotedCost/u);
assert.match(source, /maximumCost:\s*claim\.intent\.maximumCost/u);
assert.match(source, /apiBaseSha256/u);
assert.match(source, /operationEndpointSha256/u);
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
assert.match(codeRevision, /DEPLOYED_COMMIT/u);
assert.match(codeRevision, /runGit\(\['rev-parse', '--verify', 'HEAD'\]\)/u);
assert.match(codeRevision, /--porcelain=v1/u);
assert.match(codeRevision, /ls-files', '--error-unmatch/u);
assert.match(codeRevision, /'hash-object'/u);
assert.match(codeRevision, /`--path=\$\{path\}`/u);
assert.match(codeRevision, /`\$\{revision\}:\$\{path\}`/u);
assert.match(codeRevision, /verifiedRevision\s*!==\s*revision/u);
assert.match(codeRevision, /SANDBOX_ADAPTER_GIT_REQUIRED/u);
assert.match(source, /requireGitCheckout:\s*true/u);
assert.match(codeRevision, /DEPLOYED_COMMIT does not match the checked-out Git HEAD/u);
assert.match(source, /SANDBOX_COMMAND_FAILED/u);
assert.match(source, /open\(path,\s*'wx',\s*0o600\)/u);
assert.match(source, /\.report\.json/u);
assert.match(source, /\.failure-diagnostic\.json/u);
assert.match(source, /submitReportSha256/u);
assert.match(source, /providerHttpStatus/u);
assert.match(source, /isProviderHttpFailureStatus/u);
assert.match(source, /value >= 400/u);
assert.match(source, /value <= 599/u);
assert.match(source, /SANDBOX_FAILURE_DIAGNOSTIC_WRITE_FAILED/u);
assert.match(source, /clearly visible soft warm-beige studio background/u);
assert.match(sandboxMedia, /extractChannel\('alpha'\)/u);
assert.match(sandboxMedia, /hasTransparent/u);
assert.match(sandboxMedia, /hasOpaque/u);
assert.match(guard, /createRequests\s*>=\s*1/u);
assert.match(guard, /body\.n\s*!==\s*input\.contract\.n/u);
assert.match(guard, /promptSha256\s*!==\s*input\.contract\.promptSha256/u);
assert.match(guard, /body\.size\s*!==\s*input\.contract\.size/u);
assert.match(guard, /SANDBOX_REQUEST_REPLAY/u);
assert.match(guard, /canonicalJson/u);
assert.match(guard, /createAiImageSandboxRequestFingerprint/u);
assert.match(guard, /\.fingerprints/u);
assert.match(guard, /writeExclusiveDurableFile/u);
assert.match(guard, /handle\.sync\(\)/u);
assert.match(guard, /constants\.O_DIRECTORY/u);
assert.match(guard, /\/proc\/self\/fd/u);
assert.match(guard, /assertPrivateEvidenceDirectoryStable/u);
assert.match(guard, /SANDBOX_EVIDENCE_DIRECTORY_CHANGED/u);
assert.match(guard, /syncDirectory\(dirname\(path\)\)/u);
assert.match(guard, /'approvalEvidence'/u);
assert.match(guard, /SANDBOX_REQUEST_KEYS/u);
assert.match(guard, /INVALID_SANDBOX_REQUEST/u);
assert.match(guard, /assertAiImageSandboxApprovalCurrent/u);
assert.match(guard, /requires a pre-create approval check/u);
assert.match(guard, /providerHttpStatus/u);
assert.match(guard, /public HTTPS DNS hostname/u);
assert.match(approval, /I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST/u);
assert.match(approval, /requestCount\s*!==\s*1/u);
assert.match(approval, /schemaVersion\s*!==\s*2\s*&&\s*schemaVersion\s*!==\s*3/u);
assert.match(approval, /APPROVAL_V2_KEYS/u);
assert.match(approval, /APPROVAL_V3_KEYS/u);
assert.match(approval, /expiresAt/u);
assert.match(approval, /MAX_APPROVAL_VALIDITY_MS/u);
assert.match(approval, /MAX_APPROVAL_CLOCK_SKEW_MS/u);
assert.match(approval, /canonical JSON without duplicate keys/u);
assert.match(approval, /TextDecoder\('utf-8',\s*\{\s*fatal:\s*true\s*\}\)/u);
assert.match(approval, /SANDBOX_APPROVAL_DIGEST_MISMATCH/u);
assert.match(approval, /SANDBOX_APPROVAL_MISMATCH/u);
assert.match(approval, /O_NOFOLLOW/u);
assert.match(approval, /metadata\.mode\s*&\s*0o077/u);
assert.match(approval, /preCallBillingSnapshotRefSha256/u);
assert.match(approval, /billingReconciliationRefSha256/u);
assert.match(approvalDraft, /DRAFT_REVIEW_REQUIRED_NOT_APPROVED/u);
assert.match(approvalDraft, /REPLACE_DURING_REVIEW/u);
assert.match(approvalDraft, /SANDBOX_APPROVAL_DRAFT_UNSAFE_ENV/u);
assert.match(approvalDraft, /AI_IMAGE_SANDBOX_APPROVAL_DRAFT_CREATED/u);
assert.match(approvalDraft, /constants\.O_EXCL/u);
assert.match(approvalDraft, /constants\.O_NOFOLLOW/u);
assert.match(approvalDraft, /constants\.O_DIRECTORY/u);
assert.match(approvalDraft, /\/proc\/self\/fd/u);
assert.match(approvalDraft, /beforeDraftWrite/u);
assert.match(approvalDraft, /handle\.sync\(\)/u);
assert.match(approvalDraft, /syncPrivateDraftDirectory/u);
assert.match(approvalDraft, /requireGitCheckout:\s*true/u);
assert.match(approvalDraft, /AI_IMAGE_SANDBOX_SOURCE_SHA256/u);
assert.match(approvalDraft, /AI_IMAGE_SANDBOX_MASK_SHA256/u);
assert.match(approvalDraft, /'generations'\s*:\s*'edits'/u);
assert.match(approvalDraft, /ai-image-openai-url\.js/u);
assert.match(approvalDraft, /ai-image-job-error\.ts/u);
assert.match(approvalDraft, /ai-image-sandbox-media\.ts/u);
assert.match(approvalDraft, /packages\/shared\/src\/ai-image-workbench-contract\.ts/u);
assert.match(source, /ai-image-openai-url\.ts/u);
assert.match(source, /ai-image-job-error\.ts/u);
assert.match(source, /ai-image-sandbox-media\.ts/u);
assert.match(source, /ai-image-sandbox-money\.ts/u);
assert.match(source, /packages\/shared\/src\/ai-image-workbench-contract\.ts/u);
assert.match(guard, /schemaVersion:\s*3 as const/u);
assert.match(guard, /quotedCost:\s*exactCosts\.quotedCost/u);
assert.match(guard, /maximumCost:\s*exactCosts\.maximumCost/u);
assert.match(sandboxMedia, /constants\.O_NOFOLLOW/u);
assert.match(sandboxMedia, /AI_IMAGE_WORKBENCH_LIMITS\.maxRequestBytes/u);
assert.match(sandboxMedia, /AI_IMAGE_WORKBENCH_LIMITS\.maxDimension/u);
assert.match(sandboxMedia, /AI_IMAGE_WORKBENCH_LIMITS\.maxPixels/u);
assert.match(sandboxMedia, /animated:\s*true/u);
assert.match(sandboxMedia, /metadata\.pages/u);
assert.match(sandboxMedia, /assertAiImageSandboxEditMediaLimit/u);
assert.match(sandboxMedia, /remainingAiImageSandboxEditMediaBytes/u);
assert.match(sandboxMedia, /assertMeaningfulAiImageSandboxMask/u);
assert.match(openAiImageUrl, /normalizeOpenAiImagesApiBase/u);
assert.match(openAiImageUrl, /AiImageJobError/u);
assert.match(imageProviders, /from '.\/ai-image-job-error\.js'/u);
assert.match(imageProviders, /import type \{[\s\S]*from '.\/ai-image-jobs\.js'/u);
assert.match(imageProviders, /AI_IMAGE_WORKBENCH_LIMITS\.maxRequestBytes/u);
assert.match(billingFinalizer, /SANDBOX_BILLING_UNSAFE_ENV/u);
assert.match(billingFinalizer, /AI_IMAGE_TRANSLATION_SANDBOX_API_KEY/u);
assert.match(billingFinalizer, /requireGitCheckout:\s*true/u);
assert.match(billingFinalizer, /AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH/u);
assert.match(billingFinalizer, /AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_SHA256/u);
assert.match(billingFinalizer, /ai-image-sandbox-money\.ts/u);
assert.match(readonlyPreflight, /PACKY_API_BASE\s*=\s*'https:\/\/www\.packyapi\.ai\/v1'/u);
assert.match(readonlyPreflight, /PACKY_MODEL\s*=\s*'gpt-image-2'/u);
assert.match(readonlyPreflight, /readAiImageProviderCredential/u);
assert.match(readonlyPreflight, /source:\s*AsyncIterable<unknown>\s*=\s*process\.stdin/u);
assert.match(readonlyPreflight, /TextDecoder\('utf-8',\s*\{\s*fatal:\s*true\s*\}\)/u);
assert.match(readonlyPreflight, /\^\[\\x21-\\x7e\]\{16,512\}\$/u);
assert.match(readonlyPreflight, /\/api\/usage\/token\//u);
assert.match(readonlyPreflight, /\/v1\/dashboard\/billing\/usage/u);
assert.match(readonlyPreflight, /\/api\/log\/token/u);
assert.match(readonlyPreflight, /method:\s*'GET'/u);
assert.match(readonlyPreflight, /redirect:\s*'error'/u);
assert.match(readonlyPreflight, /credentials:\s*'omit'/u);
assert.match(readonlyPreflight, /MAX_RESPONSE_BYTES\s*=\s*1_048_576/u);
assert.match(readonlyPreflight, /MAX_DOH_RESPONSE_BYTES\s*=\s*64\s*\*\s*1_024/u);
assert.match(readonlyPreflight, /body\.Status\s*!==\s*0/u);
assert.match(readonlyPreflight, /assertExpectedResponseSchema/u);
assert.match(readonlyPreflight, /containsCredential/u);
assert.match(readonlyPreflight, /contentType:\s*'application\/json'/u);
assert.match(readonlyPreflight, /PACKY_API_KEY/u);
assert.match(readonlyPreflight, /PACKY_TOKEN/u);
assert.match(readonlyPreflight, /process\.argv\.slice\(2\)\.length/u);
assert.match(readonlyPreflight, /interceptors\.dns/u);
assert.match(readonlyPreflight, /writeAiImageSandboxPrivateEvidenceBundle/u);
assert.match(readonlyPreflight, /providerPostSent:\s*false/u);
assert.match(readonlyPreflight, /chargeObserved:\s*false/u);
assert.match(readonlyPreflight, /SANDBOX_READONLY_METERS_CHANGED/u);
assert.match(readonlyPreflight, /AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_FAILED/u);
assert.doesNotMatch(readonlyPreflight, /method:\s*'POST'|createOpenAiImagesProvider|createOpenAiImageEditProvider/u);
assert.match(billingSettlement, /I_ATTEST_EXACT_PROVIDER_BILLING_SETTLEMENT/u);
assert.match(billingSettlement, /AI_IMAGE_SANDBOX_BILLING_SETTLED/u);
assert.match(billingSettlement, /COST_LIMIT_EXCEEDED/u);
assert.match(billingSettlement, /UNIQUE_ACCOUNT_TIME_WINDOW/u);
assert.match(billingSettlement, /PROVIDER_TOKEN_LOG_ENTRY/u);
assert.match(billingSettlement, /providerTokenLogSnapshotPath/u);
assert.match(billingSettlement, /providerBillingEntryRequestIdHash/u);
assert.match(billingSettlement, /providerTokenLogUserId/u);
assert.match(billingSettlement, /providerTokenLogTokenId/u);
assert.match(billingSettlement, /PROVIDER_BILLING_ENTRY_CLAIM_KEYS/u);
assert.match(billingSettlement, /resolve\(billingDirectory, '\.provider-entries'\)/u);
assert.match(billingSettlement, /actualCostCents\s*!==\s*null/u);
assert.match(billingSettlement, /REPORT_V3_REQUIRED_KEYS/u);
assert.match(billingSettlement, /REPORT_V4_REQUIRED_KEYS/u);
assert.match(billingSettlement, /REPORT_V5_REQUIRED_KEYS/u);
assert.match(billingSettlement, /NEW_API_QUOTA_AND_TOTAL_USAGE_V1/u);
assert.match(billingSettlement, /rawQuotaDelta/u);
assert.match(billingSettlement, /displayTotalUsageDelta/u);
assert.match(billingSettlement, /BigInt\(rawQuotaDelta\)/u);
assert.match(billingSettlement, /ATTESTATION_V3_KEYS/u);
assert.match(
  billingSettlement,
  /schemaVersion:\s*attestation\.schemaVersion\s*===\s*3\s*\?\s*4\s*:\s*3/u,
);
assert.match(billingSettlement, /artifacts mix incompatible evidence generations/u);
assert.match(billingSettlement, /apiBaseSha256/u);
assert.match(billingSettlement, /operationEndpointSha256/u);
assert.match(billingSettlement, /resolve\(billingDirectory, '\.claims'\)/u);
assert.match(billingSettlement, /writeExclusiveAtomicFile/u);
assert.match(billingSettlement, /writeAiImageSandboxPrivateEvidenceBundle/u);
assert.match(billingSettlement, /writePrivateOutputEntry/u);
assert.match(billingSettlement, /O_NOFOLLOW/u);
assert.match(billingSettlement, /canonical JSON without duplicate keys/u);
assert.match(billingSettlement, /preCallBillingSnapshotPath/u);
assert.match(billingSettlement, /settledBillingSnapshotPath/u);
assert.match(billingSettlement, /MAX_BILLING_SNAPSHOT_BYTES/u);
assert.match(billingSettlement, /MAX_PRECALL_SNAPSHOT_AGE_MS/u);
assert.match(billingSettlement, /createAiImageSandboxRequestFingerprint/u);
assert.match(billingSettlement, /modelSha256/u);
assert.match(billingSettlement, /finalizationAdapterRevision/u);
assert.match(billingSettlement, /isPathWithin/u);
assert.match(billingSettlement, /pathMetadata\.isFile/u);
assert.match(billingSettlement, /sameSnapshotFile/u);
assert.match(billingSettlement, /incomplete billing claim/u);
assert.match(billingSettlement, /await directory\.handle\.sync\(\)/u);
assert.match(
  billingSettlement,
  /await directory\.handle\.sync\(\);[\s\S]*await assertPrivateOutputDirectoryStable\(directory\);/u,
);
assert.doesNotMatch(billingSettlement, /syncDirectory\(directory\.canonicalPath\)/u);
assert.match(runbook, /ai-image-provider-sandbox-approval\.md/u);
assert.match(runbook, /AI_IMAGE_SANDBOX_APPROVAL_PATH/u);
assert.match(runbook, /AI_IMAGE_SANDBOX_APPROVAL_SHA256/u);
assert.match(approvalRunbook, /I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST/u);
assert.match(approvalRunbook, /gpt-image-2-i2i-20260724-200300-01/u);
assert.match(approvalRunbook, /requestCount/u);
assert.match(approvalRunbook, /preCallBillingSnapshotRef/u);
assert.match(approvalRunbook, /billingReconciliationRef/u);
assert.match(approvalRunbook, /sandbox:ai-image:approval:verify/u);
assert.match(approvalRunbook, /sandbox:ai-image:approval:draft/u);
assert.match(runbook, /sandbox:ai-image:approval:draft/u);
assert.match(approvalRunbook, /DRAFT_REVIEW_REQUIRED_NOT_APPROVED/u);
assert.match(approvalRunbook, /REPLACE_DURING_REVIEW/u);
assert.match(approvalRunbook, /"schemaVersion": 3/u);
assert.match(approvalRunbook, /"quotedCost"/u);
assert.match(approvalRunbook, /"amount": 119/u);
assert.match(approvalRunbook, /"scale": 4/u);
assert.match(approvalRunbook, /Historical `schemaVersion: 2` approvals/u);
assert.match(approvalRunbook, /"expiresAt":/u);
assert.match(approvalRunbook, /no longer than 60 minutes/u);
assert.match(approvalRunbook, /guarded POST boundary/u);
assert.match(approvalRunbook, /versioned backend pricing policy/u);
assert.match(approvalRunbook, /no Provider\s+pricing API synchronization is required/u);
assert.doesNotMatch(approvalRunbook, /authenticated pricing artifact binds/u);
assert.match(pricingAudit, /No Provider pricing synchronization is required/u);
assert.match(runbook, /ai-image-provider-sandbox-billing\.md/u);
assert.match(runbook, /AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT/u);
assert.match(runbook, /AI_IMAGE_SANDBOX_MAX_COST_AMOUNT/u);
assert.match(runbook, /AI_IMAGE_SANDBOX_COST_SCALE/u);
assert.match(runbook, /`schemaVersion: 5` submit report/u);
assert.match(runbook, /PROVIDER_DEFAULT_OMITTED/u);
assert.match(runbook, /failure-diagnostic\.json/u);
assert.match(runbook, /report-bound failure diagnostic sidecar/u);
assert.match(runbook, /qa02-centos-i2i-20260730-094857-01/u);
assert.match(approvalRunbook, /PROVIDER_DEFAULT_OMITTED/u);
assert.match(approvalRunbook, /qa02-centos-i2i-20260730-094857-01/u);
assert.match(approvalRunbook, /ai\.centos\.hk\/v1/u);
assert.match(approvalRunbook, /report-bound failure diagnostic sidecar/u);
assert.match(billingRunbook, /sandbox:ai-image:billing:finalize/u);
assert.match(billingRunbook, /I_ATTEST_EXACT_PROVIDER_BILLING_SETTLEMENT/u);
assert.match(billingRunbook, /COST_LIMIT_EXCEEDED/u);
assert.match(billingRunbook, /actualCost: null/u);
assert.match(billingRunbook, /actualCostCents: null/u);
assert.match(billingRunbook, /`schemaVersion: 5` submit report/u);
assert.match(billingRunbook, /"schemaVersion": 3/u);
assert.match(billingRunbook, /attestation v2/u);
assert.match(billingRunbook, /PROVIDER_TOKEN_LOG_ENTRY/u);
assert.match(billingRunbook, /NEW_API_QUOTA_AND_TOTAL_USAGE_V1/u);
assert.match(billingRunbook, /rawQuotaDelta/u);
assert.match(billingRunbook, /zero display delta must use its canonical/u);
assert.match(billingRunbook, /\{ "amount": 0, "scale": 0 \}/u);
assert.match(billingRunbook, /v3 settlement receipt/u);
assert.match(billingRunbook, /preCallBillingSnapshotPath/u);
assert.match(billingRunbook, /16 MiB/u);
assert.match(billingRunbook, /hard links/u);
assert.match(billingRunbook, /marker-only release archive/u);
assert.equal(
  serverPackage.scripts['sandbox:ai-image:approval:draft'],
  'tsx scripts/ai-image-provider-approval-draft.ts',
);
assert.equal(
  serverPackage.scripts['sandbox:ai-image:approval:verify'],
  'tsx scripts/ai-image-provider-single-submit.ts --verify-approval',
);
assert.equal(
  serverPackage.scripts['sandbox:ai-image:billing:finalize'],
  'tsx scripts/ai-image-provider-billing-finalize.ts',
);
assert.equal(
  serverPackage.scripts['sandbox:ai-image:readonly:preflight'],
  'tsx scripts/ai-image-provider-readonly-preflight.ts',
);
assert.match(preflight, /tsconfig\.sandbox\.json/u);
assert.match(sandboxTsconfig, /ai-image-provider-single-submit\.ts/u);
assert.match(sandboxTsconfig, /ai-image-provider-approval-draft\.ts/u);
assert.match(sandboxTsconfig, /ai-image-provider-approval-draft\.test\.ts/u);
assert.match(sandboxTsconfig, /ai-image-translation-single-submit\.ts/u);
assert.match(sandboxTsconfig, /ai-image-sandbox-approval\.ts/u);
assert.match(sandboxTsconfig, /ai-image-sandbox-media\.ts/u);
assert.match(sandboxTsconfig, /ai-image-provider-billing-finalize\.ts/u);
assert.match(sandboxTsconfig, /ai-image-provider-readonly-preflight\.ts/u);
assert.match(sandboxTsconfig, /ai-image-provider-readonly-preflight\.test\.ts/u);
assert.match(sandboxTsconfig, /ai-image-sandbox-billing-settlement\.ts/u);
assert.match(sandboxTsconfig, /ai-image-sandbox-code-revision\.ts/u);
assert.match(sandboxTsconfig, /ai-image-sandbox-guard-filesystem\.test\.ts/u);
assert.match(sandboxTsconfig, /ai-image-sandbox-media\.test\.ts/u);
assert.doesNotMatch(source, /endpointPath/u);
assert.doesNotMatch(source, /providerEndpoint\s*:/u);
assert.doesNotMatch(source, /setConfig|uploadBuffer|enqueueAiImageJob/u);
assert.doesNotMatch(source + guard, /gpt-image-2-count|sk-[A-Za-z0-9_.-]{12,}|rawResponse/u);
assert.doesNotMatch(
  billingFinalizer + billingSettlement,
  /undici|validateAiImageProviderUrl|createOpenAiImagesProvider|createOpenAiImageEditProvider|cloudflare-dns|node:(?:http|https|net|tls|dns)/iu,
);
assert.doesNotMatch(
  approvalDraft,
  /\bfetch\b|\blookup\b|resolvePublicDns|validateAiImageProviderUrl|cloudflare-dns|claimAiImageSandboxOperation|createAiImageSandboxRequestFingerprint|createOpenAiImagesProvider|createOpenAiImageEditProvider|node:(?:http|https|tls|dns)/iu,
);
assert.doesNotMatch(approvalDraft, /from ['"].*ai-image-providers\.js/u);
assert.doesNotMatch(
  openAiImageUrl + aiImageJobError + sandboxMedia,
  /\bfetch\b|\blookup\b|ipaddr|ai-image-(?:providers|jobs)|node:(?:http|https|net|tls|dns)/iu,
);

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

const unsafeApprovalPreflight = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/ai-image-provider-single-submit.ts', '--verify-approval'],
  {
    cwd: 'apps/server',
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_API_KEY: 'preflight-secret-must-not-appear',
    },
  },
);
assert.notEqual(unsafeApprovalPreflight.status, 0);
assert.match(unsafeApprovalPreflight.stderr, /SANDBOX_APPROVAL_PREFLIGHT_UNSAFE_ENV/u);
assert.doesNotMatch(unsafeApprovalPreflight.stderr, /preflight-secret-must-not-appear/u);
assert.doesNotMatch(unsafeApprovalPreflight.stderr, /I_ACCEPT_ONE_PAID_IMAGE_REQUEST/u);

const unsafeBillingFinalizer = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/ai-image-provider-billing-finalize.ts'],
  {
    cwd: 'apps/server',
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_API_KEY: 'billing-secret-must-not-appear',
    },
  },
);
assert.notEqual(unsafeBillingFinalizer.status, 0);
assert.match(unsafeBillingFinalizer.stderr, /SANDBOX_BILLING_UNSAFE_ENV/u);
assert.doesNotMatch(unsafeBillingFinalizer.stderr, /billing-secret-must-not-appear/u);

const approvalDraftBaseEnvironment = { ...process.env };
delete approvalDraftBaseEnvironment.AI_IMAGE_SANDBOX_API_KEY;
delete approvalDraftBaseEnvironment.AI_IMAGE_SANDBOX_CONFIRM;
for (const [name, value] of [
  ['AI_IMAGE_SANDBOX_API_KEY', 'draft-secret-must-not-appear'],
  ['AI_IMAGE_SANDBOX_CONFIRM', 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST'],
]) {
  const unsafeApprovalDraft = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/ai-image-provider-approval-draft.ts'],
    {
      cwd: 'apps/server',
      encoding: 'utf8',
      env: {
        ...approvalDraftBaseEnvironment,
        NODE_ENV: 'sandbox',
        [name]: value,
      },
    },
  );
  assert.notEqual(unsafeApprovalDraft.status, 0);
  assert.match(unsafeApprovalDraft.stderr, /SANDBOX_APPROVAL_DRAFT_UNSAFE_ENV/u);
  assert.doesNotMatch(unsafeApprovalDraft.stderr, /draft-secret-must-not-appear/u);
  assert.doesNotMatch(unsafeApprovalDraft.stderr, /I_ACCEPT_ONE_PAID_IMAGE_REQUEST/u);
}

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
