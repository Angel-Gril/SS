import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type {
  LogisticsRuleAssignmentDiscovery,
  LogisticsRuleDeviceRepository,
} from '../routes/logistics-rules.js';

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

interface EffectiveRow extends Omit<LogisticsRuleAssignmentDiscovery, 'effectiveReleaseAvailable'> {
  scopeKey: string;
  releaseId: string;
  contentChecksum: string;
  effectiveChecksum: string;
  frozenPayload: unknown;
  validationValidUntil: Date | string;
  sessionExpiresAt: Date | string;
}

interface AuthorizationRow {
  assignmentId: string;
  shopId: string;
  scopeKey: string;
  sessionExpiresAt: Date | string;
}

interface ReceiptRow {
  id: string;
  idempotencyKey: string;
  sessionId: string;
  assignmentId: string;
  releaseId: string;
  effectiveChecksum: string;
  status: string;
  failureCode: string | null;
  extensionVersion: string;
  appliedAt: Date | string | null;
}

const MAX_AUTHORIZATION_LEASE_MS = 24 * 60 * 60 * 1000;
const STALE_GRACE_MS = 24 * 60 * 60 * 1000;
const FIXED_FAILURE_CODES = new Set([
  'checksum_mismatch',
  'schema_unsupported',
  'storage_quota',
  'scope_mismatch',
  'apply_failed',
]);

const ACTIVE_LOGISTICS_SCOPE_STATUSES_SQL = "('ACTIVE', 'CREATED', 'WORKING')";
const LIVE_RELEASE_DELIVERY_METHODS_SQL = `
  jsonb_typeof(r."frozen_payload"->'deliveryMethodBindings') = 'array'
  AND jsonb_array_length(r."frozen_payload"->'deliveryMethodBindings') > 0
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(r."frozen_payload"->'deliveryMethodBindings') AS frozen_binding(payload)
    WHERE NOT EXISTS (
      SELECT 1
      FROM "shop_delivery_method_rule_bindings" binding
      JOIN "shop_delivery_methods" dm
        ON dm."id" = binding."delivery_method_id"
       AND dm."warehouse_id" = a."warehouse_id"
       AND UPPER(BTRIM(COALESCE(dm."status", ''))) IN ${ACTIVE_LOGISTICS_SCOPE_STATUSES_SQL}
      WHERE binding."id" = frozen_binding.payload->>'id'
        AND binding."delivery_method_id" = frozen_binding.payload->>'deliveryMethodId'
        AND binding."tenant_id" = a."tenant_id"
        AND binding."shop_id" = a."shop_id"
        AND binding."warehouse_id" = a."warehouse_id"
        AND binding."source_revision_id" = r."revision_id"
        AND binding."status" = 'CONFIRMED'
        AND binding."retired_at" IS NULL
    )
  )`;

const EFFECTIVE_RELEASE_AVAILABLE_SQL = `(r."id" IS NOT NULL
  AND r."validation_valid_until" + INTERVAL '24 hours' > CURRENT_TIMESTAMP
  AND (${LIVE_RELEASE_DELIVERY_METHODS_SQL}))`;
const FIRST_RELEASE_PENDING_SQL = `(c."current_release_id" IS NULL AND c."current_sequence" = 0)`;

