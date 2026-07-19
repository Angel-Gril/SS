import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const EXECUTION_MIGRATION = '20260720120000_add_ai_media_suite_execution';
const TEST_SCHEMA_PATTERN = /^ai_media_test_[a-z0-9_]+$/u;
const TEMP_ROOT_PREFIX = 'ss-erp-ai-media-upgrade-';
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prismaRoot = join(serverRoot, 'prisma');
const migrationsRoot = join(prismaRoot, 'migrations');
const baseDatabaseUrl = process.env.DATABASE_URL || '';
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');

const schema = `ai_media_test_upgrade_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
if (!TEST_SCHEMA_PATTERN.test(schema)) throw new Error('Unsafe AI media upgrade test schema name');

const testUrl = new URL(baseDatabaseUrl);
testUrl.searchParams.set('schema', schema);
const pnpmCli = process.env.npm_execpath || '';
const command = pnpmCli ? process.execPath : 'pnpm';
const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
const tempRoot = mkdtempSync(join(tmpdir(), TEMP_ROOT_PREFIX));
const tempPrismaRoot = join(tempRoot, 'prisma');
const tempSchemaPath = join(tempPrismaRoot, 'schema.prisma');
let fixtureClient;

function assertSafeTempRoot(target) {
  const resolvedTemp = resolve(tmpdir());
  const resolvedTarget = resolve(target);
  if (!resolvedTarget.startsWith(`${resolvedTemp}${sep}`)
    || !basename(resolvedTarget).startsWith(TEMP_ROOT_PREFIX)) {
    throw new Error(`Refusing to clean unsafe temporary path: ${resolvedTarget}`);
  }
}

function run(args, extraEnv = {}) {
  const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: serverRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: !pnpmCli && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function prepareHistoricalMigrations() {
  const names = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.at(-1) !== EXECUTION_MIGRATION || names.filter((name) => name === EXECUTION_MIGRATION).length !== 1) {
    throw new Error(`${EXECUTION_MIGRATION} must be the single latest migration`);
  }

  mkdirSync(join(tempPrismaRoot, 'migrations'), { recursive: true });
  copyFileSync(join(prismaRoot, 'schema.prisma'), tempSchemaPath);
  copyFileSync(
    join(migrationsRoot, 'migration_lock.toml'),
    join(tempPrismaRoot, 'migrations', 'migration_lock.toml'),
  );
  for (const name of names.slice(0, -1)) {
    cpSync(
      join(migrationsRoot, name),
      join(tempPrismaRoot, 'migrations', name),
      { recursive: true, errorOnExist: true },
    );
  }
  return names.length - 1;
}

async function addCurrentClientCompatibilityColumns(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_media_suite_slots"
      ADD COLUMN "execution_claim_token" CHAR(64),
      ADD COLUMN "execution_lease_expires_at" TIMESTAMP(3)
  `);
}

