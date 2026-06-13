export interface OzonImportStatusError {
  level?: string;
  state?: string;
  code?: string;
  description?: string;
  message?: string;
}

export interface OzonImportStatusItem {
  status?: string;
  errors?: OzonImportStatusError[];
}

export function isOzonImportItemFailed(item: OzonImportStatusItem): boolean {
  if (item.status === 'failed') return true;
  return (item.errors || []).some((error) => {
    const level = String(error.level || '').toLowerCase();
    const state = String(error.state || '').toLowerCase();
    return level === 'error' || state === 'declined';
  });
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
  return { total, pending, failed, allDone: pending === 0 };
}
