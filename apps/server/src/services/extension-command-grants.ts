import { createHash, createHmac, randomUUID } from 'node:crypto';

type Environment = Record<string, string | undefined>;

export function resolveExtensionCommandGrantSecret(
  env: Environment = process.env,
): string {
  const explicit = String(env.EXTENSION_COMMAND_GRANT_SECRET || '').trim();
  if (explicit) {
    if (explicit.length < 32) {
      throw new Error('EXTENSION_COMMAND_GRANT_SECRET must be at least 32 characters');
    }
    if (explicit === String(env.EXTENSION_DEVICE_JWT_SECRET || '').trim()
      || explicit === String(env.JWT_SECRET || '').trim()) {
      throw new Error('EXTENSION_COMMAND_GRANT_SECRET must differ from JWT secrets');
    }
    return explicit;
  }
  if (String(env.NODE_ENV || '').trim() === 'production') {
    throw new Error('EXTENSION_COMMAND_GRANT_SECRET is required in production');
  }
  const developmentSeed = String(
    env.EXTENSION_DEVICE_JWT_SECRET || env.JWT_SECRET || 'dev-extension-command-secret',
  );
  return createHmac('sha256', developmentSeed)
    .update('ss-erp-extension-command-grant-secret-v1')
    .digest('hex');
}

export const EXTENSION_COMMAND_OPERATIONS = [
  'SOURCE_CAPTURE',
  'LISTING_WRITE',
  'LISTING_REVIEW',
  'MEDIA_EXECUTE',
  'MEDIA_REVIEW',
  'MEDIA_APPLY',
  'BYOK_MEDIA_INGEST',
  'OZON_PUBLISH',
] as const;

export const EXTENSION_COMMAND_SCOPE_BY_OPERATION = {
  SOURCE_CAPTURE: 'capture:write',
  LISTING_WRITE: 'listing:write',
  LISTING_REVIEW: 'listing:review',
  MEDIA_EXECUTE: 'media:execute',
  MEDIA_REVIEW: 'listing:review',
  MEDIA_APPLY: 'listing:write',
  BYOK_MEDIA_INGEST: 'byok:media:ingest',
  OZON_PUBLISH: 'listing:publish',
} as const;

export const MAX_OUTSTANDING_EXTENSION_COMMAND_GRANTS = 50;
export const EXTENSION_COMMAND_RECOVERY_LEASE_MS = 60_000;

export type ExtensionCommandOperation = typeof EXTENSION_COMMAND_OPERATIONS[number];
export type ExtensionCommandReceiptStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';
export const EXTENSION_COMMAND_REVOCATION_REASONS = [
  'OWNER_REVOKED',
  'ACCOUNT_SUSPENDED',
  'AUTHORIZATION_INVALID',
  'SESSION_EXPIRED',
  'REFRESH_REUSE_DETECTED',
  'SHOP_TRANSFERRED',
  'SHOP_UNLINKED',
  'SCOPE_REVOKED',
] as const;
export type ExtensionCommandRevocationReason = typeof EXTENSION_COMMAND_REVOCATION_REASONS[number];

export interface ExtensionCommandBinding {
  sessionId: string;
  tokenId: string;
  ownerUserId: string;
  shopId: string | null;
  operation: ExtensionCommandOperation;
  workflowId: string | null;
  draftVersion: number | null;
  idempotencyKey: string;
  requestHash: string;
}

export interface ExtensionCommandGrantRecord extends ExtensionCommandBinding {
  id: string;
  tokenDigest: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: ExtensionCommandRevocationReason | null;
}

export interface ExtensionCommandReceipt {
  id: string;
  grantId: string;
  status: ExtensionCommandReceiptStatus;
  result: unknown | null;
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type ExtensionCommandConsumeResult =
  | { kind: 'execute'; receipt: ExtensionCommandReceipt }
  | { kind: 'replay'; receipt: ExtensionCommandReceipt }
  | { kind: 'not_found' }
  | { kind: 'mismatch' }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'session_invalid' }
  | { kind: 'scope_denied' }
  | { kind: 'shop_denied' };

