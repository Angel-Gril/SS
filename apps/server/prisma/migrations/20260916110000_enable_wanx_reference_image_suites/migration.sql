BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Forward-only validation compatibility. No existing record, price or amount is rewritten.

-- Pure runtime admission, shared by materialization, execution and output guards.
-- Deliberately not STRICT: every NULL/malformed input returns false, never NULL.
CREATE OR REPLACE FUNCTION ai_media_wanx_suite_runtime_valid(
  request_operation TEXT,
  operation_config JSONB,
  expected_cost INTEGER,
  pricing_version TEXT,
  input_assets JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  runtime JSONB;
  credential JSONB;
  revision_number NUMERIC;
  updated_at_text TEXT;
  expected_pricing TEXT;
BEGIN
  IF request_operation IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR expected_cost IS NULL OR expected_cost < 1
    OR jsonb_typeof(operation_config) IS DISTINCT FROM 'object'
    OR jsonb_typeof(input_assets) IS DISTINCT FROM 'array'
  THEN RETURN false; END IF;
  IF jsonb_array_length(input_assets) <> 1 THEN RETURN false; END IF;
  runtime := operation_config->'providerRuntime';
  credential := runtime->'credentialRevision';
  IF jsonb_typeof(runtime) IS DISTINCT FROM 'object'
    OR jsonb_typeof(credential) IS DISTINCT FROM 'object'
    OR jsonb_typeof(credential->'recordId') IS DISTINCT FROM 'string'
    OR COALESCE(credential->>'recordId', '') !~ '^[A-Za-z0-9_-]{1,128}$'
    OR jsonb_typeof(credential->'revision') IS DISTINCT FROM 'number'
    OR jsonb_typeof(credential->'updatedAt') IS DISTINCT FROM 'string'
    OR (SELECT count(*) FROM jsonb_object_keys(credential)) <> 3
  THEN RETURN false; END IF;
  revision_number := (credential->>'revision')::NUMERIC;
  IF revision_number < 0 OR revision_number > 9007199254740991 OR trunc(revision_number) <> revision_number
  THEN RETURN false; END IF;
  updated_at_text := credential->>'updatedAt';
  IF updated_at_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR to_char(updated_at_text::TIMESTAMPTZ AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') IS DISTINCT FROM updated_at_text
  THEN RETURN false; END IF;
  -- Same canonical five-field price identity as hashAiMediaPlanningJson in the
  -- suite runtime owner. sha256(bytea) is a PostgreSQL built-in; no extension.
  expected_pricing := 'ai-image-suite-price-cny/v1:' || left(encode(sha256(convert_to(
    '{"currency":"CNY","model":"wanx2.1-imageedit","provider":"dashscope-wanx","unitCostCents":'
      || expected_cost::TEXT || ',"version":"ai-image-suite-price-cny/v1"}', 'UTF8')), 'hex'), 32);
  RETURN COALESCE(
    pricing_version = expected_pricing
    AND operation_config->>'version' = 'ai-image-suite-child-operation/v2'
    AND operation_config->>'outputProfile' = 'ozon-suite-3x4-900x1200/v1'
    AND operation_config->'width' = '900'::JSONB
    AND operation_config->'height' = '1200'::JSONB
    AND runtime->>'contractVersion' = 'ai-image-provider-runtime/v3'
    AND runtime->>'provider' = 'dashscope-wanx'
    AND runtime->>'model' = 'wanx2.1-imageedit'
    -- sha256('https://dashscope.aliyuncs.com/api/v1'), matching the normal adapter.
    AND runtime->>'baseUrlSha256' = '3d3074c32a59b1d48fc41b46cdc5f389411691480738fa914cde3537cb61fbff'
    AND runtime->>'currency' = 'CNY'
    AND runtime->'imageCount' = '1'::JSONB
    AND runtime->'width' = '1024'::JSONB AND runtime->'height' = '1024'::JSONB
    AND runtime->'unitCostCents' = to_jsonb(expected_cost)
    AND runtime->'maximumCostCents' = to_jsonb(expected_cost)
    AND operation_config->'providerRequest' = '{"count":1,"width":1024,"height":1024}'::JSONB
    AND operation_config->'finalOutput' = '{"profile":"ozon-suite-3x4-900x1200/v1","width":900,"height":1200,"fit":"contain","background":"#ffffff","format":"png","normalizerVersion":"ai-image-suite-output-normalizer/v1"}'::JSONB
    AND jsonb_typeof(input_assets->0->'assetId') = 'string'
    AND char_length(input_assets->0->>'assetId') BETWEEN 1 AND 200
    AND input_assets->0->>'role' = 'REFERENCE'
    AND input_assets->0->'ordinal' = '0'::JSONB
    AND COALESCE(input_assets->0->>'sha256', '') ~ '^[a-f0-9]{64}$'
  , false);
EXCEPTION WHEN data_exception THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- The original paid adapter materializes v2 children, even though its USD
-- provider identity is v1. Admit only that complete frozen tuple; old v1 rows
-- keep their existing validation branch below.
CREATE OR REPLACE FUNCTION ai_media_legacy_paid_suite_runtime_valid(
  request_operation TEXT,
  operation_config JSONB,
  expected_cost INTEGER,
  pricing_version TEXT,
  input_assets JSONB,
  expected_provider TEXT,
  expected_model TEXT,
  expected_config_hash TEXT,
  concurrency_limit INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  runtime JSONB;
  expected_runtime JSONB;
  runtime_text TEXT;
  expected_pricing TEXT;
  config_text TEXT;
BEGIN
  IF request_operation IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR expected_provider IS NULL OR expected_provider NOT IN ('openai-images', 'custom')
    OR expected_model IS NULL OR expected_model = '*' OR expected_model <> btrim(expected_model)
    OR char_length(expected_model) NOT BETWEEN 1 AND 200
    OR (expected_provider = 'openai-images' AND expected_model <> 'gpt-image-1')
    OR expected_cost IS NULL OR expected_cost < 1
    OR concurrency_limit IS NULL OR concurrency_limit NOT BETWEEN 1 AND 16
    OR expected_config_hash IS NULL OR expected_config_hash !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(operation_config) IS DISTINCT FROM 'object'
    OR jsonb_typeof(input_assets) IS DISTINCT FROM 'array'
  THEN RETURN false; END IF;
  IF jsonb_array_length(input_assets) NOT BETWEEN 1 AND 16 THEN RETURN false; END IF;
  runtime := operation_config->'providerRuntime';
  IF jsonb_typeof(runtime) IS DISTINCT FROM 'object'
    OR COALESCE(runtime->>'baseUrlSha256', '') !~ '^[a-f0-9]{64}$'
    OR (expected_provider = 'openai-images' AND runtime->>'baseUrlSha256' IS DISTINCT FROM
      encode(sha256(convert_to('https://api.openai.com/v1', 'UTF8')), 'hex'))
  THEN RETURN false; END IF;
  expected_runtime := jsonb_build_object(
    'contractVersion', 'ai-image-provider-runtime/v1', 'provider', expected_provider, 'model', expected_model,
    'baseUrlSha256', runtime->>'baseUrlSha256', 'unitCostCents', expected_cost,
    'imageCount', 1, 'width', 1024, 'height', 1536, 'maximumCostCents', expected_cost);
  IF runtime IS DISTINCT FROM expected_runtime THEN RETURN false; END IF;
  -- Canonical JSON property order matches the existing TypeScript runtime owner.
  expected_pricing := 'ai-image-suite-price/v1:' || left(encode(sha256(convert_to(
    '{"currency":"USD","model":' || to_json(expected_model)::TEXT
      || ',"provider":' || to_json(expected_provider)::TEXT || ',"unitCostCents":' || expected_cost::TEXT
      || ',"version":"ai-image-suite-price/v1"}', 'UTF8')), 'hex'), 32);
  runtime_text := '{"baseUrlSha256":' || to_json(runtime->>'baseUrlSha256')::TEXT
    || ',"contractVersion":"ai-image-provider-runtime/v1","height":1536,"imageCount":1,"maximumCostCents":'
    || expected_cost::TEXT || ',"model":' || to_json(expected_model)::TEXT
    || ',"provider":' || to_json(expected_provider)::TEXT || ',"unitCostCents":' || expected_cost::TEXT || ',"width":1024}';
  config_text := '{"concurrencyLimit":' || concurrency_limit::TEXT
    || ',"finalOutput":{"background":"#ffffff","fit":"contain","format":"png","height":1200,"normalizerVersion":"ai-image-suite-output-normalizer/v1","profile":"ozon-suite-3x4-900x1200/v1","width":900},"providerRuntime":'
    || runtime_text || ',"version":"ai-image-suite-provider-runtime/v1"}';
  RETURN COALESCE(
    pricing_version = expected_pricing
    AND expected_config_hash = encode(sha256(convert_to(config_text, 'UTF8')), 'hex')
    AND operation_config->>'version' = 'ai-image-suite-child-operation/v2'
    AND operation_config->>'outputProfile' = 'ozon-suite-3x4-900x1200/v1'
    AND operation_config->'width' = '900'::JSONB AND operation_config->'height' = '1200'::JSONB
    AND operation_config->'providerRequest' = '{"count":1,"width":1024,"height":1536}'::JSONB
    AND operation_config->'finalOutput' = '{"profile":"ozon-suite-3x4-900x1200/v1","width":900,"height":1200,"fit":"contain","background":"#ffffff","format":"png","normalizerVersion":"ai-image-suite-output-normalizer/v1"}'::JSONB
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(input_assets) WITH ORDINALITY AS ref(value, position)
      WHERE jsonb_typeof(ref.value->'assetId') IS DISTINCT FROM 'string'
        OR char_length(ref.value->>'assetId') NOT BETWEEN 1 AND 200
        OR ref.value->>'role' IS DISTINCT FROM 'REFERENCE'
        OR ref.value->'ordinal' IS DISTINCT FROM to_jsonb(ref.position - 1)
        OR COALESCE(ref.value->>'sha256', '') !~ '^[a-f0-9]{64}$'
    )
  , false);
EXCEPTION WHEN data_exception THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Only an expired, already-accepted Wanx task can acquire a replacement lease.
-- Business identity, revision and attempt remain byte-for-byte unchanged.
CREATE OR REPLACE FUNCTION ai_media_wanx_suite_lease_takeover_allowed(
  old_slot "ai_media_suite_slots",
  new_slot "ai_media_suite_slots"
) RETURNS BOOLEAN AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  child_job "ai_image_jobs"%ROWTYPE;
BEGIN
  IF old_slot."status" IS DISTINCT FROM 'RUNNING' OR new_slot."status" IS DISTINCT FROM 'RUNNING'
    OR old_slot."execution_claim_token" IS NULL
    OR COALESCE(new_slot."execution_claim_token", '') !~ '^[a-f0-9]{64}$'
    OR new_slot."execution_claim_token" IS NOT DISTINCT FROM old_slot."execution_claim_token"
    OR old_slot."execution_lease_expires_at" IS NULL
    OR old_slot."execution_lease_expires_at" > statement_timestamp()
    OR new_slot."execution_lease_expires_at" IS NULL
    OR new_slot."execution_lease_expires_at" <= statement_timestamp()
    OR new_slot."execution_lease_expires_at" > statement_timestamp() + INTERVAL '125 seconds'
    OR new_slot."updated_at" < old_slot."updated_at"
    OR (to_jsonb(new_slot) - ARRAY['execution_claim_token', 'execution_lease_expires_at', 'updated_at'])
      IS DISTINCT FROM (to_jsonb(old_slot) - ARRAY['execution_claim_token', 'execution_lease_expires_at', 'updated_at'])
  THEN RETURN false; END IF;
  SELECT * INTO stored_suite FROM "ai_media_suites"
  WHERE "id" = old_slot."suite_id" AND "owner_user_id" = old_slot."owner_user_id";
  SELECT * INTO child_job FROM "ai_image_jobs"
  WHERE "workflow_id" = old_slot."child_workflow_id"
    AND "owner_user_id" = old_slot."owner_user_id" AND "workflow_attempt" = old_slot."attempt";
  RETURN COALESCE(
    stored_suite."id" IS NOT NULL AND stored_suite."revision" >= 5
    AND stored_suite."provider" = 'dashscope-wanx' AND stored_suite."model" = 'wanx2.1-imageedit'
    AND child_job."provider" = stored_suite."provider" AND child_job."model" = stored_suite."model"
    AND child_job."status" = 'RUNNING' AND child_job."provider_dispatched_at" IS NOT NULL
    AND char_length(btrim(child_job."provider_job_id")) > 0
    AND child_job."estimated_cost_cents" = old_slot."estimated_cost_cents"
    AND child_job."estimated_cost_cents" = old_slot."maximum_cost_cents"
    AND ai_media_wanx_suite_runtime_valid(child_job."operation"::TEXT, child_job."operation_config_json",
      child_job."estimated_cost_cents", stored_suite."pricing_version", child_job."input_assets_json")
  , false);
END;
$$ LANGUAGE plpgsql STABLE;

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
    OR (
      (NEW."compiler_version" = 'ai-image-suite-prompt-compiler/v1'
        AND NEW."template_key" = 'image-suite-generation.base')
      OR (NEW."compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'
        AND NEW."template_key" = 'ai_media_suite_generation_wanx'
        AND NEW."provider" = 'dashscope-wanx' AND NEW."model" = 'wanx2.1-imageedit'
        AND stored_suite."pricing_version" ~ '^ai-image-suite-price-cny/v1:[a-f0-9]{32}$'
        AND stored_suite."estimated_cost_cents" = stored_suite."maximum_cost_cents"
        AND (SELECT count(*) FROM "ai_media_suite_slots" slot
          WHERE slot."suite_id" = NEW."suite_id" AND slot."owner_user_id" = NEW."owner_user_id") = NEW."slot_count"
        AND NOT EXISTS (SELECT 1 FROM "ai_media_suite_slots" slot
          WHERE slot."suite_id" = NEW."suite_id" AND slot."owner_user_id" = NEW."owner_user_id"
            AND CASE WHEN jsonb_typeof(slot."references_snapshot_json") = 'array'
              THEN jsonb_array_length(slot."references_snapshot_json") <> 1 ELSE true END))
    ) IS DISTINCT FROM TRUE
    OR ((stored_suite."provider" = 'dashscope-wanx'
      OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%')
      AND ((NEW."compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'
        AND NEW."template_key" = 'ai_media_suite_generation_wanx') IS DISTINCT FROM TRUE))
    OR NEW."policy_version" IS DISTINCT FROM 'ozon-image-slot-policy/v1'
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

CREATE OR REPLACE FUNCTION assert_ai_media_suite_materialized_graph(
  target_suite_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  prompt_set "ai_media_suite_prompt_sets"%ROWTYPE;
  materialized_event "ai_media_suite_events"%ROWTYPE;
  actual_slot_count INTEGER;
  bound_slot_count INTEGER;
  invalid_slot_count INTEGER;
  mismatched_child_count INTEGER;
  aggregate_estimated_cost BIGINT;
  aggregate_maximum_cost BIGINT;
  wanx_suite BOOLEAN;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = target_suite_id AND "owner_user_id" = target_owner_user_id;

  IF stored_suite."id" IS NULL OR stored_suite."revision" IS DISTINCT FROM 4 THEN
    RETURN;
  END IF;

  -- A malformed Wanx price must fail here, never select the legacy branch.
  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx'
    OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%', false);

  SELECT * INTO prompt_set
  FROM "ai_media_suite_prompt_sets"
  WHERE "suite_id" = target_suite_id AND "owner_user_id" = target_owner_user_id;

  SELECT * INTO materialized_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = target_suite_id
    AND "owner_user_id" = target_owner_user_id
    AND "revision" = 4
    AND "event_type" = 'CHILDREN_MATERIALIZED';

  SELECT
    count(*)::INTEGER,
    count("child_workflow_id")::INTEGER,
    COALESCE(sum("estimated_cost_cents")::BIGINT, 0),
    COALESCE(sum("maximum_cost_cents")::BIGINT, 0)
  INTO actual_slot_count, bound_slot_count, aggregate_estimated_cost, aggregate_maximum_cost
  FROM "ai_media_suite_slots"
  WHERE "suite_id" = target_suite_id AND "owner_user_id" = target_owner_user_id;

  IF stored_suite."status" IS DISTINCT FROM 'PLANNED'
    OR prompt_set."id" IS NULL
    OR materialized_event."id" IS NULL
    OR actual_slot_count IS DISTINCT FROM stored_suite."item_count"
    OR bound_slot_count IS DISTINCT FROM stored_suite."item_count"
    OR aggregate_estimated_cost IS DISTINCT FROM stored_suite."estimated_cost_cents"::BIGINT
    OR aggregate_maximum_cost IS DISTINCT FROM stored_suite."maximum_cost_cents"::BIGINT
    OR prompt_set."slot_count" IS DISTINCT FROM stored_suite."item_count"
    OR materialized_event."payload"->>'version' IS DISTINCT FROM 'ai-image-suite-children-materialized/v1'
    OR materialized_event."payload"->>'slotCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR materialized_event."payload"->>'childCount' IS DISTINCT FROM stored_suite."item_count"::TEXT
    OR materialized_event."payload"->>'promptSetHash' IS DISTINCT FROM prompt_set."prompt_set_hash"
    OR materialized_event."payload"->>'referenceSetHash' IS DISTINCT FROM prompt_set."reference_set_hash"
    OR materialized_event."payload"->>'provider' IS DISTINCT FROM stored_suite."provider"
    OR materialized_event."payload"->>'model' IS DISTINCT FROM stored_suite."model"
    OR materialized_event."payload"->>'providerConfigHash' IS DISTINCT FROM stored_suite."provider_config_hash"
    OR materialized_event."payload"->>'pricingVersion' IS DISTINCT FROM stored_suite."pricing_version"
    OR materialized_event."payload"->>'operation' IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR materialized_event."payload"->>'outputProfile' IS DISTINCT FROM 'ozon-suite-3x4-900x1200/v1'
    OR materialized_event."payload"->>'estimatedCostCents' IS DISTINCT FROM stored_suite."estimated_cost_cents"::TEXT
    OR materialized_event."payload"->>'maximumCostCents' IS DISTINCT FROM stored_suite."maximum_cost_cents"::TEXT
    OR COALESCE(materialized_event."payload"->>'requestFingerprint', '') !~ '^[a-f0-9]{64}$'
    OR COALESCE(materialized_event."payload"->>'materializationHash', '') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(materialized_event."payload"->'children') IS DISTINCT FROM 'array'
    OR jsonb_array_length(materialized_event."payload"->'children') IS DISTINCT FROM stored_suite."item_count"
  THEN
    RAISE EXCEPTION 'AI media suite materialized graph is incomplete' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER
  INTO invalid_slot_count
  FROM "ai_media_suite_slots" slot
  LEFT JOIN "ai_media_workflows" workflow
    ON workflow."id" = slot."child_workflow_id"
   AND workflow."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_media_suite_slot_prompts" slot_prompt
    ON slot_prompt."slot_id" = slot."id"
   AND slot_prompt."suite_id" = slot."suite_id"
   AND slot_prompt."owner_user_id" = slot."owner_user_id"
  WHERE slot."suite_id" = target_suite_id
    AND slot."owner_user_id" = target_owner_user_id
    AND (
      slot."child_workflow_id" IS NULL
      OR slot."status" IS DISTINCT FROM 'PLANNED'
      OR slot."attempt" IS DISTINCT FROM 1
      OR slot."revision" IS DISTINCT FROM 2
      OR workflow."id" IS NULL
      OR workflow."operation" IS DISTINCT FROM 'IMAGE_TO_IMAGE'
      OR workflow."status" IS DISTINCT FROM 'QUEUED'
      OR workflow."review_status" IS DISTINCT FROM 'NOT_READY'
      OR workflow."revision" IS DISTINCT FROM 1
      OR workflow."current_attempt" IS DISTINCT FROM 1
      OR workflow."context_type" IS DISTINCT FROM stored_suite."context_type"
      OR workflow."context_id" IS DISTINCT FROM stored_suite."context_id"
      OR workflow."context_slot_key" IS DISTINCT FROM slot."slot_key"
      OR workflow."actor_user_id" IS NULL
      OR workflow."request_fingerprint" !~ '^[a-f0-9]{64}$'
      OR workflow."selected_output_asset_id" IS NOT NULL
      OR workflow."reviewed_by_user_id" IS NOT NULL
      OR workflow."reviewed_at" IS NOT NULL
      OR workflow."cancel_requested_at" IS NOT NULL
      OR workflow."completed_at" IS NOT NULL
      OR slot_prompt."id" IS NULL
      OR (SELECT count(*)::INTEGER
          FROM "ai_image_jobs" child_job
          WHERE child_job."workflow_id" = workflow."id"
            AND child_job."owner_user_id" = slot."owner_user_id") IS DISTINCT FROM 1
      OR NOT EXISTS (
        SELECT 1
        FROM "ai_image_jobs" child_job
        WHERE child_job."workflow_id" = workflow."id"
          AND child_job."owner_user_id" = slot."owner_user_id"
          AND child_job."workflow_attempt" = 1
          AND child_job."actor_user_id" IS NOT DISTINCT FROM workflow."actor_user_id"
          AND child_job."operation" = 'IMAGE_TO_IMAGE'
          AND child_job."status" = 'PENDING'
          AND child_job."provider" = stored_suite."provider"
          AND child_job."model" = stored_suite."model"
          AND child_job."request_fingerprint" = workflow."request_fingerprint"
          AND child_job."resolved_prompt" = slot_prompt."resolved_prompt"
          AND child_job."resolved_negative_prompt" = slot_prompt."resolved_negative_prompt"
          AND child_job."template_key" = slot_prompt."template_key"
          AND child_job."template_release_id" = slot_prompt."template_release_id"
          AND child_job."template_checksum" = slot_prompt."template_checksum"
          AND child_job."template_snapshot_json" = slot_prompt."template_snapshot_json"
          AND child_job."estimated_cost_cents" = slot."estimated_cost_cents"
          AND child_job."requested_image_count" = 1
          AND child_job."width" = 900
          AND child_job."height" = 1200
          AND child_job."attempt_count" = 0
          AND child_job."max_attempts" = 1
          AND child_job."progress" = 0
          AND child_job."provider_dispatched_at" IS NULL
          AND child_job."provider_job_id" IS NULL
          AND child_job."actual_cost_cents" IS NULL
          AND child_job."billed_units" = 0
          AND child_job."started_at" IS NULL
          AND child_job."completed_at" IS NULL
          AND jsonb_typeof(child_job."operation_config_json") = 'object'
          AND (CASE WHEN wanx_suite THEN child_job."operation_config_json"->>'version' = 'ai-image-suite-child-operation/v2'
            ELSE child_job."operation_config_json"->>'version' = 'ai-image-suite-child-operation/v1'
              OR (
                prompt_set."template_key" = 'image-suite-generation.base'
                AND prompt_set."compiler_version" = 'ai-image-suite-prompt-compiler/v1'
                AND slot."estimated_cost_cents" = slot."maximum_cost_cents"
                AND ai_media_legacy_paid_suite_runtime_valid(child_job."operation"::TEXT, child_job."operation_config_json",
                  child_job."estimated_cost_cents", stored_suite."pricing_version", child_job."input_assets_json",
                  stored_suite."provider", stored_suite."model", stored_suite."provider_config_hash", stored_suite."concurrency_limit")
              ) END)
          AND (NOT wanx_suite OR (
            stored_suite."provider" = 'dashscope-wanx' AND stored_suite."model" = 'wanx2.1-imageedit'
            AND prompt_set."template_key" = 'ai_media_suite_generation_wanx'
            AND prompt_set."compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'
            AND child_job."template_key" = 'ai_media_suite_generation_wanx'
            AND char_length(child_job."resolved_prompt") BETWEEN 1 AND 800
            AND child_job."resolved_negative_prompt" = ''
            AND slot."estimated_cost_cents" = slot."maximum_cost_cents"
            AND ai_media_wanx_suite_runtime_valid(child_job."operation"::TEXT, child_job."operation_config_json",
              child_job."estimated_cost_cents", stored_suite."pricing_version", child_job."input_assets_json")
          ))
          AND child_job."operation_config_json"->>'outputProfile' = 'ozon-suite-3x4-900x1200/v1'
          AND child_job."operation_config_json"->>'width' = '900'
          AND child_job."operation_config_json"->>'height' = '1200'
          AND child_job."operation_config_json"->>'slotPromptId' = slot_prompt."id"
          AND child_job."operation_config_json"->>'promptBindingHash' = slot_prompt."binding_hash"
          AND child_job."operation_config_json"->>'referenceSetHash' = slot_prompt."reference_set_hash"
          AND jsonb_typeof(child_job."input_assets_json") = 'array'
          AND jsonb_array_length(child_job."input_assets_json") = (
            SELECT count(*)::INTEGER
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
          )
          AND (SELECT count(*)::INTEGER
               FROM "ai_cost_reservations" reservation
               WHERE reservation."job_id" = child_job."id"
                 AND reservation."owner_user_id" = slot."owner_user_id") = 1
          AND EXISTS (
            SELECT 1
            FROM "ai_cost_reservations" reservation
            WHERE reservation."job_id" = child_job."id"
              AND reservation."owner_user_id" = slot."owner_user_id"
              AND reservation."workflow_id" = workflow."id"
              AND reservation."actor_user_id" = workflow."actor_user_id"
              AND reservation."request_fingerprint" = workflow."request_fingerprint"
              AND reservation."provider" = stored_suite."provider"
              AND reservation."model" = stored_suite."model"
              AND reservation."operation" = 'IMAGE_TO_IMAGE'
              AND reservation."currency" = CASE WHEN wanx_suite THEN 'CNY' ELSE 'USD' END
              AND reservation."estimated_cost_minor" = slot."estimated_cost_cents"
              AND reservation."maximum_cost_minor" = slot."maximum_cost_cents"
              AND reservation."status" = 'RESERVED'
              AND reservation."provider_request_id" IS NULL
              AND reservation."provider_accepted_at" IS NULL
              AND reservation."reconciliation_required_at" IS NULL
              AND reservation."settled_at" IS NULL
              AND reservation."released_at" IS NULL
          )
          AND (SELECT count(*)::INTEGER
               FROM "ai_media_workflow_inputs" workflow_input
               WHERE workflow_input."workflow_id" = workflow."id"
                 AND workflow_input."owner_user_id" = slot."owner_user_id") =
              CASE
                WHEN jsonb_typeof(slot."references_snapshot_json") = 'array'
                THEN jsonb_array_length(slot."references_snapshot_json")
                ELSE -1
              END
          AND COALESCE((
            SELECT max(workflow_input."ordinal")
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
          ), -1) = (
            SELECT count(*)::INTEGER - 1
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ai_media_workflow_inputs" workflow_input
            WHERE workflow_input."workflow_id" = workflow."id"
              AND workflow_input."owner_user_id" = slot."owner_user_id"
              AND (
                workflow_input."role" IS DISTINCT FROM 'REFERENCE'
                OR NOT EXISTS (
                  SELECT 1
                  FROM "ai_media_suite_reference_assets" suite_reference
                  WHERE suite_reference."suite_id" = slot."suite_id"
                    AND suite_reference."owner_user_id" = slot."owner_user_id"
                    AND suite_reference."asset_id" = workflow_input."asset_id"
                    AND suite_reference."asset_sha256" = workflow_input."asset_sha256"
                    AND suite_reference."asset_url" = workflow_input."asset_url"
                    AND suite_reference."mime_type" = workflow_input."mime_type"
                    AND suite_reference."width" IS NOT DISTINCT FROM workflow_input."width"
                    AND suite_reference."height" IS NOT DISTINCT FROM workflow_input."height"
                    AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(slot."references_snapshot_json") WITH ORDINALITY AS frozen_reference(value, position)
                      WHERE frozen_reference.value->>'candidateId' = suite_reference."candidate_id"
                        AND frozen_reference.position - 1 = workflow_input."ordinal"
                    )
                )
                OR NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(child_job."input_assets_json") AS frozen_input(value)
                  WHERE frozen_input.value->>'assetId' = workflow_input."asset_id"
                    AND frozen_input.value->>'role' = workflow_input."role"::TEXT
                    AND frozen_input.value->>'ordinal' = workflow_input."ordinal"::TEXT
                    AND frozen_input.value->>'sha256' = workflow_input."asset_sha256"
                )
              )
          )
      )
    );

  IF invalid_slot_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite materialized child graph does not match frozen slots' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER
  INTO mismatched_child_count
  FROM jsonb_array_elements(materialized_event."payload"->'children') WITH ORDINALITY AS frozen_child(value, position)
  LEFT JOIN "ai_media_suite_slots" slot
    ON slot."suite_id" = target_suite_id
   AND slot."owner_user_id" = target_owner_user_id
   AND slot."ordinal" = frozen_child.position - 1
  LEFT JOIN "ai_media_workflows" workflow
    ON workflow."id" = slot."child_workflow_id"
   AND workflow."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_image_jobs" child_job
    ON child_job."workflow_id" = workflow."id"
   AND child_job."owner_user_id" = slot."owner_user_id"
   AND child_job."workflow_attempt" = 1
  LEFT JOIN "ai_cost_reservations" reservation
    ON reservation."job_id" = child_job."id"
   AND reservation."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_media_suite_slot_prompts" slot_prompt
    ON slot_prompt."slot_id" = slot."id"
   AND slot_prompt."suite_id" = slot."suite_id"
   AND slot_prompt."owner_user_id" = slot."owner_user_id"
  WHERE jsonb_typeof(frozen_child.value) IS DISTINCT FROM 'object'
    OR slot."id" IS NULL
    OR frozen_child.value->>'ordinal' IS DISTINCT FROM slot."ordinal"::TEXT
    OR frozen_child.value->>'slotId' IS DISTINCT FROM slot."id"
    OR frozen_child.value->>'slotKey' IS DISTINCT FROM slot."slot_key"
    OR frozen_child.value->>'slotPromptId' IS DISTINCT FROM slot_prompt."id"
    OR frozen_child.value->>'childWorkflowId' IS DISTINCT FROM workflow."id"
    OR frozen_child.value->>'jobId' IS DISTINCT FROM child_job."id"
    OR frozen_child.value->>'reservationId' IS DISTINCT FROM reservation."id"
    OR frozen_child.value->>'requestFingerprint' IS DISTINCT FROM workflow."request_fingerprint"
    OR frozen_child.value->>'promptBindingHash' IS DISTINCT FROM slot_prompt."binding_hash"
    OR COALESCE(frozen_child.value->>'bindingHash', '') !~ '^[a-f0-9]{64}$';

  IF mismatched_child_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite materialization event does not match child graph' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_ai_media_suite_execution_graph(
  target_suite_id TEXT,
  target_owner_user_id TEXT
) RETURNS void AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  current_event "ai_media_suite_events"%ROWTYPE;
  planned_count INTEGER;
  queued_count INTEGER;
  running_count INTEGER;
  succeeded_count INTEGER;
  failed_count INTEGER;
  cancel_requested_count INTEGER;
  cancelled_count INTEGER;
  total_count INTEGER;
  active_count INTEGER;
  invalid_count INTEGER;
  wanx_suite BOOLEAN;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = target_suite_id AND "owner_user_id" = target_owner_user_id;
  IF stored_suite."id" IS NULL OR stored_suite."revision" < 5 THEN RETURN; END IF;

  -- A malformed Wanx price must fail here, never select the legacy branch.
  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx'
    OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%', false);

  SELECT * INTO current_event
  FROM "ai_media_suite_events"
  WHERE "suite_id" = target_suite_id
    AND "owner_user_id" = target_owner_user_id
    AND "revision" = stored_suite."revision";
  IF current_event."id" IS NULL
    OR current_event."payload"->>'afterStatus' IS DISTINCT FROM stored_suite."status"::TEXT
  THEN
    RAISE EXCEPTION 'AI media suite execution revision lacks its aggregate event' USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*) FILTER (WHERE "status" = 'PLANNED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'QUEUED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'RUNNING')::INTEGER,
    count(*) FILTER (WHERE "status" = 'SUCCEEDED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'FAILED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'CANCEL_REQUESTED')::INTEGER,
    count(*) FILTER (WHERE "status" = 'CANCELLED')::INTEGER,
    count(*)::INTEGER
  INTO planned_count, queued_count, running_count, succeeded_count, failed_count,
    cancel_requested_count, cancelled_count, total_count
  FROM "ai_media_suite_slots"
  WHERE "suite_id" = target_suite_id AND "owner_user_id" = target_owner_user_id;
  active_count := queued_count + running_count + cancel_requested_count;

  IF total_count IS DISTINCT FROM stored_suite."item_count"
    OR active_count > stored_suite."concurrency_limit"
    OR current_event."payload"#>>'{counts,planned}' IS DISTINCT FROM planned_count::TEXT
    OR current_event."payload"#>>'{counts,queued}' IS DISTINCT FROM queued_count::TEXT
    OR current_event."payload"#>>'{counts,running}' IS DISTINCT FROM running_count::TEXT
    OR current_event."payload"#>>'{counts,succeeded}' IS DISTINCT FROM succeeded_count::TEXT
    OR current_event."payload"#>>'{counts,failed}' IS DISTINCT FROM failed_count::TEXT
    OR current_event."payload"#>>'{counts,cancelRequested}' IS DISTINCT FROM cancel_requested_count::TEXT
    OR current_event."payload"#>>'{counts,cancelled}' IS DISTINCT FROM cancelled_count::TEXT
    OR current_event."payload"#>>'{counts,total}' IS DISTINCT FROM total_count::TEXT
    OR current_event."payload"#>>'{counts,active}' IS DISTINCT FROM active_count::TEXT
  THEN
    RAISE EXCEPTION 'AI media suite aggregate or concurrency limit is invalid' USING ERRCODE = '23514';
  END IF;

  IF (stored_suite."status" = 'QUEUED' AND (queued_count = 0 OR running_count <> 0))
    OR (stored_suite."status" = 'RUNNING' AND running_count = 0)
    OR (stored_suite."status" = 'SUCCEEDED' AND succeeded_count <> total_count)
    OR (stored_suite."status" = 'FAILED' AND (
      planned_count + queued_count + running_count + cancel_requested_count + succeeded_count + cancelled_count <> 0
      OR failed_count = 0
    ))
    OR (stored_suite."status" = 'PARTIAL_FAILURE' AND (
      planned_count + queued_count + running_count + cancel_requested_count + cancelled_count <> 0
      OR succeeded_count = 0 OR failed_count = 0
    ))
    OR (stored_suite."status" = 'CANCEL_REQUESTED' AND cancel_requested_count = 0)
    OR (stored_suite."status" = 'CANCELLED' AND (
      planned_count + queued_count + running_count + cancel_requested_count <> 0
      OR cancelled_count = 0
    ))
  THEN
    RAISE EXCEPTION 'AI media suite parent status does not match slot aggregate' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::INTEGER INTO invalid_count
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_workflows" workflow
    ON workflow."id" = slot."child_workflow_id" AND workflow."owner_user_id" = slot."owner_user_id"
  LEFT JOIN "ai_image_jobs" current_job
    ON current_job."workflow_id" = workflow."id"
   AND current_job."owner_user_id" = workflow."owner_user_id"
   AND current_job."workflow_attempt" = slot."attempt"
  LEFT JOIN "ai_cost_reservations" current_reservation
    ON current_reservation."job_id" = current_job."id"
   AND current_reservation."owner_user_id" = current_job."owner_user_id"
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE asset."kind" = 'AI_PROVIDER_OUTPUT')::INTEGER AS raw_count,
      count(*) FILTER (WHERE asset."kind" = 'AI_GENERATED')::INTEGER AS final_count,
      count(*) FILTER (WHERE asset."kind" NOT IN ('AI_PROVIDER_OUTPUT', 'AI_GENERATED'))::INTEGER AS other_count
    FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = current_job."id"
      AND asset."owner_user_id" = current_job."owner_user_id"
  ) asset_counts ON TRUE
  LEFT JOIN LATERAL (
    SELECT asset.* FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = current_job."id"
      AND asset."owner_user_id" = current_job."owner_user_id"
      AND asset."kind" = 'AI_PROVIDER_OUTPUT'
    ORDER BY asset."id" LIMIT 1
  ) raw_output ON TRUE
  LEFT JOIN LATERAL (
    SELECT asset.* FROM "media_assets" asset
    WHERE asset."ai_image_job_id" = current_job."id"
      AND asset."owner_user_id" = current_job."owner_user_id"
      AND asset."kind" = 'AI_GENERATED'
    ORDER BY asset."id" LIMIT 1
  ) final_output ON TRUE
  WHERE slot."suite_id" = target_suite_id
    AND slot."owner_user_id" = target_owner_user_id
    AND (
      slot."attempt" < 1
      OR workflow."current_attempt" IS DISTINCT FROM slot."attempt"
      OR current_job."id" IS NULL
      OR current_reservation."id" IS NULL
      OR current_job."actor_user_id" IS DISTINCT FROM current_reservation."actor_user_id"
      OR (slot."execution_claim_token" IS NULL) IS DISTINCT FROM (slot."execution_lease_expires_at" IS NULL)
      OR (slot."execution_claim_token" IS NOT NULL AND slot."execution_claim_token" !~ '^[a-f0-9]{64}$')
      OR (slot."status" IN ('RUNNING', 'CANCEL_REQUESTED') AND (
        slot."execution_claim_token" IS NULL OR slot."execution_lease_expires_at" IS NULL
      ))
      OR (slot."status" NOT IN ('RUNNING', 'CANCEL_REQUESTED') AND (
        slot."execution_claim_token" IS NOT NULL OR slot."execution_lease_expires_at" IS NOT NULL
      ))
      OR current_job."provider" IS DISTINCT FROM stored_suite."provider"
      OR current_job."model" IS DISTINCT FROM stored_suite."model"
      OR current_job."operation" IS DISTINCT FROM 'IMAGE_TO_IMAGE'
      OR (wanx_suite AND (
        stored_suite."provider" = 'dashscope-wanx' AND stored_suite."model" = 'wanx2.1-imageedit'
        AND current_reservation."currency" = 'CNY'
        AND current_job."estimated_cost_cents" = slot."maximum_cost_cents"
        AND current_job."template_key" = 'ai_media_suite_generation_wanx'
        AND char_length(current_job."resolved_prompt") BETWEEN 1 AND 800
        AND current_job."resolved_negative_prompt" = ''
        AND ai_media_wanx_suite_runtime_valid(current_job."operation"::TEXT, current_job."operation_config_json",
          current_job."estimated_cost_cents", stored_suite."pricing_version", current_job."input_assets_json")
        AND EXISTS (SELECT 1 FROM "ai_media_suite_slot_prompts" frozen_prompt
          JOIN "ai_media_suite_prompt_sets" frozen_set ON frozen_set."id" = frozen_prompt."prompt_set_id"
            AND frozen_set."suite_id" = slot."suite_id" AND frozen_set."owner_user_id" = slot."owner_user_id"
          WHERE frozen_prompt."slot_id" = slot."id" AND frozen_prompt."suite_id" = slot."suite_id"
            AND frozen_prompt."owner_user_id" = slot."owner_user_id"
            AND frozen_set."provider" = stored_suite."provider" AND frozen_set."model" = stored_suite."model"
            AND frozen_set."compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'
            AND frozen_prompt."template_key" = current_job."template_key"
            AND frozen_prompt."resolved_prompt" = current_job."resolved_prompt"
            AND frozen_prompt."resolved_negative_prompt" = current_job."resolved_negative_prompt"
            AND current_job."operation_config_json"->>'slotPromptId' = frozen_prompt."id"
            AND current_job."operation_config_json"->>'promptBindingHash' = frozen_prompt."binding_hash"
        )
      ) IS DISTINCT FROM TRUE)
      OR current_job."applied_mode" IS NOT NULL
      OR current_job."apply_target_type" IS NOT NULL
      OR current_job."apply_target_id" IS NOT NULL
      OR current_job."applied_at" IS NOT NULL
      OR current_reservation."workflow_id" IS DISTINCT FROM workflow."id"
      OR current_reservation."request_fingerprint" IS DISTINCT FROM current_job."request_fingerprint"
      OR current_reservation."provider" IS DISTINCT FROM current_job."provider"
      OR current_reservation."model" IS DISTINCT FROM current_job."model"
      OR current_reservation."operation" IS DISTINCT FROM current_job."operation"
      OR current_reservation."estimated_cost_minor" IS DISTINCT FROM slot."estimated_cost_cents"
      OR current_reservation."maximum_cost_minor" IS DISTINCT FROM slot."maximum_cost_cents"
      OR current_job."billed_units" NOT IN (0, 1)
      OR (current_job."billed_units" = 0 AND current_job."actual_cost_cents" IS NOT NULL)
      OR (current_job."billed_units" = 1 AND current_job."actual_cost_cents" IS DISTINCT FROM current_job."estimated_cost_cents")
      OR asset_counts.raw_count > 1 OR asset_counts.final_count > 1 OR asset_counts.other_count <> 0
      OR (asset_counts.raw_count = 1 AND (
        stored_suite."provider" = 'fake'
        OR current_job."provider_dispatched_at" IS NULL
        OR current_job."actual_cost_cents" IS DISTINCT FROM current_job."estimated_cost_cents"
        OR current_job."billed_units" IS DISTINCT FROM 1
        OR raw_output."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
        OR raw_output."source_media_key" IS NOT NULL OR raw_output."source_url" IS NOT NULL
        OR raw_output."storage_backend" NOT IN ('local', 'oss')
        OR COALESCE(raw_output."storage_key", '') !~ '[^[:space:]]'
        OR raw_output."mime_type" NOT IN ('image/png', 'image/jpeg', 'image/webp')
        OR raw_output."size_bytes" <= 0 OR raw_output."size_bytes" > 20971520
        OR raw_output."width" IS DISTINCT FROM 1024 OR raw_output."height" IS DISTINCT FROM CASE WHEN wanx_suite THEN 1024 ELSE 1536 END
        OR COALESCE(raw_output."sha256", '') !~ '^[a-f0-9]{64}$'
        OR raw_output."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-provider-output/v1'
        OR raw_output."metadata"->>'sourceCaptureSnapshotId' IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
        OR raw_output."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'
        OR COALESCE(raw_output."metadata"->>'normalizedSha256', '') !~ '^[a-f0-9]{64}$'
        OR COALESCE(raw_output."metadata"->>'actualCostCents', '') !~ '^[0-9]+$'
        OR (raw_output."metadata"->>'actualCostCents')::BIGINT IS DISTINCT FROM current_job."actual_cost_cents"::BIGINT
        OR COALESCE(raw_output."metadata"->>'providerResultReceivedAt', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
        OR (current_job."provider_job_id" IS NULL AND jsonb_typeof(raw_output."metadata"->'providerJobId') IS DISTINCT FROM 'null')
        OR (current_job."provider_job_id" IS NOT NULL AND raw_output."metadata"->>'providerJobId' IS DISTINCT FROM current_job."provider_job_id")
      ))
      OR (asset_counts.final_count = 1 AND (
        final_output."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
        OR final_output."source_media_key" IS NOT NULL OR final_output."source_url" IS NOT NULL
        OR final_output."storage_backend" NOT IN ('local', 'oss')
        OR COALESCE(final_output."storage_key", '') !~ '[^[:space:]]'
        OR final_output."mime_type" IS DISTINCT FROM 'image/png'
        OR final_output."size_bytes" <= 0 OR final_output."size_bytes" > 20971520
        OR final_output."width" IS DISTINCT FROM 900 OR final_output."height" IS DISTINCT FROM 1200
        OR COALESCE(final_output."sha256", '') !~ '^[a-f0-9]{64}$'
        OR final_output."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-output/v1'
        OR (stored_suite."provider" = 'fake' AND final_output."metadata" ? 'providerOutputAssetId')
        OR (stored_suite."provider" <> 'fake' AND (
          asset_counts.raw_count <> 1
          OR final_output."metadata"->>'sourceCaptureSnapshotId' IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
          OR final_output."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'
          OR final_output."metadata"->>'providerOutputAssetId' IS DISTINCT FROM raw_output."id"
          OR final_output."sha256" IS DISTINCT FROM raw_output."metadata"->>'normalizedSha256'
          OR final_output."metadata"->>'normalizerVersion' IS DISTINCT FROM raw_output."metadata"->>'normalizerVersion'
        ))
      ))
      OR (SELECT count(*)::INTEGER FROM "ai_image_jobs" attempt_job
          WHERE attempt_job."workflow_id" = workflow."id"
            AND attempt_job."owner_user_id" = workflow."owner_user_id") IS DISTINCT FROM slot."attempt"
      OR EXISTS (
        SELECT 1
        FROM "ai_image_jobs" attempt_job
        JOIN "ai_image_jobs" frozen_job
          ON frozen_job."workflow_id" = workflow."id"
         AND frozen_job."owner_user_id" = workflow."owner_user_id"
         AND frozen_job."workflow_attempt" = 1
        WHERE attempt_job."workflow_id" = workflow."id"
          AND attempt_job."owner_user_id" = workflow."owner_user_id"
          AND ROW(
            attempt_job."operation", attempt_job."provider", attempt_job."model",
            attempt_job."prompt", attempt_job."negative_prompt",
            attempt_job."resolved_prompt", attempt_job."resolved_negative_prompt",
            attempt_job."template_key", attempt_job."template_release_id",
            attempt_job."template_checksum", attempt_job."template_snapshot_json",
            attempt_job."request_fingerprint", attempt_job."input_assets_json",
            attempt_job."operation_config_json", attempt_job."requested_image_count",
            attempt_job."width", attempt_job."height", attempt_job."max_attempts",
            attempt_job."estimated_cost_cents"
          ) IS DISTINCT FROM ROW(
            frozen_job."operation", frozen_job."provider", frozen_job."model",
            frozen_job."prompt", frozen_job."negative_prompt",
            frozen_job."resolved_prompt", frozen_job."resolved_negative_prompt",
            frozen_job."template_key", frozen_job."template_release_id",
            frozen_job."template_checksum", frozen_job."template_snapshot_json",
            frozen_job."request_fingerprint", frozen_job."input_assets_json",
            frozen_job."operation_config_json", frozen_job."requested_image_count",
            frozen_job."width", frozen_job."height", frozen_job."max_attempts",
            frozen_job."estimated_cost_cents"
          )
      )
      OR EXISTS (
        SELECT 1
        FROM "ai_image_jobs" old_job
        LEFT JOIN "ai_cost_reservations" old_reservation
          ON old_reservation."job_id" = old_job."id"
         AND old_reservation."owner_user_id" = old_job."owner_user_id"
        WHERE old_job."workflow_id" = workflow."id"
          AND old_job."owner_user_id" = workflow."owner_user_id"
          AND old_job."workflow_attempt" < slot."attempt"
          AND (
            old_job."status" <> 'FAILED'
            OR old_job."completed_at" IS NULL
            OR old_job."error_code" IS NULL
            OR old_reservation."id" IS NULL
            OR old_reservation."status" NOT IN ('SETTLED', 'RELEASED')
            OR EXISTS (
              SELECT 1 FROM "media_assets" old_output
              WHERE old_output."ai_image_job_id" = old_job."id"
                AND old_output."kind" NOT IN ('AI_PROVIDER_OUTPUT', 'AI_GENERATED')
            )
            OR (SELECT count(*) FROM "media_assets" old_final
                WHERE old_final."ai_image_job_id" = old_job."id"
                  AND old_final."kind" = 'AI_GENERATED') <> 0
            OR (SELECT count(*) FROM "media_assets" old_raw
                WHERE old_raw."ai_image_job_id" = old_job."id"
                  AND old_raw."kind" = 'AI_PROVIDER_OUTPUT') > 1
            OR (old_reservation."status" = 'RELEASED' AND (
              old_job."actual_cost_cents" IS NOT NULL
              OR old_job."billed_units" <> 0
              OR EXISTS (SELECT 1 FROM "media_assets" old_raw
                WHERE old_raw."ai_image_job_id" = old_job."id" AND old_raw."kind" = 'AI_PROVIDER_OUTPUT')
            ))
            OR (old_reservation."status" = 'SETTLED' AND (
              old_job."provider" = 'fake'
              OR old_job."actual_cost_cents" IS DISTINCT FROM old_job."estimated_cost_cents"
              OR old_job."billed_units" <> 1
            ))
          )
      )
      OR (slot."status" = 'PLANNED' AND (
        current_job."status" <> 'PENDING' OR workflow."status" <> 'QUEUED'
        OR workflow."review_status" <> 'NOT_READY'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 0 OR current_job."progress" <> 0
        OR current_job."started_at" IS NOT NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
        OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL OR asset_counts.raw_count <> 0 OR asset_counts.final_count <> 0
      ))
      OR (slot."status" = 'QUEUED' AND (
        current_job."status" <> 'QUEUED' OR workflow."status" <> 'QUEUED'
        OR workflow."review_status" <> 'NOT_READY'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 0 OR current_job."progress" <> 0
        OR current_job."started_at" IS NOT NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
        OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL OR asset_counts.raw_count <> 0 OR asset_counts.final_count <> 0
      ))
      OR (slot."status" IN ('RUNNING', 'CANCEL_REQUESTED') AND (
        current_job."status" IS DISTINCT FROM slot."status"::TEXT::"AiImageJobStatus"
        OR workflow."status" IS DISTINCT FROM slot."status"::TEXT::"AiMediaWorkflowStatus"
        OR workflow."review_status" <> 'NOT_READY'
        OR current_reservation."status" <> 'RESERVED'
        OR current_job."attempt_count" <> 1 OR current_job."progress" NOT BETWEEN 1 AND 99
        OR current_job."started_at" IS NULL OR current_job."completed_at" IS NOT NULL
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NOT NULL OR asset_counts.final_count <> 0
        OR (stored_suite."provider" = 'fake' AND (
          current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
          OR current_job."actual_cost_cents" IS NOT NULL OR current_job."billed_units" <> 0
          OR asset_counts.raw_count <> 0
        ))
        OR (stored_suite."provider" <> 'fake' AND NOT (
          (current_job."actual_cost_cents" IS NULL AND current_job."billed_units" = 0 AND asset_counts.raw_count = 0)
          OR (current_job."actual_cost_cents" = current_job."estimated_cost_cents"
            AND current_job."billed_units" = 1 AND current_job."provider_dispatched_at" IS NOT NULL)
        ))
      ))
      OR (slot."status" = 'SUCCEEDED' AND (
        current_job."status" <> 'SUCCEEDED' OR workflow."status" <> 'SUCCEEDED'
        OR workflow."review_status" NOT IN ('PENDING', 'APPROVED', 'REJECTED')
        OR current_reservation."status" <> 'SETTLED'
        OR current_job."progress" <> 100 OR current_job."completed_at" IS NULL
        OR current_job."actual_cost_cents" IS DISTINCT FROM current_job."estimated_cost_cents"
        OR current_job."billed_units" <> 1
        OR current_job."error_code" IS NOT NULL OR current_job."error_message" IS NOT NULL
        OR workflow."completed_at" IS NULL OR asset_counts.final_count <> 1
        OR (stored_suite."provider" = 'fake' AND (
          asset_counts.raw_count <> 0
          OR current_job."provider_dispatched_at" IS NOT NULL OR current_job."provider_job_id" IS NOT NULL
        ))
        OR (stored_suite."provider" <> 'fake' AND (
          asset_counts.raw_count <> 1 OR current_job."provider_dispatched_at" IS NULL
        ))
      ))
      OR (slot."status" IN ('FAILED', 'CANCELLED') AND (
        current_job."status" IS DISTINCT FROM slot."status"::TEXT::"AiImageJobStatus"
        OR workflow."status" IS DISTINCT FROM slot."status"::TEXT::"AiMediaWorkflowStatus"
        OR workflow."review_status" <> 'NOT_READY'
        OR current_job."progress" <> 0 OR current_job."completed_at" IS NULL
        OR current_job."error_code" IS NULL OR workflow."completed_at" IS NULL
        OR asset_counts.final_count <> 0
        OR NOT (
          (current_job."actual_cost_cents" IS NULL
            AND current_job."billed_units" = 0
            AND asset_counts.raw_count = 0
            AND current_reservation."status" IN ('RELEASED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'))
          OR (stored_suite."provider" <> 'fake'
            AND current_job."actual_cost_cents" = current_job."estimated_cost_cents"
            AND current_job."billed_units" = 1
            AND current_job."provider_dispatched_at" IS NOT NULL
            AND current_reservation."status" = 'SETTLED')
        )
      ))
    );
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'AI media suite execution child graph is invalid' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_ai_media_suite_child_output_before_dispatch() RETURNS trigger AS $$
DECLARE
  child_job "ai_image_jobs"%ROWTYPE;
  stored_suite "ai_media_suites"%ROWTYPE;
  raw_output "media_assets"%ROWTYPE;
  raw_count INTEGER;
  final_count INTEGER;
  wanx_suite BOOLEAN;
BEGIN
  IF NEW."ai_image_job_id" IS NULL THEN RETURN NEW; END IF;
  SELECT job.* INTO child_job
  FROM "ai_image_jobs" job
  JOIN "ai_media_suite_slots" slot
    ON slot."child_workflow_id" = job."workflow_id" AND slot."owner_user_id" = job."owner_user_id"
  WHERE job."id" = NEW."ai_image_job_id";
  IF child_job."id" IS NULL THEN RETURN NEW; END IF;
  SELECT suite.* INTO stored_suite
  FROM "ai_media_suite_slots" slot
  JOIN "ai_media_suites" suite
    ON suite."id" = slot."suite_id" AND suite."owner_user_id" = slot."owner_user_id"
  WHERE slot."child_workflow_id" = child_job."workflow_id"
    AND slot."owner_user_id" = child_job."owner_user_id";
  IF stored_suite."id" IS NULL THEN RETURN NEW; END IF;
  -- A malformed Wanx price must fail here, never select the legacy branch.
  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx'
    OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%', false);
  IF wanx_suite AND ((
    stored_suite."provider" = 'dashscope-wanx' AND stored_suite."model" = 'wanx2.1-imageedit'
    AND child_job."template_key" = 'ai_media_suite_generation_wanx'
    AND char_length(child_job."resolved_prompt") BETWEEN 1 AND 800
    AND child_job."resolved_negative_prompt" = ''
    AND ai_media_wanx_suite_runtime_valid(child_job."operation"::TEXT, child_job."operation_config_json",
      child_job."estimated_cost_cents", stored_suite."pricing_version", child_job."input_assets_json")
  ) IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Wanx suite output requires its frozen single-reference CNY runtime' USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*) FILTER (WHERE asset."kind" = 'AI_PROVIDER_OUTPUT')::INTEGER,
    count(*) FILTER (WHERE asset."kind" = 'AI_GENERATED')::INTEGER
  INTO raw_count, final_count
  FROM "media_assets" asset
  WHERE asset."ai_image_job_id" = child_job."id";

  IF stored_suite."revision" < 5 THEN
    RAISE EXCEPTION 'AI media suite child output requires the dispatch contract' USING ERRCODE = '23514';
  END IF;

  IF NEW."owner_user_id" IS DISTINCT FROM child_job."owner_user_id"
    OR NEW."source_capture_snapshot_id" IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
    OR NEW."source_media_key" IS NOT NULL OR NEW."source_url" IS NOT NULL
    OR NEW."storage_backend" NOT IN ('local', 'oss')
    OR COALESCE(NEW."storage_key", '') !~ '[^[:space:]]'
    OR COALESCE(NEW."url", '') !~ '[^[:space:]]'
    OR NEW."size_bytes" <= 0 OR NEW."size_bytes" > 20971520
    OR COALESCE(NEW."sha256", '') !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'AI media suite child output identity is invalid' USING ERRCODE = '23514';
  END IF;

  IF NEW."kind" = 'AI_PROVIDER_OUTPUT' THEN
    IF stored_suite."provider" = 'fake'
      OR child_job."status" NOT IN ('RUNNING', 'CANCEL_REQUESTED')
      OR child_job."provider_dispatched_at" IS NULL
      OR child_job."actual_cost_cents" IS DISTINCT FROM child_job."estimated_cost_cents"
      OR child_job."billed_units" IS DISTINCT FROM 1
      OR raw_count >= 1 OR final_count <> 0
      OR NEW."mime_type" NOT IN ('image/png', 'image/jpeg', 'image/webp')
      OR NEW."width" IS DISTINCT FROM 1024 OR NEW."height" IS DISTINCT FROM (CASE WHEN wanx_suite THEN 1024 ELSE 1536 END)
      OR NEW."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-provider-output/v1'
      OR NEW."metadata"->>'sourceCaptureSnapshotId' IS DISTINCT FROM stored_suite."source_capture_snapshot_id"
      OR NEW."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'
      OR COALESCE(NEW."metadata"->>'normalizedSha256', '') !~ '^[a-f0-9]{64}$'
      OR COALESCE(NEW."metadata"->>'actualCostCents', '') !~ '^[0-9]+$'
      OR (NEW."metadata"->>'actualCostCents')::BIGINT IS DISTINCT FROM child_job."actual_cost_cents"::BIGINT
      OR COALESCE(NEW."metadata"->>'providerResultReceivedAt', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$'
      OR (
        child_job."provider_job_id" IS NULL
        AND jsonb_typeof(NEW."metadata"->'providerJobId') IS DISTINCT FROM 'null'
      )
      OR (
        child_job."provider_job_id" IS NOT NULL
        AND NEW."metadata"->>'providerJobId' IS DISTINCT FROM child_job."provider_job_id"
      )
    THEN
      RAISE EXCEPTION 'AI media suite raw Provider output is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."kind" <> 'AI_GENERATED'
    OR child_job."status" <> 'SUCCEEDED'
    OR final_count >= child_job."requested_image_count"
    OR NEW."mime_type" <> 'image/png'
    OR NEW."width" IS DISTINCT FROM 900 OR NEW."height" IS DISTINCT FROM 1200
    OR NEW."metadata"->>'version' IS DISTINCT FROM 'ai-image-suite-output/v1'
  THEN
    RAISE EXCEPTION 'AI media suite final output is invalid' USING ERRCODE = '23514';
  END IF;

  IF stored_suite."provider" = 'fake' THEN
    IF raw_count <> 0 OR NEW."metadata" ? 'providerOutputAssetId' THEN
      RAISE EXCEPTION 'fake AI media suite final output cannot bind Provider evidence' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO raw_output
  FROM "media_assets" asset
  WHERE asset."ai_image_job_id" = child_job."id"
    AND asset."owner_user_id" = child_job."owner_user_id"
    AND asset."kind" = 'AI_PROVIDER_OUTPUT';
  IF raw_count <> 1
    OR raw_output."id" IS NULL
    OR NEW."metadata"->>'providerOutputAssetId' IS DISTINCT FROM raw_output."id"
    OR NEW."sha256" IS DISTINCT FROM raw_output."metadata"->>'normalizedSha256'
    OR NEW."metadata"->>'normalizerVersion' IS DISTINCT FROM raw_output."metadata"->>'normalizerVersion'
  THEN
    RAISE EXCEPTION 'paid AI media suite final output is not bound to its raw Provider output' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_ai_media_suite_materialized_slot_lifecycle() RETURNS trigger AS $$
DECLARE
  stored_suite "ai_media_suites"%ROWTYPE;
  is_materialized BOOLEAN;
BEGIN
  SELECT * INTO stored_suite
  FROM "ai_media_suites"
  WHERE "id" = OLD."suite_id" AND "owner_user_id" = OLD."owner_user_id";
  IF stored_suite."id" IS NULL OR stored_suite."revision" < 4 THEN
    RETURN NEW;
  END IF;

  IF (NEW."execution_claim_token" IS NULL) IS DISTINCT FROM (NEW."execution_lease_expires_at" IS NULL)
    OR (NEW."execution_claim_token" IS NOT NULL AND NEW."execution_claim_token" !~ '^[a-f0-9]{64}$')
  THEN
    RAISE EXCEPTION 'AI media suite slot execution claim is malformed' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" = 'RUNNING' THEN
    IF NEW."execution_claim_token" IS NULL
      OR NEW."execution_lease_expires_at" IS NULL
      OR NEW."execution_lease_expires_at" <= statement_timestamp()
    THEN
      RAISE EXCEPTION 'running AI media suite slot requires a future execution lease' USING ERRCODE = '23514';
    END IF;
    IF OLD."status" = 'RUNNING' AND (
      NEW."execution_claim_token" IS DISTINCT FROM OLD."execution_claim_token"
      OR OLD."execution_lease_expires_at" <= statement_timestamp()
      OR NEW."execution_lease_expires_at" <= OLD."execution_lease_expires_at"
    ) AND NOT ai_media_wanx_suite_lease_takeover_allowed(OLD, NEW) THEN
      RAISE EXCEPTION 'running AI media suite slot lease renewal must preserve a live claim' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."status" = 'CANCEL_REQUESTED' THEN
    IF OLD."status" IN ('RUNNING', 'CANCEL_REQUESTED') AND (
      NEW."execution_claim_token" IS DISTINCT FROM OLD."execution_claim_token"
      OR NEW."execution_lease_expires_at" < OLD."execution_lease_expires_at"
      OR (
        OLD."status" = 'CANCEL_REQUESTED'
        AND OLD."execution_lease_expires_at" <= statement_timestamp()
        AND NEW."execution_lease_expires_at" > OLD."execution_lease_expires_at"
      )
    ) THEN
      RAISE EXCEPTION 'cancel-requested AI media suite slot must preserve its execution claim' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."execution_claim_token" IS NOT NULL OR NEW."execution_lease_expires_at" IS NOT NULL THEN
    RAISE EXCEPTION 'inactive AI media suite slot cannot retain an execution claim' USING ERRCODE = '23514';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM "ai_media_suite_events"
    WHERE "suite_id" = OLD."suite_id" AND "owner_user_id" = OLD."owner_user_id"
      AND "revision" = 4 AND "event_type" = 'CHILDREN_MATERIALIZED'
  ) INTO is_materialized;
  IF stored_suite."revision" = 4 THEN
    IF is_materialized THEN
      IF NOT (
        OLD."status" = 'PLANNED'
        AND NEW."status" = 'CANCELLED'
        AND NEW."attempt" = OLD."attempt"
      ) THEN
        RAISE EXCEPTION 'materialized AI media suite slot lifecycle is parent-controlled until dispatch' USING ERRCODE = '55000';
      END IF;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF OLD."status" IN ('SUCCEEDED', 'CANCELLED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'terminal AI media suite slot cannot transition' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD."status" = 'PLANNED' AND NEW."status" IN ('QUEUED', 'CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'QUEUED' AND NEW."status" IN ('RUNNING', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED'))
    OR (OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" IN ('CANCEL_REQUESTED', 'CANCELLED'))
    OR (OLD."status" = 'FAILED' AND NEW."status" = 'QUEUED')
    OR (OLD."status" = NEW."status")
  ) THEN
    RAISE EXCEPTION 'invalid AI media suite slot state transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."attempt" IS DISTINCT FROM OLD."attempt" THEN
    IF OLD."status" <> 'FAILED' OR NEW."status" <> 'QUEUED' OR NEW."attempt" <> OLD."attempt" + 1 THEN
      RAISE EXCEPTION 'AI media suite slot retry attempt is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" IN ('PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED')
    AND (NEW."error_code" IS NOT NULL OR NEW."error_message" IS NOT NULL)
  THEN
    RAISE EXCEPTION 'non-failed AI media suite slot cannot retain an error' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_ai_media_suite_slot_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI media suite slot cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ai_media_wanx_suite_lease_takeover_allowed(OLD, NEW) THEN RETURN NEW; END IF;
  IF NEW."revision" IS NOT DISTINCT FROM OLD."revision"
    AND OLD."status" IN ('RUNNING', 'CANCEL_REQUESTED')
    AND NEW."status" IS NOT DISTINCT FROM OLD."status"
    AND OLD."execution_claim_token" IS NOT NULL
    AND NEW."execution_claim_token" IS NOT DISTINCT FROM OLD."execution_claim_token"
    AND OLD."execution_lease_expires_at" > statement_timestamp()
    AND NEW."execution_lease_expires_at" > OLD."execution_lease_expires_at"
    AND NEW."updated_at" >= OLD."updated_at"
    AND ROW(
      NEW."id", NEW."suite_id", NEW."owner_user_id", NEW."ordinal", NEW."slot_key",
      NEW."goal", NEW."ownership_level", NEW."ownership_key", NEW."compatibility_group_key",
      NEW."slot_snapshot_json", NEW."slot_hash", NEW."references_snapshot_json",
      NEW."references_hash", NEW."diagnostics_json", NEW."status", NEW."child_workflow_id",
      NEW."attempt", NEW."revision", NEW."execution_claim_token", NEW."estimated_cost_cents",
      NEW."maximum_cost_cents", NEW."error_code", NEW."error_message", NEW."created_at"
    ) IS NOT DISTINCT FROM ROW(
      OLD."id", OLD."suite_id", OLD."owner_user_id", OLD."ordinal", OLD."slot_key",
      OLD."goal", OLD."ownership_level", OLD."ownership_key", OLD."compatibility_group_key",
      OLD."slot_snapshot_json", OLD."slot_hash", OLD."references_snapshot_json",
      OLD."references_hash", OLD."diagnostics_json", OLD."status", OLD."child_workflow_id",
      OLD."attempt", OLD."revision", OLD."execution_claim_token", OLD."estimated_cost_cents",
      OLD."maximum_cost_cents", OLD."error_code", OLD."error_message", OLD."created_at"
    )
  THEN
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."suite_id" IS DISTINCT FROM OLD."suite_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."ordinal" IS DISTINCT FROM OLD."ordinal"
    OR NEW."slot_key" IS DISTINCT FROM OLD."slot_key"
    OR NEW."goal" IS DISTINCT FROM OLD."goal"
    OR NEW."ownership_level" IS DISTINCT FROM OLD."ownership_level"
    OR NEW."ownership_key" IS DISTINCT FROM OLD."ownership_key"
    OR NEW."compatibility_group_key" IS DISTINCT FROM OLD."compatibility_group_key"
    OR NEW."slot_snapshot_json" IS DISTINCT FROM OLD."slot_snapshot_json"
    OR NEW."slot_hash" IS DISTINCT FROM OLD."slot_hash"
    OR NEW."references_snapshot_json" IS DISTINCT FROM OLD."references_snapshot_json"
    OR NEW."references_hash" IS DISTINCT FROM OLD."references_hash"
    OR NEW."estimated_cost_cents" IS DISTINCT FROM OLD."estimated_cost_cents"
    OR NEW."maximum_cost_cents" IS DISTINCT FROM OLD."maximum_cost_cents"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'AI media suite slot identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'AI media suite slot revision must advance by one' USING ERRCODE = '23514';
  END IF;
  IF OLD."child_workflow_id" IS NOT NULL
    AND NEW."child_workflow_id" IS DISTINCT FROM OLD."child_workflow_id"
  THEN
    RAISE EXCEPTION 'AI media suite child workflow cannot be cleared or replaced' USING ERRCODE = '23514';
  END IF;
  IF NEW."attempt" < OLD."attempt" OR NEW."attempt" > OLD."attempt" + 1 THEN
    RAISE EXCEPTION 'AI media suite slot attempt sequence is invalid' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'SUCCEEDED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'successful AI media suite slot is terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Retain every legacy CHECK term; only the paired Wanx compiler/template may merge negative instructions.
ALTER TABLE "ai_media_suite_slot_prompts"
  DROP CONSTRAINT "ai_media_suite_slot_prompt_values_check",
  ADD CONSTRAINT "ai_media_suite_slot_prompt_values_check" CHECK (
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
    AND CASE WHEN "template_key" = 'ai_media_suite_generation_wanx'
      OR "compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'
      THEN "template_key" = 'ai_media_suite_generation_wanx'
        AND "compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'
        AND char_length("resolved_prompt") BETWEEN 1 AND 800
        AND "resolved_negative_prompt" = ''
      ELSE char_length("resolved_negative_prompt") > 0 END
  ) NOT VALID;
ALTER TABLE "ai_media_suite_slot_prompts" VALIDATE CONSTRAINT "ai_media_suite_slot_prompt_values_check";

COMMIT;
