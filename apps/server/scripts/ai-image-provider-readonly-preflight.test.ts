import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readAiImageProviderCredential,
  resolveAiImageProviderPublicDns,
  runAiImageProviderReadonlyPreflight,
} from './ai-image-provider-readonly-preflight.js';

const roots: string[] = [];
const adapterRevision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
const credential = 'sk-test-readonly-preflight-never-log';

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-readonly-'));
  roots.push(root);
  await mkdir(join(root, 'tmp', 'ai-image-sandbox'), { recursive: true, mode: 0o700 });
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'sandbox',
    AI_IMAGE_SANDBOX_BASE_URL: 'https://www.packyapi.ai/v1',
    AI_IMAGE_SANDBOX_EXPECTED_HOST: 'www.packyapi.ai',
    AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
    AI_IMAGE_SANDBOX_OPERATION_ID: 'qa02-packy-i2i-main-test-0001',
    AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'packy-sora-key-test-0001',
    AI_IMAGE_SANDBOX_ADAPTER_REVISION: adapterRevision,
    AI_IMAGE_SANDBOX_READONLY_EVIDENCE_ID: 'packy-readonly-test-0001',
  };
  return {
    root,
    evidenceId: 'packy-readonly-test-0001',
    environment,
  };
}

async function xiaoyiFixture() {
  const value = await fixture();
  value.environment.AI_IMAGE_SANDBOX_BASE_URL = 'https://image.xiaoyiapi.xyz/v1';
  value.environment.AI_IMAGE_SANDBOX_EXPECTED_HOST = 'image.xiaoyiapi.xyz';
  value.environment.AI_IMAGE_SANDBOX_BILLING_ORIGIN = 'https://xiaoyiapi.xyz';
  value.environment.AI_IMAGE_SANDBOX_OPERATION_ID = 'qa02-xiaoyi-i2i-main-test-0001';
  value.environment.AI_IMAGE_SANDBOX_CREDENTIAL_REVISION = 'xiaoyi-key-test-0001';
  value.environment.AI_IMAGE_SANDBOX_READONLY_EVIDENCE_ID = 'xiaoyi-readonly-test-0001';
  return { ...value, evidenceId: 'xiaoyi-readonly-test-0001' };
}

async function wanxFixture() {
  const value = await fixture();
  value.environment.AI_IMAGE_SANDBOX_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
  value.environment.AI_IMAGE_SANDBOX_EXPECTED_HOST = 'dashscope.aliyuncs.com';
  value.environment.AI_IMAGE_SANDBOX_MODEL = 'wanx2.1-imageedit';
  value.environment.AI_IMAGE_SANDBOX_OPERATION_ID = 'qa02-wanx-i2i-main-test-0001';
  value.environment.AI_IMAGE_SANDBOX_CREDENTIAL_REVISION = 'wanx-key-test-0001';
  value.environment.AI_IMAGE_SANDBOX_READONLY_EVIDENCE_ID = 'wanx-readonly-test-0001';
  return { ...value, evidenceId: 'wanx-readonly-test-0001' };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function successfulFetch(overrides: {
  changedMeter?: 'tokenUsage' | 'displayUsage' | 'tokenLog';
  invalidMeter?: 'tokenUsage' | 'displayUsage' | 'tokenLog';
  emptyTokenLog?: boolean;
  model?: string;
  modelSuccess?: boolean;
} = {}) {
  const calls = { tokenUsage: 0, displayUsage: 0, tokenLog: 0 };
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${credential}`);
    expect(init?.body).toBeUndefined();
    const url = new URL(String(input));
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('www.packyapi.ai');
    expect(url.port).toBe('');
    expect(url.search).toBe('');
    if (url.pathname === '/api/usage/token/') {
      calls.tokenUsage += 1;
      if (overrides.invalidMeter === 'tokenUsage') return jsonResponse({});
      return jsonResponse({
        code: true,
        data: {
          object: 'credit_summary',
          total_available: overrides.changedMeter === 'tokenUsage' && calls.tokenUsage === 2
            ? 9_999
            : 10_000,
          total_granted: 10_000,
          total_used: 0,
          unlimited_quota: false,
        },
        message: '',
      });
    }
    if (url.pathname === '/v1/dashboard/billing/usage') {
      calls.displayUsage += 1;
      if (overrides.invalidMeter === 'displayUsage') return jsonResponse({});
      return jsonResponse({
        object: 'billing_usage',
        total_usage: overrides.changedMeter === 'displayUsage' && calls.displayUsage === 2 ? 1 : 0,
      });
    }
    if (url.pathname === '/api/log/token') {
      calls.tokenLog += 1;
      if (overrides.invalidMeter === 'tokenLog') return jsonResponse({});
      if (overrides.emptyTokenLog) {
        return jsonResponse({ message: 'record not found', success: false });
      }
      return jsonResponse({
        message: overrides.changedMeter === 'tokenLog' && calls.tokenLog === 2 ? 'changed' : '',
        success: true,
      });
    }
    if (url.pathname === '/v1/models') {
      return jsonResponse({
        data: [{ id: overrides.model || 'gpt-image-2', object: 'model' }],
        object: 'list',
        success: overrides.modelSuccess ?? true,
      });
    }
    throw new Error(`Unexpected URL ${url.pathname}`);
  });
}

function successfulXiaoyiFetch() {
  const calls = { tokenUsage: 0, displayUsage: 0, tokenLog: 0 };
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${credential}`);
    expect(init?.body).toBeUndefined();
    const url = new URL(String(input));
    expect(url.protocol).toBe('https:');
    expect(url.port).toBe('');
    expect(url.search).toBe('');
    if (url.hostname === 'image.xiaoyiapi.xyz' && url.pathname === '/v1/models') {
      return jsonResponse({
        data: [{ id: 'gpt-image-2', object: 'model' }],
        object: 'list',
        success: true,
      });
    }
    expect(url.hostname).toBe('xiaoyiapi.xyz');
    if (url.pathname === '/api/usage/token/') {
      calls.tokenUsage += 1;
      return jsonResponse({
        code: true,
        data: {
          object: 'credit_summary',
          total_available: 10_000,
          total_granted: 10_000,
          total_used: 0,
          unlimited_quota: false,
        },
        message: '',
      });
    }
    if (url.pathname === '/v1/dashboard/billing/usage') {
      calls.displayUsage += 1;
      return jsonResponse({ object: 'billing_usage', total_usage: 0 });
    }
    if (url.pathname === '/api/log/token') {
      calls.tokenLog += 1;
      return jsonResponse({ message: 'record not found', success: false });
    }
    throw new Error(`Unexpected URL ${url.toString()}`);
  });
}