export type ExtensionCommandIssueResult =
  | { kind: 'issued'; grant: ExtensionCommandGrantRecord }
  | { kind: 'renewed'; grant: ExtensionCommandGrantRecord }
  | { kind: 'replay'; grant: ExtensionCommandGrantRecord }
  | { kind: 'conflict' }
  | { kind: 'limit' };

export type ExtensionCommandCompleteResult =
  | { kind: 'completed'; receipt: ExtensionCommandReceipt }
  | { kind: 'idempotent'; receipt: ExtensionCommandReceipt }
  | { kind: 'not_found' }
  | { kind: 'immutable' };

export type ExtensionCommandRecoveryClaimResult =
  | { kind: 'acquired' | 'not_ready'; receipt: ExtensionCommandReceipt }
  | { kind: 'not_found' };

export type ExtensionCommandRevokeResult =
  | { kind: 'revoked'; grant: ExtensionCommandGrantRecord }
  | { kind: 'idempotent'; grant: ExtensionCommandGrantRecord }
  | { kind: 'not_found' }
  | { kind: 'immutable' };

export interface ExtensionCommandGrantStore {
  issueGrant(grant: ExtensionCommandGrantRecord): Promise<ExtensionCommandIssueResult>;
  consumeOrReplay(input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    receiptId: string;
    now: Date;
  }): Promise<ExtensionCommandConsumeResult>;
  claimPendingRecovery(input: {
    receiptId: string;
    now: Date;
    recoveryNotBefore: Date;
  }): Promise<ExtensionCommandRecoveryClaimResult>;
  completeReceipt(input: {
    receiptId: string;
    status: Exclude<ExtensionCommandReceiptStatus, 'PENDING'>;
    result: unknown;
    failureCode: string | null;
    now: Date;
  }): Promise<ExtensionCommandCompleteResult>;
  revokeGrant(input: {
    grantId: string;
    ownerUserId: string;
    reason: ExtensionCommandRevocationReason;
    now: Date;
  }): Promise<ExtensionCommandRevokeResult>;
}

export class ExtensionCommandGrantError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionCommandGrantError';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalJson(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object') {
    throw new ExtensionCommandGrantError(
      'COMMAND_PAYLOAD_INVALID',
      400,
      'Command payload must contain JSON values only',
    );
  }
  if (seen.has(value)) {
    throw new ExtensionCommandGrantError('COMMAND_PAYLOAD_INVALID', 400, 'Command payload is cyclic');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new ExtensionCommandGrantError(
            'COMMAND_PAYLOAD_INVALID',
            400,
            'Command payload arrays cannot contain sparse entries',
          );
        }
      }
      return `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ExtensionCommandGrantError(
        'COMMAND_PAYLOAD_INVALID',
        400,
        'Command payload must be a plain JSON object',
      );
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(object[key], seen)}`
    )).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function hashExtensionCommandRequest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value, new Set())).digest('hex');
}

function requiredIdentifier(value: unknown, field: string, minLength = 1, maxLength = 200): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new ExtensionCommandGrantError('COMMAND_BINDING_INVALID', 400, `${field} is invalid`);
  }
  return normalized;
}

function optionalIdentifier(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  return requiredIdentifier(value, field);
}

