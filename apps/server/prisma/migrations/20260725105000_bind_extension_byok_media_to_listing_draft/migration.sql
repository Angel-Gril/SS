BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- SRV-05 makes a BYOK provenance row point at both the frozen source draft
-- used for generation and the immediate immutable draft produced by applying
-- the accepted ERP-owned asset. The feature remained dark before this
-- migration, so a pre-existing provenance row indicates an unsafe partial
-- rollout that cannot be guessed or backfilled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "extension_byok_media_provenance" LIMIT 1) THEN
    RAISE EXCEPTION 'cannot add BYOK draft binding authority to existing provenance rows';
  END IF;
END;
$$;

ALTER TABLE "extension_byok_media_provenance"
  ADD COLUMN "bound_draft_revision" INTEGER NOT NULL,
  ADD COLUMN "bound_draft_version" INTEGER NOT NULL,
  ADD COLUMN "assignment_ordinal" INTEGER NOT NULL,
  ADD COLUMN "assignment_sha256" CHAR(64) NOT NULL,
  ADD COLUMN "policy_revision" INTEGER NOT NULL,
  ADD CONSTRAINT "extension_byok_media_provenance_bound_transition_check" CHECK (
    "bound_draft_revision" = "draft_revision" + 1
    AND "bound_draft_version" = "draft_version" + 1
  ),
  ADD CONSTRAINT "extension_byok_media_provenance_assignment_check" CHECK (
    "assignment_ordinal" BETWEEN 0 AND 499
    AND "assignment_sha256" ~ '^[a-f0-9]{64}$'
    AND "policy_revision" >= 0
  ),
  ADD CONSTRAINT "extension_byok_media_provenance_bound_draft_fkey"
    FOREIGN KEY ("workflow_id", "bound_draft_revision", "owner_user_id", "bound_draft_version")
    REFERENCES "source_listing_draft_versions"("workflow_id", "revision", "owner_user_id", "draft_version")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "extension_byok_media_provenance_bound_draft_idx"
  ON "extension_byok_media_provenance"(
    "workflow_id", "bound_draft_version", "bound_draft_revision"
  );

CREATE OR REPLACE FUNCTION "validate_extension_byok_media_provenance_authority"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_payload jsonb;
  bound_snapshot_id text;
  bound_assignment jsonb;
  publish_payload jsonb;
  publish_snapshot_id text;
  expected_source text;
