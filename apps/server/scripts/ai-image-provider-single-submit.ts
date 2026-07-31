import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  open,
  rename,
  unlink,
} from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, fetch as undiciFetch, interceptors } from 'undici';
import sharp from 'sharp';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared/ai-image-workbench-contract';
import {
  createOpenAiImageEditProvider,
  createOpenAiImagesProvider,
  normalizeOpenAiImagesApiBase,
  validateAiImageProviderUrl,
} from '../src/services/ai-image-providers.js';
import {
  AiImageSandboxMediaError,
  assertAiImageSandboxEditMediaLimit,
  assertMeaningfulAiImageSandboxMask,
  loadPinnedAiImageSandboxMedia,
  remainingAiImageSandboxEditMediaBytes,
} from '../src/services/ai-image-sandbox-media.js';
import {
  claimAiImageSandboxOperation,
  createAiImageSandboxEditFetchGuard,
  createAiImageSandboxFetchGuard,
  type AiImageSandboxEditOperation,
} from '../src/services/ai-image-sandbox-guard.js';
import {
  assertAiImageSandboxApprovalCurrent,
  loadAiImageSandboxApproval,
} from '../src/services/ai-image-sandbox-approval.js';
import {
  AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN,
  resolveAiImageSandboxRepositoryRevision,
  sanitizeAiImageSandboxGitEnvironment,
} from '../src/services/ai-image-sandbox-code-revision.js';
import {
  AI_IMAGE_SANDBOX_MAX_COST_MAJOR_UNITS,
  AiImageSandboxMoneyError,
  type AiImageSandboxMoney,
  assertAiImageSandboxMoneyMajorUnitLimit,
  assertAiImageSandboxMoneyPair,
  parseAiImageSandboxLegacyCents,
  parseAiImageSandboxMoneyIntegers,
} from '../src/services/ai-image-sandbox-money.js';

export {
  resolveAiImageSandboxRepositoryRevision,
  sanitizeAiImageSandboxGitEnvironment,
};

const CONFIRMATION = 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST';
const SINGLE_SUBMIT_TRACKED_PATHS = [
  'apps/server/scripts/ai-image-provider-single-submit.ts',
  'apps/server/src/services/ai-image-sandbox-code-revision.ts',
  'apps/server/src/services/ai-image-sandbox-approval.ts',
  'apps/server/src/services/ai-image-sandbox-guard.ts',
  'apps/server/src/services/ai-image-sandbox-money.ts',
  'apps/server/src/services/ai-image-job-error.ts',
  'apps/server/src/services/ai-image-openai-url.ts',
  'apps/server/src/services/ai-image-providers.ts',
  'apps/server/src/services/ai-image-sandbox-media.ts',
  'packages/shared/src/ai-image-workbench-contract.ts',
];
type AiImageSandboxOperation = 'TEXT_TO_IMAGE' | AiImageSandboxEditOperation;
type AiImageSandboxMode = 'SUBMIT' | 'VERIFY_APPROVAL';
const SANDBOX_MODES = new Set<AiImageSandboxMode>(['SUBMIT', 'VERIFY_APPROVAL']);
const REQUEST_PROFILES = Object.freeze({
  OPENAI_SQUARE_SINGLE_V1: Object.freeze({ width: 1024, height: 1024, format: 'square' }),
  OZON_PORTRAIT_SINGLE_V1: Object.freeze({
    width: 1024,
    height: 1536,
    format: 'vertical 2:3 Provider canvas; compose crop-safe for final 3:4 normalization',
  }),
});
type AiImageSandboxRequestProfile = keyof typeof REQUEST_PROFILES;
const EDIT_OPERATIONS = new Set<AiImageSandboxEditOperation>([
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
]);
const SANDBOX_OPERATIONS = new Set<AiImageSandboxOperation>([
  'TEXT_TO_IMAGE',
  ...EDIT_OPERATIONS,
]);
function fixedPrompt(
  operation: AiImageSandboxOperation,
  profile: (typeof REQUEST_PROFILES)[AiImageSandboxRequestProfile],
): string {
  if (operation === 'TEXT_TO_IMAGE') return [
    `Create one ${profile.format} marketplace product image of a plain white ceramic mug.`,
    'Use a neutral light-gray studio background, realistic lighting, and no visible text, logo, watermark, or extra object.',
  ].join(' ');
  if (operation === 'IMAGE_TO_IMAGE') return [
    'Use the supplied source image as the only visual reference.',
    'Preserve the primary product identity, shape, colors, and proportions.',
    `Create one ${profile.format} marketplace hero image on a clearly visible soft warm-beige studio background.`,
    'Do not add visible text, logos, watermarks, or extra objects.',
  ].join(' ');
  if (operation === 'FULL_EDIT') return [
    `Restyle the complete supplied product image as a clean ${profile.format} marketplace hero image.`,
    'Preserve the primary product identity, shape, colors, and proportions.',
    'Use realistic studio lighting and a neutral light-gray background.',
    'Do not add visible text, logos, watermarks, or extra objects.',
  ].join(' ');
  return [
    'Modify only the transparent mask region of the supplied product image.',
    'Fill that region with a soft light-blue studio background that matches the existing lighting.',
    'Preserve every unmasked product detail and do not add text, logos, watermarks, or extra objects.',
  ].join(' ');
}
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type DnsResolver = (hostname: string) => Promise<Array<{ address: string }>>;