function normalizeBinding(input: ExtensionCommandBinding): ExtensionCommandBinding {
  const operation = String(input?.operation || '') as ExtensionCommandOperation;
  if (!EXTENSION_COMMAND_OPERATIONS.includes(operation)) {
    throw new ExtensionCommandGrantError(
      'COMMAND_OPERATION_INVALID',
      400,
      'Extension command operation is invalid',
    );
  }
  const shopId = optionalIdentifier(input.shopId, 'shopId');
  const workflowId = optionalIdentifier(input.workflowId, 'workflowId');
  const draftVersion = input.draftVersion == null ? null : Number(input.draftVersion);
  if (draftVersion != null && (!Number.isSafeInteger(draftVersion) || draftVersion <= 0)) {
    throw new ExtensionCommandGrantError(
      'COMMAND_BINDING_INVALID',
      400,
      'draftVersion is invalid',
    );
  }
  if ((workflowId == null) !== (draftVersion == null)) {
    throw new ExtensionCommandGrantError(
      'COMMAND_BINDING_INVALID',
      400,
      'workflowId and draftVersion must be provided together',
    );
  }
  if (!/^[a-f0-9]{64}$/.test(String(input.requestHash || ''))) {
    throw new ExtensionCommandGrantError(
      'COMMAND_BINDING_INVALID',
      400,
      'requestHash is invalid',
    );
  }
  if (operation === 'OZON_PUBLISH' && !shopId) {
    throw new ExtensionCommandGrantError(
      'COMMAND_SHOP_REQUIRED',
      400,
      'Ozon publish commands require a shop binding',
    );
  }
  if (operation === 'OZON_PUBLISH' && (!workflowId || draftVersion == null)) {
    throw new ExtensionCommandGrantError(
      'COMMAND_BINDING_INVALID',
      400,
      'Ozon publish commands require a workflow and draft version',
    );
  }
  if (operation === 'BYOK_MEDIA_INGEST' && !shopId) {
    throw new ExtensionCommandGrantError(
      'COMMAND_SHOP_REQUIRED',
      400,
      'BYOK media ingest commands require a shop binding',
    );
  }
  if (operation === 'BYOK_MEDIA_INGEST' && (!workflowId || draftVersion == null)) {
    throw new ExtensionCommandGrantError(
      'COMMAND_BINDING_INVALID',
      400,
      'BYOK media ingest commands require a workflow and draft version',
    );
  }
  return {
    sessionId: requiredIdentifier(input.sessionId, 'sessionId'),
    tokenId: requiredIdentifier(input.tokenId, 'tokenId'),
    ownerUserId: requiredIdentifier(input.ownerUserId, 'ownerUserId'),
    shopId,
    operation,
    workflowId,
    draftVersion,
    idempotencyKey: requiredIdentifier(input.idempotencyKey, 'idempotencyKey', 16),
    requestHash: input.requestHash,
  };
}

export function extensionCommandBindingsEqual(
  left: ExtensionCommandBinding,
  right: ExtensionCommandBinding,
): boolean {
  return left.sessionId === right.sessionId
    && left.tokenId === right.tokenId
    && left.ownerUserId === right.ownerUserId
    && left.shopId === right.shopId
    && left.operation === right.operation
    && left.workflowId === right.workflowId
    && left.draftVersion === right.draftVersion
    && left.idempotencyKey === right.idempotencyKey
    && left.requestHash === right.requestHash;
}

export function extensionCommandIdentityEqual(
  left: ExtensionCommandBinding,
  right: ExtensionCommandBinding,
): boolean {
  return left.sessionId === right.sessionId
    && left.ownerUserId === right.ownerUserId
    && left.shopId === right.shopId
    && left.operation === right.operation
    && left.workflowId === right.workflowId
    && left.draftVersion === right.draftVersion
    && left.idempotencyKey === right.idempotencyKey
    && left.requestHash === right.requestHash;
}

function sameResult(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left, new Set()) === canonicalJson(right, new Set());
  } catch {
    return false;
  }
}

export class InMemoryExtensionCommandGrantStore implements ExtensionCommandGrantStore {
  private readonly grants = new Map<string, ExtensionCommandGrantRecord>();
  private readonly receipts = new Map<string, ExtensionCommandReceipt>();
  private readonly recoveryNotBefore = new Map<string, Date>();

