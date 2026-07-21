import { describe, expect, it, vi } from 'vitest';
import type { AiProviderReconciliationClaim } from '../services/ai-provider-reconciliation.js';
import {
  lookupAiImageTranslationProviderTask,
  runAiProviderReconciliationTick,
} from '../workers/ai-provider-reconciliation.js';

function claim(): AiProviderReconciliationClaim {
  return {
    jobId: 'job-1', workflowId: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    operation: 'IMAGE_TRANSLATE', provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image',
    estimatedCostCents: 12,
    providerJobId: 'task-1', jobStatus: 'FAILED', reconciliationStatus: 'RUNNING',
    reconciliationRevision: 2, reconciliationAttemptCount: 1,
    deadlineAt: new Date('2026-07-22T08:00:00.000Z'), leaseToken: 'lease-1',
  };
}

const runtimeConfig = {
  enabled: false,
  provider: 'dashscope-qwen-mt-image',
  baseUrl: 'https://dashscope.example/api/v1',
  apiKey: 'secret',
  model: 'qwen-mt-image',
  costPerImageCents: 12,
};

describe('AI Provider reconciliation worker lookup', () => {
  it('claims one task with a lease that covers Provider poll and result download', async () => {
    const claimDue = vi.fn(async () => []);

    await runAiProviderReconciliationTick({
      repository: {
        claimDue,
        defer: vi.fn(),
        markManualReview: vi.fn(),
        completeRecovered: vi.fn(),
        completeNoOutput: vi.fn(),
      },
      uploadBuffer: vi.fn(),
      workerId: 'worker-1',
    });

    expect(claimDue).toHaveBeenCalledWith(expect.objectContaining({
      limit: 1,
      leaseMs: 20 * 60 * 1000,
    }));
  });

  it('drains backlog one just-in-time claim at a time within a bounded tick', async () => {
    const first = claim();
    const second = { ...claim(), jobId: 'job-2', providerJobId: 'task-2', leaseToken: 'lease-2' };
    const claimDue = vi.fn()
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second])
      .mockResolvedValueOnce([]);
    const defer = vi.fn(async () => undefined);

    await expect(runAiProviderReconciliationTick({
      repository: {
        claimDue,
        defer,
        markManualReview: vi.fn(),
        completeRecovered: vi.fn(),
        completeNoOutput: vi.fn(),
      },
      getProviderConfig: vi.fn(async () => runtimeConfig),
      resolveProvider: vi.fn(() => ({
        name: runtimeConfig.provider,
        submit: vi.fn(),
        poll: vi.fn(async () => ({ status: 'PENDING' as const, providerStatus: 'RUNNING' })),
      })),
      uploadBuffer: vi.fn(),
      workerId: 'worker-1',
      drainLimit: 5,
      now: () => new Date('2026-07-21T08:00:00.000Z'),
    })).resolves.toMatchObject({ claimed: 2, pending: 2 });

    expect(claimDue).toHaveBeenCalledTimes(3);
    expect(claimDue.mock.calls.every(([input]) => input.limit === 1)).toBe(true);
    expect(defer).toHaveBeenCalledTimes(2);
  });

  it('polls an accepted task while submission remains structurally unavailable', async () => {
    const submit = vi.fn(() => {
      throw new Error('submit must never run during reconciliation');
    });
    const poll = vi.fn(async () => ({ status: 'PENDING' as const, providerStatus: 'RUNNING' }));
    const resolveProvider = vi.fn(() => ({ name: runtimeConfig.provider, submit, poll }));

    const result = await lookupAiImageTranslationProviderTask(claim(), {
      getProviderConfig: vi.fn(async () => ({ ...runtimeConfig, costPerImageCents: 99 })),
      resolveProvider,
      nodeEnv: 'test',
    });

    expect(result).toEqual({
      status: 'PENDING', providerJobId: 'task-1', providerStatus: 'RUNNING',
    });
    expect(resolveProvider).toHaveBeenCalledWith(
      runtimeConfig.provider,
      expect.objectContaining({ costPerImageCents: 12 }),
    );
    expect(poll).toHaveBeenCalledWith('task-1');
    expect(submit).not.toHaveBeenCalled();
  });

  it('returns a recovered image from the exact task identity', async () => {
    const image = { buffer: Buffer.from('image'), mimeType: 'image/png' };
    const result = await lookupAiImageTranslationProviderTask(claim(), {
      getProviderConfig: vi.fn(async () => runtimeConfig),
      resolveProvider: vi.fn(() => ({
        name: runtimeConfig.provider,
        submit: vi.fn(),
        poll: vi.fn(async () => ({
          status: 'SUCCEEDED' as const, providerStatus: 'SUCCEEDED' as const, image, actualCostCents: 12,
        })),
      })),
      nodeEnv: 'test',
    });

    expect(result).toMatchObject({
      status: 'SUCCEEDED', providerJobId: 'task-1', providerStatus: 'SUCCEEDED',
      image, actualCostCents: 12,
    });
  });

  it('rejects cost evidence that differs from the frozen accepted-task price', async () => {
    await expect(lookupAiImageTranslationProviderTask(claim(), {
      getProviderConfig: vi.fn(async () => runtimeConfig),
      resolveProvider: vi.fn(() => ({
        name: runtimeConfig.provider,
        submit: vi.fn(),
        poll: vi.fn(async () => ({
          status: 'SUCCEEDED' as const,
          providerStatus: 'SUCCEEDED' as const,
          image: { buffer: Buffer.from('image'), mimeType: 'image/png' },
          actualCostCents: 99,
        })),
      })),
      nodeEnv: 'test',
    })).rejects.toMatchObject({ code: 'PROVIDER_COST_EVIDENCE_MISMATCH' });
  });

  it('maps a proven terminal task failure to no output without deciding billing', async () => {
    const result = await lookupAiImageTranslationProviderTask(claim(), {
      getProviderConfig: vi.fn(async () => runtimeConfig),
      resolveProvider: vi.fn(() => ({
        name: runtimeConfig.provider,
        submit: vi.fn(),
        poll: vi.fn(async () => {
          throw Object.assign(new Error('task failed'), { code: 'PROVIDER_TASK_FAILED' });
        }),
      })),
      nodeEnv: 'test',
    });

    expect(result).toEqual({
      status: 'NO_OUTPUT', providerJobId: 'task-1', providerStatus: 'FAILED',
      errorCode: 'PROVIDER_TASK_FAILED', errorMessage: 'task failed', billingDisposition: 'UNKNOWN',
    });
  });

  it('marks transient poll errors for repository backoff', async () => {
    await expect(lookupAiImageTranslationProviderTask(claim(), {
      getProviderConfig: vi.fn(async () => runtimeConfig),
      resolveProvider: vi.fn(() => ({
        name: runtimeConfig.provider,
        submit: vi.fn(),
        poll: vi.fn(async () => {
          throw Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT' });
        }),
      })),
      nodeEnv: 'test',
    })).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', transient: true });
  });

  it('fails closed when the frozen Provider configuration cannot be loaded', async () => {
    await expect(lookupAiImageTranslationProviderTask(claim(), {
      getProviderConfig: vi.fn(async () => ({ ...runtimeConfig, provider: 'disabled', apiKey: '' })),
      resolveProvider: vi.fn(),
      nodeEnv: 'test',
    })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_CONFIG_UNAVAILABLE' });
  });
});
