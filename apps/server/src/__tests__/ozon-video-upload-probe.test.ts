import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OZON_VIDEO_PROBE_BUFFER,
  parseOzonVideoProbeDataUrl,
  probeOzonVideoUpload,
} from '../services/ozon-video-upload-probe.js';
import type { ImageStorageBackend } from '../services/image-storage.js';

function makeBackend(url: string): ImageStorageBackend {
  return {
    upload: vi.fn(),
    uploadBuffer: vi.fn(async (_buffer: Buffer, filename: string, mimeType?: string) => ({
      url,
      filename,
      backend: 'ozon-cdn' as const,
      mimeType,
    })),
  };
}

describe('ozon video upload probe', () => {
  it('uses a default automatic probe payload above the Ozon minimum size', () => {
    expect(DEFAULT_OZON_VIDEO_PROBE_BUFFER.length).toBeGreaterThanOrEqual(512);
  });

  it('marks Ozon video CDN asset urls as auto-publish ready', async () => {
    const backend = makeBackend('https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4?type=pdp');

    const result = await probeOzonVideoUpload({
      backend,
      buffer: Buffer.from('video'),
      filename: 'probe.mp4',
      ownerId: 'user-1',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'auto_publish_ready',
      uploadedUrl: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4?type=pdp',
      videoAsset: {
        videoBucket: 'video-64',
        videoId: '01KF0S7TY54CCQ9SZCCMQAM1RS',
        assetUrl: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4',
        masterUrl: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/master.m3u8',
        coverUrl: 'https://ir.ozone.ru/s3/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/cover/cover.jpg',
      },
    });
    expect(backend.uploadBuffer).toHaveBeenCalledWith(
      Buffer.from('video'),
      'probe.mp4',
      'video/mp4',
      { category: 'video', ownerId: 'user-1' },
    );
  });

  it('marks non-video Ozon CDN uploads as not usable for automatic product videos', async () => {
    const result = await probeOzonVideoUpload({
      backend: makeBackend('https://ir.ozone.ru/s3/cms/12/t9/probe.mp4'),
      buffer: Buffer.from('video'),
      filename: 'probe.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'uploaded_not_video_asset',
      uploadedUrl: 'https://ir.ozone.ru/s3/cms/12/t9/probe.mp4',
    });
    expect(result.message).toContain('不是 Ozon 商品视频资产');
  });

  it('marks Seller temporary video uploads as publishable video URL attributes', async () => {
    const result = await probeOzonVideoUpload({
      backend: makeBackend('https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/demo.mp4'),
      buffer: Buffer.from('video'),
      filename: 'probe.mp4',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'uploaded_temp_video_url',
      uploadedUrl: 'https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/demo.mp4',
    });
    expect(result.message).toContain('21841');
  });

  it('returns upload_failed diagnostics when the CDN endpoint rejects mp4', async () => {
    const backend: ImageStorageBackend = {
      upload: vi.fn(),
      uploadBuffer: vi.fn(async () => {
        throw new Error('OZON CDN 校验失败: unsupported media');
      }),
    };

    const result = await probeOzonVideoUpload({
      backend,
      buffer: Buffer.from('video'),
      filename: 'probe.mp4',
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'upload_failed',
    });
    expect(result.message).toContain('unsupported media');
  });

  it('explains Ozon too-small validation errors as a probe payload issue', async () => {
    const backend: ImageStorageBackend = {
      upload: vi.fn(),
      uploadBuffer: vi.fn(async () => {
        throw new Error('OZON CDN 校验失败: too small - Размер файла меньше допустимого 40 < 512');
      }),
    };

    const result = await probeOzonVideoUpload({ backend });

    expect(result).toMatchObject({
      ok: false,
      status: 'upload_failed',
    });
    expect(result.message).toContain('文件小于 Ozon 最小限制');
    expect(result.message).toContain('选择本地 MP4');
  });

  it('explains wrong_content_type as the image CDN endpoint rejecting video uploads', async () => {
    const backend: ImageStorageBackend = {
      upload: vi.fn(),
      uploadBuffer: vi.fn(async () => {
        throw new Error('OZON CDN 校验失败: wrong_content_type - wrong_content_type');
      }),
    };

    const result = await probeOzonVideoUpload({ backend });

    expect(result).toMatchObject({
      ok: false,
      status: 'upload_failed',
    });
    expect(result.message).toContain('图片 CDN 接口不支持视频');
    expect(result.message).toContain('抓取 Seller 后台视频上传接口');
  });

  it('parses mp4 data urls for optional local file probing', () => {
    const parsed = parseOzonVideoProbeDataUrl('data:video/mp4;base64,dmlkZW8=', 'demo.MP4');

    expect(parsed).toEqual({
      buffer: Buffer.from('video'),
      filename: 'demo.MP4',
      mimeType: 'video/mp4',
    });
  });

  it('rejects non-mp4 data urls for the first probe version', () => {
    expect(() => parseOzonVideoProbeDataUrl('data:video/webm;base64,dmlkZW8=', 'demo.webm'))
      .toThrow('仅支持 video/mp4');
  });
});
