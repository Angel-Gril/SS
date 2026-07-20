BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_media_workflows"
  ADD CONSTRAINT "ai_media_workflow_listing_draft_context_fkey"
  FOREIGN KEY (
    "context_id", "context_draft_revision", "owner_user_id", "context_draft_version"
  ) REFERENCES "source_listing_draft_versions"(
    "workflow_id", "revision", "owner_user_id", "draft_version"
  ) ON DELETE RESTRICT ON UPDATE NO ACTION
  NOT VALID;

ALTER TABLE "ai_media_workflows"
  VALIDATE CONSTRAINT "ai_media_workflow_listing_draft_context_fkey";

CREATE OR REPLACE FUNCTION protect_ai_media_workflow_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    OR NEW."operation" IS DISTINCT FROM OLD."operation"
    OR NEW."context_type" IS DISTINCT FROM OLD."context_type"
    OR NEW."context_id" IS DISTINCT FROM OLD."context_id"
    OR NEW."context_sku_key" IS DISTINCT FROM OLD."context_sku_key"
    OR NEW."context_slot_key" IS DISTINCT FROM OLD."context_slot_key"
    OR NEW."context_draft_revision" IS DISTINCT FROM OLD."context_draft_revision"
    OR NEW."context_draft_version" IS DISTINCT FROM OLD."context_draft_version"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media workflow identity is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
