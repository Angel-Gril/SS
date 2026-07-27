import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  extensionByokExecutionIntentRoutes,
} from '../routes/extension-byok-execution-intent.js';
import { ExtensionByokExecutionIntentError } from '../services/extension-byok-execution-intent.js';

const HASH = 'a'.repeat(64);

function payload() {
  return {
    contractVersion: 'extension-byok-execution-intent-request/v1',
    binding: {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: 'owner-1',
      deviceSessionId: 'session-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 7,
      draftVersion: 11,
      sourcePlatform: '1688',
      sourceProductId: 'source-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      assignmentMode: 'APPEND',
      assignmentOrdinal: 0,
      providerOrigin: 'https://provider.example',
      model: 'image-model-1',
      operation: 'TEXT_TO_IMAGE',
      policyRevision: '23',
    },
    requestMode: 'json',
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH,
  };
}

async function build(options: { scopes?: string[]; shops?: string[] } = {}) {
  const claim = vi.fn(async () => ({
    replayed: false,
    intent: {
      id: 'intent-1',
      contractVersion: 'extension-byok-execution-intent/v1' as const,
      executionMode: 'BYOK' as const,
      ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      providerRequestHash: HASH, shopId: 'shop-1', listingWorkflowId: 'workflow-1',
      draftRevision: 7, draftVersion: 11, skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
      sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
      assignmentMode: 'APPEND' as const, assignmentOrdinal: 0, policyRevision: 23,
      providerOriginSha256: 'b'.repeat(64), model: 'image-model-1',
      operation: 'TEXT_TO_IMAGE' as const, requestMode: 'json' as const,
      providerIdempotencyKey: 'provider-attempt-0001', requestHash: 'c'.repeat(64),
      outcome: 'PENDING' as const, providerRequestIdSha256: null, resultSha256: null,
      outcomeUpdatedAt: null,
      createdAt: new Date('2026-07-27T06:00:00.000Z'),
      updatedAt: new Date('2026-07-27T06:00:00.000Z'),
    },
  }));
  const recordOutcome = vi.fn(async (input: any) => {
    const base = (await claim()).intent;
    return {
      replayed: false,
      intent: {
        ...base,
        id: input.intentId,
        providerIdempotencyKey: input.providerIdempotencyKey,
        providerRequestHash: input.providerRequestHash,
        outcome: input.outcome,
        providerRequestIdSha256: input.providerRequestIdSha256,
        resultSha256: input.resultSha256,
        outcomeUpdatedAt: new Date('2026-07-27T06:01:00.000Z'),
        updatedAt: new Date('2026-07-27T06:01:00.000Z'),
      },
    };
  });
  const app = Fastify();
  await app.register(extensionByokExecutionIntentRoutes, {
    prefix: '/byok-media',
    authenticateDevice: async (request) => {
      (request as any).device = {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', sessionId: 'session-1',
        scopes: options.scopes ?? ['byok:media:ingest'],
        allowedShopIds: options.shops ?? ['shop-1'],
      };
    },
    service: { claim, recordOutcome },
  });
  await app.ready();
  return { app, claim, recordOutcome };
}

describe('extension BYOK execution intent routes', () => {
  it('returns a bounded secret-free receipt and no-store headers', async () => {
    const { app, claim } = await build();
    const response = await app.inject({
      method: 'POST', url: '/byok-media/execution-intents', payload: payload(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-intent/v1',
        intentId: 'intent-1',
        replayed: false,
        executionMode: 'BYOK',
        outcome: 'PENDING',
        providerIdempotencyKey: 'provider-attempt-0001',
        providerRequestHash: HASH,
        context: {
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 7, draftVersion: 11,
          skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        },
      },
    });
    expect(response.body).not.toContain('provider.example');
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
    }));
    await app.close();
  });

  it.each([
    [[], ['shop-1'], 403, 'byok_execution_intent_scope_denied'],
    [['byok:media:ingest'], [], 403, 'byok_execution_intent_shop_denied'],
  ] as const)('denies missing device authority', async (scopes, shops, status, errorCode) => {
    const { app, claim } = await build({ scopes: [...scopes], shops: [...shops] });
    const response = await app.inject({
      method: 'POST', url: '/byok-media/execution-intents', payload: payload(),
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code: 0, errorCode });
    expect(claim).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps the database mode fence to a stable 409 response', async () => {
    const { app, claim } = await build();
    claim.mockRejectedValueOnce(new ExtensionByokExecutionIntentError(
      'BYOK_EXECUTION_INTENT_MODE_CONFLICT', 409, 'conflict',
    ));
    const response = await app.inject({
      method: 'POST', url: '/byok-media/execution-intents', payload: payload(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0, errorCode: 'byok_execution_intent_mode_conflict',
    });
    await app.close();
  });

  it('rejects unknown and oversized request fields before the service', async () => {
    const { app, claim } = await build();
    const response = await app.inject({
      method: 'POST', url: '/byok-media/execution-intents',
      payload: { ...payload(), unknown: 'x' },
    });
    expect(response.statusCode).toBe(400);
    expect(claim).not.toHaveBeenCalled();
    await app.close();
  });

  it('records a bounded successful outcome without returning Provider origin or image bytes', async () => {
    const { app, recordOutcome } = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/byok-media/execution-intents/intent-1/outcome',
      payload: {
        contractVersion: 'extension-byok-execution-intent-outcome-request/v1',
        providerIdempotencyKey: 'provider-attempt-0001',
        providerRequestHash: HASH,
        outcome: 'SUCCEEDED',
        providerRequestIdSha256: 'b'.repeat(64),
        resultSha256: 'c'.repeat(64),
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: 'extension-byok-execution-intent-outcome/v1',
        intentId: 'intent-1',
        replayed: false,
        outcome: 'SUCCEEDED',
        providerIdempotencyKey: 'provider-attempt-0001',
        providerRequestHash: HASH,
        providerRequestIdSha256: 'b'.repeat(64),
        resultSha256: 'c'.repeat(64),
      },
    });
    expect(response.body).not.toContain('provider.example');
    expect(recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
      intentId: 'intent-1',
    }));
    await app.close();
  });
});
