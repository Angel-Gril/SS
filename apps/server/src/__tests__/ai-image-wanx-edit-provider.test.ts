import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  createDashScopeWanx21ImageEditProvider,
  convertOpenAiAlphaMaskToWanxMask,
} from '../services/ai-image-wanx-edit-provider.js';
import {
  AI_IMAGE_WANX21_EDIT_MODEL,
  aiImageWanx21EditFunction,
  normalizeAiImageWanx21EditApiBase,
  normalizeAiImageWanx21EditResultUrl,
} from '../services/ai-image-wanx-edit-profile.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sourceImage() {
  return sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 220, g: 30, b: 40, alpha: 1 },
    },
  }).png().toBuffer();
}

async function alphaMask() {
  const raw = Buffer.alloc(512 * 512 * 4, 255);
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x < 256; x += 1) raw[(y * 512 + x) * 4 + 3] = 0;
  }
  return sharp(raw, { raw: { width: 512, height: 512, channels: 4 } }).png().toBuffer();
}

function successfulFetch() {
  return vi.fn()
    .mockResolvedValueOnce(json({
      output: { task_id: 'task-wanx-1', task_status: 'PENDING' },
      request_id: 'request-submit-1',
    }))
    .mockResolvedValueOnce(json({
      output: { task_id: 'task-wanx-1', task_status: 'RUNNING' },
      request_id: 'request-poll-1',
    }))
    .mockResolvedValueOnce(json({
      output: {
        task_id: 'task-wanx-1',
        task_status: 'SUCCEEDED',
        results: [{ url: 'https://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png' }],
        task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 },
      },
      usage: { image_count: 1 },
      request_id: 'request-poll-2',
    }))
    .mockResolvedValueOnce(new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
}

describe('Wanx 2.1 edit profile', () => {
  it.each([
    ['https://dashscope.aliyuncs.com', 'https://dashscope.aliyuncs.com/api/v1'],
    ['https://dashscope.aliyuncs.com/api/v1/', 'https://dashscope.aliyuncs.com/api/v1'],
    [
      'https://workspace-123.cn-beijing.maas.aliyuncs.com/api/v1',
      'https://workspace-123.cn-beijing.maas.aliyuncs.com/api/v1',
    ],
  ])('normalizes a reviewed Beijing API base %s', (value, expected) => {
    expect(normalizeAiImageWanx21EditApiBase(value)).toBe(expected);
  });

  it.each([
    'http://dashscope.aliyuncs.com/api/v1',
    'https://dashscope.aliyuncs.com.evil.test/api/v1',
    'https://workspace-123.cn-hangzhou.maas.aliyuncs.com/api/v1',
    'https://dashscope.aliyuncs.com/api/v1/other',
    'https://user:pass@dashscope.aliyuncs.com/api/v1',
    'https://dashscope.aliyuncs.com:8443/api/v1',
  ])('rejects an unreviewed API base %s', (value) => {
    expect(() => normalizeAiImageWanx21EditApiBase(value)).toThrow();
  });

  it('maps full-image operations separately from masked inpaint', () => {
    expect(aiImageWanx21EditFunction('IMAGE_TO_IMAGE')).toBe('description_edit');
    expect(aiImageWanx21EditFunction('FULL_EDIT')).toBe('description_edit');
    expect(aiImageWanx21EditFunction('INPAINT')).toBe('description_edit_with_mask');
  });

  it('normalizes only official DashScope OSS result URLs', () => {
    expect(normalizeAiImageWanx21EditResultUrl(
      'http://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png?signature=opaque',
    )).toBe('https://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png?signature=opaque');
    expect(() => normalizeAiImageWanx21EditResultUrl(
      'https://result.example/edited.png',
    )).toThrow();
    expect(() => normalizeAiImageWanx21EditResultUrl(
      'https://dashscope-a717.oss-cn-beijing.aliyuncs.com.evil.test/edited.png',
    )).toThrow();
    expect(() => normalizeAiImageWanx21EditResultUrl(
      'https://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png#ambiguous',
    )).toThrow();
    expect(() => normalizeAiImageWanx21EditResultUrl(
      'https://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png#',
    )).toThrow();
  });
});

