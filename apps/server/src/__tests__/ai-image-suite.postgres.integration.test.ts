import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  createSourceProductCaptureV2Submission,
  type SourceProductCaptureV2,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiMediaPlanningRepository } from '../repositories/ai-media-planning-repository.js';
import { PrismaAiImageSuiteReferenceRepository } from '../repositories/ai-image-suite-reference-repository.js';
import { PrismaAiImageSuiteRepository } from '../repositories/ai-image-suite-repository.js';
import {
  AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
  createAiImageSuiteReferenceService,
  type AiImageSuiteReferenceBinding,
  type AiImageSuiteReferenceCommitInput,
} from '../services/ai-image-suite-references.js';
import { createAiMediaPlanningService, hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
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

interface ReferenceBindingFixture {
  binding: AiImageSuiteReferenceBinding;
  sizeBytes: number;
  sourceMimeType: string;
  sourceSizeBytes: number;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
    const storedSuite = await client.aiMediaSuite.findFirstOrThrow({ where: { ownerUserId, planId } });
    suiteId = storedSuite.id;
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
});
