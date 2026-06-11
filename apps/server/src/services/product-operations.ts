export interface ProductMutationState {
  visibility?: string | null;
  syncStatus?: string | null;
  platformProductId?: string | null;
  offerId?: string | null;
}

export function getProductMutationBlockReason(
  product: ProductMutationState,
  options: { requireOfferId?: boolean } = {},
): string | null {
  const visibility = String(product.visibility || '').trim().toUpperCase();
  const syncStatus = String(product.syncStatus || '').trim().toUpperCase();

  if (visibility === 'ARCHIVED') return '商品已归档，请先在 OZON 恢复后再操作';
  if (visibility === 'MISSING' || syncStatus === 'MISSING') {
    return '商品在 OZON 当前商品列表未返回，请先同步商品并确认仍在售';
  }
  if (!String(product.platformProductId || '').trim()) return '商品缺少平台商品 ID，请先同步商品';
  if (options.requireOfferId && !String(product.offerId || '').trim()) return '商品缺少 Offer ID，请先同步商品';
  return null;
}

export function resolveOzonBatchUpdateResults(
  response: unknown,
  expectedCount: number,
): { successfulIndexes: number[]; errors: { index: number; message: string }[] } {
  const rows = response && typeof response === 'object' && Array.isArray((response as any).result)
    ? (response as any).result as any[]
    : null;
  const successfulIndexes: number[] = [];
  const errors: { index: number; message: string }[] = [];

  for (let index = 0; index < expectedCount; index++) {
    const row = rows?.[index];
    if (!row) {
      errors.push({ index, message: 'OZON 未返回该商品的更新结果' });
      continue;
    }
    if (Array.isArray(row.errors) && row.errors.length > 0) {
      errors.push({ index, message: JSON.stringify(row.errors).slice(0, 300) });
      continue;
    }
    if (row.updated === false) {
      errors.push({ index, message: 'OZON 返回未更新' });
      continue;
    }
    successfulIndexes.push(index);
  }

  return { successfulIndexes, errors };
}
