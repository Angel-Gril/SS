import { createHash } from 'node:crypto';
import {
  AI_IMAGE_WANX21_EDIT_MODEL,
  AI_IMAGE_WANX21_EDIT_PROFILE,
  aiImageWanx21EditFunction,
  aiImageWanx21EditOperationForRequestProfile,
  type AiImageWanx21EditFunction,
  type AiImageWanx21EditOperation,
} from './ai-image-wanx-edit-profile.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AiImageWanx21EditSandboxContract {
  submitEndpoint: string;
  taskEndpointBase: string;
  operation: AiImageWanx21EditOperation;
  requestProfile: string;
  providerFunction: AiImageWanx21EditFunction;
  model: string;
  promptSha256: string;
  sourceSha256: string;
  transportMaskSha256: string | null;
  n: 1;
  maxPollRequests: number;
  maxPollDurationMs: number;
}

export type AiImageWanx21EditSandboxState =
  | 'READY'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RECONCILIATION_REQUIRED';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/u;
const PENDING_STATUSES = new Set(['PENDING', 'RUNNING']);
const FAILED_STATUSES = new Set(['FAILED', 'CANCELED', 'CANCELLED', 'UNKNOWN']);
// Keep this aligned with the Provider JSON reader so a valid accepted task is
// still visible to the sandbox guard before the adapter consumes the response.
const MAX_EVIDENCE_JSON_BYTES = 32 * 1024 * 1024;

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function definiteRejection(status: number) {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

function parseDataUrl(value: unknown, expectedSha256: string) {
  if (typeof value !== 'string') return false;
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return false;
  const encoded = match[2]!;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length > 0
    && bytes.length <= AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes
    && bytes.toString('base64') === encoded
    && sha256(bytes) === expectedSha256;
}

function validateContract(contract: AiImageWanx21EditSandboxContract) {
  const submitEndpoint = new URL(contract.submitEndpoint).toString();
  const taskEndpointBase = new URL(contract.taskEndpointBase).toString().replace(/\/$/u, '');
  const submitUrl = new URL(submitEndpoint);
  const taskUrl = new URL(`${taskEndpointBase}/`);
  const expectedOperation = aiImageWanx21EditOperationForRequestProfile(contract.requestProfile);
  if (
    submitUrl.protocol !== 'https:'
    || taskUrl.protocol !== 'https:'
    || submitUrl.origin !== taskUrl.origin
    || !submitUrl.pathname.endsWith('/services/aigc/image2image/image-synthesis')
    || !taskUrl.pathname.endsWith('/api/v1/tasks/')
    || contract.model !== AI_IMAGE_WANX21_EDIT_MODEL
    || expectedOperation !== contract.operation
    || contract.providerFunction !== aiImageWanx21EditFunction(contract.operation)
    || !SHA256_PATTERN.test(contract.promptSha256)
    || !SHA256_PATTERN.test(contract.sourceSha256)
    || (contract.operation === 'INPAINT') !== Boolean(contract.transportMaskSha256)
    || (contract.transportMaskSha256 !== null
      && !SHA256_PATTERN.test(contract.transportMaskSha256))
    || contract.n !== 1
    || !Number.isSafeInteger(contract.maxPollRequests)
    || contract.maxPollRequests < 1
    || contract.maxPollRequests > AI_IMAGE_WANX21_EDIT_PROFILE.maximumPollRequests
    || !Number.isSafeInteger(contract.maxPollDurationMs)
    || contract.maxPollDurationMs < 1_000
    || contract.maxPollDurationMs > AI_IMAGE_WANX21_EDIT_PROFILE.maximumPollDurationMs
  ) {
    throw new Error('The Wanx edit sandbox contract is invalid');
  }
  return { submitEndpoint, taskEndpointBase };
}

async function requestBody(request: string | URL | Request, init?: RequestInit) {
  if (typeof init?.body === 'string') return init.body;
  if (request instanceof Request) return request.clone().text();
  return '';
}

function parseExactRequest(raw: string, contract: AiImageWanx21EditSandboxContract) {
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    body = parsed as Record<string, unknown>;
  } catch {
    throw new Error('The Wanx edit sandbox requires a JSON create body');
  }
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input)
    ? body.input as Record<string, unknown>
    : {};
  const parameters = body.parameters
    && typeof body.parameters === 'object'
    && !Array.isArray(body.parameters)
    ? body.parameters as Record<string, unknown>
    : {};
  const inputKeys = contract.operation === 'INPAINT'
    ? ['function', 'prompt', 'base_image_url', 'mask_image_url']
    : ['function', 'prompt', 'base_image_url'];
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (
    !exactKeys(body, ['model', 'input', 'parameters'])
    || !exactKeys(input, inputKeys)
    || !exactKeys(parameters, ['n'])
    || body.model !== contract.model
    || input.function !== contract.providerFunction
    || sha256(prompt) !== contract.promptSha256
    || !parseDataUrl(input.base_image_url, contract.sourceSha256)
    || (contract.operation === 'INPAINT'
      ? !parseDataUrl(input.mask_image_url, contract.transportMaskSha256!)
      : Object.hasOwn(input, 'mask_image_url'))
    || parameters.n !== 1
  ) {
    throw new Error('The Wanx edit sandbox blocked an unexpected Wanx create contract');
  }
}

