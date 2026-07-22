-- Additive command operations for the extension media review/apply slice.
ALTER TYPE "ExtensionCommandOperation" ADD VALUE IF NOT EXISTS 'MEDIA_REVIEW';
ALTER TYPE "ExtensionCommandOperation" ADD VALUE IF NOT EXISTS 'MEDIA_APPLY';

-- Serialize recovery of a response-lost PENDING command across server instances.
ALTER TABLE "extension_command_receipts"
  ADD COLUMN IF NOT EXISTS "recovery_not_before" TIMESTAMP(3);

ALTER TABLE "extension_command_receipts"
  ADD CONSTRAINT "extension_command_receipt_recovery_time_check"
  CHECK (
    "recovery_not_before" IS NULL
    OR "recovery_not_before" >= "created_at"
  );

-- An exact command may refresh an unconsumed short-lived grant after a lost
-- response or device access-token rotation. The command binding and token
-- secret stay immutable, and consumed/revoked grants can never be renewed.
CREATE OR REPLACE FUNCTION prevent_extension_command_grant_rewrite()
RETURNS trigger AS $$
DECLARE
  current_token_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'extension command grants cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."shop_id" IS DISTINCT FROM OLD."shop_id"
    OR NEW."operation" IS DISTINCT FROM OLD."operation"
    OR NEW."workflow_id" IS DISTINCT FROM OLD."workflow_id"
    OR NEW."draft_version" IS DISTINCT FROM OLD."draft_version"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."token_digest" IS DISTINCT FROM OLD."token_digest" THEN
    RAISE EXCEPTION 'extension command grant binding is immutable';
  END IF;

  IF NEW."token_id" IS DISTINCT FROM OLD."token_id"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
    IF OLD."consumed_at" IS NOT NULL
      OR OLD."revoked_at" IS NOT NULL
      OR NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at"
      OR NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at"
      OR NEW."revoked_reason" IS DISTINCT FROM OLD."revoked_reason"
      OR NEW."issued_at" < OLD."issued_at"
      OR EXISTS (
        SELECT 1 FROM "extension_command_receipts"
        WHERE "grant_id" = OLD."id"
      ) THEN
      RAISE EXCEPTION 'extension command grant renewal is invalid';
    END IF;

    SELECT "current_jti" INTO current_token_id
    FROM "extension_device_sessions"
    WHERE "id" = NEW."session_id"
      AND "owner_user_id" = NEW."owner_user_id"
      AND "status" = 'ACTIVE'
      AND "expires_at" > statement_timestamp()
    FOR KEY SHARE;
    IF current_token_id IS NULL OR NEW."token_id" IS DISTINCT FROM current_token_id THEN
      RAISE EXCEPTION 'extension command grant renewal token is not current';
    END IF;
    RETURN NEW;
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

  IF NEW."status" = 'PENDING' THEN
    IF NEW."result" IS DISTINCT FROM OLD."result"
      OR NEW."failure_code" IS DISTINCT FROM OLD."failure_code"
      OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
      OR NEW."recovery_not_before" IS NULL
      OR (
        OLD."recovery_not_before" IS NOT NULL
        AND NEW."recovery_not_before" <= OLD."recovery_not_before"
      ) THEN
      RAISE EXCEPTION 'pending extension command receipt recovery lease is invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" NOT IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'pending extension command receipts may only be completed';
  END IF;
  IF NEW."recovery_not_before" IS DISTINCT FROM OLD."recovery_not_before" THEN
    RAISE EXCEPTION 'receipt recovery lease cannot change during completion';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
