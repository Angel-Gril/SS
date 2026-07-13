BEGIN;

-- CreateEnum
CREATE TYPE "LogisticsChannelType" AS ENUM ('TENANT', 'PUBLIC');

-- CreateEnum
CREATE TYPE "LogisticsSourceOwnerType" AS ENUM ('TENANT', 'PUBLIC');

-- CreateEnum
CREATE TYPE "LogisticsConfidentiality" AS ENUM ('TENANT_PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "LogisticsValidationStatus" AS ENUM ('DRAFT', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "LogisticsBindingStatus" AS ENUM ('CANDIDATE', 'VERIFIED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "LogisticsReviewStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "LogisticsReleaseKind" AS ENUM ('PUBLISH', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "LogisticsRuleEventType" AS ENUM ('REVISION_CREATED', 'BINDING_CHANGED', 'PUBLISHED', 'ROLLED_BACK', 'INVALIDATED');

-- CreateTable
CREATE TABLE "shop_ozon_company_bindings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "ozon_company_id" TEXT NOT NULL,
    "status" "LogisticsBindingStatus" NOT NULL DEFAULT 'CANDIDATE',
    "open_api_evidence" JSONB,
    "seller_probe_evidence" JSONB,
    "open_api_verified_at" TIMESTAMP(3),
    "seller_probe_verified_at" TIMESTAMP(3),
    "open_api_intersection_verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_ozon_company_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_ozon_origin_bindings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "origin_country_uid" TEXT NOT NULL,
    "origin_city_uid" TEXT NOT NULL,
    "origin_country_code" TEXT,
    "origin_label" TEXT NOT NULL,
    "status" "LogisticsBindingStatus" NOT NULL DEFAULT 'CANDIDATE',
    "open_api_address_evidence" JSONB,
    "official_location_evidence" JSONB,
    "open_api_address_verified_at" TIMESTAMP(3),
    "official_location_verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_ozon_origin_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_rule_channels" (
    "id" TEXT NOT NULL,
    "channel_type" "LogisticsChannelType" NOT NULL,
    "tenant_id" TEXT,
    "shop_id" TEXT,
    "warehouse_id" TEXT,
    "ozon_company_id" TEXT,
    "origin_country_uid" TEXT,
    "origin_city_uid" TEXT,
    "origin_country_code" TEXT,
    "origin_label" TEXT,
    "company_binding_id" TEXT,
    "origin_binding_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "current_sequence" INTEGER NOT NULL DEFAULT 0,
    "current_release_id" TEXT,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_rule_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_rule_revisions" (
    "id" TEXT NOT NULL,
    "revision_key" TEXT NOT NULL,
    "source_owner_type" "LogisticsSourceOwnerType" NOT NULL,
    "source_tenant_id" TEXT,
    "confidentiality" "LogisticsConfidentiality" NOT NULL,
    "content_checksum" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schema_version" TEXT NOT NULL,
    "parser_version" TEXT,
    "source_metadata" JSONB,
    "captured_at" TIMESTAMP(3),
    "validation_status" "LogisticsValidationStatus" NOT NULL DEFAULT 'DRAFT',
    "validation_report" JSONB,
    "validated_at" TIMESTAMP(3),
    "validation_valid_until" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_rule_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_rule_releases" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "revision_id" TEXT NOT NULL,
    "release_kind" "LogisticsReleaseKind" NOT NULL,
    "rollback_target_release_id" TEXT,
    "content_checksum" TEXT NOT NULL,
    "effective_checksum" TEXT NOT NULL,
    "frozen_payload" JSONB NOT NULL,
    "validated_at" TIMESTAMP(3) NOT NULL,
    "validation_valid_until" TIMESTAMP(3) NOT NULL,
    "published_by_id" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_rule_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_rule_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "destination_country_uid" TEXT NOT NULL,
    "destination_location_uid" TEXT NOT NULL,
    "destination_country_code" TEXT,
    "destination_label" TEXT NOT NULL,
    "pinned_release_id" TEXT,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_rule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_delivery_method_rule_bindings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "delivery_method_id" TEXT NOT NULL,
    "stable_service_key" TEXT NOT NULL,
    "candidate_service_keys" JSONB,
    "source_revision_id" TEXT NOT NULL,
    "status" "LogisticsReviewStatus" NOT NULL DEFAULT 'SUGGESTED',
    "evidence" JSONB,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_delivery_method_rule_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "official_seller_formula_resolutions" (
    "id" TEXT NOT NULL,
    "resolution_key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "official_fingerprint" TEXT NOT NULL,
    "seller_source_revision_id" TEXT NOT NULL,
    "candidate_set_checksum" TEXT NOT NULL,
    "candidate_service_keys" JSONB NOT NULL,
    "selected_service_key" TEXT,
    "status" "LogisticsReviewStatus" NOT NULL DEFAULT 'SUGGESTED',
    "evidence" JSONB,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "official_seller_formula_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_rule_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "channel_id" TEXT NOT NULL,
    "release_id" TEXT,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "type" "LogisticsRuleEventType" NOT NULL,
    "scope_snapshot" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_rule_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_ozon_company_bindings_tenant_id_shop_id_status_idx" ON "shop_ozon_company_bindings"("tenant_id", "shop_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shop_ozon_company_bindings_id_tenant_id_shop_id_ozon_compan_key" ON "shop_ozon_company_bindings"("id", "tenant_id", "shop_id", "ozon_company_id");

-- CreateIndex
CREATE INDEX "warehouse_ozon_origin_bindings_tenant_id_shop_id_warehouse__idx" ON "warehouse_ozon_origin_bindings"("tenant_id", "shop_id", "warehouse_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_ozon_origin_bindings_id_tenant_id_shop_id_warehou_key" ON "warehouse_ozon_origin_bindings"("id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid", "origin_city_uid");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rule_channels_scope_key_key" ON "logistics_rule_channels"("scope_key");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rule_channels_current_release_id_key" ON "logistics_rule_channels"("current_release_id");

-- CreateIndex
CREATE INDEX "logistics_rule_channels_tenant_id_shop_id_warehouse_id_idx" ON "logistics_rule_channels"("tenant_id", "shop_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rule_channels_id_tenant_id_shop_id_warehouse_id_key" ON "logistics_rule_channels"("id", "tenant_id", "shop_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rule_revisions_revision_key_key" ON "logistics_rule_revisions"("revision_key");

-- CreateIndex
CREATE INDEX "logistics_rule_revisions_source_tenant_id_created_at_idx" ON "logistics_rule_revisions"("source_tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rule_revisions_source_owner_type_source_tenant_id_key" ON "logistics_rule_revisions"("source_owner_type", "source_tenant_id", "content_checksum");

-- CreateIndex
CREATE INDEX "logistics_rule_releases_revision_id_idx" ON "logistics_rule_releases"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rule_releases_channel_id_sequence_key" ON "logistics_rule_releases"("channel_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_rule_releases_id_channel_id_key" ON "logistics_rule_releases"("id", "channel_id");

-- CreateIndex
CREATE INDEX "logistics_rule_assignments_tenant_id_shop_id_warehouse_id_d_idx" ON "logistics_rule_assignments"("tenant_id", "shop_id", "warehouse_id", "destination_country_uid", "destination_location_uid");

-- CreateIndex
CREATE INDEX "logistics_rule_assignments_channel_id_idx" ON "logistics_rule_assignments"("channel_id");

-- CreateIndex
CREATE INDEX "shop_delivery_method_rule_bindings_tenant_id_shop_id_wareho_idx" ON "shop_delivery_method_rule_bindings"("tenant_id", "shop_id", "warehouse_id", "delivery_method_id");

-- CreateIndex
CREATE INDEX "shop_delivery_method_rule_bindings_source_revision_id_idx" ON "shop_delivery_method_rule_bindings"("source_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "official_seller_formula_resolutions_resolution_key_key" ON "official_seller_formula_resolutions"("resolution_key");

-- CreateIndex
CREATE INDEX "official_seller_formula_resolutions_tenant_id_shop_id_wareh_idx" ON "official_seller_formula_resolutions"("tenant_id", "shop_id", "warehouse_id", "official_fingerprint");

-- CreateIndex
CREATE INDEX "official_seller_formula_resolutions_seller_source_revision__idx" ON "official_seller_formula_resolutions"("seller_source_revision_id");

-- CreateIndex
CREATE INDEX "logistics_rule_events_release_id_idx" ON "logistics_rule_events"("release_id");

-- CreateIndex
CREATE INDEX "logistics_rule_events_tenant_id_created_at_idx" ON "logistics_rule_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "logistics_rule_events_channel_id_created_at_idx" ON "logistics_rule_events"("channel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shops_id_user_id_key" ON "shops"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_id_shop_id_key" ON "warehouses"("id", "shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_delivery_methods_id_warehouse_id_key" ON "shop_delivery_methods"("id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "shop_ozon_company_bindings" ADD CONSTRAINT "shop_ozon_company_bindings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_ozon_company_bindings" ADD CONSTRAINT "shop_ozon_company_bindings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_ozon_origin_bindings" ADD CONSTRAINT "warehouse_ozon_origin_bindings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_ozon_origin_bindings" ADD CONSTRAINT "warehouse_ozon_origin_bindings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_ozon_origin_bindings" ADD CONSTRAINT "warehouse_ozon_origin_bindings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_channels" ADD CONSTRAINT "logistics_rule_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_channels" ADD CONSTRAINT "logistics_rule_channels_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_channels" ADD CONSTRAINT "logistics_rule_channels_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_channels" ADD CONSTRAINT "logistics_rule_channels_company_binding_id_fkey" FOREIGN KEY ("company_binding_id") REFERENCES "shop_ozon_company_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_channels" ADD CONSTRAINT "logistics_rule_channels_origin_binding_id_fkey" FOREIGN KEY ("origin_binding_id") REFERENCES "warehouse_ozon_origin_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_channels" ADD CONSTRAINT "logistics_rule_channels_current_release_id_fkey" FOREIGN KEY ("current_release_id") REFERENCES "logistics_rule_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_revisions" ADD CONSTRAINT "logistics_rule_revisions_source_tenant_id_fkey" FOREIGN KEY ("source_tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_releases" ADD CONSTRAINT "logistics_rule_releases_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "logistics_rule_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_releases" ADD CONSTRAINT "logistics_rule_releases_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "logistics_rule_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_releases" ADD CONSTRAINT "logistics_rule_releases_rollback_target_release_id_fkey" FOREIGN KEY ("rollback_target_release_id") REFERENCES "logistics_rule_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_assignments" ADD CONSTRAINT "logistics_rule_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_assignments" ADD CONSTRAINT "logistics_rule_assignments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_assignments" ADD CONSTRAINT "logistics_rule_assignments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_assignments" ADD CONSTRAINT "logistics_rule_assignments_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "logistics_rule_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_assignments" ADD CONSTRAINT "logistics_rule_assignments_pinned_release_id_fkey" FOREIGN KEY ("pinned_release_id") REFERENCES "logistics_rule_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery_method_rule_bindings" ADD CONSTRAINT "shop_delivery_method_rule_bindings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery_method_rule_bindings" ADD CONSTRAINT "shop_delivery_method_rule_bindings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery_method_rule_bindings" ADD CONSTRAINT "shop_delivery_method_rule_bindings_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery_method_rule_bindings" ADD CONSTRAINT "shop_delivery_method_rule_bindings_delivery_method_id_fkey" FOREIGN KEY ("delivery_method_id") REFERENCES "shop_delivery_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery_method_rule_bindings" ADD CONSTRAINT "shop_delivery_method_rule_bindings_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "logistics_rule_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_seller_formula_resolutions" ADD CONSTRAINT "official_seller_formula_resolutions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_seller_formula_resolutions" ADD CONSTRAINT "official_seller_formula_resolutions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_seller_formula_resolutions" ADD CONSTRAINT "official_seller_formula_resolutions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "official_seller_formula_resolutions" ADD CONSTRAINT "official_seller_formula_resolutions_seller_source_revision_fkey" FOREIGN KEY ("seller_source_revision_id") REFERENCES "logistics_rule_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_events" ADD CONSTRAINT "logistics_rule_events_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "logistics_rule_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_rule_events" ADD CONSTRAINT "logistics_rule_events_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "logistics_rule_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Cross-scope invariants and active-record uniqueness.
ALTER TABLE "logistics_rule_channels"
  ADD CONSTRAINT "logistics_channel_scope_shape_check" CHECK (
    ("channel_type" = 'TENANT'
      AND "tenant_id" IS NOT NULL AND "shop_id" IS NOT NULL AND "warehouse_id" IS NOT NULL
      AND "ozon_company_id" IS NOT NULL AND "origin_country_uid" IS NOT NULL AND "origin_city_uid" IS NOT NULL
      AND "company_binding_id" IS NOT NULL AND "origin_binding_id" IS NOT NULL)
    OR
    ("channel_type" = 'PUBLIC'
      AND "tenant_id" IS NULL AND "shop_id" IS NULL AND "warehouse_id" IS NULL
      AND "ozon_company_id" IS NULL AND "origin_country_uid" IS NULL AND "origin_city_uid" IS NULL
      AND "company_binding_id" IS NULL AND "origin_binding_id" IS NULL)
  );

ALTER TABLE "logistics_rule_revisions"
  ADD CONSTRAINT "logistics_revision_confidentiality_check" CHECK (
    ("source_owner_type" = 'TENANT' AND "source_tenant_id" IS NOT NULL AND "confidentiality" = 'TENANT_PRIVATE')
    OR ("source_owner_type" = 'PUBLIC' AND "source_tenant_id" IS NULL AND "confidentiality" = 'PUBLIC')
  );

ALTER TABLE "logistics_rule_releases"
  ADD CONSTRAINT "logistics_release_kind_target_check" CHECK (
    ("release_kind" = 'PUBLISH' AND "rollback_target_release_id" IS NULL)
    OR ("release_kind" = 'ROLLBACK' AND "rollback_target_release_id" IS NOT NULL)
  );

ALTER TABLE "shop_ozon_company_bindings"
  ADD CONSTRAINT "shop_company_verified_evidence_check" CHECK (
    "status" <> 'VERIFIED'
    OR ("open_api_verified_at" IS NOT NULL AND "seller_probe_verified_at" IS NOT NULL
      AND "open_api_intersection_verified_at" IS NOT NULL AND "verified_by_id" IS NOT NULL AND "verified_at" IS NOT NULL
      AND "invalidated_at" IS NULL AND "retired_at" IS NULL)
  );

ALTER TABLE "warehouse_ozon_origin_bindings"
  ADD CONSTRAINT "warehouse_origin_verified_evidence_check" CHECK (
    "status" <> 'VERIFIED'
    OR ("open_api_address_verified_at" IS NOT NULL AND "official_location_verified_at" IS NOT NULL
      AND "verified_by_id" IS NOT NULL AND "verified_at" IS NOT NULL AND "invalidated_at" IS NULL AND "retired_at" IS NULL)
  );

ALTER TABLE "shop_delivery_method_rule_bindings"
  ADD CONSTRAINT "method_binding_confirmed_evidence_check" CHECK (
    "status" <> 'CONFIRMED'
    OR ("confirmed_by_id" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "evidence" IS NOT NULL AND "retired_at" IS NULL)
  );

ALTER TABLE "official_seller_formula_resolutions"
  ADD CONSTRAINT "official_resolution_confirmed_evidence_check" CHECK (
    "status" <> 'CONFIRMED'
    OR ("selected_service_key" IS NOT NULL AND "reviewed_by_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL AND "evidence" IS NOT NULL AND "invalidated_at" IS NULL)
  );

CREATE UNIQUE INDEX "shop_company_binding_active_key"
  ON "shop_ozon_company_bindings"("tenant_id", "shop_id", "ozon_company_id") WHERE "retired_at" IS NULL;
CREATE UNIQUE INDEX "warehouse_origin_binding_active_key"
  ON "warehouse_ozon_origin_bindings"("tenant_id", "shop_id", "warehouse_id", "origin_country_uid", "origin_city_uid")
  WHERE "retired_at" IS NULL;
CREATE UNIQUE INDEX "logistics_assignment_active_destination_key"
  ON "logistics_rule_assignments"("tenant_id", "shop_id", "warehouse_id", "destination_country_uid", "destination_location_uid")
  WHERE "retired_at" IS NULL;
CREATE UNIQUE INDEX "method_rule_binding_active_method_key"
  ON "shop_delivery_method_rule_bindings"("delivery_method_id") WHERE "retired_at" IS NULL;

ALTER TABLE "shop_ozon_company_bindings"
  ADD CONSTRAINT "shop_company_binding_tenant_shop_fkey"
  FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_ozon_origin_bindings"
  ADD CONSTRAINT "warehouse_origin_tenant_shop_fkey"
  FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "warehouse_origin_shop_warehouse_fkey"
  FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_rule_channels"
  ADD CONSTRAINT "logistics_channel_tenant_shop_fkey"
  FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_channel_shop_warehouse_fkey"
  FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_channel_company_scope_fkey"
  FOREIGN KEY ("company_binding_id", "tenant_id", "shop_id", "ozon_company_id")
  REFERENCES "shop_ozon_company_bindings"("id", "tenant_id", "shop_id", "ozon_company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_channel_origin_scope_fkey"
  FOREIGN KEY ("origin_binding_id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid", "origin_city_uid")
  REFERENCES "warehouse_ozon_origin_bindings"("id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid", "origin_city_uid")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_channel_current_release_scope_fkey"
  FOREIGN KEY ("current_release_id", "id") REFERENCES "logistics_rule_releases"("id", "channel_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_rule_assignments"
  ADD CONSTRAINT "logistics_assignment_tenant_shop_fkey"
  FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_assignment_shop_warehouse_fkey"
  FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_assignment_channel_scope_fkey"
  FOREIGN KEY ("channel_id", "tenant_id", "shop_id", "warehouse_id")
  REFERENCES "logistics_rule_channels"("id", "tenant_id", "shop_id", "warehouse_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_assignment_pinned_release_scope_fkey"
  FOREIGN KEY ("pinned_release_id", "channel_id") REFERENCES "logistics_rule_releases"("id", "channel_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_delivery_method_rule_bindings"
  ADD CONSTRAINT "method_rule_binding_tenant_shop_fkey"
  FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "method_rule_binding_shop_warehouse_fkey"
  FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "method_rule_binding_warehouse_method_fkey"
  FOREIGN KEY ("delivery_method_id", "warehouse_id") REFERENCES "shop_delivery_methods"("id", "warehouse_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "official_seller_formula_resolutions"
  ADD CONSTRAINT "official_resolution_tenant_shop_fkey"
  FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "official_resolution_shop_warehouse_fkey"
  FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_rule_events"
  ADD CONSTRAINT "logistics_event_release_channel_fkey"
  FOREIGN KEY ("release_id", "channel_id") REFERENCES "logistics_rule_releases"("id", "channel_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_rule_events"
  ADD CONSTRAINT "logistics_event_release_requirement_check" CHECK (
    ("type" IN ('PUBLISHED', 'ROLLED_BACK')
      AND "release_id" IS NOT NULL AND "subject_type" = 'RELEASE' AND "subject_id" = "release_id")
    OR "type" NOT IN ('PUBLISHED', 'ROLLED_BACK')
  );

CREATE UNIQUE INDEX "logistics_release_event_once"
  ON "logistics_rule_events"("release_id")
  WHERE "type" IN ('PUBLISHED', 'ROLLED_BACK');

CREATE UNIQUE INDEX "logistics_public_revision_checksum_key"
  ON "logistics_rule_revisions"("content_checksum")
  WHERE "source_owner_type" = 'PUBLIC' AND "source_tenant_id" IS NULL AND "confidentiality" = 'PUBLIC';

CREATE FUNCTION "validate_logistics_release_scope"() RETURNS trigger AS $$
DECLARE
  channel_row "logistics_rule_channels"%ROWTYPE;
  revision_row "logistics_rule_revisions"%ROWTYPE;
  target_row "logistics_rule_releases"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT channel_row FROM "logistics_rule_channels" WHERE "id" = NEW."channel_id";
  SELECT * INTO STRICT revision_row FROM "logistics_rule_revisions" WHERE "id" = NEW."revision_id";

  IF channel_row."channel_type" = 'TENANT' THEN
    IF revision_row."source_owner_type" <> 'TENANT'
      OR revision_row."confidentiality" <> 'TENANT_PRIVATE'
      OR revision_row."source_tenant_id" IS DISTINCT FROM channel_row."tenant_id" THEN
      RAISE EXCEPTION 'release revision confidentiality does not match channel' USING ERRCODE = '23514';
    END IF;
  ELSIF channel_row."channel_type" = 'PUBLIC' THEN
    IF revision_row."source_owner_type" <> 'PUBLIC'
      OR revision_row."confidentiality" <> 'PUBLIC'
      OR revision_row."source_tenant_id" IS NOT NULL THEN
      RAISE EXCEPTION 'release revision confidentiality does not match channel' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'release channel type is invalid' USING ERRCODE = '23514';
  END IF;

  IF NEW."rollback_target_release_id" IS NOT NULL THEN
    SELECT * INTO target_row
      FROM "logistics_rule_releases" WHERE "id" = NEW."rollback_target_release_id";
    IF target_row."id" IS NULL THEN
      RAISE EXCEPTION 'rollback target does not exist' USING ERRCODE = '23514';
    END IF;
    IF target_row."id" = NEW."id" THEN
      RAISE EXCEPTION 'rollback target cannot reference itself' USING ERRCODE = '23514';
    END IF;
    IF target_row."channel_id" IS DISTINCT FROM NEW."channel_id" THEN
      RAISE EXCEPTION 'rollback target belongs to another channel' USING ERRCODE = '23514';
    END IF;
    IF target_row."sequence" >= NEW."sequence" THEN
      RAISE EXCEPTION 'rollback target must be an earlier release' USING ERRCODE = '23514';
    END IF;
    IF target_row."revision_id" IS DISTINCT FROM NEW."revision_id"
      OR target_row."content_checksum" IS DISTINCT FROM NEW."content_checksum"
      OR target_row."frozen_payload" IS DISTINCT FROM NEW."frozen_payload"
      OR target_row."validated_at" IS DISTINCT FROM NEW."validated_at"
      OR target_row."validation_valid_until" IS DISTINCT FROM NEW."validation_valid_until" THEN
      RAISE EXCEPTION 'rollback snapshot does not exactly match target release' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "logistics_release_scope_constraint"
  AFTER INSERT OR UPDATE ON "logistics_rule_releases"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_logistics_release_scope"();

CREATE FUNCTION "protect_logistics_channel_identity"() RETURNS trigger AS $$
BEGIN
  IF to_jsonb(OLD) - ARRAY['current_sequence', 'current_release_id', 'retired_at', 'updated_at']
     IS DISTINCT FROM
     to_jsonb(NEW) - ARRAY['current_sequence', 'current_release_id', 'retired_at', 'updated_at'] THEN
    RAISE EXCEPTION 'logistics channel identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_channel_identity_immutable"
  BEFORE UPDATE ON "logistics_rule_channels"
  FOR EACH ROW EXECUTE FUNCTION "protect_logistics_channel_identity"();

CREATE FUNCTION "validate_logistics_rule_event"() RETURNS trigger AS $$
DECLARE
  channel_row "logistics_rule_channels"%ROWTYPE;
  release_row "logistics_rule_releases"%ROWTYPE;
  subject_valid BOOLEAN := false;
BEGIN
  SELECT * INTO STRICT channel_row FROM "logistics_rule_channels" WHERE "id" = NEW."channel_id";
  IF NEW."tenant_id" IS DISTINCT FROM channel_row."tenant_id" THEN
    RAISE EXCEPTION 'event tenant does not match channel' USING ERRCODE = '23514';
  END IF;

  IF NEW."type" IN ('PUBLISHED', 'ROLLED_BACK') THEN
    SELECT * INTO release_row FROM "logistics_rule_releases" WHERE "id" = NEW."release_id";
    IF release_row."id" IS NULL
      OR NEW."subject_type" <> 'RELEASE'
      OR NEW."subject_id" IS DISTINCT FROM release_row."id" THEN
      RAISE EXCEPTION 'event subject is invalid' USING ERRCODE = '23514';
    END IF;
    IF (NEW."type" = 'PUBLISHED' AND release_row."release_kind" <> 'PUBLISH')
      OR (NEW."type" = 'ROLLED_BACK' AND release_row."release_kind" <> 'ROLLBACK') THEN
      RAISE EXCEPTION 'event type does not match release kind' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."release_id" IS NOT NULL THEN
    RAISE EXCEPTION 'event subject is invalid' USING ERRCODE = '23514';
  END IF;

  CASE NEW."subject_type"
    WHEN 'CHANNEL' THEN
      subject_valid := NEW."subject_id" = channel_row."id";
    WHEN 'REVISION' THEN
      SELECT EXISTS (
        SELECT 1 FROM "logistics_rule_revisions" revision
        WHERE revision."id" = NEW."subject_id"
          AND (
            (channel_row."channel_type" = 'TENANT'
              AND revision."source_owner_type" = 'TENANT'
              AND revision."source_tenant_id" = channel_row."tenant_id")
            OR
            (channel_row."channel_type" = 'PUBLIC'
              AND revision."source_owner_type" = 'PUBLIC'
              AND revision."source_tenant_id" IS NULL)
          )
      ) INTO subject_valid;
    WHEN 'METHOD_BINDING' THEN
      SELECT EXISTS (
        SELECT 1 FROM "shop_delivery_method_rule_bindings" binding
        WHERE binding."id" = NEW."subject_id"
          AND binding."tenant_id" = channel_row."tenant_id"
          AND binding."shop_id" = channel_row."shop_id"
          AND binding."warehouse_id" = channel_row."warehouse_id"
      ) INTO subject_valid;
    WHEN 'COMPANY_BINDING' THEN
      subject_valid := NEW."subject_id" = channel_row."company_binding_id";
    WHEN 'ORIGIN_BINDING' THEN
      subject_valid := NEW."subject_id" = channel_row."origin_binding_id";
    WHEN 'OFFICIAL_RESOLUTION' THEN
      SELECT EXISTS (
        SELECT 1 FROM "official_seller_formula_resolutions" resolution
        WHERE resolution."id" = NEW."subject_id"
          AND resolution."tenant_id" = channel_row."tenant_id"
          AND resolution."shop_id" = channel_row."shop_id"
          AND resolution."warehouse_id" = channel_row."warehouse_id"
      ) INTO subject_valid;
    ELSE
      subject_valid := false;
  END CASE;

  IF NEW."type" = 'REVISION_CREATED' AND NEW."subject_type" <> 'REVISION' THEN
    subject_valid := false;
  ELSIF NEW."type" = 'BINDING_CHANGED'
    AND NEW."subject_type" NOT IN ('METHOD_BINDING', 'COMPANY_BINDING', 'ORIGIN_BINDING', 'OFFICIAL_RESOLUTION') THEN
    subject_valid := false;
  ELSIF NEW."type" = 'INVALIDATED'
    AND NEW."subject_type" NOT IN ('CHANNEL', 'REVISION', 'METHOD_BINDING', 'COMPANY_BINDING', 'ORIGIN_BINDING', 'OFFICIAL_RESOLUTION') THEN
    subject_valid := false;
  END IF;

  IF NOT subject_valid THEN
    RAISE EXCEPTION 'event subject is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "logistics_rule_event_constraint"
  AFTER INSERT OR UPDATE ON "logistics_rule_events"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "validate_logistics_rule_event"();

-- Published history is append-only; mutable scope records retire instead of being deleted.
CREATE FUNCTION "prevent_logistics_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_rule_releases_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_rule_releases"
  FOR EACH ROW EXECUTE FUNCTION "prevent_logistics_history_mutation"();
CREATE TRIGGER "logistics_rule_events_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_rule_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_logistics_history_mutation"();

CREATE FUNCTION "protect_logistics_revision_content"() RETURNS trigger AS $$
BEGIN
  IF to_jsonb(OLD) - ARRAY['validation_status', 'validation_report', 'validated_at', 'validation_valid_until']
     IS DISTINCT FROM
     to_jsonb(NEW) - ARRAY['validation_status', 'validation_report', 'validated_at', 'validation_valid_until'] THEN
    RAISE EXCEPTION 'logistics revision content is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_rule_revision_content_immutable"
  BEFORE UPDATE ON "logistics_rule_revisions"
  FOR EACH ROW EXECUTE FUNCTION "protect_logistics_revision_content"();

COMMIT;
