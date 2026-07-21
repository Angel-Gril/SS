-- Keep this migration to one statement: Prisma executes multi-statement
-- migrations transactionally, while PostgreSQL requires CONCURRENTLY outside
-- a transaction block.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_image_job_provider_reconciliation_lease_due"
  ON "ai_image_jobs" (
    "provider_reconciliation_status",
    "provider_reconciliation_lease_expires_at",
    "id"
  );
