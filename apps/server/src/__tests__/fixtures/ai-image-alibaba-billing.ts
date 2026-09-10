import { createHash } from 'node:crypto';

export const alibabaQueryAccountId = '1234567890123456';
export const alibabaBillOwnerId = '2345678901234567';
export const alibabaQueryRequestId = 'synthetic-query-request-001';
export const alibabaBillingRecordId = 'synthetic-billing-record-001';
export const alibabaObservationNow = new Date('2026-02-10T02:00:00.000Z');
export const billingDigest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function alibabaNativeBillRow(overrides: Record<string, unknown> = {}) {
  return {
    Status: 'PayFinish', Item: 'PayAsYouGoBill', Currency: 'CNY',
    UsageStartTime: '2026-01-15 10:00:00', UsageEndTime: '2026-01-15 11:00:00',
    SubscriptionType: 'PayAsYouGo', ProductCode: 'test-ai-service',
    ProductType: 'test-ai-public', PipCode: 'test-ai-service', CommodityCode: 'test-ai-public',
    ProductName: 'Synthetic AI service', ProductDetail: 'Synthetic model billing',
    RecordID: alibabaBillingRecordId, SubOrderId: 'synthetic-order-001', OwnerID: alibabaBillOwnerId,
    PretaxGrossAmount: 0.2, InvoiceDiscount: 0.06, PretaxAmount: 0.14,
    PaymentAmount: 0.1, CashAmount: 0.09, AdjustAmount: 0.01,
    DeductedByCashCoupons: 0.02, DeductedByCoupons: 0.01, DeductedByPrepaidCard: 0.01,
    OutstandingAmount: 0, RoundDownDiscount: '0', PaymentTime: '2026-01-15 12:00:00',
    ...overrides,
  };
}

export function alibabaNativeBillBody(rows: Record<string, unknown>[] = [alibabaNativeBillRow()]) {
  return {
    Code: 'Success', Message: 'Successful!', RequestId: alibabaQueryRequestId, Success: true,
    Data: {
      PageNum: 1, BillingCycle: '2026-01', AccountID: alibabaQueryAccountId, PageSize: 20,
      TotalCount: rows.length, AccountName: 'billing-fixture@example.invalid', Items: { Item: rows },
    },
  };
}

export function alibabaObservation(rawBody = JSON.stringify(alibabaNativeBillBody())) {
  return {
    schemaVersion: 1, kind: 'ALIBABA_NATIVE_BILLING_OBSERVATION_V1',
    observedAt: '2026-02-10T01:00:00.000Z', collectorRef: 'synthetic-billing-reviewer',
    request: {
      action: 'QueryBill', version: '2017-12-14', billingCycle: '2026-01',
      productCode: 'test-ai-service', productType: null, subscriptionType: 'PayAsYouGo',
      billType: 'PayAsYouGoBill', hideZeroCharge: false, pageNumber: 1, pageSize: 20,
      billOwnerId: null,
    },
    response: {
      httpStatus: 200, contentType: 'application/json; charset=utf-8',
      bodySha256: billingDigest(rawBody), bodyBase64: Buffer.from(rawBody).toString('base64'),
    },
  };
}
