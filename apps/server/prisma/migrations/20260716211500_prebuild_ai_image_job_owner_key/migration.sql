CREATE UNIQUE INDEX CONCURRENTLY "ai_image_job_id_owner"
  ON "ai_image_jobs"("id", "owner_user_id");
