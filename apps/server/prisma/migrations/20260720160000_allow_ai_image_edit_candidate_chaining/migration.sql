BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION assert_standalone_ai_image_edit_graph(
  target_workflow_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  workflow "ai_media_workflows"%ROWTYPE;
  source_asset "media_assets"%ROWTYPE;
  mask_asset "media_assets"%ROWTYPE;
  reference_count INTEGER;
  mask_count INTEGER;
  job_count INTEGER;
BEGIN
  SELECT * INTO workflow
  FROM "ai_media_workflows"
  WHERE "id" = target_workflow_id
    AND "owner_user_id" = target_owner_user_id;

  IF NOT FOUND OR workflow."operation" NOT IN ('FULL_EDIT', 'INPAINT') THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_media_suite_slots"
    WHERE "child_workflow_id" = workflow."id"
      AND "owner_user_id" = workflow."owner_user_id"
  ) THEN
    RAISE EXCEPTION 'manual AI image edit workflows cannot be suite children'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*) FILTER (WHERE input."role" = 'REFERENCE'),
    count(*) FILTER (WHERE input."role" = 'MASK')
  INTO reference_count, mask_count
  FROM "ai_media_workflow_inputs" input
  WHERE input."workflow_id" = workflow."id"
    AND input."owner_user_id" = workflow."owner_user_id";

  IF reference_count IS DISTINCT FROM 1
    OR (workflow."operation" = 'FULL_EDIT' AND mask_count IS DISTINCT FROM 0)
    OR (workflow."operation" = 'INPAINT' AND mask_count IS DISTINCT FROM 1)
  THEN
    RAISE EXCEPTION 'manual AI image edit workflow input cardinality is invalid'
      USING ERRCODE = '23514';
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

  IF NOT FOUND
    OR source_asset."owner_user_id" IS DISTINCT FROM workflow."owner_user_id"
    OR source_asset."kind" NOT IN ('SOURCE_ORIGINAL', 'AI_GENERATED')
    OR source_asset."source_capture_snapshot_id" IS NULL
    OR source_asset."width" IS NULL
    OR source_asset."height" IS NULL
    OR source_asset."width" < 1
    OR source_asset."height" < 1
  THEN
    RAISE EXCEPTION 'manual AI image edit source asset is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF source_asset."kind" = 'AI_GENERATED'
    AND (
      workflow."context_type" IS DISTINCT FROM 'collect'
      OR workflow."context_id" IS NULL
      OR source_asset."ai_image_job_id" IS NULL
      OR source_asset."storage_backend" NOT IN ('local', 'oss')
      OR coalesce(source_asset."storage_key", '') = ''
      OR coalesce(source_asset."url", '') = ''
      OR source_asset."size_bytes" < 1
      OR source_asset."metadata"->>'pixelOrientationNormalized' IS DISTINCT FROM 'true'
      OR source_asset."metadata"->>'outputRole' IS NULL
      OR source_asset."metadata"->>'outputRole' NOT IN ('FINAL_CANDIDATE', 'FINAL_COMPOSITE')
      OR NOT EXISTS (
        SELECT 1
        FROM "ai_image_jobs" origin_job
        JOIN "ai_media_workflows" origin_workflow
          ON origin_workflow."id" = origin_job."workflow_id"
         AND origin_workflow."owner_user_id" = origin_job."owner_user_id"
        JOIN "ai_media_workflow_inputs" origin_input
          ON origin_input."workflow_id" = origin_workflow."id"
         AND origin_input."owner_user_id" = origin_workflow."owner_user_id"
         AND origin_input."role" = 'REFERENCE'
         AND origin_input."ordinal" = 0
        JOIN "media_assets" origin_source
          ON origin_source."id" = origin_input."asset_id"
         AND origin_source."owner_user_id" = origin_input."owner_user_id"
        WHERE origin_job."id" = source_asset."ai_image_job_id"
          AND origin_job."owner_user_id" = source_asset."owner_user_id"
          AND origin_job."status" = 'SUCCEEDED'
          AND origin_job."operation" IN ('FULL_EDIT', 'INPAINT')
          AND origin_job."workflow_attempt" = origin_workflow."current_attempt"
          AND origin_workflow."id" <> workflow."id"
          AND origin_workflow."status" = 'SUCCEEDED'
          AND origin_workflow."operation" IN ('FULL_EDIT', 'INPAINT')
          AND origin_workflow."operation" = origin_job."operation"
          AND origin_workflow."context_type" IS NOT DISTINCT FROM workflow."context_type"
          AND origin_workflow."context_id" IS NOT DISTINCT FROM workflow."context_id"
          AND origin_workflow."completed_at" IS NOT NULL
          AND origin_workflow."completed_at" <= workflow."created_at"
          AND origin_source."source_capture_snapshot_id" IS NOT DISTINCT FROM source_asset."source_capture_snapshot_id"
          AND NOT EXISTS (
            SELECT 1
            FROM "ai_media_suite_slots" origin_suite_slot
            WHERE origin_suite_slot."child_workflow_id" = origin_workflow."id"
              AND origin_suite_slot."owner_user_id" = origin_workflow."owner_user_id"
          )
      )
    )
  THEN
    RAISE EXCEPTION 'manual AI image edit generated source authority is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF workflow."operation" = 'INPAINT' THEN
    SELECT asset.* INTO mask_asset
    FROM "ai_media_workflow_inputs" input
    JOIN "media_assets" asset
      ON asset."id" = input."asset_id"
     AND asset."owner_user_id" = input."owner_user_id"
    WHERE input."workflow_id" = workflow."id"
      AND input."owner_user_id" = workflow."owner_user_id"
      AND input."role" = 'MASK'
      AND input."ordinal" = 0;

    IF NOT FOUND
      OR mask_asset."owner_user_id" IS DISTINCT FROM workflow."owner_user_id"
      OR mask_asset."kind" IS DISTINCT FROM 'EDIT_MASK'
      OR mask_asset."source_capture_snapshot_id" IS NULL
      OR mask_asset."source_capture_snapshot_id" IS DISTINCT FROM source_asset."source_capture_snapshot_id"
      OR mask_asset."width" IS DISTINCT FROM source_asset."width"
      OR mask_asset."height" IS DISTINCT FROM source_asset."height"
    THEN
      RAISE EXCEPTION 'manual AI image inpaint mask asset is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT count(*) INTO job_count
  FROM "ai_image_jobs" job
  WHERE job."workflow_id" = workflow."id"
    AND job."owner_user_id" = workflow."owner_user_id";

  IF job_count IS DISTINCT FROM workflow."current_attempt"
    OR NOT EXISTS (
      SELECT 1
      FROM "ai_image_jobs" job
      WHERE job."workflow_id" = workflow."id"
        AND job."owner_user_id" = workflow."owner_user_id"
        AND job."workflow_attempt" = workflow."current_attempt"
    )
    OR EXISTS (
      SELECT 1
      FROM "ai_image_jobs" job
      WHERE job."workflow_id" = workflow."id"
        AND job."owner_user_id" = workflow."owner_user_id"
        AND (
          job."operation" IS DISTINCT FROM workflow."operation"
          OR job."workflow_attempt" < 1
          OR job."workflow_attempt" > workflow."current_attempt"
          OR job."requested_image_count" IS DISTINCT FROM 1
          OR job."width" IS DISTINCT FROM source_asset."width"
          OR job."height" IS DISTINCT FROM source_asset."height"
        )
    )
  THEN
    RAISE EXCEPTION 'manual AI image edit job graph is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF workflow."selected_output_asset_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "media_assets" output_asset
      JOIN "ai_image_jobs" output_job
        ON output_job."id" = output_asset."ai_image_job_id"
       AND output_job."owner_user_id" = output_asset."owner_user_id"
      WHERE output_asset."id" = workflow."selected_output_asset_id"
        AND output_asset."owner_user_id" = workflow."owner_user_id"
        AND output_asset."kind" = 'AI_GENERATED'
        AND output_job."workflow_id" = workflow."id"
        AND output_job."operation" = workflow."operation"
        AND output_job."workflow_attempt" = workflow."current_attempt"
        AND output_job."status" = 'SUCCEEDED'
    )
  THEN
    RAISE EXCEPTION 'manual AI image edit selected output is not the current final candidate'
      USING ERRCODE = '23514';
  END IF;
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
    PERFORM assert_standalone_ai_image_edit_graph(candidate."id", candidate."owner_user_id");
  END LOOP;
END;
$$;

COMMIT;
