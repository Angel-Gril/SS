BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE "ai_media_listing_draft_application_mutations" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "operation" "AiMediaOperation" NOT NULL,
  "kind" "AiMediaApplicationMutationKind" NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "rollback_of_id" TEXT,
  "target_id" VARCHAR(200) NOT NULL,
  "target_sequence" INTEGER NOT NULL,
  "mode" "AiMediaApplicationMode" NOT NULL,
  "replace_confirmed" BOOLEAN NOT NULL DEFAULT FALSE,
  "context_sku_key" VARCHAR(500),
  "context_slot_key" VARCHAR(1024) NOT NULL,
  "context_draft_revision" INTEGER NOT NULL,
  "context_draft_version" INTEGER NOT NULL,
  "operation_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "workflow_revision_before" INTEGER NOT NULL,
  "workflow_revision_after" INTEGER NOT NULL,
  "target_revision_before" INTEGER NOT NULL,
  "target_draft_version_before" INTEGER NOT NULL,
  "target_revision_after" INTEGER NOT NULL,
  "target_draft_version_after" INTEGER NOT NULL,
  "before_state_json" JSONB NOT NULL,
  "before_state_hash" CHAR(64) NOT NULL,
  "after_state_json" JSONB NOT NULL,
  "after_state_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_listing_draft_application_mutations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_listing_draft_mutation_values_check" CHECK (
    "revision" = 1
    AND btrim("target_id") <> ''
    AND "target_sequence" >= 1
    AND btrim("context_slot_key") <> ''
    AND "context_draft_revision" >= 1
    AND "context_draft_version" >= 1
    AND btrim("operation_key") <> ''
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "workflow_revision_before" >= 1
    AND "workflow_revision_after" = "workflow_revision_before" + 1
    AND "target_revision_before" >= 1
    AND "target_revision_after" = "target_revision_before" + 1
    AND "target_draft_version_before" >= 1
    AND "target_draft_version_after" = "target_draft_version_before" + 1
    AND "before_state_hash" ~ '^[0-9a-f]{64}$'
    AND "after_state_hash" ~ '^[0-9a-f]{64}$'
    AND "before_state_hash" <> "after_state_hash"
    AND "before_state_json" IS DISTINCT FROM "after_state_json"
    AND (("mode" = 'APPEND' AND "replace_confirmed" = FALSE)
      OR ("mode" = 'REPLACE' AND "replace_confirmed" = TRUE))
    AND (("kind" = 'APPLY' AND "rollback_of_id" IS NULL)
      OR ("kind" = 'ROLLBACK' AND "rollback_of_id" IS NOT NULL))
  ),
  CONSTRAINT "ai_media_listing_draft_mutation_before_state_check" CHECK (
    jsonb_typeof("before_state_json") = 'object'
    AND ("before_state_json" - ARRAY['version', 'assignment']::text[]) = '{}'::jsonb
    AND "before_state_json"->>'version' = 'ai-media-listing-draft-assignment/v1'
    AND "before_state_json" ? 'assignment'
    AND ("before_state_json"->'assignment' IS NULL
      OR jsonb_typeof("before_state_json"->'assignment') = 'object')
    AND octet_length("before_state_json"::text) <= 65536
  ),
  CONSTRAINT "ai_media_listing_draft_mutation_after_state_check" CHECK (
    jsonb_typeof("after_state_json") = 'object'
    AND ("after_state_json" - ARRAY['version', 'assignment']::text[]) = '{}'::jsonb
    AND "after_state_json"->>'version' = 'ai-media-listing-draft-assignment/v1'
    AND "after_state_json" ? 'assignment'
    AND ("after_state_json"->'assignment' IS NULL
      OR jsonb_typeof("after_state_json"->'assignment') = 'object')
    AND octet_length("after_state_json"::text) <= 65536
  )
);

