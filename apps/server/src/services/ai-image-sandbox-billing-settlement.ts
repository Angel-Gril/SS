import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN } from './ai-image-sandbox-code-revision.js';
import { createAiImageSandboxRequestFingerprint } from './ai-image-sandbox-guard.js';
import {
  AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
  aiImageEditMultipartDialectForRequestProfile,
  aiImageEditMultipartFields,
} from './ai-image-packy-edit-profile.js';
import {
  AI_IMAGE_SANDBOX_MONEY_MAX_SCALE,
  AiImageSandboxMoneyError,
  type AiImageSandboxMoney,
  aiImageSandboxPowerOfTen,
  aiImageSandboxMoneyEquals,
  aiImageSandboxDecimalsEqual,
  compareAiImageSandboxDecimals,
  assertAiImageSandboxMoneyPair,
  parseAiImageSandboxDecimal,
  parseAiImageSandboxMoney,
} from './ai-image-sandbox-money.js';
import {
  AI_IMAGE_XIAOYI_API_BASE,
  AI_IMAGE_XIAOYI_BILLING_ORIGIN,
  AI_IMAGE_XIAOYI_EDIT_PROFILE,
  isAiImageXiaoyiEditOperation,
  isAiImageXiaoyiEditRequestProfile,
} from './ai-image-xiaoyi-provider.js';
import {
  AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE,
  AI_IMAGE_WANX21_EDIT_MODEL,
  AI_IMAGE_WANX21_EDIT_TRANSPORT,
  aiImageWanx21EditFunction,
  aiImageWanx21EditOperationForRequestProfile,
  aiImageWanx21EditSubmitEndpoint,
  isAiImageWanx21EditRequestProfile,
} from './ai-image-wanx-edit-profile.js';

export const AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT =
  'I_ATTEST_EXACT_PROVIDER_BILLING_SETTLEMENT';

const MAX_ATTESTATION_BYTES = 32 * 1024;
const MAX_INTENT_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 128 * 1024;
const MAX_CLAIM_BYTES = 16 * 1024;
const MAX_BILLING_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_PROVIDER_TOKEN_LOG_ENTRIES = 1_000;
const MAX_PROVIDER_DURATION_DIFFERENCE_MS = 10_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_CORRELATION_WINDOW_MS = 15 * 60 * 1000;
const MAX_CUMULATIVE_ZERO_SETTLEMENT_WINDOW_MS = 30 * 60 * 1000;
const MAX_PRECALL_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
const MAX_APPROVAL_WINDOW_MS = 60 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u;

const ATTESTATION_COMMON_KEYS = [
  'schemaVersion',
  'settlementId',
  'statement',
  'operationId',
  'preCallObservedAt',
  'settledObservedAt',
  'reconcilerRef',
  'providerAccountRef',
  'pricingRevision',
  'preCallBillingSnapshotRef',
  'billingReconciliationRef',
  'preCallBillingSnapshotPath',
  'settledBillingSnapshotPath',
  'preCallBillingSnapshotSha256',
  'settledBillingSnapshotSha256',
  'providerBillingEntryRef',
  'intentSha256',
  'submitReportSha256',
  'fingerprintClaimSha256',
  'requestFingerprint',
  'approvalId',
  'approvalSha256',
  'correlationMethod',
  'providerRequestId',
  'billingOutcome',
] as const;

const ATTESTATION_V1_KEYS = new Set([
  ...ATTESTATION_COMMON_KEYS,
  'currency',
  'actualCostCents',
]);

const ATTESTATION_V2_KEYS = new Set([
  ...ATTESTATION_COMMON_KEYS,
  'actualCost',
  'meterEvidence',
]);

const ATTESTATION_V3_KEYS = new Set([
  ...ATTESTATION_V2_KEYS,
  'providerTokenLogSnapshotPath',
  'providerTokenLogSnapshotSha256',
  'providerTokenLogUserId',
  'providerTokenLogTokenId',
]);

const ATTESTATION_V4_KEYS = new Set([
  ...ATTESTATION_COMMON_KEYS.filter((key) => (
    key !== 'preCallBillingSnapshotPath'
    && key !== 'preCallBillingSnapshotSha256'
  )),
  'actualCost',
  'cumulativeUsageEvidence',
]);

const ATTESTATION_V5_KEYS = new Set([
  ...ATTESTATION_COMMON_KEYS,
  'actualCost',
  'consoleBillEvidence',
  'providerTokenLogSnapshotPath',
  'providerTokenLogSnapshotSha256',
  'providerTokenLogUserId',
  'providerTokenLogTokenId',
]);

const CONSOLE_BILL_EVIDENCE_KEYS = new Set([
  'schemaVersion', 'kind', 'displayedCurrency', 'displayedCharge', 'loggedQuota',
  'cashUnitsPerDisplayedUnit', 'screenshotPath', 'screenshotSha256',
  'userConfirmationPath', 'userConfirmationSha256',
]);

const USER_BILLING_CONFIRMATION_KEYS = new Set([
  'schemaVersion', 'kind', 'statement', 'operationId', 'confirmedAt',
  'reconcilerRef', 'providerAccountRef', 'billingRequestIdSha256', 'screenshotSha256',
  'displayedCurrency', 'displayedCharge', 'cashCost', 'cashUnitsPerDisplayedUnit',
]);

const METER_EVIDENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'rawQuotaDelta',
  'quotaUnitsPerCurrencyUnit',
  'displayTotalUsageDelta',
  'displayTotalUsageUnitCurrencyScale',
]);

const CUMULATIVE_USAGE_EVIDENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'totalRequests',
  'totalActualCost',
]);

const SUB2_API_BASE = 'https://api.picpi.top/v1';
const SUB2_EDIT_ENDPOINT = `${SUB2_API_BASE}/images/edits`;
const SUB2_CUMULATIVE_USAGE_KIND = 'SUB2_API_KEY_CUMULATIVE_ZERO_USAGE_V1';

const PROVIDER_TOKEN_LOG_SNAPSHOT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'operationId',
  'observedAt',
  'request',
]);

const PROVIDER_TOKEN_LOG_REQUEST_KEYS = new Set([
  'name',
  'method',
  'uri',
  'httpStatus',
  'contentType',
  'bodySha256',
  'bodyBase64',
]);

const PROVIDER_TOKEN_LOG_BODY_KEYS = new Set(['data', 'message', 'success']);

const PROVIDER_TOKEN_LOG_ENTRY_REQUIRED_KEYS = new Set([
  'id',
  'user_id',
  'created_at',
  'type',
  'content',
  'username',
  'token_name',
  'model_name',
  'quota',
  'prompt_tokens',
  'completion_tokens',
  'use_time',
  'is_stream',
  'channel',
  'channel_name',
  'token_id',
  'group',
  'ip',
  'request_id',
  'other',
]);

const PROVIDER_TOKEN_LOG_ENTRY_ALLOWED_KEYS = new Set([
  ...PROVIDER_TOKEN_LOG_ENTRY_REQUIRED_KEYS,
  'upstream_request_id',
]);

const INTENT_COMMON_KEYS = [
  'schemaVersion',
  'operationId',
  'state',
  'endpointSha256',
  'model',
  'credentialRevision',
  'adapterRevision',
  'requestFingerprint',
  'request',
  'createdAt',
] as const;

const INTENT_V2_KEYS = new Set([
  ...INTENT_COMMON_KEYS,
  'quotedCostCents',
  'maximumCostCents',
]);

const INTENT_V3_KEYS = new Set([
  ...INTENT_COMMON_KEYS,
  'apiBaseSha256',
  'quotedCost',
  'maximumCost',
]);

const REQUEST_KEYS = new Set([
  'operation',
  'requestProfile',
  'n',
  'width',
  'height',
  'size',
  'promptSha256',
  'sourceSha256',
  'sourceDimensions',
  'maskSha256',
  'maskDimensions',
  'approvalEvidence',
]);

const APPROVAL_EVIDENCE_KEYS = new Set([
  'approvalId',
  'approvalSha256',
  'approvedAt',
  'expiresAt',
  'approverRefSha256',
  'providerAccountRefSha256',
  'pricingRevisionSha256',
  'currency',
  'preCallBillingSnapshotRefSha256',
  'billingReconciliationRefSha256',
]);

const FINGERPRINT_CLAIM_KEYS = new Set([
  'schemaVersion',
  'operationId',
  'requestFingerprint',
  'state',
  'createdAt',
]);

const SETTLEMENT_CLAIM_KEYS = new Set([
  'schemaVersion',
  'operationId',
  'settlementSha256',
  'finalizationAdapterRevision',
  'state',
]);

const PROVIDER_BILLING_ENTRY_CLAIM_KEYS = new Set([
  'schemaVersion',
  'providerBillingEntryKey',
  'providerAccountRefSha256',
  'operationId',
  'settlementSha256',
  'requestFingerprint',
  'submitReportSha256',
  'providerTokenLogSnapshotSha256',
  'state',
]);

const REPORT_COMMON_REQUIRED_KEYS = [
  'schemaVersion',
  'operationId',
  'state',
  'operation',
  'requestProfile',
  'credentialRevision',
  'adapterRevision',
  'provider',
  'model',
  'approvalEvidence',
  'promptSha256',
  'sourceSha256',
  'maskSha256',
  'requestedSize',
  'createRequests',
  'providerRequestIdHash',
  'usage',
  'startedAt',
  'completedAt',
  'elapsedMs',
] as const;

const REPORT_LEGACY_COST_KEYS = [
  'actualCostCents',
  'quotedCostCents',
  'maximumCostCents',
] as const;

const REPORT_EXACT_COST_KEYS = [
  'actualCost',
  'quotedCost',
  'maximumCost',
] as const;

const REPORT_TRAILING_REQUIRED_KEYS = [
  'intentPath',
] as const;

const REPORT_V3_REQUIRED_KEYS = [
  ...REPORT_COMMON_REQUIRED_KEYS,
  ...REPORT_LEGACY_COST_KEYS,
  ...REPORT_TRAILING_REQUIRED_KEYS,
  'endpointSha256',
];

const REPORT_V4_REQUIRED_KEYS = [
  ...REPORT_COMMON_REQUIRED_KEYS,
  ...REPORT_LEGACY_COST_KEYS,
  ...REPORT_TRAILING_REQUIRED_KEYS,
  'apiBaseSha256',
  'operationEndpointSha256',
];

const REPORT_V5_REQUIRED_KEYS = [
  ...REPORT_COMMON_REQUIRED_KEYS,
  ...REPORT_EXACT_COST_KEYS,
  ...REPORT_TRAILING_REQUIRED_KEYS,
  'apiBaseSha256',
  'operationEndpointSha256',
];

const REPORT_SUCCESS_OUTCOME_KEYS = [
  'imageCount',
  'mimeType',
  'width',
  'height',
  'bytes',
  'sha256',
  'imagePath',
];

const REPORT_FAILURE_OUTCOME_KEYS = ['failureCode'];

const SANDBOX_OPERATIONS = new Set([
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
]);

type BillingOutcome = 'CHARGED' | 'NO_CHARGE';
type CorrelationMethod =
  | 'PROVIDER_REQUEST_ID'
  | 'UNIQUE_ACCOUNT_TIME_WINDOW'
  | 'PROVIDER_TOKEN_LOG_ENTRY'
  | 'PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW'
  | 'API_KEY_CUMULATIVE_ZERO_USAGE';

interface PrivateFileEvidence {
  path: string;
  canonicalPath: string;
  bytes: Buffer;
  sha256: string;
  device: bigint;
  inode: bigint;
}

interface PrivateJsonEvidence extends PrivateFileEvidence {
  record: Record<string, unknown>;
}

export class AiImageSandboxBillingSettlementError extends Error {
  constructor(
    public readonly code:
      | 'SANDBOX_BILLING_CONFIG_INVALID'
      | 'SANDBOX_BILLING_FILE_UNSAFE'
      | 'SANDBOX_BILLING_DIGEST_MISMATCH'
      | 'SANDBOX_BILLING_ATTESTATION_INVALID'
      | 'SANDBOX_BILLING_EVIDENCE_INVALID'
      | 'SANDBOX_BILLING_MISMATCH'
      | 'SANDBOX_BILLING_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSandboxBillingSettlementError';
  }
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function hasExactKeys(record: Record<string, unknown>, keys: Set<string>) {
  const actual = Object.keys(record);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function hasRequiredAndAllowedKeys(
  record: Record<string, unknown>,
  required: Set<string>,
  allowed: Set<string>,
) {
  const actual = Object.keys(record);
  return [...required].every((key) => Object.hasOwn(record, key))
    && actual.every((key) => allowed.has(key));
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
  maxLength = 200,
) {
  const value = typeof record[key] === 'string' ? record[key].trim() : '';
  const hasControl = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!value || value.length > maxLength || hasControl) {
    throw new AiImageSandboxBillingSettlementError(code, `Sandbox billing ${key} is invalid`);
  }
  return value;
}

function canonicalTimestamp(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  const value = requiredString(record, key, code, 40);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      `Sandbox billing ${key} must be canonical ISO-8601`,
    );
  }
  return { value, time: parsed };
}