const ACTIVE_ASSIGNMENT_SCOPE_JOINS = `
  FROM "extension_device_sessions" s
  JOIN "users" owner ON owner."id" = s."owner_user_id" AND owner."status" = 'ACTIVE'
  JOIN "extension_device_shop_grants" sg
    ON sg."session_id" = s."id" AND sg."status" = 'ACTIVE'
  JOIN "logistics_rule_assignments" a
    ON a."shop_id" = sg."shop_id" AND a."retired_at" IS NULL
  JOIN "shops" sh ON sh."id" = a."shop_id" AND sh."user_id" = s."owner_user_id" AND sh."status" = 'ACTIVE'
  JOIN "warehouses" w
    ON w."id" = a."warehouse_id"
   AND w."shop_id" = a."shop_id"
   AND UPPER(BTRIM(COALESCE(w."status", ''))) IN ${ACTIVE_LOGISTICS_SCOPE_STATUSES_SQL}
  JOIN "logistics_rule_channels" c
    ON c."id" = a."channel_id"
   AND c."tenant_id" = a."tenant_id"
   AND c."shop_id" = a."shop_id"
   AND c."warehouse_id" = a."warehouse_id"
   AND c."retired_at" IS NULL
   AND c."deployment_id" = s."deployment_id"
   AND c."schema_major" = 1
  JOIN "shop_ozon_company_bindings" cb
    ON cb."id" = c."company_binding_id"
   AND cb."tenant_id" = a."tenant_id"
   AND cb."shop_id" = a."shop_id"
   AND cb."ozon_company_id" = c."ozon_company_id"
   AND cb."status" = 'VERIFIED'
   AND cb."invalidated_at" IS NULL
   AND cb."retired_at" IS NULL
  JOIN "warehouse_ozon_origin_bindings" ob
    ON ob."id" = c."origin_binding_id"
   AND ob."tenant_id" = a."tenant_id"
   AND ob."shop_id" = a."shop_id"
   AND ob."warehouse_id" = a."warehouse_id"
   AND ob."origin_country_uid" = c."origin_country_uid"
   AND ob."origin_city_uid" = c."origin_city_uid"
   AND ob."status" = 'VERIFIED'
   AND ob."invalidated_at" IS NULL
   AND ob."retired_at" IS NULL`;

const ACTIVE_ASSIGNMENT_JOINS = `
  ${ACTIVE_ASSIGNMENT_SCOPE_JOINS}
  JOIN "logistics_rule_releases" r
    ON r."id" = c."current_release_id"
   AND r."channel_id" = c."id"
   AND r."sequence" = c."current_sequence"
   AND (${LIVE_RELEASE_DELIVERY_METHODS_SQL})`;

const KNOWN_SCOPE_LIFECYCLE_JOINS = `
  LEFT JOIN "shops" sh ON sh."id" = a."shop_id"
  LEFT JOIN "warehouses" w ON w."id" = a."warehouse_id"
  LEFT JOIN "extension_device_shop_grants" sg
    ON sg."session_id" = s."id" AND sg."shop_id" = a."shop_id"
  LEFT JOIN "logistics_rule_channels" c ON c."id" = a."channel_id"
  LEFT JOIN "shop_ozon_company_bindings" cb ON cb."id" = c."company_binding_id"
  LEFT JOIN "warehouse_ozon_origin_bindings" ob ON ob."id" = c."origin_binding_id"
  LEFT JOIN "logistics_rule_releases" r
    ON r."id" = c."current_release_id"
   AND r."channel_id" = c."id"
   AND r."sequence" = c."current_sequence"`;

