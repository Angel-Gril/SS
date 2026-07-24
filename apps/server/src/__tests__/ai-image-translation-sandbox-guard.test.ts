import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  claimAiImageTranslationSandboxOperation,
  createAiImageTranslationSandboxFetchGuard,
} from '../services/ai-image-translation-sandbox-guard.js';

const sourceUrl = 'https://source.example/sandbox/source.png?token=opaque';
const domainHint = 'Translate only visible marketplace copy.';
const terminologies = [{ src: 'ceramic mug', tgt: 'керамическая кружка' }];

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function contract(overrides: Record<string, unknown> = {}) {
  return {
    submitEndpoint: 'https://dashscope.example/api/v1/services/aigc/image2image/image-synthesis',
    taskEndpointBase: 'https://dashscope.example/api/v1/tasks',
    model: 'qwen-mt-image' as const,
    sourceSha256: 'a'.repeat(64),
    sourceUrlSha256: sha256(sourceUrl),
    sourceUrlVerified: true as const,
    sourceEvidence: {
      verified: true as const,
      mimeType: 'image/png' as const,
      width: 2,
      height: 2,
      bytes: 100,
      sha256: 'a'.repeat(64),
      etagSha256: null,
      cacheControlImmutable: true,
    },
    sourceLanguage: 'zh',
    targetLanguage: 'ru',
    domainHintSha256: sha256(domainHint),
    terminologiesSha256: sha256(JSON.stringify(terminologies)),
    imageSegment: false as const,
    maxPollRequests: 3,
    maxPollDurationMs: 30_000,
    ...overrides,
  };
}

function submitBody() {
  return JSON.stringify({
    model: 'qwen-mt-image',
    input: {
      image_url: sourceUrl,
      source_lang: 'zh',
      target_lang: 'ru',
      ext: {
        domainHint,
        terminologies,
        config: { imageSegment: false },
      },
    },
  });
}

