import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimAiImageSandboxOperation,
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
    providerEndpoint: 'https://relay.example/v1',
    model: 'opaque-model-alias',
    request: { operation: 'TEXT_TO_IMAGE', n: 1, width: 1024, height: 1024 },
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
      providerEndpoint: 'https://relay.example/v1',
      model: 'opaque-model-alias',
    });
    expect(stored).not.toContain('Authorization');
    expect(stored).not.toContain('apiKey');
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

  it('rejects an unbounded or over-quote request before writing an intent', async () => {
    const path = await directory();
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: 21, maximumCostCents: 20,
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: 0,
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
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
});
