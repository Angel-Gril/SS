BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TYPE "OzonPublisherRolloutBoundary" AS ENUM (
  'COLLECT_PUBLISH_OZON',
  'LISTING_BATCH',
  'LISTING_IMPORT_BY_SKU',
  'BROWSER_ONE_CLICK',
  'EXTENSION_ADAPTER'
);
CREATE TYPE "OzonPublisherRolloutStage" AS ENUM ('off', 'shadow', 'v2');

ALTER TABLE "system_configs"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "system_config_revision_check" CHECK ("revision" >= 0);

INSERT INTO "system_configs" (
  "id", "key", "value", "label", "group", "description",
  "created_at", "updated_at", "revision"
) VALUES
  ('ozon_rollout_stage_collect', 'source_ozon_publisher_collect_publish_stage', 'off',
   'Ozon collect publisher stage', 'source_workflow', 'Controlled rollout stage; use the dedicated CAS API.',
   transaction_timestamp()::timestamp(3), transaction_timestamp()::timestamp(3), 0),
  ('ozon_rollout_stage_listing_batch', 'source_ozon_publisher_listing_batch_stage', 'off',
   'Ozon listing batch stage', 'source_workflow', 'Controlled rollout stage; use the dedicated CAS API.',
   transaction_timestamp()::timestamp(3), transaction_timestamp()::timestamp(3), 0),
  ('ozon_rollout_stage_listing_sku', 'source_ozon_publisher_listing_import_by_sku_stage', 'off',
   'Ozon listing import-by-SKU stage', 'source_workflow', 'Controlled rollout stage; use the dedicated CAS API.',
   transaction_timestamp()::timestamp(3), transaction_timestamp()::timestamp(3), 0),
  ('ozon_rollout_stage_browser', 'source_ozon_publisher_browser_one_click_stage', 'off',
   'Ozon browser one-click stage', 'source_workflow', 'Controlled rollout stage; use the dedicated CAS API.',
   transaction_timestamp()::timestamp(3), transaction_timestamp()::timestamp(3), 0),
  ('ozon_rollout_stage_extension', 'source_ozon_publisher_extension_adapter_stage', 'off',
   'Ozon extension adapter stage', 'source_workflow', 'Controlled rollout stage; use the dedicated CAS API.',
   transaction_timestamp()::timestamp(3), transaction_timestamp()::timestamp(3), 0)
