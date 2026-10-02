BEGIN;

-- The existing terminal state CANCELLED_OUTPUT_RETAINED is also the durable
-- representation for a Provider result that ERP deliberately will not recover.
-- The application owner exposes this only as ABANDON and verifies the full
-- historical suite evidence. This migration adds the one missing transition;
-- it does not reinterpret NO_OUTPUT or erase Provider output facts.
DO $migration$
DECLARE
  definition text;
  old_transition text := $old$OLD."provider_reconciliation_status" = 'MANUAL_REVIEW'
        AND NEW."provider_reconciliation_status" IN ('PENDING', 'NO_OUTPUT', 'NOT_SUBMITTED')$old$;
  new_transition text := $new$OLD."provider_reconciliation_status" = 'MANUAL_REVIEW'
        AND NEW."provider_reconciliation_status" IN ('PENDING', 'NO_OUTPUT', 'NOT_SUBMITTED', 'CANCELLED_OUTPUT_RETAINED')
        AND (
          NEW."provider_reconciliation_status" <> 'CANCELLED_OUTPUT_RETAINED'
          OR (
            OLD."status" = 'FAILED'
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
            )
          )
        )$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema()
    AND p.proname = 'validate_ai_provider_reconciliation_transition'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF definition IS NULL THEN
    RAISE EXCEPTION 'AI provider reconciliation transition owner is missing';
  END IF;
  -- pg_get_functiondef preserves the platform line ending used when the
  -- function was installed. Normalize it before matching the audited clause.
  definition := REPLACE(definition, CHR(13), '');
  IF POSITION(old_transition IN definition) = 0 THEN
    RAISE EXCEPTION 'AI provider reconciliation transition owner drifted';
  END IF;

  definition := REPLACE(definition, old_transition, new_transition);
  EXECUTE definition;
END $migration$;

COMMIT;
