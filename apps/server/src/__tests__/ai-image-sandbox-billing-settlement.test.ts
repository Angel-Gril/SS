import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT,
  finalizeAiImageSandboxBillingSettlement,
} from '../services/ai-image-sandbox-billing-settlement.js';
import { createAiImageSandboxRequestFingerprint } from '../services/ai-image-sandbox-guard.js';
import {
  AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT,
  AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT,
  AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
  AI_IMAGE_XIAOYI_MINIMAL_EDIT_MULTIPART_DIALECT,
  aiImageEditMultipartDialectForRequestProfile,
  aiImageEditMultipartFields,
} from '../services/ai-image-packy-edit-profile.js';
import {
  AI_IMAGE_XIAOYI_API_BASE,
  AI_IMAGE_XIAOYI_BILLING_ORIGIN,
  AI_IMAGE_XIAOYI_EDIT_PROFILE,
  AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE,
  AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
} from '../services/ai-image-xiaoyi-provider.js';
import {
  AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE,
  AI_IMAGE_WANX21_EDIT_MODEL,
  AI_IMAGE_WANX21_EDIT_TRANSPORT,
  AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE,
  aiImageWanx21EditSubmitEndpoint,
} from '../services/ai-image-wanx-edit-profile.js';

const directories: string[] = [];
const operationId = 'sandbox-billing-finalize-0001';
const requestFingerprint = createAiImageSandboxRequestFingerprint({
  endpointSha256: '3'.repeat(64),
  model: 'edit-capable-model',
  request: {
    n: 1,
    size: '1024x1024',
    promptSha256: '4'.repeat(64),
    sourceSha256: ['5'.repeat(64)],
    maskSha256: null,
  },
});
const approvalSha256 = '2'.repeat(64);
const rawProviderRequestId = 'provider-request-private-0001';
const providerBillingRequestId = 'relay-billing-request-private-0001';
const providerApiBase = 'https://relay.example/v1';
const providerApiBaseSha256 = sha256(providerApiBase);
const sub2ApiBase = 'https://api.picpi.top/v1';
const sub2EditEndpoint = `${sub2ApiBase}/images/edits`;
const xiaoyiApiBaseSha256 = sha256(AI_IMAGE_XIAOYI_API_BASE);
const exactQuotedCost = { currency: 'CNY', amount: 119, scale: 4 } as const;
const exactMaximumCost = { currency: 'CNY', amount: 1_000, scale: 4 } as const;

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function approvalEvidence(overrides: Record<string, unknown> = {}) {
  return {
    approvalId: `approval-${operationId}`,
    approvalSha256,
    approvedAt: '2030-01-01T00:00:00.000Z',
    expiresAt: '2030-01-01T00:30:00.000Z',
    approverRefSha256: sha256('owner-review'),
    providerAccountRefSha256: sha256('provider-account-main'),
    pricingRevisionSha256: sha256('pricing-r1'),
    currency: 'USD',
    preCallBillingSnapshotRefSha256: sha256('private-ledger/before'),
    billingReconciliationRefSha256: sha256('private-ledger/after'),
    ...overrides,
  };
}

function xiaoyiEvidenceBindings(overrides: {
  apiBaseSha256?: string;
  endpoint?: string;
  model?: string;
  operation?: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
  requestProfile?:
    | typeof AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE
    | typeof AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE
    | 'OPENAI_SQUARE_SINGLE_V1';
  currency?: 'CNY' | 'USD';
} = {}) {
  const endpoint = overrides.endpoint || AI_IMAGE_XIAOYI_EDIT_PROFILE.endpoint;
  const endpointSha256 = sha256(endpoint);
  const model = overrides.model || AI_IMAGE_XIAOYI_EDIT_PROFILE.model;
  const operation = overrides.operation || 'IMAGE_TO_IMAGE';
  const requestProfile = overrides.requestProfile || AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE;
  const currency = overrides.currency || 'CNY';
  const maskSha256 = operation === 'INPAINT' ? '6'.repeat(64) : null;
  const maskDimensions = operation === 'INPAINT' ? { width: 1024, height: 1024 } : null;
  const xiaoyiProfileSelected = requestProfile === AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE
    || requestProfile === AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE;
  const request = {
    operation,
    requestProfile,
    n: 1,
    width: 1024,
    height: 1024,
    size: '1024x1024',
    promptSha256: '4'.repeat(64),
    sourceSha256: ['5'.repeat(64)],
    sourceDimensions: [{ width: 1024, height: 1024 }],
    maskSha256,
    maskDimensions,
    approvalEvidence: approvalEvidence({ currency }),
  };
  const fingerprint = createAiImageSandboxRequestFingerprint({
    endpointSha256,
    model,
    request: {
      ...(xiaoyiProfileSelected
        ? {
            operation: request.operation,
            requestProfile: request.requestProfile,
            multipartDialect: aiImageEditMultipartDialectForRequestProfile(requestProfile),
            multipartFields: aiImageEditMultipartFields(
              aiImageEditMultipartDialectForRequestProfile(requestProfile),
            ),
          }
        : {}),
      n: request.n,
      size: request.size,
      promptSha256: request.promptSha256,
      sourceSha256: request.sourceSha256,
      maskSha256: request.maskSha256,
    },
  });
  return {
    requestFingerprint: fingerprint,
    intentOverrides: {
      endpointSha256,
      apiBaseSha256: overrides.apiBaseSha256 || xiaoyiApiBaseSha256,
      model,
      request,
    },
    reportOverrides: {
      operation: request.operation,
      requestProfile: request.requestProfile,
      model,
      apiBaseSha256: overrides.apiBaseSha256 || xiaoyiApiBaseSha256,
      operationEndpointSha256: endpointSha256,
    },
    providerLogEntryOverrides: { model_name: model },
  };
}

function wanxEvidenceBindings() {
  const endpoint = aiImageWanx21EditSubmitEndpoint(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE);
  const endpointSha256 = sha256(endpoint);
  const apiBaseSha256 = sha256(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE);
  const request = {
    operation: 'IMAGE_TO_IMAGE',
    requestProfile: AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE,
    n: 1,
    width: 1024,
    height: 1024,
    size: '1024x1024',
    promptSha256: '4'.repeat(64),
    sourceSha256: ['5'.repeat(64)],
    sourceDimensions: [{ width: 1024, height: 1024 }],
    maskSha256: null,
    maskDimensions: null,
    approvalEvidence: approvalEvidence({ currency: 'CNY' }),
  };
  const fingerprint = createAiImageSandboxRequestFingerprint({
    endpointSha256,
    model: AI_IMAGE_WANX21_EDIT_MODEL,
    request: {
      operation: request.operation,
      requestProfile: request.requestProfile,
      providerTransport: AI_IMAGE_WANX21_EDIT_TRANSPORT,
      providerFunction: 'description_edit',
      n: request.n,
      size: request.size,
      promptSha256: request.promptSha256,
      sourceSha256: request.sourceSha256,
      maskSha256: request.maskSha256,
    },
  });
  return {
    requestFingerprint: fingerprint,
    intentOverrides: {
      endpointSha256,
      apiBaseSha256,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      request,
    },
    reportOverrides: {
      provider: 'dashscope-wanx21-image-edit',
      operation: request.operation,
      requestProfile: request.requestProfile,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      apiBaseSha256,
      operationEndpointSha256: endpointSha256,
    },
  };
}

function sub2CumulativeZeroBindings(reportOverrides: Record<string, unknown> = {}) {
  const state = reportOverrides.state === 'SUCCEEDED' ? 'SUCCEEDED' : 'REJECTED';
  const endpointSha256 = sha256(sub2EditEndpoint);
  const request = {
    operation: 'IMAGE_TO_IMAGE',
    requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
    n: 1,
    width: 1024,
    height: 1024,
    size: '1024x1024',
    promptSha256: '4'.repeat(64),
    sourceSha256: ['5'.repeat(64)],
    sourceDimensions: [{ width: 1024, height: 1024 }],
    maskSha256: null,
    maskDimensions: null,
    approvalEvidence: approvalEvidence({ currency: 'USD' }),
  };
  const fingerprint = createAiImageSandboxRequestFingerprint({
    endpointSha256,
    model: 'gpt-image-2',
    request: {
      n: request.n,
      size: request.size,
      promptSha256: request.promptSha256,
      sourceSha256: request.sourceSha256,
      maskSha256: request.maskSha256,
    },
  });
  return {
    requestFingerprint: fingerprint,
    approvalOverrides: { currency: 'USD' },
    intentOverrides: {
      endpointSha256,
      apiBaseSha256: sha256(sub2ApiBase),
      model: 'gpt-image-2',
      request,
      quotedCost: { currency: 'USD', amount: 1, scale: 0 },
      maximumCost: { currency: 'USD', amount: 1, scale: 0 },
    },
    reportOverrides: {
      state,
      provider: 'custom-openai-compatible',
      model: 'gpt-image-2',
      operation: 'IMAGE_TO_IMAGE',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      apiBaseSha256: sha256(sub2ApiBase),
      operationEndpointSha256: endpointSha256,
      ...(state === 'SUCCEEDED' ? {} : { failureCode: 'PROVIDER_REQUEST_FAILED' }),
      quotedCost: { currency: 'USD', amount: 1, scale: 0 },
      maximumCost: { currency: 'USD', amount: 1, scale: 0 },
      ...reportOverrides,
    },
    attestationOverrides: { requestFingerprint: fingerprint },
  };
}

