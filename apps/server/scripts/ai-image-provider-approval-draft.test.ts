import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
  loadAiImageSandboxApproval,
} from '../src/services/ai-image-sandbox-approval.js';
import {
  AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT,
  AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
  runAiImageProviderApprovalDraft,
} from './ai-image-provider-approval-draft.js';

const directories: string[] = [];
const adapterRevision = 'a'.repeat(40);

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

async function fixture(operation = 'FULL_EDIT') {
  const root = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-approval-draft-'));
  directories.push(root);
  const privateDirectory = join(root, 'private');
  await mkdir(privateDirectory, { mode: 0o700 });
  const sourcePath = join(privateDirectory, 'source.png');
  const sourceBytes = await sharp({
    create: { width: 3, height: 2, channels: 4, background: '#f2f2f2' },
  }).png().toBuffer();
  await writeFile(sourcePath, sourceBytes, { mode: 0o600 });
  const maskPath = join(privateDirectory, 'mask.png');
  const maskBytes = await sharp(Buffer.from([
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 0,
    255, 255, 255, 255,
    255, 255, 255, 0,
    255, 255, 255, 255,
  ]), { raw: { width: 3, height: 2, channels: 4 } }).png().toBuffer();
  await writeFile(maskPath, maskBytes, { mode: 0o600 });
  const operationId = `sandbox-${operation.toLowerCase().replaceAll('_', '-')}-draft-0001`;
  const draftPath = join(privateDirectory, `${operationId}.approval.draft.json`);
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: 'sandbox',
    AI_IMAGE_SANDBOX_APPROVAL_DRAFT_PATH: draftPath,
    AI_IMAGE_SANDBOX_APPROVAL_ID: `approval-${operationId}`,
    AI_IMAGE_SANDBOX_APPROVER_REF: 'owner-review-draft-0001',
    AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF: 'provider-account-main',
    AI_IMAGE_SANDBOX_PRICING_REVISION: 'provider-pricing-r1',
    AI_IMAGE_SANDBOX_CURRENCY: 'USD',
    AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF: 'private-ledger/before-draft-0001',
    AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF: 'private-ledger/after-draft-0001',
    AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
    AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
    AI_IMAGE_SANDBOX_MODEL: 'edit-capable-model',
    AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
    AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'secret-manager-revision-2',
    AI_IMAGE_SANDBOX_ADAPTER_REVISION: adapterRevision,
    AI_IMAGE_SANDBOX_OPERATION: operation,
    AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
    AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
    AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    ...(operation === 'TEXT_TO_IMAGE' ? {} : {
      AI_IMAGE_SANDBOX_SOURCE_PATH: sourcePath,
      AI_IMAGE_SANDBOX_SOURCE_SHA256: sha256(sourceBytes),
    }),
    ...(operation === 'INPAINT' ? {
      AI_IMAGE_SANDBOX_MASK_PATH: maskPath,
      AI_IMAGE_SANDBOX_MASK_SHA256: sha256(maskBytes),
    } : {}),
  };
  return { root, privateDirectory, sourcePath, maskPath, draftPath, environment, operationId };
}

async function resizePinnedMedia(
  value: Awaited<ReturnType<typeof fixture>>,
  sourceBytes: number,
  maskBytes: number,
) {
  const source = await readFile(value.sourcePath);
  const mask = await readFile(value.maskPath);
  if (sourceBytes < source.byteLength || maskBytes < mask.byteLength) {
    throw new Error('test media target is too small');
  }
  const sizedSource = Buffer.alloc(sourceBytes);
  const sizedMask = Buffer.alloc(maskBytes);
  source.copy(sizedSource);
  mask.copy(sizedMask);
  await writeFile(value.sourcePath, sizedSource, { mode: 0o600 });
  await writeFile(value.maskPath, sizedMask, { mode: 0o600 });
  value.environment.AI_IMAGE_SANDBOX_SOURCE_SHA256 = sha256(sizedSource);
  value.environment.AI_IMAGE_SANDBOX_MASK_SHA256 = sha256(sizedMask);
}

