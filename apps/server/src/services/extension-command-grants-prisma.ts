import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  EXTENSION_COMMAND_SCOPE_BY_OPERATION,
  EXTENSION_COMMAND_RECOVERY_LEASE_MS,
  MAX_OUTSTANDING_EXTENSION_COMMAND_GRANTS,
  extensionCommandIdentityEqual,
  hashExtensionCommandRequest,
  type ExtensionCommandBinding,
  type ExtensionCommandCompleteResult,
  type ExtensionCommandConsumeResult,
  type ExtensionCommandGrantRecord,
  type ExtensionCommandGrantStore,
  type ExtensionCommandIssueResult,
  type ExtensionCommandInspectResult,
  type ExtensionCommandReceipt,
  type ExtensionCommandRecoveryClaimResult,
  type ExtensionCommandRevokeResult,
} from './extension-command-grants.js';

export type ExtensionCommandTransactionClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type ExtensionCommandDatabaseClient = ExtensionCommandTransactionClient & {
  $transaction<T>(
    action: (tx: ExtensionCommandTransactionClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T>;
};

type GrantAuthorizationRow = ExtensionCommandGrantRecord & {
  sessionStatus: string;
  sessionExpiresAt: Date;
  currentJti: string;
  sessionOwnerUserId: string;
  actorUserId: string;
  scopes: string[];
  ownerStatus: string;
  actorStatus: string;
  ownerRole: string;
  actorRole: string;
  actorParentId: string | null;
};

type ShopAuthorizationRow = {
  shopGrantStatus: string;
  shopOwnerUserId: string;
  shopStatus: string;
  platform: string;
};

const GRANT_COLUMNS = `
  "id",
  "session_id" AS "sessionId",
  "token_id" AS "tokenId",
  "owner_user_id" AS "ownerUserId",
  "shop_id" AS "shopId",
  "operation"::text AS "operation",
  "workflow_id" AS "workflowId",
  "draft_version" AS "draftVersion",
  "idempotency_key" AS "idempotencyKey",
  "request_hash" AS "requestHash",
  "token_digest" AS "tokenDigest",
  "issued_at" AS "issuedAt",
  "expires_at" AS "expiresAt",
  "consumed_at" AS "consumedAt",
  "revoked_at" AS "revokedAt",
  "revoked_reason"::text AS "revokedReason"`;

const RECEIPT_COLUMNS = `
  "id",
  "grant_id" AS "grantId",
  "status"::text AS "status",
  "result",
  "failure_code" AS "failureCode",
  "created_at" AS "createdAt",
  "completed_at" AS "completedAt"`;

function grantFromRow(row: any): ExtensionCommandGrantRecord {
  return {
    id: String(row.id),
    sessionId: String(row.sessionId),
    tokenId: String(row.tokenId),
    ownerUserId: String(row.ownerUserId),
    shopId: row.shopId == null ? null : String(row.shopId),
    operation: row.operation,
    workflowId: row.workflowId == null ? null : String(row.workflowId),
    draftVersion: row.draftVersion == null ? null : Number(row.draftVersion),
    idempotencyKey: String(row.idempotencyKey),
    requestHash: String(row.requestHash),
    tokenDigest: String(row.tokenDigest),
    issuedAt: new Date(row.issuedAt),
    expiresAt: new Date(row.expiresAt),
    consumedAt: row.consumedAt == null ? null : new Date(row.consumedAt),
    revokedAt: row.revokedAt == null ? null : new Date(row.revokedAt),
    revokedReason: row.revokedReason == null ? null : String(row.revokedReason) as any,
  };
}

function receiptFromRow(row: any): ExtensionCommandReceipt {
  return {
    id: String(row.id),
    grantId: String(row.grantId),
    status: row.status,
    result: row.result ?? null,
    failureCode: row.failureCode == null ? null : String(row.failureCode),
    createdAt: new Date(row.createdAt),
    completedAt: row.completedAt == null ? null : new Date(row.completedAt),
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return hashExtensionCommandRequest(left) === hashExtensionCommandRequest(right);
  } catch {
    return false;
  }
}

function jsonParameter(value: unknown): string {
  hashExtensionCommandRequest(value);
  return JSON.stringify(value);
}

function sessionIsLive(row: GrantAuthorizationRow, binding: ExtensionCommandBinding, now: Date): boolean {
  return row.sessionStatus === 'ACTIVE'
    && row.sessionExpiresAt.getTime() > now.getTime()
    && row.currentJti === binding.tokenId
    && row.sessionOwnerUserId === binding.ownerUserId
    && row.actorUserId === binding.ownerUserId
    && row.ownerStatus === 'ACTIVE'
    && row.actorStatus === 'ACTIVE'
    && ['USER', 'ADMIN'].includes(row.ownerRole)
    && ['USER', 'ADMIN'].includes(row.actorRole)
    && row.actorParentId === null;
}

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  const codes = [candidate.code, candidate.meta?.code].map((value) => String(value || ''));
  return codes.some((code) => code === 'P2034' || code === '40001' || code === '40P01');
}

export async function runExtensionCommandSerializableTransaction<T>(
  client: ExtensionCommandDatabaseClient,
  action: (tx: ExtensionCommandTransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.$transaction(action, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt === 3 || !isRetryableTransactionError(error)) throw error;
    }
  }
  throw new Error('EXTENSION_COMMAND_SERIALIZABLE_RETRY_EXHAUSTED');
}

