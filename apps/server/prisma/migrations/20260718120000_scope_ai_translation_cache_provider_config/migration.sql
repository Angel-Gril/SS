ALTER TABLE "ai_translation_cache"
ADD COLUMN "provider_config_hash" TEXT NOT NULL DEFAULT '';

DROP INDEX "ai_translation_cache_key";

CREATE UNIQUE INDEX "ai_translation_cache_key"
ON "ai_translation_cache"(
  "namespace",
  "source_lang",
  "target_lang",
  "input_hash",
  "prompt_hash",
  "provider",
  "model",
  "provider_config_hash"
);
