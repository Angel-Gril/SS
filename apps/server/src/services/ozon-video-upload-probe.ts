import type { ImageStorageBackend } from './image-storage.js';

export const OZON_VIDEO_PROBE_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_OZON_VIDEO_PROBE_FILENAME = 'ss-erp-ozon-video-probe.mp4';

// Small MP4 container-like payload. The route also accepts a real local MP4 dataUrl,
// which is the preferred probe when Ozon performs strict media validation.
const DEFAULT_OZON_VIDEO_PROBE_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
  0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65,
  0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
]);
export const DEFAULT_OZON_VIDEO_PROBE_BUFFER = Buffer.concat([
  DEFAULT_OZON_VIDEO_PROBE_HEADER,
  Buffer.alloc(1024 - DEFAULT_OZON_VIDEO_PROBE_HEADER.length, 0),
]);

export interface OzonVideoProbePayload {
  buffer: Buffer;
  filename: string;
  mimeType: 'video/mp4';
}

export interface ParsedOzonVideoAsset {
  videoBucket: string;
  videoId: string;
  assetName: string;
  assetUrl: string;
  masterUrl: string;
  coverUrl: string;
}

export type OzonVideoProbeStatus =
  | 'auto_publish_ready'
  | 'uploaded_temp_video_url'
  | 'uploaded_not_video_asset'
  | 'upload_failed';

export interface OzonVideoUploadProbeResult {
  ok: boolean;
  status: OzonVideoProbeStatus;
  message: string;
  uploadedUrl?: string;
  uploadedFilename?: string;
  backend?: string;
  videoAsset?: ParsedOzonVideoAsset;
}

export interface ProbeOzonVideoUploadInput {
  backend: ImageStorageBackend;
  buffer?: Buffer;
  filename?: string;
  mimeType?: 'video/mp4';
  ownerId?: string;
}

export function parseOzonVideoAssetUrl(rawUrl: unknown): ParsedOzonVideoAsset | null {
  const text = String(rawUrl || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!/^(?:cdnvideo\.v\.ozone\.ru|v-\d+\.ozone\.ru)$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^\/vod\/(video-\d+)\/([A-Z0-9]+)\/([^/]+\.mp4)$/i);
    if (!match) return null;
    const [, videoBucket, videoId, assetName] = match;
    if (!videoBucket || !videoId || !assetName) return null;
    const basePath = `/vod/${videoBucket}/${videoId}`;
    return {
      videoBucket,
      videoId,
      assetName,
      assetUrl: `${parsed.origin}${basePath}/${assetName}`,
      masterUrl: `${parsed.origin}${basePath}/master.m3u8`,
      coverUrl: `https://ir.ozone.ru/s3/${videoBucket}/${videoId}/cover/cover.jpg`,
    };
  } catch {
    return null;
  }
}

function isOzonTemporaryVideoUrl(rawUrl: unknown): boolean {
  const text = String(rawUrl || '').trim();
  if (!text) return false;
  try {
    const parsed = new URL(text);
    return /^cdn\d*\.ozone\.ru$/i.test(parsed.hostname)
      && /^\/s3\/sc-temporary\/.+\.mp4$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function parseOzonVideoProbeDataUrl(
  dataUrl: unknown,
  filename?: unknown,
  maxBytes = OZON_VIDEO_PROBE_MAX_BYTES,
): OzonVideoProbePayload {
  const text = String(dataUrl || '').trim();
  const match = /^data:(video\/[a-z0-9+.-]+);base64,([\s\S]+)$/i.exec(text);
  if (!match) {
    throw new Error('dataUrl 格式错误，需为 data:video/mp4;base64,...');
  }
  const mimeType = match[1]!.toLowerCase();
  if (mimeType !== 'video/mp4') {
    throw new Error('第一版视频探针仅支持 video/mp4');
  }
  const base64 = match[2]!.replace(/\s+/g, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('视频文件为空');
  if (buffer.length > maxBytes) {
    throw new Error(`视频探针文件超出 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`);
  }
  const safeFilename = safeProbeFilename(filename) || DEFAULT_OZON_VIDEO_PROBE_FILENAME;
  return { buffer, filename: safeFilename, mimeType: 'video/mp4' };
}

export async function probeOzonVideoUpload(
  input: ProbeOzonVideoUploadInput,
): Promise<OzonVideoUploadProbeResult> {
  const buffer = input.buffer || DEFAULT_OZON_VIDEO_PROBE_BUFFER;
  const filename = safeProbeFilename(input.filename) || DEFAULT_OZON_VIDEO_PROBE_FILENAME;
  const mimeType = input.mimeType || 'video/mp4';

  try {
    const uploaded = await input.backend.uploadBuffer(buffer, filename, mimeType, {
      category: 'video',
      ownerId: input.ownerId,
    });
    const videoAsset = parseOzonVideoAssetUrl(uploaded.url);
    if (videoAsset) {
      return {
        ok: true,
        status: 'auto_publish_ready',
        message: 'Ozon 返回了官方视频资产，可用于后续自动生成商品视频媒体属性',
        uploadedUrl: uploaded.url,
        uploadedFilename: uploaded.filename,
        backend: uploaded.backend,
        videoAsset,
      };
    }
    if (isOzonTemporaryVideoUrl(uploaded.url)) {
      return {
        ok: true,
        status: 'uploaded_temp_video_url',
        message: 'Ozon 返回了 Seller 临时视频 URL，可作为商品视频属性 21841 随商品提交，Ozon 后续会处理视频素材',
        uploadedUrl: uploaded.url,
        uploadedFilename: uploaded.filename,
        backend: uploaded.backend,
      };
    }
    return {
      ok: false,
      status: 'uploaded_not_video_asset',
      message: '上传成功，但返回 URL 不是 Ozon 商品视频资产，暂不能自动挂到商品视频字段',
      uploadedUrl: uploaded.url,
      uploadedFilename: uploaded.filename,
      backend: uploaded.backend,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 'upload_failed',
      message: formatProbeUploadError(error),
    };
  }
}

function safeProbeFilename(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const base = text.split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[^\w.\-]/g, '_').slice(0, 120);
  if (!cleaned) return null;
  return /\.mp4$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
}

function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error || 'unknown');
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function formatProbeUploadError(error: unknown): string {
  const text = shortError(error);
  if (/too small|меньше допустимого|<\s*512/i.test(text)) {
    return `Ozon 视频探针上传失败：文件小于 Ozon 最小限制。请点击“选择本地 MP4”使用真实视频测试。原始错误: ${text}`;
  }
  if (/wrong_content_type|content[-_ ]?type/i.test(text)) {
    return `Ozon 视频探针上传失败：图片 CDN 接口不支持视频上传。当前通道不是 Ozon 商品视频处理管线，下一步需要抓取 Seller 后台视频上传接口。原始错误: ${text}`;
  }
  return `Ozon 视频探针上传失败: ${text}`;
}
