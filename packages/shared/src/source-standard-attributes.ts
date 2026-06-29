export interface SourceStandardAttributeValue {
  value: string;
  source?: string;
}

export interface SourceStandardAttributes {
  brand: SourceStandardAttributeValue & { isBrandless: boolean };
  colors: string[];
  sizes: string[];
  materials: string[];
  gender: SourceStandardAttributeValue;
  seasons: string[];
  packageDimensionsMm: { length: number; width: number; height: number } | null;
  packageWeightG: number | null;
  categoryHints: string[];
  missingForOzon: string[];
}

interface SourceItemLike {
  title?: unknown;
  variants?: unknown;
  metadata?: Record<string, unknown> | null;
}

function text(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function positiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function metadataArray(item: SourceItemLike, key: string): unknown[] {
  const value = item.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

function sourceAttributes(item: SourceItemLike): Array<Record<string, unknown>> {
  return objectArray(item.metadata?.sourceAttributes);
}

function sourceVariants(item: SourceItemLike): Array<Record<string, unknown>> {
  return objectArray(Array.isArray(item.variants) ? item.variants : item.metadata?.skuItems);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = text(raw);
    const key = lower(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function splitList(value: unknown): string[] {
  return dedupe(text(value)
    .split(/\s*(?:,|，|、|;|；|\|)\s*/u)
    .map(text)
    .filter(Boolean));
}

const DOWNSTREAM_PLATFORM_SUFFIX_RE = /\s*(?:主要下游平台|下游平台|跨境平台|适用平台|销售平台|平台渠道|渠道平台).*$/iu;
const DOWNSTREAM_PLATFORM_VALUE_RE = /^(?:lazada|ebay|e-bay|shopee|amazon|aliexpress|ali\s*express|shein|temu|tiktok|tik\s*tok|wish|walmart|ozon)$/i;
const SOURCE_SIZE_TOKEN_RE = /^(?:\d+\s*XL|XXXXL|XXXL|XXL|XL|XS|L|M|S|均码|\d{2,3})$/i;

function normalizeSourceSizeToken(value: string): string {
  return value.replace(/^(\d+)\s+XL$/i, '$1XL').toUpperCase();
}

function splitSourceStandardSizeValue(value: string): string[] {
  const tokens = value.split(/\s+/u).map(text).filter(Boolean);
  if (tokens.length <= 1) return [value];
  const relevant = tokens.filter((token) => !DOWNSTREAM_PLATFORM_VALUE_RE.test(token));
  if (relevant.length >= 2 && relevant.every((token) => SOURCE_SIZE_TOKEN_RE.test(token))) {
    return relevant.map(normalizeSourceSizeToken);
  }
  return [value];
}

export function sanitizeSourceStandardSizeValues(values: unknown[]): string[] {
  const cleaned = values.flatMap((raw) => {
    const value = text(raw).replace(DOWNSTREAM_PLATFORM_SUFFIX_RE, '').trim();
    if (!value || DOWNSTREAM_PLATFORM_VALUE_RE.test(value)) return [];
    return splitList(value)
      .flatMap(splitSourceStandardSizeValue)
      .filter((part) => !DOWNSTREAM_PLATFORM_VALUE_RE.test(part));
  });
  return dedupe(cleaned);
}

function attrName(attr: Record<string, unknown>): string {
  return text(attr.name ?? attr.key ?? attr.attributeName ?? attr.attrName);
}

function attrValue(attr: Record<string, unknown>): string {
  return text(attr.value ?? attr.attrValue ?? attr.text);
}

function valuesByName(item: SourceItemLike, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const attr of sourceAttributes(item)) {
    if (!pattern.test(attrName(attr))) continue;
    out.push(...splitList(attrValue(attr)));
  }
  return dedupe(out);
}

function variantValuesByName(item: SourceItemLike, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const variant of sourceVariants(item)) {
    const attrs = variant.attrs && typeof variant.attrs === 'object' && !Array.isArray(variant.attrs)
      ? variant.attrs as Record<string, unknown>
      : {};
    for (const [name, value] of Object.entries(attrs)) {
      if (pattern.test(name)) out.push(...splitList(value));
    }
  }
  return dedupe(out);
}

function normalizeBrand(item: SourceItemLike): SourceStandardAttributes['brand'] {
  const value = valuesByName(item, /品牌|商标|牌子|brand/i)[0] || '';
  const isBrandless = /^(?:其他|其它|无品牌|无牌|no\s*brand|unbranded|без бренда)$/i.test(value);
  return { value, isBrandless, source: value ? 'sourceAttributes' : undefined };
}

function inferGender(value: unknown, source: string): SourceStandardAttributeValue | null {
  const raw = text(value);
  if (!raw) return null;
  if (/男女|情侣|通用|中性|unisex/i.test(raw)) return { value: 'unisex', source };
  if (/(?:^|[\s,，、/|])女(?:$|[\s,，、/|])|女装|女士|女款|女性|女人|女童|女孩|睡裙|连衣裙|半身裙|新娘服|婚纱|文胸|胸罩|women|woman|female|girl/i.test(raw)) return { value: 'female', source };
  if (/(?:^|[\s,，、/|])男(?:$|[\s,，、/|])|男装|男士|男款|男性|男人|男童|男孩|men|man|male|boy/i.test(raw)) return { value: 'male', source };
  return null;
}

function normalizeGender(item: SourceItemLike): SourceStandardAttributeValue {
  const raw = valuesByName(item, /性别|适用性别|适用人群|适合人群|gender/i)[0] || '';
  const fromAttributes = inferGender(raw, 'sourceAttributes');
  if (fromAttributes) return fromAttributes;
  const fromTitle = inferGender(item.title, 'title');
  if (fromTitle) return fromTitle;
  return { value: raw, source: raw ? 'sourceAttributes' : undefined };
}

function normalizeSeasons(item: SourceItemLike): string[] {
  const raws = valuesByName(item, /季节|适合季节|season|上市年份\/季节|上市年份季节/i);
  const mapped = raws.map((raw) => {
    if (/四季|全年|通用|all\s*season/i.test(raw)) return 'all-season';
    if (/春|spring/i.test(raw)) return 'spring';
    if (/夏|summer/i.test(raw)) return 'summer';
    if (/秋|autumn|fall/i.test(raw)) return 'autumn';
    if (/冬|winter/i.test(raw)) return 'winter';
    return raw;
  });
  return dedupe(mapped);
}

function normalizePackage(item: SourceItemLike): Pick<SourceStandardAttributes, 'packageDimensionsMm' | 'packageWeightG'> {
  const rows = objectArray(metadataArray(item, 'sourcePackagingRows'));
  const directWeight = positiveNumber(item.metadata?.weightG);
  const directLength = positiveNumber(item.metadata?.lengthMm);
  const directWidth = positiveNumber(item.metadata?.widthMm);
  const directHeight = positiveNumber(item.metadata?.heightMm);

  let packageWeightG = directWeight;
  let dimensions = directLength && directWidth && directHeight
    ? { length: directLength, width: directWidth, height: directHeight }
    : null;

  for (const row of rows) {
    if (!packageWeightG) packageWeightG = positiveNumber(row.weightG);
    if (!dimensions) {
      const length = positiveNumber(row.lengthMm);
      const width = positiveNumber(row.widthMm);
      const height = positiveNumber(row.heightMm);
      if (length && width && height) dimensions = { length, width, height };
    }
    if (packageWeightG && dimensions) break;
  }

  return { packageDimensionsMm: dimensions, packageWeightG };
}

function categoryHints(item: SourceItemLike): string[] {
  const path = metadataArray(item, 'categoryPath').map(text).filter(Boolean);
  const name = text(item.metadata?.categoryName);
  return dedupe([...path, name]);
}

export function normalizeSourceStandardAttributes(item: SourceItemLike): SourceStandardAttributes {
  const brand = normalizeBrand(item);
  const colors = dedupe([
    ...valuesByName(item, /颜色|色号|color|colour|цвет/i),
    ...variantValuesByName(item, /颜色|色号|color|colour|цвет/i),
  ]);
  const sizes = dedupe([
    ...sanitizeSourceStandardSizeValues(valuesByName(item, /尺码|尺寸|规格|size|размер/i)),
    ...sanitizeSourceStandardSizeValues(variantValuesByName(item, /尺码|尺寸|规格|size|размер/i)),
  ]);
  const materials = valuesByName(item, /材质|成分|面料|主面料|里料|material|composition/i);
  const gender = normalizeGender(item);
  const seasons = normalizeSeasons(item);
  const pack = normalizePackage(item);

  const missingForOzon: string[] = [];
  if (!brand.value && !brand.isBrandless) missingForOzon.push('品牌/无品牌');
  if (!colors.length || !sizes.length) missingForOzon.push('颜色尺码变体');
  if (!materials.length) missingForOzon.push('材质/成分');
  if (!gender.value || !seasons.length) missingForOzon.push('性别/季节');
  if (!pack.packageWeightG) missingForOzon.push('重量');
  if (!pack.packageDimensionsMm) missingForOzon.push('包装尺寸');

  return {
    brand,
    colors,
    sizes,
    materials,
    gender,
    seasons,
    packageDimensionsMm: pack.packageDimensionsMm,
    packageWeightG: pack.packageWeightG,
    categoryHints: categoryHints(item),
    missingForOzon,
  };
}

