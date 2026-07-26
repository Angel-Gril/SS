import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionByokReadinessRoutes } from '../routes/extension-byok-readiness.js';
import {
  EXTENSION_BYOK_READINESS_ATTESTATION_VERSION,
  EXTENSION_BYOK_READINESS_BINDING_VERSION,
  EXTENSION_BYOK_READINESS_REQUEST_VERSION,
  EXTENSION_BYOK_READINESS_TTL_MS,
} from '../services/extension-byok-readiness-attestation.js';

const NOW = new Date('2026-07-25T15:00:00.000Z');

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_READINESS_REQUEST_VERSION,
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    providerOrigin: 'https://relay.example',
    model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    ...overrides,
  };
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'extension-byok-readiness/v1',
    policyRevision: 734,
    mode: 'pilot',
    context: {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      deviceSessionId: 'session-1',
      providerOrigin: 'https://relay.example',
      operation: 'TEXT_TO_IMAGE',
    },
    maxConcurrency: 1,
    capabilities: {
      generation: { enabled: true, ready: true, reasonCode: 'READY' },
      ingest: { enabled: true, ready: true, reasonCode: 'READY' },
      publish: { enabled: false, ready: false, reasonCode: 'PUBLISH_DISABLED' },
    },
    ...overrides,
  } as any;
}

async function build(options: {
  scopes?: string[];
  draftRevision?: number;
  readiness?: ReturnType<typeof decision>;
} = {}) {
  const getReadiness = vi.fn(async () => options.readiness || decision());
  const app = Fastify();
  await app.register(extensionByokReadinessRoutes, {
    authenticateDevice: async (fastifyRequest: FastifyRequest) => {
      (fastifyRequest as any).device = {
        sessionId: 'session-1',
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        scopes: options.scopes || ['byok:media:ingest'],
        allowedShopIds: ['shop-1'],
      };
    },
    loadShop: async () => ({
      id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
    }),
    loadDraft: async () => ({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      revision: options.draftRevision ?? 3, draftVersion: 4,
    }),
    getReadiness,
    now: () => NOW,
  });
  return { app, getReadiness };
}

describe('extension BYOK readiness attestation route', () => {
  it('issues a short no-store attestation bound to authenticated device policy and current draft', async () => {
    const { app, getReadiness } = await build();
    const response = await app.inject({ method: 'POST', url: '/readiness', payload: request() });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_READINESS_ATTESTATION_VERSION,
        authenticated: true,
        expiresAt: new Date(NOW.getTime() + EXTENSION_BYOK_READINESS_TTL_MS).toISOString(),
        binding: {
          contractVersion: EXTENSION_BYOK_READINESS_BINDING_VERSION,
          ownerUserId: 'owner-1',
          deviceSessionId: 'session-1',
          shopId: 'shop-1',
          workflowId: 'workflow-1',
          draftRevision: 3,
          draftVersion: 4,
          providerOrigin: 'https://relay.example',
          model: 'image-model-v1',
          operation: 'TEXT_TO_IMAGE',
          policyRevision: '734',
        },
        decision: {
          allowed: true,
          providerOrigin: 'https://relay.example',
          policyRevision: 734,
        },
      },
    });
    expect(getReadiness).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      deviceSessionId: 'session-1',
      providerOrigin: 'https://relay.example',
      operation: 'TEXT_TO_IMAGE',
    });
    await app.close();
  });

  it('fails before attestation for missing scope, stale draft, or disabled generation', async () => {
    const cases = [
      { options: { scopes: ['listing:review'] }, expected: 403 },
      { options: { draftRevision: 9 }, expected: 409 },
      {
        options: {
          readiness: decision({
            capabilities: {
              ...decision().capabilities,
              generation: { enabled: false, ready: false, reasonCode: 'GENERATION_DISABLED' },
            },
          }),
        },
        expected: 409,
      },
    ];
    for (const item of cases) {
      const { app } = await build(item.options);
      const response = await app.inject({ method: 'POST', url: '/readiness', payload: request() });
      expect(response.statusCode).toBe(item.expected);
      expect(response.headers['cache-control']).toBe('no-store');
      await app.close();
    }
  });

  it('allows provider settings readiness without accepting a partial draft identity', async () => {
    const { app } = await build();
    const settings = await app.inject({
      method: 'POST',
      url: '/readiness',
      payload: request({ workflowId: null, draftRevision: null, draftVersion: null }),
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().data.binding).toMatchObject({
      workflowId: null, draftRevision: null, draftVersion: null,
    });
    const partial = await app.inject({
      method: 'POST',
      url: '/readiness',
      payload: request({ workflowId: null }),
    });
    expect(partial.statusCode).toBe(400);
    await app.close();
  });
});
