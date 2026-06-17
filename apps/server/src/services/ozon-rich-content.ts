import { getStorageBackend } from './image-storage.js';
import { normalizeOzonPublishImageUrl, waitForOzonImageReady } from './ozon-image-resolver.js';

export const OZON_RICH_CONTENT_ATTR_ID = 22336;

export type ParsedRichContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };

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
  status: 'skipped';
  reason: 'video_publish_not_supported';
  sourceVideos: CollectedVideo[];
}

const RICH_TEXT_MAX_LENGTH = 900;
const RICH_BLOCK_MAX_COUNT = 30;
const MARKETING_WORD_RE = /(^|[^\p{L}\p{N}])(?:100%\s*оригинал\p{L}*|проверен\p{L}*|оригинал\p{L}*|original|verified|authentic)(?=$|[^\p{L}\p{N}])/giu;

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

  for (const imageKey of ['imageUrl', 'originalUrl', 'src', 'picture', 'cover', 'url']) {
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

function richContentWidget(block: ParsedRichContentBlock) {
  if (block.type === 'image') {
    return {
      widgetName: 'raImage',
      img: { src: block.url },
    };
  }
  return {
    widgetName: 'raText',
    text: { content: block.text },
  };
}

export async function buildOzonRichContentAttribute(
  input: unknown,
  options: {
    imageMapper?: (url: string) => Promise<string>;
    maxBlocks?: number;
  } = {},
): Promise<OzonRichContentAttribute | null> {
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
    const mappedUrl = options.imageMapper ? await options.imageMapper(block.url) : block.url;
    const normalizedUrl = normalizeImageUrl(mappedUrl);
    if (normalizedUrl) blocks.push({ type: 'image', url: normalizedUrl });
  }

  if (!blocks.length) return null;
  const generated = {
    version: 1,
    content: blocks.map(richContentWidget),
  };

  return {
    id: OZON_RICH_CONTENT_ATTR_ID,
    complex_id: 0,
    values: [{ value: JSON.stringify(generated), dictionary_value_id: 0 }],
  };
}

export function appendOzonRichContentAttribute<T extends { id: number; complex_id?: number; values: any[] }>(
  attributes: T[] | null | undefined,
  richContentAttribute: OzonRichContentAttribute | null | undefined,
): Array<T | OzonRichContentAttribute> {
  const attrs = Array.isArray(attributes)
    ? attributes.filter((attr) => Number(attr.id) !== OZON_RICH_CONTENT_ATTR_ID)
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
    status: 'skipped',
    reason: 'video_publish_not_supported',
    sourceVideos,
  };
}
