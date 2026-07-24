import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AiImageTranslationSandboxContract {
  submitEndpoint: string;
  taskEndpointBase: string;
  model: 'qwen-mt-image';
  sourceSha256: string;
  sourceUrlSha256: string;
  sourceUrlVerified: true;
  sourceEvidence: {
    verified: true;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    width: number;
    height: number;
    bytes: number;
    sha256: string;
    etagSha256: string | null;
    cacheControlImmutable: boolean;
  };
  sourceLanguage: string;
  targetLanguage: string;
  domainHintSha256: string;
  terminologiesSha256: string;
  imageSegment: false;
  maxPollRequests: number;
  maxPollDurationMs: number;
}

export type AiImageTranslationSandboxState =
  | 'READY'
  | 'ACCEPTED'
  | 'PENDING'
  | 'RESULT_READY'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'FAILED'
  | 'RECONCILIATION_REQUIRED';

interface TranslationRequestBody {
  model: string;
  input: {
    image_url: string;
    source_lang: string;
    target_lang: string;
    ext: {
      domainHint: string;
      terminologies: Array<{ src: string; tgt: string }>;
      config: { imageSegment: boolean };
    };
  };
}

const MAX_EVIDENCE_JSON_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PENDING_STATUSES = new Set(['PENDING', 'RUNNING', 'QUEUED', 'PROCESSING', 'WAITING']);
const FAILED_STATUSES = new Set(['FAILED', 'CANCELED', 'CANCELLED']);

function isDefiniteProviderRejection(status: number) {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

export class AiImageTranslationSandboxGuardError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_SANDBOX_BUDGET'
      | 'INVALID_SANDBOX_OPERATION'
      | 'INVALID_SANDBOX_EVIDENCE'
      | 'SANDBOX_OPERATION_EXISTS'
      | 'SANDBOX_REQUEST_REPLAY',
    message: string,
  ) {
    super(message);
    this.name = 'AiImageTranslationSandboxGuardError';
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
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

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function positiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
}

