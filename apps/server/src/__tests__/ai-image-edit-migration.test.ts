import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const schemaUrl = new URL('../../prisma/schema.prisma', import.meta.url);
const enumMigrationUrl = new URL(
  '../../prisma/migrations/20260720150000_add_ai_image_edit_enums/migration.sql',
  import.meta.url,
);
const graphMigrationUrl = new URL(
  '../../prisma/migrations/20260720151000_harden_ai_image_edit_graph/migration.sql',
  import.meta.url,
);
const outputMigrationUrl = new URL(
  '../../prisma/migrations/20260720152000_harden_ai_image_edit_outputs/migration.sql',
  import.meta.url,
);
const outputBindingMigrationUrl = new URL(
  '../../prisma/migrations/20260720153000_bind_ai_image_edit_outputs/migration.sql',
  import.meta.url,
);
const outputGuardMigrationUrl = new URL(
  '../../prisma/migrations/20260720154000_install_ai_image_edit_output_guards/migration.sql',
  import.meta.url,
);
const candidateChainingMigrationUrl = new URL(
  '../../prisma/migrations/20260720160000_allow_ai_image_edit_candidate_chaining/migration.sql',
  import.meta.url,
);
const candidateContractMigrationUrl = new URL(
  '../../prisma/migrations/20260720161000_require_ai_image_edit_candidate_contract/migration.sql',
  import.meta.url,
);
const candidateScopeMigrationUrl = new URL(
  '../../prisma/migrations/20260720162000_require_ai_image_edit_candidate_scope/migration.sql',
  import.meta.url,
);
const candidateDependencyMigrationUrl = new URL(
  '../../prisma/migrations/20260720163000_guard_ai_image_edit_candidate_dependencies/migration.sql',
  import.meta.url,
);
const candidateAuthorityLockMigrationUrl = new URL(
  '../../prisma/migrations/20260720164000_lock_ai_image_edit_candidate_authority/migration.sql',
  import.meta.url,
);
const candidateMutationSerializationMigrationUrl = new URL(
  '../../prisma/migrations/20260720165000_serialize_ai_image_edit_candidate_mutations/migration.sql',
  import.meta.url,
);
const unboundCandidateMigrationUrl = new URL(
  '../../prisma/migrations/20260720166000_reject_unbound_ai_image_edit_candidates/migration.sql',
  import.meta.url,
);

