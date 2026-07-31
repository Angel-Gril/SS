import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const baseDatabaseUrl = process.env.DATABASE_URL || '';
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');

const schema = `logistics_test_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
if (!/^logistics_test_[a-z0-9_]+$/u.test(schema)) {
  throw new Error('Unsafe QA-04 scope-revocation test schema name');
}

const testUrl = new URL(baseDatabaseUrl);
testUrl.searchParams.set('schema', schema);
const pnpmCli = process.env.npm_execpath || '';
const command = pnpmCli ? process.execPath : 'pnpm';
const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });

function run(args, extraEnv = {}) {
  const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: !pnpmCli && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  console.log(`[qa04-scope-revocation] schema=${schema}`);
  run(['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: testUrl.toString() });
  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/extension-command-grants.postgres.integration.test.ts',
  ], {
    DATABASE_URL: testUrl.toString(),
    LOGISTICS_TEST_DATABASE_URL: testUrl.toString(),
    RUN_LOGISTICS_POSTGRES_TESTS: '1',
  });
} catch (error) {
  try {
    const failures = await admin.$queryRawUnsafe(`
      SELECT migration_name, logs
      FROM "${schema}"."_prisma_migrations"
      WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 3
    `);
    for (const failure of failures) {
      console.error(
        `[qa04-scope-revocation] migration failure ${failure.migration_name}:\n${failure.logs || '(no logs)'}`,
      );
    }
  } catch (diagnosticError) {
    console.error(
      `[qa04-scope-revocation] could not read migration diagnostics: ${diagnosticError.message}`,
    );
  }
  throw error;
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
}
