import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeAiImageSandboxGitEnvironment } from '../src/services/ai-image-sandbox-code-revision.js';
import { prepareAiImageWanxTrial } from '../src/services/ai-image-wanx-trial-preparation.js';
import { claimAiImageWanxTrialOperation, loadAiImageWanxTrialExecution } from '../src/services/ai-image-wanx-trial-execution.js';
import { AiPromptTemplateRegistryService } from '../src/services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../src/services/ai-prompt-templates.js';
import { AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE } from '../src/services/ai-image-edit-prompt-contract.js';
import { makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

const execFileAsync = promisify(execFile);
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(serverRoot, '../..');
const approvalEntry = 'apps/server/scripts/ai-image-provider-approval-draft.ts';
const submitEntry = 'apps/server/scripts/ai-image-provider-single-submit.ts';
const syntheticKey = 'synthetic-campaign-execution-key-never-log';
let temporaryRoot = '';
let repositoryRoot = '';
let originalRevision = '';
let revision = '';

async function git(args: string[]) {
  return execFileAsync('git', ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment(),
  });
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'wanx-campaign-execution-'));
  repositoryRoot = join(temporaryRoot, 'checkout');
  await mkdir(repositoryRoot, { mode: 0o700 });
  const copied = new Set<string>();
  const dependencies = new Set<string>();
  const pending = [approvalEntry, submitEntry, 'apps/server/package.json', 'packages/shared/package.json'];
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
    for (const match of source.matchAll(/['"]((?:apps\/server|packages\/shared)\/[A-Za-z0-9_./-]+\.(?:ts|json))['"]/gu)) pending.push(match[1]!);
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
  await writeFile(join(repositoryRoot, '.env'), 'DASHSCOPE_API_KEY=synthetic-campaign-env-poison\n');
  await git(['init']);
  await git(['add', '--', 'package.json', '.gitignore', ...copied]);
  await git(['-c', 'user.name=Campaign Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test: bind campaign proposal revision']);
  originalRevision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  // Both revisions are real clean commits; no production checkout is changed.
  await git(['-c', 'user.name=Campaign Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'test: bind campaign execution revision']);
  revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(temporaryRoot, 'network-guard.mjs'), [
    "import dns from 'node:dns'; import dnsPromises from 'node:dns/promises';",
    "import net from 'node:net'; import tls from 'node:tls'; import http from 'node:http'; import https from 'node:https';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const deny = () => { throw new Error('CAMPAIGN_REAL_NETWORK_FORBIDDEN'); };",
    "const lookup = async () => [{ address: '8.8.8.8', family: 4 }];",
    'globalThis.fetch = deny; dns.lookup = deny; dnsPromises.lookup = lookup; dns.promises.lookup = lookup;',
    'net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny; tls.connect = deny;',
    'http.request = deny; http.get = deny; https.request = deny; https.get = deny; syncBuiltinESMExports();',
  ].join('\n'));
  await writeFile(join(temporaryRoot, 'synthetic-runner.mjs'), [
    "import assert from 'node:assert/strict';",
    "import { readFile, appendFile } from 'node:fs/promises'; import { resolve } from 'node:path';",
    "const { runAiImageProviderSingleSubmit } = await import(process.env.WANX_TEST_ENTRY);",
    'const root = process.env.AI_IMAGE_SANDBOX_EVIDENCE_ROOT; const operation = process.env.AI_IMAGE_SANDBOX_OPERATION;',
    "const directory = resolve(root, `wanx-trial-${process.env.AI_IMAGE_SANDBOX_TRIAL_ROUND_ID}`);",
    "const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));",
    'const selected = manifest.request.operations.find(item => item.operation === operation);',
    "const taskId = `synthetic-campaign-${operation}`;",
    "const resultUrl = 'https://dashscope-synthetic.oss-cn-beijing.aliyuncs.com/result.png';",
    'const fetcher = async (url, init) => {',
    "  if (init?.method === 'POST') {",
    "    assert.equal(String(url), 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis');",
    "    const slot = JSON.parse(await readFile(resolve(directory, 'execution', `${operation}.claim.json`), 'utf8'));",
    "    assert.equal(slot.state, 'CLAIMED_FAIL_CLOSED'); assert.equal(slot.operationId, selected.operationId);",
    "    const wire = JSON.parse(await readFile(resolve(root, 'intents/.fingerprints', `${slot.requestFingerprint}.claim.json`), 'utf8'));",
    '    assert.equal(wire.requestFingerprint, slot.requestFingerprint);',
    '    const body = JSON.parse(String(init.body)); assert.equal(body.input.prompt, selected.frozenPrompt.resolvedPrompt);',
    '    assert.equal(body.parameters.n, 1);',
    "    await appendFile(process.env.WANX_TEST_NETWORK_LOG, JSON.stringify({ operation, operationId: selected.operationId }) + '\\n', { mode: 0o600 });",
    "    return new Response(JSON.stringify({ output: { task_id: taskId, task_status: 'PENDING' } }), { status: 200 });",
    '  }',
    "  if (String(url) === `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`) return new Response(JSON.stringify({",
    "    output: { task_id: taskId, task_status: 'SUCCEEDED', results: [{ url: resultUrl }], task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } },",
    '    usage: { image_count: 1 },',
    '  }), { status: 200 });',
    "  assert.equal(String(url), resultUrl); assert.equal(new Headers(init?.headers).has('authorization'), false);",
    "  return new Response(new Uint8Array(await readFile(process.env.WANX_TEST_OUTPUT_PATH)), { status: 200, headers: { 'content-type': 'image/png' } });",
    '};',
    "try { await runAiImageProviderSingleSubmit({ requireGitCheckout: true, fetch: fetcher, resolveDns: async () => [{ address: '8.8.8.8' }] }); }",
    "catch (error) { process.stderr.write(String(error?.code || 'CAMPAIGN_RUNNER_FAILED')); process.exitCode = 1; }",
  ].join('\n'));
}, 30_000);

afterAll(async () => {
  if (!temporaryRoot) return;
  const target = resolve(temporaryRoot);
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert(basename(target).startsWith('wanx-campaign-execution-'));
  await rm(target, { recursive: true, force: true });
});

async function command(entry: string, args: string[], environment: NodeJS.ProcessEnv) {
  const result = await execFileAsync(process.execPath, [
    '--import', pathToFileURL(join(temporaryRoot, 'network-guard.mjs')).href,
    '--import', pathToFileURL(join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
    resolve(repositoryRoot, entry), ...args,
  ], {
    cwd: repositoryRoot, windowsHide: true, timeout: 45_000,
    env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'sandbox', DOTENV_CONFIG_PATH: 'NUL', ...environment },
  }).then(value => ({ exitCode: 0, stdout: value.stdout, stderr: value.stderr }),
    (error: { code?: unknown; stdout?: string; stderr?: string }) => ({
      exitCode: typeof error.code === 'number' ? error.code : -1, stdout: String(error.stdout || ''), stderr: String(error.stderr || ''),
    }));
  expect(result.stdout + result.stderr).not.toContain(syntheticKey);
  expect(result.stdout + result.stderr).not.toContain('synthetic-campaign-env-poison');
  return result;
}

function success(result: Awaited<ReturnType<typeof command>>) {
  expect(result, 'The real child process must complete its intended command').toMatchObject({ exitCode: 0, stderr: '' });
  return JSON.parse(result.stdout);
}

async function snapshotFiles(path: string): Promise<Array<[string, string]>> {
  if (!(await lstat(path)).isDirectory()) return [[path, trialDigest(await readFile(path))]];
  const files: Array<[string, string]> = [];
  for (const name of (await readdir(path)).sort()) files.push(...await snapshotFiles(join(path, name)));
  return files;
}

async function prepareHistoricalRound(evidenceRoot: string, roundId: string) {
  const request = await makeWanxTrialInput(evidenceRoot, originalRevision, roundId);
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), {
    getLegacyPrompt: async () => 'Unused synthetic legacy prompt',
  });
  for (const operation of request.operations) {
    const prompt = `Preserve the synthetic item; background fixture ${roundId} ${operation.operation}.`;
    const negativePrompt = 'Keep the synthetic fixture identity.';
    const frozen = await registry.resolveTemplate({ templateKey: operation.frozenPrompt.templateKey,
      renderingProfile: AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE, variables: { userPrompt: prompt, userNegativePrompt: negativePrompt } });
    operation.frozenPrompt = { prompt, negativePrompt, resolvedPrompt: frozen.resolvedPrompt,
      resolvedNegativePrompt: frozen.resolvedNegativePrompt, templateKey: operation.frozenPrompt.templateKey,
      templateReleaseId: frozen.release.id, templateChecksum: frozen.checksum, templateSnapshot: frozen.snapshot };
  }
  const bytes = trialJson(request);
  const requestPath = join(evidenceRoot, `${roundId}.input.json`);
  await writeFile(requestPath, bytes, { mode: 0o600 });
  const expected = { roundId, adapterRevision: originalRevision,
    providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision };
  const prepared = await prepareAiImageWanxTrial({ repositoryRoot, evidenceRoot, requestPath,
    requestSha256: trialDigest(bytes), expected, assertRevision: async () => undefined });
  return { prepared, expected };
}

