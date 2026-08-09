import { createHash, randomUUID } from 'crypto';
import {
  getOzonCategoryLocalExcludeExpansions,
  getOzonCategoryLocalKeywordExpansions,
  getOzonCategoryLocalSearchTermsForTarget,
  getOzonCategoryLocalTranslation,
} from './ozon-category-local-rules.js';

export {
  getOzonCategoryLocalRuleStats,
  getOzonCategoryLocalSearchTermsForTarget,
} from './ozon-category-local-rules.js';

export interface OzonCategoryTreeNode {
  description_category_id?: number | string | null;
  category_name?: string | null;
  disabled?: boolean | null;
  children?: OzonCategoryTreeNode[] | null;
  type_id?: number | string | null;
  type_name?: string | null;
}

export type OzonCategoryTranslationStatus = 'complete' | 'partial' | 'missing';

export type OzonCategoryLabelSource =
  | 'official_default'
  | 'official_zh_hans'
  | 'local_dictionary'
  | 'ai'
  | 'legacy'
  | 'missing';

export interface OzonCategoryLabelProvenance {
  categoryPathRu: OzonCategoryLabelSource[];
  categoryPathZh: OzonCategoryLabelSource[];
  typeNameRu: OzonCategoryLabelSource;
  typeNameZh: OzonCategoryLabelSource;
}

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
  disabled?: boolean;
  selectable?: boolean;
  labelProvenance?: OzonCategoryLabelProvenance;
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
  'бдсм': '成人情趣用品',
  'электронные книги, переводчики и словари': '电子书/翻译器/词典',
  'ala': '硫辛酸',
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
  'брюки рабочие': '工作裤',
  'штаны для прессотерапии': '压力治疗裤',
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
  'пеньюар для стрижки': '理发围布',
  'футболка': 'T恤',
  'красота и гигиена': '美容卫生',
  'ватно-бумажная продукция': '棉纸用品',
  'ватные палочки': '棉签',
  'покрытие на сиденье унитаза': '马桶坐垫纸',
  'мебель и оборудование для салонов красоты': '美容院家具设备',
  'инвентарь для уборки': '清洁工具',
  'щетка для уборки': '清洁刷',
  'личная гигиена': '个人卫生',
  'беруши': '耳塞',
  'аптека': '药房/健康',
  'хобби и творчество': '兴趣手工',
  'инструмент для рукоделия': '手工工具',
  'пяльцы': '绣绷',
  'массажеры, коврики, акупунктура': '按摩/理疗用品',
  'ванночка глазная': '洗眼杯',
  'канцелярские товары': '文具',
  'письменные принадлежности': '书写用品',
  'мел портновский': '裁缝粉笔',
  'галантерея и аксессуары': '箱包配饰',
  'аксессуары для волос': '发饰',
  'ободок': '发箍',
  'повязка для волос': '发带',
  'гребень': '发梳',
  'расческа': '梳子',
  'аксессуары': '配饰',
  'сумка': '包',
  'берет': '贝雷帽',
  'кепка': '棒球帽',
  'шапка': '帽子',
  'косметичка': '化妆包',
  'мочалки и спонжи': '浴擦/海绵',
  'спонж косметический': '化妆海绵',
  'детские товары': '儿童用品',
  'игрушки': '玩具',
  'мягкая игрушка': '毛绒玩具',
  'булавка': '别针',
  'аксессуары для творчества': '手工配件',
  'распарыватель': '拆线器',
  'массаж': '按摩',
  'механический массажер для головы': '头皮按摩器',
  'маска для сна': '睡眠眼罩',
  'средства для гигиены тела': '身体清洁用品',
  'твердое мыло': '固体皂',
  'хранение вещей': '物品收纳',
  'коробка для хранения': '收纳盒',
  'органайзер для хранения вещей': '收纳整理盒',
  'чертежные принадлежности': '绘图用品',
  'линейка': '尺子',
  'нитевдеватель': '穿针器',
  'вешалки для одежды': '衣架挂钩',
  'крючок для дома': '家用挂钩',
  'мебель': '家具',
  'мебельная фурнитура и комплектующие': '家具五金配件',
  'крючок мебельный': '家具挂钩',
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
  const local = getOzonCategoryLocalTranslation(text);
  if (local) return local;
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
  out = out.replace(/Пеньюар для стрижки/giu, '理发围布');
  out = out.replace(/Ночная сорочка/giu, '睡裙');
  out = out.replace(/Пижамы?/giu, '睡衣');
  out = out.replace(/Пеньюар/giu, '睡袍');
  out = out.replace(/Футболка/giu, 'T恤');
  out = out.replace(/Красота и гигиена/giu, '美容卫生');
  out = out.replace(/Ватно-бумажная продукция/giu, '棉纸用品');
  out = out.replace(/Ватные палочки/giu, '棉签');
  out = out.replace(/Покрытие на сиденье унитаза/giu, '马桶坐垫纸');
  out = out.replace(/Мебель и оборудование для салонов красоты/giu, '美容院家具设备');
  out = out.replace(/Инвентарь для уборки/giu, '清洁工具');
  out = out.replace(/Щетка для уборки/giu, '清洁刷');
  out = out.replace(/Личная гигиена/giu, '个人卫生');
  out = out.replace(/Беруши/giu, '耳塞');
  out = out.replace(/Аптека/giu, '药房/健康');
  out = out.replace(/Хобби и творчество/giu, '兴趣手工');
  out = out.replace(/Инструмент для рукоделия/giu, '手工工具');
  out = out.replace(/Пяльцы/giu, '绣绷');
  out = out.replace(/Массажеры, коврики, акупунктура/giu, '按摩/理疗用品');
  out = out.replace(/Ванночка глазная/giu, '洗眼杯');
  out = out.replace(/Канцелярские товары/giu, '文具');
  out = out.replace(/Письменные принадлежности/giu, '书写用品');
  out = out.replace(/Мел портновский/giu, '裁缝粉笔');
  out = out.replace(/Галантерея и аксессуары/giu, '箱包配饰');
  out = out.replace(/Аксессуары для волос/giu, '发饰');
  out = out.replace(/Ободок/giu, '发箍');
  out = out.replace(/Повязка для волос/giu, '发带');
  out = out.replace(/Гребень/giu, '发梳');
  out = out.replace(/Расческа/giu, '梳子');
  out = out.replace(/Аксессуары/giu, '配饰');
  out = out.replace(/Сумка/giu, '包');
  out = out.replace(/Берет/giu, '贝雷帽');
  out = out.replace(/Кепка/giu, '棒球帽');
  out = out.replace(/Шапка/giu, '帽子');
  out = out.replace(/Косметичка/giu, '化妆包');
  out = out.replace(/Мочалки и спонжи/giu, '浴擦/海绵');
  out = out.replace(/Спонж косметический/giu, '化妆海绵');
  out = out.replace(/Детские товары/giu, '儿童用品');
  out = out.replace(/Игрушки/giu, '玩具');
  out = out.replace(/Мягкая игрушка/giu, '毛绒玩具');
  out = out.replace(/Булавка/giu, '别针');
  out = out.replace(/Аксессуары для творчества/giu, '手工配件');
  out = out.replace(/Распарыватель/giu, '拆线器');
  out = out.replace(/Массаж/giu, '按摩');
  out = out.replace(/Механический массажер для головы/giu, '头皮按摩器');
  out = out.replace(/Маска для сна/giu, '睡眠眼罩');
  out = out.replace(/Средства для гигиены тела/giu, '身体清洁用品');
  out = out.replace(/Твердое мыло/giu, '固体皂');
  out = out.replace(/Хранение вещей/giu, '物品收纳');
  out = out.replace(/Коробка для хранения/giu, '收纳盒');
  out = out.replace(/Органайзер для хранения вещей/giu, '收纳整理盒');
  out = out.replace(/Чертежные принадлежности/giu, '绘图用品');
  out = out.replace(/Линейка/giu, '尺子');
  out = out.replace(/Нитевдеватель/giu, '穿针器');
  out = out.replace(/Вешалки для одежды/giu, '衣架挂钩');
  out = out.replace(/Крючок для дома/giu, '家用挂钩');
  out = out.replace(/Мебельная фурнитура и комплектующие/giu, '家具五金配件');
  out = out.replace(/Крючок мебельный/giu, '家具挂钩');
  out = out.replace(/Мебель/giu, '家具');
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
  const expanded = [...base, ...getOzonCategoryLocalKeywordExpansions(base)];
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

