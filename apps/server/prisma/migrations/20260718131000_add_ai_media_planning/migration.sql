BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TYPE "AiMediaPlanningMode" AS ENUM ('RULE_BASED', 'MODEL_ASSISTED');
CREATE TYPE "AiMediaPlanningRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "ai_media_plans" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "source_subject_id" TEXT NOT NULL,
  "context_type" VARCHAR(50) NOT NULL,
  "context_id" VARCHAR(200) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "latest_version" INTEGER NOT NULL DEFAULT 0,
  "current_version_id" TEXT,
  "approved_version_id" TEXT,
  "review_status" "AiMediaReviewStatus" NOT NULL DEFAULT 'NOT_READY',
  "stale_at" TIMESTAMP(3),
  "stale_against_fingerprint" CHAR(64),
  "stale_reasons_json" JSONB,
  "reviewed_by_user_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_media_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_plan_state_check" CHECK (
    "revision" >= 1
    AND "latest_version" >= 0
    AND (
      ("current_version_id" IS NULL AND "latest_version" = 0 AND "review_status" = 'NOT_READY')
      OR
      ("current_version_id" IS NOT NULL AND "latest_version" >= 1 AND "review_status" <> 'NOT_READY')
    )
    AND (
      "review_status" <> 'APPROVED'
      OR ("approved_version_id" IS NOT NULL AND "approved_version_id" = "current_version_id")
    )
    AND (
      ("stale_at" IS NULL AND "stale_against_fingerprint" IS NULL AND "stale_reasons_json" IS NULL)
      OR
      ("stale_at" IS NOT NULL AND "stale_against_fingerprint" IS NOT NULL AND "stale_reasons_json" IS NOT NULL)
    )
    AND (
      ("review_status" IN ('APPROVED', 'REJECTED')
        AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
      OR
      ("review_status" NOT IN ('APPROVED', 'REJECTED')
        AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL)
    )
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND ("stale_against_fingerprint" IS NULL OR "stale_against_fingerprint" ~ '^[0-9a-f]{64}$')
  )
);