const KNOWN_SCOPE_LIFECYCLE_REASON_SQL = `CASE
  WHEN a."retired_at" IS NOT NULL THEN 'ASSIGNMENT_RETIRED'
  WHEN sh."user_id" IS DISTINCT FROM s."owner_user_id" THEN 'SHOP_TRANSFERRED'
  WHEN sg."id" IS NULL OR sg."status"::text <> 'ACTIVE' THEN 'SHOP_UNLINKED'
  WHEN sh."status"::text IS DISTINCT FROM 'ACTIVE' THEN 'SCOPE_REVOKED'
  WHEN w."id" IS NULL
    OR w."shop_id" IS DISTINCT FROM a."shop_id"
    OR UPPER(BTRIM(COALESCE(w."status", ''))) NOT IN ${ACTIVE_LOGISTICS_SCOPE_STATUSES_SQL}
    THEN 'WAREHOUSE_RETIRED'
  WHEN c."id" IS NULL
    OR c."tenant_id" IS DISTINCT FROM a."tenant_id"
    OR c."shop_id" IS DISTINCT FROM a."shop_id"
    OR c."warehouse_id" IS DISTINCT FROM a."warehouse_id"
    OR c."retired_at" IS NOT NULL
    OR c."deployment_id" IS DISTINCT FROM s."deployment_id"
    OR c."schema_major" IS DISTINCT FROM 1
    OR cb."id" IS NULL
    OR cb."tenant_id" IS DISTINCT FROM a."tenant_id"
    OR cb."shop_id" IS DISTINCT FROM a."shop_id"
    OR cb."ozon_company_id" IS DISTINCT FROM c."ozon_company_id"
    OR cb."status"::text <> 'VERIFIED'
    OR cb."invalidated_at" IS NOT NULL
    OR cb."retired_at" IS NOT NULL
    OR ob."id" IS NULL
    OR ob."tenant_id" IS DISTINCT FROM a."tenant_id"
    OR ob."shop_id" IS DISTINCT FROM a."shop_id"
    OR ob."warehouse_id" IS DISTINCT FROM a."warehouse_id"
    OR ob."origin_country_uid" IS DISTINCT FROM c."origin_country_uid"
    OR ob."origin_city_uid" IS DISTINCT FROM c."origin_city_uid"
    OR ob."status"::text <> 'VERIFIED'
    OR ob."invalidated_at" IS NOT NULL
    OR ob."retired_at" IS NOT NULL
    OR r."id" IS NULL
    OR NOT (${LIVE_RELEASE_DELIVERY_METHODS_SQL})
    THEN 'SCOPE_REVOKED'
  ELSE NULL
END`;

const KNOWN_SCOPE_LIFECYCLE_REASONS = new Set([
  'ASSIGNMENT_RETIRED',
  'SHOP_TRANSFERRED',
  'SHOP_UNLINKED',
  'WAREHOUSE_RETIRED',
  'SCOPE_REVOKED',
]);

export class LogisticsRuleDeviceRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'LogisticsRuleDeviceRepositoryError';
  }
}

class RetryableReceiptRace extends Error {}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof RetryableReceiptRace) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  return (
    candidate.code === 'P2034' ||
    candidate.code === '40001' ||
    candidate.meta?.code === '40001' ||
    (typeof candidate.message === 'string' && candidate.message.includes('could not serialize'))
  );
}

async function serializable<T>(
  client: SqlClient,
  operation: (tx: SqlTransaction) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === 2) throw error;
    }
  }
  throw lastError;
}

function asDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new LogisticsRuleDeviceRepositoryError(
      'INVALID_RELEASE_PAYLOAD',
      `${label} is invalid`,
      500,
    );
  }
  return date;
}

function asFrozenBundle(value: unknown): {
  bundle: Record<string, unknown>;
  minimumExtensionVersion: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LogisticsRuleDeviceRepositoryError(
      'INVALID_RELEASE_PAYLOAD',
      'Current logistics release has no frozen object payload',
      500,
    );
  }
  const bundle = value as Record<string, unknown>;
  const manifest = bundle.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new LogisticsRuleDeviceRepositoryError(
      'INVALID_RELEASE_PAYLOAD',
      'Current logistics release has no frozen manifest',
      500,
    );
  }
  const minimumExtensionVersion = (manifest as Record<string, unknown>).minimumExtensionVersion;
  if (
    typeof minimumExtensionVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(minimumExtensionVersion)
  ) {
    throw new LogisticsRuleDeviceRepositoryError(
      'INVALID_RELEASE_PAYLOAD',
      'Current logistics release has no valid minimum extension version',
      500,
    );
  }
  return { bundle: structuredClone(bundle), minimumExtensionVersion };
}

function scopeKeyHash(scopeKey: string): string {
  return createHash('sha256').update(scopeKey).digest('hex');
}

