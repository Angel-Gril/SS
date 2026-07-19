BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- NOT VALID enforces the tenant tuple for new writes immediately. Keeping the
-- legacy ID-only FK until validation completes avoids a referential gap.
ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_ai_image_job_id_owner_user_id_fkey"
  FOREIGN KEY ("ai_image_job_id", "owner_user_id")
  REFERENCES "ai_image_jobs"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "media_assets"
  VALIDATE CONSTRAINT "media_assets_ai_image_job_id_owner_user_id_fkey";

ALTER TABLE "media_assets"
  DROP CONSTRAINT "media_assets_ai_image_job_id_fkey";

COMMIT;
