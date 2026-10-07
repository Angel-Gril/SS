import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_DONOR_GPT2_PROFILE,
  AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION,
  AI_IMAGE_DONOR_GPT2_REQUEST_PROFILE,
  assertDonorGpt2ImageToImageRequest,
  createDonorGpt2FullFrameConfig,
  donorGpt2EditEndpoint,
  normalizeDonorGpt2ProviderOutput,
} from '../services/ai-image-donor-gpt2-profile.js';

const request = () => ({ model: 'gpt-image-2', operation: 'IMAGE_TO_IMAGE', width: 1008, height: 1344,
  count: 1, referenceCount: 1, quality: 'high' });
async function image(width = 1008, height = 1344, format: 'png' | 'jpeg' | 'webp' = 'png') {
  return sharp({ create: { width, height, channels: 3, background: { r: 214, g: 38, b: 55 } } })[format]().toBuffer();
}

describe('isolated donor GPT Image 2 portrait profile', () => {
  it('declares the donor request without assuming an endpoint or production readiness', () => {
    expect(AI_IMAGE_DONOR_GPT2_PROFILE).toMatchObject({
      model: 'gpt-image-2', width: 1008, height: 1344, quality: 'high',
      count: 1, minReferences: 1, maxReferences: 16, transport: 'multipart', endpointPath: '/images/edits',
      requestProfile: AI_IMAGE_DONOR_GPT2_REQUEST_PROFILE,
    });
    expect(AI_IMAGE_DONOR_GPT2_PROFILE).not.toHaveProperty('apiBase');
    expect(AI_IMAGE_DONOR_GPT2_PROFILE).not.toHaveProperty('expectedHost');
    expect(AI_IMAGE_DONOR_GPT2_PROFILE).not.toHaveProperty('executionReady');
    expect(Object.isFrozen(AI_IMAGE_DONOR_GPT2_PROFILE)).toBe(true);
  });

  it('freezes a complete full-frame render recipe independent of the Wanx canvas', () => {
    expect(createDonorGpt2FullFrameConfig()).toEqual({
      version: 'donor-gpt2-full-frame/v1', requestProfile: AI_IMAGE_DONOR_GPT2_REQUEST_PROFILE,
      providerRequest: { count: 1, width: 1008, height: 1344, quality: 'high' },
      finalOutput: { profile: 'ozon-suite-3x4-900x1200/v1', width: 900, height: 1200, fit: 'full-frame',
        background: '#ffffff', format: 'png', normalizerVersion: AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION },
    });
    expect(createDonorGpt2FullFrameConfig()).not.toHaveProperty('referenceCanvas');
  });

  it.each([1, 16])('accepts %s references under the exact donor image-to-image contract', referenceCount => {
    expect(() => assertDonorGpt2ImageToImageRequest({ ...request(), referenceCount })).not.toThrow();
  });

  it.each([
    { model: 'gpt-image-1' }, { operation: 'INPAINT' }, { operation: 'FULL_EDIT' },
    { width: 1024 }, { height: 1343 }, { count: 2 }, { quality: 'auto' },
    { referenceCount: 0 }, { referenceCount: 17 }, { referenceCount: 1.5 }, { referenceCount: NaN },
  ])('rejects an unreviewed request change %j', change => {
    expect(() => assertDonorGpt2ImageToImageRequest({ ...request(), ...change }))
      .toThrow(expect.objectContaining({ code: 'DONOR_GPT2_REQUEST_INVALID' }));
  });

  it('uses an explicitly supplied HTTPS API base without guessing the vendor', () => {
    expect(donorGpt2EditEndpoint('https://configured-provider.example/v1'))
      .toBe('https://configured-provider.example/v1/images/edits');
    expect(donorGpt2EditEndpoint('https://api.openai.com/v1'))
      .toBe('https://api.openai.com/v1/images/edits');
  });

  it.each(['', ' ', 'http://configured-provider.example/v1', 'https://127.0.0.1/v1',
    'https://localhost/v1', 'https://user:password@configured-provider.example/v1',
    'https://configured-provider.example/v1?key=secret', 'https://configured-provider.example/v1/images/edits'])(
    'rejects a missing or noncanonical endpoint %s', base => {
      expect(() => donorGpt2EditEndpoint(base)).toThrow();
    });

  it('normalizes the actual 3:4 frame without inserting padding, cropping or stretching', async () => {
    // Four distinct edge patches and a square make both lost edges and unequal
    // horizontal/vertical scale visible in the real decoded output.
    const patch = (color: string) => ({ input: { create: { width: 112, height: 112, channels: 3 as const, background: color } } });
    const source = await sharp({ create: { width: 1008, height: 1344, channels: 3, background: '#df2020' } })
      .composite([
        { ...patch('#00ff00'), left: 0, top: 0 }, { ...patch('#0000ff'), left: 896, top: 0 },
        { ...patch('#ffff00'), left: 0, top: 1232 }, { ...patch('#00ffff'), left: 896, top: 1232 },
        { ...patch('#000000'), left: 448, top: 616 },
      ]).png().toBuffer();
    const first = await normalizeDonorGpt2ProviderOutput({ buffer: source, mimeType: 'image/png' });
    const second = await normalizeDonorGpt2ProviderOutput({ buffer: source, mimeType: 'image/png' });
    expect(first).toMatchObject({ width: 900, height: 1200, mimeType: 'image/png',
      normalizerVersion: AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION, providerOutput: { width: 1008, height: 1344 } });
    expect(first.sha256).toBe(createHash('sha256').update(first.buffer).digest('hex'));
    expect(second.buffer.equals(first.buffer)).toBe(true);
    const { data, info } = await sharp(first.buffer).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    expect(at(0, 0)).toEqual([0, 255, 0]); expect(at(899, 0)).toEqual([0, 0, 255]);
    expect(at(0, 1199)).toEqual([255, 255, 0]); expect(at(899, 1199)).toEqual([0, 255, 255]);
    const black = (rgb: number[]) => rgb.every(channel => channel < 20);
    const spanX = Array.from({ length: 900 }, (_, x) => x).filter(x => black(at(x, 600)));
    const spanY = Array.from({ length: 1200 }, (_, y) => y).filter(y => black(at(450, y)));
    expect(spanX.length).toBe(100); expect(spanY.length).toBe(100);
  });

  it.each(['png', 'jpeg', 'webp'] as const)('safely decodes %s output and strips metadata before PNG storage', async format => {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
    const source = await sharp(await image()).withExif({ IFD0: { Artist: 'Synthetic private metadata' } })[format]().toBuffer();
    const result = await normalizeDonorGpt2ProviderOutput({ buffer: source, mimeType });
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 900, height: 1200 });
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
  });

  it.each([[1007, 1344], [1008, 1343], [768, 1024], [900, 1200], [1024, 1024], [1024, 1536]])('rejects unverified output %sx%s instead of repairing its frame', async (width, height) => {
      await expect(normalizeDonorGpt2ProviderOutput({ buffer: await image(width, height), mimeType: 'image/png' }))
        .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH' });
    });

  it('rejects MIME/magic mismatches, invalid and oversized bytes', async () => {
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: await image(), mimeType: 'image/jpeg' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_MIME_MISMATCH' });
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: await image(), mimeType: 'image/svg+xml' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_UNSUPPORTED_MIME' });
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: Buffer.from('not an image'), mimeType: 'image/png' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID_IMAGE' });
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: Buffer.alloc(20 * 1024 * 1024 + 1), mimeType: 'image/png' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_TOO_LARGE' });
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: Buffer.alloc(0), mimeType: 'image/png' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID_IMAGE' });
    const oversizedPixels = await image(4001, 4001);
    expect(oversizedPixels.length).toBeLessThan(20 * 1024 * 1024);
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: oversizedPixels, mimeType: 'image/png' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID_IMAGE' });
  });

  it('rejects animated output and rotated frames rather than flattening or distorting them', async () => {
    const frames = Buffer.concat([Buffer.alloc(1008 * 1344 * 3), Buffer.alloc(1008 * 1344 * 3, 255)]);
    const animated = await sharp(frames, { raw: { width: 1008, height: 2688, pageHeight: 1344, channels: 3 } })
      .webp({ loop: 0, delay: [100, 100] }).toBuffer();
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: animated, mimeType: 'image/webp' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_MULTIPAGE' });
    const rotated = await sharp(await image()).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    await expect(normalizeDonorGpt2ProviderOutput({ buffer: rotated, mimeType: 'image/jpeg' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH' });
  });
});
