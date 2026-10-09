import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const base = new URL(process.env.DATABASE_URL || '');
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['localhost', '127.0.0.1'].includes(base.hostname)) {
  throw new Error('Source image integration requires local PostgreSQL');
}
const schema = `logistics_test_source_images_${randomUUID().replaceAll('-', '')}`;
const url = new URL(base); url.searchParams.set('schema', schema);
const admin = new PrismaClient({ datasourceUrl: base.toString() });
let created = false;
function run(script, args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${result.stdout || ''}\n${result.stderr || ''}`.replace(/postgres(?:ql)?:\/\/[^\s]+/gu, '[redacted]').slice(-12000));
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
  run('node_modules/prisma/build/index.js', ['migrate', 'deploy'], { DATABASE_URL: url.toString() });
  const output = run('node_modules/vitest/vitest.mjs', ['run', '--no-file-parallelism',
    'src/__tests__/source-capture.postgres.integration.test.ts'], {
    DATABASE_URL: url.toString(), LOGISTICS_TEST_DATABASE_URL: url.toString(), RUN_LOGISTICS_POSTGRES_TESTS: '1',
  });
  if (/skipped/u.test(output) || !/Tests\s+\d+ passed/u.test(output)) throw new Error('Source image PostgreSQL tests did not run');
  console.log(output);
} finally {
  if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.$disconnect();
  console.log(JSON.stringify({ schema, cleanupComplete: created, providerPosts: 0, ozonWrites: 0 }));
}
