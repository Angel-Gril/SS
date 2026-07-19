import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  createSourceProductCaptureV2Submission,
  type SourceProductCaptureV2,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiMediaPlanningRepository } from '../repositories/ai-media-planning-repository.js';
import { PrismaAiImageSuiteRepository } from '../repositories/ai-image-suite-repository.js';
import { createAiMediaPlanningService } from '../services/ai-media-planning.js';
import { createAiImageSuitePreview } from '../services/ai-image-suite.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
} from '../services/ai-image-provider-capabilities.js';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const sourceFixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

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

    const planning = createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(client));
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
    expect(await client.aiMediaSuite.count({ where: { ownerUserId, planId } })).toBe(1);
    expect(await client.aiMediaSuiteSlot.count({ where: { ownerUserId } })).toBe(8);
    expect(await client.aiMediaSuiteEvent.count({ where: { ownerUserId } })).toBe(1);
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
});
