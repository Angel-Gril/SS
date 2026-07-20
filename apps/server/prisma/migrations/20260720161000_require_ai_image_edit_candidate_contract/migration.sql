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

  IF source_asset."metadata"->>'editSourceContractVersion' IS DISTINCT FROM 'ai-media-edit-source/v1' THEN
    RAISE EXCEPTION 'manual AI image edit candidate contract version is invalid'
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_contract_from_workflow() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_image_edit_candidate_contract(NEW."id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_image_edit_candidate_contract_from_input() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_image_edit_candidate_contract(NEW."workflow_id", NEW."owner_user_id");
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
    PERFORM assert_ai_image_edit_candidate_contract(candidate."id", candidate."owner_user_id");
  END LOOP;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_contract_workflow"
AFTER INSERT OR UPDATE ON "ai_media_workflows"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_contract_from_workflow();

CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_contract_input"
AFTER INSERT OR UPDATE ON "ai_media_workflow_inputs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_image_edit_candidate_contract_from_input();

COMMIT;
