BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

LOCK TABLE "ai_media_application_mutations" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ai_media_application_mutations") THEN
    RAISE EXCEPTION 'application mutation authority upgrade requires an empty ledger'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "ai_media_application_mutations"
  DROP CONSTRAINT "ai_media_application_mutation_values_check",
  DROP CONSTRAINT "ai_media_application_mutation_before_state_check",
  DROP CONSTRAINT "ai_media_application_mutation_after_state_check";

ALTER TABLE "ai_media_application_mutations"
  ADD CONSTRAINT "ai_media_application_mutation_values_check" CHECK (
    "revision" = 1
    AND "target_type" = 'collect'
    AND btrim("target_id") <> ''
    AND "target_sequence" >= 1
    AND btrim("operation_key") <> ''
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "workflow_revision_before" >= 1
    AND "workflow_revision_after" = "workflow_revision_before" + 1
    AND "target_version_after" > "target_version_before"
    AND "before_state_hash" ~ '^[0-9a-f]{64}$'
    AND "after_state_hash" ~ '^[0-9a-f]{64}$'
    AND "before_state_hash" <> "after_state_hash"
    AND "before_state_json" IS DISTINCT FROM "after_state_json"
    AND (("kind" = 'APPLY' AND "rollback_of_id" IS NULL)
      OR ("kind" = 'ROLLBACK' AND "rollback_of_id" IS NOT NULL))
  ),
  ADD CONSTRAINT "ai_media_application_mutation_before_state_check" CHECK ((
    jsonb_typeof("before_state_json") = 'object'
    AND CASE WHEN jsonb_typeof("before_state_json") = 'object'
      THEN ("before_state_json" - ARRAY['version', 'images', 'watermarkedImages', 'editedImages']::text[]) = '{}'::jsonb
      ELSE FALSE END
    AND "before_state_json"->>'version' = 'ai-media-collect-projection/v1'
    AND "before_state_json" ? 'images'
    AND jsonb_typeof("before_state_json"->'watermarkedImages') = 'object'
    AND jsonb_typeof("before_state_json"->'editedImages') = 'object'
    AND jsonb_typeof("before_state_json"->'watermarkedImages'->'present') = 'boolean'
    AND "before_state_json"->'watermarkedImages' ? 'value'
    AND CASE WHEN jsonb_typeof("before_state_json"->'watermarkedImages') = 'object'
      THEN (("before_state_json"->'watermarkedImages') - ARRAY['present', 'value']::text[]) = '{}'::jsonb
      ELSE FALSE END
    AND jsonb_typeof("before_state_json"->'editedImages'->'present') = 'boolean'
    AND "before_state_json"->'editedImages' ? 'value'
    AND CASE WHEN jsonb_typeof("before_state_json"->'editedImages') = 'object'
      THEN (("before_state_json"->'editedImages') - ARRAY['present', 'value']::text[]) = '{}'::jsonb
      ELSE FALSE END
    AND CASE WHEN jsonb_typeof("before_state_json"->'images') = 'array'
      THEN jsonb_array_length("before_state_json"->'images') <= 100 ELSE TRUE END
    AND CASE WHEN jsonb_typeof("before_state_json"->'watermarkedImages'->'value') = 'array'
      THEN jsonb_array_length("before_state_json"->'watermarkedImages'->'value') <= 100 ELSE TRUE END
    AND CASE WHEN jsonb_typeof("before_state_json"->'editedImages'->'value') = 'array'
      THEN jsonb_array_length("before_state_json"->'editedImages'->'value') <= 100 ELSE TRUE END
    AND octet_length("before_state_json"::text) <= 262144
  ) IS TRUE),
  ADD CONSTRAINT "ai_media_application_mutation_after_state_check" CHECK ((
    jsonb_typeof("after_state_json") = 'object'
    AND CASE WHEN jsonb_typeof("after_state_json") = 'object'
      THEN ("after_state_json" - ARRAY['version', 'images', 'watermarkedImages', 'editedImages']::text[]) = '{}'::jsonb
      ELSE FALSE END
    AND "after_state_json"->>'version' = 'ai-media-collect-projection/v1'
    AND "after_state_json" ? 'images'
    AND jsonb_typeof("after_state_json"->'watermarkedImages') = 'object'
    AND jsonb_typeof("after_state_json"->'editedImages') = 'object'
    AND jsonb_typeof("after_state_json"->'watermarkedImages'->'present') = 'boolean'
    AND "after_state_json"->'watermarkedImages' ? 'value'
    AND CASE WHEN jsonb_typeof("after_state_json"->'watermarkedImages') = 'object'
      THEN (("after_state_json"->'watermarkedImages') - ARRAY['present', 'value']::text[]) = '{}'::jsonb
      ELSE FALSE END
    AND jsonb_typeof("after_state_json"->'editedImages'->'present') = 'boolean'
    AND "after_state_json"->'editedImages' ? 'value'
    AND CASE WHEN jsonb_typeof("after_state_json"->'editedImages') = 'object'
      THEN (("after_state_json"->'editedImages') - ARRAY['present', 'value']::text[]) = '{}'::jsonb
      ELSE FALSE END
    AND CASE WHEN jsonb_typeof("after_state_json"->'images') = 'array'
      THEN jsonb_array_length("after_state_json"->'images') <= 100 ELSE TRUE END
    AND CASE WHEN jsonb_typeof("after_state_json"->'watermarkedImages'->'value') = 'array'
      THEN jsonb_array_length("after_state_json"->'watermarkedImages'->'value') <= 100 ELSE TRUE END
    AND CASE WHEN jsonb_typeof("after_state_json"->'editedImages'->'value') = 'array'
      THEN jsonb_array_length("after_state_json"->'editedImages'->'value') <= 100 ELSE TRUE END
    AND octet_length("after_state_json"::text) <= 262144
  ) IS TRUE);

