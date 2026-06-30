import { getStorageBackend } from './image-storage.js';
import { normalizeOzonPublishImageUrl, waitForOzonImageReady } from './ozon-image-resolver.js';
import sharp from 'sharp';

export const OZON_RICH_CONTENT_ATTR_ID = 22336;
export const OZON_LEGACY_RICH_CONTENT_ATTR_ID = 11254;
export const OZON_RICH_CONTENT_ATTR_IDS = [
  OZON_RICH_CONTENT_ATTR_ID,
  OZON_LEGACY_RICH_CONTENT_ATTR_ID,
] as const;

export type ParsedRichContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'size_chart'; title: string; columns: string[]; rows: Array<Record<string, string>> };

export interface ParsedRichContent {
  blocks: ParsedRichContentBlock[];
}

export interface OzonRichContentAttribute {
  id: number;
  complex_id: number;
  values: { value: string; dictionary_value_id: number }[];
}

export interface CollectedVideo {
  url: string;
  coverUrl?: string;
  title?: string;
}

export interface VideoPublishPlan {
  offerId: string;
  status: 'manual_required';
  reason: typeof OZON_VIDEO_PUBLISH_UNSUPPORTED_REASON;
  message: string;
  sourceVideos: CollectedVideo[];
}

export interface OzonVideoMediaAttribute {
  id: number;
  complex_id: number;
  values: { value: string }[];
}

export const OZON_VIDEO_PUBLISH_UNSUPPORTED_REASON = 'ozon_video_publish_requires_official_media_or_xls_flow';
export const OZON_VIDEO_PUBLISH_UNSUPPORTED_MESSAGE = '采集视频已保存，但暂不能通过 Seller API 自动上传到 Ozon。请在 Ozon Seller 后台媒体页、XLS 模板或 Ozon Seller App 中使用 VK Video、Yandex Disk、Rutube 链接手动处理。';
const RICH_TEXT_MAX_LENGTH = 900;
const RICH_BLOCK_MAX_COUNT = 30;
const MARKETING_WORD_RE = /(^|[^\p{L}\p{N}])(?:100%\s*оригинал\p{L}*|проверен\p{L}*|оригинал\p{L}*|original|verified|authentic)(?=$|[^\p{L}\p{N}])/giu;
const RICH_IMAGE_URL_KEYS = new Set(['imageurl', 'originalurl', 'src', 'srcmobile', 'picture', 'cover']);
const RICH_TEXT_VALUE_KEYS = new Set(['title', 'description', 'content', 'value', 'text', 'caption']);
const SIZE_CHART_COLUMN_LABELS: Record<string, string> = {
  size: 'Размер',
  ruSize: 'Российский размер',
  intSize: 'INT',
  footLengthCm: 'Длина стопы, см',
  note: 'Примечание',
};

export function isOzonRichContentAttributeId(value: unknown): boolean {
  const id = Number(value);
  return OZON_RICH_CONTENT_ATTR_IDS.some((candidate) => candidate === id);
}

export function resolveOzonRichContentAttributeDef<T extends { id?: unknown; name?: unknown }>(
  attributes: T[] | null | undefined,
): T | null {
  if (!Array.isArray(attributes)) return null;
  for (const id of OZON_RICH_CONTENT_ATTR_IDS) {
    const found = attributes.find((attr) => Number(attr.id) === id);
    if (found) return found;
  }
  return attributes.find((attr) => (
    /rich[-\s]*контент\s+json/i.test(String(attr.name || ''))
    || /rich[-\s]*content\s+json/i.test(String(attr.name || ''))
  )) || null;
}

function toObject(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(MARKETING_WORD_RE, '$1')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, RICH_TEXT_MAX_LENGTH)
    .trim();
}

function normalizeImageUrl(value: unknown): string {
  let text = String(value || '').trim();
  if (text.startsWith('//')) text = `https:${text}`;
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    return new URL(text).href;
  } catch {
    return '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOzonRichContentTemplate(root: unknown): root is Record<string, unknown> {
  if (!isRecord(root) || !Array.isArray(root.content)) return false;
  return root.content.some((item) => isRecord(item) && typeof item.widgetName === 'string');
}

