#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const MAX_JSON_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_OID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u;
const SECRET_SHAPE_PATTERN = /(?:^|[^A-Za-z0-9])(?:sk|pk)-[A-Za-z0-9_-]{12,}/iu;
const EDIT_OPERATIONS = Object.freeze(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']);
const EDIT_OPERATION_SET = new Set(EDIT_OPERATIONS);
const WANX_PROVIDER = 'dashscope-wanx21-image-edit';
const WANX_MODEL = 'wanx2.1-imageedit';
const WANX_API_BASE_SHA256 = sha256('https://dashscope.aliyuncs.com/api/v1');
const WANX_OPERATION_ENDPOINT_SHA256 = sha256(
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
);
const WANX_PROFILE_BY_OPERATION = Object.freeze({
  IMAGE_TO_IMAGE: 'DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1',
  FULL_EDIT: 'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1',
  INPAINT: 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1',
});

const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'event',
  'decision',
  'provider',
  'model',
  'apiBaseSha256',
  'inputTransport',
  'resultMode',
  'maxReferences',
  'supportsMask',
  'reviewerRefSha256',
  'reviewedAt',
  'operations',
]);
const MANIFEST_OPERATION_KEYS = new Set([
  'operation',
  'operationId',
  'reportPath',
  'reportSha256',
  'receiptPath',
  'receiptSha256',
  'outputImageSha256',
  'decision',
  'qualityChecks',
]);
const QUALITY_CHECK_KEYS = new Set([
  'operationIntentSatisfied',
  'primaryProductIdentityPreserved',
  'noUnexpectedTextLogoWatermark',
  'acceptableVisualQuality',
  'unmaskedRegionPreserved',
]);
const REPORT_KEYS = new Set([
  'schemaVersion',
  'operationId',
  'state',
  'operation',
  'requestProfile',
  'credentialRevision',
  'adapterRevision',
  'provider',
  'model',
  'apiBaseSha256',
  'operationEndpointSha256',
  'approvalEvidence',
  'promptSha256',
  'sourceSha256',
  'maskSha256',
  'requestedSize',
  'createRequests',
  'imageCount',
  'mimeType',
  'width',
  'height',
  'bytes',
  'sha256',
  'providerRequestIdHash',
  'usage',
  'startedAt',
  'completedAt',
  'elapsedMs',
  'actualCost',
  'quotedCost',
  'maximumCost',
  'intentPath',
  'imagePath',
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
const MONEY_KEYS = new Set(['currency', 'amount', 'scale']);
const RECEIPT_V3_KEYS = new Set([
  'schemaVersion',
  'event',
  'operationId',
  'settlementId',
  'settlementSha256',
  'intentSha256',
  'submitReportSha256',
  'fingerprintClaimSha256',
  'requestFingerprint',
  'submitState',
  'providerOutcomeResolved',
  'sameRequestRetryAllowed',
  'apiBaseSha256',
  'operationEndpointSha256',
  'modelSha256',
  'operation',
  'requestProfile',
  'promptSha256',
  'sourceSha256',
  'maskSha256',
  'approvalId',
  'approvalSha256',
  'submissionAdapterRevision',
  'finalizationAdapterRevision',
  'correlationMethod',
  'providerRequestIdHash',
  'billingOutcome',
  'billingGate',
  'actualCost',
  'billedUnits',
  'quotedCost',
  'maximumCost',
  'preCallObservedAt',
  'settledObservedAt',
  'reconcilerRefSha256',
  'providerAccountRefSha256',
  'pricingRevisionSha256',
  'preCallBillingSnapshotRefSha256',
  'billingReconciliationRefSha256',
  'providerBillingEntryRefSha256',
  'preCallBillingSnapshotSha256',
  'settledBillingSnapshotSha256',
]);
const RECEIPT_V4_KEYS = new Set([
  ...RECEIPT_V3_KEYS,
  'providerBillingEntryRequestIdHash',
  'providerBillingEntryKey',
  'providerRequestIdBridge',
  'providerTokenLogAccountSha256',
  'providerTokenLogSnapshotSha256',
]);

export class AiImageCapabilityCandidateError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'AiImageCapabilityCandidateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new AiImageCapabilityCandidateError(code, message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return (
    isRecord(value) &&
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isSafePublicIdentifier(value, maximumLength) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value) &&
    !value.includes('://') &&
    !SECRET_SHAPE_PATTERN.test(value)
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function manifestProviderIdentity(manifest) {
  if (
    manifest.provider === 'custom' &&
    manifest.inputTransport === 'multipart' &&
    manifest.resultMode === 'sync'
  ) {
    return {
      kind: 'CUSTOM_OPENAI_COMPATIBLE',
      reportProvider: 'custom-openai-compatible',
      requiredCurrency: null,
      operationEndpointSha256: null,
      profiles: null,
    };
  }
  if (
    manifest.provider === WANX_PROVIDER &&
    manifest.model === WANX_MODEL &&
    manifest.apiBaseSha256 === WANX_API_BASE_SHA256 &&
    manifest.inputTransport === 'base64' &&
    manifest.resultMode === 'async'
  ) {
    return {
      kind: 'DASHSCOPE_WANX21_ASYNC',
      reportProvider: WANX_PROVIDER,
      requiredCurrency: 'CNY',
      operationEndpointSha256: WANX_OPERATION_ENDPOINT_SHA256,
      profiles: WANX_PROFILE_BY_OPERATION,
    };
  }
  fail('QUALITY_REVIEW_INVALID', 'quality review Provider transport is unsupported');
}

function safeRelativePath(root, value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 240 ||
    path.isAbsolute(value)
  ) {
    fail('REVIEW_PATH_INVALID', `${label} must be a bounded relative path`);
  }
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    fail('REVIEW_PATH_INVALID', `${label} must stay inside the review bundle`);
  }
  return resolved;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function readBoundedCanonicalJson(filePath, label, allowedRoot = null) {
  const resolved = path.resolve(filePath);
  let canonicalRoot = null;
  if (allowedRoot) {
    canonicalRoot = realpathSync(allowedRoot);
    const relative = path.relative(canonicalRoot, resolved);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      fail('REVIEW_PATH_INVALID', `${label} must stay inside the review bundle`);
    }
  }
  const before = lstatSync(resolved, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size < 1n ||
    before.size > BigInt(MAX_JSON_BYTES)
  ) {
    fail('REVIEW_FILE_INVALID', `${label} must be a bounded regular file`);
  }
  if (canonicalRoot) {
    const canonicalFile = realpathSync(resolved);
    const relative = path.relative(canonicalRoot, canonicalFile);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      fail('REVIEW_PATH_INVALID', `${label} resolves outside the review bundle`);
    }
  }
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const descriptor = openSync(resolved, constants.O_RDONLY | noFollow);
  let bytes;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      fail('REVIEW_FILE_INVALID', `${label} changed while it was opened`);
    }
    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(opened, after) || BigInt(bytes.byteLength) !== opened.size) {
      fail('REVIEW_FILE_INVALID', `${label} changed while it was read`);
    }
  } finally {
    closeSync(descriptor);
  }
  const visibleAfter = lstatSync(resolved, { bigint: true });
  if (visibleAfter.isSymbolicLink() || !sameFileIdentity(before, visibleAfter)) {
    fail('REVIEW_FILE_INVALID', `${label} changed while it was reviewed`);
  }
  let text;
  let value;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    fail('REVIEW_JSON_INVALID', `${label} must contain one UTF-8 JSON value`);
  }
  if (!isRecord(value) || text.replace(/\r\n/gu, '\n') !== `${JSON.stringify(value, null, 2)}\n`) {
    fail('REVIEW_JSON_INVALID', `${label} must use canonical JSON without duplicate keys`);
  }
  return { value, bytes, sha256: sha256(bytes) };
}

