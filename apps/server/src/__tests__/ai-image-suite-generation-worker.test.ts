import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_IMAGE_SUITE_GENERATION_QUEUE_JOB_OPTIONS,
  AiImageSuiteGenerationWorkerError,
  aiImageSuiteGenerationQueueJobId,
  aiImageSuiteGenerationRecoveryJobId,
  enqueueAiImageSuiteGenerationJob,
  enqueueAiImageSuiteGenerationRecoveryJob,
  enqueueRecoverableAiImageSuiteGenerationJobs,
  processAiImageSuiteGenerationQueueJob,
  type AiImageSuiteGenerationCoordinator,
  type AiImageSuiteGenerationQueuePayload,
} from '../workers/ai-image-suite-generation.js';

const payload = (overrides: Partial<AiImageSuiteGenerationQueuePayload> = {}): AiImageSuiteGenerationQueuePayload => ({
  suiteId: 'suite-1',
  slotId: 'slot-1',
  workflowId: 'workflow-1',
  jobId: 'job-1',
  attempt: 1,
  ...overrides,
});

function coordinator(
  overrides: Partial<AiImageSuiteGenerationCoordinator> = {},
): AiImageSuiteGenerationCoordinator {
  return {
    revalidateAndClaim: vi.fn(async () => ({
      kind: 'ready' as const,
      provider: 'fake',
      providerFacing: true,
      executionToken: 'execution-token-1',
    })),
    execute: vi.fn(async () => ({ kind: 'completed' as const, frontier: [] })),
    rejectRuntimeGate: vi.fn(async () => undefined),
    scanRecoverable: vi.fn(async () => ({ items: [], nextCursor: null })),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AI image suite generation queue contract', () => {
  it('uses one deterministic queue id and strips all non-contract fields from queue data', async () => {
    const queue = { add: vi.fn(async () => undefined) };
    const input = { ...payload(), prompt: 'must-not-enter-redis', ownerUserId: 'must-not-enter-redis' };

    await enqueueAiImageSuiteGenerationJob(input, { queue });

    expect(aiImageSuiteGenerationQueueJobId(payload())).toBe(aiImageSuiteGenerationQueueJobId(payload()));
    expect(aiImageSuiteGenerationQueueJobId(payload({ attempt: 2 })))
      .not.toBe(aiImageSuiteGenerationQueueJobId(payload()));
    expect(queue.add).toHaveBeenCalledWith(
      'generate-suite-slot',
      payload(),
      {
        ...AI_IMAGE_SUITE_GENERATION_QUEUE_JOB_OPTIONS,
        jobId: aiImageSuiteGenerationQueueJobId(payload()),
      },
    );
  });

  it('uses a new deterministic recovery id after each recovery bucket', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const queue = { add: vi.fn(async () => undefined) };

    await enqueueAiImageSuiteGenerationRecoveryJob(payload(), { queue });
    vi.setSystemTime(new Date('2026-07-20T00:00:30.000Z'));
    await enqueueAiImageSuiteGenerationRecoveryJob(payload(), { queue });

    const firstBucket = Math.floor(Date.parse('2026-07-20T00:00:00.000Z') / 30_000);
    const secondBucket = firstBucket + 1;
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      'generate-suite-slot',
      payload(),
      {
        ...AI_IMAGE_SUITE_GENERATION_QUEUE_JOB_OPTIONS,
        jobId: aiImageSuiteGenerationRecoveryJobId(payload(), firstBucket),
      },
    );
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      'generate-suite-slot',
      payload(),
      {
        ...AI_IMAGE_SUITE_GENERATION_QUEUE_JOB_OPTIONS,
        jobId: aiImageSuiteGenerationRecoveryJobId(payload(), secondBucket),
      },
    );
    expect(aiImageSuiteGenerationRecoveryJobId(payload(), firstBucket))
      .not.toBe(aiImageSuiteGenerationRecoveryJobId(payload(), secondBucket));
  });

  it('leases by suite, revalidates the full frozen identity, executes the fenced claim, and enqueues only returned frontier', async () => {
    const calls: string[] = [];
    const next = payload({ slotId: 'slot-2', workflowId: 'workflow-2', jobId: 'job-2' });
    const dependency = coordinator({
      revalidateAndClaim: vi.fn(async (value) => {
        calls.push(`revalidate:${value.slotId}`);
        return {
          kind: 'ready' as const,
          provider: 'fake',
          providerFacing: true,
          executionToken: 'claim-1',
        };
      }),
      execute: vi.fn(async (value, claim) => {
        calls.push(`execute:${value.slotId}:${claim.executionToken}`);
        return { kind: 'completed' as const, frontier: [next] };
      }),
    });
    const acquireLease = vi.fn(async (suiteId: string, token: string) => {
      calls.push(`acquire:${suiteId}:${token}`);
      return true;
    });
    const releaseLease = vi.fn(async (suiteId: string, token: string) => {
      calls.push(`release:${suiteId}:${token}`);
    });
    const enqueue = vi.fn(async (value: AiImageSuiteGenerationQueuePayload) => {
      calls.push(`enqueue:${value.slotId}`);
    });

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease,
      releaseLease,
      enqueue,
      createLeaseToken: () => 'lease-1',
      nodeEnv: 'test',
    })).resolves.toBe('completed');

    expect(dependency.revalidateAndClaim).toHaveBeenCalledWith(payload());
    expect(dependency.execute).toHaveBeenCalledWith(payload(), {
      kind: 'ready', provider: 'fake', providerFacing: true, executionToken: 'claim-1',
    });
    expect(enqueue).toHaveBeenCalledWith(next);
    expect(calls).toEqual([
      'acquire:suite-1:lease-1',
      'revalidate:slot-1',
      'release:suite-1:lease-1',
      'execute:slot-1:claim-1',
      'enqueue:slot-2',
    ]);
  });

  it('does not inspect or execute work when another worker owns the suite lease', async () => {
    const dependency = coordinator();
    const releaseLease = vi.fn(async () => undefined);

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => false),
      releaseLease,
      nodeEnv: 'test',
    })).rejects.toMatchObject({ code: 'AI_MEDIA_SUITE_GENERATION_LEASE_BUSY' });

    expect(dependency.revalidateAndClaim).not.toHaveBeenCalled();
    expect(dependency.execute).not.toHaveBeenCalled();
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('releases the suite lease when coordinator execution fails', async () => {
    const dependency = coordinator({
      execute: vi.fn(async () => { throw new Error('execution failed'); }),
    });
    const releaseLease = vi.fn(async () => undefined);

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease,
      createLeaseToken: () => 'lease-1',
      nodeEnv: 'test',
    })).rejects.toThrow('execution failed');

    expect(releaseLease).toHaveBeenCalledWith('suite-1', 'lease-1');
  });

  it('does not discard a fenced database claim when Redis lease release fails', async () => {
    const dependency = coordinator();
    const releaseError = new Error('redis release failed');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => { throw releaseError; }),
      createLeaseToken: () => 'lease-1',
      nodeEnv: 'test',
    })).resolves.toBe('completed');

    expect(dependency.execute).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      '[ai-image-suite] coordination lease release failed:',
      releaseError,
    );
  });

  it.each([
    {
      name: 'returns more than the bounded suite concurrency frontier',
      result: {
        kind: 'completed' as const,
        frontier: Array.from({ length: 17 }, (_, index) => payload({
          slotId: `slot-${index + 2}`,
          workflowId: `workflow-${index + 2}`,
          jobId: `job-${index + 2}`,
        })),
      },
    },
    {
      name: 'returns a cross-suite frontier item',
      result: { kind: 'completed' as const, frontier: [payload({ suiteId: 'suite-2' })] },
    },
  ])('fails closed when the coordinator $name', async ({ result }) => {
    const dependency = coordinator({ execute: vi.fn(async () => result) });
    const enqueue = vi.fn(async (_value: AiImageSuiteGenerationQueuePayload) => undefined);

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
      enqueue,
      nodeEnv: 'test',
    })).rejects.toMatchObject({ code: 'AI_MEDIA_SUITE_GENERATION_INVALID_FRONTIER' });

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('allows the coordinator to fill approved capacity while one slot remains pending', async () => {
    const next = [
      payload({ slotId: 'slot-2', workflowId: 'workflow-2', jobId: 'job-2' }),
      payload({ slotId: 'slot-3', workflowId: 'workflow-3', jobId: 'job-3' }),
    ];
    const dependency = coordinator({
      execute: vi.fn(async () => ({ kind: 'pending' as const, frontier: next })),
    });
    const enqueue = vi.fn(async (_value: AiImageSuiteGenerationQueuePayload) => undefined);

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
      enqueue,
      nodeEnv: 'test',
    })).resolves.toBe('pending');

    expect(enqueue.mock.calls.map(([value]) => value)).toEqual(next);
  });
});

