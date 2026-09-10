import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
  loadAiImageSandboxApproval,
  type AiImageSandboxApprovalExpectedRequest,
  type AiImageSandboxTrialBinding,
} from '../services/ai-image-sandbox-approval.js';

const directories: string[] = [];
const now = new Date('2030-01-01T00:10:00.000Z');
const approvedAt = '2030-01-01T00:00:00.000Z';
const expiresAt = '2030-01-01T00:30:00.000Z';
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
type TrialExpectedRequest = Extract<AiImageSandboxApprovalExpectedRequest, { quotedCost: unknown }>
  & { trialBinding: AiImageSandboxTrialBinding };

function trialBinding(): AiImageSandboxTrialBinding {
  return {
    roundId: 'synthetic-round-001',
    manifestSha256: digest('synthetic frozen trial manifest'),
    evidenceRootSha256: digest('synthetic canonical private root'),
    providerAccountUidSha256: digest('synthetic account UID'),
    requestFingerprint: digest('synthetic exact provider request'),
    frozenPromptSha256: digest('synthetic frozen template and text'),
  };
}

function expectedRequest(operation: 'FULL_EDIT' | 'INPAINT' = 'FULL_EDIT'): TrialExpectedRequest {
  return {
    operationId: `synthetic-${operation.toLowerCase()}-001`,
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
    expectedHost: 'dashscope.aliyuncs.com',
    model: 'wanx2.1-imageedit',
    operation,
    requestProfile: operation === 'FULL_EDIT'
      ? 'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1'
      : 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1',
    credentialRevision: 'synthetic-key-revision-1',
    adapterRevision: 'a'.repeat(40),
    sourceSha256: [digest('synthetic source image')],
    maskSha256: operation === 'INPAINT' ? digest('synthetic alpha mask') : null,
    quotedCost: { currency: 'CNY', amount: 14, scale: 2 },
    maximumCost: { currency: 'CNY', amount: 25, scale: 2 },
    trialBinding: trialBinding(),
  };
}

function approvalFor(expected = expectedRequest()): Record<string, unknown> {
  return {
    schemaVersion: 4,
    approvalId: `approval-${expected.operationId}`,
    statement: AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
    approvedAt,
    expiresAt,
    approverRef: 'synthetic-operator-review',
    providerAccountRef: 'synthetic-account-reference',
    pricingRevision: 'synthetic-pricing-policy-1',
    preCallBillingSnapshotRef: 'synthetic-before-billing',
    billingReconciliationRef: 'synthetic-billing-reconciliation',
    requestCount: 1,
    ...expected,
  };
}

async function saveApproval(record: Record<string, unknown>) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'ss-erp-trial-approval-'));
  directories.push(repositoryRoot);
  const approvalPath = join(repositoryRoot, 'approval.json');
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  await writeFile(approvalPath, bytes, { mode: 0o600, flag: 'wx' });
  return { repositoryRoot, approvalPath, expectedSha256: digest(bytes), bytes };
}

async function expectRejected(
  record: Record<string, unknown>,
  expected: AiImageSandboxApprovalExpectedRequest = expectedRequest(),
  code = 'SANDBOX_APPROVAL_SCHEMA_INVALID',
  clock = now,
) {
  const file = await saveApproval(record);
  await expect(loadAiImageSandboxApproval({ ...file, expected, now: clock }))
    .rejects.toMatchObject({ code });
  expect(await readFile(file.approvalPath)).toEqual(file.bytes);
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(target).startsWith('ss-erp-trial-approval-'));
    await rm(target, { recursive: true, force: true });
  }
});

