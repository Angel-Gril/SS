-- Ensure accepted translation tasks from the first Unit 9A slice have a
-- durable recovery deadline even when the worker crashed before the new
-- provider-dispatch timestamp write was introduced.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- The older dispatch-fence trigger intentionally rejects late timestamp
-- binding. Deployments quiesce workers around migrations, so suspend only
-- that user trigger for this one-time historical backfill and restore it
-- before committing.
ALTER TABLE "ai_image_jobs" DISABLE TRIGGER "ai_image_jobs_protect_provider_dispatch";

UPDATE "ai_image_jobs"
SET "provider_dispatched_at" = COALESCE("provider_dispatched_at", "updated_at", "created_at")
WHERE "operation" = 'IMAGE_TRANSLATE'
  AND "provider_job_id" IS NOT NULL
  AND "provider_dispatched_at" IS NULL;

ALTER TABLE "ai_image_jobs" ENABLE TRIGGER "ai_image_jobs_protect_provider_dispatch";

COMMIT;
