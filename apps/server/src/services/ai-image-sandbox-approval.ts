import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  AI_IMAGE_SANDBOX_MAX_COST_MAJOR_UNITS,
  AiImageSandboxMoneyError,
  type AiImageSandboxMoney,
  aiImageSandboxMoneyEquals,
  assertAiImageSandboxMoneyMajorUnitLimit,
  assertAiImageSandboxMoneyPair,
  parseAiImageSandboxMoney,
} from './ai-image-sandbox-money.js';
import {
  AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE,
  AI_IMAGE_WANX21_EDIT_MODEL,
  AI_IMAGE_WANX21_EDIT_SUBMIT_PATH,
  AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE,
  AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE,
} from './ai-image-wanx-edit-profile.js';

export const AI_IMAGE_SANDBOX_APPROVAL_STATEMENT =
  'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST';

const MAX_APPROVAL_BYTES = 32 * 1024;
const MAX_APPROVAL_VALIDITY_MS = 60 * 60 * 1000;
const MAX_APPROVAL_CLOCK_SKEW_MS = 5 * 60 * 1000;
const APPROVAL_COMMON_KEYS = [
  'schemaVersion',
  'approvalId',
  'statement',
  'approvedAt',
  'expiresAt',
  'approverRef',
  'providerAccountRef',
  'pricingRevision',
  'preCallBillingSnapshotRef',
  'billingReconciliationRef',
  'requestCount',
  'operationId',
  'endpoint',
  'expectedHost',
  'model',
  'operation',
  'requestProfile',
  'credentialRevision',
  'adapterRevision',
  'sourceSha256',
  'maskSha256',
] as const;
const APPROVAL_V2_KEYS = new Set([
  ...APPROVAL_COMMON_KEYS,
  'currency',
  'quotedCostCents',
  'maximumCostCents',
]);
const APPROVAL_V3_KEYS = new Set([
  ...APPROVAL_COMMON_KEYS,
  'quotedCost',
  'maximumCost',
]);
const APPROVAL_V4_KEYS = new Set([...APPROVAL_V3_KEYS, 'trialBinding']);
const TRIAL_BINDING_DIGEST_KEYS = [
  'manifestSha256',
  'evidenceRootSha256',
  'providerAccountUidSha256',
  'requestFingerprint',
  'frozenPromptSha256',
] as const;
const TRIAL_BINDING_KEYS = new Set(['roundId', ...TRIAL_BINDING_DIGEST_KEYS]);

type AiImageSandboxApprovalOperation =
  | 'TEXT_TO_IMAGE'
  | 'IMAGE_TO_IMAGE'
  | 'FULL_EDIT'
  | 'INPAINT';

export interface AiImageSandboxTrialBinding {
  roundId: string;
  manifestSha256: string;
  evidenceRootSha256: string;
  providerAccountUidSha256: string;
  requestFingerprint: string;
  frozenPromptSha256: string;
}

interface AiImageSandboxApprovalExpectedRequestBase {
  operationId: string;
  endpoint: string;
  expectedHost: string;
  model: string;
  operation: AiImageSandboxApprovalOperation;
  requestProfile: string;
  credentialRevision: string;
  adapterRevision: string;
  sourceSha256: string[];
  maskSha256: string | null;
  trialBinding?: AiImageSandboxTrialBinding;
}

type AiImageSandboxApprovalExpectedMoney =
  | {
      quotedCost: AiImageSandboxMoney;
      maximumCost: AiImageSandboxMoney;
      quotedCostCents?: never;
      maximumCostCents?: never;
    }
  | {
      quotedCost?: never;
      maximumCost?: never;
      quotedCostCents: number;
      maximumCostCents: number;
    };

export type AiImageSandboxApprovalExpectedRequest =
  AiImageSandboxApprovalExpectedRequestBase & AiImageSandboxApprovalExpectedMoney;

export interface AiImageSandboxApprovalEvidence {
  approvalId: string;
  approvalSha256: string;
  approvedAt: string;
  expiresAt: string;
  approverRefSha256: string;
  providerAccountRefSha256: string;
  pricingRevisionSha256: string;
  currency: string;
  preCallBillingSnapshotRefSha256: string;
  billingReconciliationRefSha256: string;
}

export class AiImageSandboxApprovalError extends Error {
  constructor(
    public readonly code:
      | 'SANDBOX_APPROVAL_CONFIG_INVALID'
      | 'SANDBOX_APPROVAL_FILE_UNSAFE'
      | 'SANDBOX_APPROVAL_DIGEST_MISMATCH'
      | 'SANDBOX_APPROVAL_SCHEMA_INVALID'
      | 'SANDBOX_APPROVAL_MISMATCH'
      | 'SANDBOX_APPROVAL_EXPIRED'
      | 'SANDBOX_APPROVAL_NOT_YET_VALID',
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSandboxApprovalError';
  }
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, maxLength = 200) {
  const value = typeof record[key] === 'string' ? record[key].trim() : '';
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!value || value.length > maxLength || hasControlCharacter) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      `Sandbox approval ${key} is invalid`,
    );
  }
  return value;
}

function requiredPositiveInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      `Sandbox approval ${key} must be a positive integer`,
    );
  }
  return Number(value);
}

function approvalMoney(value: unknown, field: string) {
  try {
    return parseAiImageSandboxMoney(value, field);
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw new AiImageSandboxApprovalError('SANDBOX_APPROVAL_SCHEMA_INVALID', error.message);
    }
    throw error;
  }
}

function approvalMoneyPair(
  quotedCost: AiImageSandboxMoney,
  maximumCost: AiImageSandboxMoney,
  options: { requireCanonicalSharedScale?: boolean } = {},
) {
  try {
    assertAiImageSandboxMoneyPair(quotedCost, maximumCost, options);
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw new AiImageSandboxApprovalError('SANDBOX_APPROVAL_SCHEMA_INVALID', error.message);
    }
    throw error;
  }
}

function approvalMoneyLimit(maximumCost: AiImageSandboxMoney) {
  try {
    assertAiImageSandboxMoneyMajorUnitLimit(
      maximumCost,
      AI_IMAGE_SANDBOX_MAX_COST_MAJOR_UNITS,
    );
  } catch (error) {
    if (error instanceof AiImageSandboxMoneyError) {
      throw new AiImageSandboxApprovalError('SANDBOX_APPROVAL_SCHEMA_INVALID', error.message);
    }
    throw error;
  }
}

function expectedMoneyPair(
  expected: AiImageSandboxApprovalExpectedRequest,
  schemaVersion: 2 | 3 | 4,
  legacyCurrency: string,
) {
  if (expected.quotedCost && expected.maximumCost) {
    if (schemaVersion === 2) mismatch();
    const quotedCost = approvalMoney(expected.quotedCost, 'Expected sandbox quoted cost');
    const maximumCost = approvalMoney(expected.maximumCost, 'Expected sandbox maximum cost');
    approvalMoneyPair(quotedCost, maximumCost, {
      requireCanonicalSharedScale: true,
    });
    return { quotedCost, maximumCost };
  }
  if (
    schemaVersion !== 2
    || !Number.isSafeInteger(expected.quotedCostCents)
    || Number(expected.quotedCostCents) <= 0
    || !Number.isSafeInteger(expected.maximumCostCents)
    || Number(expected.maximumCostCents) <= 0
  ) mismatch();
  const quotedCost = approvalMoney({
    currency: legacyCurrency,
    amount: expected.quotedCostCents,
    scale: 2,
  }, 'Expected legacy sandbox quoted cost');
  const maximumCost = approvalMoney({
    currency: legacyCurrency,
    amount: expected.maximumCostCents,
    scale: 2,
  }, 'Expected legacy sandbox maximum cost');
  approvalMoneyPair(quotedCost, maximumCost, { requireCanonicalSharedScale: false });
  return { quotedCost, maximumCost };
}

function requiredSha256Array(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value) || value.length > 1 || value.some((entry) => (
    typeof entry !== 'string' || !/^[a-f0-9]{64}$/u.test(entry)
  ))) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      `Sandbox approval ${key} is invalid`,
    );
  }
  return [...value] as string[];
}

function equalStringArrays(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mismatch() {
  throw new AiImageSandboxApprovalError(
    'SANDBOX_APPROVAL_MISMATCH',
    'Sandbox approval does not match the exact paid request',
  );
}

function checkedTrialBinding(value: unknown): AiImageSandboxTrialBinding {
  if (
    !isRecord(value)
    || Object.keys(value).length !== TRIAL_BINDING_KEYS.size
    || Object.keys(value).some((key) => !TRIAL_BINDING_KEYS.has(key))
    || typeof value.roundId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(value.roundId)
    || TRIAL_BINDING_DIGEST_KEYS.some((key) => (
      typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(value[key])
    ))
  ) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox trial binding must contain one exact round and five lowercase SHA-256 digests',
    );
  }
  return value as unknown as AiImageSandboxTrialBinding;
}

