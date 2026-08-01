import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { Agent, fetch as undiciFetch, interceptors } from 'undici';
import { validateAiImageProviderUrl } from '../src/services/ai-image-providers.js';
import { writeAiImageSandboxPrivateEvidenceBundle } from '../src/services/ai-image-sandbox-billing-settlement.js';
import {
  AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN,
  resolveAiImageSandboxRepositoryRevision,
} from '../src/services/ai-image-sandbox-code-revision.js';
import {
  AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE,
  AI_IMAGE_WANX21_EDIT_MODEL,
} from '../src/services/ai-image-wanx-edit-profile.js';
import {
  AI_IMAGE_XIAOYI_API_BASE,
  AI_IMAGE_XIAOYI_BILLING_HOST,
  AI_IMAGE_XIAOYI_BILLING_ORIGIN,
  AI_IMAGE_XIAOYI_EXPECTED_HOST,
  AI_IMAGE_XIAOYI_MODEL,
} from '../src/services/ai-image-xiaoyi-provider.js';

const PACKY_API_BASE = 'https://www.packyapi.ai/v1';
const PACKY_EXPECTED_HOST = 'www.packyapi.ai';
const PACKY_MODEL = 'gpt-image-2';
const PACKY_EMPTY_TOKEN_LOG_MESSAGE = 'record not found';
const MAX_CREDENTIAL_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_DOH_RESPONSE_BYTES = 64 * 1_024;
const MAX_DOH_ANSWERS = 64;
const MAX_DOH_CNAME_HOPS = 8;
const DASHSCOPE_CATALOG_TOP_LEVEL_FIELDS = [
  'code',
  'message',
  'output',
  'request_id',
  'success',
] as const;
const DASHSCOPE_CATALOG_OUTPUT_FIELDS = ['models', 'page_no', 'page_size', 'total'] as const;
const DASHSCOPE_CATALOG_FORBIDDEN_MODEL_FIELDS = new Set([
  'code',
  'data',
  'error',
  'id',
  'message',
  'model_id',
  'success',
]);
const EVIDENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u;
const SECRET_SHAPE_PATTERN = /(?:^|[^A-Za-z0-9])(?:sk|pk)-[A-Za-z0-9_-]{12,}/iu;
const UNSAFE_ENVIRONMENT_NAMES = new Set([
  'AI_IMAGE_SANDBOX_API_KEY',
  'AI_IMAGE_SANDBOX_CONFIRM',
  'AI_IMAGE_TRANSLATION_SANDBOX_API_KEY',
  'AI_IMAGE_SANDBOX_TOKEN',
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
const READONLY_PREFLIGHT_TRACKED_PATHS = [
  'apps/server/scripts/ai-image-provider-readonly-preflight.ts',
  'apps/server/src/services/ai-image-providers.ts',
  'apps/server/src/services/ai-image-sandbox-billing-settlement.ts',
  'apps/server/src/services/ai-image-sandbox-code-revision.ts',
  'apps/server/src/services/ai-image-wanx-edit-profile.ts',
  'apps/server/src/services/ai-image-xiaoyi-provider.ts',
  'apps/server/src/services/ai-image-job-error.ts',
];

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface CapturedResponse {
  phase: 'BEFORE' | 'CHECK' | 'AFTER';
  name: 'tokenUsage' | 'displayUsage' | 'tokenLog' | 'models';
  method: 'GET';
  uri: string;
  httpStatus: 200;
  contentType: string;
  observedAt: string;
  bytes: number;
  sha256: string;
  file: string;
  body: Buffer;
  parsed: unknown;
}

interface ReviewedProviderIdentity {
  manifestSchemaVersion: 1 | 2 | 3;
  preflightKind: 'NEW_API_METERS' | 'DASHSCOPE_MODEL_CATALOG';
  apiBase: string;
  apiHost: string;
  billingOrigin: string | null;
  billingHost: string | null;
  model: string;
  emptyTokenLogMessage: string | null;
}

const REVIEWED_PROVIDER_IDENTITIES: readonly ReviewedProviderIdentity[] = Object.freeze([
  Object.freeze({
    manifestSchemaVersion: 1,
    preflightKind: 'NEW_API_METERS',
    apiBase: PACKY_API_BASE,
    apiHost: PACKY_EXPECTED_HOST,
    billingOrigin: new URL(PACKY_API_BASE).origin,
    billingHost: PACKY_EXPECTED_HOST,
    model: PACKY_MODEL,
    emptyTokenLogMessage: PACKY_EMPTY_TOKEN_LOG_MESSAGE,
  }),
  Object.freeze({
    manifestSchemaVersion: 2,
    preflightKind: 'NEW_API_METERS',
    apiBase: AI_IMAGE_XIAOYI_API_BASE,
    apiHost: AI_IMAGE_XIAOYI_EXPECTED_HOST,
    billingOrigin: AI_IMAGE_XIAOYI_BILLING_ORIGIN,
    billingHost: AI_IMAGE_XIAOYI_BILLING_HOST,
    model: AI_IMAGE_XIAOYI_MODEL,
    emptyTokenLogMessage: PACKY_EMPTY_TOKEN_LOG_MESSAGE,
  }),
  Object.freeze({
    manifestSchemaVersion: 3,
    preflightKind: 'DASHSCOPE_MODEL_CATALOG',
    apiBase: AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE,
    apiHost: new URL(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE).hostname,
    billingOrigin: null,
    billingHost: null,
    model: AI_IMAGE_WANX21_EDIT_MODEL,
    emptyTokenLogMessage: null,
  }),
]);

export interface AiImageProviderReadonlyPreflightOptions {
  environment?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
  resolveRevision?: typeof resolveAiImageSandboxRepositoryRevision;
  resolveDns?: (hostname: string) => Promise<Array<{ address: string }>>;
  fetch?: FetchLike;
  readCredential?: () => Promise<string>;
  now?: () => Date;
  requireGitCheckout?: boolean;
  beforeEvidenceWrite?: (input: {
    index: number;
    name: string;
    outputDirectory: string;
  }) => Promise<void> | void;
}

export class AiImageProviderReadonlyPreflightError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiImageProviderReadonlyPreflightError';
  }
}

