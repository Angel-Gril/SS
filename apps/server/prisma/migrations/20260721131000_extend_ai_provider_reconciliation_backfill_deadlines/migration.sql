BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Deployment backfills can be larger than one worker interval can safely
-- drain. Extend them through the same revision fence as runtime transitions
-- and append one immutable event for every changed row.
WITH extended AS (
  UPDATE "ai_image_jobs"
  SET
    "provider_reconciliation_deadline_at" = CURRENT_TIMESTAMP + INTERVAL '24 hours',
    "provider_reconciliation_revision" = "provider_reconciliation_revision" + 1
  WHERE "provider_reconciliation_status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
    AND "provider_reconciliation_deadline_at" < CURRENT_TIMESTAMP + INTERVAL '24 hours'
  RETURNING
    "id",
    "owner_user_id",
    "actor_user_id",
    "workflow_id",
    "provider_reconciliation_revision",
    "provider_reconciliation_status",
    "provider_reconciliation_deadline_at"
), event_rows AS (
  SELECT
    extended.*,
    jsonb_build_object(
      'schema', 'ai-provider-reconciliation-event/v1',
      'source', 'MIGRATION_DEADLINE_EXTENSION',
      'status', extended."provider_reconciliation_status"::text,
      'deadlineAt', extended."provider_reconciliation_deadline_at"
    ) AS "payload"
  FROM extended
)
INSERT INTO "ai_provider_reconciliation_events" (
  "id",
  "owner_user_id",
  "actor_user_id",
  "job_id",
  "workflow_id",
  "reconciliation_revision",
  "event_key",
  "event_type",
  "payload",
  "payload_hash",
  "created_at"
)
SELECT
  'provider-reconciliation-deadline-' || md5(
    event_rows."id" || ':' || event_rows."provider_reconciliation_revision"::text
  ),
  event_rows."owner_user_id",
  event_rows."actor_user_id",
  event_rows."id",
  event_rows."workflow_id",
  event_rows."provider_reconciliation_revision",
  'provider-reconciliation-deadline:' || md5(
    event_rows."id" || ':' || event_rows."provider_reconciliation_revision"::text
  ),
  'PROVIDER_RECONCILIATION_DEADLINE_EXTENDED',
  event_rows."payload",
  encode(sha256(convert_to(event_rows."payload"::text, 'UTF8')), 'hex'),
  CURRENT_TIMESTAMP
FROM event_rows;

COMMIT;
