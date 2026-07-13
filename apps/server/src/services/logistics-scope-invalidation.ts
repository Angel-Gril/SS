export interface LogisticsScopeInvalidationClient {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface ShopCredentialScopeInvalidationInput {
  tenantId: string;
  shopId: string;
  now: Date;
}

export async function invalidateShopLogisticsForCredentialChange(
  tx: LogisticsScopeInvalidationClient,
  input: ShopCredentialScopeInvalidationInput,
): Promise<void> {
  const values = [input.tenantId, input.shopId, input.now] as const;

  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_assignment_grants" g
        SET "status" = 'REVOKED', "revoked_at" = $3,
            "revoked_reason" = 'SCOPE_REVOKED', "updated_at" = $3
       FROM "logistics_rule_assignments" a
      WHERE g."assignment_id" = a."id" AND g."shop_id" = a."shop_id"
        AND a."tenant_id" = $1 AND a."shop_id" = $2
        AND g."status" = 'ACTIVE'`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_rule_assignments"
        SET "retired_at" = COALESCE("retired_at", $3), "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_rule_channels"
        SET "retired_at" = COALESCE("retired_at", $3), "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "shop_ozon_company_bindings"
        SET "status" = 'INVALIDATED', "invalidated_at" = COALESCE("invalidated_at", $3),
            "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2
        AND "status" <> 'INVALIDATED' AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "warehouse_ozon_origin_bindings"
        SET "status" = 'INVALIDATED', "invalidated_at" = COALESCE("invalidated_at", $3),
            "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2
        AND "status" <> 'INVALIDATED' AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "shop_delivery_method_rule_bindings"
        SET "status" = 'INVALIDATED', "retired_at" = COALESCE("retired_at", $3),
            "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "official_seller_formula_resolutions"
        SET "status" = 'INVALIDATED', "invalidated_at" = COALESCE("invalidated_at", $3),
            "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "invalidated_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_company_probes" p
        SET "status" = 'EXPIRED', "updated_at" = $3
       FROM "logistics_scope_bootstraps" b
      WHERE p."bootstrap_id" = b."id" AND b."tenant_id" = $1 AND b."shop_id" = $2
        AND p."status" IN ('ISSUED', 'CLAIMED', 'SUBMITTED')`,
    ...values,
  );

  await tx.$executeRawUnsafe(
    `UPDATE "logistics_scope_bootstraps"
        SET "status" = 'CANDIDATE', "activated_at" = NULL,
            "open_api_evidence" = jsonb_build_object(
              'invalidated', true, 'reason', 'SHOP_SCOPE_INVALIDATED'
            ),
            "evidence_checksum" = repeat('0', 64), "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2`,
    ...values,
  );
}
export async function retireShopLogisticsScope(
  tx: LogisticsScopeInvalidationClient,
  input: ShopCredentialScopeInvalidationInput,
): Promise<void> {
  const values = [input.tenantId, input.shopId, input.now] as const;
  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_assignment_grants" g
        SET "status" = 'REVOKED', "revoked_at" = $3,
            "revoked_reason" = 'SHOP_UNLINKED', "updated_at" = $3
       FROM "logistics_rule_assignments" a
      WHERE g."assignment_id" = a."id" AND g."shop_id" = a."shop_id"
        AND a."tenant_id" = $1 AND a."shop_id" = $2
        AND g."status" = 'ACTIVE'`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_shop_grants"
        SET "status" = 'REVOKED', "revoked_at" = $3, "revoked_reason" = 'SHOP_UNLINKED'
      WHERE "shop_id" = $2 AND "status" = 'ACTIVE'
        AND "session_id" IN (
          SELECT "id" FROM "extension_device_sessions" WHERE "owner_user_id" = $1
        )`,
    ...values,
  );
  await invalidateShopLogisticsForCredentialChange(tx, input);
  await tx.$executeRawUnsafe(
    `UPDATE "shop_ozon_company_bindings"
        SET "retired_at" = COALESCE("retired_at", $3), "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "warehouse_ozon_origin_bindings"
        SET "retired_at" = COALESCE("retired_at", $3), "updated_at" = $3
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "retired_at" IS NULL`,
    ...values,
  );
}
function normalizedText(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function sameCoordinate(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber) &&
    Math.abs(leftNumber - rightNumber) <= 0.000001;
}

