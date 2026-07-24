import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimAiImageSandboxOperation,
  createAiImageSandboxEditFetchGuard,
  createAiImageSandboxFetchGuard,
} from '../services/ai-image-sandbox-guard.js';

const directories: string[] = [];

async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-'));
  directories.push(value);
  return value;
}

function input(path: string, operationId = 'sandbox-operation-0001') {
  return {
    directory: path,
    operationId,
    endpointSha256: createHash('sha256').update('https://relay.example/v1').digest('hex'),
    model: 'opaque-model-alias',
    credentialRevision: 'admin-config-rev-0001',
    adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
    request: {
      operation: 'TEXT_TO_IMAGE',
      endpoint: 'https://relay.example/v1',
      n: 1,
      width: 1024,
      height: 1024,
      apiKey: 'must-never-be-persisted',
      rawResponse: { authorization: 'must-never-be-persisted' },
    },
    quotedCostCents: 10,
    maximumCostCents: 20,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('single-submit AI image sandbox guard', () => {
  it('writes one immutable sanitized intent and rejects replay', async () => {
    const path = await directory();
    const first = await claimAiImageSandboxOperation(input(path));
    await expect(claimAiImageSandboxOperation(input(path))).rejects.toMatchObject({
      code: 'SANDBOX_OPERATION_EXISTS',
    });
    const stored = await readFile(first.intentPath, 'utf8');
    expect(stored).toContain('SUBMITTING');
    expect(JSON.parse(stored)).toMatchObject({
      endpointSha256: createHash('sha256').update('https://relay.example/v1').digest('hex'),
      model: 'opaque-model-alias',
      credentialRevision: 'admin-config-rev-0001',
      adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
    });
    expect(stored).not.toContain('Authorization');
    expect(stored).not.toContain('apiKey');
    expect(stored).not.toContain('must-never-be-persisted');
    expect(stored).not.toContain('https://relay.example');
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o700);
      expect((await stat(first.intentPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('allows only one winner across concurrent process-equivalent claims', async () => {
    const path = await directory();
    const results = await Promise.allSettled([
      claimAiImageSandboxOperation(input(path, 'sandbox-concurrent-0001')),
      claimAiImageSandboxOperation(input(path, 'sandbox-concurrent-0001')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('blocks the same paid request under a fresh operation ID', async () => {
    const path = await directory();
    await claimAiImageSandboxOperation(input(path, 'sandbox-fingerprint-first-0001'));

    await expect(claimAiImageSandboxOperation(
      input(path, 'sandbox-fingerprint-replay-0002'),
    )).rejects.toMatchObject({ code: 'SANDBOX_REQUEST_REPLAY' });
  });

  it('allows only one winner when the same request races under different operation IDs', async () => {
    const path = await directory();
    const results = await Promise.allSettled([
      claimAiImageSandboxOperation(input(path, 'sandbox-fingerprint-race-a-0001')),
      claimAiImageSandboxOperation(input(path, 'sandbox-fingerprint-race-b-0002')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('allows a fresh operation ID for a materially different request operation', async () => {
    const path = await directory();
    await claimAiImageSandboxOperation(input(path, 'sandbox-distinct-text-0001'));

    await expect(claimAiImageSandboxOperation({
      ...input(path, 'sandbox-distinct-edit-0002'),
      request: {
        operation: 'FULL_EDIT',
        endpoint: 'https://relay.example/v1',
        n: 1,
        width: 1024,
        height: 1024,
      },
    })).resolves.toBeDefined();
  });

  it('rejects an unbounded or over-quote request before writing an intent', async () => {
    const path = await directory();
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: 21, maximumCostCents: 20,
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: 0,
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
  });

  it.each([
    'working-tree',
    '35cb9b8',
    'a'.repeat(39),
    'a'.repeat(41),
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(40),
  ])('rejects adapter revision %s unless it is a complete lowercase Git OID', async (adapterRevision) => {
    const path = await directory();
    await expect(claimAiImageSandboxOperation({
      ...input(path), adapterRevision,
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_ADAPTER_REVISION' });
  });

  it('accepts a complete lowercase SHA-256 Git OID as the adapter revision', async () => {
    const path = await directory();

    await expect(claimAiImageSandboxOperation({
      ...input(path), adapterRevision: 'a'.repeat(64),
    })).resolves.toBeDefined();
  });

  it('binds prompt, size, allowed keys, endpoint and replay count at the fetch boundary', async () => {
    const prompt = 'fixed prompt';
    const promptHash = createHash('sha256').update(prompt).digest('hex');
    const requests: string[] = [];
    const guarded = createAiImageSandboxFetchGuard({
      contract: {
        endpoint: 'https://relay.example/v1/images/generations',
        model: 'opaque-model-alias', promptSha256: promptHash, size: '1024x1024', n: 1,
      },
      validateUrl: async (url) => url,
      fetch: async (url) => { requests.push(String(url)); return new Response('{}', { status: 200 }); },
    });
    const validInit = { method: 'POST', body: JSON.stringify({ model: 'opaque-model-alias', prompt, n: 1, size: '1024x1024' }) };
    await guarded.fetch('https://relay.example/v1/images/generations', validInit);
    await guarded.fetch('https://cdn.example/result.png', { method: 'GET' });
    await expect(guarded.fetch('https://cdn.example/second.png', { method: 'GET' }))
      .rejects.toThrow('excess result downloads');
    await expect(guarded.fetch('https://relay.example/v1/images/generations', validInit)).rejects.toThrow('duplicate');
    await expect(guarded.fetch('https://relay.example/v1/images/generations', {
      method: 'POST', body: JSON.stringify({ ...JSON.parse(validInit.body), size: '512x512' }),
    })).rejects.toThrow('unexpected create contract');
    await expect(guarded.fetch('https://relay.example/v1/images/generations', {
      method: 'POST', body: JSON.stringify({ ...JSON.parse(validInit.body), prompt: 'drifted' }),
    })).rejects.toThrow('unexpected create contract');
    await expect(guarded.fetch('https://relay.example/v1/images/generations', {
      method: 'POST', body: JSON.stringify({ ...JSON.parse(validInit.body), response_format: 'url' }),
    })).rejects.toThrow('unexpected create contract');
    await expect(guarded.fetch('https://relay.example/v1/images/edits', validInit)).rejects.toThrow('exact images/generations endpoint');
    await expect(guarded.fetch('https://relay.example/v1/images/generations', {
      method: 'DELETE',
    })).rejects.toThrow('only GET and POST');
    expect(requests).toEqual([
      'https://relay.example/v1/images/generations',
      'https://cdn.example/result.png',
    ]);
  });

  it('submits one exact multipart image edit with redirects disabled', async () => {
    const prompt = 'Keep the white mug unchanged and replace only the background.';
    const source = Buffer.from('89504e470d0a1a0a', 'hex');
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const guarded = createAiImageSandboxEditFetchGuard({
      contract: {
        endpoint: 'https://relay.example/v1/images/edits',
        operation: 'FULL_EDIT',
        model: 'opaque-model-alias',
        promptSha256: createHash('sha256').update(prompt).digest('hex'),
        size: '1024x1024',
        n: 1,
        sourceSha256: [createHash('sha256').update(source).digest('hex')],
        maskSha256: null,
      },
      validateUrl: async (url) => url,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response('{}', { status: 200 });
      },
    });
    const form = new FormData();
    form.append('model', 'opaque-model-alias');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('image', new Blob([source], { type: 'image/png' }), 'source.png');

    await guarded.fetch('https://relay.example/v1/images/edits', { method: 'POST', body: form });
    await expect(guarded.fetch('https://relay.example/v1/images/edits', { method: 'POST', body: form }))
      .rejects.toThrow('duplicate');

    expect(guarded.getCreateRequests()).toBe(1);
    expect(requests).toEqual([{
      url: 'https://relay.example/v1/images/edits',
      init: expect.objectContaining({ method: 'POST', body: form, redirect: 'error' }),
    }]);
  });

  it('rejects an INPAINT mask whose bytes are not PNG even when its multipart type says PNG', async () => {
    const prompt = 'Replace only the transparent region.';
    const source = Buffer.from('89504e470d0a1a0a', 'hex');
    const disguisedJpeg = Buffer.from('ffd8ff', 'hex');
    const guarded = createAiImageSandboxEditFetchGuard({
      contract: {
        endpoint: 'https://relay.example/v1/images/edits',
        operation: 'INPAINT',
        model: 'opaque-model-alias',
        promptSha256: createHash('sha256').update(prompt).digest('hex'),
        size: '1024x1024',
        n: 1,
        sourceSha256: [createHash('sha256').update(source).digest('hex')],
        maskSha256: createHash('sha256').update(disguisedJpeg).digest('hex'),
      },
      validateUrl: async (url) => url,
      fetch: async () => new Response('{}', { status: 200 }),
    });
    const form = new FormData();
    form.append('model', 'opaque-model-alias');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('image', new Blob([source], { type: 'image/png' }), 'source.png');
    form.append('mask', new Blob([disguisedJpeg], { type: 'image/png' }), 'mask.png');

    await expect(guarded.fetch('https://relay.example/v1/images/edits', { method: 'POST', body: form }))
      .rejects.toThrow('unexpected multipart contract');
    expect(guarded.getCreateRequests()).toBe(0);
  });

  it('rejects source bytes that do not match the multipart image MIME type', async () => {
    const prompt = 'Keep the product shape.';
    const disguisedJpeg = Buffer.from('ffd8ff', 'hex');
    const guarded = createAiImageSandboxEditFetchGuard({
      contract: {
        endpoint: 'https://relay.example/v1/images/edits',
        operation: 'IMAGE_TO_IMAGE',
        model: 'opaque-model-alias',
        promptSha256: createHash('sha256').update(prompt).digest('hex'),
        size: '1024x1024',
        n: 1,
        sourceSha256: [createHash('sha256').update(disguisedJpeg).digest('hex')],
        maskSha256: null,
      },
      validateUrl: async (url) => url,
      fetch: async () => new Response('{}', { status: 200 }),
    });
    const form = new FormData();
    form.append('model', 'opaque-model-alias');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('image', new Blob([disguisedJpeg], { type: 'image/png' }), 'source.png');

    await expect(guarded.fetch('https://relay.example/v1/images/edits', { method: 'POST', body: form }))
      .rejects.toThrow('unexpected multipart contract');
    expect(guarded.getCreateRequests()).toBe(0);
  });

  it('does not retry an edit when the only downstream POST has an uncertain failure', async () => {
    const prompt = 'Keep the product shape.';
    const source = Buffer.from('89504e470d0a1a0a', 'hex');
    let providerCalls = 0;
    const guarded = createAiImageSandboxEditFetchGuard({
      contract: {
        endpoint: 'https://relay.example/v1/images/edits',
        operation: 'FULL_EDIT',
        model: 'opaque-model-alias',
        promptSha256: createHash('sha256').update(prompt).digest('hex'),
        size: '1024x1024',
        n: 1,
        sourceSha256: [createHash('sha256').update(source).digest('hex')],
        maskSha256: null,
      },
      validateUrl: async (url) => url,
      fetch: async () => {
        providerCalls += 1;
        throw new Error('connection ended after dispatch');
      },
    });
    const form = new FormData();
    form.append('model', 'opaque-model-alias');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('image', new Blob([source], { type: 'image/png' }), 'source.png');

    await expect(guarded.fetch('https://relay.example/v1/images/edits', { method: 'POST', body: form }))
      .rejects.toThrow('connection ended after dispatch');
    await expect(guarded.fetch('https://relay.example/v1/images/edits', { method: 'POST', body: form }))
      .rejects.toThrow('duplicate');
    expect(providerCalls).toBe(1);
    expect(guarded.getCreateRequests()).toBe(1);
  });

});
