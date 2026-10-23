CREATE TABLE "ozon_carriage_operations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shop_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "credential_hash" TEXT NOT NULL,
  "command" JSONB NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('DISPATCHING','PENDING','UNKNOWN','SUCCEEDED','PARTIAL','FAILED','CLOSED_UNKNOWN')),
  "active_scope" TEXT,
  "task_id" TEXT,
  "result" JSONB,
  "message" TEXT,
  "resolved_by" TEXT,
  "resolution_note" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ozon_carriage_shop_fk" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_carriage_warehouse_fk" FOREIGN KEY ("warehouse_id","shop_id") REFERENCES "warehouses"("id","shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_carriage_lock_state" CHECK (("status" IN ('DISPATCHING','PENDING','UNKNOWN')) = ("active_scope" IS NOT NULL)),
  CONSTRAINT "ozon_carriage_lock_scope" CHECK ("active_scope" IS NULL OR "active_scope" = "warehouse_id")
  ,CONSTRAINT "ozon_carriage_resolution_required" CHECK ("status" <> 'CLOSED_UNKNOWN' OR ("resolved_by" IS NOT NULL AND length("resolution_note") >= 10 AND "resolved_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "ozon_carriage_operations_active_scope_key" ON "ozon_carriage_operations"("active_scope");
CREATE UNIQUE INDEX "ozon_carriage_operations_shop_id_idempotency_key_key" ON "ozon_carriage_operations"("shop_id","idempotency_key");
CREATE INDEX "ozon_carriage_operations_shop_id_warehouse_id_created_at_idx" ON "ozon_carriage_operations"("shop_id","warehouse_id","created_at");
