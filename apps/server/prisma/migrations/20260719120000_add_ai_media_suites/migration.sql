BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TYPE "AiMediaSuiteStatus" AS ENUM (
  'PLANNED', 'QUEUED', 'RUNNING', 'PARTIAL_FAILURE',
  'SUCCEEDED', 'CANCEL_REQUESTED', 'CANCELLED'
);
CREATE TYPE "AiMediaSuiteSlotStatus" AS ENUM (
  'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED',
  'CANCEL_REQUESTED', 'CANCELLED'
);

CREATE TABLE "ai_media_suites" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "plan_version_id" TEXT NOT NULL,
  "source_subject_id" TEXT NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "source_capture_hash" CHAR(64) NOT NULL,
  "source_profile_hash" CHAR(64) NOT NULL,
  "source_schema_version" VARCHAR(100) NOT NULL,
  "context_type" VARCHAR(50) NOT NULL,
  "context_id" VARCHAR(200) NOT NULL,
  "status" "AiMediaSuiteStatus" NOT NULL DEFAULT 'PLANNED',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "preview_hash" CHAR(64) NOT NULL,
  "provider" VARCHAR(100) NOT NULL,
  "model" VARCHAR(200) NOT NULL,
  "provider_config_hash" CHAR(64) NOT NULL,
  "pricing_version" VARCHAR(100) NOT NULL,
  "item_count" INTEGER NOT NULL,
  "estimated_cost_cents" INTEGER NOT NULL,
  "maximum_cost_cents" INTEGER NOT NULL,
  "concurrency_limit" INTEGER NOT NULL,
  "cancel_requested_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_media_suites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_suite_values_check" CHECK (
    "revision" >= 1
    AND "item_count" BETWEEN 1 AND 500
    AND "estimated_cost_cents" >= 0
    AND "maximum_cost_cents" >= "estimated_cost_cents"
    AND "concurrency_limit" BETWEEN 1 AND 16
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "preview_hash" ~ '^[0-9a-f]{64}$'
    AND "provider_config_hash" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "ai_media_suite_id_owner_key" ON "ai_media_suites"("id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_suite_owner_idempotency_key" ON "ai_media_suites"("owner_user_id", "idempotency_key");
CREATE UNIQUE INDEX "ai_media_suite_plan_version_claim_key" ON "ai_media_suites"("plan_version_id");
CREATE INDEX "ai_media_suite_owner_status_idx" ON "ai_media_suites"("owner_user_id", "status", "updated_at");
CREATE INDEX "ai_media_suite_plan_created_idx" ON "ai_media_suites"("plan_id", "created_at");
ALTER TABLE "ai_media_suites"
  ADD CONSTRAINT "ai_media_suite_owner_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_plan_fkey" FOREIGN KEY ("plan_id", "owner_user_id", "source_subject_id") REFERENCES "ai_media_plans"("id", "owner_user_id", "source_subject_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_plan_version_fkey" FOREIGN KEY ("plan_version_id", "plan_id", "owner_user_id") REFERENCES "ai_media_plan_versions"("id", "plan_id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_subject_fkey" FOREIGN KEY ("source_subject_id", "owner_user_id") REFERENCES "source_capture_subjects"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_snapshot_fkey" FOREIGN KEY ("source_capture_snapshot_id", "source_subject_id") REFERENCES "source_capture_snapshots"("id", "subject_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_media_suite_slots" (
  "id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "slot_key" VARCHAR(1024) NOT NULL,
  "goal" VARCHAR(100) NOT NULL,
  "ownership_level" VARCHAR(30) NOT NULL,
  "ownership_key" VARCHAR(500) NOT NULL,
  "compatibility_group_key" VARCHAR(500),
  "slot_snapshot_json" JSONB NOT NULL,
  "slot_hash" CHAR(64) NOT NULL,
  "references_snapshot_json" JSONB NOT NULL,
  "references_hash" CHAR(64) NOT NULL,
  "diagnostics_json" JSONB NOT NULL,
  "status" "AiMediaSuiteSlotStatus" NOT NULL DEFAULT 'PLANNED',
  "child_workflow_id" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_cents" INTEGER NOT NULL,
  "maximum_cost_cents" INTEGER NOT NULL,
  "error_code" VARCHAR(100),
  "error_message" VARCHAR(2000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_media_suite_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_suite_slot_values_check" CHECK (
    "ordinal" >= 0
    AND char_length("slot_key") BETWEEN 1 AND 1024
    AND "ownership_level" IN ('sku', 'compatibility_group')
    AND "attempt" >= 0
    AND "estimated_cost_cents" >= 0
    AND "maximum_cost_cents" >= "estimated_cost_cents"
    AND "slot_hash" ~ '^[0-9a-f]{64}$'
    AND "references_hash" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "ai_media_suite_slot_ordinal_key" ON "ai_media_suite_slots"("suite_id", "ordinal");
CREATE UNIQUE INDEX "ai_media_suite_slot_key" ON "ai_media_suite_slots"("suite_id", "slot_key");
CREATE UNIQUE INDEX "ai_media_suite_slot_child_workflow_key" ON "ai_media_suite_slots"("child_workflow_id");
CREATE UNIQUE INDEX "ai_media_suite_slot_child_workflow_owner_key" ON "ai_media_suite_slots"("child_workflow_id", "owner_user_id");
CREATE INDEX "ai_media_suite_slot_owner_status_idx" ON "ai_media_suite_slots"("owner_user_id", "status", "updated_at");
ALTER TABLE "ai_media_suite_slots"
  ADD CONSTRAINT "ai_media_suite_slot_suite_fkey" FOREIGN KEY ("suite_id", "owner_user_id") REFERENCES "ai_media_suites"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_slot_child_workflow_fkey" FOREIGN KEY ("child_workflow_id", "owner_user_id") REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_media_suite_events" (
  "id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "event_key" VARCHAR(200) NOT NULL,
  "event_type" VARCHAR(50) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_suite_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_suite_event_values_check" CHECK (
    "revision" >= 1 AND "payload_hash" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "ai_media_suite_event_key" ON "ai_media_suite_events"("event_key");
CREATE UNIQUE INDEX "ai_media_suite_event_revision_key" ON "ai_media_suite_events"("suite_id", "revision");
CREATE INDEX "ai_media_suite_event_suite_created_idx" ON "ai_media_suite_events"("suite_id", "created_at");
CREATE INDEX "ai_media_suite_event_owner_created_idx" ON "ai_media_suite_events"("owner_user_id", "created_at");
ALTER TABLE "ai_media_suite_events"
  ADD CONSTRAINT "ai_media_suite_event_suite_fkey" FOREIGN KEY ("suite_id", "owner_user_id") REFERENCES "ai_media_suites"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_event_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_ai_media_suite_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media suite cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    OR NEW."plan_id" IS DISTINCT FROM OLD."plan_id"
    OR NEW."plan_version_id" IS DISTINCT FROM OLD."plan_version_id"
    OR NEW."source_subject_id" IS DISTINCT FROM OLD."source_subject_id"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM OLD."source_capture_snapshot_id"
    OR NEW."source_capture_hash" IS DISTINCT FROM OLD."source_capture_hash"
    OR NEW."source_profile_hash" IS DISTINCT FROM OLD."source_profile_hash"
    OR NEW."source_schema_version" IS DISTINCT FROM OLD."source_schema_version"
    OR NEW."context_type" IS DISTINCT FROM OLD."context_type"
    OR NEW."context_id" IS DISTINCT FROM OLD."context_id"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."preview_hash" IS DISTINCT FROM OLD."preview_hash"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."model" IS DISTINCT FROM OLD."model"
    OR NEW."provider_config_hash" IS DISTINCT FROM OLD."provider_config_hash"
    OR NEW."pricing_version" IS DISTINCT FROM OLD."pricing_version"
    OR NEW."item_count" IS DISTINCT FROM OLD."item_count"
    OR NEW."estimated_cost_cents" IS DISTINCT FROM OLD."estimated_cost_cents"
    OR NEW."maximum_cost_cents" IS DISTINCT FROM OLD."maximum_cost_cents"
    OR NEW."concurrency_limit" IS DISTINCT FROM OLD."concurrency_limit"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media suite identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'AI media suite revision must advance by one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_media_suite_identity_immutable" BEFORE UPDATE OR DELETE ON "ai_media_suites" FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_identity();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_slot_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media suite slot cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."suite_id" IS DISTINCT FROM OLD."suite_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."slot_key" IS DISTINCT FROM OLD."slot_key"
    OR NEW."goal" IS DISTINCT FROM OLD."goal"
    OR NEW."ownership_level" IS DISTINCT FROM OLD."ownership_level"
    OR NEW."ownership_key" IS DISTINCT FROM OLD."ownership_key"
    OR NEW."compatibility_group_key" IS DISTINCT FROM OLD."compatibility_group_key"
    OR NEW."slot_snapshot_json" IS DISTINCT FROM OLD."slot_snapshot_json"
    OR NEW."slot_hash" IS DISTINCT FROM OLD."slot_hash"
    OR NEW."references_snapshot_json" IS DISTINCT FROM OLD."references_snapshot_json"
    OR NEW."references_hash" IS DISTINCT FROM OLD."references_hash"
    OR NEW."diagnostics_json" IS DISTINCT FROM OLD."diagnostics_json"
    OR NEW."estimated_cost_cents" IS DISTINCT FROM OLD."estimated_cost_cents"
    OR NEW."maximum_cost_cents" IS DISTINCT FROM OLD."maximum_cost_cents"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media suite slot identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_media_suite_slot_identity_immutable" BEFORE UPDATE OR DELETE ON "ai_media_suite_slots" FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_slot_identity();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media suite event is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_media_suite_event_immutable" BEFORE UPDATE OR DELETE ON "ai_media_suite_events" FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_event_immutable();

COMMIT;
