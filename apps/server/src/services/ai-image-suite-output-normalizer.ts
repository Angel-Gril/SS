import { createHash } from 'node:crypto';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { AI_IMAGE_WANX21_EDIT_PROFILE } from './ai-image-wanx-edit-profile.js';
import {
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
} from './ai-image-suite-materialization.js';

export { AI_IMAGE_SUITE_OUTPUT_HEIGHT, AI_IMAGE_SUITE_OUTPUT_WIDTH };

export const AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION =
  'ai-image-suite-output-normalizer/v1' as const;
export const AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH = 1024;
export const AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT = 1536;

const AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_METADATA_PIXELS = 16_000_000;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 } as const;

export type AiImageSuiteProviderOutputMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export type AiImageSuiteOutputNormalizerErrorCode =
  | 'PROVIDER_OUTPUT_INVALID_IMAGE'
  | 'PROVIDER_OUTPUT_TOO_LARGE'
  | 'PROVIDER_OUTPUT_UNSUPPORTED_MIME'
  | 'PROVIDER_OUTPUT_MIME_MISMATCH'
  | 'PROVIDER_OUTPUT_MULTIPAGE'
  | 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'
  | 'PROVIDER_OUTPUT_NORMALIZATION_FAILED';

export class AiImageSuiteOutputNormalizerError extends Error {
  constructor(
    public readonly code: AiImageSuiteOutputNormalizerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSuiteOutputNormalizerError';
  }
}

export interface NormalizeAiImageSuiteProviderOutputInput {
  buffer: Buffer;
  mimeType: string;
  /** Dimensions from the validated frozen Provider request, never decoded-image inference. */
  providerRequest?: { width: number; height: number };
}

export interface NormalizedAiImageSuiteProviderOutput {
  buffer: Buffer;
  mimeType: 'image/png';
  width: typeof AI_IMAGE_SUITE_OUTPUT_WIDTH;
  height: typeof AI_IMAGE_SUITE_OUTPUT_HEIGHT;
  sha256: string;
  normalizerVersion: typeof AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION;
}

function normalizeDeclaredMime(value: unknown): AiImageSuiteProviderOutputMimeType | null {
  const normalized = String(value || '').split(';')[0]!.trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') {
    return normalized;
  }
  return null;
}

function detectMagicMime(buffer: Buffer): AiImageSuiteProviderOutputMimeType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function mimeForSharpFormat(format: string | undefined): AiImageSuiteProviderOutputMimeType | null {
  if (format === 'png') return 'image/png';
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return null;
}

function hasAnimationMetadata(metadata: Metadata): boolean {
  return Number(metadata.pages ?? 1) !== 1
    || (Array.isArray(metadata.delay) && metadata.delay.length > 0);
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function normalizeAiImageSuiteProviderOutput(
  input: NormalizeAiImageSuiteProviderOutputInput,
): Promise<NormalizedAiImageSuiteProviderOutput> {
  const providerRequest = input.providerRequest || {
    width: AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH,
    height: AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT,
  };
  if (!((providerRequest.width === AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH
      && providerRequest.height === AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT)
    || (providerRequest.width === AI_IMAGE_WANX21_EDIT_PROFILE.width
      && providerRequest.height === AI_IMAGE_WANX21_EDIT_PROFILE.height))) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH',
      'Provider output dimensions are not a supported suite request profile',
    );
  }
  if (!Buffer.isBuffer(input?.buffer) || input.buffer.length < 1) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_INVALID_IMAGE',
      'Provider output image bytes are empty or invalid',
    );
  }
  if (input.buffer.length > AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_TOO_LARGE',
      'Provider output image exceeds the 20 MiB byte limit',
    );
  }

  const declaredMime = normalizeDeclaredMime(input.mimeType);
  if (!declaredMime) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_UNSUPPORTED_MIME',
      'Provider output MIME must be PNG, JPEG, or WebP',
    );
  }
  const magicMime = detectMagicMime(input.buffer);
  if (!magicMime) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_INVALID_IMAGE',
      'Provider output does not have supported image magic bytes',
    );
  }
  if (magicMime !== declaredMime) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_MIME_MISMATCH',
      'Provider output MIME does not match its image magic bytes',
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.buffer, {
      animated: false,
      failOn: 'warning',
      limitInputPixels: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_METADATA_PIXELS,
    }).metadata();
  } catch {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_INVALID_IMAGE',
      'Provider output image metadata could not be decoded safely',
    );
  }

  if (mimeForSharpFormat(metadata.format) !== magicMime) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_MIME_MISMATCH',
      'Provider output decoded format does not match its declared MIME',
    );
  }
  if (hasAnimationMetadata(metadata)) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_MULTIPAGE',
      'Provider output must contain exactly one still image',
    );
  }
  const matchesRequestedProfile = metadata.width === providerRequest.width
    && metadata.height === providerRequest.height;
  const matchesKnownWanxFallback = providerRequest.width === AI_IMAGE_WANX21_EDIT_PROFILE.width
    && providerRequest.height === AI_IMAGE_WANX21_EDIT_PROFILE.height
    && metadata.width === AI_IMAGE_SUITE_PROVIDER_OUTPUT_WIDTH
    && metadata.height === AI_IMAGE_SUITE_PROVIDER_OUTPUT_HEIGHT;
  if (!matchesRequestedProfile && !matchesKnownWanxFallback) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH',
      `Provider output must be exactly ${providerRequest.width}x${providerRequest.height} pixels`,
    );
  }

  let normalized: { data: Buffer; info: OutputInfo };
  try {
    normalized = await sharp(input.buffer, {
      animated: false,
      failOn: 'warning',
      // The accepted Wanx fallback may be 1024x1536 while the frozen request
      // profile is 1024x1024; bound decoding by the validated actual image,
      // not the smaller request profile.
      limitInputPixels: (metadata.width || 0) * (metadata.height || 0),
    })
      .toColourspace('srgb')
      .resize({
        width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
        height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
        fit: 'contain',
        position: 'centre',
        background: WHITE,
        kernel: sharp.kernel.lanczos3,
        fastShrinkOnLoad: false,
      })
      .flatten({ background: WHITE })
      .png({
        compressionLevel: 9,
        adaptiveFiltering: false,
        palette: false,
        progressive: false,
      })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_NORMALIZATION_FAILED',
      'Provider output image could not be normalized safely',
    );
  }

  if (
    normalized.info.format !== 'png'
    || normalized.info.width !== AI_IMAGE_SUITE_OUTPUT_WIDTH
    || normalized.info.height !== AI_IMAGE_SUITE_OUTPUT_HEIGHT
  ) {
    throw new AiImageSuiteOutputNormalizerError(
      'PROVIDER_OUTPUT_NORMALIZATION_FAILED',
      'Normalized Provider output has an invalid image shape',
    );
  }

  return {
    buffer: normalized.data,
    mimeType: 'image/png',
    width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
    height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
    sha256: sha256(normalized.data),
    normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
  };
}
