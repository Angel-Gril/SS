import { describe, expect, it, vi } from 'vitest';
import {
  buildOzonCategoryCatalog,
  createPrismaOzonCategoryCatalogStore,
  searchOzonCategoryCatalog,
  searchOrRefreshOzonCategoryCatalogForShop,
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
      expect.objectContaining({ descriptionCategoryId: 11, typeId: 101, displayPathZh: '服装 / 女式牛仔裤 / 牛仔裤' }),
    ]);

    await expect(store.replace('shop-1', 'DEFAULT', buildOzonCategoryCatalog([
      { description_category_id: 11, category_name: 'Женские джинсы', type_id: 101, type_name: 'Джинсы', disabled: false, children: [] },
    ]), new Date('2026-06-25T00:00:00.000Z'))).resolves.toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });
});
