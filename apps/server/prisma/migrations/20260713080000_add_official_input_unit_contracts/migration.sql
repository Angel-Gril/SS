BEGIN;
CREATE TABLE "logistics_official_input_unit_contracts" (
  "id" TEXT NOT NULL,
  "contract_version" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "origin_country_uid" TEXT NOT NULL,
  "origin_city_uid" TEXT NOT NULL,
  "destination_country_uid" TEXT NOT NULL,
  "destination_location_uid" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "weight_unit" TEXT NOT NULL,
  "dimension_unit" TEXT NOT NULL,
  "price_input_unit" TEXT NOT NULL,
  "weight_increment_g" INTEGER NOT NULL,
  "dimension_increment_mm" INTEGER NOT NULL,
  "currency_minor_increment" INTEGER NOT NULL,
  "source_candidate_id" TEXT NOT NULL,
  "source_candidate_checksum" TEXT NOT NULL,
  "source_revision" TEXT NOT NULL,
  "source_checksum" TEXT NOT NULL,
  "source_evidence" JSONB NOT NULL,
  "reviewer_id" TEXT NOT NULL,
  "review_note" VARCHAR(1000) NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "valid_until" TIMESTAMP(3) NOT NULL,
  "supersedes_id" TEXT,
  "revoked_by_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revocation_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logistics_official_input_unit_contracts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "official_input_unit_contract_shape_check" CHECK (
    "contract_version" = 'ozon-official-input-unit-contract/v1'
    AND "currency" = 'CNY'
    AND "weight_unit" = 'g'
    AND "dimension_unit" = 'mm'
    AND "price_input_unit" = 'CNY_MAJOR'
    AND "weight_increment_g" > 0
    AND "dimension_increment_mm" > 0
    AND "currency_minor_increment" > 0
    AND "source_candidate_checksum" ~ '^[a-f0-9]{64}$'
    AND "source_checksum" ~ '^[a-f0-9]{64}$'
    AND "source_revision" = 'official-input-units/v1:' || "source_checksum"
    AND jsonb_typeof("source_evidence") = 'object'
    AND length(btrim("review_note")) BETWEEN 3 AND 1000
    AND "valid_until" > "verified_at"
    AND "valid_until" <= "verified_at" + INTERVAL '7 days'
    AND "supersedes_id" IS DISTINCT FROM "id"
  ),
  CONSTRAINT "official_input_unit_revocation_shape_check" CHECK (
    ("revoked_by_id" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
    OR
    ("revoked_by_id" IS NOT NULL AND "revoked_at" IS NOT NULL
      AND "revocation_reason" IS NOT NULL
      AND length(btrim("revocation_reason")) BETWEEN 5 AND 500)
  )
);

CREATE UNIQUE INDEX "official_input_unit_source_revision_key"
  ON "logistics_official_input_unit_contracts"("source_revision");
CREATE UNIQUE INDEX "official_input_unit_supersedes_key"
  ON "logistics_official_input_unit_contracts"("supersedes_id");
CREATE UNIQUE INDEX "official_input_unit_assignment_candidate_key"
  ON "logistics_official_input_unit_contracts"("assignment_id", "source_candidate_id");
CREATE UNIQUE INDEX "official_input_unit_assignment_checksum_key"
  ON "logistics_official_input_unit_contracts"("assignment_id", "source_checksum");
CREATE INDEX "official_input_unit_assignment_verified_idx"
  ON "logistics_official_input_unit_contracts"("assignment_id", "verified_at");
CREATE INDEX "official_input_unit_scope_valid_idx"
  ON "logistics_official_input_unit_contracts"(
    "tenant_id", "shop_id", "warehouse_id",
    "destination_country_uid", "destination_location_uid", "valid_until"
  );

