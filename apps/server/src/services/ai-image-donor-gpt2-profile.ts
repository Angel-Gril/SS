import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { normalizeOpenAiImagesApiBase } from './ai-image-openai-url.js';

export const AI_IMAGE_DONOR_GPT2_REQUEST_PROFILE = 'DONOR_GPT_IMAGE_2_PORTRAIT_EDIT_V1' as const;
export const AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION = 'ai-image-donor-gpt2-output-normalizer/v1' as const;
export const AI_IMAGE_DONOR_GPT2_COUNT_MODEL = 'gpt-image-2-count';
export const AI_IMAGE_DONOR_GPT2_COUNT_API_BASE = 'https://ai.big-model-api.top/v1';
/** The count service also returned an independently decoded 1086x1448 frame
 * for the frozen 1008x1344 request. Both preserve the exact 3:4 full frame. */
export function isDonorGpt2ProviderOutputSize(width: unknown, height: unknown): boolean {
  return (width === 1008 && height === 1344) || (width === 1086 && height === 1448);
}
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_METADATA_PIXELS = 16_000_000;
export const AI_IMAGE_DONOR_GPT2_PROFILE = Object.freeze({
  requestProfile: AI_IMAGE_DONOR_GPT2_REQUEST_PROFILE, model: 'gpt-image-2',
  width: 1008, height: 1344, quality: 'high', count: 1, minReferences: 1, maxReferences: 16,
  transport: 'multipart', endpointPath: '/images/edits',
} as const);
export function isDonorGpt2SuiteProvider(provider: string, model: string): boolean {
  return provider === 'custom' && [AI_IMAGE_DONOR_GPT2_PROFILE.model,AI_IMAGE_DONOR_GPT2_COUNT_MODEL].includes(model);
}
export function validDonorGpt2SuiteConfig(config: any): boolean {
  const expected = createDonorGpt2FullFrameConfig();
  return config?.requestProfile === expected.requestProfile && config.referenceCanvas === undefined
    && Object.keys(config.providerRequest || {}).length === Object.keys(expected.providerRequest).length
    && Object.entries(expected.providerRequest).every(([key, value]) => config.providerRequest[key] === value)
    && Object.keys(config.finalOutput || {}).length === Object.keys(expected.finalOutput).length
    && Object.entries(expected.finalOutput).every(([key, value]) => config.finalOutput[key] === value);
}

type ProfileErrorCode = 'DONOR_GPT2_REQUEST_INVALID' | 'PROVIDER_OUTPUT_INVALID_IMAGE' | 'PROVIDER_OUTPUT_TOO_LARGE'
  | 'PROVIDER_OUTPUT_UNSUPPORTED_MIME' | 'PROVIDER_OUTPUT_MIME_MISMATCH' | 'PROVIDER_OUTPUT_MULTIPAGE'
  | 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH' | 'PROVIDER_OUTPUT_NORMALIZATION_FAILED';
export class AiImageDonorGpt2ProfileError extends Error {
  constructor(public readonly code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'AiImageDonorGpt2ProfileError';
  }
}

export function assertDonorGpt2ImageToImageRequest(input: {
  model: string; operation: string; width: number; height: number; count: number; referenceCount: number; quality: string;
}): void {
  if (![AI_IMAGE_DONOR_GPT2_PROFILE.model,AI_IMAGE_DONOR_GPT2_COUNT_MODEL].includes(input.model) || input.operation !== 'IMAGE_TO_IMAGE'
    || input.width !== AI_IMAGE_DONOR_GPT2_PROFILE.width || input.height !== AI_IMAGE_DONOR_GPT2_PROFILE.height
    || input.count !== 1 || input.quality !== 'high' || !Number.isSafeInteger(input.referenceCount)
    || input.referenceCount < 1 || input.referenceCount > 16) {
    throw new AiImageDonorGpt2ProfileError('DONOR_GPT2_REQUEST_INVALID', 'Donor GPT Image 2 requires the exact portrait edit profile');
  }
}
export function assertDonorGpt2ProviderModel(apiBase:string,model:string):void {
  const normalized=normalizeOpenAiImagesApiBase(apiBase);
  if (model !== AI_IMAGE_DONOR_GPT2_PROFILE.model
    && !(model === AI_IMAGE_DONOR_GPT2_COUNT_MODEL && normalized === AI_IMAGE_DONOR_GPT2_COUNT_API_BASE)) {
    throw new AiImageDonorGpt2ProfileError('DONOR_GPT2_REQUEST_INVALID','The configured image model must match its explicit Provider profile');
  }
}

