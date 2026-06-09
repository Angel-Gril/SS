-- Add source-platform category mappings for 1688/OZON listing workflows.
CREATE TABLE "category_mappings" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "source_platform" TEXT NOT NULL,
  "source_category_id" TEXT,
  "source_category_name" TEXT,
  "source_category_path" TEXT,
  "target_platform" TEXT NOT NULL DEFAULT 'ozon',
  "target_category_id" INTEGER NOT NULL,
  "target_type_id" INTEGER NOT NULL,
  "target_category_name" TEXT,
  "target_category_path" TEXT,
  "default_weight_g" INTEGER,
  "default_length_mm" INTEGER,
  "default_width_mm" INTEGER,
  "default_height_mm" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "category_mappings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "category_mappings_user_id_idx" ON "category_mappings"("user_id");
CREATE INDEX "category_mappings_source_platform_source_category_id_idx" ON "category_mappings"("source_platform", "source_category_id");
CREATE INDEX "category_mappings_source_platform_source_category_name_idx" ON "category_mappings"("source_platform", "source_category_name");
CREATE INDEX "category_mappings_target_platform_target_category_id_target_type_id_idx" ON "category_mappings"("target_platform", "target_category_id", "target_type_id");

ALTER TABLE "category_mappings"
  ADD CONSTRAINT "category_mappings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
