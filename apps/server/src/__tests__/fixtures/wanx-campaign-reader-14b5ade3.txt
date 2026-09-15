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
import type { AiImageWanxTrialExpected } from './ai-image-wanx-trial-preparation.js';
import {
  WANX_ADDITIONAL_AUTHORIZATION_FILE, WANX_AUTHORIZED_CUMULATIVE_MAXIMUM,
  wanxCampaignArtifactSchema, wanxCampaignAuthorizationSchema, wanxCampaignConsentSchema,
  wanxInpaintQualitySchema, validateWanxCampaignConsentTime, validateWanxCampaignProposal,
  type WanxCampaignArtifact, type WanxCampaignHistory,
} from './ai-image-wanx-campaign-authorization.js';

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
const originalReservationSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('WANX_TRIAL_CAMPAIGN_RESERVATION_V1'),
  sequence: z.number().int().min(1).max(MAX_RESERVATIONS), previousSha256: sha.nullable(),
  campaignScopeSha256: sha, source: z.enum(['LEGACY_CLAIM', 'RESERVATION']),
  roundId: roundIdentifier, manifestSha256: sha, roundSha256: sha, claimSha256: sha,
  operation: operationSchema, operationId: identifier, requestFingerprint: sha,
  maximumCost: z.unknown(), approvalId: identifier, approvalSha256: sha, reservedAt: timestamp,
}).strict();
const reservationSchema = z.union([originalReservationSchema, originalReservationSchema.extend({
  schemaVersion: z.literal(2), kind: z.literal('WANX_TRIAL_CAMPAIGN_RESERVATION_V2'), campaignAuthorizationSha256: sha,
}).strict()]);
type Reservation = { record: z.infer<typeof reservationSchema> & { maximumCost: AiImageSandboxMoney }; sha256: string };

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
async function readStableBytes(scope: RootScope, path: string, maxBytes: number) {
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
  const after = await lstat(path, { bigint: true });
  if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1n
    || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) invalid();
  await assertPrivateParents(scope, path);
  return { bytes, before };
}

