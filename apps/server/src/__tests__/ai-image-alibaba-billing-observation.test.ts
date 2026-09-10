import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assessAiImageAlibabaBillingObservation, inspectAiImageAlibabaBillingObservation,
} from '../services/ai-image-alibaba-billing-observation.js';
import {
  alibabaObservation, alibabaNativeBillBody, alibabaNativeBillRow, alibabaQueryAccountId,
  alibabaBillOwnerId, alibabaQueryRequestId, alibabaBillingRecordId, alibabaObservationNow,
  billingDigest,
} from './fixtures/ai-image-alibaba-billing.js';

const roots: string[] = [];
const invalid = { code: 'ALIBABA_BILLING_OBSERVATION_INVALID' };

function assess(observation: unknown = alibabaObservation()) {
  return assessAiImageAlibabaBillingObservation({
    observation, observationSha256: billingDigest(JSON.stringify(observation)),
    expectedAccountUidSha256: billingDigest(alibabaQueryAccountId), now: alibabaObservationNow,
  });
}

async function evidence() {
  const root = await mkdtemp(join(tmpdir(), 'ai-native-billing-evidence-'));
  roots.push(root);
  const path = join(root, 'observation.json');
  const bytes = Buffer.from(`${JSON.stringify(alibabaObservation(), null, 2)}\n`);
  await writeFile(path, bytes, { mode: 0o600 });
  return {
    bytes,
    input: { repositoryRoot: root, evidenceRoot: root, observationPath: path,
      observationSha256: billingDigest(bytes), expectedAccountUidSha256: billingDigest(alibabaQueryAccountId),
      now: alibabaObservationNow },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const path = resolve(root);
    assert.equal(dirname(path).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(path).startsWith('ai-native-billing-evidence-'));
    await rm(path, { recursive: true, force: true });
  }
});

