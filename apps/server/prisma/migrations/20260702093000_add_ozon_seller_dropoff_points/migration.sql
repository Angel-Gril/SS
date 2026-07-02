ALTER TABLE "shop_delivery_methods"
  ADD COLUMN "provider_name" TEXT,
  ADD COLUMN "tpl_dropoff_point_id" TEXT;

ALTER TABLE "ozon_pickup_points"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "external_id" TEXT,
  ADD COLUMN "provider_id" INTEGER,
  ADD COLUMN "provider_name" TEXT,
  ADD COLUMN "shop_id" TEXT,
  ADD COLUMN "synced_at" TIMESTAMP(3),
  ADD COLUMN "raw_data" JSONB;

CREATE INDEX "ozon_pickup_points_source_idx" ON "ozon_pickup_points"("source");
CREATE INDEX "ozon_pickup_points_external_id_idx" ON "ozon_pickup_points"("external_id");
CREATE INDEX "ozon_pickup_points_provider_id_idx" ON "ozon_pickup_points"("provider_id");
CREATE INDEX "ozon_pickup_points_shop_id_idx" ON "ozon_pickup_points"("shop_id");
