import { describe, expect, it, vi } from 'vitest';
import {
  AiMediaWorkflowError,
  createAiMediaWorkflowService,
  createAiMediaWorkflowFingerprint,
  type AiMediaWorkflowRecord,
  type AiMediaWorkflowRepository,
  type CreateAiMediaWorkflowInput,
} from '../services/ai-media-workflows.js';

const workflow: AiMediaWorkflowRecord = {
  id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
  operation: 'IMAGE_TO_IMAGE', status: 'QUEUED', reviewStatus: 'NOT_READY',
  revision: 1, currentAttempt: 1, contextType: 'collect', contextId: 'goods-1',
  contextSkuKey: null, contextSlotKey: null, idempotencyKey: 'workflow-idem-1',
  requestFingerprint: 'a'.repeat(64), selectedOutputAssetId: null,
  createdAt: new Date('2026-07-16T00:00:00Z'), updatedAt: new Date('2026-07-16T00:00:00Z'),
  completedAt: null,
};

function repository(overrides: Partial<AiMediaWorkflowRepository> = {}): AiMediaWorkflowRepository {
  return {
    createImageToImage: vi.fn(async () => ({ kind: 'created' as const, workflow, jobId: 'job-1' })),
    listOwned: vi.fn(async () => [workflow]),
    getOwned: vi.fn(async (id, owner) => id === workflow.id && owner === workflow.ownerUserId ? workflow : null),
    cancelOwned: vi.fn(async () => workflow),
    retryOwned: vi.fn(async () => ({ workflow, jobId: 'job-2', replayed: false })),
    reviewOwned: vi.fn(async () => ({ ...workflow, status: 'SUCCEEDED' as const, reviewStatus: 'APPROVED' as const })),
    ...overrides,
  };
}

const createInput: CreateAiMediaWorkflowInput = {
  ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
  prompt: 'Keep the product unchanged', negativePrompt: null, count: 1,
  width: 1024, height: 1024, idempotencyKey: 'workflow-idem-1',
  context: { type: 'collect', id: 'goods-1' },
};

describe('AI media workflow service', () => {
  it('creates a single-source IMAGE_TO_IMAGE workflow and returns the child job identity', async () => {
    const repo = repository();
    const result = await createAiMediaWorkflowService(repo).createImageToImage(createInput);
    expect(result).toMatchObject({ workflow: { id: 'workflow-1' }, jobId: 'job-1', replayed: false });
    expect(repo.createImageToImage).toHaveBeenCalledWith(createInput);
  });

  it('accepts ordered multi-reference inputs within the provider capability', async () => {
    const repo = repository();
    const input: CreateAiMediaWorkflowInput = {
      ...createInput,
      sourceAssetId: undefined,
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
    };
    await expect(createAiMediaWorkflowService(repo).createImageToImage(input)).resolves.toMatchObject({
      jobId: 'job-1',
    });
    expect(repo.createImageToImage).toHaveBeenCalledWith(input);
  });

  it('rejects duplicate or over-capability reference sets before persistence', async () => {
    const repo = repository();
    await expect(createAiMediaWorkflowService(repo).createImageToImage({
      ...createInput,
      sourceAssetId: undefined,
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-1' }],
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(createAiMediaWorkflowService(repo).createImageToImage({
      ...createInput,
      sourceAssetId: undefined,
      references: Array.from({ length: 5 }, (_, index) => ({ assetId: `asset-${index + 1}` })),
    })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    expect(repo.createImageToImage).not.toHaveBeenCalled();
  });

  it('rejects more than one output in the first lifecycle slice', async () => {
    await expect(createAiMediaWorkflowService(repository()).createImageToImage({
      ...createInput, count: 2,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('turns a changed idempotency replay into a conflict', async () => {
    const service = createAiMediaWorkflowService(repository({
      createImageToImage: vi.fn(async () => ({ kind: 'conflict' as const, workflow, jobId: 'job-1' })),
    }));
    await expect(service.createImageToImage(createInput)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });

  it('fails closed when retry cannot prove the provider request was never accepted', async () => {
    const service = createAiMediaWorkflowService(repository({ retryOwned: vi.fn(async () => null) }));
    await expect(service.retry({
      id: workflow.id, ownerUserId: workflow.ownerUserId, actorUserId: 'actor-1',
      expectedRevision: 1, idempotencyKey: 'retry-idem-1',
    })).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  });

  it('uses a stable request fingerprint and includes authoritative context', () => {
    expect(createAiMediaWorkflowFingerprint(createInput)).toBe(createAiMediaWorkflowFingerprint(createInput));
    expect(createAiMediaWorkflowFingerprint(createInput)).not.toBe(createAiMediaWorkflowFingerprint({
      ...createInput, context: { type: 'collect', id: 'goods-2' },
    }));
    const multi = {
      ...createInput,
      sourceAssetId: undefined,
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
    };
    expect(createAiMediaWorkflowFingerprint(multi)).not.toBe(createAiMediaWorkflowFingerprint({
      ...multi,
      references: [...multi.references].reverse(),
    }));
  });

  it('returns NOT_FOUND instead of exposing another owner workflow', async () => {
    const service = createAiMediaWorkflowService(repository());
    await expect(service.get('workflow-1', 'owner-2')).rejects.toEqual(
      expect.objectContaining<Partial<AiMediaWorkflowError>>({ code: 'NOT_FOUND' }),
    );
  });
});
