-- Optimize Ozon pickup point list/search and seller drop-off sync paths.
CREATE INDEX "ozon_pickup_points_source_provider_id_city_idx"
  ON "ozon_pickup_points"("source", "provider_id", "city");

CREATE INDEX "ozon_pickup_points_source_shop_id_synced_at_idx"
  ON "ozon_pickup_points"("source", "shop_id", "synced_at");

CREATE INDEX "ozon_pickup_points_source_shop_id_provider_id_external_id_idx"
  ON "ozon_pickup_points"("source", "shop_id", "provider_id", "external_id");

CREATE INDEX "ozon_pickup_points_is_active_source_city_idx"
  ON "ozon_pickup_points"("is_active", "source", "city");
