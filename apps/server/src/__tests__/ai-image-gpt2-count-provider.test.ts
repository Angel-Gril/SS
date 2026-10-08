import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  createDonorGptImage2EditProvider,
  createGptImage2CountEditProvider,
  createGptImage2CountGenerationProvider,
  createOpenAiImagesProvider,
  type OpenAiImageEditRequest,
} from '../services/ai-image-providers.js';
import { normalizeGptImage2CountEditOutput } from '../services/ai-image-gpt2-count-profile.js';

const options = { baseUrl: 'https://ai.big-model-api.top/v1', model: 'gpt-image-2-count', apiKey: 'fixture-key', costPerImageCents: 10 };
const image = (width = 64, height = 64, alpha = 1) => sharp({ create: {
  width, height, channels: 4, background: { r: 20, g: 50, b: 150, alpha },
} }).png().toBuffer();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function editRequest(operation: OpenAiImageEditRequest['operation'] = 'FULL_EDIT'): Promise<OpenAiImageEditRequest> {
  return { operation, prompt: 'Change the background and preserve the product.', negativePrompt: null,
    width: 1024, height: 1024, images: [{ buffer: await image(), mimeType: 'image/png' }] };
}
const generationRequest = () => ({ operation: 'TEXT_TO_IMAGE' as const, model: options.model,
  prompt: 'A red cup in a bright studio.', negativePrompt: null, width: 1024, height: 1024, count: 1 });

