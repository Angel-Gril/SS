import {
  type LogisticsScopeSqlClient,
  sanitizedScopeEvent,
  scopeEventId,
} from './logistics-scope-bootstrap-prisma-common.js';

function mapProbe(row: any) {
  return {
    id: String(row.id),
    bootstrapId: String(row.bootstrapId),
    status: row.status,
    nonceDigest: String(row.nonceDigest),
    issuedEvidenceChecksum: String(row.issuedEvidenceChecksum),
    tenantId: String(row.tenantId),
    shopId: String(row.shopId),
    warehouseId: String(row.warehouseId),
    deliveryMethodId: String(row.deliveryMethodId),
    platformWarehouseId: String(row.platformWarehouseId),
    platformMethodId: Number(row.platformMethodId),
    claimedBySessionId: row.claimedBySessionId ? String(row.claimedBySessionId) : null,
    issuedAt: new Date(row.issuedAt),
    expiresAt: new Date(row.expiresAt),
  };
}

export function createDeviceProbePersistence(client: LogisticsScopeSqlClient) {
  return {
    async listPendingCompanyProbes(input: any) {
      const rows = await client.$queryRawUnsafe<any[]>(
        `SELECT p."id", p."bootstrap_id" AS "bootstrapId", p."status"::text AS "status",
                p."nonce_digest" AS "nonceDigest", b."tenant_id" AS "tenantId",
                p."issued_evidence_checksum" AS "issuedEvidenceChecksum",
                b."shop_id" AS "shopId", b."warehouse_id" AS "warehouseId",
                b."delivery_method_id" AS "deliveryMethodId",
                w."platform_warehouse_id" AS "platformWarehouseId",
                dm."platform_method_id" AS "platformMethodId",
                p."claimed_by_session_id" AS "claimedBySessionId",
                p."issued_at" AS "issuedAt", p."expires_at" AS "expiresAt"
           FROM "logistics_company_probes" p
           JOIN "logistics_scope_bootstraps" b ON b."id" = p."bootstrap_id"
           JOIN "warehouses" w ON w."id" = b."warehouse_id" AND w."shop_id" = b."shop_id"
           JOIN "shop_delivery_methods" dm
             ON dm."id" = b."delivery_method_id" AND dm."warehouse_id" = w."id"
           JOIN "extension_device_sessions" ds
             ON ds."id" = $1 AND ds."owner_user_id" = b."tenant_id"
            AND ds."status" = 'ACTIVE' AND ds."expires_at" > $4
           JOIN "extension_device_shop_grants" sg
             ON sg."session_id" = ds."id" AND sg."shop_id" = b."shop_id"
            AND sg."status" = 'ACTIVE'
          WHERE b."tenant_id" = $2 AND b."shop_id" = ANY($3::text[])
            AND p."issued_evidence_checksum" = b."evidence_checksum"
            AND p."expires_at" > $4
            AND (p."status" = 'ISSUED'
              OR (p."status" = 'CLAIMED' AND p."claimed_by_session_id" = ds."id"))
          ORDER BY p."issued_at"`,
        input.device.sessionId, input.device.ownerUserId,
        input.device.allowedShopIds, input.now,
      );
      return rows.map(mapProbe);
    },

    async claimCompanyProbe(input: any) {
      const rows = await client.$queryRawUnsafe<any[]>(
        `WITH locked AS (
          SELECT p."id", p."status"::text AS "previousStatus",
                 p."claimed_by_session_id" AS "previousSession", p."expires_at",
                 p."issued_evidence_checksum" AS "issuedEvidenceChecksum",
                 b."evidence_checksum" AS "currentEvidenceChecksum",
                 ds."id" AS "sessionId", b."tenant_id", b."shop_id",
                 b."id" AS "bootstrapId"
            FROM "logistics_company_probes" p
            JOIN "logistics_scope_bootstraps" b ON b."id" = p."bootstrap_id"
            JOIN "extension_device_sessions" ds
              ON ds."id" = $3 AND ds."owner_user_id" = $4
             AND ds."owner_user_id" = b."tenant_id"
             AND ds."status" = 'ACTIVE' AND ds."expires_at" > $6
            JOIN "extension_device_shop_grants" sg
              ON sg."session_id" = ds."id" AND sg."shop_id" = b."shop_id"
             AND sg."status" = 'ACTIVE'
           WHERE p."id" = $1 AND p."nonce_digest" = $2
             AND b."shop_id" = ANY($5::text[]) FOR UPDATE OF p, b
        ), decision AS (
          SELECT *, CASE
            WHEN "issuedEvidenceChecksum" IS DISTINCT FROM "currentEvidenceChecksum"
              THEN 'expired'
            WHEN "previousStatus" = 'EXPIRED' THEN 'expired'
            WHEN "expires_at" <= $6 THEN 'expired'
            WHEN "previousStatus" = 'ISSUED' THEN 'claimed'
            WHEN "previousStatus" = 'CLAIMED' AND "previousSession" = "sessionId"
              THEN 'duplicate'
            ELSE 'replayed' END AS outcome,
            CASE
              WHEN "issuedEvidenceChecksum" IS DISTINCT FROM "currentEvidenceChecksum"
                THEN 'OPEN_API_EVIDENCE_CHANGED'
              ELSE 'PROBE_TTL_ELAPSED'
            END AS "expiryReason"
          FROM locked
        ), expired AS (
          UPDATE "logistics_company_probes" p
             SET "status" = 'EXPIRED', "updated_at" = $6
            FROM decision d
           WHERE p."id" = d."id" AND d.outcome = 'expired'
             AND d."previousStatus" <> 'EXPIRED'
          RETURNING p."id"
        ), changed AS (
          UPDATE "logistics_company_probes" p
             SET "status" = 'CLAIMED', "claimed_by_session_id" = d."sessionId",
                 "claimed_at" = $6, "updated_at" = $6
            FROM decision d WHERE p."id" = d."id" AND d.outcome = 'claimed'
          RETURNING p."id"
        ), claimed_event AS (
          INSERT INTO "logistics_scope_events" (
            "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
            "subject_type", "subject_id", "event_type", "device_session_id", "payload"
          )
          SELECT $7, d."tenant_id", d."shop_id", d."bootstrapId", d."id",
                 'COMPANY_PROBE', d."id", 'COMPANY_PROBE_CLAIMED',
                 d."sessionId", $8::jsonb FROM decision d
           WHERE d.outcome = 'claimed' RETURNING "id"
        ), expired_event AS (
          INSERT INTO "logistics_scope_events" (
            "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
            "subject_type", "subject_id", "event_type", "device_session_id", "payload"
          )
          SELECT $9, d."tenant_id", d."shop_id", d."bootstrapId", d."id",
                 'COMPANY_PROBE', d."id", 'COMPANY_PROBE_EXPIRED',
                 d."sessionId", jsonb_build_object('reason', d."expiryReason")
            FROM decision d JOIN expired x ON x."id" = d."id" RETURNING "id"
        )
        SELECT outcome AS "state", outcome = 'duplicate' AS "duplicate" FROM decision`,
        input.probeId, input.nonceDigest, input.device.sessionId,
        input.device.ownerUserId, input.device.allowedShopIds, input.now,
        scopeEventId(), sanitizedScopeEvent({ state: 'CLAIMED' }), scopeEventId(),
      );
      if (!rows[0]) return { state: 'not_found' as const };
      return { state: rows[0].state };
    },

    async submitCompanyProbe(input: any) {
      const evidenceJson = JSON.stringify(input.evidence);
      const rows = await client.$queryRawUnsafe<any[]>(
        `WITH locked AS (
          SELECT p.*, p."status"::text AS "previousStatus",
                 p."issued_evidence_checksum" AS "issuedEvidenceChecksum",
                 b."evidence_checksum" AS "currentEvidenceChecksum",
                 b."tenant_id", b."shop_id", b."id" AS "bootstrapId",
                 w."platform_warehouse_id" AS "platformWarehouseId",
                 dm."platform_method_id" AS "platformMethodId"
            FROM "logistics_company_probes" p
            JOIN "logistics_scope_bootstraps" b ON b."id" = p."bootstrap_id"
            JOIN "warehouses" w
              ON w."id" = b."warehouse_id" AND w."shop_id" = b."shop_id"
            JOIN "shop_delivery_methods" dm
              ON dm."id" = b."delivery_method_id" AND dm."warehouse_id" = w."id"
            JOIN "extension_device_sessions" ds
              ON ds."id" = $3 AND ds."owner_user_id" = $4
             AND ds."owner_user_id" = b."tenant_id"
             AND ds."status" = 'ACTIVE' AND ds."expires_at" > $6
            JOIN "extension_device_shop_grants" sg
              ON sg."session_id" = ds."id" AND sg."shop_id" = b."shop_id"
             AND sg."status" = 'ACTIVE'
           WHERE p."id" = $1 AND p."nonce_digest" = $2
             AND b."shop_id" = ANY($5::text[]) FOR UPDATE OF p, b
        ), decision AS (
          SELECT *, CASE
            WHEN "issuedEvidenceChecksum" IS DISTINCT FROM "currentEvidenceChecksum"
              THEN 'expired'
            WHEN "previousStatus" = 'EXPIRED' THEN 'expired'
            WHEN "claimed_by_session_id" IS DISTINCT FROM $3 THEN 'replayed'
            WHEN "platformWarehouseId" IS DISTINCT FROM $7
              OR "platformMethodId" IS DISTINCT FROM $8 THEN 'mismatch'
            WHEN "previousStatus" = 'CLAIMED' AND "expires_at" > $6 THEN 'submitted'
            WHEN "previousStatus" = 'SUBMITTED'
              AND "submitted_company_id" = $9 AND "submitted_evidence" = $10::jsonb
              THEN 'duplicate'
            WHEN "expires_at" <= $6 AND "previousStatus" IN ('ISSUED', 'CLAIMED')
              THEN 'expired'
            ELSE 'replayed' END AS outcome,
            CASE
              WHEN "issuedEvidenceChecksum" IS DISTINCT FROM "currentEvidenceChecksum"
                THEN 'OPEN_API_EVIDENCE_CHANGED'
              ELSE 'PROBE_TTL_ELAPSED'
            END AS "expiryReason"
          FROM locked
        ), expired AS (
          UPDATE "logistics_company_probes" p
             SET "status" = 'EXPIRED', "updated_at" = $6
            FROM decision d
           WHERE p."id" = d."id" AND d.outcome = 'expired'
             AND d."previousStatus" <> 'EXPIRED'
          RETURNING p."id"
        ), changed AS (
          UPDATE "logistics_company_probes" p
             SET "status" = 'SUBMITTED', "submitted_company_id" = $9,
                 "submitted_evidence" = $10::jsonb, "submitted_at" = $6,
                 "updated_at" = $6
            FROM decision d WHERE p."id" = d."id" AND d.outcome = 'submitted'
          RETURNING p."id"
        ), submitted_event AS (
          INSERT INTO "logistics_scope_events" (
            "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
            "subject_type", "subject_id", "event_type", "device_session_id", "payload"
          )
          SELECT $11, d."tenant_id", d."shop_id", d."bootstrapId", d."id",
                 'COMPANY_PROBE', d."id", 'COMPANY_PROBE_SUBMITTED', $3, $12::jsonb
            FROM decision d WHERE d.outcome = 'submitted' RETURNING "id"
        ), expired_event AS (
          INSERT INTO "logistics_scope_events" (
            "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
            "subject_type", "subject_id", "event_type", "device_session_id", "payload"
          )
          SELECT $13, d."tenant_id", d."shop_id", d."bootstrapId", d."id",
                 'COMPANY_PROBE', d."id", 'COMPANY_PROBE_EXPIRED',
                 $3, jsonb_build_object('reason', d."expiryReason")
            FROM decision d JOIN expired x ON x."id" = d."id" RETURNING "id"
        )
        SELECT outcome AS "state", outcome = 'duplicate' AS "duplicate" FROM decision`,
        input.probeId, input.nonceDigest, input.device.sessionId,
        input.device.ownerUserId, input.device.allowedShopIds, input.now,
        input.evidence.warehouse.platformWarehouseId,
        input.evidence.deliveryMethod.platformMethodId,
        input.evidence.companyId, evidenceJson, scopeEventId(),
        sanitizedScopeEvent({
          companyId: input.evidence.companyId,
          platformWarehouseId: input.evidence.warehouse.platformWarehouseId,
          platformMethodId: input.evidence.deliveryMethod.platformMethodId,
        }),
        scopeEventId(),
      );
      if (!rows[0]) return { state: 'not_found' as const, duplicate: false };
      return { state: rows[0].state, duplicate: Boolean(rows[0].duplicate) };
    },
  };
}
