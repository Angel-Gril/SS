import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaExtensionByokMediaIngestStatusRepository,
  ExtensionByokMediaIngestStatusRepositoryError,
} from '../repositories/extension-byok-media-ingest-status-repository.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_STATUS_VERSION,
} from '../services/extension-byok-media-ingest-status.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';
import {
  deriveByokGeneratedAssetId,
} from '../services/byok-generated-asset-ingest.js';

function input(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_INGEST_STATUS_VERSION,
    sessionId: 'session-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 0,
    idempotencyKey: 'byok-status-recovery-0001',
    requestHash: 'a'.repeat(64),
    ...overrides,
  } as any;
}

function receiptResult(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
    requestHash: 'a'.repeat(64),
    assetId: 'asset-1',
    provenanceId: 'provenance-1',
    normalizedSha256: 'b'.repeat(64),
    mimeType: 'image/webp',
    width: 1200,
    height: 1200,
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    boundDraftRevision: 4,
    boundDraftVersion: 5,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 0,
    assignmentSha256: 'c'.repeat(64),
    policyRevision: 7,
    ...overrides,
  };
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftVersion: 4,
    requestHash: 'a'.repeat(64),
    receipt: {
      id: 'receipt-1',
      status: 'SUCCEEDED',
      result: receiptResult(),
      failureCode: null,
    },
    ...overrides,
  };
}

function repository(row: unknown, stagingRow: unknown = null) {
  const findFirst = vi.fn(async () => row);
  const findStaging = vi.fn(async () => stagingRow);
  return {
    findFirst,
    findStaging,
    repository: createPrismaExtensionByokMediaIngestStatusRepository({
      extensionCommandGrant: { findFirst },
      extensionByokUploadStaging: { findFirst: findStaging },
    } as never),
  };
}