function publicRevocationReason(reason: string | null): string {
  switch (reason) {
    case 'ASSIGNMENT_RETIRED':
      return 'assignment_retired';
    case 'SHOP_TRANSFERRED':
      return 'shop_transferred';
    case 'SHOP_UNLINKED':
      return 'shop_unlinked';
    case 'WAREHOUSE_RETIRED':
      return 'warehouse_retired';
    default:
      return 'scope_revoked';
  }
}

async function resolveKnownScopeRevocation(
  tx: SqlTransaction,
  input: { sessionId: string; ownerUserId: string; assignmentId: string; now: Date },
) {
  const rows = await tx.$queryRawUnsafe<
    Array<{
      status: string;
      firstDeliveredAt: Date | null;
      revokedReason: string | null;
      lifecycleReason: string | null;
    }>
  >(
    `/* resolve known-scope revocation */
     SELECT g."status"::text AS "status", g."first_delivered_at" AS "firstDeliveredAt",
            g."revoked_reason"::text AS "revokedReason",
            ${KNOWN_SCOPE_LIFECYCLE_REASON_SQL} AS "lifecycleReason"
     FROM "extension_device_assignment_grants" g
     JOIN "extension_device_sessions" s ON s."id" = g."session_id"
     JOIN "logistics_rule_assignments" a
       ON a."id" = g."assignment_id" AND a."shop_id" = g."shop_id"
     ${KNOWN_SCOPE_LIFECYCLE_JOINS}
     WHERE g."session_id" = $1 AND g."assignment_id" = $2
       AND g."first_delivered_at" IS NOT NULL
       AND s."owner_user_id" = $3 AND s."status" = 'ACTIVE' AND s."expires_at" > $4
     LIMIT 1
     FOR UPDATE OF g`,
    input.sessionId,
    input.assignmentId,
    input.ownerUserId,
    input.now,
  );
  const row = rows[0];
  if (!row) return { state: 'not_found' as const };
  if (row.status === 'REVOKED') {
    return {
      state: 'gone' as const,
      assignmentId: input.assignmentId,
      reasonCode: publicRevocationReason(row.revokedReason),
    };
  }
  if (
    row.status !== 'ACTIVE' ||
    !row.lifecycleReason ||
    !KNOWN_SCOPE_LIFECYCLE_REASONS.has(row.lifecycleReason)
  ) {
    return { state: 'not_found' as const };
  }

  const tombstones = await tx.$queryRawUnsafe<Array<{ revokedReason: string }>>(
    `/* tombstone known-scope revocation */
     UPDATE "extension_device_assignment_grants" g
     SET "status" = 'REVOKED',
         "revoked_at" = $5,
         "revoked_reason" = $4::"ExtensionDeviceRevocationReason",
         "updated_at" = $5
     FROM "extension_device_sessions" s
     WHERE g."session_id" = $1 AND g."assignment_id" = $2
       AND s."id" = g."session_id" AND s."owner_user_id" = $3
       AND s."status" = 'ACTIVE' AND s."expires_at" > $5
       AND g."status" = 'ACTIVE' AND g."first_delivered_at" IS NOT NULL
     RETURNING g."revoked_reason"::text AS "revokedReason"`,
    input.sessionId,
    input.assignmentId,
    input.ownerUserId,
    row.lifecycleReason,
    input.now,
  );
  const tombstone = tombstones[0];
  return tombstone
    ? {
        state: 'gone' as const,
        assignmentId: input.assignmentId,
        reasonCode: publicRevocationReason(tombstone.revokedReason),
      }
    : { state: 'not_found' as const };
}

