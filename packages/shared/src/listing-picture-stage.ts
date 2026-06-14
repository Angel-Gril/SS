export type ListingJobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | string;

export type ListingPictureStageCode =
  | 'not_applicable'
  | 'product_creating'
  | 'product_created'
  | 'waiting_product_id'
  | 'picture_uploading'
  | 'pictures_submitted'
  | 'picture_failed'
  | 'needs_refresh'
  | 'listing_failed';

export type ListingPictureStageTone = 'neutral' | 'info' | 'warning' | 'success' | 'error';

export interface ListingPictureStage {
  code: ListingPictureStageCode;
  label: string;
  description: string;
  tone: ListingPictureStageTone;
  countLabel?: string;
}

export interface ListingPictureUploadEntry {
  offerId?: string;
  productId?: number | null;
  status?: string;
  imageCount?: number;
  resolvedCount?: number;
}

export interface ListingPictureStagePayload {
  source?: string;
  mode?: string;
  itemCount?: number;
  failedCount?: number;
  pictureUploads?: ListingPictureUploadEntry[] | null;
  pictureUploadStatus?: 'pending' | 'success' | 'failed' | string;
  pictureUploadPendingCount?: number;
  pictureUploadFailedCount?: number;
  pictureUploadSkippedCount?: number;
  pictureUploadError?: string | null;
}

export interface ListingPictureStageInput {
  status?: ListingJobStatus;
  payload?: ListingPictureStagePayload | null;
}

export function isFallbackPictureJob(payload?: ListingPictureStagePayload | null): boolean {
  return payload?.source === 'collect-publish-fallback' || payload?.mode === 'follow-by-sku';
}

function positiveCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function resolveListingPictureStage(input: ListingPictureStageInput): ListingPictureStage {
  const status = String(input.status || '').toUpperCase();
  const payload = input.payload || {};
  const fallbackPictureJob = isFallbackPictureJob(payload);
  const pictureUploads = Array.isArray(payload.pictureUploads) ? payload.pictureUploads : [];
  const pictureStatus = String(payload.pictureUploadStatus || '').toLowerCase();
  const pendingCount = positiveCount(payload.pictureUploadPendingCount);
  const failedCount = positiveCount(payload.pictureUploadFailedCount) + positiveCount(payload.pictureUploadSkippedCount);

  if (status === 'FAILED') {
    return {
      code: 'listing_failed',
      label: '上架失败',
      description: 'Ozon 没有完成商品创建，请先查看失败原因。',
      tone: 'error',
    };
  }

  if (!fallbackPictureJob) {
    if (status === 'RUNNING' || status === 'PENDING') {
      return {
        code: 'product_creating',
        label: '商品创建中',
        description: '正在等待 Ozon 返回上架结果。',
        tone: 'warning',
      };
    }
    if (status === 'SUCCESS') {
      return {
        code: 'product_created',
        label: '商品已创建',
        description: '商品创建已完成。非 fallback 路径的图片随上架 payload 一起提交。',
        tone: 'success',
      };
    }
    return {
      code: 'not_applicable',
      label: '未开始',
      description: '暂无可展示的图片处理阶段。',
      tone: 'neutral',
    };
  }

  if (pictureStatus === 'failed' || failedCount > 0 || payload.pictureUploadError) {
    return {
      code: 'picture_failed',
      label: '图片补传异常',
      description: '商品可能已创建，但部分图片没有成功补传。请刷新任务详情查看具体 offer。',
      tone: 'error',
      ...(failedCount ? { countLabel: `${failedCount} 个异常` } : {}),
    };
  }

  if (pictureStatus === 'success') {
    const uploadedCount = pictureUploads.filter((entry) => entry.status === 'uploaded').length;
    return {
      code: 'pictures_submitted',
      label: '图片已提交给 Ozon',
      description: '商品已创建，图片已补传；Ozon 列表缩略图可能延迟几分钟显示。',
      tone: 'success',
      ...(uploadedCount ? { countLabel: `${uploadedCount} 个 offer` } : {}),
    };
  }

  if (pictureStatus === 'pending') {
    if (pendingCount > 0 || status === 'RUNNING') {
      return {
        code: 'waiting_product_id',
        label: '等待 Ozon 生成商品ID',
        description: '商品创建任务已提交，系统拿到 product_id 后会继续补传图片。',
        tone: 'warning',
        ...(pendingCount ? { countLabel: `剩余 ${pendingCount}` } : {}),
      };
    }
    return {
      code: 'picture_uploading',
      label: '图片补传中',
      description: '商品已创建，系统正在把采集到的变体图片补传给 Ozon。',
      tone: 'warning',
    };
  }

  if (status === 'SUCCESS' && pictureUploads.length === 0) {
    return {
      code: 'needs_refresh',
      label: '待刷新补图状态',
      description: '这是旧任务或刚完成的任务，打开详情/刷新后会继续确认图片补传结果。',
      tone: 'warning',
    };
  }

  if (status === 'RUNNING' || status === 'PENDING') {
    return {
      code: 'product_creating',
      label: '商品创建中',
      description: '正在等待 Ozon 创建商品，完成后系统会继续补传图片。',
      tone: 'warning',
    };
  }

  return {
    code: 'product_created',
    label: '商品已创建',
    description: '商品创建已完成，图片状态等待下一次刷新确认。',
    tone: 'info',
  };
}
