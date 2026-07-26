import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_COMMAND_SCOPE_BY_OPERATION,
  createExtensionCommandGrantService,
  InMemoryExtensionCommandGrantStore,
} from '../services/extension-command-grants.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  EXTENSION_BYOK_MEDIA_INGEST_SCOPE,
  createByokMediaIngestCommandResolver,
  parseByokMediaIngestCommand,
  type ByokReadinessInput,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  EXTENSION_DEVICE_SCOPES,
  createExtensionDeviceSessionService,
} from '../services/extension-device-session.js';

const NOW = new Date('2026-07-25T08:00:00.000Z');
const SECRET = 'extension-command-grant-secret-for-byok-tests';
const TOKEN = 't'.repeat(43);
const HASH = 'a'.repeat(64);

function binding(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
    workflowId: 'workflow-1',
    draftVersion: 7,
    idempotencyKey: 'byok-ingest-workflow-1-v7',
    requestHash: HASH,
    ...overrides,
  } as const;
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin: 'https://images.example.com',
    providerOperation: 'IMAGE_TO_IMAGE',
    requestMode: 'multipart',
    model: 'image-model-v1',
    providerRequestIdSha256: HASH,
    promptSha256: HASH,
    negativePromptSha256: null,
    draftRevision: 11,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero:0',
    assignmentOrdinal: 0,
    assignmentMode: 'APPEND',
    replaceConfirmed: false,
    resultSha256: HASH,
    resultMimeType: 'image/png',
    resultSizeBytes: 1024,
    sourceSha256: null,
    referenceSha256s: [HASH],
    maskSha256: null,
    ...overrides,
  };
}

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'extension-byok-readiness/v1' as const,
    policyRevision: 7,
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
    ...overrides,
  };
}

