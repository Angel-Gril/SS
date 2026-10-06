import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSourceProductCaptureV2Submission, type SourceProductCaptureV2, type SourceProductCaptureV2Submission, type OzonNormalizedAttributeSchema } from 'shared';
import { createPrismaProductPreparationOperationStore, PRODUCT_PREPARATION_PROMPT_CONTRACT, type ProductPreparationReceipt } from '../services/product-preparation-operation-store.js';
import { createPrismaProductVisionOperationStore } from '../services/product-vision-operation-store.js';
import { createPrismaSourceListingAiCopyExecutionStore } from '../services/source-listing-ai-copy-execution.js';
import { createProductPreparationWorkbenchService, type ProductPreparationWorkbenchOptions } from '../services/product-preparation-workbench.js';
import { createPrismaAiUsageStore } from '../services/ai-usage.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createPrismaSourceListingWorkflowContextResolver } from '../services/source-listing-workflow-context.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

// Reuse the existing isolated-local runner contract; skipped tests are never PostgreSQL evidence.
const databaseUrl = process.env.PRODUCT_VISION_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_PRODUCT_VISION_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
if (process.env.PRODUCT_VISION_POSTGRES_TARGET_RUNNER === '1' && !enabled) throw new Error('Preparation PostgreSQL runner must enable its actual tests');
const captured = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const schemaRevision = 'a'.repeat(64);
const visualDescription = { composition: '居中展示商品', background: '浅色背景', lighting: '柔和光线', style: '实物风格',
  observations: { colors: ['白色'], shapes: ['长方形'], visibleComponents: [], visibleText: [] } };
const report = { contractVersion: PRODUCT_PREPARATION_PROMPT_CONTRACT, reviewState: 'CANDIDATE' as const,
  curation: [{ sourceMediaKey: 'media-main-0', decision: 'KEEP' as const, reason: '商品清晰' }], visualDescription,
  productSummary: { observations: ['白色长方形'], uncertainties: ['无法确定材质'] },
  skuObservations: [{ skuKey: 'sku-0', observations: ['白色'], titleRu: 'Белый органайзер' }],
  suggestedAttributes: [{ attributeId: 10, value: 'Белый', dictionaryValueId: 100,
    evidence: { sourceMediaKeys: ['media-main-0'], observation: '图中可见白色' }, manualReview: 'REQUIRED' as const }],
  copy: { titleRu: 'Белый органайзер', descriptionRu: 'Органайзер белого цвета.', tagsRu: ['органайзер'] } };

