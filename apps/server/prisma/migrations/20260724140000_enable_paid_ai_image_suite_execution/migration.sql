BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Paid suite execution renews the same fenced claim while a Provider request is
-- in flight. The token is immutable; only a still-live expiry may move forward.
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
    IF OLD."status" = 'RUNNING' AND (
      NEW."execution_claim_token" IS DISTINCT FROM OLD."execution_claim_token"
      OR OLD."execution_lease_expires_at" <= statement_timestamp()
      OR NEW."execution_lease_expires_at" <= OLD."execution_lease_expires_at"
    ) THEN
      RAISE EXCEPTION 'running AI media suite slot lease renewal must preserve a live claim' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."status" = 'CANCEL_REQUESTED' THEN
    IF OLD."status" IN ('RUNNING', 'CANCEL_REQUESTED') AND (
      NEW."execution_claim_token" IS DISTINCT FROM OLD."execution_claim_token"
      OR NEW."execution_lease_expires_at" < OLD."execution_lease_expires_at"
      OR (
        OLD."status" = 'CANCEL_REQUESTED'
        AND OLD."execution_lease_expires_at" <= statement_timestamp()
        AND NEW."execution_lease_expires_at" > OLD."execution_lease_expires_at"
      )
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
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED'))
    OR (OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" IN ('CANCEL_REQUESTED', 'CANCELLED'))
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

-- Heartbeats are operational fences, not user-visible state transitions. They
-- may advance only the live lease (plus Prisma's updated_at) without consuming
-- an audited slot revision.
CREATE OR REPLACE FUNCTION protect_ai_media_suite_slot_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media suite slot cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" IS NOT DISTINCT FROM OLD."revision"
    AND OLD."status" IN ('RUNNING', 'CANCEL_REQUESTED')
    AND NEW."status" IS NOT DISTINCT FROM OLD."status"
    AND OLD."execution_claim_token" IS NOT NULL
    AND NEW."execution_claim_token" IS NOT DISTINCT FROM OLD."execution_claim_token"
    AND OLD."execution_lease_expires_at" > statement_timestamp()
    AND NEW."execution_lease_expires_at" > OLD."execution_lease_expires_at"
    AND NEW."updated_at" >= OLD."updated_at"
    AND ROW(
      NEW."id", NEW."suite_id", NEW."owner_user_id", NEW."ordinal", NEW."slot_key",
      NEW."goal", NEW."ownership_level", NEW."ownership_key", NEW."compatibility_group_key",
      NEW."slot_snapshot_json", NEW."slot_hash", NEW."references_snapshot_json",
      NEW."references_hash", NEW."diagnostics_json", NEW."status", NEW."child_workflow_id",
      NEW."attempt", NEW."revision", NEW."execution_claim_token", NEW."estimated_cost_cents",
      NEW."maximum_cost_cents", NEW."error_code", NEW."error_message", NEW."created_at"
    ) IS NOT DISTINCT FROM ROW(
      OLD."id", OLD."suite_id", OLD."owner_user_id", OLD."ordinal", OLD."slot_key",
      OLD."goal", OLD."ownership_level", OLD."ownership_key", OLD."compatibility_group_key",
      OLD."slot_snapshot_json", OLD."slot_hash", OLD."references_snapshot_json",
      OLD."references_hash", OLD."diagnostics_json", OLD."status", OLD."child_workflow_id",
      OLD."attempt", OLD."revision", OLD."execution_claim_token", OLD."estimated_cost_cents",
      OLD."maximum_cost_cents", OLD."error_code", OLD."error_message", OLD."created_at"
    )
  THEN
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."suite_id" IS DISTINCT FROM OLD."suite_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."slot_key" IS DISTINCT FROM OLD."slot_key"
    OR NEW."goal" IS DISTINCT FROM OLD."goal"
    OR NEW."ownership_level" IS DISTINCT FROM OLD."ownership_level"
    OR NEW."ownership_key" IS DISTINCT FROM OLD."ownership_key"
    OR NEW."compatibility_group_key" IS DISTINCT FROM OLD."compatibility_group_key"
    OR NEW."slot_snapshot_json" IS DISTINCT FROM OLD."slot_snapshot_json"
    OR NEW."slot_hash" IS DISTINCT FROM OLD."slot_hash"
    OR NEW."references_snapshot_json" IS DISTINCT FROM OLD."references_snapshot_json"
    OR NEW."references_hash" IS DISTINCT FROM OLD."references_hash"
    OR NEW."estimated_cost_cents" IS DISTINCT FROM OLD."estimated_cost_cents"
    OR NEW."maximum_cost_cents" IS DISTINCT FROM OLD."maximum_cost_cents"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media suite slot identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'AI media suite slot revision must advance by one' USING ERRCODE = '23514';
  END IF;
  IF OLD."child_workflow_id" IS NOT NULL
    AND NEW."child_workflow_id" IS DISTINCT FROM OLD."child_workflow_id"
  THEN
    RAISE EXCEPTION 'AI media suite child workflow cannot be cleared or replaced' USING ERRCODE = '23514';
  END IF;
  IF NEW."attempt" < OLD."attempt" OR NEW."attempt" > OLD."attempt" + 1 THEN
    RAISE EXCEPTION 'AI media suite slot attempt sequence is invalid' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'SUCCEEDED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'successful AI media suite slot is terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
  IF stored_suite."id" IS NULL OR stored_suite."revision" < 5 THEN RETURN; END IF;

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
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE asset."kind" = 'AI_PROVIDER_OUTPUT')::INTEGER AS raw_count,
      count(*) FILTER (WHERE asset."kind" = 'AI_GENERATED')::INTEGER AS final_count,
      count(*) FILTER (WHERE asset."kind" NOT IN ('AI_PROVIDER_OUTPUT', 'AI_GENERATED'))::INTEGER AS other_count
    FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = current_job."id"
      AND asset."owner_user_id" = current_job."owner_user_id"
  ) asset_counts ON TRUE
  LEFT JOIN LATERAL (
    SELECT asset.* FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = current_job."id"
      AND asset."owner_user_id" = current_job."owner_user_id"
      AND asset."kind" = 'AI_PROVIDER_OUTPUT'
    ORDER BY asset."id" LIMIT 1
  ) raw_output ON TRUE
  LEFT JOIN LATERAL (
    SELECT asset.* FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = current_job."id"
      AND asset."owner_user_id" = current_job."owner_user_id"
      AND asset."kind" = 'AI_GENERATED'
    ORDER BY asset."id" LIMIT 1
  ) final_output ON TRUE
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
      OR (slot."status" IN ('RUNNING', 'CANCEL_REQUESTED') AND (
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
      OR current_job."billed_units" NOT IN (0, 1)
      OR (current_job."billed_units" = 0 AND current_job."actual_cost_cents" IS NOT NULL)
      OR (current_job."billed_units" = 1 AND current_job."actual_cost_cents" IS DISTINCT FROM current_job."estimated_cost_cents")
      OR asset_counts.raw_count > 1 OR asset_counts.final_count > 1 OR asset_counts.other_count <> 0
      OR (asset_counts.raw_count = 1 AND (
        stored_suite."provider" = 'fake'
        OR current_job."provider_dispatched_at" IS NULL
        OR current_job."actual_cost_cents" IS DISTINCT FROM current_job."estimated_cost_cents"
        OR current_job."billed_units" IS DISTINCT FROM 1
        OR raw_output."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
        OR raw_output."source_media_key" IS NOT NULL OR raw_output."source_url" IS NOT NULL
        OR raw_output."storage_backend" NOT IN ('local', 'oss')
        OR COALESCE(raw_output."storage_key", '') !~ '[^[:space:]]'
        OR raw_output."mime_type" NOT IN ('image/png', 'image/jpeg', 'image/webp')
        OR raw_output."size_bytes" <= 0 OR raw_output."size_bytes" > 20971520
        OR raw_output."width" IS DISTINCT FROM 1024 OR raw_output."height" IS DISTINCT FROM 1536
        OR COALESCE(raw_output."sha256", '') !~ '^[a-f0-9]{64}$'
        OR raw_output."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-provider-output/v1'
        OR raw_output."metadata"->>'sourceCaptureSnapshotId' IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
        OR raw_output."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'
        OR COALESCE(raw_output."metadata"->>'normalizedSha256', '') !~ '^[a-f0-9]{64}$'
        OR COALESCE(raw_output."metadata"->>'actualCostCents', '') !~ '^[0-9]+$'
        OR (raw_output."metadata"->>'actualCostCents')::BIGINT IS DISTINCT FROM current_job."actual_cost_cents"::BIGINT
        OR COALESCE(raw_output."metadata"->>'providerResultReceivedAt', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
        OR (current_job."provider_job_id" IS NULL AND jsonb_typeof(raw_output."metadata"->'providerJobId') IS DISTINCT FROM 'null')
        OR (current_job."provider_job_id" IS NOT NULL AND raw_output."metadata"->>'providerJobId' IS DISTINCT FROM current_job."provider_job_id")
      ))
      OR (asset_counts.final_count = 1 AND (
        final_output."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
        OR final_output."source_media_key" IS NOT NULL OR final_output."source_url" IS NOT NULL
        OR final_output."storage_backend" NOT IN ('local', 'oss')
        OR COALESCE(final_output."storage_key", '') !~ '[^[:space:]]'
        OR final_output."mime_type" IS DISTINCT FROM 'image/png'
        OR final_output."size_bytes" <= 0 OR final_output."size_bytes" > 20971520
        OR final_output."width" IS DISTINCT FROM 900 OR final_output."height" IS DISTINCT FROM 1200
        OR COALESCE(final_output."sha256", '') !~ '^[a-f0-9]{64}$'
        OR final_output."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-output/v1'
        OR (stored_suite."provider" = 'fake' AND final_output."metadata" ? 'providerOutputAssetId')
        OR (stored_suite."provider" <> 'fake' AND (
          asset_counts.raw_count <> 1
          OR final_output."metadata"->>'sourceCaptureSnapshotId' IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
          OR final_output."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'
          OR final_output."metadata"->>'providerOutputAssetId' IS DISTINCT FROM raw_output."id"
          OR final_output."sha256" IS DISTINCT FROM raw_output."metadata"->>'normalizedSha256'
          OR final_output."metadata"->>'normalizerVersion' IS DISTINCT FROM raw_output."metadata"->>'normalizerVersion'
        ))
      ))
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
            OR old_job."completed_at" IS NULL
            OR old_job."error_code" IS NULL
            OR old_reservation."id" IS NULL
            OR old_reservation."status" NOT IN ('SETTLED', 'RELEASED')
            OR EXISTS (
              SELECT 1 FROM "media_assets" old_output
              WHERE old_output."ai_image_job_id" = old_job."id"
                AND old_output."kind" NOT IN ('AI_PROVIDER_OUTPUT', 'AI_GENERATED')
            )
            OR (SELECT count(*) FROM "media_assets" old_final
                WHERE old_final."ai_image_job_id" = old_job."id"
                  AND old_final."kind" = 'AI_GENERATED') <> 0
            OR (SELECT count(*) FROM "media_assets" old_raw
                WHERE old_raw."ai_image_job_id" = old_job."id"
                  AND old_raw."kind" = 'AI_PROVIDER_OUTPUT') > 1
            OR (old_reservation."status" = 'RELEASED' AND (
              old_job."actual_cost_cents" IS NOT NULL
              OR old_job."billed_units" <> 0
              OR EXISTS (SELECT 1 FROM "media_assets" old_raw
                WHERE old_raw."ai_image_job_id" = old_job."id" AND old_raw."kind" = 'AI_PROVIDER_OUTPUT')
            ))
            OR (old_reservation."status" = 'SETTLED' AND (
              old_job."provider" = 'fake'
              OR old_job."actual_cost_cents" IS DISTINCT FROM old_job."estimated_cost_cents"
              OR old_job."billed_units" <> 1
            ))
          )
      )
      OR (slot."status" = 'PLANNED' AND (
        current_job."status" <> 'PENDING' OR workflow."status" <> 'QUEUED'
        OR workflow."review_status" <> 'NOT_READY'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 0 OR current_job."progress" <> 0
        OR current_job."started_at" IS NOT NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
        OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL OR asset_counts.raw_count <> 0 OR asset_counts.final_count <> 0
      ))
      OR (slot."status" = 'QUEUED' AND (
        current_job."status" <> 'QUEUED' OR workflow."status" <> 'QUEUED'
        OR workflow."review_status" <> 'NOT_READY'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 0 OR current_job."progress" <> 0
        OR current_job."started_at" IS NOT NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
        OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL OR asset_counts.raw_count <> 0 OR asset_counts.final_count <> 0
      ))
      OR (slot."status" IN ('RUNNING', 'CANCEL_REQUESTED') AND (
        current_job."status" IS DISTINCT FROM slot."status"::TEXT::"AiImageJobStatus"
        OR workflow."status" IS DISTINCT FROM slot."status"::TEXT::"AiMediaWorkflowStatus"
        OR workflow."review_status" <> 'NOT_READY'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 1 OR current_job."progress" NOT BETWEEN 1 AND 99
        OR current_job."started_at" IS NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL OR asset_counts.final_count <> 0
        OR (stored_suite."provider" = 'fake' AND (
          current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
          OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
          OR asset_counts.raw_count <> 0
        ))
        OR (stored_suite."provider" <> 'fake' AND NOT (
          (current_job."actual_cost_cents" IS NULL AND current_job."billed_units" = 0 AND asset_counts.raw_count = 0)
          OR (current_job."actual_cost_cents" = current_job."estimated_cost_cents"
            AND current_job."billed_units" = 1 AND current_job."provider_dispatched_at" IS NOT NULL)
        ))
      ))
      OR (slot."status" = 'SUCCEEDED' AND (
        current_job."status" <> 'SUCCEEDED' OR workflow."status" <> 'SUCCEEDED'
        OR workflow."review_status" NOT IN ('PENDING', 'APPROVED', 'REJECTED')
        OR current_reservation."status" <> 'SETTLED'
        OR current_job."progress" <> 100 OR current_job."completed_at" IS NULL
        OR current_job."actual_cost_cents" IS DISTINCT FROM current_job."estimated_cost_cents"
        OR current_job."billed_units" <> 1
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NULL OR asset_counts.final_count <> 1
        OR (stored_suite."provider" = 'fake' AND (
          asset_counts.raw_count <> 0
          OR current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
        ))
        OR (stored_suite."provider" <> 'fake' AND (
          asset_counts.raw_count <> 1 OR current_job."provider_dispatched_at" IS NULL
        ))
      ))
      OR (slot."status" IN ('FAILED', 'CANCELLED') AND (
        current_job."status" IS DISTINCT FROM slot."status"::TEXT::"AiImageJobStatus"
        OR workflow."status" IS DISTINCT FROM slot."status"::TEXT::"AiMediaWorkflowStatus"
        OR workflow."review_status" <> 'NOT_READY'
        OR current_job."progress" <> 0 OR current_job."completed_at" IS NULL
        OR current_job."error_code" IS NULL OR workflow."completed_at" IS NULL
        OR asset_counts.final_count <> 0
        OR NOT (
          (current_job."actual_cost_cents" IS NULL
            AND current_job."billed_units" = 0
            AND asset_counts.raw_count = 0
            AND current_reservation."status" IN ('RELEASED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'))
          OR (stored_suite."provider" <> 'fake'
            AND current_job."actual_cost_cents" = current_job."estimated_cost_cents"
            AND current_job."billed_units" = 1
            AND current_job."provider_dispatched_at" IS NOT NULL
            AND current_reservation."status" = 'SETTLED')
        )
      ))
    );
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite execution child graph is invalid' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Raw Provider evidence and the normalized review candidate are separate,
-- bounded assets. A fake/local suite keeps the legacy one-final-only shape.
CREATE OR REPLACE FUNCTION prevent_ai_media_suite_child_output_before_dispatch() RETURNS trigger AS $$
DECLARE
  child_job "ai_image_jobs"%ROWTYPE;
  stored_suite "ai_media_suites"%ROWTYPE;
  raw_output "media_assets"%ROWTYPE;
  raw_count INTEGER;
  final_count INTEGER;
BEGIN
  IF NEW."ai_image_job_id" IS NULL THEN RETURN NEW; END IF;
  SELECT job.* INTO child_job
  FROM "ai_image_jobs" job
  JOIN "ai_media_suite_slots" slot
    ON slot."child_workflow_id" = job."workflow_id" AND slot."owner_user_id" = job."owner_user_id"
  WHERE job."id" = NEW."ai_image_job_id";
  IF child_job."id" IS NULL THEN RETURN NEW; END IF;
  SELECT suite.* INTO stored_suite
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_suites" suite
    ON suite."id" = slot."suite_id" AND suite."owner_user_id" = slot."owner_user_id"
  WHERE slot."child_workflow_id" = child_job."workflow_id"
    AND slot."owner_user_id" = child_job."owner_user_id";
  IF stored_suite."id" IS NULL THEN RETURN NEW; END IF;

  SELECT
    count(*) FILTER (WHERE asset."kind" = 'AI_PROVIDER_OUTPUT')::INTEGER,
    count(*) FILTER (WHERE asset."kind" = 'AI_GENERATED')::INTEGER
  INTO raw_count, final_count
  FROM "media_assets" asset
  WHERE asset."ai_image_job_id" = child_job."id";

  IF stored_suite."revision" < 5 THEN
    RAISE EXCEPTION 'AI media suite child output requires the dispatch contract' USING ERRCODE = '23514';
  END IF;

  IF NEW."owner_user_id" IS DISTINCT FROM child_job."owner_user_id"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
    OR NEW."source_media_key" IS NOT NULL OR NEW."source_url" IS NOT NULL
    OR NEW."storage_backend" NOT IN ('local', 'oss')
    OR COALESCE(NEW."storage_key", '') !~ '[^[:space:]]'
    OR COALESCE(NEW."url", '') !~ '[^[:space:]]'
    OR NEW."size_bytes" <= 0 OR NEW."size_bytes" > 20971520
    OR COALESCE(NEW."sha256", '') !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'AI media suite child output identity is invalid' USING ERRCODE = '23514';
  END IF;

  IF NEW."kind" = 'AI_PROVIDER_OUTPUT' THEN
    IF stored_suite."provider" = 'fake'
      OR child_job."status" NOT IN ('RUNNING', 'CANCEL_REQUESTED')
      OR child_job."provider_dispatched_at" IS NULL
      OR child_job."actual_cost_cents" IS DISTINCT FROM child_job."estimated_cost_cents"
      OR child_job."billed_units" IS DISTINCT FROM 1
      OR raw_count >= 1 OR final_count <> 0
      OR NEW."mime_type" NOT IN ('image/png', 'image/jpeg', 'image/webp')
      OR NEW."width" IS DISTINCT FROM 1024 OR NEW."height" IS DISTINCT FROM 1536
      OR NEW."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-provider-output/v1'
      OR NEW."metadata"->>'sourceCaptureSnapshotId' IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
      OR NEW."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'
      OR COALESCE(NEW."metadata"->>'normalizedSha256', '') !~ '^[a-f0-9]{64}$'
      OR COALESCE(NEW."metadata"->>'actualCostCents', '') !~ '^[0-9]+$'
      OR (NEW."metadata"->>'actualCostCents')::BIGINT IS DISTINCT FROM child_job."actual_cost_cents"::BIGINT
      OR COALESCE(NEW."metadata"->>'providerResultReceivedAt', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
      OR (
        child_job."provider_job_id" IS NULL
        AND jsonb_typeof(NEW."metadata"->'providerJobId') IS DISTINCT FROM 'null'
      )
      OR (
        child_job."provider_job_id" IS NOT NULL
        AND NEW."metadata"->>'providerJobId' IS DISTINCT FROM child_job."provider_job_id"
      )
    THEN
      RAISE EXCEPTION 'AI media suite raw Provider output is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."kind" <> 'AI_GENERATED'
    OR child_job."status" <> 'SUCCEEDED'
    OR final_count >= child_job."requested_image_count"
    OR NEW."mime_type" <> 'image/png'
    OR NEW."width" IS DISTINCT FROM 900 OR NEW."height" IS DISTINCT FROM 1200
    OR NEW."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-output/v1'
  THEN
    RAISE EXCEPTION 'AI media suite final output is invalid' USING ERRCODE = '23514';
  END IF;

  IF stored_suite."provider" = 'fake' THEN
    IF raw_count <> 0 OR NEW."metadata" ? 'providerOutputAssetId' THEN
      RAISE EXCEPTION 'fake AI media suite final output cannot bind Provider evidence' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO raw_output
  FROM "media_assets" asset
  WHERE asset."ai_image_job_id" = child_job."id"
    AND asset."owner_user_id" = child_job."owner_user_id"
    AND asset."kind" = 'AI_PROVIDER_OUTPUT';
  IF raw_count <> 1
    OR raw_output."id" IS NULL
    OR NEW."metadata"->>'providerOutputAssetId' IS DISTINCT FROM raw_output."id"
    OR NEW."sha256" IS DISTINCT FROM raw_output."metadata"->>'normalizedSha256'
    OR NEW."metadata"->>'normalizerVersion' IS DISTINCT FROM raw_output."metadata"->>'normalizerVersion'
  THEN
    RAISE EXCEPTION 'paid AI media suite final output is not bound to its raw Provider output' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "media_assets_suite_child_output_before_dispatch" ON "media_assets";
CREATE TRIGGER "media_assets_suite_child_output_before_dispatch"
BEFORE INSERT OR UPDATE OF "ai_image_job_id" ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION prevent_ai_media_suite_child_output_before_dispatch();

-- The previous fake-suite completion path persisted a fully bound final output
-- before source_capture_snapshot_id was added to the asset data. Those outputs
-- are already referenced by immutable lineage, so repair only that exact legacy
-- shape under the migration's table lock, then immediately restore the existing
-- identity trigger. This does not relax any trigger for post-migration writes.
ALTER TABLE "media_assets"
DISABLE TRIGGER "media_assets_referenced_identity_immutable";

UPDATE "media_assets" AS asset
SET "source_capture_snapshot_id" = suite."source_capture_snapshot_id"
FROM "ai_image_jobs" AS job
JOIN "ai_media_workflows" AS workflow
  ON workflow."id" = job."workflow_id"
 AND workflow."owner_user_id" = job."owner_user_id"
JOIN "ai_media_suite_slots" AS slot
  ON slot."child_workflow_id" = workflow."id"
 AND slot."owner_user_id" = workflow."owner_user_id"
JOIN "ai_media_suites" AS suite
  ON suite."id" = slot."suite_id"
 AND suite."owner_user_id" = slot."owner_user_id"
WHERE asset."ai_image_job_id" = job."id"
  AND asset."owner_user_id" = job."owner_user_id"
  AND job."workflow_attempt" = slot."attempt"
  AND job."status" = 'SUCCEEDED'
  AND workflow."status" = 'SUCCEEDED'
  AND slot."status" = 'SUCCEEDED'
  AND suite."revision" >= 5
  AND suite."provider" = 'fake'
  AND asset."kind" = 'AI_GENERATED'
  AND asset."source_capture_snapshot_id" IS NULL
  AND asset."metadata"->>'version' = 'ai-image-suite-output/v1'
  AND asset."metadata"->>'suiteId' = suite."id"
  AND asset."metadata"->>'slotId' = slot."id"
  AND COALESCE(asset."metadata"->>'attempt', '') ~ '^[1-9][0-9]*$'
  AND (asset."metadata"->>'attempt')::INTEGER = job."workflow_attempt";

-- Flush the backfill's pre-existing deferred asset graph events before the
-- trigger DDL below; PostgreSQL rejects ALTER TABLE with pending events.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE "media_assets"
ENABLE TRIGGER "media_assets_referenced_identity_immutable";

SET CONSTRAINTS ALL DEFERRED;

CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_asset_identity() RETURNS trigger AS $$
DECLARE
  is_suite_child BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM "ai_image_jobs" job
    JOIN "ai_media_suite_slots" slot
      ON slot."child_workflow_id" = job."workflow_id" AND slot."owner_user_id" = job."owner_user_id"
    WHERE job."id" = OLD."ai_image_job_id" AND job."owner_user_id" = OLD."owner_user_id"
  ) INTO is_suite_child;
  IF NOT is_suite_child THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media suite child output evidence cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF ROW(
    NEW."id", NEW."owner_user_id", NEW."ai_image_job_id", NEW."kind", NEW."source_capture_snapshot_id",
    NEW."source_media_key", NEW."source_url",
    NEW."url", NEW."storage_backend", NEW."storage_key", NEW."mime_type", NEW."size_bytes",
    NEW."width", NEW."height", NEW."sha256", NEW."metadata", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."owner_user_id", OLD."ai_image_job_id", OLD."kind", OLD."source_capture_snapshot_id",
    OLD."source_media_key", OLD."source_url",
    OLD."url", OLD."storage_backend", OLD."storage_key", OLD."mime_type", OLD."size_bytes",
    OLD."width", OLD."height", OLD."sha256", OLD."metadata", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'AI media suite child output evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "media_assets_suite_child_identity_protected" ON "media_assets";
CREATE TRIGGER "media_assets_suite_child_identity_protected"
BEFORE UPDATE OR DELETE ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_child_asset_identity();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_selected_output() RETURNS trigger AS $$
DECLARE
  bound_slot "ai_media_suite_slots"%ROWTYPE;
  stored_suite "ai_media_suites"%ROWTYPE;
  selected_asset "media_assets"%ROWTYPE;
  current_job "ai_image_jobs"%ROWTYPE;
  raw_output "media_assets"%ROWTYPE;
BEGIN
  SELECT * INTO bound_slot
  FROM "ai_media_suite_slots"
  WHERE "child_workflow_id" = OLD."id" AND "owner_user_id" = OLD."owner_user_id";
  IF bound_slot."id" IS NULL THEN RETURN NEW; END IF;
  IF NEW."selected_output_asset_id" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO stored_suite FROM "ai_media_suites"
  WHERE "id" = bound_slot."suite_id" AND "owner_user_id" = bound_slot."owner_user_id";
  SELECT * INTO current_job FROM "ai_image_jobs"
  WHERE "workflow_id" = NEW."id" AND "owner_user_id" = NEW."owner_user_id"
    AND "workflow_attempt" = NEW."current_attempt";
  SELECT * INTO selected_asset FROM "media_assets"
  WHERE "id" = NEW."selected_output_asset_id" AND "owner_user_id" = NEW."owner_user_id";
  IF current_job."id" IS NULL
    OR current_job."status" <> 'SUCCEEDED'
    OR selected_asset."ai_image_job_id" IS DISTINCT FROM current_job."id"
    OR selected_asset."kind" IS DISTINCT FROM 'AI_GENERATED'
    OR selected_asset."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
  THEN
    RAISE EXCEPTION 'AI media suite selection requires the normalized current output' USING ERRCODE = '23514';
  END IF;
  IF stored_suite."provider" <> 'fake' THEN
    SELECT * INTO raw_output FROM "media_assets"
    WHERE "ai_image_job_id" = current_job."id" AND "owner_user_id" = current_job."owner_user_id"
      AND "kind" = 'AI_PROVIDER_OUTPUT';
    IF raw_output."id" IS NULL
      OR selected_asset."metadata"->>'providerOutputAssetId' IS DISTINCT FROM raw_output."id"
      OR selected_asset."sha256" IS DISTINCT FROM raw_output."metadata"->>'normalizedSha256'
    THEN
      RAISE EXCEPTION 'AI media suite selected output is not bound to Provider evidence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ai_media_workflows_suite_selected_output_protected" ON "ai_media_workflows";
CREATE TRIGGER "ai_media_workflows_suite_selected_output_protected"
BEFORE UPDATE OF "selected_output_asset_id", "review_status" ON "ai_media_workflows"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_selected_output();

-- A normal retry is intentionally narrower than a terminal graph. It may
-- submit a new paid request only after the previous request is proven to have
-- produced no billable output and its reservation was released.
CREATE OR REPLACE FUNCTION prevent_ai_media_suite_bound_child_insert() RETURNS trigger AS $$
DECLARE
  stored_slot "ai_media_suite_slots"%ROWTYPE;
  stored_suite "ai_media_suites"%ROWTYPE;
  first_job "ai_image_jobs"%ROWTYPE;
  previous_job "ai_image_jobs"%ROWTYPE;
  previous_reservation "ai_cost_reservations"%ROWTYPE;
  maximum_attempt INTEGER;
  previous_asset_count INTEGER;
  unsafe_attempt_count INTEGER;
BEGIN
  SELECT slot.* INTO stored_slot
  FROM "ai_media_suite_slots" slot
  WHERE slot."child_workflow_id" = NEW."workflow_id"
    AND slot."owner_user_id" = NEW."owner_user_id";

  IF stored_slot."id" IS NULL THEN RETURN NEW; END IF;
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
  SELECT count(*)::INTEGER INTO previous_asset_count
  FROM "media_assets"
  WHERE "ai_image_job_id" = previous_job."id"
    AND "owner_user_id" = previous_job."owner_user_id";
  SELECT count(*)::INTEGER INTO unsafe_attempt_count
  FROM "ai_image_jobs" attempt_job
  LEFT JOIN "ai_cost_reservations" attempt_reservation
    ON attempt_reservation."job_id" = attempt_job."id"
   AND attempt_reservation."owner_user_id" = attempt_job."owner_user_id"
  WHERE attempt_job."workflow_id" = NEW."workflow_id"
    AND attempt_job."owner_user_id" = NEW."owner_user_id"
    AND attempt_job."workflow_attempt" <= maximum_attempt
    AND (
      attempt_job."status" IS DISTINCT FROM 'FAILED'
      OR attempt_reservation."id" IS NULL
      OR attempt_reservation."status" IS DISTINCT FROM 'RELEASED'
      OR attempt_job."actual_cost_cents" IS NOT NULL
      OR attempt_job."billed_units" IS DISTINCT FROM 0
      OR EXISTS (
        SELECT 1 FROM "media_assets" attempt_asset
        WHERE attempt_asset."ai_image_job_id" = attempt_job."id"
          AND attempt_asset."owner_user_id" = attempt_job."owner_user_id"
      )
      OR attempt_job."provider_reconciliation_lease_owner" IS NOT NULL
      OR attempt_job."provider_reconciliation_lease_token_hash" IS NOT NULL
      OR attempt_job."provider_reconciliation_lease_expires_at" IS NOT NULL
      OR (
        stored_suite."provider" <> 'fake'
        AND NOT (
          (
            attempt_job."provider_reconciliation_status" = 'NOT_REQUIRED'
            AND attempt_job."provider_dispatched_at" IS NULL
            AND attempt_job."provider_job_id" IS NULL
          )
          OR (
            attempt_job."provider_reconciliation_status" IN ('NOT_SUBMITTED', 'NO_OUTPUT')
            AND attempt_job."provider_reconciled_at" IS NOT NULL
          )
        )
      )
    );

  IF first_job."id" IS NULL
    OR previous_job."id" IS NULL
    OR previous_reservation."id" IS NULL
    OR NEW."workflow_attempt" IS DISTINCT FROM maximum_attempt + 1
    OR stored_slot."status" IS DISTINCT FROM 'FAILED'
    OR stored_slot."attempt" IS DISTINCT FROM maximum_attempt
    OR previous_job."status" IS DISTINCT FROM 'FAILED'
    OR previous_reservation."status" IS DISTINCT FROM 'RELEASED'
    OR previous_job."actual_cost_cents" IS NOT NULL
    OR previous_job."billed_units" IS DISTINCT FROM 0
    OR previous_asset_count IS DISTINCT FROM 0
    OR unsafe_attempt_count IS DISTINCT FROM 0
    OR previous_job."provider_reconciliation_lease_owner" IS NOT NULL
    OR previous_job."provider_reconciliation_lease_token_hash" IS NOT NULL
    OR previous_job."provider_reconciliation_lease_expires_at" IS NOT NULL
    OR (
      stored_suite."provider" <> 'fake'
      AND NOT (
        (
          previous_job."provider_reconciliation_status" = 'NOT_REQUIRED'
          AND previous_job."provider_dispatched_at" IS NULL
          AND previous_job."provider_job_id" IS NULL
        )
        OR (
          previous_job."provider_reconciliation_status" IN ('NOT_SUBMITTED', 'NO_OUTPUT')
          AND previous_job."provider_reconciled_at" IS NOT NULL
        )
      )
    )
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
    RAISE EXCEPTION 'AI media suite retry attempt lacks released no-output authority or frozen identity' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_asset() RETURNS trigger AS $$
DECLARE
  bound_slot RECORD;
  bound_job_id TEXT;
  bound_owner_user_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    bound_job_id := OLD."ai_image_job_id";
    bound_owner_user_id := OLD."owner_user_id";
  ELSE
    bound_job_id := NEW."ai_image_job_id";
    bound_owner_user_id := NEW."owner_user_id";
  END IF;
  SELECT slot."suite_id", slot."owner_user_id" INTO bound_slot
  FROM "ai_image_jobs" job
  JOIN "ai_media_suite_slots" slot
    ON slot."child_workflow_id" = job."workflow_id" AND slot."owner_user_id" = job."owner_user_id"
  WHERE job."id" = bound_job_id AND job."owner_user_id" = bound_owner_user_id;
  IF bound_slot."suite_id" IS NOT NULL THEN
    PERFORM assert_ai_media_suite_execution_graph(bound_slot."suite_id", bound_slot."owner_user_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "ai_media_suite_execution_asset_graph" ON "media_assets";
CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_asset_graph"
AFTER INSERT OR UPDATE OR DELETE ON "media_assets"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_asset();

COMMIT;
