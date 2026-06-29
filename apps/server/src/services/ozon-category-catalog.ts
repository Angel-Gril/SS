import { randomUUID } from 'crypto';

export interface OzonCategoryTreeNode {
  description_category_id?: number | string | null;
  category_name?: string | null;
  disabled?: boolean | null;
  children?: OzonCategoryTreeNode[] | null;
  type_id?: number | string | null;
  type_name?: string | null;
}

export type OzonCategoryTranslationStatus = 'complete' | 'partial' | 'missing';

export interface OzonCategoryLevel {
  level: number;
  categoryId: number;
  nameRu: string;
  nameZh: string;
  translated: boolean;
}

export interface OzonCategoryCatalogEntry {
  descriptionCategoryId: number;
  typeId: number;
  categoryPathRu: string[];
  categoryPathZh: string[];
  categoryLevels: OzonCategoryLevel[];
  categoryNameRu: string;
  categoryNameZh: string;
  typeNameRu: string;
  typeNameZh: string;
  displayPathRu: string;
  displayPathZh: string;
  translationStatus: OzonCategoryTranslationStatus;
  untranslatedTerms: string[];
  keywords: string[];
  searchText: string;
}

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function cleanText(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value: unknown): string {
  return cleanText(value).toLowerCase();
}

const CJK_TEXT_RE = /[\u3400-\u9fff]/u;
const CYRILLIC_TEXT_RE = /[А-Яа-яЁё]/u;

function hasCjkText(value: unknown): boolean {
  return CJK_TEXT_RE.test(String(value || ''));
}

function hasCyrillicText(value: unknown): boolean {
  return CYRILLIC_TEXT_RE.test(String(value || ''));
}

function isTranslatedDisplayText(value: unknown): boolean {
  const text = cleanText(value);
  return !!text && hasCjkText(text) && !hasCyrillicText(text);
}

const CATEGORY_TRANSLATIONS: Record<string, string> = {
  'одежда': '服装',
  'женская одежда': '女装',
  'мужская одежда': '男装',
  'женские джинсы': '女式牛仔裤',
  'мужские джинсы': '男式牛仔裤',
  'джинсы': '牛仔裤',
  'мужские футболки': '男式T恤',
  'женские футболки': '女式T恤',
  'футболки': 'T恤',
  'одежда для малышей': '婴幼儿服装',
  'спецодежда': '工装/职业服',
  'брюки': '裤子',
  'штаны': '裤子',
  'джинсы для малышей': '婴幼儿牛仔裤',
  'брюки тактические': '战术裤',
  'брюки для малышей': '婴幼儿裤子',
  'термобрюки': '保暖裤',
  'белье': '内衣',
  'бельё': '内衣',
  'бюстгалтер': '文胸',
  'бюстгальтер': '文胸',
  'бюстгальтеры': '文胸',
  'аксессуар для бюстгальтера': '文胸配件',
  'ночная сорочка': '睡裙',
  'пижама': '睡衣',
  'пижамы': '睡衣',
  'пеньюар': '睡袍',
  'наматрасник': '床垫保护套',
  'держатель простыни, одеяла': '床单/被子固定夹',
  'веревка бельевая': '晾衣绳',
  'дом и сад': '家居园艺',
  'постельное белье': '床上用品',
  'инвентарь для дома': '家居用品',
  'обувь': '鞋靴',
  'радиоуправляемые игрушки': '遥控玩具',
  'игрушка радиоуправляемая': '遥控玩具',
  'аксессуары, запчасти для радиоуправляемой модели': '遥控模型配件/备件',
  'мобили и дуги в кроватку': '婴儿床铃/床挂玩具',
  'мобиль': '婴儿床铃',
  'аксессуары, запчасти для мобиля': '婴儿床铃配件/备件',
  'развивающая дуга': '婴儿健身架',
};

