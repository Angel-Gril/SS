BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION assert_ai_image_edit_output_graph(
  target_workflow_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  workflow "ai_media_workflows"%ROWTYPE;
  source_asset "media_assets"%ROWTYPE;
  mask_asset "media_assets"%ROWTYPE;
  candidate_job RECORD;
  raw_output_count INTEGER;
  final_output_count INTEGER;
  unexpected_output_count INTEGER;
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual AI image edit source asset is missing'
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
      OR mask_asset."metadata"->>'maskSemantics' IS DISTINCT FROM 'WHITE_EDIT_BLACK_PRESERVE_V1'
      OR mask_asset."metadata"->>'sourceAssetId' IS DISTINCT FROM source_asset."id"
      OR mask_asset."metadata"->>'sourceSha256' IS DISTINCT FROM source_asset."sha256"
    THEN
      RAISE EXCEPTION 'manual AI image inpaint mask authority is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  FOR candidate_job IN
    SELECT job."id", job."status"
    FROM "ai_image_jobs" job
    WHERE job."workflow_id" = workflow."id"
      AND job."owner_user_id" = workflow."owner_user_id"
  LOOP
    SELECT
      count(*) FILTER (WHERE asset."kind" = 'AI_PROVIDER_OUTPUT'),
      count(*) FILTER (WHERE asset."kind" = 'AI_GENERATED'),
      count(*) FILTER (WHERE asset."kind" NOT IN ('AI_PROVIDER_OUTPUT', 'AI_GENERATED'))
    INTO raw_output_count, final_output_count, unexpected_output_count
    FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = candidate_job."id"
      AND asset."owner_user_id" = workflow."owner_user_id";

    IF raw_output_count > 1
      OR final_output_count > 1
      OR unexpected_output_count > 0
      OR (
        candidate_job."status" = 'SUCCEEDED'
        AND (
          raw_output_count IS DISTINCT FROM 1
          OR final_output_count IS DISTINCT FROM 1
        )
      )
      OR (
        candidate_job."status" IN ('FAILED', 'CANCELLED')
        AND final_output_count IS DISTINCT FROM 0
      )
      OR (
        candidate_job."status" NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
        AND final_output_count IS DISTINCT FROM 0
      )
    THEN
      RAISE EXCEPTION 'manual AI image edit output graph is invalid'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
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
    PERFORM assert_ai_image_edit_output_graph(candidate."id", candidate."owner_user_id");
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION require_ai_image_edit_output_from_job() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT'
    AND OLD."workflow_id" IS NOT NULL
    AND OLD."operation" IN ('FULL_EDIT', 'INPAINT')
  THEN
    PERFORM assert_ai_image_edit_output_graph(OLD."workflow_id", OLD."owner_user_id");
  END IF;
  IF TG_OP <> 'DELETE'
    AND NEW."workflow_id" IS NOT NULL
    AND NEW."operation" IN ('FULL_EDIT', 'INPAINT')
  THEN
    PERFORM assert_ai_image_edit_output_graph(NEW."workflow_id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_output_from_input() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_standalone_ai_image_edit_graph(OLD."workflow_id", OLD."owner_user_id");
    PERFORM assert_ai_image_edit_output_graph(OLD."workflow_id", OLD."owner_user_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_standalone_ai_image_edit_graph(NEW."workflow_id", NEW."owner_user_id");
    PERFORM assert_ai_image_edit_output_graph(NEW."workflow_id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_output_from_asset() RETURNS trigger AS $$
DECLARE
  binding RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    FOR binding IN
      SELECT input."workflow_id", input."owner_user_id"
      FROM "ai_media_workflow_inputs" input
      WHERE input."asset_id" = OLD."id"
        AND input."owner_user_id" = OLD."owner_user_id"
      UNION
      SELECT job."workflow_id", job."owner_user_id"
      FROM "ai_image_jobs" job
      WHERE job."id" = OLD."ai_image_job_id"
        AND job."owner_user_id" = OLD."owner_user_id"
        AND job."workflow_id" IS NOT NULL
    LOOP
      PERFORM assert_standalone_ai_image_edit_graph(binding."workflow_id", binding."owner_user_id");
      PERFORM assert_ai_image_edit_output_graph(binding."workflow_id", binding."owner_user_id");
    END LOOP;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    FOR binding IN
      SELECT input."workflow_id", input."owner_user_id"
      FROM "ai_media_workflow_inputs" input
      WHERE input."asset_id" = NEW."id"
        AND input."owner_user_id" = NEW."owner_user_id"
      UNION
      SELECT job."workflow_id", job."owner_user_id"
      FROM "ai_image_jobs" job
      WHERE job."id" = NEW."ai_image_job_id"
        AND job."owner_user_id" = NEW."owner_user_id"
        AND job."workflow_id" IS NOT NULL
    LOOP
      PERFORM assert_standalone_ai_image_edit_graph(binding."workflow_id", binding."owner_user_id");
      PERFORM assert_ai_image_edit_output_graph(binding."workflow_id", binding."owner_user_id");
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_edit_output_job_graph"
AFTER INSERT OR UPDATE OR DELETE ON "ai_image_jobs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_output_from_job();

CREATE CONSTRAINT TRIGGER "ai_media_edit_input_mutation_graph"
AFTER INSERT OR UPDATE OR DELETE ON "ai_media_workflow_inputs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_output_from_input();

CREATE CONSTRAINT TRIGGER "ai_media_edit_asset_graph"
AFTER INSERT OR UPDATE OR DELETE ON "media_assets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_output_from_asset();

COMMIT;
