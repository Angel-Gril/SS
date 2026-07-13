import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_TASK_VERSION,
  type LogisticsCaptureScope,
} from '../services/logistics-capture-task.js';
import { createPrismaLogisticsCaptureTaskRepository } from '../services/logistics-capture-task-prisma.js';

const NOW = new Date('2026-07-12T10:00:00.000Z');
const NONCE = 'capture-nonce-0123456789abcdef';
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
const SECRET = 'capture-claim-token-secret-0123456789abcdef';

function taskRow(status: 'ISSUED' | 'CLAIMED' | 'CANCELLED' = 'ISSUED') {
  return {
    id: 'task-a',
    version: CAPTURE_TASK_VERSION,
    kind: 'SELLER',
    requestedByUserId: 'admin-a',
    tenantId: SCOPE.tenantId,
    shopId: SCOPE.shopId,
    companyId: SCOPE.companyId,
    warehouseId: SCOPE.warehouseId,
    originCountryUid: SCOPE.originCountryUid,
    originCityUid: SCOPE.originCityUid,
    destinationCountryUid: null,
    destinationLocationUid: null,
    officialFingerprint: null,
    expectedEndpoints: ['seller/template/by-location'],
    fingerprintChecksum: 'a'.repeat(64),
    nonceDigest: createHash('sha256').update(NONCE).digest('hex'),
    status,
    claimedBySessionId: status === 'ISSUED' ? null : DEVICE.sessionId,
    candidateId: null,
    claimedAt: status === 'ISSUED' ? null : NOW,
    uploadedAt: null,
    reviewableAt: null,
    cancelledAt: status === 'CANCELLED' ? NOW : null,
    issuedAt: NOW,
    expiresAt: new Date('2026-07-12T10:10:00.000Z'),
  };
}

function candidateRow(reviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED' = 'PENDING_REVIEW') {
  return {
    candidateId: 'candidate-a',
    taskId: 'task-a',
    taskKind: 'SELLER',
    tenantId: SCOPE.tenantId,
    shopId: SCOPE.shopId,
    companyId: SCOPE.companyId,
    warehouseId: SCOPE.warehouseId,
    originCountryUid: SCOPE.originCountryUid,
    originCityUid: SCOPE.originCityUid,
    destinationCountryUid: null,
    destinationLocationUid: null,
    state: 'CAPTURED',
    reviewStatus,
    responseChecksum: 'b'.repeat(64),
    sourceResponseChecksum: null,
    previousResponseChecksum: null,
    capturedAt: NOW,
    receivedAt: NOW,
    quarantineReasons: [],
    normalizedPayload: { schema: 'ozon-seller-logistics-capture/v1' },
    diagnostics: {
      schema: 'ozon-seller-logistics-capture/v1',
      historicalCountsOnly: true,
    },
    reviewedById: reviewStatus === 'PENDING_REVIEW' ? null : 'admin-a',
    reviewedAt: reviewStatus === 'PENDING_REVIEW' ? null : NOW,
    reviewReason: reviewStatus === 'REJECTED' ? 'bad evidence' : null,
  };
}