export async function claimAiImageTranslationSandboxOperation(input: {
  directory: string;
  operationId: string;
  endpointSha256: string;
  credentialRevision: string;
  adapterRevision: string;
  contract: AiImageTranslationSandboxContract;
  quotedCostCents: unknown;
  maximumCostCents: unknown;
}) {
  const operationId = String(input.operationId || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/u.test(operationId)) {
    throw new AiImageTranslationSandboxGuardError(
      'INVALID_SANDBOX_OPERATION',
      'Translation sandbox operation ID is invalid',
    );
  }
  validateContract(input.contract);
  const endpointSha256 = String(input.endpointSha256 || '').trim().toLowerCase();
  const canonicalEndpointSha256 = sha256(new URL(input.contract.submitEndpoint).toString());
  const credentialRevision = String(input.credentialRevision || '').trim();
  const adapterRevision = String(input.adapterRevision || '').trim();
  if (
    !SHA256_PATTERN.test(endpointSha256)
    || endpointSha256 !== canonicalEndpointSha256
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(credentialRevision)
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(adapterRevision)
  ) {
    throw new AiImageTranslationSandboxGuardError(
      'INVALID_SANDBOX_EVIDENCE',
      'Translation sandbox endpoint, credential, or adapter revision evidence is invalid',
    );
  }
  const quotedCostCents = Number(input.quotedCostCents);
  const maximumCostCents = Number(input.maximumCostCents);
  if (
    !Number.isSafeInteger(quotedCostCents)
    || quotedCostCents <= 0
    || !Number.isSafeInteger(maximumCostCents)
    || maximumCostCents <= 0
    || quotedCostCents > maximumCostCents
  ) {
    throw new AiImageTranslationSandboxGuardError(
      'INVALID_SANDBOX_BUDGET',
      'Translation sandbox cost evidence is invalid',
    );
  }

  const requestEvidence = {
    operation: 'IMAGE_TRANSLATE',
    sourceSha256: input.contract.sourceSha256,
    sourceUrlSha256: input.contract.sourceUrlSha256,
    sourceUrlVerified: input.contract.sourceUrlVerified,
    sourceEvidence: input.contract.sourceEvidence,
    sourceLanguage: input.contract.sourceLanguage,
    targetLanguage: input.contract.targetLanguage,
    domainHintSha256: input.contract.domainHintSha256,
    terminologiesSha256: input.contract.terminologiesSha256,
    imageSegment: input.contract.imageSegment,
    maxPollRequests: input.contract.maxPollRequests,
    maxPollDurationMs: input.contract.maxPollDurationMs,
  };
  const requestFingerprint = sha256(canonicalJson({
    provider: 'dashscope-qwen-mt-image',
    model: input.contract.model,
    endpointSha256,
    credentialRevision,
    adapterRevision,
    request: {
      operation: requestEvidence.operation,
      sourceSha256: requestEvidence.sourceSha256,
      sourceUrlSha256: requestEvidence.sourceUrlSha256,
      sourceLanguage: requestEvidence.sourceLanguage,
      targetLanguage: requestEvidence.targetLanguage,
      domainHintSha256: requestEvidence.domainHintSha256,
      terminologiesSha256: requestEvidence.terminologiesSha256,
      imageSegment: requestEvidence.imageSegment,
    },
  }));
  const intent = {
    schemaVersion: 2,
    operationId,
    state: 'SUBMITTING',
    provider: 'dashscope-qwen-mt-image',
    model: input.contract.model,
    endpointSha256,
    credentialRevision,
    adapterRevision,
    request: requestEvidence,
    requestFingerprint,
    quotedCostCents,
    maximumCostCents,
    createdAt: new Date().toISOString(),
  };
  await ensurePrivateDirectory(input.directory);
  const intentPath = resolve(input.directory, `${operationId}.intent.json`);
  const fingerprintDirectory = resolve(input.directory, '.fingerprints');
  await ensurePrivateDirectory(fingerprintDirectory);
  const fingerprintPath = resolve(fingerprintDirectory, `${requestFingerprint}.claim.json`);
  try {
    await writeExclusiveDurableFile(fingerprintPath, `${JSON.stringify({
      schemaVersion: 1,
      operationId,
      requestFingerprint,
      state: 'CLAIMED_FAIL_CLOSED',
      createdAt: intent.createdAt,
    }, null, 2)}\n`);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      let existingOperationId = '';
      try {
        existingOperationId = String(JSON.parse(await readFile(fingerprintPath, 'utf8'))?.operationId || '');
      } catch {
        // A damaged fingerprint claim remains fail-closed.
      }
      throw new AiImageTranslationSandboxGuardError(
        existingOperationId === operationId ? 'SANDBOX_OPERATION_EXISTS' : 'SANDBOX_REQUEST_REPLAY',
        existingOperationId === operationId
          ? 'Translation sandbox operation already has an immutable request claim'
          : 'The same paid translation request is already claimed under another operation ID',
      );
    }
    throw error;
  }
  try {
    await writeExclusiveDurableFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new AiImageTranslationSandboxGuardError(
        'SANDBOX_OPERATION_EXISTS',
        'Translation sandbox operation already has an immutable intent; reconcile it instead of resubmitting',
      );
    }
    throw error;
  }
  return { intent, intentPath };
}

