BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TYPE "AiCostReservationStatus" AS ENUM ('RESERVED', 'RECONCILIATION_REQUIRED', 'SETTLED', 'RELEASED');
CREATE TYPE "AiCostSettlementKind" AS ENUM ('CHARGE', 'RELEASE', 'RECONCILIATION_REQUIRED', 'RECONCILED_CHARGE', 'RECONCILED_RELEASE');

CREATE TABLE "ai_cost_reservations" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "workflow_id" TEXT,
  "job_id" TEXT NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" "AiMediaOperation" NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "rounding_mode" VARCHAR(32) NOT NULL DEFAULT 'HALF_UP',
  "estimated_cost_minor" INTEGER NOT NULL,
  "maximum_cost_minor" INTEGER NOT NULL,
  "status" "AiCostReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "provider_request_id" VARCHAR(500),
  "provider_accepted_at" TIMESTAMP(3),
  "reconciliation_required_at" TIMESTAMP(3),
  "settled_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_cost_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_cost_settlements" (
  "id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "kind" "AiCostSettlementKind" NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "actual_cost_minor" INTEGER,
  "billed_units" INTEGER NOT NULL DEFAULT 0,
  "reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_cost_settlements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ai_cost_reservations"
  ADD CONSTRAINT "ai_cost_reservations_id_owner_key" UNIQUE ("id", "owner_user_id"),
  ADD CONSTRAINT "ai_cost_reservations_owner_idempotency_key" UNIQUE ("owner_user_id", "idempotency_key"),
  ADD CONSTRAINT "ai_cost_reservations_owner_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_cost_reservations_reservation_job_fkey" FOREIGN KEY ("job_id", "owner_user_id") REFERENCES "ai_image_jobs"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_cost_settlements"
  ADD CONSTRAINT "ai_cost_settlements_reservation_owner_fkey" FOREIGN KEY ("reservation_id", "owner_user_id") REFERENCES "ai_cost_reservations"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ai_cost_reservations_owner_status_updated_idx" ON "ai_cost_reservations" ("owner_user_id", "status", "updated_at");
CREATE INDEX "ai_cost_reservations_workflow_created_idx" ON "ai_cost_reservations" ("workflow_id", "created_at");
CREATE INDEX "ai_cost_settlements_owner_created_idx" ON "ai_cost_settlements" ("owner_user_id", "created_at");

ALTER TABLE "ai_cost_reservations"
  ADD CONSTRAINT "ai_cost_reservations_amounts_check" CHECK (
    "estimated_cost_minor" >= 0 AND "maximum_cost_minor" >= "estimated_cost_minor"
    AND "currency" ~ '^[A-Z]{3}$'
  );
ALTER TABLE "ai_cost_settlements"
  ADD CONSTRAINT "ai_cost_settlements_values_check" CHECK (
    "billed_units" >= 0 AND ("actual_cost_minor" IS NULL OR "actual_cost_minor" >= 0)
  ),
  ADD CONSTRAINT "ai_cost_settlements_reconciliation_check" CHECK (
    ("kind" <> 'RECONCILIATION_REQUIRED' OR "actual_cost_minor" IS NULL)
    AND ("kind" <> 'RECONCILED_CHARGE' OR "actual_cost_minor" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION ai_cost_settlements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai cost settlements are append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ai_cost_settlements_immutable
  BEFORE UPDATE OR DELETE ON "ai_cost_settlements"
  FOR EACH ROW EXECUTE FUNCTION ai_cost_settlements_immutable();

CREATE OR REPLACE FUNCTION ai_cost_settlements_validate() RETURNS trigger AS $$
BEGIN
  IF NEW."kind" IN ('RECONCILIATION_REQUIRED', 'RELEASE', 'RECONCILED_RELEASE')
    AND NEW."actual_cost_minor" IS NOT NULL
    AND NEW."actual_cost_minor" <> 0 THEN
    RAISE EXCEPTION 'release/reconciliation settlement cannot charge' USING ERRCODE = '23514';
  END IF;
  IF NEW."kind" IN ('CHARGE', 'RECONCILED_CHARGE') AND NEW."actual_cost_minor" IS NULL THEN
    RAISE EXCEPTION 'charge settlement requires actual cost' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ai_cost_settlements_validate
  BEFORE INSERT ON "ai_cost_settlements"
  FOR EACH ROW EXECUTE FUNCTION ai_cost_settlements_validate();

COMMIT;
