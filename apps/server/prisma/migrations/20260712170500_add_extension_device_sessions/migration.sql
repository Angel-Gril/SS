BEGIN;
-- Revocable extension-device pairing, sessions, credentials, grants, and receipts.

CREATE TYPE "ExtensionDevicePairingStatus" AS ENUM ('PENDING', 'CLAIMED', 'CANCELED');
CREATE TYPE "ExtensionDeviceSessionStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ExtensionDeviceRefreshFamilyStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ExtensionDeviceShopGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ExtensionDeviceAssignmentGrantStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "ExtensionDeviceSecurityEventType" AS ENUM (
  'PAIRING_CLAIMED',
  'SESSION_REVOKED',
  'REFRESH_REUSE_DETECTED'
);
CREATE TYPE "ExtensionDeviceRevocationReason" AS ENUM (
  'PAIRING_APPROVED',
  'OWNER_REVOKED',
  'PASSWORD_RESET',
  'ACCOUNT_SUSPENDED',
  'ACTOR_UNLINKED',
  'SHOP_TRANSFERRED',
  'AUTHORIZATION_INVALID',
  'SESSION_EXPIRED',
  'REFRESH_REUSE_DETECTED',
  'ASSIGNMENT_REVOKED',
  'ASSIGNMENT_RETIRED',
  'SHOP_UNLINKED',
  'WAREHOUSE_RETIRED',
  'SCOPE_REVOKED'
);
CREATE TYPE "LogisticsRuleReleaseAckStatus" AS ENUM ('APPLIED', 'FAILED');

CREATE TABLE "extension_device_pairing_codes" (
  "id" TEXT NOT NULL,
  "deployment_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "code_digest" TEXT NOT NULL,
  "shop_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "device_label" TEXT,
  "status" "ExtensionDevicePairingStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "claimed_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "extension_device_pairing_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_device_pairing_digest_check"
    CHECK ("code_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "extension_device_pairing_scope_check"
    CHECK (cardinality("shop_ids") BETWEEN 1 AND 50 AND cardinality("scopes") > 0),
  CONSTRAINT "extension_device_pairing_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "extension_device_pairing_status_timestamps_check" CHECK (
    ("status" = 'PENDING' AND "claimed_at" IS NULL AND "canceled_at" IS NULL)
    OR ("status" = 'CLAIMED' AND "claimed_at" IS NOT NULL AND "canceled_at" IS NULL)
    OR ("status" = 'CANCELED' AND "claimed_at" IS NULL AND "canceled_at" IS NOT NULL)
  )
);

CREATE TABLE "extension_device_sessions" (
  "id" TEXT NOT NULL,
  "pairing_code_id" TEXT NOT NULL,
  "deployment_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "device_label" TEXT,
  "actor_user_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "status" "ExtensionDeviceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "current_jti" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" "ExtensionDeviceRevocationReason",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "extension_device_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_device_session_scope_check"
    CHECK (cardinality("scopes") > 0),
  CONSTRAINT "extension_device_session_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "extension_device_session_revocation_check" CHECK (
    ("status" = 'ACTIVE' AND "revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
  )
);

CREATE TABLE "extension_device_refresh_families" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "status" "ExtensionDeviceRefreshFamilyStatus" NOT NULL DEFAULT 'ACTIVE',
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" "ExtensionDeviceRevocationReason",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "extension_device_refresh_families_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_device_refresh_family_revocation_check" CHECK (
    ("status" = 'ACTIVE' AND "revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
  )
);

CREATE TABLE "extension_device_refresh_credentials" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "credential_digest" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "replaced_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "extension_device_refresh_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_device_refresh_credential_digest_check"
    CHECK ("credential_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "extension_device_refresh_credential_time_check"
    CHECK ("expires_at" > "created_at" AND ("consumed_at" IS NULL OR "consumed_at" >= "created_at")),
  CONSTRAINT "extension_device_refresh_credential_rotation_check" CHECK (
    "generation" > 0
    AND (
      ("consumed_at" IS NULL AND "replaced_by_id" IS NULL)
      OR ("consumed_at" IS NOT NULL AND "replaced_by_id" IS NOT NULL)
    )
  )
);

