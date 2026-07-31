import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import sharp from 'sharp';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared/ai-image-workbench-contract';
import { AiImageJobError } from './ai-image-job-error.js';
import type {
  AiImageProvider,
  AiImageProviderRequest,
  AiImageProviderResult,
} from './ai-image-jobs.js';
import {
  isOfficialOpenAiImagesApiBase,
  normalizeOpenAiImagesApiBase,
} from './ai-image-openai-url.js';
import {
  AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT,
  AI_IMAGE_PACKY_EDIT_PROFILE,
  AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT,
  type AiImageEditMultipartDialect,
  aiImageEditMultipartFields,
} from './ai-image-packy-edit-profile.js';

export {
  isOfficialOpenAiImagesApiBase,
  normalizeOpenAiImagesApiBase,
} from './ai-image-openai-url.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type BeforeAiImageProviderDispatch = () => Promise<void>;

interface ProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  costPerImageCents?: number;
  onProviderJobCreated?: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>;
}

export interface OpenAiImageEditInput {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface OpenAiImageEditRequest {
  operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
  prompt: string;
  negativePrompt: string | null;
  width: number;
  height: number;
  model?: string;
  images: OpenAiImageEditInput[];
  mask?: OpenAiImageEditInput | null;
}

export interface OpenAiImageEditProvider {
  name: string;
  edit(request: OpenAiImageEditRequest): Promise<AiImageProviderResult>;
}

export interface OpenAiImageEditProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  costPerImageCents?: number;
  onProviderJobCreated?: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>;
  beforeProviderDispatch?: BeforeAiImageProviderDispatch;
}

interface DashScopeOptions extends ProviderOptions {
  pollIntervalMs?: number;
}

export type DashScopeImageTranslationProviderOptions = ProviderOptions;

export interface AiImageConnectionConfig extends ProviderOptions {
  provider: string;
}

export interface AiImageConnectionResult {
  ok: true;
  provider: string;
  model: string;
  verification: 'remote' | 'config-only';
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_MODEL_CATALOG_JSON_BYTES = 2 * 1024 * 1024;
const MAX_MODEL_CATALOG_ENTRIES = 10_000;
const MAX_PROVIDER_MODEL_ID_LENGTH = 500;
const MAX_OPENAI_EDIT_INPUT_IMAGES = 16;
export const MAX_OPENAI_IMAGE_EDIT_INPUT_BYTES = AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes;
export const OPENAI_COMPATIBLE_IMAGE_EDIT_SIZES = Object.freeze([
  '1024x1024', '1024x1536', '1536x1024',
]);
const OPENAI_EDIT_SIZES = new Set(OPENAI_COMPATIBLE_IMAGE_EDIT_SIZES);

export function isOpenAiCompatibleImageEditSizeSupported(width: number, height: number): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && OPENAI_EDIT_SIZES.has(`${width}x${height}`);
}

class BeforeProviderDispatchError extends Error {
  constructor(public readonly original: unknown) {
    super('AI image Provider dispatch was prevented before fetch');
    this.name = 'BeforeProviderDispatchError';
  }
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function dashScopeApiBase(baseUrl: string) {
  const base = withoutTrailingSlash(baseUrl || 'https://dashscope.aliyuncs.com/api/v1');
  return /\/api\/v1$/i.test(base) ? base : `${base}/api/v1`;
}

export function aiImageCredentialEndpointIdentity(provider: string, baseUrl: string): string | null {
  if (provider === 'openai-images' || provider === 'custom') {
    if (provider === 'custom' && !baseUrl.trim()) return null;
    try {
      return `openai-compatible:${normalizeOpenAiImagesApiBase(baseUrl)}`;
    } catch {
      return null;
    }
  }
  if (provider === 'dashscope-wanx') {
    try {
      const parsed = new URL(dashScopeApiBase(baseUrl));
      if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
      return `dashscope:${withoutTrailingSlash(parsed.toString())}`;
    } catch {
      return null;
    }
  }
  return null;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function safeProviderError(provider: string, status: number, code?: string) {
  if (status === 401 || status === 403) {
    return Object.assign(
      new AiImageJobError('PROVIDER_AUTH_FAILED', `${provider} authentication failed (HTTP ${status})`),
      { providerHttpStatus: status },
    );
  }
  const safeCode = String(code || '').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
  return Object.assign(
    new AiImageJobError(
      'PROVIDER_REQUEST_FAILED',
      `${provider} request failed (HTTP ${status}${safeCode ? `, ${safeCode}` : ''})`,
    ),
    { providerHttpStatus: status },
  );
}

function withProviderAcceptance(error: unknown, providerJobId: string, providerAcceptedAt: Date) {
  const acceptedError = error instanceof Error ? error : new Error(String(error));
  return Object.assign(acceptedError, { providerJobId, providerAcceptedAt });
}

function withProviderSubmissionUncertain(error: unknown) {
  const uncertainError = error instanceof Error ? error : new Error(String(error));
  return Object.assign(uncertainError, { providerSubmissionUncertain: true });
}

function withProviderSubmissionRejected(error: unknown) {
  const rejectedError = error instanceof Error ? error : new Error(String(error));
  return Object.assign(rejectedError, { providerSubmissionRejected: true });
}

function isDefiniteProviderRejection(error: unknown) {
  if (!(error instanceof AiImageJobError)) return false;
  if (error.code === 'INVALID_PROVIDER_URL') return true;
  const status = Number((error as AiImageJobError & { providerHttpStatus?: number }).providerHttpStatus);
  return Number.isInteger(status)
    && status >= 400
    && status < 500
    && ![408, 409, 425, 429].includes(status);
}

function normalizedProviderIdentity(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'Provider request identity must be a string');
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 500) {
    throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'Provider request identity exceeds 500 characters');
  }
  return normalized;
}

