CREATE UNIQUE INDEX CONCURRENTLY "ai_image_job_workflow_attempt"
  ON "ai_image_jobs"("workflow_id", "workflow_attempt");
