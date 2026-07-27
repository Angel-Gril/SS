BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

CREATE TABLE "extension_hosted_ai_image_plan_bindings" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "device_session_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "listing_workflow_id" TEXT NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "supply_goods_id" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "selected_sku_hash" CHAR(64) NOT NULL,
  "candidate_media_hash" CHAR(64) NOT NULL,
  "authority_hash" CHAR(64) NOT NULL,
  "binding_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "extension_hosted_ai_image_plan_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "extension_hosted_ai_plan_binding_positive_revision_check"
    CHECK ("draft_revision" > 0 AND "draft_version" > 0),
  CONSTRAINT "extension_hosted_ai_plan_binding_selected_sku_hash_check"
    CHECK ("selected_sku_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "extension_hosted_ai_plan_binding_candidate_media_hash_check"
    CHECK ("candidate_media_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "extension_hosted_ai_plan_binding_authority_hash_check"
    CHECK ("authority_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "extension_hosted_ai_plan_binding_hash_check"
    CHECK ("binding_hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "extension_hosted_ai_plan_binding_plan_owner_key"
  ON "extension_hosted_ai_image_plan_bindings"("plan_id", "owner_user_id");

CREATE UNIQUE INDEX "extension_hosted_ai_plan_binding_owner_authority_key"
  ON "extension_hosted_ai_image_plan_bindings"("owner_user_id", "authority_hash");

CREATE UNIQUE INDEX "extension_hosted_ai_plan_binding_owner_hash_key"
  ON "extension_hosted_ai_image_plan_bindings"("owner_user_id", "binding_hash");

CREATE INDEX "extension_hosted_ai_plan_binding_context_idx"
  ON "extension_hosted_ai_image_plan_bindings"(
    "owner_user_id", "device_session_id", "listing_workflow_id", "draft_revision", "draft_version"
  );

CREATE INDEX "extension_hosted_ai_plan_binding_draft_idx"
  ON "extension_hosted_ai_image_plan_bindings"(
    "listing_workflow_id", "draft_revision", "draft_version"
  );

ALTER TABLE "extension_hosted_ai_image_plan_bindings"
  ADD CONSTRAINT "extension_hosted_ai_plan_binding_plan_owner_fkey"
  FOREIGN KEY ("plan_id", "owner_user_id")
  REFERENCES "ai_media_plans"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_plan_bindings"
  ADD CONSTRAINT "extension_hosted_ai_plan_binding_listing_owner_fkey"
  FOREIGN KEY ("listing_workflow_id", "owner_user_id")
  REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "extension_ai_image_execution_mode_locks" (
  "owner_user_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "listing_workflow_id" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "execution_mode" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "extension_ai_image_execution_mode_locks_pkey"
    PRIMARY KEY (
      "owner_user_id", "listing_workflow_id", "draft_revision", "draft_version"
    ),
  CONSTRAINT "extension_ai_image_execution_mode_lock_revision_check"
    CHECK ("draft_revision" > 0 AND "draft_version" > 0),
  CONSTRAINT "extension_ai_image_execution_mode_lock_mode_check"
    CHECK ("execution_mode" IN ('ERP_HOSTED', 'BYOK'))
);

CREATE INDEX "extension_ai_image_execution_mode_lock_shop_idx"
  ON "extension_ai_image_execution_mode_locks"("shop_id", "created_at");

ALTER TABLE "extension_ai_image_execution_mode_locks"
  ADD CONSTRAINT "extension_ai_image_execution_mode_lock_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_ai_image_execution_mode_locks"
  ADD CONSTRAINT "extension_ai_image_execution_mode_lock_shop_owner_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_ai_image_execution_mode_locks"
  ADD CONSTRAINT "extension_ai_image_execution_mode_lock_draft_fkey"
  FOREIGN KEY (
    "listing_workflow_id", "draft_revision", "owner_user_id", "draft_version"
  ) REFERENCES "source_listing_draft_versions"(
    "workflow_id", "revision", "owner_user_id", "draft_version"
  ) ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "extension_hosted_ai_image_listing_assignments" (
  "assignment_id" VARCHAR(100) NOT NULL,
  "contract_version" VARCHAR(100) NOT NULL,
  "execution_mode" VARCHAR(20) NOT NULL DEFAULT 'ERP_HOSTED',
  "batch_id" VARCHAR(100) NOT NULL,
  "batch_item_ordinal" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "authority_hash" CHAR(64) NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "device_session_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "listing_workflow_id" TEXT NOT NULL,
  "source_draft_revision" INTEGER NOT NULL,
  "source_draft_version" INTEGER NOT NULL,
  "bound_draft_revision" INTEGER NOT NULL,
  "bound_draft_version" INTEGER NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "assignment_scope" VARCHAR(20) NOT NULL,
  "sku_key" VARCHAR(500) NOT NULL,
  "slot_key" VARCHAR(1024) NOT NULL,
  "assignment_ordinal" INTEGER NOT NULL,
  "asset_id" TEXT NOT NULL,
  "asset_sha256" CHAR(64) NOT NULL,
  "assignment_sha256" CHAR(64) NOT NULL,
  "plan_id" TEXT NOT NULL,
  "plan_version_id" TEXT NOT NULL,
  "plan_revision" INTEGER NOT NULL,
  "suite_id" TEXT NOT NULL,
  "suite_slot_id" TEXT NOT NULL,
  "child_workflow_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "reservation_id" TEXT NOT NULL,
  "settlement_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "extension_hosted_ai_image_listing_assignments_pkey"
    PRIMARY KEY ("assignment_id"),
  CONSTRAINT "extension_hosted_listing_assignment_contract_check"
    CHECK ("contract_version" = 'hosted-suite-listing-draft-assignment/v2'),
  CONSTRAINT "extension_hosted_listing_assignment_mode_check"
    CHECK ("execution_mode" = 'ERP_HOSTED'),
  CONSTRAINT "extension_hosted_listing_assignment_scope_check"
    CHECK ("assignment_scope" IN ('SKU', 'PRODUCT')),
  CONSTRAINT "extension_hosted_listing_assignment_revision_check"
    CHECK (
      "source_draft_revision" > 0
      AND "source_draft_version" > 0
      AND "bound_draft_revision" = "source_draft_revision" + 1
      AND "bound_draft_version" = "source_draft_version" + 1
      AND "plan_revision" > 0
      AND "batch_item_ordinal" >= 0
      AND "assignment_ordinal" >= 0
    ),
  CONSTRAINT "extension_hosted_listing_assignment_hash_check"
    CHECK (
      "request_hash" ~ '^[a-f0-9]{64}$'
      AND "authority_hash" ~ '^[a-f0-9]{64}$'
      AND "asset_sha256" ~ '^[a-f0-9]{64}$'
      AND "assignment_sha256" ~ '^[a-f0-9]{64}$'
    )
);

CREATE UNIQUE INDEX "extension_hosted_listing_assignment_owner_idempotency_item_key"
  ON "extension_hosted_ai_image_listing_assignments"(
    "owner_user_id", "idempotency_key", "batch_item_ordinal"
  );

CREATE UNIQUE INDEX "extension_hosted_listing_assignment_owner_batch_item_key"
  ON "extension_hosted_ai_image_listing_assignments"(
    "owner_user_id", "batch_id", "batch_item_ordinal"
  );

CREATE UNIQUE INDEX "extension_hosted_listing_assignment_asset_owner_key"
  ON "extension_hosted_ai_image_listing_assignments"("asset_id", "owner_user_id");

CREATE UNIQUE INDEX "extension_hosted_listing_assignment_job_owner_key"
  ON "extension_hosted_ai_image_listing_assignments"("job_id", "owner_user_id");

CREATE UNIQUE INDEX "extension_hosted_listing_assignment_bound_revision_ordinal_key"
  ON "extension_hosted_ai_image_listing_assignments"(
    "listing_workflow_id", "bound_draft_revision", "assignment_ordinal"
  );

CREATE INDEX "extension_hosted_listing_assignment_device_idx"
  ON "extension_hosted_ai_image_listing_assignments"(
    "owner_user_id", "device_session_id", "created_at"
  );

CREATE INDEX "extension_hosted_listing_assignment_batch_idx"
  ON "extension_hosted_ai_image_listing_assignments"("owner_user_id", "batch_id");

CREATE INDEX "extension_hosted_listing_assignment_source_draft_idx"
  ON "extension_hosted_ai_image_listing_assignments"(
    "listing_workflow_id", "source_draft_revision", "source_draft_version"
  );

CREATE INDEX "extension_hosted_listing_assignment_suite_idx"
  ON "extension_hosted_ai_image_listing_assignments"(
    "plan_id", "suite_id", "suite_slot_id"
  );

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_device_owner_fkey"
  FOREIGN KEY ("device_session_id", "owner_user_id")
  REFERENCES "extension_device_sessions"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_shop_owner_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_workflow_owner_fkey"
  FOREIGN KEY ("listing_workflow_id", "owner_user_id")
  REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_source_draft_fkey"
  FOREIGN KEY (
    "listing_workflow_id", "source_draft_revision", "owner_user_id", "source_draft_version"
  ) REFERENCES "source_listing_draft_versions"(
    "workflow_id", "revision", "owner_user_id", "draft_version"
  ) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_bound_draft_fkey"
  FOREIGN KEY (
    "listing_workflow_id", "bound_draft_revision", "owner_user_id", "bound_draft_version"
  ) REFERENCES "source_listing_draft_versions"(
    "workflow_id", "revision", "owner_user_id", "draft_version"
  ) ON DELETE RESTRICT ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_asset_owner_fkey"
  FOREIGN KEY ("asset_id", "owner_user_id") REFERENCES "media_assets"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_plan_owner_fkey"
  FOREIGN KEY ("plan_id", "owner_user_id") REFERENCES "ai_media_plans"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_plan_version_fkey"
  FOREIGN KEY ("plan_version_id", "plan_id", "owner_user_id")
  REFERENCES "ai_media_plan_versions"("id", "plan_id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_suite_owner_fkey"
  FOREIGN KEY ("suite_id", "owner_user_id") REFERENCES "ai_media_suites"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_suite_slot_fkey"
  FOREIGN KEY ("suite_slot_id", "suite_id", "owner_user_id")
  REFERENCES "ai_media_suite_slots"("id", "suite_id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_child_workflow_fkey"
  FOREIGN KEY ("child_workflow_id", "owner_user_id")
  REFERENCES "ai_media_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_job_owner_fkey"
  FOREIGN KEY ("job_id", "owner_user_id") REFERENCES "ai_image_jobs"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_reservation_owner_fkey"
  FOREIGN KEY ("reservation_id", "owner_user_id")
  REFERENCES "ai_cost_reservations"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "extension_hosted_ai_image_listing_assignments"
  ADD CONSTRAINT "extension_hosted_listing_assignment_settlement_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "ai_cost_settlements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION require_ai_media_suite_execution_graph_from_job() RETURNS trigger AS $$
DECLARE
  bound_slot RECORD;
  hosted_assignment_count INTEGER;
BEGIN
  SELECT "suite_id", "owner_user_id" INTO bound_slot
  FROM "ai_media_suite_slots"
  WHERE "child_workflow_id" = NEW."workflow_id"
    AND "owner_user_id" = NEW."owner_user_id";

  IF bound_slot."suite_id" IS NOT NULL THEN
    IF TG_OP = 'UPDATE'
      AND OLD."applied_at" IS NULL
      AND NEW."applied_at" IS NOT NULL
      AND NEW."applied_mode" = 'append'
      AND NEW."apply_target_type" = 'listing-draft'
      AND COALESCE(NEW."apply_target_id", '') <> ''
      AND (
        to_jsonb(NEW) - ARRAY[
          'applied_mode', 'apply_target_type', 'apply_target_id', 'applied_at', 'updated_at'
        ]::TEXT[]
      ) = (
        to_jsonb(OLD) - ARRAY[
          'applied_mode', 'apply_target_type', 'apply_target_id', 'applied_at', 'updated_at'
        ]::TEXT[]
      )
    THEN
      SELECT count(*)::INTEGER INTO hosted_assignment_count
      FROM "extension_hosted_ai_image_listing_assignments" assignment
      WHERE assignment."job_id" = NEW."id"
        AND assignment."owner_user_id" = NEW."owner_user_id"
        AND assignment."actor_user_id" IS NOT DISTINCT FROM NEW."actor_user_id"
        AND assignment."child_workflow_id" = NEW."workflow_id"
        AND assignment."suite_id" = bound_slot."suite_id"
        AND assignment."listing_workflow_id" = NEW."apply_target_id"
        AND assignment."execution_mode" = 'ERP_HOSTED'
        AND assignment."created_at" = NEW."applied_at";
      IF hosted_assignment_count = 1 THEN
        RETURN NULL;
      END IF;
    END IF;

    PERFORM assert_ai_media_suite_execution_graph(
      bound_slot."suite_id",
      bound_slot."owner_user_id"
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION claim_extension_ai_image_execution_mode(
  requested_owner_user_id TEXT,
  requested_shop_id TEXT,
  requested_listing_workflow_id TEXT,
  requested_draft_revision INTEGER,
  requested_draft_version INTEGER,
  requested_execution_mode TEXT
) RETURNS void AS $$
DECLARE
  stored_execution_mode TEXT;
  stored_shop_id TEXT;
BEGIN
  IF requested_execution_mode NOT IN ('ERP_HOSTED', 'BYOK') THEN
    RAISE EXCEPTION 'Extension AI image execution mode is invalid'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_ai_image_execution_mode_lock_mode_check';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array(
      'extension-ai-image-execution-mode/v1',
      requested_owner_user_id,
      requested_listing_workflow_id,
      requested_draft_revision,
      requested_draft_version
    )::TEXT,
    73190427
  ));

  INSERT INTO "extension_ai_image_execution_mode_locks" (
    "owner_user_id", "shop_id", "listing_workflow_id", "draft_revision",
    "draft_version", "execution_mode"
  ) VALUES (
    requested_owner_user_id, requested_shop_id, requested_listing_workflow_id,
    requested_draft_revision, requested_draft_version, requested_execution_mode
  )
  ON CONFLICT (
    "owner_user_id", "listing_workflow_id", "draft_revision", "draft_version"
  ) DO UPDATE SET "execution_mode" =
    "extension_ai_image_execution_mode_locks"."execution_mode"
  RETURNING "execution_mode", "shop_id" INTO stored_execution_mode, stored_shop_id;

  IF stored_execution_mode IS DISTINCT FROM requested_execution_mode
    OR stored_shop_id IS DISTINCT FROM requested_shop_id
  THEN
    RAISE EXCEPTION 'Extension AI image execution mode is already locked to %',
      stored_execution_mode
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_ai_image_execution_mode_exclusive';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_extension_hosted_ai_image_suite_mode() RETURNS trigger AS $$
DECLARE
  hosted_binding RECORD;
BEGIN
  SELECT binding."shop_id", binding."listing_workflow_id", binding."draft_revision",
         binding."draft_version"
    INTO hosted_binding
  FROM "extension_hosted_ai_image_plan_bindings" binding
  WHERE binding."plan_id" = NEW."plan_id"
    AND binding."owner_user_id" = NEW."owner_user_id";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM claim_extension_ai_image_execution_mode(
    NEW."owner_user_id",
    hosted_binding."shop_id",
    hosted_binding."listing_workflow_id",
    hosted_binding."draft_revision",
    hosted_binding."draft_version",
    'ERP_HOSTED'
  );

  IF EXISTS (
    SELECT 1
    FROM "extension_byok_media_provenance" provenance
    WHERE provenance."owner_user_id" = NEW."owner_user_id"
      AND provenance."shop_id" = hosted_binding."shop_id"
      AND provenance."workflow_id" = hosted_binding."listing_workflow_id"
      AND provenance."draft_revision" = hosted_binding."draft_revision"
      AND provenance."draft_version" = hosted_binding."draft_version"
  ) THEN
    RAISE EXCEPTION 'BYOK media already owns this listing draft execution mode'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_ai_image_execution_mode_exclusive';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_extension_mode_lock"
BEFORE INSERT ON "ai_media_suites"
FOR EACH ROW EXECUTE FUNCTION lock_extension_hosted_ai_image_suite_mode();

CREATE OR REPLACE FUNCTION lock_extension_byok_ai_image_mode() RETURNS trigger AS $$
BEGIN
  PERFORM claim_extension_ai_image_execution_mode(
    NEW."owner_user_id",
    NEW."shop_id",
    NEW."workflow_id",
    NEW."draft_revision",
    NEW."draft_version",
    'BYOK'
  );

  IF EXISTS (
    SELECT 1
    FROM "extension_hosted_ai_image_plan_bindings" binding
    JOIN "ai_media_suites" suite
      ON suite."plan_id" = binding."plan_id"
     AND suite."owner_user_id" = binding."owner_user_id"
    WHERE binding."owner_user_id" = NEW."owner_user_id"
      AND binding."shop_id" = NEW."shop_id"
      AND binding."listing_workflow_id" = NEW."workflow_id"
      AND binding."draft_revision" = NEW."draft_revision"
      AND binding."draft_version" = NEW."draft_version"
  ) THEN
    RAISE EXCEPTION 'ERP-hosted suite already owns this listing draft execution mode'
      USING ERRCODE = '23514',
            CONSTRAINT = 'extension_ai_image_execution_mode_exclusive';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "extension_byok_media_provenance_mode_lock"
BEFORE INSERT ON "extension_byok_media_provenance"
FOR EACH ROW EXECUTE FUNCTION lock_extension_byok_ai_image_mode();

COMMIT;
