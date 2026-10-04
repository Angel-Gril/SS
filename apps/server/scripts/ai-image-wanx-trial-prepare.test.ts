import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAiImageWanxTrialCommand } from './ai-image-wanx-trial-prepare.js';
import { sanitizeAiImageSandboxGitEnvironment } from '../src/services/ai-image-sandbox-code-revision.js';
import { makeWanxTrialInput, makeWanxTrialInputDraft, makeWanxTemplateSourceCaptures, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

const execFileAsync = promisify(execFile);
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(serverRoot, '../..');
const entry = 'apps/server/scripts/ai-image-provider-approval-draft.ts';
let temporaryRoot = '';
let repositoryRoot = '';
let revision = '';
let sequence = 0;

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'wanx-trial-cli-'));
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
        const dependency = resolve(dirname(join(sourceRoot, name)), /\.[^/]+$/u.test(specifier) ? specifier.replace(/\.js$/u, '.ts') : `${specifier}.ts`);
        pending.push(relative(sourceRoot, dependency).split(sep).join('/'));
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
  // This must never be loaded by either offline command.
  await writeFile(join(repositoryRoot, '.env'), 'DASHSCOPE_API_KEY=synthetic-env-poison\n');
  const git = (args: string[]) => execFileAsync('git', [
    '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment() });
  await git(['init']);
  await git(['add', '--', 'package.json', '.gitignore', ...copied]);
  await git(['-c', 'user.name=Trial Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test: bind offline trial source']);
  revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(temporaryRoot, 'deny-network.mjs'), [
    "import dns from 'node:dns';",
    "import net from 'node:net';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const deny = () => { throw new Error('TRIAL_TEST_NETWORK_FORBIDDEN'); };",
    'globalThis.fetch = deny; dns.lookup = deny; dns.promises.lookup = deny; net.connect = deny; net.createConnection = deny;',
    'syncBuiltinESMExports();',
  ].join('\n'));
}, 30_000);

afterAll(async () => {
  if (!temporaryRoot) return;
  const target = resolve(temporaryRoot);
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert(basename(target).startsWith('wanx-trial-cli-'));
  await rm(target, { recursive: true, force: true });
});

afterEach(() => vi.restoreAllMocks());

