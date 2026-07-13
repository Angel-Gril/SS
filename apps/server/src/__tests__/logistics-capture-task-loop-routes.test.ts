import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  adminLogisticsCaptureTaskRoutes,
  logisticsCaptureTaskRoutes,
} from '../routes/logistics-capture-tasks.js';
import { CAPTURE_TASK_VERSION, type LogisticsCaptureScope } from '../services/logistics-capture-task.js';

const SCOPE: LogisticsCaptureScope = {
  tenantId: 'tenant-a',
  shopId: 'shop-a',
  companyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
};
const CLAIM_TOKEN = 'ct1.session-bound-token-0123456789012345';

function publicPendingTask() {
  return {
    id: 'task-a',
    version: CAPTURE_TASK_VERSION,
    kind: 'SELLER' as const,
    requestedByUserId: 'admin-a',
    scope: SCOPE,
    destination: null,
    officialFingerprint: null,
    expectedEndpoints: [
      'seller/template/by-location',
      'seller/provider-inventory',
    ],
    fingerprintChecksum: 'a'.repeat(64),
    claimToken: CLAIM_TOKEN,
    status: 'ISSUED' as const,
    claimedBySessionId: null,
    claimedAt: null,
    uploadedAt: null,
    reviewableAt: null,
    issuedAt: new Date('2026-07-12T10:00:00.000Z'),
    expiresAt: new Date('2026-07-12T10:10:00.000Z'),
    progress: { phase: 'waiting' as const, completed: false as const, percent: 0 as const },
  };
}

const deviceAuth = async (request: FastifyRequest) => {
  (request as any).device = {
    sessionId: 'session-a',
    ownerUserId: 'tenant-a',
    allowedShopIds: ['shop-a'],
  };
};
const adminAuth = async (request: FastifyRequest) => {
  (request as any).user = {
    actorUserId: 'admin-a',
    userId: 'tenant-a',
    isSuperAdmin: true,
  };
};

