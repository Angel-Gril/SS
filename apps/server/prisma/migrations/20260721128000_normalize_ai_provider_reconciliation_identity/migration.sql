BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Historical rows could contain whitespace-only task IDs. They carry no
-- lookup authority, but the pre-H4 identity trigger correctly treats every
-- non-NULL value as immutable. Normalize this one legacy shape while workers
-- are quiesced, then prevent it from recurring.
ALTER TABLE "ai_image_jobs"
  DISABLE TRIGGER "ai_image_jobs_workflow_request_immutable";

UPDATE "ai_image_jobs"
SET "provider_job_id" = NULL
WHERE "provider_job_id" IS NOT NULL
  AND NULLIF(BTRIM("provider_job_id"), '') IS NULL;

ALTER TABLE "ai_image_jobs"
  ENABLE TRIGGER "ai_image_jobs_workflow_request_immutable";

ALTER TABLE "ai_image_jobs"
  ADD CONSTRAINT "ai_image_job_provider_job_id_nonblank_check" CHECK (
    "provider_job_id" IS NULL OR BTRIM("provider_job_id") <> ''
  ) NOT VALID;

ALTER TABLE "ai_image_jobs"
  VALIDATE CONSTRAINT "ai_image_job_provider_job_id_nonblank_check";

COMMIT;
