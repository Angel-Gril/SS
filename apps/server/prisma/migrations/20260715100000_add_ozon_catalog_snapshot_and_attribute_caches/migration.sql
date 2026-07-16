BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "ozon_attribute_dictionary_cache"
  ADD COLUMN "catalog_revision" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "complete" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "page_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "final_cursor" BIGINT;

UPDATE "ozon_attribute_dictionary_cache"
SET "catalog_revision" = '',
    "complete" = FALSE,
    "page_count" = 0,
    "final_cursor" = NULL;

DROP INDEX "ozon_attribute_dictionary_cache_key";
CREATE UNIQUE INDEX "ozon_attribute_dictionary_cache_key"
  ON "ozon_attribute_dictionary_cache"(
    "description_category_id",
    "type_id",
    "attribute_id",
    "language",
    "catalog_revision"
  );
CREATE INDEX "ozon_attribute_dictionary_cache_catalog_revision_complete_idx"
  ON "ozon_attribute_dictionary_cache"("catalog_revision", "complete");
ALTER TABLE "ozon_attribute_dictionary_cache"
  ADD CONSTRAINT "ozon_attribute_dictionary_cache_metadata_check" CHECK (
    "description_category_id" > 0
    AND "type_id" > 0
    AND "attribute_id" > 0
    AND char_length(btrim("language")) BETWEEN 1 AND 40
    AND jsonb_typeof("values_json") = 'array'
    AND "values_hash" ~ '^[a-f0-9]{64}$'
    AND "expires_at" >= "fetched_at"
    AND "page_count" >= 0
    AND ("final_cursor" IS NULL OR "final_cursor" >= 0)
    AND ("catalog_revision" = '' OR "catalog_revision" ~ '^[a-f0-9]{64}$')
    AND (NOT "complete" OR "page_count" > 0)
  );

CREATE TABLE "ozon_attribute_definition_cache" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "description_category_id" INTEGER NOT NULL,
  "type_id" INTEGER NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'DEFAULT',
  "catalog_revision" TEXT NOT NULL,
  "definitions_json" JSONB NOT NULL,
  "definitions_hash" TEXT NOT NULL,
  "complete" BOOLEAN NOT NULL DEFAULT FALSE,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'ozon_api',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ozon_attribute_definition_cache_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_attribute_definition_cache_identity_check" CHECK (
    "description_category_id" > 0
    AND "type_id" > 0
    AND char_length(btrim("language")) BETWEEN 1 AND 40
    AND "catalog_revision" ~ '^[a-f0-9]{64}$'
    AND "definitions_hash" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("definitions_json") = 'array'
    AND "expires_at" >= "fetched_at"
  ),
  CONSTRAINT "ozon_attribute_definition_cache_shop_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ozon_attribute_definition_cache_key"
  ON "ozon_attribute_definition_cache"(
    "shop_id",
    "description_category_id",
    "type_id",
    "language",
    "catalog_revision"
  );
CREATE INDEX "ozon_attribute_definition_cache_shop_id_catalog_revision_complete_idx"
  ON "ozon_attribute_definition_cache"("shop_id", "catalog_revision", "complete");
CREATE INDEX "ozon_attribute_definition_cache_expires_at_idx"
  ON "ozon_attribute_definition_cache"("expires_at");

CREATE TABLE "ozon_category_catalog_snapshots" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "complete" BOOLEAN NOT NULL DEFAULT FALSE,
  "default_tree_complete" BOOLEAN NOT NULL DEFAULT FALSE,
  "zh_hans_tree_complete" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_current" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ozon_category_catalog_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_category_catalog_snapshot_owner_revision_key"
    UNIQUE ("id", "shop_id", "revision"),
  CONSTRAINT "ozon_category_catalog_snapshot_metadata_check" CHECK (
    char_length(btrim("schema_version")) BETWEEN 1 AND 100
    AND "revision" ~ '^[a-f0-9]{64}$'
    AND "expires_at" >= "fetched_at"
    AND (
      NOT "complete"
      OR ("default_tree_complete" AND "zh_hans_tree_complete")
    )
  ),
  CONSTRAINT "ozon_category_catalog_snapshot_shop_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ozon_category_catalog_snapshots_one_current_per_shop"
  ON "ozon_category_catalog_snapshots"("shop_id")
  WHERE "is_current" = TRUE;
