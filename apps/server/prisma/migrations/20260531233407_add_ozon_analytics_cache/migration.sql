-- AlterTable: Add sourceProductId to supply_goods
ALTER TABLE "supply_goods" ADD COLUMN "source_product_id" TEXT;

-- CreateIndex: Add index on userId and sourceProductId
CREATE INDEX "supply_goods_user_id_source_product_id_idx" ON "supply_goods"("user_id", "source_product_id");

-- CreateTable: ozon_analytics_cache
CREATE TABLE "ozon_analytics_cache" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ozon_analytics_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ozon_analytics_cache_user_id_sku_idx" ON "ozon_analytics_cache"("user_id", "sku");

-- CreateIndex
CREATE INDEX "ozon_analytics_cache_expires_at_idx" ON "ozon_analytics_cache"("expires_at");

-- CreateIndex
CREATE INDEX "ozon_analytics_cache_user_id_sku_expires_at_idx" ON "ozon_analytics_cache"("user_id", "sku", "expires_at");

-- AddForeignKey
ALTER TABLE "ozon_analytics_cache" ADD CONSTRAINT "ozon_analytics_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