function requiredSha256(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  const value = requiredString(record, key, code, 64).toLowerCase();
  if (!SHA256_PATTERN.test(value) || value !== record[key]) {
    throw new AiImageSandboxBillingSettlementError(code, `Sandbox billing ${key} is invalid`);
  }
  return value;
}

function requiredNonnegativeInteger(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      `Sandbox billing ${key} must be a nonnegative integer`,
    );
  }
  return Number(value);
}

function requiredPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  const value = requiredNonnegativeInteger(record, key, code);
  if (value <= 0) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      `Sandbox billing ${key} must be a positive integer`,
    );
  }
  return value;
}

function exactMoney(
  value: unknown,
  field: string,
  code: AiImageSandboxBillingSettlementError['code'],
  options: { allowZero?: boolean } = {},
) {
  try {
    return parseAiImageSandboxMoney(value, field, options);
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw new AiImageSandboxBillingSettlementError(code, error.message);
    }
    throw error;
  }
}

function exactMoneyPair(
  quotedCost: AiImageSandboxMoney,
  maximumCost: AiImageSandboxMoney,
  code: AiImageSandboxBillingSettlementError['code'],
  options: { requireCanonicalSharedScale?: boolean } = {},
) {
  try {
    assertAiImageSandboxMoneyPair(quotedCost, maximumCost, options);
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw new AiImageSandboxBillingSettlementError(code, error.message);
    }
    throw error;
  }
}

function exactDecimal(
  value: unknown,
  field: string,
  code: AiImageSandboxBillingSettlementError['code'],
) {
  try {
    return parseAiImageSandboxDecimal(value, field);
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw new AiImageSandboxBillingSettlementError(code, error.message);
    }
    throw error;
  }
}

function parseMeterEvidence(value: unknown, actualCost: AiImageSandboxMoney) {
  const code = 'SANDBOX_BILLING_ATTESTATION_INVALID' as const;
  if (!isRecord(value) || !hasExactKeys(value, METER_EVIDENCE_KEYS)) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox billing meter evidence contains missing or unsupported fields',
    );
  }
  if (
    value.schemaVersion !== 1
    || value.kind !== 'NEW_API_QUOTA_AND_TOTAL_USAGE_V1'
  ) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox billing meter evidence schema is invalid',
    );
  }
  const rawQuotaDelta = requiredNonnegativeInteger(value, 'rawQuotaDelta', code);
  const quotaUnitsPerCurrencyUnit = requiredPositiveInteger(
    value,
    'quotaUnitsPerCurrencyUnit',
    code,
  );
  const displayTotalUsageDelta = exactDecimal(
    value.displayTotalUsageDelta,
    'displayTotalUsageDelta',
    code,
  );
  const displayTotalUsageUnitCurrencyScale = requiredNonnegativeInteger(
    value,
    'displayTotalUsageUnitCurrencyScale',
    code,
  );
  if (displayTotalUsageUnitCurrencyScale > AI_IMAGE_SANDBOX_MONEY_MAX_SCALE) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox billing display usage currency scale is invalid',
    );
  }

  const actualAmount = BigInt(actualCost.amount);
  const actualScaleFactor = aiImageSandboxPowerOfTen(actualCost.scale);
  const rawQuotaMatches = actualAmount * BigInt(quotaUnitsPerCurrencyUnit)
    === BigInt(rawQuotaDelta) * actualScaleFactor;
  const displayUsageMatches = actualAmount
    * aiImageSandboxPowerOfTen(displayTotalUsageDelta.scale)
    * aiImageSandboxPowerOfTen(displayTotalUsageUnitCurrencyScale)
    === BigInt(displayTotalUsageDelta.amount) * actualScaleFactor;
  if (!rawQuotaMatches || !displayUsageMatches) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox billing meter evidence does not exactly prove actual cost',
    );
  }
  return {
    rawQuotaDelta,
    quotaUnitsPerCurrencyUnit,
    displayTotalUsageDelta,
    displayTotalUsageUnitCurrencyScale,
  };
}

function parseCumulativeUsageEvidence(value: unknown, actualCost: AiImageSandboxMoney) {
  const code = 'SANDBOX_BILLING_ATTESTATION_INVALID' as const;
  if (!isRecord(value) || !hasExactKeys(value, CUMULATIVE_USAGE_EVIDENCE_KEYS)) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox cumulative usage evidence contains missing or unsupported fields',
    );
  }
  const totalRequests = requiredNonnegativeInteger(value, 'totalRequests', code);
  const totalActualCost = exactDecimal(
    value.totalActualCost,
    'totalActualCost',
    code,
  );
  if (
    value.schemaVersion !== 1
    || value.kind !== SUB2_CUMULATIVE_USAGE_KIND
    || totalRequests !== 0
    || totalActualCost.amount !== 0
    || totalActualCost.scale !== 0
    || actualCost.amount !== 0
  ) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox cumulative usage evidence must prove zero lifetime requests and actual cost',
    );
  }
  return {
    kind: SUB2_CUMULATIVE_USAGE_KIND,
    totalRequests,
    totalActualCost,
  };
}

function parseSub2CumulativeUsageSnapshot(
  evidence: PrivateFileEvidence,
  attestation: ReturnType<typeof parseAttestation>,
) {
  const code = 'SANDBOX_BILLING_EVIDENCE_INVALID' as const;
  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(evidence.bytes),
    ) as unknown;
    if (!isRecord(parsed)) throw new Error('invalid');
    record = parsed;
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox cumulative usage snapshot must contain one UTF-8 JSON object',
    );
  }
  const usage = isRecord(record.usage) ? record.usage : null;
  const today = usage && isRecord(usage.today) ? usage.today : null;
  const total = usage && isRecord(usage.total) ? usage.total : null;
  const todayRequests = today && Number.isSafeInteger(today.requests)
    ? Number(today.requests)
    : null;
  const todayActualCost = today && typeof today.actual_cost === 'number'
    && Number.isFinite(today.actual_cost)
    ? Number(today.actual_cost)
    : null;
  const totalRequests = total && Number.isSafeInteger(total.requests)
    ? Number(total.requests)
    : null;
  const totalActualCost = total && typeof total.actual_cost === 'number'
    && Number.isFinite(total.actual_cost)
    ? Number(total.actual_cost)
    : null;
  if (
    record.isValid !== true
    || record.unit !== attestation.currency
    || todayRequests !== 0
    || todayActualCost !== 0
    || totalRequests !== attestation.cumulativeUsageEvidence?.totalRequests
    || totalActualCost !== 0
    || attestation.cumulativeUsageEvidence?.totalActualCost.amount !== 0
  ) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox cumulative usage snapshot does not prove zero API-key usage and actual cost',
    );
  }
}

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function dimensions(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  return width && height ? { width, height } : null;
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
}

function isUnsupportedWindowsDirectorySync(error: unknown) {
  return process.platform === 'win32'
    && ['EACCES', 'EISDIR', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(errorCode(error));
}

async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if (isUnsupportedWindowsDirectorySync(error)) return;
    throw error;
  }
  try {
    try {
      await handle.sync();
    } catch (error) {
      if (!isUnsupportedWindowsDirectorySync(error)) throw error;
    }
  } finally {
    await handle.close();
  }
}

async function tolerateWindowsMode(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    if (process.platform === 'win32' && ['EINVAL', 'ENOSYS', 'EPERM'].includes(errorCode(error))) {
      return;
    }
    throw error;
  }
}

async function ensurePrivateDirectory(path: string, allowedRoot: string) {
  const root = resolve(allowedRoot);
  const target = resolve(path);
  if (!isPathWithin(root, target)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory escaped its private evidence root',
    );
  }
  const segments = relative(root, target).split(/[\\/]/gu).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    let metadata = await lstat(current);
    const canonicalPath = await realpath(current);
    if (
      !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || !samePath(current, canonicalPath)
      || !isPathWithin(root, canonicalPath)
    ) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing output directory is not private',
      );
    }
    await tolerateWindowsMode(() => chmod(current, 0o700));
    metadata = await lstat(current);
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing output directory is not private',
      );
    }
    await syncDirectory(current);
    const parent = dirname(current);
    if (parent !== current) await syncDirectory(parent);
  }
}

interface PrivateOutputDirectory {
  path: string;
  canonicalPath: string;
  device: bigint;
  inode: bigint;
  handle: Awaited<ReturnType<typeof open>>;
}

function samePath(left: string, right: string) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function hasStableFileIdentity(device: bigint, inode: bigint) {
  return device > 0n && inode > 0n;
}

function sameFileIdentity(
  left: { device: bigint; inode: bigint },
  right: { device: bigint; inode: bigint },
) {
  return left.device === right.device && left.inode === right.inode;
}

async function openPrivateOutputDirectory(
  path: string,
  allowedRoot: string,
  descriptorBoundPath?: string,
): Promise<PrivateOutputDirectory> {
  const resolvedPath = resolve(path);
  const canonicalPath = await realpath(resolvedPath);
  if (!samePath(resolvedPath, canonicalPath) || !isPathWithin(allowedRoot, canonicalPath)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory escaped its private evidence root',
    );
  }
  const pathMetadata = await lstat(resolvedPath);
  const pathIdentity = await lstat(resolvedPath, { bigint: true });
  if (
    !pathMetadata.isDirectory()
    || pathMetadata.isSymbolicLink()
    || !hasStableFileIdentity(pathIdentity.dev, pathIdentity.ino)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory identity is unavailable',
    );
  }
  const directoryFlags = constants.O_RDONLY
    | (process.platform === 'win32' ? 0 : (constants.O_DIRECTORY || 0) | constants.O_NOFOLLOW);
  const handle = await open(descriptorBoundPath || canonicalPath, directoryFlags);
  try {
    const handleMetadata = await handle.stat({ bigint: true });
    const directory = {
      path: resolvedPath,
      canonicalPath,
      device: pathIdentity.dev,
      inode: pathIdentity.ino,
      handle,
    };
    if (
      !handleMetadata.isDirectory()
      || !hasStableFileIdentity(handleMetadata.dev, handleMetadata.ino)
      || !sameFileIdentity(directory, {
        device: handleMetadata.dev,
        inode: handleMetadata.ino,
      })
      || (process.platform !== 'win32' && (handleMetadata.mode & 0o077n) !== 0n)
    ) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing output directory changed while it was opened',
      );
    }
    return directory;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertPrivateOutputDirectoryStable(directory: PrivateOutputDirectory) {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(directory.path);
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory disappeared during finalization',
    );
  }
  const [pathMetadata, handleMetadata] = await Promise.all([
    lstat(directory.path, { bigint: true }),
    directory.handle.stat({ bigint: true }),
  ]);
  if (
    !samePath(canonicalPath, directory.canonicalPath)
    || !pathMetadata.isDirectory()
    || pathMetadata.isSymbolicLink()
    || !handleMetadata.isDirectory()
    || !hasStableFileIdentity(pathMetadata.dev, pathMetadata.ino)
    || !hasStableFileIdentity(handleMetadata.dev, handleMetadata.ino)
    || !sameFileIdentity(directory, { device: pathMetadata.dev, inode: pathMetadata.ino })
    || !sameFileIdentity(directory, { device: handleMetadata.dev, inode: handleMetadata.ino })
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing output directory changed during finalization',
    );
  }
}

function privateOutputEntryPath(directory: PrivateOutputDirectory, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(name)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing output filename is invalid',
    );
  }
  return process.platform === 'linux'
    ? `/proc/self/fd/${directory.handle.fd}/${name}`
    : resolve(directory.canonicalPath, name);
}

async function readBoundedFile(handle: Awaited<ReturnType<typeof open>>, maxBytes: number) {
  const buffer = Buffer.allocUnsafe(maxBytes + 1);
  let bytesRead = 0;
  while (bytesRead < buffer.byteLength) {
    const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
    if (result.bytesRead === 0) break;
    bytesRead += result.bytesRead;
  }
  return buffer.subarray(0, bytesRead);
}

async function resolvePrivateEvidenceRoot(repositoryRoot: string, configuredRoot: string) {
  const value = String(configuredRoot || '').trim();
  if (!value) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing evidence root is required',
    );
  }
  const path = resolve(repositoryRoot, value);
  try {
    const canonicalPath = await realpath(path);
    const metadata = await lstat(canonicalPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('unsafe');
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error('unsafe');
    }
    return canonicalPath;
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing evidence root must resolve to one private directory',
    );
  }
}

