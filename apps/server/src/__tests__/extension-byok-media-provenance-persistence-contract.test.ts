import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(resolve(
  root,
  'prisma/migrations/20260725100000_add_extension_byok_media_provenance/migration.sql',
), 'utf8');
const bindingMigration = readFileSync(resolve(
  root,
  'prisma/migrations/20260725105000_bind_extension_byok_media_to_listing_draft/migration.sql',
), 'utf8');
const upgradeRunner = readFileSync(resolve(
  root,
  'scripts/ai-media-postgres-upgrade-integration.mjs',
), 'utf8');

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'u'));
  expect(match, `model ${name} must exist`).not.toBeNull();
  return match?.[0] || '';
}

describe('extension BYOK media provenance persistence contract', () => {
  it('records exact actor, device, shop, draft, asset and Provider identities', () => {
    const model = modelBlock('ExtensionByokMediaProvenance');

    expect(model).toMatch(/contractVersion\s+String[\s\S]*executionMode\s+String/);
    expect(model).toMatch(/ownerUserId\s+String[\s\S]*actorUserId\s+String[\s\S]*deviceSessionId\s+String/);
    expect(model).toMatch(/shopId\s+String[\s\S]*workflowId\s+String[\s\S]*draftRevision\s+Int[\s\S]*draftVersion\s+Int/);
    expect(model).toMatch(/boundDraftRevision\s+Int[\s\S]*boundDraftVersion\s+Int[\s\S]*skuKey\s+String[\s\S]*slotKey\s+String/);
    expect(model).toMatch(/assignmentOrdinal\s+Int[\s\S]*assignmentSha256\s+String[\s\S]*policyRevision\s+Int/);
    expect(model).toMatch(/endpointOriginSha256\s+String[\s\S]*model\s+String[\s\S]*operation\s+AiMediaOperation/);
    expect(model).toMatch(/providerRequestIdSha256\s+String\?[\s\S]*promptSha256\s+String[\s\S]*sourceSha256\s+String\?/);
    expect(model).toMatch(/referenceSha256s\s+String\[\][\s\S]*maskSha256\s+String\?[\s\S]*resultSha256\s+String/);
    expect(model).toMatch(/assetId\s+String[\s\S]*resultMimeType\s+String[\s\S]*resultWidth\s+Int[\s\S]*resultHeight\s+Int/);
    expect(model).toMatch(/publishIntentId\s+String\?[\s\S]*publishReceiptId\s+String\?/);
  });

  it('makes owner-scoped idempotency and zero ERP AI charge permanent', () => {
    const model = modelBlock('ExtensionByokMediaProvenance');

    expect(model).toMatch(/idempotencyKey\s+String[\s\S]*requestHash\s+String/);
    expect(model).toMatch(/erpAiChargeCents\s+Int\s+@default\(0\)/);
    expect(model).toMatch(/@@unique\(\[ownerUserId, idempotencyKey\]/);
    expect(model).toMatch(/@@unique\(\[assetId, ownerUserId\]/);
    expect(migration).toContain('extension_byok_media_provenance_zero_charge_check');
    expect(migration).toContain('"erp_ai_charge_cents" = 0');
    expect(migration).toContain('extension_byok_media_provenance_request_hash_check');
    expect(migration).toContain('extension_byok_media_provenance_owner_idempotency_key');
  });

  it('has no storage surface for raw secrets, Prompts, base64, URLs or Provider bodies', () => {
    const model = modelBlock('ExtensionByokMediaProvenance');

    expect(model).not.toMatch(/\n\s+(apiKey|authorization|rawBase64|providerResultUrl|providerBody|prompt|rawPrompt|endpointUrl)\s+/iu);
    expect(migration).not.toMatch(/"(api_key|authorization|raw_base64|provider_result_url|provider_body|raw_prompt|endpoint_url)"/iu);
    expect(migration).toContain('extension_byok_media_provenance_execution_mode_check');
    expect(migration).toContain('"execution_mode" = \'BYOK\'');
  });

  it('protects immutable provenance while allowing publish IDs to attach once', () => {
    expect(migration).toContain('protect_extension_byok_media_provenance');
    expect(migration).toContain('extension_byok_media_provenance_immutable');
    expect(migration).toContain('extension_byok_media_provenance_publish_binding_check');
    expect(migration).toContain('BYOK media provenance cannot be deleted');
    expect(migration).toContain('BYOK media provenance identity is immutable');
    expect(migration).toContain('BYOK media provenance publish identity cannot be replaced');
  });

  it('rejects secret-bearing model and user-controlled identifiers at the database boundary', () => {
    expect(migration).toContain('extension_byok_identifier_safe');
    expect(migration).toContain('extension_byok_media_provenance_identifier_safety_check');
    expect(migration).toMatch(/\[\?#\]/u);
    expect(migration).toMatch(/data:/iu);
    expect(migration).toMatch(/authorization/iu);
    expect(migration).toContain('api[_-]?key');
  });

  it('extends the media asset identity trigger to every BYOK provenance reference', () => {
    expect(migration).toContain('extension_byok_media_provenance');
    expect(migration).toMatch(/protect_referenced_media_asset_identity[\s\S]*extension_byok_media_provenance/u);
    expect(migration).toMatch(/FROM "media_assets"[\s\S]*FOR SHARE/u);
    expect(migration).toMatch(/media asset identity.*immutable/iu);
  });

  it('requires intent and receipt to resolve to one publish command identity', () => {
    expect(migration).toContain('extension_byok_media_provenance_publish_command_identity_check');
    expect(migration).toContain('BYOK media provenance publish identity must be empty at creation');
    expect(migration).toMatch(/publish_intent_id" IS NULL AND "publish_receipt_id" IS NULL/u);
    expect(migration).toMatch(/publish_intent_id" IS NOT NULL AND "publish_receipt_id" IS NOT NULL/u);
    expect(migration).toMatch(/source_listing_publish_intents[\s\S]*extension_command_receipts[\s\S]*extension_command_grants/u);
    expect(migration).toMatch(/idempotency_key[\s\S]*actor_user_id/u);
    expect(bindingMigration).toContain('extension_byok_media_provenance_bound_draft_fkey');
    expect(bindingMigration).toContain('BYOK media provenance assignment is not present at the bound draft ordinal');
    expect(bindingMigration).toContain('BYOK media provenance publish intent no longer contains the bound assignment');
    expect(bindingMigration).toMatch(/assignment_ordinal[\s\S]*assignment_sha256[\s\S]*policy_revision/u);
  });

  it('applies the populated draft-binding upgrade atomically and in the guarded BYOK order', () => {
    expect(bindingMigration.trimStart()).toMatch(/^BEGIN;/u);
    expect(bindingMigration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(bindingMigration).toContain("SET LOCAL statement_timeout = '15min'");
    expect(bindingMigration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(upgradeRunner).toContain('BYOK_DRAFT_BINDING_MIGRATION');
    expect(upgradeRunner).toContain('BYOK_UPLOAD_STAGING_MIGRATION');
    expect(upgradeRunner).toContain('Extension BYOK migrations must be one unique consecutive upgrade block');
  });
});
