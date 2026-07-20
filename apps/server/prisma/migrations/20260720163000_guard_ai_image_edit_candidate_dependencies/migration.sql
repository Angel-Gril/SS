BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_contract(
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

  IF source_asset."metadata"->>'editSourceContractVersion' IS DISTINCT FROM 'ai-media-edit-source/v1'
    OR jsonb_typeof(source_asset."metadata"->'pixelOrientationNormalized') IS DISTINCT FROM 'boolean'
    OR source_asset."metadata"->'pixelOrientationNormalized' IS DISTINCT FROM 'true'::jsonb
  THEN
    RAISE EXCEPTION 'manual AI image edit candidate contract is invalid'
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_consumers(
  target_asset_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  consumer RECORD;
BEGIN
  FOR consumer IN
    SELECT DISTINCT input."workflow_id", input."owner_user_id"
    FROM "ai_media_workflow_inputs" input
    JOIN "ai_media_workflows" workflow
      ON workflow."id" = input."workflow_id"
     AND workflow."owner_user_id" = input."owner_user_id"
    WHERE input."asset_id" = target_asset_id
      AND input."owner_user_id" = target_owner_user_id
      AND workflow."operation" IN ('FULL_EDIT', 'INPAINT')
  LOOP
    PERFORM assert_standalone_ai_image_edit_graph(consumer."workflow_id", consumer."owner_user_id");
    PERFORM assert_ai_image_edit_candidate_contract(consumer."workflow_id", consumer."owner_user_id");
    PERFORM assert_ai_image_edit_candidate_scope(consumer."workflow_id", consumer."owner_user_id");
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_dependents_from_job(
  target_job_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  candidate RECORD;
BEGIN
  IF target_job_id IS NULL OR target_owner_user_id IS NULL THEN
    RETURN;
  END IF;

  FOR candidate IN
    SELECT asset."id", asset."owner_user_id"
    FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = target_job_id
      AND asset."owner_user_id" = target_owner_user_id
      AND asset."kind" = 'AI_GENERATED'
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

  FOR origin_job IN
    SELECT job."id", job."owner_user_id"
    FROM "ai_image_jobs" job
    WHERE job."workflow_id" = target_workflow_id
      AND job."owner_user_id" = target_owner_user_id
  LOOP
    PERFORM assert_ai_image_edit_candidate_dependents_from_job(origin_job."id", origin_job."owner_user_id");
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_dependents_from_workflow() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(OLD."id", OLD."owner_user_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(NEW."id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_dependents_from_job() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_job(OLD."id", OLD."owner_user_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_job(NEW."id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_dependents_from_input() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(OLD."workflow_id", OLD."owner_user_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(NEW."workflow_id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_dependents_from_suite_slot() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD."child_workflow_id" IS NOT NULL THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(OLD."child_workflow_id", OLD."owner_user_id");
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."child_workflow_id" IS NOT NULL THEN
    PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(NEW."child_workflow_id", NEW."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_consumers_from_asset() RETURNS trigger AS $$
DECLARE
  origin_workflow RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_ai_image_edit_candidate_consumers(OLD."id", OLD."owner_user_id");
    FOR origin_workflow IN
      SELECT DISTINCT input."workflow_id", input."owner_user_id"
      FROM "ai_media_workflow_inputs" input
      WHERE input."asset_id" = OLD."id"
        AND input."owner_user_id" = OLD."owner_user_id"
    LOOP
      PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(
        origin_workflow."workflow_id",
        origin_workflow."owner_user_id"
      );
    END LOOP;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_ai_image_edit_candidate_consumers(NEW."id", NEW."owner_user_id");
    FOR origin_workflow IN
      SELECT DISTINCT input."workflow_id", input."owner_user_id"
      FROM "ai_media_workflow_inputs" input
      WHERE input."asset_id" = NEW."id"
        AND input."owner_user_id" = NEW."owner_user_id"
    LOOP
      PERFORM assert_ai_image_edit_candidate_dependents_from_workflow(
        origin_workflow."workflow_id",
        origin_workflow."owner_user_id"
      );
    END LOOP;
  END IF;
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
    PERFORM assert_standalone_ai_image_edit_graph(candidate."id", candidate."owner_user_id");
    PERFORM assert_ai_image_edit_candidate_contract(candidate."id", candidate."owner_user_id");
    PERFORM assert_ai_image_edit_candidate_scope(candidate."id", candidate."owner_user_id");
  END LOOP;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_workflow"
AFTER INSERT OR UPDATE OR DELETE ON "ai_media_workflows"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_dependents_from_workflow();

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_job"
AFTER INSERT OR UPDATE OR DELETE ON "ai_image_jobs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_dependents_from_job();

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_input"
AFTER INSERT OR UPDATE OR DELETE ON "ai_media_workflow_inputs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_dependents_from_input();

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_suite_slot"
AFTER INSERT OR UPDATE OR DELETE ON "ai_media_suite_slots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_dependents_from_suite_slot();

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_asset"
AFTER INSERT OR UPDATE OR DELETE ON "media_assets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_consumers_from_asset();

COMMIT;
