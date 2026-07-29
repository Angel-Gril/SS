import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared/ai-image-workbench-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveAiImageSandboxRepositoryRevision,
  runAiImageProviderSingleSubmit,
  sanitizeAiImageSandboxGitEnvironment,
} from './ai-image-provider-single-submit.js';
import { assertAiImageSandboxApprovalCurrent } from '../src/services/ai-image-sandbox-approval.js';
import {
  AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT,
  finalizeAiImageSandboxBillingSettlement,
} from '../src/services/ai-image-sandbox-billing-settlement.js';

const directories: string[] = [];
const execFileAsync = promisify(execFile);
const APPROVAL_STATEMENT = 'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST';

async function withSandboxApproval(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
  overrides: Record<string, unknown> = {},
): Promise<NodeJS.ProcessEnv> {
  const operationId = String(environment.AI_IMAGE_SANDBOX_OPERATION_ID);
  const baseUrl = new URL(String(environment.AI_IMAGE_SANDBOX_BASE_URL));
  const apiBase = baseUrl.pathname === '/' ? new URL('/v1', baseUrl) : baseUrl;
  const operation = String(environment.AI_IMAGE_SANDBOX_OPERATION);
  const endpoint = new URL(
    `images/${operation === 'TEXT_TO_IMAGE' ? 'generations' : 'edits'}`,
    `${apiBase.toString().replace(/\/$/u, '')}/`,
  ).toString();
  const sourceSha256 = environment.AI_IMAGE_SANDBOX_SOURCE_SHA256
    ? [String(environment.AI_IMAGE_SANDBOX_SOURCE_SHA256)]
    : [];
  const maskSha256 = environment.AI_IMAGE_SANDBOX_MASK_SHA256
    ? String(environment.AI_IMAGE_SANDBOX_MASK_SHA256)
    : null;
  const approval = {
    schemaVersion: 2,
    approvalId: `approval-${operationId}`,
    statement: APPROVAL_STATEMENT,
    approvedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    approverRef: 'test-owner',
    providerAccountRef: 'test-provider-account',
    pricingRevision: 'test-pricing-r1',
    currency: 'USD',
    preCallBillingSnapshotRef: `billing-before-${operationId}`,
    billingReconciliationRef: `billing-after-${operationId}`,
    requestCount: 1,
    operationId,
    endpoint,
    expectedHost: String(environment.AI_IMAGE_SANDBOX_EXPECTED_HOST),
    model: String(environment.AI_IMAGE_SANDBOX_MODEL),
    operation,
    requestProfile: String(environment.AI_IMAGE_SANDBOX_REQUEST_PROFILE),
    credentialRevision: String(environment.AI_IMAGE_SANDBOX_CREDENTIAL_REVISION),
    adapterRevision: String(environment.AI_IMAGE_SANDBOX_ADAPTER_REVISION),
    sourceSha256,
    maskSha256,
    quotedCostCents: Number(environment.AI_IMAGE_SANDBOX_QUOTED_COST_CENTS),
    maximumCostCents: Number(environment.AI_IMAGE_SANDBOX_MAX_COST_CENTS),
    ...overrides,
  };
  const approvalBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  const approvalPath = join(repositoryRoot, `${operationId}.approval.json`);
  await writeFile(approvalPath, approvalBytes, { mode: 0o600 });
  return {
    ...environment,
    AI_IMAGE_SANDBOX_APPROVAL_PATH: approvalPath,
    AI_IMAGE_SANDBOX_APPROVAL_SHA256: createHash('sha256').update(approvalBytes).digest('hex'),
  };
}

