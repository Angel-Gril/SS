BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Composite keys make the tenant and parent identity part of every Prompt FK.
CREATE UNIQUE INDEX "ai_prompt_revision_id_template_key"
  ON "ai_prompt_revisions"("id", "template_key");
CREATE UNIQUE INDEX "ai_prompt_release_id_template_key"
  ON "ai_prompt_releases"("id", "template_key");
CREATE UNIQUE INDEX "ai_media_suite_slot_id_suite_owner_key"
  ON "ai_media_suite_slots"("id", "suite_id", "owner_user_id");

CREATE TABLE "ai_media_suite_prompt_sets" (
  "id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "prompt_set_version" VARCHAR(100) NOT NULL,
  "operation_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "plan_id" TEXT NOT NULL,
  "plan_version_id" TEXT NOT NULL,
  "source_subject_id" TEXT NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "source_capture_hash" CHAR(64) NOT NULL,
  "source_profile_hash" CHAR(64) NOT NULL,
  "source_schema_version" VARCHAR(100) NOT NULL,
  "template_key" TEXT NOT NULL,
  "template_release_id" TEXT NOT NULL,
  "template_revision_id" TEXT NOT NULL,
  "template_sequence" INTEGER NOT NULL,
  "template_checksum" CHAR(64) NOT NULL,
  "template_snapshot_json" JSONB NOT NULL,
  "template_snapshot_hash" CHAR(64) NOT NULL,
  "compiler_version" VARCHAR(100) NOT NULL,
  "policy_version" VARCHAR(100) NOT NULL,
  "policy_hash" CHAR(64) NOT NULL,
  "plan_hash" CHAR(64) NOT NULL,
  "provider" VARCHAR(100) NOT NULL,
  "model" VARCHAR(200) NOT NULL,
  "provider_config_hash" CHAR(64) NOT NULL,
  "reference_set_hash" CHAR(64) NOT NULL,
  "slot_count" INTEGER NOT NULL,
  "prompt_set_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_suite_prompt_sets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_suite_prompt_set_values_check" CHECK (
    char_length("operation_key") BETWEEN 8 AND 128
    AND char_length("prompt_set_version") BETWEEN 1 AND 100
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND "source_capture_hash" ~ '^[0-9a-f]{64}$'
    AND "source_profile_hash" ~ '^[0-9a-f]{64}$'
    AND "template_sequence" >= 1
    AND "template_checksum" ~ '^[0-9a-f]{64}$'
    AND "template_snapshot_hash" ~ '^[0-9a-f]{64}$'
    AND "policy_hash" ~ '^[0-9a-f]{64}$'
    AND "plan_hash" ~ '^[0-9a-f]{64}$'
    AND "provider_config_hash" ~ '^[0-9a-f]{64}$'
    AND "reference_set_hash" ~ '^[0-9a-f]{64}$'
    AND "slot_count" BETWEEN 1 AND 500
    AND "prompt_set_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "ai_media_suite_prompt_set_id_owner_key"
  ON "ai_media_suite_prompt_sets"("id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_suite_prompt_set_id_suite_owner_key"
  ON "ai_media_suite_prompt_sets"("id", "suite_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_suite_prompt_set_suite_key"
  ON "ai_media_suite_prompt_sets"("suite_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_suite_prompt_set_owner_operation_key"
  ON "ai_media_suite_prompt_sets"("owner_user_id", "operation_key");
CREATE INDEX "ai_media_suite_prompt_set_owner_created_idx"
  ON "ai_media_suite_prompt_sets"("owner_user_id", "created_at");

ALTER TABLE "ai_media_suite_prompt_sets"
  ADD CONSTRAINT "ai_media_suite_prompt_set_owner_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_prompt_set_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_prompt_set_suite_fkey"
    FOREIGN KEY ("suite_id", "owner_user_id")
    REFERENCES "ai_media_suites"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_prompt_set_release_fkey"
    FOREIGN KEY ("template_release_id", "template_key")
    REFERENCES "ai_prompt_releases"("id", "template_key") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_prompt_set_revision_fkey"
    FOREIGN KEY ("template_revision_id", "template_key")
    REFERENCES "ai_prompt_revisions"("id", "template_key") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ai_media_suite_slot_prompts" (
  "id" TEXT NOT NULL,
  "prompt_set_id" TEXT NOT NULL,
  "suite_id" TEXT NOT NULL,
  "slot_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "version" VARCHAR(100) NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "slot_key" VARCHAR(1024) NOT NULL,
  "slot_hash" CHAR(64) NOT NULL,
  "references_hash" CHAR(64) NOT NULL,
  "reference_set_hash" CHAR(64) NOT NULL,
  "template_key" TEXT NOT NULL,
  "template_release_id" TEXT NOT NULL,
  "template_revision_id" TEXT NOT NULL,
  "template_sequence" INTEGER NOT NULL,
  "template_checksum" CHAR(64) NOT NULL,
  "template_snapshot_json" JSONB NOT NULL,
  "template_snapshot_hash" CHAR(64) NOT NULL,
  "variables_snapshot_json" JSONB NOT NULL,
  "variables_hash" CHAR(64) NOT NULL,
  "resolved_prompt" TEXT NOT NULL,
  "resolved_negative_prompt" TEXT NOT NULL,
  "compiled_prompt_hash" CHAR(64) NOT NULL,
  "compiler_version" VARCHAR(100) NOT NULL,
  "policy_version" VARCHAR(100) NOT NULL,
  "policy_hash" CHAR(64) NOT NULL,
  "resolved_prompt_hash" CHAR(64) NOT NULL,
  "resolved_negative_prompt_hash" CHAR(64) NOT NULL,
  "binding_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_media_suite_slot_prompt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_media_suite_slot_prompt_values_check" CHECK (
    "ordinal" >= 0
    AND char_length("slot_key") BETWEEN 1 AND 1024
    AND char_length("version") BETWEEN 1 AND 100
    AND "slot_hash" ~ '^[0-9a-f]{64}$'
    AND "references_hash" ~ '^[0-9a-f]{64}$'
    AND "reference_set_hash" ~ '^[0-9a-f]{64}$'
    AND "template_sequence" >= 1
    AND "template_checksum" ~ '^[0-9a-f]{64}$'
    AND "template_snapshot_hash" ~ '^[0-9a-f]{64}$'
    AND "variables_hash" ~ '^[0-9a-f]{64}$'
    AND "policy_hash" ~ '^[0-9a-f]{64}$'
    AND "resolved_prompt_hash" ~ '^[0-9a-f]{64}$'
    AND "resolved_negative_prompt_hash" ~ '^[0-9a-f]{64}$'
    AND "compiled_prompt_hash" ~ '^[0-9a-f]{64}$'
    AND "binding_hash" ~ '^[0-9a-f]{64}$'
    AND char_length("resolved_prompt") > 0
    AND char_length("resolved_negative_prompt") > 0
  )
);

CREATE UNIQUE INDEX "ai_media_suite_slot_prompt_id_owner_key"
  ON "ai_media_suite_slot_prompts"("id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_suite_slot_prompt_suite_slot_key"
  ON "ai_media_suite_slot_prompts"("slot_id", "suite_id", "owner_user_id");
CREATE UNIQUE INDEX "ai_media_suite_slot_prompt_set_ordinal_key"
  ON "ai_media_suite_slot_prompts"("prompt_set_id", "ordinal");
CREATE INDEX "ai_media_suite_slot_prompt_owner_created_idx"
  ON "ai_media_suite_slot_prompts"("owner_user_id", "created_at");

ALTER TABLE "ai_media_suite_slot_prompts"
  ADD CONSTRAINT "ai_media_suite_slot_prompt_set_fkey"
    FOREIGN KEY ("prompt_set_id", "suite_id", "owner_user_id")
    REFERENCES "ai_media_suite_prompt_sets"("id", "suite_id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_slot_prompt_suite_fkey"
    FOREIGN KEY ("suite_id", "owner_user_id")
    REFERENCES "ai_media_suites"("id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_slot_prompt_slot_fkey"
    FOREIGN KEY ("slot_id", "suite_id", "owner_user_id")
    REFERENCES "ai_media_suite_slots"("id", "suite_id", "owner_user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_slot_prompt_release_fkey"
    FOREIGN KEY ("template_release_id", "template_key")
    REFERENCES "ai_prompt_releases"("id", "template_key") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_media_suite_slot_prompt_revision_fkey"
    FOREIGN KEY ("template_revision_id", "template_key")
    REFERENCES "ai_prompt_revisions"("id", "template_key") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_ai_media_suite_prompt_set_insert() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  stored_plan_version "ai_media_plan_versions"%ROWTYPE;
  reference_event "ai_media_suite_events"%ROWTYPE;
  stored_release "ai_prompt_releases"%ROWTYPE;
  stored_revision "ai_prompt_revisions"%ROWTYPE;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  SELECT * INTO reference_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = NEW."suite_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "revision" = 2
    AND "event_type" = 'REFERENCES_INTERNALIZED';

  SELECT * INTO stored_plan_version
  FROM "ai_media_plan_versions"
  WHERE "id" = NEW."plan_version_id"
    AND "plan_id" = NEW."plan_id"
    AND "owner_user_id" = NEW."owner_user_id";

  SELECT * INTO stored_release
  FROM "ai_prompt_releases"
  WHERE "id" = NEW."template_release_id"
    AND "template_key" = NEW."template_key";
  SELECT * INTO stored_revision
  FROM "ai_prompt_revisions"
  WHERE "id" = NEW."template_revision_id"
    AND "template_key" = NEW."template_key";

  IF stored_suite."id" IS NULL
    OR stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR stored_suite."revision" IS DISTINCT FROM 3
    OR reference_event."id" IS NULL
    OR reference_event."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-references-internalized/v1'
    OR reference_event."payload"->>'referenceSetHash' IS DISTINCT FROM NEW."reference_set_hash"
    OR NEW."slot_count" IS DISTINCT FROM stored_suite."item_count"
    OR NEW."plan_id" IS DISTINCT FROM stored_suite."plan_id"
    OR NEW."plan_version_id" IS DISTINCT FROM stored_suite."plan_version_id"
    OR NEW."source_subject_id" IS DISTINCT FROM stored_suite."source_subject_id"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
    OR NEW."source_capture_hash" IS DISTINCT FROM stored_suite."source_capture_hash"
    OR NEW."source_profile_hash" IS DISTINCT FROM stored_suite."source_profile_hash"
    OR NEW."source_schema_version" IS DISTINCT FROM stored_suite."source_schema_version"
    OR stored_plan_version."id" IS NULL
    OR stored_plan_version."plan_hash" IS DISTINCT FROM NEW."plan_hash"
    OR NEW."prompt_set_version" IS DISTINCT FROM 'ai-image-suite-prompt-set/v1'
    OR NEW."compiler_version" IS DISTINCT FROM 'ai-image-suite-prompt-compiler/v1'
    OR NEW."policy_version" IS DISTINCT FROM 'ozon-image-slot-policy/v1'
    OR NEW."template_key" IS DISTINCT FROM 'image-suite-generation.base'
    OR stored_release."id" IS NULL
    OR stored_revision."id" IS NULL
    OR stored_release."revision_id" IS DISTINCT FROM NEW."template_revision_id"
    OR stored_release."sequence" IS DISTINCT FROM NEW."template_sequence"
    OR stored_revision."checksum" IS DISTINCT FROM NEW."template_checksum"
    OR stored_revision."status" IS DISTINCT FROM 'PUBLISHED'
    OR jsonb_typeof(NEW."template_snapshot_json") IS DISTINCT FROM 'object'
    OR NEW."template_snapshot_json"->>'templateKey' IS DISTINCT FROM NEW."template_key"
    OR NEW."template_snapshot_json"->>'releaseId' IS DISTINCT FROM NEW."template_release_id"
    OR NEW."template_snapshot_json"->>'revisionId' IS DISTINCT FROM NEW."template_revision_id"
    OR COALESCE(NEW."template_snapshot_json"->>'sequence', '') !~ '^[0-9]+$'
    OR (NEW."template_snapshot_json"->>'sequence')::INTEGER IS DISTINCT FROM NEW."template_sequence"
    OR NEW."template_snapshot_json"->>'checksum' IS DISTINCT FROM NEW."template_checksum"
    OR NEW."template_snapshot_json"->>'outputMode' IS DISTINCT FROM 'media_candidate'
    OR stored_suite."provider" IS DISTINCT FROM NEW."provider"
    OR stored_suite."model" IS DISTINCT FROM NEW."model"
    OR stored_suite."provider_config_hash" IS DISTINCT FROM NEW."provider_config_hash"
  THEN
    RAISE EXCEPTION 'AI media suite Prompt set authority mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_prompt_set_validate_insert"
BEFORE INSERT ON "ai_media_suite_prompt_sets"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_prompt_set_insert();

CREATE OR REPLACE FUNCTION validate_ai_media_suite_slot_prompt_insert() RETURNS trigger AS $$
DECLARE
  stored_set "ai_media_suite_prompt_sets"%ROWTYPE;
  stored_suite "ai_media_suites"%ROWTYPE;
  stored_slot "ai_media_suite_slots"%ROWTYPE;
BEGIN
  SELECT * INTO stored_set
  FROM "ai_media_suite_prompt_sets"
  WHERE "id" = NEW."prompt_set_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;
  SELECT * INTO stored_slot
  FROM "ai_media_suite_slots"
  WHERE "id" = NEW."slot_id"
    AND "suite_id" = NEW."suite_id"
    AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  IF stored_set."id" IS NULL
    OR stored_suite."id" IS NULL
    OR stored_slot."id" IS NULL
    OR stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR stored_suite."revision" IS DISTINCT FROM 3
    OR stored_set."suite_id" IS DISTINCT FROM NEW."suite_id"
    OR stored_set."reference_set_hash" IS DISTINCT FROM NEW."reference_set_hash"
    OR stored_set."template_key" IS DISTINCT FROM NEW."template_key"
    OR stored_set."template_release_id" IS DISTINCT FROM NEW."template_release_id"
    OR stored_set."template_revision_id" IS DISTINCT FROM NEW."template_revision_id"
    OR stored_set."template_sequence" IS DISTINCT FROM NEW."template_sequence"
    OR stored_set."template_checksum" IS DISTINCT FROM NEW."template_checksum"
    OR stored_set."prompt_set_version" IS DISTINCT FROM 'ai-image-suite-prompt-set/v1'
    OR NEW."version" IS DISTINCT FROM 'ai-image-suite-slot-prompt/v1'
    OR stored_set."policy_version" IS DISTINCT FROM NEW."policy_version"
    OR stored_set."policy_hash" IS DISTINCT FROM NEW."policy_hash"
    OR stored_set."compiler_version" IS DISTINCT FROM NEW."compiler_version"
    OR stored_set."template_snapshot_hash" IS DISTINCT FROM NEW."template_snapshot_hash"
    OR stored_set."template_snapshot_json" IS DISTINCT FROM NEW."template_snapshot_json"
    OR stored_slot."ordinal" IS DISTINCT FROM NEW."ordinal"
    OR stored_slot."slot_key" IS DISTINCT FROM NEW."slot_key"
    OR stored_slot."slot_hash" IS DISTINCT FROM NEW."slot_hash"
    OR stored_slot."references_hash" IS DISTINCT FROM NEW."references_hash"
  THEN
    RAISE EXCEPTION 'AI media suite slot Prompt authority mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_slot_prompt_validate_insert"
BEFORE INSERT ON "ai_media_suite_slot_prompts"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_slot_prompt_insert();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_prompt_set_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media suite Prompt set is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_prompt_set_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_suite_prompt_sets"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_prompt_set_immutable();

CREATE OR REPLACE FUNCTION protect_ai_media_suite_slot_prompt_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI media suite slot Prompt is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_slot_prompt_immutable"
BEFORE UPDATE OR DELETE ON "ai_media_suite_slot_prompts"
FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_slot_prompt_immutable();

CREATE OR REPLACE FUNCTION validate_ai_media_suite_prompt_event_insert() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id"
  FOR SHARE;

  IF stored_suite."id" IS NULL
    OR stored_suite."revision" IS DISTINCT FROM 3
    OR NEW."revision" IS DISTINCT FROM 3
    OR NEW."event_type" IS DISTINCT FROM 'PROMPTS_FROZEN'
    OR NEW."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-prompts-frozen/v1'
    OR COALESCE(NEW."payload"->>'promptSetHash', '') !~ '^[a-f0-9]{64}$'
    OR COALESCE(NEW."payload"->>'referenceSetHash', '') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(NEW."payload"->'slotPromptHashes') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'AI media suite Prompt freeze event authority mismatch' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_prompt_event_validate_insert"
BEFORE INSERT ON "ai_media_suite_events"
FOR EACH ROW WHEN (NEW."event_type" = 'PROMPTS_FROZEN')
EXECUTE FUNCTION validate_ai_media_suite_prompt_event_insert();

CREATE OR REPLACE FUNCTION require_ai_media_suite_prompt_frozen_set() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  prompt_set "ai_media_suite_prompt_sets"%ROWTYPE;
  frozen_event "ai_media_suite_events"%ROWTYPE;
  actual_count INTEGER;
  maximum_ordinal INTEGER;
  event_hash_count INTEGER;
  mismatched_hashes INTEGER;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  SELECT * INTO prompt_set
  FROM "ai_media_suite_prompt_sets"
  WHERE "suite_id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  SELECT * INTO frozen_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = NEW."suite_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "revision" = 3
    AND "event_type" = 'PROMPTS_FROZEN';

  SELECT count(*)::INTEGER, max("ordinal")
  INTO actual_count, maximum_ordinal
  FROM "ai_media_suite_slot_prompts"
  WHERE "suite_id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

  IF frozen_event."id" IS NULL
    OR prompt_set."id" IS NULL
    OR stored_suite."id" IS NULL
    OR stored_suite."revision" IS DISTINCT FROM 3
    OR stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR prompt_set."slot_count" IS DISTINCT FROM stored_suite."item_count"
    OR actual_count IS DISTINCT FROM stored_suite."item_count"
    OR maximum_ordinal IS DISTINCT FROM actual_count - 1
    OR frozen_event."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-prompts-frozen/v1'
    OR frozen_event."payload"->>'promptSetId' IS DISTINCT FROM prompt_set."id"
    OR frozen_event."payload"->>'promptSetHash' IS DISTINCT FROM prompt_set."prompt_set_hash"
    OR frozen_event."payload"->>'referenceSetHash' IS DISTINCT FROM prompt_set."reference_set_hash"
    OR frozen_event."actor_user_id" IS DISTINCT FROM prompt_set."actor_user_id"
    OR frozen_event."payload"->>'operationKey' IS DISTINCT FROM prompt_set."operation_key"
    OR frozen_event."payload"->>'requestFingerprint' IS DISTINCT FROM prompt_set."request_fingerprint"
    OR frozen_event."payload"->>'promptSetVersion' IS DISTINCT FROM prompt_set."prompt_set_version"
    OR frozen_event."payload"->>'compilerVersion' IS DISTINCT FROM prompt_set."compiler_version"
    OR frozen_event."payload"->>'policyVersion' IS DISTINCT FROM prompt_set."policy_version"
    OR frozen_event."payload"->>'policyHash' IS DISTINCT FROM prompt_set."policy_hash"
    OR frozen_event."payload"->>'planId' IS DISTINCT FROM prompt_set."plan_id"
    OR frozen_event."payload"->>'planVersionId' IS DISTINCT FROM prompt_set."plan_version_id"
    OR frozen_event."payload"->>'planHash' IS DISTINCT FROM prompt_set."plan_hash"
    OR frozen_event."payload"->>'sourceSubjectId' IS DISTINCT FROM prompt_set."source_subject_id"
    OR frozen_event."payload"->>'sourceCaptureSnapshotId' IS DISTINCT FROM prompt_set."source_capture_snapshot_id"
    OR frozen_event."payload"->>'sourceCaptureHash' IS DISTINCT FROM prompt_set."source_capture_hash"
    OR frozen_event."payload"->>'sourceProfileHash' IS DISTINCT FROM prompt_set."source_profile_hash"
    OR frozen_event."payload"->>'sourceSchemaVersion' IS DISTINCT FROM prompt_set."source_schema_version"
    OR frozen_event."payload"->>'provider' IS DISTINCT FROM prompt_set."provider"
    OR frozen_event."payload"->>'model' IS DISTINCT FROM prompt_set."model"
    OR frozen_event."payload"->>'providerConfigHash' IS DISTINCT FROM prompt_set."provider_config_hash"
    OR frozen_event."payload"->>'templateKey' IS DISTINCT FROM prompt_set."template_key"
    OR frozen_event."payload"->>'templateReleaseId' IS DISTINCT FROM prompt_set."template_release_id"
    OR frozen_event."payload"->>'templateRevisionId' IS DISTINCT FROM prompt_set."template_revision_id"
    OR COALESCE(frozen_event."payload"->>'templateSequence', '') !~ '^[0-9]+$'
    OR (frozen_event."payload"->>'templateSequence')::INTEGER IS DISTINCT FROM prompt_set."template_sequence"
    OR frozen_event."payload"->>'templateChecksum' IS DISTINCT FROM prompt_set."template_checksum"
    OR frozen_event."payload"->>'templateSnapshotHash' IS DISTINCT FROM prompt_set."template_snapshot_hash"
    OR (frozen_event."payload"->>'slotCount')::INTEGER IS DISTINCT FROM actual_count
    OR jsonb_array_length(frozen_event."payload"->'slotPromptHashes') IS DISTINCT FROM actual_count
  THEN
    RAISE EXCEPTION 'AI media suite Prompt set is incomplete' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER
  INTO event_hash_count
  FROM jsonb_array_elements_text(frozen_event."payload"->'slotPromptHashes') AS hash(value);

  SELECT count(*)::INTEGER
  INTO mismatched_hashes
  FROM "ai_media_suite_slot_prompts" slot_prompt
  CROSS JOIN LATERAL jsonb_array_elements_text(frozen_event."payload"->'slotPromptHashes') WITH ORDINALITY AS event_hash(value, ordinal)
  WHERE slot_prompt."suite_id" = NEW."suite_id"
    AND slot_prompt."owner_user_id" = NEW."owner_user_id"
    AND slot_prompt."ordinal" = event_hash."ordinal" - 1
    AND slot_prompt."binding_hash" IS DISTINCT FROM event_hash.value;

  IF event_hash_count IS DISTINCT FROM actual_count OR mismatched_hashes <> 0 THEN
    RAISE EXCEPTION 'AI media suite Prompt event hashes do not match frozen slots' USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ai_media_suite_prompt_frozen_set"
AFTER INSERT ON "ai_media_suite_slot_prompts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ai_media_suite_prompt_frozen_set();

CREATE CONSTRAINT TRIGGER "ai_media_suite_prompt_event_set"
AFTER INSERT ON "ai_media_suite_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."event_type" = 'PROMPTS_FROZEN')
EXECUTE FUNCTION require_ai_media_suite_prompt_frozen_set();

CREATE OR REPLACE FUNCTION require_ai_media_suite_frozen_prompts_for_child() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
BEGIN
  IF OLD."child_workflow_id" IS NULL AND NEW."child_workflow_id" IS NOT NULL THEN
    SELECT * INTO stored_suite
    FROM "ai_media_suites"
    WHERE "id" = NEW."suite_id" AND "owner_user_id" = NEW."owner_user_id";

    IF stored_suite."id" IS NULL
      OR stored_suite."revision" < 3
      OR NOT EXISTS (
        SELECT 1 FROM "ai_media_suite_events"
        WHERE "suite_id" = NEW."suite_id"
          AND "owner_user_id" = NEW."owner_user_id"
          AND "revision" = 3
          AND "event_type" = 'PROMPTS_FROZEN'
      )
      OR NOT EXISTS (
        SELECT 1 FROM "ai_media_suite_prompt_sets"
        WHERE "suite_id" = NEW."suite_id"
          AND "owner_user_id" = NEW."owner_user_id"
      )
      OR NOT EXISTS (
        SELECT 1 FROM "ai_media_suite_slot_prompts"
        WHERE "suite_id" = NEW."suite_id"
          AND "slot_id" = NEW."id"
          AND "owner_user_id" = NEW."owner_user_id"
      )
    THEN
      RAISE EXCEPTION 'child workflow requires frozen suite prompts' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_child_workflow_prompt_barrier"
BEFORE UPDATE OF "child_workflow_id" ON "ai_media_suite_slots"
FOR EACH ROW EXECUTE FUNCTION require_ai_media_suite_frozen_prompts_for_child();

-- Revision 3 is the Prompt barrier.  Do not let a future writer satisfy the
-- generic suite-audit trigger with an unrelated event and leave the suite in
-- a permanently unfreezable state.
CREATE OR REPLACE FUNCTION validate_ai_media_suite_prompt_revision_event() RETURNS trigger AS $$
BEGIN
  IF NEW."revision" = 3 AND NEW."event_type" IS DISTINCT FROM 'PROMPTS_FROZEN' THEN
    RAISE EXCEPTION 'AI media suite revision 3 requires PROMPTS_FROZEN event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_media_suite_prompt_revision_event_validate"
BEFORE INSERT ON "ai_media_suite_events"
FOR EACH ROW EXECUTE FUNCTION validate_ai_media_suite_prompt_revision_event();

COMMIT;
