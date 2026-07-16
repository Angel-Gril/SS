import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  sourceListingPublisherRoutes,
  type SourceListingPublisherRouteOptions,
} from '../routes/source-listing-publisher.js';

function featureDecision(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    legacyAllowed: false,
    captureStage: null,
    listingStage: 'v2_only',
    reason: 'pilot_match',
    revision: 'rollout-1',
    ...overrides,
  };
}

function attemptSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    workflowId: 'workflow-1',
    shopId: 'shop-1',
    draftVersion: 2,
    revision: 7,
    catalogSnapshotHash: 'a'.repeat(64),
    attributeSchemaHash: 'b'.repeat(64),
    publisherContractVersion: 'ozon-listing-publisher/v1',
    endpoint: '/v3/product/import',
    draftPayloadHash: 'c'.repeat(64),
    draftStateHash: 'd'.repeat(64),
    requestPayloadHash: 'e'.repeat(64),
    itemCount: 1,
    state: 'SUBMITTED',
    reconciliationState: 'PENDING',
    stateVersion: 2,
    ozonTaskId: '12345',
    acceptanceSource: 'OZON_TASK_RESPONSE',
    responseHash: 'f'.repeat(64),
    itemResults: [{ offerId: 'offer-1', status: 'pending' }],
    itemResultCount: 1,
    itemResultsTruncated: false,
    itemErrors: [],
    itemErrorCount: 0,
    itemErrorsTruncated: false,
    lastErrorCode: null,
    lastErrorMessage: null,
    submitStartedAt: '2026-07-15T12:00:00.000Z',
    submittedAt: '2026-07-15T12:00:01.000Z',
    unknownAt: null,
    rejectedAt: null,
    nextReconcileAt: '2026-07-15T12:00:02.000Z',
    reconcileAttemptCount: 0,
    lastReconciledAt: null,
    completedAt: null,
    resolutionEvidenceHash: null,
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:01.000Z',
    ...overrides,
  };
}

function build(options: {
  actorUserId?: string;
  isSubAccount?: boolean;
  role?: string;
  loadShop?: SourceListingPublisherRouteOptions['loadShop'];
  getDraft?: SourceListingPublisherRouteOptions['workflow']['getDraft'];
  evaluate?: SourceListingPublisherRouteOptions['featureFlags']['evaluate'];
  listAttempts?: SourceListingPublisherRouteOptions['publisher']['listAttempts'];
} = {}) {
  const app = Fastify();
  const authenticate = vi.fn(async (request: FastifyRequest) => {
    (request as any).user = {
      userId: 'owner-1',
      actorUserId: options.actorUserId || 'owner-1',
      isSubAccount: options.isSubAccount || false,
      role: options.role || 'USER',
    };
  });
  const loadShop = vi.fn(options.loadShop || (async () => ({
    id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
  })));
  const getDraft = vi.fn(options.getDraft || (async () => ({
    id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
  }) as any));
  const evaluate = vi.fn(options.evaluate || (async () => featureDecision() as any));
  const listAttempts = vi.fn(options.listAttempts || (async () => ({
    items: [attemptSummary()], nextCursor: null,
  }) as any));
  app.register(sourceListingPublisherRoutes, {
    authenticate,
    loadShop,
    workflow: { getDraft },
    featureFlags: { evaluate },
    publisher: { listAttempts },
  });
  return { app, authenticate, loadShop, getDraft, evaluate, listAttempts };
}

