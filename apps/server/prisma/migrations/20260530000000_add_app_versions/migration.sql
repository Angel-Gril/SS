-- CreateTable
CREATE TABLE "app_versions" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "min_version" TEXT NOT NULL,
    "release_notes" TEXT,
    "download_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_versions_platform_is_active_idx" ON "app_versions"("platform", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "app_versions_platform_version_key" ON "app_versions"("platform", "version");
