import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const source = fs.readFileSync(
  'apps/server/scripts/ai-image-translation-single-submit.ts',
  'utf8',
);
const guard = fs.readFileSync(
  'apps/server/src/services/ai-image-translation-sandbox-guard.ts',
  'utf8',
);
const serverPackage = fs.readFileSync('apps/server/package.json', 'utf8');
const preflight = fs.readFileSync('scripts/preflight.mjs', 'utf8');
const sandboxTsconfig = fs.readFileSync('apps/server/tsconfig.sandbox.json', 'utf8');

assert.match(source, /I_ACCEPT_ONE_PAID_IMAGE_TRANSLATION_REQUEST/u);
assert.match(source, /AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_PATH/u);
assert.match(source, /AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256/u);
assert.match(source, /AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_URL/u);
assert.match(source, /AI_IMAGE_TRANSLATION_SANDBOX_CREDENTIAL_REVISION/u);
assert.match(source, /AI_IMAGE_SANDBOX_ADAPTER_REVISION/u);
assert.match(source, /model\s*!==\s*'qwen-mt-image'/u);
assert.match(source, /export async function runAiImageTranslationSingleSubmit/u);
assert.match(source, /environment\?:\s*NodeJS\.ProcessEnv/u);
assert.match(source, /outputDirectory\?:\s*string/u);
assert.match(source, /repositoryRoot\?:\s*string/u);
assert.match(source, /resolveDns\?:\s*DnsResolver/u);
assert.match(source, /fetch\?:\s*FetchLike/u);
assert.match(source, /now\?:\s*\(\)\s*=>\s*number/u);
assert.match(source, /delay\?:\s*Delay/u);
assert.match(source, /environment\.NODE_ENV\s*!==\s*'sandbox'/u);
assert.match(source, /readFile\(sourcePath\)/u);
assert.match(source, /sha256\(sourceBytes\)\s*!==\s*sourceSha256/u);
assert.match(source, /claimAiImageTranslationSandboxOperation/u);
assert.match(source, /createAiImageTranslationSandboxFetchGuard/u);
assert.match(source, /endpointSha256/u);
assert.match(source, /credentialRevision/u);
assert.match(source, /adapterRevision/u);
assert.match(source, /MAX_POLL_REQUESTS/u);
assert.match(source, /MAX_POLL_DURATION_MS/u);
assert.match(source, /\/services\/aigc\/image2image\/image-synthesis/u);
assert.match(source, /cloudflare-dns\.com\/dns-query/u);
assert.match(source, /interceptors\.dns/u);
assert.match(source, /OFFICIAL_DASHSCOPE_HOST\s*=\s*'dashscope\.aliyuncs\.com'/u);
assert.match(source, /parsed\.origin\s*!==\s*`https:\/\/\$\{OFFICIAL_DASHSCOPE_HOST\}`/u);
assert.match(source, /path\s*!==\s*'\/api\/v1'/u);
assert.match(source, /redirect:\s*'error'/u);
assert.match(source, /providerTaskIdHash/u);
assert.match(source, /providerRequestIdHashes/u);
assert.match(source, /sourceUrlSha256/u);
assert.match(source, /domainHintSha256/u);
assert.match(source, /terminologiesSha256/u);
assert.match(source, /sharp\(/u);
assert.match(source, /verifyRemoteSource/u);
assert.match(source, /MAX_SOURCE_BYTES/u);
assert.match(source, /sourceUrlVerified:\s*true/u);
assert.match(source, /etagSha256/u);
assert.match(source, /cacheControlImmutable/u);
assert.match(source, /AI_IMAGE_TRANSLATION_SANDBOX_MODE/u);
assert.match(source, /AI_IMAGE_TRANSLATION_SANDBOX_RECONCILIATION_ID/u);
assert.match(source, /TASK_ACCEPTED/u);
assert.match(source, /RESULT_URL/u);
assert.match(source, /handle\.sync\(\)/u);
assert.match(source, /syncDirectory\(dirname\(path\)\)/u);
assert.match(source, /FULL_GIT_OID_PATTERN/u);
assert.match(source, /DEPLOYED_COMMIT/u);
assert.match(source, /detectedMime\s*!==\s*mimeType/u);
assert.match(source, /SANDBOX_COMMAND_FAILED/u);
assert.match(source, /atomicWritePrivateJson/u);
assert.match(source, /\.submit\.report\.json/u);
assert.match(source, /\.reconcile\.report\.json/u);
assert.match(source, /\['png',\s*'jpeg',\s*'webp'\]\.includes\(sourceMetadata\.format/u);
assert.match(guard, /RECONCILIATION_REQUIRED/u);
assert.match(guard, /isDefiniteProviderRejection/u);
assert.match(guard, /SANDBOX_REQUEST_REPLAY/u);
assert.match(guard, /canonicalJson/u);
assert.match(guard, /writeExclusiveDurableFile/u);
assert.match(guard, /handle\.sync\(\)/u);
assert.match(guard, /sourceSha256:\s*requestEvidence\.sourceSha256/u);
assert.match(guard, /resumePollingAfterResultFailure/u);
assert.match(serverPackage, /sandbox:ai-image-translation:single/u);
assert.match(preflight, /ai-image-translation-single-submit-contract\.test\.mjs/u);
assert.match(preflight, /tsconfig\.sandbox\.json/u);
assert.match(sandboxTsconfig, /ai-image-translation-single-submit\.ts/u);
assert.doesNotMatch(source, /uploadBuffer|enqueueAiImageJob|setConfig|Ozon/u);
assert.doesNotMatch(source + guard, /sk-[A-Za-z0-9_.-]{12,}|LTAI[A-Za-z0-9]{12,}/u);

const outsideSandbox = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/ai-image-translation-single-submit.ts'],
  {
    cwd: 'apps/server',
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development' },
  },
);
assert.notEqual(outsideSandbox.status, 0);
assert.match(outsideSandbox.stderr, /DashScope image translation sandbox failed/u);
assert.doesNotMatch(outsideSandbox.stderr, /inspect|report/iu);

console.log('PASS single-submit DashScope image translation sandbox contract');
