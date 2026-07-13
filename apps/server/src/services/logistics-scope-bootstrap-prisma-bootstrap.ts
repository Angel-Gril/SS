import type {
  LogisticsOpenApiScope,
  LogisticsScopeBootstrapCandidate,
} from './logistics-scope-bootstrap.js';
import {
  type LogisticsScopeSqlClient,
  jsonValue,
  sanitizedScopeEvent,
  scopeEventId,
  serializable,
  unavailable,
} from './logistics-scope-bootstrap-prisma-common.js';

function mapBootstrap(row: any): LogisticsScopeBootstrapCandidate {
  return {
    id: String(row.id),
    tenantId: String(row.tenantId),
    shopId: String(row.shopId),
    warehouseId: String(row.warehouseId),
    deliveryMethodId: String(row.deliveryMethodId),
    status: row.status,
    evidenceChecksum: String(row.evidenceChecksum),
    openApiEvidence: row.openApiEvidence || {},
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

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

export function createScopeBootstrapPersistence(client: LogisticsScopeSqlClient) {
  return {
    async loadOpenApiScope(input: {
      tenantId: string;
      shopId: string;
      warehouseId: string;
      deliveryMethodId: string;
    }) {
      const rows = await client.$queryRawUnsafe<any[]>(
        `SELECT s."user_id" AS "tenantId", s."id" AS "shopId",
                w."id" AS "warehouseId", dm."id" AS "deliveryMethodId",
                s."platform"::text AS "shopPlatform", s."status"::text AS "shopStatus",
                s."client_id" AS "openApiClientId",
                w."platform_warehouse_id" AS "platformWarehouseId",
                w."name" AS "warehouseName", w."country_code" AS "countryCode",
                w."status" AS "warehouseStatus",
                w."city", w."street", w."zip_code" AS "zipCode",
                w."latitude", w."longitude",
                w."raw_data" AS "warehouseRawData",
                w."updated_at" AS "warehouseSyncedAt",
                dm."platform_method_id" AS "platformMethodId",
                dm."name" AS "deliveryMethodName", dm."provider_id" AS "providerId",
                dm."status" AS "deliveryMethodStatus"
           FROM "shops" s
           JOIN "warehouses" w ON w."shop_id" = s."id"
           JOIN "shop_delivery_methods" dm ON dm."warehouse_id" = w."id"
          WHERE s."user_id" = $1 AND s."id" = $2 AND w."id" = $3 AND dm."id" = $4
            AND s."platform" = 'OZON'`,
        input.tenantId, input.shopId, input.warehouseId, input.deliveryMethodId,
      );
      const row = rows[0];
      if (!row) return null;
      return {
        tenantId: String(row.tenantId),
        shopId: String(row.shopId),
        warehouseId: String(row.warehouseId),
        deliveryMethodId: String(row.deliveryMethodId),
        shopPlatform: String(row.shopPlatform),
        shopStatus: String(row.shopStatus),
        openApiClientId: row.openApiClientId ? String(row.openApiClientId) : null,
        platformWarehouseId: String(row.platformWarehouseId || ''),
        warehouseName: String(row.warehouseName),
        warehouseStatus: row.warehouseStatus == null ? null : String(row.warehouseStatus),
        warehouseRawData: row.warehouseRawData || {},
        warehouseSyncedAt: new Date(row.warehouseSyncedAt),
        warehouseAddress: {
          countryCode: row.countryCode ? String(row.countryCode) : null,
          city: row.city ? String(row.city) : null,
          street: row.street ? String(row.street) : null,
          zipCode: row.zipCode ? String(row.zipCode) : null,
          latitude: row.latitude === null ? null : Number(row.latitude),
          longitude: row.longitude === null ? null : Number(row.longitude),
        },
        platformMethodId: Number(row.platformMethodId),
        deliveryMethodName: String(row.deliveryMethodName),
        deliveryMethodStatus: row.deliveryMethodStatus == null ? null : String(row.deliveryMethodStatus),
        providerId: row.providerId === null ? null : Number(row.providerId),
      } satisfies LogisticsOpenApiScope;
    },

    async upsertBootstrapCandidate(input: any) {
      const rows = await client.$queryRawUnsafe<any[]>(
        `WITH candidate AS (
          INSERT INTO "logistics_scope_bootstraps" (
            "id", "tenant_id", "shop_id", "warehouse_id", "delivery_method_id",
            "status", "open_api_evidence", "evidence_checksum", "created_by_id",
            "created_at", "updated_at"
          ) VALUES ($1, $2, $3, $4, $5, 'CANDIDATE', $6::jsonb, $7, $8, $9, $9)
          ON CONFLICT ("tenant_id", "shop_id", "warehouse_id", "delivery_method_id")
          DO UPDATE SET "open_api_evidence" = EXCLUDED."open_api_evidence",
                        "evidence_checksum" = EXCLUDED."evidence_checksum",
                        "updated_at" = EXCLUDED."updated_at"
          WHERE "logistics_scope_bootstraps"."status" = 'CANDIDATE'
          RETURNING "id", "tenant_id" AS "tenantId", "shop_id" AS "shopId",
                    "warehouse_id" AS "warehouseId",
                    "delivery_method_id" AS "deliveryMethodId",
                    "status"::text AS "status", "open_api_evidence" AS "openApiEvidence",
                    "evidence_checksum" AS "evidenceChecksum",
                    "created_at" AS "createdAt", "updated_at" AS "updatedAt"
        ), event AS (
          INSERT INTO "logistics_scope_events" (
            "id", "tenant_id", "shop_id", "bootstrap_id", "subject_type",
            "subject_id", "event_type", "actor_user_id", "payload"
          )
          SELECT $10, c."tenantId", c."shopId", c."id", 'SCOPE_BOOTSTRAP',
                 c."id", 'BOOTSTRAP_CANDIDATE_UPSERTED', $8, $11::jsonb
            FROM candidate c RETURNING "id"
        ) SELECT c.* FROM candidate c CROSS JOIN event`,
        input.id, input.tenantId, input.shopId, input.warehouseId,
        input.deliveryMethodId, jsonValue(input.openApiEvidence), input.evidenceChecksum,
        input.actorUserId, input.now, scopeEventId(),
        sanitizedScopeEvent({ evidenceChecksum: input.evidenceChecksum }),
      );
      if (!rows[0]) unavailable('BOOTSTRAP_ALREADY_ACTIVATED');
      return mapBootstrap(rows[0]);
    },

    async createCompanyProbe(input: any) {
      return serializable(client, async (tx) => {
        const expired = await tx.$queryRawUnsafe<Array<{
          id: string; tenantId: string; shopId: string; expirationReason: string;
        }>>(
          `UPDATE "logistics_company_probes" p
              SET "status" = 'EXPIRED', "updated_at" = $2
             FROM "logistics_scope_bootstraps" b
            WHERE p."bootstrap_id" = $1 AND b."id" = p."bootstrap_id"
              AND p."status" IN ('ISSUED', 'CLAIMED', 'SUBMITTED')
              AND (
                (p."status" IN ('ISSUED', 'CLAIMED') AND p."expires_at" <= $2)
                OR p."issued_evidence_checksum" IS DISTINCT FROM b."evidence_checksum"
              )
          RETURNING p."id", b."tenant_id" AS "tenantId", b."shop_id" AS "shopId",
                    CASE WHEN p."issued_evidence_checksum" IS DISTINCT FROM b."evidence_checksum"
                      THEN 'OPEN_API_EVIDENCE_CHANGED' ELSE 'PROBE_TTL_ELAPSED' END AS "expirationReason"`,
          input.bootstrapId, input.issuedAt,
        );
        for (const probe of expired) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "logistics_scope_events" (
              "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
              "subject_type", "subject_id", "event_type", "actor_user_id", "payload"
            ) VALUES ($1, $2, $3, $4, $5, 'COMPANY_PROBE', $5,
                      'COMPANY_PROBE_EXPIRED', $6, $7::jsonb)`,
            scopeEventId(), probe.tenantId, probe.shopId, input.bootstrapId, probe.id,
            input.actorUserId,
            sanitizedScopeEvent({ reason: probe.expirationReason }),
          );
        }
        const rows = await tx.$queryRawUnsafe<any[]>(
          `WITH scope AS (
            SELECT b.* FROM "logistics_scope_bootstraps" b
             WHERE b."id" = $2 AND b."status" = 'CANDIDATE'
               AND b."open_api_evidence" ->> 'invalidated' IS DISTINCT FROM 'true'
             FOR SHARE OF b
          ), probe AS (
            INSERT INTO "logistics_company_probes" (
              "id", "bootstrap_id", "requested_by_id", "nonce_digest", "status",
              "issued_evidence_checksum", "issued_at", "expires_at", "created_at", "updated_at"
            )
            SELECT $1, s."id", $3, $4, 'ISSUED', s."evidence_checksum",
                   $5, $6, $5, $5 FROM scope s
            ON CONFLICT ("bootstrap_id") WHERE "status" IN ('ISSUED', 'CLAIMED', 'SUBMITTED')
            DO UPDATE SET "updated_at" = "logistics_company_probes"."updated_at"
            RETURNING *
          ), event AS (
            INSERT INTO "logistics_scope_events" (
              "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
              "subject_type", "subject_id", "event_type", "actor_user_id", "payload"
            )
            SELECT $7, s."tenant_id", s."shop_id", s."id", p."id",
                   'COMPANY_PROBE', p."id", 'COMPANY_PROBE_ISSUED', $3, $8::jsonb
              FROM scope s JOIN probe p ON true RETURNING "id"
          )
          SELECT p."id", p."bootstrap_id" AS "bootstrapId", p."status"::text AS "status",
                 p."nonce_digest" AS "nonceDigest", s."tenant_id" AS "tenantId",
                 p."issued_evidence_checksum" AS "issuedEvidenceChecksum",
                 s."shop_id" AS "shopId", s."warehouse_id" AS "warehouseId",
                 s."delivery_method_id" AS "deliveryMethodId",
                 w."platform_warehouse_id" AS "platformWarehouseId",
                 dm."platform_method_id" AS "platformMethodId",
                 p."claimed_by_session_id" AS "claimedBySessionId",
                 p."issued_at" AS "issuedAt", p."expires_at" AS "expiresAt"
            FROM probe p JOIN scope s ON s."id" = p."bootstrap_id"
            JOIN "warehouses" w ON w."id" = s."warehouse_id" AND w."shop_id" = s."shop_id"
            JOIN "shop_delivery_methods" dm
              ON dm."id" = s."delivery_method_id" AND dm."warehouse_id" = w."id"
            CROSS JOIN event`,
          input.id, input.bootstrapId, input.actorUserId, input.nonceDigest,
          input.issuedAt, input.expiresAt, scopeEventId(),
          sanitizedScopeEvent({ expiresAt: input.expiresAt.toISOString() }),
        );
        if (!rows[0]) unavailable('BOOTSTRAP_UNAVAILABLE');
        return mapProbe(rows[0]);
      });
    },
  };
}