function shouldRewriteTemplateImage(keyHint: string, value: unknown): boolean {
  return RICH_IMAGE_URL_KEYS.has(keyHint.toLocaleLowerCase('ru-RU')) && !!normalizeImageUrl(value);
}

function shouldSanitizeTemplateText(keyHint: string, parentKey: string, value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const key = keyHint.toLocaleLowerCase('ru-RU');
  const parent = parentKey.toLocaleLowerCase('ru-RU');
  if (RICH_TEXT_VALUE_KEYS.has(key) && !normalizeImageUrl(value)) return true;
  return parent === 'text' && key !== 'color' && key !== 'align' && key !== 'size';
}

async function rewriteOzonRichContentTemplate(
  node: unknown,
  options: { imageMapper?: (url: string) => Promise<string> },
  keyHint = '',
  parentKey = '',
): Promise<unknown> {
  if (node == null) return node;

  if (typeof node === 'string' || typeof node === 'number') {
    if (shouldRewriteTemplateImage(keyHint, node)) {
      const mappedUrl = options.imageMapper ? await options.imageMapper(normalizeImageUrl(node)) : normalizeImageUrl(node);
      return normalizeImageUrl(mappedUrl) || node;
    }
    if (shouldSanitizeTemplateText(keyHint, parentKey, node)) return normalizeText(node);
    return node;
  }

  if (Array.isArray(node)) {
    const rewritten: unknown[] = [];
    for (const item of node) {
      rewritten.push(await rewriteOzonRichContentTemplate(item, options, keyHint, parentKey));
    }
    return rewritten;
  }

  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = await rewriteOzonRichContentTemplate(value, options, key, keyHint);
  }
  return out;
}

function pushText(out: ParsedRichContentBlock[], seen: Set<string>, value: unknown) {
  const text = normalizeText(value);
  const key = `text:${text.toLocaleLowerCase('ru-RU')}`;
  if (!text || seen.has(key)) return;
  seen.add(key);
  out.push({ type: 'text', text });
}

function pushImage(out: ParsedRichContentBlock[], seen: Set<string>, value: unknown) {
  const url = normalizeImageUrl(value);
  const key = `image:${url}`;
  if (!url || seen.has(key)) return;
  seen.add(key);
  out.push({ type: 'image', url });
}

