import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionByokExecutionIntentService,
  ExtensionByokExecutionIntentError,
  type ExtensionByokExecutionIntentClaimInput,
  type ExtensionByokExecutionIntentClaimResult,
} from '../services/extension-byok-execution-intent.js';
import type { ExtensionByokWorkbenchDraft } from '../services/extension-byok-workbench-launch.js';

const HASH = 'a'.repeat(64);

function draft(): ExtensionByokWorkbenchDraft {
  return {
    id: 'workflow-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    revision: 7,
    draftVersion: 11,
    supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureCurrent: true,
    sourcePlatform: '1688',
    sourceProductId: 'source-1',
    selectedSkuKeys: ['sku-1'],
    media: { assignments: [] },
    stage: 'MEDIA_REVIEW',
    runState: 'ACTIVE',
  };
}

function input(overrides: Partial<ExtensionByokExecutionIntentClaimInput> = {}) {
  return {
    identity: {
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      deviceSessionId: 'session-1',
    },
    binding: {
      contractVersion: 'extension-byok-readiness-binding/v2' as const,
      ownerUserId: 'owner-1',
      deviceSessionId: 'session-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 7,
      draftVersion: 11,
      sourcePlatform: '1688' as const,
      sourceProductId: 'source-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      assignmentMode: 'APPEND' as const,
      assignmentOrdinal: 0,
      providerOrigin: 'https://provider.example',
      model: 'image-model-1',
      operation: 'TEXT_TO_IMAGE' as const,
      policyRevision: '23',
    },
    requestMode: 'json' as const,
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH,
    ...overrides,
  };
}

function build(options: {
  enabled?: boolean;
  revision?: number;
  draft?: ExtensionByokWorkbenchDraft;
} = {}) {
  const repository = {
    claim: vi.fn(async (record): Promise<ExtensionByokExecutionIntentClaimResult> => ({
      kind: 'created' as const,
      intent: record,
    })),
    recordOutcome: vi.fn(async (record): Promise<any> => ({
      kind: 'updated' as const,
      intent: { id: record.intentId, ...record },
    })),
  };
  const service = createExtensionByokExecutionIntentService({
    loadShop: vi.fn(async () => ({
      id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
    })),
    loadDraft: vi.fn(async () => options.draft || draft()),
    evaluatePolicy: vi.fn(async (value) => ({
      contractVersion: 'extension-byok-readiness/v1' as const,
      allowed: options.enabled !== false,
      mode: 'pilot' as const,
      policyRevision: options.revision ?? 23,
      maxConcurrency: 1,
      context: value,
      capabilities: {
        generation: {
          enabled: options.enabled !== false,
          ready: options.enabled !== false,
          reasonCode: options.enabled !== false ? 'READY' as const : 'POLICY_DISABLED' as const,
        },
        ingest: { enabled: true, ready: true, reasonCode: 'READY' as const },
        publish: { enabled: false, ready: false, reasonCode: 'PUBLISH_DISABLED' as const },
      },
    })),
    repository,
    createId: () => 'intent-1',
    now: () => new Date('2026-07-27T06:00:00.000Z'),
  });
  return { service, repository };
}