describe('Prisma logistics capture task execution loop', () => {
  it('lists only live granted tasks and issues an opaque session-bound claim token', async () => {
    const query = vi.fn(async () => [taskRow()]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({
      client: client as never,
      claimTokenSecret: SECRET,
    });

    const tasks = await repository.listPendingCaptureTasks!({
      device: DEVICE,
      now: NOW,
      limit: 100,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'task-a',
      claimToken: expect.stringMatching(/^ct1\.[A-Za-z0-9_-]{32,}$/),
    });
    expect(tasks[0]).not.toHaveProperty('nonce');
    const sql = String((query.mock.calls as unknown[][])[0]?.[0]);
    expect(sql).toContain('"extension_device_sessions"');
    expect(sql).toContain('"extension_device_shop_grants"');
    expect(sql).toContain("t.\"status\" IN ('ISSUED', 'CLAIMED')");
    expect(sql).toContain('t."expires_at" >');
    expect(JSON.stringify(query.mock.calls)).not.toContain(SECRET);
  });

  it('accepts the pending claim token only for its bound session and keeps claim retries idempotent', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([taskRow()])
      .mockResolvedValueOnce([taskRow()])
      .mockResolvedValueOnce([taskRow('CLAIMED')])
      .mockResolvedValueOnce([taskRow('CLAIMED')]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({
      client: client as never,
      claimTokenSecret: SECRET,
    });
    const [pending] = await repository.listPendingCaptureTasks!({
      device: DEVICE,
      now: NOW,
      limit: 100,
    });

    const proof = {
      taskId: 'task-a',
      taskVersion: CAPTURE_TASK_VERSION,
      claimToken: pending!.claimToken,
      scope: SCOPE,
      device: DEVICE,
      now: NOW,
    };
    await expect(repository.claimCaptureTask(proof)).resolves.toMatchObject({
      state: 'claimed',
      duplicate: false,
    });
    await expect(repository.claimCaptureTask(proof)).resolves.toMatchObject({
      state: 'claimed',
      duplicate: true,
    });
  });

  it('rejects a claim token replayed by another session without mutating the task', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([taskRow()])
      .mockResolvedValueOnce([taskRow()]);
    const execute = vi.fn();
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: execute,
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({
      client: client as never,
      claimTokenSecret: SECRET,
    });
    const [pending] = await repository.listPendingCaptureTasks!({
      device: DEVICE,
      now: NOW,
      limit: 100,
    });

    await expect(repository.claimCaptureTask({
      taskId: 'task-a',
      taskVersion: CAPTURE_TASK_VERSION,
      claimToken: pending!.claimToken,
      scope: SCOPE,
      device: { ...DEVICE, sessionId: 'session-b' },
      now: NOW,
    })).resolves.toEqual({ state: 'not_found' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels only the claiming device task and makes the same cancellation retry idempotent', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([taskRow('CLAIMED')])
      .mockResolvedValueOnce([taskRow('CANCELLED')])
      .mockResolvedValueOnce([taskRow('CANCELLED')]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({
      client: client as never,
      claimTokenSecret: SECRET,
    });
    const manualProof = {
      taskId: 'task-a',
      taskVersion: CAPTURE_TASK_VERSION,
      nonce: NONCE,
      scope: SCOPE,
      device: DEVICE,
      now: NOW,
    };

    await expect(repository.cancelCaptureTask!(manualProof)).resolves.toMatchObject({
      state: 'cancelled',
      duplicate: false,
    });
    await expect(repository.cancelCaptureTask!(manualProof)).resolves.toMatchObject({
      state: 'cancelled',
      duplicate: true,
    });
  });

  it('atomically records reviewer, time and reason without changing candidate evidence', async () => {
    const before = candidateRow();
    const after = {
      ...candidateRow('VERIFIED'),
      normalizedPayload: before.normalizedPayload,
      reviewReason: 'matched Seller and Official evidence',
    };
    const query = vi.fn()
      .mockResolvedValueOnce([before])
      .mockResolvedValueOnce([after]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({
      client: client as never,
      claimTokenSecret: SECRET,
    });

    const result = await repository.reviewCaptureCandidate!({
      candidateId: 'candidate-a',
      actorUserId: 'admin-a',
      decision: 'VERIFIED',
      reason: 'matched Seller and Official evidence',
      reviewedAt: NOW,
    });

    expect(result).toMatchObject({
      state: 'reviewed',
      duplicate: false,
      candidate: {
        reviewStatus: 'VERIFIED',
        reviewedById: 'admin-a',
        reviewedAt: NOW.toISOString(),
        reviewReason: 'matched Seller and Official evidence',
        normalizedPayload: before.normalizedPayload,
      },
    });
    const updateSql = String(query.mock.calls[1]?.[0]);
    expect(updateSql).toContain('"reviewed_by_id"');
    expect(updateSql).toContain('"reviewed_at"');
    expect(updateSql).toContain('"review_reason"');
    expect(updateSql).not.toContain('"normalized_payload" =');
  });
});
