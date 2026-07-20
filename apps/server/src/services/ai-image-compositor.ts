import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const AI_IMAGE_EDIT_MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1' as const;

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 12_000_000;
// Keep long pixel loops interruptible so worker lease heartbeats and cancellation timers run.
export const AI_IMAGE_COMPOSITOR_YIELD_INTERVAL = 65_536;
const ALLOWED_EDIT_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

type AiImageEditImageFormat = 'jpeg' | 'png' | 'webp';

export type AiImageCompositorErrorCode =
  | 'IMAGE_INPUT_INVALID'
  | 'IMAGE_FORMAT_INVALID'
  | 'IMAGE_INPUT_LIMIT_EXCEEDED'
  | 'COMPOSITE_OUTPUT_LIMIT_EXCEEDED'
  | 'MASK_FORMAT_INVALID'
  | 'MASK_DIMENSIONS_MISMATCH'
  | 'MASK_NOT_GRAYSCALE'
  | 'MASK_NOT_OPAQUE'
  | 'MASK_EMPTY_OR_FULL'
  | 'MASK_SEMANTICS_INVALID'
  | 'CANDIDATE_DIMENSIONS_MISMATCH';

export class AiImageCompositorError extends Error {
  constructor(public readonly code: AiImageCompositorErrorCode, message: string) {
    super(message);
    this.name = 'AiImageCompositorError';
  }
}

interface CompositorLimits {
  maxBytes?: number;
  maxPixels?: number;
  maxOutputBytes?: number;
  yieldToEventLoop?: () => Promise<void>;
}

export interface AiImageEditMaskDiagnostics {
  width: number;
  height: number;
  editPixelCount: number;
  preservedPixelCount: number;
  featheredPixelCount: number;
  maskSha256: string;
  maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
}

interface DecodedMask extends AiImageEditMaskDiagnostics {
  values: Buffer;
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function defaultYieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function normalizedLimits(input: CompositorLimits) {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxPixels = input.maxPixels ?? DEFAULT_MAX_PIXELS;
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) {
    throw new AiImageCompositorError('IMAGE_INPUT_LIMIT_EXCEEDED', 'Image byte limit is invalid');
  }
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > DEFAULT_MAX_PIXELS) {
    throw new AiImageCompositorError('IMAGE_INPUT_LIMIT_EXCEEDED', 'Image pixel limit is invalid');
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > DEFAULT_MAX_BYTES) {
    throw new AiImageCompositorError('IMAGE_INPUT_LIMIT_EXCEEDED', 'Composite output byte limit is invalid');
  }
  return { maxBytes, maxPixels, maxOutputBytes };
}

function assertBuffer(buffer: Buffer, label: string, maxBytes: number) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) {
    throw new AiImageCompositorError('IMAGE_INPUT_INVALID', `${label} image is empty`);
  }
  if (buffer.length > maxBytes) {
    throw new AiImageCompositorError('IMAGE_INPUT_LIMIT_EXCEEDED', `${label} image exceeds the byte limit`);
  }
}

async function decodeRgba(
  buffer: Buffer,
  label: string,
  limits: { maxBytes: number; maxPixels: number },
) {
  assertBuffer(buffer, label, limits.maxBytes);
  try {
    const metadata = await sharp(buffer, {
      animated: false,
      limitInputPixels: limits.maxPixels,
    }).metadata();
    if (!metadata.format || !ALLOWED_EDIT_IMAGE_FORMATS.has(metadata.format) || Number(metadata.pages || 1) !== 1) {
      throw new AiImageCompositorError(
        'IMAGE_FORMAT_INVALID',
        `${label} image must be a single-frame JPEG, PNG, or WebP image`,
      );
    }
    const decoded = await sharp(buffer, {
      animated: false,
      limitInputPixels: limits.maxPixels,
    })
      .autoOrient()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      decoded.info.width < 1
      || decoded.info.height < 1
      || decoded.info.width * decoded.info.height > limits.maxPixels
      || decoded.info.channels !== 4
    ) {
      throw new Error('invalid dimensions');
    }
    return {
      ...decoded,
      sourceFormat: metadata.format as AiImageEditImageFormat,
    };
  } catch (error) {
    if (error instanceof AiImageCompositorError) throw error;
    throw new AiImageCompositorError('IMAGE_INPUT_INVALID', `${label} image could not be decoded safely`);
  }
}

