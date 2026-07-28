import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import {
  assertAiImageSandboxApprovalCurrent,
  type AiImageSandboxApprovalEvidence,
} from './ai-image-sandbox-approval.js';

export class AiImageSandboxGuardError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_SANDBOX_BUDGET'
      | 'INVALID_SANDBOX_ADAPTER_REVISION'
      | 'INVALID_SANDBOX_APPROVAL_EVIDENCE'
      | 'INVALID_SANDBOX_CREDENTIAL_REVISION'
      | 'INVALID_SANDBOX_ENDPOINT'
      | 'INVALID_SANDBOX_OPERATION'
      | 'INVALID_SANDBOX_REQUEST'
      | 'SANDBOX_OPERATION_EXISTS'
      | 'SANDBOX_REQUEST_REPLAY',
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSandboxGuardError';
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SandboxFormEntry = string | Blob;

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
const SANDBOX_REQUEST_KEYS = new Set([
  'operation',
  'requestProfile',
  'endpoint',
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
const SANDBOX_OPERATIONS = new Set([
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
]);

export type AiImageSandboxRequestState =
  | 'READY'
  | 'DISPATCHED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RECONCILIATION_REQUIRED';

export interface AiImageSandboxCreateContract {
  endpoint: string;
  model: string;
  promptSha256: string;
  size: string;
  n: 1;
}

export type AiImageSandboxEditOperation = 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';

export interface AiImageSandboxEditContract {
  endpoint: string;
  operation: AiImageSandboxEditOperation;
  model: string;
  promptSha256: string;
  size: string;
  n: 1;
  sourceSha256: string[];
  maskSha256: string | null;
}

function positiveInteger(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_BUDGET',
      `${field} must be a positive integer`,
    );
  }
  return number;
}

function isDefiniteProviderRejection(status: number) {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function providerRequestIdHash(response: Response) {
  const value = String(
    response.headers.get('x-request-id')
      || response.headers.get('request-id')
      || response.headers.get('openai-request-id')
      || '',
  ).trim();
  return value && value.length <= 500
    ? createHash('sha256').update(value).digest('hex')
    : null;
}

function invalidSandboxRequest(message = 'Sandbox request evidence is invalid'): never {
  throw new AiImageSandboxGuardError('INVALID_SANDBOX_REQUEST', message);
}

function sanitizeApprovalEvidence(value: unknown, now: Date): AiImageSandboxApprovalEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_APPROVAL_EVIDENCE',
      'Sandbox approval evidence is invalid',
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const shaKeys = [
    'approvalSha256',
    'approverRefSha256',
    'providerAccountRefSha256',
    'pricingRevisionSha256',
    'preCallBillingSnapshotRefSha256',
    'billingReconciliationRefSha256',
  ];
  const canonicalTimestamp = (key: 'approvedAt' | 'expiresAt') => {
    const timestamp = typeof record[key] === 'string' ? record[key] : '';
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === timestamp
      ? timestamp
      : null;
  };
  const approvedAt = canonicalTimestamp('approvedAt');
  const expiresAt = canonicalTimestamp('expiresAt');
  if (
    keys.length !== APPROVAL_EVIDENCE_KEYS.size
    || keys.some((key) => !APPROVAL_EVIDENCE_KEYS.has(key))
    || typeof record.approvalId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u.test(record.approvalId)
    || shaKeys.some((key) => (
      typeof record[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(record[key])
    ))
    || !approvedAt
    || !expiresAt
    || typeof record.currency !== 'string'
    || !/^[A-Z]{3}$/u.test(record.currency)
  ) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_APPROVAL_EVIDENCE',
      'Sandbox approval evidence is invalid',
    );
  }
  const evidence = {
    approvalId: record.approvalId,
    approvalSha256: record.approvalSha256,
    approvedAt,
    expiresAt,
    approverRefSha256: record.approverRefSha256,
    providerAccountRefSha256: record.providerAccountRefSha256,
    pricingRevisionSha256: record.pricingRevisionSha256,
    currency: record.currency,
    preCallBillingSnapshotRefSha256: record.preCallBillingSnapshotRefSha256,
    billingReconciliationRefSha256: record.billingReconciliationRefSha256,
  } as AiImageSandboxApprovalEvidence;
  assertAiImageSandboxApprovalCurrent(evidence, now);
  return evidence;
}