ON CONFLICT ("key") DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM "system_configs" WHERE "key" IN (
      'source_ozon_publisher_collect_publish_stage',
      'source_ozon_publisher_listing_batch_stage',
      'source_ozon_publisher_listing_import_by_sku_stage',
      'source_ozon_publisher_browser_one_click_stage',
      'source_ozon_publisher_extension_adapter_stage'
    )) <> 5
    OR EXISTS (SELECT 1 FROM "system_configs" WHERE "key" IN (
      'source_ozon_publisher_collect_publish_stage',
      'source_ozon_publisher_listing_batch_stage',
      'source_ozon_publisher_listing_import_by_sku_stage',
      'source_ozon_publisher_browser_one_click_stage',
      'source_ozon_publisher_extension_adapter_stage'
    ) AND ("value" <> 'off' OR "revision" <> 0)) THEN
    RAISE EXCEPTION 'Ozon publisher rollout stages must enter CAS control at off revision zero'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE TABLE "ozon_publisher_rollout_stage_transitions" (
  "id" TEXT NOT NULL,
  "boundary" "OzonPublisherRolloutBoundary" NOT NULL,
  "config_key" TEXT NOT NULL,
  "transition_version" INTEGER NOT NULL,
  "expected_revision" INTEGER NOT NULL,
  "transition_key" TEXT NOT NULL,
  "operation_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "from_stage" "OzonPublisherRolloutStage" NOT NULL,
  "result_stage" "OzonPublisherRolloutStage" NOT NULL,
  "gate_id" TEXT,
  "rollout_revision_snapshot" TEXT,
  "gate_state_version_snapshot" INTEGER,
  "evidence_hash_snapshot" TEXT,
  "evaluation_hash_snapshot" TEXT,
  "actor_user_id" TEXT NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publisher_rollout_stage_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_rollout_stage_transition_key" UNIQUE ("transition_key"),
  CONSTRAINT "ozon_publisher_rollout_stage_transition_version_key"
    UNIQUE ("config_key", "transition_version"),
  CONSTRAINT "ozon_publisher_rollout_stage_transition_operation_key"
    UNIQUE ("config_key", "operation_key"),
  CONSTRAINT "ozon_publisher_rollout_stage_transition_gate_fkey"
    FOREIGN KEY ("gate_id") REFERENCES "ozon_publisher_rollout_gates"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_stage_transition_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_stage_transition_shape_check" CHECK (
    length(btrim("id")) BETWEEN 1 AND 200
    AND length(btrim("config_key")) BETWEEN 1 AND 200
    AND "transition_version" = "expected_revision" + 1
    AND "expected_revision" >= 0
    AND length(btrim("transition_key")) BETWEEN 16 AND 200
    AND length(btrim("operation_key")) BETWEEN 16 AND 200
    AND "request_hash" ~ '^[0-9a-f]{64}$'
    AND length(btrim("actor_user_id")) BETWEEN 1 AND 200
    AND length(btrim("reason")) BETWEEN 3 AND 1000
    AND "config_key" = CASE "boundary"
      WHEN 'COLLECT_PUBLISH_OZON' THEN 'source_ozon_publisher_collect_publish_stage'
      WHEN 'LISTING_BATCH' THEN 'source_ozon_publisher_listing_batch_stage'
      WHEN 'LISTING_IMPORT_BY_SKU' THEN 'source_ozon_publisher_listing_import_by_sku_stage'
      WHEN 'BROWSER_ONE_CLICK' THEN 'source_ozon_publisher_browser_one_click_stage'
      WHEN 'EXTENSION_ADAPTER' THEN 'source_ozon_publisher_extension_adapter_stage'
    END
    AND (
      ("from_stage" = 'shadow' AND "result_stage" = 'v2'
        AND "boundary" <> 'EXTENSION_ADAPTER'
        AND "gate_id" IS NOT NULL
        AND length(btrim("rollout_revision_snapshot")) BETWEEN 1 AND 200
        AND "gate_state_version_snapshot" = 1
        AND "evidence_hash_snapshot" ~ '^[0-9a-f]{64}$'
        AND "evaluation_hash_snapshot" ~ '^[0-9a-f]{64}$')
      OR (("from_stage", "result_stage") IN (
          ('off', 'shadow'), ('shadow', 'off'), ('v2', 'shadow'), ('v2', 'off')
        )
        AND "gate_id" IS NULL
        AND "rollout_revision_snapshot" IS NULL
        AND "gate_state_version_snapshot" IS NULL
        AND "evidence_hash_snapshot" IS NULL
        AND "evaluation_hash_snapshot" IS NULL)
    )
  )
);

CREATE INDEX "ozon_publisher_rollout_stage_transition_config_idx"
  ON "ozon_publisher_rollout_stage_transitions"("config_key", "created_at");
CREATE INDEX "ozon_publisher_rollout_stage_transition_gate_idx"
  ON "ozon_publisher_rollout_stage_transitions"("gate_id", "created_at");
CREATE INDEX "ozon_publisher_rollout_stage_transition_actor_idx"
  ON "ozon_publisher_rollout_stage_transitions"("actor_user_id", "created_at");

