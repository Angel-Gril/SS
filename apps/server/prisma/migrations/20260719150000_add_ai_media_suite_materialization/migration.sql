BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Suite slot keys are canonical identifiers and may be up to 1024 characters.
-- Child workflow context must preserve the complete key rather than truncating it.
ALTER TABLE "ai_media_workflows"
  ALTER COLUMN "context_slot_key" TYPE VARCHAR(1024);

-- A child can only be attached while the suite is advancing through the
-- revision-4 materialization barrier. The complete graph is checked by the
-- deferred constraints below, so insertion order inside the transaction is
-- intentionally not prescribed here.
CREATE OR REPLACE FUNCTION require_ai_media_suite_frozen_prompts_for_child() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
BEGIN
  IF OLD."child_workflow_id" IS NULL AND NEW."child_workflow_id" IS NOT NULL THEN
    SELECT * INTO stored_suite
    FROM "ai_media_suites"
    WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

    IF stored_suite."id" IS NULL
      OR stored_suite."revision" IS DISTINCT FROM 4
      OR stored_suite."status" IS DISTINCT FROM 'PLANNED'
      OR NOT EXISTS (
        SELECT 1 FROM "ai_media_suite_events"
        WHERE "suite_id" = NEW."suite_id"
          AND "owner_user_id" = NEW."owner_user_id"
          AND "revision" = 3
          AND "event_type" = 'PROMPTS_FROZEN'
      )
      OR NOT EXISTS (
        SELECT 1 FROM "ai_media_suite_prompt_sets"
        WHERE "suite_id" = NEW."suite_id"
          AND "owner_user_id" = NEW."owner_user_id"
      )
      OR NOT EXISTS (
        SELECT 1 FROM "ai_media_suite_slot_prompts"
        WHERE "suite_id" = NEW."suite_id"
          AND "slot_id" = NEW."id"
          AND "owner_user_id" = NEW."owner_user_id"
      )
    THEN
      RAISE EXCEPTION 'child workflow requires frozen suite prompts (suite revision 4 required)' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Revision 4 has one meaning. This prevents an unrelated event from satisfying
-- the generic revision audit constraint and permanently stranding a suite.
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
    OR NEW."payload"->>'estimatedCostCents' IS DISTINCT FROM stored_suite."estimated_cost_cents"::TEXT
    OR NEW."payload"->>'maximumCostCents' IS DISTINCT FROM stored_suite."maximum_cost_cents"::TEXT
    OR COALESCE(NEW."payload"->>'operationKey', '') = ''
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

CREATE TRIGGER "ai_media_suite_materialization_event_validate"
BEFORE INSERT ON "ai_media_suite_events"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_materialization_event_insert();

