import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assessAiImageAlibabaConsoleBillingObservation, inspectAiImageAlibabaConsoleBillingObservation,
} from '../services/ai-image-alibaba-console-billing-observation.js';

import {
  alibabaConsoleDigest as digest, alibabaConsoleAccountId as account, alibabaConsoleNbidSha256 as nbidDigest, alibabaConsoleObservationNow as now,
  alibabaConsoleBillRow as row, alibabaConsoleResponse as response, alibabaConsoleObservation as observation,
} from './fixtures/ai-image-alibaba-console-billing.js';

const invalid = { code: 'ALIBABA_CONSOLE_BILLING_OBSERVATION_INVALID' };
const roots: string[] = [];

function body(value: ReturnType<typeof observation>, index: number) {
  return JSON.parse(Buffer.from(value.captures[index]!.response.bodyBase64, 'base64').toString());
}
function changeBody(value: ReturnType<typeof observation>, index: number, edit: (body: any) => void) {
  const original = body(value, index); edit(original); value.captures[index]!.response = response(original);
}
function assess(value: unknown = observation(), expectedAccountUidSha256 = digest(account)) {
  return assessAiImageAlibabaConsoleBillingObservation({ observation: value,
    observationSha256: digest(JSON.stringify(value)), expectedAccountUidSha256, now });
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(root).startsWith('alibaba-console-billing-'));
    await rm(root, { recursive: true, force: true });
  }
});

