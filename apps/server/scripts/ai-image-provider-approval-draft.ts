import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { isIP } from 'node:net';
import {
  lstat,
  open,
  realpath,
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AiImageSandboxMediaError,
  assertAiImageSandboxEditMediaLimit,
  assertMeaningfulAiImageSandboxMask,
  loadPinnedAiImageSandboxMedia,
  remainingAiImageSandboxEditMediaBytes,
} from '../src/services/ai-image-sandbox-media.js';
import { normalizeOpenAiImagesApiBase } from '../src/services/ai-image-openai-url.js';
import {
  AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
  isAiImagePackyEditProviderIdentity,
} from '../src/services/ai-image-packy-edit-profile.js';
import {
  AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE,
  AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
  isAiImageXiaoyiEditOperation,
  isAiImageXiaoyiEditProviderIdentity,
  isAiImageXiaoyiEditRequestProfile,
} from '../src/services/ai-image-xiaoyi-provider.js';
import {
  AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE,
  AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE,
  AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE,
  AI_IMAGE_WANX21_EDIT_PROFILE,
  aiImageWanx21EditOperationForRequestProfile,
  aiImageWanx21EditSubmitEndpoint,
  isAiImageWanx21EditApiIdentity,
  isAiImageWanx21EditEndpointIdentity,
  isAiImageWanx21EditRequestProfile,
  normalizeAiImageWanx21EditApiBase,
  assertAiImageWanx21EditMedia,
} from '../src/services/ai-image-wanx-edit-profile.js';
import {
  AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN,
  resolveAiImageSandboxRepositoryRevision,
} from '../src/services/ai-image-sandbox-code-revision.js';
import {
  AI_IMAGE_SANDBOX_MAX_COST_CENTS,
  AI_IMAGE_SANDBOX_MAX_COST_MAJOR_UNITS,
  AiImageSandboxMoneyError,
  type AiImageSandboxMoney,
  assertAiImageSandboxMoneyMajorUnitLimit,
  assertAiImageSandboxMoneyPair,
  parseAiImageSandboxMoneyIntegers,
} from '../src/services/ai-image-sandbox-money.js';

export const AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT =
  'DRAFT_REVIEW_REQUIRED_NOT_APPROVED';
export const AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP = 'REPLACE_DURING_REVIEW';

const OPERATIONS = new Set<AiImageSandboxApprovalDraftOperation>([
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
]);
const REQUEST_PROFILES = new Set([
  'OPENAI_SQUARE_SINGLE_V1',
  'OZON_PORTRAIT_SINGLE_V1',
  AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
  AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE,
  AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
  AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE,
  AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE,
  AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE,
]);
const UNSAFE_ENVIRONMENT_NAMES = new Set([
  'AI_IMAGE_SANDBOX_API_KEY',
  'AI_IMAGE_SANDBOX_CONFIRM',
  'AI_IMAGE_SANDBOX_APPROVAL_PATH',
  'AI_IMAGE_SANDBOX_APPROVAL_SHA256',
  'AI_IMAGE_TRANSLATION_SANDBOX_API_KEY',
  'AUTHORIZATION',
  'OPENAI_API_KEY',
  'PACKY_API_KEY',
  'PACKY_TOKEN',
  'XIAOYI_API_KEY',
  'XIAOYI_TOKEN',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
  'ALIYUN_ACCESS_KEY_SECRET',
]);
const APPROVAL_DRAFT_TRACKED_PATHS = [
  'apps/server/scripts/ai-image-provider-approval-draft.ts',
  'apps/server/src/services/ai-image-sandbox-approval.ts',
  'apps/server/src/services/ai-image-sandbox-code-revision.ts',
  'apps/server/src/services/ai-image-sandbox-money.ts',
  'apps/server/src/services/ai-image-job-error.ts',
  'apps/server/src/services/ai-image-openai-url.ts',
  'apps/server/src/services/ai-image-packy-edit-profile.ts',
  'apps/server/src/services/ai-image-xiaoyi-provider.ts',
  'apps/server/src/services/ai-image-wanx-edit-profile.ts',
  'apps/server/src/services/ai-image-sandbox-media.ts',
  'packages/shared/src/ai-image-workbench-contract.ts',
];

