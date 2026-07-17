CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_cost_reservations_reconciliation_queue_idx"
  ON "ai_cost_reservations" ("status", "reconciliation_required_at", "id");
