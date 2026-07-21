import Fastify, { type FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createSourceWorkflowCommandResolver,
  extensionCommandGrantRoutes,
} from '../routes/extension-command-grants.js';
import {
  ExtensionCommandGrantError,
  hashExtensionCommandRequest,
} from '../services/extension-command-grants.js';

function device(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes: ['listing:review', 'media:execute', 'listing:publish'],
    allowedShopIds: ['shop-1'],
    ...overrides,
  };
}

function captureCommand(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'source-product-capture-v2',
    platform: '1688',
    sourceProductId: '1000000000236',
    captureHash: 'a'.repeat(64),
    payloadBytes: 20480,
    ...overrides,
  };
}

function dependencies(options: {
  device?: Record<string, unknown>;
  resolution?: Record<string, unknown>;
} = {}) {
  const issue = vi.fn(async () => ({
    grantId: 'grant-1',
    token: 'g'.repeat(43),
    expiresAt: new Date('2026-07-14T08:01:00.000Z'),
  }));
  const authorize = vi.fn(async (): Promise<any> => ({
    kind: 'execute' as const,
    receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
  }));
  const complete = vi.fn(async ({ receiptId, result }: { receiptId: string; result: unknown }) => ({
    id: receiptId, status: 'SUCCEEDED', result, failureCode: null,
  }));
  const fail = vi.fn(async ({ receiptId, failureCode }: { receiptId: string; failureCode: string }) => ({
    id: receiptId, status: 'FAILED', result: null, failureCode,
  }));
  const executeOzonPublish = vi.fn(async () => ({ attemptId: 'attempt-1', state: 'SUBMITTED' }));
  const executeMediaWorkflowCommand = vi.fn(async () => ({
    workflowId: 'media-1', action: 'CANCEL', status: 'CANCELLED', revision: 4,
  }));
  const authenticateDevice = vi.fn(async (request: FastifyRequest) => {
    (request as any).device = device(options.device);
  });
  const resolveCommand = vi.fn(async (input: any) => options.resolution || ({
    kind: 'allowed',
    shopId: input.shopId,
    workflowId: input.workflowId,
    draftVersion: input.draftVersion,
    command: input.command,
  }));
  return {
    service: { issue, authorize, complete, fail }, authenticateDevice, resolveCommand,
    executeOzonPublish, executeMediaWorkflowCommand,
  };
}

async function buildApp(options: Parameters<typeof dependencies>[0] = {}) {
  const deps = dependencies(options);
  const app = Fastify();
  await app.register(extensionCommandGrantRoutes, deps as never);
  return { app, ...deps };
}

function publishPayload(overrides: Record<string, unknown> = {}) {
  return {
    operation: 'OZON_PUBLISH',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftVersion: 7,
    idempotencyKey: 'publish-workflow-1-v7',
    command: { action: 'submit', selectedSkuIds: ['sku-1'] },
    ...overrides,
  };
}

function mediaCommand(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ai-media-workflow-command/v1',
    action: 'CANCEL',
    mediaWorkflowId: 'media-1',
    expectedRevision: 3,
    draftRevision: 11,
    ...overrides,
  };
}

function mediaPayload(overrides: Record<string, unknown> = {}) {
  return {
    operation: 'MEDIA_EXECUTE',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftVersion: 7,
    idempotencyKey: 'media-command-operation-1',
    command: mediaCommand(),
    ...overrides,
  };
}

