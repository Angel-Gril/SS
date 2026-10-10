import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  executeAiImageSuitePaidProvider,
  recoverAiImageSuitePaidProvider,
  type ExecuteAiImageSuitePaidProviderDependencies,
  type ExecuteAiImageSuitePaidProviderInput,
} from '../services/ai-image-suite-paid-execution.js';
import type {
  PreparedAiImageSuitePaidProviderExecution,
} from '../services/ai-image-suite-paid-provider.js';
import {
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
  type NormalizedAiImageSuiteProviderOutput,
} from '../services/ai-image-suite-output-normalizer.js';
import type { AiImageProviderResult } from '../services/ai-image-jobs.js';

const RAW_BUFFER = Buffer.from('paid-provider-raw-output');
const FINAL_BUFFER = Buffer.from('paid-provider-normalized-output');
const RAW_SHA256 = createHash('sha256').update(RAW_BUFFER).digest('hex');
const FINAL_SHA256 = createHash('sha256').update(FINAL_BUFFER).digest('hex');
const PROVIDER_ACCEPTED_AT = new Date('2026-07-24T01:01:59.000Z');
const PROVIDER_RESULT_RECEIVED_AT = new Date('2026-07-24T01:02:03.000Z');

function input(): ExecuteAiImageSuitePaidProviderInput {
  return {
    ownerUserId: 'owner-1',
    jobId: 'job-1',
    maximumCostCents: 8,
    suite: {
      provider: 'openai-images',
      model: 'gpt-image-1',
      providerConfigHash: 'a'.repeat(64),
      pricingVersion: 'openai-images-test/v1',
      concurrencyLimit: 1,
      itemCount: 1,
      estimatedCostCents: 8,
      maximumCostCents: 8,
      sourceCaptureSnapshotId: 'snapshot-1',
    },
    job: {
      provider: 'openai-images',
      model: 'gpt-image-1',
      prompt: 'Create a marketplace product image.',
      negativePrompt: null,
      estimatedCostCents: 8,
      inputAssets: [],
      operationConfig: {},
    },
  };
}

function preparedWithFetch(
  fetch: () => Promise<AiImageProviderResult>,
): PreparedAiImageSuitePaidProviderExecution {
  return {
    evidenceLevel: 'sandbox-verified',
    async execute(_onProviderAccepted, beforeProviderDispatch) {
      await beforeProviderDispatch?.();
      return fetch();
    },
  };
}

function normalizedOutput(): NormalizedAiImageSuiteProviderOutput {
  return {
    buffer: FINAL_BUFFER,
    mimeType: 'image/png',
    width: 900,
    height: 1200,
    sha256: FINAL_SHA256,
    normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
    providerOutput: { width: 1024, height: 1536 },
  };
}

function successfulResult(
  overrides: Partial<AiImageProviderResult> = {},
): AiImageProviderResult {
  return {
    images: [{ buffer: RAW_BUFFER, mimeType: 'image/png' }],
    providerJobId: 'provider-request-1',
    actualCostCents: 8,
    ...overrides,
  };
}

function validUploads() {
  return vi.fn()
    .mockResolvedValueOnce({
      url: 'https://cdn.example/ai/provider-output.png',
      backend: 'oss',
      key: 'ai/provider-output.png',
    })
    .mockResolvedValueOnce({
      url: 'https://cdn.example/ai/final-output.png',
      backend: 'oss',
      key: 'ai/final-output.png',
    });
}

function dependencies(
  overrides: Partial<ExecuteAiImageSuitePaidProviderDependencies<string>> = {},
): ExecuteAiImageSuitePaidProviderDependencies<string> {
  return {
    prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn())),
    assertClaim: vi.fn(async () => undefined),
    markProviderDispatchStarted: vi.fn(async () => true),
    recordProviderAccepted: vi.fn(async () => undefined),
    recordProviderResultEvidence: vi.fn(async () => undefined),
    uploadBuffer: vi.fn(),
    recordProviderOutput: vi.fn(async () => undefined),
    complete: vi.fn(async () => 'completed'),
    now: () => new Date('2026-07-24T01:02:03.000Z'),
    ...overrides,
  };
}

