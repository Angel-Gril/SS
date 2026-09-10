import { createHash } from 'node:crypto';
import { AI_IMAGE_SANDBOX_MONEY_MAX_SCALE, parseAiImageSandboxMoney, type AiImageSandboxMoney } from './ai-image-sandbox-money.js';
import { readAiImageSandboxPrivateBillingEvidence } from './ai-image-sandbox-billing-settlement.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const ACCOUNT_ID = /^[0-9]{1,32}$/u;
const PRODUCT_CODE = /^[a-z0-9][a-z0-9._-]{0,79}$/u;
const AMOUNT_FIELDS = [
  ['PretaxGrossAmount', 'pretaxGrossAmount'], ['InvoiceDiscount', 'invoiceDiscount'],
  ['PretaxAmount', 'pretaxAmount'], ['PaymentAmount', 'paymentAmount'], ['CashAmount', 'cashAmount'],
  ['AdjustAmount', 'adjustAmount'], ['OutstandingAmount', 'outstandingAmount'],
  ['DeductedByCashCoupons', 'deductedByCashCoupons'], ['DeductedByCoupons', 'deductedByCoupons'],
  ['DeductedByPrepaidCard', 'deductedByPrepaidCard'], ['RoundDownDiscount', 'roundDownDiscount'],
] as const;
const REQUIRED_ROW_KEYS = [
  'RecordID', 'Status', 'Item', 'Currency', 'ProductCode', 'SubscriptionType',
  'PretaxAmount', 'PaymentAmount', 'CashAmount',
];
const OPTIONAL_ROW_KEYS = [
  'OwnerID', 'SubOrderId', 'UsageStartTime', 'UsageEndTime', 'PaymentTime',
  'ProductType', 'PipCode', 'CommodityCode', 'ProductName', 'ProductDetail',
  ...AMOUNT_FIELDS.map(([key]) => key).filter((key) => !REQUIRED_ROW_KEYS.includes(key)),
];

export class AiImageAlibabaBillingObservationError extends Error {
  constructor(public readonly code: 'ALIBABA_BILLING_OBSERVATION_INVALID' | 'ALIBABA_BILLING_ACCOUNT_MISMATCH') {
    super(code === 'ALIBABA_BILLING_ACCOUNT_MISMATCH'
      ? 'The native bill query account does not match the reviewed account digest'
      : 'The native billing observation is invalid or outside the reviewed contract');
    this.name = 'AiImageAlibabaBillingObservationError';
  }
}

function invalid(): never {
  throw new AiImageAlibabaBillingObservationError('ALIBABA_BILLING_OBSERVATION_INVALID');
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);

function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(result, key))
    || Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return result;
}

function text(value: unknown, maximum = 160, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || value !== value.trim()
    || (!allowEmpty && !value)
    || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || Buffer.from(value, 'utf8').toString('utf8') !== value) invalid();
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function timestamp(value: unknown): string {
  const result = text(value, 30);
  const time = new Date(result);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== result) invalid();
  return result;
}

class NativeNumber {
  constructor(readonly source: string) {}
}

// JSON.parse owns syntax. This linear pass only checks duplicate decoded keys and
// depth. In particular, an unterminated escaped string must never trigger regex rescans.
function parseNativeJson(source: string): unknown {
  try {
    const stack: Array<Set<string> | null> = [];
    let cursor = 0;
    while (cursor < source.length) {
      const token = source[cursor];
      if (token === '"') {
        const start = cursor++;
        let closed = false;
        while (cursor < source.length) {
          if (source[cursor] === '\\') { cursor += 2; continue; }
          if (source[cursor++] === '"') { closed = true; break; }
        }
        if (!closed) invalid();
        let next = cursor;
        while (/[\x20\t\r\n]/u.test(source[next] || 'x')) next++;
        if (source[next] === ':') {
          if (cursor - start > 256) invalid();
          const keys = stack.at(-1);
          const key = JSON.parse(source.slice(start, cursor)) as string;
          if (!keys || keys.has(key)) invalid();
          keys.add(key);
        }
        continue;
      }
      if (token === '{' || token === '[') {
        stack.push(token === '{' ? new Set<string>() : null);
        if (stack.length > 12) invalid();
      } else if (token === '}' || token === ']') {
        if (!stack.length) invalid();
        const container = stack.pop();
        if ((token === ']') !== (container === null)) invalid();
      }
      cursor++;
    }
    if (stack.length) invalid();
    return JSON.parse(source, (_key: string, value: unknown, context?: { source?: string }) => {
      if (typeof value !== 'number') return value;
      if (typeof context?.source !== 'string') invalid();
      return new NativeNumber(context.source);
    }) as unknown;
  } catch {
    invalid();
  }
}

function nativeInteger(value: unknown, minimum: number, maximum: number): number {
  if (!(value instanceof NativeNumber) || !/^(?:0|[1-9][0-9]{0,9})$/u.test(value.source)) invalid();
  return integer(Number(value.source), minimum, maximum);
}

