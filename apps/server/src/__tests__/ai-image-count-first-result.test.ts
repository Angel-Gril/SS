import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  createDonorGptImage2EditProvider, createGptImage2CountEditProvider,
  createGptImage2CountGenerationProvider, type OpenAiImageEditRequest,
} from '../services/ai-image-providers.js';

const options = { baseUrl: 'https://ai.big-model-api.top/v1', model: 'gpt-image-2-count', apiKey: 'fixture-key', costPerImageCents: 10 };
const json = (data: unknown[]) => new Response(JSON.stringify({ id: 'accepted-count-fixture', data }), { headers: { 'content-type': 'application/json' } });
async function run(kind: 'suite' | 'edit' | 'generation', fetch: any) {
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer();
  const request: OpenAiImageEditRequest = { operation: 'IMAGE_TO_IMAGE', model: options.model, prompt: 'Preserve the product.', negativePrompt: null,
    width: kind === 'suite' ? 1008 : 1024, height: kind === 'suite' ? 1344 : 1024, images: [{ buffer: bytes, mimeType: 'image/png' }] };
  return kind === 'generation'
    ? createGptImage2CountGenerationProvider({ ...options, fetch }).generate({ ...request, operation: 'TEXT_TO_IMAGE', count: 1, images: undefined } as any)
    : kind === 'suite' ? createDonorGptImage2EditProvider({ ...options, fetch }).edit(request)
      : createGptImage2CountEditProvider({ ...options, fetch }).edit(request);
}

describe('count single-image response selection', () => {
  it.each(['suite', 'edit', 'generation'] as const)('uses only the first of three results for %s, with one billed image and no extra download', async kind => {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#abcdef' } }).png().toBuffer();
    const fetch = vi.fn(async () => json([{ b64_json: bytes.toString('base64') }, { url: 'https://unused.example/second' }, { url: 'http://127.0.0.1/ignored' }]));
    const result = await run(kind, fetch);
    expect(result.images).toHaveLength(1); expect(result.images[0]!.buffer).toEqual(bytes);
    expect(result.actualCostCents).toBe(10); expect(result.providerJobId).toBe('accepted-count-fixture');
    expect(fetch).toHaveBeenCalledOnce();
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body instanceof FormData ? init.body.get('n') : JSON.parse(String(init.body)).n).toBe(kind === 'generation' ? 1 : '1');
  });
  it.each(['suite', 'edit', 'generation'] as const)('rejects an invalid first result in %s without selecting a later one', async kind => {
    const fetch = vi.fn(async () => json([{}, { url: 'https://unused.example/valid-later' }]));
    await expect(run(kind, fetch)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT', providerJobId: 'accepted-count-fixture' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('downloads only the first URL and omits Provider credentials for that download', async () => {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#abcdef' } }).png().toBuffer();
    const fetch = vi.fn(async (_url: any, init?: RequestInit) => init?.method === 'POST'
      ? json([{ url: 'https://public-image.fixture.example/first.png' }, { url: 'https://unused.example/second' }, { url: 'https://unused.example/third' }])
      : new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    const result = await run('suite', fetch);
    expect(result.images).toHaveLength(1); expect(result.actualCostCents).toBe(10);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe('https://public-image.fixture.example/first.png');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });
  it.each([0, 4])('rejects an empty or unobserved result count %s before downloading', async count => {
    const fetch = vi.fn(async () => json(Array.from({ length: count }, () => ({ url: 'https://unused.example/image' }))));
    await expect(run('suite', fetch)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT', providerJobId: 'accepted-count-fixture' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps another donor endpoint/model strict even when it returns three results', async () => {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const fetch = vi.fn(async () => json(Array.from({ length: 3 }, () => ({ b64_json: bytes.toString('base64') }))));
    await expect(createDonorGptImage2EditProvider({ ...options, baseUrl: 'https://quality.fixture.example/v1', model: 'gpt-image-2', fetch }).edit({
      operation: 'IMAGE_TO_IMAGE', model: 'gpt-image-2', prompt: 'Preserve the product.', negativePrompt: null, width: 1008, height: 1344,
      images: [{ buffer: bytes, mimeType: 'image/png' }],
    })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