function buildOzonCategoryCatalogInternal(
  nodes: OzonCategoryTreeNode[] | null | undefined,
  options: { includeDisabled: boolean },
): OzonCategoryCatalogEntry[] {
  const catalog: OzonCategoryCatalogEntry[] = [];

  const walk = (rows: OzonCategoryTreeNode[], pathLevels: OzonCategoryLevel[], parentCategoryId: number | null = null) => {
    for (const row of rows) {
      const categoryName = cleanText(row.category_name);
      const rowCategoryId = toPositiveInt(row.description_category_id);
      const categoryId = rowCategoryId ?? parentCategoryId;
      const categoryNameZh = translateOzonCategoryTextForDisplay(categoryName);
      const nextPath = categoryName
        ? [
          ...pathLevels,
          {
            level: pathLevels.length + 1,
            categoryId: categoryId || 0,
            nameRu: categoryName,
            nameZh: categoryNameZh,
            translated: !!categoryNameZh,
          },
        ]
        : pathLevels;
      const typeId = toPositiveInt(row.type_id);
      const typeNameRu = cleanText(row.type_name);
      const disabled = row.disabled === true;

      if (categoryId && typeId && (options.includeDisabled || !disabled)) {
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
          disabled,
          selectable: !disabled,
          labelProvenance: {
            categoryPathRu: categoryPathRu.map((name) => name ? 'official_default' : 'missing'),
            categoryPathZh: categoryPathZh.map((name) => name ? 'local_dictionary' : 'missing'),
            typeNameRu: typeNameRu ? 'official_default' : 'missing',
            typeNameZh: typeNameZh ? 'local_dictionary' : 'missing',
          },
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

export function buildOzonCategoryCatalog(nodes: OzonCategoryTreeNode[] | null | undefined): OzonCategoryCatalogEntry[] {
  return buildOzonCategoryCatalogInternal(nodes, { includeDisabled: false });
}

export type OzonCategoryTermTranslator = (term: string) => Promise<{ outputText: string; source?: string }>;

export interface EnrichOzonCategoryCatalogTranslationDeps {
  translateTerm: OzonCategoryTermTranslator;
}

export interface BackfillOzonCategoryCatalogTranslationDeps extends EnrichOzonCategoryCatalogTranslationDeps {
  maxTerms?: number;
}

export interface BackfillOzonCategoryCatalogTranslationResult {
  catalog: OzonCategoryCatalogEntry[];
  attemptedTerms: number;
  translatedTerms: number;
  rejectedTerms: number;
  failedTerms: number;
  remainingTerms: string[];
  changed: boolean;
}

export function isValidOzonCategoryAiTranslation(value: unknown): boolean {
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
  return catalog.map((entry) => rebuildCatalogEntryWithTranslations(entry, translatedTerms, 'local_dictionary'));
}

function rebuildCatalogEntryWithTranslations(
  entry: OzonCategoryCatalogEntry,
  translatedTerms: Map<string, string>,
  translatedLabelSource: OzonCategoryLabelSource = 'ai',
): OzonCategoryCatalogEntry {
  const categoryPathZhSources: OzonCategoryLabelSource[] = [];
  const categoryLevels = entry.categoryLevels.map((level, index) => {
    const existing = cleanText(level.nameZh);
    const translated = cleanText(existing || translatedTerms.get(level.nameRu) || '');
    const valid = isTranslatedDisplayText(translated);
    categoryPathZhSources.push(valid
      ? (existing ? entry.labelProvenance?.categoryPathZh[index] || 'legacy' : translatedLabelSource)
      : 'missing');
    return {
      ...level,
      nameZh: valid ? translated : '',
      translated: valid,
    };
  });
  const existingTypeNameZh = cleanText(entry.typeNameZh);
  const typeTranslated = cleanText(existingTypeNameZh || translatedTerms.get(entry.typeNameRu) || '');
  const typeNameZh = isTranslatedDisplayText(typeTranslated) ? typeTranslated : '';
  const typeNameZhSource: OzonCategoryLabelSource = typeNameZh
    ? (existingTypeNameZh ? entry.labelProvenance?.typeNameZh || 'legacy' : translatedLabelSource)
    : 'missing';
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
    labelProvenance: {
      categoryPathRu: entry.categoryPathRu.map((name, index) => (
        name ? entry.labelProvenance?.categoryPathRu[index] || 'legacy' : 'missing'
      )),
      categoryPathZh: categoryPathZhSources,
      typeNameRu: entry.typeNameRu ? entry.labelProvenance?.typeNameRu || 'legacy' : 'missing',
      typeNameZh: typeNameZhSource,
    },
  };
}

type OfficialZhTarget = {
  typeNameZh: string;
  disabled: boolean;
};

function preferDeterministicOfficialLabel(current: string | undefined, candidate: string): string {
  if (!candidate) return current || '';
  if (!current) return candidate;
  return candidate < current ? candidate : current;
}

function indexOfficialZhHansTree(nodes: OzonCategoryTreeNode[] | null | undefined): {
  categoryNames: Map<number, string>;
  targets: Map<string, OfficialZhTarget>;
} {
  const categoryNames = new Map<number, string>();
  const targets = new Map<string, OfficialZhTarget>();

  const walk = (rows: OzonCategoryTreeNode[], parentCategoryId: number | null = null) => {
    for (const row of rows) {
      const rowCategoryId = toPositiveInt(row.description_category_id);
      const categoryId = rowCategoryId ?? parentCategoryId;
      const categoryName = cleanText(row.category_name);
      if (rowCategoryId && isTranslatedDisplayText(categoryName)) {
        categoryNames.set(
          rowCategoryId,
          preferDeterministicOfficialLabel(categoryNames.get(rowCategoryId), categoryName),
        );
      }

      const typeId = toPositiveInt(row.type_id);
      if (categoryId && typeId) {
        const key = `${categoryId}:${typeId}`;
        const existing = targets.get(key);
        const typeName = cleanText(row.type_name);
        targets.set(key, {
          typeNameZh: isTranslatedDisplayText(typeName)
            ? preferDeterministicOfficialLabel(existing?.typeNameZh, typeName)
            : existing?.typeNameZh || '',
          disabled: existing?.disabled === true || row.disabled === true,
        });
      }

      if (Array.isArray(row.children) && row.children.length) {
        walk(row.children, categoryId);
      }
    }
  };

  if (Array.isArray(nodes)) walk(nodes);
  return { categoryNames, targets };
}

export function buildMergedOzonCategoryCatalog(
  defaultNodes: OzonCategoryTreeNode[] | null | undefined,
  zhHansNodes: OzonCategoryTreeNode[] | null | undefined,
): OzonCategoryCatalogEntry[] {
  const defaultCatalog = buildOzonCategoryCatalogInternal(defaultNodes, { includeDisabled: true });
  const officialZh = indexOfficialZhHansTree(zhHansNodes);

  return defaultCatalog.map((entry) => {
    const categoryPathZhSources: OzonCategoryLabelSource[] = [];
    const categoryLevels = entry.categoryLevels.map((level, index) => {
      const officialName = level.categoryId > 0 ? officialZh.categoryNames.get(level.categoryId) || '' : '';
      const nameZh = officialName || level.nameZh;
      categoryPathZhSources.push(officialName
        ? 'official_zh_hans'
        : entry.labelProvenance?.categoryPathZh[index] || (nameZh ? 'legacy' : 'missing'));
      return {
        ...level,
        nameZh,
        translated: isTranslatedDisplayText(nameZh),
      };
    });
    const target = officialZh.targets.get(`${entry.descriptionCategoryId}:${entry.typeId}`);
    const officialTypeNameZh = target?.typeNameZh || '';
    const typeNameZh = officialTypeNameZh || entry.typeNameZh;
    const disabled = entry.disabled === true || target?.disabled === true;
    const seeded: OzonCategoryCatalogEntry = {
      ...entry,
      categoryLevels,
      categoryPathZh: categoryLevels.map((level) => level.nameZh),
      typeNameZh,
      disabled,
      selectable: !disabled,
      labelProvenance: {
        categoryPathRu: entry.categoryPathRu.map((name, index) => (
          name ? entry.labelProvenance?.categoryPathRu[index] || 'official_default' : 'missing'
        )),
        categoryPathZh: categoryPathZhSources,
        typeNameRu: entry.typeNameRu ? entry.labelProvenance?.typeNameRu || 'official_default' : 'missing',
        typeNameZh: officialTypeNameZh
          ? 'official_zh_hans'
          : entry.labelProvenance?.typeNameZh || (typeNameZh ? 'legacy' : 'missing'),
      },
    };
    return rebuildCatalogEntryWithTranslations(seeded, new Map());
  });
}

export function deriveOzonCategoryCatalogRevision(catalog: readonly OzonCategoryCatalogEntry[]): string {
  const canonicalEntries = catalog.map((entry) => ({
    descriptionCategoryId: entry.descriptionCategoryId,
    typeId: entry.typeId,
    categoryPathRu: entry.categoryPathRu,
    categoryPathZh: entry.categoryPathZh,
    typeNameRu: entry.typeNameRu,
    typeNameZh: entry.typeNameZh,
    disabled: entry.disabled === true,
    labelProvenance: entry.labelProvenance || null,
  })).sort((left, right) => {
    const leftKey = `${left.descriptionCategoryId}:${left.typeId}:${JSON.stringify(left)}`;
    const rightKey = `${right.descriptionCategoryId}:${right.typeId}:${JSON.stringify(right)}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return createHash('sha256').update(JSON.stringify(canonicalEntries)).digest('hex');
}

export const OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION = 'ozon-category-catalog-snapshot/v1' as const;

export type OzonCategoryCatalogLanguage = 'DEFAULT' | 'ZH_HANS';

export interface OzonCategoryCatalogSnapshot {
  schemaVersion: typeof OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION;
  entries: OzonCategoryCatalogEntry[];
  revision: string;
  fetchedAt: Date;
  expiresAt: Date;
  complete: boolean;
  defaultTreeComplete: boolean;
  zhHansTreeComplete: boolean;
  stale: boolean;
  authoritative: boolean;
}

export interface OzonCategoryCatalogSnapshotStore {
  find(shopId: string): Promise<OzonCategoryCatalogSnapshot | null>;
  replace(shopId: string, snapshot: OzonCategoryCatalogSnapshot): Promise<void>;
}

export interface GetOrRefreshOzonCategoryCatalogSnapshotParams {
  shopId: string;
  refresh?: boolean;
}

export interface GetOrRefreshOzonCategoryCatalogSnapshotDeps {
  store: OzonCategoryCatalogSnapshotStore;
  fetchTree(language: OzonCategoryCatalogLanguage): Promise<OzonCategoryTreeNode[]>;
  now?: () => Date;
  ttlMs?: number;
}

export interface RequireFreshOzonCategoryCatalogSnapshotDeps {
  store: OzonCategoryCatalogSnapshotStore;
  now?: () => Date;
}

export interface GetOrRefreshOzonCategoryCatalogSnapshotResult {
  snapshot: OzonCategoryCatalogSnapshot;
  refreshed: boolean;
  refreshError?: string;
  refreshCause?: unknown;
}

export class OzonCategoryCatalogRefreshError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OzonCategoryCatalogRefreshError';
  }
}

const DEFAULT_CATEGORY_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

function catalogRefreshErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown catalog refresh error');
}

function hasVerifiedCompleteSnapshot(snapshot: OzonCategoryCatalogSnapshot | null): snapshot is OzonCategoryCatalogSnapshot {
  if (!snapshot || snapshot.schemaVersion !== OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION) return false;
  if (!snapshot.complete || !snapshot.defaultTreeComplete || !snapshot.zhHansTreeComplete) return false;
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length === 0) return false;
  if (!(snapshot.fetchedAt instanceof Date) || !Number.isFinite(snapshot.fetchedAt.getTime())) return false;
  if (!(snapshot.expiresAt instanceof Date) || !Number.isFinite(snapshot.expiresAt.getTime())) return false;
  return snapshot.revision === deriveOzonCategoryCatalogRevision(snapshot.entries);
}

export async function requireFreshOzonCategoryCatalogSnapshotForShop(
  params: { shopId: string },
  deps: RequireFreshOzonCategoryCatalogSnapshotDeps,
): Promise<OzonCategoryCatalogSnapshot> {
  const shopId = cleanText(params.shopId);
  if (!shopId) {
    throw new OzonCategoryCatalogRefreshError(
      'OZON_CATEGORY_CATALOG_SHOP_REQUIRED',
      'Ozon shop is required',
    );
  }
  const now = deps.now?.() || new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new OzonCategoryCatalogRefreshError(
      'OZON_CATEGORY_CATALOG_CLOCK_INVALID',
      'Ozon category catalog cache clock is invalid',
    );
  }
  const snapshot = await deps.store.find(shopId);
  if (!hasVerifiedCompleteSnapshot(snapshot)
    || snapshot.authoritative !== true
    || snapshot.stale !== false
    || snapshot.fetchedAt.getTime() > now.getTime()
    || snapshot.expiresAt.getTime() <= now.getTime()
    || snapshot.expiresAt.getTime() <= snapshot.fetchedAt.getTime()) {
    throw new OzonCategoryCatalogRefreshError(
      'OZON_CATEGORY_CATALOG_FRESH_CACHE_REQUIRED',
      'A fresh complete authoritative Ozon category catalog cache is required',
    );
  }
  return snapshot;
}

function asNonAuthoritativeStaleSnapshot(snapshot: OzonCategoryCatalogSnapshot): OzonCategoryCatalogSnapshot {
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) => ({ ...entry, selectable: false })),
    stale: true,
    authoritative: false,
  };
}

async function fetchOfficialBilingualCategoryTrees(
  fetchTree: GetOrRefreshOzonCategoryCatalogSnapshotDeps['fetchTree'],
): Promise<{ defaultTree: OzonCategoryTreeNode[]; zhHansTree: OzonCategoryTreeNode[] }> {
  const [defaultResult, zhHansResult] = await Promise.allSettled([
    fetchTree('DEFAULT'),
    fetchTree('ZH_HANS'),
  ]);
  if (defaultResult.status === 'rejected') throw defaultResult.reason;
  if (zhHansResult.status === 'rejected') throw zhHansResult.reason;
  if (!Array.isArray(defaultResult.value) || defaultResult.value.length === 0
    || !Array.isArray(zhHansResult.value) || zhHansResult.value.length === 0) {
    throw new OzonCategoryCatalogRefreshError(
      'OZON_CATEGORY_CATALOG_BILINGUAL_INCOMPLETE',
      'Ozon bilingual category refresh is incomplete',
    );
  }
  return { defaultTree: defaultResult.value, zhHansTree: zhHansResult.value };
}

export async function getOrRefreshOzonCategoryCatalogSnapshotForShop(
  params: GetOrRefreshOzonCategoryCatalogSnapshotParams,
  deps: GetOrRefreshOzonCategoryCatalogSnapshotDeps,
): Promise<GetOrRefreshOzonCategoryCatalogSnapshotResult> {
  const shopId = cleanText(params.shopId);
  if (!shopId) {
    throw new OzonCategoryCatalogRefreshError('OZON_CATEGORY_CATALOG_SHOP_REQUIRED', 'Ozon shop is required');
  }
  const now = deps.now?.() || new Date();
  const configuredTtl = Number(deps.ttlMs);
  const ttlMs = Number.isFinite(configuredTtl) && configuredTtl > 0
    ? Math.trunc(configuredTtl)
    : DEFAULT_CATEGORY_CATALOG_TTL_MS;
  const cached = await deps.store.find(shopId);
  const cachedComplete = hasVerifiedCompleteSnapshot(cached);
  const cachedFresh = cachedComplete
    && cached.authoritative
    && !cached.stale
    && cached.expiresAt.getTime() > now.getTime();
  if (!params.refresh && cachedFresh) {
    return { snapshot: cached, refreshed: false };
  }

  try {
    const { defaultTree, zhHansTree } = await fetchOfficialBilingualCategoryTrees(deps.fetchTree);
    const entries = buildMergedOzonCategoryCatalog(defaultTree, zhHansTree);
    if (entries.length === 0) {
      throw new OzonCategoryCatalogRefreshError(
        'OZON_CATEGORY_CATALOG_BILINGUAL_INCOMPLETE',
        'Ozon bilingual category refresh is incomplete',
      );
    }
    const snapshot: OzonCategoryCatalogSnapshot = {
      schemaVersion: OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION,
      entries,
      revision: deriveOzonCategoryCatalogRevision(entries),
      fetchedAt: new Date(now),
      expiresAt: new Date(now.getTime() + ttlMs),
      complete: true,
      defaultTreeComplete: true,
      zhHansTreeComplete: true,
      stale: false,
      authoritative: true,
    };
    await deps.store.replace(shopId, snapshot);
    return { snapshot, refreshed: true };
  } catch (error) {
    if (cachedComplete) {
      return {
        snapshot: asNonAuthoritativeStaleSnapshot(cached),
        refreshed: false,
        refreshError: catalogRefreshErrorMessage(error),
        refreshCause: error,
      };
    }
    if (error instanceof OzonCategoryCatalogRefreshError) throw error;
    throw new OzonCategoryCatalogRefreshError(
      'OZON_CATEGORY_CATALOG_REFRESH_FAILED',
      `Ozon bilingual category refresh failed: ${catalogRefreshErrorMessage(error)}`,
      { cause: error },
    );
  }
}

export async function enrichMissingOzonCategoryCatalogTranslations(
  catalog: OzonCategoryCatalogEntry[],
  deps: EnrichOzonCategoryCatalogTranslationDeps,
): Promise<OzonCategoryCatalogEntry[]> {
  const result = await backfillOzonCategoryCatalogTranslations(catalog, deps);
  return result.catalog;
}

export async function backfillOzonCategoryCatalogTranslations(
  catalog: OzonCategoryCatalogEntry[],
  deps: BackfillOzonCategoryCatalogTranslationDeps,
): Promise<BackfillOzonCategoryCatalogTranslationResult> {
  const localCatalog = applyOzonCategoryCatalogLocalTranslations(catalog);
  const missingTerms = unique(localCatalog.flatMap((entry) => entry.untranslatedTerms));
  if (!missingTerms.length) {
    return {
      catalog: localCatalog.map((entry) => ({ ...entry })),
      attemptedTerms: 0,
      translatedTerms: 0,
      rejectedTerms: 0,
      failedTerms: 0,
      remainingTerms: [],
      changed: categoryCatalogTranslationFingerprint(localCatalog) !== categoryCatalogTranslationFingerprint(catalog),
    };
  }

  const translatedTerms = new Map<string, string>();
  let rejectedTerms = 0;
  let failedTerms = 0;
  const maxTerms = Number.isFinite(Number(deps.maxTerms)) && Number(deps.maxTerms) > 0
    ? Math.trunc(Number(deps.maxTerms))
    : missingTerms.length;
  const termsToTranslate = missingTerms.slice(0, maxTerms);
  for (const term of termsToTranslate) {
    try {
      const result = await deps.translateTerm(term);
      const translated = cleanText(result.outputText);
      if (isValidOzonCategoryAiTranslation(translated)) {
        translatedTerms.set(term, translated);
      } else {
        rejectedTerms += 1;
      }
    } catch {
      failedTerms += 1;
      // Category translation is best-effort; invalid or failed provider calls must not poison the catalog.
    }
  }

  const rebuiltCatalog = translatedTerms.size > 0
    ? localCatalog.map((entry) => rebuildCatalogEntryWithTranslations(entry, translatedTerms))
    : localCatalog.map((entry) => ({ ...entry }));
  return {
    catalog: rebuiltCatalog,
    attemptedTerms: termsToTranslate.length,
    translatedTerms: translatedTerms.size,
    rejectedTerms,
    failedTerms,
    remainingTerms: unique(rebuiltCatalog.flatMap((entry) => entry.untranslatedTerms)),
    changed: categoryCatalogTranslationFingerprint(rebuiltCatalog) !== categoryCatalogTranslationFingerprint(catalog),
  };
}
export function searchOzonCategoryCatalog(
  catalog: OzonCategoryCatalogEntry[],
  query: unknown,
  limit = 20,
): OzonCategoryCatalogEntry[] {
  const selectableCatalog = catalog.filter((entry) => entry.disabled !== true && entry.selectable !== false);
  const raw = cleanText(query);
  if (!raw) return selectableCatalog.slice(0, limit);

  const terms = unique([
    raw,
    ...raw.split(/[\s,/|;:，。；：、]+/u),
    ...buildKeywords([raw]),
  ]).map(normalizeToken);
  const queryExcludeTerms = getOzonCategoryLocalExcludeExpansions([raw]).map(normalizeToken);

  return selectableCatalog
    .map((entry) => {
      let score = 0;
      for (const term of terms) {
        if (!term) continue;
        if (entry.searchText.includes(term)) score += term.length > 2 ? 12 : 4;
        if (String(entry.descriptionCategoryId) === term || String(entry.typeId) === term) score += 80;
      }
      const targetExcludes = getOzonCategoryLocalSearchTermsForTarget(entry.descriptionCategoryId, entry.typeId)
        .excludes
        .map(normalizeToken);
      if (queryExcludeTerms.some((term) => targetExcludes.includes(term))) score -= 200;
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
  $transaction?<T>(
    fn: (tx: PrismaOzonCategoryCatalogClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
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

const OZON_CATEGORY_LABEL_SOURCES = new Set<OzonCategoryLabelSource>([
  'official_default',
  'official_zh_hans',
  'local_dictionary',
  'ai',
  'legacy',
  'missing',
]);

function labelSource(value: unknown, fallback: OzonCategoryLabelSource): OzonCategoryLabelSource {
  const source = cleanText(value) as OzonCategoryLabelSource;
  return OZON_CATEGORY_LABEL_SOURCES.has(source) ? source : fallback;
}

function mapLabelProvenance(value: unknown): OzonCategoryLabelProvenance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const categoryPathRu = Array.isArray(row.categoryPathRu)
    ? row.categoryPathRu.map((source) => labelSource(source, 'legacy'))
    : [];
  const categoryPathZh = Array.isArray(row.categoryPathZh)
    ? row.categoryPathZh.map((source) => labelSource(source, 'legacy'))
    : [];
  if (!categoryPathRu.length && !categoryPathZh.length && !row.typeNameRu && !row.typeNameZh) return undefined;
  return {
    categoryPathRu,
    categoryPathZh,
    typeNameRu: labelSource(row.typeNameRu, 'legacy'),
    typeNameZh: labelSource(row.typeNameZh, 'legacy'),
  };
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
  const disabled = row.disabled === true;

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
    disabled,
    selectable: !disabled,
    labelProvenance: mapLabelProvenance(row.labelProvenance),
  };
}

async function insertCatalogEntryRow(
  tx: PrismaOzonCategoryCatalogClient,
  input: {
    snapshotId: string;
    shopId: string;
    catalogRevision: string;
    language: string;
    entry: OzonCategoryCatalogEntry;
    fetchedAt: Date;
    source: string;
  },
): Promise<void> {
  const entry = input.entry;
  await tx.$executeRaw`
    INSERT INTO "ozon_category_catalog" (
      "id",
      "snapshot_id",
      "shop_id",
      "catalog_revision",
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
      "disabled",
      "label_provenance_json",
      "fetched_at",
      "source",
      "updated_at"
    ) VALUES (
      ${randomUUID()},
      ${input.snapshotId},
      ${input.shopId},
      ${input.catalogRevision},
      ${input.language},
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
      ${entry.disabled === true},
      CAST(${JSON.stringify(entry.labelProvenance || {})} AS jsonb),
      ${input.fetchedAt},
      ${input.source},
      CURRENT_TIMESTAMP
    )
  `;
}

function assertPersistableCatalogSnapshot(snapshot: OzonCategoryCatalogSnapshot): void {
  if (snapshot.schemaVersion !== OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('Unsupported Ozon category catalog snapshot schema version');
  }
  if (!snapshot.complete
    || !snapshot.defaultTreeComplete
    || !snapshot.zhHansTreeComplete
    || snapshot.stale
    || !snapshot.authoritative) {
    throw new Error('Only complete authoritative catalog snapshots can be persisted');
  }
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length === 0) {
    throw new Error('Catalog snapshot entries are required');
  }
  if (deriveOzonCategoryCatalogRevision(snapshot.entries) !== snapshot.revision) {
    throw new Error('Catalog snapshot revision does not match its entries');
  }
  if (!Number.isFinite(snapshot.fetchedAt.getTime())
    || !Number.isFinite(snapshot.expiresAt.getTime())
    || snapshot.expiresAt.getTime() < snapshot.fetchedAt.getTime()) {
    throw new Error('Catalog snapshot timestamps are invalid');
  }
}

export function createPrismaOzonCategoryCatalogSnapshotStore(
  prisma: PrismaOzonCategoryCatalogClient,
): OzonCategoryCatalogSnapshotStore {
  return {
    async find(shopId) {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT
          snapshot."id" AS "snapshotId",
          snapshot."schema_version" AS "schemaVersion",
          snapshot."revision",
          snapshot."fetched_at" AS "snapshotFetchedAt",
          snapshot."expires_at" AS "snapshotExpiresAt",
          snapshot."complete" AS "snapshotComplete",
          snapshot."default_tree_complete" AS "defaultTreeComplete",
          snapshot."zh_hans_tree_complete" AS "zhHansTreeComplete",
          entry."id" AS "entryId",
          entry."description_category_id" AS "descriptionCategoryId",
          entry."type_id" AS "typeId",
          entry."category_path_ru" AS "categoryPathRu",
          entry."category_path_zh" AS "categoryPathZh",
          entry."category_levels_json" AS "categoryLevels",
          entry."category_name_ru" AS "categoryNameRu",
          entry."category_name_zh" AS "categoryNameZh",
          entry."type_name_ru" AS "typeNameRu",
          entry."type_name_zh" AS "typeNameZh",
          entry."display_path_ru" AS "displayPathRu",
          entry."display_path_zh" AS "displayPathZh",
          entry."translation_status" AS "translationStatus",
          entry."untranslated_terms_json" AS "untranslatedTerms",
          entry."keywords_json" AS "keywords",
          entry."search_text" AS "searchText",
          entry."disabled",
          entry."label_provenance_json" AS "labelProvenance"
        FROM "ozon_category_catalog_snapshots" snapshot
        LEFT JOIN "ozon_category_catalog" entry
          ON entry."snapshot_id" = snapshot."id"
         AND entry."shop_id" = snapshot."shop_id"
         AND entry."catalog_revision" = snapshot."revision"
        WHERE snapshot."shop_id" = ${shopId}
          AND snapshot."is_current" = TRUE
        ORDER BY entry."display_path_zh" ASC, entry."display_path_ru" ASC
      `;
      const head = rows[0];
      if (!head) return null;
      const complete = head.snapshotComplete === true;
      const defaultTreeComplete = head.defaultTreeComplete === true;
      const zhHansTreeComplete = head.zhHansTreeComplete === true;
      const storedEntries = rows
        .filter((row) => !!row.entryId)
        .map(mapCatalogRow)
        .filter((entry) => entry.descriptionCategoryId > 0 && entry.typeId > 0);
      const revision = String(head.revision || '');
      const authoritative = String(head.schemaVersion || '') === OZON_CATEGORY_CATALOG_SNAPSHOT_SCHEMA_VERSION
        && complete
        && defaultTreeComplete
        && zhHansTreeComplete
        && storedEntries.length > 0
        && deriveOzonCategoryCatalogRevision(storedEntries) === revision;
      const entries = storedEntries.map((entry) => ({
        ...entry,
        selectable: authoritative && entry.disabled !== true,
      }));
      return {
        schemaVersion: String(head.schemaVersion || '') as OzonCategoryCatalogSnapshot['schemaVersion'],
        entries,
        revision,
        fetchedAt: new Date(head.snapshotFetchedAt),
        expiresAt: new Date(head.snapshotExpiresAt),
        complete,
        defaultTreeComplete,
        zhHansTreeComplete,
        stale: false,
        authoritative,
      };
    },

    async replace(shopId, snapshot) {
      assertPersistableCatalogSnapshot(snapshot);
      if (!prisma.$transaction) throw new Error('Catalog snapshot persistence requires a transaction');
      const snapshotId = randomUUID();
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "ozon_category_catalog_snapshots"
          SET "is_current" = FALSE
          WHERE "shop_id" = ${shopId}
            AND "is_current" = TRUE
        `;
        await tx.$executeRaw`
          INSERT INTO "ozon_category_catalog_snapshots" (
            "id",
            "shop_id",
            "schema_version",
            "revision",
            "fetched_at",
            "expires_at",
            "complete",
            "default_tree_complete",
            "zh_hans_tree_complete",
            "is_current",
            "created_at"
          ) VALUES (
            ${snapshotId},
            ${shopId},
            ${snapshot.schemaVersion},
            ${snapshot.revision},
            ${snapshot.fetchedAt},
            ${snapshot.expiresAt},
            TRUE,
            TRUE,
            TRUE,
            TRUE,
            CURRENT_TIMESTAMP
          )
        `;
        for (const entry of snapshot.entries) {
          await insertCatalogEntryRow(tx, {
            snapshotId,
            shopId,
            catalogRevision: snapshot.revision,
            language: 'DEFAULT',
            entry,
            fetchedAt: snapshot.fetchedAt,
            source: 'ozon_api_bilingual',
          });
        }
      }, { maxWait: 10000, timeout: 120000 });
    },
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
          "search_text" AS "searchText",
          catalog."disabled",
          catalog."label_provenance_json" AS "labelProvenance"
        FROM "ozon_category_catalog" catalog
        JOIN "ozon_category_catalog_snapshots" snapshot
          ON snapshot."id" = catalog."snapshot_id"
         AND snapshot."shop_id" = catalog."shop_id"
         AND snapshot."revision" = catalog."catalog_revision"
        WHERE catalog."shop_id" = ${shopId}
          AND catalog."language" = ${language}
          AND snapshot."is_current" = TRUE
        ORDER BY catalog."display_path_zh" ASC, catalog."display_path_ru" ASC
      `;
      return rows.map(mapCatalogRow).filter((entry) => entry.descriptionCategoryId > 0 && entry.typeId > 0);
    },

    async replace(shopId, language, entries, fetchedAt) {
      if (!prisma.$transaction) throw new Error('Catalog persistence requires a transaction');
      const snapshotId = randomUUID();
      const revision = deriveOzonCategoryCatalogRevision(entries);
      const run = async (tx: PrismaOzonCategoryCatalogClient) => {
        await tx.$executeRaw`
          UPDATE "ozon_category_catalog_snapshots"
          SET "is_current" = FALSE
          WHERE "shop_id" = ${shopId}
            AND "is_current" = TRUE
            AND "complete" = FALSE
        `;
        await tx.$executeRaw`
          INSERT INTO "ozon_category_catalog_snapshots" (
            "id",
            "shop_id",
            "schema_version",
            "revision",
            "fetched_at",
            "expires_at",
            "complete",
            "default_tree_complete",
            "zh_hans_tree_complete",
            "is_current",
            "created_at"
          ) VALUES (
            ${snapshotId},
            ${shopId},
            'ozon-category-catalog-snapshot/legacy-adapter-v1',
            ${revision},
            ${fetchedAt},
            ${fetchedAt},
            FALSE,
            FALSE,
            FALSE,
            NOT EXISTS (
              SELECT 1
              FROM "ozon_category_catalog_snapshots"
              WHERE "shop_id" = ${shopId}
                AND "is_current" = TRUE
            ),
            CURRENT_TIMESTAMP
          )
        `;
        for (const entry of entries) {
          await insertCatalogEntryRow(tx, {
            snapshotId,
            shopId,
            catalogRevision: revision,
            language,
            entry,
            fetchedAt,
            source: 'ozon_api_legacy_adapter',
          });
        }
        return entries.length;
      };

      return prisma.$transaction(run, { maxWait: 10000, timeout: 120000 });
    },
  };
}