describe('native console ListConsumeDetails billing observation', () => {
  it('keeps Count/Data, Nbid, resource accounts and free quota separate without authorizing settlement', () => {
    const value = observation();
    const result = assess(value);
    expect(result).toMatchObject({ kind: 'ALIBABA_CONSOLE_BILLING_ASSESSMENT_V1',
      state: 'RECONCILIATION_REQUIRED', actualCost: null, canFinalize: false,
      query: { product: 'BssOpenAPI-V3', action: 'ListConsumeDetails', tableType: 'consumeDetailBillV2',
        granularity: 'HOURLY', billingCycle: '2026-09', billingMonth: '2026-09', nbidSha256: nbidDigest },
      pagination: { pageNumber: 1, maxResults: 20, totalCount: 1, returnedCount: 1, complete: true },
      account: { expectedAccountUidSha256: digest(account), resourceAccountsMatched: true,
        queryAccountIdentity: 'NOT_PROVEN_BY_NBID' },
    });
    expect(result.source.captures.map((item) => item.bodySha256)).toEqual(value.captures.map((item) => item.response.bodySha256));
    expect(result.records[0]).toMatchObject({ resourcePurchaseAccountUidSha256: digest(account), resourceOwnerUidSha256: digest(account),
      apiKeyIdSha256: digest('synthetic-key-id'), workspaceIdSha256: digest('synthetic-workspace'),
      modelSha256: digest('wanx2.1-imageedit'), regionSha256: digest('cn-beijing'), freeQuotaLabel: true,
      dates: { billingMonth: '2026-09', billingDate: '2026-09-07', consumedTime: '2026-09-07 10:20:00',
        consumedTimeStart: '2026-09-07 10:20:00', consumedTimeEnd: '2026-09-07 10:21:00' },
      imageQuantity: { unit: '张', beforeDeduction: 1, resourcePlanDeducted: 1, billed: 0 },
      amounts: { requireAmount: { currency: 'CNY', amount: 0, scale: 0 } }, cashPaidAmount: null });
    expect(result.reasons).toContain('PROVIDER_TASK_BILL_LINK_MISSING');
    expect(result.reasons).toContain('BILLING_PERIOD_FINALITY_UNVERIFIED');
    expect(result).not.toHaveProperty('billingGate');
    for (const secret of [account, 'synthetic-key-id', 'synthetic-workspace', 'synthetic-bill-001',
      'synthetic-console-collector', 'synthetic-data-request', value.captures[1]!.response.bodyBase64]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it.each(['string', 'number'])('observes synthetic 0.14 payable as %s without claiming real paid evidence', (kind) => {
    const amount = kind === 'string' ? '0.14' : 0.14;
    const result = assess(observation([row({ LineItemType: '合成按量费用', ResourcePlanDeductQuantity: '0', BillingQuantity: '1',
      ListPrice: amount, ListUnitPrice: amount, AmountAfterPromotionDeduction: amount,
      RequireAmount: amount, AmountAfterCouponDeduction: amount })]));
    expect(result.records[0]!.amounts.requireAmount).toEqual({ currency: 'CNY', amount: 14, scale: 2 });
    expect(result.records[0]!.freeQuotaLabel).toBe(false);
    expect(result.records[0]!.imageQuantity).toEqual({ unit: '张', beforeDeduction: 1, resourcePlanDeducted: 0, billed: 1 });
    expect(result.records[0]!.cashPaidAmount).toBeNull();
    expect(result).toMatchObject({ actualCost: null, canFinalize: false });
  });

  it.each(['0.14000000000000001', '9007199254740993', '1e309', '1e-9', '-0', '-0.14'])('rejects unrepresentable raw money %s without Number coercion', (token) => {
    const value = observation();
    const raw = Buffer.from(value.captures[1]!.response.bodyBase64, 'base64').toString().replace('"RequireAmount":"0"', `"RequireAmount":${token}`);
    value.captures[1]!.response = response(raw);
    expect(() => assess(value)).toThrow(expect.objectContaining(invalid));
  });

  it.each(['1.4e-1', '0.14000000', '0.12345678'])('preserves native money lexeme %s exactly', (token) => {
    const value = observation();
    value.captures[1]!.response = response(Buffer.from(value.captures[1]!.response.bodyBase64, 'base64').toString()
      .replace('"RequireAmount":"0"', `"RequireAmount":${token}`));
    const expected = token === '0.12345678' ? { amount: 12345678, scale: 8 } : { amount: 14, scale: 2 };
    expect(assess(value).records[0]!.amounts.requireAmount).toEqual({ currency: 'CNY', ...expected });
  });

  it('never treats no rows as no charge or as an authenticated account', () => {
    const result = assess(observation([]));
    expect(result.pagination.complete).toBe(true);
    expect(result.account.resourceAccountsMatched).toBe(false);
    expect(result.reasons).toContain('NO_BILL_RECORD_IS_NOT_NO_CHARGE');
    expect(result.actualCost).toBeNull();
  });

  it('keeps a complete first page distinct from complete query pagination', () => {
    const rows = Array.from({ length: 20 }, (_, index) => row({ BillDetailId: `synthetic-detail-${index}`, HashKey: `synthetic-key-${index}` }));
    const value = observation(rows, 21);
    changeBody(value, 1, (data) => { data.data.NextBatchToken = 'synthetic-next-page'; });
    const result = assess(value);
    expect(result.pagination).toMatchObject({ complete: false, returnedCount: 20, totalCount: 21,
      nextBatchTokenSha256: digest('synthetic-next-page') });
    expect(result.reasons).toContain('QUERY_PAGINATION_INCOMPLETE');
  });

  it.each(['AssistExtend', 'ResourcePlanDeductDetails'])('accepts valid whitespace in native JSON text %s without changing identifiers', (field) => {
    const native = field === 'AssistExtend' ? JSON.parse(row().AssistExtend) : { capacityDeduct: '1' };
    const result = assess(observation([row({ [field]: JSON.stringify(native, null, 2).replace(/\n/gu, '\r\n') })]));
    expect(result.records[0]!.apiKeyIdSha256).toBe(digest('synthetic-key-id'));
  });

  it.each([
    ['Metadata', 'Authorization'], ['Metadata', 'Set-Cookie'], ['Metadata', 'X-API-Key'],
    ['AssistExtend', 'apiKey'], ['AssistExtend', 'API_KEY'], ['ResourcePlanDeductDetails', 'accessKeySecret'],
  ])('rejects known credential key %s.%s inside native JSON', (field, key) => {
    const value = observation();
    changeBody(value, 1, (data) => {
      if (field === 'Metadata') data.data.Metadata = { nested: [{ [key]: 'synthetic-secret-must-not-import' }] };
      else {
        const native = field === 'AssistExtend' ? JSON.parse(data.data.Data[0][field]) : {};
        native.extra = { [key]: 'synthetic-secret-must-not-import' };
        data.data.Data[0][field] = JSON.stringify(native);
      }
    });
    expect(() => assess(value)).toThrow(expect.objectContaining(invalid));
  });

  it('retains legitimate API key IDs, paging tokens and private account fields', () => {
    const value = observation();
    changeBody(value, 1, (data) => {
      data.data.Metadata = { apiKeyId: 'synthetic-display-key-id', NextBatchToken: 'synthetic-display-cursor',
        ResourceOwnerAccountId: account };
    });
    expect(assess(value).records[0]!.apiKeyIdSha256).toBe(digest('synthetic-key-id'));
  });

  it.each(['purchase', 'owner', 'nbid'])('rejects wrong %s identity without confusing Nbid with the account', (field) => {
    const value = observation([row(field === 'purchase' ? { ResourcePurchaseAccountId: '9000000000000002' }
      : field === 'owner' ? { ResourceOwnerAccountId: '9000000000000002' } : {})]);
    expect(() => assess(value, field === 'nbid' ? nbidDigest : digest(account)))
      .toThrow(expect.objectContaining({ code: 'ALIBABA_CONSOLE_BILLING_ACCOUNT_MISMATCH' }));
  });

  it.each(['scope', 'Nbid', 'count', 'rows', 'max results', 'primary keys', 'next token', 'duplicate bill', 'page'])('rejects inconsistent %s', (change) => {
    const value = observation();
    if (change === 'scope') value.captures[1]!.request.params.BillingMonth = '2026-08';
    if (change === 'Nbid') value.captures[1]!.request.params.Nbid = { sha256: digest('different-navigation-id') };
    if (change === 'count') changeBody(value, 0, (data) => { data.data.TotalCount = 2; });
    if (change === 'rows') changeBody(value, 0, (data) => { data.data.Data = [row()]; });
    if (change === 'max results') changeBody(value, 1, (data) => { data.data.MaxResults = 10; });
    if (change === 'primary keys') changeBody(value, 1, (data) => { data.data.PrimaryKeys = []; });
    if (change === 'next token') changeBody(value, 1, (data) => { data.data.NextBatchToken = 'unexpected-more'; });
    if (change === 'duplicate bill') {
      changeBody(value, 0, (data) => { data.data.TotalCount = 2; });
      changeBody(value, 1, (data) => { data.data.Data.push(row()); data.data.PrimaryKeys.push('synthetic-primary-1'); });
    }
    if (change === 'page') value.captures[1]!.request.params.currentPage = 2;
    expect(() => assess(value)).toThrow(expect.objectContaining(invalid));
  });

  it.each(['duplicate amount', 'escaped duplicate', 'nested metadata duplicate', 'invalid UTF-8', 'BOM', 'base64', 'digest',
    'deep JSON', 'oversize', 'truncated escape', 'header', 'kind', 'response failed', 'future capture', 'future observation'])('rejects %s', (change) => {
    const value = observation();
    let raw = Buffer.from(value.captures[1]!.response.bodyBase64, 'base64');
    if (change === 'duplicate amount') raw = Buffer.from(raw.toString().replace('"RequireAmount":"0"', '"RequireAmount":1,"RequireAmount":"0"'));
    if (change === 'escaped duplicate') raw = Buffer.from(raw.toString().replace('"RequireAmount":"0"', '"\\u0052equireAmount":1,"RequireAmount":"0"'));
    if (change === 'nested metadata duplicate') changeBody(value, 1, (data) => {
      data.data.Data[0].AssistExtend = '{"maasProject":{"apiKeyId":"first","apiKeyId":"second"}}';
    });
    if (change === 'invalid UTF-8') raw = Buffer.from([0xc3, 0x28]);
    if (change === 'BOM') raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]);
    if (change === 'deep JSON') raw = Buffer.from('['.repeat(14) + '0' + ']'.repeat(14));
    if (change === 'oversize') raw = Buffer.alloc(4 * 1024 * 1024 + 1, ' ');
    if (change === 'truncated escape') raw = Buffer.from('{"a":"' + '\\\"'.repeat(4_000));
    if (['duplicate amount', 'escaped duplicate', 'invalid UTF-8', 'BOM', 'deep JSON', 'oversize', 'truncated escape'].includes(change)) {
      value.captures[1]!.response = { ...response(''), bodyBase64: raw.toString('base64'), bodySha256: digest(raw) };
    }
    if (change === 'base64') value.captures[1]!.response.bodyBase64 += '\n';
    if (change === 'digest') value.captures[1]!.response.bodySha256 = '0'.repeat(64);
    if (change === 'header') (value.captures[1]!.request as any).headers = { cookie: 'synthetic-private-cookie' };
    if (change === 'kind') value.kind = 'ALIBABA_NATIVE_BILLING_OBSERVATION_V1';
    if (change === 'response failed') changeBody(value, 1, (data) => { data.successResponse = false; });
    if (change === 'future capture') value.captures[0]!.capturedAt = '2026-09-08T12:10:00.000Z';
    if (change === 'future observation') value.observedAt = '2026-09-08T12:10:00.000Z';
    expect(() => assess(value)).toThrow(expect.objectContaining(invalid));
  });

  it.each([{ BillingDate: '2026-09-31' }, { BillingMonth: '2026-08' }, { ConsumedTime: 'private arbitrary text' },
    { ConsumedTimeEnd: '2026-09-07 10:19:00' }, { ConsumedTimeStart: '2026-09-07 25:00:00' },
    { QuantityBeforeDeduction: '0.5' }, { Currency: 'USD' }, { BillingQuantityUnit: 'tokens' }])('rejects invalid native row %j', (extra) => {
    expect(() => assess(observation([row(extra)]))).toThrow(expect.objectContaining(invalid));
  });

  it('reads pinned original wrapper bytes without a write and preserves CRLF response digests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alibaba-console-billing-')); roots.push(root);
    const value = observation();
    value.captures[1]!.response = response(JSON.stringify(body(value, 1), null, 2).replace(/\n/gu, '\r\n') + '\r\n');
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\r\n`);
    const path = join(root, 'observation.json'); await writeFile(path, bytes, { mode: 0o600 });
    const result = await inspectAiImageAlibabaConsoleBillingObservation({ repositoryRoot: root, evidenceRoot: root,
      observationPath: path, observationSha256: digest(bytes), expectedAccountUidSha256: digest(account), now });
    expect(result.source.observationSha256).toBe(digest(bytes));
    expect(result.source.captures[1]!.bodySha256).toBe(value.captures[1]!.response.bodySha256);
    expect(await readFile(path)).toEqual(bytes);
    expect(await readdir(root)).toEqual(['observation.json']);
  });
});
