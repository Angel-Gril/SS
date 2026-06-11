import { describe, expect, it } from 'vitest';
import { buildProductSyncMeta, getOzonStatusDisplay, getWarehouseStock } from '../services/product-sync-metadata.js';

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
    });
    expect(getOzonStatusDisplay({ ozonStatus: { status: 'archived' } }, 'archived')).toEqual({
      name: '已归档',
      description: null,
      moderateStatus: null,
    });
    expect(getOzonStatusDisplay({}, 'MISSING')).toEqual({
      name: 'Ozon 当前列表未返回',
      description: null,
      moderateStatus: null,
    });
  });
});
