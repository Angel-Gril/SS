import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaExtensionByokExecutionIntentRepository,
} from '../services/extension-byok-execution-intent-prisma.js';
import type { ExtensionByokExecutionIntentRecord } from '../services/extension-byok-execution-intent.js';

const HASH = 'a'.repeat(64);

function intent(overrides: Partial<ExtensionByokExecutionIntentRecord> = {}) {
  return {
    id: 'intent-1',
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
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND' as const,
    assignmentOrdinal: 0,
    policyRevision: 23,
    providerOriginSha256: 'b'.repeat(64),
    model: 'image-model-1',
    operation: 'TEXT_TO_IMAGE' as const,
    requestMode: 'json' as const,
    providerIdempotencyKey: 'provider-attempt-0001',
    providerRequestHash: HASH,
    requestHash: 'c'.repeat(64),
    outcome: 'PENDING' as const,
    providerRequestIdSha256: null,
    resultSha256: null,
    outcomeUpdatedAt: null,
    createdAt: new Date('2026-07-27T06:00:00.000Z'),
    updatedAt: new Date('2026-07-27T06:00:00.000Z'),
    ...overrides,
  };
}

function row(overrides: Partial<ExtensionByokExecutionIntentRecord> = {}) {
  const value = intent(overrides);
  return {
    ...value,
    createdAt: value.createdAt,
  };
}

function client(results: unknown[]) {
  const query = vi.fn(async (..._args: unknown[]) => results.shift());
  return {
    query,
    value: {
      $queryRawUnsafe: query,
      $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation({
        $queryRawUnsafe: query,
      })),
    },
  };
}

