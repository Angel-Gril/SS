import { randomUUID } from 'crypto';

export interface OzonCategoryTreeNode {
  description_category_id?: number | string | null;
  category_name?: string | null;
  disabled?: boolean | null;
  children?: OzonCategoryTreeNode[] | null;
  type_id?: number | string | null;
  type_name?: string | null;
}

export interface OzonCategoryCatalogEntry {
  descriptionCategoryId: number;
  typeId: number;
  categoryPathRu: string[];
  categoryPathZh: string[];
  categoryNameRu: string;
  categoryNameZh: string;
  typeNameRu: string;
  typeNameZh: string;
  displayPathRu: string;
  displayPathZh: string;
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
};

const KEYWORD_EXPANSIONS: Array<[RegExp, string[]]> = [
  [/джинс|牛仔|jeans?/iu, ['牛仔裤', 'jeans', 'джинсы']],
  [/женск|女装|女士|女式|women|female/iu, ['女装', '女士', 'женская']],
  [/мужск|男装|男士|男式|men|male/iu, ['男装', '男士', 'мужская']],
  [/футбол|t-?shirt|T恤/iu, ['T恤', 'футболка', 'tshirt']],
];

export function translateOzonCategoryText(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  const exact = CATEGORY_TRANSLATIONS[normalizeToken(text)];
  if (exact) return exact;

  let out = text;
  out = out.replace(/Женские джинсы/giu, '女式牛仔裤');
  out = out.replace(/Мужские джинсы/giu, '男式牛仔裤');
  out = out.replace(/Джинсы/giu, '牛仔裤');
  out = out.replace(/Женская одежда/giu, '女装');
  out = out.replace(/Мужская одежда/giu, '男装');
  out = out.replace(/Одежда/giu, '服装');
  out = out.replace(/Женские футболки/giu, '女式T恤');
  out = out.replace(/Мужские футболки/giu, '男式T恤');
  out = out.replace(/Футболки/giu, 'T恤');
  return out === text ? text : out;
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

export function buildOzonCategoryCatalog(nodes: OzonCategoryTreeNode[] | null | undefined): OzonCategoryCatalogEntry[] {
  const catalog: OzonCategoryCatalogEntry[] = [];

  const walk = (rows: OzonCategoryTreeNode[], pathRu: string[], parentCategoryId: number | null = null) => {
    for (const row of rows) {
      if (row.disabled) continue;

      const categoryName = cleanText(row.category_name);
      const nextPath = categoryName ? [...pathRu, categoryName] : pathRu;
      const categoryId = toPositiveInt(row.description_category_id) ?? parentCategoryId;
      const typeId = toPositiveInt(row.type_id);
      const typeNameRu = cleanText(row.type_name);

      if (categoryId && typeId) {
        const categoryPathZh = nextPath.map(translateOzonCategoryText);
        const typeNameZh = translateOzonCategoryText(typeNameRu);
        const categoryNameRu = nextPath[nextPath.length - 1] || '';
        const categoryNameZh = categoryPathZh[categoryPathZh.length - 1] || '';
        const ruParts = [...nextPath, typeNameRu].filter(Boolean);
        const zhParts = [...categoryPathZh, typeNameZh].filter(Boolean);
        const keywords = buildKeywords([...ruParts, ...zhParts, String(categoryId), String(typeId)]);

        catalog.push({
          descriptionCategoryId: categoryId,
          typeId,
          categoryPathRu: nextPath,
          categoryPathZh,
          categoryNameRu,
          categoryNameZh,
          typeNameRu,
          typeNameZh,
          displayPathRu: ruParts.join(' / '),
          displayPathZh: zhParts.join(' / '),
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
  now?: () => Date;
}

export async function searchOrRefreshOzonCategoryCatalogForShop(
  params: SearchOzonCategoryCatalogParams,
  deps: SearchOzonCategoryCatalogDeps,
): Promise<{ entries: OzonCategoryCatalogEntry[]; total: number; refreshed: boolean }> {
  const language = cleanText(params.language) || 'DEFAULT';
  let catalog = await deps.store.list(params.shopId, language);
  let refreshed = false;

  if (params.refresh || catalog.length === 0) {
    catalog = buildOzonCategoryCatalog(await deps.fetchTree());
    await deps.store.replace(params.shopId, language, catalog, deps.now?.() || new Date());
    refreshed = true;
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

function mapCatalogRow(row: Record<string, any>): OzonCategoryCatalogEntry {
  return {
    descriptionCategoryId: Number(row.descriptionCategoryId),
    typeId: Number(row.typeId),
    categoryPathRu: stringArray(row.categoryPathRu),
    categoryPathZh: stringArray(row.categoryPathZh),
    categoryNameRu: cleanText(row.categoryNameRu),
    categoryNameZh: cleanText(row.categoryNameZh),
    typeNameRu: cleanText(row.typeNameRu),
    typeNameZh: cleanText(row.typeNameZh),
    displayPathRu: cleanText(row.displayPathRu),
    displayPathZh: cleanText(row.displayPathZh),
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
          "category_name_ru" AS "categoryNameRu",
          "category_name_zh" AS "categoryNameZh",
          "type_name_ru" AS "typeNameRu",
          "type_name_zh" AS "typeNameZh",
          "display_path_ru" AS "displayPathRu",
          "display_path_zh" AS "displayPathZh",
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
              "category_name_ru",
              "category_name_zh",
              "type_name_ru",
              "type_name_zh",
              "display_path_ru",
              "display_path_zh",
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
              ${entry.categoryNameRu},
              ${entry.categoryNameZh},
              ${entry.typeNameRu},
              ${entry.typeNameZh},
              ${entry.displayPathRu},
              ${entry.displayPathZh},
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
