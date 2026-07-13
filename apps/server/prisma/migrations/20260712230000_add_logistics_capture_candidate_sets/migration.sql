BEGIN;
-- Candidate sets freeze one server-reviewed Seller/Official evidence combination.
CREATE UNIQUE INDEX "logistics_rule_assignments_full_scope_key"
  ON "logistics_rule_assignments"("id", "tenant_id", "shop_id", "warehouse_id", "channel_id");
CREATE UNIQUE INDEX "capture_candidate_id_response_key"
  ON "logistics_capture_candidates"("id", "response_checksum");

CREATE TABLE "logistics_capture_candidate_sets" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "origin_country_uid" TEXT NOT NULL,
  "origin_city_uid" TEXT NOT NULL,
  "destination_country_uid" TEXT NOT NULL,
  "destination_location_uid" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "seller_candidate_id" TEXT NOT NULL,
  "official_candidate_ids" TEXT[] NOT NULL,
  "selected_service_keys" TEXT[] NOT NULL,
  "default_service_keys" TEXT[] NOT NULL,
  "matrix_input" JSONB NOT NULL,
  "validation_matrix" JSONB NOT NULL,
  "point_evidence" JSONB NOT NULL,
  "content_checksum" TEXT NOT NULL,
  "min_extension_version" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logistics_capture_candidate_sets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capture_candidate_set_shape_check" CHECK (
    cardinality("selected_service_keys") > 0
    AND cardinality("selected_service_keys") <= 2500
    AND cardinality("default_service_keys") > 0
    AND "default_service_keys" <@ "selected_service_keys"
    AND cardinality("official_candidate_ids") BETWEEN 1 AND 500
    AND length(btrim("destination_country_uid")) > 0
    AND length(btrim("destination_location_uid")) > 0
    AND "content_checksum" ~ '^[a-f0-9]{64}$'
    AND length(btrim("min_extension_version")) > 0
    AND jsonb_typeof("matrix_input") = 'object'
    AND jsonb_typeof("validation_matrix") = 'object'
    AND jsonb_typeof("point_evidence") = 'object'
    AND "point_evidence"->>'status' = 'matched'
  )
);