ALTER TABLE "logistics_official_input_unit_contracts"
  ADD CONSTRAINT "official_input_unit_assignment_scope_fkey"
    FOREIGN KEY ("assignment_id", "tenant_id", "shop_id", "warehouse_id", "channel_id")
    REFERENCES "logistics_rule_assignments"(
      "id", "tenant_id", "shop_id", "warehouse_id", "channel_id"
    ) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "official_input_unit_candidate_scope_fkey"
    FOREIGN KEY (
      "source_candidate_id", "tenant_id", "shop_id", "company_id",
      "warehouse_id", "origin_country_uid", "origin_city_uid"
    ) REFERENCES "logistics_capture_candidates"(
      "id", "tenant_id", "shop_id", "company_id",
      "warehouse_id", "origin_country_uid", "origin_city_uid"
    ) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "official_input_unit_candidate_checksum_fkey"
    FOREIGN KEY ("source_candidate_id", "source_candidate_checksum")
    REFERENCES "logistics_capture_candidates"("id", "response_checksum")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "official_input_unit_reviewer_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "official_input_unit_revoker_fkey"
    FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "official_input_unit_supersedes_fkey"
    FOREIGN KEY ("supersedes_id") REFERENCES "logistics_official_input_unit_contracts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_official_input_unit_contract"() RETURNS trigger AS $$
BEGIN
  PERFORM 1
  FROM "logistics_rule_assignments" a
  WHERE a."id" = NEW."assignment_id"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Official input-unit assignment does not exist' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "logistics_rule_assignments" a
    JOIN "logistics_rule_channels" ch
      ON ch."id" = a."channel_id"
     AND ch."tenant_id" = a."tenant_id"
     AND ch."shop_id" = a."shop_id"
     AND ch."warehouse_id" = a."warehouse_id"
    JOIN "shop_ozon_company_bindings" cb
      ON cb."id" = ch."company_binding_id"
     AND cb."tenant_id" = ch."tenant_id"
     AND cb."shop_id" = ch."shop_id"
     AND cb."ozon_company_id" = ch."ozon_company_id"
    JOIN "warehouse_ozon_origin_bindings" ob
      ON ob."id" = ch."origin_binding_id"
     AND ob."tenant_id" = ch."tenant_id"
     AND ob."shop_id" = ch."shop_id"
     AND ob."warehouse_id" = ch."warehouse_id"
     AND ob."origin_country_uid" = ch."origin_country_uid"
     AND ob."origin_city_uid" = ch."origin_city_uid"
    WHERE a."id" = NEW."assignment_id"
      AND a."channel_id" = NEW."channel_id"
      AND a."tenant_id" = NEW."tenant_id"
      AND a."shop_id" = NEW."shop_id"
      AND a."warehouse_id" = NEW."warehouse_id"
      AND a."destination_country_uid" = NEW."destination_country_uid"
      AND a."destination_location_uid" = NEW."destination_location_uid"
      AND ch."channel_type" = 'TENANT'
      AND ch."ozon_company_id" = NEW."company_id"
      AND ch."origin_country_uid" = NEW."origin_country_uid"
      AND ch."origin_city_uid" = NEW."origin_city_uid"
      AND a."retired_at" IS NULL AND ch."retired_at" IS NULL
      AND cb."status" = 'VERIFIED' AND cb."verified_at" IS NOT NULL
      AND cb."open_api_verified_at" IS NOT NULL
      AND cb."seller_probe_verified_at" IS NOT NULL
      AND cb."open_api_intersection_verified_at" IS NOT NULL
      AND cb."invalidated_at" IS NULL AND cb."retired_at" IS NULL
      AND ob."status" = 'VERIFIED' AND ob."verified_at" IS NOT NULL
      AND ob."open_api_address_verified_at" IS NOT NULL
      AND ob."official_location_verified_at" IS NOT NULL
      AND ob."invalidated_at" IS NULL AND ob."retired_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Official input-unit assignment scope is not verified'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "logistics_capture_candidates" c
    WHERE c."id" = NEW."source_candidate_id"
      AND c."task_kind" = 'OFFICIAL'
      AND c."state" = 'CAPTURED'
      AND c."review_status" = 'VERIFIED'
      AND c."tenant_id" = NEW."tenant_id"
      AND c."shop_id" = NEW."shop_id"
      AND c."company_id" = NEW."company_id"
      AND c."warehouse_id" = NEW."warehouse_id"
      AND c."origin_country_uid" = NEW."origin_country_uid"
      AND c."origin_city_uid" = NEW."origin_city_uid"
      AND c."destination_country_uid" = NEW."destination_country_uid"
      AND c."destination_location_uid" = NEW."destination_location_uid"
      AND c."response_checksum" = NEW."source_candidate_checksum"
      AND c."captured_at" >= NEW."verified_at" - INTERVAL '24 hours'
      AND c."captured_at" <= NEW."verified_at" + INTERVAL '5 minutes'
      AND c."normalized_payload"->>'schema' = 'ozon-official-logistics-capture/v1'
  ) THEN
    RAISE EXCEPTION 'Official input-unit source candidate is not verified evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."supersedes_id" IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM "logistics_official_input_unit_contracts" existing
      WHERE existing."assignment_id" = NEW."assignment_id"
    ) THEN
      RAISE EXCEPTION 'Official input-unit contract must supersede the current contract'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM "logistics_official_input_unit_contracts" previous
    WHERE previous."id" = NEW."supersedes_id"
      AND previous."assignment_id" = NEW."assignment_id"
      AND NOT EXISTS (
        SELECT 1 FROM "logistics_official_input_unit_contracts" successor
        WHERE successor."supersedes_id" = previous."id"
      )
  ) THEN
    RAISE EXCEPTION 'Official input-unit predecessor is not current'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "official_input_unit_contract_validate"
  BEFORE INSERT ON "logistics_official_input_unit_contracts"
  FOR EACH ROW EXECUTE FUNCTION "validate_official_input_unit_contract"();

