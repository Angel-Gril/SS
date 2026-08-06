import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migrationUrl = new URL(
  '../../prisma/migrations/20260712170500_add_extension_device_sessions/migration.sql',
  import.meta.url,
);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, 'utf8') : '';
const replacementLineageMigrationUrl = new URL(
  '../../prisma/migrations/20260806190000_add_extension_device_session_replacement_lineage/migration.sql',
  import.meta.url,
);
const replacementLineageMigration = existsSync(replacementLineageMigrationUrl)
  ? readFileSync(replacementLineageMigrationUrl, 'utf8')
  : '';

function modelBlock(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

describe('extension device persistence contract', () => {
  it('serializes active-session replacement by owner, deployment, and device', () => {
    const repository = readFileSync(
      new URL('../services/extension-device-session-prisma.ts', import.meta.url),
      'utf8',
    );
    expect(repository).toContain('pg_advisory_xact_lock(hashtextextended($1, 0))');
    expect(repository).toContain('SELECT 1::int AS "locked" FROM device_lock');
    expect(repository).toMatch(
      /owner_user_id" = \$1[\s\S]*deployment_id" = \$2[\s\S]*device_id" = \$3[\s\S]*status" = 'ACTIVE'/,
    );
  });

  it('records one immutable direct predecessor for a replacement session', () => {
    const session = modelBlock('ExtensionDeviceSession');
    const repository = readFileSync(
      new URL('../services/extension-device-session-prisma.ts', import.meta.url),
      'utf8',
    );

    expect(session).toMatch(/replacesSessionId\s+String\?\s+@unique/);
    expect(session).toMatch(/replacesSession\s+ExtensionDeviceSession\?/);
    expect(session).toMatch(/replacedBySession\s+ExtensionDeviceSession\?/);
    expect(replacementLineageMigration).toContain('replaces_session_id');
    expect(replacementLineageMigration).toContain('extension_device_sessions_replaces_session_id_key');
    expect(replacementLineageMigration).toContain('extension_device_sessions_replaces_session_id_fkey');
    expect(replacementLineageMigration).toContain('prevent_extension_device_session_replacement_rewrite');
    expect(replacementLineageMigration).toContain('extension_byok_publish_session_matches');
    expect(replacementLineageMigration).toContain('command_session."status" = \'ACTIVE\'');
    expect(replacementLineageMigration).toContain('command_grant."status" = \'ACTIVE\'');
    expect(replacementLineageMigration).toContain('validate_extension_byok_media_provenance_authority()');
    expect(replacementLineageMigration).toContain('BYOK provenance publish receipt guard has unexpected definition');
    expect(replacementLineageMigration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(repository).toContain('replacesSessionId');
  });

  it('stores only keyed digests for pairing and refresh credentials', () => {
    const pairing = modelBlock('ExtensionDevicePairingCode');
    const refresh = modelBlock('ExtensionDeviceRefreshCredential');

    expect(pairing).toMatch(/codeDigest\s+String\s+@unique/);
    expect(refresh).toMatch(/credentialDigest\s+String\s+@unique/);
    expect(pairing).not.toMatch(/\n\s+(code|secret|token)\s+String/);
    expect(refresh).not.toMatch(/\n\s+(secret|token)\s+String/);
  });

  it('represents one-time pairing and revocable scoped sessions', () => {
    expect(schema).toMatch(/enum ExtensionDevicePairingStatus[\s\S]*PENDING[\s\S]*CLAIMED[\s\S]*CANCELED/);
    expect(schema).toMatch(/model ExtensionDevicePairingCode[\s\S]*shopIds\s+String\[\][\s\S]*scopes\s+String\[\]/);
    expect(schema).toMatch(/model ExtensionDeviceSession[\s\S]*pairingCodeId\s+String\s+@unique/);
    expect(schema).toMatch(/model ExtensionDeviceSession[\s\S]*deploymentId\s+String[\s\S]*deviceId\s+String/);
    expect(schema).toMatch(/model ExtensionDeviceSession[\s\S]*currentJti\s+String\s+@unique/);
    expect(schema).toMatch(/model ExtensionDeviceSession[\s\S]*expiresAt\s+DateTime[\s\S]*revokedAt\s+DateTime\?/);
  });

  it('retains refresh history so replay can revoke the whole family', () => {
    expect(schema).toMatch(/model ExtensionDeviceRefreshFamily[\s\S]*sessionId\s+String\s+@unique/);
    expect(schema).toMatch(/model ExtensionDeviceRefreshFamily[\s\S]*status\s+ExtensionDeviceRefreshFamilyStatus/);
    expect(schema).toMatch(/model ExtensionDeviceRefreshCredential[\s\S]*familyId\s+String[\s\S]*consumedAt\s+DateTime\?/);
    expect(schema).toMatch(/model ExtensionDeviceRefreshCredential[\s\S]*generation\s+Int/);
    expect(schema).toMatch(/model ExtensionDeviceRefreshCredential[\s\S]*replacedById\s+String\?/);
    expect(schema).toMatch(/model ExtensionDeviceRefreshCredential[\s\S]*@@unique\(\[familyId, generation\]\)/);
    expect(migration).toContain('extension_device_refresh_credential_rotation_check');
    expect(migration).toContain('extension_device_refresh_credentials');
    expect(migration).toContain('extension_device_refresh_credential_digest_check');
    expect(migration).toContain('extension_device_refresh_family_revocation_check');
  });

  it('keeps active and revoked shop grants distinguishable', () => {
    expect(schema).toMatch(/enum ExtensionDeviceShopGrantStatus[\s\S]*ACTIVE[\s\S]*REVOKED/);
    expect(schema).toMatch(/model ExtensionDeviceShopGrant[\s\S]*sessionId\s+String[\s\S]*shopId\s+String/);
    expect(schema).toMatch(/model ExtensionDeviceShopGrant[\s\S]*@@unique\(\[sessionId, shopId\]\)/);
    expect(migration).toContain('extension_device_shop_grant_revocation_check');
    expect(migration).toContain('extension_device_shop_grants_session_id_shop_id_key');
  });

  it('retains assignment authorization tombstones for 404 versus 410 decisions', () => {
    const grant = modelBlock('ExtensionDeviceAssignmentGrant');

    expect(schema).toMatch(/enum ExtensionDeviceAssignmentGrantStatus[\s\S]*ACTIVE[\s\S]*REVOKED/);
    expect(migration).toContain('extension_device_shop_grants_tombstone');
    expect(migration).toContain('prevent_extension_device_shop_grant_rewrite');
    expect(grant).toMatch(/sessionId\s+String[\s\S]*assignmentId\s+String[\s\S]*shopId\s+String/);
    expect(grant).toMatch(/scopeKeyHash\s+String/);
    expect(grant).toMatch(/revokedReason\s+ExtensionDeviceRevocationReason\?/);
    expect(grant).toMatch(/firstDeliveredAt\s+DateTime\?[\s\S]*lastAuthorizedAt\s+DateTime\?/);
    expect(grant).toMatch(/@@unique\(\[sessionId, assignmentId\]\)/);
    expect(migration).toContain('extension_device_assignment_grants');
    expect(migration).toContain('extension_device_assignment_grant_revocation_check');
    expect(migration).toContain('extension_device_assignment_grants_assignment_shop_fkey');
  });

  it('adds database constraints needed by atomic claim and rotation', () => {
    expect(migration).toContain('extension_device_pairing_status_timestamps_check');
    expect(migration).toContain('extension_device_pairing_codes_code_digest_key');
    expect(migration).toContain('extension_device_sessions_pairing_code_id_key');
    expect(migration).toContain('extension_device_sessions_current_jti_key');
    expect(migration).toContain('extension_device_refresh_credentials_credential_digest_key');
    expect(migration).toContain('extension_device_assignment_grants_tombstone');
    expect(migration).toContain('prevent_extension_device_assignment_grant_rewrite');
    expect(migration).toContain('extension_device_session_revocation_check');
  });

  it('records idempotent release apply receipts bound to the published checksum', () => {
    expect(schema).toMatch(/enum LogisticsRuleReleaseAckStatus[\s\S]*APPLIED[\s\S]*FAILED/);
    expect(schema).toMatch(/model LogisticsRuleReleaseAck[\s\S]*sessionId\s+String/);
    expect(schema).toMatch(/model LogisticsRuleReleaseAck[\s\S]*releaseId\s+String[\s\S]*effectiveChecksum\s+String/);
    expect(schema).toMatch(/model LogisticsRuleReleaseAck[\s\S]*assignmentId\s+String/);
    expect(schema).toMatch(/model LogisticsRuleReleaseAck[\s\S]*idempotencyKey\s+String\s+@unique/);
    expect(schema).toMatch(/model LogisticsRuleReleaseAck[\s\S]*@@unique\(\[sessionId, assignmentId, releaseId, effectiveChecksum\]\)/);
    expect(migration).toContain('logistics_rule_release_acks_release_checksum_fkey');
    expect(migration).toContain('logistics_rule_release_ack_status_shape_check');
    expect(migration).toContain('logistics_rule_release_acks_session_assignment_release_checksum_key');
  });

  it('records one sanitized refresh-reuse event per credential family', () => {
    const event = modelBlock('ExtensionDeviceSecurityEvent');

    expect(schema).toMatch(/enum ExtensionDeviceSecurityEventType[\s\S]*PAIRING_CLAIMED[\s\S]*SESSION_REVOKED[\s\S]*REFRESH_REUSE_DETECTED/);
    expect(event).toMatch(/sessionId\s+String/);
    expect(event).toMatch(/refreshFamilyId\s+String\?/);
    expect(event).toMatch(/actorUserId\s+String\?/);
    expect(schema).toMatch(/enum ExtensionDeviceRevocationReason[\s\S]*OWNER_REVOKED[\s\S]*REFRESH_REUSE_DETECTED[\s\S]*ASSIGNMENT_REVOKED/);
    expect(event).toMatch(/reasonCode\s+ExtensionDeviceRevocationReason/);
    expect(event).not.toMatch(/Json|digest|secret|token/i);
    expect(migration).toContain('extension_device_security_events_family_session_fkey');
    expect(migration).toContain('extension_device_security_events_refresh_reuse_once');
    expect(migration).toContain("WHERE \"type\" = 'REFRESH_REUSE_DETECTED'");
  });

  it('makes security events and release acknowledgements immutable', () => {
    expect(migration).toContain('prevent_extension_device_audit_mutation');
    expect(migration).toContain('extension_device_security_events_immutable');
    expect(migration).toContain('logistics_rule_release_acks_immutable');
  });

  it('prevents account and pairing deletion from cascading through device history', () => {
    for (const relation of [
      'extension_device_pairing_codes_actor_user_id_fkey',
      'extension_device_pairing_codes_owner_user_id_fkey',
      'extension_device_sessions_pairing_code_id_fkey',
      'extension_device_sessions_actor_user_id_fkey',
      'extension_device_sessions_owner_user_id_fkey',
      'extension_device_refresh_families_session_id_fkey',
      'extension_device_refresh_credentials_family_id_fkey',
    ]) {
      const block = migration.match(new RegExp(
        `ADD CONSTRAINT "${relation}"[\\s\\S]*?ON DELETE (?:RESTRICT|CASCADE) ON UPDATE`,
      ))?.[0] || '';
      expect(block, relation).toContain('ON DELETE RESTRICT');
    }
    for (const model of [
      'ExtensionDevicePairingCode',
      'ExtensionDeviceSession',
      'ExtensionDeviceRefreshFamily',
      'ExtensionDeviceRefreshCredential',
    ]) {
      expect(modelBlock(model)).not.toContain('onDelete: Cascade');
    }
  });

  it('constrains release receipt failure codes and key length at the database boundary', () => {
    expect(migration).toContain('length(btrim("idempotency_key")) BETWEEN 16 AND 200');
    for (const code of [
      'checksum_mismatch',
      'schema_unsupported',
      'storage_quota',
      'scope_mismatch',
      'apply_failed',
    ]) {
      expect(migration).toContain(`'${code}'`);
    }
    expect(migration).not.toContain('"failure_code" ~');
  });
});
