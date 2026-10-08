import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared/ai-image-workbench-contract';
import { AiImageJobError } from './ai-image-job-error.js';
import { AI_IMAGE_DONOR_GPT2_COUNT_API_BASE, AI_IMAGE_DONOR_GPT2_COUNT_MODEL } from './ai-image-donor-gpt2-profile.js';
import { normalizeOpenAiImagesApiBase } from './ai-image-openai-url.js';
import type { AiImageProviderRequest } from './ai-image-jobs.js';
import type { OpenAiImageEditRequest } from './ai-image-providers.js';

import { AI_IMAGE_GPT2_COUNT_ORDINARY_NORMALIZER_VERSION } from './ai-image-gpt2-count-contract.js';
export {
  AI_IMAGE_GPT2_COUNT_ORDINARY_EDIT_REQUEST_PROFILE,
  AI_IMAGE_GPT2_COUNT_GENERATION_REQUEST_PROFILE,
  AI_IMAGE_GPT2_COUNT_ORDINARY_MULTIPART_DIALECT,
  AI_IMAGE_GPT2_COUNT_ORDINARY_NORMALIZER_VERSION,
} from './ai-image-gpt2-count-contract.js';

// Adapter candidates are not evidence of production capability. The capability
// owner admits only operations/canvases independently verified on this endpoint.
export const AI_IMAGE_GPT2_COUNT_ORDINARY_SIZES = Object.freeze([
  '1024x1024', '1024x1536', '1536x1024', '1008x1344', '900x1200',
]);
const ordinarySizes = new Set(AI_IMAGE_GPT2_COUNT_ORDINARY_SIZES);

export function isGptImage2CountOrdinarySizeSupported(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && ordinarySizes.has(`${width}x${height}`);
}

function invalid(message: string): never {
  throw new AiImageJobError('INVALID_MEDIA_INPUT', message);
}

export function assertGptImage2CountProviderIdentity(baseUrl: string, model: string): void {
  if (normalizeOpenAiImagesApiBase(baseUrl) !== AI_IMAGE_DONOR_GPT2_COUNT_API_BASE
    || model !== AI_IMAGE_DONOR_GPT2_COUNT_MODEL) {
    throw new AiImageJobError('UNSUPPORTED_PROVIDER_MODEL', 'GPT Image 2 count requires its exact configured model and API base');
  }
}

function assertCountPromptAndCanvas(input: { model?: string; prompt: string; negativePrompt: string | null; width: number; height: number }) {
  if (input.model !== undefined && input.model !== AI_IMAGE_DONOR_GPT2_COUNT_MODEL) {
    invalid('GPT Image 2 count requires its exact model');
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim()
    || input.prompt.length > AI_IMAGE_WORKBENCH_LIMITS.maxPromptCharacters
    || (input.negativePrompt !== null && input.negativePrompt !== undefined
      && (typeof input.negativePrompt !== 'string' || input.negativePrompt.length > AI_IMAGE_WORKBENCH_LIMITS.maxNegativePromptCharacters))) {
    invalid('GPT Image 2 count prompt must satisfy the bounded image workbench contract');
  }
  if (!isGptImage2CountOrdinarySizeSupported(input.width, input.height)) {
    invalid('GPT Image 2 count output canvas is not supported');
  }
  if ('wanxEditStrength' in input) invalid('GPT Image 2 count does not accept Wanx options');
}

export function assertGptImage2CountGenerationRequest(request: AiImageProviderRequest): void {
  assertCountPromptAndCanvas(request);
  if ((request.operation !== undefined && request.operation !== 'TEXT_TO_IMAGE') || request.count !== 1
    || request.inputImages?.length || request.inputAssets?.length || request.mask) {
    invalid('GPT Image 2 count text generation requires one output and no edit inputs');
  }
}