async function completedExactApproval() {
  const value = await fixture('TEXT_TO_IMAGE');
  const {
    AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: _legacyQuote,
    AI_IMAGE_SANDBOX_MAX_COST_CENTS: _legacyMaximum,
    ...baseEnvironment
  } = value.environment;
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
  const result = await runAiImageProviderApprovalDraft({
    environment: {
      ...baseEnvironment,
      AI_IMAGE_SANDBOX_CURRENCY: 'CNY',
      AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '119',
      AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: '200',
      AI_IMAGE_SANDBOX_COST_SCALE: '4',
    },
    repositoryRoot: value.root,
    resolveRevision: vi.fn(async () => adapterRevision),
  });
  return {
    value,
    approval: {
      ...result.draft,
      statement: AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    } as Record<string, unknown>,
    expected: {
      operationId: value.operationId,
      endpoint: 'https://relay.example/v1/images/generations',
      expectedHost: 'relay.example',
      model: 'edit-capable-model',
      operation: 'TEXT_TO_IMAGE' as const,
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      credentialRevision: 'secret-manager-revision-2',
      adapterRevision,
      sourceSha256: [],
      maskSha256: null,
      quotedCost: { currency: 'CNY', amount: 119, scale: 4 },
      maximumCost: { currency: 'CNY', amount: 200, scale: 4 },
    },
  };
}

