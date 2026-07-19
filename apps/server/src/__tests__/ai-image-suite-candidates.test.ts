import { describe, expect, it, vi } from 'vitest';
import {
  AiImageSuiteCandidateError,
  createAiImageSuiteCandidateService,
  type AiImageSuiteCandidateRepository,
} from '../services/ai-image-suite-candidates.js';

function reviewInput(overrides: Record<string, unknown> = {}) {
  return {
    suiteId: 'suite-1',
    slotId: 'slot-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    expectedWorkflowRevision: 3,
    operationKey: 'review-operation-1',
    outputAssetId: 'output-1',
    decision: 'APPROVE' as const,
    note: null,
    production: false,
    ...overrides,
  };
}

function applyInput(overrides: Record<string, unknown> = {}) {
  return {
    suiteId: 'suite-1',
    slotId: 'slot-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    expectedWorkflowRevision: 4,
    operationKey: 'apply-operation-1',
    expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
    production: false,
    ...overrides,
  };
}

function repository(): AiImageSuiteCandidateRepository {
  return {
    review: vi.fn(async () => ({
      kind: 'updated' as const,
      value: {
        suiteId: 'suite-1', slotId: 'slot-1', workflowId: 'workflow-1',
        outputAssetId: 'output-1', reviewStatus: 'APPROVED' as const,
        workflowRevision: 4, reviewedAt: new Date('2026-07-20T01:00:00.000Z'),
      },
    })),
    apply: vi.fn(async () => ({
      kind: 'updated' as const,
      value: {
        suiteId: 'suite-1', slotId: 'slot-1', workflowId: 'workflow-1',
        jobId: 'job-1', outputAssetId: 'output-1', mode: 'append' as const,
        targetType: 'collect' as const, targetId: 'goods-1',
        images: ['/original.png', '/generated.png'], mainImage: '/original.png',
        editedImages: ['/generated.png'],
        targetUpdatedAt: new Date('2026-07-20T01:01:00.000Z'),
        appliedAt: new Date('2026-07-20T01:01:00.000Z'),
      },
    })),
  };
}

describe('AI image suite candidate service', () => {
  it('validates review authority before repository dispatch', async () => {
    const store = repository();
    const service = createAiImageSuiteCandidateService(store);

    await expect(service.review(reviewInput({ operationKey: 'short' })))
      .rejects.toMatchObject({ code: 'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT', statusCode: 400 });
    await expect(service.review(reviewInput({ note: ' padded ' })))
      .rejects.toBeInstanceOf(AiImageSuiteCandidateError);
    expect(store.review).not.toHaveBeenCalled();
  });

  it('preserves exact replay state from the repository', async () => {
    const store = repository();
    vi.mocked(store.review).mockResolvedValueOnce({
      kind: 'replayed',
      value: {
        suiteId: 'suite-1', slotId: 'slot-1', workflowId: 'workflow-1',
        outputAssetId: 'output-1', reviewStatus: 'APPROVED', workflowRevision: 4,
        reviewedAt: new Date('2026-07-20T01:00:00.000Z'),
      },
    });
    const service = createAiImageSuiteCandidateService(store);

    await expect(service.review(reviewInput())).resolves.toMatchObject({
      replayed: true,
      review: { outputAssetId: 'output-1', reviewStatus: 'APPROVED' },
    });
  });

  it.each([
    ['not-found', 'AI_MEDIA_SUITE_CANDIDATE_NOT_FOUND', 404],
    ['provider-not-ready', 'AI_MEDIA_SUITE_CANDIDATE_PROVIDER_NOT_READY', 503],
    ['stale', 'AI_MEDIA_SUITE_CANDIDATE_STALE', 409],
    ['revision-conflict', 'AI_MEDIA_SUITE_CANDIDATE_REVISION_CONFLICT', 409],
    ['state-conflict', 'AI_MEDIA_SUITE_CANDIDATE_STATE_CONFLICT', 409],
    ['output-conflict', 'AI_MEDIA_SUITE_CANDIDATE_OUTPUT_CONFLICT', 409],
    ['operation-conflict', 'AI_MEDIA_SUITE_CANDIDATE_OPERATION_CONFLICT', 409],
    ['target-conflict', 'AI_MEDIA_SUITE_CANDIDATE_TARGET_CONFLICT', 409],
  ] as const)('maps repository %s to %s', async (kind, code, statusCode) => {
    const store = repository();
    vi.mocked(store.apply).mockResolvedValueOnce({ kind } as never);
    const service = createAiImageSuiteCandidateService(store);

    await expect(service.apply(applyInput())).rejects.toMatchObject({ code, statusCode });
  });

  it('requires an exact target timestamp before application dispatch', async () => {
    const store = repository();
    const service = createAiImageSuiteCandidateService(store);

    await expect(service.apply(applyInput({ expectedTargetUpdatedAt: 'not-a-date' })))
      .rejects.toMatchObject({ code: 'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT' });
    expect(store.apply).not.toHaveBeenCalled();
  });
});
