import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ExtensionDeviceLiveAuthorization } from '../lib/extension-device-auth.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import type {
  ExtensionDeviceSessionRepository,
  ExtensionDeviceSessionSnapshot,
  ExtensionDeviceRevocationReason,
} from './extension-device-session.js';
import type {
  ExtensionDeviceManagementRepository,
  ExtensionDeviceManagementSession,
} from '../routes/extension-device.js';

interface RedisEvalClient {
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
}

const CLAIM_WINDOW_SECONDS = 60;
const DEVICE_CLAIM_LIMIT = 10;
const CODE_CLAIM_LIMIT = 5;

const CLAIM_ATTEMPT_SCRIPT = `
local device_count = redis.call('INCR', KEYS[1])
if device_count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local code_count = redis.call('INCR', KEYS[2])
if code_count == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
if device_count > tonumber(ARGV[2]) or code_count > tonumber(ARGV[3]) then return 0 end
return 1
`;

export function createExtensionDeviceClaimAttemptLimiter(redis: RedisEvalClient) {
  return async (input: { codeDigest: string; deviceId: string; now: Date }): Promise<boolean> => {
    if (!/^[a-f0-9]{64}$/.test(input.codeDigest)) return false;
    const deviceDigest = createHash('sha256').update(input.deviceId).digest('hex');
    const result = await redis.eval(
      CLAIM_ATTEMPT_SCRIPT,
      2,
      `extension-device:claim:device:${deviceDigest}`,
      `extension-device:claim:code:${input.codeDigest}`,
      CLAIM_WINDOW_SECONDS,
      DEVICE_CLAIM_LIMIT,
      CODE_CLAIM_LIMIT,
    );
    return Number(result) === 1;
  };
}

interface SqlTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

interface SqlClient extends SqlTransaction {
  $transaction<T>(
    operation: (transaction: SqlTransaction) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T>;
}

function isPostgresSerializationConflict(error: unknown): boolean {
  const value = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown; meta?: unknown }
    : {};
  const meta = value.meta && typeof value.meta === 'object'
    ? value.meta as { code?: unknown; message?: unknown }
    : {};
  return value.code === 'P2034'
    || meta.code === '40001'
    || String(value.message || meta.message || '').includes('could not serialize access');
}

async function runSerializableTransaction<T>(
  client: SqlClient,
  operation: (transaction: SqlTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt === 2 || !isPostgresSerializationConflict(error)) throw error;
    }
  }
  throw new Error('SERIALIZABLE_TRANSACTION_RETRY_EXHAUSTED');
}

type ClaimAttemptLimiter = ExtensionDeviceSessionRepository['consumePairingClaimAttemptBudget'];

export interface PrismaExtensionDeviceSessionRepository
  extends ExtensionDeviceSessionRepository, ExtensionDeviceManagementRepository {
  loadAuthorization(sessionId: string): Promise<ExtensionDeviceLiveAuthorization | null>;
  revokeSessionsForUser(userId: string, reason: ExtensionDeviceRevocationReason): Promise<number>;
}

interface PairingRow {
  id: string;
  actorUserId: string;
  ownerUserId: string;
  status: string;
  shopIds: string[];
  scopes: string[];
  expiresAt: Date;
  ownerStatus: string;
  actorStatus: string;
  ownerRole: string;
  actorRole: string;
  actorParentId: string | null;
  resumeSessionId: string | null;
}

interface ResumeSessionRow {
  id: string;
  deviceId: string;
}

interface RefreshRow {
  credentialId: string;
  generation: number;
  credentialExpiresAt: Date;
  credentialConsumedAt: Date | null;
  familyId: string;
  familyStatus: string;
  sessionId: string;
  sessionStatus: string;
  deploymentId: string;
  deviceId: string;
  actorUserId: string;
  ownerUserId: string;
  scopes: string[];
  currentJti: string;
  sessionExpiresAt: Date;
  ownerStatus: string;
  actorStatus: string;
  ownerRole: string;
  actorRole: string;
  actorParentId: string | null;
}

