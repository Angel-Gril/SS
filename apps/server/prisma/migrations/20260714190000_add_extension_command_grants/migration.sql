BEGIN;

CREATE TYPE "ExtensionCommandOperation" AS ENUM (
  'SOURCE_CAPTURE',
  'LISTING_WRITE',
  'LISTING_REVIEW',
  'MEDIA_EXECUTE',
  'OZON_PUBLISH'
);

CREATE TYPE "ExtensionCommandReceiptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "extension_command_grants" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "token_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "shop_id" TEXT,
  "operation" "ExtensionCommandOperation" NOT NULL,
  "workflow_id" TEXT,
  "draft_version" INTEGER,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "token_digest" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" "ExtensionDeviceRevocationReason",
  CONSTRAINT "extension_command_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_command_grant_token_id_check"
    CHECK (length(btrim("token_id")) BETWEEN 1 AND 200),
  CONSTRAINT "extension_command_grant_idempotency_key_check"
    CHECK (length(btrim("idempotency_key")) BETWEEN 16 AND 200),
  CONSTRAINT "extension_command_grant_workflow_id_check"
    CHECK ("workflow_id" IS NULL OR length(btrim("workflow_id")) BETWEEN 1 AND 200),
  CONSTRAINT "extension_command_grant_request_hash_check"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "extension_command_grant_token_digest_check"
    CHECK ("token_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "extension_command_grant_draft_version_check"
    CHECK ("draft_version" IS NULL OR "draft_version" > 0),
  CONSTRAINT "extension_command_grant_time_check" CHECK (
    "expires_at" > "issued_at"
    AND "expires_at" <= "issued_at" + INTERVAL '5 minutes'
    AND (
      "consumed_at" IS NULL
      OR ("consumed_at" >= "issued_at" AND "consumed_at" < "expires_at")
    )
    AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
    AND NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL)
  ),
  CONSTRAINT "extension_command_grant_workflow_version_check" CHECK (
    ("workflow_id" IS NULL AND "draft_version" IS NULL)
    OR ("workflow_id" IS NOT NULL AND "draft_version" IS NOT NULL)
  ),
  CONSTRAINT "extension_command_grant_revocation_check" CHECK (
    ("revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
  ),
  CONSTRAINT "extension_command_grant_publish_binding_check" CHECK (
    "operation" <> 'OZON_PUBLISH'
    OR (
      "shop_id" IS NOT NULL
      AND "workflow_id" IS NOT NULL
      AND "draft_version" IS NOT NULL
    )
  )
);

CREATE TABLE "extension_command_receipts" (
  "id" TEXT NOT NULL,
  "grant_id" TEXT NOT NULL,
  "status" "ExtensionCommandReceiptStatus" NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "failure_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "extension_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_command_receipt_status_shape_check" CHECK (
    (
      "status" = 'PENDING'
      AND "result" IS NULL
      AND "failure_code" IS NULL
      AND "completed_at" IS NULL
    )
    OR (
      "status" = 'SUCCEEDED'
      AND "failure_code" IS NULL
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "created_at"
    )
    OR (
      "status" = 'FAILED'
      AND length(btrim("failure_code")) BETWEEN 1 AND 100
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "created_at"
    )
  )
);

CREATE UNIQUE INDEX "extension_command_grants_token_digest_key"
  ON "extension_command_grants"("token_digest");
CREATE UNIQUE INDEX "extension_command_grants_session_id_idempotency_key_key"
  ON "extension_command_grants"("session_id", "idempotency_key");
CREATE INDEX "extension_command_grants_owner_user_id_operation_issued_at_idx"
  ON "extension_command_grants"("owner_user_id", "operation", "issued_at");
CREATE INDEX "extension_command_grants_shop_id_operation_issued_at_idx"
  ON "extension_command_grants"("shop_id", "operation", "issued_at");
CREATE INDEX "extension_command_grants_session_id_operation_expires_at_idx"
  ON "extension_command_grants"("session_id", "operation", "expires_at");
CREATE INDEX "extension_command_grants_workflow_id_draft_version_operation_idx"
  ON "extension_command_grants"("workflow_id", "draft_version", "operation");

CREATE UNIQUE INDEX "extension_command_receipts_grant_id_key"
  ON "extension_command_receipts"("grant_id");
CREATE INDEX "extension_command_receipts_status_created_at_idx"
  ON "extension_command_receipts"("status", "created_at");