CREATE FUNCTION "protect_official_input_unit_contract"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Official input-unit contract content is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF to_jsonb(NEW) - ARRAY['revoked_by_id', 'revoked_at', 'revocation_reason']
     IS DISTINCT FROM
     to_jsonb(OLD) - ARRAY['revoked_by_id', 'revoked_at', 'revocation_reason'] THEN
    RAISE EXCEPTION 'Official input-unit contract content is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."revoked_at" IS NOT NULL
    OR OLD."revoked_by_id" IS NOT NULL
    OR OLD."revocation_reason" IS NOT NULL
    OR NEW."revoked_at" IS NULL
    OR NEW."revoked_by_id" IS NULL
    OR NEW."revocation_reason" IS NULL THEN
    RAISE EXCEPTION 'Official input-unit contract revocation is final'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "official_input_unit_contract_protect"
  BEFORE UPDATE OR DELETE ON "logistics_official_input_unit_contracts"
  FOR EACH ROW EXECUTE FUNCTION "protect_official_input_unit_contract"();

CREATE OR REPLACE FUNCTION "validate_logistics_rule_event"() RETURNS trigger AS $$
DECLARE
  channel_row "logistics_rule_channels"%ROWTYPE;
  release_row "logistics_rule_releases"%ROWTYPE;
  subject_valid BOOLEAN := false;
