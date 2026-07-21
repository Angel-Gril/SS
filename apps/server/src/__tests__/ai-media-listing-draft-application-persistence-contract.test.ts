import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const ledger = readFileSync(new URL(
  '../../prisma/migrations/20260721120000_add_ai_media_listing_draft_application_mutations/migration.sql',
  import.meta.url,
), 'utf8');
const authority = readFileSync(new URL(
  '../../prisma/migrations/20260721121000_harden_ai_media_listing_draft_application_authority/migration.sql',
  import.meta.url,
), 'utf8');
const projectionFix = readFileSync(new URL(
  '../../prisma/migrations/20260721122000_fix_ai_media_listing_draft_projection_constraints/migration.sql',
  import.meta.url,
), 'utf8');
const actorAuthority = readFileSync(new URL(
  '../../prisma/migrations/20260721123000_enforce_ai_media_listing_draft_actor_authority/migration.sql',
  import.meta.url,
), 'utf8');

describe('AI media listing-draft application persistence contract', () => {
  it('uses a dedicated owner-bound ledger without widening the collect table', () => {
    expect(schema).toMatch(/model AiMediaListingDraftApplicationMutation[\s\S]*sourceCaptureSnapshotId[\s\S]*operation[\s\S]*contextDraftRevision[\s\S]*contextDraftVersion/u);
    expect(schema).toMatch(/targetBefore[\s\S]*AiMediaListingDraftMutationBefore[\s\S]*targetAfter[\s\S]*AiMediaListingDraftMutationAfter/u);
    expect(schema).toContain('@@unique([ownerUserId, operationKey], map: "ai_media_listing_draft_mutation_operation_key")');
    expect(schema).toContain('@@unique([ownerUserId, targetId, targetSequence], map: "ai_media_listing_draft_mutation_target_sequence_key")');
    expect(ledger).toContain('CREATE TABLE "ai_media_listing_draft_application_mutations"');
    expect(ledger).not.toMatch(/ALTER TABLE "ai_media_application_mutations"/u);
  });

  it('binds before and after forward revisions to immutable listing draft history', () => {
    expect(ledger).toContain('ai_media_listing_draft_mutation_before_fkey');
    expect(ledger).toContain('ai_media_listing_draft_mutation_after_fkey');
    expect(ledger).toMatch(/"target_revision_after" = "target_revision_before" \+ 1/u);
    expect(ledger).toMatch(/"target_draft_version_after" = "target_draft_version_before" \+ 1/u);
    expect(ledger).toContain('assignment projection does not match draft payload');
    expect(ledger).toContain('rollback is not the current target frontier');
    expect(ledger).toContain('AI media listing-draft application mutations are immutable');
    expect(ledger).toMatch(/BEFORE UPDATE OR DELETE ON "ai_media_listing_draft_application_mutations"/u);
  });

  it('enforces fake-only source, input, suite and assignment authority in PostgreSQL', () => {
    expect(ledger).toContain('stored_job."provider" IS DISTINCT FROM \'fake\'');
    expect(ledger).toContain('before_slot_count');
    expect(ledger).toContain('after_slot_count');
    expect(ledger).toContain('mode does not match slot occupancy');
    expect(authority).toContain('listing draft application requires a frozen source input');
    expect(authority).toContain('does not support suite child workflows');
    expect(authority).toContain('before assignment asset authority is invalid');
    expect(authority).toContain('after assignment asset authority is invalid');
    expect(authority).toContain('listing draft application output source is invalid');
    expect(authority).toMatch(/"context_sku_key" IS NULL OR btrim\("context_sku_key"\) <> ''/u);
    expect(actorAuthority).toContain('actor."parent_id" = NEW."owner_user_id"');
    expect(actorAuthority).toContain('listing draft application actor does not belong to owner');
  });

  it('accepts an explicit JSON null empty slot while rejecting unknown assignment fields', () => {
    expect(projectionFix).toContain(`->'assignment' = 'null'::jsonb`);
    expect(projectionFix).toContain("ARRAY['scope', 'skuKey', 'slotKey', 'assetId', 'source']::text[]");
    expect(projectionFix).toContain("->>'scope' IN ('PRODUCT', 'SKU')");
    expect(projectionFix).toContain("->>'source' IN ('SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED')");
    expect(projectionFix).toMatch(/char_length\("after_state_json"->'assignment'->>'slotKey'\) <= 200/u);
  });
});
