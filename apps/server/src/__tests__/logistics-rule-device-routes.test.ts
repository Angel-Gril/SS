import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const DEVICE = {
  sessionId: 'device-session-a',
  ownerUserId: 'tenant-a',
  actorUserId: 'tenant-a',
  deviceId: 'device-a',
  scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
  allowedShopIds: ['shop-a'],
};

describe('logistics rule device routes', () => {
  it('discovers only assignments authorized for the live device session', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => [{
        assignmentId: 'assignment-a',
        shopId: 'shop-a',
        shopName: 'Xiamen pilot',
        companyId: 'company-a',
        warehouseId: 'warehouse-a',
        warehouseName: 'Xiamen warehouse',
        originCountryUid: 'china',
        originCityUid: 'xiamen',
        originLabel: 'China / Xiamen',
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        destinationLabel: 'Russia / Moscow',
        releaseSequence: 3,
      }]),
    };
    const authenticateDiscover = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover,
      authenticateRead: authenticateDiscover,
      authenticateReceipt: authenticateDiscover,
      deploymentId: 'local-test',
    } as any);

    const response = await app.inject({ method: 'GET', url: '/assignments' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: 1,
      msg: 'ok',
      data: {
        assignments: [{
          assignmentId: 'assignment-a',
          shopId: 'shop-a',
          shopName: 'Xiamen pilot',
          companyId: 'company-a',
          warehouseId: 'warehouse-a',
          warehouseName: 'Xiamen warehouse',
          originCountryUid: 'china',
          originCityUid: 'xiamen',
          originLabel: 'China / Xiamen',
          destinationCountryUid: 'russia',
          destinationLocationUid: 'moscow',
          destinationLabel: 'Russia / Moscow',
          releaseSequence: 3,
        }],
      },
    });
    expect(authenticateDiscover).toHaveBeenCalledTimes(1);
    expect(repository.listAssignmentsForDevice).toHaveBeenCalledWith({
      sessionId: 'device-session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
    });
  });

  it('serves one immutable scoped release with a private scope-bound ETag', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const now = new Date('2026-07-12T10:00:00.000Z');
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => []),
      getEffectiveReleaseForDevice: vi.fn(async () => ({
        state: 'allowed' as const,
        assignmentId: 'assignment-a',
        scopeKey: 'tenant-a/shop-a/warehouse-a/xiamen/russia/moscow/v1',
        releaseId: 'release-3',
        releaseSequence: 3,
        contentChecksum: 'a'.repeat(64),
        effectiveChecksum: 'b'.repeat(64),
        minExtensionVersion: '1.0.0',
        validUntil: '2026-07-19T10:00:00.000Z',
        staleUntil: '2026-07-20T10:00:00.000Z',
        bundle: {
          schema: 'ozon-logistics-release/v1',
          selectedServiceKeys: ['service-a'],
        },
      })),
      authorizeEffectiveReleaseDelivery: vi.fn(async () => ({
        state: 'allowed' as const,
        authorizationValidUntil: '2026-07-13T10:00:00.000Z',
      })),
    };
    const authenticateRead = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover: authenticateRead,
      authenticateRead,
      authenticateReceipt: authenticateRead,
      deploymentId: 'local-test',
      now: () => now,
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: '/assignments/assignment-a/effective',
      headers: { 'x-ss-erp-extension-version': '1.2.0' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.vary).toContain('Authorization');
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        deploymentId: 'local-test',
        assignmentId: 'assignment-a',
        releaseId: 'release-3',
        releaseSequence: 3,
        contentChecksum: 'a'.repeat(64),
        effectiveChecksum: 'b'.repeat(64),
        minExtensionVersion: '1.0.0',
        serverTime: now.toISOString(),
        authorizationValidUntil: '2026-07-13T10:00:00.000Z',
        bundle: {
          schema: 'ozon-logistics-release/v1',
          selectedServiceKeys: ['service-a'],
        },
      },
    });
    expect(repository.getEffectiveReleaseForDevice).toHaveBeenCalledWith({
      sessionId: 'device-session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
      assignmentId: 'assignment-a',
      now,
    });
    expect(repository.authorizeEffectiveReleaseDelivery).toHaveBeenCalledWith({
      sessionId: 'device-session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
      assignmentId: 'assignment-a',
      releaseId: 'release-3',
      effectiveChecksum: 'b'.repeat(64),
      scopeKey: 'tenant-a/shop-a/warehouse-a/xiamen/russia/moscow/v1',
      now,
    });
  });

  it('authenticates before returning 304 and renews only the server lease metadata', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const now = new Date('2026-07-12T11:00:00.000Z');
    const authorizationValidUntil = '2026-07-13T11:00:00.000Z';
    const effective = {
      state: 'allowed' as const,
      assignmentId: 'assignment-a',
      scopeKey: 'tenant-a/shop-a/warehouse-a/xiamen/russia/moscow/v1',
      releaseId: 'release-3',
      releaseSequence: 3,
      contentChecksum: 'a'.repeat(64),
      effectiveChecksum: 'b'.repeat(64),
      minExtensionVersion: '1.0.0',
      validUntil: '2026-07-19T10:00:00.000Z',
      staleUntil: '2026-07-20T10:00:00.000Z',
      bundle: { schema: 'ozon-logistics-release/v1', selectedServiceKeys: ['service-a'] },
    };
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => []),
      getEffectiveReleaseForDevice: vi.fn(async () => effective),
      authorizeEffectiveReleaseDelivery: vi.fn(async () => ({
        state: 'allowed' as const,
        authorizationValidUntil,
      })),
    };
    const authenticateRead = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover: authenticateRead,
      authenticateRead,
      authenticateReceipt: authenticateRead,
      deploymentId: 'local-test',
      now: () => now,
    } as any);

    const first = await app.inject({
      method: 'GET',
      url: '/assignments/assignment-a/effective',
      headers: { 'x-ss-erp-extension-version': '1.2.0' },
    });
    const conditional = await app.inject({
      method: 'GET',
      url: '/assignments/assignment-a/effective',
      headers: {
        'x-ss-erp-extension-version': '1.2.0',
        'if-none-match': String(first.headers.etag),
      },
    });

    expect(first.statusCode).toBe(200);
    expect(conditional.statusCode).toBe(304);
    expect(conditional.body).toBe('');
    expect(conditional.headers.etag).toBe(first.headers.etag);
    expect(conditional.headers['cache-control']).toBe('private, no-store');
    expect(conditional.headers.vary).toContain('Authorization');
    expect(conditional.headers['x-ss-erp-server-time']).toBe(now.toISOString());
    expect(conditional.headers['x-ss-erp-authorization-valid-until'])
      .toBe(authorizationValidUntil);
    expect(authenticateRead).toHaveBeenCalledTimes(2);
    expect(repository.authorizeEffectiveReleaseDelivery).toHaveBeenCalledTimes(2);
    expect(repository.getEffectiveReleaseForDevice).toHaveBeenCalledTimes(2);
  });

  it('returns upgrade_required instead of an incompatible bundle', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const now = new Date('2026-07-12T11:00:00.000Z');
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => []),
      getEffectiveReleaseForDevice: vi.fn(async () => ({
        state: 'allowed' as const,
        assignmentId: 'assignment-a',
        scopeKey: 'tenant-a/shop-a/warehouse-a/xiamen/russia/moscow/v1',
        releaseId: 'release-3',
        releaseSequence: 3,
        contentChecksum: 'a'.repeat(64),
        effectiveChecksum: 'b'.repeat(64),
        minExtensionVersion: '2.0.0',
        validUntil: '2026-07-19T10:00:00.000Z',
        staleUntil: '2026-07-20T10:00:00.000Z',
        bundle: { schema: 'ozon-logistics-release/v1', selectedServiceKeys: ['service-a'] },
      })),
      authorizeEffectiveReleaseDelivery: vi.fn(),
    };
    const authenticateRead = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover: authenticateRead,
      authenticateRead,
      authenticateReceipt: authenticateRead,
      deploymentId: 'local-test',
      now: () => now,
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: '/assignments/assignment-a/effective',
      headers: { 'x-ss-erp-extension-version': '1.9.9' },
    });

    expect(response.statusCode).toBe(426);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'upgrade_required',
      msg: '扩展版本过低，请先更新',
      data: { minExtensionVersion: '2.0.0' },
    });
    expect(response.body).not.toContain('selectedServiceKeys');
    expect(repository.authorizeEffectiveReleaseDelivery).not.toHaveBeenCalled();
  });

  it('records a scope-bound idempotent apply receipt through receipt authentication', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const now = new Date('2026-07-12T12:00:00.000Z');
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => []),
      getEffectiveReleaseForDevice: vi.fn(),
      recordApplyReceipt: vi.fn(async () => ({
        state: 'accepted' as const,
        receiptId: 'receipt-a',
        duplicate: false,
      })),
    };
    const authenticateReceipt = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover: authenticateReceipt,
      authenticateRead: authenticateReceipt,
      authenticateReceipt,
      deploymentId: 'local-test',
      now: () => now,
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/assignments/assignment-a/releases/release-3/receipts',
      payload: {
        idempotencyKey: 'receipt-key-0001',
        effectiveChecksum: 'b'.repeat(64),
        status: 'applied',
        extensionVersion: '1.2.0',
        appliedAt: '2026-07-12T11:59:59.000Z',
      },
    });
    repository.recordApplyReceipt.mockResolvedValueOnce({
      state: 'accepted' as const,
      receiptId: 'receipt-a',
      duplicate: true,
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/assignments/assignment-a/releases/release-3/receipts',
      payload: {
        idempotencyKey: 'receipt-key-0001',
        effectiveChecksum: 'b'.repeat(64),
        status: 'applied',
        extensionVersion: '1.2.0',
        appliedAt: '2026-07-12T11:59:59.000Z',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      code: 1,
      msg: '应用回执已记录',
      data: { receiptId: 'receipt-a', duplicate: false },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().data).toEqual({ receiptId: 'receipt-a', duplicate: true });
    expect(authenticateReceipt).toHaveBeenCalledTimes(2);
    expect(repository.recordApplyReceipt).toHaveBeenCalledWith({
      sessionId: 'device-session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
      assignmentId: 'assignment-a',
      releaseId: 'release-3',
      idempotencyKey: 'receipt-key-0001',
      effectiveChecksum: 'b'.repeat(64),
      status: 'APPLIED',
      failureCode: null,
      extensionVersion: '1.2.0',
      appliedAt: new Date('2026-07-12T11:59:59.000Z'),
      now,
    });
  });

  it('rejects receipt idempotency keys shorter than 16 characters before repository access', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => []),
      getEffectiveReleaseForDevice: vi.fn(),
      authorizeEffectiveReleaseDelivery: vi.fn(),
      recordApplyReceipt: vi.fn(),
    };
    const authenticateReceipt = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover: authenticateReceipt,
      authenticateRead: authenticateReceipt,
      authenticateReceipt,
      deploymentId: 'local-test',
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/assignments/assignment-a/releases/release-3/receipts',
      payload: {
        idempotencyKey: '123456789012',
        effectiveChecksum: 'b'.repeat(64),
        status: 'applied',
        extensionVersion: '1.2.0',
        appliedAt: '2026-07-12T11:59:59.000Z',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'invalid_request',
      msg: '参数错误',
    });
    expect(repository.recordApplyReceipt).not.toHaveBeenCalled();
  });

  it('accepts only a fixed sanitized failure code for failed apply receipts', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const now = new Date('2026-07-12T12:00:00.000Z');
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => []),
      getEffectiveReleaseForDevice: vi.fn(),
      recordApplyReceipt: vi.fn(async () => ({
        state: 'accepted' as const,
        receiptId: 'receipt-failed',
        duplicate: false,
      })),
    };
    const authenticateReceipt = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover: authenticateReceipt,
      authenticateRead: authenticateReceipt,
      authenticateReceipt,
      deploymentId: 'local-test',
      now: () => now,
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/assignments/assignment-a/releases/release-3/receipts',
      payload: {
        idempotencyKey: 'receipt-key-failed-0001',
        effectiveChecksum: 'b'.repeat(64),
        status: 'failed',
        failureCode: 'checksum_mismatch',
        extensionVersion: '1.2.0',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(repository.recordApplyReceipt).toHaveBeenCalledWith({
      sessionId: 'device-session-a',
      ownerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
      assignmentId: 'assignment-a',
      releaseId: 'release-3',
      idempotencyKey: 'receipt-key-failed-0001',
      effectiveChecksum: 'b'.repeat(64),
      status: 'FAILED',
      failureCode: 'checksum_mismatch',
      extensionVersion: '1.2.0',
      appliedAt: null,
      now,
    });
  });

  it('maps a conflicting idempotency payload to a fixed 409 without leaking internals', async () => {
    const { logisticsRuleRoutes } = await import('../routes/logistics-rules.js');
    const conflict = Object.assign(new Error('SQL constraint secret detail'), {
      code: 'RECEIPT_CONFLICT',
      statusCode: 409,
    });
    const repository = {
      listAssignmentsForDevice: vi.fn(async () => []),
      getEffectiveReleaseForDevice: vi.fn(),
      authorizeEffectiveReleaseDelivery: vi.fn(),
      recordApplyReceipt: vi.fn(async () => { throw conflict; }),
    };
    const authenticateReceipt = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = DEVICE;
    });
    const app = Fastify();
    await app.register(logisticsRuleRoutes, {
      repository,
      authenticateDiscover: authenticateReceipt,
      authenticateRead: authenticateReceipt,
      authenticateReceipt,
      deploymentId: 'local-test',
    } as any);

    const response = await app.inject({
      method: 'POST',
      url: '/assignments/assignment-a/releases/release-3/receipts',
      payload: {
        idempotencyKey: 'receipt-key-conflict-0001',
        effectiveChecksum: 'b'.repeat(64),
        status: 'failed',
        failureCode: 'apply_failed',
        extensionVersion: '1.2.0',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'receipt_conflict',
      msg: '应用回执与已有记录冲突',
    });
    expect(response.body).not.toContain('SQL constraint secret detail');
  });
});
