import sharp, { type OverlayOptions } from 'sharp';
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  IMAGE_PROCESSING_MAX_PIXELS,
  loadBoundedImageSource,
} from './image-source-loader.js';
import {
  parseWatermarkConfig,
  parseWatermarkImageUrls,
  parseWatermarkItemId,
  type WatermarkConfig,
} from './image-processing-input.js';

const WATERMARK_DIR = join(process.cwd(), 'public', 'watermarked');

if (!existsSync(WATERMARK_DIR)) {
  mkdirSync(WATERMARK_DIR, { recursive: true });
}

export type WatermarkPosition =
  | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  | 'center' | 'tile';

export type { WatermarkConfig } from './image-processing-input.js';

export function normalizeWatermarkSourceUrl(url: string): string {
  const text = String(url || '').trim();
  if (!/^(https?:)?\/\//i.test(text)) return text;
  try {
    const parsed = new URL(text.startsWith('//') ? `https:${text}` : text);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('.ozone.ru') || host.endsWith('.ozon.ru') || host.endsWith('.ozonstatic.cn')) {
      parsed.pathname = parsed.pathname.replace(/\/(?:wc|w|h|c)\d+(?:x\d+)?(?=\/)/i, '');
    }
    return parsed.href;
  } catch {
    return text;
  }
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const sourceUrl = normalizeWatermarkSourceUrl(url);
  return (await loadBoundedImageSource(sourceUrl)).buffer;
}

// 字体回退链：DejaVu Sans / Liberation Sans 在 Linux librsvg 中通常自带；
// Arial 在 Windows / macOS 自带；最后兜底 sans-serif
// 这条链同时覆盖中英俄西里尔字符
const FONT_FAMILY = '"Arial", "Liberation Sans", "DejaVu Sans", "Noto Sans", "Segoe UI", sans-serif';

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function normalizeColor(c?: string): string {
  if (!c) return '#ffffff';
  const v = c.trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    // #rgb -> #rrggbb
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  return '#ffffff';
}

// 单文字水印 SVG —— 根据位置计算 x/y/anchor，不再 always center
function buildSingleTextSvg(text: string, width: number, height: number, config: WatermarkConfig): Buffer {
  const fontSize = config.fontSize || Math.max(20, Math.floor(Math.min(width, height) * 0.06));
  const opacity = Math.max(0, Math.min(100, config.opacity)) / 100;
  const color = normalizeColor(config.fontColor);
  const padding = Math.floor(fontSize * 0.6);

  let x: number;
  let y: number;
  let anchor: 'start' | 'middle' | 'end';
  let baseline: 'hanging' | 'middle' | 'baseline' = 'middle';

  switch (config.position) {
    case 'top-left':
      x = padding; y = padding; anchor = 'start'; baseline = 'hanging'; break;
    case 'top-right':
      x = width - padding; y = padding; anchor = 'end'; baseline = 'hanging'; break;
    case 'bottom-left':
      x = padding; y = height - padding; anchor = 'start'; baseline = 'baseline'; break;
    case 'bottom-right':
      x = width - padding; y = height - padding; anchor = 'end'; baseline = 'baseline'; break;
    case 'center':
    default:
      x = Math.floor(width / 2); y = Math.floor(height / 2); anchor = 'middle'; baseline = 'middle';
  }

  // 描边提升对比度，黑色半透明描边
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <text x="${x}" y="${y}" font-family='${FONT_FAMILY}' font-size="${fontSize}" font-weight="600"
      fill="${color}" fill-opacity="${opacity}"
      stroke="#000000" stroke-opacity="${opacity * 0.5}" stroke-width="${Math.max(1, Math.floor(fontSize * 0.04))}"
      paint-order="stroke fill"
      text-anchor="${anchor}" dominant-baseline="${baseline}"
      xml:space="preserve">${escapeXml(text)}</text>
  </svg>`;
  return Buffer.from(svg);
}

function buildTileTextSvg(text: string, width: number, height: number, config: WatermarkConfig): Buffer {
  const fontSize = config.fontSize || Math.max(18, Math.floor(Math.min(width, height) * 0.05));
  const opacity = Math.max(0, Math.min(100, config.opacity)) / 100;
  const color = normalizeColor(config.fontColor);
  const stepX = Math.floor(fontSize * 8);
  const stepY = Math.floor(fontSize * 5);

  let lines = '';
  for (let y = stepY; y < height + stepY; y += stepY) {
    for (let x = -stepX; x < width + stepX; x += stepX) {
      lines += `<text x="${x}" y="${y}" font-family='${FONT_FAMILY}' font-size="${fontSize}" font-weight="600" fill="${color}" fill-opacity="${opacity}" text-anchor="middle" transform="rotate(-30 ${x} ${y})" xml:space="preserve">${escapeXml(text)}</text>`;
    }
  }

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines}</svg>`);
}

