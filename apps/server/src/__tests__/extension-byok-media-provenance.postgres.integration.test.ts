import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function assertIsolatedSchema(urlText: string): string {
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
  return schema;
}

describePostgres('extension BYOK media provenance PostgreSQL hardening', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    assertIsolatedSchema(databaseUrl);
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('executes the database identifier guard without storing URL or credential-shaped labels', async () => {
    const rows = await client.$queryRawUnsafe<Array<{
      safePlain: boolean;
      urlWithQuery: boolean;
      dataUrl: boolean;
      authorization: boolean;
      fragment: boolean;
      rawOpenAiKey: boolean;
    }>>(`
      SELECT
        "extension_byok_identifier_safe"('gpt-image-1') AS "safePlain",
        "extension_byok_identifier_safe"('https://relay.example/v1?api_key=secret') AS "urlWithQuery",
        "extension_byok_identifier_safe"('data:image/png;base64,secret') AS "dataUrl",
        "extension_byok_identifier_safe"('Authorization: Bearer secret') AS "authorization",
        "extension_byok_identifier_safe"('sku-1#secret') AS "fragment",
        "extension_byok_identifier_safe"('sk-proj-secret') AS "rawOpenAiKey"
    `);
    expect(rows[0]).toEqual({
      safePlain: true,
      urlWithQuery: false,
      dataUrl: false,
      authorization: false,
      fragment: false,
      rawOpenAiKey: false,
    });
  });

  it('installs the media asset trigger and binds it to BYOK provenance references', async () => {
    const rows = await client.$queryRawUnsafe<Array<{ definition: string }>>(`
      SELECT pg_get_functiondef('protect_referenced_media_asset_identity()'::regprocedure)
        AS definition
    `);
    expect(rows[0]?.definition).toMatch(/extension_byok_media_provenance/u);

    const triggers = await client.$queryRawUnsafe<Array<{ definition: string }>>(`
      SELECT pg_get_triggerdef(trigger_row.oid) AS definition
      FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid = 'media_assets'::regclass
        AND trigger_row.tgname = 'media_assets_referenced_identity_immutable'
        AND NOT trigger_row.tgisinternal
    `);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.definition).toMatch(/protect_referenced_media_asset_identity/u);
  });

  it('keeps publish identity validation in the database trigger', async () => {
    const rows = await client.$queryRawUnsafe<Array<{ definition: string }>>(`
      SELECT pg_get_functiondef(
        'validate_extension_byok_media_provenance_authority()'::regprocedure
      ) AS definition
    `);
    expect(rows[0]?.definition).toMatch(/extension_command_receipts/u);
    expect(rows[0]?.definition).toMatch(/extension_command_grants/u);
    expect(rows[0]?.definition).toMatch(/command_grant.*idempotency_key.*intent.*idempotency_key/isu);
    expect(rows[0]?.definition).toMatch(/actor_user_id.*command_session.*actor_user_id/isu);
    expect(rows[0]?.definition).toMatch(/command_session.*id.*NEW.*device_session_id/isu);
  });
});