const KEYWORD_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/джинс|牛仔|jeans?/iu, ['牛仔裤', 'jeans', 'джинсы']],
  [/женск|女装|女士|女式|women|female/iu, ['女装', '女士', 'женская']],
  [/мужск|男装|男士|男式|men|male/iu, ['男装', '男士', 'мужская']],
  [/футбол|t-?shirt|T恤/iu, ['T恤', 'футболка', 'tshirt']],
  [/радиоуправляем|遥控/iu, ['遥控玩具', '遥控模型', 'радиоуправляемые игрушки']],
  [/мобил|кроватк|婴儿床铃|床挂/iu, ['婴儿床铃', '床挂玩具', 'мобиль']],
  [/бюстгальтер|лифчик|белье|бельё|文胸|胸罩|内衣|bra|lingerie/iu, ['文胸', '胸罩', '内衣', 'bra', 'lingerie', 'бюстгальтер']],
  [/ночн|сорочк|пижам|пеньюар|睡裙|睡衣|睡袍|nightgown|nightdress|pajamas?|pyjamas?|sleepwear/iu, ['睡裙', '睡衣', '睡袍', 'ночная сорочка', 'пижама', 'пеньюар']],
];

export function translateOzonCategoryText(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  const exact = CATEGORY_TRANSLATIONS[normalizeToken(text)];
  if (exact) return exact;

  let out = text;
  out = out.replace(/Одежда для малышей/giu, '婴幼儿服装');
  out = out.replace(/Спецодежда/giu, '工装/职业服');
  out = out.replace(/Джинсы для малышей/giu, '婴幼儿牛仔裤');
  out = out.replace(/Брюки тактические/giu, '战术裤');
  out = out.replace(/Брюки для малышей/giu, '婴幼儿裤子');
  out = out.replace(/Термобрюки/giu, '保暖裤');
  out = out.replace(/Бель[её]/giu, '内衣');
  out = out.replace(/Бюстгалтер/giu, '文胸');
  out = out.replace(/Бюстгальтеры?/giu, '文胸');
  out = out.replace(/Аксессуар для бюстгальтера/giu, '文胸配件');
  out = out.replace(/Ночная сорочка/giu, '睡裙');
  out = out.replace(/Пижамы?/giu, '睡衣');
  out = out.replace(/Пеньюар/giu, '睡袍');
  out = out.replace(/Наматрасник/giu, '床垫保护套');
  out = out.replace(/Держатель простыни, одеяла/giu, '床单/被子固定夹');
  out = out.replace(/Веревка бельевая/giu, '晾衣绳');
  out = out.replace(/Дом и сад/giu, '家居园艺');
  out = out.replace(/Постельное белье/giu, '床上用品');
  out = out.replace(/Инвентарь для дома/giu, '家居用品');
  out = out.replace(/Обувь/giu, '鞋靴');
  out = out.replace(/Женские джинсы/giu, '女式牛仔裤');
  out = out.replace(/Мужские джинсы/giu, '男式牛仔裤');
  out = out.replace(/Джинсы/giu, '牛仔裤');
  out = out.replace(/Брюки/giu, '裤子');
  out = out.replace(/Штаны/giu, '裤子');
  out = out.replace(/Женская одежда/giu, '女装');
  out = out.replace(/Мужская одежда/giu, '男装');
  out = out.replace(/Одежда/giu, '服装');
  out = out.replace(/Женские футболки/giu, '女式T恤');
  out = out.replace(/Мужские футболки/giu, '男式T恤');
  out = out.replace(/Футболки/giu, 'T恤');
  out = out.replace(/Аксессуары,\s*запчасти для радиоуправляемой модели/giu, '遥控模型配件/备件');
  out = out.replace(/Радиоуправляемые игрушки/giu, '遥控玩具');
  out = out.replace(/Игрушка радиоуправляемая/giu, '遥控玩具');
  out = out.replace(/Мобили и дуги в кроватку/giu, '婴儿床铃/床挂玩具');
  out = out.replace(/Аксессуары,\s*запчасти для мобиля/giu, '婴儿床铃配件/备件');
  out = out.replace(/Развивающая дуга/giu, '婴儿健身架');
  out = out.replace(/Мобиль/giu, '婴儿床铃');
  return out === text ? text : out;
}

