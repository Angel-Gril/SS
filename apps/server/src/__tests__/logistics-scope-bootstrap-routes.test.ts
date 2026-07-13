import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  adminLogisticsScopeBootstrapRoutes,
  logisticsScopeBootstrapDeviceRoutes,
} from '../routes/logistics-scope-bootstrap.js';

function service() {
  return {
    listWorkspace: vi.fn(async () => ({ bootstrap: { id: 'bootstrap-1' } })),
    getCompanyProbe: vi.fn(async () => ({ id: 'probe-1', status: 'SUBMITTED' })),
    bootstrapScope: vi.fn(async () => ({ id: 'bootstrap-1', status: 'CANDIDATE' })),
    issueCompanyProbe: vi.fn(async () => ({
      probeId: 'probe-1', status: 'ISSUED', expiresAt: '2026-07-13T08:05:00.000Z',
    })),
    listPendingCompanyProbes: vi.fn(async () => []),
    claimCompanyProbe: vi.fn(async () => ({ probeId: 'probe-1', status: 'CLAIMED' })),
    submitCompanyProbe: vi.fn(async () => ({
      probeId: 'probe-1', status: 'SUBMITTED', duplicate: false,
    })),
    reviewCompanyProbe: vi.fn(async () => ({
      probeId: 'probe-1', status: 'CONFIRMED', companyBindingId: 'binding-1',
    })),
    confirmOriginAndActivate: vi.fn(async () => ({
      originBindingId: 'origin-1', channelId: 'channel-1', assignmentId: 'assignment-1',
    })),
  };
}

async function adminApp(role: 'anonymous' | 'admin' | 'super-admin', sut = service()) {
  const app = Fastify();
  await app.register(adminLogisticsScopeBootstrapRoutes, {
    service: sut as never,
    authenticateAccount: async (request: FastifyRequest, reply: FastifyReply) => {
      if (role === 'anonymous') return reply.status(401).send({ code: 0 });
      (request as any).user = {
        actorUserId: role === 'super-admin' ? 'super-admin-1' : 'admin-1',
        isSuperAdmin: role === 'super-admin',
      };
    },
    requireSuperAdminAccount: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(request as any).user?.isSuperAdmin) return reply.status(403).send({ code: 0 });
    },
  });
  return { app, service: sut };
}

async function deviceApp(authenticated: boolean, sut = service()) {
  const app = Fastify();
  await app.register(logisticsScopeBootstrapDeviceRoutes, {
    service: sut as never,
    authenticateDevice: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!authenticated) return reply.status(401).send({ code: 0 });
      (request as any).device = {
        sessionId: 'session-1', ownerUserId: 'tenant-1', allowedShopIds: ['shop-1'],
        deploymentId: 'local-dev',
      };
    },
  });
  return { app, service: sut };
}

