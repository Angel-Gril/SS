BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_cost_settlements"
  VALIDATE CONSTRAINT "ai_cost_settlements_identity_check";

ALTER TABLE "ai_cost_reservations"
  VALIDATE CONSTRAINT "ai_cost_reservations_lifecycle_check";

COMMIT;
