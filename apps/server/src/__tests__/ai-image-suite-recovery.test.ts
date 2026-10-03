import { describe, expect, it, vi } from 'vitest';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { createAiImageSuiteRecovery, aiImageSuiteRecoveryAuthorization } from '../services/ai-image-suite-recovery.js';

const now = new Date('2026-10-04T10:00:00.000Z');
function job() {
  const accepted = new Date(now.getTime() - 60_000);
  return { id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', workflowId: 'workflow-1', workflowAttempt: 1,
    requestFingerprint: 'a'.repeat(64), status: 'FAILED', operation: 'IMAGE_TO_IMAGE', provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
    providerJobId: 'accepted-task', providerDispatchedAt: accepted, attemptCount: 1, maxAttempts: 1,
    estimatedCostCents: 14, actualCostCents: null, billedUnits: 0, width: 900, height: 1200, requestedImageCount: 1,
    errorCode: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', errorMessage: 'Rejected 800x800', assets: [],
    operationConfig: { providerRuntime: createAiImageProviderRuntimeContract({ provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1', costPerImageCents: 14, currency: 'CNY',
      credentialRevision: { recordId: 'key-1', revision: 1, updatedAt: '2026-10-04T09:00:00.000Z' },
    }, { count: 1, width: 1024, height: 1024 }) },
    costReservation: { id: 'reservation-1', jobId: 'job-1', workflowId: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', operation: 'IMAGE_TO_IMAGE', currency: 'CNY',
      providerRequestId: 'accepted-task', providerAcceptedAt: accepted, estimatedCostMinor: 14, maximumCostMinor: 14,
      status: 'RECONCILIATION_REQUIRED', requestFingerprint: 'a'.repeat(64), settlements: [] },
    workflow: { id: 'workflow-1', ownerUserId: 'owner-1', operation: 'IMAGE_TO_IMAGE', currentAttempt: 1,
      status: 'FAILED', reviewStatus: 'NOT_READY', selectedOutputAssetId: null,
      suiteSlot: { id: 'slot-1', ownerUserId: 'owner-1', childWorkflowId: 'workflow-1', attempt: 1,
        status: 'FAILED', estimatedCostCents: 14, maximumCostCents: 14,
        suite: { id: 'suite-1', ownerUserId: 'owner-1', status: 'FAILED', sourceCaptureSnapshotId: 'snapshot-1',
          provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', itemCount: 2, maximumCostCents: 28, cancelRequestedAt: null } } } };
}

describe('original accepted suite recovery', () => {
  it('authorizes only the original accepted attempt within its original task window', () => {
    expect(aiImageSuiteRecoveryAuthorization(job(), now)).toMatchObject({
      version: 'ai-image-suite-original-task-recovery/v1', suiteId: 'suite-1', slotId: 'slot-1', attempt: 1,
      originalErrorCode: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', originalErrorMessage: 'Rejected 800x800',
      deadlineAt: new Date(now.getTime() - 60_000 + 24 * 60 * 60_000).toISOString(),
    });
  });
  it.each(['identity', 'expired', 'cost', 'attempt', 'asset', 'error', 'cancel', 'snapshot owner'])('rejects %s changes', label => {
    const value = job();
    if (label === 'identity') value.costReservation.providerRequestId = 'other-task';
    if (label === 'expired') value.providerDispatchedAt = new Date(now.getTime() - 25 * 60 * 60_000);
    if (label === 'cost') value.workflow.suiteSlot.suite.maximumCostCents = 29;
    if (label === 'attempt') value.workflow.currentAttempt = 2;
    if (label === 'asset') (value.assets as unknown[]) = [{ id: 'existing-final' }];
    if (label === 'error') value.errorCode = 'UNKNOWN_OUTCOME';
    if (label === 'cancel') value.workflow.suiteSlot.suite.cancelRequestedAt = now as never;
    if (label === 'snapshot owner') value.workflow.suiteSlot.suite.ownerUserId = 'other-owner';
    expect(aiImageSuiteRecoveryAuthorization(value, now)).toBeNull();
  });
  it('calls only the original task lookup and reuses its result during the suite completion pipeline', async () => {
    const current = job();
    const claim = { jobId: current.id, providerJobId: current.providerJobId } as any;
    const result = { status: 'SUCCEEDED', providerJobId: 'accepted-task', providerStatus: 'SUCCEEDED',
      image: { buffer: Buffer.from('synthetic image'), mimeType: 'image/png' }, actualCostCents: 14 } as const;
    const execute = vi.fn();
    const recover = vi.fn(async () => result);
    const repository = { isSuiteClaim: vi.fn(async () => true), getClaimedGraph: vi.fn(async () => ({ job: current,
      suite: current.workflow.suiteSlot.suite })), complete: vi.fn(async () => undefined) };
    const executeRecovery = vi.fn(async (_input, dependencies) => {
      const prepared = await dependencies.prepareProvider();
      expect(await prepared.recover('accepted-task', dependencies.assertClaim)).toBe(result);
      await dependencies.recordProviderOutput({ sha256: 'b'.repeat(64) });
      await dependencies.complete({ output: { sha256: 'c'.repeat(64) }, actualCostCents: 14, providerJobId: 'accepted-task' });
    });
    const service = createAiImageSuiteRecovery({ repository, uploadBuffer: vi.fn(),
      prepareProvider: vi.fn(async () => ({ execute, recover } as any)), executeRecovery });
    expect(await service.lookup(claim)).toBe(result);
    await service.recover(claim, result);
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith('accepted-task', expect.any(Function));
    expect(execute).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledOnce();
  });
});
