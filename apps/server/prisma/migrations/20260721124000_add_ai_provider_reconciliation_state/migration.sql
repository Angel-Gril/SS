BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TYPE "AiProviderReconciliationStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'RUNNING',
  'RETRY_WAIT',
  'MANUAL_REVIEW',
  'RECOVERED',
  'NO_OUTPUT',
  'NOT_SUBMITTED',
  'CANCELLED_OUTPUT_RETAINED'
);

ALTER TABLE "ai_image_jobs"
  ADD COLUMN "provider_reconciliation_status" "AiProviderReconciliationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "provider_reconciliation_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider_reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider_reconciliation_next_at" TIMESTAMP(3),
  ADD COLUMN "provider_reconciliation_deadline_at" TIMESTAMP(3),
  ADD COLUMN "provider_reconciliation_lease_owner" VARCHAR(100),
  ADD COLUMN "provider_reconciliation_lease_token_hash" CHAR(64),
  ADD COLUMN "provider_reconciliation_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "provider_reconciliation_last_provider_status" VARCHAR(100),
  ADD COLUMN "provider_reconciliation_last_error_code" VARCHAR(100),
  ADD COLUMN "provider_reconciliation_last_error_message" VARCHAR(500),
  ADD COLUMN "provider_reconciled_at" TIMESTAMP(3);

-- Only terminal jobs with unresolved provider evidence enter the new state
-- machine. Active jobs remain owned by their existing operation workers.
UPDATE "ai_image_jobs"
SET
  "provider_reconciliation_status" = 'MANUAL_REVIEW',
  "provider_reconciliation_revision" = 1,
  "provider_reconciliation_last_error_code" = LEFT(NULLIF(BTRIM("error_code"), ''), 100),
  "provider_reconciliation_last_error_message" = LEFT(
    NULLIF(BTRIM(regexp_replace("error_message", '\s+', ' ', 'g')), ''),
    500
  )
WHERE "status" IN ('FAILED', 'CANCELLED')
  AND "provider_reconciliation_status" = 'NOT_REQUIRED'
  AND (
    ("provider_job_id" IS NULL AND "error_code" = 'PROVIDER_SUBMISSION_UNCERTAIN')
    OR ("provider_job_id" IS NOT NULL AND NULLIF(BTRIM("provider_job_id"), '') IS NULL)
    OR (
      NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL
      AND "operation" <> 'IMAGE_TRANSLATE'
    )
    OR (
      NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL
      AND "operation" = 'IMAGE_TRANSLATE'
      AND "error_code" IN (
        'PROVIDER_JOB_ID_INVALID',
        'PROVIDER_JOB_ID_MISMATCH',
        'PROVIDER_JOB_ID_PERSISTENCE_CONFLICT',
        'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
        'PROVIDER_ACCEPTANCE_EVIDENCE_MISSING',
        'PROVIDER_TASK_NOT_FOUND',
        'INVALID_PROVIDER_RESULT'
      )
    )
  );

UPDATE "ai_image_jobs"
SET
  "provider_reconciliation_status" = 'NO_OUTPUT',
  "provider_reconciliation_revision" = 1,
  "provider_reconciliation_last_provider_status" = 'FAILED',
  "provider_reconciliation_last_error_code" = LEFT(NULLIF(BTRIM("error_code"), ''), 100),
  "provider_reconciliation_last_error_message" = LEFT(
    NULLIF(BTRIM(regexp_replace("error_message", '\s+', ' ', 'g')), ''),
    500
  ),
  "provider_reconciled_at" = COALESCE("completed_at", "updated_at", CURRENT_TIMESTAMP)
WHERE "status" IN ('FAILED', 'CANCELLED')
  AND "provider_reconciliation_status" = 'NOT_REQUIRED'
  AND "operation" = 'IMAGE_TRANSLATE'
  AND NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL
  AND "error_code" = 'PROVIDER_TASK_FAILED';

UPDATE "ai_image_jobs"
SET
  "provider_reconciliation_status" = 'PENDING',
  "provider_reconciliation_revision" = 1,
  "provider_reconciliation_next_at" = CURRENT_TIMESTAMP,
  -- Give historical accepted tasks one bounded post-deploy lookup window.
  "provider_reconciliation_deadline_at" = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
  "provider_reconciliation_last_error_code" = LEFT(NULLIF(BTRIM("error_code"), ''), 100),
  "provider_reconciliation_last_error_message" = LEFT(
    NULLIF(BTRIM(regexp_replace("error_message", '\s+', ' ', 'g')), ''),
    500
  )
WHERE "status" IN ('FAILED', 'CANCELLED')
  AND "provider_reconciliation_status" = 'NOT_REQUIRED'
  AND "operation" = 'IMAGE_TRANSLATE'
  AND NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL;

CREATE INDEX "ai_image_job_provider_reconciliation_due"
  ON "ai_image_jobs" (
    "provider_reconciliation_status",
    "provider_reconciliation_next_at",
    "id"
  );

COMMIT;