export interface AiImageProviderSingleSubmitOptions {
  environment?: NodeJS.ProcessEnv;
  outputDirectory?: string;
  repositoryRoot?: string;
  resolveDns?: DnsResolver;
  fetch?: FetchLike;
  now?: () => Date;
  requireGitCheckout?: boolean;
}

function currentTime(options: AiImageProviderSingleSubmitOptions) {
  return options.now?.() || new Date();
}

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  const value = String(environment[name] || '').trim();
  if (!value) {
    throw Object.assign(new Error(`${name} is required`), { code: 'SANDBOX_CONFIG_INVALID' });
  }
  return value;
}

function optionalEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  return String(environment[name] || '').trim();
}

type AiImageSandboxCostConfiguration =
  | {
      kind: 'EXACT';
      quotedCost: AiImageSandboxMoney;
      maximumCost: AiImageSandboxMoney;
    }
  | {
      kind: 'LEGACY_CENTS';
      quotedCostCentsValue: string;
      maximumCostCentsValue: string;
    };

function sandboxCostConfiguration(
  environment: NodeJS.ProcessEnv,
): AiImageSandboxCostConfiguration {
  const exactMoneyNames = [
    'AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT',
    'AI_IMAGE_SANDBOX_MAX_COST_AMOUNT',
    'AI_IMAGE_SANDBOX_COST_SCALE',
  ] as const;
  const legacyNames = [
    'AI_IMAGE_SANDBOX_QUOTED_COST_CENTS',
    'AI_IMAGE_SANDBOX_MAX_COST_CENTS',
  ] as const;
  const hasExact = exactMoneyNames.some((name) => optionalEnvironment(name, environment));
  const hasLegacy = legacyNames.some((name) => optionalEnvironment(name, environment));
  if (hasExact && hasLegacy) {
    throw Object.assign(
      new Error('Sandbox cost configuration must not mix exact money and legacy cents'),
      { code: 'SANDBOX_COST_CONFIG_INVALID' },
    );
  }
  if (!hasExact) {
    try {
      const quotedCostCents = parseAiImageSandboxLegacyCents(
        requiredEnvironment(legacyNames[0], environment),
        'Sandbox quoted cost cents',
      );
      const maximumCostCents = parseAiImageSandboxLegacyCents(
        requiredEnvironment(legacyNames[1], environment),
        'Sandbox maximum cost cents',
      );
      if (quotedCostCents > maximumCostCents) {
        throw new AiImageSandboxMoneyError('Sandbox quoted cost exceeds its maximum');
      }
      return {
        kind: 'LEGACY_CENTS',
        quotedCostCentsValue: String(quotedCostCents),
        maximumCostCentsValue: String(maximumCostCents),
      };
    } catch (error) {
      if (error instanceof AiImageSandboxMoneyError) {
        throw Object.assign(new Error(error.message), { code: 'SANDBOX_COST_CONFIG_INVALID' });
      }
      throw error;
    }
  }
  try {
    const currency = requiredEnvironment('AI_IMAGE_SANDBOX_CURRENCY', environment);
    const scale = requiredEnvironment(exactMoneyNames[2], environment);
    const quotedCost = parseAiImageSandboxMoneyIntegers({
      currency,
      amount: requiredEnvironment(exactMoneyNames[0], environment),
      scale,
      field: 'Sandbox quoted cost',
    });
    const maximumCost = parseAiImageSandboxMoneyIntegers({
      currency,
      amount: requiredEnvironment(exactMoneyNames[1], environment),
      scale,
      field: 'Sandbox maximum cost',
    });
    assertAiImageSandboxMoneyPair(quotedCost, maximumCost);
    assertAiImageSandboxMoneyMajorUnitLimit(
      maximumCost,
      AI_IMAGE_SANDBOX_MAX_COST_MAJOR_UNITS,
    );
    return { kind: 'EXACT', quotedCost, maximumCost };
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw Object.assign(new Error(error.message), { code: 'SANDBOX_COST_CONFIG_INVALID' });
    }
    throw error;
  }
}

