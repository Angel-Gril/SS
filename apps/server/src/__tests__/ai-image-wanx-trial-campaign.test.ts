import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimAiImageWanxTrialOperation, loadAiImageWanxTrialExecution,
} from '../services/ai-image-wanx-trial-execution.js';
import { prepareAiImageWanxTrial } from '../services/ai-image-wanx-trial-preparation.js';
import { writeAiImageSandboxPrivateEvidenceFile } from '../services/ai-image-sandbox-billing-settlement.js';
import * as privateEvidence from '../services/ai-image-sandbox-billing-settlement.js';
import { inspectAiImageWanxTrialCampaign } from '../services/ai-image-wanx-trial-campaign.js';
import { sanitizeAiImageSandboxGitEnvironment } from '../services/ai-image-sandbox-code-revision.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../services/ai-prompt-templates.js';
import { AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE } from '../services/ai-image-edit-prompt-contract.js';
import type { AiImageSandboxApprovalEvidence } from '../services/ai-image-sandbox-approval.js';
import type { AiImageSandboxMoney } from '../services/ai-image-sandbox-money.js';
import { makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from './fixtures/ai-image-wanx-trial.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const revision = 'a'.repeat(40);
const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(root).startsWith('wanx-campaign-'));
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'wanx-campaign-'));
  roots.push(evidenceRoot);
  return evidenceRoot;
}

async function round(evidenceRoot: string, id: string, options: {
  maximum?: AiImageSandboxMoney; account?: string; credential?: string; fingerprintTag?: string;
} = {}) {
  const roundId = `campaign-round-${id}`;
  const request = await makeWanxTrialInput(evidenceRoot, revision, roundId);
  request.providerAccountUidSha256 = options.account || trialAccountDigest;
  request.credentialRevision = options.credential || trialCredentialRevision;
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), {
    getLegacyPrompt: async () => 'Unused synthetic legacy prompt',
  });
  for (const operation of request.operations) {
    const prompt = `Preserve the synthetic item; background fixture ${options.fingerprintTag || id} ${operation.operation}.`;
    const frozen = await registry.resolveTemplate({ templateKey: operation.frozenPrompt.templateKey,
      renderingProfile: AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE,
      variables: { userPrompt: prompt, userNegativePrompt: 'Keep the synthetic fixture identity.' } });
    operation.frozenPrompt = { prompt, negativePrompt: 'Keep the synthetic fixture identity.',
      resolvedPrompt: frozen.resolvedPrompt, resolvedNegativePrompt: frozen.resolvedNegativePrompt,
      templateKey: operation.frozenPrompt.templateKey, templateReleaseId: frozen.release.id,
      templateChecksum: frozen.checksum, templateSnapshot: frozen.snapshot };
    if (operation.operation === 'FULL_EDIT' && options.maximum) {
      operation.maximumCost = options.maximum;
      operation.quotedCost = { currency: 'CNY', amount: 1, scale: options.maximum.scale };
    }
  }
  const bytes = trialJson(request);
  const requestPath = join(evidenceRoot, `${roundId}.input.json`);
  await writeFile(requestPath, bytes, { mode: 0o600 });
  const expected = { roundId, adapterRevision: revision, providerAccountUidSha256: request.providerAccountUidSha256,
    credentialRevision: request.credentialRevision };
  const prepared = await prepareAiImageWanxTrial({ repositoryRoot, evidenceRoot, expected,
    requestPath, requestSha256: trialDigest(bytes), assertRevision: async () => undefined });
  const executionInput = { repositoryRoot, evidenceRoot, expected, manifestSha256: prepared.manifestSha256, operation: 'FULL_EDIT' };
  const execution = await loadAiImageWanxTrialExecution({ ...executionInput, assertRevision: async () => undefined });
  const approval: AiImageSandboxApprovalEvidence = {
    approvalId: `approve-${roundId}`, approvalSha256: trialDigest(`approval-${roundId}`),
    approvedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    approverRefSha256: trialDigest('synthetic-approver'), providerAccountRefSha256: trialAccountDigest,
    pricingRevisionSha256: trialDigest('synthetic-pricing'), currency: 'CNY',
    preCallBillingSnapshotRefSha256: trialDigest('synthetic-before'), billingReconciliationRefSha256: trialDigest('synthetic-pending'),
  };
  return { execution, executionInput, approval, prepared };
}

