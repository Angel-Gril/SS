import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL(
  '../../prisma/migrations/20260719120000_add_ai_media_suites/migration.sql',
  import.meta.url,
), 'utf8');
const hardeningMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719121000_harden_ai_media_suite_audit/migration.sql',
  import.meta.url,
), 'utf8');
const failedStatusMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719120500_add_ai_media_suite_failed_status/migration.sql',
  import.meta.url,
), 'utf8');
const authorityMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719121500_validate_ai_media_suite_authority/migration.sql',
  import.meta.url,
), 'utf8');
const referenceAssetsMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719130000_add_ai_media_suite_reference_assets/migration.sql',
  import.meta.url,
), 'utf8');
const promptFreezeMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719140000_add_ai_media_suite_prompt_freeze/migration.sql',
  import.meta.url,
), 'utf8');
const materializationMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719150000_add_ai_media_suite_materialization/migration.sql',
  import.meta.url,
), 'utf8');
const materializationHardeningMigration = readFileSync(new URL(
  '../../prisma/migrations/20260719153000_harden_ai_media_suite_materialization/migration.sql',
  import.meta.url,
), 'utf8');
const materializedSlotProtectionMigration = readFileSync(new URL(
  '../../prisma/migrations/20260720000000_protect_ai_media_suite_materialized_slots/migration.sql',
  import.meta.url,
), 'utf8');
const executionMigration = readFileSync(new URL(
  '../../prisma/migrations/20260720120000_add_ai_media_suite_execution/migration.sql',
  import.meta.url,
), 'utf8');
const planActivityMigration = readFileSync(new URL(
  '../../prisma/migrations/20260720130000_enforce_ai_media_suite_plan_activity/migration.sql',
  import.meta.url,
), 'utf8');
const paidExecutionMigration = readFileSync(new URL(
  '../../prisma/migrations/20260724140000_enable_paid_ai_image_suite_execution/migration.sql',
  import.meta.url,
), 'utf8');
const globalSettlementBudgetIndexMigration = readFileSync(new URL(
  '../../prisma/migrations/20260724141000_index_global_ai_cost_settlements/migration.sql',
  import.meta.url,
), 'utf8');
const globalReservationBudgetIndexMigration = readFileSync(new URL(
  '../../prisma/migrations/20260724142000_index_global_ai_cost_reservations/migration.sql',
  import.meta.url,
), 'utf8');
const materializationMigrations = [
  materializationMigration,
  materializationHardeningMigration,
  materializedSlotProtectionMigration,
].join('\n');
const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