export async function assertGptImage2CountOrdinaryEditRequest(request: OpenAiImageEditRequest): Promise<void> {
  assertCountPromptAndCanvas(request);
  if (!['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(request.operation)
    || !Array.isArray(request.images) || request.images.length !== 1) {
    invalid('GPT Image 2 count ordinary edit requires exactly one source image and an explicit edit operation');
  }
  const source = request.images[0]!;
  if (!source || !Buffer.isBuffer(source.buffer) || !source.buffer.length
    || (request.mask && (!Buffer.isBuffer(request.mask.buffer) || !request.mask.buffer.length))) {
    invalid('GPT Image 2 count input bytes are invalid');
  }
  if (source.buffer.length + (request.mask?.buffer.length || 0) > AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes) {
    invalid('GPT Image 2 count inputs exceed the image workbench byte budget');
  }
  let sourceDimensions: { width: number; height: number } | undefined;
  try {
    const metadata = await sharp(source.buffer, { animated: false, failOn: 'warning', limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels }).metadata();
    if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format || '')
      || Number(metadata.pages ?? 1) !== 1 || metadata.delay?.length) {
      invalid('GPT Image 2 count source must be one decodable still image');
    }
    sourceDimensions = { width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error instanceof AiImageJobError) throw error;
    invalid('GPT Image 2 count source cannot be safely decoded');
  }
  if (request.operation !== 'INPAINT') return;
  if (!request.mask || request.mask.mimeType !== 'image/png' || !Buffer.isBuffer(request.mask.buffer)) {
    invalid('GPT Image 2 count inpaint requires one alpha PNG mask');
  }
  try {
    const mask = sharp(request.mask.buffer, { animated: false, failOn: 'warning', limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels });
    const metadata = await mask.metadata();
    if (metadata.format !== 'png' || !metadata.hasAlpha || Number(metadata.pages ?? 1) !== 1
      || metadata.width !== sourceDimensions?.width || metadata.height !== sourceDimensions.height
      || metadata.width !== request.width || metadata.height !== request.height) {
      invalid('GPT Image 2 count inpaint source, alpha mask and request canvas must match');
    }
    const stats = await mask.stats();
    if (!stats.channels.length || stats.channels.at(-1)!.min === 255) {
      invalid('GPT Image 2 count inpaint mask must contain a transparent edit region');
    }
  } catch (error) {
    if (error instanceof AiImageJobError) throw error;
    invalid('GPT Image 2 count inpaint mask cannot be safely decoded');
  }
}

export interface NormalizedGptImage2CountEditOutput {
  buffer: Buffer;
  mimeType: 'image/png';
  width: number;
  height: number;
  sha256: string;
  normalizerVersion: typeof AI_IMAGE_GPT2_COUNT_ORDINARY_NORMALIZER_VERSION;
  providerOutput: { width: number; height: number };
}

/** Retain the original Provider artifact separately; these bytes describe a derived canvas. */
export async function normalizeGptImage2CountEditOutput(
  input: { buffer: Buffer; mimeType: string },
  expectedWidth: number,
  expectedHeight: number,
): Promise<NormalizedGptImage2CountEditOutput> {
  const invalidOutput = () => new AiImageJobError('INVALID_PROVIDER_RESULT', 'GPT Image 2 count output does not satisfy its bounded canvas profile');
  if (!Buffer.isBuffer(input?.buffer) || !input.buffer.length || input.buffer.length > AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes
    || !isGptImage2CountOrdinarySizeSupported(expectedWidth, expectedHeight)) {
    throw invalidOutput();
  }
  const declaredMime = String(input.mimeType || '').split(';')[0]!.trim().toLowerCase().replace(/^image\/jpg$/u, 'image/jpeg');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(declaredMime)) throw invalidOutput();
  try {
    const decoder = sharp(input.buffer, { animated: false, failOn: 'warning', limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels });
    const metadata = await decoder.metadata();
    const decodedMime = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
    const exact = metadata.width === expectedWidth && metadata.height === expectedHeight;
    const observedRounding = expectedWidth === 900 && expectedHeight === 1200 && metadata.width === 896 && metadata.height === 1200;
    if (decodedMime !== declaredMime || Number(metadata.pages ?? 1) !== 1 || metadata.delay?.length
      || (metadata.orientation !== undefined && metadata.orientation >= 5) || (!exact && !observedRounding)) {
      throw invalidOutput();
    }
    // The only rounded output admitted here is the observed four-column loss.
    // Its explicit width interpolation preserves every edge without white
    // padding or cropping; suite portrait outputs retain their separate owner.
    const buffer = await decoder.toColourspace('srgb').resize({ width: expectedWidth, height: expectedHeight,
      fit: 'fill', kernel: sharp.kernel.lanczos3, fastShrinkOnLoad: false })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, progressive: false }).toBuffer();
    if (buffer.length > AI_IMAGE_WORKBENCH_LIMITS.maxResultBytes) throw invalidOutput();
    return { buffer, mimeType: 'image/png', width: expectedWidth, height: expectedHeight,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      normalizerVersion: AI_IMAGE_GPT2_COUNT_ORDINARY_NORMALIZER_VERSION,
      providerOutput: { width: metadata.width!, height: metadata.height! } };
  } catch (error) {
    if (error instanceof AiImageJobError) throw error;
    throw invalidOutput();
  }
}
