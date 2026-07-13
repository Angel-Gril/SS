import { LogisticsScopeBootstrapError } from './logistics-scope-bootstrap.js';
import {
  type LogisticsScopeSqlClient,
  jsonValue,
  sanitizedScopeEvent,
  scopeEventId,
  serializable,
  unavailable,
} from './logistics-scope-bootstrap-prisma-common.js';
import { invalidatePreviousCompanyLogisticsScope } from './logistics-scope-invalidation.js';

function identity(value: unknown) {
  const item = value && typeof value === 'object' ? value as any : {};
  const platformWarehouseId = String(item?.warehouse?.platformWarehouseId || '');
  const platformMethodId = Number(item?.deliveryMethod?.platformMethodId);
  return platformWarehouseId && Number.isSafeInteger(platformMethodId)
    ? { platformWarehouseId, platformMethodId }
    : null;
}

export function createCompanyProbeReviewPersistence(client: LogisticsScopeSqlClient) {
  return {
    async reviewCompanyProbe(input: any) {
      const result = await serializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `SELECT p.*, p."status"::text AS "probeStatus",
                  b."tenant_id" AS "tenantId", b."shop_id" AS "shopId",
                  b."warehouse_id" AS "warehouseId",
                  b."delivery_method_id" AS "deliveryMethodId",
                  b."open_api_evidence" AS "openApiEvidence",
                  p."issued_evidence_checksum" AS "issuedEvidenceChecksum",
                  b."evidence_checksum" AS "evidenceChecksum",
                  w."platform_warehouse_id" AS "platformWarehouseId",
                  dm."platform_method_id" AS "platformMethodId"
             FROM "logistics_company_probes" p
             JOIN "logistics_scope_bootstraps" b ON b."id" = p."bootstrap_id"
             JOIN "shops" s ON s."id" = b."shop_id" AND s."user_id" = b."tenant_id"
              AND s."platform" = 'OZON'
              AND s."status" = 'ACTIVE'
             JOIN "warehouses" w ON w."id" = b."warehouse_id" AND w."shop_id" = s."id"
             JOIN "shop_delivery_methods" dm
               ON dm."id" = b."delivery_method_id" AND dm."warehouse_id" = w."id"
            WHERE p."id" = $1 FOR UPDATE OF p, b`,
          input.probeId,
        );
        const row = rows[0];
        if (!row) unavailable();
        if (row.probeStatus === 'EXPIRED') {
          throw new LogisticsScopeBootstrapError(
            'BINDING_PROBE_EXPIRED',
            410,
            'Binding probe expired',
          );
        }

        if (
          row.issuedEvidenceChecksum !== row.evidenceChecksum
          && ['ISSUED', 'CLAIMED', 'SUBMITTED'].includes(row.probeStatus)
        ) {
          await tx.$executeRawUnsafe(
            `UPDATE "logistics_company_probes"
                SET "status" = 'EXPIRED', "updated_at" = $2
              WHERE "id" = $1
                AND "status" IN ('ISSUED', 'CLAIMED', 'SUBMITTED')`,
            input.probeId, input.now,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO "logistics_scope_events" (
              "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
              "subject_type", "subject_id", "event_type", "actor_user_id", "payload"
            ) VALUES ($1, $2, $3, $4, $5, 'COMPANY_PROBE', $5,
                      'COMPANY_PROBE_EXPIRED', $6, $7::jsonb)`,
            scopeEventId(), row.tenantId, row.shopId, row.bootstrap_id,
            input.probeId, input.actorUserId,
            sanitizedScopeEvent({ reason: 'OPEN_API_EVIDENCE_CHANGED' }),
          );
          return {
            probeId: input.probeId,
            status: 'EXPIRED' as const,
          };
        }

        if (input.decision === 'REJECTED') {
          if (!['ISSUED', 'CLAIMED', 'SUBMITTED'].includes(row.probeStatus)) {
            throw new LogisticsScopeBootstrapError(
              'BINDING_PROBE_INVALID_STATE', 409, 'Probe cannot be rejected',
            );
          }
          await tx.$executeRawUnsafe(
            `UPDATE "logistics_company_probes"
                SET "status" = 'REJECTED', "reviewed_by_id" = $2,
                    "reviewed_at" = $3, "review_reason" = $4, "updated_at" = $3
              WHERE "id" = $1`,
            input.probeId, input.actorUserId, input.now, input.reason,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO "logistics_scope_events" (
              "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
              "subject_type", "subject_id", "event_type", "actor_user_id", "payload"
            ) VALUES ($1, $2, $3, $4, $5, 'COMPANY_PROBE', $5,
                      'COMPANY_PROBE_REJECTED', $6, $7::jsonb)`,
            scopeEventId(), row.tenantId, row.shopId, row.bootstrap_id,
            input.probeId, input.actorUserId,
            sanitizedScopeEvent({ reason: input.reason }),
          );
          return { probeId: input.probeId, status: 'REJECTED' as const };
        }

        if (row.probeStatus === 'CONFIRMED') {
          return {
            probeId: input.probeId,
            status: 'CONFIRMED' as const,
            companyBindingId: String(row.company_binding_id),
            companyBindingStatus: 'VERIFIED' as const,
          };
        }
        if (row.probeStatus !== 'SUBMITTED') {
          throw new LogisticsScopeBootstrapError(
            'BINDING_PROBE_INVALID_STATE', 409, 'Submitted evidence is required',
          );
        }
        const submitted = row.submitted_evidence;
        const frozen = identity(row.openApiEvidence);
        if (!submitted || !frozen || !String(row.submitted_company_id || '').trim()
          || String(submitted?.warehouse?.platformWarehouseId || '') !== row.platformWarehouseId
          || Number(submitted?.deliveryMethod?.platformMethodId) !== Number(row.platformMethodId)
          || frozen.platformWarehouseId !== row.platformWarehouseId
          || frozen.platformMethodId !== Number(row.platformMethodId)) {
          throw new LogisticsScopeBootstrapError(
            'BINDING_PROBE_EVIDENCE_MISMATCH',
            409,
            'Seller probe and current OpenAPI evidence do not intersect',
          );
        }

        const existing = await tx.$queryRawUnsafe<any[]>(
          `SELECT "id" FROM "shop_ozon_company_bindings"
            WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "ozon_company_id" = $3
              AND "retired_at" IS NULL ORDER BY "created_at" LIMIT 1 FOR UPDATE`,
          row.tenantId, row.shopId, row.submitted_company_id,
        );
        const companyBindingId = existing[0]?.id || scopeEventId();
        await invalidatePreviousCompanyLogisticsScope(tx, {
          tenantId: row.tenantId,
          shopId: row.shopId,
          activeOzonCompanyId: String(row.submitted_company_id),
          now: input.now,
        });
        const openApiEvidence = {
          bootstrapId: row.bootstrap_id,
          warehouse: {
            id: row.warehouseId,
            platformWarehouseId: row.platformWarehouseId,
          },
          deliveryMethod: {
            id: row.deliveryMethodId,
            platformMethodId: Number(row.platformMethodId),
          },
        };
        const sellerProbeEvidence = {
          probeId: input.probeId,
          companyId: String(row.submitted_company_id),
          warehouse: { platformWarehouseId: row.platformWarehouseId },
          deliveryMethod: { platformMethodId: Number(row.platformMethodId) },
          deviceSessionId: row.claimed_by_session_id,
          submittedAt: new Date(row.submitted_at).toISOString(),
        };
        if (existing[0]) {
          await tx.$executeRawUnsafe(
            `UPDATE "shop_ozon_company_bindings"
                SET "status" = 'VERIFIED', "open_api_evidence" = $2::jsonb,
                    "seller_probe_evidence" = $3::jsonb,
                    "open_api_verified_at" = $4, "seller_probe_verified_at" = $4,
                    "open_api_intersection_verified_at" = $4,
                    "verified_by_id" = $5, "verified_at" = $4,
                    "invalidated_at" = NULL, "updated_at" = $4
              WHERE "id" = $1`,
            companyBindingId, jsonValue(openApiEvidence), jsonValue(sellerProbeEvidence),
            input.now, input.actorUserId,
          );
        } else {
          await tx.$executeRawUnsafe(
            `INSERT INTO "shop_ozon_company_bindings" (
              "id", "tenant_id", "shop_id", "ozon_company_id", "status",
              "open_api_evidence", "seller_probe_evidence", "open_api_verified_at",
              "seller_probe_verified_at", "open_api_intersection_verified_at",
              "verified_by_id", "verified_at", "created_at", "updated_at"
            ) VALUES ($1, $2, $3, $4, 'VERIFIED', $5::jsonb, $6::jsonb,
                      $7, $7, $7, $8, $7, $7, $7)`,
            companyBindingId, row.tenantId, row.shopId, row.submitted_company_id,
            jsonValue(openApiEvidence), jsonValue(sellerProbeEvidence),
            input.now, input.actorUserId,
          );
        }
        await tx.$executeRawUnsafe(
          `UPDATE "logistics_company_probes"
              SET "status" = 'CONFIRMED', "company_binding_id" = $2,
                  "reviewed_by_id" = $3, "reviewed_at" = $4,
                  "review_reason" = $5, "updated_at" = $4
            WHERE "id" = $1`,
          input.probeId, companyBindingId, input.actorUserId, input.now, input.reason,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "logistics_scope_events" (
            "id", "tenant_id", "shop_id", "bootstrap_id", "probe_id",
            "subject_type", "subject_id", "event_type", "actor_user_id", "payload"
          ) VALUES ($1, $2, $3, $4, $5, 'COMPANY_BINDING', $6,
                    'COMPANY_BINDING_VERIFIED', $7, $8::jsonb)`,
          scopeEventId(), row.tenantId, row.shopId, row.bootstrap_id, input.probeId,
          companyBindingId, input.actorUserId,
          sanitizedScopeEvent({
            reason: input.reason,
            companyId: String(row.submitted_company_id),
            openApiVerified: true,
            sellerProbeVerified: true,
          }),
        );
        return {
          probeId: input.probeId,
          status: 'CONFIRMED' as const,
          companyBindingId,
          companyBindingStatus: 'VERIFIED' as const,
        };
      });
      if (result.status === 'EXPIRED') {
        throw new LogisticsScopeBootstrapError(
          'BINDING_PROBE_EXPIRED',
          410,
          'Binding probe expired',
        );
      }
      return result;
    },
  };
}
