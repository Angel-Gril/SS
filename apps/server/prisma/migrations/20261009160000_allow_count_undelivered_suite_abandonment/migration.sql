BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Known synchronous count output failed admission before ERP ingest. This is
-- cancellation of ERP recovery, never a claim that Provider output/cost was zero.
-- The append-only reconciliation and cost owners still persist the audit/release.
CREATE FUNCTION ai_media_count_undelivered_abandonment_allowed(job_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM ai_image_jobs job
    JOIN ai_media_workflows workflow ON workflow.id = job.workflow_id AND workflow.owner_user_id = job.owner_user_id
    JOIN ai_media_suite_slots slot ON slot.child_workflow_id = workflow.id AND slot.owner_user_id = job.owner_user_id
    JOIN ai_media_suites suite ON suite.id = slot.suite_id AND suite.owner_user_id = job.owner_user_id
    JOIN ai_cost_reservations cost ON cost.job_id = job.id AND cost.owner_user_id = job.owner_user_id
    WHERE job.id = job_id
      AND job.status = 'FAILED' AND job.operation = 'IMAGE_TO_IMAGE'
      AND job.provider = 'custom' AND job.model = 'gpt-image-2-count'
      AND job.error_code = 'INVALID_PROVIDER_RESULT'
      AND job.provider_reconciliation_status = 'MANUAL_REVIEW'
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
      AND cost.status = 'RECONCILIATION_REQUIRED'
      AND NULLIF(BTRIM(job.provider_job_id), '') IS NOT NULL AND cost.provider_request_id = job.provider_job_id
      AND cost.provider_accepted_at IS NOT NULL AND cost.provider_accepted_at <= CURRENT_TIMESTAMP
      AND job.provider_dispatched_at IS NOT NULL AND job.provider_dispatched_at <= CURRENT_TIMESTAMP
      AND NOT EXISTS (SELECT 1 FROM media_assets asset WHERE asset.ai_image_job_id = job.id)
      AND NOT EXISTS (SELECT 1 FROM ai_cost_settlements settlement WHERE settlement.reservation_id = cost.id
        AND settlement.kind IN ('CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE'))
      AND ai_media_gpt2_count_suite_runtime_valid(job.operation::text, job.operation_config_json, job.estimated_cost_cents,
        suite.pricing_version, job.input_assets_json, job.provider, job.model, suite.provider_config_hash, suite.concurrency_limit)
  );
$$;

DO $migration$
DECLARE
  definition text;
  old_predicate text := $old$OLD."status" = 'FAILED'
            AND OLD."operation" = 'IMAGE_TO_IMAGE'
            AND OLD."provider" = 'dashscope-wanx'
            AND OLD."model" = 'wanx2.1-imageedit'
            AND OLD."error_code" = 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'
            AND NULLIF(BTRIM(OLD."provider_job_id"), '') IS NOT NULL
            AND OLD."provider_dispatched_at" <= CURRENT_TIMESTAMP - INTERVAL '24 hours'
            AND NEW."provider_reconciled_at" IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM "ai_media_suite_slots" suite_slot
              JOIN "ai_media_suites" suite
                ON suite."id" = suite_slot."suite_id"
               AND suite."owner_user_id" = suite_slot."owner_user_id"
              WHERE suite_slot."child_workflow_id" = OLD."workflow_id"
                AND suite_slot."owner_user_id" = OLD."owner_user_id"
                AND suite."status" = 'FAILED'
            )$old$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema() AND p.proname = 'validate_ai_provider_reconciliation_transition'
    AND pg_get_function_identity_arguments(p.oid) = '';
  IF definition IS NULL THEN RAISE EXCEPTION 'AI provider reconciliation transition owner is missing'; END IF;
  definition := REPLACE(definition, CHR(13), '');
  IF POSITION(old_predicate IN definition) = 0 THEN RAISE EXCEPTION 'AI provider reconciliation transition owner drifted'; END IF;
  -- Preserve the old Wanx condition verbatim and add one count-specific branch.
  definition := REPLACE(definition, old_predicate,
    '(' || old_predicate || ') OR (NEW."provider_reconciled_at" IS NOT NULL AND ai_media_count_undelivered_abandonment_allowed(OLD."id"))');
  EXECUTE definition;
END $migration$;

COMMIT;
