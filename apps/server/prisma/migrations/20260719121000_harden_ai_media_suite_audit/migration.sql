BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_media_suite_slots"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "ai_media_suite_slot_revision_check" CHECK ("revision" >= 1);

CREATE OR REPLACE FUNCTION protect_ai_media_suite_slot_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media suite slot cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."suite_id" IS DISTINCT FROM OLD."suite_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."slot_key" IS DISTINCT FROM OLD."slot_key"
    OR NEW."goal" IS DISTINCT FROM OLD."goal"
    OR NEW."ownership_level" IS DISTINCT FROM OLD."ownership_level"
    OR NEW."ownership_key" IS DISTINCT FROM OLD."ownership_key"
    OR NEW."compatibility_group_key" IS DISTINCT FROM OLD."compatibility_group_key"
    OR NEW."slot_snapshot_json" IS DISTINCT FROM OLD."slot_snapshot_json"
    OR NEW."slot_hash" IS DISTINCT FROM OLD."slot_hash"
    OR NEW."references_snapshot_json" IS DISTINCT FROM OLD."references_snapshot_json"
    OR NEW."references_hash" IS DISTINCT FROM OLD."references_hash"
    OR NEW."estimated_cost_cents" IS DISTINCT FROM OLD."estimated_cost_cents"
    OR NEW."maximum_cost_cents" IS DISTINCT FROM OLD."maximum_cost_cents"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media suite slot identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'AI media suite slot revision must advance by one' USING ERRCODE = '23514';
  END IF;
  IF OLD."child_workflow_id" IS NOT NULL
    AND NEW."child_workflow_id" IS DISTINCT FROM OLD."child_workflow_id"
  THEN
    RAISE EXCEPTION 'AI media suite child workflow cannot be cleared or replaced' USING ERRCODE = '23514';
  END IF;
  IF NEW."attempt" < OLD."attempt" OR NEW."attempt" > OLD."attempt" + 1 THEN
    RAISE EXCEPTION 'AI media suite slot attempt sequence is invalid' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'SUCCEEDED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'successful AI media suite slot is terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_ai_media_suite_event_insert() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
BEGIN
  SELECT * INTO stored_suite FROM "ai_media_suites"
    WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id" FOR SHARE;
  IF stored_suite."revision" IS DISTINCT FROM NEW."revision" THEN
    RAISE EXCEPTION 'AI media suite event revision mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" = 1
    AND (NEW."event_type" <> 'CLAIMED' OR NEW."actor_user_id" <> stored_suite."actor_user_id")
  THEN
    RAISE EXCEPTION 'AI media suite claim event does not match its authority' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_media_suite_event_validate_insert"
BEFORE INSERT ON "ai_media_suite_events"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_event_insert();

CREATE OR REPLACE FUNCTION require_ai_media_suite_revision_event() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ai_media_suite_events"
    WHERE "suite_id" = NEW."id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "revision" = NEW."revision"
  ) THEN
    RAISE EXCEPTION 'AI media suite revision requires an audit event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "ai_media_suite_revision_requires_event"
AFTER INSERT OR UPDATE ON "ai_media_suites"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_suite_revision_event();

COMMIT;