function providerHeaderIdentity(response: Response): string | null {
  return normalizedProviderIdentity(
    response.headers.get('x-request-id')
      || response.headers.get('request-id')
      || response.headers.get('openai-request-id'),
  );
}

async function requestJsonWithIdentity(
  provider: string,
  fetcher: FetchLike,
  apiKey: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  beforeProviderDispatch?: BeforeAiImageProviderDispatch,
) {
  return fetchWithTimeout(fetcher, url, init, timeoutMs, async (response) => {
    const providerAcceptedAt = new Date();
    let body: any;
    if (!response.ok) {
      try {
        body = await readJson(response);
      } catch {
        body = null;
      }
      throw safeProviderError(provider, response.status, body?.code || body?.error?.code);
    }
    try {
      body = await readJson(response);
    } catch (error) {
      let headerIdentity: string | null = null;
      try {
        headerIdentity = providerHeaderIdentity(response);
      } catch {
        throw withProviderSubmissionUncertain(error);
      }
      if (headerIdentity) throw withProviderAcceptance(error, headerIdentity, providerAcceptedAt);
      throw withProviderSubmissionUncertain(error);
    }
    let providerJobId: string | null;
    try {
      providerJobId = normalizedProviderIdentity(body?.id);
      if (!providerJobId) providerJobId = providerHeaderIdentity(response);
    } catch (error) {
      throw withProviderSubmissionUncertain(error);
    }
    return { body, providerJobId, providerAcceptedAt };
  }, beforeProviderDispatch);
}

async function recordProviderAcceptance(
  callback: ProviderOptions['onProviderJobCreated'],
  providerJobId: string,
  providerAcceptedAt: Date,
) {
  try {
    await callback?.(providerJobId, providerAcceptedAt);
  } catch {
    throw withProviderAcceptance(
      new AiImageJobError(
        'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
        'Provider task was accepted but its recovery identity could not be persisted',
      ),
      providerJobId,
      providerAcceptedAt,
    );
  }
}

function isPrivateIp(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address.replace(/^\[|\]$/g, ''));
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed.range() !== 'unicast';
  } catch {
    return true;
  }
}

function validateProviderUrl(rawUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch {
    throw new AiImageJobError('INVALID_PROVIDER_URL', 'AI image provider URL is invalid');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !hostname) {
    throw new AiImageJobError('INVALID_PROVIDER_URL', 'AI image provider URLs must use HTTPS without embedded credentials');
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || (isIP(hostname) !== 0 && isPrivateIp(hostname))) {
    throw new AiImageJobError('INVALID_PROVIDER_URL', 'AI image provider URL must not target a private network');
  }
  return parsed.toString();
}

const DASHSCOPE_OSS_RESULT_HOST_PATTERN = /^dashscope(?:-[a-z0-9-]+)?\.oss-[a-z0-9-]+\.aliyuncs\.com$/u;

/**
 * DashScope may return a temporary OSS result URL with an http scheme even
 * though the same object is available over TLS. Upgrade only the narrowly
 * characterized official DashScope OSS host shape; every other non-HTTPS URL
 * still reaches validateProviderUrl and is rejected.
 */
export function normalizeDashScopeImageResultUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (
    parsed.protocol === 'http:'
    && !parsed.username
    && !parsed.password
    && !parsed.port
    && DASHSCOPE_OSS_RESULT_HOST_PATTERN.test(parsed.hostname.toLowerCase())
  ) {
    parsed.protocol = 'https:';
    return parsed.toString();
  }
  return rawUrl;
}

export async function validateAiImageProviderUrl(
  rawUrl: string,
  resolver: (hostname: string) => Promise<Array<{ address: string }>> = (hostname) => lookup(hostname, { all: true }),
) {
  const parsed = new URL(validateProviderUrl(rawUrl));
  if (isIP(parsed.hostname) === 0) {
    const records = await resolver(parsed.hostname);
    if (!records.length || records.some((record) => isPrivateIp(record.address))) {
      throw new AiImageJobError('INVALID_PROVIDER_URL', 'AI image provider URL must not resolve to a private network');
    }
  }
  return parsed.toString();
}