function preflightError(code: string, message: string) {
  return new AiImageProviderReadonlyPreflightError(code, message);
}

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv) {
  const value = String(environment[name] || '').trim();
  if (!value) {
    throw preflightError('SANDBOX_READONLY_CONFIG_INVALID', `${name} is required`);
  }
  return value;
}

function safeFailureCode(error: unknown) {
  const value = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return value.toUpperCase().replace(/[^A-Z0-9_.-]/gu, '').slice(0, 80)
    || 'SANDBOX_READONLY_FAILED';
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function contentTypeIs(value: string, expected: string) {
  return value.split(';', 1)[0]?.trim().toLowerCase() === expected;
}

function isNonnegativeFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function containsCredential(value: unknown, credential: string): boolean {
  if (typeof value === 'string') return value.includes(credential);
  if (Array.isArray(value)) return value.some((entry) => containsCredential(entry, credential));
  if (isRecord(value)) {
    return Object.entries(value).some(([key, entry]) => (
      key.includes(credential) || containsCredential(entry, credential)
    ));
  }
  return false;
}

function assertExpectedResponseSchema(
  name: CapturedResponse['name'],
  value: unknown,
  identity: ReviewedProviderIdentity,
) {
  let valid = false;
  if (name === 'tokenUsage') {
    const usage = isRecord(value) ? value.data : undefined;
    valid = isRecord(value)
      && value.code === true
      && isRecord(usage)
      && typeof usage.object === 'string'
      && usage.object.length > 0
      && isNonnegativeFiniteNumber(usage.total_available)
      && isNonnegativeFiniteNumber(usage.total_granted)
      && isNonnegativeFiniteNumber(usage.total_used)
      && typeof usage.unlimited_quota === 'boolean'
      && typeof value.message === 'string';
  } else if (name === 'displayUsage') {
    valid = isRecord(value)
      && typeof value.object === 'string'
      && value.object.length > 0
      && typeof value.total_usage === 'number'
      && Number.isFinite(value.total_usage)
      && value.total_usage >= 0;
  } else if (name === 'tokenLog') {
    const emptyTokenLog = isRecord(value)
      && Object.keys(value).length === 2
      && value.success === false
      && value.message === identity.emptyTokenLogMessage
      && value.data === undefined;
    valid = emptyTokenLog || (isRecord(value)
      && value.success === true
      && typeof value.message === 'string'
      && (value.data === undefined || Array.isArray(value.data)));
  } else if (identity.preflightKind === 'NEW_API_METERS') {
    valid = isRecord(value)
      && value.success === true
      && value.object === 'list'
      && Array.isArray(value.data);
  } else {
    valid = dashScopeModels(value) !== null;
  }
  if (!valid) {
    throw preflightError(
      'SANDBOX_READONLY_RESPONSE_SCHEMA_INVALID',
      `Read-only ${name} response schema is invalid`,
    );
  }
}

function timestamp(options: AiImageProviderReadonlyPreflightOptions) {
  const value = options.now ? options.now() : new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw preflightError('SANDBOX_READONLY_CLOCK_INVALID', 'Read-only observation clock is invalid');
  }
  return value.toISOString();
}

