import { lookup } from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { AiImageJobError } from '../services/ai-image-job-error.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { AI_IMAGE_WANX21_EDIT_PROFILE } from '../services/ai-image-wanx-edit-profile.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const taskId = 'wanx-recovery-task';
const resultUrl = 'https://dashscope-a717.oss-cn-beijing.aliyuncs.com/recovered.png?signature=opaque';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);
const options = {
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: 'wanx-lookup-test-sentinel',
  model: AI_IMAGE_WANX21_EDIT_PROFILE.model,
  costPerImageCents: 7,
  pollIntervalMs: 0,
  timeoutMs: 5_000,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

function successfulTask() {
  return {
    output: {
      task_id: taskId,
      task_status: 'SUCCEEDED',
      results: [{ url: resultUrl }],
      task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 },
    },
    usage: { image_count: 1 },
  };
}

function statusTask(status: unknown, responseTaskId: unknown = taskId) {
  return { output: { task_id: responseTaskId, task_status: status } };
}

async function editRequest() {
  const buffer = await sharp({
    create: {
      width: 512, height: 512, channels: 3,
      background: { r: 80, g: 120, b: 160 },
    },
  }).png().toBuffer();
  return {
    operation: 'FULL_EDIT' as const,
    prompt: 'Preserve the product and replace the background.',
    negativePrompt: null,
    width: 1024, height: 1024,
    images: [{ buffer, mimeType: 'image/png' as const }],
    mask: null,
  };
}

beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Wanx edit single-task recovery lookup', () => {
  it.each(['PENDING', 'RUNNING'])('returns %s after one GET without submission callbacks', async (status) => {
    const fetcher = vi.fn(async () => json(statusTask(status)));
    const beforeTaskLookup = vi.fn(async () => undefined);
    const beforeProviderDispatch = vi.fn();
    const onProviderJobCreated = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({
      ...options, fetch: fetcher, beforeTaskLookup, beforeProviderDispatch, onProviderJobCreated,
    });

    expect(await provider.poll(taskId)).toEqual({
      status: 'PENDING', providerJobId: taskId, providerStatus: status,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      `${options.baseUrl}/tasks/${taskId}`,
      expect.objectContaining({
        method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { Authorization: `Bearer ${options.apiKey}` },
      }),
    );
    expect(beforeTaskLookup).toHaveBeenCalledOnce();
    expect(beforeProviderDispatch).not.toHaveBeenCalled();
    expect(onProviderJobCreated).not.toHaveBeenCalled();
  });

  it('recovers one metered image with one uncredentialed download', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(successfulTask()))
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }));
    const onProviderJobCreated = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher, onProviderJobCreated });

    expect(await provider.poll(taskId)).toEqual({
      status: 'SUCCEEDED', providerJobId: taskId, providerStatus: 'SUCCEEDED',
      image: { buffer: png, mimeType: 'image/png', filename: `wanx-edit-${taskId}.png` },
      actualCostCents: 7,
    });
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['GET', 'GET']);
    expect(fetcher.mock.calls[1]?.[0]).toBe(resultUrl);
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).has('authorization')).toBe(false);
    expect(fetcher.mock.calls[1]?.[1]?.redirect).toBe('error');
    expect(onProviderJobCreated).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'CANCELED', 'CANCELLED'])('keeps %s billing unknown without downloading', async (status) => {
    const fetcher = vi.fn(async () => json({
      output: { ...statusTask(status).output, message: 'WANX_RAW_ERROR_MUST_NOT_ESCAPE' },
    }));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });
    const result = await provider.poll(taskId);

    expect(result).toMatchObject({
      status: 'NO_OUTPUT', providerJobId: taskId, providerStatus: status,
      errorCode: 'PROVIDER_TASK_FAILED', billingDisposition: 'UNKNOWN',
    });
    expect(JSON.stringify(result)).not.toContain('WANX_RAW_ERROR_MUST_NOT_ESCAPE');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['UNKNOWN', 'HTTP_404'])('retains uncertainty for %s without classifying no output', async (status) => {
    const fetcher = vi.fn(async () => status === 'HTTP_404'
      ? json({ code: 'TaskNotFound' }, 404)
      : json(statusTask(status)));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });
    const error = await provider.poll(taskId).catch((value) => value);

    expect(error).toBeInstanceOf(AiImageJobError);
    expect(error).toMatchObject({ code: 'PROVIDER_TASK_UNKNOWN', providerJobId: taskId });
    expect(error).not.toHaveProperty('providerSubmissionRejected');
    expect(error).not.toHaveProperty('providerAcceptedAt');
    if (status === 'HTTP_404') expect(error).toHaveProperty('providerHttpStatus', 404);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'CANCELLED', 'UNKNOWN'].flatMap(
    (status) => [
      { status, responseTaskId: null },
      { status, responseTaskId: 'another-task' },
    ],
  ))('rejects mismatched identity before interpreting $status: $responseTaskId', async ({ status, responseTaskId }) => {
    const fetcher = vi.fn(async () => json({
      ...successfulTask(), output: { ...successfulTask().output, task_status: status, task_id: responseTaskId },
    }));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT', providerJobId: taskId,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['', 'QUEUED', null, 1])('rejects an unreviewed task status %j', async (status) => {
    const fetcher = vi.fn(async () => json(statusTask(status)));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT', providerJobId: taskId,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['', ' ', '.', '..', 'task\nmalformed', 'x'.repeat(501)])('rejects unsafe task input %j before GET', async (invalidId) => {
    const fetcher = vi.fn();
    const beforeTaskLookup = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher, beforeTaskLookup });

    await expect(provider.poll(invalidId)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(beforeTaskLookup).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing metrics', task_metrics: undefined },
    { label: 'partial success', task_metrics: { TOTAL: 2, SUCCEEDED: 1, FAILED: 1 } },
    { label: 'non-numeric metrics', task_metrics: { TOTAL: '1', SUCCEEDED: '1', FAILED: '0' } },
    { label: 'multiple results', results: [{ url: resultUrl }, { url: resultUrl }] },
    { label: 'missing URL', results: [{}] },
  ])('rejects $label before downloading', async ({ label: _label, ...invalid }) => {
    const body = successfulTask();
    const fetcher = vi.fn(async () => json({ ...body, output: { ...body.output, ...invalid } }));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT', providerJobId: taskId,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([undefined, 0, 2, '1'])('rejects unproven metering %j before downloading', async (imageCount) => {
    const fetcher = vi.fn(async () => json({ ...successfulTask(), usage: { image_count: imageCount } }));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT', providerJobId: taskId,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 429, 500])('preserves accepted identity after lookup HTTP %i', async (status) => {
    const fetcher = vi.fn(async () => json({ code: 'SyntheticError', message: options.apiKey }, status));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });
    const error = await provider.poll(taskId).catch((value) => value);

    expect(error).toMatchObject({ providerJobId: taskId, providerHttpStatus: status });
    expect(error).not.toHaveProperty('providerSubmissionRejected');
    expect(error).not.toHaveProperty('providerAcceptedAt');
    expect(error.message).not.toContain(options.apiKey);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('runs the lookup fence after DNS and preserves its rejection before GET', async () => {
    const events: string[] = [];
    vi.mocked(lookup).mockImplementation(async () => {
      events.push('dns');
      return [{ address: '8.8.8.8', family: 4 }] as never;
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const fenceError = new AiImageJobError('PROVIDER_RECONCILIATION_LEASE_LOST', 'Lookup lease was lost');
    const beforeTaskLookup = vi.fn(async () => {
      events.push('lookup-fence');
      throw fenceError;
    });
    const beforeProviderDispatch = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, beforeTaskLookup, beforeProviderDispatch });
    const error = await provider.poll(taskId).catch((value) => value);

    expect(error).toBe(fenceError);
    expect(error).toMatchObject({ providerJobId: taskId });
    expect(error).not.toHaveProperty('providerSubmissionRejected');
    expect(error).not.toHaveProperty('providerAcceptedAt');
    expect(events).toEqual(['dns', 'lookup-fence']);
    expect(fetcher).not.toHaveBeenCalled();
    expect(beforeProviderDispatch).not.toHaveBeenCalled();
  });

  it('rejects private DNS before the lookup fence and GET', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const beforeTaskLookup = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, beforeTaskLookup });

    await expect(provider.poll(taskId)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_URL', providerJobId: taskId,
    });
    expect(beforeTaskLookup).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not GET when DNS consumes the lookup deadline', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(lookup).mockImplementation(async () => {
      now += options.timeoutMs;
      return [{ address: '8.8.8.8', family: 4 }] as never;
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const beforeTaskLookup = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, beforeTaskLookup });

    await expect(provider.poll(taskId)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', providerJobId: taskId });
    expect(beforeTaskLookup).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([5_000, 300_000])('shares the clamped %i ms deadline with the output download', async (timeoutMs) => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetcher = vi.fn(async () => {
      now += Math.min(timeoutMs, AI_IMAGE_WANX21_EDIT_PROFILE.maximumPollDurationMs);
      return json(successfulTask());
    });
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, timeoutMs, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', providerJobId: taskId });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects a pending response received after the lookup deadline', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetcher = vi.fn(async () => {
      now += options.timeoutMs;
      return json(statusTask('PENDING'));
    });
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', providerJobId: taskId });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects an image received after the lookup deadline', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(successfulTask()))
      .mockImplementationOnce(async () => {
        now += options.timeoutMs;
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      });
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', providerJobId: taskId });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains task identity when a lookup is aborted by its timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic timeout', 'AbortError')));
    }));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, timeoutMs: 50, fetch: fetcher });
    const assertion = expect(provider.poll(taskId)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT', providerJobId: taskId,
    });

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    'https://result.example/recovered.png',
    'https://dashscope-a717.oss-cn-beijing.aliyuncs.com.evil.test/recovered.png',
    `${resultUrl}#fragment`,
  ])('rejects unreviewed output URL %s before download', async (url) => {
    const body = successfulTask();
    const fetcher = vi.fn(async () => json({ ...body, output: { ...body.output, results: [{ url }] } }));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.poll(taskId)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL', providerJobId: taskId });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { label: 'bad image bytes', response: () => new Response('not an image', { headers: { 'content-type': 'image/png' } }), code: 'INVALID_PROVIDER_RESULT' },
    { label: 'oversized result', response: () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024 + 1) } }), code: 'PROVIDER_RESPONSE_TOO_LARGE' },
    { label: 'expired output URL', response: () => new Response(null, { status: 404 }), code: 'PROVIDER_REQUEST_FAILED' },
  ])('retains accepted identity after $label', async ({ response, code }) => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(successfulTask())).mockResolvedValueOnce(response());
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });
    const error = await provider.poll(taskId).catch((value) => value);

    expect(error).toMatchObject({ code, providerJobId: taskId });
    expect(error).not.toHaveProperty('providerSubmissionRejected');
    expect(error).not.toHaveProperty('providerAcceptedAt');
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['GET', 'GET']);
  });
});

