CREATE TABLE "dashboard_content_blocks" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "content" JSONB NOT NULL,
    "target_role" "AnnouncementTargetRole" NOT NULL DEFAULT 'ALL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_content_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dashboard_content_blocks_key_key" ON "dashboard_content_blocks"("key");
CREATE INDEX "dashboard_content_blocks_enabled_target_role_sort_order_idx" ON "dashboard_content_blocks"("enabled", "target_role", "sort_order");
CREATE INDEX "dashboard_content_blocks_published_at_idx" ON "dashboard_content_blocks"("published_at");

ALTER TABLE "dashboard_content_blocks" ADD CONSTRAINT "dashboard_content_blocks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