ALTER TABLE "extension_command_grants"
  ADD CONSTRAINT "extension_command_grants_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "extension_device_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_command_grants"
  ADD CONSTRAINT "extension_command_grants_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_command_grants"
  ADD CONSTRAINT "extension_command_grants_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_command_grants"
  ADD CONSTRAINT "extension_command_grants_session_owner_fkey"
  FOREIGN KEY ("session_id", "owner_user_id")
  REFERENCES "extension_device_sessions"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_command_grants"
  ADD CONSTRAINT "extension_command_grants_session_shop_fkey"
  FOREIGN KEY ("session_id", "shop_id")
  REFERENCES "extension_device_shop_grants"("session_id", "shop_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "extension_command_receipts"
  ADD CONSTRAINT "extension_command_receipts_grant_id_fkey"
  FOREIGN KEY ("grant_id") REFERENCES "extension_command_grants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_extension_command_grant_binding()
RETURNS trigger AS $$
DECLARE
  session_owner_id TEXT;
  shop_owner_id TEXT;
BEGIN
  SELECT "owner_user_id" INTO session_owner_id
  FROM "extension_device_sessions"
  WHERE "id" = NEW."session_id"
  FOR KEY SHARE;

  IF session_owner_id IS NOT NULL AND session_owner_id <> NEW."owner_user_id" THEN
    RAISE EXCEPTION 'extension command grant owner does not match device session';
  END IF;

  IF NEW."shop_id" IS NOT NULL THEN
    SELECT "user_id" INTO shop_owner_id
    FROM "shops"
    WHERE "id" = NEW."shop_id"
    FOR KEY SHARE;

    IF shop_owner_id IS NOT NULL AND shop_owner_id <> NEW."owner_user_id" THEN
      RAISE EXCEPTION 'extension command grant shop does not belong to owner';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_extension_command_grant_rewrite()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'extension command grants cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
    OR NEW."token_id" IS DISTINCT FROM OLD."token_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."shop_id" IS DISTINCT FROM OLD."shop_id"
    OR NEW."operation" IS DISTINCT FROM OLD."operation"
    OR NEW."workflow_id" IS DISTINCT FROM OLD."workflow_id"
    OR NEW."draft_version" IS DISTINCT FROM OLD."draft_version"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."token_digest" IS DISTINCT FROM OLD."token_digest"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
    RAISE EXCEPTION 'extension command grant binding is immutable';
  END IF;

  IF OLD."consumed_at" IS NOT NULL
    AND NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at" THEN
    RAISE EXCEPTION 'extension command grant consumption is immutable';
  END IF;
  IF OLD."revoked_at" IS NOT NULL
    AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" THEN
    RAISE EXCEPTION 'extension command grant revocation is immutable';
  END IF;
  IF OLD."revoked_reason" IS NOT NULL
    AND NEW."revoked_reason" IS DISTINCT FROM OLD."revoked_reason" THEN
    RAISE EXCEPTION 'extension command grant revocation reason is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_extension_command_receipt_insert()
RETURNS trigger AS $$
DECLARE
  grant_consumed_at TIMESTAMP(3);
BEGIN
  IF NEW."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'extension command receipts must be inserted pending';
  END IF;

  SELECT "consumed_at" INTO grant_consumed_at
  FROM "extension_command_grants"
  WHERE "id" = NEW."grant_id"
  FOR KEY SHARE;

  IF grant_consumed_at IS NULL THEN
    RAISE EXCEPTION 'extension command grant must be consumed before receipt creation';
  END IF;
  IF NEW."created_at" IS DISTINCT FROM grant_consumed_at THEN
    RAISE EXCEPTION 'extension command receipt time must match grant consumption';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_extension_command_receipt_rewrite()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'extension command receipts cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."grant_id" IS DISTINCT FROM OLD."grant_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'extension command receipt identity is immutable';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'completed extension command receipts are immutable';
  END IF;
  IF NEW."status" NOT IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'pending extension command receipts may only be completed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_command_grants_binding_validate"
BEFORE INSERT ON "extension_command_grants"
FOR EACH ROW EXECUTE FUNCTION validate_extension_command_grant_binding();

CREATE TRIGGER "extension_command_grants_protect"
BEFORE UPDATE OR DELETE ON "extension_command_grants"
FOR EACH ROW EXECUTE FUNCTION prevent_extension_command_grant_rewrite();

CREATE TRIGGER "extension_command_receipts_validate"
BEFORE INSERT ON "extension_command_receipts"
FOR EACH ROW EXECUTE FUNCTION validate_extension_command_receipt_insert();

CREATE TRIGGER "extension_command_receipts_immutable"
BEFORE UPDATE OR DELETE ON "extension_command_receipts"
FOR EACH ROW EXECUTE FUNCTION prevent_extension_command_receipt_rewrite();

COMMIT;
