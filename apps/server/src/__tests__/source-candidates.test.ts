import { describe, expect, it } from 'vitest';
import {
  exportSourceQuotesCsv,
  normalizeSourceCandidateSyncPayload,
} from '../routes/source-candidates.js';

describe('source candidate sync helpers', () => {
  it('normalizes an Ozon-linked 1688 SKU quote for ERP persistence', () => {
    const payload = normalizeSourceCandidateSyncPayload({
      ozon: {
        productId: '1663890868',
        title: 'Концентратор кислорода 0-8 л/мин',
        url: 'https://www.ozon.ru/product/foo-1663890868/',
        price: { value: 692.51, currency: 'CNY' },
      },
      sourceProduct: {
        platform: '1688',
        productId: '523212088534',
        url: 'https://detail.1688.com/offer/523212088534.html',
        title: '欧井大功率家用除湿机',
        shopName: '浙江欧伦电气股份有限公司',
        priceCny: 800,
        shippingCny: 0,
        totalCostCny: 800,
        priceText: '¥800',
        selectedSku: {
          skuId: 'OJ-231E',
          specText: '20L/D 310W',
          quantity: 1,
          attrs: { 除湿量: '20L/D', 额定功率: '310W' },
        },
        images: ['https://cbu01.alicdn.com/img.jpg'],
        skuItems: [{ skuId: 'OJ-129E', price: 599 }, { skuId: 'OJ-231E', price: 800 }],
      },
      quote: {
        costCny: 800,
        status: 'selected_for_costing',
        result: { profitCny: -314.87, marginPct: -45.47 },
      },
    });

    expect(payload.candidate.key).toBe('1663890868|1688|523212088534|OJ-231E');
    expect(payload.source.sku).toBe('OJ-231E');
    expect(payload.source.skuAttributes).toEqual({ 除湿量: '20L/D', 额定功率: '310W' });
    expect(payload.source.unitPriceCny).toBe(800);
    expect(payload.source.shippingCny).toBe(0);
    expect(payload.source.totalCostCny).toBe(800);
    expect(payload.source.images).toHaveLength(1);
    expect(payload.source.skuItems).toHaveLength(2);
    expect(payload.quote.costCny).toBe(800);
    expect(payload.quote.profitCny).toBe(-314.87);
    expect(payload.quote.marginPct).toBe(-45.47);
  });

  it('exports ERP source quote rows as CSV', () => {
    const csv = exportSourceQuotesCsv([
      {
        ozonProductId: '1663890868',
        ozonUrl: 'https://www.ozon.ru/product/foo-1663890868/',
        ozonTitle: 'Ozon title',
        ozonPrice: '692.51',
        sourcePlatform: '1688',
        sourceProductId: '523212088534',
        sourceSku: 'OJ-231E',
        sourceUrl: 'https://detail.1688.com/offer/523212088534.html',
        sourceTitle: '欧井大功率家用除湿机',
        costCny: '800',
        sourceUnitPrice: '800',
        sourceShippingCny: '0',
        status: 'selected_for_costing',
        createdAt: new Date('2026-06-14T00:00:00.000Z'),
        updatedAt: new Date('2026-06-14T00:00:00.000Z'),
      },
    ]);

    expect(csv).toContain('ozonProductId,ozonUrl,ozonTitle');
    expect(csv).toContain('1663890868');
    expect(csv).toContain('OJ-231E');
    expect(csv).toContain('800');
  });
});
