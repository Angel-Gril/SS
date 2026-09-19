import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionHostedAiImagePlanBindingRecord,
  type ExtensionHostedAiImagePlanBindingRecord,
} from '../services/extension-hosted-ai-image-plan.js';
import {
  createPrismaExtensionHostedAiImagePlanBindingStore,
  ExtensionHostedAiImagePlanBindingStoreError,
  type ExtensionHostedAiImagePlanBindingPrismaClient,
  type ExtensionHostedAiImagePlanBindingPrismaTransaction,
} from '../services/extension-hosted-ai-image-plan-binding-prisma.js';

function binding(
  overrides: Partial<{
    planId: string;
    ownerUserId: string;
    deviceSessionId: string;
    snapshotId: string;
    supplyGoodsId: string;
    shopId: string;
    listingWorkflowId: string;
    draftRevision: number;
    draftVersion: number;
    selectedSkuKeys: string[];
    candidateMediaKeys: string[];
  }> = {},
): ExtensionHostedAiImagePlanBindingRecord {
  const value = {
    planId: 'plan-1',
    ownerUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-workflow-1',
    draftRevision: 5,
    draftVersion: 7,
    selectedSkuKeys: ['sku-1'],
    candidateMediaKeys: ['media-1'],
    ...overrides,
  };
  return createExtensionHostedAiImagePlanBindingRecord({
    planId: value.planId,
    identity: {
      ownerUserId: value.ownerUserId,
      actorUserId: value.ownerUserId,
      deviceSessionId: value.deviceSessionId,
    },
    binding: {
      snapshotId: value.snapshotId,
      supplyGoodsId: value.supplyGoodsId,
      shopId: value.shopId,
      listingWorkflowId: value.listingWorkflowId,
      draftRevision: value.draftRevision,
      draftVersion: value.draftVersion,
    },
    selectedSkuKeys: value.selectedSkuKeys,
    candidateMediaKeys: value.candidateMediaKeys,
  });
}

function storedRow(
  record: ExtensionHostedAiImagePlanBindingRecord,
  overrides: Record<string, unknown> = {},
) {
  return { id: 'hosted-plan-binding-row-1', ...record, ...overrides };
}

function fixture(options: {
  transactionResults?: unknown[][];
  directResults?: unknown[][];
  transactionFailures?: unknown[];
} = {}) {
  const transactionResults = [...(options.transactionResults || [])];
  const directResults = [...(options.directResults || [])];
  const transactionFailures = [...(options.transactionFailures || [])];
  const transactionQuery = vi.fn(async (
    _query: string,
    ..._values: unknown[]
  ): Promise<unknown> => transactionResults.shift() || []);
  const directQuery = vi.fn(async (
    _query: string,
    ..._values: unknown[]
  ): Promise<unknown> => directResults.shift() || []);
  const transaction: ExtensionHostedAiImagePlanBindingPrismaTransaction = {
    $queryRawUnsafe: transactionQuery as unknown as
      ExtensionHostedAiImagePlanBindingPrismaTransaction['$queryRawUnsafe'],
  };
  const client: ExtensionHostedAiImagePlanBindingPrismaClient = {
    $queryRawUnsafe: directQuery as unknown as
      ExtensionHostedAiImagePlanBindingPrismaClient['$queryRawUnsafe'],
    $transaction: vi.fn(async (operation) => {
      const failure = transactionFailures.shift();
      if (failure) throw failure;
      return operation(transaction);
    }),
  };
  return {
    client,
    transaction,
    transactionQuery,
    directQuery,
    store: createPrismaExtensionHostedAiImagePlanBindingStore(client, {
      createId: () => 'hosted-plan-binding-1',
    }),
  };
}

