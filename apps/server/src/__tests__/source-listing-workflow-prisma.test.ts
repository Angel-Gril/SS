import { describe, expect, it } from 'vitest';
import type { OzonListingDraft } from 'shared';
import {
  createPrismaSourceListingWorkflowRepository,
  normalizeSourceListingSkuKeys,
} from '../services/source-listing-workflow-prisma.js';

const NOW = new Date('2026-07-15T08:00:00.000Z');

class ScriptedClient {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactionOptions: unknown[] = [];
  constructor(private readonly handler: (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>) {}
  async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
    this.calls.push({ sql, params });
    return await this.handler(sql, params) as T;
  }
  async $transaction<T>(action: (tx: ScriptedClient) => Promise<T>, options?: unknown): Promise<T> {
    this.transactionOptions.push(options);
    return action(this);
  }
}

function draft(overrides: Partial<OzonListingDraft> = {}): OzonListingDraft {
  return {
    id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-a', 'sku-b'], draftVersion: 1, revision: 1,
    stage: 'CATEGORY_REVIEW', runState: 'ACTIVE', runStateReason: null, category: null,
    attributes: { values: {} },
    copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
    media: { assignments: [] }, pricing: { value: null },
    validation: { status: 'NOT_RUN', report: null },
    completedStepHashes: {},
    blockers: [],
    warnings: [],
    publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null }, attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null }, media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null }, validation: { state: 'CURRENT', reason: null },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [{
      id: 'audit-1', type: 'DRAFT_CREATED', actorUserId: 'owner-1', draftVersion: 1,
      occurredAt: NOW.toISOString(), details: {},
    }],
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...overrides,
  };
}

function currentRow(payload: OzonListingDraft) {
  return {
    id: payload.id, ownerUserId: payload.ownerUserId, shopId: payload.shopId,
    supplyGoodsId: payload.supplyGoodsId, sourceSubjectId: 'subject-1',
    currentSourceCaptureSnapshotId: payload.sourceCaptureSnapshotId,
    selectedSkuHash: 'a'.repeat(64), currentRevision: payload.revision,
    currentDraftVersion: payload.draftVersion, payload,
  };
}

