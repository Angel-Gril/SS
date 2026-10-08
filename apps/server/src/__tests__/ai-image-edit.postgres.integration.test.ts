import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import { applyAiImageAssets } from '../services/ai-image-application.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import { runAiImageEditJob } from '../services/ai-image-edit.js';
import { AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION } from '../services/ai-image-edit-source.js';
import { createFakeAiImageProvider } from '../services/ai-image-jobs.js';
import { createAiMediaWorkflowService } from '../services/ai-media-workflows.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { createGptImage2CountEditProvider } from '../services/ai-image-providers.js';
import { processAiImageEditQueueJob, resolveAiImageEditProvider } from '../workers/ai-image-edit.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true, redis: {} }));

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const client = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

const digest = (buffer: Buffer | string) => createHash('sha256').update(buffer).digest('hex');

async function rgbaPng(width: number, height: number, pixels: number[]) {
  return sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function createSucceededCandidateFixture(database: PrismaClient, suffix: string) {
  const ownerUserId = `edit_race_owner_${suffix}`;
  const goodsId = `edit_race_goods_${suffix}`;
  const subjectId = `edit_race_subject_${suffix}`;
  const snapshotId = `edit_race_snapshot_${suffix}`;
  const sourceAssetId = `edit_race_source_${suffix}`;
  const source = await rgbaPng(2, 2, new Array(16).fill(40));
  const generated = await rgbaPng(2, 2, new Array(16).fill(180));

  await database.user.create({ data: {
    id: ownerUserId, phone: `edit_race_${suffix}`, passwordHash: 'integration-test',
  } });
  await database.supplyGoods.create({ data: {
    id: goodsId, userId: ownerUserId, title: 'AI edit race fixture',
    sourcePlatform: '1688', sourceProductId: `race_product_${suffix}`,
  } });
  await database.sourceCaptureSubject.create({ data: {
    id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: `race_product_${suffix}`,
    legacySupplyGoodsId: goodsId,
  } });
  await database.sourceCaptureSnapshot.create({ data: {
    id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
    captureHash: '7'.repeat(64), payloadBytes: 2, payload: {}, stageCounts: {}, provenance: {},
    provenanceComplete: true, parserVersion: 'integration', completeness: {}, truncations: [],
    hasEstimatedValues: false, profile: {}, profileHash: '8'.repeat(64), actorUserId: ownerUserId,
    ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only',
    capturedAt: new Date(),
  } });
  await (database as any).mediaAsset.create({ data: {
    id: sourceAssetId, ownerUserId, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: snapshotId,
    sourceMediaKey: 'main-race', sourceUrl: 'https://source.example/race.png',
    url: `/uploads/${sourceAssetId}.png`, storageBackend: 'local', storageKey: `${sourceAssetId}.png`,
    mimeType: 'image/png', sizeBytes: source.length, width: 2, height: 2, sha256: digest(source),
    metadata: { pixelOrientationNormalized: true },
  } });

  const workflowService = createAiMediaWorkflowService(new PrismaAiMediaWorkflowRepository(database));
  const created = await workflowService.createImageEdit({
    ownerUserId, actorUserId: ownerUserId, operation: 'FULL_EDIT', sourceAssetId,
    width: 2, height: 2,
    prompt: 'Create a race candidate', negativePrompt: null,
    resolvedPrompt: 'Frozen race prompt', resolvedNegativePrompt: 'Preserve identity',
    templateKey: 'full-image-edit.base', templateReleaseId: `edit-race-release-${suffix}`,
    templateChecksum: '9'.repeat(64), templateSnapshot: { sequence: 1 }, dailyLimit: 20,
    idempotencyKey: `edit-race-origin-${suffix}`, context: { type: 'collect', id: goodsId },
  });
  const uploads = new Map<string, Buffer>();
  await runAiImageEditJob(created.jobId, 1, {
    repository: new PrismaAiImageJobRepository(database),
    provider: createFakeAiImageProvider({ images: [{ buffer: generated, mimeType: 'image/png' }] }),
    loadInputBuffer: async () => source,
    uploadBuffer: async (buffer, filename) => {
      uploads.set(filename, buffer);
      return { url: `/uploads/${filename}`, backend: 'local', key: filename };
    },
  });
  const candidate = await (database as any).mediaAsset.findFirstOrThrow({
    where: { aiImageJobId: created.jobId, kind: 'AI_GENERATED' },
  });
  const candidateBuffer = [...uploads.entries()].find(([name]) => name.endsWith('-final.png'))?.[1];
  if (!candidateBuffer) throw new Error('Race fixture did not persist a final candidate');
  return {
    ownerUserId,
    goodsId,
    snapshotId,
    originWorkflowId: created.workflow.id,
    candidate,
  };
}

type SucceededCandidateFixture = Awaited<ReturnType<typeof createSucceededCandidateFixture>>;

async function createCandidateConsumerRequest(tx: any, input: {
  fixture: SucceededCandidateFixture;
  suffix: string;
  workflowId: string;
  jobId: string;
  requestFingerprint: string;
}) {
  const { fixture, suffix, workflowId, jobId, requestFingerprint } = input;
  await tx.aiMediaWorkflow.create({ data: {
    id: workflowId,
    ownerUserId: fixture.ownerUserId,
    actorUserId: fixture.ownerUserId,
    operation: 'FULL_EDIT',
    status: 'QUEUED',
    reviewStatus: 'NOT_READY',
    currentAttempt: 1,
    contextType: 'collect',
    contextId: fixture.goodsId,
    idempotencyKey: `edit-race-consumer-${suffix}`,
    requestFingerprint,
  } });
  await tx.aiImageJob.create({ data: {
    id: jobId,
    ownerUserId: fixture.ownerUserId,
    actorUserId: fixture.ownerUserId,
    operation: 'FULL_EDIT',
    workflowId,
    workflowAttempt: 1,
    status: 'QUEUED',
    provider: 'fake',
    model: 'fake-image-edit-v1',
    prompt: 'Race candidate consumer',
    negativePrompt: null,
    resolvedPrompt: 'Frozen race candidate consumer',
    resolvedNegativePrompt: 'Preserve identity',
    templateKey: 'full-image-edit.base',
    templateReleaseId: `edit-race-consumer-release-${suffix}`,
    templateChecksum: '3'.repeat(64),
    templateSnapshot: { sequence: 1 },
    requestFingerprint,
    inputAssets: [{
      assetId: fixture.candidate.id,
      role: 'REFERENCE',
      ordinal: 0,
      sha256: fixture.candidate.sha256,
      sizeBytes: fixture.candidate.sizeBytes,
    }],
    operationConfig: { policyVersion: 'ai-image-edit-policy/1.0' },
    requestedImageCount: 1,
    width: fixture.candidate.width,
    height: fixture.candidate.height,
    maxAttempts: 1,
    idempotencyKey: `${workflowId}:attempt:1`,
    estimatedCostCents: 0,
  } });
}

async function insertCandidateConsumerInput(tx: any, input: {
  fixture: SucceededCandidateFixture;
  workflowId: string;
}) {
  const { fixture, workflowId } = input;
  await tx.aiMediaWorkflowInput.create({ data: {
    workflowId,
    ownerUserId: fixture.ownerUserId,
    assetId: fixture.candidate.id,
    role: 'REFERENCE',
    ordinal: 0,
    assetSha256: fixture.candidate.sha256,
    assetUrl: fixture.candidate.url,
    mimeType: fixture.candidate.mimeType,
    width: fixture.candidate.width,
    height: fixture.candidate.height,
  } });
}

async function createUnboundSuiteSlotFixture(database: PrismaClient, input: {
  suffix: string;
  ownerUserId: string;
  goodsId: string;
  subjectId: string;
  snapshotId: string;
}) {
  const planId = `edit_suite_plan_${input.suffix}`;
  const runId = `edit_suite_run_${input.suffix}`;
  const versionId = `edit_suite_version_${input.suffix}`;
  const suiteId = `edit_suite_${input.suffix}`;
  const slotId = `edit_suite_slot_${input.suffix}`;
  const requestFingerprint = '6'.repeat(64);
  const triggerTables = [
    'ai_media_plans',
    'ai_media_planning_runs',
    'ai_media_plan_versions',
    'ai_media_suites',
    'ai_media_suite_slots',
  ];
  await database.$transaction(async (tx: any) => {
    for (const table of triggerTables) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
    }
    await tx.aiMediaPlan.create({ data: {
      id: planId, ownerUserId: input.ownerUserId, actorUserId: input.ownerUserId,
      sourceSubjectId: input.subjectId, contextType: 'collect', contextId: input.goodsId,
      idempotencyKey: `edit-suite-plan-${input.suffix}`, requestFingerprint,
      revision: 2, latestVersion: 0, reviewStatus: 'NOT_READY',
    } });
    await tx.aiMediaPlanningRun.create({ data: {
      id: runId, planId, ownerUserId: input.ownerUserId, sourceSubjectId: input.subjectId,
      actorUserId: input.ownerUserId, sourceCaptureSnapshotId: input.snapshotId,
      attempt: 1, revision: 1, mode: 'RULE_BASED', engineVersion: 'integration', status: 'SUCCEEDED',
      idempotencyKey: `edit-suite-run-${input.suffix}`, requestFingerprint,
      sourceCaptureHash: 'b'.repeat(64), sourceProfileHash: 'c'.repeat(64),
      inputFingerprint: 'd'.repeat(64), inputSnapshot: {}, inputHash: 'e'.repeat(64),
      inputBytes: 2, completedAt: new Date(),
    } });
    await tx.aiMediaPlanVersion.create({ data: {
      id: versionId, planId, ownerUserId: input.ownerUserId, sourceSubjectId: input.subjectId,
      version: 1, planningRunId: runId, sourceCaptureSnapshotId: input.snapshotId,
      sourceCaptureHash: 'b'.repeat(64), sourceProfileHash: 'c'.repeat(64),
      sourceSchemaVersion: 'source-product-capture-v2', selectedSkuHash: 'f'.repeat(64),
      inputAssetSetHash: '1'.repeat(64), inputFingerprint: 'd'.repeat(64),
      planSchemaVersion: 'integration', plannerVersion: 'integration', mode: 'RULE_BASED',
      inputSnapshot: {}, inputHash: 'e'.repeat(64), curation: {}, curationHash: '2'.repeat(64),
      visionEvidence: {}, visionEvidenceHash: '3'.repeat(64), planPayload: {}, planHash: '4'.repeat(64),
      planBytes: 2, provenance: {}, provenanceHash: '5'.repeat(64), actorUserId: input.ownerUserId,
    } });
    await tx.aiMediaPlan.update({ where: { id: planId }, data: {
      latestVersion: 1, currentVersionId: versionId, approvedVersionId: versionId,
      reviewStatus: 'APPROVED', reviewedByUserId: input.ownerUserId, reviewedAt: new Date(),
    } });
    await tx.aiMediaSuite.create({ data: {
      id: suiteId, ownerUserId: input.ownerUserId, actorUserId: input.ownerUserId,
      planId, planVersionId: versionId, sourceSubjectId: input.subjectId,
      sourceCaptureSnapshotId: input.snapshotId, sourceCaptureHash: 'b'.repeat(64),
      sourceProfileHash: 'c'.repeat(64), sourceSchemaVersion: 'source-product-capture-v2',
      contextType: 'collect', contextId: input.goodsId, status: 'PLANNED', revision: 1,
      idempotencyKey: `edit-suite-${input.suffix}`, requestFingerprint, previewHash: 'a'.repeat(64),
      provider: 'fake', model: 'fake-image-suite-v1', providerConfigHash: '7'.repeat(64),
      pricingVersion: 'integration', itemCount: 1, estimatedCostCents: 0,
      maximumCostCents: 0, concurrencyLimit: 1,
    } });
    await tx.aiMediaSuiteSlot.create({ data: {
      id: slotId, suiteId, ownerUserId: input.ownerUserId, ordinal: 0, slotKey: 'hero',
      goal: 'hero', ownershipLevel: 'sku', ownershipKey: `sku-${input.suffix}`,
      slotSnapshot: {}, slotHash: '8'.repeat(64), referencesSnapshot: [],
      referencesHash: '9'.repeat(64), diagnostics: {}, status: 'PLANNED', attempt: 0,
      revision: 1, estimatedCostCents: 0, maximumCostCents: 0,
    } });
    for (const table of [...triggerTables].reverse()) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
    }
  });
  return { suiteId, slotId };
}

