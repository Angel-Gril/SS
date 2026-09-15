import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as campaign from '../services/ai-image-wanx-trial-campaign.js';
import * as privateEvidence from '../services/ai-image-sandbox-billing-settlement.js';
import { loadAiImageWanxTrialExecution } from '../services/ai-image-wanx-trial-execution.js';
import { sanitizeAiImageSandboxGitEnvironment } from '../services/ai-image-sandbox-code-revision.js';
import { makeWanxReassignmentFixture } from './fixtures/ai-image-wanx-reassignment.js';
import { trialDigest } from './fixtures/ai-image-wanx-trial.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const roots: string[] = [];
const execFileAsync = promisify(execFile);
type Fixture = Awaited<ReturnType<typeof makeWanxReassignmentFixture>>;
function authorize() {
  const operation = (campaign as Record<string, any>).authorizeAiImageWanxTrialReassignment;
  expect(typeof operation, 'A separate explicit scope authorization must implement the unused-quarter reassignment').toBe('function');
  return operation as (input: Fixture['input']) => Promise<{ reassignmentPath: string; reassignmentSha256: string; canSubmit: false; replayed: false }>;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(root).startsWith('wanx-reassignment-'));
    await rm(root, { recursive: true, force: true });
  }
});

describe('one unused FULL_EDIT quarter reassigned to one exact INPAINT', () => {
  it('preserves all five allocations and appends only a bound sixth INPAINT within CNY 1.50', async () => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    const approved = await reassign(value.input);
    expect(approved).toMatchObject({ reassignmentPath: value.reassignmentPath, canSubmit: false, replayed: false });
    expect((await readdir(join(value.fifth.directory, 'execution'))).sort()).toEqual(['FULL_EDIT.reassigned.json', 'INPAINT.claim.json', 'round.json']);
    expect((await campaign.inspectAiImageWanxTrialCampaign(value.scope))).toMatchObject({ allocationCount: 5,
      allocatedMaximumCost: { currency: 'CNY', amount: 125, scale: 2 }, maximumCost: { currency: 'CNY', amount: 150, scale: 2 } });
    await expect(value.execution()).rejects.toThrow();
    await expect(value.execution('0'.repeat(64))).rejects.toThrow();
    await expect(value.execution(approved.reassignmentSha256, 'FULL_EDIT')).rejects.toThrow();
    await expect(loadAiImageWanxTrialExecution({ ...value.scope, expected: value.grantedRound.expected,
      manifestSha256: value.grantedRound.prepared.manifestSha256, operation: 'FULL_EDIT',
      campaignAuthorizationSha256: value.grant.authorizationSha256, assertRevision: async () => undefined }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_REASSIGNED_OPERATION_REVOKED' });
    const execution = await value.execution(approved.reassignmentSha256);
    const claimed = await value.claim(execution);
    await claimed.assertCurrent();
    expect(claimed.campaign).toMatchObject({ allocationCount: 6, allocatedMaximumCost: { currency: 'CNY', amount: 15, scale: 1 },
      remainingMaximumCost: { amount: 0 }, maximumCost: { currency: 'CNY', amount: 150, scale: 2 } });
    const ledger = (await readdir(join(value.root, 'wanx-campaign'))).sort();
    expect(ledger).toHaveLength(6);
    expect(JSON.parse(await readFile(join(value.root, 'wanx-campaign', ledger[5]!), 'utf8'))).toMatchObject({
      schemaVersion: 3, kind: 'WANX_TRIAL_CAMPAIGN_RESERVATION_V3', operation: 'INPAINT',
      campaignAuthorizationSha256: value.grant.authorizationSha256, campaignReassignmentSha256: approved.reassignmentSha256,
      maximumCost: { currency: 'CNY', amount: 25, scale: 2 } });
    await expect(value.claim(execution)).rejects.toThrow();
    await expect(reassign(value.input)).rejects.toThrow();
    for (const [path, sha256] of value.originalFiles) expect(trialDigest(await readFile(path))).toBe(sha256);
  }, 30_000);

  it('makes the actual frozen 14b5ade3 reader reject the marker after reading the same five allocations successfully', async () => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    // Exact Git source of 14b5ade34da80edec2b6dd353042a3a1f6835285. Normalize only
    // checkout line endings, then relink imports to this checkout's shared readers.
    // The legacy campaign logic is executed verbatim, including its own allowlist.
    const frozen = (await readFile(new URL('./fixtures/wanx-campaign-reader-14b5ade3.txt', import.meta.url), 'utf8')).replace(/\r\n/gu, '\n');
    expect(trialDigest(frozen)).toBe('5eb14a9c633ebb77721710f3d8fc25f9acce1c63f2a5945f747d66d63794260a');
    const linked = frozen.replace(/from '(\.\/[^']+)\.js'/gu, (_match, specifier: string) =>
      `from '${pathToFileURL(resolve(repositoryRoot, 'apps/server/src/services', `${specifier}.ts`)).href}'`);
    const entry = join(value.root, 'frozen-campaign-reader.ts');
    await writeFile(entry, linked, { mode: 0o600 });
    await mkdir(join(value.root, 'node_modules'), { mode: 0o700 });
    await symlink(join(repositoryRoot, 'apps/server/node_modules/zod'), join(value.root, 'node_modules/zod'), 'junction');
    const script = [
      "import { pathToFileURL } from 'node:url'; import net from 'node:net'; import tls from 'node:tls';",
      "const deny = () => { throw new Error('LEGACY_READER_NETWORK_FORBIDDEN'); }; globalThis.fetch = deny; net.connect = deny; tls.connect = deny;",
      "const { inspectAiImageWanxTrialCampaign } = await import(pathToFileURL(process.argv[1]).href);",
      "try { const result = await inspectAiImageWanxTrialCampaign(JSON.parse(process.argv[2])); process.stdout.write(JSON.stringify({ accepted: true, allocationCount: result.allocationCount })); }",
      "catch (error) { process.stdout.write(JSON.stringify({ accepted: false, code: error.code })); }",
    ].join('\n');
    const legacy = async () => {
      const result = await execFileAsync(process.execPath, ['--import',
        pathToFileURL(join(repositoryRoot, 'apps/server/node_modules/tsx/dist/loader.mjs')).href,
        '--input-type=module', '-e', script, entry, JSON.stringify(value.scope)], {
        cwd: repositoryRoot, windowsHide: true, timeout: 15_000,
        env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'test', DOTENV_CONFIG_PATH: 'NUL', REDIS_DISABLED: '1' },
      }).then(output => ({ code: 0, stdout: output.stdout, stderr: output.stderr }),
        (error: { code?: unknown; stdout?: string; stderr?: string }) => ({
          code: error.code, stdout: String(error.stdout || ''), stderr: String(error.stderr || ''),
        }));
      expect(result, 'The actual legacy module must load before assessing its result').toMatchObject({ code: 0 });
      expect(result.stderr).toBe('');
      return JSON.parse(result.stdout);
    };
    expect(await legacy()).toEqual({ accepted: true, allocationCount: 5 });
    await reassign(value.input);
    expect(await legacy()).toEqual({ accepted: false, code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    expect((await readdir(join(value.root, 'wanx-campaign'))).length).toBe(5);
    for (const [path, sha256] of value.originalFiles) expect(trialDigest(await readFile(path))).toBe(sha256);
  }, 30_000);

  it.each(['statement', 'human approval', 'history', 'grant', 'maximum', 'operation', 'future time', 'report'])(
    'rejects a changed %s without granting or spending the unused quarter', async change => {
      const reassign = authorize();
      const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
      const consent = value.consent as any;
      if (change === 'statement') consent.statement = 'CONTINUE_GENERAL_IMPROVEMENTS';
      if (change === 'human approval') delete consent.humanApprovalSha256;
      if (change === 'history') consent.history.tipSha256 = '0'.repeat(64);
      if (change === 'grant') consent.originalAuthorizationSha256 = '0'.repeat(64);
      if (change === 'maximum') consent.maximumCost.amount = 50;
      if (change === 'operation') consent.execution.operation = 'FULL_EDIT';
      if (change === 'future time') consent.approvedAt = '2099-01-01T00:00:00.000Z';
      if (change === 'report') consent.priorInpaintReportSha256 = '0'.repeat(64);
      value.input.approval = await value.save('reassignment-consent.json', consent);
      await expect(reassign(value.input)).rejects.toThrow();
      await expect(lstat(value.reassignmentPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await campaign.inspectAiImageWanxTrialCampaign(value.scope)).allocationCount).toBe(5);
    }, 20_000);

  it.each(['old consent artifact', 'old human approval'])('rejects reusing the %s as a new human scope approval', async reused => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    const original = JSON.parse(await readFile(value.grant.authorizationPath, 'utf8'));
    value.consent.humanApprovalSha256 = reused === 'old consent artifact'
      ? original.approval.sha256 : original.consent.approverRefSha256;
    value.input.approval = await value.save('reassignment-consent.json', value.consent);
    await expect(reassign(value.input)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_REASSIGNMENT_INVALID' });
    await expect(lstat(value.reassignmentPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it.each(['intent', 'fingerprint', 'claim', 'report', 'unknown partial'])(
    'refuses a pre-existing old FULL_EDIT %s, including incomplete files', async artifact => {
      const reassign = authorize();
      const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
      const paths = { intent: join(value.root, 'intents', `${value.oldFull.operationId}.intent.json`),
        fingerprint: join(value.root, 'intents/.fingerprints', `${value.oldFull.requestFingerprint}.claim.json`),
        claim: join(value.fifth.directory, 'execution/FULL_EDIT.claim.json'),
        report: join(value.root, `${value.oldFull.operationId}.report.json`),
        'unknown partial': join(value.root, `.${value.oldFull.operationId}.report.json.interrupted.tmp`) };
      const path = paths[artifact as keyof typeof paths];
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, '', { mode: 0o600 });
      await expect(reassign(value.input)).rejects.toThrow();
      await expect(lstat(value.reassignmentPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path, 'utf8')).toBe('');
      expect((await readdir(join(value.root, 'wanx-campaign'))).length).toBe(5);
    }, 20_000);

  it('retains a partially written reassignment and never replaces it', async () => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    await writeFile(value.reassignmentPath, '{', { mode: 0o600 });
    await expect(reassign(value.input)).rejects.toThrow();
    expect(await readFile(value.reassignmentPath, 'utf8')).toBe('{');
  }, 20_000);

  it('allows only one authorizer and keeps the original five reservation bytes', async () => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    const results = await Promise.allSettled([reassign(value.input), reassign(value.input)]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    for (const [path, sha256] of value.originalFiles) expect(trialDigest(await readFile(path))).toBe(sha256);
  }, 30_000);

  it('keeps the fault lock after an uncertain durable reassignment write', async () => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    const originalWriter = privateEvidence.writeAiImageSandboxPrivateEvidenceFile;
    vi.spyOn(privateEvidence, 'writeAiImageSandboxPrivateEvidenceFile').mockImplementation(async (path, bytes, root) => {
      await originalWriter(path, bytes, root);
      if (path === value.reassignmentPath) throw new Error('Synthetic write outcome uncertainty');
    });
    await expect(reassign(value.input)).rejects.toThrow();
    expect((await lstat(value.reassignmentPath)).isFile()).toBe(true);
    expect((await lstat(join(value.root, 'wanx-campaign.lock.json'))).isFile()).toBe(true);
    await expect(campaign.inspectAiImageWanxTrialCampaign(value.scope)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
  }, 20_000);

  it('retains the sixth reservation and lock after the new INPAINT claim fails', async () => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    const approved = await reassign(value.input);
    const execution = await value.execution(approved.reassignmentSha256);
    const originalWriter = privateEvidence.writeAiImageSandboxPrivateEvidenceFile;
    vi.spyOn(privateEvidence, 'writeAiImageSandboxPrivateEvidenceFile').mockImplementation(async (path, bytes, root) => {
      if (path === join(execution.directory, 'execution/INPAINT.claim.json')) throw new Error('Synthetic sixth-claim failure');
      return originalWriter(path, bytes, root);
    });
    await expect(value.claim(execution)).rejects.toThrow();
    expect((await readdir(join(value.root, 'wanx-campaign'))).length).toBe(6);
    expect((await lstat(join(value.root, 'wanx-campaign.lock.json'))).isFile()).toBe(true);
    await expect(execution.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
  }, 20_000);

  it.each(['reassignment', 'old FULL_EDIT intent'])('rechecks %s at the last-send assertion without refunding', async changed => {
    const reassign = authorize();
    const value = await makeWanxReassignmentFixture(repositoryRoot, roots);
    const approved = await reassign(value.input);
    const execution = await value.execution(approved.reassignmentSha256);
    const claimed = await value.claim(execution);
    if (changed === 'reassignment') await writeFile(value.reassignmentPath, '{}\n', { mode: 0o600 });
    else await value.save(`intents/${value.oldFull.operationId}.intent.json`, { partial: true });
    await expect(claimed.assertCurrent()).rejects.toThrow();
    expect((await readdir(join(value.root, 'wanx-campaign'))).length).toBe(6);
  }, 30_000);
});
