import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN } from './ai-image-sandbox-code-revision.js';
import { createAiImageSandboxRequestFingerprint } from './ai-image-sandbox-guard.js';

export const AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT =
  'I_ATTEST_EXACT_PROVIDER_BILLING_SETTLEMENT';

const MAX_ATTESTATION_BYTES = 32 * 1024;
const MAX_INTENT_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 128 * 1024;
const MAX_CLAIM_BYTES = 16 * 1024;
const MAX_BILLING_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_CORRELATION_WINDOW_MS = 15 * 60 * 1000;
const MAX_PRECALL_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
const MAX_APPROVAL_WINDOW_MS = 60 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u;

const ATTESTATION_KEYS = new Set([
  'schemaVersion',
  'settlementId',
  'statement',
  'operationId',
  'preCallObservedAt',
  'settledObservedAt',
  'reconcilerRef',
  'providerAccountRef',
  'pricingRevision',
  'currency',
  'preCallBillingSnapshotRef',
  'billingReconciliationRef',
  'preCallBillingSnapshotPath',
  'settledBillingSnapshotPath',
  'preCallBillingSnapshotSha256',
  'settledBillingSnapshotSha256',
  'providerBillingEntryRef',
  'intentSha256',
  'submitReportSha256',
  'fingerprintClaimSha256',
  'requestFingerprint',
  'approvalId',
  'approvalSha256',
  'correlationMethod',
  'providerRequestId',
  'billingOutcome',
  'actualCostCents',
]);

const INTENT_KEYS = new Set([
  'schemaVersion',
  'operationId',
  'state',
  'endpointSha256',
  'model',
  'credentialRevision',
  'adapterRevision',
  'requestFingerprint',
  'request',
  'quotedCostCents',
  'maximumCostCents',
  'createdAt',
]);

const REQUEST_KEYS = new Set([
  'operation',
  'requestProfile',
  'n',
  'width',
  'height',
  'size',
  'promptSha256',
  'sourceSha256',
  'sourceDimensions',
  'maskSha256',
  'maskDimensions',
  'approvalEvidence',
]);

const APPROVAL_EVIDENCE_KEYS = new Set([
  'approvalId',
  'approvalSha256',
  'approvedAt',
  'expiresAt',
  'approverRefSha256',
  'providerAccountRefSha256',
  'pricingRevisionSha256',
  'currency',
  'preCallBillingSnapshotRefSha256',
  'billingReconciliationRefSha256',
]);

const FINGERPRINT_CLAIM_KEYS = new Set([
  'schemaVersion',
  'operationId',
  'requestFingerprint',
  'state',
  'createdAt',
]);

const SETTLEMENT_CLAIM_KEYS = new Set([
  'schemaVersion',
  'operationId',
  'settlementSha256',
  'finalizationAdapterRevision',
  'state',
]);

const REPORT_REQUIRED_KEYS = [
  'schemaVersion',
  'operationId',
  'state',
  'operation',
  'requestProfile',
  'credentialRevision',
  'adapterRevision',
  'provider',
  'model',
  'endpointSha256',
  'approvalEvidence',
  'promptSha256',
  'sourceSha256',
  'maskSha256',
  'requestedSize',
  'createRequests',
  'providerRequestIdHash',
  'usage',
  'startedAt',
  'completedAt',
  'elapsedMs',
  'actualCostCents',
  'quotedCostCents',
  'maximumCostCents',
  'intentPath',
];

const REPORT_SUCCESS_KEYS = new Set([
  ...REPORT_REQUIRED_KEYS,
  'imageCount',
  'mimeType',
  'width',
  'height',
  'bytes',
  'sha256',
  'imagePath',
]);

const REPORT_FAILURE_KEYS = new Set([
  ...REPORT_REQUIRED_KEYS,
  'failureCode',
]);

const SANDBOX_OPERATIONS = new Set([
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
]);

type BillingOutcome = 'CHARGED' | 'NO_CHARGE';
type CorrelationMethod = 'PROVIDER_REQUEST_ID' | 'UNIQUE_ACCOUNT_TIME_WINDOW';

interface PrivateFileEvidence {
  path: string;
  canonicalPath: string;
  bytes: Buffer;
  sha256: string;
  device: bigint;
  inode: bigint;
}

interface PrivateJsonEvidence extends PrivateFileEvidence {
  record: Record<string, unknown>;
}

export class AiImageSandboxBillingSettlementError extends Error {
  constructor(
    public readonly code:
      | 'SANDBOX_BILLING_CONFIG_INVALID'
      | 'SANDBOX_BILLING_FILE_UNSAFE'
      | 'SANDBOX_BILLING_DIGEST_MISMATCH'
      | 'SANDBOX_BILLING_ATTESTATION_INVALID'
      | 'SANDBOX_BILLING_EVIDENCE_INVALID'
      | 'SANDBOX_BILLING_MISMATCH'
      | 'SANDBOX_BILLING_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSandboxBillingSettlementError';
  }
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function hasExactKeys(record: Record<string, unknown>, keys: Set<string>) {
  const actual = Object.keys(record);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
  maxLength = 200,
) {
  const value = typeof record[key] === 'string' ? record[key].trim() : '';
  const hasControl = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!value || value.length > maxLength || hasControl) {
    throw new AiImageSandboxBillingSettlementError(code, `Sandbox billing ${key} is invalid`);
  }
  return value;
}

function canonicalTimestamp(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  const value = requiredString(record, key, code, 40);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      `Sandbox billing ${key} must be canonical ISO-8601`,
    );
  }
  return { value, time: parsed };
}

