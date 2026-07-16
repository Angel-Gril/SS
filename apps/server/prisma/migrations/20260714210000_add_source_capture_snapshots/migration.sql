BEGIN;

CREATE TYPE "SourceCaptureIngestChannel" AS ENUM (
  'EXTENSION_DEVICE',
  'WEB_ACCOUNT',
  'LEGACY_ADAPTER'
);

CREATE TABLE "source_capture_subjects" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "source_platform" TEXT NOT NULL,
  "source_product_id" TEXT NOT NULL,
  "legacy_supply_goods_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_capture_subjects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_capture_subject_identity_check" CHECK (
    "source_platform" = lower(btrim("source_platform"))
    AND length("source_platform") BETWEEN 1 AND 40
    AND "source_product_id" = btrim("source_product_id")
    AND length("source_product_id") BETWEEN 1 AND 200
  )
);

CREATE TABLE "source_capture_snapshots" (
  "id" TEXT NOT NULL,
  "subject_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "schema_version" TEXT NOT NULL,
  "capture_hash" TEXT NOT NULL,
  "payload_bytes" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "stage_counts" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "provenance_complete" BOOLEAN NOT NULL,
  "parser_version" TEXT NOT NULL,
  "extension_version" TEXT,
  "completeness" JSONB NOT NULL,
  "truncations" JSONB NOT NULL,
  "has_estimated_values" BOOLEAN NOT NULL,
  "profile_json" JSONB NOT NULL,
  "profile_hash" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "device_session_id" TEXT,
  "ingest_channel" "SourceCaptureIngestChannel" NOT NULL,
  "rollout_revision" TEXT NOT NULL,
  "rollout_stage" TEXT NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "source_capture_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "source_capture_snapshot_version_check" CHECK ("version" > 0),
  CONSTRAINT "source_capture_snapshot_schema_version_check" CHECK (
    "schema_version" = btrim("schema_version")
    AND length("schema_version") BETWEEN 1 AND 100
  ),
  CONSTRAINT "source_capture_snapshot_hash_check" CHECK (
    "capture_hash" ~ '^[0-9a-f]{64}$'
    AND "profile_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "source_capture_snapshot_payload_bytes_check" CHECK (
    "payload_bytes" BETWEEN 1 AND 8388608
    AND octet_length("payload"::text) <= 10485760
  ),
  CONSTRAINT "source_capture_snapshot_parser_version_check" CHECK (
    "parser_version" = btrim("parser_version")
    AND length("parser_version") BETWEEN 1 AND 120
    AND (
      "extension_version" IS NULL
      OR (
        "extension_version" = btrim("extension_version")
        AND length("extension_version") BETWEEN 1 AND 40
      )
    )
  ),
  CONSTRAINT "source_capture_snapshot_json_shape_check" CHECK (
    jsonb_typeof("payload") = 'object'
    AND jsonb_typeof("stage_counts") = 'object'
    AND jsonb_typeof("provenance") = 'object'
    AND jsonb_typeof("completeness") = 'object'
    AND jsonb_typeof("truncations") = 'array'
    AND jsonb_typeof("profile_json") = 'object'
  ),
  CONSTRAINT "source_capture_snapshot_rollout_revision_check" CHECK (
    "rollout_revision" = btrim("rollout_revision")
    AND length("rollout_revision") BETWEEN 1 AND 200
  ),
  CONSTRAINT "source_capture_snapshot_rollout_stage_check" CHECK (
    "rollout_stage" IN ('shadow_write', 'dual_read', 'v2_only')
  ),
  CONSTRAINT "source_capture_snapshot_channel_check" CHECK (
    ("ingest_channel" = 'EXTENSION_DEVICE' AND "device_session_id" IS NOT NULL)
    OR ("ingest_channel" <> 'EXTENSION_DEVICE' AND "device_session_id" IS NULL)
  ),
  CONSTRAINT "source_capture_snapshot_legacy_provenance_check" CHECK (
    "ingest_channel" <> 'LEGACY_ADAPTER' OR "provenance_complete" = FALSE
  )
);

