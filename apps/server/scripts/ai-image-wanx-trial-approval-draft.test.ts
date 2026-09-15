import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT,
  AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
} from './ai-image-provider-approval-draft.js';
import { runAiImageWanxTrialCommand } from './ai-image-wanx-trial-prepare.js';
import {
  AI_IMAGE_SANDBOX_APPROVAL_STATEMENT,
  loadAiImageSandboxApproval,
  type AiImageSandboxApprovalExpectedRequest,
} from '../src/services/ai-image-sandbox-approval.js';
import { sanitizeAiImageSandboxGitEnvironment } from '../src/services/ai-image-sandbox-code-revision.js';
import { makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

const execFileAsync = promisify(execFile);
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(serverRoot, '../..');
const entry = 'apps/server/scripts/ai-image-provider-approval-draft.ts';
const draftMode = 'approval-draft' as Parameters<typeof runAiImageWanxTrialCommand>[0];
const reviewMetadata = {
  approverRef: 'synthetic-reviewer-private-reference',
  providerAccountRef: 'synthetic-account-private-reference',
  pricingRevision: 'synthetic-price-policy-private-reference',
  preCallBillingSnapshotRef: 'synthetic-before-bill-private-reference',
  billingReconciliationRef: 'synthetic-settlement-private-reference',
};
const metadataEnvironment = {
  AI_IMAGE_SANDBOX_APPROVER_REF: reviewMetadata.approverRef,
  AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF: reviewMetadata.providerAccountRef,
  AI_IMAGE_SANDBOX_PRICING_REVISION: reviewMetadata.pricingRevision,
  AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF: reviewMetadata.preCallBillingSnapshotRef,
  AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF: reviewMetadata.billingReconciliationRef,
};
let temporaryRoot = '';
let repositoryRoot = '';
let revision = '';
let sequence = 0;

async function git(args: string[]) {
  return execFileAsync('git', ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment(),
  });
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'wanx-trial-approval-draft-'));
  repositoryRoot = join(temporaryRoot, 'checkout');
  await mkdir(repositoryRoot, { mode: 0o700 });
  const copied = new Set<string>();
  const dependencies = new Set<string>();
  const pending = [entry, 'packages/shared/package.json'];
  while (pending.length) {
    const name = pending.pop()!;
    if (copied.has(name)) continue;
    assert(!name.startsWith('..') && !name.includes('/../'));
    const source = await readFile(join(sourceRoot, name), 'utf8');
    const target = join(repositoryRoot, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
    copied.add(name);
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/gu)) {
      const specifier = match[1]!;
      if (specifier.startsWith('.')) {
        pending.push(relative(sourceRoot, resolve(dirname(join(sourceRoot, name)), specifier.replace(/\.js$/u, '.ts'))).split(sep).join('/'));
      } else if (specifier === 'shared' || specifier.startsWith('shared/')) {
        pending.push(`packages/shared/src/${specifier === 'shared' ? 'index' : specifier.slice(7)}.ts`);
      } else if (!specifier.startsWith('node:')) {
        dependencies.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!);
      }
    }
  }
  const modules = join(repositoryRoot, 'node_modules');
  await mkdir(modules);
  await symlink(join(repositoryRoot, 'packages/shared'), join(modules, 'shared'), 'junction');
  for (const dependency of dependencies) {
    let installed = join(serverRoot, 'node_modules', dependency);
    try { await access(installed); } catch { installed = join(sourceRoot, 'node_modules', dependency); }
    await mkdir(dirname(join(modules, dependency)), { recursive: true });
    await symlink(installed, join(modules, dependency), 'junction');
  }
  await writeFile(join(repositoryRoot, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(repositoryRoot, '.gitignore'), 'node_modules/\n.env\n');
  await writeFile(join(repositoryRoot, '.env'), 'DASHSCOPE_API_KEY=synthetic-never-load-this-key\n');
  await git(['init']);
  await git(['add', '--', 'package.json', '.gitignore', ...copied]);
  await git(['-c', 'user.name=Trial Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test: bind v4 draft fixture']);
  revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(temporaryRoot, 'deny-network.mjs'), [
    "import dns from 'node:dns';",
    "import net from 'node:net';",
    "import tls from 'node:tls';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const deny = () => { throw new Error('TRIAL_DRAFT_NETWORK_FORBIDDEN'); };",
    'globalThis.fetch = deny; dns.lookup = deny; dns.promises.lookup = deny; net.connect = deny; net.createConnection = deny; tls.connect = deny;',
    'syncBuiltinESMExports();',
  ].join('\n'));
}, 30_000);

