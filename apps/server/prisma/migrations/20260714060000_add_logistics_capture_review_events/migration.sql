BEGIN;
-- Audit tables are append-only and expected to stay small during this rollout.
-- Fail deployment instead of waiting behind an unexpected long-running writer.
SET LOCAL lock_timeout = '5s';


ALTER TABLE "logistics_capture_candidates"
  ADD CONSTRAINT "logistics_capture_candidate_event_scope_key"
  UNIQUE ("id", "tenant_id", "shop_id");

ALTER TABLE "logistics_scope_events"
  ADD COLUMN "capture_candidate_id" TEXT;

CREATE INDEX "logistics_scope_event_capture_candidate_idx"
  ON "logistics_scope_events"("capture_candidate_id", "created_at");

ALTER TABLE "logistics_scope_events"
  ADD CONSTRAINT "capture_review_event_candidate_scope_fkey"
  FOREIGN KEY ("capture_candidate_id", "tenant_id", "shop_id")
  REFERENCES "logistics_capture_candidates"("id", "tenant_id", "shop_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "logistics_scope_events" (
  "id", "tenant_id", "shop_id", "capture_candidate_id",
  "subject_type", "subject_id", "event_type", "actor_user_id",
  "payload", "created_at"
)
SELECT
  'capture-review-' || md5(c."id" || ':' || c."review_status"::text),
  c."tenant_id",
  c."shop_id",
  c."id",
  'CAPTURE_CANDIDATE',
  c."id",
  CASE c."review_status"::text
    WHEN 'VERIFIED' THEN 'CAPTURE_CANDIDATE_VERIFIED'
    ELSE 'CAPTURE_CANDIDATE_REJECTED'
  END,
  c."reviewed_by_id",
  jsonb_build_object(
    'schema', 'logistics-capture-review-event/v1',
    'decision', c."review_status"::text,
    'candidateId', c."id",
    'taskId', c."source_task_id",
    'taskKind', c."task_kind"::text,
    'taskVersion', c."task_version",
    'tenantId', c."tenant_id",
    'shopId', c."shop_id",
    'companyId', c."company_id",
    'warehouseId', c."warehouse_id",
    'originCountryUid', c."origin_country_uid",
    'originCityUid', c."origin_city_uid",
    'destinationCountryUid', c."destination_country_uid",
    'destinationLocationUid', c."destination_location_uid",
    'fingerprintChecksum', c."fingerprint_checksum",
    'responseChecksum', c."response_checksum",
    'sourceResponseChecksum', c."source_response_checksum",
    'previousResponseChecksum', c."previous_response_checksum",
    'reasonDigest', encode(sha256(convert_to(c."review_reason", 'UTF8')), 'hex'),
    'reasonLength', char_length(c."review_reason")
  ),
  c."reviewed_at"
FROM "logistics_capture_candidates" c
WHERE c."review_status" IN ('VERIFIED', 'REJECTED');

CREATE UNIQUE INDEX "logistics_scope_event_capture_review_once"
  ON "logistics_scope_events"("capture_candidate_id")
  WHERE "capture_candidate_id" IS NOT NULL
    AND "event_type" IN (
      'CAPTURE_CANDIDATE_VERIFIED',
      'CAPTURE_CANDIDATE_REJECTED'
    );

