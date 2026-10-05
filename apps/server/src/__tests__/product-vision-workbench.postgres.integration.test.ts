import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSourceProductCaptureV2Submission, type SourceProductCaptureV2, type SourceProductCaptureV2Submission } from 'shared';
import { createPrismaProductVisionOperationStore, PRODUCT_VISION_PROMPT_CONTRACT, type ProductVisionReceipt } from '../services/product-vision-operation-store.js';
import { createPrismaSourceListingAiCopyExecutionStore } from '../services/source-listing-ai-copy-execution.js';
import { createProductVisionWorkbenchService, type ProductVisionWorkbenchOptions } from '../services/product-vision-workbench.js';
import { createPrismaAiUsageStore } from '../services/ai-usage.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createPrismaSourceListingWorkflowContextResolver } from '../services/source-listing-workflow-context.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';

const databaseUrl = process.env.PRODUCT_VISION_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_PRODUCT_VISION_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
if (process.env.PRODUCT_VISION_POSTGRES_TARGET_RUNNER === '1' && !enabled) throw new Error('Product vision PostgreSQL runner must enable its actual tests');
const capture = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const visualDescription = { composition: '居中展示商品', background: '浅色背景', lighting: '柔和光线', style: '电商实物风格',
  observations: { colors: ['白色'], shapes: ['长方形'], visibleComponents: ['提手'], visibleText: [] } };

