import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  createByokMediaIngestCommandResolver,
  parseByokMediaIngestCommandEnvelope,
  type ByokReadinessInput,
} from '../services/extension-byok-media-ingest-grant.js';
import { hashExtensionCommandRequest } from '../services/extension-command-grants.js';

const HASH = 'a'.repeat(64);

function item(index: number, overrides: Record<string, unknown> = {}) {
  const skuKey = `sku-${index + 1}`;
  return {
    schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
    providerOrigin: 'https://images.example.com',
    providerOperation: 'TEXT_TO_IMAGE',
    requestMode: 'json',
    model: 'image-model-v1',
    executionIntentId: `intent-${index + 1}`,
    providerIdempotencyKey: `provider-attempt-${String(index + 1).padStart(4, '0')}`,
    providerRequestHash: String(index + 1).repeat(64),
    providerRequestIdSha256: null,
    promptSha256: HASH,
    negativePromptSha256: null,
    draftRevision: 11,
    skuKey,
    slotKey: `sku:${skuKey}:hero`,
    assignmentOrdinal: index,
    assignmentMode: 'APPEND',
    replaceConfirmed: false,
    resultSha256: String(index + 5).repeat(64),
    resultMimeType: 'image/png',
    resultSizeBytes: 1024,
    sourceSha256: null,
    referenceSha256s: [],
    maskSha256: null,
    ...overrides,
  };
}

function batch(items = [item(0), item(1)]) {
  return {
    schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
    executionBatchId: 'execution-batch-1',
    items,
  };
}

function readiness(input: ByokReadinessInput) {
  return {
    contractVersion: 'extension-byok-readiness/v1' as const,
    policyRevision: 7,
    mode: 'pilot' as const,
    context: { ...input },
    maxConcurrency: 2,
    capabilities: {
      generation: { enabled: true, ready: true, reasonCode: 'READY' as const },
      ingest: { enabled: true, ready: true, reasonCode: 'READY' as const },
      publish: { enabled: true, ready: true, reasonCode: 'READY' as const },
    },
  };
}

describe('BYOK reviewed batch ingest grant', () => {
  it('accepts one to four exact append items and rejects ambiguous batch identity', () => {
    expect(parseByokMediaIngestCommandEnvelope(batch())).toMatchObject({
      schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
      executionBatchId: 'execution-batch-1',
      items: [{ assignmentOrdinal: 0 }, { assignmentOrdinal: 1 }],
    });
    expect(() => parseByokMediaIngestCommandEnvelope({
      ...batch(), executionBatchId: undefined,
    })).toThrow(/invalid/i);
    const requestIdentity = {
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
    };
    expect(hashExtensionCommandRequest({
      ...requestIdentity,
      command: parseByokMediaIngestCommandEnvelope(batch()),
    })).not.toBe(hashExtensionCommandRequest({
      ...requestIdentity,
      command: parseByokMediaIngestCommandEnvelope({
        ...batch(), executionBatchId: 'execution-batch-2',
      }),
    }));
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1), item(2), item(3), item(4),
    ]))).toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { slotKey: 'sku:sku-1:hero', skuKey: 'sku-1' }),
    ]))).toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { executionIntentId: 'intent-1' }),
    ]))).toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { resultSha256: item(0).resultSha256 }),
    ]))).toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { assignmentOrdinal: 3 }),
    ]))).toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { draftRevision: 12 }),
    ]))).toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { assignmentMode: 'REPLACE', replaceConfirmed: true }),
    ]))).toThrow(/invalid/i);
    expect(parseByokMediaIngestCommandEnvelope(batch([
      item(0, { assignmentOrdinal: 7 }),
      item(1, {
        skuKey: 'sku-1',
        slotKey: 'shared:detail:DETAIL',
        assignmentOrdinal: 8,
      }),
    ]))).toMatchObject({
      items: [
        { assignmentOrdinal: 7 },
        { slotKey: 'shared:detail:DETAIL', assignmentOrdinal: 8 },
      ],
    });
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { slotKey: 'group:visual-1:detail:SCENE' }),
    ]))).toThrow(/invalid/i);
    expect(() => parseByokMediaIngestCommandEnvelope(batch([
      item(0), item(1, { slotKey: 'sku:sku-2:detail:1' }),
    ]))).toThrow(/invalid/i);
  });

  it('resolves every item against one live draft and exact Provider policy', async () => {
    const getReadiness = vi.fn(async (input: ByokReadinessInput) => readiness(input));
    const resolve = createByokMediaIngestCommandResolver({
      loadShop: async () => ({
        id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
      }),
      loadDraft: async () => ({
        id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
        draftVersion: 7, revision: 11, sourceCaptureSnapshotId: 'snapshot-1',
        selectedSkuKeys: ['sku-1', 'sku-2'],
      }),
      getReadiness,
    });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      idempotencyKey: 'byok-batch-ingest-0001',
      command: batch(),
    })).resolves.toMatchObject({
      kind: 'allowed',
      draftVersion: 7,
      command: {
        schemaVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
        executionBatchId: 'execution-batch-1',
        items: [
          { readiness: { policyRevision: 7 }, authority: { sourceCaptureSnapshotId: 'snapshot-1' } },
          { readiness: { policyRevision: 7 }, authority: { sourceCaptureSnapshotId: 'snapshot-1' } },
        ],
      },
    });
    expect(getReadiness).toHaveBeenCalledTimes(1);

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      idempotencyKey: 'byok-batch-ingest-0001',
      command: batch([
        item(0),
        item(1, { skuKey: 'sku-1', slotKey: 'shared:detail:SCENE' }),
      ]),
    })).resolves.toMatchObject({ kind: 'allowed' });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      idempotencyKey: 'byok-batch-ingest-0001',
      command: batch([
        item(0),
        item(1, { slotKey: 'shared:detail:SCENE' }),
      ]),
    })).resolves.toMatchObject({
      kind: 'allowed',
      command: { items: [{ skuKey: 'sku-1' }, { skuKey: 'sku-2', slotKey: 'shared:detail:SCENE' }] },
    });

    await expect(resolve({
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      operation: EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftVersion: 7,
      idempotencyKey: 'byok-batch-ingest-0001',
      command: batch([
        item(0),
        item(1, { skuKey: 'sku-3', slotKey: 'shared:detail:SCENE' }),
      ]),
    })).resolves.toEqual({ kind: 'forbidden' });
  });
});
