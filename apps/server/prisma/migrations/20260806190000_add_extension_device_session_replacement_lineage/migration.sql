BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "extension_device_sessions"
  ADD COLUMN "replaces_session_id" TEXT;

ALTER TABLE "extension_device_sessions"
  ADD CONSTRAINT "extension_device_sessions_replacement_not_self_check"
  CHECK (
    "replaces_session_id" IS NULL
    OR "replaces_session_id" <> "id"
  );

CREATE UNIQUE INDEX "extension_device_sessions_replaces_session_id_key"
  ON "extension_device_sessions"("replaces_session_id");

ALTER TABLE "extension_device_sessions"
  ADD CONSTRAINT "extension_device_sessions_replaces_session_id_fkey"
  FOREIGN KEY ("replaces_session_id")
  REFERENCES "extension_device_sessions"("id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION "extension_byok_publish_session_matches"(
  provenance_session_id TEXT,
  command_session_id TEXT,
  expected_owner_user_id TEXT,
  expected_actor_user_id TEXT,
  expected_shop_id TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  -- Command issuance and consumption enforce liveness. This matcher preserves
  -- durable receipt identity after a later re-pair, expiry, or revocation.
  SELECT provenance_session_id = command_session_id
    OR EXISTS (
      SELECT 1
      FROM "extension_device_sessions" provenance_session
      JOIN "extension_device_sessions" command_session
        ON command_session."id" = command_session_id
       AND command_session."replaces_session_id" = provenance_session."id"
       AND command_session."deployment_id" = provenance_session."deployment_id"
       AND command_session."device_id" = provenance_session."device_id"
       AND command_session."owner_user_id" = provenance_session."owner_user_id"
       AND command_session."actor_user_id" = provenance_session."actor_user_id"
      JOIN "extension_device_shop_grants" provenance_grant
        ON provenance_grant."session_id" = provenance_session."id"
       AND provenance_grant."shop_id" = expected_shop_id
      JOIN "extension_device_shop_grants" command_grant
        ON command_grant."session_id" = command_session."id"
       AND command_grant."shop_id" = expected_shop_id
      WHERE provenance_session."id" = provenance_session_id
        AND provenance_session."owner_user_id" = expected_owner_user_id
        AND provenance_session."actor_user_id" = expected_actor_user_id
        AND provenance_session."status" = 'REVOKED'
        AND provenance_session."revoked_at" IS NOT NULL
        AND provenance_session."revoked_reason" = 'PAIRING_APPROVED'
        AND provenance_session."scopes" @> ARRAY['byok:media:ingest']::TEXT[]
        AND provenance_grant."status" = 'REVOKED'
        AND provenance_grant."revoked_at" IS NOT NULL
        AND provenance_grant."revoked_reason" = 'PAIRING_APPROVED'
        AND command_session."scopes" @> ARRAY[
          'byok:media:ingest', 'listing:publish'
        ]::TEXT[]
    );
$$;

DO $replacement_lineage$
DECLARE
  function_definition TEXT;
  original_fragment CONSTANT TEXT :=
    'AND command_session."id" = NEW."device_session_id"';
  replacement_fragment CONSTANT TEXT :=
    'AND "extension_byok_publish_session_matches"(NEW."device_session_id", command_session."id", NEW."owner_user_id", NEW."actor_user_id", NEW."shop_id")';
BEGIN
  SELECT pg_get_functiondef(
    'validate_extension_byok_media_provenance_authority()'::regprocedure
  ) INTO function_definition;
  IF function_definition IS NULL
    OR (
      length(function_definition)
      - length(replace(function_definition, original_fragment, ''))
    ) <> length(original_fragment)
  THEN
    RAISE EXCEPTION 'BYOK provenance publish receipt guard has unexpected definition';
  END IF;
  EXECUTE replace(function_definition, original_fragment, replacement_fragment);
END;
$replacement_lineage$;

CREATE OR REPLACE FUNCTION "prevent_extension_device_session_replacement_rewrite"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."replaces_session_id" IS DISTINCT FROM OLD."replaces_session_id" THEN
    RAISE EXCEPTION 'extension device session replacement lineage is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "prevent_extension_device_session_replacement_rewrite"
BEFORE UPDATE ON "extension_device_sessions"
FOR EACH ROW
EXECUTE FUNCTION "prevent_extension_device_session_replacement_rewrite"();

COMMIT;
