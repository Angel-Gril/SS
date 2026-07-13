import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  adminLogisticsCaptureTaskRoutes,
  logisticsCaptureTaskRoutes,
} from '../routes/logistics-capture-tasks.js';
import {
  CAPTURE_TASK_VERSION,
  LogisticsCaptureTaskError,
  type LogisticsCaptureScope,
} from '../services/logistics-capture-task.js';

const SCOPE: LogisticsCaptureScope = {
  tenantId: 'tenant-a',
  shopId: 'shop-a',
  companyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
};

function captureTask() {
  return {
    id: 'task-1',
    version: CAPTURE_TASK_VERSION,
    kind: 'SELLER' as const,
    requestedByUserId: 'admin-1',
    scope: structuredClone(SCOPE),
    destination: null,
    officialFingerprint: null,
    expectedEndpoints: ['seller/template/by-location'],
    fingerprintChecksum: 'a'.repeat(64),
    nonce: 'capture-nonce-0123456789abcdef',
    status: 'ISSUED' as const,
    claimedBySessionId: null,
    claimedAt: null,
    uploadedAt: null,
    reviewableAt: null,
    issuedAt: new Date('2026-07-12T10:00:00.000Z'),
    expiresAt: new Date('2026-07-12T10:10:00.000Z'),
  };
}

function captureService() {
  return {
    issueSellerTask: vi.fn(async () => captureTask()),
    issueOfficialTask: vi.fn(async () => captureTask()),
    claimCaptureTask: vi.fn(async () => ({
      ...captureTask(),
      status: 'CLAIMED' as const,
      claimedBySessionId: 'session-a',
      claimedAt: new Date('2026-07-12T10:01:00.000Z'),
    })),
    submitCapture: vi.fn(async () => ({
      kind: 'created' as const,
      candidateId: 'candidate-1',
      state: 'CAPTURED' as const,
      duplicate: false,
      changedFromResponseChecksum: null,
      requiresReview: true,
    })),
    listReviewableCandidates: vi.fn(async () => [{
      candidateId: 'candidate-1',
      taskId: 'task-1',
      taskKind: 'SELLER',
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      companyId: 'company-a',
      warehouseId: 'warehouse-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      destination: null,
      state: 'CAPTURED',
      reviewStatus: 'PENDING_REVIEW',
      responseChecksum: 'b'.repeat(64),
      previousResponseChecksum: null,
      receivedAt: '2026-07-12T10:02:00.000Z',
    }]),
    getReviewableCandidate: vi.fn(async () => ({
      candidateId: 'candidate-1',
      taskId: 'task-1',
      taskKind: 'SELLER',
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      companyId: 'company-a',
      warehouseId: 'warehouse-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      destination: null,
      state: 'CAPTURED',
      reviewStatus: 'PENDING_REVIEW',
      responseChecksum: 'b'.repeat(64),
      previousResponseChecksum: null,
      receivedAt: '2026-07-12T10:02:00.000Z',
      normalizedPayload: { schema: 'ozon-seller-logistics-capture/v1' },
    })),
  };
}

const accountAuth = async (request: FastifyRequest) => {
  (request as any).user = {
    userId: 'effective-owner-1',
    actorUserId: 'admin-1',
    isSuperAdmin: true,
  };
};
const deviceAuth = async (request: FastifyRequest) => {
  (request as any).device = {
    sessionId: 'session-a',
    ownerUserId: 'tenant-a',
    allowedShopIds: ['shop-a'],
    deploymentId: 'local-dev',
  };
};

