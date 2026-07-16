BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_image_jobs"
  ADD CONSTRAINT "ai_image_job_id_owner" UNIQUE USING INDEX "ai_image_job_id_owner",
  ADD CONSTRAINT "ai_image_job_workflow_attempt" UNIQUE USING INDEX "ai_image_job_workflow_attempt";

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_asset_id_owner" UNIQUE USING INDEX "media_asset_id_owner";

CREATE TABLE "ai_media_workflows" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "operation" "AiMediaOperation" NOT NULL,
  "status" "AiMediaWorkflowStatus" NOT NULL DEFAULT 'QUEUED',
  "review_status" "AiMediaReviewStatus" NOT NULL DEFAULT 'NOT_READY',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "current_attempt" INTEGER NOT NULL DEFAULT 1,
  "context_type" VARCHAR(50),
  "context_id" VARCHAR(200),
  "context_sku_key" VARCHAR(500),
  "context_slot_key" VARCHAR(200),
  "idempotency_key" VARCHAR(128),
  "request_fingerprint" CHAR(64) NOT NULL,
  "selected_output_asset_id" TEXT,
  "reviewed_by_user_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "cancel_requested_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_media_workflows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_workflow_id_owner" UNIQUE ("id", "owner_user_id"),
  CONSTRAINT "ai_media_workflow_owner_idempotency" UNIQUE ("owner_user_id", "idempotency_key")
);

CREATE TABLE "ai_media_workflow_inputs" (
  "id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "role" "AiMediaInputRole" NOT NULL DEFAULT 'REFERENCE',
  "ordinal" INTEGER NOT NULL DEFAULT 0,
  "asset_sha256" CHAR(64),
  "asset_url" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_workflow_inputs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_workflow_input_role_ordinal" UNIQUE ("workflow_id", "role", "ordinal"),
  CONSTRAINT "ai_media_workflow_input_asset_role" UNIQUE ("workflow_id", "asset_id", "role")
);

CREATE TABLE "ai_media_workflow_events" (
  "id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "job_id" TEXT,
  "asset_id" TEXT,
  "event_key" VARCHAR(200) NOT NULL,
  "event_type" VARCHAR(50) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_workflow_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_workflow_events_event_key_key" UNIQUE ("event_key")
);

CREATE TABLE "media_asset_lineage" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "input_asset_id" TEXT NOT NULL,
  "output_asset_id" TEXT NOT NULL,
  "input_role" "AiMediaInputRole" NOT NULL DEFAULT 'REFERENCE',
  "ordinal" INTEGER NOT NULL DEFAULT 0,
  "operation" "AiMediaOperation" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_asset_lineage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_asset_lineage_output_role_ordinal" UNIQUE ("output_asset_id", "input_role", "ordinal"),
  CONSTRAINT "media_asset_lineage_output_input_role" UNIQUE ("output_asset_id", "input_asset_id", "input_role")
);

CREATE INDEX "ai_media_workflows_owner_user_id_status_updated_at_idx" ON "ai_media_workflows"("owner_user_id", "status", "updated_at");
CREATE INDEX "ai_media_workflows_owner_user_id_operation_created_at_idx" ON "ai_media_workflows"("owner_user_id", "operation", "created_at");
CREATE INDEX "ai_media_workflows_owner_user_id_selected_output_asset_id_idx" ON "ai_media_workflows"("owner_user_id", "selected_output_asset_id");
CREATE INDEX "ai_media_workflows_context_type_context_id_created_at_idx" ON "ai_media_workflows"("context_type", "context_id", "created_at");
CREATE INDEX "ai_media_workflow_inputs_owner_user_id_asset_id_idx" ON "ai_media_workflow_inputs"("owner_user_id", "asset_id");
CREATE INDEX "ai_media_workflow_events_workflow_id_created_at_idx" ON "ai_media_workflow_events"("workflow_id", "created_at");
CREATE INDEX "ai_media_workflow_events_owner_user_id_created_at_idx" ON "ai_media_workflow_events"("owner_user_id", "created_at");
CREATE INDEX "ai_media_workflow_events_owner_user_id_asset_id_idx" ON "ai_media_workflow_events"("owner_user_id", "asset_id");
CREATE INDEX "media_asset_lineage_input_asset_id_created_at_idx" ON "media_asset_lineage"("input_asset_id", "created_at");
CREATE INDEX "media_asset_lineage_workflow_id_created_at_idx" ON "media_asset_lineage"("workflow_id", "created_at");
CREATE INDEX "media_asset_lineage_job_id_idx" ON "media_asset_lineage"("job_id");

ALTER TABLE "ai_media_workflows" ADD CONSTRAINT "ai_media_workflows_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_media_workflows" ADD CONSTRAINT "ai_media_workflows_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_media_workflows" ADD CONSTRAINT "ai_media_workflows_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_media_workflows" ADD CONSTRAINT "ai_media_workflows_selected_output_asset_id_owner_user_id_fkey" FOREIGN KEY ("selected_output_asset_id", "owner_user_id") REFERENCES "media_assets"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_media_workflow_inputs" ADD CONSTRAINT "ai_media_workflow_inputs_workflow_id_owner_user_id_fkey" FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_media_workflow_inputs" ADD CONSTRAINT "ai_media_workflow_inputs_asset_id_owner_user_id_fkey" FOREIGN KEY ("asset_id", "owner_user_id") REFERENCES "media_assets"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_media_workflow_events" ADD CONSTRAINT "ai_media_workflow_events_workflow_id_owner_user_id_fkey" FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_asset_lineage" ADD CONSTRAINT "media_asset_lineage_workflow_id_owner_user_id_fkey" FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_asset_lineage" ADD CONSTRAINT "media_asset_lineage_job_id_owner_user_id_fkey" FOREIGN KEY ("job_id", "owner_user_id") REFERENCES "ai_image_jobs"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_asset_lineage" ADD CONSTRAINT "media_asset_lineage_input_asset_id_owner_user_id_fkey" FOREIGN KEY ("input_asset_id", "owner_user_id") REFERENCES "media_assets"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_asset_lineage" ADD CONSTRAINT "media_asset_lineage_output_asset_id_owner_user_id_fkey" FOREIGN KEY ("output_asset_id", "owner_user_id") REFERENCES "media_assets"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_image_jobs" ADD CONSTRAINT "ai_image_jobs_workflow_id_owner_user_id_fkey" FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION reject_ai_media_immutable_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media history rows are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_workflow_events_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_workflow_events"
FOR EACH ROW EXECUTE FUNCTION reject_ai_media_immutable_mutation();

CREATE TRIGGER "ai_media_workflow_inputs_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_workflow_inputs"
FOR EACH ROW EXECUTE FUNCTION reject_ai_media_immutable_mutation();

COMMIT;
