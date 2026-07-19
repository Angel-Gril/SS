import { describe, expect, it, vi } from 'vitest';
import {
  AiImageSuiteMaterializationError,
  createAiImageSuiteMaterializationService,
  type AiImageSuiteMaterializationCommitResult,
  type AiImageSuiteMaterializationRepository,
  type AiImageSuiteMaterializationSummary,
  type MaterializeAiImageSuiteInput,
} from '../services/ai-image-suite-materialization.js';

const input: MaterializeAiImageSuiteInput = {
  suiteId: 'suite-1',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedRevision: 3,
  operationKey: 'materialize-operation-1',
};

function summary(overrides: Partial<AiImageSuiteMaterializationSummary> = {}) {
  return {
    suiteId: input.suiteId,
    revision: 4 as const,
    status: 'PLANNED' as const,
    childCount: 2,
    estimatedCostCents: 12,
    maximumCostCents: 20,
    materializationHash: 'a'.repeat(64),
    children: [
      { ordinal: 0, slotKey: 'sku:sku-1:hero', childWorkflowId: 'workflow-1' },
      { ordinal: 1, slotKey: 'group:group-1:gallery:1', childWorkflowId: 'workflow-2' },
    ],
    ...overrides,
  } satisfies AiImageSuiteMaterializationSummary;
}

function repository(
  overrides: Partial<AiImageSuiteMaterializationRepository> = {},
): AiImageSuiteMaterializationRepository {
  return {
    findReplay: vi.fn(async () => null),
    materialize: vi.fn(async () => ({ kind: 'committed' as const, ...summary() })),
    ...overrides,
  };
}

describe('AI image suite child materialization service', () => {
  it.each([
    ['suiteId', { suiteId: '' }],
    ['ownerUserId', { ownerUserId: ' owner-1' }],
    ['actorUserId', { actorUserId: 'actor-1 ' }],
    ['operationKey', { operationKey: 'short' }],
    ['expectedRevision', { expectedRevision: 2 }],
    ['operationKey length', { operationKey: 'x'.repeat(129) }],
  ] as const)('rejects invalid %s before consulting the repository', async (_label, overrides) => {
    const repo = repository();
    const service = createAiImageSuiteMaterializationService(repo);

    await expect(service.materialize({ ...input, ...overrides })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_MATERIALIZATION_INVALID_INPUT',
      statusCode: 400,
    });
    expect(repo.findReplay).not.toHaveBeenCalled();
    expect(repo.materialize).not.toHaveBeenCalled();
  });

  it('returns an exact replay before attempting mutable materialization', async () => {
    const replay = summary({ materializationHash: 'b'.repeat(64) });
    const repo = repository({
      findReplay: vi.fn(async () => ({ kind: 'existing' as const, ...replay })),
      materialize: vi.fn(async () => {
        throw new Error('materialize must not run for an exact replay');
      }),
    });
    const service = createAiImageSuiteMaterializationService(repo);

    await expect(service.materialize(input)).resolves.toEqual({ ...replay, replayed: true });
    expect(repo.findReplay).toHaveBeenCalledWith(input);
    expect(repo.materialize).not.toHaveBeenCalled();
  });

  it.each([
    ['already-materialized', 'AI_MEDIA_SUITE_CHILDREN_ALREADY_MATERIALIZED'],
    ['conflict', 'AI_MEDIA_SUITE_MATERIALIZATION_CONFLICT'],
  ] as const)('maps an immutable replay %s without committing', async (kind, code) => {
    const repo = repository({
      findReplay: vi.fn(async () => ({ kind })),
    });
    const service = createAiImageSuiteMaterializationService(repo);

    await expect(service.materialize(input)).rejects.toMatchObject({ code, statusCode: 409 });
    expect(repo.materialize).not.toHaveBeenCalled();
  });

  it('commits children and marks a first materialization as non-replayed', async () => {
    const committed = summary();
    const repo = repository({
      materialize: vi.fn(async (request) => {
        expect(request).toEqual(input);
        return { kind: 'committed' as const, ...committed };
      }),
    });
    const service = createAiImageSuiteMaterializationService(repo);

    await expect(service.materialize(input)).resolves.toEqual({ ...committed, replayed: false });
    expect(repo.findReplay).toHaveBeenCalledWith(input);
    expect(repo.materialize).toHaveBeenCalledWith(input);
  });

  it('returns an existing commit as a replay when the race is won by another request', async () => {
    const existing = summary({ materializationHash: 'c'.repeat(64) });
    const repo = repository({
      materialize: vi.fn(async () => ({ kind: 'existing' as const, ...existing })),
    });
    const service = createAiImageSuiteMaterializationService(repo);

    await expect(service.materialize(input)).resolves.toEqual({ ...existing, replayed: true });
  });

  it.each([
    ['not-found', 'AI_MEDIA_SUITE_MATERIALIZATION_NOT_FOUND', 404],
    ['stale', 'AI_MEDIA_SUITE_MATERIALIZATION_STALE', 409],
    ['prompts-not-ready', 'AI_MEDIA_SUITE_PROMPTS_NOT_READY', 409],
    ['already-materialized', 'AI_MEDIA_SUITE_CHILDREN_ALREADY_MATERIALIZED', 409],
    ['conflict', 'AI_MEDIA_SUITE_MATERIALIZATION_CONFLICT', 409],
    ['revision-conflict', 'AI_MEDIA_SUITE_MATERIALIZATION_CONFLICT', 409],
  ] as const)('maps commit result %s to a typed service error', async (kind, code, statusCode) => {
    const commitResult = { kind } as AiImageSuiteMaterializationCommitResult;
    const repo = repository({
      materialize: vi.fn(async () => commitResult),
    });
    const service = createAiImageSuiteMaterializationService(repo);

    const failure = await service.materialize(input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiImageSuiteMaterializationError);
    expect(failure).toMatchObject({ code, statusCode });
    expect((failure as AiImageSuiteMaterializationError).message).toBeTruthy();
  });
});
