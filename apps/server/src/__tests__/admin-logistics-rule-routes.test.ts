import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminLogisticsRuleRoutes } from '../routes/admin-logistics-rules.js';
import { LogisticsRuleAdminServiceError } from '../services/logistics-rule-admin.js';

function adminService() {
  return {
    readWorkspace: vi.fn(async () => ({ channel: { id: 'channel-1' } })),
    suggestMethodBinding: vi.fn(async () => ({ id: 'binding-1', status: 'SUGGESTED' })),
    reviewMethodBinding: vi.fn(async () => ({ id: 'binding-1', status: 'CONFIRMED' })),
    suggestOfficialResolution: vi.fn(async () => ({ id: 'resolution-1', status: 'SUGGESTED' })),
    reviewOfficialResolution: vi.fn(async () => ({ id: 'resolution-1', status: 'CONFIRMED' })),
    listOfficialCountries: vi.fn(async () => ({ kind: 'countries', records: [] })),
    listOfficialCities: vi.fn(async () => ({ kind: 'cities', records: [] })),
    listOfficialDestinations: vi.fn(async () => ({ kind: 'destinations', records: [] })),
    importDraft: vi.fn(async () => ({ id: 'revision-1', validationStatus: 'DRAFT' })),
    readDraft: vi.fn(async () => ({ id: 'revision-1', validationStatus: 'DRAFT' })),
    diffDraft: vi.fn(async () => ({
      revisionId: 'revision-1',
      added: [],
      changed: [],
      removed: [],
    })),
    preflightDraft: vi.fn(async () => ({
      status: 'BLOCKED' as const,
      revisionId: 'revision-1',
      channelId: 'channel-1',
      report: {
        source: 'server-derived' as const,
        blockers: [{ code: 'official_branch_uncovered' }],
        warnings: [],
      },
    })),
    publishDraft: vi.fn(async () => ({ id: 'release-1', sequence: 1 })),
    rollbackRelease: vi.fn(async () => ({ id: 'release-2', sequence: 2, releaseKind: 'ROLLBACK' })),
    retireChannel: vi.fn(async () => ({ channelId: 'channel-1' })),
    readChannelReceipts: vi.fn(async () => ({ channelId: 'channel-1', records: [] })),
  };
}

async function appFor(role: 'anonymous' | 'admin' | 'super-admin', service = adminService()) {
  const app = Fastify();
  const authenticateAccount = vi.fn(async (request: FastifyRequest, reply: FastifyReply) => {
    if (role === 'anonymous') return reply.status(401).send({ code: 0, msg: 'not authenticated' });
    (request as any).user = {
      userId: 'effective-owner-1',
      actorUserId: role === 'super-admin' ? 'super-admin-1' : 'admin-1',
      role: 'ADMIN',
      isSuperAdmin: role === 'super-admin',
    };
  });
  const requireSuperAdminAccount = vi.fn(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(request as any).user?.isSuperAdmin) {
      return reply.status(403).send({ code: 0, msg: 'super admin required' });
    }
  });
  await app.register(adminLogisticsRuleRoutes, {
    service,
    authenticateAccount,
    requireSuperAdminAccount,
  });
  return { app, service, authenticateAccount, requireSuperAdminAccount };
}

