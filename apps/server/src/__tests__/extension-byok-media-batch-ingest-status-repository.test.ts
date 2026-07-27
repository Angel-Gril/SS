import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaExtensionByokMediaBatchIngestStatusRepository,
  ExtensionByokMediaBatchIngestStatusRepositoryError,
} from '../repositories/extension-byok-media-batch-ingest-status-repository.js';
import {
  deriveExtensionByokBatchItemIdempotencyKey,
} from '../repositories/extension-byok-generated-asset-batch-commit-prisma.js';
import { deriveByokGeneratedAssetId } from '../services/byok-generated-asset-ingest.js';

const HASH = 'a'.repeat(64);

function input() {
  return {
    contractVersion: 'extension-byok-media-batch-ingest-status/v1' as const,
    executionBatchId: 'execution-batch-1',
    sessionId: 'session-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    idempotencyKey: 'byok-batch-ingest-0001',
    requestHash: 'f'.repeat(64),
    items: [
      {
        executionIntentId: 'intent-1', providerRequestHash: '1'.repeat(64),
        providerResultSha256: '5'.repeat(64), skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero', assignmentOrdinal: 7,
      },
      {
        executionIntentId: 'intent-2', providerRequestHash: '2'.repeat(64),
        providerResultSha256: '6'.repeat(64), skuKey: 'sku-1',
        slotKey: 'shared:detail:DETAIL', assignmentOrdinal: 8,
      },
    ],
  };
}

function receipt() {
  return {
    contractVersion: 'extension-byok-media-batch-ingest-receipt/v1',
    executionBatchId: 'execution-batch-1',
    requestHash: 'f'.repeat(64),
    sourceDraftRevision: 3,
    sourceDraftVersion: 4,
    boundDraftRevision: 4,
    boundDraftVersion: 5,
    erpAiChargeCents: 0,
    items: input().items.map((expected, index) => ({
      assetId: `asset-${index + 1}`,
      provenanceId: `provenance-${index + 1}`,
      executionIntentId: expected.executionIntentId,
      providerRequestHash: expected.providerRequestHash,
      providerResultSha256: expected.providerResultSha256,
      normalizedSha256: String(index + 7).repeat(64),
      mimeType: 'image/png', width: 1200, height: 1600,
      skuKey: expected.skuKey, slotKey: expected.slotKey,
      assignmentOrdinal: expected.assignmentOrdinal,
      assignmentSha256: String(index + 3).repeat(64),
      assignment: expected.slotKey.startsWith('shared:')
        ? {
          scope: 'PRODUCT', slotKey: expected.slotKey,
          assetId: `asset-${index + 1}`, source: 'GENERATED',
        }
        : {
          scope: 'SKU', skuKey: expected.skuKey, slotKey: expected.slotKey,
          assetId: `asset-${index + 1}`, source: 'GENERATED',
        },
      policyRevision: 7,
    })),
  };
}

function client(grant: unknown, staging: unknown[] = []) {
  const succeeded = (grant as any)?.receipt?.status === 'SUCCEEDED';
  return {
    extensionCommandGrant: { findFirst: vi.fn(async () => grant) },
    extensionByokExecutionBatch: {
      findFirst: vi.fn(async () => executionBatch({ status: succeeded ? 'BOUND' : 'OPEN' })),
    },
    extensionByokUploadStaging: { findMany: vi.fn(async () => staging) },
  };
}

function executionBatch(overrides: Record<string, unknown> = {}) {
  const status = overrides.status === 'OPEN' ? 'OPEN' : 'BOUND';
  return {
    id: 'execution-batch-1', status, ownerUserId: 'owner-1',
    actorUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
    listingWorkflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    firstAssignmentOrdinal: 7, itemCount: 2,
    boundDraftRevision: status === 'BOUND' ? 4 : null,
    boundDraftVersion: status === 'BOUND' ? 5 : null,
    items: input().items.map((item, index) => ({
      id: `batch-item-${index + 1}`, itemIndex: index, skuKey: item.skuKey,
      slotKey: item.slotKey, assignmentOrdinal: item.assignmentOrdinal,
      status: status === 'BOUND' ? 'BOUND' : 'ACTIVE',
      executionIntents: [{
        id: item.executionIntentId, outcome: 'SUCCEEDED',
        providerRequestHash: item.providerRequestHash,
        resultSha256: item.providerResultSha256,
      }],
    })),
    ...overrides,
  };
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 4,
    requestHash: 'f'.repeat(64), receipt: null, ...overrides,
  };
}

