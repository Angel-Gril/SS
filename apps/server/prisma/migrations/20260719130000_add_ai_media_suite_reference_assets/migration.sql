BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

DROP INDEX "media_asset_source_capture_key";
CREATE UNIQUE INDEX "media_asset_source_capture_storage_key"
  ON "media_assets"("owner_user_id", "source_capture_snapshot_id", "source_media_key", "storage_backend");

CREATE TABLE "ai_media_suite_reference_assets" (
  "id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "candidate_id" VARCHAR(500) NOT NULL,
  "asset_id" TEXT NOT NULL,
  "frozen_source_url" TEXT NOT NULL,
  "expected_content_hash" CHAR(64),
  "asset_sha256" CHAR(64) NOT NULL,
  "raw_source_sha256" CHAR(64) NOT NULL,
  "asset_url" TEXT NOT NULL,
  "storage_backend" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "binding_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_suite_reference_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_suite_reference_asset_values_check" CHECK (
    "ordinal" >= 0
    AND char_length("candidate_id") BETWEEN 1 AND 500
    AND "frozen_source_url" ~* '^https?://'
    AND "asset_url" ~* '^https?://'
    AND "storage_backend" IN ('local', 'oss')
    AND char_length("storage_key") >= 1
    AND "mime_type" IN ('image/jpeg', 'image/png')
    AND ("expected_content_hash" IS NULL OR "expected_content_hash" ~ '^[a-f0-9]{64}$')
    AND "asset_sha256" ~ '^[a-f0-9]{64}$'
    AND "raw_source_sha256" ~ '^[a-f0-9]{64}$'
    AND "binding_hash" ~ '^[a-f0-9]{64}$'
    AND "size_bytes" > 0
    AND "width" > 0
    AND "height" > 0
  )
);

CREATE UNIQUE INDEX "ai_media_suite_reference_candidate_key"
  ON "ai_media_suite_reference_assets"("suite_id", "owner_user_id", "candidate_id");
CREATE UNIQUE INDEX "ai_media_suite_reference_ordinal_key"
  ON "ai_media_suite_reference_assets"("suite_id", "ordinal");
CREATE UNIQUE INDEX "ai_media_suite_reference_asset_key"
  ON "ai_media_suite_reference_assets"("suite_id", "asset_id");
CREATE INDEX "ai_media_suite_reference_asset_owner_idx"
  ON "ai_media_suite_reference_assets"("asset_id", "owner_user_id");
CREATE INDEX "ai_media_suite_reference_owner_created_idx"
  ON "ai_media_suite_reference_assets"("owner_user_id", "created_at");

