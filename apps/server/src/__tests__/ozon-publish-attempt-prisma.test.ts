import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPrismaOzonPublishAttemptRepository } from '../services/ozon-publish-attempt-prisma.js';
import {
  hashOzonPublishJson,
  type OzonPublishAttemptRecord,
  type OzonPublishJson,
} from '../services/ozon-publish-attempts.js';

type QueryHandler = (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>;

class ScriptedClient {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactionOptions: unknown[] = [];

  constructor(private readonly handler: QueryHandler) {}

  async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
    this.calls.push({ sql, params });
    return await this.handler(sql, params) as T;
  }

  async $transaction<T>(action: (tx: ScriptedClient) => Promise<T>, options?: unknown): Promise<T> {
    this.transactionOptions.push(options);
    return action(this);
  }
}

const NOW = new Date('2026-07-15T12:00:00.000Z');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function sourceRow() {
  return {
    publishIntentId: 'intent-1', workflowId: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    draftVersion: 3, revision: 5, sourceCaptureSnapshotId: 'snapshot-1', actorUserId: 'owner-1',
    idempotencyKey: 'publish-attempt-key', draftStateHash: HASH_A, draftPayloadHash: HASH_B,
    draftPayload: { version: 3 }, currentRevision: 5, currentDraftVersion: 3,
    currentShopId: 'shop-1', currentStage: 'PUBLISH_INTENT_RECORDED', currentStatus: 'ACTIVE',
  };
}

