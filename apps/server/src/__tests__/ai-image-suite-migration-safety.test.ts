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
});
