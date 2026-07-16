BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "ozon_publisher_parity_difference_subjects"
  ADD COLUMN "legacy_item_count" INTEGER,
  ADD COLUMN "v2_item_count" INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT observation."difference_subject_key"
      FROM "ozon_publisher_parity_observations" observation
     WHERE observation."difference_subject_key" IS NOT NULL
     GROUP BY observation."difference_subject_key"
    HAVING MIN(observation."legacy_item_count") <> MAX(observation."legacy_item_count")
       OR MIN(observation."v2_item_count") <> MAX(observation."v2_item_count")
  ) THEN
    RAISE EXCEPTION 'Existing Ozon publisher parity subject observations disagree on item counts'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

UPDATE "ozon_publisher_parity_difference_subjects" subject
   SET "legacy_item_count" = evidence."legacy_item_count",
       "v2_item_count" = evidence."v2_item_count"
  FROM (
    SELECT observation."difference_subject_key",
           MIN(observation."legacy_item_count") AS "legacy_item_count",
           MIN(observation."v2_item_count") AS "v2_item_count"
      FROM "ozon_publisher_parity_observations" observation
     WHERE observation."difference_subject_key" IS NOT NULL
     GROUP BY observation."difference_subject_key"
  ) evidence
 WHERE subject."subject_key" = evidence."difference_subject_key";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "ozon_publisher_parity_difference_subjects"
     WHERE "legacy_item_count" IS NULL OR "v2_item_count" IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing Ozon publisher parity subject has no retained count evidence'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "ozon_publisher_parity_difference_subjects"
  ALTER COLUMN "legacy_item_count" SET NOT NULL,
  ALTER COLUMN "v2_item_count" SET NOT NULL,
  ADD CONSTRAINT "ozon_parity_subject_item_count_check" CHECK (
    "legacy_item_count" BETWEEN 0 AND 50000
    AND "v2_item_count" BETWEEN 0 AND 50000
  );

CREATE FUNCTION "ozon_publisher_parity_difference_rows_approvable"(rows_json JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  difference_row JSONB;
BEGIN
  IF jsonb_typeof(rows_json) IS DISTINCT FROM 'array' THEN
    RETURN FALSE;
  END IF;
  FOR difference_row IN
    SELECT item FROM jsonb_array_elements(rows_json) AS elements(item)
  LOOP
    IF jsonb_typeof(difference_row) IS DISTINCT FROM 'object'
      OR difference_row ->> 'classification' IS NULL
      OR difference_row ->> 'classification'
        NOT IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM') THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

ALTER TABLE "ozon_publisher_parity_difference_subjects"
  ADD CONSTRAINT "ozon_parity_subject_approval_eligibility_check" CHECK (
    "approval_state" <> 'APPROVED'
    OR (
      "observation_count" > 0
      AND "classification" IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM')
      AND "ozon_publisher_parity_difference_rows_approvable"("difference_rows_json")
    )
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
    OR NEW."legacy_item_count" IS DISTINCT FROM aggregate."legacy_item_count"
    OR NEW."v2_kind" IS DISTINCT FROM aggregate."v2_kind"
    OR NEW."v2_endpoint" IS DISTINCT FROM aggregate."v2_endpoint"
    OR NEW."v2_item_count" IS DISTINCT FROM aggregate."v2_item_count"
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

CREATE FUNCTION "validate_ozon_publisher_parity_subject_item_identity"()
RETURNS trigger AS $$
BEGIN
  IF NEW."legacy_item_count" IS DISTINCT FROM OLD."legacy_item_count"
    OR NEW."v2_item_count" IS DISTINCT FROM OLD."v2_item_count" THEN
    RAISE EXCEPTION 'Ozon publisher parity subject item counts are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publisher_parity_subject_item_identity"
  BEFORE UPDATE ON "ozon_publisher_parity_difference_subjects"
  FOR EACH ROW EXECUTE FUNCTION "validate_ozon_publisher_parity_subject_item_identity"();

COMMIT;
