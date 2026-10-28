import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const baseDatabaseUrl = process.env.DATABASE_URL || '';
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');

const schema = `yandex_test_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
if (!/^yandex_test_[a-z0-9_]+$/u.test(schema)) {
  throw new Error('Unsafe Yandex product test schema name');
}

if (!['127.0.0.1','localhost','[::1]'].includes(new URL(baseDatabaseUrl).hostname)) throw Error('Only local PostgreSQL is allowed');
const testUrl = new URL(baseDatabaseUrl);
testUrl.searchParams.set('schema', schema);
const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });

function run(args, extraEnv = {}) {
  const entry = args[1] === 'prisma' ? 'node_modules/prisma/build/index.js' : 'node_modules/vitest/vitest.mjs';
  const result = spawnSync(process.execPath, [entry, ...args.slice(2)], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  console.log(`[yandex-postgres] schema=${schema}`);
  run(['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: testUrl.toString() });
  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/yandex-product-operations.postgres.integration.test.ts',
  ], {
    DATABASE_URL: testUrl.toString(),
    RUN_YANDEX_POSTGRES_TESTS: '1',
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
        `[yandex-postgres] migration failure ${failure.migration_name}:\n${failure.logs || '(no logs)'}`,
      );
    }
  } catch (diagnosticError) {
    console.error(
      `[yandex-postgres] could not read migration diagnostics: ${diagnosticError.message}`,
    );
  }
  throw error;
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
}