CREATE OR REPLACE FUNCTION validate_ai_media_application_mutation_insert() RETURNS trigger AS $$
DECLARE
  stored_workflow "ai_media_workflows"%ROWTYPE;
  stored_job "ai_image_jobs"%ROWTYPE;
  stored_asset "media_assets"%ROWTYPE;
  stored_apply "ai_media_application_mutations"%ROWTYPE;
  target_images JSONB;
  target_metadata JSONB;
  target_updated_at TIMESTAMP(3);
  expected_before_state JSONB;
  expected_target_sequence INTEGER;
BEGIN
  SELECT * INTO stored_workflow
  FROM "ai_media_workflows"
  WHERE "id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application mutation workflow does not belong to owner' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO stored_job
  FROM "ai_image_jobs"
  WHERE "id" = NEW."job_id" AND "owner_user_id" = NEW."owner_user_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application mutation job does not belong to owner' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO stored_asset
  FROM "media_assets"
  WHERE "id" = NEW."asset_id" AND "owner_user_id" = NEW."owner_user_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application mutation asset does not belong to owner' USING ERRCODE = '23514';
  END IF;

  SELECT goods."images", goods."metadata", goods."updated_at"
  INTO target_images, target_metadata, target_updated_at
  FROM "supply_goods" goods
  WHERE goods."id" = NEW."target_id"
    AND goods."user_id" = NEW."owner_user_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application mutation target does not belong to owner' USING ERRCODE = '23514';
  END IF;

  IF stored_job."workflow_id" IS DISTINCT FROM NEW."workflow_id" THEN
    RAISE EXCEPTION 'application mutation job does not belong to workflow' USING ERRCODE = '23514';
  END IF;
  IF stored_asset."ai_image_job_id" IS DISTINCT FROM NEW."job_id"
    OR stored_asset."kind" IS DISTINCT FROM 'AI_GENERATED'
  THEN
    RAISE EXCEPTION 'application mutation output is not the reviewed job asset' USING ERRCODE = '23514';
  END IF;
  IF stored_workflow."context_type" IS DISTINCT FROM NEW."target_type"
    OR stored_workflow."context_id" IS DISTINCT FROM NEW."target_id"
    OR stored_workflow."context_sku_key" IS DISTINCT FROM NEW."context_sku_key"
    OR stored_workflow."context_slot_key" IS DISTINCT FROM NEW."context_slot_key"
  THEN
    RAISE EXCEPTION 'application mutation target does not match workflow context' USING ERRCODE = '23514';
  END IF;
  IF stored_job."operation"::text IS DISTINCT FROM stored_workflow."operation"::text
    OR stored_job."workflow_attempt" IS DISTINCT FROM stored_workflow."current_attempt"
  THEN
    RAISE EXCEPTION 'application mutation job authority does not match current workflow attempt'
      USING ERRCODE = '23514';
  END IF;
  IF stored_workflow."revision" IS DISTINCT FROM NEW."workflow_revision_before" THEN
    RAISE EXCEPTION 'application mutation workflow revision is stale' USING ERRCODE = '40001';
  END IF;
  IF NEW."target_version_before" IS DISTINCT FROM target_updated_at THEN
    RAISE EXCEPTION 'application mutation target version is stale' USING ERRCODE = '40001';
  END IF;

  target_metadata := CASE
    WHEN target_metadata IS NULL OR target_metadata = 'null'::jsonb THEN '{}'::jsonb
    ELSE target_metadata
  END;
  IF jsonb_typeof(target_metadata) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'application mutation target metadata is not an object' USING ERRCODE = '23514';
  END IF;
  expected_before_state := jsonb_build_object(
    'version', 'ai-media-collect-projection/v1',
    'images', coalesce(target_images, 'null'::jsonb),
    'watermarkedImages', jsonb_build_object(
      'present', target_metadata ? 'watermarkedImages',
      'value', CASE
        WHEN target_metadata ? 'watermarkedImages' THEN target_metadata->'watermarkedImages'
        ELSE '[]'::jsonb
      END
    ),
    'editedImages', jsonb_build_object(
      'present', target_metadata ? 'editedImages',
      'value', CASE
        WHEN target_metadata ? 'editedImages' THEN target_metadata->'editedImages'
        ELSE '[]'::jsonb
      END
    )
  );
  IF NEW."before_state_json" IS DISTINCT FROM expected_before_state THEN
    RAISE EXCEPTION 'application mutation before projection does not match current target'
      USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(max("target_sequence"), 0) + 1
  INTO expected_target_sequence
  FROM "ai_media_application_mutations"
  WHERE "owner_user_id" = NEW."owner_user_id"
    AND "target_type" = NEW."target_type"
    AND "target_id" = NEW."target_id";
  IF NEW."target_sequence" IS DISTINCT FROM expected_target_sequence THEN
    RAISE EXCEPTION 'application mutation target sequence is stale' USING ERRCODE = '40001';
  END IF;

  IF NEW."kind" = 'APPLY' THEN
    IF stored_job."status" IS DISTINCT FROM 'SUCCEEDED'
      OR stored_workflow."status" IS DISTINCT FROM 'SUCCEEDED'
      OR stored_workflow."review_status" IS DISTINCT FROM 'APPROVED'
      OR stored_workflow."selected_output_asset_id" IS DISTINCT FROM NEW."asset_id"
    THEN
      RAISE EXCEPTION 'application mutation output is not the reviewed job asset' USING ERRCODE = '23514';
    END IF;
    IF stored_job."applied_at" IS NOT NULL THEN
      RAISE EXCEPTION 'application mutation job was already applied without this ledger' USING ERRCODE = '23514';
    END IF;
    IF NEW."mode" = 'REPLACE' AND (
      stored_job."operation" IS DISTINCT FROM 'IMAGE_TO_IMAGE'
      OR EXISTS (
        SELECT 1 FROM "ai_media_suite_slots"
        WHERE "child_workflow_id" = NEW."workflow_id"
          AND "owner_user_id" = NEW."owner_user_id"
      )
    ) THEN
      RAISE EXCEPTION 'application replace mode is not allowed for this workflow' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO stored_apply
    FROM "ai_media_application_mutations"
    WHERE "id" = NEW."rollback_of_id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "kind" = 'APPLY';

    IF stored_apply."id" IS NULL
      OR NEW."workflow_id" IS DISTINCT FROM stored_apply."workflow_id"
      OR NEW."job_id" IS DISTINCT FROM stored_apply."job_id"
      OR NEW."asset_id" IS DISTINCT FROM stored_apply."asset_id"
      OR NEW."target_type" IS DISTINCT FROM stored_apply."target_type"
      OR NEW."target_id" IS DISTINCT FROM stored_apply."target_id"
      OR NEW."mode" IS DISTINCT FROM stored_apply."mode"
      OR NEW."context_sku_key" IS DISTINCT FROM stored_apply."context_sku_key"
      OR NEW."context_slot_key" IS DISTINCT FROM stored_apply."context_slot_key"
      OR NEW."before_state_json" IS DISTINCT FROM stored_apply."after_state_json"
      OR NEW."before_state_hash" IS DISTINCT FROM stored_apply."after_state_hash"
      OR NEW."after_state_json" IS DISTINCT FROM stored_apply."before_state_json"
      OR NEW."after_state_hash" IS DISTINCT FROM stored_apply."before_state_hash"
    THEN
      RAISE EXCEPTION 'application rollback does not mirror the applied projection' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "ai_media_application_mutations" later_apply
      WHERE later_apply."owner_user_id" = NEW."owner_user_id"
        AND later_apply."target_type" = NEW."target_type"
        AND later_apply."target_id" = NEW."target_id"
        AND later_apply."kind" = 'APPLY'
        AND later_apply."target_sequence" > stored_apply."target_sequence"
        AND NOT EXISTS (
          SELECT 1
          FROM "ai_media_application_mutations" compensation
          WHERE compensation."rollback_of_id" = later_apply."id"
            AND compensation."owner_user_id" = later_apply."owner_user_id"
            AND compensation."kind" = 'ROLLBACK'
        )
    ) THEN
      RAISE EXCEPTION 'application rollback is not the current target frontier' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ai_media_application_mutations_validate_authority_insert"
  ON "ai_media_application_mutations";
DROP FUNCTION IF EXISTS validate_ai_media_application_mutation_authority_insert();

COMMIT;
