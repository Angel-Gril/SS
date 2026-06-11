ALTER TABLE "products"
  ADD COLUMN "ozon_created_at" TIMESTAMP(3),
  ADD COLUMN "ozon_updated_at" TIMESTAMP(3),
  ADD COLUMN "last_ozon_sync_at" TIMESTAMP(3);

CREATE INDEX "products_shop_id_ozon_created_at_idx" ON "products"("shop_id", "ozon_created_at");
CREATE INDEX "products_shop_id_visibility_sync_status_idx" ON "products"("shop_id", "visibility", "sync_status");
