BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TYPE "AiMediaApplicationMutationKind" AS ENUM ('APPLY', 'ROLLBACK');
CREATE TYPE "AiMediaApplicationMode" AS ENUM ('APPEND', 'REPLACE');

CREATE TABLE "ai_media_application_mutations" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "kind" "AiMediaApplicationMutationKind" NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "rollback_of_id" TEXT,
  "target_type" VARCHAR(30) NOT NULL,
  "target_id" VARCHAR(200) NOT NULL,
  "target_sequence" INTEGER NOT NULL,
  "mode" "AiMediaApplicationMode" NOT NULL,
  "context_sku_key" VARCHAR(500),
  "context_slot_key" VARCHAR(1024),
  "operation_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "workflow_revision_before" INTEGER NOT NULL,
  "workflow_revision_after" INTEGER NOT NULL,
  "target_version_before" TIMESTAMP(3) NOT NULL,
  "target_version_after" TIMESTAMP(3) NOT NULL,
  "before_state_json" JSONB NOT NULL,
  "before_state_hash" CHAR(64) NOT NULL,
  "after_state_json" JSONB NOT NULL,
  "after_state_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_application_mutations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_application_mutation_values_check" CHECK (
    "revision" = 1
    AND "target_type" = 'collect'
    AND btrim("target_id") <> ''
    AND "target_sequence" >= 1
    AND btrim("operation_key") <> ''
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "workflow_revision_before" >= 1
    AND "workflow_revision_after" = "workflow_revision_before" + 1
    AND "target_version_after" > "target_version_before"
    AND "before_state_hash" ~ '^[0-9a-f]{64}$'
    AND "after_state_hash" ~ '^[0-9a-f]{64}$'
    AND "before_state_hash" <> "after_state_hash"
    AND (("kind" = 'APPLY' AND "rollback_of_id" IS NULL)
      OR ("kind" = 'ROLLBACK' AND "rollback_of_id" IS NOT NULL))
  ),
  CONSTRAINT "ai_media_application_mutation_before_state_check" CHECK (
    jsonb_typeof("before_state_json") = 'object'
    AND "before_state_json"->>'version' = 'ai-media-collect-projection/v1'
    AND "before_state_json" ? 'images'
    AND jsonb_typeof("before_state_json"->'watermarkedImages') = 'object'
    AND jsonb_typeof("before_state_json"->'editedImages') = 'object'
    AND jsonb_typeof("before_state_json"->'watermarkedImages'->'present') = 'boolean'
    AND "before_state_json"->'watermarkedImages' ? 'value'
    AND jsonb_typeof("before_state_json"->'editedImages'->'present') = 'boolean'
    AND "before_state_json"->'editedImages' ? 'value'
    AND (jsonb_typeof("before_state_json"->'images') <> 'array'
      OR jsonb_array_length("before_state_json"->'images') <= 100)
    AND (jsonb_typeof("before_state_json"->'watermarkedImages'->'value') <> 'array'
      OR jsonb_array_length("before_state_json"->'watermarkedImages'->'value') <= 100)
    AND (jsonb_typeof("before_state_json"->'editedImages'->'value') <> 'array'
      OR jsonb_array_length("before_state_json"->'editedImages'->'value') <= 100)
    AND octet_length("before_state_json"::text) <= 262144
  ),
  CONSTRAINT "ai_media_application_mutation_after_state_check" CHECK (
    jsonb_typeof("after_state_json") = 'object'
    AND "after_state_json"->>'version' = 'ai-media-collect-projection/v1'
    AND "after_state_json" ? 'images'
    AND jsonb_typeof("after_state_json"->'watermarkedImages') = 'object'
    AND jsonb_typeof("after_state_json"->'editedImages') = 'object'
    AND jsonb_typeof("after_state_json"->'watermarkedImages'->'present') = 'boolean'
    AND "after_state_json"->'watermarkedImages' ? 'value'
    AND jsonb_typeof("after_state_json"->'editedImages'->'present') = 'boolean'
    AND "after_state_json"->'editedImages' ? 'value'
    AND (jsonb_typeof("after_state_json"->'images') <> 'array'
      OR jsonb_array_length("after_state_json"->'images') <= 100)
    AND (jsonb_typeof("after_state_json"->'watermarkedImages'->'value') <> 'array'
      OR jsonb_array_length("after_state_json"->'watermarkedImages'->'value') <= 100)
    AND (jsonb_typeof("after_state_json"->'editedImages'->'value') <> 'array'
      OR jsonb_array_length("after_state_json"->'editedImages'->'value') <= 100)
    AND octet_length("after_state_json"::text) <= 262144
  )
);

