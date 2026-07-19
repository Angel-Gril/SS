BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION protect_ai_media_suite_materialized_slot_lifecycle() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_media_suites" suite
    WHERE suite."id" = OLD."suite_id"
      AND suite."owner_user_id" = OLD."owner_user_id"
      AND suite."revision" >= 4
      AND EXISTS (
        SELECT 1
        FROM "ai_media_suite_events" materialized_event
        WHERE materialized_event."suite_id" = suite."id"
          AND materialized_event."owner_user_id" = suite."owner_user_id"
          AND materialized_event."revision" = 4
          AND materialized_event."event_type" = 'CHILDREN_MATERIALIZED'
      )
  ) THEN
    RAISE EXCEPTION 'materialized AI media suite slot lifecycle is parent-controlled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_slots_materialized_lifecycle_protected"
BEFORE UPDATE ON "ai_media_suite_slots"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_materialized_slot_lifecycle();

DO $$
DECLARE
  stored_suite RECORD;
BEGIN
  FOR stored_suite IN
    SELECT "id", "owner_user_id"
    FROM "ai_media_suites"
    WHERE "revision" = 4
  LOOP
    PERFORM assert_ai_media_suite_materialized_graph(stored_suite."id", stored_suite."owner_user_id");
    PERFORM assert_ai_media_suite_materialized_authority(stored_suite."id", stored_suite."owner_user_id");
  END LOOP;
END;
$$;

COMMIT;