function nativeMoney(value: unknown, stringAllowed = false): AiImageSandboxMoney {
  const source = value instanceof NativeNumber ? value.source
    : stringAllowed && typeof value === 'string' ? value : '';
  if (!source || source.length > 64) invalid();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]{1,3}))?$/u.exec(source);
  if (!match) invalid();
  const exponent = Number(match[3] || 0);
  if (Math.abs(exponent) > 100) invalid();
  let amount = BigInt(match[1] + (match[2] || ''));
  let scale = (match[2]?.length || 0) - exponent;
  if (amount === 0n) return { currency: 'CNY', amount: 0, scale: 0 };
  if (scale < 0) {
    if (scale < -15) invalid();
    amount *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && amount % 10n === 0n) { amount /= 10n; scale--; }
  if (scale > AI_IMAGE_SANDBOX_MONEY_MAX_SCALE || amount > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return parseAiImageSandboxMoney({ currency: 'CNY', amount: Number(amount), scale }, 'Native bill amount', { allowZero: true });
}

function accountId(value: unknown): string {
  const result = text(value, 32);
  if (!ACCOUNT_ID.test(result)) invalid();
  return result;
}

function optionalString(row: Record<string, unknown>, key: string, maximum = 512) {
  return row[key] === undefined ? null : text(row[key], maximum, true);
}

function optionalBillTime(row: Record<string, unknown>, key: string) {
  const value = optionalString(row, key, 19);
  if (!value) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u.test(value)) invalid();
  // Calendar validation only: keep the Provider's local text, without asserting a timezone.
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19).replace('T', ' ') !== value) invalid();
  return value;
}

