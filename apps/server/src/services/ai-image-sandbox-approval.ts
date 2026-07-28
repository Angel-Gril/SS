import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

export const AI_IMAGE_SANDBOX_APPROVAL_STATEMENT =
  'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST';

const MAX_APPROVAL_BYTES = 32 * 1024;
const APPROVAL_KEYS = new Set([
  'schemaVersion',
  'approvalId',
  'statement',
  'approvedAt',
  'approverRef',
  'providerAccountRef',
  'pricingRevision',
  'currency',
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
  'quotedCostCents',
  'maximumCostCents',
]);

type AiImageSandboxApprovalOperation =
  | 'TEXT_TO_IMAGE'
  | 'IMAGE_TO_IMAGE'
  | 'FULL_EDIT'
  | 'INPAINT';

export interface AiImageSandboxApprovalExpectedRequest {
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
  quotedCostCents: number;
  maximumCostCents: number;
}

export interface AiImageSandboxApprovalEvidence {
  approvalId: string;
  approvalSha256: string;
  approvedAt: string;
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
      | 'SANDBOX_APPROVAL_MISMATCH',
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

export async function loadAiImageSandboxApproval(input: {
  repositoryRoot: string;
  approvalPath: string;
  expectedSha256: string;
  expected: AiImageSandboxApprovalExpectedRequest;
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
    bytes = await handle.readFile();
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

  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error('invalid');
    record = parsed;
  } catch {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval must contain one JSON object',
    );
  }
  const keys = Object.keys(record);
  if (keys.length !== APPROVAL_KEYS.size || keys.some((key) => !APPROVAL_KEYS.has(key))) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval contains missing or unsupported fields',
    );
  }
  if (record.schemaVersion !== 1 || record.requestCount !== 1) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval schema or request count is invalid',
    );
  }

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
  const approvedAtTime = Date.parse(approvedAt);
  if (!Number.isFinite(approvedAtTime) || new Date(approvedAtTime).toISOString() !== approvedAt) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval timestamp must be canonical ISO-8601',
    );
  }
  const approverRef = requiredString(record, 'approverRef', 128);
  const providerAccountRef = requiredString(record, 'providerAccountRef', 160);
  const pricingRevision = requiredString(record, 'pricingRevision', 160);
  const currency = requiredString(record, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency) || currency !== record.currency) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval currency must be an uppercase ISO-style code',
    );
  }
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
  const quotedCostCents = requiredPositiveInteger(record, 'quotedCostCents');
  const maximumCostCents = requiredPositiveInteger(record, 'maximumCostCents');
  if (quotedCostCents > maximumCostCents) {
    throw new AiImageSandboxApprovalError(
      'SANDBOX_APPROVAL_SCHEMA_INVALID',
      'Sandbox approval quote exceeds its maximum cost',
    );
  }
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
    || quotedCostCents !== expected.quotedCostCents
    || maximumCostCents !== expected.maximumCostCents
  ) mismatch();

  return {
    approvalId,
    approvalSha256,
    approvedAt,
    approverRefSha256: sha256(approverRef),
    providerAccountRefSha256: sha256(providerAccountRef),
    pricingRevisionSha256: sha256(pricingRevision),
    currency,
    preCallBillingSnapshotRefSha256: sha256(preCallBillingSnapshotRef),
    billingReconciliationRefSha256: sha256(billingReconciliationRef),
  };
}