function translateOzonCategoryTextForDisplay(value: unknown): string {
  const translated = cleanText(translateOzonCategoryText(value));
  return isTranslatedDisplayText(translated) ? translated : '';
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function buildKeywords(parts: string[]): string[] {
  const base = unique(parts.flatMap((part) => [part, translateOzonCategoryText(part)]));
  const expanded = [...base];
  const text = base.join(' ');
  for (const [pattern, words] of KEYWORD_EXPANSIONS) {
    if (pattern.test(text)) expanded.push(...words);
  }
  return unique(expanded);
}

function resolveTranslationStatus(parts: Array<{ raw: string; translated: boolean }>): {
  translationStatus: OzonCategoryTranslationStatus;
  untranslatedTerms: string[];
} {
  const meaningful = parts.filter((part) => cleanText(part.raw));
  const untranslatedTerms = unique(meaningful
    .filter((part) => !part.translated && !hasCjkText(part.raw))
    .map((part) => part.raw));
  if (untranslatedTerms.length === 0) {
    return { translationStatus: 'complete', untranslatedTerms };
  }
  const translatedCount = meaningful.filter((part) => part.translated).length;
  return {
    translationStatus: translatedCount > 0 ? 'partial' : 'missing',
    untranslatedTerms,
  };
}

export function buildOzonCategoryCatalog(nodes: OzonCategoryTreeNode[] | null | undefined): OzonCategoryCatalogEntry[] {
  const catalog: OzonCategoryCatalogEntry[] = [];

  const walk = (rows: OzonCategoryTreeNode[], pathLevels: OzonCategoryLevel[], parentCategoryId: number | null = null) => {
    for (const row of rows) {
      if (row.disabled) continue;

      const categoryName = cleanText(row.category_name);
      const rowCategoryId = toPositiveInt(row.description_category_id);
      const categoryId = rowCategoryId ?? parentCategoryId;
      const nextPath = categoryName
        ? [
          ...pathLevels,
          {
            level: pathLevels.length + 1,
            categoryId: categoryId || 0,
            nameRu: categoryName,
            nameZh: translateOzonCategoryTextForDisplay(categoryName),
            translated: !!translateOzonCategoryTextForDisplay(categoryName),
          },
        ]
        : pathLevels;
      const typeId = toPositiveInt(row.type_id);
      const typeNameRu = cleanText(row.type_name);

      if (categoryId && typeId) {
        const categoryLevels = nextPath.map((level) => ({ ...level }));
        const categoryPathRu = categoryLevels.map((level) => level.nameRu);
        const categoryPathZh = categoryLevels.map((level) => level.nameZh);
        const typeNameZh = translateOzonCategoryTextForDisplay(typeNameRu);
        const categoryNameRu = categoryPathRu[categoryPathRu.length - 1] || '';
        const categoryNameZh = categoryPathZh[categoryPathZh.length - 1] || '';
        const typeTranslated = !!typeNameZh;
        const { translationStatus, untranslatedTerms } = resolveTranslationStatus([
          ...categoryLevels.map((level) => ({ raw: level.nameRu, translated: level.translated })),
          { raw: typeNameRu, translated: typeTranslated },
        ]);
        const ruParts = [...categoryPathRu, typeNameRu].filter(Boolean);
        const displayZhParts = [
          ...categoryLevels.map((level) => level.nameZh || `待翻译类目${level.level}`),
          typeNameRu ? (typeNameZh || '待翻译类型') : '',
        ].filter(Boolean);
        const zhParts = [...categoryPathZh, typeNameZh, ...displayZhParts].filter(Boolean);
        const keywords = buildKeywords([...ruParts, ...zhParts, String(categoryId), String(typeId)]);

        catalog.push({
          descriptionCategoryId: categoryId,
          typeId,
          categoryPathRu,
          categoryPathZh,
          categoryLevels,
          categoryNameRu,
          categoryNameZh,
          typeNameRu,
          typeNameZh,
          displayPathRu: ruParts.join(' / '),
          displayPathZh: displayZhParts.join(' / '),
          translationStatus,
          untranslatedTerms,
          keywords,
          searchText: normalizeToken([...ruParts, ...zhParts, ...keywords, categoryId, typeId].join(' ')),
        });
      }

      if (Array.isArray(row.children) && row.children.length) {
        walk(row.children, nextPath, categoryId);
      }
    }
  };

  if (Array.isArray(nodes)) walk(nodes, []);
  return catalog;
}

export type OzonCategoryTermTranslator = (term: string) => Promise<{ outputText: string; source?: string }>;

export interface EnrichOzonCategoryCatalogTranslationDeps {
  translateTerm: OzonCategoryTermTranslator;
}

function isValidAiCategoryTranslation(value: unknown): boolean {
  const text = cleanText(value);
  if (!text) return false;
  if (!hasCjkText(text) || hasCyrillicText(text)) return false;
  if (text.length > 80) return false;
  if (/[。！？!?]|翻译|意思|表示|如下|категор|перевод/i.test(text)) return false;
  return true;
}

function buildDisplayZhParts(categoryLevels: OzonCategoryLevel[], typeNameRu: string, typeNameZh: string): string[] {
  return [
    ...categoryLevels.map((level) => level.nameZh || `待翻译类目${level.level}`),
    typeNameRu ? (typeNameZh || '待翻译类型') : '',
  ].filter(Boolean);
}

function collectCatalogEntryTerms(entry: OzonCategoryCatalogEntry): string[] {
  return unique([
    ...entry.categoryLevels.map((level) => level.nameRu),
    ...entry.categoryPathRu,
    entry.categoryNameRu,
    entry.typeNameRu,
    ...entry.untranslatedTerms,
  ]);
}

export function applyOzonCategoryCatalogLocalTranslations(catalog: OzonCategoryCatalogEntry[]): OzonCategoryCatalogEntry[] {
  const translatedTerms = new Map<string, string>();
  for (const entry of catalog) {
    for (const term of collectCatalogEntryTerms(entry)) {
      const translated = translateOzonCategoryTextForDisplay(term);
      if (translated) translatedTerms.set(term, translated);
    }
  }
  if (translatedTerms.size === 0) return catalog.map((entry) => ({ ...entry }));
  return catalog.map((entry) => rebuildCatalogEntryWithTranslations(entry, translatedTerms));
}

function rebuildCatalogEntryWithTranslations(
  entry: OzonCategoryCatalogEntry,
  translatedTerms: Map<string, string>,
): OzonCategoryCatalogEntry {
  const categoryLevels = entry.categoryLevels.map((level) => {
    const translated = cleanText(level.nameZh || translatedTerms.get(level.nameRu) || '');
    return {
      ...level,
      nameZh: isTranslatedDisplayText(translated) ? translated : '',
      translated: isTranslatedDisplayText(translated),
    };
  });
  const typeTranslated = cleanText(entry.typeNameZh || translatedTerms.get(entry.typeNameRu) || '');
  const typeNameZh = isTranslatedDisplayText(typeTranslated) ? typeTranslated : '';
  const categoryPathZh = categoryLevels.map((level) => level.nameZh);
  const categoryNameZh = categoryPathZh[categoryPathZh.length - 1] || '';
  const audit = resolveTranslationStatus([
    ...categoryLevels.map((level) => ({ raw: level.nameRu, translated: level.translated })),
    { raw: entry.typeNameRu, translated: !!typeNameZh },
  ]);
  const displayZhParts = buildDisplayZhParts(categoryLevels, entry.typeNameRu, typeNameZh);
  const ruParts = [...entry.categoryPathRu, entry.typeNameRu].filter(Boolean);
  const zhParts = [...categoryPathZh, typeNameZh, ...displayZhParts].filter(Boolean);
  const keywords = buildKeywords([...ruParts, ...zhParts, String(entry.descriptionCategoryId), String(entry.typeId)]);
  return {
    ...entry,
    categoryPathZh,
    categoryLevels,
    categoryNameZh,
    typeNameZh,
    displayPathZh: displayZhParts.join(' / '),
    translationStatus: audit.translationStatus,
    untranslatedTerms: audit.untranslatedTerms,
    keywords,
    searchText: normalizeToken([...ruParts, ...zhParts, ...keywords, entry.descriptionCategoryId, entry.typeId].join(' ')),
  };
}

export async function enrichMissingOzonCategoryCatalogTranslations(
  catalog: OzonCategoryCatalogEntry[],
  deps: EnrichOzonCategoryCatalogTranslationDeps,
): Promise<OzonCategoryCatalogEntry[]> {
  const localCatalog = applyOzonCategoryCatalogLocalTranslations(catalog);
  const missingTerms = unique(localCatalog.flatMap((entry) => entry.untranslatedTerms));
  if (!missingTerms.length) return localCatalog.map((entry) => ({ ...entry }));

  const translatedTerms = new Map<string, string>();
  for (const term of missingTerms) {
    try {
      const result = await deps.translateTerm(term);
      const translated = cleanText(result.outputText);
      if (isValidAiCategoryTranslation(translated)) translatedTerms.set(term, translated);
    } catch {
      // Category translation is best-effort; invalid or failed provider calls must not poison the catalog.
    }
  }

  return localCatalog.map((entry) => rebuildCatalogEntryWithTranslations(entry, translatedTerms));
}
export function searchOzonCategoryCatalog(
  catalog: OzonCategoryCatalogEntry[],
  query: unknown,
  limit = 20,
): OzonCategoryCatalogEntry[] {
  const raw = cleanText(query);
  if (!raw) return catalog.slice(0, limit);

  const terms = unique([
    raw,
    ...raw.split(/[\s,/|;:，。；：、]+/u),
    ...buildKeywords([raw]),
  ]).map(normalizeToken);

  return catalog
    .map((entry) => {
      let score = 0;
      for (const term of terms) {
        if (!term) continue;
        if (entry.searchText.includes(term)) score += term.length > 2 ? 12 : 4;
        if (String(entry.descriptionCategoryId) === term || String(entry.typeId) === term) score += 80;
      }
      return { entry, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.displayPathZh.localeCompare(b.entry.displayPathZh, 'zh-CN'))
    .slice(0, limit)
    .map((row) => row.entry);
}

export interface OzonCategoryCatalogStore {
  list(shopId: string, language: string): Promise<OzonCategoryCatalogEntry[]>;
  replace(shopId: string, language: string, entries: OzonCategoryCatalogEntry[], fetchedAt: Date): Promise<number>;
}

export interface SearchOzonCategoryCatalogParams {
  shopId: string;
  query?: unknown;
  language?: string;
  limit?: number;
  refresh?: boolean;
}

export interface SearchOzonCategoryCatalogDeps {
  store: OzonCategoryCatalogStore;
  fetchTree(): Promise<OzonCategoryTreeNode[]>;
  enrichMissingTranslations?(entries: OzonCategoryCatalogEntry[]): Promise<OzonCategoryCatalogEntry[]>;
  now?: () => Date;
}

function categoryCatalogTranslationFingerprint(catalog: OzonCategoryCatalogEntry[]): string {
  return catalog.map((entry) => [
    entry.descriptionCategoryId,
    entry.typeId,
    entry.displayPathZh,
    entry.translationStatus,
    entry.untranslatedTerms.join('|'),
  ].join(':')).join('\n');
}

function hasCatalogTranslationGaps(catalog: OzonCategoryCatalogEntry[]): boolean {
  return catalog.some((entry) => entry.translationStatus !== 'complete' || entry.untranslatedTerms.length > 0);
}

export async function searchOrRefreshOzonCategoryCatalogForShop(
  params: SearchOzonCategoryCatalogParams,
  deps: SearchOzonCategoryCatalogDeps,
): Promise<{ entries: OzonCategoryCatalogEntry[]; total: number; refreshed: boolean }> {
  const language = cleanText(params.language) || 'DEFAULT';
  let catalog = await deps.store.list(params.shopId, language);
  let refreshed = false;
  let changed = false;

  if (params.refresh || catalog.length === 0) {
    catalog = buildOzonCategoryCatalog(await deps.fetchTree());
    refreshed = true;
  }

  let before = categoryCatalogTranslationFingerprint(catalog);
  catalog = applyOzonCategoryCatalogLocalTranslations(catalog);
  changed = categoryCatalogTranslationFingerprint(catalog) !== before;

  if (deps.enrichMissingTranslations && hasCatalogTranslationGaps(catalog)) {
    before = categoryCatalogTranslationFingerprint(catalog);
    catalog = await deps.enrichMissingTranslations(catalog);
    changed = changed || categoryCatalogTranslationFingerprint(catalog) !== before;
  }

  if (refreshed || changed) {
    await deps.store.replace(params.shopId, language, catalog, deps.now?.() || new Date());
  }

  return {
    entries: searchOzonCategoryCatalog(catalog, params.query, params.limit || 20),
    total: catalog.length,
    refreshed,
  };
}

export type PrismaOzonCategoryCatalogClient = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: any[]): Promise<number>;
  $transaction?<T>(fn: (tx: PrismaOzonCategoryCatalogClient) => Promise<T>): Promise<T>;
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean);
}