describe('admin logistics rule routes', () => {
  it('denies anonymous and non-super-admin draft reads before touching the service', async () => {
    const anonymous = await appFor('anonymous');
    const anonymousResponse = await anonymous.app.inject({
      method: 'GET',
      url: '/drafts/revision-1',
    });
    expect(anonymousResponse.statusCode).toBe(401);
    expect(anonymous.service.readDraft).not.toHaveBeenCalled();

    const ordinaryAdmin = await appFor('admin');
    const adminResponse = await ordinaryAdmin.app.inject({
      method: 'GET',
      url: '/drafts/revision-1',
    });
    expect(adminResponse.statusCode).toBe(403);
    expect(ordinaryAdmin.service.readDraft).not.toHaveBeenCalled();
  });

  it('imports a sanitized candidate as the authenticated super administrator', async () => {
    const { app, service } = await appFor('super-admin');
    const response = await app.inject({
      method: 'POST',
      url: '/drafts/import',
      payload: {
        channelId: 'channel-1',
        assignmentId: 'assignment-1',
        payload: {
          schema: 'ozon-logistics-draft/v1',
          sources: [{ kind: 'seller', sourceRevision: 'seller-revision-1' }],
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ code: 1, data: { id: 'revision-1' } });
    expect(service.importDraft).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      channelId: 'channel-1',
      assignmentId: 'assignment-1',
      payload: {
        schema: 'ozon-logistics-draft/v1',
        sources: [{ kind: 'seller', sourceRevision: 'seller-revision-1' }],
      },
    });
  });

  it('accepts a canonical pilot draft larger than the server default one-megabyte limit', async () => {
    const { app, service } = await appFor('super-admin');
    const response = await app.inject({
      method: 'POST',
      url: '/drafts/import',
      payload: {
        channelId: 'channel-1',
        assignmentId: 'assignment-1',
        payload: {
          schema: 'ozon-logistics-draft/v1',
          normalizedSource: 'x'.repeat(1_100_000),
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(service.importDraft).toHaveBeenCalledTimes(1);
  });

  it('rejects client-authored validation facts during draft import', async () => {
    const { app, service } = await appFor('super-admin');
    for (const derivedClaim of [
      { validationReport: { status: 'PASSED', requiredCount: 1, coveredCount: 1 } },
      { validationMatrix: { requirements: [] } },
      { ready: true },
      { complete: true },
      { sourceChecksum: 'a'.repeat(64) },
      { sampleChecksum: 'a'.repeat(64) },
      { batchChecksum: 'a'.repeat(64) },
      { candidateSetChecksum: 'a'.repeat(64) },
      { fingerprintKey: 'client-derived' },
      {
        providerInventory: { discovered: 159, attempted: 159, succeeded: 159, failed: 0, empty: 0 },
      },
      { recordCount: 267 },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/drafts/import',
        payload: {
          channelId: 'channel-1',
          assignmentId: 'assignment-1',
          payload: { schema: 'ozon-logistics-draft/v1', ...derivedClaim },
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'CLIENT_VALIDATION_FACTS_FORBIDDEN' },
      });
    }
    expect(service.importDraft).not.toHaveBeenCalled();
  });

  it('rejects nested derived facts and credential-bearing capture fields', async () => {
    const { app, service } = await appFor('super-admin');
    const cases = [
      {
        payload: { candidate: { preflight: { ready: true } } },
        expectedCode: 'CLIENT_VALIDATION_FACTS_FORBIDDEN',
      },
      {
        payload: { capture: { request: { headers: { Authorization: 'Bearer secret' } } } },
        expectedCode: 'CREDENTIAL_FIELDS_FORBIDDEN',
      },
      {
        payload: { capture: { request: { headers: { Cookie: 'session=secret' } } } },
        expectedCode: 'CREDENTIAL_FIELDS_FORBIDDEN',
      },
    ];

    for (const candidate of cases) {
      const response = await app.inject({
        method: 'POST',
        url: '/drafts/import',
        payload: {
          channelId: 'channel-1',
          assignmentId: 'assignment-1',
          payload: { schema: 'ozon-logistics-draft/v1', ...candidate.payload },
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: candidate.expectedCode } });
    }
    expect(service.importDraft).not.toHaveBeenCalled();
  });

  it('reads a draft and returns its server-computed diff', async () => {
    const { app, service } = await appFor('super-admin');
    const draft = await app.inject({ method: 'GET', url: '/drafts/revision-1' });
    const diff = await app.inject({
      method: 'GET',
      url: '/drafts/revision-1/diff?channelId=channel-1',
    });

    expect(draft.statusCode).toBe(200);
    expect(diff.statusCode).toBe(200);
    expect(service.readDraft).toHaveBeenCalledWith({ revisionId: 'revision-1' });
    expect(service.diffDraft).toHaveBeenCalledWith({
      revisionId: 'revision-1',
      channelId: 'channel-1',
    });
  });

  it('accepts only identifiers and expected sequence for preflight and publish', async () => {
    const { app, service } = await appFor('super-admin');
    const preflight = await app.inject({
      method: 'POST',
      url: '/drafts/revision-1/preflight',
      payload: { channelId: 'channel-1', expectedSequence: 0 },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.json()).toMatchObject({
      code: 1,
      data: { status: 'BLOCKED', report: { source: 'server-derived' } },
    });
    expect(service.preflightDraft).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      revisionId: 'revision-1',
      channelId: 'channel-1',
      expectedSequence: 0,
    });

    for (const extra of [
      { ready: true },
      { requiredCount: 63, coveredCount: 63 },
      { validationReport: { status: 'PASSED' } },
      { manifest: { selectedServiceKeys: ['forged-service'] } },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/drafts/revision-1/publish',
        payload: { channelId: 'channel-1', expectedSequence: 0, ...extra },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(service.publishDraft).not.toHaveBeenCalled();
  });

  it('requires a bounded audit reason for publish and rollback', async () => {
    const { app, service } = await appFor('super-admin');
    const requests = [
      {
        url: '/drafts/revision-1/publish',
        payload: { channelId: 'channel-1', expectedSequence: 0 },
      },
      {
        url: '/drafts/revision-1/publish',
        payload: { channelId: 'channel-1', expectedSequence: 0, reason: '短' },
      },
      {
        url: '/channels/channel-1/rollback',
        payload: { targetReleaseId: 'release-1', expectedSequence: 1 },
      },
      {
        url: '/channels/channel-1/rollback',
        payload: { targetReleaseId: 'release-1', expectedSequence: 1, reason: '短' },
      },
      {
        url: '/channels/channel-1/rollback',
        payload: { targetReleaseId: 'release-1', expectedSequence: 1, reason: 'x'.repeat(501) },
      },
    ];
    for (const request of requests) {
      const response = await app.inject({
        method: 'POST',
        url: request.url,
        payload: request.payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(service.publishDraft).not.toHaveBeenCalled();
    expect(service.rollbackRelease).not.toHaveBeenCalled();
  });

  it('publishes and rolls back using only server-owned release inputs', async () => {
    const { app, service } = await appFor('super-admin');
    const published = await app.inject({
      method: 'POST',
      url: '/drafts/revision-1/publish',
      payload: { channelId: 'channel-1', expectedSequence: 0, reason: '发布厦门试点物流规则' },
    });
    const rolledBack = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/rollback',
      payload: {
        targetReleaseId: 'release-1',
        expectedSequence: 1,
        reason: '回滚异常物流报价版本',
      },
    });

    expect(published.statusCode).toBe(201);
    expect(rolledBack.statusCode).toBe(201);
    expect(service.publishDraft).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      revisionId: 'revision-1',
      channelId: 'channel-1',
      expectedSequence: 0,
      reason: '发布厦门试点物流规则',
    });
    expect(service.rollbackRelease).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      channelId: 'channel-1',
      targetReleaseId: 'release-1',
      expectedSequence: 1,
      reason: '回滚异常物流报价版本',
    });
  });
  it('forwards server-derived method and Official suggestions as the authenticated super administrator', async () => {
    const { app, service } = await appFor('super-admin');
    const method = await app.inject({
      method: 'POST',
      url: '/method-bindings/suggestions',
      payload: {
        channelId: 'channel-1',
        revisionId: 'revision-1',
        deliveryMethodId: 'method-1',
        stableServiceKey: 'service-1',
        note: 'method evidence checked',
      },
    });
    const official = await app.inject({
      method: 'POST',
      url: '/official-resolutions/suggestions',
      payload: {
        channelId: 'channel-1',
        revisionId: 'revision-1',
        requirementKey: 'requirement-1',
        note: 'official evidence checked',
      },
    });

    expect(method.statusCode).toBe(201);
    expect(official.statusCode).toBe(201);
    expect(service.suggestMethodBinding).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      deliveryMethodId: 'method-1',
      stableServiceKey: 'service-1',
      note: 'method evidence checked',
    });
    expect(service.suggestOfficialResolution).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-1',
      note: 'official evidence checked',
    });
  });

  it('rejects every review action when expectedUpdatedAt is missing', async () => {
    const { app, service } = await appFor('super-admin');
    const requests = [
      {
        url: '/method-bindings/binding-1/confirm',
        payload: { channelId: 'channel-1', revisionId: 'revision-1', note: 'confirm method' },
      },
      {
        url: '/method-bindings/binding-1/reject',
        payload: { channelId: 'channel-1', revisionId: 'revision-1', note: 'reject method' },
      },
      {
        url: '/official-resolutions/resolution-1/confirm',
        payload: {
          channelId: 'channel-1',
          revisionId: 'revision-1',
          selectedServiceKey: 'service-1',
          note: 'confirm official',
        },
      },
      {
        url: '/official-resolutions/resolution-1/reject',
        payload: { channelId: 'channel-1', revisionId: 'revision-1', note: 'reject official' },
      },
    ];

    for (const request of requests) {
      const response = await app.inject({
        method: 'POST',
        url: request.url,
        payload: request.payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 0, error: { code: 'INVALID_REQUEST' } });
    }
    expect(service.reviewMethodBinding).not.toHaveBeenCalled();
    expect(service.reviewOfficialResolution).not.toHaveBeenCalled();
  });

  it('forwards the optimistic-lock token for every method and Official review action', async () => {
    const { app, service } = await appFor('super-admin');
    const expectedUpdatedAt = '2026-07-13T08:30:00.000Z';
    const responses = [];
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/method-bindings/binding-1/confirm',
        payload: {
          channelId: 'channel-1',
          revisionId: 'revision-1',
          expectedUpdatedAt,
          note: 'confirm method',
        },
      }),
    );
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/method-bindings/binding-1/reject',
        payload: {
          channelId: 'channel-1',
          revisionId: 'revision-1',
          expectedUpdatedAt,
          note: 'reject method',
        },
      }),
    );
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/official-resolutions/resolution-1/confirm',
        payload: {
          channelId: 'channel-1',
          revisionId: 'revision-1',
          expectedUpdatedAt,
          selectedServiceKey: 'service-1',
          note: 'confirm official',
        },
      }),
    );
    responses.push(
      await app.inject({
        method: 'POST',
        url: '/official-resolutions/resolution-1/reject',
        payload: {
          channelId: 'channel-1',
          revisionId: 'revision-1',
          expectedUpdatedAt,
          note: 'reject official',
        },
      }),
    );

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(service.reviewMethodBinding.mock.calls).toEqual([
      [
        {
          actorUserId: 'super-admin-1',
          channelId: 'channel-1',
          revisionId: 'revision-1',
          bindingId: 'binding-1',
          decision: 'CONFIRMED',
          expectedUpdatedAt,
          note: 'confirm method',
        },
      ],
      [
        {
          actorUserId: 'super-admin-1',
          channelId: 'channel-1',
          revisionId: 'revision-1',
          bindingId: 'binding-1',
          decision: 'REJECTED',
          expectedUpdatedAt,
          note: 'reject method',
        },
      ],
    ]);
    expect(service.reviewOfficialResolution.mock.calls).toEqual([
      [
        {
          actorUserId: 'super-admin-1',
          channelId: 'channel-1',
          revisionId: 'revision-1',
          resolutionId: 'resolution-1',
          decision: 'CONFIRMED',
          expectedUpdatedAt,
          selectedServiceKey: 'service-1',
          note: 'confirm official',
        },
      ],
      [
        {
          actorUserId: 'super-admin-1',
          channelId: 'channel-1',
          revisionId: 'revision-1',
          resolutionId: 'resolution-1',
          decision: 'REJECTED',
          expectedUpdatedAt,
          note: 'reject official',
        },
      ],
    ]);
  });

  it('maps repository review conflicts to an explicit HTTP 409 response', async () => {
    const service = adminService();
    service.reviewMethodBinding.mockRejectedValueOnce(
      new LogisticsRuleAdminServiceError(
        'REVIEW_CONFLICT',
        'The review target changed; reload it before reviewing again',
        409,
      ),
    );
    const { app } = await appFor('super-admin', service);
    const response = await app.inject({
      method: 'POST',
      url: '/method-bindings/binding-1/confirm',
      payload: {
        channelId: 'channel-1',
        revisionId: 'revision-1',
        expectedUpdatedAt: '2026-07-13T08:30:00.000Z',
        note: 'confirm method',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 0,
      msg: 'The review target changed; reload it before reviewing again',
      error: { code: 'REVIEW_CONFLICT' },
    });
  });
});