describe('logistics scope bootstrap routes', () => {
  it('allows only a super administrator to bootstrap and issue probes', async () => {
    for (const role of ['anonymous', 'admin'] as const) {
      const current = await adminApp(role);
      const response = await current.app.inject({
        method: 'POST',
        url: '/scope-bootstrap',
        payload: {
          tenantId: 'tenant-1',
          shopId: 'shop-1',
          warehouseId: 'warehouse-1',
          deliveryMethodId: 'method-1',
        },
      });
      expect(response.statusCode).toBe(role === 'anonymous' ? 401 : 403);
      expect(current.service.bootstrapScope).not.toHaveBeenCalled();
    }

    const current = await adminApp('super-admin');
    expect((await current.app.inject({
      method: 'POST',
      url: '/scope-bootstrap',
      payload: {
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        deliveryMethodId: 'method-1',
      },
    })).statusCode).toBe(201);
    const issued = await current.app.inject({
      method: 'POST', url: '/binding-probes', payload: { bootstrapId: 'bootstrap-1' },
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.json().data).not.toHaveProperty('claimToken');
  });

  it('requires device auth and rejects credential-bearing probe evidence', async () => {
    const anonymous = await deviceApp(false);
    expect((await anonymous.app.inject({
      method: 'GET', url: '/binding-probes/pending',
    })).statusCode).toBe(401);

    const current = await deviceApp(true);
    const valid = {
      claimToken: 'claim-token-that-is-at-least-thirty-two-bytes-long',
      evidence: {
        companyId: 'seller-company-1',
        warehouse: { platformWarehouseId: 'ozon-warehouse-17' },
        deliveryMethod: { platformMethodId: 37 },
      },
    };
    expect((await current.app.inject({
      method: 'POST', url: '/binding-probes/probe-1/submit', payload: valid,
    })).statusCode).toBe(201);
    for (const forbidden of [
      { cookie: 'secret' },
      { accessToken: 'secret' },
      { apiKey: 'secret' },
      { authorization: 'secret' },
    ]) {
      expect((await current.app.inject({
        method: 'POST',
        url: '/binding-probes/probe-1/submit',
        payload: { ...valid, evidence: { ...valid.evidence, ...forbidden } },
      })).statusCode).toBe(400);
    }
    expect(current.service.submitCompanyProbe).toHaveBeenCalledTimes(1);
  });

  it('requires bounded reasons for super-admin confirmation and rejection', async () => {
    const current = await adminApp('super-admin');
    for (const decision of ['confirm', 'reject']) {
      expect((await current.app.inject({
        method: 'POST',
        url: '/binding-probes/probe-1/' + decision,
        payload: { reason: 'reviewed Seller and OpenAPI scope evidence' },
      })).statusCode).toBe(200);
    }
    expect((await current.app.inject({
      method: 'POST',
      url: '/binding-probes/probe-1/confirm',
      payload: { reason: 'no' },
    })).statusCode).toBe(400);
  });
  it('reads a filtered workspace and sanitized probe detail for the administrator', async () => {
    const current = await adminApp('super-admin');
    const workspace = await current.app.inject({
      method: 'GET',
      url: '/scope-bootstrap/workspace?bootstrapId=bootstrap-1',
    });
    const detail = await current.app.inject({
      method: 'GET',
      url: '/binding-probes/probe-1',
    });
    expect(workspace.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(current.service.listWorkspace).toHaveBeenCalledWith({
      bootstrapId: 'bootstrap-1',
    });
    expect(current.service.getCompanyProbe).toHaveBeenCalledWith({
      probeId: 'probe-1',
    });
    expect(detail.json().data).not.toHaveProperty('nonceDigest');
  });

  it('returns 410 when changed bootstrap evidence expires a probe transition', async () => {
    const expired = () => Object.assign(new Error('Binding probe expired'), {
      code: 'BINDING_PROBE_EXPIRED',
      statusCode: 410,
    });
    const devicePayload = {
      claimToken: 'claim-token-that-is-at-least-thirty-two-bytes-long',
      evidence: {
        companyId: 'seller-company-1',
        warehouse: { platformWarehouseId: 'ozon-warehouse-17' },
        deliveryMethod: { platformMethodId: 37 },
      },
    };

    for (const operation of ['claimCompanyProbe', 'submitCompanyProbe'] as const) {
      const sut = service();
      vi.mocked(sut[operation]).mockRejectedValueOnce(expired());
      const current = await deviceApp(true, sut);
      const response = await current.app.inject({
        method: 'POST',
        url: `/binding-probes/probe-1/${operation === 'claimCompanyProbe' ? 'claim' : 'submit'}`,
        payload: operation === 'claimCompanyProbe'
          ? { claimToken: devicePayload.claimToken }
          : devicePayload,
      });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        error: { code: 'BINDING_PROBE_EXPIRED' },
      });
    }

    const sut = service();
    vi.mocked(sut.reviewCompanyProbe).mockRejectedValueOnce(expired());
    const current = await adminApp('super-admin', sut);
    const response = await current.app.inject({
      method: 'POST',
      url: '/binding-probes/probe-1/confirm',
      payload: { reason: 'review changed bootstrap evidence' },
    });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({
      error: { code: 'BINDING_PROBE_EXPIRED' },
    });
  });
});
