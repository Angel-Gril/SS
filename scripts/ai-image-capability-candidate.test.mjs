import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { reviewAiImageCapabilityCandidate } from './sandbox/ai-image-capability-candidate.mjs';

const API_BASE_SHA256 = 'a'.repeat(64);
const OPERATION_ENDPOINT_SHA256 = '5'.repeat(64);
const MODEL = 'reviewed-edit-model';
const OPERATIONS = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
const WANX_PROVIDER = 'dashscope-wanx21-image-edit';
const WANX_MODEL = 'wanx2.1-imageedit';
const WANX_API_BASE_SHA256 = sha256('https://dashscope.aliyuncs.com/api/v1');
const WANX_OPERATION_ENDPOINT_SHA256 = sha256(
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
);
const WANX_PROFILES = {
  IMAGE_TO_IMAGE: 'DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1',
  FULL_EDIT: 'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1',
  INPAINT: 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1',
};

for (const kind of ['SS_ERP_QA04_OFFLINE_REHEARSAL', 'SS_ERP_DARK_MAINTENANCE_BASELINE',
  'SS_ERP_DARK_MAINTENANCE_ACCEPTANCE', 'SS_ERP_DARK_MAINTENANCE_BACKUP']) {
  test(`maintenance evidence ${kind} cannot promote a Provider capability`, () => {
    withBundle({ mutateReport(reports) { reports[0].kind = kind; } }, ({ manifestPath }) => {
      assert.throws(() => reviewAiImageCapabilityCandidate(manifestPath), /REPORT_SCHEMA_INVALID/u);
    });
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function hash(char) {
  return char.repeat(64);
}

function money(amount) {
  return { currency: 'USD', amount, scale: 2 };
}

function reportFor(operation, index) {
  const operationId = `qa02-${operation.toLowerCase().replaceAll('_', '-')}-0001`;
  const sourceSha256 = [hash(String(index + 1))];
  const maskSha256 = operation === 'INPAINT' ? hash('4') : null;
  return {
    schemaVersion: 5,
    operationId,
    state: 'SUCCEEDED',
    operation,
    requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
    credentialRevision: 'reviewed-key-revision-1',
    adapterRevision: 'b'.repeat(40),
    provider: 'custom-openai-compatible',
    model: MODEL,
    apiBaseSha256: API_BASE_SHA256,
    operationEndpointSha256: OPERATION_ENDPOINT_SHA256,
    approvalEvidence: {
      approvalId: `approval-${index + 1}`,
      approvalSha256: hash(['5', '6', '7'][index]),
      approvedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:30:00.000Z',
      approverRefSha256: hash('9'),
      providerAccountRefSha256: hash('a'),
      pricingRevisionSha256: hash(['1', '2', '3'][index]),
      currency: 'USD',
      preCallBillingSnapshotRefSha256: hash(['a', 'b', 'c'][index]),
      billingReconciliationRefSha256: hash(['d', 'e', 'f'][index]),
    },
    promptSha256: hash('e'),
    sourceSha256,
    maskSha256,
    requestedSize: '1024x1024',
    createRequests: 1,
    imageCount: 1,
    mimeType: 'image/png',
    width: 1024,
    height: 1024,
    bytes: 4096,
    sha256: hash(['8', '9', '0'][index]),
    providerRequestIdHash: hash(['d', 'e', 'f'][index]),
    usage: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    elapsedMs: 1000,
    actualCost: null,
    quotedCost: money(8),
    maximumCost: money(100),
    intentPath: `private/${operationId}.intent.json`,
    imagePath: `private/${operationId}.png`,
  };
}

function receiptFor(report, reportSha256, index) {
  return {
    schemaVersion: 3,
    event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
    operationId: report.operationId,
    settlementId: `settlement-${index + 1}`,
    settlementSha256: hash(['1', '2', '3'][index]),
    intentSha256: hash(['4', '5', '6'][index]),
    submitReportSha256: reportSha256,
    fingerprintClaimSha256: hash(['7', '8', '9'][index]),
    requestFingerprint: hash(['a', 'b', 'c'][index]),
    submitState: 'SUCCEEDED',
    providerOutcomeResolved: true,
    sameRequestRetryAllowed: false,
    apiBaseSha256: report.apiBaseSha256,
    operationEndpointSha256: report.operationEndpointSha256,
    modelSha256: sha256(report.model),
    operation: report.operation,
    requestProfile: report.requestProfile,
    promptSha256: report.promptSha256,
    sourceSha256: report.sourceSha256,
    maskSha256: report.maskSha256,
    approvalId: report.approvalEvidence.approvalId,
    approvalSha256: report.approvalEvidence.approvalSha256,
    submissionAdapterRevision: report.adapterRevision,
    finalizationAdapterRevision: 'c'.repeat(40),
    correlationMethod: 'PROVIDER_REQUEST_ID',
    providerRequestIdHash: report.providerRequestIdHash,
    billingOutcome: 'CHARGED',
    billingGate: 'PASS',
    actualCost: money(8),
    billedUnits: 1,
    quotedCost: report.quotedCost,
    maximumCost: report.maximumCost,
    preCallObservedAt: '2025-12-31T23:59:00.000Z',
    settledObservedAt: '2026-01-01T00:01:00.000Z',
    reconcilerRefSha256: hash('5'),
    providerAccountRefSha256: report.approvalEvidence.providerAccountRefSha256,
    pricingRevisionSha256: report.approvalEvidence.pricingRevisionSha256,
    preCallBillingSnapshotRefSha256: report.approvalEvidence.preCallBillingSnapshotRefSha256,
    billingReconciliationRefSha256: report.approvalEvidence.billingReconciliationRefSha256,
    providerBillingEntryRefSha256: hash(['d', 'e', 'f'][index]),
    preCallBillingSnapshotSha256: hash('b'),
    settledBillingSnapshotSha256: hash('c'),
  };
}

function promoteReceiptsToV4(receipts) {
  receipts.forEach((receipt, index) => {
    receipt.schemaVersion = 4;
    receipt.correlationMethod = 'PROVIDER_TOKEN_LOG_ENTRY';
    receipt.providerBillingEntryRequestIdHash = hash(['1', '2', '3'][index]);
    receipt.providerBillingEntryKey = hash(['4', '5', '6'][index]);
    receipt.providerRequestIdBridge = 'UPSTREAM_REQUEST_ID';
    receipt.providerTokenLogAccountSha256 = hash('7');
    receipt.providerTokenLogSnapshotSha256 = hash(['8', '9', 'a'][index]);
  });
}

function createBundle(options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ss-erp-capability-candidate-'));
  const reports = OPERATIONS.map(reportFor);
  options.mutateReport?.(reports);
  const reportBytes = reports.map(canonicalBytes);
  const reportDigests = reportBytes.map(sha256);
  const receipts = reports.map((report, index) => receiptFor(report, reportDigests[index], index));
  options.mutateReceipt?.(receipts);
  const receiptBytes = receipts.map(canonicalBytes);
  const receiptDigests = receiptBytes.map(sha256);
  const manifest = {
    schemaVersion: 1,
    event: 'AI_IMAGE_PROVIDER_EDIT_CAPABILITY_QUALITY_REVIEW',
    decision: 'APPROVED',
    provider: 'custom',
    model: MODEL,
    apiBaseSha256: API_BASE_SHA256,
    inputTransport: 'multipart',
    resultMode: 'sync',
    maxReferences: 1,
    supportsMask: true,
    reviewerRefSha256: hash('d'),
    reviewedAt: '2026-01-01T00:02:00.000Z',
    operations: reports.map((report, index) => ({
      operation: OPERATIONS[index],
      operationId: report.operationId,
      reportPath: `${OPERATIONS[index]}.report.json`,
      reportSha256: reportDigests[index],
      receiptPath: `${OPERATIONS[index]}.receipt.json`,
      receiptSha256: receiptDigests[index],
      outputImageSha256: report.sha256,
      decision: 'APPROVED',
      qualityChecks: {
        operationIntentSatisfied: true,
        primaryProductIdentityPreserved: true,
        noUnexpectedTextLogoWatermark: true,
        acceptableVisualQuality: true,
        unmaskedRegionPreserved: report.operation === 'INPAINT' ? true : null,
      },
    })),
  };
  options.mutateManifest?.(manifest);

  reports.forEach((_, index) => {
    writeFileSync(path.join(directory, manifest.operations[index].reportPath), reportBytes[index]);
    writeFileSync(
      path.join(directory, manifest.operations[index].receiptPath),
      receiptBytes[index],
    );
  });
  const manifestPath = path.join(directory, 'quality-review.json');
  writeFileSync(manifestPath, canonicalBytes(manifest));
  return { directory, manifestPath };
}

function withBundle(options, callback) {
  const bundle = createBundle(options);
  try {
    return callback(bundle);
  } finally {
    rmSync(bundle.directory, { recursive: true, force: true });
  }
}

function createWanxBundle(options = {}) {
  return createBundle({
    mutateReport(reports) {
      reports.forEach((report) => {
        report.provider = WANX_PROVIDER;
        report.model = WANX_MODEL;
        report.apiBaseSha256 = WANX_API_BASE_SHA256;
        report.operationEndpointSha256 = WANX_OPERATION_ENDPOINT_SHA256;
        report.requestProfile = WANX_PROFILES[report.operation];
        report.approvalEvidence.currency = 'CNY';
        report.quotedCost = { currency: 'CNY', amount: 14, scale: 2 };
        report.maximumCost = { currency: 'CNY', amount: 100, scale: 2 };
      });
      options.mutateReport?.(reports);
    },
    mutateReceipt(receipts) {
      receipts.forEach((receipt) => {
        receipt.actualCost = { currency: 'CNY', amount: 14, scale: 2 };
      });
      options.mutateReceipt?.(receipts);
    },
    mutateManifest(manifest) {
      manifest.provider = WANX_PROVIDER;
      manifest.model = WANX_MODEL;
      manifest.apiBaseSha256 = WANX_API_BASE_SHA256;
      manifest.inputTransport = 'base64';
      manifest.resultMode = 'async';
      options.mutateManifest?.(manifest);
    },
  });
}

function withWanxBundle(options, callback) {
  const bundle = createWanxBundle(options);
  try {
    return callback(bundle);
  } finally {
    rmSync(bundle.directory, { recursive: true, force: true });
  }
}

test('emits a sanitized candidate without modifying the provider registry', () => {
  withBundle({}, ({ manifestPath }) => {
    const candidate = reviewAiImageCapabilityCandidate(manifestPath);
    assert.equal(candidate.status, 'CANDIDATE_ONLY');
    assert.equal(candidate.containsSecrets, false);
    assert.deepEqual(candidate.candidateCapability, {
      provider: 'custom',
      model: MODEL,
      operations: OPERATIONS,
      maxReferences: 1,
      supportsMask: true,
      inputTransport: 'multipart',
      resultMode: 'sync',
      evidenceLevel: 'candidate-only',
      requestedRegistryEvidenceLevel: 'sandbox-verified',
      evidence: 'shape-validated candidate; trusted private evidence review is still required',
      proposedSandboxEvidence: OPERATIONS.map((operation) => ({
        endpointSha256: API_BASE_SHA256,
        operation,
        inputTransport: 'multipart',
        resultMode: 'sync',
      })),
    });
    assert.equal(candidate.trustedEvidenceVerified, false);
    assert.equal(candidate.reviewEvidence.operations.length, 3);
    const serialized = JSON.stringify(candidate);
    assert.doesNotMatch(
      serialized,
      /reportPath|receiptPath|imagePath|intentPath|credentialRevision/u,
    );
  });
});

test('CLI prints the candidate and performs no registry write', () => {
  withBundle({}, ({ manifestPath }) => {
    const registryPath = path.join(
      process.cwd(),
      'apps/server/src/services/ai-image-provider-capabilities.ts',
    );
    const before = sha256(readFileSync(registryPath));
    const output = execFileSync(
      process.execPath,
      ['scripts/sandbox/ai-image-capability-candidate.mjs', '--review-manifest', manifestPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.equal(JSON.parse(output).status, 'CANDIDATE_ONLY');
    const after = sha256(readFileSync(registryPath));
    assert.equal(after, before);
  });
});

test('accepts an exact v4 receipt with globally bound Token-log evidence', () => {
  withBundle(
    {
      mutateReceipt(receipts) {
        promoteReceiptsToV4(receipts);
      },
    },
    ({ manifestPath }) => {
      assert.equal(reviewAiImageCapabilityCandidate(manifestPath).status, 'CANDIDATE_ONLY');
    },
  );
});

test('emits a candidate for the exact Wanx async data-URL edit chain', () => {
  withWanxBundle({}, ({ manifestPath }) => {
    const candidate = reviewAiImageCapabilityCandidate(manifestPath);
    assert.deepEqual(candidate.candidateCapability, {
      provider: WANX_PROVIDER,
      model: WANX_MODEL,
      operations: OPERATIONS,
      maxReferences: 1,
      supportsMask: true,
      inputTransport: 'base64',
      resultMode: 'async',
      evidenceLevel: 'candidate-only',
      requestedRegistryEvidenceLevel: 'sandbox-verified',
      evidence: 'shape-validated candidate; trusted private evidence review is still required',
      proposedSandboxEvidence: OPERATIONS.map((operation) => ({
        endpointSha256: WANX_API_BASE_SHA256,
        operation,
        inputTransport: 'base64',
        resultMode: 'async',
      })),
    });
  });
});

test('rejects a Wanx chain using a non-CNY policy', () => {
  withWanxBundle(
    {
      mutateReport(reports) {
        reports[0].approvalEvidence.currency = 'USD';
        reports[0].quotedCost.currency = 'USD';
        reports[0].maximumCost.currency = 'USD';
      },
      mutateReceipt(receipts) {
        receipts[0].actualCost.currency = 'USD';
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /BILLING_EVIDENCE_INVALID/u,
      );
    },
  );
});

test('rejects Wanx billing that does not use the accepted task identity', () => {
  withWanxBundle(
    {
      mutateReceipt(receipts) {
        promoteReceiptsToV4(receipts);
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /BILLING_EVIDENCE_INVALID/u,
      );
    },
  );
});

for (const [label, mutateReport] of [
  ['Provider', (reports) => { reports[0].provider = 'custom-openai-compatible'; }],
  ['model', (reports) => { reports[0].model = 'wanx2.1-t2i-turbo'; }],
  ['API Base', (reports) => { reports[0].apiBaseSha256 = hash('0'); }],
  ['submit endpoint', (reports) => { reports[0].operationEndpointSha256 = hash('0'); }],
  ['operation profile', (reports) => {
    reports[1].requestProfile = WANX_PROFILES.IMAGE_TO_IMAGE;
  }],
  ['task identity', (reports) => { reports[0].providerRequestIdHash = null; }],
]) {
  test(`rejects a Wanx report with mismatched ${label}`, () => {
    withWanxBundle({ mutateReport }, ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /ARTIFACT_IDENTITY_INVALID/u,
      );
    });
  });
}

for (const [label, mutateManifest] of [
  ['Provider', (manifest) => { manifest.provider = 'dashscope-wanx'; }],
  ['model', (manifest) => { manifest.model = 'wanx2.1-t2i-turbo'; }],
  ['API Base', (manifest) => { manifest.apiBaseSha256 = hash('0'); }],
  ['input transport', (manifest) => { manifest.inputTransport = 'multipart'; }],
  ['result mode', (manifest) => { manifest.resultMode = 'sync'; }],
]) {
  test(`rejects a Wanx manifest with mismatched ${label}`, () => {
    withWanxBundle({ mutateManifest }, ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /QUALITY_REVIEW_INVALID/u,
      );
    });
  });
}

for (const [label, mutateManifest] of [
  [
    'provider',
    (manifest) => {
      manifest.provider = 'openai-images';
    },
  ],
  [
    'model',
    (manifest) => {
      manifest.model = 'other-model';
    },
  ],
  [
    'API Base digest',
    (manifest) => {
      manifest.apiBaseSha256 = hash('e');
    },
  ],
  [
    'input transport',
    (manifest) => {
      manifest.inputTransport = 'base64';
    },
  ],
  [
    'result mode',
    (manifest) => {
      manifest.resultMode = 'async';
    },
  ],
]) {
  test(`rejects mismatched ${label}`, () => {
    withBundle({ mutateManifest }, ({ manifestPath }) => {
      assert.throws(() => reviewAiImageCapabilityCandidate(manifestPath));
    });
  });
}

for (const [label, model] of [
  ['sk prefix', `sk-${'x'.repeat(32)}`],
  ['pk prefix', `pk-${'y'.repeat(32)}`],
  ['embedded secret', `vendor/sk-${'z'.repeat(32)}`],
]) {
  test(`rejects a secret-shaped model identifier with ${label}`, () => {
    withBundle(
      {
        mutateManifest(manifest) {
          manifest.model = model;
        },
      },
      ({ manifestPath }) => {
        assert.throws(
          () => reviewAiImageCapabilityCandidate(manifestPath),
          /QUALITY_REVIEW_INVALID/u,
        );
      },
    );
  });
}

for (const [label, operationId] of [
  ['pk prefix', `pk-${'o'.repeat(32)}`],
  ['embedded secret', `qa02-sk-${'p'.repeat(32)}`],
]) {
  test(`rejects a secret-shaped operation ID with ${label}`, () => {
    withBundle(
      {
        mutateManifest(manifest) {
          manifest.operations[0].operationId = operationId;
        },
      },
      ({ manifestPath }) => {
        assert.throws(
          () => reviewAiImageCapabilityCandidate(manifestPath),
          /QUALITY_REVIEW_INVALID/u,
        );
      },
    );
  });
}

test('rejects an operation report reused under another operation', () => {
  withBundle(
    {
      mutateReport(reports) {
        reports[1].operation = 'IMAGE_TO_IMAGE';
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /ARTIFACT_IDENTITY_INVALID/u,
      );
    },
  );
});

for (const [label, requestedSize] of [
  ['width', '512x1024'],
  ['height', '1024x512'],
]) {
  test(`rejects requested size with a mismatched ${label}`, () => {
    withBundle(
      {
        mutateReport(reports) {
          reports[0].requestedSize = requestedSize;
        },
      },
      ({ manifestPath }) => {
        assert.throws(
          () => reviewAiImageCapabilityCandidate(manifestPath),
          /ARTIFACT_IDENTITY_INVALID/u,
        );
      },
    );
  });
}

test('rejects billing that is not settled within the approved limit', () => {
  withBundle(
    {
      mutateReceipt(receipts) {
        receipts[2].billingGate = 'COST_LIMIT_EXCEEDED';
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /BILLING_EVIDENCE_INVALID/u,
      );
    },
  );
});

for (const billingGate of ['COST_BASIS_MISMATCH', 'PASS']) {
  test(`does not promote an operator console-review receipt marked ${billingGate}`, () => {
    withBundle(
      {
        mutateReceipt(receipts) {
          receipts[0].schemaVersion = 6;
          receipts[0].correlationMethod = 'PROVIDER_CONSOLE_ACCOUNT_UNIT_REVIEW';
          receipts[0].billingGate = billingGate;
        },
      },
      ({ manifestPath }) => {
        assert.throws(
          () => reviewAiImageCapabilityCandidate(manifestPath),
          /BILLING_EVIDENCE_INVALID/u,
        );
      },
    );
  });
}

test('rejects a failed human quality check', () => {
  withBundle(
    {
      mutateManifest(manifest) {
        manifest.operations[2].qualityChecks.unmaskedRegionPreserved = false;
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /QUALITY_REVIEW_INVALID/u,
      );
    },
  );
});

test('rejects a report carrying an extra secret-bearing field', () => {
  withBundle(
    {
      mutateReport(reports) {
        reports[0].apiKey = 'must-not-be-read-as-evidence';
      },
    },
    ({ manifestPath }) => {
      assert.throws(() => reviewAiImageCapabilityCandidate(manifestPath), /REPORT_SCHEMA_INVALID/u);
    },
  );
});

test('rejects receipt-to-report digest drift', () => {
  withBundle(
    {
      mutateReceipt(receipts) {
        receipts[0].submitReportSha256 = hash('0');
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /BILLING_EVIDENCE_INVALID/u,
      );
    },
  );
});

test('rejects an operation report from a different edit endpoint', () => {
  withBundle(
    {
      mutateReport(reports) {
        reports[2].operationEndpointSha256 = hash('6');
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /ARTIFACT_IDENTITY_INVALID/u,
      );
    },
  );
});

test('rejects a receipt whose Provider account does not match its approval evidence', () => {
  withBundle(
    {
      mutateReceipt(receipts) {
        receipts[1].providerAccountRefSha256 = hash('0');
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /BILLING_EVIDENCE_INVALID/u,
      );
    },
  );
});

test('rejects edit reports made under different credential revisions', () => {
  withBundle(
    {
      mutateReport(reports) {
        reports[1].credentialRevision = 'different-reviewed-key-revision';
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /ARTIFACT_IDENTITY_INVALID/u,
      );
    },
  );
});

test('rejects reusing one pricing authorization for multiple edit operations', () => {
  withBundle(
    {
      mutateReport(reports) {
        reports[1].approvalEvidence.pricingRevisionSha256 =
          reports[0].approvalEvidence.pricingRevisionSha256;
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /ARTIFACT_IDENTITY_INVALID/u,
      );
    },
  );
});

test('rejects reusing one global Token-log billing entry for multiple operations', () => {
  withBundle(
    {
      mutateReceipt(receipts) {
        promoteReceiptsToV4(receipts);
        receipts[1].providerBillingEntryKey = receipts[0].providerBillingEntryKey;
      },
    },
    ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /ARTIFACT_IDENTITY_INVALID/u,
      );
    },
  );
});

for (const [label, options] of [
  [
    'zero quoted cost',
    {
      mutateReport(reports) {
        reports[0].quotedCost.amount = 0;
      },
    },
  ],
  [
    'different quote and maximum scales',
    {
      mutateReport(reports) {
        reports[0].maximumCost.scale = 3;
      },
    },
  ],
  [
    'non-minimal shared money scale',
    {
      mutateReport(reports) {
        reports[0].quotedCost.amount = 10;
      },
    },
  ],
  [
    'actual-cost scale different from the maximum',
    {
      mutateReceipt(receipts) {
        receipts[0].actualCost.scale = 1;
      },
    },
  ],
]) {
  test(`rejects ${label}`, () => {
    withBundle(options, ({ manifestPath }) => {
      assert.throws(
        () => reviewAiImageCapabilityCandidate(manifestPath),
        /BILLING_EVIDENCE_INVALID/u,
      );
    });
  });
}
