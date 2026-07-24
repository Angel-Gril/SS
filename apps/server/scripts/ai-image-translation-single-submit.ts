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
import {
  createDashScopeImageTranslationProvider,
  validateAiImageProviderUrl,
} from '../src/services/ai-image-providers.js';
import {
  claimAiImageTranslationSandboxOperation,
  createAiImageTranslationSandboxFetchGuard,
  type AiImageTranslationSandboxContract,
} from '../src/services/ai-image-translation-sandbox-guard.js';

const CONFIRMATION = 'I_ACCEPT_ONE_PAID_IMAGE_TRANSLATION_REQUEST';
const OFFICIAL_DASHSCOPE_HOST = 'dashscope.aliyuncs.com';
const MAX_POLL_REQUESTS = 30;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;
const PROVIDER_REQUEST_TIMEOUT_MS = 90_000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const FULL_GIT_OID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type DnsResolver = (hostname: string) => Promise<Array<{ address: string }>>;
type Delay = (milliseconds: number) => Promise<void>;
type SandboxMode = 'SUBMIT' | 'RECONCILE';

interface SourceVerification {
  verified: true;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  etagSha256: string | null;
  cacheControlImmutable: boolean;
}

export interface AiImageTranslationSingleSubmitOptions {
  environment?: NodeJS.ProcessEnv;
  outputDirectory?: string;
  repositoryRoot?: string;
  resolveDns?: DnsResolver;
  fetch?: FetchLike;
  now?: () => number;
  delay?: Delay;
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  const value = String(environment[name] || '').trim();
  if (!value) throw Object.assign(new Error(`${name} is required`), { code: 'SANDBOX_CONFIG_INVALID' });
  return value;
}

function normalizeDashScopeApiBase(rawValue: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw Object.assign(new Error('DashScope base URL is invalid'), { code: 'SANDBOX_CONFIG_INVALID' });
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw Object.assign(new Error('DashScope base URL must be credential-free HTTPS'), {
      code: 'SANDBOX_CONFIG_INVALID',
    });
  }
  if (parsed.origin !== `https://${OFFICIAL_DASHSCOPE_HOST}`) {
    throw Object.assign(new Error('DashScope base URL must use the exact official HTTPS origin'), {
      code: 'SANDBOX_HOST_INVALID',
    });
  }
  const path = parsed.pathname.replace(/\/+$/u, '');
  if (path && path !== '/api/v1') {
    throw Object.assign(new Error('DashScope base URL path must be / or /api/v1'), {
      code: 'SANDBOX_CONFIG_INVALID',
    });
  }
  parsed.pathname = '/api/v1';
  return parsed.toString().replace(/\/$/u, '');
}

function normalizedLanguage(value: string, field: string) {
  const language = value.trim().toLowerCase();
  if (!/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(language)) {
    throw Object.assign(new Error(`${field} is invalid`), { code: 'SANDBOX_CONFIG_INVALID' });
  }
  return language;
}

function parseTerminologies(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw || '[]');
  } catch {
    throw Object.assign(new Error('Translation terminology JSON is invalid'), { code: 'SANDBOX_CONFIG_INVALID' });
  }
  if (!Array.isArray(value) || value.length > 50) {
    throw Object.assign(new Error('Translation terminology list is invalid'), { code: 'SANDBOX_CONFIG_INVALID' });
  }
  const bySource = new Map<string, { src: string; tgt: string }>();
  for (const candidate of value) {
    const entry = candidate && typeof candidate === 'object'
      ? candidate as Record<string, unknown>
      : {};
    if (Object.keys(entry).sort().join(',') !== 'src,tgt') {
      throw Object.assign(new Error('Translation terminology entry is invalid'), { code: 'SANDBOX_CONFIG_INVALID' });
    }
    const src = String(entry.src || '').trim();
    const tgt = String(entry.tgt || '').trim();
    if (!src || !tgt || src.length > 120 || tgt.length > 120) {
      throw Object.assign(new Error('Translation terminology entry is invalid'), { code: 'SANDBOX_CONFIG_INVALID' });
    }
    const key = src.toLocaleLowerCase();
    const previous = bySource.get(key);
    if (previous && previous.tgt.toLocaleLowerCase() !== tgt.toLocaleLowerCase()) {
      throw Object.assign(new Error('Translation terminology sources conflict'), { code: 'SANDBOX_CONFIG_INVALID' });
    }
    if (!previous) bySource.set(key, { src, tgt });
  }
  return [...bySource.values()];
}

async function resolvePublicDns(hostname: string) {
  const records: Array<{ address: string }> = [];
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
    if (!response.ok) throw Object.assign(new Error('Public DNS lookup failed'), { code: 'DNS_VALIDATION_FAILED' });
    const body = await response.json() as { Answer?: Array<{ type?: number; data?: string }> };
    for (const answer of body.Answer || []) {
      if ((answer.type === 1 || answer.type === 28) && typeof answer.data === 'string') {
        records.push({ address: answer.data });
      }
    }
  }
  if (!records.length) {
    throw Object.assign(new Error('Public DNS lookup returned no address'), { code: 'DNS_VALIDATION_FAILED' });
  }
  return [...new Map(records.map((record) => [record.address, record])).values()];
}