function pushSizeChart(out: ParsedRichContentBlock[], seen: Set<string>, row: Record<string, unknown>) {
  const rows = Array.isArray(row.rows)
    ? row.rows
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, normalizeText(value).slice(0, 80)])))
      .filter((entry) => Object.values(entry).some(Boolean))
    : [];
  if (!rows.length) return;
  const columns = Array.isArray(row.columns)
    ? row.columns.map((value) => normalizeText(value).slice(0, 60)).filter(Boolean)
    : Object.keys(rows[0] || {}).map((key) => SIZE_CHART_COLUMN_LABELS[key] || key);
  if (!columns.length) return;
  const title = normalizeText(row.title || 'Таблица размеров').slice(0, 120) || 'Таблица размеров';
  const key = `size_chart:${title}:${JSON.stringify(rows)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ type: 'size_chart', title, columns, rows });
}

function visitRichNode(node: unknown, out: ParsedRichContentBlock[], seen: Set<string>, keyHint = '') {
  if (out.length >= RICH_BLOCK_MAX_COUNT) return;
  if (node == null) return;

  const key = keyHint.toLocaleLowerCase('ru-RU');
  if (typeof node === 'string' || typeof node === 'number') {
    if (/^(title|description|content|value|text|caption)$/i.test(keyHint)) pushText(out, seen, node);
    if (/^(imageurl|originalurl|src|picture|cover)$/i.test(keyHint)) pushImage(out, seen, node);
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) visitRichNode(item, out, seen, keyHint);
    return;
  }

  if (typeof node !== 'object') return;
  const row = node as Record<string, unknown>;

  if (String(row.type || '') === 'size_chart') {
    pushSizeChart(out, seen, row);
    return;
  }

  if (Array.isArray(row.textRs)) {
    for (const item of row.textRs) {
      if (item && typeof item === 'object' && 'content' in item) pushText(out, seen, (item as any).content);
    }
  }

  if (typeof row.title === 'string') pushText(out, seen, row.title);
  if (typeof row.description === 'string') pushText(out, seen, row.description);
  if (typeof row.content === 'string') pushText(out, seen, row.content);
  if (typeof row.value === 'string' && !normalizeImageUrl(row.value)) pushText(out, seen, row.value);
  if (typeof row.text === 'string') pushText(out, seen, row.text);

  for (const imageKey of ['imageUrl', 'originalUrl', 'src', 'srcMobile', 'picture', 'cover', 'url']) {
    if (imageKey in row) pushImage(out, seen, row[imageKey]);
  }
  for (const imageObjectKey of ['img', 'image', 'picture']) {
    const imageObject = row[imageObjectKey];
    if (typeof imageObject === 'string') pushImage(out, seen, imageObject);
    else if (imageObject && typeof imageObject === 'object') visitRichNode(imageObject, out, seen, imageObjectKey);
  }

  for (const [childKey, child] of Object.entries(row)) {
    if (['textRs', 'imageUrl', 'originalUrl', 'src', 'picture', 'cover', 'url', 'img', 'image'].includes(childKey)) continue;
    if ((childKey === 'title' || childKey === 'description' || childKey === 'content' || childKey === 'value' || childKey === 'text') && typeof child !== 'object') continue;
    visitRichNode(child, out, seen, childKey);
  }
}

export function parseCollectedRichContent(input: unknown): ParsedRichContent {
  const root = toObject(input);
  const blocks: ParsedRichContentBlock[] = [];
  const seen = new Set<string>();
  visitRichNode(root, blocks, seen);
  return { blocks };
}

async function buildTemplateRichContent(
  input: unknown,
  options: { imageMapper?: (url: string) => Promise<string> },
): Promise<Record<string, unknown> | null> {
  const root = toObject(input);
  if (!hasOzonRichContentTemplate(root)) return null;
  const rewritten = await rewriteOzonRichContentTemplate(root, options);
  return hasOzonRichContentTemplate(rewritten) ? rewritten : null;
}

function fallbackShowcaseBlock(imageUrl: string | null, textLines: string[]) {
  const block: Record<string, unknown> = {
    imgLink: '',
    text: {
      align: 'left',
      color: 'color1',
      content: textLines.length ? textLines : [''],
      size: 'size2',
    },
  };
  if (imageUrl) {
    block.img = {
      alt: '',
      position: 'width_full',
      positionMobile: 'width_full',
      src: imageUrl,
      srcMobile: imageUrl,
    };
  }
  return block;
}

function buildFallbackRichContent(blocks: ParsedRichContentBlock[]) {
  const imageUrls: string[] = [];
  const textLines: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      textLines.push(...block.text.split('\n').map((line) => line.trim()).filter(Boolean));
      continue;
    }
    if (block.type === 'size_chart') continue;
    imageUrls.push(block.url);
  }

  const showcaseBlocks = imageUrls.length
    ? imageUrls.map((url, index) => fallbackShowcaseBlock(url, index === 0 ? textLines : []))
    : [fallbackShowcaseBlock(null, textLines)];

  return {
    version: 0.3,
    content: [{
      widgetName: 'raShowcase',
      type: 'billboard',
      blocks: showcaseBlocks.slice(0, RICH_BLOCK_MAX_COUNT),
    }],
  };
}

export async function buildOzonRichContentAttribute(
  input: unknown,
  options: {
    attributeId?: number;
    imageMapper?: (url: string) => Promise<string>;
    sizeChartImageMapper?: (chart: Extract<ParsedRichContentBlock, { type: 'size_chart' }>) => Promise<string>;
    maxBlocks?: number;
  } = {},
): Promise<OzonRichContentAttribute | null> {
  const templated = await buildTemplateRichContent(input, {
    imageMapper: options.imageMapper,
  });
  if (templated) {
    return {
      id: options.attributeId && Number.isInteger(options.attributeId) && options.attributeId > 0
        ? options.attributeId
        : OZON_RICH_CONTENT_ATTR_ID,
      complex_id: 0,
      values: [{ value: JSON.stringify(templated), dictionary_value_id: 0 }],
    };
  }

  const parsed = parseCollectedRichContent(input);
  if (!parsed.blocks.length) return null;

  const blocks: ParsedRichContentBlock[] = [];
  const maxBlocks = Math.max(1, options.maxBlocks ?? RICH_BLOCK_MAX_COUNT);
  for (const block of parsed.blocks) {
    if (blocks.length >= maxBlocks) break;
    if (block.type === 'text') {
      blocks.push(block);
      continue;
    }
    if (block.type === 'size_chart') {
      if (!options.sizeChartImageMapper) continue;
      const chartUrl = await options.sizeChartImageMapper(block);
      const normalizedChartUrl = normalizeImageUrl(chartUrl);
      if (normalizedChartUrl) blocks.push({ type: 'image', url: normalizedChartUrl });
      continue;
    }
    const mappedUrl = options.imageMapper ? await options.imageMapper(block.url) : block.url;
    const normalizedUrl = normalizeImageUrl(mappedUrl);
    if (normalizedUrl) blocks.push({ type: 'image', url: normalizedUrl });
  }

  if (!blocks.length) return null;
  const generated = buildFallbackRichContent(blocks);

  return {
    id: options.attributeId && Number.isInteger(options.attributeId) && options.attributeId > 0
      ? options.attributeId
      : OZON_RICH_CONTENT_ATTR_ID,
    complex_id: 0,
    values: [{ value: JSON.stringify(generated), dictionary_value_id: 0 }],
  };
}

function escapeSvg(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sizeChartCellValue(row: Record<string, string>, label: string): string {
  const known = Object.entries(SIZE_CHART_COLUMN_LABELS).find(([, value]) => value === label);
  if (known) return row[known[0]] || '';
  if (/尺码|размер/i.test(label) && !/рос|ru|俄/i.test(label)) return row.size || '';
  if (/俄罗斯|рос|ru/i.test(label)) return row.ruSize || '';
  if (/国际|int/i.test(label)) return row.intSize || '';
  if (/脚长|стоп/i.test(label)) return row.footLengthCm || '';
  if (/说明|примеч/i.test(label)) return row.note || '';
  return row[label] || '';
}

export function renderSizeChartSvg(chart: Extract<ParsedRichContentBlock, { type: 'size_chart' }>): string {
  const columns = chart.columns.slice(0, 6);
  const rows = chart.rows.slice(0, 12);
  const width = Math.max(760, columns.length * 180);
  const titleHeight = 76;
  const rowHeight = 54;
  const headerHeight = 56;
  const height = titleHeight + headerHeight + rows.length * rowHeight + 36;
  const colWidth = width / columns.length;
  const headerY = titleHeight;
  const bodyY = titleHeight + headerHeight;
  const cells: string[] = [];

  columns.forEach((column, index) => {
    const x = index * colWidth;
    cells.push(`<rect x="${x}" y="${headerY}" width="${colWidth}" height="${headerHeight}" fill="${index === 0 ? '#e6eef8' : '#f2f5f9'}"/>`);
    cells.push(`<text x="${x + 18}" y="${headerY + 35}" font-size="22" font-weight="700" fill="#27313d">${escapeSvg(column)}</text>`);
  });

  rows.forEach((row, rowIndex) => {
    const y = bodyY + rowIndex * rowHeight;
    const fill = rowIndex % 2 === 0 ? '#ffffff' : '#f5f7fa';
    cells.push(`<rect x="0" y="${y}" width="${width}" height="${rowHeight}" fill="${fill}"/>`);
    columns.forEach((column, colIndex) => {
      const x = colIndex * colWidth;
      const value = sizeChartCellValue(row, column);
      cells.push(`<text x="${x + 18}" y="${y + 34}" font-size="21" fill="#394452">${escapeSvg(value)}</text>`);
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="24" y="46" font-size="28" font-weight="700" fill="#1f2937">${escapeSvg(chart.title || 'Таблица размеров')}</text>
<line x1="24" y1="66" x2="${width - 24}" y2="66" stroke="#d8dee8" stroke-width="2"/>
${cells.join('')}
<rect x="0" y="${headerY}" width="${width}" height="${headerHeight + rows.length * rowHeight}" fill="none" stroke="#d8dee8" stroke-width="2"/>
</svg>`;
}