function activeAccountStatus(value: string): boolean {
  return value === 'ACTIVE';
}

async function loadExplicitResumeSession(
  tx: SqlTransaction,
  input: {
    resumeSessionId: string;
    deploymentId: string;
    actorUserId: string;
    ownerUserId: string;
    shopIds: string[];
    now: Date;
    deviceId?: string;
    requireNoActiveSession?: boolean;
  },
): Promise<ResumeSessionRow | null> {
  const rows = await tx.$queryRawUnsafe<ResumeSessionRow[]>(
    `SELECT resumed."id", resumed."device_id" AS "deviceId"
     FROM "extension_device_sessions" resumed
     WHERE resumed."id" = $1
       AND resumed."deployment_id" = $2
       AND resumed."actor_user_id" = $3
       AND resumed."owner_user_id" = $4
       AND resumed."status" = 'REVOKED'
       AND resumed."revoked_at" IS NOT NULL
       AND resumed."revoked_at" <= $6
       AND resumed."revoked_reason" = 'OWNER_REVOKED'
       AND resumed."expires_at" > $6
       AND resumed."scopes" @> ARRAY['byok:media:ingest']::TEXT[]
       AND ($7::TEXT IS NULL OR resumed."device_id" = $7)
       AND NOT EXISTS (
         SELECT 1 FROM "extension_device_sessions" successor
         WHERE successor."replaces_session_id" = resumed."id"
       )
       AND NOT EXISTS (
         SELECT 1 FROM "extension_device_shop_grants" resume_grant
         WHERE resume_grant."session_id" = resumed."id"
           AND (
             NOT (resume_grant."shop_id" = ANY($5::TEXT[]))
             OR resume_grant."status" <> 'REVOKED'
             OR resume_grant."revoked_at" IS NULL
             OR resume_grant."revoked_at" > $6
             OR resume_grant."revoked_reason" IS DISTINCT FROM 'OWNER_REVOKED'
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM unnest($5::TEXT[]) requested_shop("id")
         WHERE NOT EXISTS (
           SELECT 1 FROM "extension_device_shop_grants" resume_grant
           WHERE resume_grant."session_id" = resumed."id"
             AND resume_grant."shop_id" = requested_shop."id"
         )
       )
       AND (
         SELECT COUNT(*) FROM "extension_device_shop_grants" resume_grant
         WHERE resume_grant."session_id" = resumed."id"
       ) = cardinality($5::TEXT[])
       AND (
         NOT $8::BOOLEAN
         OR NOT EXISTS (
           SELECT 1 FROM "extension_device_sessions" active_session
           WHERE active_session."owner_user_id" = resumed."owner_user_id"
             AND active_session."actor_user_id" = resumed."actor_user_id"
             AND active_session."deployment_id" = resumed."deployment_id"
             AND active_session."device_id" = resumed."device_id"
             AND active_session."status" = 'ACTIVE'
         )
       )
     FOR UPDATE OF resumed`,
    input.resumeSessionId,
    input.deploymentId,
    input.actorUserId,
    input.ownerUserId,
    input.shopIds,
    input.now,
    input.deviceId || null,
    input.requireNoActiveSession === true,
  );
  return rows.length === 1 ? rows[0]! : null;
}

export function resolveExtensionDeviceRefreshRevocationReason(input: {
  credentialExpired: boolean;
  sessionExpired: boolean;
  familyStatus: string;
  sessionStatus: string;
  ownerStatus: string;
  actorStatus: string;
  ownerRole: string;
  actorRole: string;
  actorParentId: string | null;
  actorMatchesOwner: boolean;
  totalGrants: number;
  validGrants: number;
}): ExtensionDeviceRevocationReason | null {
  if (input.familyStatus !== 'ACTIVE' || input.sessionStatus !== 'ACTIVE') return null;
  if (input.credentialExpired || input.sessionExpired) return 'SESSION_EXPIRED';
  if (!activeAccountStatus(input.ownerStatus) || !activeAccountStatus(input.actorStatus)) {
    return 'ACCOUNT_SUSPENDED';
  }
  if (!['USER', 'ADMIN'].includes(input.ownerRole)
    || !['USER', 'ADMIN'].includes(input.actorRole)) {
    return 'AUTHORIZATION_INVALID';
  }
  if (input.actorParentId !== null || !input.actorMatchesOwner) return 'ACTOR_UNLINKED';
  if (input.totalGrants === 0 || input.validGrants !== input.totalGrants) return 'SHOP_TRANSFERRED';
  return null;
}

