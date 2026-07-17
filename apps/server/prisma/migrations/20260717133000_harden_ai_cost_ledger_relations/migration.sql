BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_cost_reservations"
  ADD CONSTRAINT "ai_cost_reservation_job_owner_key" UNIQUE ("job_id", "owner_user_id"),
  ADD CONSTRAINT "ai_cost_reservations_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_cost_reservations_workflow_owner_fkey" FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "ai_media_workflows"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_cost_settlements"
  ADD CONSTRAINT "ai_cost_settlements_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