export async function uploadGeneratedSizeChartImage(
  chart: Extract<ParsedRichContentBlock, { type: 'size_chart' }>,
  shopId: string,
  ownerId?: string,
): Promise<string> {
  const svg = renderSizeChartSvg(chart);
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  const backend = await getStorageBackend(shopId);
  const uploaded = await backend.uploadBuffer(buffer, 'source-size-chart.jpg', 'image/jpeg', {
    category: 'raw',
    ownerId,
  });
  const normalized = normalizeOzonPublishImageUrl(uploaded.url);
  await waitForOzonImageReady(normalized);
  return normalized;
}

export function appendOzonRichContentAttribute<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  richContentAttribute: OzonRichContentAttribute | null | undefined,
): Array<T | OzonRichContentAttribute> {
  const attrs = Array.isArray(attributes)
    ? attributes.filter((attr) => !isOzonRichContentAttributeId(attr.id))
    : [];
  return richContentAttribute ? [...attrs, richContentAttribute] : attrs;
}

function filenameFromUrl(rawUrl: string, contentType = ''): string {
  let fallbackExt = 'jpg';
  const type = contentType.toLowerCase();
  if (type.includes('png')) fallbackExt = 'png';
  else if (type.includes('webp')) fallbackExt = 'webp';
  else if (type.includes('gif')) fallbackExt = 'gif';
  try {
    const url = new URL(rawUrl);
    const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `rich-content.${fallbackExt}`;
  } catch {
    return `rich-content.${fallbackExt}`;
  }
}

