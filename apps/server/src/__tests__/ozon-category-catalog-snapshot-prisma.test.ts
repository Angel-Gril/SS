import { describe, expect, it, vi } from 'vitest';
import {
  buildMergedOzonCategoryCatalog,
  createPrismaOzonCategoryCatalogSnapshotStore,
  deriveOzonCategoryCatalogRevision,
  type OzonCategoryCatalogSnapshot,
  type PrismaOzonCategoryCatalogClient,
} from '../services/ozon-category-catalog.js';

const FETCHED_AT = new Date('2026-07-15T00:00:00.000Z');
const EXPIRES_AT = new Date('2026-07-16T00:00:00.000Z');

function entries() {
  return buildMergedOzonCategoryCatalog([{
    description_category_id: 20,
    category_name: 'Женская одежда',
    disabled: false,
    children: [{ type_id: 100, type_name: 'Джинсы', disabled: false, children: [] }],
  }], [{
    description_category_id: 20,
    category_name: '女士服饰',
    disabled: false,
    children: [{ type_id: 100, type_name: '牛仔裤', disabled: false, children: [] }],
  }]);
}

function snapshot(overrides: Partial<OzonCategoryCatalogSnapshot> = {}): OzonCategoryCatalogSnapshot {
  const catalog = entries();
  return {
    schemaVersion: 'ozon-category-catalog-snapshot/v1',
    entries: catalog,
    revision: deriveOzonCategoryCatalogRevision(catalog),
    fetchedAt: FETCHED_AT,
    expiresAt: EXPIRES_AT,
    complete: true,
    defaultTreeComplete: true,
    zhHansTreeComplete: true,
    stale: false,
    authoritative: true,
    ...overrides,
  };
}

describe('Prisma Ozon category catalog snapshot store', () => {
  it('reads the current owned snapshot with revision-bound child rows and derived selectability', async () => {
    const expected = snapshot();
    const entry = expected.entries[0]!;
    const queryCalls: Array<{ sql: string; values: unknown[] }> = [];
    const prisma: PrismaOzonCategoryCatalogClient = {
      async $queryRaw(strings, ...values) {
        queryCalls.push({ sql: strings.join('?'), values });
        return [{
          snapshotId: 'snapshot-1',
          schemaVersion: expected.schemaVersion,
          revision: expected.revision,
          snapshotFetchedAt: expected.fetchedAt,
          snapshotExpiresAt: expected.expiresAt,
          snapshotComplete: true,
          defaultTreeComplete: true,
          zhHansTreeComplete: true,
          entryId: 'entry-1',
          descriptionCategoryId: entry.descriptionCategoryId,
          typeId: entry.typeId,
          categoryPathRu: entry.categoryPathRu,
          categoryPathZh: entry.categoryPathZh,
          categoryLevels: entry.categoryLevels,
          categoryNameRu: entry.categoryNameRu,
          categoryNameZh: entry.categoryNameZh,
          typeNameRu: entry.typeNameRu,
          typeNameZh: entry.typeNameZh,
          displayPathRu: entry.displayPathRu,
          displayPathZh: entry.displayPathZh,
          translationStatus: entry.translationStatus,
          untranslatedTerms: entry.untranslatedTerms,
          keywords: entry.keywords,
          searchText: entry.searchText,
          disabled: false,
          labelProvenance: entry.labelProvenance,
        }] as any;
      },
      async $executeRaw() { return 0; },
    };

    const result = await createPrismaOzonCategoryCatalogSnapshotStore(prisma).find('shop-1');

    expect(result).toMatchObject({
      schemaVersion: 'ozon-category-catalog-snapshot/v1',
      revision: expected.revision,
      complete: true,
      defaultTreeComplete: true,
      zhHansTreeComplete: true,
      stale: false,
      authoritative: true,
      entries: [expect.objectContaining({ typeId: 100, disabled: false, selectable: true })],
    });
    expect(queryCalls[0]?.sql).toContain('FROM "ozon_category_catalog_snapshots"');
    expect(queryCalls[0]?.sql).toContain('"is_current" = TRUE');
    expect(queryCalls[0]?.values).toContain('shop-1');
  });

  it('does not label a corrupt or incomplete current snapshot authoritative', async () => {
    const expected = snapshot();
    const prisma: PrismaOzonCategoryCatalogClient = {
      async $queryRaw() {
        return [{
          snapshotId: 'snapshot-1',
          schemaVersion: expected.schemaVersion,
          revision: expected.revision,
          snapshotFetchedAt: expected.fetchedAt,
          snapshotExpiresAt: expected.expiresAt,
          snapshotComplete: true,
          defaultTreeComplete: true,
          zhHansTreeComplete: true,
          entryId: null,
        }] as any;
      },
      async $executeRaw() { return 0; },
    };

    await expect(createPrismaOzonCategoryCatalogSnapshotStore(prisma).find('shop-1'))
      .resolves.toMatchObject({ entries: [], authoritative: false });
  });

  it('atomically switches the current pointer and appends snapshot plus child rows without deleting history', async () => {
    const executeCalls: Array<{ sql: string; values: unknown[] }> = [];
    const tx: PrismaOzonCategoryCatalogClient = {
      $queryRaw: (async () => []) as PrismaOzonCategoryCatalogClient['$queryRaw'],
      async $executeRaw(strings, ...values) {
        executeCalls.push({ sql: strings.join('?'), values });
        return 1;
      },
    };
    const transaction = vi.fn(async (callback: (client: PrismaOzonCategoryCatalogClient) => Promise<unknown>) => callback(tx)) as unknown as NonNullable<PrismaOzonCategoryCatalogClient['$transaction']>;
    const prisma: PrismaOzonCategoryCatalogClient = {
      ...tx,
      $transaction: transaction,
    };

    await createPrismaOzonCategoryCatalogSnapshotStore(prisma).replace('shop-1', snapshot());

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeCalls).toHaveLength(3);
    expect(executeCalls[0]?.sql).toContain('UPDATE "ozon_category_catalog_snapshots"');
    expect(executeCalls[0]?.sql).toContain('"is_current" = FALSE');
    expect(executeCalls[1]?.sql).toContain('INSERT INTO "ozon_category_catalog_snapshots"');
    expect(executeCalls[2]?.sql).toContain('INSERT INTO "ozon_category_catalog"');
    expect(executeCalls[2]?.sql).toContain('"label_provenance_json"');
    expect(executeCalls.map((call) => call.sql).join('\n')).not.toContain('DELETE FROM');
  });

  it('rejects stale or non-authoritative snapshots before opening a transaction', async () => {
    const transaction = vi.fn();
    const prisma = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      $transaction: transaction,
    } as unknown as PrismaOzonCategoryCatalogClient;

    await expect(createPrismaOzonCategoryCatalogSnapshotStore(prisma).replace('shop-1', snapshot({
      stale: true,
      authoritative: false,
    }))).rejects.toThrow('Only complete authoritative catalog snapshots can be persisted');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a runtime snapshot with an unsupported schema version', async () => {
    const transaction = vi.fn();
    const prisma = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn(),
      $transaction: transaction,
    } as unknown as PrismaOzonCategoryCatalogClient;

    await expect(createPrismaOzonCategoryCatalogSnapshotStore(prisma).replace('shop-1', {
      ...snapshot(),
      schemaVersion: 'ozon-category-catalog-snapshot/v0',
    } as unknown as OzonCategoryCatalogSnapshot)).rejects.toThrow('schema version');
    expect(transaction).not.toHaveBeenCalled();
  });
});
