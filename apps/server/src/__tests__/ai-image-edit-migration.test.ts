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
});