async function fetchWithTimeout<T>(
  fetcher: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
  beforeFetch?: BeforeAiImageProviderDispatch,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const targetUrl = fetcher === globalThis.fetch ? await validateAiImageProviderUrl(url) : validateProviderUrl(url);
    if (beforeFetch) {
      try {
        await beforeFetch();
      } catch (error) {
        throw new BeforeProviderDispatchError(error);
      }
    }
    const response = await fetcher(targetUrl, { ...init, redirect: 'error', signal: controller.signal });
    return await consume(response);
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new AiImageJobError('PROVIDER_TIMEOUT', 'AI image provider request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiImageJobError('PROVIDER_RESPONSE_TOO_LARGE', `AI image provider response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AiImageJobError('PROVIDER_RESPONSE_TOO_LARGE', `AI image provider response exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function readJson(response: Response, maxBytes = MAX_JSON_BYTES): Promise<any> {
  try {
    const raw = await readBodyWithLimit(response, maxBytes);
    return raw.length ? JSON.parse(raw.toString('utf8')) : null;
  } catch (error) {
    if (error instanceof AiImageJobError) throw error;
    return null;
  }
}

async function requestJson(
  provider: string,
  fetcher: FetchLike,
  apiKey: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxJsonBytes = MAX_JSON_BYTES,
) {
  return fetchWithTimeout(fetcher, url, init, timeoutMs, async (response) => {
    if (!response.ok) {
      let body: any = null;
      try {
        body = await readJson(response, maxJsonBytes);
      } catch {
        // HTTP status remains authoritative when an error body is malformed or oversized.
      }
      throw safeProviderError(provider, response.status, body?.code || body?.error?.code);
    }
    return readJson(response, maxJsonBytes);
  });
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function validatedImageMime(buffer: Buffer, declaredMime: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  let detected: 'image/png' | 'image/jpeg' | 'image/webp' | null = null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    detected = 'image/png';
  } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    detected = 'image/jpeg';
  } else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    detected = 'image/webp';
  }
  const normalizedDeclared = declaredMime === 'image/jpg' ? 'image/jpeg' : declaredMime;
  if (!detected || normalizedDeclared !== detected) {
    throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'Provider result is not a supported PNG, JPEG, or WebP image');
  }
  return detected;
}

function invalidOpenAiEditInput(message: string) {
  return new AiImageJobError('INVALID_MEDIA_INPUT', message);
}

async function openAiInpaintDimensions(
  image: OpenAiImageEditInput,
  label: string,
  requiredFormat?: 'png',
) {
  try {
    const metadata = await sharp(image.buffer, {
      limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels,
    }).metadata();
    if (
      !metadata.format
      || (requiredFormat && metadata.format !== requiredFormat)
      || (!requiredFormat && !['png', 'jpeg', 'webp'].includes(metadata.format))
      || !Number.isSafeInteger(metadata.width)
      || !Number.isSafeInteger(metadata.height)
      || !metadata.width
      || !metadata.height
    ) {
      throw invalidOpenAiEditInput(
        `${label} must be a decodable${requiredFormat ? ' PNG' : ' supported'} image`,
      );
    }
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error instanceof AiImageJobError) throw error;
    throw invalidOpenAiEditInput(
      `${label} must be a decodable${requiredFormat ? ' PNG' : ' supported'} image`,
    );
  }
}

