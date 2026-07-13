BEGIN;
-- CreateEnum
CREATE TYPE "LogisticsScopeBootstrapStatus" AS ENUM ('CANDIDATE', 'ACTIVATED');

-- CreateEnum
CREATE TYPE "LogisticsCompanyProbeStatus" AS ENUM (
  'ISSUED', 'CLAIMED', 'SUBMITTED', 'CONFIRMED', 'REJECTED', 'EXPIRED'
);

-- Make a channel's deployment and wire-schema identity explicit. Existing
-- pre-bootstrap channels remain isolated as legacy schema-v1 rows.
ALTER TABLE "logistics_rule_channels"
  ADD COLUMN "deployment_id" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "schema_major" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "logistics_rule_channel_deployment_schema_check" CHECK (
    char_length(btrim("deployment_id")) BETWEEN 1 AND 300
    AND "schema_major" BETWEEN 1 AND 2147483647
  );

CREATE INDEX "logistics_rule_channels_deployment_schema_scope_idx"
  ON "logistics_rule_channels"(
    "deployment_id", "schema_major", "tenant_id", "shop_id", "warehouse_id"
  );

-- CreateTable
CREATE TABLE "logistics_scope_bootstraps" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "delivery_method_id" TEXT NOT NULL,
  "status" "LogisticsScopeBootstrapStatus" NOT NULL DEFAULT 'CANDIDATE',
  "open_api_evidence" JSONB NOT NULL,
  "evidence_checksum" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "logistics_scope_bootstraps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "logistics_company_probes" (
  "id" TEXT NOT NULL,
  "bootstrap_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "nonce_digest" TEXT NOT NULL,
  "status" "LogisticsCompanyProbeStatus" NOT NULL DEFAULT 'ISSUED',
  "claimed_by_session_id" TEXT,
  "submitted_company_id" TEXT,
  "submitted_evidence" JSONB,
  "company_binding_id" TEXT,
  "issued_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "claimed_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "logistics_company_probes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "logistics_scope_events" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "bootstrap_id" TEXT,
  "probe_id" TEXT,
  "channel_id" TEXT,
  "assignment_id" TEXT,
  "subject_type" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "device_session_id" TEXT,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logistics_scope_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "logistics_scope_bootstraps_scope_key"
  ON "logistics_scope_bootstraps"(
    "tenant_id", "shop_id", "warehouse_id", "delivery_method_id"
  );
CREATE INDEX "logistics_scope_bootstraps_tenant_shop_status_idx"
  ON "logistics_scope_bootstraps"("tenant_id", "shop_id", "status");
CREATE UNIQUE INDEX "logistics_company_probes_nonce_digest_key"
  ON "logistics_company_probes"("nonce_digest");
CREATE UNIQUE INDEX "logistics_company_probes_one_live_per_bootstrap"
  ON "logistics_company_probes"("bootstrap_id")
  WHERE "status" IN ('ISSUED', 'CLAIMED', 'SUBMITTED');
CREATE INDEX "logistics_company_probes_bootstrap_status_expiry_idx"
  ON "logistics_company_probes"("bootstrap_id", "status", "expires_at");
CREATE INDEX "logistics_company_probes_session_status_idx"
  ON "logistics_company_probes"("claimed_by_session_id", "status");
CREATE INDEX "logistics_scope_events_tenant_shop_created_idx"
  ON "logistics_scope_events"("tenant_id", "shop_id", "created_at");
CREATE INDEX "logistics_scope_events_bootstrap_created_idx"
  ON "logistics_scope_events"("bootstrap_id", "created_at");
CREATE INDEX "logistics_scope_events_probe_created_idx"
  ON "logistics_scope_events"("probe_id", "created_at");

