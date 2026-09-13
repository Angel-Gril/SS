import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { AiImageSandboxTrialBinding } from './ai-image-sandbox-approval.js';
import {
  readAiImageSandboxPrivateBillingEvidence,
  resolveAiImageSandboxPrivateEvidenceRoot,
  writeAiImageSandboxPrivateEvidenceFile,
} from './ai-image-sandbox-billing-settlement.js';
import {
  aiImageSandboxPowerOfTen, parseAiImageSandboxMoney, type AiImageSandboxMoney,
} from './ai-image-sandbox-money.js';
import { AiImageWanxTrialError, verifyAiImageWanxTrial } from './ai-image-wanx-trial-preparation.js';

const DIRECTORY = 'wanx-campaign';
const SCOPE_FILE = 'wanx-campaign.scope.json';
const LOCK_FILE = 'wanx-campaign.lock.json';
const MAX_ROOT_ENTRIES = 4096;
const MAX_ROUNDS = 128;
const MAX_RESERVATIONS = 256;
const MAX_RECORD_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const CEILING: AiImageSandboxMoney = { currency: 'CNY', amount: 1, scale: 0 };
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/u);
const roundIdentifier = identifier.max(64);
const operationSchema = z.enum(['FULL_EDIT', 'INPAINT']);
const timestamp = z.string().datetime().refine(value => new Date(value).toISOString() === value);
const claimSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_EDIT_TRIAL_OPERATION_CLAIM_V1'),
  state: z.literal('CLAIMED_FAIL_CLOSED'), roundSha256: sha,
  operation: operationSchema, operationId: identifier, approvalId: identifier,
  approvalSha256: sha, requestFingerprint: sha, maximumCost: z.unknown(), createdAt: timestamp,
}).strict();
const scopeSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_TRIAL_CAMPAIGN_SCOPE_V1'),
  evidenceRootSha256: sha, providerAccountUidSha256: sha,
  campaignDirectorySha256: sha, maximumCost: z.unknown(),
}).strict();
const reservationSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_TRIAL_CAMPAIGN_RESERVATION_V1'),
  sequence: z.number().int().min(1).max(MAX_RESERVATIONS), previousSha256: sha.nullable(),
  campaignScopeSha256: sha, source: z.enum(['LEGACY_CLAIM', 'RESERVATION']),
  roundId: roundIdentifier, manifestSha256: sha, roundSha256: sha, claimSha256: sha,
  operation: operationSchema, operationId: identifier, requestFingerprint: sha,
  maximumCost: z.unknown(), approvalId: identifier, approvalSha256: sha, reservedAt: timestamp,
}).strict();

interface ScopeInput {
  repositoryRoot: string;
  evidenceRoot: string;
  providerAccountUidSha256: string;
  evidenceRootSha256?: string;
}

interface RootScope {
  repositoryRoot: string;
  path: string;
  evidenceRootSha256: string;
  providerAccountUidSha256: string;
}

interface Allocation {
  roundId: string;
  manifestSha256: string;
  roundSha256: string;
  claimSha256: string;
  operation: 'FULL_EDIT' | 'INPAINT';
  operationId: string;
  requestFingerprint: string;
  maximumCost: AiImageSandboxMoney;
  approvalId: string;
  approvalSha256: string;
}

function invalid(code = 'WANX_TRIAL_CAMPAIGN_HISTORY_INVALID'): never {
  throw new AiImageWanxTrialError(code, code === 'WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED'
    ? 'The cumulative Wanx authorization would exceed CNY 1; existing reservations are not refunded'
    : code === 'WANX_TRIAL_CAMPAIGN_LOCKED'
      ? 'The campaign is already locked; inspect interrupted work instead of replacing the lock'
      : 'The Wanx campaign evidence does not match its physical root, account or immutable history');
}

function preserveCampaignError(error: unknown): never {
  if (error instanceof AiImageWanxTrialError && error.code.startsWith('WANX_TRIAL_CAMPAIGN_')) throw error;
  invalid();
}