async function readEvidenceJson(response: Response) {
  const reader = response.clone().body?.getReader();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_EVIDENCE_JSON_BYTES) {
      // The response clone is a tee. Awaiting cancellation here can wait for
      // the untouched original branch, which the adapter reads after guard
      // return. Cancellation is best-effort and must not block recovery.
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

function bearerHeader(headers: Headers) {
  const authorization = headers.get('authorization') || '';
  return /^Bearer\s+\S+$/u.test(authorization);
}

export function createAiImageWanx21EditSandboxFetchGuard(input: {
  contract: AiImageWanx21EditSandboxContract;
  validateUrl: (url: string) => Promise<string>;
  fetch: FetchLike;
  beforeCreate: () => void | Promise<void>;
  toResultDownloadUrl: (rawResultUrl: string) => string;
  onProviderTaskId?: (providerTaskId: string) => Promise<void>;
  onRawResultUrl?: (rawResultUrl: string) => Promise<void>;
  now?: () => number;
}) {
  if (typeof input.beforeCreate !== 'function') {
    throw new Error('The Wanx edit sandbox requires a pre-create approval check');
  }
  const endpoints = validateContract(input.contract);
  const now = input.now || Date.now;
  let submitClaimed = false;
  let createRequests = 0;
  let pollRequests = 0;
  let resultDownloads = 0;
  let state: AiImageWanx21EditSandboxState = 'READY';
  let providerHttpStatus: number | null = null;
  let providerTaskId: string | null = null;
  let acceptedAt: number | null = null;
  let resultDownloadUrl: string | null = null;
  let providerStatus: string | null = null;
  let imageCount: number | null = null;
  const providerRequestIdHashes: string[] = [];

  function requireReconciliation() {
    state = 'RECONCILIATION_REQUIRED';
  }

  function captureRequestId(body: Record<string, any> | null) {
    const requestId = typeof body?.request_id === 'string' ? body.request_id.trim() : '';
    if (requestId && requestId.length <= 500) {
      const digest = sha256(requestId);
      if (!providerRequestIdHashes.includes(digest)) providerRequestIdHashes.push(digest);
    }
  }

  const guardedFetch: FetchLike = async (request, init) => {
    const rawUrl = request instanceof Request ? request.url : String(request);
    const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
    if (method !== 'POST' && method !== 'GET') {
      throw new Error('The Wanx edit sandbox permits only submit, poll and result download requests');
    }

    if (method === 'POST') {
      if (submitClaimed) throw new Error('The Wanx edit sandbox blocked a duplicate submit request');
      const headers = new Headers(init?.headers || (request instanceof Request ? request.headers : undefined));
      if (
        !bearerHeader(headers)
        || headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
        || headers.get('x-dashscope-async')?.trim().toLowerCase() !== 'enable'
      ) {
        throw new Error('The Wanx edit sandbox requires authorization, JSON and the async header');
      }
      parseExactRequest(await requestBody(request, init), input.contract);
      const safeUrl = await input.validateUrl(rawUrl);
      if (new URL(safeUrl).toString() !== endpoints.submitEndpoint) {
        throw new Error('The Wanx edit sandbox permits only its exact image-synthesis endpoint');
      }
      await input.beforeCreate();
      submitClaimed = true;
      createRequests = 1;
      let response: Response;
      try {
        response = await input.fetch(safeUrl, { ...init, redirect: 'error' });
      } catch (error) {
        requireReconciliation();
        throw error;
      }
      providerHttpStatus = response.status;
      if (!response.ok) {
        state = definiteRejection(response.status) ? 'REJECTED' : 'RECONCILIATION_REQUIRED';
        return response;
      }
      const evidence = await readEvidenceJson(response);
      captureRequestId(evidence);
      const taskId = typeof evidence?.output?.task_id === 'string'
        ? evidence.output.task_id.trim()
        : '';
      const taskStatus = String(evidence?.output?.task_status || '').trim().toUpperCase();
      if (!taskId || taskId.length > 500) {
        requireReconciliation();
        return response;
      }
      providerTaskId = taskId;
      providerStatus = taskStatus;
      acceptedAt = now();
      try {
        await input.onProviderTaskId?.(taskId);
      } catch (error) {
        requireReconciliation();
        throw error;
      }
      if (PENDING_STATUSES.has(taskStatus)) {
        state = 'ACCEPTED';
      } else {
        // Keep a valid task identity for billing/recovery correlation even when
        // the provider returns a terminal or otherwise unexpected status inline.
        requireReconciliation();
      }
      return response;
    }

    if (state === 'RECONCILIATION_REQUIRED') {
      throw new Error('The Wanx edit sandbox requires read-only reconciliation for this task');
    }
    if (!providerTaskId || acceptedAt === null) {
      throw new Error('The Wanx edit sandbox permits polling only after one accepted submit');
    }
    const normalizedUrl = new URL(rawUrl).toString();
    const expectedTaskUrl = `${endpoints.taskEndpointBase}/${encodeURIComponent(providerTaskId)}`;
    if (normalizedUrl === expectedTaskUrl) {
      if (resultDownloadUrl || providerStatus === 'SUCCEEDED' || FAILED_STATUSES.has(providerStatus || '')) {
        throw new Error('The Wanx edit sandbox blocked polling after a terminal task response');
      }
      if (
        pollRequests >= input.contract.maxPollRequests
        || now() - acceptedAt >= input.contract.maxPollDurationMs
      ) {
        requireReconciliation();
        throw new Error('The Wanx edit sandbox poll budget is exhausted; reconciliation is required');
      }
      const headers = new Headers(init?.headers || (request instanceof Request ? request.headers : undefined));
      if (!bearerHeader(headers) || init?.body) {
        throw new Error('The Wanx edit sandbox poll request is invalid');
      }
      const safeUrl = await input.validateUrl(rawUrl);
      if (new URL(safeUrl).toString() !== expectedTaskUrl) {
        throw new Error('The Wanx edit sandbox permits only the accepted exact task endpoint');
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
      captureRequestId(evidence);
      const responseTaskId = typeof evidence?.output?.task_id === 'string'
        ? evidence.output.task_id.trim()
        : '';
      providerStatus = String(evidence?.output?.task_status || '').trim().toUpperCase();
      if (responseTaskId !== providerTaskId) {
        requireReconciliation();
      } else if (PENDING_STATUSES.has(providerStatus)) {
        state = 'ACCEPTED';
      } else if (FAILED_STATUSES.has(providerStatus)) {
        requireReconciliation();
      } else if (providerStatus === 'SUCCEEDED') {
        const results = Array.isArray(evidence?.output?.results) ? evidence.output.results : [];
        const metrics = evidence?.output?.task_metrics;
        imageCount = Number.isSafeInteger(evidence?.usage?.image_count)
          ? evidence!.usage.image_count
          : null;
        const candidate = results.length === 1 && typeof results[0]?.url === 'string'
          ? results[0].url.trim()
          : '';
        if (
          !candidate
          || metrics?.TOTAL !== 1
          || metrics?.SUCCEEDED !== 1
          || metrics?.FAILED !== 0
          || imageCount !== 1
        ) {
          requireReconciliation();
        } else {
          try {
            const canonicalRawResultUrl = new URL(candidate).toString();
            await input.onRawResultUrl?.(canonicalRawResultUrl);
            const normalizedResultUrl = new URL(
              input.toResultDownloadUrl(canonicalRawResultUrl),
            ).toString();
            const safeResultUrl = await input.validateUrl(normalizedResultUrl);
            if (new URL(safeResultUrl).toString() !== normalizedResultUrl) {
              throw new Error('Unexpected normalized result URL');
            }
            resultDownloadUrl = normalizedResultUrl;
          } catch {
            requireReconciliation();
          }
        }
      } else {
        requireReconciliation();
      }
      return response;
    }

    if (!resultDownloadUrl || normalizedUrl !== resultDownloadUrl) {
      throw new Error('The Wanx edit sandbox blocked a non-task or unexpected result URL');
    }
    if (resultDownloads >= 1) {
      throw new Error('The Wanx edit sandbox blocked a duplicate result download');
    }
    const headers = new Headers(init?.headers || (request instanceof Request ? request.headers : undefined));
    if (headers.has('authorization')) {
      throw new Error('Wanx result storage must not receive Provider authorization');
    }
    if (init?.credentials && init.credentials !== 'omit') {
      throw new Error('Wanx result storage must not receive Provider credentials');
    }
    const safeUrl = await input.validateUrl(rawUrl);
    if (new URL(safeUrl).toString() !== resultDownloadUrl) {
      throw new Error('The Wanx edit sandbox blocked an unexpected result download URL');
    }
    resultDownloads += 1;
    try {
      const response = await input.fetch(safeUrl, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
      });
      if (!response.ok) requireReconciliation();
      return response;
    } catch (error) {
      requireReconciliation();
      throw error;
    }
  };

  return {
    fetch: guardedFetch,
    getCreateRequests: () => createRequests,
    getFollowupGetRequests: () => pollRequests + resultDownloads,
    getPollRequests: () => pollRequests,
    getResultDownloads: () => resultDownloads,
    getEvidence: () => ({
      state,
      providerRequestIdHash: providerTaskId ? sha256(providerTaskId) : null,
      providerHttpStatus,
      providerTaskIdHash: providerTaskId ? sha256(providerTaskId) : null,
      providerRequestIdHashes: [...providerRequestIdHashes],
      providerStatus,
      usage: imageCount === null ? {} : { imageCount },
    }),
  };
}