describe('Prisma extension BYOK batch ingest status repository', () => {
  it('returns the exact succeeded rich batch receipt', async () => {
    const database = client(grant({
      receipt: {
        id: 'receipt-1', status: 'SUCCEEDED', result: receipt(), failureCode: null,
      },
    }));
    const result = await createPrismaExtensionByokMediaBatchIngestStatusRepository(database)
      .findStatus(input());
    expect(result).toMatchObject({ kind: 'succeeded', receiptId: 'receipt-1' });
    expect(result.kind === 'succeeded' && result.receipt).toEqual(receipt());
    expect(database.extensionByokUploadStaging.findMany).not.toHaveBeenCalled();
    expect(database.extensionByokExecutionBatch.findFirst).toHaveBeenCalledTimes(1);
    expect(database.extensionByokExecutionBatch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'execution-batch-1' } }),
    );
  });

  it.each([
    [null, { kind: 'not_found' }],
    [grant(), { kind: 'not_committed' }],
    [grant({ receipt: {
      id: 'receipt-1', status: 'PENDING', result: null, failureCode: null,
    } }), { kind: 'pending', receiptId: 'receipt-1' }],
    [grant({ receipt: {
      id: 'receipt-1', status: 'FAILED', result: null, failureCode: 'FAILED',
    } }), { kind: 'failed', receiptId: 'receipt-1' }],
  ])('maps grant/receipt state %#', async (row, expected) => {
    await expect(createPrismaExtensionByokMediaBatchIngestStatusRepository(client(row))
      .findStatus(input())).resolves.toEqual(expected);
  });

  it('treats any exact active child staging record as pending', async () => {
    const first = input().items[0]!;
    const assetId = deriveByokGeneratedAssetId({
      ownerUserId: 'owner-1',
      idempotencyKey: deriveExtensionByokBatchItemIdempotencyKey(
        'byok-batch-ingest-0001',
        first.executionIntentId,
      ),
    });
    const database = client(grant(), [{ id: assetId, assetId, status: 'PENDING' }]);
    const repository = createPrismaExtensionByokMediaBatchIngestStatusRepository(database);
    await expect(repository.findStatus(input())).resolves.toEqual({
      kind: 'pending', receiptId: null,
    });
  });

  it.each([
    ['request hash', grant({ requestHash: HASH })],
    ['receipt item', grant({ receipt: {
      id: 'receipt-1', status: 'SUCCEEDED',
      result: { ...receipt(), items: [...receipt().items].reverse() }, failureCode: null,
    } })],
    ['ERP charge', grant({ receipt: {
      id: 'receipt-1', status: 'SUCCEEDED',
      result: { ...receipt(), erpAiChargeCents: 1 }, failureCode: null,
    } })],
  ])('rejects a conflicting %s', async (_label, row) => {
    await expect(createPrismaExtensionByokMediaBatchIngestStatusRepository(client(row))
      .findStatus(input())).rejects.toBeInstanceOf(
      ExtensionByokMediaBatchIngestStatusRepositoryError,
    );
  });

  it('rejects a receipt or reservation from another execution batch', async () => {
    const wrongReceipt = client(grant({
      receipt: {
        id: 'receipt-1', status: 'SUCCEEDED',
        result: { ...receipt(), executionBatchId: 'execution-batch-2' }, failureCode: null,
      },
    }));
    await expect(createPrismaExtensionByokMediaBatchIngestStatusRepository(wrongReceipt)
      .findStatus(input())).rejects.toBeInstanceOf(
      ExtensionByokMediaBatchIngestStatusRepositoryError,
    );

    const wrongReservation = client(grant({
      receipt: {
        id: 'receipt-1', status: 'SUCCEEDED', result: receipt(), failureCode: null,
      },
    }));
    wrongReservation.extensionByokExecutionBatch.findFirst.mockResolvedValueOnce(
      executionBatch({ id: 'execution-batch-2' }),
    );
    await expect(createPrismaExtensionByokMediaBatchIngestStatusRepository(wrongReservation)
      .findStatus(input())).rejects.toBeInstanceOf(
      ExtensionByokMediaBatchIngestStatusRepositoryError,
    );
  });
});
