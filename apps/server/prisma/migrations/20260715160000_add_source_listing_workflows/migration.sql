ALTER TYPE "ExtensionDeviceRevocationReason"
  ADD VALUE IF NOT EXISTS 'WORKFLOW_VERSION_CHANGED';

BEGIN;

CREATE TYPE "SourceListingWorkflowStatus" AS ENUM (
  'ACTIVE', 'PAUSED', 'CANCELLED', 'RETRYABLE_FAILURE',
  'PERMANENT_FAILURE', 'MANUAL_REVIEW', 'COMPLETED'
);
CREATE TYPE "SourceListingDraftStatus" AS ENUM (
  'ACTIVE', 'PAUSED', 'CANCELLED', 'RETRYABLE_FAILURE',
  'PERMANENT_FAILURE', 'MANUAL_REVIEW', 'READY', 'PUBLISHED'
);

CREATE TABLE "source_listing_workflows" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "source_subject_id" TEXT NOT NULL,
  "current_source_capture_snapshot_id" TEXT NOT NULL,
  "legacy_supply_goods_id" TEXT,
  "supply_goods_id" TEXT,
  "selected_sku_keys" JSONB NOT NULL,
  "selected_sku_hash" TEXT NOT NULL,
  "current_revision" INTEGER NOT NULL,
  "current_draft_version" INTEGER NOT NULL,
  "stage" TEXT NOT NULL,
  "status" "SourceListingWorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_listing_workflows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_listing_workflow_version_check" CHECK (
    "current_revision" > 0 AND "current_draft_version" > 0
  ),
  CONSTRAINT "source_listing_workflow_stage_check" CHECK (
    "stage" = btrim("stage") AND length("stage") BETWEEN 1 AND 80
  ),
  CONSTRAINT "source_listing_workflow_hash_check" CHECK (
    "selected_sku_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "source_listing_workflow_sku_shape_check" CHECK (
    jsonb_typeof("selected_sku_keys") = 'array'
    AND jsonb_array_length("selected_sku_keys") BETWEEN 1 AND 1000
  )
);

CREATE TABLE "source_listing_draft_versions" (
  "id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "shop_id" TEXT NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "legacy_supply_goods_id" TEXT,
  "supply_goods_id" TEXT,
  "selected_sku_keys" JSONB NOT NULL,
  "selected_sku_hash" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "status" "SourceListingDraftStatus" NOT NULL DEFAULT 'ACTIVE',
  "payload" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "parent_revision" INTEGER,
  "invalidation_reasons" JSONB NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_listing_draft_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_listing_draft_version_check" CHECK (
    "draft_version" > 0
    AND (
      ("revision" = 1 AND "parent_revision" IS NULL)
      OR ("revision" > 1 AND "parent_revision" = "revision" - 1)
    )
  ),
  CONSTRAINT "source_listing_draft_stage_check" CHECK (
    "stage" = btrim("stage") AND length("stage") BETWEEN 1 AND 80
  ),
  CONSTRAINT "source_listing_draft_hash_check" CHECK (
    "selected_sku_hash" ~ '^[0-9a-f]{64}$'
    AND "payload_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "source_listing_draft_json_shape_check" CHECK (
    jsonb_typeof("selected_sku_keys") = 'array'
    AND jsonb_array_length("selected_sku_keys") BETWEEN 1 AND 1000
    AND jsonb_typeof("payload") = 'object'
    AND jsonb_typeof("invalidation_reasons") = 'array'
  )
);