CREATE UNIQUE INDEX "ai_media_listing_draft_mutation_id_owner_key"
  ON "ai_media_listing_draft_application_mutations" ("id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_listing_draft_mutation_rollback_key"
  ON "ai_media_listing_draft_application_mutations" ("rollback_of_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_listing_draft_mutation_operation_key"
  ON "ai_media_listing_draft_application_mutations" ("owner_user_id", "operation_key");
CREATE UNIQUE INDEX "ai_media_listing_draft_mutation_job_kind_key"
  ON "ai_media_listing_draft_application_mutations" ("job_id", "kind");
CREATE UNIQUE INDEX "ai_media_listing_draft_mutation_target_sequence_key"
  ON "ai_media_listing_draft_application_mutations" ("owner_user_id", "target_id", "target_sequence");
CREATE INDEX "ai_media_listing_draft_mutation_target_history_idx"
  ON "ai_media_listing_draft_application_mutations" ("owner_user_id", "target_id", "target_sequence" DESC);
CREATE INDEX "ai_media_listing_draft_mutation_workflow_history_idx"
  ON "ai_media_listing_draft_application_mutations" ("workflow_id", "created_at" DESC);
CREATE INDEX "ai_media_listing_draft_mutation_before_idx"
  ON "ai_media_listing_draft_application_mutations" ("target_id", "target_revision_before", "owner_user_id", "target_draft_version_before");
CREATE INDEX "ai_media_listing_draft_mutation_after_idx"
  ON "ai_media_listing_draft_application_mutations" ("target_id", "target_revision_after", "owner_user_id", "target_draft_version_after");

ALTER TABLE "ai_media_listing_draft_application_mutations"
  ADD CONSTRAINT "ai_media_listing_draft_mutation_owner_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_workflow_fkey"
    FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "ai_media_workflows" ("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_job_fkey"
    FOREIGN KEY ("job_id", "owner_user_id") REFERENCES "ai_image_jobs" ("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_asset_fkey"
    FOREIGN KEY ("asset_id", "owner_user_id") REFERENCES "media_assets" ("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_snapshot_fkey"
    FOREIGN KEY ("source_capture_snapshot_id") REFERENCES "source_capture_snapshots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_target_fkey"
    FOREIGN KEY ("target_id", "owner_user_id") REFERENCES "source_listing_workflows" ("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_before_fkey"
    FOREIGN KEY ("target_id", "target_revision_before", "owner_user_id", "target_draft_version_before")
    REFERENCES "source_listing_draft_versions" ("workflow_id", "revision", "owner_user_id", "draft_version") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_after_fkey"
    FOREIGN KEY ("target_id", "target_revision_after", "owner_user_id", "target_draft_version_after")
    REFERENCES "source_listing_draft_versions" ("workflow_id", "revision", "owner_user_id", "draft_version") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ai_media_listing_draft_mutation_rollback_fkey"
    FOREIGN KEY ("rollback_of_id", "owner_user_id") REFERENCES "ai_media_listing_draft_application_mutations" ("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION validate_ai_media_listing_draft_application_mutation_insert() RETURNS trigger AS $$
DECLARE
  stored_workflow "ai_media_workflows"%ROWTYPE;
  stored_job "ai_image_jobs"%ROWTYPE;
  stored_asset "media_assets"%ROWTYPE;
  stored_target "source_listing_workflows"%ROWTYPE;
  stored_before "source_listing_draft_versions"%ROWTYPE;
  stored_after "source_listing_draft_versions"%ROWTYPE;
  stored_apply "ai_media_listing_draft_application_mutations"%ROWTYPE;
  before_assignment JSONB;
  after_assignment JSONB;
  before_count INTEGER;
  after_count INTEGER;
  before_slot_count INTEGER;
  after_slot_count INTEGER;
BEGIN
  SELECT * INTO stored_workflow FROM "ai_media_workflows"
    WHERE "id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing draft application workflow does not belong to owner' USING ERRCODE = '23514'; END IF;
  SELECT * INTO stored_job FROM "ai_image_jobs"
    WHERE "id" = NEW."job_id" AND "owner_user_id" = NEW."owner_user_id";
  IF NOT FOUND THEN RAISE EXCEPTION 'listing draft application job does not belong to owner' USING ERRCODE = '23514'; END IF;
  SELECT * INTO stored_asset FROM "media_assets"
    WHERE "id" = NEW."asset_id" AND "owner_user_id" = NEW."owner_user_id";
  IF NOT FOUND THEN RAISE EXCEPTION 'listing draft application asset does not belong to owner' USING ERRCODE = '23514'; END IF;
  SELECT * INTO stored_target FROM "source_listing_workflows"
    WHERE "id" = NEW."target_id" AND "owner_user_id" = NEW."owner_user_id" FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing draft application target does not belong to owner' USING ERRCODE = '23514'; END IF;
  SELECT * INTO stored_before FROM "source_listing_draft_versions"
    WHERE "workflow_id" = NEW."target_id" AND "revision" = NEW."target_revision_before"
      AND "owner_user_id" = NEW."owner_user_id" AND "draft_version" = NEW."target_draft_version_before";
  SELECT * INTO stored_after FROM "source_listing_draft_versions"
    WHERE "workflow_id" = NEW."target_id" AND "revision" = NEW."target_revision_after"
      AND "owner_user_id" = NEW."owner_user_id" AND "draft_version" = NEW."target_draft_version_after";
  IF stored_before."id" IS NULL OR stored_after."id" IS NULL THEN
    RAISE EXCEPTION 'listing draft application draft lineage is missing' USING ERRCODE = '23514';
  END IF;
  IF stored_workflow."context_type" IS DISTINCT FROM 'listing-draft'
    OR stored_workflow."context_id" IS DISTINCT FROM NEW."target_id"
    OR nullif(btrim(stored_workflow."context_sku_key"), '') IS DISTINCT FROM nullif(btrim(NEW."context_sku_key"), '')
    OR stored_workflow."context_slot_key" IS DISTINCT FROM NEW."context_slot_key"
    OR stored_workflow."context_draft_revision" IS DISTINCT FROM NEW."context_draft_revision"
    OR stored_workflow."context_draft_version" IS DISTINCT FROM NEW."context_draft_version"
  THEN RAISE EXCEPTION 'listing draft application target does not match frozen workflow context' USING ERRCODE = '23514'; END IF;
  IF stored_workflow."revision" IS DISTINCT FROM NEW."workflow_revision_before" THEN
    RAISE EXCEPTION 'listing draft application workflow revision is stale' USING ERRCODE = '40001';
  END IF;
  IF stored_target."current_revision" IS DISTINCT FROM NEW."target_revision_after"
    OR stored_target."current_draft_version" IS DISTINCT FROM NEW."target_draft_version_after"
    OR stored_target."current_source_capture_snapshot_id" IS DISTINCT FROM NEW."source_capture_snapshot_id"
  THEN RAISE EXCEPTION 'listing draft application target revision is stale' USING ERRCODE = '40001'; END IF;
  IF stored_job."workflow_id" IS DISTINCT FROM NEW."workflow_id"
    OR stored_job."operation"::text IS DISTINCT FROM stored_workflow."operation"::text
    OR stored_job."workflow_attempt" IS DISTINCT FROM stored_workflow."current_attempt"
    OR stored_job."provider" IS DISTINCT FROM 'fake'
  THEN RAISE EXCEPTION 'listing draft application job authority does not match fake workflow' USING ERRCODE = '23514'; END IF;
  IF stored_asset."ai_image_job_id" IS DISTINCT FROM NEW."job_id"
    OR stored_asset."kind" IS DISTINCT FROM 'AI_GENERATED'
    OR stored_asset."source_capture_snapshot_id" IS DISTINCT FROM NEW."source_capture_snapshot_id"
  THEN RAISE EXCEPTION 'listing draft application output is not the generated asset' USING ERRCODE = '23514'; END IF;
  IF stored_before."source_capture_snapshot_id" IS DISTINCT FROM NEW."source_capture_snapshot_id"
    OR stored_after."source_capture_snapshot_id" IS DISTINCT FROM NEW."source_capture_snapshot_id"
  THEN RAISE EXCEPTION 'listing draft application source snapshot is stale' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_media_workflow_inputs" input
    JOIN "media_assets" input_asset ON input_asset."id" = input."asset_id" AND input_asset."owner_user_id" = input."owner_user_id"
    WHERE input."workflow_id" = NEW."workflow_id" AND input."owner_user_id" = NEW."owner_user_id"
      AND input."role"::text <> 'MASK'
      AND input_asset."source_capture_snapshot_id" IS DISTINCT FROM NEW."source_capture_snapshot_id"
  ) THEN RAISE EXCEPTION 'listing draft application input snapshot is stale' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO before_count
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stored_before."payload"->'media'->'assignments') = 'array'
      THEN stored_before."payload"->'media'->'assignments' ELSE '[]'::jsonb END) item
    WHERE item->>'slotKey' = NEW."context_slot_key"
      AND ((nullif(btrim(NEW."context_sku_key"), '') IS NULL AND item->>'scope' = 'PRODUCT')
        OR (nullif(btrim(NEW."context_sku_key"), '') IS NOT NULL AND item->>'scope' = 'SKU'
          AND item->>'skuKey' = NEW."context_sku_key"));
  SELECT count(*) INTO before_slot_count
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stored_before."payload"->'media'->'assignments') = 'array'
      THEN stored_before."payload"->'media'->'assignments' ELSE '[]'::jsonb END) item
    WHERE item->>'slotKey' = NEW."context_slot_key";
  SELECT item INTO before_assignment
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stored_before."payload"->'media'->'assignments') = 'array'
      THEN stored_before."payload"->'media'->'assignments' ELSE '[]'::jsonb END) item
    WHERE item->>'slotKey' = NEW."context_slot_key"
      AND ((nullif(btrim(NEW."context_sku_key"), '') IS NULL AND item->>'scope' = 'PRODUCT')
        OR (nullif(btrim(NEW."context_sku_key"), '') IS NOT NULL AND item->>'scope' = 'SKU'
          AND item->>'skuKey' = NEW."context_sku_key")) LIMIT 1;
  SELECT count(*) INTO after_count
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stored_after."payload"->'media'->'assignments') = 'array'
      THEN stored_after."payload"->'media'->'assignments' ELSE '[]'::jsonb END) item
    WHERE item->>'slotKey' = NEW."context_slot_key"
      AND ((nullif(btrim(NEW."context_sku_key"), '') IS NULL AND item->>'scope' = 'PRODUCT')
        OR (nullif(btrim(NEW."context_sku_key"), '') IS NOT NULL AND item->>'scope' = 'SKU'
          AND item->>'skuKey' = NEW."context_sku_key"));
  SELECT count(*) INTO after_slot_count
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stored_after."payload"->'media'->'assignments') = 'array'
      THEN stored_after."payload"->'media'->'assignments' ELSE '[]'::jsonb END) item
    WHERE item->>'slotKey' = NEW."context_slot_key";
  SELECT item INTO after_assignment
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(stored_after."payload"->'media'->'assignments') = 'array'
      THEN stored_after."payload"->'media'->'assignments' ELSE '[]'::jsonb END) item
    WHERE item->>'slotKey' = NEW."context_slot_key"
      AND ((nullif(btrim(NEW."context_sku_key"), '') IS NULL AND item->>'scope' = 'PRODUCT')
        OR (nullif(btrim(NEW."context_sku_key"), '') IS NOT NULL AND item->>'scope' = 'SKU'
          AND item->>'skuKey' = NEW."context_sku_key")) LIMIT 1;
  IF before_count > 1 OR after_count > 1 OR before_slot_count > 1 OR after_slot_count > 1
    OR (NEW."before_state_json"->'assignment') IS DISTINCT FROM coalesce(before_assignment, 'null'::jsonb)
    OR (NEW."after_state_json"->'assignment') IS DISTINCT FROM coalesce(after_assignment, 'null'::jsonb)
  THEN RAISE EXCEPTION 'listing draft application assignment projection does not match draft payload' USING ERRCODE = '23514'; END IF;
  IF NEW."target_sequence" IS DISTINCT FROM (
    SELECT coalesce(max("target_sequence"), 0) + 1 FROM "ai_media_listing_draft_application_mutations"
    WHERE "owner_user_id" = NEW."owner_user_id" AND "target_id" = NEW."target_id"
  ) THEN RAISE EXCEPTION 'listing draft application target sequence is stale' USING ERRCODE = '40001'; END IF;

  IF NEW."kind" = 'APPLY' THEN
    IF NEW."target_revision_before" IS DISTINCT FROM NEW."context_draft_revision"
      OR NEW."target_draft_version_before" IS DISTINCT FROM NEW."context_draft_version"
    THEN RAISE EXCEPTION 'listing draft application does not start from its frozen context' USING ERRCODE = '23514'; END IF;
    IF stored_workflow."status" IS DISTINCT FROM 'SUCCEEDED'
      OR stored_workflow."review_status" IS DISTINCT FROM 'APPROVED'
      OR stored_workflow."selected_output_asset_id" IS DISTINCT FROM NEW."asset_id"
      OR stored_job."status" IS DISTINCT FROM 'SUCCEEDED'
      OR stored_job."applied_at" IS NOT NULL
    THEN RAISE EXCEPTION 'listing draft application output is not the reviewed job asset' USING ERRCODE = '23514'; END IF;
    IF (stored_job."operation"::text = 'IMAGE_TO_IMAGE' AND NEW."after_state_json"->'assignment'->>'source' IS DISTINCT FROM 'GENERATED')
      OR (stored_job."operation"::text = 'IMAGE_TRANSLATE' AND NEW."after_state_json"->'assignment'->>'source' IS DISTINCT FROM 'TRANSLATED')
      OR (stored_job."operation"::text IN ('FULL_EDIT', 'INPAINT') AND NEW."after_state_json"->'assignment'->>'source' IS DISTINCT FROM 'EDITED')
      OR stored_job."operation"::text NOT IN ('IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT')
    THEN RAISE EXCEPTION 'listing draft application source does not match operation' USING ERRCODE = '23514'; END IF;
    IF NEW."after_state_json"->'assignment'->>'assetId' IS DISTINCT FROM NEW."asset_id"
      OR NEW."after_state_json"->'assignment'->>'slotKey' IS DISTINCT FROM NEW."context_slot_key"
      OR (nullif(btrim(NEW."context_sku_key"), '') IS NULL AND NEW."after_state_json"->'assignment'->>'scope' IS DISTINCT FROM 'PRODUCT')
      OR (nullif(btrim(NEW."context_sku_key"), '') IS NOT NULL AND (NEW."after_state_json"->'assignment'->>'scope' IS DISTINCT FROM 'SKU'
        OR NEW."after_state_json"->'assignment'->>'skuKey' IS DISTINCT FROM NEW."context_sku_key"))
    THEN RAISE EXCEPTION 'listing draft application output scope does not match frozen slot' USING ERRCODE = '23514'; END IF;
    IF after_count <> 1 OR after_slot_count <> 1
      OR (NEW."mode" = 'APPEND' AND before_slot_count <> 0)
      OR (NEW."mode" = 'REPLACE' AND (before_count <> 1 OR before_slot_count <> 1 OR NEW."replace_confirmed" IS NOT TRUE))
    THEN RAISE EXCEPTION 'listing draft application mode does not match slot occupancy' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT * INTO stored_apply FROM "ai_media_listing_draft_application_mutations"
      WHERE "id" = NEW."rollback_of_id" AND "owner_user_id" = NEW."owner_user_id" AND "kind" = 'APPLY';
    IF stored_apply."id" IS NULL
      OR NEW."workflow_id" IS DISTINCT FROM stored_apply."workflow_id"
      OR NEW."job_id" IS DISTINCT FROM stored_apply."job_id"
      OR NEW."asset_id" IS DISTINCT FROM stored_apply."asset_id"
      OR NEW."source_capture_snapshot_id" IS DISTINCT FROM stored_apply."source_capture_snapshot_id"
      OR NEW."target_id" IS DISTINCT FROM stored_apply."target_id"
      OR NEW."mode" IS DISTINCT FROM stored_apply."mode"
      OR NEW."replace_confirmed" IS DISTINCT FROM stored_apply."replace_confirmed"
      OR NEW."context_sku_key" IS DISTINCT FROM stored_apply."context_sku_key"
      OR NEW."context_slot_key" IS DISTINCT FROM stored_apply."context_slot_key"
      OR NEW."context_draft_revision" IS DISTINCT FROM stored_apply."context_draft_revision"
      OR NEW."context_draft_version" IS DISTINCT FROM stored_apply."context_draft_version"
      OR NEW."before_state_json" IS DISTINCT FROM stored_apply."after_state_json"
      OR NEW."before_state_hash" IS DISTINCT FROM stored_apply."after_state_hash"
      OR NEW."after_state_json" IS DISTINCT FROM stored_apply."before_state_json"
      OR NEW."after_state_hash" IS DISTINCT FROM stored_apply."before_state_hash"
    THEN RAISE EXCEPTION 'listing draft application rollback does not mirror the applied assignment' USING ERRCODE = '23514'; END IF;
    IF EXISTS (
      SELECT 1 FROM "ai_media_listing_draft_application_mutations" later_apply
      WHERE later_apply."owner_user_id" = NEW."owner_user_id"
        AND later_apply."target_id" = NEW."target_id"
        AND later_apply."kind" = 'APPLY'
        AND later_apply."target_sequence" > stored_apply."target_sequence"
        AND NOT EXISTS (
          SELECT 1 FROM "ai_media_listing_draft_application_mutations" compensation
          WHERE compensation."rollback_of_id" = later_apply."id"
            AND compensation."owner_user_id" = later_apply."owner_user_id"
            AND compensation."kind" = 'ROLLBACK'
        )
    ) THEN RAISE EXCEPTION 'listing draft application rollback is not the current target frontier' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_listing_draft_mutation_validate_insert"
BEFORE INSERT ON "ai_media_listing_draft_application_mutations"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_listing_draft_application_mutation_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_listing_draft_application_mutations_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media listing-draft application mutations are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_listing_draft_mutation_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_listing_draft_application_mutations"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_listing_draft_application_mutations_immutable();

COMMIT;
