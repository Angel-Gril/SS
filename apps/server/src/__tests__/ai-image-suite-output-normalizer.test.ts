import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES,
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH,
  AiImageSuiteOutputNormalizerError,
  normalizeAiImageSuiteProviderOutput,
} from '../services/ai-image-suite-output-normalizer.js';

const CONTENT_RED = { r: 214, g: 38, b: 55, alpha: 1 };

async function providerPng(width = AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH, height = AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: CONTENT_RED,
    },
  }).png().toBuffer();
}

async function animatedProviderWebp() {
  const frameBytes = AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH * AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT * 3;
  const frames = Buffer.concat([
    Buffer.alloc(frameBytes, 0),
    Buffer.alloc(frameBytes, 255),
  ]);
  return sharp(frames, {
    raw: {
      width: AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH,
      height: AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT * 2,
      pageHeight: AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT,
      channels: 3,
    },
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
}

function pixelAt(data: Buffer, width: number, channels: number, x: number, y: number) {
  const offset = ((y * width) + x) * channels;
  return [...data.subarray(offset, offset + 3)];
}

function expectNormalizerError(code: string) {
  return expect.objectContaining({
    name: 'AiImageSuiteOutputNormalizerError',
    code,
  });
}

describe('AI image suite output normalizer', () => {
  it('contains an explicitly bound Wanx square in 900x1200 without cropping or stretching the product', async () => {
    const result = await normalizeAiImageSuiteProviderOutput({
      buffer: await providerPng(1024, 1024), mimeType: 'image/png',
      providerRequest: { width: 1024, height: 1024 },
    } as any);
    const decoded = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 900, height: 1200, channels: 3 });
    for (const x of [0, 450, 899]) {
      expect(pixelAt(decoded.data, 900, 3, x, 149)).toEqual([255, 255, 255]);
      expect(pixelAt(decoded.data, 900, 3, x, 150)).toEqual([214, 38, 55]);
      expect(pixelAt(decoded.data, 900, 3, x, 1049)).toEqual([214, 38, 55]);
      expect(pixelAt(decoded.data, 900, 3, x, 1050)).toEqual([255, 255, 255]);
    }
  });

  it('accepts the known 1024x1536 Wanx fallback and still normalizes to the frozen 3:4 output', async () => {
    const result = await normalizeAiImageSuiteProviderOutput({
      buffer: await providerPng(1024, 1536), mimeType: 'image/png',
      providerRequest: { width: 1024, height: 1024 },
    } as any);
    expect(result).toMatchObject({ width: 900, height: 1200, mimeType: 'image/png' });
  });

  it('accepts the verified 880x880 Wanx fallback and still normalizes to the frozen 3:4 output', async () => {
    const result = await normalizeAiImageSuiteProviderOutput({
      buffer: await providerPng(880, 880), mimeType: 'image/png',
      providerRequest: { width: 1024, height: 1024 },
    } as any);
    expect(result).toMatchObject({ width: 900, height: 1200, mimeType: 'image/png' });
  });

  it('does not accept square output under a portrait request or an arbitrary new Provider size', async () => {
    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: await providerPng(1024, 1024), mimeType: 'image/png',
      providerRequest: { width: 1024, height: 1536 },
    } as any)).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'));
    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: await providerPng(512, 512), mimeType: 'image/png',
      providerRequest: { width: 512, height: 512 },
    } as any)).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'));
  });

  it('deterministically contains a 1024x1536 Provider image in a 900x1200 white PNG', async () => {
    const source = await providerPng();

    const first = await normalizeAiImageSuiteProviderOutput({ buffer: source, mimeType: 'image/png' });
    const second = await normalizeAiImageSuiteProviderOutput({ buffer: source, mimeType: 'image/png' });

    expect(first).toMatchObject({
      mimeType: 'image/png',
      width: 900,
      height: 1200,
      normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(first.sha256).toBe(createHash('sha256').update(first.buffer).digest('hex'));
    expect(second.sha256).toBe(first.sha256);
    expect(second.buffer.equals(first.buffer)).toBe(true);

    const decoded = await sharp(first.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 900, height: 1200, channels: 3 });
    expect(pixelAt(decoded.data, decoded.info.width, decoded.info.channels, 0, 600)).toEqual([255, 255, 255]);
    expect(pixelAt(decoded.data, decoded.info.width, decoded.info.channels, 49, 600)).toEqual([255, 255, 255]);
    expect(pixelAt(decoded.data, decoded.info.width, decoded.info.channels, 50, 600)).toEqual([214, 38, 55]);
    expect(pixelAt(decoded.data, decoded.info.width, decoded.info.channels, 849, 600)).toEqual([214, 38, 55]);
    expect(pixelAt(decoded.data, decoded.info.width, decoded.info.channels, 850, 600)).toEqual([255, 255, 255]);
    expect(pixelAt(decoded.data, decoded.info.width, decoded.info.channels, 899, 600)).toEqual([255, 255, 255]);
  });

  it('rejects a declared MIME that disagrees with the image magic', async () => {
    const source = await providerPng();

    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: source,
      mimeType: 'image/jpeg',
    })).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_MIME_MISMATCH'));
  });

  it('rejects bytes without a supported image magic', async () => {
    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: Buffer.from('not-an-image'),
      mimeType: 'image/png',
    })).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_INVALID_IMAGE'));
  });

  it('rejects Provider images outside the verified Wanx fallback dimensions', async () => {
    const wrongSize = await providerPng(1024, 1535);

    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: wrongSize,
      mimeType: 'image/png',
    })).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'));

    const nearSquare = await providerPng(881, 881);
    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: nearSquare,
      mimeType: 'image/png',
      providerRequest: { width: 1024, height: 1024 },
    } as any)).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'));
  });

  it('rejects a Provider buffer above the 20 MiB boundary before decoding', async () => {
    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: Buffer.alloc(AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES + 1),
      mimeType: 'image/png',
    })).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_TOO_LARGE'));
  });

  it('rejects animated or multi-page Provider output', async () => {
    const animated = await animatedProviderWebp();
    const metadata = await sharp(animated, { animated: false }).metadata();
    expect(metadata.pages).toBe(2);

    await expect(normalizeAiImageSuiteProviderOutput({
      buffer: animated,
      mimeType: 'image/webp',
    })).rejects.toEqual(expectNormalizerError('PROVIDER_OUTPUT_MULTIPAGE'));
  });

  it('exposes a typed error for callers to classify validation failures', () => {
    const error = new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_INVALID_IMAGE',
      'invalid image',
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AiImageSuiteOutputNormalizerError');
  });
});
