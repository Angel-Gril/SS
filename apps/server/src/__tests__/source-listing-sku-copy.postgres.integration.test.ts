import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OzonListingDraft, SourceProductCaptureV2Submission } from 'shared';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createPrismaSourceListingWorkflowContextResolver } from '../services/source-listing-workflow-context.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';
import { deriveSourceListingSkuCopyKey } from '../services/source-listing-sku-copies.js';

const databaseUrl = process.env.PRODUCT_VISION_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_PRODUCT_VISION_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
if (process.env.PRODUCT_VISION_POSTGRES_TARGET_RUNNER === '1' && !enabled) throw new Error('SKU copy target runner requires its actual PostgreSQL tests');
const capture = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const workflowFor = (client: PrismaClient) => createSourceListingWorkflowService({ repository: createPrismaSourceListingWorkflowRepository({ client: client as never }) });

async function seed(client: PrismaClient) {
  const prefix = `sku_copy_pg_${randomUUID().replaceAll('-', '')}`, ownerUserId = `${prefix}_owner`, shopId = `${prefix}_shop`,
    supplyGoodsId = `${prefix}_goods`, subjectId = `${prefix}_subject`, snapshotId = `${prefix}_snapshot`;
  await client.$executeRaw`INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES (${ownerUserId}, ${`${prefix}_phone`}, ${'fixture-password'}, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "shops" ("id", "user_id", "platform", "name", "api_key_encrypted", "status", "updated_at") VALUES (${shopId}, ${ownerUserId}, 'OZON', ${'isolated sku copy shop'}, ${'fixture-encrypted-key'}, 'ACTIVE', CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "supply_goods" ("id", "user_id", "title", "updated_at") VALUES (${supplyGoodsId}, ${ownerUserId}, ${'isolated sku copy product'}, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "source_capture_subjects" ("id", "owner_user_id", "source_platform", "source_product_id", "legacy_supply_goods_id", "created_at", "updated_at") VALUES (${subjectId}, ${ownerUserId}, '1688', ${prefix}, ${supplyGoodsId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "source_capture_snapshots" ("id", "subject_id", "version", "schema_version", "capture_hash", "payload_bytes", "payload", "stage_counts", "provenance", "provenance_complete", "parser_version", "completeness", "truncations", "has_estimated_values", "profile_json", "profile_hash", "actor_user_id", "ingest_channel", "rollout_revision", "rollout_stage", "captured_at", "created_at")
    VALUES (${snapshotId}, ${subjectId}, 1, 'source-product-capture-v2', ${capture.captureHash}, ${capture.payloadBytes}, CAST(${JSON.stringify(capture.capture)} AS jsonb), '{}'::jsonb, '{}'::jsonb, TRUE,
      'sku-copy-pg-fixture', '{}'::jsonb, '[]'::jsonb, FALSE, '{}'::jsonb, ${'b'.repeat(64)}, ${ownerUserId}, 'WEB_ACCOUNT', 'sku-copy-pg-fixture', 'v2_only', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  const workflow = workflowFor(client);
  let draft = await workflow.createDraft({ ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId, sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: capture.captureHash, selectedSkuKeys: ['sku-0'] });
  draft = await workflow.setSkuPackaging({ draftId: draft.id, ownerUserId, actorUserId: ownerUserId, expectedRevision: draft.revision, expectedDraftVersion: draft.draftVersion,
    operationKey: 'copy-pg-original-packaging', items: [{ skuKey: 'sku-0', weightG: 500, lengthMm: 200, widthMm: 100, heightMm: 50 }], evidence: ['fixture-operator-measured'] });
  draft = await workflow.setPricing({ draftId: draft.id, ownerUserId, actorUserId: ownerUserId, expectedRevision: draft.revision,
    value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-0', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0', offerId: 'fixture-source-offer' }] } });
  return { prefix, ownerUserId, shopId, supplyGoodsId, snapshotId, workflow, draft };
}
type Seed = Awaited<ReturnType<typeof seed>>;
const bindingFor = (draft: OzonListingDraft) => ({ snapshotId: draft.sourceCaptureSnapshotId, supplyGoodsId: draft.supplyGoodsId, shopId: draft.shopId,
  listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion });
const editorFor = (client: PrismaClient) => createExtensionListingEditorService({ workflow: workflowFor(client),
  ownership: createPrismaSourceListingWorkflowContextResolver({ client: client as never }), loadCatalog: async () => ({ revision: 'fixture', entries: [] }) });
const identityFor = (fixture: Seed) => ({ ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, allowedShopIds: [fixture.shopId] });
const requestFor = (fixture: Seed) => ({ binding: bindingFor(fixture.draft), operationKey: 'copy-pg-same-operation', action: 'SKU_DUPLICATE' as const, value: { sourceSkuKey: 'sku-0' } });
const workflowIdentity = (fixture: Seed) => ({ ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, draftId: fixture.draft.id,
  expectedRevision: fixture.draft.revision, expectedDraftVersion: fixture.draft.draftVersion });

async function grants(client: PrismaClient, fixture: Seed) {
  const pairingId = `${fixture.prefix}_pairing`, sessionId = `${fixture.prefix}_session`, tokenId = `${fixture.prefix}_jti`;
  await client.$executeRaw`INSERT INTO "extension_device_pairing_codes" ("id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest", "shop_ids", "scopes", "status", "expires_at", "claimed_at", "created_at", "updated_at") VALUES (${pairingId}, 'sku-copy-pg', ${fixture.ownerUserId}, ${fixture.ownerUserId}, ${hash(pairingId)}, ARRAY[${fixture.shopId}]::text[], ARRAY['listing:write']::text[], 'CLAIMED', CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "extension_device_sessions" ("id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id", "owner_user_id", "status", "scopes", "current_jti", "expires_at", "created_at", "updated_at") VALUES (${sessionId}, ${pairingId}, 'sku-copy-pg', ${`${fixture.prefix}_device`}, ${fixture.ownerUserId}, ${fixture.ownerUserId}, 'ACTIVE', ARRAY['listing:write']::text[], ${tokenId}, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "extension_device_shop_grants" ("id", "session_id", "shop_id", "status", "granted_at") VALUES (${`${fixture.prefix}_shop_grant`}, ${sessionId}, ${fixture.shopId}, 'ACTIVE', CURRENT_TIMESTAMP)`;
  const entries = [{ suffix: 'open', workflowId: fixture.draft.id, version: fixture.draft.draftVersion, consumedAt: null },
    { suffix: 'consumed', workflowId: fixture.draft.id, version: fixture.draft.draftVersion, consumedAt: new Date() },
    { suffix: 'future', workflowId: fixture.draft.id, version: fixture.draft.draftVersion + 1, consumedAt: null },
    { suffix: 'other', workflowId: `${fixture.prefix}_other`, version: fixture.draft.draftVersion, consumedAt: null }];
  for (const entry of entries) {
    const id = `${fixture.prefix}_grant_${entry.suffix}`;
    await client.$executeRaw`INSERT INTO "extension_command_grants" ("id", "session_id", "token_id", "owner_user_id", "shop_id", "operation", "workflow_id", "draft_version", "idempotency_key", "request_hash", "token_digest", "issued_at", "expires_at", "consumed_at") VALUES (${id}, ${sessionId}, ${tokenId}, ${fixture.ownerUserId}, ${fixture.shopId}, 'OZON_PUBLISH', ${entry.workflowId}, ${entry.version}, ${`${id}_operation`}, ${hash(id)}, ${hash(`${id}_token`)}, CURRENT_TIMESTAMP - INTERVAL '30 seconds', CURRENT_TIMESTAMP + INTERVAL '3 minutes', ${entry.consumedAt})`;
  }
  return entries.map(entry => `${fixture.prefix}_grant_${entry.suffix}`);
}
async function persistedCounts(client: PrismaClient, fixture: Seed) {
  return client.$queryRaw<Array<{ drafts: number; events: number }>>`SELECT
    (SELECT COUNT(*)::int FROM "source_listing_draft_versions" WHERE "workflow_id" = ${fixture.draft.id}) AS drafts,
    (SELECT COUNT(*)::int FROM "source_listing_workflow_events" WHERE "workflow_id" = ${fixture.draft.id}) AS events`;
}

describe.skipIf(!enabled)('SKU copy durable PostgreSQL owner', () => {
  let first: PrismaClient, second: PrismaClient;
  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) || !/^product_vision_test_[a-z0-9_]+$/u.test(url.searchParams.get('schema') || '')) throw new Error('Local isolated test schema required');
    first = new PrismaClient({ datasourceUrl: databaseUrl }); second = new PrismaClient({ datasourceUrl: databaseUrl });
    expect((await first.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`)[0]?.schema).toBe(url.searchParams.get('schema'));
  });
  afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

  it('commits one copy across competing instances, restores it after reconnect, and retains original source identity', async () => {
    const connected = new PrismaClient({ datasourceUrl: databaseUrl }); const fixture = await seed(connected);
    try {
      const request = requestFor(fixture), identity = identityFor(fixture);
      const before = (await connected.$queryRaw<Array<{ hash: string; selection: unknown }>>`SELECT "selected_sku_hash" AS hash, "selected_sku_keys" AS selection FROM "source_listing_workflows" WHERE "id" = ${fixture.draft.id}`)[0]!;
      const [a, b] = await Promise.all([editorFor(connected).save(identity, request), editorFor(second).save(identity, request)]);
      expect(a.data.binding).toEqual(b.data.binding);
      expect(a.data.offerRows?.rows).toHaveLength(1);
      const row = a.data.offerRows!.rows[0]!, rowKey = deriveSourceListingSkuCopyKey(fixture.draft.id, request.operationKey);
      expect(row).toMatchObject({ rowKey, sourceSkuKey: 'sku-0', pricing: { skuKey: rowKey, price: '100', offerId: row.offerId },
        packaging: { weightG: 500, lengthMm: 200, widthMm: 100, heightMm: 50 } });
      const count = await persistedCounts(connected, fixture); await connected.$disconnect();
      const restarted = workflowFor(first), current = await restarted.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id });
      expect(current.offerRows?.rows[0]).toMatchObject({ rowKey, sourceSkuKey: 'sku-0', sourceCaptureSnapshotId: fixture.snapshotId,
        sourceCaptureHash: capture.captureHash, sourceDraftVersion: fixture.draft.draftVersion, sourceDraftRevision: fixture.draft.revision });
      expect(current.selectedSkuKeys).toEqual(['sku-0']); expect(current.sourceCaptureHash).toBe(capture.captureHash);
      expect(current.revision).toBe(fixture.draft.revision + 1); expect(current.draftVersion).toBe(fixture.draft.draftVersion + 1);
      const replay = await editorFor(first).save(identity, request);
      expect(replay.replayed).toBe(true); expect(replay.data.binding).toEqual(a.data.binding); expect(await persistedCounts(first, fixture)).toEqual(count);
      expect((await first.$queryRaw<Array<{ hash: string; selection: unknown }>>`SELECT "selected_sku_hash" AS hash, "selected_sku_keys" AS selection FROM "source_listing_workflows" WHERE "id" = ${fixture.draft.id}`)[0]).toEqual(before);
      const snapshot = await first.sourceCaptureSnapshot.findUniqueOrThrow({ where: { id: fixture.snapshotId } });
      expect(snapshot.captureHash).toBe(capture.captureHash); expect(snapshot.payload).toEqual(capture.capture);
      await expect(editorFor(first).save(identity, { ...request, value: { sourceSkuKey: 'not-current' } })).rejects.toMatchObject({ statusCode: 409 });
    } finally { await connected.$disconnect(); }
  });

  it('revokes unused old publish grants atomically while preserving consumed, future and other workflow grants', async () => {
    const fixture = await seed(first); await grants(first, fixture);
    await editorFor(first).save(identityFor(fixture), requestFor(fixture));
    const rows = await second.$queryRaw<Array<{ id: string; revokedAt: Date | null; consumedAt: Date | null; reason: string | null }>>`SELECT "id", "revoked_at" AS "revokedAt", "consumed_at" AS "consumedAt", "revoked_reason"::text AS reason FROM "extension_command_grants" WHERE "owner_user_id" = ${fixture.ownerUserId}`;
    expect(rows.find(row => row.id.endsWith('_open'))).toMatchObject({ revokedAt: expect.any(Date), reason: 'WORKFLOW_VERSION_CHANGED', consumedAt: null });
    expect(rows.find(row => row.id.endsWith('_consumed'))).toMatchObject({ revokedAt: null, reason: null, consumedAt: expect.any(Date) });
    for (const suffix of ['_future', '_other']) expect(rows.find(row => row.id.endsWith(suffix))).toMatchObject({ revokedAt: null, consumedAt: null, reason: null });
  });

  it('rolls copy payload, audit, price, packaging and grant revocation back if a revoke statement fails', async () => {
    const fixture = await seed(first), ids = await grants(first, fixture), functionName = `sku_copy_fixture_${randomUUID().replaceAll('-', '')}`;
    if (!/^sku_copy_fixture_[a-z0-9]+$/u.test(functionName)) throw new Error('Unsafe fixture function identifier');
    const before = await persistedCounts(first, fixture);
    await first.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$ BEGIN IF OLD.id = '${ids[0]}' THEN RAISE EXCEPTION 'isolated sku copy revoke failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await first.$executeRawUnsafe(`CREATE TRIGGER "${functionName}" BEFORE UPDATE ON "extension_command_grants" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    try {
      await expect(fixture.workflow.duplicateSku({ ...workflowIdentity(fixture), operationKey: 'copy-pg-rollback', sourceSkuKey: 'sku-0' })).rejects.toThrow();
      expect(await workflowFor(second).getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id })).toEqual(fixture.draft);
      expect(await persistedCounts(second, fixture)).toEqual(before);
      const rows = await second.$queryRaw<Array<{ revokedAt: Date | null }>>`SELECT "revoked_at" AS "revokedAt" FROM "extension_command_grants" WHERE "id" = ${ids[0]}`;
      expect(rows).toEqual([{ revokedAt: null }]);
    } finally { await first.$executeRawUnsafe(`DROP TRIGGER "${functionName}" ON "extension_command_grants"`); await first.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`); }
  });

  it('refuses a persisted copy with corrupt source mapping or provenance without another write', async () => {
    for (const field of ['sourceSkuKey', 'sourceCaptureHash', 'rowKey'] as const) {
      const fixture = await seed(first), created = await fixture.workflow.duplicateSku({ ...workflowIdentity(fixture), operationKey: 'copy-pg-corrupt-original', sourceSkuKey: 'sku-0' });
      const corrupted = structuredClone(created); corrupted.revision += 1; corrupted.draftVersion += 1;
      corrupted.offerRows!.rows[0]![field] = field === 'sourceCaptureHash' ? 'f'.repeat(64) : field === 'rowKey' ? `listing-copy:${'f'.repeat(64)}` : 'foreign-source-sku';
      await expect(first.$executeRaw`UPDATE "source_listing_draft_versions" SET "payload" = CAST(${JSON.stringify(corrupted)} AS jsonb) WHERE "workflow_id" = ${created.id} AND "revision" = ${created.revision}`).rejects.toThrow('immutable');
      // Insert the hostile fixture as a new version through the repository seam; keep the database immutability guard enabled.
      await createPrismaSourceListingWorkflowRepository({ client: first as never }).compareAndSwap({ draftId: created.id,
        ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, expectedRevision: created.revision, next: corrupted });
      const before = await persistedCounts(first, fixture);
      await expect(editorFor(second).read(identityFor(fixture), bindingFor(corrupted))).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
      await expect(workflowFor(second).duplicateSku({ ...workflowIdentity(fixture), expectedRevision: corrupted.revision,
        expectedDraftVersion: corrupted.draftVersion, operationKey: 'copy-pg-corrupt-rejected', sourceSkuKey: 'sku-0' })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
      expect(await persistedCounts(second, fixture)).toEqual(before);
    }
  });
});