type AiImageSandboxApprovalDraftOperation =
  | 'TEXT_TO_IMAGE'
  | 'IMAGE_TO_IMAGE'
  | 'FULL_EDIT'
  | 'INPAINT';

interface AiImageSandboxApprovalDraftBase {
  approvalId: string;
  statement: typeof AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT;
  approvedAt: typeof AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP;
  expiresAt: typeof AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP;
  approverRef: string;
  providerAccountRef: string;
  pricingRevision: string;
  preCallBillingSnapshotRef: string;
  billingReconciliationRef: string;
  requestCount: 1;
  operationId: string;
  endpoint: string;
  expectedHost: string;
  model: string;
  operation: AiImageSandboxApprovalDraftOperation;
  requestProfile: string;
  credentialRevision: string;
  adapterRevision: string;
  sourceSha256: string[];
  maskSha256: string | null;
}

export interface AiImageSandboxApprovalDraftV2 extends AiImageSandboxApprovalDraftBase {
  schemaVersion: 2;
  currency: string;
  quotedCostCents: number;
  maximumCostCents: number;
}

export interface AiImageSandboxApprovalDraftV3 extends AiImageSandboxApprovalDraftBase {
  schemaVersion: 3;
  quotedCost: AiImageSandboxMoney;
  maximumCost: AiImageSandboxMoney;
}

export type AiImageSandboxApprovalDraft =
  | AiImageSandboxApprovalDraftV2
  | AiImageSandboxApprovalDraftV3;

export interface AiImageProviderApprovalDraftOptions {
  environment?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
  resolveRevision?: typeof resolveAiImageSandboxRepositoryRevision;
  requireGitCheckout?: boolean;
  beforeDraftWrite?: () => Promise<void>;
}

function draftError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  const value = String(environment[name] || '').trim();
  if (!value) {
    throw draftError('SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID', `${name} is required`);
  }
  return value;
}

function requiredBoundedText(
  name: string,
  environment: NodeJS.ProcessEnv,
  maximumLength: number,
) {
  const value = requiredEnvironment(name, environment);
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (value.length > maximumLength || hasControlCharacter) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      `${name} is invalid`,
    );
  }
  return value;
}

function optionalEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  return String(environment[name] || '').trim();
}

