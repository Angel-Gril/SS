import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAiImageTranslationSingleSubmit } from './ai-image-translation-single-submit.js';

const directories: string[] = [];

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

async function image(background: { r: number; g: number; b: number }) {
  return sharp({
    create: { width: 3, height: 2, channels: 3, background },
  }).png().toBuffer();
}

function environment(input: {
  operationId: string;
  sourcePath: string;
  sourceSha256: string;
  baseUrl?: string;
  expectedHost?: string;
}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'sandbox',
    AI_IMAGE_TRANSLATION_SANDBOX_MODE: 'SUBMIT',
    AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_TRANSLATION_REQUEST',
    AI_IMAGE_TRANSLATION_SANDBOX_BASE_URL: input.baseUrl || 'https://dashscope.aliyuncs.com/api/v1',
    AI_IMAGE_TRANSLATION_SANDBOX_EXPECTED_HOST: input.expectedHost || 'dashscope.aliyuncs.com',
    AI_IMAGE_TRANSLATION_SANDBOX_API_KEY: 'sandbox-secret-never-report',
    AI_IMAGE_TRANSLATION_SANDBOX_MODEL: 'qwen-mt-image',
    AI_IMAGE_TRANSLATION_SANDBOX_OPERATION_ID: input.operationId,
    AI_IMAGE_TRANSLATION_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-translation-0001',
    AI_IMAGE_SANDBOX_ADAPTER_REVISION: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
    AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_PATH: input.sourcePath,
    AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_SHA256: input.sourceSha256,
    AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_URL: 'https://assets.example/source.png?opaque=secret',
    AI_IMAGE_TRANSLATION_SANDBOX_SOURCE_LANGUAGE: 'zh',
    AI_IMAGE_TRANSLATION_SANDBOX_TARGET_LANGUAGE: 'ru',
    AI_IMAGE_TRANSLATION_SANDBOX_DOMAIN_HINT: 'Translate only visible marketplace copy.',
    AI_IMAGE_TRANSLATION_SANDBOX_TERMINOLOGIES_JSON: '[]',
    AI_IMAGE_TRANSLATION_SANDBOX_QUOTED_COST_CENTS: '5',
    AI_IMAGE_TRANSLATION_SANDBOX_MAX_COST_CENTS: '10',
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('single-submit DashScope image translation sandbox runner', () => {
  it('rejects a declared adapter revision that differs from the deployed commit', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-translation-runner-'));
    directories.push(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${'a'.repeat(40)}\n`);
    const fetch = vi.fn();

    await expect(runAiImageTranslationSingleSubmit({
      environment: environment({
        operationId: 'translation-adapter-mismatch-0001',
        sourcePath: join(path, 'missing.png'),
        sourceSha256: 'b'.repeat(64),
      }),
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('verifies the pinned source URL bytes before claim and performs zero POSTs on a SHA mismatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-translation-runner-'));
    directories.push(path);
    const localSource = await image({ r: 255, g: 255, b: 255 });
    const remoteSource = await image({ r: 0, g: 0, b: 0 });
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, localSource);
    const calls: Array<{ url: string; method: string }> = [];
    const fetch = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = request instanceof Request ? request.url : String(request);
      const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
      calls.push({ url, method });
      return new Response(remoteSource, {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(remoteSource.byteLength),
        },
      });
    });

    await expect(runAiImageTranslationSingleSubmit({
      environment: environment({
        operationId: 'translation-source-mismatch-0001',
        sourcePath,
        sourceSha256: sha256(localSource),
      }),
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
      now: () => 1_000,
      delay: async () => undefined,
    })).rejects.toMatchObject({ code: 'SANDBOX_SOURCE_HASH_MISMATCH' });

    expect(calls).toEqual([{
      url: 'https://assets.example/source.png?opaque=secret',
      method: 'GET',
    }]);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    expect(await readdir(path)).toEqual(['source.png']);
  });

  it('rejects a self-approved non-DashScope host before source verification or provider dispatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-translation-runner-'));
    directories.push(path);
    const source = await image({ r: 255, g: 255, b: 255 });
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    const fetch = vi.fn();

    await expect(runAiImageTranslationSingleSubmit({
      environment: environment({
        operationId: 'translation-host-rejected-0001',
        sourcePath,
        sourceSha256: sha256(source),
        baseUrl: 'https://public-relay.example/api/v1',
        expectedHost: 'public-relay.example',
      }),
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_HOST_INVALID' });

    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(path)).toEqual(['source.png']);
  });

  it.each([
    ['https://dashscope.aliyuncs.com:8443', 'SANDBOX_HOST_INVALID'],
    ['https://dashscope.aliyuncs.com/custom-prefix', 'SANDBOX_CONFIG_INVALID'],
  ])('rejects a non-canonical official DashScope base before dispatch: %s', async (baseUrl, code) => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-translation-runner-'));
    directories.push(path);
    const source = await image({ r: 255, g: 255, b: 255 });
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    const fetch = vi.fn();

    await expect(runAiImageTranslationSingleSubmit({
      environment: environment({
        operationId: `translation-base-rejected-${directories.length.toString().padStart(4, '0')}`,
        sourcePath,
        sourceSha256: sha256(source),
        baseUrl,
      }),
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toMatchObject({ code });

    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(path)).toEqual(['source.png']);
  });

  it('records source binding and a sanitized success report for one exact submit', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-translation-runner-'));
    directories.push(path);
    const source = await image({ r: 255, g: 255, b: 255 });
    const result = await image({ r: 240, g: 240, b: 240 });
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    const operationId = 'translation-submit-success-0001';
    const resultUrl = 'https://results.example/translated.png?opaque=result-secret';
    const calls: Array<{ url: string; method: string }> = [];
    const fetch = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = request instanceof Request ? request.url : String(request);
      const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
      calls.push({ url, method });
      if (url.startsWith('https://assets.example/')) {
        return new Response(source, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(source.byteLength),
            etag: '"immutable-object-etag"',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        });
      }
      if (method === 'POST') {
        return new Response(JSON.stringify({
          output: { task_id: 'raw-provider-task-1', task_status: 'PENDING' },
          request_id: 'submit-request-1',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/tasks/')) {
        return new Response(JSON.stringify({
          output: { task_status: 'SUCCEEDED', image_url: resultUrl },
          request_id: 'poll-request-1',
          usage: { image_count: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(result, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(result.byteLength) },
      });
    });

    await expect(runAiImageTranslationSingleSubmit({
      environment: environment({ operationId, sourcePath: 'source.png', sourceSha256: sha256(source) }),
      outputDirectory: path,
      repositoryRoot: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
      now: () => 1_000,
      delay: async () => undefined,
    })).resolves.toMatchObject({ state: 'SUCCEEDED', operationId });

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    const intent = await readFile(join(path, 'intents', `${operationId}.intent.json`), 'utf8');
    const report = await readFile(join(path, `${operationId}.submit.report.json`), 'utf8');
    const journal = await readFile(join(path, 'recovery', `${operationId}.recovery.jsonl`), 'utf8');
    const parsedReport = JSON.parse(report);
    expect(JSON.parse(intent)).toMatchObject({ request: { sourceUrlVerified: true } });
    expect(parsedReport).toMatchObject({
      state: 'SUCCEEDED',
      source: {
        verified: true,
        etagSha256: sha256('"immutable-object-etag"'),
        cacheControlImmutable: true,
      },
      submitRequests: 1,
      pollRequests: 1,
      resultDownloads: 1,
    });
    expect(report + intent).not.toContain('https://assets.example');
    expect(report + intent).not.toContain(resultUrl);
    expect(report + intent).not.toContain('sandbox-secret-never-report');
    expect(journal).toContain('raw-provider-task-1');
    expect(journal).toContain(resultUrl);
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o700);
      expect((await stat(join(path, `${operationId}.submit.report.json`))).mode & 0o777).toBe(0o600);
      expect((await stat(join(path, 'intents', `${operationId}.intent.json`))).mode & 0o777).toBe(0o600);
      expect((await stat(join(path, 'recovery', `${operationId}.recovery.jsonl`))).mode & 0o777).toBe(0o600);
      expect((await stat(String(parsedReport.imagePath))).mode & 0o777).toBe(0o600);
    }
  });

  it('recovers an accepted task from the fsynced journal without another POST or claim', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-translation-runner-'));
    directories.push(path);
    const source = await image({ r: 255, g: 255, b: 255 });
    const result = await image({ r: 210, g: 210, b: 210 });
    const mislabeledResult = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 180, g: 180, b: 180 },
      },
    }).jpeg().toBuffer();
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    const operationId = 'translation-reconcile-success-0001';
    const staleResultUrl = 'https://results.example/stale.png?opaque=expired-secret';
    const submitEnvironment = environment({ operationId, sourcePath, sourceSha256: sha256(source) });
    const submitCalls: Array<{ url: string; method: string }> = [];
    const submitFetch = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = request instanceof Request ? request.url : String(request);
      const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
      submitCalls.push({ url, method });
      if (url.startsWith('https://assets.example/')) {
        return new Response(source, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(source.byteLength),
            etag: '"stable-reconcile-etag"',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        });
      }
      if (method === 'POST') {
        return new Response(JSON.stringify({
          output: { task_id: 'raw-recovery-task-1', task_status: 'PENDING' },
          request_id: 'submit-recovery-request-1',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/tasks/')) {
        return new Response(JSON.stringify({
          output: { task_status: 'SUCCEEDED', image_url: staleResultUrl },
          request_id: 'submit-poll-request-1',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw Object.assign(new Error('socket ended after Provider acceptance'), { code: 'UND_ERR_SOCKET' });
    });

    await expect(runAiImageTranslationSingleSubmit({
      environment: submitEnvironment,
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch: submitFetch,
      now: () => 2_000,
      delay: async () => undefined,
    })).rejects.toMatchObject({ code: 'UND_ERR_SOCKET' });

    const submitReportPath = join(path, `${operationId}.submit.report.json`);
    const submitReportBefore = await readFile(submitReportPath, 'utf8');
    const journalPath = join(path, 'recovery', `${operationId}.recovery.jsonl`);
    const journalBefore = await readFile(journalPath, 'utf8');
    expect(journalBefore).toContain('raw-recovery-task-1');
    expect(journalBefore).toContain(staleResultUrl);
    const intentsBefore = await readdir(join(path, 'intents'));

    const resultUrl = 'https://results.example/reconciled.png?opaque=result-secret';
    const reconcileCalls: Array<{ url: string; method: string }> = [];
    const reconcileFetch = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = request instanceof Request ? request.url : String(request);
      const method = String(init?.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
      reconcileCalls.push({ url, method });
      if (url === staleResultUrl) {
        return new Response(mislabeledResult, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      if (url.includes('/tasks/')) {
        return new Response(JSON.stringify({
          output: { task_status: 'SUCCEEDED', image_url: resultUrl },
          request_id: 'reconcile-poll-request-1',
          usage: { image_count: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(result, {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(result.byteLength) },
      });
    });

    await expect(runAiImageTranslationSingleSubmit({
      environment: {
        ...submitEnvironment,
        AI_IMAGE_TRANSLATION_SANDBOX_MODE: 'RECONCILE',
        AI_IMAGE_TRANSLATION_SANDBOX_RECONCILIATION_ID: 'reconcile-attempt-0001',
        AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM: '',
      },
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch: reconcileFetch,
      now: () => 3_000,
      delay: async () => undefined,
    })).resolves.toMatchObject({
      mode: 'RECONCILE',
      state: 'SUCCEEDED',
      submitRequests: 0,
      pollRequests: 1,
      resultDownloads: 2,
    });

    expect(reconcileCalls.every((call) => call.method === 'GET')).toBe(true);
    expect(reconcileCalls).toHaveLength(3);
    expect(await readdir(join(path, 'intents'))).toEqual(intentsBefore);
    expect(await readFile(submitReportPath, 'utf8')).toBe(submitReportBefore);
    const reconcileReport = await readFile(
      join(path, `${operationId}.reconcile-attempt-0001.reconcile.report.json`),
      'utf8',
    );
    expect(reconcileReport).not.toContain(resultUrl);
    expect(reconcileReport).not.toContain('raw-recovery-task-1');
    const journal = await readFile(journalPath, 'utf8');
    expect(journal).toContain(resultUrl);

    const replayFetch = vi.fn();
    await expect(runAiImageTranslationSingleSubmit({
      environment: {
        ...submitEnvironment,
        AI_IMAGE_TRANSLATION_SANDBOX_MODE: 'RECONCILE',
        AI_IMAGE_TRANSLATION_SANDBOX_RECONCILIATION_ID: 'reconcile-attempt-0001',
        AI_IMAGE_TRANSLATION_SANDBOX_CONFIRM: '',
      },
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch: replayFetch,
    })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(replayFetch).not.toHaveBeenCalled();
  });
});