function parseMoney(value, label, options = {}) {
  const minimumAmount = options.allowZero === true ? 0 : 1;
  if (
    !hasExactKeys(value, MONEY_KEYS) ||
    typeof value.currency !== 'string' ||
    !/^[A-Z]{3}$/u.test(value.currency) ||
    !Number.isSafeInteger(value.amount) ||
    value.amount < minimumAmount ||
    !Number.isInteger(value.scale) ||
    value.scale < 0 ||
    value.scale > 8
  ) {
    fail('BILLING_EVIDENCE_INVALID', `${label} is not canonical exact money`);
  }
  return value;
}

function validateMoneyPair(quotedCost, maximumCost, label) {
  if (
    quotedCost.currency !== maximumCost.currency ||
    quotedCost.scale !== maximumCost.scale ||
    (quotedCost.scale > 0 && quotedCost.amount % 10 === 0 && maximumCost.amount % 10 === 0) ||
    quotedCost.amount > maximumCost.amount
  ) {
    fail('BILLING_EVIDENCE_INVALID', `${label} is not one canonical bounded money pair`);
  }
}

function validateManifest(manifest) {
  if (
    !hasExactKeys(manifest, MANIFEST_KEYS) ||
    manifest.schemaVersion !== 1 ||
    manifest.event !== 'AI_IMAGE_PROVIDER_EDIT_CAPABILITY_QUALITY_REVIEW' ||
    manifest.decision !== 'APPROVED' ||
    !isSafePublicIdentifier(manifest.provider, 128) ||
    !isSafePublicIdentifier(manifest.model, 200) ||
    manifest.model === '*' ||
    !isSha256(manifest.apiBaseSha256) ||
    manifest.maxReferences !== 1 ||
    manifest.supportsMask !== true ||
    !isSha256(manifest.reviewerRefSha256) ||
    !isCanonicalTimestamp(manifest.reviewedAt) ||
    !Array.isArray(manifest.operations) ||
    manifest.operations.length !== EDIT_OPERATIONS.length
  ) {
    fail('QUALITY_REVIEW_INVALID', 'quality review manifest identity or decision is invalid');
  }
  const identity = manifestProviderIdentity(manifest);
  const seen = new Set();
  for (const entry of manifest.operations) {
    if (
      !hasExactKeys(entry, MANIFEST_OPERATION_KEYS) ||
      !EDIT_OPERATION_SET.has(entry.operation) ||
      seen.has(entry.operation) ||
      !OPERATION_ID_PATTERN.test(String(entry.operationId || '')) ||
      SECRET_SHAPE_PATTERN.test(entry.operationId) ||
      !isSha256(entry.reportSha256) ||
      !isSha256(entry.receiptSha256) ||
      !isSha256(entry.outputImageSha256) ||
      entry.decision !== 'APPROVED' ||
      !hasExactKeys(entry.qualityChecks, QUALITY_CHECK_KEYS)
    ) {
      fail('QUALITY_REVIEW_INVALID', 'operation quality review is incomplete or duplicated');
    }
    const checks = entry.qualityChecks;
    if (
      checks.operationIntentSatisfied !== true ||
      checks.primaryProductIdentityPreserved !== true ||
      checks.noUnexpectedTextLogoWatermark !== true ||
      checks.acceptableVisualQuality !== true ||
      (entry.operation === 'INPAINT'
        ? checks.unmaskedRegionPreserved !== true
        : checks.unmaskedRegionPreserved !== null)
    ) {
      fail(
        'QUALITY_REVIEW_INVALID',
        `${entry.operation} did not pass every required quality check`,
      );
    }
    seen.add(entry.operation);
  }
  if (EDIT_OPERATIONS.some((operation) => !seen.has(operation))) {
    fail('QUALITY_REVIEW_INVALID', 'quality review must cover each edit operation exactly once');
  }
  return identity;
}