async function validateOpenAiImageEditRequest(request: OpenAiImageEditRequest) {
  if (
    request.operation !== 'IMAGE_TO_IMAGE'
    && request.operation !== 'FULL_EDIT'
    && request.operation !== 'INPAINT'
  ) {
    throw invalidOpenAiEditInput('OpenAI image edit operation is invalid');
  }
  if (!Array.isArray(request.images) || request.images.length < 1) {
    throw invalidOpenAiEditInput('OpenAI image edit requires at least one source image');
  }
  if (request.images.length > MAX_OPENAI_EDIT_INPUT_IMAGES) {
    throw invalidOpenAiEditInput(`OpenAI image edit accepts at most ${MAX_OPENAI_EDIT_INPUT_IMAGES} source images`);
  }
  const size = `${request.width}x${request.height}`;
  if (!isOpenAiCompatibleImageEditSizeSupported(request.width, request.height)) {
    throw invalidOpenAiEditInput('OpenAI image edit output size is not supported');
  }
  if (request.operation === 'INPAINT' && !request.mask) {
    throw invalidOpenAiEditInput('OpenAI inpaint requires exactly one PNG mask');
  }
  if (request.operation !== 'INPAINT' && request.mask) {
    throw invalidOpenAiEditInput('OpenAI image-to-image and full-image edit must not include a mask');
  }
  let totalBytes = 0;
  const imageMimeTypes = request.images.map((image) => {
    if (!image || !Buffer.isBuffer(image.buffer) || image.buffer.byteLength < 1) {
      throw invalidOpenAiEditInput('OpenAI image edit source bytes are invalid');
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(image.mimeType))) {
      throw invalidOpenAiEditInput('OpenAI image edit source MIME type is not supported');
    }
    totalBytes += image.buffer.byteLength;
    try {
      return validatedImageMime(image.buffer, image.mimeType);
    } catch {
      throw invalidOpenAiEditInput('OpenAI image edit source bytes do not match the declared MIME type');
    }
  });

  let maskMimeType: 'image/png' | null = null;
  if (request.mask) {
    if (!Buffer.isBuffer(request.mask.buffer) || request.mask.buffer.byteLength < 1
      || request.mask.mimeType !== 'image/png') {
      throw invalidOpenAiEditInput('OpenAI image edit mask must be a PNG image');
    }
    totalBytes += request.mask.buffer.byteLength;
    try {
      if (validatedImageMime(request.mask.buffer, request.mask.mimeType) !== 'image/png') {
        throw invalidOpenAiEditInput('OpenAI image edit mask must be a PNG image');
      }
    } catch (error) {
      if (error instanceof AiImageJobError && error.code === 'INVALID_MEDIA_INPUT') throw error;
      throw invalidOpenAiEditInput('OpenAI image edit mask bytes are not a PNG image');
    }
    maskMimeType = 'image/png';
  }
  if (totalBytes > MAX_OPENAI_IMAGE_EDIT_INPUT_BYTES) {
    throw invalidOpenAiEditInput(`OpenAI image edit inputs exceed ${MAX_OPENAI_IMAGE_EDIT_INPUT_BYTES} bytes`);
  }
  if (request.operation === 'INPAINT' && request.mask) {
    const [sourceDimensions, maskDimensions] = await Promise.all([
      openAiInpaintDimensions(request.images[0]!, 'OpenAI inpaint source'),
      openAiInpaintDimensions(request.mask, 'OpenAI inpaint mask', 'png'),
    ]);
    if (
      sourceDimensions.width !== maskDimensions.width
      || sourceDimensions.height !== maskDimensions.height
    ) {
      throw invalidOpenAiEditInput('OpenAI inpaint source and mask dimensions must match');
    }
  }
  return { imageMimeTypes, maskMimeType, size };
}

async function downloadImage(fetcher: FetchLike, url: string, timeoutMs: number) {
  return fetchWithTimeout(fetcher, url, { method: 'GET' }, timeoutMs, async (response) => {
    if (!response.ok) throw safeProviderError('AI image download', response.status);
    const mimeType = (response.headers.get('content-type') || 'image/png').split(';')[0]!.trim().toLowerCase();
    const buffer = await readBodyWithLimit(response, MAX_IMAGE_BYTES);
    return { buffer, mimeType: validatedImageMime(buffer, mimeType) };
  });
}

function normalizedCost(costPerImageCents: number | undefined, imageCount: number) {
  return Math.max(0, Math.round(Number(costPerImageCents || 0))) * imageCount;
}

export function createDashScopeWanxProvider(options: DashScopeOptions): AiImageProvider {
  const fetcher = options.fetch || globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const apiBase = dashScopeApiBase(options.baseUrl);
  return {
    name: 'dashscope-wanx',
    async generate(request: AiImageProviderRequest): Promise<AiImageProviderResult> {
      if (request.operation && request.operation !== 'TEXT_TO_IMAGE') {
        throw new AiImageJobError('UNSUPPORTED_OPERATION', `DashScope ${request.operation} is not enabled for this model`);
      }
      const deadline = Date.now() + timeoutMs;
      let submitted: any;
      try {
        submitted = await requestJson('DashScope', fetcher, options.apiKey,
          `${apiBase}/services/aigc/text2image/image-synthesis`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model: request.model || options.model,
            input: {
              prompt: request.prompt,
              ...(request.negativePrompt ? { negative_prompt: request.negativePrompt } : {}),
            },
            parameters: { n: request.count, size: `${request.width}*${request.height}` },
          }),
        }, Math.max(1, deadline - Date.now()));
      } catch (error) {
        if (isDefiniteProviderRejection(error)) throw withProviderSubmissionRejected(error);
        throw withProviderSubmissionUncertain(error);
      }
      let taskId: string | null;
      try {
        taskId = normalizedProviderIdentity(submitted?.output?.task_id);
      } catch (error) {
        throw withProviderSubmissionUncertain(error);
      }
      if (!taskId) {
        throw withProviderSubmissionUncertain(
          new AiImageJobError('INVALID_PROVIDER_RESULT', 'DashScope did not return a task id'),
        );
      }
      const providerAcceptedAt = new Date();
      await recordProviderAcceptance(options.onProviderJobCreated, taskId, providerAcceptedAt);

      try {
        let completed: any = submitted;
        while (String(completed?.output?.task_status || '').toUpperCase() !== 'SUCCEEDED') {
          const status = String(completed?.output?.task_status || '').toUpperCase();
          if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
            throw new AiImageJobError('PROVIDER_TASK_FAILED', `DashScope task failed (${status})`);
          }
          if (Date.now() >= deadline) throw new AiImageJobError('PROVIDER_TIMEOUT', 'DashScope image task timed out');
          await delay(pollIntervalMs);
          if (Date.now() >= deadline) throw new AiImageJobError('PROVIDER_TIMEOUT', 'DashScope image task timed out');
          completed = await requestJson('DashScope', fetcher, options.apiKey, `${apiBase}/tasks/${encodeURIComponent(taskId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${options.apiKey}` },
          }, Math.max(1, deadline - Date.now()));
        }

        const results = Array.isArray(completed?.output?.results) ? completed.output.results : [];
        const images = await Promise.all(results.map(async (item: any, index: number) => {
          if (!item?.url) throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'DashScope returned an image without a URL');
          const image = await downloadImage(fetcher, String(item.url), Math.max(1, deadline - Date.now()));
          return { ...image, filename: `dashscope-${taskId}-${index + 1}.${extensionForMime(image.mimeType)}` };
        }));
        return {
          images,
          providerJobId: taskId,
          actualCostCents: normalizedCost(options.costPerImageCents, images.length),
        };
      } catch (error) {
        throw withProviderAcceptance(error, taskId, providerAcceptedAt);
      }
    },
  };
}

