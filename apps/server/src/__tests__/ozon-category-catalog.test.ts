import { describe, expect, it, vi } from 'vitest';
import {
  buildOzonCategoryCatalog,
  enrichMissingOzonCategoryCatalogTranslations,
  createPrismaOzonCategoryCatalogStore,
  getOzonCategoryLocalRuleStats,
  getOzonCategoryLocalSearchTermsForTarget,
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

  it('translates Ozon sleepwear category types through the local dictionary', () => {
    expect(translateOzonCategoryText('Ночная сорочка')).toBe('睡裙');
    expect(translateOzonCategoryText('Пижама')).toBe('睡衣');
    expect(translateOzonCategoryText('Пеньюар')).toBe('睡袍');
    expect(translateOzonCategoryText('Пеньюар для стрижки')).toBe('理发围布');

    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 200000933,
        category_name: 'Одежда',
        disabled: false,
        children: [
          {
            description_category_id: 200000933,
            category_name: 'Одежда',
            disabled: false,
            children: [
              { type_id: 970960142, type_name: 'Ночная сорочка', disabled: false, children: [] },
              { type_id: 93176, type_name: 'Пижама', disabled: false, children: [] },
            ],
          },
        ],
      },
      {
        description_category_id: 200001517,
        category_name: 'Белье',
        disabled: false,
        children: [
          { type_id: 93170, type_name: 'Пеньюар', disabled: false, children: [] },
        ],
      },
    ]);

    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        descriptionCategoryId: 200000933,
        typeId: 970960142,
        displayPathZh: '服装 / 服装 / 睡裙',
        typeNameZh: '睡裙',
        translationStatus: 'complete',
        untranslatedTerms: [],
      }),
      expect.objectContaining({
        descriptionCategoryId: 200000933,
        typeId: 93176,
        displayPathZh: '服装 / 服装 / 睡衣',
        typeNameZh: '睡衣',
        translationStatus: 'complete',
        untranslatedTerms: [],
      }),
      expect.objectContaining({
        descriptionCategoryId: 200001517,
        typeId: 93170,
        displayPathZh: '内衣 / 睡袍',
        typeNameZh: '睡袍',
        translationStatus: 'complete',
        untranslatedTerms: [],
      }),
    ]));
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
    expect(translateOzonCategoryText('Бюстгалтер')).toBe('文胸');
    expect(translateOzonCategoryText('Бюстгальтер')).toBe('文胸');
    expect(translateOzonCategoryText('Бюстгальтеры')).toBe('文胸');
    expect(translateOzonCategoryText('Аксессуар для бюстгальтера')).toBe('文胸配件');
    expect(translateOzonCategoryText('Футболка')).toBe('T恤');
    expect(translateOzonCategoryText('Наматрасник')).toBe('床垫保护套');
    expect(translateOzonCategoryText('Держатель простыни, одеяла')).toBe('床单/被子固定夹');
    expect(translateOzonCategoryText('Веревка бельевая')).toBe('晾衣绳');
    expect(translateOzonCategoryText('Обувь')).toBe('鞋靴');
  });

  it('uses imported Ozon mapping knowledge for target translations and source search terms', () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 200001242,
        category_name: 'Красота и гигиена',
        disabled: false,
        children: [
          {
            description_category_id: 200001242,
            category_name: 'Ватно-бумажная продукция',
            disabled: false,
            children: [
              { type_id: 93458, type_name: 'Ватные палочки', disabled: false, children: [] },
              { type_id: 970713340, type_name: 'Покрытие на сиденье унитаза', disabled: false, children: [] },
            ],
          },
        ],
      },
      {
        description_category_id: 17027908,
        category_name: 'Дом и сад',
        disabled: false,
        children: [
          {
            description_category_id: 17027908,
            category_name: 'Вешалки для одежды',
            disabled: false,
            children: [
              { type_id: 93676, type_name: 'Крючок для дома', disabled: false, children: [] },
            ],
          },
        ],
      },
    ]);

    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        descriptionCategoryId: 200001242,
        typeId: 93458,
        displayPathZh: '美容卫生 / 棉纸用品 / 棉签',
        translationStatus: 'complete',
        untranslatedTerms: [],
        keywords: expect.arrayContaining(['棉签', '棉棒', 'cotton swab', 'cotton bud']),
      }),
      expect.objectContaining({
        descriptionCategoryId: 200001242,
        typeId: 970713340,
        displayPathZh: '美容卫生 / 棉纸用品 / 马桶坐垫纸',
        keywords: expect.arrayContaining(['马桶坐垫纸', 'toilet seat cover']),
      }),
      expect.objectContaining({
        descriptionCategoryId: 17027908,
        typeId: 93676,
        displayPathZh: '家居园艺 / 衣架挂钩 / 家用挂钩',
        keywords: expect.arrayContaining(['家用挂钩', '粘钩', 'wall hook']),
      }),
    ]));

    expect(searchOzonCategoryCatalog(catalog, '一次性双头棉签')[0]).toMatchObject({
      descriptionCategoryId: 200001242,
      typeId: 93458,
    });
    expect(searchOzonCategoryCatalog(catalog, '免打孔粘钩挂钩')[0]).toMatchObject({
      descriptionCategoryId: 17027908,
      typeId: 93676,
    });
  });

  it('indexes imported Ozon mapping rules without turning them into forced mappings', () => {
    expect(getOzonCategoryLocalRuleStats()).toMatchObject({
      ozonConfirmedTargetCount: 29,
    });

    expect(getOzonCategoryLocalSearchTermsForTarget(200001242, 970713340)).toEqual(expect.objectContaining({
      keywords: expect.arrayContaining(['马桶坐垫纸', 'toilet seat cover']),
      excludes: expect.arrayContaining(['toilet brush', '马桶刷']),
    }));
  });

  it('uses imported Ozon mapping excludes to reduce false category search matches', () => {
    const catalog = buildOzonCategoryCatalog([
      {
        description_category_id: 200001242,
        category_name: 'Красота и гигиена',
        disabled: false,
        children: [
          {
            description_category_id: 200001242,
            category_name: 'Ватно-бумажная продукция',
            disabled: false,
            children: [
              { type_id: 970713340, type_name: 'Покрытие на сиденье унитаза', disabled: false, children: [] },
            ],
          },
        ],
      },
      {
        description_category_id: 17028718,
        category_name: 'Дом и сад',
        disabled: false,
        children: [
          {
            description_category_id: 17028718,
            category_name: 'Инвентарь для уборки',
            disabled: false,
            children: [
              { type_id: 970869623, type_name: 'Щетка для уборки', disabled: false, children: [] },
            ],
          },
        ],
      },
    ]);

    expect(searchOzonCategoryCatalog(catalog, 'toilet brush')[0]).not.toMatchObject({
      descriptionCategoryId: 200001242,
      typeId: 970713340,
    });
    expect(searchOzonCategoryCatalog(catalog, '马桶刷')).toHaveLength(0);
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
    const transaction = vi.fn(async <T>(fn: (tx: PrismaOzonCategoryCatalogClient) => Promise<T>, _options?: unknown) => fn(prisma));
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
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      maxWait: expect.any(Number),
      timeout: expect.any(Number),
    }));
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
      outputText: '女士内衣',
      source: 'provider' as const,
    }));

    const enriched = await enrichMissingOzonCategoryCatalogTranslations(catalog, {
      translateTerm: translate,
    });

    expect(translate).toHaveBeenCalledTimes(1);
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

  it('keeps local dictionary translations when AI fills a different missing term', async () => {
    const catalog: OzonCategoryCatalogEntry[] = [{
      descriptionCategoryId: 1,
      typeId: 2,
      categoryPathRu: ['Женское белье'],
      categoryPathZh: [''],
      categoryLevels: [{ level: 1, categoryId: 1, nameRu: 'Женское белье', nameZh: '', translated: false }],
      categoryNameRu: 'Женское белье',
      categoryNameZh: '',
      typeNameRu: 'Бюстгалтер',
      typeNameZh: '',
      displayPathRu: 'Женское белье / Бюстгалтер',
      displayPathZh: '待翻译类目1 / 待翻译类型',
      translationStatus: 'missing',
      untranslatedTerms: ['Женское белье', 'Бюстгалтер'],
      keywords: ['Женское белье', 'Бюстгалтер'],
      searchText: 'женское белье бюстгалтер',
    }];

    const enriched = await enrichMissingOzonCategoryCatalogTranslations(catalog, {
      translateTerm: async () => ({ outputText: '女士内衣', source: 'provider' as const }),
    });

    expect(enriched[0]).toMatchObject({
      categoryNameZh: '女士内衣',
      typeNameZh: '文胸',
      displayPathZh: '女士内衣 / 文胸',
      translationStatus: 'complete',
      untranslatedTerms: [],
    });
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
      displayPathZh: '待翻译类目1 / 文胸',
      translationStatus: 'partial',
      untranslatedTerms: ['Женское белье'],
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