function validateApprovalEvidence(value, report) {
  if (
    !hasExactKeys(value, APPROVAL_EVIDENCE_KEYS) ||
    !isSafePublicIdentifier(value.approvalId, 128) ||
    !isSha256(value.approvalSha256) ||
    !isCanonicalTimestamp(value.approvedAt) ||
    !isCanonicalTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(value.approvedAt) ||
    !isSha256(value.approverRefSha256) ||
    !isSha256(value.providerAccountRefSha256) ||
    !isSha256(value.pricingRevisionSha256) ||
    !isSha256(value.preCallBillingSnapshotRefSha256) ||
    !isSha256(value.billingReconciliationRefSha256) ||
    value.currency !== report.quotedCost.currency
  ) {
    fail('REPORT_SCHEMA_INVALID', 'submit report approval evidence is invalid');
  }
}

function validateReport(report, entry, manifest, identity, reportSha256) {
  if (!hasExactKeys(report, REPORT_KEYS)) {
    fail('REPORT_SCHEMA_INVALID', `${entry.operation} submit report has an unexpected schema`);
  }
  if (
    report.schemaVersion !== 5 ||
    report.state !== 'SUCCEEDED' ||
    report.operation !== entry.operation ||
    report.operationId !== entry.operationId ||
    report.provider !== identity.reportProvider ||
    report.model !== manifest.model ||
    report.apiBaseSha256 !== manifest.apiBaseSha256 ||
    !isSha256(report.operationEndpointSha256) ||
    report.operationEndpointSha256 === report.apiBaseSha256 ||
    typeof report.requestProfile !== 'string' ||
    !/^[A-Z][A-Z0-9_]{0,79}$/u.test(report.requestProfile) ||
    !isSafePublicIdentifier(report.credentialRevision, 128) ||
    !GIT_OID_PATTERN.test(String(report.adapterRevision || '')) ||
    !isSha256(report.promptSha256) ||
    !Array.isArray(report.sourceSha256) ||
    report.sourceSha256.length !== 1 ||
    !isSha256(report.sourceSha256[0]) ||
    (entry.operation === 'INPAINT' ? !isSha256(report.maskSha256) : report.maskSha256 !== null) ||
    typeof report.requestedSize !== 'string' ||
    !/^\d{1,4}x\d{1,4}$/u.test(report.requestedSize) ||
    report.createRequests !== 1 ||
    report.imageCount !== 1 ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(report.mimeType) ||
    !Number.isInteger(report.width) ||
    report.width < 1 ||
    report.width > 4096 ||
    !Number.isInteger(report.height) ||
    report.height < 1 ||
    report.height > 4096 ||
    report.requestedSize !== `${report.width}x${report.height}` ||
    !Number.isInteger(report.bytes) ||
    report.bytes < 1 ||
    report.bytes > MAX_IMAGE_BYTES ||
    !isSha256(report.sha256) ||
    report.sha256 !== entry.outputImageSha256 ||
    (report.providerRequestIdHash !== null && !isSha256(report.providerRequestIdHash)) ||
    report.usage !== null ||
    report.actualCost !== null ||
    !isCanonicalTimestamp(report.startedAt) ||
    !isCanonicalTimestamp(report.completedAt) ||
    !Number.isSafeInteger(report.elapsedMs) ||
    report.elapsedMs < 0 ||
    Date.parse(report.completedAt) - Date.parse(report.startedAt) !== report.elapsedMs ||
    Date.parse(report.startedAt) < Date.parse(report.approvalEvidence.approvedAt) ||
    Date.parse(report.startedAt) > Date.parse(report.approvalEvidence.expiresAt) ||
    Date.parse(manifest.reviewedAt) < Date.parse(report.completedAt) ||
    typeof report.intentPath !== 'string' ||
    typeof report.imagePath !== 'string'
  ) {
    fail(
      'ARTIFACT_IDENTITY_INVALID',
      `${entry.operation} submit report does not match the reviewed capability`,
    );
  }
  if (
    identity.kind === 'DASHSCOPE_WANX21_ASYNC' &&
    (
      report.operationEndpointSha256 !== identity.operationEndpointSha256 ||
      report.requestProfile !== identity.profiles[entry.operation] ||
      !isSha256(report.providerRequestIdHash)
    )
  ) {
    fail(
      'ARTIFACT_IDENTITY_INVALID',
      `${entry.operation} submit report does not match the reviewed Wanx transport`,
    );
  }
  if (reportSha256 !== entry.reportSha256) {
    fail(
      'ARTIFACT_DIGEST_MISMATCH',
      `${entry.operation} submit report digest changed after review`,
    );
  }
  const quotedCost = parseMoney(report.quotedCost, `${entry.operation} quoted cost`);
  const maximumCost = parseMoney(report.maximumCost, `${entry.operation} maximum cost`);
  validateMoneyPair(quotedCost, maximumCost, `${entry.operation} approved cost`);
  if (identity.requiredCurrency && quotedCost.currency !== identity.requiredCurrency) {
    fail('BILLING_EVIDENCE_INVALID', `${entry.operation} cost currency is invalid for Provider`);
  }
  validateApprovalEvidence(report.approvalEvidence, report);
  return { quotedCost, maximumCost };
}

