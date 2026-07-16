import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { adminOzonPublisherRolloutRoutes } from '../routes/admin-ozon-publisher-rollout.js';

const HASH = 'a'.repeat(64);
const IDEMPOTENCY_KEY = 'rollout-request-0001';

function serviceStub() {
  const gate = { id: 'gate-1', state: 'NOT_READY', stateVersion: 0 };
  const evaluation = { id: 'evaluation-1', evidenceHash: HASH, result: 'READY' };
  const transition = { id: 'transition-1', resultState: 'READY' };
  const stageTransition = {
    id: 'stage-transition-1', transitionVersion: 1, resultStage: 'shadow',
  };
  return {
    listGates: vi.fn(async () => ({
      items: [gate],
      nextCursor: { sortAt: '2026-07-16T00:00:00.000Z', id: 'gate-0' },
    })),
    provisionGate: vi.fn(async () => ({ record: gate, idempotent: false })),
    getGate: vi.fn(async () => gate),
    listEvaluations: vi.fn(async () => ({ items: [evaluation], nextCursor: null })),
    listTransitions: vi.fn(async () => ({ items: [transition], nextCursor: null })),
    listStages: vi.fn(async () => [{
      boundary: 'COLLECT_PUBLISH_OZON', configKey: 'source_collect_publish_ozon_stage',
      stage: 'off', revision: 0, updatedAt: '2026-07-16T00:00:00.000Z',
    }]),
    evaluateGate: vi.fn(async () => ({ record: evaluation, idempotent: false })),
    approveGate: vi.fn(async () => ({ record: transition, idempotent: false })),
    revokeGate: vi.fn(async () => ({
      record: { ...transition, id: 'transition-2', resultState: 'REVOKED' }, idempotent: false,
    })),
    transitionStage: vi.fn(async () => ({ record: stageTransition, idempotent: false })),
  };
}

type Session = 'anonymous' | 'admin' | 'extension' | 'account';

async function appFor(session: Session, service = serviceStub()) {
  const app = Fastify();
  const authenticate = vi.fn(async (request: FastifyRequest, reply: FastifyReply) => {
    if (session === 'anonymous') return reply.status(401).send({ code: 0 });
    (request as any).user = {
      userId: 'user-1', actorUserId: 'user-1', role: 'ADMIN',
      isSuperAdmin: session !== 'admin',
      tokenUse: session === 'extension' ? 'extension_device' : 'account_session',
    };
  });
  const requireSuperAdmin = vi.fn(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(request as any).user?.isSuperAdmin) {
      return reply.status(403).send({ code: 0, errorCode: 'super_admin_required' });
    }
  });
  const audit = vi.fn(async () => undefined);
  await app.register(adminOzonPublisherRolloutRoutes, {
    service: service as never, authenticate, requireSuperAdmin, audit,
  });
  return { app, service, audit };
}

const writeRequests = [
  { method: 'POST' as const, url: '/gates', payload: {
    writerEntrypoint: 'COLLECT_PUBLISH_OZON', originChannel: 'DIRECT',
    rolloutRevision: 'rollout-2026-07-16',
  } },
  { method: 'POST' as const, url: '/gates/gate-1/evaluate', payload: { idempotencyKey: IDEMPOTENCY_KEY } },
  { method: 'POST' as const, url: '/gates/gate-1/approve', payload: {
    expectedStateVersion: 0, expectedPreviewEvidenceHash: HASH,
    idempotencyKey: IDEMPOTENCY_KEY, reason: 'Evidence reviewed',
  } },
  { method: 'POST' as const, url: '/gates/gate-1/revoke', payload: {
    expectedStateVersion: 1, expectedEvidenceHash: HASH, expectedEvaluationHash: HASH,
    idempotencyKey: IDEMPOTENCY_KEY, reason: 'Emergency rollback',
  } },
  { method: 'POST' as const, url: '/stages/COLLECT_PUBLISH_OZON/transition', payload: {
    expectedRevision: 0, expectedStage: 'off', targetStage: 'shadow',
    idempotencyKey: IDEMPOTENCY_KEY, reason: 'Begin shadow observation',
  } },
];

