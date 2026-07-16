import { describe, expect, it, vi } from 'vitest';

import { createPrismaOzonPublisherRolloutAdminRepository } from '../services/ozon-publisher-rollout-admin-prisma.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = new Date('2026-07-16T00:00:00.000Z');

function gate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gate-created',
    writerEntrypoint: 'COLLECT_PUBLISH_OZON',
    originChannel: 'DIRECT',
    rolloutRevision: 'rollout-2026-07-16',
    recordContractVersion: 'ozon-publisher-rollout-gate/v1',
    evidencePolicyHash: HASH_A,
    authorizedControlConfigHash: HASH_B,
    guardContractVersion: 'ozon-publisher-rollout-guard/v1',
    denominatorEnforcedFrom: NOW,
    state: 'NOT_READY',
    stateVersion: 0,
    readyEvaluationId: null,
    evidenceHash: null,
    evaluationHash: null,
    approvedByUserId: null,
    approvedAt: null,
    approvalReason: null,
    revokedByUserId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup(row = gate()) {
  const tx = { ozonPublisherRolloutGate: { upsert: vi.fn(async () => row) } };
  const client = { $transaction: vi.fn(async (action: (value: typeof tx) => unknown) => action(tx)) };
  const loadControlSnapshot = vi.fn(async () => ({
    evidencePolicyHash: HASH_A,
    controlConfigHash: HASH_B,
  }));
  const repository = createPrismaOzonPublisherRolloutAdminRepository({
    client,
    loadControlSnapshot,
    createId: () => 'gate-created',
  });
  return { repository, tx, loadControlSnapshot };
}

const input = {
  actor: {
    actorUserId: 'super-admin-1', actorRole: 'ADMIN',
    isSuperAdmin: true, tokenUse: 'account_session',
  },
  writerEntrypoint: 'COLLECT_PUBLISH_OZON' as const,
  originChannel: 'DIRECT' as const,
  rolloutRevision: 'rollout-2026-07-16',
};

describe('Prisma Ozon publisher rollout gate provisioning', () => {
  it('creates a NOT_READY gate bound to the current evidence and control contracts', async () => {
    const { repository, tx, loadControlSnapshot } = setup();
    const result = await repository.provisionGate(input);

    expect(result).toMatchObject({ record: { id: 'gate-created', state: 'NOT_READY', stateVersion: 0 }, idempotent: false });
    expect(loadControlSnapshot).toHaveBeenCalledWith(tx, {
      writerEntrypoint: 'COLLECT_PUBLISH_OZON',
      originChannel: 'DIRECT',
      rolloutRevision: 'rollout-2026-07-16',
    });
    expect(tx.ozonPublisherRolloutGate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        id: 'gate-created', state: 'NOT_READY', stateVersion: 0,
        evidencePolicyHash: HASH_A, authorizedControlConfigHash: HASH_B,
        guardContractVersion: 'ozon-publisher-rollout-guard/v1',
      }),
      update: {},
    }));
  });

  it('returns an existing exact gate as an idempotent replay', async () => {
    const { repository } = setup(gate({ id: 'existing-gate' }));
    await expect(repository.provisionGate(input)).resolves.toMatchObject({
      record: { id: 'existing-gate' }, idempotent: true,
    });
  });

  it('rejects reuse of a rollout revision after its authorized control snapshot drifts', async () => {
    const { repository } = setup(gate({ authorizedControlConfigHash: 'c'.repeat(64) }));
    await expect(repository.provisionGate(input)).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_ROLLOUT_IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
  });
});