export function createOpenAiImagesProvider(options: ProviderOptions): AiImageProvider {
  const fetcher = options.fetch || globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const apiBase = normalizeOpenAiImagesApiBase(options.baseUrl);
  return {
    name: 'openai-images',
    async generate(request: AiImageProviderRequest): Promise<AiImageProviderResult> {
      if (request.operation && request.operation !== 'TEXT_TO_IMAGE') {
        throw new AiImageJobError('UNSUPPORTED_OPERATION', `OpenAI ${request.operation} is not enabled for this model`);
      }
      let accepted: { body: any; providerJobId: string | null; providerAcceptedAt: Date };
      try {
        accepted = await requestJsonWithIdentity('OpenAI Images', fetcher, options.apiKey, `${apiBase}/images/generations`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.model || options.model,
            prompt: request.negativePrompt ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}` : request.prompt,
            n: request.count,
            size: `${request.width}x${request.height}`,
          }),
        }, timeoutMs);
      } catch (error) {
        if (error && typeof error === 'object' && 'providerJobId' in error) throw error;
        if (isDefiniteProviderRejection(error)) throw withProviderSubmissionRejected(error);
        throw withProviderSubmissionUncertain(error);
      }
      const { body, providerJobId, providerAcceptedAt } = accepted;
      if (providerJobId) {
        await recordProviderAcceptance(options.onProviderJobCreated, providerJobId, providerAcceptedAt);
      }
      const data = Array.isArray(body?.data) ? body.data : [];
      try {
        if (data.length !== request.count) {
          throw new AiImageJobError(
            'INVALID_PROVIDER_RESULT',
            `OpenAI Images returned ${data.length} images for a ${request.count}-image request`,
          );
        }
        const images = await Promise.all(data.map(async (item: any, index: number) => {
          if (item?.b64_json) {
            const buffer = Buffer.from(String(item.b64_json), 'base64');
            if (buffer.byteLength > MAX_IMAGE_BYTES) {
              throw new AiImageJobError('PROVIDER_RESPONSE_TOO_LARGE', `AI image provider response exceeds ${MAX_IMAGE_BYTES} bytes`);
            }
            return { buffer, mimeType: validatedImageMime(buffer, 'image/png'), filename: `openai-${index + 1}.png` };
          }
          if (item?.url) {
            const image = await downloadImage(fetcher, String(item.url), timeoutMs);
            return { ...image, filename: `openai-${index + 1}.${extensionForMime(image.mimeType)}` };
          }
          throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'OpenAI Images returned an empty image result');
        }));
        return {
          images,
          providerJobId,
          actualCostCents: normalizedCost(options.costPerImageCents, images.length),
        };
      } catch (error) {
        if (providerJobId) throw withProviderAcceptance(error, providerJobId, providerAcceptedAt);
        throw withProviderSubmissionUncertain(error);
      }
    },
  };
}

function createOpenAiImageEditProviderWithDialect(
  options: OpenAiImageEditProviderOptions,
  multipartDialect: AiImageEditMultipartDialect,
): OpenAiImageEditProvider {
  const fetcher = options.fetch || globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const apiBase = normalizeOpenAiImagesApiBase(options.baseUrl);
  return {
    name: 'openai-image-edits',
    async edit(request: OpenAiImageEditRequest): Promise<AiImageProviderResult> {
      let validated: Awaited<ReturnType<typeof validateOpenAiImageEditRequest>>;
      try {
        validated = await validateOpenAiImageEditRequest(request);
      } catch (error) {
        throw withProviderSubmissionRejected(error);
      }
      const requestModel = request.model || options.model;
      if (
        multipartDialect === AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT
        && requestModel !== AI_IMAGE_PACKY_EDIT_PROFILE.model
      ) {
        throw withProviderSubmissionRejected(new AiImageJobError(
          'UNSUPPORTED_OPERATION',
          'The Packy GPT-Image-2 edit profile requires its exact reviewed model',
        ));
      }
      const form = new FormData();
      form.append('model', requestModel);
      form.append(
        'prompt',
        request.negativePrompt ? `${request.prompt}\n\nAvoid: ${request.negativePrompt}` : request.prompt,
      );
      form.append('n', '1');
      form.append('size', validated.size);
      const multipartFields = aiImageEditMultipartFields(multipartDialect);
      if (multipartFields) {
        Object.entries(multipartFields).forEach(([key, value]) => form.append(key, value));
      }
      const imageFieldName = request.images.length === 1 ? 'image' : 'image[]';
      request.images.forEach((image, index) => {
        const mimeType = validated.imageMimeTypes[index]!;
        form.append(
          imageFieldName,
          new Blob([new Uint8Array(image.buffer)], { type: mimeType }),
          `image-${index + 1}.${extensionForMime(mimeType)}`,
        );
      });
      if (request.operation === 'INPAINT' && request.mask) {
        form.append(
          'mask',
          new Blob([new Uint8Array(request.mask.buffer)], { type: validated.maskMimeType! }),
          'mask.png',
        );
      }

      let accepted: { body: any; providerJobId: string | null; providerAcceptedAt: Date };
      try {
        accepted = await requestJsonWithIdentity(
          'OpenAI Images',
          fetcher,
          options.apiKey,
          `${apiBase}/images/edits`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.apiKey}` },
            body: form,
          },
          timeoutMs,
          options.beforeProviderDispatch,
        );
      } catch (error) {
        if (error instanceof BeforeProviderDispatchError) throw error.original;
        if (error && typeof error === 'object' && 'providerJobId' in error) throw error;
        if (isDefiniteProviderRejection(error)) throw withProviderSubmissionRejected(error);
        throw withProviderSubmissionUncertain(error);
      }

      const { body, providerJobId, providerAcceptedAt } = accepted;
      if (providerJobId) {
        await recordProviderAcceptance(options.onProviderJobCreated, providerJobId, providerAcceptedAt);
      }
      try {
        const data = Array.isArray(body?.data) ? body.data : [];
        if (data.length !== 1) {
          throw new AiImageJobError(
            'INVALID_PROVIDER_RESULT',
            `OpenAI Images returned ${data.length} images for a 1-image edit request`,
          );
        }
        const item = data[0];
        let image: { buffer: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
        if (item?.b64_json) {
          const buffer = Buffer.from(String(item.b64_json), 'base64');
          if (buffer.byteLength > MAX_IMAGE_BYTES) {
            throw new AiImageJobError(
              'PROVIDER_RESPONSE_TOO_LARGE',
              `AI image provider response exceeds ${MAX_IMAGE_BYTES} bytes`,
            );
          }
          image = { buffer, mimeType: validatedImageMime(buffer, 'image/png') };
        } else if (item?.url) {
          image = await downloadImage(fetcher, String(item.url), timeoutMs);
        } else {
          throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'OpenAI Images returned an empty image edit result');
        }
        return {
          images: [{
            ...image,
            filename: `openai-edit-1.${extensionForMime(image.mimeType)}`,
          }],
          providerJobId,
          actualCostCents: normalizedCost(options.costPerImageCents, 1),
        };
      } catch (error) {
        if (providerJobId) throw withProviderAcceptance(error, providerJobId, providerAcceptedAt);
        throw withProviderSubmissionUncertain(error);
      }
    },
  };
}

