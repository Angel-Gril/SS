BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Forward-only compatibility for the frozen count profile. No row, amount,
-- credential, historical migration or trigger firing contract is rewritten.
-- The TypeScript donor-gpt2-full-frame/v1 owner materializes this exact tuple.
CREATE OR REPLACE FUNCTION ai_media_gpt2_count_suite_runtime_valid(
  request_operation TEXT, operation_config JSONB, expected_cost INTEGER,
  pricing_version TEXT, input_assets JSONB, expected_provider TEXT,
  expected_model TEXT, expected_config_hash TEXT, concurrency_limit INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  runtime JSONB;
  credential JSONB;
  expected_runtime JSONB;
  revision_number NUMERIC;
  updated_at_text TEXT;
  quote_currency TEXT;
  price_contract TEXT;
  expected_pricing TEXT;
  runtime_text TEXT;
  config_text TEXT;
  endpoint_hash CONSTANT TEXT := encode(sha256(convert_to('https://ai.big-model-api.top/v1', 'UTF8')), 'hex');
BEGIN
  IF request_operation IS DISTINCT FROM 'IMAGE_TO_IMAGE'
    OR expected_provider IS DISTINCT FROM 'custom'
    OR expected_model IS DISTINCT FROM 'gpt-image-2-count'
    OR expected_cost IS NULL OR expected_cost < 1
    OR concurrency_limit IS NULL OR concurrency_limit NOT BETWEEN 1 AND 16
    OR expected_config_hash IS NULL OR expected_config_hash !~ '^[a-f0-9]{64}$'
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
  -- Historical count USD/v2 remains replayable. Only count admits CNY/v3;
  -- an arbitrary custom model, endpoint or currency cannot enter this branch.
  IF runtime->>'contractVersion' = 'ai-image-provider-runtime/v2' AND NOT runtime ? 'currency' THEN
    quote_currency := 'USD';
    price_contract := 'ai-image-suite-price/v1';
  ELSIF runtime->>'contractVersion' = 'ai-image-provider-runtime/v3' AND runtime->>'currency' = 'CNY' THEN
    quote_currency := 'CNY';
    price_contract := 'ai-image-suite-price-cny/v1';
  ELSE RETURN false; END IF;
  expected_runtime := jsonb_build_object(
    'contractVersion', runtime->>'contractVersion', 'provider', 'custom', 'model', 'gpt-image-2-count',
    'baseUrlSha256', endpoint_hash, 'unitCostCents', expected_cost, 'imageCount', 1,
    'width', 1008, 'height', 1344, 'maximumCostCents', expected_cost, 'credentialRevision', credential);
  IF quote_currency = 'CNY' THEN
    expected_runtime := expected_runtime || jsonb_build_object('currency', 'CNY');
  END IF;
  IF runtime IS DISTINCT FROM expected_runtime THEN RETURN false; END IF;
  -- Canonical sorted JSON is identical to hashAiMediaPlanningJson, without
  -- a new database extension or a secret/key-derived identity.
  expected_pricing := price_contract || ':' || left(encode(sha256(convert_to(
    '{"currency":' || to_json(quote_currency)::TEXT || ',"model":"gpt-image-2-count","provider":"custom","unitCostCents":'
      || expected_cost::TEXT || ',"version":' || to_json(price_contract)::TEXT || '}', 'UTF8')), 'hex'), 32);
  runtime_text := '{"baseUrlSha256":' || to_json(endpoint_hash)::TEXT
    || ',"contractVersion":' || to_json(runtime->>'contractVersion')::TEXT
    || ',"credentialRevision":{"recordId":' || to_json(credential->>'recordId')::TEXT
    || ',"revision":' || revision_number::BIGINT::TEXT || ',"updatedAt":' || to_json(updated_at_text)::TEXT || '}'
    || CASE WHEN quote_currency = 'CNY' THEN ',"currency":"CNY"' ELSE '' END
    || ',"height":1344,"imageCount":1,"maximumCostCents":' || expected_cost::TEXT
    || ',"model":"gpt-image-2-count","provider":"custom","unitCostCents":' || expected_cost::TEXT || ',"width":1008}';
  config_text := '{"concurrencyLimit":' || concurrency_limit::TEXT
    || ',"finalOutput":{"background":"#ffffff","fit":"full-frame","format":"png","height":1200,"normalizerVersion":"ai-image-donor-gpt2-output-normalizer/v1","profile":"ozon-suite-3x4-900x1200/v1","width":900},"providerRuntime":'
    || runtime_text || ',"version":"ai-image-suite-provider-runtime/v1"}';
  RETURN COALESCE(
    pricing_version = expected_pricing
    AND expected_config_hash = encode(sha256(convert_to(config_text, 'UTF8')), 'hex')
    AND operation_config->>'version' = 'ai-image-suite-child-operation/v2'
    AND operation_config->>'outputProfile' = 'ozon-suite-3x4-900x1200/v1'
    AND operation_config->'width' = '900'::JSONB AND operation_config->'height' = '1200'::JSONB
    AND operation_config->>'requestProfile' = 'DONOR_GPT_IMAGE_2_PORTRAIT_EDIT_V1'
    AND NOT operation_config ? 'referenceCanvas'
    AND operation_config->'providerRequest' = '{"count":1,"width":1008,"height":1344,"quality":"high"}'::JSONB
    AND operation_config->'finalOutput' = '{"profile":"ozon-suite-3x4-900x1200/v1","width":900,"height":1200,"fit":"full-frame","background":"#ffffff","format":"png","normalizerVersion":"ai-image-donor-gpt2-output-normalizer/v1"}'::JSONB
    AND jsonb_typeof(input_assets->0->'assetId') = 'string'
    AND char_length(input_assets->0->>'assetId') BETWEEN 1 AND 200
    AND input_assets->0->>'role' = 'REFERENCE' AND input_assets->0->'ordinal' = '0'::JSONB
    AND COALESCE(input_assets->0->>'sha256', '') ~ '^[a-f0-9]{64}$'
  , false);
EXCEPTION WHEN data_exception THEN RETURN false;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;

-- Preserve the existing graph/ownership/settlement functions and change only
-- the explicit frozen-profile seams. Unexpected source drift aborts atomically.
CREATE FUNCTION pg_temp.patch_ai_media_suite_guard(
  signature TEXT, original_fragment TEXT, replacement_fragment TEXT, expected_occurrences INTEGER
) RETURNS void AS $$
DECLARE
  function_definition TEXT;
BEGIN
  SELECT replace(pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n') INTO function_definition;
  IF function_definition IS NULL OR original_fragment = '' OR expected_occurrences < 1
    OR (length(function_definition) - length(replace(function_definition, original_fragment, '')))
      <> length(original_fragment) * expected_occurrences
  THEN RAISE EXCEPTION 'unexpected frozen-profile guard definition: %', signature; END IF;
  EXECUTE replace(function_definition, original_fragment, replacement_fragment);
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.patch_ai_media_suite_guard(
  'validate_ai_media_suite_prompt_set_insert()',
  $old$(NEW."compiler_version" = 'ai-image-suite-prompt-compiler/v1'
        AND NEW."template_key" = 'image-suite-generation.base')$old$,
  $new$(NEW."compiler_version" = 'ai-image-suite-prompt-compiler/v1'
        AND NEW."template_key" = 'image-suite-generation.base'
        AND NOT (NEW."provider" = 'custom' AND NEW."model" = 'gpt-image-2-count'))
      OR (NEW."compiler_version" = 'ai-image-suite-prompt-compiler-gpt2/v1'
        AND NEW."template_key" = 'image-suite-generation.base'
        AND NEW."provider" = 'custom' AND NEW."model" = 'gpt-image-2-count'
        AND stored_suite."pricing_version" ~ '^ai-image-suite-price(-cny)?/v1:[a-f0-9]{32}$'
        AND stored_suite."estimated_cost_cents" = stored_suite."maximum_cost_cents"
        AND (SELECT count(*) FROM "ai_media_suite_slots" slot
          WHERE slot."suite_id" = NEW."suite_id" AND slot."owner_user_id" = NEW."owner_user_id") = NEW."slot_count"
        AND NOT EXISTS (SELECT 1 FROM "ai_media_suite_slots" slot
          WHERE slot."suite_id" = NEW."suite_id" AND slot."owner_user_id" = NEW."owner_user_id"
            AND CASE WHEN jsonb_typeof(slot."references_snapshot_json") = 'array'
              THEN jsonb_array_length(slot."references_snapshot_json") <> 1 ELSE true END))$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'validate_ai_media_suite_prompt_set_insert()',
  $old$NEW."compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'$old$,
  $new$NEW."compiler_version" IN ('ai-image-suite-prompt-compiler-wanx/v1', 'ai-image-suite-prompt-compiler-wanx/v2')$new$, 2);
SELECT pg_temp.patch_ai_media_suite_guard(
  'validate_ai_media_suite_prompt_set_insert()',
  $old$OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%'$old$,
  $new$OR (stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%'
        AND NOT (stored_suite."provider" = 'custom' AND stored_suite."model" = 'gpt-image-2-count'))$new$, 1);

SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_materialized_graph(text,text)',
  $old$  wanx_suite BOOLEAN;$old$,
  $new$  wanx_suite BOOLEAN;
  donor_suite BOOLEAN;$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_materialized_graph(text,text)',
  $old$  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx'
    OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%', false);$old$,
  $new$  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx', false);
  donor_suite := COALESCE(stored_suite."provider" = 'custom' AND stored_suite."model" = 'gpt-image-2-count', false);
  IF stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%' AND NOT (wanx_suite OR donor_suite) THEN
    RAISE EXCEPTION 'unsupported CNY suite Provider/model' USING ERRCODE = '23514';
  END IF;$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_materialized_graph(text,text)',
  $old$AND (CASE WHEN wanx_suite THEN$old$,
  $new$AND (CASE WHEN donor_suite THEN (
            prompt_set."template_key" = 'image-suite-generation.base'
            AND prompt_set."compiler_version" = 'ai-image-suite-prompt-compiler-gpt2/v1'
            AND slot."estimated_cost_cents" = slot."maximum_cost_cents"
            AND ai_media_gpt2_count_suite_runtime_valid(child_job."operation"::TEXT, child_job."operation_config_json",
              child_job."estimated_cost_cents", stored_suite."pricing_version", child_job."input_assets_json",
              stored_suite."provider", stored_suite."model", stored_suite."provider_config_hash", stored_suite."concurrency_limit")
          ) WHEN wanx_suite THEN$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_materialized_graph(text,text)',
  $old$prompt_set."compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'$old$,
  $new$prompt_set."compiler_version" IN ('ai-image-suite-prompt-compiler-wanx/v1', 'ai-image-suite-prompt-compiler-wanx/v2')$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_materialized_graph(text,text)',
  $old$CASE WHEN wanx_suite THEN 'CNY' ELSE 'USD' END$old$,
  $new$CASE WHEN wanx_suite OR (donor_suite AND stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/v1:%') THEN 'CNY' ELSE 'USD' END$new$, 1);

SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_execution_graph(text,text)',
  $old$  wanx_suite BOOLEAN;$old$,
  $new$  wanx_suite BOOLEAN;
  donor_suite BOOLEAN;$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_execution_graph(text,text)',
  $old$  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx'
    OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%', false);$old$,
  $new$  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx', false);
  donor_suite := COALESCE(stored_suite."provider" = 'custom' AND stored_suite."model" = 'gpt-image-2-count', false);
  IF stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%' AND NOT (wanx_suite OR donor_suite) THEN
    RAISE EXCEPTION 'unsupported CNY suite Provider/model' USING ERRCODE = '23514';
  END IF;$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_execution_graph(text,text)',
  $old$frozen_set."compiler_version" = 'ai-image-suite-prompt-compiler-wanx/v1'$old$,
  $new$frozen_set."compiler_version" IN ('ai-image-suite-prompt-compiler-wanx/v1', 'ai-image-suite-prompt-compiler-wanx/v2')$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_execution_graph(text,text)',
  $old$      OR current_job."applied_mode" IS NOT NULL$old$,
  $new$      OR (donor_suite AND (
        current_reservation."currency" = CASE WHEN stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/v1:%' THEN 'CNY' ELSE 'USD' END
        AND current_job."estimated_cost_cents" = slot."maximum_cost_cents"
        AND current_job."template_key" = 'image-suite-generation.base'
        AND ai_media_gpt2_count_suite_runtime_valid(current_job."operation"::TEXT, current_job."operation_config_json",
          current_job."estimated_cost_cents", stored_suite."pricing_version", current_job."input_assets_json",
          stored_suite."provider", stored_suite."model", stored_suite."provider_config_hash", stored_suite."concurrency_limit")
        AND EXISTS (SELECT 1 FROM "ai_media_suite_slot_prompts" frozen_prompt
          JOIN "ai_media_suite_prompt_sets" frozen_set ON frozen_set."id" = frozen_prompt."prompt_set_id"
            AND frozen_set."suite_id" = slot."suite_id" AND frozen_set."owner_user_id" = slot."owner_user_id"
          WHERE frozen_prompt."slot_id" = slot."id" AND frozen_prompt."suite_id" = slot."suite_id"
            AND frozen_prompt."owner_user_id" = slot."owner_user_id"
            AND frozen_set."provider" = stored_suite."provider" AND frozen_set."model" = stored_suite."model"
            AND frozen_set."compiler_version" = 'ai-image-suite-prompt-compiler-gpt2/v1'
            AND frozen_prompt."template_key" = current_job."template_key"
            AND frozen_prompt."resolved_prompt" = current_job."resolved_prompt"
            AND frozen_prompt."resolved_negative_prompt" = current_job."resolved_negative_prompt"
            AND current_job."operation_config_json"->>'slotPromptId' = frozen_prompt."id"
            AND current_job."operation_config_json"->>'promptBindingHash' = frozen_prompt."binding_hash"
        )
      ) IS DISTINCT FROM TRUE)
      OR current_job."applied_mode" IS NOT NULL$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_execution_graph(text,text)',
  $old$NOT (CASE WHEN wanx_suite THEN
          (raw_output."width",raw_output."height") IN ((1024,1024),(1024,1536),(880,880),(800,800))
          ELSE raw_output."width"=1024 AND raw_output."height"=1536 END)$old$,
  $new$NOT (CASE WHEN donor_suite THEN raw_output."width"=1008 AND raw_output."height"=1344
          WHEN wanx_suite THEN
          (raw_output."width",raw_output."height") IN ((1024,1024),(1024,1536),(880,880),(800,800))
          ELSE raw_output."width"=1024 AND raw_output."height"=1536 END)$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_execution_graph(text,text)',
  $old$raw_output."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'$old$,
  $new$raw_output."metadata"->>'normalizerVersion' IS DISTINCT FROM (CASE WHEN donor_suite THEN 'ai-image-donor-gpt2-output-normalizer/v1' ELSE 'ai-image-suite-output-normalizer/v1' END)$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'assert_ai_media_suite_execution_graph(text,text)',
  $old$final_output."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'$old$,
  $new$final_output."metadata"->>'normalizerVersion' IS DISTINCT FROM (CASE WHEN donor_suite THEN 'ai-image-donor-gpt2-output-normalizer/v1' ELSE 'ai-image-suite-output-normalizer/v1' END)$new$, 1);

SELECT pg_temp.patch_ai_media_suite_guard(
  'prevent_ai_media_suite_child_output_before_dispatch()',
  $old$  wanx_suite BOOLEAN;$old$,
  $new$  wanx_suite BOOLEAN;
  donor_suite BOOLEAN;$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'prevent_ai_media_suite_child_output_before_dispatch()',
  $old$  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx'
    OR stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%', false);$old$,
  $new$  wanx_suite := COALESCE(stored_suite."provider" = 'dashscope-wanx', false);
  donor_suite := COALESCE(stored_suite."provider" = 'custom' AND stored_suite."model" = 'gpt-image-2-count', false);
  IF stored_suite."pricing_version" LIKE 'ai-image-suite-price-cny/%' AND NOT (wanx_suite OR donor_suite) THEN
    RAISE EXCEPTION 'unsupported CNY suite Provider/model' USING ERRCODE = '23514';
  END IF;$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'prevent_ai_media_suite_child_output_before_dispatch()',
  $old$  SELECT
    count(*) FILTER (WHERE asset."kind" = 'AI_PROVIDER_OUTPUT')::INTEGER,$old$,
  $new$  IF donor_suite AND ((
    child_job."template_key" = 'image-suite-generation.base'
    AND ai_media_gpt2_count_suite_runtime_valid(child_job."operation"::TEXT, child_job."operation_config_json",
      child_job."estimated_cost_cents", stored_suite."pricing_version", child_job."input_assets_json",
      stored_suite."provider", stored_suite."model", stored_suite."provider_config_hash", stored_suite."concurrency_limit")
    AND EXISTS (SELECT 1 FROM "ai_media_suite_slot_prompts" frozen_prompt
      JOIN "ai_media_suite_prompt_sets" frozen_set ON frozen_set."id" = frozen_prompt."prompt_set_id"
        AND frozen_set."suite_id" = stored_suite."id" AND frozen_set."owner_user_id" = stored_suite."owner_user_id"
      WHERE frozen_prompt."id" = child_job."operation_config_json"->>'slotPromptId'
        AND frozen_prompt."owner_user_id" = child_job."owner_user_id"
        AND frozen_set."compiler_version" = 'ai-image-suite-prompt-compiler-gpt2/v1'
        AND frozen_set."provider" = stored_suite."provider" AND frozen_set."model" = stored_suite."model"
        AND frozen_prompt."template_key" = child_job."template_key"
        AND frozen_prompt."resolved_prompt" = child_job."resolved_prompt"
        AND frozen_prompt."resolved_negative_prompt" = child_job."resolved_negative_prompt"
        AND frozen_prompt."binding_hash" = child_job."operation_config_json"->>'promptBindingHash'
    )
  ) IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'count suite output requires its frozen portrait runtime' USING ERRCODE = '23514';
  END IF;
  SELECT
    count(*) FILTER (WHERE asset."kind" = 'AI_PROVIDER_OUTPUT')::INTEGER,$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'prevent_ai_media_suite_child_output_before_dispatch()',
  $old$NOT (CASE WHEN wanx_suite THEN
        (NEW."width",NEW."height") IN ((1024,1024),(1024,1536),(880,880),(800,800))
        ELSE NEW."width"=1024 AND NEW."height"=1536 END)$old$,
  $new$NOT (CASE WHEN donor_suite THEN NEW."width"=1008 AND NEW."height"=1344
        WHEN wanx_suite THEN
        (NEW."width",NEW."height") IN ((1024,1024),(1024,1536),(880,880),(800,800))
        ELSE NEW."width"=1024 AND NEW."height"=1536 END)$new$, 1);
SELECT pg_temp.patch_ai_media_suite_guard(
  'prevent_ai_media_suite_child_output_before_dispatch()',
  $old$NEW."metadata"->>'normalizerVersion' IS DISTINCT FROM 'ai-image-suite-output-normalizer/v1'$old$,
  $new$NEW."metadata"->>'normalizerVersion' IS DISTINCT FROM (CASE WHEN donor_suite THEN 'ai-image-donor-gpt2-output-normalizer/v1' ELSE 'ai-image-suite-output-normalizer/v1' END)$new$, 1);

-- Retain the full existing value/hash CHECK. Only the paired Wanx v1/v2
-- compiler/template may merge negative instructions into the 800-char prompt.
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
      OR "compiler_version" IN ('ai-image-suite-prompt-compiler-wanx/v1', 'ai-image-suite-prompt-compiler-wanx/v2')
      THEN "template_key" = 'ai_media_suite_generation_wanx'
        AND "compiler_version" IN ('ai-image-suite-prompt-compiler-wanx/v1', 'ai-image-suite-prompt-compiler-wanx/v2')
        AND char_length("resolved_prompt") BETWEEN 1 AND 800
        AND "resolved_negative_prompt" = ''
      ELSE char_length("resolved_negative_prompt") > 0 END
  ) NOT VALID;
ALTER TABLE "ai_media_suite_slot_prompts" VALIDATE CONSTRAINT "ai_media_suite_slot_prompt_values_check";

COMMIT;