function sanitizePositiveDimension(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function sanitizeDimensions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2
    || !Object.hasOwn(record, 'width')
    || !Object.hasOwn(record, 'height')
  ) return null;
  const width = sanitizePositiveDimension(record.width);
  const height = sanitizePositiveDimension(record.height);
  return width && height ? { width, height } : null;
}

function sanitizeSha256Array(value: unknown) {
  if (
    !Array.isArray(value)
    || value.length > 1
    || value.some((entry) => typeof entry !== 'string' || !/^[a-f0-9]{64}$/u.test(entry))
  ) return null;
  return [...value] as string[];
}

function sanitizeSandboxRequest(value: unknown, now: Date) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidSandboxRequest();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== SANDBOX_REQUEST_KEYS.size
    || keys.some((key) => !SANDBOX_REQUEST_KEYS.has(key))
  ) invalidSandboxRequest('Sandbox request contains missing or unsupported fields');

  const operation = typeof record.operation === 'string' ? record.operation : '';
  const requestProfile = typeof record.requestProfile === 'string' ? record.requestProfile : '';
  const width = sanitizePositiveDimension(record.width);
  const height = sanitizePositiveDimension(record.height);
  const sourceSha256 = sanitizeSha256Array(record.sourceSha256);
  const sourceDimensions = Array.isArray(record.sourceDimensions)
    ? record.sourceDimensions.map(sanitizeDimensions)
    : null;
  const maskSha256 = record.maskSha256 === null
    ? null
    : typeof record.maskSha256 === 'string' && /^[a-f0-9]{64}$/u.test(record.maskSha256)
      ? record.maskSha256
      : undefined;
  const maskDimensions = record.maskDimensions === null
    ? null
    : sanitizeDimensions(record.maskDimensions);
  const endpointUrl = (() => {
    try {
      return new URL(typeof record.endpoint === 'string' ? record.endpoint : '');
    } catch {
      return invalidSandboxRequest('Sandbox request endpoint is invalid');
    }
  })();
  const endpointHostname = endpointUrl.hostname.toLowerCase();
  if (
    endpointUrl.protocol !== 'https:'
    || endpointUrl.username
    || endpointUrl.password
    || endpointUrl.search
    || endpointUrl.hash
    || !endpointHostname
    || endpointHostname === 'localhost'
    || endpointHostname.endsWith('.localhost')
    || isIP(endpointHostname) !== 0
  ) invalidSandboxRequest('Sandbox request endpoint must use a public HTTPS DNS hostname');
  const endpoint = endpointUrl.toString();
  if (
    !SANDBOX_OPERATIONS.has(operation)
    || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(requestProfile)
    || record.n !== 1
    || !width
    || !height
    || record.size !== `${width}x${height}`
    || typeof record.promptSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(record.promptSha256)
    || !sourceSha256
    || !sourceDimensions
    || sourceDimensions.some((entry) => !entry)
    || sourceDimensions.length !== sourceSha256.length
    || maskSha256 === undefined
    || maskDimensions === undefined
  ) invalidSandboxRequest();

  const isTextToImage = operation === 'TEXT_TO_IMAGE';
  const isInpaint = operation === 'INPAINT';
  if (
    !endpointUrl.pathname.endsWith(isTextToImage ? '/images/generations' : '/images/edits')
    || (isTextToImage && (
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
  ) invalidSandboxRequest('Sandbox request media evidence does not match its operation');

  const approvalEvidence = sanitizeApprovalEvidence(record.approvalEvidence, now);
  const audit = {
    operation,
    requestProfile,
    n: 1,
    width,
    height,
    size: record.size,
    promptSha256: record.promptSha256,
    sourceSha256,
    sourceDimensions,
    maskSha256,
    maskDimensions,
  };
  return {
    endpoint,
    fingerprint: {
      n: 1,
      size: record.size,
      promptSha256: record.promptSha256,
      sourceSha256,
      maskSha256,
    },
    audit: { ...audit, approvalEvidence },
  };
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

async function setPrivateMode(path: string, mode: number) {
  await chmod(path, mode);
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

async function ensurePrivateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await setPrivateMode(path, 0o700);
  await syncDirectory(path);
  await syncDirectory(dirname(path));
}

async function writeExclusiveDurableFile(path: string, content: string) {
  const handle = await open(path, 'wx', 0o600);
  let failure: unknown;
  try {
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    failure ??= error;
  }
  try {
    await syncDirectory(dirname(path));
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

export async function claimAiImageSandboxOperation(input: {
  directory: string;
  operationId: string;
  endpointSha256: string;
  model: string;
  credentialRevision: string;
  adapterRevision: string;
  request: Record<string, unknown>;
  quotedCostCents: unknown;
  maximumCostCents: unknown;
  now?: Date;
}) {
  const operationId = String(input.operationId || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/.test(operationId)) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_OPERATION',
      'Sandbox operation ID is invalid',
    );
  }
  const credentialRevision = String(input.credentialRevision || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(credentialRevision)) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_CREDENTIAL_REVISION',
      'Sandbox credential revision is invalid',
    );
  }
  const adapterRevision = String(input.adapterRevision || '').trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(adapterRevision)) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_ADAPTER_REVISION',
      'Sandbox adapter revision must be a commit SHA',
    );
  }
  const model = String(input.model || '').trim();
  if (!model || model.length > 200 || Array.from(model).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  })) invalidSandboxRequest('Sandbox model evidence is invalid');
  const sanitizedRequest = sanitizeSandboxRequest(input.request, input.now || new Date());
  const endpointSha256 = String(input.endpointSha256 || '').trim().toLowerCase();
  const canonicalEndpointSha256 = createHash('sha256')
    .update(sanitizedRequest.endpoint)
    .digest('hex');
  if (!/^[a-f0-9]{64}$/.test(endpointSha256) || endpointSha256 !== canonicalEndpointSha256) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_ENDPOINT',
      'Sandbox endpoint evidence must be a SHA-256 digest',
    );
  }
  const quotedCostCents = positiveInteger(input.quotedCostCents, 'quotedCostCents');
  const maximumCostCents = positiveInteger(input.maximumCostCents, 'maximumCostCents');
  if (quotedCostCents > maximumCostCents) {
    throw new AiImageSandboxGuardError(
      'INVALID_SANDBOX_BUDGET',
      'Quoted sandbox cost exceeds the confirmed maximum',
    );
  }

  await ensurePrivateDirectory(input.directory);
  const intentPath = resolve(input.directory, `${operationId}.intent.json`);
  const canonicalRequestFingerprint = createHash('sha256').update(canonicalJson({
    endpointSha256,
    model,
    request: sanitizedRequest.fingerprint,
  })).digest('hex');
  const intent = {
    schemaVersion: 2,
    operationId,
    state: 'SUBMITTING',
    endpointSha256,
    model,
    credentialRevision,
    adapterRevision,
    requestFingerprint: canonicalRequestFingerprint,
    request: sanitizedRequest.audit,
    quotedCostCents,
    maximumCostCents,
    createdAt: new Date().toISOString(),
  };
  const fingerprintDirectory = resolve(input.directory, '.fingerprints');
  await ensurePrivateDirectory(fingerprintDirectory);
  const fingerprintPath = resolve(
    fingerprintDirectory,
    `${canonicalRequestFingerprint}.claim.json`,
  );
  try {
    await writeExclusiveDurableFile(fingerprintPath, `${JSON.stringify({
      schemaVersion: 1,
      operationId,
      requestFingerprint: canonicalRequestFingerprint,
      state: 'CLAIMED_FAIL_CLOSED',
      createdAt: intent.createdAt,
    }, null, 2)}\n`);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      let existingOperationId = '';
      try {
        existingOperationId = String(JSON.parse(await readFile(fingerprintPath, 'utf8'))?.operationId || '');
      } catch {
        // A malformed or partially replaced claim remains fail-closed.
      }
      throw new AiImageSandboxGuardError(
        existingOperationId === operationId ? 'SANDBOX_OPERATION_EXISTS' : 'SANDBOX_REQUEST_REPLAY',
        existingOperationId === operationId
          ? 'Sandbox operation already has an immutable request claim'
          : 'The same paid sandbox request is already claimed under another operation ID',
      );
    }
    throw error;
  }
  try {
    await writeExclusiveDurableFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new AiImageSandboxGuardError(
        'SANDBOX_OPERATION_EXISTS',
        'Sandbox operation already has an immutable intent; inspect it instead of resubmitting',
      );
    }
    throw error;
  }
  return { intent, intentPath };
}

