import { describe, expect, it } from 'vitest';
import { buildProductSyncMeta, getOzonStatusDisplay, getWarehouseStock } from '../services/product-sync-metadata.js';

describe('product sync metadata helpers', () => {
  it('keeps Ozon status fields and warehouse stock details for product list display', () => {
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
      name: 'В продаже',
      description: 'Готов к продаже',
      moderateStatus: 'approved',
    });
    expect(getWarehouseStock(meta, 10)).toBe(4);
    expect(getWarehouseStock(meta, 20)).toBe(2);
    expect(getWarehouseStock(meta, 30)).toBeNull();
  });
});
