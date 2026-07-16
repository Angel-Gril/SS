BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TYPE "SourceOzonCategoryMappingScope" AS ENUM ('TENANT', 'GLOBAL');
CREATE TYPE "SourceOzonCategoryMappingStatus" AS ENUM ('ACTIVE', 'REJECTED', 'RETIRED');
CREATE TYPE "SourceOzonCategoryMappingDecisionAction" AS ENUM ('CONFIRM', 'REJECT', 'PROMOTE');

CREATE TABLE "source_ozon_category_mappings" (
  "id" TEXT NOT NULL,
  "scope" "SourceOzonCategoryMappingScope" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "owner_user_id" TEXT,
  "source_platform" TEXT NOT NULL,
  "source_category_id" TEXT,
  "source_category_path_json" JSONB NOT NULL,
  "source_signature" TEXT NOT NULL,
  "source_snapshot_id" TEXT NOT NULL,
  "source_profile_hash" TEXT NOT NULL,
  "target_category_id" INTEGER NOT NULL,
  "target_type_id" INTEGER NOT NULL,
  "target_category_name" TEXT NOT NULL,
  "target_type_name" TEXT NOT NULL,
  "catalog_revision" TEXT NOT NULL,
  "status" "SourceOzonCategoryMappingStatus" NOT NULL DEFAULT 'ACTIVE',
  "confirm_count" INTEGER NOT NULL DEFAULT 0,
  "reject_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" TEXT NOT NULL,
  "updated_by_user_id" TEXT NOT NULL,
  "reviewed_by_user_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "last_confirmed_at" TIMESTAMP(3),
  "last_rejected_at" TIMESTAMP(3),
  "promoted_from_mapping_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "source_ozon_category_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_ozon_category_mapping_identity_key"
    UNIQUE ("scope_key", "source_signature", "target_category_id", "target_type_id"),
  CONSTRAINT "source_ozon_category_mapping_scope_owner_check" CHECK (
    (
      "scope" = 'TENANT'
      AND "owner_user_id" IS NOT NULL
      AND "scope_key" = 'tenant:' || "owner_user_id"
    )
    OR
    (
      "scope" = 'GLOBAL'
      AND "owner_user_id" IS NULL
      AND "scope_key" = 'global'
    )
  ),
  CONSTRAINT "source_ozon_category_mapping_global_review_check" CHECK (
    "scope" <> 'GLOBAL'
    OR (
      "reviewed_by_user_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
      AND "promoted_from_mapping_id" IS NOT NULL
    )
  ),
  CONSTRAINT "source_ozon_category_mapping_source_identity_check" CHECK (
    "source_platform" IN ('1688', 'pdd', 'taobao', 'tmall')
    AND jsonb_typeof("source_category_path_json") = 'array'
    AND (
      NULLIF(btrim("source_category_id"), '') IS NOT NULL
      OR jsonb_array_length("source_category_path_json") > 0
    )
    AND "source_signature" ~ '^[a-f0-9]{64}$'
    AND "source_profile_hash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "source_ozon_category_mapping_target_check" CHECK (
    "target_category_id" > 0
    AND "target_type_id" > 0
    AND char_length(btrim("target_category_name")) BETWEEN 1 AND 500
    AND char_length(btrim("target_type_name")) BETWEEN 1 AND 500
    AND char_length(btrim("catalog_revision")) BETWEEN 1 AND 200
  ),
  CONSTRAINT "source_ozon_category_mapping_count_check" CHECK (
    "confirm_count" >= 0
    AND "reject_count" >= 0
    AND ("confirm_count" = 0 OR "last_confirmed_at" IS NOT NULL)
    AND ("reject_count" = 0 OR "last_rejected_at" IS NOT NULL)
  ),
  CONSTRAINT "source_ozon_category_mapping_owner_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_ozon_category_mapping_snapshot_fkey"
    FOREIGN KEY ("source_snapshot_id") REFERENCES "source_capture_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_ozon_category_mapping_creator_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_ozon_category_mapping_updater_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_ozon_category_mapping_reviewer_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_ozon_category_mapping_promotion_source_fkey"
    FOREIGN KEY ("promoted_from_mapping_id") REFERENCES "source_ozon_category_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "source_ozon_category_mapping_tenant_read_idx"
  ON "source_ozon_category_mappings"("owner_user_id", "source_signature", "status");
CREATE INDEX "source_ozon_category_mapping_scope_read_idx"
  ON "source_ozon_category_mappings"("scope", "source_signature", "status");
CREATE INDEX "source_ozon_category_mapping_snapshot_idx"
  ON "source_ozon_category_mappings"("source_snapshot_id");
CREATE INDEX "source_ozon_category_mapping_review_idx"
  ON "source_ozon_category_mappings"("reviewed_by_user_id", "reviewed_at");

CREATE TABLE "source_ozon_category_mapping_decisions" (
  "id" TEXT NOT NULL,
  "mapping_id" TEXT NOT NULL,
  "operation_key" TEXT NOT NULL,
  "transition_version" INTEGER NOT NULL,
  "decision_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "action" "SourceOzonCategoryMappingDecisionAction" NOT NULL,
  "scope" "SourceOzonCategoryMappingScope" NOT NULL,
  "scope_key" TEXT NOT NULL,
  "owner_user_id" TEXT,
  "actor_user_id" TEXT NOT NULL,
  "source_snapshot_id" TEXT NOT NULL,
  "source_profile_hash" TEXT NOT NULL,
  "catalog_revision" TEXT NOT NULL,
  "review_note" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "source_ozon_category_mapping_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_ozon_category_mapping_decision_key" UNIQUE ("decision_key"),
  CONSTRAINT "source_ozon_category_mapping_transition_key" UNIQUE ("mapping_id", "transition_version"),
  CONSTRAINT "source_ozon_category_mapping_decision_scope_check" CHECK (
    (
      "scope" = 'TENANT'
      AND "owner_user_id" IS NOT NULL
      AND "scope_key" = 'tenant:' || "owner_user_id"
      AND "action" IN ('CONFIRM', 'REJECT')
    )
    OR
    (
      "scope" = 'GLOBAL'
      AND "owner_user_id" IS NULL
      AND "scope_key" = 'global'
      AND "action" = 'PROMOTE'
    )
  ),
  CONSTRAINT "source_ozon_category_mapping_decision_hash_check" CHECK (
    "operation_key" ~ '^[a-f0-9]{64}$'
    AND "transition_version" > 0
    AND "decision_key" ~ '^[a-f0-9]{64}$'
    AND "request_hash" ~ '^[a-f0-9]{64}$'
    AND "source_profile_hash" ~ '^[a-f0-9]{64}$'
    AND char_length(btrim("catalog_revision")) BETWEEN 1 AND 200
  ),
  CONSTRAINT "source_ozon_category_mapping_decision_review_check" CHECK (
    ("action" = 'PROMOTE' AND char_length(btrim("review_note")) BETWEEN 3 AND 1000)
    OR ("action" <> 'PROMOTE' AND "review_note" IS NULL)
  ),
  CONSTRAINT "source_ozon_category_mapping_decision_mapping_fkey"
    FOREIGN KEY ("mapping_id") REFERENCES "source_ozon_category_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_ozon_category_mapping_decision_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "source_ozon_category_mapping_decision_snapshot_fkey"
    FOREIGN KEY ("source_snapshot_id") REFERENCES "source_capture_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "source_ozon_category_mapping_decision_mapping_idx"
  ON "source_ozon_category_mapping_decisions"("mapping_id", "created_at");
CREATE INDEX "source_ozon_category_mapping_decision_actor_idx"
  ON "source_ozon_category_mapping_decisions"("actor_user_id", "created_at");
CREATE INDEX "source_ozon_category_mapping_decision_scope_idx"
  ON "source_ozon_category_mapping_decisions"("scope_key", "created_at");

CREATE FUNCTION "validate_source_ozon_category_mapping_decision"() RETURNS trigger AS $$
DECLARE
  aggregate "source_ozon_category_mappings"%ROWTYPE;
BEGIN
  SELECT m.* INTO aggregate
    FROM "source_ozon_category_mappings" m
   WHERE m."id" = NEW."mapping_id";

  IF NOT FOUND
    OR NEW."scope" IS DISTINCT FROM aggregate."scope"
    OR NEW."scope_key" IS DISTINCT FROM aggregate."scope_key"
    OR NEW."owner_user_id" IS DISTINCT FROM aggregate."owner_user_id"
    OR NEW."source_snapshot_id" IS DISTINCT FROM aggregate."source_snapshot_id"
    OR NEW."source_profile_hash" IS DISTINCT FROM aggregate."source_profile_hash"
    OR NEW."catalog_revision" IS DISTINCT FROM aggregate."catalog_revision"
    OR NEW."transition_version" IS DISTINCT FROM
      (aggregate."confirm_count" + aggregate."reject_count") THEN
    RAISE EXCEPTION 'source Ozon category mapping decision does not match its aggregate'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "source_ozon_category_mapping_decision_provenance"
  BEFORE INSERT ON "source_ozon_category_mapping_decisions"
  FOR EACH ROW EXECUTE FUNCTION "validate_source_ozon_category_mapping_decision"();

CREATE FUNCTION "prevent_source_ozon_category_mapping_decision_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source Ozon category mapping decisions are immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "source_ozon_category_mapping_decision_immutable"
  BEFORE UPDATE OR DELETE ON "source_ozon_category_mapping_decisions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_source_ozon_category_mapping_decision_mutation"();

COMMIT;
