import { describe, expect, it, vi } from 'vitest';
import { createDashScopeImageTranslationProvider } from '../services/ai-image-providers.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

function response(body: unknown, headers: Record<string, string> = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('DashScope qwen-mt-image adapter', () => {
  it('submits the characterized request, polls, and downloads the temporary result immediately', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ output: { task_id: 'task-1', task_status: 'PENDING' }, request_id: 'req-1' }))
      .mockResolvedValueOnce(response({ output: { task_status: 'RUNNING' } }))
      .mockResolvedValueOnce(response({ output: { task_status: 'SUCCEEDED', image_url: 'https://result.example/translated.png' } }))
      .mockResolvedValueOnce(new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const accepted = vi.fn(async () => undefined);
    const provider = createDashScopeImageTranslationProvider({
      baseUrl: 'https://dashscope.example/api/v1', apiKey: 'secret', model: 'qwen-mt-image', fetch: fetcher,
      timeoutMs: 5_000, costPerImageCents: 7,
    });
    const request = {
      model: 'qwen-mt-image', imageUrl: 'https://owned.example/source.png',
      sourceLanguage: 'zh', targetLanguage: 'ru',
      domainHint: 'Translate only visible marketing copy',
      terminologies: [{ src: 'piano black', tgt: 'glossy black' }],
      imageSegment: false as const,
    };
    const submitted = await provider.submit(request, accepted);
    const pending = await provider.poll(submitted.providerJobId);
    const completed = await provider.poll(submitted.providerJobId);

    expect(submitted).toMatchObject({ providerJobId: 'task-1' });
    expect(accepted).toHaveBeenCalledWith('task-1', expect.any(Date));
    expect(pending).toEqual({ status: 'PENDING', providerStatus: 'RUNNING' });
    expect(completed).toMatchObject({
      status: 'SUCCEEDED', actualCostCents: 7,
      image: { mimeType: 'image/png', buffer: png },
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    const submitInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(submitInit.headers).toMatchObject({
      Authorization: 'Bearer secret',
      'X-DashScope-Async': 'enable',
    });
    expect(JSON.parse(String(submitInit.body))).toEqual({
      model: 'qwen-mt-image',
      input: {
        image_url: 'https://owned.example/source.png',
        source_lang: 'zh', target_lang: 'ru',
        ext: {
          domainHint: 'Translate only visible marketing copy',
          terminologies: [{ src: 'piano black', tgt: 'glossy black' }],
          config: { imageSegment: false },
        },
      },
    });
  });

  it('rejects private or non-HTTPS source URLs before making a provider request', async () => {
    const fetcher = vi.fn();
    const provider = createDashScopeImageTranslationProvider({
      baseUrl: 'https://dashscope.example/api/v1', apiKey: 'secret', model: 'qwen-mt-image', fetch: fetcher,
    });
    await expect(provider.submit({
      model: 'qwen-mt-image', imageUrl: 'http://127.0.0.1/source.png',
      sourceLanguage: 'zh', targetLanguage: 'ru', domainHint: 'safe', terminologies: [], imageSegment: false,
    }, async () => undefined)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for a successful task without a usable image URL', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ output: { task_id: 'task-2' } }))
      .mockResolvedValueOnce(response({ output: { task_status: 'SUCCEEDED' } }));
    const provider = createDashScopeImageTranslationProvider({
      baseUrl: 'https://dashscope.example/api/v1', apiKey: 'secret', model: 'qwen-mt-image', fetch: fetcher,
    });
    const submitted = await provider.submit({
      model: 'qwen-mt-image', imageUrl: 'https://owned.example/source.png',
      sourceLanguage: 'zh', targetLanguage: 'ru', domainHint: 'safe', terminologies: [], imageSegment: false,
    }, async () => undefined);
    await expect(provider.poll(submitted.providerJobId)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT', providerJobId: 'task-2',
    });
  });
});