export async function transferRichContentImage(
  url: string,
  shopId: string,
  ownerId?: string,
): Promise<string> {
  const sourceUrl = normalizeImageUrl(url);
  if (!sourceUrl) throw new Error('富内容图片 URL 无效');
  const res = await fetch(sourceUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`富内容图片下载失败: HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || undefined;
  if (contentType && !contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`富内容图片类型无效: ${contentType}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const backend = await getStorageBackend(shopId);
  const uploaded = await backend.uploadBuffer(buffer, filenameFromUrl(sourceUrl, contentType), contentType, {
    category: 'raw',
    ownerId,
  });
  const normalized = normalizeOzonPublishImageUrl(uploaded.url);
  await waitForOzonImageReady(normalized);
  return normalized;
}

export function planCollectedVideoPublish(input: unknown, offerId: string): VideoPublishPlan | null {
  if (!Array.isArray(input) || !input.length) return null;
  const sourceVideos = input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const url = normalizeImageUrl(row.url || row.videoUrl || row.src || row.link);
      if (!url) return null;
      const coverUrl = normalizeImageUrl(row.coverUrl || row.cover || row.poster || row.preview || row.thumbnail);
      const title = normalizeText(row.title || row.name || row.caption).slice(0, 200);
      return {
        url,
        ...(coverUrl ? { coverUrl } : {}),
        ...(title ? { title } : {}),
      };
    })
    .filter((item): item is CollectedVideo => !!item);
  if (!sourceVideos.length) return null;
  return {
    offerId,
    status: 'manual_required',
    reason: OZON_VIDEO_PUBLISH_UNSUPPORTED_REASON,
    message: OZON_VIDEO_PUBLISH_UNSUPPORTED_MESSAGE,
    sourceVideos,
  };
}

