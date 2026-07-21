-- Required by rolling history recovery so unresolved Provider tasks remain
-- visible after the recent-workflow window expires.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_image_job_workflow_provider_reconciliation"
  ON "ai_image_jobs" ("workflow_id", "provider_reconciliation_status");