ALTER TABLE "logistics_scope_events"
  ADD CONSTRAINT "logistics_scope_event_capture_review_check" CHECK (
    (
      "capture_candidate_id" IS NULL
      AND "subject_type" <> 'CAPTURE_CANDIDATE'
      AND "event_type" NOT IN (
        'CAPTURE_CANDIDATE_VERIFIED',
        'CAPTURE_CANDIDATE_REJECTED'
      )
    )
    OR
    (
      "capture_candidate_id" IS NOT NULL
      AND "subject_type" = 'CAPTURE_CANDIDATE'
      AND "subject_id" = "capture_candidate_id"
      AND "event_type" IN (
        'CAPTURE_CANDIDATE_VERIFIED',
        'CAPTURE_CANDIDATE_REJECTED'
      )
      AND "actor_user_id" IS NOT NULL
      AND "bootstrap_id" IS NULL
      AND "probe_id" IS NULL
      AND "channel_id" IS NULL
      AND "assignment_id" IS NULL
      AND "device_session_id" IS NULL
      AND jsonb_typeof("payload") = 'object'
      AND "payload" ?& ARRAY[
        'schema',
        'decision',
        'candidateId',
        'taskId',
        'taskKind',
        'taskVersion',
        'tenantId',
        'shopId',
        'companyId',
        'warehouseId',
        'originCountryUid',
        'originCityUid',
        'destinationCountryUid',
        'destinationLocationUid',
        'fingerprintChecksum',
        'responseChecksum',
        'sourceResponseChecksum',
        'previousResponseChecksum',
        'reasonDigest',
        'reasonLength'
      ]::text[]
      AND (
        "payload" - ARRAY[
          'schema',
          'decision',
          'candidateId',
          'taskId',
          'taskKind',
          'taskVersion',
          'tenantId',
          'shopId',
          'companyId',
          'warehouseId',
          'originCountryUid',
          'originCityUid',
          'destinationCountryUid',
          'destinationLocationUid',
          'fingerprintChecksum',
          'responseChecksum',
          'sourceResponseChecksum',
          'previousResponseChecksum',
          'reasonDigest',
          'reasonLength'
        ]::text[]
      ) = '{}'::jsonb
      AND "payload" ->> 'schema' = 'logistics-capture-review-event/v1'
      AND "payload" ->> 'candidateId' = "capture_candidate_id"
      AND "payload" ->> 'tenantId' = "tenant_id"
      AND "payload" ->> 'shopId' = "shop_id"
      AND (
        ("event_type" = 'CAPTURE_CANDIDATE_VERIFIED'
          AND "payload" ->> 'decision' = 'VERIFIED')
        OR
        ("event_type" = 'CAPTURE_CANDIDATE_REJECTED'
          AND "payload" ->> 'decision' = 'REJECTED')
      )
      AND "payload" ->> 'taskKind' IN ('SELLER', 'OFFICIAL')
      AND "payload" ->> 'taskVersion' ~ '^logistics-capture-task/v[0-9]+$'
      AND char_length(btrim("payload" ->> 'taskId')) BETWEEN 1 AND 500
      AND char_length(btrim("payload" ->> 'companyId')) BETWEEN 1 AND 500
      AND char_length(btrim("payload" ->> 'warehouseId')) BETWEEN 1 AND 500
      AND char_length(btrim("payload" ->> 'originCountryUid')) BETWEEN 1 AND 500
      AND char_length(btrim("payload" ->> 'originCityUid')) BETWEEN 1 AND 500
      AND "payload" ->> 'fingerprintChecksum' ~ '^[a-f0-9]{64}$'
      AND "payload" ->> 'responseChecksum' ~ '^[a-f0-9]{64}$'
      AND "payload" ->> 'reasonDigest' ~ '^[a-f0-9]{64}$'
      AND (
        (
          jsonb_typeof("payload" -> 'destinationCountryUid') = 'null'
          AND jsonb_typeof("payload" -> 'destinationLocationUid') = 'null'
        )
        OR
        (
          jsonb_typeof("payload" -> 'destinationCountryUid') = 'string'
          AND jsonb_typeof("payload" -> 'destinationLocationUid') = 'string'
          AND char_length(btrim("payload" ->> 'destinationCountryUid')) BETWEEN 1 AND 500
          AND char_length(btrim("payload" ->> 'destinationLocationUid')) BETWEEN 1 AND 500
        )
      )
      AND (
        jsonb_typeof("payload" -> 'sourceResponseChecksum') = 'null'
        OR (
          jsonb_typeof("payload" -> 'sourceResponseChecksum') = 'string'
          AND "payload" ->> 'sourceResponseChecksum' ~ '^[a-f0-9]{64}$'
        )
      )
      AND (
        jsonb_typeof("payload" -> 'previousResponseChecksum') = 'null'
        OR (
          jsonb_typeof("payload" -> 'previousResponseChecksum') = 'string'
          AND "payload" ->> 'previousResponseChecksum' ~ '^[a-f0-9]{64}$'
        )
      )
      AND jsonb_typeof("payload" -> 'reasonLength') = 'number'
      AND "payload" ->> 'reasonLength' ~ '^[0-9]{1,4}$'
      AND ("payload" ->> 'reasonLength')::integer BETWEEN 3 AND 1000
    )
  );

CREATE FUNCTION "validate_logistics_capture_review_event"() RETURNS trigger AS $$
DECLARE
  candidate "logistics_capture_candidates"%ROWTYPE;
  expected_event_type TEXT;
  expected_reason_digest TEXT;