function requiredSha256(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  const value = requiredString(record, key, code, 64).toLowerCase();
  if (!SHA256_PATTERN.test(value) || value !== record[key]) {
    throw new AiImageSandboxBillingSettlementError(code, `Sandbox billing ${key} is invalid`);
  }
  return value;
}

function requiredNonnegativeInteger(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      `Sandbox billing ${key} must be a nonnegative integer`,
    );
  }
  return Number(value);
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function dimensions(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  return width && height ? { width, height } : null;
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
}

function isUnsupportedWindowsDirectorySync(error: unknown) {
  return process.platform === 'win32'
    && ['EACCES', 'EISDIR', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(errorCode(error));
}

async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if (isUnsupportedWindowsDirectorySync(error)) return;
    throw error;
  }
  try {
    try {
      await handle.sync();
    } catch (error) {
      if (!isUnsupportedWindowsDirectorySync(error)) throw error;
    }
  } finally {
    await handle.close();
  }
}

async function tolerateWindowsMode(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    if (process.platform === 'win32' && ['EINVAL', 'ENOSYS', 'EPERM'].includes(errorCode(error))) {
      return;
    }
    throw error;
  }
}

async function ensurePrivateDirectory(path: string, allowedRoot: string) {
  const root = resolve(allowedRoot);
  const target = resolve(path);
  if (!isPathWithin(root, target)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory escaped its private evidence root',
    );
  }
  const segments = relative(root, target).split(/[\\/]/gu).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    let metadata = await lstat(current);
    const canonicalPath = await realpath(current);
    if (
      !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || !samePath(current, canonicalPath)
      || !isPathWithin(root, canonicalPath)
    ) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing output directory is not private',
      );
    }
    await tolerateWindowsMode(() => chmod(current, 0o700));
    metadata = await lstat(current);
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing output directory is not private',
      );
    }
    await syncDirectory(current);
    const parent = dirname(current);
    if (parent !== current) await syncDirectory(parent);
  }
}

interface PrivateOutputDirectory {
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

async function openPrivateOutputDirectory(
  path: string,
  allowedRoot: string,
): Promise<PrivateOutputDirectory> {
  const resolvedPath = resolve(path);
  const canonicalPath = await realpath(resolvedPath);
  if (!samePath(resolvedPath, canonicalPath) || !isPathWithin(allowedRoot, canonicalPath)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory escaped its private evidence root',
    );
  }
  const pathMetadata = await lstat(resolvedPath);
  const pathIdentity = await lstat(resolvedPath, { bigint: true });
  if (
    !pathMetadata.isDirectory()
    || pathMetadata.isSymbolicLink()
    || !hasStableFileIdentity(pathIdentity.dev, pathIdentity.ino)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory identity is unavailable',
    );
  }
  const directoryFlags = constants.O_RDONLY
    | (process.platform === 'win32' ? 0 : (constants.O_DIRECTORY || 0) | constants.O_NOFOLLOW);
  const handle = await open(canonicalPath, directoryFlags);
  try {
    const handleMetadata = await handle.stat({ bigint: true });
    const directory = {
      path: resolvedPath,
      canonicalPath,
      device: pathIdentity.dev,
      inode: pathIdentity.ino,
      handle,
    };
    if (
      !handleMetadata.isDirectory()
      || !hasStableFileIdentity(handleMetadata.dev, handleMetadata.ino)
      || !sameFileIdentity(directory, {
        device: handleMetadata.dev,
        inode: handleMetadata.ino,
      })
      || (process.platform !== 'win32' && (handleMetadata.mode & 0o077n) !== 0n)
    ) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing output directory changed while it was opened',
      );
    }
    return directory;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertPrivateOutputDirectoryStable(directory: PrivateOutputDirectory) {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(directory.path);
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory disappeared during finalization',
    );
  }
  const [pathMetadata, handleMetadata] = await Promise.all([
    lstat(directory.path, { bigint: true }),
    directory.handle.stat({ bigint: true }),
  ]);
  if (
    !samePath(canonicalPath, directory.canonicalPath)
    || !pathMetadata.isDirectory()
    || pathMetadata.isSymbolicLink()
    || !handleMetadata.isDirectory()
    || !hasStableFileIdentity(pathMetadata.dev, pathMetadata.ino)
    || !hasStableFileIdentity(handleMetadata.dev, handleMetadata.ino)
    || !sameFileIdentity(directory, { device: pathMetadata.dev, inode: pathMetadata.ino })
    || !sameFileIdentity(directory, { device: handleMetadata.dev, inode: handleMetadata.ino })
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory changed during finalization',
    );
  }
}

function privateOutputEntryPath(directory: PrivateOutputDirectory, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(name)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing output filename is invalid',
    );
  }
  return process.platform === 'linux'
    ? `/proc/self/fd/${directory.handle.fd}/${name}`
    : resolve(directory.canonicalPath, name);
}

async function readBoundedFile(handle: Awaited<ReturnType<typeof open>>, maxBytes: number) {
  const buffer = Buffer.allocUnsafe(maxBytes + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.byteLength) {
    const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }
  return buffer.subarray(0, bytesRead);
}

async function resolvePrivateEvidenceRoot(repositoryRoot: string, configuredRoot: string) {
  const value = String(configuredRoot || '').trim();
  if (!value) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing evidence root is required',
    );
  }
  const path = resolve(repositoryRoot, value);
  try {
    const canonicalPath = await realpath(path);
    const metadata = await lstat(canonicalPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('unsafe');
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error('unsafe');
    }
    return canonicalPath;
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing evidence root must resolve to one private directory',
    );
  }
}