export function assessAiImageAlibabaBillingObservation(input: {
  observation: unknown;
  observationSha256: string;
  expectedAccountUidSha256: string;
  now?: Date;
}) {
  if (!isSha256(input.observationSha256) || !isSha256(input.expectedAccountUidSha256)) invalid();
  const now = input.now || new Date();
  if (!Number.isFinite(now.getTime())) invalid();
  const observation = record(input.observation, ['schemaVersion', 'kind', 'observedAt', 'collectorRef', 'request', 'response']);
  if (observation.schemaVersion !== 1 || observation.kind !== 'ALIBABA_NATIVE_BILLING_OBSERVATION_V1') invalid();
  const observedAt = timestamp(observation.observedAt);
  if (Date.parse(observedAt) > now.getTime() + 5 * 60 * 1000) invalid();
  const collectorRefSha256 = digest(text(observation.collectorRef, 128));
  const query = record(observation.request, [
    'action', 'version', 'billingCycle', 'productCode', 'productType', 'subscriptionType',
    'billType', 'hideZeroCharge', 'pageNumber', 'pageSize', 'billOwnerId',
  ]);
  if (query.action !== 'QueryBill' || query.version !== '2017-12-14'
    || query.subscriptionType !== 'PayAsYouGo' || query.billType !== 'PayAsYouGoBill'
    || query.hideZeroCharge !== false) invalid();
  const billingCycle = text(query.billingCycle, 7);
  const productCode = text(query.productCode, 80);
  const productType = query.productType === null ? null : text(query.productType, 80);
  if (!/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(billingCycle) || !PRODUCT_CODE.test(productCode)
    || (productType !== null && !PRODUCT_CODE.test(productType))) invalid();
  const billOwnerId = query.billOwnerId === null ? null : accountId(query.billOwnerId);
  const pageNumber = integer(query.pageNumber, 1, 1_000_000_000);
  const pageSize = integer(query.pageSize, 1, 300);
  const response = record(observation.response, ['httpStatus', 'contentType', 'bodySha256', 'bodyBase64']);
  if (response.httpStatus !== 200 || !/^application\/json(?:\s*;.*)?$/iu.test(text(response.contentType, 160))
    || typeof response.bodySha256 !== 'string' || !SHA256.test(response.bodySha256)
    || typeof response.bodyBase64 !== 'string' || response.bodyBase64.length > Math.ceil(MAX_BODY_BYTES / 3) * 4) invalid();
  const bytes = Buffer.from(response.bodyBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_BODY_BYTES || bytes.toString('base64') !== response.bodyBase64
    || digest(bytes) !== response.bodySha256) invalid();
  let bodyText: string;
  try { bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { invalid(); }
  if (!Buffer.from(bodyText, 'utf8').equals(bytes)) invalid();
  const body = record(parseNativeJson(bodyText), ['Code', 'Message', 'RequestId', 'Success', 'Data']);
  if (body.Code !== 'Success' || body.Success !== true) invalid();
  text(body.Message, 4_096, true);
  const queryRequestIdSha256 = digest(text(body.RequestId, 128));
  const data = record(body.Data, ['PageNum', 'BillingCycle', 'AccountID', 'PageSize', 'TotalCount', 'Items'], ['AccountName']);
  const queryAccountUidSha256 = digest(accountId(data.AccountID));
  if (queryAccountUidSha256 !== input.expectedAccountUidSha256) {
    throw new AiImageAlibabaBillingObservationError('ALIBABA_BILLING_ACCOUNT_MISMATCH');
  }
  optionalString(data, 'AccountName');
  if (data.BillingCycle !== billingCycle || nativeInteger(data.PageNum, 1, 1_000_000_000) !== pageNumber
    || nativeInteger(data.PageSize, 1, 300) !== pageSize) invalid();
  const totalCount = nativeInteger(data.TotalCount, 0, 1_000_000_000);
  const items = record(data.Items, ['Item']).Item;
  const start = (pageNumber - 1) * pageSize;
  if (!Array.isArray(items) || items.length > pageSize
    || (totalCount === 0 ? pageNumber !== 1 : start >= totalCount)
    || items.length !== Math.min(pageSize, Math.max(0, totalCount - start))) invalid();
  const records = items.map((item) => {
    const row = record(item, REQUIRED_ROW_KEYS, OPTIONAL_ROW_KEYS);
    if (row.Currency !== 'CNY' || row.ProductCode !== productCode || row.Item !== 'PayAsYouGoBill'
      || row.SubscriptionType !== 'PayAsYouGo'
      || (productType !== null && row.ProductType !== productType)) invalid();
    const paymentStatus = text(row.Status, 24);
    if (!['PayFinish', 'PayUnclear', 'PayUnsettle', 'NoSettle'].includes(paymentStatus)) invalid();
    const recordId = text(row.RecordID, 128);
    const owner = optionalString(row, 'OwnerID', 32);
    if (owner && !ACCOUNT_ID.test(owner)) invalid();
    if (billOwnerId !== null && owner !== billOwnerId) invalid();
    for (const key of ['ProductType', 'PipCode', 'CommodityCode', 'ProductName', 'ProductDetail', 'SubOrderId']) optionalString(row, key);
    const amounts: Record<string, AiImageSandboxMoney | null> = {};
    for (const [field, name] of AMOUNT_FIELDS) {
      amounts[name] = row[field] === undefined ? null : nativeMoney(row[field], field === 'RoundDownDiscount');
    }
    optionalBillTime(row, 'PaymentTime');
    return {
      billingRecordIdSha256: digest(recordId), resourceOwnerUidSha256: owner ? digest(owner) : null,
      paymentStatus, amounts,
      usageStartTime: optionalBillTime(row, 'UsageStartTime'),
      usageEndTime: optionalBillTime(row, 'UsageEndTime'),
    };
  });
  const complete = pageNumber === 1 && items.length === totalCount;
  return {
    schemaVersion: 1 as const, kind: 'ALIBABA_NATIVE_BILLING_ASSESSMENT_V1' as const,
    state: 'RECONCILIATION_REQUIRED' as const, actualCost: null, canFinalize: false as const,
    source: { action: 'QueryBill' as const, version: '2017-12-14', observedAt,
      observationSha256: input.observationSha256, bodySha256: response.bodySha256,
      queryRequestIdSha256, collectorRefSha256, authenticity: 'COLLECTOR_REVIEW_REQUIRED' as const },
    account: { queryAccountUidSha256, relationshipToProviderKey: 'NOT_PROVEN_BY_QUERY_BILL' as const },
    query: { billingCycle, productCodeSha256: digest(productCode), productTypeSha256: productType ? digest(productType) : null,
      billOwnerUidSha256: billOwnerId ? digest(billOwnerId) : null, hideZeroCharge: false },
    pagination: { pageNumber, pageSize, totalCount, returnedCount: items.length, complete },
    records,
    reasons: [
      'PROVIDER_TASK_BILL_LINK_MISSING', 'BILLING_PERIOD_FINALITY_UNVERIFIED',
      ...(!items.length ? ['NO_BILL_RECORD_IS_NOT_NO_CHARGE'] : []),
      ...(!complete ? ['QUERY_PAGINATION_INCOMPLETE'] : []),
      ...(records.some((item) => ['PayUnclear', 'PayUnsettle'].includes(item.paymentStatus)) ? ['BILL_PAYMENT_UNRESOLVED'] : []),
    ],
  };
}

export async function inspectAiImageAlibabaBillingObservation(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  observationPath: string;
  observationSha256: string;
  expectedAccountUidSha256: string;
  now?: Date;
}) {
  if (!isSha256(input.expectedAccountUidSha256) || !isSha256(input.observationSha256)) invalid();
  const evidence = await readAiImageSandboxPrivateBillingEvidence({
    repositoryRoot: input.repositoryRoot, evidenceRoot: input.evidenceRoot,
    path: input.observationPath, sha256: input.observationSha256,
  });
  return assessAiImageAlibabaBillingObservation({
    observation: evidence.record, observationSha256: evidence.sha256,
    expectedAccountUidSha256: input.expectedAccountUidSha256, now: input.now,
  });
}