describe('AI image edit persistence migrations', () => {
  it('adds edit operations and asset kinds in a dedicated additive enum migration', async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaUrl, 'utf8'),
      readFile(enumMigrationUrl, 'utf8'),
    ]);

    expect(schema).toMatch(/enum AiMediaOperation\s*\{[\s\S]*FULL_EDIT[\s\S]*INPAINT[\s\S]*\}/u);
    expect(schema).toMatch(/enum MediaAssetKind\s*\{[\s\S]*EDIT_MASK[\s\S]*AI_PROVIDER_OUTPUT[\s\S]*\}/u);
    expect(migration).toMatch(/ALTER TYPE "AiMediaOperation" ADD VALUE IF NOT EXISTS 'FULL_EDIT'/u);
    expect(migration).toMatch(/ALTER TYPE "AiMediaOperation" ADD VALUE IF NOT EXISTS 'INPAINT'/u);
    expect(migration).toMatch(/ALTER TYPE "MediaAssetKind" ADD VALUE IF NOT EXISTS 'EDIT_MASK'/u);
    expect(migration).toMatch(/ALTER TYPE "MediaAssetKind" ADD VALUE IF NOT EXISTS 'AI_PROVIDER_OUTPUT'/u);
    expect(migration).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION|CREATE (?:CONSTRAINT )?TRIGGER|ALTER TABLE|DROP TYPE/u);
  });

  it('installs edit-only deferred graph checks after the enum migration', async () => {
    const [migration, outputMigration] = await Promise.all([
      readFile(graphMigrationUrl, 'utf8'),
      readFile(outputMigrationUrl, 'utf8'),
    ]);

    expect(migration).toMatch(/assert_standalone_ai_image_edit_graph/u);
    expect(migration).toMatch(/"operation" NOT IN \('FULL_EDIT', 'INPAINT'\)/u);
    expect(migration).toMatch(/"ai_media_suite_slots"[\s\S]*"child_workflow_id"/u);
    expect(migration).toMatch(/count\(\*\) FILTER \(WHERE input\."role" = 'REFERENCE'\)/u);
    expect(migration).toMatch(/count\(\*\) FILTER \(WHERE input\."role" = 'MASK'\)/u);
    expect(migration).toMatch(/source_asset\."kind" IS DISTINCT FROM 'SOURCE_ORIGINAL'/u);
    expect(migration).toMatch(/mask_asset\."kind" IS DISTINCT FROM 'EDIT_MASK'/u);
    expect(migration).toMatch(/mask_asset\."source_capture_snapshot_id" IS DISTINCT FROM source_asset\."source_capture_snapshot_id"/u);
    expect(migration).toMatch(/mask_asset\."width" IS DISTINCT FROM source_asset\."width"/u);
    expect(migration).toMatch(/mask_asset\."height" IS DISTINCT FROM source_asset\."height"/u);
    expect(migration).toMatch(/job\."operation" IS DISTINCT FROM workflow\."operation"/u);
    expect(migration).toMatch(/job\."requested_image_count" IS DISTINCT FROM 1/u);
    expect(migration).toMatch(/job\."width" IS DISTINCT FROM source_asset\."width"/u);
    expect(migration).toMatch(/job\."height" IS DISTINCT FROM source_asset\."height"/u);
    expect(migration).toMatch(/job_count IS DISTINCT FROM workflow\."current_attempt"/u);
    expect(migration).toMatch(/output_asset\."kind" = 'AI_GENERATED'/u);
    expect(migration).toMatch(/output_job\."workflow_attempt" = workflow\."current_attempt"/u);
    expect(outputMigration).toMatch(/raw_output_count IS DISTINCT FROM 1/u);
    expect(outputMigration).toMatch(/final_output_count IS DISTINCT FROM 1/u);
    expect(outputMigration).toMatch(/candidate_job\."status" = 'SUCCEEDED'/u);
    expect(outputMigration).toMatch(/candidate_job\."status" IN \('FAILED', 'CANCELLED'\)/u);
    expect(outputMigration).toMatch(/mask_asset\."metadata"->>'maskSemantics' IS DISTINCT FROM 'WHITE_EDIT_BLACK_PRESERVE_V1'/u);
    expect(outputMigration).toMatch(/mask_asset\."metadata"->>'sourceAssetId' IS DISTINCT FROM source_asset\."id"/u);

    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_workflow_graph"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_input_graph"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_job_graph"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_suite_slot_graph"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(outputMigration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_asset_graph"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON "ai_image_jobs"/u);
    expect(outputMigration).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON "media_assets"/u);
    expect(outputMigration).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON "ai_media_workflow_inputs"/u);
    expect(migration).not.toMatch(/ALTER TYPE "AiMediaOperation"|ALTER TYPE "MediaAssetKind"|DROP TABLE|DROP TYPE/u);
  });

  it('prebuilds one concurrent job-and-kind key for raw and bound final edit outputs', async () => {
    const migration = await readFile(outputBindingMigrationUrl, 'utf8');

    expect([...migration.matchAll(/CREATE UNIQUE INDEX CONCURRENTLY/gu)]).toHaveLength(1);
    expect(migration).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY "media_assets_edit_output_job_kind_unique"/u);
    expect(migration).toMatch(/ON "media_assets"\("ai_image_job_id", "kind"\)/u);
    expect(migration).toMatch(/"kind" = 'AI_PROVIDER_OUTPUT'/u);
    expect(migration).toMatch(/"kind" = 'AI_GENERATED'[\s\S]*"metadata"->>'providerOutputAssetId' IS NOT NULL/u);
    expect(migration).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|CREATE (?:OR REPLACE )?FUNCTION|CREATE (?:CONSTRAINT )?TRIGGER|DO \$\$/u);
  });

  it('binds one raw Provider output to the final candidate and freezes edit metadata', async () => {
    const migration = await readFile(outputGuardMigrationUrl, 'utf8');

    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toMatch(/final_provider_output_id IS DISTINCT FROM raw_output_id/u);
    expect(migration).toMatch(/"metadata"->>'providerOutputAssetId'/u);
    expect(migration).toMatch(/protect_ai_image_edit_asset_metadata/u);
    expect(migration).toMatch(/AI image edit asset metadata is immutable/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).not.toMatch(/CREATE (?:UNIQUE )?INDEX|ALTER TYPE|DROP TABLE|DROP TYPE/u);
  });

  it('allows only normalized successful standalone edit finals as chained sources', async () => {
    const migration = await readFile(candidateChainingMigrationUrl, 'utf8');

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION assert_standalone_ai_image_edit_graph/u);
    expect(migration).toMatch(/source_asset\."kind" NOT IN \('SOURCE_ORIGINAL', 'AI_GENERATED'\)/u);
    expect(migration).toMatch(/source_asset\."kind" = 'AI_GENERATED'/u);
    expect(migration).toMatch(/source_asset\."source_capture_snapshot_id"/u);
    expect(migration).toMatch(/origin_source\."source_capture_snapshot_id" IS NOT DISTINCT FROM source_asset\."source_capture_snapshot_id"/u);
    expect(migration).toMatch(/origin_job\."status" = 'SUCCEEDED'/u);
    expect(migration).toMatch(/origin_workflow\."status" = 'SUCCEEDED'/u);
    expect(migration).toMatch(/origin_workflow\."operation" IN \('FULL_EDIT', 'INPAINT'\)/u);
    expect(migration).toMatch(/origin_workflow\."context_id" IS NOT DISTINCT FROM workflow\."context_id"/u);
    expect(migration).toMatch(/NOT EXISTS \([\s\S]*"ai_media_suite_slots"/u);
    expect(migration).toMatch(/source_asset\."metadata"->>'pixelOrientationNormalized' IS DISTINCT FROM 'true'/u);
    expect(migration).toMatch(/source_asset\."metadata"->>'outputRole' NOT IN \('FINAL_CANDIDATE', 'FINAL_COMPOSITE'\)/u);
    expect(migration).not.toMatch(/ALTER TYPE|DROP TABLE|DROP TYPE|CREATE (?:UNIQUE )?INDEX/u);
  });

  it('separately hardens the normalized candidate contract without rewriting the prior migration', async () => {
    const migration = await readFile(candidateContractMigrationUrl, 'utf8');

    expect(migration).toMatch(/editSourceContractVersion/u);
    expect(migration).toMatch(/ai-media-edit-source\/v1/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_contract_input"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_contract_workflow"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).not.toMatch(/ALTER TYPE|DROP TABLE|DROP TYPE|CREATE (?:UNIQUE )?INDEX/u);
  });

  it('keeps chained candidates in the exact nullable SKU and slot scope', async () => {
    const migration = await readFile(candidateScopeMigrationUrl, 'utf8');

    expect(migration).toMatch(/origin_workflow\."context_sku_key" IS NOT DISTINCT FROM workflow\."context_sku_key"/u);
    expect(migration).toMatch(/origin_workflow\."context_slot_key" IS NOT DISTINCT FROM workflow\."context_slot_key"/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_scope_input"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_scope_workflow"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).not.toMatch(/ALTER TYPE|DROP TABLE|DROP TYPE|CREATE (?:UNIQUE )?INDEX/u);
  });

  it('revalidates chained consumers when origin bindings are mutated', async () => {
    const migration = await readFile(candidateDependencyMigrationUrl, 'utf8');

    expect(migration).toMatch(/assert_ai_image_edit_candidate_consumers/u);
    expect(migration).toMatch(/assert_ai_image_edit_candidate_dependents_from_workflow/u);
    expect(migration).toMatch(/assert_ai_image_edit_candidate_dependents_from_job/u);
    expect(migration).toMatch(/PERFORM assert_standalone_ai_image_edit_graph/u);
    expect(migration).toMatch(/PERFORM assert_ai_image_edit_candidate_contract/u);
    expect(migration).toMatch(/PERFORM assert_ai_image_edit_candidate_scope/u);
    expect(migration).toMatch(/jsonb_typeof\(source_asset\."metadata"->'pixelOrientationNormalized'\) IS DISTINCT FROM 'boolean'/u);
    expect(migration).toMatch(/source_asset\."metadata"->'pixelOrientationNormalized' IS DISTINCT FROM 'true'::jsonb/u);
    expect(migration).toMatch(/TG_OP <> 'INSERT'[\s\S]*OLD\."id"[\s\S]*TG_OP <> 'DELETE'[\s\S]*NEW\."id"/u);
    expect(migration).toMatch(/TG_OP <> 'INSERT'[\s\S]*OLD\."workflow_id"[\s\S]*TG_OP <> 'DELETE'[\s\S]*NEW\."workflow_id"/u);
    expect(migration).toMatch(/OLD\."child_workflow_id"[\s\S]*NEW\."child_workflow_id"/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_workflow"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_job"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_input"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_suite_slot"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).toMatch(/CREATE CONSTRAINT TRIGGER "ai_media_edit_candidate_dependency_asset"[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
    expect(migration).not.toMatch(/source_capture_snapshots|ALTER TYPE|DROP TABLE|DROP TYPE|CREATE (?:UNIQUE )?INDEX/u);
  });

  it('serializes candidate authority and mirrors the application edit-ready limits', async () => {
    const migration = await readFile(candidateAuthorityLockMigrationUrl, 'utf8');

    expect(migration).toMatch(/LOCK TABLE[\s\S]*"ai_image_jobs"[\s\S]*"ai_media_workflow_inputs"[\s\S]*IN SHARE ROW EXCLUSIVE MODE/u);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION lock_ai_image_edit_origin_graph/u);
    expect(migration).toMatch(/FROM "ai_media_workflows" workflow[\s\S]*FOR UPDATE[\s\S]*FROM "ai_image_jobs" job[\s\S]*FOR UPDATE/u);
    expect(migration).toMatch(/CREATE TRIGGER "ai_media_edit_candidate_origin_lock"[\s\S]*BEFORE INSERT ON "ai_media_workflow_inputs"/u);
    expect(migration).toMatch(/source_asset\."mime_type" NOT IN \('image\/jpeg', 'image\/png'\)/u);
    expect(migration).toMatch(/coalesce\(source_asset\."sha256", ''\) !~ '\^\[a-f0-9\]\{64\}\$'/u);
    expect(migration).toMatch(/source_asset\."size_bytes" > 20971520/u);
    expect(migration).toMatch(/source_asset\."width" > 16384/u);
    expect(migration).toMatch(/source_asset\."height" > 16384/u);
    expect(migration).toMatch(/source_asset\."width"::BIGINT \* source_asset\."height"::BIGINT > 12000000/u);
    expect(migration).toMatch(/greatest\(source_asset\."width", source_asset\."height"\)::BIGINT[\s\S]*least\(source_asset\."width", source_asset\."height"\)::BIGINT \* 20/u);
    expect(migration).toMatch(/coalesce\(source_asset\."storage_key", ''\) !~ '\[\^\[:space:\]\]'/u);
    expect(migration).toMatch(/coalesce\(source_asset\."url", ''\) !~ '\[\^\[:space:\]\]'/u);
    expect(migration).toMatch(/jsonb_typeof\(source_asset\."metadata"->'pixelOrientationNormalized'\) IS DISTINCT FROM 'boolean'/u);
    expect(migration).toMatch(/PERFORM assert_standalone_ai_image_edit_graph/u);
    expect(migration).toMatch(/PERFORM assert_ai_image_edit_candidate_scope/u);
    expect(migration).not.toMatch(/origin_operation|origin_job\."operation"|workflow\."operation"::TEXT INTO origin_operation/u);
    expect(migration).not.toMatch(/source_capture_snapshots|ALTER TYPE|DROP TABLE|DROP TYPE|CREATE (?:UNIQUE )?INDEX/u);
  });

  it('uses the origin workflow as the sole candidate mutation mutex', async () => {
    const migration = await readFile(candidateMutationSerializationMigrationUrl, 'utf8');

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION lock_ai_image_edit_origin_workflows/u);
    expect(migration).toMatch(/FROM "ai_media_workflows" workflow[\s\S]*ORDER BY workflow\."id"[\s\S]*FOR UPDATE/u);
    expect(migration).not.toMatch(/FROM "ai_image_jobs" job[\s\S]{0,300}FOR UPDATE/u);
    expect(migration).toMatch(/DROP TRIGGER "ai_media_edit_candidate_origin_lock"/u);
    expect(migration).toMatch(/CREATE TRIGGER "zz_ai_media_edit_candidate_origin_lock"[\s\S]*BEFORE INSERT ON "ai_media_workflow_inputs"/u);
    expect(migration).toMatch(/CREATE TRIGGER "ai_image_jobs_lock_edit_candidate_origin"[\s\S]*BEFORE UPDATE OR DELETE ON "ai_image_jobs"/u);
    expect(migration).toMatch(/CREATE TRIGGER "media_assets_lock_edit_candidate_origin"[\s\S]*BEFORE UPDATE OR DELETE ON "media_assets"/u);
    expect(migration).toMatch(/OLD\."workflow_id"[\s\S]*NEW\."workflow_id"/u);
    expect(migration).toMatch(/OLD\."ai_image_job_id"[\s\S]*NEW\."ai_image_job_id"/u);
    expect(migration).toMatch(/Do not return when the current binding is NULL[\s\S]*FOR candidate IN/u);
    expect([...migration.matchAll(/SELECT asset\.\*\s+INTO source_asset/gu)]).toHaveLength(2);
    expect(migration).toMatch(/source_asset\."ai_image_job_id" IS DISTINCT FROM origin_job_id[\s\S]*ERRCODE = '40001'/u);
    expect(migration).toMatch(/rechecked_origin_workflow_id IS DISTINCT FROM origin_workflow_id/u);
    expect(migration).not.toMatch(/origin_operation|origin_job\."operation"/u);
    expect(migration).not.toMatch(/source_capture_snapshots|ALTER TYPE|DROP TABLE|DROP TYPE|CREATE (?:UNIQUE )?INDEX/u);
  });

  it('rejects generated candidates that have no origin workflow mutex', async () => {
    const migration = await readFile(unboundCandidateMigrationUrl, 'utf8');

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION assert_ai_image_edit_candidate_contract/u);
    expect(migration).toMatch(/IF origin_workflow_id IS NULL THEN[\s\S]*ERRCODE = '23514'/u);
    expect(migration).toMatch(/IF origin_workflow_id IS NULL THEN[\s\S]*PERFORM lock_ai_image_edit_origin_workflows/u);
    expect([...migration.matchAll(/SELECT asset\.\*\s+INTO source_asset/gu)]).toHaveLength(2);
    expect(migration).toMatch(/source_asset\."ai_image_job_id" IS DISTINCT FROM origin_job_id[\s\S]*ERRCODE = '40001'/u);
    expect(migration).toMatch(/rechecked_origin_workflow_id IS DISTINCT FROM origin_workflow_id/u);
    expect(migration).toMatch(/source_asset\."mime_type" NOT IN \('image\/jpeg', 'image\/png'\)/u);
    expect(migration).toMatch(/source_asset\."width"::BIGINT \* source_asset\."height"::BIGINT > 12000000/u);
    expect(migration).toMatch(/DO \$\$[\s\S]*PERFORM assert_ai_image_edit_candidate_contract/u);
    expect(migration).not.toMatch(/origin_operation|origin_job\."operation"/u);
    expect(migration).not.toMatch(/source_capture_snapshots|ALTER TYPE|DROP TABLE|DROP TYPE|CREATE (?:UNIQUE )?INDEX/u);
  });
});
