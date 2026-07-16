ALTER TABLE "ai_image_jobs"
  ADD COLUMN "resolved_prompt" TEXT,
  ADD COLUMN "resolved_negative_prompt" TEXT,
  ADD COLUMN "template_key" TEXT,
  ADD COLUMN "template_release_id" TEXT,
  ADD COLUMN "template_checksum" TEXT,
  ADD COLUMN "template_snapshot_json" JSONB,
  ADD COLUMN "request_fingerprint" TEXT;

CREATE INDEX "ai_image_jobs_template_key_template_release_id_idx"
  ON "ai_image_jobs"("template_key", "template_release_id");
