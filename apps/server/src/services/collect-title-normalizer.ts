const CJK_TEXT_RE = /[\u3400-\u9fff]/;
const CYRILLIC_TEXT_RE = /[А-Яа-яЁё]/;
export const TITLE_STOP_WORDS = new Set(['для', 'в', 'на', 'и', 'с', 'со', 'по', 'из', 'от', 'к']);

export function containsCjkText(value: unknown): boolean {
  return CJK_TEXT_RE.test(String(value || ''));
}

export function containsCyrillicText(value: unknown): boolean {
  return CYRILLIC_TEXT_RE.test(String(value || ''));
}

export function containsRussianText(value: unknown): boolean {
  return containsCyrillicText(value) && !containsCjkText(value);
}

function variantWordCount(value: unknown): number {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function repairRussianTitleGluing(value: string): string {
  return value
    .replace(/(^|[^\p{L}])(ручн(?:ой|ая|ое|ые))работ(?:ы|а)(?=$|[^\p{L}])/giu, '$1$2 работы')
    .replace(/(^|[^\p{L}])(работ(?:ы|а))декор(?=$|[^\p{L}])/giu, '$1$2 декор');
}

function removeLeadingStandaloneCount(value: string): string {
  const text = value.trim();
  if (/^\d{1,3}\s+в\s+\d{1,3}\b/i.test(text)) return text;
  if (/^\d{1,3}\s+(?:RU|EU|US|UK|XS|S|M|L|XL|XXL|XXXL)\b/i.test(text)) return text;
  return text.replace(/^\d{1,3}\s+(?=\p{L})/u, '');
}

export function normalizeProductId(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

export function cleanPublishName(value: unknown): string {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  const normalized = removeLeadingStandaloneCount(repairRussianTitleGluing(text))
    .replace(/[;:|/]+/g, ', ')
    .replace(/\s*([,.])\s*/g, '$1 ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/([,.]){2,}/g, '$1')
    .replace(/[,.]\s*$/g, '')
    .trim();
  if (!normalized) return '';

  const words: string[] = [];
  let previousKey = '';
  for (const rawWord of normalized.split(/\s+/)) {
    const word = rawWord
      .replace(/^[^\p{L}\p{N}]+/gu, '')
      .replace(/[^\p{L}\p{N},.-]+$/gu, '');
    if (!word) continue;
    const key = word.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');
    if (key && key === previousKey) continue;
    words.push(word);
    previousKey = key || '';
  }
  return words.join(' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/[,.]\s*$/g, '')
    .trim();
}

export function lowercaseCyrillicVariantPart(value: string): string {
  const text = cleanPublishName(value);
  if (!/^[\p{Script=Cyrillic}][\p{Script=Cyrillic}\p{N}\s,.-]*$/u.test(text)) return text;
  return text.charAt(0).toLocaleLowerCase('ru-RU') + text.slice(1);
}

export function hasSuspiciousPublishName(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  const words = text
    .toLocaleLowerCase('ru-RU')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TITLE_STOP_WORDS.has(word));

  if (words.length < 2) return false;
  for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i] === words[i + 1]) return true;
  }
  const first = words[0];
  return !!first && words.slice(1, 5).includes(first);
}

function extractOzonSlugTitleFromUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://www.ozon.ru');
    const match = url.pathname.match(/^\/product\/([^/?#]+)/i);
    if (!match?.[1] || /^\d+$/.test(match[1])) return '';
    const decoded = decodeURIComponent(match[1])
      .replace(/[-_]\d{6,}$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!decoded || containsCjkText(decoded)) return '';
    const cleaned = cleanPublishName(decoded);
    if (!cleaned) return '';
    return cleaned.charAt(0).toLocaleUpperCase('ru-RU') + cleaned.slice(1);
  } catch {
    return '';
  }
}

export function resolveCollectedDisplayTitle(input: {
  title?: unknown;
  publishTitle?: unknown;
  sourceTitleRaw?: unknown;
  sourceUrl?: unknown;
  sourceProductId?: unknown;
  sku?: unknown;
  sourcePlatform?: unknown;
}): string {
  const sourcePlatform = String(input.sourcePlatform || '').trim().toLowerCase();
  if (sourcePlatform && sourcePlatform !== 'ozon') {
    const sourceTitle = cleanPublishName(input.sourceTitleRaw || input.title);
    if (sourceTitle) return sourceTitle.slice(0, 200);
  }

  const candidates = [input.title, input.publishTitle, input.sourceTitleRaw];
  for (const candidate of candidates) {
    const cleaned = cleanPublishName(candidate);
    if (cleaned && !containsCjkText(cleaned)) return cleaned.slice(0, 200);
  }

  const slugTitle = extractOzonSlugTitleFromUrl(input.sourceUrl);
  if (slugTitle) return slugTitle.slice(0, 200);

  const sku = normalizeProductId(input.sourceProductId || input.sku);
  return sku ? `Ozon SKU ${sku}` : 'Ozon product title needs review';
}

export { variantWordCount };
