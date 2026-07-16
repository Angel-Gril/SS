import { describe, expect, it } from 'vitest';
import { createPrismaOzonPublishAttemptRepository } from '../services/ozon-publish-attempt-prisma.js';
import { decodeOzonPublishAttemptCursor } from '../services/ozon-publish-attempts.js';

type QueryHandler = (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>;

class ScriptedClient {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];

  constructor(private readonly handler: QueryHandler) {}

  async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
    this.calls.push({ sql, params });
    return await this.handler(sql, params) as T;
  }

  async $transaction<T>(action: (tx: ScriptedClient) => Promise<T>): Promise<T> {
    return action(this);
  }
}

function summaryRow(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workflowId: 'workflow-1',
    shopId: 'shop-1',
    draftVersion: 2,
    revision: 7,
    catalogSnapshotHash: 'a'.repeat(64),
    attributeSchemaHash: 'b'.repeat(64),
    publisherContractVersion: 'ozon-listing-publisher/v1',
    endpoint: '/v3/product/import',
    draftPayloadHash: 'c'.repeat(64),
    draftStateHash: 'd'.repeat(64),
    requestPayloadHash: 'e'.repeat(64),
    itemCount: 25,
    state: 'SUBMITTED',
    reconciliationState: 'PARTIAL_FAILURE',
    stateVersion: 4,
    ozonTaskId: '12345',
    acceptanceSource: 'OZON_TASK_RESPONSE',
    responseHash: 'f'.repeat(64),
    itemResults: [{ offerId: `${id}-offer-1`, status: 'imported' }],
    itemResultCount: 25,
    itemErrors: [{ offerId: `${id}-offer-2`, code: 'INVALID_ATTRIBUTE' }],
    itemErrorCount: 2,
    lastErrorCode: 'PARTIAL_FAILURE',
    lastErrorMessage: 'One or more items need review',
    submitStartedAt: createdAt,
    submittedAt: createdAt,
    unknownAt: null,
    rejectedAt: null,
    nextReconcileAt: null,
    reconcileAttemptCount: 2,
    lastReconciledAt: createdAt,
    completedAt: createdAt,
    resolutionEvidenceHash: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe('Prisma Ozon publish attempt discovery', () => {
  it('lists an owner workflow in stable newest-first pages with a bounded public projection', async () => {
    const firstRows = [
      summaryRow('attempt-3', '2026-07-15T12:00:00.000Z'),
      summaryRow('attempt-2', '2026-07-15T11:00:00.000Z'),
      summaryRow('attempt-1', '2026-07-15T10:00:00.000Z'),
    ];
    let call = 0;
    const client = new ScriptedClient((sql, params) => {
      for (const forbidden of [
        'catalog_snapshot_json',
        'attribute_schema_snapshot_json',
        'request_payload_json',
        'response_json',
        'lease_token',
        'lease_owner',
        'resolution_evidence_json',
      ]) {
        expect(sql).not.toContain(forbidden);
      }
      expect(sql).toContain('a."workflow_id" = $1 AND a."owner_user_id" = $2');
      expect(sql).toContain('ORDER BY a."created_at" DESC, a."id" DESC');
      expect(sql).toContain('WITH ORDINALITY');
      expect(sql).toContain('ordinality <= 20');
      if (call++ === 0) {
        expect(params).toEqual(['workflow-1', 'owner-1', null, null, 3]);
        return firstRows;
      }
      expect(params).toEqual([
        'workflow-1',
        'owner-1',
        new Date('2026-07-15T11:00:00.000Z'),
        'attempt-2',
        3,
      ]);
      return [summaryRow('attempt-1', '2026-07-15T10:00:00.000Z')];
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    const first = await repository.listOwnedByWorkflow({
      workflowId: 'workflow-1', ownerUserId: 'owner-1', limit: 2,
    });
    expect(first.items.map(({ id }) => id)).toEqual(['attempt-3', 'attempt-2']);
    expect(first.items[0]).toMatchObject({
      state: 'SUBMITTED',
      ozonTaskId: '12345',
      requestPayloadHash: 'e'.repeat(64),
      itemResultCount: 25,
      itemResultsTruncated: true,
      itemErrorCount: 2,
      itemErrorsTruncated: true,
    });
    for (const forbidden of [
      'catalogSnapshot', 'attributeSchemaSnapshot', 'requestPayload', 'response',
      'leaseToken', 'leaseOwner', 'resolutionEvidence',
    ]) {
      expect(first.items[0]).not.toHaveProperty(forbidden);
    }
    expect(first.nextCursor).not.toBeNull();
    expect(decodeOzonPublishAttemptCursor(first.nextCursor)).toEqual({
      createdAt: '2026-07-15T11:00:00.000Z', id: 'attempt-2',
    });

    const second = await repository.listOwnedByWorkflow({
      workflowId: 'workflow-1', ownerUserId: 'owner-1', limit: 2, cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ items: [{ id: 'attempt-1' }], nextCursor: null });
  });

  it('returns the latest owner workflow attempt through the same bounded ordering', async () => {
    const client = new ScriptedClient((_sql, params) => {
      expect(params).toEqual(['workflow-1', 'owner-1', null, null, 2]);
      return [summaryRow('attempt-latest', '2026-07-15T12:00:00.000Z')];
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.getLatestOwnedByWorkflow({
      workflowId: 'workflow-1', ownerUserId: 'owner-1',
    })).resolves.toMatchObject({ id: 'attempt-latest' });
  });
});
