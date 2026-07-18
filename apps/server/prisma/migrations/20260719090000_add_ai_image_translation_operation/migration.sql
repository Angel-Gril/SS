-- Unit 9A: add the provider-neutral image translation operation and freeze
-- its operation-specific request options with the workflow child.
ALTER TYPE "AiMediaOperation" ADD VALUE IF NOT EXISTS 'IMAGE_TRANSLATE';

ALTER TABLE "ai_image_jobs"
  ADD COLUMN "operation_config_json" JSONB;

CREATE OR REPLACE FUNCTION protect_ai_image_job_operation_config() RETURNS trigger AS $$
BEGIN
  IF OLD."workflow_id" IS NOT NULL
    AND NEW."operation_config_json" IS DISTINCT FROM OLD."operation_config_json"
  THEN
    RAISE EXCEPTION 'AI media workflow operation config is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_operation_config_immutable"
BEFORE UPDATE OF "operation_config_json" ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_ai_image_job_operation_config();
