CREATE INDEX CONCURRENTLY "ai_media_workflow_owner_context_updates"
ON "ai_media_workflows" (
  "owner_user_id",
  "context_type",
  "context_id",
  "updated_at" DESC,
  "id" DESC
);
