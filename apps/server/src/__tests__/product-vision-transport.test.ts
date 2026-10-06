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
  function sseResponse(events: string[], chunkBytes = 0) {
    const bytes = new TextEncoder().encode(events.map(event => `data: ${event}\r\n\r\n`).join(''));
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const size = chunkBytes || bytes.byteLength;
      for (let offset = 0; offset < bytes.byteLength; offset += size) controller.enqueue(bytes.subarray(offset, offset + size));
      controller.close();
    } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  }
  const delta = (text: string, finish: string | null = null) => JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] });
  it('opts into streamed complete JSON across UTF8/chunk boundaries and returns terminal usage', async () => {
    const fullText = '{"颜色":"红色","title":"Красный"}';
    const fetchImpl = vi.fn<typeof fetch>(async () => sseResponse([
      ': heartbeat', delta(fullText.slice(0, 9)), delta(fullText.slice(9), 'stop'),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 18, completion_tokens: 9, total_tokens: 27, secret: config.apiKey } }), '[DONE]',
    ].filter(event => event !== ': heartbeat'), 1));
    const analyze = createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true, maxOutputTokens: 4096, maxTimeoutMs: 180000 });
    await expect(analyze({ config, prompt: 'Return bound stage data', images })).resolves.toEqual({ text: fullText, usage: { promptTokens: 18, completionTokens: 9, totalTokens: 27 } });
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(request.stream).toBe(true); expect(request.stream_options).toEqual({ include_usage: true });
    expect(request.max_tokens).toBe(4096); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('opts into up to 24 owned stage images and text-only copy while keeping legacy image requirements', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => sseResponse([delta(content, 'stop'), '[DONE]']));
    const analyze = createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true, maxImages: 24, allowTextOnly: true });
    await expect(analyze({ config, prompt: 'Stage curation', images: Array.from({ length: 24 }, () => images[0]!) })).resolves.toMatchObject({ text: content });
    await expect(analyze({ config, prompt: 'Stage copy', images: [] })).resolves.toMatchObject({ text: content });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).messages[1].content).toHaveLength(1);
    await expect(analyze({ config, prompt: 'Stage curation', images: Array.from({ length: 25 }, () => images[0]!) })).rejects.toMatchObject({ code: 'PRODUCT_VISION_INPUT_INVALID', outcome: 'NOT_SENT' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    { options: { maxTimeoutMs: 180001 } }, { options: { maxTimeoutMs: 999 } }, { options: { maxTimeoutMs: Number.NaN } },
    { options: { maxImages: 25 } }, { options: { maxImages: 0 } }, { options: { stream: 'true' } }, { options: { allowTextOnly: 'true' } },
  ])('rejects invalid opted-in transport limits', ({ options }) => {
    expect(() => createProductVisionTransport(options as Parameters<typeof createProductVisionTransport>[0])).toThrow(ProductVisionTransportError);
  });
  it.each([
    { events: [delta(content)], reasonCode: 'STREAM_INCOMPLETE' },
    { events: [delta(content, 'stop')], reasonCode: 'STREAM_INCOMPLETE' },
    { events: [delta(content), '[DONE]'], reasonCode: 'STREAM_INCOMPLETE' },
    { events: [delta(content, 'length'), '[DONE]'], reasonCode: 'STREAM_FINISH_INVALID' },
    { events: [delta(content, 'tool_calls'), '[DONE]'], reasonCode: 'STREAM_FINISH_INVALID' },
    { events: [JSON.stringify({ error: { message: config.apiKey, code: 'provider-failed' } }), '[DONE]'], reasonCode: 'STREAM_PROVIDER_ERROR' },
    { events: [JSON.stringify({ choices: [{ index: 1, delta: { content }, finish_reason: 'stop' }] }), '[DONE]'], reasonCode: 'STREAM_EVENT_INVALID' },
    { events: ['{invalid json', '[DONE]'], reasonCode: 'STREAM_EVENT_INVALID' },
    { events: [delta(config.apiKey.slice(0, 10)), delta(config.apiKey.slice(10), 'stop'), '[DONE]'], reasonCode: 'SECRET_ECHO' },
    { events: [delta(' ', 'stop'), '[DONE]'], reasonCode: 'STREAM_INCOMPLETE' },
  ])('rejects unsafe/incomplete SSE and emits only safe reasonCode %s', async ({ events, reasonCode }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => sseResponse(events));
    const analyze = createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true });
    const error = await analyze({ config, prompt: 'Stage data', images }).catch(value => value);
    expect(error).toMatchObject({ code: 'PRODUCT_VISION_RESPONSE_INVALID', outcome: 'UNKNOWN_OUTCOME', reasonCode });
    expect(String(error)).not.toContain(config.apiKey); expect(JSON.stringify(error)).not.toContain(config.apiKey);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('accepts SSE comment/CRLF/multiline data framing and ignores reasoning instead of returning it', async () => {
    const event = JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: config.apiKey }, finish_reason: null }] });
    const source = `: heartbeat\r\nid: stage-1\r\ndata: ${event}\r\n\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":${JSON.stringify(content)}},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(source, { headers: { 'content-type': 'text/event-stream' } }));
    await expect(createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true })({ config, prompt: 'Stage data', images })).resolves.toEqual({ text: content, usage: null });
  });
  it.each([
    { bytes: 'x'.repeat(2 * 1024 * 1024 + 1), headers: {} },
    { bytes: 'data: [DONE]\n\n', headers: { 'content-length': String(2 * 1024 * 1024 + 1) } },
    { bytes: `data: ${delta('x'.repeat(64 * 1024 + 1), 'stop')}\n\ndata: [DONE]\n\n`, headers: {} },
  ])('bounds declared SSE, actual response and individual event bytes', async ({ bytes, headers }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(bytes, { headers: new Headers({ 'content-type': 'text/event-stream', ...headers } as Record<string, string>) }));
    await expect(createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true })({ config, prompt: 'Stage data', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_RESPONSE_TOO_LARGE', outcome: 'UNKNOWN_OUTCOME' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('bounds combined output independently of the SSE response byte budget', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => sseResponse([delta('x'.repeat(40000)), delta('x'.repeat(40000), 'stop'), '[DONE]']));
    await expect(createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true })({ config, prompt: 'Stage data', images }))
      .rejects.toMatchObject({ code: 'PRODUCT_VISION_RESPONSE_TOO_LARGE', outcome: 'UNKNOWN_OUTCOME', reasonCode: 'OUTPUT_LIMIT' });
  });
  it('uses a dedicated 180s stream timeout without changing the legacy cap or default', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Promise<Response>(() => undefined));
    const analyze = createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true, maxTimeoutMs: 180000 });
    const promise = analyze({ config: { ...config, timeoutMs: 180000 }, prompt: 'Stage data', images });
    let settled = false;
    const assertion = expect(promise.finally(() => { settled = true; })).rejects.toMatchObject({ code: 'PRODUCT_VISION_TIMEOUT', outcome: 'UNKNOWN_OUTCOME' });
    await vi.advanceTimersByTimeAsync(120000); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(60000); await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it('aborts and cancels a stalled SSE stream without submitting another request', async () => {
    vi.useFakeTimers(); let canceled = false;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${delta(content)}\n\n`)); }, cancel() { canceled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const assertion = expect(createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true })({ config: { ...config, timeoutMs: 1000 }, prompt: 'Stage data', images })).rejects.toMatchObject({ code: 'PRODUCT_VISION_TIMEOUT', outcome: 'UNKNOWN_OUTCOME' });
    await vi.advanceTimersByTimeAsync(1000); await assertion; expect(canceled).toBe(true); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('treats DONE as the terminal even when the Provider does not close the response connection', async () => {
    let canceled = false;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${delta(content, 'stop')}\n\ndata: [DONE]\n\n`)); },
      cancel() { canceled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    await expect(createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true })({ config, prompt: 'Stage data', images })).resolves.toEqual({ text: content, usage: null });
    expect(canceled).toBe(true); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('rejects invalid UTF8, content after stop and multiple choices without leaking Provider data', async () => {
    for (const bytes of [new Uint8Array([100, 97, 116, 97, 58, 32, 0xff, 10, 10]),
      new TextEncoder().encode(`data: ${delta(content, 'stop')}\n\ndata: ${delta(config.apiKey)}\n\ndata: [DONE]\n\n`),
      new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }, { index: 1, delta: { content: config.apiKey }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(bytes, { headers: { 'content-type': 'text/event-stream' } }));
      const error = await createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true })({ config, prompt: 'Stage data', images }).catch(value => value);
      expect(error).toMatchObject({ code: 'PRODUCT_VISION_RESPONSE_INVALID', outcome: 'UNKNOWN_OUTCOME', reasonCode: 'STREAM_EVENT_INVALID' });
      expect(JSON.stringify(error)).not.toContain(config.apiKey); expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it('retains the 30 second default when streaming is enabled without a timeout override', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Promise<Response>(() => undefined));
    const promise = createProductVisionTransport({ fetch: fetchImpl, lookup, stream: true, maxTimeoutMs: 180000 })({ config, prompt: 'Stage data', images });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'PRODUCT_VISION_TIMEOUT', outcome: 'UNKNOWN_OUTCOME' });
    await vi.advanceTimersByTimeAsync(30000); await assertion; expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('allows bounded richer product reports while retaining the original vision output limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const analyze = createProductVisionTransport({ fetch: fetchImpl, lookup, maxOutputTokens: 4096 });
    await analyze({ config, prompt: 'Generate product preparation candidates.', images });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).max_tokens).toBe(4096);
    expect(() => createProductVisionTransport({ maxOutputTokens: 4097 })).toThrow();
  });
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
