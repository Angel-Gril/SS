BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_media_workflow_inputs" input
    JOIN "media_assets" asset
      ON asset."id" = input."asset_id"
     AND asset."owner_user_id" = input."owner_user_id"
    WHERE input."asset_sha256" IS NULL
       OR input."asset_sha256" IS DISTINCT FROM asset."sha256"
       OR input."asset_url" IS DISTINCT FROM asset."url"
       OR input."mime_type" IS DISTINCT FROM asset."mime_type"
       OR input."width" IS DISTINCT FROM asset."width"
       OR input."height" IS DISTINCT FROM asset."height"
  ) THEN
    RAISE EXCEPTION 'existing AI media workflow input snapshot does not match its asset';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_image_jobs" job
    JOIN "ai_media_workflows" workflow
      ON workflow."id" = job."workflow_id"
     AND workflow."owner_user_id" = job."owner_user_id"
    WHERE job."workflow_id" IS NOT NULL
      AND (
        job."workflow_attempt" IS NULL
        OR job."workflow_attempt" < 1
        OR job."operation" IS DISTINCT FROM workflow."operation"
      )
  ) THEN
    RAISE EXCEPTION 'existing AI media workflow child job binding is invalid';
  END IF;
END;
$$;

ALTER TABLE "ai_media_workflow_inputs"
  ALTER COLUMN "asset_sha256" SET NOT NULL;

ALTER TABLE "ai_image_jobs"
  ADD CONSTRAINT "ai_image_job_workflow_attempt_pair"
  CHECK (
    ("workflow_id" IS NULL AND "workflow_attempt" IS NULL)
    OR
    ("workflow_id" IS NOT NULL AND "workflow_attempt" IS NOT NULL AND "workflow_attempt" >= 1)
  ) NOT VALID;

ALTER TABLE "ai_image_jobs"
  VALIDATE CONSTRAINT "ai_image_job_workflow_attempt_pair";

ALTER TABLE "media_assets"
  DROP CONSTRAINT "media_assets_ai_image_job_id_fkey",
  ADD CONSTRAINT "media_assets_ai_image_job_id_fkey"
    FOREIGN KEY ("ai_image_job_id") REFERENCES "ai_image_jobs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_ai_media_workflow_input_insert() RETURNS trigger AS $$
DECLARE
  stored_asset "media_assets"%ROWTYPE;
BEGIN
  SELECT *
  INTO stored_asset
  FROM "media_assets"
  WHERE "id" = NEW."asset_id"
    AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow input asset does not exist for owner' USING ERRCODE = '23503';
  END IF;

  IF stored_asset."sha256" IS NULL
    OR NEW."asset_sha256" IS DISTINCT FROM stored_asset."sha256"
    OR NEW."asset_url" IS DISTINCT FROM stored_asset."url"
    OR NEW."mime_type" IS DISTINCT FROM stored_asset."mime_type"
    OR NEW."width" IS DISTINCT FROM stored_asset."width"
    OR NEW."height" IS DISTINCT FROM stored_asset."height"
  THEN
    RAISE EXCEPTION 'workflow input snapshot does not match locked asset' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_workflow_inputs_validate_snapshot"
BEFORE INSERT ON "ai_media_workflow_inputs"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_workflow_input_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_workflow_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    OR NEW."operation" IS DISTINCT FROM OLD."operation"
    OR NEW."context_type" IS DISTINCT FROM OLD."context_type"
    OR NEW."context_id" IS DISTINCT FROM OLD."context_id"
    OR NEW."context_sku_key" IS DISTINCT FROM OLD."context_sku_key"
    OR NEW."context_slot_key" IS DISTINCT FROM OLD."context_slot_key"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media workflow identity is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_workflows_identity_immutable"
BEFORE UPDATE ON "ai_media_workflows"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_workflow_identity();

CREATE OR REPLACE FUNCTION validate_ai_media_workflow_job_binding() RETURNS trigger AS $$
BEGIN
  IF NEW."workflow_id" IS NULL THEN
    IF NEW."workflow_attempt" IS NOT NULL THEN
      RAISE EXCEPTION 'workflow attempt requires a workflow' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."workflow_attempt" IS NULL OR NEW."workflow_attempt" < 1 THEN
    RAISE EXCEPTION 'workflow child job requires a positive attempt' USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM "ai_media_workflows"
  WHERE "id" = NEW."workflow_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "operation" = NEW."operation"
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow child job does not match workflow identity' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_validate_workflow_binding"
BEFORE INSERT OR UPDATE OF "workflow_id", "workflow_attempt", "owner_user_id", "operation"
ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_workflow_job_binding();

