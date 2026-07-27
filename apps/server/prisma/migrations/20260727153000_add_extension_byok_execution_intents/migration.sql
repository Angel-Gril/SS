BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE "extension_byok_execution_batches" (
  "id" TEXT NOT NULL,
  "contract_version" VARCHAR(100) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "device_session_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "listing_workflow_id" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "source_platform" VARCHAR(20) NOT NULL,
  "source_product_id" VARCHAR(200) NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "supply_goods_id" TEXT NOT NULL,
  "first_assignment_ordinal" INTEGER NOT NULL,
  "item_count" SMALLINT NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "bound_draft_revision" INTEGER,
  "bound_draft_version" INTEGER,
  "bound_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "extension_byok_execution_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_byok_execution_batch_contract_check"
    CHECK ("contract_version" = 'extension-byok-execution-batch/v1'),
  CONSTRAINT "extension_byok_execution_batch_context_check"
    CHECK (
      "owner_user_id" = "actor_user_id"
      AND "draft_revision" > 0
      AND "draft_version" > 0
      AND "source_platform" IN ('1688', 'pdd', 'taobao', 'tmall')
      AND "first_assignment_ordinal" BETWEEN 0 AND 499
      AND "item_count" BETWEEN 1 AND 4
      AND "first_assignment_ordinal" + "item_count" <= 500
      AND "request_hash" ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT "extension_byok_execution_batch_status_check"
    CHECK (
      ("status" = 'OPEN'
        AND "bound_draft_revision" IS NULL
        AND "bound_draft_version" IS NULL
        AND "bound_at" IS NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'BOUND'
        AND "bound_draft_revision" = "draft_revision" + 1
        AND "bound_draft_version" = "draft_version" + 1
        AND "bound_at" IS NOT NULL
        AND "cancelled_at" IS NULL)
      OR ("status" = 'CANCELLED'
        AND "bound_draft_revision" IS NULL
        AND "bound_draft_version" IS NULL
        AND "bound_at" IS NULL
        AND "cancelled_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "extension_byok_execution_batch_owner_idempotency_key"
  ON "extension_byok_execution_batches"("owner_user_id", "idempotency_key");
CREATE UNIQUE INDEX "extension_byok_execution_batch_owner_request_hash_key"
  ON "extension_byok_execution_batches"("owner_user_id", "request_hash");
CREATE INDEX "extension_byok_execution_batch_draft_idx"
  ON "extension_byok_execution_batches"(
    "owner_user_id", "listing_workflow_id", "draft_revision", "draft_version", "status"
  );

ALTER TABLE "extension_byok_execution_batches"
  ADD CONSTRAINT "extension_byok_execution_batch_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_batches"
  ADD CONSTRAINT "extension_byok_execution_batch_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_batches"
  ADD CONSTRAINT "extension_byok_execution_batch_device_owner_fkey"
  FOREIGN KEY ("device_session_id", "owner_user_id")
  REFERENCES "extension_device_sessions"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "extension_byok_execution_batches"
  ADD CONSTRAINT "extension_byok_execution_batch_shop_owner_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_batches"
  ADD CONSTRAINT "extension_byok_execution_batch_workflow_owner_fkey"
  FOREIGN KEY ("listing_workflow_id", "owner_user_id")
  REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_batches"
  ADD CONSTRAINT "extension_byok_execution_batch_draft_fkey"
  FOREIGN KEY (
    "listing_workflow_id", "draft_revision", "owner_user_id", "draft_version"
  ) REFERENCES "source_listing_draft_versions"(
    "workflow_id", "revision", "owner_user_id", "draft_version"
  ) ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "extension_byok_execution_batch_items" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "listing_workflow_id" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "item_index" SMALLINT NOT NULL,
  "sku_key" VARCHAR(500) NOT NULL,
  "slot_key" VARCHAR(1024) NOT NULL,
  "assignment_ordinal" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "bound_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "extension_byok_execution_batch_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_byok_execution_batch_item_context_check"
    CHECK (
      "draft_revision" > 0
      AND "draft_version" > 0
      AND "item_index" BETWEEN 0 AND 3
      AND "assignment_ordinal" BETWEEN 0 AND 499
      AND (
        "slot_key" = 'sku:' || "sku_key" || ':hero'
        OR "slot_key" IN (
          'shared:detail:SCENE',
          'shared:detail:DETAIL',
          'shared:detail:SPEC',
          'shared:detail:PACKAGING'
        )
      )
    ),
  CONSTRAINT "extension_byok_execution_batch_item_status_check"
    CHECK (
      ("status" = 'ACTIVE' AND "bound_at" IS NULL AND "released_at" IS NULL)
      OR ("status" = 'BOUND' AND "bound_at" IS NOT NULL AND "released_at" IS NULL)
      OR ("status" = 'RELEASED' AND "bound_at" IS NULL AND "released_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "extension_byok_execution_batch_item_index_key"
  ON "extension_byok_execution_batch_items"("batch_id", "item_index");
CREATE UNIQUE INDEX "extension_byok_execution_batch_item_slot_key"
  ON "extension_byok_execution_batch_items"("batch_id", "slot_key");
CREATE UNIQUE INDEX "extension_byok_execution_batch_item_ordinal_key"
  ON "extension_byok_execution_batch_items"("batch_id", "assignment_ordinal");
CREATE UNIQUE INDEX "extension_byok_execution_batch_active_slot_key"
  ON "extension_byok_execution_batch_items"(
    "owner_user_id", "listing_workflow_id", "draft_revision", "draft_version", "slot_key"
  ) WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "extension_byok_execution_batch_active_ordinal_key"
  ON "extension_byok_execution_batch_items"(
    "owner_user_id", "listing_workflow_id", "draft_revision", "draft_version",
    "assignment_ordinal"
  ) WHERE "status" = 'ACTIVE';

ALTER TABLE "extension_byok_execution_batch_items"
  ADD CONSTRAINT "extension_byok_execution_batch_item_batch_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "extension_byok_execution_batches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "extension_byok_execution_intents" (
  "id" TEXT NOT NULL,
  "contract_version" VARCHAR(100) NOT NULL,
  "execution_mode" VARCHAR(20) NOT NULL DEFAULT 'BYOK',
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "device_session_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "listing_workflow_id" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "supply_goods_id" TEXT NOT NULL,
  "sku_key" VARCHAR(500) NOT NULL,
  "slot_key" VARCHAR(1024) NOT NULL,
  "assignment_mode" VARCHAR(20) NOT NULL DEFAULT 'APPEND',
  "assignment_ordinal" INTEGER NOT NULL,
  "policy_revision" INTEGER NOT NULL,
  "provider_origin_sha256" CHAR(64) NOT NULL,
  "model" VARCHAR(200) NOT NULL,
  "operation" "AiMediaOperation" NOT NULL,
  "request_mode" VARCHAR(20) NOT NULL,
  "provider_idempotency_key" VARCHAR(200) NOT NULL,
  "provider_request_hash" CHAR(64) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "execution_batch_item_id" TEXT,
  "execution_batch_attempt_index" SMALLINT,
  "outcome" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "provider_request_id_sha256" CHAR(64),
  "result_sha256" CHAR(64),
  "outcome_updated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "extension_byok_execution_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_byok_execution_intent_contract_check"
    CHECK ("contract_version" = 'extension-byok-execution-intent/v1'),
  CONSTRAINT "extension_byok_execution_intent_mode_check"
    CHECK ("execution_mode" = 'BYOK'),
  CONSTRAINT "extension_byok_execution_intent_context_check"
    CHECK (
      "owner_user_id" = "actor_user_id"
      AND "draft_revision" > 0
      AND "draft_version" > 0
      AND "assignment_mode" = 'APPEND'
      AND "assignment_ordinal" BETWEEN 0 AND 499
      AND "policy_revision" > 0
      AND (
        ("execution_batch_item_id" IS NULL AND "execution_batch_attempt_index" IS NULL)
        OR ("execution_batch_item_id" IS NOT NULL
          AND "execution_batch_attempt_index" BETWEEN 0 AND 499)
      )
      AND (
        "slot_key" = 'sku:' || "sku_key" || ':hero'
        OR "slot_key" IN (
          'shared:detail:SCENE',
          'shared:detail:DETAIL',
          'shared:detail:SPEC',
          'shared:detail:PACKAGING'
        )
      )
    ),
  CONSTRAINT "extension_byok_execution_intent_request_mode_check"
    CHECK (
      ("operation" = 'TEXT_TO_IMAGE' AND "request_mode" = 'json')
      OR ("operation" IN ('IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT')
        AND "request_mode" = 'multipart')
    ),
  CONSTRAINT "extension_byok_execution_intent_hash_check"
    CHECK (
      "provider_origin_sha256" ~ '^[a-f0-9]{64}$'
      AND "provider_request_hash" ~ '^[a-f0-9]{64}$'
      AND "request_hash" ~ '^[a-f0-9]{64}$'
      AND ("provider_request_id_sha256" IS NULL
        OR "provider_request_id_sha256" ~ '^[a-f0-9]{64}$')
      AND ("result_sha256" IS NULL OR "result_sha256" ~ '^[a-f0-9]{64}$')
    ),
  CONSTRAINT "extension_byok_execution_intent_outcome_check"
    CHECK (
      ("outcome" = 'PENDING'
        AND "provider_request_id_sha256" IS NULL
        AND "result_sha256" IS NULL
        AND "outcome_updated_at" IS NULL)
      OR ("outcome" = 'SUCCEEDED'
        AND "result_sha256" IS NOT NULL
        AND "outcome_updated_at" IS NOT NULL)
      OR ("outcome" IN ('FAILED_FINAL', 'UNKNOWN_OUTCOME')
        AND "result_sha256" IS NULL
        AND "outcome_updated_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "extension_byok_execution_intent_owner_provider_key"
  ON "extension_byok_execution_intents"("owner_user_id", "provider_idempotency_key");
CREATE UNIQUE INDEX "extension_byok_execution_intent_owner_request_hash_key"
  ON "extension_byok_execution_intents"("owner_user_id", "request_hash");
CREATE UNIQUE INDEX "extension_byok_execution_intent_batch_attempt_key"
  ON "extension_byok_execution_intents"(
    "execution_batch_item_id", "execution_batch_attempt_index"
  );
CREATE INDEX "extension_byok_execution_intent_device_idx"
  ON "extension_byok_execution_intents"("owner_user_id", "device_session_id", "created_at");
CREATE INDEX "extension_byok_execution_intent_draft_idx"
  ON "extension_byok_execution_intents"(
    "listing_workflow_id", "draft_revision", "draft_version", "outcome"
  );

CREATE OR REPLACE FUNCTION validate_extension_byok_execution_batch_item() RETURNS trigger AS $$
DECLARE
  reserved_batch RECORD;
BEGIN
  SELECT * INTO reserved_batch
  FROM "extension_byok_execution_batches"
  WHERE "id" = NEW."batch_id"
  FOR KEY SHARE;
  IF NOT FOUND
    OR reserved_batch."status" <> 'OPEN'
    OR reserved_batch."owner_user_id" IS DISTINCT FROM NEW."owner_user_id"
    OR reserved_batch."listing_workflow_id" IS DISTINCT FROM NEW."listing_workflow_id"
    OR reserved_batch."draft_revision" IS DISTINCT FROM NEW."draft_revision"
    OR reserved_batch."draft_version" IS DISTINCT FROM NEW."draft_version"
    OR NEW."item_index" < 0
    OR NEW."item_index" >= reserved_batch."item_count"
    OR NEW."assignment_ordinal"
      IS DISTINCT FROM reserved_batch."first_assignment_ordinal" + NEW."item_index"
    OR NEW."status" <> 'ACTIVE'
    OR NEW."bound_at" IS NOT NULL
    OR NEW."released_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'BYOK execution batch item does not match its open reservation'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_batch_item_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_execution_batch_item_insert_guard"
BEFORE INSERT ON "extension_byok_execution_batch_items"
FOR EACH ROW EXECUTE FUNCTION validate_extension_byok_execution_batch_item();

ALTER TABLE "extension_byok_execution_intents"
  ADD CONSTRAINT "extension_byok_execution_intent_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_intents"
  ADD CONSTRAINT "extension_byok_execution_intent_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_intents"
  ADD CONSTRAINT "extension_byok_execution_intent_device_owner_fkey"
  FOREIGN KEY ("device_session_id", "owner_user_id")
  REFERENCES "extension_device_sessions"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "extension_byok_execution_intents"
  ADD CONSTRAINT "extension_byok_execution_intent_shop_owner_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_intents"
  ADD CONSTRAINT "extension_byok_execution_intent_workflow_owner_fkey"
  FOREIGN KEY ("listing_workflow_id", "owner_user_id")
  REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_byok_execution_intents"
  ADD CONSTRAINT "extension_byok_execution_intent_draft_fkey"
  FOREIGN KEY (
    "listing_workflow_id", "draft_revision", "owner_user_id", "draft_version"
  ) REFERENCES "source_listing_draft_versions"(
    "workflow_id", "revision", "owner_user_id", "draft_version"
  ) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "extension_byok_execution_intents"
  ADD CONSTRAINT "extension_byok_execution_intent_batch_item_fkey"
  FOREIGN KEY ("execution_batch_item_id")
  REFERENCES "extension_byok_execution_batch_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_byok_media_provenance"
  ADD COLUMN "execution_intent_id" TEXT;
CREATE UNIQUE INDEX "extension_byok_media_provenance_execution_intent_key"
  ON "extension_byok_media_provenance"("execution_intent_id");
ALTER TABLE "extension_byok_media_provenance"
  ADD CONSTRAINT "extension_byok_media_provenance_execution_intent_fkey"
  FOREIGN KEY ("execution_intent_id") REFERENCES "extension_byok_execution_intents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION lock_extension_byok_execution_intent_mode() RETURNS trigger AS $$
DECLARE
  reserved RECORD;
  latest RECORD;
BEGIN
  IF NEW."outcome" <> 'PENDING'
    OR NEW."provider_request_id_sha256" IS NOT NULL
    OR NEW."result_sha256" IS NOT NULL
    OR NEW."outcome_updated_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'BYOK execution intent must start pending before Provider dispatch'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_intent_starts_pending';
  END IF;
  PERFORM claim_extension_ai_image_execution_mode(
    NEW."owner_user_id",
    NEW."shop_id",
    NEW."listing_workflow_id",
    NEW."draft_revision",
    NEW."draft_version",
    'BYOK'
  );
  IF NEW."execution_batch_item_id" IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM "extension_byok_execution_batch_items" item
      JOIN "extension_byok_execution_batches" batch ON batch."id" = item."batch_id"
      WHERE item."owner_user_id" = NEW."owner_user_id"
        AND item."listing_workflow_id" = NEW."listing_workflow_id"
        AND item."draft_revision" = NEW."draft_revision"
        AND item."draft_version" = NEW."draft_version"
        AND item."status" = 'ACTIVE'
        AND batch."status" = 'OPEN'
        AND (
          item."slot_key" = NEW."slot_key"
          OR item."assignment_ordinal" = NEW."assignment_ordinal"
        )
    ) THEN
      RAISE EXCEPTION 'BYOK standalone execution conflicts with an active batch reservation'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_intent_batch_reservation_conflict';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM "extension_byok_execution_intents" intent
      LEFT JOIN "extension_byok_media_provenance" provenance
        ON provenance."execution_intent_id" = intent."id"
      WHERE intent."owner_user_id" = NEW."owner_user_id"
        AND intent."listing_workflow_id" = NEW."listing_workflow_id"
        AND intent."draft_revision" = NEW."draft_revision"
        AND intent."draft_version" = NEW."draft_version"
        AND intent."execution_batch_item_id" IS NULL
        AND (
          intent."outcome" IN ('PENDING', 'UNKNOWN_OUTCOME')
          OR (intent."outcome" = 'SUCCEEDED' AND provenance."id" IS NULL)
        )
        AND (
          intent."slot_key" = NEW."slot_key"
          OR intent."assignment_ordinal" = NEW."assignment_ordinal"
        )
    ) THEN
      RAISE EXCEPTION 'BYOK batch execution conflicts with a standalone reservation'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_intent_standalone_reservation_conflict';
    END IF;
  END IF;
  IF NEW."execution_batch_item_id" IS NOT NULL THEN
    SELECT
      item.*,
      batch."status" AS "batch_status",
      batch."actor_user_id" AS "batch_actor_user_id",
      batch."device_session_id" AS "batch_device_session_id",
      batch."shop_id" AS "batch_shop_id",
      batch."source_capture_snapshot_id" AS "batch_source_capture_snapshot_id",
      batch."supply_goods_id" AS "batch_supply_goods_id"
    INTO reserved
    FROM "extension_byok_execution_batch_items" item
    JOIN "extension_byok_execution_batches" batch ON batch."id" = item."batch_id"
    WHERE item."id" = NEW."execution_batch_item_id"
    FOR KEY SHARE OF item, batch;
    IF NOT FOUND
      OR reserved."batch_status" <> 'OPEN'
      OR reserved."status" <> 'ACTIVE'
      OR reserved."owner_user_id" IS DISTINCT FROM NEW."owner_user_id"
      OR reserved."batch_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
      OR reserved."batch_device_session_id" IS DISTINCT FROM NEW."device_session_id"
      OR reserved."batch_shop_id" IS DISTINCT FROM NEW."shop_id"
      OR reserved."listing_workflow_id" IS DISTINCT FROM NEW."listing_workflow_id"
      OR reserved."draft_revision" IS DISTINCT FROM NEW."draft_revision"
      OR reserved."draft_version" IS DISTINCT FROM NEW."draft_version"
      OR reserved."batch_source_capture_snapshot_id"
        IS DISTINCT FROM NEW."source_capture_snapshot_id"
      OR reserved."batch_supply_goods_id" IS DISTINCT FROM NEW."supply_goods_id"
      OR reserved."sku_key" IS DISTINCT FROM NEW."sku_key"
      OR reserved."slot_key" IS DISTINCT FROM NEW."slot_key"
      OR reserved."assignment_ordinal" IS DISTINCT FROM NEW."assignment_ordinal"
    THEN
      RAISE EXCEPTION 'BYOK execution intent does not match its reserved batch item'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_intent_batch_item_mismatch';
    END IF;

    SELECT "id", "execution_batch_attempt_index", "outcome" INTO latest
    FROM "extension_byok_execution_intents"
    WHERE "execution_batch_item_id" = NEW."execution_batch_item_id"
    ORDER BY "execution_batch_attempt_index" DESC
    LIMIT 1
    FOR UPDATE;
    IF (NOT FOUND AND NEW."execution_batch_attempt_index" <> 0)
      OR (FOUND AND (
        NEW."execution_batch_attempt_index" <> latest."execution_batch_attempt_index" + 1
        OR latest."outcome" NOT IN ('FAILED_FINAL', 'SUCCEEDED')
      ))
    THEN
      RAISE EXCEPTION 'BYOK successor intent requires the latest known terminal attempt'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_intent_successor_blocked';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "extension_hosted_ai_image_plan_bindings" binding
    JOIN "ai_media_suites" suite
      ON suite."plan_id" = binding."plan_id"
     AND suite."owner_user_id" = binding."owner_user_id"
    WHERE binding."owner_user_id" = NEW."owner_user_id"
      AND binding."shop_id" = NEW."shop_id"
      AND binding."listing_workflow_id" = NEW."listing_workflow_id"
      AND binding."draft_revision" = NEW."draft_revision"
      AND binding."draft_version" = NEW."draft_version"
  ) THEN
    RAISE EXCEPTION 'ERP-hosted suite already owns this listing draft execution mode'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_ai_image_execution_mode_exclusive';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_execution_intent_mode_lock"
BEFORE INSERT ON "extension_byok_execution_intents"
FOR EACH ROW EXECUTE FUNCTION lock_extension_byok_execution_intent_mode();

CREATE OR REPLACE FUNCTION lock_extension_byok_execution_batch_mode() RETURNS trigger AS $$
BEGIN
  PERFORM claim_extension_ai_image_execution_mode(
    NEW."owner_user_id",
    NEW."shop_id",
    NEW."listing_workflow_id",
    NEW."draft_revision",
    NEW."draft_version",
    'BYOK'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_execution_batch_mode_lock"
BEFORE INSERT ON "extension_byok_execution_batches"
FOR EACH ROW EXECUTE FUNCTION lock_extension_byok_execution_batch_mode();

CREATE OR REPLACE FUNCTION enforce_extension_byok_execution_intent_outcome() RETURNS trigger AS $$
BEGIN
  IF (
    to_jsonb(NEW) - ARRAY[
      'outcome', 'provider_request_id_sha256', 'result_sha256',
      'outcome_updated_at', 'updated_at'
    ]::TEXT[]
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY[
      'outcome', 'provider_request_id_sha256', 'result_sha256',
      'outcome_updated_at', 'updated_at'
    ]::TEXT[]
  ) THEN
    RAISE EXCEPTION 'BYOK execution intent identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_intent_immutable';
  END IF;
  IF OLD."outcome" <> 'PENDING' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'BYOK execution intent outcome is absorbing'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_intent_outcome_absorbing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_execution_intent_outcome_guard"
BEFORE UPDATE ON "extension_byok_execution_intents"
FOR EACH ROW EXECUTE FUNCTION enforce_extension_byok_execution_intent_outcome();

CREATE OR REPLACE FUNCTION require_extension_byok_execution_intent_provenance() RETURNS trigger AS $$
DECLARE
  intent RECORD;
BEGIN
  IF NEW."execution_intent_id" IS NULL THEN
    RAISE EXCEPTION 'BYOK provenance requires a pre-dispatch execution intent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_media_provenance_execution_intent_required';
  END IF;
  SELECT * INTO intent
  FROM "extension_byok_execution_intents"
  WHERE "id" = NEW."execution_intent_id"
  FOR KEY SHARE;
  IF NOT FOUND
    OR intent."outcome" <> 'SUCCEEDED'
    OR intent."owner_user_id" IS DISTINCT FROM NEW."owner_user_id"
    OR intent."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
    OR intent."device_session_id" IS DISTINCT FROM NEW."device_session_id"
    OR intent."shop_id" IS DISTINCT FROM NEW."shop_id"
    OR intent."listing_workflow_id" IS DISTINCT FROM NEW."workflow_id"
    OR intent."draft_revision" IS DISTINCT FROM NEW."draft_revision"
    OR intent."draft_version" IS DISTINCT FROM NEW."draft_version"
    OR intent."sku_key" IS DISTINCT FROM NEW."sku_key"
    OR intent."slot_key" IS DISTINCT FROM NEW."slot_key"
    OR intent."assignment_ordinal" IS DISTINCT FROM NEW."assignment_ordinal"
    OR intent."policy_revision" IS DISTINCT FROM NEW."policy_revision"
    OR intent."provider_origin_sha256" IS DISTINCT FROM NEW."endpoint_origin_sha256"
    OR intent."model" IS DISTINCT FROM NEW."model"
    OR intent."operation" IS DISTINCT FROM NEW."operation"
    OR intent."provider_request_id_sha256" IS DISTINCT FROM NEW."provider_request_id_sha256"
  THEN
    RAISE EXCEPTION 'BYOK provenance execution intent does not match'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_media_provenance_execution_intent_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_media_provenance_execution_intent_guard"
BEFORE INSERT ON "extension_byok_media_provenance"
FOR EACH ROW EXECUTE FUNCTION require_extension_byok_execution_intent_provenance();

CREATE OR REPLACE FUNCTION enforce_extension_byok_execution_batch_item_state() RETURNS trigger AS $$
BEGIN
  IF (
    to_jsonb(NEW) - ARRAY['status', 'bound_at', 'released_at', 'updated_at']::TEXT[]
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY['status', 'bound_at', 'released_at', 'updated_at']::TEXT[]
  ) OR OLD."status" <> 'ACTIVE'
  THEN
    RAISE EXCEPTION 'BYOK execution batch item identity or terminal state is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_batch_item_immutable';
  END IF;
  IF NEW."status" = 'BOUND' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "extension_byok_execution_intents" intent
      JOIN "extension_byok_media_provenance" provenance
        ON provenance."execution_intent_id" = intent."id"
      WHERE intent."execution_batch_item_id" = OLD."id"
        AND intent."outcome" = 'SUCCEEDED'
        AND provenance."owner_user_id" = OLD."owner_user_id"
        AND provenance."workflow_id" = OLD."listing_workflow_id"
        AND provenance."draft_revision" = OLD."draft_revision"
        AND provenance."draft_version" = OLD."draft_version"
        AND provenance."slot_key" = OLD."slot_key"
        AND provenance."assignment_ordinal" = OLD."assignment_ordinal"
    ) THEN
      RAISE EXCEPTION 'BYOK execution batch item cannot bind without exact provenance'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_batch_item_bound_provenance';
    END IF;
  ELSIF NEW."status" = 'RELEASED' THEN
    IF EXISTS (
      SELECT 1
      FROM "extension_byok_execution_intents" intent
      WHERE intent."execution_batch_item_id" = OLD."id"
        AND intent."outcome" IN ('PENDING', 'UNKNOWN_OUTCOME')
    ) THEN
      RAISE EXCEPTION 'Pending or unknown BYOK attempts cannot release a reservation'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_batch_item_release_blocked';
    END IF;
  ELSE
    RAISE EXCEPTION 'BYOK execution batch item transition is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_batch_item_transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_execution_batch_item_state_guard"
BEFORE UPDATE ON "extension_byok_execution_batch_items"
FOR EACH ROW EXECUTE FUNCTION enforce_extension_byok_execution_batch_item_state();

CREATE OR REPLACE FUNCTION enforce_extension_byok_execution_batch_state() RETURNS trigger AS $$
BEGIN
  IF (
    to_jsonb(NEW) - ARRAY[
      'status', 'bound_draft_revision', 'bound_draft_version', 'bound_at',
      'cancelled_at', 'updated_at'
    ]::TEXT[]
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - ARRAY[
      'status', 'bound_draft_revision', 'bound_draft_version', 'bound_at',
      'cancelled_at', 'updated_at'
    ]::TEXT[]
  ) OR OLD."status" <> 'OPEN'
  THEN
    RAISE EXCEPTION 'BYOK execution batch identity or terminal state is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_batch_immutable';
  END IF;
  IF NEW."status" = 'BOUND' THEN
    IF (
      SELECT count(*)
      FROM "extension_byok_execution_batch_items" item
      WHERE item."batch_id" = OLD."id" AND item."status" = 'BOUND'
    ) <> OLD."item_count" THEN
      RAISE EXCEPTION 'BYOK execution batch cannot bind before every item is bound'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_batch_bound_items';
    END IF;
  ELSIF NEW."status" = 'CANCELLED' THEN
    IF EXISTS (
      SELECT 1
      FROM "extension_byok_execution_batch_items" item
      JOIN "extension_byok_execution_intents" intent
        ON intent."execution_batch_item_id" = item."id"
      WHERE item."batch_id" = OLD."id"
        AND intent."outcome" IN ('PENDING', 'UNKNOWN_OUTCOME')
    ) OR (
      SELECT count(*)
      FROM "extension_byok_execution_batch_items" item
      WHERE item."batch_id" = OLD."id" AND item."status" = 'RELEASED'
    ) <> OLD."item_count" THEN
      RAISE EXCEPTION 'BYOK execution batch has attempts that prevent cancellation'
        USING ERRCODE = '23514',
              CONSTRAINT = 'extension_byok_execution_batch_cancel_blocked';
    END IF;
  ELSE
    RAISE EXCEPTION 'BYOK execution batch transition is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_execution_batch_transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_execution_batch_state_guard"
BEFORE UPDATE ON "extension_byok_execution_batches"
FOR EACH ROW EXECUTE FUNCTION enforce_extension_byok_execution_batch_state();

-- Shared detail slots are product-level assignments. Replace the earlier
-- SKU-only authority validator without weakening the exact-key checks for
-- either assignment shape.
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
    RAISE EXCEPTION 'BYOK media provenance publish identity must be empty at creation'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "extension_device_sessions" session
    WHERE session."id" = NEW."device_session_id"
      AND session."owner_user_id" = NEW."owner_user_id"
      AND session."actor_user_id" = NEW."actor_user_id"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance device authority does not match actor and owner'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "source_listing_workflows" workflow
    WHERE workflow."id" = NEW."workflow_id"
      AND workflow."owner_user_id" = NEW."owner_user_id"
      AND workflow."shop_id" = NEW."shop_id"
  ) THEN
    RAISE EXCEPTION 'BYOK media provenance workflow authority does not match owner and shop'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'BYOK media provenance source draft authority is inconsistent'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'BYOK media provenance bound draft authority is inconsistent'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'BYOK media provenance source and bound snapshots differ'
      USING ERRCODE = '23514';
  END IF;

  expected_source := CASE
    WHEN NEW."operation" IN ('TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE') THEN 'GENERATED'
    WHEN NEW."operation" IN ('FULL_EDIT', 'INPAINT') THEN 'EDITED'
    ELSE NULL
  END;
  bound_assignment := bound_payload -> 'media' -> 'assignments' -> NEW."assignment_ordinal";
  IF expected_source IS NULL
    OR jsonb_typeof(bound_assignment) IS DISTINCT FROM 'object'
    OR bound_assignment->>'slotKey' IS DISTINCT FROM NEW."slot_key"
    OR bound_assignment->>'assetId' IS DISTINCT FROM NEW."asset_id"
    OR bound_assignment->>'source' IS DISTINCT FROM expected_source
  THEN
    RAISE EXCEPTION 'BYOK media provenance assignment is not present at the bound draft ordinal'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."slot_key" = 'sku:' || NEW."sku_key" || ':hero' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(bound_assignment)) <> 5
      OR bound_assignment->>'scope' IS DISTINCT FROM 'SKU'
      OR bound_assignment->>'skuKey' IS DISTINCT FROM NEW."sku_key"
    THEN
      RAISE EXCEPTION 'BYOK media provenance SKU assignment authority is inconsistent'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."slot_key" IN (
    'shared:detail:SCENE',
    'shared:detail:DETAIL',
    'shared:detail:SPEC',
    'shared:detail:PACKAGING'
  ) THEN
    IF (SELECT count(*) FROM jsonb_object_keys(bound_assignment)) <> 4
      OR bound_assignment->>'scope' IS DISTINCT FROM 'PRODUCT'
      OR bound_assignment ? 'skuKey'
    THEN
      RAISE EXCEPTION 'BYOK media provenance product assignment authority is inconsistent'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'BYOK media provenance slot authority is inconsistent'
      USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'BYOK media provenance asset identity is inconsistent'
      USING ERRCODE = '23514';
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
      FROM jsonb_array_elements(publish_payload -> 'media' -> 'assignments')
        AS media_assignment(value)
      WHERE jsonb_typeof(media_assignment.value) = 'object'
        AND media_assignment.value->>'slotKey' = NEW."slot_key"
        AND media_assignment.value->>'assetId' = NEW."asset_id"
        AND media_assignment.value->>'source' = expected_source
        AND (
          (
            NEW."slot_key" = 'sku:' || NEW."sku_key" || ':hero'
            AND (SELECT count(*) FROM jsonb_object_keys(media_assignment.value)) = 5
            AND media_assignment.value->>'scope' = 'SKU'
            AND media_assignment.value->>'skuKey' = NEW."sku_key"
          )
          OR (
            NEW."slot_key" IN (
              'shared:detail:SCENE',
              'shared:detail:DETAIL',
              'shared:detail:SPEC',
              'shared:detail:PACKAGING'
            )
            AND (SELECT count(*) FROM jsonb_object_keys(media_assignment.value)) = 4
            AND media_assignment.value->>'scope' = 'PRODUCT'
            AND NOT (media_assignment.value ? 'skuKey')
          )
        )
    ) THEN
      RAISE EXCEPTION 'BYOK media provenance publish intent no longer contains the bound assignment'
        USING ERRCODE = '23514';
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
    RAISE EXCEPTION 'BYOK media provenance publish intent and receipt are not the same publish command identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_extension_byok_batch_provenance_bound()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_item_id text;
  batch_item_status text;
  batch_status text;
BEGIN
  SELECT intent."execution_batch_item_id"
    INTO batch_item_id
  FROM "extension_byok_execution_intents" intent
  WHERE intent."id" = NEW."execution_intent_id";
  IF batch_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT item."status", batch."status"
    INTO batch_item_status, batch_status
  FROM "extension_byok_execution_batch_items" item
  JOIN "extension_byok_execution_batches" batch ON batch."id" = item."batch_id"
  WHERE item."id" = batch_item_id;
  IF NOT FOUND OR batch_item_status <> 'BOUND' OR batch_status <> 'BOUND' THEN
    RAISE EXCEPTION 'BYOK batch provenance requires an atomically bound reservation'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_byok_media_provenance_batch_bound';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "extension_byok_media_provenance_batch_bound_guard"
AFTER INSERT ON "extension_byok_media_provenance"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_extension_byok_batch_provenance_bound();

COMMIT;
