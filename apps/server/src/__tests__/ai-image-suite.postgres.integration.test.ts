import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  createSourceProductCaptureV2Submission,
  type SourceProductCaptureV2,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaAiMediaPlanningRepository } from '../repositories/ai-media-planning-repository.js';
import { PrismaAiImageSuiteReferenceRepository } from '../repositories/ai-image-suite-reference-repository.js';
import { PrismaAiImageSuitePromptRepository } from '../repositories/ai-image-suite-prompt-repository.js';
import { PrismaAiImageSuiteMaterializationRepository } from '../repositories/ai-image-suite-materialization-repository.js';
import {
  PrismaAiImageSuiteExecutionRepository,
  PrismaAiImageSuiteGenerationCoordinator,
} from '../repositories/ai-image-suite-execution-repository.js';
import { PrismaAiImageSuiteRepository } from '../repositories/ai-image-suite-repository.js';
import {
  AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
  createAiImageSuiteReferenceService,
  type AiImageSuiteReferenceBinding,
  type AiImageSuiteReferenceCommitInput,
} from '../services/ai-image-suite-references.js';
import type {
  AiImageSuitePreparationLease,
  AiImageSuitePreparationLeaseGuard,
} from '../services/ai-image-suite-preparation-lease.js';
import { createAiImageSuitePromptService } from '../services/ai-image-suite-prompts.js';
import {
  AI_IMAGE_SUITE_CHILD_OPERATION_CONFIG_VERSION,
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
  createAiImageSuiteMaterializationService,
} from '../services/ai-image-suite-materialization.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { PrismaAiPromptTemplateStore } from '../services/ai-prompt-template-prisma.js';
import { createAiMediaPlanningService, hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import { createAiImageSuitePreview } from '../services/ai-image-suite.js';
import { createAiImageSuiteExecutionService } from '../services/ai-image-suite-execution.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
  resolveAiImageProviderCapability,
} from '../services/ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256 } from '../services/ai-image-provider-runtime-contract.js';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';
import sharp from 'sharp';
import { createAiImageSuiteProviderRuntimeSnapshot, aiImageSuiteProviderRuntimeMatches } from '../services/ai-image-suite-provider-runtime.js';
import { executeAiImageSuitePaidProvider, recoverAiImageSuitePaidProvider } from '../services/ai-image-suite-paid-execution.js';
import { prepareAiImageSuitePaidProviderExecution } from '../services/ai-image-suite-paid-provider.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';
import { createDonorGptImage2EditProvider, type FetchLike } from '../services/ai-image-providers.js';
import { getAiImageSuiteProviderRuntimeConfig } from '../services/ai-image-suite-runtime-config.js';
import { setConfig } from '../config/system-config-schema.js';
import { createAiProviderReconciliationAdminService } from '../services/ai-provider-reconciliation-admin.js';
import { createAiCostReconciliationAdminService } from '../services/ai-cost-reconciliation-admin.js';
import { reserveAiCost, markAiCostUnknown } from '../services/ai-cost-ledger.js';
import { createSourceListingMediaImportService } from '../services/source-listing-media-import.js';
import { createPrismaSourceListingMediaImportStore } from '../services/source-listing-media-import-prisma.js';

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';

const passThroughPreparationLease: AiImageSuitePreparationLease = {
  async runExclusive<T>(
    _scope: Parameters<AiImageSuitePreparationLease['runExclusive']>[0],
    work: (guard: AiImageSuitePreparationLeaseGuard) => Promise<T>,
  ): Promise<T> {
    return await work({ ensureOwned: async () => undefined });
  },
  async isReady() { return true; },
};
const sourceFixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

interface ReferenceBindingFixture {
  binding: AiImageSuiteReferenceBinding;
  sizeBytes: number;
  sourceMimeType: string;
  sourceSizeBytes: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 5_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function withTransactionFindFirstBarrier(input: {
  client: PrismaClient;
  modelName: 'aiMediaPlanningRun' | 'aiMediaSuite';
  matches: (args: any) => boolean;
  wait: () => Promise<void>;
}) {
  let armed = true;
  let transactionAttempts = 0;
  const wrapTransaction = (transaction: any) => new Proxy(transaction, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== input.modelName || !value) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return new Proxy(value, {
        get(model, method, modelReceiver) {
          const operation = Reflect.get(model, method, modelReceiver);
          if (method !== 'findFirst' || typeof operation !== 'function') {
            return typeof operation === 'function' ? operation.bind(model) : operation;
          }
          return async (args: any) => {
            const result = await operation.call(model, args);
            if (armed && input.matches(args)) {
              armed = false;
              await input.wait();
            }
            return result;
          };
        },
      });
    },
  });
  const wrapped = new Proxy(input.client as any, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return (action: (transaction: any) => Promise<unknown>, options: unknown) => {
          transactionAttempts += 1;
          return target.$transaction(
            (transaction: any) => action(wrapTransaction(transaction)),
            options,
          );
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    client: wrapped as PrismaClient,
    transactionAttempts: () => transactionAttempts,
  };
}