// Sanitized key/type fixture from private body SHA-256
// a30c5462e64fd10ad118231784569c8f2deb3f9500283c25ebe30ec87e5cf2cb.
function observedWanxModelRow(model = 'wanx2.1-imageedit') {
  return {
    capabilities: [],
    description: 'redacted',
    equivalent_snapshot: null,
    features: [],
    inference_metadata: {},
    inference_provider: 'redacted',
    model,
    model_info: {},
    name: 'redacted',
    prices: [],
    provider: 'redacted',
    published_time: 'redacted',
  };
}

function successfulWanxFetch(overrides: {
  model?: string;
  requestId?: unknown;
  models?: unknown;
  envelope?: 'output' | 'data';
  success?: unknown;
  code?: unknown;
  message?: unknown;
  pageNo?: unknown;
  pageSize?: unknown;
  total?: unknown;
  topLevelExtras?: Record<string, unknown>;
  outputExtras?: Record<string, unknown>;
} = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${credential}`);
    expect(init?.body).toBeUndefined();
    const url = new URL(String(input));
    expect(url.origin).toBe('https://dashscope.aliyuncs.com');
    expect(url.pathname).toBe('/api/v1/models');
    expect([...url.searchParams.entries()]).toEqual([
      ['model', 'wanx2.1-imageedit'],
      ['page_no', '1'],
      ['page_size', '1'],
    ]);
    const models = overrides.models ?? [observedWanxModelRow(overrides.model)];
    const body = {
      success: overrides.success === undefined ? true : overrides.success,
      code: overrides.code === undefined ? null : overrides.code,
      message: overrides.message === undefined ? null : overrides.message,
      request_id: overrides.requestId === undefined ? 'dashscope-readonly-request-1' : overrides.requestId,
      ...overrides.topLevelExtras,
      [overrides.envelope || 'output']: {
        models,
        page_no: overrides.pageNo === undefined ? 1 : overrides.pageNo,
        page_size: overrides.pageSize === undefined ? 1 : overrides.pageSize,
        total: overrides.total === undefined && Array.isArray(models)
          ? models.length
          : overrides.total,
        ...overrides.outputExtras,
      },
    };
    return jsonResponse(body);
  });
}

describe('AI image Provider read-only preflight', () => {
  it('captures one private GET-only Packy evidence set without persisting or printing the credential', async () => {
    const value = await fixture();
    const fetch = successfulFetch();
    const stdout: string[] = [];
    const writeOrder: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const result = await runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
      now: vi.fn(() => new Date('2030-01-01T00:00:00.000Z')),
      beforeEvidenceWrite: ({ name }) => {
        writeOrder.push(name);
      },
    });

    expect(fetch).toHaveBeenCalledTimes(7);
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      'https://www.packyapi.ai/api/usage/token/',
      'https://www.packyapi.ai/v1/dashboard/billing/usage',
      'https://www.packyapi.ai/api/log/token',
      'https://www.packyapi.ai/v1/models',
      'https://www.packyapi.ai/api/usage/token/',
      'https://www.packyapi.ai/v1/dashboard/billing/usage',
      'https://www.packyapi.ai/api/log/token',
    ]);
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT',
      operationId: value.environment.AI_IMAGE_SANDBOX_OPERATION_ID,
      credentialRevision: value.environment.AI_IMAGE_SANDBOX_CREDENTIAL_REVISION,
      adapterRevision,
      apiBase: 'https://www.packyapi.ai/v1',
      model: 'gpt-image-2',
      metersUnchanged: true,
      providerPostSent: false,
      chargeObserved: false,
    });
    expect(Object.keys(result.manifest)).toEqual([
      'schemaVersion',
      'event',
      'operationId',
      'credentialRevision',
      'adapterRevision',
      'apiBase',
      'model',
      'metersUnchanged',
      'providerPostSent',
      'chargeObserved',
      'records',
    ]);
    expect(result.manifest.records).toHaveLength(7);
    expect(result.manifest.records.every((record) => record.contentType === 'application/json'))
      .toBe(true);
    expect(result.manifest.records.map((record) => `${record.phase}:${record.name}`)).toEqual([
      'BEFORE:tokenUsage',
      'BEFORE:displayUsage',
      'BEFORE:tokenLog',
      'CHECK:models',
      'AFTER:tokenUsage',
      'AFTER:displayUsage',
      'AFTER:tokenLog',
    ]);
    const files = await readdir(result.outputDirectory);
    expect(files.sort()).toEqual([
      'after-displayUsage.json',
      'after-tokenLog.json',
      'after-tokenUsage.json',
      'before-displayUsage.json',
      'before-tokenLog.json',
      'before-tokenUsage.json',
      'check-models.json',
      'manifest.json',
    ]);
    expect(writeOrder).toHaveLength(8);
    expect(writeOrder.at(-1)).toBe('manifest.json');
    const stored = (await Promise.all(files.map((name) => (
      readFile(join(result.outputDirectory, name), 'utf8')
    )))).join('\n');
    const manifestBytes = await readFile(join(result.outputDirectory, 'manifest.json'));
    expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(result.manifestSha256);
    expect(manifestBytes.toString('utf8')).toBe(`${JSON.stringify(result.manifest, null, 2)}\n`);
    expect(stored).not.toContain(credential);
    expect(stored).not.toContain('authorization');
    expect(stdout.join('')).toContain(result.manifestSha256);
    expect(stdout.join('')).not.toContain(credential);
    expect(stdout.join('')).not.toContain('https://www.packyapi.ai');
  });

  it('captures one reviewed dual-origin Xiaoyi GET-only evidence set', async () => {
    const value = await xiaoyiFixture();
    const fetch = successfulXiaoyiFetch();
    const resolveDns = vi.fn(async (hostname: string) => (
      hostname === 'image.xiaoyiapi.xyz'
        ? [{ address: '93.184.216.34' }]
        : [{ address: '1.1.1.1' }]
    ));
    const stdout: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const result = await runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns,
      fetch,
      readCredential: vi.fn(async () => credential),
      now: vi.fn(() => new Date('2030-01-01T00:00:00.000Z')),
    });

    expect(resolveDns.mock.calls.map(([hostname]) => hostname)).toEqual([
      'image.xiaoyiapi.xyz',
      'xiaoyiapi.xyz',
    ]);
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      'https://xiaoyiapi.xyz/api/usage/token/',
      'https://xiaoyiapi.xyz/v1/dashboard/billing/usage',
      'https://xiaoyiapi.xyz/api/log/token',
      'https://image.xiaoyiapi.xyz/v1/models',
      'https://xiaoyiapi.xyz/api/usage/token/',
      'https://xiaoyiapi.xyz/v1/dashboard/billing/usage',
      'https://xiaoyiapi.xyz/api/log/token',
    ]);
    expect(result.manifest).toMatchObject({
      schemaVersion: 2,
      event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT',
      apiBase: 'https://image.xiaoyiapi.xyz/v1',
      billingOrigin: 'https://xiaoyiapi.xyz',
      model: 'gpt-image-2',
      metersUnchanged: true,
      providerPostSent: false,
      chargeObserved: false,
    });
    expect(Object.keys(result.manifest)).toEqual([
      'schemaVersion',
      'event',
      'operationId',
      'credentialRevision',
      'adapterRevision',
      'apiBase',
      'billingOrigin',
      'model',
      'metersUnchanged',
      'providerPostSent',
      'chargeObserved',
      'records',
    ]);
    const event = JSON.parse(stdout.join('')) as Record<string, unknown>;
    expect(event).toMatchObject({
      schemaVersion: 2,
      event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_COMPLETED',
      manifestSha256: result.manifestSha256,
    });
    expect(event.apiBaseSha256).toBe(createHash('sha256')
      .update('https://image.xiaoyiapi.xyz/v1').digest('hex'));
    expect(event.billingOriginSha256).toBe(createHash('sha256')
      .update('https://xiaoyiapi.xyz').digest('hex'));
    expect(stdout.join('')).not.toContain('xiaoyiapi.xyz');
    expect(stdout.join('')).not.toContain(credential);
  });

  it('captures one catalog-only Wanx GET without claiming billing or edit capability', async () => {
    const value = await wanxFixture();
    const fetch = successfulWanxFetch();
    const resolveRevision = vi.fn(async () => adapterRevision);
    const stdout: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const result = await runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision,
      resolveDns: vi.fn(async () => [{ address: '47.74.1.1' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
      now: vi.fn(() => new Date('2030-01-01T00:00:00.000Z')),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://dashscope.aliyuncs.com/api/v1/models?model=wanx2.1-imageedit&page_no=1&page_size=1',
    );
    expect(resolveRevision).toHaveBeenCalledWith(
      value.root,
      undefined,
      expect.arrayContaining(['apps/server/src/services/ai-image-wanx-edit-profile.ts']),
      undefined,
    );
    expect(result.manifest).toEqual({
      schemaVersion: 3,
      event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT',
      operationId: value.environment.AI_IMAGE_SANDBOX_OPERATION_ID,
      credentialRevision: value.environment.AI_IMAGE_SANDBOX_CREDENTIAL_REVISION,
      adapterRevision,
      apiBase: 'https://dashscope.aliyuncs.com/api/v1',
      model: 'wanx2.1-imageedit',
      authenticationVerified: true,
      exactModelListed: true,
      billingMeterStatus: 'SEPARATE_EVIDENCE_REQUIRED',
      providerPostSent: false,
      chargeObserved: false,
      editCapabilityVerified: false,
      records: [{
        phase: 'CHECK',
        name: 'models',
        method: 'GET',
        uri: 'https://dashscope.aliyuncs.com/api/v1/models?model=wanx2.1-imageedit&page_no=1&page_size=1',
        httpStatus: 200,
        contentType: 'application/json',
        observedAt: '2030-01-01T00:00:00.000Z',
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        file: 'check-models.json',
      }],
    });
    expect((await readdir(result.outputDirectory)).sort()).toEqual([
      'check-models.json',
      'manifest.json',
    ]);
    const stored = `${await readFile(join(result.outputDirectory, 'check-models.json'), 'utf8')}${
      await readFile(join(result.outputDirectory, 'manifest.json'), 'utf8')
    }`;
    expect(stored).not.toContain(credential);
    expect(stdout.join('')).not.toContain(credential);
    expect(JSON.parse(stdout.join(''))).toEqual({
      schemaVersion: 3,
      event: 'AI_IMAGE_PROVIDER_READONLY_PREFLIGHT_COMPLETED',
      operationId: value.environment.AI_IMAGE_SANDBOX_OPERATION_ID,
      credentialRevision: value.environment.AI_IMAGE_SANDBOX_CREDENTIAL_REVISION,
      adapterRevision,
      model: 'wanx2.1-imageedit',
      apiBaseSha256: createHash('sha256')
        .update('https://dashscope.aliyuncs.com/api/v1').digest('hex'),
      manifestSha256: result.manifestSha256,
      authenticationVerified: true,
      exactModelListed: true,
      billingMeterStatus: 'SEPARATE_EVIDENCE_REQUIRED',
      providerPostSent: false,
      chargeObserved: false,
      editCapabilityVerified: false,
    });
  });

  it.each([
    ['OpenAI-style data envelope', { envelope: 'data' as const }],
    ['missing request ID', { requestId: null }],
    ['oversized request ID', { requestId: 'x'.repeat(501) }],
    ['multiple models despite page size one', {
      models: [{ model: 'wanx2.1-imageedit' }, { model: 'another-model' }],
    }],
    ['legacy model_id instead of model', { models: [{ model_id: 'wanx2.1-imageedit' }] }],
    ['id instead of model', { models: [{ id: 'wanx2.1-imageedit' }] }],
    ['false success flag', { success: false }],
    ['non-null code', { code: 'UnexpectedCode' }],
    ['non-null message', { message: 'unexpected message' }],
    ['wrong page number', { pageNo: 2 }],
    ['wrong page size', { pageSize: 2 }],
    ['total inconsistent with rows', { total: 0 }],
    ['mixed output and data envelopes', { topLevelExtras: { data: { error: 'denied' } } }],
    ['top-level error field', { topLevelExtras: { error: 'denied' } }],
    ['output error field', { outputExtras: { error: 'denied' } }],
    ['model mixed with legacy model_id', {
      models: [{ ...observedWanxModelRow(), model_id: 'different-model' }],
    }],
    ['model mixed with id', {
      models: [{ ...observedWanxModelRow(), id: 'different-model' }],
    }],
    ['model mixed with row error', {
      models: [{ ...observedWanxModelRow(), error: 'denied' }],
    }],
  ])('rejects a noncanonical DashScope catalogue: %s', async (_label, overrides) => {
    const value = await wanxFixture();
    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '47.74.1.1' }]),
      fetch: successfulWanxFetch(overrides),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_SCHEMA_INVALID' });
  });

  it('rejects a canonical DashScope catalogue that omits the exact model', async () => {
    const value = await wanxFixture();
    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '47.74.1.1' }]),
      fetch: successfulWanxFetch({ model: 'wanx-other-model' }),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_MODEL_UNAVAILABLE' });
  });

  it('treats an observed empty page with total zero as exact-model unavailable', async () => {
    const value = await wanxFixture();
    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '47.74.1.1' }]),
      fetch: successfulWanxFetch({ models: [], total: 0 }),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_MODEL_UNAVAILABLE' });
  });

  it.each([
    ['workspace API base', 'AI_IMAGE_SANDBOX_BASE_URL', 'https://workspace-1.cn-beijing.maas.aliyuncs.com/api/v1'],
    ['workspace expected host', 'AI_IMAGE_SANDBOX_EXPECTED_HOST', 'workspace-1.cn-beijing.maas.aliyuncs.com'],
    ['different model', 'AI_IMAGE_SANDBOX_MODEL', 'wanx2.1-t2i-turbo'],
    ['billing origin', 'AI_IMAGE_SANDBOX_BILLING_ORIGIN', 'https://dashscope.aliyuncs.com'],
  ])('rejects Wanx legacy identity mixing: %s', async (_label, name, replacement) => {
    const value = await wanxFixture();
    value.environment[name] = replacement;
    const readCredential = vi.fn(async () => credential);
    const resolveDns = vi.fn(async () => [{ address: '47.74.1.1' }]);
    const fetch = successfulWanxFetch();

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns,
      fetch,
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_PROVIDER_INVALID' });
    expect(readCredential).not.toHaveBeenCalled();
    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing billing origin', 'AI_IMAGE_SANDBOX_BILLING_ORIGIN', undefined],
    ['wrong billing origin', 'AI_IMAGE_SANDBOX_BILLING_ORIGIN', 'https://image.xiaoyiapi.xyz'],
    ['billing origin slash', 'AI_IMAGE_SANDBOX_BILLING_ORIGIN', 'https://xiaoyiapi.xyz/'],
    ['billing origin query', 'AI_IMAGE_SANDBOX_BILLING_ORIGIN', 'https://xiaoyiapi.xyz?x=1'],
    ['wrong API host', 'AI_IMAGE_SANDBOX_EXPECTED_HOST', 'xiaoyiapi.xyz'],
    ['API Base slash', 'AI_IMAGE_SANDBOX_BASE_URL', 'https://image.xiaoyiapi.xyz/v1/'],
    ['wrong model', 'AI_IMAGE_SANDBOX_MODEL', 'gpt-image-2-vip'],
  ])('rejects Xiaoyi identity mixing: %s', async (_label, name, replacement) => {
    const value = await xiaoyiFixture();
    if (replacement === undefined) delete value.environment[name];
    else value.environment[name] = replacement;
    const resolveDns = vi.fn();
    const readCredential = vi.fn(async () => credential);

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns,
      fetch: successfulXiaoyiFetch(),
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_PROVIDER_INVALID' });
    expect(resolveDns).not.toHaveBeenCalled();
    expect(readCredential).not.toHaveBeenCalled();
  });

  it.each(['image.xiaoyiapi.xyz', 'xiaoyiapi.xyz'])(
    'rejects a private Xiaoyi %s resolution before reading the credential',
    async (privateHost) => {
      const value = await xiaoyiFixture();
      const readCredential = vi.fn(async () => credential);
      const fetch = successfulXiaoyiFetch();

      await expect(runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async (hostname: string) => (
          hostname === privateHost
            ? [{ address: '127.0.0.1' }]
            : [{ address: '93.184.216.34' }]
        )),
        fetch,
        readCredential,
      })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
      expect(readCredential).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects UTF-16 or control-bearing stdin before constructing an Authorization header', async () => {
    const utf16 = Buffer.from(credential, 'utf16le');
    await expect(readAiImageProviderCredential(Readable.from([utf16])))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_CREDENTIAL_INVALID' });
  });

  it('accepts one chunked UTF-8 credential with a single final newline', async () => {
    await expect(readAiImageProviderCredential(Readable.from([
      Buffer.from(credential.slice(0, 8), 'utf8'),
      Buffer.from(`${credential.slice(8)}\n`, 'utf8'),
    ]))).resolves.toBe(credential);
  });

  it.each([
    ['empty input', Buffer.alloc(0)],
    ['UTF-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(credential)])],
    ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0xfd])],
    ['embedded newline', Buffer.from(`${credential}\nsecond-line`, 'utf8')],
    ['embedded NUL', Buffer.from(`${credential}\0suffix`, 'utf8')],
    ['oversized input', Buffer.alloc(1_025, 0x61)],
  ])('rejects %s without returning credential bytes', async (_label, bytes) => {
    await expect(readAiImageProviderCredential(Readable.from([bytes])))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_CREDENTIAL_INVALID' });
  });

  it.each([
    'AI_IMAGE_SANDBOX_API_KEY',
    'AI_IMAGE_SANDBOX_TOKEN',
    'PACKY_API_KEY',
    'PACKY_TOKEN',
    'XIAOYI_API_KEY',
    'XIAOYI_TOKEN',
  ])('rejects Provider secret environment variable %s before stdin or network', async (name) => {
    const value = await fixture();
    value.environment[name] = credential;
    const readCredential = vi.fn(async () => credential);
    const fetch = successfulFetch();

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_UNSAFE_ENV' });
    expect(readCredential).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['tokenUsage', 'displayUsage', 'tokenLog'] as const)(
    'fails without evidence when GET-only %s changes during the observation window',
    async (changedMeter) => {
    const value = await fixture();
    const fetch = successfulFetch({ changedMeter });

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_METERS_CHANGED' });
    await expect(readdir(join(value.root, 'tmp', 'ai-image-sandbox', value.evidenceId)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('accepts the exact Packy empty Token-log envelope', async () => {
    const value = await fixture();
    const result = await runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: successfulFetch({ emptyTokenLog: true }),
      readCredential: vi.fn(async () => credential),
    });
    expect(result.manifest).toMatchObject({
      metersUnchanged: true,
      providerPostSent: false,
      chargeObserved: false,
    });
  });

  it.each([
    { message: 'permission denied', success: false },
    { message: 'record not found', success: false, data: [] },
    { message: 'record not found', success: false, error: true },
  ])('rejects a noncanonical failed Token-log envelope', async (tokenLog) => {
    const value = await fixture();
    const fetch = successfulFetch();
    fetch.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/log/token') return jsonResponse(tokenLog);
      if (url.pathname === '/api/usage/token/') {
        return jsonResponse({
          code: true,
          data: {
            object: 'credit_summary',
            total_available: 10_000,
            total_granted: 10_000,
            total_used: 0,
            unlimited_quota: false,
          },
          message: '',
        });
      }
      if (url.pathname === '/v1/dashboard/billing/usage') {
        return jsonResponse({ object: 'billing_usage', total_usage: 0 });
      }
      return jsonResponse({
        data: [{ id: 'gpt-image-2', object: 'model' }],
        object: 'list',
        success: true,
      });
    });
    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_SCHEMA_INVALID' });
  });

  it.each(['tokenUsage', 'displayUsage', 'tokenLog'] as const)(
    'rejects an invalid %s response schema',
    async (invalidMeter) => {
      const value = await fixture();

      await expect(runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
        fetch: successfulFetch({ invalidMeter }),
        readCredential: vi.fn(async () => credential),
      })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_SCHEMA_INVALID' });
    },
  );

  it('rejects a catalogue that does not expose the exact model', async () => {
    const value = await fixture();

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: successfulFetch({ model: 'other-model' }),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_MODEL_UNAVAILABLE' });
  });

  it('rejects a failed catalogue envelope even if it contains the model text', async () => {
    const value = await fixture();

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: successfulFetch({ modelSuccess: false }),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_SCHEMA_INVALID' });
  });

  it('rejects an unexpected Provider identity before reading the credential', async () => {
    const value = await fixture();
    value.environment.AI_IMAGE_SANDBOX_BASE_URL = 'https://relay.example/v1';
    value.environment.AI_IMAGE_SANDBOX_EXPECTED_HOST = 'relay.example';
    const readCredential = vi.fn(async () => credential);

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: successfulFetch(),
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_PROVIDER_INVALID' });
    expect(readCredential).not.toHaveBeenCalled();
  });

  it('rejects a malformed unreviewed API Base before DNS or credential input', async () => {
    const value = await fixture();
    value.environment.AI_IMAGE_SANDBOX_BASE_URL = 'not-a-url';
    const resolveDns = vi.fn();
    const readCredential = vi.fn(async () => credential);

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns,
      fetch: successfulFetch(),
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_PROVIDER_INVALID' });
    expect(resolveDns).not.toHaveBeenCalled();
    expect(readCredential).not.toHaveBeenCalled();
  });

  it('rejects revision drift before DNS, credential input, or Provider fetch', async () => {
    const value = await fixture();
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const readCredential = vi.fn(async () => credential);
    const fetch = successfulFetch();

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => 'a'.repeat(40)),
      resolveDns,
      fetch,
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(resolveDns).not.toHaveBeenCalled();
    expect(readCredential).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'AI_IMAGE_SANDBOX_OPERATION_ID',
    'AI_IMAGE_SANDBOX_READONLY_EVIDENCE_ID',
    'AI_IMAGE_SANDBOX_CREDENTIAL_REVISION',
    'AI_IMAGE_SANDBOX_EVIDENCE_ROOT',
  ])('rejects a secret-shaped non-secret field %s', async (name) => {
    const value = await fixture();
    value.environment[name] = 'sk-secret-shaped-identifier-0001';
    const readCredential = vi.fn(async () => credential);

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: successfulFetch(),
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_CONFIG_INVALID' });
    expect(readCredential).not.toHaveBeenCalled();
  });

  it('does not include a reflected credential or Provider body in its failure', async () => {
    const value = await fixture();
    const fetch = vi.fn(async () => jsonResponse({ message: credential }, 403));

    let failure: unknown;
    try {
      await runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
        fetch,
        readCredential: vi.fn(async () => credential),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'SANDBOX_READONLY_PROVIDER_REJECTED' });
    expect(String((failure as Error).message)).not.toContain(credential);
  });

  it('discards a network exception that contains the credential', async () => {
    const value = await fixture();
    const fetch = vi.fn(async () => {
      throw new Error(`private transport failure Bearer ${credential}`);
    });

    let failure: unknown;
    try {
      await runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
        fetch,
        readCredential: vi.fn(async () => credential),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'SANDBOX_READONLY_PROVIDER_FAILED' });
    expect(String((failure as Error).message)).not.toContain(credential);
  });

  it('rejects a successful response that reflects the credential', async () => {
    const value = await fixture();
    const fetch = vi.fn(async () => jsonResponse({ reflected: credential }));

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_CREDENTIAL_REFLECTED' });
  });

  it('rejects a JSON-escaped credential before schema validation or persistence', async () => {
    const value = await fixture();
    const escaped = [...credential]
      .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('');
    const fetch = vi.fn(async () => new Response(
      `{"code":0,"data":{"value":"${escaped}"},"message":""}`,
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_CREDENTIAL_REFLECTED' });
  });

  it('normalizes Content-Type and rejects a credential reflected in that header', async () => {
    const value = await fixture();
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: { quota: 10_000 },
      message: '',
    }), {
      status: 200,
      headers: { 'content-type': `application/json; x-private=${credential}` },
    }));

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_CREDENTIAL_REFLECTED' });
  });

  it('rejects an oversized response before buffering its body', async () => {
    const value = await fixture();
    const fetch = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': '1048577',
      },
    }));

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_INVALID' });
  });

  it('cancels a streamed response that crosses the byte limit', async () => {
    const value = await fixture();
    const fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(700_000));
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch,
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_INVALID' });
  });

  it.each([
    [[{ address: '127.0.0.1' }]],
    [[{ address: '93.184.216.34' }, { address: '127.0.0.1' }]],
    [[{ address: '::ffff:127.0.0.1' }]],
  ])('rejects private or mixed DNS results before reading the credential', async (records) => {
    const value = await fixture();
    const readCredential = vi.fn(async () => credential);
    const fetch = successfulFetch();

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => records),
      fetch,
      readCredential,
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
    expect(readCredential).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses DoH without an Authorization header and accepts only bounded owned records', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://cloudflare-dns.com');
      expect(url.pathname).toBe('/dns-query');
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('omit');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(init?.body).toBeUndefined();
      const type = url.searchParams.get('type');
      return new Response(JSON.stringify({
        Status: 0,
        TC: false,
        Question: [{ name: 'www.packyapi.ai.', type: type === 'A' ? 1 : 28 }],
        Answer: [{
          name: 'www.packyapi.ai.',
          type: type === 'A' ? 1 : 28,
          TTL: 60,
          data: type === 'A' ? '93.184.216.34' : '2606:2800:220:1:248:1893:25c8:1946',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(resolveAiImageProviderPublicDns('www.packyapi.ai')).resolves.toEqual([
      { address: '93.184.216.34' },
      { address: '2606:2800:220:1:248:1893:25c8:1946' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('accepts a public DNS name with A records and no AAAA records', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const type = url.searchParams.get('type');
      return new Response(JSON.stringify({
        Status: 0,
        TC: false,
        Question: [{ name: 'image.xiaoyiapi.xyz.', type: type === 'A' ? 1 : 28 }],
        Answer: type === 'A' ? [{
          name: 'image.xiaoyiapi.xyz.',
          type: 1,
          TTL: 60,
          data: '23.144.68.169',
        }] : undefined,
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }));

    await expect(resolveAiImageProviderPublicDns('image.xiaoyiapi.xyz')).resolves.toEqual([
      { address: '23.144.68.169' },
    ]);
  });

  it('accepts bounded public A and AAAA records reached through one owned CNAME chain', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const type = url.searchParams.get('type');
      const target = 'gtm-cn-rttest.dashscope.aliyuncs.com.';
      return new Response(JSON.stringify({
        Status: 0,
        TC: false,
        Question: [{ name: 'dashscope.aliyuncs.com.', type: type === 'A' ? 1 : 28 }],
        Answer: [
          {
            name: 'dashscope.aliyuncs.com.',
            type: 5,
            TTL: 32,
            data: target,
          },
          {
            name: target,
            type: type === 'A' ? 1 : 28,
            TTL: 30,
            data: type === 'A' ? '39.96.213.166' : '2408:400a:3e:ef02:12f:bd95:e827:51d',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }));

    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com')).resolves.toEqual([
      { address: '39.96.213.166' },
      { address: '2408:400a:3e:ef02:12f:bd95:e827:51d' },
    ]);
  });

  it.each([
    ['unrelated injected address', [
      { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: 'target.example.' },
      { name: 'target.example.', type: 1, TTL: 30, data: '39.96.213.166' },
      { name: 'injected.example.', type: 1, TTL: 30, data: '93.184.216.34' },
    ]],
    ['CNAME loop', [
      { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: 'target.example.' },
      { name: 'target.example.', type: 5, TTL: 30, data: 'dashscope.aliyuncs.com.' },
    ]],
    ['missing terminal address', [
      { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: 'target.example.' },
    ]],
    ['unused CNAME branch', [
      { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: 'target.example.' },
      { name: 'target.example.', type: 1, TTL: 30, data: '39.96.213.166' },
      { name: 'unused.example.', type: 5, TTL: 30, data: 'other.example.' },
    ]],
    ['ambiguous CNAME owner', [
      { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: 'target.example.' },
      { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: 'other.example.' },
      { name: 'target.example.', type: 1, TTL: 30, data: '39.96.213.166' },
    ]],
  ])('rejects an unsafe CNAME answer: %s', async (_label, answers) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      Status: 0,
      TC: false,
      Question: [{ name: 'dashscope.aliyuncs.com.', type: 1 }],
      Answer: answers,
    }), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    })));
    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
  });

  it('rejects A and AAAA answers that terminate at different CNAME targets', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const type = new URL(String(input)).searchParams.get('type');
      const target = type === 'A' ? 'ipv4-target.example.' : 'ipv6-target.example.';
      return new Response(JSON.stringify({
        Status: 0,
        TC: false,
        Question: [{ name: 'dashscope.aliyuncs.com.', type: type === 'A' ? 1 : 28 }],
        Answer: [
          { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: target },
          {
            name: target,
            type: type === 'A' ? 1 : 28,
            TTL: 30,
            data: type === 'A' ? '39.96.213.166' : '2408:400a:3e:ef02:12f:bd95:e827:51d',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }));
    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
  });

  it.each([
    ['a mismatched Question', { TC: false, questionName: 'other.example.', questionClass: 1 }],
    ['a truncated response', { TC: true, questionName: 'dashscope.aliyuncs.com.', questionClass: 1 }],
    ['a non-IN Question class', {
      TC: false, questionName: 'dashscope.aliyuncs.com.', questionClass: 3,
    }],
    ['a non-IN Answer class', {
      TC: false, questionName: 'dashscope.aliyuncs.com.', questionClass: 1, answerClass: 3,
    }],
  ])('rejects a DoH response with %s', async (_label, metadata) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const type = new URL(String(input)).searchParams.get('type');
      const expectedType = type === 'A' ? 1 : 28;
      return new Response(JSON.stringify({
        Status: 0,
        TC: metadata.TC,
        Question: [{
          name: metadata.questionName,
          type: expectedType,
          class: metadata.questionClass,
        }],
        Answer: [{
          name: 'dashscope.aliyuncs.com.',
          type: expectedType,
          class: ('answerClass' in metadata ? metadata.answerClass : undefined) ?? 1,
          TTL: 30,
          data: type === 'A' ? '39.96.213.166' : '2408:400a:3e:ef02:12f:bd95:e827:51d',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }));
    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
  });

  it('rejects A and AAAA answers with different CNAME paths to the same terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const type = new URL(String(input)).searchParams.get('type');
      const expectedType = type === 'A' ? 1 : 28;
      const intermediate = type === 'A' ? 'ipv4-path.example.' : 'ipv6-path.example.';
      return new Response(JSON.stringify({
        Status: 0,
        TC: false,
        Question: [{ name: 'dashscope.aliyuncs.com.', type: expectedType }],
        Answer: [
          { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: intermediate },
          { name: intermediate, type: 5, TTL: 30, data: 'terminal.example.' },
          {
            name: 'terminal.example.',
            type: expectedType,
            TTL: 30,
            data: type === 'A' ? '39.96.213.166' : '2408:400a:3e:ef02:12f:bd95:e827:51d',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }));
    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
  });

  it('rejects an IP-literal CNAME target', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const type = new URL(String(input)).searchParams.get('type');
      const expectedType = type === 'A' ? 1 : 28;
      return new Response(JSON.stringify({
        Status: 0,
        TC: false,
        Question: [{ name: 'dashscope.aliyuncs.com.', type: expectedType }],
        Answer: [
          { name: 'dashscope.aliyuncs.com.', type: 5, TTL: 30, data: '127.0.0.1.' },
          {
            name: '127.0.0.1.',
            type: expectedType,
            TTL: 30,
            data: type === 'A' ? '39.96.213.166' : '2408:400a:3e:ef02:12f:bd95:e827:51d',
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }));
    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
  });

  it('accepts a CNAME chain exactly at the fixed hop limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const type = new URL(String(input)).searchParams.get('type');
      const expectedType = type === 'A' ? 1 : 28;
      const answers: Array<Record<string, unknown>> = [];
      let owner = 'dashscope.aliyuncs.com.';
      for (let index = 0; index < 8; index += 1) {
        const target = `hop-${index}.example.`;
        answers.push({ name: owner, type: 5, TTL: 30, data: target });
        owner = target;
      }
      answers.push({
        name: owner,
        type: expectedType,
        TTL: 30,
        data: type === 'A' ? '39.96.213.166' : '2408:400a:3e:ef02:12f:bd95:e827:51d',
      });
      return new Response(JSON.stringify({
        Status: 0,
        TC: false,
        Question: [{ name: 'dashscope.aliyuncs.com.', type: expectedType }],
        Answer: answers,
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }));
    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com')).resolves.toEqual([
      { address: '39.96.213.166' },
      { address: '2408:400a:3e:ef02:12f:bd95:e827:51d' },
    ]);
  });

  it('rejects a CNAME chain longer than the fixed hop limit', async () => {
    const answers: Array<Record<string, unknown>> = [];
    let owner = 'dashscope.aliyuncs.com.';
    for (let index = 0; index < 9; index += 1) {
      const target = `hop-${index}.example.`;
      answers.push({ name: owner, type: 5, TTL: 30, data: target });
      owner = target;
    }
    answers.push({ name: owner, type: 1, TTL: 30, data: '39.96.213.166' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      Status: 0,
      TC: false,
      Question: [{ name: 'dashscope.aliyuncs.com.', type: 1 }],
      Answer: answers,
    }), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    })));
    await expect(resolveAiImageProviderPublicDns('dashscope.aliyuncs.com'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
  });

  it('rejects an oversized DoH response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/dns-json',
        'content-length': '65537',
      },
    })));
    await expect(resolveAiImageProviderPublicDns('www.packyapi.ai'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_INVALID' });
  });

  it.each([
    ['Provider', 'application/jsonp'],
    ['DoH', 'application/dns-jsonp'],
  ])('rejects a prefix-only %s JSON Content-Type match', async (kind, contentType) => {
    if (kind === 'DoH') {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        Status: 0,
        Answer: [{
          name: 'www.packyapi.ai.', type: 1, TTL: 60, data: '93.184.216.34',
        }],
      }), { status: 200, headers: { 'content-type': contentType } })));
      await expect(resolveAiImageProviderPublicDns('www.packyapi.ai'))
        .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
      return;
    }
    const value = await fixture();
    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: vi.fn(async () => new Response(JSON.stringify({
        code: true, data: 10_000, message: '',
      }), { status: 200, headers: { 'content-type': contentType } })),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_INVALID' });
  });

  it.each([
    { code: false, data: 10_000, message: '' },
    { code: 1, data: 10_000, message: '' },
    { code: true, data: {}, message: '' },
    { code: true, data: { timestamp: 123 }, message: '' },
    { code: true, data: { requestId: 1 }, message: 'quota unavailable' },
  ])('rejects an unsuccessful or unrelated raw quota envelope', async (body) => {
    const value = await fixture();
    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: vi.fn(async () => jsonResponse(body)),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_RESPONSE_SCHEMA_INVALID' });
  });

  it.each([
    ['failed status', {
      Status: 1,
      TC: false,
      Question: [{ name: 'www.packyapi.ai.', type: 1 }],
      Answer: [],
    }],
    ['wrong owner', {
      Status: 0,
      TC: false,
      Question: [{ name: 'www.packyapi.ai.', type: 1 }],
      Answer: [{ name: 'other.example.', type: 1, TTL: 60, data: '93.184.216.34' }],
    }],
    ['invalid TTL', {
      Status: 0,
      TC: false,
      Question: [{ name: 'www.packyapi.ai.', type: 1 }],
      Answer: [{ name: 'www.packyapi.ai.', type: 1, TTL: 0, data: '93.184.216.34' }],
    }],
  ])('rejects a DoH response with %s', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    })));
    await expect(resolveAiImageProviderPublicDns('www.packyapi.ai'))
      .rejects.toMatchObject({ code: 'SANDBOX_READONLY_DNS_FAILED' });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked evidence root whose target is not private',
    async () => {
      const value = await fixture();
      const evidenceRoot = join(value.root, 'tmp', 'ai-image-sandbox');
      const redirected = join(value.root, 'redirected-evidence');
      await mkdir(redirected, { mode: 0o700 });
      await chmod(redirected, 0o755);
      await rm(evidenceRoot, { recursive: true });
      await symlink(redirected, evidenceRoot, 'dir');

      await expect(runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
        fetch: successfulFetch(),
        readCredential: vi.fn(async () => credential),
      })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_EVIDENCE_UNSAFE' });
      expect(await readdir(redirected)).toEqual([]);
    },
  );

  it('never overwrites an existing evidence ID', async () => {
    const value = await fixture();
    const existing = join(value.root, 'tmp', 'ai-image-sandbox', value.evidenceId);
    await mkdir(existing, { mode: 0o700 });

    await expect(runAiImageProviderReadonlyPreflight({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
      resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
      fetch: successfulFetch(),
      readCredential: vi.fn(async () => credential),
    })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_EVIDENCE_UNSAFE' });
    expect(await readdir(existing)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'writes the evidence directory and files with private modes',
    async () => {
      const value = await fixture();
      const result = await runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
        fetch: successfulFetch(),
        readCredential: vi.fn(async () => credential),
      });
      expect((await stat(result.outputDirectory)).mode & 0o777).toBe(0o700);
      for (const name of await readdir(result.outputDirectory)) {
        expect((await stat(join(result.outputDirectory, name))).mode & 0o777).toBe(0o600);
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'detects replacement of the held output directory before the first write',
    async () => {
      const value = await fixture();
      let replaced = false;

      await expect(runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
        fetch: successfulFetch(),
        readCredential: vi.fn(async () => credential),
        beforeEvidenceWrite: async ({ index, outputDirectory }) => {
          if (index !== 0 || replaced) return;
          replaced = true;
          await rename(outputDirectory, `${outputDirectory}.moved`);
          await mkdir(outputDirectory, { mode: 0o700 });
        },
      })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_EVIDENCE_UNSAFE' });
      expect(replaced).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'detects replacement of the held evidence root before the first write',
    async () => {
      const value = await fixture();
      const evidenceRoot = join(value.root, 'tmp', 'ai-image-sandbox');
      const movedRoot = `${evidenceRoot}.moved`;
      let replaced = false;

      await expect(runAiImageProviderReadonlyPreflight({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        resolveDns: vi.fn(async () => [{ address: '93.184.216.34' }]),
        fetch: successfulFetch(),
        readCredential: vi.fn(async () => credential),
        beforeEvidenceWrite: async ({ index }) => {
          if (index !== 0 || replaced) return;
          replaced = true;
          await rename(evidenceRoot, movedRoot);
          await mkdir(evidenceRoot, { mode: 0o700 });
        },
      })).rejects.toMatchObject({ code: 'SANDBOX_READONLY_EVIDENCE_UNSAFE' });
      expect(replaced).toBe(true);
      expect(await readdir(evidenceRoot)).toEqual([]);
      expect(await readdir(join(movedRoot, value.evidenceId))).toEqual([]);
    },
  );

  it('rejects argv without echoing it from the direct Node/tsx entry', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/ai-image-provider-readonly-preflight.ts', credential],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SANDBOX_READONLY_ARGUMENT_INVALID');
    expect(result.stderr).not.toContain(credential);
    expect(result.stdout).not.toContain(credential);
  });
});
