CREATE TABLE "ozon_category_catalog" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'DEFAULT',
    "description_category_id" INTEGER NOT NULL,
    "type_id" INTEGER NOT NULL,
    "category_path_ru" JSONB NOT NULL,
    "category_path_zh" JSONB NOT NULL,
    "category_name_ru" TEXT NOT NULL DEFAULT '',
    "category_name_zh" TEXT NOT NULL DEFAULT '',
    "type_name_ru" TEXT NOT NULL DEFAULT '',
    "type_name_zh" TEXT NOT NULL DEFAULT '',
    "display_path_ru" TEXT NOT NULL DEFAULT '',
    "display_path_zh" TEXT NOT NULL DEFAULT '',
    "keywords_json" JSONB NOT NULL,
    "search_text" TEXT NOT NULL DEFAULT '',
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ozon_api',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ozon_category_catalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ozon_category_catalog_key" ON "ozon_category_catalog"("shop_id", "language", "description_category_id", "type_id");
CREATE INDEX "ozon_category_catalog_shop_id_language_idx" ON "ozon_category_catalog"("shop_id", "language");
CREATE INDEX "ozon_category_catalog_description_category_id_type_id_idx" ON "ozon_category_catalog"("description_category_id", "type_id");
CREATE INDEX "ozon_category_catalog_updated_at_idx" ON "ozon_category_catalog"("updated_at");

ALTER TABLE "ozon_category_catalog" ADD CONSTRAINT "ozon_category_catalog_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