describe('Prisma extension BYOK execution intent repository', () => {
  it('revalidates live device/current draft, claims BYOK mode, then inserts the intent', async () => {
    const db = client([[{ allowed: true, current: true }], [], [{ reserved: false }], [row()]]);
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.claim(intent())).resolves.toMatchObject({
      kind: 'created', intent: { id: 'intent-1', executionMode: 'BYOK' },
    });

    expect(db.query).toHaveBeenCalledTimes(4);
    expect(String(db.query.mock.calls[0]?.[0])).toContain('extension_device_shop_grants');
    expect(String(db.query.mock.calls[1]?.[0])).toContain('claim_extension_ai_image_execution_mode');
    expect(String(db.query.mock.calls[2]?.[0])).toContain('extension_byok_execution_batch_items');
    expect(String(db.query.mock.calls[3]?.[0])).toContain('extension_byok_execution_intents');
  });

  it('returns the exact existing row for a same-key replay', async () => {
    const db = client([
      [{ allowed: true, current: true }], [], [{ reserved: false }], [],
      [row({ id: 'intent-old' })],
    ]);
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.claim(intent())).resolves.toMatchObject({
      kind: 'replayed', intent: { id: 'intent-old', providerRequestHash: HASH },
    });
  });

  it('rejects a changed payload behind the same Provider idempotency key', async () => {
    const db = client([[
      { allowed: true, current: true },
    ], [], [{ reserved: false }], [], [row({ requestHash: 'd'.repeat(64) })]]);
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.claim(intent())).resolves.toEqual({ kind: 'idempotency_conflict' });
  });

  it('bounds retained attempts while allowing exact replays to bypass the cap', async () => {
    const capacity = client([[{ allowed: true, current: true }], [], [{ reserved: false }], [], []]);
    const repository = createPrismaExtensionByokExecutionIntentRepository(capacity.value as never);
    await expect(repository.claim(intent())).resolves.toEqual({ kind: 'capacity_exceeded' });

    const replay = client([
      [{ allowed: true, current: true }], [], [{ reserved: false }], [],
      [row({ id: 'intent-existing' })],
    ]);
    await expect(createPrismaExtensionByokExecutionIntentRepository(replay.value as never)
      .claim(intent())).resolves.toMatchObject({ kind: 'replayed', intent: { id: 'intent-existing' } });
  });

  it('maps the database mode fence to a stable domain conflict', async () => {
    const db = client([[{ allowed: true, current: true }], []]);
    db.query.mockRejectedValueOnce(Object.assign(new Error(
      'violates extension_ai_image_execution_mode_exclusive',
    ), { constraint: 'extension_ai_image_execution_mode_exclusive' }));
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.claim(intent())).resolves.toEqual({ kind: 'mode_conflict' });
  });

  it('maps a concurrent batch reservation trigger to a stable domain conflict', async () => {
    const db = client([[{ allowed: true, current: true }], [], [{ reserved: false }]]);
    db.query.mockRejectedValueOnce(Object.assign(new Error(
      'violates extension_byok_execution_intent_batch_reservation_conflict',
    ), { constraint: 'extension_byok_execution_intent_batch_reservation_conflict' }));
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.claim(intent())).resolves.toEqual({ kind: 'reservation_conflict' });
  });

  it.each([
    [{ allowed: false, current: true }, 'forbidden'],
    [{ allowed: true, current: false }, 'stale'],
  ] as const)('fails before claiming mode when authority is %o', async (authority, kind) => {
    const db = client([[authority]]);
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.claim(intent())).resolves.toEqual({ kind });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('records a first terminal outcome and replays only the exact same outcome', async () => {
    const succeeded = row({
      outcome: 'SUCCEEDED',
      providerRequestIdSha256: 'd'.repeat(64),
      resultSha256: 'e'.repeat(64),
      outcomeUpdatedAt: new Date('2026-07-27T06:01:00.000Z'),
      updatedAt: new Date('2026-07-27T06:01:00.000Z'),
    });
    const db = client([[row()], [{ allowed: true }], [succeeded]]);
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.recordOutcome({
      identity: { ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1' },
      intentId: 'intent-1',
      providerIdempotencyKey: 'provider-attempt-0001',
      providerRequestHash: HASH,
      outcome: 'SUCCEEDED',
      providerRequestIdSha256: 'd'.repeat(64),
      resultSha256: 'e'.repeat(64),
      outcomeUpdatedAt: new Date('2026-07-27T06:01:00.000Z'),
    })).resolves.toMatchObject({ kind: 'updated', intent: { outcome: 'SUCCEEDED' } });

    const replay = client([[succeeded], [{ allowed: true }]]);
    await expect(createPrismaExtensionByokExecutionIntentRepository(replay.value as never)
      .recordOutcome({
        identity: { ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1' },
        intentId: 'intent-1', providerIdempotencyKey: 'provider-attempt-0001',
        providerRequestHash: HASH, outcome: 'SUCCEEDED',
        providerRequestIdSha256: 'd'.repeat(64), resultSha256: 'e'.repeat(64),
        outcomeUpdatedAt: new Date('2026-07-27T06:02:00.000Z'),
      })).resolves.toMatchObject({ kind: 'replayed', intent: { outcome: 'SUCCEEDED' } });
  });

  it('keeps UNKNOWN_OUTCOME absorbing', async () => {
    const unknown = row({
      outcome: 'UNKNOWN_OUTCOME',
      outcomeUpdatedAt: new Date('2026-07-27T06:01:00.000Z'),
      updatedAt: new Date('2026-07-27T06:01:00.000Z'),
    });
    const db = client([[unknown], [{ allowed: true }]]);
    const repository = createPrismaExtensionByokExecutionIntentRepository(db.value as never);
    await expect(repository.recordOutcome({
      identity: { ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1' },
      intentId: 'intent-1', providerIdempotencyKey: 'provider-attempt-0001',
      providerRequestHash: HASH, outcome: 'FAILED_FINAL',
      providerRequestIdSha256: null, resultSha256: null,
      outcomeUpdatedAt: new Date('2026-07-27T06:02:00.000Z'),
    })).resolves.toEqual({ kind: 'outcome_conflict' });
  });
});
