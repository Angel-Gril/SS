import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import sharp from 'sharp';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared/ai-image-workbench-contract';

export class AiImageSandboxMediaError extends Error {
  readonly code = 'SANDBOX_MEDIA_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AiImageSandboxMediaError';
  }
}

export interface AiImageSandboxPinnedMedia {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  width: number;
  height: number;
  hasAlpha: boolean;
}

function invalidMedia(message: string): never {
  throw new AiImageSandboxMediaError(message);
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export async function loadPinnedAiImageSandboxMedia(input: {
  path: string;
  expectedSha256: string;
  label: string;
  requirePng?: boolean;
  maximumBytes?: number;
}): Promise<AiImageSandboxPinnedMedia> {
  const expectedSha256 = String(input.expectedSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    invalidMedia(`${input.label} digest is invalid`);
  }
  const maximumBytes = input.maximumBytes ?? AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes;
  if (
    !Number.isSafeInteger(maximumBytes)
    || maximumBytes <= 0
    || maximumBytes > AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes
  ) {
    invalidMedia('The aggregate source and mask bytes exceed the edit request limit');
  }
  const flags = constants.O_RDONLY
    | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(input.path, flags);
  } catch {
    invalidMedia(`${input.label} cannot be opened safely`);
  }

  let bytes: Buffer;
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile()
      || metadata.size <= 0
      || metadata.size > maximumBytes
    ) {
      invalidMedia(maximumBytes < AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes
        ? 'The aggregate source and mask bytes exceed the edit request limit'
        : `${input.label} must be a bounded regular file`);
    }
    const boundedBytes = Buffer.allocUnsafe(metadata.size + 1);
    let bytesRead = 0;
    while (bytesRead < boundedBytes.byteLength) {
      const result = await handle.read(
        boundedBytes,
        bytesRead,
        boundedBytes.byteLength - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    bytes = boundedBytes.subarray(0, bytesRead);
    if (bytesRead !== metadata.size) {
      invalidMedia(`${input.label} changed while it was being read`);
    }
  } finally {
    await handle.close();
  }

  if (sha256(bytes) !== expectedSha256) {
    invalidMedia(`${input.label} does not match its pinned digest`);
  }
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    metadata = await sharp(bytes, {
      animated: true,
      limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels,
    }).metadata();
  } catch {
    invalidMedia(`${input.label} is not a supported image`);
  }
  const mimeType = metadata.format === 'png' ? 'image/png'
    : metadata.format === 'jpeg' ? 'image/jpeg'
      : metadata.format === 'webp' ? 'image/webp'
        : null;
  if (
    !mimeType
    || (input.requirePng && mimeType !== 'image/png')
    || !metadata.width
    || !metadata.height
    || metadata.width > AI_IMAGE_WORKBENCH_LIMITS.maxDimension
    || metadata.height > AI_IMAGE_WORKBENCH_LIMITS.maxDimension
    || metadata.width * metadata.height > AI_IMAGE_WORKBENCH_LIMITS.maxPixels
    || Number(metadata.pages || 1) !== 1
  ) {
    invalidMedia(`${input.label} has unsupported media properties`);
  }
  return {
    bytes,
    mimeType,
    sha256: expectedSha256,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: Boolean(metadata.hasAlpha),
  };
}

export function assertAiImageSandboxEditMediaLimit(
  media: readonly AiImageSandboxPinnedMedia[],
) {
  const totalBytes = media.reduce((total, value) => total + value.bytes.byteLength, 0);
  if (totalBytes > AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes) {
    invalidMedia('The aggregate source and mask bytes exceed the edit request limit');
  }
}

export function remainingAiImageSandboxEditMediaBytes(
  media: readonly AiImageSandboxPinnedMedia[],
) {
  assertAiImageSandboxEditMediaLimit(media);
  return AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes
    - media.reduce((total, value) => total + value.bytes.byteLength, 0);
}

export async function assertMeaningfulAiImageSandboxMask(
  mask: AiImageSandboxPinnedMedia,
) {
  if (!mask.hasAlpha) {
    invalidMedia('The INPAINT mask must contain an alpha channel');
  }
  let alpha: Buffer;
  try {
    alpha = await sharp(mask.bytes, {
      limitInputPixels: AI_IMAGE_WORKBENCH_LIMITS.maxPixels,
    }).extractChannel('alpha').raw().toBuffer();
  } catch {
    invalidMedia('The INPAINT mask alpha channel could not be inspected');
  }
  let hasTransparent = false;
  let hasOpaque = false;
  for (const pixel of alpha) {
    if (pixel === 0) hasTransparent = true;
    if (pixel === 255) hasOpaque = true;
    if (hasTransparent && hasOpaque) return;
  }
  invalidMedia('The INPAINT mask must contain both transparent and opaque regions');
}
