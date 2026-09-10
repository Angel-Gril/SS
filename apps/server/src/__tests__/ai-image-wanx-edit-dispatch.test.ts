import { lookup } from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { AiImageJobError } from '../services/ai-image-job-error.js';
import type { OpenAiImageEditRequest } from '../services/ai-image-providers.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { AI_IMAGE_WANX21_EDIT_MODEL } from '../services/ai-image-wanx-edit-profile.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const options = {
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: 'wanx-dispatch-test-sentinel',
  model: AI_IMAGE_WANX21_EDIT_MODEL,
  pollIntervalMs: 0,
  timeoutMs: 5_000,
};

async function request(): Promise<OpenAiImageEditRequest> {
  const buffer = await sharp({
    create: {
      width: 512, height: 512, channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  }).png().toBuffer();
  return {
    operation: 'FULL_EDIT', prompt: 'Preserve the product and edit the background.',
    negativePrompt: null, width: 1024, height: 1024,
    model: AI_IMAGE_WANX21_EDIT_MODEL,
    images: [{ buffer, mimeType: 'image/png' }], mask: null,
  };
}

function acceptedTask() {
  return new Response(JSON.stringify({
    output: { task_id: 'wanx-dispatch-task', task_status: 'PENDING' },
  }), { headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Wanx dispatch boundary', () => {
  it.each([
    { prompt: 'x'.repeat(801) },
    { negativePrompt: 'Do not add text.' },
    { width: 1024, height: 1536 },
    { model: 'unreviewed-model' },
    { images: [] },
  ])('proves zero submission for an invalid request: %j', async (invalid) => {
    const fetcher = vi.fn();
    const beforeProviderDispatch = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({
      ...options, fetch: fetcher, beforeProviderDispatch,
    });

    const error = await provider.edit({ ...await request(), ...invalid }).catch((value) => value);

    expect(error).toBeInstanceOf(AiImageJobError);
    expect(error).toMatchObject({ providerSubmissionRejected: true });
    expect(error).not.toHaveProperty('providerSubmissionUncertain');
    expect(error).not.toHaveProperty('providerJobId');
    expect(beforeProviderDispatch).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rechecks the lease after DNS and refuses a request revoked during resolution', async () => {
    const events: string[] = [];
    let leaseValid = true;
    vi.mocked(lookup).mockImplementation(async () => {
      events.push('dns');
      leaseValid = false;
      return [{ address: '8.8.8.8', family: 4 }] as never;
    });
    const fetcher = vi.fn(async () => { throw new Error('unexpected Provider POST'); });
    vi.stubGlobal('fetch', fetcher);
    const fenceError = new AiImageJobError('EDIT_EXECUTION_LEASE_LOST', 'Execution lease was lost');
    const beforeProviderDispatch = vi.fn(async () => {
      events.push('fence');
      if (!leaseValid) throw fenceError;
    });
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, beforeProviderDispatch });

    const error = await provider.edit(await request()).catch((value) => value);

    expect(error).toBe(fenceError);
    expect(error).toMatchObject({ providerSubmissionRejected: true });
    expect(events).toEqual(['dns', 'fence']);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('preserves the original fence error while proving the Provider was never invoked', async () => {
    const fetcher = vi.fn();
    const fenceError = new AiImageJobError('AI_IMAGE_EDIT_DISPATCH_REVOKED', 'Dispatch was revoked');
    const provider = createDashScopeWanx21ImageEditProvider({
      ...options, fetch: fetcher,
      beforeProviderDispatch: async () => { throw fenceError; },
    });

    const error = await provider.edit(await request()).catch((value) => value);

    expect(error).toBe(fenceError);
    expect(error).toMatchObject({ providerSubmissionRejected: true });
    expect(error).not.toHaveProperty('providerSubmissionUncertain');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not confuse DNS failure with a paid submission of unknown outcome', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('synthetic DNS failure'));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const beforeProviderDispatch = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, beforeProviderDispatch });

    const error = await provider.edit(await request()).catch((value) => value);

    expect(error).toMatchObject({ providerSubmissionRejected: true });
    expect(error).not.toHaveProperty('providerSubmissionUncertain');
    expect(beforeProviderDispatch).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not submit when DNS consumes the entire request deadline', async () => {
    const input = await request();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(lookup).mockImplementation(async () => {
      now += options.timeoutMs;
      return [{ address: '8.8.8.8', family: 4 }] as never;
    });
    const fetcher = vi.fn(async () => { throw new Error('unexpected Provider POST'); });
    vi.stubGlobal('fetch', fetcher);
    const beforeProviderDispatch = vi.fn();
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, beforeProviderDispatch });

    await expect(provider.edit(input)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT', providerSubmissionRejected: true,
    });
    expect(beforeProviderDispatch).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains an uncertain outcome after fetch starts and never retries the POST', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      throw new TypeError('synthetic connection loss');
    });
    const provider = createDashScopeWanx21ImageEditProvider({ ...options, fetch: fetcher });

    const error = await provider.edit(await request()).catch((value) => value);

    expect(error).toMatchObject({ providerSubmissionUncertain: true });
    expect(error).not.toHaveProperty('providerSubmissionRejected');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('retains the accepted task and stops before polling when persistence fails', async () => {
    const fetcher = vi.fn(async () => acceptedTask());
    const provider = createDashScopeWanx21ImageEditProvider({
      ...options, fetch: fetcher,
      onProviderJobCreated: async () => { throw new Error('synthetic storage failure'); },
    });

    const error = await provider.edit(await request()).catch((value) => value);

    expect(error).toMatchObject({
      code: 'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
      providerJobId: 'wanx-dispatch-task', providerAcceptedAt: expect.any(Date),
    });
    expect(error).not.toHaveProperty('providerSubmissionRejected');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retains the accepted task after a poll error without sending a second POST', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(acceptedTask())
      .mockRejectedValueOnce(new Error('synthetic poll failure'));
    const persisted = vi.fn(async () => undefined);
    const provider = createDashScopeWanx21ImageEditProvider({
      ...options, fetch: fetcher, onProviderJobCreated: persisted,
    });

    const error = await provider.edit(await request()).catch((value) => value);

    expect(error).toMatchObject({
      providerJobId: 'wanx-dispatch-task', providerAcceptedAt: expect.any(Date),
    });
    expect(error).not.toHaveProperty('providerSubmissionRejected');
    expect(persisted).toHaveBeenCalledWith('wanx-dispatch-task', expect.any(Date));
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
  });
});