function imageGravity(pos: WatermarkPosition): string {
  switch (pos) {
    case 'top-left': return 'northwest';
    case 'top-right': return 'northeast';
    case 'bottom-left': return 'southwest';
    case 'bottom-right': return 'southeast';
    case 'center': return 'centre';
    case 'tile': return 'centre';
    default: return 'southeast';
  }
}

export async function applyWatermark(imageUrl: string, itemId: string, index: number, config: WatermarkConfig): Promise<string> {
  const safeItemId = parseWatermarkItemId(itemId);
  const safeConfig = parseWatermarkConfig(config);
  const imgBuffer = await fetchImageBuffer(imageUrl);
  const metadata = await sharp(imgBuffer, { limitInputPixels: IMAGE_PROCESSING_MAX_PIXELS }).metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 800;

  let compositeInput: OverlayOptions[];

  if (safeConfig.type === 'image' && safeConfig.imageUrl) {
    const wmBuffer = await fetchImageBuffer(safeConfig.imageUrl);
    const scalePct = Math.max(5, Math.min(100, safeConfig.scale ?? 25));
    const wmResized = await sharp(wmBuffer, { limitInputPixels: IMAGE_PROCESSING_MAX_PIXELS })
      .resize({ width: Math.floor(width * scalePct / 100), withoutEnlargement: true })
      .ensureAlpha(safeConfig.opacity / 100)
      .toBuffer();

    if (safeConfig.position === 'tile') {
      // 图片水印的 tile：通过 SVG 多次引入 base64 图片
      const meta = await sharp(wmResized).metadata();
      const wmW = meta.width || Math.floor(width * scalePct / 100);
      const wmH = meta.height || wmW;
      const stepX = Math.floor(wmW * 1.6);
      const stepY = Math.floor(wmH * 1.4);
      const b64 = wmResized.toString('base64');
      let body = '';
      for (let y = 0; y < height + stepY; y += stepY) {
        for (let x = -stepX; x < width + stepX; x += stepX) {
          body += `<image x="${x}" y="${y}" width="${wmW}" height="${wmH}" href="data:image/png;base64,${b64}" transform="rotate(-30 ${x + wmW / 2} ${y + wmH / 2})" opacity="${safeConfig.opacity / 100}"/>`;
        }
      }
      const tileSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
      compositeInput = [{ input: tileSvg }];
    } else {
      compositeInput = [{ input: wmResized, gravity: imageGravity(safeConfig.position) as any }];
    }
  } else {
    const text = safeConfig.text || 'WATERMARK';
    // 文字 SVG 已经按位置在画布内自定位，不能再用 sharp gravity（会再叠加偏移）
    const wmSvg = safeConfig.position === 'tile'
      ? buildTileTextSvg(text, width, height, safeConfig)
      : buildSingleTextSvg(text, width, height, safeConfig);
    compositeInput = [{ input: wmSvg }];
  }

  const result = await sharp(imgBuffer, { limitInputPixels: IMAGE_PROCESSING_MAX_PIXELS })
    .composite(compositeInput)
    .jpeg({ quality: 90 })
    .toBuffer();

  const hash = createHash('md5').update(imageUrl + JSON.stringify(safeConfig)).digest('hex').slice(0, 8);
  const filename = `${safeItemId}_${index}_${hash}.jpg`;
  const filepath = join(WATERMARK_DIR, filename);

  await sharp(result).toFile(filepath);

  return `/watermarked/${filename}`;
}

export async function processItemWatermarks(
  images: string[],
  itemId: string,
  config: WatermarkConfig,
): Promise<{ watermarkedImages: string[]; failed: number }> {
  const safeImages = parseWatermarkImageUrls(images);
  const safeConfig = parseWatermarkConfig(config);
  const watermarkedImages: string[] = [];
  let failed = 0;

  for (let i = 0; i < safeImages.length; i++) {
    try {
      const relativePath = await applyWatermark(safeImages[i]!, itemId, i, safeConfig);
      watermarkedImages.push(relativePath);
    } catch (e: any) {
      console.warn(`[watermark] failed for image ${i} of item ${itemId}:`, e.message?.slice(0, 100));
      failed++;
      watermarkedImages.push(safeImages[i]!);
    }
  }

  return { watermarkedImages, failed };
}
