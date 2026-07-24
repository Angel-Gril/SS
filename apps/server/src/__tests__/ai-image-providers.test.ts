import { describe, expect, it, vi } from 'vitest';
import {
  createDashScopeWanxProvider,
  createOpenAiImageEditProvider,
  createOpenAiImagesProvider,
  isOpenAiCompatibleImageEditSizeSupported,
  testAiImageProviderConnection,
  validateAiImageProviderUrl,
} from '../services/ai-image-providers.js';

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const jpeg = Buffer.from('ffd8ff', 'hex');
const webp = Buffer.from('524946460400000057454250', 'hex');

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

describe('AI image provider adapters', () => {
  it.each([
    [1024, 1024, true],
    [1024, 1536, true],
    [1536, 1024, true],
    [900, 1200, false],
    [1024, 1365, false],
  ])('classifies OpenAI-compatible edit canvas %dx%d as %s before quota reservation', (width, height, supported) => {
    expect(isOpenAiCompatibleImageEditSizeSupported(width, height)).toBe(supported);
  });

  it('submits a FULL_EDIT as one OpenAI multipart image edit and decodes its b64 result', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      id: 'edit-response-1',
      data: [{ b64_json: png.toString('base64') }],
    }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'openai-secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, costPerImageCents: 11, onProviderJobCreated,
    });

    const result = await provider.edit({
      operation: 'FULL_EDIT',
      prompt: 'Place the product in a bright studio',
      negativePrompt: 'text, watermark',
      width: 1024,
      height: 1024,
      images: [{ buffer: png, mimeType: 'image/png' }],
    });

    expect(result).toEqual({
      images: [{ buffer: png, mimeType: 'image/png', filename: 'openai-edit-1.png' }],
      providerJobId: 'edit-response-1',
      actualCostCents: 11,
    });
    expect(onProviderJobCreated).toHaveBeenCalledWith('edit-response-1', expect.any(Date));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.example/v1/images/edits',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer openai-secret' },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    const body = fetch.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('Place the product in a bright studio\n\nAvoid: text, watermark');
    expect(form.get('n')).toBe('1');
    expect(form.get('size')).toBe('1024x1024');
    expect(form.getAll('image')).toHaveLength(1);
    expect(form.get('image')).toMatchObject({ name: 'image-1.png', type: 'image/png', size: png.length });
    expect(form.has('image[]')).toBe(false);
    expect(form.has('mask')).toBe(false);
  });

  it('runs the optional dispatch fence immediately before the OpenAI edit fetch', async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push('fetch');
      expect(init?.body).toBeInstanceOf(FormData);
      return json({
        id: 'edit-dispatch-fence-1',
        data: [{ b64_json: png.toString('base64') }],
      });
    });
    const beforeProviderDispatch = vi.fn(async () => {
      expect(fetch).not.toHaveBeenCalled();
      calls.push('dispatch-fence');
    });
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      beforeProviderDispatch,
    });

    await expect(provider.edit({
      operation: 'IMAGE_TO_IMAGE', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1536, images: [{ buffer: png, mimeType: 'image/png' }],
    })).resolves.toMatchObject({ providerJobId: 'edit-dispatch-fence-1' });

    expect(beforeProviderDispatch).toHaveBeenCalledOnce();
    expect(calls).toEqual(['dispatch-fence', 'fetch']);
  });

  it('does not fetch when the OpenAI edit dispatch fence fails', async () => {
    const fenceError = new Error('dispatch fence failed');
    const fetch = vi.fn();
    const beforeProviderDispatch = vi.fn(async () => {
      throw fenceError;
    });
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      beforeProviderDispatch,
    });

    await expect(provider.edit({
      operation: 'IMAGE_TO_IMAGE', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1536, images: [{ buffer: png, mimeType: 'image/png' }],
    })).rejects.toBe(fenceError);

    expect(beforeProviderDispatch).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('submits IMAGE_TO_IMAGE references as one OpenAI multipart edit without a mask', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      id: 'image-to-image-response-1',
      data: [{ b64_json: png.toString('base64') }],
    }));
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'openai-secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000,
    });

    await expect(provider.edit({
      operation: 'IMAGE_TO_IMAGE',
      prompt: 'Keep the product shape and create a clean marketplace hero image',
      negativePrompt: null,
      width: 1024,
      height: 1536,
      images: [
        { buffer: png, mimeType: 'image/png' },
        { buffer: webp, mimeType: 'image/webp' },
      ],
    })).resolves.toMatchObject({ providerJobId: 'image-to-image-response-1' });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.example/v1/images/edits',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer openai-secret' } }),
    );
    const form = fetch.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('Keep the product shape and create a clean marketplace hero image');
    expect(form.get('size')).toBe('1024x1536');
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(form.getAll('image[]')[0]).toMatchObject({ name: 'image-1.png', type: 'image/png' });
    expect(form.getAll('image[]')[1]).toMatchObject({ name: 'image-2.webp', type: 'image/webp' });
    expect(form.has('mask')).toBe(false);
  });

  it('submits an INPAINT mask as a PNG multipart field applied to the first image', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      data: [{ b64_json: png.toString('base64') }],
    }, 200, { 'x-request-id': 'edit-mask-request-1' }));
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000,
    });

    await expect(provider.edit({
      operation: 'INPAINT',
      prompt: 'Replace only the transparent mask area',
      negativePrompt: null,
      width: 1536,
      height: 1024,
      images: [
        { buffer: png, mimeType: 'image/png' },
        { buffer: webp, mimeType: 'image/webp' },
      ],
      mask: { buffer: png, mimeType: 'image/png' },
    })).resolves.toMatchObject({ providerJobId: 'edit-mask-request-1' });

    const form = fetch.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('size')).toBe('1536x1024');
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(form.getAll('image[]')[0]).toMatchObject({ name: 'image-1.png', type: 'image/png' });
    expect(form.getAll('image[]')[1]).toMatchObject({ name: 'image-2.webp', type: 'image/webp' });
    expect(form.get('mask')).toMatchObject({ name: 'mask.png', type: 'image/png', size: png.length });
  });

  it.each([
    ['no source image', () => ({ images: [] })],
    ['more than 16 source images', () => ({
      images: Array.from({ length: 17 }, () => ({ buffer: png, mimeType: 'image/png' })),
    })],
    ['empty source bytes', () => ({ images: [{ buffer: Buffer.alloc(0), mimeType: 'image/png' }] })],
    ['unsupported source MIME', () => ({ images: [{ buffer: png, mimeType: 'image/gif' }] })],
    ['source bytes that do not match the declared MIME', () => ({
      images: [{ buffer: png, mimeType: 'image/jpeg' }],
    })],
    ['more than 50 MB of multipart image bytes', () => {
      const oversized = Buffer.alloc((50 * 1024 * 1024) + 1);
      png.copy(oversized);
      return { images: [{ buffer: oversized, mimeType: 'image/png' }] };
    }],
    ['INPAINT without a mask', () => ({ operation: 'INPAINT', mask: null })],
    ['INPAINT with a non-PNG mask', () => ({
      operation: 'INPAINT', mask: { buffer: jpeg, mimeType: 'image/jpeg' },
    })],
    ['FULL_EDIT with an unexpected mask', () => ({ mask: { buffer: png, mimeType: 'image/png' } })],
    ['IMAGE_TO_IMAGE with an unexpected mask', () => ({
      operation: 'IMAGE_TO_IMAGE', mask: { buffer: png, mimeType: 'image/png' },
    })],
    ['an unsupported output size', () => ({ width: 512, height: 512 })],
  ])('rejects %s before dispatching an OpenAI image edit', async (_label, invalidPart) => {
    const fetch = vi.fn();
    const beforeProviderDispatch = vi.fn(async () => undefined);
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      beforeProviderDispatch,
    });

    await expect(provider.edit({
      operation: 'FULL_EDIT',
      prompt: 'edit the product',
      negativePrompt: null,
      width: 1024,
      height: 1024,
      images: [{ buffer: png, mimeType: 'image/png' }],
      ...invalidPart(),
    } as never)).rejects.toMatchObject({
      code: 'INVALID_MEDIA_INPUT',
      providerSubmissionRejected: true,
    });
    expect(beforeProviderDispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads a safe OpenAI image edit URL after recording provider acceptance', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({
        id: 'edit-url-response-1',
        data: [{ url: 'https://temp.example/edit-result.webp' }],
      }))
      .mockResolvedValueOnce(new Response(webp, { headers: { 'content-type': 'image/webp' } }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const beforeProviderDispatch = vi.fn(async () => undefined);
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, costPerImageCents: 13, onProviderJobCreated, beforeProviderDispatch,
    });

    await expect(provider.edit({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1024, images: [{ buffer: png, mimeType: 'image/png' }],
    })).resolves.toEqual({
      images: [{ buffer: webp, mimeType: 'image/webp', filename: 'openai-edit-1.webp' }],
      providerJobId: 'edit-url-response-1',
      actualCostCents: 13,
    });
    expect(onProviderJobCreated).toHaveBeenCalledWith('edit-url-response-1', expect.any(Date));
    expect(beforeProviderDispatch).toHaveBeenCalledOnce();
    expect(onProviderJobCreated.mock.invocationCallOrder[0])
      .toBeLessThan(fetch.mock.invocationCallOrder[1]!);
    expect(fetch).toHaveBeenNthCalledWith(2,
      'https://temp.example/edit-result.webp',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('validates the OpenAI edit target before running the dispatch fence', async () => {
    const fetch = vi.fn();
    const beforeProviderDispatch = vi.fn(async () => undefined);
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://127.0.0.1/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      beforeProviderDispatch,
    });

    await expect(provider.edit({
      operation: 'IMAGE_TO_IMAGE', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1536, images: [{ buffer: png, mimeType: 'image/png' }],
    })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_URL',
      providerSubmissionRejected: true,
    });

    expect(beforeProviderDispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks an OpenAI image edit client rejection as definitely not accepted without leaking the API key', async () => {
    const apiKey = 'sk-edit-sensitive';
    const fetch = vi.fn().mockResolvedValueOnce(json({
      error: { code: 'invalid_image', message: `unsafe echo ${apiKey}` },
    }, 400));
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey, model: 'gpt-image-1', fetch,
    });

    const error = await provider.edit({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1024, images: [{ buffer: png, mimeType: 'image/png' }],
    }).catch((caught) => caught) as Error & {
      code?: string;
      providerSubmissionRejected?: boolean;
      providerSubmissionUncertain?: boolean;
    };

    expect(error).toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      providerSubmissionRejected: true,
    });
    expect(error.providerSubmissionUncertain).not.toBe(true);
    expect(error.message).not.toContain(apiKey);
  });

  it('quarantines an OpenAI image edit server failure as submission-uncertain', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { code: 'internal_error' } }, 500));
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
    });

    await expect(provider.edit({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1024, images: [{ buffer: png, mimeType: 'image/png' }],
    })).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      providerSubmissionUncertain: true,
    });
  });

  it('blocks a private OpenAI edit result URL while preserving accepted request evidence', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      id: 'edit-private-url-response',
      data: [{ url: 'https://127.0.0.1/private-result.png' }],
    }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      onProviderJobCreated,
    });

    await expect(provider.edit({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1024, images: [{ buffer: png, mimeType: 'image/png' }],
    })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_URL',
      providerJobId: 'edit-private-url-response',
      providerAcceptedAt: expect.any(Date),
    });
    expect(onProviderJobCreated).toHaveBeenCalledWith('edit-private-url-response', expect.any(Date));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('caps a downloaded OpenAI edit result before reading an oversized body', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({
        id: 'edit-oversized-response',
        data: [{ url: 'https://temp.example/oversized.png' }],
      }))
      .mockResolvedValueOnce(new Response(null, {
        headers: {
          'content-type': 'image/png',
          'content-length': String((20 * 1024 * 1024) + 1),
        },
      }));
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
    });

    await expect(provider.edit({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1024, images: [{ buffer: png, mimeType: 'image/png' }],
    })).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
      providerJobId: 'edit-oversized-response',
      providerAcceptedAt: expect.any(Date),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts a timed-out OpenAI image edit and marks its submission uncertain', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn().mockImplementationOnce(async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal || undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    const provider = createOpenAiImageEditProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 25,
    });

    await expect(provider.edit({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      width: 1024, height: 1024, images: [{ buffer: png, mimeType: 'image/png' }],
    })).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      providerSubmissionUncertain: true,
    });
    expect(requestSignal?.aborted).toBe(true);
  });

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
    expect(onProviderJobCreated).toHaveBeenCalledWith('task-1', expect.any(Date));
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
    expect(fetch).toHaveBeenNthCalledWith(3,
      'https://dashscope.example/api/v1/tasks/task-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(4,
      'https://temp.example/1.png',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('preserves provider acceptance evidence when the DashScope callback cannot persist it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      output: { task_id: 'task-accepted', task_status: 'PENDING' },
    }));
    const onProviderJobCreated = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const provider = createDashScopeWanxProvider({
      baseUrl: 'https://dashscope.example', apiKey: 'secret', model: 'wanx-v1', fetch,
      pollIntervalMs: 0, timeoutMs: 1000, onProviderJobCreated,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'wanx-v1',
    })).rejects.toMatchObject({
      code: 'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
      providerJobId: 'task-accepted',
      providerAcceptedAt: expect.any(Date),
    });
    expect(onProviderJobCreated).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps the DashScope temporary URL download inside the asynchronous task deadline', async () => {
    let downloadSignal: AbortSignal | undefined;
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: 'task-window', task_status: 'PENDING' } }))
      .mockResolvedValueOnce(json({
        output: {
          task_id: 'task-window',
          task_status: 'SUCCEEDED',
          results: [{ url: 'https://temp.example/window.png' }],
        },
      }))
      .mockImplementationOnce(async (_input: string | URL | Request, init?: RequestInit) => {
        downloadSignal = init?.signal || undefined;
        return new Promise<Response>((_resolve, reject) => {
          downloadSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      });
    const provider = createDashScopeWanxProvider({
      baseUrl: 'https://dashscope.example', apiKey: 'secret', model: 'wanx-v1', fetch,
      pollIntervalMs: 0, timeoutMs: 250,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'wanx-v1',
    })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });

    expect(fetch).toHaveBeenNthCalledWith(3,
      'https://temp.example/window.png',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) }),
    );
    expect(downloadSignal?.aborted).toBe(true);
  });

  it('decodes OpenAI b64_json results without a follow-up network request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      id: 'response-b64',
      data: [{ b64_json: png.toString('base64') }],
    }));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'openai-secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, costPerImageCents: 9,
    });

    const result = await provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    });

    expect(result).toEqual({
      images: [{ buffer: png, mimeType: 'image/png', filename: 'openai-1.png' }],
      providerJobId: 'response-b64',
      actualCostCents: 9,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.example/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('downloads OpenAI temporary URL results after /images/generations', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({
        id: 'response-url',
        data: [{ url: 'https://temp.example/2.webp' }],
      }))
      .mockResolvedValueOnce(new Response(webp, { headers: { 'content-type': 'image/webp' } }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'openai-secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, costPerImageCents: 9, onProviderJobCreated,
    });

    const result = await provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    });

    expect(result).toEqual({
      images: [{ buffer: webp, mimeType: 'image/webp', filename: 'openai-1.webp' }],
      providerJobId: 'response-url',
      actualCostCents: 9,
    });
    expect(fetch).toHaveBeenNthCalledWith(1,
      'https://api.openai.example/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(2,
      'https://temp.example/2.webp',
      expect.objectContaining({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) }),
    );
    expect(onProviderJobCreated).toHaveBeenCalledWith('response-url', expect.any(Date));
    expect(onProviderJobCreated.mock.invocationCallOrder[0])
      .toBeLessThan(fetch.mock.invocationCallOrder[1]!);
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(request).toEqual({ model: 'gpt-image-1', prompt: 'photo', n: 1, size: '1024x1024' });
  });

  it('rejects an unexpected OpenAI result count before downloading any URL', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      id: 'response-too-many',
      data: [
        { url: 'https://temp.example/1.png' },
        { url: 'https://temp.example/2.png' },
      ],
    }));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret',
      model: 'gpt-image-1', fetch, timeoutMs: 1000,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT',
      providerJobId: 'response-too-many',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('uses an OpenAI response request id when the body has no provider identity', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      data: [{ b64_json: png.toString('base64') }],
    }, 200, { 'x-request-id': 'request-from-header' }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, onProviderJobCreated,
    });

    const result = await provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    });

    expect(result.providerJobId).toBe('request-from-header');
    expect(onProviderJobCreated).toHaveBeenCalledWith('request-from-header', expect.any(Date));
  });

  it('marks a definite provider client rejection as safe to release', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { code: 'invalid_request' } }, 400));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      providerSubmissionRejected: true,
    });
  });

  it('keeps an oversized DashScope client error classified as a definite rejection', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('rejected', {
      status: 400,
      headers: {
        'content-type': 'application/json',
        'content-length': String(33 * 1024 * 1024),
      },
    }));
    const provider = createDashScopeWanxProvider({
      baseUrl: 'https://dashscope.example', apiKey: 'secret', model: 'wanx-v1', fetch,
      timeoutMs: 1000,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'wanx-v1',
    })).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      providerSubmissionRejected: true,
    });
  });

  it('rejects a non-string OpenAI provider identity instead of inventing one', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      id: { unexpected: 'object' },
      data: [{ b64_json: png.toString('base64') }],
    }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, onProviderJobCreated,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT',
      providerSubmissionUncertain: true,
    });
    expect(onProviderJobCreated).not.toHaveBeenCalled();
  });

  it('keeps a definite client rejection even when its request id header is invalid', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(
      { error: { code: 'invalid_request' } },
      400,
      { 'x-request-id': 'x'.repeat(501) },
    ));
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      providerSubmissionRejected: true,
    });
  });

  it('prefers a valid response body identity over an invalid fallback header identity', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      id: 'valid-body-id',
      data: [{ b64_json: png.toString('base64') }],
    }, 200, { 'x-request-id': 'x'.repeat(501) }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, onProviderJobCreated,
    });

    const result = await provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    });

    expect(result.providerJobId).toBe('valid-body-id');
    expect(onProviderJobCreated).toHaveBeenCalledWith('valid-body-id', expect.any(Date));
  });

  it.each([
    ['server failure', () => json({ error: { code: 'internal_error' } }, 500), 'PROVIDER_REQUEST_FAILED'],
    ['network timeout', () => Promise.reject(new DOMException('aborted', 'AbortError')), 'PROVIDER_TIMEOUT'],
  ])('quarantines an ambiguous OpenAI %s after dispatch', async (_label, response, code) => {
    const fetch = vi.fn().mockImplementationOnce(response);
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({
      code,
      providerSubmissionUncertain: true,
    });
  });

  it('returns a successful OpenAI result without inventing a provider identity', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({
      data: [{ b64_json: png.toString('base64') }],
    }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, onProviderJobCreated,
    });

    const result = await provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model: 'gpt-image-1',
    });

    expect(result.providerJobId).toBeNull();
    expect(result.images).toHaveLength(1);
    expect(onProviderJobCreated).not.toHaveBeenCalled();
  });

  it.each([
    ['DashScope Wanx', 'wanx-v1', (fetch: typeof globalThis.fetch) => createDashScopeWanxProvider({
      baseUrl: 'https://dashscope.example', apiKey: 'secret', model: 'wanx-v1', fetch,
    })],
    ['OpenAI Images', 'gpt-image-1', (fetch: typeof globalThis.fetch) => createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
    })],
  ])('rejects IMAGE_TO_IMAGE source assets before %s submits a request', async (_label, model, factory) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = factory(fetch);
    await expect(provider.generate({
      operation: 'IMAGE_TO_IMAGE',
      prompt: 'preserve the product', negativePrompt: null, count: 1,
      width: 1024, height: 1024, model,
      inputAssets: [{
        assetId: 'source-asset-1', role: 'REFERENCE',
        url: 'https://source.example/private-product.png', mimeType: 'image/png',
      }],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(fetch).not.toHaveBeenCalled();
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
    })).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      providerJobId: 'task-timeout',
      providerAcceptedAt: expect.any(Date),
    });
  });

  it('preserves an OpenAI response identity when temporary image download fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ id: 'response-download-failed', data: [{ url: 'https://temp.example/fail.png' }] }))
      .mockRejectedValueOnce(new Error('temporary URL unavailable'));
    const onProviderJobCreated = vi.fn(async () => undefined);
    const provider = createOpenAiImagesProvider({
      baseUrl: 'https://api.openai.example/v1', apiKey: 'secret', model: 'gpt-image-1', fetch,
      timeoutMs: 1000, onProviderJobCreated,
    });

    await expect(provider.generate({
      prompt: 'photo', negativePrompt: null, count: 1, width: 1024, height: 1024, model: 'gpt-image-1',
    })).rejects.toMatchObject({
      providerJobId: 'response-download-failed',
      providerAcceptedAt: expect.any(Date),
    });
    expect(onProviderJobCreated).toHaveBeenCalledWith('response-download-failed', expect.any(Date));
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

    expect(result).toEqual(expect.objectContaining({
      ok: true, provider: 'openai-images', model: 'gpt-image-1', verification: 'remote',
    }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.openai.example/v1/models/gpt-image-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('normalizes a custom OpenAI-compatible root URL through /v1 without creating an image', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ id: 'custom-image-model' }));

    const result = await testAiImageProviderConnection({
      provider: 'custom', baseUrl: 'https://relay.example',
      apiKey: 'secret', model: 'custom-image-model', fetch, timeoutMs: 1000,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true, provider: 'custom', model: 'custom-image-model',
    }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://relay.example/v1/models/custom-image-model',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects a custom provider without an explicit base URL before sending credentials', async () => {
    const fetch = vi.fn();
    await expect(testAiImageProviderConnection({
      provider: 'custom', baseUrl: '', apiKey: 'secret', model: 'custom-image-model', fetch,
    })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_CONFIG' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'https://relay.example/v1/images/generations',
    'https://relay.example/v1?tenant=one',
    'https://relay.example/v1#images',
  ])('rejects a non-base OpenAI-compatible URL before dispatch: %s', async (baseUrl) => {
    const fetch = vi.fn();
    expect(() => createOpenAiImagesProvider({
      baseUrl, apiKey: 'secret', model: 'custom-image-model', fetch,
    })).toThrow(expect.objectContaining({ code: 'INVALID_PROVIDER_URL' }));
    expect(fetch).not.toHaveBeenCalled();
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
    await expect(validateAiImageProviderUrl(
      'https://provider.example/v1',
      async () => [{ address: '198.18.0.9' }],
    )).rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
    await expect(validateAiImageProviderUrl(
      'https://provider.example/v1',
      async () => [{ address: '::ffff:7f00:1' }],
    )).rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
    await expect(validateAiImageProviderUrl(
      'https://provider.example/v1',
      async () => [{ address: '2001:db8::1' }],
    )).rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
    await expect(validateAiImageProviderUrl(
      'https://provider.example/v1',
      async () => [{ address: '2606:4700:4700::1111' }],
    )).resolves.toBe('https://provider.example/v1');
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
    expect(result.verification).toBe('config-only');
    expect(fetch).not.toHaveBeenCalled();
  });

});
