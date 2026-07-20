CREATE INDEX CONCURRENTLY "ai_media_workflow_listing_draft_context_idx"
  ON "ai_media_workflows"(
    "context_id", "context_draft_revision", "owner_user_id", "context_draft_version"
  );
