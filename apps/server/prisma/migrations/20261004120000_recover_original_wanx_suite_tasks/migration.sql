BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- This exception is an atomic reconciliation of the original accepted task.
-- The immutable RESUME decision and this transaction's completion audit are
-- required; a session flag or an old audit record cannot reopen a failed job.
CREATE FUNCTION ai_media_suite_original_task_recovery_allowed(target_job_id TEXT) RETURNS BOOLEAN AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM "ai_image_jobs" job
    JOIN "ai_media_workflows" workflow ON workflow."id"=job."workflow_id" AND workflow."owner_user_id"=job."owner_user_id"
    JOIN "ai_media_suite_slots" slot ON slot."child_workflow_id"=workflow."id" AND slot."owner_user_id"=job."owner_user_id"
    JOIN "ai_media_suites" suite ON suite."id"=slot."suite_id" AND suite."owner_user_id"=job."owner_user_id"
    JOIN "ai_cost_reservations" cost ON cost."job_id"=job."id" AND cost."owner_user_id"=job."owner_user_id"
    JOIN "ai_provider_reconciliation_events" resumed ON resumed."job_id"=job."id" AND resumed."owner_user_id"=job."owner_user_id"
      AND resumed."workflow_id"=job."workflow_id" AND resumed."event_type"='PROVIDER_RECONCILIATION_RESUME'
    JOIN "ai_provider_reconciliation_events" completed ON completed."job_id"=job."id" AND completed."owner_user_id"=job."owner_user_id"
      AND completed."workflow_id"=job."workflow_id" AND completed."event_type"='PROVIDER_RECONCILIATION_SUITE_RECOVERED'
    WHERE job."id"=target_job_id AND job."operation"='IMAGE_TO_IMAGE'
      AND job."provider"='dashscope-wanx' AND job."model"='wanx2.1-imageedit'
      AND suite."provider"=job."provider" AND suite."model"=job."model"
      AND suite."item_count" BETWEEN 1 AND 2 AND suite."maximum_cost_cents" BETWEEN 1 AND 28
      AND suite."cancel_requested_at" IS NULL AND workflow."cancel_requested_at" IS NULL
      AND job."workflow_attempt"=slot."attempt" AND workflow."current_attempt"=slot."attempt"
      AND job."attempt_count"=1 AND job."max_attempts"=1 AND job."requested_image_count"=1
      AND job."width"=900 AND job."height"=1200
      AND job."estimated_cost_cents" BETWEEN 1 AND 14
      AND cost."estimated_cost_minor"=job."estimated_cost_cents" AND cost."maximum_cost_minor"=job."estimated_cost_cents"
      AND cost."currency"='CNY' AND cost."operation"=job."operation" AND cost."provider"=job."provider" AND cost."model"=job."model"
      AND cost."workflow_id"=workflow."id" AND cost."actor_user_id"=job."actor_user_id"
      AND cost."request_fingerprint"=job."request_fingerprint"
      AND cost."provider_request_id"=job."provider_job_id" AND btrim(job."provider_job_id")<>''
      AND cost."provider_accepted_at" IS NOT NULL AND job."provider_dispatched_at" IS NOT NULL
      AND job."provider_reconciliation_deadline_at" > statement_timestamp()
      AND job."provider_reconciliation_deadline_at" <= LEAST(cost."provider_accepted_at",job."provider_dispatched_at")+INTERVAL '24 hours'
      AND resumed."payload"->>'expectedStatus'='MANUAL_REVIEW'
      AND resumed."payload"->>'expectedRevision'=(resumed."reconciliation_revision"-1)::text
      AND resumed."payload"->>'providerJobId'=job."provider_job_id"
      AND resumed."payload"#>>'{suiteRecovery,version}'='ai-image-suite-original-task-recovery/v1'
      AND resumed."payload"#>>'{suiteRecovery,originalJobStatus}'='FAILED'
      AND resumed."payload"#>>'{suiteRecovery,originalErrorCode}'='PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'
      AND resumed."payload"#>>'{suiteRecovery,jobId}'=job."id"
      AND resumed."payload"#>>'{suiteRecovery,suiteId}'=suite."id"
      AND resumed."payload"#>>'{suiteRecovery,slotId}'=slot."id"
      AND resumed."payload"#>>'{suiteRecovery,snapshotId}'=suite."source_capture_snapshot_id"
      AND resumed."payload"#>>'{suiteRecovery,attempt}'=job."workflow_attempt"::text
      AND resumed."payload"#>>'{suiteRecovery,reservationId}'=cost."id"
      AND resumed."payload"#>>'{suiteRecovery,requestFingerprint}'=job."request_fingerprint"
      AND resumed."payload"->'suiteRecovery'=completed."payload"->'suiteRecovery'
      AND completed."payload"->>'providerJobId'=job."provider_job_id"
      AND completed."payload"->>'transactionId'=txid_current()::text
      AND (
        (job."status"='FAILED' AND job."error_code"='PROVIDER_OUTPUT_DIMENSIONS_MISMATCH'
          AND job."provider_reconciliation_status"='RUNNING'
          AND completed."reconciliation_revision"=job."provider_reconciliation_revision"+1
          AND completed."payload"->>'claimedRevision'=job."provider_reconciliation_revision"::text
          AND completed."payload"->>'leaseTokenHash'=job."provider_reconciliation_lease_token_hash"
          AND job."provider_reconciliation_lease_expires_at">statement_timestamp())
        OR (job."status"='SUCCEEDED' AND job."provider_reconciliation_status"='RECOVERED'
          AND completed."reconciliation_revision"=job."provider_reconciliation_revision")
      )
  ),false);
