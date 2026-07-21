import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const baseDatabaseUrl = process.env.DATABASE_URL || '';
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');

const schema = `ai_media_test_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) throw new Error('Unsafe AI media test schema name');

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
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  console.log(`[ai-media-postgres] schema=${schema}`);
  run(['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: testUrl.toString() });
  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/ai-cost-ledger.postgres.integration.test.ts',
    'src/__tests__/ai-provider-reconciliation.postgres.integration.test.ts',
    'src/__tests__/ai-media-workflow.postgres.integration.test.ts',
    'src/__tests__/ai-image-edit.postgres.integration.test.ts',
    'src/__tests__/ai-image-edit-listing-draft.postgres.integration.test.ts',
    'src/__tests__/ai-media-planning.postgres.integration.test.ts',
    'src/__tests__/ai-image-suite.postgres.integration.test.ts',
    'src/__tests__/ai-image-suite-execution.postgres.integration.test.ts',
    'src/__tests__/ai-image-output-ownership.postgres.integration.test.ts',
    'src/__tests__/ai-media-application-mutations.postgres.integration.test.ts',
    'src/__tests__/ai-media-listing-draft-application.postgres.integration.test.ts',
  ], {
    DATABASE_URL: testUrl.toString(),
    AI_MEDIA_TEST_DATABASE_URL: testUrl.toString(),
    RUN_AI_MEDIA_POSTGRES_TESTS: '1',
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
      console.error(`[ai-media-postgres] migration failure ${failure.migration_name}:\n${failure.logs || '(no logs)'}`);
    }
  } catch (diagnosticError) {
    console.error(`[ai-media-postgres] could not read migration diagnostics: ${diagnosticError.message}`);
  }
  throw error;
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
}