describe('extension command grant routes', () => {
  it('registers beside device pairing and outside the logistics feature boundary', () => {
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const deviceStart = index.indexOf('if (isExtensionDeviceAuthEnabled())');
    const logisticsStart = index.indexOf('if (isLogisticsDistributionEnabled())');
    const commandRegistration = index.indexOf('await app.register(extensionCommandGrantRoutes');

    expect(commandRegistration).toBeGreaterThan(deviceStart);
    expect(commandRegistration).toBeLessThan(logisticsStart);
    expect(index).toContain('resolveExtensionCommandGrantSecret');
  });

  it('issues a no-store grant bound only to authenticated device identity and resolved context', async () => {
    const { app, service, resolveCommand } = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/command-grants',
      payload: publishPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      code: 1,
      data: { grantId: 'grant-1', grantToken: 'g'.repeat(43) },
    });
    expect(resolveCommand).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1',
      sessionId: 'session-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
    }));
    const normalizedEnvelope = {
      operation: 'OZON_PUBLISH',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      command: { action: 'submit', selectedSkuIds: ['sku-1'] },
    };
    expect(service.issue).toHaveBeenCalledWith({
      sessionId: 'session-1',
      tokenId: 'jti-1',
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      operation: 'OZON_PUBLISH',
      workflowId: 'workflow-1',
      draftVersion: 7,
      idempotencyKey: 'publish-workflow-1-v7',
      requestHash: hashExtensionCommandRequest(normalizedEnvelope),
    });
  });

  it('consumes an Ozon publish grant once and completes an immutable receipt', async () => {
    const { app, service, executeOzonPublish } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/ozon-publish/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ code: 1, data: { receipt: { status: 'SUCCEEDED' } } });
    expect(executeOzonPublish).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1', workflowId: 'workflow-1',
    }));
    expect(service.authorize).toHaveBeenCalledTimes(1);
    expect(service.complete).toHaveBeenCalledWith(expect.objectContaining({ receiptId: 'receipt-1' }));
  });

  it('does not execute the publisher twice when a grant receipt is replayed', async () => {
    const deps = await buildApp();
    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: { id: 'receipt-1', status: 'SUCCEEDED', result: { attemptId: 'attempt-1' }, failureCode: null },
    });
    const response = await deps.app.inject({
      method: 'POST', url: '/ozon-publish/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { replay: true } });
    expect(deps.executeOzonPublish).not.toHaveBeenCalled();
    expect(deps.service.complete).not.toHaveBeenCalled();
  });

  it('consumes an exact media command grant and never executes it twice on receipt replay', async () => {
    const deps = await buildApp();
    const payload = {
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-command-operation-1', command: mediaCommand(),
    };
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { replay: false, receipt: { status: 'SUCCEEDED' } },
    });
    expect(deps.executeMediaWorkflowCommand).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      listingWorkflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-command-operation-1', command: mediaCommand(),
    });
    expect(deps.service.authorize).toHaveBeenCalledWith({
      sessionId: 'session-1', tokenId: 'jti-1', ownerUserId: 'owner-1',
      shopId: 'shop-1', operation: 'MEDIA_EXECUTE', workflowId: 'workflow-1',
      draftVersion: 7, idempotencyKey: 'media-command-operation-1',
      requestHash: hashExtensionCommandRequest({
        operation: 'MEDIA_EXECUTE', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, command: mediaCommand(),
      }),
      token: 'g'.repeat(43),
    });

    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: {
        id: 'receipt-1', status: 'SUCCEEDED', result: { workflowId: 'media-1' },
        failureCode: null,
      },
    });
    const replay = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ data: { replay: true } });
    expect(deps.executeMediaWorkflowCommand).toHaveBeenCalledTimes(1);
  });

  it('rechecks the live draft and rollout before consuming an already-issued grant', async () => {
    const deps = await buildApp({ resolution: { kind: 'stale' } });
    const response = await deps.app.inject({
      method: 'POST', url: '/ozon-publish/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ errorCode: 'command_context_stale' });
    expect(deps.service.authorize).not.toHaveBeenCalled();
    expect(deps.executeOzonPublish).not.toHaveBeenCalled();
  });

  it('stores a bounded failure code without exposing executor error text', async () => {
    const deps = await buildApp();
    deps.executeOzonPublish.mockRejectedValueOnce(Object.assign(
      new Error('secret upstream response'),
      { code: 'OZON_SUBMIT_REJECTED' },
    ));
    const response = await deps.app.inject({
      method: 'POST', url: '/ozon-publish/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain('secret upstream response');
    expect(deps.service.fail).toHaveBeenCalledWith({
      receiptId: 'receipt-1', failureCode: 'OZON_SUBMIT_REJECTED', result: null,
    });
  });

  it.each(['sessionId', 'tokenId', 'ownerUserId', 'requestHash', 'ttlMs'])(
    'rejects client injection of %s',
    async (field) => {
      const { app, service } = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/command-grants',
        payload: publishPayload({ [field]: field === 'ttlMs' ? 300_000 : 'forged' }),
      });

      expect(response.statusCode).toBe(400);
      expect(service.issue).not.toHaveBeenCalled();
    },
  );

  it('requires the operation scope and a live allowed shop', async () => {
    const missingScope = await buildApp({ device: { scopes: ['listing:review'] } });
    const scopeResponse = await missingScope.app.inject({
      method: 'POST',
      url: '/command-grants',
      payload: publishPayload(),
    });
    expect(scopeResponse.statusCode).toBe(403);
    expect(scopeResponse.json()).toMatchObject({ errorCode: 'command_scope_denied' });

    const wrongShop = await buildApp({ device: { allowedShopIds: ['shop-2'] } });
    const shopResponse = await wrongShop.app.inject({
      method: 'POST',
      url: '/command-grants',
      payload: publishPayload(),
    });
    expect(shopResponse.statusCode).toBe(403);
    expect(shopResponse.json()).toMatchObject({ errorCode: 'command_shop_denied' });
  });

  it('requires media:execute before issuing or consuming a media command', async () => {
    const deps = await buildApp({ device: { scopes: ['listing:review'] } });
    const issued = await deps.app.inject({
      method: 'POST', url: '/command-grants', payload: mediaPayload(),
    });
    expect(issued.statusCode).toBe(403);
    expect(issued.json()).toMatchObject({ errorCode: 'command_scope_denied' });

    const executed = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'media-command-operation-1', command: mediaCommand(),
      },
    });
    expect(executed.statusCode).toBe(403);
    expect(deps.service.authorize).not.toHaveBeenCalled();
    expect(deps.executeMediaWorkflowCommand).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable', 409, 'command_operation_unavailable'],
    ['stale', 409, 'command_context_stale'],
    ['forbidden', 403, 'command_context_forbidden'],
    ['rollout_unavailable', 503, 'source_workflow_rollout_unavailable'],
  ] as const)('maps %s authoritative context decisions', async (kind, status, errorCode) => {
    const { app, service } = await buildApp({ resolution: { kind } });
    const response = await app.inject({
      method: 'POST',
      url: '/command-grants',
      payload: publishPayload(),
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ errorCode });
    expect(service.issue).not.toHaveBeenCalled();
  });

  it('resolves an exact publish-intent draft from a server-owned Ozon shop', async () => {
    const evaluate = vi.fn(async () => ({
      enabled: true,
      legacyAllowed: false,
      captureStage: null,
      reason: 'pilot_match' as const,
      revision: 'pilot-1',
    }));
    const loadShop = vi.fn(async () => ({
      id: 'shop-1',
      userId: 'owner-1',
      platform: 'OZON',
      status: 'ACTIVE',
    }));
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate },
      loadShop,
      loadDraft: vi.fn(async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
        draftVersion: 7, revision: 11, stage: 'PUBLISH_INTENT_RECORDED',
        selectedSkuKeys: ['sku-1'], publishTaskIds: ['intent-1'],
      })),
    });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: 'OZON_PUBLISH',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      command: {
        schemaVersion: 'ozon-publish-command/v1', draftRevision: 11,
        publishIntentId: 'intent-1', selectedSkuKeys: ['sku-1'],
      },
    })).resolves.toEqual({
      kind: 'allowed', shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: {
        schemaVersion: 'ozon-publish-command/v1', draftRevision: 11,
        publishIntentId: 'intent-1', selectedSkuKeys: ['sku-1'],
      },
    });
    expect(loadShop).toHaveBeenCalledWith({ shopId: 'shop-1', ownerUserId: 'owner-1' });
    expect(evaluate).toHaveBeenCalledWith('SOURCE_OZON_PUBLISHER_V2', {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      platform: 'OZON',
      deviceSessionId: 'session-1',
    });
  });

  it.each(['CANCEL', 'RETRY'] as const)(
    'resolves an exact fake-only listing-draft media %s command',
    async (action) => {
      const evaluate = vi.fn(async () => ({
        enabled: true, legacyAllowed: false, captureStage: null,
        reason: 'pilot_match' as const, revision: 'pilot-1',
      }));
      const loadMediaWorkflow = vi.fn(async () => ({
        id: 'media-1', ownerUserId: 'owner-1', contextType: 'listing-draft',
        contextId: 'workflow-1', contextDraftRevision: 11, contextDraftVersion: 7,
        revision: 3, status: action === 'CANCEL' ? 'RUNNING' : 'FAILED', suiteId: null,
        provider: 'fake',
      }));
      const resolve = createSourceWorkflowCommandResolver({
        featureFlags: { evaluate },
        loadShop: vi.fn(async () => ({
          id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
        })),
        loadDraft: vi.fn(async () => ({
          id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
          draftVersion: 7, revision: 11, stage: 'MEDIA_REVIEW',
          selectedSkuKeys: ['sku-1'], publishTaskIds: [],
        })),
        loadMediaWorkflow,
      });
      const command = mediaCommand({ action });
      await expect(resolve({
        sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7, command,
      })).resolves.toEqual({
        kind: 'allowed', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, command,
      });
      expect(loadMediaWorkflow).toHaveBeenCalledWith({
        workflowId: 'media-1', ownerUserId: 'owner-1',
      });
      expect(evaluate).toHaveBeenCalledWith('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: 'owner-1', shopId: 'shop-1', deviceSessionId: 'session-1',
      });
    },
  );

  it.each([
    ['paid provider', { provider: 'dashscope-qwen-mt-image' }, {}, 'forbidden'],
    ['collect context', { contextType: 'collect', contextId: 'goods-1' }, {}, 'forbidden'],
    ['suite child', { suiteId: 'suite-1' }, {}, 'forbidden'],
    ['media revision', { revision: 4 }, {}, 'stale'],
    ['draft revision', {}, { draftRevision: 10 }, 'stale'],
    ['non-retryable status', { status: 'SUCCEEDED' }, { action: 'RETRY' }, 'stale'],
  ])('rejects an unsafe media command binding: %s', async (_label, mediaPatch, commandPatch, kind) => {
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate: vi.fn(async () => ({
        enabled: true, legacyAllowed: false, captureStage: null,
        reason: 'pilot_match' as const, revision: 'pilot-1',
      })) },
      loadShop: vi.fn(async () => ({
        id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
      })),
      loadDraft: vi.fn(async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
        draftVersion: 7, revision: 11, stage: 'MEDIA_REVIEW',
        selectedSkuKeys: ['sku-1'], publishTaskIds: [],
      })),
      loadMediaWorkflow: vi.fn(async () => ({
        id: 'media-1', ownerUserId: 'owner-1', contextType: 'listing-draft',
        contextId: 'workflow-1', contextDraftRevision: 11, contextDraftVersion: 7,
        revision: 3, status: 'FAILED', suiteId: null, provider: 'fake', ...mediaPatch,
      })),
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: mediaCommand({ action: 'RETRY', ...commandPatch }),
    })).resolves.toEqual({ kind });
  });

  it.each([
    ['draft version', { draftVersion: 8 }, {}],
    ['draft revision', {}, { draftRevision: 10 }],
    ['publish intent', {}, { publishIntentId: 'intent-2' }],
    ['selected SKU', {}, { selectedSkuKeys: ['sku-2'] }],
  ])('rejects a stale Ozon publish command binding: %s', async (_label, inputPatch, commandPatch) => {
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate: vi.fn(async () => ({
        enabled: true, legacyAllowed: false, captureStage: null,
        reason: 'pilot_match' as const, revision: 'pilot-1',
      })) },
      loadShop: vi.fn(async () => ({
        id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
      })),
      loadDraft: vi.fn(async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
        draftVersion: 7, revision: 11, stage: 'PUBLISH_INTENT_RECORDED',
        selectedSkuKeys: ['sku-1'], publishTaskIds: ['intent-1'],
      })),
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'OZON_PUBLISH',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: {
        schemaVersion: 'ozon-publish-command/v1', draftRevision: 11,
        publishIntentId: 'intent-1', selectedSkuKeys: ['sku-1'], ...commandPatch,
      },
      ...inputPatch,
    })).resolves.toEqual({ kind: 'stale' });
  });

  it('resolves a source capture grant from device scope and canonical capture identity', async () => {
    const evaluate = vi.fn(async () => ({
      enabled: true,
      legacyAllowed: true,
      captureStage: 'shadow_write' as const,
      reason: 'pilot_match' as const,
      revision: 'capture-shadow-1',
    }));
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate },
      loadShop: vi.fn(),
    });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: 'SOURCE_CAPTURE',
      shopId: null,
      workflowId: null,
      draftVersion: null,
      command: captureCommand({ sourceProductId: ' 1000000000236 ' }),
    })).resolves.toEqual({
      kind: 'allowed',
      shopId: null,
      workflowId: null,
      draftVersion: null,
      command: captureCommand(),
    });
    expect(evaluate).toHaveBeenCalledWith('SOURCE_CAPTURE_V2', {
      ownerUserId: 'owner-1',
      deviceSessionId: 'session-1',
      platform: '1688',
    });
  });

  it.each([
    captureCommand({ schemaVersion: 'source-product-capture-v3' }),
    captureCommand({ platform: 'pdd' }),
    captureCommand({ sourceProductId: '' }),
    captureCommand({ captureHash: 'not-a-hash' }),
    captureCommand({ payloadBytes: 0 }),
    captureCommand({ extra: true }),
  ])('rejects a malformed or unsupported source capture grant command', async (command) => {
    const evaluate = vi.fn();
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate },
      loadShop: vi.fn(),
    });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: 'SOURCE_CAPTURE',
      shopId: null,
      workflowId: null,
      draftVersion: null,
      command,
    })).resolves.toEqual({ kind: 'forbidden' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('does not issue capture grants while rollout is off or unavailable', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        enabled: false,
        legacyAllowed: true,
        captureStage: 'off',
        reason: 'pilot_miss',
        revision: 'capture-pilot-1',
      })
      .mockResolvedValueOnce({
        enabled: false,
        legacyAllowed: false,
        captureStage: null,
        reason: 'config_unavailable',
        revision: 'unavailable',
      });
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate },
      loadShop: vi.fn(),
    });
    const input = {
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: 'SOURCE_CAPTURE' as const,
      shopId: null,
      workflowId: null,
      draftVersion: null,
      command: captureCommand(),
    };

    await expect(resolve(input)).resolves.toEqual({ kind: 'unavailable' });
    await expect(resolve(input)).resolves.toEqual({ kind: 'rollout_unavailable' });
  });

  it('fails command resolution closed when rollout cannot be evaluated', async () => {
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: {
        evaluate: vi.fn(async () => ({
          enabled: false,
          legacyAllowed: false,
          captureStage: null,
          reason: 'config_unavailable' as const,
          revision: 'unavailable',
        })),
      },
      loadShop: vi.fn(async () => ({
        id: 'shop-1',
        userId: 'owner-1',
        platform: 'OZON',
        status: 'ACTIVE',
      })),
      loadDraft: vi.fn(async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
        draftVersion: 7, revision: 11, stage: 'PUBLISH_INTENT_RECORDED',
        selectedSkuKeys: ['sku-1'], publishTaskIds: ['intent-1'],
      })),
    });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: 'OZON_PUBLISH',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      command: {
        schemaVersion: 'ozon-publish-command/v1', draftRevision: 11,
        publishIntentId: 'intent-1', selectedSkuKeys: ['sku-1'],
      },
    })).resolves.toEqual({ kind: 'rollout_unavailable' });
  });

  it('fails command resolution closed when the trusted shop lookup is unavailable', async () => {
    const evaluate = vi.fn();
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate },
      loadShop: vi.fn().mockRejectedValue(new Error('database unavailable')),
      loadDraft: vi.fn(),
    });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: 'OZON_PUBLISH',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      command: {
        schemaVersion: 'ozon-publish-command/v1', draftRevision: 11,
        publishIntentId: 'intent-1', selectedSkuKeys: ['sku-1'],
      },
    })).resolves.toEqual({ kind: 'rollout_unavailable' });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('maps idempotency conflicts and exposes no generic consume or completion endpoint', async () => {
    const { app, service } = await buildApp();
    service.issue.mockRejectedValueOnce(new ExtensionCommandGrantError(
      'COMMAND_IDEMPOTENCY_CONFLICT',
      409,
      'conflict',
    ));
    const conflict = await app.inject({
      method: 'POST',
      url: '/command-grants',
      payload: publishPayload(),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ errorCode: 'COMMAND_IDEMPOTENCY_CONFLICT' });

    for (const url of ['/command-grants/consume', '/command-grants/complete', '/command-grants/fail']) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(404);
    }
  });
});