export function createAiImageSandboxFetchGuard(input: {
  contract: AiImageSandboxCreateContract;
  validateUrl: (url: string) => Promise<string>;
  fetch: FetchLike;
  beforeCreate: () => void | Promise<void>;
}) {
  if (typeof input.beforeCreate !== 'function') {
    throw new Error('The single-submit sandbox requires a pre-create approval check');
  }
  const expectedEndpoint = new URL(input.contract.endpoint).toString();
  let createRequests = 0;
  let followupGetRequests = 0;
  let state: AiImageSandboxRequestState = 'READY';
  let requestIdHash: string | null = null;
  const guardedFetch: FetchLike = async (request, init) => {
    const rawUrl = request instanceof Request ? request.url : String(request);
    const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      throw new Error('The single-submit sandbox permits only GET and POST requests');
    }
    if (method === 'GET') {
      if (createRequests !== 1) {
        throw new Error('The single-submit sandbox permits result downloads only after its create request');
      }
      followupGetRequests += 1;
      if (followupGetRequests > input.contract.n) {
        throw new Error('The single-submit sandbox blocked excess result downloads');
      }
    }
    const safeUrl = await input.validateUrl(rawUrl);
    if (method === 'POST') {
      if (new URL(safeUrl).toString() !== expectedEndpoint) {
        throw new Error('The single-submit sandbox permits only its exact images/generations endpoint');
      }
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(String(init?.body || '')) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
        body = parsed as Record<string, unknown>;
      } catch {
        throw new Error('The single-submit sandbox requires a JSON create body');
      }
      const allowedKeys = new Set(['model', 'prompt', 'n', 'size']);
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      const promptSha256 = createHash('sha256').update(prompt).digest('hex');
      if (
        Object.keys(body).some((key) => !allowedKeys.has(key))
        || body.n !== input.contract.n
        || body.model !== input.contract.model
        || body.size !== input.contract.size
        || promptSha256 !== input.contract.promptSha256
      ) {
        throw new Error('The single-submit sandbox blocked an unexpected create contract');
      }
      if (createRequests >= 1) {
        throw new Error('The single-submit sandbox blocked a duplicate create request');
      }
      await input.beforeCreate();
      createRequests += 1;
      state = 'DISPATCHED';
    }
    try {
      const response = await input.fetch(safeUrl, { ...init, redirect: 'error' });
      if (method === 'POST') {
        requestIdHash = providerRequestIdHash(response);
        state = response.ok
          ? 'ACCEPTED'
          : isDefiniteProviderRejection(response.status)
            ? 'REJECTED'
            : 'RECONCILIATION_REQUIRED';
      } else if (!response.ok) {
        state = 'RECONCILIATION_REQUIRED';
      }
      return response;
    } catch (error) {
      if (createRequests === 1) state = 'RECONCILIATION_REQUIRED';
      throw error;
    }
  };
  return {
    fetch: guardedFetch,
    getCreateRequests: () => createRequests,
    getFollowupGetRequests: () => followupGetRequests,
    getEvidence: () => ({ state, providerRequestIdHash: requestIdHash }),
  };
}

