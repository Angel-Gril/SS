BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "ozon_publisher_parity_observations"
  RENAME COLUMN "contract_version" TO "report_contract_version";
ALTER TABLE "ozon_publisher_parity_difference_subjects"
  RENAME COLUMN "contract_version" TO "report_contract_version";

ALTER TABLE "ozon_publisher_parity_observations"
  ADD COLUMN "record_contract_version" TEXT NOT NULL
    DEFAULT 'ozon-publisher-parity-observation/v1';
ALTER TABLE "ozon_publisher_parity_difference_subjects"
  ADD COLUMN "record_contract_version" TEXT NOT NULL
    DEFAULT 'ozon-publisher-parity-difference-subject/v1';
ALTER TABLE "ozon_publisher_parity_observations"
  ALTER COLUMN "record_contract_version" DROP DEFAULT;
ALTER TABLE "ozon_publisher_parity_difference_subjects"
  ALTER COLUMN "record_contract_version" DROP DEFAULT,
  ALTER COLUMN "publisher_contract_version" SET NOT NULL,
  ALTER COLUMN "payload_compiler_version" SET NOT NULL;

CREATE FUNCTION "ozon_publisher_parity_difference_rows_valid"(rows_json JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  difference_row JSONB;
  difference_type JSONB;
BEGIN
  IF jsonb_typeof(rows_json) IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  FOR difference_row IN
    SELECT item FROM jsonb_array_elements(rows_json) AS elements(item)
  LOOP
    IF jsonb_typeof(difference_row) IS DISTINCT FROM 'object'
      OR NOT (difference_row ?& ARRAY['path', 'kind', 'classification', 'presence', 'type']::TEXT[])
      OR (difference_row - ARRAY['path', 'kind', 'classification', 'presence', 'type']::TEXT[]) <> '{}'::JSONB
      OR jsonb_typeof(difference_row -> 'path') IS DISTINCT FROM 'string'
      OR length(difference_row ->> 'path') NOT BETWEEN 1 AND 512
      OR jsonb_typeof(difference_row -> 'kind') IS DISTINCT FROM 'string'
      OR (difference_row ->> 'kind') NOT IN (
        'MISSING_IN_V2', 'MISSING_IN_LEGACY', 'TYPE_MISMATCH',
        'VALUE_MISMATCH', 'ORDER_MISMATCH', 'INVALID_PAYLOAD'
      )
      OR jsonb_typeof(difference_row -> 'classification') IS DISTINCT FROM 'string'
      OR (difference_row ->> 'classification') NOT IN (
        'INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT'
      )
      OR jsonb_typeof(difference_row -> 'presence') IS DISTINCT FROM 'string'
      OR (difference_row ->> 'presence') NOT IN ('BOTH', 'LEGACY_ONLY', 'V2_ONLY') THEN
      RETURN FALSE;
    END IF;
    difference_type := difference_row -> 'type';
    IF jsonb_typeof(difference_type) IS DISTINCT FROM 'object'
      OR NOT (difference_type ?& ARRAY['legacy', 'v2']::TEXT[])
      OR (difference_type - ARRAY['legacy', 'v2']::TEXT[]) <> '{}'::JSONB
      OR jsonb_typeof(difference_type -> 'legacy') IS DISTINCT FROM 'string'
      OR (difference_type ->> 'legacy') NOT IN (
        'absent', 'null', 'boolean', 'number', 'string', 'array', 'object'
      )
      OR jsonb_typeof(difference_type -> 'v2') IS DISTINCT FROM 'string'
      OR (difference_type ->> 'v2') NOT IN (
        'absent', 'null', 'boolean', 'number', 'string', 'array', 'object'
      ) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

ALTER TABLE "ozon_publisher_parity_observations"
  DROP CONSTRAINT "ozon_parity_observation_v2_check",
  ADD CONSTRAINT "ozon_parity_observation_contract_versions_check" CHECK (
    "record_contract_version" = 'ozon-publisher-parity-observation/v1'
    AND "report_contract_version" = 'ozon-publisher-entrypoint-parity/v1'
  ),
  ADD CONSTRAINT "ozon_parity_observation_difference_rows_check" CHECK (
    "ozon_publisher_parity_difference_rows_valid"("difference_rows_json")
  ),
  ADD CONSTRAINT "ozon_parity_observation_v2_check" CHECK (
    (
      "v2_kind" = 'COMPILED'
      AND "v2_endpoint" IS NOT NULL
      AND length(btrim("v2_endpoint")) BETWEEN 1 AND 100
      AND "v2_payload_hash" IS NOT NULL
      AND "v2_item_count" IS NOT NULL
      AND (
        ("status" IN ('MATCH', 'DIFFERENT')
          AND "publisher_contract_version" IS NOT DISTINCT FROM
            'ozon-listing-production-compile-adapter/v1'
          AND "payload_compiler_version" IS NOT DISTINCT FROM
            'ozon-listing-payload-compiler/v1')
        OR ("status" = 'NOT_COMPARABLE'
          AND ("publisher_contract_version" IS NULL
            OR "publisher_contract_version" = 'ozon-listing-production-compile-adapter/v1')
          AND ("payload_compiler_version" IS NULL
            OR "payload_compiler_version" = 'ozon-listing-payload-compiler/v1'))
      )
      AND "blocker_code" IS NULL
      AND "reason_code" IS NULL
      AND "status" IN ('MATCH', 'DIFFERENT', 'NOT_COMPARABLE')
    ) OR (
      "v2_kind" = 'BLOCKED'
      AND "v2_endpoint" IS NULL AND "v2_payload_hash" IS NULL AND "v2_item_count" IS NULL
      AND "blocker_code" IS NOT NULL
      AND "blocker_code" ~ '^[A-Z][A-Z0-9_]{0,99}$'
      AND "reason_code" IS NULL
      AND "status" = 'V2_BLOCKED'
    ) OR (
      "v2_kind" = 'UNAVAILABLE'
      AND "v2_endpoint" IS NULL AND "v2_payload_hash" IS NULL AND "v2_item_count" IS NULL
      AND "blocker_code" IS NULL
      AND "reason_code" IS NOT NULL
      AND "reason_code" ~ '^[A-Z][A-Z0-9_]{0,99}$'
      AND "status" = 'NOT_COMPARABLE'
    )
  );

ALTER TABLE "ozon_publisher_parity_difference_subjects"
  DROP CONSTRAINT "ozon_parity_subject_identity_check",
  DROP CONSTRAINT "ozon_parity_subject_v2_check",
  ADD CONSTRAINT "ozon_parity_subject_identity_check" CHECK (
    "subject_key" ~ '^[0-9a-f]{64}$'
    AND "full_difference_signature" ~ '^[0-9a-f]{64}$'
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "record_contract_version" = 'ozon-publisher-parity-difference-subject/v1'
    AND "report_contract_version" = 'ozon-publisher-entrypoint-parity/v1'
    AND length(btrim("legacy_endpoint")) BETWEEN 1 AND 100
    AND "classification" IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT')
    AND "v2_kind" = 'COMPILED'
    AND "difference_total" BETWEEN 1 AND 100
    AND jsonb_typeof("difference_rows_json") = 'array'
    AND jsonb_array_length("difference_rows_json") = "difference_total"
    AND pg_column_size("difference_rows_json") <= 131072
    AND "observation_count" >= 0
    AND "state_version" >= 0
    AND "first_observed_at" <= "last_observed_at"
    AND ("observation_count" > 0 OR "first_observed_at" = "last_observed_at")
  ),
  ADD CONSTRAINT "ozon_parity_subject_v2_check" CHECK (
    "v2_kind" = 'COMPILED'
    AND "v2_endpoint" IS NOT NULL
    AND length(btrim("v2_endpoint")) BETWEEN 1 AND 100
    AND "publisher_contract_version" = 'ozon-listing-production-compile-adapter/v1'
    AND "payload_compiler_version" = 'ozon-listing-payload-compiler/v1'
  ),
  ADD CONSTRAINT "ozon_parity_subject_difference_rows_check" CHECK (
    "ozon_publisher_parity_difference_rows_valid"("difference_rows_json")
  );

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_parity_observation_subject"()
RETURNS trigger AS $$
DECLARE
  aggregate "ozon_publisher_parity_difference_subjects"%ROWTYPE;
BEGIN
  IF NEW."difference_subject_key" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT subject.* INTO aggregate
    FROM "ozon_publisher_parity_difference_subjects" subject
   WHERE subject."subject_key" = NEW."difference_subject_key"
   FOR KEY SHARE;
  IF NOT FOUND
    OR NEW."status" <> 'DIFFERENT'
    OR NEW."entrypoint" IS DISTINCT FROM aggregate."entrypoint"
    OR NEW."rollout_revision" IS DISTINCT FROM aggregate."rollout_revision"
    OR NEW."report_contract_version" IS DISTINCT FROM aggregate."report_contract_version"
    OR NEW."legacy_endpoint" IS DISTINCT FROM aggregate."legacy_endpoint"
    OR NEW."v2_kind" IS DISTINCT FROM aggregate."v2_kind"
    OR NEW."v2_endpoint" IS DISTINCT FROM aggregate."v2_endpoint"
    OR NEW."publisher_contract_version" IS DISTINCT FROM aggregate."publisher_contract_version"
    OR NEW."payload_compiler_version" IS DISTINCT FROM aggregate."payload_compiler_version"
    OR NEW."classification" IS DISTINCT FROM aggregate."classification"
    OR NEW."full_difference_signature" IS DISTINCT FROM aggregate."full_difference_signature"
    OR NEW."difference_total" IS DISTINCT FROM aggregate."difference_total"
    OR NEW."difference_returned" IS DISTINCT FROM aggregate."difference_total"
    OR NEW."difference_truncated"
    OR NEW."difference_rows_json" IS DISTINCT FROM aggregate."difference_rows_json" THEN
    RAISE EXCEPTION 'Ozon publisher parity observation does not match its difference subject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "aggregate_ozon_publisher_parity_observation"() RETURNS trigger AS $$
BEGIN
  IF NEW."difference_subject_key" IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE "ozon_publisher_parity_difference_subjects"
     SET "observation_count" = "observation_count" + 1,
         "first_observed_at" = LEAST("first_observed_at", NEW."observed_at"),
         "last_observed_at" = GREATEST("last_observed_at", NEW."observed_at"),
         "updated_at" = GREATEST("updated_at", NEW."observed_at")
   WHERE "subject_key" = NEW."difference_subject_key";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ozon publisher parity observation subject is missing'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_parity_subject"() RETURNS trigger AS $$
DECLARE
  aggregate_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."approval_state" <> 'PENDING'
      OR NEW."state_version" <> 0
      OR NEW."observation_count" <> 0
      OR NEW."first_observed_at" IS DISTINCT FROM NEW."last_observed_at" THEN
      RAISE EXCEPTION 'Ozon publisher parity subject must start pending without observations'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."subject_key" IS DISTINCT FROM OLD."subject_key"
    OR NEW."entrypoint" IS DISTINCT FROM OLD."entrypoint"
    OR NEW."rollout_revision" IS DISTINCT FROM OLD."rollout_revision"
    OR NEW."record_contract_version" IS DISTINCT FROM OLD."record_contract_version"
    OR NEW."report_contract_version" IS DISTINCT FROM OLD."report_contract_version"
    OR NEW."legacy_endpoint" IS DISTINCT FROM OLD."legacy_endpoint"
    OR NEW."v2_kind" IS DISTINCT FROM OLD."v2_kind"
    OR NEW."v2_endpoint" IS DISTINCT FROM OLD."v2_endpoint"
    OR NEW."publisher_contract_version" IS DISTINCT FROM OLD."publisher_contract_version"
    OR NEW."payload_compiler_version" IS DISTINCT FROM OLD."payload_compiler_version"
    OR NEW."classification" IS DISTINCT FROM OLD."classification"
    OR NEW."full_difference_signature" IS DISTINCT FROM OLD."full_difference_signature"
    OR NEW."difference_total" IS DISTINCT FROM OLD."difference_total"
    OR NEW."difference_rows_json" IS DISTINCT FROM OLD."difference_rows_json"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Ozon publisher parity subject identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  aggregate_changed := NEW."observation_count" IS DISTINCT FROM OLD."observation_count"
    OR NEW."first_observed_at" IS DISTINCT FROM OLD."first_observed_at"
    OR NEW."last_observed_at" IS DISTINCT FROM OLD."last_observed_at";
  IF aggregate_changed AND (
    pg_trigger_depth() < 2
    OR NEW."observation_count" <> OLD."observation_count" + 1
    OR NEW."first_observed_at" > OLD."first_observed_at"
    OR NEW."last_observed_at" < OLD."last_observed_at"
  ) THEN
    RAISE EXCEPTION 'Ozon publisher parity subject observations are database-owned'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'Ozon publisher parity subject update time cannot regress'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."approval_state" = OLD."approval_state" THEN
    IF NEW."state_version" <> OLD."state_version"
      OR NEW."reviewed_by_user_id" IS DISTINCT FROM OLD."reviewed_by_user_id"
      OR NEW."review_note" IS DISTINCT FROM OLD."review_note"
      OR NEW."reviewed_at" IS DISTINCT FROM OLD."reviewed_at"
      OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
      OR NEW."rejected_at" IS DISTINCT FROM OLD."rejected_at"
      OR NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" THEN
      RAISE EXCEPTION 'Ozon publisher parity review fields require a state transition'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."state_version" <> OLD."state_version" + 1
      OR NOT (
        (OLD."approval_state" = 'PENDING' AND NEW."approval_state" IN ('APPROVED', 'REJECTED'))
        OR (OLD."approval_state" = 'APPROVED' AND NEW."approval_state" = 'REVOKED')
      ) THEN
      RAISE EXCEPTION 'Illegal Ozon publisher parity approval transition'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."approval_state" = 'APPROVED' AND (
    NEW."observation_count" <= 0
    OR NEW."classification" NOT IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM')
    OR EXISTS (
      SELECT 1
        FROM jsonb_array_elements(NEW."difference_rows_json") AS rows(row_data)
       WHERE row_data ->> 'classification'
         NOT IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM')
    )
  ) THEN
    RAISE EXCEPTION 'Ozon publisher parity defect evidence cannot be approved'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "ozon_publisher_parity_observation_provenance"
  ON "ozon_publisher_parity_observations";
CREATE TRIGGER "ozon_publisher_parity_observation_provenance"
  BEFORE INSERT ON "ozon_publisher_parity_observations"
  FOR EACH ROW EXECUTE FUNCTION "validate_ozon_publisher_parity_observation_subject"();
CREATE TRIGGER "ozon_publisher_parity_observation_immutable"
  BEFORE UPDATE ON "ozon_publisher_parity_observations"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ozon_publisher_parity_history_mutation"();
CREATE TRIGGER "ozon_publisher_parity_observation_aggregate"
  AFTER INSERT ON "ozon_publisher_parity_observations"
  FOR EACH ROW
  WHEN (NEW."difference_subject_key" IS NOT NULL)
  EXECUTE FUNCTION "aggregate_ozon_publisher_parity_observation"();

COMMIT;
