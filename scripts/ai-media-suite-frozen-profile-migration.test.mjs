import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const previous = readFileSync('apps/server/prisma/migrations/20260916110000_enable_wanx_reference_image_suites/migration.sql', 'utf8').replace(/\r\n/gu, '\n');
const recovery = readFileSync('apps/server/prisma/migrations/20261004120000_recover_original_wanx_suite_tasks/migration.sql', 'utf8').replace(/\r\n/gu, '\n');
const migration = readFileSync('apps/server/prisma/migrations/20261008120000_admit_frozen_gpt2_suite_profiles/migration.sql', 'utf8').replace(/\r\n/gu, '\n');
assert.match(migration.trim(), /^BEGIN;[\s\S]*COMMIT;$/u);
assert.match(migration, /pg_get_functiondef[\s\S]*unexpected frozen-profile guard definition/u);
assert.doesNotMatch(migration, /DISABLE TRIGGER|UPDATE "ai_|DELETE FROM|DROP FUNCTION/iu);
const patched = new Map();
const baseline = new Map();
for (const [, source, name] of previous.matchAll(/(CREATE OR REPLACE FUNCTION (\w+)\([\s\S]*?\$\$ LANGUAGE plpgsql[^;]*;)/gu)) {
  baseline.set(name, source);
}
// The recovery migration changes functions via pg_get_functiondef, so a search
// for the latest CREATE FUNCTION alone is insufficient to find the true owner.
for (const [, signature, body] of recovery.matchAll(/SELECT pg_get_functiondef\('([^']+)'::regprocedure\) INTO definition;([\s\S]*?)(?=SELECT pg_get_functiondef|END;)/gu)) {
  const name = signature.slice(0, signature.indexOf('('));
  if (!baseline.has(name)) continue;
  const before = body.match(/old_term := \$term\$([\s\S]*?)\$term\$;/u)?.[1];
  const replacement = body.match(/new_term := (old_term \|\| )?\$term\$([\s\S]*?)\$term\$;/u);
  assert.ok(before && replacement, `recovery ${name} must have an explicit audited patch`);
  const source = baseline.get(name);
  assert.equal(source.split(before).length - 1, 1, `recovery ${name} original seam must bind once`);
  baseline.set(name, source.split(before).join((replacement[1] ? before : '') + replacement[2]));
}
const patchPattern = /SELECT pg_temp\.patch_ai_media_suite_guard\(\s*'([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*(\d+)\s*\);/gu;
for (const [, signature, before, after, countText] of migration.matchAll(patchPattern)) {
  const name = signature.slice(0, signature.indexOf('('));
  const original = baseline.get(name);
  assert.ok(original, `existing guard ${name} must be inherited`);
  const source = patched.get(name) ?? original;
  assert.equal(source.split(before).length - 1, Number(countText), `patch ${name} must bind exact expected occurrences`);
  patched.set(name, source.split(before).join(after));
}
assert.deepEqual([...patched.keys()].sort(), [
  'assert_ai_media_suite_execution_graph', 'assert_ai_media_suite_materialized_graph',
  'prevent_ai_media_suite_child_output_before_dispatch', 'validate_ai_media_suite_prompt_set_insert',
]);
for (const name of ['assert_ai_media_suite_materialized_graph', 'assert_ai_media_suite_execution_graph', 'prevent_ai_media_suite_child_output_before_dispatch']) {
  const source = patched.get(name);
  assert.match(source, /donor_suite BOOLEAN/u);
  assert.match(source, /ai_media_gpt2_count_suite_runtime_valid/u);
  assert.match(source, /unsupported CNY suite Provider\/model/u);
  assert.doesNotMatch(source, /wanx_suite :=[^;]*pricing_version/u, `${name}: CNY must not identify Wanx`);
}
for (const name of ['validate_ai_media_suite_prompt_set_insert', 'assert_ai_media_suite_materialized_graph', 'assert_ai_media_suite_execution_graph']) {
  assert.match(patched.get(name), /ai-image-suite-prompt-compiler-wanx\/v1/u);
  assert.match(patched.get(name), /ai-image-suite-prompt-compiler-wanx\/v2/u);
  assert.match(patched.get(name), /ai-image-suite-prompt-compiler-gpt2\/v1/u);
}
const materialized = patched.get('assert_ai_media_suite_materialized_graph');
assert.match(materialized, /ai_media_legacy_paid_suite_runtime_valid/u);
for (const invariant of ['child_job."owner_user_id" = slot."owner_user_id"', 'child_job."resolved_prompt" = slot_prompt."resolved_prompt"', 'reservation."maximum_cost_minor" = slot."maximum_cost_cents"', 'suite_reference."asset_sha256" = workflow_input."asset_sha256"']) {
  assert.ok(materialized.includes(invariant), `materialization must retain ${invariant}`);
}
for (const invariant of ['current_job."actor_user_id" IS DISTINCT FROM current_reservation."actor_user_id"', 'current_reservation."maximum_cost_minor" IS DISTINCT FROM slot."maximum_cost_cents"', 'final_output."sha256" IS DISTINCT FROM raw_output."metadata"->>\'normalizedSha256\'']) {
  assert.ok(patched.get('assert_ai_media_suite_execution_graph').includes(invariant), `execution must retain ${invariant}`);
}
for (const value of ['DONOR_GPT_IMAGE_2_PORTRAIT_EDIT_V1', 'ai-image-donor-gpt2-output-normalizer/v1', 'gpt-image-2-count', 'ai-image-provider-runtime/v2', 'ai-image-provider-runtime/v3', '"quality":"high"', '"fit":"full-frame"', 'https://ai.big-model-api.top/v1']) {
  assert.ok(migration.includes(value), `profile guard must contain ${value}`);
}
assert.match(patched.get('prevent_ai_media_suite_child_output_before_dispatch'), /ai_media_suite_original_task_recovery_allowed/u);
for (const name of ['assert_ai_media_suite_execution_graph', 'prevent_ai_media_suite_child_output_before_dispatch']) {
  assert.match(patched.get(name), /\(\(1024,1024\),\(1024,1536\),\(880,880\),\(800,800\)\)/u);
}
assert.match(migration, /expected_config_hash = encode\(sha256\(convert_to\(config_text/u);
assert.match(migration, /runtime IS DISTINCT FROM expected_runtime/u);
assert.match(migration, /jsonb_array_length\(input_assets\) <> 1/u);
assert.match(migration, /VALIDATE CONSTRAINT "ai_media_suite_slot_prompt_values_check"/u);
console.log('PASS frozen suite profile migration: exact patches, Wanx/legacy compatibility and bounded count CNY runtime');
