-- CreateTable
CREATE TABLE "ozon_attribute_dictionary_cache" (
    "id" TEXT NOT NULL,
    "description_category_id" INTEGER NOT NULL,
    "type_id" INTEGER NOT NULL,
    "attribute_id" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'DEFAULT',
    "values_json" JSONB NOT NULL,
    "values_hash" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ozon_api',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ozon_attribute_dictionary_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ozon_attribute_dictionary_cache_key" ON "ozon_attribute_dictionary_cache"("description_category_id", "type_id", "attribute_id", "language");

-- CreateIndex
CREATE INDEX "ozon_attribute_dictionary_cache_expires_at_idx" ON "ozon_attribute_dictionary_cache"("expires_at");
