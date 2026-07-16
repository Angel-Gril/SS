BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_media_workflow_inputs"
  DROP CONSTRAINT "ai_media_workflow_inputs_workflow_id_owner_user_id_fkey",
  ADD CONSTRAINT "ai_media_workflow_inputs_workflow_id_owner_user_id_fkey"
    FOREIGN KEY ("workflow_id", "owner_user_id")
    REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_media_workflow_events"
  DROP CONSTRAINT "ai_media_workflow_events_workflow_id_owner_user_id_fkey",
  ADD CONSTRAINT "ai_media_workflow_events_workflow_id_owner_user_id_fkey"
    FOREIGN KEY ("workflow_id", "owner_user_id")
    REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_workflow_events_job_id_owner_user_id_fkey"
    FOREIGN KEY ("job_id", "owner_user_id")
    REFERENCES "ai_image_jobs"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_workflow_events_asset_id_owner_user_id_fkey"
    FOREIGN KEY ("asset_id", "owner_user_id")
    REFERENCES "media_assets"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_workflow_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "media_asset_lineage_immutable"
BEFORE UPDATE OR DELETE ON "media_asset_lineage"
FOR EACH ROW EXECUTE FUNCTION reject_ai_media_immutable_mutation();

CREATE OR REPLACE FUNCTION validate_media_asset_lineage_insert() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ai_image_jobs"
    WHERE "id" = NEW."job_id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "workflow_id" = NEW."workflow_id"
      AND "operation" = NEW."operation"
  ) THEN
    RAISE EXCEPTION 'lineage job does not belong to workflow' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ai_media_workflow_inputs"
    WHERE "workflow_id" = NEW."workflow_id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "asset_id" = NEW."input_asset_id"
      AND "role" = NEW."input_role"
      AND "ordinal" = NEW."ordinal"
  ) THEN
    RAISE EXCEPTION 'lineage input is not a frozen workflow input' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "media_assets"
    WHERE "id" = NEW."output_asset_id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "ai_image_job_id" = NEW."job_id"
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'lineage output was not produced by job' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_asset_lineage_validate_insert"
BEFORE INSERT ON "media_asset_lineage"
FOR EACH ROW EXECUTE FUNCTION validate_media_asset_lineage_insert();

CREATE OR REPLACE FUNCTION protect_referenced_media_asset_identity() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ai_media_workflow_inputs"
    WHERE "asset_id" = OLD."id"
      AND "owner_user_id" = OLD."owner_user_id"
    UNION ALL
    SELECT 1 FROM "media_asset_lineage"
    WHERE "owner_user_id" = OLD."owner_user_id"
      AND ("input_asset_id" = OLD."id" OR "output_asset_id" = OLD."id")
  ) AND (
    NEW."url" IS DISTINCT FROM OLD."url"
    OR NEW."storage_backend" IS DISTINCT FROM OLD."storage_backend"
    OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
    OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
    OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
    OR NEW."width" IS DISTINCT FROM OLD."width"
    OR NEW."height" IS DISTINCT FROM OLD."height"
    OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
  ) THEN
    RAISE EXCEPTION 'referenced media asset identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_assets_referenced_identity_immutable"
BEFORE UPDATE OF
  "id",
  "owner_user_id",
  "ai_image_job_id",
  "kind",
  "source_capture_snapshot_id",
  "source_media_key",
  "source_url",
  "url",
  "storage_backend",
  "storage_key",
  "mime_type",
  "size_bytes",
  "width",
  "height",
  "sha256",
  "created_at"
ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION protect_referenced_media_asset_identity();

COMMIT;