CREATE FUNCTION "validate_ozon_publisher_rollout_stage_transition"() RETURNS trigger AS $$
DECLARE config_row "system_configs"%ROWTYPE;
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
BEGIN
  IF NEW."decided_at" IS DISTINCT FROM db_now OR NEW."created_at" IS DISTINCT FROM db_now THEN
    RAISE EXCEPTION 'Ozon publisher rollout stage transitions cannot be backdated'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO config_row FROM "system_configs" WHERE "key" = NEW."config_key" FOR KEY SHARE;
  IF NOT FOUND OR config_row."revision" IS DISTINCT FROM NEW."transition_version"
    OR config_row."value" IS DISTINCT FROM NEW."result_stage"::TEXT THEN
    RAISE EXCEPTION 'Ozon publisher rollout stage transition does not match the CAS result'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."result_stage" = 'v2' THEN
    SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates"
     WHERE "id" = NEW."gate_id" FOR KEY SHARE;
    IF NOT FOUND OR gate_row."state" <> 'READY'
      OR gate_row."state_version" IS DISTINCT FROM NEW."gate_state_version_snapshot"
      OR gate_row."rollout_revision" IS DISTINCT FROM NEW."rollout_revision_snapshot"
      OR gate_row."evidence_hash" IS DISTINCT FROM NEW."evidence_hash_snapshot"
      OR gate_row."evaluation_hash" IS DISTINCT FROM NEW."evaluation_hash_snapshot"
      OR NOT (
        (NEW."boundary" IN ('COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU')
          AND gate_row."writer_entrypoint"::TEXT = NEW."boundary"::TEXT
          AND gate_row."origin_channel" = 'DIRECT')
        OR (NEW."boundary" = 'BROWSER_ONE_CLICK'
          AND gate_row."writer_entrypoint" = 'COLLECT_PUBLISH_OZON'
          AND gate_row."origin_channel" = 'BROWSER_ONE_CLICK')
      ) THEN
      RAISE EXCEPTION 'Ozon publisher rollout v2 stage requires the exact READY gate'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publisher_rollout_stage_transition_validate"
  BEFORE INSERT ON "ozon_publisher_rollout_stage_transitions"
  FOR EACH ROW EXECUTE FUNCTION "validate_ozon_publisher_rollout_stage_transition"();

CREATE FUNCTION "validate_ozon_publisher_rollout_stage_config_update"() RETURNS trigger AS $$
DECLARE db_now TIMESTAMP(3) := transaction_timestamp()::TIMESTAMP(3);
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."key" IS DISTINCT FROM OLD."key"
    OR NEW."label" IS DISTINCT FROM OLD."label" OR NEW."group" IS DISTINCT FROM OLD."group"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."updated_at" IS DISTINCT FROM db_now
    OR NEW."revision" IS DISTINCT FROM OLD."revision" + 1
    OR OLD."value" NOT IN ('off', 'shadow', 'v2') OR NEW."value" NOT IN ('off', 'shadow', 'v2')
    OR NOT EXISTS (
      SELECT 1 FROM "ozon_publisher_rollout_stage_transitions" t
       WHERE t."config_key" = NEW."key"
         AND t."expected_revision" = OLD."revision"
         AND t."transition_version" = NEW."revision"
         AND t."from_stage"::TEXT = OLD."value"
         AND t."result_stage"::TEXT = NEW."value"
    ) THEN
    RAISE EXCEPTION 'Protected Ozon publisher rollout stage update requires an exact immutable CAS event'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ozon_publisher_rollout_stage_config_cas_event"
  AFTER UPDATE ON "system_configs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD."key" IN (
    'source_ozon_publisher_collect_publish_stage',
    'source_ozon_publisher_listing_batch_stage',
    'source_ozon_publisher_listing_import_by_sku_stage',
    'source_ozon_publisher_browser_one_click_stage',
    'source_ozon_publisher_extension_adapter_stage'
  )) EXECUTE FUNCTION "validate_ozon_publisher_rollout_stage_config_update"();

CREATE FUNCTION "reject_ozon_publisher_rollout_stage_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Protected Ozon publisher rollout stage rows cannot be deleted'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publisher_rollout_stage_delete_protected"
  BEFORE DELETE ON "system_configs"
  FOR EACH ROW WHEN (OLD."key" IN (
    'source_ozon_publisher_collect_publish_stage',
    'source_ozon_publisher_listing_batch_stage',
    'source_ozon_publisher_listing_import_by_sku_stage',
    'source_ozon_publisher_browser_one_click_stage',
    'source_ozon_publisher_extension_adapter_stage'
  )) EXECUTE FUNCTION "reject_ozon_publisher_rollout_stage_delete"();

CREATE FUNCTION "reject_ozon_publisher_rollout_stage_transition_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ozon publisher rollout stage transition history is immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publisher_rollout_stage_transition_immutable"
  BEFORE UPDATE OR DELETE ON "ozon_publisher_rollout_stage_transitions"
  FOR EACH ROW EXECUTE FUNCTION "reject_ozon_publisher_rollout_stage_transition_mutation"();

COMMIT;
