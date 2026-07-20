BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

LOCK TABLE
  "ai_image_jobs",
  "ai_media_suite_slots",
  "ai_media_workflow_inputs",
  "ai_media_workflows",
  "media_assets"
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_contract(
  target_workflow_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  workflow "ai_media_workflows"%ROWTYPE;
  source_asset "media_assets"%ROWTYPE;
  source_asset_id TEXT;
  origin_job_id TEXT;
  origin_workflow_id TEXT;
  rechecked_origin_workflow_id TEXT;
BEGIN
  SELECT * INTO workflow
  FROM "ai_media_workflows"
  WHERE "id" = target_workflow_id
    AND "owner_user_id" = target_owner_user_id;

  IF NOT FOUND OR workflow."operation" NOT IN ('FULL_EDIT', 'INPAINT') THEN
    RETURN;
  END IF;

  SELECT input."asset_id" INTO source_asset_id
  FROM "ai_media_workflow_inputs" input
  WHERE input."workflow_id" = workflow."id"
    AND input."owner_user_id" = workflow."owner_user_id"
    AND input."role" = 'REFERENCE'
    AND input."ordinal" = 0;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT asset.*
  INTO source_asset
  FROM "media_assets" asset
  WHERE asset."id" = source_asset_id
    AND asset."owner_user_id" = workflow."owner_user_id";

  IF NOT FOUND OR source_asset."kind" IS DISTINCT FROM 'AI_GENERATED' THEN
    RETURN;
  END IF;

  origin_job_id := source_asset."ai_image_job_id";

  SELECT job."workflow_id" INTO origin_workflow_id
  FROM "ai_image_jobs" job
  WHERE job."id" = origin_job_id
    AND job."owner_user_id" = source_asset."owner_user_id";

  -- A valid generated candidate always has a durable origin workflow. Without
  -- it there is no row that can serialize a new consumer with a later attach.
  IF origin_workflow_id IS NULL THEN
    RAISE EXCEPTION 'manual AI image edit generated source origin workflow is required'
      USING ERRCODE = '23514';
  END IF;

  PERFORM lock_ai_image_edit_origin_workflows(
    source_asset."owner_user_id",
    ARRAY[origin_workflow_id]
  );

  -- Re-read every mutable authority row after taking the workflow mutex.
  SELECT asset.*
  INTO source_asset
  FROM "media_assets" asset
  WHERE asset."id" = source_asset_id
    AND asset."owner_user_id" = workflow."owner_user_id";

  IF NOT FOUND OR source_asset."kind" IS DISTINCT FROM 'AI_GENERATED' THEN
    RAISE EXCEPTION 'manual AI image edit generated source authority is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF source_asset."ai_image_job_id" IS DISTINCT FROM origin_job_id THEN
    RAISE EXCEPTION 'manual AI image edit generated source authority changed while locking'
      USING ERRCODE = '40001';
  END IF;

  SELECT job."workflow_id" INTO rechecked_origin_workflow_id
  FROM "ai_image_jobs" job
  WHERE job."id" = source_asset."ai_image_job_id"
    AND job."owner_user_id" = source_asset."owner_user_id";

  IF rechecked_origin_workflow_id IS DISTINCT FROM origin_workflow_id THEN
    RAISE EXCEPTION 'manual AI image edit generated source authority is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(source_asset."source_capture_snapshot_id", '') !~ '[^[:space:]]'
    OR coalesce(source_asset."ai_image_job_id", '') !~ '[^[:space:]]'
    OR source_asset."storage_backend" NOT IN ('local', 'oss')
    OR coalesce(source_asset."storage_key", '') !~ '[^[:space:]]'
    OR coalesce(source_asset."url", '') !~ '[^[:space:]]'
    OR source_asset."mime_type" NOT IN ('image/jpeg', 'image/png')
    OR coalesce(source_asset."sha256", '') !~ '^[a-f0-9]{64}$'
    OR source_asset."size_bytes" < 1
    OR source_asset."size_bytes" > 20971520
    OR source_asset."width" IS NULL
    OR source_asset."height" IS NULL
    OR source_asset."width" < 1
    OR source_asset."height" < 1
    OR source_asset."width" > 16384
    OR source_asset."height" > 16384
    OR source_asset."width"::BIGINT * source_asset."height"::BIGINT > 12000000
    OR greatest(source_asset."width", source_asset."height")::BIGINT
      > least(source_asset."width", source_asset."height")::BIGINT * 20
    OR source_asset."metadata"->>'editSourceContractVersion' IS DISTINCT FROM 'ai-media-edit-source/v1'
    OR source_asset."metadata"->>'outputRole' IS NULL
    OR source_asset."metadata"->>'outputRole' NOT IN ('FINAL_CANDIDATE', 'FINAL_COMPOSITE')
    OR jsonb_typeof(source_asset."metadata"->'pixelOrientationNormalized') IS DISTINCT FROM 'boolean'
    OR source_asset."metadata"->'pixelOrientationNormalized' IS DISTINCT FROM 'true'::jsonb
  THEN
    RAISE EXCEPTION 'manual AI image edit candidate contract is invalid'
      USING ERRCODE = '23514';
  END IF;

  PERFORM assert_standalone_ai_image_edit_graph(workflow."id", workflow."owner_user_id");
  PERFORM assert_ai_image_edit_candidate_scope(workflow."id", workflow."owner_user_id");
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
    ORDER BY "id"
  LOOP
    PERFORM assert_ai_image_edit_candidate_contract(candidate."id", candidate."owner_user_id");
  END LOOP;
END;
$$;

COMMIT;
