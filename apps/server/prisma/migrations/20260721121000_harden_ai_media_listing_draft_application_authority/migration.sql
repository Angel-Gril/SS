BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_media_listing_draft_application_mutations"
  ADD CONSTRAINT "ai_media_listing_draft_mutation_context_sku_check"
  CHECK ("context_sku_key" IS NULL OR btrim("context_sku_key") <> '');

CREATE OR REPLACE FUNCTION validate_ai_media_listing_draft_application_mutation_authority() RETURNS trigger AS $$
DECLARE
  stored_workflow "ai_media_workflows"%ROWTYPE;
  stored_job "ai_image_jobs"%ROWTYPE;
  before_asset_id TEXT;
  after_asset_id TEXT;
  before_source TEXT;
  after_source TEXT;
BEGIN
  SELECT * INTO stored_workflow
  FROM "ai_media_workflows"
  WHERE "id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id";
  SELECT * INTO stored_job
  FROM "ai_image_jobs"
  WHERE "id" = NEW."job_id" AND "owner_user_id" = NEW."owner_user_id";
  IF stored_workflow."id" IS NULL OR stored_job."id" IS NULL THEN
    RAISE EXCEPTION 'listing draft application authority graph is missing' USING ERRCODE = '23514';
  END IF;
  IF NEW."operation"::text IS DISTINCT FROM stored_workflow."operation"::text
    OR NEW."operation"::text IS DISTINCT FROM stored_job."operation"::text
  THEN
    RAISE EXCEPTION 'listing draft application operation is not frozen' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ai_media_suite_slots"
    WHERE "child_workflow_id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id"
  ) THEN
    RAISE EXCEPTION 'listing draft application does not support suite child workflows' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ai_media_workflow_inputs" input
    WHERE input."workflow_id" = NEW."workflow_id"
      AND input."owner_user_id" = NEW."owner_user_id"
      AND input."role"::text <> 'MASK'
  ) THEN
    RAISE EXCEPTION 'listing draft application requires a frozen source input' USING ERRCODE = '23514';
  END IF;

  before_asset_id := NEW."before_state_json"->'assignment'->>'assetId';
  after_asset_id := NEW."after_state_json"->'assignment'->>'assetId';
  before_source := NEW."before_state_json"->'assignment'->>'source';
  after_source := NEW."after_state_json"->'assignment'->>'source';
  IF before_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "media_assets" asset
    WHERE asset."id" = before_asset_id
      AND asset."owner_user_id" = NEW."owner_user_id"
      AND asset."source_capture_snapshot_id" = NEW."source_capture_snapshot_id"
  ) THEN
    RAISE EXCEPTION 'listing draft application before assignment asset authority is invalid' USING ERRCODE = '23514';
  END IF;
  IF after_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "media_assets" asset
    WHERE asset."id" = after_asset_id
      AND asset."owner_user_id" = NEW."owner_user_id"
      AND asset."source_capture_snapshot_id" = NEW."source_capture_snapshot_id"
  ) THEN
    RAISE EXCEPTION 'listing draft application after assignment asset authority is invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'APPLY' THEN
    IF after_asset_id IS DISTINCT FROM NEW."asset_id"
      OR after_source IS DISTINCT FROM (CASE NEW."operation"::text
        WHEN 'IMAGE_TO_IMAGE' THEN 'GENERATED'
        WHEN 'IMAGE_TRANSLATE' THEN 'TRANSLATED'
        WHEN 'FULL_EDIT' THEN 'EDITED'
        WHEN 'INPAINT' THEN 'EDITED'
        ELSE NULL
      END)
    THEN
      RAISE EXCEPTION 'listing draft application output source is invalid' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF before_asset_id IS DISTINCT FROM NEW."asset_id"
      OR before_source IS DISTINCT FROM (CASE NEW."operation"::text
        WHEN 'IMAGE_TO_IMAGE' THEN 'GENERATED'
        WHEN 'IMAGE_TRANSLATE' THEN 'TRANSLATED'
        WHEN 'FULL_EDIT' THEN 'EDITED'
        WHEN 'INPAINT' THEN 'EDITED'
        ELSE NULL
      END)
    THEN
      RAISE EXCEPTION 'listing draft rollback source is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_listing_draft_mutation_authority_insert"
BEFORE INSERT ON "ai_media_listing_draft_application_mutations"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_listing_draft_application_mutation_authority();

COMMIT;