describe('BYOK media ingest command grant', () => {
  it('uses an explicit-only operation scope that legacy/default sessions do not inherit', async () => {
    expect(EXTENSION_COMMAND_SCOPE_BY_OPERATION[EXTENSION_BYOK_MEDIA_INGEST_OPERATION])
      .toBe(EXTENSION_BYOK_MEDIA_INGEST_SCOPE);
    expect(EXTENSION_DEVICE_SCOPES).toContain(EXTENSION_BYOK_MEDIA_INGEST_SCOPE);

    const repository = {
      countOutstandingPairingCodes: vi.fn(async () => 0),
      shopsBelongToOwner: vi.fn(async () => true),
      consumePairingClaimAttemptBudget: vi.fn(async () => true),
      createPairingCode: vi.fn(async () => ({ kind: 'created' as const, id: 'pairing-1' })),
      claimPairingCodeAtomically: vi.fn(),
      rotateRefreshCredentialOrRevokeReuse: vi.fn(),
    };
    const service = createExtensionDeviceSessionService({
      repository,
      authConfig: {
        deploymentId: 'cloud', secret: SECRET,
        issuer: 'ss-erp-test', audience: 'ss-erp-extension-test',
      },
      now: () => NOW,
    });

    await expect(service.createPairingCode({
      actorUserId: 'owner-1', ownerUserId: 'owner-1', actorParentId: null,
      shopIds: ['shop-1'],
    })).resolves.toMatchObject({
      scopes: expect.not.arrayContaining([EXTENSION_BYOK_MEDIA_INGEST_SCOPE]),
    });
    await expect(service.createPairingCode({
      actorUserId: 'owner-1', ownerUserId: 'owner-1', actorParentId: null,
      shopIds: ['shop-1'], scopes: [EXTENSION_BYOK_MEDIA_INGEST_SCOPE],
    })).resolves.toMatchObject({ scopes: [EXTENSION_BYOK_MEDIA_INGEST_SCOPE] });
  });

  it('accepts a strict, non-secret ingest command and rejects arbitrary fields', () => {
    expect(parseByokMediaIngestCommand(command())).toMatchObject({
      schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
      providerOrigin: 'https://images.example.com',
      providerOperation: 'IMAGE_TO_IMAGE',
    });
    expect(() => parseByokMediaIngestCommand({ ...command(), apiKey: 'secret' }))
      .toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommand({ ...command(), resultSha256: 'not-a-hash' }))
      .toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommand({ ...command(), assignmentOrdinal: -1 }))
      .toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommand({ ...command(), assignmentMode: 'REPLACE' }))
      .toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommand({
      ...command(), assignmentMode: 'REPLACE', replaceConfirmed: true,
    })).not.toThrow();
    expect(() => parseByokMediaIngestCommand({ ...command(), slotKey: 'sku:sku-2:hero:0' }))
      .toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommand({ ...command(), providerResultUrl: 'https://evil.example/result.png' }))
      .toThrow(/invalid/i);
  });

  it('resolves only the live owner/shop/workflow/draft and authenticated BYOK readiness', async () => {
    const loadShop = vi.fn(async () => ({
      id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
    }));
    const loadDraft = vi.fn(async () => ({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 7, revision: 11,
      sourceCaptureSnapshotId: 'snapshot-1', selectedSkuKeys: ['sku-1'],
    }));
    const getReadiness = vi.fn(async (input: ByokReadinessInput) => readiness({
      context: {
        ownerUserId: input.ownerUserId,
        shopId: input.shopId,
        deviceSessionId: input.deviceSessionId,
        providerOrigin: input.providerOrigin,
        operation: input.operation,
      },
    } as Record<string, unknown>));
    const resolve = createByokMediaIngestCommandResolver({ loadShop, loadDraft, getReadiness });

    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: command(),
    })).resolves.toMatchObject({
      kind: 'allowed', shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: {
        ...command(),
        readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 7 },
        authority: { sourceCaptureSnapshotId: 'snapshot-1' },
      },
    });
    expect(getReadiness).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', shopId: 'shop-1', deviceSessionId: 'session-1',
      providerOrigin: 'https://images.example.com', operation: 'IMAGE_TO_IMAGE',
    }));

    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 8,
      command: command(),
    })).resolves.toMatchObject({ kind: 'stale' });

    loadDraft.mockResolvedValueOnce({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 8, revision: 12,
      sourceCaptureSnapshotId: 'snapshot-1', selectedSkuKeys: ['sku-1'],
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1',
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      purpose: 'execute', command: command(),
    })).resolves.toMatchObject({
      kind: 'allowed', workflowId: 'workflow-1', draftVersion: 7,
      command: { draftRevision: 11, authority: { sourceCaptureSnapshotId: 'snapshot-1' } },
    });

    getReadiness.mockResolvedValueOnce(readiness({
      capabilities: {
        generation: { enabled: true, ready: true, reasonCode: 'READY' as const },
        ingest: { enabled: false, ready: false, reasonCode: 'INGEST_DISABLED' as const },
        publish: { enabled: true, ready: true, reasonCode: 'READY' as const },
      },
    }));
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
      command: command(),
    })).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it.each([
    ['missing policy revision', readiness({ policyRevision: null })],
    ['wrong contract', readiness({ contractVersion: 'other/v1' })],
    ['wrong owner context', readiness({ context: { ...readiness().context, ownerUserId: 'owner-2' } })],
    ['wrong provider context', readiness({ context: { ...readiness().context, providerOrigin: 'https://other.example.com' } })],
    ['generation only', readiness({
      capabilities: {
        generation: { enabled: true, ready: true, reasonCode: 'READY' as const },
        ingest: { enabled: false, ready: false, reasonCode: 'INGEST_DISABLED' as const },
        publish: { enabled: false, ready: false, reasonCode: 'PUBLISH_DISABLED' as const },
      },
    })],
    ['malformed object', { capabilities: null }],
  ] as const)('fails closed for %s readiness evidence', async (_label, evidence) => {
    const resolve = createByokMediaIngestCommandResolver({
      loadShop: async () => ({ id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE' }),
      loadDraft: async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1', draftVersion: 7, revision: 11,
        sourceCaptureSnapshotId: 'snapshot-1', selectedSkuKeys: ['sku-1'],
      }),
      getReadiness: async () => evidence as any,
    });
    await expect(resolve({
      sessionId: 'session-1', ownerUserId: 'owner-1', operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7, command: command(),
    })).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it.each([
    ['session', { sessionId: 'session-2' }],
    ['token', { tokenId: 'jti-2' }],
    ['owner', { ownerUserId: 'owner-2' }],
    ['shop', { shopId: 'shop-2' }],
    ['workflow', { workflowId: 'workflow-2' }],
    ['draft version', { draftVersion: 8 }],
    ['idempotency key', { idempotencyKey: 'byok-ingest-workflow-1-v8' }],
    ['request hash', { requestHash: 'b'.repeat(64) }],
  ] as const)('rejects a changed %s binding before receipt creation', async (_label, changed) => {
    const store = new InMemoryExtensionCommandGrantStore();
    const service = createExtensionCommandGrantService({
      store, secret: SECRET, now: () => NOW, deriveToken: () => TOKEN,
    });
    await service.issue(binding());
    await expect(service.authorize({ token: TOKEN, ...binding(changed) }))
      .rejects.toMatchObject({ code: 'COMMAND_GRANT_MISMATCH' });
    expect(store.snapshot().receipts).toHaveLength(0);
  });

  it.each([
    ['shop', { shopId: null }, 'COMMAND_SHOP_REQUIRED'],
    ['workflow', { workflowId: null }, 'COMMAND_BINDING_INVALID'],
    ['draft version', { draftVersion: null }, 'COMMAND_BINDING_INVALID'],
  ] as const)('requires a BYOK ingest %s binding at grant issue', async (_label, changed, code) => {
    const service = createExtensionCommandGrantService({
      store: new InMemoryExtensionCommandGrantStore(),
      secret: SECRET, now: () => NOW, deriveToken: () => TOKEN,
    });
    await expect(service.issue(binding(changed))).rejects.toMatchObject({ code });
  });

  it('does not admit expired or revoked BYOK grants', async () => {
    const store = new InMemoryExtensionCommandGrantStore();
    const service = createExtensionCommandGrantService({
      store, secret: SECRET, now: () => NOW, deriveToken: () => TOKEN,
    });
    await service.issue(binding());
    const expired = createExtensionCommandGrantService({
      store, secret: SECRET, now: () => new Date(NOW.getTime() + 60_001), deriveToken: () => TOKEN,
    });
    await expect(expired.authorize({ token: TOKEN, ...binding() }))
      .rejects.toMatchObject({ code: 'COMMAND_GRANT_EXPIRED' });
    expect(store.snapshot().receipts).toHaveLength(0);

    const revokedStore = new InMemoryExtensionCommandGrantStore();
    const revokedService = createExtensionCommandGrantService({
      store: revokedStore, secret: SECRET, now: () => NOW, deriveToken: () => TOKEN,
    });
    const issued = await revokedService.issue(binding({ idempotencyKey: 'byok-ingest-revoked-1' }));
    await revokedService.revoke({ grantId: issued.grantId, ownerUserId: 'owner-1', reason: 'SCOPE_REVOKED' });
    await expect(revokedService.authorize({
      token: TOKEN, ...binding({ idempotencyKey: 'byok-ingest-revoked-1' }),
    })).rejects.toMatchObject({ code: 'COMMAND_GRANT_REVOKED' });
    expect(revokedStore.snapshot().receipts).toHaveLength(0);
  });
});
