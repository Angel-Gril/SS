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

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
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

function report(
  overrides: Record<string, unknown> = {},
  approvalOverrides: Record<string, unknown> = {},
) {
  const state = typeof overrides.state === 'string' ? overrides.state : 'SUCCEEDED';
  return {
    schemaVersion: 3,
    operationId,
    state,
    operation: 'FULL_EDIT',
    requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
    credentialRevision: 'credential-r1',
    adapterRevision: 'a'.repeat(40),
    provider: 'custom-openai-compatible',
    model: 'edit-capable-model',
    endpointSha256: '3'.repeat(64),
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
  claimOverrides?: Record<string, unknown>;
  attestationOverrides?: Record<string, unknown>;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-billing-'));
  directories.push(root);
  const intentPath = join(root, 'intents', `${operationId}.intent.json`);
  const reportPath = join(root, `${operationId}.report.json`);
  const claimPath = join(root, 'intents', '.fingerprints', `${requestFingerprint}.claim.json`);
  const storedIntent = await writeCanonicalJson(
    intentPath,
    intent(input.intentOverrides, input.approvalOverrides),
  );
  const storedReport = await writeCanonicalJson(
    reportPath,
    report(input.reportOverrides, input.approvalOverrides),
  );
  const storedClaim = await writeCanonicalJson(claimPath, fingerprintClaim(input.claimOverrides));
  const preCallBillingSnapshotPath = join(root, 'private', 'billing-before.snapshot');
  const settledBillingSnapshotPath = join(root, 'private', 'billing-settled.snapshot');
  const preCallBillingSnapshot = Buffer.from('private Provider balance before request\n', 'utf8');
  const settledBillingSnapshot = Buffer.from('private Provider balance after request\n', 'utf8');
  await mkdir(dirname(preCallBillingSnapshotPath), { recursive: true, mode: 0o700 });
  await writeFile(preCallBillingSnapshotPath, preCallBillingSnapshot, { mode: 0o600 });
  await writeFile(settledBillingSnapshotPath, settledBillingSnapshot, { mode: 0o600 });
  const settlementPath = join(root, 'private', `${operationId}.billing-attestation.json`);
  const storedSettlement = await writeCanonicalJson(settlementPath, attestation({
    intentSha256: storedIntent.sha256,
    reportSha256: storedReport.sha256,
    fingerprintClaimSha256: storedClaim.sha256,
    preCallBillingSnapshotPath,
    settledBillingSnapshotPath,
    preCallBillingSnapshotSha256: sha256(preCallBillingSnapshot),
    settledBillingSnapshotSha256: sha256(settledBillingSnapshot),
  }, input.attestationOverrides));
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
      event: 'AI_IMAGE_SANDBOX_BILLING_SETTLED',
      operationId,
      submitState: 'SUCCEEDED',
      billingOutcome: 'CHARGED',
      billingGate: 'PASS',
      actualCostCents: 10,
      billedUnits: 1,
      submissionAdapterRevision: 'a'.repeat(40),
      finalizationAdapterRevision: 'b'.repeat(40),
      sameRequestRetryAllowed: false,
    });
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
