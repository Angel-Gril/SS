import { describe, expect, it, vi } from 'vitest';
import { createExtensionOzonPublishExecutor } from '../services/extension-ozon-publish-execution.js';

function input() {
  return {
    draftId: 'workflow-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    expectedRevision: 9,
    idempotencyKey: 'publish-operation-0001',
    publishIntentId: 'publish-intent-1',
    requestingDeviceSessionId: 'session-1',
  };
}

describe('extension Ozon publish execution recovery', () => {
  it('passes the operation idempotency key to the existing publisher unchanged', async () => {
    const submitted = { state: 'SUBMITTED', lastErrorCode: null };
    const publish = vi.fn(async () => submitted);
    const getByPublishIntent = vi.fn();
    const execute = createExtensionOzonPublishExecutor({
      publisher: { publish } as never,
      attempts: { getByPublishIntent } as never,
    });

    await expect(execute(input())).resolves.toBe(submitted);
    expect(publish).toHaveBeenCalledWith({
      draftId: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 9, idempotencyKey: 'publish-operation-0001',
      requestingDeviceSessionId: 'session-1',
    });
    expect(getByPublishIntent).not.toHaveBeenCalled();
  });

  it('recovers the durable attempt instead of failing after publisher acknowledgement loss', async () => {
    const publishError = Object.assign(new Error('acknowledgement write failed'), {
      code: 'LEASE_LOST',
    });
    const persisted = { state: 'SUBMITTING', lastErrorCode: null };
    const execute = createExtensionOzonPublishExecutor({
      publisher: { publish: vi.fn(async () => { throw publishError; }) } as never,
      attempts: { getByPublishIntent: vi.fn(async () => persisted) } as never,
    });

    await expect(execute(input())).resolves.toBe(persisted);
  });

  it('returns an unknown projection when the attempt ledger cannot prove the outcome', async () => {
    const execute = createExtensionOzonPublishExecutor({
      publisher: { publish: vi.fn(async () => { throw new Error('publisher failed'); }) } as never,
      attempts: {
        getByPublishIntent: vi.fn(async () => { throw new Error('ledger unavailable'); }),
      } as never,
    });

    await expect(execute(input())).resolves.toEqual({
      state: 'UNKNOWN', lastErrorCode: 'OZON_PUBLISH_STATE_UNAVAILABLE',
    });
  });

  it('preserves a definitive pre-submission error when no attempt was created', async () => {
    const publishError = Object.assign(new Error('compile rejected'), {
      code: 'OZON_PUBLISH_COMPILE_STALE',
    });
    const execute = createExtensionOzonPublishExecutor({
      publisher: { publish: vi.fn(async () => { throw publishError; }) } as never,
      attempts: { getByPublishIntent: vi.fn(async () => null) } as never,
    });

    await expect(execute(input())).rejects.toBe(publishError);
  });
});