function validateContract(contract: AiImageTranslationSandboxContract) {
  if (contract.model !== 'qwen-mt-image') {
    throw new Error('The translation sandbox permits only qwen-mt-image');
  }
  for (const [field, value] of Object.entries({
    sourceSha256: contract.sourceSha256,
    sourceUrlSha256: contract.sourceUrlSha256,
    domainHintSha256: contract.domainHintSha256,
    terminologiesSha256: contract.terminologiesSha256,
  })) {
    if (!SHA256_PATTERN.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`);
  }
  if (!contract.sourceLanguage || !contract.targetLanguage || contract.sourceLanguage === contract.targetLanguage) {
    throw new Error('The translation sandbox requires distinct source and target languages');
  }
  if (contract.imageSegment !== false) {
    throw new Error('The translation sandbox requires image segmentation to remain disabled');
  }
  if (contract.sourceUrlVerified !== true) {
    throw new Error('The translation sandbox requires a verified source URL byte binding');
  }
  if (
    contract.sourceEvidence.verified !== true
    || contract.sourceEvidence.sha256 !== contract.sourceSha256
    || !['image/png', 'image/jpeg', 'image/webp'].includes(contract.sourceEvidence.mimeType)
    || !Number.isSafeInteger(contract.sourceEvidence.width)
    || contract.sourceEvidence.width <= 0
    || !Number.isSafeInteger(contract.sourceEvidence.height)
    || contract.sourceEvidence.height <= 0
    || !Number.isSafeInteger(contract.sourceEvidence.bytes)
    || contract.sourceEvidence.bytes <= 0
    || (contract.sourceEvidence.etagSha256 !== null
      && !SHA256_PATTERN.test(contract.sourceEvidence.etagSha256))
    || typeof contract.sourceEvidence.cacheControlImmutable !== 'boolean'
  ) {
    throw new Error('The translation sandbox source verification evidence is invalid');
  }
  positiveInteger(contract.maxPollRequests, 'maxPollRequests');
  positiveInteger(contract.maxPollDurationMs, 'maxPollDurationMs');
  return {
    submitEndpoint: new URL(contract.submitEndpoint).toString(),
    taskEndpointBase: new URL(`${contract.taskEndpointBase.replace(/\/+$/u, '')}/`).toString().replace(/\/$/u, ''),
  };
}

function parseExactRequest(body: string, contract: AiImageTranslationSandboxContract): TranslationRequestBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('The translation sandbox requires an exact JSON submit body');
  }
  if (!hasExactKeys(parsed, ['model', 'input']) || parsed.model !== contract.model) {
    throw new Error('The translation sandbox blocked an unexpected submit contract');
  }
  const input = parsed.input;
  if (!hasExactKeys(input, ['image_url', 'source_lang', 'target_lang', 'ext'])) {
    throw new Error('The translation sandbox blocked an unexpected submit contract');
  }
  const ext = input.ext;
  if (!hasExactKeys(ext, ['domainHint', 'terminologies', 'config'])
    || !hasExactKeys(ext.config, ['imageSegment'])
    || ext.config.imageSegment !== false
    || typeof input.image_url !== 'string'
    || sha256(input.image_url) !== contract.sourceUrlSha256
    || input.source_lang !== contract.sourceLanguage
    || input.target_lang !== contract.targetLanguage
    || typeof ext.domainHint !== 'string'
    || sha256(ext.domainHint) !== contract.domainHintSha256
    || !Array.isArray(ext.terminologies)
    || ext.terminologies.some((entry) => (
      !hasExactKeys(entry, ['src', 'tgt'])
      || typeof entry.src !== 'string'
      || typeof entry.tgt !== 'string'
    ))
    || sha256(JSON.stringify(ext.terminologies)) !== contract.terminologiesSha256
  ) {
    throw new Error('The translation sandbox blocked an unexpected submit contract');
  }
  return parsed as unknown as TranslationRequestBody;
}

async function requestBody(request: string | URL | Request, init?: RequestInit) {
  if (typeof init?.body === 'string') return init.body;
  if (request instanceof Request) return request.clone().text();
  throw new Error('The translation sandbox requires an exact JSON submit body');
}

async function readEvidenceJson(response: Response): Promise<Record<string, any> | null> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EVIDENCE_JSON_BYTES) return null;
  const reader = response.clone().body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_EVIDENCE_JSON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createAiImageTranslationSandboxFetchGuard(input: {
  contract: AiImageTranslationSandboxContract;
  validateUrl: (url: string) => Promise<string>;
  fetch: FetchLike;
  now?: () => number;
  onProviderTaskId?: (providerTaskId: string) => Promise<void>;
  onResultUrl?: (resultUrl: string) => Promise<void>;
  mode?: 'SUBMIT' | 'RECONCILE';
  recovery?: {
    providerTaskId: string;
    resultUrl?: string | null;
  };
}) {
  const endpoints = validateContract(input.contract);
  const now = input.now || Date.now;
  const mode = input.mode || 'SUBMIT';
  const recoveredTaskId = String(input.recovery?.providerTaskId || '').trim();
  if (mode === 'RECONCILE' && (!recoveredTaskId || recoveredTaskId.length > 500)) {
    throw new Error('The translation sandbox reconciliation task identity is invalid');
  }
  const recoveredResultUrl = input.recovery?.resultUrl
    ? new URL(input.recovery.resultUrl).toString()
    : null;
  let submitClaimed = mode === 'RECONCILE';
  let submitRequests = 0;
  let pollRequests = 0;
  let resultDownloads = 0;
  let state: AiImageTranslationSandboxState = recoveredResultUrl
    ? 'RESULT_READY'
    : mode === 'RECONCILE' ? 'ACCEPTED' : 'READY';
  let acceptedAt: number | null = mode === 'RECONCILE' ? now() : null;
  let providerTaskId: string | null = mode === 'RECONCILE' ? recoveredTaskId : null;
  let resultUrl: string | null = recoveredResultUrl;
  const providerRequestIdHashes: string[] = [];
  let imageCount: number | null = null;
  const maximumResultDownloads = mode === 'RECONCILE' && recoveredResultUrl ? 2 : 1;

  function requireReconciliation() {
    state = 'RECONCILIATION_REQUIRED';
  }

  function captureEvidence(body: Record<string, any> | null) {
    const requestId = typeof body?.request_id === 'string' ? body.request_id.trim() : '';
    if (requestId && requestId.length <= 500) {
      const digest = sha256(requestId);
      if (!providerRequestIdHashes.includes(digest)) providerRequestIdHashes.push(digest);
    }
    const candidateImageCount = body?.usage?.image_count;
    if (Number.isSafeInteger(candidateImageCount) && candidateImageCount >= 0 && candidateImageCount <= 1000) {
      imageCount = candidateImageCount;
    }
  }

  const guardedFetch: FetchLike = async (request, init) => {
    const rawUrl = request instanceof Request ? request.url : String(request);
    const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      throw new Error('The translation sandbox permits only POST submit and GET poll/download requests');
    }

    if (method === 'POST') {
      if (mode === 'RECONCILE') {
        throw new Error('The translation sandbox reconciliation mode forbids submit requests');
      }
      if (submitClaimed) throw new Error('The translation sandbox blocked a duplicate submit request');
      submitClaimed = true;
      const body = await requestBody(request, init);
      parseExactRequest(body, input.contract);
      const safeUrl = await input.validateUrl(rawUrl);
      if (new URL(safeUrl).toString() !== endpoints.submitEndpoint) {
        throw new Error('The translation sandbox permits only its exact image-synthesis endpoint');
      }
      submitRequests += 1;
      let response: Response;
      try {
        response = await input.fetch(safeUrl, { ...init, redirect: 'error' });
      } catch (error) {
        requireReconciliation();
        throw error;
      }
      if (!response.ok) {
        state = isDefiniteProviderRejection(response.status)
          ? 'REJECTED'
          : 'RECONCILIATION_REQUIRED';
        return response;
      }
      const evidence = await readEvidenceJson(response);
      captureEvidence(evidence);
      const taskId = typeof evidence?.output?.task_id === 'string' ? evidence.output.task_id.trim() : '';
      if (!taskId || taskId.length > 500) {
        requireReconciliation();
        return response;
      }
      try {
        await input.onProviderTaskId?.(taskId);
      } catch (error) {
        requireReconciliation();
        throw error;
      }
      providerTaskId = taskId;
      acceptedAt = now();
      state = 'ACCEPTED';
      return response;
    }

    if (!providerTaskId || acceptedAt === null) {
      throw new Error('The translation sandbox permits polling only after one accepted submit');
    }
    const normalizedUrl = new URL(rawUrl).toString();
    const expectedTaskUrl = `${endpoints.taskEndpointBase}/${encodeURIComponent(providerTaskId)}`;
    if (normalizedUrl === expectedTaskUrl) {
      if (resultUrl || ['FAILED', 'SUCCEEDED'].includes(state)) {
        throw new Error('The translation sandbox blocked polling after a terminal task response');
      }
      if (pollRequests >= input.contract.maxPollRequests || now() - acceptedAt >= input.contract.maxPollDurationMs) {
        requireReconciliation();
        throw new Error('The translation sandbox poll budget is exhausted; reconciliation is required');
      }
      const safeUrl = await input.validateUrl(rawUrl);
      if (new URL(safeUrl).toString() !== expectedTaskUrl) {
        throw new Error('The translation sandbox permits only the accepted exact task endpoint');
      }
      pollRequests += 1;
      let response: Response;
      try {
        response = await input.fetch(safeUrl, { ...init, redirect: 'error' });
      } catch (error) {
        requireReconciliation();
        throw error;
      }
      if (!response.ok) {
        requireReconciliation();
        return response;
      }
      const evidence = await readEvidenceJson(response);
      captureEvidence(evidence);
      const providerStatus = String(evidence?.output?.task_status || '').trim().toUpperCase();
      if (PENDING_STATUSES.has(providerStatus)) {
        state = 'PENDING';
      } else if (FAILED_STATUSES.has(providerStatus)) {
        state = 'FAILED';
      } else if (providerStatus === 'SUCCEEDED') {
        const candidate = String(evidence?.output?.image_url || evidence?.output?.results?.[0]?.url || '').trim();
        if (!candidate) {
          requireReconciliation();
        } else {
          try {
            const canonicalResultUrl = new URL(candidate).toString();
            await input.onResultUrl?.(canonicalResultUrl);
            resultUrl = canonicalResultUrl;
            state = 'RESULT_READY';
          } catch {
            requireReconciliation();
          }
        }
      } else {
        requireReconciliation();
      }
      return response;
    }

    if (!resultUrl || normalizedUrl !== resultUrl) {
      throw new Error('The translation sandbox blocked a non-task or unexpected result URL');
    }
    if (resultDownloads >= maximumResultDownloads) {
      throw new Error('The translation sandbox blocked a duplicate result download');
    }
    const safeUrl = await input.validateUrl(rawUrl);
    if (new URL(safeUrl).toString() !== resultUrl) {
      throw new Error('The translation sandbox blocked an unexpected result download URL');
    }
    resultDownloads += 1;
    try {
      const response = await input.fetch(safeUrl, { ...init, redirect: 'error' });
      state = response.ok ? 'SUCCEEDED' : 'RECONCILIATION_REQUIRED';
      return response;
    } catch (error) {
      requireReconciliation();
      throw error;
    }
  };

  return {
    fetch: guardedFetch,
    getSubmitRequests: () => submitRequests,
    getPollRequests: () => pollRequests,
    getResultDownloads: () => resultDownloads,
    resumePollingAfterResultFailure: () => {
      if (
        mode !== 'RECONCILE'
        || !resultUrl
        || !['RECONCILIATION_REQUIRED', 'SUCCEEDED'].includes(state)
        || resultDownloads !== 1
      ) {
        throw new Error('The translation sandbox cannot resume polling from this recovery state');
      }
      resultUrl = null;
      acceptedAt = now();
      state = 'ACCEPTED';
    },
    getEvidence: () => ({
      state,
      providerTaskIdHash: providerTaskId ? sha256(providerTaskId) : null,
      providerRequestIdHashes: [...providerRequestIdHashes],
      usage: imageCount === null ? {} : { imageCount },
    }),
  };
}