/** URL syntax only. Network allowlisting, DNS/IP checks and credential ownership remain in their existing owners. */
export function donorGpt2EditEndpoint(apiBase: string): string {
  if (typeof apiBase !== 'string' || !apiBase.trim()) {
    throw new AiImageDonorGpt2ProfileError('DONOR_GPT2_REQUEST_INVALID', 'An explicit Provider API base is required');
  }
  return `${normalizeOpenAiImagesApiBase(apiBase)}${AI_IMAGE_DONOR_GPT2_PROFILE.endpointPath}`;
}

export function createDonorGpt2FullFrameConfig() {
  return {
    version: 'donor-gpt2-full-frame/v1' as const, requestProfile: AI_IMAGE_DONOR_GPT2_REQUEST_PROFILE,
    providerRequest: { count: 1 as const, width: 1008 as const, height: 1344 as const, quality: 'high' as const },
    finalOutput: { profile: 'ozon-suite-3x4-900x1200/v1' as const, width: 900 as const, height: 1200 as const,
      fit: 'full-frame' as const, background: '#ffffff' as const, format: 'png' as const,
      normalizerVersion: AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION },
  };
}

type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
function magicMime(buffer: Buffer): ImageMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export interface NormalizedDonorGpt2ProviderOutput {
  buffer: Buffer;
  mimeType: 'image/png';
  width: 900;
  height: 1200;
  sha256: string;
  normalizerVersion: typeof AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION;
  providerOutput: { width: number; height: number };
}

/** Only the requested and independently verified frames are admitted. */
export async function normalizeDonorGpt2ProviderOutput(input: { buffer: Buffer; mimeType: string }): Promise<NormalizedDonorGpt2ProviderOutput> {
  if (!Buffer.isBuffer(input?.buffer) || input.buffer.length < 1) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_INVALID_IMAGE', 'Provider output bytes are empty or invalid');
  }
  if (input.buffer.length > MAX_IMAGE_BYTES) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_TOO_LARGE', 'Provider output exceeds 20 MiB');
  }
  const declared = String(input.mimeType || '').split(';')[0]!.trim().toLowerCase().replace(/^image\/jpg$/u, 'image/jpeg');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(declared)) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_UNSUPPORTED_MIME', 'Provider output must be PNG, JPEG or WebP');
  }
  const magic = magicMime(input.buffer);
  if (!magic) throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_INVALID_IMAGE', 'Provider output lacks supported image magic');
  if (declared !== magic) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_MIME_MISMATCH', 'Provider output MIME and magic disagree');
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(input.buffer, { animated: false, failOn: 'warning', limitInputPixels: MAX_METADATA_PIXELS }).metadata();
  } catch {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_INVALID_IMAGE', 'Provider output cannot be safely decoded');
  }
  const decodedMime = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
  if (decodedMime !== magic) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_MIME_MISMATCH', 'Provider output decoded format and magic disagree');
  }
  if (Number(metadata.pages ?? 1) !== 1 || (Array.isArray(metadata.delay) && metadata.delay.length > 0)) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_MULTIPAGE', 'Provider output must be one still frame');
  }
  if (!isDonorGpt2ProviderOutputSize(metadata.width, metadata.height)
    || (metadata.orientation !== undefined && metadata.orientation >= 5)) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', 'Provider output must be a verified upright 3:4 frame (1008x1344 or 1086x1448)');
  }
  let normalized: Buffer;
  try {
    // A width-only resize derives height from the verified ratio. It cannot
    // introduce canvas padding, crop an edge or apply unequal X/Y scale.
    normalized = await sharp(input.buffer, { animated: false, failOn: 'warning', limitInputPixels: metadata.width! * metadata.height! })
      .autoOrient().toColourspace('srgb')
      .resize({ width: 900, kernel: sharp.kernel.lanczos3, fastShrinkOnLoad: false })
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, progressive: false }).toBuffer();
    const result = await sharp(normalized, { limitInputPixels: 900 * 1200 }).metadata();
    if (result.format !== 'png' || result.width !== 900 || result.height !== 1200) throw new Error('Invalid normalized frame');
  } catch {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_NORMALIZATION_FAILED', 'Provider output cannot be normalized to the full frame');
  }
  if (normalized.length > MAX_IMAGE_BYTES) {
    throw new AiImageDonorGpt2ProfileError('PROVIDER_OUTPUT_TOO_LARGE', 'Normalized output exceeds 20 MiB');
  }
  return { buffer: normalized, mimeType: 'image/png', width: 900, height: 1200,
    sha256: createHash('sha256').update(normalized).digest('hex'),
    normalizerVersion: AI_IMAGE_DONOR_GPT2_NORMALIZER_VERSION,
    providerOutput: { width: metadata.width!, height: metadata.height! } };
}