describe('Prisma extension BYOK ingest status repository', () => {
  it('recovers one exact successful public receipt without selecting grant secrets', async () => {
    const { repository: statusRepository, findFirst } = repository(grant());

    await expect(statusRepository.findStatus(input())).resolves.toEqual({
      kind: 'succeeded',
      receiptId: 'receipt-1',
      receipt: {
        assetId: 'asset-1',
        provenanceId: 'provenance-1',
        normalizedSha256: 'b'.repeat(64),
        mimeType: 'image/webp',
        width: 1200,
        height: 1200,
        sourceDraftRevision: 3,
        sourceDraftVersion: 4,
        boundDraftRevision: 4,
        boundDraftVersion: 5,
        skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero',
        assignmentOrdinal: 0,
        assignmentSha256: 'c'.repeat(64),
      },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: 'session-1',
        ownerUserId: 'owner-1',
        operation: 'BYOK_MEDIA_INGEST',
        idempotencyKey: 'byok-status-recovery-0001',
      },
      select: {
        shopId: true,
        workflowId: true,
        draftVersion: true,
        requestHash: true,
        receipt: {
          select: {
            id: true,
            status: true,
            result: true,
            failureCode: true,
          },
        },
      },
    });
    const serialized = JSON.stringify((await statusRepository.findStatus(input())));
    expect(serialized).not.toMatch(/grantId|tokenDigest|requestHash|secret|authorization/iu);
  });

  it.each([
    [null, { kind: 'not_found' }],
    [grant({ receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null } }), {
      kind: 'pending', receiptId: 'receipt-1',
    }],
    [grant({ receipt: { id: 'receipt-1', status: 'FAILED', result: null, failureCode: 'INGEST_FAILED' } }), {
      kind: 'failed', receiptId: 'receipt-1',
    }],
  ])('classifies missing and non-success terminal states', async (row, expected) => {
    const { repository: statusRepository } = repository(row);
    await expect(statusRepository.findStatus(input())).resolves.toEqual(expected);
  });

  it.each(['PENDING', 'CLEANING', 'COMMITTED'])(
    'maps a grant without a receipt plus %s staging to pending',
    async (status) => {
      const assetId = deriveByokGeneratedAssetId({
        ownerUserId: 'owner-1',
        idempotencyKey: 'byok-status-recovery-0001',
      });
      const { repository: statusRepository, findStaging } = repository(
        grant({ receipt: null }),
        { id: assetId, status },
      );
      await expect(statusRepository.findStatus(input())).resolves.toEqual({
        kind: 'pending', receiptId: null,
      });
      expect(findStaging).toHaveBeenCalledWith({
        where: {
          id: assetId, assetId,
          deviceSessionId: 'session-1', ownerUserId: 'owner-1',
          requestHash: 'a'.repeat(64), status: { in: ['PENDING', 'CLEANING', 'COMMITTED'] },
        },
        select: { id: true, status: true },
      });
    },
  );

  it('maps a grant without a receipt and no active staging to not committed', async () => {
    const { repository: statusRepository } = repository(grant({ receipt: null }));
    await expect(statusRepository.findStatus(input())).resolves.toEqual({ kind: 'not_committed' });
  });

  it('does not recover staging owned by another idempotency key with the same request hash', async () => {
    const firstIdempotencyKey = 'byok-status-recovery-0001';
    const secondIdempotencyKey = 'byok-status-recovery-0002';
    const firstAssetId = deriveByokGeneratedAssetId({
      ownerUserId: 'owner-1',
      idempotencyKey: firstIdempotencyKey,
    });
    const secondAssetId = deriveByokGeneratedAssetId({
      ownerUserId: 'owner-1',
      idempotencyKey: secondIdempotencyKey,
    });
    const storedStaging = {
      id: firstAssetId,
      assetId: firstAssetId,
      deviceSessionId: 'session-1',
      ownerUserId: 'owner-1',
      requestHash: 'a'.repeat(64),
      status: 'PENDING',
    };
    const findGrant = vi.fn(async () => grant({ receipt: null }));
    const findStaging = vi.fn(async (query: any) => {
      const { where } = query;
      const exactFields = ['id', 'assetId', 'deviceSessionId', 'ownerUserId', 'requestHash'];
      const exactMatch = exactFields.every((field) => (
        where[field] === undefined || where[field] === storedStaging[field as keyof typeof storedStaging]
      ));
      return exactMatch && where.status?.in?.includes(storedStaging.status)
        ? { id: storedStaging.id, status: storedStaging.status }
        : null;
    });
    const statusRepository = createPrismaExtensionByokMediaIngestStatusRepository({
      extensionCommandGrant: { findFirst: findGrant },
      extensionByokUploadStaging: { findFirst: findStaging },
    } as never);

    expect(firstAssetId).not.toBe(secondAssetId);
    await expect(statusRepository.findStatus(input({ idempotencyKey: secondIdempotencyKey })))
      .resolves.toEqual({ kind: 'not_committed' });
    expect(findStaging).toHaveBeenCalledWith({
      where: {
        id: secondAssetId,
        assetId: secondAssetId,
        deviceSessionId: 'session-1',
        ownerUserId: 'owner-1',
        requestHash: 'a'.repeat(64),
        status: { in: ['PENDING', 'CLEANING', 'COMMITTED'] },
      },
      select: { id: true, status: true },
    });
  });

  it.each([
    ['without receipt', grant({ receipt: null })],
    ['pending', grant({ receipt: { id: 'receipt-1', status: 'PENDING', result: null, failureCode: null } })],
    ['failed', grant({ receipt: { id: 'receipt-1', status: 'FAILED', result: null, failureCode: 'FAILED' } })],
    ['succeeded', grant()],
  ])('rejects a wrong request hash before returning %s state', async (_label, row) => {
    const { repository: statusRepository, findStaging } = repository(row);
    await expect(statusRepository.findStatus(input({ requestHash: 'f'.repeat(64) })))
      .rejects.toBeInstanceOf(ExtensionByokMediaIngestStatusRepositoryError);
    expect(findStaging).not.toHaveBeenCalled();
  });

  it.each([
    ['shop binding', grant({ shopId: 'shop-other' }), input()],
    ['workflow binding', grant({ workflowId: 'workflow-other' }), input()],
    ['draft version binding', grant({ draftVersion: 9 }), input()],
    ['request hash', grant({ requestHash: 'd'.repeat(64) }), input()],
    ['draft revision', grant({ receipt: { ...grant().receipt, result: receiptResult({ draftRevision: 2 }) } }), input()],
    ['SKU', grant({ receipt: { ...grant().receipt, result: receiptResult({ skuKey: 'sku-other' }) } }), input()],
    ['slot', grant({ receipt: { ...grant().receipt, result: receiptResult({ slotKey: 'sku:sku-1:other' }) } }), input()],
    ['ordinal', grant({ receipt: { ...grant().receipt, result: receiptResult({ assignmentOrdinal: 1 }) } }), input()],
    ['unknown receipt field', grant({
      receipt: { ...grant().receipt, result: receiptResult({ apiKey: 'must-never-pass' }) },
    }), input()],
    ['pending receipt payload', grant({
      receipt: { id: 'receipt-1', status: 'PENDING', result: receiptResult(), failureCode: null },
    }), input()],
  ])('fails closed on %s conflicts', async (_label, row, statusInput) => {
    const { repository: statusRepository } = repository(row);
    await expect(statusRepository.findStatus(statusInput)).rejects.toBeInstanceOf(
      ExtensionByokMediaIngestStatusRepositoryError,
    );
  });
});