async function seed(client: PrismaClient, input: { twoSkus?: boolean } = {}) {
  const prefix = `preparation_pg_${randomUUID().replaceAll('-', '')}`;
  const ownerUserId = `${prefix}_owner`, shopId = `${prefix}_shop`, supplyGoodsId = `${prefix}_goods`, subjectId = `${prefix}_subject`, snapshotId = `${prefix}_snapshot`;
  const payload = structuredClone(captured.capture);
  if (input.twoSkus) {
    const second = { ...structuredClone(payload.skus[0]!), key: 'sku-1', sourceSkuId: 'sku-source-1', ordinal: 1 };
    second.fieldEvidence.sourceSkuId.value = 'sku-source-1'; payload.skus.push(second);
    for (const count of payload.counts) if (count.fieldPath === '/skus') count.totalCount = count.capturedCount = count.submittedCount = 2;
  }
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
      '{}'::jsonb, '{}'::jsonb, TRUE, 'preparation-pg-fixture', '{}'::jsonb, '[]'::jsonb, FALSE, '{}'::jsonb, ${'b'.repeat(64)}, ${ownerUserId},
      'WEB_ACCOUNT', 'preparation-pg-fixture', 'v2_only', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  const workflow = createSourceListingWorkflowService({ repository: createPrismaSourceListingWorkflowRepository({ client: client as never }) });
  const initial = await workflow.createDraft({ ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId,
    sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: snapshot.captureHash, selectedSkuKeys: input.twoSkus ? ['sku-0', 'sku-1'] : ['sku-0'] });
  const draft = await workflow.setCategory({ ownerUserId, actorUserId: ownerUserId, draftId: initial.id, expectedRevision: initial.revision,
    category: { categoryId: 1, typeId: 2, catalogRevision: 'fixture-catalog', categoryName: 'Дом', typeName: 'Органайзер' } });
  const identity = { ownerUserId, actorUserId: ownerUserId, allowedShopIds: [shopId] };
  const binding = { snapshotId, supplyGoodsId, shopId, listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion };
  return { prefix, ownerUserId, shopId, supplyGoodsId, snapshotId, workflow, draft, identity, binding };
}
function preparationOptions(client: PrismaClient, input: { skuField?: boolean } = {}): ProductPreparationWorkbenchOptions {
  return {
    workflow: createSourceListingWorkflowService({ repository: createPrismaSourceListingWorkflowRepository({ client: client as never }) }),
    ownership: createPrismaSourceListingWorkflowContextResolver({ client: client as never }),
    async loadOwnedSnapshot({ ownerUserId, snapshotId }) {
      const row = await client.sourceCaptureSnapshot.findFirst({ where: { id: snapshotId, subject: { ownerUserId } } });
      return row ? { id: row.id, captureHash: row.captureHash, payloadBytes: row.payloadBytes, payload: row.payload as unknown as SourceProductCaptureV2 } : null;
    },
    async loadAttributeContext({ draft }) {
      const schema: OzonNormalizedAttributeSchema = { schemaVersion: 'ozon-attribute-schema/v1', shopId: draft.shopId, descriptionCategoryId: 1,
        typeId: 2, language: 'RU', catalogRevision: 'fixture-catalog', definitionsHash: 'fixture-definitions', fields: [{ attributeId: 10,
          name: 'Цвет', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'SINGLE', required: false, dictionaryId: 1,
          valuePolicy: 'STRICT_DICTIONARY', ownership: input.skuField ? 'SKU' : 'EDITOR', editorMode: input.skuField ? 'SKU_MATRIX' : 'EDITABLE', aiSuggestionAllowed: true }] };
      return { schema, schemaRevision, dictionaries: { '10': [{ id: 100, value: 'Белый' }] } };
    },
    evaluateCapability: vi.fn(async () => ({ available: true, reasonCode: 'READY', dailyLimit: 10,
      config: { provider: 'custom' as const, baseUrl: 'https://fixture-provider.example/v1', apiKey: 'fixture-local-test', model: 'fixture-vision' } })),
    usageStore: createPrismaAiUsageStore(client), operationStore: createPrismaProductPreparationOperationStore({ client: client as never }),
    readImage: vi.fn(async () => ({ mimeType: 'image/jpeg' as const, buffer: Buffer.from('fixture-safe-image-adapter') })),
    analyzeTransport: vi.fn(async () => ({ text: JSON.stringify(report), usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 } })),
    validateByokReadiness: vi.fn(async () => ({ available: true })), now: () => new Date('2026-10-05T00:00:00Z'),
  };
}
const analyzeInput = (fixture: Awaited<ReturnType<typeof seed>>, operationKey: string) => ({ binding: fixture.binding, skuKey: 'sku-0',
  sourceMediaKeys: ['media-main-0'], operationKey, categoryRevision: { catalogRevision: 'fixture-catalog', schemaRevision } });
