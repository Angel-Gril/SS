import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { adminOzonPublisherParityRoutes } from '../routes/admin-ozon-publisher-parity.js';
import { compareOzonPublisherEntrypointParity } from '../services/ozon-publisher-entrypoint-parity.js';
import {
  deriveOzonPublisherParityDifferenceSubject,
  normalizeOzonPublisherParityReport,
} from '../services/ozon-publisher-parity-observations.js';

function fixtures() {
  const report = normalizeOzonPublisherParityReport(compareOzonPublisherEntrypointParity({
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: {
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'private-offer', weight: 500 }] },
    },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'private-offer' }] },
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  }));
  const descriptor = deriveOzonPublisherParityDifferenceSubject(report, 'rollout-1')!;
  const subject = {
    ...descriptor,
    legacyItemCount: 1,
    v2ItemCount: 1,
    approvalState: 'PENDING' as const,
    stateVersion: 0,
    observationCount: 3,
    firstObservedAt: '2026-07-16T01:00:00.000Z',
    lastObservedAt: '2026-07-16T03:00:00.000Z',
    reviewedByUserId: null,
    reviewNote: null,
    reviewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    revokedAt: null,
  };
  const observation = {
    id: 'observation-1',
    recordKey: 'b'.repeat(64),
    contractVersion: 'ozon-publisher-parity-observation/v1' as const,
    scopeHash: 'a'.repeat(64),
    rolloutRevision: 'rollout-1',
    entrypoint: 'COLLECT_PUBLISH_OZON' as const,
    reportHash: 'c'.repeat(64),
    report,
    differenceSubjectKey: subject.key,
    approvalEligible: true,
    observedAt: '2026-07-16T03:00:00.000Z',
    expiresAt: '2027-01-12T03:00:00.000Z',
  };
  return { report, subject, observation };
}

function service(options: { idempotent?: boolean } = {}) {
  const { subject, observation } = fixtures();
  return {
    recordObservation: vi.fn(),
    listObservations: vi.fn(async () => ({
      observations: [observation],
      nextCursor: { observedAt: observation.observedAt, id: observation.id },
    })),
    listDifferenceSubjects: vi.fn(async () => ({
      subjects: [subject],
      nextCursor: { lastObservedAt: subject.lastObservedAt, key: subject.key },
    })),
    getDifferenceSubject: vi.fn(async () => subject),
    reviewDifference: vi.fn(async (input: any) => ({
      review: {
        subjectKey: input.subjectKey,
        status: 'APPROVED' as const,
        transitionVersion: input.expectedTransitionVersion + 1,
        actorUserId: input.actorUserId,
        reviewNote: input.reviewNote,
        reviewedAt: '2026-07-16T04:00:00.000Z',
        operationKey: 'd'.repeat(64),
        requestHash: 'e'.repeat(64),
      },
      idempotent: options.idempotent ?? false,
    })),
    pruneExpiredObservations: vi.fn(),
  };
}

async function appFor(
  superAdmin: boolean,
  tokenUse: 'account_session' | 'legacy_extension' | null = 'account_session',
  serviceOptions: { idempotent?: boolean } = {},
) {
  const app = Fastify();
  const parityService = service(serviceOptions);
  const audit = vi.fn(async () => undefined);
  const authenticate = vi.fn(async (request: FastifyRequest) => {
    (request as any).user = {
      userId: 'admin-1',
      actorUserId: 'admin-1',
      role: 'ADMIN',
      isSuperAdmin: superAdmin,
      ...(tokenUse ? { tokenUse } : {}),
    };
  });
  const requireSuperAdmin = vi.fn(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(request as any).user?.isSuperAdmin) {
      return reply.status(403).send({ code: 0, msg: 'super admin required' });
    }
  });
  await app.register(adminOzonPublisherParityRoutes, {
    service: parityService as any,
    authenticate,
    requireSuperAdmin,
    audit,
  });
  return { app, service: parityService, audit };
}