async function command(mode: string, evidenceRoot: string, roundId: string, extra: NodeJS.ProcessEnv = {}) {
  try {
    const result = await execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(temporaryRoot, 'deny-network.mjs')).href,
      '--import', pathToFileURL(join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
      join(repositoryRoot, entry), mode,
    ], {
      cwd: repositoryRoot, windowsHide: true, timeout: 30_000,
      env: {
        ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'sandbox', DOTENV_CONFIG_PATH: 'NUL',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_EVIDENCE_ROOT: evidenceRoot,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision,
        AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest,
        AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: roundId,
        ...extra,
      },
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    return { exitCode: typeof error.code === 'number' ? error.code : -1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
}

async function fixture() {
  const evidenceRoot = join(temporaryRoot, `private-${++sequence}`);
  await mkdir(evidenceRoot, { mode: 0o700 });
  const request = await makeWanxTrialInput(evidenceRoot, revision, `fixture-round-${sequence}`);
  return { evidenceRoot, request };
}

async function prepare(value: Awaited<ReturnType<typeof fixture>>, extra: NodeJS.ProcessEnv = {}) {
  const inputPath = join(value.evidenceRoot, 'input.json');
  const bytes = trialJson(value.request);
  await writeFile(inputPath, bytes, { mode: 0o600 });
  const result = await command('--prepare-wanx-trial', value.evidenceRoot, value.request.roundId, {
    AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: inputPath,
    AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(bytes), ...extra,
  });
  expect(await readFile(inputPath)).toEqual(bytes);
  return result;
}

describe('offline Wanx trial preparation CLI', () => {
  describe('campaign budget commands', () => {
    it('rejects a reassignment pin in preparation mode', async () => {
      const value = await fixture();
      const result = await prepare(value, { AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256: 'e'.repeat(64) });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('WANX_TRIAL_CONFIG_INVALID');
    });

    it.each(['AI_IMAGE_SANDBOX_API_KEY', 'AI_IMAGE_SANDBOX_CONFIRM'])('rejects %s in reassignment mode', async name => {
      const value = await fixture();
      const before = (await readdir(value.evidenceRoot)).sort();
      const result = await command('--reassign-wanx-campaign', value.evidenceRoot, value.request.roundId, {
        [name]: 'synthetic-reassignment-secret-sentinel',
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('WANX_TRIAL_UNSAFE_ENV');
      expect(result.stderr).not.toContain('synthetic-reassignment-secret-sentinel');
      expect((await readdir(value.evidenceRoot)).sort()).toEqual(before);
    });

    it.each([
      ['--assume-unchanged', '--no-assume-unchanged', 'apps/server/src/services/ai-image-sandbox-media.ts'],
      ['--skip-worktree', '--no-skip-worktree', 'packages/shared/src/ai-image-workbench-contract.ts'],
    ])('rejects hidden dependency drift (%s)', async (hide, restore, name) => {
      const value = await fixture();
      const path = join(repositoryRoot, name);
      const original = await readFile(path);
      const git = (args: string[]) => execFileAsync('git', args, {
        cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment(),
      });
      try {
        await git(['update-index', hide, '--', name]);
        await writeFile(path, Buffer.concat([original, Buffer.from('\n// Hidden campaign dependency drift.\n')]));
        expect((await git(['status', '--porcelain=v1'])).stdout).toBe('');
        const result = await command('--inspect-wanx-campaign', value.evidenceRoot, '', {
          AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: '',
        });
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('SANDBOX_ADAPTER_FILE_DIRTY');
        expect(await readdir(value.evidenceRoot)).not.toContain('wanx-campaign.authorization.json');
      } finally {
        await writeFile(path, original);
        await git(['update-index', restore, '--', name]);
      }
    }, 30_000);

    it('inspects an empty campaign without creating authorization or reservations', async () => {
      const value = await fixture();
      const before = (await readdir(value.evidenceRoot)).sort();
      const result = await command('--inspect-wanx-campaign', value.evidenceRoot, '', {
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: '',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        canSubmit: false, observationOnly: true, allocationCount: 0,
        maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
        history: { campaignScopeSha256: null, reservationSha256s: [], tipSha256: null },
      });
      expect((await readdir(value.evidenceRoot)).sort()).toEqual(before);
    });

    it.each([
      'AI_IMAGE_SANDBOX_API_KEY', 'AI_IMAGE_SANDBOX_CONFIRM', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
    ])('rejects %s in offline campaign authorization without leaking its value', async name => {
      const value = await fixture();
      const before = (await readdir(value.evidenceRoot)).sort();
      const result = await command('--authorize-wanx-campaign', value.evidenceRoot, value.request.roundId, {
        [name]: 'synthetic-campaign-secret-sentinel',
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('WANX_TRIAL_UNSAFE_ENV');
      expect(result.stderr).not.toContain('synthetic-campaign-secret-sentinel');
      expect((await readdir(value.evidenceRoot)).sort()).toEqual(before);
    });

    it('rejects consent inputs in the history-only mode', async () => {
      const value = await fixture();
      const result = await command('--inspect-wanx-campaign', value.evidenceRoot, '', {
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: '',
        AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_PATH: 'unreviewed.json',
      });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('WANX_TRIAL_CONFIG_INVALID');
      expect(await readdir(value.evidenceRoot)).not.toContain('wanx-campaign.authorization.json');
    });
  });

  it('imports pinned HTTP captures before compiling, preparing and verifying through real CLI processes', async () => {
    const value = await fixture();
    const captures = await makeWanxTemplateSourceCaptures(value.evidenceRoot, revision, value.request.roundId);
    const capturePath = join(value.evidenceRoot, 'source-captures.json');
    const captureBytes = trialJson(captures.request);
    await writeFile(capturePath, captureBytes, { mode: 0o600 });
    const imported = await command('--import-wanx-template-sources', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_ERP_ORIGIN: captures.erpOrigin,
      AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: capturePath, AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(captureBytes),
    });
    expect(imported.exitCode).toBe(0);
    expect(imported.stderr).toBe('');
    const importSummary = JSON.parse(imported.stdout);
    expect(importSummary).toMatchObject({ canSubmit: false, sourceAuthentication: 'REQUIRES_CAPTURE_REVIEW' });
    for (const operation of captures.draft.request.operations) {
      operation.templateSource = importSummary.sources.find((item: any) => item.operation === operation.operation).templateSource;
    }
    const draftPath = join(value.evidenceRoot, 'imported-input.json');
    const draftBytes = trialJson(captures.draft.request);
    await writeFile(draftPath, draftBytes, { mode: 0o600 });
    const compiled = await command('--compile-wanx-trial-input', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: draftPath, AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(draftBytes),
    });
    expect(compiled.exitCode).toBe(0);
    expect(compiled.stderr).toBe('');
    const compileSummary = JSON.parse(compiled.stdout);
    const prepared = await command('--prepare-wanx-trial', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: join(value.evidenceRoot, `wanx-input-${value.request.roundId}`, 'input.json'),
      AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: compileSummary.inputSha256,
    });
    expect(prepared.exitCode).toBe(0);
    expect(prepared.stderr).toBe('');
    const verified = await command('--verify-wanx-trial', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: JSON.parse(prepared.stdout).manifestSha256,
    });
    expect(verified.exitCode).toBe(0);
    expect(verified.stderr).toBe('');
    expect(JSON.parse(verified.stdout)).toMatchObject({ canSubmit: false, actualCost: null,
      sourceVerification: 'OFFLINE_CONSISTENCY_ONLY' });
  }, 60_000);

  it('compiles captured HTTP source data then prepares and verifies through real offline CLI processes', async () => {
    const value = await fixture();
    const draft = await makeWanxTrialInputDraft(value.evidenceRoot, revision, value.request.roundId);
    for (const operation of draft.request.operations) {
      const envelope = JSON.parse(await readFile(join(value.evidenceRoot, `${operation.operation.toLowerCase()}-response.json`), 'utf8'));
      expect(envelope.code).toBe(1);
      const exported = await readFile(join(value.evidenceRoot, operation.templateSource.path));
      expect(exported).toEqual(trialJson(envelope.data));
      expect(trialDigest(exported)).toBe(operation.templateSource.sha256);
    }
    const inputPath = join(value.evidenceRoot, 'raw-input.json');
    const bytes = trialJson(draft.request);
    await writeFile(inputPath, bytes, { mode: 0o600 });
    const result = await command('--compile-wanx-trial-input', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: inputPath, AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(bytes),
    });
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const compiled = JSON.parse(result.stdout);
    expect(compiled).toMatchObject({ event: 'AI_IMAGE_WANX_TRIAL_INPUT_COMPILED', canSubmit: false,
      actualCost: null, sourceAuthentication: 'REQUIRES_CAPTURE_REVIEW' });
    for (const privateValue of [value.evidenceRoot, draft.request.operations[0]!.prompt,
      draft.templateSources[0]!.activeRelease.id, 'synthetic-env-poison']) expect(result.stdout).not.toContain(privateValue);
    const compiledPath = join(value.evidenceRoot, `wanx-input-${value.request.roundId}`, 'input.json');
    expect(trialDigest(await readFile(compiledPath))).toBe(compiled.inputSha256);
    const prepared = await command('--prepare-wanx-trial', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: compiledPath, AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: compiled.inputSha256,
    });
    expect(prepared.stderr).toBe('');
    expect(prepared.exitCode).toBe(0);
    const manifest = JSON.parse(prepared.stdout);
    const verified = await command('--verify-wanx-trial', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: manifest.manifestSha256,
    });
    expect(verified.stderr).toBe('');
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ canSubmit: false, actualCost: null,
      sourceVerification: 'OFFLINE_CONSISTENCY_ONLY', manifestSha256: manifest.manifestSha256 });
    expect(await readdir(value.evidenceRoot)).not.toContain('execution');
  }, 45_000);

  it.each(['ai-image-wanx-trial-input.ts', 'ai-prompt-template-source.ts', 'ai-image-wanx-template-source-import.ts'])(
    'pins the new compiler dependency %s before reading source files', async (name) => {
      const value = await fixture();
      const draft = await makeWanxTrialInputDraft(value.evidenceRoot, revision, value.request.roundId);
      const inputPath = join(value.evidenceRoot, 'raw-input.json');
      const bytes = trialJson(draft.request);
      await writeFile(inputPath, bytes, { mode: 0o600 });
      const helper = join(repositoryRoot, 'apps/server/src/services', name);
      const original = await readFile(helper);
      try {
        await writeFile(helper, Buffer.concat([original, Buffer.from('\n// synthetic dependency drift\n')]));
        const result = await command('--compile-wanx-trial-input', value.evidenceRoot, value.request.roundId, {
          AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: inputPath, AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(bytes),
        });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('SANDBOX_ADAPTER_FILE_DIRTY');
        expect(result.stdout).toBe('');
        expect(await readdir(value.evidenceRoot)).not.toContain(`wanx-input-${value.request.roundId}`);
      } finally { await writeFile(helper, original); }
    }, 45_000,
  );

  it('prepares a frozen two-operation round and verifies it without credentials, network, approval or settlement', async () => {
    const value = await fixture();
    const result = await prepare(value);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const prepared = JSON.parse(result.stdout);
    expect(prepared).toMatchObject({
      event: 'AI_IMAGE_WANX_TRIAL_PREPARED', canSubmit: false, actualCost: null,
      maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
      allocatedMaximumCost: { currency: 'CNY', amount: 5, scale: 1 }, requestCount: 2,
    });
    const directory = join(value.evidenceRoot, `wanx-trial-${value.request.roundId}`);
    expect((await readdir(directory)).sort()).toEqual(['full-edit-source.png', 'inpaint-mask.png', 'inpaint-source.png', 'manifest.json']);
    const bytes = await readFile(join(directory, 'manifest.json'));
    expect(trialDigest(bytes)).toBe(prepared.manifestSha256);
    const manifest = JSON.parse(bytes.toString());
    expect(manifest).toMatchObject({
      kind: 'WANX_EDIT_TRIAL_PREPARATION_V1', state: 'PREPARED_NOT_APPROVED',
      canSubmit: false, actualCost: null, sourceVerification: 'OFFLINE_CONSISTENCY_ONLY',
    });
    expect(manifest.request.operations[0].frozenPrompt).toEqual(value.request.operations[0]!.frozenPrompt);
    expect(manifest.bindings.map((item: { operation: string }) => item.operation)).toEqual(['FULL_EDIT', 'INPAINT']);
    for (const secret of [value.evidenceRoot, value.request.operations[0]!.frozenPrompt.prompt, 'synthetic-env-poison', trialCredentialRevision]) {
      expect(result.stdout).not.toContain(secret);
    }
    const verified = await command('--verify-wanx-trial', value.evidenceRoot, value.request.roundId, {
      AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: prepared.manifestSha256,
    });
    expect(verified.stderr).toBe('');
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ event: 'AI_IMAGE_WANX_TRIAL_VERIFIED', canSubmit: false, manifestSha256: prepared.manifestSha256 });
    expect(await readFile(join(directory, 'manifest.json'))).toEqual(bytes);
  }, 45_000);

  it('rejects aggregate maxima exceeding CNY 1 even though every single quote is below its own maximum', async () => {
    const value = await fixture();
    for (const operation of value.request.operations) operation.maximumCost.amount = 60;
    const result = await prepare(value);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('WANX_TRIAL_BUDGET_INVALID');
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).not.toContain(`wanx-trial-${value.request.roundId}`);
  }, 45_000);

  it('rejects changed frozen text before creating a preparation directory', async () => {
    const value = await fixture();
    value.request.operations[0]!.frozenPrompt.resolvedPrompt += ' altered';
    const result = await prepare(value);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('FROZEN_PROMPT_MISMATCH');
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).not.toContain(`wanx-trial-${value.request.roundId}`);
  }, 45_000);

  it.each(['DASHSCOPE_API_KEY', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'AI_IMAGE_SANDBOX_CONFIRM', 'COOKIE', 'Authorization', 'dasHscope_api_key'])(
    'rejects %s before Git or private file access', async (name) => {
      const resolveRevision = vi.fn();
      const error = await runAiImageWanxTrialCommand('prepare', {
        environment: { NODE_ENV: 'sandbox', [name]: 'synthetic-do-not-disclose' }, resolveRevision,
      }).catch((value) => value);
      expect(error).toMatchObject({ code: 'WANX_TRIAL_UNSAFE_ENV' });
      expect(error.message).not.toContain('synthetic-do-not-disclose');
      expect(resolveRevision).not.toHaveBeenCalled();
    },
  );

  it('rejects an existing paid approval path instead of treating it as trial authority', async () => {
    const resolveRevision = vi.fn();
    await expect(runAiImageWanxTrialCommand('prepare', {
      environment: { NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_APPROVAL_PATH: 'must-not-open' }, resolveRevision,
    })).rejects.toMatchObject({ code: 'WANX_TRIAL_CONFIG_INVALID' });
    expect(resolveRevision).not.toHaveBeenCalled();
  });

  it('rejects paid confirmation in the real process without exposing its value', async () => {
    const value = await fixture();
    const result = await prepare(value, { AI_IMAGE_SANDBOX_CONFIRM: 'synthetic-paid-confirmation-secret' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('WANX_TRIAL_UNSAFE_ENV');
    expect(result.stdout + result.stderr).not.toContain('synthetic-paid-confirmation-secret');
    expect(await readdir(value.evidenceRoot)).not.toContain(`wanx-trial-${value.request.roundId}`);
  });

  it('rejects a helper changed outside its bound Git revision', async () => {
    const value = await fixture();
    const helper = join(repositoryRoot, 'apps/server/src/services/ai-image-wanx-trial-preparation.ts');
    const before = await readFile(helper);
    try {
      await writeFile(helper, Buffer.concat([before, Buffer.from('\n// synthetic source drift\n')]));
      const result = await prepare(value);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('SANDBOX_ADAPTER_FILE_DIRTY');
      expect(result.stdout).toBe('');
      expect(await readdir(value.evidenceRoot)).not.toContain(`wanx-trial-${value.request.roundId}`);
    } finally {
      await writeFile(helper, before);
    }
  }, 45_000);

  it('does not write or emit success after a revision change during preparation', async () => {
    const value = await fixture();
    const inputPath = join(value.evidenceRoot, 'input.json');
    const bytes = trialJson(value.request);
    await writeFile(inputPath, bytes, { mode: 0o600 });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const resolveRevision = vi.fn().mockResolvedValueOnce(revision).mockResolvedValueOnce('b'.repeat(40));
    await expect(runAiImageWanxTrialCommand('prepare', {
      repositoryRoot, resolveRevision,
      environment: {
        NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_EVIDENCE_ROOT: value.evidenceRoot,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision,
        AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest,
        AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: value.request.roundId,
        AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: inputPath,
        AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(bytes),
      },
    })).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(stdout).not.toHaveBeenCalled();
    expect(await readdir(value.evidenceRoot)).not.toContain(`wanx-trial-${value.request.roundId}`);
  });

  it('rejects a required helper that exists on disk but is not tracked by the checkout', async () => {
    const value = await fixture();
    const helper = 'apps/server/src/services/ai-image-wanx-trial-preparation.ts';
    const git = (args: string[]) => execFileAsync('git', ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', ...args], {
      cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment(),
    });
    try {
      await git(['update-index', '--force-remove', '--', helper]);
      const result = await prepare(value);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('SANDBOX_ADAPTER_FILE_UNTRACKED');
      expect(result.stdout).toBe('');
      expect(await readdir(value.evidenceRoot)).not.toContain(`wanx-trial-${value.request.roundId}`);
    } finally {
      await git(['add', '--', helper]);
    }
  }, 45_000);

  it('allows only one complete bundle when two separate preparation processes race', async () => {
    const value = await fixture();
    const inputPath = join(value.evidenceRoot, 'input.json');
    const bytes = trialJson(value.request);
    await writeFile(inputPath, bytes, { mode: 0o600 });
    const extra = { AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: inputPath, AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(bytes) };
    const results = await Promise.all([
      command('--prepare-wanx-trial', value.evidenceRoot, value.request.roundId, extra),
      command('--prepare-wanx-trial', value.evidenceRoot, value.request.roundId, extra),
    ]);
    expect(results.map((result) => result.exitCode).sort()).toEqual([0, 1]);
    const success = results.find((result) => result.exitCode === 0)!;
    const persisted = await readFile(join(value.evidenceRoot, `wanx-trial-${value.request.roundId}`, 'manifest.json'));
    expect(trialDigest(persisted)).toBe(JSON.parse(success.stdout).manifestSha256);
    expect(results.find((result) => result.exitCode === 1)!.stdout).toBe('');
  }, 45_000);
});
