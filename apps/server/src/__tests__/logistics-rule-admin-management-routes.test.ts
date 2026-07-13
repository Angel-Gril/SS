import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminLogisticsRuleRoutes } from '../routes/admin-logistics-rules.js';

function managementService() {
  return {
    readWorkspace: vi.fn(async () => ({
      channel: { id: 'channel-1' },
      currentRelease: null,
      releaseHistory: [],
      assignments: [],
      companyBindings: [],
      originBindings: [],
      deliveryMethods: [],
      methodBindings: [],
      officialResolutions: [],
    })),
    suggestMethodBinding: vi.fn(async () => ({
      id: 'binding-1', status: 'SUGGESTED', updatedAt: '2026-07-13T10:00:00.000Z',
    })),
    reviewMethodBinding: vi.fn(async (input: { decision: string }) => ({
      id: 'binding-1', status: input.decision,
      updatedAt: input.decision === 'CONFIRMED' ? '2026-07-13T10:00:00.001Z' : '2026-07-13T10:00:00.002Z',
    })),
    suggestOfficialResolution: vi.fn(async () => ({
      id: 'resolution-1', status: 'SUGGESTED', candidateSetChecksum: 'c'.repeat(64),
      updatedAt: '2026-07-13T10:00:00.000Z',
    })),
    reviewOfficialResolution: vi.fn(async (input: { decision: string }) => ({
      id: 'resolution-1', status: input.decision,
      updatedAt: input.decision === 'CONFIRMED' ? '2026-07-13T10:00:00.001Z' : '2026-07-13T10:00:00.002Z',
    })),
    listOfficialCountries: vi.fn(async () => ({ kind: 'countries', records: [] })),
    listOfficialCities: vi.fn(async (countryUid: string) => ({ kind: 'cities', countryUid, records: [] })),
    listOfficialDestinations: vi.fn(async () => ({ kind: 'destinations', records: [] })),
    importDraft: vi.fn(),
    readDraft: vi.fn(),
    diffDraft: vi.fn(),
    preflightDraft: vi.fn(),
    publishDraft: vi.fn(),
    rollbackRelease: vi.fn(),
  };
}

async function createApp() {
  const app = Fastify();
  const service = managementService();
  await app.register(adminLogisticsRuleRoutes, {
    service: service as any,
    authenticateAccount: async (request: FastifyRequest) => {
      (request as any).user = {
        userId: 'effective-owner-1',
        actorUserId: 'super-admin-1',
        role: 'ADMIN',
        isSuperAdmin: true,
      };
    },
    requireSuperAdminAccount: async (_request: FastifyRequest, _reply: FastifyReply) => undefined,
  });
  return { app, service };
}

const methodSuggestion = {
  channelId: 'channel-1',
  revisionId: 'revision-1',
  deliveryMethodId: 'method-1',
  stableServiceKey: 'service-1',
  note: 'exact method',
};

