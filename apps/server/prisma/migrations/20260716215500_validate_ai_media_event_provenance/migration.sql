BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_media_workflows"
  DROP CONSTRAINT "ai_media_workflows_owner_user_id_fkey",
  ADD CONSTRAINT "ai_media_workflows_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_ai_media_workflow_event_insert() RETURNS trigger AS $$
BEGIN
  IF NEW."job_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ai_image_jobs"
    WHERE "id" = NEW."job_id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "workflow_id" = NEW."workflow_id"
  ) THEN
    RAISE EXCEPTION 'event job does not belong to workflow' USING ERRCODE = '23514';
  END IF;
  IF NEW."asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "media_assets" asset
    LEFT JOIN "ai_image_jobs" job ON job."id" = asset."ai_image_job_id"
    WHERE asset."id" = NEW."asset_id"
      AND asset."owner_user_id" = NEW."owner_user_id"
      AND (
        job."workflow_id" = NEW."workflow_id"
        OR EXISTS (
          SELECT 1 FROM "ai_media_workflow_inputs" input
          WHERE input."workflow_id" = NEW."workflow_id"
            AND input."owner_user_id" = NEW."owner_user_id"
            AND input."asset_id" = asset."id"
        )
      )
    FOR SHARE OF asset
  ) THEN
    RAISE EXCEPTION 'event asset does not belong to workflow' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_workflow_events_validate_insert"
BEFORE INSERT ON "ai_media_workflow_events"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_workflow_event_insert();

COMMIT;