BEGIN
  IF TG_OP = 'INSERT'
    AND (NEW."publish_intent_id" IS NOT NULL OR NEW."publish_receipt_id" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'BYOK media provenance publish identity must be empty at creation' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "extension_device_sessions" session
    WHERE session."id" = NEW."device_session_id"
      AND session."owner_user_id" = NEW."owner_user_id"
      AND session."actor_user_id" = NEW."actor_user_id"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance device authority does not match actor and owner' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "source_listing_workflows" workflow
    WHERE workflow."id" = NEW."workflow_id"
      AND workflow."owner_user_id" = NEW."owner_user_id"
      AND workflow."shop_id" = NEW."shop_id"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance workflow authority does not match owner and shop' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "source_listing_draft_versions" draft
    WHERE draft."workflow_id" = NEW."workflow_id"
      AND draft."revision" = NEW."draft_revision"
      AND draft."draft_version" = NEW."draft_version"
      AND draft."owner_user_id" = NEW."owner_user_id"
      AND draft."shop_id" = NEW."shop_id"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance source draft authority is inconsistent' USING ERRCODE = '23514';
  END IF;

  SELECT draft."payload", draft."source_capture_snapshot_id"
    INTO bound_payload, bound_snapshot_id
  FROM "source_listing_draft_versions" draft
  WHERE draft."workflow_id" = NEW."workflow_id"
    AND draft."revision" = NEW."bound_draft_revision"
    AND draft."draft_version" = NEW."bound_draft_version"
    AND draft."owner_user_id" = NEW."owner_user_id"
    AND draft."shop_id" = NEW."shop_id"
    AND draft."parent_revision" = NEW."draft_revision";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BYOK media provenance bound draft authority is inconsistent' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "source_listing_draft_versions" source_draft
    WHERE source_draft."workflow_id" = NEW."workflow_id"
      AND source_draft."revision" = NEW."draft_revision"
      AND source_draft."draft_version" = NEW."draft_version"
      AND source_draft."owner_user_id" = NEW."owner_user_id"
      AND source_draft."source_capture_snapshot_id" = bound_snapshot_id
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance source and bound snapshots differ' USING ERRCODE = '23514';
  END IF;

  expected_source := CASE
    WHEN NEW."operation" IN ('TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE') THEN 'GENERATED'
    WHEN NEW."operation" IN ('FULL_EDIT', 'INPAINT') THEN 'EDITED'
    ELSE NULL
  END;
  bound_assignment := bound_payload -> 'media' -> 'assignments' -> NEW."assignment_ordinal";
  IF expected_source IS NULL
    OR jsonb_typeof(bound_assignment) IS DISTINCT FROM 'object'
    OR (CASE
      WHEN jsonb_typeof(bound_assignment) = 'object'
        THEN (SELECT count(*) FROM jsonb_object_keys(bound_assignment)) <> 5
      ELSE true
    END)
    OR bound_assignment->>'scope' IS DISTINCT FROM 'SKU'
    OR bound_assignment->>'skuKey' IS DISTINCT FROM NEW."sku_key"
    OR bound_assignment->>'slotKey' IS DISTINCT FROM NEW."slot_key"
    OR bound_assignment->>'assetId' IS DISTINCT FROM NEW."asset_id"
    OR bound_assignment->>'source' IS DISTINCT FROM expected_source
  THEN
    RAISE EXCEPTION 'BYOK media provenance assignment is not present at the bound draft ordinal' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "media_assets" asset
    WHERE asset."id" = NEW."asset_id"
      AND asset."owner_user_id" = NEW."owner_user_id"
      AND asset."kind" = 'AI_GENERATED'
      AND asset."ai_image_job_id" IS NULL
      AND asset."source_capture_snapshot_id" = bound_snapshot_id
      AND asset."source_url" IS NULL
      AND asset."storage_backend" IN ('local', 'oss')
      AND NULLIF(btrim(asset."storage_key"), '') IS NOT NULL
      AND asset."sha256" = NEW."result_sha256"
      AND asset."mime_type" = NEW."result_mime_type"
      AND asset."width" = NEW."result_width"
      AND asset."height" = NEW."result_height"
      AND asset."metadata"->>'generatedAssetSource' = 'EXTENSION_BYOK'
      AND asset."metadata"->>'executionMode' = 'BYOK'
      AND asset."metadata"->>'outputRole' = 'BYOK_ACCEPTED'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance asset identity is inconsistent' USING ERRCODE = '23514';
  END IF;

  IF NEW."publish_intent_id" IS NOT NULL THEN
    SELECT draft."payload", draft."source_capture_snapshot_id"
      INTO publish_payload, publish_snapshot_id
    FROM "source_listing_publish_intents" intent
    JOIN "source_listing_draft_versions" draft
      ON draft."workflow_id" = intent."workflow_id"
     AND draft."revision" = intent."revision"
     AND draft."owner_user_id" = intent."owner_user_id"
     AND draft."draft_version" = intent."draft_version"
    WHERE intent."id" = NEW."publish_intent_id"
      AND intent."owner_user_id" = NEW."owner_user_id"
      AND intent."shop_id" = NEW."shop_id"
      AND intent."workflow_id" = NEW."workflow_id"
      AND intent."revision" >= NEW."bound_draft_revision"
      AND draft."source_capture_snapshot_id" = bound_snapshot_id;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(publish_payload -> 'media' -> 'assignments') AS media_assignment(value)
      WHERE jsonb_typeof(media_assignment.value) = 'object'
        AND (CASE
          WHEN jsonb_typeof(media_assignment.value) = 'object'
            THEN (SELECT count(*) FROM jsonb_object_keys(media_assignment.value)) = 5
          ELSE false
        END)
        AND media_assignment.value->>'scope' = 'SKU'
        AND media_assignment.value->>'skuKey' = NEW."sku_key"
        AND media_assignment.value->>'slotKey' = NEW."slot_key"
        AND media_assignment.value->>'assetId' = NEW."asset_id"
        AND media_assignment.value->>'source' = expected_source
    ) THEN
      RAISE EXCEPTION 'BYOK media provenance publish intent no longer contains the bound assignment' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."publish_receipt_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "source_listing_publish_intents" intent
    JOIN "extension_command_receipts" receipt
      ON receipt."id" = NEW."publish_receipt_id"
    JOIN "extension_command_grants" command_grant
      ON command_grant."id" = receipt."grant_id"
    JOIN "extension_device_sessions" command_session
      ON command_session."id" = command_grant."session_id"
    WHERE intent."id" = NEW."publish_intent_id"
      AND intent."owner_user_id" = NEW."owner_user_id"
      AND intent."shop_id" = NEW."shop_id"
      AND intent."workflow_id" = NEW."workflow_id"
      AND intent."actor_user_id" = NEW."actor_user_id"
      AND command_session."id" = NEW."device_session_id"
      AND intent."actor_user_id" = command_session."actor_user_id"
      AND command_session."owner_user_id" = NEW."owner_user_id"
      AND command_grant."owner_user_id" = NEW."owner_user_id"
      AND command_grant."shop_id" = NEW."shop_id"
      AND command_grant."workflow_id" = NEW."workflow_id"
      AND command_grant."draft_version" = intent."draft_version"
      AND command_grant."operation" = 'OZON_PUBLISH'
      AND command_grant."idempotency_key" = intent."idempotency_key"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance publish intent and receipt are not the same publish command identity' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
