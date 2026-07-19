BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION validate_ai_media_suite_materialization_event_insert() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  prompt_set "ai_media_suite_prompt_sets"%ROWTYPE;
BEGIN
  IF NEW."revision" = 4 AND NEW."event_type" IS DISTINCT FROM 'CHILDREN_MATERIALIZED' THEN
    RAISE EXCEPTION 'AI media suite revision 4 requires CHILDREN_MATERIALIZED event' USING ERRCODE = '23514';
  END IF;

  IF NEW."event_type" IS DISTINCT FROM 'CHILDREN_MATERIALIZED' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  SELECT * INTO prompt_set
  FROM "ai_media_suite_prompt_sets"
  WHERE "suite_id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  IF stored_suite."id" IS NULL
    OR stored_suite."revision" IS DISTINCT FROM 4
    OR stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR NEW."revision" IS DISTINCT FROM 4
    OR prompt_set."id" IS NULL
    OR NEW."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-children-materialized/v1'
    OR NEW."payload"->>'suiteId' IS DISTINCT FROM stored_suite."id"
    OR NEW."payload"->>'ownerUserId' IS DISTINCT FROM stored_suite."owner_user_id"
    OR NEW."payload"->>'actorUserId' IS DISTINCT FROM NEW."actor_user_id"
    OR NEW."payload"->>'slotCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR NEW."payload"->>'childCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR NEW."payload"->>'promptSetHash' IS DISTINCT FROM prompt_set."prompt_set_hash"
    OR NEW."payload"->>'referenceSetHash' IS DISTINCT FROM prompt_set."reference_set_hash"
    OR NEW."payload"->>'provider' IS DISTINCT FROM stored_suite."provider"
    OR NEW."payload"->>'model' IS DISTINCT FROM stored_suite."model"
    OR NEW."payload"->>'providerConfigHash' IS DISTINCT FROM stored_suite."provider_config_hash"
    OR NEW."payload"->>'pricingVersion' IS DISTINCT FROM stored_suite."pricing_version"
    OR NEW."payload"->>'operation' IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR NEW."payload"->>'outputProfile' IS DISTINCT FROM 'ozon-suite-3x4-900x1200/v1'
    OR NEW."payload"->>'width' IS DISTINCT FROM '900'
    OR NEW."payload"->>'height' IS DISTINCT FROM '1200'
    OR NEW."payload"->>'estimatedCostCents' IS DISTINCT FROM stored_suite."estimated_cost_cents"::TEXT
    OR NEW."payload"->>'maximumCostCents' IS DISTINCT FROM stored_suite."maximum_cost_cents"::TEXT
    OR char_length(COALESCE(NEW."payload"->>'operationKey', '')) NOT BETWEEN 8 AND 128
    OR COALESCE(NEW."payload"->>'requestFingerprint', '') !~ '^[a-f0-9]{64}$'
    OR COALESCE(NEW."payload"->>'materializationHash', '') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(NEW."payload"->'children') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload"->'children') IS DISTINCT FROM stored_suite."item_count"
  THEN
    RAISE EXCEPTION 'AI media suite materialization event authority mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_ai_media_suite_materialized_authority(
  target_suite_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  prompt_set "ai_media_suite_prompt_sets"%ROWTYPE;
  materialized_event "ai_media_suite_events"%ROWTYPE;
  invalid_slot_count INTEGER;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = target_suite_id AND "owner_user_id" = target_owner_user_id;

  IF stored_suite."id" IS NULL OR stored_suite."revision" IS DISTINCT FROM 4 THEN
    RETURN;
  END IF;

  SELECT * INTO prompt_set
  FROM "ai_media_suite_prompt_sets"
  WHERE "suite_id" = target_suite_id AND "owner_user_id" = target_owner_user_id;

  SELECT * INTO materialized_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = target_suite_id
    AND "owner_user_id" = target_owner_user_id
    AND "revision" = 4
    AND "event_type" = 'CHILDREN_MATERIALIZED';

  IF prompt_set."id" IS NULL
    OR materialized_event."id" IS NULL
    OR materialized_event."payload"->>'suiteId' IS DISTINCT FROM stored_suite."id"
    OR materialized_event."payload"->>'ownerUserId' IS DISTINCT FROM stored_suite."owner_user_id"
    OR materialized_event."payload"->>'actorUserId' IS DISTINCT FROM materialized_event."actor_user_id"
    OR materialized_event."payload"->>'promptSetHash' IS DISTINCT FROM prompt_set."prompt_set_hash"
    OR materialized_event."payload"->>'referenceSetHash' IS DISTINCT FROM prompt_set."reference_set_hash"
    OR materialized_event."payload"->>'provider' IS DISTINCT FROM stored_suite."provider"
    OR materialized_event."payload"->>'model' IS DISTINCT FROM stored_suite."model"
    OR materialized_event."payload"->>'providerConfigHash' IS DISTINCT FROM stored_suite."provider_config_hash"
    OR materialized_event."payload"->>'pricingVersion' IS DISTINCT FROM stored_suite."pricing_version"
    OR materialized_event."payload"->>'operation' IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR materialized_event."payload"->>'outputProfile' IS DISTINCT FROM 'ozon-suite-3x4-900x1200/v1'
    OR materialized_event."payload"->>'width' IS DISTINCT FROM '900'
    OR materialized_event."payload"->>'height' IS DISTINCT FROM '1200'
    OR materialized_event."payload"->>'slotCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR materialized_event."payload"->>'childCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR materialized_event."payload"->>'estimatedCostCents' IS DISTINCT FROM stored_suite."estimated_cost_cents"::TEXT
    OR materialized_event."payload"->>'maximumCostCents' IS DISTINCT FROM stored_suite."maximum_cost_cents"::TEXT
    OR char_length(COALESCE(materialized_event."payload"->>'operationKey', '')) NOT BETWEEN 8 AND 128
  THEN
    RAISE EXCEPTION 'AI media suite materialization authority is incomplete' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER
  INTO invalid_slot_count
  FROM "ai_media_suite_slots" slot
  LEFT JOIN "ai_media_workflows" workflow
    ON workflow."id" = slot."child_workflow_id"
   AND workflow."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_media_suite_slot_prompts" slot_prompt
    ON slot_prompt."slot_id" = slot."id"
   AND slot_prompt."suite_id" = slot."suite_id"
   AND slot_prompt."owner_user_id" = slot."owner_user_id"
  WHERE slot."suite_id" = target_suite_id
    AND slot."owner_user_id" = target_owner_user_id
    AND (
      workflow."id" IS NULL
      OR slot_prompt."id" IS NULL
      OR workflow."actor_user_id" IS DISTINCT FROM materialized_event."actor_user_id"
      OR (
        slot."ownership_level" = 'sku'
        AND workflow."context_sku_key" IS DISTINCT FROM slot."ownership_key"
      )
      OR (
        slot."ownership_level" = 'compatibility_group'
        AND workflow."context_sku_key" IS NOT NULL
      )
      OR NOT EXISTS (
        SELECT 1
        FROM "ai_image_jobs" child_job
        WHERE child_job."workflow_id" = workflow."id"
          AND child_job."owner_user_id" = slot."owner_user_id"
          AND child_job."workflow_attempt" = 1
          AND child_job."actor_user_id" IS NOT DISTINCT FROM materialized_event."actor_user_id"
          AND child_job."prompt" = slot_prompt."resolved_prompt"
          AND child_job."negative_prompt" = slot_prompt."resolved_negative_prompt"
          AND child_job."resolved_prompt" = slot_prompt."resolved_prompt"
          AND child_job."resolved_negative_prompt" = slot_prompt."resolved_negative_prompt"
          AND EXISTS (
            SELECT 1
            FROM "ai_cost_reservations" reservation
            WHERE reservation."job_id" = child_job."id"
              AND reservation."owner_user_id" = slot."owner_user_id"
              AND reservation."workflow_id" = workflow."id"
              AND reservation."actor_user_id" = materialized_event."actor_user_id"
          )
      )
    );

  IF invalid_slot_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite child authority does not match frozen slots' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_materialized_authority_from_suite() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_materialized_authority(NEW."id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_materialized_authority_from_slot() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_materialized_authority(NEW."suite_id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_materialized_authority_from_event() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_materialized_authority(NEW."suite_id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_suite_materialized_authority_from_suite"
