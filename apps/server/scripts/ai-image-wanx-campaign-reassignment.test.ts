import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeAiImageSandboxGitEnvironment } from '../src/services/ai-image-sandbox-code-revision.js';
import { loadAiImageWanxTrialExecution } from '../src/services/ai-image-wanx-trial-execution.js';
import { makeWanxReassignmentFixture, wanxReassignmentFileDigests } from '../src/__tests__/fixtures/ai-image-wanx-reassignment.js';
import { trialDigest } from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

const execute = promisify(execFile);
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(serverRoot, '../..');
const approvalEntry = 'apps/server/scripts/ai-image-provider-approval-draft.ts';
const submitEntry = 'apps/server/scripts/ai-image-provider-single-submit.ts';
const syntheticKey = 'synthetic-reassignment-key-must-not-leak';
const poison = 'synthetic-reassignment-dotenv-must-not-load';
const roots: string[] = [];
const links: string[] = [];
let temporaryRoot = '';
let repositoryRoot = '';
let revision = '';

function git(args: string[]) {
  return execute('git', ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment(),
  });
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'wanx-reassignment-cli-'));
  roots.push(temporaryRoot);
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
  const link = async (target: string, name: string) => {
    await mkdir(dirname(name), { recursive: true });
    await symlink(target, name, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(name);
  };
  await link(join(repositoryRoot, 'packages/shared'), join(modules, 'shared'));
  for (const dependency of dependencies) {
    let installed = join(serverRoot, 'node_modules', dependency);
    try { await access(installed); } catch { installed = join(sourceRoot, 'node_modules', dependency); }
    await link(installed, join(modules, dependency));
  }
  await writeFile(join(repositoryRoot, 'package.json'), '{"type":"module"}\n');
  await writeFile(join(repositoryRoot, '.gitignore'), 'node_modules/\n.env\n');
  await writeFile(join(repositoryRoot, '.env'), `DASHSCOPE_API_KEY=${poison}\n`);
  await git(['init']);
  await git(['add', '--', 'package.json', '.gitignore', ...copied]);
  await git(['-c', 'user.name=Reassignment Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'test: bind isolated reassignment execution']);
  revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(temporaryRoot, 'network-guard.mjs'), [
    "import dns from 'node:dns'; import dnsPromises from 'node:dns/promises';",
    "import net from 'node:net'; import tls from 'node:tls'; import http from 'node:http'; import https from 'node:https';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "const deny = () => { throw new Error('REASSIGNMENT_REAL_NETWORK_FORBIDDEN'); };",
    "const lookup = async () => [{ address: '8.8.8.8', family: 4 }];",
    'globalThis.fetch = deny; dns.lookup = deny; dnsPromises.lookup = lookup; dns.promises.lookup = lookup;',
    "for (const name of Object.keys(dnsPromises)) if (name.startsWith('resolve') || name === 'reverse') dnsPromises[name] = deny;",
    "for (const name of Object.keys(dns)) if (name.startsWith('resolve') || name === 'reverse') dns[name] = deny;",
    'net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny; tls.connect = deny;',
    'http.request = deny; http.get = deny; https.request = deny; https.get = deny; syncBuiltinESMExports();',
  ].join('\n'));
  await writeFile(join(temporaryRoot, 'synthetic-runner.mjs'), [
    "import assert from 'node:assert/strict';",
    "import { appendFile, readFile, readdir } from 'node:fs/promises'; import { resolve } from 'node:path';",
    'const { runAiImageProviderSingleSubmit } = await import(process.env.WANX_TEST_ENTRY);',
    'const root = process.env.AI_IMAGE_SANDBOX_EVIDENCE_ROOT; const operation = process.env.AI_IMAGE_SANDBOX_OPERATION;',
    'const expectedAuthorization = `Bearer ${process.env.AI_IMAGE_SANDBOX_API_KEY}`;',
    "const directory = resolve(root, `wanx-trial-${process.env.AI_IMAGE_SANDBOX_TRIAL_ROUND_ID}`);",
    "const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));",
    'const selected = manifest.request.operations.find(item => item.operation === operation);',
    "const taskId = 'synthetic-reassigned-inpaint-task';",
    "const resultUrl = 'https://dashscope-synthetic.oss-cn-beijing.aliyuncs.com/reassigned.png';",
    'const fetcher = async (url, init) => {',
    "  const method = String(init?.method || 'GET').toUpperCase();",
    "  await appendFile(process.env.WANX_TEST_NETWORK_LOG, JSON.stringify({ method, operation, operationId: selected?.operationId ?? null }) + '\\n', { mode: 0o600 });",
    "  if (method === 'POST') {",
    "    assert.equal(operation, 'INPAINT');",
    "    assert.equal(String(url), 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis');",
    "    assert.equal(new Headers(init.headers).get('authorization'), expectedAuthorization);",
    "    const slot = JSON.parse(await readFile(resolve(directory, 'execution/INPAINT.claim.json'), 'utf8'));",
    "    assert.equal(slot.state, 'CLAIMED_FAIL_CLOSED'); assert.equal(slot.operationId, selected.operationId);",
    "    const wire = JSON.parse(await readFile(resolve(root, 'intents/.fingerprints', `${slot.requestFingerprint}.claim.json`), 'utf8'));",
    '    assert.equal(wire.requestFingerprint, slot.requestFingerprint);',
    "    const entries = (await readdir(resolve(root, 'wanx-campaign'))).sort(); assert.equal(entries.length, 6);",
    "    const reservation = JSON.parse(await readFile(resolve(root, 'wanx-campaign', entries[5]), 'utf8'));",
    '    assert.equal(reservation.schemaVersion, 3);',
    '    assert.equal(reservation.campaignAuthorizationSha256, process.env.AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256);',
    '    assert.equal(reservation.campaignReassignmentSha256, process.env.AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256);',
    '    const body = JSON.parse(String(init.body)); assert.equal(body.input.prompt, selected.frozenPrompt.resolvedPrompt);',
    "    assert.equal(body.input.function, 'description_edit_with_mask'); assert.deepEqual(body.parameters, { n: 1 });",
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
    "catch (error) { process.stderr.write(String(error?.code || 'REASSIGNMENT_RUNNER_FAILED')); process.exitCode = 1; }",
  ].join('\n'));
}, 30_000);