function categoryLevelArray(value: unknown): OzonCategoryLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const data = row as Record<string, unknown>;
      const level = toPositiveInt(data.level) || index + 1;
      const categoryId = toPositiveInt(data.categoryId) || 0;
      const nameRu = cleanText(data.nameRu);
      const nameZh = cleanText(data.nameZh);
      return {
        level,
        categoryId,
        nameRu,
        nameZh,
        translated: isTranslatedDisplayText(nameZh),
      };
    })
    .filter((row): row is OzonCategoryLevel => !!row && (!!row.nameRu || !!row.nameZh));
}

function translationStatus(value: unknown): OzonCategoryTranslationStatus {
  return value === 'complete' || value === 'partial' || value === 'missing' ? value : 'missing';
}

function buildStoredCategoryLevels(
  categoryPathRu: string[],
  categoryPathZh: string[],
  descriptionCategoryId: number,
): OzonCategoryLevel[] {
  const length = Math.max(categoryPathRu.length, categoryPathZh.length);
  return Array.from({ length }, (_, index) => {
    const nameRu = categoryPathRu[index] || '';
    const nameZh = categoryPathZh[index] || '';
    return {
      level: index + 1,
      categoryId: index === categoryPathRu.length - 1 ? descriptionCategoryId : 0,
      nameRu,
      nameZh,
      translated: isTranslatedDisplayText(nameZh),
    };
  }).filter((row) => !!row.nameRu || !!row.nameZh);
}

