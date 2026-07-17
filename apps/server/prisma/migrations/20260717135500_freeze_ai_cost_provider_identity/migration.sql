BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE OR REPLACE FUNCTION ai_cost_reservation_update_validate() RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."owner_user_id", NEW."actor_user_id", NEW."workflow_id", NEW."job_id",
    NEW."idempotency_key", NEW."request_fingerprint", NEW."provider", NEW."model", NEW."operation",
    NEW."currency", NEW."rounding_mode", NEW."estimated_cost_minor", NEW."maximum_cost_minor", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."owner_user_id", OLD."actor_user_id", OLD."workflow_id", OLD."job_id",
    OLD."idempotency_key", OLD."request_fingerprint", OLD."provider", OLD."model", OLD."operation",
    OLD."currency", OLD."rounding_mode", OLD."estimated_cost_minor", OLD."maximum_cost_minor", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'cost reservation identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD."provider_request_id" IS NOT NULL AND NEW."provider_request_id" IS DISTINCT FROM OLD."provider_request_id" THEN
    RAISE EXCEPTION 'cost provider request identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."provider_accepted_at" IS NOT NULL AND NEW."provider_accepted_at" IS DISTINCT FROM OLD."provider_accepted_at" THEN
    RAISE EXCEPTION 'cost provider acceptance time is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."provider_request_id" IS NULL AND NEW."provider_request_id" IS NOT NULL
    AND NOT (OLD."status" = 'RESERVED' AND NEW."status" = 'RECONCILIATION_REQUIRED') THEN
    RAISE EXCEPTION 'provider request identity may only be bound when reconciliation starts' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'RECONCILIATION_REQUIRED'
    AND (NEW."provider_request_id" IS NULL OR NEW."provider_accepted_at" IS NULL) THEN
    RAISE EXCEPTION 'reconciliation requires provider acceptance identity' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" IN ('SETTLED', 'RELEASED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'terminal cost reservation cannot transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT EXISTS (
    SELECT 1 FROM "ai_cost_settlements" settlement
    WHERE settlement."reservation_id" = NEW."id"
      AND settlement."kind" IN (
        CASE NEW."status"
          WHEN 'RECONCILIATION_REQUIRED' THEN 'RECONCILIATION_REQUIRED'::"AiCostSettlementKind"
          WHEN 'SETTLED' THEN 'CHARGE'::"AiCostSettlementKind"
          WHEN 'RELEASED' THEN 'RELEASE'::"AiCostSettlementKind"
          ELSE NULL
        END,
        CASE NEW."status"
          WHEN 'SETTLED' THEN 'RECONCILED_CHARGE'::"AiCostSettlementKind"
          WHEN 'RELEASED' THEN 'RECONCILED_RELEASE'::"AiCostSettlementKind"
          ELSE NULL
        END
      )
  ) THEN
    RAISE EXCEPTION 'cost reservation transition has no matching settlement' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_ai_cost_job_identity() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ai_cost_reservations" reservation
    WHERE reservation."job_id" = OLD."id" AND reservation."owner_user_id" = OLD."owner_user_id"
  ) AND ROW(
    NEW."owner_user_id", NEW."workflow_id", NEW."provider", NEW."model", NEW."operation", NEW."request_fingerprint"
  ) IS DISTINCT FROM ROW(
    OLD."owner_user_id", OLD."workflow_id", OLD."provider", OLD."model", OLD."operation", OLD."request_fingerprint"
  ) THEN
    RAISE EXCEPTION 'costed AI job identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_ai_cost_job_identity
  BEFORE UPDATE ON "ai_image_jobs"
  FOR EACH ROW EXECUTE FUNCTION protect_ai_cost_job_identity();

COMMIT;