afterAll(async () => {
  for (const link of links.splice(0)) {
    assert(!relative(repositoryRoot, link).startsWith('..'));
    assert.equal((await lstat(link)).isSymbolicLink(), true);
    await unlink(link);
  }
  for (const root of roots.splice(0).reverse()) {
    const actual = await realpath(root);
    assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase());
    assert(basename(actual).startsWith('wanx-reassignment-'));
    await rm(actual, { recursive: true, force: true });
  }
});

async function command(entry: string, args: string[], environment: NodeJS.ProcessEnv) {
  const result = await execute(process.execPath, [
    '--import', pathToFileURL(join(temporaryRoot, 'network-guard.mjs')).href,
    '--import', pathToFileURL(join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
    resolve(repositoryRoot, entry), ...args,
  ], { cwd: repositoryRoot, windowsHide: true, timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'sandbox', DOTENV_CONFIG_PATH: 'NUL', ...environment },
  }).then(value => ({ exitCode: 0, stdout: value.stdout, stderr: value.stderr }),
    (error: { code?: unknown; stdout?: string; stderr?: string }) => ({
      exitCode: typeof error.code === 'number' ? error.code : -1, stdout: String(error.stdout || ''), stderr: String(error.stderr || ''),
    }));
  expect(result.stdout + result.stderr).not.toContain(syntheticKey);
  expect(result.stdout + result.stderr).not.toContain(poison);
  return result;
}

function success(result: Awaited<ReturnType<typeof command>>) {
  expect(result, 'The real child must execute the requested command').toMatchObject({ exitCode: 0, stderr: '' });
  return JSON.parse(result.stdout);
}