$$ LANGUAGE SQL STABLE;

-- Preserve each existing trigger body and add only a predicate-guarded term.
DO $$
DECLARE definition TEXT; old_term TEXT; new_term TEXT;
BEGIN
  SELECT pg_get_functiondef('protect_ai_media_suite_child_job_lifecycle()'::regprocedure) INTO definition;
  definition := replace(definition,E'\r\n',E'\n');
  old_term := $term$(OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND NEW."status" = OLD."status")$term$;
  new_term := old_term || $term$
    OR (OLD."status"='FAILED' AND NEW."status"='SUCCEEDED'
      AND ai_media_suite_original_task_recovery_allowed(OLD."id")
      AND NEW."workflow_attempt"=OLD."workflow_attempt" AND NEW."attempt_count"=OLD."attempt_count"
      AND NEW."provider_job_id"=OLD."provider_job_id" AND NEW."request_fingerprint"=OLD."request_fingerprint"
      AND NEW."provider_reconciliation_status"='RECOVERED')$term$;
  IF position(old_term IN definition)=0 THEN RAISE EXCEPTION 'suite job lifecycle owner drifted'; END IF;
  EXECUTE replace(definition,old_term,new_term);

  SELECT pg_get_functiondef('protect_ai_media_suite_child_lifecycle()'::regprocedure) INTO definition;
  definition := replace(definition,E'\r\n',E'\n');
  old_term := $term$(OLD."status" = NEW."status")$term$;
  new_term := old_term || $term$
    OR (OLD."status"='FAILED' AND NEW."status"='SUCCEEDED'
      AND NEW."current_attempt"=OLD."current_attempt" AND NEW."review_status"='PENDING'
      AND NEW."selected_output_asset_id" IS NULL AND EXISTS (
        SELECT 1 FROM "ai_image_jobs" job WHERE job."workflow_id"=OLD."id"
          AND job."workflow_attempt"=OLD."current_attempt" AND ai_media_suite_original_task_recovery_allowed(job."id")))$term$;
  IF position(old_term IN definition)=0 THEN RAISE EXCEPTION 'suite workflow lifecycle owner drifted'; END IF;
  EXECUTE replace(definition,old_term,new_term);

  SELECT pg_get_functiondef('protect_ai_media_suite_materialized_slot_lifecycle()'::regprocedure) INTO definition;
  definition := replace(definition,E'\r\n',E'\n');
  old_term := $term$(OLD."status" = 'FAILED' AND NEW."status" = 'QUEUED')$term$;
  new_term := old_term || $term$
    OR (OLD."status"='FAILED' AND NEW."status"='SUCCEEDED' AND NEW."attempt"=OLD."attempt"
      AND EXISTS (SELECT 1 FROM "ai_image_jobs" job WHERE job."workflow_id"=OLD."child_workflow_id"
        AND job."workflow_attempt"=OLD."attempt" AND ai_media_suite_original_task_recovery_allowed(job."id")))$term$;
  IF position(old_term IN definition)=0 THEN RAISE EXCEPTION 'suite slot lifecycle owner drifted'; END IF;
  EXECUTE replace(definition,old_term,new_term);

  SELECT pg_get_functiondef('validate_ai_media_suite_execution_transition()'::regprocedure) INTO definition;
  definition := replace(definition,E'\r\n',E'\n');
  old_term := $term$(OLD."status" IN ('PARTIAL_FAILURE', 'FAILED') AND NEW."status" = 'QUEUED')$term$;
  new_term := old_term || $term$
    OR (OLD."status" IN ('PARTIAL_FAILURE','FAILED') AND NEW."status" IN ('PARTIAL_FAILURE','SUCCEEDED')
      AND EXISTS (SELECT 1 FROM "ai_media_suite_slots" slot JOIN "ai_image_jobs" job ON job."workflow_id"=slot."child_workflow_id"
        JOIN "ai_provider_reconciliation_events" event ON event."job_id"=job."id"
        WHERE slot."suite_id"=OLD."id" AND slot."owner_user_id"=OLD."owner_user_id"
          AND job."workflow_attempt"=slot."attempt" AND ai_media_suite_original_task_recovery_allowed(job."id")
          AND event."event_type"='PROVIDER_RECONCILIATION_SUITE_RECOVERED'
          AND event."payload"->>'transactionId'=txid_current()::text
          AND event."payload"->>'beforeSuiteRevision'=OLD."revision"::text))$term$;
  IF position(old_term IN definition)=0 THEN RAISE EXCEPTION 'suite parent transition owner drifted'; END IF;
  EXECUTE replace(definition,old_term,new_term);

  SELECT pg_get_functiondef('prevent_ai_media_suite_child_output_before_dispatch()'::regprocedure) INTO definition;
  definition := replace(definition,E'\r\n',E'\n');
  old_term := $term$child_job."status" NOT IN ('RUNNING', 'CANCEL_REQUESTED')$term$;
  new_term := $term$(child_job."status" NOT IN ('RUNNING', 'CANCEL_REQUESTED')
        AND NOT (child_job."status"='FAILED' AND ai_media_suite_original_task_recovery_allowed(child_job."id")))$term$;
  IF position(old_term IN definition)=0 THEN RAISE EXCEPTION 'suite raw insert lifecycle owner drifted'; END IF;
  EXECUTE replace(definition,old_term,new_term);