export function createOpenAiImageEditProvider(
  options: OpenAiImageEditProviderOptions,
): OpenAiImageEditProvider {
  return createOpenAiImageEditProviderWithDialect(
    options,
    AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT,
  );
}

export function createPackyGptImage2EditProvider(
  options: OpenAiImageEditProviderOptions,
): OpenAiImageEditProvider {
  if (normalizeOpenAiImagesApiBase(options.baseUrl) !== AI_IMAGE_PACKY_EDIT_PROFILE.apiBase) {
    throw new AiImageJobError(
      'INVALID_PROVIDER_URL',
      'The Packy GPT-Image-2 edit profile requires its exact reviewed API base',
    );
  }
  if (options.model !== AI_IMAGE_PACKY_EDIT_PROFILE.model) {
    throw new AiImageJobError(
      'UNSUPPORTED_OPERATION',
      'The Packy GPT-Image-2 edit profile requires its exact reviewed model',
    );
  }
  return createOpenAiImageEditProviderWithDialect(
    options,
    AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT,
  );
}

/**
 * DashScope's qwen-mt-image operation is intentionally separate from the
 * Wanx text-to-image adapter. It accepts a public source URL, returns a task
 * identity, and exposes a temporary result URL only from the poll response.
 */
export function createDashScopeImageTranslationProvider(
  options: DashScopeImageTranslationProviderOptions,
): import('./ai-image-translation.js').AiImageTranslationProvider {
  const fetcher = options.fetch || globalThis.fetch;
  const timeoutMs = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const apiBase = dashScopeApiBase(options.baseUrl);
  return {
    name: 'dashscope-qwen-mt-image',
    async submit(request, onAccepted) {
      const model = request.model || options.model;
      if (model !== 'qwen-mt-image') {
        throw new AiImageJobError('UNSUPPORTED_PROVIDER_MODEL', 'DashScope image translation requires qwen-mt-image');
      }
      let imageUrl: string;
      try {
        imageUrl = fetcher === globalThis.fetch
          ? await validateAiImageProviderUrl(request.imageUrl)
          : validateProviderUrl(request.imageUrl);
      } catch (error) {
        throw withProviderSubmissionRejected(error instanceof AiImageJobError
          ? error
          : new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation source URL is invalid'));
      }
      if (request.imageSegment !== false) {
        throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation segmentation must remain disabled');
      }
      let terminologies: Array<{ src: string; tgt: string }>;
      try {
        const rawTerminologies = Array.isArray(request.terminologies) ? request.terminologies : [];
        const bySource = new Map<string, { src: string; tgt: string }>();
        for (const entry of rawTerminologies) {
          const src = String(entry?.src || '').trim();
          const tgt = String(entry?.tgt || '').trim();
          const key = src.toLocaleLowerCase();
          const previous = bySource.get(key);
          if (previous && previous.tgt.toLocaleLowerCase() !== tgt.toLocaleLowerCase()) {
            throw new AiImageJobError('INVALID_MEDIA_INPUT', 'DashScope terminology contains conflicting source terms');
          }
          if (!previous) bySource.set(key, { src, tgt });
        }
        terminologies = [...bySource.values()];
      } catch (error) {
        throw withProviderSubmissionRejected(error);
      }
      if (
        !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/iu.test(request.sourceLanguage)
        || !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/iu.test(request.targetLanguage)
        || request.sourceLanguage.toLowerCase() === request.targetLanguage.toLowerCase()
        || !request.domainHint.trim()
        || Buffer.byteLength(request.domainHint, 'utf8') > 16_000
        || terminologies.length > 50
        || terminologies.some((term) => (
          !term.src.trim() || !term.tgt.trim() || term.src.length > 120 || term.tgt.length > 120
        ))
      ) {
        throw withProviderSubmissionRejected(
          new AiImageJobError('INVALID_MEDIA_INPUT', 'DashScope image translation options are invalid'),
        );
      }
      let submitted: any;
      try {
        submitted = await requestJson('DashScope image translation', fetcher, options.apiKey,
          `${apiBase}/services/aigc/image2image/image-synthesis`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              'X-DashScope-Async': 'enable',
            },
            body: JSON.stringify({
              model,
              input: {
                image_url: imageUrl,
                source_lang: request.sourceLanguage,
                target_lang: request.targetLanguage,
                ext: {
                  domainHint: request.domainHint,
                  terminologies,
                  config: { imageSegment: false },
                },
              },
            }),
          }, timeoutMs);
      } catch (error) {
        if (isDefiniteProviderRejection(error)) throw withProviderSubmissionRejected(error);
        throw withProviderSubmissionUncertain(error);
      }
      let providerJobId: string | null;
      try {
        providerJobId = normalizedProviderIdentity(submitted?.output?.task_id);
      } catch (error) {
        throw withProviderSubmissionUncertain(error);
      }
      if (!providerJobId) {
        throw withProviderSubmissionUncertain(
          new AiImageJobError('INVALID_PROVIDER_RESULT', 'DashScope image translation did not return a task id'),
        );
      }
      const providerAcceptedAt = new Date();
      try {
        await onAccepted(providerJobId, providerAcceptedAt);
      } catch (error) {
        throw withProviderAcceptance(error, providerJobId, providerAcceptedAt);
      }
      return { providerJobId, providerAcceptedAt };
    },
    async poll(providerJobId) {
      const taskId = normalizedProviderIdentity(providerJobId);
      if (!taskId) throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'DashScope task id is empty');
      let body: any;
      try {
        body = await requestJson('DashScope image translation', fetcher, options.apiKey,
          `${apiBase}/tasks/${encodeURIComponent(taskId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${options.apiKey}` },
          }, timeoutMs);
      } catch (error) {
        throw withProviderAcceptance(error, taskId, new Date());
      }
      const status = String(body?.output?.task_status || '').trim().toUpperCase();
      if (['PENDING', 'RUNNING', 'QUEUED', 'PROCESSING', 'WAITING'].includes(status)) {
        return { status: 'PENDING' as const, providerStatus: status || 'PENDING' };
      }
      if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED' || status === 'UNKNOWN') {
        throw Object.assign(
          new AiImageJobError('PROVIDER_TASK_FAILED', `DashScope image translation task failed (${status || 'UNKNOWN'})`),
          { providerJobId: taskId },
        );
      }
      if (status !== 'SUCCEEDED') {
        throw Object.assign(
          new AiImageJobError('INVALID_PROVIDER_RESULT', 'DashScope image translation returned an unknown task status'),
          { providerJobId: taskId },
        );
      }
      const resultUrl = String(body?.output?.image_url || body?.output?.results?.[0]?.url || '').trim();
      if (!resultUrl) {
        throw Object.assign(
          new AiImageJobError('INVALID_PROVIDER_RESULT', 'DashScope image translation returned no result URL'),
          { providerJobId: taskId },
        );
      }
      try {
        const image = await downloadImage(
          fetcher,
          normalizeDashScopeImageResultUrl(resultUrl),
          timeoutMs,
        );
        return {
          status: 'SUCCEEDED' as const,
          providerStatus: 'SUCCEEDED' as const,
          image: {
            ...image,
            filename: `dashscope-translation-${taskId}.${extensionForMime(image.mimeType)}`,
          },
          actualCostCents: normalizedCost(options.costPerImageCents, 1),
        };
      } catch (error) {
        throw withProviderAcceptance(error, taskId, new Date());
      }
    },
  };
}

