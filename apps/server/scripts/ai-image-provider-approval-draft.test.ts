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

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('AI image sandbox approval draft generator', () => {
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
