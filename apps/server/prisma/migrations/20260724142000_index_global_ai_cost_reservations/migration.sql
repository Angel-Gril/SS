CREATE INDEX CONCURRENTLY "ai_cost_reservations_global_budget_idx"
ON "ai_cost_reservations"("status", "maximum_cost_minor");
