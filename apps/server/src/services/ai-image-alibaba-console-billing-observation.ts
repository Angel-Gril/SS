import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  AiImageAlibabaNativeNumber, parseAiImageAlibabaNativeJson, parseAiImageAlibabaNativeMoney,
} from './ai-image-alibaba-native-json.js';
import { readAiImageSandboxPrivateBillingEvidence } from './ai-image-sandbox-billing-settlement.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const MONTH = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/u;
const CREDENTIAL_KEYS = new Set([
  'authorization', 'cookie', 'setcookie', 'apikey', 'xapikey', 'apikeysecret',
  'accesskey', 'accesskeyid', 'accesskeysecret', 'secretaccesskey', 'securitytoken',
  'sessiontoken', 'accesstoken', 'refreshtoken', 'token', 'password', 'clientsecret', 'privatekey',
]);
const AMOUNTS = [
  ['ListPrice', 'listPrice'], ['ListUnitPrice', 'listUnitPrice'], ['PromotionAmount', 'promotionAmount'],
  ['AmountAfterPromotionDeduction', 'amountAfterPromotionDeduction'], ['RequireAmount', 'requireAmount'],
  ['CouponAmount', 'couponAmount'], ['AmountAfterCouponDeduction', 'amountAfterCouponDeduction'],
] as const;
const ROW_REQUIRED = [
  'BillId', 'BillDetailId', 'HashKey', 'InstanceId', 'ResourcePurchaseAccountId', 'ResourceOwnerAccountId',
  'ProductCode', 'CommodityCode', 'BillingItemCode', 'RegionCode', 'Currency', 'ConsumeType', 'LineItemType',
  'BillingMonth', 'BillingDate', 'ConsumedTime', 'ConsumedTimeStart', 'ConsumedTimeEnd',
  'BillingQuantityUnit', 'ListPriceUnit', 'QuantityBeforeDeduction', 'ResourcePlanDeductQuantity',
  'BillingQuantity', 'AssistExtend', ...AMOUNTS.map(([key]) => key),
];
const ROW_OPTIONAL = [
  'ProductName', 'PricingRule', 'ResourcePlanDeductChargeTime', 'BillingItemName', 'RegionName',
  'ServiceEntity', 'BillingFormula', 'ResourcePurchaseAccountName', 'ResourceOwnerAccountName',
  'ChargeDurationBeforeDeduction', 'ResourcePlanDeductDetails', 'BillingProcess', 'CustomerId',
  'PreviousOrderId', 'ResourcePlanPurchaseDetails', 'ConsumedQuantityConvertInfo', 'CommodityName',
];

export class AiImageAlibabaConsoleBillingObservationError extends Error {
  constructor(public readonly code: 'ALIBABA_CONSOLE_BILLING_OBSERVATION_INVALID' | 'ALIBABA_CONSOLE_BILLING_ACCOUNT_MISMATCH') {
    super(code === 'ALIBABA_CONSOLE_BILLING_ACCOUNT_MISMATCH'
      ? 'The resource purchase or owner account does not match the reviewed account digest'
      : 'The console billing observation is invalid or outside the reviewed contract');
    this.name = 'AiImageAlibabaConsoleBillingObservationError';
  }
}

