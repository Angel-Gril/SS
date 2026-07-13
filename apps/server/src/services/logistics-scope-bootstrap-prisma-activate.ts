import {
  matchesFrozenOpenApiAddressEvidence,
  isActiveLogisticsScopeStatus,
  LogisticsScopeBootstrapError,
} from './logistics-scope-bootstrap.js';
import { normalizeOzonWarehouseAddressEvidence } from './ozon-client.js';
import {
  type LogisticsScopeSqlClient,
  jsonValue,
  sanitizedScopeEvent,
  scopeEventId,
  serializable,
  sha256,
} from './logistics-scope-bootstrap-prisma-common.js';

const XIAMEN_BOUNDS = {
  minLatitude: 24.35,
  maxLatitude: 24.95,
  minLongitude: 117.8,
  maxLongitude: 118.5,
};

function isXiamenOpenApiAddress(row: any): boolean {
  const city = String(row.city || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const cityProvided = city.length > 0;
  const cityMatches = ['xiamen', 'xiamencity', '厦门', '厦门市'].includes(city);
  const hasLatitude = row.latitude !== null && row.latitude !== undefined;
  const hasLongitude = row.longitude !== null && row.longitude !== undefined;
  if (hasLatitude !== hasLongitude) return false;

  const coordinatesProvided = hasLatitude && hasLongitude;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const coordinatesMatch =
    coordinatesProvided &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= XIAMEN_BOUNDS.minLatitude &&
    latitude <= XIAMEN_BOUNDS.maxLatitude &&
    longitude >= XIAMEN_BOUNDS.minLongitude &&
    longitude <= XIAMEN_BOUNDS.maxLongitude;

  if (cityProvided && !cityMatches) return false;
  if (coordinatesProvided && !coordinatesMatch) return false;
  return cityMatches || coordinatesMatch;
}

export function createOriginActivationPersistence(client: LogisticsScopeSqlClient) {
  return {
    async activateOriginScope(input: any) {
      if (
        input.officialLocation?.countryLabel !== 'China' ||
        input.officialLocation?.cityLabel !== 'Xiamen' ||
        input.officialLocation?.countryCode !== 'CN' ||
        input.destination?.countryLabel !== 'Russia' ||
        input.destination?.locationLabel !== 'Moscow' ||
        input.destination?.countryCode !== 'RU'
      ) {
        throw new LogisticsScopeBootstrapError(
          'PILOT_SCOPE_REQUIRED',
          409,
          'The first pilot is fixed to Xiamen and Moscow',
        );
      }
      return serializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `SELECT b.*, b."status"::text AS "bootstrapStatus",
                  s."status"::text AS "shopStatus",
                  s."client_id" AS "openApiClientId",
                  w."platform_warehouse_id" AS "platformWarehouseId",
                  w."name" AS "warehouseName", w."country_code" AS "countryCode",
                  w."status" AS "warehouseStatus",
                  w."city", w."street", w."zip_code" AS "zipCode",
                  w."latitude", w."longitude",
                  w."raw_data" AS "warehouseRawData",
                  w."updated_at" AS "warehouseSyncedAt",
                  dm."platform_method_id" AS "platformMethodId",
                  dm."name" AS "deliveryMethodName",
                  dm."status" AS "deliveryMethodStatus", dm."provider_id" AS "providerId",
                  cb."ozon_company_id" AS "companyId",
                  cb."status"::text AS "companyBindingStatus",
                  cb."open_api_verified_at" AS "openApiVerifiedAt",
                  cb."seller_probe_verified_at" AS "sellerProbeVerifiedAt",
                  cb."open_api_intersection_verified_at" AS "intersectionVerifiedAt",
                  cb."verified_at" AS "companyVerifiedAt",
                  cb."invalidated_at" AS "companyInvalidatedAt",
                  cb."retired_at" AS "companyRetiredAt",
                  p."issued_evidence_checksum" AS "issuedEvidenceChecksum",
                  b."open_api_evidence" AS "openApiEvidence",
                  b."evidence_checksum" AS "evidenceChecksum"
             FROM "logistics_scope_bootstraps" b
             JOIN "shops" s ON s."id" = b."shop_id" AND s."user_id" = b."tenant_id"
              AND s."platform" = 'OZON'
              AND s."status" = 'ACTIVE'
             JOIN "warehouses" w ON w."id" = b."warehouse_id" AND w."shop_id" = s."id"
             JOIN "shop_delivery_methods" dm
               ON dm."id" = b."delivery_method_id" AND dm."warehouse_id" = w."id"
             JOIN "shop_ozon_company_bindings" cb
               ON cb."id" = $2 AND cb."tenant_id" = b."tenant_id"
              AND cb."shop_id" = b."shop_id"
             JOIN "logistics_company_probes" p
               ON p."bootstrap_id" = b."id"
              AND p."company_binding_id" = cb."id"
              AND p."status" = 'CONFIRMED'
              AND p."submitted_company_id" = cb."ozon_company_id"
              AND p."issued_evidence_checksum" = b."evidence_checksum"
              AND p."submitted_evidence" -> 'warehouse' ->> 'platformWarehouseId'
                    = w."platform_warehouse_id"
              AND p."submitted_evidence" -> 'deliveryMethod' -> 'platformMethodId'
                    = to_jsonb(dm."platform_method_id")
            WHERE b."id" = $1 FOR UPDATE OF b, cb, p`,
          input.bootstrapId,
          input.companyBindingId,
        );
        const row = rows[0];
        if (!row) {
          throw new LogisticsScopeBootstrapError(
            'BOOTSTRAP_UNAVAILABLE',
            404,
            'Bootstrap scope is unavailable',
          );
        }
        if (
          row.shopStatus !== 'ACTIVE' ||
          !isActiveLogisticsScopeStatus(row.warehouseStatus) ||
          !isActiveLogisticsScopeStatus(row.deliveryMethodStatus) ||
          row.issuedEvidenceChecksum !== row.evidenceChecksum
        ) {
          throw new LogisticsScopeBootstrapError(
            'OPEN_API_SCOPE_STALE',
            409,
            'Current shop, warehouse, method, and frozen evidence must still match',
          );
        }

        if (
          row.companyBindingStatus !== 'VERIFIED' ||
          !row.openApiVerifiedAt ||
          !row.sellerProbeVerifiedAt ||
          !row.intersectionVerifiedAt ||
          !row.companyVerifiedAt ||
          row.companyInvalidatedAt ||
          row.companyRetiredAt
        ) {
          throw new LogisticsScopeBootstrapError(
            'UNVERIFIED_COMPANY_BINDING',
            409,
            'Verified company binding is required',
          );
        }
        const countryCode = String(row.countryCode || '')
          .trim()
          .toUpperCase();
        const frozenAddressEvidence = row.openApiEvidence
          ?.warehouse
          ?.openApiAddressEvidence;
        const rawAddress = normalizeOzonWarehouseAddressEvidence(
          row.warehouseRawData || {},
          row.platformWarehouseId,
        );
        if (
          countryCode !== 'CN' ||
          input.officialLocation.countryCode !== 'CN' ||
          !matchesFrozenOpenApiAddressEvidence(
            frozenAddressEvidence,
            row.warehouseRawData,
            row.warehouseSyncedAt,
          ) ||
          rawAddress?.countryCode !== 'CN' ||
          rawAddress.city !== 'Xiamen' ||
          !isXiamenOpenApiAddress(row)
        ) {
          throw new LogisticsScopeBootstrapError(
            'OPEN_API_ADDRESS_EVIDENCE_MISMATCH',
            409,
            'OpenAPI address evidence does not support this origin',
          );
        }

        const originRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT "id" FROM "warehouse_ozon_origin_bindings"
            WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3
              AND "origin_country_uid" = $4 AND "origin_city_uid" = $5
              AND "retired_at" IS NULL ORDER BY "created_at" LIMIT 1 FOR UPDATE`,
          row.tenant_id,
          row.shop_id,
          row.warehouse_id,
          input.officialLocation.countryUid,
          input.officialLocation.cityUid,
        );
        const originBindingId = originRows[0]?.id || scopeEventId();
        const addressEvidence = {
          bootstrapId: input.bootstrapId,
          warehouse: {
            id: row.warehouse_id,
            platformWarehouseId: row.platformWarehouseId,
            name: row.warehouseName,
            countryCode: row.countryCode,
            city: row.city,
            street: row.street,
            zipCode: row.zipCode,
            latitude: row.latitude,
            longitude: row.longitude,
            openApiAddressEvidence: frozenAddressEvidence,
          },
        };
        const officialEvidence = {
          ...input.officialEvidence,
          confirmedMapping: {
            countryUid: input.officialLocation.countryUid,
            countryLabel: input.officialLocation.countryLabel,
            cityUid: input.officialLocation.cityUid,
            cityLabel: input.officialLocation.cityLabel,
          },
        };
        if (originRows[0]) {
          await tx.$executeRawUnsafe(
            `UPDATE "warehouse_ozon_origin_bindings"
                SET "status" = 'VERIFIED', "origin_country_code" = $2,
                    "origin_label" = $3, "open_api_address_evidence" = $4::jsonb,
                    "official_location_evidence" = $5::jsonb,
                    "open_api_address_verified_at" = $6,
                    "official_location_verified_at" = $6,
                    "verified_by_id" = $7, "verified_at" = $6,
                    "invalidated_at" = NULL, "updated_at" = $6
              WHERE "id" = $1`,
            originBindingId,
            input.officialLocation.countryCode,
            input.officialLocation.countryLabel + ' / ' + input.officialLocation.cityLabel,
            jsonValue(addressEvidence),
            jsonValue(officialEvidence),
            input.now,
            input.actorUserId,
          );
        } else {
          await tx.$executeRawUnsafe(
            `INSERT INTO "warehouse_ozon_origin_bindings" (
              "id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid",
              "origin_city_uid", "origin_country_code", "origin_label", "status",
              "open_api_address_evidence", "official_location_evidence",
              "open_api_address_verified_at", "official_location_verified_at",
              "verified_by_id", "verified_at", "created_at", "updated_at"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'VERIFIED',
                      $9::jsonb, $10::jsonb, $11, $11, $12, $11, $11, $11)`,
            originBindingId,
            row.tenant_id,
            row.shop_id,
            row.warehouse_id,
            input.officialLocation.countryUid,
            input.officialLocation.cityUid,
            input.officialLocation.countryCode,
            input.officialLocation.countryLabel + ' / ' + input.officialLocation.cityLabel,
            jsonValue(addressEvidence),
            jsonValue(officialEvidence),
            input.now,
            input.actorUserId,
          );
        }

        const scopeKey = sha256(
          [
            input.deploymentId,
            String(input.schemaMajor),
            row.tenant_id,
            row.shop_id,
            row.companyId,
            row.warehouse_id,
            input.officialLocation.countryUid,
            input.officialLocation.cityUid,
          ].join('\0'),
        );
        const channelRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT "id", "retired_at" AS "retiredAt" FROM "logistics_rule_channels"
            WHERE "scope_key" = $1 AND "deployment_id" = $2 AND "schema_major" = $3
            FOR UPDATE`,
          scopeKey,
          input.deploymentId,
          input.schemaMajor,
        );
        const channelId = channelRows[0]?.id || scopeEventId();
        if (!channelRows[0]) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "logistics_rule_channels" (
              "id", "channel_type", "deployment_id", "schema_major",
              "tenant_id", "shop_id", "warehouse_id",
              "ozon_company_id", "origin_country_uid", "origin_city_uid",
              "origin_country_code", "origin_label", "company_binding_id",
              "origin_binding_id", "scope_key", "created_at", "updated_at"
            ) VALUES ($1, 'TENANT', $2, $3, $4, $5, $6, $7, $8, $9,
                      $10, $11, $12, $13, $14, $15, $15)`,
            channelId,
            input.deploymentId,
            input.schemaMajor,
            row.tenant_id,
            row.shop_id,
            row.warehouse_id,
            row.companyId,
            input.officialLocation.countryUid,
            input.officialLocation.cityUid,
            input.officialLocation.countryCode,
            input.officialLocation.countryLabel + ' / ' + input.officialLocation.cityLabel,
            input.companyBindingId,
            originBindingId,
            scopeKey,
            input.now,
          );
        } else if (channelRows[0].retiredAt) {
          await tx.$executeRawUnsafe(
            `UPDATE "logistics_rule_channels"
                SET "tenant_id" = $2, "shop_id" = $3, "warehouse_id" = $4,
                    "ozon_company_id" = $5, "origin_country_uid" = $6,
                    "origin_city_uid" = $7, "origin_country_code" = $8,
                    "origin_label" = $9, "company_binding_id" = $10,
                    "origin_binding_id" = $11, "current_release_id" = NULL,
                    "current_sequence" = GREATEST(
                      "current_sequence",
                      COALESCE((SELECT MAX("sequence") FROM "logistics_rule_releases"
                                WHERE "channel_id" = $1), 0)
                    ), "retired_at" = NULL, "updated_at" = $12
              WHERE "id" = $1`,
            channelId,
            row.tenant_id,
            row.shop_id,
            row.warehouse_id,
            row.companyId,
            input.officialLocation.countryUid,
            input.officialLocation.cityUid,
            input.officialLocation.countryCode,
            input.officialLocation.countryLabel + ' / ' + input.officialLocation.cityLabel,
            input.companyBindingId,
            originBindingId,
            input.now,
          );
        }
        const assignmentRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT "id" FROM "logistics_rule_assignments"
            WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3
              AND "channel_id" = $4 AND "destination_country_uid" = $5
              AND "destination_location_uid" = $6 AND "retired_at" IS NULL
            ORDER BY "created_at" LIMIT 1 FOR UPDATE`,
          row.tenant_id,
          row.shop_id,
          row.warehouse_id,
          channelId,
          input.destination.countryUid,
          input.destination.locationUid,
        );
        const assignmentId = assignmentRows[0]?.id || scopeEventId();
        if (!assignmentRows[0]) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "logistics_rule_assignments" (
              "id", "tenant_id", "shop_id", "warehouse_id", "channel_id",
              "destination_country_uid", "destination_location_uid",
              "destination_country_code", "destination_label", "created_at", "updated_at"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
            assignmentId,
            row.tenant_id,
            row.shop_id,
            row.warehouse_id,
            channelId,
            input.destination.countryUid,
            input.destination.locationUid,
            input.destination.countryCode,
            input.destination.countryLabel + ' / ' + input.destination.locationLabel,
            input.now,
          );
        }
        await tx.$executeRawUnsafe(
          `UPDATE "logistics_scope_bootstraps"
              SET "status" = 'ACTIVATED', "activated_at" = COALESCE("activated_at", $2),
                  "updated_at" = $2 WHERE "id" = $1`,
          input.bootstrapId,
          input.now,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "logistics_scope_events" (
            "id", "tenant_id", "shop_id", "bootstrap_id", "channel_id", "assignment_id",
            "subject_type", "subject_id", "event_type", "actor_user_id", "payload"
          ) VALUES ($1, $2, $3, $4, $5, $6, 'LOGISTICS_ASSIGNMENT', $6,
                    'ORIGIN_SCOPE_ACTIVATED', $7, $8::jsonb)`,
          scopeEventId(),
          row.tenant_id,
          row.shop_id,
          input.bootstrapId,
          channelId,
          assignmentId,
          input.actorUserId,
          sanitizedScopeEvent({
            reason: input.reason,
            deploymentId: input.deploymentId,
            schemaMajor: input.schemaMajor,
            originBindingId,
            destinationCountryUid: input.destination.countryUid,
            destinationLocationUid: input.destination.locationUid,
          }),
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "logistics_rule_events" (
            "id", "tenant_id", "channel_id", "subject_type", "subject_id",
            "actor_user_id", "type", "scope_snapshot", "facts", "created_at"
          ) VALUES ($1, $2, $3, 'ORIGIN_BINDING', $4, $5,
                    'BINDING_CHANGED', $6::jsonb, $7::jsonb, $8)`,
          scopeEventId(),
          row.tenant_id,
          channelId,
          originBindingId,
          input.actorUserId,
          sanitizedScopeEvent({
            deploymentId: input.deploymentId,
            schemaMajor: input.schemaMajor,
            tenantId: row.tenant_id,
            shopId: row.shop_id,
            warehouseId: row.warehouse_id,
            ozonCompanyId: row.companyId,
            originCountryUid: input.officialLocation.countryUid,
            originCityUid: input.officialLocation.cityUid,
            destinationCountryUid: input.destination.countryUid,
            destinationLocationUid: input.destination.locationUid,
          }),
          sanitizedScopeEvent({
            bootstrapId: input.bootstrapId,
            companyBindingId: input.companyBindingId,
            originBindingId,
            assignmentId,
            reason: input.reason,
          }),
          input.now,
        );
        return {
          bootstrapId: input.bootstrapId,
          originBindingId,
          channelId,
          assignmentId,
          duplicate: Boolean(assignmentRows[0]),
        };
      });
    },
  };
}