describe('logistics capture task routes', () => {
  it('lets a super administrator issue Seller tasks and list reviewable uploads', async () => {
    const service = captureService();
    const app = Fastify();
    await app.register(adminLogisticsCaptureTaskRoutes, {
      service: service as never,
      draftService: { createDraft: vi.fn() } as never,
      authenticateAccount: accountAuth,
      requireSuperAdminAccount: async () => undefined,
    });

    const issue = await app.inject({
      method: 'POST',
      url: '/capture-tasks/seller',
      payload: { scope: SCOPE, expectedEndpoints: ['seller/template/by-location'] },
    });
    expect(issue.statusCode).toBe(201);
    expect(issue.json().data).toMatchObject({ id: 'task-1', status: 'ISSUED' });
    expect(service.issueSellerTask).toHaveBeenCalledWith({
      requestedByUserId: 'admin-1',
      scope: SCOPE,
      expectedEndpoints: ['seller/template/by-location'],
    });

    const reviewable = await app.inject({
      method: 'GET',
      url: '/capture-tasks/reviewable?tenantId=tenant-a&shopId=shop-a',
    });
    expect(reviewable.statusCode).toBe(200);
    expect(reviewable.json().data.candidates).toHaveLength(1);
    expect(service.listReviewableCandidates).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      limit: 100,
    });
    const detail = await app.inject({
      method: 'GET',
      url: '/capture-tasks/reviewable/candidate-1',
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.normalizedPayload.schema).toBe('ozon-seller-logistics-capture/v1');
    await app.close();
  });

  it('binds claim and upload to the live device tenant, shop grant, and session', async () => {
    const service = captureService();
    const app = Fastify();
    await app.register(logisticsCaptureTaskRoutes, {
      service: service as never,
      authenticateCapture: deviceAuth,
    });
    const proof = {
      taskVersion: CAPTURE_TASK_VERSION,
      nonce: 'capture-nonce-0123456789abcdef',
      scope: SCOPE,
    };

    expect((await app.inject({
      method: 'POST', url: '/capture-tasks/task-1/claim', payload: proof,
    })).statusCode).toBe(200);
    expect(service.claimCaptureTask).toHaveBeenCalledWith({
      taskId: 'task-1',
      ...proof,
      device: {
        sessionId: 'session-a',
        ownerUserId: 'tenant-a',
        allowedShopIds: ['shop-a'],
      },
    });

    const upload = await app.inject({
      method: 'POST',
      url: '/capture-tasks/task-1/upload',
      payload: {
        ...proof,
        payload: {
          schema: 'ozon-seller-logistics-capture/v1',
          capturedAt: '2026-07-12T10:02:00.000Z',
          responseChecksum: 'c'.repeat(64),
          endpointBatch: {
            expected: ['seller/template/by-location'],
            attempted: ['seller/template/by-location'],
            succeeded: ['seller/template/by-location'],
            failed: [],
            empty: [],
          },
          services: [],
        },
      },
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().data).toMatchObject({ candidateId: 'candidate-1', requiresReview: true });
    expect(service.submitCapture).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      deviceSessionId: 'session-a',
      deviceOwnerUserId: 'tenant-a',
      allowedShopIds: ['shop-a'],
    }));
    await app.close();
  });

  it('returns non-enumerating 404 before service access for foreign scope', async () => {
    const service = captureService();
    const app = Fastify();
    await app.register(logisticsCaptureTaskRoutes, {
      service: service as never,
      authenticateCapture: deviceAuth,
    });
    for (const scope of [{ ...SCOPE, tenantId: 'tenant-b' }, { ...SCOPE, shopId: 'shop-b' }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/capture-tasks/foreign-task/claim',
        payload: {
          taskVersion: CAPTURE_TASK_VERSION,
          nonce: 'capture-nonce-0123456789abcdef',
          scope,
        },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('CAPTURE_TASK_MISMATCH');
    }
    expect(service.claimCaptureTask).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps credential rejection to one sanitized public error', async () => {
    const service = captureService();
    service.submitCapture.mockRejectedValueOnce(new LogisticsCaptureTaskError(
      'CREDENTIAL_FIELDS_FORBIDDEN', 400, 'Credential-bearing capture fields are forbidden',
    ));
    const app = Fastify();
    await app.register(logisticsCaptureTaskRoutes, {
      service: service as never,
      authenticateCapture: deviceAuth,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/capture-tasks/task-1/upload',
      payload: {
        taskVersion: CAPTURE_TASK_VERSION,
        nonce: 'capture-nonce-0123456789abcdef',
        scope: SCOPE,
        payload: { authorization: 'must-never-be-returned' },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 0,
      msg: 'Capture payload rejected',
      error: { code: 'CREDENTIAL_FIELDS_FORBIDDEN' },
    });
    expect(response.body).not.toContain('must-never-be-returned');
    await app.close();
  });
});
