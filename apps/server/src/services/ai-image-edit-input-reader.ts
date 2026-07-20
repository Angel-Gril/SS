import { open } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { AI_IMAGE_EDIT_MAX_INPUT_BYTES } from './ai-image-edit.js';
import { AiImageJobError, type AiImageJobRecord } from './ai-image-jobs.js';

type FrozenInputAsset = NonNullable<AiImageJobRecord['inputAssets']>[number];

const LOCAL_UPLOAD_ROOT = resolve(process.cwd(), 'public', 'uploads');

function exactStorageKey(value: unknown) {
  const key = String(value || '').normalize('NFKC').trim();
  if (!key || key.length > 2_000 || key.includes('\0')) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen edit storage key is invalid');
  }
  return key;
}

function frozenInputSize(value: unknown): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > AI_IMAGE_EDIT_MAX_INPUT_BYTES) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen edit input size is invalid');
  }
  return size;
}

function frozenSizeMismatch(): AiImageJobError {
  return new AiImageJobError(
    'FROZEN_INPUT_MISMATCH',
    'Stored edit input size does not match the frozen asset identity',
  );
}

export async function readBoundedAiImageEditFile(
  path: string,
  expectedSizeValue: number,
): Promise<Buffer> {
  const expectedSize = frozenInputSize(expectedSizeValue);
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > AI_IMAGE_EDIT_MAX_INPUT_BYTES) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen local edit input is empty or too large');
    }
    if (stat.size !== expectedSize) throw frozenSizeMismatch();

    const buffer = Buffer.allocUnsafe(expectedSize);
    let offset = 0;
    while (offset < expectedSize) {
      const { bytesRead } = await handle.read(buffer, offset, expectedSize - offset, offset);
      if (bytesRead < 1) throw frozenSizeMismatch();
      offset += bytesRead;
    }
    const sentinel = Buffer.allocUnsafe(1);
    const { bytesRead: extraBytes } = await handle.read(sentinel, 0, 1, expectedSize);
    if (extraBytes !== 0) throw frozenSizeMismatch();
    return buffer;
  } finally {
    await handle.close();
  }
}

function streamChunkBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen OSS edit input stream is invalid');
}

export async function readBoundedAiImageEditStream(
  stream: AsyncIterable<unknown>,
  expectedSizeValue: number,
): Promise<Buffer> {
  const expectedSize = frozenInputSize(expectedSizeValue);
  const buffer = Buffer.allocUnsafe(expectedSize);
  let offset = 0;
  for await (const value of stream) {
    const chunk = streamChunkBuffer(value);
    if (!chunk.length) continue;
    const remaining = expectedSize - offset;
    if (remaining < 1 || chunk.length > remaining) throw frozenSizeMismatch();
    chunk.copy(buffer, offset);
    offset += chunk.length;
  }
  if (offset !== expectedSize) throw frozenSizeMismatch();
  return buffer;
}

function ossBodyStream(body: unknown): AsyncIterable<unknown> {
  const direct = body as AsyncIterable<unknown> | null;
  if (direct && typeof direct[Symbol.asyncIterator] === 'function') return direct;
  const webStream = (body as { transformToWebStream?: () => unknown } | null)
    ?.transformToWebStream?.() as AsyncIterable<unknown> | null;
  if (webStream && typeof webStream[Symbol.asyncIterator] === 'function') return webStream;
  throw new AiImageJobError('EDIT_STORAGE_NOT_READY', 'OSS input reader did not return a bounded stream');
}

async function defaultReadOssObject(key: string, expectedSizeValue: number): Promise<Buffer> {
  const expectedSize = frozenInputSize(expectedSizeValue);
  const runtime = await getRuntimeConfigForStorage();
  const config = runtime.oss;
  if (!config?.endpoint || !config.bucket || !config.accessKeyId || !config.accessKeySecret) {
    throw new AiImageJobError('EDIT_STORAGE_NOT_READY', 'OSS input reader is not configured');
  }
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const endpoint = config.endpoint.startsWith('http') ? config.endpoint : `https://${config.endpoint}`;
  const client = new S3Client({
    endpoint,
    region: config.region || 'auto',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret,
    },
    forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
  });
  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Range: `bytes=0-${expectedSize}`,
    }));
    const contentLength = result.ContentLength == null ? null : Number(result.ContentLength);
    if (!result.Body || (contentLength != null && (
      !Number.isSafeInteger(contentLength)
      || contentLength < 1
      || contentLength > AI_IMAGE_EDIT_MAX_INPUT_BYTES
    ))) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen OSS edit input is empty or too large');
    }
    if (contentLength != null && contentLength !== expectedSize) throw frozenSizeMismatch();
    return await readBoundedAiImageEditStream(ossBodyStream(result.Body), expectedSize);
  } finally {
    client.destroy();
  }
}

export async function loadAiImageEditInputBuffer(
  asset: FrozenInputAsset,
  overrides: {
    readLocalFile?: (path: string, expectedSize: number) => Promise<Buffer>;
    readOssObject?: (key: string, expectedSize: number) => Promise<Buffer>;
  } = {},
) {
  const key = exactStorageKey(asset.storageKey);
  const expectedSize = frozenInputSize(asset.sizeBytes);
  let buffer: Buffer;
  if (asset.storageBackend === 'local') {
    if (basename(key) !== key || key.includes('/') || key.includes('\\')) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Local edit input storage key must be a filename');
    }
    const path = resolve(join(LOCAL_UPLOAD_ROOT, key));
    if (!path.startsWith(`${LOCAL_UPLOAD_ROOT}\\`) && !path.startsWith(`${LOCAL_UPLOAD_ROOT}/`)) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Local edit input escaped the trusted upload root');
    }
    buffer = await (overrides.readLocalFile || readBoundedAiImageEditFile)(path, expectedSize);
  } else if (asset.storageBackend === 'oss') {
    buffer = await (overrides.readOssObject || defaultReadOssObject)(key, expectedSize);
  } else {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Edit inputs must use trusted local or OSS storage');
  }
  if (!Buffer.isBuffer(buffer)) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen edit input reader returned invalid bytes');
  }
  if (buffer.length !== expectedSize) throw frozenSizeMismatch();
  return buffer;
}
