import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';

describe.skipIf(!enabled)('AI image output ownership PostgreSQL constraint', () => {
  let client: PrismaClient;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const firstOwnerId = `output_fk_owner_a_${suffix}`;
  const secondOwnerId = `output_fk_owner_b_${suffix}`;
  const firstJobId = `output_fk_job_a_${suffix}`;
  const secondJobId = `output_fk_job_b_${suffix}`;
  const acceptedAssetId = `output_fk_asset_ok_${suffix}`;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    const schemaName = new URL(databaseUrl).searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schemaName)) {
      throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
    await client.user.createMany({ data: [
      { id: firstOwnerId, phone: `${firstOwnerId}-phone`, passwordHash: 'integration' },
      { id: secondOwnerId, phone: `${secondOwnerId}-phone`, passwordHash: 'integration' },
    ] });
    await client.aiImageJob.createMany({ data: [
      {
        id: firstJobId,
        ownerUserId: firstOwnerId,
        actorUserId: firstOwnerId,
        provider: 'fake',
        model: 'fake-output-owner-v1',
        prompt: 'first owner output',
        width: 1,
        height: 1,
        idempotencyKey: `${firstJobId}:request`,
      },
      {
        id: secondJobId,
        ownerUserId: secondOwnerId,
        actorUserId: secondOwnerId,
        provider: 'fake',
        model: 'fake-output-owner-v1',
        prompt: 'second owner output',
        width: 1,
        height: 1,
        idempotencyKey: `${secondJobId}:request`,
      },
    ] });
  });

  afterAll(async () => {
    if (!client) return;
    await client.mediaAsset.deleteMany({ where: { id: { startsWith: 'output_fk_asset_' } } });
    await client.aiImageJob.deleteMany({ where: { id: { in: [firstJobId, secondJobId] } } });
    await client.user.deleteMany({ where: { id: { in: [firstOwnerId, secondOwnerId] } } });
    await client.$disconnect();
  });

  it('installs one validated composite FK and retires the ID-only constraint', async () => {
    const constraints = await client.$queryRawUnsafe<Array<{
      conname: string;
      convalidated: boolean;
      definition: string;
    }>>(`
      SELECT
        constraint_row.conname,
        constraint_row.convalidated,
        pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'media_assets'::regclass
        AND constraint_row.conname IN (
          'media_assets_ai_image_job_id_fkey',
          'media_assets_ai_image_job_id_owner_user_id_fkey'
        )
      ORDER BY constraint_row.conname
    `);

    expect(constraints).toHaveLength(1);
    expect(constraints[0]).toMatchObject({
      conname: 'media_assets_ai_image_job_id_owner_user_id_fkey',
      convalidated: true,
    });
    expect(constraints[0]?.definition).toMatch(
      /FOREIGN KEY \(ai_image_job_id, owner_user_id\) REFERENCES ai_image_jobs\(id, owner_user_id\).*ON UPDATE CASCADE.*ON DELETE RESTRICT/u,
    );
  });

  it('accepts a same-owner output and rejects a cross-owner job binding in PostgreSQL', async () => {
    await expect(client.mediaAsset.create({ data: {
      id: acceptedAssetId,
      ownerUserId: firstOwnerId,
      aiImageJobId: firstJobId,
      kind: 'AI_GENERATED',
      url: `https://storage.example/${acceptedAssetId}.png`,
      storageBackend: 'local',
      storageKey: `${acceptedAssetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 1,
      height: 1,
      sha256: 'a'.repeat(64),
    } })).resolves.toMatchObject({
      id: acceptedAssetId,
      ownerUserId: firstOwnerId,
      aiImageJobId: firstJobId,
    });

    await expect(client.mediaAsset.create({ data: {
      id: `output_fk_asset_cross_${suffix}`,
      ownerUserId: secondOwnerId,
      aiImageJobId: firstJobId,
      kind: 'AI_GENERATED',
      url: `https://storage.example/output_fk_asset_cross_${suffix}.png`,
      storageBackend: 'local',
      storageKey: `output_fk_asset_cross_${suffix}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 1,
      height: 1,
      sha256: 'b'.repeat(64),
    } })).rejects.toMatchObject({ code: 'P2003' });

    expect(await client.mediaAsset.count({
      where: { aiImageJobId: firstJobId, ownerUserId: secondOwnerId },
    })).toBe(0);
  });
});