  async issueGrant(grant: ExtensionCommandGrantRecord): Promise<ExtensionCommandIssueResult> {
    const existing = [...this.grants.values()].find(
      (item) => item.sessionId === grant.sessionId && item.idempotencyKey === grant.idempotencyKey,
    );
    if (existing) {
      if (!extensionCommandIdentityEqual(existing, grant)) return { kind: 'conflict' };
      if (existing.consumedAt || existing.revokedAt
        || (existing.tokenId === grant.tokenId
          && existing.expiresAt.getTime() > grant.issuedAt.getTime())) {
        return { kind: 'replay', grant: clone(existing) };
      }
      const renewed = {
        ...existing,
        tokenId: grant.tokenId,
        issuedAt: new Date(grant.issuedAt),
        expiresAt: new Date(grant.expiresAt),
      };
      this.grants.set(existing.id, renewed);
      return { kind: 'renewed', grant: clone(renewed) };
    }
    const outstanding = [...this.grants.values()].filter((item) => (
      item.sessionId === grant.sessionId
      && !item.consumedAt
      && !item.revokedAt
      && item.expiresAt.getTime() > grant.issuedAt.getTime()
    )).length;
    if (outstanding >= MAX_OUTSTANDING_EXTENSION_COMMAND_GRANTS) return { kind: 'limit' };
    if ([...this.grants.values()].some((item) => item.tokenDigest === grant.tokenDigest)) {
      throw new Error('COMMAND_GRANT_DIGEST_CONFLICT');
    }
    this.grants.set(grant.id, clone(grant));
    return { kind: 'issued', grant: clone(grant) };
  }

  async consumeOrReplay(input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    receiptId: string;
    now: Date;
  }): Promise<ExtensionCommandConsumeResult> {
    const grant = [...this.grants.values()].find((item) => item.tokenDigest === input.tokenDigest);
    if (!grant) return { kind: 'not_found' };
    if (!extensionCommandIdentityEqual(grant, input.binding)) return { kind: 'mismatch' };

    const existing = [...this.receipts.values()].find((item) => item.grantId === grant.id);
    if (existing) return { kind: 'replay', receipt: clone(existing) };
    if (grant.tokenId !== input.binding.tokenId) return { kind: 'mismatch' };
    if (grant.revokedAt) return { kind: 'revoked' };
    if (grant.expiresAt.getTime() <= input.now.getTime()) return { kind: 'expired' };

    const consumed = { ...grant, consumedAt: new Date(input.now) };
    this.grants.set(grant.id, consumed);
    const receipt: ExtensionCommandReceipt = {
      id: input.receiptId,
      grantId: grant.id,
      status: 'PENDING',
      result: null,
      failureCode: null,
      createdAt: new Date(input.now),
      completedAt: null,
    };
    this.receipts.set(receipt.id, receipt);
    this.recoveryNotBefore.set(
      receipt.id,
      new Date(input.now.getTime() + EXTENSION_COMMAND_RECOVERY_LEASE_MS),
    );
    return { kind: 'execute', receipt: clone(receipt) };
  }

  async claimPendingRecovery(input: {
    receiptId: string;
    now: Date;
    recoveryNotBefore: Date;
  }): Promise<ExtensionCommandRecoveryClaimResult> {
    const receipt = this.receipts.get(input.receiptId);
    if (!receipt) return { kind: 'not_found' };
    const availableAt = this.recoveryNotBefore.get(receipt.id);
    if (receipt.status !== 'PENDING'
      || (availableAt && availableAt.getTime() > input.now.getTime())) {
      return { kind: 'not_ready', receipt: clone(receipt) };
    }
    this.recoveryNotBefore.set(receipt.id, new Date(input.recoveryNotBefore));
    return { kind: 'acquired', receipt: clone(receipt) };
  }

  async completeReceipt(input: {
    receiptId: string;
    status: Exclude<ExtensionCommandReceiptStatus, 'PENDING'>;
    result: unknown;
    failureCode: string | null;
    now: Date;
  }): Promise<ExtensionCommandCompleteResult> {
    const receipt = this.receipts.get(input.receiptId);
    if (!receipt) return { kind: 'not_found' };
    if (receipt.status !== 'PENDING') {
      return receipt.status === input.status
        && receipt.failureCode === input.failureCode
        && sameResult(receipt.result, input.result)
        ? { kind: 'idempotent', receipt: clone(receipt) }
        : { kind: 'immutable' };
    }
    const completed: ExtensionCommandReceipt = {
      ...receipt,
      status: input.status,
      result: clone(input.result),
      failureCode: input.failureCode,
      completedAt: new Date(input.now),
    };
    this.receipts.set(completed.id, completed);
    this.recoveryNotBefore.delete(completed.id);
    return { kind: 'completed', receipt: clone(completed) };
  }

  async revokeGrant(input: {
    grantId: string;
    ownerUserId: string;
    reason: ExtensionCommandRevocationReason;
    now: Date;
  }): Promise<ExtensionCommandRevokeResult> {
    const grant = this.grants.get(input.grantId);
    if (!grant || grant.ownerUserId !== input.ownerUserId) return { kind: 'not_found' };
    if (grant.consumedAt
      || [...this.receipts.values()].some((receipt) => receipt.grantId === input.grantId)) {
      return { kind: 'immutable' };
    }
    if (grant.revokedAt) {
      return grant.revokedReason === input.reason
        ? { kind: 'idempotent', grant: clone(grant) }
        : { kind: 'immutable' };
    }
    const revoked = {
      ...grant,
      revokedAt: new Date(input.now),
      revokedReason: input.reason,
    };
    this.grants.set(revoked.id, revoked);
    return { kind: 'revoked', grant: clone(revoked) };
  }

  snapshot() {
    return clone({
      grants: [...this.grants.values()],
      receipts: [...this.receipts.values()],
    });
  }
}