CREATE TABLE "extension_device_shop_grants" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "status" "ExtensionDeviceShopGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" "ExtensionDeviceRevocationReason",
  CONSTRAINT "extension_device_shop_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_device_shop_grant_revocation_check" CHECK (
    ("status" = 'ACTIVE' AND "revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
  )
);

CREATE TABLE "extension_device_assignment_grants" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "scope_key_hash" TEXT NOT NULL,
  "status" "ExtensionDeviceAssignmentGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "first_delivered_at" TIMESTAMP(3),
  "last_authorized_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" "ExtensionDeviceRevocationReason",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "extension_device_assignment_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_device_assignment_grant_scope_hash_check"
    CHECK ("scope_key_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "extension_device_assignment_grant_revocation_check" CHECK (
    ("status" = 'ACTIVE' AND "revoked_at" IS NULL AND "revoked_reason" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_reason" IS NOT NULL)
  ),
  CONSTRAINT "extension_device_assignment_grant_delivery_time_check" CHECK (
    ("first_delivered_at" IS NULL AND "last_authorized_at" IS NULL)
    OR (
      "first_delivered_at" IS NOT NULL
      AND ("last_authorized_at" IS NULL OR "last_authorized_at" >= "first_delivered_at")
    )
  )
);

CREATE TABLE "extension_device_security_events" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "refresh_family_id" TEXT,
  "actor_user_id" TEXT,
  "type" "ExtensionDeviceSecurityEventType" NOT NULL,
  "reason_code" "ExtensionDeviceRevocationReason" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "extension_device_security_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_device_security_event_reuse_family_check"
    CHECK ("type" <> 'REFRESH_REUSE_DETECTED' OR "refresh_family_id" IS NOT NULL)
);

