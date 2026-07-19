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
import {
  AiMediaPlanningError,
  createAiMediaPlanningService,
  hashAiMediaPlanningJson,
  type CreateRuleBasedAiMediaPlanningInput,
} from '../services/ai-media-planning.js';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';

const sourceCaptureFixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';

function assertIsolatedDatabaseUrl(): void {
  if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
  const schema = new URL(databaseUrl).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

describe.skipIf(!enabled)('AI media planning PostgreSQL persistence', () => {
  let client: PrismaClient;
  let service: ReturnType<typeof createAiMediaPlanningService>;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ownerUserId = `plan_owner_${suffix}`;
  const otherOwnerUserId = `plan_other_${suffix}`;
  const subjectId = `plan_subject_${suffix}`;
  const snapshotId = `plan_snapshot_${suffix}`;
  const goodsId = `plan_goods_${suffix}`;
  let capture: SourceProductCaptureV2;
  let captureHash = '';
  let payloadBytes = 0;
  let profileHash = '';
  const selectedSkuKey = sourceCaptureFixture.capture.skus[0]!.key;
  const selectedMediaKey = sourceCaptureFixture.capture.media.find((media) => (
    media.kind === 'image'
    && media.disposition === 'accepted'
    && Boolean(media.url)
    && (media.skuKeys.length === 0 || media.skuKeys.includes(selectedSkuKey))
  ))!.key;

  function capturePayload() {
    return structuredClone(capture);
  }

  function input(overrides: Partial<CreateRuleBasedAiMediaPlanningInput> = {}): CreateRuleBasedAiMediaPlanningInput {
    return {
      ownerUserId,
      actorUserId: ownerUserId,
      sourceSubjectId: subjectId,
      sourceCaptureSnapshotId: snapshotId,
      context: { type: 'collect', id: goodsId },
      idempotencyKey: `plan-create-${suffix}`,
      selectedSkuKeys: [selectedSkuKey],
      candidateMediaKeys: [selectedMediaKey],
      ...overrides,
    };
  }

  beforeAll(async () => {
    assertIsolatedDatabaseUrl();
    capture = structuredClone(sourceCaptureFixture.capture);
    const selectedMedia = capture.media.find((media) => media.key === selectedMediaKey)!;
    selectedMedia.width = 900;
    selectedMedia.height = 1200;
    selectedMedia.fieldEvidence.width = {
      ...selectedMedia.fieldEvidence.width,
      value: 900,
      missingReason: null,
    };
    selectedMedia.fieldEvidence.height = {
      ...selectedMedia.fieldEvidence.height,
      value: 1200,
      missingReason: null,
    };
    const submission = await createSourceProductCaptureV2Submission(capture);
    captureHash = submission.captureHash;
    payloadBytes = submission.payloadBytes;
    profileHash = buildSourceProductProfileFromCapture(capture, {
      itemId: captureHash,
      captureHash,
    }).hash;
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    service = createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(client));
    await client.user.createMany({ data: [{
      id: ownerUserId,
      phone: `plan_owner_${suffix}`,
      passwordHash: 'integration-test',
    }, {
      id: otherOwnerUserId,
      phone: `plan_other_${suffix}`,
      passwordHash: 'integration-test',
    }] });
    await client.supplyGoods.create({ data: {
      id: goodsId,
      userId: ownerUserId,
      title: 'AI planning integration fixture',
      sourcePlatform: '1688',
      sourceProductId: `plan_product_${suffix}`,
    } });
    await client.sourceCaptureSubject.create({ data: {
      id: subjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `plan_product_${suffix}`,
      legacySupplyGoodsId: goodsId,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshotId,
      subjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash,
      payloadBytes,
      payload: capturePayload() as never,
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
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('replays an exact create and rejects a changed request under the same key', async () => {
    const created = await service.createRuleBased(input());
    const replayed = await service.createRuleBased(input());

    expect(created).toMatchObject({ replayed: false, plan: { revision: 1, reviewStatus: 'PENDING' } });
    expect(replayed).toMatchObject({ replayed: true, plan: { id: created.plan.id } });
    await expect(service.createRuleBased(input({ galleryGoals: ['scene'] }))).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_IDEMPOTENCY_CONFLICT',
    });
    expect(await client.aiMediaPlan.count({ where: { ownerUserId } })).toBe(1);
    expect(await client.aiMediaPlanningRun.count({ where: { ownerUserId } })).toBe(1);
    expect(await client.aiMediaPlanVersion.count({ where: { ownerUserId } })).toBe(1);
    expect(await client.aiMediaPlanEvent.count({ where: { ownerUserId } })).toBe(1);
    expect(await client.aiCostReservation.count({ where: { ownerUserId } })).toBe(0);
  });

  it('rejects an owner and snapshot from different tenant chains', async () => {
    await expect(service.createRuleBased(input({
      ownerUserId: otherOwnerUserId,
      actorUserId: otherOwnerUserId,
      idempotencyKey: `cross-owner-${suffix}`,
    }))).rejects.toMatchObject({ code: 'AI_MEDIA_PLANNING_CONTEXT_CHANGED' });
    expect(await client.aiMediaPlan.count({ where: { ownerUserId: otherOwnerUserId } })).toBe(0);
  });

  it('rejects SKU and media keys that are not bound to the authoritative snapshot', async () => {
    await expect(service.createRuleBased(input({
      idempotencyKey: `fake-media-${suffix}`,
      candidateMediaKeys: ['fabricated-media'],
    }))).rejects.toMatchObject({ code: 'AI_MEDIA_PLANNING_INVALID_INPUT' });
    await expect(service.createRuleBased(input({
      idempotencyKey: `fake-sku-${suffix}`,
      selectedSkuKeys: ['fabricated-sku'],
    }))).rejects.toMatchObject({ code: 'AI_MEDIA_PLANNING_INVALID_INPUT' });
    expect(await client.aiMediaPlan.count({ where: {
      ownerUserId,
      idempotencyKey: { in: [`fake-media-${suffix}`, `fake-sku-${suffix}`] },
    } })).toBe(0);
  });

  it('rejects a stored snapshot whose payload does not match its capture hash', async () => {
    const badGoodsId = `plan_bad_goods_${suffix}`;
    const badSubjectId = `plan_bad_subject_${suffix}`;
    const badSnapshotId = `plan_bad_snapshot_${suffix}`;
    await client.supplyGoods.create({ data: {
      id: badGoodsId,
      userId: ownerUserId,
      title: 'Invalid planning authority fixture',
      sourcePlatform: '1688',
      sourceProductId: `plan_bad_product_${suffix}`,
    } });
    await client.sourceCaptureSubject.create({ data: {
      id: badSubjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `plan_bad_product_${suffix}`,
      legacySupplyGoodsId: badGoodsId,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: badSnapshotId,
      subjectId: badSubjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash: '9'.repeat(64),
      payloadBytes: 2,
      payload: {},
      stageCounts: {},
      provenance: {},
      provenanceComplete: true,
      parserVersion: 'integration',
      completeness: {},
      truncations: [],
      hasEstimatedValues: false,
      profile: {},
      profileHash: '8'.repeat(64),
      actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'integration',
      rolloutStage: 'v2_only',
      capturedAt: new Date(),
    } });

    await expect(service.createRuleBased(input({
      sourceSubjectId: badSubjectId,
      sourceCaptureSnapshotId: badSnapshotId,
      context: { type: 'collect', id: badGoodsId },
      idempotencyKey: `bad-authority-${suffix}`,
    }))).rejects.toMatchObject({ code: 'AI_MEDIA_PLANNING_CONTEXT_CHANGED' });
  });

  it('applies review with CAS and exact operation replay semantics', async () => {
    const created = await service.createRuleBased(input({ idempotencyKey: `review-${suffix}` }));
    const reviewInput = {
      planId: created.plan.id,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: created.plan.revision,
      operationKey: `approve-${suffix}`,
      decision: 'APPROVE' as const,
      note: 'approved integration fixture',
    };
    const approved = await service.review(reviewInput);
    const replayed = await service.review(reviewInput);

    expect(approved).toMatchObject({ replayed: false, plan: {
      revision: 2,
      reviewStatus: 'APPROVED',
      approvedVersionId: created.plan.currentVersionId,
    } });
    expect(replayed).toMatchObject({ replayed: true, plan: { revision: 2 } });
    await expect(service.review({ ...reviewInput, decision: 'REJECT' })).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_OPERATION_CONFLICT',
    });
    await expect(service.review({
      ...reviewInput,
      operationKey: `stale-cas-${suffix}`,
      expectedRevision: 1,
    })).rejects.toMatchObject({ code: 'AI_MEDIA_PLANNING_REVISION_CONFLICT' });
    await expect(service.requireApprovedForExecution({
      planId: created.plan.id,
      ownerUserId,
      actorUserId: ownerUserId,
    })).resolves.toMatchObject({
      reviewStatus: 'APPROVED',
      staleAt: null,
    });
  });

  it('allows only one competing review decision for the same revision', async () => {
    const created = await service.createRuleBased(input({ idempotencyKey: `review-race-${suffix}` }));
    const base = {
      planId: created.plan.id,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: created.plan.revision,
      note: null,
    };
    const results = await Promise.allSettled([
      service.review({ ...base, operationKey: `race-approve-${suffix}`, decision: 'APPROVE' }),
      service.review({ ...base, operationKey: `race-reject-${suffix}`, decision: 'REJECT' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        code: expect.stringMatching(/AI_MEDIA_PLANNING_(REVISION|REVIEW_STATE)_CONFLICT/u),
      }),
    });
    expect(await client.aiMediaPlanEvent.count({ where: { planId: created.plan.id } })).toBe(2);
  });

  it('marks a plan stale when a newer source snapshot exists and blocks review and execution', async () => {
    const staleGoodsId = `plan_stale_goods_${suffix}`;
    const staleSubjectId = `plan_stale_subject_${suffix}`;
    const staleSnapshotId = `plan_stale_snapshot_${suffix}`;
    await client.supplyGoods.create({ data: {
      id: staleGoodsId,
      userId: ownerUserId,
      title: 'AI planning stale fixture',
      sourcePlatform: '1688',
      sourceProductId: `plan_stale_product_${suffix}`,
    } });
    await client.sourceCaptureSubject.create({ data: {
      id: staleSubjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `plan_stale_product_${suffix}`,
      legacySupplyGoodsId: staleGoodsId,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: staleSnapshotId,
      subjectId: staleSubjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash,
      payloadBytes,
      payload: capturePayload() as never,
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
    const staleInput = input({
      sourceSubjectId: staleSubjectId,
      sourceCaptureSnapshotId: staleSnapshotId,
      context: { type: 'collect', id: staleGoodsId },
      idempotencyKey: `stale-${suffix}`,
    });
    const created = await service.createRuleBased(staleInput);
    await client.sourceCaptureSnapshot.create({ data: {
      id: `plan_snapshot_new_${suffix}`,
      subjectId: staleSubjectId,
      version: 2,
      schemaVersion: 'source-product-capture-v2',
      captureHash: 'd'.repeat(64),
      payloadBytes,
      payload: capturePayload() as never,
      stageCounts: {},
      provenance: {},
      provenanceComplete: true,
      parserVersion: 'integration',
      completeness: {},
      truncations: [],
      hasEstimatedValues: false,
      profile: {},
      profileHash: 'e'.repeat(64),
      actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'integration',
      rolloutStage: 'v2_only',
      capturedAt: new Date(Date.now() + 1_000),
    } });

    await expect(service.createRuleBased(staleInput)).resolves.toMatchObject({
      replayed: true,
      plan: { id: created.plan.id },
    });

    await expect(service.review({
      planId: created.plan.id,
      ownerUserId,
      actorUserId: ownerUserId,
      expectedRevision: created.plan.revision,
      operationKey: `stale-review-${suffix}`,
      decision: 'APPROVE',
      note: null,
    })).rejects.toMatchObject({ code: 'AI_MEDIA_PLANNING_STALE' });
    const stale = await service.get(created.plan.id, ownerUserId);
    expect(stale).toMatchObject({ revision: 2, reviewStatus: 'PENDING' });
    expect(stale.staleAt).toBeInstanceOf(Date);
    await expect(service.requireApprovedForExecution({
      planId: created.plan.id,
      ownerUserId,
      actorUserId: ownerUserId,
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_PLANNING_STALE',
    });
  });

  it('protects immutable versions and events from update or delete', async () => {
    const created = await service.createRuleBased(input({ idempotencyKey: `immutable-${suffix}` }));
    const versionId = created.plan.currentVersionId!;
    const event = await client.aiMediaPlanEvent.findFirstOrThrow({ where: { planId: created.plan.id } });

    await expect(client.aiMediaPlanVersion.update({
      where: { id: versionId },
      data: { planHash: 'f'.repeat(64) },
    })).rejects.toThrow(/plan version is immutable/i);
    await expect(client.aiMediaPlanVersion.delete({ where: { id: versionId } }))
      .rejects.toThrow(/plan version is immutable/i);
    await expect(client.aiMediaPlanEvent.update({
      where: { id: event.id },
      data: { eventType: 'TAMPERED' },
    })).rejects.toThrow(/plan event is immutable/i);
    await expect(client.aiMediaPlanEvent.delete({ where: { id: event.id } }))
      .rejects.toThrow(/plan event is immutable/i);
  });

  it('rejects impossible immutable version sequences and unaudited plan mutations', async () => {
    const created = await service.createRuleBased(input({ idempotencyKey: `db-invariants-${suffix}` }));
    const plan = await client.aiMediaPlan.findUniqueOrThrow({ where: { id: created.plan.id } });
    const current = await client.aiMediaPlanVersion.findUniqueOrThrow({
      where: { id: created.plan.currentVersionId! },
    });
    const originalRun = await client.aiMediaPlanningRun.findUniqueOrThrow({
      where: { id: current.planningRunId },
    });

    await expect(client.$transaction(async (tx) => {
      const run = await tx.aiMediaPlanningRun.create({ data: {
        planId: plan.id,
        ownerUserId,
        sourceSubjectId: subjectId,
        actorUserId: ownerUserId,
        sourceCaptureSnapshotId: snapshotId,
        attempt: 2,
        mode: 'RULE_BASED',
        engineVersion: 'db-invariant-test',
        status: 'SUCCEEDED',
        idempotencyKey: `bad-sequence-${suffix}`,
        requestFingerprint: originalRun.requestFingerprint,
        sourceCaptureHash: captureHash,
        sourceProfileHash: profileHash,
        inputFingerprint: originalRun.inputFingerprint,
        inputSnapshot: originalRun.inputSnapshot as never,
        inputHash: originalRun.inputHash,
        inputBytes: originalRun.inputBytes,
        startedAt: new Date(),
        completedAt: new Date(),
      } });
      await tx.aiMediaPlanVersion.create({ data: {
        planId: plan.id,
        ownerUserId,
        sourceSubjectId: subjectId,
        version: 3,
        planningRunId: run.id,
        parentVersionId: current.id,
        sourceCaptureSnapshotId: snapshotId,
        sourceCaptureHash: captureHash,
        sourceProfileHash: profileHash,
        sourceSchemaVersion: current.sourceSchemaVersion,
        selectedSkuHash: current.selectedSkuHash,
        inputAssetSetHash: current.inputAssetSetHash,
        inputFingerprint: current.inputFingerprint,
        planSchemaVersion: current.planSchemaVersion,
        plannerVersion: current.plannerVersion,
        mode: 'RULE_BASED',
        inputSnapshot: current.inputSnapshot as never,
        inputHash: current.inputHash,
        curation: current.curation as never,
        curationHash: current.curationHash,
        visionEvidence: current.visionEvidence as never,
        visionEvidenceHash: current.visionEvidenceHash,
        planPayload: current.planPayload as never,
        planHash: current.planHash,
        planBytes: current.planBytes,
        provenance: current.provenance as never,
        provenanceHash: current.provenanceHash,
        actorUserId: ownerUserId,
      } });
    })).rejects.toThrow(/plan version provenance mismatch/i);

    await expect(client.aiMediaPlan.update({
      where: { id: plan.id },
      data: { revision: { increment: 1 } },
    })).rejects.toThrow(/revision requires an audit event/i);
    expect(await client.aiMediaPlan.findUniqueOrThrow({ where: { id: plan.id } }))
      .toMatchObject({ revision: plan.revision });
  });

  it('requires reviewer identity and matching review evidence before approval', async () => {
    const created = await service.createRuleBased(input({ idempotencyKey: `review-evidence-${suffix}` }));

    await expect(client.aiMediaPlan.update({
      where: { id: created.plan.id },
      data: {
        revision: { increment: 1 },
        reviewStatus: 'APPROVED',
        approvedVersionId: created.plan.currentVersionId,
      },
    })).rejects.toThrow(/ai_media_plan_state_check|check constraint/u);

    await expect(client.$transaction(async (tx) => {
      await tx.aiMediaPlan.update({
        where: { id: created.plan.id },
        data: {
          revision: { increment: 1 },
          reviewStatus: 'APPROVED',
          approvedVersionId: created.plan.currentVersionId,
          reviewedByUserId: ownerUserId,
          reviewedAt: new Date(),
        },
      });
      const payload = { tampered: true };
      await tx.aiMediaPlanEvent.create({ data: {
        planId: created.plan.id,
        ownerUserId,
        versionId: created.plan.currentVersionId,
        revision: created.plan.revision + 1,
        actorUserId: ownerUserId,
        eventKey: `${created.plan.id}:tampered-review`,
        eventType: 'SOURCE_CONTEXT_STALE',
        payload,
        payloadHash: hashAiMediaPlanningJson(payload),
      } });
    })).rejects.toThrow(/review requires matching audit evidence/i);

    await expect(service.requireApprovedForExecution({
      planId: created.plan.id,
      ownerUserId,
      actorUserId: ownerUserId,
    })).rejects.toMatchObject({ code: 'AI_MEDIA_PLANNING_NOT_APPROVED' });
  });

  it('exposes stable typed errors', () => {
    expect(new AiMediaPlanningError('AI_MEDIA_PLANNING_NOT_FOUND', 'missing', 404))
      .toMatchObject({ code: 'AI_MEDIA_PLANNING_NOT_FOUND', statusCode: 404 });
  });
});