CREATE UNIQUE INDEX "ai_media_application_mutation_id_owner_key"
  ON "ai_media_application_mutations"("id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_application_mutation_rollback_of_key"
  ON "ai_media_application_mutations"("rollback_of_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_application_mutation_owner_operation_key"
  ON "ai_media_application_mutations"("owner_user_id", "operation_key");
CREATE UNIQUE INDEX "ai_media_application_mutation_job_kind_key"
  ON "ai_media_application_mutations"("job_id", "kind");
CREATE UNIQUE INDEX "ai_media_application_mutation_target_sequence_key"
  ON "ai_media_application_mutations"("owner_user_id", "target_type", "target_id", "target_sequence");
CREATE INDEX "ai_media_application_mutation_target_history_idx"
  ON "ai_media_application_mutations"("owner_user_id", "target_type", "target_id", "target_sequence" DESC);
CREATE INDEX "ai_media_application_mutation_workflow_history_idx"
  ON "ai_media_application_mutations"("workflow_id", "created_at" DESC);

ALTER TABLE "ai_media_application_mutations"
  ADD CONSTRAINT "ai_media_application_mutations_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_application_mutations_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_application_mutations_workflow_id_owner_user_id_fkey"
    FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_application_mutations_job_id_owner_user_id_fkey"
    FOREIGN KEY ("job_id", "owner_user_id") REFERENCES "ai_image_jobs"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_application_mutations_asset_id_owner_user_id_fkey"
    FOREIGN KEY ("asset_id", "owner_user_id") REFERENCES "media_assets"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_application_mutations_rollback_of_id_owner_user_id_fkey"
    FOREIGN KEY ("rollback_of_id", "owner_user_id") REFERENCES "ai_media_application_mutations"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION validate_ai_media_application_mutation_insert() RETURNS trigger AS $$
DECLARE
  stored_workflow "ai_media_workflows"%ROWTYPE;
  stored_job "ai_image_jobs"%ROWTYPE;
  stored_asset "media_assets"%ROWTYPE;
  stored_apply "ai_media_application_mutations"%ROWTYPE;
  expected_target_sequence INTEGER;
BEGIN
  SELECT * INTO stored_workflow
  FROM "ai_media_workflows"
  WHERE "id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR KEY SHARE;

  SELECT * INTO stored_job
  FROM "ai_image_jobs"
  WHERE "id" = NEW."job_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR KEY SHARE;

  SELECT * INTO stored_asset
  FROM "media_assets"
  WHERE "id" = NEW."asset_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR KEY SHARE;

  IF stored_job."workflow_id" IS DISTINCT FROM NEW."workflow_id" THEN
    RAISE EXCEPTION 'application mutation job does not belong to workflow' USING ERRCODE = '23514';
  END IF;
  IF stored_asset."ai_image_job_id" IS DISTINCT FROM NEW."job_id"
    OR stored_asset."kind" IS DISTINCT FROM 'AI_GENERATED'
  THEN
    RAISE EXCEPTION 'application mutation output is not the reviewed job asset' USING ERRCODE = '23514';
  END IF;
  IF stored_workflow."context_type" IS DISTINCT FROM NEW."target_type"
    OR stored_workflow."context_id" IS DISTINCT FROM NEW."target_id"
    OR stored_workflow."context_sku_key" IS DISTINCT FROM NEW."context_sku_key"
    OR stored_workflow."context_slot_key" IS DISTINCT FROM NEW."context_slot_key"
  THEN
    RAISE EXCEPTION 'application mutation target does not match workflow context' USING ERRCODE = '23514';
  END IF;
  IF stored_workflow."revision" IS DISTINCT FROM NEW."workflow_revision_before" THEN
    RAISE EXCEPTION 'application mutation workflow revision is stale' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(max("target_sequence"), 0) + 1
  INTO expected_target_sequence
  FROM "ai_media_application_mutations"
  WHERE "owner_user_id" = NEW."owner_user_id"
    AND "target_type" = NEW."target_type"
    AND "target_id" = NEW."target_id";
  IF NEW."target_sequence" IS DISTINCT FROM expected_target_sequence THEN
    RAISE EXCEPTION 'application mutation target sequence is stale' USING ERRCODE = '40001';
  END IF;

  IF NEW."kind" = 'APPLY' THEN
    IF stored_job."status" IS DISTINCT FROM 'SUCCEEDED'
      OR stored_workflow."status" IS DISTINCT FROM 'SUCCEEDED'
      OR stored_workflow."review_status" IS DISTINCT FROM 'APPROVED'
      OR stored_workflow."selected_output_asset_id" IS DISTINCT FROM NEW."asset_id"
    THEN
      RAISE EXCEPTION 'application mutation output is not the reviewed job asset' USING ERRCODE = '23514';
    END IF;
    IF stored_job."applied_at" IS NOT NULL THEN
      RAISE EXCEPTION 'application mutation job was already applied without this ledger' USING ERRCODE = '23514';
    END IF;
    IF NEW."mode" = 'REPLACE' AND (
      stored_job."operation" IS DISTINCT FROM 'IMAGE_TO_IMAGE'
      OR EXISTS (
        SELECT 1 FROM "ai_media_suite_slots"
        WHERE "child_workflow_id" = NEW."workflow_id"
          AND "owner_user_id" = NEW."owner_user_id"
      )
    ) THEN
      RAISE EXCEPTION 'application replace mode is not allowed for this workflow' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO stored_apply
    FROM "ai_media_application_mutations"
    WHERE "id" = NEW."rollback_of_id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "kind" = 'APPLY'
    FOR KEY SHARE;

    IF stored_apply."id" IS NULL
      OR NEW."workflow_id" IS DISTINCT FROM stored_apply."workflow_id"
      OR NEW."job_id" IS DISTINCT FROM stored_apply."job_id"
      OR NEW."asset_id" IS DISTINCT FROM stored_apply."asset_id"
      OR NEW."target_type" IS DISTINCT FROM stored_apply."target_type"
      OR NEW."target_id" IS DISTINCT FROM stored_apply."target_id"
      OR NEW."mode" IS DISTINCT FROM stored_apply."mode"
      OR NEW."context_sku_key" IS DISTINCT FROM stored_apply."context_sku_key"
      OR NEW."context_slot_key" IS DISTINCT FROM stored_apply."context_slot_key"
      OR NEW."before_state_json" IS DISTINCT FROM stored_apply."after_state_json"
      OR NEW."before_state_hash" IS DISTINCT FROM stored_apply."after_state_hash"
      OR NEW."after_state_json" IS DISTINCT FROM stored_apply."before_state_json"
      OR NEW."after_state_hash" IS DISTINCT FROM stored_apply."before_state_hash"
    THEN
      RAISE EXCEPTION 'application rollback does not mirror the applied projection' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "ai_media_application_mutations" later_apply
      WHERE later_apply."owner_user_id" = NEW."owner_user_id"
        AND later_apply."target_type" = NEW."target_type"
        AND later_apply."target_id" = NEW."target_id"
        AND later_apply."kind" = 'APPLY'
        AND later_apply."target_sequence" > stored_apply."target_sequence"
        AND NOT EXISTS (
          SELECT 1
          FROM "ai_media_application_mutations" compensation
          WHERE compensation."rollback_of_id" = later_apply."id"
            AND compensation."owner_user_id" = later_apply."owner_user_id"
            AND compensation."kind" = 'ROLLBACK'
        )
    ) THEN
      RAISE EXCEPTION 'application rollback is not the current target frontier' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_application_mutations_validate_insert"
BEFORE INSERT ON "ai_media_application_mutations"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_application_mutation_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_application_mutations_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media application mutations are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_application_mutations_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_application_mutations"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_application_mutations_immutable();

COMMIT;