export async function readAiImageProviderCredential(
  source: AsyncIterable<unknown> = process.stdin,
) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of source) {
      const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk), 'utf8');
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_CREDENTIAL_BYTES) {
        bytes.fill(0);
        throw preflightError(
          'SANDBOX_READONLY_CREDENTIAL_INVALID',
          'Read-only credential input exceeds the byte limit',
        );
      }
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks, totalBytes);
    let value = '';
    try {
      if (
        bytes.byteLength >= 3
        && bytes[0] === 0xef
        && bytes[1] === 0xbb
        && bytes[2] === 0xbf
      ) {
        throw preflightError(
          'SANDBOX_READONLY_CREDENTIAL_INVALID',
          'Read-only credential input must not contain a byte-order mark',
        );
      }
      value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw preflightError(
        'SANDBOX_READONLY_CREDENTIAL_INVALID',
        'Read-only credential input must use UTF-8',
      );
    } finally {
      bytes.fill(0);
    }
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    else if (value.endsWith('\n')) value = value.slice(0, -1);
    if (!/^[\x21-\x7e]{16,512}$/u.test(value)) {
      throw preflightError(
        'SANDBOX_READONLY_CREDENTIAL_INVALID',
        'Read-only credential input must be one bounded printable ASCII value',
      );
    }
    return value;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function resolveAiImageProviderPublicDns(hostname: string) {
  const canonicalDnsName = (value: unknown) => {
    const name = typeof value === 'string'
      ? value.toLowerCase().replace(/\.$/u, '')
      : '';
    if (
      !name
      || name.length > 253
      || isIP(name) !== 0
      || !name.split('.').every((label) => (
        label.length >= 1
        && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
      ))
    ) {
      throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS name is invalid');
    }
    return name;
  };
  const queryName = canonicalDnsName(hostname);
  const records: Array<{ address: string; family: 4 | 6; ttl: number }> = [];
  const terminalNames = new Set<string>();
  const cnameChains = new Set<string>();
  for (const type of ['A', 'AAAA']) {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', type);
    const response = await globalThis.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/dns-json' },
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw preflightError(
        'SANDBOX_READONLY_DNS_FAILED',
        `Public DNS lookup failed with HTTP ${response.status}`,
      );
    }
    const contentType = response.headers.get('content-type') || '';
    if (
      !contentTypeIs(contentType, 'application/dns-json')
      && !contentTypeIs(contentType, 'application/json')
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS response is not JSON');
    }
    let body: Record<string, unknown>;
    try {
      const bytes = await readBoundedResponse(response, MAX_DOH_RESPONSE_BYTES);
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
      if (!isRecord(parsed)) throw new Error('invalid');
      body = parsed;
    } catch (error) {
      if (error instanceof AiImageProviderReadonlyPreflightError) throw error;
      throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS response is invalid');
    }
    const expectedType = type === 'A' ? 1 : 28;
    const questions = body.Question;
    const answers = body.Answer ?? [];
    if (
      body.Status !== 0
      || body.TC !== false
      || !Array.isArray(questions)
      || questions.length !== 1
      || !Array.isArray(answers)
      || answers.length > MAX_DOH_ANSWERS
    ) {
      throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS answer is invalid');
    }
    const question = questions[0];
    if (
      !isRecord(question)
      || canonicalDnsName(question.name) !== queryName
      || question.type !== expectedType
      || (question.class !== undefined && question.class !== 1)
    ) {
      throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS question is invalid');
    }
    const cnameTargets = new Map<string, string>();
    const addressRecords: Array<{
      owner: string;
      address: string;
      family: 4 | 6;
      ttl: number;
    }> = [];
    for (const answer of answers) {
      if (!isRecord(answer)) {
        throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS record is invalid');
      }
      if (answer.class !== undefined && answer.class !== 1) {
        throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS record class is invalid');
      }
      if (typeof answer.type !== 'number' || ![1, 5, 28].includes(answer.type)) continue;
      if (
        !Number.isSafeInteger(answer.TTL)
        || Number(answer.TTL) <= 0
        || Number(answer.TTL) > 86_400
      ) {
        throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS record is invalid');
      }
      const owner = canonicalDnsName(answer.name);
      if (answer.type === 5) {
        const target = canonicalDnsName(answer.data);
        const existingTarget = cnameTargets.get(owner);
        if (existingTarget && existingTarget !== target) {
          throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS CNAME is ambiguous');
        }
        cnameTargets.set(owner, target);
        continue;
      }
      if (answer.type !== expectedType || typeof answer.data !== 'string') {
        throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS address type is invalid');
      }
      const family = isIP(answer.data);
      if (family !== (expectedType === 1 ? 4 : 6)) {
        throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS address is invalid');
      }
      addressRecords.push({ owner, address: answer.data, family, ttl: Number(answer.TTL) });
    }
    if (!answers.length) continue;
    let terminalName = queryName;
    const cnameChain = [queryName];
    const visited = new Set<string>();
    let hops = 0;
    while (cnameTargets.has(terminalName)) {
      if (visited.has(terminalName) || hops >= MAX_DOH_CNAME_HOPS) {
        throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS CNAME chain is unsafe');
      }
      visited.add(terminalName);
      terminalName = cnameTargets.get(terminalName)!;
      cnameChain.push(terminalName);
      hops += 1;
    }
    if (
      cnameTargets.size !== hops
      || addressRecords.length === 0
      || addressRecords.some((record) => record.owner !== terminalName)
    ) {
      throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS answer is not chain-bound');
    }
    terminalNames.add(terminalName);
    cnameChains.add(cnameChain.join('>'));
    for (const record of addressRecords) {
      records.push({ address: record.address, family: record.family, ttl: record.ttl });
    }
  }
  if (terminalNames.size > 1 || cnameChains.size > 1) {
    throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS CNAME targets are inconsistent');
  }
  const unique = [...new Map(records.map((record) => [
    `${record.family}:${record.address}`,
    record,
  ])).values()];
  if (!unique.length) {
    throw preflightError('SANDBOX_READONLY_DNS_FAILED', 'Public DNS lookup returned no address');
  }
  return unique.map(({ address }) => ({ address }));
}

