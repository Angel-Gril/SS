import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaExtensionByokExecutionBatchRepository,
} from '../services/extension-byok-execution-batch-prisma.js';
import type {
  ExtensionByokExecutionBatchCreateRecord,
  ExtensionByokExecutionBatchItemRecord,
  ExtensionByokExecutionBatchRecord,
} from '../services/extension-byok-execution-batch.js';
import type {
  ExtensionByokExecutionIntentRecord,
} from '../services/extension-byok-execution-intent.js';

const NOW = new Date('2026-07-28T02:00:00.000Z');
const LATER = new Date('2026-07-28T02:01:00.000Z');

function batch(overrides: Partial<ExtensionByokExecutionBatchRecord> = {}) {
  return {
    id: 'batch-1',
    contractVersion: 'extension-byok-execution-batch/v1' as const,
    status: 'OPEN' as const,
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    listingWorkflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourcePlatform: '1688' as const,
    sourceProductId: 'source-product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    firstAssignmentOrdinal: 0,
    itemCount: 2,
    idempotencyKey: 'batch-idempotency-0001',
    requestHash: 'a'.repeat(64),
    boundDraftRevision: null,
    boundDraftVersion: null,
    boundAt: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function item(
  itemIndex: number,
  overrides: Partial<ExtensionByokExecutionBatchItemRecord> = {},
) {
  const skuKey = itemIndex === 0 ? 'sku-1' : 'sku-2';
  return {
    id: `batch-item-${itemIndex}`,
    batchId: 'batch-1',
    ownerUserId: 'owner-1',
    listingWorkflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    itemIndex,
    skuKey,
    slotKey: `sku:${skuKey}:hero`,
    assignmentOrdinal: itemIndex,
    status: 'ACTIVE' as const,
    boundAt: null,
    releasedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function intent(
  itemIndex: number,
  overrides: Partial<ExtensionByokExecutionIntentRecord> = {},
) {
  const reservedItem = item(itemIndex);
  return {
    id: `intent-${itemIndex}`,
    contractVersion: 'extension-byok-execution-intent/v1' as const,
    executionMode: 'BYOK' as const,
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    listingWorkflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 11,
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: reservedItem.skuKey,
    slotKey: reservedItem.slotKey,
    assignmentMode: 'APPEND' as const,
    assignmentOrdinal: itemIndex,
    policyRevision: 23,
    providerOriginSha256: 'b'.repeat(64),
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE' as const,
    requestMode: 'json' as const,
    providerIdempotencyKey: `provider-attempt-000${itemIndex + 1}`,
    providerRequestHash: String.fromCharCode(99 + itemIndex).repeat(64),
    requestHash: String.fromCharCode(101 + itemIndex).repeat(64),
    executionBatchItemId: reservedItem.id,
    executionBatchAttemptIndex: 0,
    outcome: 'PENDING' as const,
    providerRequestIdSha256: null,
    resultSha256: null,
    outcomeUpdatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createRecord(): ExtensionByokExecutionBatchCreateRecord {
  return {
    batch: batch(),
    items: [item(0), item(1)],
    intents: [intent(0), intent(1)],
  };
}

function sqlOf(args: unknown[]): string {
  return String(args[0]);
}

function database(
  handler: (sql: string, values: unknown[]) => unknown | Promise<unknown>,
) {
  const query = vi.fn(async (...args: unknown[]) => handler(sqlOf(args), args.slice(1)));
  return {
    query,
    client: {
      $queryRawUnsafe: query,
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation({
        $queryRawUnsafe: query,
      })),
    },
  };
}

function standardClaimDatabase(input: ExtensionByokExecutionBatchCreateRecord) {
  let itemIndex = 0;
  let intentIndex = 0;
  return database((sql) => {
    if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
    if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
    if (sql.includes('FROM "extension_byok_execution_batches"')
      && sql.includes('"idempotency_key" = $2')) return [];
    if (sql.includes('AS "reserved"')) return [{ reserved: false }];
    if (sql.includes('COUNT(*)::INTEGER')) return [{ count: 0 }];
    if (sql.includes('INSERT INTO "extension_byok_execution_batches"')) return [input.batch];
    if (sql.includes('INSERT INTO "extension_byok_execution_batch_items"')) {
      return [input.items[itemIndex++]];
    }
    if (sql.includes('INSERT INTO "extension_byok_execution_intents"')) {
      return [input.intents[intentIndex++]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
}

describe('Prisma extension BYOK execution batch repository', () => {
  it('atomically revalidates authority, claims mode, and persists batch/items/intents', async () => {
    const input = createRecord();
    const db = standardClaimDatabase(input);
    const repository = createPrismaExtensionByokExecutionBatchRepository(db.client as never);

    await expect(repository.claimBatch(input)).resolves.toMatchObject({
      kind: 'created',
      batch: { id: 'batch-1', itemCount: 2 },
      intents: [
        { id: 'intent-0', executionBatchAttemptIndex: 0 },
        { id: 'intent-1', executionBatchAttemptIndex: 0 },
      ],
    });

    const statements = db.query.mock.calls.map(sqlOf);
    expect(statements[0]).toContain('extension_device_shop_grants');
    expect(statements[1]).toContain('claim_extension_ai_image_execution_mode');
    expect(statements.filter((sql) => (
      sql.includes('INSERT INTO "extension_byok_execution_batches"')
    ))).toHaveLength(1);
    expect(statements.filter((sql) => (
      sql.includes('INSERT INTO "extension_byok_execution_batch_items"')
    ))).toHaveLength(2);
    expect(statements.filter((sql) => (
      sql.includes('INSERT INTO "extension_byok_execution_intents"')
    ))).toHaveLength(2);
    expect(db.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('returns stored attempt identities for an exact replay before checking capacity', async () => {
    const input = createRecord();
    const stored = createRecord();
    stored.batch = batch({ id: 'stored-batch' });
    stored.items = [
      item(0, { id: 'stored-item-0', batchId: 'stored-batch' }),
      item(1, { id: 'stored-item-1', batchId: 'stored-batch' }),
    ];
    stored.intents = [
      intent(0, { id: 'stored-intent-0', executionBatchItemId: 'stored-item-0' }),
      intent(1, { id: 'stored-intent-1', executionBatchItemId: 'stored-item-1' }),
    ];
    const db = database((sql) => {
      if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
      if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
      if (sql.includes('FROM "extension_byok_execution_batches"')
        && sql.includes('"idempotency_key" = $2')) return [stored.batch];
      if (sql.includes('FROM "extension_byok_execution_intents" intent')) return stored.intents;
      if (sql.includes('FROM "extension_byok_execution_batch_items"')) return stored.items;
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimBatch(input)).resolves.toMatchObject({
        kind: 'replayed',
        batch: { id: 'stored-batch' },
        intents: [
          { id: 'stored-intent-0', executionBatchItemId: 'stored-item-0' },
          { id: 'stored-intent-1', executionBatchItemId: 'stored-item-1' },
        ],
      });
    expect(db.query.mock.calls.map(sqlOf).join('\n')).not.toContain('COUNT(*)::INTEGER');
  });

  it.each([
    [{ allowed: false, current: true }, 'forbidden'],
    [{ allowed: true, current: false }, 'stale'],
  ] as const)('rejects %o authority before claiming the mode', async (authority, kind) => {
    const input = createRecord();
    const db = database((sql) => {
      if (sql.includes('AS "allowed"')) return [authority];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimBatch(input)).resolves.toEqual({ kind });
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('rolls back a provisional mode claim when retained attempt capacity is exhausted', async () => {
    const input = createRecord();
    const db = database((sql) => {
      if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
      if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [];
      if (sql.includes('AS "reserved"')) return [{ reserved: false }];
      if (sql.includes('COUNT(*)::INTEGER')) return [{ count: 499 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimBatch(input)).resolves.toEqual({ kind: 'capacity_exceeded' });
  });

  it.each([
    ['extension_byok_execution_batch_active_slot_key', 'reservation_conflict'],
    ['extension_byok_execution_batch_active_ordinal_key', 'reservation_conflict'],
    ['extension_byok_execution_intent_standalone_reservation_conflict', 'reservation_conflict'],
    ['extension_byok_execution_intent_owner_provider_key', 'idempotency_conflict'],
    ['extension_ai_image_execution_mode_exclusive', 'mode_conflict'],
  ] as const)('classifies the known %s database conflict', async (constraint, kind) => {
    const input = createRecord();
    const db = standardClaimDatabase(input);
    db.query.mockRejectedValueOnce(Object.assign(new Error(constraint), { constraint }));
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimBatch(input)).resolves.toEqual({ kind });
  });

  it('rolls back before batch insert when a standalone attempt owns a selected slot', async () => {
    const input = createRecord();
    const db = database((sql) => {
      if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
      if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [];
      if (sql.includes('AS "reserved"')) return [{ reserved: true }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimBatch(input)).resolves.toEqual({ kind: 'reservation_conflict' });
    expect(db.query.mock.calls.map(sqlOf).join('\n')).not.toContain(
      'INSERT INTO "extension_byok_execution_batches"',
    );
  });

  it('classifies the Prisma raw-query 23505 column signature for a partial unique index', async () => {
    const input = createRecord();
    const db = standardClaimDatabase(input);
    db.query.mockRejectedValueOnce(Object.assign(new Error('Raw query failed'), {
      code: 'P2010',
      meta: {
        code: '23505',
        message: 'Key (owner_user_id, listing_workflow_id, draft_revision, '
          + 'draft_version, slot_key) already exists.',
      },
    }));
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimBatch(input)).resolves.toEqual({ kind: 'reservation_conflict' });
  });

  it('does not swallow an unknown database failure', async () => {
    const input = createRecord();
    const db = standardClaimDatabase(input);
    db.query.mockRejectedValueOnce(new Error('connection terminated'));
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimBatch(input)).rejects.toThrow('connection terminated');
  });

  it('creates a successor only from the exact latest terminal attempt', async () => {
    const reservedBatch = batch();
    const reservedItem = item(0);
    const previous = intent(0, {
      outcome: 'FAILED_FINAL',
      outcomeUpdatedAt: LATER,
      updatedAt: LATER,
    });
    const requested = intent(0, {
      id: 'intent-successor',
      providerIdempotencyKey: 'provider-successor-0001',
      providerRequestHash: '1'.repeat(64),
      requestHash: '2'.repeat(64),
      executionBatchItemId: null,
      executionBatchAttemptIndex: null,
    });
    const linked = {
      ...requested,
      executionBatchItemId: reservedItem.id,
      executionBatchAttemptIndex: 1,
    };
    const db = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')
        && sql.includes('WHERE "id" = $1')) return [reservedBatch];
      if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
      if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
      if (sql.includes('FROM "extension_byok_execution_batch_items"')
        && sql.includes('"item_index" = $2')) return [reservedItem];
      if (sql.includes('"provider_idempotency_key" = $2')) return [];
      if (sql.includes('ORDER BY "execution_batch_attempt_index" DESC')) return [previous];
      if (sql.includes('COUNT(*)::INTEGER')) return [{ count: 1 }];
      if (sql.includes('INSERT INTO "extension_byok_execution_intents"')) return [linked];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaExtensionByokExecutionBatchRepository(db.client as never);
    await expect(repository.claimSuccessor({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
      batchId: 'batch-1',
      itemIndex: 0,
      currentIntentId: 'intent-0',
      intent: requested,
    })).resolves.toMatchObject({
      kind: 'created',
      intent: { id: 'intent-successor', executionBatchAttemptIndex: 1 },
    });
  });

  it.each(['PENDING', 'UNKNOWN_OUTCOME'] as const)(
    'blocks a successor while the latest attempt is %s',
    async (outcome) => {
      const requested = intent(0, {
        id: 'intent-successor',
        providerIdempotencyKey: 'provider-successor-0001',
        providerRequestHash: '1'.repeat(64),
        requestHash: '2'.repeat(64),
        executionBatchItemId: null,
        executionBatchAttemptIndex: null,
      });
      const latest = intent(0, {
        outcome,
        outcomeUpdatedAt: outcome === 'PENDING' ? null : LATER,
        updatedAt: outcome === 'PENDING' ? NOW : LATER,
      });
      const db = database((sql) => {
        if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch()];
        if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
        if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
        if (sql.includes('FROM "extension_byok_execution_batch_items"')) return [item(0)];
        if (sql.includes('"provider_idempotency_key" = $2')) return [];
        if (sql.includes('ORDER BY "execution_batch_attempt_index" DESC')) return [latest];
        throw new Error(`Unexpected SQL: ${sql}`);
      });
      await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
        .claimSuccessor({
          identity: {
            ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
          },
          batchId: 'batch-1', itemIndex: 0, currentIntentId: 'intent-0', intent: requested,
        })).resolves.toEqual({ kind: 'attempt_blocked' });
    },
  );

  it('replays an already-created successor using its exact predecessor', async () => {
    const requested = intent(0, {
      id: 'new-random-id',
      providerIdempotencyKey: 'provider-successor-0001',
      providerRequestHash: '1'.repeat(64),
      requestHash: '2'.repeat(64),
      executionBatchItemId: null,
      executionBatchAttemptIndex: null,
    });
    const existing = {
      ...requested,
      id: 'stored-successor',
      executionBatchItemId: 'batch-item-0',
      executionBatchAttemptIndex: 1,
    };
    const db = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch()];
      if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
      if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
      if (sql.includes('FROM "extension_byok_execution_batch_items"')) return [item(0)];
      if (sql.includes('"provider_idempotency_key" = $2')) return [existing];
      if (sql.includes('SELECT "id"')) return [{ id: 'intent-0' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .claimSuccessor({
        identity: {
          ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
        },
        batchId: 'batch-1', itemIndex: 0, currentIntentId: 'intent-0', intent: requested,
    })).resolves.toMatchObject({
      kind: 'replayed', intent: { id: 'stored-successor', executionBatchAttemptIndex: 1 },
    });
  });

  it('loads the provenance-bound attempt instead of a later failed regeneration', async () => {
    const bound = batch({
      status: 'BOUND',
      boundDraftRevision: 8,
      boundDraftVersion: 12,
      boundAt: LATER,
      updatedAt: LATER,
    });
    const items = [
      item(0, { status: 'BOUND', boundAt: LATER, updatedAt: LATER }),
      item(1, { status: 'BOUND', boundAt: LATER, updatedAt: LATER }),
    ];
    const boundIntents = [
      intent(0, {
        id: 'intent-0-selected',
        executionBatchAttemptIndex: 0,
        outcome: 'SUCCEEDED',
        resultSha256: '8'.repeat(64),
      }),
      intent(1, {
        id: 'intent-1-selected',
        executionBatchAttemptIndex: 0,
        outcome: 'SUCCEEDED',
        resultSha256: '9'.repeat(64),
      }),
    ];
    const laterFailed = intent(0, {
      id: 'intent-0-later-failed',
      executionBatchAttemptIndex: 1,
      outcome: 'FAILED_FINAL',
      outcomeUpdatedAt: LATER,
    });
    const db = database((sql, values) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [bound];
      if (sql.includes('FROM "extension_byok_execution_batch_items"')) return items;
      if (sql.includes('extension_byok_media_provenance')) {
        return [boundIntents[values[0] === 'batch-item-0' ? 0 : 1]];
      }
      if (sql.includes('MAX(latest."execution_batch_attempt_index")')) {
        return [values[0] === 'batch-item-0' ? laterFailed : boundIntents[1]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaExtensionByokExecutionBatchRepository(db.client as never);

    await expect(repository.loadBatchState({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
      batchId: 'batch-1',
    })).resolves.toMatchObject({
      kind: 'found',
      batch: { status: 'BOUND', boundDraftRevision: 8, boundDraftVersion: 12 },
      items: [
        { item: { itemIndex: 0, status: 'BOUND' }, intent: { id: 'intent-0-selected' } },
        { item: { itemIndex: 1, status: 'BOUND' }, intent: { id: 'intent-1-selected' } },
      ],
    });
    expect(db.client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('distinguishes a missing batch from a batch owned by another device', async () => {
    const missingDb = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(missingDb.client as never)
      .loadBatchState({
        identity: {
          ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
        },
        batchId: 'missing-batch',
      })).resolves.toEqual({ kind: 'not_found' });

    const foreignDb = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) {
        return [batch({ deviceSessionId: 'session-2' })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(foreignDb.client as never)
      .loadBatchState({
        identity: {
          ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
        },
        batchId: 'batch-1',
      })).resolves.toEqual({ kind: 'forbidden' });
    expect(foreignDb.query.mock.calls.map(sqlOf).join('\n')).not.toContain(
      'extension_byok_execution_batch_items',
    );
  });

  it('loads the same complete state by exact owner and idempotency key', async () => {
    const db = database((sql, values) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch()];
      if (sql.includes('FROM "extension_byok_execution_batch_items"')) {
        return [item(0), item(1)];
      }
      if (sql.includes('MAX(latest."execution_batch_attempt_index")')) {
        return [intent(values[0] === 'batch-item-0' ? 0 : 1)];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaExtensionByokExecutionBatchRepository(db.client as never);

    await expect(repository.loadBatchStateByIdempotency({
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
      },
      idempotencyKey: 'batch-idempotency-0001',
    })).resolves.toMatchObject({
      kind: 'found',
      batch: { id: 'batch-1' },
      items: [
        { item: { itemIndex: 0 }, intent: { id: 'intent-0' } },
        { item: { itemIndex: 1 }, intent: { id: 'intent-1' } },
      ],
    });
    expect(db.query.mock.calls[0]).toEqual([
      expect.stringContaining('"owner_user_id" = $1'),
      'owner-1',
      'owner-1',
      'session-1',
      'batch-idempotency-0001',
    ]);
    const lookupSql = String(db.query.mock.calls[0]?.[0]);
    expect(lookupSql).toContain('"actor_user_id" = $2');
    expect(lookupSql).toContain('"device_session_id" = $3');
    expect(lookupSql).toContain('"idempotency_key" = $4');
  });

  it('makes a foreign-device idempotency lookup indistinguishable from a missing batch', async () => {
    const identity = {
      ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
    };
    const missingDb = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(missingDb.client as never)
      .loadBatchStateByIdempotency({
        identity,
        idempotencyKey: 'batch-idempotency-0001',
      })).resolves.toEqual({ kind: 'not_found' });

    const foreignDb = database((sql, values) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) {
        expect(sql).toContain('"actor_user_id" = $2');
        expect(sql).toContain('"device_session_id" = $3');
        expect(sql).toContain('"idempotency_key" = $4');
        expect(values).toEqual([
          'owner-1', 'owner-1', 'session-1', 'batch-idempotency-0001',
        ]);
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(foreignDb.client as never)
      .loadBatchStateByIdempotency({
        identity,
        idempotencyKey: 'batch-idempotency-0001',
      })).resolves.toEqual({ kind: 'not_found' });

    const ambiguousDb = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch(), batch()];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(ambiguousDb.client as never)
      .loadBatchStateByIdempotency({
        identity,
        idempotencyKey: 'batch-idempotency-0001',
      })).rejects.toThrow(/ambiguous/iu);
  });

  it.each([
    {
      name: 'duplicate batch rows',
      handler: (sql: string) => {
        if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch(), batch()];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      name: 'BOUND batch without bound draft identity',
      handler: (sql: string) => {
        if (sql.includes('FROM "extension_byok_execution_batches"')) {
          return [batch({ status: 'BOUND', boundAt: LATER })];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      name: 'missing reserved item',
      handler: (sql: string) => {
        if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch()];
        if (sql.includes('FROM "extension_byok_execution_batch_items"')) return [item(0)];
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
    {
      name: 'ambiguous latest intent rows',
      handler: (sql: string) => {
        if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch()];
        if (sql.includes('FROM "extension_byok_execution_batch_items"')) {
          return [item(0), item(1)];
        }
        if (sql.includes('MAX(latest."execution_batch_attempt_index")')) {
          return [intent(0), intent(0, { id: 'intent-duplicate' })];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  ])('fails closed on $name', async ({ handler }) => {
    const db = database(handler);
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .loadBatchState({
        identity: {
          ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
        },
        batchId: 'batch-1',
      })).rejects.toThrow(/batch|intent|reservation/iu);
  });

  it('releases every active item and cancels only after all attempts are terminal', async () => {
    const cancelled = batch({
      status: 'CANCELLED',
      cancelledAt: LATER,
      updatedAt: LATER,
    });
    const db = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch()];
      if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
      if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
      if (sql.includes('FROM "extension_byok_execution_batch_items"')) {
        return [item(0), item(1)];
      }
      if (sql.includes('intent."outcome" IN')) return [];
      if (sql.includes('UPDATE "extension_byok_execution_batch_items"')) {
        return [{ id: 'batch-item-0' }, { id: 'batch-item-1' }];
      }
      if (sql.includes('UPDATE "extension_byok_execution_batches"')) return [cancelled];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .cancelBatch({
        identity: {
          ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
        },
        batchId: 'batch-1',
        now: LATER,
      })).resolves.toMatchObject({ kind: 'cancelled', batch: { status: 'CANCELLED' } });
  });

  it('keeps pending and unknown Provider attempts from releasing reservations', async () => {
    const db = database((sql) => {
      if (sql.includes('FROM "extension_byok_execution_batches"')) return [batch()];
      if (sql.includes('AS "allowed"')) return [{ allowed: true, current: true }];
      if (sql.includes('claim_extension_ai_image_execution_mode')) return [{ claimed: '' }];
      if (sql.includes('FROM "extension_byok_execution_batch_items"')) {
        return [item(0), item(1)];
      }
      if (sql.includes('intent."outcome" IN')) return [{ id: 'intent-pending' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    await expect(createPrismaExtensionByokExecutionBatchRepository(db.client as never)
      .cancelBatch({
        identity: {
          ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
        },
        batchId: 'batch-1',
        now: LATER,
      })).resolves.toEqual({ kind: 'attempt_blocked' });
    expect(db.query.mock.calls.map(sqlOf).join('\n')).not.toContain(
      'UPDATE "extension_byok_execution_batch_items"',
    );
  });
});
