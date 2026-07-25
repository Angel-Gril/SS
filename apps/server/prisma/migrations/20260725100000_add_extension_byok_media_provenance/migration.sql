BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION "extension_byok_identifier_safe"(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT value IS NOT NULL
    AND value !~ '[[:cntrl:]]'
    AND value !~ '[?#]'
    AND lower(value) NOT LIKE 'data:%'
    AND value !~* '(https?|ftp)://'
    AND value !~* '(^|[[:space:]:])authorization([[:space:]:=]|$)'
    AND value !~* '(^|[[:space:]:])bearer[[:space:]]+'
    AND value !~* '(api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)[[:space:]]*[:=]'
    AND value !~* '^(sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)[a-z0-9_-]+';
$$;

CREATE OR REPLACE FUNCTION "extension_byok_sha256_array_valid"(values_to_check TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    values_to_check IS NOT NULL
    AND cardinality(values_to_check) BETWEEN 0 AND 4
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(values_to_check) AS value
      WHERE value IS NULL OR value !~ '^[a-f0-9]{64}$'
    )
    AND cardinality(values_to_check) = (
      SELECT COUNT(DISTINCT value)
      FROM unnest(values_to_check) AS value
    );
$$;

CREATE TABLE "extension_byok_media_provenance" (
  "id" TEXT NOT NULL,
  "contract_version" VARCHAR(80) NOT NULL,
  "execution_mode" VARCHAR(20) NOT NULL DEFAULT 'BYOK',
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "device_session_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "sku_key" VARCHAR(1024) NOT NULL,
  "slot_key" VARCHAR(1024) NOT NULL,
  "endpoint_origin_sha256" CHAR(64) NOT NULL,
  "model" VARCHAR(200) NOT NULL,
  "operation" "AiMediaOperation" NOT NULL,
  "provider_request_id_sha256" CHAR(64),
  "prompt_sha256" CHAR(64) NOT NULL,
  "negative_prompt_sha256" CHAR(64),
  "source_sha256" CHAR(64),
  "reference_sha256s" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mask_sha256" CHAR(64),
  "result_sha256" CHAR(64) NOT NULL,
  "asset_id" TEXT NOT NULL,
  "result_mime_type" VARCHAR(32) NOT NULL,
  "result_width" INTEGER NOT NULL,
  "result_height" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "publish_intent_id" TEXT,
  "publish_receipt_id" TEXT,
  "erp_ai_charge_cents" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "extension_byok_media_provenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_byok_media_provenance_contract_version_check" CHECK (
    "contract_version" = 'extension-byok-media-provenance/v1'
  ),
  CONSTRAINT "extension_byok_media_provenance_execution_mode_check" CHECK (
    "execution_mode" = 'BYOK'
  ),
  CONSTRAINT "extension_byok_media_provenance_draft_identity_check" CHECK (
    "draft_revision" > 0 AND "draft_version" > 0
  ),
  CONSTRAINT "extension_byok_media_provenance_slot_identity_check" CHECK (
    length("sku_key") BETWEEN 1 AND 1024
    AND length("slot_key") BETWEEN 1 AND 1024
    AND btrim("sku_key") = "sku_key"
    AND btrim("slot_key") = "slot_key"
    AND "sku_key" !~ '[[:cntrl:]]'
    AND "slot_key" !~ '[[:cntrl:]]'
  ),
  CONSTRAINT "extension_byok_media_provenance_model_check" CHECK (
    length("model") BETWEEN 1 AND 200
    AND btrim("model") = "model"
    AND "model" !~ '[[:cntrl:]]'
  ),
  CONSTRAINT "extension_byok_media_provenance_identifier_safety_check" CHECK (
    "extension_byok_identifier_safe"("model")
    AND "extension_byok_identifier_safe"("sku_key")
    AND "extension_byok_identifier_safe"("slot_key")
    AND "extension_byok_identifier_safe"("idempotency_key")
  ),
  CONSTRAINT "extension_byok_media_provenance_hashes_check" CHECK (
    "endpoint_origin_sha256" ~ '^[a-f0-9]{64}$'
    AND ("provider_request_id_sha256" IS NULL OR "provider_request_id_sha256" ~ '^[a-f0-9]{64}$')
    AND "prompt_sha256" ~ '^[a-f0-9]{64}$'
    AND ("negative_prompt_sha256" IS NULL OR "negative_prompt_sha256" ~ '^[a-f0-9]{64}$')
    AND ("source_sha256" IS NULL OR "source_sha256" ~ '^[a-f0-9]{64}$')
    AND "extension_byok_sha256_array_valid"("reference_sha256s")
    AND ("mask_sha256" IS NULL OR "mask_sha256" ~ '^[a-f0-9]{64}$')
    AND "result_sha256" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "extension_byok_media_provenance_operation_check" CHECK (
    (
      "operation" = 'TEXT_TO_IMAGE'
      AND "source_sha256" IS NULL
      AND cardinality("reference_sha256s") = 0
      AND "mask_sha256" IS NULL
    )
    OR (
      "operation" = 'IMAGE_TO_IMAGE'
      AND "source_sha256" IS NULL
      AND cardinality("reference_sha256s") BETWEEN 1 AND 4
      AND "mask_sha256" IS NULL
    )
    OR (
      "operation" = 'FULL_EDIT'
      AND "source_sha256" IS NOT NULL
      AND "mask_sha256" IS NULL
    )
    OR (
      "operation" = 'INPAINT'
      AND "source_sha256" IS NOT NULL
      AND "mask_sha256" IS NOT NULL
    )
  ),
  CONSTRAINT "extension_byok_media_provenance_result_check" CHECK (
    "result_mime_type" IN ('image/png', 'image/jpeg', 'image/webp')
    AND "result_width" BETWEEN 1 AND 4096
    AND "result_height" BETWEEN 1 AND 4096
    AND "result_width"::BIGINT * "result_height"::BIGINT <= 16777216
  ),
  CONSTRAINT "extension_byok_media_provenance_idempotency_key_check" CHECK (
    length("idempotency_key") BETWEEN 16 AND 200
    AND btrim("idempotency_key") = "idempotency_key"
    AND "idempotency_key" !~ '[[:cntrl:]]'
  ),
  CONSTRAINT "extension_byok_media_provenance_request_hash_check" CHECK (
    "request_hash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "extension_byok_media_provenance_publish_binding_check" CHECK (
    "publish_receipt_id" IS NULL OR "publish_intent_id" IS NOT NULL
  ),
  CONSTRAINT "extension_byok_media_provenance_publish_command_identity_check" CHECK (
    ("publish_intent_id" IS NULL AND "publish_receipt_id" IS NULL)
    OR ("publish_intent_id" IS NOT NULL AND "publish_receipt_id" IS NOT NULL)
  ),
  CONSTRAINT "extension_byok_media_provenance_zero_charge_check" CHECK (
    "erp_ai_charge_cents" = 0
  ),
  CONSTRAINT "extension_byok_media_provenance_time_check" CHECK (
    "updated_at" >= "created_at"
  )
);

CREATE UNIQUE INDEX "extension_byok_media_provenance_owner_idempotency_key"
  ON "extension_byok_media_provenance"("owner_user_id", "idempotency_key");
CREATE UNIQUE INDEX "extension_byok_media_provenance_asset_owner_key"
  ON "extension_byok_media_provenance"("asset_id", "owner_user_id");
CREATE INDEX "extension_byok_media_provenance_owner_created_idx"
  ON "extension_byok_media_provenance"("owner_user_id", "created_at");
CREATE INDEX "extension_byok_media_provenance_device_created_idx"
  ON "extension_byok_media_provenance"("device_session_id", "created_at");
CREATE INDEX "extension_byok_media_provenance_shop_created_idx"
  ON "extension_byok_media_provenance"("shop_id", "created_at");
CREATE INDEX "extension_byok_media_provenance_draft_idx"
  ON "extension_byok_media_provenance"("workflow_id", "draft_version", "draft_revision");
CREATE INDEX "extension_byok_media_provenance_result_idx"
  ON "extension_byok_media_provenance"("result_sha256");
CREATE INDEX "extension_byok_media_provenance_publish_intent_idx"
  ON "extension_byok_media_provenance"("publish_intent_id");
CREATE INDEX "extension_byok_media_provenance_publish_receipt_idx"
  ON "extension_byok_media_provenance"("publish_receipt_id");

ALTER TABLE "extension_byok_media_provenance"
  ADD CONSTRAINT "extension_byok_media_provenance_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_byok_media_provenance_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_byok_media_provenance_device_session_fkey"
  FOREIGN KEY ("device_session_id") REFERENCES "extension_device_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_byok_media_provenance_shop_owner_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_byok_media_provenance_workflow_owner_fkey"
  FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "source_listing_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_byok_media_provenance_draft_fkey"
  FOREIGN KEY ("workflow_id", "draft_revision", "owner_user_id", "draft_version")
  REFERENCES "source_listing_draft_versions"("workflow_id", "revision", "owner_user_id", "draft_version")
  ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "extension_byok_media_provenance_asset_owner_fkey"
  FOREIGN KEY ("asset_id", "owner_user_id") REFERENCES "media_assets"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_byok_media_provenance_publish_intent_fkey"
  FOREIGN KEY ("publish_intent_id") REFERENCES "source_listing_publish_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_byok_media_provenance_publish_receipt_fkey"
  FOREIGN KEY ("publish_receipt_id") REFERENCES "extension_command_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "validate_extension_byok_media_provenance_authority"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
    RAISE EXCEPTION 'BYOK media provenance draft authority is inconsistent' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "media_assets" asset
    WHERE asset."id" = NEW."asset_id"
      AND asset."owner_user_id" = NEW."owner_user_id"
      AND asset."sha256" = NEW."result_sha256"
      AND asset."mime_type" = NEW."result_mime_type"
      AND asset."width" = NEW."result_width"
      AND asset."height" = NEW."result_height"
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance asset identity is inconsistent' USING ERRCODE = '23514';
  END IF;

  IF NEW."publish_intent_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "source_listing_publish_intents" intent
    WHERE intent."id" = NEW."publish_intent_id"
      AND intent."owner_user_id" = NEW."owner_user_id"
      AND intent."shop_id" = NEW."shop_id"
      AND intent."workflow_id" = NEW."workflow_id"
      AND intent."revision" = NEW."draft_revision"
      AND intent."draft_version" = NEW."draft_version"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance publish intent is inconsistent' USING ERRCODE = '23514';
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
      AND intent."revision" = NEW."draft_revision"
      AND intent."draft_version" = NEW."draft_version"
      AND intent."actor_user_id" = NEW."actor_user_id"
      AND command_session."id" = NEW."device_session_id"
      AND intent."actor_user_id" = command_session."actor_user_id"
      AND command_session."owner_user_id" = NEW."owner_user_id"
      AND command_grant."owner_user_id" = NEW."owner_user_id"
      AND command_grant."shop_id" = NEW."shop_id"
      AND command_grant."workflow_id" = NEW."workflow_id"
      AND command_grant."draft_version" = NEW."draft_version"
      AND command_grant."operation" = 'OZON_PUBLISH'
      AND command_grant."idempotency_key" = intent."idempotency_key"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance publish intent and receipt are not the same publish command identity' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "extension_byok_media_provenance_authority"
  BEFORE INSERT OR UPDATE ON "extension_byok_media_provenance"
  FOR EACH ROW EXECUTE FUNCTION "validate_extension_byok_media_provenance_authority"();

CREATE OR REPLACE FUNCTION "protect_extension_byok_media_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BYOK media provenance cannot be deleted' USING ERRCODE = '23514';
  END IF;

  IF (
    to_jsonb(NEW) - 'publish_intent_id' - 'publish_receipt_id' - 'updated_at'
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - 'publish_intent_id' - 'publish_receipt_id' - 'updated_at'
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance identity is immutable' USING ERRCODE = '23514';
  END IF;

  IF (OLD."publish_intent_id" IS NOT NULL AND NEW."publish_intent_id" IS DISTINCT FROM OLD."publish_intent_id")
    OR (OLD."publish_receipt_id" IS NOT NULL AND NEW."publish_receipt_id" IS DISTINCT FROM OLD."publish_receipt_id")
  THEN
    RAISE EXCEPTION 'BYOK media provenance publish identity cannot be replaced' USING ERRCODE = '23514';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION 'BYOK media provenance update time cannot move backwards' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "extension_byok_media_provenance_immutable"
  BEFORE UPDATE OR DELETE ON "extension_byok_media_provenance"
  FOR EACH ROW EXECUTE FUNCTION "protect_extension_byok_media_provenance"();

-- A provenance record is an immutable reference to the normalized media asset.
-- Extend the existing asset identity guard so a later URL/storage/hash/MIME
-- mutation cannot make the audit record point at different bytes.
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
    OR EXISTS (
      SELECT 1 FROM "extension_byok_media_provenance"
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
      AND (
        EXISTS (
          SELECT 1 FROM "ai_media_suite_reference_assets"
          WHERE "asset_id" = OLD."id"
            AND "owner_user_id" = OLD."owner_user_id"
        )
        OR EXISTS (
          SELECT 1 FROM "extension_byok_media_provenance"
          WHERE "asset_id" = OLD."id"
            AND "owner_user_id" = OLD."owner_user_id"
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'referenced media asset identity is immutable' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "media_assets_referenced_identity_immutable" ON "media_assets";
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
