BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_cost_reservations"
  ADD CONSTRAINT "ai_cost_reservations_job_id_key" UNIQUE ("job_id"),
  ADD CONSTRAINT "ai_cost_reservations_identity_check" CHECK (
    "request_fingerprint" ~ '^[a-f0-9]{64}$'
    AND "rounding_mode" IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP')
  );

ALTER TABLE "ai_cost_settlements"
  ADD CONSTRAINT "ai_cost_settlement_reservation_idempotency" UNIQUE ("reservation_id", "idempotency_key"),
  ADD CONSTRAINT "ai_cost_settlements_identity_check" CHECK (
    "request_fingerprint" ~ '^[a-f0-9]{64}$'
    AND ("kind" NOT IN ('RELEASE', 'RECONCILED_RELEASE') OR "billed_units" = 0)
  );

CREATE OR REPLACE FUNCTION ai_cost_reservation_insert_validate() RETURNS trigger AS $$
DECLARE
  frozen_job "ai_image_jobs"%ROWTYPE;
BEGIN
  SELECT * INTO frozen_job
  FROM "ai_image_jobs"
  WHERE "id" = NEW."job_id" AND "owner_user_id" = NEW."owner_user_id";

  IF NOT FOUND
    OR frozen_job."provider" IS DISTINCT FROM NEW."provider"
    OR frozen_job."model" IS DISTINCT FROM NEW."model"
    OR frozen_job."operation" IS DISTINCT FROM NEW."operation"
    OR frozen_job."request_fingerprint" IS DISTINCT FROM NEW."request_fingerprint"
    OR frozen_job."workflow_id" IS DISTINCT FROM NEW."workflow_id" THEN
    RAISE EXCEPTION 'cost reservation does not match its frozen job' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_cost_reservation_insert_validate
  BEFORE INSERT ON "ai_cost_reservations"
  FOR EACH ROW EXECUTE FUNCTION ai_cost_reservation_insert_validate();

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

CREATE TRIGGER ai_cost_reservation_update_validate
  BEFORE UPDATE ON "ai_cost_reservations"
  FOR EACH ROW EXECUTE FUNCTION ai_cost_reservation_update_validate();

CREATE OR REPLACE FUNCTION ai_cost_settlements_validate() RETURNS trigger AS $$
DECLARE
  reservation "ai_cost_reservations"%ROWTYPE;
BEGIN
  SELECT * INTO reservation
  FROM "ai_cost_reservations"
  WHERE "id" = NEW."reservation_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR UPDATE;
  IF NOT FOUND OR reservation."request_fingerprint" IS DISTINCT FROM NEW."request_fingerprint" THEN
    RAISE EXCEPTION 'cost settlement does not match its reservation' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ai_cost_settlements" existing
    WHERE existing."reservation_id" = NEW."reservation_id"
      AND existing."idempotency_key" = NEW."idempotency_key"
  ) THEN
    RETURN NEW;
  END IF;

  IF (NEW."kind" IN ('CHARGE', 'RELEASE', 'RECONCILIATION_REQUIRED') AND reservation."status" <> 'RESERVED')
    OR (NEW."kind" IN ('RECONCILED_CHARGE', 'RECONCILED_RELEASE') AND reservation."status" <> 'RECONCILIATION_REQUIRED') THEN
    RAISE EXCEPTION 'cost settlement is invalid for reservation state' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('RECONCILIATION_REQUIRED', 'RELEASE', 'RECONCILED_RELEASE')
    AND NEW."actual_cost_minor" IS NOT NULL AND NEW."actual_cost_minor" <> 0 THEN
    RAISE EXCEPTION 'release/reconciliation settlement cannot charge' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('CHARGE', 'RECONCILED_CHARGE') AND NEW."actual_cost_minor" IS NULL THEN
    RAISE EXCEPTION 'charge settlement requires actual cost' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'CHARGE' AND NEW."actual_cost_minor" > reservation."maximum_cost_minor" THEN
    RAISE EXCEPTION 'cost overrun requires reconciliation' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('RELEASE', 'RECONCILED_RELEASE') AND NEW."billed_units" <> 0 THEN
    RAISE EXCEPTION 'release settlement cannot include billed units' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
