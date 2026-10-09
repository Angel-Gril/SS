import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const base = new URL(process.env.DATABASE_URL || '');
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('local PostgreSQL only');
const schema = `order_fulfillment_test_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}`;
const url = new URL(base); url.searchParams.set('schema', schema);
const admin = new PrismaClient({ datasourceUrl: base.toString() });
const evidenceDir = mkdtempSync(join(tmpdir(), 'ss-erp-order-fulfillment-pg-'));
const receipt = { contractVersion: 'order-fulfillment-postgres-local/v1', schema, migrationCount: readdirSync(new URL('../prisma/migrations', import.meta.url), { withFileTypes: true }).filter(e => e.isDirectory()).length, testsPassed: 0, providerPosts: 0, ozonWrites: 0, cleanupComplete: false, passed: false };
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const prismaCli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const migrate = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`${migrate.stdout}\n${migrate.stderr}`);
  const vitest = join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
  const output = spawnSync(process.execPath, [vitest, 'run', '--no-file-parallelism', 'src/__tests__/order-stock-ready.postgres.integration.test.ts'], {
    cwd: process.cwd(), env: { ...process.env, ORDER_FULFILLMENT_TEST_DATABASE_URL: url.toString(), RUN_ORDER_FULFILLMENT_POSTGRES_TESTS: '1', ORDER_FULFILLMENT_POSTGRES_TARGET_RUNNER: '1' }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  const text = `${output.stdout || ''}\n${output.stderr || ''}`; writeFileSync(join(evidenceDir, 'test.log'), text.replace(/postgres(?:ql)?:\/\/[^\s]+/gu, '[redacted]'));
  if (output.status !== 0) throw new Error(text.slice(-10000));
  const match = text.match(/Tests\s+(\d+) passed \((\d+)\)/u); if (!match || match[1] !== match[2] || /skipped/u.test(text)) throw new Error('isolated PostgreSQL tests did not fully run');
  receipt.testsPassed = Number(match[1]); receipt.testOutputSha256 = createHash('sha256').update(text).digest('hex'); receipt.passed = true;
} catch (error) { receipt.failure = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gu, '[redacted]') : String(error); process.exitCode = 1; }
finally { try { await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); receipt.cleanupComplete = !(await admin.$queryRaw`SELECT 1 FROM pg_namespace WHERE nspname = ${schema}`).length; } finally { await admin.$disconnect(); writeFileSync(join(evidenceDir, 'summary.safe.json'), `${JSON.stringify(receipt, null, 2)}\n`); console.log(JSON.stringify({ ...receipt, evidenceDir })); } }