function safeFailureCode(error: unknown) {
  const raw = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return raw.replace(/[^A-Z0-9_.-]/giu, '').slice(0, 80) || 'SANDBOX_FAILED';
}

async function defaultDelay(milliseconds: number) {
  await new Promise<void>((done) => setTimeout(done, Math.max(0, milliseconds)));
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

async function appendRecoveryEvent(path: string, event: Record<string, unknown>) {
  await ensurePrivateDirectory(dirname(path));
  const handle = await open(path, 'a', 0o600);
  try {
    await tolerateWindowsMode(() => chmod(path, 0o600));
    await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function readBoundedBody(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw Object.assign(new Error('Remote source exceeds the sandbox byte limit'), {
      code: 'SANDBOX_SOURCE_TOO_LARGE',
    });
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw Object.assign(new Error('Remote source response has no body'), { code: 'SANDBOX_SOURCE_INVALID' });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw Object.assign(new Error('Remote source exceeds the sandbox byte limit'), {
        code: 'SANDBOX_SOURCE_TOO_LARGE',
      });
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw Object.assign(new Error('Remote source is empty'), { code: 'SANDBOX_SOURCE_INVALID' });
  return Buffer.concat(chunks, total);
}

async function verifyRemoteSource(input: {
  url: string;
  expectedSha256: string;
  fetch: FetchLike;
}) : Promise<SourceVerification> {
  const response = await input.fetch(input.url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw Object.assign(new Error('Remote source GET failed'), { code: 'SANDBOX_SOURCE_HTTP_FAILED' });
  }
  const mimeType = String(response.headers.get('content-type') || '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw Object.assign(new Error('Remote source MIME type is invalid'), { code: 'SANDBOX_SOURCE_INVALID' });
  }
  const bytes = await readBoundedBody(response, MAX_SOURCE_BYTES);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== input.expectedSha256) {
    throw Object.assign(new Error('Remote source SHA-256 does not match the local pinned bytes'), {
      code: 'SANDBOX_SOURCE_HASH_MISMATCH',
    });
  }
  const metadata = await sharp(bytes).metadata();
  const detectedMime: SourceVerification['mimeType'] | null = metadata.format === 'png' ? 'image/png'
    : metadata.format === 'jpeg' ? 'image/jpeg'
      : metadata.format === 'webp' ? 'image/webp' : null;
  if (
    detectedMime !== mimeType
    || !metadata.width
    || !metadata.height
    || metadata.width > 4096
    || metadata.height > 4096
  ) {
    throw Object.assign(new Error('Remote source image dimensions or format are invalid'), {
      code: 'SANDBOX_SOURCE_INVALID',
    });
  }
  const etag = String(response.headers.get('etag') || '').trim();
  return {
    verified: true,
    mimeType: detectedMime,
    width: metadata.width,
    height: metadata.height,
    bytes: bytes.byteLength,
    sha256: actualSha256,
    etagSha256: etag && etag.length <= 4096 ? sha256(etag) : null,
    cacheControlImmutable: /(?:^|,)\s*immutable(?:\s*(?:,|$))/iu
      .test(String(response.headers.get('cache-control') || '')),
  };
}

function createPinnedTransport(options: AiImageTranslationSingleSubmitOptions) {
  const pinnedDns = new Map<string, Array<{ address: string; family: 4 | 6; ttl: number }>>();
  const baseResolver = options.resolveDns || resolvePublicDns;
  const resolveAndPin: DnsResolver = async (hostname) => {
    const records = await baseResolver(hostname);
    const pinned = records.map((record) => {
      const family = isIP(record.address);
      if (family !== 4 && family !== 6) {
        throw Object.assign(new Error('DNS resolver returned an invalid address'), { code: 'DNS_VALIDATION_FAILED' });
      }
      return { address: record.address, family, ttl: 60 } as const;
    });
    pinnedDns.set(hostname.toLowerCase(), pinned);
    return records;
  };
  const dispatcher = new Agent().compose(interceptors.dns({
    affinity: 4,
    lookup(origin, _lookupOptions, callback) {
      const records = pinnedDns.get(origin.hostname.toLowerCase());
      if (!records?.length) {
        callback(Object.assign(new Error('Sandbox DNS was not pinned before connect'), { code: 'ENOTFOUND' }), []);
        return;
      }
      callback(null, records);
    },
  }));
  const fetch: FetchLike = options.fetch || ((request, init) => undiciFetch(request as any, {
    ...(init as any),
    dispatcher,
  })) as FetchLike;
  return {
    fetch,
    validateUrl: (url: string) => validateAiImageProviderUrl(url, resolveAndPin),
    close: () => dispatcher.close(),
  };
}

interface StoredTranslationIntent {
  schemaVersion: number;
  operationId: string;
  state: string;
  provider: string;
  model: 'qwen-mt-image';
  endpointSha256: string;
  credentialRevision: string;
  adapterRevision: string;
  request: {
    operation: string;
    sourceSha256: string;
    sourceUrlSha256: string;
    sourceUrlVerified: true;
    sourceEvidence: SourceVerification;
    sourceLanguage: string;
    targetLanguage: string;
    domainHintSha256: string;
    terminologiesSha256: string;
    imageSegment: false;
    maxPollRequests: number;
    maxPollDurationMs: number;
  };
  quotedCostCents: number;
  maximumCostCents: number;
}

function parseStoredIntent(value: unknown, expected: {
  operationId: string;
  endpointSha256: string;
  credentialRevision: string;
  adapterRevision: string;
}): StoredTranslationIntent {
  const intent = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<StoredTranslationIntent>
    : {};
  const request = intent.request && typeof intent.request === 'object'
    ? intent.request as Partial<StoredTranslationIntent['request']>
    : {};
  const source = request.sourceEvidence && typeof request.sourceEvidence === 'object'
    ? request.sourceEvidence as Partial<SourceVerification>
    : {};
  if (
    intent.operationId !== expected.operationId
    || intent.state !== 'SUBMITTING'
    || intent.provider !== 'dashscope-qwen-mt-image'
    || intent.model !== 'qwen-mt-image'
    || intent.endpointSha256 !== expected.endpointSha256
    || intent.credentialRevision !== expected.credentialRevision
    || intent.adapterRevision !== expected.adapterRevision
    || request.operation !== 'IMAGE_TRANSLATE'
    || !SHA256_PATTERN.test(String(request.sourceSha256 || ''))
    || !SHA256_PATTERN.test(String(request.sourceUrlSha256 || ''))
    || request.sourceUrlVerified !== true
    || source.verified !== true
    || source.sha256 !== request.sourceSha256
    || !ALLOWED_IMAGE_MIME.has(String(source.mimeType || ''))
    || !Number.isSafeInteger(source.width)
    || Number(source.width) <= 0
    || !Number.isSafeInteger(source.height)
    || Number(source.height) <= 0
    || !Number.isSafeInteger(source.bytes)
    || Number(source.bytes) <= 0
    || (source.etagSha256 !== null && !SHA256_PATTERN.test(String(source.etagSha256 || '')))
    || typeof source.cacheControlImmutable !== 'boolean'
    || !SHA256_PATTERN.test(String(request.domainHintSha256 || ''))
    || !SHA256_PATTERN.test(String(request.terminologiesSha256 || ''))
    || request.imageSegment !== false
    || !Number.isSafeInteger(request.maxPollRequests)
    || Number(request.maxPollRequests) <= 0
    || !Number.isSafeInteger(request.maxPollDurationMs)
    || Number(request.maxPollDurationMs) <= 0
    || !Number.isSafeInteger(intent.quotedCostCents)
    || Number(intent.quotedCostCents) <= 0
    || !Number.isSafeInteger(intent.maximumCostCents)
    || Number(intent.maximumCostCents) < Number(intent.quotedCostCents)
  ) {
    throw Object.assign(new Error('Translation sandbox intent evidence is invalid'), {
      code: 'SANDBOX_INTENT_INVALID',
    });
  }
  return intent as StoredTranslationIntent;
}

async function loadRecoveryState(path: string, operationId: string) {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/u).filter(Boolean);
  let providerTaskId: string | null = null;
  let resultUrl: string | null = null;
  for (const line of lines) {
    let value: any;
    try {
      value = JSON.parse(line);
    } catch {
      throw Object.assign(new Error('Translation recovery journal is invalid'), {
        code: 'SANDBOX_RECOVERY_INVALID',
      });
    }
    if (value?.schemaVersion !== 1 || value?.operationId !== operationId) {
      throw Object.assign(new Error('Translation recovery journal operation is invalid'), {
        code: 'SANDBOX_RECOVERY_INVALID',
      });
    }
    if (value.event === 'TASK_ACCEPTED') {
      const candidate = String(value.providerTaskId || '').trim();
      if (!candidate || candidate.length > 500 || (providerTaskId && providerTaskId !== candidate)) {
        throw Object.assign(new Error('Translation recovery task identity is invalid'), {
          code: 'SANDBOX_RECOVERY_INVALID',
        });
      }
      providerTaskId = candidate;
    } else if (value.event === 'RESULT_URL') {
      let candidate: string;
      try {
        candidate = new URL(String(value.resultUrl || '')).toString();
      } catch {
        throw Object.assign(new Error('Translation recovery result URL is invalid'), {
          code: 'SANDBOX_RECOVERY_INVALID',
        });
      }
      resultUrl = candidate;
    } else {
      throw Object.assign(new Error('Translation recovery journal event is invalid'), {
        code: 'SANDBOX_RECOVERY_INVALID',
      });
    }
  }
  if (!providerTaskId) {
    throw Object.assign(new Error('Translation recovery journal has no accepted task'), {
      code: 'SANDBOX_RECOVERY_REQUIRED',
    });
  }
  return { providerTaskId, resultUrl };
}

async function responseImage(response: Response): Promise<{
  buffer: Buffer;
  mimeType: SourceVerification['mimeType'];
}> {
  if (!response.ok) {
    throw Object.assign(new Error('Translation result download failed'), {
      code: 'SANDBOX_RECONCILIATION_REQUIRED',
    });
  }
  const mimeType = String(response.headers.get('content-type') || '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw Object.assign(new Error('Translation result MIME type is invalid'), { code: 'SANDBOX_RESULT_INVALID' });
  }
  const buffer = await readBoundedBody(response, MAX_SOURCE_BYTES);
  const metadata = await sharp(buffer).metadata();
  const detectedMime = metadata.format === 'png' ? 'image/png'
    : metadata.format === 'jpeg' ? 'image/jpeg'
      : metadata.format === 'webp' ? 'image/webp' : null;
  if (detectedMime !== mimeType) {
    throw Object.assign(new Error('Translation result MIME does not match its bytes'), {
      code: 'SANDBOX_RESULT_INVALID',
    });
  }
  return {
    buffer,
    mimeType: detectedMime,
  };
}

async function runReconciliation(input: {
  options: AiImageTranslationSingleSubmitOptions;
  environment: NodeJS.ProcessEnv;
  now: () => number;
  wait: Delay;
  apiBase: string;
  apiKey: string;
  model: 'qwen-mt-image';
  operationId: string;
  credentialRevision: string;
  adapterRevision: string;
  reconciliationId: string;
}) {
  const root = input.options.repositoryRoot
    || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const outputDirectory = input.options.outputDirectory
    || resolve(root, 'tmp/ai-image-translation-sandbox');
  const intentPath = resolve(outputDirectory, 'intents', `${input.operationId}.intent.json`);
  const submitEndpoint = new URL(
    `${input.apiBase}/services/aigc/image2image/image-synthesis`,
  ).toString();
  const endpointSha256 = sha256(submitEndpoint);
  const intent = parseStoredIntent(
    JSON.parse(await readFile(intentPath, 'utf8')),
    {
      operationId: input.operationId,
      endpointSha256,
      credentialRevision: input.credentialRevision,
      adapterRevision: input.adapterRevision,
    },
  );
  const declaredSourceSha = requiredEnvironment(
    'AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256',
    input.environment,
  ).toLowerCase();
  if (declaredSourceSha !== intent.request.sourceSha256) {
    throw Object.assign(new Error('Translation reconciliation source digest changed'), {
      code: 'SANDBOX_INTENT_MISMATCH',
    });
  }
  const recoveryPath = resolve(
    outputDirectory,
    'recovery',
    `${input.operationId}.recovery.jsonl`,
  );
  const recovery = await loadRecoveryState(recoveryPath, input.operationId);
  const reconciliationIntentPath = resolve(
    outputDirectory,
    'reconciliations',
    `${input.operationId}.${input.reconciliationId}.intent.json`,
  );
  await writePrivateFile(reconciliationIntentPath, `${JSON.stringify({
    schemaVersion: 1,
    operationId: input.operationId,
    reconciliationId: input.reconciliationId,
    state: 'RECONCILING',
    providerTaskIdHash: sha256(recovery.providerTaskId),
    resultUrlHash: recovery.resultUrl ? sha256(recovery.resultUrl) : null,
    createdAt: new Date(input.now()).toISOString(),
  }, null, 2)}\n`);
  const contract: AiImageTranslationSandboxContract = {
    submitEndpoint,
    taskEndpointBase: new URL(`${input.apiBase}/tasks`).toString(),
    model: 'qwen-mt-image',
    sourceSha256: intent.request.sourceSha256,
    sourceUrlSha256: intent.request.sourceUrlSha256,
    sourceUrlVerified: true,
    sourceEvidence: intent.request.sourceEvidence,
    sourceLanguage: intent.request.sourceLanguage,
    targetLanguage: intent.request.targetLanguage,
    domainHintSha256: intent.request.domainHintSha256,
    terminologiesSha256: intent.request.terminologiesSha256,
    imageSegment: false,
    maxPollRequests: Math.min(intent.request.maxPollRequests, MAX_POLL_REQUESTS),
    maxPollDurationMs: Math.min(intent.request.maxPollDurationMs, MAX_POLL_DURATION_MS),
  };
  const transport = createPinnedTransport(input.options);
  try {
    await transport.validateUrl(input.apiBase);
    let recoveredResultUrl = recovery.resultUrl;
    if (recoveredResultUrl) {
      const safeResultUrl = await transport.validateUrl(recoveredResultUrl);
      if (safeResultUrl !== recoveredResultUrl) {
        throw Object.assign(new Error('Translation recovery result URL changed during validation'), {
          code: 'SANDBOX_RECOVERY_INVALID',
        });
      }
      recoveredResultUrl = safeResultUrl;
    }
    const guard = createAiImageTranslationSandboxFetchGuard({
      contract,
      validateUrl: transport.validateUrl,
      fetch: transport.fetch,
      now: input.now,
      mode: 'RECONCILE',
      recovery: {
        providerTaskId: recovery.providerTaskId,
        resultUrl: recoveredResultUrl,
      },
      onResultUrl: (resultUrl) => appendRecoveryEvent(recoveryPath, {
        schemaVersion: 1,
        operationId: input.operationId,
        event: 'RESULT_URL',
        resultUrl,
        recordedAt: new Date(input.now()).toISOString(),
      }),
    });
    const provider = createDashScopeImageTranslationProvider({
      baseUrl: input.apiBase,
      apiKey: input.apiKey,
      model: input.model,
      fetch: guard.fetch,
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      costPerImageCents: 0,
    });
    const reportPath = resolve(
      outputDirectory,
      `${input.operationId}.${input.reconciliationId}.reconcile.report.json`,
    );
    const startedAt = input.now();
    let reportWritten = false;
    try {
      let image: { buffer: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | null = null;
      if (recoveredResultUrl) {
        try {
          image = await responseImage(await guard.fetch(recoveredResultUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
          }));
        } catch {
          guard.resumePollingAfterResultFailure();
        }
      }
      if (!image) {
        const pollDeadline = input.now() + contract.maxPollDurationMs;
        for (let attempt = 0; attempt < contract.maxPollRequests; attempt += 1) {
          if (input.now() >= pollDeadline) {
            throw Object.assign(new Error('Translation reconciliation poll deadline reached'), {
              code: 'SANDBOX_RECONCILIATION_REQUIRED',
            });
          }
          const result = await provider.poll(recovery.providerTaskId);
          if (result.status === 'SUCCEEDED') {
            if (!ALLOWED_IMAGE_MIME.has(result.image.mimeType)) {
              throw Object.assign(new Error('Translation reconciliation result MIME type is invalid'), {
                code: 'SANDBOX_RESULT_INVALID',
              });
            }
            image = {
              buffer: result.image.buffer,
              mimeType: result.image.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
            };
            break;
          }
          if (attempt + 1 >= contract.maxPollRequests) {
            throw Object.assign(new Error('Translation reconciliation poll count exhausted'), {
              code: 'SANDBOX_RECONCILIATION_REQUIRED',
            });
          }
          const remainingMs = pollDeadline - input.now();
          if (remainingMs <= POLL_INTERVAL_MS) {
            throw Object.assign(new Error('Translation reconciliation poll deadline reached'), {
              code: 'SANDBOX_RECONCILIATION_REQUIRED',
            });
          }
          await input.wait(POLL_INTERVAL_MS);
        }
      }
      if (!image) {
        throw Object.assign(new Error('Translation reconciliation did not produce an image'), {
          code: 'SANDBOX_RECONCILIATION_REQUIRED',
        });
      }
      const metadata = await sharp(image.buffer).metadata();
      if (
        !metadata.width
        || !metadata.height
        || metadata.width > 4096
        || metadata.height > 4096
      ) {
        throw Object.assign(new Error('Translation reconciliation result image is invalid'), {
          code: 'SANDBOX_RESULT_INVALID',
        });
      }
      const extension = image.mimeType === 'image/jpeg' ? 'jpg'
        : image.mimeType === 'image/webp' ? 'webp' : 'png';
      const imagePath = resolve(
        outputDirectory,
        `${input.operationId}.${input.reconciliationId}.reconcile.result.${extension}`,
      );
      await writePrivateFile(imagePath, image.buffer);
      const evidence = guard.getEvidence();
      const report = {
        schemaVersion: 2,
        operationId: input.operationId,
        reconciliationId: input.reconciliationId,
        mode: 'RECONCILE',
        state: 'SUCCEEDED',
        provider: 'dashscope-qwen-mt-image',
        model: input.model,
        operation: 'IMAGE_TRANSLATE',
        endpointSha256,
        credentialRevision: input.credentialRevision,
        adapterRevision: input.adapterRevision,
        sourceSha256: intent.request.sourceSha256,
        sourceUrlSha256: intent.request.sourceUrlSha256,
        sourceLanguage: intent.request.sourceLanguage,
        targetLanguage: intent.request.targetLanguage,
        domainHintSha256: intent.request.domainHintSha256,
        terminologiesSha256: intent.request.terminologiesSha256,
        source: intent.request.sourceEvidence,
        submitRequests: guard.getSubmitRequests(),
        pollRequests: guard.getPollRequests(),
        resultDownloads: guard.getResultDownloads(),
        providerTaskIdHash: evidence.providerTaskIdHash,
        providerRequestIdHashes: evidence.providerRequestIdHashes,
        usage: evidence.usage,
        result: {
          mimeType: image.mimeType,
          width: metadata.width,
          height: metadata.height,
          bytes: image.buffer.byteLength,
          sha256: sha256(image.buffer),
        },
        actualCostCents: null,
        quotedCostCents: intent.quotedCostCents,
        maximumCostCents: intent.maximumCostCents,
        elapsedMs: input.now() - startedAt,
        intentPath,
        imagePath,
      };
      await atomicWritePrivateJson(reportPath, report);
      reportWritten = true;
      process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
      return report;
    } catch (error) {
      if (!reportWritten) {
        const evidence = guard.getEvidence();
        const report = {
          schemaVersion: 2,
          operationId: input.operationId,
          reconciliationId: input.reconciliationId,
          mode: 'RECONCILE',
          state: evidence.state === 'FAILED' ? 'FAILED' : 'RECONCILIATION_REQUIRED',
          provider: 'dashscope-qwen-mt-image',
          model: input.model,
          operation: 'IMAGE_TRANSLATE',
          endpointSha256,
          credentialRevision: input.credentialRevision,
          adapterRevision: input.adapterRevision,
          sourceSha256: intent.request.sourceSha256,
          sourceUrlSha256: intent.request.sourceUrlSha256,
          source: intent.request.sourceEvidence,
          submitRequests: guard.getSubmitRequests(),
          pollRequests: guard.getPollRequests(),
          resultDownloads: guard.getResultDownloads(),
          providerTaskIdHash: evidence.providerTaskIdHash,
          providerRequestIdHashes: evidence.providerRequestIdHashes,
          usage: evidence.usage,
          failureCode: safeFailureCode(error),
          actualCostCents: null,
          quotedCostCents: intent.quotedCostCents,
          maximumCostCents: intent.maximumCostCents,
          elapsedMs: input.now() - startedAt,
          intentPath,
        };
        await atomicWritePrivateJson(reportPath, report);
        process.stderr.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
      }
      throw error;
    }
  } finally {
    await transport.close();
  }
}

export async function runAiImageTranslationSingleSubmit(
  options: AiImageTranslationSingleSubmitOptions = {},
) {
  const environment = options.environment || process.env;
  const repositoryRoot = options.repositoryRoot
    || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const now = options.now || Date.now;
  const wait = options.delay || defaultDelay;
  if (environment.NODE_ENV !== 'sandbox') {
    throw Object.assign(new Error('The translation sandbox requires NODE_ENV=sandbox'), {
      code: 'SANDBOX_ENVIRONMENT_INVALID',
    });
  }
  const modeValue = requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_MODE', environment);
  if (modeValue !== 'SUBMIT' && modeValue !== 'RECONCILE') {
    throw Object.assign(new Error('Translation sandbox mode must be SUBMIT or RECONCILE'), {
      code: 'SANDBOX_MODE_INVALID',
    });
  }
  const mode = modeValue as SandboxMode;
  if (mode === 'SUBMIT' && environment.AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM !== CONFIRMATION) {
    throw Object.assign(new Error('Paid translation sandbox confirmation is required'), {
      code: 'SANDBOX_CONFIRMATION_REQUIRED',
    });
  }

  const baseUrl = requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_BASE_URL', environment);
  const apiKey = requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_API_KEY', environment);
  const model = requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_MODEL', environment);
  if (model !== 'qwen-mt-image') {
    throw Object.assign(new Error('The translation sandbox permits only qwen-mt-image'), {
      code: 'SANDBOX_MODEL_INVALID',
    });
  }
  const operationId = requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_OPERATION_ID', environment);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/u.test(operationId)) {
    throw Object.assign(new Error('Translation sandbox operation ID is invalid'), {
      code: 'SANDBOX_OPERATION_INVALID',
    });
  }
  const expectedHost = requiredEnvironment(
    'AI_IMAGE_TRANSLATION_SANDBOX_EXPECTED_HOST',
    environment,
  ).toLowerCase();
  const credentialRevision = requiredEnvironment(
    'AI_IMAGE_TRANSLATION_SANDBOX_CREDENTIAL_REVISION',
    environment,
  );
  const adapterRevision = requiredEnvironment('AI_IMAGE_SANDBOX_ADAPTER_REVISION', environment).toLowerCase();
  if (!FULL_GIT_OID_PATTERN.test(adapterRevision)) {
    throw Object.assign(new Error('Adapter revision must be a full Git object ID'), {
      code: 'SANDBOX_ADAPTER_REVISION_INVALID',
    });
  }
  try {
    const deployedRevision = (await readFile(resolve(repositoryRoot, 'DEPLOYED_COMMIT'), 'utf8'))
      .trim()
      .toLowerCase();
    if (!FULL_GIT_OID_PATTERN.test(deployedRevision) || deployedRevision !== adapterRevision) {
      throw Object.assign(new Error('Adapter revision does not match DEPLOYED_COMMIT'), {
        code: 'SANDBOX_ADAPTER_REVISION_MISMATCH',
      });
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const apiBase = normalizeDashScopeApiBase(baseUrl);
  const parsedBase = new URL(apiBase);
  if (
    isIP(parsedBase.hostname) !== 0
    || parsedBase.hostname.toLowerCase() !== OFFICIAL_DASHSCOPE_HOST
    || expectedHost !== OFFICIAL_DASHSCOPE_HOST
  ) {
    throw Object.assign(new Error('The translation sandbox permits only the official DashScope host'), {
      code: 'SANDBOX_HOST_INVALID',
    });
  }

  if (mode === 'RECONCILE') {
    const reconciliationId = requiredEnvironment(
      'AI_IMAGE_TRANSLATION_SANDBOX_RECONCILIATION_ID',
      environment,
    );
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,79}$/u.test(reconciliationId)) {
      throw Object.assign(new Error('Translation sandbox reconciliation ID is invalid'), {
        code: 'SANDBOX_RECONCILIATION_ID_INVALID',
      });
    }
    return runReconciliation({
      options,
      environment,
      now,
      wait,
      apiBase,
      apiKey,
      model,
      operationId,
      credentialRevision,
      adapterRevision,
      reconciliationId,
    });
  }

  const sourcePath = resolve(
    repositoryRoot,
    requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_PATH', environment),
  );
  const sourceSha256 = requiredEnvironment(
    'AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256',
    environment,
  ).toLowerCase();
  if (!SHA256_PATTERN.test(sourceSha256)) {
    throw Object.assign(new Error('Source SHA-256 is invalid'), { code: 'SANDBOX_SOURCE_INVALID' });
  }
  const sourceBytes = await readFile(sourcePath);
  if (!sourceBytes.length || sourceBytes.length > MAX_SOURCE_BYTES) {
    throw Object.assign(new Error('Local source size is invalid'), { code: 'SANDBOX_SOURCE_INVALID' });
  }
  if (sha256(sourceBytes) !== sourceSha256) {
    throw Object.assign(new Error('Local source SHA-256 does not match the declared digest'), {
      code: 'SANDBOX_SOURCE_HASH_MISMATCH',
    });
  }
  const sourceMetadata = await sharp(sourceBytes).metadata();
  if (
    !['png', 'jpeg', 'webp'].includes(sourceMetadata.format || '')
    || !sourceMetadata.width
    || !sourceMetadata.height
    || sourceMetadata.width > 4096
    || sourceMetadata.height > 4096
  ) {
    throw Object.assign(new Error('Local source image dimensions are invalid'), {
      code: 'SANDBOX_SOURCE_INVALID',
    });
  }

  const sourceLanguage = normalizedLanguage(
    requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_LANGUAGE', environment),
    'source language',
  );
  const targetLanguage = normalizedLanguage(
    requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_TARGET_LANGUAGE', environment),
    'target language',
  );
  if (sourceLanguage === targetLanguage) {
    throw Object.assign(new Error('Source and target languages must differ'), { code: 'SANDBOX_CONFIG_INVALID' });
  }
  const domainHint = requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_DOMAIN_HINT', environment);
  if (Buffer.byteLength(domainHint, 'utf8') > 16_000) {
    throw Object.assign(new Error('Translation domain hint is too large'), { code: 'SANDBOX_CONFIG_INVALID' });
  }
  const terminologies = parseTerminologies(
    String(environment.AI_IMAGE_TRANSLATION_SANDBOX_TERMINOLOGIES_JSON || '[]'),
  );

  const transport = createPinnedTransport(options);
  try {
    await transport.validateUrl(apiBase);
    const canonicalSourceUrl = await transport.validateUrl(
      requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_URL', environment),
    );
    const sourceVerification = await verifyRemoteSource({
      url: canonicalSourceUrl,
      expectedSha256: sourceSha256,
      fetch: transport.fetch,
    });
    const submitEndpoint = new URL(
      `${apiBase}/services/aigc/image2image/image-synthesis`,
    ).toString();
    const taskEndpointBase = new URL(`${apiBase}/tasks`).toString();
    const endpointSha256 = sha256(submitEndpoint);
    const sourceUrlSha256 = sha256(canonicalSourceUrl);
    const domainHintSha256 = sha256(domainHint);
    const terminologiesSha256 = sha256(JSON.stringify(terminologies));
    const contract: AiImageTranslationSandboxContract = {
      submitEndpoint,
      taskEndpointBase,
      model: 'qwen-mt-image',
      sourceSha256,
      sourceUrlSha256,
      sourceUrlVerified: true,
      sourceEvidence: sourceVerification,
      sourceLanguage,
      targetLanguage,
      domainHintSha256,
      terminologiesSha256,
      imageSegment: false,
      maxPollRequests: MAX_POLL_REQUESTS,
      maxPollDurationMs: MAX_POLL_DURATION_MS,
    };

    const outputDirectory = options.outputDirectory
      || resolve(repositoryRoot, 'tmp/ai-image-translation-sandbox');
    const claim = await claimAiImageTranslationSandboxOperation({
      directory: resolve(outputDirectory, 'intents'),
      operationId,
      endpointSha256,
      credentialRevision,
      adapterRevision,
      contract,
      quotedCostCents: requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_QUOTED_COST_CENTS', environment),
      maximumCostCents: requiredEnvironment('AI_IMAGE_TRANSLATION_SANDBOX_MAX_COST_CENTS', environment),
    });
    const recoveryPath = resolve(outputDirectory, 'recovery', `${operationId}.recovery.jsonl`);
    const guard = createAiImageTranslationSandboxFetchGuard({
      contract,
      validateUrl: transport.validateUrl,
      fetch: transport.fetch,
      now,
      onProviderTaskId: (providerTaskId) => appendRecoveryEvent(recoveryPath, {
        schemaVersion: 1,
        operationId,
        event: 'TASK_ACCEPTED',
        providerTaskId,
        recordedAt: new Date(now()).toISOString(),
      }),
      onResultUrl: (resultUrl) => appendRecoveryEvent(recoveryPath, {
        schemaVersion: 1,
        operationId,
        event: 'RESULT_URL',
        resultUrl,
        recordedAt: new Date(now()).toISOString(),
      }),
    });
    const provider = createDashScopeImageTranslationProvider({
      baseUrl: apiBase,
      apiKey,
      model,
      fetch: guard.fetch,
      timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
      costPerImageCents: 0,
    });
    const startedAt = now();
    const reportPath = resolve(outputDirectory, `${operationId}.submit.report.json`);
    let reportWritten = false;
    try {
      const submitted = await provider.submit({
        model,
        imageUrl: canonicalSourceUrl,
        sourceLanguage,
        targetLanguage,
        domainHint,
        terminologies,
        imageSegment: false,
      }, async () => undefined);
      const pollDeadline = now() + MAX_POLL_DURATION_MS;
      let completed: Awaited<ReturnType<typeof provider.poll>> | null = null;
      for (let attempt = 0; attempt < MAX_POLL_REQUESTS; attempt += 1) {
        if (now() >= pollDeadline) {
          throw Object.assign(new Error('Translation sandbox poll deadline reached'), {
            code: 'SANDBOX_RECONCILIATION_REQUIRED',
          });
        }
        const result = await provider.poll(submitted.providerJobId);
        if (result.status === 'SUCCEEDED') {
          completed = result;
          break;
        }
        if (attempt + 1 >= MAX_POLL_REQUESTS) {
          throw Object.assign(new Error('Translation sandbox poll count exhausted'), {
            code: 'SANDBOX_RECONCILIATION_REQUIRED',
          });
        }
        const remainingMs = pollDeadline - now();
        if (remainingMs <= POLL_INTERVAL_MS) {
          throw Object.assign(new Error('Translation sandbox poll deadline reached'), {
            code: 'SANDBOX_RECONCILIATION_REQUIRED',
          });
        }
        await wait(POLL_INTERVAL_MS);
      }
      if (!completed || completed.status !== 'SUCCEEDED') {
        throw Object.assign(new Error('Translation sandbox did not reach a terminal result'), {
          code: 'SANDBOX_RECONCILIATION_REQUIRED',
        });
      }

      const image = completed.image;
      const metadata = await sharp(image.buffer).metadata();
      if (
        !ALLOWED_IMAGE_MIME.has(image.mimeType)
        || !image.buffer.length
        || image.buffer.length > MAX_SOURCE_BYTES
        || !metadata.width
        || !metadata.height
        || metadata.width > 4096
        || metadata.height > 4096
      ) {
        throw Object.assign(new Error('Translation sandbox result image is invalid'), {
          code: 'SANDBOX_RESULT_INVALID',
        });
      }
      const extension = image.mimeType === 'image/jpeg' ? 'jpg'
        : image.mimeType === 'image/webp' ? 'webp' : 'png';
      const imagePath = resolve(outputDirectory, `${operationId}.result.${extension}`);
      await writePrivateFile(imagePath, image.buffer);
      const evidence = guard.getEvidence();
      const report = {
        schemaVersion: 2,
        operationId,
        mode,
        state: 'SUCCEEDED',
        provider: 'dashscope-qwen-mt-image',
        model,
        operation: 'IMAGE_TRANSLATE',
        endpointSha256,
        credentialRevision,
        adapterRevision,
        sourceSha256,
        sourceUrlSha256,
        sourceLanguage,
        targetLanguage,
        domainHintSha256,
        terminologiesSha256,
        source: sourceVerification,
        submitRequests: guard.getSubmitRequests(),
        pollRequests: guard.getPollRequests(),
        resultDownloads: guard.getResultDownloads(),
        providerTaskIdHash: evidence.providerTaskIdHash,
        providerRequestIdHashes: evidence.providerRequestIdHashes,
        usage: evidence.usage,
        result: {
          mimeType: image.mimeType,
          width: metadata.width,
          height: metadata.height,
          bytes: image.buffer.byteLength,
          sha256: sha256(image.buffer),
        },
        actualCostCents: null,
        quotedCostCents: claim.intent.quotedCostCents,
        maximumCostCents: claim.intent.maximumCostCents,
        elapsedMs: now() - startedAt,
        intentPath: claim.intentPath,
        imagePath,
      };
      await atomicWritePrivateJson(reportPath, report);
      reportWritten = true;
      process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
      return report;
    } catch (error) {
      if (!reportWritten) {
        const evidence = guard.getEvidence();
        const report = {
          schemaVersion: 2,
          operationId,
          mode,
          state: guard.getSubmitRequests() === 0
            ? 'PRE_DISPATCH_FAILED'
            : evidence.state === 'REJECTED'
              ? 'REJECTED'
              : evidence.state === 'FAILED'
                ? 'FAILED'
                : 'RECONCILIATION_REQUIRED',
          provider: 'dashscope-qwen-mt-image',
          model,
          operation: 'IMAGE_TRANSLATE',
          endpointSha256,
          credentialRevision,
          adapterRevision,
          sourceSha256,
          sourceUrlSha256,
          sourceLanguage,
          targetLanguage,
          domainHintSha256,
          terminologiesSha256,
          source: sourceVerification,
          submitRequests: guard.getSubmitRequests(),
          pollRequests: guard.getPollRequests(),
          resultDownloads: guard.getResultDownloads(),
          providerTaskIdHash: evidence.providerTaskIdHash,
          providerRequestIdHashes: evidence.providerRequestIdHashes,
          usage: evidence.usage,
          failureCode: safeFailureCode(error),
          actualCostCents: null,
          quotedCostCents: claim.intent.quotedCostCents,
          maximumCostCents: claim.intent.maximumCostCents,
          elapsedMs: now() - startedAt,
          intentPath: claim.intentPath,
        };
        await atomicWritePrivateJson(reportPath, report);
        process.stderr.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
      }
      throw error;
    }
  } finally {
    await transport.close();
  }
}

const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  runAiImageTranslationSingleSubmit().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      event: 'SANDBOX_COMMAND_FAILED',
      failureCode: safeFailureCode(error),
    })}\n`);
    process.stderr.write('DashScope image translation sandbox failed.\n');
    process.exitCode = 1;
  });
}