describe('logistics capture execution loop routes', () => {
  it('discovers pending tasks without nonce and uses the claim token for claim, upload and cancel', async () => {
    const pending = publicPendingTask();
    const service = {
      listPendingCaptureTasks: vi.fn(async () => [pending]),
      claimCaptureTask: vi.fn(async () => ({ ...pending, status: 'CLAIMED' })),
      submitCapture: vi.fn(async () => ({
        kind: 'created',
        candidateId: 'candidate-a',
        state: 'CAPTURED',
        duplicate: false,
        changedFromResponseChecksum: null,
        requiresReview: true,
      })),
      cancelCaptureTask: vi.fn(async () => ({ ...pending, status: 'CANCELLED' })),
    };
    const app = Fastify();
    await app.register(logisticsCaptureTaskRoutes, {
      service: service as never,
      authenticateCapture: deviceAuth,
    });

    const discovered = await app.inject({ method: 'GET', url: '/capture-tasks/pending' });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().data.tasks[0]).toMatchObject({
      id: 'task-a',
      claimToken: CLAIM_TOKEN,
      progress: { phase: 'waiting', percent: 0 },
    });
    expect(discovered.body).not.toContain('"nonce"');

    const proof = {
      taskVersion: CAPTURE_TASK_VERSION,
      claimToken: CLAIM_TOKEN,
      scope: SCOPE,
    };
    expect((await app.inject({
      method: 'POST',
      url: '/capture-tasks/task-a/claim',
      payload: proof,
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST',
      url: '/capture-tasks/task-a/upload',
      payload: { ...proof, payload: { schema: 'capture' } },
    })).statusCode).toBe(201);
    expect((await app.inject({
      method: 'POST',
      url: '/capture-tasks/task-a/cancel',
      payload: proof,
    })).statusCode).toBe(200);
    expect(service.cancelCaptureTask).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-a',
      claimToken: CLAIM_TOKEN,
      device: expect.objectContaining({ sessionId: 'session-a' }),
    }));

    const ambiguous = await app.inject({
      method: 'POST',
      url: '/capture-tasks/task-a/claim',
      payload: { ...proof, nonce: 'manual-nonce-0123456789abcdef' },
    });
    expect(ambiguous.statusCode).toBe(400);
    await app.close();
  });

  it('never exposes a task nonce or claim token from administrator issue endpoints', async () => {
    const { claimToken: _claimToken, progress: _progress, ...publicFields } = publicPendingTask();
    const issuedTask = {
      ...publicFields,
      nonce: 'server-only-random-nonce-0123456789abcdef',
    };
    const service = {
      issueSellerTask: vi.fn(async () => issuedTask),
      issueOfficialTask: vi.fn(async () => ({
        ...issuedTask,
        kind: 'OFFICIAL' as const,
        destination: { countryUid: 'russia', locationUid: 'moscow' },
      })),
    };
    const app = Fastify();
    await app.register(adminLogisticsCaptureTaskRoutes, {
      service: service as never,
      draftService: { createDraft: vi.fn() } as never,
      authenticateAccount: adminAuth,
      requireSuperAdminAccount: async () => undefined,
    });

    const seller = await app.inject({
      method: 'POST',
      url: '/capture-tasks/seller',
      payload: { scope: SCOPE, expectedEndpoints: publicFields.expectedEndpoints },
    });
    expect(seller.statusCode).toBe(201);
    expect(seller.body).not.toContain('nonce');
    expect(seller.body).not.toContain('claimToken');

    const official = await app.inject({
      method: 'POST',
      url: '/capture-tasks/official',
      payload: {
        scope: SCOPE,
        destination: { countryUid: 'russia', locationUid: 'moscow' },
        fingerprint: {
          originCountryUid: 'china',
          originCityUid: 'xiamen',
          destinationCountryUid: 'russia',
          destinationLocationUid: 'moscow',
          currency: 'CNY',
          declaredPriceMinor: '300000',
          weightGrams: '498',
          dimensionsMm: { length: '90', width: '160', height: '180' },
          batteryMode: 'UNSPECIFIED',
        },
      },
    });
    expect(official.statusCode).toBe(201);
    expect(official.body).not.toContain('nonce');
    expect(official.body).not.toContain('claimToken');
    await app.close();
  });

  it('lists and reads administrator task state without returning device proofs', async () => {
    const { claimToken: _claimToken, progress: _progress, ...base } = publicPendingTask();
    const task = {
      ...base,
      nonce: 'server-only-nonce-0123456789abcdef',
      claimToken: CLAIM_TOKEN,
      candidate: {
        candidateId: 'candidate-a',
        state: 'CAPTURED' as const,
        reviewStatus: 'PENDING_REVIEW' as const,
        responseChecksum: 'b'.repeat(64),
        reviewedAt: null,
      },
      progress: { phase: 'review' as const, completed: false, percent: 100 as const },
    };
    const service = {
      listCaptureTasks: vi.fn(async () => [task]),
      getCaptureTask: vi.fn(async () => task),
    };
    const app = Fastify();
    await app.register(adminLogisticsCaptureTaskRoutes, {
      service: service as never,
      draftService: { createDraft: vi.fn() } as never,
      authenticateAccount: adminAuth,
      requireSuperAdminAccount: async () => undefined,
    });

    const list = await app.inject({
      method: 'GET',
      url: '/capture-tasks?tenantId=tenant-a&shopId=shop-a&status=REVIEWABLE&limit=25',
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.tasks[0]).toMatchObject({
      id: 'task-a',
      candidate: { candidateId: 'candidate-a', reviewStatus: 'PENDING_REVIEW' },
      progress: { phase: 'review', percent: 100 },
    });
    expect(list.body).not.toContain('nonce');
    expect(list.body).not.toContain('claimToken');
    expect(service.listCaptureTasks).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      status: 'REVIEWABLE',
      limit: 25,
    });

    const detail = await app.inject({ method: 'GET', url: '/capture-tasks/task-a' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe('task-a');
    expect(detail.body).not.toContain('nonce');
    expect(detail.body).not.toContain('claimToken');
    expect(service.getCaptureTask).toHaveBeenCalledWith({ taskId: 'task-a' });
    await app.close();
  });

  it('allows only a super administrator to verify, reject and cancel tasks', async () => {
    const service = {
      issueSellerTask: vi.fn(),
      issueOfficialTask: vi.fn(),
      listReviewableCandidates: vi.fn(),
      getReviewableCandidate: vi.fn(),
      reviewCaptureCandidate: vi.fn(async (input) => ({
        candidateId: input.candidateId,
        reviewStatus: input.decision,
      })),
      cancelCaptureTaskAsAdmin: vi.fn(async () => ({
        ...publicPendingTask(),
        status: 'CANCELLED' as const,
      })),
    };
    const previewMatrix = vi.fn(async () => ({ requiredFingerprints: [{ fingerprintKey: 'fp-a' }] }));
    const createCandidateSet = vi.fn(async () => ({
      candidateSet: { id: 'candidate-set-a', contentChecksum: 'a'.repeat(64) },
      duplicate: false,
    }));
    const createDraft = vi.fn(async () => ({
      id: 'revision-a',
      candidateSetId: 'candidate-set-a',
    }));
    const draftService = {
      previewMatrix,
      createCandidateSet,
      createDraft,
    };
    const denied = Fastify();
    await denied.register(adminLogisticsCaptureTaskRoutes, {
      service: service as never,
      draftService: draftService as never,
      authenticateAccount: adminAuth,
      requireSuperAdminAccount: async (_request: FastifyRequest, reply: FastifyReply) =>
        reply.status(403).send({ code: 0, msg: 'forbidden' }),
    });
    expect((await denied.inject({
      method: 'POST',
      url: '/capture-tasks/reviewable/candidate-a/verify',
      payload: {},
    })).statusCode).toBe(403);
    expect(service.reviewCaptureCandidate).not.toHaveBeenCalled();
    await denied.close();

    const app = Fastify();
    await app.register(adminLogisticsCaptureTaskRoutes, {
      service: service as never,
      draftService: draftService as never,
      authenticateAccount: adminAuth,
      requireSuperAdminAccount: async () => undefined,
    });
    for (const [action, decision] of [
      ['verify', 'VERIFIED'],
      ['reject', 'REJECTED'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/capture-tasks/reviewable/candidate-a/' + action,
        payload: action === 'reject'
          ? { reason: 'incomplete evidence' }
          : { reason: 'scope and evidence verified' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.reviewStatus).toBe(decision);
    }
    expect(service.reviewCaptureCandidate).toHaveBeenNthCalledWith(1, {
      candidateId: 'candidate-a',
      actorUserId: 'admin-a',
      decision: 'VERIFIED',
      reason: 'scope and evidence verified',
    });
    expect(service.reviewCaptureCandidate).toHaveBeenNthCalledWith(2, {
      candidateId: 'candidate-a',
      actorUserId: 'admin-a',
      decision: 'REJECTED',
      reason: 'incomplete evidence',
    });
    expect((await app.inject({
      method: 'POST',
      url: '/capture-tasks/task-a/cancel',
      payload: {},
    })).statusCode).toBe(200);
    const matrixPayload = {
      sellerCandidateId: 'seller-candidate',
      assignmentId: 'assignment-a',
      selectedServiceKeys: ['service-a'],
      baseProduct: {
        declaredPriceMinor: '300000',
        weightGrams: '498',
        dimensionsMm: { length: '90', width: '160', height: '180' },
        batteryMode: 'NONE',
      },
    };
    const preview = await app.inject({
      method: 'POST',
      url: '/capture-tasks/matrix-preview',
      payload: matrixPayload,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.requiredFingerprints).toHaveLength(1);
    expect(previewMatrix).toHaveBeenCalledWith({
      actorUserId: 'admin-a',
      ...matrixPayload,
    });

    const frozen = await app.inject({
      method: 'POST',
      url: '/capture-tasks/candidate-sets',
      payload: {
        ...matrixPayload,
        defaultServiceKeys: ['service-a'],
      },
    });
    expect(frozen.statusCode).toBe(201);
    expect(frozen.json().data).toMatchObject({
      candidateSet: { id: 'candidate-set-a' },
      duplicate: false,
    });
    expect(createCandidateSet).toHaveBeenCalledWith({
      actorUserId: 'admin-a',
      ...matrixPayload,
      defaultServiceKeys: ['service-a'],
    });

    const draft = await app.inject({
      method: 'POST',
      url: '/capture-tasks/drafts',
      payload: { candidateSetId: 'candidate-set-a' },
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().data).toEqual({
      id: 'revision-a',
      candidateSetId: 'candidate-set-a',
    });
    expect(createDraft).toHaveBeenCalledWith({
      actorUserId: 'admin-a',
      candidateSetId: 'candidate-set-a',
    });
    expect((await app.inject({
      method: 'POST',
      url: '/capture-tasks/drafts',
      payload: {
        candidateSetId: 'candidate-set-a',
        channelId: 'channel-a',
      },
    })).statusCode).toBe(400);
    await app.close();
  });
});
