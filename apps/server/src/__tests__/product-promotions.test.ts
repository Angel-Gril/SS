import { describe, expect, it } from 'vitest';
import {
  normalizePromotionActions,
  normalizePromotionProducts,
  summarizePromotionDeactivateResult,
} from '../services/product-promotions.js';

describe('product promotions helpers', () => {
  it('normalizes Ozon promotion actions from common response shapes', () => {
    const dateStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const dateEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    expect(normalizePromotionActions({
      result: {
        actions: [{
          id: 197747,
          title: 'Elastic boost',
          date_start: dateStart,
          date_end: dateEnd,
          participating_products_count: 22,
          potential_products_count: 1,
        }],
      },
    })).toEqual([{
      id: 197747,
      title: 'Elastic boost',
      dateStart,
      dateEnd,
      participatingProductsCount: 22,
      potentialProductsCount: 1,
      status: 'upcoming',
    }]);
  });

  it('normalizes participating products and fills missing fields from local products', () => {
    const products = normalizePromotionProducts({
      result: {
        products: [{
          id: 4688627147,
          price: '223',
          action_price: '198',
          stock: 18,
        }],
        total: 1,
      },
    }, new Map([
      ['4688627147', {
        title: 'AirPods case grey',
        offerId: '3618188597-XNXI',
        images: ['https://cdn.example.com/sku-grey.jpg'],
      }],
    ]));

    expect(products).toEqual({
      total: 1,
      products: [{
        productId: 4688627147,
        title: 'AirPods case grey',
        offerId: '3618188597-XNXI',
        image: 'https://cdn.example.com/sku-grey.jpg',
        price: '223',
        actionPrice: '198',
        maxActionPrice: null,
        stock: 18,
      }],
    });
  });

  it('summarizes deactivate results without treating item errors as success', () => {
    expect(summarizePromotionDeactivateResult({
      result: [{
        product_id: 1001,
        is_updated: true,
      }, {
        product_id: 1002,
        is_updated: false,
        errors: [{ message: 'cannot remove product' }],
      }],
    }, [1001, 1002])).toEqual({
      successCount: 1,
      failureCount: 1,
      failures: [{ productId: 1002, message: 'cannot remove product' }],
    });
  });
});
