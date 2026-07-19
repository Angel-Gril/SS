import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiImageSuitePreparationLeaseError,
  aiImageSuitePreparationLeaseKey,
  createRedisAiImageSuitePreparationLease,
  type AiImageSuitePreparationLeaseRedis,
} from '../services/ai-image-suite-preparation-lease.js';
import {
  createAiImageSuiteReferenceService,
  type AiImageSuiteReferenceRepository,
} from '../services/ai-image-suite-references.js';

function redisFixture(overrides: Partial<AiImageSuitePreparationLeaseRedis> = {}) {
  const redis: AiImageSuitePreparationLeaseRedis = {
    set: vi.fn(async () => 'OK'),
    eval: vi.fn(async (script) => script.includes("redis.call('del'") ? 1 : 1),
    ping: vi.fn(async () => 'PONG'),
    ...overrides,
  };
  return redis;
}

function lease(
  redis: AiImageSuitePreparationLeaseRedis,
  overrides: Partial<Parameters<typeof createRedisAiImageSuitePreparationLease>[0]> = {},
) {
  return createRedisAiImageSuitePreparationLease({
    redis,
    ttlMs: 10_000,
    heartbeatMs: 2_000,
    probeTimeoutMs: 100,
    createToken: () => 'lease-token-1',
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AI image suite preparation Redis lease', () => {
  it('acquires with a bounded expiry, renews ownership, and releases only its token', async () => {
    const redis = redisFixture();
    const coordinator = lease(redis);

    const scope = { ownerUserId: 'owner-1', suiteId: 'suite-1' };
    const result = await coordinator.runExclusive(scope, async (guard) => {
      await guard.ensureOwned();
      return 'complete';
    });

    const key = aiImageSuitePreparationLeaseKey(scope);
    expect(result).toBe('complete');
    expect(redis.set).toHaveBeenCalledWith(key, 'lease-token-1', 'PX', 10_000, 'NX');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('pexpire', KEYS[1], ARGV[2])"),
      1,
      key,
      'lease-token-1',
      10_000,
    );
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("redis.call('del', KEYS[1])"),
      1,
      key,
      'lease-token-1',
    );
  });

  it('rejects a concurrent distinct operation before it starts expensive work', async () => {
    let owner: string | null = null;
    const redis = redisFixture({
      set: vi.fn(async (_key, token) => {
        if (owner) return null;
        owner = token;
        return 'OK';
      }),
      eval: vi.fn(async (script, _keyCount, _key, token) => {
        if (script.includes("redis.call('del'")) {
          if (owner !== token) return 0;
          owner = null;
          return 1;
        }
        return owner === token ? 1 : 0;
      }),
    });
    const coordinator = lease(redis);
    let finishFirst: (() => void) | undefined;
    const firstWork = vi.fn(async () => await new Promise<void>((resolve) => {
      finishFirst = resolve;
    }));
    const secondWork = vi.fn(async () => undefined);

    const scope = { ownerUserId: 'owner-1', suiteId: 'suite-1' };
    const first = coordinator.runExclusive(scope, firstWork);
    await vi.waitFor(() => expect(firstWork).toHaveBeenCalledOnce());
    await expect(coordinator.runExclusive(scope, secondWork)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PREPARATION_LEASE_BUSY',
    });
    expect(secondWork).not.toHaveBeenCalled();
    finishFirst?.();
    await expect(first).resolves.toBeUndefined();
  });

  it('scopes identical suite ids by owner so another tenant cannot contend or observe busy state', async () => {
    const owners = new Map<string, string>();
    const redis = redisFixture({
      set: vi.fn(async (key, token) => {
        if (owners.has(key)) return null;
        owners.set(key, token);
        return 'OK';
      }),
      eval: vi.fn(async (script, _keyCount, key, token) => {
        if (owners.get(key) !== token) return 0;
        if (script.includes("redis.call('del'")) owners.delete(key);
        return 1;
      }),
    });
    const coordinator = lease(redis);
    let finishOwnerOne: (() => void) | undefined;
    const ownerOne = coordinator.runExclusive({ ownerUserId: 'owner-1', suiteId: 'suite-1' }, async () => (
      await new Promise<void>((resolve) => { finishOwnerOne = resolve; })
    ));
    await vi.waitFor(() => expect(finishOwnerOne).toBeTypeOf('function'));

    await expect(coordinator.runExclusive(
      { ownerUserId: 'owner-2', suiteId: 'suite-1' },
      async () => 'not-found-authority-can-be-checked',
    )).resolves.toBe('not-found-authority-can-be-checked');
    expect(aiImageSuitePreparationLeaseKey({ ownerUserId: 'owner-1', suiteId: 'suite-1' }))
      .not.toBe(aiImageSuitePreparationLeaseKey({ ownerUserId: 'owner-2', suiteId: 'suite-1' }));
    finishOwnerOne?.();
    await ownerOne;
  });

  it('renews a long preparation in the background', async () => {
    vi.useFakeTimers();
    const redis = redisFixture();
    const coordinator = lease(redis);
    let finish: (() => void) | undefined;
    const running = coordinator.runExclusive({ ownerUserId: 'owner-1', suiteId: 'suite-1' }, async () => (
      await new Promise<void>((resolve) => { finish = resolve; })
    ));
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('pexpire', KEYS[1], ARGV[2])"),
      1,
      expect.any(String),
      'lease-token-1',
      10_000,
    );
    finish?.();
    await expect(running).resolves.toBeUndefined();
  });

  it('detects ownership loss and never deletes another token', async () => {
    const redis = redisFixture({
      eval: vi.fn(async () => 0),
    });

    await expect(lease(redis).runExclusive({ ownerUserId: 'owner-1', suiteId: 'suite-1' }, async (guard) => {
      await guard.ensureOwned();
    })).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PREPARATION_LEASE_LOST',
    });
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("redis.call('del', KEYS[1])"),
      1,
      expect.any(String),
      'lease-token-1',
    );
  });

  it('preserves falsy callback rejections instead of returning success', async () => {
    await expect(lease(redisFixture()).runExclusive(
      { ownerUserId: 'owner-1', suiteId: 'suite-1' },
      async () => await Promise.reject(undefined),
    )).rejects.toBeUndefined();
  });

  it('recovers after an abandoned owner expires', async () => {
    let now = 0;
    let owner: string | null = 'abandoned-token';
    let expiresAt = 10_000;
    const redis = redisFixture({
      set: vi.fn(async (_key, token, _mode, ttlMs) => {
        if (owner && expiresAt > now) return null;
        owner = token;
        expiresAt = now + ttlMs;
        return 'OK';
      }),
      eval: vi.fn(async (script, _keyCount, _key, token, ttlMs) => {
        if (owner !== token || expiresAt <= now) return 0;
        if (script.includes("redis.call('del'")) {
          owner = null;
          return 1;
        }
        expiresAt = now + Number(ttlMs);
        return 1;
      }),
    });
    const coordinator = lease(redis);

    const scope = { ownerUserId: 'owner-1', suiteId: 'suite-1' };
    await expect(coordinator.runExclusive(scope, async () => undefined)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PREPARATION_LEASE_BUSY',
    });
    now = 10_001;
    await expect(coordinator.runExclusive(scope, async () => 'recovered')).resolves.toBe('recovered');
  });

  it('fails closed when Redis is disabled or unavailable and bounds readiness probes', async () => {
    const disabledRedis = redisFixture();
    const disabled = lease(disabledRedis, { disabled: true });
    const scope = { ownerUserId: 'owner-1', suiteId: 'suite-1' };
    await expect(disabled.runExclusive(scope, async () => undefined)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PREPARATION_LEASE_UNAVAILABLE',
    });
    expect(disabledRedis.set).not.toHaveBeenCalled();
    await expect(disabled.isReady()).resolves.toBe(false);

    const unavailable = lease(redisFixture({
      set: vi.fn(async () => { throw new Error('connection refused'); }),
    }));
    await expect(unavailable.runExclusive(scope, async () => undefined)).rejects.toEqual(
      expect.objectContaining<Partial<AiImageSuitePreparationLeaseError>>({
        code: 'AI_MEDIA_SUITE_PREPARATION_LEASE_UNAVAILABLE',
      }),
    );

    vi.useFakeTimers();
    const timedOutAcquire = lease(redisFixture({
      set: vi.fn(async () => await new Promise(() => undefined)),
    }), { commandTimeoutMs: 100 });
    const acquisition = timedOutAcquire.runExclusive(scope, async () => undefined);
    const acquisitionResult = expect(acquisition).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PREPARATION_LEASE_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(100);
    await acquisitionResult;

    const timedOutRenewal = lease(redisFixture({
      eval: vi.fn(async (script) => {
        if (script.includes("redis.call('del'")) return 1;
        return await new Promise(() => undefined);
      }),
    }), { commandTimeoutMs: 100 });
    const renewal = timedOutRenewal.runExclusive(scope, async (guard) => {
      await guard.ensureOwned();
    });
    const renewalResult = expect(renewal).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PREPARATION_LEASE_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(100);
    await renewalResult;

    const hanging = lease(redisFixture({ ping: vi.fn(async () => await new Promise(() => undefined)) }));
    const readiness = hanging.isReady();
    await vi.advanceTimersByTimeAsync(100);
    await expect(readiness).resolves.toBe(false);
  });
});