describe('admin Ozon publisher parity routes', () => {
  it('protects every observation and review endpoint with super-admin authorization', async () => {
    const { app, service: parityService } = await appFor(false);
    const key = fixtures().subject.key;
    const requests = [
      { method: 'GET' as const, url: '/observations' },
      { method: 'GET' as const, url: '/difference-subjects' },
      { method: 'GET' as const, url: `/difference-subjects/${key}` },
      {
        method: 'POST' as const,
        url: `/difference-subjects/${key}/approve`,
        payload: { expectedTransitionVersion: 0, reviewNote: 'Reviewed evidence.' },
      },
    ];

    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(403);
    }
    expect(parityService.listObservations).not.toHaveBeenCalled();
    expect(parityService.listDifferenceSubjects).not.toHaveBeenCalled();
    expect(parityService.reviewDifference).not.toHaveBeenCalled();
  });

  it('returns only fixed sanitized observation and difference fields with opaque cursors', async () => {
    const { app } = await appFor(true);

    const observations = await app.inject({ method: 'GET', url: '/observations?limit=20' });
    const subjects = await app.inject({ method: 'GET', url: '/difference-subjects?approvalEligible=true' });

    expect(observations.statusCode).toBe(200);
    expect(subjects.statusCode).toBe(200);
    expect(observations.json()).toMatchObject({
      code: 1,
      data: {
        items: [{
          entrypoint: 'COLLECT_PUBLISH_OZON',
          legacy: { endpointKind: 'OZON_V3_PRODUCT_IMPORT', itemCount: 1 },
          differences: { rows: [{ path: '/items/0/weight' }] },
        }],
        nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      },
    });
    expect(subjects.json()).toMatchObject({
      code: 1,
      data: {
        items: [{
          legacyItemCount: 1,
          v2ItemCount: 1,
          approvalState: 'PENDING',
          stateVersion: 0,
          approvalEligible: true,
        }],
        nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      },
    });
    const serialized = `${observations.body}\n${subjects.body}`;
    expect(serialized).not.toContain('private-offer');
    expect(serialized).not.toContain('scopeHash');
    expect(serialized).not.toContain('recordKey');
    expect(serialized).not.toContain('reportHash');
    expect(serialized).not.toContain('payloadHash');
  });

  it('accepts the direct listing import-by-SKU list filter', async () => {
    const { app, service: parityService } = await appFor(true);

    const response = await app.inject({
      method: 'GET',
      url: '/observations?entrypoint=LISTING_IMPORT_BY_SKU&limit=20',
    });

    expect(response.statusCode).toBe(200);
    expect(parityService.listObservations).toHaveBeenCalledWith({
      entrypoint: 'LISTING_IMPORT_BY_SKU',
      status: undefined,
      differenceSubjectKey: undefined,
      cursor: null,
      limit: 20,
    });
  });

  it('performs a CAS review and writes a forced metadata-only audit event', async () => {
    const { app, service: parityService, audit } = await appFor(true);
    const key = fixtures().subject.key;
    const response = await app.inject({
      method: 'POST',
      url: `/difference-subjects/${key}/approve`,
      payload: {
        expectedTransitionVersion: 0,
        reviewNote: 'Approved intentional removal of the fabricated default.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(parityService.reviewDifference).toHaveBeenCalledWith({
      action: 'APPROVE',
      subjectKey: key,
      expectedTransitionVersion: 0,
      actorUserId: 'admin-1',
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Approved intentional removal of the fabricated default.',
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'admin-1',
      actorRole: 'ADMIN',
      action: 'OZON_PUBLISHER_PARITY_APPROVE',
      target: key,
      force: true,
      after: {
        subjectKey: key,
        transitionVersion: 1,
        status: 'APPROVED',
        idempotent: false,
      },
    }));
    expect(JSON.stringify(audit.mock.calls)).not.toContain('/items/0/weight');
  });

  it('records an idempotent review retry as an explicit replay audit action', async () => {
    const { app, audit } = await appFor(true, 'account_session', { idempotent: true });
    const key = fixtures().subject.key;

    const response = await app.inject({
      method: 'POST',
      url: `/difference-subjects/${key}/approve`,
      payload: {
        expectedTransitionVersion: 0,
        reviewNote: 'Approved intentional removal of the fabricated default.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { idempotent: true } });
    expect(audit).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'OZON_PUBLISHER_PARITY_APPROVE_REPLAY',
      after: expect.objectContaining({ idempotent: true }),
    }));
  });

  it.each([
    ['legacy_extension' as const, undefined],
    [null, 'Bearer accepted-untyped-legacy-token'],
  ])('denies every review write without a typed live account session (%s)', async (tokenUse, authorization) => {
    const { app, service: parityService, audit } = await appFor(true, tokenUse);
    const key = fixtures().subject.key;

    for (const action of ['approve', 'reject', 'revoke']) {
      const response = await app.inject({
        method: 'POST',
        url: `/difference-subjects/${key}/${action}`,
        headers: authorization ? { authorization } : undefined,
        payload: {
          expectedTransitionVersion: 0,
          reviewNote: 'Reviewed evidence with a legacy credential.',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'ozon_publisher_parity_account_session_required',
      });
    }
    expect(parityService.reviewDifference).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('keeps read-only parity evidence available to a generic super-admin session', async () => {
    const { app, service: parityService } = await appFor(true, 'legacy_extension');

    const response = await app.inject({ method: 'GET', url: '/observations' });

    expect(response.statusCode).toBe(200);
    expect(parityService.listObservations).toHaveBeenCalledOnce();
  });

  it('rejects malformed cursors before repository access', async () => {
    const { app, service: parityService } = await appFor(true);
    const response = await app.inject({ method: 'GET', url: '/observations?cursor=not-a-cursor' });

    expect(response.statusCode).toBe(400);
    expect(parityService.listObservations).not.toHaveBeenCalled();
  });
});