function isPathWithin(root: string, candidate: string) {
  const value = relative(root, candidate);
  return value === ''
    || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`));
}

async function loadPrivateFile(input: {
  repositoryRoot: string;
  path: string;
  expectedSha256?: string;
  maxBytes: number;
  allowedRoot?: string;
}): Promise<PrivateFileEvidence> {
  const expectedSha256 = input.expectedSha256 === undefined
    ? null
    : String(input.expectedSha256 || '').trim().toLowerCase();
  if (expectedSha256 !== null && !SHA256_PATTERN.test(expectedSha256)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing evidence digest must be a lowercase SHA-256 value',
    );
  }
  const path = resolve(input.repositoryRoot, String(input.path || '').trim());
  let handle: Awaited<ReturnType<typeof open>>;
  let canonicalPath = '';
  try {
    const pathMetadata = await lstat(path);
    if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) throw new Error('unsafe');
    canonicalPath = await realpath(path);
    if (input.allowedRoot && !isPathWithin(input.allowedRoot, canonicalPath)) {
      throw new Error('unsafe');
    }
    handle = await open(
      path,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing evidence could not be opened as a private regular file',
    );
  }
  let bytes: Buffer;
  let device = 0n;
  let inode = 0n;
  try {
    const metadata = await handle.stat();
    const identity = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > input.maxBytes) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing evidence must be a bounded regular file',
      );
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing evidence must not be accessible by group or other users',
      );
    }
    device = identity.dev;
    inode = identity.ino;
    bytes = await readBoundedFile(handle, input.maxBytes);
    if (bytes.byteLength !== metadata.size || bytes.byteLength > input.maxBytes) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing evidence changed while it was being read',
      );
    }
  } finally {
    await handle.close();
  }
  const actualSha256 = sha256(bytes);
  if (expectedSha256 !== null && actualSha256 !== expectedSha256) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_DIGEST_MISMATCH',
      'Sandbox billing evidence does not match its reviewed digest',
    );
  }
  return { path, canonicalPath, bytes, sha256: actualSha256, device, inode };
}

async function loadPrivateCanonicalJson(input: {
  repositoryRoot: string;
  path: string;
  expectedSha256?: string;
  maxBytes: number;
  kind: 'attestation' | 'evidence';
  allowedRoot?: string;
}): Promise<PrivateJsonEvidence> {
  const evidence = await loadPrivateFile(input);
  let textValue = '';
  let record: Record<string, unknown>;
  try {
    textValue = new TextDecoder('utf-8', { fatal: true }).decode(evidence.bytes);
    const parsed = JSON.parse(textValue) as unknown;
    if (!isRecord(parsed)) throw new Error('invalid');
    record = parsed;
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      input.kind === 'attestation'
        ? 'SANDBOX_BILLING_ATTESTATION_INVALID'
        : 'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing evidence must contain one canonical JSON object',
    );
  }
  if (textValue.replace(/\r\n/gu, '\n') !== `${JSON.stringify(record, null, 2)}\n`) {
    throw new AiImageSandboxBillingSettlementError(
      input.kind === 'attestation'
        ? 'SANDBOX_BILLING_ATTESTATION_INVALID'
        : 'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing evidence must use canonical JSON without duplicate keys',
    );
  }
  return { ...evidence, record };
}

async function readExactPrivateFile(
  path: string,
  expected: Buffer,
  maxBytes: number,
  allowedRoot: string,
) {
  let evidence: PrivateJsonEvidence;
  try {
    evidence = await loadPrivateCanonicalJson({
      repositoryRoot: dirname(path),
      path,
      expectedSha256: sha256(expected),
      maxBytes,
      kind: 'evidence',
      allowedRoot,
    });
  } catch {
    return false;
  }
  return evidence.bytes.equals(expected);
}

async function writeExclusiveAtomicFile(path: string, bytes: Buffer, allowedRoot: string) {
  const outputDirectoryPath = dirname(path);
  await ensurePrivateDirectory(outputDirectoryPath, allowedRoot);
  const directory = await openPrivateOutputDirectory(outputDirectoryPath, allowedRoot);
  const finalName = basename(path);
  const temporaryName = `${finalName}.${process.pid}.${randomUUID()}.tmp`;
  const temporaryPath = privateOutputEntryPath(directory, temporaryName);
  const finalPath = privateOutputEntryPath(directory, finalName);
  try {
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await tolerateWindowsMode(() => handle.chmod(0o600));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertPrivateOutputDirectoryStable(directory);
    await link(temporaryPath, finalPath);
    await assertPrivateOutputDirectoryStable(directory);
    await tolerateWindowsMode(() => chmod(finalPath, 0o600));
    try {
      await directory.handle.sync();
    } catch (error) {
      if (!isUnsupportedWindowsDirectorySync(error)) throw error;
    }
    await assertPrivateOutputDirectoryStable(directory);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
    await directory.handle.close();
  }
}

function assertApprovalEvidence(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, APPROVAL_EVIDENCE_KEYS)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing approval evidence is invalid',
    );
  }
  const shaKeys = [
    'approvalSha256',
    'approverRefSha256',
    'providerAccountRefSha256',
    'pricingRevisionSha256',
    'preCallBillingSnapshotRefSha256',
    'billingReconciliationRefSha256',
  ];
  if (
    typeof value.approvalId !== 'string'
    || !OPERATION_ID_PATTERN.test(value.approvalId)
    || shaKeys.some((key) => typeof value[key] !== 'string' || !SHA256_PATTERN.test(value[key]))
    || typeof value.currency !== 'string'
    || !/^[A-Z]{3}$/u.test(value.currency)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing approval evidence is invalid',
    );
  }
  const approvedAt = canonicalTimestamp(
    value,
    'approvedAt',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  const expiresAt = canonicalTimestamp(
    value,
    'expiresAt',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  if (
    expiresAt.time <= approvedAt.time
    || expiresAt.time - approvedAt.time > MAX_APPROVAL_WINDOW_MS
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing approval validity window is invalid',
    );
  }
  return value;
}

function assertIntentRequest(request: Record<string, unknown>) {
  const operation = typeof request.operation === 'string' ? request.operation : '';
  const requestProfile = typeof request.requestProfile === 'string' ? request.requestProfile : '';
  const width = positiveInteger(request.width);
  const height = positiveInteger(request.height);
  const sourceSha256 = Array.isArray(request.sourceSha256)
    && request.sourceSha256.length <= 1
    && request.sourceSha256.every((entry) => typeof entry === 'string' && SHA256_PATTERN.test(entry))
    ? request.sourceSha256 as string[]
    : null;
  const sourceDimensions = Array.isArray(request.sourceDimensions)
    ? request.sourceDimensions.map(dimensions)
    : null;
  const maskSha256 = request.maskSha256 === null
    ? null
    : typeof request.maskSha256 === 'string' && SHA256_PATTERN.test(request.maskSha256)
      ? request.maskSha256
      : undefined;
  const maskDimensions = request.maskDimensions === null
    ? null
    : dimensions(request.maskDimensions);
  if (
    !SANDBOX_OPERATIONS.has(operation)
    || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(requestProfile)
    || request.n !== 1
    || !width
    || !height
    || request.size !== `${width}x${height}`
    || typeof request.promptSha256 !== 'string'
    || !SHA256_PATTERN.test(request.promptSha256)
    || !sourceSha256
    || !sourceDimensions
    || sourceDimensions.some((entry) => !entry)
    || sourceDimensions.length !== sourceSha256.length
    || maskSha256 === undefined
    || maskDimensions === undefined
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent request is invalid',
    );
  }
  const isTextToImage = operation === 'TEXT_TO_IMAGE';
  const isInpaint = operation === 'INPAINT';
  if (
    (isTextToImage && (
      sourceSha256.length !== 0
      || sourceDimensions.length !== 0
      || maskSha256 !== null
      || maskDimensions !== null
    ))
    || (!isTextToImage && (sourceSha256.length !== 1 || sourceDimensions.length !== 1))
    || (isInpaint && (
      maskSha256 === null
      || maskDimensions === null
      || maskDimensions.width !== sourceDimensions[0]!.width
      || maskDimensions.height !== sourceDimensions[0]!.height
    ))
    || (!isInpaint && (maskSha256 !== null || maskDimensions !== null))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent media evidence is invalid',
    );
  }
}

function parseAttestation(record: Record<string, unknown>, now: Date) {
  if (!hasExactKeys(record, ATTESTATION_KEYS) || record.schemaVersion !== 1) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing attestation contains missing or unsupported fields',
    );
  }
  const settlementId = requiredString(
    record,
    'settlementId',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
    80,
  );
  if (!OPERATION_ID_PATTERN.test(settlementId)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing settlement ID is invalid',
    );
  }
  if (requiredString(
    record,
    'statement',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
    80,
  ) !== AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing attestation statement is invalid',
    );
  }
  const operationId = requiredString(
    record,
    'operationId',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
    80,
  );
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing Operation ID is invalid',
    );
  }
  const preCallObservedAt = canonicalTimestamp(
    record,
    'preCallObservedAt',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
  );
  const settledObservedAt = canonicalTimestamp(
    record,
    'settledObservedAt',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
  );
  if (
    preCallObservedAt.time >= settledObservedAt.time
    || settledObservedAt.time > now.getTime() + MAX_CLOCK_SKEW_MS
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing observation window is invalid',
    );
  }
  const currency = requiredString(
    record,
    'currency',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
    3,
  );
  if (!/^[A-Z]{3}$/u.test(currency) || currency !== record.currency) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing currency is invalid',
    );
  }
  const correlationMethod = record.correlationMethod as CorrelationMethod;
  const billingOutcome = record.billingOutcome as BillingOutcome;
  const providerRequestId = record.providerRequestId === null
    ? null
    : typeof record.providerRequestId === 'string'
      ? requiredString(record, 'providerRequestId', 'SANDBOX_BILLING_ATTESTATION_INVALID', 500)
      : undefined;
  const actualCostCents = requiredNonnegativeInteger(
    record,
    'actualCostCents',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
  );
  if (
    !['PROVIDER_REQUEST_ID', 'UNIQUE_ACCOUNT_TIME_WINDOW'].includes(correlationMethod)
    || providerRequestId === undefined
    || (correlationMethod === 'PROVIDER_REQUEST_ID' && !providerRequestId)
    || (correlationMethod === 'UNIQUE_ACCOUNT_TIME_WINDOW' && providerRequestId !== null)
    || !['CHARGED', 'NO_CHARGE'].includes(billingOutcome)
    || (billingOutcome === 'CHARGED' && actualCostCents <= 0)
    || (billingOutcome === 'NO_CHARGE' && actualCostCents !== 0)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing outcome or correlation is invalid',
    );
  }
  return {
    settlementId,
    operationId,
    preCallObservedAt,
    settledObservedAt,
    reconcilerRef: requiredString(record, 'reconcilerRef', 'SANDBOX_BILLING_ATTESTATION_INVALID', 128),
    providerAccountRef: requiredString(record, 'providerAccountRef', 'SANDBOX_BILLING_ATTESTATION_INVALID', 160),
    pricingRevision: requiredString(record, 'pricingRevision', 'SANDBOX_BILLING_ATTESTATION_INVALID', 160),
    currency,
    preCallBillingSnapshotRef: requiredString(record, 'preCallBillingSnapshotRef', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    billingReconciliationRef: requiredString(record, 'billingReconciliationRef', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    preCallBillingSnapshotPath: requiredString(
      record,
      'preCallBillingSnapshotPath',
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      2_048,
    ),
    settledBillingSnapshotPath: requiredString(
      record,
      'settledBillingSnapshotPath',
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      2_048,
    ),
    preCallBillingSnapshotSha256: requiredSha256(record, 'preCallBillingSnapshotSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    settledBillingSnapshotSha256: requiredSha256(record, 'settledBillingSnapshotSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    providerBillingEntryRef: requiredString(record, 'providerBillingEntryRef', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    intentSha256: requiredSha256(record, 'intentSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    submitReportSha256: requiredSha256(record, 'submitReportSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    fingerprintClaimSha256: requiredSha256(record, 'fingerprintClaimSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    requestFingerprint: requiredSha256(record, 'requestFingerprint', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    approvalId: requiredString(record, 'approvalId', 'SANDBOX_BILLING_ATTESTATION_INVALID', 80),
    approvalSha256: requiredSha256(record, 'approvalSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    correlationMethod,
    providerRequestId,
    billingOutcome,
    actualCostCents,
  };
}

function parseIntent(record: Record<string, unknown>, operationId: string) {
  if (
    !hasExactKeys(record, INTENT_KEYS)
    || record.schemaVersion !== 2
    || record.operationId !== operationId
    || record.state !== 'SUBMITTING'
    || !isRecord(record.request)
    || !hasExactKeys(record.request, REQUEST_KEYS)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent is invalid',
    );
  }
  const request = record.request;
  assertIntentRequest(request);
  const approvalEvidence = assertApprovalEvidence(request.approvalEvidence);
  const createdAt = canonicalTimestamp(record, 'createdAt', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  const quotedCostCents = requiredNonnegativeInteger(
    record,
    'quotedCostCents',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  const maximumCostCents = requiredNonnegativeInteger(
    record,
    'maximumCostCents',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  const model = requiredString(record, 'model', 'SANDBOX_BILLING_EVIDENCE_INVALID', 200);
  const credentialRevision = requiredString(
    record,
    'credentialRevision',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
    128,
  );
  if (
    quotedCostCents <= 0
    || maximumCostCents <= 0
    || quotedCostCents > maximumCostCents
    || typeof record.endpointSha256 !== 'string'
    || !SHA256_PATTERN.test(record.endpointSha256)
    || model !== record.model
    || credentialRevision !== record.credentialRevision
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(credentialRevision)
    || typeof record.requestFingerprint !== 'string'
    || !SHA256_PATTERN.test(record.requestFingerprint)
    || typeof record.adapterRevision !== 'string'
    || !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(record.adapterRevision)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent identity is invalid',
    );
  }
  return {
    record,
    request,
    approvalEvidence,
    createdAt,
    quotedCostCents,
    maximumCostCents,
    model,
    credentialRevision,
  };
}

function parseReport(record: Record<string, unknown>, operationId: string) {
  const state = typeof record.state === 'string' ? record.state : '';
  const expectedKeys = state === 'SUCCEEDED'
    ? REPORT_SUCCESS_KEYS
    : ['REJECTED', 'RECONCILIATION_REQUIRED'].includes(state)
      ? REPORT_FAILURE_KEYS
      : null;
  if (
    !expectedKeys
    || !hasExactKeys(record, expectedKeys)
    || record.schemaVersion !== 3
    || record.operationId !== operationId
    || record.actualCostCents !== null
    || record.createRequests !== 1
    || record.provider !== 'custom-openai-compatible'
    || record.usage !== null
    || !SANDBOX_OPERATIONS.has(String(record.operation))
    || typeof record.requestProfile !== 'string'
    || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(record.requestProfile)
    || typeof record.endpointSha256 !== 'string'
    || !SHA256_PATTERN.test(record.endpointSha256)
    || typeof record.promptSha256 !== 'string'
    || !SHA256_PATTERN.test(record.promptSha256)
    || !Array.isArray(record.sourceSha256)
    || record.sourceSha256.length > 1
    || record.sourceSha256.some((entry) => typeof entry !== 'string' || !SHA256_PATTERN.test(entry))
    || (record.maskSha256 !== null
      && (typeof record.maskSha256 !== 'string' || !SHA256_PATTERN.test(record.maskSha256)))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit report is not eligible for finalization',
    );
  }
  const model = requiredString(record, 'model', 'SANDBOX_BILLING_EVIDENCE_INVALID', 200);
  const credentialRevision = requiredString(
    record,
    'credentialRevision',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
    128,
  );
  requiredString(record, 'intentPath', 'SANDBOX_BILLING_EVIDENCE_INVALID', 2_048);
  if (
    model !== record.model
    || credentialRevision !== record.credentialRevision
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(credentialRevision)
    || typeof record.adapterRevision !== 'string'
    || !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(record.adapterRevision)
    || typeof record.requestedSize !== 'string'
    || !/^\d{1,4}x\d{1,4}$/u.test(record.requestedSize)
    || !Number.isSafeInteger(record.quotedCostCents)
    || Number(record.quotedCostCents) <= 0
    || !Number.isSafeInteger(record.maximumCostCents)
    || Number(record.maximumCostCents) <= 0
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit identity is invalid',
    );
  }
  const approvalEvidence = assertApprovalEvidence(record.approvalEvidence);
  const startedAt = canonicalTimestamp(record, 'startedAt', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  const completedAt = canonicalTimestamp(record, 'completedAt', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  const elapsedMs = requiredNonnegativeInteger(record, 'elapsedMs', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  if (
    completedAt.time < startedAt.time
    || completedAt.time - startedAt.time !== elapsedMs
    || (record.providerRequestIdHash !== null
      && (typeof record.providerRequestIdHash !== 'string'
        || !SHA256_PATTERN.test(record.providerRequestIdHash)))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit timing or request evidence is invalid',
    );
  }
  const successInvalid = state === 'SUCCEEDED' && (
    record.imageCount !== 1
    || !['image/png', 'image/jpeg', 'image/webp'].includes(String(record.mimeType))
    || !positiveInteger(record.width)
    || Number(record.width) > 4_096
    || !positiveInteger(record.height)
    || Number(record.height) > 4_096
    || !positiveInteger(record.bytes)
    || Number(record.bytes) > 50 * 1024 * 1024
    || typeof record.sha256 !== 'string'
    || !SHA256_PATTERN.test(record.sha256)
    || requiredString(record, 'imagePath', 'SANDBOX_BILLING_EVIDENCE_INVALID', 2_048)
      !== record.imagePath
  );
  const failureInvalid = state !== 'SUCCEEDED' && (
    typeof record.failureCode !== 'string'
    || !/^[A-Z0-9_.-]{1,80}$/u.test(record.failureCode)
  );
  if (successInvalid || failureInvalid) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit outcome evidence is invalid',
    );
  }
  return { record, approvalEvidence, startedAt, completedAt, model, credentialRevision };
}

function assertArtifactsMatch(input: {
  attestation: ReturnType<typeof parseAttestation>;
  intent: ReturnType<typeof parseIntent>;
  report: ReturnType<typeof parseReport>;
  claim: Record<string, unknown>;
}) {
  const { attestation, intent, report, claim } = input;
  const intentRecord = intent.record;
  const reportRecord = report.record;
  const request = intent.request;
  if (!hasExactKeys(claim, FINGERPRINT_CLAIM_KEYS)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing fingerprint claim is invalid',
    );
  }
  const claimCreatedAt = canonicalTimestamp(
    claim,
    'createdAt',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  const recomputedFingerprint = createAiImageSandboxRequestFingerprint({
    endpointSha256: String(intentRecord.endpointSha256),
    model: intent.model,
    request: {
      n: Number(request.n),
      size: String(request.size),
      promptSha256: String(request.promptSha256),
      sourceSha256: request.sourceSha256 as string[],
      maskSha256: request.maskSha256 as string | null,
    },
  });
  const approvedAt = Date.parse(String(intent.approvalEvidence.approvedAt));
  const expiresAt = Date.parse(String(intent.approvalEvidence.expiresAt));
  if (
    claim.schemaVersion !== 1
    || claim.operationId !== attestation.operationId
    || claim.requestFingerprint !== attestation.requestFingerprint
    || claim.state !== 'CLAIMED_FAIL_CLOSED'
    || claimCreatedAt.value !== intent.createdAt.value
    || intentRecord.requestFingerprint !== attestation.requestFingerprint
    || intentRecord.requestFingerprint !== recomputedFingerprint
    || attestation.approvalId !== intent.approvalEvidence.approvalId
    || attestation.approvalSha256 !== intent.approvalEvidence.approvalSha256
    || sha256(attestation.providerAccountRef) !== intent.approvalEvidence.providerAccountRefSha256
    || sha256(attestation.pricingRevision) !== intent.approvalEvidence.pricingRevisionSha256
    || sha256(attestation.preCallBillingSnapshotRef)
      !== intent.approvalEvidence.preCallBillingSnapshotRefSha256
    || sha256(attestation.billingReconciliationRef)
      !== intent.approvalEvidence.billingReconciliationRefSha256
    || attestation.currency !== intent.approvalEvidence.currency
    || canonicalJson(report.approvalEvidence) !== canonicalJson(intent.approvalEvidence)
    || reportRecord.endpointSha256 !== intentRecord.endpointSha256
    || reportRecord.model !== intentRecord.model
    || reportRecord.credentialRevision !== intentRecord.credentialRevision
    || reportRecord.adapterRevision !== intentRecord.adapterRevision
    || reportRecord.operation !== request.operation
    || reportRecord.requestProfile !== request.requestProfile
    || reportRecord.promptSha256 !== request.promptSha256
    || canonicalJson(reportRecord.sourceSha256) !== canonicalJson(request.sourceSha256)
    || reportRecord.maskSha256 !== request.maskSha256
    || reportRecord.requestedSize !== request.size
    || reportRecord.quotedCostCents !== intent.quotedCostCents
    || reportRecord.maximumCostCents !== intent.maximumCostCents
    || report.startedAt.time < intent.createdAt.time
    || attestation.preCallObservedAt.time > approvedAt
    || approvedAt - attestation.preCallObservedAt.time > MAX_PRECALL_SNAPSHOT_AGE_MS
    || intent.createdAt.time + MAX_CLOCK_SKEW_MS < approvedAt
    || intent.createdAt.time >= expiresAt
    || report.startedAt.time + MAX_CLOCK_SKEW_MS < approvedAt
    || report.startedAt.time >= expiresAt
    || attestation.preCallObservedAt.time > report.startedAt.time
    || report.startedAt.time - attestation.preCallObservedAt.time
      > MAX_PRECALL_SNAPSHOT_AGE_MS
    || attestation.settledObservedAt.time < report.completedAt.time
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing artifacts do not describe the same paid request',
    );
  }
  const providerRequestIdHash = reportRecord.providerRequestIdHash as string | null;
  if (
    (attestation.correlationMethod === 'PROVIDER_REQUEST_ID'
      && (!providerRequestIdHash
        || !attestation.providerRequestId
        || sha256(attestation.providerRequestId) !== providerRequestIdHash))
    || (attestation.correlationMethod === 'UNIQUE_ACCOUNT_TIME_WINDOW'
      && (providerRequestIdHash !== null
        || attestation.providerRequestId !== null
        || attestation.settledObservedAt.time - attestation.preCallObservedAt.time
          > MAX_CORRELATION_WINDOW_MS))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing correlation does not match Provider request evidence',
    );
  }
}

function parseSettlementClaim(
  record: Record<string, unknown>,
  operationId: string,
  settlementSha256: string,
) {
  if (
    !hasExactKeys(record, SETTLEMENT_CLAIM_KEYS)
    || record.schemaVersion !== 1
    || record.operationId !== operationId
    || record.settlementSha256 !== settlementSha256
    || record.state !== 'BILLING_SETTLEMENT_CLAIMED'
    || typeof record.finalizationAdapterRevision !== 'string'
    || !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(record.finalizationAdapterRevision)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFLICT',
      'Sandbox billing Operation ID already has a different settlement claim',
    );
  }
  return record.finalizationAdapterRevision;
}

export async function finalizeAiImageSandboxBillingSettlement(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  operationId: string;
  settlementPath: string;
  settlementSha256: string;
  finalizationAdapterRevision: string;
  now?: Date;
}) {
  const operationId = String(input.operationId || '').trim();
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing Operation ID is invalid',
    );
  }
  const finalizationAdapterRevision = String(input.finalizationAdapterRevision || '')
    .trim()
    .toLowerCase();
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(finalizationAdapterRevision)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing finalizer revision must be a full Git object ID',
    );
  }
  const now = input.now || new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing clock is invalid',
    );
  }
  const evidenceRoot = await resolvePrivateEvidenceRoot(input.repositoryRoot, input.evidenceRoot);
  const attestationEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: input.repositoryRoot,
    path: input.settlementPath,
    expectedSha256: input.settlementSha256,
    maxBytes: MAX_ATTESTATION_BYTES,
    kind: 'attestation',
  });
  const attestation = parseAttestation(attestationEvidence.record, now);
  if (attestation.operationId !== operationId) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing attestation does not match the Operation ID',
    );
  }
  const preCallSnapshotEvidence = await loadPrivateFile({
    repositoryRoot: input.repositoryRoot,
    path: attestation.preCallBillingSnapshotPath,
    expectedSha256: attestation.preCallBillingSnapshotSha256,
    maxBytes: MAX_BILLING_SNAPSHOT_BYTES,
  });
  const settledSnapshotEvidence = await loadPrivateFile({
    repositoryRoot: input.repositoryRoot,
    path: attestation.settledBillingSnapshotPath,
    expectedSha256: attestation.settledBillingSnapshotSha256,
    maxBytes: MAX_BILLING_SNAPSHOT_BYTES,
  });
  const sameSnapshotPath = samePath(
    preCallSnapshotEvidence.canonicalPath,
    settledSnapshotEvidence.canonicalPath,
  );
  const snapshotIdentityAvailable = hasStableFileIdentity(
    preCallSnapshotEvidence.device,
    preCallSnapshotEvidence.inode,
  ) && hasStableFileIdentity(
    settledSnapshotEvidence.device,
    settledSnapshotEvidence.inode,
  );
  const sameSnapshotFile = snapshotIdentityAvailable && sameFileIdentity(
    preCallSnapshotEvidence,
    settledSnapshotEvidence,
  );
  if (sameSnapshotPath || !snapshotIdentityAvailable || sameSnapshotFile) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing before and settled snapshots must be distinct files',
    );
  }

  const intentPath = resolve(evidenceRoot, 'intents', `${operationId}.intent.json`);
  const reportPath = resolve(evidenceRoot, `${operationId}.report.json`);
  const intentEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: evidenceRoot,
    path: intentPath,
    expectedSha256: attestation.intentSha256,
    maxBytes: MAX_INTENT_BYTES,
    kind: 'evidence',
    allowedRoot: evidenceRoot,
  });
  const reportEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: evidenceRoot,
    path: reportPath,
    expectedSha256: attestation.submitReportSha256,
    maxBytes: MAX_REPORT_BYTES,
    kind: 'evidence',
    allowedRoot: evidenceRoot,
  });
  const intent = parseIntent(intentEvidence.record, operationId);
  const report = parseReport(reportEvidence.record, operationId);
  const fingerprintPath = resolve(
    evidenceRoot,
    'intents',
    '.fingerprints',
    `${intent.record.requestFingerprint}.claim.json`,
  );
  const claimEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: evidenceRoot,
    path: fingerprintPath,
    expectedSha256: attestation.fingerprintClaimSha256,
    maxBytes: MAX_CLAIM_BYTES,
    kind: 'evidence',
    allowedRoot: evidenceRoot,
  });
  if (
    intentEvidence.sha256 !== attestation.intentSha256
    || reportEvidence.sha256 !== attestation.submitReportSha256
    || claimEvidence.sha256 !== attestation.fingerprintClaimSha256
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing evidence digests do not match the attestation',
    );
  }
  assertArtifactsMatch({ attestation, intent, report, claim: claimEvidence.record });

  const billedUnits = attestation.billingOutcome === 'CHARGED' ? 1 : 0;
  const billingGate = attestation.actualCostCents > intent.maximumCostCents
    ? 'COST_LIMIT_EXCEEDED'
    : 'PASS';
  const billingDirectory = resolve(evidenceRoot, 'billing');
  const claimDirectory = resolve(billingDirectory, '.claims');
  const settlementClaimPath = resolve(claimDirectory, `${operationId}.billing.claim.json`);
  const receiptPath = resolve(billingDirectory, `${operationId}.billing.settlement.json`);
  const settlementClaim = {
    schemaVersion: 1,
    operationId,
    settlementSha256: attestationEvidence.sha256,
    finalizationAdapterRevision,
    state: 'BILLING_SETTLEMENT_CLAIMED',
  };
  const settlementClaimBytes = Buffer.from(`${JSON.stringify(settlementClaim, null, 2)}\n`, 'utf8');
  let claimReplayed = false;
  let receiptFinalizationRevision = finalizationAdapterRevision;
  try {
    await writeExclusiveAtomicFile(settlementClaimPath, settlementClaimBytes, evidenceRoot);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const existingClaim = await loadPrivateCanonicalJson({
      repositoryRoot: evidenceRoot,
      path: settlementClaimPath,
      maxBytes: MAX_CLAIM_BYTES,
      kind: 'evidence',
      allowedRoot: evidenceRoot,
    });
    receiptFinalizationRevision = parseSettlementClaim(
      existingClaim.record,
      operationId,
      attestationEvidence.sha256,
    );
    claimReplayed = true;
  }
  const receipt = {
    schemaVersion: 1,
    event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
    operationId,
    settlementId: attestation.settlementId,
    settlementSha256: attestationEvidence.sha256,
    intentSha256: intentEvidence.sha256,
    submitReportSha256: reportEvidence.sha256,
    fingerprintClaimSha256: claimEvidence.sha256,
    requestFingerprint: attestation.requestFingerprint,
    submitState: report.record.state,
    providerOutcomeResolved: report.record.state !== 'RECONCILIATION_REQUIRED',
    sameRequestRetryAllowed: false,
    endpointSha256: intent.record.endpointSha256,
    modelSha256: sha256(intent.model),
    operation: intent.request.operation,
    requestProfile: intent.request.requestProfile,
    promptSha256: intent.request.promptSha256,
    sourceSha256: intent.request.sourceSha256,
    maskSha256: intent.request.maskSha256,
    approvalId: attestation.approvalId,
    approvalSha256: attestation.approvalSha256,
    submissionAdapterRevision: intent.record.adapterRevision,
    finalizationAdapterRevision: receiptFinalizationRevision,
    correlationMethod: attestation.correlationMethod,
    providerRequestIdHash: report.record.providerRequestIdHash,
    currency: attestation.currency,
    billingOutcome: attestation.billingOutcome,
    billingGate,
    actualCostCents: attestation.actualCostCents,
    billedUnits,
    quotedCostCents: intent.quotedCostCents,
    maximumCostCents: intent.maximumCostCents,
    preCallObservedAt: attestation.preCallObservedAt.value,
    settledObservedAt: attestation.settledObservedAt.value,
    reconcilerRefSha256: sha256(attestation.reconcilerRef),
    providerAccountRefSha256: sha256(attestation.providerAccountRef),
    pricingRevisionSha256: sha256(attestation.pricingRevision),
    preCallBillingSnapshotRefSha256: sha256(attestation.preCallBillingSnapshotRef),
    billingReconciliationRefSha256: sha256(attestation.billingReconciliationRef),
    providerBillingEntryRefSha256: sha256(attestation.providerBillingEntryRef),
    preCallBillingSnapshotSha256: preCallSnapshotEvidence.sha256,
    settledBillingSnapshotSha256: settledSnapshotEvidence.sha256,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  if (claimReplayed && receiptFinalizationRevision !== finalizationAdapterRevision) {
    const receiptReplayed = await readExactPrivateFile(
      receiptPath,
      receiptBytes,
      MAX_REPORT_BYTES,
      evidenceRoot,
    );
    if (!receiptReplayed) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_CONFLICT',
        'An incomplete billing claim must be recovered by its original finalizer revision',
      );
    }
    return { receipt, receiptPath, replayed: true };
  }
  try {
    await writeExclusiveAtomicFile(receiptPath, receiptBytes, evidenceRoot);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const receiptReplayed = await readExactPrivateFile(
      receiptPath,
      receiptBytes,
      MAX_REPORT_BYTES,
      evidenceRoot,
    );
    if (!receiptReplayed) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_CONFLICT',
        'Sandbox billing Operation ID already has a different settlement record',
      );
    }
  }
  return {
    receipt,
    receiptPath,
    replayed: claimReplayed,
  };
}
