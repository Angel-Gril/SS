CREATE TABLE "product_selection_pool_items" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'ozon',
  "sku" TEXT NOT NULL,
  "product_id" TEXT,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "image" TEXT,
  "price_rub" DECIMAL(12, 2),
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "source" TEXT NOT NULL DEFAULT 'extension',
  "rule_ids" JSONB,
  "tags" JSONB,
  "metrics" JSONB,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "first_matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_selection_pool_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_selection_pool_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "product_selection_pool_items_user_id_platform_sku_key" ON "product_selection_pool_items"("user_id", "platform", "sku");
CREATE INDEX "product_selection_pool_items_user_id_status_updated_at_idx" ON "product_selection_pool_items"("user_id", "status", "updated_at");
CREATE INDEX "product_selection_pool_items_user_id_platform_sku_idx" ON "product_selection_pool_items"("user_id", "platform", "sku");
