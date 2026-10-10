BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- A synchronous count output can be rejected by the frozen dimensions contract
-- after Provider acceptance. It remains an audited undelivered result: this
-- function only permits the existing ABANDON/reconciliation path and never
-- claims that Provider billing was zero.
CREATE OR REPLACE FUNCTION ai_media_count_undelivered_abandonment_allowed(job_id text)
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
      AND job.error_code IN ('INVALID_PROVIDER_RESULT', 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH')
      AND job.provider_reconciliation_status = 'MANUAL_REVIEW'
      AND job.workflow_attempt = workflow.current_attempt AND slot.attempt = job.workflow_attempt
      AND workflow.status = 'FAILED' AND workflow.operation = job.operation
      AND workflow.review_status = 'NOT_READY' AND workflow.selected_output_asset_id IS NULL
      AND slot.status = 'FAILED' AND suite.status IN ('FAILED', 'PARTIAL_FAILURE') AND suite.cancel_requested_at IS NULL
      AND suite.provider = job.provider AND suite.model = job.model
      AND job.attempt_count = 1 AND job.max_attempts = 1 AND job.requested_image_count = 1
      AND job.width = 900 AND job.height = 1200
      AND ((cost.status = 'RECONCILIATION_REQUIRED' AND job.actual_cost_cents IS NULL AND job.billed_units = 0)
        OR (cost.status = 'SETTLED' AND job.actual_cost_cents = 10 AND job.billed_units = 1))
      AND job.estimated_cost_cents = 10 AND slot.estimated_cost_cents = 10 AND slot.maximum_cost_cents = 10
      AND suite.item_count BETWEEN 1 AND 2 AND suite.maximum_cost_cents = suite.item_count * 10
      AND job.request_fingerprint ~ '^[a-f0-9]{64}$' AND cost.request_fingerprint = job.request_fingerprint
      AND cost.workflow_id = job.workflow_id AND cost.actor_user_id = job.actor_user_id
      AND cost.provider = job.provider AND cost.model = job.model AND cost.operation = job.operation
      AND cost.currency = 'CNY' AND cost.estimated_cost_minor = 10 AND cost.maximum_cost_minor = 10
      AND cost.status IN ('RECONCILIATION_REQUIRED', 'SETTLED')
      AND NULLIF(BTRIM(job.provider_job_id), '') IS NOT NULL
      AND (cost.status = 'RECONCILIATION_REQUIRED' AND cost.provider_request_id = job.provider_job_id
        AND cost.provider_accepted_at IS NOT NULL AND cost.provider_accepted_at <= CURRENT_TIMESTAMP
        OR cost.status = 'SETTLED' AND (cost.provider_request_id IS NULL OR cost.provider_request_id = job.provider_job_id)
        AND EXISTS (
          SELECT 1 FROM ai_media_workflow_events submitted
          WHERE submitted.workflow_id = workflow.id AND submitted.job_id = job.id
            AND submitted.owner_user_id = job.owner_user_id AND submitted.actor_user_id = job.actor_user_id
            AND submitted.event_type = 'PROVIDER_SUBMITTED'
            AND submitted.event_key = workflow.id || ':PROVIDER_SUBMITTED:' || job.id || ':' || job.workflow_attempt::text
            AND submitted.payload->>'providerJobId' = job.provider_job_id
            AND submitted.payload = jsonb_build_object('providerJobId', job.provider_job_id,
              'providerAcceptedAt', submitted.payload->>'providerAcceptedAt')
            AND submitted.payload_hash = encode(sha256(convert_to('{"providerAcceptedAt":' ||
              to_jsonb(submitted.payload->>'providerAcceptedAt')::text || ',"providerJobId":' ||
              to_jsonb(job.provider_job_id)::text || '}', 'UTF8')), 'hex')
            AND CASE WHEN submitted.payload->>'providerAcceptedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
              THEN (submitted.payload->>'providerAcceptedAt')::timestamptz <= CURRENT_TIMESTAMP
                AND (cost.provider_accepted_at IS NULL OR cost.provider_accepted_at = (submitted.payload->>'providerAcceptedAt')::timestamptz)
              ELSE false END
        ))
      AND job.provider_dispatched_at IS NOT NULL AND job.provider_dispatched_at <= CURRENT_TIMESTAMP
      AND NOT EXISTS (SELECT 1 FROM media_assets asset WHERE asset.ai_image_job_id = job.id)
      AND (cost.status = 'RECONCILIATION_REQUIRED'
        AND NOT EXISTS (SELECT 1 FROM ai_cost_settlements settlement WHERE settlement.reservation_id = cost.id
          AND settlement.kind IN ('CHARGE', 'RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE'))
        OR cost.status = 'SETTLED' AND EXISTS (SELECT 1 FROM ai_cost_settlements settlement WHERE settlement.reservation_id = cost.id
          AND settlement.kind = 'CHARGE' AND settlement.actual_cost_minor = 10 AND settlement.billed_units = 1)
        AND NOT EXISTS (SELECT 1 FROM ai_cost_settlements settlement WHERE settlement.reservation_id = cost.id
          AND settlement.kind IN ('RECONCILED_CHARGE', 'RELEASE', 'RECONCILED_RELEASE')))
      AND ai_media_gpt2_count_suite_runtime_valid(job.operation::text, job.operation_config_json, job.estimated_cost_cents,
        suite.pricing_version, job.input_assets_json, job.provider, job.model, suite.provider_config_hash, suite.concurrency_limit)
  );
$$;

COMMIT;