function intent(
  overrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 2,
    operationId,
    state: 'SUBMITTING',
    endpointSha256: '3'.repeat(64),
    model: 'edit-capable-model',
    credentialRevision: 'credential-r1',
    adapterRevision: 'a'.repeat(40),
    requestFingerprint,
    request: {
      operation: 'FULL_EDIT',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      n: 1,
      width: 1024,
      height: 1024,
      size: '1024x1024',
      promptSha256: '4'.repeat(64),
      sourceSha256: ['5'.repeat(64)],
      sourceDimensions: [{ width: 1024, height: 1024 }],
      maskSha256: null,
      maskDimensions: null,
      approvalEvidence: approvalEvidence(approvalOverrides),
    },
    quotedCostCents: 10,
    maximumCostCents: 20,
    createdAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function exactIntent(
  overrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 3,
    operationId,
    state: 'SUBMITTING',
    endpointSha256: '3'.repeat(64),
    apiBaseSha256: '6'.repeat(64),
    model: 'edit-capable-model',
    credentialRevision: 'credential-r1',
    adapterRevision: 'a'.repeat(40),
    requestFingerprint,
    request: {
      operation: 'FULL_EDIT',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      n: 1,
      width: 1024,
      height: 1024,
      size: '1024x1024',
      promptSha256: '4'.repeat(64),
      sourceSha256: ['5'.repeat(64)],
      sourceDimensions: [{ width: 1024, height: 1024 }],
      maskSha256: null,
      maskDimensions: null,
      approvalEvidence: approvalEvidence({ currency: 'CNY', ...approvalOverrides }),
    },
    quotedCost: exactQuotedCost,
    maximumCost: exactMaximumCost,
    createdAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function report(
  overrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {},
  schemaVersion: 3 | 4 = 3,
) {
  const state = typeof overrides.state === 'string' ? overrides.state : 'SUCCEEDED';
  return {
    schemaVersion,
    operationId,
    state,
    operation: 'FULL_EDIT',
    requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
    credentialRevision: 'credential-r1',
    adapterRevision: 'a'.repeat(40),
    provider: 'custom-openai-compatible',
    model: 'edit-capable-model',
    ...(schemaVersion === 4 ? {
      apiBaseSha256: '6'.repeat(64),
      operationEndpointSha256: '3'.repeat(64),
    } : {
      endpointSha256: '3'.repeat(64),
    }),
    approvalEvidence: approvalEvidence(approvalOverrides),
    promptSha256: '4'.repeat(64),
    sourceSha256: ['5'.repeat(64)],
    maskSha256: null,
    requestedSize: '1024x1024',
    createRequests: 1,
    providerRequestIdHash: sha256(rawProviderRequestId),
    usage: null,
    startedAt: '2030-01-01T00:01:00.000Z',
    completedAt: '2030-01-01T00:02:00.000Z',
    elapsedMs: 60_000,
    actualCostCents: null,
    quotedCostCents: 10,
    maximumCostCents: 20,
    intentPath: 'C:\\private\\must-not-be-trusted.intent.json',
    ...(state === 'SUCCEEDED' ? {
      imageCount: 1,
      mimeType: 'image/png',
      width: 1_024,
      height: 1_024,
      bytes: 1_024,
      sha256: 'a'.repeat(64),
      imagePath: 'C:\\private\\must-not-be-trusted.image.png',
    } : {
      failureCode: 'PROVIDER_REJECTED',
    }),
    ...overrides,
  };
}

function exactReport(
  overrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {},
) {
  const state = typeof overrides.state === 'string' ? overrides.state : 'SUCCEEDED';
  return {
    schemaVersion: 5,
    operationId,
    state,
    operation: 'FULL_EDIT',
    requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
    credentialRevision: 'credential-r1',
    adapterRevision: 'a'.repeat(40),
    provider: 'custom-openai-compatible',
    model: 'edit-capable-model',
    apiBaseSha256: '6'.repeat(64),
    operationEndpointSha256: '3'.repeat(64),
    approvalEvidence: approvalEvidence({ currency: 'CNY', ...approvalOverrides }),
    promptSha256: '4'.repeat(64),
    sourceSha256: ['5'.repeat(64)],
    maskSha256: null,
    requestedSize: '1024x1024',
    createRequests: 1,
    providerRequestIdHash: sha256(rawProviderRequestId),
    usage: null,
    startedAt: '2030-01-01T00:01:00.000Z',
    completedAt: '2030-01-01T00:02:00.000Z',
    elapsedMs: 60_000,
    actualCost: null,
    quotedCost: exactQuotedCost,
    maximumCost: exactMaximumCost,
    intentPath: 'C:\\private\\must-not-be-trusted.intent.json',
    ...(state === 'SUCCEEDED' ? {
      imageCount: 1,
      mimeType: 'image/png',
      width: 1_024,
      height: 1_024,
      bytes: 1_024,
      sha256: 'a'.repeat(64),
      imagePath: 'C:\\private\\must-not-be-trusted.image.png',
    } : {
      failureCode: 'PROVIDER_REJECTED',
    }),
    ...overrides,
  };
}

function fingerprintClaim(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    operationId,
    requestFingerprint,
    state: 'CLAIMED_FAIL_CLOSED',
    createdAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function attestation(input: {
  intentSha256: string;
  reportSha256: string;
  fingerprintClaimSha256: string;
  preCallBillingSnapshotPath: string;
  settledBillingSnapshotPath: string;
  preCallBillingSnapshotSha256: string;
  settledBillingSnapshotSha256: string;
}, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    settlementId: 'sandbox-billing-settlement-0001',
    statement: AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT,
    operationId,
    preCallObservedAt: '2029-12-31T23:59:30.000Z',
    settledObservedAt: '2030-01-01T00:05:00.000Z',
    reconcilerRef: 'billing-operator-review',
    providerAccountRef: 'provider-account-main',
    pricingRevision: 'pricing-r1',
    currency: 'USD',
    preCallBillingSnapshotRef: 'private-ledger/before',
    billingReconciliationRef: 'private-ledger/after',
    preCallBillingSnapshotPath: input.preCallBillingSnapshotPath,
    settledBillingSnapshotPath: input.settledBillingSnapshotPath,
    preCallBillingSnapshotSha256: input.preCallBillingSnapshotSha256,
    settledBillingSnapshotSha256: input.settledBillingSnapshotSha256,
    providerBillingEntryRef: 'private-ledger/entry-0001',
    intentSha256: input.intentSha256,
    submitReportSha256: input.reportSha256,
    fingerprintClaimSha256: input.fingerprintClaimSha256,
    requestFingerprint,
    approvalId: `approval-${operationId}`,
    approvalSha256,
    correlationMethod: 'PROVIDER_REQUEST_ID',
    providerRequestId: rawProviderRequestId,
    billingOutcome: 'CHARGED',
    actualCostCents: 10,
    ...overrides,
  };
}

function exactMeterEvidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: 'NEW_API_QUOTA_AND_TOTAL_USAGE_V1',
    rawQuotaDelta: 5_950,
    quotaUnitsPerCurrencyUnit: 500_000,
    displayTotalUsageDelta: { amount: 119, scale: 2 },
    displayTotalUsageUnitCurrencyScale: 2,
    ...overrides,
  };
}

function exactAttestation(input: {
  intentSha256: string;
  reportSha256: string;
  fingerprintClaimSha256: string;
  preCallBillingSnapshotPath: string;
  settledBillingSnapshotPath: string;
  preCallBillingSnapshotSha256: string;
  settledBillingSnapshotSha256: string;
}, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    settlementId: 'sandbox-billing-settlement-0001',
    statement: AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT,
    operationId,
    preCallObservedAt: '2029-12-31T23:59:30.000Z',
    settledObservedAt: '2030-01-01T00:05:00.000Z',
    reconcilerRef: 'billing-operator-review',
    providerAccountRef: 'provider-account-main',
    pricingRevision: 'pricing-r1',
    preCallBillingSnapshotRef: 'private-ledger/before',
    billingReconciliationRef: 'private-ledger/after',
    preCallBillingSnapshotPath: input.preCallBillingSnapshotPath,
    settledBillingSnapshotPath: input.settledBillingSnapshotPath,
    preCallBillingSnapshotSha256: input.preCallBillingSnapshotSha256,
    settledBillingSnapshotSha256: input.settledBillingSnapshotSha256,
    providerBillingEntryRef: 'private-ledger/entry-0001',
    intentSha256: input.intentSha256,
    submitReportSha256: input.reportSha256,
    fingerprintClaimSha256: input.fingerprintClaimSha256,
    requestFingerprint,
    approvalId: `approval-${operationId}`,
    approvalSha256,
    correlationMethod: 'PROVIDER_REQUEST_ID',
    providerRequestId: rawProviderRequestId,
    billingOutcome: 'CHARGED',
    actualCost: exactQuotedCost,
    meterEvidence: exactMeterEvidence(),
    ...overrides,
  };
}

function cumulativeZeroAttestation(input: {
  intentSha256: string;
  reportSha256: string;
  fingerprintClaimSha256: string;
  settledBillingSnapshotPath: string;
  settledBillingSnapshotSha256: string;
}, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 4,
    settlementId: 'sandbox-billing-settlement-0001',
    statement: AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT,
    operationId,
    preCallObservedAt: '2029-12-31T23:59:30.000Z',
    settledObservedAt: '2030-01-01T00:05:00.000Z',
    reconcilerRef: 'billing-operator-review',
    providerAccountRef: 'provider-account-main',
    pricingRevision: 'pricing-r1',
    preCallBillingSnapshotRef: 'private-ledger/before',
    billingReconciliationRef: 'private-ledger/after',
    settledBillingSnapshotPath: input.settledBillingSnapshotPath,
    settledBillingSnapshotSha256: input.settledBillingSnapshotSha256,
    providerBillingEntryRef: 'private-ledger/api-key-cumulative-zero',
    intentSha256: input.intentSha256,
    submitReportSha256: input.reportSha256,
    fingerprintClaimSha256: input.fingerprintClaimSha256,
    requestFingerprint,
    approvalId: `approval-${operationId}`,
    approvalSha256,
    correlationMethod: 'API_KEY_CUMULATIVE_ZERO_USAGE',
    providerRequestId: null,
    billingOutcome: 'NO_CHARGE',
    actualCost: { currency: 'USD', amount: 0, scale: 0 },
    cumulativeUsageEvidence: {
      schemaVersion: 1,
      kind: 'SUB2_API_KEY_CUMULATIVE_ZERO_USAGE_V1',
      totalRequests: 0,
      totalActualCost: { amount: 0, scale: 0 },
    },
    ...overrides,
  };
}

function providerTokenLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 2,
    created_at: 1_893_456_120,
    type: 2,
    content: 'consume 5950 quota',
    username: 'private-user',
    token_name: 'private-token',
    model_name: 'edit-capable-model',
    quota: 5_950,
    prompt_tokens: 0,
    completion_tokens: 0,
    use_time: 60,
    is_stream: false,
    channel: 3,
    channel_name: '',
    token_id: 4,
    group: 'test',
    ip: '',
    request_id: providerBillingRequestId,
    other: JSON.stringify({ request_path: '/v1/images/edits' }),
    ...overrides,
  };
}

function providerTokenLogSnapshot(input: {
  operationId: string;
  entryOverrides?: Record<string, unknown>;
  bodyOverrides?: Record<string, unknown>;
  requestOverrides?: Record<string, unknown>;
  snapshotOverrides?: Record<string, unknown>;
}) {
  const body = Buffer.from(JSON.stringify({
    data: [providerTokenLogEntry(input.entryOverrides)],
    message: '',
    success: true,
    ...input.bodyOverrides,
  }), 'utf8');
  return {
    schemaVersion: 1,
    kind: 'AI_IMAGE_SANDBOX_PROVIDER_LOG_SNAPSHOT',
    operationId: input.operationId,
    observedAt: '2030-01-01T00:05:00.000Z',
    request: {
      name: 'providerTokenLog',
      method: 'GET',
      uri: 'https://relay.example/api/log/token',
      httpStatus: 200,
      contentType: 'application/json; charset=utf-8',
      bodySha256: sha256(body),
      bodyBase64: body.toString('base64'),
      ...input.requestOverrides,
    },
    ...input.snapshotOverrides,
  };
}

async function writeCanonicalJson(path: string, value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
  return { bytes, sha256: sha256(bytes) };
}