AFTER UPDATE ON "ai_media_suites"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."revision" = 4)
EXECUTE FUNCTION require_ai_media_suite_materialized_authority_from_suite();

CREATE CONSTRAINT TRIGGER "ai_media_suite_materialized_authority_from_slot"
AFTER UPDATE OF "child_workflow_id" ON "ai_media_suite_slots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."child_workflow_id" IS NOT NULL)
EXECUTE FUNCTION require_ai_media_suite_materialized_authority_from_slot();

CREATE CONSTRAINT TRIGGER "ai_media_suite_materialized_authority_from_event"
AFTER INSERT ON "ai_media_suite_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."event_type" = 'CHILDREN_MATERIALIZED')
EXECUTE FUNCTION require_ai_media_suite_materialized_authority_from_event();

CREATE OR REPLACE FUNCTION prevent_ai_media_suite_revision_beyond_materialization() RETURNS trigger AS $$
BEGIN
  IF NEW."revision" > 4 THEN
    RAISE EXCEPTION 'AI media suite revision beyond materialization is not enabled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_materialization_revision_ceiling"
BEFORE UPDATE OF "revision" ON "ai_media_suites"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_media_suite_revision_beyond_materialization();

CREATE OR REPLACE FUNCTION prevent_ai_media_suite_bound_child_insert() RETURNS trigger AS $$
BEGIN
  IF NEW."workflow_id" IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "ai_media_suite_slots" slot
    JOIN "ai_media_suites" suite
      ON suite."id" = slot."suite_id"
     AND suite."owner_user_id" = slot."owner_user_id"
    WHERE slot."child_workflow_id" = NEW."workflow_id"
      AND slot."owner_user_id" = NEW."owner_user_id"
      AND suite."revision" >= 4
  ) THEN
    RAISE EXCEPTION 'materialized AI media suite child graph is append-closed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_suite_child_append_closed"
