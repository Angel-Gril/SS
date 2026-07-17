BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_cost_settlements"
  DROP CONSTRAINT "ai_cost_settlements_identity_check",
  ADD CONSTRAINT "ai_cost_settlements_identity_check" CHECK (
    "request_fingerprint" ~ '^[a-f0-9]{64}$'
    AND (
      "kind" NOT IN ('RELEASE', 'RECONCILED_RELEASE', 'RECONCILIATION_REQUIRED', 'SUBMISSION_UNCERTAIN')
      OR "billed_units" = 0
    )
    AND ("kind" <> 'SUBMISSION_UNCERTAIN' OR "actual_cost_minor" IS NULL)
  ) NOT VALID;

ALTER TABLE "ai_cost_reservations"
  ADD CONSTRAINT "ai_cost_reservations_lifecycle_check" CHECK (
    ("provider_request_id" IS NULL) = ("provider_accepted_at" IS NULL)
    AND ("provider_request_id" IS NULL OR "reconciliation_required_at" IS NOT NULL)
    AND (
      (
        "status" = 'RESERVED'
        AND "provider_request_id" IS NULL
        AND "reconciliation_required_at" IS NULL
        AND "settled_at" IS NULL
        AND "released_at" IS NULL
      )
      OR (
        "status" = 'SUBMISSION_UNCERTAIN'
        AND "provider_request_id" IS NULL
        AND "reconciliation_required_at" IS NOT NULL
        AND "settled_at" IS NULL
        AND "released_at" IS NULL
      )
      OR (
        "status" = 'RECONCILIATION_REQUIRED'
        AND "provider_request_id" IS NOT NULL
        AND "reconciliation_required_at" IS NOT NULL
        AND "settled_at" IS NULL
        AND "released_at" IS NULL
      )
      OR (
        "status" = 'SETTLED'
        AND "settled_at" IS NOT NULL
        AND "released_at" IS NULL
      )
      OR (
        "status" = 'RELEASED'
        AND "settled_at" IS NULL
        AND "released_at" IS NOT NULL
      )
    )
  ) NOT VALID;

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

  IF NEW."status" <> 'RESERVED'
    OR NEW."provider_request_id" IS NOT NULL
    OR NEW."provider_accepted_at" IS NOT NULL
    OR NEW."reconciliation_required_at" IS NOT NULL
    OR NEW."settled_at" IS NOT NULL
    OR NEW."released_at" IS NOT NULL THEN
    RAISE EXCEPTION 'cost reservation must start reserved with no lifecycle evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

  IF (NEW."provider_request_id" IS NULL) IS DISTINCT FROM (NEW."provider_accepted_at" IS NULL) THEN
    RAISE EXCEPTION 'provider request identity and acceptance time must be paired' USING ERRCODE = '23514';
  END IF;
  IF OLD."provider_request_id" IS NOT NULL AND NEW."provider_request_id" IS DISTINCT FROM OLD."provider_request_id" THEN
    RAISE EXCEPTION 'cost provider request identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."provider_accepted_at" IS NOT NULL AND NEW."provider_accepted_at" IS DISTINCT FROM OLD."provider_accepted_at" THEN
    RAISE EXCEPTION 'cost provider acceptance time is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."reconciliation_required_at" IS NOT NULL
    AND NEW."reconciliation_required_at" IS DISTINCT FROM OLD."reconciliation_required_at" THEN
    RAISE EXCEPTION 'cost reconciliation time is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."settled_at" IS NOT NULL AND NEW."settled_at" IS DISTINCT FROM OLD."settled_at" THEN
    RAISE EXCEPTION 'cost settlement time is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD."released_at" IS NOT NULL AND NEW."released_at" IS DISTINCT FROM OLD."released_at" THEN
    RAISE EXCEPTION 'cost release time is immutable' USING ERRCODE = '55000';
  END IF;
  IF (
    (OLD."provider_request_id" IS NULL AND NEW."provider_request_id" IS NOT NULL)
    OR (OLD."provider_accepted_at" IS NULL AND NEW."provider_accepted_at" IS NOT NULL)
  ) AND NOT (
    OLD."status" IN ('RESERVED', 'SUBMISSION_UNCERTAIN')
    AND NEW."status" = 'RECONCILIATION_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'provider acceptance may only be bound when reconciliation starts' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'RECONCILIATION_REQUIRED'
    AND (NEW."provider_request_id" IS NULL OR NEW."provider_accepted_at" IS NULL) THEN
    RAISE EXCEPTION 'reconciliation requires provider acceptance identity' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'SUBMISSION_UNCERTAIN'
    AND (NEW."provider_request_id" IS NOT NULL OR NEW."provider_accepted_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'submission uncertainty cannot fabricate provider acceptance identity' USING ERRCODE = '23514';
  END IF;

  IF OLD."reconciliation_required_at" IS NULL AND NEW."reconciliation_required_at" IS NOT NULL
    AND NOT (
      OLD."status" = 'RESERVED'
      AND NEW."status" IN ('SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED')
    ) THEN
    RAISE EXCEPTION 'cost reconciliation time may only be set when reconciliation starts' USING ERRCODE = '23514';
  END IF;
  IF OLD."settled_at" IS NULL AND NEW."settled_at" IS NOT NULL
    AND NOT (OLD."status" <> 'SETTLED' AND NEW."status" = 'SETTLED') THEN
    RAISE EXCEPTION 'cost settlement time may only be set on settlement' USING ERRCODE = '23514';
  END IF;
  IF OLD."released_at" IS NULL AND NEW."released_at" IS NOT NULL
    AND NOT (OLD."status" <> 'RELEASED' AND NEW."status" = 'RELEASED') THEN
    RAISE EXCEPTION 'cost release time may only be set on release' USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'RESERVED' AND NEW."status" IN (
      'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED', 'SETTLED', 'RELEASED'
    ))
    OR (
      OLD."status" = 'SUBMISSION_UNCERTAIN'
      AND NEW."status" = 'RECONCILIATION_REQUIRED'
    )
    OR (
      OLD."status" IN ('SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED')
      AND NEW."status" IN ('SETTLED', 'RELEASED')
    )
  ) THEN
    RAISE EXCEPTION 'invalid cost reservation state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT EXISTS (
    SELECT 1 FROM "ai_cost_settlements" settlement
    WHERE settlement."reservation_id" = NEW."id"
      AND settlement."kind" IN (
        CASE NEW."status"
          WHEN 'SUBMISSION_UNCERTAIN' THEN 'SUBMISSION_UNCERTAIN'::"AiCostSettlementKind"
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

  IF (NEW."kind" IN ('CHARGE', 'RELEASE', 'SUBMISSION_UNCERTAIN')
      AND reservation."status" <> 'RESERVED')
    OR (NEW."kind" = 'RECONCILIATION_REQUIRED'
      AND reservation."status" NOT IN ('RESERVED', 'SUBMISSION_UNCERTAIN'))
    OR (NEW."kind" IN ('RECONCILED_CHARGE', 'RECONCILED_RELEASE')
      AND reservation."status" NOT IN ('RECONCILIATION_REQUIRED', 'SUBMISSION_UNCERTAIN')) THEN
    RAISE EXCEPTION 'cost settlement is invalid for reservation state' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED')
    AND NEW."actual_cost_minor" IS NOT NULL THEN
    RAISE EXCEPTION 'uncertain/reconciliation settlement must not declare actual cost' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('RELEASE', 'RECONCILED_RELEASE')
    AND NEW."actual_cost_minor" IS NOT NULL AND NEW."actual_cost_minor" <> 0 THEN
    RAISE EXCEPTION 'release/reconciliation settlement cannot charge' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('CHARGE', 'RECONCILED_CHARGE') AND NEW."actual_cost_minor" IS NULL THEN
    RAISE EXCEPTION 'charge settlement requires actual cost' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" = 'CHARGE' AND NEW."actual_cost_minor" > reservation."maximum_cost_minor" THEN
    RAISE EXCEPTION 'cost overrun requires reconciliation' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED', 'RELEASE', 'RECONCILED_RELEASE')
    AND NEW."billed_units" <> 0 THEN
    RAISE EXCEPTION 'release/reconciliation settlement cannot include billed units' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