export async function testAiImageProviderConnection(config: AiImageConnectionConfig): Promise<AiImageConnectionResult> {
  const fetcher = config.fetch || globalThis.fetch;
  const timeoutMs = Math.max(1, config.timeoutMs || 10_000);
  const configuredModel = config.model.trim();
  if (!config.apiKey.trim() || config.model !== configuredModel || !configuredModel
    || configuredModel.length > MAX_PROVIDER_MODEL_ID_LENGTH) {
    throw new AiImageJobError(
      'INVALID_PROVIDER_CONFIG',
      'AI image provider API key and a valid model are required',
    );
  }
  let url: string;
  let label: string;
  if (config.provider === 'openai-images' || config.provider === 'custom') {
    if (config.provider === 'custom' && !config.baseUrl.trim()) {
      throw new AiImageJobError(
        'INVALID_PROVIDER_CONFIG',
        'Custom OpenAI-compatible image provider requires an explicit base URL',
      );
    }
    if (config.provider === 'openai-images' && !isOfficialOpenAiImagesApiBase(config.baseUrl)) {
      throw new AiImageJobError(
        'INVALID_PROVIDER_CONFIG',
        'OpenAI Images requires the official https://api.openai.com/v1 API base; use custom for relays',
      );
    }
    label = config.provider === 'custom' ? 'OpenAI-compatible Images' : 'OpenAI Images';
    url = `${normalizeOpenAiImagesApiBase(config.baseUrl)}/models`;
  } else if (config.provider === 'dashscope-wanx') {
    validateProviderUrl(dashScopeApiBase(config.baseUrl));
    if (!config.apiKey.trim() || !config.model.trim()) {
      throw new AiImageJobError('INVALID_PROVIDER_CONFIG', 'DashScope API key and model are required');
    }
    return { ok: true, provider: config.provider, model: config.model, verification: 'config-only',
      detail: 'DashScope configuration loaded; credentials will be verified by the first image job' };
  } else {
    throw new AiImageJobError('PROVIDER_DISABLED', 'AI image provider does not support a no-cost connection test');
  }
  const catalog = await requestJson(label, fetcher, config.apiKey, url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}` },
  }, timeoutMs, MAX_MODEL_CATALOG_JSON_BYTES);
  const models = Array.isArray(catalog?.data) ? catalog.data : [];
  if (models.length > MAX_MODEL_CATALOG_ENTRIES) {
    throw new AiImageJobError(
      'PROVIDER_RESPONSE_TOO_LARGE',
      'AI image provider model catalog contains too many entries',
    );
  }
  const listed = models.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const model = entry as Record<string, unknown>;
    const identifier = typeof model.id === 'string'
      ? model.id
      : typeof model.model === 'string' ? model.model : '';
    return identifier.length <= MAX_PROVIDER_MODEL_ID_LENGTH && identifier === configuredModel;
  });
  if (!configuredModel || catalog?.error || !listed) {
    throw new AiImageJobError(
      'UNSUPPORTED_PROVIDER_MODEL',
      `${label} did not list the configured image model`,
    );
  }
  return {
    ok: true,
    provider: config.provider,
    model: configuredModel,
    verification: 'remote',
    detail: `${label} authentication and model catalog access verified; generation and editing remain unverified`,
  };
}
