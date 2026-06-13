import { describe, expect, it } from 'vitest';
import { isOzonImportItemFailed, summarizeOzonImportItems } from '../services/ozon-import-status.js';

describe('ozon import status', () => {
  it('treats imported items with error-level validation errors as failed', () => {
    expect(isOzonImportItemFailed({
      status: 'imported',
      errors: [{
        level: 'error',
        state: 'declined',
        code: 'DESCRIPTION_DECLINE',
        description: 'В названии бессмысленный текст',
      }],
    })).toBe(true);
  });

  it('keeps imported items with warning-only picture errors out of failed count', () => {
    expect(isOzonImportItemFailed({
      status: 'imported',
      errors: [{
        level: 'warning',
        state: 'pics_delivered',
        code: 'pics_http_error',
        description: 'Не удалось скачать фото по ссылке',
      }],
    })).toBe(false);
  });

  it('summarizes pending and failed import items', () => {
    expect(summarizeOzonImportItems([
      { status: 'imported', errors: [] },
      { status: 'pending', errors: [] },
      { status: 'imported', errors: [{ level: 'error', state: 'declined' }] },
    ])).toEqual({ total: 3, pending: 1, failed: 1, allDone: false });
  });
});