async function fixture(input: {
  approvalOverrides?: Record<string, unknown>;
  intentOverrides?: Record<string, unknown>;
  reportOverrides?: Record<string, unknown>;
  intentSchemaVersion?: 2 | 3;
  reportSchemaVersion?: 3 | 4 | 5;
  attestationSchemaVersion?: 1 | 2 | 3 | 4;
  claimOverrides?: Record<string, unknown>;
  attestationOverrides?: Record<string, unknown>;
  providerLogEntryOverrides?: Record<string, unknown>;
  providerLogBodyOverrides?: Record<string, unknown>;
  providerLogRequestOverrides?: Record<string, unknown>;
  providerLogSnapshotOverrides?: Record<string, unknown>;
  settledBillingSnapshotValue?: unknown;
  requestFingerprint?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-billing-'));
  directories.push(root);
  const effectiveRequestFingerprint = input.requestFingerprint || requestFingerprint;
  const intentPath = join(root, 'intents', `${operationId}.intent.json`);
  const reportPath = join(root, `${operationId}.report.json`);
  const claimPath = join(
    root,
    'intents',
    '.fingerprints',
    `${effectiveRequestFingerprint}.claim.json`,
  );
  const storedIntent = await writeCanonicalJson(
    intentPath,
    input.intentSchemaVersion === 3
      ? exactIntent({
          ...(input.attestationSchemaVersion === 3
            ? { apiBaseSha256: providerApiBaseSha256 }
            : {}),
          requestFingerprint: effectiveRequestFingerprint,
          ...input.intentOverrides,
        }, input.approvalOverrides)
      : intent({
          requestFingerprint: effectiveRequestFingerprint,
          ...input.intentOverrides,
        }, input.approvalOverrides),
  );
  const storedReport = await writeCanonicalJson(
    reportPath,
    input.reportSchemaVersion === 5
      ? exactReport({
          ...(input.attestationSchemaVersion === 3
            ? { apiBaseSha256: providerApiBaseSha256 }
            : {}),
          ...input.reportOverrides,
        }, input.approvalOverrides)
      : report(input.reportOverrides, input.approvalOverrides, input.reportSchemaVersion),
  );
  const storedClaim = await writeCanonicalJson(claimPath, fingerprintClaim({
    requestFingerprint: effectiveRequestFingerprint,
    ...input.claimOverrides,
  }));
  const preCallBillingSnapshotPath = join(root, 'private', 'billing-before.snapshot');
  const settledBillingSnapshotPath = join(root, 'private', 'billing-settled.snapshot');
  const preCallBillingSnapshot = Buffer.from('private Provider balance before request\n', 'utf8');
  const settledBillingSnapshot = input.attestationSchemaVersion === 4
    ? Buffer.from(`${JSON.stringify(input.settledBillingSnapshotValue || {
        isValid: true,
        mode: 'unrestricted',
        unit: 'USD',
        usage: {
          today: { requests: 0, actual_cost: 0 },
          total: { requests: 0, actual_cost: 0 },
        },
      }, null, 2)}\n`, 'utf8')
    : Buffer.from('private Provider balance after request\n', 'utf8');
  await mkdir(dirname(preCallBillingSnapshotPath), { recursive: true, mode: 0o700 });
  await writeFile(preCallBillingSnapshotPath, preCallBillingSnapshot, { mode: 0o600 });
  await writeFile(settledBillingSnapshotPath, settledBillingSnapshot, { mode: 0o600 });
  const providerTokenLogSnapshotPath = join(root, 'private', 'provider-token-log.snapshot.json');
  const storedProviderTokenLogSnapshot = input.attestationSchemaVersion === 3
    ? await writeCanonicalJson(
        providerTokenLogSnapshotPath,
        providerTokenLogSnapshot({
          operationId,
          entryOverrides: input.providerLogEntryOverrides,
          bodyOverrides: input.providerLogBodyOverrides,
          requestOverrides: input.providerLogRequestOverrides,
          snapshotOverrides: input.providerLogSnapshotOverrides,
        }),
      )
    : null;
  const settlementPath = join(root, 'private', `${operationId}.billing-attestation.json`);
  const attestationInput = {
    intentSha256: storedIntent.sha256,
    reportSha256: storedReport.sha256,
    fingerprintClaimSha256: storedClaim.sha256,
    preCallBillingSnapshotPath,
    settledBillingSnapshotPath,
    preCallBillingSnapshotSha256: sha256(preCallBillingSnapshot),
    settledBillingSnapshotSha256: sha256(settledBillingSnapshot),
  };
  const storedSettlement = await writeCanonicalJson(
    settlementPath,
    input.attestationSchemaVersion === 4
      ? cumulativeZeroAttestation({
          intentSha256: storedIntent.sha256,
          reportSha256: storedReport.sha256,
          fingerprintClaimSha256: storedClaim.sha256,
          settledBillingSnapshotPath,
          settledBillingSnapshotSha256: sha256(settledBillingSnapshot),
        }, {
          requestFingerprint: effectiveRequestFingerprint,
          ...input.attestationOverrides,
        })
      : input.attestationSchemaVersion === 3
      ? exactAttestation(attestationInput, {
          schemaVersion: 3,
          correlationMethod: 'PROVIDER_TOKEN_LOG_ENTRY',
          providerRequestId: providerBillingRequestId,
          providerTokenLogSnapshotPath,
          providerTokenLogSnapshotSha256: storedProviderTokenLogSnapshot!.sha256,
          providerTokenLogUserId: 2,
          providerTokenLogTokenId: 4,
          requestFingerprint: effectiveRequestFingerprint,
          ...input.attestationOverrides,
        })
      : input.attestationSchemaVersion === 2
      ? exactAttestation(attestationInput, {
          requestFingerprint: effectiveRequestFingerprint,
          ...input.attestationOverrides,
        })
      : attestation(attestationInput, {
          requestFingerprint: effectiveRequestFingerprint,
          ...input.attestationOverrides,
        }),
  );
  return {
    root,
    intentPath,
    reportPath,
    claimPath,
    settlementPath,
    settlementSha256: storedSettlement.sha256,
    preCallBillingSnapshotPath,
    settledBillingSnapshotPath,
    preCallBillingSnapshotSha256: sha256(preCallBillingSnapshot),
    settledBillingSnapshotSha256: sha256(settledBillingSnapshot),
    providerTokenLogSnapshotPath,
    providerTokenLogSnapshotSha256: storedProviderTokenLogSnapshot?.sha256,
    originalIntent: storedIntent.bytes,
    originalReport: storedReport.bytes,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('AI image sandbox billing settlement', () => {
  it('writes one sanitized charged settlement without modifying original evidence', async () => {
    const value = await fixture();

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.replayed).toBe(false);
    expect(result.receipt).toMatchObject({
      schemaVersion: 1,
      event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
      operationId,
      endpointSha256: '3'.repeat(64),
      submitState: 'SUCCEEDED',
      billingOutcome: 'CHARGED',
      billingGate: 'PASS',
      actualCostCents: 10,
      billedUnits: 1,
      submissionAdapterRevision: 'a'.repeat(40),
      finalizationAdapterRevision: 'b'.repeat(40),
      sameRequestRetryAllowed: false,
    });
    expect(result.receipt).not.toHaveProperty('apiBaseSha256');
    expect(result.receipt).not.toHaveProperty('operationEndpointSha256');
    expect(await readFile(value.intentPath)).toEqual(value.originalIntent);
    expect(await readFile(value.reportPath)).toEqual(value.originalReport);
    const stored = await readFile(result.receiptPath, 'utf8');
    expect(stored).not.toContain(rawProviderRequestId);
    expect(stored).not.toContain('provider-account-main');
    expect(stored).not.toContain('private-ledger/');
    expect(stored).not.toContain('C:\\private');
    if (process.platform !== 'win32') {
      expect((await stat(result.receiptPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('finalizes current v4 reports with explicit API-base and operation-endpoint evidence', async () => {
    const value = await fixture({ reportSchemaVersion: 4 });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 2,
      event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
      apiBaseSha256: '6'.repeat(64),
      operationEndpointSha256: '3'.repeat(64),
      submitState: 'SUCCEEDED',
    });
    expect(result.receipt).not.toHaveProperty('endpointSha256');
  });

  it('finalizes one exact CNY settlement from closed integer meter evidence', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 3,
      event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
      apiBaseSha256: '6'.repeat(64),
      operationEndpointSha256: '3'.repeat(64),
      submitState: 'SUCCEEDED',
      billingOutcome: 'CHARGED',
      billingGate: 'PASS',
      actualCost: exactQuotedCost,
      billedUnits: 1,
      quotedCost: exactQuotedCost,
      maximumCost: exactMaximumCost,
      providerRequestIdHash: sha256(rawProviderRequestId),
    });
    for (const forbidden of [
      'currency',
      'actualCostCents',
      'quotedCostCents',
      'maximumCostCents',
      'meterEvidence',
      'rawQuotaDelta',
      'quotaUnitsPerCurrencyUnit',
      'displayTotalUsageDelta',
      'displayTotalUsageUnitCurrencyScale',
      'providerRequestId',
      'preCallBillingSnapshotPath',
      'settledBillingSnapshotPath',
      'providerBillingEntryRef',
    ]) {
      expect(result.receipt).not.toHaveProperty(forbidden);
    }
    const stored = await readFile(result.receiptPath, 'utf8');
    expect(stored).not.toContain(rawProviderRequestId);
    expect(stored).not.toContain('provider-account-main');
    expect(stored).not.toContain('private-ledger/');
    expect(stored).not.toContain('C:\\private');
    expect(stored).not.toContain('rawQuotaDelta');
    expect(stored).not.toContain('quotaUnitsPerCurrencyUnit');
    expect(await readFile(value.intentPath)).toEqual(value.originalIntent);
    expect(await readFile(value.reportPath)).toEqual(value.originalReport);
  });

  it('settles a definite Sub2 rejection from authenticated API-key cumulative zero usage', async () => {
    const bindings = sub2CumulativeZeroBindings();
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 4,
      ...bindings,
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 5,
      submitState: 'REJECTED',
      providerOutcomeResolved: true,
      correlationMethod: 'API_KEY_CUMULATIVE_ZERO_USAGE',
      providerRequestIdHash: sha256(rawProviderRequestId),
      billingOutcome: 'NO_CHARGE',
      billingGate: 'PASS',
      actualCost: { currency: 'USD', amount: 0, scale: 0 },
      billedUnits: 0,
      cumulativeUsageEvidenceKind: 'SUB2_API_KEY_CUMULATIVE_ZERO_USAGE_V1',
      settledBillingSnapshotSha256: value.settledBillingSnapshotSha256,
    });
    expect(result.receipt).not.toHaveProperty('preCallBillingSnapshotSha256');
  });

  it.each([
    ['requests', { usage: {
      today: { requests: 0, actual_cost: 0 },
      total: { requests: 1, actual_cost: 0 },
    } }],
    ['actual cost', { usage: {
      today: { requests: 0, actual_cost: 0 },
      total: { requests: 0, actual_cost: 0.01 },
    } }],
    ['currency', { unit: 'CNY', usage: {
      today: { requests: 0, actual_cost: 0 },
      total: { requests: 0, actual_cost: 0 },
    } }],
  ])('rejects Sub2 cumulative-zero evidence with nonzero or mismatched %s', async (_name, settledBillingSnapshotValue) => {
    const bindings = sub2CumulativeZeroBindings();
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 4,
      ...bindings,
      settledBillingSnapshotValue: {
        isValid: true,
        mode: 'unrestricted',
        unit: 'USD',
        ...settledBillingSnapshotValue,
      },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_EVIDENCE_INVALID' });
  });

  it.each([
    ['charged', {}, { billingOutcome: 'CHARGED', actualCost: { currency: 'USD', amount: 1, scale: 0 } }],
    ['unresolved', { state: 'RECONCILIATION_REQUIRED' }, {}],
    ['successful', { state: 'SUCCEEDED' }, {}],
  ])('rejects cumulative-zero settlement for a %s Provider outcome', async (_name, reportOverrides, attestationOverrides) => {
    const bindings = sub2CumulativeZeroBindings(reportOverrides);
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 4,
      ...bindings,
      attestationOverrides: {
        ...bindings.attestationOverrides,
        ...attestationOverrides,
      },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({
      code: _name === 'charged'
        ? 'SANDBOX_BILLING_ATTESTATION_INVALID'
        : 'SANDBOX_BILLING_MISMATCH',
    });
  });

  it.each([
    ['missing response-ID hash', { providerRequestIdHash: null }, {}],
  ])('rejects cumulative-zero correlation with %s', async (_name, reportOverrides, attestationOverrides) => {
    const bindings = sub2CumulativeZeroBindings(reportOverrides);
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 4,
      ...bindings,
      attestationOverrides: {
        ...bindings.attestationOverrides,
        ...attestationOverrides,
      },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('caps cumulative-zero settlement observation at 30 minutes', async () => {
    const bindings = sub2CumulativeZeroBindings();
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 4,
      ...bindings,
      attestationOverrides: {
        ...bindings.attestationOverrides,
        settledObservedAt: '2030-01-01T00:29:30.001Z',
      },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:35:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('keeps cumulative-zero attestation v4 closed and separate from before/after delta evidence', async () => {
    const bindings = sub2CumulativeZeroBindings();
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 4,
      ...bindings,
      attestationOverrides: {
        ...bindings.attestationOverrides,
        preCallBillingSnapshotPath: 'private/forbidden-before.json',
      },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_ATTESTATION_INVALID' });
  });

  it('recomputes and settles the Wanx async JSON request fingerprint', async () => {
    const bindings = wanxEvidenceBindings();
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
      requestFingerprint: bindings.requestFingerprint,
      intentOverrides: bindings.intentOverrides,
      reportOverrides: bindings.reportOverrides,
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 3,
      apiBaseSha256: sha256(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE),
      operationEndpointSha256: sha256(
        aiImageWanx21EditSubmitEndpoint(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE),
      ),
      submitState: 'SUCCEEDED',
      billingGate: 'PASS',
    });
  });

  it('rejects downgrading the Wanx API identity to a generic generation profile', async () => {
    const endpoint = `${AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE}/images/generations`;
    const endpointSha256 = sha256(endpoint);
    const apiBaseSha256 = sha256(AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE);
    const request = {
      operation: 'TEXT_TO_IMAGE',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      n: 1,
      width: 1024,
      height: 1024,
      size: '1024x1024',
      promptSha256: '4'.repeat(64),
      sourceSha256: [],
      sourceDimensions: [],
      maskSha256: null,
      maskDimensions: null,
      approvalEvidence: approvalEvidence({ currency: 'CNY' }),
    };
    const fingerprint = createAiImageSandboxRequestFingerprint({
      endpointSha256,
      model: AI_IMAGE_WANX21_EDIT_MODEL,
      request: {
        n: request.n,
        size: request.size,
        promptSha256: request.promptSha256,
        sourceSha256: request.sourceSha256,
        maskSha256: request.maskSha256,
      },
    });
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
      requestFingerprint: fingerprint,
      intentOverrides: {
        endpointSha256,
        apiBaseSha256,
        model: AI_IMAGE_WANX21_EDIT_MODEL,
        request,
      },
      reportOverrides: {
        provider: 'custom-openai-compatible',
        operation: request.operation,
        requestProfile: request.requestProfile,
        model: AI_IMAGE_WANX21_EDIT_MODEL,
        apiBaseSha256,
        operationEndpointSha256: endpointSha256,
        sourceSha256: [],
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('recomputes and settles the Packy multipart request fingerprint', async () => {
    const packyRequestFingerprint = createAiImageSandboxRequestFingerprint({
      endpointSha256: '3'.repeat(64),
      model: 'gpt-image-2',
      request: {
        operation: 'IMAGE_TO_IMAGE',
        requestProfile: AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
        multipartDialect: AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT,
        multipartFields: aiImageEditMultipartFields(AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT),
        n: 1,
        size: '1024x1024',
        promptSha256: '4'.repeat(64),
        sourceSha256: ['5'.repeat(64)],
        maskSha256: null,
      },
    });
    const value = await fixture({
      requestFingerprint: packyRequestFingerprint,
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
      intentOverrides: {
        model: 'gpt-image-2',
        request: {
          operation: 'IMAGE_TO_IMAGE',
          requestProfile: AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
          n: 1,
          width: 1024,
          height: 1024,
          size: '1024x1024',
          promptSha256: '4'.repeat(64),
          sourceSha256: ['5'.repeat(64)],
          sourceDimensions: [{ width: 1024, height: 1024 }],
          maskSha256: null,
          maskDimensions: null,
          approvalEvidence: approvalEvidence({ currency: 'CNY' }),
        },
      },
      reportOverrides: {
        operation: 'IMAGE_TO_IMAGE',
        requestProfile: AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE,
        model: 'gpt-image-2',
      },
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 3,
      submitState: 'SUCCEEDED',
      billingOutcome: 'CHARGED',
      billingGate: 'PASS',
    });
  });

  it('recomputes and settles the Xiaoyi multipart request fingerprint', async () => {
    const value = await fixture({
      ...xiaoyiEvidenceBindings(),
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 3,
      submitState: 'SUCCEEDED',
      billingOutcome: 'CHARGED',
      billingGate: 'PASS',
    });
  });

  it('recomputes and settles the Xiaoyi minimal V2 multipart request fingerprint', async () => {
    const legacyBindings = xiaoyiEvidenceBindings();
    const minimalBindings = xiaoyiEvidenceBindings({
      requestProfile: AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
    });
    expect(minimalBindings.requestFingerprint).not.toBe(legacyBindings.requestFingerprint);

    const value = await fixture({
      ...minimalBindings,
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 3,
      submitState: 'SUCCEEDED',
      billingOutcome: 'CHARGED',
      billingGate: 'PASS',
    });
  });

  it('rejects a Xiaoyi minimal V2 profile bound to the historical V1 fingerprint', async () => {
    const minimalBindings = xiaoyiEvidenceBindings({
      requestProfile: AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
    });
    const value = await fixture({
      ...minimalBindings,
      requestFingerprint: xiaoyiEvidenceBindings().requestFingerprint,
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('rejects internally consistent Xiaoyi minimal V2 evidence forged with the default dialect', async () => {
    const minimalBindings = xiaoyiEvidenceBindings({
      requestProfile: AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
    });
    const forgedFingerprint = createAiImageSandboxRequestFingerprint({
      endpointSha256: sha256(AI_IMAGE_XIAOYI_EDIT_PROFILE.endpoint),
      model: AI_IMAGE_XIAOYI_EDIT_PROFILE.model,
      request: {
        operation: 'IMAGE_TO_IMAGE',
        requestProfile: AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
        multipartDialect: AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT,
        multipartFields: aiImageEditMultipartFields(AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT),
        n: 1,
        size: '1024x1024',
        promptSha256: '4'.repeat(64),
        sourceSha256: ['5'.repeat(64)],
        maskSha256: null,
      },
    });
    expect(forgedFingerprint).not.toBe(minimalBindings.requestFingerprint);
    expect(
      aiImageEditMultipartDialectForRequestProfile(
        AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE,
      ),
    ).toBe(AI_IMAGE_XIAOYI_MINIMAL_EDIT_MULTIPART_DIALECT);

    const value = await fixture({
      ...minimalBindings,
      requestFingerprint: forgedFingerprint,
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it.each([
    ['model', { model: 'other-model' }],
    ['endpoint', { endpoint: 'https://image.xiaoyiapi.xyz/v1/images/generations' }],
    ['API Base', { apiBaseSha256: sha256('https://image.xiaoyiapi.xyz/v2') }],
    ['operation', { operation: 'FULL_EDIT' as const }],
  ])('rejects internally consistent Xiaoyi evidence with a mismatched %s', async (
    _field,
    overrides,
  ) => {
    const value = await fixture({
      ...xiaoyiEvidenceBindings(overrides),
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)(
    'rejects internally consistent Xiaoyi %s evidence under the generic profile',
    async (operation) => {
      const value = await fixture({
        ...xiaoyiEvidenceBindings({ operation, requestProfile: 'OPENAI_SQUARE_SINGLE_V1' }),
        intentSchemaVersion: 3,
        reportSchemaVersion: 5,
        attestationSchemaVersion: 2,
      });

      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
    },
  );

  it('rejects internally consistent legacy-cents Xiaoyi profile evidence', async () => {
    const bindings = xiaoyiEvidenceBindings({ currency: 'USD' });
    const exactIntentOverrides = bindings.intentOverrides as Record<string, unknown>;
    const exactReportOverrides = bindings.reportOverrides as Record<string, unknown>;
    const value = await fixture({
      requestFingerprint: bindings.requestFingerprint,
      intentSchemaVersion: 2,
      reportSchemaVersion: 3,
      attestationSchemaVersion: 1,
      intentOverrides: {
        endpointSha256: exactIntentOverrides.endpointSha256,
        model: exactIntentOverrides.model,
        request: exactIntentOverrides.request,
      },
      reportOverrides: {
        operation: exactReportOverrides.operation,
        requestProfile: exactReportOverrides.requestProfile,
        model: exactReportOverrides.model,
        endpointSha256: exactIntentOverrides.endpointSha256,
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('rejects legacy-cents Xiaoyi route evidence under the generic profile', async () => {
    const bindings = xiaoyiEvidenceBindings({
      operation: 'FULL_EDIT',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      currency: 'USD',
    });
    const exactIntentOverrides = bindings.intentOverrides as Record<string, unknown>;
    const exactReportOverrides = bindings.reportOverrides as Record<string, unknown>;
    const value = await fixture({
      requestFingerprint: bindings.requestFingerprint,
      intentSchemaVersion: 2,
      reportSchemaVersion: 3,
      attestationSchemaVersion: 1,
      intentOverrides: {
        endpointSha256: exactIntentOverrides.endpointSha256,
        model: exactIntentOverrides.model,
        request: exactIntentOverrides.request,
      },
      reportOverrides: {
        operation: exactReportOverrides.operation,
        requestProfile: exactReportOverrides.requestProfile,
        model: exactReportOverrides.model,
        endpointSha256: exactIntentOverrides.endpointSha256,
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('finalizes exact billing from one private Provider token-log entry', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      schemaVersion: 4,
      correlationMethod: 'PROVIDER_TOKEN_LOG_ENTRY',
      providerRequestIdHash: sha256(rawProviderRequestId),
      providerBillingEntryRequestIdHash: sha256(providerBillingRequestId),
      providerRequestIdBridge: 'UNAVAILABLE_UNIQUE_ENTRY',
      providerTokenLogSnapshotSha256: value.providerTokenLogSnapshotSha256,
      actualCost: exactQuotedCost,
      billingGate: 'PASS',
    });
    const stored = await readFile(result.receiptPath, 'utf8');
    expect(stored).not.toContain(rawProviderRequestId);
    expect(stored).not.toContain(providerBillingRequestId);
    expect(stored).not.toContain(value.providerTokenLogSnapshotPath);
  });

  it('binds the reviewed Xiaoyi image API to its separate billing origin', async () => {
    const value = await fixture({
      ...xiaoyiEvidenceBindings(),
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
      providerLogRequestOverrides: {
        uri: `${AI_IMAGE_XIAOYI_BILLING_ORIGIN}/api/log/token`,
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({
      receipt: {
        schemaVersion: 4,
        apiBaseSha256: xiaoyiApiBaseSha256,
        correlationMethod: 'PROVIDER_TOKEN_LOG_ENTRY',
        billingGate: 'PASS',
      },
    });
  });

  it.each([
    ['image API host', 'https://image.xiaoyiapi.xyz/api/log/token'],
    ['unreviewed third-party host', 'https://billing.example/api/log/token'],
  ])('rejects Xiaoyi billing evidence from the %s', async (_source, uri) => {
    const value = await fixture({
      ...xiaoyiEvidenceBindings(),
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
      providerLogRequestOverrides: { uri },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('rejects the Xiaoyi edit identity under the generic request profile', async () => {
    const endpointSha256 = sha256(AI_IMAGE_XIAOYI_EDIT_PROFILE.endpoint);
    const request = {
      ...exactIntent().request,
      operation: 'IMAGE_TO_IMAGE',
    };
    const genericFingerprint = createAiImageSandboxRequestFingerprint({
      endpointSha256,
      model: AI_IMAGE_XIAOYI_EDIT_PROFILE.model,
      request: {
        n: Number(request.n),
        size: String(request.size),
        promptSha256: String(request.promptSha256),
        sourceSha256: request.sourceSha256 as string[],
        maskSha256: request.maskSha256 as string | null,
      },
    });
    const value = await fixture({
      requestFingerprint: genericFingerprint,
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
      intentOverrides: {
        endpointSha256,
        apiBaseSha256: xiaoyiApiBaseSha256,
        model: AI_IMAGE_XIAOYI_EDIT_PROFILE.model,
        request,
      },
      reportOverrides: {
        operation: 'IMAGE_TO_IMAGE',
        model: AI_IMAGE_XIAOYI_EDIT_PROFILE.model,
        apiBaseSha256: xiaoyiApiBaseSha256,
        operationEndpointSha256: endpointSha256,
      },
      providerLogEntryOverrides: { model_name: AI_IMAGE_XIAOYI_EDIT_PROFILE.model },
      providerLogRequestOverrides: {
        uri: `${AI_IMAGE_XIAOYI_BILLING_ORIGIN}/api/log/token`,
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('does not let the reviewed Xiaoyi billing origin settle another API Base', async () => {
    const mainSiteApiBaseSha256 = sha256(`${AI_IMAGE_XIAOYI_BILLING_ORIGIN}/v1`);
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
      intentOverrides: { apiBaseSha256: mainSiteApiBaseSha256 },
      reportOverrides: { apiBaseSha256: mainSiteApiBaseSha256 },
      providerLogRequestOverrides: {
        uri: `${AI_IMAGE_XIAOYI_BILLING_ORIGIN}/api/log/token`,
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it.each([
    ['quota', { providerLogEntryOverrides: { quota: 5_951 } }],
    ['model', { providerLogEntryOverrides: { model_name: 'other-model' } }],
    ['request path', {
      providerLogEntryOverrides: {
        other: JSON.stringify({ request_path: '/v1/images/generations' }),
      },
    }],
    ['request ID', { providerLogEntryOverrides: { request_id: 'other-request' } }],
    ['user account', { providerLogEntryOverrides: { user_id: 3 } }],
    ['API token', { providerLogEntryOverrides: { token_id: 5 } }],
    ['completion time', { providerLogEntryOverrides: { created_at: 1_893_456_130 } }],
  ] as const)(
    'rejects Provider token-log evidence with mismatched %s',
    async (_field, overrides) => {
      const value = await fixture({
        intentSchemaVersion: 3,
        reportSchemaVersion: 5,
        attestationSchemaVersion: 3,
        ...overrides,
      });

      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
    },
  );

  it('requires one unique full-feature Token-log candidate', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
      providerLogBodyOverrides: {
        data: [
          providerTokenLogEntry(),
          providerTokenLogEntry({ request_id: 'second-similar-request' }),
        ],
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('binds an available upstream log request ID to the submit report hash', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
      providerLogEntryOverrides: { upstream_request_id: rawProviderRequestId },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({
      receipt: { providerRequestIdBridge: 'UPSTREAM_REQUEST_ID' },
    });

    const mismatch = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
      providerLogEntryOverrides: { upstream_request_id: 'different-upstream-request' },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: mismatch.root,
      evidenceRoot: mismatch.root,
      operationId,
      settlementPath: mismatch.settlementPath,
      settlementSha256: mismatch.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('rejects reuse of one Provider billing entry across Operations', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
    });
    const providerBillingEntryKey = sha256(canonicalJson({
      apiBaseSha256: providerApiBaseSha256,
      providerTokenLogUserId: 2,
      providerTokenLogTokenId: 4,
      providerBillingEntryRequestIdHash: sha256(providerBillingRequestId),
    }));
    await writeCanonicalJson(
      join(value.root, 'billing', '.provider-entries', `${providerBillingEntryKey}.claim.json`),
      {
        schemaVersion: 1,
        providerBillingEntryKey,
        providerAccountRefSha256: sha256('provider-account-main'),
        operationId: 'different-sandbox-operation-0001',
        settlementSha256: '7'.repeat(64),
        requestFingerprint: '9'.repeat(64),
        submitReportSha256: '8'.repeat(64),
        providerTokenLogSnapshotSha256: value.providerTokenLogSnapshotSha256,
        state: 'PROVIDER_BILLING_ENTRY_CLAIMED',
      },
    );

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFLICT' });
  });

  it('does not partition one Provider entry by a renamed account reference', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
    });
    const providerBillingEntryKey = sha256(canonicalJson({
      apiBaseSha256: providerApiBaseSha256,
      providerTokenLogUserId: 2,
      providerTokenLogTokenId: 4,
      providerBillingEntryRequestIdHash: sha256(providerBillingRequestId),
    }));
    await writeCanonicalJson(
      join(value.root, 'billing', '.provider-entries', `${providerBillingEntryKey}.claim.json`),
      {
        schemaVersion: 1,
        providerBillingEntryKey,
        providerAccountRefSha256: sha256('renamed-account-label'),
        operationId,
        settlementSha256: value.settlementSha256,
        requestFingerprint,
        submitReportSha256: sha256(value.originalReport),
        providerTokenLogSnapshotSha256: value.providerTokenLogSnapshotSha256,
        state: 'PROVIDER_BILLING_ENTRY_CLAIMED',
      },
    );

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFLICT' });
  });

  it('rejects a changed attestation after an isolated Provider entry claim', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
    });
    const providerBillingEntryKey = sha256(canonicalJson({
      apiBaseSha256: providerApiBaseSha256,
      providerTokenLogUserId: 2,
      providerTokenLogTokenId: 4,
      providerBillingEntryRequestIdHash: sha256(providerBillingRequestId),
    }));
    await writeCanonicalJson(
      join(value.root, 'billing', '.provider-entries', `${providerBillingEntryKey}.claim.json`),
      {
        schemaVersion: 1,
        providerBillingEntryKey,
        providerAccountRefSha256: sha256('provider-account-main'),
        operationId,
        settlementSha256: value.settlementSha256,
        requestFingerprint,
        submitReportSha256: sha256(value.originalReport),
        providerTokenLogSnapshotSha256: value.providerTokenLogSnapshotSha256,
        state: 'PROVIDER_BILLING_ENTRY_CLAIMED',
      },
    );
    const changedAttestation = JSON.parse(
      await readFile(value.settlementPath, 'utf8'),
    ) as Record<string, unknown>;
    changedAttestation.settlementId = 'settlement-after-isolated-provider-claim';
    const changedPath = join(
      value.root,
      'private',
      'changed-provider-claim.billing-attestation.json',
    );
    const changed = await writeCanonicalJson(
      changedPath,
      changedAttestation,
    );

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: changedPath,
      settlementSha256: changed.sha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFLICT' });
  });

  it('returns the immutable Token-log receipt across a compatible finalizer revision', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 3,
    });
    const input = {
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    };

    const first = await finalizeAiImageSandboxBillingSettlement(input);
    const replay = await finalizeAiImageSandboxBillingSettlement({
      ...input,
      finalizationAdapterRevision: 'c'.repeat(40),
    });

    expect(replay).toMatchObject({ replayed: true, receipt: first.receipt });
    expect(replay.receipt.finalizationAdapterRevision).toBe('b'.repeat(40));
  });

  it.each([
    ['body digest', { providerLogRequestOverrides: { bodySha256: 'f'.repeat(64) } }],
    ['HTTP method', { providerLogRequestOverrides: { method: 'POST' } }],
    ['HTTP status', { providerLogRequestOverrides: { httpStatus: 201 } }],
    ['API origin', {
      providerLogRequestOverrides: { uri: 'https://other-relay.example/api/log/token' },
    }],
    ['duration', { providerLogEntryOverrides: { use_time: 71 } }],
    ['open snapshot field', { providerLogSnapshotOverrides: { authorization: 'forbidden' } }],
  ] as const)(
    'rejects unsafe Provider Token-log %s evidence',
    async (_field, overrides) => {
      const value = await fixture({
        intentSchemaVersion: 3,
        reportSchemaVersion: 5,
        attestationSchemaVersion: 3,
        ...overrides,
      });
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({
        code: expect.stringMatching(/^SANDBOX_BILLING_(?:EVIDENCE_INVALID|MISMATCH)$/u),
      });
    },
  );

  it('rejects an exact report whose API Base digest differs from the immutable intent', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
      reportOverrides: { apiBaseSha256: '7'.repeat(64) },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('retains exact v2 no-charge semantics for a rejected request', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
      reportOverrides: {
        state: 'REJECTED',
        providerRequestIdHash: null,
        failureCode: 'PROVIDER_REJECTED',
      },
      attestationOverrides: {
        correlationMethod: 'UNIQUE_ACCOUNT_TIME_WINDOW',
        providerRequestId: null,
        billingOutcome: 'NO_CHARGE',
        actualCost: { currency: 'CNY', amount: 0, scale: 4 },
        meterEvidence: exactMeterEvidence({
          rawQuotaDelta: 0,
          displayTotalUsageDelta: { amount: 0, scale: 0 },
        }),
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({
      receipt: {
        schemaVersion: 3,
        billingOutcome: 'NO_CHARGE',
        actualCost: { currency: 'CNY', amount: 0, scale: 4 },
        billedUnits: 0,
      },
    });
  });

  it('records an exact over-maximum charge without rounding it to cents', async () => {
    const value = await fixture({
      intentSchemaVersion: 3,
      reportSchemaVersion: 5,
      attestationSchemaVersion: 2,
      attestationOverrides: {
        actualCost: { currency: 'CNY', amount: 1_001, scale: 4 },
        meterEvidence: exactMeterEvidence({
          rawQuotaDelta: 50_050,
          displayTotalUsageDelta: { amount: 1_001, scale: 2 },
        }),
      },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({
      receipt: {
        billingGate: 'COST_LIMIT_EXCEEDED',
        actualCost: { currency: 'CNY', amount: 1_001, scale: 4 },
      },
    });
  });

  it.each([
    [2, 5, 2],
    [3, 4, 2],
    [3, 5, 1],
    [2, 4, 2],
  ] as const)(
    'rejects cross-generation settlement mix intent v%s / report v%s / attestation v%s',
    async (intentSchemaVersion, reportSchemaVersion, attestationSchemaVersion) => {
      const value = await fixture({
        intentSchemaVersion,
        reportSchemaVersion,
        attestationSchemaVersion,
      });

      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
    },
  );

  it('rejects non-exact or open quota and total-usage meter evidence', async () => {
    const invalidMeterEvidence = [
      exactMeterEvidence({ rawQuotaDelta: 5_951 }),
      exactMeterEvidence({ displayTotalUsageDelta: { amount: 120, scale: 2 } }),
      exactMeterEvidence({ privateBalanceBefore: 12_345 }),
      exactMeterEvidence({ quotaUnitsPerCurrencyUnit: 500_000.5 }),
    ];

    for (const meterEvidence of invalidMeterEvidence) {
      const value = await fixture({
        intentSchemaVersion: 3,
        reportSchemaVersion: 5,
        attestationSchemaVersion: 2,
        attestationOverrides: { meterEvidence },
      });
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_ATTESTATION_INVALID' });
    }
  });

  it('keeps historical v1/v2 receipts free of exact-money fields', async () => {
    for (const reportSchemaVersion of [3, 4] as const) {
      const value = await fixture({ reportSchemaVersion });
      const result = await finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      });

      expect(result.receipt).toMatchObject({
        schemaVersion: reportSchemaVersion === 4 ? 2 : 1,
        currency: 'USD',
        actualCostCents: 10,
        quotedCostCents: 10,
        maximumCostCents: 20,
      });
      expect(result.receipt).not.toHaveProperty('actualCost');
      expect(result.receipt).not.toHaveProperty('quotedCost');
      expect(result.receipt).not.toHaveProperty('maximumCost');
      expect(Object.keys(result.receipt)).toEqual([
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
        ...(reportSchemaVersion === 4
          ? ['apiBaseSha256', 'operationEndpointSha256']
          : ['endpointSha256']),
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
        'currency',
        'billingOutcome',
        'billingGate',
        'actualCostCents',
        'billedUnits',
        'quotedCostCents',
        'maximumCostCents',
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
      expect(await readFile(result.receiptPath, 'utf8')).toBe(
        `${JSON.stringify(result.receipt, null, 2)}\n`,
      );
    }
  });

  it('rejects v4 report hashes that do not bind the claimed operation endpoint', async () => {
    const value = await fixture({
      reportSchemaVersion: 4,
      reportOverrides: { operationEndpointSha256: '7'.repeat(64) },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('returns the immutable record for exact replay and conflicts on a changed decision', async () => {
    const value = await fixture();
    const input = {
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    };
    const first = await finalizeAiImageSandboxBillingSettlement(input);
    const replay = await finalizeAiImageSandboxBillingSettlement({
      ...input,
      finalizationAdapterRevision: 'c'.repeat(40),
    });
    expect(replay).toMatchObject({ replayed: true, receipt: first.receipt });
    expect(replay.receipt.finalizationAdapterRevision).toBe('b'.repeat(40));

    const changed = await writeCanonicalJson(
      join(value.root, 'private', 'changed.billing-attestation.json'),
      attestation({
        intentSha256: sha256(value.originalIntent),
        reportSha256: sha256(value.originalReport),
        fingerprintClaimSha256: sha256(await readFile(value.claimPath)),
        preCallBillingSnapshotPath: value.preCallBillingSnapshotPath,
        settledBillingSnapshotPath: value.settledBillingSnapshotPath,
        preCallBillingSnapshotSha256: value.preCallBillingSnapshotSha256,
        settledBillingSnapshotSha256: value.settledBillingSnapshotSha256,
      }, { actualCostCents: 11 }),
    );
    await expect(finalizeAiImageSandboxBillingSettlement({
      ...input,
      settlementPath: join(value.root, 'private', 'changed.billing-attestation.json'),
      settlementSha256: changed.sha256,
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFLICT' });
  });

  it('requires the original revision to recover an incomplete settlement claim', async () => {
    const value = await fixture();
    const receiptPath = join(value.root, 'billing', `${operationId}.billing.settlement.json`);
    await writeCanonicalJson(
      join(value.root, 'billing', '.claims', `${operationId}.billing.claim.json`),
      {
        schemaVersion: 1,
        operationId,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        state: 'BILLING_SETTLEMENT_CLAIMED',
      },
    );

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'c'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFLICT' });
    await expect(readFile(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const incompatibleReceipt = await writeCanonicalJson(receiptPath, {
      schemaVersion: 1,
      event: 'INCOMPLETE_RECEIPT_MUST_NOT_BE_REPLACED',
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'c'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFLICT' });
    expect(await readFile(receiptPath)).toEqual(incompatibleReceipt.bytes);
  });

  it('rejects two snapshot aliases that resolve to the same physical file', async () => {
    const value = await fixture();
    const privateAlias = join(value.root, 'private-alias');
    await symlink(
      join(value.root, 'private'),
      privateAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const aliasSettlementPath = join(
      value.root,
      'private',
      `${operationId}.alias.billing-attestation.json`,
    );
    const aliasSettlement = await writeCanonicalJson(aliasSettlementPath, attestation({
      intentSha256: sha256(value.originalIntent),
      reportSha256: sha256(value.originalReport),
      fingerprintClaimSha256: sha256(await readFile(value.claimPath)),
      preCallBillingSnapshotPath: value.preCallBillingSnapshotPath,
      settledBillingSnapshotPath: join(privateAlias, 'billing-before.snapshot'),
      preCallBillingSnapshotSha256: value.preCallBillingSnapshotSha256,
      settledBillingSnapshotSha256: value.preCallBillingSnapshotSha256,
    }));

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: aliasSettlementPath,
      settlementSha256: aliasSettlement.sha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_ATTESTATION_INVALID' });
  });

  it('rejects an output parent link before creating files outside the evidence root', async () => {
    const value = await fixture();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-billing-output-outside-'));
    directories.push(outsideRoot);
    await symlink(
      outsideRoot,
      join(value.root, 'billing'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });
    expect(await readdir(outsideRoot)).toEqual([]);
  });

  it('records an over-maximum charge without changing an unresolved Provider state', async () => {
    const value = await fixture({
      reportOverrides: {
        state: 'RECONCILIATION_REQUIRED',
        failureCode: 'UPSTREAM_OUTCOME_UNKNOWN',
      },
      attestationOverrides: { actualCostCents: 25 },
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });

    expect(result.receipt).toMatchObject({
      submitState: 'RECONCILIATION_REQUIRED',
      billingGate: 'COST_LIMIT_EXCEEDED',
      actualCostCents: 25,
      providerOutcomeResolved: false,
      sameRequestRetryAllowed: false,
    });
  });

  it('supports an explicit no-charge account-window correlation when no request ID exists', async () => {
    const value = await fixture({
      reportOverrides: {
        state: 'REJECTED',
        providerRequestIdHash: null,
        failureCode: 'PROVIDER_REJECTED',
      },
      attestationOverrides: {
        correlationMethod: 'UNIQUE_ACCOUNT_TIME_WINDOW',
        providerRequestId: null,
        billingOutcome: 'NO_CHARGE',
        actualCostCents: 0,
      },
    });

    const result = await finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    });
    expect(result.receipt).toMatchObject({
      submitState: 'REJECTED',
      correlationMethod: 'UNIQUE_ACCOUNT_TIME_WINDOW',
      billingOutcome: 'NO_CHARGE',
      actualCostCents: 0,
      billedUnits: 0,
    });
  });

  it('allows post-call settlement after the original approval has expired', async () => {
    const value = await fixture();
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T01:00:00.000Z'),
    })).resolves.toMatchObject({ receipt: { billingGate: 'PASS' } });
  });

  it('rejects a changed private attestation before reading or writing terminal evidence', async () => {
    const value = await fixture();
    await writeFile(value.settlementPath, '{}\n');

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_DIGEST_MISMATCH' });
    await expect(readFile(join(value.root, 'billing', `${operationId}.billing.settlement.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects pre-dispatch reports and reports whose original cost was already mutated', async () => {
    for (const reportOverrides of [
      { state: 'PRE_DISPATCH_FAILED', createRequests: 0, providerRequestIdHash: null },
      { actualCostCents: 10 },
    ]) {
      const value = await fixture({ reportOverrides });
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_EVIDENCE_INVALID' });
    }
  });

  it('rejects request-ID, account, digest, and cross-artifact mismatches before output', async () => {
    const cases = [
      { providerRequestId: 'wrong-provider-request' },
      { providerAccountRef: 'wrong-provider-account' },
      { requestFingerprint: '8'.repeat(64) },
      { submitReportSha256: '9'.repeat(64) },
    ];
    for (const attestationOverrides of cases) {
      const value = await fixture({ attestationOverrides });
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toBeDefined();
      await expect(readFile(join(value.root, 'billing', `${operationId}.billing.settlement.json`)))
        .rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('rejects open secret-bearing attestations and inconsistent charge outcomes', async () => {
    for (const attestationOverrides of [
      { apiKey: 'must-never-be-accepted' },
      { billingOutcome: 'NO_CHARGE', actualCostCents: 1 },
      { billingOutcome: 'CHARGED', actualCostCents: 0 },
      { settledObservedAt: '2030-01-01T00:01:30.000Z' },
    ]) {
      const value = await fixture({ attestationOverrides });
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toBeDefined();
    }
  });

  it('recomputes the transport fingerprint instead of trusting mutually forged artifacts', async () => {
    const value = await fixture({
      intentOverrides: { model: 'forged-different-model' },
      reportOverrides: { model: 'forged-different-model' },
    });

    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('rejects unverified snapshot bytes and invalid approval-time chronology', async () => {
    const changedSnapshot = await fixture();
    await writeFile(changedSnapshot.settledBillingSnapshotPath, 'changed after attestation\n');
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: changedSnapshot.root,
      evidenceRoot: changedSnapshot.root,
      operationId,
      settlementPath: changedSnapshot.settlementPath,
      settlementSha256: changedSnapshot.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_DIGEST_MISMATCH' });

    for (const value of [
      await fixture({
        attestationOverrides: { preCallObservedAt: '2030-01-01T00:00:01.000Z' },
      }),
      await fixture({
        reportOverrides: {
          startedAt: '2030-01-01T00:31:00.000Z',
          completedAt: '2030-01-01T00:32:00.000Z',
        },
        attestationOverrides: { settledObservedAt: '2030-01-01T00:35:00.000Z' },
      }),
      await fixture({ claimOverrides: { createdAt: '2030-01-01T00:00:00.001Z' } }),
      await fixture({
        reportOverrides: {
          startedAt: '2030-01-01T00:06:00.000Z',
          completedAt: '2030-01-01T00:07:00.000Z',
        },
        attestationOverrides: {
          preCallObservedAt: '2029-12-31T23:50:00.000Z',
          settledObservedAt: '2030-01-01T00:08:00.000Z',
        },
      }),
    ]) {
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:40:00.000Z'),
      })).rejects.toBeDefined();
    }
  });

  it('enforces exact 15-minute billing-correlation and snapshot-age boundaries', async () => {
    const exactSnapshotAge = await fixture({
      attestationOverrides: { preCallObservedAt: '2029-12-31T23:46:00.000Z' },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: exactSnapshotAge.root,
      evidenceRoot: exactSnapshotAge.root,
      operationId,
      settlementPath: exactSnapshotAge.settlementPath,
      settlementSha256: exactSnapshotAge.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({ receipt: { billingGate: 'PASS' } });

    const staleByOneMillisecond = await fixture({
      attestationOverrides: { preCallObservedAt: '2029-12-31T23:45:59.999Z' },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: staleByOneMillisecond.root,
      evidenceRoot: staleByOneMillisecond.root,
      operationId,
      settlementPath: staleByOneMillisecond.settlementPath,
      settlementSha256: staleByOneMillisecond.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });

    const noRequestIdReport = {
      state: 'REJECTED',
      providerRequestIdHash: null,
      failureCode: 'PROVIDER_REJECTED',
    };
    const noChargeAttestation = {
      preCallObservedAt: '2029-12-31T23:59:30.000Z',
      correlationMethod: 'UNIQUE_ACCOUNT_TIME_WINDOW',
      providerRequestId: null,
      billingOutcome: 'NO_CHARGE',
      actualCostCents: 0,
    };
    const exactCorrelationWindow = await fixture({
      reportOverrides: noRequestIdReport,
      attestationOverrides: {
        ...noChargeAttestation,
        settledObservedAt: '2030-01-01T00:14:30.000Z',
      },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: exactCorrelationWindow.root,
      evidenceRoot: exactCorrelationWindow.root,
      operationId,
      settlementPath: exactCorrelationWindow.settlementPath,
      settlementSha256: exactCorrelationWindow.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:15:00.000Z'),
    })).resolves.toMatchObject({ receipt: { correlationMethod: 'UNIQUE_ACCOUNT_TIME_WINDOW' } });

    const correlationTooWide = await fixture({
      reportOverrides: noRequestIdReport,
      attestationOverrides: {
        ...noChargeAttestation,
        settledObservedAt: '2030-01-01T00:14:30.001Z',
      },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: correlationTooWide.root,
      evidenceRoot: correlationTooWide.root,
      operationId,
      settlementPath: correlationTooWide.settlementPath,
      settlementSha256: correlationTooWide.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:15:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('enforces exact five-minute clock skew and approval-expiry boundaries', async () => {
    const exactFutureObservation = await fixture();
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: exactFutureObservation.root,
      evidenceRoot: exactFutureObservation.root,
      operationId,
      settlementPath: exactFutureObservation.settlementPath,
      settlementSha256: exactFutureObservation.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })).resolves.toMatchObject({ receipt: { settledObservedAt: '2030-01-01T00:05:00.000Z' } });

    const futureByOneMillisecond = await fixture({
      attestationOverrides: { settledObservedAt: '2030-01-01T00:05:00.001Z' },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: futureByOneMillisecond.root,
      evidenceRoot: futureByOneMillisecond.root,
      operationId,
      settlementPath: futureByOneMillisecond.settlementPath,
      settlementSha256: futureByOneMillisecond.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_ATTESTATION_INVALID' });

    const exactApprovalSkew = await fixture({
      approvalOverrides: { approvedAt: '2030-01-01T00:05:00.000Z' },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: exactApprovalSkew.root,
      evidenceRoot: exactApprovalSkew.root,
      operationId,
      settlementPath: exactApprovalSkew.settlementPath,
      settlementSha256: exactApprovalSkew.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({ receipt: { billingGate: 'PASS' } });

    const approvalSkewTooWide = await fixture({
      approvalOverrides: { approvedAt: '2030-01-01T00:05:00.001Z' },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: approvalSkewTooWide.root,
      evidenceRoot: approvalSkewTooWide.root,
      operationId,
      settlementPath: approvalSkewTooWide.settlementPath,
      settlementSha256: approvalSkewTooWide.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });

    const startsAtExpiry = await fixture({
      reportOverrides: {
        startedAt: '2030-01-01T00:30:00.000Z',
        completedAt: '2030-01-01T00:31:00.000Z',
      },
      attestationOverrides: { settledObservedAt: '2030-01-01T00:32:00.000Z' },
    });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: startsAtExpiry.root,
      evidenceRoot: startsAtExpiry.root,
      operationId,
      settlementPath: startsAtExpiry.settlementPath,
      settlementSha256: startsAtExpiry.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:33:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_MISMATCH' });
  });

  it('rejects duplicate-key, invalid UTF-8, and oversized private attestations', async () => {
    const cases = [
      async (value: Awaited<ReturnType<typeof fixture>>) => {
        const canonical = await readFile(value.settlementPath, 'utf8');
        return Buffer.from(canonical.replace(
          '  "schemaVersion": 1,\n',
          '  "schemaVersion": 1,\n  "schemaVersion": 1,\n',
        ), 'utf8');
      },
      async () => Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d, 0x0a]),
      async () => Buffer.alloc(32 * 1024 + 1, 0x20),
    ];

    for (const createBytes of cases) {
      const value = await fixture();
      const bytes = await createBytes(value);
      await writeFile(value.settlementPath, bytes);
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: value.root,
        evidenceRoot: value.root,
        operationId,
        settlementPath: value.settlementPath,
        settlementSha256: sha256(bytes),
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toBeDefined();
    }
  });

  it.skipIf(process.platform === 'win32')(
    'rejects unsafe file/root boundaries while allowing the deployed evidence-root link',
    async () => {
      const broadMode = await fixture();
      await chmod(broadMode.settlementPath, 0o644);
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: broadMode.root,
        evidenceRoot: broadMode.root,
        operationId,
        settlementPath: broadMode.settlementPath,
        settlementSha256: broadMode.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });

      const linkedAttestation = await fixture();
      const attestationLink = join(linkedAttestation.root, 'private', 'linked-attestation.json');
      await symlink(linkedAttestation.settlementPath, attestationLink, 'file');
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: linkedAttestation.root,
        evidenceRoot: linkedAttestation.root,
        operationId,
        settlementPath: attestationLink,
        settlementSha256: linkedAttestation.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });

      const linkedRoot = await fixture();
      const evidenceRootLink = `${linkedRoot.root}-link`;
      await symlink(linkedRoot.root, evidenceRootLink, 'dir');
      directories.push(evidenceRootLink);
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: linkedRoot.root,
        evidenceRoot: evidenceRootLink,
        operationId,
        settlementPath: linkedRoot.settlementPath,
        settlementSha256: linkedRoot.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).resolves.toMatchObject({ receipt: { billingGate: 'PASS' } });

      const escapedEvidence = await fixture();
      const outsideRoot = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-billing-outside-'));
      directories.push(outsideRoot);
      const outsideIntents = join(outsideRoot, 'intents');
      await rename(join(escapedEvidence.root, 'intents'), outsideIntents);
      await symlink(outsideIntents, join(escapedEvidence.root, 'intents'), 'dir');
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: escapedEvidence.root,
        evidenceRoot: escapedEvidence.root,
        operationId,
        settlementPath: escapedEvidence.settlementPath,
        settlementSha256: escapedEvidence.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });

      const fifoEvidence = await fixture();
      const fifoPath = join(fifoEvidence.root, 'private', 'attestation.fifo');
      expect(spawnSync('mkfifo', [fifoPath]).status).toBe(0);
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: fifoEvidence.root,
        evidenceRoot: fifoEvidence.root,
        operationId,
        settlementPath: fifoPath,
        settlementSha256: fifoEvidence.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });

      const preCallSnapshotBytes = Buffer.from(
        'private Provider balance before request\n',
        'utf8',
      );
      const hardLinkedSnapshots = await fixture({
        attestationOverrides: {
          settledBillingSnapshotSha256: sha256(preCallSnapshotBytes),
        },
      });
      await rm(hardLinkedSnapshots.settledBillingSnapshotPath);
      await link(
        hardLinkedSnapshots.preCallBillingSnapshotPath,
        hardLinkedSnapshots.settledBillingSnapshotPath,
      );
      await expect(finalizeAiImageSandboxBillingSettlement({
        repositoryRoot: hardLinkedSnapshots.root,
        evidenceRoot: hardLinkedSnapshots.root,
        operationId,
        settlementPath: hardLinkedSnapshots.settlementPath,
        settlementSha256: hardLinkedSnapshots.settlementSha256,
        finalizationAdapterRevision: 'b'.repeat(40),
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_ATTESTATION_INVALID' });
    },
  );

  it('serializes concurrent identical settlements with one claim owner', async () => {
    const value = await fixture();
    const input = {
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      settlementPath: value.settlementPath,
      settlementSha256: value.settlementSha256,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    };
    const results = await Promise.all([
      finalizeAiImageSandboxBillingSettlement(input),
      finalizeAiImageSandboxBillingSettlement(input),
    ]);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results[0]?.receipt).toEqual(results[1]?.receipt);
  });

  it('serializes concurrent changed decisions so only one settlement can win', async () => {
    const value = await fixture();
    const changed = await writeCanonicalJson(
      join(value.root, 'private', 'concurrent-changed.billing-attestation.json'),
      attestation({
        intentSha256: sha256(value.originalIntent),
        reportSha256: sha256(value.originalReport),
        fingerprintClaimSha256: sha256(await readFile(value.claimPath)),
        preCallBillingSnapshotPath: value.preCallBillingSnapshotPath,
        settledBillingSnapshotPath: value.settledBillingSnapshotPath,
        preCallBillingSnapshotSha256: value.preCallBillingSnapshotSha256,
        settledBillingSnapshotSha256: value.settledBillingSnapshotSha256,
      }, { actualCostCents: 11 }),
    );
    const base = {
      repositoryRoot: value.root,
      evidenceRoot: value.root,
      operationId,
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date('2030-01-01T00:10:00.000Z'),
    };
    const results = await Promise.allSettled([
      finalizeAiImageSandboxBillingSettlement({
        ...base,
        settlementPath: value.settlementPath,
        settlementSha256: value.settlementSha256,
      }),
      finalizeAiImageSandboxBillingSettlement({
        ...base,
        settlementPath: join(value.root, 'private', 'concurrent-changed.billing-attestation.json'),
        settlementSha256: changed.sha256,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