ALTER TABLE "ai_media_suite_reference_assets"
  ADD CONSTRAINT "ai_media_suite_reference_suite_fkey"
    FOREIGN KEY ("suite_id", "owner_user_id")
    REFERENCES "ai_media_suites"("id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_reference_asset_fkey"
    FOREIGN KEY ("asset_id", "owner_user_id")
    REFERENCES "media_assets"("id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_ai_media_suite_reference_asset_insert() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  stored_asset "media_assets"%ROWTYPE;
  frozen_reference JSONB;
  expected_ordinal INTEGER;
  snapshot_owner_user_id TEXT;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id"
    AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  WITH reference_occurrences AS (
    SELECT
      slot."ordinal" AS slot_ordinal,
      ref.ordinality AS reference_ordinal,
      ref.value AS reference
    FROM "ai_media_suite_slots" slot
    CROSS JOIN LATERAL jsonb_array_elements(slot."references_snapshot_json")
      WITH ORDINALITY AS ref(value, ordinality)
    WHERE slot."suite_id" = NEW."suite_id"
      AND slot."owner_user_id" = NEW."owner_user_id"
  ), first_candidates AS (
    SELECT DISTINCT ON (reference->>'candidateId')
      reference,
      slot_ordinal,
      reference_ordinal
    FROM reference_occurrences
    WHERE reference->>'candidateId' IS NOT NULL
    ORDER BY reference->>'candidateId', slot_ordinal, reference_ordinal
  ), ranked_candidates AS (
    SELECT
      reference,
      (row_number() OVER (ORDER BY slot_ordinal, reference_ordinal) - 1)::INTEGER AS candidate_ordinal
    FROM first_candidates
  )
  SELECT reference, candidate_ordinal
  INTO frozen_reference, expected_ordinal
  FROM ranked_candidates
  WHERE reference->>'candidateId' = NEW."candidate_id";

  SELECT * INTO stored_asset
  FROM "media_assets"
  WHERE "id" = NEW."asset_id"
    AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  SELECT subject."owner_user_id" INTO snapshot_owner_user_id
  FROM "source_capture_snapshots" snapshot
  JOIN "source_capture_subjects" subject ON subject."id" = snapshot."subject_id"
  WHERE snapshot."id" = stored_suite."source_capture_snapshot_id"
    AND snapshot."subject_id" = stored_suite."source_subject_id";

  IF stored_suite."id" IS NULL
    OR stored_asset."id" IS NULL
    OR frozen_reference IS NULL
    OR stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR stored_suite."revision" IS DISTINCT FROM 2
    OR NOT EXISTS (
      SELECT 1
      FROM "ai_media_suite_events" claimed
      WHERE claimed."suite_id" = NEW."suite_id"
        AND claimed."owner_user_id" = NEW."owner_user_id"
        AND claimed."revision" = 1
        AND claimed."event_type" = 'CLAIMED'
    )
    OR expected_ordinal IS DISTINCT FROM NEW."ordinal"
    OR snapshot_owner_user_id IS DISTINCT FROM NEW."owner_user_id"
    OR jsonb_typeof(frozen_reference->'source') IS DISTINCT FROM 'object'
    OR frozen_reference->>'candidateId' IS DISTINCT FROM NEW."candidate_id"
    OR frozen_reference #>> '{source,url}' IS DISTINCT FROM NEW."frozen_source_url"
    OR NULLIF(frozen_reference #>> '{source,contentHash}', '') IS DISTINCT FROM NEW."expected_content_hash"
    OR EXISTS (
      SELECT 1
      FROM "ai_media_suite_slots" slot
      CROSS JOIN LATERAL jsonb_array_elements(slot."references_snapshot_json") AS ref(value)
      WHERE slot."suite_id" = NEW."suite_id"
        AND slot."owner_user_id" = NEW."owner_user_id"
        AND ref.value->>'candidateId' = NEW."candidate_id"
        AND ref.value->'source' IS DISTINCT FROM frozen_reference->'source'
    )
    OR stored_asset."kind" IS DISTINCT FROM 'SOURCE_ORIGINAL'
    OR stored_asset."ai_image_job_id" IS NOT NULL
    OR stored_asset."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
    OR stored_asset."source_media_key" IS DISTINCT FROM NEW."candidate_id"
    OR stored_asset."source_url" IS DISTINCT FROM NEW."frozen_source_url"
    OR stored_asset."sha256" IS DISTINCT FROM NEW."asset_sha256"
    OR stored_asset."url" IS DISTINCT FROM NEW."asset_url"
    OR stored_asset."storage_backend" IS DISTINCT FROM NEW."storage_backend"
    OR stored_asset."storage_key" IS DISTINCT FROM NEW."storage_key"
    OR stored_asset."mime_type" IS DISTINCT FROM NEW."mime_type"
    OR (
      stored_asset."metadata" ? 'sourceMimeType'
      AND stored_asset."metadata"->>'sourceMimeType' NOT IN (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff'
      )
    )
    OR (
      NULLIF(frozen_reference #>> '{source,mimeType}', '') = 'image/png'
      AND stored_asset."mime_type" IS DISTINCT FROM 'image/png'
    )
    OR (
      NULLIF(frozen_reference #>> '{source,mimeType}', '') IS NOT NULL
      AND NULLIF(frozen_reference #>> '{source,mimeType}', '') <> 'image/png'
      AND stored_asset."mime_type" IS DISTINCT FROM 'image/jpeg'
    )
    OR (
      stored_asset."metadata" ? 'sourceMimeType'
      AND NULLIF(frozen_reference #>> '{source,mimeType}', '') IS NOT NULL
      AND stored_asset."metadata"->>'sourceMimeType'
        IS DISTINCT FROM NULLIF(frozen_reference #>> '{source,mimeType}', '')
    )
    OR stored_asset."size_bytes" IS DISTINCT FROM NEW."size_bytes"
    OR stored_asset."width" IS DISTINCT FROM NEW."width"
    OR stored_asset."height" IS DISTINCT FROM NEW."height"
    OR NEW."storage_backend" NOT IN ('local', 'oss')
    OR (
      stored_suite."provider" IS DISTINCT FROM 'fake'
      AND (NEW."storage_backend" IS DISTINCT FROM 'oss' OR NEW."asset_url" !~* '^https://')
    )
    OR stored_asset."metadata"->>'sourceCaptureHash' IS DISTINCT FROM stored_suite."source_capture_hash"
    OR (
      stored_asset."metadata" ? 'sourceSha256'
      AND stored_asset."metadata"->>'sourceSha256' IS DISTINCT FROM NEW."raw_source_sha256"
    )
    OR (
      NEW."expected_content_hash" IS NOT NULL
      AND NEW."expected_content_hash" IS DISTINCT FROM NEW."raw_source_sha256"
    )
  THEN
    RAISE EXCEPTION 'AI media suite reference asset provenance mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_reference_asset_validate_insert"
BEFORE INSERT ON "ai_media_suite_reference_assets"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_reference_asset_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_reference_asset_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media suite reference asset is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_reference_asset_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_suite_reference_assets"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_reference_asset_immutable();

CREATE OR REPLACE FUNCTION validate_ai_media_suite_slot_insert_after_claim() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  IF stored_suite."id" IS NULL
    OR stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR stored_suite."revision" IS DISTINCT FROM 1
    OR EXISTS (
      SELECT 1
      FROM "ai_media_suite_events" claimed
      WHERE claimed."suite_id" = NEW."suite_id"
        AND claimed."owner_user_id" = NEW."owner_user_id"
        AND claimed."revision" = 1
        AND claimed."event_type" = 'CLAIMED'
    )
  THEN
    RAISE EXCEPTION 'AI media suite slots can only be inserted by the initial claim' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_slot_insert_before_claim"
BEFORE INSERT ON "ai_media_suite_slots"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_slot_insert_after_claim();

CREATE OR REPLACE FUNCTION require_ai_media_suite_claimed_slot_set() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  claimed_event "ai_media_suite_events"%ROWTYPE;
  actual_count INTEGER;
  maximum_ordinal INTEGER;
  actual_slot_hashes JSONB;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  SELECT * INTO claimed_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = NEW."suite_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "revision" = 1
    AND "event_type" = 'CLAIMED';

  SELECT
    count(*)::INTEGER,
    max("ordinal"),
    COALESCE(jsonb_agg(to_jsonb("slot_hash") ORDER BY "ordinal"), '[]'::JSONB)
  INTO actual_count, maximum_ordinal, actual_slot_hashes
  FROM "ai_media_suite_slots"
  WHERE "suite_id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  IF stored_suite."id" IS NULL
    OR claimed_event."id" IS NULL
    OR claimed_event."actor_user_id" IS DISTINCT FROM stored_suite."actor_user_id"
    OR claimed_event."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-event/v1'
    OR claimed_event."payload"->>'planId' IS DISTINCT FROM stored_suite."plan_id"
    OR claimed_event."payload"->>'planVersionId' IS DISTINCT FROM stored_suite."plan_version_id"
    OR claimed_event."payload"->>'previewHash' IS DISTINCT FROM stored_suite."preview_hash"
    OR (claimed_event."payload"->>'itemCount')::INTEGER IS DISTINCT FROM stored_suite."item_count"
    OR claimed_event."payload"->'slotHashes' IS DISTINCT FROM actual_slot_hashes
    OR actual_count IS DISTINCT FROM stored_suite."item_count"
    OR maximum_ordinal IS DISTINCT FROM actual_count - 1
  THEN
    RAISE EXCEPTION 'AI media suite slots do not match the immutable claim' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_suite_claimed_slot_set"
AFTER INSERT ON "ai_media_suite_slots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_suite_claimed_slot_set();

CREATE CONSTRAINT TRIGGER "ai_media_suite_claim_event_slot_set"
AFTER INSERT ON "ai_media_suite_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."event_type" = 'CLAIMED')
EXECUTE FUNCTION require_ai_media_suite_claimed_slot_set();

CREATE OR REPLACE FUNCTION require_ai_media_suite_reference_set_event() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  reference_event "ai_media_suite_events"%ROWTYPE;
  actual_count INTEGER;
  maximum_ordinal INTEGER;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  SELECT * INTO reference_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = NEW."suite_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "revision" = stored_suite."revision"
    AND "event_type" = 'REFERENCES_INTERNALIZED';

  SELECT count(*)::INTEGER, max("ordinal")
  INTO actual_count, maximum_ordinal
  FROM "ai_media_suite_reference_assets"
  WHERE "suite_id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  IF stored_suite."id" IS NULL
    OR reference_event."id" IS NULL
    OR reference_event."payload"->>'version'
      IS DISTINCT FROM 'ai-image-suite-references-internalized/v1'
    OR reference_event."payload"->>'sourceSubjectId' IS DISTINCT FROM stored_suite."source_subject_id"
    OR reference_event."payload"->>'sourceCaptureSnapshotId'
      IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
    OR reference_event."payload"->>'sourceCaptureHash' IS DISTINCT FROM stored_suite."source_capture_hash"
    OR reference_event."payload"->>'sourceProfileHash' IS DISTINCT FROM stored_suite."source_profile_hash"
    OR reference_event."payload"->>'sourceSchemaVersion' IS DISTINCT FROM stored_suite."source_schema_version"
    OR (reference_event."payload"->>'referenceCount')::INTEGER IS DISTINCT FROM actual_count
    OR reference_event."payload"->>'referenceSetHash' !~ '^[a-f0-9]{64}$'
    OR actual_count < 1
    OR maximum_ordinal IS DISTINCT FROM actual_count - 1
  THEN
    RAISE EXCEPTION 'AI media suite reference set requires its exact audit event' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_suite_reference_set_event"
AFTER INSERT ON "ai_media_suite_reference_assets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_suite_reference_set_event();

CREATE CONSTRAINT TRIGGER "ai_media_suite_reference_event_set"
AFTER INSERT ON "ai_media_suite_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."event_type" = 'REFERENCES_INTERNALIZED')
EXECUTE FUNCTION require_ai_media_suite_reference_set_event();

CREATE OR REPLACE FUNCTION protect_referenced_media_asset_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."ai_image_job_id" IS DISTINCT FROM OLD."ai_image_job_id" THEN
    RAISE EXCEPTION 'media asset job binding is insert-time immutable' USING ERRCODE = '55000';
  END IF;

  IF (
    EXISTS (
      SELECT 1 FROM "ai_media_workflow_inputs"
      WHERE "asset_id" = OLD."id"
        AND "owner_user_id" = OLD."owner_user_id"
    )
    OR EXISTS (
      SELECT 1 FROM "media_asset_lineage"
      WHERE "owner_user_id" = OLD."owner_user_id"
        AND ("input_asset_id" = OLD."id" OR "output_asset_id" = OLD."id")
    )
    OR EXISTS (
      SELECT 1 FROM "ai_media_workflows"
      WHERE "selected_output_asset_id" = OLD."id"
        AND "owner_user_id" = OLD."owner_user_id"
    )
    OR EXISTS (
      SELECT 1 FROM "ai_media_workflow_events"
      WHERE "asset_id" = OLD."id"
        AND "owner_user_id" = OLD."owner_user_id"
    )
    OR EXISTS (
      SELECT 1 FROM "ai_media_suite_reference_assets"
      WHERE "asset_id" = OLD."id"
        AND "owner_user_id" = OLD."owner_user_id"
    )
  ) AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."ai_image_job_id" IS DISTINCT FROM OLD."ai_image_job_id"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM OLD."source_capture_snapshot_id"
    OR NEW."source_media_key" IS DISTINCT FROM OLD."source_media_key"
    OR NEW."source_url" IS DISTINCT FROM OLD."source_url"
    OR NEW."url" IS DISTINCT FROM OLD."url"
    OR NEW."storage_backend" IS DISTINCT FROM OLD."storage_backend"
    OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
    OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
    OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
    OR NEW."width" IS DISTINCT FROM OLD."width"
    OR NEW."height" IS DISTINCT FROM OLD."height"
    OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR (
      NEW."metadata" IS DISTINCT FROM OLD."metadata"
      AND EXISTS (
        SELECT 1 FROM "ai_media_suite_reference_assets"
        WHERE "asset_id" = OLD."id"
          AND "owner_user_id" = OLD."owner_user_id"
      )
    )
  ) THEN
    RAISE EXCEPTION 'referenced media asset identity is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "media_assets_referenced_identity_immutable" ON "media_assets";
CREATE TRIGGER "media_assets_referenced_identity_immutable"
BEFORE UPDATE OF
  "id",
  "owner_user_id",
  "ai_image_job_id",
  "kind",
  "source_capture_snapshot_id",
  "source_media_key",
  "source_url",
  "url",
  "storage_backend",
  "storage_key",
  "mime_type",
  "size_bytes",
  "width",
  "height",
  "sha256",
  "metadata",
  "created_at"
ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION protect_referenced_media_asset_identity();

COMMIT;