export type WarehouseLogisticsFacts = {
  platformWarehouseId?: unknown;
  name?: unknown;
  status?: unknown;
  type?: unknown;
  countryCode?: unknown;
  city?: unknown;
  street?: unknown;
  zipCode?: unknown;
  firstMileType?: unknown;
  dropOffPointId?: unknown;
  isRfbs?: unknown;
  isKgt?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

const WAREHOUSE_TEXT_FACTS = [
  'platformWarehouseId',
  'name',
  'status',
  'type',
  'countryCode',
  'city',
  'street',
  'zipCode',
  'firstMileType',
  'dropOffPointId',
  'isRfbs',
  'isKgt',
] as const;

export function warehouseLogisticsScopeChanged(
  previous: WarehouseLogisticsFacts,
  next: WarehouseLogisticsFacts,
): boolean {
  return WAREHOUSE_TEXT_FACTS.some((key) => normalizedText(previous[key]) !== normalizedText(next[key])) ||
    !sameCoordinate(previous.latitude, next.latitude) ||
    !sameCoordinate(previous.longitude, next.longitude);
}

export interface WarehouseScopeInvalidationInput extends ShopCredentialScopeInvalidationInput {
  warehouseId: string;
  invalidateOriginBinding: boolean;
}

export async function invalidateWarehouseLogisticsScope(
  tx: LogisticsScopeInvalidationClient,
  input: WarehouseScopeInvalidationInput,
): Promise<void> {
  const values = [input.tenantId, input.shopId, input.warehouseId, input.now] as const;
  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_assignment_grants" g
        SET "status" = 'REVOKED', "revoked_at" = $4,
            "revoked_reason" = 'SCOPE_REVOKED', "updated_at" = $4
       FROM "logistics_rule_assignments" a
      WHERE g."assignment_id" = a."id" AND g."shop_id" = a."shop_id"
        AND a."tenant_id" = $1 AND a."shop_id" = $2 AND a."warehouse_id" = $3
        AND g."status" = 'ACTIVE'`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_rule_assignments"
        SET "retired_at" = COALESCE("retired_at", $4), "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3
        AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_rule_channels"
        SET "retired_at" = COALESCE("retired_at", $4), "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3
        AND "retired_at" IS NULL`,
    ...values,
  );
  if (input.invalidateOriginBinding) {
    await tx.$executeRawUnsafe(
      `UPDATE "warehouse_ozon_origin_bindings"
          SET "status" = 'INVALIDATED', "invalidated_at" = COALESCE("invalidated_at", $4),
              "updated_at" = $4
        WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3
          AND "status" <> 'INVALIDATED' AND "retired_at" IS NULL`,
      ...values,
    );
  }
  await tx.$executeRawUnsafe(
    `UPDATE "shop_delivery_method_rule_bindings"
        SET "status" = 'INVALIDATED', "retired_at" = COALESCE("retired_at", $4),
            "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3
        AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "official_seller_formula_resolutions"
        SET "status" = 'INVALIDATED', "invalidated_at" = COALESCE("invalidated_at", $4),
            "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3
        AND "invalidated_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_company_probes" p
        SET "status" = 'EXPIRED', "updated_at" = $4
       FROM "logistics_scope_bootstraps" b
      WHERE p."bootstrap_id" = b."id" AND b."tenant_id" = $1 AND b."shop_id" = $2
        AND b."warehouse_id" = $3 AND p."status" IN ('ISSUED', 'CLAIMED', 'SUBMITTED')`,
    ...values,
  );

  await tx.$executeRawUnsafe(
    `UPDATE "logistics_scope_bootstraps"
        SET "status" = 'CANDIDATE', "activated_at" = NULL,
            "open_api_evidence" = jsonb_build_object(
              'invalidated', true, 'reason', 'WAREHOUSE_SCOPE_INVALIDATED'
            ),
            "evidence_checksum" = repeat('0', 64), "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "warehouse_id" = $3`,
    ...values,
  );
}
function normalizedOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export type DeliveryMethodLogisticsFacts = {
  name?: unknown;
  status?: unknown;
  providerId?: unknown;
  providerName?: unknown;
  tplDropoffPointId?: unknown;
  cutoff?: unknown;
  slaCutIn?: unknown;
  tplIntegrationType?: unknown;
  dropOffPointAddress?: unknown;
  dropOffPointName?: unknown;
};