describe('admin Ozon publisher rollout routes', () => {
  it.each(['anonymous', 'admin', 'extension'] as const)(
    'rejects every operation for a %s session',
    async (session) => {
      const { app, service } = await appFor(session);
      const requests = [
        { method: 'GET' as const, url: '/gates' },
        { method: 'GET' as const, url: '/gates/gate-1' },
        { method: 'GET' as const, url: '/gates/gate-1/evaluations' },
        { method: 'GET' as const, url: '/gates/gate-1/transitions' },
        { method: 'GET' as const, url: '/stages' },
        ...writeRequests,
      ];
      for (const request of requests) {
        expect((await app.inject(request)).statusCode).toBe(session === 'anonymous' ? 401 : 403);
      }
      for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
    },
  );

  it('serves fixed list/detail projections and opaque cursors to an account superadmin', async () => {
    const { app, service } = await appFor('account');
    const list = await app.inject({ method: 'GET', url: '/gates?limit=10&state=NOT_READY' });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body).toMatchObject({ code: 1, data: { items: [{ id: 'gate-1' }] } });
    expect(body.data.nextCursor).toEqual(expect.any(String));
    expect(await app.inject({ method: 'GET', url: '/gates/gate-1' })).toMatchObject({ statusCode: 200 });
    expect(await app.inject({ method: 'GET', url: '/gates/gate-1/evaluations' })).toMatchObject({ statusCode: 200 });
    expect(await app.inject({ method: 'GET', url: '/gates/gate-1/transitions' })).toMatchObject({ statusCode: 200 });
    expect(await app.inject({ method: 'GET', url: '/stages' })).toMatchObject({ statusCode: 200 });
    expect(service.listGates).toHaveBeenCalledWith({
      state: 'NOT_READY', limit: 10, cursor: null,
    });
  });

  it('rejects malformed bodies and cursors before invoking the service', async () => {
    const { app, service } = await appFor('account');
    const responses = [
      await app.inject({ method: 'GET', url: '/gates?cursor=not+base64' }),
      await app.inject({ method: 'GET', url: '/gates?unknown=true' }),
      await app.inject({ method: 'POST', url: '/gates/gate-1/evaluate', payload: { idempotencyKey: 'short' } }),
      await app.inject({ method: 'POST', url: '/stages/COLLECT_PUBLISH_OZON/transition', payload: {
        ...writeRequests[4]!.payload, unexpected: true,
      } }),
    ];
    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400]);
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });

  it('dispatches evaluate, approve, revoke, and stage transitions with actor identity and audits them', async () => {
    const { app, service, audit } = await appFor('account');
    const responses = [];
    for (const request of writeRequests) responses.push(await app.inject(request));
    expect(responses.map((response) => response.statusCode)).toEqual([201, 200, 200, 200, 200]);
    expect(service.evaluateGate).toHaveBeenCalledWith(expect.objectContaining({
      gateId: 'gate-1', idempotencyKey: IDEMPOTENCY_KEY,
      actor: expect.objectContaining({ actorUserId: 'user-1', tokenUse: 'account_session' }),
    }));
    expect(service.approveGate).toHaveBeenCalledWith(expect.objectContaining({ expectedStateVersion: 0 }));
    expect(service.revokeGate).toHaveBeenCalledWith(expect.objectContaining({ expectedStateVersion: 1 }));
    expect(service.transitionStage).toHaveBeenCalledWith(expect.objectContaining({
      boundary: 'COLLECT_PUBLISH_OZON', expectedStage: 'off', targetStage: 'shadow',
    }));
    expect(service.provisionGate).toHaveBeenCalledWith(expect.objectContaining({
      writerEntrypoint: 'COLLECT_PUBLISH_OZON', originChannel: 'DIRECT',
      rolloutRevision: 'rollout-2026-07-16',
    }));
    expect(audit).toHaveBeenCalledTimes(5);
  });

  it.each([
    [404, 'ozon_publisher_rollout_gate_not_found'],
    [409, 'ozon_publisher_rollout_evidence_drift'],
    [503, 'ozon_publisher_rollout_snapshot_unavailable'],
  ])('maps typed service errors to HTTP %i', async (statusCode, errorCode) => {
    const service = serviceStub();
    service.getGate.mockRejectedValueOnce(Object.assign(new Error(errorCode), {
      code: errorCode.toUpperCase(), statusCode,
    }));
    const { app } = await appFor('account', service);
    const response = await app.inject({ method: 'GET', url: '/gates/gate-1' });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toMatchObject({ code: 0, errorCode });
  });
});
