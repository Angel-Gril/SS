import { describe, expect, it } from 'vitest';
import { OzonApiError } from '../services/ozon-client.js';

describe('Ozon client errors', () => {
  it('localizes blocked company errors for shop-dependent Ozon APIs', () => {
    const error = new OzonApiError(
      403,
      JSON.stringify({ message: 'Company is blocked, please contact support' }),
      '/v1/description-category/tree',
    );

    expect(error.publicMessage).toContain('当前 Ozon 店铺或公司已被平台限制');
    expect(error.publicMessage).toContain('请选择其他店铺');
    expect(error.message).not.toContain('Company is blocked');
  });
});