async function initializeGitRepository(path: string): Promise<string> {
  await execFileAsync('git', ['init'], { cwd: path, windowsHide: true });
  await execFileAsync('git', ['config', 'user.email', 'sandbox@example.invalid'], { cwd: path, windowsHide: true });
  await execFileAsync('git', ['config', 'user.name', 'Sandbox Test'], { cwd: path, windowsHide: true });
  await writeFile(join(path, 'tracked.txt'), 'reviewed adapter\n');
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: path, windowsHide: true });
  await execFileAsync('git', ['commit', '-m', 'test: freeze adapter'], { cwd: path, windowsHide: true });
  const revision = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: path, windowsHide: true });
  return revision.stdout.trim().toLowerCase();
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('single-submit AI image sandbox runner', () => {
  it('fails closed when the approval freshness assertion receives forged timestamps', () => {
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: 'not-a-timestamp',
      expiresAt: 'also-not-a-timestamp',
    }, new Date('2030-01-01T00:00:00.000Z'))).toThrow(expect.objectContaining({
      code: 'SANDBOX_APPROVAL_SCHEMA_INVALID',
    }));
  });

  it('enforces approval validity and clock-skew boundaries', () => {
    const now = new Date('2030-01-01T00:10:00.000Z');
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T01:00:00.000Z',
    }, now)).not.toThrow();
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:15:00.000Z',
      expiresAt: '2030-01-01T01:00:00.000Z',
    }, now)).not.toThrow();
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:10:00.001Z',
    }, now)).not.toThrow();

    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:15:00.001Z',
      expiresAt: '2030-01-01T01:00:00.000Z',
    }, now)).toThrow(expect.objectContaining({ code: 'SANDBOX_APPROVAL_NOT_YET_VALID' }));
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:10:00.000Z',
    }, now)).toThrow(expect.objectContaining({ code: 'SANDBOX_APPROVAL_EXPIRED' }));
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T01:00:00.001Z',
    }, now)).toThrow(expect.objectContaining({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' }));
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:00:00+00:00',
      expiresAt: '2030-01-01T00:30:00.000Z',
    }, now)).toThrow(expect.objectContaining({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' }));
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }, now)).toThrow(expect.objectContaining({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' }));
    expect(() => assertAiImageSandboxApprovalCurrent({
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    }, new Date(Number.NaN))).toThrow(expect.objectContaining({
      code: 'SANDBOX_APPROVAL_CONFIG_INVALID',
    }));
  });

  it('scrubs paid sandbox secrets from Git child-process environments', () => {
    const sanitized = sanitizeAiImageSandboxGitEnvironment({
      PATH: 'test-path',
      AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret',
      ai_image_sandbox_confirm: 'paid-confirmation',
      DATABASE_URL: 'postgresql://secret',
      ALIYUN_ACCESS_KEY_SECRET: 'cloud-secret',
    });
    expect(sanitized).toEqual({ PATH: 'test-path' });
  });

  it('binds to a clean Git HEAD when DEPLOYED_COMMIT is absent and ignores untracked evidence', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-clean-'));
    directories.push(path);
    const revision = await initializeGitRepository(path);
    await writeFile(join(path, 'untracked-evidence.txt'), 'not part of the adapter\n');

    await expect(resolveAiImageSandboxRepositoryRevision(
      path,
      undefined,
      ['tracked.txt'],
    )).resolves.toBe(revision);
  });

  it('rejects marker-only execution when the production CLI requires a Git checkout', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-marker-only-'));
    directories.push(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${'a'.repeat(40)}\n`);

    await expect(resolveAiImageSandboxRepositoryRevision(
      path,
      undefined,
      [],
      true,
    )).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_GIT_REQUIRED' });
  });

  it('rejects a tracked dirty Git fallback before any sandbox request can be claimed', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-dirty-'));
    directories.push(path);
    await initializeGitRepository(path);
    await writeFile(join(path, 'tracked.txt'), 'changed after review\n');

    await expect(resolveAiImageSandboxRepositoryRevision(path)).rejects.toMatchObject({
      code: 'SANDBOX_ADAPTER_WORKTREE_DIRTY',
    });
  });

  it('rejects tracked drift even when DEPLOYED_COMMIT is present', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-marker-dirty-'));
    directories.push(path);
    const revision = await initializeGitRepository(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    await writeFile(join(path, 'tracked.txt'), 'changed after deployed marker\n');

    await expect(resolveAiImageSandboxRepositoryRevision(path)).rejects.toMatchObject({
      code: 'SANDBOX_ADAPTER_WORKTREE_DIRTY',
    });
  });

  it('rejects a deployed marker that differs from an available Git HEAD', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-marker-mismatch-'));
    directories.push(path);
    await initializeGitRepository(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${'b'.repeat(40)}\n`);

    await expect(resolveAiImageSandboxRepositoryRevision(path)).rejects.toMatchObject({
      code: 'SANDBOX_ADAPTER_REVISION_MISMATCH',
    });
  });

  it('fails closed when Git status cannot verify a checkout with a deployed marker', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-status-error-'));
    directories.push(path);
    const revision = await initializeGitRepository(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') return `${revision}\n`;
      throw Object.assign(new Error('Git status timed out'), { code: 'ETIMEDOUT' });
    });

    await expect(resolveAiImageSandboxRepositoryRevision(path, runGit)).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
  });

  it('fails closed when Git HEAD cannot be verified in a checkout with a deployed marker', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-head-error-'));
    directories.push(path);
    const revision = await initializeGitRepository(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const runGit = vi.fn(async () => {
      throw Object.assign(new Error('Git rev-parse failed'), { code: 'EACCES' });
    });

    await expect(resolveAiImageSandboxRepositoryRevision(path, runGit)).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(runGit).toHaveBeenCalledTimes(1);
  });

  it('rejects an untracked sandbox executable even when the remaining checkout is clean', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-untracked-'));
    directories.push(path);
    await initializeGitRepository(path);
    await writeFile(join(path, 'untracked-finalizer.ts'), 'export {};\n');

    await expect(resolveAiImageSandboxRepositoryRevision(
      path,
      undefined,
      ['untracked-finalizer.ts'],
    )).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_FILE_UNTRACKED' });
  });

  it('rejects a Git HEAD that changes during code verification', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-git-head-race-'));
    directories.push(path);
    await initializeGitRepository(path);
    const firstRevision = 'a'.repeat(40);
    const secondRevision = 'b'.repeat(40);
    let headReads = 0;
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse') {
        headReads += 1;
        return `${headReads === 1 ? firstRevision : secondRevision}\n`;
      }
      if (args[0] === 'status') return '';
      throw new Error(`Unexpected Git command: ${args.join(' ')}`);
    });

    await expect(resolveAiImageSandboxRepositoryRevision(
      path,
      runGit,
    )).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(headReads).toBe(2);
  });

  it.each(['ARBITRARY_PROFILE', 'toString', '__proto__'])(
    'rejects unknown request profile %s before creating an intent or sending a request', async (profile) => {
      const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
      directories.push(path);
      const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
      await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
      const fetch = vi.fn();

      await expect(runAiImageProviderSingleSubmit({
        environment: {
          NODE_ENV: 'sandbox',
          AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
          AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
          AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
          AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
          AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-invalid-profile-0001',
          AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
          AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
          AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
          AI_IMAGE_SANDBOX_REQUEST_PROFILE: profile,
          AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
          AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
          AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
        },
        repositoryRoot: path,
        outputDirectory: join(path, 'evidence'),
        resolveDns: async () => [{ address: '93.184.216.34' }],
        fetch,
      })).rejects.toMatchObject({ code: 'SANDBOX_REQUEST_PROFILE_INVALID' });

      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('rejects a declared adapter revision that differs from the deployed commit', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${'a'.repeat(40)}\n`);
    const fetch = vi.fn();

    await expect(runAiImageProviderSingleSubmit({
      environment: await withSandboxApproval(path, {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-adapter-mismatch-0001',
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: 'b'.repeat(40),
        AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      }),
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an approval packet for a different model before claiming or dispatching', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-mismatch-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    }, { model: 'different-model' });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_MISMATCH' });

    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(path, 'evidence', 'intents', 'sandbox-approval-mismatch-0001.intent.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires a reviewed approval file before DNS resolution or dispatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-required-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const fetch = vi.fn();
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);

    await expect(runAiImageProviderSingleSubmit({
      environment: {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'approved-model',
        AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-required-0001',
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      },
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_CONFIG_INVALID' });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preflights an exact approval without confirmation, API key, DNS, intent, or dispatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-preflight-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const fetch = vi.fn();
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const operationId = 'sandbox-approval-preflight-0001';
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).resolves.toMatchObject({
      event: 'AI_IMAGE_SANDBOX_APPROVAL_VERIFIED',
      operationId,
      operation: 'TEXT_TO_IMAGE',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      quotedCostCents: 10,
      maximumCostCents: 20,
      approvalEvidence: {
        approvalId: `approval-${operationId}`,
      },
    });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects aggregate inpaint media above the shared limit during offline preflight', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-preflight-media-limit-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const sourcePng = await sharp({
      create: { width: 2, height: 3, channels: 4, background: '#ffffff' },
    }).png().toBuffer();
    const maskPng = await sharp(Buffer.from([
      255, 255, 255, 0, 255, 255, 255, 255,
      255, 255, 255, 0, 255, 255, 255, 255,
      255, 255, 255, 0, 255, 255, 255, 255,
    ]), { raw: { width: 2, height: 3, channels: 4 } }).png().toBuffer();
    const source = Buffer.alloc(Math.floor(AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes / 2));
    const mask = Buffer.alloc(AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes - source.byteLength + 1);
    sourcePng.copy(source);
    maskPng.copy(mask);
    await writeFile(join(path, 'source.png'), source, { mode: 0o600 });
    await writeFile(join(path, 'mask.png'), mask, { mode: 0o600 });
    const operationId = 'sandbox-preflight-media-limit-0001';
    const resolveDns = vi.fn();
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'INPAINT',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_SOURCE_PATH: 'source.png',
      AI_IMAGE_SANDBOX_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'),
      AI_IMAGE_SANDBOX_MASK_PATH: 'mask.png',
      AI_IMAGE_SANDBOX_MASK_SHA256: createHash('sha256').update(mask).digest('hex'),
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_MEDIA_INVALID' });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects edit media above the shared dimension limit during offline preflight', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-preflight-dimensions-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const source = await sharp({
      create: {
        width: AI_IMAGE_WORKBENCH_LIMITS.maxDimension + 1,
        height: 1,
        channels: 3,
        background: '#ffffff',
      },
    }).png().toBuffer();
    await writeFile(join(path, 'source.png'), source, { mode: 0o600 });
    const operationId = 'sandbox-preflight-dimensions-0001';
    const resolveDns = vi.fn();
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_SOURCE_PATH: 'source.png',
      AI_IMAGE_SANDBOX_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'),
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_MEDIA_INVALID' });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a single edit file above the shared byte limit before hashing or DNS', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-preflight-file-limit-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const sourcePath = join(path, 'source.png');
    const source = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    await writeFile(sourcePath, source, { mode: 0o600 });
    await truncate(sourcePath, AI_IMAGE_WORKBENCH_LIMITS.maxRequestBytes + 1);
    const operationId = 'sandbox-preflight-file-limit-0001';
    const resolveDns = vi.fn();
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_SOURCE_PATH: 'source.png',
      AI_IMAGE_SANDBOX_SOURCE_SHA256: 'a'.repeat(64),
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toMatchObject({
      code: 'SANDBOX_MEDIA_INVALID',
      message: expect.stringMatching(/bounded regular file/u),
    });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['non-HTTPS', 'http://relay.example', 'relay.example'],
    ['localhost', 'https://localhost', 'localhost'],
  ])('rejects a %s endpoint in approval preflight before DNS or dispatch', async (
    _label,
    baseUrl,
    expectedHost,
  ) => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-http-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const resolveDns = vi.fn();
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: baseUrl,
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-http-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: expectedHost,
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toThrow(/must use (?:HTTPS|a public credential-free DNS hostname)/u);
    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechecks approval freshness immediately before reporting preflight success', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-preflight-expiry-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const operationId = 'sandbox-approval-preflight-expiry-0001';
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    }, {
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    });
    let clockReads = 0;

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns: vi.fn(),
      fetch: vi.fn(),
      now: () => {
        clockReads += 1;
        return new Date(clockReads >= 2
          ? '2030-01-01T00:31:00.000Z'
          : '2030-01-01T00:10:00.000Z');
      },
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_EXPIRED' });

    await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['paid confirmation', { AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST' }],
    ['API key', { AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-must-be-unset' }],
  ])('rejects %s in the offline approval preflight environment', async (_label, unsafeEnvironment) => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-preflight-safe-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const fetch = vi.fn();
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-preflight-safe-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      ...unsafeEnvironment,
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_PREFLIGHT_UNSAFE_ENV' });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['VERIFY_APPROVAL', 'SUBMIT'])(
    'rejects an expired approval in %s mode before DNS, intent, or dispatch', async (mode) => {
      const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-expired-'));
      directories.push(path);
      const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
      await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
      const fetch = vi.fn();
      const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);
      const operationId = `sandbox-approval-expired-${mode.toLowerCase()}`;
      const environment = await withSandboxApproval(path, {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_MODE: mode,
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_MODEL: 'approved-model',
        AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
        ...(mode === 'SUBMIT' ? {
          AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
          AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        } : {}),
      }, {
        schemaVersion: 2,
        approvedAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-01T01:00:00.000Z',
      });

      await expect(runAiImageProviderSingleSubmit({
        environment,
        repositoryRoot: path,
        outputDirectory: join(path, 'evidence'),
        resolveDns,
        fetch,
      })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_EXPIRED' });

      expect(resolveDns).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rechecks approval expiry at submit after an earlier offline preflight passed', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-recheck-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const operationId = 'sandbox-approval-recheck-0001';
    const baseEnvironment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    }, {
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    });
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const fetch = vi.fn();

    await expect(runAiImageProviderSingleSubmit({
      environment: { ...baseEnvironment, AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL' },
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
      now: () => new Date('2030-01-01T00:10:00.000Z'),
    })).resolves.toMatchObject({ event: 'AI_IMAGE_SANDBOX_APPROVAL_VERIFIED' });

    await expect(runAiImageProviderSingleSubmit({
      environment: {
        ...baseEnvironment,
        AI_IMAGE_SANDBOX_MODE: 'SUBMIT',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
      },
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
      now: () => new Date('2030-01-01T00:31:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_EXPIRED' });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks intent and dispatch when an approval expires during DNS validation', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-dns-expiry-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const operationId = 'sandbox-approval-dns-expiry-0001';
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'SUBMIT',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    }, {
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    });
    let now = new Date('2030-01-01T00:10:00.000Z');
    const resolveDns = vi.fn(async () => {
      now = new Date('2030-01-01T00:31:00.000Z');
      return [{ address: '93.184.216.34' }];
    });
    const fetch = vi.fn(async () => {
      throw new Error('Provider fetch must not run after approval expiry');
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
      now: () => now,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_EXPIRED' });

    expect(resolveDns).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await expect(readFile(join(path, 'evidence', 'intents', `${operationId}.intent.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks approval freshness at the guarded Provider POST boundary', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-post-expiry-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const operationId = 'sandbox-approval-post-expiry-0001';
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'SUBMIT',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    }, {
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:30:00.000Z',
    });
    let clockReads = 0;
    const fetch = vi.fn(async () => {
      throw new Error('Provider fetch must not run after approval expiry');
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
      now: () => {
        clockReads += 1;
        return new Date(clockReads >= 4
          ? '2030-01-01T00:31:00.000Z'
          : '2030-01-01T00:10:00.000Z');
      },
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_EXPIRED' });

    expect(fetch).not.toHaveBeenCalled();
    const report = JSON.parse(await readFile(
      join(path, 'evidence', `${operationId}.report.json`),
      'utf8',
    ));
    expect(report).toMatchObject({
      state: 'PRE_DISPATCH_FAILED',
      createRequests: 0,
      failureCode: 'SANDBOX_APPROVAL_EXPIRED',
    });
  });

  it('rejects an approval validity window longer than 60 minutes before preflight I/O', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-window-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-window-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    }, {
      approvedAt: '2030-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T02:00:00.000Z',
    });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
      now: () => new Date('2030-01-01T00:10:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a changed approval file before DNS resolution or dispatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-digest-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const fetch = vi.fn();
    const resolveDns = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-digest-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    });
    await writeFile(String(environment.AI_IMAGE_SANDBOX_APPROVAL_PATH), '{}\n');

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_DIGEST_MISMATCH' });

    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported approval fields so secrets cannot be hidden in the packet', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-closed-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-closed-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    }, { apiKey: 'must-not-be-accepted' });

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects non-canonical approval JSON with duplicate keys before DNS or dispatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-approval-duplicate-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const resolveDns = vi.fn();
    const fetch = vi.fn();
    const environment = await withSandboxApproval(path, {
      NODE_ENV: 'sandbox',
      AI_IMAGE_SANDBOX_MODE: 'VERIFY_APPROVAL',
      AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
      AI_IMAGE_SANDBOX_MODEL: 'approved-model',
      AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-approval-duplicate-0001',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
      AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
      AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
      AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
      AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
      AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
    });
    const approvalPath = String(environment.AI_IMAGE_SANDBOX_APPROVAL_PATH);
    const duplicateBytes = Buffer.from(
      (await readFile(approvalPath, 'utf8')).replace(
        '  "requestCount": 1,',
        '  "requestCount": 1,\n  "requestCount": 1,',
      ),
      'utf8',
    );
    await writeFile(approvalPath, duplicateBytes);
    environment.AI_IMAGE_SANDBOX_APPROVAL_SHA256 = createHash('sha256')
      .update(duplicateBytes)
      .digest('hex');

    await expect(runAiImageProviderSingleSubmit({
      environment,
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns,
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
    expect(resolveDns).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('writes endpoint-digest-only success evidence with private file modes', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();
    const result = await sharp({
      create: {
        width: 3,
        height: 3,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    }).png().toBuffer();
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${'35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3'}\n`);
    const operationId = 'sandbox-edit-success-0001';
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      id: 'provider-success-id-1',
      data: [{ b64_json: result.toString('base64') }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const report = await runAiImageProviderSingleSubmit({
      environment: await withSandboxApproval(path, {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0003',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_SOURCE_PATH: 'source.png',
        AI_IMAGE_SANDBOX_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'),
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      }),
      outputDirectory: path,
      repositoryRoot: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    });

    expect(report).toMatchObject({
      state: 'SUCCEEDED',
      operationId,
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      requestedSize: '1024x1024',
      createRequests: 1,
      approvalEvidence: {
        approvalId: `approval-${operationId}`,
        currency: 'USD',
      },
    });
    const submittedForm = fetch.mock.calls[0]?.[1]?.body as FormData;
    expect(submittedForm.getAll('image')).toHaveLength(1);
    expect(submittedForm.has('image[]')).toBe(false);
    const reportPath = join(path, `${operationId}.report.json`);
    const storedReport = await readFile(reportPath, 'utf8');
    const intentPath = join(path, 'intents', `${operationId}.intent.json`);
    const storedIntent = await readFile(intentPath, 'utf8');
    const parsedReport = JSON.parse(storedReport);
    const parsedIntent = JSON.parse(storedIntent);
    expect(parsedReport).not.toHaveProperty('endpointPath');
    expect(parsedIntent).toMatchObject({
      endpointSha256: createHash('sha256')
        .update('https://relay.example/v1/images/edits')
        .digest('hex'),
      request: {
        approvalEvidence: {
          approvalId: `approval-${operationId}`,
          currency: 'USD',
        },
      },
    });
    expect(Date.parse(parsedReport.startedAt)).toBeGreaterThanOrEqual(
      Date.parse(parsedIntent.createdAt),
    );

    const claimPath = join(
      path,
      'intents',
      '.fingerprints',
      `${parsedIntent.requestFingerprint}.claim.json`,
    );
    const storedClaim = await readFile(claimPath);
    const preCallObservedAt = new Date(
      Date.parse(parsedIntent.request.approvalEvidence.approvedAt) - 1_000,
    ).toISOString();
    const settledObservedAt = new Date(Date.parse(parsedReport.completedAt) + 1_000).toISOString();
    const preCallBillingSnapshotPath = join(path, 'billing-before.snapshot');
    const settledBillingSnapshotPath = join(path, 'billing-settled.snapshot');
    const preCallBillingSnapshot = Buffer.from('test Provider balance before request\n', 'utf8');
    const settledBillingSnapshot = Buffer.from('test Provider balance after request\n', 'utf8');
    await writeFile(preCallBillingSnapshotPath, preCallBillingSnapshot, { mode: 0o600 });
    await writeFile(settledBillingSnapshotPath, settledBillingSnapshot, { mode: 0o600 });
    const billingAttestation = {
      schemaVersion: 1,
      settlementId: 'sandbox-edit-success-billing-0001',
      statement: AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_STATEMENT,
      operationId,
      preCallObservedAt,
      settledObservedAt,
      reconcilerRef: 'test-billing-review',
      providerAccountRef: 'test-provider-account',
      pricingRevision: 'test-pricing-r1',
      currency: 'USD',
      preCallBillingSnapshotRef: `billing-before-${operationId}`,
      billingReconciliationRef: `billing-after-${operationId}`,
      preCallBillingSnapshotPath,
      settledBillingSnapshotPath,
      preCallBillingSnapshotSha256: createHash('sha256')
        .update(preCallBillingSnapshot)
        .digest('hex'),
      settledBillingSnapshotSha256: createHash('sha256')
        .update(settledBillingSnapshot)
        .digest('hex'),
      providerBillingEntryRef: 'test-provider-ledger-entry',
      intentSha256: createHash('sha256').update(storedIntent).digest('hex'),
      submitReportSha256: createHash('sha256').update(storedReport).digest('hex'),
      fingerprintClaimSha256: createHash('sha256').update(storedClaim).digest('hex'),
      requestFingerprint: parsedIntent.requestFingerprint,
      approvalId: `approval-${operationId}`,
      approvalSha256: parsedIntent.request.approvalEvidence.approvalSha256,
      correlationMethod: 'PROVIDER_REQUEST_ID',
      providerRequestId: 'provider-success-id-1',
      billingOutcome: 'CHARGED',
      actualCostCents: 10,
    };
    const billingAttestationBytes = Buffer.from(
      `${JSON.stringify(billingAttestation, null, 2)}\n`,
      'utf8',
    );
    const billingAttestationPath = join(path, `${operationId}.billing.json`);
    await writeFile(billingAttestationPath, billingAttestationBytes, { mode: 0o600 });
    await expect(finalizeAiImageSandboxBillingSettlement({
      repositoryRoot: path,
      evidenceRoot: path,
      operationId,
      settlementPath: billingAttestationPath,
      settlementSha256: createHash('sha256').update(billingAttestationBytes).digest('hex'),
      finalizationAdapterRevision: 'b'.repeat(40),
      now: new Date(settledObservedAt),
    })).resolves.toMatchObject({
      receipt: {
        submitState: 'SUCCEEDED',
        billingOutcome: 'CHARGED',
        actualCostCents: 10,
      },
    });
    expect(storedReport + storedIntent).not.toContain('https://relay.example');
    expect(storedReport + storedIntent).not.toContain('test-owner');
    expect(storedReport + storedIntent).not.toContain('test-provider-account');
    expect(storedReport + storedIntent).not.toContain(`billing-before-${operationId}`);
    expect(storedReport + storedIntent).not.toContain(`${operationId}.approval.json`);
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o700);
      expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
      expect((await stat(intentPath)).mode & 0o777).toBe(0o600);
      expect((await stat(String((report as { imagePath: string }).imagePath))).mode & 0o777).toBe(0o600);
    }
  });

  it('writes a sanitized reconciliation report when the only Provider POST fails after dispatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${'35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3'}\n`);
    const operationId = 'sandbox-edit-failure-0001';
    const providerRequestId = 'provider-request-after-post-0001';
    const providerError = Object.assign(new Error('sensitive upstream response body'), {
      code: 'UND_ERR_SOCKET',
      providerJobId: providerRequestId,
    });
    const fetch = vi.fn(async () => {
      throw providerError;
    });

    await expect(runAiImageProviderSingleSubmit({
      environment: await withSandboxApproval(path, {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0002',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        AI_IMAGE_SANDBOX_OPERATION: 'IMAGE_TO_IMAGE',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OPENAI_SQUARE_SINGLE_V1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_SOURCE_PATH: sourcePath,
        AI_IMAGE_SANDBOX_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'),
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      }),
      outputDirectory: path,
      repositoryRoot: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toBe(providerError);

    const stored = await readFile(join(path, `${operationId}.report.json`), 'utf8');
    const expectedPrompt = [
      'Use the supplied source image as the only visual reference.',
      'Preserve the primary product identity, shape, colors, and proportions.',
      'Create one square marketplace hero image on a clearly visible soft warm-beige studio background.',
      'Do not add visible text, logos, watermarks, or extra objects.',
    ].join(' ');
    expect(JSON.parse(stored)).toMatchObject({
      operationId,
      state: 'RECONCILIATION_REQUIRED',
      operation: 'IMAGE_TO_IMAGE',
      endpointSha256: createHash('sha256')
        .update('https://relay.example/v1/images/edits')
        .digest('hex'),
      credentialRevision: 'admin-config-rev-0002',
      adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
      promptSha256: createHash('sha256').update(expectedPrompt).digest('hex'),
      sourceSha256: [createHash('sha256').update(source).digest('hex')],
      maskSha256: null,
      createRequests: 1,
      providerRequestIdHash: createHash('sha256').update(providerRequestId).digest('hex'),
      failureCode: 'UND_ERR_SOCKET',
      quotedCostCents: 10,
      maximumCostCents: 20,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(stored).not.toContain('sandbox-secret-never-report');
    expect(stored).not.toContain('sensitive upstream response body');
    expect(stored).not.toContain('https://relay.example');
    expect(stored).not.toContain(sourcePath);
  });

  it('binds a portrait text-to-image request to the exact generation body', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const result = await sharp({
      create: { width: 4, height: 6, channels: 3, background: '#eeeeee' },
    }).png().toBuffer();
    const fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: 'opaque-model-alias', n: 1, size: '1024x1536' });
      expect(body.prompt).toContain('vertical 2:3 Provider canvas; compose crop-safe for final 3:4 normalization marketplace product image');
      return new Response(JSON.stringify({ data: [{ b64_json: result.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(runAiImageProviderSingleSubmit({
      environment: await withSandboxApproval(path, {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-portrait-generation-0001',
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0004',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OZON_PORTRAIT_SINGLE_V1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      }),
      repositoryRoot: path,
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).resolves.toMatchObject({
      state: 'SUCCEEDED',
      requestProfile: 'OZON_PORTRAIT_SINGLE_V1',
      requestedSize: '1024x1536',
    });
  });

  it('binds a portrait inpaint request to one source and one meaningful PNG mask', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    const revision = '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3';
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${revision}\n`);
    const source = await sharp({
      create: { width: 2, height: 3, channels: 4, background: '#ffffff' },
    }).png().toBuffer();
    const mask = await sharp(Buffer.from([
      255, 255, 255, 0, 255, 255, 255, 255,
      255, 255, 255, 0, 255, 255, 255, 255,
      255, 255, 255, 0, 255, 255, 255, 255,
    ]), { raw: { width: 2, height: 3, channels: 4 } }).png().toBuffer();
    const result = await sharp({
      create: { width: 4, height: 6, channels: 3, background: '#ddeeff' },
    }).png().toBuffer();
    await writeFile(join(path, 'source.png'), source);
    await writeFile(join(path, 'mask.png'), mask);
    const fetch = vi.fn(async (_url, init) => {
      const form = init?.body as FormData;
      expect(form.get('size')).toBe('1024x1536');
      expect(form.getAll('image')).toHaveLength(1);
      expect(form.getAll('mask')).toHaveLength(1);
      return new Response(JSON.stringify({ data: [{ b64_json: result.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const operationId = 'sandbox-portrait-inpaint-0001';

    await expect(runAiImageProviderSingleSubmit({
      environment: await withSandboxApproval(path, {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0005',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_OPERATION: 'INPAINT',
        AI_IMAGE_SANDBOX_REQUEST_PROFILE: 'OZON_PORTRAIT_SINGLE_V1',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_SOURCE_PATH: 'source.png',
        AI_IMAGE_SANDBOX_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'),
        AI_IMAGE_SANDBOX_MASK_PATH: 'mask.png',
        AI_IMAGE_SANDBOX_MASK_SHA256: createHash('sha256').update(mask).digest('hex'),
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      }),
      repositoryRoot: path,
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).resolves.toMatchObject({ state: 'SUCCEEDED', operation: 'INPAINT' });

    const intent = JSON.parse(await readFile(join(path, 'intents', `${operationId}.intent.json`), 'utf8'));
    expect(intent.request).toMatchObject({
      requestProfile: 'OZON_PORTRAIT_SINGLE_V1',
      width: 1024,
      height: 1536,
      sourceDimensions: [{ width: 2, height: 3 }],
      maskDimensions: { width: 2, height: 3 },
    });
  });
});