const stageTransport = () => vi.fn<ProductPreparationWorkbenchOptions['analyzeTransport']>(async ({ prompt }) => ({
  text: JSON.stringify(prompt.includes('STAGE:CURATION') ? { curation: report.curation } : prompt.includes('STAGE:VISION')
    ? { visualDescription: report.visualDescription, productSummary: report.productSummary, skuObservations: report.skuObservations }
    : { suggestedAttributes: report.suggestedAttributes, copy: report.copy }),
  usage: { promptTokens: 12, completionTokens: 18, totalTokens: 30 },
}));
async function publishGrant(client: PrismaClient, fixture: Awaited<ReturnType<typeof seed>>) {
  const pairing = `${fixture.prefix}_pairing`, session = `${fixture.prefix}_session`, token = `${fixture.prefix}_token`, grant = `${fixture.prefix}_grant`;
  await client.$executeRaw`INSERT INTO "extension_device_pairing_codes" ("id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest", "shop_ids", "scopes", "status", "expires_at", "claimed_at", "created_at", "updated_at")
    VALUES (${pairing}, 'preparation-pg', ${fixture.ownerUserId}, ${fixture.ownerUserId}, ${hash(pairing)}, ARRAY[${fixture.shopId}]::text[], ARRAY['listing:write']::text[],
      'CLAIMED', CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "extension_device_sessions" ("id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id", "owner_user_id", "status", "scopes", "current_jti", "expires_at", "created_at", "updated_at")
    VALUES (${session}, ${pairing}, 'preparation-pg', ${`${fixture.prefix}_device`}, ${fixture.ownerUserId}, ${fixture.ownerUserId}, 'ACTIVE', ARRAY['listing:write']::text[],
      ${token}, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "extension_device_shop_grants" ("id", "session_id", "shop_id", "status", "granted_at")
    VALUES (${`${fixture.prefix}_shop_grant`}, ${session}, ${fixture.shopId}, 'ACTIVE', CURRENT_TIMESTAMP)`;
  await client.$executeRaw`INSERT INTO "extension_command_grants" ("id", "session_id", "token_id", "owner_user_id", "shop_id", "operation", "workflow_id", "draft_version", "idempotency_key", "request_hash", "token_digest", "issued_at", "expires_at")
    VALUES (${grant}, ${session}, ${token}, ${fixture.ownerUserId}, ${fixture.shopId}, 'OZON_PUBLISH', ${fixture.draft.id}, ${fixture.draft.draftVersion},
      ${`${grant}_operation`}, ${hash(grant)}, ${hash(`${grant}_token`)}, CURRENT_TIMESTAMP - INTERVAL '30 seconds', CURRENT_TIMESTAMP + INTERVAL '3 minutes')`;
  return grant;
}