function assertTrialApproval(
  record: Record<string, unknown>,
  expected: AiImageSandboxApprovalExpectedRequest,
  schemaVersion: 2 | 3 | 4,
) {
  const hasExpectedBinding = expected.trialBinding !== undefined;
  if (schemaVersion !== 4) {
    if (hasExpectedBinding) mismatch();
    return;
  }
  if (!hasExpectedBinding) mismatch();
  const binding = checkedTrialBinding(record.trialBinding);
  const expectedBinding = checkedTrialBinding(expected.trialBinding);
  if (binding.roundId !== expectedBinding.roundId
    || TRIAL_BINDING_DIGEST_KEYS.some((key) => binding[key] !== expectedBinding[key])) {
    mismatch();
  }
  const requestProfile = record.operation === 'FULL_EDIT'
    ? AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE
    : record.operation === 'INPAINT'
      ? AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE
      : null;
  if (
    !requestProfile
    || record.requestProfile !== requestProfile
    || record.endpoint !== `${AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE}${AI_IMAGE_WANX21_EDIT_SUBMIT_PATH}`
    || record.expectedHost !== 'dashscope.aliyuncs.com'
    || record.model !== AI_IMAGE_WANX21_EDIT_MODEL
    || !Array.isArray(record.sourceSha256)
    || record.sourceSha256.length !== 1
    || (record.operation === 'INPAINT'
      ? typeof record.maskSha256 !== 'string'
      : record.maskSha256 !== null)
  ) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox trial approval requires one exact standard Beijing Wanx full-edit or inpaint request',
    );
  }
}

function canonicalApprovalTimestamp(value: string, field: 'timestamp' | 'expiry') {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      `Sandbox approval ${field} must be canonical ISO-8601`,
    );
  }
  return parsed;
}

export function assertAiImageSandboxApprovalCurrent(
  approval: Pick<AiImageSandboxApprovalEvidence, 'approvedAt' | 'expiresAt'>,
  now = new Date(),
) {
  const approvedAtTime = canonicalApprovalTimestamp(approval.approvedAt, 'timestamp');
  const expiresAtTime = canonicalApprovalTimestamp(approval.expiresAt, 'expiry');
  if (
    expiresAtTime <= approvedAtTime
    || expiresAtTime - approvedAtTime > MAX_APPROVAL_VALIDITY_MS
  ) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval validity window must be positive and no longer than 60 minutes',
    );
  }
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_CONFIG_INVALID',
      'Sandbox approval clock is invalid',
    );
  }
  if (approvedAtTime > nowTime + MAX_APPROVAL_CLOCK_SKEW_MS) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_NOT_YET_VALID',
      'Sandbox approval is not valid yet',
    );
  }
  if (expiresAtTime <= nowTime) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_EXPIRED',
      'Sandbox approval has expired',
    );
  }
}

