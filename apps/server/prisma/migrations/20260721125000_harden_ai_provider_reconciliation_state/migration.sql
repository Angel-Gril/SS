BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_image_jobs"
  ADD CONSTRAINT "ai_image_job_provider_reconciliation_state_check" CHECK (
    "provider_reconciliation_revision" >= 0
    AND "provider_reconciliation_attempt_count" >= 0
    AND (
      "provider_reconciliation_last_provider_status" IS NULL
      OR BTRIM("provider_reconciliation_last_provider_status") <> ''
    )
    AND (
      "provider_reconciliation_last_error_code" IS NULL
      OR BTRIM("provider_reconciliation_last_error_code") <> ''
    )
    AND (
      "provider_reconciliation_last_error_message" IS NULL
      OR BTRIM("provider_reconciliation_last_error_message") <> ''
    )
    AND (
      (
        "provider_reconciliation_status" = 'RUNNING'
        AND "provider_reconciliation_lease_owner" IS NOT NULL
        AND BTRIM("provider_reconciliation_lease_owner") <> ''
        AND "provider_reconciliation_lease_token_hash" IS NOT NULL
        AND "provider_reconciliation_lease_token_hash" ~ '^[0-9a-f]{64}$'
        AND "provider_reconciliation_lease_expires_at" IS NOT NULL
      )
      OR (
        "provider_reconciliation_status" <> 'RUNNING'
        AND "provider_reconciliation_lease_owner" IS NULL
        AND "provider_reconciliation_lease_token_hash" IS NULL
        AND "provider_reconciliation_lease_expires_at" IS NULL
      )
    )
    AND (
      (
        "provider_reconciliation_status" IN ('PENDING', 'RETRY_WAIT')
        AND "provider_reconciliation_next_at" IS NOT NULL
      )
      OR (
        "provider_reconciliation_status" NOT IN ('PENDING', 'RETRY_WAIT')
        AND "provider_reconciliation_next_at" IS NULL
      )
    )
    AND (
      "provider_reconciliation_status" NOT IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
      OR (
        NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL
        AND "provider_reconciliation_deadline_at" IS NOT NULL
      )
    )
    AND (
      "provider_reconciliation_status" <> 'RUNNING'
      OR "provider_reconciliation_attempt_count" >= 1
    )
    AND (
      "provider_reconciliation_status" NOT IN ('RECOVERED', 'NO_OUTPUT', 'CANCELLED_OUTPUT_RETAINED')
      OR NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL
    )
    AND (
      "provider_reconciliation_status" <> 'NOT_SUBMITTED'
      OR "provider_job_id" IS NULL
    )
    AND (
      (
        "provider_reconciliation_status" IN ('RECOVERED', 'NO_OUTPUT', 'NOT_SUBMITTED', 'CANCELLED_OUTPUT_RETAINED')
        AND "provider_reconciled_at" IS NOT NULL
      )
      OR (
        "provider_reconciliation_status" NOT IN ('RECOVERED', 'NO_OUTPUT', 'NOT_SUBMITTED', 'CANCELLED_OUTPUT_RETAINED')
        AND "provider_reconciled_at" IS NULL
      )
    )
  ) NOT VALID;

ALTER TABLE "ai_image_jobs"
  VALIDATE CONSTRAINT "ai_image_job_provider_reconciliation_state_check";

CREATE OR REPLACE FUNCTION validate_ai_provider_reconciliation_transition() RETURNS trigger AS $$
DECLARE
  reconciliation_changed BOOLEAN;
  old_terminal BOOLEAN;