CREATE INDEX "ozon_category_catalog_snapshots_shop_id_is_current_idx"
  ON "ozon_category_catalog_snapshots"("shop_id", "is_current");
CREATE INDEX "ozon_category_catalog_snapshots_shop_id_revision_idx"
  ON "ozon_category_catalog_snapshots"("shop_id", "revision");
CREATE INDEX "ozon_category_catalog_snapshots_expires_at_idx"
  ON "ozon_category_catalog_snapshots"("expires_at");

ALTER TABLE "ozon_category_catalog"
  ADD COLUMN "snapshot_id" TEXT,
  ADD COLUMN "catalog_revision" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "label_provenance_json" JSONB NOT NULL DEFAULT '{}';

INSERT INTO "ozon_category_catalog_snapshots" (
  "id",
  "shop_id",
  "schema_version",
  "revision",
  "fetched_at",
  "expires_at",
  "complete",
  "default_tree_complete",
  "zh_hans_tree_complete",
  "is_current",
  "created_at"
)
SELECT
  'legacy-' || md5(c."shop_id"),
  c."shop_id",
  'ozon-category-catalog-snapshot/legacy-v0',
  md5('legacy:catalog:' || c."shop_id") || md5(c."shop_id" || ':catalog:legacy'),
  MAX(c."fetched_at"),
  MAX(c."fetched_at"),
  FALSE,
  FALSE,
  FALSE,
  TRUE,
  CURRENT_TIMESTAMP
FROM "ozon_category_catalog" c
GROUP BY c."shop_id";

UPDATE "ozon_category_catalog" c
SET "snapshot_id" = s."id",
    "catalog_revision" = s."revision",
    "disabled" = FALSE,
    "label_provenance_json" = '{}'
FROM "ozon_category_catalog_snapshots" s
WHERE s."shop_id" = c."shop_id"
  AND s."schema_version" = 'ozon-category-catalog-snapshot/legacy-v0';

ALTER TABLE "ozon_category_catalog"
  ALTER COLUMN "snapshot_id" SET NOT NULL,
  ALTER COLUMN "catalog_revision" DROP DEFAULT;

DROP INDEX "ozon_category_catalog_key";
CREATE UNIQUE INDEX "ozon_category_catalog_snapshot_entry_key"
  ON "ozon_category_catalog"(
    "snapshot_id",
    "language",
    "description_category_id",
    "type_id"
  );
CREATE INDEX "ozon_category_catalog_snapshot_id_idx"
  ON "ozon_category_catalog"("snapshot_id");
ALTER TABLE "ozon_category_catalog"
  ADD CONSTRAINT "ozon_category_catalog_snapshot_owner_revision_fkey"
    FOREIGN KEY ("snapshot_id", "shop_id", "catalog_revision")
    REFERENCES "ozon_category_catalog_snapshots"("id", "shop_id", "revision")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ozon_category_catalog_snapshot_entry_check" CHECK (
    "description_category_id" > 0
    AND "type_id" > 0
    AND "catalog_revision" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("category_path_ru") = 'array'
    AND jsonb_typeof("category_path_zh") = 'array'
    AND jsonb_typeof("category_levels_json") = 'array'
    AND "translation_status" IN ('complete', 'partial', 'missing')
    AND jsonb_typeof("untranslated_terms_json") = 'array'
    AND jsonb_typeof("keywords_json") = 'array'
    AND jsonb_typeof("label_provenance_json") = 'object'
  );

COMMIT;