describe('Prisma extension hosted AI image plan binding store', () => {
  it('inserts an exact immutable binding and returns it as newly bound', async () => {
    const record = binding();
    const { store, client, transactionQuery } = fixture({
      transactionResults: [[storedRow(record)]],
    });

    await expect(store.bind(record)).resolves.toEqual({
      kind: 'bound',
      record,
    });

    expect(client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(transactionQuery).toHaveBeenCalledOnce();
    const [sql, ...values] = transactionQuery.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO "extension_hosted_ai_image_plan_bindings"/u);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/u);
    expect(sql).toMatch(/RETURNING/u);
    expect(values).toEqual([
      'hosted-plan-binding-1',
      record.planId,
      record.ownerUserId,
      record.deviceSessionId,
      record.shopId,
      record.listingWorkflowId,
      record.snapshotId,
      record.supplyGoodsId,
      record.draftRevision,
      record.draftVersion,
      record.selectedSkuHash,
      record.candidateMediaHash,
      record.authorityHash,
      record.bindingHash,
    ]);
  });

  it('derives one authority fence across devices and plans for the same frozen draft', () => {
    const first = binding();
    const second = binding({
      planId: 'plan-2',
      deviceSessionId: 'device-session-2',
    });

    expect(second.authorityHash).toBe(first.authorityHash);
    expect(second.bindingHash).not.toBe(first.bindingHash);
  });

  it('returns only an exact owner-and-plan replay after an insert conflict', async () => {
    const record = binding();
    const { store, transactionQuery } = fixture({
      transactionResults: [[], [storedRow(record)]],
    });

    await expect(store.bind(record)).resolves.toEqual({
      kind: 'replayed',
      record,
    });

    expect(transactionQuery).toHaveBeenCalledTimes(2);
    const [sql, ...values] = transactionQuery.mock.calls[1]!;
    expect(sql).toMatch(/WHERE "owner_user_id" = \$1/u);
    expect(sql).toMatch(/AND "plan_id" = \$2/u);
    expect(sql).toMatch(/FOR UPDATE/u);
    expect(values).toEqual([record.ownerUserId, record.planId]);
  });

  it('adopts an unused binding only through the approved device-session successor lineage', async () => {
    const successor = binding({
      planId: 'plan-2',
      deviceSessionId: 'device-session-2',
    });
    const predecessor = binding({
      planId: successor.planId,
      deviceSessionId: 'device-session-1',
    });
    const { store, transactionQuery } = fixture({
      transactionResults: [[], [storedRow(predecessor)], [storedRow(successor)]],
    });

    await expect(store.bind(successor)).resolves.toEqual({
      kind: 'bound',
      record: successor,
    });

    expect(transactionQuery).toHaveBeenCalledTimes(3);
    const [sql, ...values] = transactionQuery.mock.calls[2]!;
    expect(sql).toMatch(/WITH RECURSIVE replacement_lineage/u);
    expect(sql).toMatch(/UNION ALL/u);
    expect(sql).toMatch(/cardinality\(lineage\."path"\) < 50/u);
    expect(sql).toMatch(/NOT ancestor\."id" = ANY\(lineage\."path"\)/u);
    expect(sql).toMatch(/UPDATE "extension_hosted_ai_image_plan_bindings" binding/u);
    expect(sql).toMatch(/successor\."replaces_session_id" = predecessor\."id"/u);
    expect(sql).toMatch(/successor\."status" = 'ACTIVE'/u);
    expect(sql).toMatch(/predecessor\."status" = 'REVOKED'/u);
    expect(sql).toMatch(/predecessor\."revoked_reason" = 'PAIRING_APPROVED'/u);
    expect(sql).toMatch(/successor\."device_id" = predecessor\."device_id"/u);
    expect(sql).toMatch(/successor\."deployment_id" = predecessor\."deployment_id"/u);
    expect(sql).toMatch(/successor\."scopes" = predecessor\."scopes"/u);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*FROM "ai_media_suites"/u);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*FROM "extension_hosted_ai_image_listing_assignments"/u);
    expect(values).toEqual([
      successor.planId,
      successor.ownerUserId,
      successor.deviceSessionId,
      successor.bindingHash,
      successor.authorityHash,
      successor.shopId,
      successor.listingWorkflowId,
      successor.snapshotId,
      successor.supplyGoodsId,
      successor.draftRevision,
      successor.draftVersion,
      successor.selectedSkuHash,
      successor.candidateMediaHash,
    ]);
  });

  it('conflicts when the same owner and plan are already bound to another hash', async () => {
    const existing = binding();
    const changed = binding({ shopId: 'shop-2' });
    const { store } = fixture({ transactionResults: [[], [storedRow(existing)]] });

    await expect(store.bind(changed)).resolves.toEqual({ kind: 'conflict' });
  });

  it('gets only the exact owner and plan identity', async () => {
    const record = binding();
    const { store, directQuery } = fixture({ directResults: [[storedRow(record)]] });

    await expect(store.get({
      ownerUserId: record.ownerUserId,
      planId: record.planId,
    })).resolves.toEqual(record);

    const [sql, ...values] = directQuery.mock.calls[0]!;
    expect(sql).toMatch(/WHERE "owner_user_id" = \$1/u);
    expect(sql).toMatch(/AND "plan_id" = \$2/u);
    expect(values).toEqual([record.ownerUserId, record.planId]);
  });

  it('finds by every exact listing, device, snapshot, SKU, and media binding', async () => {
    const record = binding();
    const {
      planId: _planId,
      authorityHash: _authorityHash,
      bindingHash: _bindingHash,
      ...input
    } = record;
    const { store, directQuery } = fixture({ directResults: [[storedRow(record)]] });

    await expect(store.find(input)).resolves.toEqual(record);

    const [sql, ...values] = directQuery.mock.calls[0]!;
    expect(sql).toMatch(/"owner_user_id" = \$1/u);
    expect(sql).toMatch(/"device_session_id" = \$2/u);
    expect(sql).toMatch(/"shop_id" = \$3/u);
    expect(sql).toMatch(/"listing_workflow_id" = \$4/u);
    expect(sql).toMatch(/"source_capture_snapshot_id" = \$5/u);
    expect(sql).toMatch(/"supply_goods_id" = \$6/u);
    expect(sql).toMatch(/"draft_revision" = \$7/u);
    expect(sql).toMatch(/"draft_version" = \$8/u);
    expect(sql).toMatch(/"selected_sku_hash" = \$9/u);
    expect(sql).toMatch(/"candidate_media_hash" = \$10/u);
    expect(values).toEqual([
      input.ownerUserId,
      input.deviceSessionId,
      input.shopId,
      input.listingWorkflowId,
      input.snapshotId,
      input.supplyGoodsId,
      input.draftRevision,
      input.draftVersion,
      input.selectedSkuHash,
      input.candidateMediaHash,
    ]);
  });

  it('returns null when an exact get or find has no binding', async () => {
    const record = binding();
    const {
      planId: _planId,
      authorityHash: _authorityHash,
      bindingHash: _bindingHash,
      ...input
    } = record;
    const { store } = fixture({ directResults: [[], []] });

    await expect(store.get({
      ownerUserId: record.ownerUserId,
      planId: record.planId,
    })).resolves.toBeNull();
    await expect(store.find(input)).resolves.toBeNull();
  });

  it('fails closed when get returns a valid row for another owner', async () => {
    const other = binding({ ownerUserId: 'owner-2' });
    const { store } = fixture({ directResults: [[storedRow(other)]] });

    await expect(store.get({
      ownerUserId: 'owner-1',
      planId: 'plan-1',
    })).rejects.toMatchObject({
      code: 'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_ROW',
    });
  });

  it('fails closed when find returns a valid row for another exact context', async () => {
    const record = binding();
    const {
      planId: _planId,
      authorityHash: _authorityHash,
      bindingHash: _bindingHash,
      ...input
    } = record;
    const other = binding({ deviceSessionId: 'device-session-2' });
    const { store } = fixture({ directResults: [[storedRow(other)]] });

    await expect(store.find(input)).rejects.toMatchObject({
      code: 'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_ROW',
    });
  });

  it.each([
    ['id', ''],
    ['planId', ''],
    ['ownerUserId', ' owner-1'],
    ['deviceSessionId', 'https://provider.example/device'],
    ['snapshotId', 'snapshot\u0000hidden'],
    ['supplyGoodsId', ''],
    ['shopId', 'shop-1?token=hidden'],
    ['listingWorkflowId', 'listing-workflow-1#fragment'],
    ['selectedSkuHash', 'a'.repeat(63)],
    ['candidateMediaHash', 'A'.repeat(64)],
    ['authorityHash', 'not-a-hash'],
    ['bindingHash', 'not-a-hash'],
  ])('rejects a malformed returned %s', async (field, value) => {
    const malformed = storedRow(binding(), { [field]: value });
    const { store } = fixture({ directResults: [[malformed]] });

    await expect(store.get({
      ownerUserId: 'owner-1',
      planId: 'plan-1',
    })).rejects.toBeInstanceOf(ExtensionHostedAiImagePlanBindingStoreError);
  });

  it('rejects a row whose valid-looking binding hash does not match its fields', async () => {
    const malformed = storedRow(binding(), { bindingHash: 'f'.repeat(64) });
    const { store } = fixture({ directResults: [[malformed]] });

    await expect(store.get({
      ownerUserId: 'owner-1',
      planId: 'plan-1',
    })).rejects.toMatchObject({
      code: 'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_ROW',
    });
  });

  it('rejects a row whose valid-looking authority hash does not match its frozen draft', async () => {
    const malformed = storedRow(binding(), { authorityHash: 'f'.repeat(64) });
    const { store } = fixture({ directResults: [[malformed]] });

    await expect(store.get({
      ownerUserId: 'owner-1',
      planId: 'plan-1',
    })).rejects.toMatchObject({
      code: 'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_ROW',
    });
  });

  it('rejects a malformed input before issuing SQL', async () => {
    const record = { ...binding(), bindingHash: 'f'.repeat(64) };
    const { store, client } = fixture();

    await expect(store.bind(record)).rejects.toMatchObject({
      code: 'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_INPUT',
    });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('retries a serializable transaction conflict without weakening replay checks', async () => {
    const record = binding();
    const retry = Object.assign(new Error('could not serialize access'), { code: 'P2034' });
    const { store, client } = fixture({
      transactionFailures: [retry],
      transactionResults: [[storedRow(record)]],
    });

    await expect(store.bind(record)).resolves.toEqual({ kind: 'bound', record });
    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });
});