describe.skipIf(!enabled)('isolated continuous preparation PostgreSQL evidence', () => {
  let first: PrismaClient, second: PrismaClient;
  beforeAll(async () => {
    const target = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.hostname) || !/^product_vision_test_[a-z0-9_]+$/u.test(target.searchParams.get('schema') || '')) {
      throw new Error('Preparation tests require a local isolated product_vision_test_* schema');
    }
    first = new PrismaClient({ datasourceUrl: databaseUrl }); second = new PrismaClient({ datasourceUrl: databaseUrl });
    expect((await first.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`)[0]?.schema).toBe(target.searchParams.get('schema'));
  });
  afterAll(async () => { await Promise.all([first?.$disconnect(), second?.$disconnect()]); });

  it('durably checkpoints all three stages across clients and applies/replays only the final COPY candidates', async () => {
    const fixture = await seed(first), original = analyzeInput(fixture, 'staged-preparation-restart');
    const firstOptions = preparationOptions(first), firstTransport = stageTransport();
    firstOptions.analyzeStageTransport = firstTransport;
    const curation = await createProductPreparationWorkbenchService(firstOptions).analyze(fixture.identity, { ...original, stage: 'CURATION' });
    const nextOptions = preparationOptions(second), nextTransport = stageTransport(); nextOptions.analyzeStageTransport = nextTransport;
    const restarted = createProductPreparationWorkbenchService(nextOptions);
    expect(await restarted.read(fixture.identity, { ...original, stage: 'CURATION' })).toEqual({ ...curation, replayed: true });
    const vision = await restarted.analyze(fixture.identity, { ...original, stage: 'VISION' });
    expect(vision).toMatchObject({ stage: 'VISION', visionSourceMediaKeys: original.sourceMediaKeys });
    const finalInput = { ...original, stage: 'COPY' as const };
    const copy = await restarted.analyze(fixture.identity, finalInput); expect(copy).toMatchObject({ stage: 'COPY', report });
    expect(firstTransport).toHaveBeenCalledTimes(1); expect(nextTransport).toHaveBeenCalledTimes(2);
    expect(nextTransport.mock.calls.at(-1)![0].images).toEqual([]);
    expect(firstOptions.analyzeTransport).not.toHaveBeenCalled(); expect(nextOptions.analyzeTransport).not.toHaveBeenCalled();
    const namespaces = await second.$queryRaw<Array<{ namespace: string; status: string }>>`
      SELECT "namespace", "status" FROM "ai_translation_cache" WHERE "input_text" LIKE ${`%${fixture.ownerUserId}%`} ORDER BY "namespace"`;
    expect(namespaces).toEqual(['copy', 'curation', 'vision'].map(stage => ({ namespace: `product-preparation-receipt-${stage}`, status: 'success' })));
    expect(await second.$queryRaw<Array<{ count: number }>>`SELECT "consumed_count" AS count FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`).toEqual([{ count: 3 }]);
    const apply = { binding: fixture.binding, analysisInput: finalInput, action: 'ATTRIBUTES' as const,
      operationKey: 'stage-copy-apply-once', selectedAttributeIds: [10] };
    const applied = await restarted.apply(fixture.identity, apply);
    expect(await createProductPreparationWorkbenchService(preparationOptions(first)).apply(fixture.identity, apply)).toEqual({ ...applied, replayed: true });
    const readOnly = preparationOptions(first); readOnly.loadAttributeContext = vi.fn(async () => { throw new Error('later schema unavailable'); });
    expect(await createProductPreparationWorkbenchService(readOnly).read(fixture.identity, finalInput)).toEqual({ ...copy, replayed: true });
    expect(readOnly.analyzeTransport).not.toHaveBeenCalled(); expect(readOnly.readImage).not.toHaveBeenCalled();
    expect((await fixture.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id })).attributes.values['10'])
      .toMatchObject({ source: 'AI', reviewed: true, suggestionProvenance: { sourceCaptureSnapshotId: fixture.snapshotId, schemaRevision } });
  });
  it('preserves safe UNKNOWN-stage classification across restart without blocking access to an earlier checkpoint or resubmitting', async () => {
    const fixture = await seed(first), original = analyzeInput(fixture, 'staged-preparation-timeout');
    const options = preparationOptions(first), transport = stageTransport(); options.analyzeStageTransport = transport;
    const service = createProductPreparationWorkbenchService(options);
    await service.analyze(fixture.identity, { ...original, stage: 'CURATION' });
    transport.mockRejectedValueOnce(Object.assign(new Error('fixture-local-test'), { code: 'PRODUCT_VISION_TIMEOUT', outcome: 'UNKNOWN_OUTCOME' }));
    const stalled = { ...original, stage: 'VISION' as const };
    await expect(service.analyze(fixture.identity, stalled)).rejects.toMatchObject({ failureCode: 'product_vision_timeout', failureKind: 'TRANSPORT_UNKNOWN' });
    const next = preparationOptions(second), restarted = createProductPreparationWorkbenchService(next);
    for (const action of ['read', 'analyze'] as const) await expect(restarted[action](fixture.identity, stalled))
      .rejects.toMatchObject({ stage: 'VISION', failureCode: 'product_vision_timeout', failureKind: 'TRANSPORT_UNKNOWN', outcome: 'UNKNOWN_OUTCOME' });
    expect(await restarted.read(fixture.identity, { ...original, stage: 'CURATION' })).toMatchObject({ stage: 'CURATION', replayed: true });
    await expect(restarted.analyze(fixture.identity, { ...original, stage: 'COPY' })).rejects.toMatchObject({ code: 'product_preparation_stage_required', outcome: 'NOT_SENT' });
    expect(next.analyzeTransport).not.toHaveBeenCalled(); expect(next.readImage).not.toHaveBeenCalled();
    const failures = await second.$queryRaw<Array<{ status: string; output: string }>>`
      SELECT "status", "output_text" AS output FROM "ai_translation_cache" WHERE "namespace" = 'product-preparation-receipt-vision-failure'
      AND "input_text" LIKE ${`%${fixture.ownerUserId}%`}`;
    expect(failures).toEqual([{ status: 'failed', output: JSON.stringify({ stage: 'VISION', failureKind: 'TRANSPORT_UNKNOWN', failureCode: 'product_vision_timeout' }) }]);
    expect(JSON.stringify(failures)).not.toContain('fixture-local-test');
    expect(await second.$queryRaw<Array<{ count: number }>>`SELECT "consumed_count" AS count FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`).toEqual([{ count: 2 }]);
  });
  it('records a received invalid candidate separately from successful receipts and returns the original classification from another client', async () => {
    const fixture = await seed(first), original = { ...analyzeInput(fixture, 'staged-received-rejection'), stage: 'CURATION' as const };
    const options = preparationOptions(first); options.analyzeStageTransport = vi.fn(async () => ({ text: 'invalid fixture-local-test', usage: null }));
    await expect(createProductPreparationWorkbenchService(options).analyze(fixture.identity, original))
      .rejects.toMatchObject({ failureKind: 'RESPONSE_INVALID', failureCode: 'product_preparation_response_invalid' });
    const next = preparationOptions(second), restarted = createProductPreparationWorkbenchService(next);
    await expect(restarted.read(fixture.identity, original)).rejects.toMatchObject({ failureKind: 'RESPONSE_INVALID', failureCode: 'product_preparation_response_invalid' });
    await expect(restarted.analyze(fixture.identity, original)).rejects.toMatchObject({ failureKind: 'RESPONSE_INVALID' });
    expect(next.analyzeTransport).not.toHaveBeenCalled(); expect(next.readImage).not.toHaveBeenCalled();
    const rows = await second.$queryRaw<Array<{ namespace: string; status: string; output: string }>>`
      SELECT "namespace", "status", "output_text" AS output FROM "ai_translation_cache" WHERE "input_text" LIKE ${`%${fixture.ownerUserId}%`}`;
    expect(rows).toEqual([{ namespace: 'product-preparation-receipt-curation-failure', status: 'failed',
      output: JSON.stringify({ stage: 'CURATION', failureKind: 'RESPONSE_INVALID', failureCode: 'product_preparation_response_invalid' }) }]);
    expect(JSON.stringify(rows)).not.toContain('fixture-local-test');
  });

  it('claims once across clients while separating preparation, old vision and copy namespaces', async () => {
    const owner = `preparation_claim_${randomUUID()}`, input = { ownerUserId: owner, draftId: 'fixture-draft', operationKey: 'same-operation', clientRequestHash: hash('input') };
    const a = createPrismaProductPreparationOperationStore({ client: first as never }), b = createPrismaProductPreparationOperationStore({ client: second as never });
    const claimed = await Promise.all([a.claim(input), b.claim(input)]);
    expect(claimed.map(row => row.kind).sort()).toEqual(['claimed', 'in_progress']);
    expect(claimed[0]!.executionId).toBe(claimed[1]!.executionId);
    expect((await b.claim({ ...input, clientRequestHash: hash('changed') })).kind).toBe('conflict');
    expect((await createPrismaProductVisionOperationStore({ client: first as never }).claim(input)).kind).toBe('claimed');
    expect((await createPrismaSourceListingAiCopyExecutionStore({ client: first as never }).claim(input)).kind).toBe('claimed');
    await a.markUnknown(claimed[0]!.executionId); expect((await b.claim(input)).kind).toBe('unknown');
    const rows = await first.$queryRaw<Array<{ key: string }>>`SELECT "operation_key" AS key FROM "source_listing_ai_copy_executions" WHERE "owner_user_id" = ${owner}`;
    expect(rows.map(row => row.key).sort()).toEqual(['preparation:same-operation', 'same-operation', 'vision:same-operation']);
  });
  it('stores immutable preparation receipts with parameterized identity separate from old vision cache', async () => {
    const a = createPrismaProductPreparationOperationStore({ client: first as never }), b = createPrismaProductPreparationOperationStore({ client: second as never });
    const input = { ownerUserId: `preparation_receipt_${randomUUID()}`, draftId: 'fixture-draft', operationKey: "fixture'; DROP TABLE users; --", clientRequestHash: hash('receipt') };
    const receipt: ProductPreparationReceipt = { clientRequestHash: input.clientRequestHash, promptContract: PRODUCT_PREPARATION_PROMPT_CONTRACT,
      result: report, provider: 'fixture-provider', model: 'fixture-model', providerConfigHash: hash('config'), usage: { totalTokens: 30 } };
    await a.saveReceipt(input, receipt); expect(await b.findReceipt(input)).toEqual(receipt);
    for (const change of [{ ownerUserId: 'foreign' }, { draftId: 'foreign' }, { operationKey: 'foreign' }, { clientRequestHash: hash('foreign') }]) expect(await b.findReceipt({ ...input, ...change })).toBeNull();
    expect(await createPrismaProductVisionOperationStore({ client: second as never }).findReceipt(input)).toBeNull();
    expect((await first.$queryRaw<Array<{ present: boolean }>>`SELECT to_regclass('users') IS NOT NULL AS present`)[0]?.present).toBe(true);
  });
  it('recovers after Prisma disconnect and later draft revision without model, quota or replacement context', async () => {
    const client = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const fixture = await seed(client), options = preparationOptions(client), input = analyzeInput(fixture, 'preparation-restart');
      const result = await createProductPreparationWorkbenchService(options).analyze(fixture.identity, input);
      await fixture.workflow.setPricing({ ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId, draftId: fixture.draft.id, expectedRevision: fixture.draft.revision,
        value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-0', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' }] } });
      await client.$disconnect();
      const restarted = preparationOptions(second); restarted.evaluateCapability = vi.fn(async () => ({ available: false, reasonCode: 'VISION_OFF', dailyLimit: 0 }));
      restarted.loadAttributeContext = vi.fn(async () => { throw new Error('Original schema no longer available'); });
      const service = createProductPreparationWorkbenchService(restarted);
      expect(await service.read(fixture.identity, input)).toEqual({ ...result, replayed: true });
      expect(await service.analyze(fixture.identity, input)).toEqual({ ...result, replayed: true });
      expect(restarted.analyzeTransport).not.toHaveBeenCalled(); expect(restarted.readImage).not.toHaveBeenCalled(); expect(restarted.evaluateCapability).not.toHaveBeenCalled();
      expect((await second.$queryRaw<Array<{ count: number }>>`SELECT "consumed_count" AS count FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`)).toEqual([{ count: 1 }]);
      expect((await second.$queryRaw<Array<{ count: number; tokens: number }>>`SELECT "request_count" AS count, "total_tokens" AS tokens FROM "ai_usage_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`)).toEqual([{ count: 1, tokens: 30 }]);
    } finally { await client.$disconnect(); }
  });
  it('durably preserves UNKNOWN reservation and never resubmits through a new client', async () => {
    const fixture = await seed(first), options = preparationOptions(first), input = analyzeInput(fixture, 'preparation-unknown');
    options.analyzeTransport = vi.fn(async () => { throw Object.assign(new Error('fixture timeout'), { outcome: 'UNKNOWN_OUTCOME' }); });
    await expect(createProductPreparationWorkbenchService(options).analyze(fixture.identity, input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    const restarted = preparationOptions(second), service = createProductPreparationWorkbenchService(restarted);
    await expect(service.read(fixture.identity, input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    await expect(service.analyze(fixture.identity, input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    expect(restarted.analyzeTransport).not.toHaveBeenCalled(); expect(restarted.readImage).not.toHaveBeenCalled();
    expect(await second.$queryRaw<Array<{ count: number }>>`SELECT "consumed_count" AS count FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`).toEqual([{ count: 1 }]);
  });
  it('applies reviewed AI attributes once across clients and atomically revokes stale publish authority', async () => {
    const fixture = await seed(first), grantId = await publishGrant(first, fixture), original = analyzeInput(fixture, 'preparation-attributes');
    await createProductPreparationWorkbenchService(preparationOptions(first)).analyze(fixture.identity, original);
    const input = { binding: fixture.binding, analysisInput: original, action: 'ATTRIBUTES' as const, operationKey: 'preparation-apply-once', selectedAttributeIds: [10] };
    const applied = await createProductPreparationWorkbenchService(preparationOptions(first)).apply(fixture.identity, input);
    const replay = await createProductPreparationWorkbenchService(preparationOptions(second)).apply(fixture.identity, input);
    expect(replay).toEqual({ ...applied, replayed: true });
    const current = await fixture.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id });
    expect(current.attributes.values['10']).toMatchObject({ value: 'Белый', source: 'AI', reviewed: true, manualReview: 'CONFIRMED',
      suggestionProvenance: { schemaRevision, sourceCaptureSnapshotId: fixture.snapshotId, sourceCaptureHash: fixture.draft.sourceCaptureHash } });
    expect(current.revision).toBe(fixture.draft.revision + 1); expect(current.draftVersion).toBe(fixture.draft.draftVersion + 1);
    expect(current.auditEvents.filter(event => event.details?.editorOperationKey === input.operationKey)).toHaveLength(1);
    expect(await second.$queryRaw<Array<{ revoked: Date | null; reason: string | null }>>`SELECT "revoked_at" AS revoked, "revoked_reason"::text AS reason FROM "extension_command_grants" WHERE "id" = ${grantId}`)
      .toEqual([{ revoked: expect.any(Date), reason: 'WORKFLOW_VERSION_CHANGED' }]);
  });
  it('persists and restores BYOK candidates with AI provenance and zero hosted quota/usage', async () => {
    const fixture = await seed(first), options = preparationOptions(first), original = { ...analyzeInput(fixture, 'byok-preparation'), executionMode: 'BYOK' as const,
      providerContext: { providerOrigin: 'https://fixture-provider.example', model: 'fixture-analysis', policyRevision: 2 } };
    const identity = { ...fixture.identity, deviceSessionId: `${fixture.prefix}_fixture_device` };
    const result = await createProductPreparationWorkbenchService(options).byokCandidates(identity, { analysisInput: original, report });
    expect(options.analyzeTransport).not.toHaveBeenCalled(); expect(options.readImage).not.toHaveBeenCalled();
    const restarted = preparationOptions(second); const service = createProductPreparationWorkbenchService(restarted);
    expect(await service.read(identity, original)).toEqual({ ...result, replayed: true });
    await service.apply(identity, { binding: fixture.binding, analysisInput: original, action: 'ATTRIBUTES', operationKey: 'byok-preparation-apply', selectedAttributeIds: [10] });
    const current = await fixture.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id });
    expect(current.attributes.values['10']).toMatchObject({ source: 'AI', reviewed: true });
    expect(await second.$queryRaw`SELECT * FROM "ai_usage_quota_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`).toEqual([]);
    expect(await second.$queryRaw`SELECT * FROM "ai_usage_daily" WHERE "actor_user_id" = ${fixture.ownerUserId}`).toEqual([]);
    const rows = await second.$queryRaw<Array<{ provider: string }>>`SELECT "provider" FROM "ai_translation_cache" WHERE "namespace" = 'product-preparation-receipt' AND "input_text" LIKE ${`%${fixture.ownerUserId}%`}`;
    expect(rows).toEqual([{ provider: 'BYOK' }]);
  });
  it('rolls attributes and draft versions back if publish authority revocation fails', async () => {
    const fixture = await seed(first), grantId = await publishGrant(first, fixture), original = analyzeInput(fixture, 'preparation-rollback');
    const service = createProductPreparationWorkbenchService(preparationOptions(first)); await service.analyze(fixture.identity, original);
    const functionName = `preparation_fixture_${randomUUID().replaceAll('-', '')}`;
    if (!/^preparation_fixture_[a-z0-9]+$/u.test(functionName)) throw new Error('Unsafe isolated test function name');
    await first.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$ BEGIN IF OLD.id = '${grantId}' THEN RAISE EXCEPTION 'isolated preparation rollback'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await first.$executeRawUnsafe(`CREATE TRIGGER "${functionName}" BEFORE UPDATE ON "extension_command_grants" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    try {
      await expect(service.apply(fixture.identity, { binding: fixture.binding, analysisInput: original, action: 'ATTRIBUTES', operationKey: 'preparation-failed-apply', selectedAttributeIds: [10] })).rejects.toThrow();
      expect(await fixture.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id })).toEqual(fixture.draft);
      expect(await second.$queryRaw<Array<{ revoked: Date | null }>>`SELECT "revoked_at" AS revoked FROM "extension_command_grants" WHERE "id" = ${grantId}`).toEqual([{ revoked: null }]);
    } finally {
      await first.$executeRawUnsafe(`DROP TRIGGER "${functionName}" ON "extension_command_grants"`);
      await first.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });
  it('persists only the analyzed SKU attribute leaf while preserving another reviewed SKU across client replay', async () => {
    const fixture = await seed(first, { twoSkus: true }), original = analyzeInput(fixture, 'preparation-sku-scope');
    const service = createProductPreparationWorkbenchService(preparationOptions(first, { skuField: true }));
    await service.analyze(fixture.identity, original);
    const black = { value: 'Черный', source: 'SOURCE' as const, reviewed: true, evidence: ['fixture-other-sku'],
      dictionaryMatch: { status: 'MATCHED' as const, dictionaryValueId: 101 } };
    const enriched = await fixture.workflow.setAttributeValues({ ownerUserId: fixture.ownerUserId, actorUserId: fixture.ownerUserId,
      draftId: fixture.draft.id, expectedRevision: fixture.draft.revision, values: { '10': { ...black, reviewed: false, skuValues: { 'sku-1': black } } } });
    const input = { binding: { ...fixture.binding, draftRevision: enriched.revision, draftVersion: enriched.draftVersion }, analysisInput: original,
      action: 'ATTRIBUTES' as const, operationKey: 'preparation-sku-scope-apply', selectedAttributeIds: [10] };
    const applied = await service.apply(fixture.identity, input);
    const replay = await createProductPreparationWorkbenchService(preparationOptions(second, { skuField: true })).apply(fixture.identity, input);
    expect(replay).toEqual({ ...applied, replayed: true });
    const current = await fixture.workflow.getDraft({ ownerUserId: fixture.ownerUserId, draftId: fixture.draft.id });
    expect(current.attributes.values['10']!.skuValues!['sku-0']).toMatchObject({ value: 'Белый', source: 'AI', reviewed: true,
      suggestionProvenance: { schemaRevision, sourceCaptureSnapshotId: fixture.snapshotId, draftRevision: fixture.draft.revision } });
    expect(current.attributes.values['10']!.skuValues!['sku-1']).toEqual(black);
    expect(current.attributes.values['10']!.reviewed).toBe(true);
    expect(current.revision).toBe(enriched.revision + 1);
  });
});
