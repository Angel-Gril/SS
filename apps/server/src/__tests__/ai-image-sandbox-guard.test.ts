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
const SANDBOX_NOW = new Date('2030-01-01T00:10:00.000Z');

async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-'));
  directories.push(value);
  return value;
}

function approvalEvidence(
  approvalId = 'approval-sandbox-operation-0001',
  approvalSha256 = 'a'.repeat(64),
  expiresAt = '2030-01-01T00:30:00.000Z',
) {
  return {
    approvalId,
    approvalSha256,
    approvedAt: '2030-01-01T00:00:00.000Z',
    expiresAt,
    approverRefSha256: 'b'.repeat(64),
    providerAccountRefSha256: 'c'.repeat(64),
    pricingRevisionSha256: 'd'.repeat(64),
    currency: 'USD',
    preCallBillingSnapshotRefSha256: 'e'.repeat(64),
    billingReconciliationRefSha256: 'f'.repeat(64),
  };
}

function input(
  path: string,
  operationId = 'sandbox-operation-0001',
): Parameters<typeof claimAiImageSandboxOperation>[0] {
  return {
    directory: path,
    operationId,
    endpointSha256: createHash('sha256')
      .update('https://relay.example/v1/images/generations')
      .digest('hex'),
    model: 'opaque-model-alias',
    credentialRevision: 'admin-config-rev-0001',
    adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
    now: SANDBOX_NOW,
    request: {
      operation: 'TEXT_TO_IMAGE',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      endpoint: 'https://relay.example/v1/images/generations',
      n: 1,
      width: 1024,
      height: 1024,
      size: '1024x1024',
      promptSha256: createHash('sha256').update('fixed prompt').digest('hex'),
      sourceSha256: [],
      sourceDimensions: [],
      maskSha256: null,
      maskDimensions: null,
      approvalEvidence: approvalEvidence(`approval-${operationId}`),
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
      endpointSha256: createHash('sha256')
        .update('https://relay.example/v1/images/generations')
        .digest('hex'),
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

  it('writes exact money only in a v3 intent while preserving sub-cent precision', async () => {
    const path = await directory();
    const exact = input(path, 'sandbox-exact-money-0001');
    delete exact.quotedCostCents;
    delete exact.maximumCostCents;
    exact.apiBaseSha256 = createHash('sha256')
      .update('https://relay.example/v1')
      .digest('hex');
    exact.quotedCost = { currency: 'CNY', amount: 119, scale: 4 };
    exact.maximumCost = { currency: 'CNY', amount: 1000, scale: 4 };

    const claimed = await claimAiImageSandboxOperation(exact);
    const intent = JSON.parse(await readFile(claimed.intentPath, 'utf8'));

    expect(intent).toMatchObject({
      schemaVersion: 3,
      apiBaseSha256: createHash('sha256')
        .update('https://relay.example/v1')
        .digest('hex'),
      quotedCost: { currency: 'CNY', amount: 119, scale: 4 },
      maximumCost: { currency: 'CNY', amount: 1000, scale: 4 },
    });
    expect(intent).not.toHaveProperty('quotedCostCents');
    expect(intent).not.toHaveProperty('maximumCostCents');
  });

  it('retains the legacy v2 intent cost shape for historical cents callers', async () => {
    const path = await directory();
    const claimed = await claimAiImageSandboxOperation(
      input(path, 'sandbox-legacy-money-0001'),
    );
    const intent = JSON.parse(await readFile(claimed.intentPath, 'utf8'));

    expect(intent).toMatchObject({
      schemaVersion: 2,
      quotedCostCents: 10,
      maximumCostCents: 20,
    });
    expect(intent).not.toHaveProperty('quotedCost');
    expect(intent).not.toHaveProperty('maximumCost');
  });

  it('rejects an exact claim without a distinct API Base digest', async () => {
    const path = await directory();
    const exact = input(path, 'sandbox-exact-api-base-0001');
    delete exact.quotedCostCents;
    delete exact.maximumCostCents;
    exact.quotedCost = { currency: 'CNY', amount: 119, scale: 4 };
    exact.maximumCost = { currency: 'CNY', amount: 1000, scale: 4 };

    await expect(claimAiImageSandboxOperation(exact)).rejects.toMatchObject({
      code: 'INVALID_SANDBOX_ENDPOINT',
    });
    exact.apiBaseSha256 = exact.endpointSha256;
    await expect(claimAiImageSandboxOperation(exact)).rejects.toMatchObject({
      code: 'INVALID_SANDBOX_ENDPOINT',
    });
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

  it('blocks the same paid request when only its approval evidence is replaced', async () => {
    const path = await directory();
    const first = input(path, 'sandbox-approval-fingerprint-first-0001');
    first.request.approvalEvidence = approvalEvidence('approval-first-0001', 'a'.repeat(64));
    await claimAiImageSandboxOperation(first);

    const second = input(path, 'sandbox-approval-fingerprint-replay-0002');
    second.request.approvalEvidence = approvalEvidence(
      'approval-second-0002',
      '1'.repeat(64),
      '2030-01-01T00:45:00.000Z',
    );
    await expect(claimAiImageSandboxOperation(second)).rejects.toMatchObject({
      code: 'SANDBOX_REQUEST_REPLAY',
    });
  });

  it('blocks replay when only audit profile metadata changes', async () => {
    const path = await directory();
    await claimAiImageSandboxOperation(input(path, 'sandbox-profile-first-0001'));
    const replay = input(path, 'sandbox-profile-replay-0002');
    replay.request.requestProfile = 'ALTERNATE_PROFILE_V1';

    await expect(claimAiImageSandboxOperation(replay)).rejects.toMatchObject({
      code: 'SANDBOX_REQUEST_REPLAY',
    });
  });

  it('blocks the same Provider request after credential or adapter revision changes', async () => {
    const path = await directory();
    await claimAiImageSandboxOperation(input(path, 'sandbox-revision-first-0001'));
    const replay = input(path, 'sandbox-revision-replay-0002');
    replay.credentialRevision = 'admin-config-rev-0002';
    replay.adapterRevision = 'a'.repeat(40);

    await expect(claimAiImageSandboxOperation(replay)).rejects.toMatchObject({
      code: 'SANDBOX_REQUEST_REPLAY',
    });
  });

  it('blocks replay when only source-dimension audit metadata changes', async () => {
    const path = await directory();
    const editRequest = (operationId: string, sourceWidth: number) => {
      const value = input(path, operationId);
      value.endpointSha256 = createHash('sha256')
        .update('https://relay.example/v1/images/edits')
        .digest('hex');
      value.request = {
        ...value.request,
        operation: 'FULL_EDIT',
        endpoint: 'https://relay.example/v1/images/edits',
        sourceSha256: ['1'.repeat(64)],
        sourceDimensions: [{ width: sourceWidth, height: 1024 }],
      };
      return value;
    };
    await claimAiImageSandboxOperation(editRequest('sandbox-dimensions-first-0001', 1024));

    await expect(claimAiImageSandboxOperation(
      editRequest('sandbox-dimensions-replay-0002', 2048),
    )).rejects.toMatchObject({ code: 'SANDBOX_REQUEST_REPLAY' });
  });

  it('blocks replay across adapter revisions when the Provider transport is identical', async () => {
    const path = await directory();
    await claimAiImageSandboxOperation(input(path, 'sandbox-adapter-first-0001'));
    const replay = input(path, 'sandbox-adapter-replay-0002');
    replay.adapterRevision = 'b'.repeat(40);

    await expect(claimAiImageSandboxOperation(replay)).rejects.toMatchObject({
      code: 'SANDBOX_REQUEST_REPLAY',
    });
  });

  it('rejects open or secret-bearing approval evidence before persisting an intent', async () => {
    const path = await directory();
    const value = input(path, 'sandbox-approval-secret-0001');
    value.request.approvalEvidence = {
      ...approvalEvidence('approval-secret-0001'),
      apiKey: 'must-never-be-persisted',
    };

    await expect(claimAiImageSandboxOperation(value)).rejects.toMatchObject({
      code: 'INVALID_SANDBOX_APPROVAL_EVIDENCE',
    });
    await expect(readFile(join(path, 'sandbox-approval-secret-0001.intent.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unknown request fields before they can alter replay identity or persist secrets', async () => {
    const path = await directory();
    const forged = input(path, 'sandbox-request-secret-0001');
    forged.request.apiKey = 'must-never-be-persisted';
    forged.request.nonce = 'fingerprint-bypass-attempt';

    await expect(claimAiImageSandboxOperation(forged)).rejects.toMatchObject({
      code: 'INVALID_SANDBOX_REQUEST',
    });
    await expect(claimAiImageSandboxOperation(
      input(path, 'sandbox-request-valid-0002'),
    )).resolves.toBeDefined();
    await expect(readFile(join(path, 'sandbox-request-secret-0001.intent.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires current approval evidence at the immutable claim boundary', async () => {
    const path = await directory();
    const expired = input(path, 'sandbox-approval-expired-0001');
    expired.request.approvalEvidence = approvalEvidence(
      'approval-expired-0001',
      'a'.repeat(64),
      '2030-01-01T00:10:00.000Z',
    );

    await expect(claimAiImageSandboxOperation(expired)).rejects.toMatchObject({
      code: 'SANDBOX_APPROVAL_EXPIRED',
    });
    await expect(readFile(join(path, 'sandbox-approval-expired-0001.intent.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    'http://relay.example/v1/images/generations',
    'https://localhost/v1/images/generations',
    'https://127.0.0.1/v1/images/generations',
  ])('rejects unsafe claim endpoint %s before persistence', async (endpoint) => {
    const path = await directory();
    const value = input(path, 'sandbox-endpoint-unsafe-0001');
    value.request.endpoint = endpoint;
    value.endpointSha256 = createHash('sha256').update(endpoint).digest('hex');

    await expect(claimAiImageSandboxOperation(value)).rejects.toMatchObject({
      code: 'INVALID_SANDBOX_REQUEST',
    });
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

    const edit = input(path, 'sandbox-distinct-edit-0002');
    edit.request = {
      ...edit.request,
      operation: 'FULL_EDIT',
      endpoint: 'https://relay.example/v1/images/edits',
      sourceSha256: ['1'.repeat(64)],
      sourceDimensions: [{ width: 1024, height: 1024 }],
    };
    edit.endpointSha256 = createHash('sha256')
      .update('https://relay.example/v1/images/edits')
      .digest('hex');
    await expect(claimAiImageSandboxOperation(edit)).resolves.toBeDefined();
  });

  it('rejects an unbounded or over-quote request before writing an intent', async () => {
    const path = await directory();
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: 21, maximumCostCents: 20,
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: 0,
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
    await expect(claimAiImageSandboxOperation({
      ...input(path),
      quotedCost: { currency: 'CNY', amount: 119, scale: 4 },
      maximumCost: { currency: 'CNY', amount: 1000, scale: 4 },
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: '1e2', maximumCostCents: '200',
    })).rejects.toMatchObject({ code: 'INVALID_SANDBOX_BUDGET' });
    await expect(claimAiImageSandboxOperation({
      ...input(path), quotedCostCents: 10, maximumCostCents: 10_000_001,
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
      beforeCreate: () => undefined,
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
    expect(guarded.getEvidence()).toMatchObject({
      state: 'ACCEPTED',
      providerHttpStatus: 200,
    });
  });

  it('blocks a generation before the Provider POST when the approval recheck fails', async () => {
    const prompt = 'fixed prompt';
    let providerCalls = 0;
    const guarded = createAiImageSandboxFetchGuard({
      contract: {
        endpoint: 'https://relay.example/v1/images/generations',
        model: 'opaque-model-alias',
        promptSha256: createHash('sha256').update(prompt).digest('hex'),
        size: '1024x1024',
        n: 1,
      },
      validateUrl: async (url) => url,
      beforeCreate: () => {
        throw Object.assign(new Error('approval expired'), { code: 'SANDBOX_APPROVAL_EXPIRED' });
      },
      fetch: async () => {
        providerCalls += 1;
        return new Response('{}', { status: 200 });
      },
    });

    await expect(guarded.fetch('https://relay.example/v1/images/generations', {
      method: 'POST',
      body: JSON.stringify({ model: 'opaque-model-alias', prompt, n: 1, size: '1024x1024' }),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_EXPIRED' });
    expect(providerCalls).toBe(0);
    expect(guarded.getCreateRequests()).toBe(0);
    expect(guarded.getEvidence()).toMatchObject({ state: 'READY' });
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
      beforeCreate: () => undefined,
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
    expect(guarded.getEvidence()).toMatchObject({
      state: 'ACCEPTED',
      providerHttpStatus: 200,
    });
  });

  it('blocks an edit before the Provider POST when the approval recheck fails', async () => {
    const prompt = 'Keep the product unchanged.';
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
      beforeCreate: () => {
        throw Object.assign(new Error('approval expired'), { code: 'SANDBOX_APPROVAL_EXPIRED' });
      },
      fetch: async () => {
        providerCalls += 1;
        return new Response('{}', { status: 200 });
      },
    });
    const form = new FormData();
    form.append('model', 'opaque-model-alias');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('image', new Blob([source], { type: 'image/png' }), 'source.png');

    await expect(guarded.fetch('https://relay.example/v1/images/edits', {
      method: 'POST',
      body: form,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_EXPIRED' });
    expect(providerCalls).toBe(0);
    expect(guarded.getCreateRequests()).toBe(0);
    expect(guarded.getEvidence()).toMatchObject({ state: 'READY' });
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
      beforeCreate: () => undefined,
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
      beforeCreate: () => undefined,
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
      beforeCreate: () => undefined,
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