describe('dedicated ordinary GPT Image 2 count adapters', () => {
  it('normalizes only the observed 896x1200 Provider rounding to the requested 900x1200 canvas and retains its real dimensions', async () => {
    const source = await sharp({ create: { width: 896, height: 1200, channels: 3, background: '#204096' } })
      .withExif({ IFD0: { Artist: 'Fixture metadata' } }).png().toBuffer();
    const result = await normalizeGptImage2CountEditOutput({ buffer: source, mimeType: 'image/png' }, 900, 1200);
    expect(result).toMatchObject({ width: 900, height: 1200, mimeType: 'image/png', providerOutput: { width: 896, height: 1200 } });
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 900, height: 1200 }); expect(metadata.exif).toBeUndefined();
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(at(0, 0)).toEqual([32, 64, 150]); expect(at(899, 1199)).toEqual([32, 64, 150]);
    expect(result.buffer.equals(source)).toBe(false);
    expect(result.normalizerVersion).toBe('gpt2-count-ordinary-output-normalizer/v1');
    expect((await normalizeGptImage2CountEditOutput({ buffer: source, mimeType: 'image/png' }, 900, 1200)).buffer).toEqual(result.buffer);
  });

  it.each([[895, 1200], [900, 1199], [896, 1199], [1008, 1344], [1024, 1024]])('rejects uncharacterized raw output %sx%s for a 900x1200 request', async (width, height) => {
    await expect(normalizeGptImage2CountEditOutput({ buffer: await image(width, height), mimeType: 'image/png' }, 900, 1200))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
  });

  it('rejects output MIME deception and corrupt bytes rather than inferring pixels', async () => {
    await expect(normalizeGptImage2CountEditOutput({ buffer: await image(900, 1200), mimeType: 'image/jpeg' }, 900, 1200))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
    await expect(normalizeGptImage2CountEditOutput({ buffer: Buffer.from('not an image'), mimeType: 'image/png' }, 900, 1200))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
  });

  it.each(['IMAGE_TO_IMAGE', 'FULL_EDIT'] as const)('sends %s as high quality single-reference multipart without changing source bytes', async operation => {
    const input = await editRequest(operation), output = await image();
    const fetch = vi.fn(async () => json({ id: 'accepted-edit', data: [{ b64_json: output.toString('base64') }] }));
    const beforeProviderDispatch = vi.fn(async () => undefined), onProviderJobCreated = vi.fn(async () => undefined);
    const result = await createGptImage2CountEditProvider({ ...options, fetch, beforeProviderDispatch, onProviderJobCreated }).edit(input);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(url).toBe('https://ai.big-model-api.top/v1/images/edits');
    expect([...form.keys()]).toEqual(['model', 'prompt', 'n', 'size', 'quality', 'response_format', 'image']);
    expect(form.get('model')).toBe(options.model); expect(form.get('n')).toBe('1');
    expect(form.get('quality')).toBe('high'); expect(form.get('response_format')).toBe('url');
    expect(form.get('size')).toBe('1024x1024');
    expect(Buffer.from(await (form.get('image') as Blob).arrayBuffer())).toEqual(input.images[0]!.buffer);
    expect(beforeProviderDispatch).toHaveBeenCalledOnce();
    expect(onProviderJobCreated).toHaveBeenCalledWith('accepted-edit', expect.any(Date));
    expect(result).toMatchObject({ providerJobId: 'accepted-edit', actualCostCents: 10 });
  });

  it.each([[1024, 1024], [1024, 1536], [1536, 1024], [1008, 1344], [900, 1200]])('passes candidate size %sx%s through without granting capability', async (width, height) => {
    const output = await image(), fetch = vi.fn(async () => json({ data: [{ b64_json: output.toString('base64') }] }));
    await createGptImage2CountEditProvider({ ...options, fetch }).edit({ ...await editRequest(), width, height });
    expect((fetch.mock.calls[0] as any)[1].body.get('size')).toBe(`${width}x${height}`);
  });

  it('sends one alpha PNG mask on the exact source/request canvas', async () => {
    const source = await image(900, 1200), mask = await image(900, 1200, 0), output = await image();
    const fetch = vi.fn(async () => json({ data: [{ b64_json: output.toString('base64') }] }));
    await createGptImage2CountEditProvider({ ...options, fetch }).edit({ ...await editRequest('INPAINT'), width: 900, height: 1200,
      images: [{ buffer: source, mimeType: 'image/png' }], mask: { buffer: mask, mimeType: 'image/png' } });
    const form = (fetch.mock.calls[0] as any)[1].body as FormData;
    expect(Buffer.from(await (form.get('image') as Blob).arrayBuffer())).toEqual(source);
    expect(Buffer.from(await (form.get('mask') as Blob).arrayBuffer())).toEqual(mask);
    expect(form.get('size')).toBe('900x1200');
  });

  it.each(['missing', 'opaque', 'different-mask-size', 'different-canvas', 'two-sources'] as const)('rejects invalid inpaint %s before dispatch', async condition => {
    const input = await editRequest('INPAINT');
    input.images[0]!.buffer = await image(1024, 1024);
    input.mask = { buffer: await image(1024, 1024, 0), mimeType: 'image/png' };
    if (condition === 'missing') input.mask = null;
    if (condition === 'opaque') input.mask!.buffer = await image(1024, 1024, 1);
    if (condition === 'different-mask-size') input.mask!.buffer = await image(512, 512, 0);
    if (condition === 'different-canvas') { input.images[0]!.buffer = await image(512, 512); input.mask!.buffer = await image(512, 512, 0); }
    if (condition === 'two-sources') input.images.push(input.images[0]!);
    const fetch = vi.fn();
    await expect(createGptImage2CountEditProvider({ ...options, fetch }).edit(input)).rejects.toMatchObject({ providerSubmissionRejected: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ model: 'gpt-image-2' }, { width: 768, height: 1024 }, { prompt: '' }, { prompt: 'x'.repeat(8001) },
    { negativePrompt: 'x'.repeat(4001) }, { wanxEditStrength: 0.8 }])('rejects ordinary request drift before dispatch', async change => {
    const fetch = vi.fn();
    await expect(createGptImage2CountEditProvider({ ...options, fetch }).edit({ ...await editRequest(), ...change } as any))
      .rejects.toMatchObject({ providerSubmissionRejected: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects source byte excess before image decode or Provider dispatch', async () => {
    const fetch = vi.fn(), input = await editRequest();
    input.images[0]!.buffer = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(createGptImage2CountEditProvider({ ...options, fetch }).edit(input))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT', providerSubmissionRejected: true, message: expect.stringContaining('byte budget') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects multipage sources instead of silently selecting a frame', async () => {
    const source = await sharp(Buffer.concat([Buffer.alloc(64 * 64 * 3), Buffer.alloc(64 * 64 * 3, 255)]), {
      raw: { width: 64, height: 128, pageHeight: 64, channels: 3 },
    }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    const fetch = vi.fn(), input = await editRequest();
    input.images = [{ buffer: source, mimeType: 'image/webp' }];
    await expect(createGptImage2CountEditProvider({ ...options, fetch }).edit(input))
      .rejects.toMatchObject({ providerSubmissionRejected: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['https://elsewhere.example/v1', 'https://ai.big-model-api.top/other/v1', 'http://ai.big-model-api.top/v1'])('rejects an endpoint not bound to the count alias %s', baseUrl => {
    const fetch = vi.fn();
    expect(() => createGptImage2CountEditProvider({ ...options, baseUrl, fetch })).toThrow();
    expect(() => createGptImage2CountGenerationProvider({ ...options, baseUrl, fetch })).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the suite donor factory portrait-I2I-only', async () => {
    const fetch = vi.fn();
    await expect(createDonorGptImage2EditProvider({ ...options, fetch }).edit(await editRequest())).rejects.toMatchObject({ providerSubmissionRejected: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends count text generation high quality without affecting generic generation', async () => {
    const output = await image();
    const fetch = vi.fn(async () => json({ id: 'accepted-generation', data: [{ b64_json: output.toString('base64') }] }));
    const beforeProviderDispatch = vi.fn(async () => undefined), onProviderJobCreated = vi.fn(async () => undefined);
    await createGptImage2CountGenerationProvider({ ...options, fetch, beforeProviderDispatch, onProviderJobCreated }).generate(generationRequest());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.big-model-api.top/v1/images/generations');
    expect(JSON.parse(String(init.body))).toEqual({ model: options.model, prompt: generationRequest().prompt, n: 1,
      size: '1024x1024', quality: 'high', response_format: 'url' });
    expect(beforeProviderDispatch).toHaveBeenCalledOnce(); expect(onProviderJobCreated).toHaveBeenCalledOnce();
    await createOpenAiImagesProvider({ ...options, model: 'custom-model', fetch }).generate({ ...generationRequest(), model: 'custom-model' });
    expect(JSON.parse(String((fetch.mock.calls[1] as any)[1].body))).not.toHaveProperty('quality');
  });

  it.each([{ count: 2 }, { operation: 'FULL_EDIT' }, { model: 'gpt-image-2' }, { width: 512 }, { prompt: '' },
    { prompt: 'x'.repeat(8001) }, { inputImages: [{}] }, { mask: {} }])('rejects generation request drift before dispatch', async change => {
    const fetch = vi.fn();
    await expect(createGptImage2CountGenerationProvider({ ...options, fetch }).generate({ ...generationRequest(), ...change } as any))
      .rejects.toMatchObject({ providerSubmissionRejected: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['edit', 'generation'] as const)('classifies %s credential revision fencing before POST as rejected', async kind => {
    const fetch = vi.fn(), error = Object.assign(new Error('Revision changed'), { code: 'PROVIDER_CREDENTIAL_REVISION_CHANGED' });
    const beforeProviderDispatch = vi.fn(async () => { throw error; });
    const configured = { ...options, fetch, beforeProviderDispatch };
    const run = kind === 'edit' ? createGptImage2CountEditProvider(configured).edit(await editRequest())
      : createGptImage2CountGenerationProvider(configured).generate(generationRequest());
    await expect(run).rejects.toMatchObject({ code: error.code, providerSubmissionRejected: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['edit', 'generation'] as const)('never retries unknown %s POST outcome', async kind => {
    const fetch = vi.fn(async () => { throw new TypeError('Connection lost'); });
    const run = kind === 'edit' ? createGptImage2CountEditProvider({ ...options, fetch }).edit(await editRequest())
      : createGptImage2CountGenerationProvider({ ...options, fetch }).generate(generationRequest());
    await expect(run).rejects.toMatchObject({ providerSubmissionUncertain: true }); expect(fetch).toHaveBeenCalledOnce();
  });

  it('downloads accepted output without forwarding Authorization and preserves its identity on failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ id: 'accepted', data: [{ url: 'https://result.fixture.example/image.png' }] }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const onProviderJobCreated = vi.fn(async () => undefined);
    await expect(createGptImage2CountGenerationProvider({ ...options, fetch, onProviderJobCreated }).generate(generationRequest()))
      .rejects.toMatchObject({ providerJobId: 'accepted', providerAcceptedAt: expect.any(Date) });
    expect(onProviderJobCreated).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(fetch.mock.calls[1]![1].headers).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
