import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260715190000_add_ozon_publish_attempts/migration.sql',
  import.meta.url,
), 'utf8');
const repository = readFileSync(new URL('../services/ozon-publish-attempt-prisma.ts', import.meta.url), 'utf8');

function modelBlock(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

describe('Ozon publish attempt persistence contract', () => {
  it('freezes the exact intent, draft, catalog, request hashes, offer trace, and actor', () => {
    const attempt = modelBlock('OzonPublishAttempt');
    expect(attempt).toMatch(/publishIntentId\s+String[\s\S]*workflowId\s+String[\s\S]*ownerUserId\s+String/);
    expect(attempt).toMatch(/draftVersion\s+Int[\s\S]*revision\s+Int[\s\S]*sourceCaptureSnapshotId\s+String/);
    expect(attempt).toMatch(/catalogSnapshot\s+Json[\s\S]*catalogSnapshotHash\s+String/);
    expect(attempt).toMatch(/attributeSchemaSnapshot\s+Json[\s\S]*attributeSchemaHash\s+String/);
    expect(attempt).toMatch(/draftPayloadHash\s+String[\s\S]*draftStateHash\s+String/);
    expect(attempt).toMatch(/requestPayload\s+Json[\s\S]*requestPayloadHash\s+String[\s\S]*offerTrace\s+Json/);
    expect(migration).toContain('Ozon publish attempt immutable fields cannot change');
    expect(migration).toContain('ozon_publish_request_is_valid("request_payload_json", "offer_trace_json", "item_count")');
    expect(migration).toContain("item.value->>'offer_id' IS DISTINCT FROM traced.value->>'offerId'");
  });

  it('enforces tenant ownership, exact revisions, current catalog authority, and submit-once identities', () => {
    expect(migration).toContain('ozon_publish_attempt_workflow_owner_fkey');
    expect(migration).toContain('ozon_publish_attempt_shop_owner_fkey');
    expect(migration).toContain('ozon_publish_attempt_draft_fkey');
    expect(migration).toContain('ozon_publish_attempt_catalog_fkey');
    expect(migration).toContain('workflow_revision <> NEW."revision"');
    expect(migration).toContain('workflow_draft_version <> NEW."draft_version"');
    expect(migration).toContain('catalog."expires_at" > clock_timestamp()');
    expect(migration).toContain('ozon_publish_attempt_owner_idempotency_key');
    expect(migration).toContain('ozon_publish_attempt_shop_task_key');
    expect(migration).toContain('WHERE "ozon_task_id" IS NOT NULL');
  });

  it('models fenced submission and reconciliation leases using the database clock', () => {
    const attempt = modelBlock('OzonPublishAttempt');
    expect(attempt).toMatch(/leasePurpose\s+OzonPublishLeasePurpose\?[\s\S]*leaseToken\s+String\?/);
    expect(attempt).toMatch(/leaseOwner\s+String\?[\s\S]*leaseEpoch\s+Int/);
    expect(migration).toContain('"lease_expires_at" > "heartbeat_at"');
    expect(migration).toContain("\"lease_purpose\" = 'SUBMIT' AND \"state\" = 'SUBMITTING'");
    expect(migration).toContain("\"lease_purpose\" = 'RECONCILE'");
    expect(migration).toContain('ozon_publish_attempt_stale_submit_idx');
    expect(migration).toContain('ozon_publish_attempt_stale_reconcile_idx');
    expect(migration).toContain('clock_timestamp()');
    expect(repository).toContain('"lease_purpose" IN (\'SUBMIT\', \'RECONCILE\')');
  });

  it('fences late acknowledgement and hands later polling to a fresh reconciliation claim', () => {
    expect(repository).toContain("purpose: 'RECONCILE'");
    expect(repository).toContain("current.reconciliationState !== 'RUNNING'");
    expect(repository).toContain('a."lease_owner" = $5 AND a."lease_token" = $6 AND a."lease_epoch" = $7');
    expect(repository).toContain('"reconciliation_state" = \'PENDING\'');
    expect(repository).toContain('"lease_purpose" = NULL, "lease_token" = NULL, "lease_owner" = NULL');
    expect(repository).toContain('"next_reconcile_at" = clock_timestamp()');
    expect(repository).toContain('Late acknowledgement cannot overwrite the original unknown provider response');
    expect(repository).toContain("event_type\" = 'SUBMISSION_CLAIMED'");
    expect(repository).toContain('leaseTokenHash: leaseTokenHash(leaseToken)');
    expect(repository).toContain('sameLeaseTokenHash');
    expect(repository).toContain("'RECOVERED_TASK_RESPONSE'");
    expect(repository).toContain("eventType: 'SUBMISSION_ACKNOWLEDGEMENT_RECOVERED'");
  });

  it('requires an append-only event for every semantic state version', () => {
    expect(migration).toContain('ozon_publish_attempt_event_sequence_key');
    expect(migration).toContain('validate_ozon_publish_attempt_event');
    expect(migration).toContain('require_ozon_publish_attempt_event');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('Ozon publish attempt state transition requires an event');
    expect(migration).toContain('Ozon publish attempt events are immutable');
    expect(migration).toContain('NEW."lease_epoch" IS DISTINCT FROM OLD."lease_epoch"');
  });

  it('bounds persisted JSON and prevents unsupported state regression or automatic resubmission', () => {
    expect(migration).toContain('octet_length(payload::TEXT) > 8388608');
    expect(migration).toContain('octet_length("item_results_json"::TEXT) <= 2097152');
    expect(migration).toContain('octet_length("resolution_evidence_json"::TEXT) <= 262144');
    expect(migration).toContain("OLD.\"state\" = 'SUBMITTING' AND NEW.\"state\" IN ('SUBMITTED', 'UNKNOWN', 'REJECTED')");
    expect(migration).toContain("OLD.\"state\" = 'UNKNOWN' AND NEW.\"state\" IN ('SUBMITTED', 'REJECTED')");
    expect(migration).not.toContain("OLD.\"state\" = 'UNKNOWN' AND NEW.\"state\" = 'PREPARED'");
    expect(migration).toContain('ozon_publish_attempt_state_shape_check');
    expect(migration).toContain('ozon_publish_attempt_completion_check');
  });
});
