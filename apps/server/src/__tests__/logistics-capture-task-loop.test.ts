import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_TASK_VERSION,
  createLogisticsCaptureTaskService,
  type LogisticsCaptureReviewCandidateDetail,
  type LogisticsCaptureScope,
  type LogisticsCaptureTask,
} from '../services/logistics-capture-task.js';

const NOW = new Date('2026-07-12T10:00:00.000Z');
const SCOPE: LogisticsCaptureScope = {
  tenantId: 'tenant-a',
  shopId: 'shop-a',
  companyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
};
const DEVICE = {
  sessionId: 'session-a',
  ownerUserId: 'tenant-a',
  allowedShopIds: ['shop-a'],
};

function task(overrides: Partial<LogisticsCaptureTask> = {}): LogisticsCaptureTask {
  return {
    id: 'task-a',
    version: CAPTURE_TASK_VERSION,
    kind: 'SELLER',
    requestedByUserId: 'admin-a',
    scope: structuredClone(SCOPE),
    destination: null,
    officialFingerprint: null,
    expectedEndpoints: ['seller/template/by-location'],
    fingerprintChecksum: 'a'.repeat(64),
    nonce: '',
    status: 'ISSUED',
    claimedBySessionId: null,
    claimedAt: null,
    uploadedAt: null,
    reviewableAt: null,
    issuedAt: new Date(NOW),
    expiresAt: new Date('2026-07-12T10:10:00.000Z'),
    ...overrides,
  };
}

function candidate(
  state: 'CAPTURED' | 'QUARANTINED' = 'CAPTURED',
): LogisticsCaptureReviewCandidateDetail {
  return {
    candidateId: 'candidate-a',
    taskId: 'task-a',
    taskKind: 'SELLER',
    taskVersion: 'logistics-capture-task/v2',
    ...SCOPE,
    destination: null,
    state,
    reviewStatus: 'PENDING_REVIEW',
    responseChecksum: 'b'.repeat(64),
    previousResponseChecksum: null,
    receivedAt: '2026-07-12T10:03:00.000Z',
    sourceResponseChecksum: null,
    capturedAt: '2026-07-12T10:02:00.000Z',
    quarantineReasons: state === 'QUARANTINED' ? ['ENDPOINT_BATCH_INCOMPLETE'] : [],
    normalizedPayload: { schema: 'ozon-seller-logistics-capture/v1' },
    diagnostics: {
      schema: 'ozon-seller-logistics-capture/v1',
      historicalCountsOnly: true,
    },
    reviewedById: null,
    reviewedAt: null,
    reviewReason: null,
  };
}

describe('logistics capture execution and review loop', () => {
  it('returns only live in-scope pending tasks with session-bound claim tokens and progress', async () => {
    const repository = {
      listPendingCaptureTasks: vi.fn(async () => [
        { ...task(), claimToken: 'ct1.valid-task-token-0123456789012345' },
        {
          ...task({ id: 'foreign-shop', scope: { ...SCOPE, shopId: 'shop-b' } }),
          claimToken: 'ct1.foreign-token-0123456789012345',
        },
        {
          ...task({ id: 'expired', expiresAt: new Date('2026-07-12T09:59:59.000Z') }),
          claimToken: 'ct1.expired-token-0123456789012345',
        },
        {
          ...task({ id: 'other-session', status: 'CLAIMED', claimedBySessionId: 'session-b' }),
          claimToken: 'ct1.other-token-0123456789012345',
        },
      ]),
    };
    const service = createLogisticsCaptureTaskService({
      repository: repository as never,
      now: () => new Date(NOW),
    });

    const pending = await service.listPendingCaptureTasks({ device: DEVICE });

    expect(repository.listPendingCaptureTasks).toHaveBeenCalledWith({
      device: DEVICE,
      now: NOW,
      limit: 100,
    });
    expect(pending).toEqual([expect.objectContaining({
      id: 'task-a',
      claimToken: 'ct1.valid-task-token-0123456789012345',
      progress: { phase: 'waiting', completed: false, percent: 0 },
    })]);
    expect(pending[0]).not.toHaveProperty('nonce');
  });

  it('accepts exactly one claim proof and cancels an owned claim idempotently', async () => {
    const claimed = task({
      status: 'CLAIMED',
      claimedBySessionId: DEVICE.sessionId,
      claimedAt: new Date(NOW),
    });
    const repository = {
      claimCaptureTask: vi.fn(async () => ({
        state: 'claimed',
        duplicate: false,
        task: claimed,
      })),
      cancelCaptureTask: vi.fn(async () => ({
        state: 'cancelled',
        duplicate: false,
        task: { ...claimed, status: 'CANCELLED' as const },
      })),
    };
    const service = createLogisticsCaptureTaskService({
      repository: repository as never,
      now: () => new Date(NOW),
    });
    const proof = {
      taskId: claimed.id,
      taskVersion: claimed.version,
      claimToken: 'ct1.valid-task-token-0123456789012345',
      scope: SCOPE,
      device: DEVICE,
    };

    await expect(service.claimCaptureTask(proof)).resolves.toMatchObject({
      status: 'CLAIMED',
    });
    await expect(service.cancelCaptureTask(proof)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
    expect(repository.cancelCaptureTask).toHaveBeenCalledWith(expect.objectContaining({
      claimToken: proof.claimToken,
      nonce: undefined,
      now: NOW,
    }));
    await expect(service.claimCaptureTask({
      ...proof,
      nonce: 'manual-nonce-0123456789abcdef',
    } as never)).rejects.toMatchObject({
      code: 'CAPTURE_TASK_MISMATCH',
      statusCode: 404,
    });
  });

  it('verifies or rejects candidates and blocks quarantine verification', async () => {
    const captured = candidate();
    const repository = {
      getCaptureCandidate: vi.fn(async () => captured),
      reviewCaptureCandidate: vi.fn(async (
        input: { decision: 'VERIFIED' | 'REJECTED' },
      ) => ({
        state: 'reviewed',
        duplicate: false,
        candidate: { ...captured, reviewStatus: input.decision },
      })),
    };
    const service = createLogisticsCaptureTaskService({
      repository: repository as never,
      now: () => new Date(NOW),
    });

    await expect(service.reviewCaptureCandidate({
      candidateId: captured.candidateId,
      actorUserId: 'admin-a',
      decision: 'VERIFIED',
      reason: 'scope and canonical evidence verified',
    })).resolves.toMatchObject({ reviewStatus: 'VERIFIED' });
    await expect(service.reviewCaptureCandidate({
      candidateId: captured.candidateId,
      actorUserId: 'admin-a',
      decision: 'REJECTED',
      reason: 'captured evidence is incomplete',
    })).resolves.toMatchObject({ reviewStatus: 'REJECTED' });

    for (const reason of [undefined, null, '', '  ', 'no']) {
      await expect(service.reviewCaptureCandidate({
        candidateId: captured.candidateId,
        actorUserId: 'admin-a',
        decision: 'VERIFIED',
        reason: reason as never,
      })).rejects.toMatchObject({
        code: 'INVALID_CAPTURE_REVIEW',
        statusCode: 400,
      });
    }

    repository.getCaptureCandidate.mockResolvedValueOnce(candidate('QUARANTINED'));
    await expect(service.reviewCaptureCandidate({
      candidateId: captured.candidateId,
      actorUserId: 'admin-a',
      decision: 'VERIFIED',
      reason: 'scope and canonical evidence verified',
    })).rejects.toMatchObject({
      code: 'CAPTURE_CANDIDATE_QUARANTINED',
      statusCode: 409,
    });
  });
});