async function seed(client: PrismaClient) {
  const prefix = `vision_pg_${randomUUID().replaceAll('-', '')}`;
  const ownerUserId = `${prefix}_owner`, shopId = `${prefix}_shop`, supplyGoodsId = `${prefix}_goods`, subjectId = `${prefix}_subject`, snapshotId = `${prefix}_snapshot`;
  const payload = structuredClone(capture.capture);
  const secondSku = { ...structuredClone(payload.skus[0]!), key: 'sku-1', sourceSkuId: 'sku-source-1', ordinal: 1 };
  secondSku.fieldEvidence.sourceSkuId.value = 'sku-source-1'; payload.skus.push(secondSku);
  for (const count of payload.counts) if (count.fieldPath === '/skus') count.totalCount = count.capturedCount = count.submittedCount = 2;
  const snapshot = await createSourceProductCaptureV2Submission(payload);
  await client.$executeRaw`INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES (${ownerUserId}, ${`${prefix}_phone`}, ${'fixture-password-hash'}, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "shops" ("id", "user_id", "platform", "name", "api_key_encrypted", "status", "updated_at")
    VALUES (${shopId}, ${ownerUserId}, 'OZON', ${'isolated fixture shop'}, ${'fixture-encrypted-key'}, 'ACTIVE', CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "supply_goods" ("id", "user_id", "title", "updated_at") VALUES (${supplyGoodsId}, ${ownerUserId}, ${'isolated fixture product'}, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "source_capture_subjects" ("id", "owner_user_id", "source_platform", "source_product_id", "legacy_supply_goods_id", "created_at", "updated_at")
    VALUES (${subjectId}, ${ownerUserId}, '1688', ${prefix}, ${supplyGoodsId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "source_capture_snapshots"
    ("id", "subject_id", "version", "schema_version", "capture_hash", "payload_bytes", "payload", "stage_counts", "provenance", "provenance_complete",
      "parser_version", "completeness", "truncations", "has_estimated_values", "profile_json", "profile_hash", "actor_user_id", "ingest_channel", "rollout_revision", "rollout_stage", "captured_at", "created_at")
    VALUES (${snapshotId}, ${subjectId}, 1, 'source-product-capture-v2', ${snapshot.captureHash}, ${snapshot.payloadBytes}, CAST(${JSON.stringify(snapshot.capture)} AS jsonb),
      '{}'::jsonb, '{}'::jsonb, TRUE, 'product-vision-pg-fixture', '{}'::jsonb, '[]'::jsonb, FALSE, '{}'::jsonb, ${'b'.repeat(64)}, ${ownerUserId},
      'WEB_ACCOUNT', 'product-vision-pg-fixture', 'v2_only', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  const workflow = createSourceListingWorkflowService({ repository: createPrismaSourceListingWorkflowRepository({ client: client as never }) });
  const draft = await workflow.createDraft({ ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId,
    sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: snapshot.captureHash, selectedSkuKeys: ['sku-0'] });
  return { prefix, ownerUserId, shopId, supplyGoodsId, snapshotId, workflow, draft };
}
const bindingFor = (fixture: Awaited<ReturnType<typeof seed>>) => ({ snapshotId: fixture.snapshotId, supplyGoodsId: fixture.supplyGoodsId,
  shopId: fixture.shopId, listingWorkflowId: fixture.draft.id, draftRevision: fixture.draft.revision, draftVersion: fixture.draft.draftVersion });

function visionOptions(client: PrismaClient): ProductVisionWorkbenchOptions {
  return {
    workflow: createSourceListingWorkflowService({ repository: createPrismaSourceListingWorkflowRepository({ client: client as never }) }),
    ownership: createPrismaSourceListingWorkflowContextResolver({ client: client as never }),
    async loadOwnedSnapshot({ ownerUserId, snapshotId }) {
      const row = await client.sourceCaptureSnapshot.findFirst({ where: { id: snapshotId, subject: { ownerUserId } } });
      return row ? { id: row.id, captureHash: row.captureHash, payloadBytes: row.payloadBytes, payload: row.payload as unknown as SourceProductCaptureV2 } : null;
    },
    evaluateCapability: vi.fn(async () => ({ available: true, reasonCode: 'READY', dailyLimit: 10,
      config: { provider: 'custom' as const, baseUrl: 'https://fixture-provider.example/v1', apiKey: 'fixture-local-test', model: 'fixture-vision' } })),
    usageStore: createPrismaAiUsageStore(client), operationStore: createPrismaProductVisionOperationStore({ client: client as never }),
    readImage: vi.fn(async () => ({ mimeType: 'image/jpeg' as const, buffer: Buffer.from('fixture-adapter-image') })),
    analyzeTransport: vi.fn(async () => ({ text: JSON.stringify(visualDescription), usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 } })),
    now: () => new Date('2026-10-05T00:00:00Z'),
  };
}

async function seedPublishGrants(client: PrismaClient, fixture: Awaited<ReturnType<typeof seed>>) {
  const pairingId = `${fixture.prefix}_pairing`, sessionId = `${fixture.prefix}_session`, tokenId = `${fixture.prefix}_jti`;
  await client.$executeRaw`INSERT INTO "extension_device_pairing_codes" ("id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest", "shop_ids", "scopes", "status", "expires_at", "claimed_at", "created_at", "updated_at")
    VALUES (${pairingId}, 'product-vision-pg', ${fixture.ownerUserId}, ${fixture.ownerUserId}, ${hash(pairingId)}, ARRAY[${fixture.shopId}]::text[], ARRAY['listing:write']::text[],
      'CLAIMED', CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "extension_device_sessions" ("id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id", "owner_user_id", "status", "scopes", "current_jti", "expires_at", "created_at", "updated_at")
    VALUES (${sessionId}, ${pairingId}, 'product-vision-pg', ${`${fixture.prefix}_device`}, ${fixture.ownerUserId}, ${fixture.ownerUserId}, 'ACTIVE', ARRAY['listing:write']::text[],
      ${tokenId}, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "extension_device_shop_grants" ("id", "session_id", "shop_id", "status", "granted_at")
    VALUES (${`${fixture.prefix}_shop_grant`}, ${sessionId}, ${fixture.shopId}, 'ACTIVE', CURRENT_TIMESTAMP)`;
  for (const suffix of ['open', 'consumed']) {
    const id = `${fixture.prefix}_grant_${suffix}`;
    await client.$executeRaw`INSERT INTO "extension_command_grants" ("id", "session_id", "token_id", "owner_user_id", "shop_id", "operation", "workflow_id", "draft_version", "idempotency_key", "request_hash", "token_digest", "issued_at", "expires_at", "consumed_at")
      VALUES (${id}, ${sessionId}, ${tokenId}, ${fixture.ownerUserId}, ${fixture.shopId}, 'OZON_PUBLISH', ${fixture.draft.id}, 1,
        ${`${id}_operation`}, ${hash(id)}, ${hash(`${id}_token`)}, CURRENT_TIMESTAMP - INTERVAL '30 seconds', CURRENT_TIMESTAMP + INTERVAL '3 minutes', ${suffix === 'consumed' ? new Date() : null})`;
  }
  return { open: `${fixture.prefix}_grant_open`, consumed: `${fixture.prefix}_grant_consumed` };
}

describe.skipIf(!enabled)('isolated product vision and SKU PostgreSQL evidence', () => {
  let first: PrismaClient, second: PrismaClient;
  beforeAll(async () => {
    const target = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.hostname) || !/^product_vision_test_[a-z0-9_]+$/u.test(target.searchParams.get('schema') || '')) {
      throw new Error('Product vision tests require a local isolated product_vision_test_* schema');
    }
    first = new PrismaClient({ datasourceUrl: databaseUrl }); second = new PrismaClient({ datasourceUrl: databaseUrl });
    const rows = await first.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
    expect(rows[0]?.schema).toBe(target.searchParams.get('schema'));
  });
  afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

  it('claims exactly one cross-instance operation, isolates vision from copy, and preserves unknown state', async () => {
    const owner = `claim_${randomUUID()}`, request = { ownerUserId: owner, draftId: 'isolated-draft', operationKey: 'same-operation', clientRequestHash: hash('request') };
    const a = createPrismaProductVisionOperationStore({ client: first as never }), b = createPrismaProductVisionOperationStore({ client: second as never });
    const outcomes = await Promise.all([a.claim(request), b.claim(request)]);
    expect(outcomes.map((value) => value.kind).sort()).toEqual(['claimed', 'in_progress']);
    expect(outcomes[0]!.executionId).toBe(outcomes[1]!.executionId);
    expect((await b.claim({ ...request, clientRequestHash: hash('changed') })).kind).toBe('conflict');
    const copy = createPrismaSourceListingAiCopyExecutionStore({ client: first as never });
    expect((await copy.claim(request)).kind).toBe('claimed');
    await a.markUnknown(outcomes[0]!.executionId);
    expect((await b.claim(request)).kind).toBe('unknown');
    const rows = await first.$queryRaw<Array<{ operationKey: string }>>`SELECT "operation_key" AS "operationKey" FROM "source_listing_ai_copy_executions" WHERE "owner_user_id" = ${owner}`;
    expect(rows.map(row => row.operationKey).sort()).toEqual(['same-operation', 'vision:same-operation']);
  });

  it('persists JSON receipts with exact SQL identity and reads the original model through a fresh store', async () => {
    const a = createPrismaProductVisionOperationStore({ client: first as never }), b = createPrismaProductVisionOperationStore({ client: second as never });
    const request = { ownerUserId: `receipt_owner_${randomUUID()}`, draftId: 'draft', operationKey: "operation'; DROP TABLE users; --", clientRequestHash: hash('receipt') };
    const receipt: ProductVisionReceipt = { clientRequestHash: request.clientRequestHash, promptContract: PRODUCT_VISION_PROMPT_CONTRACT, result: { visualDescription },
      provider: 'fixture-provider', model: 'original-model', providerConfigHash: hash('old-config'), usage: { totalTokens: 30 } };
    await a.saveReceipt(request, receipt); expect(await b.findReceipt(request)).toEqual(receipt);
    for (const change of [{ ownerUserId: 'foreign' }, { draftId: 'foreign' }, { operationKey: 'foreign' }, { clientRequestHash: hash('foreign') }]) {
      expect(await b.findReceipt({ ...request, ...change })).toBeNull();
    }
    expect((await first.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('users') IS NOT NULL AS present`)[0]?.present).toBe(true);
  });

  it('reads a completed vision result after disconnect/restart, without another Provider adapter call or quota slot', async () => {
    const client = new PrismaClient({ datasourceUrl: databaseUrl });
    const fixture = await seed(client), options = visionOptions(client), identity = { ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, allowedShopIds: [fixture.shopId] };
    const request = { binding: bindingFor(fixture), skuKey: 'sku-0', sourceMediaKeys: ['media-main-0'], operationKey: 'vision-restart-readback' };
    const firstResult = await createProductVisionWorkbenchService(options).analyze(identity, request);
    expect(options.analyzeTransport).toHaveBeenCalledTimes(1); await client.$disconnect();
    const restartedOptions = visionOptions(second);
    restartedOptions.evaluateCapability = vi.fn(async () => ({ available: false, reasonCode: 'VISION_OFF', dailyLimit: 0 }));
    const result = await createProductVisionWorkbenchService(restartedOptions).analyze(identity, request);
    expect(result).toEqual({ ...firstResult, replayed: true }); expect(restartedOptions.analyzeTransport).not.toHaveBeenCalled();
    expect(restartedOptions.readImage).not.toHaveBeenCalled(); expect(restartedOptions.evaluateCapability).not.toHaveBeenCalled();
    const quotas = await second.$queryRaw<Array<{ namespace: string; count: number }>>`SELECT "namespace", "consumed_count" AS count FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`;
    expect(quotas).toEqual([{ namespace: 'product-vision::__reservation__', count: 1 }]);
    const events = await second.$queryRaw<Array<{ count: number; tokens: number }>>`SELECT "request_count" AS count, "total_tokens" AS tokens FROM "ai_usage_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`;
    expect(events).toEqual([{ count: 1, tokens: 30 }]);
    const current = await restartedOptions.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id });
    expect(current).toEqual(fixture.draft);
  });

  it('keeps unknown Provider outcomes durable with their reservation and forbids cross-instance resubmission', async () => {
    const fixture = await seed(first), options = visionOptions(first), identity = { ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, allowedShopIds: [fixture.shopId] };
    options.analyzeTransport = vi.fn(async () => { throw Object.assign(new Error('fixture-unknown'), { outcome: 'UNKNOWN_OUTCOME' }); });
    const request = { binding: bindingFor(fixture), skuKey: 'sku-0', sourceMediaKeys: ['media-main-0'], operationKey: 'vision-unknown-readback' };
    await expect(createProductVisionWorkbenchService(options).analyze(identity, request)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    const restarted = visionOptions(second);
    await expect(createProductVisionWorkbenchService(restarted).analyze(identity, request)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    expect(restarted.analyzeTransport).not.toHaveBeenCalled(); expect(restarted.readImage).not.toHaveBeenCalled();
    const rows = await second.$queryRaw<Array<{ count: number }>>`SELECT "consumed_count" AS count FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`;
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('reserves the vision daily limit atomically across clients without consuming the copy namespace', async () => {
    const actor = `quota_${randomUUID()}`, a = createPrismaAiUsageStore(first), b = createPrismaAiUsageStore(second);
    const input = { namespace: 'product-vision', actorUserId: actor, limit: 1, date: '2026-10-05' };
    const results = await Promise.all([a.reserveDailyLimit!(input), b.reserveDailyLimit!(input)]);
    expect(results.filter(value => value.allowed)).toHaveLength(1);
    expect((await b.reserveDailyLimit!({ ...input, namespace: 'product_title' })).allowed).toBe(true);
    const rows = await first.$queryRaw<Array<{ namespace: string; count: number }>>`SELECT "namespace", "consumed_count" AS count FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${actor} ORDER BY "namespace"`;
    expect(rows).toEqual([{ namespace: 'product-vision::__reservation__', count: 1 }, { namespace: 'product_title::__reservation__', count: 1 }]);
  });

  it('persists a SKU selection once and revokes only unused old publish grants in the same transaction', async () => {
    const fixture = await seed(first), grants = await seedPublishGrants(first, fixture);
    const editor = (client: PrismaClient) => createExtensionListingEditorService({
      workflow: createSourceListingWorkflowService({ repository: createPrismaSourceListingWorkflowRepository({ client: client as never }) }),
      ownership: createPrismaSourceListingWorkflowContextResolver({ client: client as never }), loadCatalog: async () => ({ revision: 'fixture', entries: [] }),
    });
    const identity = { ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, allowedShopIds: [fixture.shopId] };
    const input = { binding: bindingFor(fixture), operationKey: 'sku-select-postgres-1', action: 'SKU_SELECTION' as const, value: { selectedSkuKeys: ['sku-source-1'] } };
    const changed = await editor(first).save(identity, input); const replay = await editor(second).save(identity, input);
    expect(replay).toMatchObject({ replayed: true, data: { binding: changed.data.binding } });
    const current = await fixture.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id });
    expect(current.selectedSkuKeys).toEqual(['sku-1']); expect(current.revision).toBe(2); expect(current.draftVersion).toBe(2);
    expect(current.auditEvents.filter(event => event.type === 'SKU_SELECTION_CHANGED')).toHaveLength(1);
    const rows = await first.$queryRaw<Array<{ id: string; revokedAt: Date | null; consumedAt: Date | null; reason: string | null }>>`
      SELECT "id", "revoked_at" AS "revokedAt", "consumed_at" AS "consumedAt", "revoked_reason"::text AS reason FROM "extension_command_grants" WHERE "id" IN (${grants.open}, ${grants.consumed})`;
    expect(rows.find(row => row.id === grants.open)).toMatchObject({ revokedAt: expect.any(Date), reason: 'WORKFLOW_VERSION_CHANGED', consumedAt: null });
    expect(rows.find(row => row.id === grants.consumed)).toMatchObject({ revokedAt: null, reason: null, consumedAt: expect.any(Date) });
  });

  it('rolls SKU changes back completely if publish-grant revocation fails inside its transaction', async () => {
    const fixture = await seed(first), grants = await seedPublishGrants(first, fixture), functionName = `vision_fixture_${randomUUID().replaceAll('-', '')}`;
    if (!/^vision_fixture_[a-z0-9]+$/u.test(functionName)) throw new Error('Unsafe test function name');
    await first.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$ BEGIN IF OLD.id = '${grants.open}' THEN RAISE EXCEPTION 'isolated grant revoke fixture failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await first.$executeRawUnsafe(`CREATE TRIGGER "${functionName}" BEFORE UPDATE ON "extension_command_grants" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    try {
      await expect(fixture.workflow.changeSkuSelection({ ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, draftId: fixture.draft.id,
        expectedRevision: 1, expectedDraftVersion: 1, operationKey: 'sku-selection-rollback', selectedSkuKeys: ['sku-1'] })).rejects.toThrow();
      expect(await fixture.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id })).toEqual(fixture.draft);
      const grantsRows = await second.$queryRaw<Array<{ revoked: Date | null }>>`SELECT "revoked_at" AS revoked FROM "extension_command_grants" WHERE "id" = ${grants.open}`;
      expect(grantsRows).toEqual([{ revoked: null }]);
    } finally {
      await first.$executeRawUnsafe(`DROP TRIGGER "${functionName}" ON "extension_command_grants"`);
      await first.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });
});
