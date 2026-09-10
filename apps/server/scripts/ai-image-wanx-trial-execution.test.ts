import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAiImageProviderSingleSubmit, sanitizeAiImageSandboxGitEnvironment, type AiImageProviderSingleSubmitOptions } from './ai-image-provider-single-submit.js';
import { buildAiImageWanxTrialPreparation, prepareAiImageWanxTrial } from '../src/services/ai-image-wanx-trial-preparation.js';
import { makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) }));

const execFileAsync = promisify(execFile);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let temporaryRoot = '';
let repositoryRoot = '';
let revision = '';
let sequence = 0;

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'wanx-trial-execution-'));
  repositoryRoot = join(temporaryRoot, 'checkout');
  await mkdir(repositoryRoot, { mode: 0o700 });
  const copied = new Set<string>();
  const pending = ['apps/server/scripts/ai-image-provider-single-submit.ts', 'apps/server/src/services/ai-image-wanx-trial-preparation.ts', 'apps/server/package.json'];
  while (pending.length) {
    const name = pending.pop()!;
    if (copied.has(name)) continue;
    assert(!name.startsWith('..') && !name.includes('/../'));
    const body = await readFile(join(sourceRoot, name), 'utf8');
    const target = join(repositoryRoot, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    copied.add(name);
    for (const match of body.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/gu)) {
      const specifier = match[1]!;
      if (specifier.startsWith('.')) {
        pending.push(relative(sourceRoot, resolve(dirname(join(sourceRoot, name)), specifier.replace(/\.js$/u, '.ts'))).split(sep).join('/'));
      } else if (specifier === 'shared' || specifier.startsWith('shared/')) {
        pending.push(`packages/shared/src/${specifier === 'shared' ? 'index' : specifier.slice(7)}.ts`);
      }
    }
    for (const match of body.matchAll(/['"]((?:apps\/server|packages\/shared)\/[A-Za-z0-9_./-]+\.(?:ts|json))['"]/gu)) pending.push(match[1]!);
  }
  await mkdir(join(repositoryRoot, 'node_modules'));
  for (const name of ['sharp', 'ipaddr.js', 'undici', 'zod']) {
    await symlink(join(sourceRoot, 'apps/server/node_modules', name), join(repositoryRoot, 'node_modules', name), 'junction');
  }
  await symlink(join(repositoryRoot, 'packages/shared'), join(repositoryRoot, 'node_modules/shared'), 'junction');
  await writeFile(join(temporaryRoot, 'invoke-trial.mjs'), [
    "import { readFile, appendFile } from 'node:fs/promises';",
    "import { resolve } from 'node:path';",
    "import { registerHooks } from 'node:module';",
    "const dnsStub = 'data:text/javascript,' + encodeURIComponent('export const lookup = async () => [{ address: \"8.8.8.8\", family: 4 }]; export default { lookup };');",
    "registerHooks({ resolve(name, context, next) { return name === 'node:dns/promises' ? { url: dnsStub, shortCircuit: true } : next(name, context); } });",
    "globalThis.fetch = async () => { throw new Error('UNEXPECTED_REAL_NETWORK'); };",
    "const { runAiImageProviderSingleSubmit } = await import(process.env.WANX_TEST_ENTRY);",
    "const root = process.env.AI_IMAGE_SANDBOX_EVIDENCE_ROOT;",
    "const operation = process.env.AI_IMAGE_SANDBOX_OPERATION;",
    "const round = process.env.AI_IMAGE_SANDBOX_TRIAL_ROUND_ID;",
    "const output = await readFile(resolve(root, `wanx-trial-${round}`, 'full-edit-source.png'));",
    "const fetcher = async (url, init) => {",
    "  if (init?.method === 'POST') {",
    "    const slot = JSON.parse(await readFile(resolve(root, `wanx-trial-${round}`, 'execution', `${operation}.claim.json`), 'utf8'));",
    "    if (slot.state !== 'CLAIMED_FAIL_CLOSED' || slot.operation !== operation) throw new Error('MISSING_DURABLE_SLOT');",
    "    const wire = JSON.parse(await readFile(resolve(root, 'intents/.fingerprints', `${slot.requestFingerprint}.claim.json`), 'utf8'));",
    "    if (wire.requestFingerprint !== slot.requestFingerprint) throw new Error('MISSING_DURABLE_WIRE_CLAIM');",
    "    await appendFile(process.env.WANX_TEST_NETWORK_LOG, JSON.stringify({ operation, pid: process.pid }) + '\\n', { mode: 0o600 });",
    "    return new Response(JSON.stringify({ output: { task_id: 'synthetic-process-task', task_status: 'PENDING' } }), { status: 200 });",
    "  }",
    "  if (String(url).includes('/tasks/')) return new Response(JSON.stringify({ output: { task_id: 'synthetic-process-task', task_status: 'SUCCEEDED', results: [{ url: 'https://dashscope-synthetic.oss-cn-beijing.aliyuncs.com/result.png' }], task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } }, usage: { image_count: 1 } }), { status: 200 });",
    "  if (new Headers(init?.headers).has('authorization')) throw new Error('CREDENTIAL_IN_RESULT_DOWNLOAD');",
    "  return new Response(new Uint8Array(output), { status: 200, headers: { 'content-type': 'image/png' } });",
    "};",
    "try { await runAiImageProviderSingleSubmit({ requireGitCheckout: true, resolveDns: async () => [{ address: '8.8.8.8' }], fetch: fetcher }); }",
    "catch (error) { process.stderr.write(String(error?.code || 'TRIAL_FAILED')); process.exitCode = 1; }",
  ].join('\n'));
  const git = (args: string[]) => execFileAsync('git', [
    '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment() });
  await git(['init']);
  await git(['add', '--', ...copied]);
  await git(['-c', 'user.name=Trial Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test: bind trial execution source']);
  revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
}, 30_000);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (!temporaryRoot) return;
  const target = resolve(temporaryRoot);
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert(basename(target).startsWith('wanx-trial-execution-'));
  await rm(target, { recursive: true, force: true });
});

async function fixture() {
  const evidenceRoot = join(temporaryRoot, `private-${++sequence}`);
  await mkdir(evidenceRoot, { mode: 0o700 });
  const request = await makeWanxTrialInput(evidenceRoot, revision, `execution-round-${sequence}`);
  const requestBytes = trialJson(request);
  const requestPath = join(evidenceRoot, 'input.json');
  await writeFile(requestPath, requestBytes, { mode: 0o600 });
  const prepared = await prepareAiImageWanxTrial({
    repositoryRoot, evidenceRoot, requestPath, requestSha256: trialDigest(requestBytes),
    expected: { roundId: request.roundId, adapterRevision: revision, providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision },
    assertRevision: async () => undefined,
  });
  const canonicalRoot = await realpath(evidenceRoot);
  const metadata = await lstat(canonicalRoot, { bigint: true });
  const evidenceRootSha256 = trialDigest(JSON.stringify({
    schema: 'ai-image-sandbox-evidence-root/v1',
    path: process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot,
    device: metadata.dev.toString(), inode: metadata.ino.toString(), birthtimeNs: metadata.birthtimeNs.toString(),
  }));
  const directory = join(evidenceRoot, `wanx-trial-${request.roundId}`);
  const calls: Array<{ operation: string; body: Record<string, any> }> = [];
  const output = await readFile(join(directory, 'full-edit-source.png'));
  const environments = new Map<string, NodeJS.ProcessEnv>();
  for (const operation of prepared.manifest.request.operations) {
    const binding = prepared.manifest.bindings.find((item) => item.operation === operation.operation)!;
    const approval = {
      schemaVersion: 4, approvalId: `approve-${operation.operationId}`,
      statement: 'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST',
      approvedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      approverRef: 'synthetic-operator', providerAccountRef: 'synthetic-account', pricingRevision: 'synthetic-cny-price-v1',
      preCallBillingSnapshotRef: 'synthetic-before-call', billingReconciliationRef: 'synthetic-await-native-bill',
      requestCount: 1, operationId: operation.operationId,
      endpoint: `${request.apiBase}/services/aigc/image2image/image-synthesis`, expectedHost: 'dashscope.aliyuncs.com',
      model: request.model, operation: operation.operation, requestProfile: binding.requestProfile,
      credentialRevision: trialCredentialRevision, adapterRevision: revision,
      sourceSha256: [operation.source.sha256], maskSha256: operation.mask?.sha256 ?? null,
      quotedCost: operation.quotedCost, maximumCost: operation.maximumCost,
      trialBinding: {
        roundId: request.roundId, manifestSha256: prepared.manifestSha256, evidenceRootSha256,
        providerAccountUidSha256: trialAccountDigest,
        requestFingerprint: binding.requestFingerprint, frozenPromptSha256: binding.frozenPromptSha256,
      },
    };
    const bytes = trialJson(approval);
    const approvalPath = join(evidenceRoot, `${operation.operation}.approval.json`);
    await writeFile(approvalPath, bytes, { mode: 0o600 });
    environments.set(operation.operation, {
      NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_MODE: 'TRIAL_SUBMIT',
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST', AI_IMAGE_SANDBOX_API_KEY: 'synthetic-wanx-trial-key',
      AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision, AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision,
      AI_IMAGE_SANDBOX_OPERATION: operation.operation, AI_IMAGE_SANDBOX_EVIDENCE_ROOT: evidenceRoot,
      AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: request.roundId, AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: prepared.manifestSha256,
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest,
      AI_IMAGE_SANDBOX_APPROVAL_PATH: approvalPath, AI_IMAGE_SANDBOX_APPROVAL_SHA256: trialDigest(bytes),
    });
  }
  const fetcher = (operation: string, loseResponse = false): typeof fetch => async (url, init) => {
    const requestUrl = String(url);
    if (init?.method === 'POST') {
      const slot = JSON.parse(await readFile(join(directory, 'execution', `${operation}.claim.json`), 'utf8'));
      const selected = prepared.manifest.request.operations.find((item) => item.operation === operation)!;
      const wire = prepared.manifest.bindings.find((item) => item.operation === operation)!;
      expect(slot).toMatchObject({ state: 'CLAIMED_FAIL_CLOSED', operation, maximumCost: selected.maximumCost });
      const intent = JSON.parse(await readFile(join(evidenceRoot, 'intents', `${selected.operationId}.intent.json`), 'utf8'));
      expect(intent.requestFingerprint).toBe(wire.requestFingerprint);
      const fingerprint = JSON.parse(await readFile(join(evidenceRoot, 'intents/.fingerprints', `${wire.requestFingerprint}.claim.json`), 'utf8'));
      expect(fingerprint.requestFingerprint).toBe(wire.requestFingerprint);
      const body = JSON.parse(String(init.body));
      expect(body.input.prompt).toBe(selected.frozenPrompt.resolvedPrompt);
      calls.push({ operation, body });
      if (loseResponse) throw new Error('synthetic response loss after dispatch');
      return new Response(JSON.stringify({ output: { task_id: `synthetic-${operation}`, task_status: 'PENDING' } }), { status: 200 });
    }
    if (requestUrl.includes('/tasks/')) return new Response(JSON.stringify({
      output: {
        task_id: `synthetic-${operation}`, task_status: 'SUCCEEDED',
        results: [{ url: 'https://dashscope-synthetic.oss-cn-beijing.aliyuncs.com/result.png' }],
        task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 },
      }, usage: { image_count: 1 },
    }), { status: 200 });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    return new Response(new Uint8Array(output), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  const run = (operation: 'FULL_EDIT' | 'INPAINT', loseResponse = false, extra: NodeJS.ProcessEnv = {}, options: Pick<AiImageProviderSingleSubmitOptions, 'resolveDns' | 'now' | 'outputDirectory'> = {}) => runAiImageProviderSingleSubmit({
    repositoryRoot, environment: { ...environments.get(operation)!, ...extra },
    resolveDns: async () => [{ address: '8.8.8.8' }], fetch: fetcher(operation, loseResponse), requireGitCheckout: true,
    ...options,
  });
  return { evidenceRoot, directory, request, prepared, calls, environments, run };
}

describe('Wanx trial execution through the real single-submit pipeline', () => {
  it.each([
    ['--verify-approval', '--submit-wanx-trial'],
    ['--submit-wanx-trial', '--submit-wanx-trial'],
    ['--unknown-mode'],
  ])('rejects mixed CLI intent or an unknown argument before credential access: %j', async (...args) => {
    const result = await execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(sourceRoot, 'apps/server/node_modules/tsx/dist/loader.mjs')).href,
      join(sourceRoot, 'apps/server/scripts/ai-image-provider-single-submit.ts'), ...args,
    ], {
      cwd: repositoryRoot, windowsHide: true, timeout: 10_000,
      env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'sandbox', DOTENV_CONFIG_PATH: 'NUL' },
    }).catch((error) => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('SANDBOX_MODE_INVALID');
  });

  it('persists both budget and wire claims before sending each frozen operation, without inferring an actual cost', async () => {
    const value = await fixture();
    const full = await value.run('FULL_EDIT');
    const inpaint = await value.run('INPAINT');
    expect(full).toMatchObject({ actualCost: null });
    expect(inpaint).toMatchObject({ actualCost: null });
    expect(value.calls.map((call) => call.operation)).toEqual(['FULL_EDIT', 'INPAINT']);
    const budget = JSON.parse(await readFile(join(value.directory, 'execution/round.json'), 'utf8'));
    expect(budget.maximumCost).toEqual({ currency: 'CNY', amount: 1, scale: 0 });
    expect((await readdir(join(value.directory, 'execution'))).sort()).toEqual(['FULL_EDIT.claim.json', 'INPAINT.claim.json', 'round.json']);
    for (const operation of value.prepared.manifest.request.operations) {
      const report = await readFile(join(value.evidenceRoot, `${operation.operationId}.report.json`));
      const evidence = JSON.parse(await readFile(join(value.evidenceRoot, `${operation.operationId}.wanx.trial-evidence.json`), 'utf8'));
      expect(evidence).toMatchObject({
        kind: 'WANX_EDIT_TRIAL_EXECUTION_EVIDENCE_V1', executionScope: 'ISOLATED_WANX_TRIAL',
        sourceVerification: 'OFFLINE_CONSISTENCY_ONLY', billingReconciliation: 'REQUIRED',
        reportSha256: trialDigest(report), outcome: 'SUCCEEDED',
        trialBinding: { manifestSha256: value.prepared.manifestSha256 },
      });
    }
  }, 60_000);

  it('allows only one downstream POST when two executions race for the same slot', async () => {
    const value = await fixture();
    const outcomes = await Promise.allSettled([value.run('FULL_EDIT'), value.run('FULL_EDIT')]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(value.calls).toHaveLength(1);
  }, 60_000);

  it('permits only one real runner process to dispatch for a shared round slot', async () => {
    const value = await fixture();
    const log = join(value.evidenceRoot, 'synthetic-network.jsonl');
    const invoke = async () => {
      try {
        const result = await execFileAsync(process.execPath, [
          '--import', pathToFileURL(join(sourceRoot, 'apps/server/node_modules/tsx/dist/loader.mjs')).href,
          join(temporaryRoot, 'invoke-trial.mjs'),
        ], {
          cwd: repositoryRoot, windowsHide: true, timeout: 90_000,
          env: {
            ...sanitizeAiImageSandboxGitEnvironment(), ...value.environments.get('FULL_EDIT'), DOTENV_CONFIG_PATH: 'NUL',
            WANX_TEST_ENTRY: pathToFileURL(join(repositoryRoot, 'apps/server/scripts/ai-image-provider-single-submit.ts')).href,
            WANX_TEST_NETWORK_LOG: log,
          },
        });
        return { code: 0, ...result };
      } catch (error: any) { return { code: error.code, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') }; }
    };
    const results = await Promise.all([invoke(), invoke()]);
    expect(results.map((result) => result.code).sort(), JSON.stringify(results.map(({ code, stderr }) => ({ code, stderr })))).toEqual([0, 1]);
    expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(1);
    for (const result of results) expect(result.stdout + result.stderr).not.toContain('synthetic-wanx-trial-key');
  }, 100_000);

  it('retains allocation and prevents another POST after an unknown response', async () => {
    const value = await fixture();
    await expect(value.run('FULL_EDIT', true)).rejects.toThrow();
    expect(value.calls).toHaveLength(1);
    const operationId = value.prepared.manifest.request.operations[0]!.operationId;
    const report = await readFile(join(value.evidenceRoot, `${operationId}.report.json`));
    const evidence = JSON.parse(await readFile(join(value.evidenceRoot, `${operationId}.wanx.trial-evidence.json`), 'utf8'));
    expect(evidence).toMatchObject({
      executionScope: 'ISOLATED_WANX_TRIAL', billingReconciliation: 'REQUIRED',
      reportSha256: trialDigest(report), outcome: 'RECONCILIATION_REQUIRED',
    });
    const claim = await readFile(join(value.directory, 'execution/FULL_EDIT.claim.json'));
    const environment = value.environments.get('FULL_EDIT')!;
    const approvalPath = environment.AI_IMAGE_SANDBOX_APPROVAL_PATH!;
    const approval = JSON.parse(await readFile(approvalPath, 'utf8'));
    approval.approvalId += '-new';
    const approvalBytes = trialJson(approval);
    await writeFile(approvalPath, approvalBytes, { mode: 0o600 });
    environment.AI_IMAGE_SANDBOX_APPROVAL_SHA256 = trialDigest(approvalBytes);
    await expect(value.run('FULL_EDIT')).rejects.toThrow();
    expect(value.calls).toHaveLength(1);
    expect(await readFile(join(value.directory, 'execution/FULL_EDIT.claim.json'))).toEqual(claim);
  }, 60_000);

  it.each(['AI_IMAGE_SANDBOX_OPERATION_ID', 'AI_IMAGE_SANDBOX_MAX_COST_AMOUNT', 'AI_IMAGE_SANDBOX_SOURCE_PATH'])(
    'rejects a trial override of %s before any request', async (name) => {
      const value = await fixture();
      await expect(value.run('FULL_EDIT', false, { [name]: 'override' })).rejects.toMatchObject({ code: 'WANX_TRIAL_REQUEST_OVERRIDE_FORBIDDEN' });
      expect(value.calls).toHaveLength(0);
    },
  );

  it('does not fall back to ordinary submit when trial mode is omitted', async () => {
    const value = await fixture();
    await expect(value.run('FULL_EDIT', false, { AI_IMAGE_SANDBOX_MODE: 'SUBMIT' })).rejects.toMatchObject({ code: 'WANX_TRIAL_MODE_REQUIRED' });
    expect(value.calls).toHaveLength(0);
  });

  it('does not accept an output directory override', async () => {
    const value = await fixture();
    await expect(value.run('FULL_EDIT', false, {}, { outputDirectory: join(temporaryRoot, 'different-output') }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_ROOT_OVERRIDE_FORBIDDEN' });
    expect(value.calls).toHaveLength(0);
  });

  it('requires shared package metadata to be tracked by the bound revision', async () => {
    const relativePath = 'packages/shared/package.json';
    const path = join(repositoryRoot, relativePath);
    const git = (args: string[]) => execFileAsync('git', ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', ...args], {
      cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment(),
    });
    const wasTracked = (await git(['ls-files', '--', relativePath])).stdout.trim() === relativePath;
    const before = await readFile(path).catch(() => null);
    try {
      await writeFile(path, await readFile(join(sourceRoot, relativePath)));
      await git(['rm', '--cached', '--ignore-unmatch', '--', relativePath]);
      const value = await fixture();
      await expect(value.run('FULL_EDIT')).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_FILE_UNTRACKED' });
      expect(value.calls).toHaveLength(0);
    } finally {
      if (before) await writeFile(path, before);
      else await rm(path, { force: true });
      if (wasTracked) await git(['add', '--', relativePath]);
    }
  }, 60_000);

  it('rejects a legacy approval in the explicit trial mode', async () => {
    const value = await fixture();
    const environment = value.environments.get('FULL_EDIT')!;
    const path = environment.AI_IMAGE_SANDBOX_APPROVAL_PATH!;
    const approval = JSON.parse(await readFile(path, 'utf8'));
    approval.schemaVersion = 3;
    delete approval.trialBinding;
    const bytes = trialJson(approval);
    await writeFile(path, bytes, { mode: 0o600 });
    environment.AI_IMAGE_SANDBOX_APPROVAL_SHA256 = trialDigest(bytes);
    await expect(value.run('FULL_EDIT')).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_MISMATCH' });
    expect(value.calls).toHaveLength(0);
  }, 60_000);

  it.each(['different-path', 'replaced-directory'] as const)('rejects copying a prepared round and approval into a %s root', async (change) => {
    const value = await fixture();
    const copy = join(temporaryRoot, `copy-${sequence}`);
    let destination = copy;
    if (change === 'replaced-directory') {
      await rename(value.evidenceRoot, copy);
      destination = value.evidenceRoot;
      await cp(copy, destination, { recursive: true });
    } else {
      await cp(value.evidenceRoot, destination, { recursive: true });
    }
    await expect(value.run('FULL_EDIT', false, {
      AI_IMAGE_SANDBOX_EVIDENCE_ROOT: destination,
      AI_IMAGE_SANDBOX_APPROVAL_PATH: join(destination, 'FULL_EDIT.approval.json'),
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_MISMATCH' });
    expect(value.calls).toHaveLength(0);
  }, 60_000);

  it('rejects a new manifest and approval that try to reallocate an already claimed round', async () => {
    const value = await fixture();
    await value.run('FULL_EDIT');
    const roundBefore = await readFile(join(value.directory, 'execution/round.json'));
    const request = structuredClone(value.prepared.manifest.request);
    request.operations[0]!.quotedCost.amount = 5;
    request.operations[0]!.maximumCost.amount = 10;
    request.operations[1]!.maximumCost.amount = 90;
    const changed = await buildAiImageWanxTrialPreparation({
      request, sourceInputSha256: trialDigest(trialJson(request)), mediaRoot: value.directory,
      expected: { roundId: request.roundId, adapterRevision: revision, providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision },
    });
    await writeFile(join(value.directory, 'manifest.json'), trialJson(changed.manifest), { mode: 0o600 });
    const environment = value.environments.get('INPAINT')!;
    const path = environment.AI_IMAGE_SANDBOX_APPROVAL_PATH!;
    const approval = JSON.parse(await readFile(path, 'utf8'));
    approval.maximumCost = request.operations[1]!.maximumCost;
    approval.trialBinding.manifestSha256 = changed.manifestSha256;
    const bytes = trialJson(approval);
    await writeFile(path, bytes, { mode: 0o600 });
    environment.AI_IMAGE_SANDBOX_APPROVAL_SHA256 = trialDigest(bytes);
    await expect(value.run('INPAINT', false, { AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: changed.manifestSha256 }))
      .rejects.toThrow('reviewed digest');
    expect(value.calls).toHaveLength(1);
    expect(await readFile(join(value.directory, 'execution/round.json'))).toEqual(roundBefore);
  }, 90_000);
});
