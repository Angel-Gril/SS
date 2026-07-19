import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageSuiteRepository } from '../repositories/ai-image-suite-repository.js';
import {
  createAiImageSuitePreview,
  type AiImageSuitePlanAuthority,
  type ClaimAiImageSuiteInput,
} from '../services/ai-image-suite.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
} from '../services/ai-image-provider-capabilities.js';

function candidateEvidenceId(snapshotId: string, candidateId: string) {
  const path = `/media/${encodeURIComponent(candidateId)}`;
  const hash = createHash('sha256').update(`${path}\u0000${candidateId}`).digest('hex');
  return `capture:${snapshotId}:evidence:${hash}`;
}

function planAuthority(): AiImageSuitePlanAuthority {
  return {
    planId: 'plan-1',
    planVersionId: 'version-1',
    planRevision: 2,
    planHash: 'f'.repeat(64),
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    contextType: 'collect',
    contextId: 'goods-1',
    inputSnapshot: {
      candidates: [{
        id: 'media-1', url: 'https://source.example/media-1.png', width: 900, height: 1200,
        mimeType: 'image/png', role: 'product_main', skuKeys: ['sku-1'],
        contentHash: null,
      }],
    },
    planPayload: {
      compatibilityGroups: [{ groupKey: 'group-1', identitySignature: '{}', skuKeys: ['sku-1'] }],
      verifiedFacts: [],
      slots: [{
        slotKey: 'sku:sku-1:hero', goal: 'sku_hero', status: 'READY', aspectRatio: '3:4',
        ownership: { level: 'sku', key: 'sku-1' },
        references: [{
          candidateId: 'media-1',
          evidenceIds: [candidateEvidenceId('snapshot-1', 'media-1')],
        }],
        factEvidenceIds: [],
        safetyConstraints: ['preserve_product_identity'],
        acceptanceChecks: ['product_matches_references'],
      }],
    },
  };
}

function planRow() {
  const authority = planAuthority();
  const version = {
    id: authority.planVersionId,
    planId: authority.planId,
    ownerUserId: 'owner-1',
    version: 1,
    sourceCaptureSnapshotId: authority.sourceCaptureSnapshotId,
    sourceCaptureHash: authority.sourceCaptureHash,
    sourceProfileHash: authority.sourceProfileHash,
    sourceSchemaVersion: authority.sourceSchemaVersion,
    inputFingerprint: 'c'.repeat(64),
    planSchemaVersion: 'ai-image-prompt-plan/2.0',
    plannerVersion: 'ai-media-rule-planner/v1',
    mode: 'RULE_BASED',
    fallbackReason: null,
    inputSnapshot: authority.inputSnapshot,
    curation: {
      selectedCandidateIds: ['media-1'],
      selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 1, selectedCount: 1, met: true },
    },
    curationHash: 'd'.repeat(64),
    visionEvidence: { images: [{ candidateId: 'media-1' }] },
    visionEvidenceHash: 'e'.repeat(64),
    planHash: authority.planHash,
    planPayload: authority.planPayload,
    provenance: {},
    provenanceHash: '1'.repeat(64),
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
  };
  return {
    id: authority.planId,
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    sourceSubjectId: authority.sourceSubjectId,
    contextType: authority.contextType,
    contextId: authority.contextId,
    revision: authority.planRevision,
    reviewStatus: 'APPROVED',
    currentVersionId: version.id,
    approvedVersionId: version.id,
    staleAt: null,
    reviewedByUserId: 'owner-1',
    reviewedAt: new Date('2026-07-19T01:00:00.000Z'),
    currentVersion: version,
    approvedVersion: version,
  };
}

function providerConfig(overrides: Record<string, unknown> = {}) {
  return {
    provider: AI_IMAGE_SUITE_PROVIDER,
    model: AI_IMAGE_SUITE_MODEL,
    providerConfigHash: '9'.repeat(64),
    pricingVersion: 'fake-pricing/v1',
    estimatedCostPerImageCents: 0,
    maximumCostPerImageCents: 0,
    concurrencyLimit: 2,
    ...overrides,
  };
}

function claimInput(overrides: Partial<ClaimAiImageSuiteInput> = {}): ClaimAiImageSuiteInput {
  const authority = planAuthority();
  const config = providerConfig();
  const preview = createAiImageSuitePreview(authority, config);
  return {
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    planId: authority.planId,
    expectedPlanRevision: authority.planRevision,
    idempotencyKey: 'suite-claim-1',
    expectedPreviewHash: preview.previewHash,
    providerConfig: config,
    ...overrides,
  };
}

