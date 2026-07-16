ALTER TABLE "media_assets"
  ADD COLUMN "source_capture_snapshot_id" TEXT,
  ADD COLUMN "source_media_key" VARCHAR(500),
  ADD COLUMN "source_url" TEXT;

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_source_capture_snapshot_id_fkey"
  FOREIGN KEY ("source_capture_snapshot_id")
  REFERENCES "source_capture_snapshots"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_source_original_lineage_check"
  CHECK (
    "kind" <> 'SOURCE_ORIGINAL'
    OR (
      "source_capture_snapshot_id" IS NOT NULL
      AND "source_media_key" IS NOT NULL
      AND length(btrim("source_media_key")) > 0
      AND "source_url" IS NOT NULL
      AND length(btrim("source_url")) > 0
    )
  );

CREATE INDEX "media_assets_source_capture_snapshot_id_idx"
  ON "media_assets"("source_capture_snapshot_id");

CREATE UNIQUE INDEX "media_asset_source_capture_key"
  ON "media_assets"("owner_user_id", "source_capture_snapshot_id", "source_media_key");
