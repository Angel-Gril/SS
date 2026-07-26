import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaExtensionByokPublishStatusRepository,
  ExtensionByokPublishStatusRepositoryError,
} from '../repositories/extension-byok-publish-status-repository.js';

const requestHash = 'a'.repeat(64);

function input(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftVersion: 6,
    idempotencyKey: 'publish-operation-0001', requestHash,
    ...overrides,
  } as any;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'OZON_PUBLISH',
    shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 6,
    idempotencyKey: 'publish-operation-0001', requestHash,
    consumedAt: null, receipt: null,
    ...overrides,
  };
}

describe('extension BYOK publish status repository', () => {
  it('distinguishes authoritative not-committed, pending, succeeded, and failed without returning result', async () => {
    const findFirst = vi.fn();
    const repository = createPrismaExtensionByokPublishStatusRepository({
      extensionCommandGrant: { findFirst },
    });
    findFirst.mockResolvedValueOnce(null);
    await expect(repository.findStatus(input())).resolves.toEqual({ kind: 'not_committed' });
    findFirst.mockResolvedValueOnce(row());
    await expect(repository.findStatus(input())).resolves.toEqual({ kind: 'not_committed' });
    findFirst.mockResolvedValueOnce(row({
      consumedAt: new Date(),
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    }));
    await expect(repository.findStatus(input())).resolves.toEqual({ kind: 'pending', receiptId: 'receipt-1' });
    findFirst.mockResolvedValueOnce(row({
      consumedAt: new Date(),
      receipt: { id: 'receipt-1', status: 'SUCCEEDED', result: { unsafeUrl: 'https://example.test/x' }, failureCode: null },
    }));
    await expect(repository.findStatus(input())).resolves.toEqual({ kind: 'succeeded', receiptId: 'receipt-1' });
    findFirst.mockResolvedValueOnce(row({
      consumedAt: new Date(),
      receipt: { id: 'receipt-1', status: 'FAILED', result: { provider: 'secret' }, failureCode: 'OZON_REJECTED' },
    }));
    await expect(repository.findStatus(input())).resolves.toEqual({
      kind: 'failed', receiptId: 'receipt-1', failureCode: 'OZON_REJECTED',
    });
  });

  it('rejects idempotency identity collisions and malformed receipt state', async () => {
    for (const value of [
      row({ shopId: 'shop-2' }),
      row({ requestHash: 'b'.repeat(64) }),
      row({ consumedAt: new Date(), receipt: null }),
      row({ receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null } }),
      row({ consumedAt: new Date(), receipt: { id: 'receipt-1', status: 'SUCCEEDED', result: null, failureCode: null } }),
      row({ consumedAt: new Date(), receipt: { id: 'receipt-1', status: 'FAILED', result: null, failureCode: null } }),
    ]) {
      const repository = createPrismaExtensionByokPublishStatusRepository({
        extensionCommandGrant: { findFirst: vi.fn(async () => value) },
      });
      await expect(repository.findStatus(input())).rejects.toBeInstanceOf(
        ExtensionByokPublishStatusRepositoryError,
      );
    }
  });
});