describe('native Alibaba billing observation contract', () => {
  it('keeps query account, resource owner, query request and bill identities separate and redacted', () => {
    const result = assess();
    expect(result.source.queryRequestIdSha256).toBe(billingDigest(alibabaQueryRequestId));
    expect(result.account).toEqual({
      queryAccountUidSha256: billingDigest(alibabaQueryAccountId),
      relationshipToProviderKey: 'NOT_PROVEN_BY_QUERY_BILL',
    });
    expect(result.records[0]).toMatchObject({
      billingRecordIdSha256: billingDigest(alibabaBillingRecordId),
      resourceOwnerUidSha256: billingDigest(alibabaBillOwnerId),
    });
    expect(result.query).not.toHaveProperty('productCode');
    expect(result.query).toHaveProperty('productCodeSha256', billingDigest('test-ai-service'));
    const serialized = JSON.stringify(result);
    for (const value of [alibabaQueryAccountId, alibabaBillOwnerId, alibabaQueryRequestId,
      alibabaBillingRecordId, 'billing-fixture@example.invalid', 'Synthetic AI service',
      'synthetic-billing-reviewer', 'synthetic-order-001']) expect(serialized).not.toContain(value);
    expect(result).not.toHaveProperty('providerRequestIdHash');
    expect(result).not.toHaveProperty('billingGate');
  });

  it.each(['PayFinish', 'PayUnclear', 'PayUnsettle', 'NoSettle'])(
    'never converts %s or zero cash into a request settlement', (Status) => {
      const result = assess(alibabaObservation(JSON.stringify(alibabaNativeBillBody([
        alibabaNativeBillRow({ Status, CashAmount: 0 }),
      ]))));
      expect(result).toMatchObject({ state: 'RECONCILIATION_REQUIRED', actualCost: null, canFinalize: false });
      expect(result.records[0]!.amounts.pretaxAmount).toEqual({ currency: 'CNY', amount: 14, scale: 2 });
      expect(result.records[0]!.amounts.cashAmount).toEqual({ currency: 'CNY', amount: 0, scale: 0 });
      expect(result.reasons).toContain('PROVIDER_TASK_BILL_LINK_MISSING');
      expect(result.reasons).toContain('BILLING_PERIOD_FINALITY_UNVERIFIED');
    },
  );

  it('does not turn an empty complete query into NO_CHARGE', () => {
    const result = assess(alibabaObservation(JSON.stringify(alibabaNativeBillBody([]))));
    expect(result.pagination).toMatchObject({ complete: true, totalCount: 0, returnedCount: 0 });
    expect(result.reasons).toContain('NO_BILL_RECORD_IS_NOT_NO_CHARGE');
    expect(result.actualCost).toBeNull();
    expect(result.canFinalize).toBe(false);
  });

  it('reports incomplete pagination without extrapolating a page into account totals', () => {
    const body = alibabaNativeBillBody();
    body.Data.PageSize = 1;
    body.Data.TotalCount = 2;
    const observation = alibabaObservation(JSON.stringify(body));
    observation.request.pageSize = 1;
    const result = assess(observation);
    expect(result.pagination).toMatchObject({ pageSize: 1, totalCount: 2, returnedCount: 1, complete: false });
    expect(result.reasons).toContain('QUERY_PAGINATION_INCOMPLETE');
    expect(result.actualCost).toBeNull();
  });

  it.each([
    ['0.12345678', 12345678, 8], ['1.4e-1', 14, 2], ['0.14000000', 14, 2], ['1e2', 100, 0],
  ])('retains exact native decimal %s before JavaScript number rounding', (raw, amount, scale) => {
    const body = JSON.stringify(alibabaNativeBillBody()).replace('"PretaxAmount":0.14', `"PretaxAmount":${raw}`);
    expect(assess(alibabaObservation(body)).records[0]!.amounts.pretaxAmount)
      .toEqual({ currency: 'CNY', amount, scale });
  });

  it.each(['0.14000000000000001', '9007199254740993', '1e309', '1e-9', '-0', '-0.1', '"0.14"'])(
    'rejects unsupported native money %s without rounding or coercion', (raw) => {
      const body = JSON.stringify(alibabaNativeBillBody()).replace('"PretaxAmount":0.14', `"PretaxAmount":${raw}`);
      expect(() => assess(alibabaObservation(body))).toThrow(expect.objectContaining(invalid));
    },
  );

  it('preserves missing optional deductions as unknown rather than zero', () => {
    const row = alibabaNativeBillRow();
    delete (row as Record<string, unknown>).DeductedByCashCoupons;
    expect(assess(alibabaObservation(JSON.stringify(alibabaNativeBillBody([row])))).records[0]!.amounts.deductedByCashCoupons).toBeNull();
  });

  it.each(['UsageStartTime', 'UsageEndTime', 'PaymentTime'])(
    'rejects arbitrary text in native %s instead of reflecting it', (field) => {
      const raw = JSON.stringify(alibabaNativeBillBody([alibabaNativeBillRow({ [field]: 'private-token-do-not-print' })]));
      expect(() => assess(alibabaObservation(raw))).toThrow(expect.objectContaining(invalid));
    },
  );

  it.each(['2026-02-30 10:00:00', '2026-01-15 25:00:00', '2026-01-15T10:00:00Z'])(
    'rejects invalid or unreviewed native date %s', (UsageStartTime) => {
      expect(() => assess(alibabaObservation(JSON.stringify(alibabaNativeBillBody([
        alibabaNativeBillRow({ UsageStartTime }),
      ]))))).toThrow(expect.objectContaining(invalid));
    },
  );

  it('detects duplicate escaped monetary keys and duplicate account identifiers', () => {
    const original = JSON.stringify(alibabaNativeBillBody());
    const cases = [
      original.replace('"PretaxAmount":0.14', '"PretaxAmount":1,"\\u0050retaxAmount":0.14'),
      original.replace(`"AccountID":"${alibabaQueryAccountId}"`, `"AccountID":"999","AccountID":"${alibabaQueryAccountId}"`),
    ];
    for (const body of cases) expect(() => assess(alibabaObservation(body))).toThrow(expect.objectContaining(invalid));
  });

  it('rejects invalid Unicode identifiers instead of hashing replacement characters', () => {
    const malformedId = alibabaObservation(JSON.stringify(alibabaNativeBillBody([
      alibabaNativeBillRow({ RecordID: 'bill-\ud800' }),
    ])));
    const malformedCollector = alibabaObservation();
    malformedCollector.collectorRef = 'reviewer-\ud800';
    for (const value of [malformedId, malformedCollector]) {
      expect(() => assess(value)).toThrow(expect.objectContaining(invalid));
    }
  });

  it.each([
    { Currency: 'USD' }, { Item: 'Refund' }, { SubscriptionType: 'Subscription' },
    { ProductCode: 'another-product' }, { Status: 'UNREVIEWED' }, { ProviderTaskId: 'forged-link' },
  ])('rejects native row drift %j', (overrides) => {
    expect(() => assess(alibabaObservation(JSON.stringify(alibabaNativeBillBody([
      alibabaNativeBillRow(overrides),
    ]))))).toThrow(expect.objectContaining(invalid));
  });

  it.each([
    ['action', 'DescribeInstanceBill'], ['version', '2026-01-01'], ['hideZeroCharge', true],
    ['billingCycle', '2026-13'], ['productType', 'wrong-product-type'], ['billOwnerId', '999999999'],
    ['pageNumber', 2], ['pageSize', 301], ['pageSize', 10],
  ])('rejects query scope drift %s', (key, value) => {
    const observation = alibabaObservation();
    (observation.request as Record<string, unknown>)[key] = value;
    expect(() => assess(observation)).toThrow(expect.objectContaining(invalid));
  });

  it('does not accept a resource owner ID in place of the queried account', () => {
    expect(() => assessAiImageAlibabaBillingObservation({
      observation: alibabaObservation(), observationSha256: 'a'.repeat(64),
      expectedAccountUidSha256: billingDigest(alibabaBillOwnerId), now: alibabaObservationNow,
    })).toThrow(expect.objectContaining({ code: 'ALIBABA_BILLING_ACCOUNT_MISMATCH' }));
  });

  it('rejects truncated page data and forged response status', () => {
    const truncated = alibabaNativeBillBody();
    truncated.Data.TotalCount = 2;
    const failure = alibabaNativeBillBody();
    failure.Success = false;
    for (const body of [truncated, failure]) expect(() => assess(alibabaObservation(JSON.stringify(body)))).toThrow(expect.objectContaining(invalid));
  });

  it('checks body digest, base64, UTF-8 and maximum response size', () => {
    const mismatched = alibabaObservation();
    mismatched.response.bodySha256 = 'a'.repeat(64);
    const noncanonical = alibabaObservation();
    noncanonical.response.bodyBase64 += '\n';
    const utf8 = Buffer.from([0xc3, 0x28]);
    const invalidUtf8 = alibabaObservation();
    invalidUtf8.response.bodyBase64 = utf8.toString('base64');
    invalidUtf8.response.bodySha256 = billingDigest(utf8);
    const oversized = alibabaObservation(' '.repeat(4 * 1024 * 1024 + 1));
    for (const value of [mismatched, noncanonical, invalidUtf8, oversized]) {
      expect(() => assess(value)).toThrow(expect.objectContaining(invalid));
    }
  });
});

describe('native observation private input and CLI boundaries', () => {
  it('only reads pinned private evidence, performs no network and creates no claim or receipt', async () => {
    const fixture = await evidence();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const result = await inspectAiImageAlibabaBillingObservation(fixture.input);
    expect(result).toMatchObject({ actualCost: null, canFinalize: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(fixture.input.evidenceRoot)).toEqual(['observation.json']);
    expect(await readFile(fixture.input.observationPath)).toEqual(fixture.bytes);
  });

  it('requires a caller-pinned observation digest before opening evidence', async () => {
    const fixture = await evidence();
    await expect(inspectAiImageAlibabaBillingObservation({
      ...fixture.input, observationSha256: undefined as any,
    })).rejects.toMatchObject(invalid);
  });

  it('rejects changed bytes and evidence escaping the declared private root', async () => {
    const fixture = await evidence();
    const outside = await evidence();
    await expect(inspectAiImageAlibabaBillingObservation({
      ...fixture.input, observationSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_DIGEST_MISMATCH' });
    await expect(inspectAiImageAlibabaBillingObservation({
      ...fixture.input, observationPath: outside.input.observationPath,
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });
  });

});
