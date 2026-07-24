CREATE INDEX CONCURRENTLY "ai_cost_settlements_global_budget_idx"
ON "ai_cost_settlements"("kind", "created_at", "actual_cost_minor");
