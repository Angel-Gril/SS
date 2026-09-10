import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
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
  createPackyGptImage2EditProvider,
  createXiaoyiGptImage2EditProvider,
  createXiaoyiGptImage2MinimalEditProvider,
  normalizeOpenAiImagesApiBase,
  validateAiImageProviderUrl,
} from '../src/services/ai-image-providers.js';
import {
  convertOpenAiAlphaMaskToWanxMask,
  createDashScopeWanx21ImageEditProvider,
} from '../src/services/ai-image-wanx-edit-provider.js';
import {
  AI_IMAGE_PACKY_EDIT_PROFILE,
  AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
  aiImageEditMultipartDialectForRequestProfile,
  isAiImagePackyEditProviderIdentity,
} from '../src/services/ai-image-packy-edit-profile.js';
import {
  AI_IMAGE_XIAOYI_EDIT_PROFILE,
  AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE,
  AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
  isAiImageXiaoyiEditOperation,
  isAiImageXiaoyiEditProviderIdentity,
  isAiImageXiaoyiEditRequestProfile,
} from '../src/services/ai-image-xiaoyi-provider.js';
import {
  AI_IMAGE_WANX21_EDIT_PROFILE,
  AI_IMAGE_WANX21_EDIT_TRANSPORT,
  AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE,
  AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE,
  AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE,
  aiImageWanx21EditFunction,
  aiImageWanx21EditOperationForRequestProfile,
  aiImageWanx21EditSubmitEndpoint,
  aiImageWanx21EditTaskEndpointBase,
  assertAiImageWanx21EditMedia,
  isAiImageWanx21EditApiIdentity,
  isAiImageWanx21EditEndpointIdentity,
  isAiImageWanx21EditRequestProfile,
  normalizeAiImageWanx21EditApiBase,
  normalizeAiImageWanx21EditResultUrl,
} from '../src/services/ai-image-wanx-edit-profile.js';
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
import { createAiImageWanx21EditSandboxFetchGuard } from
  '../src/services/ai-image-wanx-edit-sandbox-guard.js';
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
  'apps/server/src/services/ai-image-packy-edit-profile.ts',
  'apps/server/src/services/ai-image-xiaoyi-provider.ts',
  'apps/server/src/services/ai-image-wanx-edit-profile.ts',
  'apps/server/src/services/ai-image-wanx-edit-provider.ts',
  'apps/server/src/services/ai-image-wanx-edit-sandbox-guard.ts',
  'apps/server/src/services/ai-image-providers.ts',
  'apps/server/src/services/ai-image-sandbox-media.ts',
  'packages/shared/src/ai-image-workbench-contract.ts',
];
type AiImageSandboxOperation = 'TEXT_TO_IMAGE' | AiImageSandboxEditOperation;
type AiImageSandboxMode = 'SUBMIT' | 'VERIFY_APPROVAL' | 'TRIAL_SUBMIT' | 'TRIAL_VERIFY_APPROVAL';
const SANDBOX_MODES = new Set<AiImageSandboxMode>(['SUBMIT', 'VERIFY_APPROVAL', 'TRIAL_SUBMIT', 'TRIAL_VERIFY_APPROVAL']);
const REQUEST_PROFILES = Object.freeze({
  OPENAI_SQUARE_SINGLE_V1: Object.freeze({
    width: 1024,
    height: 1024,
    format: 'square',
    expectedMimeType: null,
  }),
  [AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE]: Object.freeze({
    width: AI_IMAGE_PACKY_EDIT_PROFILE.width,
    height: AI_IMAGE_PACKY_EDIT_PROFILE.height,
    format: 'square Packy GPT-Image-2 high-quality PNG',
    expectedMimeType: AI_IMAGE_PACKY_EDIT_PROFILE.expectedMimeType,
  }),
  [AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE]: Object.freeze({
    width: AI_IMAGE_XIAOYI_EDIT_PROFILE.width,
    height: AI_IMAGE_XIAOYI_EDIT_PROFILE.height,
    format: 'square Xiaoyi GPT-Image-2 documented edit',
    expectedMimeType: AI_IMAGE_XIAOYI_EDIT_PROFILE.expectedMimeType,
  }),
  [AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE]: Object.freeze({
    width: AI_IMAGE_XIAOYI_EDIT_PROFILE.width,
    height: AI_IMAGE_XIAOYI_EDIT_PROFILE.height,
    format: 'square Xiaoyi GPT-Image-2 documented edit',
    expectedMimeType: AI_IMAGE_XIAOYI_EDIT_PROFILE.expectedMimeType,
  }),
  [AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE]: Object.freeze({
    width: AI_IMAGE_WANX21_EDIT_PROFILE.width,
    height: AI_IMAGE_WANX21_EDIT_PROFILE.height,
    format: 'square Wanx 2.1 reference edit',
    expectedMimeType: AI_IMAGE_WANX21_EDIT_PROFILE.expectedMimeType,
  }),
  [AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE]: Object.freeze({
    width: AI_IMAGE_WANX21_EDIT_PROFILE.width,
    height: AI_IMAGE_WANX21_EDIT_PROFILE.height,
    format: 'square Wanx 2.1 full-image edit',
    expectedMimeType: AI_IMAGE_WANX21_EDIT_PROFILE.expectedMimeType,
  }),
  [AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE]: Object.freeze({
    width: AI_IMAGE_WANX21_EDIT_PROFILE.width,
    height: AI_IMAGE_WANX21_EDIT_PROFILE.height,
    format: 'square Wanx 2.1 masked inpaint',
    expectedMimeType: AI_IMAGE_WANX21_EDIT_PROFILE.expectedMimeType,
  }),
  OZON_PORTRAIT_SINGLE_V1: Object.freeze({
    width: 1024,
    height: 1536,
    format: 'vertical 2:3 Provider canvas; compose crop-safe for final 3:4 normalization',
    expectedMimeType: null,
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
  expected: { width: number; height: number; expectedMimeType: string | null },
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
    || (expected.expectedMimeType !== null && mimeType !== expected.expectedMimeType)
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
  let environment = options.environment || process.env;
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
  const isTrial = modeValue === 'TRIAL_SUBMIT' || modeValue === 'TRIAL_VERIFY_APPROVAL';
  const mode = modeValue === 'VERIFY_APPROVAL' || modeValue === 'TRIAL_VERIFY_APPROVAL' ? 'VERIFY_APPROVAL' : 'SUBMIT';
  if (!isTrial && ['AI_IMAGE_SANDBOX_TRIAL_ROUND_ID', 'AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256'].some((name) => optionalEnvironment(name, environment))) {
    throw Object.assign(new Error('Trial bindings require an explicit trial mode'), { code: 'WANX_TRIAL_MODE_REQUIRED' });
  }
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

  const trialModule = isTrial ? await import('../src/services/ai-image-wanx-trial-execution.js') : null;
  let trial: Awaited<ReturnType<NonNullable<typeof trialModule>['loadAiImageWanxTrialExecution']>> | null = null;
  if (trialModule) {
    if (options.outputDirectory) throw Object.assign(new Error('Trial output must use its approved private evidence root'), { code: 'WANX_TRIAL_ROOT_OVERRIDE_FORBIDDEN' });
    const conflicting = [
      'AI_IMAGE_SANDBOX_BASE_URL', 'AI_IMAGE_SANDBOX_MODEL', 'AI_IMAGE_SANDBOX_OPERATION_ID',
      'AI_IMAGE_SANDBOX_EXPECTED_HOST', 'AI_IMAGE_SANDBOX_REQUEST_PROFILE',
      'AI_IMAGE_SANDBOX_SOURCE_PATH', 'AI_IMAGE_SANDBOX_SOURCE_SHA256', 'AI_IMAGE_SANDBOX_MASK_PATH', 'AI_IMAGE_SANDBOX_MASK_SHA256',
      'AI_IMAGE_SANDBOX_CURRENCY', 'AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT', 'AI_IMAGE_SANDBOX_MAX_COST_AMOUNT',
      'AI_IMAGE_SANDBOX_COST_SCALE', 'AI_IMAGE_SANDBOX_QUOTED_COST_CENTS', 'AI_IMAGE_SANDBOX_MAX_COST_CENTS',
    ];
    if (conflicting.some((name) => optionalEnvironment(name, environment))) {
      throw Object.assign(new Error('Trial request and costs must come from the frozen manifest'), { code: 'WANX_TRIAL_REQUEST_OVERRIDE_FORBIDDEN' });
    }
    const expected = {
      adapterRevision: requiredAdapterRevision(environment),
      roundId: requiredEnvironment('AI_IMAGE_SANDBOX_TRIAL_ROUND_ID', environment),
      providerAccountUidSha256: requiredSha256('AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256', environment),
      credentialRevision: requiredEnvironment('AI_IMAGE_SANDBOX_CREDENTIAL_REVISION', environment),
    };
    const assertRevision = async () => {
      const actual = await resolveAiImageSandboxRepositoryRevision(repositoryRoot, undefined,
        [...SINGLE_SUBMIT_TRACKED_PATHS, ...trialModule.AI_IMAGE_WANX_TRIAL_EXECUTION_TRACKED_PATHS], true);
      if (actual !== expected.adapterRevision) throw Object.assign(new Error('Trial execution code revision changed'), { code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    };
    await assertRevision();
    trial = await trialModule.loadAiImageWanxTrialExecution({
      repositoryRoot, evidenceRoot: requiredEnvironment('AI_IMAGE_SANDBOX_EVIDENCE_ROOT', environment),
      manifestSha256: requiredSha256('AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256', environment),
      operation: requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION', environment), expected, assertRevision,
    });
    const selected = trial.selected;
    environment = {
      ...environment,
      AI_IMAGE_SANDBOX_BASE_URL: trial.manifest.request.apiBase,
      AI_IMAGE_SANDBOX_MODEL: trial.manifest.request.model,
      AI_IMAGE_SANDBOX_OPERATION_ID: selected.operationId,
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: trial.binding.requestProfile,
      AI_IMAGE_SANDBOX_EXPECTED_HOST: new URL(trial.manifest.request.apiBase).hostname,
      AI_IMAGE_SANDBOX_SOURCE_PATH: trial.sourcePath, AI_IMAGE_SANDBOX_SOURCE_SHA256: selected.source.sha256,
      AI_IMAGE_SANDBOX_MASK_PATH: trial.maskPath || '', AI_IMAGE_SANDBOX_MASK_SHA256: selected.mask?.sha256 || '',
      AI_IMAGE_SANDBOX_CURRENCY: selected.quotedCost.currency,
      AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: String(selected.quotedCost.amount),
      AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: String(selected.maximumCost.amount),
      AI_IMAGE_SANDBOX_COST_SCALE: String(selected.quotedCost.scale),
    };
  }

  const baseUrl = requiredEnvironment('AI_IMAGE_SANDBOX_BASE_URL', environment);
  const model = requiredEnvironment('AI_IMAGE_SANDBOX_MODEL', environment);
  const operationId = requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION_ID', environment);
  const credentialRevision = requiredEnvironment('AI_IMAGE_SANDBOX_CREDENTIAL_REVISION', environment);
  const adapterRevision = requiredAdapterRevision(environment);
  const repositoryRevision = trial ? trial.manifest.request.adapterRevision : await resolveAiImageSandboxRepositoryRevision(
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
  const isPackyEditProfile = requestProfile === AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE;
  const isXiaoyiEditProfile = isAiImageXiaoyiEditRequestProfile(requestProfile);
  const isXiaoyiMinimalEditProfile = requestProfile
    === AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE;
  const isWanxEditProfile = isAiImageWanx21EditRequestProfile(requestProfile);
  let apiBase: string;
  if (isWanxEditProfile) {
    try {
      apiBase = normalizeAiImageWanx21EditApiBase(baseUrl);
    } catch {
      throw Object.assign(new Error('AI_IMAGE_SANDBOX_BASE_URL is invalid for the selected profile'), {
        code: 'SANDBOX_REQUEST_PROFILE_INVALID',
      });
    }
  } else {
    apiBase = normalizeOpenAiImagesApiBase(baseUrl);
  }
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
  const preliminaryEndpoint = isWanxEditProfile
    ? aiImageWanx21EditSubmitEndpoint(apiBase)
    : `${apiBase}/images/${operation === 'TEXT_TO_IMAGE' ? 'generations' : 'edits'}`;
  const packyProviderIdentity = isAiImagePackyEditProviderIdentity({
    apiBase,
    endpoint: preliminaryEndpoint,
    expectedHost,
    model,
    operation,
  });
  if (isPackyEditProfile !== packyProviderIdentity) {
    throw Object.assign(
      new Error('The Packy edit Provider identity and request profile must be selected together'),
      { code: 'SANDBOX_REQUEST_PROFILE_INVALID' },
    );
  }
  const xiaoyiProviderIdentity = isAiImageXiaoyiEditProviderIdentity({
    apiBase,
    endpoint: preliminaryEndpoint,
    expectedHost,
    model,
  });
  if (isXiaoyiEditProfile !== xiaoyiProviderIdentity) {
    throw Object.assign(
      new Error('The Xiaoyi edit Provider identity and request profile must be selected together'),
      { code: 'SANDBOX_REQUEST_PROFILE_INVALID' },
    );
  }
  if (isXiaoyiEditProfile && !isAiImageXiaoyiEditOperation(operation)) {
    throw Object.assign(
      new Error('The Xiaoyi edit request profile permits only IMAGE_TO_IMAGE'),
      { code: 'SANDBOX_REQUEST_PROFILE_INVALID' },
    );
  }
  const wanxApiIdentity = isAiImageWanx21EditApiIdentity({ apiBase, expectedHost, model });
  if (isWanxEditProfile !== wanxApiIdentity) {
    throw Object.assign(
      new Error('The Wanx 2.1 edit Provider identity and request profile must be selected together'),
      { code: 'SANDBOX_REQUEST_PROFILE_INVALID' },
    );
  }
  if (
    isWanxEditProfile
    && (
      aiImageWanx21EditOperationForRequestProfile(requestProfile) !== operation
      || !isAiImageWanx21EditEndpointIdentity({
        apiBase,
        endpoint: preliminaryEndpoint,
        expectedHost,
        model,
      })
    )
  ) {
    throw Object.assign(
      new Error('The Wanx 2.1 edit request profile does not match its operation'),
      { code: 'SANDBOX_REQUEST_PROFILE_INVALID' },
    );
  }
  const costs = sandboxCostConfiguration(environment);
  if ((isPackyEditProfile || isXiaoyiEditProfile || isWanxEditProfile) && costs.kind !== 'EXACT') {
    throw Object.assign(
      new Error('Provider-specific edit profiles require exact-money evidence'),
      { code: 'SANDBOX_COST_CONFIG_INVALID' },
    );
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
      maximumBytes: isWanxEditProfile
        ? AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes
        : undefined,
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
      maximumBytes: Math.min(
        remainingAiImageSandboxEditMediaBytes([source]),
        isWanxEditProfile
          ? AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes
          : Number.MAX_SAFE_INTEGER,
      ),
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
  if (isWanxEditProfile && source) {
    assertAiImageWanx21EditMedia({ source, mask });
  }
  const operationEndpoint = new URL(preliminaryEndpoint).toString();
  const apiBaseSha256 = sha256(apiBase);
  const operationEndpointSha256 = sha256(operationEndpoint);
  const prompt = trial ? trial.selected.frozenPrompt.resolvedPrompt : fixedPrompt(operation, profile);
  const sourceSha256 = source ? [source.sha256] : [];
  const maskSha256 = mask?.sha256 || null;
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
      ...(trial ? { trialBinding: trial.trialBinding } : {}),
      ...(costs.kind === 'EXACT'
        ? { quotedCost: costs.quotedCost, maximumCost: costs.maximumCost }
        : {
            quotedCostCents: Number(costs.quotedCostCentsValue),
            maximumCostCents: Number(costs.maximumCostCentsValue),
          }),
    },
  });
  if (mode === 'VERIFY_APPROVAL') {
    await trial?.assertCurrent();
    assertAiImageSandboxApprovalCurrent(approvalEvidence, currentTime(options));
    const verification = {
      schemaVersion: trial ? 4 : costs.kind === 'EXACT' ? 3 : 2,
      event: 'AI_IMAGE_SANDBOX_APPROVAL_VERIFIED',
      operationId,
      operation,
      requestProfile,
      credentialRevision,
      adapterRevision,
      provider: isWanxEditProfile ? 'dashscope-wanx21-image-edit' : 'custom-openai-compatible',
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
      ...(trial ? { trialBinding: trial.trialBinding, executionScope: 'ISOLATED_WANX_TRIAL' } : {}),
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
  const outputDirectory = trial ? trial.evidenceRoot : options.outputDirectory || resolve(repositoryRoot, 'tmp/ai-image-sandbox');
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
  const wanxTransportMask = isWanxEditProfile && mask
    ? await convertOpenAiAlphaMaskToWanxMask(mask.image.buffer)
    : null;
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
  const trialClaim = trial && trialModule ? await trialModule.claimAiImageWanxTrialOperation({
    execution: trial, approval: approvalEvidence, requestFingerprint: claim.intent.requestFingerprint,
    now: () => currentTime(options),
  }) : null;
  const writeTrialEvidence = async (report: Record<string, unknown>) => trial && trialClaim && trialModule
    ? trialModule.writeAiImageWanxTrialExecutionEvidence({ execution: trial, claim: trialClaim, report })
    : null;
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
    beforeCreate: async () => {
      await trialClaim?.assertCurrent();
      assertAiImageSandboxApprovalCurrent(approvalEvidence, currentTime(options));
    },
    fetch: options.fetch || ((input, init) => undiciFetch(input as any, {
      ...(init as any),
      dispatcher: pinnedDispatcher,
    })) as typeof globalThis.fetch,
  };
  const wanxRecoveryPrefix = resolve(outputDirectory, `${operationId}.wanx`);
  const wanxProviderTaskPath = `${wanxRecoveryPrefix}.provider-task.json`;
  const persistWanxProviderTask = isWanxEditProfile
    ? async (providerTaskId: string) => {
      const payload = `${JSON.stringify({
        schemaVersion: 1,
        operationId,
        adapterRevision,
        operationEndpointSha256,
        providerTaskId,
      }, null, 2)}\n`;
      try {
        await writePrivateFile(wanxProviderTaskPath, payload);
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        let existing: any;
        try {
          existing = JSON.parse(await readFile(wanxProviderTaskPath, 'utf8'));
        } catch {
          throw error;
        }
        if (
          existing?.schemaVersion !== 1
          || existing.operationId !== operationId
          || existing.adapterRevision !== adapterRevision
          || existing.operationEndpointSha256 !== operationEndpointSha256
          || existing.providerTaskId !== providerTaskId
        ) {
          throw Object.assign(
            new Error('Wanx provider task recovery identity conflicts with an existing file'),
            { code: 'EEXIST' },
          );
        }
      }
    }
    : undefined;
  const wanxFetchGuard = isWanxEditProfile
    ? createAiImageWanx21EditSandboxFetchGuard({
        contract: {
          submitEndpoint: operationEndpoint,
          taskEndpointBase: aiImageWanx21EditTaskEndpointBase(apiBase),
          operation: operation as AiImageSandboxEditOperation,
          requestProfile,
          providerFunction: aiImageWanx21EditFunction(operation as AiImageSandboxEditOperation),
          model,
          promptSha256: requestContract.promptSha256,
          sourceSha256: requestContract.sourceSha256[0]!,
          transportMaskSha256: wanxTransportMask ? sha256(wanxTransportMask) : null,
          n: 1,
          maxPollRequests: AI_IMAGE_WANX21_EDIT_PROFILE.maximumPollRequests,
          maxPollDurationMs: AI_IMAGE_WANX21_EDIT_PROFILE.maximumPollDurationMs,
        },
        ...guardedTransport,
        toResultDownloadUrl: normalizeAiImageWanx21EditResultUrl,
        onProviderTaskId: persistWanxProviderTask,
        onRawResultUrl: async (rawResultUrl) => writePrivateFile(
          `${wanxRecoveryPrefix}.result-url.json`,
          `${JSON.stringify({
            schemaVersion: 1,
            operationId,
            adapterRevision,
            providerTaskIdFile: `${operationId}.wanx.provider-task.json`,
            rawResultUrl,
          }, null, 2)}\n`,
        ),
      })
    : null;
  const fetchOnce = wanxFetchGuard || (operation === 'TEXT_TO_IMAGE'
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
        multipartDialect: aiImageEditMultipartDialectForRequestProfile(requestProfile),
      },
      ...guardedTransport,
    }));

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
  const wanxAsyncEvidencePath = resolve(outputDirectory, `${operationId}.wanx.async-evidence.json`);
  let wanxAsyncEvidenceWritten = false;
  const writeWanxAsyncEvidence = async (providerOutcome: 'SUCCEEDED' | 'NOT_SUCCEEDED') => {
    if (!wanxFetchGuard || wanxAsyncEvidenceWritten) return;
    const evidence = wanxFetchGuard.getEvidence();
    await atomicWritePrivateJson(wanxAsyncEvidencePath, {
      schemaVersion: 1,
      operationId,
      provider: 'dashscope-wanx21-image-edit',
      model,
      operation,
      requestProfile,
      adapterRevision,
      requestFingerprint: claim.intent.requestFingerprint,
      apiBaseSha256,
      operationEndpointSha256,
      transport: AI_IMAGE_WANX21_EDIT_TRANSPORT,
      providerFunction: aiImageWanx21EditFunction(operation as AiImageSandboxEditOperation),
      sourceSha256: requestContract.sourceSha256,
      maskSha256: requestContract.maskSha256,
      transportMaskSha256: wanxTransportMask ? sha256(wanxTransportMask) : null,
      providerOutcome,
      state: evidence.state,
      createRequests: wanxFetchGuard.getCreateRequests(),
      pollRequests: wanxFetchGuard.getPollRequests(),
      resultDownloads: wanxFetchGuard.getResultDownloads(),
      providerTaskIdHash: evidence.providerTaskIdHash,
      providerRequestIdHashes: evidence.providerRequestIdHashes,
      providerStatus: evidence.providerStatus,
      usage: evidence.usage,
    });
    wanxAsyncEvidenceWritten = true;
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
      const createEditProvider = isWanxEditProfile
        ? createDashScopeWanx21ImageEditProvider
        : isPackyEditProfile
        ? createPackyGptImage2EditProvider
        : isXiaoyiMinimalEditProfile
          ? createXiaoyiGptImage2MinimalEditProvider
          : isXiaoyiEditProfile
          ? createXiaoyiGptImage2EditProvider
          : createOpenAiImageEditProvider;
      const provider = createEditProvider({
        baseUrl: apiBase,
        apiKey,
        model,
        fetch: fetchOnce.fetch,
        timeoutMs: 180_000,
        costPerImageCents: 0,
        onProviderJobCreated: persistWanxProviderTask,
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
  await writeWanxAsyncEvidence('SUCCEEDED');
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
    provider: isWanxEditProfile ? 'dashscope-wanx21-image-edit' : 'custom-openai-compatible',
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
  const trialEvidence = await writeTrialEvidence(report);
  process.stdout.write(`${JSON.stringify({ ...report, reportPath,
    ...(trialEvidence ? { executionScope: 'ISOLATED_WANX_TRIAL', trialEvidenceSha256: trialEvidence.sha256 } : {}),
  }, null, 2)}\n`);
  return report;
  } catch (error) {
    if (wanxFetchGuard && !wanxAsyncEvidenceWritten) {
      try {
        await writeWanxAsyncEvidence('NOT_SUCCEEDED');
      } catch {
        try {
          process.stderr.write(`${JSON.stringify({
            schemaVersion: 1,
            event: 'SANDBOX_WANX_ASYNC_EVIDENCE_WRITE_FAILED',
            operationId,
          })}\n`);
        } catch {
          // Preserve the authoritative Provider failure.
        }
      }
    }
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
        provider: isWanxEditProfile ? 'dashscope-wanx21-image-edit' : 'custom-openai-compatible',
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
      if (trial) {
        try { await writeTrialEvidence(report); }
        catch {
          process.stderr.write(`${JSON.stringify({ schemaVersion: 1, event: 'SANDBOX_WANX_TRIAL_EVIDENCE_WRITE_FAILED', operationId })}\n`);
        }
      }
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
  const runDirect = async () => {
    const args = process.argv.slice(2);
    const modes = {
      '--verify-approval': 'VERIFY_APPROVAL',
      '--submit-wanx-trial': 'TRIAL_SUBMIT',
      '--verify-wanx-trial-approval': 'TRIAL_VERIFY_APPROVAL',
    } as const;
    if (args.length > 1 || (args.length === 1 && !Object.hasOwn(modes, args[0]!))) {
      throw Object.assign(new Error('Select exactly one supported sandbox command mode'), { code: 'SANDBOX_MODE_INVALID' });
    }
    if (args.length === 1) process.env.AI_IMAGE_SANDBOX_MODE = modes[args[0] as keyof typeof modes];
    return runAiImageProviderSingleSubmit({ environment: process.env, requireGitCheckout: true });
  };
  runDirect().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      event: 'SANDBOX_COMMAND_FAILED',
      failureCode: safeFailureCode(error),
    })}\n`);
    process.stderr.write('AI image sandbox failed.\n');
    process.exitCode = 1;
  });
}