const runSerializable = runExtensionCommandSerializableTransaction;

type GrantAuthorizationResult =
  | { kind: 'allowed'; grant: ExtensionCommandGrantRecord }
  | Exclude<ExtensionCommandConsumeResult, { kind: 'execute' }>;

async function inspectGrantAuthorization(
  tx: ExtensionCommandTransactionClient,
  input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    now: Date;
    requireLiveAuthorizationForPendingReplay?: boolean;
  },
  lockRows: boolean,
): Promise<GrantAuthorizationResult> {
  const grantLock = lockRows ? 'FOR UPDATE OF g, s, owner_account, actor_account' : '';
  const shopLock = lockRows ? 'FOR UPDATE OF sg, sh' : '';
  const grantRows = await tx.$queryRawUnsafe<any[]>(
    `SELECT
       g."id",
       g."session_id" AS "sessionId",
       g."token_id" AS "tokenId",
       g."owner_user_id" AS "ownerUserId",
       g."shop_id" AS "shopId",
       g."operation"::text AS "operation",
       g."workflow_id" AS "workflowId",
       g."draft_version" AS "draftVersion",
       g."idempotency_key" AS "idempotencyKey",
       g."request_hash" AS "requestHash",
       g."token_digest" AS "tokenDigest",
       g."issued_at" AS "issuedAt",
       g."expires_at" AS "expiresAt",
       g."consumed_at" AS "consumedAt",
       g."revoked_at" AS "revokedAt",
       g."revoked_reason"::text AS "revokedReason",
       s."status"::text AS "sessionStatus",
       s."expires_at" AS "sessionExpiresAt",
       s."current_jti" AS "currentJti",
       s."owner_user_id" AS "sessionOwnerUserId",
       s."actor_user_id" AS "actorUserId",
       s."scopes",
       owner_account."status"::text AS "ownerStatus",
       actor_account."status"::text AS "actorStatus",
       owner_account."role"::text AS "ownerRole",
       actor_account."role"::text AS "actorRole",
       actor_account."parent_id" AS "actorParentId"
     FROM "extension_command_grants" g
     JOIN "extension_device_sessions" s ON s."id" = g."session_id"
     JOIN "users" owner_account ON owner_account."id" = s."owner_user_id"
     JOIN "users" actor_account ON actor_account."id" = s."actor_user_id"
     WHERE g."token_digest" = $1
     ${grantLock}`,
    input.tokenDigest,
  );
  const raw = grantRows[0];
  if (!raw) return { kind: 'not_found' };
  const stored = grantFromRow(raw);
  const live: GrantAuthorizationRow = {
    ...stored,
    sessionStatus: String(raw.sessionStatus),
    sessionExpiresAt: new Date(raw.sessionExpiresAt),
    currentJti: String(raw.currentJti),
    sessionOwnerUserId: String(raw.sessionOwnerUserId),
    actorUserId: String(raw.actorUserId),
    scopes: Array.isArray(raw.scopes) ? raw.scopes.map(String) : [],
    ownerStatus: String(raw.ownerStatus),
    actorStatus: String(raw.actorStatus),
    ownerRole: String(raw.ownerRole),
    actorRole: String(raw.actorRole),
    actorParentId: raw.actorParentId == null ? null : String(raw.actorParentId),
  };
  if (!extensionCommandIdentityEqual(stored, input.binding)) return { kind: 'mismatch' };

  const receiptRows = await tx.$queryRawUnsafe<any[]>(
    `SELECT ${RECEIPT_COLUMNS}
     FROM "extension_command_receipts"
     WHERE "grant_id" = $1`,
    stored.id,
  );
  const existingReceipt = receiptRows[0] ? receiptFromRow(receiptRows[0]) : null;
  const pendingReplayRequiresLiveAuthorization = existingReceipt?.status === 'PENDING'
    && input.requireLiveAuthorizationForPendingReplay === true;
  if (existingReceipt && !pendingReplayRequiresLiveAuthorization) {
    return { kind: 'replay', receipt: existingReceipt };
  }
  if (stored.tokenId !== input.binding.tokenId) return { kind: 'mismatch' };
  if (stored.revokedAt) return { kind: 'revoked' };
  if (stored.expiresAt.getTime() <= input.now.getTime()) return { kind: 'expired' };
  if (!sessionIsLive(live, input.binding, input.now)) return { kind: 'session_invalid' };

  const requiredScope = EXTENSION_COMMAND_SCOPE_BY_OPERATION[stored.operation];
  if (!live.scopes.includes(requiredScope)) return { kind: 'scope_denied' };

  if (stored.shopId) {
    const shopRows = await tx.$queryRawUnsafe<ShopAuthorizationRow[]>(
      `SELECT sg."status"::text AS "shopGrantStatus",
              sh."user_id" AS "shopOwnerUserId",
              sh."status"::text AS "shopStatus",
              sh."platform"::text AS "platform"
       FROM "extension_device_shop_grants" sg
       JOIN "shops" sh ON sh."id" = sg."shop_id"
       WHERE sg."session_id" = $1 AND sg."shop_id" = $2
       ${shopLock}`,
      stored.sessionId,
      stored.shopId,
    );
    const shop = shopRows[0];
    const baseAllowed = shop
      && shop.shopGrantStatus === 'ACTIVE'
      && shop.shopOwnerUserId === stored.ownerUserId;
    const activeOzonRequired = ['OZON_PUBLISH', 'BYOK_MEDIA_INGEST'].includes(stored.operation);
    const shopContextAllowed = !activeOzonRequired
      || (shop?.shopStatus === 'ACTIVE' && shop.platform === 'OZON');
    if (!baseAllowed || !shopContextAllowed) return { kind: 'shop_denied' };
  }

  if (existingReceipt) return { kind: 'replay', receipt: existingReceipt };
  return { kind: 'allowed', grant: stored };
}