describe('extension BYOK execution intent', () => {
  it('claims the exact draft mode before Provider dispatch without persisting the raw origin', async () => {
    const { service, repository } = build();
    const result = await service.claim(input());

    expect(result).toMatchObject({
      replayed: false,
      intent: {
        id: 'intent-1', executionMode: 'BYOK', requestMode: 'json',
        providerIdempotencyKey: 'provider-attempt-0001', providerRequestHash: HASH,
      },
    });
    expect(result.intent.providerOriginSha256).toBe(
      createHash('sha256').update('https://provider.example').digest('hex'),
    );
    expect(JSON.stringify(repository.claim.mock.calls)).not.toContain('https://provider.example');
  });

  it('replays the same immutable attempt returned by the repository', async () => {
    const { service, repository } = build();
    repository.claim.mockImplementationOnce(async (record) => ({
      kind: 'replayed' as const,
      intent: { ...record, id: 'intent-existing' },
    }));
    await expect(service.claim(input())).resolves.toMatchObject({
      replayed: true,
      intent: { id: 'intent-existing', providerRequestHash: HASH },
    });
  });

  it.each([
    ['model', () => input({ binding: { ...input().binding, model: 'sk-secret-model-value' } })],
    ['Provider idempotency key', () => input({
      providerIdempotencyKey: 'sk-secret-provider-idempotency-value',
    })],
  ])('rejects a secret-shaped %s before persistence', async (_field, createInput) => {
    const { service, repository } = build();
    await expect(service.claim(createInput())).rejects.toMatchObject({
      code: 'BYOK_EXECUTION_INTENT_INVALID_REQUEST',
    });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it.each([
    ['TEXT_TO_IMAGE', 'multipart'],
    ['IMAGE_TO_IMAGE', 'json'],
    ['FULL_EDIT', 'json'],
    ['INPAINT', 'json'],
  ] as const)('rejects request-mode confusion for %s', async (operation, requestMode) => {
    const { service, repository } = build();
    await expect(service.claim(input({
      binding: { ...input().binding, operation },
      requestMode,
    }))).rejects.toMatchObject({ code: 'BYOK_EXECUTION_INTENT_INVALID_REQUEST' });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('fails closed when the current draft slot no longer matches the readiness binding', async () => {
    const { service, repository } = build();
    await expect(service.claim(input({
      binding: { ...input().binding, assignmentOrdinal: 1 },
    }))).rejects.toMatchObject({ code: 'BYOK_EXECUTION_INTENT_CONTEXT_STALE' });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('claims a shared detail attempt using the first selected SKU as its authority anchor', async () => {
    const current = draft();
    current.selectedSkuKeys = ['sku-1', 'sku-2'];
    const { service, repository } = build({ draft: current });
    const result = await service.claim(input({
      binding: {
        ...input().binding,
        slotKey: 'shared:detail:SCENE',
      },
    }));
    expect(result.intent).toMatchObject({
      skuKey: 'sku-1',
      slotKey: 'shared:detail:SCENE',
      assignmentMode: 'APPEND',
      assignmentOrdinal: 0,
    });
    expect(repository.claim).toHaveBeenCalledOnce();
  });

  it('claims a shared detail attempt using an explicitly selected non-first SKU anchor', async () => {
    const current = draft();
    current.selectedSkuKeys = ['sku-1', 'sku-2'];
    const { service, repository } = build({ draft: current });
    const result = await service.claim(input({
      binding: {
        ...input().binding,
        skuKey: 'sku-2',
        slotKey: 'shared:detail:SCENE',
      },
    }));
    expect(result.intent).toMatchObject({
      skuKey: 'sku-2',
      slotKey: 'shared:detail:SCENE',
      assignmentMode: 'APPEND',
      assignmentOrdinal: 0,
    });
    expect(repository.claim).toHaveBeenCalledOnce();
  });

  it.each([
    ['unselected shared anchor', {
      skuKey: 'sku-3', slotKey: 'shared:detail:SCENE', assignmentOrdinal: 0,
    }],
    ['group-subset detail', {
      skuKey: 'sku-1', slotKey: 'group:all:detail:SCENE', assignmentOrdinal: 0,
    }],
    ['stale append order', {
      skuKey: 'sku-1', slotKey: 'shared:detail:SCENE', assignmentOrdinal: 1,
    }],
  ] as const)('rejects %s before persisting an execution intent', async (_label, target) => {
    const current = draft();
    current.selectedSkuKeys = ['sku-1', 'sku-2'];
    const { service, repository } = build({ draft: current });
    await expect(service.claim(input({
      binding: { ...input().binding, ...target },
    }))).rejects.toMatchObject({ code: 'BYOK_EXECUTION_INTENT_CONTEXT_STALE' });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('rejects an occupied shared detail slot before persisting an execution intent', async () => {
    const current = draft();
    current.media.assignments = [{
      scope: 'PRODUCT', slotKey: 'shared:detail:SCENE',
      assetId: 'asset-scene', source: 'GENERATED',
    }];
    const { service, repository } = build({ draft: current });
    await expect(service.claim(input({
      binding: {
        ...input().binding,
        slotKey: 'shared:detail:SCENE',
        assignmentOrdinal: 1,
      },
    }))).rejects.toMatchObject({ code: 'BYOK_EXECUTION_INTENT_CONTEXT_STALE' });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('fails closed when policy is disabled or its revision changed', async () => {
    for (const options of [{ enabled: false }, { revision: 24 }]) {
      const { service, repository } = build(options);
      await expect(service.claim(input())).rejects.toBeInstanceOf(ExtensionByokExecutionIntentError);
      expect(repository.claim).not.toHaveBeenCalled();
    }
  });

  it('records a successful Provider outcome against the exact immutable attempt', async () => {
    const { service, repository } = build();
    const result = await service.recordOutcome({
      identity: input().identity,
      intentId: 'intent-1',
      providerIdempotencyKey: 'provider-attempt-0001',
      providerRequestHash: HASH,
      outcome: 'SUCCEEDED',
      providerRequestIdSha256: 'b'.repeat(64),
      resultSha256: 'c'.repeat(64),
    });

    expect(result).toMatchObject({
      replayed: false,
      intent: {
        id: 'intent-1',
        outcome: 'SUCCEEDED',
        providerRequestIdSha256: 'b'.repeat(64),
        resultSha256: 'c'.repeat(64),
      },
    });
    expect(repository.recordOutcome).toHaveBeenCalledOnce();
  });

  it('requires a result hash only for success and preserves an absorbing unknown outcome', async () => {
    const { service, repository } = build();
    const base = {
      identity: input().identity,
      intentId: 'intent-1',
      providerIdempotencyKey: 'provider-attempt-0001',
      providerRequestHash: HASH,
      providerRequestIdSha256: null,
    };

    await expect(service.recordOutcome({
      ...base,
      outcome: 'SUCCEEDED',
      resultSha256: null,
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_INTENT_INVALID_REQUEST' });
    expect(repository.recordOutcome).not.toHaveBeenCalled();

    (repository.recordOutcome as any).mockResolvedValueOnce({ kind: 'outcome_conflict' });
    await expect(service.recordOutcome({
      ...base,
      outcome: 'FAILED_FINAL',
      resultSha256: null,
    })).rejects.toMatchObject({ code: 'BYOK_EXECUTION_INTENT_OUTCOME_CONFLICT' });
  });
});
