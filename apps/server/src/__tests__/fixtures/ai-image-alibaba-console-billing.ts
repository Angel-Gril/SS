import { createHash } from 'node:crypto';

export const alibabaConsoleDigest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const alibabaConsoleAccountId = '9000000000000001';
export const alibabaConsoleNbidSha256 = alibabaConsoleDigest('synthetic-independent-console-navigation-id');
export const alibabaConsoleObservationNow = new Date('2026-09-08T12:00:00.000Z');

export function alibabaConsoleBillRow(extra: Record<string, unknown> = {}) {
  return {
    BillId: 'synthetic-bill-001', BillDetailId: 'synthetic-detail-001', HashKey: 'synthetic-hash-key',
    InstanceId: 'synthetic-instance', ResourcePurchaseAccountId: alibabaConsoleAccountId, ResourceOwnerAccountId: alibabaConsoleAccountId,
    ProductCode: 'sfm', CommodityCode: 'sfm_inference_public_cn', BillingItemCode: 'image_number',
    RegionCode: 'cn-beijing', Currency: 'CNY', ConsumeType: '后付费', LineItemType: '免费额度',
    BillingMonth: '2026-09', BillingDate: '2026-09-07', ConsumedTime: '2026-09-07 10:20:00',
    ConsumedTimeStart: '2026-09-07 10:20:00', ConsumedTimeEnd: '2026-09-07 10:21:00',
    BillingQuantityUnit: '张', ListPriceUnit: '元/张',
    QuantityBeforeDeduction: '1', ResourcePlanDeductQuantity: '1', BillingQuantity: '0',
    ListPrice: '0', ListUnitPrice: '0', PromotionAmount: '0', AmountAfterPromotionDeduction: '0',
    RequireAmount: '0', CouponAmount: '0', AmountAfterCouponDeduction: '0',
    AssistExtend: JSON.stringify({ maasProject: { apiKeyId: 'synthetic-key-id',
      workSpaceId: 'synthetic-workspace', modelName: 'wanx2.1-imageedit', maasType: 'synthetic' }, settleCurrency: 'CNY' }),
    ...extra,
  };
}

export function alibabaConsoleResponse(body: unknown) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return { httpStatus: 200, contentType: 'application/json', bodySha256: alibabaConsoleDigest(bytes), bodyBase64: bytes.toString('base64') };
}

export function alibabaConsoleObservation(rows = [alibabaConsoleBillRow()], totalCount = rows.length) {
  const scope = { Nbid: { sha256: alibabaConsoleNbidSha256 }, BillingCycle: '2026-09', BillingMonth: '2026-09',
    TableType: 'consumeDetailBillV2', Granularity: 'HOURLY', JumpPageSize: 10 };
  const capture = (params: Record<string, unknown>, data: Record<string, unknown>, requestId: string) => ({
    capturedAt: '2026-09-08T11:59:00.000Z',
    request: { path: '/data/api.json', method: 'POST', product: 'BssOpenAPI-V3', action: 'ListConsumeDetails', params },
    response: alibabaConsoleResponse({ code: '200', httpStatusCode: '200', successResponse: true, requestId, data }),
  });
  return { schemaVersion: 1, kind: 'ALIBABA_CONSOLE_BILLING_OBSERVATION_V1', observedAt: alibabaConsoleObservationNow.toISOString(),
    collectorRef: 'synthetic-console-collector', captures: [
      capture({ ...scope, QueryMode: 'COUNT_ONLY' }, { TotalCount: totalCount, MaxResults: 20,
        Metadata: { currencyColumns: { PricingProcessInfo: [] } }, Data: [] }, 'synthetic-count-request'),
      capture({ ...scope, QueryMode: 'DATA_ONLY', MaxResults: 20, current: 1, currentPage: 1, primaryKeys: [], Console: true },
        { MaxResults: 20, NextBatchToken: '', Metadata: {}, PrimaryKeys: rows.map((_, index) => `synthetic-primary-${index}`), Data: rows },
        'synthetic-data-request'),
    ] };
}
