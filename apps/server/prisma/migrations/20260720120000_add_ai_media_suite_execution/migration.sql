BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Revision 4 remains the immutable materialization barrier. Revision 5 opens
-- execution with one audited dispatch; later revisions are parent aggregates.
DROP TRIGGER "ai_media_suite_materialization_revision_ceiling" ON "ai_media_suites";
DROP FUNCTION prevent_ai_media_suite_revision_beyond_materialization();

ALTER TABLE "ai_media_suite_slots"
  ADD COLUMN "execution_claim_token" CHAR(64),
  ADD COLUMN "execution_lease_expires_at" TIMESTAMP(3),
  ADD CONSTRAINT "ai_media_suite_slot_execution_claim_check" CHECK (
    ("execution_claim_token" IS NULL) = ("execution_lease_expires_at" IS NULL)
    AND ("execution_claim_token" IS NULL OR "execution_claim_token" ~ '^[a-f0-9]{64}$')
    AND (
      "status" IN ('RUNNING', 'CANCEL_REQUESTED')
      OR ("execution_claim_token" IS NULL AND "execution_lease_expires_at" IS NULL)
    )
    AND (
      "status" <> 'RUNNING'
      OR ("execution_claim_token" IS NOT NULL AND "execution_lease_expires_at" IS NOT NULL)
    )
  );

CREATE INDEX "ai_media_suite_slot_execution_lease_idx"
  ON "ai_media_suite_slots"("status", "execution_lease_expires_at", "id");