function clientFixture(options: { latestId?: string } = {}) {
  const plan = planRow() as any;
  let suite: any = null;
  let slots: any[] = [];
  const latestId = options.latestId || 'snapshot-1';
  const latest = {
    id: latestId,
    captureHash: latestId === 'snapshot-1' ? 'a'.repeat(64) : '7'.repeat(64),
    profileHash: latestId === 'snapshot-1' ? 'b'.repeat(64) : '8'.repeat(64),
    schemaVersion: 'source-product-capture-v2',
    payload: {
      captureVersion: 'source-product-capture-v2',
      media: [{
        key: 'media-1', kind: 'image', disposition: 'accepted',
        url: 'https://source.example/media-1.png', skuKeys: ['sku-1'],
      }],
    },
  };
  const tx: any = {
    aiMediaPlan: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === plan.id && where.ownerUserId === plan.ownerUserId ? plan : null
      )),
      updateMany: vi.fn(async () => {
        plan.staleAt = new Date('2026-07-19T02:00:00.000Z');
        plan.revision += 1;
        return { count: 1 };
      }),
    },
    aiMediaPlanEvent: { create: vi.fn(async () => ({})) },
    supplyGoods: { findFirst: vi.fn(async () => ({ id: 'goods-1' })) },
    sourceCaptureSubject: { findFirst: vi.fn(async () => ({ snapshots: [latest] })) },
    aiMediaSuite: {
      findFirst: vi.fn(async ({ where }: any) => (
        suite
        && suite.ownerUserId === where.ownerUserId
        && suite.idempotencyKey === where.idempotencyKey
          ? { ...suite, slots }
          : null
      )),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.planVersionId) return suite?.planVersionId === where.planVersionId ? { ...suite, slots } : null;
        if (where.id) return suite?.id === where.id ? { ...suite, slots } : null;
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        suite = {
          id: 'suite-1', revision: 1, createdAt: new Date(), updatedAt: new Date(), ...data,
        };
        return suite;
      }),
    },
    aiMediaSuiteSlot: {
      createMany: vi.fn(async ({ data }: any) => {
        slots = data.map((row: any, index: number) => ({ id: `slot-${index + 1}`, ...row }));
        return { count: slots.length };
      }),
    },
    aiMediaSuiteEvent: { create: vi.fn(async () => ({})) },
    aiImageJob: { create: vi.fn() },
    aiCostReservation: { create: vi.fn() },
  };
  return {
    plan,
    latest,
    tx,
    client: {
      ...tx,
      $transaction: vi.fn(async (action: (transaction: any) => Promise<unknown>, settings: unknown) => {
        expect(settings).toEqual({ isolationLevel: 'Serializable' });
        return action(tx);
      }),
    } as any,
  };
}

describe('Prisma AI image suite repository', () => {
  it('atomically claims the approved version and freezes every slot without creating jobs or costs', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteRepository(fixture.client);

    const result = await repository.claimApproved(claimInput());

    expect(result).toMatchObject({ kind: 'created', suite: { id: 'suite-1', itemCount: 1 } });
    expect(fixture.tx.aiMediaSuite.create).toHaveBeenCalledOnce();
    expect(fixture.tx.aiMediaSuiteSlot.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        slotKey: 'sku:sku-1:hero', ownerUserId: 'owner-1', status: 'PLANNED',
        referencesHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      })],
    });
    expect(fixture.tx.aiImageJob.create).not.toHaveBeenCalled();
    expect(fixture.tx.aiCostReservation.create).not.toHaveBeenCalled();
    expect(fixture.tx.aiMediaSuiteEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        suiteId: 'suite-1', eventType: 'CLAIMED', revision: 1,
        payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    });
  });

  it('replays the exact idempotency claim and rejects changed input or a second plan claim', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteRepository(fixture.client);
    const input = claimInput();

    expect((await repository.claimApproved(input)).kind).toBe('created');
    expect((await repository.claimApproved(input)).kind).toBe('existing');

    const changedConfig = providerConfig({ pricingVersion: 'fake-pricing/v2' });
    const changedPreview = createAiImageSuitePreview(planAuthority(), changedConfig);
    expect((await repository.claimApproved({
      ...input,
      providerConfig: changedConfig,
      expectedPreviewHash: changedPreview.previewHash,
    })).kind).toBe('conflict');

    expect((await repository.claimApproved({
      ...input,
      idempotencyKey: 'suite-claim-2',
    })).kind).toBe('claimed');
    expect(fixture.tx.aiMediaSuite.create).toHaveBeenCalledOnce();
  });

  it('recovers an exact committed claim even after the mutable source authority becomes stale', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteRepository(fixture.client);
    const input = claimInput();

    expect((await repository.claimApproved(input)).kind).toBe('created');
    fixture.latest.id = 'snapshot-2';
    fixture.latest.captureHash = '7'.repeat(64);
    fixture.latest.profileHash = '8'.repeat(64);

    const replay = await repository.claimApproved(input);
    expect(replay).toMatchObject({ kind: 'existing', suite: { id: 'suite-1' } });
    expect(fixture.tx.aiMediaPlan.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.aiMediaSuite.create).toHaveBeenCalledOnce();
  });

  it('marks a changed source snapshot stale in the same transaction before any suite write', async () => {
    const fixture = clientFixture({ latestId: 'snapshot-2' });
    const repository = new PrismaAiImageSuiteRepository(fixture.client);

    const result = await repository.claimApproved(claimInput());

    expect(result.kind).toBe('stale');
    expect(fixture.tx.aiMediaPlan.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.aiMediaPlanEvent.create).toHaveBeenCalledOnce();
    expect(fixture.tx.aiMediaSuite.create).not.toHaveBeenCalled();
  });

  it('keeps owner lookup opaque and rejects a changed expected revision before writes', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteRepository(fixture.client);

    expect((await repository.claimApproved(claimInput({ ownerUserId: 'owner-2' }))).kind).toBe('not-found');
    expect((await repository.claimApproved(claimInput({ expectedPlanRevision: 1 }))).kind).toBe('not-approved');
    expect(fixture.tx.aiMediaSuite.create).not.toHaveBeenCalled();
  });
});
