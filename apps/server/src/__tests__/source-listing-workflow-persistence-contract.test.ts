import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migrationUrl = new URL(
  '../../prisma/migrations/20260715160000_add_source_listing_workflows/migration.sql',
  import.meta.url,
);
const hardeningMigrationUrl = new URL(
  '../../prisma/migrations/20260715170000_harden_source_listing_workflow_consistency/migration.sql',
  import.meta.url,
);
const limitsMigrationUrl = new URL(
  '../../prisma/migrations/20260715180000_align_source_listing_workflow_limits/migration.sql',
  import.meta.url,
);
const repository = readFileSync(new URL(
  '../services/source-listing-workflow-prisma.ts',
  import.meta.url,
), 'utf8');

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`Missing Prisma model ${name}`);
  return match[0];
}

describe('source listing workflow persistence contract', () => {
  it('declares current workflow state with immutable draft versions and actor events', () => {
    const migration = readFileSync(migrationUrl, 'utf8');
    const hardeningMigration = readFileSync(hardeningMigrationUrl, 'utf8');
    const limitsMigration = readFileSync(limitsMigrationUrl, 'utf8');
    expect(schema).toContain('WORKFLOW_VERSION_CHANGED');
    expect(schema).toContain('enum SourceListingWorkflowStatus');
    expect(schema).toContain('enum SourceListingDraftStatus');

    expect(modelBlock('SourceListingWorkflow')).toMatch(
      /ownerUserId\s+String[\s\S]*shopId\s+String[\s\S]*sourceSubjectId\s+String[\s\S]*currentSourceCaptureSnapshotId\s+String[\s\S]*legacySupplyGoodsId\s+String\?[\s\S]*supplyGoodsId\s+String\?[\s\S]*selectedSkuKeys\s+Json[\s\S]*selectedSkuHash\s+String[\s\S]*currentRevision\s+Int[\s\S]*currentDraftVersion\s+Int[\s\S]*currentDraft\s+SourceListingDraftVersion/,
    );
    expect(modelBlock('SourceListingDraftVersion')).toMatch(
      /workflowId\s+String[\s\S]*revision\s+Int[\s\S]*draftVersion\s+Int[\s\S]*sourceCaptureSnapshotId\s+String[\s\S]*payload\s+Json[\s\S]*payloadHash\s+String[\s\S]*parentRevision\s+Int\?[\s\S]*invalidationReasons\s+Json/,
    );
    expect(modelBlock('SourceListingWorkflowEvent')).toMatch(
      /draftVersion\s+Int[\s\S]*revision\s+Int[\s\S]*actorUserId\s+String[\s\S]*eventKey\s+String\s+@unique[\s\S]*payloadHash\s+String/,
    );
    expect(modelBlock('SourceListingPublishIntent')).toMatch(
      /workflowId\s+String[\s\S]*ownerUserId\s+String[\s\S]*shopId\s+String[\s\S]*draftVersion\s+Int[\s\S]*revision\s+Int[\s\S]*idempotencyKey\s+String[\s\S]*payloadHash\s+String[\s\S]*actorUserId\s+String/,
    );

    expect(migration).toContain('source_listing_workflow_owner_shop_fkey');
    expect(migration).toContain('source_listing_workflow_current_draft_fkey');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('source_listing_draft_parent_fkey');
    expect(migration).toContain('source_listing_draft_major_revision_idx');
    expect(migration).toContain('source_listing_workflow_identity_lookup_idx');
    expect(migration).toContain('prevent_source_listing_draft_version_mutation');
    expect(migration).toContain('prevent_source_listing_workflow_event_mutation');
    expect(migration).toContain('prevent_source_listing_publish_intent_mutation');
    expect(migration).toContain('source_listing_publish_intent_idempotency_key');
    expect(repository).toContain('"consumed_at" IS NULL AND "revoked_at" IS NULL');
    expect(migration).toContain('source listing workflow snapshot must stay in the original source subject');
    expect(migration).toContain('source listing selected SKU keys must be normalized, unique, and sorted');
    expect(hardeningMigration).toContain('source_listing_workflow_recoverable_identity_key');
    expect(hardeningMigration).toMatch(
      /WHERE "status" IN \(\s*'ACTIVE',\s*'PAUSED',\s*'RETRYABLE_FAILURE',\s*'MANUAL_REVIEW'\s*\)/,
    );
    expect(limitsMigration).toContain('jsonb_array_length(keys) > 500');
    expect(limitsMigration).toContain("length(item #>> '{}') NOT BETWEEN 1 AND 500");
  });
});