BEGIN
  reconciliation_changed := ROW(
    NEW."provider_reconciliation_status",
    NEW."provider_reconciliation_attempt_count",
    NEW."provider_reconciliation_next_at",
    NEW."provider_reconciliation_deadline_at",
    NEW."provider_reconciliation_lease_owner",
    NEW."provider_reconciliation_lease_token_hash",
    NEW."provider_reconciliation_lease_expires_at",
    NEW."provider_reconciliation_last_provider_status",
    NEW."provider_reconciliation_last_error_code",
    NEW."provider_reconciliation_last_error_message",
    NEW."provider_reconciled_at"
  ) IS DISTINCT FROM ROW(
    OLD."provider_reconciliation_status",
    OLD."provider_reconciliation_attempt_count",
    OLD."provider_reconciliation_next_at",
    OLD."provider_reconciliation_deadline_at",
    OLD."provider_reconciliation_lease_owner",
    OLD."provider_reconciliation_lease_token_hash",
    OLD."provider_reconciliation_lease_expires_at",
    OLD."provider_reconciliation_last_provider_status",
    OLD."provider_reconciliation_last_error_code",
    OLD."provider_reconciliation_last_error_message",
    OLD."provider_reconciled_at"
  );

  old_terminal := OLD."provider_reconciliation_status" IN (
    'RECOVERED',
    'NO_OUTPUT',
    'NOT_SUBMITTED',
    'CANCELLED_OUTPUT_RETAINED'
  );

  IF old_terminal AND reconciliation_changed THEN
    RAISE EXCEPTION 'terminal AI provider reconciliation is immutable' USING ERRCODE = '55000';
  END IF;

  IF reconciliation_changed THEN
    IF NEW."provider_reconciliation_revision" IS DISTINCT FROM OLD."provider_reconciliation_revision" + 1 THEN
      RAISE EXCEPTION 'AI provider reconciliation revision must advance exactly once' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."provider_reconciliation_revision" IS DISTINCT FROM OLD."provider_reconciliation_revision" THEN
    RAISE EXCEPTION 'AI provider reconciliation revision cannot advance without a state change' USING ERRCODE = '23514';
  END IF;

  IF NEW."provider_reconciliation_status" IS DISTINCT FROM OLD."provider_reconciliation_status"
    AND NOT (
      (
        OLD."provider_reconciliation_status" = 'NOT_REQUIRED'
        AND NEW."provider_reconciliation_status" IN ('PENDING', 'MANUAL_REVIEW', 'NO_OUTPUT')
      )
      OR (
        OLD."provider_reconciliation_status" = 'PENDING'
        AND NEW."provider_reconciliation_status" IN (
          'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW',
          'RECOVERED', 'NO_OUTPUT', 'CANCELLED_OUTPUT_RETAINED'
        )
      )
      OR (
        OLD."provider_reconciliation_status" = 'RUNNING'
        AND NEW."provider_reconciliation_status" IN (
          'PENDING', 'RETRY_WAIT', 'MANUAL_REVIEW',
          'RECOVERED', 'NO_OUTPUT', 'CANCELLED_OUTPUT_RETAINED'
        )
      )
      OR (
        OLD."provider_reconciliation_status" = 'RETRY_WAIT'
        AND NEW."provider_reconciliation_status" IN (
          'PENDING', 'RUNNING', 'MANUAL_REVIEW',
          'RECOVERED', 'NO_OUTPUT', 'CANCELLED_OUTPUT_RETAINED'
        )
      )
      OR (
        OLD."provider_reconciliation_status" = 'MANUAL_REVIEW'
        AND NEW."provider_reconciliation_status" IN ('PENDING', 'NO_OUTPUT', 'NOT_SUBMITTED')
      )
    )
  THEN
    RAISE EXCEPTION 'invalid AI provider reconciliation transition' USING ERRCODE = '23514';
  END IF;

  IF NEW."provider_reconciliation_attempt_count" < OLD."provider_reconciliation_attempt_count"
    OR NEW."provider_reconciliation_attempt_count" > OLD."provider_reconciliation_attempt_count" + 1
  THEN
    RAISE EXCEPTION 'AI provider reconciliation attempt count is not monotonic' USING ERRCODE = '23514';
  END IF;

  IF NEW."provider_reconciliation_status" = 'RUNNING'
    AND OLD."provider_reconciliation_status" <> 'RUNNING'
    AND NEW."provider_reconciliation_attempt_count" IS DISTINCT FROM OLD."provider_reconciliation_attempt_count" + 1
  THEN
    RAISE EXCEPTION 'claiming AI provider reconciliation must advance the attempt count' USING ERRCODE = '23514';
  END IF;

  IF NEW."provider_reconciliation_attempt_count" IS DISTINCT FROM OLD."provider_reconciliation_attempt_count"
    AND (
      NEW."provider_reconciliation_status" <> 'RUNNING'
      OR NEW."provider_reconciliation_lease_token_hash" IS NOT DISTINCT FROM OLD."provider_reconciliation_lease_token_hash"
    )
  THEN
    RAISE EXCEPTION 'AI provider reconciliation attempts advance only with a new running lease' USING ERRCODE = '23514';
  END IF;

  IF OLD."provider_reconciliation_status" = 'RUNNING'
    AND NEW."provider_reconciliation_status" = 'RUNNING'
    AND NEW."provider_reconciliation_lease_token_hash" IS DISTINCT FROM OLD."provider_reconciliation_lease_token_hash"
    AND NEW."provider_reconciliation_attempt_count" IS DISTINCT FROM OLD."provider_reconciliation_attempt_count" + 1
  THEN
    RAISE EXCEPTION 'reclaiming AI provider reconciliation must advance the attempt count' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_provider_reconciliation_transition"
BEFORE UPDATE OF
  "provider_reconciliation_status",
  "provider_reconciliation_revision",
  "provider_reconciliation_attempt_count",
  "provider_reconciliation_next_at",
  "provider_reconciliation_deadline_at",
  "provider_reconciliation_lease_owner",
  "provider_reconciliation_lease_token_hash",
  "provider_reconciliation_lease_expires_at",
  "provider_reconciliation_last_provider_status",
  "provider_reconciliation_last_error_code",
  "provider_reconciliation_last_error_message",
  "provider_reconciled_at"
ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION validate_ai_provider_reconciliation_transition();

COMMIT;