describe('AI image suite paid Provider dispatch boundary', () => {
  it('runs the donor full-frame dispatcher with actual 1008x1344 pixels and retains one frozen charge', async () => {
    const source = await sharp({ create: { width: 1008, height: 1344, channels: 3, background: '#df2020' } }).png().toBuffer();
    const request = input();
    Object.assign(request.suite, { provider: 'custom', model: 'gpt-image-2' });
    Object.assign(request.job, { provider: 'custom', model: 'gpt-image-2' });
    const fetch = vi.fn(async () => successfulResult({ images: [{ buffer: source, mimeType: 'image/png' }] }));
    const uploadBuffer = validUploads();
    const deps = dependencies({
      prepareProvider: async () => ({ ...preparedWithFetch(fetch), normalizerVersion: 'ai-image-donor-gpt2-output-normalizer/v1' }),
      uploadBuffer,
    });
    await expect(executeAiImageSuitePaidProvider(request, deps)).resolves.toBe('completed');
    expect(fetch).toHaveBeenCalledOnce();
    expect(deps.recordProviderOutput).toHaveBeenCalledWith(expect.objectContaining({ width: 1008, height: 1344,
      metadata: expect.objectContaining({ normalizerVersion: 'ai-image-donor-gpt2-output-normalizer/v1', actualCostCents: 8 }),
    }));
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ actualCostCents: 8,
      output: expect.objectContaining({ width: 900, height: 1200,
        metadata: expect.objectContaining({ normalizerVersion: 'ai-image-donor-gpt2-output-normalizer/v1' }) }),
    }));
    const { data, info } = await sharp(uploadBuffer.mock.calls[1]![0]).raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 900, height: 1200 });
    for (const [x, y] of [[0, 0], [899, 0], [0, 1199], [899, 1199]]) {
      const offset = (y! * 900 + x!) * info.channels;
      expect(Array.from(data.subarray(offset, offset + 3))).toEqual([223, 32, 32]);
    }
    expect(deps.recordProviderResultEvidence).toHaveBeenCalledOnce();
    expect(deps.complete).toHaveBeenCalledOnce();
  });

  it('rejects an unverified donor frame while retaining known Provider cost instead of fabricating a candidate or refund', async () => {
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'red' } }).png().toBuffer();
    const request = input();
    Object.assign(request.suite, { provider: 'custom', model: 'gpt-image-2' });
    Object.assign(request.job, { provider: 'custom', model: 'gpt-image-2' });
    const deps = dependencies({ prepareProvider: async () => ({
      ...preparedWithFetch(async () => successfulResult({ images: [{ buffer: source, mimeType: 'image/png' }] })),
      normalizerVersion: 'ai-image-donor-gpt2-output-normalizer/v1',
    }) });
    await expect(executeAiImageSuitePaidProvider(request, deps)).rejects.toMatchObject({
      code: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', providerResultReceived: true,
      actualCostCents: 8, providerJobId: 'provider-request-1',
    });
    expect(deps.recordProviderResultEvidence).toHaveBeenCalledOnce();
    expect(deps.uploadBuffer).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('does not settle the count ERP image price before its output passes the frozen dimensions', async () => {
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'red' } }).png().toBuffer();
    const request = input();
    Object.assign(request.suite, { provider: 'custom', model: 'gpt-image-2-count' });
    Object.assign(request.job, { provider: 'custom', model: 'gpt-image-2-count', estimatedCostCents: 10 });
    request.maximumCostCents = 10;
    const deps = dependencies({ prepareProvider: async () => ({
      ...preparedWithFetch(async () => successfulResult({ images: [{ buffer: source, mimeType: 'image/png' }], actualCostCents: 10 })),
      normalizerVersion: 'ai-image-donor-gpt2-output-normalizer/v1',
    }) });
    await expect(executeAiImageSuitePaidProvider(request, deps)).rejects.toMatchObject({
      code: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', providerResultReceived: true, providerJobId: 'provider-request-1',
    });
    expect(deps.recordProviderResultEvidence).not.toHaveBeenCalled();
    expect(deps.uploadBuffer).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('recovers an accepted Wanx task through its original lookup and never submits or re-marks dispatch', async () => {
    const request = input();
    Object.assign(request.suite, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit' });
    Object.assign(request.job, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', providerJobId: 'wanx-original' });
    const execute = vi.fn();
    const recover = vi.fn(async () => ({ status: 'SUCCEEDED' as const, providerJobId: 'wanx-original', providerStatus: 'SUCCEEDED',
      image: { buffer: RAW_BUFFER, mimeType: 'image/png' }, actualCostCents: 8 }));
    const deps = dependencies({
      prepareProvider: async () => ({ evidenceLevel: 'sandbox-verified', providerRequest: { width: 1024, height: 1024 }, execute, recover }),
      normalizeOutput: async () => normalizedOutput(), uploadBuffer: validUploads(),
    });
    await expect(recoverAiImageSuitePaidProvider(request, deps)).resolves.toBe('completed');
    expect(recover).toHaveBeenCalledWith('wanx-original', expect.any(Function));
    expect(execute).not.toHaveBeenCalled();
    expect(deps.markProviderDispatchStarted).not.toHaveBeenCalled();
    expect(deps.recordProviderAccepted).not.toHaveBeenCalled();
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it('keeps pending Wanx lookup outcomes uncharged without a new create request', async () => {
    const request = input();
    Object.assign(request.suite, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit' });
    Object.assign(request.job, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', providerJobId: 'wanx-original' });
    const execute = vi.fn();
    const deps = dependencies({ prepareProvider: async () => ({ evidenceLevel: 'sandbox-verified', execute,
      recover: async () => ({ status: 'PENDING', providerJobId: 'wanx-original', providerStatus: 'RUNNING' }),
    }) });
    await expect(recoverAiImageSuitePaidProvider(request, deps)).rejects.toMatchObject({ code: 'SUITE_PROVIDER_RECOVERY_PENDING', providerJobId: 'wanx-original' });
    expect(execute).not.toHaveBeenCalled();
    expect(deps.markProviderDispatchStarted).not.toHaveBeenCalled();
    expect(deps.recordProviderResultEvidence).not.toHaveBeenCalled();
  });

  it('normalizes and archives Wanx square dimensions while settling only the frozen successful image price', async () => {
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: 'red' } }).png().toBuffer();
    const request = input();
    Object.assign(request.suite, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', estimatedCostCents: 14, maximumCostCents: 14 });
    Object.assign(request.job, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', estimatedCostCents: 14 });
    request.maximumCostCents = 14;
    const prepared = { ...preparedWithFetch(async () => successfulResult({
      images: [{ buffer: source, mimeType: 'image/png' }], actualCostCents: 14,
    })), providerRequest: { width: 1024, height: 1024 } };
    const deps = dependencies({ prepareProvider: async () => prepared, uploadBuffer: validUploads() });
    await expect(executeAiImageSuitePaidProvider(request, deps)).resolves.toBe('completed');
    expect(deps.recordProviderOutput).toHaveBeenCalledWith(expect.objectContaining({ width: 1024, height: 1024 }));
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ actualCostCents: 14,
      output: expect.objectContaining({ width: 900, height: 1200, mimeType: 'image/png' }) }));
  });

  it('does not record a successful-image charge when a Wanx response fails image validation', async () => {
    const request = input();
    Object.assign(request.suite, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit' });
    Object.assign(request.job, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit' });
    const deps = dependencies({ prepareProvider: async () => ({
      ...preparedWithFetch(async () => successfulResult()), providerRequest: { width: 1024, height: 1024 },
    }) });
    await expect(executeAiImageSuitePaidProvider(request, deps)).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID_IMAGE' });
    expect(deps.recordProviderResultEvidence).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('archives the actual 800px recovered Provider bytes without relabelling the raw output as 1024px', async () => {
    const bytes = await sharp({ create: { width: 800, height: 800, channels: 3, background: 'red' } }).png().toBuffer();
    const request = input();
    Object.assign(request.suite, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', estimatedCostCents: 14, maximumCostCents: 14 });
    Object.assign(request.job, { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', providerJobId: 'wanx-original', estimatedCostCents: 14 });
    request.maximumCostCents = 14;
    const execute = vi.fn();
    const deps = dependencies({ uploadBuffer: validUploads(), prepareProvider: async () => ({ evidenceLevel: 'sandbox-verified',
      providerRequest: { width: 1024, height: 1024 }, execute,
      recover: async () => ({ status: 'SUCCEEDED', providerJobId: 'wanx-original', providerStatus: 'SUCCEEDED',
        actualCostCents: 14, image: { buffer: bytes, mimeType: 'image/png' } }),
    }) });
    await expect(recoverAiImageSuitePaidProvider(request, deps)).resolves.toBe('completed');
    expect(deps.recordProviderOutput).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 800,
      sha256: createHash('sha256').update(bytes).digest('hex') }));
    expect(deps.complete).toHaveBeenCalledWith(expect.objectContaining({ actualCostCents: 14,
      output: expect.objectContaining({ width: 900, height: 1200 }) }));
    expect(execute).not.toHaveBeenCalled(); expect(deps.markProviderDispatchStarted).not.toHaveBeenCalled();
  });

  it('does not mark or fetch when Provider preparation fails', async () => {
    const preparationError = new Error('reference bytes changed');
    const markProviderDispatchStarted = vi.fn(async () => true);
    const deps = dependencies({
      prepareProvider: vi.fn(async () => {
        throw preparationError;
      }),
      markProviderDispatchStarted,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).rejects.toBe(preparationError);

    expect(markProviderDispatchStarted).not.toHaveBeenCalled();
  });

  it('does not mark or fetch when the claim is lost at the pre-fetch hook', async () => {
    const claimLost = new Error('claim lost');
    const fetch = vi.fn();
    const assertClaim = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(claimLost);
    const markProviderDispatchStarted = vi.fn(async () => true);
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(fetch)),
      assertClaim,
      markProviderDispatchStarted,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).rejects.toBe(claimLost);

    expect(assertClaim).toHaveBeenCalledTimes(2);
    expect(markProviderDispatchStarted).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fetch when the fenced dispatch marker loses the claim', async () => {
    const fetch = vi.fn();
    const markProviderDispatchStarted = vi.fn(async () => false);
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(fetch)),
      markProviderDispatchStarted,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_DISPATCH_FENCE_LOST',
    });

    expect(markProviderDispatchStarted).toHaveBeenCalledWith(
      new Date('2026-07-24T01:02:03.000Z'),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('releases a revoked dispatch before marking or fetching the Provider request', async () => {
    const fetch = vi.fn();
    const revalidateDispatchAuthorization = vi.fn(async () => ({
      enabled: false,
      reasonCode: 'master_off',
      reason: 'AI image generation was disabled before suite Provider dispatch',
    }));
    const markProviderDispatchStarted = vi.fn(async () => true);
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(fetch)),
      revalidateDispatchAuthorization,
      markProviderDispatchStarted,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_DISPATCH_REVOKED',
      providerSubmissionRejected: true,
      message: 'AI image generation was disabled before suite Provider dispatch',
    });

    expect(revalidateDispatchAuthorization).toHaveBeenCalledOnce();
    expect(markProviderDispatchStarted).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the fenced dispatch immediately before the prepared Provider fetch', async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async () => {
      calls.push('fetch');
      return { images: [], providerJobId: null, actualCostCents: 8 };
    });
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(fetch)),
      assertClaim: vi.fn(async () => {
        calls.push('assert-claim');
      }),
      revalidateDispatchAuthorization: vi.fn(async () => {
        calls.push('dispatch-authorization');
        return { enabled: true, reasonCode: 'enabled', reason: 'authorized' };
      }),
      markProviderDispatchStarted: vi.fn(async () => {
        calls.push('dispatch-marker');
        return true;
      }),
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_RESULT_INVALID',
    });

    expect(calls).toEqual([
      'assert-claim',
      'assert-claim',
      'dispatch-authorization',
      'dispatch-marker',
      'fetch',
    ]);
  });

  it('persists paid Provider identity, cost, raw evidence, and normalized output in order', async () => {
    const calls: string[] = [];
    let claimNumber = 0;
    let uploadNumber = 0;
    const prepareProvider = vi.fn(async () => ({
      evidenceLevel: 'sandbox-verified' as const,
      async execute(
        onProviderAccepted: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
        beforeProviderDispatch?: () => Promise<void>,
      ) {
        calls.push('provider-execute');
        await beforeProviderDispatch?.();
        calls.push('provider-fetch');
        await onProviderAccepted('provider-request-1', PROVIDER_ACCEPTED_AT);
        return successfulResult();
      },
    }));
    const assertClaim = vi.fn(async () => {
      claimNumber += 1;
      calls.push(`claim-${claimNumber}`);
    });
    const markProviderDispatchStarted = vi.fn(async () => {
      calls.push('dispatch-marker');
      return true;
    });
    const recordProviderAccepted = vi.fn(async () => {
      calls.push('provider-accepted');
    });
    const recordProviderResultEvidence = vi.fn(async () => {
      calls.push('provider-result-evidence');
    });
    const normalizeOutput = vi.fn(async () => {
      calls.push('normalize');
      return normalizedOutput();
    });
    const uploadBuffer = vi.fn(async () => {
      uploadNumber += 1;
      calls.push(uploadNumber === 1 ? 'raw-upload' : 'final-upload');
      return uploadNumber === 1
        ? {
          url: 'https://cdn.example/ai/provider-output.png',
          backend: 'oss',
          key: 'ai/provider-output.png',
        }
        : {
          url: 'https://cdn.example/ai/final-output.png',
          backend: 'oss',
          key: 'ai/final-output.png',
        };
    });
    const recordProviderOutput = vi.fn(async () => {
      calls.push('raw-db-evidence');
    });
    const complete = vi.fn(async () => {
      calls.push('complete');
      return 'frontier';
    });
    const deps = dependencies({
      prepareProvider,
      assertClaim,
      markProviderDispatchStarted,
      recordProviderAccepted,
      recordProviderResultEvidence,
      normalizeOutput,
      uploadBuffer,
      recordProviderOutput,
      complete,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).resolves.toBe('frontier');

    expect(calls).toEqual([
      'claim-1',
      'provider-execute',
      'claim-2',
      'dispatch-marker',
      'provider-fetch',
      'provider-accepted',
      'provider-result-evidence',
      'claim-3',
      'normalize',
      'claim-4',
      'raw-upload',
      'claim-5',
      'raw-db-evidence',
      'claim-6',
      'final-upload',
      'claim-7',
      'complete',
    ]);
    expect(prepareProvider).toHaveBeenCalledWith({
      suite: input().suite,
      job: input().job,
    });
    expect(markProviderDispatchStarted).toHaveBeenCalledWith(PROVIDER_RESULT_RECEIVED_AT);
    expect(recordProviderAccepted).toHaveBeenCalledWith(
      'provider-request-1',
      PROVIDER_ACCEPTED_AT,
    );
    expect(recordProviderResultEvidence).toHaveBeenCalledWith({
      providerJobId: 'provider-request-1',
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(normalizeOutput).toHaveBeenCalledWith({
      buffer: RAW_BUFFER,
      mimeType: 'image/png',
    });
    expect(uploadBuffer).toHaveBeenNthCalledWith(
      1,
      RAW_BUFFER,
      `ai-suite-provider-${RAW_SHA256.slice(0, 32)}.png`,
      'image/png',
      {
        category: 'ai-generated',
        ownerId: 'owner-1',
        idempotencyKey: `job-1:provider-output:${RAW_SHA256}`,
      },
    );
    expect(recordProviderOutput).toHaveBeenCalledWith({
      url: 'https://cdn.example/ai/provider-output.png',
      storageBackend: 'oss',
      storageKey: 'ai/provider-output.png',
      mimeType: 'image/png',
      sizeBytes: RAW_BUFFER.length,
      width: 1024,
      height: 1536,
      sha256: RAW_SHA256,
      metadata: {
        version: 'ai-image-suite-provider-output/v1',
        sourceCaptureSnapshotId: 'snapshot-1',
        providerJobId: 'provider-request-1',
        actualCostCents: 8,
        providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT.toISOString(),
        normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
        normalizedSha256: FINAL_SHA256,
      },
    });
    expect(uploadBuffer).toHaveBeenNthCalledWith(
      2,
      FINAL_BUFFER,
      `ai-suite-final-${FINAL_SHA256.slice(0, 32)}.png`,
      'image/png',
      {
        category: 'ai-generated',
        ownerId: 'owner-1',
        idempotencyKey: `job-1:final-output:${FINAL_SHA256}`,
      },
    );
    expect(complete).toHaveBeenCalledWith({
      providerJobId: 'provider-request-1',
      providerAcceptedAt: PROVIDER_ACCEPTED_AT,
      providerResultReceivedWithoutIdentity: false,
      actualCostCents: 8,
      output: {
        url: 'https://cdn.example/ai/final-output.png',
        storageBackend: 'oss',
        storageKey: 'ai/final-output.png',
        mimeType: 'image/png',
        sizeBytes: FINAL_BUFFER.length,
        width: 900,
        height: 1200,
        sha256: FINAL_SHA256,
        metadata: {
          version: 'ai-image-suite-output/v1',
          normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
          sourceCaptureSnapshotId: 'snapshot-1',
        },
      },
    });
  });

  it('completes a synchronous paid result without Provider identity using frozen cost', async () => {
    const recordProviderAccepted = vi.fn(async () => undefined);
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const recordProviderOutput = vi.fn(async () => undefined);
    const complete = vi.fn(async () => 'frontier-without-provider-id');
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
        actualCostCents: null,
      })))),
      normalizeOutput: vi.fn(async () => normalizedOutput()),
      uploadBuffer: validUploads(),
      recordProviderAccepted,
      recordProviderResultEvidence,
      recordProviderOutput,
      complete,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps))
      .resolves.toBe('frontier-without-provider-id');

    expect(recordProviderAccepted).not.toHaveBeenCalled();
    expect(recordProviderResultEvidence).toHaveBeenCalledWith({
      providerJobId: null,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(recordProviderOutput).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        providerJobId: null,
        actualCostCents: 8,
        providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT.toISOString(),
      }),
    }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      providerJobId: null,
      providerAcceptedAt: null,
      providerResultReceivedWithoutIdentity: true,
      actualCostCents: 8,
    }));
  });

  it('propagates a definite Provider rejection without manufacturing result evidence', async () => {
    const rejected = Object.assign(new Error('Provider rejected the request'), {
      code: 'PROVIDER_REQUEST_FAILED',
      providerHttpStatus: 400,
      providerSubmissionRejected: true,
    });
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const uploadBuffer = vi.fn();
    const complete = vi.fn(async () => 'unexpected');
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => {
        throw rejected;
      }))),
      recordProviderResultEvidence,
      uploadBuffer,
      complete,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(rejected);
    expect(caught).toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      providerHttpStatus: 400,
      providerSubmissionRejected: true,
    });
    expect(caught).not.toHaveProperty('providerResultReceived', true);
    expect(recordProviderResultEvidence).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('propagates a Provider timeout as submission-uncertain without result evidence', async () => {
    const timedOut = Object.assign(new Error('Provider request timed out'), {
      code: 'PROVIDER_TIMEOUT',
      providerSubmissionUncertain: true,
    });
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const uploadBuffer = vi.fn();
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => {
        throw timedOut;
      }))),
      recordProviderResultEvidence,
      uploadBuffer,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(timedOut);
    expect(caught).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      providerSubmissionUncertain: true,
    });
    expect(caught).not.toHaveProperty('providerResultReceived', true);
    expect(recordProviderResultEvidence).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('rejects a Provider response identity that conflicts with accepted request evidence', async () => {
    const recordProviderAccepted = vi.fn(async () => undefined);
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const normalizeOutput = vi.fn(async () => normalizedOutput());
    const deps = dependencies({
      prepareProvider: vi.fn(async () => ({
        evidenceLevel: 'sandbox-verified' as const,
        async execute(
          onProviderAccepted: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
          beforeProviderDispatch?: () => Promise<void>,
        ) {
          await beforeProviderDispatch?.();
          await onProviderAccepted('provider-request-accepted', PROVIDER_ACCEPTED_AT);
          return successfulResult({ providerJobId: 'provider-request-conflicting' });
        },
      })),
      recordProviderAccepted,
      recordProviderResultEvidence,
      normalizeOutput,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_RESULT_INVALID',
      providerJobId: 'provider-request-accepted',
      providerAcceptedAt: PROVIDER_ACCEPTED_AT,
      providerResultReceived: true,
    });
    expect(recordProviderAccepted).toHaveBeenCalledOnce();
    expect(recordProviderResultEvidence).not.toHaveBeenCalled();
    expect(normalizeOutput).not.toHaveBeenCalled();
  });

  it('propagates a persisted Provider identity conflict with the returned identity attached', async () => {
    const identityConflict = Object.assign(
      new Error('Provider request identity conflicts with persisted evidence'),
      { code: 'PROVIDER_JOB_ID_MISMATCH' },
    );
    const recordProviderAccepted = vi.fn(async () => {
      throw identityConflict;
    });
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult()))),
      recordProviderAccepted,
      recordProviderResultEvidence,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(identityConflict);
    expect(caught).toMatchObject({
      code: 'PROVIDER_JOB_ID_MISMATCH',
      providerJobId: 'provider-request-1',
      providerAcceptedAt: PROVIDER_RESULT_RECEIVED_AT,
      providerResultReceived: true,
    });
    expect(recordProviderResultEvidence).not.toHaveBeenCalled();
  });

  it.each([
    ['zero images', []],
    ['multiple images', [
      { buffer: RAW_BUFFER, mimeType: 'image/png' },
      { buffer: RAW_BUFFER, mimeType: 'image/png' },
    ]],
  ])('rejects a paid Provider result with %s', async (_label, images) => {
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const normalizeOutput = vi.fn(async () => normalizedOutput());
    const uploadBuffer = vi.fn();
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
        images,
      })))),
      recordProviderResultEvidence,
      normalizeOutput,
      uploadBuffer,
    });

    await expect(executeAiImageSuitePaidProvider(input(), deps)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_RESULT_INVALID',
      providerResultReceived: true,
    });
    expect(recordProviderResultEvidence).not.toHaveBeenCalled();
    expect(normalizeOutput).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ['below the frozen estimate', 7, 8],
    ['above the frozen estimate', 9, 8],
    ['non-integer', 8.5, 8],
    ['above the maximum reservation', 8, 7],
  ])('rejects Provider cost %s', async (_label, actualCostCents, maximumCostCents) => {
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const normalizeOutput = vi.fn(async () => normalizedOutput());
    const executionInput = { ...input(), maximumCostCents };
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
        actualCostCents,
      })))),
      recordProviderResultEvidence,
      normalizeOutput,
    });

    await expect(executeAiImageSuitePaidProvider(executionInput, deps)).rejects.toMatchObject({
      code: 'SUITE_PROVIDER_COST_INVALID',
      providerResultReceived: true,
    });
    expect(recordProviderResultEvidence).not.toHaveBeenCalled();
    expect(normalizeOutput).not.toHaveBeenCalled();
  });

  it('attaches known result and cost evidence when normalization fails', async () => {
    const normalizationFailure = Object.assign(new Error('normalization failed'), {
      code: 'PROVIDER_OUTPUT_NORMALIZATION_FAILED',
    });
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const uploadBuffer = vi.fn();
    const deps = dependencies({
      prepareProvider: vi.fn(async () => ({
        evidenceLevel: 'sandbox-verified' as const,
        async execute(
          onProviderAccepted: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
          beforeProviderDispatch?: () => Promise<void>,
        ) {
          await beforeProviderDispatch?.();
          await onProviderAccepted('provider-request-1', PROVIDER_ACCEPTED_AT);
          return successfulResult();
        },
      })),
      recordProviderResultEvidence,
      normalizeOutput: vi.fn(async () => {
        throw normalizationFailure;
      }),
      uploadBuffer,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(normalizationFailure);
    expect(caught).toMatchObject({
      code: 'PROVIDER_OUTPUT_NORMALIZATION_FAILED',
      providerJobId: 'provider-request-1',
      providerAcceptedAt: PROVIDER_ACCEPTED_AT,
      providerResultReceived: true,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(recordProviderResultEvidence).toHaveBeenCalledWith({
      providerJobId: 'provider-request-1',
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('stops before normalization when durable Provider result evidence cannot be recorded', async () => {
    const evidenceFailure = new Error('result evidence unavailable');
    const normalizeOutput = vi.fn(async () => normalizedOutput());
    const uploadBuffer = vi.fn();
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
      })))),
      recordProviderResultEvidence: vi.fn(async () => {
        throw evidenceFailure;
      }),
      normalizeOutput,
      uploadBuffer,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(evidenceFailure);
    expect(caught).toMatchObject({
      providerResultReceived: true,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(normalizeOutput).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('preserves known cost evidence when raw output storage fails', async () => {
    const storageFailure = new Error('raw storage unavailable');
    const recordProviderOutput = vi.fn(async () => undefined);
    const complete = vi.fn(async () => 'unexpected');
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
      })))),
      normalizeOutput: vi.fn(async () => normalizedOutput()),
      uploadBuffer: vi.fn(async () => {
        throw storageFailure;
      }),
      recordProviderOutput,
      complete,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(storageFailure);
    expect(caught).toMatchObject({
      providerResultReceived: true,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(recordProviderOutput).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not upload the final output when raw database evidence fails', async () => {
    const rawEvidenceFailure = new Error('raw database evidence unavailable');
    const uploadBuffer = validUploads();
    const complete = vi.fn(async () => 'unexpected');
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
      })))),
      normalizeOutput: vi.fn(async () => normalizedOutput()),
      uploadBuffer,
      recordProviderOutput: vi.fn(async () => {
        throw rawEvidenceFailure;
      }),
      complete,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(rawEvidenceFailure);
    expect(caught).toMatchObject({
      providerResultReceived: true,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(uploadBuffer).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it('retains raw evidence and known cost when final output storage fails', async () => {
    const finalStorageFailure = new Error('final storage unavailable');
    const uploadBuffer = vi.fn()
      .mockResolvedValueOnce({
        url: 'https://cdn.example/ai/provider-output.png',
        backend: 'oss',
        key: 'ai/provider-output.png',
      })
      .mockRejectedValueOnce(finalStorageFailure);
    const recordProviderOutput = vi.fn(async () => undefined);
    const complete = vi.fn(async () => 'unexpected');
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
      })))),
      normalizeOutput: vi.fn(async () => normalizedOutput()),
      uploadBuffer,
      recordProviderOutput,
      complete,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(finalStorageFailure);
    expect(caught).toMatchObject({
      providerResultReceived: true,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(recordProviderOutput).toHaveBeenCalledOnce();
    expect(uploadBuffer).toHaveBeenCalledTimes(2);
    expect(complete).not.toHaveBeenCalled();
  });

  it('stops after durable result evidence when the execution claim is then lost', async () => {
    const claimLost = new Error('claim lost after Provider result');
    let claimNumber = 0;
    const assertClaim = vi.fn(async () => {
      claimNumber += 1;
      if (claimNumber === 3) throw claimLost;
    });
    const recordProviderResultEvidence = vi.fn(async () => undefined);
    const normalizeOutput = vi.fn(async () => normalizedOutput());
    const uploadBuffer = vi.fn();
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
      })))),
      assertClaim,
      recordProviderResultEvidence,
      normalizeOutput,
      uploadBuffer,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(claimLost);
    expect(caught).toMatchObject({
      providerResultReceived: true,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(recordProviderResultEvidence).toHaveBeenCalledOnce();
    expect(normalizeOutput).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('retains raw evidence and stops before final upload when the claim is lost', async () => {
    const claimLost = new Error('claim lost after raw evidence');
    let claimNumber = 0;
    const assertClaim = vi.fn(async () => {
      claimNumber += 1;
      if (claimNumber === 6) throw claimLost;
    });
    const uploadBuffer = validUploads();
    const recordProviderOutput = vi.fn(async () => undefined);
    const complete = vi.fn(async () => 'unexpected');
    const deps = dependencies({
      prepareProvider: vi.fn(async () => preparedWithFetch(vi.fn(async () => successfulResult({
        providerJobId: null,
      })))),
      assertClaim,
      normalizeOutput: vi.fn(async () => normalizedOutput()),
      uploadBuffer,
      recordProviderOutput,
      complete,
    });

    const caught = await executeAiImageSuitePaidProvider(input(), deps).catch((error) => error);

    expect(caught).toBe(claimLost);
    expect(caught).toMatchObject({
      providerResultReceived: true,
      actualCostCents: 8,
      providerResultReceivedAt: PROVIDER_RESULT_RECEIVED_AT,
    });
    expect(recordProviderOutput).toHaveBeenCalledOnce();
    expect(uploadBuffer).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });
});
