import { describe, expect, it } from 'vitest';
import { createPrismaOzonAttributeDictionaryCacheStore } from '../services/ozon-attribute-dictionary-cache.js';

describe('Prisma Ozon attribute dictionary cache store', () => {
  it('reads only the exact catalog revision and maps completeness metadata', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const store = createPrismaOzonAttributeDictionaryCacheStore({
      async $queryRaw(strings, ...values) {
        calls.push({ sql: strings.join('?'), values });
        return [{
          values: [{ id: 1, value: 'белый' }],
          valuesHash: 'cf2071b6f61c08c66d82c758c28281a57442e6edf7b3b55f830dcf3c379b26a9',
          fetchedAt: new Date('2026-07-15T00:00:00.000Z'),
          expiresAt: new Date('2026-07-16T00:00:00.000Z'),
          source: 'ozon_api',
          catalogRevision: 'b'.repeat(64),
          complete: true,
          pageCount: 3,
          finalCursor: 900719,
        }] as any;
      },
      async $executeRaw() { return 0; },
    });

    const result = await store.find({
      description_category_id: 20,
      type_id: 100,
      attribute_id: 85,
      language: 'DEFAULT',
      catalogRevision: 'b'.repeat(64),
    });

    expect(result).toMatchObject({
      catalogRevision: 'b'.repeat(64),
      complete: true,
      pageCount: 3,
      finalCursor: 900719,
    });
    expect(calls[0]?.sql).toContain('"catalog_revision" =');
    expect(calls[0]?.values).toContain('b'.repeat(64));
  });

  it('maps PostgreSQL bigint cursors without losing integer precision', async () => {
    const store = createPrismaOzonAttributeDictionaryCacheStore({
      async $queryRaw() {
        return [{
          values: [{ id: 1, value: 'белый' }],
          valuesHash: 'cf2071b6f61c08c66d82c758c28281a57442e6edf7b3b55f830dcf3c379b26a9',
          fetchedAt: new Date('2026-07-15T00:00:00.000Z'),
          expiresAt: new Date('2026-07-16T00:00:00.000Z'),
          source: 'ozon_api',
          catalogRevision: 'b'.repeat(64),
          complete: true,
          pageCount: 1,
          finalCursor: 900719n,
        }] as any;
      },
      async $executeRaw() { return 0; },
    });

    await expect(store.find({
      description_category_id: 20,
      type_id: 100,
      attribute_id: 85,
      language: 'DEFAULT',
      catalogRevision: 'b'.repeat(64),
    })).resolves.toMatchObject({ finalCursor: 900719, complete: true });
  });

  it('rejects an unsafe PostgreSQL bigint cursor instead of rounding it', async () => {
    const store = createPrismaOzonAttributeDictionaryCacheStore({
      async $queryRaw() {
        return [{
          values: [],
          valuesHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
          fetchedAt: new Date('2026-07-15T00:00:00.000Z'),
          expiresAt: new Date('2026-07-16T00:00:00.000Z'),
          source: 'ozon_api',
          catalogRevision: 'b'.repeat(64),
          complete: true,
          pageCount: 1,
          finalCursor: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        }] as any;
      },
      async $executeRaw() { return 0; },
    });

    await expect(store.find({
      description_category_id: 20,
      type_id: 100,
      attribute_id: 85,
      language: 'DEFAULT',
      catalogRevision: 'b'.repeat(64),
    })).rejects.toThrow('safe integer');
  });

  it('marks a persisted record incomplete when its values hash does not match the normalized rows', async () => {
    const store = createPrismaOzonAttributeDictionaryCacheStore({
      async $queryRaw() {
        return [{
          values: [{ id: 1, value: 'белый' }],
          valuesHash: 'f'.repeat(64),
          fetchedAt: new Date('2026-07-15T00:00:00.000Z'),
          expiresAt: new Date('2026-07-16T00:00:00.000Z'),
          source: 'ozon_api',
          catalogRevision: 'b'.repeat(64),
          complete: true,
          pageCount: 1,
          finalCursor: 1n,
        }] as any;
      },
      async $executeRaw() { return 0; },
    });

    await expect(store.find({
      description_category_id: 20,
      type_id: 100,
      attribute_id: 85,
      language: 'DEFAULT',
      catalogRevision: 'b'.repeat(64),
    })).resolves.toMatchObject({ complete: false });
  });

  it('upserts revision-bound completeness and cursor fields with the five-column conflict key', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const store = createPrismaOzonAttributeDictionaryCacheStore({
      $queryRaw: (async () => []) as any,
      async $executeRaw(strings, ...values) {
        calls.push({ sql: strings.join('?'), values });
        return 1;
      },
    });
    const revision = 'c'.repeat(64);

    await store.upsert({
      description_category_id: 20,
      type_id: 100,
      attribute_id: 85,
      language: 'DEFAULT',
      catalogRevision: revision,
    }, {
      values: [{ id: 1, value: 'белый' }],
      valuesHash: 'cf2071b6f61c08c66d82c758c28281a57442e6edf7b3b55f830dcf3c379b26a9',
      fetchedAt: new Date('2026-07-15T00:00:00.000Z'),
      expiresAt: new Date('2026-07-16T00:00:00.000Z'),
      source: 'ozon_api',
      catalogRevision: revision,
      complete: true,
      pageCount: 2,
      finalCursor: 1,
    });

    expect(calls[0]?.sql).toContain('"catalog_revision"');
    expect(calls[0]?.sql).toContain('"complete"');
    expect(calls[0]?.sql).toContain('"page_count"');
    expect(calls[0]?.sql).toContain('"final_cursor"');
    expect(calls[0]?.sql.replace(/\s+/g, ' ')).toContain(
      'ON CONFLICT ("description_category_id", "type_id", "attribute_id", "language", "catalog_revision")',
    );
    expect(calls[0]?.values).toContain(1n);
  });
});
