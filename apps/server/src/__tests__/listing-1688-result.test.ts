import { describe, expect, it } from 'vitest';
import {
  applyAlibaba1688ListingResultMetadata,
  appendListingTaskHistory,
  buildAlibaba1688ListingResultUpdates,
  getListingResultStatus,
} from '../routes/listing.js';

describe('1688 listing result helpers', () => {
  it('classifies Ozon import results', () => {
    expect(getListingResultStatus([{ status: 'imported' }])).toBe('imported');
    expect(getListingResultStatus([{ status: 'imported' }, { status: 'failed' }])).toBe('partial_failed');
    expect(getListingResultStatus([{ status: 'failed' }])).toBe('failed');
    expect(getListingResultStatus([{ status: 'pending' }])).toBe('pending');
  });

  it('groups Ozon import results by 1688 collection record while preserving source and Ozon SKU trace', () => {
    const updates = buildAlibaba1688ListingResultUpdates({
      taskId: 77,
      listingJobId: 'job-77',
      shopId: 'shop-1',
      refreshedAt: '2026-06-08T10:00:00.000Z',
      payload: {
        listingSources: [
          {
            supplyGoodsId: 'collect-success',
            sourcePlatform: '1688',
            sourceProductId: '734567890123',
            sourceSkuId: 'source-sku-red',
            ozonSku: 'ozon-sku-red',
            ozonProductId: '123456789',
            offerId: 'ss1688-734567890123-source-sku-red',
          },
          {
            supplyGoodsId: 'collect-partial',
            sourcePlatform: '1688',
            sourceProductId: '734567890123',
            sourceSkuId: 'source-sku-blue',
            ozonSku: 'ozon-sku-blue',
            offerId: 'ss1688-734567890123-source-sku-blue',
          },
          {
            supplyGoodsId: 'collect-partial',
            sourcePlatform: '1688',
            sourceProductId: '734567890123',
            sourceSkuId: 'source-sku-green',
            ozonSku: 'ozon-sku-green',
            offerId: 'ss1688-734567890123-source-sku-green',
          },
          {
            supplyGoodsId: 'collect-failed',
            sourcePlatform: '1688',
            sourceProductId: '734567890123',
            sourceSkuId: 'source-sku-black',
            offerId: 'ss1688-734567890123-source-sku-black',
          },
        ],
      },
      importItems: [
        {
          offer_id: 'ss1688-734567890123-source-sku-red',
          product_id: 9001,
          status: 'imported',
          errors: [],
        },
        {
          offer_id: 'ss1688-734567890123-source-sku-blue',
          product_id: 9002,
          status: 'imported',
          errors: [],
        },
        {
          offer_id: 'ss1688-734567890123-source-sku-green',
          product_id: 0,
          status: 'failed',
          errors: [{ code: 'ATTRIBUTE_ERROR', description: 'required attribute missing', field: 'attributes' }],
        },
        {
          offer_id: 'ss1688-734567890123-source-sku-black',
          product_id: 0,
          status: 'failed',
          errors: [{ code: 'IMAGE_ERROR', description: 'bad image', field: 'images' }],
        },
      ],
    });

    const byId = new Map(updates.map((update) => [update.supplyGoodsId, update]));

    expect(byId.get('collect-success')).toMatchObject({
      resultStatus: 'imported',
      importedCount: 1,
      failedCount: 0,
      pendingCount: 0,
      resultItems: [
        {
          offerId: 'ss1688-734567890123-source-sku-red',
          productId: '9001',
          status: 'imported',
          sourcePlatform: '1688',
          sourceSkuId: 'source-sku-red',
          ozonSku: 'ozon-sku-red',
          ozonProductId: '123456789',
        },
      ],
    });
    expect(byId.get('collect-partial')).toMatchObject({
      resultStatus: 'partial_failed',
      importedCount: 1,
      failedCount: 1,
      pendingCount: 0,
    });
    expect(byId.get('collect-failed')).toMatchObject({
      resultStatus: 'failed',
      importedCount: 0,
      failedCount: 1,
      pendingCount: 0,
    });

    const metadata = applyAlibaba1688ListingResultMetadata(
      {
        sourceKind: 'alibaba1688',
        listingTasks: [{ taskId: 77, submittedAt: '2026-06-08T09:59:00.000Z' }],
      },
      byId.get('collect-partial')!,
    );

    expect(metadata).toMatchObject({
      sourceKind: 'alibaba1688',
      listingStatus: 'partial_failed',
      lastListingTaskId: 77,
      lastListingJobId: 'job-77',
      lastListingShopId: 'shop-1',
      lastListingResultStatus: 'partial_failed',
      lastListingImportedCount: 1,
      lastListingFailedCount: 1,
      lastListingPendingCount: 0,
      lastListingRefreshedAt: '2026-06-08T10:00:00.000Z',
      listingTasks: [
        {
          taskId: 77,
          resultStatus: 'partial_failed',
          importedCount: 1,
          failedCount: 1,
          pendingCount: 0,
        },
      ],
    });
  });

  it('keeps result statistics complete while bounding stored result item details', () => {
    const listingSources = Array.from({ length: 105 }, (_, index) => ({
      supplyGoodsId: 'collect-large',
      sourcePlatform: '1688',
      sourceProductId: '734567890123',
      sourceSkuId: `source-sku-${index + 1}`,
      offerId: `ss1688-734567890123-source-sku-${index + 1}`,
    }));
    const importItems = listingSources.map((source, index) => ({
      offer_id: source.offerId,
      product_id: 10000 + index,
      status: index < 104 ? 'imported' : 'failed',
      errors: index < 104 ? [] : [{ code: 'LAST_ONE_FAILED', description: 'last variant failed' }],
    }));

    const [update] = buildAlibaba1688ListingResultUpdates({
      taskId: 88,
      listingJobId: 'job-88',
      shopId: 'shop-1',
      refreshedAt: '2026-06-08T10:10:00.000Z',
      payload: { listingSources },
      importItems,
    });

    expect(update).toBeDefined();
    expect(update).toMatchObject({
      supplyGoodsId: 'collect-large',
      resultStatus: 'partial_failed',
      importedCount: 104,
      failedCount: 1,
      pendingCount: 0,
    });
    expect(update!.offerIds).toHaveLength(105);
    expect(update!.resultItems).toHaveLength(100);
    expect(update!.resultItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        offerId: 'ss1688-734567890123-source-sku-105',
        sourceSkuId: 'source-sku-105',
        status: 'failed',
      }),
    ]));
  });

  it('marks a retry submission as current and clears stale Ozon result summary', () => {
    const metadata = appendListingTaskHistory(
      {
        sourceKind: 'alibaba1688',
        listingStatus: 'partial_failed',
        lastListingTaskId: 77,
        lastListingResultStatus: 'partial_failed',
        lastListingFailedCount: 1,
        lastListingImportedCount: 1,
        lastListingPendingCount: 0,
        lastListingRefreshedAt: '2026-06-08T10:00:00.000Z',
        lastListingResultItems: [
          { offerId: 'ss1688-old-success', sourceSkuId: 'sku-red', status: 'imported' },
          { offerId: 'ss1688-old-failed', sourceSkuId: 'sku-green', status: 'failed' },
        ],
        listingTasks: [
          {
            taskId: 77,
            resultStatus: 'partial_failed',
            importedCount: 1,
            failedCount: 1,
            pendingCount: 0,
          },
        ],
      },
      {
        taskId: 78,
        listingJobId: 'job-78',
        shopId: 'shop-1',
        offerIds: ['ss1688-new-failed-retry'],
        submittedAt: '2026-06-08T11:00:00.000Z',
      },
    );

    expect(metadata).toMatchObject({
      listingStatus: 'submitted',
      lastListingTaskId: 78,
      lastListingResultStatus: 'submitted',
      lastListingFailedCount: 0,
      lastListingImportedCount: 0,
      lastListingPendingCount: 0,
      lastListingRefreshedAt: null,
      lastListingResultItems: [],
      listingTasks: [
        {
          taskId: 78,
          submittedAt: '2026-06-08T11:00:00.000Z',
        },
        {
          taskId: 77,
          resultStatus: 'partial_failed',
        },
      ],
    });
  });
});