function mapCatalogRow(row: Record<string, any>): OzonCategoryCatalogEntry {
  const descriptionCategoryId = Number(row.descriptionCategoryId);
  const typeId = Number(row.typeId);
  const categoryPathRu = stringArray(row.categoryPathRu);
  const categoryPathZh = stringArray(row.categoryPathZh);
  const storedCategoryLevels = categoryLevelArray(row.categoryLevels);
  const categoryLevels = storedCategoryLevels.length > 0
    ? storedCategoryLevels
    : buildStoredCategoryLevels(categoryPathRu, categoryPathZh, descriptionCategoryId);
  const typeNameRu = cleanText(row.typeNameRu);
  const typeNameZh = cleanText(row.typeNameZh);
  const derivedTranslation = resolveTranslationStatus([
    ...categoryLevels.map((level) => ({
      raw: level.nameRu,
      translated: isTranslatedDisplayText(level.nameZh),
    })),
    { raw: typeNameRu, translated: isTranslatedDisplayText(typeNameZh) },
  ]);

  return {
    descriptionCategoryId,
    typeId,
    categoryPathRu,
    categoryPathZh,
    categoryLevels,
    categoryNameRu: cleanText(row.categoryNameRu),
    categoryNameZh: cleanText(row.categoryNameZh),
    typeNameRu,
    typeNameZh,
    displayPathRu: cleanText(row.displayPathRu),
    displayPathZh: cleanText(row.displayPathZh),
    translationStatus: derivedTranslation.translationStatus || translationStatus(row.translationStatus),
    untranslatedTerms: derivedTranslation.untranslatedTerms,
    keywords: stringArray(row.keywords),
    searchText: normalizeToken(row.searchText),
  };
}

