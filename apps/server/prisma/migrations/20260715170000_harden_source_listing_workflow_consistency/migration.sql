BEGIN;

CREATE UNIQUE INDEX "source_listing_workflow_recoverable_identity_key"
ON "source_listing_workflows" (
  "owner_user_id",
  "shop_id",
  COALESCE("supply_goods_id", ''),
  "current_source_capture_snapshot_id",
  "selected_sku_hash"
)
WHERE "status" IN (
  'ACTIVE',
  'PAUSED',
  'RETRYABLE_FAILURE',
  'MANUAL_REVIEW'
);

CREATE OR REPLACE FUNCTION source_listing_workflow_current_projection_is_valid(target_workflow_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "source_listing_workflows" workflow
    JOIN "source_listing_draft_versions" draft
      ON draft."workflow_id" = workflow."id"
     AND draft."revision" = workflow."current_revision"
    WHERE workflow."id" = target_workflow_id
      AND draft."owner_user_id" = workflow."owner_user_id"
      AND draft."shop_id" = workflow."shop_id"
      AND draft."source_capture_snapshot_id" = workflow."current_source_capture_snapshot_id"
      AND draft."legacy_supply_goods_id" IS NOT DISTINCT FROM workflow."legacy_supply_goods_id"
      AND draft."supply_goods_id" IS NOT DISTINCT FROM workflow."supply_goods_id"
      AND draft."selected_sku_keys" = workflow."selected_sku_keys"
      AND draft."selected_sku_hash" = workflow."selected_sku_hash"
      AND draft."draft_version" = workflow."current_draft_version"
      AND draft."stage" = workflow."stage"
      AND draft."payload"->>'id' = workflow."id"
      AND draft."payload"->>'ownerUserId' = workflow."owner_user_id"
      AND draft."payload"->>'shopId' = workflow."shop_id"
      AND draft."payload"->>'sourceCaptureSnapshotId' = workflow."current_source_capture_snapshot_id"
      AND draft."payload"->>'supplyGoodsId' IS NOT DISTINCT FROM workflow."supply_goods_id"
      AND draft."payload"->'selectedSkuKeys' = workflow."selected_sku_keys"
      AND (draft."payload"->>'revision')::integer = workflow."current_revision"
      AND (draft."payload"->>'draftVersion')::integer = workflow."current_draft_version"
      AND draft."payload"->>'stage' = workflow."stage"
      AND workflow."status"::text = CASE
        WHEN draft."payload"->>'stage' = 'PUBLISHED' THEN 'COMPLETED'
        ELSE draft."payload"->>'runState'
      END
      AND draft."status"::text = CASE
        WHEN draft."payload"->>'stage' = 'PUBLISHED' THEN 'PUBLISHED'
        WHEN draft."payload"->>'stage' IN ('READY_TO_PUBLISH', 'PUBLISH_INTENT_RECORDED') THEN 'READY'
        ELSE draft."payload"->>'runState'
      END
  );
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  inconsistent_workflow_id TEXT;
BEGIN
  SELECT workflow."id" INTO inconsistent_workflow_id
  FROM "source_listing_workflows" workflow
  WHERE NOT source_listing_workflow_current_projection_is_valid(workflow."id")
  ORDER BY workflow."id"
  LIMIT 1;

  IF inconsistent_workflow_id IS NOT NULL THEN
    RAISE EXCEPTION 'source listing workflow current projection is inconsistent: %',
      inconsistent_workflow_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_source_listing_workflow_current_projection()
RETURNS trigger AS $$
BEGIN
  IF NOT source_listing_workflow_current_projection_is_valid(NEW."id") THEN
    RAISE EXCEPTION 'source listing workflow current projection does not match current draft'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "source_listing_workflow_current_projection_consistent"
  ON "source_listing_workflows";
CREATE CONSTRAINT TRIGGER "source_listing_workflow_current_projection_consistent"
AFTER INSERT OR UPDATE ON "source_listing_workflows"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_source_listing_workflow_current_projection();

CREATE OR REPLACE FUNCTION validate_source_listing_publish_intent()
RETURNS trigger AS $$
DECLARE
  workflow_owner TEXT;
  workflow_shop TEXT;
  workflow_revision INTEGER;
  workflow_draft_version INTEGER;
  draft_owner TEXT;
  draft_shop TEXT;
  stored_draft_version INTEGER;
BEGIN
  SELECT workflow."owner_user_id", workflow."shop_id", workflow."current_revision",
         workflow."current_draft_version", draft."owner_user_id", draft."shop_id",
         draft."draft_version"
    INTO workflow_owner, workflow_shop, workflow_revision, workflow_draft_version,
         draft_owner, draft_shop, stored_draft_version
  FROM "source_listing_workflows" workflow
  JOIN "source_listing_draft_versions" draft
    ON draft."workflow_id" = workflow."id"
   AND draft."revision" = NEW."revision"
  WHERE workflow."id" = NEW."workflow_id"
  FOR KEY SHARE OF workflow, draft;

  IF workflow_owner IS NULL
    OR workflow_owner <> NEW."owner_user_id"
    OR draft_owner <> NEW."owner_user_id"
    OR workflow_revision <> NEW."revision"
    OR workflow_draft_version <> NEW."draft_version"
    OR workflow_shop <> NEW."shop_id"
    OR draft_shop <> NEW."shop_id"
    OR stored_draft_version <> NEW."draft_version" THEN
    RAISE EXCEPTION 'source listing publish intent must reference the current owned draft revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
