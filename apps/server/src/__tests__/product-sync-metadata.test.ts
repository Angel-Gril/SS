import { describe, expect, it } from 'vitest';
import {
  buildProductSyncMeta,
  getOzonStatusDisplay,
  getWarehouseStock,
  normalizeOzonSku,
  resolveOzonProductImages,
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
});