describe('Prisma Ozon listing draft repository', () => {
  it('accepts canonical source SKU keys through 500 characters and rejects longer values', () => {
    const boundary = '商'.repeat(500);
    expect(normalizeSourceListingSkuKeys([boundary]).keys).toEqual([boundary]);
    expect(() => normalizeSourceListingSkuKeys(['x'.repeat(501)]))
      .toThrow('selected SKU key is invalid');
  });

  it('normalizes identity and atomically creates revision one with mandatory audit', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return [{}];
      if (sql.includes('AND w."status" = \'ACTIVE\'')) return [];
      if (sql.includes('INSERT INTO "source_listing_workflows"')) return [{ id: 'draft-1' }];
      return [];
    });
    const repository = createPrismaSourceListingWorkflowRepository({
      client: client as never, now: () => NOW, createId: () => 'revision-row-1',
    });
    const created = await repository.create(draft({ selectedSkuKeys: [' sku-b ', 'sku-a', 'sku-b'] }));

    expect(created.selectedSkuKeys).toEqual(['sku-a', 'sku-b']);
    expect(client.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    const workflow = client.calls.find(({ sql }) => sql.includes('INSERT INTO "source_listing_workflows"'))!;
    expect(JSON.parse(String(workflow.params[5]))).toEqual(['sku-a', 'sku-b']);
    expect(client.calls.some(({ sql }) => sql.includes('INSERT INTO "source_listing_draft_versions"'))).toBe(true);
    expect(client.calls.some(({ sql }) => sql.includes('INSERT INTO "source_listing_workflow_events"'))).toBe(true);
  });

  it('retries PostgreSQL serialization failures nested in Prisma raw-query errors', async () => {
    let attempts = 0;
    const tx = new ScriptedClient((sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return [{}];
      if (sql.includes('AND w."status" = \'ACTIVE\'')) return [];
      if (sql.includes('INSERT INTO "source_listing_workflows"')) return [{ id: 'draft-1' }];
      return [];
    });
    const client = {
      $queryRawUnsafe: tx.$queryRawUnsafe.bind(tx),
      async $transaction<T>(action: (client: ScriptedClient) => Promise<T>, options?: unknown) {
        attempts += 1;
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        if (attempts === 1) {
          throw Object.assign(new Error('could not serialize access due to concurrent update'), {
            code: 'P2010',
            meta: { code: '40001' },
          });
        }
        return action(tx);
      },
    };
    const repository = createPrismaSourceListingWorkflowRepository({
      client: client as never, now: () => NOW, createId: () => 'revision-row-1',
    });

    await expect(repository.create(draft())).resolves.toMatchObject({ id: 'draft-1' });
    expect(attempts).toBe(2);
  });

  it('finds the latest resumable exact owner identity and excludes terminal statuses', async () => {
    const expected = draft();
    const client = new ScriptedClient((sql, params) => {
      expect(sql).toContain('w."owner_user_id" = $1');
      expect(sql).toContain('w."supply_goods_id" = $3');
      expect(sql).toContain(
        'w."status" IN (\'ACTIVE\', \'PAUSED\', \'RETRYABLE_FAILURE\', \'MANUAL_REVIEW\')',
      );
      expect(sql).not.toContain("'CANCELLED'");
      expect(sql).not.toContain("'PERMANENT_FAILURE'");
      expect(sql).not.toContain("'COMPLETED'");
      expect(sql).toContain('ORDER BY w."updated_at" DESC, w."id" DESC');
      expect(params.slice(0, 4)).toEqual(['owner-1', 'shop-1', 'goods-1', 'snapshot-1']);
      return [{ payload: expected }];
    });
    const repository = createPrismaSourceListingWorkflowRepository({ client: client as never });

    await expect(repository.findCurrentByIdentity({
      ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
      sourceCaptureSnapshotId: 'snapshot-1', selectedSkuKeys: ['sku-b', 'sku-a'],
    })).resolves.toEqual(expected);
  });

  it('appends ordinary revisions without revoking grants and returns the latest major version revision', async () => {
    const current = draft();
    const next = draft({ revision: 2, stage: 'ATTRIBUTE_REVIEW', updatedAt: NOW.toISOString() });
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FOR UPDATE OF w')) return [currentRow(current)];
      if (sql.includes('UPDATE "source_listing_workflows"')) return [{ id: 'draft-1' }];
      if (sql.includes('ORDER BY d."revision" DESC')) return [{ payload: next }];
      return [];
    });
    const repository = createPrismaSourceListingWorkflowRepository({ client: client as never, now: () => NOW });

    await expect(repository.compareAndSwap({
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', expectedRevision: 1, next,
    })).resolves.toEqual(next);
    expect(client.calls.some(({ sql }) => sql.includes('UPDATE "extension_command_grants"'))).toBe(false);
    await expect(repository.getVersion({
      draftId: 'draft-1', ownerUserId: 'owner-1', draftVersion: 1,
    })).resolves.toEqual(next);
  });

  it('round-trips frozen attribute suggestion provenance through revision JSON', async () => {
    const current = draft();
    const next = draft({
      revision: 2,
      stage: 'ATTRIBUTE_REVIEW',
      attributes: { values: {
        '100': {
          value: ['Белый'], source: 'SOURCE', reviewed: true,
          suggestionProvenance: {
            contractVersion: 'ozon-attribute-suggestion-provenance/v1',
            candidateId: 'attribute-suggestion:100:abcdef0123456789abcdef01',
            candidateHash: 'b'.repeat(64),
            schemaRevision: 'c'.repeat(64),
            sourceCaptureSnapshotId: 'snapshot-1',
            sourceCaptureHash: 'a'.repeat(64),
            draftVersion: 1,
            draftRevision: 1,
            evidenceDetails: [{
              id: 'capture-standard:colors', attributeId: 100,
              source: 'SOURCE_STANDARD', path: 'capture:/skus/0/attributes/0/value',
              value: ['白色'], confidence: 0.9, isEstimated: false,
            }],
          },
        },
      } },
      updatedAt: NOW.toISOString(),
    });
    const persisted = JSON.parse(JSON.stringify(next)) as OzonListingDraft;
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FOR UPDATE OF w')) return [currentRow(current)];
      if (sql.includes('UPDATE "source_listing_workflows"')) return [{ id: 'draft-1' }];
      if (sql.includes('ORDER BY d."revision" DESC')) return [{ payload: persisted }];
      return [];
    });
    const repository = createPrismaSourceListingWorkflowRepository({
      client: client as never,
      now: () => NOW,
    });

    await repository.compareAndSwap({
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, next,
    });
    const insert = client.calls.find(({ sql }) => sql.includes('INSERT INTO "source_listing_draft_versions"'))!;
    expect(JSON.parse(String(insert.params[9]))).toMatchObject({
      attributes: { values: {
        '100': { suggestionProvenance: next.attributes.values['100']!.suggestionProvenance },
      } },
    });

    const reloaded = await repository.getVersion({
      draftId: 'draft-1', ownerUserId: 'owner-1', draftVersion: 1,
    });
    expect(reloaded?.attributes.values['100']?.suggestionProvenance)
      .toEqual(next.attributes.values['100']?.suggestionProvenance);
    expect(reloaded?.attributes.values['100']?.suggestionProvenance)
      .not.toBe(next.attributes.values['100']?.suggestionProvenance);
  });

  it('advances the major version and revokes only old unconsumed owner workflow grants', async () => {
    const current = draft();
    const next = draft({
      revision: 2, draftVersion: 2, shopId: 'shop-2',
      grantRevocation: { required: true, reason: 'SHOP_CHANGED', previousShopId: 'shop-1' },
      auditEvents: [...current.auditEvents, {
        id: 'audit-2', type: 'SHOP_CHANGED', actorUserId: 'owner-1', draftVersion: 2,
        occurredAt: NOW.toISOString(), details: { shopId: 'shop-2' },
      }],
    });
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FOR UPDATE OF w')) return [currentRow(current)];
      if (sql.includes('UPDATE "source_listing_workflows"')) return [{ id: 'draft-1' }];
      return [];
    });
    await createPrismaSourceListingWorkflowRepository({ client: client as never, now: () => NOW })
      .compareAndSwap({
        draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
        expectedRevision: 1, next,
      });

    const revoke = client.calls.find(({ sql }) => sql.includes('UPDATE "extension_command_grants"'))!;
    expect(revoke.sql).toContain('"owner_user_id" = $2');
    expect(revoke.sql).toContain('"consumed_at" IS NULL AND "revoked_at" IS NULL');
    expect(revoke.params).toEqual([NOW, 'owner-1', 'draft-1', 1]);
  });

  it('rejects stale CAS before writing a revision', async () => {
    const current = draft({ revision: 2 });
    const client = new ScriptedClient((sql) => (
      sql.includes('FOR UPDATE OF w') ? [currentRow(current)] : []
    ));
    const repository = createPrismaSourceListingWorkflowRepository({ client: client as never });
    await expect(repository.compareAndSwap({
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', expectedRevision: 1,
      next: draft({ revision: 2 }),
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(client.calls).toHaveLength(1);
  });

  it('maps recoverable identity convergence to a typed version conflict', async () => {
    const current = draft();
    const next = draft({ revision: 2, shopId: 'shop-2' });
    const client = {
      $queryRawUnsafe: async () => [],
      async $transaction<T>(action: (tx: ScriptedClient) => Promise<T>) {
        const tx = new ScriptedClient((sql) => {
          if (sql.includes('FOR UPDATE OF w')) return [currentRow(current)];
          if (sql.includes('UPDATE "source_listing_workflows"')) {
            throw Object.assign(new Error('duplicate key violates unique constraint "source_listing_workflow_recoverable_identity_key"'), {
              code: 'P2010', meta: { code: '23505' },
            });
          }
          return [];
        });
        return action(tx);
      },
    };
    const repository = createPrismaSourceListingWorkflowRepository({ client: client as never });
    await expect(repository.compareAndSwap({
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, next,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('records publish intent with its revision atomically and replays owner-scoped exact retries', async () => {
    const current = draft();
    const next = draft({
      revision: 2, stage: 'PUBLISH_INTENT_RECORDED',
      auditEvents: [...current.auditEvents, {
        id: 'audit-publish', type: 'PUBLISH_INTENT_RECORDED', actorUserId: 'owner-1', draftVersion: 1,
        occurredAt: NOW.toISOString(), details: { idempotencyKey: 'publish-key' },
      }],
    });
    const intent = {
      id: 'intent-1', draftId: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      draftVersion: 1, revision: 2, idempotencyKey: 'publish-key', payloadHash: 'd'.repeat(64),
      actorUserId: 'owner-1', createdAt: NOW.toISOString(),
    };
    let inserted = false;
    const client = new ScriptedClient((sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return [{}];
      if (sql.includes('FROM "source_listing_publish_intents"')) {
        return inserted ? [{
          ...intent, workflowId: intent.draftId, createdAt: NOW,
        }] : [];
      }
      if (sql.includes('FOR UPDATE OF w')) return [currentRow(current)];
      if (sql.includes('UPDATE "source_listing_workflows"')) return [{ id: 'draft-1' }];
      if (sql.includes('INSERT INTO "source_listing_publish_intents"')) {
        inserted = true;
        return [{ ...intent, workflowId: intent.draftId, createdAt: NOW }];
      }
      if (sql.includes('FROM "source_listing_workflows" w')) return [currentRow(next)];
      return [];
    });
    const repository = createPrismaSourceListingWorkflowRepository({ client: client as never, now: () => NOW });
    const input = {
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', expectedRevision: 1,
      idempotencyKey: 'publish-key', payloadHash: 'd'.repeat(64), next, intent,
    };
    await expect(repository.recordPublishIntent(input)).resolves.toMatchObject({ idempotent: false, intent });
    await expect(repository.recordPublishIntent(input)).resolves.toMatchObject({ idempotent: true, intent });
    await expect(repository.recordPublishIntent({
      ...input,
      payloadHash: 'e'.repeat(64),
      intent: { ...intent, payloadHash: 'e'.repeat(64) },
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(client.calls.filter(({ sql }) => sql.includes('INSERT INTO "source_listing_publish_intents"')))
      .toHaveLength(1);
    expect(client.calls.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock')))
      .toBeLessThan(client.calls.findIndex(({ sql }) => sql.includes('FROM "source_listing_publish_intents"')));
  });
});