function validateReceipt(
  receipt,
  entry,
  manifest,
  identity,
  report,
  reportSha256,
  receiptSha256,
  costs,
) {
  const expectedKeys = receipt?.schemaVersion === 4 ? RECEIPT_V4_KEYS : RECEIPT_V3_KEYS;
  if (![3, 4].includes(receipt?.schemaVersion) || !hasExactKeys(receipt, expectedKeys)) {
    fail('BILLING_EVIDENCE_INVALID', `${entry.operation} billing receipt has an unexpected schema`);
  }
  if (
    receipt.event !== 'AI_IMAGE_SANDBOX_BILLING_SETTLED' ||
    receipt.operationId !== entry.operationId ||
    !OPERATION_ID_PATTERN.test(String(receipt.settlementId || '')) ||
    receipt.submitReportSha256 !== reportSha256 ||
    receipt.submitState !== 'SUCCEEDED' ||
    receipt.providerOutcomeResolved !== true ||
    receipt.sameRequestRetryAllowed !== false ||
    receipt.apiBaseSha256 !== manifest.apiBaseSha256 ||
    receipt.operationEndpointSha256 !== report.operationEndpointSha256 ||
    receipt.modelSha256 !== sha256(manifest.model) ||
    receipt.operation !== entry.operation ||
    receipt.requestProfile !== report.requestProfile ||
    receipt.promptSha256 !== report.promptSha256 ||
    !sameJson(receipt.sourceSha256, report.sourceSha256) ||
    receipt.maskSha256 !== report.maskSha256 ||
    receipt.approvalId !== report.approvalEvidence.approvalId ||
    receipt.approvalSha256 !== report.approvalEvidence.approvalSha256 ||
    receipt.providerAccountRefSha256 !== report.approvalEvidence.providerAccountRefSha256 ||
    receipt.pricingRevisionSha256 !== report.approvalEvidence.pricingRevisionSha256 ||
    receipt.preCallBillingSnapshotRefSha256 !==
      report.approvalEvidence.preCallBillingSnapshotRefSha256 ||
    receipt.billingReconciliationRefSha256 !==
      report.approvalEvidence.billingReconciliationRefSha256 ||
    receipt.submissionAdapterRevision !== report.adapterRevision ||
    !GIT_OID_PATTERN.test(String(receipt.finalizationAdapterRevision || '')) ||
    !['PROVIDER_REQUEST_ID', 'UNIQUE_ACCOUNT_TIME_WINDOW', 'PROVIDER_TOKEN_LOG_ENTRY'].includes(
      receipt.correlationMethod,
    ) ||
    receipt.providerRequestIdHash !== report.providerRequestIdHash ||
    (receipt.schemaVersion === 4
      ? receipt.correlationMethod !== 'PROVIDER_TOKEN_LOG_ENTRY'
      : receipt.correlationMethod === 'PROVIDER_TOKEN_LOG_ENTRY') ||
    (receipt.correlationMethod === 'UNIQUE_ACCOUNT_TIME_WINDOW'
      ? receipt.providerRequestIdHash !== null
      : !isSha256(receipt.providerRequestIdHash)) ||
    receipt.billingGate !== 'PASS' ||
    !isCanonicalTimestamp(receipt.preCallObservedAt) ||
    !isCanonicalTimestamp(receipt.settledObservedAt) ||
    Date.parse(receipt.settledObservedAt) < Date.parse(receipt.preCallObservedAt) ||
    Date.parse(receipt.preCallObservedAt) > Date.parse(report.startedAt) ||
    Date.parse(receipt.settledObservedAt) < Date.parse(report.completedAt) ||
    Date.parse(manifest.reviewedAt) < Date.parse(receipt.settledObservedAt) ||
    receiptSha256 !== entry.receiptSha256
  ) {
    fail(
      'BILLING_EVIDENCE_INVALID',
      `${entry.operation} billing receipt does not bind the reviewed result`,
    );
  }
  if (
    identity.kind === 'DASHSCOPE_WANX21_ASYNC' &&
    (receipt.schemaVersion !== 3 || receipt.correlationMethod !== 'PROVIDER_REQUEST_ID')
  ) {
    fail(
      'BILLING_EVIDENCE_INVALID',
      `${entry.operation} Wanx billing must correlate the accepted task identity`,
    );
  }
  for (const key of [
    'settlementSha256',
    'intentSha256',
    'fingerprintClaimSha256',
    'requestFingerprint',
    'reconcilerRefSha256',
    'providerAccountRefSha256',
    'pricingRevisionSha256',
    'preCallBillingSnapshotRefSha256',
    'billingReconciliationRefSha256',
    'providerBillingEntryRefSha256',
    'preCallBillingSnapshotSha256',
    'settledBillingSnapshotSha256',
  ]) {
    if (!isSha256(receipt[key])) {
      fail('BILLING_EVIDENCE_INVALID', `${entry.operation} billing receipt digest is invalid`);
    }
  }
  if (receipt.schemaVersion === 4) {
    for (const key of [
      'providerBillingEntryRequestIdHash',
      'providerBillingEntryKey',
      'providerTokenLogAccountSha256',
      'providerTokenLogSnapshotSha256',
    ]) {
      if (!isSha256(receipt[key])) {
        fail('BILLING_EVIDENCE_INVALID', `${entry.operation} Token-log receipt digest is invalid`);
      }
    }
    if (
      !['UNAVAILABLE_UNIQUE_ENTRY', 'UPSTREAM_REQUEST_ID'].includes(receipt.providerRequestIdBridge)
    ) {
      fail('BILLING_EVIDENCE_INVALID', `${entry.operation} Token-log request bridge is invalid`);
    }
  }
  const actualCost = parseMoney(receipt.actualCost, `${entry.operation} actual cost`, {
    allowZero: true,
  });
  const quotedCost = parseMoney(receipt.quotedCost, `${entry.operation} settled quoted cost`);
  const maximumCost = parseMoney(receipt.maximumCost, `${entry.operation} settled maximum cost`);
  validateMoneyPair(quotedCost, maximumCost, `${entry.operation} settled approved cost`);
  if (
    !sameJson(quotedCost, costs.quotedCost) ||
    !sameJson(maximumCost, costs.maximumCost) ||
    actualCost.currency !== maximumCost.currency ||
    actualCost.scale !== maximumCost.scale ||
    actualCost.amount > maximumCost.amount ||
    !['CHARGED', 'NO_CHARGE'].includes(receipt.billingOutcome) ||
    (receipt.billingOutcome === 'CHARGED'
      ? receipt.billedUnits !== 1 || actualCost.amount < 1
      : receipt.billedUnits !== 0 || actualCost.amount !== 0)
  ) {
    fail('BILLING_EVIDENCE_INVALID', `${entry.operation} settled cost is inconsistent`);
  }
}