describe('admin logistics pilot management routes', () => {
  it('discovers channels before any ID has been selected', async () => {
    const { app, service } = await createApp();
    const response = await app.inject({ method: 'GET', url: '/workspace' });

    expect(response.statusCode).toBe(200);
    expect(service.readWorkspace).toHaveBeenCalledWith({});
  });

  it('loads one complete workspace for the selected channel and revision', async () => {
    const { app, service } = await createApp();
    const response = await app.inject({
      method: 'GET', url: '/workspace?channelId=channel-1&revisionId=revision-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { channel: { id: 'channel-1' } } });
    expect(service.readWorkspace).toHaveBeenCalledWith({
      channelId: 'channel-1', revisionId: 'revision-1',
    });
  });

  it('creates and explicitly confirms or rejects a method-binding suggestion', async () => {
    const { app, service } = await createApp();
    const created = await app.inject({
      method: 'POST', url: '/method-bindings/suggestions', payload: methodSuggestion,
    });
    const reviewBase = {
      channelId: 'channel-1', revisionId: 'revision-1', note: 'provider and route checked',
      expectedUpdatedAt: created.json().data.updatedAt,
    };
    const confirmed = await app.inject({
      method: 'POST', url: '/method-bindings/binding-1/confirm', payload: reviewBase,
    });
    const rejectedReview = { ...reviewBase, expectedUpdatedAt: confirmed.json().data.updatedAt };
    const rejected = await app.inject({
      method: 'POST', url: '/method-bindings/binding-1/reject', payload: rejectedReview,
    });

    expect([created.statusCode, confirmed.statusCode, rejected.statusCode]).toEqual([201, 200, 200]);
    expect(service.suggestMethodBinding).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1', ...methodSuggestion,
    });
    expect(service.reviewMethodBinding).toHaveBeenNthCalledWith(1, {
      actorUserId: 'super-admin-1', bindingId: 'binding-1', decision: 'CONFIRMED', ...reviewBase,
    });
    expect(service.reviewMethodBinding).toHaveBeenNthCalledWith(2, {
      actorUserId: 'super-admin-1', bindingId: 'binding-1', decision: 'REJECTED', ...rejectedReview,
    });
  });

  it('creates and reviews an Official resolution with a candidate-set checksum', async () => {
    const { app, service } = await createApp();
    const suggestion = {
      channelId: 'channel-1', revisionId: 'revision-1', requirementKey: 'requirement-1',
      note: 'review the exact Official sample',
    };
    const created = await app.inject({
      method: 'POST', url: '/official-resolutions/suggestions', payload: suggestion,
    });
    const review = {
      channelId: 'channel-1', revisionId: 'revision-1', selectedServiceKey: 'service-1',
      note: 'variant checked',
      expectedUpdatedAt: created.json().data.updatedAt,
    };
    const confirmed = await app.inject({
      method: 'POST', url: '/official-resolutions/resolution-1/confirm', payload: review,
    });
    const rejectedReview = {
      ...review, selectedServiceKey: undefined, expectedUpdatedAt: confirmed.json().data.updatedAt,
    };
    const rejected = await app.inject({
      method: 'POST', url: '/official-resolutions/resolution-1/reject',
      payload: rejectedReview,
    });

    expect([created.statusCode, confirmed.statusCode, rejected.statusCode]).toEqual([201, 200, 200]);
    expect(service.suggestOfficialResolution).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1', ...suggestion,
    });
    expect(service.reviewOfficialResolution).toHaveBeenNthCalledWith(1, {
      actorUserId: 'super-admin-1', resolutionId: 'resolution-1', decision: 'CONFIRMED', ...review,
    });
    expect(service.reviewOfficialResolution).toHaveBeenNthCalledWith(2, expect.objectContaining({
      actorUserId: 'super-admin-1', resolutionId: 'resolution-1', decision: 'REJECTED',
      expectedUpdatedAt: rejectedReview.expectedUpdatedAt,
    }));
  });

  it('lists countries, cities and destinations through the reviewed Official client', async () => {
    const { app, service } = await createApp();
    const countryUid = '13a6e0b2-f138-597d-a3ff-071876394e41';
    const countries = await app.inject({ method: 'GET', url: '/official-locations/countries' });
    const cities = await app.inject({
      method: 'GET', url: `/official-locations/countries/${countryUid}/cities`,
    });
    const destinations = await app.inject({ method: 'GET', url: '/official-locations/destinations' });

    expect([countries.statusCode, cities.statusCode, destinations.statusCode]).toEqual([200, 200, 200]);
    expect(service.listOfficialCountries).toHaveBeenCalledTimes(1);
    expect(service.listOfficialCities).toHaveBeenCalledWith(countryUid);
    expect(service.listOfficialDestinations).toHaveBeenCalledTimes(1);
  });

  it('rejects missing review versions, notes and client-derived evidence before service access', async () => {
    const { app, service } = await createApp();
    const missingNote = await app.inject({
      method: 'POST', url: '/method-bindings/suggestions',
      payload: { ...methodSuggestion, note: '' },
    });
    const missingVersion = await app.inject({
      method: 'POST', url: '/method-bindings/binding-1/confirm',
      payload: { channelId: 'channel-1', revisionId: 'revision-1', note: 'checked' },
    });
    const invalidVersion = await app.inject({
      method: 'POST', url: '/official-resolutions/resolution-1/reject',
      payload: { channelId: 'channel-1', revisionId: 'revision-1', note: 'checked', expectedUpdatedAt: 'invalid' },
    });
    const forgedOfficialFacts = await app.inject({
      method: 'POST', url: '/official-resolutions/suggestions',
      payload: {
        channelId: 'channel-1',
        revisionId: 'revision-1',
        officialFingerprint: 'fingerprint-1',
        note: 'review exact sample',
        candidateServiceKeys: ['service-1'],
        evidence: { providerId: 'forged-provider' },
      },
    });
    const invalidCountry = await app.inject({
      method: 'GET', url: '/official-locations/countries/not-a-uuid/cities',
    });

    expect(missingNote.statusCode).toBe(400);
    expect(missingVersion.statusCode).toBe(400);
    expect(invalidVersion.statusCode).toBe(400);
    expect(forgedOfficialFacts.statusCode).toBe(400);
    expect(invalidCountry.statusCode).toBe(400);
    expect(service.suggestMethodBinding).not.toHaveBeenCalled();
    expect(service.reviewMethodBinding).not.toHaveBeenCalled();
    expect(service.reviewOfficialResolution).not.toHaveBeenCalled();
    expect(service.suggestOfficialResolution).not.toHaveBeenCalled();
    expect(service.listOfficialCities).not.toHaveBeenCalled();
  });
});
