import { describe, expect, it, vi } from 'vitest';
import {
  AiMediaWorkflowError,
  createAiMediaWorkflowService,
  createAiMediaWorkflowFingerprint,
  createAiImageTranslationWorkflowFingerprint,
  type AiMediaWorkflowRecord,
  type AiMediaWorkflowRepository,
  type CreateAiMediaWorkflowInput,
  type CreateAiImageTranslationWorkflowInput,
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
    createImageTranslation: vi.fn(async () => ({
      kind: 'created' as const,
      workflow: { ...workflow, operation: 'IMAGE_TRANSLATE' as const },
      jobId: 'translation-job-1',
    })),
    listOwned: vi.fn(async () => ({ items: [workflow], nextCursor: null })),
    listPriorityOwned: vi.fn(async () => ({ items: [workflow], nextCursor: null })),
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
  it('paginates history with a cursor bound to the owner and context', async () => {
    const createdAt = new Date('2026-07-16T00:00:00.000Z');
    const listOwned = vi.fn()
      .mockResolvedValueOnce({
        items: [workflow],
        priorityItems: [{ ...workflow, id: 'workflow-active-old' }],
        nextCursor: { createdAt, id: 'workflow-1' },
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const service = createAiMediaWorkflowService(repository({ listOwned }));

    const first = await service.list({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 1,
      includePriority: true,
    });
    expect(first).toMatchObject({ items: [{ id: 'workflow-1' }] });
    expect(first.priorityItems).toEqual([expect.objectContaining({ id: 'workflow-active-old' })]);
    expect(first.nextCursor).toEqual(expect.any(String));

    await expect(service.list({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
      limit: 1, cursor: first.nextCursor!,
    })).resolves.toEqual({
      items: [], priorityItems: [], priorityItemsTruncated: false,
      priorityNextCursor: null, nextCursor: null,
    });
    expect(listOwned).toHaveBeenLastCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 1,
      cursor: { createdAt, id: 'workflow-1' }, includePriority: false,
    }));
    expect(listOwned).toHaveBeenNthCalledWith(1, expect.objectContaining({ includePriority: true }));

    await expect(service.list({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-2',
      limit: 1, cursor: first.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(listOwned).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed and non-canonical history cursors before persistence', async () => {
    const listOwned = vi.fn(async () => ({ items: [], nextCursor: null }));
    const service = createAiMediaWorkflowService(repository({ listOwned }));
    await expect(service.list({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', cursor: 'not+base64',
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(listOwned).not.toHaveBeenCalled();
  });

  it('paginates the priority lane with a canonical cursor bound to owner and context', async () => {
    const updatedAt = new Date('2026-07-20T08:00:00.000Z');
    const recentCutoff = new Date('2026-07-19T09:00:00.000Z');
    const listPriorityOwned = vi.fn()
      .mockResolvedValueOnce({
        items: [workflow],
        nextCursor: { updatedAt, id: workflow.id, recentCutoff },
      })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const service = createAiMediaWorkflowService(repository({ listPriorityOwned }));

    const first = await service.listPriority({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 1,
    });
    expect(first).toMatchObject({ items: [{ id: workflow.id }], nextCursor: expect.any(String) });

    await expect(service.listPriority({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
      limit: 1, cursor: first.nextCursor!,
    })).resolves.toEqual({ items: [], nextCursor: null });
    expect(listPriorityOwned).toHaveBeenLastCalledWith({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 1,
      cursor: { updatedAt, id: workflow.id, recentCutoff },
    });

    await expect(service.listPriority({
      ownerUserId: 'owner-2', contextType: 'collect', contextId: 'goods-1',
      cursor: first.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(service.listPriority({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-2',
      cursor: first.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(service.list({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
      cursor: first.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(listPriorityOwned).toHaveBeenCalledTimes(2);
  });

  it('rejects a history cursor in the priority lane before persistence', async () => {
    const listOwned = vi.fn(async () => ({
      items: [workflow],
      nextCursor: { createdAt: workflow.createdAt, id: workflow.id },
    }));
    const listPriorityOwned = vi.fn(async () => ({ items: [], nextCursor: null }));
    const service = createAiMediaWorkflowService(repository({ listOwned, listPriorityOwned }));
    const history = await service.list({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 1,
    });

    await expect(service.listPriority({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
      cursor: history.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(listPriorityOwned).not.toHaveBeenCalled();
  });

  it('does not query priority history unless the caller requests the paginated contract', async () => {
    const listOwned = vi.fn(async () => ({ items: [workflow], nextCursor: null }));
    const service = createAiMediaWorkflowService(repository({ listOwned }));

    await service.list({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 20,
    });

    expect(listOwned).toHaveBeenCalledWith(expect.objectContaining({ includePriority: false }));
  });

  it('creates a single-source IMAGE_TO_IMAGE workflow and returns the child job identity', async () => {
    const repo = repository();
    const result = await createAiMediaWorkflowService(repo).createImageToImage(createInput);
    expect(result).toMatchObject({ workflow: { id: 'workflow-1' }, jobId: 'job-1', replayed: false });
    expect(repo.createImageToImage).toHaveBeenCalledWith(createInput);
  });

  it('normalizes and freezes IMAGE_TRANSLATE policy/options before persistence', async () => {
    const repo = repository();
    const input: CreateAiImageTranslationWorkflowInput = {
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      sourceLanguage: 'ZH', targetLanguage: 'RU', domainHint: 'Keep model codes',
      terminologies: [{ src: 'piano black', tgt: 'glossy black' }],
      provider: 'fake', model: 'fake-image-translation-v1', dailyLimit: 20,
      estimatedCostCents: 0, idempotencyKey: 'translation-idem-1',
      context: { type: 'collect', id: 'goods-1' },
    };
    const result = await createAiMediaWorkflowService(repo).createImageTranslation(input);
    expect(result).toMatchObject({ jobId: 'translation-job-1', workflow: { operation: 'IMAGE_TRANSLATE' } });
    expect(repo.createImageTranslation).toHaveBeenCalledWith(expect.objectContaining({
      sourceLanguage: 'ZH', targetLanguage: 'RU',
      options: expect.objectContaining({
        sourceLanguage: 'zh', targetLanguage: 'ru', imageSegment: false,
        policyVersion: expect.any(String),
        domainHint: expect.stringContaining('Translate only visible product marketing copy.'),
      }),
    }));
  });

  it('rejects image translation before persistence for invalid language or terminology input', async () => {
    const repo = repository();
    const service = createAiMediaWorkflowService(repo);
    await expect(service.createImageTranslation({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
      sourceLanguage: 'zh', targetLanguage: 'zh', domainHint: 'safe', terminologies: [],
      provider: 'fake', model: 'fake-image-translation-v1', dailyLimit: 20,
      estimatedCostCents: 0, idempotencyKey: 'translation-invalid-1',
      context: { type: 'collect', id: 'goods-1' },
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(repo.createImageTranslation).not.toHaveBeenCalled();
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

  it('maps translation retry quota exhaustion to a stable workflow error', async () => {
    const service = createAiMediaWorkflowService(repository({
      retryOwned: vi.fn(async () => {
        throw Object.assign(new Error('Image translation daily quota exceeded (20/20)'), {
          code: 'IMAGE_TRANSLATION_QUOTA_EXCEEDED',
        });
      }),
    }));
    await expect(service.retry({
      id: workflow.id, ownerUserId: workflow.ownerUserId, actorUserId: 'actor-1',
      expectedRevision: 1, idempotencyKey: 'translation-retry-quota', dailyLimit: 20,
    })).rejects.toMatchObject({ code: 'IMAGE_TRANSLATION_QUOTA_EXCEEDED' });
  });

  it('maps a stale retry source snapshot to a stable workflow error', async () => {
    const service = createAiMediaWorkflowService(repository({
      retryOwned: vi.fn(async () => {
        throw Object.assign(new Error('The workflow source snapshot changed'), {
          code: 'STALE_MEDIA_WORKFLOW',
        });
      }),
    }));

    await expect(service.retry({
      id: workflow.id, ownerUserId: workflow.ownerUserId, actorUserId: 'actor-1',
      expectedRevision: 1, idempotencyKey: 'retry-stale-snapshot',
    })).rejects.toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
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

  it('binds translation idempotency to the complete prompt snapshot', () => {
    const base: any = {
      ownerUserId: 'owner-1', sourceAssetId: 'asset-1', sourceLanguage: 'zh', targetLanguage: 'ru',
      domainHint: 'policy', terminologies: [], imageSegment: false, provider: 'fake',
      model: 'fake-image-translation-v1', prompt: 'translate', resolvedPrompt: 'policy',
      resolvedNegativePrompt: 'constraints', templateKey: 'image-translation.base',
      templateReleaseId: 'release-1', templateChecksum: 'a'.repeat(64),
      templateSnapshot: { sequence: 1 }, context: { type: 'collect', id: 'goods-1' },
      options: { sourceLanguage: 'zh', targetLanguage: 'ru', domainHint: 'policy', terminologies: [], imageSegment: false, policyVersion: 'ai-image-translation-policy/1.0' },
    };
    expect(createAiImageTranslationWorkflowFingerprint(base)).not.toBe(
      createAiImageTranslationWorkflowFingerprint({ ...base, templateSnapshot: { sequence: 2 } }),
    );
  });

  it('returns NOT_FOUND instead of exposing another owner workflow', async () => {
    const service = createAiMediaWorkflowService(repository());
    await expect(service.get('workflow-1', 'owner-2')).rejects.toEqual(
      expect.objectContaining<Partial<AiMediaWorkflowError>>({ code: 'NOT_FOUND' }),
    );
  });
});
