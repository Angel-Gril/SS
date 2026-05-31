-- Add audit logs for sensitive admin operations.
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" "UserRole" NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Hot-list query indexes.
CREATE INDEX "products_shop_id_status_updated_at_idx" ON "products"("shop_id", "status", "updated_at");
CREATE INDEX "products_shop_id_updated_at_idx" ON "products"("shop_id", "updated_at");
CREATE INDEX "orders_shop_id_status_created_at_idx" ON "orders"("shop_id", "status", "created_at");
CREATE INDEX "orders_shop_id_created_at_idx" ON "orders"("shop_id", "created_at");
CREATE INDEX "supply_goods_user_id_status_created_at_idx" ON "supply_goods"("user_id", "status", "created_at");
CREATE INDEX "sync_jobs_shop_id_type_status_created_at_idx" ON "sync_jobs"("shop_id", "type", "status", "created_at");

CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