async function decodeMask(input: {
  maskBuffer: Buffer;
  expectedWidth: number;
  expectedHeight: number;
  maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
} & CompositorLimits): Promise<DecodedMask> {
  if (input.maskSemantics !== AI_IMAGE_EDIT_MASK_SEMANTICS) {
    throw new AiImageCompositorError(
      'MASK_SEMANTICS_INVALID',
      `Mask semantics must be ${AI_IMAGE_EDIT_MASK_SEMANTICS}`,
    );
  }
  const limits = normalizedLimits(input);
  if (
    !Number.isSafeInteger(input.expectedWidth)
    || !Number.isSafeInteger(input.expectedHeight)
    || input.expectedWidth < 1
    || input.expectedHeight < 1
    || input.expectedWidth * input.expectedHeight > limits.maxPixels
  ) {
    throw new AiImageCompositorError('MASK_DIMENSIONS_MISMATCH', 'Expected mask dimensions are invalid');
  }
  assertBuffer(input.maskBuffer, 'Mask', limits.maxBytes);

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  let decoded: Awaited<ReturnType<ReturnType<ReturnType<typeof sharp>['raw']>['toBuffer']>>;
  try {
    metadata = await sharp(input.maskBuffer, {
      animated: false,
      limitInputPixels: limits.maxPixels,
    }).metadata();
    if (metadata.format !== 'png' || Number(metadata.pages || 1) !== 1 || (metadata.orientation || 1) !== 1) {
      throw new AiImageCompositorError('MASK_FORMAT_INVALID', 'Edit mask must be a single-frame, unoriented PNG');
    }
    decoded = await sharp(input.maskBuffer, {
      animated: false,
      limitInputPixels: limits.maxPixels,
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof AiImageCompositorError) throw error;
    throw new AiImageCompositorError('MASK_FORMAT_INVALID', 'Edit mask could not be decoded safely');
  }
  if (decoded.info.width !== input.expectedWidth || decoded.info.height !== input.expectedHeight) {
    throw new AiImageCompositorError('MASK_DIMENSIONS_MISMATCH', 'Edit mask dimensions must match the source image');
  }

  const values = Buffer.alloc(input.expectedWidth * input.expectedHeight);
  const yieldToEventLoop = input.yieldToEventLoop || defaultYieldToEventLoop;
  let editPixelCount = 0;
  let preservedPixelCount = 0;
  let featheredPixelCount = 0;
  for (let pixel = 0; pixel < values.length; pixel += 1) {
    const offset = pixel * 4;
    const red = decoded.data[offset]!;
    const green = decoded.data[offset + 1]!;
    const blue = decoded.data[offset + 2]!;
    const alpha = decoded.data[offset + 3]!;
    if (alpha !== 255) {
      throw new AiImageCompositorError('MASK_NOT_OPAQUE', 'Edit mask must be fully opaque');
    }
    if (red !== green || red !== blue) {
      throw new AiImageCompositorError('MASK_NOT_GRAYSCALE', 'Edit mask must use grayscale pixels');
    }
    values[pixel] = red;
    if (red === 0) preservedPixelCount += 1;
    else {
      editPixelCount += 1;
      if (red !== 255) featheredPixelCount += 1;
    }
    if ((pixel + 1) % AI_IMAGE_COMPOSITOR_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }
  if (editPixelCount === 0 || preservedPixelCount === 0) {
    throw new AiImageCompositorError(
      'MASK_EMPTY_OR_FULL',
      'Inpaint mask must contain both an edit region and a preserved region',
    );
  }
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    editPixelCount,
    preservedPixelCount,
    featheredPixelCount,
    maskSha256: sha256(input.maskBuffer),
    maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    values,
  };
}

export async function validateAiImageEditMask(input: {
  maskBuffer: Buffer;
  expectedWidth: number;
  expectedHeight: number;
  maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
} & CompositorLimits): Promise<AiImageEditMaskDiagnostics> {
  const { values: _values, ...diagnostics } = await decodeMask(input);
  return diagnostics;
}

export async function validateAiImageEditCandidate(input: {
  buffer: Buffer;
  expectedWidth: number;
  expectedHeight: number;
} & CompositorLimits) {
  const limits = normalizedLimits(input);
  const decoded = await decodeRgba(input.buffer, 'Candidate', limits);
  if (decoded.info.width !== input.expectedWidth || decoded.info.height !== input.expectedHeight) {
    throw new AiImageCompositorError(
      'CANDIDATE_DIMENSIONS_MISMATCH',
      'Provider output dimensions must match the source image',
    );
  }
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    sha256: sha256(input.buffer),
    format: decoded.sourceFormat,
    mimeType: decoded.sourceFormat === 'jpeg' ? 'image/jpeg' : `image/${decoded.sourceFormat}`,
    extension: decoded.sourceFormat === 'jpeg' ? 'jpg' : decoded.sourceFormat,
  };
}