describe.skipIf(!enabled)('AI image suite PostgreSQL claim', () => {
  let client: PrismaClient;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ownerUserId = `suite_owner_${suffix}`;
  const subjectId = `suite_subject_${suffix}`;
  const goodsId = `suite_goods_${suffix}`;
  const snapshotId = `suite_snapshot_${suffix}`;
  let capture: SourceProductCaptureV2;
  let captureHash = '';
  let payloadBytes = 0;
  let profileHash = '';
  const selectedSkuKey = sourceFixture.capture.skus[0]!.key;
  let planId = '';
  let planVersionId = '';
  let expectedRevision = 0;
  let expectedPreviewHash = '';
  let suiteId = '';
  let referenceFixtures: ReferenceBindingFixture[] = [];
  let referenceCommitInput: AiImageSuiteReferenceCommitInput;
  let repeatedCandidateId = '';

  function referenceBindingRow(
    fixture: ReferenceBindingFixture,
    overrides: Record<string, unknown> = {},
  ) {
    const binding = fixture.binding;
    const values = {
      suiteId,
      ownerUserId,
      ordinal: binding.ordinal,
      candidateId: binding.candidateId,
      assetId: binding.assetId,
      frozenSourceUrl: binding.sourceUrl,
      expectedContentHash: binding.expectedContentHash,
      assetSha256: binding.assetSha256,
      rawSourceSha256: binding.sourceSha256,
      assetUrl: binding.assetUrl,
      storageBackend: binding.storageBackend,
      storageKey: binding.storageKey,
      mimeType: binding.mimeType,
      sizeBytes: fixture.sizeBytes,
      width: binding.width,
      height: binding.height,
      ...overrides,
    };
    const immutable = {
      version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
      suiteId: values.suiteId,
      ownerUserId: values.ownerUserId,
      ordinal: values.ordinal,
      candidateId: values.candidateId,
      assetId: values.assetId,
      frozenSourceUrl: values.frozenSourceUrl,
      expectedContentHash: values.expectedContentHash,
      assetSha256: values.assetSha256,
      rawSourceSha256: values.rawSourceSha256,
      assetUrl: values.assetUrl,
      storageBackend: values.storageBackend,
      storageKey: values.storageKey,
      mimeType: values.mimeType,
      sizeBytes: values.sizeBytes,
      width: values.width,
      height: values.height,
    };
    return { ...values, bindingHash: hashAiMediaPlanningJson(immutable) };
  }

  function isolatedUrl() {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    const schema = new URL(databaseUrl).searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
      throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
    }
  }

  beforeAll(async () => {
    isolatedUrl();
    capture = structuredClone(sourceFixture.capture);
    const baseMedia = capture.media[0]!;
    capture.media = Array.from({ length: 7 }, (_, index) => ({
      ...structuredClone(baseMedia),
      key: `suite-media-${index + 1}`,
      ordinal: index,
      url: `https://source.example/suite-media-${index + 1}.jpg`,
      width: 900,
      height: 1200,
      rowEvidence: { ...structuredClone(baseMedia.rowEvidence), sourcePath: `/suite/media/${index}` },
      fieldEvidence: {
        ...structuredClone(baseMedia.fieldEvidence),
        url: {
          ...structuredClone(baseMedia.fieldEvidence.url),
          value: `https://source.example/suite-media-${index + 1}.jpg`,
          sourcePath: `/suite/media/${index}/url`,
        },
        width: {
          ...structuredClone(baseMedia.fieldEvidence.width),
          value: 900,
          sourcePath: `/suite/media/${index}/width`,
          missingReason: null,
        },
        height: {
          ...structuredClone(baseMedia.fieldEvidence.height),
          value: 1200,
          sourcePath: `/suite/media/${index}/height`,
          missingReason: null,
        },
      },
    }));
    const selectedSku = capture.skus.find((sku) => sku.key === selectedSkuKey);
    if (selectedSku) selectedSku.mediaKeys = capture.media.map((media) => media.key);
    const mediaCount = capture.counts.find((entry) => entry.fieldPath === '/media');
    if (mediaCount) {
      mediaCount.totalCount = 7;
      mediaCount.capturedCount = 7;
      mediaCount.submittedCount = 7;
      mediaCount.truncated = false;
      mediaCount.reason = null;
    }
    const mainCount = capture.counts.find((entry) => entry.fieldPath === '/media/product_main');
    if (mainCount) {
      mainCount.totalCount = 7;
      mainCount.capturedCount = 7;
      mainCount.submittedCount = 7;
      mainCount.truncated = false;
      mainCount.reason = null;
    }
    const submission = await createSourceProductCaptureV2Submission(capture);
    captureHash = submission.captureHash;
    payloadBytes = submission.payloadBytes;
    profileHash = buildSourceProductProfileFromCapture(capture, {
      itemId: captureHash,
      captureHash,
    }).hash;
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
    await client.user.create({ data: {
      id: ownerUserId, phone: `suite_${suffix}`, passwordHash: 'integration-test',
    } });
    await client.supplyGoods.create({ data: {
      id: goodsId, userId: ownerUserId, title: 'AI suite integration fixture',
      sourcePlatform: '1688', sourceProductId: `suite_product_${suffix}`,
    } });
    await client.sourceCaptureSubject.create({ data: {
      id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: `suite_product_${suffix}`,
      legacySupplyGoodsId: goodsId,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash, payloadBytes, payload: capture as never,
      stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'integration',
      completeness: {}, truncations: [], hasEstimatedValues: false, profile: {}, profileHash,
      actorUserId: ownerUserId, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration',
      rolloutStage: 'v2_only', capturedAt: new Date(),
    } });

    const planning = createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(client), { sourcePreparation: false });
    const created = await planning.createRuleBased({
      ownerUserId, actorUserId: ownerUserId, sourceSubjectId: subjectId,
      sourceCaptureSnapshotId: snapshotId, context: { type: 'collect', id: goodsId },
      idempotencyKey: `suite-plan-${suffix}`, selectedSkuKeys: [selectedSkuKey],
      candidateMediaKeys: capture.media.map((media) => media.key),
    });
    planId = created.plan.id;
    expectedRevision = created.plan.revision;
    const approved = await planning.review({
      planId, ownerUserId, actorUserId: ownerUserId, expectedRevision,
      operationKey: `suite-approve-${suffix}`, decision: 'APPROVE', note: null,
    });
    expectedRevision = approved.plan.revision;
    const repository = new PrismaAiImageSuiteRepository(client);
    const authority = await repository.loadApprovedAuthority({
      ownerUserId, actorUserId: ownerUserId, planId,
    });
    expect(authority).not.toBeNull();
    planVersionId = authority!.planVersionId;
    expectedPreviewHash = createAiImageSuitePreview(authority!, {
      provider: AI_IMAGE_SUITE_PROVIDER, model: AI_IMAGE_SUITE_MODEL, providerConfigHash: '9'.repeat(64),
      pricingVersion: 'provider-free-zero/v1', estimatedCostPerImageCents: 0,
      maximumCostPerImageCents: 0, concurrencyLimit: 2,
    }).previewHash;
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('runs normal donor count planning, frozen CNY 10 pricing and two full-frame settlements with database guards active', async () => {
    const owner = `count_suite_owner_${suffix}`;
    const goods = `count_suite_goods_${suffix}`;
    const subject = `count_suite_subject_${suffix}`;
    const snapshot = `count_suite_snapshot_${suffix}`;
    const sourceCapture = structuredClone(sourceFixture.capture);
    const submission = await createSourceProductCaptureV2Submission(sourceCapture);
    const sourceProfile = buildSourceProductProfileFromCapture(sourceCapture, {
      itemId: submission.captureHash, captureHash: submission.captureHash,
    });
    await client.user.create({ data: { id: owner, phone: `count_suite_${suffix}`, passwordHash: 'integration-test' } });
    await client.supplyGoods.create({ data: { id: goods, userId: owner, title: 'Count suite test product',
      sourcePlatform: '1688', sourceProductId: `count-suite-${suffix}` } });
    await client.sourceCaptureSubject.create({ data: { id: subject, ownerUserId: owner, sourcePlatform: '1688',
      sourceProductId: `count-suite-${suffix}`, legacySupplyGoodsId: goods } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshot, subjectId: subject, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: submission.captureHash, payloadBytes: submission.payloadBytes, payload: sourceCapture as never,
      stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'integration',
      completeness: {}, truncations: [], hasEstimatedValues: false, profile: {}, profileHash: sourceProfile.hash,
      actorUserId: owner, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only', capturedAt: new Date(),
    } });
    const sourceBytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#dbe9f2' } }).jpeg().toBuffer();
    const outputBytes = await sharp({ create: { width: 1008, height: 1344, channels: 3, background: '#247852' } }).png().toBuffer();
    const stored = new Map<string, Buffer>();
    const uploadBuffer = async (buffer: Buffer, filename: string) => {
      const key = `${owner}/${createHash('sha256').update(buffer).digest('hex')}/${filename}`;
      stored.set(key, buffer);
      return { backend: 'oss' as const, key, url: `https://suite-storage.example/${key}` };
    };
    const external = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Real Provider calls are forbidden in the PostgreSQL count fixture');
    });
    try {
      const transfer = await createSourceListingMediaImportService({
        ...createPrismaSourceListingMediaImportStore(client),
        getStorageBackend: async () => ({ uploadBuffer: async (bytes: Buffer, name: string) => ({
          ...(await uploadBuffer(bytes, name)), filename: name,
        }) }),
        getCaptureStorageBackend: async () => ({ backendType: 'oss', uploadBuffer: async (bytes: Buffer, name: string) => ({
          ...(await uploadBuffer(bytes, name)), filename: name,
        }) }),
        download: async (url: string) => ({ sourceUrl: url, finalUrl: url,
          contentType: 'image/jpeg', buffer: sourceBytes, redirectCount: 0 }),
      }).internalizeCapture({ ownerUserId: owner, snapshotId: snapshot, captureHash: submission.captureHash });
      expect(transfer.errors).toEqual([]); expect(transfer.assets).toHaveLength(1);
      await setConfig('ai_image_suite_model', 'gpt-image-2-count');
      await setConfig('ai_image_suite_base_url', 'https://ai.big-model-api.top/v1');
      await setConfig('ai_image_suite_api_key', 'synthetic-count-postgres-key');
      await setConfig('ai_image_suite_cost_cents', 10);
      await setConfig('ai_image_suite_currency', 'CNY');
      await setConfig('ai_image_suite_provider', 'custom');
      const settings = await getAiImageSuiteProviderRuntimeConfig();
      const runtime = createAiImageSuiteProviderRuntimeSnapshot({ ...settings, concurrencyLimit: 2 });
      expect(runtime.executionReady).toBe(true);
      const keyRecord = await client.systemConfig.findUniqueOrThrow({ where: { key: 'ai_image_suite_api_key' } });
      expect(keyRecord.value).not.toBe(settings.apiKey);
      expect(runtime.providerRuntime).toMatchObject({
        contractVersion: 'ai-image-provider-runtime/v3', provider: 'custom', model: 'gpt-image-2-count', currency: 'CNY',
        unitCostCents: 10, maximumCostCents: 10, width: 1008, height: 1344,
        credentialRevision: { recordId: keyRecord.id, revision: keyRecord.revision, updatedAt: keyRecord.updatedAt.toISOString() },
      });
      expect(JSON.stringify(runtime.providerRuntime)).not.toContain(settings.apiKey);
      const planning = createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(client), {
        sourcePreparation: {
          download: async (url: string) => ({ sourceUrl: url, finalUrl: url, contentType: 'image/jpeg', buffer: sourceBytes, redirectCount: 0 }),
          getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
        },
      });
      const planned = await planning.createRuleBased({ ownerUserId: owner, actorUserId: owner, sourceSubjectId: subject,
        sourceCaptureSnapshotId: snapshot, context: { type: 'collect', id: goods }, idempotencyKey: `count-plan-${suffix}`,
        selectedSkuKeys: [sourceCapture.skus[0]!.key], candidateMediaKeys: [sourceCapture.media[0]!.key], galleryGoals: ['scene'] });
      const approved = await planning.review({ planId: planned.plan.id, ownerUserId: owner, actorUserId: owner,
        expectedRevision: planned.plan.revision, operationKey: `count-plan-review-${suffix}`, decision: 'APPROVE', note: null });
      const suites = new PrismaAiImageSuiteRepository(client);
      const authority = await suites.loadApprovedAuthority({ ownerUserId: owner, actorUserId: owner, planId: planned.plan.id });
      expect(authority).not.toBeNull();
      expect(await suites.loadApprovedAuthority({ ownerUserId, actorUserId: ownerUserId, planId: planned.plan.id })).toBeNull();
      expect((authority!.inputSnapshot as any).candidates[0].contentHash).toBe(createHash('sha256').update(sourceBytes).digest('hex'));
      const preview = createAiImageSuitePreview(authority!, runtime.providerConfig!);
      expect(preview).toMatchObject({ itemCount: 2, estimatedCostCents: 20, maximumCostCents: 20 });
      const claimed = await suites.claimApproved({ ownerUserId: owner, actorUserId: owner, planId: planned.plan.id,
        expectedPlanRevision: approved.plan.revision, idempotencyKey: `count-suite-${suffix}`,
        expectedPreviewHash: preview.previewHash, providerConfig: runtime.providerConfig! });
      expect(claimed.kind).toBe('created');
      const countSuiteId = claimed.suite!.id;
      await createAiImageSuiteReferenceService({ repository: new PrismaAiImageSuiteReferenceRepository(client),
        preparationLease: passThroughPreparationLease, download: async (url: string) => {
          const asset = transfer.assets.find(asset => asset.url === url);
          if (!asset?.storageKey || !stored.has(asset.storageKey)) throw new Error('Only the persisted transferred source may be read');
          return { sourceUrl: url, finalUrl: url, contentType: asset.mimeType, buffer: stored.get(asset.storageKey)!, redirectCount: 0 };
        },
        getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
      }).internalize({ suiteId: countSuiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 1, operationKey: `count-refs-${suffix}` });
      await createAiImageSuitePromptService({ repository: new PrismaAiImageSuitePromptRepository(client),
        templateResolver: new AiPromptTemplateRegistryService(new PrismaAiPromptTemplateStore(client), { getLegacyPrompt: async () => 'unused' }),
      }).freeze({ suiteId: countSuiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 2, operationKey: `count-prompts-${suffix}` });
      const controls = async () => ({ dailyLimit: 100, globalDailyBudgetCents: 100_000 });
      const materialize = createAiImageSuiteMaterializationService(new PrismaAiImageSuiteMaterializationRepository(client, {
        getCostControls: controls, getProviderRuntime: async () => runtime,
      }));
      await materialize.materialize({ suiteId: countSuiteId, ownerUserId: owner, actorUserId: owner,
        expectedRevision: 3, operationKey: `count-materialize-${suffix}` });
      const children = await client.aiImageJob.findMany({ where: { workflow: { suiteSlot: { suiteId: countSuiteId } } },
        include: { costReservation: true, workflow: { include: { inputs: true } } }, orderBy: { id: 'asc' } });
      expect(children).toHaveLength(2);
      for (const job of children) {
        expect(job).toMatchObject({ ownerUserId: owner, estimatedCostCents: 10, requestedImageCount: 1, width: 900, height: 1200,
          costReservation: { ownerUserId: owner, currency: 'CNY', estimatedCostMinor: 10, maximumCostMinor: 10, status: 'RESERVED' },
          operationConfig: { providerRequest: { count: 1, width: 1008, height: 1344, quality: 'high' },
            finalOutput: { width: 900, height: 1200, fit: 'full-frame', normalizerVersion: 'ai-image-donor-gpt2-output-normalizer/v1' },
            providerRuntime: runtime.providerRuntime } });
        expect(job.workflow!.inputs).toHaveLength(1);
        expect(job.workflow!.inputs[0]).toMatchObject({ ownerUserId: owner, assetSha256: (job.inputAssets as any[])[0].sha256 });
        const databaseRuntimeValid = async (operationConfig: unknown, assets: unknown = job.inputAssets) => {
          const [result] = await client.$queryRawUnsafe<Array<{ valid: boolean }>>(
            'SELECT ai_media_gpt2_count_suite_runtime_valid($1::text, $2::jsonb, $3::integer, $4::text, $5::jsonb, $6::text, $7::text, $8::text, $9::integer) AS valid',
            job.operation, JSON.stringify(operationConfig), job.estimatedCostCents, runtime.providerConfig!.pricingVersion,
            JSON.stringify(assets), job.provider, job.model, runtime.providerConfig!.providerConfigHash, runtime.providerConfig!.concurrencyLimit,
          );
          return result!.valid;
        };
        expect(await databaseRuntimeValid(job.operationConfig)).toBe(true);
        for (const [field, value] of [['quality', 'auto'], ['width', 1024], ['count', 2]] as const) {
          const forged = structuredClone(job.operationConfig) as any;
          forged.providerRequest[field] = value;
          expect(await databaseRuntimeValid(forged)).toBe(false);
          await expect(client.aiImageJob.update({ where: { id: job.id }, data: { operationConfig: forged } })).rejects.toThrow();
        }
        for (const mutate of [
          (config: any) => { config.providerRuntime.baseUrlSha256 = aiImageProviderEndpointSha256('custom', 'https://unverified.example/v1'); },
          (config: any) => { config.providerRuntime.credentialRevision.extra = 'unexpected-field'; },
          (config: any) => { config.finalOutput.fit = 'contain'; },
          (config: any) => { config.providerRuntime.currency = 'USD'; },
        ]) {
          const forged = structuredClone(job.operationConfig);
          mutate(forged);
          expect(await databaseRuntimeValid(forged)).toBe(false);
        }
        expect(await databaseRuntimeValid(job.operationConfig, [...job.inputAssets as any[], ...(job.inputAssets as any[])])).toBe(false);
        const foreign = structuredClone(job.inputAssets) as any[];
        foreign[0].sha256 = '0'.repeat(64);
        await expect(client.aiImageJob.update({ where: { id: job.id }, data: { inputAssets: foreign } })).rejects.toThrow();
        await expect(client.aiCostReservation.update({ where: { id: job.costReservation!.id }, data: { currency: 'USD' } })).rejects.toThrow();
      }
      const execution = new PrismaAiImageSuiteExecutionRepository(client, {
        runtimeReady: async (suite) => aiImageSuiteProviderRuntimeMatches(suite, runtime), getCostControls: controls,
      });
      await createAiImageSuiteExecutionService(execution).dispatch({ suiteId: countSuiteId, ownerUserId: owner,
        actorUserId: owner, expectedRevision: 4, operationKey: `count-dispatch-${suffix}` });
      await setConfig('ai_image_suite_cost_cents', 99); // Accepted children retain their confirmed CNY 10 price.
      const frozenSource = (children[0]!.inputAssets as any[])[0];
      const frozenBytes = stored.get(frozenSource.storageKey)!;
      expect(frozenBytes).toBeDefined();
      expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(frozenSource.sha256);
      const posts: FormData[] = [];
      const fixtureFetch: FetchLike = async (url, options = {}) => {
        if (options.method !== 'POST') {
          expect(String(url)).toMatch(/^https:\/\/count-results\.example\/[12]\.png$/u);
          expect(new Headers(options.headers).has('authorization')).toBe(false);
          return new Response(new Uint8Array(outputBytes), { status: 200,
            headers: { 'content-type': 'image/png', 'content-length': String(outputBytes.length) } });
        }
        expect(String(url)).toBe('https://ai.big-model-api.top/v1/images/edits');
        expect(options.method).toBe('POST');
        const form = options.body as FormData;
        expect(form.get('model')).toBe('gpt-image-2-count');
        expect(form.get('size')).toBe('1008x1344');
        expect(form.get('quality')).toBe('high');
        expect(form.get('response_format')).toBe('url');
        expect(Buffer.from(await (form.get('image') as Blob).arrayBuffer())).toEqual(frozenBytes);
        posts.push(form);
        return new Response(JSON.stringify({ data: [{ url: `https://count-results.example/${posts.length}.png` }] }), {
          status: 200, headers: { 'x-request-id': `count-fixture-${posts.length}-${suffix}` },
        });
      };
      const prepareProvider = (input: Parameters<typeof prepareAiImageSuitePaidProviderExecution>[0]) => prepareAiImageSuitePaidProviderExecution(input, {
        loadSettings: getAiImageSuiteProviderRuntimeConfig,
        loadInputBuffer: async (input) => { const bytes = stored.get(input.storageKey!); if (!bytes) throw new Error('Frozen reference is missing'); return bytes; },
        createOpenAiProvider: (options) => createDonorGptImage2EditProvider({ ...options, fetch: fixtureFetch }),
      });
      const coordinator = new PrismaAiImageSuiteGenerationCoordinator(client, {
        runtimeReady: async (suite) => aiImageSuiteProviderRuntimeMatches(suite, runtime),
        getRuntimeEvidence: async () => runtime.capability!.evidenceLevel, outputStorageReady: async () => true,
        getDispatchAuthorization: async () => ({ enabled: true, reasonCode: 'READY', reason: 'isolated count fixture' }), uploadBuffer,
        executePaidProvider: (input, dependencies) => executeAiImageSuitePaidProvider(input, { ...dependencies, prepareProvider }),
      });
      const tasks = await execution.listQueueableTasks(countSuiteId);
      expect(tasks).toHaveLength(2);
      for (const task of tasks) {
        const claim = await coordinator.revalidateAndClaim(task);
        expect(claim.kind).toBe('ready');
        if (claim.kind !== 'ready') throw new Error('Count fixture failed its claim');
        await expect(coordinator.execute(task, claim)).resolves.toMatchObject({ kind: 'completed' });
        await expect(coordinator.revalidateAndClaim(task)).resolves.toEqual({ kind: 'ignored' });
      }
      const complete = await client.aiMediaSuite.findUniqueOrThrow({ where: { id: countSuiteId }, include: { slots: true } });
      const settled = await client.aiImageJob.findMany({ where: { id: { in: tasks.map((task) => task.jobId) } },
        include: { assets: true, costReservation: { include: { settlements: true } } } });
      expect(complete.status, JSON.stringify(settled.map((job) => ({ status: job.status, code: job.errorCode, message: job.errorMessage })))).toBe('SUCCEEDED');
      expect(complete.slots.every((slot) => slot.status === 'SUCCEEDED')).toBe(true);
      for (const job of settled) {
        expect(job).toMatchObject({ status: 'SUCCEEDED', actualCostCents: 10, billedUnits: 1,
          costReservation: { currency: 'CNY', status: 'SETTLED' } });
        const charges = job.costReservation!.settlements.filter((settlement) => settlement.kind === 'CHARGE');
        expect(charges).toHaveLength(1);
        expect(charges[0]!.actualCostMinor).toBe(10);
        expect(job.assets).toEqual(expect.arrayContaining([
          expect.objectContaining({ ownerUserId: owner, kind: 'AI_PROVIDER_OUTPUT', width: 1008, height: 1344 }),
          expect.objectContaining({ ownerUserId: owner, kind: 'AI_GENERATED', width: 900, height: 1200 }),
        ]));
      }
      expect(posts).toHaveLength(2);
      expect(external).not.toHaveBeenCalled();
    } finally {
      external.mockRestore();
      await client.systemConfig.deleteMany({ where: { key: { startsWith: 'ai_image_suite_' } } });
    }
  }, 30_000);

  it('runs normal Wanx planning through one accepted task, fenced read-only recovery and one CNY settlement', async () => {
    const owner = `wanx_suite_owner_${suffix}`;
    const goods = `wanx_suite_goods_${suffix}`;
    const subject = `wanx_suite_subject_${suffix}`;
    const snapshot = `wanx_suite_snapshot_${suffix}`;
    const sourceCapture = structuredClone(sourceFixture.capture);
    const submission = await createSourceProductCaptureV2Submission(sourceCapture);
    const sourceProfile = buildSourceProductProfileFromCapture(sourceCapture, { itemId: submission.captureHash, captureHash: submission.captureHash });
    await client.user.create({ data: { id: owner, phone: `wanx_suite_${suffix}`, passwordHash: 'integration-test' } });
    await client.supplyGoods.create({ data: { id: goods, userId: owner, title: 'Wanx suite test product', sourcePlatform: '1688', sourceProductId: `wanx-suite-${suffix}` } });
    await client.sourceCaptureSubject.create({ data: { id: subject, ownerUserId: owner, sourcePlatform: '1688', sourceProductId: `wanx-suite-${suffix}`, legacySupplyGoodsId: goods } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshot, subjectId: subject, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: submission.captureHash, payloadBytes: submission.payloadBytes, payload: sourceCapture as never,
      stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'integration',
      completeness: {}, truncations: [], hasEstimatedValues: false, profile: {}, profileHash: sourceProfile.hash,
      actorUserId: owner, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration', rolloutStage: 'v2_only', capturedAt: new Date(),
    } });
    const sourceBytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#f0f0f0' } }).jpeg({ quality: 71 }).toBuffer();
    const resultBytes = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#e4f0e4' } }).png().toBuffer();
    const stored = new Map<string, Buffer>();
    let sourceDownloads = 0;
    const uploadBuffer = async (buffer: Buffer, filename: string) => {
      const key = `${owner}/${createHash('sha256').update(buffer).digest('hex')}/${filename}`;
      stored.set(key, buffer);
      return { backend: 'oss' as const, key, url: `https://suite-storage.example/${key}` };
    };
    const planning = createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(client), {
      sourcePreparation: {
        download: async (url: string) => { sourceDownloads++; return { sourceUrl: url, finalUrl: url, contentType: 'image/jpeg', buffer: sourceBytes, redirectCount: 0 }; },
        getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
      },
    });
    const created = await planning.createRuleBased({ ownerUserId: owner, actorUserId: owner, sourceSubjectId: subject,
      sourceCaptureSnapshotId: snapshot, context: { type: 'collect', id: goods }, idempotencyKey: `wanx-plan-${suffix}`,
      selectedSkuKeys: [sourceCapture.skus[0]!.key], candidateMediaKeys: [sourceCapture.media[0]!.key], galleryGoals: ['scene'],
    });
    const approved = await planning.review({ planId: created.plan.id, ownerUserId: owner, actorUserId: owner,
      expectedRevision: created.plan.revision, operationKey: `wanx-plan-approve-${suffix}`, decision: 'APPROVE', note: null });
    const settings = { provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'synthetic-wanx-suite-credential', costPerImageCents: 14, currency: 'CNY' as const, concurrencyLimit: 1,
      credentialRevision: { recordId: `wanx-key-${suffix}`, revision: 4, updatedAt: '2026-09-16T00:00:00.000Z' } };
    const runtime = createAiImageSuiteProviderRuntimeSnapshot(settings);
    expect(runtime.executionReady).toBe(true);
    const suiteRepository = new PrismaAiImageSuiteRepository(client);
    const authority = await suiteRepository.loadApprovedAuthority({ ownerUserId: owner, actorUserId: owner, planId: created.plan.id });
    expect((authority!.inputSnapshot as any).candidates[0].contentHash).toBe(createHash('sha256').update(sourceBytes).digest('hex'));
    const preview = createAiImageSuitePreview(authority!, runtime.providerConfig!);
    const verifyStage = async (database: PrismaClient) => {
      // Preserve normal per-stage deferred checks inside this rollback-only fixture.
      await database.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      await database.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
    };
    // A compromised internal caller may not disguise a Wanx quote as the legacy
    // USD family. Use real fresh inserts with all triggers active, then roll back.
    await expect(client.$transaction(async tx => {
      const nested = new Proxy(tx as any, { get(target, key) {
        if (key === '$transaction') return async (action: (value: any) => Promise<unknown>) => action(nested);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } }) as PrismaClient;
      const invalidConfig = { ...runtime.providerConfig!, pricingVersion: `ai-image-suite-price/v1:${'0'.repeat(32)}` };
      const invalidPreview = createAiImageSuitePreview(authority!, invalidConfig);
      const invalid = await new PrismaAiImageSuiteRepository(nested).claimApproved({ ownerUserId: owner, actorUserId: owner,
        planId: created.plan.id, expectedPlanRevision: approved.plan.revision, idempotencyKey: `wanx-invalid-price-${suffix}`,
        expectedPreviewHash: invalidPreview.previewHash, providerConfig: invalidConfig });
      if (!invalid.suite) throw new Error('Bad-price fixture could not establish a real claimed suite');
      await verifyStage(nested);
      await createAiImageSuiteReferenceService({ repository: new PrismaAiImageSuiteReferenceRepository(nested),
        preparationLease: passThroughPreparationLease, download: async () => { throw new Error('Frozen source must be reused'); },
        getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
      }).internalize({ suiteId: invalid.suite.id, ownerUserId: owner, actorUserId: owner, expectedRevision: 1, operationKey: `wanx-bad-refs-${suffix}` });
      await verifyStage(nested);
      await createAiImageSuitePromptService({ repository: new PrismaAiImageSuitePromptRepository(nested),
        templateResolver: new AiPromptTemplateRegistryService(new PrismaAiPromptTemplateStore(nested), { getLegacyPrompt: async () => 'unused' }),
      }).freeze({ suiteId: invalid.suite.id, ownerUserId: owner, actorUserId: owner, expectedRevision: 2, operationKey: `wanx-bad-prompt-${suffix}` });
    }, { isolationLevel: 'Serializable', timeout: 10_000 })).rejects.toThrow(/23514|Wanx suite|Prompt set provenance/u);
    expect(await client.aiMediaSuite.count({ where: { ownerUserId: owner } })).toBe(0);
    const openaiCapability = resolveAiImageProviderCapability('openai-images', 'gpt-image-1')!;
    const usdRuntime = createAiImageSuiteProviderRuntimeSnapshot({ ...settings, provider: 'openai-images', model: 'gpt-image-1',
      baseUrl: 'https://api.openai.com/v1', costPerImageCents: 8, currency: 'USD' }, { resolveCapability: () => ({
      ...openaiCapability, evidenceLevel: 'sandbox-verified', sandboxEvidence: [{
        endpointSha256: aiImageProviderEndpointSha256('openai-images', 'https://api.openai.com/v1'),
        operation: 'IMAGE_TO_IMAGE', inputTransport: 'multipart', resultMode: 'sync',
      }],
    }) });
    expect(usdRuntime.providerRuntime?.contractVersion).toBe('ai-image-provider-runtime/v1');
    await expect(client.$transaction(async tx => {
      const nested = new Proxy(tx as any, { get(target, key) {
        if (key === '$transaction') return async (action: (value: any) => Promise<unknown>) => action(nested);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } }) as PrismaClient;
      const usdPreview = createAiImageSuitePreview(authority!, usdRuntime.providerConfig!);
      const usd = await new PrismaAiImageSuiteRepository(nested).claimApproved({ ownerUserId: owner, actorUserId: owner,
        planId: created.plan.id, expectedPlanRevision: approved.plan.revision, idempotencyKey: `usd-suite-${suffix}`,
        expectedPreviewHash: usdPreview.previewHash, providerConfig: usdRuntime.providerConfig! });
      if (!usd.suite) throw new Error('USD fixture could not establish a real claimed suite');
      await verifyStage(nested);
      await createAiImageSuiteReferenceService({ repository: new PrismaAiImageSuiteReferenceRepository(nested),
        preparationLease: passThroughPreparationLease, download: async () => { throw new Error('Frozen source must be reused'); },
        getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
      }).internalize({ suiteId: usd.suite.id, ownerUserId: owner, actorUserId: owner, expectedRevision: 1, operationKey: `usd-refs-${suffix}` });
      await verifyStage(nested);
      await createAiImageSuitePromptService({ repository: new PrismaAiImageSuitePromptRepository(nested),
        templateResolver: new AiPromptTemplateRegistryService(new PrismaAiPromptTemplateStore(nested), { getLegacyPrompt: async () => 'unused' }),
      }).freeze({ suiteId: usd.suite.id, ownerUserId: owner, actorUserId: owner, expectedRevision: 2, operationKey: `usd-prompts-${suffix}` });
      await verifyStage(nested);
      await createAiImageSuiteMaterializationService(new PrismaAiImageSuiteMaterializationRepository(nested, {
        getCostControls: async () => ({ dailyLimit: 100, globalDailyBudgetCents: 100_000 }), getProviderRuntime: async () => usdRuntime,
      })).materialize({ suiteId: usd.suite.id, ownerUserId: owner, actorUserId: owner, expectedRevision: 3, operationKey: `usd-materialize-${suffix}` });
      // Execute deferred graph guards before rolling this independent positive fixture back.
      await nested.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const usdJob = await nested.aiImageJob.findFirstOrThrow({ where: { workflow: { suiteSlot: { suiteId: usd.suite.id } } }, include: { costReservation: true } });
      expect(usdJob.costReservation?.currency).toBe('USD');
      expect((usdJob.operationConfig as any).providerRequest).toEqual({ count: 1, width: 1024, height: 1536 });
      throw new Error('ROLLBACK_VERIFIED_USD_SUITE');
    }, { isolationLevel: 'Serializable', timeout: 10_000 })).rejects.toThrow('ROLLBACK_VERIFIED_USD_SUITE');
    const claimed = await suiteRepository.claimApproved({ ownerUserId: owner, actorUserId: owner, planId: created.plan.id,
      expectedPlanRevision: approved.plan.revision, idempotencyKey: `wanx-suite-${suffix}`, expectedPreviewHash: preview.previewHash, providerConfig: runtime.providerConfig! });
    expect(claimed.kind).toBe('created');
    const wanxSuiteId = claimed.suite!.id;
    await createAiImageSuiteReferenceService({ repository: new PrismaAiImageSuiteReferenceRepository(client),
      preparationLease: passThroughPreparationLease,
      download: async () => { throw new Error('Planning-frozen source bytes must be reused without another fetch'); },
      getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
    }).internalize({ suiteId: wanxSuiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 1, operationKey: `wanx-refs-${suffix}` });
    expect(sourceDownloads).toBe(1);
    await createAiImageSuitePromptService({ repository: new PrismaAiImageSuitePromptRepository(client),
      templateResolver: new AiPromptTemplateRegistryService(new PrismaAiPromptTemplateStore(client), { getLegacyPrompt: async () => 'unused' }),
    }).freeze({ suiteId: wanxSuiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 2, operationKey: `wanx-prompts-${suffix}` });
    const controls = async () => ({ dailyLimit: 100, globalDailyBudgetCents: 100_000 });
    await createAiImageSuiteMaterializationService(new PrismaAiImageSuiteMaterializationRepository(client, {
      getCostControls: controls, getProviderRuntime: async () => runtime,
    })).materialize({ suiteId: wanxSuiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 3, operationKey: `wanx-materialize-${suffix}` });
    const executionRepository = new PrismaAiImageSuiteExecutionRepository(client, {
      runtimeReady: async suite => aiImageSuiteProviderRuntimeMatches(suite, runtime), getCostControls: controls,
    });
    await createAiImageSuiteExecutionService(executionRepository).dispatch({ suiteId: wanxSuiteId, ownerUserId: owner,
      actorUserId: owner, expectedRevision: 4, operationKey: `wanx-dispatch-${suffix}` });
    let creates = 0;
    let lookups = 0;
    let disconnected = false;
    const providerJobId = `wanx-suite-task-${suffix}`;
    const fetchProvider: FetchLike = async (url, options = {}) => {
      if (options.method === 'POST') {
        creates++;
        const body = JSON.parse(String(options.body));
        expect(body.input.function).toBe('description_edit');
        expect(Array.from(body.input.prompt).length).toBeLessThanOrEqual(800);
        return new Response(JSON.stringify({ output: { task_id: providerJobId, task_status: 'PENDING' } }), { status: 200 });
      }
      if (String(url).includes('/tasks/')) {
        expect(String(url).endsWith(`/tasks/${providerJobId}`)).toBe(true);
        lookups++;
        if (!disconnected) { disconnected = true; throw new TypeError('Synthetic connection lost after task acceptance'); }
        return new Response(JSON.stringify({ output: { task_id: providerJobId, task_status: 'SUCCEEDED', task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 }, results: [
          { url: 'https://dashscope-result.oss-cn-beijing.aliyuncs.com/wanx-suite-test.png' },
        ] }, usage: { image_count: 1 } }), { status: 200 });
      }
      expect(String(url)).toBe('https://dashscope-result.oss-cn-beijing.aliyuncs.com/wanx-suite-test.png');
      return new Response(new Uint8Array(resultBytes), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(resultBytes.length) } });
    };
    const prepareProvider = (input: Parameters<typeof prepareAiImageSuitePaidProviderExecution>[0]) => prepareAiImageSuitePaidProviderExecution(input, {
      loadSettings: async () => settings,
      loadInputBuffer: async input => { const bytes = input.storageKey ? stored.get(input.storageKey) : null; if (!bytes) throw new Error('Source not in trusted test storage'); return bytes; },
      createWanxProvider: options => createDashScopeWanx21ImageEditProvider({ ...options, pollIntervalMs: 0, fetch: fetchProvider }),
    });
    const postgresNow = async () => {
      const [row] = await client.$queryRawUnsafe<Array<{ dbNow: Date }>>(
        'SELECT statement_timestamp() AS "dbNow"',
      );
      if (!row) throw new Error('PostgreSQL clock is unavailable');
      return row.dbNow;
    };
    // Size the real lease against PostgreSQL's clock, which owns the expiry constraint.
    const claimDbNow = await postgresNow();
    const executionLeaseMs = 12_000 + Math.max(0, claimDbNow.getTime() - Date.now());
    expect(executionLeaseMs).toBeLessThanOrEqual(60_000);
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(client, { executionLeaseMs,
      runtimeReady: async suite => aiImageSuiteProviderRuntimeMatches(suite, runtime),
      getRuntimeEvidence: async () => runtime.capability!.evidenceLevel, outputStorageReady: async () => true,
      getDispatchAuthorization: async () => ({ enabled: true, reasonCode: 'READY', reason: 'test grant' }), uploadBuffer,
      executePaidProvider: (input, deps) => executeAiImageSuitePaidProvider(input, { ...deps, prepareProvider }),
      recoverPaidProvider: (input, deps) => recoverAiImageSuitePaidProvider(input, { ...deps, prepareProvider }),
    });
    const firstSlot = await client.aiMediaSuiteSlot.findFirstOrThrow({ where: { suiteId: wanxSuiteId, status: 'QUEUED' }, include: { childWorkflow: { include: { jobs: true } } } });
    const task = { suiteId: wanxSuiteId, slotId: firstSlot.id, workflowId: firstSlot.childWorkflowId!, jobId: firstSlot.childWorkflow!.jobs[0]!.id, attempt: 1 };
    const initialClaim = await coordinator.revalidateAndClaim(task);
    if (initialClaim.kind !== 'ready') throw new Error('Wanx suite did not claim its first queued child');
    await expect(client.aiMediaSuiteSlot.update({ where: { id: task.slotId }, data: { executionClaimToken: digest('forbidden-live-replacement') } }))
      .rejects.toThrow();
    await expect(coordinator.execute(task, initialClaim)).resolves.toMatchObject({ kind: 'pending' });
    expect(creates).toBe(1);
    const accepted = await client.aiImageJob.findUniqueOrThrow({ where: { id: task.jobId }, include: { costReservation: true } });
    expect(accepted).toMatchObject({ providerJobId, status: 'RUNNING', billedUnits: 0, actualCostCents: null,
      costReservation: { currency: 'CNY', status: 'RESERVED', maximumCostMinor: 14 } });
    const waiting = await client.aiMediaSuiteSlot.findUniqueOrThrow({ where: { id: task.slotId } });
    const waitDbNow = await postgresNow();
    await new Promise(resolve => setTimeout(resolve,
      Math.max(0, waiting.executionLeaseExpiresAt!.getTime() - waitDbNow.getTime() + 250)));
    const takeoverDbNow = await postgresNow();
    settings.costPerImageCents = 99; // The confirmed task still settles its frozen 14-fen price.
    const leaseChecks = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      WITH candidate AS (
        SELECT slot AS old_slot,
          jsonb_populate_record(NULL::ai_media_suite_slots, to_jsonb(slot) || jsonb_build_object(
            'execution_claim_token', $2::text, 'execution_lease_expires_at', $3::timestamp, 'updated_at', $4::timestamp)) AS new_slot
        FROM ai_media_suite_slots slot WHERE slot.id = $1
      )
      SELECT ai_media_wanx_suite_lease_takeover_allowed(candidate.old_slot, candidate.new_slot) AS allowed,
        (candidate.old_slot).execution_lease_expires_at <= statement_timestamp() AS expired,
        (candidate.new_slot).execution_lease_expires_at > statement_timestamp() AS future,
        (candidate.new_slot).updated_at >= (candidate.old_slot).updated_at AS updated_forward,
        (to_jsonb(candidate.new_slot) - ARRAY['execution_claim_token','execution_lease_expires_at','updated_at'])
          = (to_jsonb(candidate.old_slot) - ARRAY['execution_claim_token','execution_lease_expires_at','updated_at']) AS frozen_equal,
        ai_media_wanx_suite_runtime_valid(job.operation::text, job.operation_config_json,
          job.estimated_cost_cents, suite.pricing_version, job.input_assets_json) AS runtime_valid,
        job.provider_job_id IS NOT NULL AS accepted, suite.revision >= 5 AS dispatched
      FROM candidate JOIN ai_media_suites suite ON suite.id = (candidate.old_slot).suite_id
      JOIN ai_image_jobs job ON job.workflow_id = (candidate.old_slot).child_workflow_id AND job.workflow_attempt = (candidate.old_slot).attempt`,
      task.slotId, digest('diagnostic-recovery-token'), new Date(takeoverDbNow.getTime() + 10_000), new Date());
    expect(leaseChecks).toEqual([expect.objectContaining({ allowed: true, expired: true, future: true, updated_forward: true,
      frozen_equal: true, runtime_valid: true, accepted: true, dispatched: true })]);
    const recoveryClaim = await coordinator.revalidateAndClaim(task);
    if (recoveryClaim.kind !== 'ready') throw new Error('Expired Wanx suite task did not acquire recovery');
    expect(recoveryClaim.executionToken).not.toBe(initialClaim.executionToken);
    await expect(coordinator.revalidateAndClaim(task)).resolves.toEqual({ kind: 'ignored' });
    await expect(coordinator.execute(task, recoveryClaim)).resolves.toMatchObject({ kind: 'completed' });
    const completed = await client.aiImageJob.findUniqueOrThrow({ where: { id: task.jobId }, include: { costReservation: { include: { settlements: true } }, assets: true } });
    expect(completed).toMatchObject({ status: 'SUCCEEDED', providerJobId, billedUnits: 1, actualCostCents: 14, errorCode: null, errorMessage: null,
      costReservation: { currency: 'CNY', status: 'SETTLED' } });
    expect(completed.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'AI_PROVIDER_OUTPUT', width: 1024, height: 1024 }),
      expect.objectContaining({ kind: 'AI_GENERATED', width: 900, height: 1200 }),
    ]));
    expect(completed.costReservation!.settlements.filter(row => row.kind === 'CHARGE')).toHaveLength(1);
    expect(completed.costReservation!.settlements.find(row => row.kind === 'CHARGE')!.actualCostMinor).toBe(14);
    await expect(coordinator.revalidateAndClaim(task)).resolves.toEqual({ kind: 'ignored' });
    expect(creates).toBe(1);
    expect(lookups).toBe(2);
  }, 75_000);

  async function failedWanxSuiteForAbandonment(label: string, options: { fresh?: boolean; retainedRaw?: boolean; count?: boolean; successfulSibling?: boolean } = {}) {
    const id = `${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const owner = `abandon_owner_${id}`, goods = `abandon_goods_${id}`, subject = `abandon_subject_${id}`, snapshot = `abandon_snapshot_${id}`;
    const sourceCapture = structuredClone(sourceFixture.capture);
    const submission = await createSourceProductCaptureV2Submission(sourceCapture);
    const sourceProfile = buildSourceProductProfileFromCapture(sourceCapture, { itemId: submission.captureHash, captureHash: submission.captureHash });
    await client.user.create({ data: { id: owner, phone: `abandon_${id}`, passwordHash: 'integration-test' } });
    await client.supplyGoods.create({ data: { id: goods, userId: owner, title: 'Historical failed suite fixture', sourcePlatform: '1688', sourceProductId: id } });
    await client.sourceCaptureSubject.create({ data: { id: subject, ownerUserId: owner, sourcePlatform: '1688', sourceProductId: id, legacySupplyGoodsId: goods } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshot, subjectId: subject, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: submission.captureHash, payloadBytes: submission.payloadBytes, payload: sourceCapture as never,
      stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'integration', completeness: {}, truncations: [],
      hasEstimatedValues: false, profile: {}, profileHash: sourceProfile.hash, actorUserId: owner, ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'integration', rolloutStage: 'v2_only', capturedAt: new Date(),
    } });
    const sourceBytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#eee' } }).jpeg().toBuffer();
    const stored = new Map<string, Buffer>();
    const uploadBuffer = async (buffer: Buffer, filename: string) => {
      const key = `${owner}/${createHash('sha256').update(buffer).digest('hex')}/${filename}`;
      stored.set(key, buffer);
      return { backend: 'oss' as const, key, url: `https://suite-storage.example/${key}` };
    };
    const planning = createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(client), { sourcePreparation: {
      download: async (url: string) => ({ sourceUrl: url, finalUrl: url, contentType: 'image/jpeg', buffer: sourceBytes, redirectCount: 0 }),
      getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
    } });
    const created = await planning.createRuleBased({ ownerUserId: owner, actorUserId: owner, sourceSubjectId: subject,
      sourceCaptureSnapshotId: snapshot, context: { type: 'collect', id: goods }, idempotencyKey: `abandon-plan-${id}`,
      selectedSkuKeys: [sourceCapture.skus[0]!.key], candidateMediaKeys: [sourceCapture.media[0]!.key], galleryGoals: ['scene'] });
    const approved = await planning.review({ planId: created.plan.id, ownerUserId: owner, actorUserId: owner,
      expectedRevision: created.plan.revision, operationKey: `abandon-review-${id}`, decision: 'APPROVE', note: null });
    const runtime = createAiImageSuiteProviderRuntimeSnapshot({ provider: options.count ? 'custom' : 'dashscope-wanx', model: options.count ? 'gpt-image-2-count' : 'wanx2.1-imageedit',
      baseUrl: options.count ? 'https://ai.big-model-api.top/v1' : 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'synthetic-abandonment-only', costPerImageCents: options.count ? 10 : 14, currency: 'CNY', concurrencyLimit: 2,
      credentialRevision: { recordId: `abandon_key_${id}`, revision: 1, updatedAt: '2026-09-16T00:00:00.000Z' } });
    const suites = new PrismaAiImageSuiteRepository(client);
    const authority = await suites.loadApprovedAuthority({ ownerUserId: owner, actorUserId: owner, planId: created.plan.id });
    const preview = createAiImageSuitePreview(authority!, runtime.providerConfig!);
    const claimed = await suites.claimApproved({ ownerUserId: owner, actorUserId: owner, planId: created.plan.id,
      expectedPlanRevision: approved.plan.revision, idempotencyKey: `abandon-suite-${id}`, expectedPreviewHash: preview.previewHash, providerConfig: runtime.providerConfig! });
    const suiteId = claimed.suite!.id;
    await createAiImageSuiteReferenceService({ repository: new PrismaAiImageSuiteReferenceRepository(client), preparationLease: passThroughPreparationLease,
      download: async () => { throw new Error('Source must remain frozen'); }, getStorage: async () => ({ backend: 'oss' as const, uploadBuffer }),
    }).internalize({ suiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 1, operationKey: `abandon-refs-${id}` });
    await createAiImageSuitePromptService({ repository: new PrismaAiImageSuitePromptRepository(client),
      templateResolver: new AiPromptTemplateRegistryService(new PrismaAiPromptTemplateStore(client), { getLegacyPrompt: async () => 'unused' }),
    }).freeze({ suiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 2, operationKey: `abandon-prompts-${id}` });
    const controls = async () => ({ dailyLimit: 100, globalDailyBudgetCents: 100_000 });
    await createAiImageSuiteMaterializationService(new PrismaAiImageSuiteMaterializationRepository(client, {
      getCostControls: controls, getProviderRuntime: async () => runtime,
    })).materialize({ suiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 3, operationKey: `abandon-materialize-${id}` });
    const repository = new PrismaAiImageSuiteExecutionRepository(client, { runtimeReady: async () => true, getCostControls: controls });
    await createAiImageSuiteExecutionService(repository).dispatch({ suiteId, ownerUserId: owner, actorUserId: owner, expectedRevision: 4, operationKey: `abandon-dispatch-${id}` });
    const acceptedAt = new Date(Date.now() - (options.fresh || options.count ? 1000 : 25 * 60 * 60 * 1000));
    const resultBytes = options.successfulSibling
      ? await sharp({ create: { width: 1008, height: 1344, channels: 3, background: '#257852' } }).png().toBuffer() : null;
    let executionCount = 0;
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(client, {
      runtimeReady: async () => true, getRuntimeEvidence: async () => runtime.capability!.evidenceLevel, outputStorageReady: async () => true,
      getDispatchAuthorization: async () => ({ enabled: true, reasonCode: 'READY', reason: 'isolated fixture' }), uploadBuffer,
      executePaidProvider: async (input, dependencies) => {
        if (options.successfulSibling && executionCount++ === 1) {
          return executeAiImageSuitePaidProvider(input, { ...dependencies, prepareProvider: async () => ({
            evidenceLevel: 'local-test', normalizerVersion: 'ai-image-donor-gpt2-output-normalizer/v1',
            execute: async (recordAccepted, beforeDispatch) => {
              await beforeDispatch!();
              const providerJobId = `accepted-output-${input.jobId}`;
              await recordAccepted(providerJobId, new Date());
              return { providerJobId, images: [{ buffer: resultBytes!, mimeType: 'image/png' }], actualCostCents: 10 };
            },
          }) });
        }
        await dependencies.assertClaim();
        expect(await dependencies.markProviderDispatchStarted(acceptedAt)).toBe(true);
        const providerJobId = `accepted-output-${input.jobId}`;
        await dependencies.recordProviderAccepted(providerJobId, acceptedAt);
        if (options.retainedRaw) {
          const receivedAt = new Date();
          await dependencies.recordProviderResultEvidence({ providerJobId, actualCostCents: 14, providerResultReceivedAt: receivedAt });
          await dependencies.recordProviderOutput({ url: `https://suite-storage.example/${input.jobId}.png`, storageBackend: 'oss',
            storageKey: `${owner}/${input.jobId}.png`, mimeType: 'image/png', sizeBytes: 100, width: 1024, height: 1024,
            sha256: digest(`raw-${input.jobId}`), metadata: { version: 'ai-image-suite-provider-output/v1',
              sourceCaptureSnapshotId: snapshot, providerJobId, actualCostCents: 14, providerResultReceivedAt: receivedAt.toISOString(),
              normalizerVersion: 'ai-image-suite-output-normalizer/v1', normalizedSha256: digest(`normalized-${input.jobId}`) } });
        }
        // A deterministic Provider boundary; the real coordinator/repositories
        // persist the accepted task and failed graph, with all triggers enabled.
        throw Object.assign(new Error(options.count ? 'Known single-image response returned three candidates' : 'Known output failed the frozen dimensions'), { code: options.count ? 'INVALID_PROVIDER_RESULT' : 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH',
          providerJobId, providerAcceptedAt: acceptedAt, providerResultReceived: true });
      },
    });
    const tasks = await repository.listQueueableTasks(suiteId);
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      const claim = await coordinator.revalidateAndClaim(task);
      if (claim.kind !== 'ready') throw new Error('Isolated historical child was not claimable');
      await coordinator.execute(task, claim);
    }
    const suite = await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } });
    expect(suite.status).toBe(options.successfulSibling ? 'PARTIAL_FAILURE' : 'FAILED');
    await client.$queryRawUnsafe('SELECT assert_ai_media_suite_execution_graph($1::text, $2::text)::text AS result', suiteId, owner);
    return { owner, suiteId, tasks };
  }

  it.each([false, true])('audits fresh rejected count recovery abandonment with successful sibling=%s and one ERP release', async successfulSibling => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('No real Provider/Ozon request is authorized'); });
    try {
      const fixture = await failedWanxSuiteForAbandonment('count_abandon', { count: true, successfulSibling });
      const service = createAiProviderReconciliationAdminService({ database: client });
      const listed = await service.listReconciliations({ limit: 100 });
      const item = listed.items.find((row: any) => row.id === fixture.tasks[0]!.jobId)!;
      expect(item.allowedActions).toEqual(['ABANDON']);
      const include = { assets: true, workflow: { include: { suiteSlot: true } }, costReservation: { include: { settlements: { orderBy: { id: 'asc' as const } } } } };
      const before = await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include });
      const siblingBefore = await client.aiImageJob.findUniqueOrThrow({ where: { id: fixture.tasks[1]!.jobId }, include });
      const decision = { jobId: item.id, actorUserId: fixture.owner, requestId: randomUUID(), expectedStatus: 'MANUAL_REVIEW' as const,
        expectedRevision: item.revision, expectedEvidenceHash: item.evidenceHash, action: 'ABANDON' as const,
        reason: 'Known synchronous count output was rejected before ingest; release only the undelivered ERP reservation, Provider cost remains unknown' };
      const [definition] = await client.$queryRawUnsafe<Array<{ definition: string }>>(
        "SELECT pg_get_functiondef('validate_ai_provider_reconciliation_transition()'::regprocedure) AS definition");
      const branch = ' OR (NEW."provider_reconciled_at" IS NOT NULL AND ai_media_count_undelivered_abandonment_allowed(OLD."id"))';
      expect(definition!.definition).toContain(branch);
      try {
        await client.$executeRawUnsafe(definition!.definition.replace(branch, ''));
        await expect(service.resolveReconciliation(decision)).rejects.toThrow(/invalid AI provider reconciliation transition/u);
        expect(await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include })).toEqual(before);
        expect(await client.aiProviderReconciliationEvent.count({ where: { jobId: item.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } })).toBe(0);
      } finally { await client.$executeRawUnsafe(definition!.definition); }
      await expect(service.resolveReconciliation(decision)).resolves.toMatchObject({ status: 'CANCELLED_OUTPUT_RETAINED', costStatus: 'RELEASED', revision: item.revision + 1 });
      await expect(service.resolveReconciliation(decision)).resolves.toMatchObject({ status: 'CANCELLED_OUTPUT_RETAINED', revision: item.revision + 1 });
      await expect(service.resolveReconciliation({ ...decision, reason: 'Changed decision must not overwrite the original audit' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      const after = await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include });
      expect(after).toMatchObject({ status: 'FAILED', providerJobId: before.providerJobId, providerDispatchedAt: before.providerDispatchedAt,
        errorCode: 'INVALID_PROVIDER_RESULT', errorMessage: before.errorMessage, actualCostCents: null, billedUnits: 0,
        workflow: before.workflow, assets: [], costReservation: { status: 'RELEASED', providerRequestId: before.providerJobId,
          providerAcceptedAt: before.costReservation!.providerAcceptedAt } });
      expect(after.costReservation!.settlements.filter(row => row.kind === 'RECONCILED_RELEASE')).toEqual([
        expect.objectContaining({ actualCostMinor: 0, billedUnits: 0 }),
      ]);
      const events = await client.aiProviderReconciliationEvent.findMany({ where: { jobId: item.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } });
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ abandonment: { version: 'ai-image-count-undelivered-abandonment/v1',
        providerOutputDisposition: 'REJECTED_UNRECOVERABLE', providerBillingDisposition: 'UNKNOWN', erpDeliveredImageCount: 0 } });
      expect(await client.aiMediaWorkflowEvent.count({ where: { jobId: item.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } })).toBe(1);
      expect(await client.aiImageJob.findUniqueOrThrow({ where: { id: siblingBefore.id }, include })).toEqual(siblingBefore);
      await expect(client.aiImageJob.update({ where: { id: item.id }, data: { providerReconciliationLastErrorMessage: 'tamper' } }))
        .rejects.toThrow(/terminal AI provider reconciliation is immutable/u);
      await client.$queryRawUnsafe('SELECT assert_ai_media_suite_execution_graph($1::text, $2::text)::text AS result', fixture.suiteId, fixture.owner);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  }, 30_000);

  it('rolls back count abandonment and ERP release atomically if its audit cannot persist', async () => {
    const fixture = await failedWanxSuiteForAbandonment('count_audit_failure', { count: true });
    const service = createAiProviderReconciliationAdminService({ database: client });
    const item = (await service.listReconciliations({ limit: 100 })).items.find((row: any) => row.id === fixture.tasks[0]!.jobId)!;
    const include = { costReservation: { include: { settlements: { orderBy: { id: 'asc' as const } } } } };
    const before = await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include });
    await client.$executeRawUnsafe(`CREATE FUNCTION reject_count_abandon_audit() RETURNS trigger AS $$ BEGIN
      IF NEW."job_id" = '${item.id}' AND NEW."event_type" = 'PROVIDER_RECONCILIATION_ABANDON' THEN
        RAISE EXCEPTION 'deliberate count audit persistence failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await client.$executeRawUnsafe('CREATE TRIGGER reject_count_abandon_audit BEFORE INSERT ON ai_media_workflow_events FOR EACH ROW EXECUTE FUNCTION reject_count_abandon_audit()');
    try {
      await expect(service.resolveReconciliation({ jobId: item.id, actorUserId: fixture.owner, requestId: randomUUID(),
        expectedStatus: 'MANUAL_REVIEW', expectedRevision: item.revision, expectedEvidenceHash: item.evidenceHash, action: 'ABANDON',
        reason: 'The count decision and ERP release must roll back if immutable audit persistence fails' })).rejects.toThrow(/deliberate count audit persistence failure/u);
      expect(await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include })).toEqual(before);
      expect(await client.aiProviderReconciliationEvent.count({ where: { jobId: item.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } })).toBe(0);
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER reject_count_abandon_audit ON ai_media_workflow_events');
      await client.$executeRawUnsafe('DROP FUNCTION reject_count_abandon_audit()');
    }
  }, 30_000);

  it.each(['RECONCILIATION_REQUIRED', 'SETTLED'] as const)('abandons a historical failed Wanx suite with %s cost without Provider calls or audit loss', async costStatus => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('No external request is authorized in this fixture'); });
    try {
      const fixture = await failedWanxSuiteForAbandonment(costStatus.toLowerCase());
      const costOwner = createAiCostReconciliationAdminService({ database: client as any });
      if (costStatus === 'SETTLED') {
        const listed = await costOwner.listReconciliations({ status: 'RECONCILIATION_REQUIRED', limit: 100 });
        for (const task of fixture.tasks) {
          const reservation = listed.items.find((row: any) => row.jobId === task.jobId)!;
          await costOwner.reconcileReservation({ reservationId: reservation.id, actorUserId: fixture.owner, requestId: randomUUID(),
            expectedStatus: 'RECONCILIATION_REQUIRED', expectedEvidenceHash: reservation.evidenceHash, outcome: 'SETTLED', actualCostMinor: 14, billedUnits: 1,
            reason: 'Preserve the historical operator decision for the previously accepted Provider result' });
        }
      }
      const before = await client.aiImageJob.findMany({ where: { id: { in: fixture.tasks.map(task => task.jobId) } },
        include: { assets: true, costReservation: { include: { settlements: { orderBy: { id: 'asc' } } } } } });
      const owner = createAiProviderReconciliationAdminService({ database: client });
      const listed = await owner.listReconciliations({ limit: 100 });
      for (const original of before) {
        const item = listed.items.find((row: any) => row.id === original.id)!;
        expect(item.allowedActions).toContain('ABANDON');
        const decision = { jobId: original.id, actorUserId: fixture.owner, requestId: randomUUID(),
          expectedStatus: 'MANUAL_REVIEW' as const, expectedRevision: item.revision, expectedEvidenceHash: item.evidenceHash,
          action: 'ABANDON' as const, reason: 'Approved abandonment of the expired failed test suite; Provider produced output but ERP will not recover it' };
        await expect(owner.resolveReconciliation({ ...decision, expectedEvidenceHash: digest('another-task-identity') }))
          .rejects.toMatchObject({ code: 'RECONCILIATION_CHANGED' });
        await expect(client.aiCostReservation.update({ where: { id: original.costReservation!.id }, data: { providerRequestId: 'another-task-identity' } }))
          .rejects.toThrow(/cost provider request identity is immutable/u);
        await expect(owner.resolveReconciliation(decision)).resolves.toMatchObject({ status: 'CANCELLED_OUTPUT_RETAINED',
          costStatus: costStatus === 'SETTLED' ? 'SETTLED' : 'RELEASED', revision: item.revision + 1 });
        await expect(owner.resolveReconciliation(decision)).resolves.toMatchObject({ status: 'CANCELLED_OUTPUT_RETAINED', revision: item.revision + 1 });
        await expect(owner.resolveReconciliation({ ...decision, reason: 'Changed abandonment must not overwrite the original audited decision' }))
          .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
        const after = await client.aiImageJob.findUniqueOrThrow({ where: { id: original.id }, include: { assets: true, costReservation: { include: { settlements: { orderBy: { id: 'asc' } } } } } });
        expect(after).toMatchObject({ status: 'FAILED', providerJobId: original.providerJobId, errorCode: original.errorCode,
          providerReconciliationStatus: 'CANCELLED_OUTPUT_RETAINED', providerReconciliationLastErrorCode: 'OPERATOR_ABANDONED_NO_RECOVERY' });
        expect(after.assets).toEqual(original.assets);
        if (costStatus === 'SETTLED') {
          expect(after).toMatchObject({ actualCostCents: 14, billedUnits: 1 });
          expect(after.costReservation).toEqual(original.costReservation);
        } else {
          expect(after).toMatchObject({ actualCostCents: null, billedUnits: 0, costReservation: { status: 'RELEASED' } });
          expect(after.costReservation!.settlements.filter(row => row.kind === 'RECONCILED_RELEASE')).toEqual([
            expect.objectContaining({ actualCostMinor: 0, billedUnits: 0 }),
          ]);
        }
        expect(await client.aiProviderReconciliationEvent.count({ where: { jobId: original.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } })).toBe(1);
        expect(await client.aiMediaWorkflowEvent.count({ where: { jobId: original.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } })).toBe(1);
        await expect(client.aiImageJob.update({ where: { id: original.id }, data: { providerReconciliationLastErrorMessage: 'tamper' } }))
          .rejects.toThrow(/terminal AI provider reconciliation is immutable/u);
      }
      await client.$queryRawUnsafe('SELECT assert_ai_media_suite_execution_graph($1::text, $2::text)::text AS result', fixture.suiteId, fixture.owner);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  }, 30_000);

  it.each(['fresh', 'asset-backed'] as const)('rejects %s historical failed Wanx abandonment without changing its graph or costs', async shape => {
    const fixture = await failedWanxSuiteForAbandonment(shape, { fresh: shape === 'fresh', retainedRaw: shape === 'asset-backed' });
    const service = createAiProviderReconciliationAdminService({ database: client });
    const listed = await service.listReconciliations({ limit: 100 });
    const item = listed.items.find((row: any) => row.id === fixture.tasks[0]!.jobId)!;
    expect(item.allowedActions).not.toContain('ABANDON');
    const before = await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include: { assets: true, costReservation: true } });
    await expect(service.resolveReconciliation({ jobId: item.id, actorUserId: fixture.owner, requestId: randomUUID(),
      expectedStatus: 'MANUAL_REVIEW', expectedRevision: item.revision, expectedEvidenceHash: item.evidenceHash, action: 'ABANDON',
      reason: 'A caller must not bypass fresh task or persisted asset recovery authority',
    })).rejects.toMatchObject({ code: 'RECONCILIATION_CHANGED' });
    expect(await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include: { assets: true, costReservation: true } })).toEqual(before);
    expect(await client.aiProviderReconciliationEvent.count({ where: { jobId: item.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } })).toBe(0);
  }, 30_000);

  it('rolls back historical failed Wanx terminal and cost changes if its audit cannot persist', async () => {
    const fixture = await failedWanxSuiteForAbandonment('audit_failure');
    const service = createAiProviderReconciliationAdminService({ database: client });
    const listed = await service.listReconciliations({ limit: 100 });
    const item = listed.items.find((row: any) => row.id === fixture.tasks[0]!.jobId)!;
    const before = await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include: { costReservation: { include: { settlements: { orderBy: { id: 'asc' } } } } } });
    await client.$executeRawUnsafe(`CREATE FUNCTION reject_abandon_audit() RETURNS trigger AS $$ BEGIN
      IF NEW."job_id" = '${item.id}' AND NEW."event_type" = 'PROVIDER_RECONCILIATION_ABANDON' THEN
        RAISE EXCEPTION 'deliberate audit persistence failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await client.$executeRawUnsafe('CREATE TRIGGER reject_abandon_audit BEFORE INSERT ON ai_media_workflow_events FOR EACH ROW EXECUTE FUNCTION reject_abandon_audit()');
    try {
      await expect(service.resolveReconciliation({ jobId: item.id, actorUserId: fixture.owner, requestId: randomUUID(),
        expectedStatus: 'MANUAL_REVIEW', expectedRevision: item.revision, expectedEvidenceHash: item.evidenceHash,
        action: 'ABANDON', reason: 'This isolated transaction must roll back rather than terminalize without its workflow audit',
      })).rejects.toThrow(/deliberate audit persistence failure/u);
      expect(await client.aiImageJob.findUniqueOrThrow({ where: { id: item.id }, include: { costReservation: { include: { settlements: { orderBy: { id: 'asc' } } } } } })).toEqual(before);
      expect(await client.aiProviderReconciliationEvent.count({ where: { jobId: item.id, eventType: 'PROVIDER_RECONCILIATION_ABANDON' } })).toBe(0);
    } finally {
      await client.$executeRawUnsafe('DROP TRIGGER reject_abandon_audit ON ai_media_workflow_events');
      await client.$executeRawUnsafe('DROP FUNCTION reject_abandon_audit()');
    }
  }, 30_000);

  it('rejects non-suite historical failed Wanx abandonment despite a matching accepted task', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = `standalone_abandon_${suffix}`, jobId = `standalone_job_${suffix}`, fingerprint = digest(suffix);
    await client.user.create({ data: { id: owner, phone: owner, passwordHash: 'integration-test' } });
    await client.aiImageJob.create({ data: { id: jobId, ownerUserId: owner, actorUserId: owner, status: 'RUNNING', operation: 'IMAGE_TO_IMAGE',
      provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', prompt: 'No network test', width: 1024, height: 1024,
      requestFingerprint: fingerprint, estimatedCostCents: 14 } });
    const reserved = await reserveAiCost(client as any, { ownerUserId: owner, actorUserId: owner, jobId,
      idempotencyKey: `standalone-cost-${suffix}`, requestFingerprint: fingerprint, provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
      operation: 'IMAGE_TO_IMAGE', currency: 'CNY', estimatedCostMinor: 14, maximumCostMinor: 14 });
    const acceptedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await client.aiImageJob.update({ where: { id: jobId }, data: { providerDispatchedAt: acceptedAt } });
    await client.aiImageJob.update({ where: { id: jobId }, data: { status: 'FAILED', providerJobId: `accepted-${suffix}`,
      errorCode: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', providerReconciliationStatus: 'MANUAL_REVIEW', providerReconciliationRevision: 1 } });
    await markAiCostUnknown(client as any, { reservationId: reserved.reservation.id, ownerUserId: owner, actorUserId: owner,
      idempotencyKey: `standalone-unknown-${suffix}`, requestFingerprint: fingerprint, providerRequestId: `accepted-${suffix}`,
      providerAcceptedAt: acceptedAt, reason: 'Accepted standalone task has no persisted output' });
    const service = createAiProviderReconciliationAdminService({ database: client });
    const item = (await service.listReconciliations({ limit: 100 })).items.find((row: any) => row.id === jobId)!;
    expect(item.allowedActions).not.toContain('ABANDON');
    await expect(service.resolveReconciliation({ jobId, actorUserId: owner, requestId: randomUUID(), expectedStatus: 'MANUAL_REVIEW',
      expectedRevision: item.revision, expectedEvidenceHash: item.evidenceHash, action: 'ABANDON',
      reason: 'An accepted standalone job is outside the explicitly authorized suite abandonment contract',
    })).rejects.toMatchObject({ code: 'RECONCILIATION_CHANGED' });
    expect((await client.aiImageJob.findUniqueOrThrow({ where: { id: jobId } })).providerReconciliationStatus).toBe('MANUAL_REVIEW');
  });

  it('rejects a direct suite insert whose frozen source authority is false', async () => {
    await expect(client.aiMediaSuite.create({ data: {
      ownerUserId,
      actorUserId: ownerUserId,
      planId,
      planVersionId,
      sourceSubjectId: subjectId,
      sourceCaptureSnapshotId: snapshotId,
      sourceCaptureHash: '0'.repeat(64),
      sourceProfileHash: profileHash,
      sourceSchemaVersion: 'source-product-capture-v2',
      contextType: 'collect',
      contextId: goodsId,
      idempotencyKey: `suite-invalid-${suffix}`,
      requestFingerprint: '1'.repeat(64),
      previewHash: '2'.repeat(64),
      provider: AI_IMAGE_SUITE_PROVIDER,
      model: AI_IMAGE_SUITE_MODEL,
      providerConfigHash: '9'.repeat(64),
      pricingVersion: 'provider-free-zero/v1',
      itemCount: 8,
      estimatedCostCents: 0,
      maximumCostCents: 0,
      concurrencyLimit: 2,
    } })).rejects.toThrow(/AI media suite provenance mismatch/u);
  });

  it('serializes a manual slot edit against claiming the same approved version', async () => {
    const planning = createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(client), { sourcePreparation: false });
    const created = await planning.createRuleBased({
      ownerUserId,
      actorUserId: ownerUserId,
      sourceSubjectId: subjectId,
      sourceCaptureSnapshotId: snapshotId,
      context: { type: 'collect', id: goodsId },
      idempotencyKey: `suite-slot-race-plan-${suffix}`,
      selectedSkuKeys: [selectedSkuKey],
      candidateMediaKeys: capture.media.map((media) => media.key),
    });
    const approved = await planning.review({
      planId: created.plan.id,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: created.plan.revision,
      operationKey: `suite-slot-race-approve-${suffix}`,
      decision: 'APPROVE',
      note: null,
    });
    const repository = new PrismaAiImageSuiteRepository(client);
    const authority = await repository.loadApprovedAuthority({
      ownerUserId,
      actorUserId: ownerUserId,
      planId: created.plan.id,
    });
    expect(authority).not.toBeNull();
    const config = {
      provider: AI_IMAGE_SUITE_PROVIDER,
      model: AI_IMAGE_SUITE_MODEL,
      providerConfigHash: '9'.repeat(64),
      pricingVersion: 'provider-free-zero/v1',
      estimatedCostPerImageCents: 0,
      maximumCostPerImageCents: 0,
      concurrencyLimit: 2,
    } as const;
    const preview = createAiImageSuitePreview(authority!, config);

    const editReached = deferred();
    const editRelease = deferred();
    const claimReached = deferred();
    const claimRelease = deferred();
    const editDatabase = withTransactionFindFirstBarrier({
      client,
      modelName: 'aiMediaPlanningRun',
      matches: (args) => args?.where?.planId === created.plan.id,
      wait: async () => {
        editReached.resolve();
        await editRelease.promise;
      },
    });
    const claimDatabase = withTransactionFindFirstBarrier({
      client,
      modelName: 'aiMediaSuite',
      matches: (args) => args?.where?.planId === created.plan.id
        && args?.where?.planVersionId?.not === approved.plan.currentVersionId,
      wait: async () => {
        claimReached.resolve();
        await claimRelease.promise;
      },
    });
    const racingPlanning = createAiMediaPlanningService(
      new PrismaAiMediaPlanningRepository(editDatabase.client),
      { sourcePreparation: false },
    );
    const racingRepository = new PrismaAiImageSuiteRepository(claimDatabase.client);
    const editPromise = racingPlanning.updateSlotReferences({
        planId: created.plan.id,
        ownerUserId,
        actorUserId: ownerUserId,
        expectedRevision: approved.plan.revision,
        baseVersionId: approved.plan.currentVersionId!,
        operationKey: `suite-slot-race-edit-${suffix}`,
        changes: [{
          slotKey: `sku:${selectedSkuKey}:hero`,
          referenceCandidateIds: [],
        }],
      });
    const claimPromise = racingRepository.claimApproved({
        ownerUserId,
        actorUserId: ownerUserId,
        planId: created.plan.id,
        expectedPlanRevision: approved.plan.revision,
        idempotencyKey: `suite-slot-race-claim-${suffix}`,
        expectedPreviewHash: preview.previewHash,
        providerConfig: config,
      });
    const operations = Promise.allSettled([editPromise, claimPromise]);
    let claimResult: Awaited<typeof claimPromise> | undefined;
    let editResult: PromiseSettledResult<Awaited<typeof editPromise>> | undefined;
    let operationError: unknown;
    try {
      await withTimeout(
        Promise.all([editReached.promise, claimReached.promise]),
        'AI media suite race barrier timed out',
      );
      claimRelease.resolve();
      claimResult = await withTimeout(
        claimPromise,
        'AI media suite claim completion timed out',
      );
    } catch (error) {
      operationError = error;
    } finally {
      claimRelease.resolve();
      editRelease.resolve();
      try {
        const [settledEdit] = await withTimeout(
          operations,
          'AI media suite race operation cleanup timed out',
        );
        editResult = settledEdit;
      } catch (cleanupError) {
        operationError ??= cleanupError;
      }
    }
    if (operationError) throw operationError;
    if (!claimResult || !editResult) throw new Error('AI media suite race result was not captured');

    const storedPlan = await client.aiMediaPlan.findUniqueOrThrow({
      where: { id: created.plan.id },
    });
    const storedSuite = await client.aiMediaSuite.findFirst({
      where: { ownerUserId, planId: created.plan.id },
    });
    const runCount = await client.aiMediaPlanningRun.count({ where: { planId: created.plan.id } });
    const versionCount = await client.aiMediaPlanVersion.count({ where: { planId: created.plan.id } });
    const editEventCount = await client.aiMediaPlanEvent.count({ where: {
      planId: created.plan.id,
      eventType: 'SLOT_REFERENCES_UPDATED',
    } });

    expect(claimResult).toMatchObject({ kind: 'created' });
    expect(editResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'AI_MEDIA_PLANNING_ACTIVE_SUITE_CONFLICT' }),
    });
    expect(editDatabase.transactionAttempts()).toBeGreaterThanOrEqual(2);
    expect(storedSuite).not.toBeNull();
    expect(storedPlan).toMatchObject({
      revision: approved.plan.revision,
      currentVersionId: approved.plan.currentVersionId,
      reviewStatus: 'APPROVED',
    });
    expect({ runCount, versionCount, editEventCount }).toEqual({
      runCount: 1,
      versionCount: 1,
      editEventCount: 0,
    });
    expect(await client.aiMediaSuiteSlot.count({ where: { suiteId: storedSuite!.id } })).toBe(8);
  });

  it('allows one serializable claim and exact replay under concurrent requests', async () => {
    const repository = new PrismaAiImageSuiteRepository(client);
    const input = {
      ownerUserId, actorUserId: ownerUserId, planId, expectedPlanRevision: expectedRevision,
      idempotencyKey: `suite-claim-${suffix}`, expectedPreviewHash,
      providerConfig: {
        provider: AI_IMAGE_SUITE_PROVIDER, model: AI_IMAGE_SUITE_MODEL, providerConfigHash: '9'.repeat(64),
        pricingVersion: 'provider-free-zero/v1', estimatedCostPerImageCents: 0,
        maximumCostPerImageCents: 0, concurrencyLimit: 2,
      },
    } as const;
    const results = await Promise.all([repository.claimApproved(input), repository.claimApproved(input)]);

    expect(results.map((result) => result.kind).sort()).toEqual(['created', 'existing']);
    const storedSuite = await client.aiMediaSuite.findFirstOrThrow({ where: { ownerUserId, planId } });
    suiteId = storedSuite.id;
    expect(await client.aiMediaSuite.count({ where: { ownerUserId, planId } })).toBe(1);
    expect(await client.aiMediaSuiteSlot.count({ where: { suiteId } })).toBe(8);
    expect(await client.aiMediaSuiteEvent.count({ where: { suiteId } })).toBe(1);
    expect(await client.aiImageJob.count({ where: { ownerUserId, idempotencyKey: { startsWith: `suite-claim-${suffix}` } } })).toBe(0);
    expect(await client.aiCostReservation.count({ where: { ownerUserId } })).toBe(0);
  });

  it('rejects a second idempotency key for the same approved version', async () => {
    const repository = new PrismaAiImageSuiteRepository(client);
    const result = await repository.claimApproved({
      ownerUserId, actorUserId: ownerUserId, planId, expectedPlanRevision: expectedRevision,
      idempotencyKey: `suite-claim-second-${suffix}`, expectedPreviewHash,
      providerConfig: {
        provider: AI_IMAGE_SUITE_PROVIDER, model: AI_IMAGE_SUITE_MODEL, providerConfigHash: '9'.repeat(64),
        pricingVersion: 'provider-free-zero/v1', estimatedCostPerImageCents: 0,
        maximumCostPerImageCents: 0, concurrencyLimit: 2,
      },
    });
    expect(result.kind).toBe('claimed');
  });

  it('rejects cross-authority and forged reference bindings without leaving partial rows', async () => {
    const storedSuite = await client.aiMediaSuite.findUniqueOrThrow({
      where: { id: suiteId },
      include: { slots: { orderBy: { ordinal: 'asc' } } },
    });
    const firstSlot = storedSuite.slots[0]!;
    const firstReferences = firstSlot.referencesSnapshot as Array<Record<string, unknown>>;
    const firstReference = firstReferences[0]!;
    const duplicateCandidateId = String(firstReference.candidateId);
    const duplicateEvidenceIds = [`suite-reference-duplicate-evidence:${suffix}`];
    const duplicateReference: Record<string, unknown> = {
      ...structuredClone(firstReference),
      evidenceIds: duplicateEvidenceIds,
    };
    const duplicateSlotKey = `suite-reference-duplicate:${suffix}`;
    const duplicateSlotSnapshot = {
      ...structuredClone(firstSlot.slotSnapshot as Record<string, unknown>),
      slotKey: duplicateSlotKey,
      references: [{
        candidateId: duplicateCandidateId,
        evidenceIds: duplicateEvidenceIds,
      }],
    };
    await expect(client.aiMediaSuiteSlot.create({ data: {
      suiteId,
      ownerUserId,
      ordinal: Math.max(...storedSuite.slots.map((slot) => slot.ordinal)) + 1,
      slotKey: duplicateSlotKey,
      goal: firstSlot.goal,
      ownershipLevel: firstSlot.ownershipLevel,
      ownershipKey: firstSlot.ownershipKey,
      compatibilityGroupKey: firstSlot.compatibilityGroupKey,
      slotSnapshot: duplicateSlotSnapshot,
      slotHash: hashAiMediaPlanningJson(duplicateSlotSnapshot),
      referencesSnapshot: [duplicateReference] as never,
      referencesHash: hashAiMediaPlanningJson([duplicateReference]),
      diagnostics: [],
      estimatedCostCents: 0,
      maximumCostCents: 0,
    } })).rejects.toThrow(/AI media suite slots can only be inserted by the initial claim/u);

    const slots = await client.aiMediaSuiteSlot.findMany({
      where: { suiteId, ownerUserId },
      orderBy: { ordinal: 'asc' },
    });
    expect(slots).toHaveLength(storedSuite.slots.length);

    const uniqueReferences = new Map<string, Record<string, any>>();
    const candidateOccurrences = new Map<string, number>();
    for (const slot of slots) {
      for (const reference of slot.referencesSnapshot as Array<Record<string, any>>) {
        const candidateId = String(reference.candidateId);
        candidateOccurrences.set(candidateId, (candidateOccurrences.get(candidateId) || 0) + 1);
        if (!uniqueReferences.has(candidateId)) {
          uniqueReferences.set(candidateId, reference);
        }
      }
    }
    repeatedCandidateId = [...candidateOccurrences]
      .find(([, occurrenceCount]) => occurrenceCount > 1)?.[0] || '';
    expect(repeatedCandidateId).not.toBe('');
    referenceFixtures = [];
    for (const [candidateId, reference] of uniqueReferences) {
      const source = reference.source as Record<string, any>;
      const expectedContentHash = typeof source.contentHash === 'string' ? source.contentHash : null;
      const sourceSha256 = expectedContentHash || digest(`raw:${candidateId}`);
      const assetSha256 = digest(`asset:${candidateId}`);
      const sizeBytes = 1_024 + referenceFixtures.length;
      const sourceMimeType = String(source.mimeType || 'image/jpeg').split(';', 1)[0]!
        .trim().toLowerCase().replace(/^image\/jpg$/u, 'image/jpeg');
      const mimeType = sourceMimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const asset = await client.mediaAsset.create({ data: {
        ownerUserId,
        kind: 'SOURCE_ORIGINAL',
        sourceCaptureSnapshotId: snapshotId,
        sourceMediaKey: candidateId,
        sourceUrl: String(source.url),
        url: `https://storage.example/${referenceFixtures.length}.jpg`,
        storageBackend: 'local',
        storageKey: `suite-reference/${suffix}/${referenceFixtures.length}.jpg`,
        mimeType,
        sizeBytes,
        width: Number(source.width) || 900,
        height: Number(source.height) || 1200,
        sha256: assetSha256,
        metadata: {
          lineageVersion: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
          sourceCaptureHash: captureHash,
          sourceSha256,
          sourceMimeType,
          sourceSizeBytes: sizeBytes,
        },
      } });
      referenceFixtures.push({
        sizeBytes,
        sourceMimeType,
        sourceSizeBytes: sizeBytes,
        binding: {
          ordinal: referenceFixtures.length,
          candidateId,
          sourceMediaKey: candidateId,
          sourceUrl: String(source.url),
          expectedContentHash,
          sourceSha256,
          assetId: asset.id,
          assetSha256,
          assetUrl: asset.url,
          storageBackend: asset.storageBackend,
          storageKey: asset.storageKey!,
          mimeType: asset.mimeType,
          width: asset.width!,
          height: asset.height!,
        },
      });
    }
    expect(referenceFixtures.length).toBe(uniqueReferences.size);

    const referenceTable = (client as any).aiMediaSuiteReferenceAsset;
    const first = referenceFixtures[0]!;
    const attemptDirectBinding = (data: Record<string, unknown>) => client.$transaction(async (tx) => {
      await tx.aiMediaSuite.update({
        where: { id: suiteId },
        data: { revision: { increment: 1 } },
      });
      return (tx as any).aiMediaSuiteReferenceAsset.create({ data });
    });
    for (const forged of [
      { frozenSourceUrl: 'https://attacker.example/forged.jpg' },
      { assetSha256: digest('forged-asset') },
      { rawSourceSha256: digest('forged-source') },
      { ordinal: first.binding.ordinal + 100 },
      { storageBackend: 'oss' },
      { storageKey: 'forged/storage-key.jpg' },
      { assetUrl: 'https://attacker.example/forged-storage.jpg' },
      { mimeType: first.binding.mimeType === 'image/png' ? 'image/jpeg' : 'image/png' },
    ]) {
      await expect(attemptDirectBinding(referenceBindingRow(first, forged))).rejects.toThrow();
    }

    const otherOwnerUserId = `suite_other_owner_${suffix}`;
    await client.user.create({ data: {
      id: otherOwnerUserId,
      phone: `suite_other_${suffix}`,
      passwordHash: 'integration-test',
    } });
    const otherOwnerAsset = await client.mediaAsset.create({ data: {
      ownerUserId: otherOwnerUserId,
      kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: first.binding.candidateId,
      sourceUrl: first.binding.sourceUrl,
      url: 'https://storage.example/cross-owner.jpg',
      storageBackend: 'local',
      storageKey: `suite-reference/${suffix}/cross-owner.jpg`,
      mimeType: first.binding.mimeType,
      sizeBytes: first.sizeBytes,
      width: first.binding.width,
      height: first.binding.height,
      sha256: first.binding.assetSha256,
      metadata: {
        sourceCaptureHash: captureHash,
        sourceSha256: first.binding.sourceSha256,
        sourceMimeType: first.sourceMimeType,
        sourceSizeBytes: first.sourceSizeBytes,
      },
    } });
    await expect(attemptDirectBinding(referenceBindingRow(first, {
      ownerUserId: otherOwnerUserId,
      assetId: otherOwnerAsset.id,
      assetUrl: otherOwnerAsset.url,
      storageKey: otherOwnerAsset.storageKey,
    }))).rejects.toThrow();

    const otherSubjectId = `suite_other_subject_${suffix}`;
    const otherSnapshotId = `suite_other_snapshot_${suffix}`;
    await client.sourceCaptureSubject.create({ data: {
      id: otherSubjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `suite_other_product_${suffix}`,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: otherSnapshotId,
      subjectId: otherSubjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash,
      payloadBytes,
      payload: capture as never,
      stageCounts: {},
      provenance: {},
      provenanceComplete: true,
      parserVersion: 'integration',
      completeness: {},
      truncations: [],
      hasEstimatedValues: false,
      profile: {},
      profileHash,
      actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'integration',
      rolloutStage: 'v2_only',
      capturedAt: new Date(),
    } });
    const crossSnapshotAsset = await client.mediaAsset.create({ data: {
      ownerUserId,
      kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: otherSnapshotId,
      sourceMediaKey: first.binding.candidateId,
      sourceUrl: first.binding.sourceUrl,
      url: 'https://storage.example/cross-snapshot.jpg',
      storageBackend: 'local',
      storageKey: `suite-reference/${suffix}/cross-snapshot.jpg`,
      mimeType: first.binding.mimeType,
      sizeBytes: first.sizeBytes,
      width: first.binding.width,
      height: first.binding.height,
      sha256: first.binding.assetSha256,
      metadata: {
        sourceCaptureHash: captureHash,
        sourceSha256: first.binding.sourceSha256,
        sourceMimeType: first.sourceMimeType,
        sourceSizeBytes: first.sourceSizeBytes,
      },
    } });
    await expect(attemptDirectBinding(referenceBindingRow(first, {
      assetId: crossSnapshotAsset.id,
      assetUrl: crossSnapshotAsset.url,
      storageKey: crossSnapshotAsset.storageKey,
    }))).rejects.toThrow();
    await expect(attemptDirectBinding(referenceBindingRow(first))).rejects.toThrow(
      /AI media suite (?:revision requires an audit event|reference set requires its exact audit event)/u,
    );
    expect(await referenceTable.count({ where: { suiteId } })).toBe(0);

    const bindings = referenceFixtures.map((fixture) => fixture.binding);
    referenceCommitInput = {
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: 1,
      operationKey: `suite-reference-commit-${suffix}`,
      sourceSubjectId: subjectId,
      sourceCaptureSnapshotId: snapshotId,
      sourceCaptureHash: captureHash,
      sourceProfileHash: profileHash,
      sourceSchemaVersion: 'source-product-capture-v2',
      referenceSetHash: hashAiMediaPlanningJson({
        version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
        suiteId,
        ownerUserId,
        sourceCaptureSnapshotId: snapshotId,
        bindings,
      }),
      bindings,
    };
  });

  it('commits repeated candidates once with exact concurrency replay and an audited barrier', async () => {
    const repository = new PrismaAiImageSuiteReferenceRepository(client);
    const service = createAiImageSuiteReferenceService({
      repository,
      preparationLease: passThroughPreparationLease,
      getStorage: async () => {
        throw new Error('fully internalized fixtures must not access storage');
      },
    });
    const operation = {
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: 1,
      operationKey: referenceCommitInput.operationKey,
    };
    const results = await Promise.all([
      service.internalize(operation),
      service.internalize(operation),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results.every((result) => (
      result.referenceSetHash === referenceCommitInput.referenceSetHash
      && result.referenceCount === referenceFixtures.length
    ))).toBe(true);
    expect(await service.internalize(operation)).toMatchObject({
      suiteId,
      replayed: true,
      referenceSetHash: referenceCommitInput.referenceSetHash,
    });

    const referenceTable = (client as any).aiMediaSuiteReferenceAsset;
    const rows = await referenceTable.findMany({ where: { suiteId }, orderBy: { ordinal: 'asc' } });
    expect(rows).toHaveLength(referenceFixtures.length);
    expect(rows.map((row: any) => row.ordinal)).toEqual(referenceFixtures.map((fixture) => fixture.binding.ordinal));
    expect(new Set(rows.map((row: any) => row.candidateId)).size).toBe(rows.length);
    expect(rows.filter((row: any) => row.candidateId === repeatedCandidateId)).toHaveLength(1);
    expect(await client.aiMediaSuiteEvent.count({ where: {
      suiteId,
      ownerUserId,
      eventType: 'REFERENCES_INTERNALIZED',
    } })).toBe(1);
    expect((await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } })).revision).toBe(2);
    expect(await client.aiMediaSuiteSlot.count({ where: {
      suiteId,
      childWorkflowId: { not: null },
    } })).toBe(0);
    expect(await client.aiMediaWorkflow.count({ where: { ownerUserId } })).toBe(0);
    expect(await client.aiImageJob.count({ where: { ownerUserId } })).toBe(0);
    expect(await client.aiCostReservation.count({ where: { ownerUserId } })).toBe(0);
  });

  it('keeps committed bindings and their media asset identity immutable', async () => {
    const referenceTable = (client as any).aiMediaSuiteReferenceAsset;
    const row = await referenceTable.findFirstOrThrow({ where: { suiteId, ownerUserId } });
    await expect(referenceTable.update({
      where: { id: row.id },
      data: { assetUrl: 'https://attacker.example/mutated.jpg' },
    })).rejects.toThrow(/AI media suite reference asset is immutable/u);
    await expect(referenceTable.delete({ where: { id: row.id } }))
      .rejects.toThrow(/AI media suite reference asset is immutable/u);
    await expect(client.mediaAsset.update({
      where: { id: row.assetId },
      data: { sourceUrl: 'https://attacker.example/source.jpg' },
    })).rejects.toThrow(/referenced media asset identity is immutable/u);
    await expect(client.mediaAsset.update({
      where: { id: row.assetId },
      data: { metadata: {
        sourceCaptureHash: captureHash,
        sourceSha256: row.rawSourceSha256,
        sourceMimeType: referenceFixtures[0]!.sourceMimeType,
        sourceSizeBytes: referenceFixtures[0]!.sourceSizeBytes,
        tampered: true,
      } },
    })).rejects.toThrow(/referenced media asset identity is immutable/u);
    expect(await referenceTable.count({ where: { suiteId, ownerUserId } })).toBe(referenceFixtures.length);
  });

  it('rejects a child workflow binding before the Prompt barrier and leaves the slot unchanged', async () => {
    const slot = await client.aiMediaSuiteSlot.findFirstOrThrow({
      where: { suiteId, ownerUserId },
      orderBy: { ordinal: 'asc' },
    });
    await expect(client.$executeRaw`
      UPDATE "ai_media_suite_slots"
      SET "child_workflow_id" = ${`unfrozen-child-${suffix}`}
      WHERE "id" = ${slot.id} AND "suite_id" = ${suiteId} AND "owner_user_id" = ${ownerUserId}
    `).rejects.toThrow(/child workflow requires frozen suite prompts/u);
    await expect(client.aiMediaSuiteSlot.findUniqueOrThrow({ where: { id: slot.id } }))
      .resolves.toMatchObject({ childWorkflowId: null, revision: slot.revision });
  });

  it('rolls back a revision-3 transaction when the frozen Prompt set is incomplete', async () => {
    const payload = {
      version: 'ai-image-suite-prompts-frozen/v1',
      promptSetHash: '1'.repeat(64),
      referenceSetHash: referenceCommitInput.referenceSetHash,
      slotPromptHashes: [],
    };
    await expect(client.$transaction(async (tx) => {
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: { revision: 3 } });
      await tx.aiMediaSuiteEvent.create({ data: {
        suiteId,
        ownerUserId,
        revision: 3,
        actorUserId: ownerUserId,
        eventKey: `incomplete-prompts-${suffix}`,
        eventType: 'PROMPTS_FROZEN',
        payload,
        payloadHash: hashAiMediaPlanningJson(payload),
      } });
    })).rejects.toThrow(/AI media suite Prompt set is incomplete/u);
    expect(await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } }))
      .toMatchObject({ revision: 2, status: 'PLANNED' });
    expect(await client.aiMediaSuitePromptSet.count({ where: { suiteId, ownerUserId } })).toBe(0);
    expect(await client.aiMediaSuiteSlotPrompt.count({ where: { suiteId, ownerUserId } })).toBe(0);
    expect(await client.aiMediaSuiteEvent.count({ where: { suiteId, ownerUserId, revision: 3 } })).toBe(0);
  });

  it('rejects a non-Prompt event at revision 3 before it can satisfy the generic audit barrier', async () => {
    const payload = { version: 'unrelated-suite-event/v1' };
    await expect(client.$transaction(async (tx) => {
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: { revision: 3 } });
      await tx.aiMediaSuiteEvent.create({ data: {
        suiteId,
        ownerUserId,
        revision: 3,
        actorUserId: ownerUserId,
        eventKey: `wrong-revision-event-${suffix}`,
        eventType: 'PLANNING_NOTE',
        payload,
        payloadHash: hashAiMediaPlanningJson(payload),
      } });
    })).rejects.toThrow(/revision 3 requires PROMPTS_FROZEN event/u);
    expect(await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } }))
      .toMatchObject({ revision: 2, status: 'PLANNED' });
    expect(await client.aiMediaSuiteEvent.count({ where: { suiteId, ownerUserId, revision: 3 } })).toBe(0);
  });

  it('freezes one complete Prompt set under concurrency without materializing paid work', async () => {
    const registry = new AiPromptTemplateRegistryService(
      new PrismaAiPromptTemplateStore(client),
      { getLegacyPrompt: async () => 'unused suite integration legacy Prompt' },
    );
    const service = createAiImageSuitePromptService({
      repository: new PrismaAiImageSuitePromptRepository(client),
      templateResolver: registry,
    });
    const operation = {
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: 2,
      operationKey: `suite-prompts-${suffix}`,
    };
    const results = await Promise.all([service.freeze(operation), service.freeze(operation)]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.promptSetHash)).size).toBe(1);

    const promptSetTable = (client as any).aiMediaSuitePromptSet;
    const slotPromptTable = (client as any).aiMediaSuiteSlotPrompt;
    const set = await promptSetTable.findFirstOrThrow({
      where: { suiteId, ownerUserId },
      include: { slots: { orderBy: { ordinal: 'asc' } } },
    });
    expect(set.slotCount).toBe(set.slots.length);
    expect(set.slots.length).toBeGreaterThan(1);
    expect(set.slots.map((row: any) => row.ordinal)).toEqual(
      Array.from({ length: set.slotCount }, (_, index) => index),
    );
    expect(set.slots.every((row: any) => (
      row.templateReleaseId === set.templateReleaseId
      && row.templateChecksum === set.templateChecksum
      && row.referenceSetHash === referenceCommitInput.referenceSetHash
      && row.resolvedPrompt.includes('Generation policy ozon-image-slot-policy/v1')
      && row.resolvedNegativePrompt.includes('Forbidden output policy ozon-image-slot-policy/v1')
    ))).toBe(true);
    expect(await client.aiMediaSuiteEvent.count({ where: {
      suiteId, ownerUserId, eventType: 'PROMPTS_FROZEN', revision: 3,
    } })).toBe(1);
    expect((await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } })).revision).toBe(3);

    const frozenRow = set.slots[0]!;
    await expect(slotPromptTable.update({
      where: { id: frozenRow.id }, data: { resolvedPrompt: 'tampered Prompt' },
    })).rejects.toThrow(/AI media suite slot Prompt is immutable/u);
    await expect(promptSetTable.delete({ where: { id: set.id } }))
      .rejects.toThrow(/AI media suite Prompt set is immutable/u);

    await expect(service.freeze(operation)).resolves.toMatchObject({
      suiteId, promptSetHash: set.promptSetHash, replayed: true,
    });
    await expect(service.freeze({
      ...operation, operationKey: `suite-prompts-other-${suffix}`,
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PROMPTS_ALREADY_FROZEN', statusCode: 409,
    });

    expect(await client.aiMediaSuiteSlot.count({ where: {
      suiteId, childWorkflowId: { not: null },
    } })).toBe(0);
    expect(await client.aiMediaWorkflow.count({ where: { ownerUserId } })).toBe(0);
    expect(await client.aiImageJob.count({ where: { ownerUserId } })).toBe(0);
    expect(await client.aiCostReservation.count({ where: { ownerUserId } })).toBe(0);
  });

  it('rolls back revision 4 when the materialized child graph is incomplete', async () => {
    const [storedSuite, promptSet] = await Promise.all([
      client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } }),
      client.aiMediaSuitePromptSet.findFirstOrThrow({ where: { suiteId, ownerUserId } }),
    ]);
    const payload = {
      version: 'ai-image-suite-children-materialized/v1',
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      promptSetHash: promptSet.promptSetHash,
      referenceSetHash: promptSet.referenceSetHash,
      operation: 'IMAGE_TO_IMAGE',
      provider: storedSuite.provider,
      model: storedSuite.model,
      providerConfigHash: storedSuite.providerConfigHash,
      pricingVersion: storedSuite.pricingVersion,
      outputProfile: AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION,
      width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
      height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
      slotCount: storedSuite.itemCount,
      childCount: storedSuite.itemCount,
      estimatedCostCents: storedSuite.estimatedCostCents,
      maximumCostCents: storedSuite.maximumCostCents,
      children: Array.from({ length: storedSuite.itemCount }, () => ({})),
      operationKey: `incomplete-materialization-${suffix}`,
      requestFingerprint: '5'.repeat(64),
      materializationHash: '6'.repeat(64),
    };
    await expect(client.$transaction(async (tx) => {
      await tx.aiMediaSuite.update({ where: { id: suiteId }, data: { revision: 4 } });
      await tx.aiMediaSuiteEvent.create({ data: {
        suiteId,
        ownerUserId,
        revision: 4,
        actorUserId: ownerUserId,
        eventKey: `incomplete-materialization-${suffix}`,
        eventType: 'CHILDREN_MATERIALIZED',
        payload,
        payloadHash: hashAiMediaPlanningJson(payload),
      } });
    })).rejects.toThrow(/AI media suite child authority does not match frozen slots/u);
    expect(await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } }))
      .toMatchObject({ revision: 3, status: 'PLANNED' });
    expect(await client.aiMediaSuiteEvent.count({ where: { suiteId, ownerUserId, revision: 4 } }))
      .toBe(0);
    expect(await client.aiMediaWorkflow.count({ where: { ownerUserId } })).toBe(0);
    expect(await client.aiImageJob.count({ where: { ownerUserId } })).toBe(0);
    expect(await client.aiCostReservation.count({ where: { ownerUserId } })).toBe(0);
  });

  it('materializes the frozen suite atomically into child graphs and replays without dispatch', async () => {
    const service = createAiImageSuiteMaterializationService(
      new PrismaAiImageSuiteMaterializationRepository(client),
    );
    const operation = {
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: 3,
      operationKey: `suite-materialize-${suffix}`,
    };
    const results = await Promise.all([
      service.materialize(operation),
      service.materialize(operation),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.materializationHash)).size).toBe(1);
    const materialized = results[0]!;
    expect(materialized.revision).toBe(4);
    expect(materialized.status).toBe('PLANNED');
    expect(materialized.childCount).toBe(materialized.children.length);
    expect(materialized.estimatedCostCents).toBe(0);
    expect(materialized.maximumCostCents).toBe(0);

    const storedSuite = await client.aiMediaSuite.findUniqueOrThrow({
      where: { id: suiteId },
      include: {
        slots: {
          orderBy: { ordinal: 'asc' },
          include: {
            childWorkflow: {
              include: {
                inputs: { orderBy: { ordinal: 'asc' } },
                jobs: { include: { costReservation: true } },
              },
            },
          },
        },
      },
    });
    expect(storedSuite.revision).toBe(4);
    expect(storedSuite.status).toBe('PLANNED');
    expect(storedSuite.slots).toHaveLength(storedSuite.itemCount);
    expect(storedSuite.slots.every((slot) => (
      slot.status === 'PLANNED'
      && slot.attempt === 1
      && slot.revision === 2
      && Boolean(slot.childWorkflowId)
    ))).toBe(true);
    const workflows = await client.aiMediaWorkflow.findMany({
      where: { ownerUserId, contextId: goodsId },
      include: {
        inputs: { orderBy: { ordinal: 'asc' } },
        jobs: { include: { costReservation: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(workflows).toHaveLength(storedSuite.itemCount);
    expect(workflows.every((workflow) => (
      workflow.operation === 'IMAGE_TO_IMAGE'
      && workflow.status === 'QUEUED'
      && workflow.contextType === 'collect'
      && workflow.contextId === goodsId
      && workflow.jobs.length === 1
      && workflow.jobs[0]!.status === 'PENDING'
      && workflow.jobs[0]!.width === AI_IMAGE_SUITE_OUTPUT_WIDTH
      && workflow.jobs[0]!.height === AI_IMAGE_SUITE_OUTPUT_HEIGHT
      && workflow.jobs[0]!.operationConfig
      && (workflow.jobs[0]!.operationConfig as Record<string, unknown>).version
        === AI_IMAGE_SUITE_CHILD_OPERATION_CONFIG_VERSION
      && (workflow.jobs[0]!.operationConfig as Record<string, unknown>).outputProfile
        === AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION
      && (workflow.jobs[0]!.operationConfig as Record<string, unknown>).width
        === AI_IMAGE_SUITE_OUTPUT_WIDTH
      && (workflow.jobs[0]!.operationConfig as Record<string, unknown>).height
        === AI_IMAGE_SUITE_OUTPUT_HEIGHT
      && workflow.jobs[0]!.costReservation?.status === 'RESERVED'
      && workflow.jobs[0]!.costReservation?.estimatedCostMinor === 0
      && workflow.jobs[0]!.costReservation?.maximumCostMinor === 0
    ))).toBe(true);
    expect(await client.aiMediaSuiteEvent.count({
      where: { suiteId, ownerUserId, revision: 4, eventType: 'CHILDREN_MATERIALIZED' },
    })).toBe(1);
    const materializedEvent = await client.aiMediaSuiteEvent.findFirstOrThrow({
      where: { suiteId, ownerUserId, revision: 4, eventType: 'CHILDREN_MATERIALIZED' },
    });
    expect(materializedEvent.actorUserId).toBe(ownerUserId);
    expect(materializedEvent.payload).toMatchObject({ actorUserId: ownerUserId });
    expect(await client.aiMediaWorkflowEvent.count({ where: { ownerUserId } }))
      .toBe(storedSuite.itemCount);
    expect(await client.aiImageJob.count({ where: { ownerUserId } }))
      .toBe(storedSuite.itemCount);
    expect(await client.aiCostReservation.count({ where: { ownerUserId } }))
      .toBe(storedSuite.itemCount);

    const promptSet = await client.aiMediaSuitePromptSet.findFirstOrThrow({
      where: { suiteId, ownerUserId },
    });
    expect(workflows.every((workflow) => workflow.jobs[0]!.prompt.length > 0)).toBe(true);
    expect(workflows.every((workflow) => (
      workflow.jobs[0]!.templateReleaseId === promptSet.templateReleaseId
      && workflow.jobs[0]!.templateChecksum === promptSet.templateChecksum
    ))).toBe(true);

    const replay = await service.materialize(operation);
    expect(replay).toMatchObject({ replayed: true, materializationHash: materialized.materializationHash });
    await expect(service.materialize({
      ...operation,
      operationKey: `suite-materialize-other-${suffix}`,
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_CHILDREN_ALREADY_MATERIALIZED',
      statusCode: 409,
    });

    await client.sourceCaptureSnapshot.create({ data: {
      id: `suite_snapshot_later_${suffix}`,
      subjectId,
      version: 2,
      schemaVersion: 'source-product-capture-v2',
      captureHash: '8'.repeat(64),
      payloadBytes,
      payload: capture as never,
      stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'integration',
      completeness: {}, truncations: [], hasEstimatedValues: false, profile: {},
      profileHash: '7'.repeat(64), actorUserId: ownerUserId, ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'integration-later', rolloutStage: 'v2_only', capturedAt: new Date(),
    } });
    await expect(service.materialize(operation)).resolves.toMatchObject({
      replayed: true,
      materializationHash: materialized.materializationHash,
    });
  });

  it('keeps revision 4 terminal until the dispatch contract explicitly replaces the barrier', async () => {
    await expect(client.aiMediaSuite.update({
      where: { id: suiteId },
      data: { revision: { increment: 1 } },
    })).rejects.toThrow(/revision beyond materialization is not enabled/u);
    expect((await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } })).revision).toBe(4);
  });

  it('rejects extra jobs, inputs and lifecycle/output mutations after a suite child graph is materialized', async () => {
    const workflow = await client.aiMediaWorkflow.findFirstOrThrow({
      where: { ownerUserId, contextId: goodsId },
      include: {
        inputs: { orderBy: { ordinal: 'asc' } },
        jobs: { include: { costReservation: true }, orderBy: { workflowAttempt: 'asc' } },
      },
    });
    const job = workflow.jobs[0]!;
    const workflowInput = workflow.inputs[0]!;
    const suiteSlot = await client.aiMediaSuiteSlot.findFirstOrThrow({
      where: { suiteId, ownerUserId, childWorkflowId: workflow.id },
    });

    await expect(client.aiMediaSuiteSlot.update({
      where: { id: suiteSlot.id },
      data: {
        status: 'QUEUED',
        attempt: { increment: 1 },
        revision: { increment: 1 },
      },
    })).rejects.toThrow(/materialized AI media suite slot lifecycle is parent-controlled/u);

    await expect(client.aiImageJob.create({ data: {
      ownerUserId,
      actorUserId: ownerUserId,
      operation: 'IMAGE_TO_IMAGE',
      workflowId: workflow.id,
      workflowAttempt: 2,
      status: 'PENDING',
      provider: job.provider,
      model: job.model,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      resolvedPrompt: job.resolvedPrompt,
      resolvedNegativePrompt: job.resolvedNegativePrompt,
      templateKey: job.templateKey,
      templateReleaseId: job.templateReleaseId,
      templateChecksum: job.templateChecksum,
      templateSnapshot: job.templateSnapshot ?? undefined,
      requestFingerprint: job.requestFingerprint,
      inputAssets: job.inputAssets ?? undefined,
      operationConfig: job.operationConfig ?? undefined,
      requestedImageCount: job.requestedImageCount,
      width: job.width,
      height: job.height,
      maxAttempts: 1,
      idempotencyKey: `forged-suite-child-job-${suffix}`,
      estimatedCostCents: job.estimatedCostCents,
    } })).rejects.toThrow(/materialized AI media suite child graph is append-closed/u);

    await expect(client.aiMediaWorkflowInput.create({ data: {
      workflowId: workflow.id,
      ownerUserId,
      assetId: workflowInput.assetId,
      role: 'MASK',
      ordinal: 999,
      assetSha256: workflowInput.assetSha256,
      assetUrl: workflowInput.assetUrl,
      mimeType: workflowInput.mimeType,
      width: workflowInput.width,
      height: workflowInput.height,
    } })).rejects.toThrow(/materialized AI media suite child graph is append-closed/u);

    await expect(client.aiCostReservation.delete({
      where: { id: job.costReservation!.id },
    })).rejects.toThrow(/materialized AI media suite cost reservation is parent-controlled/u);

    await expect(client.aiMediaWorkflow.update({
      where: { id: workflow.id },
      data: { status: 'RUNNING' },
    })).rejects.toThrow(/materialized AI media suite child lifecycle is parent-controlled/u);

    await expect(client.aiImageJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING' },
    })).rejects.toThrow(/materialized AI media suite child job lifecycle is parent-controlled/u);

    await expect(client.aiCostReservation.update({
      where: { id: job.costReservation!.id },
      data: { updatedAt: new Date(Date.now() + 1_000) },
    })).rejects.toThrow(/materialized AI media suite cost reservation is parent-controlled/u);

    await expect(client.mediaAsset.create({ data: {
      ownerUserId,
      aiImageJobId: job.id,
      kind: 'AI_GENERATED',
      url: `https://storage.example/forged-suite-output-${suffix}.png`,
      storageBackend: 'local',
      storageKey: `suite-output/${suffix}/forged.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: AI_IMAGE_SUITE_OUTPUT_WIDTH,
      height: AI_IMAGE_SUITE_OUTPUT_HEIGHT,
      sha256: '7'.repeat(64),
    } })).rejects.toThrow(/AI media suite child output requires the dispatch contract/u);
  });

  it('runs the real dispatch coordinator, aggregates failures, retries one slot and cancels without losing success', async () => {
    const repository = new PrismaAiImageSuiteExecutionRepository(client, {
      runtimeReady: async () => true,
    });
    const service = createAiImageSuiteExecutionService(repository);
    const dispatchInput = {
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: 4,
      operationKey: `suite-dispatch-${suffix}`,
    };
    const [firstDispatch, replayDispatch] = await Promise.all([
      service.dispatch(dispatchInput),
      service.dispatch(dispatchInput),
    ]);
    expect([firstDispatch.replayed, replayDispatch.replayed].sort()).toEqual([false, true]);
    expect(firstDispatch.status).toBe('QUEUED');
    expect(firstDispatch.counts.queued).toBeGreaterThan(0);
    expect(firstDispatch.counts.queued).toBeLessThanOrEqual(firstDispatch.concurrencyLimit);

    const suiteUploadOptions: Array<Record<string, unknown> | undefined> = [];
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(client, {
      runtimeReady: async () => true,
      createFakeImage: async () => ({
        buffer: Buffer.from('suite-integration-output'),
        mimeType: 'image/png',
        filename: 'suite-integration.png',
      }),
      uploadBuffer: async (_buffer, filename, mimeType, options) => {
        suiteUploadOptions.push(options);
        return {
          url: `https://storage.example/${suffix}/${filename}`,
          backend: 'local',
          filename,
          key: `${suffix}/${filename}`,
          mimeType,
        };
      },
    });
    const firstTask = (await repository.listQueueableTasks(suiteId))[0]!;
    const firstClaim = await coordinator.revalidateAndClaim(firstTask);
    expect(firstClaim.kind).toBe('ready');
    if (firstClaim.kind !== 'ready') throw new Error('suite integration claim was not ready');
    await expect(coordinator.execute(firstTask, firstClaim)).resolves.toMatchObject({ kind: 'completed' });
    expect(suiteUploadOptions).toEqual([expect.objectContaining({
      category: 'ai-generated',
      ownerId: ownerUserId,
      idempotencyKey: `${firstTask.jobId}:${createHash('sha256')
        .update(Buffer.from('suite-integration-output'))
        .digest('hex')}`,
    })]);

    for (let index = 0; index < 1_000; index += 1) {
      const task = (await repository.listQueueableTasks(suiteId))[0];
      if (!task) break;
      const claim = await coordinator.revalidateAndClaim(task);
      if (claim.kind === 'ignored') continue;
      await coordinator.rejectRuntimeGate(task, claim, {
        code: 'AI_MEDIA_SUITE_PAID_PROVIDER_NOT_VERIFIED',
        message: 'Integration fixture forces a deterministic failed sibling',
      });
    }
    const failedSuite = await client.aiMediaSuite.findUniqueOrThrow({
      where: { id: suiteId },
      include: { slots: { orderBy: { ordinal: 'asc' } } },
    });
    expect(failedSuite.status).toBe('PARTIAL_FAILURE');
    expect(failedSuite.slots.filter((slot) => slot.status === 'SUCCEEDED')).toHaveLength(1);
    const failedSlot = failedSuite.slots.find((slot) => slot.status === 'FAILED')!;
    const retry = await service.retryFailedSlot({
      suiteId,
      slotId: failedSlot.id,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedSlotRevision: failedSlot.revision,
      operationKey: `suite-retry-${suffix}`,
    });
    expect(retry).toMatchObject({ replayed: false, status: 'QUEUED' });
    expect(retry.slots.find((slot) => slot.slotId === failedSlot.id)).toMatchObject({
      status: 'QUEUED',
      attempt: 2,
    });
    const retryTask = (await repository.listQueueableTasks(suiteId))
      .find((task) => task.slotId === failedSlot.id)!;
    let markGenerationStarted: (() => void) | undefined;
    let rejectGeneration: ((error: Error) => void) | undefined;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const cancellationCoordinator = new PrismaAiImageSuiteGenerationCoordinator(client, {
      runtimeReady: async () => true,
      createFakeImage: async () => new Promise<never>((_resolve, reject) => {
        rejectGeneration = reject;
        markGenerationStarted?.();
      }),
    });
    const retryClaim = await cancellationCoordinator.revalidateAndClaim(retryTask);
    expect(retryClaim.kind).toBe('ready');
    if (retryClaim.kind !== 'ready') throw new Error('suite retry claim was not ready');
    const execution = cancellationCoordinator.execute(retryTask, retryClaim);
    await generationStarted;
    const runningSuite = await client.aiMediaSuite.findUniqueOrThrow({ where: { id: suiteId } });
    const cancelRequested = await service.cancel({
      suiteId,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: runningSuite.revision,
      operationKey: `suite-cancel-${suffix}`,
    });
    expect(cancelRequested).toMatchObject({ replayed: false, status: 'CANCEL_REQUESTED' });
    rejectGeneration?.(new Error('integration generation failure after cancellation'));
    await expect(execution).resolves.toMatchObject({ kind: 'completed' });
    const cancelled = await client.aiMediaSuite.findUniqueOrThrow({
      where: { id: suiteId },
      include: { slots: { orderBy: { ordinal: 'asc' } } },
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.slots.filter((slot) => slot.status === 'SUCCEEDED')).toHaveLength(1);
    expect(cancelled.slots.filter((slot) => slot.status === 'CANCELLED')).not.toHaveLength(0);
    expect(await client.mediaAsset.count({ where: { ownerUserId, aiImageJob: { workflow: { suiteSlot: { suiteId } } } } }))
      .toBe(1);
  });
});
