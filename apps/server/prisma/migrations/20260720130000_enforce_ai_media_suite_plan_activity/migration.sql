BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A plan may retain historical suites, but only one version may own the
-- materialized or executing frontier at a time.
CREATE UNIQUE INDEX "ai_media_suite_plan_active_key"
  ON "ai_media_suites" ("plan_id")
  WHERE (
    "status" IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED')
    OR ("status" = 'PLANNED' AND "revision" >= 4)
  );

COMMIT;