export async function loadAiImageSandboxApproval(input: {
  repositoryRoot: string;
  approvalPath: string;
  expectedSha256: string;
  expected: AiImageSandboxApprovalExpectedRequest;
  now?: Date;
}): Promise<AiImageSandboxApprovalEvidence> {
  const expectedSha256 = String(input.expectedSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_CONFIG_INVALID',
      'Sandbox approval digest must be a lowercase SHA-256 value',
    );
  }
  const approvalPath = String(input.approvalPath || '').trim();
  if (!approvalPath) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_CONFIG_INVALID',
      'Sandbox approval path is required',
    );
  }

  const handle = await open(
    resolve(input.repositoryRoot, approvalPath),
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
  );
  let bytes: Buffer;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_APPROVAL_BYTES) {
      throw new AiImageSandboxApprovalError(
        'SANDBOX_APPROVAL_FILE_UNSAFE',
        'Sandbox approval must be a bounded regular file',
      );
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new AiImageSandboxApprovalError(
        'SANDBOX_APPROVAL_FILE_UNSAFE',
        'Sandbox approval must not be readable or writable by group or other users',
      );
    }
    const boundedBytes = Buffer.allocUnsafe(MAX_APPROVAL_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < boundedBytes.byteLength) {
      const result = await handle.read(
        boundedBytes,
        bytesRead,
        boundedBytes.byteLength - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    bytes = boundedBytes.subarray(0, bytesRead);
    if (bytesRead !== metadata.size || bytesRead > MAX_APPROVAL_BYTES) {
      throw new AiImageSandboxApprovalError(
        'SANDBOX_APPROVAL_FILE_UNSAFE',
        'Sandbox approval changed while it was being read',
      );
    }
  } finally {
    await handle.close();
  }

  const approvalSha256 = sha256(bytes);
  if (approvalSha256 !== expectedSha256) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_DIGEST_MISMATCH',
      'Sandbox approval file does not match its reviewed digest',
    );
  }

  let approvalText = '';
  let record: Record<string, unknown>;
  try {
    approvalText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(approvalText) as unknown;
    if (!isRecord(parsed)) throw new Error('invalid');
    record = parsed;
  } catch {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval must contain one JSON object',
    );
  }
  if (approvalText.replace(/\r\n/gu, '\n') !== `${JSON.stringify(record, null, 2)}\n`) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval must use canonical JSON without duplicate keys',
    );
  }
  const schemaVersion = record.schemaVersion;
  if ((schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4) || record.requestCount !== 1) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval schema or request count is invalid',
    );
  }
  const approvalKeys = schemaVersion === 2 ? APPROVAL_V2_KEYS
    : schemaVersion === 3 ? APPROVAL_V3_KEYS : APPROVAL_V4_KEYS;
  const keys = Object.keys(record);
  if (keys.length !== approvalKeys.size || keys.some((key) => !approvalKeys.has(key))) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval contains missing or unsupported fields',
    );
  }
  assertTrialApproval(record, input.expected, schemaVersion);

  const approvalId = requiredString(record, 'approvalId', 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u.test(approvalId)) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval ID is invalid',
    );
  }
  if (requiredString(record, 'statement', 80) !== AI_IMAGE_SANDBOX_APPROVAL_STATEMENT) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval statement is invalid',
    );
  }
  const approvedAt = requiredString(record, 'approvedAt', 40);
  const expiresAt = requiredString(record, 'expiresAt', 40);
  assertAiImageSandboxApprovalCurrent({ approvedAt, expiresAt }, input.now);
  const approverRef = requiredString(record, 'approverRef', 128);
  const providerAccountRef = requiredString(record, 'providerAccountRef', 160);
  const pricingRevision = requiredString(record, 'pricingRevision', 160);
  const preCallBillingSnapshotRef = requiredString(record, 'preCallBillingSnapshotRef', 200);
  const billingReconciliationRef = requiredString(record, 'billingReconciliationRef', 200);
  const sourceSha256 = requiredSha256Array(record, 'sourceSha256');
  const maskSha256 = record.maskSha256 === null
    ? null
    : typeof record.maskSha256 === 'string' && /^[a-f0-9]{64}$/u.test(record.maskSha256)
      ? record.maskSha256
      : undefined;
  if (maskSha256 === undefined) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval maskSha256 is invalid',
    );
  }
  let quotedCost: AiImageSandboxMoney;
  let maximumCost: AiImageSandboxMoney;
  let currency: string;
  if (schemaVersion === 2) {
    currency = requiredString(record, 'currency', 3).toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency) || currency !== record.currency) {
      throw new AiImageSandboxApprovalError(
        'SANDBOX_APPROVAL_SCHEMA_INVALID',
        'Sandbox approval currency must be an uppercase ISO-style code',
      );
    }
    quotedCost = approvalMoney({
      currency,
      amount: requiredPositiveInteger(record, 'quotedCostCents'),
      scale: 2,
    }, 'Legacy sandbox quoted cost');
    maximumCost = approvalMoney({
      currency,
      amount: requiredPositiveInteger(record, 'maximumCostCents'),
      scale: 2,
    }, 'Legacy sandbox maximum cost');
  } else {
    quotedCost = approvalMoney(record.quotedCost, 'Sandbox quoted cost');
    maximumCost = approvalMoney(record.maximumCost, 'Sandbox maximum cost');
    currency = quotedCost.currency;
  }
  approvalMoneyPair(quotedCost, maximumCost, {
    requireCanonicalSharedScale: schemaVersion !== 2,
  });
  approvalMoneyLimit(maximumCost);
  let endpoint = '';
  try {
    endpoint = new URL(requiredString(record, 'endpoint', 2048)).toString();
  } catch {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval endpoint is invalid',
    );
  }

  const expected = input.expected;
  const expectedCosts = expectedMoneyPair(expected, schemaVersion, currency);
  if (
    requiredString(record, 'operationId', 80) !== expected.operationId
    || endpoint !== new URL(expected.endpoint).toString()
    || requiredString(record, 'expectedHost', 253).toLowerCase() !== expected.expectedHost
    || requiredString(record, 'model', 200) !== expected.model
    || requiredString(record, 'operation', 40) !== expected.operation
    || requiredString(record, 'requestProfile', 80) !== expected.requestProfile
    || requiredString(record, 'credentialRevision', 128) !== expected.credentialRevision
    || requiredString(record, 'adapterRevision', 64).toLowerCase() !== expected.adapterRevision
    || !equalStringArrays(sourceSha256, expected.sourceSha256)
    || maskSha256 !== expected.maskSha256
    || !aiImageSandboxMoneyEquals(quotedCost, expectedCosts.quotedCost)
    || !aiImageSandboxMoneyEquals(maximumCost, expectedCosts.maximumCost)
  ) mismatch();

  return {
    approvalId,
    approvalSha256,
    approvedAt,
    expiresAt,
    approverRefSha256: sha256(approverRef),
    providerAccountRefSha256: sha256(providerAccountRef),
    pricingRevisionSha256: sha256(pricingRevision),
    currency,
    preCallBillingSnapshotRefSha256: sha256(preCallBillingSnapshotRef),
    billingReconciliationRefSha256: sha256(billingReconciliationRef),
  };
}