describe('AI image suite generation runtime gate', () => {
  it('rejects fake execution in production before any Provider-facing execution', async () => {
    const dependency = coordinator();

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
      nodeEnv: 'production',
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_FAKE_PROVIDER_PRODUCTION_BLOCKED',
    } satisfies Partial<AiImageSuiteGenerationWorkerError>);

    expect(dependency.rejectRuntimeGate).toHaveBeenCalledWith(
      payload(),
      expect.objectContaining({ provider: 'fake' }),
      expect.objectContaining({ code: 'AI_MEDIA_SUITE_FAKE_PROVIDER_PRODUCTION_BLOCKED' }),
    );
    expect(dependency.execute).not.toHaveBeenCalled();
  });

  it('rejects every paid Provider until sandbox evidence activates a later worker contract', async () => {
    const dependency = coordinator({
      revalidateAndClaim: vi.fn(async () => ({
        kind: 'ready' as const,
        provider: 'dashscope-wanx',
        providerFacing: true,
        executionToken: 'claim-paid',
      })),
    });

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
      nodeEnv: 'development',
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PAID_PROVIDER_NOT_VERIFIED',
    } satisfies Partial<AiImageSuiteGenerationWorkerError>);

    expect(dependency.execute).not.toHaveBeenCalled();
  });

  it('lets cancellation and recovery claims finish without crossing the Provider gate', async () => {
    const dependency = coordinator({
      revalidateAndClaim: vi.fn(async () => ({
        kind: 'ready' as const,
        provider: 'dashscope-wanx',
        providerFacing: false,
        executionToken: 'cancel:claim-paid',
      })),
    });

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
      nodeEnv: 'production',
    })).resolves.toBe('completed');

    expect(dependency.rejectRuntimeGate).not.toHaveBeenCalled();
    expect(dependency.execute).toHaveBeenCalledWith(
      payload(),
      expect.objectContaining({ providerFacing: false }),
    );
  });

  it('treats a dependency-layer stale identity decision as an idempotent no-op', async () => {
    const dependency = coordinator({
      revalidateAndClaim: vi.fn(async () => ({ kind: 'ignored' as const })),
    });

    await expect(processAiImageSuiteGenerationQueueJob(payload(), {
      coordinator: dependency,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
      nodeEnv: 'test',
    })).resolves.toBe('ignored');

    expect(dependency.execute).not.toHaveBeenCalled();
  });
});

describe('AI image suite generation startup recovery', () => {
  it('scans recoverable frontier pages and deterministically re-enqueues only frozen identities', async () => {
    const first = payload();
    const second = payload({
      suiteId: 'suite-2', slotId: 'slot-2', workflowId: 'workflow-2', jobId: 'job-2',
    });
    const dependency = coordinator({
      scanRecoverable: vi.fn(async ({ cursor }) => cursor
        ? { items: [second], nextCursor: null }
        : { items: [first], nextCursor: 'cursor-1' }),
    });
    const enqueue = vi.fn(async (_value: AiImageSuiteGenerationQueuePayload) => undefined);

    await enqueueRecoverableAiImageSuiteGenerationJobs({
      coordinator: dependency,
      enqueue,
      pageSize: 1,
    });

    expect(dependency.scanRecoverable).toHaveBeenNthCalledWith(1, { cursor: undefined, limit: 1 });
    expect(dependency.scanRecoverable).toHaveBeenNthCalledWith(2, { cursor: 'cursor-1', limit: 1 });
    expect(enqueue.mock.calls.map(([value]) => value)).toEqual([first, second]);
  });
});