BEGIN
  SELECT * INTO STRICT channel_row FROM "logistics_rule_channels" WHERE "id" = NEW."channel_id";
  IF NEW."tenant_id" IS DISTINCT FROM channel_row."tenant_id" THEN
    RAISE EXCEPTION 'event tenant does not match channel' USING ERRCODE = '23514';
  END IF;

  IF NEW."type" IN ('PUBLISHED', 'ROLLED_BACK') THEN
    SELECT * INTO release_row FROM "logistics_rule_releases" WHERE "id" = NEW."release_id";
    IF release_row."id" IS NULL
      OR NEW."subject_type" <> 'RELEASE'
      OR NEW."subject_id" IS DISTINCT FROM release_row."id" THEN
      RAISE EXCEPTION 'event subject is invalid' USING ERRCODE = '23514';
    END IF;
    IF (NEW."type" = 'PUBLISHED' AND release_row."release_kind" <> 'PUBLISH')
      OR (NEW."type" = 'ROLLED_BACK' AND release_row."release_kind" <> 'ROLLBACK') THEN
      RAISE EXCEPTION 'event type does not match release kind' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."release_id" IS NOT NULL THEN
    RAISE EXCEPTION 'event subject is invalid' USING ERRCODE = '23514';
  END IF;

  CASE NEW."subject_type"
    WHEN 'CHANNEL' THEN
      subject_valid := NEW."subject_id" = channel_row."id";
    WHEN 'REVISION' THEN
      SELECT EXISTS (
        SELECT 1 FROM "logistics_rule_revisions" revision
        WHERE revision."id" = NEW."subject_id"
          AND (
            (channel_row."channel_type" = 'TENANT'
              AND revision."source_owner_type" = 'TENANT'
              AND revision."source_tenant_id" = channel_row."tenant_id")
            OR
            (channel_row."channel_type" = 'PUBLIC'
              AND revision."source_owner_type" = 'PUBLIC'
              AND revision."source_tenant_id" IS NULL)
          )
      ) INTO subject_valid;
    WHEN 'METHOD_BINDING' THEN
      SELECT EXISTS (
        SELECT 1 FROM "shop_delivery_method_rule_bindings" binding
        WHERE binding."id" = NEW."subject_id"
          AND binding."tenant_id" = channel_row."tenant_id"
          AND binding."shop_id" = channel_row."shop_id"
          AND binding."warehouse_id" = channel_row."warehouse_id"
      ) INTO subject_valid;
    WHEN 'COMPANY_BINDING' THEN
      subject_valid := NEW."subject_id" = channel_row."company_binding_id";
    WHEN 'ORIGIN_BINDING' THEN
      subject_valid := NEW."subject_id" = channel_row."origin_binding_id";
    WHEN 'OFFICIAL_RESOLUTION' THEN
      SELECT EXISTS (
        SELECT 1 FROM "official_seller_formula_resolutions" resolution
        WHERE resolution."id" = NEW."subject_id"
          AND resolution."tenant_id" = channel_row."tenant_id"
          AND resolution."shop_id" = channel_row."shop_id"
          AND resolution."warehouse_id" = channel_row."warehouse_id"
      ) INTO subject_valid;
    WHEN 'OFFICIAL_INPUT_UNIT_CONTRACT' THEN
      SELECT EXISTS (
        SELECT 1 FROM "logistics_official_input_unit_contracts" contract
        WHERE contract."id" = NEW."subject_id"
          AND contract."channel_id" = channel_row."id"
          AND contract."tenant_id" = channel_row."tenant_id"
          AND contract."shop_id" = channel_row."shop_id"
          AND contract."warehouse_id" = channel_row."warehouse_id"
      ) INTO subject_valid;
    ELSE
      subject_valid := false;
  END CASE;

  IF NEW."type" = 'REVISION_CREATED' AND NEW."subject_type" <> 'REVISION' THEN
    subject_valid := false;
  ELSIF NEW."type" = 'BINDING_CHANGED'
    AND NEW."subject_type" NOT IN (
      'METHOD_BINDING', 'COMPANY_BINDING', 'ORIGIN_BINDING',
      'OFFICIAL_RESOLUTION', 'OFFICIAL_INPUT_UNIT_CONTRACT'
    ) THEN
    subject_valid := false;
  ELSIF NEW."type" = 'INVALIDATED'
    AND NEW."subject_type" NOT IN (
      'CHANNEL', 'REVISION', 'METHOD_BINDING', 'COMPANY_BINDING',
      'ORIGIN_BINDING', 'OFFICIAL_RESOLUTION', 'OFFICIAL_INPUT_UNIT_CONTRACT'
    ) THEN
    subject_valid := false;
  END IF;

  IF NOT subject_valid THEN
    RAISE EXCEPTION 'event subject is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "require_official_input_unit_contract_event"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM "logistics_rule_events" event
    WHERE event."subject_type" = 'OFFICIAL_INPUT_UNIT_CONTRACT'
      AND event."subject_id" = NEW."id"
      AND event."type" = 'BINDING_CHANGED'
      AND event."actor_user_id" = NEW."reviewer_id"
  ) THEN
    RAISE EXCEPTION 'Official input-unit verification event is required'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "logistics_rule_events" event
      WHERE event."subject_type" = 'OFFICIAL_INPUT_UNIT_CONTRACT'
        AND event."subject_id" = NEW."id"
        AND event."type" = 'INVALIDATED'
        AND event."actor_user_id" = NEW."revoked_by_id"
    ) THEN
    RAISE EXCEPTION 'Official input-unit revocation event is required'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "official_input_unit_contract_event_required"
  AFTER INSERT OR UPDATE ON "logistics_official_input_unit_contracts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_official_input_unit_contract_event"();
COMMIT;
