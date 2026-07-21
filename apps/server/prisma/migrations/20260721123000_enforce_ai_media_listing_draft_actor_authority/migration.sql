BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION validate_ai_media_listing_draft_application_mutation_actor() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "users" actor
    WHERE actor."id" = NEW."actor_user_id"
      AND (actor."id" = NEW."owner_user_id" OR actor."parent_id" = NEW."owner_user_id")
  ) THEN
    RAISE EXCEPTION 'listing draft application actor does not belong to owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_listing_draft_mutation_actor_insert"
BEFORE INSERT ON "ai_media_listing_draft_application_mutations"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_listing_draft_application_mutation_actor();

COMMIT;