describe('approved Wanx campaign through real command processes', () => {
  it('preserves four old allocations and spends only the two new quarters after an actual INPAINT report passes review', async () => {
    const evidenceRoot = join(temporaryRoot, 'private-evidence');
    await mkdir(evidenceRoot, { mode: 0o700 });
    const save = async (name: string, value: unknown) => {
      const path = join(evidenceRoot, name); const bytes = trialJson(value);
      await writeFile(path, bytes, { mode: 0o600 });
      return { path, sha256: trialDigest(bytes) };
    };
    // Construct the historical physical records through their real owner. The new
    // authorization, draft, verification and sends below all enforce the clean checkout.
    for (let index = 0; index < 4; index++) {
      const old = await prepareHistoricalRound(evidenceRoot, `campaign-old-${index}`);
      const execution = await loadAiImageWanxTrialExecution({ repositoryRoot, evidenceRoot, expected: old.expected,
        manifestSha256: old.prepared.manifestSha256, operation: 'FULL_EDIT', assertRevision: async () => undefined });
      await claimAiImageWanxTrialOperation({ execution, requestFingerprint: execution.binding.requestFingerprint,
        approval: { approvalId: `approve-campaign-old-${index}`, approvalSha256: trialDigest(`old-approval-${index}`),
          approvedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          approverRefSha256: trialDigest('synthetic-approver'), providerAccountRefSha256: trialAccountDigest,
          pricingRevisionSha256: trialDigest('synthetic-price'), currency: 'CNY',
          preCallBillingSnapshotRefSha256: trialDigest('synthetic-before'), billingReconciliationRefSha256: trialDigest('synthetic-unsettled') },
        now: () => new Date() });
    }
    const original = await prepareHistoricalRound(evidenceRoot, 'campaign-visual-proposal');
    const prior = original.prepared.manifest;
    const originalFiles = await snapshotFiles(evidenceRoot);
    const request = structuredClone(prior.request);
    request.roundId = `${prior.request.roundId}-exec`;
    request.adapterRevision = revision;
    for (const operation of request.operations) {
      operation.operationId = `${request.roundId}-${operation.operation.toLowerCase()}`;
      operation.source.path = `wanx-trial-${prior.request.roundId}/${operation.source.path}`;
      if (operation.mask) operation.mask.path = `wanx-trial-${prior.request.roundId}/${operation.mask.path}`;
    }
    expect(revision).not.toBe(originalRevision);
    expect((await git(['status', '--porcelain=v1'])).stdout).toBe('');
    const common = { AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision, AI_IMAGE_SANDBOX_EVIDENCE_ROOT: evidenceRoot,
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest };
    const roundEnvironment = { ...common, AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: request.roundId,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision };
    const input = await save('execution-input.json', request);
    const preparation = success(await command(approvalEntry, ['--prepare-wanx-trial'], { ...roundEnvironment,
      AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: input.path, AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: input.sha256 }));
    const directory = join(evidenceRoot, `wanx-trial-${request.roundId}`);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as typeof prior;
    const observed = success(await command(approvalEntry, ['--inspect-wanx-campaign'], common));
    expect(observed).toMatchObject({ allocationCount: 4, maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
      allocatedMaximumCost: { currency: 'CNY', amount: 1, scale: 0 }, remainingMaximumCost: { amount: 0 }, canSubmit: false });
    const proposal = await save('proposal.json', {
      kind: 'WANX_VISUAL_RETEST_INPUT_PROPOSAL', status: 'INPUTS_PREPARED_NOT_AUTHORIZED',
      roundId: prior.request.roundId, inputPreparationRevision: originalRevision,
      requiresFreshFrozenExecutionRevision: true, requiresBudgetExtensionImplementation: true, requiresNewBudgetAuthorization: true,
      historicalAllocatedMaximumCost: { currency: 'CNY', amount: 1, scale: 0 },
      proposedAdditionalMaximumCost: { currency: 'CNY', amount: 50, scale: 2 },
      proposedCumulativeMaximumCost: { currency: 'CNY', amount: 150, scale: 2 }, maximumNewRequests: 2,
      sequence: 'INPAINT_FIRST_STOP_IF_QUALITY_FAILS_THEN_FULL_EDIT', canSubmit: false,
      draftSha256: trialDigest('synthetic-proposal-draft'), inputSha256: prior.sourceInputSha256, manifestSha256: original.prepared.manifestSha256,
      operations: prior.request.operations.map(operation => ({ operationId: operation.operationId, operation: operation.operation,
        sourceSha256: operation.source.sha256, maskSha256: operation.mask?.sha256 ?? null, quotedCost: operation.quotedCost,
        maximumCost: operation.maximumCost, prompt: operation.frozenPrompt.prompt, negativePrompt: operation.frozenPrompt.negativePrompt,
        renderedCharacters: Array.from(operation.frozenPrompt.resolvedPrompt).length,
        resolvedPromptSha256: trialDigest(operation.frozenPrompt.resolvedPrompt),
        renderingProfile: (operation.frozenPrompt.templateSnapshot as { renderingContract?: { profile?: string } }).renderingContract?.profile })),
      verifiedCanSubmit: false, realProviderRequests: 0,
    });
    const consent = await save('consent.json', { schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_BUDGET_CONSENT_V1',
      statement: 'I_APPROVE_EXACT_WANX_VISUAL_RETEST_ADDITIONAL_CNY_0_50', approvedAt: new Date(Date.now() - 120_000).toISOString(),
      approverRefSha256: trialDigest('synthetic-user-approval'), proposalSha256: proposal.sha256, history: observed.history,
      execution: { roundId: request.roundId, adapterRevision: revision, providerAccountUidSha256: trialAccountDigest,
        credentialRevision: trialCredentialRevision, manifestSha256: preparation.manifestSha256,
        operations: manifest.bindings.map(binding => ({ operation: binding.operation,
          approvedOperationId: prior.request.operations.find(operation => operation.operation === binding.operation)!.operationId,
          operationId: binding.operationId, requestFingerprint: binding.requestFingerprint })) },
      additionalMaximumCost: { currency: 'CNY', amount: 50, scale: 2 }, cumulativeMaximumCost: { currency: 'CNY', amount: 150, scale: 2 },
      sequence: 'INPAINT_FIRST_STOP_IF_QUALITY_FAILS_THEN_FULL_EDIT',
    });
    const authorized = success(await command(approvalEntry, ['--authorize-wanx-campaign'], { ...roundEnvironment,
      AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: preparation.manifestSha256,
      AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_PATH: proposal.path, AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_SHA256: proposal.sha256,
      AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_PATH: consent.path, AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_SHA256: consent.sha256 }));
    expect(authorized).toMatchObject({ event: 'AI_IMAGE_WANX_CAMPAIGN_AUTHORIZED', canSubmit: false, replayed: false });
    const authorizationPath = join(evidenceRoot, 'wanx-campaign.authorization.json');
    const authorizationBytes = await readFile(authorizationPath);
    expect(trialDigest(authorizationBytes)).toBe(authorized.authorizationSha256);
    expect(JSON.parse(authorizationBytes.toString())).toMatchObject({ schemaVersion: 1, canSubmit: false, billingReconciliation: 'REQUIRED' });
    const executionEnvironment = { ...roundEnvironment, AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: preparation.manifestSha256,
      AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256: authorized.authorizationSha256 };
    const notAnApproval = await command(submitEntry, ['--verify-wanx-trial-approval'], { ...executionEnvironment,
      AI_IMAGE_SANDBOX_OPERATION: 'INPAINT', AI_IMAGE_SANDBOX_APPROVAL_PATH: authorizationPath,
      AI_IMAGE_SANDBOX_APPROVAL_SHA256: authorized.authorizationSha256 });
    expect(notAnApproval.exitCode).toBe(1);
    expect(notAnApproval.stderr).toContain('SANDBOX_APPROVAL_SCHEMA_INVALID');

    const networkLog = join(evidenceRoot, 'synthetic-posts.jsonl');
    await writeFile(networkLog, '', { mode: 0o600 });
    const posts = async () => (await readFile(networkLog, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const outputPath = join(evidenceRoot, 'synthetic-provider-result.png');
    const sourcePath = join(directory, manifest.request.operations.find(operation => operation.operation === 'INPAINT')!.source.path);
    const patch = await sharp({ create: { width: 160, height: 160, channels: 4, background: '#c5d9e8' } }).png().toBuffer();
    await writeFile(outputPath, await sharp(sourcePath).composite([{ input: patch, left: 0, top: 0 }]).png().toBuffer(), { mode: 0o600 });
    const submit = (environment: NodeJS.ProcessEnv) => command(join(temporaryRoot, 'synthetic-runner.mjs'), [], {
      ...environment, AI_IMAGE_SANDBOX_MODE: 'TRIAL_SUBMIT', AI_IMAGE_SANDBOX_API_KEY: syntheticKey,
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST', WANX_TEST_ENTRY: pathToFileURL(join(repositoryRoot, submitEntry)).href,
      WANX_TEST_NETWORK_LOG: networkLog, WANX_TEST_OUTPUT_PATH: outputPath,
    });
    const approveDraft = async (operation: 'FULL_EDIT' | 'INPAINT', quality: NodeJS.ProcessEnv = {}) => {
      const approvalId = `approve-${request.roundId}-${operation.toLowerCase()}`;
      const environment = { ...executionEnvironment, ...quality, AI_IMAGE_SANDBOX_OPERATION: operation };
      const drafted = success(await command(approvalEntry, ['--draft-wanx-trial-approval'], { ...environment,
        AI_IMAGE_SANDBOX_APPROVAL_ID: approvalId, AI_IMAGE_SANDBOX_APPROVER_REF: 'synthetic-reviewer',
        AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF: 'synthetic-account', AI_IMAGE_SANDBOX_PRICING_REVISION: 'synthetic-price',
        AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF: 'synthetic-before', AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF: 'synthetic-unsettled' }));
      expect(drafted).toMatchObject({ canSubmit: false, operation, actualCost: null });
      const draftPath = join(directory, 'approval-drafts', `${approvalId}.json`);
      const bytes = await readFile(draftPath);
      const draft = JSON.parse(bytes.toString());
      expect(draft).toMatchObject({ schemaVersion: 4, requestCount: 1, operation, maximumCost: { currency: 'CNY', amount: 25, scale: 2 },
        trialBinding: { roundId: request.roundId, manifestSha256: preparation.manifestSha256 } });
      expect(draft.statement).not.toBe('I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST');
      const unapproved = await command(submitEntry, ['--verify-wanx-trial-approval'], { ...environment,
        AI_IMAGE_SANDBOX_APPROVAL_PATH: draftPath, AI_IMAGE_SANDBOX_APPROVAL_SHA256: trialDigest(bytes) });
      expect(unapproved.exitCode).toBe(1);
      expect(unapproved.stderr).toContain('SANDBOX_APPROVAL_SCHEMA_INVALID');
      const approval = await save(`${operation}.approval.json`, { ...draft, statement: 'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST',
        approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
      const approvedEnvironment = { ...environment, AI_IMAGE_SANDBOX_APPROVAL_PATH: approval.path, AI_IMAGE_SANDBOX_APPROVAL_SHA256: approval.sha256 };
      expect(success(await command(submitEntry, ['--verify-wanx-trial-approval'], approvedEnvironment)))
        .toMatchObject({ schemaVersion: 4, event: 'AI_IMAGE_SANDBOX_APPROVAL_VERIFIED', operation, executionScope: 'ISOLATED_WANX_TRIAL' });
      expect(await readFile(draftPath)).toEqual(bytes);
      return approvedEnvironment;
    };
    const inpaintEnvironment = await approveDraft('INPAINT');
    const prematureFull = await submit({ ...inpaintEnvironment, AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT' });
    expect(prematureFull.exitCode).toBe(1);
    expect(prematureFull.stderr).toContain('WANX_TRIAL_CAMPAIGN_QUALITY_REQUIRED');
    expect(await posts()).toEqual([]);
    expect(await readdir(directory)).not.toContain('execution');
    expect(await readdir(evidenceRoot)).not.toContain('intents');

    const inpaintReport = success(await submit(inpaintEnvironment));
    expect(inpaintReport).toMatchObject({ schemaVersion: 5, state: 'SUCCEEDED', operation: 'INPAINT', actualCost: null, imageCount: 1 });
    expect((await posts()).map(post => post.operation)).toEqual(['INPAINT']);
    expect((await submit(inpaintEnvironment)).exitCode).toBe(1);
    expect((await posts()).map(post => post.operation)).toEqual(['INPAINT']);
    const reportBytes = await readFile(join(evidenceRoot, `${inpaintReport.operationId}.report.json`));
    const persistedReport = JSON.parse(reportBytes.toString());
    const imagePath = resolve(evidenceRoot, persistedReport.imagePath);
    assert(!relative(evidenceRoot, imagePath).startsWith('..'));
    const imageBytes = await readFile(imagePath);
    expect(trialDigest(imageBytes)).toBe(persistedReport.sha256);
    const before = await sharp(sourcePath).ensureAlpha().raw().toBuffer();
    const after = await sharp(imageBytes).ensureAlpha().raw().toBuffer();
    expect(Array.from(after.subarray(0, 4))).toEqual([197, 217, 232, 255]);
    for (let row = 0; row < 1024; row++) {
      const offset = (row * 1024 + (row < 160 ? 160 : 0)) * 4;
      expect(after.subarray(offset, (row + 1) * 1024 * 4)).toEqual(before.subarray(offset, (row + 1) * 1024 * 4));
    }
    const binding = manifest.bindings.find(item => item.operation === 'INPAINT')!;
    const quality = await save('quality-pass.json', { schemaVersion: 1, kind: 'WANX_TRIAL_INPAINT_QUALITY_APPROVAL_V1',
      statement: 'I_CONFIRM_THIS_INPAINT_PASSES_BEFORE_FULL_EDIT', authorizationSha256: authorized.authorizationSha256,
      inpaintOperationId: inpaintReport.operationId, inpaintRequestFingerprint: binding.requestFingerprint,
      reportSha256: trialDigest(reportBytes), imageSha256: trialDigest(imageBytes), reviewerRefSha256: trialDigest('synthetic-quality-reviewer'),
      reviewedAt: new Date().toISOString(), decision: 'PASS',
      checks: { targetColor: true, boundary: true, productIdentity: true, outsideMaskPixelsUnchanged: true } });
    const fullEnvironment = await approveDraft('FULL_EDIT', { AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_PATH: quality.path,
      AI_IMAGE_SANDBOX_INPAINT_QUALITY_APPROVAL_SHA256: quality.sha256 });
    expect(success(await submit(fullEnvironment))).toMatchObject({ schemaVersion: 5, operation: 'FULL_EDIT', state: 'SUCCEEDED', actualCost: null });
    expect((await posts()).map(post => post.operation)).toEqual(['INPAINT', 'FULL_EDIT']);
    const final = success(await command(approvalEntry, ['--inspect-wanx-campaign'], common));
    expect(final).toMatchObject({ allocationCount: 6, maximumCost: { currency: 'CNY', amount: 150, scale: 2 },
      allocatedMaximumCost: { currency: 'CNY', amount: 15, scale: 1 }, remainingMaximumCost: { amount: 0 }, canSubmit: false });
    expect(final.history.reservationSha256s.slice(0, 4)).toEqual(observed.history.reservationSha256s);
    expect(await readFile(authorizationPath)).toEqual(authorizationBytes);
    for (const [path, sha256] of originalFiles) expect(trialDigest(await readFile(path))).toBe(sha256);
    expect((await git(['status', '--porcelain=v1'])).stdout).toBe('');
  }, 180_000);
});