async function claim(value: Awaited<ReturnType<typeof round>>) {
  return claimAiImageWanxTrialOperation({ execution: value.execution, approval: value.approval,
    requestFingerprint: value.execution.binding.requestFingerprint, now: () => new Date() });
}

// Reproduce the old writer's closed record format from a real verified preparation.
// These fixtures predate campaign reservations; no arbitrary amount list is imported.
function legacyRecords(value: Awaited<ReturnType<typeof round>>) {
  const { execution, approval } = value;
  const roundRecord = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_BUDGET_V1', roundId: execution.trialBinding.roundId,
    manifestSha256: execution.trialBinding.manifestSha256, evidenceRootSha256: execution.trialBinding.evidenceRootSha256,
    maximumCost: execution.manifest.request.maximumCost, allocatedMaximumCost: execution.manifest.allocatedMaximumCost,
    slots: execution.manifest.request.operations.map(operation => ({ operation: operation.operation,
      operationId: operation.operationId, maximumCost: operation.maximumCost,
      requestFingerprint: execution.manifest.bindings.find(binding => binding.operation === operation.operation)!.requestFingerprint })),
  };
  const roundBytes = trialJson(roundRecord);
  const claimRecord = { schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_OPERATION_CLAIM_V1', state: 'CLAIMED_FAIL_CLOSED',
    roundSha256: trialDigest(roundBytes), operation: execution.selected.operation, operationId: execution.selected.operationId,
    approvalId: approval.approvalId, approvalSha256: approval.approvalSha256,
    requestFingerprint: execution.binding.requestFingerprint, maximumCost: execution.selected.maximumCost,
    createdAt: new Date().toISOString() };
  return { roundRecord, roundBytes, claimRecord };
}

async function legacyClaim(value: Awaited<ReturnType<typeof round>>, outcome = 'SUCCEEDED') {
  const { execution } = value;
  const { roundRecord, roundBytes, claimRecord } = legacyRecords(value);
  const directory = join(execution.directory, 'execution');
  await writeAiImageSandboxPrivateEvidenceFile(join(directory, 'round.json'), roundBytes, execution.evidenceRoot);
  await writeAiImageSandboxPrivateEvidenceFile(join(directory, 'FULL_EDIT.claim.json'), trialJson(claimRecord), execution.evidenceRoot);
  // Status / free-quota observations must never release an authorization ceiling.
  await writeFile(join(execution.evidenceRoot, `${execution.selected.operationId}.observation.json`),
    trialJson({ state: outcome, observedPayable: { currency: 'CNY', amount: 0, scale: 0 } }), { mode: 0o600 });
  return { directory, roundRecord, claimRecord };
}

async function threeLegacy(evidenceRoot: string) {
  const values = [];
  for (const [index, outcome] of ['SUCCEEDED_FREE_QUOTA', 'RECONCILIATION_REQUIRED', 'REJECTED'].entries()) {
    const value = await round(evidenceRoot, `legacy-${index}`);
    const old = await legacyClaim(value, outcome);
    values.push({ value, old });
  }
  return values;
}

async function treeDigests(path: string): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = [];
  for (const name of (await readdir(path)).sort()) {
    const target = join(path, name);
    const metadata = await lstat(target);
    if (metadata.isDirectory()) result.push(...await treeDigests(target));
    else result.push([target, trialDigest(await readFile(target))]);
  }
  return result;
}