CREATE UNIQUE INDEX "source_capture_subject_identity_key"
  ON "source_capture_subjects"("owner_user_id", "source_platform", "source_product_id");
CREATE UNIQUE INDEX "source_capture_subject_legacy_projection_key"
  ON "source_capture_subjects"("legacy_supply_goods_id");
CREATE INDEX "source_capture_subjects_owner_user_id_updated_at_idx"
  ON "source_capture_subjects"("owner_user_id", "updated_at");

CREATE UNIQUE INDEX "source_capture_snapshot_subject_version_key"
  ON "source_capture_snapshots"("subject_id", "version");
CREATE UNIQUE INDEX "source_capture_snapshot_subject_hash_key"
  ON "source_capture_snapshots"("subject_id", "capture_hash");
CREATE INDEX "source_capture_snapshots_subject_id_captured_at_idx"
  ON "source_capture_snapshots"("subject_id", "captured_at");
CREATE INDEX "source_capture_snapshots_actor_user_id_created_at_idx"
  ON "source_capture_snapshots"("actor_user_id", "created_at");
CREATE INDEX "source_capture_snapshots_device_session_id_created_at_idx"
  ON "source_capture_snapshots"("device_session_id", "created_at");

ALTER TABLE "source_capture_subjects"
  ADD CONSTRAINT "source_capture_subjects_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_capture_subjects"
  ADD CONSTRAINT "source_capture_subjects_legacy_supply_goods_id_fkey"
  FOREIGN KEY ("legacy_supply_goods_id") REFERENCES "supply_goods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "source_capture_snapshots"
  ADD CONSTRAINT "source_capture_snapshots_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "source_capture_subjects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_capture_snapshots"
  ADD CONSTRAINT "source_capture_snapshots_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "source_capture_snapshots"
  ADD CONSTRAINT "source_capture_snapshots_device_session_id_fkey"
  FOREIGN KEY ("device_session_id") REFERENCES "extension_device_sessions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_source_capture_snapshot_identity()
RETURNS trigger AS $$
DECLARE
  subject_owner_id TEXT;
  session_owner_id TEXT;
  session_actor_id TEXT;
BEGIN
  SELECT "owner_user_id" INTO subject_owner_id
  FROM "source_capture_subjects"
  WHERE "id" = NEW."subject_id"
  FOR KEY SHARE;

  IF subject_owner_id IS NULL OR subject_owner_id <> NEW."actor_user_id" THEN
    RAISE EXCEPTION 'source capture actor must own the subject';
  END IF;

  IF NEW."device_session_id" IS NOT NULL THEN
    SELECT "owner_user_id", "actor_user_id"
      INTO session_owner_id, session_actor_id
    FROM "extension_device_sessions"
    WHERE "id" = NEW."device_session_id"
    FOR KEY SHARE;

    IF session_owner_id IS NULL
      OR session_owner_id <> subject_owner_id
      OR session_actor_id <> NEW."actor_user_id" THEN
      RAISE EXCEPTION 'source capture device session identity mismatch';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_source_capture_snapshot_rewrite()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source capture snapshots are immutable';
  END IF;
  RAISE EXCEPTION 'source capture snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_source_capture_subject_identity_rewrite()
RETURNS trigger AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."source_platform" IS DISTINCT FROM OLD."source_platform"
    OR NEW."source_product_id" IS DISTINCT FROM OLD."source_product_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'source capture subject identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "source_capture_snapshots_validate_identity"
BEFORE INSERT ON "source_capture_snapshots"
FOR EACH ROW EXECUTE FUNCTION validate_source_capture_snapshot_identity();

CREATE TRIGGER "source_capture_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "source_capture_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_source_capture_snapshot_rewrite();

CREATE TRIGGER "source_capture_subjects_identity_immutable"
BEFORE UPDATE ON "source_capture_subjects"
FOR EACH ROW EXECUTE FUNCTION prevent_source_capture_subject_identity_rewrite();

COMMIT;
