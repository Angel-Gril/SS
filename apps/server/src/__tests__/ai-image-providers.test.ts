import { describe, expect, it, vi } from 'vitest';
import {
  createDashScopeWanxProvider,
  createOpenAiImagesProvider,
  testAiImageProviderConnection,
  validateAiImageProviderUrl,
} from '../services/ai-image-providers.js';

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const webp = Buffer.from('524946460400000057454250', 'hex');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AI image provider adapters', () => {
  it('submits, polls and downloads DashScope Wanx results', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: 'task-1', task_status: 'PENDING' }, request_id: 'req-1' }))
      .mockResolvedValueOnce(json({ output: { task_id: 'task-1', task_status: 'RUNNING' } }))
      .mockResolvedValueOnce(json({ output: { task_id: 'task-1', task_status: 'SUCCEEDED', results: [{ url: 'https://temp.example/1.png' }] } }))
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createDashScopeWanxProvider({
      baseUrl: 'https://dashscope.example',
      apiKey: 'dash-secret',
      model: 'wanx-v1',
      fetch,
      pollIntervalMs: 0,
      timeoutMs: 1000,
      costPerImageCents: 6,
      onProviderJobCreated,
    });

    const result = await provider.generate({
      prompt: 'studio product photo', negativePrompt: 'text', count: 1,
      width: 1024, height: 1024, model: 'wanx-v1',
    });

    expect(result).toMatchObject({ providerJobId: 'task-1', actualCostCents: 6 });
    expect(onProviderJobCreated).toHaveBeenCalledWith('task-1');
    expect(result.images).toEqual([{ buffer: png, mimeType: 'image/png', filename: 'dashscope-task-1-1.png' }]);
    expect(fetch).toHaveBeenNthCalledWith(1,
      'https://dashscope.example/api/v1/services/aigc/text2image/image-synthesis',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer dash-secret', 'X-DashScope-Async': 'enable' }),
      }),
    );
    const submitBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(submitBody).toEqual({
      model: 'wanx-v1',
      input: { prompt: 'studio product photo', negative_prompt: 'text' },
      parameters: { n: 1, size: '1024*1024' },
    });
    expect(fetch).toHaveBeenNthCalledWith(2,
      'https://dashscope.example/api/v1/tasks/task-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('supports both base64 and temporary URL results from OpenAI Images', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({
        created: 1,
        data: [
          { b64_json: png.toString('base64') },
          { url: 'https://temp.example/2.webp' },
        ],
      }))
      .mockResolvedValueOnce(new Response(webp, { headers: { 'content-type': 'image/webp' } }));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'openai-secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, costPerImageCents: 9,
    });

    const result = await provider.generate({
      prompt: 'photo', negativePrompt: null, count: 2,
      width: 1024, height: 1024, model: 'gpt-image-1',
    });

    expect(result.actualCostCents).toBe(18);
    expect(result.images.map((image) => [image.mimeType, image.buffer.toString('hex')])).toEqual([
      ['image/png', png.toString('hex')],
      ['image/webp', webp.toString('hex')],
    ]);
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(request).toEqual({ model: 'gpt-image-1', prompt: 'photo', n: 2, size: '1024x1024' });
  });

  it('times out an unfinished asynchronous provider task', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: 'task-timeout' } }))
      .mockResolvedValue(json({ output: { task_id: 'task-timeout', task_status: 'RUNNING' } }));
    const provider = createDashScopeWanxProvider({
      baseUrl: 'https://dashscope.example', apiKey: 'secret', model: 'wanx-v1', fetch,
      pollIntervalMs: 0, timeoutMs: 1,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1, width: 1024, height: 1024, model: 'wanx-v1',
    })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });

  it('never includes an API key in provider errors', async () => {
    const apiKey = 'sk-sensitive-value';
    const fetch = vi.fn().mockResolvedValue(json({ code: 'InvalidApiKey', message: `bad ${apiKey}` }, 401));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey, model: 'gpt-image-1', fetch,
    });

    const error = (await provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1, width: 1024, height: 1024, model: 'gpt-image-1',
    }).catch((caught) => caught)) as Error & { code?: string };

    expect(error.code).toBe('PROVIDER_AUTH_FAILED');
    expect(error.message).not.toContain(apiKey);
    expect(error.message).toContain('401');
  });

  it('tests authentication and model access without creating an image', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: 'gpt-image-1' }));

    const result = await testAiImageProviderConnection({
      provider: 'openai-images', baseUrl: 'https://api.openai.example/v1',
      apiKey: 'secret', model: 'gpt-image-1', fetch, timeoutMs: 1000,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, provider: 'openai-images', model: 'gpt-image-1' }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.example/v1/models/gpt-image-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
  it('rejects insecure provider base URLs before sending credentials', async () => {
    const fetch = vi.fn();
    const provider = createOpenAiImagesProvider({
      baseUrl: 'http://127.0.0.1:8080/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
    });
    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1, width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects oversized downloaded images', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ url: 'https://temp.example/large.png' }] }))
      .mockResolvedValueOnce(new Response('x', {
        headers: { 'content-type': 'image/png', 'content-length': String(21 * 1024 * 1024) },
      }));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
    });
    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1, width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  });

  it('rejects provider domains that resolve to a private network', async () => {
    await expect(validateAiImageProviderUrl(
      'https://provider.example/v1',
      async () => [{ address: '169.254.169.254' }],
    )).rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
  });

  it('rejects downloaded content that only claims to be an image', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ url: 'https://temp.example/fake.png' }] }))
      .mockResolvedValueOnce(new Response('not-an-image', {
        headers: { 'content-type': 'image/png' },
      }));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
    });
    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1, width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
  });

  it('does not claim remote DashScope authentication without a free probe', async () => {
    const fetch = vi.fn();
    const result = await testAiImageProviderConnection({
      provider: 'dashscope-wanx', baseUrl: 'https://dashscope.example/api/v1',
      apiKey: 'secret', model: 'wanx-v1', fetch,
    });

    expect(result.detail).toContain('first image job');
    expect(fetch).not.toHaveBeenCalled();
  });

});
