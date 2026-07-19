import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260720140000_enforce_ai_media_output_job_ownership/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

describe('AI image output ownership migration', () => {
  it('binds an output asset to the exact job and owner tuple in Prisma', () => {
    expect(schema).toMatch(
      /aiImageJob\s+AiImageJob\?\s+@relation\(fields: \[aiImageJobId, ownerUserId\], references: \[id, ownerUserId\], onDelete: Restrict\)/u,
    );
    expect(schema).toMatch(
      /@@unique\(\[id, ownerUserId\], name: "ai_image_job_id_owner", map: "ai_image_job_id_owner"\)/u,
    );
    expect(schema).toMatch(/@@index\(\[aiImageJobId\]\)/u);
  });

  it('validates the composite FK before removing the legacy ID-only FK', () => {
    expect(migration).toMatch(
      /FOREIGN KEY \("ai_image_job_id", "owner_user_id"\)[\s\S]*REFERENCES "ai_image_jobs"\("id", "owner_user_id"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE[\s\S]*NOT VALID/u,
    );
    expect(migration).toMatch(
      /VALIDATE CONSTRAINT "media_assets_ai_image_job_id_owner_user_id_fkey"/u,
    );
    expect(migration).toMatch(
      /DROP CONSTRAINT "media_assets_ai_image_job_id_fkey"/u,
    );
    expect(migration.indexOf('ADD CONSTRAINT "media_assets_ai_image_job_id_owner_user_id_fkey"'))
      .toBeLessThan(migration.indexOf('VALIDATE CONSTRAINT "media_assets_ai_image_job_id_owner_user_id_fkey"'));
    expect(migration.indexOf('VALIDATE CONSTRAINT "media_assets_ai_image_job_id_owner_user_id_fkey"'))
      .toBeLessThan(migration.indexOf('DROP CONSTRAINT "media_assets_ai_image_job_id_fkey"'));
    expect(migration).not.toMatch(/DROP INDEX|DROP CONSTRAINT "ai_image_job_id_owner"/u);
  });
});