describe('real CLI reassignment and one isolated INPAINT', () => {
  it('requires both pins, revokes FULL_EDIT, executes one POST, and preserves all five prior allocations', async () => {
    const fixture = await makeWanxReassignmentFixture(repositoryRoot, roots, revision);
    const originalFiles = fixture.originalFiles;
    const manifest = fixture.candidate.prepared.manifest;
    const directory = join(fixture.root, `wanx-trial-${fixture.candidate.expected.roundId}`);
    const common = { AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision, AI_IMAGE_SANDBOX_EVIDENCE_ROOT: fixture.root,
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: fixture.scope.providerAccountUidSha256 };
    const roundEnvironment = { ...common, AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: fixture.candidate.expected.roundId,
      AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: fixture.candidate.prepared.manifestSha256,
      AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: fixture.candidate.expected.credentialRevision };
    const reassignmentEnvironment = { ...roundEnvironment,
      AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256: fixture.grant.authorizationSha256,
      AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_PATH: fixture.input.proposal.path,
      AI_IMAGE_SANDBOX_CAMPAIGN_PROPOSAL_SHA256: fixture.input.proposal.sha256,
      AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_PATH: fixture.input.approval.path,
      AI_IMAGE_SANDBOX_CAMPAIGN_CONSENT_SHA256: fixture.input.approval.sha256 };
    const initial = success(await command(approvalEntry, ['--inspect-wanx-campaign'], common));
    expect(initial).toMatchObject({ allocationCount: 5, allocatedMaximumCost: { currency: 'CNY', amount: 125, scale: 2 }, canSubmit: false });
    const missingOldPin = await command(approvalEntry, ['--reassign-wanx-campaign'], {
      ...reassignmentEnvironment, AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256: '',
    });
    expect(missingOldPin).toMatchObject({ exitCode: 1, stdout: '' });
    await expect(lstat(fixture.reassignmentPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const reassigned = success(await command(approvalEntry, ['--reassign-wanx-campaign'], reassignmentEnvironment));
    expect(reassigned).toMatchObject({ event: 'AI_IMAGE_WANX_CAMPAIGN_REASSIGNED', canSubmit: false, replayed: false });
    const reassignmentBytes = await readFile(fixture.reassignmentPath);
    expect(trialDigest(reassignmentBytes)).toBe(reassigned.reassignmentSha256);
    expect(JSON.parse(reassignmentBytes.toString())).toMatchObject({ canSubmit: false, billingReconciliation: 'REQUIRED' });
    for (const [path, sha256] of originalFiles) expect(trialDigest(await readFile(path))).toBe(sha256);
    const executionEnvironment = { ...roundEnvironment, AI_IMAGE_SANDBOX_OPERATION: 'INPAINT',
      AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256: fixture.grant.authorizationSha256,
      AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256: String(reassigned.reassignmentSha256) };
    const draftEnvironment = { ...executionEnvironment, AI_IMAGE_SANDBOX_APPROVAL_ID: 'approve-reassigned-inpaint-01',
      AI_IMAGE_SANDBOX_APPROVER_REF: 'synthetic-reviewer', AI_IMAGE_SANDBOX_PROVIDER_ACCOUNT_REF: 'synthetic-account',
      AI_IMAGE_SANDBOX_PRICING_REVISION: 'synthetic-price', AI_IMAGE_SANDBOX_PRE_CALL_BILLING_SNAPSHOT_REF: 'synthetic-before',
      AI_IMAGE_SANDBOX_BILLING_RECONCILIATION_REF: 'synthetic-unsettled' };
    for (const name of ['AI_IMAGE_SANDBOX_CAMPAIGN_AUTHORIZATION_SHA256', 'AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256']) {
      const result = await command(approvalEntry, ['--draft-wanx-trial-approval'], { ...draftEnvironment, [name]: '' });
      expect(result).toMatchObject({ exitCode: 1, stdout: '' });
    }
    const drafted = success(await command(approvalEntry, ['--draft-wanx-trial-approval'], draftEnvironment));
    expect(drafted).toMatchObject({ canSubmit: false, operation: 'INPAINT', actualCost: null });
    const draftPath = join(directory, 'approval-drafts', 'approve-reassigned-inpaint-01.json');
    const draftBytes = await readFile(draftPath);
    const draft = JSON.parse(draftBytes.toString());
    expect(draft).toMatchObject({ schemaVersion: 4, requestCount: 1, operation: 'INPAINT',
      maximumCost: { currency: 'CNY', amount: 25, scale: 2 },
      trialBinding: { roundId: fixture.candidate.expected.roundId, manifestSha256: fixture.candidate.prepared.manifestSha256 } });
    expect((await command(submitEntry, ['--verify-wanx-trial-approval'], { ...executionEnvironment,
      AI_IMAGE_SANDBOX_APPROVAL_PATH: draftPath, AI_IMAGE_SANDBOX_APPROVAL_SHA256: trialDigest(draftBytes) })).exitCode).toBe(1);
    const approved = { ...draft, statement: 'I_APPROVE_EXACTLY_ONE_PAID_AI_IMAGE_REQUEST',
      approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    const approval = await fixture.save('reassigned-inpaint-approved.json', approved);
    const approvedEnvironment = { ...executionEnvironment,
      AI_IMAGE_SANDBOX_APPROVAL_PATH: approval.path, AI_IMAGE_SANDBOX_APPROVAL_SHA256: approval.sha256 };
    expect(success(await command(submitEntry, ['--verify-wanx-trial-approval'], approvedEnvironment)))
      .toMatchObject({ schemaVersion: 4, event: 'AI_IMAGE_SANDBOX_APPROVAL_VERIFIED', operation: 'INPAINT', executionScope: 'ISOLATED_WANX_TRIAL' });
    expect(await readFile(draftPath)).toEqual(draftBytes);

    const networkLog = join(fixture.root, 'synthetic-posts.jsonl');
    const outputPath = join(fixture.root, 'synthetic-provider-result.png');
    await writeFile(networkLog, '', { mode: 0o600 });
    const source = manifest.request.operations.find(item => item.operation === 'INPAINT')!.source;
    await writeFile(outputPath, await readFile(join(directory, source.path)), { mode: 0o600 });
    const calls = async () => (await readFile(networkLog, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const posts = async () => (await calls()).filter(call => call.method === 'POST')
      .map(call => ({ operation: call.operation, operationId: call.operationId }));
    const submit = (environment: NodeJS.ProcessEnv) => command(join(temporaryRoot, 'synthetic-runner.mjs'), [], {
      ...environment, AI_IMAGE_SANDBOX_MODE: 'TRIAL_SUBMIT', AI_IMAGE_SANDBOX_API_KEY: syntheticKey,
      AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST', WANX_TEST_ENTRY: pathToFileURL(join(repositoryRoot, submitEntry)).href,
      WANX_TEST_NETWORK_LOG: networkLog, WANX_TEST_OUTPUT_PATH: outputPath,
    });
    expect((await submit({ ...approvedEnvironment, AI_IMAGE_SANDBOX_CAMPAIGN_REASSIGNMENT_SHA256: '' })).exitCode).toBe(1);
    expect((await submit({ ...approvedEnvironment, AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT' })).exitCode).toBe(1);
    // The historical b revision is intentionally synthetic. Check the actual
    // revocation owner separately so a CLI revision mismatch cannot stand in for it.
    await expect(loadAiImageWanxTrialExecution({ ...fixture.scope, expected: fixture.grantedRound.expected,
      manifestSha256: fixture.grantedRound.prepared.manifestSha256, operation: 'FULL_EDIT',
      campaignAuthorizationSha256: fixture.grant.authorizationSha256,
      assertRevision: async () => { expect((await git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(revision); } }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_REASSIGNED_OPERATION_REVOKED' });
    expect((await submit({ ...approvedEnvironment, AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT',
      AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: fixture.grantedRound.expected.roundId,
      AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256: fixture.grantedRound.prepared.manifestSha256 })).exitCode).toBe(1);
    expect(await calls()).toEqual([]);
    expect(await readdir(directory)).not.toContain('execution');

    const report = success(await submit(approvedEnvironment));
    expect(report).toMatchObject({ schemaVersion: 5, state: 'SUCCEEDED', operation: 'INPAINT', createRequests: 1,
      imageCount: 1, actualCost: null, maximumCost: { currency: 'CNY', amount: 25, scale: 2 } });
    expect(await posts()).toEqual([{ operation: 'INPAINT', operationId: report.operationId }]);
    const reportPath = join(fixture.root, `${report.operationId}.report.json`);
    const reportBytes = await readFile(reportPath);
    const persisted = JSON.parse(reportBytes.toString());
    const imagePath = resolve(fixture.root, persisted.imagePath);
    assert(!relative(fixture.root, imagePath).startsWith('..'));
    expect(trialDigest(await readFile(imagePath))).toBe(report.sha256);
    expect((await submit(approvedEnvironment)).exitCode).toBe(1);
    expect((await command(approvalEntry, ['--reassign-wanx-campaign'], reassignmentEnvironment)).exitCode).toBe(1);
    expect(await posts()).toEqual([{ operation: 'INPAINT', operationId: report.operationId }]);
    expect(await readFile(reportPath)).toEqual(reportBytes);
    const final = success(await command(approvalEntry, ['--inspect-wanx-campaign'], common));
    expect(final).toMatchObject({ allocationCount: 6, maximumCost: { currency: 'CNY', amount: 150, scale: 2 },
      allocatedMaximumCost: { currency: 'CNY', amount: 15, scale: 1 }, remainingMaximumCost: { amount: 0 }, canSubmit: false,
      reassignmentSha256: reassigned.reassignmentSha256, revokedOperationId: fixture.oldFull.operationId,
      reassignedOperationId: report.operationId });
    expect(final.history.reservationSha256s.slice(0, 5)).toEqual(initial.history.reservationSha256s);
    expect(await readFile(fixture.reassignmentPath)).toEqual(reassignmentBytes);
    for (const [path, sha256] of originalFiles) expect(trialDigest(await readFile(path))).toBe(sha256);
    for (const full of [fixture.oldFull, manifest.bindings.find(binding => binding.operation === 'FULL_EDIT')!]) {
      await expect(lstat(join(fixture.root, `${full.operationId}.report.json`))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(join(fixture.root, 'intents', `${full.operationId}.intent.json`))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    for (const [path] of await wanxReassignmentFileDigests(fixture.root)) {
      expect((await readFile(path)).includes(Buffer.from(syntheticKey))).toBe(false);
    }
    expect((await git(['status', '--porcelain=v1', '--untracked-files=all'])).stdout).toBe('');
  }, 180_000);
});
