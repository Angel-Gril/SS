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
    OR source_asset."kind" IS DISTINCT FROM 'SOURCE_ORIGINAL'
    OR source_asset."source_capture_snapshot_id" IS NULL
    OR source_asset."width" IS NULL
    OR source_asset."height" IS NULL
    OR source_asset."width" < 1
    OR source_asset."height" < 1
  THEN
    RAISE EXCEPTION 'manual AI image edit source asset is invalid'
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

CREATE OR REPLACE FUNCTION require_ai_media_edit_graph_from_workflow() RETURNS trigger AS $$
BEGIN
  IF NEW."operation" IN ('FULL_EDIT', 'INPAINT') THEN
    PERFORM assert_standalone_ai_image_edit_graph(NEW."id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_edit_graph_from_input() RETURNS trigger AS $$
BEGIN
  PERFORM assert_standalone_ai_image_edit_graph(NEW."workflow_id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_edit_graph_from_job() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND OLD."workflow_id" IS NOT NULL
    AND OLD."operation" IN ('FULL_EDIT', 'INPAINT')
  THEN
    PERFORM assert_standalone_ai_image_edit_graph(OLD."workflow_id", OLD."owner_user_id");
  ELSIF TG_OP <> 'DELETE'
    AND NEW."workflow_id" IS NOT NULL
    AND NEW."operation" IN ('FULL_EDIT', 'INPAINT')
  THEN
    PERFORM assert_standalone_ai_image_edit_graph(NEW."workflow_id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_edit_graph_from_suite_slot() RETURNS trigger AS $$
BEGIN
  IF NEW."child_workflow_id" IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW."child_workflow_id" IS DISTINCT FROM OLD."child_workflow_id")
  THEN
    PERFORM assert_standalone_ai_image_edit_graph(NEW."child_workflow_id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_edit_workflow_graph"
AFTER INSERT OR UPDATE ON "ai_media_workflows"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_edit_graph_from_workflow();

CREATE CONSTRAINT TRIGGER "ai_media_edit_input_graph"
AFTER INSERT ON "ai_media_workflow_inputs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_edit_graph_from_input();

CREATE CONSTRAINT TRIGGER "ai_media_edit_job_graph"
AFTER INSERT OR UPDATE OR DELETE ON "ai_image_jobs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_edit_graph_from_job();

CREATE CONSTRAINT TRIGGER "ai_media_edit_suite_slot_graph"
AFTER INSERT OR UPDATE ON "ai_media_suite_slots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_edit_graph_from_suite_slot();

COMMIT;