export function digestExtensionCommandGrantToken(secret: string, token: string): string {
  return createHmac('sha256', secret).update(`extension-command\0${token}`).digest('hex');
}

export function createExtensionCommandGrantService(options: {
  store: ExtensionCommandGrantStore;
  secret: string;
  now?: () => Date;
  deriveToken?: (grantId: string) => string;
}) {
  const secret = String(options.secret || '');
  if (secret.length < 32) throw new Error('Extension command grant secret must be at least 32 characters');
  const now = options.now || (() => new Date());
  const deriveToken = options.deriveToken || ((grantId: string) => createHmac('sha256', secret)
    .update(`extension-command-token\0${grantId}`)
    .digest('base64url'));

  async function finalizeReceipt(input: {
    receiptId: string;
    status: Exclude<ExtensionCommandReceiptStatus, 'PENDING'>;
    result: unknown;
    failureCode: string | null;
  }) {
    const receiptId = requiredIdentifier(input.receiptId, 'receiptId');
    const result = await options.store.completeReceipt({ ...input, receiptId, now: now() });
    if (result.kind === 'completed' || result.kind === 'idempotent') return result.receipt;
    if (result.kind === 'not_found') {
      throw new ExtensionCommandGrantError('COMMAND_RECEIPT_NOT_FOUND', 404, 'Command receipt not found');
    }
    throw new ExtensionCommandGrantError(
      'COMMAND_RECEIPT_IMMUTABLE',
      409,
      'Completed command receipts are immutable',
    );
  }

  return {
    async issue(input: ExtensionCommandBinding & { ttlMs?: number }) {
      const binding = normalizeBinding(input);
      const issuedAt = now();
      const ttlMs = input.ttlMs == null ? 60_000 : Number(input.ttlMs);
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) {
        throw new ExtensionCommandGrantError('COMMAND_TTL_INVALID', 400, 'Command grant TTL is invalid');
      }
      const grantId = randomUUID();
      const token = deriveToken(grantId);
      if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error('Invalid command grant token generator');
      const issued = await options.store.issueGrant({
        id: grantId,
        ...binding,
        tokenDigest: digestExtensionCommandGrantToken(secret, token),
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + ttlMs),
        consumedAt: null,
        revokedAt: null,
        revokedReason: null,
      });
      if (issued.kind === 'conflict') {
        throw new ExtensionCommandGrantError(
          'COMMAND_IDEMPOTENCY_CONFLICT',
          409,
          'Idempotency key is already bound to a different command',
        );
      }
      if (issued.kind === 'limit') {
        throw new ExtensionCommandGrantError(
          'COMMAND_GRANT_LIMIT_REACHED',
          429,
          'Too many outstanding command grants for this device session',
        );
      }
      const grant = issued.grant;
      const returnedToken = deriveToken(grant.id);
      if (!/^[A-Za-z0-9_-]{43,}$/.test(returnedToken)) {
        throw new Error('Invalid command grant token generator');
      }
      return { grantId: grant.id, token: returnedToken, expiresAt: grant.expiresAt };
    },

    async authorize(input: ExtensionCommandBinding & { token: string }) {
      const binding = normalizeBinding(input);
      const token = String(input.token || '').trim();
      if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) {
        throw new ExtensionCommandGrantError('COMMAND_GRANT_NOT_FOUND', 404, 'Command grant not found');
      }
      const result = await options.store.consumeOrReplay({
        tokenDigest: digestExtensionCommandGrantToken(secret, token),
        binding,
        receiptId: randomUUID(),
        now: now(),
      });
      if (result.kind === 'execute' || result.kind === 'replay') return result;
      const errors: Record<
        Exclude<ExtensionCommandConsumeResult['kind'], 'execute' | 'replay'>,
        [string, number, string]
      > = {
        not_found: ['COMMAND_GRANT_NOT_FOUND', 404, 'Command grant not found'],
        mismatch: ['COMMAND_GRANT_MISMATCH', 409, 'Command grant does not match this request'],
        expired: ['COMMAND_GRANT_EXPIRED', 410, 'Command grant expired'],
        revoked: ['COMMAND_GRANT_REVOKED', 410, 'Command grant was revoked'],
        session_invalid: ['COMMAND_SESSION_INVALID', 401, 'Extension device session is invalid'],
        scope_denied: ['COMMAND_SCOPE_DENIED', 403, 'Extension device scope is not allowed'],
        shop_denied: ['COMMAND_SHOP_DENIED', 403, 'Extension device shop is not allowed'],
      };
      const [code, statusCode, message] = errors[result.kind];
      throw new ExtensionCommandGrantError(code, statusCode, message);
    },

    async claimPendingRecovery(input: { receiptId: string }) {
      const receiptId = requiredIdentifier(input.receiptId, 'receiptId');
      const claimedAt = now();
      const result = await options.store.claimPendingRecovery({
        receiptId,
        now: claimedAt,
        recoveryNotBefore: new Date(claimedAt.getTime() + EXTENSION_COMMAND_RECOVERY_LEASE_MS),
      });
      if (result.kind !== 'not_found') return result;
      throw new ExtensionCommandGrantError(
        'COMMAND_RECEIPT_NOT_FOUND',
        404,
        'Command receipt not found',
      );
    },

    async complete(input: { receiptId: string; result: unknown }) {
      return finalizeReceipt({
        receiptId: input.receiptId,
        status: 'SUCCEEDED',
        result: input.result,
        failureCode: null,
      });
    },

    async fail(input: { receiptId: string; failureCode: string; result?: unknown }) {
      return finalizeReceipt({
        receiptId: input.receiptId,
        status: 'FAILED',
        result: input.result ?? null,
        failureCode: requiredIdentifier(input.failureCode, 'failureCode', 1, 100),
      });
    },

    async revoke(input: {
      grantId: string;
      ownerUserId: string;
      reason: ExtensionCommandRevocationReason;
    }) {
      const grantId = requiredIdentifier(input.grantId, 'grantId');
      const ownerUserId = requiredIdentifier(input.ownerUserId, 'ownerUserId');
      if (!EXTENSION_COMMAND_REVOCATION_REASONS.includes(input.reason)) {
        throw new ExtensionCommandGrantError(
          'COMMAND_REVOCATION_REASON_INVALID',
          400,
          'Command grant revocation reason is invalid',
        );
      }
      const result = await options.store.revokeGrant({
        grantId,
        ownerUserId,
        reason: input.reason,
        now: now(),
      });
      if (result.kind === 'revoked' || result.kind === 'idempotent') return result.grant;
      if (result.kind === 'not_found') {
        throw new ExtensionCommandGrantError('COMMAND_GRANT_NOT_FOUND', 404, 'Command grant not found');
      }
      throw new ExtensionCommandGrantError(
        'COMMAND_GRANT_IMMUTABLE',
        409,
        'Consumed or revoked command grants are immutable',
      );
    },
  };
}
