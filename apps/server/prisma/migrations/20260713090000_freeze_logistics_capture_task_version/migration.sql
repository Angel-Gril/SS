BEGIN;

ALTER TABLE "logistics_capture_candidates"
  ADD COLUMN "task_version" TEXT;

DROP TRIGGER "logistics_capture_candidate_immutable"
  ON "logistics_capture_candidates";

UPDATE "logistics_capture_candidates" AS candidate
SET "task_version" = source_task."version"
FROM "logistics_capture_tasks" AS source_task
WHERE source_task."id" = candidate."source_task_id";

ALTER TABLE "logistics_capture_candidates"
  ALTER COLUMN "task_version" SET NOT NULL;

CREATE TRIGGER "logistics_capture_candidate_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_capture_candidates"
  FOR EACH ROW EXECUTE FUNCTION "prevent_logistics_capture_candidate_mutation"();

CREATE OR REPLACE FUNCTION "validate_logistics_capture_candidate_source_task"()
RETURNS trigger AS $$
DECLARE
  source_task "logistics_capture_tasks"%ROWTYPE;
BEGIN
  SELECT *
  INTO source_task
  FROM "logistics_capture_tasks"
  WHERE "id" = NEW."source_task_id";

  IF NOT FOUND
    OR NEW."task_version" IS DISTINCT FROM source_task."version"
    OR NEW."tenant_id" IS DISTINCT FROM source_task."tenant_id"
    OR NEW."shop_id" IS DISTINCT FROM source_task."shop_id"
    OR NEW."company_id" IS DISTINCT FROM source_task."company_id"
    OR NEW."warehouse_id" IS DISTINCT FROM source_task."warehouse_id"
    OR NEW."origin_country_uid" IS DISTINCT FROM source_task."origin_country_uid"
    OR NEW."origin_city_uid" IS DISTINCT FROM source_task."origin_city_uid"
    OR NEW."task_kind" IS DISTINCT FROM source_task."kind"
    OR NEW."destination_country_uid"
      IS DISTINCT FROM source_task."destination_country_uid"
    OR NEW."destination_location_uid"
      IS DISTINCT FROM source_task."destination_location_uid"
    OR NEW."fingerprint_checksum" IS DISTINCT FROM source_task."fingerprint_checksum"
  THEN
    RAISE EXCEPTION 'logistics capture candidate source task provenance mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_logistics_capture_task_source_provenance"()
RETURNS trigger AS $$
BEGIN
  IF NEW."version" IS DISTINCT FROM OLD."version" THEN
    RAISE EXCEPTION 'logistics capture task version is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "logistics_capture_candidates" candidate
    WHERE candidate."source_task_id" = OLD."id"
      AND (
        candidate."source_task_id" IS DISTINCT FROM NEW."id"
        OR candidate."task_version" IS DISTINCT FROM NEW."version"
        OR candidate."tenant_id" IS DISTINCT FROM NEW."tenant_id"
        OR candidate."shop_id" IS DISTINCT FROM NEW."shop_id"
        OR candidate."company_id" IS DISTINCT FROM NEW."company_id"
        OR candidate."warehouse_id" IS DISTINCT FROM NEW."warehouse_id"
        OR candidate."origin_country_uid" IS DISTINCT FROM NEW."origin_country_uid"
        OR candidate."origin_city_uid" IS DISTINCT FROM NEW."origin_city_uid"
        OR candidate."task_kind" IS DISTINCT FROM NEW."kind"
        OR candidate."destination_country_uid"
          IS DISTINCT FROM NEW."destination_country_uid"
        OR candidate."destination_location_uid"
          IS DISTINCT FROM NEW."destination_location_uid"
        OR candidate."fingerprint_checksum" IS DISTINCT FROM NEW."fingerprint_checksum"
        OR NEW."company_binding_id" IS DISTINCT FROM OLD."company_binding_id"
        OR NEW."origin_binding_id" IS DISTINCT FROM OLD."origin_binding_id"
        OR NEW."official_fingerprint" IS DISTINCT FROM OLD."official_fingerprint"
        OR NEW."expected_endpoints" IS DISTINCT FROM OLD."expected_endpoints"
      )
  ) THEN
    RAISE EXCEPTION 'logistics capture candidate source task provenance mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