describe('source listing publisher discovery routes', () => {
  it('returns V2 capability only for an active owner-scoped Ozon shop', async () => {
    const { app, loadShop, evaluate } = build();
    await app.ready();

    const response = await app.inject({
      method: 'GET', url: '/publisher-capability?shopId=shop-1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: 1,
      data: { enabled: true, legacyAllowed: false, reason: 'pilot_match', revision: 'rollout-1' },
    });
    expect(loadShop).toHaveBeenCalledWith({ shopId: 'shop-1', ownerUserId: 'owner-1' });
    expect(evaluate).toHaveBeenNthCalledWith(1, 'SOURCE_LISTING_WORKFLOW', {
      ownerUserId: 'owner-1', shopId: 'shop-1', platform: 'OZON',
    });
    expect(evaluate).toHaveBeenNthCalledWith(2, 'SOURCE_OZON_PUBLISHER_V2', {
      ownerUserId: 'owner-1', shopId: 'shop-1', platform: 'OZON',
    });
    await app.close();
  });

  it('reports clean policy-off as legacy-capable and fails closed on evaluation errors', async () => {
    const policyOff = build({ evaluate: async () => featureDecision({
      enabled: false,
      legacyAllowed: true,
      listingStage: 'off',
      reason: 'policy_off',
      revision: 'rollout-off',
    }) as any });
    await policyOff.app.ready();
    expect((await policyOff.app.inject({
      method: 'GET', url: '/publisher-capability?shopId=shop-1',
    })).json()).toEqual({
      code: 1,
      data: { enabled: false, legacyAllowed: true, reason: 'policy_off', revision: 'rollout-off' },
    });
    await policyOff.app.close();

    const unavailable = build({ evaluate: async () => { throw new Error('secret config failure'); } });
    await unavailable.app.ready();
    expect((await unavailable.app.inject({
      method: 'GET', url: '/publisher-capability?shopId=shop-1',
    })).json()).toEqual({
      code: 1,
      data: { enabled: false, legacyAllowed: false, reason: 'config_unavailable', revision: 'unavailable' },
    });
    await unavailable.app.close();
  });

  it('discovers a persisted attempt after the first submit response was lost without exposing secrets', async () => {
    const persisted = attemptSummary({
      requestPayload: { items: [{ offer_id: 'secret-frozen-request' }] },
      catalogSnapshot: { secret: 'catalog-body' },
      response: { secret: 'provider-response' },
      leaseToken: 'secret-lease-token',
      leaseOwner: 'internal-worker',
      resolutionEvidence: { secret: 'operator-evidence' },
    });
    const { app, getDraft, listAttempts } = build({
      listAttempts: async () => ({ items: [persisted], nextCursor: 'cursor-2' }) as any,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET', url: '/workflow-1/publish-attempts?limit=20&cursor=cursor-1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        items: [{ id: 'attempt-1', workflowId: 'workflow-1', state: 'SUBMITTED', ozonTaskId: '12345' }],
        nextCursor: 'cursor-2',
      },
    });
    const serialized = response.body;
    for (const secret of [
      'secret-frozen-request', 'catalog-body', 'provider-response',
      'secret-lease-token', 'internal-worker', 'operator-evidence',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(getDraft).toHaveBeenCalledWith({ draftId: 'workflow-1', ownerUserId: 'owner-1' });
    expect(listAttempts).toHaveBeenCalledWith({
      workflowId: 'workflow-1', ownerUserId: 'owner-1', limit: 20, cursor: 'cursor-1',
    });
    await app.close();
  });

  it('denies STAFF/subaccounts and hides foreign owner workflows and shops', async () => {
    for (const auth of [
      { role: 'STAFF' },
      { actorUserId: 'staff-1', isSubAccount: true },
    ]) {
      const denied = build(auth);
      await denied.app.ready();
      expect((await denied.app.inject({
        method: 'GET', url: '/publisher-capability?shopId=shop-1',
      })).statusCode).toBe(403);
      expect((await denied.app.inject({
        method: 'GET', url: '/workflow-1/publish-attempts',
      })).statusCode).toBe(403);
      expect(denied.listAttempts).not.toHaveBeenCalled();
      await denied.app.close();
    }

    const foreignShop = build({ loadShop: async () => null });
    await foreignShop.app.ready();
    expect((await foreignShop.app.inject({
      method: 'GET', url: '/publisher-capability?shopId=shop-foreign',
    })).statusCode).toBe(404);
    expect(foreignShop.evaluate).not.toHaveBeenCalled();
    await foreignShop.app.close();

    const foreignWorkflow = build({
      getDraft: async () => {
        throw Object.assign(new Error('not found'), {
          code: 'OZON_LISTING_DRAFT_NOT_FOUND',
          statusCode: 404,
        });
      },
    });
    await foreignWorkflow.app.ready();
    expect((await foreignWorkflow.app.inject({
      method: 'GET', url: '/workflow-foreign/publish-attempts',
    })).statusCode).toBe(404);
    expect(foreignWorkflow.listAttempts).not.toHaveBeenCalled();
    await foreignWorkflow.app.close();
  });

  it('returns a client error for a malformed persisted-attempt cursor', async () => {
    const invalidCursor = build({
      listAttempts: async () => {
        throw Object.assign(new Error('invalid cursor'), { code: 'INVALID_INPUT' });
      },
    });
    await invalidCursor.app.ready();

    const response = await invalidCursor.app.inject({
      method: 'GET',
      url: '/workflow-1/publish-attempts?cursor=not-a-valid-cursor',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'invalid_request',
      msg: '发布任务分页参数无效',
    });
    await invalidCursor.app.close();
  });
});
