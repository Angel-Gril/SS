import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) => readFileSync(
  new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url),
  'utf8',
);

describe('AI media migration safety', () => {
  it('prebuilds each existing-table unique key in its own concurrent migration', () => {
    for (const name of [
      '20260716211500_prebuild_ai_image_job_owner_key',
      '20260716212000_prebuild_ai_image_job_workflow_attempt',
      '20260716212500_prebuild_media_asset_owner_key',
    ]) {
      const sql = migration(name).trim();
      expect(sql).toMatch(/^CREATE UNIQUE INDEX CONCURRENTLY /u);
      expect(sql.match(/CREATE\s/gu)).toHaveLength(1);
      expect(sql).not.toMatch(/BEGIN|COMMIT|SET /u);
    }

    const registry = migration('20260716213000_add_ai_media_workflows');
    expect(registry).toMatch(/UNIQUE USING INDEX "ai_image_job_id_owner"/u);
    expect(registry).toMatch(/UNIQUE USING INDEX "ai_image_job_workflow_attempt"/u);
    expect(registry).toMatch(/UNIQUE USING INDEX "media_asset_id_owner"/u);
  });

  it('locks provenance assets and freezes their job binding after insert', () => {
    const graph = migration('20260716214500_harden_ai_media_workflow_graph');
    const events = migration('20260716215500_validate_ai_media_event_provenance');
    const identity = migration('20260716220500_freeze_ai_media_graph_identity');

    expect(graph).toMatch(/"ai_image_job_id" = NEW\."job_id"\s+FOR SHARE/u);
    expect(events).toMatch(/FOR SHARE OF asset/u);
    expect(identity).toMatch(/media asset job binding is insert-time immutable/u);
    expect(identity).toMatch(/media_assets_ai_image_job_id_fkey[\s\S]*ON DELETE RESTRICT/u);
  });

  it('adds the contextual history keyset index without blocking workflow writes', () => {
    const history = migration('20260720167000_add_ai_media_workflow_history_index').trim();
    expect(history.replace(/\s+/gu, ' ')).toBe(
      'CREATE INDEX CONCURRENTLY "ai_media_workflow_owner_context_history" ON "ai_media_workflows" ( "owner_user_id", "context_type", "context_id", "created_at" DESC, "id" DESC );',
    );
    expect(history.match(/CREATE\s/gu)).toHaveLength(1);
    expect(history).not.toMatch(/BEGIN|COMMIT|SET /u);

    const priority = migration('20260720168000_add_ai_media_workflow_priority_index').trim();
    expect(priority.replace(/\s+/gu, ' ')).toBe(
      'CREATE INDEX CONCURRENTLY "ai_media_workflow_owner_context_updates" ON "ai_media_workflows" ( "owner_user_id", "context_type", "context_id", "updated_at" DESC, "id" DESC );',
    );
    expect(priority.match(/CREATE\s/gu)).toHaveLength(1);
    expect(priority).not.toMatch(/BEGIN|COMMIT|SET /u);
  });

  it('prebuilds the listing-draft composite keys with FK-compatible column order', () => {
    const target = migration('20260721001000_prebuild_source_listing_draft_ai_media_context_key').trim();
    expect(target).toMatch(/^CREATE UNIQUE INDEX CONCURRENTLY "source_listing_draft_ai_media_context_key"/u);
    expect(target).toMatch(/ON "source_listing_draft_versions"\(\s*"workflow_id", "revision", "owner_user_id", "draft_version"\s*\)/u);
    expect(target.match(/CREATE\s/gu)).toHaveLength(1);
    expect(target).not.toMatch(/BEGIN|COMMIT|SET /u);

    const columns = migration('20260721002000_add_ai_media_listing_draft_context_columns');
    expect(columns).toMatch(/ADD COLUMN "context_draft_revision" INTEGER/u);
    expect(columns).toMatch(/ADD COLUMN "context_draft_version" INTEGER/u);
    expect(columns).toMatch(/existing listing-draft AI media workflows require draft revision\/version backfill/u);
    expect(columns).toMatch(/"context_type" = 'listing-draft'[\s\S]*"context_draft_revision" IS NULL/u);
    expect(columns).toMatch(/ADD CONSTRAINT "ai_media_workflow_context_version_check"[\s\S]*\) NOT VALID;/u);
    expect(columns).toMatch(/VALIDATE CONSTRAINT "ai_media_workflow_context_version_check"/u);

    const child = migration('20260721003000_prebuild_ai_media_listing_draft_context_index').trim();
    expect(child).toMatch(/^CREATE INDEX CONCURRENTLY "ai_media_workflow_listing_draft_context_idx"/u);
    expect(child).toMatch(/ON "ai_media_workflows"\(\s*"context_id", "context_draft_revision", "owner_user_id", "context_draft_version"\s*\)/u);
    expect(child.match(/CREATE\s/gu)).toHaveLength(1);
    expect(child).not.toMatch(/BEGIN|COMMIT|SET /u);
  });

  it('binds listing-draft context only after the prebuilt keys and validates the FK online', () => {
    const binding = migration('20260721010000_add_ai_media_listing_draft_context');
    expect(binding).toMatch(/ADD CONSTRAINT "ai_media_workflow_listing_draft_context_fkey"[\s\S]*REFERENCES "source_listing_draft_versions"/u);
    expect(binding).toMatch(/\) ON DELETE RESTRICT ON UPDATE NO ACTION\s+NOT VALID;/u);
    expect(binding).toMatch(/VALIDATE CONSTRAINT "ai_media_workflow_listing_draft_context_fkey"/u);
    expect(binding).not.toMatch(/CREATE (?:UNIQUE )?INDEX/u);
    expect(binding).toMatch(/context_draft_revision" IS DISTINCT FROM OLD/u);

    const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    expect(schema).toMatch(/@@index\(\[contextId, contextDraftRevision, ownerUserId, contextDraftVersion\], map: "ai_media_workflow_listing_draft_context_idx"\)/u);
    expect(schema).toMatch(/listingDraftContext[\s\S]*map: "ai_media_workflow_listing_draft_context_fkey"\)/u);
  });
});