describe('Wanx foreground edit reuses task lookup', () => {
  it('rejects another task in a pending response immediately', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(statusTask('PENDING')))
      .mockResolvedValue(json(statusTask('PENDING', 'another-task')));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.edit(await editRequest())).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT', providerJobId: taskId, providerAcceptedAt: expect.any(Date),
    });
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
  });

  it('preserves UNKNOWN and the original acceptance time after one foreground lookup', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(statusTask('PENDING')))
      .mockResolvedValueOnce(json(statusTask('UNKNOWN')));
    const accepted = vi.fn(async (_providerJobId: string, _providerAcceptedAt: Date) => undefined);
    const beforeTaskLookup = vi.fn(async () => undefined);
    const provider = createDashScopeWanx21ImageEditProvider({
      ...options, fetch: fetcher, beforeTaskLookup, onProviderJobCreated: accepted,
    });
    const error = await provider.edit(await editRequest()).catch((value) => value);

    expect(error).toMatchObject({ code: 'PROVIDER_TASK_UNKNOWN', providerJobId: taskId });
    expect(error.providerAcceptedAt).toBe(accepted.mock.calls[0]?.[1]);
    expect(accepted).toHaveBeenCalledOnce();
    expect(beforeTaskLookup).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
  });

  it('limits foreground queries to 120 without another submission', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(statusTask('PENDING')));
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    await expect(provider.edit(await editRequest())).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT', providerJobId: taskId,
    });
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'GET')).toHaveLength(120);
  });
});