describe('exact Wanx trial approval v4', () => {
  it.each(['FULL_EDIT', 'INPAINT'] as const)(
    'accepts a reviewed %s v4 file and preserves the existing evidence shape',
    async (operation) => {
      const expected = expectedRequest(operation);
      const record = approvalFor(expected);
      const file = await saveApproval(record);

      const evidence = await loadAiImageSandboxApproval({ ...file, expected, now });

      expect(evidence).toEqual({
        approvalId: record.approvalId,
        approvalSha256: file.expectedSha256,
        approvedAt,
        expiresAt,
        approverRefSha256: digest(String(record.approverRef)),
        providerAccountRefSha256: digest(String(record.providerAccountRef)),
        pricingRevisionSha256: digest(String(record.pricingRevision)),
        currency: 'CNY',
        preCallBillingSnapshotRefSha256: digest(String(record.preCallBillingSnapshotRef)),
        billingReconciliationRefSha256: digest(String(record.billingReconciliationRef)),
      });
      expect(await readFile(file.approvalPath)).toEqual(file.bytes);
    },
  );

  it.each([
    'roundId', 'manifestSha256', 'evidenceRootSha256', 'providerAccountUidSha256',
    'requestFingerprint', 'frozenPromptSha256',
  ] as const)('rejects a reviewed file for a different %s', async (key) => {
    const expected = expectedRequest();
    const changed = {
      ...expected.trialBinding,
      [key]: key === 'roundId' ? 'another-round-001' : digest(`another ${key}`),
    };
    await expectRejected(
      { ...approvalFor(expected), trialBinding: changed },
      expected,
      'SANDBOX_APPROVAL_MISMATCH',
    );
  });

  it('rejects v4 when the caller has not independently selected the trial binding', async () => {
    const expected = expectedRequest();
    const ordinary: AiImageSandboxApprovalExpectedRequest = { ...expected };
    delete ordinary.trialBinding;
    await expectRejected(approvalFor(expected), ordinary, 'SANDBOX_APPROVAL_MISMATCH');
  });

  it.each([2, 3])('rejects a schema %i approval when the caller requires a trial', async (schemaVersion) => {
    const expected = expectedRequest();
    const record = approvalFor(expected);
    record.schemaVersion = schemaVersion;
    delete record.trialBinding;
    if (schemaVersion === 2) {
      delete record.quotedCost;
      delete record.maximumCost;
      record.currency = 'CNY';
      record.quotedCostCents = 14;
      record.maximumCostCents = 25;
    }
    await expectRejected(record, expected, 'SANDBOX_APPROVAL_MISMATCH');
  });

  it.each([2, 3])('preserves schema %i approval loading without a trial binding', async (schemaVersion) => {
    const source = expectedRequest();
    const record = approvalFor(source);
    record.schemaVersion = schemaVersion;
    delete record.trialBinding;
    const ordinary: AiImageSandboxApprovalExpectedRequest = { ...source };
    delete ordinary.trialBinding;
    let expected: AiImageSandboxApprovalExpectedRequest = ordinary;
    if (schemaVersion === 2) {
      delete record.quotedCost;
      delete record.maximumCost;
      record.currency = 'CNY';
      record.quotedCostCents = 14;
      record.maximumCostCents = 25;
      const { quotedCost: _quote, maximumCost: _maximum, ...identity } = ordinary;
      expected = { ...identity, quotedCostCents: 14, maximumCostCents: 25 };
    }
    const file = await saveApproval(record);
    await expect(loadAiImageSandboxApproval({ ...file, expected, now })).resolves.toMatchObject({
      approvalSha256: file.expectedSha256,
      currency: 'CNY',
    });
  });

  it('rejects legacy cents expected costs for a v4 trial approval', async () => {
    const expected = expectedRequest();
    const { quotedCost: _quote, maximumCost: _maximum, ...identity } = expected;
    await expectRejected(approvalFor(expected), {
      ...identity, quotedCostCents: 14, maximumCostCents: 25,
    }, 'SANDBOX_APPROVAL_MISMATCH');
  });

  it('rejects an absent trial binding in the v4 file', async () => {
    const record = approvalFor();
    delete record.trialBinding;
    await expectRejected(record);
  });

  it('does not treat a v4 binding added to a v3 file as legacy compatibility', async () => {
    await expectRejected({ ...approvalFor(), schemaVersion: 3 });
  });

  it.each([
    ['extra top-level field', { ...approvalFor(), apiKey: 'synthetic-forbidden-field' }],
    ['extra trial field', { ...approvalFor(), trialBinding: { ...trialBinding(), approved: true } }],
    ['missing trial field', { ...approvalFor(), trialBinding: { ...trialBinding(), manifestSha256: undefined } }],
    ['null binding', { ...approvalFor(), trialBinding: null }],
    ['array binding', { ...approvalFor(), trialBinding: [trialBinding()] }],
    ['short round ID', { ...approvalFor(), trialBinding: { ...trialBinding(), roundId: 'round-1' } }],
    ['long round ID', { ...approvalFor(), trialBinding: { ...trialBinding(), roundId: 'r'.repeat(65) } }],
    ['non-ASCII round ID', { ...approvalFor(), trialBinding: { ...trialBinding(), roundId: 'round-测试-001' } }],
    ['padded round ID', { ...approvalFor(), trialBinding: { ...trialBinding(), roundId: ' synthetic-round-001' } }],
  ] as const)('rejects %s', async (_label, record) => {
    await expectRejected(record);
  });

  it.each([
    'manifestSha256', 'evidenceRootSha256', 'providerAccountUidSha256',
    'requestFingerprint', 'frozenPromptSha256',
  ] as const)('requires canonical lowercase SHA-256 in %s', async (key) => {
    for (const value of ['A'.repeat(64), 'a'.repeat(63), `${'a'.repeat(64)} `, 123]) {
      await expectRejected({
        ...approvalFor(), trialBinding: { ...trialBinding(), [key]: value },
      });
    }
  });

  it('rejects malformed expected bindings even when the file uses a valid binding', async () => {
    const expected = expectedRequest();
    await expectRejected(approvalFor(expected), {
      ...expected,
      trialBinding: { ...expected.trialBinding, manifestSha256: 'A'.repeat(64) },
    });
  });

  it.each([
    ['workspace endpoint', { endpoint: 'https://synthetic.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis', expectedHost: 'synthetic.cn-beijing.maas.aliyuncs.com' }],
    ['international endpoint', { endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis', expectedHost: 'dashscope-intl.aliyuncs.com' }],
    ['OpenAI edit route', { endpoint: 'https://dashscope.aliyuncs.com/api/v1/images/edits' }],
    ['endpoint query', { endpoint: `${expectedRequest().endpoint}?trial=1` }],
    ['model alias', { model: 'wanx2.1-imageedit-alias' }],
    ['image-to-image operation', { operation: 'IMAGE_TO_IMAGE', requestProfile: 'DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1' }],
    ['wrong operation profile', { requestProfile: 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1' }],
    ['generic request profile', { requestProfile: 'OPENAI_SQUARE_SINGLE_V1' }],
    ['missing source', { sourceSha256: [] }],
    ['unexpected full-edit mask', { maskSha256: digest('unexpected mask') }],
    ['missing inpaint mask', { operation: 'INPAINT', requestProfile: 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1', maskSha256: null }],
  ] as const)('rejects %s even when caller and file agree', async (_label, override) => {
    const expected = { ...expectedRequest(), ...override } as ReturnType<typeof expectedRequest>;
    await expectRejected(approvalFor(expected), expected);
  });

  it('retains exact-money canonical scale validation for v4', async () => {
    const expected = {
      ...expectedRequest(),
      quotedCost: { currency: 'CNY', amount: 140, scale: 3 },
      maximumCost: { currency: 'CNY', amount: 250, scale: 3 },
    };
    await expectRejected(approvalFor(expected), expected);
  });

  it('rejects changed per-operation maximum even when still above the quote', async () => {
    await expectRejected({
      ...approvalFor(), maximumCost: { currency: 'CNY', amount: 30, scale: 2 },
    }, expectedRequest(), 'SANDBOX_APPROVAL_MISMATCH');
  });

  it('rejects expired approval at the exact expiry instant', async () => {
    await expectRejected(approvalFor(), expectedRequest(), 'SANDBOX_APPROVAL_EXPIRED', new Date(expiresAt));
  });

  it('retains the reviewed file digest boundary for v4', async () => {
    const file = await saveApproval(approvalFor());
    await expect(loadAiImageSandboxApproval({
      ...file, expectedSha256: digest('another reviewed file'), expected: expectedRequest(), now,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DIGEST_MISMATCH' });
  });
});
