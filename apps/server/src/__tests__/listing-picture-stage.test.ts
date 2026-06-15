import { describe, expect, it } from 'vitest';
import { resolveListingPictureStage } from 'shared/listing-picture-stage';

describe('listing picture stage', () => {
  it('treats successful fallback picture uploads as submitted to Ozon, not immediately visible', () => {
    const stage = resolveListingPictureStage({
      status: 'SUCCESS',
      payload: {
        source: 'collect-publish-fallback',
        mode: 'follow-by-sku',
        itemCount: 6,
        failedCount: 0,
        pictureUploadStatus: 'success',
        pictureUploads: [
          { offerId: '4170663008-IJ6B', productId: 5083285506, status: 'uploaded', imageCount: 20, resolvedCount: 20 },
          { offerId: '4656067173-KLXH', productId: 5083285499, status: 'uploaded', imageCount: 16, resolvedCount: 16 },
        ],
      },
    });

    expect(stage).toMatchObject({
      code: 'pictures_submitted',
      label: '图片已提交给 Ozon',
      tone: 'success',
    });
    expect(stage.description).toContain('缩略图可能延迟');
  });

  it('warns when uploaded fallback pictures have not appeared in Ozon product details yet', () => {
    const stage = resolveListingPictureStage({
      status: 'SUCCESS',
      payload: {
        source: 'collect-publish-fallback',
        mode: 'follow-by-sku',
        itemCount: 12,
        failedCount: 0,
        pictureUploadStatus: 'success',
        pictureActivationPendingCount: 2,
        pictureUploads: [
          { offerId: '4403041170-7JMA', productId: 5084496687, status: 'uploaded', imageCount: 13, resolvedCount: 13 },
        ],
      },
    });

    expect(stage).toMatchObject({
      code: 'pictures_submitted',
      label: '图片待 Ozon 生效',
      tone: 'warning',
      countLabel: '2 个待确认',
    });
    expect(stage.description).toContain('仍未返回图片');
  });

  it('warns when regular listing pictures have not appeared in Ozon product details yet', () => {
    const stage = resolveListingPictureStage({
      status: 'SUCCESS',
      payload: {
        source: 'collect-publish',
        mode: 'clone',
        itemCount: 13,
        failedCount: 0,
        pictureActivationPendingCount: 2,
      },
    });

    expect(stage).toMatchObject({
      code: 'pictures_submitted',
      label: '图片待 Ozon 生效',
      tone: 'warning',
      countLabel: '2 个待确认',
    });
  });

  it('shows a waiting-for-product-id stage while fallback offers are created but not ready for backfill', () => {
    const stage = resolveListingPictureStage({
      status: 'RUNNING',
      payload: {
        source: 'collect-publish-fallback',
        mode: 'follow-by-sku',
        itemCount: 6,
        pictureUploadStatus: 'pending',
        pictureUploadPendingCount: 3,
      },
    });

    expect(stage).toMatchObject({
      code: 'waiting_product_id',
      label: '等待 Ozon 生成商品ID',
      tone: 'warning',
    });
  });

  it('marks legacy successful fallback jobs without diagnostics as needing a refresh', () => {
    const stage = resolveListingPictureStage({
      status: 'SUCCESS',
      payload: {
        source: 'collect-publish-fallback',
        mode: 'follow-by-sku',
        itemCount: 6,
        pictureUploads: [],
      },
    });

    expect(stage).toMatchObject({
      code: 'needs_refresh',
      label: '待刷新补图状态',
      tone: 'warning',
    });
  });
});