export function deliveryMethodLogisticsScopeChanged(
  previous: DeliveryMethodLogisticsFacts,
  next: DeliveryMethodLogisticsFacts,
): boolean {
  const textKeys: Array<keyof DeliveryMethodLogisticsFacts> = [
    'name',
    'status',
    'providerName',
    'tplDropoffPointId',
    'cutoff',
    'tplIntegrationType',
    'dropOffPointAddress',
    'dropOffPointName',
  ];
  return textKeys.some((key) => normalizedText(previous[key]) !== normalizedText(next[key])) ||
    normalizedOptionalNumber(previous.providerId) !== normalizedOptionalNumber(next.providerId) ||
    normalizedOptionalNumber(previous.slaCutIn) !== normalizedOptionalNumber(next.slaCutIn);
}
export interface CompanyScopeInvalidationInput extends ShopCredentialScopeInvalidationInput {
  activeOzonCompanyId: string;
}

export async function invalidatePreviousCompanyLogisticsScope(
  tx: LogisticsScopeInvalidationClient,
  input: CompanyScopeInvalidationInput,
): Promise<void> {
  const values = [
    input.tenantId,
    input.shopId,
    input.activeOzonCompanyId,
    input.now,
  ] as const;
  const oldCompanyExists = `EXISTS (
    SELECT 1 FROM "shop_ozon_company_bindings" previous
     WHERE previous."tenant_id" = $1 AND previous."shop_id" = $2
       AND previous."ozon_company_id" IS DISTINCT FROM $3
       AND previous."status" = 'VERIFIED'
       AND previous."invalidated_at" IS NULL AND previous."retired_at" IS NULL
  )`;

  await tx.$executeRawUnsafe(
    `UPDATE "extension_device_assignment_grants" g
        SET "status" = 'REVOKED', "revoked_at" = $4,
            "revoked_reason" = 'SCOPE_REVOKED', "updated_at" = $4
       FROM "logistics_rule_assignments" a
       JOIN "logistics_rule_channels" c ON c."id" = a."channel_id"
      WHERE g."assignment_id" = a."id" AND g."shop_id" = a."shop_id"
        AND a."tenant_id" = $1 AND a."shop_id" = $2
        AND c."ozon_company_id" IS DISTINCT FROM $3
        AND g."status" = 'ACTIVE'`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_rule_assignments" a
        SET "retired_at" = COALESCE(a."retired_at", $4), "updated_at" = $4
       FROM "logistics_rule_channels" c
      WHERE a."channel_id" = c."id" AND a."tenant_id" = $1 AND a."shop_id" = $2
        AND c."ozon_company_id" IS DISTINCT FROM $3 AND a."retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "logistics_rule_channels"
        SET "retired_at" = COALESCE("retired_at", $4), "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2
        AND "ozon_company_id" IS DISTINCT FROM $3 AND "retired_at" IS NULL`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "shop_delivery_method_rule_bindings"
        SET "status" = 'INVALIDATED', "retired_at" = COALESCE("retired_at", $4),
            "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "retired_at" IS NULL
        AND ${oldCompanyExists}`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "official_seller_formula_resolutions"
        SET "status" = 'INVALIDATED', "invalidated_at" = COALESCE("invalidated_at", $4),
            "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "invalidated_at" IS NULL
        AND ${oldCompanyExists}`,
    ...values,
  );
  await tx.$executeRawUnsafe(
    `UPDATE "shop_ozon_company_bindings"
        SET "status" = 'INVALIDATED', "invalidated_at" = COALESCE("invalidated_at", $4),
            "updated_at" = $4
      WHERE "tenant_id" = $1 AND "shop_id" = $2
        AND "ozon_company_id" IS DISTINCT FROM $3
        AND "status" <> 'INVALIDATED' AND "retired_at" IS NULL`,
    ...values,
  );
}