function isPathWithin(root: string, candidate: string) {
  const value = relative(root, candidate);
  return value === ''
    || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`));
}

async function loadPrivateFile(input: {
  repositoryRoot: string;
  path: string;
  expectedSha256?: string;
  maxBytes: number;
  allowedRoot?: string;
}): Promise<PrivateFileEvidence> {
  const expectedSha256 = input.expectedSha256 === undefined
    ? null
    : String(input.expectedSha256 || '').trim().toLowerCase();
  if (expectedSha256 !== null && !SHA256_PATTERN.test(expectedSha256)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing evidence digest must be a lowercase SHA-256 value',
    );
  }
  const path = resolve(input.repositoryRoot, String(input.path || '').trim());
  let handle: Awaited<ReturnType<typeof open>>;
  let canonicalPath = '';
  try {
    const pathMetadata = await lstat(path);
    if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) throw new Error('unsafe');
    canonicalPath = await realpath(path);
    if (input.allowedRoot && !isPathWithin(input.allowedRoot, canonicalPath)) {
      throw new Error('unsafe');
    }
    handle = await open(
      path,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox billing evidence could not be opened as a private regular file',
    );
  }
  let bytes: Buffer;
  let device = 0n;
  let inode = 0n;
  try {
    const metadata = await handle.stat();
    const identity = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > input.maxBytes) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing evidence must be a bounded regular file',
      );
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing evidence must not be accessible by group or other users',
      );
    }
    device = identity.dev;
    inode = identity.ino;
    bytes = await readBoundedFile(handle, input.maxBytes);
    if (bytes.byteLength !== metadata.size || bytes.byteLength > input.maxBytes) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_FILE_UNSAFE',
        'Sandbox billing evidence changed while it was being read',
      );
    }
  } finally {
    await handle.close();
  }
  const actualSha256 = sha256(bytes);
  if (expectedSha256 !== null && actualSha256 !== expectedSha256) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_DIGEST_MISMATCH',
      'Sandbox billing evidence does not match its reviewed digest',
    );
  }
  return { path, canonicalPath, bytes, sha256: actualSha256, device, inode };
}

async function loadPrivateCanonicalJson(input: {
  repositoryRoot: string;
  path: string;
  expectedSha256?: string;
  maxBytes: number;
  kind: 'attestation' | 'evidence';
  allowedRoot?: string;
}): Promise<PrivateJsonEvidence> {
  const evidence = await loadPrivateFile(input);
  let textValue = '';
  let record: Record<string, unknown>;
  try {
    textValue = new TextDecoder('utf-8', { fatal: true }).decode(evidence.bytes);
    const parsed = JSON.parse(textValue) as unknown;
    if (!isRecord(parsed)) throw new Error('invalid');
    record = parsed;
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      input.kind === 'attestation'
        ? 'SANDBOX_BILLING_ATTESTATION_INVALID'
        : 'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing evidence must contain one canonical JSON object',
    );
  }
  if (textValue.replace(/\r\n/gu, '\n') !== `${JSON.stringify(record, null, 2)}\n`) {
    throw new AiImageSandboxBillingSettlementError(
      input.kind === 'attestation'
        ? 'SANDBOX_BILLING_ATTESTATION_INVALID'
        : 'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing evidence must use canonical JSON without duplicate keys',
    );
  }
  return { ...evidence, record };
}

async function readExactPrivateFile(
  path: string,
  expected: Buffer,
  maxBytes: number,
  allowedRoot: string,
) {
  let evidence: PrivateJsonEvidence;
  try {
    evidence = await loadPrivateCanonicalJson({
      repositoryRoot: dirname(path),
      path,
      expectedSha256: sha256(expected),
      maxBytes,
      kind: 'evidence',
      allowedRoot,
    });
  } catch {
    return false;
  }
  return evidence.bytes.equals(expected);
}

async function writePrivateOutputEntry(
  directory: PrivateOutputDirectory,
  finalName: string,
  bytes: Buffer,
) {
  const temporaryName = `${finalName}.${process.pid}.${randomUUID()}.tmp`;
  const temporaryPath = privateOutputEntryPath(directory, temporaryName);
  const finalPath = privateOutputEntryPath(directory, finalName);
  try {
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await tolerateWindowsMode(() => handle.chmod(0o600));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertPrivateOutputDirectoryStable(directory);
    await link(temporaryPath, finalPath);
    await assertPrivateOutputDirectoryStable(directory);
    await tolerateWindowsMode(() => chmod(finalPath, 0o600));
    try {
      await directory.handle.sync();
    } catch (error) {
      if (!isUnsupportedWindowsDirectorySync(error)) throw error;
    }
    await assertPrivateOutputDirectoryStable(directory);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function writeExclusiveAtomicFile(path: string, bytes: Buffer, allowedRoot: string) {
  const outputDirectoryPath = dirname(path);
  await ensurePrivateDirectory(outputDirectoryPath, allowedRoot);
  const directory = await openPrivateOutputDirectory(outputDirectoryPath, allowedRoot);
  try {
    await writePrivateOutputEntry(directory, basename(path), bytes);
  } finally {
    await directory.handle.close();
  }
}

export interface AiImageSandboxPrivateEvidenceBundleInput {
  repositoryRoot: string;
  evidenceRoot: string;
  directoryName: string;
  files: Array<{ name: string; bytes: Buffer }>;
  beforeEntryWrite?: (input: {
    index: number;
    name: string;
    outputDirectory: string;
  }) => Promise<void> | void;
}

export async function writeAiImageSandboxPrivateEvidenceBundle(
  input: AiImageSandboxPrivateEvidenceBundleInput,
) {
  if (!OPERATION_ID_PATTERN.test(input.directoryName)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox private evidence directory name is invalid',
    );
  }
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > 32) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox private evidence bundle is invalid',
    );
  }
  const names = new Set<string>();
  for (const file of input.files) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(file.name)
      || names.has(file.name)
      || !Buffer.isBuffer(file.bytes)
      || file.bytes.byteLength === 0
      || file.bytes.byteLength > MAX_BILLING_SNAPSHOT_BYTES
    ) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_CONFIG_INVALID',
        'Sandbox private evidence bundle entry is invalid',
      );
    }
    names.add(file.name);
  }
  const allowedRoot = await resolvePrivateEvidenceRoot(
    input.repositoryRoot,
    input.evidenceRoot,
  );
  const outputDirectory = resolve(allowedRoot, input.directoryName);
  if (!isPathWithin(allowedRoot, outputDirectory) || dirname(outputDirectory) !== allowedRoot) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_FILE_UNSAFE',
      'Sandbox private evidence directory escaped its root',
    );
  }
  const rootDirectory = await openPrivateOutputDirectory(allowedRoot, allowedRoot);
  try {
    const descriptorBoundOutputDirectory = privateOutputEntryPath(
      rootDirectory,
      input.directoryName,
    );
    await assertPrivateOutputDirectoryStable(rootDirectory);
    try {
      await mkdir(descriptorBoundOutputDirectory, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        throw new AiImageSandboxBillingSettlementError(
          'SANDBOX_BILLING_FILE_UNSAFE',
          'Sandbox private evidence directory already exists',
        );
      }
      throw error;
    }
    try {
      await rootDirectory.handle.sync();
    } catch (error) {
      if (!isUnsupportedWindowsDirectorySync(error)) throw error;
    }
    await assertPrivateOutputDirectoryStable(rootDirectory);
    const directory = await openPrivateOutputDirectory(
      outputDirectory,
      allowedRoot,
      descriptorBoundOutputDirectory,
    );
    try {
      await tolerateWindowsMode(() => directory.handle.chmod(0o700));
      await assertPrivateOutputDirectoryStable(rootDirectory);
      await assertPrivateOutputDirectoryStable(directory);
      for (const [index, file] of input.files.entries()) {
        await input.beforeEntryWrite?.({
          index,
          name: file.name,
          outputDirectory: directory.path,
        });
        await assertPrivateOutputDirectoryStable(rootDirectory);
        await assertPrivateOutputDirectoryStable(directory);
        await writePrivateOutputEntry(directory, file.name, file.bytes);
        await assertPrivateOutputDirectoryStable(rootDirectory);
      }
      await assertPrivateOutputDirectoryStable(directory);
      await assertPrivateOutputDirectoryStable(rootDirectory);
    } finally {
      await directory.handle.close();
    }
  } finally {
    await rootDirectory.handle.close();
  }
  return { evidenceRoot: allowedRoot, outputDirectory };
}

function assertApprovalEvidence(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, APPROVAL_EVIDENCE_KEYS)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing approval evidence is invalid',
    );
  }
  const shaKeys = [
    'approvalSha256',
    'approverRefSha256',
    'providerAccountRefSha256',
    'pricingRevisionSha256',
    'preCallBillingSnapshotRefSha256',
    'billingReconciliationRefSha256',
  ];
  if (
    typeof value.approvalId !== 'string'
    || !OPERATION_ID_PATTERN.test(value.approvalId)
    || shaKeys.some((key) => typeof value[key] !== 'string' || !SHA256_PATTERN.test(value[key]))
    || typeof value.currency !== 'string'
    || !/^[A-Z]{3}$/u.test(value.currency)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing approval evidence is invalid',
    );
  }
  const approvedAt = canonicalTimestamp(
    value,
    'approvedAt',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  const expiresAt = canonicalTimestamp(
    value,
    'expiresAt',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  if (
    expiresAt.time <= approvedAt.time
    || expiresAt.time - approvedAt.time > MAX_APPROVAL_WINDOW_MS
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing approval validity window is invalid',
    );
  }
  return value;
}

function assertIntentRequest(request: Record<string, unknown>) {
  const operation = typeof request.operation === 'string' ? request.operation : '';
  const requestProfile = typeof request.requestProfile === 'string' ? request.requestProfile : '';
  const width = positiveInteger(request.width);
  const height = positiveInteger(request.height);
  const sourceSha256 = Array.isArray(request.sourceSha256)
    && request.sourceSha256.length <= 1
    && request.sourceSha256.every((entry) => typeof entry === 'string' && SHA256_PATTERN.test(entry))
    ? request.sourceSha256 as string[]
    : null;
  const sourceDimensions = Array.isArray(request.sourceDimensions)
    ? request.sourceDimensions.map(dimensions)
    : null;
  const maskSha256 = request.maskSha256 === null
    ? null
    : typeof request.maskSha256 === 'string' && SHA256_PATTERN.test(request.maskSha256)
      ? request.maskSha256
      : undefined;
  const maskDimensions = request.maskDimensions === null
    ? null
    : dimensions(request.maskDimensions);
  if (
    !SANDBOX_OPERATIONS.has(operation)
    || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(requestProfile)
    || request.n !== 1
    || !width
    || !height
    || request.size !== `${width}x${height}`
    || typeof request.promptSha256 !== 'string'
    || !SHA256_PATTERN.test(request.promptSha256)
    || !sourceSha256
    || !sourceDimensions
    || sourceDimensions.some((entry) => !entry)
    || sourceDimensions.length !== sourceSha256.length
    || maskSha256 === undefined
    || maskDimensions === undefined
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent request is invalid',
    );
  }
  const isTextToImage = operation === 'TEXT_TO_IMAGE';
  const isInpaint = operation === 'INPAINT';
  if (
    (isTextToImage && (
      sourceSha256.length !== 0
      || sourceDimensions.length !== 0
      || maskSha256 !== null
      || maskDimensions !== null
    ))
    || (!isTextToImage && (sourceSha256.length !== 1 || sourceDimensions.length !== 1))
    || (isInpaint && (
      maskSha256 === null
      || maskDimensions === null
      || maskDimensions.width !== sourceDimensions[0]!.width
      || maskDimensions.height !== sourceDimensions[0]!.height
    ))
    || (!isInpaint && (maskSha256 !== null || maskDimensions !== null))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent media evidence is invalid',
    );
  }
}

function parseConsoleBillEvidence(value: unknown, actualCost: AiImageSandboxMoney) {
  const code = 'SANDBOX_BILLING_ATTESTATION_INVALID' as const;
  if (!isRecord(value) || !hasExactKeys(value, CONSOLE_BILL_EVIDENCE_KEYS)
    || value.schemaVersion !== 1 || value.kind !== 'XIAOYI_ACCOUNT_CREDIT_CONSOLE_V1'
    || value.displayedCurrency !== 'USD' || actualCost.currency !== 'CNY') {
    throw new AiImageSandboxBillingSettlementError(code, 'Console bill account-unit evidence is invalid');
  }
  let displayedCharge: ReturnType<typeof parseAiImageSandboxDecimal>;
  let cashUnitsPerDisplayedUnit: ReturnType<typeof parseAiImageSandboxDecimal>;
  try {
    displayedCharge = parseAiImageSandboxDecimal(value.displayedCharge, 'Console displayed charge');
    cashUnitsPerDisplayedUnit = parseAiImageSandboxDecimal(value.cashUnitsPerDisplayedUnit, 'Account cash unit');
  } catch {
    throw new AiImageSandboxBillingSettlementError(code, 'Console bill exact decimals are invalid');
  }
  const loggedQuota = requiredPositiveInteger(value, 'loggedQuota', code);
  if (displayedCharge.amount <= 0
    || cashUnitsPerDisplayedUnit.amount !== 1 || cashUnitsPerDisplayedUnit.scale !== 0
    || !aiImageSandboxDecimalsEqual(displayedCharge, { amount: actualCost.amount, scale: actualCost.scale })
    || BigInt(loggedQuota) * aiImageSandboxPowerOfTen(displayedCharge.scale)
      !== BigInt(displayedCharge.amount) * 500_000n) {
    throw new AiImageSandboxBillingSettlementError(code, 'Console bill charge and confirmed account cash value disagree');
  }
  return {
    kind: 'XIAOYI_ACCOUNT_CREDIT_CONSOLE_V1' as const,
    displayedCurrency: 'USD' as const,
    displayedCharge,
    loggedQuota,
    cashUnitsPerDisplayedUnit,
    screenshotPath: requiredString(value, 'screenshotPath', code, 2_048),
    screenshotSha256: requiredSha256(value, 'screenshotSha256', code),
    userConfirmationPath: requiredString(value, 'userConfirmationPath', code, 2_048),
    userConfirmationSha256: requiredSha256(value, 'userConfirmationSha256', code),
  };
}

function parseAttestation(record: Record<string, unknown>, now: Date) {
  const schemaVersion = record.schemaVersion;
  const expectedKeys = schemaVersion === 1
    ? ATTESTATION_V1_KEYS
    : schemaVersion === 2
      ? ATTESTATION_V2_KEYS
      : schemaVersion === 3
        ? ATTESTATION_V3_KEYS
        : schemaVersion === 4
          ? ATTESTATION_V4_KEYS
          : schemaVersion === 5
            ? ATTESTATION_V5_KEYS
            : null;
  if (!expectedKeys || !hasExactKeys(record, expectedKeys)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing attestation contains missing or unsupported fields',
    );
  }
  const settlementId = requiredString(
    record,
    'settlementId',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
    80,
  );
  if (!OPERATION_ID_PATTERN.test(settlementId)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing settlement ID is invalid',
    );
  }
  if (requiredString(
    record,
    'statement',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
    80,
  ) !== AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing attestation statement is invalid',
    );
  }
  const operationId = requiredString(
    record,
    'operationId',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
    80,
  );
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing Operation ID is invalid',
    );
  }
  const preCallObservedAt = canonicalTimestamp(
    record,
    'preCallObservedAt',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
  );
  const settledObservedAt = canonicalTimestamp(
    record,
    'settledObservedAt',
    'SANDBOX_BILLING_ATTESTATION_INVALID',
  );
  if (
    preCallObservedAt.time >= settledObservedAt.time
    || settledObservedAt.time > now.getTime() + MAX_CLOCK_SKEW_MS
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing observation window is invalid',
    );
  }
  const correlationMethod = record.correlationMethod as CorrelationMethod;
  const billingOutcome = record.billingOutcome as BillingOutcome;
  const providerRequestId = record.providerRequestId === null
    ? null
    : typeof record.providerRequestId === 'string'
      ? requiredString(record, 'providerRequestId', 'SANDBOX_BILLING_ATTESTATION_INVALID', 500)
      : undefined;
  let currency: string;
  let actualCostCents: number | null = null;
  let actualCost: AiImageSandboxMoney | null = null;
  let meterEvidence: ReturnType<typeof parseMeterEvidence> | null = null;
  let cumulativeUsageEvidence: ReturnType<typeof parseCumulativeUsageEvidence> | null = null;
  let consoleBillEvidence: ReturnType<typeof parseConsoleBillEvidence> | null = null;
  if (schemaVersion === 1) {
    currency = requiredString(
      record,
      'currency',
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      3,
    );
    if (!/^[A-Z]{3}$/u.test(currency) || currency !== record.currency) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_ATTESTATION_INVALID',
        'Sandbox billing currency is invalid',
      );
    }
    actualCostCents = requiredNonnegativeInteger(
      record,
      'actualCostCents',
      'SANDBOX_BILLING_ATTESTATION_INVALID',
    );
  } else {
    actualCost = exactMoney(
      record.actualCost,
      'Sandbox billing actual cost',
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      { allowZero: true },
    );
    currency = actualCost.currency;
    if (schemaVersion === 4) {
      cumulativeUsageEvidence = parseCumulativeUsageEvidence(
        record.cumulativeUsageEvidence,
        actualCost,
      );
    } else if (schemaVersion === 5) {
      consoleBillEvidence = parseConsoleBillEvidence(record.consoleBillEvidence, actualCost);
    } else {
      meterEvidence = parseMeterEvidence(record.meterEvidence, actualCost);
    }
  }
  if (
    ![
      'PROVIDER_REQUEST_ID',
      'UNIQUE_ACCOUNT_TIME_WINDOW',
      'PROVIDER_TOKEN_LOG_ENTRY',
      'PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW',
      'API_KEY_CUMULATIVE_ZERO_USAGE',
    ].includes(correlationMethod)
    || providerRequestId === undefined
    || (correlationMethod === 'PROVIDER_REQUEST_ID' && !providerRequestId)
    || (correlationMethod === 'UNIQUE_ACCOUNT_TIME_WINDOW' && providerRequestId !== null)
    || (correlationMethod === 'PROVIDER_TOKEN_LOG_ENTRY' && !providerRequestId)
    || (correlationMethod === 'PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW' && !providerRequestId)
    || (correlationMethod === 'API_KEY_CUMULATIVE_ZERO_USAGE' && providerRequestId !== null)
    || (schemaVersion === 3 && correlationMethod !== 'PROVIDER_TOKEN_LOG_ENTRY')
    || (schemaVersion !== 3 && correlationMethod === 'PROVIDER_TOKEN_LOG_ENTRY')
    || (schemaVersion === 4 && correlationMethod !== 'API_KEY_CUMULATIVE_ZERO_USAGE')
    || (schemaVersion !== 4 && correlationMethod === 'API_KEY_CUMULATIVE_ZERO_USAGE')
    || (schemaVersion === 5 && correlationMethod !== 'PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW')
    || (schemaVersion !== 5 && correlationMethod === 'PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW')
    || !['CHARGED', 'NO_CHARGE'].includes(billingOutcome)
    || (schemaVersion === 1 && billingOutcome === 'CHARGED' && Number(actualCostCents) <= 0)
    || (schemaVersion === 1 && billingOutcome === 'NO_CHARGE' && actualCostCents !== 0)
    || (schemaVersion !== 1 && billingOutcome === 'CHARGED' && actualCost!.amount <= 0)
    || (schemaVersion !== 1 && billingOutcome === 'NO_CHARGE' && actualCost!.amount !== 0)
    || (schemaVersion === 4 && billingOutcome !== 'NO_CHARGE')
    || (schemaVersion === 5 && billingOutcome !== 'CHARGED')
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing outcome or correlation is invalid',
    );
  }
  return {
    schemaVersion: schemaVersion as 1 | 2 | 3 | 4 | 5,
    generation: schemaVersion === 1 ? 'LEGACY' as const : 'EXACT' as const,
    settlementId,
    operationId,
    preCallObservedAt,
    settledObservedAt,
    reconcilerRef: requiredString(record, 'reconcilerRef', 'SANDBOX_BILLING_ATTESTATION_INVALID', 128),
    providerAccountRef: requiredString(record, 'providerAccountRef', 'SANDBOX_BILLING_ATTESTATION_INVALID', 160),
    pricingRevision: requiredString(record, 'pricingRevision', 'SANDBOX_BILLING_ATTESTATION_INVALID', 160),
    currency,
    preCallBillingSnapshotRef: requiredString(record, 'preCallBillingSnapshotRef', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    billingReconciliationRef: requiredString(record, 'billingReconciliationRef', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    preCallBillingSnapshotPath: schemaVersion === 4
      ? null
      : requiredString(
          record,
          'preCallBillingSnapshotPath',
          'SANDBOX_BILLING_ATTESTATION_INVALID',
          2_048,
        ),
    settledBillingSnapshotPath: requiredString(
      record,
      'settledBillingSnapshotPath',
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      2_048,
    ),
    preCallBillingSnapshotSha256: schemaVersion === 4
      ? null
      : requiredSha256(
          record,
          'preCallBillingSnapshotSha256',
          'SANDBOX_BILLING_ATTESTATION_INVALID',
        ),
    settledBillingSnapshotSha256: requiredSha256(record, 'settledBillingSnapshotSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    providerBillingEntryRef: requiredString(record, 'providerBillingEntryRef', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    intentSha256: requiredSha256(record, 'intentSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    submitReportSha256: requiredSha256(record, 'submitReportSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    fingerprintClaimSha256: requiredSha256(record, 'fingerprintClaimSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    requestFingerprint: requiredSha256(record, 'requestFingerprint', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    approvalId: requiredString(record, 'approvalId', 'SANDBOX_BILLING_ATTESTATION_INVALID', 80),
    approvalSha256: requiredSha256(record, 'approvalSha256', 'SANDBOX_BILLING_ATTESTATION_INVALID'),
    correlationMethod,
    providerRequestId,
    billingOutcome,
    actualCostCents,
    actualCost,
    meterEvidence,
    cumulativeUsageEvidence,
    consoleBillEvidence,
    providerTokenLogSnapshotPath: schemaVersion === 3 || schemaVersion === 5
      ? requiredString(
          record,
          'providerTokenLogSnapshotPath',
          'SANDBOX_BILLING_ATTESTATION_INVALID',
          2_048,
        )
      : null,
    providerTokenLogSnapshotSha256: schemaVersion === 3 || schemaVersion === 5
      ? requiredSha256(
          record,
          'providerTokenLogSnapshotSha256',
          'SANDBOX_BILLING_ATTESTATION_INVALID',
        )
      : null,
    providerTokenLogUserId: schemaVersion === 3 || schemaVersion === 5
      ? requiredPositiveInteger(
          record,
          'providerTokenLogUserId',
          'SANDBOX_BILLING_ATTESTATION_INVALID',
        )
      : null,
    providerTokenLogTokenId: schemaVersion === 3 || schemaVersion === 5
      ? requiredPositiveInteger(
          record,
          'providerTokenLogTokenId',
          'SANDBOX_BILLING_ATTESTATION_INVALID',
        )
      : null,
  };
}

function parseProviderTokenLogSnapshot(input: {
  record: Record<string, unknown>;
  now: Date;
  attestation: ReturnType<typeof parseAttestation>;
  intent: ReturnType<typeof parseIntent>;
  report: ReturnType<typeof parseReport>;
}) {
  const code = 'SANDBOX_BILLING_EVIDENCE_INVALID' as const;
  const { record, now, attestation, intent, report } = input;
  const expectedQuota = attestation.consoleBillEvidence?.loggedQuota
    ?? attestation.meterEvidence!.rawQuotaDelta;
  if (
    !hasExactKeys(record, PROVIDER_TOKEN_LOG_SNAPSHOT_KEYS)
    || record.schemaVersion !== 1
    || record.kind !== 'AI_IMAGE_SANDBOX_PROVIDER_LOG_SNAPSHOT'
    || record.operationId !== attestation.operationId
    || !isRecord(record.request)
    || !hasExactKeys(record.request, PROVIDER_TOKEN_LOG_REQUEST_KEYS)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox Provider token-log snapshot schema is invalid',
    );
  }
  const observedAt = canonicalTimestamp(record, 'observedAt', code);
  const request = record.request;
  const name = requiredString(request, 'name', code, 80);
  const method = requiredString(request, 'method', code, 10);
  const uri = requiredString(request, 'uri', code, 2_048);
  const contentType = requiredString(request, 'contentType', code, 160);
  const bodySha256 = requiredSha256(request, 'bodySha256', code);
  const bodyBase64 = requiredString(
    request,
    'bodyBase64',
    code,
    Math.ceil(MAX_BILLING_SNAPSHOT_BYTES / 3) * 4 + 4,
  );
  let logUri: URL;
  try {
    logUri = new URL(uri);
  } catch {
    throw new AiImageSandboxBillingSettlementError(code, 'Sandbox Provider token-log URI is invalid');
  }
  const intentApiBaseSha256 = intent.generation === 'EXACT'
    ? intent.record.apiBaseSha256
    : null;
  const xiaoyiApiBaseSha256 = sha256(AI_IMAGE_XIAOYI_API_BASE);
  const logOriginMatchesPaidApiBase = intentApiBaseSha256 === xiaoyiApiBaseSha256
    ? logUri.origin === AI_IMAGE_XIAOYI_BILLING_ORIGIN
    : logUri.origin !== AI_IMAGE_XIAOYI_BILLING_ORIGIN
      && intentApiBaseSha256 === sha256(`${logUri.origin}/v1`);
  if (
    name !== 'providerTokenLog'
    || method !== 'GET'
    || request.httpStatus !== 200
    || !contentType.toLowerCase().startsWith('application/json')
    || logUri.protocol !== 'https:'
    || logUri.username
    || logUri.password
    || logUri.pathname !== '/api/log/token'
    || logUri.search
    || logUri.hash
    || intent.generation !== 'EXACT'
    || !logOriginMatchesPaidApiBase
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox Provider token-log request does not match the paid API Base',
    );
  }
  let bodyBytes: Buffer;
  try {
    bodyBytes = Buffer.from(bodyBase64, 'base64');
  } catch {
    throw new AiImageSandboxBillingSettlementError(code, 'Sandbox Provider token-log body is invalid');
  }
  if (
    bodyBytes.byteLength === 0
    || bodyBytes.byteLength > MAX_BILLING_SNAPSHOT_BYTES
    || bodyBase64 !== request.bodyBase64
    || bodyBytes.toString('base64') !== bodyBase64
    || sha256(bodyBytes) !== bodySha256
  ) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox Provider token-log body digest is invalid',
    );
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes)) as unknown;
    if (!isRecord(parsed)) throw new Error('invalid');
    body = parsed;
  } catch {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox Provider token-log body must contain one UTF-8 JSON object',
    );
  }
  if (
    !hasExactKeys(body, PROVIDER_TOKEN_LOG_BODY_KEYS)
    || body.success !== true
    || typeof body.message !== 'string'
    || !Array.isArray(body.data)
    || body.data.length === 0
    || body.data.length > MAX_PROVIDER_TOKEN_LOG_ENTRIES
  ) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox Provider token-log response schema is invalid',
    );
  }
  const expectedRequestPath = intent.request.operation === 'TEXT_TO_IMAGE'
    ? '/v1/images/generations'
    : '/v1/images/edits';
  const elapsedMs = Number(report.record.elapsedMs);
  const candidateEntries: Array<{
    entry: Record<string, unknown>;
    createdAtSeconds: number;
    createdAtTime: number;
    useTime: number;
    requestPath: string;
  }> = [];
  for (const value of body.data) {
    if (!isRecord(value)) continue;
    const createdAtSeconds = Number.isSafeInteger(value.created_at)
      && Number(value.created_at) >= 0
      ? Number(value.created_at)
      : null;
    const useTime = Number.isSafeInteger(value.use_time) && Number(value.use_time) >= 0
      ? Number(value.use_time)
      : null;
    const createdAtTime = createdAtSeconds === null ? null : createdAtSeconds * 1_000;
    if (
      value.type !== 2
      || value.model_name !== intent.model
      || value.quota !== expectedQuota
      || createdAtSeconds === null
      || createdAtTime === null
      || useTime === null
      || createdAtTime < report.startedAt.time - 1_000
      || createdAtTime > report.completedAt.time + 1_000
      || Math.abs(useTime * 1_000 - elapsedMs) > MAX_PROVIDER_DURATION_DIFFERENCE_MS
    ) {
      continue;
    }
    let other: Record<string, unknown>;
    try {
      const otherText = typeof value.other === 'string' ? value.other : '';
      if (!otherText || otherText.length > 16 * 1024) throw new Error('invalid');
      const parsed = JSON.parse(otherText) as unknown;
      if (!isRecord(parsed)) throw new Error('invalid');
      other = parsed;
    } catch {
      throw new AiImageSandboxBillingSettlementError(
        code,
        'Sandbox Provider token-log candidate metadata is invalid',
      );
    }
    const requestPath = requiredString(other, 'request_path', code, 200);
    if (requestPath === expectedRequestPath) {
      candidateEntries.push({
        entry: value,
        createdAtSeconds,
        createdAtTime,
        useTime,
        requestPath,
      });
    }
  }
  if (candidateEntries.length !== 1) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox Provider token-log entry is missing or ambiguous',
    );
  }
  const candidate = candidateEntries[0]!;
  const entry = candidate.entry;
  if (!hasRequiredAndAllowedKeys(
    entry,
    PROVIDER_TOKEN_LOG_ENTRY_REQUIRED_KEYS,
    PROVIDER_TOKEN_LOG_ENTRY_ALLOWED_KEYS,
  )) {
    throw new AiImageSandboxBillingSettlementError(
      code,
      'Sandbox Provider token-log entry schema is invalid',
    );
  }
  requiredPositiveInteger(entry, 'id', code);
  const userId = requiredPositiveInteger(entry, 'user_id', code);
  const tokenId = requiredPositiveInteger(entry, 'token_id', code);
  const createdAtSeconds = requiredNonnegativeInteger(entry, 'created_at', code);
  const quota = requiredNonnegativeInteger(entry, 'quota', code);
  const useTime = requiredNonnegativeInteger(entry, 'use_time', code);
  const model = requiredString(entry, 'model_name', code, 200);
  const requestId = requiredString(entry, 'request_id', code, 64);
  let upstreamRequestId: string | null = null;
  if (Object.hasOwn(entry, 'upstream_request_id')) {
    upstreamRequestId = requiredString(entry, 'upstream_request_id', code, 128);
  }
  const createdAtTime = createdAtSeconds * 1_000;
  if (
    entry.type !== 2
    || requestId !== attestation.providerRequestId
    || userId !== attestation.providerTokenLogUserId
    || tokenId !== attestation.providerTokenLogTokenId
    || model !== intent.model
    || quota !== expectedQuota
    || candidate.requestPath !== expectedRequestPath
    || createdAtSeconds !== candidate.createdAtSeconds
    || createdAtTime !== candidate.createdAtTime
    || useTime !== candidate.useTime
    || createdAtTime < report.startedAt.time - 1_000
    || createdAtTime > report.completedAt.time + 1_000
    || Math.abs(useTime * 1_000 - elapsedMs) > MAX_PROVIDER_DURATION_DIFFERENCE_MS
    || (upstreamRequestId !== null
      && sha256(upstreamRequestId) !== report.record.providerRequestIdHash)
    || observedAt.time < report.completedAt.time
    || observedAt.time < createdAtTime
    || observedAt.time > now.getTime() + MAX_CLOCK_SKEW_MS
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox Provider token-log entry does not match the paid request',
    );
  }
  return {
    observedAt,
    entryCreatedAt: new Date(createdAtTime).toISOString(),
    requestIdHash: sha256(requestId),
    requestIdBridge: upstreamRequestId === null
      ? 'UNAVAILABLE_UNIQUE_ENTRY' as const
      : 'UPSTREAM_REQUEST_ID' as const,
    userId,
    tokenId,
  };
}

function parseIntent(record: Record<string, unknown>, operationId: string) {
  const schemaVersion = record.schemaVersion;
  const expectedKeys = schemaVersion === 2
    ? INTENT_V2_KEYS
    : schemaVersion === 3
      ? INTENT_V3_KEYS
      : null;
  if (
    !expectedKeys
    || !hasExactKeys(record, expectedKeys)
    || record.operationId !== operationId
    || record.state !== 'SUBMITTING'
    || !isRecord(record.request)
    || !hasExactKeys(record.request, REQUEST_KEYS)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent is invalid',
    );
  }
  const request = record.request;
  assertIntentRequest(request);
  const approvalEvidence = assertApprovalEvidence(request.approvalEvidence);
  const createdAt = canonicalTimestamp(record, 'createdAt', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  let quotedCostCents: number | null = null;
  let maximumCostCents: number | null = null;
  let quotedCost: AiImageSandboxMoney;
  let maximumCost: AiImageSandboxMoney;
  if (schemaVersion === 2) {
    quotedCostCents = requiredPositiveInteger(
      record,
      'quotedCostCents',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    maximumCostCents = requiredPositiveInteger(
      record,
      'maximumCostCents',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    quotedCost = {
      currency: String(approvalEvidence.currency),
      amount: quotedCostCents,
      scale: 2,
    };
    maximumCost = {
      currency: String(approvalEvidence.currency),
      amount: maximumCostCents,
      scale: 2,
    };
    exactMoneyPair(
      quotedCost,
      maximumCost,
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      { requireCanonicalSharedScale: false },
    );
  } else {
    quotedCost = exactMoney(
      record.quotedCost,
      'Sandbox billing quoted cost',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    maximumCost = exactMoney(
      record.maximumCost,
      'Sandbox billing maximum cost',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    exactMoneyPair(quotedCost, maximumCost, 'SANDBOX_BILLING_EVIDENCE_INVALID');
  }
  const model = requiredString(record, 'model', 'SANDBOX_BILLING_EVIDENCE_INVALID', 200);
  const credentialRevision = requiredString(
    record,
    'credentialRevision',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
    128,
  );
  if (
    quotedCost.currency !== approvalEvidence.currency
    || maximumCost.currency !== approvalEvidence.currency
    || typeof record.endpointSha256 !== 'string'
    || !SHA256_PATTERN.test(record.endpointSha256)
    || (schemaVersion === 3 && (
      typeof record.apiBaseSha256 !== 'string'
      || !SHA256_PATTERN.test(record.apiBaseSha256)
      || record.apiBaseSha256 === record.endpointSha256
    ))
    || model !== record.model
    || credentialRevision !== record.credentialRevision
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(credentialRevision)
    || typeof record.requestFingerprint !== 'string'
    || !SHA256_PATTERN.test(record.requestFingerprint)
    || typeof record.adapterRevision !== 'string'
    || !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(record.adapterRevision)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing intent identity is invalid',
    );
  }
  return {
    schemaVersion: schemaVersion as 2 | 3,
    generation: schemaVersion === 3 ? 'EXACT' as const : 'LEGACY' as const,
    record,
    request,
    approvalEvidence,
    createdAt,
    quotedCostCents,
    maximumCostCents,
    quotedCost,
    maximumCost,
    model,
    credentialRevision,
  };
}

function parseReport(record: Record<string, unknown>, operationId: string) {
  const schemaVersion = record.schemaVersion;
  const state = typeof record.state === 'string' ? record.state : '';
  const requiredKeys = schemaVersion === 5
    ? REPORT_V5_REQUIRED_KEYS
    : schemaVersion === 4
      ? REPORT_V4_REQUIRED_KEYS
      : schemaVersion === 3
        ? REPORT_V3_REQUIRED_KEYS
        : null;
  const outcomeKeys = state === 'SUCCEEDED'
    ? REPORT_SUCCESS_OUTCOME_KEYS
    : ['REJECTED', 'RECONCILIATION_REQUIRED'].includes(state)
      ? REPORT_FAILURE_OUTCOME_KEYS
      : null;
  const expectedKeys = requiredKeys && outcomeKeys
    ? new Set([...requiredKeys, ...outcomeKeys])
    : null;
  const operationEndpointSha256 = schemaVersion === 4 || schemaVersion === 5
    ? record.operationEndpointSha256
    : record.endpointSha256;
  const apiBaseSha256 = schemaVersion === 4 || schemaVersion === 5
    ? record.apiBaseSha256
    : null;
  if (
    !expectedKeys
    || !hasExactKeys(record, expectedKeys)
    || record.operationId !== operationId
    || (schemaVersion === 5 ? record.actualCost !== null : record.actualCostCents !== null)
    || record.createRequests !== 1
    || !['custom-openai-compatible', 'dashscope-wanx21-image-edit'].includes(String(record.provider))
    || record.usage !== null
    || !SANDBOX_OPERATIONS.has(String(record.operation))
    || typeof record.requestProfile !== 'string'
    || !/^[A-Z][A-Z0-9_]{0,79}$/u.test(record.requestProfile)
    || typeof operationEndpointSha256 !== 'string'
    || !SHA256_PATTERN.test(operationEndpointSha256)
    || ((schemaVersion === 4 || schemaVersion === 5) && (
      typeof apiBaseSha256 !== 'string'
      || !SHA256_PATTERN.test(apiBaseSha256)
      || apiBaseSha256 === operationEndpointSha256
    ))
    || typeof record.promptSha256 !== 'string'
    || !SHA256_PATTERN.test(record.promptSha256)
    || !Array.isArray(record.sourceSha256)
    || record.sourceSha256.length > 1
    || record.sourceSha256.some((entry) => typeof entry !== 'string' || !SHA256_PATTERN.test(entry))
    || (record.maskSha256 !== null
      && (typeof record.maskSha256 !== 'string' || !SHA256_PATTERN.test(record.maskSha256)))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit report is not eligible for finalization',
    );
  }
  const model = requiredString(record, 'model', 'SANDBOX_BILLING_EVIDENCE_INVALID', 200);
  const credentialRevision = requiredString(
    record,
    'credentialRevision',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
    128,
  );
  requiredString(record, 'intentPath', 'SANDBOX_BILLING_EVIDENCE_INVALID', 2_048);
  if (
    model !== record.model
    || credentialRevision !== record.credentialRevision
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(credentialRevision)
    || typeof record.adapterRevision !== 'string'
    || !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(record.adapterRevision)
    || typeof record.requestedSize !== 'string'
    || !/^\d{1,4}x\d{1,4}$/u.test(record.requestedSize)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit identity is invalid',
    );
  }
  const approvalEvidence = assertApprovalEvidence(record.approvalEvidence);
  let quotedCostCents: number | null = null;
  let maximumCostCents: number | null = null;
  let quotedCost: AiImageSandboxMoney;
  let maximumCost: AiImageSandboxMoney;
  if (schemaVersion === 5) {
    quotedCost = exactMoney(
      record.quotedCost,
      'Sandbox billing submit quoted cost',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    maximumCost = exactMoney(
      record.maximumCost,
      'Sandbox billing submit maximum cost',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    exactMoneyPair(quotedCost, maximumCost, 'SANDBOX_BILLING_EVIDENCE_INVALID');
  } else {
    quotedCostCents = requiredPositiveInteger(
      record,
      'quotedCostCents',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    maximumCostCents = requiredPositiveInteger(
      record,
      'maximumCostCents',
      'SANDBOX_BILLING_EVIDENCE_INVALID',
    );
    quotedCost = {
      currency: String(approvalEvidence.currency),
      amount: quotedCostCents,
      scale: 2,
    };
    maximumCost = {
      currency: String(approvalEvidence.currency),
      amount: maximumCostCents,
      scale: 2,
    };
    exactMoneyPair(
      quotedCost,
      maximumCost,
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      { requireCanonicalSharedScale: false },
    );
  }
  if (
    quotedCost.currency !== approvalEvidence.currency
    || maximumCost.currency !== approvalEvidence.currency
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit cost currency is invalid',
    );
  }
  const startedAt = canonicalTimestamp(record, 'startedAt', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  const completedAt = canonicalTimestamp(record, 'completedAt', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  const elapsedMs = requiredNonnegativeInteger(record, 'elapsedMs', 'SANDBOX_BILLING_EVIDENCE_INVALID');
  if (
    completedAt.time < startedAt.time
    || completedAt.time - startedAt.time !== elapsedMs
    || (record.providerRequestIdHash !== null
      && (typeof record.providerRequestIdHash !== 'string'
        || !SHA256_PATTERN.test(record.providerRequestIdHash)))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit timing or request evidence is invalid',
    );
  }
  const successInvalid = state === 'SUCCEEDED' && (
    record.imageCount !== 1
    || !['image/png', 'image/jpeg', 'image/webp'].includes(String(record.mimeType))
    || !positiveInteger(record.width)
    || Number(record.width) > 4_096
    || !positiveInteger(record.height)
    || Number(record.height) > 4_096
    || !positiveInteger(record.bytes)
    || Number(record.bytes) > 50 * 1024 * 1024
    || typeof record.sha256 !== 'string'
    || !SHA256_PATTERN.test(record.sha256)
    || requiredString(record, 'imagePath', 'SANDBOX_BILLING_EVIDENCE_INVALID', 2_048)
      !== record.imagePath
  );
  const failureInvalid = state !== 'SUCCEEDED' && (
    typeof record.failureCode !== 'string'
    || !/^[A-Z0-9_.-]{1,80}$/u.test(record.failureCode)
  );
  if (successInvalid || failureInvalid) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing submit outcome evidence is invalid',
    );
  }
  return {
    record,
    schemaVersion: schemaVersion as 3 | 4 | 5,
    generation: schemaVersion === 5 ? 'EXACT' as const : 'LEGACY' as const,
    apiBaseSha256: apiBaseSha256 as string | null,
    operationEndpointSha256,
    approvalEvidence,
    startedAt,
    completedAt,
    model,
    credentialRevision,
    quotedCostCents,
    maximumCostCents,
    quotedCost,
    maximumCost,
  };
}

function assertArtifactsMatch(input: {
  attestation: ReturnType<typeof parseAttestation>;
  intent: ReturnType<typeof parseIntent>;
  report: ReturnType<typeof parseReport>;
  claim: Record<string, unknown>;
}) {
  const { attestation, intent, report, claim } = input;
  const intentRecord = intent.record;
  const reportRecord = report.record;
  const request = intent.request;
  const xiaoyiProfileSelected = isAiImageXiaoyiEditRequestProfile(
    String(request.requestProfile),
  );
  const xiaoyiProviderIdentity = intent.model === AI_IMAGE_XIAOYI_EDIT_PROFILE.model
    && intentRecord.endpointSha256 === sha256(AI_IMAGE_XIAOYI_EDIT_PROFILE.endpoint);
  const wanxProfileSelected = isAiImageWanx21EditRequestProfile(
    String(request.requestProfile),
  );
  const wanxOperation = aiImageWanx21EditOperationForRequestProfile(
    String(request.requestProfile),
  );
  const wanxApiIdentity = intent.model === AI_IMAGE_WANX21_EDIT_MODEL
    && intentRecord.apiBaseSha256 === sha256(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE);
  const wanxProviderIdentity = wanxApiIdentity
    && intentRecord.endpointSha256
      === sha256(aiImageWanx21EditSubmitEndpoint(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE));
  const sub2CumulativeUsageSelected = attestation.schemaVersion === 4;
  const sub2CumulativeUsageIdentity = intent.generation === 'EXACT'
    && intentRecord.apiBaseSha256 === sha256(SUB2_API_BASE)
    && intentRecord.endpointSha256 === sha256(SUB2_EDIT_ENDPOINT)
    && intent.model === 'gpt-image-2'
    && request.operation === 'IMAGE_TO_IMAGE'
    && request.requestProfile === 'OPENAI_SQUARE_SINGLE_V1'
    && reportRecord.provider === 'custom-openai-compatible';
  const consoleBillIdentity = intent.generation === 'EXACT'
    && report.schemaVersion === 5
    && intentRecord.apiBaseSha256 === sha256(AI_IMAGE_XIAOYI_API_BASE)
    && intentRecord.endpointSha256 === sha256(`${AI_IMAGE_XIAOYI_API_BASE}/images/generations`)
    && intent.model === AI_IMAGE_XIAOYI_EDIT_PROFILE.model
    && request.operation === 'TEXT_TO_IMAGE'
    && ['OPENAI_SQUARE_SINGLE_V1', 'OZON_PORTRAIT_SINGLE_V1'].includes(String(request.requestProfile))
    && request.width === 1024
    && request.height === (request.requestProfile === 'OZON_PORTRAIT_SINGLE_V1' ? 1536 : 1024)
    && reportRecord.state === 'SUCCEEDED'
    && ['USD', 'CNY'].includes(intent.maximumCost.currency);
  const accountUnitBasisMismatch = attestation.schemaVersion === 5
    && attestation.actualCost?.currency === 'CNY'
    && intent.maximumCost.currency === 'USD';
  if (
    attestation.generation !== intent.generation
    || intent.generation !== report.generation
    || xiaoyiProfileSelected !== xiaoyiProviderIdentity
    || wanxProfileSelected !== wanxApiIdentity
    || (wanxProfileSelected && !wanxProviderIdentity)
    || (xiaoyiProfileSelected && (
      intent.generation !== 'EXACT'
      || intentRecord.apiBaseSha256 !== sha256(AI_IMAGE_XIAOYI_EDIT_PROFILE.apiBase)
      || !isAiImageXiaoyiEditOperation(String(request.operation))
    ))
    || (wanxProfileSelected && (
      intent.generation !== 'EXACT'
      || wanxOperation !== String(request.operation)
      || reportRecord.provider !== 'dashscope-wanx21-image-edit'
    ))
    || (sub2CumulativeUsageSelected && !sub2CumulativeUsageIdentity)
    || (attestation.schemaVersion === 5 && !consoleBillIdentity)
    || (!wanxProfileSelected && reportRecord.provider !== 'custom-openai-compatible')
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing artifacts mix incompatible evidence generations',
    );
  }
  if (!hasExactKeys(claim, FINGERPRINT_CLAIM_KEYS)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_EVIDENCE_INVALID',
      'Sandbox billing fingerprint claim is invalid',
    );
  }
  const claimCreatedAt = canonicalTimestamp(
    claim,
    'createdAt',
    'SANDBOX_BILLING_EVIDENCE_INVALID',
  );
  const recomputedFingerprint = createAiImageSandboxRequestFingerprint({
    endpointSha256: String(intentRecord.endpointSha256),
    model: intent.model,
    request: {
      ...((request.requestProfile === AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE
        || isAiImageXiaoyiEditRequestProfile(String(request.requestProfile)))
        ? {
            operation: String(request.operation),
            requestProfile: String(request.requestProfile),
            multipartDialect: aiImageEditMultipartDialectForRequestProfile(
              String(request.requestProfile),
            ),
            multipartFields: aiImageEditMultipartFields(
              aiImageEditMultipartDialectForRequestProfile(String(request.requestProfile)),
            ),
          }
        : wanxProfileSelected
          ? {
              operation: String(request.operation),
              requestProfile: String(request.requestProfile),
              providerTransport: AI_IMAGE_WANX21_EDIT_TRANSPORT,
              providerFunction: aiImageWanx21EditFunction(wanxOperation!),
            }
          : {}),
      n: Number(request.n),
      size: String(request.size),
      promptSha256: String(request.promptSha256),
      sourceSha256: request.sourceSha256 as string[],
      maskSha256: request.maskSha256 as string | null,
    },
  });
  const approvedAt = Date.parse(String(intent.approvalEvidence.approvedAt));
  const expiresAt = Date.parse(String(intent.approvalEvidence.expiresAt));
  if (
    claim.schemaVersion !== 1
    || claim.operationId !== attestation.operationId
    || claim.requestFingerprint !== attestation.requestFingerprint
    || claim.state !== 'CLAIMED_FAIL_CLOSED'
    || claimCreatedAt.value !== intent.createdAt.value
    || intentRecord.requestFingerprint !== attestation.requestFingerprint
    || intentRecord.requestFingerprint !== recomputedFingerprint
    || attestation.approvalId !== intent.approvalEvidence.approvalId
    || attestation.approvalSha256 !== intent.approvalEvidence.approvalSha256
    || sha256(attestation.providerAccountRef) !== intent.approvalEvidence.providerAccountRefSha256
    || sha256(attestation.pricingRevision) !== intent.approvalEvidence.pricingRevisionSha256
    || sha256(attestation.preCallBillingSnapshotRef)
      !== intent.approvalEvidence.preCallBillingSnapshotRefSha256
    || sha256(attestation.billingReconciliationRef)
      !== intent.approvalEvidence.billingReconciliationRefSha256
    || (attestation.currency !== intent.approvalEvidence.currency && !accountUnitBasisMismatch)
    || (attestation.generation === 'EXACT' && (
      !attestation.actualCost
      || (!accountUnitBasisMismatch && (
        attestation.actualCost.currency !== intent.maximumCost.currency
        || attestation.actualCost.scale !== intent.maximumCost.scale
      ))
    ))
    || canonicalJson(report.approvalEvidence) !== canonicalJson(intent.approvalEvidence)
    || (intent.generation === 'EXACT'
      && report.apiBaseSha256 !== intentRecord.apiBaseSha256)
    || report.operationEndpointSha256 !== intentRecord.endpointSha256
    || reportRecord.model !== intentRecord.model
    || reportRecord.credentialRevision !== intentRecord.credentialRevision
    || reportRecord.adapterRevision !== intentRecord.adapterRevision
    || reportRecord.operation !== request.operation
    || reportRecord.requestProfile !== request.requestProfile
    || reportRecord.promptSha256 !== request.promptSha256
    || canonicalJson(reportRecord.sourceSha256) !== canonicalJson(request.sourceSha256)
    || reportRecord.maskSha256 !== request.maskSha256
    || reportRecord.requestedSize !== request.size
    || !aiImageSandboxMoneyEquals(report.quotedCost, intent.quotedCost)
    || !aiImageSandboxMoneyEquals(report.maximumCost, intent.maximumCost)
    || report.startedAt.time < intent.createdAt.time
    || attestation.preCallObservedAt.time > approvedAt
    || approvedAt - attestation.preCallObservedAt.time > MAX_PRECALL_SNAPSHOT_AGE_MS
    || intent.createdAt.time + MAX_CLOCK_SKEW_MS < approvedAt
    || intent.createdAt.time >= expiresAt
    || report.startedAt.time + MAX_CLOCK_SKEW_MS < approvedAt
    || report.startedAt.time >= expiresAt
    || attestation.preCallObservedAt.time > report.startedAt.time
    || report.startedAt.time - attestation.preCallObservedAt.time
      > MAX_PRECALL_SNAPSHOT_AGE_MS
    || attestation.settledObservedAt.time < report.completedAt.time
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing artifacts do not describe the same paid request',
    );
  }
  const providerRequestIdHash = reportRecord.providerRequestIdHash as string | null;
  if (
    (attestation.correlationMethod === 'PROVIDER_REQUEST_ID'
      && (!providerRequestIdHash
        || !attestation.providerRequestId
        || sha256(attestation.providerRequestId) !== providerRequestIdHash))
    || (attestation.correlationMethod === 'UNIQUE_ACCOUNT_TIME_WINDOW'
      && (providerRequestIdHash !== null
        || attestation.providerRequestId !== null
        || attestation.settledObservedAt.time - attestation.preCallObservedAt.time
          > MAX_CORRELATION_WINDOW_MS))
    || (['PROVIDER_TOKEN_LOG_ENTRY', 'PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW'].includes(attestation.correlationMethod)
      && (!providerRequestIdHash || !attestation.providerRequestId))
    || (attestation.correlationMethod === 'API_KEY_CUMULATIVE_ZERO_USAGE'
      && (
        attestation.schemaVersion !== 4
        || !providerRequestIdHash
        || attestation.providerRequestId !== null
        || report.schemaVersion !== 5
        || reportRecord.state !== 'REJECTED'
        || reportRecord.createRequests !== 1
        || reportRecord.usage !== null
        || attestation.billingOutcome !== 'NO_CHARGE'
        || attestation.actualCost?.amount !== 0
        || attestation.settledObservedAt.time - attestation.preCallObservedAt.time
          > MAX_CUMULATIVE_ZERO_SETTLEMENT_WINDOW_MS
      ))
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing correlation does not match Provider request evidence',
    );
  }
}

function parseSettlementClaim(
  record: Record<string, unknown>,
  operationId: string,
  settlementSha256: string,
) {
  if (
    !hasExactKeys(record, SETTLEMENT_CLAIM_KEYS)
    || record.schemaVersion !== 1
    || record.operationId !== operationId
    || record.settlementSha256 !== settlementSha256
    || record.state !== 'BILLING_SETTLEMENT_CLAIMED'
    || typeof record.finalizationAdapterRevision !== 'string'
    || !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(record.finalizationAdapterRevision)
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFLICT',
      'Sandbox billing Operation ID already has a different settlement claim',
    );
  }
  return record.finalizationAdapterRevision;
}

function assertProviderBillingEntryClaim(
  record: Record<string, unknown>,
  expected: {
    providerBillingEntryKey: string;
    providerAccountRefSha256: string;
    operationId: string;
    settlementSha256: string;
    requestFingerprint: string;
    submitReportSha256: string;
    providerTokenLogSnapshotSha256: string;
  },
) {
  if (
    !hasExactKeys(record, PROVIDER_BILLING_ENTRY_CLAIM_KEYS)
    || record.schemaVersion !== 1
    || record.providerBillingEntryKey !== expected.providerBillingEntryKey
    || record.providerAccountRefSha256 !== expected.providerAccountRefSha256
    || record.operationId !== expected.operationId
    || record.settlementSha256 !== expected.settlementSha256
    || record.requestFingerprint !== expected.requestFingerprint
    || record.submitReportSha256 !== expected.submitReportSha256
    || record.providerTokenLogSnapshotSha256 !== expected.providerTokenLogSnapshotSha256
    || record.state !== 'PROVIDER_BILLING_ENTRY_CLAIMED'
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFLICT',
      'Provider billing entry is already claimed by different sandbox evidence',
    );
  }
}

export async function finalizeAiImageSandboxBillingSettlement(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  operationId: string;
  settlementPath: string;
  settlementSha256: string;
  finalizationAdapterRevision: string;
  now?: Date;
}) {
  const operationId = String(input.operationId || '').trim();
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing Operation ID is invalid',
    );
  }
  const finalizationAdapterRevision = String(input.finalizationAdapterRevision || '')
    .trim()
    .toLowerCase();
  if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(finalizationAdapterRevision)) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing finalizer revision must be a full Git object ID',
    );
  }
  const now = input.now || new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_CONFIG_INVALID',
      'Sandbox billing clock is invalid',
    );
  }
  const evidenceRoot = await resolvePrivateEvidenceRoot(input.repositoryRoot, input.evidenceRoot);
  const attestationEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: input.repositoryRoot,
    path: input.settlementPath,
    expectedSha256: input.settlementSha256,
    maxBytes: MAX_ATTESTATION_BYTES,
    kind: 'attestation',
  });
  const attestation = parseAttestation(attestationEvidence.record, now);
  if (attestation.operationId !== operationId) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing attestation does not match the Operation ID',
    );
  }
  const preCallSnapshotEvidence = attestation.schemaVersion === 4
    ? null
    : await loadPrivateFile({
        repositoryRoot: input.repositoryRoot,
        path: attestation.preCallBillingSnapshotPath!,
        expectedSha256: attestation.preCallBillingSnapshotSha256!,
        maxBytes: MAX_BILLING_SNAPSHOT_BYTES,
      });
  const settledSnapshotEvidence = await loadPrivateFile({
    repositoryRoot: input.repositoryRoot,
    path: attestation.settledBillingSnapshotPath,
    expectedSha256: attestation.settledBillingSnapshotSha256,
    maxBytes: MAX_BILLING_SNAPSHOT_BYTES,
  });
  const snapshotIdentityAvailable = hasStableFileIdentity(
    settledSnapshotEvidence.device,
    settledSnapshotEvidence.inode,
  ) && (preCallSnapshotEvidence === null || hasStableFileIdentity(
    preCallSnapshotEvidence.device,
    preCallSnapshotEvidence.inode,
  ));
  const sameSnapshotPath = preCallSnapshotEvidence !== null && samePath(
    preCallSnapshotEvidence.canonicalPath,
    settledSnapshotEvidence.canonicalPath,
  );
  const sameSnapshotFile = preCallSnapshotEvidence !== null
    && sameFileIdentity(preCallSnapshotEvidence, settledSnapshotEvidence);
  if (!snapshotIdentityAvailable || sameSnapshotPath || sameSnapshotFile) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_ATTESTATION_INVALID',
      'Sandbox billing snapshots must have stable, distinct private file identities',
    );
  }

  const intentPath = resolve(evidenceRoot, 'intents', `${operationId}.intent.json`);
  const reportPath = resolve(evidenceRoot, `${operationId}.report.json`);
  const intentEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: evidenceRoot,
    path: intentPath,
    expectedSha256: attestation.intentSha256,
    maxBytes: MAX_INTENT_BYTES,
    kind: 'evidence',
    allowedRoot: evidenceRoot,
  });
  const reportEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: evidenceRoot,
    path: reportPath,
    expectedSha256: attestation.submitReportSha256,
    maxBytes: MAX_REPORT_BYTES,
    kind: 'evidence',
    allowedRoot: evidenceRoot,
  });
  const intent = parseIntent(intentEvidence.record, operationId);
  const report = parseReport(reportEvidence.record, operationId);
  const fingerprintPath = resolve(
    evidenceRoot,
    'intents',
    '.fingerprints',
    `${intent.record.requestFingerprint}.claim.json`,
  );
  const claimEvidence = await loadPrivateCanonicalJson({
    repositoryRoot: evidenceRoot,
    path: fingerprintPath,
    expectedSha256: attestation.fingerprintClaimSha256,
    maxBytes: MAX_CLAIM_BYTES,
    kind: 'evidence',
    allowedRoot: evidenceRoot,
  });
  if (
    intentEvidence.sha256 !== attestation.intentSha256
    || reportEvidence.sha256 !== attestation.submitReportSha256
    || claimEvidence.sha256 !== attestation.fingerprintClaimSha256
  ) {
    throw new AiImageSandboxBillingSettlementError(
      'SANDBOX_BILLING_MISMATCH',
      'Sandbox billing evidence digests do not match the attestation',
    );
  }
  let providerTokenLogEvidence: PrivateJsonEvidence | null = null;
  let providerTokenLog: ReturnType<typeof parseProviderTokenLogSnapshot> | null = null;
  let providerBillingEntryKey: string | null = null;
  if (attestation.schemaVersion === 3 || attestation.schemaVersion === 5) {
    providerTokenLogEvidence = await loadPrivateCanonicalJson({
      repositoryRoot: evidenceRoot,
      path: attestation.providerTokenLogSnapshotPath!,
      expectedSha256: attestation.providerTokenLogSnapshotSha256!,
      maxBytes: MAX_BILLING_SNAPSHOT_BYTES,
      kind: 'evidence',
      allowedRoot: evidenceRoot,
    });
    const providerIdentityAvailable = hasStableFileIdentity(
      providerTokenLogEvidence.device,
      providerTokenLogEvidence.inode,
    );
    if (
      !providerIdentityAvailable
      || samePath(
        providerTokenLogEvidence.canonicalPath,
        preCallSnapshotEvidence!.canonicalPath,
      )
      || samePath(
        providerTokenLogEvidence.canonicalPath,
        settledSnapshotEvidence.canonicalPath,
      )
      || sameFileIdentity(providerTokenLogEvidence, preCallSnapshotEvidence!)
      || sameFileIdentity(providerTokenLogEvidence, settledSnapshotEvidence)
    ) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_ATTESTATION_INVALID',
        'Sandbox Provider token-log snapshot must be one distinct private file',
      );
    }
    providerTokenLog = parseProviderTokenLogSnapshot({
      record: providerTokenLogEvidence.record,
      now,
      attestation,
      intent,
      report,
    });
    providerBillingEntryKey = sha256(canonicalJson({
      apiBaseSha256: intent.record.apiBaseSha256,
      providerTokenLogUserId: providerTokenLog.userId,
      providerTokenLogTokenId: providerTokenLog.tokenId,
      providerBillingEntryRequestIdHash: providerTokenLog.requestIdHash,
    }));
  }
  assertArtifactsMatch({ attestation, intent, report, claim: claimEvidence.record });
  if (attestation.schemaVersion === 4) {
    parseSub2CumulativeUsageSnapshot(
      settledSnapshotEvidence,
      attestation,
    );
  }

  let consoleUserConfirmedAt: string | null = null;
  if (attestation.schemaVersion === 5) {
    const consoleBill = attestation.consoleBillEvidence!;
    const screenshot = await loadPrivateFile({
      repositoryRoot: evidenceRoot,
      path: consoleBill.screenshotPath,
      expectedSha256: consoleBill.screenshotSha256,
      maxBytes: MAX_BILLING_SNAPSHOT_BYTES,
      allowedRoot: evidenceRoot,
    });
    const confirmation = await loadPrivateCanonicalJson({
      repositoryRoot: evidenceRoot,
      path: consoleBill.userConfirmationPath,
      expectedSha256: consoleBill.userConfirmationSha256,
      maxBytes: MAX_ATTESTATION_BYTES,
      kind: 'evidence',
      allowedRoot: evidenceRoot,
    });
    const files = [preCallSnapshotEvidence!, settledSnapshotEvidence, providerTokenLogEvidence!, screenshot, confirmation];
    for (let index = 0; index < files.length; index += 1) {
      if (!hasStableFileIdentity(files[index]!.device, files[index]!.inode)
        || files.slice(0, index).some((other) => (
          samePath(other.canonicalPath, files[index]!.canonicalPath)
          || sameFileIdentity(other, files[index]!)
        ))) {
        throw new AiImageSandboxBillingSettlementError('SANDBOX_BILLING_ATTESTATION_INVALID', 'Console evidence must use distinct private files');
      }
    }
    const isPng = screenshot.bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const isJpeg = screenshot.bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if ((!isPng && !isJpeg) || screenshot.bytes.length < 32) {
      throw new AiImageSandboxBillingSettlementError('SANDBOX_BILLING_ATTESTATION_INVALID', 'Console screenshot must be bounded PNG or JPEG bytes');
    }
    const reviewed = confirmation.record;
    if (!hasExactKeys(reviewed, USER_BILLING_CONFIRMATION_KEYS)
      || reviewed.schemaVersion !== 1 || reviewed.kind !== 'AI_IMAGE_SANDBOX_USER_BILLING_CONFIRMATION'
      || reviewed.statement !== 'I_CONFIRM_THIS_REQUEST_BILL_AND_ACCOUNT_CREDIT_CASH_VALUE') {
      throw new AiImageSandboxBillingSettlementError('SANDBOX_BILLING_ATTESTATION_INVALID', 'User billing confirmation is invalid');
    }
    const confirmedAt = canonicalTimestamp(reviewed, 'confirmedAt', 'SANDBOX_BILLING_ATTESTATION_INVALID');
    if (reviewed.operationId !== operationId
      || reviewed.reconcilerRef !== attestation.reconcilerRef
      || reviewed.providerAccountRef !== attestation.providerAccountRef
      || reviewed.billingRequestIdSha256 !== providerTokenLog!.requestIdHash
      || reviewed.screenshotSha256 !== screenshot.sha256
      || reviewed.displayedCurrency !== consoleBill.displayedCurrency
      || canonicalJson(reviewed.displayedCharge) !== canonicalJson(consoleBill.displayedCharge)
      || canonicalJson(reviewed.cashCost) !== canonicalJson(attestation.actualCost)
      || canonicalJson(reviewed.cashUnitsPerDisplayedUnit) !== canonicalJson(consoleBill.cashUnitsPerDisplayedUnit)
      || confirmedAt.time < report.completedAt.time
      || confirmedAt.time > attestation.settledObservedAt.time
      || confirmedAt.time > now.getTime() + MAX_CLOCK_SKEW_MS) {
      throw new AiImageSandboxBillingSettlementError('SANDBOX_BILLING_MISMATCH', 'User console confirmation does not bind this request and account unit');
    }
    consoleUserConfirmedAt = confirmedAt.value;
  }

  const billedUnits = attestation.billingOutcome === 'CHARGED' ? 1 : 0;
  const accountUnitBasisMismatch = attestation.schemaVersion === 5
    && attestation.actualCost!.currency !== intent.maximumCost.currency;
  const billingGate = accountUnitBasisMismatch
    ? 'COST_BASIS_MISMATCH'
    : attestation.generation === 'EXACT'
    ? BigInt(attestation.actualCost!.amount) > BigInt(intent.maximumCost.amount)
      ? 'COST_LIMIT_EXCEEDED'
      : 'PASS'
    : Number(attestation.actualCostCents) > Number(intent.maximumCostCents)
      ? 'COST_LIMIT_EXCEEDED'
      : 'PASS';
  const billingDirectory = resolve(evidenceRoot, 'billing');
  const claimDirectory = resolve(billingDirectory, '.claims');
  const settlementClaimPath = resolve(claimDirectory, `${operationId}.billing.claim.json`);
  const receiptPath = resolve(billingDirectory, `${operationId}.billing.settlement.json`);
  if (attestation.schemaVersion === 3 || attestation.schemaVersion === 5) {
    const providerEntryClaimDirectory = resolve(billingDirectory, '.provider-entries');
    const providerEntryClaimPath = resolve(
      providerEntryClaimDirectory,
      `${providerBillingEntryKey}.claim.json`,
    );
    const providerEntryClaim = {
      schemaVersion: 1,
      providerBillingEntryKey: providerBillingEntryKey!,
      providerAccountRefSha256: sha256(attestation.providerAccountRef),
      operationId,
      settlementSha256: attestationEvidence.sha256,
      requestFingerprint: attestation.requestFingerprint,
      submitReportSha256: reportEvidence.sha256,
      providerTokenLogSnapshotSha256: providerTokenLogEvidence!.sha256,
      state: 'PROVIDER_BILLING_ENTRY_CLAIMED',
    };
    const providerEntryClaimBytes = Buffer.from(
      `${JSON.stringify(providerEntryClaim, null, 2)}\n`,
      'utf8',
    );
    try {
      await writeExclusiveAtomicFile(
        providerEntryClaimPath,
        providerEntryClaimBytes,
        evidenceRoot,
      );
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const existingProviderEntryClaim = await loadPrivateCanonicalJson({
        repositoryRoot: evidenceRoot,
        path: providerEntryClaimPath,
        maxBytes: MAX_CLAIM_BYTES,
        kind: 'evidence',
        allowedRoot: evidenceRoot,
      });
      assertProviderBillingEntryClaim(existingProviderEntryClaim.record, providerEntryClaim);
    }
  }
  const settlementClaim = {
    schemaVersion: 1,
    operationId,
    settlementSha256: attestationEvidence.sha256,
    finalizationAdapterRevision,
    state: 'BILLING_SETTLEMENT_CLAIMED',
  };
  const settlementClaimBytes = Buffer.from(`${JSON.stringify(settlementClaim, null, 2)}\n`, 'utf8');
  let claimReplayed = false;
  let receiptFinalizationRevision = finalizationAdapterRevision;
  try {
    await writeExclusiveAtomicFile(settlementClaimPath, settlementClaimBytes, evidenceRoot);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const existingClaim = await loadPrivateCanonicalJson({
      repositoryRoot: evidenceRoot,
      path: settlementClaimPath,
      maxBytes: MAX_CLAIM_BYTES,
      kind: 'evidence',
      allowedRoot: evidenceRoot,
    });
    receiptFinalizationRevision = parseSettlementClaim(
      existingClaim.record,
      operationId,
      attestationEvidence.sha256,
    );
    claimReplayed = true;
  }
  const endpointEvidence = report.schemaVersion === 4 || report.schemaVersion === 5
    ? {
        apiBaseSha256: report.apiBaseSha256,
        operationEndpointSha256: report.operationEndpointSha256,
      }
    : { endpointSha256: intent.record.endpointSha256 };
  const receipt = attestation.generation === 'EXACT'
    ? {
        schemaVersion: attestation.schemaVersion === 5
          ? 6
          : attestation.schemaVersion === 4
          ? 5
          : attestation.schemaVersion === 3
            ? 4
            : 3,
        event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
        operationId,
        settlementId: attestation.settlementId,
        settlementSha256: attestationEvidence.sha256,
        intentSha256: intentEvidence.sha256,
        submitReportSha256: reportEvidence.sha256,
        fingerprintClaimSha256: claimEvidence.sha256,
        requestFingerprint: attestation.requestFingerprint,
        submitState: report.record.state,
        providerOutcomeResolved: report.record.state !== 'RECONCILIATION_REQUIRED',
        sameRequestRetryAllowed: false,
        ...endpointEvidence,
        modelSha256: sha256(intent.model),
        operation: intent.request.operation,
        requestProfile: intent.request.requestProfile,
        promptSha256: intent.request.promptSha256,
        sourceSha256: intent.request.sourceSha256,
        maskSha256: intent.request.maskSha256,
        approvalId: attestation.approvalId,
        approvalSha256: attestation.approvalSha256,
        submissionAdapterRevision: intent.record.adapterRevision,
        finalizationAdapterRevision: receiptFinalizationRevision,
        correlationMethod: attestation.correlationMethod,
        providerRequestIdHash: report.record.providerRequestIdHash,
        ...(attestation.schemaVersion === 3 || attestation.schemaVersion === 5 ? {
          providerBillingEntryRequestIdHash: providerTokenLog!.requestIdHash,
          providerBillingEntryKey: providerBillingEntryKey!,
          providerRequestIdBridge: providerTokenLog!.requestIdBridge,
          providerTokenLogAccountSha256: sha256(canonicalJson({
            userId: providerTokenLog!.userId,
            tokenId: providerTokenLog!.tokenId,
          })),
          providerTokenLogSnapshotSha256: providerTokenLogEvidence!.sha256,
        } : {}),
        ...(attestation.schemaVersion === 4 ? {
          cumulativeUsageEvidenceKind: attestation.cumulativeUsageEvidence!.kind,
        } : {}),
        ...(attestation.schemaVersion === 5 ? {
          consoleBillEvidenceKind: attestation.consoleBillEvidence!.kind,
          providerDisplayedCurrency: attestation.consoleBillEvidence!.displayedCurrency,
          providerDisplayedCharge: attestation.consoleBillEvidence!.displayedCharge,
          cashUnitsPerDisplayedUnit: attestation.consoleBillEvidence!.cashUnitsPerDisplayedUnit,
          consoleScreenshotSha256: attestation.consoleBillEvidence!.screenshotSha256,
          userConfirmationSha256: attestation.consoleBillEvidence!.userConfirmationSha256,
          userConfirmedAt: consoleUserConfirmedAt!,
          aggregateMeterRole: 'OBSERVATION_ONLY_NOT_CHARGE_EVIDENCE',
          originalBudgetCurrencyMatchesCashCost: !accountUnitBasisMismatch,
          displayedChargeExceedsOriginalNumericMaximum: compareAiImageSandboxDecimals(
            attestation.consoleBillEvidence!.displayedCharge,
            { amount: intent.maximumCost.amount, scale: intent.maximumCost.scale },
          ) > 0,
        } : {}),
        billingOutcome: attestation.billingOutcome,
        billingGate,
        actualCost: attestation.actualCost!,
        billedUnits,
        quotedCost: intent.quotedCost,
        maximumCost: intent.maximumCost,
        preCallObservedAt: attestation.preCallObservedAt.value,
        settledObservedAt: attestation.settledObservedAt.value,
        reconcilerRefSha256: sha256(attestation.reconcilerRef),
        providerAccountRefSha256: sha256(attestation.providerAccountRef),
        pricingRevisionSha256: sha256(attestation.pricingRevision),
        preCallBillingSnapshotRefSha256: sha256(attestation.preCallBillingSnapshotRef),
        billingReconciliationRefSha256: sha256(attestation.billingReconciliationRef),
        providerBillingEntryRefSha256: sha256(attestation.providerBillingEntryRef),
        ...(preCallSnapshotEvidence ? {
          preCallBillingSnapshotSha256: preCallSnapshotEvidence.sha256,
        } : {}),
        settledBillingSnapshotSha256: settledSnapshotEvidence.sha256,
      }
    : {
        schemaVersion: report.schemaVersion === 4 ? 2 : 1,
        event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
        operationId,
        settlementId: attestation.settlementId,
        settlementSha256: attestationEvidence.sha256,
        intentSha256: intentEvidence.sha256,
        submitReportSha256: reportEvidence.sha256,
        fingerprintClaimSha256: claimEvidence.sha256,
        requestFingerprint: attestation.requestFingerprint,
        submitState: report.record.state,
        providerOutcomeResolved: report.record.state !== 'RECONCILIATION_REQUIRED',
        sameRequestRetryAllowed: false,
        ...endpointEvidence,
        modelSha256: sha256(intent.model),
        operation: intent.request.operation,
        requestProfile: intent.request.requestProfile,
        promptSha256: intent.request.promptSha256,
        sourceSha256: intent.request.sourceSha256,
        maskSha256: intent.request.maskSha256,
        approvalId: attestation.approvalId,
        approvalSha256: attestation.approvalSha256,
        submissionAdapterRevision: intent.record.adapterRevision,
        finalizationAdapterRevision: receiptFinalizationRevision,
        correlationMethod: attestation.correlationMethod,
        providerRequestIdHash: report.record.providerRequestIdHash,
        currency: attestation.currency,
        billingOutcome: attestation.billingOutcome,
        billingGate,
        actualCostCents: attestation.actualCostCents!,
        billedUnits,
        quotedCostCents: intent.quotedCostCents!,
        maximumCostCents: intent.maximumCostCents!,
        preCallObservedAt: attestation.preCallObservedAt.value,
        settledObservedAt: attestation.settledObservedAt.value,
        reconcilerRefSha256: sha256(attestation.reconcilerRef),
        providerAccountRefSha256: sha256(attestation.providerAccountRef),
        pricingRevisionSha256: sha256(attestation.pricingRevision),
        preCallBillingSnapshotRefSha256: sha256(attestation.preCallBillingSnapshotRef),
        billingReconciliationRefSha256: sha256(attestation.billingReconciliationRef),
        providerBillingEntryRefSha256: sha256(attestation.providerBillingEntryRef),
        preCallBillingSnapshotSha256: preCallSnapshotEvidence!.sha256,
        settledBillingSnapshotSha256: settledSnapshotEvidence.sha256,
      };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  if (claimReplayed && receiptFinalizationRevision !== finalizationAdapterRevision) {
    const receiptReplayed = await readExactPrivateFile(
      receiptPath,
      receiptBytes,
      MAX_REPORT_BYTES,
      evidenceRoot,
    );
    if (!receiptReplayed) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_CONFLICT',
        'An incomplete billing claim must be recovered by its original finalizer revision',
      );
    }
    return { receipt, receiptPath, replayed: true };
  }
  try {
    await writeExclusiveAtomicFile(receiptPath, receiptBytes, evidenceRoot);
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const receiptReplayed = await readExactPrivateFile(
      receiptPath,
      receiptBytes,
      MAX_REPORT_BYTES,
      evidenceRoot,
    );
    if (!receiptReplayed) {
      throw new AiImageSandboxBillingSettlementError(
        'SANDBOX_BILLING_CONFLICT',
        'Sandbox billing Operation ID already has a different settlement record',
      );
    }
  }
  return {
    receipt,
    receiptPath,
    replayed: claimReplayed,
  };
}
