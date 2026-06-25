CREATE TABLE "ai_translation_cache" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "source_lang" TEXT NOT NULL,
    "target_lang" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "input_text" TEXT NOT NULL,
    "output_text" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "usage_json" JSONB,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_translation_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_translation_cache_key" ON "ai_translation_cache"("namespace", "source_lang", "target_lang", "input_hash", "prompt_hash", "provider", "model");
CREATE INDEX "ai_translation_cache_namespace_source_lang_target_lang_idx" ON "ai_translation_cache"("namespace", "source_lang", "target_lang");
CREATE INDEX "ai_translation_cache_expires_at_idx" ON "ai_translation_cache"("expires_at");
CREATE INDEX "ai_translation_cache_last_used_at_idx" ON "ai_translation_cache"("last_used_at");