describe('AI image suite migration safety', () => {
  it('adds tenant-bound suite, slot and event tables without changing paid operation enums', () => {
    for (const table of ['ai_media_suites', 'ai_media_suite_slots', 'ai_media_suite_events']) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toMatch(/FOREIGN KEY \("plan_version_id", "plan_id", "owner_user_id"\)[\s\S]*ai_media_plan_versions/u);
    expect(migration).toMatch(/FOREIGN KEY \("source_capture_snapshot_id", "source_subject_id"\)[\s\S]*source_capture_snapshots/u);
    expect(migration).toMatch(/FOREIGN KEY \("suite_id", "owner_user_id"\)[\s\S]*ai_media_suites/u);
    expect(migration).toMatch(/ai_media_suite_plan_version_claim_key/u);
    expect(migration).toMatch(/ai_media_suite_slot_key/u);
    expect(migration).toMatch(/protect_ai_media_suite_identity/u);
    expect(migration).toMatch(/protect_ai_media_suite_slot_identity/u);
    expect(migration).toMatch(/protect_ai_media_suite_event_immutable/u);
    expect(hardeningMigration).toMatch(/ai_media_suite_event_validate_insert/u);
    expect(hardeningMigration).toMatch(/ai_media_suite_revision_requires_event[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(hardeningMigration).not.toMatch(/diagnostics_json" IS DISTINCT/u);
    expect(authorityMigration).toMatch(/validate_ai_media_suite_insert/u);
    expect(authorityMigration).toMatch(/review_status" IS DISTINCT FROM 'APPROVED'/u);
    expect(authorityMigration).toMatch(/current_version_id" IS DISTINCT FROM NEW\."plan_version_id/u);
    expect(authorityMigration).toMatch(/stored_snapshot\."capture_hash" IS DISTINCT FROM NEW\."source_capture_hash/u);
    expect(failedStatusMigration.trim()).toBe(
      'ALTER TYPE "AiMediaSuiteStatus" ADD VALUE IF NOT EXISTS \'FAILED\' AFTER \'PARTIAL_FAILURE\';',
    );
    expect(migration).not.toMatch(/ALTER TYPE "AiMediaOperation"/u);
    expect(migration).not.toMatch(/ai_cost_reservations|ai_cost_settlements/u);
  });

  it('keeps the Prisma model and canonical slot-key bounds aligned', () => {
    expect(schema).toContain('model AiMediaSuite {');
    expect(schema).toContain('model AiMediaSuiteSlot {');
    expect(schema).toContain('model AiMediaSuiteEvent {');
    expect(schema).toMatch(/slotKey\s+String\s+@map\("slot_key"\)\s+@db\.VarChar\(1024\)/u);
    expect(schema).toMatch(/@@unique\(\[planVersionId\].*ai_media_suite_plan_version_claim_key/u);
    expect(schema).toMatch(/@@unique\(\[suiteId, slotKey\].*ai_media_suite_slot_key/u);
  });

  it('binds suite reference assets to frozen candidates and tenant-owned source assets', () => {
    expect(referenceAssetsMigration).toMatch(/DROP INDEX "media_asset_source_capture_key"/u);
    expect(referenceAssetsMigration).toMatch(/media_asset_source_capture_storage_key/u);
    expect(referenceAssetsMigration).toContain('CREATE TABLE "ai_media_suite_reference_assets"');
    expect(referenceAssetsMigration).toMatch(/FOREIGN KEY \("suite_id", "owner_user_id"\)[\s\S]*REFERENCES "ai_media_suites"\("id", "owner_user_id"\)/u);
    expect(referenceAssetsMigration).toMatch(/FOREIGN KEY \("asset_id", "owner_user_id"\)[\s\S]*REFERENCES "media_assets"\("id", "owner_user_id"\)/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_reference_candidate_key/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_reference_ordinal_key/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_reference_asset_key/u);
    expect(referenceAssetsMigration).toMatch(/"expected_content_hash" CHAR\(64\)/u);
    expect(referenceAssetsMigration).toMatch(/"asset_sha256" CHAR\(64\) NOT NULL/u);
    expect(referenceAssetsMigration).toMatch(/"raw_source_sha256" CHAR\(64\) NOT NULL/u);
    expect(referenceAssetsMigration).toMatch(/"binding_hash" CHAR\(64\) NOT NULL/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_reference_asset_values_check/u);
    expect(referenceAssetsMigration).toMatch(/"size_bytes" > 0/u);
    expect(referenceAssetsMigration).toMatch(/"width" > 0/u);
    expect(referenceAssetsMigration).toMatch(/"height" > 0/u);
  });

  it('validates frozen reference provenance before allowing a binding', () => {
    expect(referenceAssetsMigration).toMatch(/validate_ai_media_suite_reference_asset_insert/u);
    expect(referenceAssetsMigration).toMatch(/jsonb_array_elements\(slot\."references_snapshot_json"\)/u);
    expect(referenceAssetsMigration).toMatch(/ref\.value->>'candidateId' = NEW\."candidate_id"/u);
    expect(referenceAssetsMigration).toMatch(/frozen_reference #>> '\{source,url\}' IS DISTINCT FROM NEW\."frozen_source_url"/u);
    expect(referenceAssetsMigration).toMatch(/NULLIF\(frozen_reference #>> '\{source,contentHash\}', ''\) IS DISTINCT FROM NEW\."expected_content_hash"/u);
    expect(referenceAssetsMigration).toMatch(/ref\.value->'source' IS DISTINCT FROM frozen_reference->'source'/u);
    expect(referenceAssetsMigration).not.toMatch(/ref\.value IS DISTINCT FROM frozen_reference/u);
    expect(referenceAssetsMigration).toMatch(/expected_ordinal IS DISTINCT FROM NEW\."ordinal"/u);
    expect(referenceAssetsMigration).toMatch(/snapshot_owner_user_id IS DISTINCT FROM NEW\."owner_user_id"/u);
    expect(referenceAssetsMigration).toMatch(/stored_suite\."status" IS DISTINCT FROM 'PLANNED'/u);
    expect(referenceAssetsMigration).toMatch(/stored_suite\."revision" IS DISTINCT FROM 2/u);
    expect(referenceAssetsMigration).toMatch(/stored_suite\."provider" IS DISTINCT FROM 'fake'/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."kind" IS DISTINCT FROM 'SOURCE_ORIGINAL'/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."ai_image_job_id" IS NOT NULL/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."source_capture_snapshot_id" IS DISTINCT FROM stored_suite\."source_capture_snapshot_id"/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."source_media_key" IS DISTINCT FROM NEW\."candidate_id"/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."source_url" IS DISTINCT FROM NEW\."frozen_source_url"/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."sha256" IS DISTINCT FROM NEW\."asset_sha256"/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."metadata"->>'sourceCaptureHash' IS DISTINCT FROM stored_suite\."source_capture_hash"/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."metadata"->>'sourceSha256' IS DISTINCT FROM NEW\."raw_source_sha256"/u);
    expect(referenceAssetsMigration).toMatch(/stored_asset\."metadata"->>'sourceMimeType'/u);
    expect(referenceAssetsMigration).toMatch(/NEW\."expected_content_hash" IS DISTINCT FROM NEW\."raw_source_sha256"/u);
    expect(referenceAssetsMigration).toMatch(/CREATE TRIGGER "ai_media_suite_reference_asset_validate_insert"/u);
  });

  it('keeps reference bindings immutable and protects bound media identity', () => {
    expect(referenceAssetsMigration).toMatch(/CREATE TRIGGER "ai_media_suite_reference_asset_immutable"/u);
    expect(referenceAssetsMigration).toMatch(/BEFORE UPDATE OR DELETE ON "ai_media_suite_reference_assets"/u);
    expect(referenceAssetsMigration).toMatch(/CREATE OR REPLACE FUNCTION protect_referenced_media_asset_identity\(\)/u);
    expect(referenceAssetsMigration).toMatch(/NEW\."ai_image_job_id" IS DISTINCT FROM OLD\."ai_image_job_id"[\s\S]*media asset job binding is insert-time immutable/u);
    expect(referenceAssetsMigration).toMatch(/FROM "ai_media_suite_reference_assets"[\s\S]*"asset_id" = OLD\."id"/u);
    expect(referenceAssetsMigration).toMatch(/OR \([\s\S]*NEW\."metadata" IS DISTINCT FROM OLD\."metadata"/u);
    expect(referenceAssetsMigration).toMatch(/BEFORE UPDATE OF[\s\S]*"metadata"[\s\S]*ON "media_assets"/u);
    expect(referenceAssetsMigration).toMatch(/media_assets_referenced_identity_immutable/u);
    expect(referenceAssetsMigration).toMatch(/require_ai_media_suite_claimed_slot_set/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_slot_insert_before_claim/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_claimed_slot_set[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_claim_event_slot_set/u);
    expect(referenceAssetsMigration).toMatch(/require_ai_media_suite_reference_set_event/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_reference_set_event[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(referenceAssetsMigration).toMatch(/ai_media_suite_reference_event_set/u);
  });

  it('exposes the tenant-bound Prisma inverse relations and reference model', () => {
    expect(schema).toContain('aiMediaSuiteReferences  AiMediaSuiteReferenceAsset[]');
    expect(schema).toContain('referenceAssets         AiMediaSuiteReferenceAsset[]');
    expect(schema).toContain('model AiMediaSuiteReferenceAsset {');
    expect(schema).toMatch(/@@unique\(\[ownerUserId, sourceCaptureSnapshotId, sourceMediaKey, storageBackend\].*media_asset_source_capture_storage_key/u);
    expect(schema).toMatch(/suite\s+AiMediaSuite\s+@relation\(fields: \[suiteId, ownerUserId\], references: \[id, ownerUserId\]/u);
    expect(schema).toMatch(/asset\s+MediaAsset\s+@relation\(fields: \[assetId, ownerUserId\], references: \[id, ownerUserId\]/u);
    expect(schema).toMatch(/@@unique\(\[suiteId, ownerUserId, candidateId\].*ai_media_suite_reference_candidate_key/u);
    expect(schema).toMatch(/@@unique\(\[suiteId, ordinal\].*ai_media_suite_reference_ordinal_key/u);
    expect(schema).toMatch(/@@unique\(\[suiteId, assetId\].*ai_media_suite_reference_asset_key/u);
  });

  it('adds owner-bound prompt set and per-slot prompt models without adding provider or cost state', () => {
    expect(promptFreezeMigration).toContain('CREATE TABLE "ai_media_suite_prompt_sets"');
    expect(promptFreezeMigration).toContain('CREATE TABLE "ai_media_suite_slot_prompts"');
    expect(promptFreezeMigration).toMatch(/FOREIGN KEY \("suite_id", "owner_user_id"\)[\s\S]*REFERENCES "ai_media_suites"\("id", "owner_user_id"\)/u);
    expect(promptFreezeMigration).toMatch(/FOREIGN KEY \("slot_id", "suite_id", "owner_user_id"\)[\s\S]*REFERENCES "ai_media_suite_slots"\("id", "suite_id", "owner_user_id"\)/u);
    expect(promptFreezeMigration).toMatch(/FOREIGN KEY \("prompt_set_id", "suite_id", "owner_user_id"\)[\s\S]*REFERENCES "ai_media_suite_prompt_sets"\("id", "suite_id", "owner_user_id"\)/u);
    expect(promptFreezeMigration).toMatch(/FOREIGN KEY \("template_release_id", "template_key"\)[\s\S]*REFERENCES "ai_prompt_releases"\("id", "template_key"\)/u);
    expect(promptFreezeMigration).toMatch(/FOREIGN KEY \("template_revision_id", "template_key"\)[\s\S]*REFERENCES "ai_prompt_revisions"\("id", "template_key"\)/u);
    expect(promptFreezeMigration).toMatch(/ai_media_suite_prompt_set_suite_key/u);
    expect(promptFreezeMigration).toMatch(/ai_media_suite_prompt_set_owner_operation_key/u);
    expect(promptFreezeMigration).toMatch(/ai_media_suite_slot_prompt_suite_slot_key/u);
    expect(promptFreezeMigration).toMatch(/ai_media_suite_slot_prompt_set_ordinal_key/u);
    expect(promptFreezeMigration).toMatch(/"variables_snapshot_json" JSONB NOT NULL/u);
    expect(promptFreezeMigration).toMatch(/"resolved_prompt" TEXT NOT NULL/u);
    expect(promptFreezeMigration).toMatch(/"resolved_negative_prompt" TEXT NOT NULL/u);
    expect(promptFreezeMigration).toMatch(/"policy_hash" CHAR\(64\) NOT NULL/u);
    expect(promptFreezeMigration).toMatch(/"resolved_prompt_hash" CHAR\(64\) NOT NULL/u);
    expect(promptFreezeMigration).toMatch(/"resolved_negative_prompt_hash" CHAR\(64\) NOT NULL/u);
    expect(promptFreezeMigration).toMatch(/"binding_hash" CHAR\(64\) NOT NULL/u);
    expect(promptFreezeMigration).toMatch(/"source_capture_snapshot_id" TEXT NOT NULL/u);
    expect(promptFreezeMigration).not.toMatch(/ai_cost_reservations|ai_cost_settlements|CREATE TYPE "AiMediaOperation"/u);
  });

  it('binds the Prompt freeze to revision 3 and protects every immutable prompt identity', () => {
    expect(promptFreezeMigration).toMatch(/PROMPTS_FROZEN/u);
    expect(promptFreezeMigration).toMatch(/NEW\."version" IS DISTINCT FROM 'ai-image-suite-slot-prompt\/v1'/u);
    expect(promptFreezeMigration).toMatch(/revision" IS DISTINCT FROM 3/u);
    expect(promptFreezeMigration).toMatch(/REFERENCES_INTERNALIZED/u);
    expect(promptFreezeMigration).toMatch(/validate_ai_media_suite_prompt_set_insert/u);
    expect(promptFreezeMigration).toMatch(/validate_ai_media_suite_slot_prompt_insert/u);
    expect(promptFreezeMigration).toMatch(/protect_ai_media_suite_prompt_set_immutable/u);
    expect(promptFreezeMigration).toMatch(/protect_ai_media_suite_slot_prompt_immutable/u);
    expect(promptFreezeMigration).toMatch(/BEFORE UPDATE OR DELETE ON "ai_media_suite_prompt_sets"/u);
    expect(promptFreezeMigration).toMatch(/BEFORE UPDATE OR DELETE ON "ai_media_suite_slot_prompts"/u);
    expect(promptFreezeMigration).toMatch(/require_ai_media_suite_prompt_frozen_set/u);
    expect(promptFreezeMigration).toMatch(/ai_media_suite_prompt_frozen_set[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(promptFreezeMigration).toMatch(/ai_media_suite_prompt_event_set/u);
    expect(promptFreezeMigration).toMatch(/validate_ai_media_suite_prompt_revision_event/u);
    expect(promptFreezeMigration).toMatch(/revision 3 requires PROMPTS_FROZEN event/u);
    expect(promptFreezeMigration).toMatch(/child_workflow_id[\s\S]*PROMPTS_FROZEN/u);
    expect(promptFreezeMigration).toMatch(/child workflow requires frozen suite prompts/u);
    expect(promptFreezeMigration).toMatch(/jsonb_array_elements_text\([\s\S]*slotPromptHashes/u);
    expect(promptFreezeMigration).toMatch(/payload"->>'requestFingerprint' IS DISTINCT FROM prompt_set\."request_fingerprint/u);
    expect(promptFreezeMigration).toMatch(/payload"->>'policyHash' IS DISTINCT FROM prompt_set\."policy_hash/u);
    expect(promptFreezeMigration).toMatch(/payload"->>'templateSnapshotHash' IS DISTINCT FROM prompt_set\."template_snapshot_hash/u);
    expect(promptFreezeMigration).not.toMatch(/jsonb_array_elements\(/u);
  });

  it('exposes composite tenant ownership and immutable Prompt relations in Prisma', () => {
    expect(schema).toContain('model AiMediaSuitePromptSet {');
    expect(schema).toContain('model AiMediaSuiteSlotPrompt {');
    expect(schema).toMatch(/promptSet\s+AiMediaSuitePromptSet\s+@relation\(fields: \[promptSetId, suiteId, ownerUserId\], references: \[id, suiteId, ownerUserId\]/u);
    expect(schema).toMatch(/suiteSlot\s+AiMediaSuiteSlot\s+@relation\(fields: \[slotId, suiteId, ownerUserId\], references: \[id, suiteId, ownerUserId\]/u);
    expect(schema).toMatch(/@@unique\(\[id, suiteId, ownerUserId\].*ai_media_suite_slot_id_suite_owner_key/u);
    expect(schema).toMatch(/@@unique\(\[suiteId, ownerUserId\].*ai_media_suite_prompt_set_suite_key/u);
    expect(schema).toMatch(/@@unique\(\[id, suiteId, ownerUserId\].*ai_media_suite_prompt_set_id_suite_owner_key/u);
    expect(schema).toMatch(/@@unique\(\[ownerUserId, operationKey\].*ai_media_suite_prompt_set_owner_operation_key/u);
    expect(schema).toMatch(/@@unique\(\[slotId, suiteId, ownerUserId\].*ai_media_suite_slot_prompt_suite_slot_key/u);
    expect(schema).toMatch(/@@unique\(\[promptSetId, ordinal\].*ai_media_suite_slot_prompt_set_ordinal_key/u);
    expect(schema).toMatch(/templateRelease\s+AiPromptRelease/u);
    expect(schema).toMatch(/templateRevision\s+AiPromptRevision/u);
    expect(schema).toMatch(/resolvedPrompt\s+String\s+@map\("resolved_prompt"\)\s+@db\.Text/u);
    expect(schema).toMatch(/suitePromptSets\s+AiMediaSuitePromptSet\[\]/u);
    expect(schema).toMatch(/slotPrompts\s+AiMediaSuiteSlotPrompt\[\]/u);
  });

  it('aligns workflow slot keys and reserves revision 4 for complete child materialization', () => {
    expect(materializationMigrations).toMatch(/ALTER COLUMN "context_slot_key" TYPE VARCHAR\(1024\)/u);
    expect(schema).toMatch(/contextSlotKey\s+String\?\s+@map\("context_slot_key"\)\s+@db\.VarChar\(1024\)/u);
    expect(materializationHardeningMigration).toMatch(/revision beyond materialization is not enabled/u);
    expect(materializationHardeningMigration).toMatch(/ai_media_suite_materialization_revision_ceiling/u);
    expect(materializationMigrations).toMatch(/revision 4 requires CHILDREN_MATERIALIZED event/u);
    expect(materializationMigrations).toMatch(/ai-image-suite-children-materialized\/v1/u);
    expect(materializationMigrations).toMatch(/stored_suite\."revision" IS DISTINCT FROM 4/u);
    expect(materializationMigrations).toMatch(/child workflow requires frozen suite prompts \(suite revision 4 required\)/u);
    expect(materializationMigrations).toMatch(/assert_ai_media_suite_materialized_graph/u);
    expect(materializationMigrations).toMatch(/ai_media_suite_materialized_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(materializationMigrations).toMatch(/ai_media_suite_materialized_slot_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(materializationMigrations).toMatch(/ai_media_suite_materialized_event_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  });

  it('binds every materialized child to the frozen Prompt, references and reserved cost', () => {
    expect(materializationMigrations).toMatch(/slot\."status" IS DISTINCT FROM 'PLANNED'/u);
    expect(materializationMigrations).toMatch(/slot\."attempt" IS DISTINCT FROM 1/u);
    expect(materializationMigrations).toMatch(/slot\."revision" IS DISTINCT FROM 2/u);
    expect(materializationMigrations).toMatch(/workflow\."status" IS DISTINCT FROM 'QUEUED'/u);
    expect(materializationMigrations).toMatch(/child_job\."status" = 'PENDING'/u);
    expect(materializationMigrations).toMatch(/child_job\."operation" = 'IMAGE_TO_IMAGE'/u);
    expect(materializationMigrations).toMatch(/ai-image-suite-child-operation\/v1/u);
    expect(materializationMigrations).toMatch(/ozon-suite-3x4-900x1200\/v1/u);
    expect(materializationMigrations).toMatch(/child_job\."width" = 900/u);
    expect(materializationMigrations).toMatch(/child_job\."height" = 1200/u);
    expect(materializationMigrations).toMatch(/slotPromptId'[\s\S]*slot_prompt\."id"/u);
    expect(materializationMigrations).toMatch(/promptBindingHash'[\s\S]*slot_prompt\."binding_hash"/u);
    expect(materializationMigrations).toMatch(/referenceSetHash'[\s\S]*slot_prompt\."reference_set_hash"/u);
    expect(materializationMigrations).toMatch(/FROM "ai_media_workflow_inputs"/u);
    expect(materializationMigrations).toMatch(/FROM "ai_media_suite_reference_assets"/u);
    expect(materializationMigrations).toMatch(/FROM "ai_cost_reservations"/u);
    expect(materializationMigrations).toMatch(/context_sku_key[\s\S]*ownership_key/u);
    expect(materializationMigrations).toMatch(/child_job\."prompt" = slot_prompt\."resolved_prompt"/u);
    expect(materializationMigrations).toMatch(/child_job\."negative_prompt" = slot_prompt\."resolved_negative_prompt"/u);
    expect(materializationMigrations).toMatch(/payload[\s\S]*actorUserId[\s\S]*actor_user_id/u);
    expect(materializationMigrations).toMatch(/materialized_event\."actor_user_id"/u);
    expect(materializationMigrations).toMatch(/reservation\."status" = 'RESERVED'/u);
    expect(materializationMigrations).toMatch(/aggregate_estimated_cost/u);
    expect(materializationMigrations).toMatch(/aggregate_maximum_cost/u);
    expect(materializationMigrations).toMatch(/provider_dispatched_at" IS NULL/u);
    expect(materializationMigrations).toMatch(/provider_job_id" IS NULL/u);
    expect(materializationMigrations).toMatch(/jsonb_array_elements\(materialized_event\."payload"->'children'\)/u);
    expect(materializationMigrations).toMatch(/childWorkflowId'[\s\S]*workflow\."id"/u);
    expect(materializationMigrations).toMatch(/reservationId'[\s\S]*reservation\."id"/u);
    expect(materializationHardeningMigration).toMatch(/prevent_ai_media_suite_bound_child_insert/u);
    expect(materializationHardeningMigration).toMatch(/ai_image_jobs_suite_child_append_closed/u);
    expect(materializationHardeningMigration).toMatch(/ai_media_workflow_inputs_suite_child_append_closed/u);
    expect(materializationHardeningMigration).toMatch(/protect_ai_media_suite_child_reservation_lifecycle/u);
    expect(materializationHardeningMigration).toMatch(/ai_cost_reservations_suite_child_lifecycle_protected/u);
    expect(materializationHardeningMigration).toMatch(/TG_OP = 'DELETE'[\s\S]*RETURN OLD[\s\S]*RETURN NEW/u);
    expect(materializationHardeningMigration).toMatch(/OLD\."workflow_id"[\s\S]*NEW\."workflow_id"/u);
    expect(materializationHardeningMigration).toMatch(/prevent_ai_media_suite_child_output_before_dispatch/u);
    expect(materializedSlotProtectionMigration).toMatch(/protect_ai_media_suite_materialized_slot_lifecycle/u);
    expect(materializedSlotProtectionMigration).toMatch(/ai_media_suite_slots_materialized_lifecycle_protected/u);
    expect(materializedSlotProtectionMigration).toMatch(/suite\."revision" >= 4/u);
    expect(materializedSlotProtectionMigration).toMatch(/assert_ai_media_suite_materialized_graph/u);
  });

  it('replaces the revision-4 blockers with an audited execution state machine', () => {
    expect(executionMigration).toMatch(/DROP TRIGGER "ai_media_suite_materialization_revision_ceiling"/u);
    expect(executionMigration).toMatch(/revision beyond materialization is not enabled without revision-5 dispatch/u);
    expect(executionMigration).toMatch(/revision 5 requires SUITE_DISPATCHED/u);
    expect(executionMigration).toMatch(/ai-image-suite-execution-event\/v1/u);
    expect(executionMigration).toMatch(/SUITE_CANCEL_REQUESTED/u);
    expect(executionMigration).toMatch(/SUITE_CANCELLED/u);
    expect(executionMigration).toMatch(/SUITE_SLOT_RETRY_REQUESTED/u);
    expect(executionMigration).toMatch(/SUITE_CHILD_SUCCEEDED/u);
    expect(executionMigration).toMatch(/commandFingerprint/u);
    expect(executionMigration).toMatch(/beforeRevision/u);
    expect(executionMigration).toMatch(/afterRevision/u);
    expect(executionMigration).toMatch(/beforeStatus/u);
    expect(executionMigration).toMatch(/afterStatus/u);
    expect(executionMigration).not.toMatch(/ALTER TYPE/u);
  });

  it('enforces bounded parent aggregation and same-transaction child execution', () => {
    expect(executionMigration).toMatch(/assert_ai_media_suite_execution_graph/u);
    expect(executionMigration).toMatch(/active_count > stored_suite\."concurrency_limit"/u);
    expect(executionMigration).toMatch(/parent status does not match slot aggregate/u);
    expect(executionMigration).toMatch(/execution revision lacks its aggregate event/u);
    expect(executionMigration).toMatch(/ai_media_suite_execution_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(executionMigration).toMatch(/ai_media_suite_execution_slot_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(executionMigration).toMatch(/ai_media_suite_execution_workflow_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(executionMigration).toMatch(/ai_media_suite_execution_job_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(executionMigration).toMatch(/ai_media_suite_execution_reservation_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(executionMigration).toMatch(/ai_media_suite_execution_asset_graph[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  });

  it('permits only a frozen next attempt for a reconciled failed slot', () => {
    expect(executionMigration).toMatch(/materialized AI media suite child inputs are append-closed/u);
    expect(executionMigration).toMatch(/NEW\."workflow_attempt" IS DISTINCT FROM maximum_attempt \+ 1/u);
    expect(executionMigration).toMatch(/stored_slot\."status" IS DISTINCT FROM 'FAILED'/u);
    expect(executionMigration).toMatch(/previous_reservation\."status" NOT IN \('SETTLED', 'RELEASED'\)/u);
    expect(executionMigration).toMatch(/attempt_job\."operation"[\s\S]*frozen_job\."operation"/u);
    expect(executionMigration).toMatch(/old_job\."status" <> 'FAILED'/u);
    expect(executionMigration).toMatch(/successful AI media suite slot is terminal|terminal AI media suite slot cannot transition/u);
    expect(executionMigration).toMatch(/AI media suite cost reservation cannot be deleted/u);
    expect(executionMigration).toMatch(/output does not match a successful current attempt|output requires the dispatch contract and a successful current attempt/u);
  });

  it('binds replay summaries to the exact ordered execution projection', () => {
    expect(executionMigration).toMatch(/payload"#>>'\{result,suiteId\}'[\s\S]*stored_suite\."id"/u);
    expect(executionMigration).toMatch(/payload"#>>'\{result,revision\}'[\s\S]*stored_suite\."revision"/u);
    expect(executionMigration).toMatch(/payload"#>>'\{result,concurrencyLimit\}'/u);
    expect(executionMigration).toMatch(/jsonb_array_elements\(NEW\."payload"#>'\{result,slots\}'\) WITH ORDINALITY/u);
    expect(executionMigration).toMatch(/result_slot\.value->>'slotId'[\s\S]*slot\."id"/u);
    expect(executionMigration).toMatch(/result_slot\.value->>'childWorkflowId'[\s\S]*slot\."child_workflow_id"/u);
    expect(executionMigration).toMatch(/execution replay result mismatch/u);
  });

  it('adds a fail-closed execution claim lease to each suite slot', () => {
    expect(executionMigration).toMatch(/ADD COLUMN "execution_claim_token" CHAR\(64\)/u);
    expect(executionMigration).toMatch(/ADD COLUMN "execution_lease_expires_at" TIMESTAMP\(3\)/u);
    expect(executionMigration).toMatch(/ai_media_suite_slot_execution_claim_check/u);
    expect(executionMigration).toMatch(/ai_media_suite_slot_execution_lease_idx/u);
    expect(executionMigration).toMatch(/running AI media suite slot requires a future execution lease/u);
    expect(executionMigration).toMatch(/claim cannot be renewed or replaced/u);
    expect(executionMigration).toMatch(/inactive AI media suite slot cannot retain an execution claim/u);
    expect(schema).toMatch(/executionClaimToken\s+String\?\s+@map\("execution_claim_token"\)\s+@db\.Char\(64\)/u);
    expect(schema).toMatch(/executionLeaseExpiresAt\s+DateTime\?\s+@map\("execution_lease_expires_at"\)/u);
    expect(schema).toMatch(/@@index\(\[status, executionLeaseExpiresAt, id\].*ai_media_suite_slot_execution_lease_idx/u);
  });

  it('allows only one actionable suite across all versions of a plan', () => {
    expect(planActivityMigration).toMatch(
      /CREATE UNIQUE INDEX "ai_media_suite_plan_active_key"[\s\S]*ON "ai_media_suites" \("plan_id"\)/u,
    );
    expect(planActivityMigration).toMatch(
      /"status" IN \('QUEUED', 'RUNNING', 'CANCEL_REQUESTED'\)/u,
    );
    expect(planActivityMigration).toMatch(
      /"status" = 'PLANNED' AND "revision" >= 4/u,
    );
    expect(planActivityMigration).not.toMatch(
      /"status" IN \([^)]*(?:PARTIAL_FAILURE|FAILED|SUCCEEDED|CANCELLED)/u,
    );
  });

  it('ships paid suite execution atomically without a production-cardinality graph scan', () => {
    expect(paidExecutionMigration).toMatch(
      /^BEGIN;\s+SET LOCAL lock_timeout = '5s';\s+SET LOCAL statement_timeout = '15min';/u,
    );
    expect(paidExecutionMigration).toMatch(/COMMIT;\s*$/u);
    expect(paidExecutionMigration).toMatch(/CREATE OR REPLACE FUNCTION assert_ai_media_suite_execution_graph/u);
    expect(paidExecutionMigration).not.toMatch(
      /SELECT "id", "owner_user_id" FROM "ai_media_suites" WHERE "revision" >= 5/u,
    );
    expect(paidExecutionMigration).toMatch(
      /EXECUTE FUNCTION require_ai_media_suite_execution_graph_from_asset\(\);\s+COMMIT;\s*$/u,
    );
  });

  it('prebuilds covering global AI budget indexes without blocking table writes', () => {
    expect(globalSettlementBudgetIndexMigration.trim()).toBe(
      'CREATE INDEX CONCURRENTLY "ai_cost_settlements_global_budget_idx"\n'
      + 'ON "ai_cost_settlements"("kind", "created_at", "actual_cost_minor");',
    );
    expect(globalReservationBudgetIndexMigration.trim()).toBe(
      'CREATE INDEX CONCURRENTLY "ai_cost_reservations_global_budget_idx"\n'
      + 'ON "ai_cost_reservations"("status", "maximum_cost_minor");',
    );
    expect(schema).toMatch(
      /@@index\(\[kind, createdAt, actualCostMinor\], map: "ai_cost_settlements_global_budget_idx"\)/u,
    );
    expect(schema).toMatch(
      /@@index\(\[status, maximumCostMinor\], map: "ai_cost_reservations_global_budget_idx"\)/u,
    );
  });

  it('backfills only exact legacy fake suite outputs before making child assets immutable', () => {
    const backfillIndex = paidExecutionMigration.indexOf('UPDATE "media_assets" AS asset');
    const childIdentityIndex = paidExecutionMigration.indexOf(
      'CREATE OR REPLACE FUNCTION protect_ai_media_suite_child_asset_identity',
    );
    const finalAssetGraphTriggerIndex = paidExecutionMigration.indexOf(
      'CREATE CONSTRAINT TRIGGER "ai_media_suite_execution_asset_graph"',
    );
    expect(backfillIndex).toBeGreaterThan(0);
    expect(childIdentityIndex).toBeGreaterThan(backfillIndex);
    expect(finalAssetGraphTriggerIndex).toBeGreaterThan(childIdentityIndex);
    expect(paidExecutionMigration).toMatch(
      /ALTER TABLE "media_assets"\s+DISABLE TRIGGER "media_assets_referenced_identity_immutable"/u,
    );
    expect(paidExecutionMigration).toMatch(
      /ALTER TABLE "media_assets"\s+ENABLE TRIGGER "media_assets_referenced_identity_immutable"/u,
    );
    expect(paidExecutionMigration).toMatch(
      /UPDATE "media_assets" AS asset[\s\S]*SET CONSTRAINTS ALL IMMEDIATE;[\s\S]*ENABLE TRIGGER "media_assets_referenced_identity_immutable";[\s\S]*SET CONSTRAINTS ALL DEFERRED;/u,
    );
    expect(paidExecutionMigration).toMatch(/asset\."source_capture_snapshot_id" IS NULL/u);
    expect(paidExecutionMigration).toMatch(/suite\."provider" = 'fake'/u);
    expect(paidExecutionMigration).toMatch(
      /asset\."metadata"->>'version' = 'ai-image-suite-output\/v1'/u,
    );
    expect(paidExecutionMigration).toMatch(
      /asset\."metadata"->>'suiteId' = suite\."id"/u,
    );
    expect(paidExecutionMigration).toMatch(
      /asset\."metadata"->>'slotId' = slot\."id"/u,
    );
    expect(paidExecutionMigration).toMatch(/asset\."owner_user_id" = job\."owner_user_id"/u);
    expect(paidExecutionMigration).toMatch(/workflow\."owner_user_id" = job\."owner_user_id"/u);
    expect(paidExecutionMigration).toMatch(/slot\."owner_user_id" = workflow\."owner_user_id"/u);
    expect(paidExecutionMigration).toMatch(/suite\."owner_user_id" = slot\."owner_user_id"/u);
  });

  it('separates immutable raw Provider evidence from the normalized review output', () => {
    expect(paidExecutionMigration).toMatch(/NEW\."kind" = 'AI_PROVIDER_OUTPUT'/u);
    expect(paidExecutionMigration).toMatch(/stored_suite\."provider" = 'fake'[\s\S]*raw Provider output is invalid/u);
    expect(paidExecutionMigration).toMatch(/raw_count >= 1 OR final_count <> 0/u);
    expect(paidExecutionMigration).toMatch(/NEW\."width" IS DISTINCT FROM 1024 OR NEW\."height" IS DISTINCT FROM 1536/u);
    expect(paidExecutionMigration).toMatch(/NEW\."width" IS DISTINCT FROM 900 OR NEW\."height" IS DISTINCT FROM 1200/u);
    expect(paidExecutionMigration).toMatch(/providerOutputAssetId'[\s\S]*raw_output\."id"/u);
    expect(paidExecutionMigration).toMatch(/NEW\."sha256" IS DISTINCT FROM raw_output\."metadata"->>'normalizedSha256'/u);
    expect(paidExecutionMigration).toMatch(/protect_ai_media_suite_child_asset_identity/u);
    expect(paidExecutionMigration).toMatch(/BEFORE UPDATE OR DELETE ON "media_assets"/u);
    expect(paidExecutionMigration).toMatch(/child output evidence cannot be deleted/u);
    expect(paidExecutionMigration).toMatch(/child output evidence is immutable/u);
  });

  it('allows review only for the normalized current output', () => {
    expect(paidExecutionMigration).toMatch(/protect_ai_media_suite_selected_output/u);
    expect(paidExecutionMigration).toMatch(/selected_asset\."kind" IS DISTINCT FROM 'AI_GENERATED'/u);
    expect(paidExecutionMigration).toMatch(/selected_asset\."ai_image_job_id" IS DISTINCT FROM current_job\."id"/u);
    expect(paidExecutionMigration).toMatch(/selected output is not bound to Provider evidence/u);
    expect(paidExecutionMigration).toMatch(/BEFORE UPDATE OF "selected_output_asset_id", "review_status" ON "ai_media_workflows"/u);
  });

  it('renews only a live same-token lease and keeps retry authority fail closed', () => {
    expect(paidExecutionMigration).toMatch(/CREATE OR REPLACE FUNCTION protect_ai_media_suite_slot_identity/u);
    expect(paidExecutionMigration).toMatch(/NEW\."execution_claim_token" IS DISTINCT FROM OLD\."execution_claim_token"/u);
    expect(paidExecutionMigration).toMatch(/OLD\."execution_lease_expires_at" <= statement_timestamp\(\)/u);
    expect(paidExecutionMigration).toMatch(/NEW\."execution_lease_expires_at" <= OLD\."execution_lease_expires_at"/u);
    expect(paidExecutionMigration).toMatch(/lease renewal must preserve a live claim/u);
    expect(paidExecutionMigration).toMatch(/previous_reservation\."status" IS DISTINCT FROM 'RELEASED'/u);
    expect(paidExecutionMigration).toMatch(/previous_job\."actual_cost_cents" IS NOT NULL/u);
    expect(paidExecutionMigration).toMatch(/previous_job\."billed_units" IS DISTINCT FROM 0/u);
    expect(paidExecutionMigration).toMatch(/previous_asset_count IS DISTINCT FROM 0/u);
    expect(paidExecutionMigration).toMatch(/unsafe_attempt_count IS DISTINCT FROM 0/u);
    expect(paidExecutionMigration).toMatch(/attempt_job\."workflow_attempt" <= maximum_attempt/u);
    expect(paidExecutionMigration).toMatch(/provider_reconciliation_status" IN \('NOT_SUBMITTED', 'NO_OUTPUT'\)/u);
  });

  it('accepts bounded known-cost execution states without weakening terminal accounting', () => {
    expect(paidExecutionMigration).toMatch(/slot\."status" IN \('RUNNING', 'CANCEL_REQUESTED'\)/u);
    expect(paidExecutionMigration).toMatch(/current_job\."actual_cost_cents" = current_job\."estimated_cost_cents"[\s\S]*current_job\."billed_units" = 1[\s\S]*provider_dispatched_at" IS NOT NULL/u);
    expect(paidExecutionMigration).toMatch(/slot\."status" = 'SUCCEEDED'[\s\S]*asset_counts\.final_count <> 1/u);
    expect(paidExecutionMigration).toMatch(/stored_suite\."provider" <> 'fake'[\s\S]*asset_counts\.raw_count <> 1/u);
    expect(paidExecutionMigration).toMatch(/slot\."status" IN \('FAILED', 'CANCELLED'\)[\s\S]*current_reservation\."status" = 'SETTLED'/u);
    expect(paidExecutionMigration).toMatch(/old_reservation\."status" NOT IN \('SETTLED', 'RELEASED'\)/u);
    expect(paidExecutionMigration).toMatch(/old_final[\s\S]*"kind" = 'AI_GENERATED'\) <> 0/u);
    expect(paidExecutionMigration).toMatch(/old_raw[\s\S]*"kind" = 'AI_PROVIDER_OUTPUT'\) > 1/u);
  });
});
