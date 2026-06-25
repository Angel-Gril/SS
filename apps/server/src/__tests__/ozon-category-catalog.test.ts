import { describe, expect, it, vi } from 'vitest';
import {
  buildOzonCategoryCatalog,
  enrichMissingOzonCategoryCatalogTranslations,
  createPrismaOzonCategoryCatalogStore,
  searchOzonCategoryCatalog,
  searchOrRefreshOzonCategoryCatalogForShop,
  translateOzonCategoryText,
  type OzonCategoryCatalogEntry,
  type PrismaOzonCategoryCatalogClient,
} from '../services/ozon-category-catalog.js';

describe('ozon category catalog', () => {
  it('flattens Ozon description category tree into searchable Chinese catalog entries', () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 17028706,
        category_name: 'Одежда',
        disabled: false,
        children: [
          {
            description_category_id: 17028800,
            category_name: 'Женская одежда',
            disabled: false,
            children: [
              {
                description_category_id: 17028801,
                category_name: 'Женские джинсы',
                type_id: 95913,
                type_name: 'Джинсы',
                disabled: false,
                children: [],
              },
              {
                description_category_id: 17028802,
                category_name: 'Отключенный тип',
                type_id: 95914,
                type_name: 'Не использовать',
                disabled: true,
                children: [],
              },
            ],
          },
        ],
      },
    ]);

    expect(catalog).toEqual([
      expect.objectContaining({
        descriptionCategoryId: 17028801,
        typeId: 95913,
        categoryPathRu: ['Одежда', 'Женская одежда', 'Женские джинсы'],
        typeNameRu: 'Джинсы',
        displayPathRu: 'Одежда / Женская одежда / Женские джинсы / Джинсы',
        displayPathZh: '服装 / 女装 / 女式牛仔裤 / 牛仔裤',
        searchText: expect.stringContaining('女式牛仔裤'),
        keywords: expect.arrayContaining(['服装', '女装', '女式牛仔裤', '牛仔裤', 'jeans']),
      }),
    ]);
  });

  it('inherits parent description category id for Ozon type-only leaves', () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 17028706,
        category_name: 'Одежда',
        disabled: false,
        children: [
          {
            description_category_id: 17028718,
            category_name: 'Мужская одежда',
            disabled: false,
            children: [
              { type_id: 95913, type_name: 'Джинсы', disabled: false, children: [] },
            ],
          },
        ],
      },
    ]);

    expect(catalog).toEqual([
      expect.objectContaining({
        descriptionCategoryId: 17028718,
        typeId: 95913,
        categoryPathRu: ['Одежда', 'Мужская одежда'],
        displayPathZh: '服装 / 男装 / 牛仔裤',
      }),
    ]);
  });

  it('translates toy and baby crib-mobile category labels to Chinese', () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 300001,
        category_name: 'Радиоуправляемые игрушки',
        disabled: false,
        children: [
          { type_id: 400001, type_name: 'Игрушка радиоуправляемая', disabled: false, children: [] },
          { type_id: 400002, type_name: 'Аксессуары, запчасти для радиоуправляемой модели', disabled: false, children: [] },
        ],
      },
      {
        description_category_id: 300002,
        category_name: 'Мобили и дуги в кроватку',
        disabled: false,
        children: [
          { type_id: 400003, type_name: 'Мобиль', disabled: false, children: [] },
          { type_id: 400004, type_name: 'Аксессуары, запчасти для мобиля', disabled: false, children: [] },
          { type_id: 400005, type_name: 'Развивающая дуга', disabled: false, children: [] },
        ],
      },
    ]);

    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        descriptionCategoryId: 300001,
        typeId: 400001,
        displayPathZh: '遥控玩具 / 遥控玩具',
        keywords: expect.arrayContaining(['遥控玩具']),
      }),
      expect.objectContaining({
        descriptionCategoryId: 300002,
        typeId: 400003,
        displayPathZh: '婴儿床铃/床挂玩具 / 婴儿床铃',
        keywords: expect.arrayContaining(['婴儿床铃/床挂玩具', '婴儿床铃']),
      }),
      expect.objectContaining({
        descriptionCategoryId: 300002,
        typeId: 400005,
        displayPathZh: '婴儿床铃/床挂玩具 / 婴儿健身架',
      }),
    ]));
    expect(catalog.map((entry) => entry.displayPathZh).join(' ')).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('records category levels and translation gaps without leaking Russian into Chinese display paths', () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 100,
        category_name: 'Неизвестный раздел',
        disabled: false,
        children: [
          {
            description_category_id: 200,
            category_name: 'Радиоуправляемые игрушки',
            disabled: false,
            children: [
              { type_id: 300, type_name: 'Неизвестный тип', disabled: false, children: [] },
            ],
          },
        ],
      },
    ]);

    expect(catalog).toEqual([
      expect.objectContaining({
        descriptionCategoryId: 200,
        typeId: 300,
        categoryPathRu: ['Неизвестный раздел', 'Радиоуправляемые игрушки'],
        categoryPathZh: ['', '遥控玩具'],
        categoryLevels: [
          { level: 1, categoryId: 100, nameRu: 'Неизвестный раздел', nameZh: '', translated: false },
          { level: 2, categoryId: 200, nameRu: 'Радиоуправляемые игрушки', nameZh: '遥控玩具', translated: true },
        ],
        typeNameZh: '',
        displayPathRu: 'Неизвестный раздел / Радиоуправляемые игрушки / Неизвестный тип',
        displayPathZh: '待翻译类目1 / 遥控玩具 / 待翻译类型',
        translationStatus: 'partial',
        untranslatedTerms: ['Неизвестный раздел', 'Неизвестный тип'],
      }),
    ]);
    expect(catalog[0]?.displayPathZh).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('keeps source candidate apparel fallback translations in the shared catalog translator', () => {
    expect(translateOzonCategoryText('Одежда для малышей')).toBe('婴幼儿服装');
    expect(translateOzonCategoryText('Спецодежда')).toBe('工装/职业服');
    expect(translateOzonCategoryText('Джинсы для малышей')).toBe('婴幼儿牛仔裤');
    expect(translateOzonCategoryText('Брюки тактические')).toBe('战术裤');
    expect(translateOzonCategoryText('Брюки для малышей')).toBe('婴幼儿裤子');
    expect(translateOzonCategoryText('Термобрюки')).toBe('保暖裤');
    expect(translateOzonCategoryText('Белье')).toBe('内衣');
    expect(translateOzonCategoryText('Обувь')).toBe('鞋靴');
  });

  it('searches by Chinese terms, Russian terms, ids, and product title hints', () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 10,
        category_name: 'Одежда',
        disabled: false,
        children: [
          { description_category_id: 11, category_name: 'Женские джинсы', type_id: 101, type_name: 'Джинсы', disabled: false, children: [] },
          { description_category_id: 12, category_name: 'Мужские футболки', type_id: 102, type_name: 'Футболки', disabled: false, children: [] },
        ],
      },
    ]);

    expect(searchOzonCategoryCatalog(catalog, '女士高腰牛仔裤')[0]).toMatchObject({
      descriptionCategoryId: 11,
      typeId: 101,
    });
    expect(searchOzonCategoryCatalog(catalog, 'футболка мужская')[0]).toMatchObject({
      descriptionCategoryId: 12,
      typeId: 102,
    });
    expect(searchOzonCategoryCatalog(catalog, '11 101')[0]).toMatchObject({
      descriptionCategoryId: 11,
      typeId: 101,
    });
  });

  it('refreshes from Ozon tree when the local catalog is empty', async () => {
    const stored = new Map<string, OzonCategoryCatalogEntry[]>();
    const fetchTree = vi.fn(async () => [
      {
        description_category_id: 10,
        category_name: 'Одежда',
        disabled: false,
        children: [
          { description_category_id: 11, category_name: 'Женские джинсы', type_id: 101, type_name: 'Джинсы', disabled: false, children: [] },
        ],
      },
    ]);

    const result = await searchOrRefreshOzonCategoryCatalogForShop({
      shopId: 'shop-1',
      query: '牛仔裤',
    }, {
      store: {
        list: async (shopId) => stored.get(shopId) || [],
        replace: async (shopId, _language, entries) => {
          stored.set(shopId, entries);
          return entries.length;
        },
      },
      fetchTree,
    });

    expect(fetchTree).toHaveBeenCalledTimes(1);
    expect(result.refreshed).toBe(true);
    expect(result.total).toBe(1);
    expect(result.entries[0]).toMatchObject({ descriptionCategoryId: 11, typeId: 101 });
    expect(stored.get('shop-1')?.[0]?.displayPathZh).toBe('服装 / 女式牛仔裤 / 牛仔裤');
  });

  it('searches the local catalog without refreshing when cached rows exist', async () => {
    const cached = buildOzonCategoryCatalog([
      {
        description_category_id: 10,
        category_name: 'Одежда',
        disabled: false,
        children: [
          { description_category_id: 12, category_name: 'Мужские футболки', type_id: 102, type_name: 'Футболки', disabled: false, children: [] },
        ],
      },
    ]);
    const fetchTree = vi.fn(async () => []);

    const result = await searchOrRefreshOzonCategoryCatalogForShop({
      shopId: 'shop-1',
      query: '男士T恤',
    }, {
      store: {
        list: async () => cached,
        replace: async () => 0,
      },
      fetchTree,
    });

    expect(fetchTree).not.toHaveBeenCalled();
    expect(result.refreshed).toBe(false);
    expect(result.entries[0]).toMatchObject({ descriptionCategoryId: 12, typeId: 102 });
  });

  it('maps Prisma raw rows through the category catalog store', async () => {
    const rows = [
      {
        descriptionCategoryId: 11,
        typeId: 101,
        categoryPathRu: ['Одежда', 'Женские джинсы'],
        categoryPathZh: ['服装', '女式牛仔裤'],
        categoryNameRu: 'Женские джинсы',
        categoryNameZh: '女式牛仔裤',
        typeNameRu: 'Джинсы',
        typeNameZh: '牛仔裤',
        displayPathRu: 'Одежда / Женские джинсы / Джинсы',
        displayPathZh: '服装 / 女式牛仔裤 / 牛仔裤',
        categoryLevels: [],
        translationStatus: 'missing',
        untranslatedTerms: [],
        keywords: ['牛仔裤', 'jeans'],
        searchText: 'одежда женские джинсы 服装 女式牛仔裤 牛仔裤 jeans 11 101',
      },
    ];
    const executeRaw = vi.fn(async () => 1);
    let prisma!: PrismaOzonCategoryCatalogClient;
    const transaction = vi.fn(async <T>(fn: (tx: PrismaOzonCategoryCatalogClient) => Promise<T>) => fn(prisma));
    prisma = {
      $queryRaw: (async <T = unknown>() => rows as T) as PrismaOzonCategoryCatalogClient['$queryRaw'],
      $executeRaw: executeRaw as PrismaOzonCategoryCatalogClient['$executeRaw'],
      $transaction: transaction as PrismaOzonCategoryCatalogClient['$transaction'],
    };
    const store = createPrismaOzonCategoryCatalogStore(prisma);

    await expect(store.list('shop-1', 'DEFAULT')).resolves.toEqual([
      expect.objectContaining({
        descriptionCategoryId: 11,
        typeId: 101,
        displayPathZh: '服装 / 女式牛仔裤 / 牛仔裤',
        translationStatus: 'complete',
        categoryLevels: [
          { level: 1, categoryId: 0, nameRu: 'Одежда', nameZh: '服装', translated: true },
          { level: 2, categoryId: 11, nameRu: 'Женские джинсы', nameZh: '女式牛仔裤', translated: true },
        ],
        untranslatedTerms: [],
      }),
    ]);

    await expect(store.replace('shop-1', 'DEFAULT', buildOzonCategoryCatalog([
      { description_category_id: 11, category_name: 'Женские джинсы', type_id: 101, type_name: 'Джинсы', disabled: false, children: [] },
    ]), new Date('2026-06-25T00:00:00.000Z'))).resolves.toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });
  it('enriches missing Ozon category labels through cache-backed translation and rebuilds display/search text', async () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 700001,
        category_name: 'Женское белье',
        disabled: false,
        children: [
          { type_id: 800001, type_name: 'Бюстгальтеры', disabled: false, children: [] },
        ],
      },
    ]);
    const translate = vi.fn(async (term: string) => ({
      outputText: term === 'Женское белье' ? '女士内衣' : '文胸',
      source: 'provider' as const,
    }));

    const enriched = await enrichMissingOzonCategoryCatalogTranslations(catalog, {
      translateTerm: translate,
    });

    expect(translate).toHaveBeenCalledTimes(2);
    expect(enriched[0]).toMatchObject({
      categoryPathZh: ['女士内衣'],
      categoryNameZh: '女士内衣',
      typeNameZh: '文胸',
      displayPathZh: '女士内衣 / 文胸',
      translationStatus: 'complete',
      untranslatedTerms: [],
    });
    expect(enriched[0]?.searchText).toContain('女士内衣');
    expect(enriched[0]?.keywords).toEqual(expect.arrayContaining(['女士内衣', '文胸']));
  });

  it('rejects invalid AI category translations without poisoning the catalog entry', async () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 700001,
        category_name: 'Женское белье',
        disabled: false,
        children: [
          { type_id: 800001, type_name: 'Бюстгальтеры', disabled: false, children: [] },
        ],
      },
    ]);

    const enriched = await enrichMissingOzonCategoryCatalogTranslations(catalog, {
      translateTerm: async () => ({ outputText: 'Перевод с пояснением', source: 'provider' as const }),
    });

    expect(enriched[0]).toMatchObject({
      displayPathZh: '待翻译类目1 / 待翻译类型',
      translationStatus: 'missing',
      untranslatedTerms: ['Женское белье', 'Бюстгальтеры'],
    });
  });
  it('applies missing-term enrichment when refreshing from Ozon tree', async () => {
    const stored = new Map<string, OzonCategoryCatalogEntry[]>();
    const enrich = vi.fn(async (entries: OzonCategoryCatalogEntry[]) => entries.map((entry) => ({
      ...entry,
      categoryPathZh: ['女士内衣'],
      categoryLevels: entry.categoryLevels.map((level) => ({ ...level, nameZh: '女士内衣', translated: true })),
      categoryNameZh: '女士内衣',
      typeNameZh: '文胸',
      displayPathZh: '女士内衣 / 文胸',
      translationStatus: 'complete' as const,
      untranslatedTerms: [],
      keywords: [...entry.keywords, '女士内衣', '文胸'],
      searchText: `${entry.searchText} 女士内衣 文胸`,
    })));

    const result = await searchOrRefreshOzonCategoryCatalogForShop({
      shopId: 'shop-1',
      query: '文胸',
      refresh: true,
    }, {
      store: {
        list: async (shopId) => stored.get(shopId) || [],
        replace: async (shopId, _language, entries) => {
          stored.set(shopId, entries);
          return entries.length;
        },
      },
      fetchTree: async () => [{
        description_category_id: 700001,
        category_name: 'Женское белье',
        disabled: false,
        children: [{ type_id: 800001, type_name: 'Бюстгальтеры', disabled: false, children: [] }],
      }],
      enrichMissingTranslations: enrich,
    });

    expect(enrich).toHaveBeenCalledTimes(1);
    expect(result.entries[0]).toMatchObject({ displayPathZh: '女士内衣 / 文胸', translationStatus: 'complete' });
    expect(stored.get('shop-1')?.[0]?.displayPathZh).toBe('女士内衣 / 文胸');
  });
});
