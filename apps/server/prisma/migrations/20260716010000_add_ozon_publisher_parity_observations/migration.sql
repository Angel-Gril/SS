BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TYPE "OzonPublisherParityEntrypoint" AS ENUM (
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU',
  'BROWSER_ONE_CLICK', 'EXTENSION_ADAPTER'
);
CREATE TYPE "OzonPublisherParityReportStatus" AS ENUM (
  'MATCH', 'DIFFERENT', 'V2_BLOCKED', 'NOT_COMPARABLE'
);
CREATE TYPE "OzonPublisherParityClassification" AS ENUM (
  'MATCH', 'INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT', 'NOT_COMPARABLE'
);
CREATE TYPE "OzonPublisherParityV2Kind" AS ENUM ('COMPILED', 'BLOCKED', 'UNAVAILABLE');
CREATE TYPE "OzonPublisherParityApprovalState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');
CREATE TYPE "OzonPublisherParityDecisionAction" AS ENUM ('APPROVE', 'REJECT', 'REVOKE');

CREATE TABLE "ozon_publisher_parity_observations" (
  "id" TEXT NOT NULL,
  "record_key" TEXT NOT NULL,
  "scope_hash" TEXT NOT NULL,
  "entrypoint" "OzonPublisherParityEntrypoint" NOT NULL,
  "rollout_revision" TEXT NOT NULL,
  "contract_version" TEXT NOT NULL,
  "report_hash" TEXT NOT NULL,
  "status" "OzonPublisherParityReportStatus" NOT NULL,
  "classification" "OzonPublisherParityClassification" NOT NULL,
  "switch_eligible" BOOLEAN NOT NULL,
  "legacy_endpoint" TEXT NOT NULL,
  "legacy_payload_hash" TEXT NOT NULL,
  "legacy_item_count" INTEGER NOT NULL,
  "v2_kind" "OzonPublisherParityV2Kind" NOT NULL,
  "v2_endpoint" TEXT,
  "v2_payload_hash" TEXT,
  "v2_item_count" INTEGER,
  "publisher_contract_version" TEXT,
  "payload_compiler_version" TEXT,
  "blocker_code" VARCHAR(100),
  "reason_code" VARCHAR(100),
  "difference_total" INTEGER NOT NULL,
  "difference_returned" INTEGER NOT NULL,
  "difference_truncated" BOOLEAN NOT NULL,
  "difference_rows_json" JSONB NOT NULL,
  "full_difference_signature" TEXT,
  "difference_subject_key" TEXT,
  "observed_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publisher_parity_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_parity_observation_record_key" UNIQUE ("record_key"),
  CONSTRAINT "ozon_parity_observation_identity_check" CHECK (
    length(btrim("id")) BETWEEN 1 AND 100
    AND "record_key" ~ '^[0-9a-f]{64}$'
    AND "scope_hash" ~ '^[0-9a-f]{64}$'
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "contract_version" = 'ozon-publisher-entrypoint-parity/v1'
    AND length(btrim("legacy_endpoint")) BETWEEN 1 AND 100
    AND ("publisher_contract_version" IS NULL OR length(btrim("publisher_contract_version")) BETWEEN 1 AND 200)
    AND ("payload_compiler_version" IS NULL OR length(btrim("payload_compiler_version")) BETWEEN 1 AND 200)
    AND ("difference_subject_key" IS NULL OR "difference_subject_key" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "ozon_parity_observation_hash_check" CHECK (
    "legacy_payload_hash" ~ '^[0-9a-f]{64}$'
    AND "report_hash" ~ '^[0-9a-f]{64}$'
    AND ("v2_payload_hash" IS NULL OR "v2_payload_hash" ~ '^[0-9a-f]{64}$')
    AND ("full_difference_signature" IS NULL OR "full_difference_signature" ~ '^[0-9a-f]{64}$')
    AND ("difference_subject_key" IS NULL OR "full_difference_signature" IS NOT NULL)
  ),
  CONSTRAINT "ozon_parity_observation_count_check" CHECK (
    "legacy_item_count" >= 0
    AND ("v2_item_count" IS NULL OR "v2_item_count" >= 0)
    AND "difference_total" >= 0
    AND "difference_returned" BETWEEN 0 AND 100
    AND "difference_total" <= 50000
    AND "difference_returned" <= "difference_total"
    AND jsonb_typeof("difference_rows_json") = 'array'
    AND jsonb_array_length("difference_rows_json") = "difference_returned"
    AND pg_column_size("difference_rows_json") <= 131072
    AND "difference_truncated" = ("difference_total" > "difference_returned")
  ),
  CONSTRAINT "ozon_parity_observation_report_check" CHECK (
    ("status" = 'MATCH' AND "classification" = 'MATCH' AND "switch_eligible")
    OR ("status" = 'DIFFERENT' AND "classification" IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT') AND NOT "switch_eligible")
    OR ("status" = 'V2_BLOCKED' AND "classification" = 'INTENTIONAL_STRICTER' AND NOT "switch_eligible")
    OR ("status" = 'NOT_COMPARABLE' AND "classification" = 'NOT_COMPARABLE' AND NOT "switch_eligible")
  ),
  CONSTRAINT "ozon_parity_observation_v2_check" CHECK (
    (
      "v2_kind" = 'COMPILED'
      AND "v2_endpoint" IS NOT NULL
      AND length(btrim("v2_endpoint")) BETWEEN 1 AND 100
      AND "v2_payload_hash" IS NOT NULL
      AND "v2_item_count" IS NOT NULL
      AND (
        ("status" IN ('MATCH', 'DIFFERENT')
          AND "publisher_contract_version" = 'ozon-listing-production-compile-adapter/v1'
          AND "payload_compiler_version" = 'ozon-listing-payload-compiler/v1')
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
  ),
  CONSTRAINT "ozon_parity_observation_retention_check" CHECK ("expires_at" > "observed_at")
);

CREATE TABLE "ozon_publisher_parity_difference_subjects" (
  "subject_key" TEXT NOT NULL,
  "entrypoint" "OzonPublisherParityEntrypoint" NOT NULL,
  "rollout_revision" TEXT NOT NULL,
  "contract_version" TEXT NOT NULL,
  "legacy_endpoint" TEXT NOT NULL,
  "v2_kind" "OzonPublisherParityV2Kind" NOT NULL,
  "v2_endpoint" TEXT,
  "publisher_contract_version" TEXT,
  "payload_compiler_version" TEXT,
  "classification" "OzonPublisherParityClassification" NOT NULL,
  "full_difference_signature" TEXT NOT NULL,
  "difference_total" INTEGER NOT NULL,
  "difference_rows_json" JSONB NOT NULL,
  "approval_state" "OzonPublisherParityApprovalState" NOT NULL DEFAULT 'PENDING',
  "state_version" INTEGER NOT NULL DEFAULT 0,
  "observation_count" INTEGER NOT NULL,
  "first_observed_at" TIMESTAMP(3) NOT NULL,
  "last_observed_at" TIMESTAMP(3) NOT NULL,
  "reviewed_by_user_id" TEXT,
  "review_note" VARCHAR(1000),
  "reviewed_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ozon_publisher_parity_difference_subjects_pkey" PRIMARY KEY ("subject_key"),
  CONSTRAINT "ozon_parity_subject_identity_check" CHECK (
    "subject_key" ~ '^[0-9a-f]{64}$'
    AND "full_difference_signature" ~ '^[0-9a-f]{64}$'
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "contract_version" = 'ozon-publisher-entrypoint-parity/v1'
    AND length(btrim("legacy_endpoint")) BETWEEN 1 AND 100
    AND "classification" IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT')
    AND "v2_kind" = 'COMPILED'
    AND "difference_total" BETWEEN 1 AND 100
    AND jsonb_typeof("difference_rows_json") = 'array'
    AND jsonb_array_length("difference_rows_json") = "difference_total"
    AND pg_column_size("difference_rows_json") <= 131072
    AND "observation_count" > 0
    AND "state_version" >= 0
    AND "first_observed_at" <= "last_observed_at"
  ),
  CONSTRAINT "ozon_parity_subject_v2_check" CHECK (
    "v2_kind" = 'COMPILED'
    AND "v2_endpoint" IS NOT NULL
    AND length(btrim("v2_endpoint")) BETWEEN 1 AND 100
    AND "publisher_contract_version" = 'ozon-listing-production-compile-adapter/v1'
    AND "payload_compiler_version" = 'ozon-listing-payload-compiler/v1'
  ),
  CONSTRAINT "ozon_parity_subject_review_check" CHECK (
    (
      "approval_state" = 'PENDING' AND "state_version" = 0
      AND "reviewed_by_user_id" IS NULL AND "review_note" IS NULL AND "reviewed_at" IS NULL
      AND "approved_at" IS NULL AND "rejected_at" IS NULL AND "revoked_at" IS NULL
    ) OR (
      "approval_state" = 'APPROVED' AND "state_version" = 1
      AND "reviewed_by_user_id" IS NOT NULL AND "review_note" IS NOT NULL
      AND length(btrim("review_note")) BETWEEN 3 AND 1000
      AND "reviewed_at" IS NOT NULL AND "approved_at" = "reviewed_at"
      AND "rejected_at" IS NULL AND "revoked_at" IS NULL
    ) OR (
      "approval_state" = 'REJECTED' AND "state_version" = 1
      AND "reviewed_by_user_id" IS NOT NULL AND "review_note" IS NOT NULL
      AND length(btrim("review_note")) BETWEEN 3 AND 1000
      AND "reviewed_at" IS NOT NULL AND "rejected_at" = "reviewed_at"
      AND "approved_at" IS NULL AND "revoked_at" IS NULL
    ) OR (
      "approval_state" = 'REVOKED' AND "state_version" = 2
      AND "reviewed_by_user_id" IS NOT NULL AND "review_note" IS NOT NULL
      AND length(btrim("review_note")) BETWEEN 3 AND 1000
      AND "reviewed_at" IS NOT NULL AND "approved_at" IS NOT NULL AND "revoked_at" = "reviewed_at"
      AND "rejected_at" IS NULL AND "approved_at" < "revoked_at"
    )
  )
);

CREATE TABLE "ozon_publisher_parity_decisions" (
  "id" TEXT NOT NULL,
  "subject_key" TEXT NOT NULL,
  "transition_version" INTEGER NOT NULL,
  "decision_key" TEXT NOT NULL,
  "operation_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "action" "OzonPublisherParityDecisionAction" NOT NULL,
  "result_state" "OzonPublisherParityApprovalState" NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "review_note" VARCHAR(1000) NOT NULL,
  "observation_count_snapshot" INTEGER NOT NULL,
  "first_observed_at_snapshot" TIMESTAMP(3) NOT NULL,
  "last_observed_at_snapshot" TIMESTAMP(3) NOT NULL,
  "full_difference_signature_snapshot" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publisher_parity_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_parity_decision_key" UNIQUE ("decision_key"),
  CONSTRAINT "ozon_publisher_parity_decision_transition_key" UNIQUE ("subject_key", "transition_version"),
  CONSTRAINT "ozon_publisher_parity_decision_operation_key" UNIQUE ("subject_key", "operation_key"),
  CONSTRAINT "ozon_parity_decision_identity_check" CHECK (
    length(btrim("id")) BETWEEN 1 AND 100
    AND "transition_version" > 0
    AND "decision_key" ~ '^[0-9a-f]{64}$'
    AND "operation_key" ~ '^[0-9a-f]{64}$'
    AND "request_hash" ~ '^[0-9a-f]{64}$'
    AND "full_difference_signature_snapshot" ~ '^[0-9a-f]{64}$'
    AND length(btrim("review_note")) BETWEEN 3 AND 1000
    AND "observation_count_snapshot" > 0
    AND "first_observed_at_snapshot" <= "last_observed_at_snapshot"
  ),
  CONSTRAINT "ozon_parity_decision_action_check" CHECK (
    ("action" = 'APPROVE' AND "result_state" = 'APPROVED')
    OR ("action" = 'REJECT' AND "result_state" = 'REJECTED')
    OR ("action" = 'REVOKE' AND "result_state" = 'REVOKED')
  )
);

CREATE INDEX "ozon_publisher_parity_observation_expiry_idx"
  ON "ozon_publisher_parity_observations"("expires_at");
CREATE INDEX "ozon_publisher_parity_observation_report_hash_idx"
  ON "ozon_publisher_parity_observations"("report_hash");
CREATE INDEX "ozon_publisher_parity_observation_entrypoint_idx"
  ON "ozon_publisher_parity_observations"("entrypoint", "observed_at");
CREATE INDEX "ozon_publisher_parity_observation_subject_idx"
  ON "ozon_publisher_parity_observations"("difference_subject_key", "observed_at");
CREATE INDEX "ozon_publisher_parity_subject_state_idx"
  ON "ozon_publisher_parity_difference_subjects"("entrypoint", "approval_state", "last_observed_at");
CREATE INDEX "ozon_publisher_parity_subject_reviewer_idx"
  ON "ozon_publisher_parity_difference_subjects"("reviewed_by_user_id", "reviewed_at");
CREATE INDEX "ozon_publisher_parity_decision_subject_idx"
  ON "ozon_publisher_parity_decisions"("subject_key", "created_at");
CREATE INDEX "ozon_publisher_parity_decision_actor_idx"
  ON "ozon_publisher_parity_decisions"("actor_user_id", "created_at");

ALTER TABLE "ozon_publisher_parity_observations"
  ADD CONSTRAINT "ozon_publisher_parity_observation_subject_fkey"
  FOREIGN KEY ("difference_subject_key") REFERENCES "ozon_publisher_parity_difference_subjects"("subject_key")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publisher_parity_difference_subjects"
  ADD CONSTRAINT "ozon_publisher_parity_subject_reviewer_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publisher_parity_decisions"
  ADD CONSTRAINT "ozon_publisher_parity_decision_subject_fkey"
  FOREIGN KEY ("subject_key") REFERENCES "ozon_publisher_parity_difference_subjects"("subject_key")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publisher_parity_decisions"
  ADD CONSTRAINT "ozon_publisher_parity_decision_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_ozon_publisher_parity_observation_subject"() RETURNS trigger AS $$
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
    OR NEW."contract_version" IS DISTINCT FROM aggregate."contract_version"
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
    OR NEW."difference_rows_json" IS DISTINCT FROM aggregate."difference_rows_json"
    OR NEW."observed_at" < aggregate."first_observed_at"
    OR NEW."observed_at" > aggregate."last_observed_at" THEN
    RAISE EXCEPTION 'Ozon publisher parity observation does not match its difference subject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_ozon_publisher_parity_subject"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."approval_state" <> 'PENDING' OR NEW."state_version" <> 0 THEN
      RAISE EXCEPTION 'Ozon publisher parity subject must start pending' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."subject_key" IS DISTINCT FROM OLD."subject_key"
    OR NEW."entrypoint" IS DISTINCT FROM OLD."entrypoint"
    OR NEW."rollout_revision" IS DISTINCT FROM OLD."rollout_revision"
    OR NEW."contract_version" IS DISTINCT FROM OLD."contract_version"
    OR NEW."legacy_endpoint" IS DISTINCT FROM OLD."legacy_endpoint"
    OR NEW."v2_kind" IS DISTINCT FROM OLD."v2_kind"
    OR NEW."v2_endpoint" IS DISTINCT FROM OLD."v2_endpoint"
    OR NEW."publisher_contract_version" IS DISTINCT FROM OLD."publisher_contract_version"
    OR NEW."payload_compiler_version" IS DISTINCT FROM OLD."payload_compiler_version"
    OR NEW."classification" IS DISTINCT FROM OLD."classification"
    OR NEW."full_difference_signature" IS DISTINCT FROM OLD."full_difference_signature"
    OR NEW."difference_total" IS DISTINCT FROM OLD."difference_total"
    OR NEW."difference_rows_json" IS DISTINCT FROM OLD."difference_rows_json"
    OR NEW."first_observed_at" > OLD."first_observed_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."observation_count" < OLD."observation_count"
    OR (NEW."observation_count" = OLD."observation_count" AND NEW."last_observed_at" IS DISTINCT FROM OLD."last_observed_at")
    OR NEW."last_observed_at" < OLD."last_observed_at" THEN
    RAISE EXCEPTION 'Ozon publisher parity subject identity and observation window cannot regress'
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
      RAISE EXCEPTION 'Ozon publisher parity review fields require a state transition' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."state_version" <> OLD."state_version" + 1
      OR NOT (
        (OLD."approval_state" = 'PENDING' AND NEW."approval_state" IN ('APPROVED', 'REJECTED'))
        OR (OLD."approval_state" = 'APPROVED' AND NEW."approval_state" = 'REVOKED')
      )
      OR (NEW."approval_state" = 'APPROVED'
        AND NEW."classification" NOT IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM')) THEN
      RAISE EXCEPTION 'Illegal Ozon publisher parity approval transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_ozon_publisher_parity_decision"() RETURNS trigger AS $$
DECLARE
  aggregate "ozon_publisher_parity_difference_subjects"%ROWTYPE;
BEGIN
  SELECT subject.* INTO aggregate
    FROM "ozon_publisher_parity_difference_subjects" subject
   WHERE subject."subject_key" = NEW."subject_key"
   FOR KEY SHARE;
  IF NOT FOUND
    OR NEW."transition_version" IS DISTINCT FROM aggregate."state_version"
    OR NEW."result_state" IS DISTINCT FROM aggregate."approval_state"
    OR NEW."actor_user_id" IS DISTINCT FROM aggregate."reviewed_by_user_id"
    OR NEW."review_note" IS DISTINCT FROM aggregate."review_note"
    OR NEW."observation_count_snapshot" IS DISTINCT FROM aggregate."observation_count"
    OR NEW."first_observed_at_snapshot" IS DISTINCT FROM aggregate."first_observed_at"
    OR NEW."last_observed_at_snapshot" IS DISTINCT FROM aggregate."last_observed_at"
    OR NEW."full_difference_signature_snapshot" IS DISTINCT FROM aggregate."full_difference_signature" THEN
    RAISE EXCEPTION 'Ozon publisher parity decision does not match its difference subject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "require_ozon_publisher_parity_decision"() RETURNS trigger AS $$
BEGIN
  IF NEW."approval_state" <> 'PENDING' AND NOT EXISTS (
    SELECT 1 FROM "ozon_publisher_parity_decisions" decision
     WHERE decision."subject_key" = NEW."subject_key"
       AND decision."transition_version" = NEW."state_version"
       AND decision."result_state" = NEW."approval_state"
  ) THEN
    RAISE EXCEPTION 'Ozon publisher parity approval transition requires a decision event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "prevent_ozon_publisher_parity_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ozon publisher parity history is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publisher_parity_observation_provenance"
  BEFORE INSERT OR UPDATE ON "ozon_publisher_parity_observations"
  FOR EACH ROW EXECUTE FUNCTION "validate_ozon_publisher_parity_observation_subject"();
CREATE TRIGGER "ozon_publisher_parity_subject_validate"
  BEFORE INSERT OR UPDATE ON "ozon_publisher_parity_difference_subjects"
  FOR EACH ROW EXECUTE FUNCTION "validate_ozon_publisher_parity_subject"();
CREATE TRIGGER "ozon_publisher_parity_subject_no_delete"
  BEFORE DELETE ON "ozon_publisher_parity_difference_subjects"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ozon_publisher_parity_history_mutation"();
CREATE TRIGGER "ozon_publisher_parity_decision_validate"
  BEFORE INSERT ON "ozon_publisher_parity_decisions"
  FOR EACH ROW EXECUTE FUNCTION "validate_ozon_publisher_parity_decision"();
CREATE TRIGGER "ozon_publisher_parity_decision_immutable"
  BEFORE UPDATE OR DELETE ON "ozon_publisher_parity_decisions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_ozon_publisher_parity_history_mutation"();
CREATE CONSTRAINT TRIGGER "ozon_publisher_parity_decision_required"
  AFTER UPDATE ON "ozon_publisher_parity_difference_subjects"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_ozon_publisher_parity_decision"();

COMMIT;
