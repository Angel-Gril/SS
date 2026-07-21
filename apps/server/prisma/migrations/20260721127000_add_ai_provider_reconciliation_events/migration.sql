BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE "ai_provider_reconciliation_events" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "job_id" TEXT NOT NULL,
  "workflow_id" TEXT,
  "reconciliation_revision" INTEGER NOT NULL,
  "event_key" VARCHAR(100) NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_provider_reconciliation_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_reconciliation_event_key" UNIQUE ("event_key"),
  CONSTRAINT "ai_provider_reconciliation_event_job_revision"
    UNIQUE ("job_id", "reconciliation_revision"),
  CONSTRAINT "ai_provider_reconciliation_event_shape_check" CHECK (
    "reconciliation_revision" >= 1
    AND BTRIM("event_key") <> ''
    AND BTRIM("event_type") <> ''
    AND "payload_hash" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("payload") = 'object'
  )
);

CREATE INDEX "ai_provider_reconciliation_event_owner_created"
  ON "ai_provider_reconciliation_events" ("owner_user_id", "created_at");

CREATE INDEX "ai_provider_reconciliation_event_workflow_created"
  ON "ai_provider_reconciliation_events" ("workflow_id", "created_at");

ALTER TABLE "ai_provider_reconciliation_events"
  ADD CONSTRAINT "ai_provider_reconciliation_event_job_owner_fkey"
  FOREIGN KEY ("job_id", "owner_user_id")
  REFERENCES "ai_image_jobs" ("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_provider_reconciliation_event_workflow_owner_fkey"
  FOREIGN KEY ("workflow_id", "owner_user_id")
  REFERENCES "ai_media_workflows" ("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_provider_reconciliation_event_actor_fkey"
  FOREIGN KEY ("actor_user_id")
  REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

WITH backfill AS (
  SELECT
    job."id" AS "job_id",
    job."owner_user_id",
    job."actor_user_id",
    job."workflow_id",
    job."provider_reconciliation_revision" AS "revision",
    COALESCE(job."updated_at", job."completed_at", job."created_at", CURRENT_TIMESTAMP) AS "created_at",
    jsonb_strip_nulls(jsonb_build_object(
      'schema', 'ai-provider-reconciliation-event/v1',
      'source', 'MIGRATION_BACKFILL',
      'status', job."provider_reconciliation_status"::text,
      'providerStatus', job."provider_reconciliation_last_provider_status",
      'errorCode', job."provider_reconciliation_last_error_code",
      'errorMessage', job."provider_reconciliation_last_error_message"
    )) AS "payload"
  FROM "ai_image_jobs" job
  WHERE job."provider_reconciliation_status" <> 'NOT_REQUIRED'
    AND job."provider_reconciliation_revision" >= 1
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
  'provider-reconciliation-backfill-' || md5(backfill."job_id" || ':' || backfill."revision"::text),
  backfill."owner_user_id",
  backfill."actor_user_id",
  backfill."job_id",
  backfill."workflow_id",
  backfill."revision",
  'provider-reconciliation-backfill:' || md5(backfill."job_id" || ':' || backfill."revision"::text),
  'PROVIDER_RECONCILIATION_MIGRATION_BACKFILL',
  backfill."payload",
  encode(sha256(convert_to(backfill."payload"::text, 'UTF8')), 'hex'),
  backfill."created_at"
FROM backfill;

CREATE OR REPLACE FUNCTION prevent_ai_provider_reconciliation_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI provider reconciliation events are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_reconciliation_events_immutable"
BEFORE UPDATE OR DELETE ON "ai_provider_reconciliation_events"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_provider_reconciliation_event_mutation();

COMMIT;
