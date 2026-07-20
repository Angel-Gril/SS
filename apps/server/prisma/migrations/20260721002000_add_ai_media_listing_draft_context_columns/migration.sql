BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_media_workflows"
  ADD COLUMN "context_draft_revision" INTEGER,
  ADD COLUMN "context_draft_version" INTEGER;

-- Existing listing-draft rows predate the frozen draft identity contract. Do
-- not guess their revision/version; require an explicit backfill instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_media_workflows"
    WHERE "context_type" = 'listing-draft'
      AND (
        "context_draft_revision" IS NULL
        OR "context_draft_version" IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'existing listing-draft AI media workflows require draft revision/version backfill';
  END IF;
END;
$$;

ALTER TABLE "ai_media_workflows"
  ADD CONSTRAINT "ai_media_workflow_context_version_check" CHECK (
    (
      "context_type" = 'listing-draft'
      AND "context_id" IS NOT NULL
      AND "context_draft_revision" IS NOT NULL
      AND "context_draft_revision" > 0
      AND "context_draft_version" IS NOT NULL
      AND "context_draft_version" > 0
    )
    OR
    (
      "context_type" IS DISTINCT FROM 'listing-draft'
      AND "context_draft_revision" IS NULL
      AND "context_draft_version" IS NULL
    )
  ) NOT VALID;

ALTER TABLE "ai_media_workflows"
  VALIDATE CONSTRAINT "ai_media_workflow_context_version_check";

COMMIT;