export async function composeAiImageInpaint(input: {
  sourceBuffer: Buffer;
  rawCandidateBuffer: Buffer;
  maskBuffer: Buffer;
  maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
} & CompositorLimits) {
  const limits = normalizedLimits(input);
  const source = await decodeRgba(input.sourceBuffer, 'Source', limits);
  const mask = await decodeMask({
    maskBuffer: input.maskBuffer,
    expectedWidth: source.info.width,
    expectedHeight: source.info.height,
    maskSemantics: input.maskSemantics,
    ...limits,
    yieldToEventLoop: input.yieldToEventLoop,
  });
  const candidate = await decodeRgba(input.rawCandidateBuffer, 'Raw candidate', limits);
  if (candidate.info.width !== source.info.width || candidate.info.height !== source.info.height) {
    throw new AiImageCompositorError(
      'CANDIDATE_DIMENSIONS_MISMATCH',
      'Raw provider output dimensions must match the source image',
    );
  }

  const output = Buffer.alloc(source.data.length);
  const yieldToEventLoop = input.yieldToEventLoop || defaultYieldToEventLoop;
  for (let pixel = 0; pixel < mask.values.length; pixel += 1) {
    const offset = pixel * 4;
    const weight = mask.values[pixel]!;
    if (weight === 0) {
      source.data.copy(output, offset, offset, offset + 4);
    } else if (weight === 255) {
      candidate.data.copy(output, offset, offset, offset + 4);
    } else {
      for (let channel = 0; channel < 4; channel += 1) {
        const sourceValue = source.data[offset + channel]!;
        const candidateValue = candidate.data[offset + channel]!;
        output[offset + channel] = Math.floor(
          (sourceValue * (255 - weight) + candidateValue * weight + 127) / 255,
        );
      }
    }
    if ((pixel + 1) % AI_IMAGE_COMPOSITOR_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }
  const buffer = await sharp(output, {
    raw: { width: source.info.width, height: source.info.height, channels: 4 },
  }).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
  if (buffer.length > limits.maxOutputBytes) {
    throw new AiImageCompositorError(
      'COMPOSITE_OUTPUT_LIMIT_EXCEEDED',
      'Composited image exceeds the encoded output byte limit',
    );
  }

  return {
    buffer,
    mimeType: 'image/png' as const,
    width: source.info.width,
    height: source.info.height,
    diagnostics: {
      editPixelCount: mask.editPixelCount,
      preservedPixelCount: mask.preservedPixelCount,
      featheredPixelCount: mask.featheredPixelCount,
      maskSemantics: mask.maskSemantics,
      sourceSha256: sha256(input.sourceBuffer),
      rawCandidateSha256: sha256(input.rawCandidateBuffer),
      maskSha256: mask.maskSha256,
      compositeSha256: sha256(buffer),
    },
  };
}