export function reviewAiImageCapabilityCandidate(reviewManifestPath) {
  if (typeof reviewManifestPath !== 'string' || !reviewManifestPath.trim()) {
    fail('QUALITY_REVIEW_INVALID', 'review manifest path is required');
  }
  const manifestFile = readBoundedCanonicalJson(reviewManifestPath, 'quality review manifest');
  const manifest = manifestFile.value;
  const identity = validateManifest(manifest);
  const reviewRoot = path.dirname(realpathSync(path.resolve(reviewManifestPath)));
  const artifactPaths = new Set();
  const reviewedOperations = [];
  const reviewedIdentities = [];

  for (const operation of EDIT_OPERATIONS) {
    const entry = manifest.operations.find((candidate) => candidate.operation === operation);
    const reportPath = safeRelativePath(reviewRoot, entry.reportPath, `${operation} report path`);
    const receiptPath = safeRelativePath(
      reviewRoot,
      entry.receiptPath,
      `${operation} receipt path`,
    );
    for (const artifactPath of [reportPath, receiptPath]) {
      const normalized = process.platform === 'win32' ? artifactPath.toLowerCase() : artifactPath;
      if (artifactPaths.has(normalized)) {
        fail('REVIEW_PATH_INVALID', 'each operation requires distinct report and receipt files');
      }
      artifactPaths.add(normalized);
    }
    const reportFile = readBoundedCanonicalJson(
      reportPath,
      `${operation} submit report`,
      reviewRoot,
    );
    const report = reportFile.value;
    const costs = validateReport(report, entry, manifest, identity, reportFile.sha256);
    const receiptFile = readBoundedCanonicalJson(
      receiptPath,
      `${operation} billing receipt`,
      reviewRoot,
    );
    const receipt = receiptFile.value;
    validateReceipt(
      receipt,
      entry,
      manifest,
      identity,
      report,
      reportFile.sha256,
      receiptFile.sha256,
      costs,
    );
    reviewedIdentities.push({
      credentialRevision: report.credentialRevision,
      providerAccountRefSha256: report.approvalEvidence.providerAccountRefSha256,
      approvalId: report.approvalEvidence.approvalId,
      approvalSha256: report.approvalEvidence.approvalSha256,
      pricingRevisionSha256: report.approvalEvidence.pricingRevisionSha256,
      preCallBillingSnapshotRefSha256: report.approvalEvidence.preCallBillingSnapshotRefSha256,
      billingReconciliationRefSha256: report.approvalEvidence.billingReconciliationRefSha256,
      settlementId: receipt.settlementId,
      settlementSha256: receipt.settlementSha256,
      intentSha256: receipt.intentSha256,
      fingerprintClaimSha256: receipt.fingerprintClaimSha256,
      requestFingerprint: receipt.requestFingerprint,
      providerRequestIdHash: receipt.providerRequestIdHash,
      providerBillingEntryRefSha256: receipt.providerBillingEntryRefSha256,
      providerBillingEntryKey: receipt.schemaVersion === 4 ? receipt.providerBillingEntryKey : null,
      providerBillingEntryRequestIdHash:
        receipt.schemaVersion === 4 ? receipt.providerBillingEntryRequestIdHash : null,
      providerTokenLogAccountSha256:
        receipt.schemaVersion === 4 ? receipt.providerTokenLogAccountSha256 : null,
      providerTokenLogSnapshotSha256:
        receipt.schemaVersion === 4 ? receipt.providerTokenLogSnapshotSha256 : null,
    });
    reviewedOperations.push({
      operation,
      operationId: entry.operationId,
      operationEndpointSha256: report.operationEndpointSha256,
      submitReportSha256: reportFile.sha256,
      billingReceiptSha256: receiptFile.sha256,
      outputImageSha256: report.sha256,
      qualityDecision: 'APPROVED',
    });
  }

  const operationIds = new Set(reviewedOperations.map((entry) => entry.operationId));
  const reportDigests = new Set(reviewedOperations.map((entry) => entry.submitReportSha256));
  const receiptDigests = new Set(reviewedOperations.map((entry) => entry.billingReceiptSha256));
  const operationEndpoints = new Set(
    reviewedOperations.map((entry) => entry.operationEndpointSha256),
  );
  const credentialRevisions = new Set(reviewedIdentities.map((entry) => entry.credentialRevision));
  const providerAccounts = new Set(
    reviewedIdentities.map((entry) => entry.providerAccountRefSha256),
  );
  const approvalIds = new Set(reviewedIdentities.map((entry) => entry.approvalId));
  const approvalDigests = new Set(reviewedIdentities.map((entry) => entry.approvalSha256));
  const pricingRevisions = new Set(reviewedIdentities.map((entry) => entry.pricingRevisionSha256));
  const preCallSnapshotRefs = new Set(
    reviewedIdentities.map((entry) => entry.preCallBillingSnapshotRefSha256),
  );
  const reconciliationRefs = new Set(
    reviewedIdentities.map((entry) => entry.billingReconciliationRefSha256),
  );
  const settlementIds = new Set(reviewedIdentities.map((entry) => entry.settlementId));
  const settlementDigests = new Set(reviewedIdentities.map((entry) => entry.settlementSha256));
  const intentDigests = new Set(reviewedIdentities.map((entry) => entry.intentSha256));
  const fingerprintClaimDigests = new Set(
    reviewedIdentities.map((entry) => entry.fingerprintClaimSha256),
  );
  const requestFingerprints = new Set(reviewedIdentities.map((entry) => entry.requestFingerprint));
  const providerRequestIds = reviewedIdentities
    .map((entry) => entry.providerRequestIdHash)
    .filter((value) => value !== null);
  const providerBillingEntryRefs = new Set(
    reviewedIdentities.map((entry) => entry.providerBillingEntryRefSha256),
  );
  const tokenLogIdentities = reviewedIdentities.filter(
    (entry) => entry.providerBillingEntryKey !== null,
  );
  const providerBillingEntryKeys = new Set(
    tokenLogIdentities.map((entry) => entry.providerBillingEntryKey),
  );
  const providerBillingEntryRequestIds = new Set(
    tokenLogIdentities.map((entry) => entry.providerBillingEntryRequestIdHash),
  );
  const providerTokenLogAccounts = new Set(
    tokenLogIdentities.map((entry) => entry.providerTokenLogAccountSha256),
  );
  const providerTokenLogSnapshots = new Set(
    tokenLogIdentities.map((entry) => entry.providerTokenLogSnapshotSha256),
  );
  if (
    operationIds.size !== EDIT_OPERATIONS.length ||
    reportDigests.size !== EDIT_OPERATIONS.length ||
    receiptDigests.size !== EDIT_OPERATIONS.length ||
    operationEndpoints.size !== 1 ||
    credentialRevisions.size !== 1 ||
    providerAccounts.size !== 1 ||
    approvalIds.size !== EDIT_OPERATIONS.length ||
    approvalDigests.size !== EDIT_OPERATIONS.length ||
    pricingRevisions.size !== EDIT_OPERATIONS.length ||
    preCallSnapshotRefs.size !== EDIT_OPERATIONS.length ||
    reconciliationRefs.size !== EDIT_OPERATIONS.length ||
    settlementIds.size !== EDIT_OPERATIONS.length ||
    settlementDigests.size !== EDIT_OPERATIONS.length ||
    intentDigests.size !== EDIT_OPERATIONS.length ||
    fingerprintClaimDigests.size !== EDIT_OPERATIONS.length ||
    requestFingerprints.size !== EDIT_OPERATIONS.length ||
    new Set(providerRequestIds).size !== providerRequestIds.length ||
    providerBillingEntryRefs.size !== EDIT_OPERATIONS.length ||
    providerBillingEntryKeys.size !== tokenLogIdentities.length ||
    providerBillingEntryRequestIds.size !== tokenLogIdentities.length ||
    providerTokenLogAccounts.size > 1 ||
    providerTokenLogSnapshots.size !== tokenLogIdentities.length
  ) {
    fail(
      'ARTIFACT_IDENTITY_INVALID',
      'edit evidence must share one Provider identity and use independent approvals',
    );
  }

  return {
    schemaVersion: 1,
    event: 'AI_IMAGE_PROVIDER_CAPABILITY_CANDIDATE_CREATED',
    status: 'CANDIDATE_ONLY',
    containsSecrets: false,
    registryMutationPerformed: false,
    trustedEvidenceVerified: false,
    candidateCapability: {
      provider: manifest.provider,
      model: manifest.model,
      operations: [...EDIT_OPERATIONS],
      maxReferences: manifest.maxReferences,
      supportsMask: manifest.supportsMask,
      inputTransport: manifest.inputTransport,
      resultMode: manifest.resultMode,
      evidenceLevel: 'candidate-only',
      requestedRegistryEvidenceLevel: 'sandbox-verified',
      evidence: 'shape-validated candidate; trusted private evidence review is still required',
      proposedSandboxEvidence: EDIT_OPERATIONS.map((operation) => ({
        endpointSha256: manifest.apiBaseSha256,
        operation,
        inputTransport: manifest.inputTransport,
        resultMode: manifest.resultMode,
      })),
    },
    reviewEvidence: {
      apiBaseSha256: manifest.apiBaseSha256,
      qualityReviewManifestSha256: manifestFile.sha256,
      reviewerRefSha256: manifest.reviewerRefSha256,
      reviewedAt: manifest.reviewedAt,
      operations: reviewedOperations,
    },
  };
}

function reviewManifestArgument(argv) {
  if (argv.length !== 2 || argv[0] !== '--review-manifest' || !argv[1]) {
    fail(
      'CLI_USAGE_INVALID',
      'usage: node scripts/sandbox/ai-image-capability-candidate.mjs --review-manifest <bundle/quality-review.json>',
    );
  }
  return argv[1];
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  try {
    const candidate = reviewAiImageCapabilityCandidate(
      reviewManifestArgument(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
  } catch (error) {
    const code =
      error instanceof AiImageCapabilityCandidateError ? error.code : 'CAPABILITY_CANDIDATE_FAILED';
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        event: 'AI_IMAGE_PROVIDER_CAPABILITY_CANDIDATE_FAILED',
        failureCode: code,
      })}\n`,
    );
    process.exitCode = 1;
  }
}
