import sharp from 'sharp';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  downloadPublicImage,
  type DownloadedPublicImage,
  type DownloadPublicImageOptions,
} from './source-public-image-download.js';

export const IMAGE_PROCESSING_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_PROCESSING_MAX_PIXELS = 40_000_000;
export const IMAGE_PROCESSING_MAX_SOURCE_EDGE = 16_384;
const IMAGE_PROCESSING_MAX_REDIRECTS = 5;
const IMAGE_PROCESSING_TIMEOUT_MS = 20_000;

interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
}

interface ImageSourceLoaderDependencies {
  download: (
    rawUrl: string,
    options: DownloadPublicImageOptions,
  ) => Promise<DownloadedPublicImage>;
  inspect: (buffer: Buffer, maxPixels: number) => Promise<ImageMetadata>;
  readLocal: (rawUrl: string, maxBytes: number) => Promise<DownloadedPublicImage>;
}

export interface BoundedImageSource extends DownloadedPublicImage {
  width: number;
  height: number;
  format: string;
}

const LOCAL_IMAGE_PATH = /^\/(uploads|watermarked|resized)\/([A-Za-z0-9_.-]+)$/u;

function localImagePath(rawUrl: string): string | null {
  const text = String(rawUrl || '').trim();
  let pathname = text;
  if (!text.startsWith('/') || text.startsWith('//')) {
    let url: URL;
    try {
      url = new URL(text.startsWith('//') ? `https:${text}` : text);
    } catch {
      return null;
    }
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) return null;
    pathname = url.pathname;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new Error('Owned local image path is invalid');
  }
  if (!LOCAL_IMAGE_PATH.test(decoded)) throw new Error('Owned local image path is invalid');
  return decoded;
}

function localContentType(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export function createOwnedLocalImageReader(publicRoot: string) {
  const resolvedPublicRoot = resolve(publicRoot);
  return async function readOwnedLocalImage(
    rawUrl: string,
    maxBytes: number,
  ): Promise<DownloadedPublicImage> {
    const pathname = localImagePath(rawUrl);
    if (!pathname) throw new Error('Owned local image path is invalid');
    const match = pathname.match(LOCAL_IMAGE_PATH)!;
    const root = resolve(resolvedPublicRoot, match[1]!);
    const target = resolve(join(root, match[2]!));
    if (target !== join(root, match[2]!)) throw new Error('Owned local image path is invalid');
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Owned local image must be a regular file');
    if (info.size < 1 || info.size > maxBytes) throw new Error(`Owned local image exceeds ${maxBytes} bytes`);
    const buffer = await readFile(target);
    if (buffer.length > maxBytes) throw new Error(`Owned local image exceeds ${maxBytes} bytes`);
    return {
      sourceUrl: pathname,
      finalUrl: pathname,
      contentType: localContentType(match[2]!),
      buffer,
      redirectCount: 0,
    };
  };
}

const readOwnedLocalImage = createOwnedLocalImageReader(resolve(process.cwd(), 'public'));

const defaultDependencies: ImageSourceLoaderDependencies = {
  download: downloadPublicImage,
  inspect: async (buffer, maxPixels) => sharp(buffer, { limitInputPixels: maxPixels }).metadata(),
  readLocal: readOwnedLocalImage,
};

export function createImageSourceLoader(
  overrides: Partial<ImageSourceLoaderDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function load(rawUrl: string): Promise<BoundedImageSource> {
    const localPath = localImagePath(rawUrl);
    const downloaded = localPath
      ? await dependencies.readLocal(localPath, IMAGE_PROCESSING_MAX_BYTES)
      : await dependencies.download(rawUrl, {
        maxBytes: IMAGE_PROCESSING_MAX_BYTES,
        maxRedirects: IMAGE_PROCESSING_MAX_REDIRECTS,
        timeoutMs: IMAGE_PROCESSING_TIMEOUT_MS,
      });
    const metadata = await dependencies.inspect(downloaded.buffer, IMAGE_PROCESSING_MAX_PIXELS);
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || !metadata.format) {
      throw new Error('Source image metadata is invalid');
    }
    if (width > IMAGE_PROCESSING_MAX_SOURCE_EDGE
      || height > IMAGE_PROCESSING_MAX_SOURCE_EDGE
      || width * height > IMAGE_PROCESSING_MAX_PIXELS) {
      throw new Error('Source image dimensions or pixels exceed processing limits');
    }
    return { ...downloaded, width, height, format: metadata.format };
  };
}

export const loadBoundedImageSource = createImageSourceLoader();