interface ParsedOzonVideoUrl {
  videoBucket: string;
  videoId: string;
  assetName: string;
  assetUrl: string;
  masterUrl: string;
}

function parseOzonVideoUrl(rawUrl: unknown): ParsedOzonVideoUrl | null {
  const url = normalizeImageUrl(rawUrl);
  if (!url) return null;
  try {
    const parsed = new URL(url);
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
    };
  } catch {
    return null;
  }
}

function normalizeOzonTemporaryVideoUrl(rawUrl: unknown): string | null {
  const url = normalizeImageUrl(rawUrl);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/^cdn\d*\.ozone\.ru$/i.test(parsed.hostname)) return null;
    if (!/^\/s3\/sc-temporary\/.+\.mp4$/i.test(parsed.pathname)) return null;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOzonVideoCoverUrl(rawUrl: unknown, parsedVideo: ParsedOzonVideoUrl): string {
  const coverUrl = normalizeImageUrl(rawUrl);
  if (coverUrl) {
    try {
      const parsed = new URL(coverUrl);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      // Fall through to the standard Ozon cover URL.
    }
  }
  return `https://ir.ozone.ru/s3/${parsedVideo.videoBucket}/${parsedVideo.videoId}/cover/cover.jpg`;
}

function videoAttr(id: number, complexId: number, value: string): OzonVideoMediaAttribute {
  return { id, complex_id: complexId, values: [{ value }] };
}

export function buildOzonVideoMediaAttributesFromSourceVideos(input: unknown): OzonVideoMediaAttribute[] {
  if (!Array.isArray(input) || !input.length) return [];
  const parsedVideos: Array<{ video: ParsedOzonVideoUrl; coverUrl: string }> = [];
  const temporaryVideoUrls: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const temporaryVideoUrl = normalizeOzonTemporaryVideoUrl(row.url || row.videoUrl || row.src || row.link);
    if (temporaryVideoUrl && !seen.has(temporaryVideoUrl)) {
      seen.add(temporaryVideoUrl);
      temporaryVideoUrls.push(temporaryVideoUrl);
      if (temporaryVideoUrls.length >= 1) break;
      continue;
    }
    const video = parseOzonVideoUrl(row.url || row.videoUrl || row.src || row.link);
    if (!video || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    parsedVideos.push({
      video,
      coverUrl: normalizeOzonVideoCoverUrl(row.coverUrl || row.cover || row.poster || row.preview || row.thumbnail, video),
    });
    if (parsedVideos.length >= 2) break;
  }

  const attrs: OzonVideoMediaAttribute[] = [];
  const temporaryVideoUrl = temporaryVideoUrls[0];
  if (temporaryVideoUrl) {
    attrs.push(videoAttr(21841, 100001, temporaryVideoUrl));
    return attrs;
  }
  const primary = parsedVideos[0];
  if (primary) {
    attrs.push(
      videoAttr(21842, 100002, primary.coverUrl),
      videoAttr(21843, 100002, primary.video.assetUrl),
      videoAttr(21844, 100002, primary.video.videoId),
      videoAttr(21845, 100002, primary.video.assetUrl),
      videoAttr(21846, 100002, primary.video.masterUrl),
      videoAttr(22964, 100002, 'true'),
      videoAttr(23256, 100002, '0.75'),
    );
  }
  const secondary = parsedVideos[1];
  if (secondary) {
    attrs.push(
      videoAttr(21837, 100001, secondary.video.assetName),
      videoAttr(21838, 100001, secondary.coverUrl),
      videoAttr(21839, 100001, secondary.video.masterUrl),
      videoAttr(21840, 100001, secondary.video.videoId),
      videoAttr(21841, 100001, secondary.video.assetUrl),
      videoAttr(23255, 100001, '1.78'),
    );
  }
  return attrs;
}
