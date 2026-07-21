BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A state revision has one transition, but it can receive multiple immutable
-- observations after becoming terminal. Keep event keys unique for replay
-- safety while allowing those anomaly records to share the frozen revision.
ALTER TABLE "ai_provider_reconciliation_events"
  DROP CONSTRAINT "ai_provider_reconciliation_event_job_revision";

CREATE INDEX "ai_provider_reconciliation_event_job_revision"
  ON "ai_provider_reconciliation_events" (
    "job_id",
    "reconciliation_revision",
    "created_at"
  );

COMMIT;