async function readBoundedResponse(response: Response, maximumBytes = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw preflightError(
      'SANDBOX_READONLY_RESPONSE_INVALID',
      'Read-only Provider response exceeds the byte limit',
    );
  }
  if (!response.body) {
    throw preflightError('SANDBOX_READONLY_RESPONSE_INVALID', 'Read-only Provider response is empty');
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      totalBytes += bytes.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw preflightError(
          'SANDBOX_READONLY_RESPONSE_INVALID',
          'Read-only Provider response exceeds the byte limit',
        );
      }
      chunks.push(bytes);
    }
    if (!totalBytes) {
      throw preflightError('SANDBOX_READONLY_RESPONSE_INVALID', 'Read-only Provider response is empty');
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    reader.releaseLock();
  }
}

function dashScopeModels(value: unknown): Array<Record<string, unknown>> | null {
  if (!isRecord(value)) return null;
  if (
    !hasExactFields(value, DASHSCOPE_CATALOG_TOP_LEVEL_FIELDS)
    || value.success !== true
    || value.code !== null
    || value.message !== null
    || typeof value.request_id !== 'string'
    || value.request_id.length < 1
    || value.request_id.length > 500
  ) return null;
  const output = isRecord(value.output) ? value.output : null;
  if (
    !output
    || !hasExactFields(output, DASHSCOPE_CATALOG_OUTPUT_FIELDS)
    || output.page_no !== 1
    || output.page_size !== 1
    || !Array.isArray(output.models)
    || output.models.length > 1
    || !Number.isSafeInteger(output.total)
    || output.total !== output.models.length
  ) {
    return null;
  }
  const models = output.models;
  if (!models.every((entry) => (
    isRecord(entry)
    && !Object.keys(entry).some((field) => DASHSCOPE_CATALOG_FORBIDDEN_MODEL_FIELDS.has(field))
    && typeof entry.model === 'string'
    && entry.model.length > 0
    && entry.model.length <= 256
  ))) return null;
  return models as Array<Record<string, unknown>>;
}