function attemptRow(overrides: Partial<OzonPublishAttemptRecord> = {}): Record<string, unknown> {
  return {
    id: 'attempt-1', publishIntentId: 'intent-1', workflowId: 'workflow-1', ownerUserId: 'owner-1',
    shopId: 'shop-1', draftVersion: 3, revision: 5, sourceCaptureSnapshotId: 'snapshot-1',
    actorUserId: 'owner-1', idempotencyKey: 'publish-attempt-key', catalogSnapshotId: 'catalog-1',
    catalogRevision: 'catalog-rev-1', catalogSnapshot: { revision: 1 },
    catalogSnapshotHash: hashOzonPublishJson({ revision: 1 }),
    attributeSchemaSnapshot: { fields: [] }, attributeSchemaHash: hashOzonPublishJson({ fields: [] }),
    publisherContractVersion: 'publisher/v1', endpoint: '/v3/product/import',
    draftPayloadHash: HASH_B, draftStateHash: HASH_A,
    requestPayload: { items: [{ offer_id: 'offer-1' }] },
    requestPayloadHash: hashOzonPublishJson({ items: [{ offer_id: 'offer-1' }] }),
    offerTrace: [{ ordinal: 0, offerId: 'offer-1', skuKey: 'sku-1' }], itemCount: 1,
    state: 'PREPARED', reconciliationState: 'NOT_REQUIRED', stateVersion: 1,
    ozonTaskId: null, acceptanceSource: null, response: null, responseHash: null,
    itemResults: null, itemErrors: [], lastErrorCode: null, lastErrorMessage: null,
    leasePurpose: null, leaseToken: null, leaseOwner: null, leaseEpoch: 0,
    heartbeatAt: null, leaseExpiresAt: null, submitStartedAt: null, submittedAt: null,
    unknownAt: null, rejectedAt: null, nextReconcileAt: null, reconcileAttemptCount: 0,
    lastReconciledAt: null, completedAt: null, resolvedByUserId: null, resolutionNote: null,
    resolutionEvidence: null, resolutionEvidenceHash: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

function prepareInput(overrides: Record<string, unknown> = {}) {
  const catalogSnapshot = { revision: 1 } as Record<string, OzonPublishJson>;
  const attributeSchemaSnapshot = { fields: [] } as Record<string, OzonPublishJson>;
  const requestPayload = { items: [{ offer_id: 'offer-1' }] } as Record<string, OzonPublishJson>;
  return {
    publishIntentId: 'intent-1', ownerUserId: 'owner-1', catalogSnapshotId: 'catalog-1',
    catalogRevision: 'catalog-rev-1', catalogSnapshot,
    catalogSnapshotHash: hashOzonPublishJson(catalogSnapshot), attributeSchemaSnapshot,
    attributeSchemaHash: hashOzonPublishJson(attributeSchemaSnapshot),
    publisherContractVersion: 'publisher/v1', endpoint: '/v3/product/import', requestPayload,
    requestPayloadHash: hashOzonPublishJson(requestPayload),
    offerTrace: [{ ordinal: 0, offerId: 'offer-1', skuKey: 'sku-1' }],
    ...overrides,
  };
}

describe('Prisma Ozon publish attempt repository', () => {
  it('loads a persisted attempt by publish intent only within its owner scope', async () => {
    const client = new ScriptedClient((sql, params) => {
      expect(sql).toContain('a."publish_intent_id" = $1 AND a."owner_user_id" = $2');
      expect(params).toEqual(['intent-1', 'owner-1']);
      return [attemptRow({ state: 'SUBMITTED', ozonTaskId: '123' })];
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.getByPublishIntent({
      publishIntentId: 'intent-1',
      ownerUserId: 'owner-1',
    })).resolves.toMatchObject({
      publishIntentId: 'intent-1', ownerUserId: 'owner-1', state: 'SUBMITTED', ozonTaskId: '123',
    });
  });

  it('rejects a request whose ordered offer IDs do not match its frozen trace before opening a transaction', async () => {
    const client = new ScriptedClient(() => { throw new Error('database must not be called'); });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.prepare(prepareInput({
      requestPayload: { items: [{ offer_id: 'different-offer' }] },
      requestPayloadHash: hashOzonPublishJson({ items: [{ offer_id: 'different-offer' }] }),
    }))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(client.calls).toHaveLength(0);
    expect(client.transactionOptions).toHaveLength(0);
  });

  it('prepares the exact current intent and appends its initial event in one serializable transaction', async () => {
    const ids = ['attempt-1', 'event-1'];
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "source_listing_publish_intents" intent')) return [sourceRow()];
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: 1 }];
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [];
      if (sql.includes('FROM "ozon_category_catalog_snapshots"')) return [{ id: 'catalog-1' }];
      if (sql.includes('INSERT INTO "ozon_publish_attempts"')) return [attemptRow()];
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({
      client: client as never,
      createId: () => ids.shift() || 'unexpected-id',
    });

    await expect(repository.prepare(prepareInput())).resolves.toMatchObject({
      idempotent: false,
      attempt: { id: 'attempt-1', requestPayloadHash: hashOzonPublishJson({ items: [{ offer_id: 'offer-1' }] }) },
    });
    expect(client.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    const event = client.calls.find(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempt_events"'))!;
    expect(event.params).toEqual(expect.arrayContaining(['event-1', 'attempt-1', 1, 'PREPARED', 'owner-1']));
  });

  it('conflicts when an existing prepared intent recompiles to a different immutable request', async () => {
    const changedPayload = { items: [{ offer_id: 'offer-1', name: 'changed after validation' }] };
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "source_listing_publish_intents" intent')) return [sourceRow()];
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: 1 }];
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [attemptRow()];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.prepare(prepareInput({
      requestPayload: changedPayload,
      requestPayloadHash: hashOzonPublishJson(changedPayload),
    }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(client.calls.some(({ sql }) => sql.includes('ozon_category_catalog_snapshots'))).toBe(false);
    expect(client.calls.some(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempts"'))).toBe(false);
  });

  it('heartbeats either active lease purpose with token and epoch fencing', async () => {
    const client = new ScriptedClient((sql, params) => {
      expect(sql).toContain('"lease_purpose" IN (\'SUBMIT\', \'RECONCILE\')');
      expect(sql).toContain('"lease_expires_at" > clock_timestamp()');
      expect(params).toEqual(['attempt-1', 'worker-1', 'token-1', 4, 30_000]);
      return [{ id: 'attempt-1' }];
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.heartbeat({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseToken: 'token-1', leaseEpoch: 4,
      leaseMs: 30_000,
    })).resolves.toBe(true);
  });

  it('revalidates the current catalog before submission and durably rejects stale authority', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [attemptRow()];
      if (sql.includes('SELECT EXISTS')) {
        expect(sql).toContain('FROM "ozon_category_catalog_snapshots" catalog');
        expect(sql).toContain('catalog."expires_at" > clock_timestamp()');
        return [{ valid: false }];
      }
      if (sql.includes('UPDATE "ozon_publish_attempts" a')) {
        return [attemptRow({
          state: 'REJECTED', stateVersion: 2, rejectedAt: NOW.toISOString(),
          lastErrorCode: 'LOCAL_STALE_DRAFT',
          lastErrorMessage: 'Publish intent or catalog no longer references current authoritative state',
        })];
      }
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.claimSubmission({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseMs: 30_000,
    })).resolves.toBeNull();
    expect(client.calls.some(({ sql }) => sql.includes('LOCAL_REJECTED'))).toBe(false);
    expect(client.calls.find(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempt_events"'))
      ?.params).toContain('LOCAL_REJECTED');
  });

  it('rejects completion when the worker token or epoch no longer owns the submission lease', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) {
        return [attemptRow({
          state: 'SUBMITTING', stateVersion: 2, leasePurpose: 'SUBMIT', leaseToken: 'new-token',
          leaseOwner: 'worker-1', leaseEpoch: 2,
          heartbeatAt: NOW.toISOString(), leaseExpiresAt: NOW.toISOString(),
          submitStartedAt: NOW.toISOString(),
        })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.completeSubmission({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseToken: 'old-token', leaseEpoch: 1,
      outcome: { kind: 'SUBMITTED', taskId: '9007199254740993', response: { task_id: '9007199254740993' } },
    })).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(client.calls).toHaveLength(1);
  });

  it('preserves prior item diagnostics when manual review has no replacement observations', async () => {
    const priorResults = [{ offerId: 'offer-1', status: 'pending' }];
    const priorErrors = [{ offerId: 'offer-1', code: 'OZON_PENDING_DETAIL' }];
    const running = attemptRow({
      state: 'SUBMITTED', reconciliationState: 'RUNNING', stateVersion: 4,
      ozonTaskId: '123', itemResults: priorResults, itemErrors: priorErrors,
      leasePurpose: 'RECONCILE', leaseToken: 'reconcile-token', leaseOwner: 'worker-1',
      leaseEpoch: 2, heartbeatAt: NOW.toISOString(),
      leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
      reconcileAttemptCount: 2,
    });
    const client = new ScriptedClient((sql, params) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [running];
      if (sql.includes('UPDATE "ozon_publish_attempts" a')) {
        expect(sql).toContain('CASE WHEN $3 THEN $4::jsonb ELSE a."item_results_json" END');
        expect(sql).toContain('CASE WHEN $5 THEN $6::jsonb ELSE a."item_errors_json" END');
        expect(params.slice(2, 6)).toEqual([false, null, false, null]);
        return [attemptRow({
          ...running,
          reconciliationState: 'MANUAL_REVIEW', stateVersion: 5,
          itemResults: priorResults, itemErrors: priorErrors,
          leasePurpose: null, leaseToken: null, leaseOwner: null,
          heartbeatAt: null, leaseExpiresAt: null,
          nextReconcileAt: null,
          lastErrorCode: 'OZON_IMPORT_INFO_UNAVAILABLE',
          lastErrorMessage: 'temporary read failure',
        })];
      }
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({
      client: client as never,
      createId: () => 'retry-event-1',
    });

    await expect(repository.completeReconciliation({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseToken: 'reconcile-token', leaseEpoch: 2,
      outcome: {
        kind: 'MANUAL_REVIEW',
        errorCode: 'OZON_IMPORT_INFO_UNAVAILABLE', errorMessage: 'temporary read failure',
      },
    })).resolves.toMatchObject({ itemResults: priorResults, itemErrors: priorErrors });
    const event = client.calls.find(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempt_events"'))!;
    expect(JSON.parse(String(event.params[8]))).toMatchObject({ itemErrorCount: 1 });
  });

  it('clears prior item diagnostics when reconciliation supplies explicit empty arrays', async () => {
    const nextResults: OzonPublishJson[] = [];
    const running = attemptRow({
      state: 'SUBMITTED', reconciliationState: 'RUNNING', stateVersion: 4,
      ozonTaskId: '123', itemResults: [{ offerId: 'offer-1', status: 'pending' }],
      itemErrors: [{ offerId: 'offer-1', code: 'OLD_ERROR' }],
      leasePurpose: 'RECONCILE', leaseToken: 'reconcile-token', leaseOwner: 'worker-1',
      leaseEpoch: 2, heartbeatAt: NOW.toISOString(),
      leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    });
    const client = new ScriptedClient((sql, params) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [running];
      if (sql.includes('UPDATE "ozon_publish_attempts" a')) {
        expect(params.slice(2, 6)).toEqual([
          true, JSON.stringify(nextResults), true, JSON.stringify([]),
        ]);
        return [attemptRow({
          ...running,
          reconciliationState: 'SUCCEEDED', stateVersion: 5,
          itemResults: nextResults, itemErrors: [],
          leasePurpose: null, leaseToken: null, leaseOwner: null,
          heartbeatAt: null, leaseExpiresAt: null, completedAt: NOW.toISOString(),
        })];
      }
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.completeReconciliation({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseToken: 'reconcile-token', leaseEpoch: 2,
      outcome: { kind: 'SUCCEEDED', itemResults: nextResults, itemErrors: [] },
    })).resolves.toMatchObject({
      reconciliationState: 'SUCCEEDED', itemResults: nextResults, itemErrors: [],
    });
  });

  it('marks stale submissions with an event projection and returns IDs without frozen JSON', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('WITH candidates AS') && sql.includes('STALE_SUBMISSION_LEASE')) {
        for (const forbidden of [
          'catalog_snapshot_json', 'attribute_schema_snapshot_json', 'request_payload_json',
          'response_json', 'item_results_json', 'item_errors_json', 'resolution_evidence_json',
        ]) {
          expect(sql).not.toContain(forbidden);
        }
        expect(sql).toContain('a."state_version" AS "stateVersion"');
        return [{
          id: 'attempt-1', state: 'UNKNOWN', reconciliationState: 'PENDING',
          stateVersion: 3, leaseEpoch: 1,
        }];
      }
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({
      client: client as never,
      createId: () => 'stale-event-1',
    });

    await expect(repository.markStaleSubmissionsUnknown({ workerId: 'stale-worker', limit: 10 }))
      .resolves.toEqual(['attempt-1']);
    expect(client.calls.find(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempt_events"'))
      ?.params).toContain('STALE_SUBMISSION_UNKNOWN');
  });

  it('reclaims an expired running reconciliation lease with a new fenced epoch and audit event', async () => {
    const client = new ScriptedClient((sql, params) => {
      if (sql.startsWith('SELECT "id", ("reconciliation_state"')) {
        expect(sql).toContain('"lease_expires_at" <= clock_timestamp()');
        return [{ id: 'attempt-1', staleLease: true }];
      }
      if (sql.includes('UPDATE "ozon_publish_attempts" a')) {
        expect(sql).toContain('"offer_trace_json" AS "offerTrace"');
        for (const forbidden of [
          'catalog_snapshot_json', 'attribute_schema_snapshot_json', 'request_payload_json',
          'response_json', 'item_results_json', 'item_errors_json', 'resolution_evidence_json',
        ]) {
          expect(sql).not.toContain(forbidden);
        }
        expect(params).toEqual(['attempt-1', 'lease-new', 'worker-new', 30_000, true]);
        return [attemptRow({
          state: 'SUBMITTED', reconciliationState: 'RUNNING', stateVersion: 5,
          ozonTaskId: '123', acceptanceSource: 'TASK_ACK', submittedAt: NOW.toISOString(),
          leasePurpose: 'RECONCILE', leaseToken: 'lease-new', leaseOwner: 'worker-new',
          leaseEpoch: 3, heartbeatAt: NOW.toISOString(),
          leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
          submitStartedAt: NOW.toISOString(), reconcileAttemptCount: 2,
        })];
      }
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({
      client: client as never,
      createLeaseToken: () => 'lease-new',
      createId: () => 'event-reclaimed',
    });

    const claimed = await repository.claimReconciliation({
      workerId: 'worker-new', leaseMs: 30_000, limit: 10,
    });
    expect(claimed).toMatchObject([{ leaseToken: 'lease-new', leaseEpoch: 3 }]);
    expect(claimed[0]?.attempt).not.toHaveProperty('catalogSnapshot');
    expect(claimed[0]?.attempt).not.toHaveProperty('attributeSchemaSnapshot');
    expect(claimed[0]?.attempt).not.toHaveProperty('requestPayload');
    expect(claimed[0]?.attempt).not.toHaveProperty('response');
    expect(claimed[0]?.attempt).not.toHaveProperty('itemResults');
    expect(claimed[0]?.attempt).not.toHaveProperty('itemErrors');
    expect(claimed[0]?.attempt).not.toHaveProperty('resolutionEvidence');
    expect(client.calls.find(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempt_events"'))
      ?.params).toContain('RECONCILIATION_RECLAIMED');
  });

  it('accepts a late acknowledgement only from the current reconciliation lease and releases it', async () => {
    const unknown = attemptRow({
      state: 'UNKNOWN', reconciliationState: 'RUNNING', stateVersion: 4,
      submitStartedAt: NOW.toISOString(), unknownAt: NOW.toISOString(),
      leasePurpose: 'RECONCILE', leaseToken: 'reconcile-token', leaseOwner: 'worker-1',
      leaseEpoch: 2, heartbeatAt: NOW.toISOString(),
      leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    });
    const client = new ScriptedClient((sql, params) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [unknown];
      if (sql.includes('UPDATE "ozon_publish_attempts" a')) {
        expect(sql).toContain('a."lease_owner" = $5');
        expect(sql).toContain('a."lease_token" = $6');
        expect(sql).toContain('a."lease_epoch" = $7');
        expect(sql).toContain('"reconciliation_state" = \'PENDING\'');
        expect(sql).toContain('"lease_purpose" = NULL');
        expect(params.slice(4)).toEqual(['worker-1', 'reconcile-token', 2]);
        return [attemptRow({
          state: 'SUBMITTED', reconciliationState: 'PENDING', stateVersion: 5,
          ozonTaskId: '9007199254740993', acceptanceSource: 'LATE_TASK_ACK',
          response: { task_id: '9007199254740993' },
          responseHash: hashOzonPublishJson({ task_id: '9007199254740993' }),
          submitStartedAt: NOW.toISOString(), submittedAt: NOW.toISOString(),
          unknownAt: NOW.toISOString(), nextReconcileAt: NOW.toISOString(),
          leaseEpoch: 2,
        })];
      }
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({
      client: client as never,
      createId: () => 'late-ack-event',
    });

    await expect(repository.attachLateAcknowledgement({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseToken: 'reconcile-token', leaseEpoch: 2,
      taskId: '9007199254740993', response: { task_id: '9007199254740993' },
    })).resolves.toMatchObject({
      state: 'SUBMITTED', reconciliationState: 'PENDING', leasePurpose: null,
      ozonTaskId: '9007199254740993',
    });
    expect(client.calls.find(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempt_events"'))
      ?.params).toContain('LATE_ACKNOWLEDGEMENT');
  });

  it('rejects a late acknowledgement from a stale reconciliation token before updating', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) {
        return [attemptRow({
          state: 'UNKNOWN', reconciliationState: 'RUNNING', stateVersion: 4,
          submitStartedAt: NOW.toISOString(), unknownAt: NOW.toISOString(), leasePurpose: 'RECONCILE',
          leaseToken: 'new-token', leaseOwner: 'worker-1', leaseEpoch: 3,
          heartbeatAt: NOW.toISOString(),
          leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
        })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.attachLateAcknowledgement({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseToken: 'old-token', leaseEpoch: 2,
      taskId: '123', response: { task_id: '123' },
    })).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(client.calls).toHaveLength(1);
  });

  it('does not overwrite an unknown provider response with later probe evidence', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) {
        return [attemptRow({
          state: 'UNKNOWN', reconciliationState: 'RUNNING', stateVersion: 4,
          response: { status: 'ambiguous', raw: 'original-provider-response' },
          submitStartedAt: NOW.toISOString(), unknownAt: NOW.toISOString(),
          leasePurpose: 'RECONCILE', leaseToken: 'reconcile-token', leaseOwner: 'worker-1',
          leaseEpoch: 2, heartbeatAt: NOW.toISOString(),
          leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
        })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.attachLateAcknowledgement({
      attemptId: 'attempt-1', workerId: 'worker-1', leaseToken: 'reconcile-token', leaseEpoch: 2,
      taskId: '123', response: { source: 'late-probe' },
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(client.calls).toHaveLength(1);
  });

  it('recovers a trusted task response using the original submission claim event', async () => {
    const response = { result: { task_id: '9007199254740993' } };
    const unknown = attemptRow({
      state: 'UNKNOWN', reconciliationState: 'RUNNING', stateVersion: 4,
      submitStartedAt: NOW.toISOString(), unknownAt: NOW.toISOString(),
      leasePurpose: 'RECONCILE', leaseToken: 'reconcile-token', leaseOwner: 'reconcile-worker',
      leaseEpoch: 2, heartbeatAt: NOW.toISOString(),
      leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
      lastErrorCode: 'STALE_SUBMISSION_LEASE',
    });
    const client = new ScriptedClient((sql, params) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [unknown];
      if (sql.includes('FROM "ozon_publish_attempt_events"')) {
        expect(params).toEqual(['attempt-1', 'submit-worker', 1]);
        return [{ leaseTokenHash: createHash('sha256').update('submit-token').digest('hex') }];
      }
      if (sql.includes('UPDATE "ozon_publish_attempts" a')) {
        expect(sql).toContain('"state" = \'SUBMITTED\'');
        expect(sql).toContain('"reconciliation_state" = \'PENDING\'');
        expect(sql).toContain('a."state_version" = $6');
        return [attemptRow({
          ...unknown,
          state: 'SUBMITTED', reconciliationState: 'PENDING', stateVersion: 5,
          ozonTaskId: '9007199254740993', acceptanceSource: 'RECOVERED_TASK_RESPONSE',
          response, responseHash: hashOzonPublishJson(response), submittedAt: NOW.toISOString(),
          nextReconcileAt: NOW.toISOString(), leasePurpose: null, leaseToken: null,
          leaseOwner: null, heartbeatAt: null, leaseExpiresAt: null,
          lastErrorCode: null,
        })];
      }
      if (sql.includes('INSERT INTO "ozon_publish_attempt_events"')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({
      client: client as never,
      createId: () => 'recovered-ack-event',
    });

    await expect(repository.recoverSubmissionAcknowledgement({
      attemptId: 'attempt-1', workerId: 'submit-worker', leaseToken: 'submit-token',
      leaseEpoch: 1, taskId: '9007199254740993', response,
    })).resolves.toMatchObject({
      state: 'SUBMITTED', reconciliationState: 'PENDING', ozonTaskId: '9007199254740993',
      leasePurpose: null, acceptanceSource: 'RECOVERED_TASK_RESPONSE',
    });
    expect(client.calls.find(({ sql }) => sql.includes('INSERT INTO "ozon_publish_attempt_events"'))
      ?.params).toContain('SUBMISSION_ACKNOWLEDGEMENT_RECOVERED');
  });

  it('rejects acknowledgement recovery when the original lease token hash does not match', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) {
        return [attemptRow({
          state: 'UNKNOWN', reconciliationState: 'PENDING', stateVersion: 3,
          submitStartedAt: NOW.toISOString(), unknownAt: NOW.toISOString(),
          nextReconcileAt: NOW.toISOString(), leaseEpoch: 1,
        })];
      }
      if (sql.includes('FROM "ozon_publish_attempt_events"')) {
        return [{ leaseTokenHash: createHash('sha256').update('another-token').digest('hex') }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.recoverSubmissionAcknowledgement({
      attemptId: 'attempt-1', workerId: 'submit-worker', leaseToken: 'submit-token',
      leaseEpoch: 1, taskId: '123', response: { result: { task_id: 123 } },
    })).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(client.calls).toHaveLength(2);
  });

  it('rejects a recovered response whose embedded task ID differs before database access', async () => {
    const client = new ScriptedClient(() => { throw new Error('database must not be called'); });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.recoverSubmissionAcknowledgement({
      attemptId: 'attempt-1', workerId: 'submit-worker', leaseToken: 'submit-token',
      leaseEpoch: 1, taskId: '123', response: { result: { task_id: '456' } },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(client.calls).toHaveLength(0);
  });

  it('does not overwrite a rejected attempt or an unknown attempt with prior provider evidence', async () => {
    const response = { result: { task_id: '123' } };
    const rejectedClient = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) {
        return [attemptRow({ state: 'REJECTED', rejectedAt: NOW.toISOString() })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const rejectedRepository = createPrismaOzonPublishAttemptRepository({
      client: rejectedClient as never,
    });
    await expect(rejectedRepository.recoverSubmissionAcknowledgement({
      attemptId: 'attempt-1', workerId: 'submit-worker', leaseToken: 'submit-token',
      leaseEpoch: 1, taskId: '123', response,
    })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(rejectedClient.calls).toHaveLength(1);

    const unknownClient = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) {
        return [attemptRow({
          state: 'UNKNOWN', reconciliationState: 'PENDING', stateVersion: 3,
          submitStartedAt: NOW.toISOString(), unknownAt: NOW.toISOString(),
          nextReconcileAt: NOW.toISOString(), leaseEpoch: 1,
          response: { result: { task_id: null, status: 'ambiguous' } },
        })];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const unknownRepository = createPrismaOzonPublishAttemptRepository({
      client: unknownClient as never,
    });
    await expect(unknownRepository.recoverSubmissionAcknowledgement({
      attemptId: 'attempt-1', workerId: 'submit-worker', leaseToken: 'submit-token',
      leaseEpoch: 1, taskId: '123', response,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(unknownClient.calls).toHaveLength(1);
  });

  it('returns an identical submitted acknowledgement idempotently and conflicts on another task', async () => {
    const response = { result: { task_id: '123' } };
    const submitted = attemptRow({
      state: 'SUBMITTED', reconciliationState: 'PENDING', stateVersion: 3,
      submitStartedAt: NOW.toISOString(), submittedAt: NOW.toISOString(),
      ozonTaskId: '123', acceptanceSource: 'RECOVERED_TASK_RESPONSE', response,
      responseHash: hashOzonPublishJson(response), nextReconcileAt: NOW.toISOString(),
      leaseEpoch: 1,
    });
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "ozon_publish_attempts" a')) return [submitted];
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = createPrismaOzonPublishAttemptRepository({ client: client as never });

    await expect(repository.recoverSubmissionAcknowledgement({
      attemptId: 'attempt-1', workerId: 'submit-worker', leaseToken: 'submit-token',
      leaseEpoch: 1, taskId: '123', response,
    })).resolves.toMatchObject({ state: 'SUBMITTED', stateVersion: 3, ozonTaskId: '123' });
    expect(client.calls).toHaveLength(1);

    await expect(repository.recoverSubmissionAcknowledgement({
      attemptId: 'attempt-1', workerId: 'submit-worker', leaseToken: 'submit-token',
      leaseEpoch: 1, taskId: '456', response: { result: { task_id: '456' } },
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(client.calls).toHaveLength(2);
  });
});