describe('single-submit DashScope image translation sandbox guard', () => {
  it('writes an immutable sanitized intent bound to endpoint and credential revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'translation-sandbox-intent-'));
    try {
      const endpointSha256 = sha256(contract().submitEndpoint);
      const claimed = await claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-sandbox-0001',
        endpointSha256,
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        contract: contract(),
        quotedCostCents: 5,
        maximumCostCents: 10,
      });
      const stored = await readFile(claimed.intentPath, 'utf8');
      expect(JSON.parse(stored)).toMatchObject({
        state: 'SUBMITTING',
        provider: 'dashscope-qwen-mt-image',
        model: 'qwen-mt-image',
        endpointSha256,
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        request: {
          operation: 'IMAGE_TRANSLATE',
          sourceSha256: 'a'.repeat(64),
          sourceUrlSha256: sha256(sourceUrl),
          sourceUrlVerified: true,
          sourceEvidence: contract().sourceEvidence,
          domainHintSha256: sha256(domainHint),
          terminologiesSha256: sha256(JSON.stringify(terminologies)),
          maxPollRequests: 3,
          maxPollDurationMs: 30_000,
        },
      });
      expect(stored).not.toContain(sourceUrl);
      expect(stored).not.toContain('local/source.png');
      expect(stored).not.toContain('secret-access-key');
      if (process.platform !== 'win32') {
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
        expect((await stat(claimed.intentPath)).mode & 0o777).toBe(0o600);
      }
      await expect(claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-sandbox-0001',
        endpointSha256,
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        contract: contract(),
        quotedCostCents: 5,
        maximumCostCents: 10,
      })).rejects.toMatchObject({ code: 'SANDBOX_OPERATION_EXISTS' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('atomically blocks the same paid translation request under fresh operation IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'translation-sandbox-fingerprint-'));
    const endpointSha256 = sha256(contract().submitEndpoint);
    const claim = (operationId: string) => claimAiImageTranslationSandboxOperation({
      directory,
      operationId,
      endpointSha256,
      credentialRevision: 'aliyun-ak/2026-07-24/r1',
      adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
      contract: contract(),
      quotedCostCents: 5,
      maximumCostCents: 10,
    });
    try {
      const raced = await Promise.allSettled([
        claim('translation-fingerprint-race-a-0001'),
        claim('translation-fingerprint-race-b-0002'),
      ]);
      expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);

      await expect(claim('translation-fingerprint-replay-0003'))
        .rejects.toMatchObject({ code: 'SANDBOX_REQUEST_REPLAY' });
      await expect(claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-fingerprint-evidence-0004',
        endpointSha256,
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        contract: contract({
          sourceEvidence: {
            ...contract().sourceEvidence,
            etagSha256: 'b'.repeat(64),
            cacheControlImmutable: false,
          },
        }),
        quotedCostCents: 5,
        maximumCostCents: 10,
      })).rejects.toMatchObject({ code: 'SANDBOX_REQUEST_REPLAY' });
      await expect(claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-fingerprint-poll-0005',
        endpointSha256,
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        contract: contract({ maxPollRequests: 9, maxPollDurationMs: 90_000 }),
        quotedCostCents: 5,
        maximumCostCents: 10,
      })).rejects.toMatchObject({ code: 'SANDBOX_REQUEST_REPLAY' });
      await expect(claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-fingerprint-distinct-0006',
        endpointSha256,
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        contract: contract({ targetLanguage: 'de' }),
        quotedCostCents: 5,
        maximumCostCents: 10,
      })).resolves.toBeDefined();
      await expect(claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-fingerprint-source-0007',
        endpointSha256,
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        contract: contract({
          sourceSha256: 'c'.repeat(64),
          sourceEvidence: { ...contract().sourceEvidence, sha256: 'c'.repeat(64) },
        }),
        quotedCostCents: 5,
        maximumCostCents: 10,
      })).resolves.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    '35cb9b8',
    'a'.repeat(39),
    'a'.repeat(41),
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(40),
  ])('rejects translation adapter revision %s unless it is a complete lowercase Git OID', async (adapterRevision) => {
    const directory = await mkdtemp(join(tmpdir(), 'translation-sandbox-adapter-'));
    try {
      await expect(claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-adapter-invalid-0001',
        endpointSha256: sha256(contract().submitEndpoint),
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision,
        contract: contract(),
        quotedCostCents: 5,
        maximumCostCents: 10,
      })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_EVIDENCE' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts a complete lowercase SHA-256 Git OID for translation claims', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'translation-sandbox-adapter-'));
    try {
      await expect(claimAiImageTranslationSandboxOperation({
        directory,
        operationId: 'translation-adapter-sha256-0001',
        endpointSha256: sha256(contract().submitEndpoint),
        credentialRevision: 'aliyun-ak/2026-07-24/r1',
        adapterRevision: 'a'.repeat(64),
        contract: contract(),
        quotedCostCents: 5,
        maximumCostCents: 10,
      })).resolves.toBeDefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('permits one exact submit, bounded exact task polls, and one exact result download', async () => {
    const resultUrl = 'https://result.example/translated.png?expires=1';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: { task_id: 'task-1', task_status: 'PENDING' },
        request_id: 'submit-request-1',
        usage: { image_count: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: { task_status: 'RUNNING' }, request_id: 'poll-request-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: { task_status: 'SUCCEEDED', image_url: resultUrl },
        request_id: 'poll-request-2', usage: { image_count: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('image-bytes', {
        status: 200, headers: { 'content-type': 'image/png' },
      }));
    const validateUrl = vi.fn(async (url: string) => new URL(url).toString());
    const guarded = createAiImageTranslationSandboxFetchGuard({
      contract: contract(), validateUrl, fetch: fetcher,
    });

    await guarded.fetch(contract().submitEndpoint, { method: 'POST', body: submitBody() });
    await guarded.fetch('https://dashscope.example/api/v1/tasks/task-1', { method: 'GET' });
    await guarded.fetch('https://dashscope.example/api/v1/tasks/task-1', { method: 'GET' });
    await guarded.fetch(resultUrl, { method: 'GET' });
    await expect(guarded.fetch(resultUrl, { method: 'GET' }))
      .rejects.toThrow('duplicate result download');

    expect(guarded.getSubmitRequests()).toBe(1);
    expect(guarded.getPollRequests()).toBe(2);
    expect(guarded.getResultDownloads()).toBe(1);
    expect(guarded.getEvidence()).toMatchObject({
      state: 'SUCCEEDED',
      providerTaskIdHash: sha256('task-1'),
      providerRequestIdHashes: [
        sha256('submit-request-1'), sha256('poll-request-1'), sha256('poll-request-2'),
      ],
      usage: { imageCount: 1 },
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.every((call) => call[1]?.redirect === 'error')).toBe(true);
    expect(validateUrl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['model', (body: any) => { body.model = 'another-model'; }],
    ['source URL', (body: any) => { body.input.image_url = 'https://source.example/drift.png'; }],
    ['language', (body: any) => { body.input.target_lang = 'de'; }],
    ['domain hint', (body: any) => { body.input.ext.domainHint = 'drifted policy'; }],
    ['terminology', (body: any) => { body.input.ext.terminologies[0].tgt = 'другая'; }],
    ['segmentation', (body: any) => { body.input.ext.config.imageSegment = true; }],
    ['extra field', (body: any) => { body.input.extra = 'blocked'; }],
  ])('blocks a drifted %s before dispatch', async (_label, mutate) => {
    const body = JSON.parse(submitBody());
    mutate(body);
    const fetcher = vi.fn();
    const guarded = createAiImageTranslationSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
    });

    await expect(guarded.fetch(contract().submitEndpoint, {
      method: 'POST', body: JSON.stringify(body),
    })).rejects.toThrow('unexpected submit contract');
    expect(fetcher).not.toHaveBeenCalled();
    expect(guarded.getSubmitRequests()).toBe(0);
  });

  it('enforces the exact task identity and hard poll-count cap', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_id: 'task-counted' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_status: 'RUNNING' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const guarded = createAiImageTranslationSandboxFetchGuard({
      contract: contract({ maxPollRequests: 1 }),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
    });
    await guarded.fetch(contract().submitEndpoint, { method: 'POST', body: submitBody() });
    await expect(guarded.fetch(
      'https://dashscope.example/api/v1/tasks/another-task', { method: 'GET' },
    )).rejects.toThrow('unexpected result URL');
    await guarded.fetch('https://dashscope.example/api/v1/tasks/task-counted', { method: 'GET' });
    await expect(guarded.fetch(
      'https://dashscope.example/api/v1/tasks/task-counted', { method: 'GET' },
    )).rejects.toThrow('poll budget is exhausted');

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(guarded.getPollRequests()).toBe(1);
    expect(guarded.getEvidence()).toMatchObject({ state: 'RECONCILIATION_REQUIRED' });
  });

  it('requires reconciliation at the exact poll deadline without another provider request', async () => {
    let now = 1_000;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: { task_id: 'task-deadline', task_status: 'PENDING' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const guarded = createAiImageTranslationSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
      now: () => now,
    });
    await guarded.fetch(contract().submitEndpoint, { method: 'POST', body: submitBody() });
    now += 30_000;

    await expect(guarded.fetch(
      'https://dashscope.example/api/v1/tasks/task-deadline',
      { method: 'GET' },
    )).rejects.toThrow('poll budget is exhausted');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(guarded.getPollRequests()).toBe(0);
    expect(guarded.getEvidence()).toMatchObject({ state: 'RECONCILIATION_REQUIRED' });
    await expect(guarded.fetch(
      contract().submitEndpoint,
      { method: 'POST', body: submitBody() },
    )).rejects.toThrow('duplicate submit');
  });

  it('fails closed into reconciliation when an accepted task returns a malformed result URL', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_id: 'task-bad-url' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: { task_status: 'SUCCEEDED', image_url: 'not a valid URL' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const guarded = createAiImageTranslationSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
    });
    await guarded.fetch(contract().submitEndpoint, { method: 'POST', body: submitBody() });

    await expect(guarded.fetch(
      'https://dashscope.example/api/v1/tasks/task-bad-url',
      { method: 'GET' },
    )).resolves.toBeInstanceOf(Response);

    expect(guarded.getEvidence()).toMatchObject({ state: 'RECONCILIATION_REQUIRED' });
    expect(guarded.getResultDownloads()).toBe(0);
    await expect(guarded.fetch(
      contract().submitEndpoint,
      { method: 'POST', body: submitBody() },
    )).rejects.toThrow('duplicate submit');
  });

  it.each([
    [400, 'REJECTED'],
    [401, 'REJECTED'],
    [403, 'REJECTED'],
    [404, 'REJECTED'],
    [422, 'REJECTED'],
    [408, 'RECONCILIATION_REQUIRED'],
    [409, 'RECONCILIATION_REQUIRED'],
    [425, 'RECONCILIATION_REQUIRED'],
    [429, 'RECONCILIATION_REQUIRED'],
    [500, 'RECONCILIATION_REQUIRED'],
    [503, 'RECONCILIATION_REQUIRED'],
  ] as const)('classifies submit HTTP %i as %s', async (status, expectedState) => {
    const fetcher = vi.fn(async () => new Response('{}', {
      status,
      headers: { 'content-type': 'application/json' },
    }));
    const guarded = createAiImageTranslationSandboxFetchGuard({
      contract: contract(),
      validateUrl: async (url) => new URL(url).toString(),
      fetch: fetcher,
    });

    await guarded.fetch(contract().submitEndpoint, { method: 'POST', body: submitBody() });

    expect(guarded.getEvidence().state).toBe(expectedState);
    expect(guarded.getSubmitRequests()).toBe(1);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
