import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiTextConfig } from '../services/ai-text.js';
import {
  createProductVisionTransport,
  ProductVisionTransportError,
} from '../services/product-vision-transport.js';

const config: AiTextConfig = {
  provider: 'custom',
  baseUrl: 'https://vision.example.com/v1/',
  apiKey: 'test-only-secret-sentinel',
  model: 'configured-vision-model',
};
const jpeg = await sharp({
  create: { width: 2, height: 2, channels: 3, background: '#fff' },
}).jpeg().toBuffer();
const images = [{ mimeType: 'image/jpeg' as const, buffer: jpeg }];
const lookup = vi.fn(async () => [{ address: '1.1.1.1', family: 4 }]);
const content = '{"visible":"white surface","uncertain":[]}';

function response(overrides: Record<string, unknown> = {}, init: ResponseInit = {}) {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    ...overrides,
  }), { headers: { 'content-type': 'application/json' }, ...init });
}

function fixture(fetchImpl = vi.fn<typeof fetch>(async () => response())) {
  return {
    fetchImpl,
    analyze: createProductVisionTransport({ fetch: fetchImpl, lookup }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('product vision transport', () => {
  it('sends normalized JPEG bytes in one constrained multimodal POST and returns safe usage', async () => {
    const { fetchImpl, analyze } = fixture();
    await expect(analyze({ config, prompt: 'Describe only visible product details.', images }))
      .resolves.toEqual({ text: content, usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://vision.example.com/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST', redirect: 'error', credentials: 'omit',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      dispatcher: expect.any(Object), signal: expect.any(AbortSignal),
    });
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: config.model, temperature: 0, max_tokens: 1200, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: expect.stringMatching(/visible/i) },
        { role: 'user', content: [
          { type: 'text', text: 'Describe only visible product details.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
        ] },
      ],
    });
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith('vision.example.com');
  });

  it.each(['https://vision.example.com', 'https://vision.example.com/v1', 'https://vision.example.com/v1/chat/completions'])(
    'canonicalizes the chat endpoint without duplicating its suffix: %s', async (baseUrl) => {
      const { fetchImpl, analyze } = fixture();
      await analyze({ config: { ...config, baseUrl }, prompt: 'Visible facts', images });
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(baseUrl.includes('/v1')
        ? 'https://vision.example.com/v1/chat/completions'
        : 'https://vision.example.com/chat/completions');
    },
  );

  it.each([
    { provider: 'disabled' as const }, { model: '' }, { apiKey: '' },
    { model: 'bad\nmodel' }, { apiKey: 'bad\nkey' }, { timeoutMs: Number.NaN },
  ])('rejects invalid administrator configuration before DNS or POST: %j', async (overrides) => {
    const { fetchImpl, analyze } = fixture();
    await expect(analyze({ config: { ...config, ...overrides }, prompt: 'Visible facts', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_CONFIG_INVALID', outcome: 'NOT_SENT' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    'http://vision.example.com/v1', 'https://user:password@vision.example.com/v1',
    'https://vision.example.com/v1?token=secret', 'https://vision.example.com/v1#fragment',
    'https://localhost/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/v1',
    'https://[::1]/v1', 'https://vision.internal/v1', 'https://vision.example.com:8080/v1',
  ])('rejects unsafe endpoints before POST: %s', async (baseUrl) => {
    const { fetchImpl, analyze } = fixture();
    await expect(analyze({ config: { ...config, baseUrl }, prompt: 'Visible facts', images }))
      .rejects.toMatchObject({ outcome: 'NOT_SENT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { records: [{ address: '127.0.0.1', family: 4 }] },
    { records: [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }] },
    { records: [] },
  ])('rejects DNS resolving to private or mixed addresses before POST', async ({ records }) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const analyze = createProductVisionTransport({ fetch: fetchImpl, lookup: async () => records });
    await expect(analyze({ config, prompt: 'Visible facts', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_NON_PUBLIC_ADDRESS', outcome: 'NOT_SENT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { invalidImages: [] },
    { invalidImages: Array.from({ length: 6 }, () => images[0]!) },
    { invalidImages: [{ mimeType: 'image/png', buffer: jpeg }] },
    { invalidImages: [{ mimeType: 'image/jpeg', buffer: Buffer.alloc(0) }] },
    { invalidImages: [{ mimeType: 'image/jpeg', buffer: Buffer.alloc(1024 * 1024 + 1) }] },
  ])('rejects invalid normalized image inputs before POST', async ({ invalidImages }) => {
    const { fetchImpl, analyze } = fixture();
    await expect(analyze({ config, prompt: 'Visible facts', images: invalidImages as typeof images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_INPUT_INVALID', outcome: 'NOT_SENT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['', 'x'.repeat(16 * 1024 + 1)])('rejects empty or over-limit prompts before POST', async (prompt) => {
    const { fetchImpl, analyze } = fixture();
    await expect(analyze({ config, prompt, images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_INPUT_INVALID', outcome: 'NOT_SENT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts exactly five one-MiB images without omitting or substituting bytes', async () => {
    const { fetchImpl, analyze } = fixture();
    const buffer = Buffer.alloc(1024 * 1024, 42);
    await analyze({ config, prompt: 'Visible facts', images: Array.from({ length: 5 }, () => ({ mimeType: 'image/jpeg', buffer })) });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.messages[1].content).toHaveLength(6);
    expect(Buffer.from(body.messages[1].content[5].image_url.url.split(',')[1], 'base64')).toEqual(buffer);
  });

  it.each([302, 307, 401, 429, 500])('never follows redirects or retries an HTTP %s', async (status) => {
    const { fetchImpl, analyze } = fixture(vi.fn<typeof fetch>(async () => new Response(config.apiKey, {
      status, headers: { location: 'https://other.example.com/secret', 'content-type': 'text/plain' },
    })));
    const error = await analyze({ config, prompt: 'Visible facts', images }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ProductVisionTransportError);
    expect(error).toMatchObject({ status, outcome: 'UNKNOWN_OUTCOME' });
    expect(String(error)).not.toContain(config.apiKey);
    expect(JSON.stringify(error)).not.toContain(config.apiKey);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    new Response('{invalid JSON', { headers: { 'content-type': 'application/json' } }),
    response({ choices: [] }),
    response({ choices: [{ message: { content: null, reasoning_content: 'reasoning only' }, finish_reason: 'length' }] }),
    response({ choices: [{ message: { content: config.apiKey } }] }),
    response({}, { headers: { 'content-type': 'text/html' } }),
  ])('rejects malformed or unsafe Provider output without reasoning retry', async (providerResponse) => {
    const { fetchImpl, analyze } = fixture(vi.fn<typeof fetch>(async () => providerResponse));
    await expect(analyze({ config, prompt: 'Visible facts', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_RESPONSE_INVALID', outcome: 'UNKNOWN_OUTCOME' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024 + 1) } }),
    new Response('x'.repeat(64 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
  ])('bounds declared and streamed response bytes', async (providerResponse) => {
    const { fetchImpl, analyze } = fixture(vi.fn<typeof fetch>(async () => providerResponse));
    await expect(analyze({ config, prompt: 'Visible facts', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_RESPONSE_TOO_LARGE', outcome: 'UNKNOWN_OUTCOME' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns only finite nonnegative integer usage values', async () => {
    const { analyze } = fixture(vi.fn<typeof fetch>(async () => response({
      usage: { prompt_tokens: -1, completion_tokens: '3', total_tokens: 1.5, secret: config.apiKey },
    })));
    await expect(analyze({ config, prompt: 'Visible facts', images }))
      .resolves.toEqual({ text: content, usage: null });
  });

  it('redacts thrown Provider network errors and makes no second POST', async () => {
    const { fetchImpl, analyze } = fixture(vi.fn<typeof fetch>(async () => { throw new Error(config.apiKey); }));
    const error = await analyze({ config, prompt: 'Visible facts', images }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'PRODUCT_VISION_REQUEST_FAILED', outcome: 'UNKNOWN_OUTCOME' });
    expect(String(error)).not.toContain(config.apiKey);
    expect(JSON.stringify(error)).not.toContain(config.apiKey);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('limits even an uncooperative fetch to 120 seconds and never retries', async () => {
    vi.useFakeTimers();
    const { fetchImpl, analyze } = fixture(vi.fn<typeof fetch>(async () => new Promise<Response>(() => undefined)));
    const promise = analyze({ config: { ...config, timeoutMs: 999_999 }, prompt: 'Visible facts', images });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'PRODUCT_VISION_TIMEOUT', outcome: 'UNKNOWN_OUTCOME' });
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('bounds stalled response reads, including after successful HTTP headers', async () => {
    vi.useFakeTimers();
    const { fetchImpl, analyze } = fixture(vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
    }), { headers: { 'content-type': 'application/json' } })));
    const assertion = expect(analyze({ config: { ...config, timeoutMs: 1000 }, prompt: 'Visible facts', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_TIMEOUT', outcome: 'UNKNOWN_OUTCOME' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('bounds DNS lookup time without calling the Provider', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>();
    const analyze = createProductVisionTransport({ fetch: fetchImpl, lookup: async () => new Promise(() => undefined) });
    const assertion = expect(analyze({ config: { ...config, timeoutMs: 1000 }, prompt: 'Visible facts', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_TIMEOUT', outcome: 'NOT_SENT' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