describe('DashScope Wanx 2.1 image-edit adapter', () => {
  it.each(['IMAGE_TO_IMAGE', 'FULL_EDIT'] as const)(
    'submits, polls and downloads one %s result without forwarding authorization',
    async (operation) => {
      const fetcher = successfulFetch();
      const accepted = vi.fn(async () => undefined);
      const source = await sourceImage();
      const provider = createDashScopeWanx21ImageEditProvider({
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        apiKey: 'secret',
        model: AI_IMAGE_WANX21_EDIT_MODEL,
        fetch: fetcher,
        pollIntervalMs: 0,
        timeoutMs: 5_000,
        onProviderJobCreated: accepted,
      });

      const result = await provider.edit({
        operation,
        prompt: 'Preserve the product and replace the background.',
        negativePrompt: null,
        width: 1024,
        height: 1024,
        model: AI_IMAGE_WANX21_EDIT_MODEL,
        images: [{ buffer: source, mimeType: 'image/png' }],
        mask: null,
      });

      expect(result).toMatchObject({
        providerJobId: 'task-wanx-1',
        images: [{ buffer: png, mimeType: 'image/png' }],
      });
      expect(accepted).toHaveBeenCalledWith('task-wanx-1', expect.any(Date));
      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(fetcher.mock.calls[0]?.[0]).toBe(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
      );
      const submit = fetcher.mock.calls[0]?.[1] as RequestInit;
      expect(submit.headers).toMatchObject({
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      });
      const body = JSON.parse(String(submit.body));
      expect(body).toEqual({
        model: AI_IMAGE_WANX21_EDIT_MODEL,
        input: {
          function: 'description_edit',
          prompt: 'Preserve the product and replace the background.',
          base_image_url: expect.stringMatching(/^data:image\/png;base64,/u),
        },
        parameters: { n: 1 },
      });
      expect(fetcher.mock.calls[1]?.[0]).toBe(
        'https://dashscope.aliyuncs.com/api/v1/tasks/task-wanx-1',
      );
      expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ method: 'GET' });
      expect(new Headers((fetcher.mock.calls[3]?.[1] as RequestInit).headers).has('authorization')).toBe(false);
    },
  );

  it('converts OpenAI alpha-mask semantics to Wanx black/white mask semantics', async () => {
    const source = await sourceImage();
    const mask = await alphaMask();
    const converted = await convertOpenAiAlphaMaskToWanxMask(mask);
    const { data, info } = await sharp(converted).raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 512, height: 512, channels: 3 });
    expect([...new Set(data)]).toEqual([255, 0]);

    const fetcher = successfulFetch();
    const provider = createDashScopeWanx21ImageEditProvider({
      baseUrl: 'https://dashscope.aliyuncs.com',
      apiKey: 'secret',
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      fetch: fetcher,
      pollIntervalMs: 0,
      timeoutMs: 5_000,
    });
    await provider.edit({
      operation: 'INPAINT',
      prompt: 'Replace only the selected background region.',
      negativePrompt: null,
      width: 1024,
      height: 1024,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      images: [{ buffer: source, mimeType: 'image/png' }],
      mask: { buffer: mask, mimeType: 'image/png' },
    });

    const body = JSON.parse(String((fetcher.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.input).toEqual({
      function: 'description_edit_with_mask',
      prompt: 'Replace only the selected background region.',
      base_image_url: expect.stringMatching(/^data:image\/png;base64,/u),
      mask_image_url: `data:image/png;base64,${converted.toString('base64')}`,
    });
  });

  it('rejects unsupported request shapes before dispatch', async () => {
    const fetcher = vi.fn();
    const source = await sourceImage();
    const provider = createDashScopeWanx21ImageEditProvider({
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'secret',
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      fetch: fetcher,
    });
    const base = {
      operation: 'IMAGE_TO_IMAGE' as const,
      prompt: 'Edit the image.',
      negativePrompt: null,
      width: 1024,
      height: 1024,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      images: [{ buffer: source, mimeType: 'image/png' as const }],
      mask: null,
    };
    await expect(provider.edit({ ...base, model: 'wanx-other' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_PROVIDER_MODEL',
    });
    await expect(provider.edit({ ...base, images: [...base.images, ...base.images] })).rejects.toMatchObject({
      code: 'INVALID_MEDIA_INPUT',
    });
    await expect(provider.edit({ ...base, operation: 'INPAINT' })).rejects.toMatchObject({
      code: 'INVALID_MEDIA_INPUT',
    });
    await expect(provider.edit({ ...base, prompt: 'x'.repeat(801) })).rejects.toMatchObject({
      code: 'INVALID_MEDIA_INPUT',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not accept partial or unmetered task success as positive evidence', async () => {
    const source = await sourceImage();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: 'task-partial', task_status: 'PENDING' } }))
      .mockResolvedValueOnce(json({
        output: {
          task_id: 'task-partial',
          task_status: 'SUCCEEDED',
          results: [{ url: 'https://dashscope-a717.oss-cn-beijing.aliyuncs.com/edited.png' }],
          task_metrics: { TOTAL: 1, SUCCEEDED: 0, FAILED: 1 },
        },
        usage: { image_count: 0 },
      }));
    const provider = createDashScopeWanx21ImageEditProvider({
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'secret',
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      fetch: fetcher,
      pollIntervalMs: 0,
    });
    await expect(provider.edit({
      operation: 'IMAGE_TO_IMAGE',
      prompt: 'Edit the image.',
      negativePrompt: null,
      width: 1024,
      height: 1024,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      images: [{ buffer: source, mimeType: 'image/png' }],
      mask: null,
    })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT', providerJobId: 'task-partial' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains task identity but does not poll an unreviewed inline submit status', async () => {
    const source = await sourceImage();
    const accepted = vi.fn(async () => undefined);
    const fetcher = vi.fn(async () => json({
      output: { task_id: 'task-no-status' },
    }));
    const provider = createDashScopeWanx21ImageEditProvider({
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'secret',
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      fetch: fetcher,
      onProviderJobCreated: accepted,
    });

    await expect(provider.edit({
      operation: 'IMAGE_TO_IMAGE',
      prompt: 'Edit the image.',
      negativePrompt: null,
      width: 1024,
      height: 1024,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      images: [{ buffer: source, mimeType: 'image/png' }],
      mask: null,
    })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESULT',
      providerJobId: 'task-no-status',
    });
    expect(accepted).toHaveBeenCalledWith('task-no-status', expect.any(Date));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('classifies a definite submit rejection without inventing a task identity', async () => {
    const source = await sourceImage();
    const fetcher = vi.fn(async () => json({ code: 'InvalidParameter' }, 400));
    const provider = createDashScopeWanx21ImageEditProvider({
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'secret',
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      fetch: fetcher,
    });
    const error = await provider.edit({
      operation: 'IMAGE_TO_IMAGE',
      prompt: 'Edit the image.',
      negativePrompt: null,
      width: 1024,
      height: 1024,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      images: [{ buffer: source, mimeType: 'image/png' }],
      mask: null,
    }).catch((value) => value as Error & Record<string, unknown>);
    expect(error).toMatchObject({
      code: 'PROVIDER_REQUEST_FAILED',
      providerSubmissionRejected: true,
      providerHttpStatus: 400,
    });
    expect(error).not.toHaveProperty('providerJobId');
  });
});