function exactModelAvailable(
  value: unknown,
  model: string,
  identity: ReviewedProviderIdentity,
) {
  if (identity.preflightKind === 'DASHSCOPE_MODEL_CATALOG') {
    return dashScopeModels(value)?.some((entry) => entry.model === model) || false;
  }
  return isRecord(value)
    && value.success === true
    && value.object === 'list'
    && Array.isArray(value.data)
    && value.data.some((entry) => isRecord(entry) && entry.id === model);
}

function reviewedProviderIdentity(input: {
  apiBase: string;
  expectedHost: string;
  billingOrigin: string;
  model: string;
}) {
  return REVIEWED_PROVIDER_IDENTITIES.find((identity) => (
    input.apiBase === identity.apiBase
    && input.expectedHost === identity.apiHost
    && input.model === identity.model
    && input.billingOrigin === (identity.billingOrigin || '')
  )) || null;
}

export async function runAiImageProviderReadonlyPreflight(
  options: AiImageProviderReadonlyPreflightOptions = {},
) {
  const environment = options.environment || process.env;
  if (environment.NODE_ENV !== 'sandbox') {
    throw preflightError('SANDBOX_READONLY_CONFIG_INVALID', 'NODE_ENV must equal sandbox');
  }
  if (Object.entries(environment).some(([name, value]) => (
    UNSAFE_ENVIRONMENT_NAMES.has(name.toUpperCase()) && String(value || '').trim()
  ))) {
    throw preflightError(
      'SANDBOX_READONLY_UNSAFE_ENV',
      'Read-only preflight must receive its Provider credential through stdin only',
    );
  }
  const apiBase = requiredEnvironment('AI_IMAGE_SANDBOX_BASE_URL', environment);
  const expectedHost = requiredEnvironment('AI_IMAGE_SANDBOX_EXPECTED_HOST', environment).toLowerCase();
  const model = requiredEnvironment('AI_IMAGE_SANDBOX_MODEL', environment);
  const configuredBillingOrigin = String(
    environment.AI_IMAGE_SANDBOX_BILLING_ORIGIN || '',
  ).trim();
  const billingOrigin = configuredBillingOrigin
    || (apiBase === PACKY_API_BASE ? new URL(PACKY_API_BASE).origin : '');
  const identity = reviewedProviderIdentity({ apiBase, expectedHost, billingOrigin, model });
  if (!identity || (identity.manifestSchemaVersion === 2 && !configuredBillingOrigin)) {
    throw preflightError(
      'SANDBOX_READONLY_PROVIDER_INVALID',
      'Read-only preflight is restricted to a reviewed Provider and billing identity',
    );
  }
  const operationId = requiredEnvironment('AI_IMAGE_SANDBOX_OPERATION_ID', environment);
  const evidenceId = requiredEnvironment('AI_IMAGE_SANDBOX_READONLY_EVIDENCE_ID', environment);
  if (!EVIDENCE_ID_PATTERN.test(operationId) || !EVIDENCE_ID_PATTERN.test(evidenceId)) {
    throw preflightError(
      'SANDBOX_READONLY_CONFIG_INVALID',
      'Read-only Operation ID or evidence ID is invalid',
    );
  }
  const credentialRevision = requiredEnvironment(
    'AI_IMAGE_SANDBOX_CREDENTIAL_REVISION',
    environment,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(credentialRevision)) {
    throw preflightError('SANDBOX_READONLY_CONFIG_INVALID', 'Credential revision is invalid');
  }
  const configuredEvidenceRoot = String(
    environment.AI_IMAGE_SANDBOX_EVIDENCE_ROOT || 'tmp/ai-image-sandbox',
  ).trim();
  if (
    SECRET_SHAPE_PATTERN.test(operationId)
    || SECRET_SHAPE_PATTERN.test(evidenceId)
    || SECRET_SHAPE_PATTERN.test(credentialRevision)
    || SECRET_SHAPE_PATTERN.test(configuredEvidenceRoot)
  ) {
    throw preflightError(
      'SANDBOX_READONLY_CONFIG_INVALID',
      'Read-only non-secret identifiers contain a secret-shaped value',
    );
  }
  const adapterRevision = requiredEnvironment(
    'AI_IMAGE_SANDBOX_ADAPTER_REVISION',
    environment,
  ).toLowerCase();
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(adapterRevision)) {
    throw preflightError('SANDBOX_READONLY_CONFIG_INVALID', 'Adapter revision is invalid');
  }
  const repositoryRoot = options.repositoryRoot
    || resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const resolveRevision = options.resolveRevision || resolveAiImageSandboxRepositoryRevision;
  const repositoryRevision = await resolveRevision(
    repositoryRoot,
    undefined,
    READONLY_PREFLIGHT_TRACKED_PATHS,
    options.requireGitCheckout,
  );
  if (repositoryRevision !== adapterRevision) {
    throw preflightError(
      'SANDBOX_ADAPTER_REVISION_MISMATCH',
      'Read-only preflight revision does not match the deployed code',
    );
  }

  const dnsResolver = options.resolveDns || resolveAiImageProviderPublicDns;
  const pinnedRecordsByHost = new Map<string, Array<{
    address: string;
    family: 4 | 6;
    ttl: number;
  }>>();
  const dnsTargets = [
    { host: identity.apiHost, url: identity.apiBase },
    ...(identity.billingHost && identity.billingOrigin
      ? [{ host: identity.billingHost, url: identity.billingOrigin }]
      : []),
  ];
  for (const target of dnsTargets) {
    if (pinnedRecordsByHost.has(target.host)) continue;
    try {
      const dnsRecords = await dnsResolver(target.host);
      await validateAiImageProviderUrl(target.url, async () => dnsRecords);
      pinnedRecordsByHost.set(target.host, dnsRecords.map((record) => {
        const family = isIP(record.address);
        if (family !== 4 && family !== 6) throw new Error('invalid DNS address');
        return { address: record.address, family, ttl: 60 };
      }));
    } catch {
      throw preflightError(
        'SANDBOX_READONLY_DNS_FAILED',
        'Read-only Provider DNS validation failed',
      );
    }
  }

  let closeTransport: () => Promise<void> = async () => {};
  let fetcher = options.fetch;
  if (!fetcher) {
    const agent = new Agent().compose(interceptors.dns({
      affinity: 4,
      lookup(origin, _lookupOptions, callback) {
        const records = pinnedRecordsByHost.get(origin.hostname.toLowerCase());
        if (!records) {
          callback(Object.assign(new Error('Unexpected read-only Provider host'), { code: 'ENOTFOUND' }), []);
          return;
        }
        callback(null, records);
      },
    }));
    closeTransport = () => agent.close();
    fetcher = (input, init) => undiciFetch(input as any, {
      ...(init as any),
      dispatcher: agent,
    }) as Promise<Response>;
  }

  let credential = '';
  try {
    credential = await (options.readCredential || (() => readAiImageProviderCredential()))();
    if (!/^[\x21-\x7e]{16,512}$/u.test(credential)) {
      throw preflightError(
        'SANDBOX_READONLY_CREDENTIAL_INVALID',
        'Read-only credential input must be one bounded printable ASCII value',
      );
    }
    if ([
      operationId,
      evidenceId,
      credentialRevision,
      configuredEvidenceRoot,
      identity.apiBase,
      identity.billingOrigin || '',
    ].some((value) => (
      value.includes(credential)
    ))) {
      throw preflightError(
        'SANDBOX_READONLY_CONFIG_INVALID',
        'Read-only non-secret identifiers must not contain the credential',
      );
    }
    const captures: CapturedResponse[] = [];
    const capture = async (
      phase: CapturedResponse['phase'],
      name: CapturedResponse['name'],
      uri: string,
      file: string,
    ) => {
      let response: Response;
      try {
        response = await fetcher!(uri, {
          method: 'GET',
          headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
          redirect: 'error',
          credentials: 'omit',
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw preflightError(
          'SANDBOX_READONLY_PROVIDER_FAILED',
          'Read-only Provider request failed before a valid response',
        );
      }
      const contentType = response.headers.get('content-type') || '';
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw preflightError(
          'SANDBOX_READONLY_PROVIDER_REJECTED',
          'Read-only Provider request was rejected',
        );
      }
      if (!contentTypeIs(contentType, 'application/json')) {
        await response.body?.cancel().catch(() => undefined);
        throw preflightError(
          'SANDBOX_READONLY_RESPONSE_INVALID',
          'Read-only Provider response must use JSON',
        );
      }
      const body = await readBoundedResponse(response);
      let parsed: unknown;
      let text = '';
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw preflightError(
          'SANDBOX_READONLY_RESPONSE_INVALID',
          'Read-only Provider response must contain UTF-8 JSON',
        );
      }
      if (contentType.includes(credential) || text.includes(credential) || containsCredential(parsed, credential)) {
        throw preflightError(
          'SANDBOX_READONLY_CREDENTIAL_REFLECTED',
          'Read-only Provider response reflected the credential',
        );
      }
      const result: CapturedResponse = {
        phase,
        name,
        method: 'GET',
        uri,
        httpStatus: 200,
        contentType: 'application/json',
        observedAt: timestamp(options),
        bytes: body.byteLength,
        sha256: sha256(body),
        file,
        body,
        parsed,
      };
      captures.push(result);
      assertExpectedResponseSchema(name, parsed, identity);
      return result;
    };

    if (identity.preflightKind === 'DASHSCOPE_MODEL_CATALOG') {
      const modelsEndpoint = new URL(`${apiBase}/models`);
      modelsEndpoint.searchParams.set('model', model);
      modelsEndpoint.searchParams.set('page_no', '1');
      modelsEndpoint.searchParams.set('page_size', '1');
      const models = await capture(
        'CHECK',
        'models',
        modelsEndpoint.toString(),
        'check-models.json',
      );
      if (!exactModelAvailable(models.parsed, model, identity)) {
        throw preflightError(
          'SANDBOX_READONLY_MODEL_UNAVAILABLE',
          'Read-only Provider catalogue does not expose the exact model',
        );
      }
    } else {
      const billingOriginValue = identity.billingOrigin!;
      const endpoints = {
        tokenUsage: `${billingOriginValue}/api/usage/token/`,
        displayUsage: `${billingOriginValue}/v1/dashboard/billing/usage`,
        tokenLog: `${billingOriginValue}/api/log/token`,
        models: `${apiBase}/models`,
      } as const;
      const before = {
        tokenUsage: await capture('BEFORE', 'tokenUsage', endpoints.tokenUsage, 'before-tokenUsage.json'),
        displayUsage: await capture(
          'BEFORE',
          'displayUsage',
          endpoints.displayUsage,
          'before-displayUsage.json',
        ),
        tokenLog: await capture('BEFORE', 'tokenLog', endpoints.tokenLog, 'before-tokenLog.json'),
      };
      const models = await capture('CHECK', 'models', endpoints.models, 'check-models.json');
      if (!exactModelAvailable(models.parsed, model, identity)) {
        throw preflightError(
          'SANDBOX_READONLY_MODEL_UNAVAILABLE',
          'Read-only Provider catalogue does not expose the exact model',
        );
      }
      const after = {
        tokenUsage: await capture('AFTER', 'tokenUsage', endpoints.tokenUsage, 'after-tokenUsage.json'),
        displayUsage: await capture(
          'AFTER',
          'displayUsage',
          endpoints.displayUsage,
          'after-displayUsage.json',
        ),
        tokenLog: await capture('AFTER', 'tokenLog', endpoints.tokenLog, 'after-tokenLog.json'),
      };
      const metersUnchanged = (
        before.tokenUsage.body.equals(after.tokenUsage.body)
        && before.displayUsage.body.equals(after.displayUsage.body)
        && before.tokenLog.body.equals(after.tokenLog.body)
      );
      if (!metersUnchanged) {
        throw preflightError(
          'SANDBOX_READONLY_METERS_CHANGED',
          'Read-only Provider meters changed during the observation window',
        );
      }
    }
    if (!captures.length) {
      throw preflightError(
        'SANDBOX_READONLY_PROVIDER_FAILED',
        'Read-only Provider preflight captured no evidence',
      );
    }

    const records = captures.map(({ body: _body, parsed: _parsed, ...record }) => record);
    const manifest = identity.manifestSchemaVersion === 1
      ? {
          schemaVersion: 1,
          event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT',
          operationId,
          credentialRevision,
          adapterRevision,
          apiBase,
          model,
          metersUnchanged: true,
          providerPostSent: false,
          chargeObserved: false,
          records,
        }
      : identity.manifestSchemaVersion === 2
        ? {
            schemaVersion: 2,
            event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT',
            operationId,
            credentialRevision,
            adapterRevision,
            apiBase,
            billingOrigin: identity.billingOrigin,
            model,
            metersUnchanged: true,
            providerPostSent: false,
            chargeObserved: false,
            records,
          }
        : {
            schemaVersion: 3,
            event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT',
            operationId,
            credentialRevision,
            adapterRevision,
            apiBase,
            model,
            authenticationVerified: true,
            exactModelListed: true,
            billingMeterStatus: 'SEPARATE_EVIDENCE_REQUIRED',
            providerPostSent: false,
            chargeObserved: false,
            editCapabilityVerified: false,
            records,
          };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const manifestSha256 = sha256(manifestBytes);
    let outputDirectory = '';
    try {
      const bundle = await writeAiImageSandboxPrivateEvidenceBundle({
        repositoryRoot,
        evidenceRoot: configuredEvidenceRoot,
        directoryName: evidenceId,
        files: [
          ...captures.map((record) => ({ name: record.file, bytes: record.body })),
          { name: 'manifest.json', bytes: manifestBytes },
        ],
        beforeEntryWrite: options.beforeEvidenceWrite,
      });
      outputDirectory = bundle.outputDirectory;
    } catch {
      throw preflightError(
        'SANDBOX_READONLY_EVIDENCE_UNSAFE',
        'Read-only evidence could not be written to a stable private directory',
      );
    }
    const event = identity.manifestSchemaVersion === 1
      ? {
          schemaVersion: 1,
          event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_COMPLETED',
          operationId,
          credentialRevision,
          adapterRevision,
          model,
          apiBaseSha256: sha256(apiBase),
          manifestSha256,
          metersUnchanged: true,
          providerPostSent: false,
          chargeObserved: false,
        }
      : identity.manifestSchemaVersion === 2
        ? {
            schemaVersion: 2,
            event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_COMPLETED',
            operationId,
            credentialRevision,
            adapterRevision,
            model,
            apiBaseSha256: sha256(apiBase),
            billingOriginSha256: sha256(identity.billingOrigin!),
            manifestSha256,
            metersUnchanged: true,
            providerPostSent: false,
            chargeObserved: false,
          }
        : {
            schemaVersion: 3,
            event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_COMPLETED',
            operationId,
            credentialRevision,
            adapterRevision,
            model,
            apiBaseSha256: sha256(apiBase),
            manifestSha256,
            authenticationVerified: true,
            exactModelListed: true,
            billingMeterStatus: 'SEPARATE_EVIDENCE_REQUIRED',
            providerPostSent: false,
            chargeObserved: false,
            editCapabilityVerified: false,
          };
    process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
    return { manifest, manifestSha256, outputDirectory };
  } finally {
    credential = '';
    await closeTransport();
  }
}

const isDirectRun = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  const fail = (error: unknown) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_FAILED',
      failureCode: safeFailureCode(error),
    })}\n`);
    process.stderr.write('AI image Provider read-only preflight failed.\n');
    process.exitCode = 1;
  };
  if (process.argv.slice(2).length > 0) {
    fail(preflightError(
      'SANDBOX_READONLY_ARGUMENT_INVALID',
      'Read-only preflight does not accept command-line arguments',
    ));
  } else {
    runAiImageProviderReadonlyPreflight({ requireGitCheckout: true }).catch(fail);
  }
}