CREATE OR REPLACE FUNCTION assert_ai_media_suite_materialized_graph(
  target_suite_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  prompt_set "ai_media_suite_prompt_sets"%ROWTYPE;
  materialized_event "ai_media_suite_events"%ROWTYPE;
  actual_slot_count INTEGER;
  bound_slot_count INTEGER;
  invalid_slot_count INTEGER;
  mismatched_child_count INTEGER;
  aggregate_estimated_cost BIGINT;
  aggregate_maximum_cost BIGINT;
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

  SELECT
    count(*)::INTEGER,
    count("child_workflow_id")::INTEGER,
    COALESCE(sum("estimated_cost_cents")::BIGINT, 0),
    COALESCE(sum("maximum_cost_cents")::BIGINT, 0)
  INTO actual_slot_count, bound_slot_count, aggregate_estimated_cost, aggregate_maximum_cost
  FROM "ai_media_suite_slots"
  WHERE "suite_id" = target_suite_id AND "owner_user_id" = target_owner_user_id;

  IF stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR prompt_set."id" IS NULL
    OR materialized_event."id" IS NULL
    OR actual_slot_count IS DISTINCT FROM stored_suite."item_count"
    OR bound_slot_count IS DISTINCT FROM stored_suite."item_count"
    OR aggregate_estimated_cost IS DISTINCT FROM stored_suite."estimated_cost_cents"::BIGINT
    OR aggregate_maximum_cost IS DISTINCT FROM stored_suite."maximum_cost_cents"::BIGINT
    OR prompt_set."slot_count" IS DISTINCT FROM stored_suite."item_count"
    OR materialized_event."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-children-materialized/v1'
    OR materialized_event."payload"->>'slotCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR materialized_event."payload"->>'childCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR materialized_event."payload"->>'promptSetHash' IS DISTINCT FROM prompt_set."prompt_set_hash"
    OR materialized_event."payload"->>'referenceSetHash' IS DISTINCT FROM prompt_set."reference_set_hash"
    OR materialized_event."payload"->>'provider' IS DISTINCT FROM stored_suite."provider"
    OR materialized_event."payload"->>'model' IS DISTINCT FROM stored_suite."model"
    OR materialized_event."payload"->>'providerConfigHash' IS DISTINCT FROM stored_suite."provider_config_hash"
    OR materialized_event."payload"->>'pricingVersion' IS DISTINCT FROM stored_suite."pricing_version"
    OR materialized_event."payload"->>'operation' IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR materialized_event."payload"->>'outputProfile' IS DISTINCT FROM 'ozon-suite-3x4-900x1200/v1'
    OR materialized_event."payload"->>'estimatedCostCents' IS DISTINCT FROM stored_suite."estimated_cost_cents"::TEXT
    OR materialized_event."payload"->>'maximumCostCents' IS DISTINCT FROM stored_suite."maximum_cost_cents"::TEXT
    OR COALESCE(materialized_event."payload"->>'requestFingerprint', '') !~ '^[a-f0-9]{64}$'
    OR COALESCE(materialized_event."payload"->>'materializationHash', '') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(materialized_event."payload"->'children') IS DISTINCT FROM 'array'
    OR jsonb_array_length(materialized_event."payload"->'children') IS DISTINCT FROM stored_suite."item_count"
  THEN
    RAISE EXCEPTION 'AI media suite materialized graph is incomplete' USING ERRCODE = '23514';
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
      slot."child_workflow_id" IS NULL
      OR slot."status" IS DISTINCT FROM 'PLANNED'
      OR slot."attempt" IS DISTINCT FROM 1
      OR slot."revision" IS DISTINCT FROM 2
      OR workflow."id" IS NULL
      OR workflow."operation" IS DISTINCT FROM 'IMAGE_TO_IMAGE'
      OR workflow."status" IS DISTINCT FROM 'QUEUED'
      OR workflow."review_status" IS DISTINCT FROM 'NOT_READY'
      OR workflow."revision" IS DISTINCT FROM 1
      OR workflow."current_attempt" IS DISTINCT FROM 1
      OR workflow."context_type" IS DISTINCT FROM stored_suite."context_type"
      OR workflow."context_id" IS DISTINCT FROM stored_suite."context_id"
      OR workflow."context_slot_key" IS DISTINCT FROM slot."slot_key"
      OR workflow."actor_user_id" IS NULL
      OR workflow."request_fingerprint" !~ '^[a-f0-9]{64}$'
      OR workflow."selected_output_asset_id" IS NOT NULL
      OR workflow."reviewed_by_user_id" IS NOT NULL
      OR workflow."reviewed_at" IS NOT NULL
      OR workflow."cancel_requested_at" IS NOT NULL
      OR workflow."completed_at" IS NOT NULL
      OR slot_prompt."id" IS NULL
      OR (SELECT count(*)::INTEGER
          FROM "ai_image_jobs" child_job
          WHERE child_job."workflow_id" = workflow."id"
            AND child_job."owner_user_id" = slot."owner_user_id") IS DISTINCT FROM 1
      OR NOT EXISTS (
        SELECT 1
        FROM "ai_image_jobs" child_job
        WHERE child_job."workflow_id" = workflow."id"
          AND child_job."owner_user_id" = slot."owner_user_id"
          AND child_job."workflow_attempt" = 1
          AND child_job."actor_user_id" IS NOT DISTINCT FROM workflow."actor_user_id"
          AND child_job."operation" = 'IMAGE_TO_IMAGE'
          AND child_job."status" = 'PENDING'
          AND child_job."provider" = stored_suite."provider"
          AND child_job."model" = stored_suite."model"
          AND child_job."request_fingerprint" = workflow."request_fingerprint"
          AND child_job."resolved_prompt" = slot_prompt."resolved_prompt"
          AND child_job."resolved_negative_prompt" = slot_prompt."resolved_negative_prompt"
          AND child_job."template_key" = slot_prompt."template_key"
          AND child_job."template_release_id" = slot_prompt."template_release_id"
          AND child_job."template_checksum" = slot_prompt."template_checksum"
          AND child_job."template_snapshot_json" = slot_prompt."template_snapshot_json"
          AND child_job."estimated_cost_cents" = slot."estimated_cost_cents"
          AND child_job."requested_image_count" = 1
          AND child_job."width" = 900
          AND child_job."height" = 1200
          AND child_job."attempt_count" = 0
          AND child_job."max_attempts" = 1
          AND child_job."progress" = 0
          AND child_job."provider_dispatched_at" IS NULL
          AND child_job."provider_job_id" IS NULL
          AND child_job."actual_cost_cents" IS NULL
          AND child_job."billed_units" = 0
          AND child_job."started_at" IS NULL
          AND child_job."completed_at" IS NULL
          AND jsonb_typeof(child_job."operation_config_json") = 'object'
          AND child_job."operation_config_json"->>'version' = 'ai-image-suite-child-operation/v1'
          AND child_job."operation_config_json"->>'outputProfile' = 'ozon-suite-3x4-900x1200/v1'
          AND child_job."operation_config_json"->>'width' = '900'
          AND child_job."operation_config_json"->>'height' = '1200'
          AND child_job."operation_config_json"->>'slotPromptId' = slot_prompt."id"
          AND child_job."operation_config_json"->>'promptBindingHash' = slot_prompt."binding_hash"
          AND child_job."operation_config_json"->>'referenceSetHash' = slot_prompt."reference_set_hash"
          AND jsonb_typeof(child_job."input_assets_json") = 'array'
          AND jsonb_array_length(child_job."input_assets_json") = (
            SELECT count(*)::INTEGER
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
          )
          AND (SELECT count(*)::INTEGER
               FROM "ai_cost_reservations" reservation
               WHERE reservation."job_id" = child_job."id"
                 AND reservation."owner_user_id" = slot."owner_user_id") = 1
          AND EXISTS (
            SELECT 1
            FROM "ai_cost_reservations" reservation
            WHERE reservation."job_id" = child_job."id"
              AND reservation."owner_user_id" = slot."owner_user_id"
              AND reservation."workflow_id" = workflow."id"
              AND reservation."actor_user_id" = workflow."actor_user_id"
              AND reservation."request_fingerprint" = workflow."request_fingerprint"
              AND reservation."provider" = stored_suite."provider"
              AND reservation."model" = stored_suite."model"
              AND reservation."operation" = 'IMAGE_TO_IMAGE'
              AND reservation."currency" = 'USD'
              AND reservation."estimated_cost_minor" = slot."estimated_cost_cents"
              AND reservation."maximum_cost_minor" = slot."maximum_cost_cents"
              AND reservation."status" = 'RESERVED'
              AND reservation."provider_request_id" IS NULL
              AND reservation."provider_accepted_at" IS NULL
              AND reservation."reconciliation_required_at" IS NULL
              AND reservation."settled_at" IS NULL
              AND reservation."released_at" IS NULL
          )
          AND (SELECT count(*)::INTEGER
               FROM "ai_media_workflow_inputs" workflow_input
               WHERE workflow_input."workflow_id" = workflow."id"
                 AND workflow_input."owner_user_id" = slot."owner_user_id") =
              CASE
                WHEN jsonb_typeof(slot."references_snapshot_json") = 'array'
                THEN jsonb_array_length(slot."references_snapshot_json")
                ELSE -1
              END
          AND COALESCE((
            SELECT max(workflow_input."ordinal")
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
          ), -1) = (
            SELECT count(*)::INTEGER - 1
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
              AND (
                workflow_input."role" IS DISTINCT FROM 'REFERENCE'
                OR NOT EXISTS (
                  SELECT 1
                  FROM "ai_media_suite_reference_assets" suite_reference
                  WHERE suite_reference."suite_id" = slot."suite_id"
                    AND suite_reference."owner_user_id" = slot."owner_user_id"
                    AND suite_reference."asset_id" = workflow_input."asset_id"
                    AND suite_reference."asset_sha256" = workflow_input."asset_sha256"
                    AND suite_reference."asset_url" = workflow_input."asset_url"
                    AND suite_reference."mime_type" = workflow_input."mime_type"
                    AND suite_reference."width" IS NOT DISTINCT FROM workflow_input."width"
                    AND suite_reference."height" IS NOT DISTINCT FROM workflow_input."height"
                    AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(slot."references_snapshot_json") WITH ORDINALITY AS frozen_reference(value, position)
                      WHERE frozen_reference.value->>'candidateId' = suite_reference."candidate_id"
                        AND frozen_reference.position - 1 = workflow_input."ordinal"
                    )
                )
                OR NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(child_job."input_assets_json") AS frozen_input(value)
                  WHERE frozen_input.value->>'assetId' = workflow_input."asset_id"
                    AND frozen_input.value->>'role' = workflow_input."role"::TEXT
                    AND frozen_input.value->>'ordinal' = workflow_input."ordinal"::TEXT
                    AND frozen_input.value->>'sha256' = workflow_input."asset_sha256"
                )
              )
          )
      )
    );

  IF invalid_slot_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite materialized child graph does not match frozen slots' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER
  INTO mismatched_child_count
  FROM jsonb_array_elements(materialized_event."payload"->'children') WITH ORDINALITY AS frozen_child(value, position)
  LEFT JOIN "ai_media_suite_slots" slot
    ON slot."suite_id" = target_suite_id
   AND slot."owner_user_id" = target_owner_user_id
   AND slot."ordinal" = frozen_child.position - 1
  LEFT JOIN "ai_media_workflows" workflow
    ON workflow."id" = slot."child_workflow_id"
   AND workflow."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_image_jobs" child_job
    ON child_job."workflow_id" = workflow."id"
   AND child_job."owner_user_id" = slot."owner_user_id"
   AND child_job."workflow_attempt" = 1
  LEFT JOIN "ai_cost_reservations" reservation
    ON reservation."job_id" = child_job."id"
   AND reservation."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_media_suite_slot_prompts" slot_prompt
    ON slot_prompt."slot_id" = slot."id"
   AND slot_prompt."suite_id" = slot."suite_id"
   AND slot_prompt."owner_user_id" = slot."owner_user_id"
  WHERE jsonb_typeof(frozen_child.value) IS DISTINCT FROM 'object'
    OR slot."id" IS NULL
    OR frozen_child.value->>'ordinal' IS DISTINCT FROM slot."ordinal"::TEXT
    OR frozen_child.value->>'slotId' IS DISTINCT FROM slot."id"
    OR frozen_child.value->>'slotKey' IS DISTINCT FROM slot."slot_key"
    OR frozen_child.value->>'slotPromptId' IS DISTINCT FROM slot_prompt."id"
    OR frozen_child.value->>'childWorkflowId' IS DISTINCT FROM workflow."id"
    OR frozen_child.value->>'jobId' IS DISTINCT FROM child_job."id"
    OR frozen_child.value->>'reservationId' IS DISTINCT FROM reservation."id"
    OR frozen_child.value->>'requestFingerprint' IS DISTINCT FROM workflow."request_fingerprint"
    OR frozen_child.value->>'promptBindingHash' IS DISTINCT FROM slot_prompt."binding_hash"
    OR COALESCE(frozen_child.value->>'bindingHash', '') !~ '^[a-f0-9]{64}$';

  IF mismatched_child_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite materialization event does not match child graph' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_materialized_graph_from_suite() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_materialized_graph(NEW."id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_materialized_graph_from_slot() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_materialized_graph(NEW."suite_id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_materialized_graph_from_event() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_materialized_graph(NEW."suite_id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_suite_materialized_graph"
AFTER UPDATE ON "ai_media_suites"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."revision" = 4)
EXECUTE FUNCTION require_ai_media_suite_materialized_graph_from_suite();

CREATE CONSTRAINT TRIGGER "ai_media_suite_materialized_slot_graph"
AFTER UPDATE OF "child_workflow_id" ON "ai_media_suite_slots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."child_workflow_id" IS NOT NULL)
EXECUTE FUNCTION require_ai_media_suite_materialized_graph_from_slot();

CREATE CONSTRAINT TRIGGER "ai_media_suite_materialized_event_graph"
AFTER INSERT ON "ai_media_suite_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."event_type" = 'CHILDREN_MATERIALIZED')
EXECUTE FUNCTION require_ai_media_suite_materialized_graph_from_event();

COMMIT;
