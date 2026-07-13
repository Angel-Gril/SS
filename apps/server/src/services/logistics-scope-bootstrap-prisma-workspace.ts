import {
  type LogisticsScopeSqlClient,
  unavailable,
} from './logistics-scope-bootstrap-prisma-common.js';

export function createScopeWorkspaceOperations(client: LogisticsScopeSqlClient) {
  return {
    async listWorkspace(input: {
      tenantId?: string;
      shopId?: string;
      warehouseId?: string;
      bootstrapId?: string;
      deploymentId: string;
      schemaMajor: number;
    }) {
      const values = [
        input.tenantId || null,
        input.shopId || null,
        input.warehouseId || null,
        input.bootstrapId || null,
      ];
      const channelValues = [
        values[0],
        values[1],
        values[2],
        input.deploymentId,
        input.schemaMajor,
      ];
      const [tenants, shops, warehouses, deliveryMethods] = await Promise.all([
        client.$queryRawUnsafe<any[]>(
          `SELECT DISTINCT u."id",
                  COALESCE(u."nickname", u."account_code", u."phone") AS "label",
                  u."status"::text AS "status"
             FROM "users" u JOIN "shops" s ON s."user_id" = u."id"
            WHERE s."platform" = 'OZON' AND ($1::text IS NULL OR u."id" = $1)
            ORDER BY "label"`,
          values[0],
        ),
        client.$queryRawUnsafe<any[]>(
          `SELECT s."id", s."user_id" AS "tenantId", s."name" AS "label",
                  s."status"::text AS "status", s."last_sync_at" AS "lastSyncAt"
             FROM "shops" s
            WHERE s."platform" = 'OZON'
              AND ($1::text IS NULL OR s."user_id" = $1)
              AND ($2::text IS NULL OR s."id" = $2) ORDER BY s."name"`,
          values[0],
          values[1],
        ),
        client.$queryRawUnsafe<any[]>(
          `SELECT w."id", w."shop_id" AS "shopId", w."name" AS "label",
                  w."platform_warehouse_id" AS "platformWarehouseId",
                  w."status", w."country_code" AS "countryCode", w."city"
             FROM "warehouses" w JOIN "shops" s ON s."id" = w."shop_id"
            WHERE s."platform" = 'OZON'
              AND ($1::text IS NULL OR s."user_id" = $1)
              AND ($2::text IS NULL OR s."id" = $2)
              AND ($3::text IS NULL OR w."id" = $3) ORDER BY w."name"`,
          values[0],
          values[1],
          values[2],
        ),
        client.$queryRawUnsafe<any[]>(
          `SELECT dm."id", dm."warehouse_id" AS "warehouseId", dm."name" AS "label",
                  dm."platform_method_id" AS "platformMethodId", dm."status",
                  dm."provider_id" AS "providerId", dm."provider_name" AS "providerName"
             FROM "shop_delivery_methods" dm
             JOIN "warehouses" w ON w."id" = dm."warehouse_id"
             JOIN "shops" s ON s."id" = w."shop_id"
            WHERE s."platform" = 'OZON'
              AND ($1::text IS NULL OR s."user_id" = $1)
              AND ($2::text IS NULL OR s."id" = $2)
              AND ($3::text IS NULL OR w."id" = $3) ORDER BY dm."name"`,
          values[0],
          values[1],
          values[2],
        ),
      ]);
      const [bootstraps, probes, companyBindings, originBindings] = await Promise.all([
        client.$queryRawUnsafe<any[]>(
          `SELECT b."id", b."tenant_id" AS "tenantId", b."shop_id" AS "shopId",
                  b."warehouse_id" AS "warehouseId",
                  b."delivery_method_id" AS "deliveryMethodId",
                  b."status"::text AS "status",
                  b."evidence_checksum" AS "evidenceChecksum",
                  b."created_at" AS "createdAt", b."updated_at" AS "updatedAt"
             FROM "logistics_scope_bootstraps" b
            WHERE ($1::text IS NULL OR b."tenant_id" = $1)
              AND ($2::text IS NULL OR b."shop_id" = $2)
              AND ($3::text IS NULL OR b."warehouse_id" = $3)
              AND ($4::text IS NULL OR b."id" = $4)
            ORDER BY b."created_at" DESC`,
          ...values,
        ),
        client.$queryRawUnsafe<any[]>(
          `SELECT p."id", p."bootstrap_id" AS "bootstrapId",
                  p."status"::text AS "status",
                  p."submitted_company_id" AS "submittedCompanyId",
                  p."company_binding_id" AS "companyBindingId",
                  p."issued_at" AS "issuedAt", p."expires_at" AS "expiresAt",
                  p."submitted_at" AS "submittedAt", p."reviewed_at" AS "reviewedAt",
                  p."review_reason" AS "reviewReason"
             FROM "logistics_company_probes" p
             JOIN "logistics_scope_bootstraps" b ON b."id" = p."bootstrap_id"
            WHERE ($1::text IS NULL OR b."tenant_id" = $1)
              AND ($2::text IS NULL OR b."shop_id" = $2)
              AND ($3::text IS NULL OR b."warehouse_id" = $3)
              AND ($4::text IS NULL OR b."id" = $4)
            ORDER BY p."created_at" DESC`,
          ...values,
        ),
        client.$queryRawUnsafe<any[]>(
          `SELECT cb."id", cb."shop_id" AS "shopId",
                  cb."ozon_company_id" AS "companyId", cb."status"::text AS "status",
                  cb."verified_at" AS "verifiedAt"
             FROM "shop_ozon_company_bindings" cb
            WHERE ($1::text IS NULL OR cb."tenant_id" = $1)
              AND ($2::text IS NULL OR cb."shop_id" = $2)`,
          values[0],
          values[1],
        ),
        client.$queryRawUnsafe<any[]>(
          `SELECT ob."id", ob."warehouse_id" AS "warehouseId",
                  ob."origin_country_uid" AS "originCountryUid",
                  ob."origin_city_uid" AS "originCityUid",
                  ob."origin_label" AS "originLabel", ob."status"::text AS "status",
                  ob."verified_at" AS "verifiedAt"
             FROM "warehouse_ozon_origin_bindings" ob
            WHERE ($1::text IS NULL OR ob."tenant_id" = $1)
              AND ($2::text IS NULL OR ob."shop_id" = $2)
              AND ($3::text IS NULL OR ob."warehouse_id" = $3)`,
          values[0],
          values[1],
          values[2],
        ),
      ]);
      const [channels, assignments] = await Promise.all([
        client.$queryRawUnsafe<any[]>(
          `SELECT c."id", c."shop_id" AS "shopId", c."warehouse_id" AS "warehouseId",
                  c."deployment_id" AS "deploymentId",
                  c."schema_major" AS "schemaMajor",
                  c."scope_key" AS "scopeKey", c."retired_at" AS "retiredAt"
             FROM "logistics_rule_channels" c
            WHERE ($1::text IS NULL OR c."tenant_id" = $1)
              AND ($2::text IS NULL OR c."shop_id" = $2)
              AND ($3::text IS NULL OR c."warehouse_id" = $3)
              AND c."deployment_id" = $4
              AND c."schema_major" = $5`,
          ...channelValues,
        ),
        client.$queryRawUnsafe<any[]>(
          `SELECT a."id", a."channel_id" AS "channelId",
                  a."destination_country_uid" AS "destinationCountryUid",
                  a."destination_location_uid" AS "destinationLocationUid",
                  a."destination_label" AS "destinationLabel",
                  a."retired_at" AS "retiredAt"
             FROM "logistics_rule_assignments" a
             JOIN "logistics_rule_channels" c ON c."id" = a."channel_id"
            WHERE ($1::text IS NULL OR a."tenant_id" = $1)
              AND ($2::text IS NULL OR a."shop_id" = $2)
              AND ($3::text IS NULL OR a."warehouse_id" = $3)
              AND c."deployment_id" = $4
              AND c."schema_major" = $5`,
          ...channelValues,
        ),
      ]);
      const bootstrap = input.bootstrapId
        ? bootstraps.find((item) => item.id === input.bootstrapId) || null
        : null;
      const scopedProbes = bootstrap
        ? probes.filter((item) => item.bootstrapId === bootstrap.id)
        : [];
      const probe = bootstrap
        ? scopedProbes.find((item) => item.status === 'CONFIRMED' && item.companyBindingId) ||
          scopedProbes.find((item) => item.status === 'SUBMITTED') ||
          scopedProbes[0]
        : null;
      const companyBinding = probe?.companyBindingId
        ? companyBindings.find((item) => item.id === probe.companyBindingId) || null
        : null;
      const originBinding = bootstrap
        ? originBindings.find((item) => item.warehouseId === bootstrap.warehouseId) || null
        : null;
      const channel = bootstrap
        ? channels.find(
            (item) =>
              item.shopId === bootstrap.shopId && item.warehouseId === bootstrap.warehouseId,
          ) || null
        : null;
      const assignment = channel
        ? assignments.find((item) => item.channelId === channel.id) || null
        : null;
      return {
        tenants,
        shops,
        warehouses,
        deliveryMethods,
        bootstraps,
        probes,
        companyBindings,
        originBindings,
        channels,
        assignments,
        bootstrap,
        activeBootstrap: bootstrap,
        probe,
        bindingProbe: probe,
        companyBinding,
        originBinding,
        channel,
        assignment,
      };
    },

    async getCompanyProbe(input: { probeId: string }) {
      const rows = await client.$queryRawUnsafe<any[]>(
        `SELECT p."id", p."bootstrap_id" AS "bootstrapId",
                p."status"::text AS "status",
                p."submitted_company_id" AS "submittedCompanyId",
                p."submitted_evidence" AS "submittedEvidence",
                p."company_binding_id" AS "companyBindingId",
                p."issued_at" AS "issuedAt", p."expires_at" AS "expiresAt",
                p."claimed_at" AS "claimedAt", p."submitted_at" AS "submittedAt",
                p."reviewed_at" AS "reviewedAt", p."review_reason" AS "reviewReason",
                b."tenant_id" AS "tenantId", b."shop_id" AS "shopId",
                b."warehouse_id" AS "warehouseId",
                b."delivery_method_id" AS "deliveryMethodId"
           FROM "logistics_company_probes" p
           JOIN "logistics_scope_bootstraps" b ON b."id" = p."bootstrap_id"
          WHERE p."id" = $1`,
        input.probeId,
      );
      if (!rows[0]) unavailable();
      return rows[0];
    },
  };
}
