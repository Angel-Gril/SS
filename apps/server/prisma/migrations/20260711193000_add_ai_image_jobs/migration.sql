CREATE TYPE "AiImageJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED');
CREATE TYPE "MediaAssetKind" AS ENUM ('AI_GENERATED');

CREATE TABLE "ai_image_jobs" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "status" "AiImageJobStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "negative_prompt" TEXT,
  "input_assets_json" JSONB,
  "requested_image_count" INTEGER NOT NULL DEFAULT 1,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" TEXT,
  "provider_job_id" TEXT,
  "estimated_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "actual_cost_cents" INTEGER,
  "billed_units" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  "applied_mode" TEXT,
  "apply_target_type" TEXT,
  "apply_target_id" TEXT,
  "applied_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_image_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_assets" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "ai_image_job_id" TEXT,
  "kind" "MediaAssetKind" NOT NULL DEFAULT 'AI_GENERATED',
  "url" TEXT NOT NULL,
  "storage_backend" TEXT NOT NULL,
  "storage_key" TEXT,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "width" INTEGER,
  "height" INTEGER,
  "sha256" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_image_jobs_owner_user_id_idempotency_key_key" ON "ai_image_jobs"("owner_user_id", "idempotency_key");
CREATE INDEX "ai_image_jobs_owner_user_id_created_at_idx" ON "ai_image_jobs"("owner_user_id", "created_at");
CREATE INDEX "ai_image_jobs_actor_user_id_created_at_idx" ON "ai_image_jobs"("actor_user_id", "created_at");
CREATE INDEX "ai_image_jobs_status_created_at_idx" ON "ai_image_jobs"("status", "created_at");
CREATE INDEX "media_assets_owner_user_id_created_at_idx" ON "media_assets"("owner_user_id", "created_at");
CREATE INDEX "media_assets_ai_image_job_id_idx" ON "media_assets"("ai_image_job_id");

ALTER TABLE "ai_image_jobs" ADD CONSTRAINT "ai_image_jobs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_image_jobs" ADD CONSTRAINT "ai_image_jobs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_ai_image_job_id_fkey" FOREIGN KEY ("ai_image_job_id") REFERENCES "ai_image_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