function exactFormString(form: FormData, name: string) {
  const values = form.getAll(name);
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
}

async function blobSha256(value: SandboxFormEntry) {
  if (!(value instanceof Blob)) return null;
  return createHash('sha256').update(Buffer.from(await value.arrayBuffer())).digest('hex');
}

async function blobMatchesDeclaredImageMime(value: SandboxFormEntry | undefined) {
  if (!(value instanceof Blob)) return false;
  const bytes = Buffer.from(await value.arrayBuffer());
  if (value.type === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (value.type === 'image/jpeg') {
    return bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  }
  if (value.type === 'image/webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

export function createAiImageSandboxEditFetchGuard(input: {
  contract: AiImageSandboxEditContract;
  validateUrl: (url: string) => Promise<string>;
  fetch: FetchLike;
  beforeCreate: () => void | Promise<void>;
}) {
  if (typeof input.beforeCreate !== 'function') {
    throw new Error('The single-submit edit sandbox requires a pre-create approval check');
  }
  const expectedEndpoint = new URL(input.contract.endpoint).toString();
  let createRequests = 0;
  let followupGetRequests = 0;
  let state: AiImageSandboxRequestState = 'READY';
  let requestIdHash: string | null = null;
  const guardedFetch: FetchLike = async (request, init) => {
    const rawUrl = request instanceof Request ? request.url : String(request);
    const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      throw new Error('The single-submit edit sandbox permits only GET and POST requests');
    }
    if (method === 'GET') {
      if (createRequests !== 1) {
        throw new Error('The single-submit edit sandbox permits result downloads only after its create request');
      }
      followupGetRequests += 1;
      if (followupGetRequests > input.contract.n) {
        throw new Error('The single-submit edit sandbox blocked excess result downloads');
      }
    }
    const safeUrl = await input.validateUrl(rawUrl);
    if (method === 'POST') {
      if (new URL(safeUrl).toString() !== expectedEndpoint) {
        throw new Error('The single-submit edit sandbox permits only its exact images/edits endpoint');
      }
      if (!(init?.body instanceof FormData)) {
        throw new Error('The single-submit edit sandbox requires a multipart edit body');
      }
      const form = init.body;
      const allowedKeys = new Set(['model', 'prompt', 'n', 'size', 'image', 'image[]', 'mask']);
      const keys: string[] = [];
      form.forEach((_value, key) => keys.push(key));
      const prompt = exactFormString(form, 'prompt');
      const sourceField = input.contract.sourceSha256.length === 1 ? 'image' : 'image[]';
      const alternateSourceField = sourceField === 'image' ? 'image[]' : 'image';
      const sources = form.getAll(sourceField);
      const masks = form.getAll('mask');
      const sourceHashes = await Promise.all(sources.map(blobSha256));
      const sourceMimeMatches = await Promise.all(sources.map(blobMatchesDeclaredImageMime));
      const maskHash = masks.length === 1 ? await blobSha256(masks[0]!) : null;
      const requiresMask = input.contract.operation === 'INPAINT';
      const mask = masks[0];
      const maskIsPng = await blobMatchesDeclaredImageMime(mask);
      const validMask = requiresMask
        ? masks.length === 1
          && mask instanceof Blob
          && mask.type === 'image/png'
          && maskIsPng
          && maskHash === input.contract.maskSha256
        : masks.length === 0 && input.contract.maskSha256 === null;
      const validSources = sources.length === input.contract.sourceSha256.length
        && sources.every((source) => source instanceof Blob
          && ['image/png', 'image/jpeg', 'image/webp'].includes(source.type))
        && sourceMimeMatches.every(Boolean)
        && sourceHashes.every((hash, index) => hash === input.contract.sourceSha256[index]);
      if (
        keys.some((key) => !allowedKeys.has(key))
        || form.has(alternateSourceField)
        || exactFormString(form, 'model') !== input.contract.model
        || exactFormString(form, 'n') !== String(input.contract.n)
        || exactFormString(form, 'size') !== input.contract.size
        || prompt === null
        || createHash('sha256').update(prompt).digest('hex') !== input.contract.promptSha256
        || !validSources
        || !validMask
      ) {
        throw new Error('The single-submit edit sandbox blocked an unexpected multipart contract');
      }
      if (createRequests >= 1) {
        throw new Error('The single-submit edit sandbox blocked a duplicate create request');
      }
      await input.beforeCreate();
      createRequests += 1;
      state = 'DISPATCHED';
    }
    try {
      const response = await input.fetch(safeUrl, { ...init, redirect: 'error' });
      if (method === 'POST') {
        requestIdHash = providerRequestIdHash(response);
        state = response.ok
          ? 'ACCEPTED'
          : isDefiniteProviderRejection(response.status)
            ? 'REJECTED'
            : 'RECONCILIATION_REQUIRED';
      } else if (!response.ok) {
        state = 'RECONCILIATION_REQUIRED';
      }
      return response;
    } catch (error) {
      if (createRequests === 1) state = 'RECONCILIATION_REQUIRED';
      throw error;
    }
  };
  return {
    fetch: guardedFetch,
    getCreateRequests: () => createRequests,
    getFollowupGetRequests: () => followupGetRequests,
    getEvidence: () => ({ state, providerRequestIdHash: requestIdHash }),
  };
}
