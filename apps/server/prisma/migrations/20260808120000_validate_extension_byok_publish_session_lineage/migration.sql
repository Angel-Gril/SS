BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION "extension_byok_publish_session_matches"(
  provenance_session_id TEXT,
  command_session_id TEXT,
  expected_owner_user_id TEXT,
  expected_actor_user_id TEXT,
  expected_shop_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_session "extension_device_sessions"%ROWTYPE;
  predecessor_session "extension_device_sessions"%ROWTYPE;
  visited_session_ids TEXT[];
  replacement_depth INTEGER;
BEGIN
  -- Preserve durable receipt matching when provenance and command use the same
  -- session. The surrounding provenance guard validates both persisted rows.
  IF provenance_session_id = command_session_id THEN
    RETURN TRUE;
  END IF;
  IF provenance_session_id IS NULL
    OR command_session_id IS NULL
    OR expected_owner_user_id IS NULL
    OR expected_actor_user_id IS NULL
    OR expected_shop_id IS NULL
  THEN
    RETURN FALSE;
  END IF;

  SELECT command_session.*
    INTO current_session
  FROM "extension_device_sessions" command_session
  WHERE command_session."id" = command_session_id
    AND command_session."owner_user_id" = expected_owner_user_id
    AND command_session."actor_user_id" = expected_actor_user_id
    AND command_session."scopes" @> ARRAY[
      'byok:media:ingest', 'listing:publish'
    ]::TEXT[]
    AND EXISTS (
      SELECT 1
      FROM "extension_device_shop_grants" command_grant
      WHERE command_grant."session_id" = command_session."id"
        AND command_grant."shop_id" = expected_shop_id
    );
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  visited_session_ids := ARRAY[current_session."id"]::TEXT[];
  FOR replacement_depth IN 1..16 LOOP
    IF current_session."replaces_session_id" IS NULL
      OR current_session."replaces_session_id" = ANY(visited_session_ids)
    THEN
      RETURN FALSE;
    END IF;

    SELECT predecessor.*
      INTO predecessor_session
    FROM "extension_device_sessions" predecessor
    WHERE predecessor."id" = current_session."replaces_session_id"
      AND predecessor."deployment_id" = current_session."deployment_id"
      AND predecessor."device_id" = current_session."device_id"
      AND predecessor."owner_user_id" = current_session."owner_user_id"
      AND predecessor."actor_user_id" = current_session."actor_user_id"
      AND predecessor."owner_user_id" = expected_owner_user_id
      AND predecessor."actor_user_id" = expected_actor_user_id
      AND predecessor."status" = 'REVOKED'
      AND predecessor."revoked_at" IS NOT NULL
      AND predecessor."revoked_at" <= CURRENT_TIMESTAMP
      AND predecessor."revoked_reason" = 'PAIRING_APPROVED'
      AND predecessor."scopes" @> ARRAY['byok:media:ingest']::TEXT[]
      AND EXISTS (
        SELECT 1
        FROM "extension_device_shop_grants" predecessor_grant
        WHERE predecessor_grant."session_id" = predecessor."id"
          AND predecessor_grant."shop_id" = expected_shop_id
          AND predecessor_grant."status" = 'REVOKED'
          AND predecessor_grant."revoked_at" IS NOT NULL
          AND predecessor_grant."revoked_at" <= CURRENT_TIMESTAMP
          AND predecessor_grant."revoked_reason" = 'PAIRING_APPROVED'
      );
    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;

    visited_session_ids := array_append(
      visited_session_ids,
      predecessor_session."id"
    );
    IF predecessor_session."id" = provenance_session_id THEN
      -- A predecessor that points back into the traversed path closes a cycle.
      IF predecessor_session."replaces_session_id" IS NOT NULL
        AND predecessor_session."replaces_session_id" = ANY(visited_session_ids)
      THEN
        RETURN FALSE;
      END IF;
      RETURN TRUE;
    END IF;
    current_session := predecessor_session;
  END LOOP;

  RETURN FALSE;
END;
$$;

COMMIT;