CREATE TABLE "logistics_rule_release_acks" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "release_id" TEXT NOT NULL,
  "effective_checksum" TEXT NOT NULL,
  "status" "LogisticsRuleReleaseAckStatus" NOT NULL,
  "failure_code" TEXT,
  "extension_version" TEXT NOT NULL,
  "applied_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logistics_rule_release_acks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "logistics_rule_release_ack_checksum_check"
    CHECK ("effective_checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "logistics_rule_release_ack_idempotency_key_check"
    CHECK (length(btrim("idempotency_key")) BETWEEN 16 AND 200),
  CONSTRAINT "logistics_rule_release_ack_status_shape_check" CHECK (
    ("status" = 'APPLIED' AND "applied_at" IS NOT NULL AND "failure_code" IS NULL)
    OR (
      "status" = 'FAILED'
      AND "applied_at" IS NULL
      AND "failure_code" IN (
        'checksum_mismatch',
        'schema_unsupported',
        'storage_quota',
        'scope_mismatch',
        'apply_failed'
      )
    )
  ),
  CONSTRAINT "logistics_rule_release_ack_extension_version_check"
    CHECK (length(btrim("extension_version")) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "extension_device_pairing_codes_code_digest_key"
  ON "extension_device_pairing_codes"("code_digest");
CREATE INDEX "extension_device_pairing_codes_owner_user_id_status_expires_at_idx"
  ON "extension_device_pairing_codes"("owner_user_id", "status", "expires_at");
CREATE INDEX "extension_device_pairing_codes_actor_user_id_status_idx"
  ON "extension_device_pairing_codes"("actor_user_id", "status");
CREATE INDEX "extension_device_pairing_codes_deployment_id_status_expires_at_idx"
  ON "extension_device_pairing_codes"("deployment_id", "status", "expires_at");

CREATE UNIQUE INDEX "extension_device_sessions_pairing_code_id_key"
  ON "extension_device_sessions"("pairing_code_id");
CREATE UNIQUE INDEX "extension_device_sessions_current_jti_key"
  ON "extension_device_sessions"("current_jti");
CREATE INDEX "extension_device_sessions_owner_user_id_status_expires_at_idx"
  ON "extension_device_sessions"("owner_user_id", "status", "expires_at");
CREATE INDEX "extension_device_sessions_actor_user_id_status_idx"
  ON "extension_device_sessions"("actor_user_id", "status");
CREATE INDEX "extension_device_sessions_deployment_id_device_id_status_idx"
  ON "extension_device_sessions"("deployment_id", "device_id", "status");

CREATE UNIQUE INDEX "extension_device_refresh_families_session_id_key"
  ON "extension_device_refresh_families"("session_id");
CREATE UNIQUE INDEX "extension_device_refresh_families_id_session_id_key"
  ON "extension_device_refresh_families"("id", "session_id");
CREATE INDEX "extension_device_refresh_families_session_id_status_idx"
  ON "extension_device_refresh_families"("session_id", "status");

CREATE UNIQUE INDEX "extension_device_refresh_credentials_credential_digest_key"
  ON "extension_device_refresh_credentials"("credential_digest");
CREATE UNIQUE INDEX "extension_device_refresh_credentials_replaced_by_id_key"
  ON "extension_device_refresh_credentials"("replaced_by_id");
CREATE UNIQUE INDEX "extension_device_refresh_credentials_family_id_generation_key"
  ON "extension_device_refresh_credentials"("family_id", "generation");
CREATE INDEX "extension_device_refresh_credentials_family_id_expires_at_idx"
  ON "extension_device_refresh_credentials"("family_id", "expires_at");

CREATE UNIQUE INDEX "extension_device_shop_grants_session_id_shop_id_key"
  ON "extension_device_shop_grants"("session_id", "shop_id");
CREATE INDEX "extension_device_shop_grants_shop_id_status_idx"
  ON "extension_device_shop_grants"("shop_id", "status");

CREATE UNIQUE INDEX "logistics_rule_assignments_id_shop_id_key"
  ON "logistics_rule_assignments"("id", "shop_id");
CREATE UNIQUE INDEX "extension_device_assignment_grants_session_id_assignment_id_key"
  ON "extension_device_assignment_grants"("session_id", "assignment_id");
CREATE INDEX "extension_device_assignment_grants_shop_id_status_idx"
  ON "extension_device_assignment_grants"("shop_id", "status");
CREATE INDEX "extension_device_assignment_grants_assignment_id_status_idx"
  ON "extension_device_assignment_grants"("assignment_id", "status");

CREATE INDEX "extension_device_security_events_refresh_family_id_type_idx"
  ON "extension_device_security_events"("refresh_family_id", "type");
CREATE INDEX "extension_device_security_events_session_id_created_at_idx"
  ON "extension_device_security_events"("session_id", "created_at");
CREATE INDEX "extension_device_security_events_actor_user_id_created_at_idx"
  ON "extension_device_security_events"("actor_user_id", "created_at");
CREATE UNIQUE INDEX "extension_device_security_events_refresh_reuse_once"
  ON "extension_device_security_events"("refresh_family_id")
  WHERE "type" = 'REFRESH_REUSE_DETECTED' AND "refresh_family_id" IS NOT NULL;

CREATE UNIQUE INDEX "logistics_rule_releases_id_effective_checksum_key"
  ON "logistics_rule_releases"("id", "effective_checksum");
CREATE UNIQUE INDEX "logistics_rule_release_acks_idempotency_key_key"
  ON "logistics_rule_release_acks"("idempotency_key");
CREATE UNIQUE INDEX "logistics_rule_release_acks_session_assignment_release_checksum_key"
  ON "logistics_rule_release_acks"("session_id", "assignment_id", "release_id", "effective_checksum");
CREATE INDEX "logistics_rule_release_acks_assignment_id_status_idx"
  ON "logistics_rule_release_acks"("assignment_id", "status");
CREATE INDEX "logistics_rule_release_acks_release_id_status_idx"
  ON "logistics_rule_release_acks"("release_id", "status");

ALTER TABLE "extension_device_pairing_codes"
  ADD CONSTRAINT "extension_device_pairing_codes_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_pairing_codes_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_device_sessions"
  ADD CONSTRAINT "extension_device_sessions_pairing_code_id_fkey"
  FOREIGN KEY ("pairing_code_id") REFERENCES "extension_device_pairing_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_sessions_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_sessions_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_device_refresh_families"
  ADD CONSTRAINT "extension_device_refresh_families_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "extension_device_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_device_refresh_credentials"
  ADD CONSTRAINT "extension_device_refresh_credentials_family_id_fkey"
  FOREIGN KEY ("family_id") REFERENCES "extension_device_refresh_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_refresh_credentials_replaced_by_id_fkey"
  FOREIGN KEY ("replaced_by_id") REFERENCES "extension_device_refresh_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_device_shop_grants"
  ADD CONSTRAINT "extension_device_shop_grants_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "extension_device_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_shop_grants_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_device_assignment_grants"
  ADD CONSTRAINT "extension_device_assignment_grants_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "extension_device_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_assignment_grants_assignment_shop_fkey"
  FOREIGN KEY ("assignment_id", "shop_id")
  REFERENCES "logistics_rule_assignments"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_assignment_grants_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_device_security_events"
  ADD CONSTRAINT "extension_device_security_events_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "extension_device_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_security_events_refresh_family_id_fkey"
  FOREIGN KEY ("refresh_family_id") REFERENCES "extension_device_refresh_families"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_security_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "extension_device_security_events_family_session_fkey"
  FOREIGN KEY ("refresh_family_id", "session_id")
  REFERENCES "extension_device_refresh_families"("id", "session_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_rule_release_acks"
  ADD CONSTRAINT "logistics_rule_release_acks_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "extension_device_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_rule_release_acks_assignment_id_fkey"
  FOREIGN KEY ("assignment_id") REFERENCES "logistics_rule_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_rule_release_acks_release_checksum_fkey"
  FOREIGN KEY ("release_id", "effective_checksum")
  REFERENCES "logistics_rule_releases"("id", "effective_checksum") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_extension_device_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_device_security_events_immutable"
  BEFORE UPDATE OR DELETE ON "extension_device_security_events"
  FOR EACH ROW EXECUTE FUNCTION "prevent_extension_device_audit_mutation"();

CREATE TRIGGER "logistics_rule_release_acks_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_rule_release_acks"
  FOR EACH ROW EXECUTE FUNCTION "prevent_extension_device_audit_mutation"();

CREATE FUNCTION "prevent_extension_device_assignment_grant_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'assignment grant tombstones cannot be deleted' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_device_assignment_grants_no_delete"
  BEFORE DELETE ON "extension_device_assignment_grants"
  FOR EACH ROW EXECUTE FUNCTION "prevent_extension_device_assignment_grant_delete"();

CREATE FUNCTION "prevent_extension_device_assignment_grant_rewrite"() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW."session_id", NEW."assignment_id", NEW."shop_id", NEW."scope_key_hash",
         NEW."first_delivered_at", NEW."created_at")
     IS DISTINCT FROM
     ROW(OLD."session_id", OLD."assignment_id", OLD."shop_id", OLD."scope_key_hash",
         OLD."first_delivered_at", OLD."created_at")
     OR OLD."status" = 'REVOKED' THEN
    RAISE EXCEPTION 'assignment grant identity and revoked tombstones are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_device_assignment_grants_tombstone"
  BEFORE UPDATE ON "extension_device_assignment_grants"
  FOR EACH ROW EXECUTE FUNCTION "prevent_extension_device_assignment_grant_rewrite"();

CREATE FUNCTION "prevent_extension_device_shop_grant_rewrite"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shop grant tombstones cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."session_id", NEW."shop_id", NEW."granted_at")
     IS DISTINCT FROM ROW(OLD."session_id", OLD."shop_id", OLD."granted_at")
     OR OLD."status" = 'REVOKED' THEN
    RAISE EXCEPTION 'shop grant identity and revoked tombstones are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_device_shop_grants_tombstone"
  BEFORE UPDATE OR DELETE ON "extension_device_shop_grants"
  FOR EACH ROW EXECUTE FUNCTION "prevent_extension_device_shop_grant_rewrite"();
COMMIT;