END;
$$;

-- Physical dimensions belong to the raw bytes. Frozen Provider requests remain
-- 1024x1024 and final candidates remain 900x1200; only known Wanx fallbacks pass.
DO $$
DECLARE definition TEXT; old_term TEXT; new_term TEXT;
BEGIN
  SELECT pg_get_functiondef('assert_ai_media_suite_execution_graph(text,text)'::regprocedure) INTO definition;
  definition := replace(definition,E'\r\n',E'\n');
  old_term := $term$raw_output."width" IS DISTINCT FROM 1024 OR raw_output."height" IS DISTINCT FROM CASE WHEN wanx_suite THEN 1024 ELSE 1536 END$term$;
  new_term := $term$NOT (CASE WHEN wanx_suite THEN
          (raw_output."width",raw_output."height") IN ((1024,1024),(1024,1536),(880,880),(800,800))
          ELSE raw_output."width"=1024 AND raw_output."height"=1536 END)$term$;
  IF position(old_term IN definition)=0 THEN RAISE EXCEPTION 'suite raw graph dimensions owner drifted'; END IF;
  EXECUTE replace(definition,old_term,new_term);
  SELECT pg_get_functiondef('prevent_ai_media_suite_child_output_before_dispatch()'::regprocedure) INTO definition;
  definition := replace(definition,E'\r\n',E'\n');
  old_term := $term$NEW."width" IS DISTINCT FROM 1024 OR NEW."height" IS DISTINCT FROM (CASE WHEN wanx_suite THEN 1024 ELSE 1536 END)$term$;
  new_term := $term$NOT (CASE WHEN wanx_suite THEN
        (NEW."width",NEW."height") IN ((1024,1024),(1024,1536),(880,880),(800,800))
        ELSE NEW."width"=1024 AND NEW."height"=1536 END)$term$;
  IF position(old_term IN definition)=0 THEN RAISE EXCEPTION 'suite raw insert dimensions owner drifted'; END IF;
  EXECUTE replace(definition,old_term,new_term);
END;
$$;
COMMIT;
