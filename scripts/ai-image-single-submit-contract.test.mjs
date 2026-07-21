import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'apps/server/scripts/ai-image-provider-single-submit.ts',
  'utf8',
);
const guard = fs.readFileSync(
  'apps/server/src/services/ai-image-sandbox-guard.ts',
  'utf8',
);

assert.match(source, /I_ACCEPT_ONE_PAID_IMAGE_REQUEST/u);
assert.match(source, /count:\s*1/u);
assert.match(source, /claimAiImageSandboxOperation/u);
assert.match(source, /createAiImageSandboxFetchGuard/u);
assert.match(source, /AI_IMAGE_SANDBOX_OPERATION_ID/u);
assert.match(source, /AI_IMAGE_SANDBOX_MAX_COST_CENTS/u);
assert.match(source, /\/v1\/images\/generations/u);
assert.match(source, /tmp\/ai-image-sandbox/u);
assert.match(source, /validateAiImageProviderUrl/u);
assert.match(source, /cloudflare-dns\.com\/dns-query/u);
assert.match(source, /interceptors\.dns/u);
assert.match(source, /providerEndpoint:\s*apiBase/u);
assert.match(guard, /createRequests\s*>\s*1/u);
assert.match(guard, /body\.n\s*!==\s*input\.contract\.n/u);
assert.match(guard, /promptSha256\s*!==\s*input\.contract\.promptSha256/u);
assert.match(guard, /body\.size\s*!==\s*input\.contract\.size/u);
assert.doesNotMatch(source, /setConfig|uploadBuffer|enqueueAiImageJob/u);
assert.doesNotMatch(source + guard, /gpt-image-2-count|sk-[A-Za-z0-9_.-]{12,}/u);

console.log('PASS single-submit AI image sandbox contract');
