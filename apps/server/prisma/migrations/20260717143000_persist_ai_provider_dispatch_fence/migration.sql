BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_image_jobs"
  ADD COLUMN "provider_dispatched_at" TIMESTAMP(3);

-- Old workers did not persist a dispatch fence. Quarantine active paid jobs
-- conservatively during the deploy handoff so they cannot be resubmitted.
UPDATE "ai_image_jobs"
SET "provider_dispatched_at" = COALESCE("started_at", "updated_at", "created_at", CURRENT_TIMESTAMP)
WHERE "provider_dispatched_at" IS NULL
  AND "provider_job_id" IS NULL
  AND LOWER("provider") <> 'fake'
  AND "status" IN ('RUNNING', 'RETRYING', 'CANCEL_REQUESTED');

CREATE OR REPLACE FUNCTION protect_ai_image_provider_dispatch() RETURNS trigger AS $$
BEGIN
  IF OLD."provider_dispatched_at" IS NOT NULL
    AND NEW."provider_dispatched_at" IS DISTINCT FROM OLD."provider_dispatched_at" THEN
    RAISE EXCEPTION 'AI image provider dispatch time is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."provider_dispatched_at" IS NULL
    AND NEW."provider_dispatched_at" IS NOT NULL
    AND (OLD."status" <> 'RUNNING' OR OLD."provider_job_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'AI image provider dispatch may only start for an unbound running job' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_protect_provider_dispatch"
BEFORE UPDATE OF "provider_dispatched_at" ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_ai_image_provider_dispatch();

COMMIT;