BEGIN
  IF NEW."capture_candidate_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.* INTO candidate
    FROM "logistics_capture_candidates" c
   WHERE c."id" = NEW."capture_candidate_id"
     AND c."tenant_id" = NEW."tenant_id"
     AND c."shop_id" = NEW."shop_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capture review event candidate scope does not exist'
      USING ERRCODE = '23503';
  END IF;
  IF candidate."review_status" NOT IN ('VERIFIED', 'REJECTED') THEN
    RAISE EXCEPTION 'capture review event requires a terminal candidate review'
      USING ERRCODE = '23514';
  END IF;

  expected_event_type := CASE candidate."review_status"::text
    WHEN 'VERIFIED' THEN 'CAPTURE_CANDIDATE_VERIFIED'
    ELSE 'CAPTURE_CANDIDATE_REJECTED'
  END;
  expected_reason_digest := encode(
    sha256(convert_to(candidate."review_reason", 'UTF8')),
    'hex'
  );

  IF NEW."event_type" IS DISTINCT FROM expected_event_type
    OR NEW."actor_user_id" IS DISTINCT FROM candidate."reviewed_by_id"
    OR NEW."created_at" IS DISTINCT FROM candidate."reviewed_at"
    OR NEW."payload" ->> 'decision'
      IS DISTINCT FROM candidate."review_status"::text
    OR NEW."payload" ->> 'candidateId'
      IS DISTINCT FROM candidate."id"
    OR NEW."payload" ->> 'taskId'
      IS DISTINCT FROM candidate."source_task_id"
    OR NEW."payload" ->> 'taskKind'
      IS DISTINCT FROM candidate."task_kind"::text
    OR NEW."payload" ->> 'taskVersion'
      IS DISTINCT FROM candidate."task_version"
    OR NEW."payload" ->> 'tenantId'
      IS DISTINCT FROM candidate."tenant_id"
    OR NEW."payload" ->> 'shopId'
      IS DISTINCT FROM candidate."shop_id"
    OR NEW."payload" ->> 'companyId'
      IS DISTINCT FROM candidate."company_id"
    OR NEW."payload" ->> 'warehouseId'
      IS DISTINCT FROM candidate."warehouse_id"
    OR NEW."payload" ->> 'originCountryUid'
      IS DISTINCT FROM candidate."origin_country_uid"
    OR NEW."payload" ->> 'originCityUid'
      IS DISTINCT FROM candidate."origin_city_uid"
    OR NEW."payload" ->> 'destinationCountryUid'
      IS DISTINCT FROM candidate."destination_country_uid"
    OR NEW."payload" ->> 'destinationLocationUid'
      IS DISTINCT FROM candidate."destination_location_uid"
    OR NEW."payload" ->> 'fingerprintChecksum'
      IS DISTINCT FROM candidate."fingerprint_checksum"
    OR NEW."payload" ->> 'responseChecksum'
      IS DISTINCT FROM candidate."response_checksum"
    OR NEW."payload" ->> 'sourceResponseChecksum'
      IS DISTINCT FROM candidate."source_response_checksum"
    OR NEW."payload" ->> 'previousResponseChecksum'
      IS DISTINCT FROM candidate."previous_response_checksum"
    OR NEW."payload" ->> 'reasonDigest'
      IS DISTINCT FROM expected_reason_digest
    OR NEW."payload" ->> 'reasonLength'
      IS DISTINCT FROM char_length(candidate."review_reason")::text THEN
    RAISE EXCEPTION 'capture review event provenance does not match candidate review'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_capture_review_event_provenance"
  BEFORE INSERT ON "logistics_scope_events"
  FOR EACH ROW EXECUTE FUNCTION "validate_logistics_capture_review_event"();

CREATE FUNCTION "ensure_logistics_capture_review_event"() RETURNS trigger AS $$
DECLARE
  expected_event_type TEXT;
BEGIN
  IF NEW."review_status" NOT IN ('VERIFIED', 'REJECTED') THEN
    RETURN NULL;
  END IF;

  expected_event_type := CASE NEW."review_status"::text
    WHEN 'VERIFIED' THEN 'CAPTURE_CANDIDATE_VERIFIED'
    ELSE 'CAPTURE_CANDIDATE_REJECTED'
  END;

  IF NOT EXISTS (
    SELECT 1
      FROM "logistics_scope_events" e
     WHERE e."capture_candidate_id" = NEW."id"
       AND e."tenant_id" = NEW."tenant_id"
       AND e."shop_id" = NEW."shop_id"
       AND e."subject_type" = 'CAPTURE_CANDIDATE'
       AND e."subject_id" = NEW."id"
       AND e."event_type" = expected_event_type
       AND e."actor_user_id" = NEW."reviewed_by_id"
       AND e."created_at" = NEW."reviewed_at"
  ) THEN
    RAISE EXCEPTION 'terminal capture review requires one matching scope event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "logistics_capture_review_event_required"
  AFTER INSERT OR UPDATE ON "logistics_capture_candidates"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ensure_logistics_capture_review_event"();


CREATE FUNCTION "prevent_logistics_scope_event_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'logistics scope events are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_scope_event_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_scope_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_logistics_scope_event_mutation"();

COMMIT;
