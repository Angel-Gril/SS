import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const base = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname)) throw new Error('Carriage runner requires a local PostgreSQL instance');
const schema = `ozon_carriage_test_${randomUUID().replaceAll('-', '')}`;
const target = new URL(base); target.searchParams.set('schema', schema);
const admin = new PrismaClient({ datasourceUrl: base.toString() });
const cli = process.env.npm_execpath;
function run(args) {
  const result = spawnSync(cli ? process.execPath : 'pnpm', cli ? [cli, ...args] : args, {
    cwd: process.cwd(), shell: !cli && process.platform === 'win32', stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: target.toString(), OZON_CARRIAGE_TEST_DATABASE_URL: target.toString(), RUN_OZON_CARRIAGE_POSTGRES_TESTS: '1', OZON_CARRIAGE_TARGET_RUNNER: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Isolated carriage verification failed: ${args.join(' ')}`);
}
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  run(['exec', 'prisma', 'migrate', 'deploy']);
  run(['exec', 'vitest', 'run', 'src/__tests__/ozon-carriage.postgres.integration.test.ts']);
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
}
