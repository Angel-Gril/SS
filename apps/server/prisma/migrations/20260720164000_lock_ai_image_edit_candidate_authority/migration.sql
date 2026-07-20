BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Keep the validation scan and trigger installation in one write-free window.
LOCK TABLE
  "ai_image_jobs",
  "ai_media_suite_slots",
  "ai_media_workflow_inputs",
  "ai_media_workflows",
  "media_assets"
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION lock_ai_image_edit_origin_graph(
  target_workflow_id TEXT,
  target_job_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
BEGIN
  IF target_workflow_id IS NULL OR target_owner_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Every caller takes the workflow lock before job locks. This serializes a
  -- new consumer with status/attempt changes under READ COMMITTED.
  PERFORM workflow."id"
  FROM "ai_media_workflows" workflow
  WHERE workflow."id" = target_workflow_id
    AND workflow."owner_user_id" = target_owner_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF target_job_id IS NOT NULL THEN
    PERFORM job."id"
    FROM "ai_image_jobs" job
    WHERE job."id" = target_job_id
      AND job."owner_user_id" = target_owner_user_id
      AND job."workflow_id" = target_workflow_id
    FOR UPDATE;
  ELSE
    PERFORM job."id"
    FROM "ai_image_jobs" job
    WHERE job."workflow_id" = target_workflow_id
      AND job."owner_user_id" = target_owner_user_id
    ORDER BY job."id"
    FOR UPDATE;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_ai_image_edit_candidate_origin_from_input() RETURNS trigger AS $$
DECLARE
  target_operation TEXT;
  source_kind TEXT;
  source_job_id TEXT;
  origin_workflow_id TEXT;
BEGIN
  IF NEW."role" IS DISTINCT FROM 'REFERENCE' OR NEW."ordinal" IS DISTINCT FROM 0 THEN
    RETURN NEW;
  END IF;

  SELECT workflow."operation"::TEXT INTO target_operation
  FROM "ai_media_workflows" workflow
  WHERE workflow."id" = NEW."workflow_id"
    AND workflow."owner_user_id" = NEW."owner_user_id";

  IF target_operation IS NULL OR target_operation NOT IN ('FULL_EDIT', 'INPAINT') THEN
    RETURN NEW;
  END IF;

  SELECT asset."kind"::TEXT, asset."ai_image_job_id"
  INTO source_kind, source_job_id
  FROM "media_assets" asset
  WHERE asset."id" = NEW."asset_id"
    AND asset."owner_user_id" = NEW."owner_user_id";

  IF source_kind IS DISTINCT FROM 'AI_GENERATED' OR source_job_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT job."workflow_id" INTO origin_workflow_id
  FROM "ai_image_jobs" job
  WHERE job."id" = source_job_id
    AND job."owner_user_id" = NEW."owner_user_id";

  IF origin_workflow_id IS NOT NULL THEN
    PERFORM lock_ai_image_edit_origin_graph(
      origin_workflow_id,
      source_job_id,
      NEW."owner_user_id"
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_contract(
  target_workflow_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  workflow "ai_media_workflows"%ROWTYPE;
  source_asset "media_assets"%ROWTYPE;
  origin_workflow_id TEXT;
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

  SELECT job."workflow_id" INTO origin_workflow_id
  FROM "ai_image_jobs" job
  WHERE job."id" = source_asset."ai_image_job_id"
    AND job."owner_user_id" = source_asset."owner_user_id";

  IF origin_workflow_id IS NOT NULL THEN
    PERFORM lock_ai_image_edit_origin_graph(
      origin_workflow_id,
      source_asset."ai_image_job_id",
      source_asset."owner_user_id"
    );
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

  -- Re-run the complete authority and nullable scope checks while the origin
  -- workflow and current job remain locked until transaction end.
  PERFORM assert_standalone_ai_image_edit_graph(workflow."id", workflow."owner_user_id");
  PERFORM assert_ai_image_edit_candidate_scope(workflow."id", workflow."owner_user_id");
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_dependents_from_job(
  target_job_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  candidate RECORD;
  origin_workflow_id TEXT;
BEGIN
  IF target_job_id IS NULL OR target_owner_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT job."workflow_id"
  INTO origin_workflow_id
  FROM "ai_image_jobs" job
  WHERE job."id" = target_job_id
    AND job."owner_user_id" = target_owner_user_id;

  IF origin_workflow_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM lock_ai_image_edit_origin_graph(
    origin_workflow_id,
    target_job_id,
    target_owner_user_id
  );

  FOR candidate IN
    SELECT asset."id", asset."owner_user_id"
    FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = target_job_id
      AND asset."owner_user_id" = target_owner_user_id
      AND asset."kind" = 'AI_GENERATED'
    ORDER BY asset."id"
  LOOP
    PERFORM assert_ai_image_edit_candidate_consumers(candidate."id", candidate."owner_user_id");
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_dependents_from_workflow(
  target_workflow_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  origin_job RECORD;
BEGIN
  IF target_workflow_id IS NULL OR target_owner_user_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM lock_ai_image_edit_origin_graph(
    target_workflow_id,
    NULL,
    target_owner_user_id
  );

  FOR origin_job IN
    SELECT job."id", job."owner_user_id"
    FROM "ai_image_jobs" job
    WHERE job."workflow_id" = target_workflow_id
      AND job."owner_user_id" = target_owner_user_id
    ORDER BY job."id"
  LOOP
    PERFORM assert_ai_image_edit_candidate_dependents_from_job(
      origin_job."id",
      origin_job."owner_user_id"
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_edit_candidate_origin_lock"
BEFORE INSERT ON "ai_media_workflow_inputs"
FOR EACH ROW EXECUTE FUNCTION lock_ai_image_edit_candidate_origin_from_input();

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
