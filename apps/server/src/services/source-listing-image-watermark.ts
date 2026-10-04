import { createHash } from 'node:crypto';
import sharp, { type OverlayOptions } from 'sharp';

export interface ImageWatermarkRenderConfig {
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center' | 'tile';
  opacity: number; scale: number;
}
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
async function inspect(buffer: Buffer, maxBytes: number, edge: number) {
  if (!buffer.length || buffer.length > maxBytes) throw new Error('Watermark image byte limit exceeded');
  const metadata = await sharp(buffer, { limitInputPixels: edge * edge, failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format || '')
    || metadata.width > edge || metadata.height > edge || Number(metadata.pages || 1) !== 1) {
    throw new Error('Watermark requires a bounded single-frame raster image');
  }
}

/** Multiply existing alpha; ensureAlpha(opacity) alone leaves PNG alpha unchanged. */
export async function renderImageWatermark(sourceBytes: Buffer, watermarkBytes: Buffer, config: ImageWatermarkRenderConfig) {
  await inspect(sourceBytes, 20 * 1024 * 1024, 4096);
  await inspect(watermarkBytes, 4 * 1024 * 1024, 2048);
  const source = await sharp(sourceBytes, { limitInputPixels: 16_777_216, failOn: 'error' })
    .rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  const metadata = await sharp(source).metadata(); const width = metadata.width!; const height = metadata.height!;
  const margin = Math.min(Math.max(4, Math.round(Math.min(width, height) * 0.015)), Math.floor((Math.min(width, height) - 1) / 2));
  const resized = await sharp(watermarkBytes, { limitInputPixels: 4_194_304, failOn: 'error' }).rotate().ensureAlpha()
    .resize({ width: Math.max(1, Math.min(width - margin * 2, Math.round(width * config.scale / 100))),
      height: Math.max(1, height - margin * 2), fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  if (resized.info.channels !== 4) throw new Error('Watermark RGBA decoding failed');
  for (let offset = 3; offset < resized.data.length; offset += 4) resized.data[offset] = Math.round(resized.data[offset]! * config.opacity / 100);
  const mark = await sharp(resized.data, { raw: { width: resized.info.width, height: resized.info.height, channels: 4 } }).png().toBuffer();
  let overlays: OverlayOptions[];
  if (config.position === 'tile') {
    const rotated = await sharp(mark).rotate(-30, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const rotatedMeta = await sharp(rotated).metadata();
    const cellWidth = Math.min(width, Math.max(rotatedMeta.width!, Math.round(resized.info.width * 1.6)));
    const cellHeight = Math.min(height, Math.max(rotatedMeta.height!, Math.round(resized.info.height * 1.4)));
    const boundedMark = await sharp(rotated).resize({ width: cellWidth, height: cellHeight, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const cell = await sharp({ create: { width: cellWidth, height: cellHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: boundedMark, gravity: 'centre' }]).png().toBuffer();
    // libvips tiles the cell without a potentially unbounded JS overlay/SVG list.
    const tiled = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: cell, tile: true }]).png().toBuffer();
    overlays = [{ input: tiled }];
  } else {
    const left = config.position.endsWith('left'), top = config.position.startsWith('top');
    overlays = [{ input: mark, left: config.position === 'center' ? Math.floor((width - resized.info.width) / 2)
      : left ? margin : width - margin - resized.info.width,
    top: config.position === 'center' ? Math.floor((height - resized.info.height) / 2)
      : top ? margin : height - margin - resized.info.height }];
  }
  const output = await sharp(source).composite(overlays).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  if (output.length > 8 * 1024 * 1024) throw new Error('Watermark output byte limit exceeded');
  return { buffer: output, width, height, sha256: hash(output), sourceSha256: hash(sourceBytes), watermarkSha256: hash(watermarkBytes) };
}
