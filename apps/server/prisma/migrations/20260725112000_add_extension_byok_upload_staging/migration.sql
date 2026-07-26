BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE "extension_byok_upload_staging" (
  "id" VARCHAR(64) NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "device_session_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "storage_backend" VARCHAR(16) NOT NULL,
  "storage_namespace_id" CHAR(64) NOT NULL,
  "storage_key" VARCHAR(2000) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "cleanup_lease_token" VARCHAR(64),
  "cleanup_lease_until" TIMESTAMP(3),
  "cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(500),
  "committed_at" TIMESTAMP(3),
  "cleaned_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "extension_byok_upload_staging_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_byok_upload_staging_identity_check" CHECK (
    length(btrim("owner_user_id")) BETWEEN 1 AND 200
    AND length(btrim("device_session_id")) BETWEEN 1 AND 200
    AND length(btrim("asset_id")) BETWEEN 1 AND 200
    AND "request_hash" ~ '^[a-f0-9]{64}$'
    AND "storage_backend" IN ('local', 'oss')
    AND "storage_namespace_id" ~ '^[a-f0-9]{64}$'
    AND length(btrim("storage_key")) BETWEEN 1 AND 2000
    AND "cleanup_attempt_count" >= 0
  ),
  CONSTRAINT "extension_byok_upload_staging_state_check" CHECK (
    "status" IN ('PENDING', 'CLEANING', 'COMMITTED', 'CLEANED')
    AND (("status" = 'CLEANING') = ("cleanup_lease_token" IS NOT NULL AND "cleanup_lease_until" IS NOT NULL))
    AND ("status" <> 'COMMITTED' OR "committed_at" IS NOT NULL)
    AND ("status" <> 'CLEANED' OR "cleaned_at" IS NOT NULL)
  ),
  CONSTRAINT "extension_byok_upload_staging_session_owner_fkey"
    FOREIGN KEY ("device_session_id", "owner_user_id")
    REFERENCES "extension_device_sessions"("id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "extension_byok_upload_staging_storage_key"
  ON "extension_byok_upload_staging"("storage_backend", "storage_namespace_id", "storage_key");
CREATE INDEX "extension_byok_upload_staging_cleanup_idx"
  ON "extension_byok_upload_staging"("status", "expires_at", "cleanup_lease_until");

CREATE TABLE "extension_byok_ingest_rate_events" (
  "id" VARCHAR(64) NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "device_session_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "extension_byok_ingest_rate_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_byok_ingest_rate_event_identity_check" CHECK (
    length(btrim("owner_user_id")) BETWEEN 1 AND 200
    AND length(btrim("device_session_id")) BETWEEN 1 AND 200
  ),
  CONSTRAINT "extension_byok_ingest_rate_event_session_owner_fkey"
    FOREIGN KEY ("device_session_id", "owner_user_id")
    REFERENCES "extension_device_sessions"("id", "owner_user_id")
    ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "extension_byok_ingest_rate_event_window_idx"
  ON "extension_byok_ingest_rate_events"("device_session_id", "occurred_at");

COMMIT;
