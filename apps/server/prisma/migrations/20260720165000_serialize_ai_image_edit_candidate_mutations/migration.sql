BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

LOCK TABLE
  "ai_image_jobs",
  "ai_media_workflow_inputs",
  "ai_media_workflows",
  "media_assets"
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION lock_ai_image_edit_origin_workflows(
  target_owner_user_id TEXT,
  target_workflow_ids TEXT[]
) RETURNS void AS $$
BEGIN
  IF target_owner_user_id IS NULL
    OR coalesce(array_length(target_workflow_ids, 1), 0) = 0
  THEN
    RETURN;
  END IF;

  -- The workflow row is the only cross-table mutex. Never take a job lock
  -- here: direct job UPDATE already owns its tuple before row triggers run.
  PERFORM workflow."id"
  FROM "ai_media_workflows" workflow
  WHERE workflow."owner_user_id" = target_owner_user_id
    AND workflow."id" = ANY(target_workflow_ids)
  ORDER BY workflow."id"
  FOR UPDATE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_ai_image_edit_origin_graph(
  target_workflow_id TEXT,
  target_job_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
BEGIN
  PERFORM lock_ai_image_edit_origin_workflows(
    target_owner_user_id,
    ARRAY[target_workflow_id]
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_ai_image_edit_origin_workflows_for_jobs(
  target_owner_user_id TEXT,
  target_job_ids TEXT[]
) RETURNS void AS $$
DECLARE
  workflow_ids TEXT[];
BEGIN
  IF target_owner_user_id IS NULL
    OR coalesce(array_length(target_job_ids, 1), 0) = 0
  THEN
    RETURN;
  END IF;

  SELECT array_agg(binding."workflow_id" ORDER BY binding."workflow_id")
  INTO workflow_ids
  FROM (
    SELECT DISTINCT job."workflow_id"
    FROM "ai_image_jobs" job
    WHERE job."owner_user_id" = target_owner_user_id
      AND job."id" = ANY(target_job_ids)
      AND job."workflow_id" IS NOT NULL
  ) binding;

  PERFORM lock_ai_image_edit_origin_workflows(target_owner_user_id, workflow_ids);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_ai_image_edit_candidate_origin_from_job_mutation() RETURNS trigger AS $$
DECLARE
  binding RECORD;
BEGIN
  FOR binding IN
    SELECT DISTINCT candidate."owner_user_id", candidate."workflow_id"
    FROM (
      SELECT OLD."owner_user_id" AS "owner_user_id", OLD."workflow_id" AS "workflow_id"
      WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW."owner_user_id", NEW."workflow_id"
      WHERE TG_OP <> 'DELETE'
    ) candidate
    WHERE candidate."owner_user_id" IS NOT NULL
      AND candidate."workflow_id" IS NOT NULL
    ORDER BY candidate."owner_user_id", candidate."workflow_id"
  LOOP
    PERFORM lock_ai_image_edit_origin_workflows(
      binding."owner_user_id",
      ARRAY[binding."workflow_id"]
    );
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_ai_image_edit_candidate_origin_from_asset_mutation() RETURNS trigger AS $$
DECLARE
  binding RECORD;
BEGIN
  FOR binding IN
    SELECT DISTINCT job."owner_user_id", job."workflow_id"
    FROM "ai_image_jobs" job
    JOIN (
      SELECT OLD."owner_user_id" AS "owner_user_id", OLD."ai_image_job_id" AS "job_id"
      WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW."owner_user_id", NEW."ai_image_job_id"
      WHERE TG_OP <> 'DELETE'
    ) candidate
      ON candidate."job_id" = job."id"
     AND candidate."owner_user_id" = job."owner_user_id"
    WHERE job."workflow_id" IS NOT NULL
    ORDER BY job."owner_user_id", job."workflow_id"
  LOOP
    PERFORM lock_ai_image_edit_origin_workflows(
      binding."owner_user_id",
      ARRAY[binding."workflow_id"]
    );
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
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

  IF origin_workflow_id IS NOT NULL THEN
    PERFORM lock_ai_image_edit_origin_workflows(
      source_asset."owner_user_id",
      ARRAY[origin_workflow_id]
    );
  END IF;

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

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_dependents_from_job(
  target_job_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  candidate RECORD;
  current_workflow_id TEXT;
BEGIN
  IF target_job_id IS NULL OR target_owner_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT job."workflow_id" INTO current_workflow_id
  FROM "ai_image_jobs" job
  WHERE job."id" = target_job_id
    AND job."owner_user_id" = target_owner_user_id;

  IF current_workflow_id IS NOT NULL THEN
    PERFORM lock_ai_image_edit_origin_workflows(
      target_owner_user_id,
      ARRAY[current_workflow_id]
    );
  END IF;

  -- Do not return when the current binding is NULL. OLD may still identify a
  -- job whose generated assets are frozen by existing consumers.
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

  PERFORM lock_ai_image_edit_origin_workflows(
    target_owner_user_id,
    ARRAY[target_workflow_id]
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

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_dependents_from_job() RETURNS trigger AS $$
DECLARE
  binding RECORD;
BEGIN
  FOR binding IN
    SELECT DISTINCT candidate."owner_user_id", candidate."workflow_id"
    FROM (
      SELECT OLD."owner_user_id" AS "owner_user_id", OLD."workflow_id" AS "workflow_id"
      WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW."owner_user_id", NEW."workflow_id"
      WHERE TG_OP <> 'DELETE'
    ) candidate
    WHERE candidate."owner_user_id" IS NOT NULL
      AND candidate."workflow_id" IS NOT NULL
    ORDER BY candidate."owner_user_id", candidate."workflow_id"
  LOOP
    PERFORM lock_ai_image_edit_origin_workflows(
      binding."owner_user_id",
      ARRAY[binding."workflow_id"]
    );
  END LOOP;

  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_job(OLD."id", OLD."owner_user_id");
  END IF;
  IF TG_OP <> 'DELETE'
    AND (
      TG_OP = 'INSERT'
      OR NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    )
  THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_job(NEW."id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_consumers_from_asset() RETURNS trigger AS $$
DECLARE
  binding RECORD;
  candidate RECORD;
BEGIN
  FOR binding IN
    SELECT DISTINCT job."owner_user_id", job."workflow_id"
    FROM "ai_image_jobs" job
    JOIN (
      SELECT OLD."owner_user_id" AS "owner_user_id", OLD."ai_image_job_id" AS "job_id"
      WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW."owner_user_id", NEW."ai_image_job_id"
      WHERE TG_OP <> 'DELETE'
    ) source_job
      ON source_job."job_id" = job."id"
     AND source_job."owner_user_id" = job."owner_user_id"
    WHERE job."workflow_id" IS NOT NULL
    ORDER BY job."owner_user_id", job."workflow_id"
  LOOP
    PERFORM lock_ai_image_edit_origin_workflows(
      binding."owner_user_id",
      ARRAY[binding."workflow_id"]
    );
  END LOOP;

  FOR candidate IN
    SELECT DISTINCT source_asset."id", source_asset."owner_user_id"
    FROM (
      SELECT OLD."id" AS "id", OLD."owner_user_id" AS "owner_user_id"
      WHERE TG_OP <> 'INSERT'
      UNION ALL
      SELECT NEW."id", NEW."owner_user_id"
      WHERE TG_OP <> 'DELETE'
    ) source_asset
    ORDER BY source_asset."owner_user_id", source_asset."id"
  LOOP
    PERFORM assert_ai_image_edit_candidate_consumers(candidate."id", candidate."owner_user_id");

    FOR binding IN
      SELECT DISTINCT input."workflow_id", input."owner_user_id"
      FROM "ai_media_workflow_inputs" input
      WHERE input."asset_id" = candidate."id"
        AND input."owner_user_id" = candidate."owner_user_id"
      ORDER BY input."owner_user_id", input."workflow_id"
    LOOP
      PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(
        binding."workflow_id",
        binding."owner_user_id"
      );
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "ai_media_edit_candidate_origin_lock" ON "ai_media_workflow_inputs";
CREATE TRIGGER "zz_ai_media_edit_candidate_origin_lock"
BEFORE INSERT ON "ai_media_workflow_inputs"
FOR EACH ROW EXECUTE FUNCTION lock_ai_image_edit_candidate_origin_from_input();

CREATE TRIGGER "ai_image_jobs_lock_edit_candidate_origin"
BEFORE UPDATE OR DELETE ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION lock_ai_image_edit_candidate_origin_from_job_mutation();

CREATE TRIGGER "media_assets_lock_edit_candidate_origin"
BEFORE UPDATE OR DELETE ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION lock_ai_image_edit_candidate_origin_from_asset_mutation();

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