export async function inspectExtensionCommandGrant(
  client: ExtensionCommandTransactionClient,
  input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    now: Date;
    requireLiveAuthorizationForPendingReplay?: boolean;
  },
): Promise<ExtensionCommandInspectResult> {
  const result = await inspectGrantAuthorization(client, input, false);
  return result.kind === 'allowed' ? { kind: 'allowed' } : result;
}

export async function consumeExtensionCommandGrantInTransaction(
  tx: ExtensionCommandTransactionClient,
  input: {
    tokenDigest: string;
    binding: ExtensionCommandBinding;
    receiptId: string;
    now: Date;
    requireLiveAuthorizationForPendingReplay?: boolean;
  },
): Promise<ExtensionCommandConsumeResult> {
  const authorization = await inspectGrantAuthorization(tx, input, true);
  if (authorization.kind !== 'allowed') return authorization;
  const stored = authorization.grant;

  const consumed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "extension_command_grants"
     SET "consumed_at" = $1
     WHERE "id" = $2
       AND "consumed_at" IS NULL
       AND "revoked_at" IS NULL
       AND "expires_at" > $1
     RETURNING "id"`,
    input.now,
    stored.id,
  );
  if (consumed.length !== 1) throw new Error('EXTENSION_COMMAND_GRANT_CONSUME_CONFLICT');

  const insertedReceipts = await tx.$queryRawUnsafe<any[]>(
    `INSERT INTO "extension_command_receipts"
      ("id", "grant_id", "status", "result", "failure_code", "recovery_not_before",
       "created_at", "completed_at")
     VALUES ($1, $2, 'PENDING', NULL, NULL, $4, $3, NULL)
     RETURNING ${RECEIPT_COLUMNS}`,
    input.receiptId,
    stored.id,
    input.now,
    new Date(input.now.getTime() + EXTENSION_COMMAND_RECOVERY_LEASE_MS),
  );
  if (!insertedReceipts[0]) throw new Error('EXTENSION_COMMAND_RECEIPT_INSERT_FAILED');
  return { kind: 'execute', receipt: receiptFromRow(insertedReceipts[0]) };
}

export function createPrismaExtensionCommandGrantStore(options: {
  client?: PrismaClient | ExtensionCommandDatabaseClient;
} = {}): ExtensionCommandGrantStore {
  const client = (options.client || prisma) as unknown as ExtensionCommandDatabaseClient;

  return {
    async inspectGrant(input): Promise<ExtensionCommandInspectResult> {
      return inspectExtensionCommandGrant(client, input);
    },

    async issueGrant(grant): Promise<ExtensionCommandIssueResult> {
      return runSerializable(client, async (tx) => {
        const sessions = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id"
           FROM "extension_device_sessions"
           WHERE "id" = $1 AND "owner_user_id" = $2
           FOR UPDATE`,
          grant.sessionId,
          grant.ownerUserId,
        );
        if (!sessions[0]) throw new Error('EXTENSION_COMMAND_SESSION_NOT_FOUND');

        const existingRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT ${GRANT_COLUMNS}
           FROM "extension_command_grants"
           WHERE "session_id" = $1 AND "idempotency_key" = $2
           FOR UPDATE`,
          grant.sessionId,
          grant.idempotencyKey,
        );
        const existing = existingRows[0] ? grantFromRow(existingRows[0]) : null;
        if (existing) {
          if (!extensionCommandIdentityEqual(existing, grant)) return { kind: 'conflict' };
          if (existing.consumedAt || existing.revokedAt
            || (existing.tokenId === grant.tokenId
              && existing.expiresAt.getTime() > grant.issuedAt.getTime())) {
            return { kind: 'replay', grant: existing };
          }
          const renewedRows = await tx.$queryRawUnsafe<any[]>(
            `UPDATE "extension_command_grants"
             SET "token_id" = $2, "issued_at" = $3, "expires_at" = $4
             WHERE "id" = $1
               AND "consumed_at" IS NULL
               AND "revoked_at" IS NULL
               AND ("token_id" <> $2 OR "expires_at" <= $3)
             RETURNING ${GRANT_COLUMNS}`,
            existing.id,
            grant.tokenId,
            grant.issuedAt,
            grant.expiresAt,
          );
          if (!renewedRows[0]) throw new Error('EXTENSION_COMMAND_GRANT_RENEW_CONFLICT');
          return { kind: 'renewed', grant: grantFromRow(renewedRows[0]) };
        }

        const counts = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS "count"
           FROM "extension_command_grants"
           WHERE "session_id" = $1
             AND "consumed_at" IS NULL
             AND "revoked_at" IS NULL
             AND "expires_at" > $2`,
          grant.sessionId,
          grant.issuedAt,
        );
        if (Number(counts[0]?.count || 0) >= MAX_OUTSTANDING_EXTENSION_COMMAND_GRANTS) {
          return { kind: 'limit' };
        }

        const inserted = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO "extension_command_grants"
            ("id", "session_id", "token_id", "owner_user_id", "shop_id", "operation",
             "workflow_id", "draft_version", "idempotency_key", "request_hash", "token_digest",
             "issued_at", "expires_at", "consumed_at", "revoked_at", "revoked_reason")
           VALUES ($1, $2, $3, $4, $5, $6::"ExtensionCommandOperation",
                   $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   $16::"ExtensionDeviceRevocationReason")
           ON CONFLICT ("session_id", "idempotency_key") DO NOTHING
           RETURNING ${GRANT_COLUMNS}`,
          grant.id,
          grant.sessionId,
          grant.tokenId,
          grant.ownerUserId,
          grant.shopId,
          grant.operation,
          grant.workflowId,
          grant.draftVersion,
          grant.idempotencyKey,
          grant.requestHash,
          grant.tokenDigest,
          grant.issuedAt,
          grant.expiresAt,
          grant.consumedAt,
          grant.revokedAt,
          grant.revokedReason,
        );
        if (inserted[0]) return { kind: 'issued', grant: grantFromRow(inserted[0]) };
        throw new Error('EXTENSION_COMMAND_GRANT_INSERT_CONFLICT');
      });
    },

    async consumeOrReplay(input): Promise<ExtensionCommandConsumeResult> {
      return runSerializable(client, (tx) => consumeExtensionCommandGrantInTransaction(tx, input));
    },

    async claimPendingRecovery(input): Promise<ExtensionCommandRecoveryClaimResult> {
      return runSerializable(client, async (tx) => {
        const acquired = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "extension_command_receipts"
           SET "recovery_not_before" = $2
           WHERE "id" = $1
             AND "status" = 'PENDING'
             AND ("recovery_not_before" IS NULL OR "recovery_not_before" <= $3)
           RETURNING ${RECEIPT_COLUMNS}`,
          input.receiptId,
          input.recoveryNotBefore,
          input.now,
        );
        if (acquired[0]) {
          return { kind: 'acquired', receipt: receiptFromRow(acquired[0]) };
        }
        const existing = await tx.$queryRawUnsafe<any[]>(
          `SELECT ${RECEIPT_COLUMNS}
           FROM "extension_command_receipts"
           WHERE "id" = $1`,
          input.receiptId,
        );
        return existing[0]
          ? { kind: 'not_ready', receipt: receiptFromRow(existing[0]) }
          : { kind: 'not_found' };
      });
    },

    async completeReceipt(input): Promise<ExtensionCommandCompleteResult> {
      const resultJson = jsonParameter(input.result);
      return runSerializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `SELECT ${RECEIPT_COLUMNS}
           FROM "extension_command_receipts"
           WHERE "id" = $1
           FOR UPDATE`,
          input.receiptId,
        );
        if (!rows[0]) return { kind: 'not_found' };
        const existing = receiptFromRow(rows[0]);
        if (existing.status !== 'PENDING') {
          return existing.status === input.status
            && existing.failureCode === input.failureCode
            && jsonEqual(existing.result, input.result)
            ? { kind: 'idempotent', receipt: existing }
            : { kind: 'immutable' };
        }

        const completedRows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "extension_command_receipts"
           SET "status" = $1::"ExtensionCommandReceiptStatus",
               "result" = $2::jsonb,
               "failure_code" = $3,
               "completed_at" = $4
           WHERE "id" = $5 AND "status" = 'PENDING'
           RETURNING ${RECEIPT_COLUMNS}`,
          input.status,
          resultJson,
          input.failureCode,
          input.now,
          input.receiptId,
        );
        if (!completedRows[0]) throw new Error('EXTENSION_COMMAND_RECEIPT_COMPLETE_CONFLICT');
        return { kind: 'completed', receipt: receiptFromRow(completedRows[0]) };
      });
    },

    async revokeGrant(input): Promise<ExtensionCommandRevokeResult> {
      return runSerializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `SELECT ${GRANT_COLUMNS}
           FROM "extension_command_grants"
           WHERE "id" = $1 AND "owner_user_id" = $2
           FOR UPDATE`,
          input.grantId,
          input.ownerUserId,
        );
        if (!rows[0]) return { kind: 'not_found' };
        const existing = grantFromRow(rows[0]);
        if (existing.consumedAt) return { kind: 'immutable' };
        if (existing.revokedAt) {
          return existing.revokedReason === input.reason
            ? { kind: 'idempotent', grant: existing }
            : { kind: 'immutable' };
        }

        const revokedRows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "extension_command_grants"
           SET "revoked_at" = $1,
               "revoked_reason" = $2::"ExtensionDeviceRevocationReason"
           WHERE "id" = $3
             AND "owner_user_id" = $4
             AND "consumed_at" IS NULL
             AND "revoked_at" IS NULL
           RETURNING ${GRANT_COLUMNS}`,
          input.now,
          input.reason,
          input.grantId,
          input.ownerUserId,
        );
        if (!revokedRows[0]) throw new Error('EXTENSION_COMMAND_GRANT_REVOKE_CONFLICT');
        return { kind: 'revoked', grant: grantFromRow(revokedRows[0]) };
      });
    },
  };
}