CREATE OR REPLACE FUNCTION validate_ai_media_suite_execution_transition() RETURNS trigger AS $$
BEGIN
  IF OLD."revision" < 4 THEN
    RETURN NEW;
  END IF;

  IF OLD."revision" = 4 THEN
    IF OLD."status" IS DISTINCT FROM 'PLANNED'
      OR NEW."revision" IS DISTINCT FROM 5
      OR NEW."status" NOT IN ('QUEUED', 'CANCELLED')
    THEN
      RAISE EXCEPTION 'AI media suite revision beyond materialization is not enabled without revision-5 dispatch' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" IN ('SUCCEEDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'terminal AI media suite cannot transition' USING ERRCODE = '23514';
  ELSIF NOT (
    (OLD."status" = 'QUEUED' AND NEW."status" IN (
      'QUEUED', 'RUNNING', 'PARTIAL_FAILURE', 'FAILED', 'SUCCEEDED',
      'CANCEL_REQUESTED', 'CANCELLED'
    ))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN (
      'QUEUED', 'RUNNING', 'PARTIAL_FAILURE', 'FAILED', 'SUCCEEDED',
      'CANCEL_REQUESTED', 'CANCELLED'
    ))
    OR (OLD."status" IN ('PARTIAL_FAILURE', 'FAILED') AND NEW."status" = 'QUEUED')
    OR (OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" IN ('CANCEL_REQUESTED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid AI media suite execution state transition' USING ERRCODE = '23514';
  END IF;

  IF OLD."cancel_requested_at" IS NOT NULL
    AND NEW."cancel_requested_at" IS DISTINCT FROM OLD."cancel_requested_at"
  THEN
    RAISE EXCEPTION 'AI media suite cancellation time is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'CANCEL_REQUESTED' AND NEW."cancel_requested_at" IS NULL THEN
    RAISE EXCEPTION 'AI media suite cancellation requires a request time' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED')
    AND NEW."completed_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'active AI media suite cannot be completed' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IN ('PARTIAL_FAILURE', 'FAILED', 'SUCCEEDED', 'CANCELLED')
    AND NEW."completed_at" IS NULL
  THEN
    RAISE EXCEPTION 'terminal AI media suite requires a completion time' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_execution_transition_validate"
BEFORE UPDATE ON "ai_media_suites"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_execution_transition();

CREATE OR REPLACE FUNCTION validate_ai_media_suite_execution_event_insert() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  stored_slot "ai_media_suite_slots"%ROWTYPE;
  stored_workflow "ai_media_workflows"%ROWTYPE;
  stored_job "ai_image_jobs"%ROWTYPE;
  stored_reservation "ai_cost_reservations"%ROWTYPE;
  expected_before_status TEXT;
  planned_count INTEGER;
  queued_count INTEGER;
  running_count INTEGER;
  succeeded_count INTEGER;
  failed_count INTEGER;
  cancel_requested_count INTEGER;
  cancelled_count INTEGER;
  total_count INTEGER;
  active_count INTEGER;
  mismatched_result_slot_count INTEGER;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  IF stored_suite."id" IS NULL OR stored_suite."revision" < 5 THEN
    RETURN NEW;
  END IF;

  IF NEW."event_type" NOT IN (
    'SUITE_DISPATCHED',
    'SUITE_CANCEL_REQUESTED',
    'SUITE_CANCELLED',
    'SUITE_SLOT_RETRY_REQUESTED',
    'SUITE_CHILD_RUNNING',
    'SUITE_CHILD_SUCCEEDED',
    'SUITE_CHILD_FAILED',
    'SUITE_CHILD_CANCELLED'
  ) THEN
    RAISE EXCEPTION 'unsupported AI media suite execution event' USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" = 5 THEN
    expected_before_status := 'PLANNED';
    IF NEW."event_type" NOT IN ('SUITE_DISPATCHED', 'SUITE_CANCELLED') THEN
      RAISE EXCEPTION 'AI media suite revision 5 requires SUITE_DISPATCHED or SUITE_CANCELLED' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT previous_event."payload"->>'afterStatus'
    INTO expected_before_status
    FROM "ai_media_suite_events" previous_event
    WHERE previous_event."suite_id" = NEW."suite_id"
      AND previous_event."owner_user_id" = NEW."owner_user_id"
      AND previous_event."revision" = NEW."revision" - 1;
  END IF;

  SELECT
    count(*) FILTER (WHERE "status" = 'PLANNED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'QUEUED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'RUNNING')::INTEGER,
    count(*) FILTER (WHERE "status" = 'SUCCEEDED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'FAILED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'CANCEL_REQUESTED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'CANCELLED')::INTEGER,
    count(*)::INTEGER
  INTO
    planned_count,
    queued_count,
    running_count,
    succeeded_count,
    failed_count,
    cancel_requested_count,
    cancelled_count,
    total_count
  FROM "ai_media_suite_slots"
  WHERE "suite_id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";
  active_count := queued_count + running_count + cancel_requested_count;

  IF expected_before_status IS NULL
    OR NEW."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-execution-event/v1'
    OR NEW."payload"->>'suiteId' IS DISTINCT FROM NEW."suite_id"
    OR NEW."payload"->>'ownerUserId' IS DISTINCT FROM NEW."owner_user_id"
    OR NEW."payload"->>'actorUserId' IS DISTINCT FROM NEW."actor_user_id"
    OR NEW."payload"->>'beforeRevision' IS DISTINCT FROM (NEW."revision" - 1)::TEXT
    OR NEW."payload"->>'afterRevision' IS DISTINCT FROM NEW."revision"::TEXT
    OR NEW."payload"->>'beforeStatus' IS DISTINCT FROM expected_before_status
    OR NEW."payload"->>'afterStatus' IS DISTINCT FROM stored_suite."status"::TEXT
    OR jsonb_typeof(NEW."payload"->'counts') IS DISTINCT FROM 'object'
    OR NEW."payload"#>>'{counts,planned}' IS DISTINCT FROM planned_count::TEXT
    OR NEW."payload"#>>'{counts,queued}' IS DISTINCT FROM queued_count::TEXT
    OR NEW."payload"#>>'{counts,running}' IS DISTINCT FROM running_count::TEXT
    OR NEW."payload"#>>'{counts,succeeded}' IS DISTINCT FROM succeeded_count::TEXT
    OR NEW."payload"#>>'{counts,failed}' IS DISTINCT FROM failed_count::TEXT
    OR NEW."payload"#>>'{counts,cancelRequested}' IS DISTINCT FROM cancel_requested_count::TEXT
    OR NEW."payload"#>>'{counts,cancelled}' IS DISTINCT FROM cancelled_count::TEXT
    OR NEW."payload"#>>'{counts,total}' IS DISTINCT FROM total_count::TEXT
    OR NEW."payload"#>>'{counts,active}' IS DISTINCT FROM active_count::TEXT
    OR jsonb_typeof(NEW."payload"->'result') IS DISTINCT FROM 'object'
    OR NEW."payload"#>>'{result,suiteId}' IS DISTINCT FROM stored_suite."id"
    OR NEW."payload"#>>'{result,revision}' IS DISTINCT FROM stored_suite."revision"::TEXT
    OR NEW."payload"#>>'{result,status}' IS DISTINCT FROM stored_suite."status"::TEXT
    OR NEW."payload"#>>'{result,itemCount}' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR NEW."payload"#>>'{result,concurrencyLimit}' IS DISTINCT FROM stored_suite."concurrency_limit"::TEXT
    OR jsonb_typeof(NEW."payload"#>'{result,counts}') IS DISTINCT FROM 'object'
    OR NEW."payload"#>>'{result,counts,planned}' IS DISTINCT FROM planned_count::TEXT
    OR NEW."payload"#>>'{result,counts,queued}' IS DISTINCT FROM queued_count::TEXT
    OR NEW."payload"#>>'{result,counts,running}' IS DISTINCT FROM running_count::TEXT
    OR NEW."payload"#>>'{result,counts,succeeded}' IS DISTINCT FROM succeeded_count::TEXT
    OR NEW."payload"#>>'{result,counts,failed}' IS DISTINCT FROM failed_count::TEXT
    OR NEW."payload"#>>'{result,counts,cancelRequested}' IS DISTINCT FROM cancel_requested_count::TEXT
    OR NEW."payload"#>>'{result,counts,cancelled}' IS DISTINCT FROM cancelled_count::TEXT
    OR jsonb_typeof(NEW."payload"#>'{result,slots}') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload"#>'{result,slots}') IS DISTINCT FROM total_count
  THEN
    RAISE EXCEPTION 'AI media suite execution event authority mismatch' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER INTO mismatched_result_slot_count
  FROM jsonb_array_elements(NEW."payload"#>'{result,slots}') WITH ORDINALITY AS result_slot(value, position)
  LEFT JOIN "ai_media_suite_slots" slot
    ON slot."suite_id" = NEW."suite_id"
   AND slot."owner_user_id" = NEW."owner_user_id"
   AND slot."ordinal" = result_slot.position - 1
  WHERE slot."id" IS NULL
    OR result_slot.value->>'slotId' IS DISTINCT FROM slot."id"
    OR result_slot.value->>'ordinal' IS DISTINCT FROM slot."ordinal"::TEXT
    OR result_slot.value->>'slotKey' IS DISTINCT FROM slot."slot_key"
    OR result_slot.value->>'status' IS DISTINCT FROM slot."status"::TEXT
    OR result_slot.value->>'attempt' IS DISTINCT FROM slot."attempt"::TEXT
    OR result_slot.value->>'revision' IS DISTINCT FROM slot."revision"::TEXT
    OR result_slot.value->>'childWorkflowId' IS DISTINCT FROM slot."child_workflow_id"
    OR (
      slot."error_code" IS NULL
      AND result_slot.value->'error' IS DISTINCT FROM 'null'::jsonb
    )
    OR (
      slot."error_code" IS NOT NULL
      AND (
        jsonb_typeof(result_slot.value->'error') IS DISTINCT FROM 'object'
        OR result_slot.value#>>'{error,code}' IS DISTINCT FROM left(
          CASE
            WHEN btrim(slot."error_code") = '' THEN 'SUITE_CHILD_FAILED'
            ELSE btrim(slot."error_code")
          END,
          100
        )
        OR result_slot.value#>>'{error,message}' IS DISTINCT FROM left(
          CASE
            WHEN btrim(COALESCE(slot."error_message", '')) = '' THEN 'AI media suite child failed'
            ELSE btrim(slot."error_message")
          END,
          2000
        )
      )
    );
  IF mismatched_result_slot_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite execution replay result mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW."event_type" IN (
    'SUITE_DISPATCHED', 'SUITE_CANCEL_REQUESTED', 'SUITE_CANCELLED', 'SUITE_SLOT_RETRY_REQUESTED'
  ) AND COALESCE(NEW."payload"->>'commandFingerprint', '') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'AI media suite command event requires a fingerprint' USING ERRCODE = '23514';
  END IF;

  IF NEW."event_type" IN (
    'SUITE_SLOT_RETRY_REQUESTED',
    'SUITE_CHILD_RUNNING',
    'SUITE_CHILD_SUCCEEDED',
    'SUITE_CHILD_FAILED',
    'SUITE_CHILD_CANCELLED'
  ) THEN
    SELECT * INTO stored_slot
    FROM "ai_media_suite_slots"
    WHERE "id" = NEW."payload"->>'slotId'
      AND "suite_id" = NEW."suite_id"
      AND "owner_user_id" = NEW."owner_user_id";
    SELECT * INTO stored_workflow
    FROM "ai_media_workflows"
    WHERE "id" = NEW."payload"->>'childWorkflowId'
      AND "owner_user_id" = NEW."owner_user_id";
    SELECT * INTO stored_job
    FROM "ai_image_jobs"
    WHERE "id" = NEW."payload"->>'jobId'
      AND "owner_user_id" = NEW."owner_user_id";
    SELECT * INTO stored_reservation
    FROM "ai_cost_reservations"
    WHERE "id" = NEW."payload"->>'reservationId'
      AND "owner_user_id" = NEW."owner_user_id";

    IF stored_slot."id" IS NULL
      OR stored_workflow."id" IS NULL
      OR stored_job."id" IS NULL
      OR stored_reservation."id" IS NULL
      OR stored_slot."child_workflow_id" IS DISTINCT FROM stored_workflow."id"
      OR stored_workflow."current_attempt" IS DISTINCT FROM stored_slot."attempt"
      OR stored_job."workflow_id" IS DISTINCT FROM stored_workflow."id"
      OR stored_job."workflow_attempt" IS DISTINCT FROM stored_slot."attempt"
      OR stored_reservation."workflow_id" IS DISTINCT FROM stored_workflow."id"
      OR stored_reservation."job_id" IS DISTINCT FROM stored_job."id"
      OR stored_job."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
      OR stored_reservation."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
      OR NEW."payload"->>'attempt' IS DISTINCT FROM stored_slot."attempt"::TEXT
    THEN
      RAISE EXCEPTION 'AI media suite execution event child authority mismatch' USING ERRCODE = '23514';
    END IF;

    IF (NEW."event_type" = 'SUITE_CHILD_RUNNING' AND stored_slot."status" <> 'RUNNING')
      OR (NEW."event_type" = 'SUITE_CHILD_SUCCEEDED' AND stored_slot."status" <> 'SUCCEEDED')
      OR (NEW."event_type" = 'SUITE_CHILD_FAILED' AND stored_slot."status" <> 'FAILED')
      OR (NEW."event_type" = 'SUITE_CHILD_CANCELLED' AND stored_slot."status" <> 'CANCELLED')
      OR (NEW."event_type" = 'SUITE_SLOT_RETRY_REQUESTED' AND stored_slot."status" <> 'QUEUED')
    THEN
      RAISE EXCEPTION 'AI media suite execution event slot state mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_execution_event_validate"
BEFORE INSERT ON "ai_media_suite_events"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_execution_event_insert();

-- Inputs remain closed forever. A retry may only append the next job attempt
-- after a failed, fully reconciled predecessor and must copy attempt 1 exactly.
DROP TRIGGER "ai_image_jobs_suite_child_append_closed" ON "ai_image_jobs";
DROP TRIGGER "ai_media_workflow_inputs_suite_child_append_closed" ON "ai_media_workflow_inputs";

CREATE OR REPLACE FUNCTION prevent_ai_media_suite_bound_child_insert() RETURNS trigger AS $$
DECLARE
  stored_slot "ai_media_suite_slots"%ROWTYPE;
  stored_suite "ai_media_suites"%ROWTYPE;
  first_job "ai_image_jobs"%ROWTYPE;
  previous_job "ai_image_jobs"%ROWTYPE;
  previous_reservation "ai_cost_reservations"%ROWTYPE;
  maximum_attempt INTEGER;
BEGIN
  SELECT slot.* INTO stored_slot
  FROM "ai_media_suite_slots" slot
  WHERE slot."child_workflow_id" = NEW."workflow_id"
    AND slot."owner_user_id" = NEW."owner_user_id";

  IF stored_slot."id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = stored_slot."suite_id" AND "owner_user_id" = stored_slot."owner_user_id";
  IF TG_TABLE_NAME = 'ai_media_workflow_inputs' THEN
    RAISE EXCEPTION 'materialized AI media suite child inputs are append-closed' USING ERRCODE = '23514';
  END IF;
  IF stored_suite."revision" < 5 THEN
    RAISE EXCEPTION 'materialized AI media suite child graph is append-closed before dispatch' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO first_job
  FROM "ai_image_jobs"
  WHERE "workflow_id" = NEW."workflow_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "workflow_attempt" = 1;
  SELECT max("workflow_attempt") INTO maximum_attempt
  FROM "ai_image_jobs"
  WHERE "workflow_id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id";
  SELECT * INTO previous_job
  FROM "ai_image_jobs"
  WHERE "workflow_id" = NEW."workflow_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "workflow_attempt" = maximum_attempt;
  SELECT * INTO previous_reservation
  FROM "ai_cost_reservations"
  WHERE "job_id" = previous_job."id" AND "owner_user_id" = NEW."owner_user_id";

  IF first_job."id" IS NULL
    OR previous_job."id" IS NULL
    OR previous_reservation."id" IS NULL
    OR NEW."workflow_attempt" IS DISTINCT FROM maximum_attempt + 1
    OR stored_slot."status" IS DISTINCT FROM 'FAILED'
    OR stored_slot."attempt" IS DISTINCT FROM maximum_attempt
    OR previous_job."status" IS DISTINCT FROM 'FAILED'
    OR previous_reservation."status" NOT IN ('SETTLED', 'RELEASED')
    OR EXISTS (SELECT 1 FROM "media_assets" WHERE "ai_image_job_id" = previous_job."id")
    OR NEW."status" NOT IN ('PENDING', 'QUEUED')
    OR NEW."operation" IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR NEW."provider" IS DISTINCT FROM stored_suite."provider"
    OR NEW."model" IS DISTINCT FROM stored_suite."model"
    OR ROW(
      NEW."prompt", NEW."negative_prompt", NEW."resolved_prompt", NEW."resolved_negative_prompt",
      NEW."template_key", NEW."template_release_id", NEW."template_checksum", NEW."template_snapshot_json",
      NEW."request_fingerprint", NEW."input_assets_json", NEW."operation_config_json",
      NEW."requested_image_count", NEW."width", NEW."height", NEW."max_attempts",
      NEW."estimated_cost_cents"
    ) IS DISTINCT FROM ROW(
      first_job."prompt", first_job."negative_prompt", first_job."resolved_prompt", first_job."resolved_negative_prompt",
      first_job."template_key", first_job."template_release_id", first_job."template_checksum", first_job."template_snapshot_json",
      first_job."request_fingerprint", first_job."input_assets_json", first_job."operation_config_json",
      first_job."requested_image_count", first_job."width", first_job."height", first_job."max_attempts",
      first_job."estimated_cost_cents"
    )
    OR NEW."requested_image_count" IS DISTINCT FROM 1
    OR NEW."width" IS DISTINCT FROM 900
    OR NEW."height" IS DISTINCT FROM 1200
    OR NEW."max_attempts" IS DISTINCT FROM 1
    OR NEW."attempt_count" IS DISTINCT FROM 0
    OR NEW."progress" IS DISTINCT FROM 0
    OR NEW."provider_dispatched_at" IS NOT NULL
    OR NEW."provider_job_id" IS NOT NULL
    OR NEW."actual_cost_cents" IS NOT NULL
    OR NEW."billed_units" IS DISTINCT FROM 0
    OR NEW."started_at" IS NOT NULL
    OR NEW."completed_at" IS NOT NULL
  THEN
    RAISE EXCEPTION 'AI media suite retry attempt does not match frozen failed slot' USING ERRCODE = '23514';
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

DROP TRIGGER "ai_media_workflows_suite_child_lifecycle_protected" ON "ai_media_workflows";
CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_lifecycle() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
BEGIN
  SELECT suite.* INTO stored_suite
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_suites" suite
    ON suite."id" = slot."suite_id" AND suite."owner_user_id" = slot."owner_user_id"
  WHERE slot."child_workflow_id" = OLD."id" AND slot."owner_user_id" = OLD."owner_user_id";
  IF stored_suite."id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF stored_suite."revision" < 5 THEN
    IF NOT (
      stored_suite."revision" = 4
      AND OLD."status" = 'QUEUED'
      AND NEW."status" = 'CANCELLED'
      AND NEW."current_attempt" = OLD."current_attempt"
      AND NEW."cancel_requested_at" IS NOT NULL
      AND NEW."completed_at" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'materialized AI media suite child lifecycle is parent-controlled until dispatch' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'AI media suite child workflow revision must advance by one' USING ERRCODE = '23514';
  END IF;
  IF NEW."current_attempt" < OLD."current_attempt"
    OR NEW."current_attempt" > OLD."current_attempt" + 1
  THEN
    RAISE EXCEPTION 'AI media suite child workflow attempt sequence is invalid' USING ERRCODE = '23514';
  END IF;

  IF NEW."current_attempt" = OLD."current_attempt" + 1 THEN
    IF OLD."status" <> 'FAILED'
      OR NEW."status" <> 'QUEUED'
      OR NEW."review_status" <> 'NOT_READY'
      OR NEW."selected_output_asset_id" IS NOT NULL
      OR NEW."completed_at" IS NOT NULL
    THEN
      RAISE EXCEPTION 'AI media suite child workflow retry requires a failed attempt' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."status" IN ('SUCCEEDED', 'CANCELLED') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'terminal AI media suite child workflow cannot transition' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT (
    (OLD."status" = 'QUEUED' AND NEW."status" IN ('RUNNING', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED'))
    OR (OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" = 'CANCELLED')
    OR (OLD."status" = NEW."status")
  ) THEN
    RAISE EXCEPTION 'invalid AI media suite child workflow state transition' USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED') AND NEW."completed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'active AI media suite child workflow cannot be completed' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND NEW."completed_at" IS NULL THEN
    RAISE EXCEPTION 'terminal AI media suite child workflow requires completion time' USING ERRCODE = '23514';
  END IF;
  IF NEW."review_status" = 'APPROVED' AND NOT EXISTS (
    SELECT 1
    FROM "ai_image_jobs" job
    JOIN "media_assets" asset ON asset."ai_image_job_id" = job."id"
    WHERE job."workflow_id" = NEW."id"
      AND job."owner_user_id" = NEW."owner_user_id"
      AND job."workflow_attempt" = NEW."current_attempt"
      AND job."status" = 'SUCCEEDED'
      AND asset."id" = NEW."selected_output_asset_id"
      AND asset."owner_user_id" = NEW."owner_user_id"
  ) THEN
    RAISE EXCEPTION 'AI media suite approval requires the current successful output' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_workflows_suite_child_lifecycle_protected"
BEFORE UPDATE ON "ai_media_workflows"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_child_lifecycle();

DROP TRIGGER "ai_image_jobs_suite_child_lifecycle_protected" ON "ai_image_jobs";
CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_job_lifecycle() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
BEGIN
  SELECT suite.* INTO stored_suite
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_suites" suite
    ON suite."id" = slot."suite_id" AND suite."owner_user_id" = slot."owner_user_id"
  WHERE slot."child_workflow_id" = OLD."workflow_id"
    AND slot."owner_user_id" = OLD."owner_user_id";
  IF stored_suite."id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF stored_suite."revision" < 5 THEN
    IF NOT (
      stored_suite."revision" = 4
      AND OLD."status" = 'PENDING'
      AND NEW."status" = 'CANCELLED'
      AND NEW."completed_at" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'materialized AI media suite child job lifecycle is parent-controlled until dispatch' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('PENDING', 'QUEUED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'QUEUED' AND NEW."status" IN ('QUEUED', 'RUNNING', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED'))
    OR (OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" IN ('CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND NEW."status" = OLD."status")
  ) THEN
    RAISE EXCEPTION 'invalid AI media suite child job state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."attempt_count" < OLD."attempt_count" OR NEW."attempt_count" > NEW."max_attempts" THEN
    RAISE EXCEPTION 'AI media suite child provider attempt sequence is invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND NEW."completed_at" IS NULL THEN
    RAISE EXCEPTION 'terminal AI media suite child job requires completion time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_image_jobs_suite_child_lifecycle_protected"
BEFORE UPDATE ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_child_job_lifecycle();

DROP TRIGGER "ai_cost_reservations_suite_child_lifecycle_protected" ON "ai_cost_reservations";
CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_reservation_lifecycle() RETURNS trigger AS $$
DECLARE
  suite_revision INTEGER;
BEGIN
  SELECT suite."revision" INTO suite_revision
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_suites" suite
    ON suite."id" = slot."suite_id" AND suite."owner_user_id" = slot."owner_user_id"
  WHERE slot."child_workflow_id" = OLD."workflow_id"
    AND slot."owner_user_id" = OLD."owner_user_id";
  IF suite_revision IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'materialized AI media suite cost reservation is parent-controlled; AI media suite cost reservation cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF suite_revision < 5 THEN
    IF NOT (
      suite_revision = 4
      AND OLD."status" = 'RESERVED'
      AND NEW."status" = 'RELEASED'
      AND NEW."released_at" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'materialized AI media suite cost reservation is parent-controlled until dispatch' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_cost_reservations_suite_child_lifecycle_protected"
BEFORE UPDATE OR DELETE ON "ai_cost_reservations"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_child_reservation_lifecycle();

DROP TRIGGER "media_assets_suite_child_output_before_dispatch" ON "media_assets";
CREATE OR REPLACE FUNCTION prevent_ai_media_suite_child_output_before_dispatch() RETURNS trigger AS $$
DECLARE
  child_job "ai_image_jobs"%ROWTYPE;
  suite_revision INTEGER;
  existing_output_count INTEGER;
BEGIN
  IF NEW."ai_image_job_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT job.* INTO child_job
  FROM "ai_image_jobs" job
  JOIN "ai_media_suite_slots" slot
    ON slot."child_workflow_id" = job."workflow_id" AND slot."owner_user_id" = job."owner_user_id"
  WHERE job."id" = NEW."ai_image_job_id";
  IF child_job."id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT suite."revision" INTO suite_revision
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_suites" suite
    ON suite."id" = slot."suite_id" AND suite."owner_user_id" = slot."owner_user_id"
  WHERE slot."child_workflow_id" = child_job."workflow_id"
    AND slot."owner_user_id" = child_job."owner_user_id";
  SELECT count(*)::INTEGER INTO existing_output_count
  FROM "media_assets" WHERE "ai_image_job_id" = child_job."id";
  IF suite_revision < 5
    OR child_job."status" <> 'SUCCEEDED'
    OR NEW."owner_user_id" IS DISTINCT FROM child_job."owner_user_id"
    OR NEW."kind" IS DISTINCT FROM 'AI_GENERATED'
    OR existing_output_count >= child_job."requested_image_count"
    OR NEW."url" IS NULL
    OR NEW."mime_type" NOT LIKE 'image/%'
    OR NEW."size_bytes" <= 0
    OR COALESCE(NEW."sha256", '') !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'AI media suite child output requires the dispatch contract and a successful current attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "media_assets_suite_child_output_before_dispatch"
BEFORE INSERT OR UPDATE OF "ai_image_job_id" ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_media_suite_child_output_before_dispatch();

DROP TRIGGER "ai_media_suite_slots_materialized_lifecycle_protected" ON "ai_media_suite_slots";
CREATE OR REPLACE FUNCTION protect_ai_media_suite_materialized_slot_lifecycle() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  is_materialized BOOLEAN;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = OLD."suite_id" AND "owner_user_id" = OLD."owner_user_id";
  IF stored_suite."id" IS NULL OR stored_suite."revision" < 4 THEN
    RETURN NEW;
  END IF;

  IF (NEW."execution_claim_token" IS NULL) IS DISTINCT FROM (NEW."execution_lease_expires_at" IS NULL)
    OR (NEW."execution_claim_token" IS NOT NULL AND NEW."execution_claim_token" !~ '^[a-f0-9]{64}$')
  THEN
    RAISE EXCEPTION 'AI media suite slot execution claim is malformed' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'RUNNING' THEN
    IF NEW."execution_claim_token" IS NULL
      OR NEW."execution_lease_expires_at" IS NULL
      OR NEW."execution_lease_expires_at" <= statement_timestamp()
    THEN
      RAISE EXCEPTION 'running AI media suite slot requires a future execution lease' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" = 'RUNNING' THEN
      RAISE EXCEPTION 'running AI media suite slot claim cannot be renewed or replaced' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."status" = 'CANCEL_REQUESTED' THEN
    IF OLD."status" = 'RUNNING' AND ROW(
      NEW."execution_claim_token", NEW."execution_lease_expires_at"
    ) IS DISTINCT FROM ROW(
      OLD."execution_claim_token", OLD."execution_lease_expires_at"
    ) THEN
      RAISE EXCEPTION 'cancel-requested AI media suite slot must preserve its execution claim' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."execution_claim_token" IS NOT NULL OR NEW."execution_lease_expires_at" IS NOT NULL THEN
    RAISE EXCEPTION 'inactive AI media suite slot cannot retain an execution claim' USING ERRCODE = '23514';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM "ai_media_suite_events"
    WHERE "suite_id" = OLD."suite_id" AND "owner_user_id" = OLD."owner_user_id"
      AND "revision" = 4 AND "event_type" = 'CHILDREN_MATERIALIZED'
  ) INTO is_materialized;
  IF stored_suite."revision" = 4 THEN
    IF is_materialized THEN
      IF NOT (
        OLD."status" = 'PLANNED'
        AND NEW."status" = 'CANCELLED'
        AND NEW."attempt" = OLD."attempt"
      ) THEN
        RAISE EXCEPTION 'materialized AI media suite slot lifecycle is parent-controlled until dispatch' USING ERRCODE = '55000';
      END IF;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF OLD."status" IN ('SUCCEEDED', 'CANCELLED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'terminal AI media suite slot cannot transition' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD."status" = 'PLANNED' AND NEW."status" IN ('QUEUED', 'CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'QUEUED' AND NEW."status" IN ('RUNNING', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED'))
    OR (OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" = 'CANCELLED')
    OR (OLD."status" = 'FAILED' AND NEW."status" = 'QUEUED')
    OR (OLD."status" = NEW."status")
  ) THEN
    RAISE EXCEPTION 'invalid AI media suite slot state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."attempt" IS DISTINCT FROM OLD."attempt" THEN
    IF OLD."status" <> 'FAILED' OR NEW."status" <> 'QUEUED' OR NEW."attempt" <> OLD."attempt" + 1 THEN
      RAISE EXCEPTION 'AI media suite slot retry attempt is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" IN ('PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED')
    AND (NEW."error_code" IS NOT NULL OR NEW."error_message" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'non-failed AI media suite slot cannot retain an error' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_slots_materialized_lifecycle_protected"
BEFORE UPDATE ON "ai_media_suite_slots"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_materialized_slot_lifecycle();

CREATE OR REPLACE FUNCTION assert_ai_media_suite_execution_graph(
  target_suite_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  current_event "ai_media_suite_events"%ROWTYPE;
  planned_count INTEGER;
  queued_count INTEGER;
  running_count INTEGER;
  succeeded_count INTEGER;
  failed_count INTEGER;
  cancel_requested_count INTEGER;
  cancelled_count INTEGER;
  total_count INTEGER;
  active_count INTEGER;
  invalid_count INTEGER;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = target_suite_id AND "owner_user_id" = target_owner_user_id;
  IF stored_suite."id" IS NULL OR stored_suite."revision" < 5 THEN
    RETURN;
  END IF;
  SELECT * INTO current_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = target_suite_id
    AND "owner_user_id" = target_owner_user_id
    AND "revision" = stored_suite."revision";
  IF current_event."id" IS NULL
    OR current_event."payload"->>'afterStatus' IS DISTINCT FROM stored_suite."status"::TEXT
  THEN
    RAISE EXCEPTION 'AI media suite execution revision lacks its aggregate event' USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*) FILTER (WHERE "status" = 'PLANNED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'QUEUED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'RUNNING')::INTEGER,
    count(*) FILTER (WHERE "status" = 'SUCCEEDED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'FAILED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'CANCEL_REQUESTED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'CANCELLED')::INTEGER,
    count(*)::INTEGER
  INTO planned_count, queued_count, running_count, succeeded_count, failed_count,
    cancel_requested_count, cancelled_count, total_count
  FROM "ai_media_suite_slots"
  WHERE "suite_id" = target_suite_id AND "owner_user_id" = target_owner_user_id;
  active_count := queued_count + running_count + cancel_requested_count;

  IF total_count IS DISTINCT FROM stored_suite."item_count"
    OR active_count > stored_suite."concurrency_limit"
    OR current_event."payload"#>>'{counts,planned}' IS DISTINCT FROM planned_count::TEXT
    OR current_event."payload"#>>'{counts,queued}' IS DISTINCT FROM queued_count::TEXT
    OR current_event."payload"#>>'{counts,running}' IS DISTINCT FROM running_count::TEXT
    OR current_event."payload"#>>'{counts,succeeded}' IS DISTINCT FROM succeeded_count::TEXT
    OR current_event."payload"#>>'{counts,failed}' IS DISTINCT FROM failed_count::TEXT
    OR current_event."payload"#>>'{counts,cancelRequested}' IS DISTINCT FROM cancel_requested_count::TEXT
    OR current_event."payload"#>>'{counts,cancelled}' IS DISTINCT FROM cancelled_count::TEXT
    OR current_event."payload"#>>'{counts,total}' IS DISTINCT FROM total_count::TEXT
    OR current_event."payload"#>>'{counts,active}' IS DISTINCT FROM active_count::TEXT
  THEN
    RAISE EXCEPTION 'AI media suite aggregate or concurrency limit is invalid' USING ERRCODE = '23514';
  END IF;

  IF (stored_suite."status" = 'QUEUED' AND (queued_count = 0 OR running_count <> 0))
    OR (stored_suite."status" = 'RUNNING' AND running_count = 0)
    OR (stored_suite."status" = 'SUCCEEDED' AND succeeded_count <> total_count)
    OR (stored_suite."status" = 'FAILED' AND (
      planned_count + queued_count + running_count + cancel_requested_count + succeeded_count + cancelled_count <> 0
      OR failed_count = 0
    ))
    OR (stored_suite."status" = 'PARTIAL_FAILURE' AND (
      planned_count + queued_count + running_count + cancel_requested_count + cancelled_count <> 0
      OR succeeded_count = 0 OR failed_count = 0
    ))
    OR (stored_suite."status" = 'CANCEL_REQUESTED' AND cancel_requested_count = 0)
    OR (stored_suite."status" = 'CANCELLED' AND (
      planned_count + queued_count + running_count + cancel_requested_count <> 0
      OR cancelled_count = 0
    ))
  THEN
    RAISE EXCEPTION 'AI media suite parent status does not match slot aggregate' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER INTO invalid_count
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_workflows" workflow
    ON workflow."id" = slot."child_workflow_id" AND workflow."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_image_jobs" current_job
    ON current_job."workflow_id" = workflow."id"
   AND current_job."owner_user_id" = workflow."owner_user_id"
   AND current_job."workflow_attempt" = slot."attempt"
  LEFT JOIN "ai_cost_reservations" current_reservation
    ON current_reservation."job_id" = current_job."id"
   AND current_reservation."owner_user_id" = current_job."owner_user_id"
  WHERE slot."suite_id" = target_suite_id
    AND slot."owner_user_id" = target_owner_user_id
    AND (
      slot."attempt" < 1
      OR workflow."current_attempt" IS DISTINCT FROM slot."attempt"
      OR current_job."id" IS NULL
      OR current_reservation."id" IS NULL
      OR current_job."actor_user_id" IS DISTINCT FROM current_reservation."actor_user_id"
      OR (slot."execution_claim_token" IS NULL) IS DISTINCT FROM (slot."execution_lease_expires_at" IS NULL)
      OR (slot."execution_claim_token" IS NOT NULL AND slot."execution_claim_token" !~ '^[a-f0-9]{64}$')
      OR (slot."status" = 'RUNNING' AND (
        slot."execution_claim_token" IS NULL OR slot."execution_lease_expires_at" IS NULL
      ))
      OR (slot."status" NOT IN ('RUNNING', 'CANCEL_REQUESTED') AND (
        slot."execution_claim_token" IS NOT NULL OR slot."execution_lease_expires_at" IS NOT NULL
      ))
      OR current_job."provider" IS DISTINCT FROM stored_suite."provider"
      OR current_job."model" IS DISTINCT FROM stored_suite."model"
      OR current_job."operation" IS DISTINCT FROM 'IMAGE_TO_IMAGE'
      OR current_job."applied_mode" IS NOT NULL
      OR current_job."apply_target_type" IS NOT NULL
      OR current_job."apply_target_id" IS NOT NULL
      OR current_job."applied_at" IS NOT NULL
      OR current_reservation."workflow_id" IS DISTINCT FROM workflow."id"
      OR current_reservation."request_fingerprint" IS DISTINCT FROM current_job."request_fingerprint"
      OR current_reservation."provider" IS DISTINCT FROM current_job."provider"
      OR current_reservation."model" IS DISTINCT FROM current_job."model"
      OR current_reservation."operation" IS DISTINCT FROM current_job."operation"
      OR current_reservation."estimated_cost_minor" IS DISTINCT FROM slot."estimated_cost_cents"
      OR current_reservation."maximum_cost_minor" IS DISTINCT FROM slot."maximum_cost_cents"
      OR (SELECT count(*)::INTEGER FROM "ai_image_jobs" attempt_job
          WHERE attempt_job."workflow_id" = workflow."id"
            AND attempt_job."owner_user_id" = workflow."owner_user_id") IS DISTINCT FROM slot."attempt"
      OR EXISTS (
        SELECT 1
        FROM "ai_image_jobs" attempt_job
        JOIN "ai_image_jobs" frozen_job
          ON frozen_job."workflow_id" = workflow."id"
         AND frozen_job."owner_user_id" = workflow."owner_user_id"
         AND frozen_job."workflow_attempt" = 1
        WHERE attempt_job."workflow_id" = workflow."id"
          AND attempt_job."owner_user_id" = workflow."owner_user_id"
          AND ROW(
            attempt_job."operation", attempt_job."provider", attempt_job."model",
            attempt_job."prompt", attempt_job."negative_prompt",
            attempt_job."resolved_prompt", attempt_job."resolved_negative_prompt",
            attempt_job."template_key", attempt_job."template_release_id",
            attempt_job."template_checksum", attempt_job."template_snapshot_json",
            attempt_job."request_fingerprint", attempt_job."input_assets_json",
            attempt_job."operation_config_json", attempt_job."requested_image_count",
            attempt_job."width", attempt_job."height", attempt_job."max_attempts",
            attempt_job."estimated_cost_cents"
          ) IS DISTINCT FROM ROW(
            frozen_job."operation", frozen_job."provider", frozen_job."model",
            frozen_job."prompt", frozen_job."negative_prompt",
            frozen_job."resolved_prompt", frozen_job."resolved_negative_prompt",
            frozen_job."template_key", frozen_job."template_release_id",
            frozen_job."template_checksum", frozen_job."template_snapshot_json",
            frozen_job."request_fingerprint", frozen_job."input_assets_json",
            frozen_job."operation_config_json", frozen_job."requested_image_count",
            frozen_job."width", frozen_job."height", frozen_job."max_attempts",
            frozen_job."estimated_cost_cents"
          )
      )
      OR EXISTS (
        SELECT 1
        FROM "ai_image_jobs" old_job
        LEFT JOIN "ai_cost_reservations" old_reservation
          ON old_reservation."job_id" = old_job."id"
         AND old_reservation."owner_user_id" = old_job."owner_user_id"
        WHERE old_job."workflow_id" = workflow."id"
          AND old_job."owner_user_id" = workflow."owner_user_id"
          AND old_job."workflow_attempt" < slot."attempt"
          AND (
            old_job."status" <> 'FAILED'
            OR old_reservation."status" NOT IN ('SETTLED', 'RELEASED')
            OR EXISTS (SELECT 1 FROM "media_assets" old_output WHERE old_output."ai_image_job_id" = old_job."id")
          )
      )
      OR (slot."status" = 'PLANNED' AND (
        current_job."status" <> 'PENDING' OR workflow."status" <> 'QUEUED'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 0 OR current_job."progress" <> 0
        OR current_job."started_at" IS NOT NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL
      ))
      OR (slot."status" = 'QUEUED' AND (
        current_job."status" <> 'QUEUED' OR workflow."status" <> 'QUEUED'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 0 OR current_job."progress" <> 0
        OR current_job."started_at" IS NOT NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL
      ))
      OR (slot."status" = 'RUNNING' AND (
        current_job."status" <> 'RUNNING' OR workflow."status" <> 'RUNNING'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 1 OR current_job."progress" NOT BETWEEN 1 AND 99
        OR current_job."started_at" IS NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL
      ))
      OR (slot."status" = 'SUCCEEDED' AND (
        current_job."status" <> 'SUCCEEDED' OR workflow."status" <> 'SUCCEEDED'
        OR workflow."review_status" NOT IN ('PENDING', 'APPROVED', 'REJECTED')
        OR current_reservation."status" <> 'SETTLED'
        OR current_job."progress" <> 100 OR current_job."completed_at" IS NULL
        OR current_job."actual_cost_cents" IS NULL OR current_job."billed_units" <> 1
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NULL
        OR (SELECT count(*)::INTEGER FROM "media_assets" output
            WHERE output."ai_image_job_id" = current_job."id"
              AND output."owner_user_id" = current_job."owner_user_id") IS DISTINCT FROM 1
      ))
      OR (slot."status" = 'FAILED' AND (
        current_job."status" <> 'FAILED' OR workflow."status" <> 'FAILED'
        OR workflow."review_status" <> 'NOT_READY'
        OR current_reservation."status" NOT IN (
          'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED', 'SETTLED', 'RELEASED'
        )
        OR current_job."progress" <> 0 OR current_job."completed_at" IS NULL
        OR current_job."billed_units" <> 0 OR current_job."error_code" IS NULL
        OR workflow."completed_at" IS NULL
        OR EXISTS (SELECT 1 FROM "media_assets" output WHERE output."ai_image_job_id" = current_job."id")
      ))
      OR (slot."status" = 'CANCEL_REQUESTED' AND (
        current_job."status" <> 'CANCEL_REQUESTED' OR workflow."status" <> 'CANCEL_REQUESTED'
      ))
      OR (slot."status" = 'CANCELLED' AND (
        current_job."status" <> 'CANCELLED' OR workflow."status" <> 'CANCELLED'
        OR current_reservation."status" NOT IN (
          'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED', 'SETTLED', 'RELEASED'
        )
        OR current_job."progress" <> 0 OR current_job."completed_at" IS NULL
        OR current_job."billed_units" <> 0 OR current_job."error_code" IS NULL
        OR workflow."completed_at" IS NULL
        OR EXISTS (SELECT 1 FROM "media_assets" output WHERE output."ai_image_job_id" = current_job."id")
      ))
    );
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite execution child graph is invalid' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_suite() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_execution_graph(NEW."id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_slot() RETURNS trigger AS $$
BEGIN
  PERFORM assert_ai_media_suite_execution_graph(NEW."suite_id", NEW."owner_user_id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_workflow() RETURNS trigger AS $$
DECLARE bound_slot RECORD;
BEGIN
  SELECT "suite_id", "owner_user_id" INTO bound_slot
  FROM "ai_media_suite_slots"
  WHERE "child_workflow_id" = NEW."id" AND "owner_user_id" = NEW."owner_user_id";
  IF bound_slot."suite_id" IS NOT NULL THEN
    PERFORM assert_ai_media_suite_execution_graph(bound_slot."suite_id", bound_slot."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_job() RETURNS trigger AS $$
DECLARE bound_slot RECORD;
BEGIN
  SELECT "suite_id", "owner_user_id" INTO bound_slot
  FROM "ai_media_suite_slots"
  WHERE "child_workflow_id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id";
  IF bound_slot."suite_id" IS NOT NULL THEN
    PERFORM assert_ai_media_suite_execution_graph(bound_slot."suite_id", bound_slot."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_reservation() RETURNS trigger AS $$
DECLARE bound_slot RECORD;
BEGIN
  SELECT "suite_id", "owner_user_id" INTO bound_slot
  FROM "ai_media_suite_slots"
  WHERE "child_workflow_id" = NEW."workflow_id" AND "owner_user_id" = NEW."owner_user_id";
  IF bound_slot."suite_id" IS NOT NULL THEN
    PERFORM assert_ai_media_suite_execution_graph(bound_slot."suite_id", bound_slot."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_asset() RETURNS trigger AS $$
DECLARE bound_slot RECORD;
BEGIN
  SELECT slot."suite_id", slot."owner_user_id" INTO bound_slot
  FROM "ai_image_jobs" job
  JOIN "ai_media_suite_slots" slot
    ON slot."child_workflow_id" = job."workflow_id" AND slot."owner_user_id" = job."owner_user_id"
  WHERE job."id" = NEW."ai_image_job_id" AND job."owner_user_id" = NEW."owner_user_id";
  IF bound_slot."suite_id" IS NOT NULL THEN
    PERFORM assert_ai_media_suite_execution_graph(bound_slot."suite_id", bound_slot."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_graph"
AFTER UPDATE ON "ai_media_suites"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW."revision" >= 5)
EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_suite();
CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_slot_graph"
AFTER UPDATE ON "ai_media_suite_slots"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_slot();
CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_workflow_graph"
AFTER UPDATE ON "ai_media_workflows"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_workflow();
CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_job_graph"
AFTER INSERT OR UPDATE ON "ai_image_jobs"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_job();
CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_reservation_graph"
AFTER INSERT OR UPDATE ON "ai_cost_reservations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_reservation();
CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_asset_graph"
AFTER INSERT OR UPDATE ON "media_assets"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_asset();

DO $$
DECLARE stored_suite RECORD;
BEGIN
  FOR stored_suite IN
    SELECT "id", "owner_user_id" FROM "ai_media_suites" WHERE "revision" >= 5
  LOOP
    PERFORM assert_ai_media_suite_execution_graph(stored_suite."id", stored_suite."owner_user_id");
  END LOOP;
END;
$$;

COMMIT;
