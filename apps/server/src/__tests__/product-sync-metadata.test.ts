import { describe, expect, it } from 'vitest';
import {
  buildProductSyncMeta,
  buildProductStatusCounts,
  getOzonStatusDisplay,
  getProductStatusBucket,
  getProductSyncCategory,
  getWarehouseStock,
  matchesProductListComputedFilters,
  normalizeOzonSku,
  resolveOzonPackageWeightG,
  resolveOzonProductImages,
  resolveOzonSalesCommissionPercent,
} from '../services/product-sync-metadata.js';

describe('product sync metadata helpers', () => {
  it('translates Ozon status fields and keeps warehouse stock details for product list display', () => {
    const meta = buildProductSyncMeta({
      statuses: {
        status: 'price_sent',
        moderate_status: 'approved',
        status_name: 'В продаже',
        status_description: 'Готов к продаже',
      },
    }, [
      { warehouse_id: 10, present: 3, reserved: 1 },
      { warehouse_id: 20, present: 0, reserved: 2 },
    ]);

    expect(getOzonStatusDisplay(meta, 'price_sent')).toEqual({
      name: '在售',
      description: '准备出库',
      moderateStatus: '审核通过',
      tone: 'success',
    });
    expect(getWarehouseStock(meta, 10)).toBe(4);
    expect(getWarehouseStock(meta, 20)).toBe(2);
    expect(getWarehouseStock(meta, 30)).toBeNull();
  });

  it('returns zero for a warehouse that exists but has no stock', () => {
    const meta = buildProductSyncMeta({ statuses: { status: 'price_sent' } }, [
      { warehouse_id: 10, present: 0, reserved: 0 },
    ]);

    expect(getWarehouseStock(meta, 10)).toBe(0);
  });

  it('keeps Ozon category identifiers from product info in sync metadata', () => {
    const meta = buildProductSyncMeta({
      statuses: { status: 'price_sent' },
      description_category_id: 200001517,
      type_id: 93065,
    });

    expect(getProductSyncCategory(meta)).toEqual({
      descriptionCategoryId: 200001517,
      typeId: 93065,
    });
  });

  it('resolves sales commission percent from Ozon v5 price response', () => {
    expect(resolveOzonSalesCommissionPercent({
      commissions: {
        sales_percent_fbo: 17,
        sales_percent_fbs: 20.5,
        sales_percent_rfbs: 12,
      },
    })).toBe(12);
    expect(resolveOzonSalesCommissionPercent({
      commissions: {
        sales_percent_fbo: 17,
        sales_percent_fbs: 20.5,
      },
    })).toBe(20.5);
  });

  it('still resolves sales commission percent from legacy array responses', () => {
    expect(resolveOzonSalesCommissionPercent({
      commissions: [
        { sale_schema: 'fbo', percent: 17 },
        { sale_schema: 'fbs', percent: 20.5 },
      ],
    })).toBe(20.5);
  });

  it('falls back to Chinese labels for raw Ozon lifecycle states', () => {
    expect(getOzonStatusDisplay({ ozonStatus: { status: 'price_sent' } }, 'price_sent')).toEqual({
      name: '价格已发送',
      description: null,
      moderateStatus: null,
      tone: 'info',
    });
    expect(getOzonStatusDisplay({ ozonStatus: { status: 'archived' } }, 'archived')).toEqual({
      name: '已归档',
      description: null,
      moderateStatus: null,
      tone: 'muted',
    });
    expect(getOzonStatusDisplay({}, 'MISSING')).toEqual({
      name: 'Ozon 当前列表未返回',
      description: null,
      moderateStatus: null,
      tone: 'danger',
    });
  });

  it('puts the Ozon SKU primary image first before shared product images', () => {
    expect(resolveOzonProductImages({
      primary_image: 'https://cdn.example.com/sku-blue.jpg',
      images: [
        'https://cdn.example.com/shared-model.jpg',
        'https://cdn.example.com/detail.jpg',
      ],
    }, {
      images: [
        'https://cdn.example.com/sku-blue.jpg',
        'https://cdn.example.com/attr-detail.jpg',
      ],
    })).toEqual([
      'https://cdn.example.com/sku-blue.jpg',
      'https://cdn.example.com/attr-detail.jpg',
      'https://cdn.example.com/shared-model.jpg',
      'https://cdn.example.com/detail.jpg',
    ]);
  });

  it('falls back to attribute images when product info has no primary image', () => {
    expect(resolveOzonProductImages({
      images: ['https://cdn.example.com/shared-model.jpg'],
    }, {
      images: ['https://cdn.example.com/sku-red.jpg'],
    })[0]).toBe('https://cdn.example.com/sku-red.jpg');
  });

  it('treats Ozon sku 0 as not generated yet', () => {
    expect(normalizeOzonSku(0)).toBeNull();
    expect(normalizeOzonSku('0')).toBeNull();
    expect(normalizeOzonSku(' 12345 ')).toBe('12345');
  });

  it('normalizes Ozon package weight from product attributes into grams', () => {
    expect(resolveOzonPackageWeightG({ weight: 180, weight_unit: 'g' })).toBe(180);
    expect(resolveOzonPackageWeightG({ weight: 0.2, weight_unit: 'kg' })).toBe(200);
    expect(resolveOzonPackageWeightG({ weight: 12, weight_unit: 'lb' })).toBeNull();
  });

  it('filters products by price, weight and selected warehouse stock mode', () => {
    const lightCheap = {
      price: { toString: () => '144.00' },
      weight: 80,
      stock: 5,
      variants: buildProductSyncMeta({ statuses: { status: 'price_sent' } }, [
        { warehouse_id: 10, present: 0, reserved: 0 },
      ]),
    };
    const heavyExpensive = {
      price: { toString: () => '1047.00' },
      weight: 620,
      stock: 5,
      variants: buildProductSyncMeta({ statuses: { status: 'price_sent' } }, [
        { warehouse_id: 10, present: 5, reserved: 0 },
      ]),
    };

    expect(matchesProductListComputedFilters(lightCheap, {
      priceMin: 100,
      priceMax: 300,
      weightMax: 100,
      warehouseId: '10',
      warehouseStockMode: 'out_of_stock',
    })).toBe(true);
    expect(matchesProductListComputedFilters(heavyExpensive, {
      priceMin: 100,
      priceMax: 300,
      weightMax: 100,
      warehouseId: '10',
      warehouseStockMode: 'out_of_stock',
    })).toBe(false);
    expect(matchesProductListComputedFilters(heavyExpensive, {
      stockMin: 5,
      warehouseId: '10',
      warehouseStockMode: 'in_stock',
    })).toBe(true);
  });

  it('counts product status buckets for product list tabs', () => {
    const rows = [
      { visibility: 'VISIBLE', syncStatus: 'SYNCED' },
      { visibility: 'ARCHIVED', syncStatus: 'SYNCED' },
      { visibility: 'MISSING', syncStatus: 'SYNCED' },
      { visibility: 'VISIBLE', syncStatus: 'MISSING' },
      { visibility: 'visible', syncStatus: null },
    ];

    expect(rows.map(getProductStatusBucket)).toEqual([
      'current',
      'archived',
      'missing',
      'missing',
      'current',
    ]);
    expect(buildProductStatusCounts(rows)).toEqual({
      current: 2,
      archived: 1,
      missing: 2,
      all: 5,
    });
  });
});
