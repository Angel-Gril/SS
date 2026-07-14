import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/20260712213000_add_logistics_capture_tasks/migration.sql'),
  'utf8',
);
const reviewMigration = readFileSync(
  resolve(root, 'prisma/migrations/20260712222000_add_logistics_capture_reviews/migration.sql'),
  'utf8',
);
const candidateSetMigration = readFileSync(
  resolve(root, 'prisma/migrations/20260712230000_add_logistics_capture_candidate_sets/migration.sql'),
  'utf8',
);
const taskVersionMigration = readFileSync(
  resolve(root, 'prisma/migrations/20260713090000_freeze_logistics_capture_task_version/migration.sql'),
  'utf8',
);
const captureReviewEventMigration = readFileSync(
  resolve(root, 'prisma/migrations/20260714060000_add_logistics_capture_review_events/migration.sql'),
  'utf8',
);
const migrationsRoot = resolve(root, 'prisma/migrations');
const allMigrations = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(
    resolve(migrationsRoot, entry.name, 'migration.sql'),
    'utf8',
  ))
  .join('\n');

describe('logistics capture task persistence contract', () => {
  it('persists bounded task and reviewable candidate lifecycles', () => {
    expect(schema).toMatch(/enum LogisticsCaptureTaskStatus[\s\S]*ISSUED[\s\S]*CLAIMED[\s\S]*REVIEWABLE[\s\S]*CANCELLED/);
    expect(schema).toMatch(/enum LogisticsCaptureCandidateState[\s\S]*CAPTURED[\s\S]*QUARANTINED/);
    expect(schema).toMatch(/model LogisticsCaptureTask[\s\S]*nonceDigest\s+String[\s\S]*claimedBySessionId\s+String\?[\s\S]*candidateId\s+String\?/);
    const candidate = schema.slice(schema.indexOf('model LogisticsCaptureCandidate'));
    expect(candidate).toMatch(/responseChecksum\s+String/);
    expect(candidate).toMatch(/normalizedPayload\s+Json\?/);
    expect(candidate).toMatch(/taskVersion\s+String/);
    expect(candidate).toMatch(/reviewStatus\s+LogisticsCaptureReviewStatus/);
  });
  it('freezes task-version provenance into every capture candidate', () => {
    expect(taskVersionMigration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(allMigrations).toContain('ADD COLUMN "task_version" TEXT');
    expect(allMigrations).toMatch(
      /UPDATE "logistics_capture_candidates"[\s\S]*SET "task_version" = source_task\."version"/,
    );
    expect(allMigrations).toContain('ALTER COLUMN "task_version" SET NOT NULL');
    expect(allMigrations).toContain('NEW."version" IS DISTINCT FROM OLD."version"');
    expect(allMigrations).toContain(
      'NEW."task_version" IS DISTINCT FROM source_task."version"',
    );
  });


  it('enforces exact tenant, shop, company, warehouse, and origin tuples in PostgreSQL', () => {
    expect(migration).toContain('capture_task_company_scope_fkey');
    expect(migration).toContain('capture_task_origin_scope_fkey');
    expect(migration).toContain('capture_task_tenant_shop_fkey');
    expect(migration).toContain('capture_task_shop_warehouse_fkey');
    expect(migration).toContain('capture_candidate_source_task_scope_fkey');
    expect(migration).toContain('capture_candidate_scope_response_key');
    expect(migration).toContain('validate_logistics_capture_candidate_source_task');
    expect(migration).toContain('protect_logistics_capture_task_source_provenance');
    expect(migration).toContain('IS NOT DISTINCT FROM');
    expect(migration).toContain('logistics capture candidate source task provenance mismatch');
  });

  it('guards state shape and immutable normalized candidate history', () => {
    expect(migration).toContain('logistics_capture_task_state_check');
    expect(migration).toContain('logistics_capture_candidate_immutable');
    expect(migration).toContain('prevent_logistics_capture_candidate_mutation');
    expect(migration).not.toMatch(/"cookie"|"authorization"|"access_token"/i);
  });

  it('allows only consistent audited review transitions while candidate evidence stays immutable', () => {
    expect(reviewMigration).toContain('capture_candidate_reviewer_fkey');
    expect(reviewMigration).toContain('logistics_capture_candidate_review_state_check');
    expect(reviewMigration).toMatch(
      /ARRAY\['review_status', 'reviewed_by_id', 'reviewed_at', 'review_reason'\]/,
    );
    expect(reviewMigration).toContain(
      'CREATE OR REPLACE FUNCTION "prevent_logistics_capture_candidate_mutation"',
    );
    expect(reviewMigration).toContain('"review_status" = \'VERIFIED\'');
    expect(reviewMigration).toContain('"review_status" = \'REJECTED\'');
    expect(reviewMigration).toContain('BETWEEN 3 AND 1000');
    expect(reviewMigration).toContain(`OLD."review_status" <> 'PENDING_REVIEW'`);
    expect(reviewMigration).toContain(`NEW."review_status" = 'PENDING_REVIEW'`);
    expect(reviewMigration).toContain('logistics capture candidate review is final');
  });

  it('requires one immutable sanitized scope event for every terminal capture review', () => {
    expect(captureReviewEventMigration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(schema).toMatch(
      /model LogisticsScopeEvent[\s\S]*captureCandidateId\s+String\?[\s\S]*captureCandidate\s+LogisticsCaptureCandidate\?/,
    );
    expect(captureReviewEventMigration).toContain('capture_candidate_id');
    expect(captureReviewEventMigration).toContain('capture_review_event_candidate_scope_fkey');
    expect(captureReviewEventMigration).toContain('logistics_scope_event_capture_candidate_idx');
    expect(captureReviewEventMigration).toContain('logistics_scope_event_capture_review_once');
    expect(captureReviewEventMigration).toContain('logistics_scope_event_capture_review_check');
    expect(captureReviewEventMigration).toContain('CAPTURE_CANDIDATE_VERIFIED');
    expect(captureReviewEventMigration).toContain('CAPTURE_CANDIDATE_REJECTED');
    expect(captureReviewEventMigration).toContain('reasonDigest');
    expect(captureReviewEventMigration).toContain('reasonLength');
    expect(captureReviewEventMigration).toContain('prevent_logistics_scope_event_mutation');
    expect(captureReviewEventMigration).toContain('BEFORE UPDATE OR DELETE');
    expect(captureReviewEventMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(captureReviewEventMigration).toContain('validate_logistics_capture_review_event');
    expect(captureReviewEventMigration).toContain('reviewed_by_id');
    expect(captureReviewEventMigration).toContain('reviewed_at');
    expect(captureReviewEventMigration).toContain('fingerprint_checksum');
    expect(captureReviewEventMigration).toContain('source_response_checksum');
    expect(captureReviewEventMigration).toContain('ensure_logistics_capture_review_event');
    expect(captureReviewEventMigration).toContain('CREATE CONSTRAINT TRIGGER');
    expect(captureReviewEventMigration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(captureReviewEventMigration).toMatch(
      /INSERT INTO "logistics_scope_events"[\s\S]*FROM "logistics_capture_candidates" c[\s\S]*WHERE c\."review_status" IN/,
    );
    expect(captureReviewEventMigration).not.toMatch(
      /rawPayload|normalizedPayload|diagnostics|reviewReason|authorization|cookie|accessToken/i,
    );
  });

  it('freezes reviewed candidate sets with scoped point and Official evidence', () => {
    expect(schema).toMatch(/model LogisticsCaptureCandidateSet[\s\S]*sellerCandidateId[\s\S]*pointEvidence[\s\S]*minExtensionVersion/);
    expect(schema).toMatch(/model LogisticsCaptureCandidateSetOfficial[\s\S]*officialCandidateId/);
    expect(candidateSetMigration).toContain('logistics_capture_candidate_sets');
    expect(candidateSetMigration).toContain('logistics_capture_candidate_set_officials');
    expect(candidateSetMigration).toContain('capture_candidate_set_seller_scope_fkey');
    expect(candidateSetMigration).toContain('capture_candidate_set_assignment_scope_fkey');
    expect(candidateSetMigration).toContain('capture_candidate_set_official_scope_fkey');
    expect(candidateSetMigration).toContain('point_evidence');
    expect(candidateSetMigration).toContain('min_extension_version');
    expect(candidateSetMigration).toContain('prevent_logistics_capture_candidate_set_mutation');
    expect(candidateSetMigration).toContain('cardinality("selected_service_keys") > 0');
    expect(candidateSetMigration).toContain('cardinality("official_candidate_ids") BETWEEN 1 AND 500');
  });
});
