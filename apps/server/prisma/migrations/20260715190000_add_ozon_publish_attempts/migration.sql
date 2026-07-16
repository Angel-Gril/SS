BEGIN;

CREATE TYPE "OzonPublishAttemptState" AS ENUM (
  'PREPARED', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN', 'REJECTED'
);
CREATE TYPE "OzonPublishReconciliationState" AS ENUM (
  'NOT_REQUIRED', 'PENDING', 'RUNNING', 'RETRY_WAIT',
  'SUCCEEDED', 'PARTIAL_FAILURE', 'FAILED', 'MANUAL_REVIEW'
);
CREATE TYPE "OzonPublishLeasePurpose" AS ENUM ('SUBMIT', 'RECONCILE');

CREATE OR REPLACE FUNCTION ozon_publish_offer_trace_is_valid(trace JSONB, expected_count INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  entry JSONB;
  entry_ordinal BIGINT;
  expected_ordinal INTEGER := 0;
  offer_id TEXT;
  sku_key TEXT;
  seen_offer_ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF expected_count < 1 OR expected_count > 500
    OR jsonb_typeof(trace) <> 'array'
    OR jsonb_array_length(trace) <> expected_count THEN
    RETURN FALSE;
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(trace) LOOP
    IF jsonb_typeof(entry) <> 'object'
      OR jsonb_typeof(entry->'ordinal') <> 'number'
      OR jsonb_typeof(entry->'offerId') <> 'string'
      OR jsonb_typeof(entry->'skuKey') <> 'string'
      OR (entry->>'ordinal') !~ '^[0-9]+$' THEN
      RETURN FALSE;
    END IF;
    entry_ordinal := (entry->>'ordinal')::BIGINT;
    offer_id := entry->>'offerId';
    sku_key := entry->>'skuKey';
    IF entry_ordinal <> expected_ordinal
      OR offer_id <> btrim(offer_id) OR length(offer_id) NOT BETWEEN 1 AND 200
      OR sku_key <> btrim(sku_key) OR length(sku_key) NOT BETWEEN 1 AND 500
      OR offer_id = ANY(seen_offer_ids) THEN
      RETURN FALSE;
    END IF;
    seen_offer_ids := array_append(seen_offer_ids, offer_id);
    expected_ordinal := expected_ordinal + 1;
  END LOOP;
  RETURN expected_ordinal = expected_count;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION ozon_publish_request_is_valid(
  payload JSONB,
  trace JSONB,
  expected_count INTEGER
)
RETURNS BOOLEAN AS $$
BEGIN
  IF expected_count < 1 OR expected_count > 500
    OR jsonb_typeof(payload) <> 'object'
    OR jsonb_typeof(payload->'items') <> 'array'
    OR jsonb_array_length(payload->'items') <> expected_count
    OR jsonb_typeof(trace) <> 'array'
    OR jsonb_array_length(trace) <> expected_count
    OR octet_length(payload::TEXT) > 8388608 THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(payload->'items') WITH ORDINALITY AS item(value, ordinal)
    JOIN jsonb_array_elements(trace) WITH ORDINALITY AS traced(value, ordinal)
      USING (ordinal)
    WHERE jsonb_typeof(item.value) <> 'object'
      OR jsonb_typeof(item.value->'offer_id') <> 'string'
      OR item.value->>'offer_id' IS DISTINCT FROM traced.value->>'offerId'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE "ozon_publish_attempts" (
  "id" TEXT NOT NULL,
  "publish_intent_id" TEXT NOT NULL,
  "workflow_id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "draft_version" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "source_capture_snapshot_id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "catalog_snapshot_id" TEXT NOT NULL,
  "catalog_revision" TEXT NOT NULL,
  "catalog_snapshot_json" JSONB NOT NULL,
  "catalog_snapshot_hash" TEXT NOT NULL,
  "attribute_schema_snapshot_json" JSONB NOT NULL,
  "attribute_schema_hash" TEXT NOT NULL,
  "publisher_contract_version" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL DEFAULT '/v3/product/import',
  "draft_payload_hash" TEXT NOT NULL,
  "draft_state_hash" TEXT NOT NULL,
  "request_payload_json" JSONB NOT NULL,
  "request_payload_hash" TEXT NOT NULL,
  "offer_trace_json" JSONB NOT NULL,
  "item_count" INTEGER NOT NULL,
  "state" "OzonPublishAttemptState" NOT NULL DEFAULT 'PREPARED',
  "reconciliation_state" "OzonPublishReconciliationState" NOT NULL DEFAULT 'NOT_REQUIRED',
  "state_version" INTEGER NOT NULL DEFAULT 1,
  "ozon_task_id" VARCHAR(40),
  "acceptance_source" VARCHAR(80),
  "response_json" JSONB,
  "response_hash" TEXT,
  "item_results_json" JSONB,
  "item_errors_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "last_error_code" VARCHAR(100),
  "last_error_message" VARCHAR(2000),
  "lease_purpose" "OzonPublishLeasePurpose",
  "lease_token" VARCHAR(100),
  "lease_owner" VARCHAR(200),
  "lease_epoch" INTEGER NOT NULL DEFAULT 0,
  "heartbeat_at" TIMESTAMP(3),
  "lease_expires_at" TIMESTAMP(3),
  "submit_started_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "unknown_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "next_reconcile_at" TIMESTAMP(3),
  "reconcile_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_reconciled_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "resolved_by_user_id" TEXT,
  "resolution_note" VARCHAR(2000),
  "resolution_evidence_json" JSONB,
  "resolution_evidence_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publish_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publish_attempt_versions_check" CHECK (
    "draft_version" > 0 AND "revision" > 0 AND "state_version" > 0
    AND "lease_epoch" >= 0 AND "reconcile_attempt_count" >= 0
  ),
  CONSTRAINT "ozon_publish_attempt_idempotency_check" CHECK (
    "idempotency_key" = btrim("idempotency_key")
    AND length("idempotency_key") BETWEEN 8 AND 200
  ),
  CONSTRAINT "ozon_publish_attempt_text_check" CHECK (
    "catalog_revision" = btrim("catalog_revision") AND length("catalog_revision") BETWEEN 1 AND 200
    AND "publisher_contract_version" = btrim("publisher_contract_version")
    AND length("publisher_contract_version") BETWEEN 1 AND 120
    AND "endpoint" = btrim("endpoint") AND length("endpoint") BETWEEN 1 AND 200
  ),
  CONSTRAINT "ozon_publish_attempt_hash_check" CHECK (
    "catalog_snapshot_hash" ~ '^[0-9a-f]{64}$'
    AND "attribute_schema_hash" ~ '^[0-9a-f]{64}$'
    AND "draft_payload_hash" ~ '^[0-9a-f]{64}$'
    AND "draft_state_hash" ~ '^[0-9a-f]{64}$'
    AND "request_payload_hash" ~ '^[0-9a-f]{64}$'
    AND ("response_hash" IS NULL OR "response_hash" ~ '^[0-9a-f]{64}$')
    AND ("resolution_evidence_hash" IS NULL OR "resolution_evidence_hash" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "ozon_publish_attempt_payload_check" CHECK (
    jsonb_typeof("catalog_snapshot_json") = 'object'
    AND octet_length("catalog_snapshot_json"::TEXT) <= 2097152
    AND jsonb_typeof("attribute_schema_snapshot_json") = 'object'
    AND octet_length("attribute_schema_snapshot_json"::TEXT) <= 2097152
    AND ozon_publish_request_is_valid("request_payload_json", "offer_trace_json", "item_count")
    AND ozon_publish_offer_trace_is_valid("offer_trace_json", "item_count")
    AND ("response_json" IS NULL OR octet_length("response_json"::TEXT) <= 524288)
    AND ("item_results_json" IS NULL OR (
      jsonb_typeof("item_results_json") = 'array'
      AND octet_length("item_results_json"::TEXT) <= 2097152
    ))
    AND jsonb_typeof("item_errors_json") = 'array'
    AND octet_length("item_errors_json"::TEXT) <= 2097152
    AND ("resolution_evidence_json" IS NULL OR (
      jsonb_typeof("resolution_evidence_json") = 'object'
      AND octet_length("resolution_evidence_json"::TEXT) <= 262144
    ))
  ),
  CONSTRAINT "ozon_publish_attempt_response_hash_pair_check" CHECK (
    ("response_json" IS NULL) = ("response_hash" IS NULL)
  ),
  CONSTRAINT "ozon_publish_attempt_resolution_pair_check" CHECK (
    ("resolution_evidence_json" IS NULL) = ("resolution_evidence_hash" IS NULL)
    AND (("resolved_by_user_id" IS NULL AND "resolution_note" IS NULL AND "resolution_evidence_json" IS NULL)
      OR ("resolved_by_user_id" IS NOT NULL AND "resolution_note" IS NOT NULL AND "resolution_evidence_json" IS NOT NULL))
  ),
  CONSTRAINT "ozon_publish_attempt_task_check" CHECK (
    "ozon_task_id" IS NULL OR "ozon_task_id" ~ '^[1-9][0-9]{0,39}$'
  ),
  CONSTRAINT "ozon_publish_attempt_state_shape_check" CHECK (
    ("state" = 'PREPARED'
      AND "submit_started_at" IS NULL AND "submitted_at" IS NULL
      AND "unknown_at" IS NULL AND "rejected_at" IS NULL
      AND "ozon_task_id" IS NULL AND "acceptance_source" IS NULL
      AND "response_json" IS NULL)
    OR ("state" = 'SUBMITTING'
      AND "submit_started_at" IS NOT NULL AND "submitted_at" IS NULL
      AND "unknown_at" IS NULL AND "rejected_at" IS NULL
      AND "ozon_task_id" IS NULL AND "acceptance_source" IS NULL
      AND "response_json" IS NULL)
    OR ("state" = 'SUBMITTED'
      AND "submit_started_at" IS NOT NULL AND "submitted_at" IS NOT NULL
      AND "rejected_at" IS NULL AND "acceptance_source" IS NOT NULL
      AND ("ozon_task_id" IS NOT NULL OR "acceptance_source" = 'OPERATOR_EVIDENCE'))
    OR ("state" = 'UNKNOWN'
      AND "submit_started_at" IS NOT NULL AND "submitted_at" IS NULL
      AND "unknown_at" IS NOT NULL AND "rejected_at" IS NULL
      AND "ozon_task_id" IS NULL AND "acceptance_source" IS NULL)
    OR ("state" = 'REJECTED'
      AND "submitted_at" IS NULL AND "rejected_at" IS NOT NULL
      AND "ozon_task_id" IS NULL AND "acceptance_source" IS NULL)
  ),
  CONSTRAINT "ozon_publish_attempt_state_reconciliation_check" CHECK (
    ("state" IN ('PREPARED', 'SUBMITTING', 'REJECTED') AND "reconciliation_state" = 'NOT_REQUIRED')
    OR ("state" = 'SUBMITTED' AND "reconciliation_state" IN (
      'PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'PARTIAL_FAILURE', 'FAILED', 'MANUAL_REVIEW'
    ))
    OR ("state" = 'UNKNOWN' AND "reconciliation_state" IN (
      'PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'
    ))
  ),
  CONSTRAINT "ozon_publish_attempt_lease_check" CHECK (
    (("lease_purpose" IS NULL AND "lease_token" IS NULL AND "lease_owner" IS NULL
      AND "heartbeat_at" IS NULL AND "lease_expires_at" IS NULL)
     OR ("lease_purpose" IS NOT NULL AND "lease_token" IS NOT NULL AND "lease_owner" IS NOT NULL
      AND "heartbeat_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL
      AND "lease_epoch" > 0 AND "lease_expires_at" > "heartbeat_at"
      AND (("lease_purpose" = 'SUBMIT' AND "state" = 'SUBMITTING' AND "reconciliation_state" = 'NOT_REQUIRED')
        OR ("lease_purpose" = 'RECONCILE' AND "state" IN ('SUBMITTED', 'UNKNOWN')
          AND "reconciliation_state" = 'RUNNING'))))
    AND ("state" <> 'SUBMITTING' OR "lease_purpose" = 'SUBMIT')
    AND ("reconciliation_state" <> 'RUNNING' OR "lease_purpose" = 'RECONCILE')
  ),
  CONSTRAINT "ozon_publish_attempt_reconcile_schedule_check" CHECK (
    (("reconciliation_state" IN ('PENDING', 'RETRY_WAIT')) = ("next_reconcile_at" IS NOT NULL))
  ),
  CONSTRAINT "ozon_publish_attempt_completion_check" CHECK (
    (("reconciliation_state" IN ('SUCCEEDED', 'PARTIAL_FAILURE', 'FAILED'))
      = ("completed_at" IS NOT NULL))
    AND ("resolved_by_user_id" IS NULL OR "state" IN ('SUBMITTED', 'REJECTED'))
  )
);

CREATE TABLE "ozon_publish_attempt_events" (
  "id" TEXT NOT NULL,
  "attempt_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "state" "OzonPublishAttemptState" NOT NULL,
  "reconciliation_state" "OzonPublishReconciliationState" NOT NULL,
  "actor_user_id" TEXT,
  "worker_id" VARCHAR(200),
  "payload" JSONB NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publish_attempt_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publish_attempt_event_shape_check" CHECK (
    "sequence" > 0
    AND "event_type" = btrim("event_type") AND length("event_type") BETWEEN 1 AND 100
    AND (("actor_user_id" IS NOT NULL) <> ("worker_id" IS NOT NULL))
    AND jsonb_typeof("payload") = 'object'
    AND octet_length("payload"::TEXT) <= 262144
    AND "payload_hash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "ozon_publish_attempt_intent_key"
  ON "ozon_publish_attempts"("publish_intent_id");
CREATE UNIQUE INDEX "ozon_publish_attempt_owner_idempotency_key"
  ON "ozon_publish_attempts"("owner_user_id", "idempotency_key");
CREATE UNIQUE INDEX "ozon_publish_attempt_shop_task_key"
  ON "ozon_publish_attempts"("shop_id", "ozon_task_id") WHERE "ozon_task_id" IS NOT NULL;
CREATE INDEX "ozon_publish_attempt_draft_idx"
  ON "ozon_publish_attempts"("workflow_id", "draft_version", "revision");
CREATE INDEX "ozon_publish_attempt_owner_idx"
  ON "ozon_publish_attempts"("owner_user_id", "created_at");
CREATE INDEX "ozon_publish_attempt_shop_idx"
  ON "ozon_publish_attempts"("shop_id", "created_at");
CREATE INDEX "ozon_publish_attempt_stale_submit_idx"
  ON "ozon_publish_attempts"("lease_expires_at", "id") WHERE "state" = 'SUBMITTING';
CREATE INDEX "ozon_publish_attempt_reconcile_due_idx"
  ON "ozon_publish_attempts"("next_reconcile_at", "id")
  WHERE "reconciliation_state" IN ('PENDING', 'RETRY_WAIT');
CREATE INDEX "ozon_publish_attempt_stale_reconcile_idx"
  ON "ozon_publish_attempts"("lease_expires_at", "id")
  WHERE "reconciliation_state" = 'RUNNING';
CREATE UNIQUE INDEX "ozon_publish_attempt_event_sequence_key"
  ON "ozon_publish_attempt_events"("attempt_id", "sequence");
CREATE INDEX "ozon_publish_attempt_event_attempt_idx"
  ON "ozon_publish_attempt_events"("attempt_id", "created_at");
CREATE INDEX "ozon_publish_attempt_event_actor_idx"
  ON "ozon_publish_attempt_events"("actor_user_id", "created_at");

ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_intent_fkey"
  FOREIGN KEY ("publish_intent_id") REFERENCES "source_listing_publish_intents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_workflow_owner_fkey"
  FOREIGN KEY ("workflow_id", "owner_user_id") REFERENCES "source_listing_workflows"("id", "owner_user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_owner_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_shop_owner_fkey"
  FOREIGN KEY ("shop_id", "owner_user_id") REFERENCES "shops"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_draft_fkey"
  FOREIGN KEY ("workflow_id", "revision") REFERENCES "source_listing_draft_versions"("workflow_id", "revision")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_snapshot_fkey"
  FOREIGN KEY ("source_capture_snapshot_id") REFERENCES "source_capture_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_catalog_fkey"
  FOREIGN KEY ("catalog_snapshot_id", "shop_id", "catalog_revision")
  REFERENCES "ozon_category_catalog_snapshots"("id", "shop_id", "revision")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempts" ADD CONSTRAINT "ozon_publish_attempt_resolver_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempt_events" ADD CONSTRAINT "ozon_publish_attempt_event_attempt_fkey"
  FOREIGN KEY ("attempt_id") REFERENCES "ozon_publish_attempts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ozon_publish_attempt_events" ADD CONSTRAINT "ozon_publish_attempt_event_actor_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_ozon_publish_attempt()
RETURNS trigger AS $$
DECLARE
  intent_workflow TEXT;
  intent_owner TEXT;
  intent_shop TEXT;
  intent_draft_version INTEGER;
  intent_revision INTEGER;
  intent_key TEXT;
  intent_hash TEXT;
  intent_actor TEXT;
  draft_payload_hash TEXT;
  draft_snapshot TEXT;
  workflow_revision INTEGER;
  workflow_draft_version INTEGER;
  workflow_shop TEXT;
  workflow_stage TEXT;
  workflow_status TEXT;
  catalog_valid BOOLEAN;
  semantic_change BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT intent."workflow_id", intent."owner_user_id", intent."shop_id", intent."draft_version",
           intent."revision", intent."idempotency_key", intent."payload_hash", intent."actor_user_id",
           draft."payload_hash", draft."source_capture_snapshot_id",
           workflow."current_revision", workflow."current_draft_version", workflow."shop_id",
           workflow."stage", workflow."status"::TEXT
      INTO intent_workflow, intent_owner, intent_shop, intent_draft_version,
           intent_revision, intent_key, intent_hash, intent_actor,
           draft_payload_hash, draft_snapshot,
           workflow_revision, workflow_draft_version, workflow_shop, workflow_stage, workflow_status
    FROM "source_listing_publish_intents" intent
    JOIN "source_listing_draft_versions" draft
      ON draft."workflow_id" = intent."workflow_id" AND draft."revision" = intent."revision"
    JOIN "source_listing_workflows" workflow ON workflow."id" = intent."workflow_id"
    WHERE intent."id" = NEW."publish_intent_id"
    FOR KEY SHARE OF intent, draft, workflow;

    SELECT EXISTS (
      SELECT 1 FROM "ozon_category_catalog_snapshots" catalog
      WHERE catalog."id" = NEW."catalog_snapshot_id"
        AND catalog."shop_id" = NEW."shop_id"
        AND catalog."revision" = NEW."catalog_revision"
        AND catalog."complete" = TRUE
        AND catalog."default_tree_complete" = TRUE
        AND catalog."zh_hans_tree_complete" = TRUE
        AND catalog."is_current" = TRUE
        AND catalog."expires_at" > clock_timestamp()
    ) INTO catalog_valid;

    IF intent_workflow IS NULL
      OR intent_workflow <> NEW."workflow_id"
      OR intent_owner <> NEW."owner_user_id"
      OR intent_shop <> NEW."shop_id"
      OR intent_draft_version <> NEW."draft_version"
      OR intent_revision <> NEW."revision"
      OR intent_key <> NEW."idempotency_key"
      OR intent_hash <> NEW."draft_state_hash"
      OR intent_actor <> NEW."actor_user_id"
      OR draft_payload_hash <> NEW."draft_payload_hash"
      OR draft_snapshot <> NEW."source_capture_snapshot_id"
      OR workflow_revision <> NEW."revision"
      OR workflow_draft_version <> NEW."draft_version"
      OR workflow_shop <> NEW."shop_id"
      OR workflow_stage <> 'PUBLISH_INTENT_RECORDED'
      OR workflow_status <> 'ACTIVE'
      OR NOT catalog_valid THEN
      RAISE EXCEPTION 'Ozon publish attempt must bind the current owned intent, draft and catalog'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."publish_intent_id" IS DISTINCT FROM OLD."publish_intent_id"
    OR NEW."workflow_id" IS DISTINCT FROM OLD."workflow_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."shop_id" IS DISTINCT FROM OLD."shop_id"
    OR NEW."draft_version" IS DISTINCT FROM OLD."draft_version"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM OLD."source_capture_snapshot_id"
    OR NEW."actor_user_id" IS DISTINCT FROM OLD."actor_user_id"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."catalog_snapshot_id" IS DISTINCT FROM OLD."catalog_snapshot_id"
    OR NEW."catalog_revision" IS DISTINCT FROM OLD."catalog_revision"
    OR NEW."catalog_snapshot_json" IS DISTINCT FROM OLD."catalog_snapshot_json"
    OR NEW."catalog_snapshot_hash" IS DISTINCT FROM OLD."catalog_snapshot_hash"
    OR NEW."attribute_schema_snapshot_json" IS DISTINCT FROM OLD."attribute_schema_snapshot_json"
    OR NEW."attribute_schema_hash" IS DISTINCT FROM OLD."attribute_schema_hash"
    OR NEW."publisher_contract_version" IS DISTINCT FROM OLD."publisher_contract_version"
    OR NEW."endpoint" IS DISTINCT FROM OLD."endpoint"
    OR NEW."draft_payload_hash" IS DISTINCT FROM OLD."draft_payload_hash"
    OR NEW."draft_state_hash" IS DISTINCT FROM OLD."draft_state_hash"
    OR NEW."request_payload_json" IS DISTINCT FROM OLD."request_payload_json"
    OR NEW."request_payload_hash" IS DISTINCT FROM OLD."request_payload_hash"
    OR NEW."offer_trace_json" IS DISTINCT FROM OLD."offer_trace_json"
    OR NEW."item_count" IS DISTINCT FROM OLD."item_count"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Ozon publish attempt immutable fields cannot change' USING ERRCODE = '23514';
  END IF;

  IF NEW."ozon_task_id" IS DISTINCT FROM OLD."ozon_task_id" AND OLD."ozon_task_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Ozon publish task ID is immutable once recorded' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    NEW."state" = OLD."state"
    OR (OLD."state" = 'PREPARED' AND NEW."state" IN ('SUBMITTING', 'REJECTED'))
    OR (OLD."state" = 'SUBMITTING' AND NEW."state" IN ('SUBMITTED', 'UNKNOWN', 'REJECTED'))
    OR (OLD."state" = 'UNKNOWN' AND NEW."state" IN ('SUBMITTED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION 'Illegal Ozon publish attempt state transition' USING ERRCODE = '23514';
  END IF;

  semantic_change := NEW."state" IS DISTINCT FROM OLD."state"
    OR NEW."reconciliation_state" IS DISTINCT FROM OLD."reconciliation_state"
    OR NEW."ozon_task_id" IS DISTINCT FROM OLD."ozon_task_id"
    OR NEW."acceptance_source" IS DISTINCT FROM OLD."acceptance_source"
    OR NEW."response_json" IS DISTINCT FROM OLD."response_json"
    OR NEW."response_hash" IS DISTINCT FROM OLD."response_hash"
    OR NEW."item_results_json" IS DISTINCT FROM OLD."item_results_json"
    OR NEW."item_errors_json" IS DISTINCT FROM OLD."item_errors_json"
    OR NEW."last_error_code" IS DISTINCT FROM OLD."last_error_code"
    OR NEW."last_error_message" IS DISTINCT FROM OLD."last_error_message"
    OR NEW."lease_purpose" IS DISTINCT FROM OLD."lease_purpose"
    OR NEW."lease_token" IS DISTINCT FROM OLD."lease_token"
    OR NEW."lease_owner" IS DISTINCT FROM OLD."lease_owner"
    OR NEW."lease_epoch" IS DISTINCT FROM OLD."lease_epoch"
    OR NEW."submit_started_at" IS DISTINCT FROM OLD."submit_started_at"
    OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
    OR NEW."unknown_at" IS DISTINCT FROM OLD."unknown_at"
    OR NEW."rejected_at" IS DISTINCT FROM OLD."rejected_at"
    OR NEW."next_reconcile_at" IS DISTINCT FROM OLD."next_reconcile_at"
    OR NEW."reconcile_attempt_count" IS DISTINCT FROM OLD."reconcile_attempt_count"
    OR NEW."last_reconciled_at" IS DISTINCT FROM OLD."last_reconciled_at"
    OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
    OR NEW."resolved_by_user_id" IS DISTINCT FROM OLD."resolved_by_user_id"
    OR NEW."resolution_note" IS DISTINCT FROM OLD."resolution_note"
    OR NEW."resolution_evidence_json" IS DISTINCT FROM OLD."resolution_evidence_json"
    OR NEW."resolution_evidence_hash" IS DISTINCT FROM OLD."resolution_evidence_hash";
  IF (semantic_change AND NEW."state_version" <> OLD."state_version" + 1)
    OR (NOT semantic_change AND NEW."state_version" <> OLD."state_version") THEN
    RAISE EXCEPTION 'Ozon publish attempt state version transition is invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW."lease_epoch" < OLD."lease_epoch" OR NEW."lease_epoch" > OLD."lease_epoch" + 1
    OR (NEW."lease_token" IS DISTINCT FROM OLD."lease_token" AND NEW."lease_token" IS NOT NULL
      AND NEW."lease_epoch" <> OLD."lease_epoch" + 1) THEN
    RAISE EXCEPTION 'Ozon publish attempt lease epoch transition is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_ozon_publish_attempt_event()
RETURNS trigger AS $$
DECLARE
  current_version INTEGER;
  current_state "OzonPublishAttemptState";
  current_reconciliation "OzonPublishReconciliationState";
  current_owner TEXT;
BEGIN
  SELECT "state_version", "state", "reconciliation_state", "owner_user_id"
    INTO current_version, current_state, current_reconciliation, current_owner
  FROM "ozon_publish_attempts" WHERE "id" = NEW."attempt_id" FOR KEY SHARE;
  IF current_version IS NULL OR NEW."sequence" <> current_version
    OR NEW."state" <> current_state OR NEW."reconciliation_state" <> current_reconciliation
    OR (NEW."actor_user_id" IS NOT NULL AND NEW."actor_user_id" <> current_owner) THEN
    RAISE EXCEPTION 'Ozon publish attempt event does not match current state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION require_ozon_publish_attempt_event()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ozon_publish_attempt_events"
    WHERE "attempt_id" = NEW."id" AND "sequence" = NEW."state_version"
      AND "state" = NEW."state" AND "reconciliation_state" = NEW."reconciliation_state"
  ) THEN
    RAISE EXCEPTION 'Ozon publish attempt state transition requires an event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_ozon_publish_attempt_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ozon publish attempts are retained for audit' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_ozon_publish_attempt_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ozon publish attempt events are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publish_attempt_validate"
BEFORE INSERT OR UPDATE ON "ozon_publish_attempts"
FOR EACH ROW EXECUTE FUNCTION validate_ozon_publish_attempt();
CREATE TRIGGER "ozon_publish_attempt_delete_prevent"
BEFORE DELETE ON "ozon_publish_attempts"
FOR EACH ROW EXECUTE FUNCTION prevent_ozon_publish_attempt_delete();
CREATE TRIGGER "ozon_publish_attempt_event_validate"
BEFORE INSERT ON "ozon_publish_attempt_events"
FOR EACH ROW EXECUTE FUNCTION validate_ozon_publish_attempt_event();
CREATE TRIGGER "ozon_publish_attempt_event_immutable"
BEFORE UPDATE OR DELETE ON "ozon_publish_attempt_events"
FOR EACH ROW EXECUTE FUNCTION prevent_ozon_publish_attempt_event_mutation();
CREATE CONSTRAINT TRIGGER "ozon_publish_attempt_event_required"
AFTER INSERT OR UPDATE ON "ozon_publish_attempts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_ozon_publish_attempt_event();

COMMIT;
