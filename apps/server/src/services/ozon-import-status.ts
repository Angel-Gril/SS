import { formatOzonErrorMessage } from 'shared/ozon-error-hints';

export interface OzonImportStatusError {
  level?: string;
  state?: string;
  code?: string;
  description?: string;
  message?: string;
}

export interface OzonImportStatusItem {
  offer_id?: string;
  product_id?: number;
  status?: string;
  errors?: OzonImportStatusError[];
}

function isOzonImportBlockingError(error: OzonImportStatusError): boolean {
  const level = String(error.level || '').toLowerCase();
  const state = String(error.state || '').toLowerCase();
  return level === 'error' || state === 'declined';
}

export function isOzonImportItemFailed(item: OzonImportStatusItem): boolean {
  if (item.status === 'failed') return true;
  return (item.errors || []).some(isOzonImportBlockingError);
}

export function summarizeOzonImportItems(items: OzonImportStatusItem[]): {
  total: number;
  pending: number;
  failed: number;
  allDone: boolean;
} {
  const total = items.length;
  const pending = items.filter((item) => item.status === 'pending').length;
  const failed = items.filter(isOzonImportItemFailed).length;
  return { total, pending, failed, allDone: total > 0 && pending === 0 };
}

export function collectOzonImportReviewIssues(items: OzonImportStatusItem[]): Array<{
  offerId: string;
  productId: number | null;
  status: string;
  messages: string[];
  errors: OzonImportStatusError[];
}> {
  return items.flatMap((item) => {
    const blockingErrors = item.status === 'failed'
      ? (item.errors || [])
      : (item.errors || []).filter(isOzonImportBlockingError);
    if (!blockingErrors.length) return [];
    return [{
      offerId: String(item.offer_id || '').trim(),
      productId: Number(item.product_id || 0) || null,
      status: String(item.status || '').trim(),
      messages: blockingErrors.map((error) => formatOzonErrorMessage(error)),
      errors: blockingErrors,
    }];
  });
}
