import { describe, expect, it } from 'vitest';
import { shouldAutoRefreshProductPushJob } from '../services/listing-task-refresh.js';

describe('listing task auto refresh', () => {
  it('refreshes running product push jobs', () => {
    expect(shouldAutoRefreshProductPushJob({
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: { taskId: 123 },
    })).toBe(true);
  });

  it('refreshes pending picture follow-up jobs even after import success', () => {
    expect(shouldAutoRefreshProductPushJob({
      type: 'PRODUCT_PUSH',
      status: 'SUCCESS',
      payload: { taskId: 123, pictureUploadStatus: 'partial_pending' },
    })).toBe(true);
    expect(shouldAutoRefreshProductPushJob({
      type: 'PRODUCT_PUSH',
      status: 'SUCCESS',
      payload: { taskId: 123, pictureActivationPendingCount: 2 },
    })).toBe(true);
  });

  it('does not refresh terminal product push jobs without pending media work', () => {
    expect(shouldAutoRefreshProductPushJob({
      type: 'PRODUCT_PUSH',
      status: 'SUCCESS',
      payload: { taskId: 123, pictureUploadStatus: 'success' },
    })).toBe(false);
    expect(shouldAutoRefreshProductPushJob({
      type: 'PRODUCT_PULL',
      status: 'RUNNING',
      payload: { taskId: 123 },
    })).toBe(false);
  });
});
