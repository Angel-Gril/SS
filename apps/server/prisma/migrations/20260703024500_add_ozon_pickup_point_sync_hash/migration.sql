-- Store a stable content fingerprint so Ozon seller drop-off sync can write only changed rows.
ALTER TABLE "ozon_pickup_points"
  ADD COLUMN "sync_hash" TEXT;

CREATE INDEX "ozon_pickup_points_source_shop_id_sync_hash_idx"
  ON "ozon_pickup_points"("source", "shop_id", "sync_hash");