CREATE TABLE "logistics_capture_candidate_set_officials" (
  "candidate_set_id" TEXT NOT NULL,
  "official_candidate_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "origin_country_uid" TEXT NOT NULL,
  "origin_city_uid" TEXT NOT NULL,
  "fingerprint_key" TEXT NOT NULL,
  "response_checksum" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logistics_capture_candidate_set_officials_pkey"
    PRIMARY KEY ("candidate_set_id", "official_candidate_id"),
  CONSTRAINT "capture_candidate_set_official_shape_check" CHECK (
    length(btrim("fingerprint_key")) > 0
    AND "response_checksum" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "capture_candidate_set_scope_key"
  ON "logistics_capture_candidate_sets"(
    "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
    "origin_country_uid", "origin_city_uid"
  );
CREATE UNIQUE INDEX "capture_candidate_set_content_checksum_key"
  ON "logistics_capture_candidate_sets"("content_checksum");
CREATE UNIQUE INDEX "capture_candidate_set_source_key"
  ON "logistics_capture_candidate_sets"("seller_candidate_id", "assignment_id", "content_checksum");
CREATE INDEX "capture_candidate_set_scope_created_idx"
  ON "logistics_capture_candidate_sets"("tenant_id", "shop_id", "warehouse_id", "created_at");
CREATE UNIQUE INDEX "capture_candidate_set_official_fingerprint_key"
  ON "logistics_capture_candidate_set_officials"("candidate_set_id", "fingerprint_key");
CREATE INDEX "capture_candidate_set_official_candidate_idx"
  ON "logistics_capture_candidate_set_officials"("official_candidate_id");

ALTER TABLE "logistics_capture_candidate_sets"
  ADD CONSTRAINT "capture_candidate_set_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_set_tenant_shop_fkey"
    FOREIGN KEY ("shop_id", "tenant_id") REFERENCES "shops"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_set_shop_warehouse_fkey"
    FOREIGN KEY ("warehouse_id", "shop_id") REFERENCES "warehouses"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_set_seller_scope_fkey"
    FOREIGN KEY (
      "seller_candidate_id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) REFERENCES "logistics_capture_candidates"(
      "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_set_assignment_scope_fkey"
    FOREIGN KEY ("assignment_id", "tenant_id", "shop_id", "warehouse_id", "channel_id")
    REFERENCES "logistics_rule_assignments"("id", "tenant_id", "shop_id", "warehouse_id", "channel_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_capture_candidate_set_officials"
  ADD CONSTRAINT "capture_candidate_set_official_set_scope_fkey"
    FOREIGN KEY (
      "candidate_set_id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) REFERENCES "logistics_capture_candidate_sets"(
      "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_set_official_scope_fkey"
    FOREIGN KEY (
      "official_candidate_id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) REFERENCES "logistics_capture_candidates"(
      "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
      "origin_country_uid", "origin_city_uid"
    ) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "capture_candidate_set_official_response_fkey"
    FOREIGN KEY ("official_candidate_id", "response_checksum")
    REFERENCES "logistics_capture_candidates"("id", "response_checksum")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_logistics_capture_candidate_set"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "logistics_capture_candidates" c
    WHERE c."id" = NEW."seller_candidate_id"
      AND c."task_kind" = 'SELLER'
      AND c."state" = 'CAPTURED'
      AND c."review_status" = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'candidate set requires one verified Seller candidate' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "logistics_rule_assignments" a
    JOIN "logistics_rule_channels" ch ON ch."id" = a."channel_id"
    JOIN "shop_ozon_company_bindings" cb ON cb."id" = ch."company_binding_id"
    JOIN "warehouse_ozon_origin_bindings" ob ON ob."id" = ch."origin_binding_id"
    WHERE a."id" = NEW."assignment_id"
      AND a."retired_at" IS NULL AND ch."retired_at" IS NULL
      AND a."tenant_id" = NEW."tenant_id"
      AND a."shop_id" = NEW."shop_id"
      AND a."warehouse_id" = NEW."warehouse_id"
      AND a."channel_id" = NEW."channel_id"
      AND a."destination_country_uid" = NEW."destination_country_uid"
      AND a."destination_location_uid" = NEW."destination_location_uid"
      AND ch."ozon_company_id" = NEW."company_id"
      AND ch."origin_country_uid" = NEW."origin_country_uid"
      AND ch."origin_city_uid" = NEW."origin_city_uid"
      AND cb."ozon_company_id" = NEW."company_id"
      AND ob."origin_country_uid" = NEW."origin_country_uid"
      AND ob."origin_city_uid" = NEW."origin_city_uid"
      AND cb."status" = 'VERIFIED' AND cb."invalidated_at" IS NULL AND cb."retired_at" IS NULL
      AND cb."open_api_verified_at" IS NOT NULL
      AND cb."seller_probe_verified_at" IS NOT NULL
      AND cb."open_api_intersection_verified_at" IS NOT NULL
      AND ob."status" = 'VERIFIED' AND ob."invalidated_at" IS NULL AND ob."retired_at" IS NULL
      AND ob."open_api_address_verified_at" IS NOT NULL
      AND ob."official_location_verified_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'candidate set requires active verified assignment provenance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_capture_candidate_set_validate"
  BEFORE INSERT ON "logistics_capture_candidate_sets"
  FOR EACH ROW EXECUTE FUNCTION "validate_logistics_capture_candidate_set"();

CREATE FUNCTION "validate_logistics_capture_candidate_set_official"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "logistics_capture_candidates" c
    JOIN "logistics_capture_candidate_sets" cs ON cs."id" = NEW."candidate_set_id"
    WHERE c."id" = NEW."official_candidate_id"
      AND c."task_kind" = 'OFFICIAL'
      AND c."state" = 'CAPTURED'
      AND c."review_status" = 'VERIFIED'
      AND c."destination_country_uid" = cs."destination_country_uid"
      AND c."destination_location_uid" = cs."destination_location_uid"
  ) THEN
    RAISE EXCEPTION 'candidate set requires verified Official candidates' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_capture_candidate_set_official_validate"
  BEFORE INSERT ON "logistics_capture_candidate_set_officials"
  FOR EACH ROW EXECUTE FUNCTION "validate_logistics_capture_candidate_set_official"();

CREATE FUNCTION "check_logistics_capture_candidate_set_members"() RETURNS trigger AS $$
DECLARE
  expected_ids TEXT[];
  actual_ids TEXT[];
  set_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'logistics_capture_candidate_sets' THEN
    set_id := NEW."id";
  ELSE
    set_id := NEW."candidate_set_id";
  END IF;
  SELECT ARRAY(SELECT unnest(cs."official_candidate_ids") ORDER BY 1),
         COALESCE(array_agg(link."official_candidate_id" ORDER BY link."official_candidate_id")
           FILTER (WHERE link."official_candidate_id" IS NOT NULL), ARRAY[]::TEXT[])
    INTO expected_ids, actual_ids
  FROM "logistics_capture_candidate_sets" cs
  LEFT JOIN "logistics_capture_candidate_set_officials" link ON link."candidate_set_id" = cs."id"
  WHERE cs."id" = set_id
  GROUP BY cs."official_candidate_ids";
  IF expected_ids IS NULL OR expected_ids IS DISTINCT FROM actual_ids THEN
    RAISE EXCEPTION 'candidate set Official membership is inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "logistics_capture_candidate_set_members_complete"
  AFTER INSERT ON "logistics_capture_candidate_sets"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_logistics_capture_candidate_set_members"();
CREATE CONSTRAINT TRIGGER "logistics_capture_candidate_set_link_complete"
  AFTER INSERT ON "logistics_capture_candidate_set_officials"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_logistics_capture_candidate_set_members"();

CREATE FUNCTION "prevent_logistics_capture_candidate_set_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'logistics capture candidate sets are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "logistics_capture_candidate_set_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_capture_candidate_sets"
  FOR EACH ROW EXECUTE FUNCTION "prevent_logistics_capture_candidate_set_mutation"();
CREATE TRIGGER "logistics_capture_candidate_set_official_immutable"
  BEFORE UPDATE OR DELETE ON "logistics_capture_candidate_set_officials"
  FOR EACH ROW EXECUTE FUNCTION "prevent_logistics_capture_candidate_set_mutation"();
COMMIT;