function samePath(left: string, right: string) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function within(root: string, path: string) {
  const relation = relative(root, path);
  return !isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`);
}

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error: any) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function directoryIdentity(path: string, schema: string) {
  const metadata = await lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.dev <= 0n || metadata.ino <= 0n
    || !samePath(await realpath(path), path)
    || (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n)) invalid();
  return digest(JSON.stringify({ schema,
    path: process.platform === 'win32' ? path.toLowerCase() : path,
    device: metadata.dev.toString(), inode: metadata.ino.toString(), birthtimeNs: metadata.birthtimeNs.toString(),
  }));
}

async function rootScope(input: ScopeInput): Promise<RootScope> {
  if (!sha.safeParse(input.providerAccountUidSha256).success) invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
  const path = await resolveAiImageSandboxPrivateEvidenceRoot(input.repositoryRoot, input.evidenceRoot);
  if (!samePath(resolve(input.repositoryRoot, input.evidenceRoot), path)) invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
  const evidenceRootSha256 = await directoryIdentity(path, 'ai-image-sandbox-evidence-root/v1');
  if (input.evidenceRootSha256 !== undefined && input.evidenceRootSha256 !== evidenceRootSha256) invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
  return { repositoryRoot: input.repositoryRoot, path, evidenceRootSha256, providerAccountUidSha256: input.providerAccountUidSha256 };
}

async function assertRoot(scope: RootScope) {
  if (await directoryIdentity(scope.path, 'ai-image-sandbox-evidence-root/v1') !== scope.evidenceRootSha256) {
    invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
  }
}

async function assertPrivateParents(scope: RootScope, path: string) {
  if (!within(scope.path, path) || samePath(scope.path, path)) invalid();
  let parent = dirname(path);
  while (within(scope.path, parent)) {
    await directoryIdentity(parent, 'wanx-campaign-private-directory/v1');
    if (samePath(parent, scope.path)) break;
    parent = dirname(parent);
  }
  await assertRoot(scope);
}

// Bootstrap a digest through one bounded, descriptor-checked read, then reuse
// the canonical private JSON reader. Discovery never grants authenticity.
async function readRecord(scope: RootScope, path: string, maxBytes: number, expectedSha256?: string) {
  await assertPrivateParents(scope, path);
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maxBytes)
    || before.dev <= 0n || before.ino <= 0n || !samePath(await realpath(path), path)
    || (process.platform !== 'win32' && (before.mode & 0o077n) !== 0n)) invalid();
  const handle = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
  let bytes: Buffer;
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1n || !opened.isFile()) invalid();
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (size !== Number(before.size) || size > maxBytes || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || after.nlink !== 1n) invalid();
    bytes = buffer.subarray(0, size);
  } finally { await handle.close(); }
  const result = await readAiImageSandboxPrivateBillingEvidence({
    repositoryRoot: scope.repositoryRoot, evidenceRoot: scope.path, path, sha256: expectedSha256 || digest(bytes),
  });
  const after = await lstat(path, { bigint: true });
  if (!result.bytes.equals(bytes) || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1n) invalid();
  await assertPrivateParents(scope, path);
  return result;
}

async function names(path: string, limit: number) {
  const output: string[] = [];
  for await (const entry of await opendir(path)) {
    output.push(entry.name);
    if (output.length > limit) invalid();
  }
  return output.sort();
}

function money(value: unknown): AiImageSandboxMoney {
  const parsed = parseAiImageSandboxMoney(value, 'Campaign maximum');
  if (parsed.currency !== 'CNY' || BigInt(parsed.amount) > aiImageSandboxPowerOfTen(parsed.scale)) invalid();
  return parsed;
}

function allocationPart(value: Allocation) {
  return { roundId: value.roundId, manifestSha256: value.manifestSha256,
    roundSha256: value.roundSha256, claimSha256: value.claimSha256,
    operation: value.operation, operationId: value.operationId, requestFingerprint: value.requestFingerprint,
    maximumCost: value.maximumCost, approvalId: value.approvalId, approvalSha256: value.approvalSha256 };
}

async function verifiedRound(scope: RootScope, roundId: string, manifestSha256: string) {
  const path = resolve(scope.path, `wanx-trial-${roundId}`, 'manifest.json');
  const stored = await readRecord(scope, path, MAX_MANIFEST_BYTES, manifestSha256);
  const request = z.object({ roundId: roundIdentifier,
    adapterRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
    providerAccountUidSha256: sha, credentialRevision: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  }).passthrough().parse(stored.record.request);
  if (request.providerAccountUidSha256 !== scope.providerAccountUidSha256) invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
  if (request.roundId !== roundId) invalid();
  const verified = await verifyAiImageWanxTrial({ repositoryRoot: scope.repositoryRoot, evidenceRoot: scope.path,
    manifestSha256, expected: request, assertRevision: () => assertRoot(scope) });
  const manifest = verified.manifest;
  const roundRecord = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_BUDGET_V1', roundId, manifestSha256,
    evidenceRootSha256: scope.evidenceRootSha256,
    maximumCost: manifest.request.maximumCost, allocatedMaximumCost: manifest.allocatedMaximumCost,
    slots: manifest.request.operations.map(operation => ({ operation: operation.operation,
      operationId: operation.operationId, maximumCost: operation.maximumCost,
      requestFingerprint: manifest.bindings.find(binding => binding.operation === operation.operation)!.requestFingerprint })),
  };
  return { manifest, roundRecord };
}

async function historicalClaims(scope: RootScope) {
  const allocations = new Map<string, Allocation>();
  const directories: string[] = [];
  for (const name of await names(scope.path, MAX_ROOT_ENTRIES)) {
    if (!/^wanx-trial-/iu.test(name)) continue;
    const metadata = await lstat(resolve(scope.path, name));
    // Older private input / preparation files share this prefix. Only real
    // directories are rounds; links must not disappear through that filter.
    if (metadata.isSymbolicLink()) invalid();
    if (metadata.isFile()) continue;
    if (!metadata.isDirectory()) invalid();
    directories.push(name);
    if (directories.length > MAX_ROUNDS) invalid();
  }
  for (const directoryName of directories) {
    if (!directoryName.startsWith('wanx-trial-')) invalid();
    const roundId = roundIdentifier.parse(directoryName.slice('wanx-trial-'.length));
    const directory = resolve(scope.path, directoryName);
    await directoryIdentity(directory, 'wanx-campaign-private-directory/v1');
    const execution = resolve(directory, 'execution');
    if (!await exists(execution)) continue;
    await directoryIdentity(execution, 'wanx-campaign-private-directory/v1');
    const entries = await names(execution, 3);
    if (!entries.includes('round.json') || entries.some(name => !['round.json', 'FULL_EDIT.claim.json', 'INPAINT.claim.json'].includes(name))) invalid();
    const storedRound = await readRecord(scope, resolve(execution, 'round.json'), MAX_RECORD_BYTES);
    if (storedRound.record.evidenceRootSha256 !== scope.evidenceRootSha256) invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
    const manifestSha256 = sha.parse(storedRound.record.manifestSha256);
    const verified = await verifiedRound(scope, roundId, manifestSha256);
    if (!isDeepStrictEqual(storedRound.record, verified.roundRecord)) invalid();
    for (const operation of ['FULL_EDIT', 'INPAINT'] as const) {
      const name = `${operation}.claim.json`;
      if (!entries.includes(name)) continue;
      const storedClaim = await readRecord(scope, resolve(execution, name), MAX_RECORD_BYTES);
      const claim = claimSchema.parse(storedClaim.record);
      const slot = verified.roundRecord.slots.find(item => item.operation === operation)!;
      if (claim.roundSha256 !== storedRound.sha256 || claim.operation !== operation || claim.operationId !== slot.operationId
        || claim.requestFingerprint !== slot.requestFingerprint || !isDeepStrictEqual(money(claim.maximumCost), slot.maximumCost)) invalid();
      if (allocations.has(claim.requestFingerprint)) invalid();
      allocations.set(claim.requestFingerprint, { roundId, manifestSha256, roundSha256: storedRound.sha256,
        claimSha256: storedClaim.sha256, operation, operationId: claim.operationId,
        requestFingerprint: claim.requestFingerprint, maximumCost: money(claim.maximumCost),
        approvalId: claim.approvalId, approvalSha256: claim.approvalSha256 });
      if (allocations.size > MAX_RESERVATIONS) invalid();
    }
  }
  await assertRoot(scope);
  return allocations;
}

async function campaignScope(scope: RootScope) {
  const directory = resolve(scope.path, DIRECTORY);
  const path = resolve(scope.path, SCOPE_FILE);
  if (!await exists(path)) {
    if (await exists(directory)) {
      await directoryIdentity(directory, 'wanx-trial-campaign-directory/v1');
      if ((await names(directory, MAX_RESERVATIONS)).length) invalid();
    }
    return null;
  }
  const stored = await readRecord(scope, path, MAX_RECORD_BYTES);
  const record = scopeSchema.parse(stored.record);
  if (record.evidenceRootSha256 !== scope.evidenceRootSha256 || record.providerAccountUidSha256 !== scope.providerAccountUidSha256
    || record.campaignDirectorySha256 !== await directoryIdentity(directory, 'wanx-trial-campaign-directory/v1')) {
    invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
  }
  if (!isDeepStrictEqual(record.maximumCost, CEILING)) invalid();
  return { record, sha256: stored.sha256 };
}

async function reservations(scope: RootScope, scopeSha256: string | null) {
  const output: Array<{ record: z.infer<typeof reservationSchema> & { maximumCost: AiImageSandboxMoney }; sha256: string }> = [];
  if (!scopeSha256) return output;
  for (const name of await names(resolve(scope.path, DIRECTORY), MAX_RESERVATIONS)) {
    const match = /^r([0-9]{6})-([a-f0-9]{64})\.json$/u.exec(name);
    if (!match || Number(match[1]) !== output.length + 1) invalid();
    const stored = await readRecord(scope, resolve(scope.path, DIRECTORY, name), MAX_RECORD_BYTES, match[2]);
    const record = reservationSchema.parse(stored.record);
    if (record.sequence !== output.length + 1 || record.previousSha256 !== (output.at(-1)?.sha256 || null)
      || record.campaignScopeSha256 !== scopeSha256) invalid();
    output.push({ record: { ...record, maximumCost: money(record.maximumCost) }, sha256: stored.sha256 });
  }
  return output;
}

function total(allocations: Iterable<Allocation>) {
  let amount = 0n;
  for (const allocation of allocations) {
    const value = money(allocation.maximumCost);
    amount += BigInt(value.amount) * aiImageSandboxPowerOfTen(8 - value.scale);
  }
  const decimal = (value: bigint): AiImageSandboxMoney => {
    let scale = 8;
    while (scale > 0 && value % 10n === 0n) { value /= 10n; scale--; }
    return { currency: 'CNY', amount: Number(value), scale };
  };
  return { overLimit: amount > 100_000_000n, allocatedMaximumCost: decimal(amount),
    remainingMaximumCost: decimal(amount > 100_000_000n ? 0n : 100_000_000n - amount) };
}

async function snapshot(scope: RootScope, options: { lockSha256?: string } = {}) {
  await assertRoot(scope);
  if (options.lockSha256) await readRecord(scope, resolve(scope.path, LOCK_FILE), MAX_RECORD_BYTES, options.lockSha256);
  else if (await exists(resolve(scope.path, LOCK_FILE))) invalid('WANX_TRIAL_CAMPAIGN_LOCKED');
  const storedScope = await campaignScope(scope);
  const historical = await historicalClaims(scope);
  const entries = await reservations(scope, storedScope?.sha256 || null);
  const seen = new Set<string>();
  for (const entry of entries) {
    const allocation = historical.get(entry.record.requestFingerprint);
    if (!allocation || seen.has(entry.record.requestFingerprint)
      || !isDeepStrictEqual(allocationPart(entry.record), allocationPart(allocation))) invalid();
    seen.add(entry.record.requestFingerprint);
  }
  const totals = total(historical.values());
  if (totals.overLimit) invalid('WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED');
  await assertRoot(scope);
  return { storedScope, historical, entries, ...totals };
}

function summary(scope: RootScope, state: Awaited<ReturnType<typeof snapshot>>) {
  const newReservations = state.entries.filter(entry => entry.record.source === 'RESERVATION').length;
  return { maximumCost: { ...CEILING }, allocatedMaximumCost: state.allocatedMaximumCost,
    remainingMaximumCost: state.remainingMaximumCost, allocationCount: state.historical.size,
    legacyClaimCount: state.historical.size - newReservations, reservationCount: newReservations,
    evidenceRootSha256: scope.evidenceRootSha256, providerAccountUidSha256: scope.providerAccountUidSha256,
    campaignScopeSha256: state.storedScope?.sha256 || null };
}

/** Read-only point-in-time observation. A later claim must reacquire the lock and recalculate. */
export async function inspectAiImageWanxTrialCampaign(input: ScopeInput) {
  try {
    const scope = await rootScope(input);
    const state = await snapshot(scope);
    return { schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_OBSERVATION_V1', observationOnly: true,
      canSubmit: false, ...summary(scope, state), observedAt: new Date().toISOString() };
  } catch (error) { preserveCampaignError(error); }
}

export async function reserveAiImageWanxTrialCampaignOperation<T>(input: {
  repositoryRoot: string;
  evidenceRoot: string;
  trialBinding: Readonly<AiImageSandboxTrialBinding>;
  operation: 'FULL_EDIT' | 'INPAINT';
  operationId: string;
  approvalId: string;
  approvalSha256: string;
  roundSha256: string;
  claimSha256: string;
  now: () => Date;
  assertCurrent: () => Promise<void>;
}, persistClaims: () => Promise<T>) {
  let release = false;
  let ownedLock: { scope: RootScope; sha256: string } | null = null;
  try {
    const scope = await rootScope({ ...input, providerAccountUidSha256: input.trialBinding.providerAccountUidSha256,
      evidenceRootSha256: input.trialBinding.evidenceRootSha256 });
    const roundId = roundIdentifier.parse(input.trialBinding.roundId);
    const operation = operationSchema.parse(input.operation);
    const manifestSha256 = sha.parse(input.trialBinding.manifestSha256);
    const operationId = identifier.parse(input.operationId);
    const approvalId = identifier.parse(input.approvalId);
    const approvalSha256 = sha.parse(input.approvalSha256);
    const roundSha256 = sha.parse(input.roundSha256);
    const claimSha256 = sha.parse(input.claimSha256);
    const verified = await verifiedRound(scope, roundId, manifestSha256);
    const slot = verified.roundRecord.slots.find(value => value.operation === operation)!;
    const binding = verified.manifest.bindings.find(value => value.operation === operation)!;
    if (slot.operationId !== operationId || binding.requestFingerprint !== input.trialBinding.requestFingerprint
      || binding.frozenPromptSha256 !== input.trialBinding.frozenPromptSha256
      || digest(jsonBytes(verified.roundRecord)) !== roundSha256) invalid();
    await assertRoot(scope);
    const lockBytes = jsonBytes({ schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_LOCK_V1',
      owner: randomUUID(), createdAt: input.now().toISOString(), evidenceRootSha256: scope.evidenceRootSha256 });
    const lockSha256 = digest(lockBytes);
    try { await writeAiImageSandboxPrivateEvidenceFile(resolve(scope.path, LOCK_FILE), lockBytes, scope.path); }
    catch (error: any) { if (error?.code === 'EEXIST') invalid('WANX_TRIAL_CAMPAIGN_LOCKED'); throw error; }
    ownedLock = { scope, sha256: lockSha256 };
    let state = await snapshot(scope, { lockSha256 });
    if (!state.storedScope) {
      const directory = resolve(scope.path, DIRECTORY);
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error: any) { if (error?.code !== 'EEXIST') throw error; }
      const record = { schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_SCOPE_V1',
        evidenceRootSha256: scope.evidenceRootSha256, providerAccountUidSha256: scope.providerAccountUidSha256,
        campaignDirectorySha256: await directoryIdentity(directory, 'wanx-trial-campaign-directory/v1'), maximumCost: CEILING };
      const bytes = jsonBytes(record);
      await writeAiImageSandboxPrivateEvidenceFile(resolve(scope.path, SCOPE_FILE), bytes, scope.path);
      state = { ...state, storedScope: { record: scopeSchema.parse(record), sha256: digest(bytes) } };
    }
    const campaignScopeSha256 = state.storedScope?.sha256;
    if (!campaignScopeSha256) invalid();
    const append = async (allocation: Allocation, source: 'LEGACY_CLAIM' | 'RESERVATION') => {
      if (state.entries.length >= MAX_RESERVATIONS) invalid();
      const record = { schemaVersion: 1 as const, kind: 'WANX_TRIAL_CAMPAIGN_RESERVATION_V1' as const,
        sequence: state.entries.length + 1, previousSha256: state.entries.at(-1)?.sha256 || null,
        campaignScopeSha256, source, ...allocationPart(allocation), reservedAt: input.now().toISOString() };
      const bytes = jsonBytes(record);
      const sha256 = digest(bytes);
      const name = `r${String(record.sequence).padStart(6, '0')}-${sha256}.json`;
      await writeAiImageSandboxPrivateEvidenceFile(resolve(scope.path, DIRECTORY, name), bytes, scope.path);
      state.entries.push({ record, sha256 });
      return sha256;
    };
    const imported = new Set(state.entries.map(entry => entry.record.requestFingerprint));
    for (const allocation of state.historical.values()) {
      if (!imported.has(allocation.requestFingerprint)) await append(allocation, 'LEGACY_CLAIM');
    }
    if (state.historical.has(binding.requestFingerprint)) {
      release = true;
      invalid('WANX_TRIAL_CAMPAIGN_ALREADY_RESERVED');
    }
    const allocation: Allocation = { roundId, manifestSha256, roundSha256, claimSha256,
      operation, operationId, requestFingerprint: binding.requestFingerprint,
      maximumCost: money(slot.maximumCost), approvalId, approvalSha256 };
    if (total([...state.historical.values(), allocation]).overLimit) {
      release = true;
      invalid('WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED');
    }
    await input.assertCurrent();
    const reservationSha256 = await append(allocation, 'RESERVATION');
    // The reservation is durable before the old slot exists. A failed callback
    // leaves both this entry and the non-reclaimable lock for explicit review.
    const value = await persistClaims();
    const final = await snapshot(scope, { lockSha256 });
    if (!final.entries.some(entry => entry.sha256 === reservationSha256)) invalid();
    await assertRoot(scope);
    const assertCurrent = async () => {
      try {
        // The execution owner retains its original code / approval checks;
        // this check independently revalidates the whole campaign ledger.
        const current = await snapshot(scope);
        if (current.storedScope?.sha256 !== campaignScopeSha256 || !current.entries.some(entry => entry.sha256 === reservationSha256)) invalid();
      } catch (error) { preserveCampaignError(error); }
    };
    release = true;
    return { value, campaignScopeSha256, reservationSha256,
      campaign: { ...summary(scope, final), reservationSha256 }, assertCurrent };
  } catch (error) { preserveCampaignError(error); }
  finally {
    if (ownedLock && release) {
      await readRecord(ownedLock.scope, resolve(ownedLock.scope.path, LOCK_FILE), MAX_RECORD_BYTES, ownedLock.sha256);
      await assertRoot(ownedLock.scope);
      await unlink(resolve(ownedLock.scope.path, LOCK_FILE));
    }
  }
}
