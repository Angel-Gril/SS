CREATE TABLE "ai_usage_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "namespace" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL DEFAULT '',
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "cache_hit_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_daily_key" ON "ai_usage_daily"("date", "namespace", "provider", "model", "actor_user_id");
CREATE INDEX "ai_usage_daily_date_idx" ON "ai_usage_daily"("date");
CREATE INDEX "ai_usage_daily_namespace_date_idx" ON "ai_usage_daily"("namespace", "date");
CREATE INDEX "ai_usage_daily_actor_user_id_date_idx" ON "ai_usage_daily"("actor_user_id", "date");