BEFORE INSERT ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_media_suite_bound_child_insert();

CREATE TRIGGER "ai_media_workflow_inputs_suite_child_append_closed"
BEFORE INSERT ON "ai_media_workflow_inputs"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_media_suite_bound_child_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_lifecycle() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_media_suite_slots" slot
    JOIN "ai_media_suites" suite
      ON suite."id" = slot."suite_id"
     AND suite."owner_user_id" = slot."owner_user_id"
    WHERE slot."child_workflow_id" = OLD."id"
      AND slot."owner_user_id" = OLD."owner_user_id"
      AND suite."revision" >= 4
  ) THEN
    RAISE EXCEPTION 'materialized AI media suite child lifecycle is parent-controlled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_workflows_suite_child_lifecycle_protected"
BEFORE UPDATE ON "ai_media_workflows"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_child_lifecycle();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_job_lifecycle() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_media_suite_slots" slot
    JOIN "ai_media_suites" suite
      ON suite."id" = slot."suite_id"
     AND suite."owner_user_id" = slot."owner_user_id"
    WHERE (
        (slot."child_workflow_id" = OLD."workflow_id" AND slot."owner_user_id" = OLD."owner_user_id")
        OR
        (slot."child_workflow_id" = NEW."workflow_id" AND slot."owner_user_id" = NEW."owner_user_id")
      )
      AND suite."revision" >= 4
  ) THEN
    RAISE EXCEPTION 'materialized AI media suite child job lifecycle is parent-controlled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_suite_child_lifecycle_protected"
BEFORE UPDATE ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_child_job_lifecycle();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_reservation_lifecycle() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_media_suite_slots" slot
    JOIN "ai_media_suites" suite
      ON suite."id" = slot."suite_id"
     AND suite."owner_user_id" = slot."owner_user_id"
    WHERE (
        (slot."child_workflow_id" = OLD."workflow_id" AND slot."owner_user_id" = OLD."owner_user_id")
        OR
        (
          TG_OP = 'UPDATE'
          AND slot."child_workflow_id" = NEW."workflow_id"
          AND slot."owner_user_id" = NEW."owner_user_id"
        )
      )
      AND suite."revision" >= 4
  ) THEN
    RAISE EXCEPTION 'materialized AI media suite cost reservation is parent-controlled' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_cost_reservations_suite_child_lifecycle_protected"
BEFORE UPDATE OR DELETE ON "ai_cost_reservations"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_child_reservation_lifecycle();

CREATE OR REPLACE FUNCTION prevent_ai_media_suite_child_output_before_dispatch() RETURNS trigger AS $$
BEGIN
  IF NEW."ai_image_job_id" IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "ai_image_jobs" child_job
    JOIN "ai_media_suite_slots" slot
      ON slot."child_workflow_id" = child_job."workflow_id"
     AND slot."owner_user_id" = child_job."owner_user_id"
    JOIN "ai_media_suites" suite
      ON suite."id" = slot."suite_id"
     AND suite."owner_user_id" = slot."owner_user_id"
    WHERE child_job."id" = NEW."ai_image_job_id"
      AND child_job."owner_user_id" = NEW."owner_user_id"
      AND suite."revision" >= 4
  ) THEN
    RAISE EXCEPTION 'AI media suite child output requires the dispatch contract' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_assets_suite_child_output_before_dispatch"
BEFORE INSERT OR UPDATE OF "ai_image_job_id" ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_media_suite_child_output_before_dispatch();

DO $$
DECLARE
  stored_suite RECORD;
BEGIN
  FOR stored_suite IN
    SELECT "id", "owner_user_id"
    FROM "ai_media_suites"
    WHERE "revision" = 4
  LOOP
    PERFORM assert_ai_media_suite_materialized_graph(stored_suite."id", stored_suite."owner_user_id");
    PERFORM assert_ai_media_suite_materialized_authority(stored_suite."id", stored_suite."owner_user_id");
  END LOOP;
END;
$$;

COMMIT;