CREATE TABLE "source_listing_workflow_events" (
  "id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_listing_workflow_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_listing_workflow_event_key_check" CHECK (
    "event_key" = btrim("event_key") AND length("event_key") BETWEEN 1 AND 200
  ),
  CONSTRAINT "source_listing_workflow_event_type_check" CHECK (
    "event_type" = btrim("event_type") AND length("event_type") BETWEEN 1 AND 100
  ),
  CONSTRAINT "source_listing_workflow_event_payload_check" CHECK (
    "draft_version" > 0 AND "revision" > 0
    AND jsonb_typeof("payload") = 'object' AND "payload_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "source_listing_publish_intents" (
  "id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_listing_publish_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_listing_publish_intent_version_check" CHECK (
    "draft_version" > 0 AND "revision" > 0
  ),
  CONSTRAINT "source_listing_publish_intent_key_check" CHECK (
    "idempotency_key" = btrim("idempotency_key")
    AND length("idempotency_key") BETWEEN 8 AND 200
  ),
  CONSTRAINT "source_listing_publish_intent_hash_check" CHECK (
    "payload_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "source_listing_workflow_owner_key"
  ON "source_listing_workflows"("id", "owner_user_id");
CREATE UNIQUE INDEX "source_listing_workflow_current_pointer_key"
  ON "source_listing_workflows"("id", "current_revision");
CREATE INDEX "source_listing_workflow_owner_status_idx"
  ON "source_listing_workflows"("owner_user_id", "status", "updated_at");
CREATE INDEX "source_listing_workflow_shop_status_idx"
  ON "source_listing_workflows"("shop_id", "status", "updated_at");
CREATE INDEX "source_listing_workflow_subject_idx"
  ON "source_listing_workflows"("source_subject_id", "updated_at");
CREATE INDEX "source_listing_workflow_identity_lookup_idx"
  ON "source_listing_workflows"(
    "owner_user_id", "shop_id", "supply_goods_id", "current_source_capture_snapshot_id",
    "selected_sku_hash", "status", "updated_at"
  );
CREATE UNIQUE INDEX "source_listing_draft_workflow_revision_key"
  ON "source_listing_draft_versions"("workflow_id", "revision");
CREATE INDEX "source_listing_draft_major_revision_idx"
  ON "source_listing_draft_versions"("workflow_id", "draft_version", "revision");
CREATE INDEX "source_listing_draft_owner_created_idx"
  ON "source_listing_draft_versions"("owner_user_id", "created_at");
CREATE INDEX "source_listing_draft_snapshot_idx"
  ON "source_listing_draft_versions"("source_capture_snapshot_id");
CREATE UNIQUE INDEX "source_listing_workflow_event_key"
  ON "source_listing_workflow_events"("event_key");
CREATE INDEX "source_listing_workflow_event_version_idx"
  ON "source_listing_workflow_events"("workflow_id", "draft_version", "revision", "created_at");
CREATE INDEX "source_listing_workflow_event_actor_idx"
  ON "source_listing_workflow_events"("actor_user_id", "created_at");
CREATE UNIQUE INDEX "source_listing_publish_intent_idempotency_key"
  ON "source_listing_publish_intents"("owner_user_id", "idempotency_key");
CREATE INDEX "source_listing_publish_intent_draft_idx"
  ON "source_listing_publish_intents"("workflow_id", "draft_version", "revision");
CREATE INDEX "source_listing_publish_intent_owner_idx"
  ON "source_listing_publish_intents"("owner_user_id", "created_at");

ALTER TABLE "source_listing_workflows"
  ADD CONSTRAINT "source_listing_workflow_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_workflows"
  ADD CONSTRAINT "source_listing_workflow_owner_shop_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_workflows"
  ADD CONSTRAINT "source_listing_workflow_subject_fkey"
  FOREIGN KEY ("source_subject_id") REFERENCES "source_capture_subjects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_workflows"
  ADD CONSTRAINT "source_listing_workflow_current_snapshot_fkey"
  FOREIGN KEY ("current_source_capture_snapshot_id") REFERENCES "source_capture_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_workflows"
  ADD CONSTRAINT "source_listing_workflow_legacy_goods_fkey"
  FOREIGN KEY ("legacy_supply_goods_id") REFERENCES "supply_goods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_workflows"
  ADD CONSTRAINT "source_listing_workflow_goods_fkey"
  FOREIGN KEY ("supply_goods_id") REFERENCES "supply_goods"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "source_listing_draft_versions"
  ADD CONSTRAINT "source_listing_draft_workflow_owner_fkey"
  FOREIGN KEY ("workflow_id", "owner_user_id")
  REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_draft_versions"
  ADD CONSTRAINT "source_listing_draft_snapshot_fkey"
  FOREIGN KEY ("source_capture_snapshot_id") REFERENCES "source_capture_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_draft_versions"
  ADD CONSTRAINT "source_listing_draft_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_draft_versions"
  ADD CONSTRAINT "source_listing_draft_parent_fkey"
  FOREIGN KEY ("workflow_id", "parent_revision")
  REFERENCES "source_listing_draft_versions"("workflow_id", "revision")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "source_listing_workflows"
  ADD CONSTRAINT "source_listing_workflow_current_draft_fkey"
  FOREIGN KEY ("id", "current_revision")
  REFERENCES "source_listing_draft_versions"("workflow_id", "revision")
  ON DELETE RESTRICT ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "source_listing_workflow_events"
  ADD CONSTRAINT "source_listing_workflow_event_workflow_owner_fkey"
  FOREIGN KEY ("workflow_id", "owner_user_id")
  REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_workflow_events"
  ADD CONSTRAINT "source_listing_workflow_event_draft_fkey"
  FOREIGN KEY ("workflow_id", "revision")
  REFERENCES "source_listing_draft_versions"("workflow_id", "revision")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "source_listing_publish_intents"
  ADD CONSTRAINT "source_listing_publish_intent_workflow_owner_fkey"
  FOREIGN KEY ("workflow_id", "owner_user_id")
  REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_publish_intents"
  ADD CONSTRAINT "source_listing_publish_intent_owner_shop_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_publish_intents"
  ADD CONSTRAINT "source_listing_publish_intent_draft_fkey"
  FOREIGN KEY ("workflow_id", "revision")
  REFERENCES "source_listing_draft_versions"("workflow_id", "revision")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_publish_intents"
  ADD CONSTRAINT "source_listing_publish_intent_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_publish_intents"
  ADD CONSTRAINT "source_listing_publish_intent_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_listing_workflow_events"
  ADD CONSTRAINT "source_listing_workflow_event_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION source_listing_sku_keys_are_canonical(keys JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  canonical JSONB;
BEGIN
  IF jsonb_typeof(keys) <> 'array' OR jsonb_array_length(keys) < 1 THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(keys) item
    WHERE jsonb_typeof(item) <> 'string'
      OR item #>> '{}' <> btrim(item #>> '{}')
      OR length(item #>> '{}') NOT BETWEEN 1 AND 200
  ) THEN
    RETURN FALSE;
  END IF;
  SELECT jsonb_agg(to_jsonb(value) ORDER BY value) INTO canonical
  FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(keys) value) normalized;
  RETURN canonical = keys;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION validate_source_listing_workflow_binding()
RETURNS trigger AS $$
DECLARE
  subject_owner TEXT;
  subject_legacy_goods TEXT;
  snapshot_subject TEXT;
  shop_owner TEXT;
  shop_platform TEXT;
  goods_owner TEXT;
BEGIN
  SELECT "owner_user_id", "legacy_supply_goods_id"
    INTO subject_owner, subject_legacy_goods
  FROM "source_capture_subjects" WHERE "id" = NEW."source_subject_id" FOR KEY SHARE;
  SELECT "subject_id" INTO snapshot_subject
  FROM "source_capture_snapshots" WHERE "id" = NEW."current_source_capture_snapshot_id" FOR KEY SHARE;
  IF subject_owner IS NULL OR subject_owner <> NEW."owner_user_id" THEN
    RAISE EXCEPTION 'source listing workflow source subject must belong to owner';
  END IF;
  IF snapshot_subject IS NULL OR snapshot_subject <> NEW."source_subject_id" THEN
    RAISE EXCEPTION 'source listing workflow snapshot must stay in the original source subject';
  END IF;
  SELECT "user_id", "platform"::text INTO shop_owner, shop_platform
  FROM "shops" WHERE "id" = NEW."shop_id" FOR KEY SHARE;
  IF shop_owner IS NULL OR shop_owner <> NEW."owner_user_id" OR shop_platform <> 'OZON' THEN
    RAISE EXCEPTION 'source listing workflow shop must be an owned Ozon shop';
  END IF;
  IF NEW."legacy_supply_goods_id" IS NOT NULL
    AND NEW."legacy_supply_goods_id" IS DISTINCT FROM subject_legacy_goods THEN
    RAISE EXCEPTION 'source listing workflow legacy projection lineage mismatch';
  END IF;
  IF NEW."supply_goods_id" IS NOT NULL THEN
    SELECT "user_id" INTO goods_owner FROM "supply_goods"
    WHERE "id" = NEW."supply_goods_id" FOR KEY SHARE;
    IF goods_owner IS NULL OR goods_owner <> NEW."owner_user_id" THEN
      RAISE EXCEPTION 'source listing workflow supply goods must belong to owner';
    END IF;
  END IF;
  IF NOT source_listing_sku_keys_are_canonical(NEW."selected_sku_keys") THEN
    RAISE EXCEPTION 'source listing selected SKU keys must be normalized, unique, and sorted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
      OR NEW."source_subject_id" IS DISTINCT FROM OLD."source_subject_id"
      OR NEW."legacy_supply_goods_id" IS DISTINCT FROM OLD."legacy_supply_goods_id"
      OR NEW."supply_goods_id" IS DISTINCT FROM OLD."supply_goods_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'source listing workflow identity is immutable';
    END IF;
    IF NEW."current_revision" <> OLD."current_revision" + 1 THEN
      RAISE EXCEPTION 'source listing workflow current revision must advance by one';
    END IF;
    IF NEW."current_draft_version" NOT IN (
      OLD."current_draft_version", OLD."current_draft_version" + 1
    ) THEN
      RAISE EXCEPTION 'source listing workflow draft version transition is invalid';
    END IF;
    IF (
      NEW."shop_id" IS DISTINCT FROM OLD."shop_id"
      OR NEW."current_source_capture_snapshot_id" IS DISTINCT FROM OLD."current_source_capture_snapshot_id"
      OR NEW."selected_sku_hash" IS DISTINCT FROM OLD."selected_sku_hash"
    ) AND NEW."current_draft_version" <> OLD."current_draft_version" + 1 THEN
      RAISE EXCEPTION 'source listing workflow identity change requires a new draft version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_source_listing_draft_version()
RETURNS trigger AS $$
DECLARE
  workflow_owner TEXT;
  workflow_subject TEXT;
  workflow_revision INTEGER;
  workflow_draft_version INTEGER;
  workflow_supply_goods TEXT;
  workflow_legacy_goods TEXT;
  snapshot_subject TEXT;
  snapshot_hash TEXT;
  shop_owner TEXT;
  shop_platform TEXT;
BEGIN
  SELECT "owner_user_id", "source_subject_id", "current_revision", "current_draft_version",
         "supply_goods_id", "legacy_supply_goods_id"
    INTO workflow_owner, workflow_subject, workflow_revision, workflow_draft_version,
         workflow_supply_goods, workflow_legacy_goods
  FROM "source_listing_workflows" WHERE "id" = NEW."workflow_id" FOR KEY SHARE;
  SELECT "subject_id", "capture_hash" INTO snapshot_subject, snapshot_hash
  FROM "source_capture_snapshots" WHERE "id" = NEW."source_capture_snapshot_id" FOR KEY SHARE;
  SELECT "user_id", "platform"::text INTO shop_owner, shop_platform
  FROM "shops" WHERE "id" = NEW."shop_id" FOR KEY SHARE;
  IF workflow_owner IS NULL OR workflow_owner <> NEW."owner_user_id"
    OR snapshot_subject IS NULL OR snapshot_subject <> workflow_subject
    OR NEW."supply_goods_id" IS DISTINCT FROM workflow_supply_goods
    OR NEW."legacy_supply_goods_id" IS DISTINCT FROM workflow_legacy_goods THEN
    RAISE EXCEPTION 'source listing draft identity does not match workflow lineage';
  END IF;
  IF shop_owner IS NULL OR shop_owner <> NEW."owner_user_id" OR shop_platform <> 'OZON' THEN
    RAISE EXCEPTION 'source listing draft shop must be an owned Ozon shop';
  END IF;
  IF (NEW."revision" = 1 AND (workflow_revision <> 1 OR NEW."draft_version" <> 1))
    OR (NEW."revision" > 1 AND (
      workflow_revision <> NEW."revision" - 1
      OR NEW."draft_version" NOT IN (workflow_draft_version, workflow_draft_version + 1)
    )) THEN
    RAISE EXCEPTION 'source listing draft revision transition is invalid';
  END IF;
  IF NOT source_listing_sku_keys_are_canonical(NEW."selected_sku_keys") THEN
    RAISE EXCEPTION 'source listing selected SKU keys must be normalized, unique, and sorted';
  END IF;
  IF NEW."payload"->>'id' IS DISTINCT FROM NEW."workflow_id"
    OR NEW."payload"->>'ownerUserId' IS DISTINCT FROM NEW."owner_user_id"
    OR NEW."payload"->>'shopId' IS DISTINCT FROM NEW."shop_id"
    OR NEW."payload"->>'supplyGoodsId' IS DISTINCT FROM NEW."supply_goods_id"
    OR NEW."payload"->>'sourceCaptureSnapshotId' IS DISTINCT FROM NEW."source_capture_snapshot_id"
    OR NEW."payload"->>'sourceCaptureHash' IS DISTINCT FROM snapshot_hash
    OR (NEW."payload"->>'revision')::integer IS DISTINCT FROM NEW."revision"
    OR (NEW."payload"->>'draftVersion')::integer IS DISTINCT FROM NEW."draft_version"
    OR NEW."payload"->'selectedSkuKeys' IS DISTINCT FROM NEW."selected_sku_keys" THEN
    RAISE EXCEPTION 'source listing draft payload does not match authoritative identity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_source_listing_draft_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source listing draft versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_source_listing_workflow_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source listing workflow events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_source_listing_workflow_event()
RETURNS trigger AS $$
DECLARE
  stored_owner TEXT;
  stored_draft_version INTEGER;
BEGIN
  SELECT "owner_user_id", "draft_version" INTO stored_owner, stored_draft_version
  FROM "source_listing_draft_versions"
  WHERE "workflow_id" = NEW."workflow_id" AND "revision" = NEW."revision"
  FOR KEY SHARE;
  IF stored_owner IS NULL OR stored_owner <> NEW."owner_user_id"
    OR stored_draft_version <> NEW."draft_version" THEN
    RAISE EXCEPTION 'source listing workflow event identity does not match draft';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_source_listing_publish_intent()
RETURNS trigger AS $$
DECLARE
  workflow_owner TEXT;
  workflow_shop TEXT;
  stored_draft_version INTEGER;
BEGIN
  SELECT "owner_user_id", "shop_id" INTO workflow_owner, workflow_shop
  FROM "source_listing_workflows" WHERE "id" = NEW."workflow_id" FOR KEY SHARE;
  SELECT "draft_version" INTO stored_draft_version
  FROM "source_listing_draft_versions"
  WHERE "workflow_id" = NEW."workflow_id" AND "revision" = NEW."revision"
  FOR KEY SHARE;
  IF workflow_owner IS NULL OR workflow_owner <> NEW."owner_user_id"
    OR workflow_shop <> NEW."shop_id"
    OR stored_draft_version IS NULL
    OR stored_draft_version <> NEW."draft_version" THEN
    RAISE EXCEPTION 'source listing publish intent identity does not match draft';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_source_listing_publish_intent_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source listing publish intents are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "source_listing_workflow_binding_validate"
BEFORE INSERT OR UPDATE ON "source_listing_workflows"
FOR EACH ROW EXECUTE FUNCTION validate_source_listing_workflow_binding();
CREATE TRIGGER "source_listing_draft_version_validate"
BEFORE INSERT ON "source_listing_draft_versions"
FOR EACH ROW EXECUTE FUNCTION validate_source_listing_draft_version();
CREATE TRIGGER "source_listing_draft_version_immutable"
BEFORE UPDATE OR DELETE ON "source_listing_draft_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_source_listing_draft_version_mutation();
CREATE TRIGGER "source_listing_workflow_event_immutable"
BEFORE UPDATE OR DELETE ON "source_listing_workflow_events"
FOR EACH ROW EXECUTE FUNCTION prevent_source_listing_workflow_event_mutation();
CREATE TRIGGER "source_listing_workflow_event_validate"
BEFORE INSERT ON "source_listing_workflow_events"
FOR EACH ROW EXECUTE FUNCTION validate_source_listing_workflow_event();
CREATE TRIGGER "source_listing_publish_intent_validate"
BEFORE INSERT ON "source_listing_publish_intents"
FOR EACH ROW EXECUTE FUNCTION validate_source_listing_publish_intent();
CREATE TRIGGER "source_listing_publish_intent_immutable"
BEFORE UPDATE OR DELETE ON "source_listing_publish_intents"
FOR EACH ROW EXECUTE FUNCTION prevent_source_listing_publish_intent_mutation();

COMMIT;
