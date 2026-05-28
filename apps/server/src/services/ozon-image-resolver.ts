import { readFile } from 'fs/promises';
import { join } from 'path';
import { getStorageBackend, type ImageStorageBackend } from './image-storage.js';

/**
 * 将本地水印路径上传到存储后端，返回公网可达 URL。
 * 关键：本地路径 resolve 失败必须 throw，绝不能让 localhost URL 透传给 OZON。
 */
export async function resolveImageUrls(
  images: string[],
  shopId: string,
): Promise<string[]> {
  const resolved: string[] = [];
  let backend: ImageStorageBackend | null = null;
  let backendError: string | null = null;

  for (const raw of images) {
    let img = raw;
    const local = img.match(/^https?:\/\/localhost(?::\d+)?(\/.*)$/);
    if (local) img = local[1]!;

    const isLocal = img.startsWith('/watermarked/') || img.startsWith('/uploads/');
    if (isLocal) {
      if (!backend && !backendError) {
        try {
          backend = await getStorageBackend(shopId);
        } catch (e: any) {
          backendError = e?.message || '存储后端未配置';
        }
      }
      if (!backend) {
        throw new Error(
          `本地水印图无法上传到 OZON：${backendError}。请在 /admin/settings 切换图片存储后端为 ozon-cdn 或 oss，并通过浏览器扩展同步该店铺的 seller cookie 与 company_id`,
        );
      }
      const localPath = join(process.cwd(), 'public', img.replace(/^\//, ''));
      let buf: Buffer;
      try {
        buf = await readFile(localPath);
      } catch {
        throw new Error(`水印图文件不存在: ${img}（请重新点击"打水印"刷新）`);
      }
      const filename = img.split('/').pop() || 'img.jpg';
      const result = await backend.uploadBuffer(buf, filename);
      resolved.push(result.url);
    } else {
      resolved.push(img);
    }
  }
  return resolved;
}