export function createPrismaOzonCategoryCatalogStore(
  prisma: PrismaOzonCategoryCatalogClient,
): OzonCategoryCatalogStore {
  return {
    async list(shopId, language) {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT
          "description_category_id" AS "descriptionCategoryId",
          "type_id" AS "typeId",
          "category_path_ru" AS "categoryPathRu",
          "category_path_zh" AS "categoryPathZh",
          "category_levels_json" AS "categoryLevels",
          "category_name_ru" AS "categoryNameRu",
          "category_name_zh" AS "categoryNameZh",
          "type_name_ru" AS "typeNameRu",
          "type_name_zh" AS "typeNameZh",
          "display_path_ru" AS "displayPathRu",
          "display_path_zh" AS "displayPathZh",
          "translation_status" AS "translationStatus",
          "untranslated_terms_json" AS "untranslatedTerms",
          "keywords_json" AS "keywords",
          "search_text" AS "searchText"
        FROM "ozon_category_catalog"
        WHERE "shop_id" = ${shopId}
          AND "language" = ${language}
        ORDER BY "display_path_zh" ASC, "display_path_ru" ASC
      `;
      return rows.map(mapCatalogRow).filter((entry) => entry.descriptionCategoryId > 0 && entry.typeId > 0);
    },

    async replace(shopId, language, entries, fetchedAt) {
      const run = async (tx: PrismaOzonCategoryCatalogClient) => {
        await tx.$executeRaw`
          DELETE FROM "ozon_category_catalog"
          WHERE "shop_id" = ${shopId}
            AND "language" = ${language}
        `;

        for (const entry of entries) {
          await tx.$executeRaw`
            INSERT INTO "ozon_category_catalog" (
              "id",
              "shop_id",
              "language",
              "description_category_id",
              "type_id",
              "category_path_ru",
              "category_path_zh",
              "category_levels_json",
              "category_name_ru",
              "category_name_zh",
              "type_name_ru",
              "type_name_zh",
              "display_path_ru",
              "display_path_zh",
              "translation_status",
              "untranslated_terms_json",
              "keywords_json",
              "search_text",
              "fetched_at",
              "source",
              "updated_at"
            ) VALUES (
              ${randomUUID()},
              ${shopId},
              ${language},
              ${entry.descriptionCategoryId},
              ${entry.typeId},
              CAST(${JSON.stringify(entry.categoryPathRu)} AS jsonb),
              CAST(${JSON.stringify(entry.categoryPathZh)} AS jsonb),
              CAST(${JSON.stringify(entry.categoryLevels)} AS jsonb),
              ${entry.categoryNameRu},
              ${entry.categoryNameZh},
              ${entry.typeNameRu},
              ${entry.typeNameZh},
              ${entry.displayPathRu},
              ${entry.displayPathZh},
              ${entry.translationStatus},
              CAST(${JSON.stringify(entry.untranslatedTerms)} AS jsonb),
              CAST(${JSON.stringify(entry.keywords)} AS jsonb),
              ${entry.searchText},
              ${fetchedAt},
              'ozon_api',
              CURRENT_TIMESTAMP
            )
          `;
        }
        return entries.length;
      };

      return prisma.$transaction ? prisma.$transaction(run) : run(prisma);
    },
  };
}