async function loadAndValidateMaterializedFixture(client) {
  const suites = await client.$queryRawUnsafe(`
    SELECT "id", "owner_user_id", "actor_user_id"
    FROM "ai_media_suites"
    WHERE "revision" = 4 AND "status" = 'PLANNED'
    ORDER BY "id"
  `);
  if (!Array.isArray(suites) || suites.length !== 1) {
    throw new Error(`Expected exactly one revision-4 materialized suite, found ${suites?.length ?? 0}`);
  }
  const fixture = suites[0];
  await client.$queryRawUnsafe(
    'SELECT assert_ai_media_suite_materialized_graph($1::text, $2::text)::text AS "result"',
    fixture.id,
    fixture.owner_user_id,
  );
  await client.$queryRawUnsafe(
    'SELECT assert_ai_media_suite_materialized_authority($1::text, $2::text)::text AS "result"',
    fixture.id,
    fixture.owner_user_id,
  );
  const counts = await client.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM "ai_media_suite_slots" WHERE "suite_id" = $1) AS "slots",
      (SELECT count(*)::int FROM "ai_media_workflows" workflow
        JOIN "ai_media_suite_slots" slot ON slot."child_workflow_id" = workflow."id"
        WHERE slot."suite_id" = $1) AS "workflows",
      (SELECT count(*)::int FROM "ai_image_jobs" job
        JOIN "ai_media_suite_slots" slot ON slot."child_workflow_id" = job."workflow_id"
        WHERE slot."suite_id" = $1) AS "jobs",
      (SELECT count(*)::int FROM "ai_cost_reservations" reservation
        JOIN "ai_media_suite_slots" slot ON slot."child_workflow_id" = reservation."workflow_id"
        WHERE slot."suite_id" = $1) AS "reservations"
  `, fixture.id);
  const graphCounts = counts[0];
  if (!graphCounts
    || Number(graphCounts.slots) < 1
    || Number(graphCounts.slots) !== Number(graphCounts.workflows)
    || Number(graphCounts.slots) !== Number(graphCounts.jobs)
    || Number(graphCounts.slots) !== Number(graphCounts.reservations)) {
    throw new Error('Revision-4 populated fixture child graph is incomplete');
  }
  return {
    suiteId: String(fixture.id),
    ownerUserId: String(fixture.owner_user_id),
    actorUserId: String(fixture.actor_user_id),
  };
}

async function restoreExactHistoricalSchema(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_media_suite_slots"
      DROP COLUMN "execution_claim_token",
      DROP COLUMN "execution_lease_expires_at"
  `);
  const rows = await client.$queryRawUnsafe(`
    SELECT count(*)::int AS "count"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ai_media_suite_slots'
      AND column_name IN ('execution_claim_token', 'execution_lease_expires_at')
  `);
  if (Number(rows[0]?.count) !== 0) {
    throw new Error('Temporary Prisma compatibility columns were not removed before migration 95');
  }
}

const selectedFixtureTests = [
  'allows one serializable claim and exact replay under concurrent requests',
  'rejects cross-authority and forged reference bindings without leaving partial rows',
  'commits repeated candidates once with exact concurrency replay and an audited barrier',
  'freezes one complete Prompt set under concurrency without materializing paid work',
  'materializes the frozen suite atomically into child graphs and replays without dispatch',
].join('|');

try {
  const historicalMigrationCount = prepareHistoricalMigrations();
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  console.log(`[ai-media-postgres-upgrade] schema=${schema} historicalMigrations=${historicalMigrationCount}`);

  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await addCurrentClientCompatibilityColumns(fixtureClient);
  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/ai-image-suite.postgres.integration.test.ts',
    '--testNamePattern', selectedFixtureTests,
  ], {
    DATABASE_URL: testUrl.toString(),
    AI_MEDIA_TEST_DATABASE_URL: testUrl.toString(),
    RUN_AI_MEDIA_POSTGRES_TESTS: '1',
  });

  const fixture = await loadAndValidateMaterializedFixture(fixtureClient);
  await restoreExactHistoricalSchema(fixtureClient);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  run(['exec', 'prisma', 'migrate', 'deploy'], {
    DATABASE_URL: testUrl.toString(),
  });
  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/ai-image-suite-populated-upgrade.postgres.integration.test.ts',
  ], {
    DATABASE_URL: testUrl.toString(),
    AI_MEDIA_TEST_DATABASE_URL: testUrl.toString(),
    AI_MEDIA_UPGRADE_SUITE_ID: fixture.suiteId,
    AI_MEDIA_UPGRADE_OWNER_USER_ID: fixture.ownerUserId,
    AI_MEDIA_UPGRADE_ACTOR_USER_ID: fixture.actorUserId,
    RUN_AI_MEDIA_POPULATED_UPGRADE_TESTS: '1',
  });
} finally {
  let schemaCleanupError;
  await fixtureClient?.$disconnect().catch(() => undefined);
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } catch (error) {
    schemaCleanupError = error;
  }
  await admin.$disconnect();
  assertSafeTempRoot(tempRoot);
  rmSync(tempRoot, { recursive: true, force: true });
  if (schemaCleanupError) throw schemaCleanupError;
}

console.log('PASS AI media populated migration upgrade');
