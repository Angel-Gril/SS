import { describe, expect, it } from 'vitest';
import {
  buildShopAnalyticsGraphsSnapshot,
  buildShopAnalyticsSummarySnapshot,
  ShopAnalyticsPayloadError,
} from '../services/shop-analytics-snapshot.js';

describe('shop analytics snapshot builder', () => {
  it('keeps account and device summary totals on one normalized contract', () => {
    expect(buildShopAnalyticsSummarySnapshot({
      period: '30d',
      items: [
        { sku: 'sku-1', soldSum: '12.50', soldCount: '2' },
        { sku: 'sku-2', soldSum: 7.5, soldCount: 1 },
      ],
    })).toMatchObject({
      period: '30d',
      productCount: 2,
      totalSales: 20,
      totalOrders: 3,
      data: { type: 'what_to_sell' },
    });
  });

  it('normalizes both V3 and legacy graph totals', () => {
    const v3 = buildShopAnalyticsGraphsSnapshot({
      version: 'v3',
      period: '30d',
      dateFrom: '2026-07-12',
      dateTo: '2026-08-11',
      graphData: {},
      tableData: {
        items: [
          { metrics: { orderedUnits: 2, revenue: 9.5 } },
          { metrics: { orderedUnits: 1, revenue: 3 } },
        ],
      },
    });
    const legacy = buildShopAnalyticsGraphsSnapshot({
      version: 'legacy',
      period: '30d',
      dateFrom: '2026-07-12 00:00:00',
      dateTo: '2026-08-11 23:59:59',
      graphData: {},
      tableData: {
        result: {
          data: [
            { metrics: [2, 0, 0, 0, 9.5] },
            { metrics: [1, 0, 0, 0, 3] },
          ],
        },
      },
    });

    expect(v3).toMatchObject({
      responseVersion: '3',
      snapshot: { productCount: 2, totalSales: 12.5, totalOrders: 3 },
    });
    expect(legacy).toMatchObject({
      responseVersion: '1',
      snapshot: { productCount: 2, totalSales: 12.5, totalOrders: 3 },
    });
  });

  it('keeps the historical account graph minimum compatible', () => {
    expect(buildShopAnalyticsGraphsSnapshot({
      version: 'v1-compatible',
      period: 'legacy-period',
      graphData: {},
    })).toMatchObject({
      responseVersion: '1',
      snapshot: {
        period: 'legacy-period',
        productCount: 0,
        totalSales: 0,
        totalOrders: 0,
        data: { version: 'v1-compatible', dateFrom: null, dateTo: null },
      },
    });
  });

  it('rejects empty, non-finite, fractional-count, and out-of-range payloads', () => {
    for (const payload of [
      { items: [] },
      { items: [{ soldSum: 'Infinity', soldCount: 1 }] },
      { items: [{ soldSum: 1, soldCount: 1.5 }] },
      { items: [{ soldSum: 1_000_000_000_000, soldCount: 1 }] },
    ]) {
      expect(() => buildShopAnalyticsSummarySnapshot(payload)).toThrow(ShopAnalyticsPayloadError);
    }
  });
});