describe('Wanx campaign authorization across immutable rounds', () => {
  it.each([['inspect', 0], ['claim', 0], ['inspect', 129]] as const)('allows ordinary wanx-trial-* private files during %s with %s extra notes without counting them as rounds', async (mode, noteCount) => {
    const root = await fixture();
    await threeLegacy(root);
    const files = ['wanx-trial-input.json', 'wanx-trial-preparation-20260913.json',
      ...Array.from({ length: noteCount }, (_, index) => `wanx-trial-private-note-${index}.json`)];
    const bytes = Buffer.from('Synthetic private capture metadata, not an execution directory.\n');
    for (const name of files) await writeFile(join(root, name), bytes, { mode: 0o600 });
    if (mode === 'inspect') {
      const before = await treeDigests(root);
      await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
        .resolves.toMatchObject({ allocatedMaximumCost: { currency: 'CNY', amount: 75, scale: 2 },
          remainingMaximumCost: { currency: 'CNY', amount: 25, scale: 2 }, allocationCount: 3 });
      expect(await treeDigests(root)).toEqual(before);
    } else {
      const accepted = await claim(await round(root, 'ordinary-files-fourth'));
      await accepted.assertCurrent();
      expect(accepted.campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 1, scale: 0 });
    }
    await expect(lstat(join(root, 'wanx-campaign.lock.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const name of files) expect(await readFile(join(root, name))).toEqual(bytes);
  });

  it('observes old allocations without creating a scope, lock or reservation and preserves every old byte', async () => {
    const root = await fixture();
    await threeLegacy(root);
    const before = await treeDigests(root);
    const result = await inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest });
    expect(result).toMatchObject({ observationOnly: true, canSubmit: false, campaignScopeSha256: null,
      maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
      allocatedMaximumCost: { currency: 'CNY', amount: 75, scale: 2 },
      remainingMaximumCost: { currency: 'CNY', amount: 25, scale: 2 },
      allocationCount: 3, legacyClaimCount: 3, reservationCount: 0 });
    expect(await treeDigests(root)).toEqual(before);
    expect((await readdir(root)).some(name => name.startsWith('wanx-campaign'))).toBe(false);
  });

  it('imports three old 0.25 claims, permits the last 0.25 across credential revisions, and refuses any excess before a slot is written', async () => {
    const root = await fixture();
    const old = await threeLegacy(root);
    const original = await Promise.all(old.flatMap(item => ['round.json', 'FULL_EDIT.claim.json'].map(async name => {
      const path = join(item.old.directory, name); return { path, bytes: await readFile(path) };
    })));
    const fourth = await round(root, 'fourth', { credential: 'synthetic-rotated-key-r2' });
    const accepted = await claim(fourth);
    await accepted.assertCurrent();
    const fifth = await round(root, 'fifth');
    await expect(claim(fifth)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED' });
    await expect(lstat(join(fifth.execution.directory, 'execution', 'FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const source of original) expect(await readFile(source.path)).toEqual(source.bytes);
    expect((accepted as any).campaign).toMatchObject({ maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
      allocatedMaximumCost: { currency: 'CNY', amount: 1, scale: 0 }, remainingMaximumCost: { currency: 'CNY', amount: 0, scale: 0 } });
  });

  it('refuses the same paid fingerprint under a new round without allocating it again', async () => {
    const root = await fixture();
    const first = await round(root, 'fingerprint-1', { fingerprintTag: 'same-paid-input' });
    await claim(first);
    const repeat = await round(root, 'fingerprint-2', { fingerprintTag: 'same-paid-input' });
    expect(repeat.execution.binding.requestFingerprint).toBe(first.execution.binding.requestFingerprint);
    await expect(claim(repeat)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_ALREADY_RESERVED' });
    const other = await round(root, 'fingerprint-3');
    const accepted = await claim(other);
    expect((accepted as any).campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 5, scale: 1 });
  });

  it('compares maxima exactly across mixed decimal scales and never releases failed or free legacy claims', async () => {
    const root = await fixture();
    await threeLegacy(root);
    const tooMuch = await round(root, 'precision-over', { maximum: { currency: 'CNY', amount: 25_000_001, scale: 8 } });
    await expect(claim(tooMuch)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED' });
    const exact = await round(root, 'precision-exact', { maximum: { currency: 'CNY', amount: 25_000_000, scale: 8 } });
    const accepted = await claim(exact);
    expect((accepted as any).campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 1, scale: 0 });
  });

  it('binds an account to the physical root and rejects a newly selected account', async () => {
    const root = await fixture();
    await claim(await round(root, 'account-a'));
    const other = await round(root, 'account-b', { account: trialDigest('another-synthetic-account') });
    await expect(claim(other)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH' });
  });

  it.each(['claim amount', 'round amount', 'fingerprint', 'manifest', 'unknown slot'])(
    'rejects corrupted historical %s before allowing another reservation', async change => {
      const root = await fixture();
      const old = await legacyClaim(await round(root, 'corrupt-old'));
      if (change === 'claim amount') old.claimRecord.maximumCost = { currency: 'CNY', amount: 1, scale: 2 };
      if (change === 'fingerprint') old.claimRecord.requestFingerprint = '0'.repeat(64);
      if (change === 'round amount') old.roundRecord.slots[0]!.maximumCost = { currency: 'CNY', amount: 1, scale: 2 };
      if (change === 'manifest') old.roundRecord.manifestSha256 = '0'.repeat(64);
      await writeFile(join(old.directory, 'round.json'), trialJson(old.roundRecord), { mode: 0o600 });
      await writeFile(join(old.directory, 'FULL_EDIT.claim.json'), trialJson(old.claimRecord), { mode: 0o600 });
      if (change === 'unknown slot') await writeFile(join(old.directory, 'HIDDEN.claim.json'), trialJson(old.claimRecord), { mode: 0o600 });
      const next = await round(root, 'after-corrupt');
      await expect(claim(next)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
      await expect(lstat(join(next.execution.directory, 'execution', 'FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('does not charge unrelated ordinary sandbox records but refuses copied legacy scope in a new physical root', async () => {
    const root = await fixture();
    await mkdir(join(root, 'ordinary-sandbox'), { mode: 0o700 });
    await writeFile(join(root, 'ordinary-sandbox', 'report.json'), trialJson({ maximumCost: { currency: 'USD', amount: 99, scale: 0 } }), { mode: 0o600 });
    const old = await legacyClaim(await round(root, 'scope-old'));
    const independent = await fixture();
    const originalRoundDirectory = dirname(old.directory);
    await cp(originalRoundDirectory, join(independent, basename(originalRoundDirectory)), { recursive: true });
    const copied = await round(independent, 'scope-new');
    await expect(claim(copied)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH' });
    const accepted = await claim(await round(root, 'scope-valid'));
    expect((accepted as any).campaign.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 5, scale: 1 });
  });

  it('refuses a linked historical trial directory', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'linked-old'));
    await symlink(dirname(old.directory), join(root, 'wanx-trial-campaign-linked-alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const next = await round(root, 'linked-next');
    await expect(claim(next)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('refuses a junction with the name of an ordinary private capture file', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'linked-capture-old'));
    await symlink(dirname(old.directory), join(root, 'wanx-trial-input.json'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it.each(['regular-file', 'empty-directory'] as const)('does not hide a journaled historical claim by replacing its round with a %s', async replacement => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'journaled-old'));
    const accepted = await claim(await round(root, 'journaled-current'));
    const originalDirectory = dirname(old.directory);
    const archivedDirectory = join(root, 'archived-historical-round');
    for (const path of [originalDirectory, archivedDirectory]) assert.equal(dirname(resolve(path)), resolve(root));
    const ledgerBefore = await treeDigests(join(root, 'wanx-campaign'));
    await rename(originalDirectory, archivedDirectory);
    if (replacement === 'regular-file') await writeFile(originalDirectory, 'Synthetic replacement file\n', { mode: 0o600 });
    else await mkdir(originalDirectory, { mode: 0o700 });
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    await expect(claim(await round(root, 'after-hidden-history'))).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    expect(await treeDigests(join(root, 'wanx-campaign'))).toEqual(ledgerBefore);
  });

  it('rechecks all older claims in the final send assertion', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'assert-old'));
    const accepted = await claim(await round(root, 'assert-new'));
    old.claimRecord.maximumCost = { currency: 'CNY', amount: 1, scale: 2 };
    await writeFile(join(old.directory, 'FULL_EDIT.claim.json'), trialJson(old.claimRecord), { mode: 0o600 });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('keeps the reservation and lock when the operation claim cannot be persisted, without an automatic retry or refund', async () => {
    const root = await fixture();
    const value = await round(root, 'interrupted');
    const originalWriter = privateEvidence.writeAiImageSandboxPrivateEvidenceFile;
    const writer = vi.spyOn(privateEvidence, 'writeAiImageSandboxPrivateEvidenceFile').mockImplementation(async (path, bytes, allowedRoot) => {
      if (path.endsWith(`${process.platform === 'win32' ? '\\' : '/'}FULL_EDIT.claim.json`)) {
        expect((await readdir(join(root, 'wanx-campaign'))).filter(name => name.endsWith('.json'))).toHaveLength(1);
        throw new Error('Synthetic disk failure after campaign reservation');
      }
      return originalWriter(path, bytes, allowedRoot);
    });
    await expect(claim(value)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    writer.mockRestore();
    const entries = (await readdir(join(root, 'wanx-campaign'))).filter(name => name.endsWith('.json'));
    expect(entries).toHaveLength(1);
    const reservation = await readFile(join(root, 'wanx-campaign', entries[0]!));
    expect(JSON.parse(reservation.toString())).toMatchObject({ maximumCost: { currency: 'CNY', amount: 25, scale: 2 }, source: 'RESERVATION' });
    expect((await lstat(join(root, 'wanx-campaign.lock.json'))).isFile()).toBe(true);
    await expect(lstat(join(value.execution.directory, 'execution/FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(claim(await round(root, 'after-interrupted'))).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
    expect(await readFile(join(root, 'wanx-campaign', entries[0]!))).toEqual(reservation);
  });

  it('does not steal an apparently stale lock', async () => {
    const root = await fixture();
    const value = await round(root, 'old-lock');
    const bytes = trialJson({ owner: 'synthetic-exited-process', createdAt: '2000-01-01T00:00:00.000Z' });
    await writeFile(join(root, 'wanx-campaign.lock.json'), bytes, { mode: 0o600 });
    await expect(claim(value)).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
    expect(await readFile(join(root, 'wanx-campaign.lock.json'))).toEqual(bytes);
    expect(await readdir(root)).not.toContain('wanx-campaign');
  });

  it('retains a durable reservation and lock after an actual process exits between reservation and slot persistence', async () => {
    const root = await fixture();
    const value = await round(root, 'process-exit');
    const planned = legacyRecords(value);
    const worker = join(root, 'campaign-exit-worker.mjs');
    const inputPath = join(root, 'campaign-exit-input.json');
    await writeFile(inputPath, trialJson({ repositoryRoot, evidenceRoot: root,
      trialBinding: value.execution.trialBinding, operation: 'FULL_EDIT', operationId: value.execution.selected.operationId,
      approvalId: value.approval.approvalId, approvalSha256: value.approval.approvalSha256,
      roundSha256: trialDigest(planned.roundBytes), claimSha256: trialDigest(trialJson(planned.claimRecord)) }), { mode: 0o600 });
    const ownerUrl = pathToFileURL(join(repositoryRoot, 'apps/server/src/services/ai-image-wanx-trial-campaign.ts')).href;
    await writeFile(worker, [
      "import { readFile } from 'node:fs/promises';",
      `import { reserveAiImageWanxTrialCampaignOperation } from ${JSON.stringify(ownerUrl)};`,
      "globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };",
      "const input = JSON.parse(await readFile(process.argv[2], 'utf8'));",
      "await reserveAiImageWanxTrialCampaignOperation({ ...input, assertCurrent: async () => undefined, now: () => new Date() }, async () => process.exit(23));",
    ].join('\n'), { mode: 0o600 });
    const result = await execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(repositoryRoot, 'apps/server/node_modules/tsx/dist/loader.mjs')).href, worker, inputPath,
    ], { cwd: repositoryRoot, windowsHide: true, timeout: 15_000,
      env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'test', DOTENV_CONFIG_PATH: 'NUL', REDIS_DISABLED: '1' },
    }).catch(error => error);
    expect(result.code).toBe(23);
    const entries = await readdir(join(root, 'wanx-campaign'));
    expect(entries).toHaveLength(1);
    expect((await lstat(join(root, 'wanx-campaign.lock.json'))).isFile()).toBe(true);
    await expect(lstat(join(value.execution.directory, 'execution/FULL_EDIT.claim.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(claim(await round(root, 'after-process-exit'))).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_LOCKED' });
  }, 30_000);

  it('rejects a changed reservation during both observation and the last send check', async () => {
    const root = await fixture();
    const accepted = await claim(await round(root, 'changed-reservation'));
    const [name] = await readdir(join(root, 'wanx-campaign'));
    const path = join(root, 'wanx-campaign', name!);
    const record = JSON.parse(await readFile(path, 'utf8'));
    record.maximumCost.amount = 1;
    await writeFile(path, trialJson(record), { mode: 0o600 });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('rejects replacing the campaign directory even when all copied bytes match', async () => {
    const root = await fixture();
    const accepted = await claim(await round(root, 'replace-directory'));
    const directory = join(root, 'wanx-campaign');
    const archived = join(root, 'saved-campaign');
    for (const path of [directory, archived]) assert.equal(dirname(resolve(path)), resolve(root));
    await rename(directory, archived);
    await cp(archived, directory, { recursive: true });
    await expect(accepted.assertCurrent()).rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH' });
  });

  it('rejects an aliased historical claim with multiple hard links', async () => {
    const root = await fixture();
    const old = await legacyClaim(await round(root, 'hard-link-old'));
    await link(join(old.directory, 'FULL_EDIT.claim.json'), join(root, 'historical-alias.json'));
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
  });

  it('bounds the number of historical round directories before scanning their contents', async () => {
    const root = await fixture();
    for (let index = 0; index < 129; index++) await mkdir(join(root, `wanx-trial-bounded-round-${index}`), { mode: 0o700 });
    await expect(inspectAiImageWanxTrialCampaign({ repositoryRoot, evidenceRoot: root, providerAccountUidSha256: trialAccountDigest }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID' });
    expect((await readdir(root)).some(name => name.startsWith('wanx-campaign'))).toBe(false);
  });

  it('allows only a budget-sized winner when two actual Node processes compete for the final quarter', async () => {
    const root = await fixture();
    await threeLegacy(root);
    const contenders = await Promise.all([round(root, 'process-a'), round(root, 'process-b')]);
    const gate = join(root, 'start-processes');
    const worker = join(root, 'campaign-worker.mjs');
    const executionUrl = pathToFileURL(join(repositoryRoot, 'apps/server/src/services/ai-image-wanx-trial-execution.ts')).href;
    await writeFile(worker, [
      "import { readFile, writeFile, access } from 'node:fs/promises';",
      `import { loadAiImageWanxTrialExecution, claimAiImageWanxTrialOperation } from ${JSON.stringify(executionUrl)};`,
      "globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };",
      "const input = JSON.parse(await readFile(process.argv[2], 'utf8'));",
      "const execution = await loadAiImageWanxTrialExecution({ ...input.executionInput, assertRevision: async () => undefined });",
      "await writeFile(input.ready, 'ready', { mode: 0o600 });",
      "let ready = false; const deadline = Date.now() + 15000; while (!ready && Date.now() < deadline) { try { await access(input.gate); ready = true; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }",
      "if (!ready) throw new Error('BARRIER_TIMEOUT');",
      "try { const result = await claimAiImageWanxTrialOperation({ execution, approval: input.approval, requestFingerprint: execution.binding.requestFingerprint, now: () => new Date() }); await result.assertCurrent(); process.stdout.write(JSON.stringify({ ok: true })); }",
      "catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code })); }",
    ].join('\n'), { mode: 0o600 });
    const readiness = contenders.map((_, index) => join(root, `ready-${index}`));
    const inputs = await Promise.all(contenders.map(async (value, index) => {
      const path = join(root, `worker-${index}.json`);
      await writeFile(path, trialJson({ executionInput: value.executionInput, approval: value.approval, gate, ready: readiness[index] }), { mode: 0o600 });
      return path;
    }));
    const pending = inputs.map(path => execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(repositoryRoot, 'apps/server/node_modules/tsx/dist/loader.mjs')).href, worker, path,
    ], { cwd: repositoryRoot, windowsHide: true, timeout: 30_000,
      env: { ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'test', DOTENV_CONFIG_PATH: 'NUL', REDIS_DISABLED: '1' } }));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if ((await Promise.all(readiness.map(path => lstat(path).then(() => true, () => false)))).every(Boolean)) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    await writeFile(gate, 'go', { mode: 0o600 });
    const results = (await Promise.all(pending)).map(result => JSON.parse(result.stdout));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok).every(result => ['WANX_TRIAL_CAMPAIGN_LOCKED', 'WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED'].includes(result.code))).toBe(true);
    const written = await Promise.all(contenders.map(value => lstat(join(value.execution.directory, 'execution/FULL_EDIT.claim.json')).then(() => true, () => false)));
    expect(written.filter(Boolean)).toHaveLength(1);
  }, 45_000);
});