-- Foreign keys and exact-scope boundaries.
ALTER TABLE "logistics_scope_bootstraps"
  ADD CONSTRAINT "logistics_scope_bootstraps_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_bootstraps_shop_scope_fkey"
    FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_bootstraps_warehouse_scope_fkey"
    FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_bootstraps_method_scope_fkey"
    FOREIGN KEY ("delivery_method_id", "warehouse_id")
    REFERENCES "shop_delivery_methods"("id", "warehouse_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_bootstraps_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_company_probes"
  ADD CONSTRAINT "logistics_company_probes_bootstrap_id_fkey"
    FOREIGN KEY ("bootstrap_id") REFERENCES "logistics_scope_bootstraps"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_company_probes_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_company_probes_claimed_session_id_fkey"
    FOREIGN KEY ("claimed_by_session_id") REFERENCES "extension_device_sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_company_probes_company_binding_id_fkey"
    FOREIGN KEY ("company_binding_id") REFERENCES "shop_ozon_company_bindings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_company_probes_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_scope_events"
  ADD CONSTRAINT "logistics_scope_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_events_shop_scope_fkey"
    FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_events_bootstrap_id_fkey"
    FOREIGN KEY ("bootstrap_id") REFERENCES "logistics_scope_bootstraps"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_events_probe_id_fkey"
    FOREIGN KEY ("probe_id") REFERENCES "logistics_company_probes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_events_channel_id_fkey"
    FOREIGN KEY ("channel_id") REFERENCES "logistics_rule_channels"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_events_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "logistics_rule_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_scope_events_device_session_id_fkey"
    FOREIGN KEY ("device_session_id") REFERENCES "extension_device_sessions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lifecycle and evidence checks.
ALTER TABLE "logistics_scope_bootstraps"
  ADD CONSTRAINT "logistics_scope_bootstrap_checksum_check"
    CHECK ("evidence_checksum" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "logistics_scope_bootstrap_activation_check" CHECK (
    ("status" = 'CANDIDATE' AND "activated_at" IS NULL)
    OR ("status" = 'ACTIVATED' AND "activated_at" IS NOT NULL)
  );

ALTER TABLE "logistics_company_probes"
  ADD CONSTRAINT "logistics_company_probe_digest_check"
    CHECK ("nonce_digest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "logistics_company_probe_expiry_check"
    CHECK ("expires_at" > "issued_at"),
  ADD CONSTRAINT "logistics_company_probe_review_reason_check"
    CHECK ("review_reason" IS NULL OR char_length("review_reason") BETWEEN 5 AND 500),
  ADD CONSTRAINT "logistics_company_probe_state_check" CHECK (
    ("status" = 'ISSUED'
      AND "claimed_by_session_id" IS NULL AND "claimed_at" IS NULL
      AND "submitted_company_id" IS NULL AND "submitted_evidence" IS NULL
      AND "submitted_at" IS NULL AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL AND "review_reason" IS NULL)
    OR
    ("status" = 'CLAIMED'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "submitted_company_id" IS NULL AND "submitted_evidence" IS NULL
      AND "submitted_at" IS NULL AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL AND "review_reason" IS NULL)
    OR
    ("status" = 'SUBMITTED'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "submitted_company_id" IS NOT NULL AND "submitted_evidence" IS NOT NULL
      AND "submitted_at" IS NOT NULL AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL AND "review_reason" IS NULL)
    OR
    ("status" = 'CONFIRMED'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "submitted_company_id" IS NOT NULL AND "submitted_evidence" IS NOT NULL
      AND "submitted_at" IS NOT NULL AND "company_binding_id" IS NOT NULL
      AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
      AND "review_reason" IS NOT NULL)
    OR
    ("status" = 'REJECTED'
      AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
      AND "review_reason" IS NOT NULL)
    OR
    ("status" = 'EXPIRED'
      AND "submitted_company_id" IS NULL AND "submitted_evidence" IS NULL
      AND "submitted_at" IS NULL AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL
      AND "review_reason" IS NULL
      AND (("claimed_by_session_id" IS NULL AND "claimed_at" IS NULL)
        OR ("claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL)))
  );

ALTER TABLE "logistics_scope_events"
  ADD CONSTRAINT "logistics_scope_event_sanitized_payload_check" CHECK (
    NOT ("payload"::text ~* '"(authorization|proxy-authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password)"[[:space:]]*:')
  );

CREATE FUNCTION "protect_logistics_company_probe_provenance"() RETURNS trigger AS $$
BEGIN
  IF NEW."bootstrap_id" IS DISTINCT FROM OLD."bootstrap_id"
    OR NEW."requested_by_id" IS DISTINCT FROM OLD."requested_by_id"
    OR NEW."nonce_digest" IS DISTINCT FROM OLD."nonce_digest"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
    RAISE EXCEPTION 'logistics company probe provenance is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."submitted_company_id" IS NOT NULL
    AND (NEW."submitted_company_id" IS DISTINCT FROM OLD."submitted_company_id"
      OR NEW."submitted_evidence" IS DISTINCT FROM OLD."submitted_evidence"
      OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at") THEN
    RAISE EXCEPTION 'logistics company probe submitted evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_company_probe_provenance_immutable"
  BEFORE UPDATE ON "logistics_company_probes"
  FOR EACH ROW EXECUTE FUNCTION "protect_logistics_company_probe_provenance"();
COMMIT;
