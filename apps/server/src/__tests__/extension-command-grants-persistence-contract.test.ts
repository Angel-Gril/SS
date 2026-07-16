import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migrationUrl = new URL(
  '../../prisma/migrations/20260714190000_add_extension_command_grants/migration.sql',
  import.meta.url,
);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';

function modelBlock(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

describe('extension command grant persistence contract', () => {
  it('stores command bindings and only the keyed grant token digest', () => {
    const grant = modelBlock('ExtensionCommandGrant');

    expect(schema).toMatch(/enum ExtensionCommandOperation[\s\S]*SOURCE_CAPTURE[\s\S]*LISTING_WRITE[\s\S]*LISTING_REVIEW[\s\S]*MEDIA_EXECUTE[\s\S]*OZON_PUBLISH/);
    expect(grant).toMatch(/sessionId\s+String[\s\S]*tokenId\s+String[\s\S]*ownerUserId\s+String/);
    expect(grant).toMatch(/shopId\s+String\?[\s\S]*operation\s+ExtensionCommandOperation/);
    expect(grant).toMatch(/workflowId\s+String\?[\s\S]*draftVersion\s+Int\?/);
    expect(grant).toMatch(/idempotencyKey\s+String[\s\S]*requestHash\s+String[\s\S]*tokenDigest\s+String\s+@unique/);
    expect(grant).toMatch(/revokedAt\s+DateTime\?[\s\S]*revokedReason\s+ExtensionDeviceRevocationReason\?/);
    expect(grant).not.toMatch(/\n\s+(token|secret)\s+String/);
    expect(migration).toContain('extension_command_grant_request_hash_check');
    expect(migration).toContain('extension_command_grant_token_digest_check');
  });

  it('makes issuance idempotent per device session and request key', () => {
    const grant = modelBlock('ExtensionCommandGrant');

    expect(grant).toMatch(/@@unique\(\[sessionId, idempotencyKey\]\)/);
    expect(grant).toMatch(/@@index\(\[ownerUserId, operation, issuedAt\]\)/);
    expect(grant).toMatch(/@@index\(\[shopId, operation, issuedAt\]\)/);
    expect(grant).toMatch(/@@index\(\[workflowId, draftVersion, operation\]\)/);
    expect(migration).toContain('extension_command_grants_session_id_idempotency_key_key');
    expect(migration).toContain('length(btrim("idempotency_key")) BETWEEN 16 AND 200');
  });

  it('constrains grant lifetimes, publish bindings and monotonic state timestamps', () => {
    expect(migration).toContain('extension_command_grant_time_check');
    expect(migration).toContain('extension_command_grant_publish_binding_check');
    expect(migration).toContain('extension_command_grant_workflow_version_check');
    expect(migration).toContain('extension_command_grant_revocation_check');
    expect(migration).toContain('"expires_at" > "issued_at"');
    expect(migration).toContain('"expires_at" <= "issued_at" + INTERVAL \'5 minutes\'');
    expect(migration).toContain('"consumed_at" < "expires_at"');
    expect(migration).toContain('"draft_version" IS NULL OR "draft_version" > 0');
    expect(migration).toContain('NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL)');
    expect(migration).toContain('prevent_extension_command_grant_rewrite');
    expect(migration).toContain('extension_command_grants_protect');
    expect(migration).toContain('validate_extension_command_grant_binding');
    expect(migration).toContain('extension_command_grants_binding_validate');
  });

  it('stores exactly one durable receipt with a valid status shape', () => {
    const receipt = modelBlock('ExtensionCommandReceipt');

    expect(schema).toMatch(/enum ExtensionCommandReceiptStatus[\s\S]*PENDING[\s\S]*SUCCEEDED[\s\S]*FAILED/);
    expect(receipt).toMatch(/grantId\s+String\s+@unique/);
    expect(receipt).toMatch(/status\s+ExtensionCommandReceiptStatus\s+@default\(PENDING\)/);
    expect(receipt).toMatch(/result\s+Json\?[\s\S]*failureCode\s+String\?[\s\S]*completedAt\s+DateTime\?/);
    expect(migration).toContain('extension_command_receipt_status_shape_check');
    expect(migration).toContain('extension_command_receipts_grant_id_key');
    expect(migration).toContain('validate_extension_command_receipt_insert');
    expect(migration).toContain('extension_command_receipts_validate');
    expect(migration).toContain('NEW."created_at" IS DISTINCT FROM grant_consumed_at');
  });

  it('allows one pending-to-final receipt transition and otherwise keeps receipts immutable', () => {
    expect(migration).toContain('prevent_extension_command_receipt_rewrite');
    expect(migration).toContain('extension_command_receipts_immutable');
    expect(migration).toContain("OLD.\"status\" <> 'PENDING'");
    expect(migration).toContain("NEW.\"status\" NOT IN ('SUCCEEDED', 'FAILED')");
  });

  it('retains command history when sessions, owners, shops or grants are deleted', () => {
    for (const relation of [
      'extension_command_grants_session_id_fkey',
      'extension_command_grants_owner_user_id_fkey',
      'extension_command_grants_shop_id_fkey',
      'extension_command_receipts_grant_id_fkey',
      'extension_command_grants_session_owner_fkey',
      'extension_command_grants_session_shop_fkey',
    ]) {
      const block = migration.match(new RegExp(
        `ADD CONSTRAINT "${relation}"[\\s\\S]*?ON DELETE (?:RESTRICT|CASCADE|SET NULL) ON UPDATE`,
      ))?.[0] || '';
      expect(block, relation).toContain('ON DELETE RESTRICT');
    }
    expect(modelBlock('ExtensionCommandGrant')).not.toContain('onDelete: Cascade');
    expect(modelBlock('ExtensionCommandReceipt')).not.toContain('onDelete: Cascade');
  });
});
