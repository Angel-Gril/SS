BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_scope(
  target_workflow_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  workflow "ai_media_workflows"%ROWTYPE;
  source_asset "media_assets"%ROWTYPE;
BEGIN
  SELECT * INTO workflow
  FROM "ai_media_workflows"
  WHERE "id" = target_workflow_id
    AND "owner_user_id" = target_owner_user_id;

  IF NOT FOUND OR workflow."operation" NOT IN ('FULL_EDIT', 'INPAINT') THEN
    RETURN;
  END IF;

  SELECT asset.* INTO source_asset
  FROM "ai_media_workflow_inputs" input
  JOIN "media_assets" asset
    ON asset."id" = input."asset_id"
   AND asset."owner_user_id" = input."owner_user_id"
  WHERE input."workflow_id" = workflow."id"
    AND input."owner_user_id" = workflow."owner_user_id"
    AND input."role" = 'REFERENCE'
    AND input."ordinal" = 0;

  IF NOT FOUND OR source_asset."kind" IS DISTINCT FROM 'AI_GENERATED' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_image_jobs" origin_job
    JOIN "ai_media_workflows" origin_workflow
      ON origin_workflow."id" = origin_job."workflow_id"
     AND origin_workflow."owner_user_id" = origin_job."owner_user_id"
    WHERE origin_job."id" = source_asset."ai_image_job_id"
      AND origin_job."owner_user_id" = source_asset."owner_user_id"
      AND origin_workflow."context_sku_key" IS NOT DISTINCT FROM workflow."context_sku_key"
      AND origin_workflow."context_slot_key" IS NOT DISTINCT FROM workflow."context_slot_key"
  ) THEN
    RAISE EXCEPTION 'manual AI image edit candidate SKU or slot scope is invalid'
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_scope_from_workflow() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_image_edit_candidate_scope(NEW."id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_scope_from_input() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_image_edit_candidate_scope(NEW."workflow_id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  candidate RECORD;
BEGIN
  FOR candidate IN
    SELECT "id", "owner_user_id"
    FROM "ai_media_workflows"
    WHERE "operation" IN ('FULL_EDIT', 'INPAINT')
  LOOP
    PERFORM assert_ai_image_edit_candidate_scope(candidate."id", candidate."owner_user_id");
  END LOOP;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_scope_workflow"
AFTER INSERT OR UPDATE ON "ai_media_workflows"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_scope_from_workflow();

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_scope_input"
AFTER INSERT OR UPDATE ON "ai_media_workflow_inputs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_scope_from_input();

COMMIT;
