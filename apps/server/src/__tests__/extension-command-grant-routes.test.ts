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
import { createAiMediaListingDraftApplyFingerprint } from '../services/ai-media-listing-draft-application-mutations.js';
import { createExtensionMediaReviewCommandExecutor } from '../services/extension-media-review-commands.js';

function device(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes: ['listing:review', 'listing:write', 'media:execute', 'listing:publish'],
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
  const claimPendingRecovery = vi.fn(async (): Promise<any> => ({
    kind: 'acquired' as const,
    receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
  }));
  const complete = vi.fn(async ({ receiptId, result }: { receiptId: string; result: unknown }) => ({
    id: receiptId, status: 'SUCCEEDED', result, failureCode: null,
  }));
  const fail = vi.fn(async ({ receiptId, failureCode }: { receiptId: string; failureCode: string }) => ({
    id: receiptId, status: 'FAILED', result: null, failureCode,
  }));
  const executeOzonPublish = vi.fn(async (): Promise<{
    attemptId: string;
    state: 'PREPARED' | 'SUBMITTING' | 'SUBMITTED' | 'UNKNOWN' | 'REJECTED';
    lastErrorCode?: string | null;
  }> => ({ attemptId: 'attempt-1', state: 'SUBMITTED' }));
  const executeMediaWorkflowCommand = vi.fn(async (_input: Record<string, unknown>): Promise<{
    workflowId: string;
    action: 'CANCEL' | 'RETRY' | 'CREATE_TRANSLATION';
    operation?: 'IMAGE_TRANSLATE';
    status: string;
    revision: number;
    replayed?: boolean;
  }> => ({
    workflowId: 'media-1', action: 'CANCEL', status: 'CANCELLED', revision: 4,
  }));
  const executeMediaReviewCommand = vi.fn(async () => ({
    workflowId: 'media-1', action: 'REVIEW', status: 'SUCCEEDED',
    reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
    revision: 4, replayed: false,
  }));
  const executeMediaApplyCommand = vi.fn(async () => ({
    workflowId: 'media-1', action: 'APPLY', status: 'SUCCEEDED',
    reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
    revision: 5, applicationId: 'application-1',
    targetRevision: 12, targetDraftVersion: 8, replayed: false,
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
    service: { issue, authorize, claimPendingRecovery, complete, fail },
    authenticateDevice, resolveCommand,
    executeOzonPublish, executeMediaWorkflowCommand,
    executeMediaReviewCommand, executeMediaApplyCommand,
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

function mediaReviewCommand(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ai-media-workflow-review/v1', action: 'REVIEW',
    mediaWorkflowId: 'media-1', expectedRevision: 3, draftRevision: 11,
    outputAssetId: 'output-1', decision: 'APPROVE', note: null,
    ...overrides,
  };
}

function mediaApplyCommand(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ai-media-workflow-apply/v1', action: 'APPLY',
    mediaWorkflowId: 'media-1', expectedWorkflowRevision: 4,
    expectedTargetRevision: 11, expectedTargetDraftVersion: 7,
    outputAssetId: 'output-1', mode: 'append',
    ...overrides,
  };
}

function mediaApplyRecord(overrides: Record<string, unknown> = {}) {
  return {
    assetId: 'output-1',
    operationKey: 'media-apply-operation-1',
    requestFingerprint: createAiMediaListingDraftApplyFingerprint({
      workflowId: 'media-1', mode: 'append', expectedWorkflowRevision: 4,
      expectedTargetRevision: 11, expectedTargetDraftVersion: 7,
      replaceConfirmed: false,
    }),
    workflowRevisionBefore: 4, workflowRevisionAfter: 5,
    targetRevisionBefore: 11, targetDraftVersionBefore: 7,
    targetRevisionAfter: 12, targetDraftVersionAfter: 8,
    rolledBackById: null,
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
    expect(index).toContain('createExtensionByokSystemConfigPolicyLoader');
    expect(index).toContain('readSnapshot: () => getStrictConfigSnapshot(EXTENSION_BYOK_CONFIG_KEYS)');
    expect(index).toContain('getByokReadiness: (input) => extensionByokPolicyEvaluator.evaluate(input)');
    expect(index).toContain('resolveCommand: extensionCommandRoutesOptions.resolveCommand');
    expect(index).toContain("prefix: '/api/extension-device/byok-media'");
    expect(index.match(/getMediaWorkflowDecision: getAiMediaRolloutDecision/gu)).toHaveLength(3);
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
    expect(response.json().data).not.toHaveProperty('requestHash');
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

  it('exposes the exact request hash only when issuing or replaying a BYOK ingest grant', async () => {
    const deps = await buildApp({
      device: { scopes: ['byok:media:ingest'] },
    });
    const payload = {
      operation: 'BYOK_MEDIA_INGEST',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      idempotencyKey: 'byok-media-ingest-grant-0001',
      command: { schemaVersion: 'extension-byok-media-ingest-command/v1' },
    };
    const expectedHash = hashExtensionCommandRequest({
      operation: 'BYOK_MEDIA_INGEST',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: payload.command,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await deps.app.inject({ method: 'POST', url: '/command-grants', payload });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        code: 1,
        data: {
          grantId: 'grant-1', grantToken: 'g'.repeat(43), requestHash: expectedHash,
        },
      });
      expect(JSON.stringify(response.json())).not.toMatch(/tokenDigest|ownerUserId|sessionId|secret/iu);
    }
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
      idempotencyKey: 'publish-workflow-1-v7',
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

  it('recovers a pending Ozon receipt through the idempotent publisher after the recovery lease', async () => {
    const deps = await buildApp();
    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
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
    expect(response.json()).toMatchObject({
      code: 1,
      data: { replay: true, receipt: { id: 'receipt-1', status: 'SUCCEEDED' } },
    });
    expect(deps.service.claimPendingRecovery).toHaveBeenCalledWith({ receiptId: 'receipt-1' });
    expect(deps.executeOzonPublish).toHaveBeenCalledTimes(1);
    expect(deps.service.complete).toHaveBeenCalledTimes(1);
  });

  it('keeps an acquired recovery receipt pending when the publisher outcome is still unknown', async () => {
    const deps = await buildApp();
    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    });
    deps.executeOzonPublish.mockResolvedValueOnce({ attemptId: 'attempt-1', state: 'UNKNOWN' });

    const response = await deps.app.inject({
      method: 'POST', url: '/ozon-publish/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { replay: true, receipt: { id: 'receipt-1', status: 'PENDING' } },
    });
    expect(deps.service.complete).not.toHaveBeenCalled();
    expect(deps.service.fail).not.toHaveBeenCalled();
  });

  it.each(['PREPARED', 'SUBMITTING', 'UNKNOWN'] as const)(
    'keeps the command receipt pending while the Ozon attempt is %s',
    async (state) => {
      const deps = await buildApp();
      deps.executeOzonPublish.mockResolvedValueOnce({ attemptId: 'attempt-1', state });

      const response = await deps.app.inject({
        method: 'POST', url: '/ozon-publish/execute',
        headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
        payload: {
          shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
          idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { replay: false, receipt: { id: 'receipt-1', status: 'PENDING' } },
      });
      expect(deps.service.complete).not.toHaveBeenCalled();
      expect(deps.service.fail).not.toHaveBeenCalled();
    },
  );

  it('fails the command receipt when Ozon rejects the publish attempt', async () => {
    const deps = await buildApp();
    deps.executeOzonPublish.mockResolvedValueOnce({
      attemptId: 'attempt-1', state: 'REJECTED', lastErrorCode: 'OZON_IMPORT_REJECTED',
    });

    const response = await deps.app.inject({
      method: 'POST', url: '/ozon-publish/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'publish_failed',
      data: { receipt: { status: 'FAILED', failureCode: 'OZON_IMPORT_REJECTED' } },
    });
    expect(deps.service.complete).not.toHaveBeenCalled();
    expect(deps.service.fail).toHaveBeenCalledWith({
      receiptId: 'receipt-1', failureCode: 'OZON_IMPORT_REJECTED', result: null,
    });
  });

  it.each([null, '429'])(
    'uses a stable failure code when a rejected attempt has invalid code %s',
    async (lastErrorCode) => {
      const deps = await buildApp();
      deps.executeOzonPublish.mockResolvedValueOnce({
        attemptId: 'attempt-1', state: 'REJECTED', lastErrorCode,
      });

      const response = await deps.app.inject({
        method: 'POST', url: '/ozon-publish/execute',
        headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
        payload: {
          shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
          idempotencyKey: 'publish-workflow-1-v7', command: { action: 'submit' },
        },
      });

      expect(response.statusCode).toBe(409);
      expect(deps.service.fail).toHaveBeenCalledWith({
        receiptId: 'receipt-1', failureCode: 'OZON_SUBMIT_REJECTED', result: null,
      });
    },
  );

  it('recovers MEDIA_EXECUTE after the process exits between authorization and execution', async () => {
    const deps = await buildApp();
    const pendingReceipt = {
      id: 'receipt-1', status: 'PENDING', result: null, failureCode: null,
    };
    deps.service.authorize.mockResolvedValueOnce({ kind: 'replay', receipt: pendingReceipt });

    // A previous process durably consumed the grant, then exited before
    // invoking the business executor. This process sees only its PENDING receipt.
    expect(deps.executeMediaWorkflowCommand).not.toHaveBeenCalled();

    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: mediaPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { replay: true, receipt: { status: 'SUCCEEDED' } },
    });
    expect(deps.service.claimPendingRecovery).toHaveBeenCalledWith({ receiptId: 'receipt-1' });
    expect(deps.executeMediaWorkflowCommand).toHaveBeenCalledTimes(1);
    expect(deps.service.complete).toHaveBeenCalledTimes(1);
    expect(deps.service.fail).not.toHaveBeenCalled();
  });

  it('recovers MEDIA_EXECUTE completion loss without duplicate cost or business writes', async () => {
    const command = {
      schemaVersion: 'ai-media-workflow-create/v1', action: 'CREATE_TRANSLATION',
      sourceMediaKey: 'media-main-1', draftRevision: 11,
      workflowOperationKey: 'extension-media-workflow:receipt-recovery-1',
    };
    const payload = mediaPayload({
      idempotencyKey: 'media-execute-recovery-1',
      command,
    });
    const deps = await buildApp({
      resolution: {
        kind: 'allowed', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, command,
      },
    });
    const businessLedger = new Set<string>();
    let chargedUnits = 0;
    let businessWrites = 0;
    deps.executeMediaWorkflowCommand.mockImplementation(async (input: any) => {
      const operationKey = `${input.idempotencyKey}:${input.command.workflowOperationKey}`;
      const replayed = businessLedger.has(operationKey);
      if (!replayed) {
        businessLedger.add(operationKey);
        chargedUnits += 1;
        businessWrites += 1;
      }
      return {
        workflowId: 'media-created-1', action: 'CREATE_TRANSLATION' as const,
        operation: 'IMAGE_TRANSLATE' as const, status: 'QUEUED', revision: 1, replayed,
      };
    });
    deps.service.complete.mockRejectedValueOnce(new Error('receipt completion unavailable'));

    const first = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) }, payload,
    });
    expect(first.statusCode).toBe(500);
    expect(chargedUnits).toBe(1);
    expect(businessWrites).toBe(1);
    expect(deps.service.fail).not.toHaveBeenCalled();

    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    });
    const recovered = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) }, payload,
    });

    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      code: 1,
      data: {
        replay: true,
        receipt: { status: 'SUCCEEDED', result: { replayed: true } },
      },
    });
    expect(deps.service.claimPendingRecovery).toHaveBeenCalledTimes(1);
    expect(deps.executeMediaWorkflowCommand).toHaveBeenCalledTimes(2);
    expect(deps.executeMediaWorkflowCommand.mock.calls.map(([input]) => input.idempotencyKey))
      .toEqual(['media-execute-recovery-1', 'media-execute-recovery-1']);
    expect(chargedUnits).toBe(1);
    expect(businessWrites).toBe(1);
    expect(deps.service.complete).toHaveBeenCalledTimes(2);
    expect(deps.service.fail).not.toHaveBeenCalled();
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

  it('consumes a CREATE_TRANSLATION grant with the resolved command and records its workflow result', async () => {
    const command = {
      schemaVersion: 'ai-media-workflow-create/v1', action: 'CREATE_TRANSLATION',
      sourceMediaKey: 'media-main-1', draftRevision: 11,
      workflowOperationKey: 'extension-media-workflow:test-1',
    };
    const deps = await buildApp({
      resolution: {
        kind: 'allowed', shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7, command,
      },
    });
    deps.executeMediaWorkflowCommand.mockResolvedValueOnce({
      workflowId: 'media-created-1', action: 'CREATE_TRANSLATION', operation: 'IMAGE_TRANSLATE',
      status: 'QUEUED', revision: 1, replayed: false,
    });
    const payload = {
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'extension-media-create-attempt-1', command,
    };
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) }, payload,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      code: 1, data: { receipt: { status: 'SUCCEEDED', result: {
        workflowId: 'media-created-1', action: 'CREATE_TRANSLATION', operation: 'IMAGE_TRANSLATE',
      } } },
    });
    expect(deps.executeMediaWorkflowCommand).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      listingWorkflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'extension-media-create-attempt-1', command,
    });
  });

  it('binds media review execution to listing:review and a MEDIA_REVIEW grant', async () => {
    const deps = await buildApp();
    const command = mediaReviewCommand();
    const payload = {
      operation: 'MEDIA_REVIEW', shopId: 'shop-1', workflowId: 'workflow-1',
      draftVersion: 7, idempotencyKey: 'media-review-operation-1', command,
    };
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) }, payload,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ data: { receipt: { result: {
      action: 'REVIEW', reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
    } } } });
    expect(deps.service.authorize).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'MEDIA_REVIEW', idempotencyKey: 'media-review-operation-1',
      requestHash: hashExtensionCommandRequest({
        operation: 'MEDIA_REVIEW', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, command,
      }),
    }));
    expect(deps.executeMediaReviewCommand).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', listingWorkflowId: 'workflow-1',
      idempotencyKey: 'media-review-operation-1', command,
    }));
    expect(deps.executeMediaApplyCommand).not.toHaveBeenCalled();
  });

  it('recovers a PENDING media apply receipt through the application ledger executor', async () => {
    const deps = await buildApp();
    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    });
    deps.executeMediaApplyCommand.mockResolvedValueOnce({
      workflowId: 'media-1', action: 'APPLY', status: 'SUCCEEDED',
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
      revision: 5, applicationId: 'application-1',
      targetRevision: 12, targetDraftVersion: 8, replayed: true,
    });
    const command = mediaApplyCommand();
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        operation: 'MEDIA_APPLY', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, idempotencyKey: 'media-apply-operation-1', command,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { replay: true, receipt: { status: 'SUCCEEDED', result: {
        action: 'APPLY', applicationId: 'application-1', replayed: true,
      } } },
    });
    expect(deps.executeMediaApplyCommand).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'media-apply-operation-1', command,
    }));
    expect(deps.service.complete).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: 'receipt-1',
    }));
  });

  it('keeps a successful media mutation recoverable when receipt completion fails', async () => {
    const deps = await buildApp();
    deps.service.complete.mockRejectedValueOnce(new Error('receipt store unavailable'));
    const payload = {
      operation: 'MEDIA_REVIEW', shopId: 'shop-1', workflowId: 'workflow-1',
      draftVersion: 7, idempotencyKey: 'media-review-operation-1',
      command: mediaReviewCommand(),
    };
    const first = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) }, payload,
    });
    expect(first.statusCode).toBe(500);
    expect(deps.executeMediaReviewCommand).toHaveBeenCalledTimes(1);
    expect(deps.service.fail).not.toHaveBeenCalled();

    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    });
    deps.executeMediaReviewCommand.mockResolvedValueOnce({
      workflowId: 'media-1', action: 'REVIEW', status: 'SUCCEEDED',
      reviewStatus: 'APPROVED', selectedOutputAssetId: 'output-1',
      revision: 4, replayed: true,
    });
    const recovered = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) }, payload,
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      data: { replay: true, receipt: { status: 'SUCCEEDED' } },
    });
    expect(deps.service.claimPendingRecovery).toHaveBeenCalledTimes(1);
    expect(deps.executeMediaReviewCommand).toHaveBeenCalledTimes(2);
    expect(deps.service.fail).not.toHaveBeenCalled();
  });

  it('preserves a PENDING receipt when an applied mutation result is temporarily unavailable', async () => {
    const deps = await buildApp();
    deps.executeMediaApplyCommand.mockRejectedValueOnce(Object.assign(
      new Error('application projection unavailable'),
      { code: 'MEDIA_APPLY_STATE_UNAVAILABLE' },
    ));
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        operation: 'MEDIA_APPLY', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, idempotencyKey: 'media-apply-operation-1',
        command: mediaApplyCommand(),
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      errorCode: 'media_command_unavailable',
      data: { receipt: { status: 'PENDING' } },
    });
    expect(deps.service.fail).not.toHaveBeenCalled();
    expect(deps.service.complete).not.toHaveBeenCalled();
  });

  it('does not execute a concurrent PENDING media recovery without the receipt lease', async () => {
    const deps = await buildApp();
    deps.service.authorize.mockResolvedValueOnce({
      kind: 'replay',
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    });
    deps.service.claimPendingRecovery.mockResolvedValueOnce({
      kind: 'not_ready',
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    });
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        operation: 'MEDIA_REVIEW', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, idempotencyKey: 'media-review-operation-1',
        command: mediaReviewCommand(),
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      data: { replay: true, receipt: { status: 'PENDING' } },
    });
    expect(deps.executeMediaReviewCommand).not.toHaveBeenCalled();
    expect(deps.service.complete).not.toHaveBeenCalled();
    expect(deps.service.fail).not.toHaveBeenCalled();
  });

  it('recovers a PENDING review only through its exact persisted event operation key', async () => {
    let current: any = {
      id: 'media-1', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      status: 'SUCCEEDED', reviewStatus: 'PENDING', revision: 3,
      contextType: 'listing-draft', contextId: 'workflow-1',
      contextDraftRevision: 11, contextDraftVersion: 7, suiteId: null,
      selectedOutputAssetId: null, events: [],
      jobs: [{
        id: 'job-1', provider: 'fake', status: 'SUCCEEDED',
        assets: [{
          id: 'output-1', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          kind: 'AI_GENERATED', storageBackend: 'local',
        }],
      }],
    };
    const listing = {
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      revision: 11, draftVersion: 7,
    };
    const workflowService = {
      get: vi.fn(async () => current),
      review: vi.fn(async (input: any) => {
        current = {
          ...current,
          reviewStatus: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          selectedOutputAssetId: input.outputAssetId,
          revision: input.expectedRevision + 1,
          events: [{
            eventKey: `media-1:review:${input.expectedRevision}`,
            eventType: input.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED',
            assetId: input.outputAssetId,
            payload: { note: input.note, operationKey: input.operationKey },
          }],
        };
        return current;
      }),
    };
    const executeReview = createExtensionMediaReviewCommandExecutor({
      workflowService,
      loadListingDraft: vi.fn(async () => listing),
      production: false,
    });
    const command = mediaReviewCommand();
    await executeReview({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      listingWorkflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-review-operation-1', command,
    });

    const authorize = vi.fn(async () => ({
      kind: 'replay' as const,
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    }));
    const claimPendingRecovery = vi.fn(async () => ({
      kind: 'acquired' as const,
      receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null },
    }));
    const complete = vi.fn(async ({ receiptId, result }: any) => ({
      id: receiptId, status: 'SUCCEEDED', result, failureCode: null,
    }));
    const app = Fastify();
    await app.register(extensionCommandGrantRoutes, {
      service: {
        issue: vi.fn(), authorize, claimPendingRecovery, complete, fail: vi.fn(),
      },
      authenticateDevice: async (request: FastifyRequest) => {
        (request as any).device = device();
      },
      resolveCommand: createSourceWorkflowCommandResolver({
        featureFlags: { evaluate: vi.fn(async () => ({
          enabled: true, legacyAllowed: false, captureStage: null,
          reason: 'pilot_match' as const, revision: 'pilot-1',
        })) },
        loadShop: vi.fn(async () => ({
          id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
        })),
        loadDraft: vi.fn(async () => ({
          ...listing, stage: 'MEDIA_REVIEW', selectedSkuKeys: [], publishTaskIds: [],
        })),
        loadMediaWorkflow: vi.fn(async () => ({
          ...current,
          provider: current.jobs[0].provider,
          currentJobStatus: current.jobs[0].status,
          outputAssetIds: current.jobs[0].assets.map((asset: any) => asset.id),
          reviewEvents: current.events,
          applications: [],
        })),
      }),
      executeMediaReviewCommand: executeReview,
    } as never);
    const response = await app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        operation: 'MEDIA_REVIEW', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, idempotencyKey: 'media-review-operation-1', command,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { replay: true, receipt: { result: { action: 'REVIEW', replayed: true } } },
    });
    expect(workflowService.review).toHaveBeenCalledTimes(1);
    expect(claimPendingRecovery).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('requires listing:write for media application execution', async () => {
    const deps = await buildApp({ device: { scopes: ['listing:review'] } });
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        operation: 'MEDIA_APPLY', shopId: 'shop-1', workflowId: 'workflow-1',
        draftVersion: 7, idempotencyKey: 'media-apply-operation-1',
        command: mediaApplyCommand(),
      },
    });
    expect(response.statusCode).toBe(403);
    expect(deps.service.authorize).not.toHaveBeenCalled();
    expect(deps.executeMediaApplyCommand).not.toHaveBeenCalled();
  });

  it('reports transient media context failures as unavailable instead of a client conflict', async () => {
    const deps = await buildApp();
    deps.executeMediaWorkflowCommand.mockRejectedValueOnce(Object.assign(
      new Error('database unavailable'),
      { code: 'MEDIA_CONTEXT_UNAVAILABLE' },
    ));
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: {
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey: 'media-command-operation-1', command: mediaCommand(),
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ errorCode: 'media_command_unavailable' });
    expect(deps.service.fail).toHaveBeenCalledWith({
      receiptId: 'receipt-1', failureCode: 'MEDIA_CONTEXT_UNAVAILABLE', result: null,
    });
  });

  it.each([
    'IMAGE_TRANSLATION_QUOTA_EXCEEDED',
    'AI_IMAGE_EDIT_QUOTA_EXCEEDED',
  ])('reports %s as a rate-limited failed receipt', async (failureCode) => {
    const deps = await buildApp();
    deps.executeMediaWorkflowCommand.mockRejectedValueOnce(Object.assign(
      new Error('daily quota exhausted'),
      { code: failureCode },
    ));
    const response = await deps.app.inject({
      method: 'POST', url: '/media-workflows/execute',
      headers: { 'x-ss-erp-command-grant': 'g'.repeat(43) },
      payload: mediaPayload(),
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      errorCode: 'media_quota_exceeded',
      data: { receipt: { status: 'FAILED', failureCode } },
    });
    expect(deps.service.fail).toHaveBeenCalledWith({
      receiptId: 'receipt-1', failureCode, result: null,
    });
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

  it('fails closed before issuing an Ozon grant when BYOK publish policy denies the draft', async () => {
    const authorizeByokPublish = vi.fn(async () => {
      throw Object.assign(new Error('BYOK publish is disabled'), {
        code: 'EXTENSION_BYOK_PUBLISH_DISABLED', statusCode: 409,
      });
    });
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
        media: { assignments: [{ assetId: 'asset-byok' }] },
      })),
      authorizeByokPublish,
    });

    await expect(resolve({
      sessionId: 'session-publisher', ownerUserId: 'owner-1', operation: 'OZON_PUBLISH',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: {
        schemaVersion: 'ozon-publish-command/v1', draftRevision: 11,
        publishIntentId: 'intent-1', selectedSkuKeys: ['sku-1'],
      },
    })).resolves.toEqual({ kind: 'unavailable' });
    expect(authorizeByokPublish).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      assignments: [{ assetId: 'asset-byok' }],
      requestingDeviceSessionId: 'session-publisher',
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

  it('resolves an exact listing-draft translation create command without accepting provider fields', async () => {
    const evaluate = vi.fn(async () => ({
      enabled: true, legacyAllowed: false, captureStage: null,
      reason: 'pilot_match' as const, revision: 'pilot-1',
    }));
    const loadMediaLaunchContext = vi.fn(async () => ({
      sourceMediaKeys: ['media-main-1', 'media-detail-1'],
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
      loadMediaLaunchContext,
    });
    const command = {
      schemaVersion: 'ai-media-workflow-create/v1', action: 'CREATE_TRANSLATION',
      sourceMediaKey: 'media-main-1', draftRevision: 11,
      workflowOperationKey: 'extension-media-workflow:test-1',
    };
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7, command,
    })).resolves.toEqual({
      kind: 'allowed', shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7, command,
    });
    expect(loadMediaLaunchContext).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', workflowId: 'workflow-1', draftRevision: 11,
      draftVersion: 7, sourceMediaKey: 'media-main-1',
    });
    expect(evaluate).toHaveBeenCalledWith('SOURCE_LISTING_EXTENSION_WORKBENCH', expect.any(Object));

    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: { ...command, provider: 'dashscope-qwen-mt-image' },
    })).resolves.toEqual({ kind: 'forbidden' });
  });

  it('resolves a strict v2 standalone create against every current source key', async () => {
    const evaluate = vi.fn(async () => ({
      enabled: true, legacyAllowed: false, captureStage: null,
      reason: 'pilot_match' as const, revision: 'pilot-1',
    }));
    const loadMediaLaunchContext = vi.fn(async () => ({
      sourceMediaKeys: ['media-main-1', 'media-detail-1'],
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
      loadMediaLaunchContext,
    });
    const command = {
      schemaVersion: 'ai-media-workflow-create/v2', action: 'CREATE_WORKFLOW',
      operation: 'IMAGE_TO_IMAGE', sourceMediaKeys: ['media-main-1', 'media-detail-1'],
      prompt: 'Improve the background.', negativePrompt: '', draftRevision: 11,
      workflowOperationKey: 'extension-media-workflow:v2-grant-1',
    };
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7, command,
    })).resolves.toEqual({
      kind: 'allowed', shopId: 'shop-1', workflowId: 'workflow-1',
      draftVersion: 7, command,
    });
    expect(loadMediaLaunchContext).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', workflowId: 'workflow-1', draftRevision: 11,
      draftVersion: 7, sourceMediaKey: 'media-main-1',
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: { ...command, sourceMediaKeys: ['media-main-1', 'missing-media'] },
    })).resolves.toEqual({ kind: 'stale' });
  });

  it.each([
    ['tenant_not_allowed', 'unavailable'],
    ['invalid_policy', 'rollout_unavailable'],
    ['policy_invalid', 'rollout_unavailable'],
  ] as const)('maps a canonical AI media denial reason %s to %s', async (reason, kind) => {
    const evaluate = vi.fn(async () => ({
      enabled: true, legacyAllowed: false, captureStage: null,
      reason: 'pilot_match' as const, revision: 'source-policy-1',
    }));
    const getMediaWorkflowDecision = vi.fn(async () => ({
      enabled: false, reason, revision: 9,
    }));
    const loadMediaLaunchContext = vi.fn();
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate },
      getMediaWorkflowDecision,
      loadShop: vi.fn(),
      loadDraft: vi.fn(),
      loadMediaLaunchContext,
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: {
        schemaVersion: 'ai-media-workflow-create/v2', action: 'CREATE_WORKFLOW',
        operation: 'IMAGE_TO_IMAGE', sourceMediaKeys: ['media-main-1'],
        prompt: 'Improve the background.', negativePrompt: '', draftRevision: 11,
        workflowOperationKey: 'extension-media-workflow:canonical-deny',
      },
    })).resolves.toEqual({ kind });
    expect(getMediaWorkflowDecision).toHaveBeenCalledWith('owner-1');
    expect(loadMediaLaunchContext).not.toHaveBeenCalled();
  });

  it('rejects a translation create command when its source or draft revision is stale', async () => {
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
      loadMediaLaunchContext: vi.fn(async () => ({ sourceMediaKeys: ['media-main-1'] })),
    });
    const base = {
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE' as const,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: {
        schemaVersion: 'ai-media-workflow-create/v1', action: 'CREATE_TRANSLATION',
        sourceMediaKey: 'media-main-1', draftRevision: 11,
        workflowOperationKey: 'extension-media-workflow:test-2',
      },
    };
    await expect(resolve({ ...base, command: { ...base.command, sourceMediaKey: 'missing' } }))
      .resolves.toEqual({ kind: 'stale' });
    await expect(resolve({ ...base, command: { ...base.command, draftRevision: 10 } }))
      .resolves.toEqual({ kind: 'stale' });
  });

  it('does not read tenant media context while the extension rollout is dark', async () => {
    const loadShop = vi.fn(async () => ({
      id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
    }));
    const loadDraft = vi.fn(async () => ({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 7, revision: 11, stage: 'MEDIA_REVIEW',
      selectedSkuKeys: ['sku-1'], publishTaskIds: [],
    }));
    const loadMediaLaunchContext = vi.fn(async () => ({ sourceMediaKeys: ['media-main-1'] }));
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate: vi.fn(async (feature: string) => ({
        enabled: feature !== 'SOURCE_LISTING_EXTENSION_WORKBENCH',
        legacyAllowed: false, captureStage: null,
        reason: 'master_off' as const, revision: 'master-off',
      })) },
      loadShop, loadDraft, loadMediaLaunchContext,
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_EXECUTE',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: {
        schemaVersion: 'ai-media-workflow-create/v1', action: 'CREATE_TRANSLATION',
        sourceMediaKey: 'media-main-1', draftRevision: 11,
        workflowOperationKey: 'extension-media-workflow:dark-1',
      },
    })).resolves.toEqual({ kind: 'unavailable' });
    expect(loadShop).not.toHaveBeenCalled();
    expect(loadDraft).not.toHaveBeenCalled();
    expect(loadMediaLaunchContext).not.toHaveBeenCalled();
  });

  it('resolves an exact pending media review and an already-applied draft replay', async () => {
    const evaluate = vi.fn(async () => ({
      enabled: true, legacyAllowed: false, captureStage: null,
      reason: 'pilot_match' as const, revision: 'pilot-1',
    }));
    const currentMedia: any = {
      id: 'media-1', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
      contextType: 'listing-draft', contextId: 'workflow-1',
      contextDraftRevision: 11, contextDraftVersion: 7,
      revision: 3, status: 'SUCCEEDED', reviewStatus: 'PENDING',
      selectedOutputAssetId: null, suiteId: null, provider: 'fake',
      currentJobStatus: 'SUCCEEDED', outputAssetIds: ['output-1'],
      reviewEvents: [], applications: [],
    };
    const loadMediaWorkflow = vi.fn(async () => currentMedia);
    const loadDraft = vi.fn(async () => ({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 7, revision: 11, stage: 'MEDIA_REVIEW',
      selectedSkuKeys: ['sku-1'], publishTaskIds: [],
    }));
    const resolve = createSourceWorkflowCommandResolver({
      featureFlags: { evaluate },
      loadShop: vi.fn(async () => ({
        id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
      })),
      loadDraft,
      loadMediaWorkflow,
    });

    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_REVIEW',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-review-operation-1',
      command: mediaReviewCommand(),
    })).resolves.toMatchObject({ kind: 'allowed', command: mediaReviewCommand() });

    const reviewedMedia = {
      ...currentMedia, revision: 4, reviewStatus: 'APPROVED',
      selectedOutputAssetId: 'output-1',
      reviewEvents: [{
        eventKey: 'media-1:review:3', eventType: 'REVIEW_APPROVED',
        assetId: 'output-1', payload: {
          note: null, operationKey: 'media-review-operation-1',
        },
      }],
    };
    loadMediaWorkflow.mockResolvedValueOnce(reviewedMedia);
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_REVIEW',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-review-operation-1',
      command: mediaReviewCommand(),
    })).resolves.toMatchObject({ kind: 'allowed' });
    loadDraft.mockResolvedValueOnce({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 8, revision: 12, stage: 'MEDIA_REVIEW',
      selectedSkuKeys: ['sku-1'], publishTaskIds: [],
    });
    loadMediaWorkflow.mockResolvedValueOnce({ ...reviewedMedia, revision: 5 });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_REVIEW',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-review-operation-1',
      command: mediaReviewCommand(),
    })).resolves.toMatchObject({ kind: 'allowed', draftVersion: 7 });
    loadMediaWorkflow.mockResolvedValueOnce(reviewedMedia);
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_REVIEW',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'different-media-review-operation',
      command: mediaReviewCommand(),
    })).resolves.toEqual({ kind: 'stale' });
    loadMediaWorkflow.mockResolvedValueOnce(reviewedMedia);
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_REVIEW',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-review-operation-1',
      command: mediaReviewCommand({ note: 'changed command' }),
    })).resolves.toEqual({ kind: 'stale' });

    loadDraft.mockResolvedValueOnce({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 8, revision: 12, stage: 'MEDIA_REVIEW',
      selectedSkuKeys: ['sku-1'], publishTaskIds: [],
    });
    loadMediaWorkflow.mockResolvedValueOnce({
      ...currentMedia, revision: 5, reviewStatus: 'APPROVED',
      selectedOutputAssetId: 'output-1', applications: [mediaApplyRecord()],
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_APPLY',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-apply-operation-1',
      command: mediaApplyCommand(),
    })).resolves.toMatchObject({
      kind: 'allowed', draftVersion: 7, command: mediaApplyCommand(),
    });

    loadDraft.mockResolvedValueOnce({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 8, revision: 12, stage: 'MEDIA_REVIEW',
      selectedSkuKeys: ['sku-1'], publishTaskIds: [],
    });
    loadMediaWorkflow.mockResolvedValueOnce({
      ...currentMedia, revision: 5, reviewStatus: 'APPROVED',
      selectedOutputAssetId: 'output-1', applications: [],
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_APPLY',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-apply-operation-1',
      command: mediaApplyCommand(),
    })).resolves.toEqual({ kind: 'stale' });

    for (const [idempotencyKey, application] of [
      ['different-media-apply-operation', mediaApplyRecord()],
      ['media-apply-operation-1', mediaApplyRecord({ rolledBackById: 'rollback-1' })],
      ['media-apply-operation-1', mediaApplyRecord({ requestFingerprint: 'f'.repeat(64) })],
    ] as const) {
      loadDraft.mockResolvedValueOnce({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
        draftVersion: 8, revision: 12, stage: 'MEDIA_REVIEW',
        selectedSkuKeys: ['sku-1'], publishTaskIds: [],
      });
      loadMediaWorkflow.mockResolvedValueOnce({
        ...currentMedia, revision: 5, reviewStatus: 'APPROVED',
        selectedOutputAssetId: 'output-1', applications: [application],
      });
      await expect(resolve({
        sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_APPLY',
        shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
        idempotencyKey,
        command: mediaApplyCommand(),
      })).resolves.toEqual({ kind: 'stale' });
    }
  });

  it.each([
    ['paid Provider', { provider: 'dashscope-qwen-mt-image' }],
    ['suite child', { suiteId: 'suite-1' }],
    ['foreign output', { outputAssetIds: ['other-output'] }],
    ['running job', { currentJobStatus: 'RUNNING' }],
  ])('rejects unsafe media review authority: %s', async (_label, patch) => {
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
        id: 'media-1', ownerUserId: 'owner-1', operation: 'IMAGE_TRANSLATE',
        contextType: 'listing-draft', contextId: 'workflow-1',
        contextDraftRevision: 11, contextDraftVersion: 7,
        revision: 3, status: 'SUCCEEDED', reviewStatus: 'PENDING',
        selectedOutputAssetId: null, suiteId: null, provider: 'fake',
        currentJobStatus: 'SUCCEEDED', outputAssetIds: ['output-1'],
        reviewEvents: [], applications: [], ...patch,
      })),
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: 'MEDIA_REVIEW',
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      idempotencyKey: 'media-review-operation-1',
      command: mediaReviewCommand(),
    })).resolves.toEqual({ kind: 'forbidden' });
  });

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
