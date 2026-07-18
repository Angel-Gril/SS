import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('AI image translation persistence migration', () => {
  it('adds the operation and freezes operation-specific options additively', async () => {
    const schema = await readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    const migration = await readFile(new URL(
      '../../prisma/migrations/20260719090000_add_ai_image_translation_operation/migration.sql',
      import.meta.url,
    ), 'utf8');
    expect(schema).toMatch(/enum AiMediaOperation[\s\S]*IMAGE_TRANSLATE/u);
    expect(schema).toMatch(/operationConfig\s+Json\?\s+@map\("operation_config_json"\)/u);
    expect(migration).toMatch(/ALTER TYPE "AiMediaOperation" ADD VALUE IF NOT EXISTS 'IMAGE_TRANSLATE'/u);
    expect(migration).toMatch(/operation_config_json/u);
    expect(migration).toMatch(/ai_image_jobs_operation_config_immutable/u);
    expect(migration).not.toMatch(/DROP TYPE "AiMediaOperation"/u);
    const deadlineMigration = await readFile(new URL(
      '../../prisma/migrations/20260719093000_backfill_ai_image_translation_dispatch_deadlines/migration.sql',
      import.meta.url,
    ), 'utf8');
    expect(deadlineMigration).toMatch(/provider_dispatched_at/u);
    expect(deadlineMigration).toMatch(/provider_job_id/u);
  });
});