function validateReceipt(
  input: Parameters<LogisticsRuleDeviceRepository['recordApplyReceipt']>[0],
): void {
  const fixedStatus = input.status === 'APPLIED' || input.status === 'FAILED';
  const validCommon =
    fixedStatus &&
    input.idempotencyKey.trim().length >= 16 &&
    input.idempotencyKey.trim().length <= 200 &&
    /^[a-f0-9]{64}$/i.test(input.effectiveChecksum) &&
    /^\d+\.\d+\.\d+$/.test(input.extensionVersion);
  const validShape =
    input.status === 'APPLIED'
      ? input.failureCode === null &&
        input.appliedAt instanceof Date &&
        Number.isFinite(input.appliedAt.getTime())
      : typeof input.failureCode === 'string' &&
        FIXED_FAILURE_CODES.has(input.failureCode) &&
        input.appliedAt === null;
  if (!validCommon || !validShape) {
    throw new LogisticsRuleDeviceRepositoryError('INVALID_RECEIPT', 'Invalid apply receipt', 400);
  }
}

export function createPrismaLogisticsRuleDeviceRepository(
  options: {
    client?: PrismaClient | SqlClient;
    authorizationLeaseMs?: number;
  } = {},
): LogisticsRuleDeviceRepository {
  const client = (options.client || prisma) as unknown as SqlClient;
  const configuredLease =
    Number.isFinite(options.authorizationLeaseMs) && Number(options.authorizationLeaseMs) > 0
      ? Math.floor(Number(options.authorizationLeaseMs))
      : MAX_AUTHORIZATION_LEASE_MS;
  const authorizationLeaseMs = Math.min(configuredLease, MAX_AUTHORIZATION_LEASE_MS);

  return {
    async listAssignmentsForDevice(input) {
      if (input.allowedShopIds.length === 0) return [];
      const rows = await client.$queryRawUnsafe<LogisticsRuleAssignmentDiscovery[]>(
        `/* discover assignment scopes */
         SELECT a."id" AS "assignmentId", a."shop_id" AS "shopId", sh."name" AS "shopName",
                c."ozon_company_id" AS "companyId", a."warehouse_id" AS "warehouseId",
                w."name" AS "warehouseName", c."origin_country_uid" AS "originCountryUid",
                c."origin_city_uid" AS "originCityUid", c."origin_label" AS "originLabel",
                a."destination_country_uid" AS "destinationCountryUid",
                a."destination_location_uid" AS "destinationLocationUid",
                a."destination_label" AS "destinationLabel",
                COALESCE(r."sequence", c."current_sequence", 0) AS "releaseSequence",
                ${EFFECTIVE_RELEASE_AVAILABLE_SQL} AS "effectiveReleaseAvailable"
         ${ACTIVE_ASSIGNMENT_SCOPE_JOINS}
         LEFT JOIN "logistics_rule_releases" r
           ON r."id" = c."current_release_id"
          AND r."channel_id" = c."id"
          AND r."sequence" = c."current_sequence"
         WHERE s."id" = $1 AND s."owner_user_id" = $2 AND s."status" = 'ACTIVE'
           AND s."expires_at" > CURRENT_TIMESTAMP
           AND a."tenant_id" = s."owner_user_id"
           AND (${EFFECTIVE_RELEASE_AVAILABLE_SQL} OR ${FIRST_RELEASE_PENDING_SQL})
         ORDER BY a."shop_id" ASC, a."id" ASC`,
        input.sessionId,
        input.ownerUserId,
      );
      const allowed = new Set(input.allowedShopIds);
      return rows
        .filter((row) => allowed.has(row.shopId))
        .map((row) => ({
          assignmentId: row.assignmentId,
          shopId: row.shopId,
          shopName: row.shopName,
          companyId: row.companyId,
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          originCountryUid: row.originCountryUid,
          originCityUid: row.originCityUid,
          originLabel: row.originLabel,
          destinationCountryUid: row.destinationCountryUid,
          destinationLocationUid: row.destinationLocationUid,
          destinationLabel: row.destinationLabel,
          releaseSequence: Number(row.releaseSequence),
          effectiveReleaseAvailable: row.effectiveReleaseAvailable === true,
        }));
    },

    async getEffectiveReleaseForDevice(input) {
      const rows = await client.$queryRawUnsafe<EffectiveRow[]>(
        `SELECT a."id" AS "assignmentId", a."shop_id" AS "shopId", sh."name" AS "shopName",
                c."ozon_company_id" AS "companyId", a."warehouse_id" AS "warehouseId",
                w."name" AS "warehouseName", c."origin_country_uid" AS "originCountryUid",
                c."origin_city_uid" AS "originCityUid", c."origin_label" AS "originLabel",
                a."destination_country_uid" AS "destinationCountryUid",
                a."destination_location_uid" AS "destinationLocationUid",
                a."destination_label" AS "destinationLabel", r."sequence" AS "releaseSequence",
                c."scope_key" AS "scopeKey", r."id" AS "releaseId",
                r."content_checksum" AS "contentChecksum", r."effective_checksum" AS "effectiveChecksum",
                r."frozen_payload" AS "frozenPayload",
                r."validation_valid_until" AS "validationValidUntil",
                s."expires_at" AS "sessionExpiresAt"
         ${ACTIVE_ASSIGNMENT_JOINS}
         WHERE s."id" = $1 AND s."owner_user_id" = $2 AND a."id" = $3
           AND s."status" = 'ACTIVE' AND s."expires_at" > $4
           AND a."tenant_id" = s."owner_user_id"
           AND r."validation_valid_until" + INTERVAL '24 hours' > $4`,
        input.sessionId,
        input.ownerUserId,
        input.assignmentId,
        input.now,
      );
      const row = rows[0];
      if (!row || !input.allowedShopIds.includes(row.shopId)) {
        return serializable(client, (tx) => resolveKnownScopeRevocation(tx, input));
      }

      const { bundle, minimumExtensionVersion } = asFrozenBundle(row.frozenPayload);
      const validUntil = asDate(row.validationValidUntil, 'validationValidUntil');
      return {
        state: 'allowed' as const,
        assignmentId: row.assignmentId,
        scopeKey: row.scopeKey,
        releaseId: row.releaseId,
        releaseSequence: Number(row.releaseSequence),
        contentChecksum: row.contentChecksum,
        effectiveChecksum: row.effectiveChecksum,
        minExtensionVersion: minimumExtensionVersion,
        validUntil: validUntil.toISOString(),
        staleUntil: new Date(validUntil.getTime() + STALE_GRACE_MS).toISOString(),
        bundle,
      };
    },

    async authorizeEffectiveReleaseDelivery(input) {
      return serializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<AuthorizationRow[]>(
          `/* authorize delivery */
           SELECT a."id" AS "assignmentId", a."shop_id" AS "shopId",
                  c."scope_key" AS "scopeKey", s."expires_at" AS "sessionExpiresAt"
           ${ACTIVE_ASSIGNMENT_JOINS}
           WHERE s."id" = $1 AND s."owner_user_id" = $2 AND a."id" = $3
             AND r."id" = $4 AND r."effective_checksum" = $5 AND c."scope_key" = $6
             AND s."status" = 'ACTIVE' AND s."expires_at" > $7
             AND a."tenant_id" = s."owner_user_id"
             AND r."validation_valid_until" + INTERVAL '24 hours' > $7`,
          input.sessionId,
          input.ownerUserId,
          input.assignmentId,
          input.releaseId,
          input.effectiveChecksum.toLowerCase(),
          input.scopeKey,
          input.now,
        );
        const row = rows[0];
        if (!row || !input.allowedShopIds.includes(row.shopId)) {
          return resolveKnownScopeRevocation(tx, input);
        }

        const grantRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `INSERT INTO "extension_device_assignment_grants"
            ("id", "session_id", "assignment_id", "shop_id", "scope_key_hash", "status",
             "first_delivered_at", "last_authorized_at", "created_at", "updated_at")
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $6, $6, $6)
           ON CONFLICT ("session_id", "assignment_id") DO UPDATE
             SET "first_delivered_at" = COALESCE(
                   "extension_device_assignment_grants"."first_delivered_at",
                   EXCLUDED."first_delivered_at"
                 ),
                 "last_authorized_at" = EXCLUDED."last_authorized_at",
                 "updated_at" = EXCLUDED."updated_at"
             WHERE "extension_device_assignment_grants"."status" = 'ACTIVE'
               AND "extension_device_assignment_grants"."shop_id" = EXCLUDED."shop_id"
               AND "extension_device_assignment_grants"."scope_key_hash" = EXCLUDED."scope_key_hash"
           RETURNING "id"`,
          randomUUID(),
          input.sessionId,
          input.assignmentId,
          row.shopId,
          scopeKeyHash(row.scopeKey),
          input.now,
        );
        if (!grantRows[0]) return resolveKnownScopeRevocation(tx, input);

        const sessionExpiresAt = asDate(row.sessionExpiresAt, 'sessionExpiresAt');
        const authorizationValidUntil = new Date(
          Math.min(input.now.getTime() + authorizationLeaseMs, sessionExpiresAt.getTime()),
        );
        return {
          state: 'allowed' as const,
          authorizationValidUntil: authorizationValidUntil.toISOString(),
        };
      });
    },

    async recordApplyReceipt(input) {
      validateReceipt(input);
      const normalized = {
        ...input,
        idempotencyKey: input.idempotencyKey.trim(),
        effectiveChecksum: input.effectiveChecksum.toLowerCase(),
      };
      return serializable(client, async (tx) => {
        const authorized = await tx.$queryRawUnsafe<
          Array<{
            grantId: string;
            shopId: string;
            scopeKey: string;
            scopeKeyHash: string;
          }>
        >(
          `SELECT g."id" AS "grantId", a."shop_id" AS "shopId", c."scope_key" AS "scopeKey",
                  g."scope_key_hash" AS "scopeKeyHash"
           FROM "extension_device_assignment_grants" g
           JOIN "extension_device_sessions" s ON s."id" = g."session_id"
           JOIN "users" owner ON owner."id" = s."owner_user_id" AND owner."status" = 'ACTIVE'
           JOIN "extension_device_shop_grants" sg
             ON sg."session_id" = s."id" AND sg."shop_id" = g."shop_id" AND sg."status" = 'ACTIVE'
           JOIN "logistics_rule_assignments" a
             ON a."id" = g."assignment_id" AND a."shop_id" = g."shop_id" AND a."retired_at" IS NULL
           JOIN "shops" sh ON sh."id" = a."shop_id" AND sh."user_id" = s."owner_user_id"
           JOIN "logistics_rule_channels" c
             ON c."id" = a."channel_id" AND c."tenant_id" = a."tenant_id"
            AND c."shop_id" = a."shop_id" AND c."warehouse_id" = a."warehouse_id"
            AND c."retired_at" IS NULL
            AND c."deployment_id" = s."deployment_id"
            AND c."schema_major" = 1
           JOIN "shop_ozon_company_bindings" cb
             ON cb."id" = c."company_binding_id" AND cb."status" = 'VERIFIED'
            AND cb."invalidated_at" IS NULL AND cb."retired_at" IS NULL
           JOIN "warehouse_ozon_origin_bindings" ob
             ON ob."id" = c."origin_binding_id" AND ob."status" = 'VERIFIED'
            AND ob."invalidated_at" IS NULL AND ob."retired_at" IS NULL
           JOIN "logistics_rule_releases" r
             ON r."id" = $4 AND r."channel_id" = a."channel_id" AND r."effective_checksum" = $5
           WHERE g."session_id" = $1 AND g."assignment_id" = $3 AND g."status" = 'ACTIVE'
             AND s."owner_user_id" = $2 AND s."status" = 'ACTIVE' AND s."expires_at" > $6
             AND a."tenant_id" = s."owner_user_id"`,
          normalized.sessionId,
          normalized.ownerUserId,
          normalized.assignmentId,
          normalized.releaseId,
          normalized.effectiveChecksum,
          normalized.now,
        );
        const access = authorized[0];
        if (
          !access ||
          !normalized.allowedShopIds.includes(access.shopId) ||
          access.scopeKeyHash !== scopeKeyHash(access.scopeKey)
        ) {
          throw new LogisticsRuleDeviceRepositoryError(
            'RECEIPT_NOT_AUTHORIZED',
            'Apply receipt target is unavailable',
            404,
          );
        }

        const receiptId = randomUUID();
        const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `INSERT INTO "logistics_rule_release_acks"
            ("id", "idempotency_key", "session_id", "assignment_id", "release_id",
             "effective_checksum", "status", "failure_code", "extension_version", "applied_at", "created_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7::"LogisticsRuleReleaseAckStatus", $8, $9, $10, $11)
           ON CONFLICT DO NOTHING
           RETURNING "id"`,
          receiptId,
          normalized.idempotencyKey,
          normalized.sessionId,
          normalized.assignmentId,
          normalized.releaseId,
          normalized.effectiveChecksum,
          normalized.status,
          normalized.failureCode,
          normalized.extensionVersion,
          normalized.appliedAt,
          normalized.now,
        );
        if (inserted[0]) {
          if (normalized.status === 'APPLIED') {
            await tx.$executeRawUnsafe(
              `UPDATE "extension_device_assignment_grants"
               SET "last_authorized_at" = $1, "updated_at" = $1
               WHERE "id" = $2 AND "status" = 'ACTIVE'`,
              normalized.now,
              access.grantId,
            );
          }
          return { state: 'accepted' as const, receiptId: inserted[0].id, duplicate: false };
        }

        const existing = await tx.$queryRawUnsafe<ReceiptRow[]>(
          `SELECT "id", "idempotency_key" AS "idempotencyKey", "session_id" AS "sessionId",
                  "assignment_id" AS "assignmentId", "release_id" AS "releaseId",
                  "effective_checksum" AS "effectiveChecksum", "status"::text AS "status",
                  "failure_code" AS "failureCode", "extension_version" AS "extensionVersion",
                  "applied_at" AS "appliedAt"
           FROM "logistics_rule_release_acks"
           WHERE "idempotency_key" = $1
              OR ("session_id" = $2 AND "assignment_id" = $3
                  AND "release_id" = $4 AND "effective_checksum" = $5)
           ORDER BY CASE WHEN "idempotency_key" = $1 THEN 0 ELSE 1 END
           LIMIT 1`,
          normalized.idempotencyKey,
          normalized.sessionId,
          normalized.assignmentId,
          normalized.releaseId,
          normalized.effectiveChecksum,
        );
        const row = existing[0];
        if (!row) throw new RetryableReceiptRace();
        const sameAppliedAt =
          row.appliedAt === null
            ? normalized.appliedAt === null
            : normalized.appliedAt !== null &&
              asDate(row.appliedAt, 'receipt.appliedAt').getTime() ===
                normalized.appliedAt.getTime();
        const isSame =
          row.idempotencyKey === normalized.idempotencyKey &&
          row.sessionId === normalized.sessionId &&
          row.assignmentId === normalized.assignmentId &&
          row.releaseId === normalized.releaseId &&
          row.effectiveChecksum === normalized.effectiveChecksum &&
          row.status === normalized.status &&
          row.failureCode === normalized.failureCode &&
          row.extensionVersion === normalized.extensionVersion &&
          sameAppliedAt;
        if (!isSame) {
          throw new LogisticsRuleDeviceRepositoryError(
            'RECEIPT_CONFLICT',
            'Idempotency key or release receipt already has another payload',
            409,
          );
        }
        return { state: 'accepted' as const, receiptId: row.id, duplicate: true };
      });
    },
  };
}
