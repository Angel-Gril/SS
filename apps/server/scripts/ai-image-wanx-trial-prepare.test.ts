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
import { makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

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
        const dependency = resolve(dirname(join(sourceRoot, name)), specifier.replace(/\.js$/u, '.ts'));
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