describe('AI image suite reference preparation lease boundary', () => {
  it.each([
    ['AI_MEDIA_SUITE_PREPARATION_LEASE_BUSY', 'AI_MEDIA_SUITE_REFERENCE_PREPARATION_BUSY', 409],
    ['AI_MEDIA_SUITE_PREPARATION_LEASE_UNAVAILABLE', 'AI_MEDIA_SUITE_REFERENCE_PREPARATION_UNAVAILABLE', 503],
    ['AI_MEDIA_SUITE_PREPARATION_LEASE_LOST', 'AI_MEDIA_SUITE_REFERENCE_PREPARATION_UNAVAILABLE', 503],
  ] as const)('maps %s without reading suite authority', async (leaseCode, publicCode, statusCode) => {
    const repository = {
      findCommitReplay: vi.fn(),
      loadAuthority: vi.fn(),
      findReusableAssets: vi.fn(),
      createAsset: vi.fn(),
      commitBindings: vi.fn(),
    } as unknown as AiImageSuiteReferenceRepository;
    const service = createAiImageSuiteReferenceService({
      repository,
      preparationLease: {
        async runExclusive() {
          throw new AiImageSuitePreparationLeaseError(leaseCode, 'lease failure');
        },
        async isReady() { return false; },
      },
      getStorage: vi.fn(),
    });

    await expect(service.internalize({
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: 1,
      operationKey: 'operation-1',
    })).rejects.toMatchObject({ code: publicCode, statusCode });
    expect(repository.findCommitReplay).not.toHaveBeenCalled();
  });
});
