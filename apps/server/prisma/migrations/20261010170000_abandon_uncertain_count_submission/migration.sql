BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Explicit operator abandonment ends ERP recovery only. A sent request without
-- an accepted Provider ID keeps its original dispatch/error and unknown Supplier outcome.
CREATE FUNCTION ai_media_count_uncertain_abandonment_allowed(job_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM ai_image_jobs job
    JOIN ai_media_workflows workflow ON workflow.id = job.workflow_id AND workflow.owner_user_id = job.owner_user_id
    JOIN ai_media_suite_slots slot ON slot.child_workflow_id = workflow.id AND slot.owner_user_id = job.owner_user_id
    JOIN ai_media_suites suite ON suite.id = slot.suite_id AND suite.owner_user_id = job.owner_user_id
    JOIN ai_cost_reservations cost ON cost.job_id = job.id AND cost.owner_user_id = job.owner_user_id
    WHERE job.id = job_id AND job.status = 'FAILED' AND job.operation = 'IMAGE_TO_IMAGE'
      AND job.provider = 'custom' AND job.model = 'gpt-image-2-count'
      AND job.error_code IN ('PROVIDER_REQUEST_FAILED', 'PROVIDER_TIMEOUT', 'PROVIDER_SUBMISSION_UNCERTAIN')
      AND job.provider_reconciliation_status = 'MANUAL_REVIEW'
      AND job.provider_job_id IS NULL AND cost.provider_request_id IS NULL AND cost.provider_accepted_at IS NULL
      AND job.workflow_attempt = workflow.current_attempt AND slot.attempt = job.workflow_attempt
      AND workflow.status = 'FAILED' AND workflow.operation = job.operation
      AND workflow.review_status = 'NOT_READY' AND workflow.selected_output_asset_id IS NULL
      AND slot.status = 'FAILED' AND suite.status IN ('FAILED', 'PARTIAL_FAILURE') AND suite.cancel_requested_at IS NULL
      AND suite.provider = job.provider AND suite.model = job.model
      AND job.attempt_count = 1 AND job.max_attempts = 1 AND job.requested_image_count = 1
      AND job.width = 900 AND job.height = 1200 AND job.actual_cost_cents IS NULL AND job.billed_units = 0
      AND job.estimated_cost_cents = 10 AND slot.estimated_cost_cents = 10 AND slot.maximum_cost_cents = 10
      AND suite.item_count BETWEEN 1 AND 2 AND suite.maximum_cost_cents = suite.item_count * 10
      AND job.request_fingerprint ~ '^[a-f0-9]{64}$' AND cost.request_fingerprint = job.request_fingerprint
      AND cost.workflow_id = job.workflow_id AND cost.actor_user_id = job.actor_user_id
      AND cost.provider = job.provider AND cost.model = job.model AND cost.operation = job.operation
      AND cost.currency = 'CNY' AND cost.estimated_cost_minor = 10 AND cost.maximum_cost_minor = 10
      AND cost.status = 'SUBMISSION_UNCERTAIN'
      AND job.provider_dispatched_at IS NOT NULL AND job.provider_dispatched_at <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      AND NOT EXISTS (SELECT 1 FROM media_assets asset WHERE asset.ai_image_job_id = job.id)
      AND NOT EXISTS (SELECT 1 FROM ai_cost_settlements settlement WHERE settlement.reservation_id = cost.id
        AND settlement.kind IN ('CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE'))
      AND EXISTS (
        SELECT 1 FROM ai_media_workflow_events dispatch
        WHERE dispatch.workflow_id = workflow.id AND dispatch.job_id = job.id
          AND dispatch.owner_user_id = job.owner_user_id AND dispatch.actor_user_id = job.actor_user_id
          AND dispatch.event_type = 'PROVIDER_DISPATCH_STARTED'
          AND dispatch.event_key = workflow.id || ':PROVIDER_DISPATCH_STARTED:' || job.id || ':' || job.workflow_attempt::text
          AND dispatch.payload = jsonb_build_object('providerDispatchedAt', dispatch.payload->>'providerDispatchedAt')
          AND dispatch.payload_hash = encode(sha256(convert_to('{"providerDispatchedAt":' ||
            to_jsonb(dispatch.payload->>'providerDispatchedAt')::text || '}', 'UTF8')), 'hex')
          AND dispatch.payload->>'providerDispatchedAt' = to_char(job.provider_dispatched_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
      AND ai_media_gpt2_count_suite_runtime_valid(job.operation::text, job.operation_config_json, job.estimated_cost_cents,
        suite.pricing_version, job.input_assets_json, job.provider, job.model, suite.provider_config_hash, suite.concurrency_limit)
  );
$$;

-- The terminal row remains valid after ERP release; the transition owner below
-- checks the original job, cost, graph and exact immutable dispatch receipt.
ALTER TABLE "ai_image_jobs" DROP CONSTRAINT "ai_image_job_provider_reconciliation_state_check";
ALTER TABLE "ai_image_jobs"
  ADD CONSTRAINT "ai_image_job_provider_reconciliation_state_check" CHECK (
    "provider_reconciliation_revision" >= 0
    AND "provider_reconciliation_attempt_count" >= 0
    AND (
      "provider_reconciliation_last_provider_status" IS NULL
      OR BTRIM("provider_reconciliation_last_provider_status") <> ''
    )
    AND (
      "provider_reconciliation_last_error_code" IS NULL
      OR BTRIM("provider_reconciliation_last_error_code") <> ''
    )
    AND (
      "provider_reconciliation_last_error_message" IS NULL
      OR BTRIM("provider_reconciliation_last_error_message") <> ''
    )
    AND (
      (
        "provider_reconciliation_status" = 'RUNNING'
        AND "provider_reconciliation_lease_owner" IS NOT NULL
        AND BTRIM("provider_reconciliation_lease_owner") <> ''
        AND "provider_reconciliation_lease_token_hash" IS NOT NULL
        AND "provider_reconciliation_lease_token_hash" ~ '^[0-9a-f]{64}$'
        AND "provider_reconciliation_lease_expires_at" IS NOT NULL
      )
      OR (
        "provider_reconciliation_status" <> 'RUNNING'
        AND "provider_reconciliation_lease_owner" IS NULL
        AND "provider_reconciliation_lease_token_hash" IS NULL
        AND "provider_reconciliation_lease_expires_at" IS NULL
      )
    )
    AND (
      (
        "provider_reconciliation_status" IN ('PENDING', 'RETRY_WAIT')
        AND "provider_reconciliation_next_at" IS NOT NULL
      )
      OR (
        "provider_reconciliation_status" NOT IN ('PENDING', 'RETRY_WAIT')
        AND "provider_reconciliation_next_at" IS NULL
      )
    )
    AND (
      "provider_reconciliation_status" NOT IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
      OR (
        NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL
        AND "provider_reconciliation_deadline_at" IS NOT NULL
      )
    )
    AND (
      "provider_reconciliation_status" <> 'RUNNING'
      OR "provider_reconciliation_attempt_count" >= 1
    )
    AND (
      "provider_reconciliation_status" NOT IN ('RECOVERED', 'NO_OUTPUT', 'CANCELLED_OUTPUT_RETAINED')
      OR NULLIF(BTRIM("provider_job_id"), '') IS NOT NULL
      OR (
        "provider_reconciliation_status" = 'CANCELLED_OUTPUT_RETAINED'
        AND "provider_job_id" IS NULL AND "provider_dispatched_at" IS NOT NULL
        AND "status" = 'FAILED' AND "operation" = 'IMAGE_TO_IMAGE'
        AND "provider" = 'custom' AND "model" = 'gpt-image-2-count'
        AND "error_code" IN ('PROVIDER_REQUEST_FAILED', 'PROVIDER_TIMEOUT', 'PROVIDER_SUBMISSION_UNCERTAIN')
        AND "actual_cost_cents" IS NULL AND "billed_units" = 0
        AND "attempt_count" = 1 AND "max_attempts" = 1 AND "requested_image_count" = 1
        AND "width" = 900 AND "height" = 1200 AND "estimated_cost_cents" = 10
        AND "workflow_id" IS NOT NULL AND "workflow_attempt" >= 1
        AND "operation_config_json"->'providerRuntime'->>'currency' = 'CNY'
        AND "operation_config_json"->'providerRuntime'->>'unitCostCents' = '10'
      )
    )
    AND (
      "provider_reconciliation_status" <> 'NOT_SUBMITTED'
      OR "provider_job_id" IS NULL
    )
    AND (
      (
        "provider_reconciliation_status" IN ('RECOVERED', 'NO_OUTPUT', 'NOT_SUBMITTED', 'CANCELLED_OUTPUT_RETAINED')
        AND "provider_reconciled_at" IS NOT NULL
      )
      OR (
        "provider_reconciliation_status" NOT IN ('RECOVERED', 'NO_OUTPUT', 'NOT_SUBMITTED', 'CANCELLED_OUTPUT_RETAINED')
        AND "provider_reconciled_at" IS NULL
      )
    )
  ) NOT VALID;

ALTER TABLE "ai_image_jobs"
  VALIDATE CONSTRAINT "ai_image_job_provider_reconciliation_state_check";

DO $migration$
DECLARE
  definition text;
  old_branch text := '(NEW."provider_reconciled_at" IS NOT NULL AND ai_media_count_undelivered_abandonment_allowed(OLD."id"))';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema() AND p.proname = 'validate_ai_provider_reconciliation_transition'
    AND pg_get_function_identity_arguments(p.oid) = '';
  IF definition IS NULL OR POSITION(old_branch IN definition) = 0 THEN
    RAISE EXCEPTION 'AI provider reconciliation transition owner drifted';
  END IF;
  definition := REPLACE(definition, old_branch, old_branch ||
    ' OR (NEW."provider_reconciled_at" IS NOT NULL AND ai_media_count_uncertain_abandonment_allowed(OLD."id"))');
  EXECUTE definition;
END $migration$;

COMMIT;
