import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, fetch as undiciFetch, interceptors } from 'undici';
import sharp from 'sharp';
import {
  createOpenAiImagesProvider,
  normalizeOpenAiImagesApiBase,
  validateAiImageProviderUrl,
} from '../src/services/ai-image-providers.js';
import {
  claimAiImageSandboxOperation,
  createAiImageSandboxFetchGuard,
} from '../src/services/ai-image-sandbox-guard.js';

const CONFIRMATION = 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST';
const FIXED_PROMPT = [
  'Create one square marketplace product image of a plain white ceramic mug.',
  'Use a neutral light-gray studio background, realistic lighting, and no visible text, logo, watermark, or extra object.',
].join(' ');
const pinnedDns = new Map<string, Array<{ address: string; family: 4 | 6; ttl: number }>>();

function requiredEnvironment(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function resolvePublicDns(hostname: string) {
  const records: Array<{ address: string; family: 4 | 6; ttl: number }> = [];
  for (const type of ['A', 'AAAA']) {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', type);
    const response = await globalThis.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Public DNS lookup failed (HTTP ${response.status})`);
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    for (const answer of body.Answer || []) {
      if ((answer.type === 1 || answer.type === 28) && typeof answer.data === 'string') {
        records.push({ address: answer.data, family: answer.type === 1 ? 4 : 6, ttl: 60 });
      }
    }
  }
  if (!records.length) throw new Error('Public DNS lookup returned no address');
  const unique = [...new Map(records.map((record) => [record.family + ':' + record.address, record])).values()];
  pinnedDns.set(hostname.toLowerCase(), unique);
  return unique.map(({ address }) => ({ address }));
}

async function main() {
  if (process.env.AI_IMAGE_SANDBOX_CONFIRM !== CONFIRMATION) {
    throw new Error(`AI_IMAGE_SANDBOX_CONFIRM must equal ${CONFIRMATION}`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The single-submit AI image sandbox cannot run in production');
  }

  const baseUrl = requiredEnvironment('AI_IMAGE_SANDBOX_BASE_URL');
  const apiKey = requiredEnvironment('AI_IMAGE_SANDBOX_API_KEY');
  const model = requiredEnvironment('AI_IMAGE_SANDBOX_MODEL');
  const operationId = requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION_ID');
  const expectedHost = requiredEnvironment('AI_IMAGE_SANDBOX_EXPECTED_HOST').toLowerCase();
  const apiBase = normalizeOpenAiImagesApiBase(baseUrl);
  const parsedBaseUrl = new URL(apiBase);
  if (isIP(parsedBaseUrl.hostname) !== 0) throw new Error('AI_IMAGE_SANDBOX_BASE_URL must use a DNS hostname');
  if (parsedBaseUrl.hostname.toLowerCase() !== expectedHost) {
    throw new Error('AI_IMAGE_SANDBOX_EXPECTED_HOST does not match the configured base URL');
  }
  await validateAiImageProviderUrl(apiBase, resolvePublicDns);
  const startedAt = Date.now();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const outputDirectory = resolve(root, 'tmp/ai-image-sandbox');
  const requestContract = {
    operation: 'TEXT_TO_IMAGE',
    endpoint: `${apiBase}/images/generations`,
    n: 1,
    width: 1024,
    height: 1024,
    size: '1024x1024',
    promptSha256: createHash('sha256').update(FIXED_PROMPT).digest('hex'),
  };
  const claim = await claimAiImageSandboxOperation({
    directory: resolve(outputDirectory, 'intents'),
    operationId,
    providerEndpoint: apiBase,
    model,
    request: requestContract,
    quotedCostCents: requiredEnvironment('AI_IMAGE_SANDBOX_QUOTED_COST_CENTS'),
    maximumCostCents: requiredEnvironment('AI_IMAGE_SANDBOX_MAX_COST_CENTS'),
  });

  const pinnedDispatcher = new Agent().compose(interceptors.dns({
    affinity: 4,
    lookup(origin, _options, callback) {
      const records = pinnedDns.get(origin.hostname.toLowerCase());
      if (!records?.length) {
        callback(Object.assign(new Error('Sandbox DNS was not pinned before connect'), { code: 'ENOTFOUND' }), []);
        return;
      }
      callback(null, records);
    },
  }));
  const fetchOnce = createAiImageSandboxFetchGuard({
    contract: {
      endpoint: `${apiBase}/images/generations`,
      model,
      promptSha256: requestContract.promptSha256,
      size: '1024x1024',
      n: 1,
    },
    validateUrl: (url) => validateAiImageProviderUrl(url, resolvePublicDns),
    fetch: ((input, init) => undiciFetch(input as any, {
      ...(init as any),
      dispatcher: pinnedDispatcher,
    })) as typeof globalThis.fetch,
  });

  const provider = createOpenAiImagesProvider({
    baseUrl,
    apiKey,
    model,
    fetch: fetchOnce.fetch,
    timeoutMs: 180_000,
    costPerImageCents: 0,
  });
  let result;
  try {
    result = await provider.generate({
      operation: 'TEXT_TO_IMAGE',
      prompt: FIXED_PROMPT,
      negativePrompt: null,
      count: 1,
      width: 1024,
      height: 1024,
      model,
    });
  } finally {
    await pinnedDispatcher.close();
  }
  const createRequests = fetchOnce.getCreateRequests();
  if (createRequests !== 1) throw new Error(`Expected exactly one create request, received ${createRequests}`);
  if (result.images.length !== 1) throw new Error(`Expected exactly one image, received ${result.images.length}`);

  const image = result.images[0]!;
  const metadata = await sharp(image.buffer).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) {
    throw new Error('Provider returned invalid image dimensions');
  }
  const extension = image.mimeType === 'image/jpeg' ? 'jpg'
    : image.mimeType === 'image/webp' ? 'webp' : 'png';
  await mkdir(outputDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const imagePath = resolve(outputDirectory, `${stamp}.${extension}`);
  const reportPath = resolve(outputDirectory, `${stamp}.json`);
  await writeFile(imagePath, image.buffer, { flag: 'wx' });

  const report = {
    schemaVersion: 1,
    operationId,
    provider: 'custom-openai-compatible',
    model,
    endpointPath: '/v1/images/generations',
    createRequests,
    imageCount: 1,
    mimeType: image.mimeType,
    width: metadata.width,
    height: metadata.height,
    bytes: image.buffer.byteLength,
    sha256: createHash('sha256').update(image.buffer).digest('hex'),
    providerRequestIdHash: result.providerJobId
      ? createHash('sha256').update(result.providerJobId).digest('hex')
      : null,
    elapsedMs: Date.now() - startedAt,
    actualCostCents: null,
    quotedCostCents: claim.intent.quotedCostCents,
    maximumCostCents: claim.intent.maximumCostCents,
    intentPath: claim.intentPath,
    imagePath,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