CREATE OR REPLACE FUNCTION protect_ai_media_workflow_job_identity() RETURNS trigger AS $$
BEGIN
  IF OLD."provider_job_id" IS NOT NULL
    AND NEW."provider_job_id" IS DISTINCT FROM OLD."provider_job_id"
  THEN
    RAISE EXCEPTION 'AI image provider job identity cannot be cleared or replaced' USING ERRCODE = '55000';
  END IF;

  IF NEW."workflow_id" IS DISTINCT FROM OLD."workflow_id"
    OR NEW."workflow_attempt" IS DISTINCT FROM OLD."workflow_attempt"
  THEN
    RAISE EXCEPTION 'AI media workflow child binding is insert-time immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."workflow_id" IS NOT NULL AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    OR NEW."operation" IS DISTINCT FROM OLD."operation"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."model" IS DISTINCT FROM OLD."model"
    OR NEW."prompt" IS DISTINCT FROM OLD."prompt"
    OR NEW."negative_prompt" IS DISTINCT FROM OLD."negative_prompt"
    OR NEW."resolved_prompt" IS DISTINCT FROM OLD."resolved_prompt"
    OR NEW."resolved_negative_prompt" IS DISTINCT FROM OLD."resolved_negative_prompt"
    OR NEW."template_key" IS DISTINCT FROM OLD."template_key"
    OR NEW."template_release_id" IS DISTINCT FROM OLD."template_release_id"
    OR NEW."template_checksum" IS DISTINCT FROM OLD."template_checksum"
    OR NEW."template_snapshot_json" IS DISTINCT FROM OLD."template_snapshot_json"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."input_assets_json" IS DISTINCT FROM OLD."input_assets_json"
    OR NEW."requested_image_count" IS DISTINCT FROM OLD."requested_image_count"
    OR NEW."width" IS DISTINCT FROM OLD."width"
    OR NEW."height" IS DISTINCT FROM OLD."height"
    OR NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."estimated_cost_cents" IS DISTINCT FROM OLD."estimated_cost_cents"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'AI media workflow child request is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_workflow_request_immutable"
BEFORE UPDATE ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_workflow_job_identity();

CREATE OR REPLACE FUNCTION protect_referenced_media_asset_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."ai_image_job_id" IS DISTINCT FROM OLD."ai_image_job_id" THEN
    RAISE EXCEPTION 'media asset job binding is insert-time immutable' USING ERRCODE = '55000';
  END IF;

  IF (
    EXISTS (
      SELECT 1 FROM "ai_media_workflow_inputs"
      WHERE "asset_id" = OLD."id"
        AND "owner_user_id" = OLD."owner_user_id"
    )
    OR EXISTS (
      SELECT 1 FROM "media_asset_lineage"
      WHERE "owner_user_id" = OLD."owner_user_id"
        AND ("input_asset_id" = OLD."id" OR "output_asset_id" = OLD."id")
    )
    OR EXISTS (
      SELECT 1 FROM "ai_media_workflows"
      WHERE "selected_output_asset_id" = OLD."id"
        AND "owner_user_id" = OLD."owner_user_id"
    )
    OR EXISTS (
      SELECT 1 FROM "ai_media_workflow_events"
      WHERE "asset_id" = OLD."id"
        AND "owner_user_id" = OLD."owner_user_id"
    )
  ) AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."ai_image_job_id" IS DISTINCT FROM OLD."ai_image_job_id"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM OLD."source_capture_snapshot_id"
    OR NEW."source_media_key" IS DISTINCT FROM OLD."source_media_key"
    OR NEW."source_url" IS DISTINCT FROM OLD."source_url"
    OR NEW."url" IS DISTINCT FROM OLD."url"
    OR NEW."storage_backend" IS DISTINCT FROM OLD."storage_backend"
    OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
    OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
    OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
    OR NEW."width" IS DISTINCT FROM OLD."width"
    OR NEW."height" IS DISTINCT FROM OLD."height"
    OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'referenced media asset identity is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
