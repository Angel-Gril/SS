CREATE TABLE "ai_usage_quota_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "namespace" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "consumed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_quota_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_quota_daily_key"
ON "ai_usage_quota_daily"("date", "namespace", "actor_user_id");

CREATE INDEX "ai_usage_quota_daily_date_idx"
ON "ai_usage_quota_daily"("date");

CREATE INDEX "ai_usage_quota_daily_actor_user_id_date_idx"
ON "ai_usage_quota_daily"("actor_user_id", "date");
