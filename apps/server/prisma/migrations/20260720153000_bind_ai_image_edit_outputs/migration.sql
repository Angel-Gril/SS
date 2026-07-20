CREATE UNIQUE INDEX CONCURRENTLY "media_assets_edit_output_job_kind_unique"
  ON "media_assets"("ai_image_job_id", "kind")
  WHERE "ai_image_job_id" IS NOT NULL
    AND (
      "kind" = 'AI_PROVIDER_OUTPUT'
      OR (
        "kind" = 'AI_GENERATED'
        AND "metadata"->>'providerOutputAssetId' IS NOT NULL
      )
    );