async function readRecord(scope: RootScope, path: string, maxBytes: number, expectedSha256?: string) {
  const { bytes, before } = await readStableBytes(scope, path, maxBytes);
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
  const output: Reservation[] = [];
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

function total(allocations: Iterable<Allocation>, limit = 100_000_000n) {
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
  return { overLimit: amount > limit, allocatedMaximumCost: decimal(amount),
    remainingMaximumCost: decimal(amount > limit ? 0n : limit - amount) };
}

function historyBinding(scope: RootScope, scopeSha256: string | null, entries: Reservation[], allocations: Allocation[]): WanxCampaignHistory {
  return { evidenceRootSha256: scope.evidenceRootSha256, campaignScopeSha256: scopeSha256,
    reservationSha256s: entries.map(entry => entry.sha256), tipSha256: entries.at(-1)?.sha256 || null,
    allocationsSha256: digest(jsonBytes(allocations.map(allocationPart).sort((left, right) => left.requestFingerprint.localeCompare(right.requestFingerprint)))) };
}

function isQuarterMaximum(value: AiImageSandboxMoney) {
  return value.currency === 'CNY' && BigInt(value.amount) * aiImageSandboxPowerOfTen(8 - value.scale) === 25_000_000n;
}

async function artifact(scope: RootScope, input: WanxCampaignArtifact) {
  const ref = wanxCampaignArtifactSchema.parse(input);
  const path = resolve(scope.path, ref.path);
  const stored = await readRecord(scope, path, MAX_MANIFEST_BYTES, ref.sha256);
  return { ...stored, ref: { path: relative(scope.path, path).split(sep).join('/'), sha256: stored.sha256 } };
}

async function readAuthorization(scope: RootScope, scopeSha256: string | null, entries: Reservation[], historical: Map<string, Allocation>) {
  const path = resolve(scope.path, WANX_ADDITIONAL_AUTHORIZATION_FILE);
  if (!await exists(path)) {
    if (entries.some(entry => entry.record.schemaVersion !== 1)) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_REQUIRED');
    return null;
  }
  const stored = await readRecord(scope, path, MAX_RECORD_BYTES);
  const record = wanxCampaignAuthorizationSchema.parse(stored.record);
  const { consent } = record;
  validateWanxCampaignConsentTime(consent, new Date());
  const prefix = entries.slice(0, 4);
  if (!scopeSha256 || entries.length < 4 || historical.size !== entries.length
    || prefix.some(entry => entry.record.schemaVersion !== 1 || !isQuarterMaximum(entry.record.maximumCost))
    || !isDeepStrictEqual(total(prefix.map(entry => entry.record)).allocatedMaximumCost, CEILING)
    || !isDeepStrictEqual(consent.history, historyBinding(scope, scopeSha256, prefix, prefix.map(entry => historical.get(entry.record.requestFingerprint)!)))) {
    invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_HISTORY_MISMATCH');
  }
  const proposal = await artifact(scope, record.proposal);
  const approval = await artifact(scope, record.approval);
  if (proposal.sha256 !== consent.proposalSha256 || !isDeepStrictEqual(approval.record, consent)) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_INVALID');
  const original = await verifiedRound(scope, roundIdentifier.parse(proposal.record.roundId), sha.parse(proposal.record.manifestSha256));
  const candidate = await verifiedRound(scope, consent.execution.roundId, consent.execution.manifestSha256);
  validateWanxCampaignProposal(proposal.record, original.manifest, candidate.manifest, consent.execution.manifestSha256, consent);
  const previousApprovals = new Set<string>();
  for (const entry of prefix) { previousApprovals.add(entry.record.approvalId); previousApprovals.add(entry.record.approvalSha256); }
  for (const [index, entry] of entries.slice(4).entries()) {
    const expectedOperation = index === 0 ? 'INPAINT' : index === 1 ? 'FULL_EDIT' : null;
    const operation = consent.execution.operations.find(operation => operation.operation === expectedOperation);
    if (!operation || entry.record.schemaVersion !== 2 || entry.record.campaignAuthorizationSha256 !== stored.sha256
      || entry.record.source !== 'RESERVATION' || entry.record.operation !== expectedOperation
      || entry.record.roundId !== consent.execution.roundId || entry.record.manifestSha256 !== consent.execution.manifestSha256
      || entry.record.operationId !== operation.operationId || entry.record.requestFingerprint !== operation.requestFingerprint
      || !isDeepStrictEqual(entry.record.maximumCost, { currency: 'CNY', amount: 25, scale: 2 })
      || previousApprovals.has(entry.record.approvalId) || previousApprovals.has(entry.record.approvalSha256)) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_INVALID');
    previousApprovals.add(entry.record.approvalId); previousApprovals.add(entry.record.approvalSha256);
  }
  return { record, sha256: stored.sha256, manifest: candidate.manifest };
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
  const authorization = await readAuthorization(scope, storedScope?.sha256 || null, entries, historical);
  const totals = total(historical.values(), authorization ? 150_000_000n : 100_000_000n);
  if (totals.overLimit) invalid('WANX_TRIAL_CAMPAIGN_LIMIT_EXCEEDED');
  await assertRoot(scope);
  return { storedScope, historical, entries, authorization, ...totals };
}

function summary(scope: RootScope, state: Awaited<ReturnType<typeof snapshot>>) {
  const newReservations = state.entries.filter(entry => entry.record.source === 'RESERVATION').length;
  return { maximumCost: { ...(state.authorization ? WANX_AUTHORIZED_CUMULATIVE_MAXIMUM : CEILING) }, allocatedMaximumCost: state.allocatedMaximumCost,
    remainingMaximumCost: state.remainingMaximumCost, allocationCount: state.historical.size,
    legacyClaimCount: state.historical.size - newReservations, reservationCount: newReservations,
    evidenceRootSha256: scope.evidenceRootSha256, providerAccountUidSha256: scope.providerAccountUidSha256,
    campaignScopeSha256: state.storedScope?.sha256 || null,
    ...(state.authorization ? { authorizationSha256: state.authorization.sha256,
      authorizedRoundId: state.authorization.record.consent.execution.roundId, originalMaximumCost: { ...CEILING } } : {}) };
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

export async function inspectAiImageWanxTrialCampaignHistory(input: ScopeInput) {
  try {
    const scope = await rootScope(input);
    const state = await snapshot(scope);
    return { schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_HISTORY_V1', observationOnly: true, canSubmit: false,
      ...summary(scope, state), history: historyBinding(scope, state.storedScope?.sha256 || null, state.entries, [...state.historical.values()]) };
  } catch (error) { preserveCampaignError(error); }
}

export async function authorizeAiImageWanxTrialCampaign(input: ScopeInput & {
  expected: AiImageWanxTrialExpected; manifestSha256: string;
  proposal: WanxCampaignArtifact; approval: WanxCampaignArtifact; history: WanxCampaignHistory;
  assertRevision: () => Promise<void>; now?: () => Date;
}) {
  let lock: { scope: RootScope; sha256: string } | null = null;
  let release = true;
  try {
    await input.assertRevision();
    const scope = await rootScope(input);
    if (scope.providerAccountUidSha256 !== input.expected.providerAccountUidSha256) invalid('WANX_TRIAL_CAMPAIGN_SCOPE_MISMATCH');
    const authorizationPath = resolve(scope.path, WANX_ADDITIONAL_AUTHORIZATION_FILE);
    if (await exists(authorizationPath)) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_EXISTS');
    const lockBytes = jsonBytes({ schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_LOCK_V1',
      owner: randomUUID(), createdAt: (input.now?.() || new Date()).toISOString(), evidenceRootSha256: scope.evidenceRootSha256 });
    try { await writeAiImageSandboxPrivateEvidenceFile(resolve(scope.path, LOCK_FILE), lockBytes, scope.path); }
    catch (error: any) { if (error?.code === 'EEXIST') invalid('WANX_TRIAL_CAMPAIGN_LOCKED'); throw error; }
    lock = { scope, sha256: digest(lockBytes) };
    const state = await snapshot(scope, { lockSha256: lock.sha256 });
    const history = historyBinding(scope, state.storedScope?.sha256 || null, state.entries, [...state.historical.values()]);
    if (state.authorization || !state.storedScope || state.entries.length !== 4 || state.historical.size !== 4
      || state.entries.some(entry => !isQuarterMaximum(entry.record.maximumCost))
      || !isDeepStrictEqual(state.allocatedMaximumCost, CEILING) || !isDeepStrictEqual(history, input.history)) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_HISTORY_MISMATCH');
    const proposal = await artifact(scope, input.proposal);
    const approval = await artifact(scope, input.approval);
    const consent = wanxCampaignConsentSchema.parse(approval.record);
    validateWanxCampaignConsentTime(consent, input.now?.() || new Date());
    if (consent.proposalSha256 !== proposal.sha256 || !isDeepStrictEqual(consent.history, history)
      || consent.execution.roundId !== input.expected.roundId || consent.execution.adapterRevision !== input.expected.adapterRevision
      || consent.execution.credentialRevision !== input.expected.credentialRevision
      || consent.execution.providerAccountUidSha256 !== input.expected.providerAccountUidSha256
      || consent.execution.manifestSha256 !== input.manifestSha256) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_INVALID');
    const original = await verifiedRound(scope, roundIdentifier.parse(proposal.record.roundId), sha.parse(proposal.record.manifestSha256));
    const candidate = await verifiedRound(scope, consent.execution.roundId, consent.execution.manifestSha256);
    validateWanxCampaignProposal(proposal.record, original.manifest, candidate.manifest, consent.execution.manifestSha256, consent);
    if (candidate.manifest.bindings.some(binding => state.historical.has(binding.requestFingerprint)
      || [...state.historical.values()].some(item => item.operationId === binding.operationId))) invalid('WANX_TRIAL_CAMPAIGN_ALREADY_RESERVED');
    await input.assertRevision();
    await assertRoot(scope);
    const record = wanxCampaignAuthorizationSchema.parse({ schemaVersion: 1, kind: 'WANX_TRIAL_CAMPAIGN_AUTHORIZATION_V1',
      canSubmit: false, billingReconciliation: 'REQUIRED', proposal: proposal.ref, approval: approval.ref, consent });
    const bytes = jsonBytes(record);
    release = false;
    await writeAiImageSandboxPrivateEvidenceFile(authorizationPath, bytes, scope.path);
    await snapshot(scope, { lockSha256: lock.sha256 });
    await input.assertRevision();
    release = true;
    return { authorizationPath, authorizationSha256: digest(bytes), replayed: false, canSubmit: false };
  } catch (error) { preserveCampaignError(error); }
  finally {
    if (lock && release) {
      await readRecord(lock.scope, resolve(lock.scope.path, LOCK_FILE), MAX_RECORD_BYTES, lock.sha256);
      await assertRoot(lock.scope);
      await unlink(resolve(lock.scope.path, LOCK_FILE));
    }
  }
}

interface AuthorizationExecutionInput {
  roundId: string; manifestSha256: string; operation: 'FULL_EDIT' | 'INPAINT';
  campaignAuthorizationSha256?: string; inpaintQualityApproval?: WanxCampaignArtifact;
}

async function assertAuthorizedExecution(scope: RootScope, state: Awaited<ReturnType<typeof snapshot>>, input: AuthorizationExecutionInput) {
  const authorization = state.authorization;
  if (!authorization) {
    if (input.campaignAuthorizationSha256 || input.inpaintQualityApproval) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_REQUIRED');
    return;
  }
  const consent = authorization.record.consent;
  if (input.roundId !== consent.execution.roundId) {
    if (input.campaignAuthorizationSha256 || input.inpaintQualityApproval
      || ![...state.historical.values()].some(item => item.roundId === input.roundId)) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_SCOPE_MISMATCH');
    return;
  }
  if (input.campaignAuthorizationSha256 !== authorization.sha256) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_REQUIRED');
  if (input.manifestSha256 !== consent.execution.manifestSha256) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_SCOPE_MISMATCH');
  if (input.operation === 'INPAINT') {
    if (input.inpaintQualityApproval) invalid('WANX_TRIAL_CAMPAIGN_QUALITY_INVALID');
    return;
  }
  if (!input.inpaintQualityApproval) invalid('WANX_TRIAL_CAMPAIGN_QUALITY_REQUIRED');
  const approved = wanxInpaintQualitySchema.parse((await artifact(scope, input.inpaintQualityApproval)).record);
  const inpaint = consent.execution.operations.find(item => item.operation === 'INPAINT')!;
  const allocated = state.historical.get(inpaint.requestFingerprint);
  if (!allocated || allocated.operationId !== inpaint.operationId || approved.authorizationSha256 !== authorization.sha256
    || approved.inpaintOperationId !== inpaint.operationId || approved.inpaintRequestFingerprint !== inpaint.requestFingerprint) invalid('WANX_TRIAL_CAMPAIGN_QUALITY_INVALID');
  const report = (await readRecord(scope, resolve(scope.path, `${inpaint.operationId}.report.json`), MAX_MANIFEST_BYTES, approved.reportSha256)).record;
  const operation = authorization.manifest.request.operations.find(item => item.operation === 'INPAINT')!;
  const binding = authorization.manifest.bindings.find(item => item.operation === 'INPAINT')!;
  const approval = report.approvalEvidence as Record<string, unknown> | undefined;
  const completedAt = timestamp.parse(report.completedAt);
  if (report.schemaVersion !== 5 || report.state !== 'SUCCEEDED' || report.actualCost !== null
    || report.operationId !== inpaint.operationId || report.operation !== 'INPAINT'
    || report.provider !== 'dashscope-wanx21-image-edit' || report.model !== authorization.manifest.request.model
    || report.adapterRevision !== consent.execution.adapterRevision || report.credentialRevision !== consent.execution.credentialRevision
    || report.requestProfile !== binding.requestProfile || report.promptSha256 !== binding.promptSha256
    || !isDeepStrictEqual(report.sourceSha256, [binding.sourceSha256]) || report.maskSha256 !== binding.maskSha256
    || !isDeepStrictEqual(report.quotedCost, operation.quotedCost) || !isDeepStrictEqual(report.maximumCost, operation.maximumCost)
    || approval?.approvalId !== allocated.approvalId || approval?.approvalSha256 !== allocated.approvalSha256
    || report.imageCount !== 1 || report.width !== 1024 || report.height !== 1024 || report.sha256 !== approved.imageSha256
    || typeof report.imagePath !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(String(report.mimeType))
    || Date.parse(completedAt) < Date.parse(consent.approvedAt) || Date.parse(approved.reviewedAt) < Date.parse(completedAt)
    || Date.parse(approved.reviewedAt) > Date.now()) invalid('WANX_TRIAL_CAMPAIGN_QUALITY_INVALID');
  const image = await readStableBytes(scope, resolve(scope.path, report.imagePath), 16 * 1024 * 1024);
  if (image.bytes.length !== report.bytes || digest(image.bytes) !== approved.imageSha256) invalid('WANX_TRIAL_CAMPAIGN_QUALITY_INVALID');
}

export async function assertAiImageWanxTrialCampaignAuthorization(input: ScopeInput & AuthorizationExecutionInput) {
  try {
    const scope = await rootScope(input);
    if (!await exists(resolve(scope.path, WANX_ADDITIONAL_AUTHORIZATION_FILE))) {
      if (input.campaignAuthorizationSha256 || input.inpaintQualityApproval) invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_REQUIRED');
      return;
    }
    await assertAuthorizedExecution(scope, await snapshot(scope), input);
  }
  catch (error) { preserveCampaignError(error); }
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
  approvalApprovedAt?: string;
  campaignAuthorizationSha256?: string;
  inpaintQualityApproval?: WanxCampaignArtifact;
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
    await assertAuthorizedExecution(scope, state, { ...input, roundId, manifestSha256, operation });
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
      const record: Reservation['record'] = { ...(state.authorization && source === 'RESERVATION'
        ? { schemaVersion: 2 as const, kind: 'WANX_TRIAL_CAMPAIGN_RESERVATION_V2' as const, campaignAuthorizationSha256: state.authorization.sha256 }
        : { schemaVersion: 1 as const, kind: 'WANX_TRIAL_CAMPAIGN_RESERVATION_V1' as const }),
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
    if (state.authorization) {
      const consent = state.authorization.record.consent;
      if (roundId !== consent.execution.roundId
        || (operation === 'INPAINT' ? state.entries.length !== 4 : state.entries.length !== 5)
        || [...state.historical.values()].some(item => item.approvalId === approvalId || item.approvalSha256 === approvalSha256)
        || !input.approvalApprovedAt || Date.parse(timestamp.parse(input.approvalApprovedAt)) < Date.parse(consent.approvedAt)) {
        release = true;
        invalid('WANX_TRIAL_CAMPAIGN_AUTHORIZATION_SCOPE_MISMATCH');
      }
    }
    const allocation: Allocation = { roundId, manifestSha256, roundSha256, claimSha256,
      operation, operationId, requestFingerprint: binding.requestFingerprint,
      maximumCost: money(slot.maximumCost), approvalId, approvalSha256 };
    if (total([...state.historical.values(), allocation], state.authorization ? 150_000_000n : 100_000_000n).overLimit) {
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
         await assertAuthorizedExecution(scope, current, { ...input, roundId, manifestSha256, operation });
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
