import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  createSourceWorkflowCommandResolver,
  extensionCommandGrantRoutes,
} from '../routes/extension-command-grants.js';
import { hashExtensionCommandRequest } from '../services/extension-command-grants.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
} from '../services/extension-byok-media-ingest-grant.js';

const HASH = 'a'.repeat(64);

function command() {
  return {
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin: 'https://images.example.com',
    providerOperation: 'IMAGE_TO_IMAGE',
    draftRevision: 11,
    skuKey: 'sku-1',
    slotKey: 'sku-1:hero:0',
    resultSha256: HASH,
  };
}

function readiness() {
  return {
    contractVersion: 'extension-byok-readiness/v1' as const,
    policyRevision: 4,
    mode: 'pilot' as const,
    context: {
      ownerUserId: 'owner-1', shopId: 'shop-1', deviceSessionId: 'session-1',
      providerOrigin: 'https://images.example.com', operation: 'IMAGE_TO_IMAGE' as const,
    },
    maxConcurrency: 1,
    capabilities: {
      generation: { enabled: true, ready: true, reasonCode: 'READY' as const },
      ingest: { enabled: true, ready: true, reasonCode: 'READY' as const },
      publish: { enabled: true, ready: true, reasonCode: 'READY' as const },
    },
  };
}

function resolvedCommand() {
  return {
    ...command(),
    readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 4 },
  };
}

async function build(options: { scopes?: string[] } = {}) {
  const issue = vi.fn(async () => ({
    grantId: 'grant-1', token: 'g'.repeat(43), expiresAt: new Date('2026-07-25T08:01:00.000Z'),
  }));
  const app = Fastify();
  await app.register(extensionCommandGrantRoutes, {
    service: {
      issue,
      authorize: vi.fn(),
      claimPendingRecovery: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    },
    authenticateDevice: async (request: FastifyRequest) => {
      (request as any).device = {
        sessionId: 'session-1', tokenId: 'jti-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
        scopes: options.scopes || [EXTENSION_BYOK_MEDIA_INGEST_SCOPE], allowedShopIds: ['shop-1'],
      };
    },
    resolveCommand: createSourceWorkflowCommandResolver({
      featureFlags: { evaluate: vi.fn(async () => ({
        enabled: true, legacyAllowed: false, captureStage: null, reason: 'pilot_match' as const, revision: '1',
      })) },
      loadShop: async () => ({ id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE' }),
      loadDraft: async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1', draftVersion: 7, revision: 11,
        stage: 'DRAFT', selectedSkuKeys: [], publishTaskIds: [],
      }),
      getByokReadiness: async () => readiness(),
    }),
  } as never);
  return { app, issue };
}

describe('BYOK media ingest command grant route', () => {
  it('requires the dedicated scope and never falls back to media/listing scopes', async () => {
    const { app, issue } = await build({ scopes: ['media:execute', 'listing:write'] });
    const response = await app.inject({
      method: 'POST', url: '/command-grants',
      payload: {
        operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'byok-ingest-route-operation-1', command: command(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'command_scope_denied' });
    expect(issue).not.toHaveBeenCalled();
    await app.close();
  });

  it('issues a no-store grant bound to the resolved draft and canonical command hash', async () => {
    const { app, issue } = await build();
    const payload = {
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'byok-ingest-route-operation-1', command: command(),
    };
    const response = await app.inject({ method: 'POST', url: '/command-grants', payload });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      requestHash: hashExtensionCommandRequest({
        operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        command: resolvedCommand(),
      }),
    }));
    await app.close();
  });
});
