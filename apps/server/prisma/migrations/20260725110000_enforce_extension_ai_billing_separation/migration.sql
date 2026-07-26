BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- AI jobs are the ERP-hosted execution ledger. Extension BYOK execution has
-- its own fixed-mode provenance table and must never be relabelled as a hosted
-- job to influence billing.
ALTER TABLE "ai_image_jobs"
  ADD COLUMN "execution_mode" VARCHAR(20) NOT NULL DEFAULT 'ERP_HOSTED',
  ADD CONSTRAINT "ai_image_jobs_execution_mode_check" CHECK (
    "execution_mode" = 'ERP_HOSTED'
  );

-- A paid Provider dispatch is legal only after the server has created the
-- exact live reservation for the frozen job. INSERT cannot carry a dispatch
-- timestamp because the reservation foreign key can only be created after the
-- job row exists.
CREATE OR REPLACE FUNCTION protect_ai_image_provider_dispatch() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF lower(NEW."provider") <> 'fake' AND NEW."provider_dispatched_at" IS NOT NULL THEN
      RAISE EXCEPTION 'AI image provider dispatch cannot exist at job creation' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."provider_dispatched_at" IS NOT NULL
    AND NEW."provider_dispatched_at" IS DISTINCT FROM OLD."provider_dispatched_at" THEN
    RAISE EXCEPTION 'AI image provider dispatch time is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."provider_dispatched_at" IS NULL
    AND NEW."provider_dispatched_at" IS NOT NULL THEN
    IF OLD."status" <> 'RUNNING' OR OLD."provider_job_id" IS NOT NULL THEN
      RAISE EXCEPTION 'AI image provider dispatch may only start for an unbound running job' USING ERRCODE = '23514';
    END IF;

    IF lower(NEW."provider") <> 'fake' AND NOT EXISTS (
      SELECT 1
      FROM "ai_cost_reservations" reservation
      WHERE reservation."job_id" = NEW."id"
        AND reservation."owner_user_id" = NEW."owner_user_id"
        AND reservation."actor_user_id" = NEW."actor_user_id"
        AND reservation."workflow_id" IS NOT DISTINCT FROM NEW."workflow_id"
        AND reservation."provider" = NEW."provider"
        AND reservation."model" = NEW."model"
        AND reservation."operation" = NEW."operation"
        AND reservation."request_fingerprint" = NEW."request_fingerprint"
        AND reservation."estimated_cost_minor" = NEW."estimated_cost_cents"
        AND reservation."maximum_cost_minor" >= reservation."estimated_cost_minor"
        AND reservation."status" = 'RESERVED'
        AND reservation."provider_request_id" IS NULL
        AND reservation."provider_accepted_at" IS NULL
        AND reservation."reconciliation_required_at" IS NULL
        AND reservation."settled_at" IS NULL
        AND reservation."released_at" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ai_cost_settlements" settlement
          WHERE settlement."reservation_id" = reservation."id"
        )
    ) THEN
      RAISE EXCEPTION 'paid AI image provider dispatch requires an exact RESERVED cost reservation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ai_image_jobs_protect_provider_dispatch" ON "ai_image_jobs";
CREATE TRIGGER "ai_image_jobs_protect_provider_dispatch"
BEFORE INSERT OR UPDATE OF "provider_dispatched_at" ON "ai_image_jobs"
FOR EACH ROW EXECUTE FUNCTION protect_ai_image_provider_dispatch();

-- A successful paid hosted job must project the charge already committed to
-- the append-only settlement ledger. The application settles first and then
-- transitions the job in the same transaction, so either both persist or both
-- roll back.
CREATE OR REPLACE FUNCTION protect_ai_cost_job_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM "ai_cost_reservations" reservation
    WHERE reservation."job_id" = OLD."id" AND reservation."owner_user_id" = OLD."owner_user_id"
  ) AND ROW(
    NEW."owner_user_id", NEW."workflow_id", NEW."provider", NEW."model", NEW."operation", NEW."request_fingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."owner_user_id", OLD."workflow_id", OLD."provider", OLD."model", OLD."operation", OLD."request_fingerprint"
  ) THEN
    RAISE EXCEPTION 'costed AI job identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF lower(NEW."provider") <> 'fake'
    AND NEW."status" = 'SUCCEEDED'
    AND NOT EXISTS (
      SELECT 1
      FROM "ai_cost_reservations" reservation
      JOIN "ai_cost_settlements" settlement
        ON settlement."reservation_id" = reservation."id"
       AND settlement."owner_user_id" = reservation."owner_user_id"
      WHERE reservation."job_id" = NEW."id"
        AND reservation."owner_user_id" = NEW."owner_user_id"
        AND reservation."actor_user_id" = NEW."actor_user_id"
        AND reservation."workflow_id" IS NOT DISTINCT FROM NEW."workflow_id"
        AND reservation."provider" = NEW."provider"
        AND reservation."model" = NEW."model"
        AND reservation."operation" = NEW."operation"
        AND reservation."request_fingerprint" = NEW."request_fingerprint"
        AND reservation."estimated_cost_minor" = NEW."estimated_cost_cents"
        AND reservation."status" = 'SETTLED'
        AND reservation."settled_at" IS NOT NULL
        AND settlement."kind" IN ('CHARGE', 'RECONCILED_CHARGE')
        AND settlement."request_fingerprint" = NEW."request_fingerprint"
        AND settlement."actual_cost_minor" = NEW."actual_cost_cents"
        AND settlement."billed_units" = NEW."billed_units"
    ) THEN
      RAISE EXCEPTION 'successful paid AI image job requires its exact cost settlement' USING ERRCODE = '23514';
    END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_ai_cost_job_identity ON "ai_image_jobs";
CREATE TRIGGER protect_ai_cost_job_identity
  BEFORE INSERT OR UPDATE ON "ai_image_jobs"
  FOR EACH ROW EXECUTE FUNCTION protect_ai_cost_job_identity();

COMMIT;
