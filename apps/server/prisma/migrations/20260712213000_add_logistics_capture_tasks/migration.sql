BEGIN;
-- CreateEnum
CREATE TYPE "LogisticsCaptureTaskKind" AS ENUM ('SELLER', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "LogisticsCaptureTaskStatus" AS ENUM ('ISSUED', 'CLAIMED', 'REVIEWABLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogisticsCaptureCandidateState" AS ENUM ('CAPTURED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "LogisticsCaptureReviewStatus" AS ENUM ('PENDING_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "logistics_capture_tasks" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "kind" "LogisticsCaptureTaskKind" NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "origin_country_uid" TEXT NOT NULL,
    "origin_city_uid" TEXT NOT NULL,
    "company_binding_id" TEXT NOT NULL,
    "origin_binding_id" TEXT NOT NULL,
    "destination_country_uid" TEXT,
    "destination_location_uid" TEXT,
    "official_fingerprint" JSONB,
    "expected_endpoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fingerprint_checksum" TEXT NOT NULL,
    "nonce_digest" TEXT NOT NULL,
    "status" "LogisticsCaptureTaskStatus" NOT NULL DEFAULT 'ISSUED',
    "claimed_by_session_id" TEXT,
    "candidate_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3),
    "reviewable_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_capture_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_capture_candidates" (
    "id" TEXT NOT NULL,
    "source_task_id" TEXT NOT NULL,
    "task_kind" "LogisticsCaptureTaskKind" NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "origin_country_uid" TEXT NOT NULL,
    "origin_city_uid" TEXT NOT NULL,
    "destination_country_uid" TEXT,
    "destination_location_uid" TEXT,
    "fingerprint_checksum" TEXT NOT NULL,
    "response_checksum" TEXT NOT NULL,
    "source_response_checksum" TEXT,
    "previous_response_checksum" TEXT,
    "captured_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL,
    "state" "LogisticsCaptureCandidateState" NOT NULL,
    "review_status" "LogisticsCaptureReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "source_trust" TEXT NOT NULL,
    "quarantine_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "normalized_payload" JSONB,
    "diagnostics" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_capture_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "extension_device_sessions_id_owner_user_id_key"
  ON "extension_device_sessions"("id", "owner_user_id");

CREATE UNIQUE INDEX "logistics_capture_tasks_nonce_digest_key"
  ON "logistics_capture_tasks"("nonce_digest");
CREATE UNIQUE INDEX "logistics_capture_tasks_candidate_id_key"
  ON "logistics_capture_tasks"("candidate_id");
CREATE UNIQUE INDEX "capture_task_scope_key"
  ON "logistics_capture_tasks"(
    "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
    "origin_country_uid", "origin_city_uid"
  );
CREATE INDEX "logistics_capture_tasks_scope_status_expiry_idx"
  ON "logistics_capture_tasks"("tenant_id", "shop_id", "warehouse_id", "status", "expires_at");
CREATE INDEX "logistics_capture_tasks_claimed_session_status_idx"
  ON "logistics_capture_tasks"("claimed_by_session_id", "status");

CREATE UNIQUE INDEX "logistics_capture_candidates_source_task_id_key"
  ON "logistics_capture_candidates"("source_task_id");
CREATE UNIQUE INDEX "capture_candidate_id_scope_key"
  ON "logistics_capture_candidates"(
    "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
    "origin_country_uid", "origin_city_uid"
  );
CREATE UNIQUE INDEX "capture_candidate_scope_response_key"
  ON "logistics_capture_candidates"(
    "tenant_id", "shop_id", "company_id", "warehouse_id",
    "origin_country_uid", "origin_city_uid", "fingerprint_checksum", "response_checksum"
  );
CREATE INDEX "logistics_capture_candidates_scope_review_idx"
  ON "logistics_capture_candidates"("tenant_id", "shop_id", "review_status", "received_at");
CREATE INDEX "logistics_capture_candidates_fingerprint_received_idx"
  ON "logistics_capture_candidates"("fingerprint_checksum", "received_at");

-- AddForeignKey
ALTER TABLE "logistics_capture_tasks"
  ADD CONSTRAINT "logistics_capture_tasks_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_tasks_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_tasks_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_tasks_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_tasks_company_binding_id_fkey"
    FOREIGN KEY ("company_binding_id") REFERENCES "shop_ozon_company_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_tasks_origin_binding_id_fkey"
    FOREIGN KEY ("origin_binding_id") REFERENCES "warehouse_ozon_origin_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_tasks_claimed_by_session_id_fkey"
    FOREIGN KEY ("claimed_by_session_id") REFERENCES "extension_device_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_tasks_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "logistics_capture_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_capture_candidates"
  ADD CONSTRAINT "logistics_capture_candidates_source_task_id_fkey"
    FOREIGN KEY ("source_task_id") REFERENCES "logistics_capture_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_candidates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_candidates_shop_id_fkey"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_candidates_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exact scope invariants.
ALTER TABLE "logistics_capture_tasks"
  ADD CONSTRAINT "capture_task_tenant_shop_fkey"
    FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_task_shop_warehouse_fkey"
    FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_task_company_scope_fkey"
    FOREIGN KEY ("company_binding_id", "tenant_id", "shop_id", "company_id")
    REFERENCES "shop_ozon_company_bindings"("id", "tenant_id", "shop_id", "ozon_company_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_task_origin_scope_fkey"
    FOREIGN KEY (
      "origin_binding_id", "tenant_id", "shop_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    )
    REFERENCES "warehouse_ozon_origin_bindings"(
      "id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid", "origin_city_uid"
    ) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_task_claimed_session_owner_fkey"
    FOREIGN KEY ("claimed_by_session_id", "tenant_id")
    REFERENCES "extension_device_sessions"("id", "owner_user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_task_candidate_scope_fkey"
    FOREIGN KEY (
      "candidate_id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    )
    REFERENCES "logistics_capture_candidates"(
      "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_capture_candidates"
  ADD CONSTRAINT "capture_candidate_tenant_shop_fkey"
    FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_shop_warehouse_fkey"
    FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_source_task_scope_fkey"
    FOREIGN KEY (
      "source_task_id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    )
    REFERENCES "logistics_capture_tasks"(
      "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lifecycle and payload shape checks.
ALTER TABLE "logistics_capture_tasks"
  ADD CONSTRAINT "logistics_capture_task_expiry_check"
    CHECK ("expires_at" > "issued_at"),
  ADD CONSTRAINT "logistics_capture_task_kind_check" CHECK (
    ("kind" = 'SELLER'
      AND "destination_country_uid" IS NULL
      AND "destination_location_uid" IS NULL
      AND "official_fingerprint" IS NULL
      AND cardinality("expected_endpoints") > 0)
    OR
    ("kind" = 'OFFICIAL'
      AND "destination_country_uid" IS NOT NULL
      AND "destination_location_uid" IS NOT NULL
      AND "official_fingerprint" IS NOT NULL
      AND cardinality("expected_endpoints") = 1)
  ),
  ADD CONSTRAINT "logistics_capture_task_state_check" CHECK (
    ("status" = 'ISSUED'
      AND "claimed_by_session_id" IS NULL AND "claimed_at" IS NULL
      AND "candidate_id" IS NULL AND "uploaded_at" IS NULL
      AND "reviewable_at" IS NULL AND "cancelled_at" IS NULL)
    OR
    ("status" = 'CLAIMED'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "candidate_id" IS NULL AND "uploaded_at" IS NULL
      AND "reviewable_at" IS NULL AND "cancelled_at" IS NULL)
    OR
    ("status" = 'REVIEWABLE'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "candidate_id" IS NOT NULL AND "uploaded_at" IS NOT NULL
      AND "reviewable_at" IS NOT NULL AND "cancelled_at" IS NULL)
    OR
    ("status" = 'CANCELLED'
      AND "candidate_id" IS NULL AND "uploaded_at" IS NULL
      AND "reviewable_at" IS NULL AND "cancelled_at" IS NOT NULL)
  );

ALTER TABLE "logistics_capture_candidates"
  ADD CONSTRAINT "logistics_capture_candidate_kind_check" CHECK (
    ("task_kind" = 'SELLER'
      AND "destination_country_uid" IS NULL AND "destination_location_uid" IS NULL)
    OR
    ("task_kind" = 'OFFICIAL'
      AND "destination_country_uid" IS NOT NULL AND "destination_location_uid" IS NOT NULL)
  ),
  ADD CONSTRAINT "logistics_capture_candidate_checksum_check" CHECK (
    "fingerprint_checksum" ~ '^[a-f0-9]{64}$'
    AND "response_checksum" ~ '^[a-f0-9]{64}$'
    AND ("source_response_checksum" IS NULL OR "source_response_checksum" ~ '^[a-f0-9]{64}$')
    AND ("previous_response_checksum" IS NULL OR "previous_response_checksum" ~ '^[a-f0-9]{64}$')
  );

CREATE FUNCTION "validate_logistics_capture_candidate_source_task"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "logistics_capture_tasks" task
    WHERE task."id" = NEW."source_task_id"
      AND task."tenant_id" = NEW."tenant_id"
      AND task."shop_id" = NEW."shop_id"
      AND task."company_id" = NEW."company_id"
      AND task."warehouse_id" = NEW."warehouse_id"
      AND task."origin_country_uid" = NEW."origin_country_uid"
      AND task."origin_city_uid" = NEW."origin_city_uid"
      AND task."kind" = NEW."task_kind"
      AND task."destination_country_uid" IS NOT DISTINCT FROM NEW."destination_country_uid"
      AND task."destination_location_uid" IS NOT DISTINCT FROM NEW."destination_location_uid"
      AND task."fingerprint_checksum" = NEW."fingerprint_checksum"
  ) THEN
    RAISE EXCEPTION 'logistics capture candidate source task provenance mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_capture_candidate_source_task_provenance"
  BEFORE INSERT OR UPDATE ON "logistics_capture_candidates"
  FOR EACH ROW EXECUTE FUNCTION "validate_logistics_capture_candidate_source_task"();

CREATE FUNCTION "protect_logistics_capture_task_source_provenance"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "logistics_capture_candidates" candidate
    WHERE candidate."source_task_id" = OLD."id"
      AND (
        candidate."source_task_id" IS DISTINCT FROM NEW."id"
        OR candidate."tenant_id" IS DISTINCT FROM NEW."tenant_id"
        OR candidate."shop_id" IS DISTINCT FROM NEW."shop_id"
        OR candidate."company_id" IS DISTINCT FROM NEW."company_id"
        OR candidate."warehouse_id" IS DISTINCT FROM NEW."warehouse_id"
        OR candidate."origin_country_uid" IS DISTINCT FROM NEW."origin_country_uid"
        OR candidate."origin_city_uid" IS DISTINCT FROM NEW."origin_city_uid"
        OR candidate."task_kind" IS DISTINCT FROM NEW."kind"
        OR candidate."destination_country_uid" IS DISTINCT FROM NEW."destination_country_uid"
        OR candidate."destination_location_uid" IS DISTINCT FROM NEW."destination_location_uid"
        OR candidate."fingerprint_checksum" IS DISTINCT FROM NEW."fingerprint_checksum"
        OR NEW."company_binding_id" IS DISTINCT FROM OLD."company_binding_id"
        OR NEW."origin_binding_id" IS DISTINCT FROM OLD."origin_binding_id"
        OR NEW."official_fingerprint" IS DISTINCT FROM OLD."official_fingerprint"
        OR NEW."expected_endpoints" IS DISTINCT FROM OLD."expected_endpoints"
      )
  ) THEN
    RAISE EXCEPTION 'logistics capture candidate source task provenance mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_capture_task_source_provenance_immutable"
  BEFORE UPDATE ON "logistics_capture_tasks"
  FOR EACH ROW EXECUTE FUNCTION "protect_logistics_capture_task_source_provenance"();

CREATE FUNCTION "prevent_logistics_capture_candidate_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR to_jsonb(OLD) - ARRAY['review_status']
       IS DISTINCT FROM to_jsonb(NEW) - ARRAY['review_status'] THEN
    RAISE EXCEPTION 'logistics capture candidate content is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_capture_candidate_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_capture_candidates"
  FOR EACH ROW EXECUTE FUNCTION "prevent_logistics_capture_candidate_mutation"();
COMMIT;
