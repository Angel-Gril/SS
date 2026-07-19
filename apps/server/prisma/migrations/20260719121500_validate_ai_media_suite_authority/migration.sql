BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION validate_ai_media_suite_insert() RETURNS trigger AS $$
DECLARE
  stored_plan "ai_media_plans"%ROWTYPE;
  stored_version "ai_media_plan_versions"%ROWTYPE;
  stored_snapshot "source_capture_snapshots"%ROWTYPE;
BEGIN
  SELECT * INTO stored_plan FROM "ai_media_plans"
    WHERE "id" = NEW."plan_id" AND "owner_user_id" = NEW."owner_user_id" FOR SHARE;
  SELECT * INTO stored_version FROM "ai_media_plan_versions"
    WHERE "id" = NEW."plan_version_id"
      AND "plan_id" = NEW."plan_id"
      AND "owner_user_id" = NEW."owner_user_id" FOR SHARE;
  SELECT * INTO stored_snapshot FROM "source_capture_snapshots"
    WHERE "id" = NEW."source_capture_snapshot_id"
      AND "subject_id" = NEW."source_subject_id" FOR SHARE;

  IF stored_plan."id" IS NULL
    OR stored_version."id" IS NULL
    OR stored_snapshot."id" IS NULL
    OR stored_plan."source_subject_id" IS DISTINCT FROM NEW."source_subject_id"
    OR stored_plan."context_type" IS DISTINCT FROM NEW."context_type"
    OR stored_plan."context_id" IS DISTINCT FROM NEW."context_id"
    OR stored_plan."review_status" IS DISTINCT FROM 'APPROVED'
    OR stored_plan."stale_at" IS NOT NULL
    OR stored_plan."current_version_id" IS DISTINCT FROM NEW."plan_version_id"
    OR stored_plan."approved_version_id" IS DISTINCT FROM NEW."plan_version_id"
    OR stored_plan."reviewed_by_user_id" IS NULL
    OR stored_plan."reviewed_at" IS NULL
    OR stored_version."source_subject_id" IS DISTINCT FROM NEW."source_subject_id"
    OR stored_version."source_capture_snapshot_id" IS DISTINCT FROM NEW."source_capture_snapshot_id"
    OR stored_version."source_capture_hash" IS DISTINCT FROM NEW."source_capture_hash"
    OR stored_version."source_profile_hash" IS DISTINCT FROM NEW."source_profile_hash"
    OR stored_version."source_schema_version" IS DISTINCT FROM NEW."source_schema_version"
    OR stored_snapshot."capture_hash" IS DISTINCT FROM NEW."source_capture_hash"
    OR stored_snapshot."profile_hash" IS DISTINCT FROM NEW."source_profile_hash"
    OR stored_snapshot."schema_version" IS DISTINCT FROM NEW."source_schema_version"
    OR NEW."status" IS DISTINCT FROM 'PLANNED'
    OR NEW."revision" IS DISTINCT FROM 1
    OR NEW."cancel_requested_at" IS NOT NULL
    OR NEW."completed_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'AI media suite provenance mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_validate_insert"
BEFORE INSERT ON "ai_media_suites"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_insert();

COMMIT;