function invalid(): never {
  throw new AiImageAlibabaConsoleBillingObservationError('ALIBABA_CONSOLE_BILLING_OBSERVATION_INVALID');
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof AiImageAlibabaNativeNumber) invalid();
  return value as Record<string, unknown>;
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  const result = object(value);
  if (required.some((key) => !Object.hasOwn(result, key))
    || Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) invalid();
  return result;
}
function text(value: unknown, maximum = 160, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || value !== value.trim() || (!allowEmpty && !value)
    || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || Buffer.from(value, 'utf8').toString('utf8') !== value) invalid();
  return value;
}
function integer(value: unknown, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}
function nativeInteger(value: unknown, minimum: number, maximum: number) {
  if (!(value instanceof AiImageAlibabaNativeNumber) || !/^(?:0|[1-9][0-9]{0,9})$/u.test(value.source)) invalid();
  return integer(Number(value.source), minimum, maximum);
}
function timestamp(value: unknown) {
  const result = text(value, 30);
  const date = new Date(result);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) invalid();
  return result;
}
function nativeDate(value: unknown, withTime = false) {
  const result = text(value, withTime ? 19 : 10);
  if (!(withTime ? /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u : /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u).test(result)) invalid();
  const parsed = new Date(withTime ? `${result.replace(' ', 'T')}Z` : `${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, withTime ? 19 : 10).replace('T', ' ') !== result) invalid();
  // Z only validates the calendar. Return native text without asserting its timezone.
  return result;
}
function quantity(value: unknown) {
  const exact = parseAiImageAlibabaNativeMoney(value, invalid, true);
  if (exact.scale !== 0 || exact.amount > 1_000_000_000) invalid();
  return exact.amount;
}
function checkedNativeJson(source: string) {
  const parsed = parseAiImageAlibabaNativeJson(source, invalid);
  // The byte/length bounds and parser's 12-container limit bound this linear walk.
  // API key IDs and pagination tokens remain metadata; only known credential keys are refused.
  const check = (value: unknown, depth: number): void => {
    if (depth > 12) invalid();
    if (!value || typeof value !== 'object' || value instanceof AiImageAlibabaNativeNumber) return;
    if (Array.isArray(value)) {
      for (const item of value) check(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_KEYS.has(key.replace(/[-_]/gu, '').toLowerCase())) invalid();
      check(child, depth + 1);
    }
  };
  check(parsed, 0);
  return parsed;
}
function embeddedJson(value: unknown) {
  if (typeof value !== 'string' || !value.length || value.length > 64 * 1024
    || Buffer.from(value, 'utf8').toString('utf8') !== value) invalid();
  return checkedNativeJson(value);
}

function queryScope(value: unknown) {
  const request = record(value, ['path', 'method', 'product', 'action', 'params']);
  if (request.path !== '/data/api.json' || request.method !== 'POST'
    || request.product !== 'BssOpenAPI-V3' || request.action !== 'ListConsumeDetails') invalid();
  const mode = object(request.params).QueryMode;
  if (mode !== 'COUNT_ONLY' && mode !== 'DATA_ONLY') invalid();
  const scope = record(request.params,
    ['Nbid', 'BillingCycle', 'BillingMonth', 'TableType', 'Granularity', 'JumpPageSize', 'QueryMode',
      ...(mode === 'DATA_ONLY' ? ['MaxResults', 'current', 'currentPage', 'primaryKeys', 'Console'] : [])]);
  const nbid = record(scope.Nbid, ['sha256']);
  if (!isSha256(nbid.sha256) || scope.TableType !== 'consumeDetailBillV2' || scope.Granularity !== 'HOURLY'
    || typeof scope.BillingCycle !== 'string' || !MONTH.test(scope.BillingCycle)
    || scope.BillingMonth !== scope.BillingCycle) invalid();
  const jumpPageSize = integer(scope.JumpPageSize, 1, 300);
  let maxResults: number | null = null;
  if (mode === 'DATA_ONLY') {
    // Admit the observed first-page request; do not guess the semantics of later-page keys.
    if (scope.current !== 1 || scope.currentPage !== 1 || scope.Console !== true
      || !Array.isArray(scope.primaryKeys) || scope.primaryKeys.length !== 0) invalid();
    maxResults = integer(scope.MaxResults, 1, 300);
  }
  return { mode, maxResults, common: {
    billingCycle: scope.BillingCycle, billingMonth: scope.BillingMonth as string,
    nbidSha256: nbid.sha256, jumpPageSize,
  } };
}

function readResponse(value: unknown) {
  const response = record(value, ['httpStatus', 'contentType', 'bodySha256', 'bodyBase64']);
  if (response.httpStatus !== 200 || !/^application\/json(?:\s*;.*)?$/iu.test(text(response.contentType, 160))
    || !isSha256(response.bodySha256) || typeof response.bodyBase64 !== 'string'
    || response.bodyBase64.length > Math.ceil(MAX_BODY_BYTES / 3) * 4) invalid();
  const bytes = Buffer.from(response.bodyBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_BODY_BYTES || bytes.toString('base64') !== response.bodyBase64
    || digest(bytes) !== response.bodySha256) invalid();
  let bodyText: string;
  try { bodyText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { invalid(); }
  if (!Buffer.from(bodyText, 'utf8').equals(bytes)) invalid();
  const body = record(checkedNativeJson(bodyText), ['code', 'httpStatusCode', 'successResponse', 'requestId', 'data']);
  if (body.code !== '200' || body.httpStatusCode !== '200' || body.successResponse !== true) invalid();
  return { body, bodySha256: response.bodySha256, bodyBytes: bytes.byteLength,
    requestIdSha256: digest(text(body.requestId, 128)) };
}

function billingRow(value: unknown, billingMonth: string, expectedAccountUidSha256: string) {
  const row = record(value, ROW_REQUIRED, ROW_OPTIONAL);
  if (row.Currency !== 'CNY' || row.ProductCode !== 'sfm' || row.BillingItemCode !== 'image_number'
    || row.BillingQuantityUnit !== '张' || row.ListPriceUnit !== '元/张' || row.ConsumeType !== '后付费'
    || row.BillingMonth !== billingMonth) invalid();
  const purchase = text(row.ResourcePurchaseAccountId, 32);
  const owner = text(row.ResourceOwnerAccountId, 32);
  if (!/^[0-9]{1,32}$/u.test(purchase) || !/^[0-9]{1,32}$/u.test(owner)) invalid();
  if (digest(purchase) !== expectedAccountUidSha256 || digest(owner) !== expectedAccountUidSha256) {
    throw new AiImageAlibabaConsoleBillingObservationError('ALIBABA_CONSOLE_BILLING_ACCOUNT_MISMATCH');
  }
  const dates = { billingMonth, billingDate: nativeDate(row.BillingDate), consumedTime: nativeDate(row.ConsumedTime, true),
    consumedTimeStart: nativeDate(row.ConsumedTimeStart, true), consumedTimeEnd: nativeDate(row.ConsumedTimeEnd, true) };
  if (!dates.billingDate.startsWith(`${billingMonth}-`) || dates.consumedTimeStart > dates.consumedTime
    || dates.consumedTime > dates.consumedTimeEnd) invalid();
  const assist = object(embeddedJson(row.AssistExtend));
  const project = record(assist.maasProject, ['apiKeyId', 'workSpaceId', 'modelName'], ['maasType']);
  if (assist.settleCurrency !== undefined && assist.settleCurrency !== 'CNY') invalid();
  if (project.maasType !== undefined) text(project.maasType, 128);
  for (const key of ROW_OPTIONAL) {
    if (row[key] === undefined) continue;
    const native = row[key];
    if (['ResourcePlanDeductDetails', 'ResourcePlanPurchaseDetails', 'ConsumedQuantityConvertInfo'].includes(key)
      && native !== '' && native !== '-') {
      // Display details are parsed safely but never become alternative amount/account authorities.
      const detail = embeddedJson(native);
      if (!detail || typeof detail !== 'object' || detail instanceof AiImageAlibabaNativeNumber) invalid();
    } else text(native, 64 * 1024, true);
  }
  const amounts = Object.fromEntries(AMOUNTS.map(([field, name]) => [name, parseAiImageAlibabaNativeMoney(row[field], invalid, true)]));
  return {
    billingIdSha256: digest(text(row.BillId, 160)), billingRecordIdSha256: digest(text(row.BillDetailId, 160)),
    hashKeySha256: digest(text(row.HashKey, 512)), instanceIdSha256: digest(text(row.InstanceId, 512)),
    resourcePurchaseAccountUidSha256: digest(purchase), resourceOwnerUidSha256: digest(owner),
    apiKeyIdSha256: digest(text(project.apiKeyId, 128)), workspaceIdSha256: digest(text(project.workSpaceId, 128)),
    modelSha256: digest(text(project.modelName, 160)), regionSha256: digest(text(row.RegionCode, 80)),
    productCodeSha256: digest(row.ProductCode), commodityCodeSha256: digest(text(row.CommodityCode, 160)),
    billingItemCodeSha256: digest(row.BillingItemCode), lineItemTypeSha256: digest(text(row.LineItemType, 80)),
    freeQuotaLabel: row.LineItemType === '免费额度', dates,
    imageQuantity: { unit: '张' as const, beforeDeduction: quantity(row.QuantityBeforeDeduction),
      resourcePlanDeducted: quantity(row.ResourcePlanDeductQuantity), billed: quantity(row.BillingQuantity) },
    amounts, cashPaidAmount: null,
  };
}

export function assessAiImageAlibabaConsoleBillingObservation(input: {
  observation: unknown;
  observationSha256: string;
  expectedAccountUidSha256: string;
  now?: Date;
}) {
  if (!isSha256(input.observationSha256) || !isSha256(input.expectedAccountUidSha256)) invalid();
  const now = input.now || new Date();
  if (!Number.isFinite(now.getTime())) invalid();
  const observation = record(input.observation, ['schemaVersion', 'kind', 'observedAt', 'collectorRef', 'captures']);
  if (observation.schemaVersion !== 1 || observation.kind !== 'ALIBABA_CONSOLE_BILLING_OBSERVATION_V1') invalid();
  const observedAt = timestamp(observation.observedAt);
  if (Date.parse(observedAt) > now.getTime() + 5 * 60_000) invalid();
  const collectorRefSha256 = digest(text(observation.collectorRef, 128));
  if (!Array.isArray(observation.captures) || observation.captures.length !== 2) invalid();
  const captures = observation.captures.map((value) => {
    const capture = record(value, ['capturedAt', 'request', 'response']);
    const capturedAt = timestamp(capture.capturedAt);
    if (Date.parse(capturedAt) > Date.parse(observedAt)) invalid();
    return { ...queryScope(capture.request), ...readResponse(capture.response), capturedAt };
  });
  const count = captures.find((item) => item.mode === 'COUNT_ONLY');
  const data = captures.find((item) => item.mode === 'DATA_ONLY');
  if (!count || !data || !isDeepStrictEqual(count.common, data.common)) invalid();
  const counted = record(count.body.data, ['TotalCount', 'MaxResults', 'Data'], ['Metadata']);
  const returned = record(data.body.data, ['MaxResults', 'NextBatchToken', 'Data'], ['Metadata', 'PrimaryKeys']);
  if (counted.Metadata !== undefined) object(counted.Metadata);
  if (returned.Metadata !== undefined) object(returned.Metadata);
  const totalCount = nativeInteger(counted.TotalCount, 0, 1_000_000_000);
  const maxResults = nativeInteger(returned.MaxResults, 1, 300);
  if (nativeInteger(counted.MaxResults, 1, 300) !== maxResults || data.maxResults !== maxResults
    || !Array.isArray(counted.Data) || counted.Data.length !== 0 || !Array.isArray(returned.Data)
    || returned.Data.length !== Math.min(totalCount, maxResults)) invalid();
  const nextBatchToken = text(returned.NextBatchToken, 4_096, true);
  const complete = returned.Data.length === totalCount;
  if (complete !== (nextBatchToken === '')) invalid();
  const primaryKeys = returned.PrimaryKeys ?? [];
  if (!Array.isArray(primaryKeys) || primaryKeys.length !== returned.Data.length) invalid();
  const primaryKeySha256 = primaryKeys.map((value) => digest(text(value, 4_096)));
  if (new Set(primaryKeySha256).size !== primaryKeySha256.length) invalid();
  const records = returned.Data.map((value) => billingRow(value, data.common.billingMonth, input.expectedAccountUidSha256));
  if (new Set(records.map((item) => item.billingRecordIdSha256)).size !== records.length
    || new Set(records.map((item) => item.hashKeySha256)).size !== records.length) invalid();
  return {
    schemaVersion: 1 as const, kind: 'ALIBABA_CONSOLE_BILLING_ASSESSMENT_V1' as const,
    state: 'RECONCILIATION_REQUIRED' as const, actualCost: null, canFinalize: false as const,
    source: { observedAt, observationSha256: input.observationSha256, collectorRefSha256,
      authenticity: 'COLLECTOR_REVIEW_REQUIRED' as const,
      captures: captures.map((item) => ({ queryMode: item.mode, capturedAt: item.capturedAt,
        bodySha256: item.bodySha256, bodyBytes: item.bodyBytes, queryRequestIdSha256: item.requestIdSha256 })) },
    account: { expectedAccountUidSha256: input.expectedAccountUidSha256, resourceAccountsMatched: records.length > 0,
      queryAccountIdentity: 'NOT_PROVEN_BY_NBID' as const, relationshipToProviderTask: 'NOT_PROVEN_BY_ROW_METADATA' as const },
    query: { product: 'BssOpenAPI-V3' as const, action: 'ListConsumeDetails' as const,
      tableType: 'consumeDetailBillV2' as const, granularity: 'HOURLY' as const, ...data.common },
    pagination: { pageNumber: 1, maxResults, totalCount, returnedCount: records.length, complete,
      nextBatchTokenSha256: nextBatchToken ? digest(nextBatchToken) : null, primaryKeySha256 },
    records,
    reasons: ['PROVIDER_TASK_BILL_LINK_MISSING', 'BILLING_PERIOD_FINALITY_UNVERIFIED',
      'CASH_PAYMENT_EVIDENCE_NOT_PRESENT', 'COUNT_DATA_NOT_ATOMIC_SNAPSHOT',
      ...(!records.length ? ['NO_BILL_RECORD_IS_NOT_NO_CHARGE', 'RESOURCE_ACCOUNT_ROWS_MISSING'] : []),
      ...(!complete ? ['QUERY_PAGINATION_INCOMPLETE'] : []),
      ...(records.some((item) => item.freeQuotaLabel) ? ['FREE_QUOTA_IS_NOT_CASH_PAYMENT_EVIDENCE'] : [])],
  };
}

export type AiImageAlibabaConsoleBillingAssessment = ReturnType<typeof assessAiImageAlibabaConsoleBillingObservation>;

export async function inspectAiImageAlibabaConsoleBillingObservation(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  observationPath: string;
  observationSha256: string;
  expectedAccountUidSha256: string;
  now?: Date;
}) {
  if (!isSha256(input.observationSha256) || !isSha256(input.expectedAccountUidSha256)) invalid();
  const evidence = await readAiImageSandboxPrivateBillingEvidence({ repositoryRoot: input.repositoryRoot,
    evidenceRoot: input.evidenceRoot, path: input.observationPath, sha256: input.observationSha256 });
  return assessAiImageAlibabaConsoleBillingObservation({ observation: evidence.record,
    observationSha256: evidence.sha256, expectedAccountUidSha256: input.expectedAccountUidSha256, now: input.now });
}
