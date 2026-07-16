CREATE UNIQUE INDEX CONCURRENTLY "media_asset_id_owner"
  ON "media_assets"("id", "owner_user_id");