function requiredSha256(name: string, environment: NodeJS.ProcessEnv) {
  const value = requiredEnvironment(name, environment).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${name} must be a lowercase SHA-256 digest`);
  return value;
}

function requiredAdapterRevision(environment: NodeJS.ProcessEnv) {
  const value = requiredEnvironment('AI_IMAGE_SANDBOX_ADAPTER_REVISION', environment).toLowerCase();
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(value)) {
    throw Object.assign(
      new Error('AI_IMAGE_SANDBOX_ADAPTER_REVISION must be a full Git object ID'),
      { code: 'SANDBOX_ADAPTER_REVISION_INVALID' },
    );
  }
  return value;
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

async function inspectProviderOutput(
  image: { buffer: Buffer; mimeType: string },
  expected: { width: number; height: number },
) {
  if (
    !Buffer.isBuffer(image.buffer)
    || image.buffer.byteLength < 1
    || image.buffer.byteLength > AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes
  ) {
    throw new AiImageSandboxMediaError('Provider output must be a bounded image buffer');
  }

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(image.buffer, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels,
    }).metadata();
  } catch {
    throw new AiImageSandboxMediaError('Provider output metadata could not be decoded safely');
  }
  const mimeType = metadata.format === 'png' ? 'image/png'
    : metadata.format === 'jpeg' ? 'image/jpeg'
      : metadata.format === 'webp' ? 'image/webp'
        : null;
  if (
    !mimeType
    || mimeType !== image.mimeType
    || !Number.isSafeInteger(metadata.width)
    || !Number.isSafeInteger(metadata.height)
    || !metadata.width
    || !metadata.height
    || metadata.width > AI_IMAGE_WORKBENCH_LIMITS.maxDimension
    || metadata.height > AI_IMAGE_WORKBENCH_LIMITS.maxDimension
    || metadata.width * metadata.height > AI_IMAGE_WORKBENCH_LIMITS.maxPixels
    || Number(metadata.pages || 1) !== 1
  ) {
    throw new AiImageSandboxMediaError(
      'Provider output must be one supported single-frame image matching its declared MIME type',
    );
  }

  let decoded: Awaited<ReturnType<ReturnType<typeof sharp>['toBuffer']>>;
  try {
    decoded = await sharp(image.buffer, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels,
    })
      .autoOrient()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AiImageSandboxMediaError('Provider output could not be decoded completely');
  }
  if (
    decoded.info.width !== expected.width
    || decoded.info.height !== expected.height
    || decoded.info.channels !== 4
  ) {
    throw new AiImageSandboxMediaError(
      `Provider output dimensions must equal ${expected.width}x${expected.height}`,
    );
  }
  return {
    mimeType,
    width: decoded.info.width,
    height: decoded.info.height,
  };
}

async function tolerateWindowsMode(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error: any) {
    if (process.platform === 'win32' && ['EINVAL', 'ENOSYS', 'EPERM'].includes(String(error?.code))) return;
    throw error;
  }
}

async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error: any) {
    if (
      process.platform === 'win32'
      && ['EACCES', 'EINVAL', 'EISDIR', 'ENOSYS', 'EPERM'].includes(String(error?.code))
    ) return;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function ensurePrivateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await tolerateWindowsMode(() => chmod(path, 0o700));
  await syncDirectory(path);
  const parent = dirname(path);
  if (parent !== path) await syncDirectory(parent);
}

async function writePrivateFile(path: string, value: string | Buffer) {
  await ensurePrivateDirectory(dirname(path));
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(value);
    await tolerateWindowsMode(() => handle.chmod(0o600));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function atomicWritePrivateJson(path: string, value: unknown) {
  await ensurePrivateDirectory(dirname(path));
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    await tolerateWindowsMode(() => chmod(lockPath, 0o600));
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await tolerateWindowsMode(() => chmod(temporaryPath, 0o600));
    try {
      await access(path);
      throw Object.assign(new Error('Sandbox report already exists'), { code: 'EEXIST' });
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await rename(temporaryPath, path);
    await tolerateWindowsMode(() => chmod(path, 0o600));
    await syncDirectory(dirname(path));
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function safeFailureCode(error: unknown) {
  const value = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return value.toUpperCase().replace(/[^A-Z0-9_.-]/g, '').slice(0, 80) || 'SANDBOX_FAILED';
}

function isProviderHttpFailureStatus(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 400
    && value <= 599;
}

function failureRequestIdHash(error: unknown, fallback: string | null) {
  const value = error && typeof error === 'object' && 'providerJobId' in error
    ? String((error as { providerJobId?: unknown }).providerJobId || '').trim()
    : '';
  return value && value.length <= 500 ? sha256(value) : fallback;
}

async function loadPinnedImage(input: {
  pathEnvironment: string;
  shaEnvironment: string;
  requirePng?: boolean;
  maximumBytes?: number;
  environment: NodeJS.ProcessEnv;
  repositoryRoot: string;
}) {
  const path = resolve(
    input.repositoryRoot,
    requiredEnvironment(input.pathEnvironment, input.environment),
  );
  const expectedSha256 = requiredSha256(input.shaEnvironment, input.environment);
  const media = await loadPinnedAiImageSandboxMedia({
    path,
    expectedSha256,
    label: input.pathEnvironment,
    requirePng: input.requirePng,
    maximumBytes: input.maximumBytes,
  });
  return {
    ...media,
    image: { buffer: media.bytes, mimeType: media.mimeType },
  };
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
  return unique.map(({ address }) => ({ address }));
}

export async function runAiImageProviderSingleSubmit(
  options: AiImageProviderSingleSubmitOptions = {},
) {
  const environment = options.environment || process.env;
  const repositoryRoot = options.repositoryRoot
    || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  if (environment.NODE_ENV !== 'sandbox') {
    throw new Error('NODE_ENV must equal sandbox for the single-submit AI image sandbox');
  }
  const modeValue = optionalEnvironment('AI_IMAGE_SANDBOX_MODE', environment) || 'SUBMIT';
  if (!SANDBOX_MODES.has(modeValue as AiImageSandboxMode)) {
    throw Object.assign(new Error('AI_IMAGE_SANDBOX_MODE is unsupported'), {
      code: 'SANDBOX_MODE_INVALID',
    });
  }
  const mode = modeValue as AiImageSandboxMode;
  if (mode === 'VERIFY_APPROVAL' && (
    optionalEnvironment('AI_IMAGE_SANDBOX_CONFIRM', environment)
    || optionalEnvironment('AI_IMAGE_SANDBOX_API_KEY', environment)
  )) {
    throw Object.assign(
      new Error('Approval preflight must not receive a paid confirmation or API key'),
      { code: 'SANDBOX_APPROVAL_PREFLIGHT_UNSAFE_ENV' },
    );
  }
  let submitApiKey: string | null = null;
  if (mode === 'SUBMIT') {
    if (environment.AI_IMAGE_SANDBOX_CONFIRM !== CONFIRMATION) {
      throw new Error(`AI_IMAGE_SANDBOX_CONFIRM must equal ${CONFIRMATION}`);
    }
    submitApiKey = requiredEnvironment('AI_IMAGE_SANDBOX_API_KEY', environment);
    if (environment === process.env) {
      delete process.env.AI_IMAGE_SANDBOX_API_KEY;
      delete process.env.AI_IMAGE_SANDBOX_CONFIRM;
    }
  }

  const baseUrl = requiredEnvironment('AI_IMAGE_SANDBOX_BASE_URL', environment);
  const model = requiredEnvironment('AI_IMAGE_SANDBOX_MODEL', environment);
  const operationId = requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION_ID', environment);
  const credentialRevision = requiredEnvironment('AI_IMAGE_SANDBOX_CREDENTIAL_REVISION', environment);
  const adapterRevision = requiredAdapterRevision(environment);
  const repositoryRevision = await resolveAiImageSandboxRepositoryRevision(
    repositoryRoot,
    undefined,
    SINGLE_SUBMIT_TRACKED_PATHS,
    options.requireGitCheckout,
  );
  if (repositoryRevision !== adapterRevision) {
    throw Object.assign(new Error('Adapter revision does not match the deployed code'), {
      code: 'SANDBOX_ADAPTER_REVISION_MISMATCH',
    });
  }
  const operationValue = requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION', environment);
  if (!SANDBOX_OPERATIONS.has(operationValue as AiImageSandboxOperation)) {
    throw new Error('AI_IMAGE_SANDBOX_OPERATION is unsupported');
  }
  const operation = operationValue as AiImageSandboxOperation;
  const requestProfileValue = requiredEnvironment('AI_IMAGE_SANDBOX_REQUEST_PROFILE', environment);
  if (!Object.hasOwn(REQUEST_PROFILES, requestProfileValue)) {
    throw Object.assign(new Error('AI_IMAGE_SANDBOX_REQUEST_PROFILE is unsupported'), {
      code: 'SANDBOX_REQUEST_PROFILE_INVALID',
    });
  }
  const requestProfile = requestProfileValue as AiImageSandboxRequestProfile;
  const profile = REQUEST_PROFILES[requestProfile];
  const outputSize = `${profile.width}x${profile.height}`;
  const expectedHost = requiredEnvironment('AI_IMAGE_SANDBOX_EXPECTED_HOST', environment).toLowerCase();
  const apiBase = normalizeOpenAiImagesApiBase(baseUrl);
  const parsedBaseUrl = new URL(apiBase);
  if (parsedBaseUrl.protocol !== 'https:') {
    throw new Error('AI_IMAGE_SANDBOX_BASE_URL must use HTTPS');
  }
  if (
    parsedBaseUrl.username
    || parsedBaseUrl.password
    || parsedBaseUrl.search
    || parsedBaseUrl.hash
    || parsedBaseUrl.hostname.toLowerCase() === 'localhost'
    || parsedBaseUrl.hostname.toLowerCase().endsWith('.localhost')
  ) {
    throw new Error('AI_IMAGE_SANDBOX_BASE_URL must use a public credential-free DNS hostname');
  }
  if (isIP(parsedBaseUrl.hostname) !== 0) throw new Error('AI_IMAGE_SANDBOX_BASE_URL must use a DNS hostname');
  if (parsedBaseUrl.hostname.toLowerCase() !== expectedHost) {
    throw new Error('AI_IMAGE_SANDBOX_EXPECTED_HOST does not match the configured base URL');
  }
  const sourcePath = optionalEnvironment('AI_IMAGE_SANDBOX_SOURCE_PATH', environment);
  const sourceSha = optionalEnvironment('AI_IMAGE_SANDBOX_SOURCE_SHA256', environment);
  const maskPath = optionalEnvironment('AI_IMAGE_SANDBOX_MASK_PATH', environment);
  const maskSha = optionalEnvironment('AI_IMAGE_SANDBOX_MASK_SHA256', environment);
  let source: Awaited<ReturnType<typeof loadPinnedImage>> | null = null;
  let mask: Awaited<ReturnType<typeof loadPinnedImage>> | null = null;
  if (operation === 'TEXT_TO_IMAGE') {
    if (sourcePath || sourceSha || maskPath || maskSha) {
      throw new Error('TEXT_TO_IMAGE must not configure sandbox source or mask files');
    }
  } else {
    if (!sourcePath || !sourceSha) {
      throw new Error(`${operation} requires AI_IMAGE_SANDBOX_SOURCE_PATH and AI_IMAGE_SANDBOX_SOURCE_SHA256`);
    }
    source = await loadPinnedImage({
      pathEnvironment: 'AI_IMAGE_SANDBOX_SOURCE_PATH',
      shaEnvironment: 'AI_IMAGE_SANDBOX_SOURCE_SHA256',
      environment,
      repositoryRoot,
    });
  }
  if (operation === 'INPAINT' && source) {
    if (!maskPath || !maskSha) {
      throw new Error('INPAINT requires AI_IMAGE_SANDBOX_MASK_PATH and AI_IMAGE_SANDBOX_MASK_SHA256');
    }
    mask = await loadPinnedImage({
      pathEnvironment: 'AI_IMAGE_SANDBOX_MASK_PATH',
      shaEnvironment: 'AI_IMAGE_SANDBOX_MASK_SHA256',
      requirePng: true,
      maximumBytes: remainingAiImageSandboxEditMediaBytes([source]),
      environment,
      repositoryRoot,
    });
  } else if (maskPath || maskSha) {
    throw new Error(`${operation} must not configure a sandbox mask`);
  }
  assertAiImageSandboxEditMediaLimit([
    ...(source ? [source] : []),
    ...(mask ? [mask] : []),
  ]);
  if (operation === 'INPAINT' && source && mask) {
    await assertMeaningfulAiImageSandboxMask(mask);
    if (mask.width !== source.width || mask.height !== source.height) {
      throw new Error('The INPAINT mask dimensions must match the pinned source image');
    }
  }
  const operationEndpoint = new URL(
    `${apiBase}/images/${operation === 'TEXT_TO_IMAGE' ? 'generations' : 'edits'}`,
  ).toString();
  const apiBaseSha256 = sha256(apiBase);
  const operationEndpointSha256 = sha256(operationEndpoint);
  const prompt = fixedPrompt(operation, profile);
  const sourceSha256 = source ? [source.sha256] : [];
  const maskSha256 = mask?.sha256 || null;
  const costs = sandboxCostConfiguration(environment);
  const approvalEvidence = await loadAiImageSandboxApproval({
    repositoryRoot,
    approvalPath: requiredEnvironment('AI_IMAGE_SANDBOX_APPROVAL_PATH', environment),
    expectedSha256: requiredSha256('AI_IMAGE_SANDBOX_APPROVAL_SHA256', environment),
    now: currentTime(options),
    expected: {
      operationId,
      endpoint: operationEndpoint,
      expectedHost,
      model,
      operation,
      requestProfile,
      credentialRevision,
      adapterRevision,
      sourceSha256,
      maskSha256,
      ...(costs.kind === 'EXACT'
        ? { quotedCost: costs.quotedCost, maximumCost: costs.maximumCost }
        : {
            quotedCostCents: Number(costs.quotedCostCentsValue),
            maximumCostCents: Number(costs.maximumCostCentsValue),
          }),
    },
  });
  if (mode === 'VERIFY_APPROVAL') {
    assertAiImageSandboxApprovalCurrent(approvalEvidence, currentTime(options));
    const verification = {
      schemaVersion: costs.kind === 'EXACT' ? 3 : 2,
      event: 'AI_IMAGE_SANDBOX_APPROVAL_VERIFIED',
      operationId,
      operation,
      requestProfile,
      credentialRevision,
      adapterRevision,
      provider: 'custom-openai-compatible',
      model,
      apiBaseSha256,
      operationEndpointSha256,
      sourceSha256,
      maskSha256,
      requestedSize: outputSize,
      ...(costs.kind === 'EXACT'
        ? { quotedCost: costs.quotedCost, maximumCost: costs.maximumCost }
        : {
            quotedCostCents: Number(costs.quotedCostCentsValue),
            maximumCostCents: Number(costs.maximumCostCentsValue),
          }),
      approvalEvidence,
    };
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    return verification;
  }
  const apiKey = submitApiKey!;
  const pinnedDns = new Map<string, Array<{ address: string; family: 4 | 6; ttl: number }>>();
  const baseDnsResolver = options.resolveDns || resolvePublicDns;
  const dnsResolver: DnsResolver = async (hostname) => {
    const records = await baseDnsResolver(hostname);
    const pinned = records.map((record) => {
      const family = isIP(record.address);
      if (family !== 4 && family !== 6) throw new Error('DNS resolver returned an invalid address');
      return { address: record.address, family, ttl: 60 } as const;
    });
    pinnedDns.set(hostname.toLowerCase(), pinned);
    return records;
  };
  await validateAiImageProviderUrl(apiBase, dnsResolver);
  assertAiImageSandboxApprovalCurrent(approvalEvidence, currentTime(options));
  const outputDirectory = options.outputDirectory || resolve(repositoryRoot, 'tmp/ai-image-sandbox');
  await ensurePrivateDirectory(outputDirectory);
  const requestContract = {
    operation,
    requestProfile,
    endpoint: operationEndpoint,
    n: 1,
    width: profile.width,
    height: profile.height,
    size: outputSize,
    promptSha256: sha256(prompt),
    sourceSha256,
    sourceDimensions: source ? [{ width: source.width, height: source.height }] : [],
    maskSha256,
    maskDimensions: mask ? { width: mask.width, height: mask.height } : null,
    approvalEvidence,
  };
  const claim = await claimAiImageSandboxOperation({
    directory: resolve(outputDirectory, 'intents'),
    operationId,
    endpointSha256: operationEndpointSha256,
    ...(costs.kind === 'EXACT' ? { apiBaseSha256 } : {}),
    model,
    credentialRevision,
    adapterRevision,
    request: requestContract,
    ...(costs.kind === 'EXACT'
      ? { quotedCost: costs.quotedCost, maximumCost: costs.maximumCost }
      : {
          quotedCostCents: costs.quotedCostCentsValue,
          maximumCostCents: costs.maximumCostCentsValue,
        }),
    now: currentTime(options),
  });
  const startedAtMs = Math.max(Date.now(), Date.parse(claim.intent.createdAt));
  const startedAt = new Date(startedAtMs).toISOString();

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
  const guardedTransport = {
    validateUrl: (url: string) => validateAiImageProviderUrl(url, dnsResolver),
    beforeCreate: () => assertAiImageSandboxApprovalCurrent(
      approvalEvidence,
      currentTime(options),
    ),
    fetch: options.fetch || ((input, init) => undiciFetch(input as any, {
      ...(init as any),
      dispatcher: pinnedDispatcher,
    })) as typeof globalThis.fetch,
  };
  const fetchOnce = operation === 'TEXT_TO_IMAGE'
    ? createAiImageSandboxFetchGuard({
      contract: {
        endpoint: operationEndpoint,
        model,
        promptSha256: requestContract.promptSha256,
        size: outputSize,
        n: 1,
      },
      ...guardedTransport,
    })
    : createAiImageSandboxEditFetchGuard({
      contract: {
        endpoint: operationEndpoint,
        operation,
        model,
        promptSha256: requestContract.promptSha256,
        size: outputSize,
        n: 1,
        sourceSha256: requestContract.sourceSha256,
        maskSha256: requestContract.maskSha256,
      },
      ...guardedTransport,
    });

  const reportPath = resolve(outputDirectory, `${operationId}.report.json`);
  const reportCosts = claim.intent.schemaVersion === 3
    ? {
        actualCost: null,
        quotedCost: claim.intent.quotedCost,
        maximumCost: claim.intent.maximumCost,
      }
    : {
        actualCostCents: null,
        quotedCostCents: claim.intent.quotedCostCents,
        maximumCostCents: claim.intent.maximumCostCents,
      };
  let reportWritten = false;
  let result;
  try {
    assertAiImageSandboxApprovalCurrent(approvalEvidence, currentTime(options));
    if (operation === 'TEXT_TO_IMAGE') {
      const provider = createOpenAiImagesProvider({
        baseUrl, apiKey, model, fetch: fetchOnce.fetch, timeoutMs: 180_000, costPerImageCents: 0,
      });
      result = await provider.generate({
        operation,
        prompt,
        negativePrompt: null,
        count: 1,
        width: profile.width,
        height: profile.height,
        model,
      });
    } else {
      const provider = createOpenAiImageEditProvider({
        baseUrl, apiKey, model, fetch: fetchOnce.fetch, timeoutMs: 180_000, costPerImageCents: 0,
      });
      result = await provider.edit({
        operation,
        prompt,
        negativePrompt: null,
        width: profile.width,
        height: profile.height,
        model,
        images: [source!.image],
        mask: mask?.image || null,
      });
    }
  const createRequests = fetchOnce.getCreateRequests();
  if (createRequests !== 1) throw new Error(`Expected exactly one create request, received ${createRequests}`);
  if (result.images.length !== 1) throw new Error(`Expected exactly one image, received ${result.images.length}`);

  const image = result.images[0]!;
  const inspectedOutput = await inspectProviderOutput(image, profile);
  const extension = inspectedOutput.mimeType === 'image/jpeg' ? 'jpg'
    : inspectedOutput.mimeType === 'image/webp' ? 'webp' : 'png';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const imagePath = resolve(outputDirectory, `${stamp}.${extension}`);
  await writePrivateFile(imagePath, image.buffer);

  const completedAtMs = Math.max(Date.now(), startedAtMs);
  const report = {
    schemaVersion: claim.intent.schemaVersion === 3 ? 5 : 4,
    operationId,
    state: 'SUCCEEDED',
    operation,
    requestProfile,
    credentialRevision,
    adapterRevision,
    provider: 'custom-openai-compatible',
    model,
    apiBaseSha256,
    operationEndpointSha256,
    approvalEvidence,
    promptSha256: requestContract.promptSha256,
    sourceSha256: requestContract.sourceSha256,
    maskSha256: requestContract.maskSha256,
    requestedSize: outputSize,
    createRequests,
    imageCount: 1,
    mimeType: inspectedOutput.mimeType,
    width: inspectedOutput.width,
    height: inspectedOutput.height,
    bytes: image.buffer.byteLength,
    sha256: sha256(image.buffer),
    providerRequestIdHash: result.providerJobId
      ? sha256(result.providerJobId)
      : null,
    usage: null,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    elapsedMs: completedAtMs - startedAtMs,
    ...reportCosts,
    intentPath: claim.intentPath,
    imagePath,
  };
  await atomicWritePrivateJson(reportPath, report);
  reportWritten = true;
  process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
  return report;
  } catch (error) {
    if (!reportWritten) {
      const createRequests = fetchOnce.getCreateRequests();
      const evidence = fetchOnce.getEvidence();
      const acceptedRequestIdHash = result?.providerJobId
        ? sha256(result.providerJobId)
        : evidence.providerRequestIdHash;
      const completedAtMs = Math.max(Date.now(), startedAtMs);
      const report = {
        schemaVersion: claim.intent.schemaVersion === 3 ? 5 : 4,
        operationId,
        state: createRequests === 0
          ? 'PRE_DISPATCH_FAILED'
          : evidence.state === 'REJECTED'
            ? 'REJECTED'
            : 'RECONCILIATION_REQUIRED',
        provider: 'custom-openai-compatible',
        model,
        operation,
        requestProfile,
        apiBaseSha256,
        operationEndpointSha256,
        approvalEvidence,
        credentialRevision,
        adapterRevision,
        promptSha256: requestContract.promptSha256,
        sourceSha256: requestContract.sourceSha256,
        maskSha256: requestContract.maskSha256,
        requestedSize: outputSize,
        createRequests,
        providerRequestIdHash: failureRequestIdHash(error, acceptedRequestIdHash),
        usage: null,
        failureCode: safeFailureCode(error),
        startedAt,
        completedAt: new Date(completedAtMs).toISOString(),
        ...reportCosts,
        elapsedMs: completedAtMs - startedAtMs,
        intentPath: claim.intentPath,
      };
      await atomicWritePrivateJson(reportPath, report);
      if (isProviderHttpFailureStatus(evidence.providerHttpStatus)) {
        const diagnostic = {
          schemaVersion: 1,
          operationId,
          submitReportSha256: sha256(`${JSON.stringify(report, null, 2)}\n`),
          providerHttpStatus: evidence.providerHttpStatus,
        };
        try {
          await writePrivateFile(
            resolve(outputDirectory, `${operationId}.failure-diagnostic.json`),
            `${JSON.stringify(diagnostic, null, 2)}\n`,
          );
        } catch {
          try {
            process.stderr.write(`${JSON.stringify({
              schemaVersion: 1,
              event: 'SANDBOX_FAILURE_DIAGNOSTIC_WRITE_FAILED',
              operationId,
            })}\n`);
          } catch {
            // Preserve the authoritative Provider failure even when diagnostics cannot be emitted.
          }
        }
      }
    }
    throw error;
  } finally {
    await pinnedDispatcher.close();
  }
}

const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  const directEnvironment = process.argv.slice(2).includes('--verify-approval')
    ? { ...process.env, AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL' }
    : process.env;
  runAiImageProviderSingleSubmit({
    environment: directEnvironment,
    requireGitCheckout: true,
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      event: 'SANDBOX_COMMAND_FAILED',
      failureCode: safeFailureCode(error),
    })}\n`);
    process.stderr.write('AI image sandbox failed.\n');
    process.exitCode = 1;
  });
}