async function expectExactApprovalRejected(
  mutate: (approval: Record<string, unknown>) => void,
) {
  const { value, approval, expected } = await completedExactApproval();
  mutate(approval);
  const approvalPath = join(value.privateDirectory, 'rejected-exact-money.approval.json');
  const bytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  await writeFile(approvalPath, bytes, { mode: 0o600 });
  await expect(loadAiImageSandboxApproval({
    repositoryRoot: value.root,
    approvalPath,
    expectedSha256: sha256(bytes),
    expected,
    now: new Date('2030-01-01T00:10:00.000Z'),
  })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('AI image sandbox approval draft generator', () => {
  it('binds the Packy GPT-Image-2 edit profile only to its exact Provider identity', async () => {
    const value = await fixture('IMAGE_TO_IMAGE');
    const environment = {
      ...value.environment,
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: undefined,
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: undefined,
      AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '8',
      AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: '100',
      AI_IMAGE_SANDBOX_COST_SCALE: '2',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://www.packyapi.ai/v1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'www.packyapi.ai',
      AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1',
    };
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

    const result = await runAiImageProviderApprovalDraft({
      environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });

    expect(result.draft).toMatchObject({
      endpoint: 'https://www.packyapi.ai/v1/images/edits',
      expectedHost: 'www.packyapi.ai',
      model: 'gpt-image-2',
      operation: 'IMAGE_TO_IMAGE',
      requestProfile: 'PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1',
    });
  });

  it.each([
    ['wrong endpoint', { AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example', AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example' }],
    ['wrong model', { AI_IMAGE_SANDBOX_MODEL: 'other-model' }],
    ['default request profile', { AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1' }],
  ])('rejects the Packy edit profile with %s', async (_label, overrides) => {
    const value = await fixture('IMAGE_TO_IMAGE');
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...value.environment,
        AI_IMAGE_SANDBOX_BASE_URL: 'https://www.packyapi.ai/v1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'www.packyapi.ai',
        AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1',
        ...overrides,
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects legacy cents for the Packy edit profile', async () => {
    const value = await fixture('IMAGE_TO_IMAGE');
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...value.environment,
        AI_IMAGE_SANDBOX_BASE_URL: 'https://www.packyapi.ai/v1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'www.packyapi.ai',
        AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1',
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    'XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1',
    'XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2',
  ])('binds %s only to the exact Xiaoyi Provider identity', async (requestProfile) => {
    const value = await fixture('IMAGE_TO_IMAGE');
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

    const result = await runAiImageProviderApprovalDraft({
      environment: {
        ...value.environment,
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: undefined,
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: undefined,
        AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '21',
        AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: '100',
        AI_IMAGE_SANDBOX_COST_SCALE: '2',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://image.xiaoyiapi.xyz/v1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'image.xiaoyiapi.xyz',
        AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: requestProfile,
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });

    expect(result.draft).toMatchObject({
      endpoint: 'https://image.xiaoyiapi.xyz/v1/images/edits',
      expectedHost: 'image.xiaoyiapi.xyz',
      model: 'gpt-image-2',
      operation: 'IMAGE_TO_IMAGE',
      requestProfile,
      quotedCost: { currency: 'USD', amount: 21, scale: 2 },
      maximumCost: { currency: 'USD', amount: 100, scale: 2 },
    });
  });

  it.each([
    ['wrong endpoint', { AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example', AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example' }],
    ['wrong model', { AI_IMAGE_SANDBOX_MODEL: 'other-model' }],
    ['default request profile', { AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1' }],
    ['unsupported full edit operation', { AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT' }],
    ['minimal unsupported full edit', {
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2',
      AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT',
    }],
    ['minimal unsupported inpaint', {
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2',
      AI_IMAGE_SANDBOX_OPERATION: 'INPAINT',
    }],
  ])('rejects the Xiaoyi edit profile with %s', async (_label, overrides) => {
    const value = await fixture('IMAGE_TO_IMAGE');
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...value.environment,
        AI_IMAGE_SANDBOX_BASE_URL: 'https://image.xiaoyiapi.xyz/v1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'image.xiaoyiapi.xyz',
        AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1',
        ...overrides,
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['FULL_EDIT', 'INPAINT'])(
    'rejects a generic-profile downgrade for Xiaoyi %s',
    async (operation) => {
      const value = await fixture(operation);
      await expect(runAiImageProviderApprovalDraft({
        environment: {
          ...value.environment,
          AI_IMAGE_SANDBOX_BASE_URL: 'https://image.xiaoyiapi.xyz/v1',
          AI_IMAGE_SANDBOX_EXPECTED_HOST: 'image.xiaoyiapi.xyz',
          AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
          AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
        },
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
      })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID' });
      await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each([
    'XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1',
    'XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2',
  ])('rejects legacy cents for %s', async (requestProfile) => {
    const value = await fixture('IMAGE_TO_IMAGE');
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...value.environment,
        AI_IMAGE_SANDBOX_BASE_URL: 'https://image.xiaoyiapi.xyz/v1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'image.xiaoyiapi.xyz',
        AI_IMAGE_SANDBOX_MODEL: 'gpt-image-2',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: requestProfile,
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('binds an exact sub-cent CNY quote without decimal conversion', async () => {
    const value = await fixture('TEXT_TO_IMAGE');
    const {
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: _legacyQuote,
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: _legacyMaximum,
      ...baseEnvironment
    } = value.environment;
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

    const result = await runAiImageProviderApprovalDraft({
      environment: {
        ...baseEnvironment,
        AI_IMAGE_SANDBOX_CURRENCY: 'CNY',
        AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '119',
        AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: '119',
        AI_IMAGE_SANDBOX_COST_SCALE: '4',
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });

    expect(result.draft).toMatchObject({
      schemaVersion: 3,
      quotedCost: { currency: 'CNY', amount: 119, scale: 4 },
      maximumCost: { currency: 'CNY', amount: 119, scale: 4 },
    });
  });

  it('verifies an exact v3 sub-cent CNY approval without losing its scale', async () => {
    const value = await fixture('TEXT_TO_IMAGE');
    const {
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: _legacyQuote,
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: _legacyMaximum,
      ...baseEnvironment
    } = value.environment;
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const result = await runAiImageProviderApprovalDraft({
      environment: {
        ...baseEnvironment,
        AI_IMAGE_SANDBOX_CURRENCY: 'CNY',
        AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '119',
        AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: '200',
        AI_IMAGE_SANDBOX_COST_SCALE: '4',
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });
    const approval = {
      ...result.draft,
      statement: AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    };
    const approvalPath = join(value.privateDirectory, 'exact-money.approval.json');
    const approvalBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, 'utf8');
    await writeFile(approvalPath, approvalBytes, { mode: 0o600 });

    await expect(loadAiImageSandboxApproval({
      repositoryRoot: value.root,
      approvalPath,
      expectedSha256: sha256(approvalBytes),
      expected: {
        operationId: value.operationId,
        endpoint: 'https://relay.example/v1/images/generations',
        expectedHost: 'relay.example',
        model: 'edit-capable-model',
        operation: 'TEXT_TO_IMAGE',
        requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
        credentialRevision: 'secret-manager-revision-2',
        adapterRevision,
        sourceSha256: [],
        maskSha256: null,
        quotedCost: { currency: 'CNY', amount: 119, scale: 4 },
        maximumCost: { currency: 'CNY', amount: 200, scale: 4 },
      },
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({ currency: 'CNY' });
  });

  it('keeps completed v2 cents approvals exactly readable', async () => {
    const value = await fixture('TEXT_TO_IMAGE');
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const result = await runAiImageProviderApprovalDraft({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });
    const approval = {
      ...result.draft,
      statement: AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    };
    const approvalPath = join(value.privateDirectory, 'legacy-v2.approval.json');
    const bytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, 'utf8');
    await writeFile(approvalPath, bytes, { mode: 0o600 });

    await expect(loadAiImageSandboxApproval({
      repositoryRoot: value.root,
      approvalPath,
      expectedSha256: sha256(bytes),
      expected: {
        operationId: value.operationId,
        endpoint: 'https://relay.example/v1/images/generations',
        expectedHost: 'relay.example',
        model: 'edit-capable-model',
        operation: 'TEXT_TO_IMAGE',
        requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
        credentialRevision: 'secret-manager-revision-2',
        adapterRevision,
        sourceSha256: [],
        maskSha256: null,
        quotedCostCents: 10,
        maximumCostCents: 20,
      },
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({ currency: 'USD' });
  });

  it('rejects using an exact-money runner with a legacy v2 cents approval', async () => {
    const value = await fixture('TEXT_TO_IMAGE');
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const result = await runAiImageProviderApprovalDraft({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });
    const approval = {
      ...result.draft,
      statement: AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    };
    const approvalPath = join(value.privateDirectory, 'legacy-v2-exact-runner.approval.json');
    const bytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, 'utf8');
    await writeFile(approvalPath, bytes, { mode: 0o600 });

    await expect(loadAiImageSandboxApproval({
      repositoryRoot: value.root,
      approvalPath,
      expectedSha256: sha256(bytes),
      expected: {
        operationId: value.operationId,
        endpoint: 'https://relay.example/v1/images/generations',
        expectedHost: 'relay.example',
        model: 'edit-capable-model',
        operation: 'TEXT_TO_IMAGE',
        requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
        credentialRevision: 'secret-manager-revision-2',
        adapterRevision,
        sourceSha256: [],
        maskSha256: null,
        quotedCost: { currency: 'USD', amount: 10, scale: 2 },
        maximumCost: { currency: 'USD', amount: 20, scale: 2 },
      },
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_MISMATCH' });
  });

  it('rejects an exact v3 approval above the shared sandbox cost ceiling', async () => {
    const { value, approval, expected } = await completedExactApproval();
    (approval.maximumCost as Record<string, unknown>).amount = 1_000_000_001;
    expected.maximumCost.amount = 1_000_000_001;
    const approvalPath = join(value.privateDirectory, 'over-limit-v3.approval.json');
    const bytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, 'utf8');
    await writeFile(approvalPath, bytes, { mode: 0o600 });

    await expect(loadAiImageSandboxApproval({
      repositoryRoot: value.root,
      approvalPath,
      expectedSha256: sha256(bytes),
      expected,
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
  });

  it('rejects a floating exact amount', async () => {
    await expectExactApprovalRejected((approval) => {
      (approval.quotedCost as Record<string, unknown>).amount = 119.5;
    });
  });

  it('rejects a negative exact amount', async () => {
    await expectExactApprovalRejected((approval) => {
      (approval.quotedCost as Record<string, unknown>).amount = -119;
    });
  });

  it('rejects quote and maximum scale mismatch', async () => {
    await expectExactApprovalRejected((approval) => {
      (approval.maximumCost as Record<string, unknown>).scale = 3;
    });
  });

  it('rejects an exact quote above its maximum', async () => {
    await expectExactApprovalRejected((approval) => {
      (approval.quotedCost as Record<string, unknown>).amount = 201;
    });
  });

  it('rejects unknown exact-money fields', async () => {
    await expectExactApprovalRejected((approval) => {
      (approval.quotedCost as Record<string, unknown>).decimal = '0.0119';
    });
  });

  it('rejects a non-canonical exact amount representation', async () => {
    const { value, approval, expected } = await completedExactApproval();
    const canonical = `${JSON.stringify(approval, null, 2)}\n`;
    const nonCanonical = canonical.replace('"amount": 119', '"amount": 1.19e2');
    expect(nonCanonical).not.toBe(canonical);
    const approvalPath = join(value.privateDirectory, 'non-canonical-money.approval.json');
    const bytes = Buffer.from(nonCanonical, 'utf8');
    await writeFile(approvalPath, bytes, { mode: 0o600 });
    await expect(loadAiImageSandboxApproval({
      repositoryRoot: value.root,
      approvalPath,
      expectedSha256: sha256(bytes),
      expected,
      now: new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
  });

  it.each([
    ['floating amount', { AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '119.0' }],
    ['negative amount', { AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '-119' }],
    ['leading-zero amount', { AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '0119' }],
    ['floating scale', { AI_IMAGE_SANDBOX_COST_SCALE: '4.0' }],
  ])('rejects non-canonical exact-money environment input: %s', async (_label, override) => {
    const value = await fixture('TEXT_TO_IMAGE');
    const {
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: _legacyQuote,
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: _legacyMaximum,
      ...baseEnvironment
    } = value.environment;
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...baseEnvironment,
        AI_IMAGE_SANDBOX_CURRENCY: 'CNY',
        AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '119',
        AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: '200',
        AI_IMAGE_SANDBOX_COST_SCALE: '4',
        ...override,
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves the existing sandbox maximum-cost bound for exact money', async () => {
    const value = await fixture('TEXT_TO_IMAGE');
    const {
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: _legacyQuote,
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: _legacyMaximum,
      ...baseEnvironment
    } = value.environment;
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...baseEnvironment,
        AI_IMAGE_SANDBOX_CURRENCY: 'CNY',
        AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT: '119',
        AI_IMAGE_SANDBOX_MAX_COST_AMOUNT: '1000000001',
        AI_IMAGE_SANDBOX_COST_SCALE: '4',
      },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFIG_INVALID' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes one private canonical draft that the approval loader must reject', async () => {
    const value = await fixture();
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    const stdout: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const resolveRevision = vi.fn(async () => adapterRevision);

    const result = await runAiImageProviderApprovalDraft({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(resolveRevision).toHaveBeenCalledWith(
      value.root,
      undefined,
      expect.arrayContaining([
        'apps/server/scripts/ai-image-provider-approval-draft.ts',
        'apps/server/src/services/ai-image-sandbox-approval.ts',
        'apps/server/src/services/ai-image-sandbox-code-revision.ts',
        'apps/server/src/services/ai-image-job-error.ts',
        'apps/server/src/services/ai-image-openai-url.ts',
        'packages/shared/src/ai-image-workbench-contract.ts',
      ]),
      undefined,
    );
    expect(result.replayed).toBe(false);
    expect(result.draftSha256).toMatch(/^[a-f0-9]{64}$/u);
    const bytes = await readFile(value.draftPath);
    expect(sha256(bytes)).toBe(result.draftSha256);
    expect(bytes.toString('utf8')).toBe(`${JSON.stringify(result.draft, null, 2)}\n`);
    expect(result.draft).toMatchObject({
      schemaVersion: 2,
      statement: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT,
      approvedAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
      expiresAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
      requestCount: 1,
      operationId: value.operationId,
      endpoint: 'https://relay.example/v1/images/edits',
      expectedHost: 'relay.example',
      model: 'edit-capable-model',
      operation: 'FULL_EDIT',
      sourceSha256: [value.environment.AI_IMAGE_SANDBOX_SOURCE_SHA256],
      maskSha256: null,
      quotedCostCents: 10,
      maximumCostCents: 20,
    });
    if (process.platform !== 'win32') {
      expect((await stat(value.draftPath)).mode & 0o777).toBe(0o600);
    }
    const output = stdout.join('');
    expect(output).toContain('AI_IMAGE_SANDBOX_APPROVAL_DRAFT_CREATED');
    expect(output).toContain(result.draftSha256);
    expect(output).not.toContain('https://relay.example');
    expect(output).not.toContain('edit-capable-model');
    expect(output).not.toContain('provider-account-main');
    expect(output).not.toContain(value.draftPath);

    await expect(loadAiImageSandboxApproval({
      repositoryRoot: value.root,
      approvalPath: value.draftPath,
      expectedSha256: result.draftSha256,
      now: new Date('2030-01-01T00:00:00.000Z'),
      expected: {
        operationId: value.operationId,
        endpoint: 'https://relay.example/v1/images/edits',
        expectedHost: 'relay.example',
        model: 'edit-capable-model',
        operation: 'FULL_EDIT',
        requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
        credentialRevision: 'secret-manager-revision-2',
        adapterRevision,
        sourceSha256: [String(value.environment.AI_IMAGE_SANDBOX_SOURCE_SHA256)],
        maskSha256: null,
        quotedCostCents: 10,
        maximumCostCents: 20,
      },
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
  });

  it.each([
    ['TEXT_TO_IMAGE', 'https://relay.example/v1/images/generations', [], null],
    ['INPAINT', 'https://relay.example/v1/images/edits', 'source', 'mask'],
  ])('builds the operation-specific %s media contract', async (
    operation,
    endpoint,
    expectedSource,
    expectedMask,
  ) => {
    const value = await fixture(operation);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const result = await runAiImageProviderApprovalDraft({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });

    expect(result.draft.endpoint).toBe(endpoint);
    expect(result.draft.sourceSha256).toEqual(expectedSource === 'source'
      ? [value.environment.AI_IMAGE_SANDBOX_SOURCE_SHA256]
      : expectedSource);
    expect(result.draft.maskSha256).toBe(expectedMask === 'mask'
      ? value.environment.AI_IMAGE_SANDBOX_MASK_SHA256
      : expectedMask);
  });

  it('keeps the statement and timestamp sentinels independently non-authoritative', async () => {
    const value = await fixture();
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    const result = await runAiImageProviderApprovalDraft({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    });
    expect(AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT).not.toBe(
      AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
    );
    expect(Number.isFinite(Date.parse(AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP))).toBe(false);

    const expected = {
      operationId: value.operationId,
      endpoint: 'https://relay.example/v1/images/edits',
      expectedHost: 'relay.example',
      model: 'edit-capable-model',
      operation: 'FULL_EDIT' as const,
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      credentialRevision: 'secret-manager-revision-2',
      adapterRevision,
      sourceSha256: [String(value.environment.AI_IMAGE_SANDBOX_SOURCE_SHA256)],
      maskSha256: null,
      quotedCostCents: 10,
      maximumCostCents: 20,
    };
    const cases = [
      {
        name: 'statement-only',
        draft: { ...result.draft, statement: AI_IMAGE_SANDBOX_APPROVAL_STATEMENT },
      },
      {
        name: 'timestamps-only',
        draft: {
          ...result.draft,
          approvedAt: '2030-01-01T00:00:00.000Z',
          expiresAt: '2030-01-01T00:30:00.000Z',
        },
      },
    ];
    for (const item of cases) {
      const path = join(value.privateDirectory, `${item.name}.approval.json`);
      const bytes = Buffer.from(`${JSON.stringify(item.draft, null, 2)}\n`, 'utf8');
      await writeFile(path, bytes, { mode: 0o600 });
      await expect(loadAiImageSandboxApproval({
        repositoryRoot: value.root,
        approvalPath: path,
        expectedSha256: sha256(bytes),
        expected,
        now: new Date('2030-01-01T00:10:00.000Z'),
      })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
    }
  });

  it.each([
    ['Provider key', { AI_IMAGE_SANDBOX_API_KEY: 'provider-secret' }],
    ['Xiaoyi key', { XIAOYI_API_KEY: 'provider-secret' }],
    ['Xiaoyi token', { XIAOYI_TOKEN: 'provider-secret' }],
    ['paid confirmation', { AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST' }],
    ['existing approval digest', { AI_IMAGE_SANDBOX_APPROVAL_SHA256: 'b'.repeat(64) }],
    ['Authorization', { AUTHORIZATION: 'Bearer provider-secret' }],
  ])('rejects %s before reading media or writing a draft', async (_label, unsafe) => {
    const value = await fixture();
    await expect(runAiImageProviderApprovalDraft({
      environment: { ...value.environment, ...unsafe },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_UNSAFE_ENV' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed on media, operation, endpoint, cost, and revision mismatches', async () => {
    const cases: Array<Record<string, string>> = [
      { AI_IMAGE_SANDBOX_SOURCE_SHA256: 'b'.repeat(64) },
      { AI_IMAGE_SANDBOX_OPERATION: 'UPSCALE' },
      { AI_IMAGE_SANDBOX_EXPECTED_HOST: 'other.example' },
      { AI_IMAGE_SANDBOX_MAX_COST_CENTS: '9' },
      { AI_IMAGE_SANDBOX_ADAPTER_REVISION: 'c'.repeat(40) },
    ];
    for (const overrides of cases) {
      const value = await fixture();
      await expect(runAiImageProviderApprovalDraft({
        environment: { ...value.environment, ...overrides },
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
      })).rejects.toBeDefined();
      await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it.each([
    { AI_IMAGE_SANDBOX_BASE_URL: 'http://relay.example' },
    { AI_IMAGE_SANDBOX_BASE_URL: 'https://127.0.0.1' },
    { AI_IMAGE_SANDBOX_BASE_URL: 'https://localhost' },
    { AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example/v1/images/edits' },
    { AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '0' },
    { AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '01' },
    { AI_IMAGE_SANDBOX_MAX_COST_CENTS: '10000001' },
  ])('rejects unsafe endpoint or non-canonical bounded cost %#', async (override) => {
    const value = await fixture();
    await expect(runAiImageProviderApprovalDraft({
      environment: { ...value.environment, ...override },
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toBeDefined();
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces operation-specific source and mask bindings', async () => {
    const text = await fixture('TEXT_TO_IMAGE');
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...text.environment,
        AI_IMAGE_SANDBOX_SOURCE_PATH: text.sourcePath,
        AI_IMAGE_SANDBOX_SOURCE_SHA256: 'b'.repeat(64),
      },
      repositoryRoot: text.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toBeDefined();

    const inpaint = await fixture('INPAINT');
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...inpaint.environment,
        AI_IMAGE_SANDBOX_MASK_PATH: '',
        AI_IMAGE_SANDBOX_MASK_SHA256: '',
      },
      repositoryRoot: inpaint.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toBeDefined();

    const fullEdit = await fixture('FULL_EDIT');
    await expect(runAiImageProviderApprovalDraft({
      environment: {
        ...fullEdit.environment,
        AI_IMAGE_SANDBOX_MASK_PATH: fullEdit.maskPath,
        AI_IMAGE_SANDBOX_MASK_SHA256: 'c'.repeat(64),
      },
      repositoryRoot: fullEdit.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toBeDefined();
  });

  it('enforces the shared 50 MiB aggregate edit-media boundary before writing', async () => {
    const maximumBytes = 50 * 1024 * 1024;
    const sourceBytes = Math.floor(maximumBytes / 2);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

    const exact = await fixture('INPAINT');
    await resizePinnedMedia(exact, sourceBytes, maximumBytes - sourceBytes);
    await expect(runAiImageProviderApprovalDraft({
      environment: exact.environment,
      repositoryRoot: exact.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).resolves.toMatchObject({ draft: { operation: 'INPAINT' } });

    const oversized = await fixture('INPAINT');
    await resizePinnedMedia(oversized, sourceBytes, maximumBytes - sourceBytes + 1);
    await expect(runAiImageProviderApprovalDraft({
      environment: oversized.environment,
      repositoryRoot: oversized.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_MEDIA_INVALID' });
    await expect(access(oversized.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites an existing draft', async () => {
    const value = await fixture();
    const original = Buffer.from('operator-owned existing draft\n', 'utf8');
    await writeFile(value.draftPath, original, { mode: 0o600 });
    await expect(runAiImageProviderApprovalDraft({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_CONFLICT' });
    expect(await readFile(value.draftPath)).toEqual(original);
  });

  it('requires a private pre-existing parent directory', async () => {
    if (process.platform === 'win32') return;
    const value = await fixture();
    await chmod(value.privateDirectory, 0o750);
    await expect(runAiImageProviderApprovalDraft({
      environment: value.environment,
      repositoryRoot: value.root,
      resolveRevision: vi.fn(async () => adapterRevision),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE' });
    await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform !== 'linux')(
    'pins the private parent descriptor across a path swap',
    async () => {
      const value = await fixture();
      const originalParent = join(value.root, 'private-original');
      vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);

      await expect(runAiImageProviderApprovalDraft({
        environment: value.environment,
        repositoryRoot: value.root,
        resolveRevision: vi.fn(async () => adapterRevision),
        beforeDraftWrite: async () => {
          await rename(value.privateDirectory, originalParent);
          await mkdir(value.privateDirectory, { mode: 0o700 });
        },
      } as Parameters<typeof runAiImageProviderApprovalDraft>[0] & {
        beforeDraftWrite: () => Promise<void>;
      })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DRAFT_PATH_UNSAFE' });

      await expect(access(value.draftPath)).rejects.toMatchObject({ code: 'ENOENT' });
      const pinnedDraft = JSON.parse(await readFile(
        join(originalParent, basename(value.draftPath)),
        'utf8',
      )) as Record<string, unknown>;
      expect(pinnedDraft.statement).toBe(AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT);
    },
  );
});
