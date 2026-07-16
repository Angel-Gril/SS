import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260715100000_add_ozon_catalog_snapshot_and_attribute_caches/migration.sql',
  import.meta.url,
), 'utf8');

describe('Ozon catalog and attribute cache persistence contract', () => {
  it('models historical catalog snapshots and revision-bound child entries', () => {
    expect(schema).toMatch(/model OzonCategoryCatalogSnapshot \{[\s\S]*shopId\s+String[\s\S]*schemaVersion\s+String[\s\S]*revision\s+String[\s\S]*fetchedAt\s+DateTime[\s\S]*expiresAt\s+DateTime[\s\S]*complete\s+Boolean[\s\S]*defaultTreeComplete\s+Boolean[\s\S]*zhHansTreeComplete\s+Boolean[\s\S]*isCurrent\s+Boolean/);
    expect(schema).toMatch(/model OzonCategoryCatalog \{[\s\S]*snapshotId\s+String[\s\S]*catalogRevision\s+String[\s\S]*disabled\s+Boolean[\s\S]*labelProvenance\s+Json/);
    expect(migration).toContain('CREATE UNIQUE INDEX "ozon_category_catalog_snapshots_one_current_per_shop"');
    expect(migration).toContain('WHERE "is_current" = TRUE');
    expect(migration).not.toContain('DELETE FROM "ozon_category_catalog"');
    expect(schema).toContain('name: "ozon_category_catalog_snapshot_owner_revision_key", map: "ozon_category_catalog_snapshot_owner_revision_key"');
    expect(schema).toContain('name: "ozon_category_catalog_snapshot_entry_key", map: "ozon_category_catalog_snapshot_entry_key"');
    expect(schema).toContain('map: "ozon_category_catalog_snapshot_owner_revision_fkey"');
    expect(migration).toContain('FOREIGN KEY ("snapshot_id", "shop_id", "catalog_revision")');
  });

  it('version-binds dictionary completeness and conservatively backfills legacy rows', () => {
    expect(schema).toMatch(/model OzonAttributeDictionaryCache \{[\s\S]*catalogRevision\s+String[\s\S]*complete\s+Boolean[\s\S]*pageCount\s+Int[\s\S]*finalCursor\s+BigInt\?/);
    expect(schema).toContain('@@unique([descriptionCategoryId, typeId, attributeId, language, catalogRevision], name: "ozon_attribute_dictionary_cache_key", map: "ozon_attribute_dictionary_cache_key")');
    expect(migration).toContain('"catalog_revision" TEXT NOT NULL DEFAULT');
    expect(migration).toContain('"complete" BOOLEAN NOT NULL DEFAULT FALSE');
    expect(migration).toContain('UPDATE "ozon_attribute_dictionary_cache"');
    expect(schema).toContain('name: "ozon_attribute_dictionary_cache_key", map: "ozon_attribute_dictionary_cache_key"');
    expect(migration).toContain('jsonb_typeof("values_json") = \'array\'');
    expect(migration).toContain('"values_hash" ~ \'^[a-f0-9]{64}$\'');
    expect(migration).toContain('"expires_at" >= "fetched_at"');
  });

  it('declares the exact definition-cache delegate and compound selector contract', () => {
    expect(schema).toMatch(/model OzonAttributeDefinitionCache \{[\s\S]*shopId\s+String[\s\S]*descriptionCategoryId\s+Int[\s\S]*typeId\s+Int[\s\S]*language\s+String[\s\S]*catalogRevision\s+String[\s\S]*definitions\s+Json[\s\S]*definitionsHash\s+String[\s\S]*complete\s+Boolean[\s\S]*fetchedAt\s+DateTime[\s\S]*expiresAt\s+DateTime[\s\S]*source\s+String/);
    expect(schema).toContain('@@unique([shopId, descriptionCategoryId, typeId, language, catalogRevision], name: "ozon_attribute_definition_cache_key", map: "ozon_attribute_definition_cache_key")');
    expect(schema).toContain('name: "ozon_attribute_definition_cache_key", map: "ozon_attribute_definition_cache_key"');
    expect(schema).toContain('map: "ozon_attribute_definition_cache_shop_fkey"');
    expect(migration).toContain('CREATE TABLE "ozon_attribute_definition_cache"');
  });
});
