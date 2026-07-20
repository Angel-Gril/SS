CREATE UNIQUE INDEX CONCURRENTLY "source_listing_draft_ai_media_context_key"
  ON "source_listing_draft_versions"(
    "workflow_id", "revision", "owner_user_id", "draft_version"
  );