function requiredSha256(name: string, environment: NodeJS.ProcessEnv) {
  const value = requiredEnvironment(name, environment).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      `${name} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
}

function requiredCost(name: string, environment: NodeJS.ProcessEnv) {
  const raw = requiredEnvironment(name, environment);
  if (!/^[1-9][0-9]{0,7}$/u.test(raw)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      `${name} must be a canonical positive integer`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > AI_IMAGE_SANDBOX_MAX_COST_CENTS) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      `${name} exceeds the sandbox evidence bound`,
    );
  }
  return value;
}

function hasEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  return Boolean(String(environment[name] || '').trim());
}

function exactDraftCosts(environment: NodeJS.ProcessEnv) {
  const exactNames = [
    'AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT',
    'AI_IMAGE_SANDBOX_MAX_COST_AMOUNT',
    'AI_IMAGE_SANDBOX_COST_SCALE',
  ];
  const legacyNames = [
    'AI_IMAGE_SANDBOX_QUOTED_COST_CENTS',
    'AI_IMAGE_SANDBOX_MAX_COST_CENTS',
  ];
  const hasExact = exactNames.some((name) => hasEnvironment(name, environment));
  const hasLegacy = legacyNames.some((name) => hasEnvironment(name, environment));
  if (!hasExact) return null;
  if (hasLegacy) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'Exact and legacy sandbox cost environment variables must not be mixed',
    );
  }
  try {
    const currency = requiredEnvironment('AI_IMAGE_SANDBOX_CURRENCY', environment);
    const scale = requiredEnvironment('AI_IMAGE_SANDBOX_COST_SCALE', environment);
    const quotedCost = parseAiImageSandboxMoneyIntegers({
      currency,
      amount: requiredEnvironment('AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT', environment),
      scale,
      field: 'Sandbox quoted cost',
    });
    const maximumCost = parseAiImageSandboxMoneyIntegers({
      currency,
      amount: requiredEnvironment('AI_IMAGE_SANDBOX_MAX_COST_AMOUNT', environment),
      scale,
      field: 'Sandbox maximum cost',
    });
    assertAiImageSandboxMoneyPair(quotedCost, maximumCost);
    assertAiImageSandboxMoneyMajorUnitLimit(
      maximumCost,
      AI_IMAGE_SANDBOX_MAX_COST_MAJOR_UNITS,
    );
    return { quotedCost, maximumCost };
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw draftError('SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID', error.message);
    }
    throw error;
  }
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function assertUnsafeEnvironmentAbsent(environment: NodeJS.ProcessEnv) {
  const unsafe = Object.entries(environment).some(([name, value]) => (
    UNSAFE_ENVIRONMENT_NAMES.has(name.toUpperCase()) && String(value || '').trim()
  ));
  if (unsafe) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_UNSAFE_ENV',
      'Approval draft generation must not receive secrets, paid confirmation, or an existing approval',
    );
  }
}

function isDnsHostname(value: string) {
  if (
    !value
    || value.length > 253
    || value.endsWith('.')
    || value === 'localhost'
    || value.endsWith('.localhost')
    || isIP(value) !== 0
  ) return false;
  const labels = value.split('.');
  return labels.length >= 2 && labels.every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
  ));
}

function canonicalEndpoint(input: {
  baseUrl: string;
  expectedHost: string;
  operation: AiImageSandboxApprovalDraftOperation;
  requestProfile: string;
}) {
  let apiBase: string;
  try {
    apiBase = isAiImageWanx21EditRequestProfile(input.requestProfile)
      ? normalizeAiImageWanx21EditApiBase(input.baseUrl)
      : normalizeOpenAiImagesApiBase(input.baseUrl);
  } catch {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'AI_IMAGE_SANDBOX_BASE_URL is invalid for the selected request profile',
    );
  }
  const parsed = new URL(apiBase);
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !isDnsHostname(hostname)
  ) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'AI_IMAGE_SANDBOX_BASE_URL must use a credential-free HTTPS DNS hostname',
    );
  }
  if (hostname !== input.expectedHost.toLowerCase() || !isDnsHostname(input.expectedHost.toLowerCase())) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'AI_IMAGE_SANDBOX_EXPECTED_HOST does not match the configured base URL',
    );
  }
  return isAiImageWanx21EditRequestProfile(input.requestProfile)
    ? aiImageWanx21EditSubmitEndpoint(apiBase)
    : new URL(
        `${apiBase}/images/${input.operation === 'TEXT_TO_IMAGE' ? 'generations' : 'edits'}`,
      ).toString();
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
  try {
    return await loadPinnedAiImageSandboxMedia({
      path,
      expectedSha256,
      label: input.pathEnvironment,
      requirePng: input.requirePng,
      maximumBytes: input.maximumBytes,
    });
  } catch (error) {
    if (error instanceof AiImageSandboxMediaError) {
      throw draftError('SANDBOX_APPROVAL_DRAFT_MEDIA_INVALID', error.message);
    }
    throw error;
  }
}

async function assertMeaningfulMask(
  mask: Awaited<ReturnType<typeof loadPinnedImage>>,
) {
  try {
    await assertMeaningfulAiImageSandboxMask(mask);
  } catch (error) {
    if (error instanceof AiImageSandboxMediaError) {
      throw draftError('SANDBOX_APPROVAL_DRAFT_MEDIA_INVALID', error.message);
    }
    throw error;
  }
}

async function resolveMediaBindings(input: {
  operation: AiImageSandboxApprovalDraftOperation;
  environment: NodeJS.ProcessEnv;
  repositoryRoot: string;
  wanx?: boolean;
}) {
  const sourcePath = optionalEnvironment('AI_IMAGE_SANDBOX_SOURCE_PATH', input.environment);
  const sourceSha256 = optionalEnvironment('AI_IMAGE_SANDBOX_SOURCE_SHA256', input.environment);
  const maskPath = optionalEnvironment('AI_IMAGE_SANDBOX_MASK_PATH', input.environment);
  const maskSha256 = optionalEnvironment('AI_IMAGE_SANDBOX_MASK_SHA256', input.environment);
  if (input.operation === 'TEXT_TO_IMAGE') {
    if (sourcePath || sourceSha256 || maskPath || maskSha256) {
      throw draftError(
        'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
        'TEXT_TO_IMAGE must not configure source or mask media',
      );
    }
    return { sourceSha256: [], maskSha256: null };
  }
  if (!sourcePath || !sourceSha256) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      `${input.operation} requires a pinned source image`,
    );
  }
  const source = await loadPinnedImage({
    pathEnvironment: 'AI_IMAGE_SANDBOX_SOURCE_PATH',
    shaEnvironment: 'AI_IMAGE_SANDBOX_SOURCE_SHA256',
    environment: input.environment,
    repositoryRoot: input.repositoryRoot,
    maximumBytes: input.wanx ? AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes : undefined,
  });
  if (input.operation !== 'INPAINT') {
    if (maskPath || maskSha256) {
      throw draftError(
        'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
        `${input.operation} must not configure a mask`,
      );
    }
    if (input.wanx) {
      try {
        assertAiImageWanx21EditMedia({ source });
      } catch (error) {
        throw draftError(
          'SANDBOX_APPROVAL_DRAFT_MEDIA_INVALID',
          error instanceof Error ? error.message : 'Wanx source media is invalid',
        );
      }
    }
    return { sourceSha256: [source.sha256], maskSha256: null };
  }
  if (!maskPath || !maskSha256) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'INPAINT requires a pinned PNG mask',
    );
  }
  const mask = await loadPinnedImage({
    pathEnvironment: 'AI_IMAGE_SANDBOX_MASK_PATH',
    shaEnvironment: 'AI_IMAGE_SANDBOX_MASK_SHA256',
    requirePng: true,
    maximumBytes: Math.min(
      remainingAiImageSandboxEditMediaBytes([source]),
      input.wanx
        ? AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes
        : Number.MAX_SAFE_INTEGER,
    ),
    environment: input.environment,
    repositoryRoot: input.repositoryRoot,
  });
  try {
    assertAiImageSandboxEditMediaLimit([source, mask]);
  } catch (error) {
    if (error instanceof AiImageSandboxMediaError) {
      throw draftError('SANDBOX_APPROVAL_DRAFT_MEDIA_INVALID', error.message);
    }
    throw error;
  }
  await assertMeaningfulMask(mask);
  if (mask.width !== source.width || mask.height !== source.height) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_MEDIA_INVALID',
      'The INPAINT mask dimensions must match the source image',
    );
  }
  if (input.wanx) {
    try {
      assertAiImageWanx21EditMedia({ source, mask });
    } catch (error) {
      throw draftError(
        'SANDBOX_APPROVAL_DRAFT_MEDIA_INVALID',
        error instanceof Error ? error.message : 'Wanx edit media is invalid',
      );
    }
  }
  return { sourceSha256: [source.sha256], maskSha256: mask.sha256 };
}

interface PrivateDraftDirectory {
  path: string;
  canonicalPath: string;
  device: bigint;
  inode: bigint;
  handle: Awaited<ReturnType<typeof open>>;
}

function samePath(left: string, right: string) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function hasStableFileIdentity(device: bigint, inode: bigint) {
  return device > 0n && inode > 0n;
}

function sameFileIdentity(
  left: { device: bigint; inode: bigint },
  right: { device: bigint; inode: bigint },
) {
  return left.device === right.device && left.inode === right.inode;
}

function assertPrivateDirectoryMetadata(metadata: BigIntStats, message: string) {
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || !hasStableFileIdentity(metadata.dev, metadata.ino)
    || (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n)
    || (
      process.platform !== 'win32'
      && typeof process.getuid === 'function'
      && metadata.uid !== BigInt(process.getuid())
    )
  ) {
    throw draftError('SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE', message);
  }
}

async function openPrivateDraftDirectory(path: string): Promise<PrivateDraftDirectory> {
  const resolvedPath = resolve(path);
  let canonicalPath: string;
  let pathMetadata: BigIntStats;
  try {
    canonicalPath = await realpath(resolvedPath);
    pathMetadata = await lstat(resolvedPath, { bigint: true });
  } catch {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
      'The approval draft parent must already exist as a private directory',
    );
  }
  if (!samePath(resolvedPath, canonicalPath)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
      'The approval draft parent must not use linked path components',
    );
  }
  assertPrivateDirectoryMetadata(
    pathMetadata,
    'The approval draft parent must be a private current-user directory',
  );
  const flags = constants.O_RDONLY
    | (process.platform === 'win32' ? 0 : (constants.O_DIRECTORY || 0) | constants.O_NOFOLLOW);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(canonicalPath, flags);
  } catch {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
      'The approval draft parent could not be opened safely',
    );
  }
  try {
    const handleMetadata = await handle.stat({ bigint: true });
    assertPrivateDirectoryMetadata(
      handleMetadata,
      'The approval draft parent changed while it was opened',
    );
    const directory = {
      path: resolvedPath,
      canonicalPath,
      device: pathMetadata.dev,
      inode: pathMetadata.ino,
      handle,
    };
    if (!sameFileIdentity(directory, {
      device: handleMetadata.dev,
      inode: handleMetadata.ino,
    })) {
      throw draftError(
        'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
        'The approval draft parent changed while it was opened',
      );
    }
    return directory;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertPrivateDraftDirectoryStable(directory: PrivateDraftDirectory) {
  let canonicalPath: string;
  let pathMetadata: BigIntStats;
  try {
    canonicalPath = await realpath(directory.path);
    pathMetadata = await lstat(directory.path, { bigint: true });
  } catch {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
      'The approval draft parent disappeared while the draft was written',
    );
  }
  const handleMetadata = await directory.handle.stat({ bigint: true });
  assertPrivateDirectoryMetadata(
    pathMetadata,
    'The approval draft parent changed while the draft was written',
  );
  assertPrivateDirectoryMetadata(
    handleMetadata,
    'The approval draft parent handle changed while the draft was written',
  );
  if (
    !samePath(canonicalPath, directory.canonicalPath)
    || !sameFileIdentity(directory, { device: pathMetadata.dev, inode: pathMetadata.ino })
    || !sameFileIdentity(directory, { device: handleMetadata.dev, inode: handleMetadata.ino })
  ) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
      'The approval draft parent changed while the draft was written',
    );
  }
}

function privateDraftEntryPath(directory: PrivateDraftDirectory, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(name)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
      'The approval draft filename is invalid',
    );
  }
  return process.platform === 'linux'
    ? `/proc/self/fd/${directory.handle.fd}/${name}`
    : resolve(directory.canonicalPath, name);
}

async function syncPrivateDraftDirectory(directory: PrivateDraftDirectory) {
  try {
    await directory.handle.sync();
  } catch (error: any) {
    if (
      process.platform === 'win32'
      && ['EACCES', 'EINVAL', 'EISDIR', 'ENOSYS', 'EPERM'].includes(String(error?.code))
    ) return;
    throw error;
  }
}

async function writeExclusivePrivateDraft(
  path: string,
  bytes: Buffer,
  beforeDraftWrite?: () => Promise<void>,
) {
  const parent = dirname(path);
  const name = basename(path);
  if (parent === path) {
    throw draftError('SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE', 'Approval draft path is invalid');
  }
  const directory = await openPrivateDraftDirectory(parent);
  const entryPath = privateDraftEntryPath(directory, name);
  try {
    try {
      await lstat(entryPath);
      throw draftError(
        'SANDBOX_APPROVAL_DRAFT_CONFLICT',
        'An operator-owned approval draft already exists',
      );
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await beforeDraftWrite?.();
    const flags = constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
      | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
    let handle: Awaited<ReturnType<typeof open>>;
    let writtenMetadata: BigIntStats | null = null;
    try {
      handle = await open(entryPath, flags, 0o600);
    } catch (error: any) {
      if (error?.code === 'EEXIST') {
        throw draftError(
          'SANDBOX_APPROVAL_DRAFT_CONFLICT',
          'An operator-owned approval draft already exists',
        );
      }
      throw error;
    }
    try {
      await handle.writeFile(bytes);
      if (process.platform !== 'win32') await handle.chmod(0o600);
      await handle.sync();
      const metadata = await handle.stat({ bigint: true });
      if (
        !metadata.isFile()
        || metadata.size !== BigInt(bytes.byteLength)
        || (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n)
      ) {
        throw draftError(
          'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
          'The approval draft was not persisted as one private regular file',
        );
      }
      writtenMetadata = metadata;
      const persisted = Buffer.allocUnsafe(bytes.byteLength);
      let bytesRead = 0;
      while (bytesRead < persisted.byteLength) {
        const result = await handle.read(
          persisted,
          bytesRead,
          persisted.byteLength - bytesRead,
          bytesRead,
        );
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead !== bytes.byteLength || sha256(persisted) !== sha256(bytes)) {
        throw draftError(
          'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
          'The persisted approval draft does not match its canonical bytes',
        );
      }
    } finally {
      await handle.close();
    }
    const leafAfter = await lstat(entryPath, { bigint: true });
    if (
      !writtenMetadata
      || !leafAfter.isFile()
      || leafAfter.isSymbolicLink()
      || !sameFileIdentity(
        { device: writtenMetadata.dev, inode: writtenMetadata.ino },
        { device: leafAfter.dev, inode: leafAfter.ino },
      )
      || (process.platform !== 'win32' && (leafAfter.mode & 0o077n) !== 0n)
    ) {
      throw draftError(
        'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE',
        'The approval draft path changed after its private write',
      );
    }
    await syncPrivateDraftDirectory(directory);
    await assertPrivateDraftDirectoryStable(directory);
  } finally {
    await directory.handle.close();
  }
}

function safeFailureCode(error: unknown) {
  const value = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return value.toUpperCase().replace(/[^A-Z0-9_.-]/gu, '').slice(0, 80)
    || 'SANDBOX_APPROVAL_DRAFT_FAILED';
}

export async function runAiImageProviderApprovalDraft(
  options: AiImageProviderApprovalDraftOptions = {},
) {
  const environment = options.environment || process.env;
  if (environment.NODE_ENV !== 'sandbox') {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'NODE_ENV must equal sandbox for approval draft generation',
    );
  }
  assertUnsafeEnvironmentAbsent(environment);
  const repositoryRoot = options.repositoryRoot
    || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const draftPath = resolve(
    repositoryRoot,
    requiredEnvironment('AI_IMAGE_SANDBOX_APPROVAL_DRAFT_PATH', environment),
  );
  const approvalId = requiredBoundedText(
    'AI_IMAGE_SANDBOX_APPROVAL_ID',
    environment,
    80,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u.test(approvalId)) {
    throw draftError('SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID', 'Approval ID is invalid');
  }
  const operationId = requiredBoundedText(
    'AI_IMAGE_SANDBOX_OPERATION_ID',
    environment,
    80,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u.test(operationId)) {
    throw draftError('SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID', 'Operation ID is invalid');
  }
  const operationValue = requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION', environment);
  if (!OPERATIONS.has(operationValue as AiImageSandboxApprovalDraftOperation)) {
    throw draftError('SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID', 'Sandbox operation is unsupported');
  }
  const operation = operationValue as AiImageSandboxApprovalDraftOperation;
  const requestProfile = requiredEnvironment('AI_IMAGE_SANDBOX_REQUEST_PROFILE', environment);
  if (!REQUEST_PROFILES.has(requestProfile)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'Sandbox request profile is unsupported',
    );
  }
  const credentialRevision = requiredBoundedText(
    'AI_IMAGE_SANDBOX_CREDENTIAL_REVISION',
    environment,
    128,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(credentialRevision)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'Sandbox credential revision is invalid',
    );
  }
  const adapterRevision = requiredEnvironment(
    'AI_IMAGE_SANDBOX_ADAPTER_REVISION',
    environment,
  ).toLowerCase();
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(adapterRevision)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'Sandbox adapter revision must be a full Git object ID',
    );
  }
  const resolveRevision = options.resolveRevision || resolveAiImageSandboxRepositoryRevision;
  const repositoryRevision = (await resolveRevision(
    repositoryRoot,
    undefined,
    APPROVAL_DRAFT_TRACKED_PATHS,
    options.requireGitCheckout,
  )).toLowerCase();
  if (repositoryRevision !== adapterRevision) {
    throw draftError(
      'SANDBOX_ADAPTER_REVISION_MISMATCH',
      'Approval draft revision does not match the deployed code',
    );
  }
  const expectedHost = requiredBoundedText(
    'AI_IMAGE_SANDBOX_EXPECTED_HOST',
    environment,
    253,
  ).toLowerCase();
  const baseUrl = requiredBoundedText('AI_IMAGE_SANDBOX_BASE_URL', environment, 2048);
  let apiBase: string;
  try {
    apiBase = isAiImageWanx21EditRequestProfile(requestProfile)
      ? normalizeAiImageWanx21EditApiBase(baseUrl)
      : normalizeOpenAiImagesApiBase(baseUrl);
  } catch {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'AI_IMAGE_SANDBOX_BASE_URL is invalid for the selected request profile',
    );
  }
  const endpoint = canonicalEndpoint({
    baseUrl,
    expectedHost,
    operation,
    requestProfile,
  });
  const model = requiredBoundedText('AI_IMAGE_SANDBOX_MODEL', environment, 200);
  const packyProviderIdentity = isAiImagePackyEditProviderIdentity({
    apiBase,
    endpoint,
    expectedHost,
    model,
    operation,
  });
  const xiaoyiProviderIdentity = isAiImageXiaoyiEditProviderIdentity({
    apiBase,
    endpoint,
    expectedHost,
    model,
  });
  const wanxApiIdentity = isAiImageWanx21EditApiIdentity({
    apiBase,
    expectedHost,
    model,
  });
  if ((requestProfile === AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE) !== packyProviderIdentity) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'The Packy edit Provider identity and request profile must be selected together',
    );
  }
  if (isAiImageXiaoyiEditRequestProfile(requestProfile) !== xiaoyiProviderIdentity) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'The Xiaoyi edit Provider identity and request profile must be selected together',
    );
  }
  if (
    isAiImageXiaoyiEditRequestProfile(requestProfile)
    && !isAiImageXiaoyiEditOperation(operation)
  ) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'The Xiaoyi edit request profile permits only IMAGE_TO_IMAGE',
    );
  }
  if (isAiImageWanx21EditRequestProfile(requestProfile) !== wanxApiIdentity) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'The Wanx 2.1 edit Provider identity and request profile must be selected together',
    );
  }
  if (
    isAiImageWanx21EditRequestProfile(requestProfile)
    && !isAiImageWanx21EditEndpointIdentity({ apiBase, endpoint, expectedHost, model })
  ) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'The Wanx 2.1 edit request profile requires the exact async image-synthesis endpoint',
    );
  }
  if (
    isAiImageWanx21EditRequestProfile(requestProfile)
    && aiImageWanx21EditOperationForRequestProfile(requestProfile) !== operation
  ) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'The Wanx 2.1 edit request profile does not match the selected operation',
    );
  }
  const exactCosts = exactDraftCosts(environment);
  if (
    (requestProfile === AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE
      || isAiImageXiaoyiEditRequestProfile(requestProfile)
      || isAiImageWanx21EditRequestProfile(requestProfile))
    && !exactCosts
  ) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'Provider-specific edit profiles require exact-money evidence',
    );
  }
  const legacyCosts = exactCosts ? null : {
    quotedCostCents: requiredCost('AI_IMAGE_SANDBOX_QUOTED_COST_CENTS', environment),
    maximumCostCents: requiredCost('AI_IMAGE_SANDBOX_MAX_COST_CENTS', environment),
  };
  if (legacyCosts && legacyCosts.quotedCostCents > legacyCosts.maximumCostCents) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'Quoted sandbox cost exceeds the proposed maximum',
    );
  }
  const media = await resolveMediaBindings({
    operation,
    environment,
    repositoryRoot,
    wanx: isAiImageWanx21EditRequestProfile(requestProfile),
  });
  const currency = requiredBoundedText('AI_IMAGE_SANDBOX_CURRENCY', environment, 3);
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw draftError(
      'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID',
      'Sandbox currency must be an uppercase ISO-style code',
    );
  }
  const draftBase: AiImageSandboxApprovalDraftBase = {
    approvalId,
    statement: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT,
    approvedAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
    expiresAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
    approverRef: requiredBoundedText('AI_IMAGE_SANDBOX_APPROVER_REF', environment, 128),
    providerAccountRef: requiredBoundedText(
      'AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF',
      environment,
      160,
    ),
    pricingRevision: requiredBoundedText(
      'AI_IMAGE_SANDBOX_PRICING_REVISION',
      environment,
      160,
    ),
    preCallBillingSnapshotRef: requiredBoundedText(
      'AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF',
      environment,
      200,
    ),
    billingReconciliationRef: requiredBoundedText(
      'AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF',
      environment,
      200,
    ),
    requestCount: 1,
    operationId,
    endpoint,
    expectedHost,
    model,
    operation,
    requestProfile,
    credentialRevision,
    adapterRevision,
    sourceSha256: media.sourceSha256,
    maskSha256: media.maskSha256,
  };
  const draft: AiImageSandboxApprovalDraft = exactCosts
    ? {
        schemaVersion: 3,
        ...draftBase,
        quotedCost: exactCosts.quotedCost,
        maximumCost: exactCosts.maximumCost,
      }
    : {
        schemaVersion: 2,
        ...draftBase,
        currency,
        quotedCostCents: legacyCosts!.quotedCostCents,
        maximumCostCents: legacyCosts!.maximumCostCents,
      };
  const bytes = Buffer.from(`${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  const draftSha256 = sha256(bytes);
  await writeExclusivePrivateDraft(draftPath, bytes, options.beforeDraftWrite);
  const event = {
    schemaVersion: 1,
    event: 'AI_IMAGE_SANDBOX_APPROVAL_DRAFT_CREATED',
    operationId,
    operation,
    adapterRevision,
    draftSha256,
  };
  process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
  return { replayed: false, draft, draftSha256 };
}

const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const run = args.length === 0 ? () => runAiImageProviderApprovalDraft({ requireGitCheckout: true })
    : args.length === 1 && ['--prepare-wanx-trial', '--verify-wanx-trial', '--draft-wanx-trial-approval', '--compile-wanx-trial-input', '--import-wanx-template-sources'].includes(args[0]!)
      ? async () => {
          const { runAiImageWanxTrialCommand } = await import('./ai-image-wanx-trial-prepare.js');
          return runAiImageWanxTrialCommand(args[0] === '--prepare-wanx-trial' ? 'prepare'
            : args[0] === '--verify-wanx-trial' ? 'verify'
              : args[0] === '--compile-wanx-trial-input' ? 'compile-input'
                : args[0] === '--import-wanx-template-sources' ? 'import-sources' : 'approval-draft');
        }
      : async () => { throw draftError('SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID', 'Unsupported preparation command argument'); };
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      event: 'SANDBOX_APPROVAL_DRAFT_COMMAND_FAILED',
      failureCode: safeFailureCode(error),
    })}\n`);
    process.stderr.write('AI image sandbox approval draft generation failed.\n');
    process.exitCode = 1;
  });
}