afterAll(async () => {
  if (!temporaryRoot) return;
  const target = resolve(temporaryRoot);
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert(basename(target).startsWith('wanx-trial-approval-draft-'));
  await rm(target, { recursive: true, force: true });
});

afterEach(() => vi.restoreAllMocks());

async function command(flag: string, environment: NodeJS.ProcessEnv) {
  try {
    const result = await execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(temporaryRoot, 'deny-network.mjs')).href,
      '--import', pathToFileURL(join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
      join(repositoryRoot, entry), flag,
    ], {
      cwd: repositoryRoot, windowsHide: true, timeout: 30_000,
      env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'sandbox', DOTENV_CONFIG_PATH: 'NUL', ...environment },
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    return { exitCode: typeof error.code === 'number' ? error.code : -1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
}

async function fixture() {
  const evidenceRoot = join(temporaryRoot, `private-${++sequence}`);
  await mkdir(evidenceRoot, { mode: 0o700 });
  const request = await makeWanxTrialInput(evidenceRoot, revision, `draft-fixture-round-${sequence}`);
  const inpaint = request.operations.find((operation) => operation.operation === 'INPAINT')!;
  inpaint.quotedCost.amount = 17;
  inpaint.maximumCost.amount = 35;
  const inputPath = join(evidenceRoot, 'input.json');
  const inputBytes = trialJson(request);
  await writeFile(inputPath, inputBytes, { mode: 0o600 });
  const environment = {
    AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
    AI_IMAGE_SANDBOX_EVIDENCE_ROOT: evidenceRoot,
    AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision,
    AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest,
    AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: request.roundId,
  };
  const preparation = await command('--prepare-wanx-trial', {
    ...environment, AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: inputPath,
    AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(inputBytes),
  });
  expect(preparation, 'The existing prepare CLI must pass before testing draft mode').toMatchObject({ exitCode: 0, stderr: '' });
  const directory = join(evidenceRoot, `wanx-trial-${request.roundId}`);
  const manifestBytes = await readFile(join(directory, 'manifest.json'));
  return {
    evidenceRoot, request, directory, manifestBytes, manifest: JSON.parse(manifestBytes.toString()),
    approvalId: `draft-review-fixture-${sequence}`,
    environment: { ...environment, AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: trialDigest(manifestBytes) },
  };
}

function draftEnvironment(value: Awaited<ReturnType<typeof fixture>>, operation = 'FULL_EDIT') {
  return { ...value.environment, ...metadataEnvironment, AI_IMAGE_SANDBOX_OPERATION: operation, AI_IMAGE_SANDBOX_APPROVAL_ID: value.approvalId };
}

describe('Wanx trial v4 non-approval draft', () => {
  it('rejects an unbound reassignment pin instead of silently writing a draft', async () => {
    const value = await fixture();
    const result = await command('--draft-wanx-trial-approval', {
      ...draftEnvironment(value, 'INPAINT'), AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256: 'e'.repeat(64),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(await readdir(value.directory)).not.toContain('approval-drafts');
  }, 60_000);

  it.each([
    'AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_PATH', 'AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_SHA256',
    'AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_PATH', 'AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_SHA256',
  ])('rejects campaign-only budget grant material while drafting: %s', async name => {
    const value = await fixture();
    const result = await command('--draft-wanx-trial-approval', {
      ...draftEnvironment(value, 'INPAINT'), [name]: 'synthetic-campaign-binding',
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('WANX_TRIAL_CONFIG_INVALID');
    expect(await readdir(value.directory)).not.toContain('approval-drafts');
  }, 60_000);

  it.each([
    { AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256: 'a'.repeat(64) },
    { AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_PATH: 'unreviewed-quality.json' },
    { AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_SHA256: 'a'.repeat(64) },
  ])('does not ignore campaign authorization inputs while drafting: %j', async extra => {
    const value = await fixture();
    const result = await command('--draft-wanx-trial-approval', {
      ...draftEnvironment(value, 'INPAINT'), ...extra,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(await readdir(value.directory)).not.toContain('approval-drafts');
    expect(await readdir(value.directory)).not.toContain('execution');
  }, 60_000);

  it.each(['FULL_EDIT', 'INPAINT'] as const)('writes a v4 draft for %s from verified owner bindings without authorizing it', async (operation) => {
    const value = await fixture();
    const result = await command('--draft-wanx-trial-approval', draftEnvironment(value, operation));
    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    const summary = JSON.parse(result.stdout);
    const draftPath = join(value.directory, 'approval-drafts', `${value.approvalId}.json`);
    const bytes = await readFile(draftPath);
    const draft = JSON.parse(bytes.toString());
    const selected = value.request.operations.find((item) => item.operation === operation)!;
    const binding = value.manifest.bindings.find((item: { operation: string }) => item.operation === operation)!;
    const root = await realpath(value.evidenceRoot);
    const metadata = await lstat(root, { bigint: true });
    const trialBinding = {
      roundId: value.request.roundId,
      manifestSha256: trialDigest(value.manifestBytes),
      evidenceRootSha256: trialDigest(JSON.stringify({
        schema: 'ai-image-sandbox-evidence-root/v1',
        path: process.platform === 'win32' ? root.toLowerCase() : root,
        device: metadata.dev.toString(), inode: metadata.ino.toString(), birthtimeNs: metadata.birthtimeNs.toString(),
      })),
      providerAccountUidSha256: trialAccountDigest,
      requestFingerprint: binding.requestFingerprint,
      frozenPromptSha256: binding.frozenPromptSha256,
    };
    const expected: AiImageSandboxApprovalExpectedRequest = {
      operationId: selected.operationId,
      endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
      expectedHost: 'dashscope.aliyuncs.com', model: 'wanx2.1-imageedit', operation,
      requestProfile: operation === 'FULL_EDIT' ? 'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1' : 'DASHSCOPE_WANX21_INPAINT_ASYNC_V1',
      credentialRevision: trialCredentialRevision, adapterRevision: revision,
      sourceSha256: [selected.source.sha256], maskSha256: selected.mask?.sha256 ?? null,
      quotedCost: selected.quotedCost, maximumCost: selected.maximumCost, trialBinding,
    };
    expect(draft).toEqual({
      schemaVersion: 4, approvalId: value.approvalId,
      statement: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_STATEMENT,
      approvedAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
      expiresAt: AI_IMAGE_SANDBOX_APPROVAL_DRAFT_TIMESTAMP,
      ...reviewMetadata, requestCount: 1, ...expected,
    });
    expect(bytes).toEqual(trialJson(draft));
    expect(summary).toMatchObject({
      event: 'AI_IMAGE_WANX_TRIAL_APPROVAL_DRAFT_CREATED', approvalId: value.approvalId,
      operationId: selected.operationId, operation, draftSha256: trialDigest(bytes),
      canSubmit: false, actualCost: null, sourceVerification: 'OFFLINE_CONSISTENCY_ONLY',
    });
    for (const privateValue of [...Object.values(reviewMetadata), value.evidenceRoot, trialCredentialRevision,
      selected.frozenPrompt.prompt, selected.frozenPrompt.resolvedPrompt, 'synthetic-never-load-this-key']) {
      expect(result.stdout + result.stderr).not.toContain(privateValue);
    }
    expect(await readFile(join(value.directory, 'manifest.json'))).toEqual(value.manifestBytes);
    expect(await readdir(value.directory)).not.toContain('execution');
    if (process.platform !== 'win32') expect((await lstat(draftPath)).mode & 0o077).toBe(0);
    await expect(loadAiImageSandboxApproval({
      repositoryRoot, approvalPath: draftPath, expectedSha256: trialDigest(bytes), expected,
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
    const approvedAt = '2030-01-01T00:00:00.000Z';
    const expiresAt = '2030-01-01T00:30:00.000Z';
    const reviewedBytes = trialJson({ ...draft, statement: AI_IMAGE_SANDBOX_APPROVAL_STATEMENT, approvedAt, expiresAt });
    const reviewedPath = join(value.evidenceRoot, 'synthetic-reviewed.json');
    await writeFile(reviewedPath, reviewedBytes, { mode: 0o600 });
    await expect(loadAiImageSandboxApproval({
      repositoryRoot, approvalPath: reviewedPath, expectedSha256: trialDigest(reviewedBytes), expected,
      now: new Date('2030-01-01T00:05:00.000Z'),
    })).resolves.toMatchObject({ approvalId: value.approvalId, currency: 'CNY' });
    const legacyExpected = { ...expected };
    delete legacyExpected.trialBinding;
    await expect(loadAiImageSandboxApproval({
      repositoryRoot, approvalPath: reviewedPath, expectedSha256: trialDigest(reviewedBytes), expected: legacyExpected,
      now: new Date('2030-01-01T00:05:00.000Z'),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_MISMATCH' });
  }, 45_000);

  it('never overwrites a draft when another operation reuses its approval ID', async () => {
    const value = await fixture();
    const first = await command('--draft-wanx-trial-approval', draftEnvironment(value));
    expect(first).toMatchObject({ exitCode: 0, stderr: '' });
    const draftPath = join(value.directory, 'approval-drafts', `${value.approvalId}.json`);
    const before = await readFile(draftPath);
    const replay = await command('--draft-wanx-trial-approval', draftEnvironment(value, 'INPAINT'));
    expect(replay.exitCode).toBe(1);
    expect(replay.stdout).toBe('');
    expect(await readFile(draftPath)).toEqual(before);
  }, 90_000);

  it.each(['AI_IMAGE_SANDBOX_API_KEY', 'AI_IMAGE_SANDBOX_CONFIRM', 'DASHSCOPE_API_KEY', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'Authorization', 'COOKIE'])(
    'rejects %s before any revision or file access', async (name) => {
      const resolveRevision = vi.fn();
      const failure = await runAiImageWanxTrialCommand(draftMode, {
        environment: { NODE_ENV: 'sandbox', [name]: 'synthetic-must-not-be-disclosed' }, resolveRevision,
      }).catch((error) => error);
      expect(failure).toMatchObject({ code: 'WANX_TRIAL_UNSAFE_ENV' });
      expect(failure.message).not.toContain('synthetic-must-not-be-disclosed');
      expect(resolveRevision).not.toHaveBeenCalled();
    },
  );

  it.each([
    'AI_IMAGE_SANDBOX_OPERATION_ID', 'AI_IMAGE_SANDBOX_APPROVAL_PATH', 'AI_IMAGE_SANDBOX_APPROVAL_DRAFT_PATH',
    'AI_IMAGE_SANDBOX_BASE_URL', 'AI_IMAGE_SANDBOX_MODEL', 'AI_IMAGE_SANDBOX_REQUEST_PROFILE',
    'AI_IMAGE_SANDBOX_SOURCE_PATH', 'AI_IMAGE_SANDBOX_MASK_SHA256', 'AI_IMAGE_SANDBOX_QUOTED_COST_AMOUNT',
    'AI_IMAGE_SANDBOX_MAX_COST_CENTS', 'AI_IMAGE_SANDBOX_MODE', 'AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH',
  ])('rejects mixed or overriding %s before revision or file access', async (name) => {
    const resolveRevision = vi.fn();
    await expect(runAiImageWanxTrialCommand(draftMode, {
      environment: { NODE_ENV: 'sandbox', [name]: 'override-must-not-be-consumed' }, resolveRevision,
    })).rejects.toMatchObject({ code: 'WANX_TRIAL_CONFIG_INVALID' });
    expect(resolveRevision).not.toHaveBeenCalled();
  });

  it.each(['AI_IMAGE_SANDBOX_APPROVAL_ID', ...Object.keys(metadataEnvironment)])('requires the explicitly supplied %s without inventing metadata', async (name) => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: 'sandbox', ...metadataEnvironment,
      AI_IMAGE_SANDBOX_APPROVAL_ID: 'required-metadata-fixture', AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision, AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: 'required-round-fixture',
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision,
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest,
      AI_IMAGE_SANDBOX_EVIDENCE_ROOT: 'must-not-read-this-directory',
      AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: 'b'.repeat(64),
    };
    delete environment[name];
    const resolveRevision = vi.fn(async () => revision);
    await expect(runAiImageWanxTrialCommand(draftMode, { environment, resolveRevision }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CONFIG_INVALID' });
    expect(resolveRevision).not.toHaveBeenCalled();
  });

  it('rejects an unsupported mode before reading Git or private files', async () => {
    const resolveRevision = vi.fn();
    await expect(runAiImageWanxTrialCommand('SUBMIT' as typeof draftMode, {
      environment: { NODE_ENV: 'sandbox' }, resolveRevision,
    })).rejects.toMatchObject({ code: 'WANX_TRIAL_CONFIG_INVALID' });
    expect(resolveRevision).not.toHaveBeenCalled();
  });

  it('rejects invalid metadata and operations without writing a draft', async () => {
    const value = await fixture();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    for (const overrides of [
      { AI_IMAGE_SANDBOX_APPROVAL_ID: '../escape.json' },
      { AI_IMAGE_SANDBOX_APPROVAL_ID: 'a'.repeat(81) },
      { AI_IMAGE_SANDBOX_APPROVER_REF: undefined },
      { AI_IMAGE_SANDBOX_APPROVER_REF: 'review\nunsafe' },
      { AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF: 'a'.repeat(161) },
      { AI_IMAGE_SANDBOX_PRICING_REVISION: '' },
      { AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF: 'a'.repeat(201) },
      { AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF: 'invalid\u007fref' },
      { AI_IMAGE_SANDBOX_OPERATION: 'IMAGE_TO_IMAGE' },
    ]) {
      await expect(runAiImageWanxTrialCommand(draftMode, {
        repositoryRoot, environment: { NODE_ENV: 'sandbox', ...draftEnvironment(value), ...overrides },
      })).rejects.toBeDefined();
    }
    expect(stdout).not.toHaveBeenCalled();
    expect(await readdir(value.directory)).not.toContain('approval-drafts');
  }, 45_000);

  it('binds the execution helper to the real Git revision and rejects changed code', async () => {
    const value = await fixture();
    const helper = join(repositoryRoot, 'apps/server/src/services/ai-image-wanx-trial-execution.ts');
    const before = await readFile(helper);
    try {
      await writeFile(helper, Buffer.concat([before, Buffer.from('\n// synthetic unreviewed execution helper\n')]));
      const result = await command('--draft-wanx-trial-approval', draftEnvironment(value));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('SANDBOX_ADAPTER_FILE_DIRTY');
      expect(result.stdout).toBe('');
      expect(await readdir(value.directory)).not.toContain('approval-drafts');
    } finally {
      await writeFile(helper, before);
    }
  }, 45_000);
});