function assertIsolatedSchema() {
  const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

describePostgres('AI image edit PostgreSQL workflow', () => {
  beforeAll(async () => {
    assertIsolatedSchema();
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    await client!.$connect();
  });
  afterAll(async () => client!.$disconnect());

  it.each(['FULL_EDIT', 'INPAINT'] as const)('closes ordinary count %s with one CNY0.10 settlement and honest raw/final canvases', async operation => {
    // Real PostgreSQL and shipped owners; only Provider HTTP/storage bytes are synthetic.
    // This proves transaction/dispatch compatibility, not model quality or supplier pricing.
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `count_edit_owner_${suffix}`, goodsId = `count_edit_goods_${suffix}`;
    const subjectId = `count_edit_subject_${suffix}`, snapshotId = `count_edit_snapshot_${suffix}`;
    const sourceAssetId = `count_edit_source_${suffix}`, maskAssetId = `count_edit_mask_${suffix}`;
    const source = await sharp({ create: { width: 900, height: 1200, channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
    const rawOutput = await sharp({ create: { width: 896, height: 1200, channels: 4,
      background: { r: 200, g: 150, b: 100, alpha: 1 } } }).png().toBuffer();
    const maskPixels = Buffer.alloc(900 * 1200 * 4);
    for (let pixel = 0; pixel < 900 * 1200; pixel += 1) {
      maskPixels.fill(pixel % 900 < 450 ? 0 : 255, pixel * 4, pixel * 4 + 3);
      maskPixels[pixel * 4 + 3] = 255;
    }
    const mask = await sharp(maskPixels, { raw: { width: 900, height: 1200, channels: 4 } }).png().toBuffer();
    await client!.user.create({ data: { id: ownerUserId, phone: `count_edit_${suffix}`, passwordHash: 'integration-test' } });
    await client!.supplyGoods.create({ data: { id: goodsId, userId: ownerUserId, title: 'Count edit synthetic fixture',
      sourcePlatform: '1688', sourceProductId: `count_edit_product_${suffix}`, images: ['https://cdn.example/original.png'] } });
    await client!.sourceCaptureSubject.create({ data: { id: subjectId, ownerUserId, sourcePlatform: '1688',
      sourceProductId: `count_edit_product_${suffix}`, legacySupplyGoodsId: goodsId } });
    await client!.sourceCaptureSnapshot.create({ data: { id: snapshotId, subjectId, version: 1,
      schemaVersion: 'source-product-capture-v2', captureHash: digest(`count-capture-${suffix}`), payloadBytes: 2,
      payload: {}, stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'integration',
      completeness: {}, truncations: [], hasEstimatedValues: false, profile: {}, profileHash: digest(`count-profile-${suffix}`),
      actorUserId: ownerUserId, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only', capturedAt: new Date() } });
    await client!.mediaAsset.create({ data: { id: sourceAssetId, ownerUserId, kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: snapshotId, sourceMediaKey: 'main-count', sourceUrl: 'https://source.example/count.png',
      url: `/uploads/${sourceAssetId}.png`, storageBackend: 'local', storageKey: `${sourceAssetId}.png`, mimeType: 'image/png',
      sizeBytes: source.length, width: 900, height: 1200, sha256: digest(source), metadata: { pixelOrientationNormalized: true } } });
    if (operation === 'INPAINT') await client!.mediaAsset.create({ data: { id: maskAssetId, ownerUserId, kind: 'EDIT_MASK',
      sourceCaptureSnapshotId: snapshotId, sourceMediaKey: `edit-mask:${sourceAssetId}:${digest(mask)}`,
      url: `/uploads/${maskAssetId}.png`, storageBackend: 'local', storageKey: `${maskAssetId}.png`, mimeType: 'image/png',
      sizeBytes: mask.length, width: 900, height: 1200, sha256: digest(mask), metadata: {
        contractVersion: 'ai-image-edit-policy/1.0', maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
        sourceAssetId, sourceSha256: digest(source) } } });
    const runtime = { provider: 'custom', model: 'gpt-image-2-count', baseUrl: 'https://ai.big-model-api.top/v1',
      apiKey: 'synthetic-count-dispatch-key', costPerImageCents: 10, currency: 'CNY' as const,
      credentialRevision: { recordId: 'fixture-count-key-record', revision: 3, updatedAt: '2026-10-08T00:00:00.000Z' } };
    const workflowService = createAiMediaWorkflowService(new PrismaAiMediaWorkflowRepository(client!));
    const creationInput = { ownerUserId, actorUserId: ownerUserId, operation, sourceAssetId, width: 900, height: 1200,
      ...(operation === 'INPAINT' ? { maskAssetId, maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS } : {}),
      prompt: 'Edit the selected background', negativePrompt: null, resolvedPrompt: 'Synthetic frozen count edit',
      resolvedNegativePrompt: 'Preserve product identity', templateKey: operation === 'INPAINT' ? 'inpaint.base' : 'full-image-edit.base',
      templateReleaseId: `count-edit-release-${suffix}`, templateChecksum: digest(`count-template-${suffix}`), templateSnapshot: { sequence: 1 },
      dailyLimit: 20, provider: runtime.provider, model: runtime.model, estimatedCostCents: 10, globalDailyBudgetCents: 1_000_000,
      providerRuntimeContract: createAiImageProviderRuntimeContract(runtime, { count: 1, width: 900, height: 1200 }),
      idempotencyKey: `count-edit-create-${suffix}`, context: { type: 'collect' as const, id: goodsId } };
    const created = await workflowService.createImageEdit(creationInput);
    expect(created.replayed).toBe(false);
    expect(await workflowService.createImageEdit(creationInput)).toMatchObject({ jobId: created.jobId, replayed: true });
    const reserved = await client!.aiCostReservation.findUniqueOrThrow({ where: { jobId: created.jobId } });
    expect(reserved).toMatchObject({ status: 'RESERVED', currency: 'CNY', estimatedCostMinor: 10, maximumCostMinor: 10 });
    const queued = await client!.aiImageJob.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(queued.operationConfig).toMatchObject({ providerRuntime: { contractVersion: 'ai-image-provider-runtime/v3',
      currency: 'CNY', unitCostCents: 10, width: 900, height: 1200, credentialRevision: runtime.credentialRevision } });
    expect(JSON.stringify(queued.operationConfig)).not.toContain(runtime.apiKey);
    const uploads = new Map<string, Buffer>();
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://ai.big-model-api.top/v1/images/edits');
      expect(init?.method).toBe('POST');
      const form = init!.body as FormData;
      expect(form.get('model')).toBe('gpt-image-2-count');
      expect(form.get('n')).toBe('1');
      expect(form.get('quality')).toBe('high');
      expect(form.get('size')).toBe('900x1200');
      if (operation === 'INPAINT') {
        const alphaMask = Buffer.from(await (form.get('mask') as Blob).arrayBuffer());
        const pixels = await sharp(alphaMask).ensureAlpha().raw().toBuffer();
        expect([...pixels.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
        expect(pixels[450 * 4 + 3]).toBe(0);
      }
      return new Response(JSON.stringify({ id: `count-edit-request-${suffix}`, data: [{ b64_json: rawOutput.toString('base64') }] }),
        { headers: { 'content-type': 'application/json' } });
    });
    const execute = () => processAiImageEditQueueJob(created.jobId, 1, { repository: new PrismaAiImageJobRepository(client!), nodeEnv: 'test',
      getProviderConfig: async () => runtime,
      getDispatchAuthorization: async () => ({ enabled: true, reasonCode: 'synthetic-fixture', reason: 'Synthetic local fixture' }),
      acquireLease: async () => true, renewLease: async () => true, releaseLease: async () => {},
      loadInputBuffer: async asset => asset.role === 'MASK' ? mask : source,
      uploadBuffer: async (buffer: Buffer, filename: string) => { uploads.set(filename, buffer);
        return { url: `/uploads/${filename}`, backend: 'local', key: filename }; },
      resolveProvider: (provider, model, operation, config, onCreated, nodeEnv, dependencies) => resolveAiImageEditProvider(
        provider, model, operation, config, onCreated, nodeEnv, { ...dependencies,
          createCountEditProvider: options => createGptImage2CountEditProvider({ ...options, fetch, timeoutMs: 10_000 }) }) });
    await execute();
    const succeeded = await workflowService.get(created.workflow.id, ownerUserId);
    expect(succeeded).toMatchObject({ status: 'SUCCEEDED', reviewStatus: 'PENDING', operation });
    const assets = await client!.mediaAsset.findMany({ where: { aiImageJobId: created.jobId } });
    const raw = assets.find(asset => asset.kind === 'AI_PROVIDER_OUTPUT')!;
    const final = assets.find(asset => asset.kind === 'AI_GENERATED')!;
    expect(raw).toMatchObject({ width: 896, height: 1200, sha256: digest(rawOutput), sizeBytes: rawOutput.length });
    expect(final).toMatchObject({ width: 900, height: 1200, sourceCaptureSnapshotId: snapshotId });
    expect(final.metadata).toMatchObject({ providerOutputAssetId: raw.id, providerOutput: { width: 896, height: 1200 } });
    const finalBytes = [...uploads.entries()].find(([filename]) => filename.endsWith('-final.png'))![1];
    expect(await sharp(finalBytes).metadata()).toMatchObject({ width: 900, height: 1200 });
    expect(digest(finalBytes)).toBe(final.sha256);
    if (operation === 'INPAINT') {
      const originalPixels = await sharp(source).ensureAlpha().raw().toBuffer();
      const finalPixels = await sharp(finalBytes).ensureAlpha().raw().toBuffer();
      for (let y = 0; y < 1200; y += 1) {
        expect(finalPixels.subarray(y * 900 * 4, (y * 900 + 450) * 4).equals(originalPixels.subarray(y * 900 * 4, (y * 900 + 450) * 4))).toBe(true);
      }
      expect([...finalPixels.subarray(450 * 4, 451 * 4)]).toEqual([200, 150, 100, 255]);
    }
    await expect(workflowService.review({ id: succeeded.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: succeeded.revision, outputAssetId: raw.id, decision: 'APPROVE', note: null })).rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(await workflowService.review({ id: succeeded.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: succeeded.revision, outputAssetId: final.id, decision: 'APPROVE', note: null })).toMatchObject({ reviewStatus: 'APPROVED' });
    const target = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const applied = await applyAiImageAssets(client! as any, { jobId: created.jobId, ownerUserId, actorUserId: ownerUserId,
      mode: 'append', targetType: 'collect', targetId: goodsId, selectedAssetId: final.id, expectedTargetUpdatedAt: target.updatedAt.toISOString() });
    expect(applied.images).toEqual(['https://cdn.example/original.png', final.url]);
    await execute();
    expect(fetch).toHaveBeenCalledOnce();
    const settled = await client!.aiCostReservation.findUniqueOrThrow({ where: { jobId: created.jobId }, include: { settlements: true } });
    expect(settled).toMatchObject({ status: 'SETTLED', currency: 'CNY', maximumCostMinor: 10 });
    expect(settled.settlements).toEqual([expect.objectContaining({ kind: 'CHARGE', actualCostMinor: 10, billedUnits: 1 })]);
  });

  it('persists raw/composite lineage, executes chained candidates, and appends without replacing originals', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `edit_owner_${suffix}`;
    const goodsId = `edit_goods_${suffix}`;
    const subjectId = `edit_subject_${suffix}`;
    const snapshotId = `edit_snapshot_${suffix}`;
    const sourceAssetId = `edit_source_${suffix}`;
    const maskAssetId = `edit_mask_${suffix}`;
    const source = await rgbaPng(2, 2, [
      10, 20, 30, 255, 40, 50, 60, 255,
      70, 80, 90, 255, 100, 110, 120, 255,
    ]);
    const mask = await rgbaPng(2, 2, [
      0, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const candidate = await rgbaPng(2, 2, new Array(16).fill(200));

    await client!.user.create({ data: {
      id: ownerUserId, phone: `edit_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.supplyGoods.create({ data: {
      id: goodsId, userId: ownerUserId, title: 'AI edit integration fixture',
      sourcePlatform: '1688', sourceProductId: `product_${suffix}`,
      images: ['https://cdn.example/original.png'],
    } });
    await client!.sourceCaptureSubject.create({ data: {
      id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: `product_${suffix}`,
      legacySupplyGoodsId: goodsId,
    } });
    await client!.sourceCaptureSnapshot.create({ data: {
      id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: 'b'.repeat(64), payloadBytes: 2, payload: {}, stageCounts: {}, provenance: {},
      provenanceComplete: true, parserVersion: 'integration', completeness: {}, truncations: [],
      hasEstimatedValues: false, profile: {}, profileHash: 'c'.repeat(64), actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only',
      capturedAt: new Date(),
    } });
    await (client! as any).mediaAsset.create({ data: {
      id: sourceAssetId, ownerUserId, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: 'main-1', sourceUrl: 'https://source.example/main.png',
      url: `/uploads/${sourceAssetId}.png`, storageBackend: 'local', storageKey: `${sourceAssetId}.png`,
      mimeType: 'image/png', sizeBytes: source.length, width: 2, height: 2, sha256: digest(source),
      metadata: { pixelOrientationNormalized: true },
    } });
    await (client! as any).mediaAsset.create({ data: {
      id: maskAssetId, ownerUserId, kind: 'EDIT_MASK', sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: `edit-mask:${sourceAssetId}:${digest(mask)}`,
      url: `/uploads/${maskAssetId}.png`, storageBackend: 'local', storageKey: `${maskAssetId}.png`,
      mimeType: 'image/png', sizeBytes: mask.length, width: 2, height: 2, sha256: digest(mask),
      metadata: {
        contractVersion: 'ai-image-edit-policy/1.0',
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
        sourceAssetId,
        sourceSha256: digest(source),
      },
    } });

    const workflowRepository = new PrismaAiMediaWorkflowRepository(client!);
    const workflowService = createAiMediaWorkflowService(workflowRepository);
    const jobRepository = new PrismaAiImageJobRepository(client!);
    const created = await workflowService.createImageEdit({
      ownerUserId, actorUserId: ownerUserId, operation: 'INPAINT',
      sourceAssetId, maskAssetId, maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      width: 2, height: 2,
      prompt: 'Remove the label', negativePrompt: null,
      resolvedPrompt: 'Frozen remove-label prompt', resolvedNegativePrompt: 'Preserve product identity',
      templateKey: 'inpaint.base', templateReleaseId: `edit-release-${suffix}`,
      templateChecksum: 'd'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 20,
      idempotencyKey: `edit-create-${suffix}`, context: { type: 'collect', id: goodsId },
    });

    const uploaded = new Map<string, Buffer>();
    await runAiImageEditJob(created.jobId, 1, {
      repository: jobRepository,
      provider: createFakeAiImageProvider({ images: [{ buffer: candidate, mimeType: 'image/png' }] }),
      loadInputBuffer: async (asset) => asset.role === 'MASK' ? mask : source,
      uploadBuffer: async (buffer, filename) => {
        uploaded.set(filename, buffer);
        return { url: `/uploads/${filename}`, backend: 'local', key: filename };
      },
    });

    const succeeded = await workflowService.get(created.workflow.id, ownerUserId);
    expect(succeeded).toMatchObject({ status: 'SUCCEEDED', reviewStatus: 'PENDING', operation: 'INPAINT' });
    const persistedAssets = await (client! as any).mediaAsset.findMany({
      where: { aiImageJobId: created.jobId }, orderBy: { kind: 'asc' },
    });
    const raw = persistedAssets.find((asset: any) => asset.kind === 'AI_PROVIDER_OUTPUT');
    const final = persistedAssets.find((asset: any) => asset.kind === 'AI_GENERATED');
    expect(raw).toBeTruthy();
    expect(final).toBeTruthy();
    expect(final).toMatchObject({ sourceCaptureSnapshotId: snapshotId });
    expect(final.metadata).toMatchObject({
      providerOutputAssetId: raw.id,
      pixelOrientationNormalized: true,
    });
    expect(await client!.mediaAssetLineage.count({ where: { jobId: created.jobId } })).toBe(4);
    const finalBuffer = [...uploaded.entries()].find(([name]) => name.endsWith('-final.png'))?.[1];
    expect(finalBuffer).toBeTruthy();
    expect([...(await sharp(finalBuffer!).ensureAlpha().raw().toBuffer())]).toEqual([
      10, 20, 30, 255, 200, 200, 200, 200,
      70, 80, 90, 255, 200, 200, 200, 200,
    ]);

    await expect(workflowService.review({
      id: succeeded.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: succeeded.revision, outputAssetId: raw.id,
      decision: 'APPROVE', note: null,
    })).rejects.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    const approved = await workflowService.review({
      id: succeeded.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: succeeded.revision, outputAssetId: final.id,
      decision: 'APPROVE', note: null,
    });
    expect(approved.reviewStatus).toBe('APPROVED');

    const chained = await workflowService.createImageEdit({
      ownerUserId, actorUserId: ownerUserId, operation: 'FULL_EDIT',
      sourceAssetId: final.id,
      width: 2, height: 2,
      prompt: 'Polish the approved candidate', negativePrompt: null,
      resolvedPrompt: 'Frozen chained edit prompt', resolvedNegativePrompt: 'Preserve product identity',
      templateKey: 'full-image-edit.base', templateReleaseId: `edit-chain-release-${suffix}`,
      templateChecksum: 'e'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 20,
      idempotencyKey: `edit-chain-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    expect(chained).toMatchObject({ workflow: { operation: 'FULL_EDIT' }, replayed: false });

    const chainedUploads = new Map<string, Buffer>();
    await runAiImageEditJob(chained.jobId, 1, {
      repository: jobRepository,
      provider: createFakeAiImageProvider({ images: [{ buffer: candidate, mimeType: 'image/png' }] }),
      loadInputBuffer: async (asset) => {
        expect(asset).toMatchObject({
          assetId: final.id,
          role: 'REFERENCE',
          kind: 'AI_GENERATED',
        });
        return finalBuffer!;
      },
      uploadBuffer: async (buffer, filename) => {
        chainedUploads.set(filename, buffer);
        return { url: `/uploads/${filename}`, backend: 'local', key: filename };
      },
    });
    expect(await workflowService.get(chained.workflow.id, ownerUserId)).toMatchObject({
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      operation: 'FULL_EDIT',
    });
    const chainedFinal = await (client! as any).mediaAsset.findFirstOrThrow({
      where: { aiImageJobId: chained.jobId, kind: 'AI_GENERATED' },
    });
    expect(chainedFinal).toMatchObject({
      sourceCaptureSnapshotId: snapshotId,
      metadata: {
        outputRole: 'FINAL_CANDIDATE',
        pixelOrientationNormalized: true,
        editSourceContractVersion: AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
      },
    });
    expect([...chainedUploads.keys()].some((name) => name.endsWith('-final.png'))).toBe(true);

    const candidateMaskAssetId = `edit_candidate_mask_${suffix}`;
    await (client! as any).mediaAsset.create({ data: {
      id: candidateMaskAssetId,
      ownerUserId,
      kind: 'EDIT_MASK',
      sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: `edit-mask:${final.id}:${digest(mask)}`,
      url: `/uploads/${candidateMaskAssetId}.png`,
      storageBackend: 'local',
      storageKey: `${candidateMaskAssetId}.png`,
      mimeType: 'image/png',
      sizeBytes: mask.length,
      width: 2,
      height: 2,
      sha256: digest(mask),
      metadata: {
        contractVersion: 'ai-image-edit-policy/1.0',
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
        sourceAssetId: final.id,
        sourceSha256: final.sha256,
      },
    } });
    const chainedInpaint = await workflowService.createImageEdit({
      ownerUserId, actorUserId: ownerUserId, operation: 'INPAINT',
      sourceAssetId: final.id, maskAssetId: candidateMaskAssetId,
      width: 2, height: 2,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      prompt: 'Remove one mark from the approved candidate', negativePrompt: null,
      resolvedPrompt: 'Frozen chained inpaint prompt', resolvedNegativePrompt: 'Preserve product identity',
      templateKey: 'inpaint.base', templateReleaseId: `edit-chain-inpaint-release-${suffix}`,
      templateChecksum: 'f'.repeat(64), templateSnapshot: { sequence: 1 },
      dailyLimit: 20,
      idempotencyKey: `edit-chain-inpaint-${suffix}`, context: { type: 'collect', id: goodsId },
    });
    expect(chainedInpaint).toMatchObject({ workflow: { operation: 'INPAINT' }, replayed: false });

    const chainedInpaintUploads = new Map<string, Buffer>();
    await runAiImageEditJob(chainedInpaint.jobId, 1, {
      repository: jobRepository,
      provider: createFakeAiImageProvider({ images: [{ buffer: candidate, mimeType: 'image/png' }] }),
      loadInputBuffer: async (asset) => {
        if (asset.role === 'MASK') {
          expect(asset).toMatchObject({ assetId: candidateMaskAssetId, kind: 'EDIT_MASK' });
          return mask;
        }
        expect(asset).toMatchObject({
          assetId: final.id,
          role: 'REFERENCE',
          kind: 'AI_GENERATED',
        });
        return finalBuffer!;
      },
      uploadBuffer: async (buffer, filename) => {
        chainedInpaintUploads.set(filename, buffer);
        return { url: `/uploads/${filename}`, backend: 'local', key: filename };
      },
    });
    expect(await workflowService.get(chainedInpaint.workflow.id, ownerUserId)).toMatchObject({
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      operation: 'INPAINT',
    });
    const chainedInpaintFinal = await (client! as any).mediaAsset.findFirstOrThrow({
      where: { aiImageJobId: chainedInpaint.jobId, kind: 'AI_GENERATED' },
    });
    expect(chainedInpaintFinal).toMatchObject({
      sourceCaptureSnapshotId: snapshotId,
      metadata: {
        outputRole: 'FINAL_COMPOSITE',
        pixelOrientationNormalized: true,
        editSourceContractVersion: AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
      },
    });
    expect([...chainedInpaintUploads.keys()].some((name) => name.endsWith('-final.png'))).toBe(true);

    const suiteFixture = await createUnboundSuiteSlotFixture(client!, {
      suffix, ownerUserId, goodsId, subjectId, snapshotId,
    });
    const unrelatedWorkflowId = `edit_reverse_new_workflow_${suffix}`;
    await client!.aiMediaWorkflow.create({ data: {
      id: unrelatedWorkflowId, ownerUserId, actorUserId: ownerUserId,
      operation: 'IMAGE_TO_IMAGE', status: 'QUEUED', reviewStatus: 'NOT_READY',
      contextType: 'collect', contextId: goodsId,
      idempotencyKey: `edit-reverse-new-${suffix}`, requestFingerprint: '5'.repeat(64),
    } });
    const originReferenceInput = await client!.aiMediaWorkflowInput.findFirstOrThrow({
      where: { workflowId: created.workflow.id, role: 'REFERENCE', ordinal: 0 },
    });
    const disableTriggers = async (tx: any, table: string, triggers: string[]) => {
      for (const trigger of triggers) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
      }
      return async () => {
        for (const trigger of [...triggers].reverse()) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
        }
      };
    };
    const expectDeferredMutationRejected = async (
      mutate: (tx: any) => Promise<void | (() => Promise<void>)>,
      expected: RegExp,
    ) => {
      await expect(client!.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
        const restoreDisabledTriggers = await mutate(tx);
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        await restoreDisabledTriggers?.();
      })).rejects.toThrow(expected);
    };

    await expectDeferredMutationRejected(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "ai_media_workflows" SET "status" = 'RUNNING'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        created.workflow.id,
        ownerUserId,
      );
    }, /generated source authority is invalid/i);
    await expectDeferredMutationRejected(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "ai_media_workflows" SET "completed_at" = NULL
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        created.workflow.id,
        ownerUserId,
      );
    }, /generated source authority is invalid/i);
    await expectDeferredMutationRejected(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "ai_image_jobs" SET "status" = 'RUNNING'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        created.jobId,
        ownerUserId,
      );
    }, /generated source authority is invalid|output graph is invalid/i);
    await expectDeferredMutationRejected(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "ai_media_workflows" SET "current_attempt" = 2
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        created.workflow.id,
        ownerUserId,
      );
    }, /generated source authority is invalid|job graph is invalid/i);

    await expectDeferredMutationRejected(async (tx) => {
      const restore = await disableTriggers(tx, 'ai_image_jobs', [
        'ai_image_jobs_workflow_request_immutable',
        'protect_ai_cost_job_identity',
      ]);
      await tx.$executeRawUnsafe(
        `UPDATE "ai_image_jobs"
         SET "workflow_id" = NULL, "workflow_attempt" = NULL
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        created.jobId,
        ownerUserId,
      );
      return restore;
    }, /generated source (?:authority is invalid|origin workflow is required)|job graph is invalid/i);

    await expectDeferredMutationRejected(async (tx) => {
      const restore = await disableTriggers(tx, 'ai_image_jobs', [
        'ai_image_jobs_validate_workflow_binding',
        'ai_image_jobs_workflow_request_immutable',
        'protect_ai_cost_job_identity',
      ]);
      await tx.$executeRawUnsafe(
        `UPDATE "ai_image_jobs" SET "operation" = 'IMAGE_TO_IMAGE'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        created.jobId,
        ownerUserId,
      );
      return restore;
    }, /generated source authority is invalid|job graph is invalid/i);

    await expectDeferredMutationRejected(async (tx) => {
      const restore = await disableTriggers(tx, 'ai_media_workflows', [
        'ai_media_workflows_identity_immutable',
      ]);
      await tx.$executeRawUnsafe(
        `UPDATE "ai_media_workflows" SET "operation" = 'IMAGE_TO_IMAGE'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        created.workflow.id,
        ownerUserId,
      );
      return restore;
    }, /generated source authority is invalid|job graph is invalid/i);

    for (const [column, value] of [
      ['context_sku_key', `wrong-sku-${suffix}`],
      ['context_slot_key', `wrong-slot-${suffix}`],
    ] as const) {
      await expectDeferredMutationRejected(async (tx) => {
        const restore = await disableTriggers(tx, 'ai_media_workflows', [
          'ai_media_workflows_identity_immutable',
        ]);
        await tx.$executeRawUnsafe(
          `UPDATE "ai_media_workflows" SET "${column}" = $1
           WHERE "id" = $2 AND "owner_user_id" = $3`,
          value,
          created.workflow.id,
          ownerUserId,
        );
        return restore;
      }, /candidate SKU or slot scope is invalid/i);
    }

    await expectDeferredMutationRejected(async (tx) => {
      const restore = await disableTriggers(tx, 'media_assets', [
        'media_assets_ai_image_edit_metadata_immutable',
      ]);
      await tx.$executeRawUnsafe(
        `UPDATE "media_assets"
         SET "metadata" = "metadata" - 'editSourceContractVersion'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        final.id,
        ownerUserId,
      );
      return restore;
    }, /candidate contract is invalid/i);
    await expectDeferredMutationRejected(async (tx) => {
      const restore = await disableTriggers(tx, 'media_assets', [
        'media_assets_referenced_identity_immutable',
      ]);
      await tx.$executeRawUnsafe(
        `UPDATE "media_assets"
         SET "mime_type" = 'image/webp', "sha256" = 'NOT-A-LOWERCASE-SHA256'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        final.id,
        ownerUserId,
      );
      return restore;
    }, /candidate contract is invalid|inpaint mask authority is invalid/i);
    await expectDeferredMutationRejected(async (tx) => {
      const restore = await disableTriggers(tx, 'media_assets', [
        'media_assets_referenced_identity_immutable',
      ]);
      await tx.$executeRawUnsafe(
        `UPDATE "media_assets" SET "storage_key" = E'\t\n', "url" = E' \t'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        final.id,
        ownerUserId,
      );
      return restore;
    }, /candidate contract is invalid/i);

    await expectDeferredMutationRejected(async (tx) => {
      const restore = await disableTriggers(tx, 'ai_media_workflow_inputs', [
        'ai_media_workflow_inputs_immutable',
      ]);
      await tx.$executeRawUnsafe(
        `UPDATE "ai_media_workflow_inputs" SET "workflow_id" = $1, "ordinal" = 1
         WHERE "id" = $2 AND "owner_user_id" = $3`,
        unrelatedWorkflowId,
        originReferenceInput.id,
        ownerUserId,
      );
      return restore;
    }, /generated source authority is invalid/i);

    await expectDeferredMutationRejected(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "ai_media_suite_slots" DISABLE TRIGGER USER');
      await tx.$executeRawUnsafe(
        'ALTER TABLE "ai_media_suite_slots" ENABLE TRIGGER "ai_media_edit_suite_slot_graph"',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE "ai_media_suite_slots" ENABLE TRIGGER "ai_media_edit_candidate_dependency_suite_slot"',
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ai_media_suite_slots" SET "child_workflow_id" = $1
         WHERE "id" = $2 AND "suite_id" = $3 AND "owner_user_id" = $4`,
        created.workflow.id,
        suiteFixture.slotId,
        suiteFixture.suiteId,
        ownerUserId,
      );
      return async () => {
        await tx.$executeRawUnsafe('ALTER TABLE "ai_media_suite_slots" ENABLE TRIGGER USER');
      };
    }, /cannot be suite children|generated source authority is invalid/i);

    expect(await client!.aiMediaWorkflow.findUniqueOrThrow({
      where: { id: created.workflow.id },
      select: {
        status: true, completedAt: true, currentAttempt: true, operation: true,
        contextSkuKey: true, contextSlotKey: true,
      },
    })).toMatchObject({
      status: 'SUCCEEDED', completedAt: expect.any(Date), currentAttempt: 1,
      operation: 'INPAINT', contextSkuKey: null, contextSlotKey: null,
    });
    expect(await client!.aiImageJob.findUniqueOrThrow({
      where: { id: created.jobId },
      select: { status: true, operation: true, workflowId: true, workflowAttempt: true },
    })).toMatchObject({
      status: 'SUCCEEDED', operation: 'INPAINT',
      workflowId: created.workflow.id, workflowAttempt: 1,
    });
    expect(await client!.mediaAsset.findUniqueOrThrow({
      where: { id: final.id }, select: {
        storageKey: true, url: true, mimeType: true, sha256: true, metadata: true,
      },
    })).toMatchObject({
      storageKey: expect.stringMatching(/\S/u),
      url: expect.stringMatching(/\S/u),
      mimeType: 'image/png',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      metadata: expect.objectContaining({
        editSourceContractVersion: AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
      }),
    });
    expect(await client!.aiMediaWorkflowInput.findUniqueOrThrow({
      where: { id: originReferenceInput.id }, select: { workflowId: true, ordinal: true },
    })).toMatchObject({ workflowId: created.workflow.id, ordinal: 0 });
    expect(await client!.aiMediaSuiteSlot.findUniqueOrThrow({
      where: { id: suiteFixture.slotId }, select: { childWorkflowId: true },
    })).toMatchObject({ childWorkflowId: null });

    const target = await client!.supplyGoods.findUniqueOrThrow({ where: { id: goodsId } });
    const applied = await applyAiImageAssets(client! as any, {
      jobId: created.jobId, ownerUserId, actorUserId: ownerUserId,
      mode: 'append', targetType: 'collect', targetId: goodsId,
      selectedAssetId: final.id, expectedTargetUpdatedAt: target.updatedAt.toISOString(),
    });
    expect(applied.images).toEqual([
      'https://cdn.example/original.png',
      final.url,
    ]);
    expect(applied.images).not.toContain(raw.url);

    await expect((client! as any).mediaAsset.create({ data: {
      ownerUserId, aiImageJobId: created.jobId, kind: 'AI_PROVIDER_OUTPUT',
      url: '/uploads/forged-raw.png', storageBackend: 'local', storageKey: 'forged-raw.png',
      mimeType: 'image/png', sizeBytes: 1, width: 2, height: 2, sha256: 'e'.repeat(64),
    } })).rejects.toThrow();
    await expect((client! as any).mediaAsset.update({
      where: { id: final.id },
      data: { metadata: { ...(final.metadata as object), providerOutputAssetId: 'forged-raw-id' } },
    })).rejects.toThrow(/metadata is immutable|output graph is invalid/i);
  });

  it('serializes candidate consumption against origin invalidation at READ COMMITTED', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const fixture = await createSucceededCandidateFixture(client!, suffix);
    const consumerWorkflowId = `edit_race_consumer_workflow_${suffix}`;
    const consumerJobId = `edit_race_consumer_job_${suffix}`;
    const requestFingerprint = '4'.repeat(64);
    const clientA = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const clientB = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let readyCount = 0;
    let resolveBothReady!: () => void;
    const bothReady = new Promise<void>((resolve) => { resolveBothReady = resolve; });
    const markReady = () => {
      readyCount += 1;
      if (readyCount === 2) resolveBothReady();
    };
    let resolveStart!: () => void;
    const start = new Promise<void>((resolve) => { resolveStart = resolve; });
    let mutationDoneCount = 0;
    let resolveFirstMutation!: () => void;
    const firstMutation = new Promise<void>((resolve) => { resolveFirstMutation = resolve; });
    const markMutationDone = () => {
      mutationDoneCount += 1;
      resolveFirstMutation();
    };
    let resolveCommit!: () => void;
    const commit = new Promise<void>((resolve) => { resolveCommit = resolve; });
    const transactionOptions = {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    } as const;

    const consume = clientA.$transaction(async (tx) => {
      await createCandidateConsumerRequest(tx, {
        fixture, suffix, workflowId: consumerWorkflowId, jobId: consumerJobId, requestFingerprint,
      });
      markReady();
      await start;
      await insertCandidateConsumerInput(tx, { fixture, workflowId: consumerWorkflowId });
      markMutationDone();
      await commit;
      return 'consumer-committed';
    }, transactionOptions);
    const invalidate = clientB.$transaction(async (tx) => {
      markReady();
      await start;
      await tx.aiMediaWorkflow.update({
        where: { id: fixture.originWorkflowId },
        data: { status: 'RUNNING' },
      });
      markMutationDone();
      await commit;
      return 'invalidation-committed';
    }, transactionOptions);

    let outcomes: PromiseSettledResult<string>[] = [];
    try {
      await bothReady;
      resolveStart();
      await Promise.race([
        firstMutation,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Candidate authority race did not reach either mutation')), 5_000);
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mutationDoneCount).toBe(1);
      resolveCommit();
      outcomes = await Promise.allSettled([consume, invalidate]);
    } finally {
      resolveStart();
      resolveCommit();
      if (!outcomes.length) outcomes = await Promise.allSettled([consume, invalidate]);
      await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
    }

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status === 'rejected'
      && /generated source authority is invalid|candidate contract is invalid/i.test(
        String(rejected.reason?.message || ''),
      )).toBe(true);

    const [origin, consumerCount] = await Promise.all([
      client!.aiMediaWorkflow.findUniqueOrThrow({
        where: { id: fixture.originWorkflowId }, select: { status: true },
      }),
      client!.aiMediaWorkflow.count({ where: { id: consumerWorkflowId } }),
    ]);
    expect(
      (consumerCount === 1 && origin.status === 'SUCCEEDED')
      || (consumerCount === 0 && origin.status === 'RUNNING'),
    ).toBe(true);
    if (consumerCount === 1) {
      await client!.$executeRawUnsafe(
        'SELECT assert_standalone_ai_image_edit_graph($1::text, $2::text)',
        consumerWorkflowId,
        fixture.ownerUserId,
      );
      await client!.$executeRawUnsafe(
        'SELECT assert_ai_image_edit_candidate_contract($1::text, $2::text)',
        consumerWorkflowId,
        fixture.ownerUserId,
      );
      await client!.$executeRawUnsafe(
        'SELECT assert_ai_image_edit_candidate_scope($1::text, $2::text)',
        consumerWorkflowId,
        fixture.ownerUserId,
      );
    }
  });

  it('serializes candidate contract mutation against consumption at READ COMMITTED', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const fixture = await createSucceededCandidateFixture(client!, suffix);
    const consumerWorkflowId = `edit_asset_race_workflow_${suffix}`;
    const consumerJobId = `edit_asset_race_job_${suffix}`;
    const requestFingerprint = '2'.repeat(64);
    const invalidStorageKey = ' \t';
    const clientA = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const clientB = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const transactionOptions = {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    } as const;

    let readyCount = 0;
    let resolveBothReady!: () => void;
    const bothReady = new Promise<void>((resolve) => { resolveBothReady = resolve; });
    const markReady = () => {
      readyCount += 1;
      if (readyCount === 2) resolveBothReady();
    };
    let resolveStart!: () => void;
    const start = new Promise<void>((resolve) => { resolveStart = resolve; });
    let mutationDoneCount = 0;
    let resolveFirstMutation!: () => void;
    const firstMutation = new Promise<void>((resolve) => { resolveFirstMutation = resolve; });
    const markMutationDone = () => {
      mutationDoneCount += 1;
      resolveFirstMutation();
    };
    let resolveCommit!: () => void;
    const commit = new Promise<void>((resolve) => { resolveCommit = resolve; });

    let triggerDisabled = false;
    let primaryError: unknown;
    let cleanupError: unknown;
    let consume: Promise<string> | null = null;
    let mutateContract: Promise<string> | null = null;
    let outcomes: PromiseSettledResult<string>[] = [];
    try {
      await client!.$executeRawUnsafe(
        'ALTER TABLE "media_assets" DISABLE TRIGGER "media_assets_referenced_identity_immutable"',
      );
      triggerDisabled = true;
      await Promise.all([clientA.$connect(), clientB.$connect()]);

      consume = clientA.$transaction(async (tx) => {
        await createCandidateConsumerRequest(tx, {
          fixture, suffix, workflowId: consumerWorkflowId, jobId: consumerJobId, requestFingerprint,
        });
        markReady();
        await start;
        await insertCandidateConsumerInput(tx, { fixture, workflowId: consumerWorkflowId });
        markMutationDone();
        await commit;
        return 'consumer-committed';
      }, transactionOptions);
      mutateContract = clientB.$transaction(async (tx) => {
        markReady();
        await start;
        await tx.mediaAsset.update({
          where: { id: fixture.candidate.id },
          data: { storageKey: invalidStorageKey },
        });
        markMutationDone();
        await commit;
        return 'asset-mutation-committed';
      }, transactionOptions);

      await bothReady;
      resolveStart();
      await Promise.race([
        firstMutation,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Candidate contract race did not reach either mutation')), 5_000);
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mutationDoneCount).toBe(1);
      resolveCommit();
      outcomes = await Promise.allSettled([consume, mutateContract]);
    } catch (error) {
      primaryError = error;
    } finally {
      resolveStart();
      resolveCommit();
      try {
        if (!outcomes.length && consume && mutateContract) {
          outcomes = await Promise.allSettled([consume, mutateContract]);
        } else {
          await Promise.allSettled([consume, mutateContract].filter(
            (promise): promise is Promise<string> => promise !== null,
          ));
        }
      } catch (error) {
        cleanupError = error;
      }
      try {
        await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
      } catch (error) {
        cleanupError ||= error;
      }
      if (triggerDisabled) {
        try {
          await client!.$executeRawUnsafe(
            'ALTER TABLE "media_assets" ENABLE TRIGGER "media_assets_referenced_identity_immutable"',
          );
        } catch (error) {
          cleanupError ||= error;
        }
      }
    }
    if (primaryError) throw primaryError;
    if (cleanupError) throw cleanupError;

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status === 'rejected'
      && /generated source authority is invalid|candidate contract is invalid/i.test(
        String(rejected.reason?.message || ''),
      )).toBe(true);

    const [candidate, consumerCount, origin] = await Promise.all([
      client!.mediaAsset.findUniqueOrThrow({
        where: { id: fixture.candidate.id }, select: { storageKey: true },
      }),
      client!.aiMediaWorkflow.count({ where: { id: consumerWorkflowId } }),
      client!.aiMediaWorkflow.findUniqueOrThrow({
        where: { id: fixture.originWorkflowId }, select: { status: true },
      }),
    ]);
    expect(origin.status).toBe('SUCCEEDED');
    expect(
      (consumerCount === 1 && candidate.storageKey === fixture.candidate.storageKey)
      || (consumerCount === 0 && candidate.storageKey === invalidStorageKey),
    ).toBe(true);
    if (consumerCount === 1) {
      await client!.$executeRawUnsafe(
        'SELECT assert_standalone_ai_image_edit_graph($1::text, $2::text)',
        consumerWorkflowId,
        fixture.ownerUserId,
      );
      await client!.$executeRawUnsafe(
        'SELECT assert_ai_image_edit_candidate_contract($1::text, $2::text)',
        consumerWorkflowId,
        fixture.ownerUserId,
      );
    }
  });

  it('allows only one final candidate when concurrent transactions target the same edit job', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `edit_unique_owner_${suffix}`;
    const jobId = `edit_unique_job_${suffix}`;

    await client!.user.create({ data: {
      id: ownerUserId, phone: `edit_unique_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId,
      actorUserId: ownerUserId,
      provider: 'fake',
      model: 'fake-edit-unique-v1',
      prompt: 'concurrent final uniqueness fixture',
      status: 'RUNNING',
      operation: 'FULL_EDIT',
      width: 1,
      height: 1,
      idempotencyKey: `${jobId}:request`,
    } });

    const createFinal = (assetId: string) => client!.$transaction(async (tx) => tx.mediaAsset.create({ data: {
      id: assetId,
      ownerUserId,
      aiImageJobId: jobId,
      kind: 'AI_GENERATED',
      url: `https://storage.example/${assetId}.png`,
      storageBackend: 'local',
      storageKey: `${assetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 1,
      height: 1,
      sha256: 'f'.repeat(64),
      metadata: {
        outputRole: 'FINAL_CANDIDATE',
        providerOutputAssetId: `raw-${jobId}`,
      },
    } }));

    const outcomes = await Promise.allSettled([
      createFinal(`edit_unique_asset_a_${suffix}`),
      createFinal(`edit_unique_asset_b_${suffix}`),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status === 'rejected' && (rejected.reason?.code === 'P2002'
      || /unique|duplicate/i.test(String(rejected.reason?.message)))).toBe(true);
    expect(await client!.mediaAsset.count({ where: { aiImageJobId: jobId } })).toBe(1);
  });
});