CREATE UNIQUE INDEX "ai_media_plan_id_owner_key"
  ON "ai_media_plans"("id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_plan_identity_key"
  ON "ai_media_plans"("id", "owner_user_id", "source_subject_id");
CREATE UNIQUE INDEX "ai_media_plan_owner_idempotency_key"
  ON "ai_media_plans"("owner_user_id", "idempotency_key");
CREATE INDEX "ai_media_plan_owner_review_idx"
  ON "ai_media_plans"("owner_user_id", "review_status", "updated_at");
CREATE INDEX "ai_media_plan_subject_updated_idx"
  ON "ai_media_plans"("source_subject_id", "updated_at");
CREATE INDEX "ai_media_plan_context_updated_idx"
  ON "ai_media_plans"("context_type", "context_id", "updated_at");

ALTER TABLE "ai_media_plans"
  ADD CONSTRAINT "ai_media_plan_owner_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_reviewer_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_subject_owner_fkey"
    FOREIGN KEY ("source_subject_id", "owner_user_id")
    REFERENCES "source_capture_subjects"("id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_media_planning_runs" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "source_subject_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "mode" "AiMediaPlanningMode" NOT NULL,
  "engine_version" VARCHAR(100) NOT NULL,
  "status" "AiMediaPlanningRunStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "source_capture_hash" CHAR(64) NOT NULL,
  "source_profile_hash" CHAR(64) NOT NULL,
  "input_fingerprint" CHAR(64) NOT NULL,
  "input_snapshot_json" JSONB NOT NULL,
  "input_hash" CHAR(64) NOT NULL,
  "input_bytes" INTEGER NOT NULL,
  "template_snapshot_json" JSONB,
  "template_set_hash" CHAR(64),
  "compiled_prompt_snapshot_json" JSONB,
  "compiled_prompt_hash" CHAR(64),
  "provider" VARCHAR(100),
  "model" VARCHAR(200),
  "provider_config_hash" CHAR(64),
  "model_response_json" JSONB,
  "model_response_hash" CHAR(64),
  "error_code" VARCHAR(100),
  "error_message" VARCHAR(2000),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_media_planning_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_planning_run_values_check" CHECK (
    "attempt" >= 1
    AND "revision" >= 1
    AND "input_bytes" > 0
    AND "input_bytes" <= 1048576
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "source_capture_hash" ~ '^[0-9a-f]{64}$'
    AND "source_profile_hash" ~ '^[0-9a-f]{64}$'
    AND "input_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "input_hash" ~ '^[0-9a-f]{64}$'
    AND (("template_snapshot_json" IS NULL) = ("template_set_hash" IS NULL))
    AND (("compiled_prompt_snapshot_json" IS NULL) = ("compiled_prompt_hash" IS NULL))
    AND (("provider" IS NULL AND "model" IS NULL AND "provider_config_hash" IS NULL)
      OR ("provider" IS NOT NULL AND "model" IS NOT NULL AND "provider_config_hash" IS NOT NULL))
    AND (("model_response_json" IS NULL) = ("model_response_hash" IS NULL))
    AND ("template_set_hash" IS NULL OR "template_set_hash" ~ '^[0-9a-f]{64}$')
    AND ("compiled_prompt_hash" IS NULL OR "compiled_prompt_hash" ~ '^[0-9a-f]{64}$')
    AND ("provider_config_hash" IS NULL OR "provider_config_hash" ~ '^[0-9a-f]{64}$')
    AND ("model_response_hash" IS NULL OR "model_response_hash" ~ '^[0-9a-f]{64}$')
    AND ("mode" <> 'RULE_BASED' OR (
      "template_snapshot_json" IS NULL
      AND "compiled_prompt_snapshot_json" IS NULL
      AND "provider" IS NULL
      AND "model_response_json" IS NULL
    ))
    AND (
      ("status" = 'QUEUED' AND "started_at" IS NULL AND "completed_at" IS NULL)
      OR ("status" = 'RUNNING' AND "started_at" IS NOT NULL AND "completed_at" IS NULL)
      OR ("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND "completed_at" IS NOT NULL)
    )
    AND ("status" <> 'FAILED' OR "error_code" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ai_media_planning_run_identity_key"
  ON "ai_media_planning_runs"("id", "plan_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_planning_run_attempt_key"
  ON "ai_media_planning_runs"("plan_id", "attempt");
CREATE UNIQUE INDEX "ai_media_planning_run_owner_idempotency_key"
  ON "ai_media_planning_runs"("owner_user_id", "idempotency_key");
CREATE INDEX "ai_media_planning_run_owner_status_idx"
  ON "ai_media_planning_runs"("owner_user_id", "status", "created_at");
CREATE INDEX "ai_media_planning_run_plan_created_idx"
  ON "ai_media_planning_runs"("plan_id", "created_at");
CREATE INDEX "ai_media_planning_run_snapshot_idx"
  ON "ai_media_planning_runs"("source_capture_snapshot_id", "created_at");

ALTER TABLE "ai_media_planning_runs"
  ADD CONSTRAINT "ai_media_planning_run_plan_fkey"
    FOREIGN KEY ("plan_id", "owner_user_id", "source_subject_id")
    REFERENCES "ai_media_plans"("id", "owner_user_id", "source_subject_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_planning_run_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_planning_run_snapshot_subject_fkey"
    FOREIGN KEY ("source_capture_snapshot_id", "source_subject_id")
    REFERENCES "source_capture_snapshots"("id", "subject_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_media_plan_versions" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "source_subject_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "planning_run_id" TEXT NOT NULL,
  "parent_version_id" TEXT,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "source_capture_hash" CHAR(64) NOT NULL,
  "source_profile_hash" CHAR(64) NOT NULL,
  "source_schema_version" VARCHAR(100) NOT NULL,
  "selected_sku_hash" CHAR(64) NOT NULL,
  "input_asset_set_hash" CHAR(64) NOT NULL,
  "input_fingerprint" CHAR(64) NOT NULL,
  "plan_schema_version" VARCHAR(50) NOT NULL,
  "planner_version" VARCHAR(100) NOT NULL,
  "mode" "AiMediaPlanningMode" NOT NULL,
  "fallback_reason" VARCHAR(100),
  "input_snapshot_json" JSONB NOT NULL,
  "input_hash" CHAR(64) NOT NULL,
  "curation_json" JSONB NOT NULL,
  "curation_hash" CHAR(64) NOT NULL,
  "vision_evidence_json" JSONB NOT NULL,
  "vision_evidence_hash" CHAR(64) NOT NULL,
  "plan_json" JSONB NOT NULL,
  "plan_hash" CHAR(64) NOT NULL,
  "plan_bytes" INTEGER NOT NULL,
  "provenance_json" JSONB NOT NULL,
  "provenance_hash" CHAR(64) NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_plan_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_plan_version_values_check" CHECK (
    "version" >= 1
    AND "plan_bytes" > 0
    AND "plan_bytes" <= 1048576
    AND "source_capture_hash" ~ '^[0-9a-f]{64}$'
    AND "source_profile_hash" ~ '^[0-9a-f]{64}$'
    AND "selected_sku_hash" ~ '^[0-9a-f]{64}$'
    AND "input_asset_set_hash" ~ '^[0-9a-f]{64}$'
    AND "input_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "input_hash" ~ '^[0-9a-f]{64}$'
    AND "curation_hash" ~ '^[0-9a-f]{64}$'
    AND "vision_evidence_hash" ~ '^[0-9a-f]{64}$'
    AND "plan_hash" ~ '^[0-9a-f]{64}$'
    AND "provenance_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "ai_media_plan_version_identity_key"
  ON "ai_media_plan_versions"("id", "plan_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_plan_version_run_key"
  ON "ai_media_plan_versions"("planning_run_id", "plan_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_plan_version_sequence_key"
  ON "ai_media_plan_versions"("plan_id", "version");
CREATE UNIQUE INDEX "ai_media_plan_version_content_key"
  ON "ai_media_plan_versions"("plan_id", "input_fingerprint", "plan_hash");
CREATE INDEX "ai_media_plan_version_owner_created_idx"
  ON "ai_media_plan_versions"("owner_user_id", "created_at");
CREATE INDEX "ai_media_plan_version_snapshot_idx"
  ON "ai_media_plan_versions"("source_capture_snapshot_id", "created_at");
CREATE INDEX "ai_media_plan_version_plan_created_idx"
  ON "ai_media_plan_versions"("plan_id", "created_at");

ALTER TABLE "ai_media_plan_versions"
  ADD CONSTRAINT "ai_media_plan_version_plan_fkey"
    FOREIGN KEY ("plan_id", "owner_user_id", "source_subject_id")
    REFERENCES "ai_media_plans"("id", "owner_user_id", "source_subject_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_version_run_fkey"
    FOREIGN KEY ("planning_run_id", "plan_id", "owner_user_id")
    REFERENCES "ai_media_planning_runs"("id", "plan_id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_version_parent_fkey"
    FOREIGN KEY ("parent_version_id", "plan_id", "owner_user_id")
    REFERENCES "ai_media_plan_versions"("id", "plan_id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ai_media_plan_version_snapshot_subject_fkey"
    FOREIGN KEY ("source_capture_snapshot_id", "source_subject_id")
    REFERENCES "source_capture_snapshots"("id", "subject_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_version_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_media_plans"
  ADD CONSTRAINT "ai_media_plan_current_version_fkey"
    FOREIGN KEY ("current_version_id", "id", "owner_user_id")
    REFERENCES "ai_media_plan_versions"("id", "plan_id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ai_media_plan_approved_version_fkey"
    FOREIGN KEY ("approved_version_id", "id", "owner_user_id")
    REFERENCES "ai_media_plan_versions"("id", "plan_id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "ai_media_plan_events" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "version_id" TEXT,
  "run_id" TEXT,
  "revision" INTEGER NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "event_key" VARCHAR(200) NOT NULL,
  "event_type" VARCHAR(50) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_plan_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_plan_event_values_check" CHECK (
    "revision" >= 1 AND "payload_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "ai_media_plan_event_key"
  ON "ai_media_plan_events"("event_key");
CREATE UNIQUE INDEX "ai_media_plan_event_revision_key"
  ON "ai_media_plan_events"("plan_id", "revision");
CREATE INDEX "ai_media_plan_event_plan_created_idx"
  ON "ai_media_plan_events"("plan_id", "created_at");
CREATE INDEX "ai_media_plan_event_owner_created_idx"
  ON "ai_media_plan_events"("owner_user_id", "created_at");
CREATE INDEX "ai_media_plan_event_version_created_idx"
  ON "ai_media_plan_events"("version_id", "created_at");

ALTER TABLE "ai_media_plan_events"
  ADD CONSTRAINT "ai_media_plan_event_plan_fkey"
    FOREIGN KEY ("plan_id", "owner_user_id")
    REFERENCES "ai_media_plans"("id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_event_version_fkey"
    FOREIGN KEY ("version_id", "plan_id", "owner_user_id")
    REFERENCES "ai_media_plan_versions"("id", "plan_id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_event_run_fkey"
    FOREIGN KEY ("run_id", "plan_id", "owner_user_id")
    REFERENCES "ai_media_planning_runs"("id", "plan_id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_plan_event_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_ai_media_plan_identity() RETURNS trigger AS $$
DECLARE
  bootstrap boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media plan cannot be deleted' USING ERRCODE = '23514';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    OR NEW."source_subject_id" IS DISTINCT FROM OLD."source_subject_id"
    OR NEW."context_type" IS DISTINCT FROM OLD."context_type"
    OR NEW."context_id" IS DISTINCT FROM OLD."context_id"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media plan identity is immutable' USING ERRCODE = '23514';
  END IF;

  bootstrap := OLD."current_version_id" IS NULL
    AND OLD."latest_version" = 0
    AND OLD."review_status" = 'NOT_READY'
    AND NEW."current_version_id" IS NOT NULL
    AND NEW."latest_version" = 1
    AND NEW."review_status" = 'PENDING';

  IF bootstrap THEN
    IF NEW."revision" IS DISTINCT FROM OLD."revision" THEN
      RAISE EXCEPTION 'AI media plan bootstrap revision is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'AI media plan revision must advance by one' USING ERRCODE = '23514';
  END IF;

  IF NEW."latest_version" < OLD."latest_version"
    OR NEW."latest_version" > OLD."latest_version" + 1
  THEN
    RAISE EXCEPTION 'AI media plan version sequence is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_plan_identity_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_plans"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_plan_identity();

CREATE OR REPLACE FUNCTION protect_ai_media_planning_run_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media planning run cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'terminal AI media planning run is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."plan_id" IS DISTINCT FROM OLD."plan_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."source_subject_id" IS DISTINCT FROM OLD."source_subject_id"
    OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM OLD."source_capture_snapshot_id"
    OR NEW."attempt" IS DISTINCT FROM OLD."attempt"
    OR NEW."mode" IS DISTINCT FROM OLD."mode"
    OR NEW."engine_version" IS DISTINCT FROM OLD."engine_version"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."source_capture_hash" IS DISTINCT FROM OLD."source_capture_hash"
    OR NEW."source_profile_hash" IS DISTINCT FROM OLD."source_profile_hash"
    OR NEW."input_fingerprint" IS DISTINCT FROM OLD."input_fingerprint"
    OR NEW."input_snapshot_json" IS DISTINCT FROM OLD."input_snapshot_json"
    OR NEW."input_hash" IS DISTINCT FROM OLD."input_hash"
    OR NEW."input_bytes" IS DISTINCT FROM OLD."input_bytes"
    OR NEW."template_snapshot_json" IS DISTINCT FROM OLD."template_snapshot_json"
    OR NEW."template_set_hash" IS DISTINCT FROM OLD."template_set_hash"
    OR NEW."compiled_prompt_snapshot_json" IS DISTINCT FROM OLD."compiled_prompt_snapshot_json"
    OR NEW."compiled_prompt_hash" IS DISTINCT FROM OLD."compiled_prompt_hash"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."model" IS DISTINCT FROM OLD."model"
    OR NEW."provider_config_hash" IS DISTINCT FROM OLD."provider_config_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media planning run identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'AI media planning run revision must advance by one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_planning_run_identity_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_planning_runs"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_planning_run_identity();

CREATE OR REPLACE FUNCTION validate_ai_media_plan_version_insert() RETURNS trigger AS $$
DECLARE
  stored_plan "ai_media_plans"%ROWTYPE;
  stored_run "ai_media_planning_runs"%ROWTYPE;
  stored_snapshot "source_capture_snapshots"%ROWTYPE;
BEGIN
  SELECT * INTO stored_plan FROM "ai_media_plans"
    WHERE "id" = NEW."plan_id" AND "owner_user_id" = NEW."owner_user_id" FOR UPDATE;
  SELECT * INTO stored_run FROM "ai_media_planning_runs"
    WHERE "id" = NEW."planning_run_id" AND "plan_id" = NEW."plan_id"
      AND "owner_user_id" = NEW."owner_user_id" FOR SHARE;
  SELECT * INTO stored_snapshot FROM "source_capture_snapshots"
    WHERE "id" = NEW."source_capture_snapshot_id"
      AND "subject_id" = NEW."source_subject_id" FOR SHARE;

  IF NEW."version" IS DISTINCT FROM stored_plan."latest_version" + 1
    OR (NEW."version" = 1 AND NEW."parent_version_id" IS NOT NULL)
    OR (NEW."version" > 1 AND NEW."parent_version_id" IS DISTINCT FROM stored_plan."current_version_id")
    OR stored_plan."source_subject_id" IS DISTINCT FROM NEW."source_subject_id"
    OR stored_run."status" IS DISTINCT FROM 'SUCCEEDED'
    OR stored_run."source_subject_id" IS DISTINCT FROM NEW."source_subject_id"
    OR stored_run."source_capture_snapshot_id" IS DISTINCT FROM NEW."source_capture_snapshot_id"
    OR stored_run."source_capture_hash" IS DISTINCT FROM NEW."source_capture_hash"
    OR stored_run."source_profile_hash" IS DISTINCT FROM NEW."source_profile_hash"
    OR stored_run."input_fingerprint" IS DISTINCT FROM NEW."input_fingerprint"
    OR stored_run."input_hash" IS DISTINCT FROM NEW."input_hash"
    OR stored_run."mode" IS DISTINCT FROM NEW."mode"
    OR stored_snapshot."capture_hash" IS DISTINCT FROM NEW."source_capture_hash"
    OR stored_snapshot."profile_hash" IS DISTINCT FROM NEW."source_profile_hash"
  THEN
    RAISE EXCEPTION 'AI media plan version provenance mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_plan_version_validate_insert"
BEFORE INSERT ON "ai_media_plan_versions"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_plan_version_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_plan_version_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media plan version is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_plan_version_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_plan_versions"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_plan_version_immutable();

CREATE OR REPLACE FUNCTION validate_ai_media_plan_event_insert() RETURNS trigger AS $$
DECLARE
  stored_plan "ai_media_plans"%ROWTYPE;
BEGIN
  SELECT * INTO stored_plan FROM "ai_media_plans"
    WHERE "id" = NEW."plan_id" AND "owner_user_id" = NEW."owner_user_id" FOR SHARE;
  IF stored_plan."revision" IS DISTINCT FROM NEW."revision" THEN
    RAISE EXCEPTION 'AI media plan event revision mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_plan_event_validate_insert"
BEFORE INSERT ON "ai_media_plan_events"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_plan_event_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_plan_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media plan event is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_plan_event_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_plan_events"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_plan_event_immutable();

CREATE OR REPLACE FUNCTION require_ai_media_plan_revision_event() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ai_media_plan_events"
    WHERE "plan_id" = NEW."id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "revision" = NEW."revision"
  ) THEN
    RAISE EXCEPTION 'AI media plan revision requires an audit event' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW."review_status" IS DISTINCT FROM OLD."review_status"
    AND NEW."review_status" IN ('APPROVED', 'REJECTED')
    AND NOT EXISTS (
      SELECT 1 FROM "ai_media_plan_events"
      WHERE "plan_id" = NEW."id"
        AND "owner_user_id" = NEW."owner_user_id"
        AND "revision" = NEW."revision"
        AND "version_id" = NEW."current_version_id"
        AND "actor_user_id" = NEW."reviewed_by_user_id"
        AND "event_type" = CASE NEW."review_status"
          WHEN 'APPROVED' THEN 'REVIEW_APPROVED'
          ELSE 'REVIEW_REJECTED'
        END
    )
  THEN
    RAISE EXCEPTION 'AI media plan review requires matching audit evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_plan_revision_requires_event"
AFTER INSERT OR UPDATE ON "ai_media_plans"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_plan_revision_event();

COMMIT;
