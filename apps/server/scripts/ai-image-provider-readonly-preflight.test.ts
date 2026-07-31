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

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function successfulFetch(overrides: {
  changedMeter?: 'tokenUsage' | 'displayUsage' | 'tokenLog';
  invalidMeter?: 'tokenUsage' | 'displayUsage' | 'tokenLog';
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
    ['failed status', { Status: 1, Answer: [] }],
    ['wrong owner', {
      Status: 0,
      Answer: [{ name: 'other.example.', type: 1, TTL: 60, data: '93.184.216.34' }],
    }],
    ['invalid TTL', {
      Status: 0,
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