function snapshotFromRefresh(row: RefreshRow, currentJti: string): ExtensionDeviceSessionSnapshot {
  return {
    id: row.sessionId,
    deploymentId: row.deploymentId,
    deviceId: row.deviceId,
    actorUserId: row.actorUserId,
    ownerUserId: row.ownerUserId,
    scopes: row.scopes,
    currentJti,
    expiresAt: row.sessionExpiresAt,
  };
}

async function recordSecurityEvent(tx: SqlTransaction, input: {
  sessionId: string;
  refreshFamilyId: string | null;
  actorUserId: string | null;
  type: 'PAIRING_CLAIMED' | 'SESSION_REVOKED' | 'REFRESH_REUSE_DETECTED';
  reasonCode: ExtensionDeviceRevocationReason;
  now: Date;
}): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO "extension_device_security_events"
      ("id", "session_id", "refresh_family_id", "actor_user_id", "type", "reason_code", "created_at")
     SELECT $1, $2, $3, $4, $5::"ExtensionDeviceSecurityEventType",
            $6::"ExtensionDeviceRevocationReason", $7
     WHERE NOT EXISTS (
       SELECT 1 FROM "extension_device_security_events"
       WHERE "session_id" = $2 AND "type" = $5::"ExtensionDeviceSecurityEventType"
         AND "reason_code" = $6::"ExtensionDeviceRevocationReason"
     )
     ON CONFLICT DO NOTHING`,
    randomUUID(), input.sessionId, input.refreshFamilyId, input.actorUserId,
    input.type, input.reasonCode, input.now,
  );
}

async function revokeRefreshFamily(
  tx: SqlTransaction,
  row: Pick<RefreshRow, 'familyId' | 'sessionId'>,
  reason: ExtensionDeviceRevocationReason,
  now: Date,
  options: { actorUserId?: string | null; reuseDetected?: boolean } = {},
): Promise<void> {
  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_refresh_families"
     SET "status" = 'REVOKED', "revoked_at" = COALESCE("revoked_at", $1),
         "revoked_reason" = COALESCE(
           "revoked_reason", $2::"ExtensionDeviceRevocationReason"
         ), "updated_at" = $1
     WHERE "id" = $3`,
    now, reason, row.familyId,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_sessions"
     SET "status" = 'REVOKED', "revoked_at" = COALESCE("revoked_at", $1),
         "revoked_reason" = COALESCE(
           "revoked_reason", $2::"ExtensionDeviceRevocationReason"
         ), "updated_at" = $1
     WHERE "id" = $3`,
    now, reason, row.sessionId,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_shop_grants"
     SET "status" = 'REVOKED', "revoked_at" = COALESCE("revoked_at", $1),
         "revoked_reason" = COALESCE(
           "revoked_reason", $2::"ExtensionDeviceRevocationReason"
         )
     WHERE "session_id" = $3 AND "status" = 'ACTIVE'`,
    now, reason, row.sessionId,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_assignment_grants"
     SET "status" = 'REVOKED', "revoked_at" = COALESCE("revoked_at", $1),
         "revoked_reason" = COALESCE(
           "revoked_reason", $2::"ExtensionDeviceRevocationReason"
         ), "updated_at" = $1
     WHERE "session_id" = $3 AND "status" = 'ACTIVE'`,
    now, reason, row.sessionId,
  );
  await recordSecurityEvent(tx, {
    sessionId: row.sessionId,
    refreshFamilyId: row.familyId,
    actorUserId: options.actorUserId || null,
    type: 'SESSION_REVOKED',
    reasonCode: reason,
    now,
  });
  if (options.reuseDetected) {
    await recordSecurityEvent(tx, {
      sessionId: row.sessionId,
      refreshFamilyId: row.familyId,
      actorUserId: null,
      type: 'REFRESH_REUSE_DETECTED',
      reasonCode: 'REFRESH_REUSE_DETECTED',
      now,
    });
  }
}

export async function revokeExtensionDeviceSessionsForUserInTransaction(
  tx: SqlTransaction,
  userId: string,
  reason: ExtensionDeviceRevocationReason,
  now = new Date(),
): Promise<number> {
  const sessions = await tx.$queryRawUnsafe<Array<{ sessionId: string; familyId: string }>>(
    `SELECT s."id" AS "sessionId", f."id" AS "familyId"
     FROM "extension_device_sessions" s
     JOIN "extension_device_refresh_families" f ON f."session_id" = s."id"
     WHERE (s."owner_user_id" = $1 OR s."actor_user_id" = $1) AND s."status" = 'ACTIVE'
     FOR UPDATE OF s, f`,
    userId,
  );
  for (const session of sessions) {
    await revokeRefreshFamily(tx, session, reason, now);
  }
  return sessions.length;
}

export function createPrismaExtensionDeviceSessionRepository(options: {
  client?: PrismaClient | SqlClient;
  consumePairingClaimAttemptBudget?: ClaimAttemptLimiter;
} = {}): PrismaExtensionDeviceSessionRepository {
  const client = (options.client || prisma) as unknown as SqlClient;
  const consumePairingClaimAttemptBudget = options.consumePairingClaimAttemptBudget
    || createExtensionDeviceClaimAttemptLimiter(redis);

  return {
    consumePairingClaimAttemptBudget,

    async countOutstandingPairingCodes(ownerUserId, now) {
      const rows = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS "count" FROM "extension_device_pairing_codes"
         WHERE "owner_user_id" = $1 AND "status" = 'PENDING' AND "expires_at" > $2`,
        ownerUserId, now,
      );
      return Number(rows[0]?.count || 0);
    },

    async shopsBelongToOwner(ownerUserId, shopIds) {
      const rows = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS "count" FROM "shops"
         WHERE "user_id" = $1 AND "id" = ANY($2::text[])`,
        ownerUserId, shopIds,
      );
      return Number(rows[0]?.count || 0) === shopIds.length;
    },

    async createPairingCode(input) {
      return runSerializableTransaction(client, async (tx) => {
        const owner = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          'SELECT "id" FROM "users" WHERE "id" = $1 FOR UPDATE',
          input.ownerUserId,
        );
        if (!owner[0]) return { kind: 'limit' as const };
        const counts = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT COUNT(*) AS "count" FROM "extension_device_pairing_codes"
           WHERE "owner_user_id" = $1 AND "status" = 'PENDING' AND "expires_at" > $2`,
          input.ownerUserId, input.createdAt,
        );
        if (Number(counts[0]?.count || 0) >= 5) return { kind: 'limit' as const };

        if (input.resumeSessionId && !await loadExplicitResumeSession(tx, {
          resumeSessionId: input.resumeSessionId,
          deploymentId: input.deploymentId,
          actorUserId: input.actorUserId,
          ownerUserId: input.ownerUserId,
          shopIds: input.shopIds,
          now: input.createdAt,
        })) {
          return { kind: 'invalid_resume' as const };
        }

        const id = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO "extension_device_pairing_codes"
            ("id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest", "shop_ids",
             "scopes", "device_label", "resume_session_id", "status", "expires_at", "created_at", "updated_at")
            VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8, $9, 'PENDING', $10, $11, $11)`,
          id, input.deploymentId, input.actorUserId, input.ownerUserId, input.codeDigest,
          input.shopIds, input.scopes, input.deviceLabel, input.resumeSessionId,
          input.expiresAt, input.createdAt,
        );
        return { kind: 'created' as const, id };
      });
    },

    async claimPairingCodeAtomically(input) {
      return runSerializableTransaction(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<PairingRow[]>(
          `SELECT p."id", p."actor_user_id" AS "actorUserId", p."owner_user_id" AS "ownerUserId",
                  p."status"::text AS "status", p."shop_ids" AS "shopIds", p."scopes",
                  p."resume_session_id" AS "resumeSessionId",
                  p."expires_at" AS "expiresAt", owner."status"::text AS "ownerStatus",
                  actor."status"::text AS "actorStatus", owner."role"::text AS "ownerRole",
                  actor."role"::text AS "actorRole", actor."parent_id" AS "actorParentId"
           FROM "extension_device_pairing_codes" p
           JOIN "users" owner ON owner."id" = p."owner_user_id"
           JOIN "users" actor ON actor."id" = p."actor_user_id"
           WHERE p."code_digest" = $1 AND p."deployment_id" = $2
           FOR UPDATE OF p`,
          input.codeDigest, input.deploymentId,
        );
        const pairing = rows[0];
        if (!pairing
          || pairing.status !== 'PENDING'
          || pairing.expiresAt.getTime() <= input.now.getTime()
          || !activeAccountStatus(pairing.ownerStatus)
          || !activeAccountStatus(pairing.actorStatus)
          || !['USER', 'ADMIN'].includes(pairing.ownerRole)
          || !['USER', 'ADMIN'].includes(pairing.actorRole)
          || pairing.actorParentId !== null
          || pairing.actorUserId !== pairing.ownerUserId) {
          return { kind: 'invalid' as const };
        }

        const ownedShops = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "shops"
           WHERE "user_id" = $1 AND "id" = ANY($2::text[])`,
          pairing.ownerUserId, pairing.shopIds,
        );
        if (ownedShops.length !== pairing.shopIds.length) return { kind: 'invalid' as const };

        const deviceLockKey = JSON.stringify([
          pairing.ownerUserId,
          input.deploymentId,
          input.deviceId,
        ]);
        await tx.$queryRawUnsafe<Array<{ locked: number }>>(
          `WITH device_lock AS (
             SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
           )
           SELECT 1::int AS "locked" FROM device_lock`,
          deviceLockKey,
        );
        let replacesSessionId: string | null = null;
        let replacedSessions: Array<{ sessionId: string; familyId: string }> = [];
        if (pairing.resumeSessionId) {
          const resumed = await loadExplicitResumeSession(tx, {
            resumeSessionId: pairing.resumeSessionId,
            deploymentId: input.deploymentId,
            actorUserId: pairing.actorUserId,
            ownerUserId: pairing.ownerUserId,
            shopIds: pairing.shopIds,
            now: input.now,
            deviceId: input.deviceId,
            requireNoActiveSession: true,
          });
          if (!resumed) return { kind: 'invalid' as const };
          replacesSessionId = resumed.id;
        } else {
          replacedSessions = await tx.$queryRawUnsafe<Array<{
            sessionId: string;
            familyId: string;
          }>>(
            `SELECT s."id" AS "sessionId", f."id" AS "familyId"
             FROM "extension_device_sessions" s
             JOIN "extension_device_refresh_families" f ON f."session_id" = s."id"
             WHERE s."owner_user_id" = $1 AND s."deployment_id" = $2
               AND s."device_id" = $3 AND s."status" = 'ACTIVE'
             FOR UPDATE OF s, f`,
            pairing.ownerUserId, input.deploymentId, input.deviceId,
          );
          for (const session of replacedSessions) {
            await revokeRefreshFamily(tx, session, 'PAIRING_APPROVED', input.now, {
              actorUserId: pairing.actorUserId,
            });
          }
          replacesSessionId = replacedSessions.length === 1
            ? replacedSessions[0]!.sessionId
            : null;
        }

        const consumed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE "extension_device_pairing_codes"
           SET "status" = 'CLAIMED', "claimed_at" = $1, "updated_at" = $1
           WHERE "id" = $2 AND "status" = 'PENDING'
           RETURNING "id"`,
          input.now, pairing.id,
        );
        if (consumed.length !== 1) return { kind: 'invalid' as const };

        await tx.$executeRawUnsafe(
          `INSERT INTO "extension_device_sessions"
            ("id", "pairing_code_id", "deployment_id", "device_id", "device_label",
             "actor_user_id", "owner_user_id", "status", "scopes", "current_jti", "expires_at",
             "replaces_session_id", "last_seen_at", "created_at", "updated_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8::text[], $9, $10, $11, $12, $12, $12)`,
          input.sessionId, pairing.id, input.deploymentId, input.deviceId, input.deviceLabel,
          pairing.actorUserId, pairing.ownerUserId, pairing.scopes, input.currentJti,
          input.sessionExpiresAt, replacesSessionId, input.now,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "extension_device_refresh_families"
            ("id", "session_id", "status", "created_at", "updated_at")
           VALUES ($1, $2, 'ACTIVE', $3, $3)`,
          input.refreshFamilyId, input.sessionId, input.now,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "extension_device_refresh_credentials"
            ("id", "family_id", "generation", "credential_digest", "expires_at", "created_at")
           VALUES ($1, $2, 1, $3, $4, $5)`,
          randomUUID(), input.refreshFamilyId, input.refreshDigest, input.refreshExpiresAt, input.now,
        );
        for (const shopId of pairing.shopIds) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "extension_device_shop_grants"
              ("id", "session_id", "shop_id", "status", "granted_at")
             VALUES ($1, $2, $3, 'ACTIVE', $4)`,
            randomUUID(), input.sessionId, shopId, input.now,
          );
        }
        await recordSecurityEvent(tx, {
          sessionId: input.sessionId,
          refreshFamilyId: input.refreshFamilyId,
          actorUserId: pairing.actorUserId,
          type: 'PAIRING_CLAIMED',
          reasonCode: 'PAIRING_APPROVED',
          now: input.now,
        });

        return {
          kind: 'claimed' as const,
          session: {
            id: input.sessionId,
            deploymentId: input.deploymentId,
            deviceId: input.deviceId,
            actorUserId: pairing.actorUserId,
            ownerUserId: pairing.ownerUserId,
            scopes: pairing.scopes,
            currentJti: input.currentJti,
            expiresAt: input.sessionExpiresAt,
          },
        };
      });
    },

    async rotateRefreshCredentialOrRevokeReuse(input) {
      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe<RefreshRow[]>(
          `SELECT c."id" AS "credentialId", c."generation", c."expires_at" AS "credentialExpiresAt",
                  c."consumed_at" AS "credentialConsumedAt", f."id" AS "familyId",
                  f."status"::text AS "familyStatus", s."id" AS "sessionId",
                  s."status"::text AS "sessionStatus", s."deployment_id" AS "deploymentId",
                  s."device_id" AS "deviceId", s."actor_user_id" AS "actorUserId",
                  s."owner_user_id" AS "ownerUserId", s."scopes", s."current_jti" AS "currentJti",
                  s."expires_at" AS "sessionExpiresAt", owner."status"::text AS "ownerStatus",
                  actor."status"::text AS "actorStatus", owner."role"::text AS "ownerRole",
                  actor."role"::text AS "actorRole", actor."parent_id" AS "actorParentId"
           FROM "extension_device_refresh_credentials" c
           JOIN "extension_device_refresh_families" f ON f."id" = c."family_id"
           JOIN "extension_device_sessions" s ON s."id" = f."session_id"
           JOIN "users" owner ON owner."id" = s."owner_user_id"
           JOIN "users" actor ON actor."id" = s."actor_user_id"
           WHERE c."credential_digest" = $1
           FOR UPDATE OF c, f, s`,
          input.refreshDigest,
        );
        const row = rows[0];
        if (!row) return { kind: 'invalid' as const };
        if (row.credentialConsumedAt) {
          await revokeRefreshFamily(tx, row, 'REFRESH_REUSE_DETECTED', input.now, { reuseDetected: true });
          return { kind: 'reuse_revoked' as const };
        }

        const grantCounts = await tx.$queryRawUnsafe<Array<{ total: bigint; valid: bigint }>>(
          `SELECT COUNT(*) AS "total",
                  COUNT(*) FILTER (WHERE g."status" = 'ACTIVE' AND sh."user_id" = $1) AS "valid"
           FROM "extension_device_shop_grants" g
           LEFT JOIN "shops" sh ON sh."id" = g."shop_id"
           WHERE g."session_id" = $2`,
          row.ownerUserId, row.sessionId,
        );
        const totalGrants = Number(grantCounts[0]?.total || 0);
        const validGrants = Number(grantCounts[0]?.valid || 0);
        if (row.familyStatus !== 'ACTIVE' || row.sessionStatus !== 'ACTIVE') {
          return { kind: 'invalid' as const };
        }
        const revocationReason = resolveExtensionDeviceRefreshRevocationReason({
          credentialExpired: row.credentialExpiresAt.getTime() <= input.now.getTime(),
          sessionExpired: row.sessionExpiresAt.getTime() <= input.now.getTime(),
          familyStatus: row.familyStatus,
          sessionStatus: row.sessionStatus,
          ownerStatus: row.ownerStatus,
          actorStatus: row.actorStatus,
          ownerRole: row.ownerRole,
          actorRole: row.actorRole,
          actorParentId: row.actorParentId,
          actorMatchesOwner: row.actorUserId === row.ownerUserId,
          totalGrants,
          validGrants,
        });
        if (revocationReason) {
          await revokeRefreshFamily(tx, row, revocationReason, input.now);
          return { kind: 'invalid' as const };
        }

        const refreshExpiresAt = new Date(Math.min(
          input.nextRefreshExpiresAt.getTime(),
          row.sessionExpiresAt.getTime(),
        ));
        const nextCredentialId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO "extension_device_refresh_credentials"
            ("id", "family_id", "generation", "credential_digest", "expires_at", "created_at")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          nextCredentialId, row.familyId, row.generation + 1, input.nextRefreshDigest,
          refreshExpiresAt, input.now,
        );
        const consumed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `UPDATE "extension_device_refresh_credentials"
           SET "consumed_at" = $1, "replaced_by_id" = $2
           WHERE "id" = $3 AND "consumed_at" IS NULL AND "replaced_by_id" IS NULL
           RETURNING "id"`,
          input.now, nextCredentialId, row.credentialId,
        );
        if (consumed.length !== 1) {
          throw new Error('REFRESH_ROTATION_CONFLICT');
        }
        await tx.$executeRawUnsafe(
          `UPDATE "extension_device_sessions"
           SET "current_jti" = $1, "last_seen_at" = $2, "updated_at" = $2
           WHERE "id" = $3`,
          input.nextJti, input.now, row.sessionId,
        );
        return { kind: 'rotated' as const, session: snapshotFromRefresh(row, input.nextJti) };
      }, { isolationLevel: 'Serializable' });
    },

    async loadAuthorization(sessionId) {
      const sessions = await client.$queryRawUnsafe<Array<Omit<ExtensionDeviceLiveAuthorization, 'shopGrants'>>>(
        `SELECT s."id" AS "sessionId", s."status"::text AS "status", s."expires_at" AS "expiresAt",
                s."current_jti" AS "currentJti", s."deployment_id" AS "deploymentId",
                s."device_id" AS "deviceId", s."owner_user_id" AS "ownerUserId",
                s."actor_user_id" AS "actorUserId", s."scopes",
                owner."status"::text AS "ownerStatus", actor."status"::text AS "actorStatus",
                owner."role"::text AS "ownerRole", actor."role"::text AS "actorRole",
                actor."parent_id" AS "actorParentId"
         FROM "extension_device_sessions" s
         JOIN "users" owner ON owner."id" = s."owner_user_id"
         JOIN "users" actor ON actor."id" = s."actor_user_id"
         WHERE s."id" = $1`,
        sessionId,
      );
      const session = sessions[0];
      if (!session) return null;
      const shopGrants = await client.$queryRawUnsafe<Array<{ shopId: string; status: string }>>(
        `SELECT g."shop_id" AS "shopId",
                CASE WHEN g."status" = 'ACTIVE' AND sh."user_id" = $2
                     THEN 'ACTIVE' ELSE 'REVOKED' END AS "status"
         FROM "extension_device_shop_grants" g
         LEFT JOIN "shops" sh ON sh."id" = g."shop_id"
         WHERE g."session_id" = $1
         ORDER BY g."shop_id" ASC`,
        sessionId, session.ownerUserId,
      );
      return { ...session, shopGrants };
    },

    async cancelPairingCode(input) {
      if (input.actorUserId !== input.ownerUserId) return false;
      const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "extension_device_pairing_codes"
         SET "status" = 'CANCELED', "canceled_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $1 AND "owner_user_id" = $2 AND "status" = 'PENDING'
         RETURNING "id"`,
        input.pairingCodeId, input.ownerUserId,
      );
      return rows.length === 1;
    },

    async listSessions(ownerUserId) {
      const sessions = await client.$queryRawUnsafe<Array<Omit<ExtensionDeviceManagementSession, 'shopIds'>>>(
        `SELECT "id", "device_id" AS "deviceId", "device_label" AS "deviceLabel",
                "status"::text AS "status", "scopes", "expires_at" AS "expiresAt",
                "last_seen_at" AS "lastSeenAt", "created_at" AS "createdAt"
         FROM "extension_device_sessions"
         WHERE "owner_user_id" = $1
         ORDER BY "created_at" DESC`,
        ownerUserId,
      );
      if (!sessions.length) return [];
      const grants = await client.$queryRawUnsafe<Array<{ sessionId: string; shopId: string }>>(
        `SELECT "session_id" AS "sessionId", "shop_id" AS "shopId"
         FROM "extension_device_shop_grants"
         WHERE "session_id" = ANY($1::text[]) AND "status" = 'ACTIVE'
         ORDER BY "shop_id" ASC`,
        sessions.map(({ id }) => id),
      );
      return sessions.map((session) => ({
        ...session,
        shopIds: grants.filter(({ sessionId: id }) => id === session.id).map(({ shopId }) => shopId),
      }));
    },

    async revokeSession(input) {
      if (input.actorUserId !== input.ownerUserId) return false;
      const now = new Date();
      return client.$transaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{ sessionId: string; familyId: string }>>(
          `SELECT s."id" AS "sessionId", f."id" AS "familyId"
           FROM "extension_device_sessions" s
           JOIN "extension_device_refresh_families" f ON f."session_id" = s."id"
           WHERE s."id" = $1 AND s."owner_user_id" = $2 AND s."status" = 'ACTIVE'
           FOR UPDATE OF s, f`,
          input.sessionId, input.ownerUserId,
        );
        const row = rows[0];
        if (!row) return false;
        await revokeRefreshFamily(tx, row, input.reason, now, {
          actorUserId: input.actorUserId,
        });
        return true;
      }, { isolationLevel: 'Serializable' });
    },

    async revokeSessionsForUser(userId, reason) {
      return client.$transaction(
        (tx) => revokeExtensionDeviceSessionsForUserInTransaction(tx, userId, reason),
        { isolationLevel: 'Serializable' },
      );
    },
  };
}

export async function revokeExtensionDeviceSessionsForUser(
  userId: string,
  reason: ExtensionDeviceRevocationReason,
): Promise<number> {
  return createPrismaExtensionDeviceSessionRepository().revokeSessionsForUser(userId, reason);
}
