import { describe, expect, it } from 'vitest';
import {
  createExtensionCommandGrantService,
  ExtensionCommandGrantError,
  hashExtensionCommandRequest,
  InMemoryExtensionCommandGrantStore,
  resolveExtensionCommandGrantSecret,
  type ExtensionCommandGrantStore,
} from '../services/extension-command-grants.js';

const NOW = new Date('2026-07-14T08:00:00.000Z');
const SECRET = 'extension-command-grant-secret-for-tests';
const TOKEN = 't'.repeat(43);
const REQUEST_HASH = 'a'.repeat(64);

function target(overrides: Record<string, unknown> = {}) {
  const store = new InMemoryExtensionCommandGrantStore();
  const service = createExtensionCommandGrantService({
    store,
    secret: SECRET,
    now: () => NOW,
    deriveToken: () => TOKEN,
  });
  return { store, service, ...overrides };
}

function publishBinding(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    operation: 'OZON_PUBLISH' as const,
    workflowId: 'workflow-1',
    draftVersion: 7,
    idempotencyKey: 'publish-workflow-1-v7',
    requestHash: REQUEST_HASH,
    ...overrides,
  };
}

describe('extension command grants', () => {
  it('requires an independent production secret and derives only in development', () => {
    const explicit = 'command-grant-secret-01234567890123456789';
    expect(resolveExtensionCommandGrantSecret({
      NODE_ENV: 'production',
      EXTENSION_COMMAND_GRANT_SECRET: explicit,
      EXTENSION_DEVICE_JWT_SECRET: 'device-secret-012345678901234567890',
      JWT_SECRET: 'account-secret-01234567890123456789',
    })).toBe(explicit);
    expect(() => resolveExtensionCommandGrantSecret({
      NODE_ENV: 'production',
      EXTENSION_DEVICE_JWT_SECRET: 'device-secret-012345678901234567890',
    })).toThrow(/EXTENSION_COMMAND_GRANT_SECRET/);
    expect(() => resolveExtensionCommandGrantSecret({
      NODE_ENV: 'production',
      EXTENSION_COMMAND_GRANT_SECRET: explicit,
      EXTENSION_DEVICE_JWT_SECRET: explicit,
    })).toThrow(/must differ/);

    const derived = resolveExtensionCommandGrantSecret({
      NODE_ENV: 'development',
      EXTENSION_DEVICE_JWT_SECRET: 'device-secret-012345678901234567890',
    });
    expect(derived).toMatch(/^[a-f0-9]{64}$/);
    expect(derived).not.toBe('device-secret-012345678901234567890');
  });

  it('hashes parsed JSON canonically while preserving array order', () => {
    const first = hashExtensionCommandRequest({ z: 2, a: { y: true, x: ['one', 'two'] } });
    const reordered = hashExtensionCommandRequest({ a: { x: ['one', 'two'], y: true }, z: 2 });
    const changed = hashExtensionCommandRequest({ a: { x: ['two', 'one'], y: true }, z: 2 });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
    expect(() => hashExtensionCommandRequest({ unsafe: undefined }))
      .toThrowError(expect.objectContaining({ code: 'COMMAND_PAYLOAD_INVALID' }));
    expect(() => hashExtensionCommandRequest(Array(1)))
      .toThrowError(expect.objectContaining({ code: 'COMMAND_PAYLOAD_INVALID' }));
  });

  it('issues a short-lived opaque token while persisting only its digest', async () => {
    const { service, store } = target();

    const issued = await service.issue(publishBinding());

    expect(issued.token).toBe(TOKEN);
    expect(issued.expiresAt).toEqual(new Date(NOW.getTime() + 60_000));
    const snapshot = store.snapshot();
    expect(snapshot.grants).toHaveLength(1);
    expect(snapshot.grants[0]).toMatchObject({
      id: issued.grantId,
      sessionId: 'session-1',
      tokenId: 'jti-1',
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      operation: 'OZON_PUBLISH',
      workflowId: 'workflow-1',
      draftVersion: 7,
      idempotencyKey: 'publish-workflow-1-v7',
      requestHash: REQUEST_HASH,
      tokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      consumedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
  });

  it('returns the same deterministic grant for an exact issuance retry and conflicts on changed payload', async () => {
    const { service, store } = target();

    const first = await service.issue(publishBinding());
    const replay = await service.issue(publishBinding());

    expect(replay).toEqual(first);
    expect(store.snapshot().grants).toHaveLength(1);
    await expect(service.issue(publishBinding({ requestHash: 'b'.repeat(64) })))
      .rejects.toMatchObject({ code: 'COMMAND_IDEMPOTENCY_CONFLICT', statusCode: 409 });
    expect(store.snapshot().grants).toHaveLength(1);
  });

  it('limits outstanding unconsumed grants per device session', async () => {
    const store = new InMemoryExtensionCommandGrantStore();
    const service = createExtensionCommandGrantService({
      store,
      secret: SECRET,
      now: () => NOW,
      deriveToken: (grantId) => grantId.replaceAll('-', '').padEnd(43, 'x'),
    });

    for (let index = 0; index < 50; index += 1) {
      await service.issue(publishBinding({
        idempotencyKey: `publish-workflow-1-v7-${String(index).padStart(3, '0')}`,
      }));
    }
    await expect(service.issue(publishBinding({
      idempotencyKey: 'publish-workflow-1-v7-over-limit',
    }))).rejects.toMatchObject({ code: 'COMMAND_GRANT_LIMIT_REACHED', statusCode: 429 });
  });

  it('atomically consumes a grant once and returns the same pending receipt on exact replay', async () => {
    const { service, store } = target();
    await service.issue(publishBinding());

    const first = await service.authorize({ token: TOKEN, ...publishBinding() });
    const replay = await service.authorize({ token: TOKEN, ...publishBinding() });

    expect(first.kind).toBe('execute');
    expect(first.receipt).toMatchObject({ status: 'PENDING', result: null, failureCode: null });
    expect(replay).toEqual({ kind: 'replay', receipt: first.receipt });
    expect(store.snapshot().receipts).toHaveLength(1);
    expect(store.snapshot().grants[0]?.consumedAt).toEqual(NOW);
  });

  it('rejects a changed payload binding and an expired token without consuming the grant', async () => {
    const { service, store } = target();
    await service.issue(publishBinding());

    await expect(service.authorize({
      token: TOKEN,
      ...publishBinding({ requestHash: 'b'.repeat(64) }),
    })).rejects.toMatchObject({ code: 'COMMAND_GRANT_MISMATCH', statusCode: 409 });

    const expiredService = createExtensionCommandGrantService({
      store,
      secret: SECRET,
      now: () => new Date(NOW.getTime() + 60_001),
      deriveToken: () => TOKEN,
    });
    await expect(expiredService.authorize({
      token: TOKEN,
      ...publishBinding(),
    })).rejects.toMatchObject({ code: 'COMMAND_GRANT_EXPIRED', statusCode: 410 });

    expect(store.snapshot().grants[0]?.consumedAt).toBeNull();
    expect(store.snapshot().receipts).toHaveLength(0);
  });

  it.each([
    ['session_invalid', 'COMMAND_SESSION_INVALID', 401],
    ['scope_denied', 'COMMAND_SCOPE_DENIED', 403],
    ['shop_denied', 'COMMAND_SHOP_DENIED', 403],
  ] as const)('maps live %s authorization failures without executing', async (kind, code, statusCode) => {
    const store = {
      issueGrant: async () => ({ kind: 'conflict' as const }),
      consumeOrReplay: async () => ({ kind }),
      completeReceipt: async () => ({ kind: 'not_found' as const }),
      revokeGrant: async () => ({ kind: 'not_found' as const }),
    } satisfies ExtensionCommandGrantStore;
    const service = createExtensionCommandGrantService({
      store,
      secret: SECRET,
      now: () => NOW,
      deriveToken: () => TOKEN,
    });

    await expect(service.authorize({ token: TOKEN, ...publishBinding() }))
      .rejects.toMatchObject({ code, statusCode });
  });

  it('persists one immutable result and replays it without executing the command again', async () => {
    const { service } = target();
    await service.issue(publishBinding());
    const authorized = await service.authorize({ token: TOKEN, ...publishBinding() });
    if (authorized.kind !== 'execute') throw new Error('expected executable receipt');

    const completed = await service.complete({
      receiptId: authorized.receipt.id,
      result: { attemptId: 'attempt-1', state: 'PREPARED' },
    });
    const replay = await service.authorize({ token: TOKEN, ...publishBinding() });

    expect(completed).toMatchObject({
      status: 'SUCCEEDED',
      result: { attemptId: 'attempt-1', state: 'PREPARED' },
      completedAt: NOW,
    });
    expect(replay).toEqual({ kind: 'replay', receipt: completed });
    expect(await service.complete({
      receiptId: authorized.receipt.id,
      result: { state: 'PREPARED', attemptId: 'attempt-1' },
    })).toEqual(completed);
    await expect(service.complete({
      receiptId: authorized.receipt.id,
      result: { attemptId: 'attempt-2', state: 'PREPARED' },
    })).rejects.toMatchObject({ code: 'COMMAND_RECEIPT_IMMUTABLE', statusCode: 409 });
  });

  it('persists one immutable failure result and replays it without executing again', async () => {
    const { service } = target();
    await service.issue(publishBinding());
    const authorized = await service.authorize({ token: TOKEN, ...publishBinding() });
    if (authorized.kind !== 'execute') throw new Error('expected executable receipt');

    const failed = await service.fail({
      receiptId: authorized.receipt.id,
      failureCode: 'OZON_SUBMIT_TIMEOUT',
      result: { retryable: false, state: 'UNKNOWN' },
    });
    const replay = await service.authorize({ token: TOKEN, ...publishBinding() });

    expect(failed).toMatchObject({
      status: 'FAILED',
      failureCode: 'OZON_SUBMIT_TIMEOUT',
      result: { retryable: false, state: 'UNKNOWN' },
      completedAt: NOW,
    });
    expect(replay).toEqual({ kind: 'replay', receipt: failed });
    await expect(service.complete({
      receiptId: authorized.receipt.id,
      result: { state: 'PREPARED' },
    })).rejects.toMatchObject({ code: 'COMMAND_RECEIPT_IMMUTABLE', statusCode: 409 });
  });

  it('replays an already accepted receipt after the short-lived grant expires', async () => {
    const { service, store } = target();
    await service.issue(publishBinding());
    const accepted = await service.authorize({ token: TOKEN, ...publishBinding() });

    const later = createExtensionCommandGrantService({
      store,
      secret: SECRET,
      now: () => new Date(NOW.getTime() + 60_001),
      deriveToken: () => TOKEN,
    });

    expect(await later.authorize({ token: TOKEN, ...publishBinding() }))
      .toEqual({ kind: 'replay', receipt: accepted.receipt });
  });

  it('requires a shop-bound publish grant and rejects unsupported operations', async () => {
    const { service } = target();

    await expect(service.issue(publishBinding({ shopId: null })))
      .rejects.toBeInstanceOf(ExtensionCommandGrantError);
    await expect(service.issue(publishBinding({ shopId: null })))
      .rejects.toMatchObject({ code: 'COMMAND_SHOP_REQUIRED', statusCode: 400 });
    await expect(service.issue(publishBinding({ operation: 'ROOT_SHELL' })))
      .rejects.toMatchObject({ code: 'COMMAND_OPERATION_INVALID', statusCode: 400 });
    await expect(service.issue(publishBinding({ draftVersion: 0 })))
      .rejects.toMatchObject({ code: 'COMMAND_BINDING_INVALID', statusCode: 400 });
    await expect(service.issue(publishBinding({ idempotencyKey: 'too-short' })))
      .rejects.toMatchObject({ code: 'COMMAND_BINDING_INVALID', statusCode: 400 });
    await expect(service.issue(publishBinding({ operation: 'LISTING_REVIEW', draftVersion: null })))
      .rejects.toMatchObject({ code: 'COMMAND_BINDING_INVALID', statusCode: 400 });
    await expect(service.issue(publishBinding({ operation: 'LISTING_REVIEW', workflowId: null })))
      .rejects.toMatchObject({ code: 'COMMAND_BINDING_INVALID', statusCode: 400 });
  });

  it('revokes an unconsumed grant once with an immutable reason', async () => {
    const { service, store } = target();
    const issued = await service.issue(publishBinding());

    const revoked = await service.revoke({
      grantId: issued.grantId,
      ownerUserId: 'owner-1',
      reason: 'OWNER_REVOKED',
    });

    expect(revoked).toMatchObject({
      id: issued.grantId,
      revokedAt: NOW,
      revokedReason: 'OWNER_REVOKED',
    });
    expect(await service.revoke({
      grantId: issued.grantId,
      ownerUserId: 'owner-1',
      reason: 'OWNER_REVOKED',
    })).toEqual(revoked);
    await expect(service.authorize({ token: TOKEN, ...publishBinding() }))
      .rejects.toMatchObject({ code: 'COMMAND_GRANT_REVOKED', statusCode: 410 });
    expect(store.snapshot().receipts).toHaveLength(0);
  });
});
