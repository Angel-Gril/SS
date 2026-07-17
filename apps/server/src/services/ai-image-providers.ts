import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AiImageJobError, type AiImageProvider, type AiImageProviderRequest, type AiImageProviderResult } from './ai-image-jobs.js';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  costPerImageCents?: number;
  onProviderJobCreated?: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>;
}

interface DashScopeOptions extends ProviderOptions {
  pollIntervalMs?: number;
}

export interface AiImageConnectionConfig extends ProviderOptions {
  provider: string;
}

export interface AiImageConnectionResult {
  ok: true;
  provider: string;
  model: string;
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function dashScopeApiBase(baseUrl: string) {
  const base = withoutTrailingSlash(baseUrl || 'https://dashscope.aliyuncs.com/api/v1');
  return /\/api\/v1$/i.test(base) ? base : `${base}/api/v1`;
}

function openAiApiBase(baseUrl: string) {
  return withoutTrailingSlash(baseUrl || 'https://api.openai.com/v1');
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
  });
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
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const mapped = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  if (isIP(mapped) !== 4) return false;
  const [a = 0, b = 0] = mapped.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || a >= 224;
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
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const targetUrl = fetcher === globalThis.fetch ? await validateAiImageProviderUrl(url) : validateProviderUrl(url);
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

async function readJson(response: Response): Promise<any> {
  try {
    const raw = await readBodyWithLimit(response, MAX_JSON_BYTES);
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
) {
  return fetchWithTimeout(fetcher, url, init, timeoutMs, async (response) => {
    if (!response.ok) {
      let body: any = null;
      try {
        body = await readJson(response);
      } catch {
        // HTTP status remains authoritative when an error body is malformed or oversized.
      }
      throw safeProviderError(provider, response.status, body?.code || body?.error?.code);
    }
    return readJson(response);
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
      if (request.operation === 'IMAGE_TO_IMAGE') {
        throw new AiImageJobError('UNSUPPORTED_OPERATION', 'DashScope image-to-image is not enabled for this model');
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
  const apiBase = openAiApiBase(options.baseUrl);
  return {
    name: 'openai-images',
    async generate(request: AiImageProviderRequest): Promise<AiImageProviderResult> {
      if (request.operation === 'IMAGE_TO_IMAGE') {
        throw new AiImageJobError('UNSUPPORTED_OPERATION', 'OpenAI image edits are not enabled for this model');
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

export async function testAiImageProviderConnection(config: AiImageConnectionConfig): Promise<AiImageConnectionResult> {
  const fetcher = config.fetch || globalThis.fetch;
  const timeoutMs = Math.max(1, config.timeoutMs || 10_000);
  let url: string;
  let label: string;
  if (config.provider === 'openai-images') {
    label = 'OpenAI Images';
    url = `${openAiApiBase(config.baseUrl)}/models/${encodeURIComponent(config.model)}`;
  } else if (config.provider === 'dashscope-wanx') {
    validateProviderUrl(dashScopeApiBase(config.baseUrl));
    if (!config.apiKey.trim() || !config.model.trim()) {
      throw new AiImageJobError('INVALID_PROVIDER_CONFIG', 'DashScope API key and model are required');
    }
    return { ok: true, provider: config.provider, model: config.model,
      detail: 'DashScope configuration loaded; credentials will be verified by the first image job' };
  } else {
    throw new AiImageJobError('PROVIDER_DISABLED', 'AI image provider does not support a no-cost connection test');
  }
  await requestJson(label, fetcher, config.apiKey, url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}` },
  }, timeoutMs);
  return { ok: true, provider: config.provider, model: config.model, detail: `${label} authentication and model access verified` };
}
