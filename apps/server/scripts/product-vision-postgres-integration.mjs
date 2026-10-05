import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = new URL(process.env.DATABASE_URL || '');
if (!['postgres:', 'postgresql:'].includes(baseUrl.protocol) || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(baseUrl.hostname)) {
  throw new Error('Product vision PostgreSQL runner only accepts a local database');
}
const schema = `product_vision_test_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
if (!/^product_vision_test_[a-z0-9_]+$/u.test(schema)) throw new Error('Unsafe product vision test schema');
const testUrl = new URL(baseUrl); testUrl.searchParams.set('schema', schema);
const admin = new PrismaClient({ datasourceUrl: baseUrl.toString() });
const evidenceDir = mkdtempSync(join(tmpdir(), 'ss-erp-product-vision-pg-'));
const receiptPath = join(evidenceDir, 'summary.safe.json');
const logPath = join(evidenceDir, 'test.safe.log');
const migrations = readdirSync(join(serverRoot, 'prisma', 'migrations'), { withFileTypes: true }).filter(entry => entry.isDirectory()).length;
const includePreparation = process.argv.includes('--preparation');
const receipt = { contractVersion: 'product-vision-postgres-local/v1', localOnly: true, schema, migrationCount: migrations,
  testsPassed: 0, testsSkipped: 0, migrationsApplied: false, cleanupComplete: false, providerPosts: 0, ozonWrites: 0, passed: false };
receipt.sourceSha256 = Object.fromEntries(['src/services/product-vision-workbench.ts', 'src/services/product-vision-operation-store.ts',
  'src/services/source-listing-workflow.ts', 'src/services/source-listing-workflow-prisma.ts', 'src/services/extension-listing-editor.ts',
  'src/services/source-listing-sku-copies.ts', 'src/__tests__/source-listing-sku-copy.postgres.integration.test.ts',
  'src/__tests__/product-vision-workbench.postgres.integration.test.ts', 'scripts/product-vision-postgres-integration.mjs'].map(file => [file,
  createHash('sha256').update(readFileSync(join(serverRoot, file))).digest('hex')]));
if (includePreparation) {
  receipt.preparationIncluded = true;
  for (const file of ['src/services/product-preparation-workbench.ts', 'src/services/product-preparation-operation-store.ts',
    'src/services/product-preparation-report.ts', 'src/__tests__/product-preparation-workbench.postgres.integration.test.ts']) {
    receipt.sourceSha256[file] = createHash('sha256').update(readFileSync(join(serverRoot, file))).digest('hex');
  }
}
let created = false;
function run(args, extraEnv = {}) {
  const cli = args[1] === 'prisma' ? join(serverRoot, 'node_modules', 'prisma', 'build', 'index.js') : join(serverRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const child = spawnSync(process.execPath, [cli, ...args.slice(2)], {
    cwd: serverRoot, env: { ...process.env, ...extraEnv }, encoding: 'utf8', shell: false, maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${child.stdout || ''}\n${child.stderr || ''}`;
  const safeOutput = output.replace(/postgres(?:ql)?:\/\/[^\s]+/gu, '[redacted-local-database-url]');
  writeFileSync(logPath, safeOutput);
  if (child.error || child.status !== 0) {
    console.error(safeOutput.slice(-12000));
    throw new Error(`Local PostgreSQL stage failed: ${args[1] || args[0]}`);
  }
  return output;
}
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); created = true;
  run(['exec', 'prisma', 'migrate', 'deploy'], { DATABASE_URL: testUrl.toString() }); receipt.migrationsApplied = true;
  const migrated = new PrismaClient({ datasourceUrl: testUrl.toString() });
  try {
    const rows = await migrated.$queryRaw`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
    if (rows[0]?.count !== migrations) throw new Error('Actual isolated migration count does not match the source');
    receipt.migrationCount = rows[0].count;
  } finally { await migrated.$disconnect(); }
  const output = run(['exec', 'vitest', 'run', '--no-file-parallelism', 'src/__tests__/product-vision-workbench.postgres.integration.test.ts',
    'src/__tests__/source-listing-sku-copy.postgres.integration.test.ts',
    ...(includePreparation ? ['src/__tests__/product-preparation-workbench.postgres.integration.test.ts'] : [])], {
    DATABASE_URL: testUrl.toString(), PRODUCT_VISION_TEST_DATABASE_URL: testUrl.toString(), RUN_PRODUCT_VISION_POSTGRES_TESTS: '1', PRODUCT_VISION_POSTGRES_TARGET_RUNNER: '1',
  });
  const match = output.match(/Tests\s+(\d+) passed \((\d+)\)/u);
  if (!match || Number(match[1]) < (includePreparation ? 18 : 11) || match[1] !== match[2] || /\d+ skipped/u.test(output)) throw new Error('Actual product vision, preparation and SKU copy PostgreSQL tests did not all run');
  receipt.testsPassed = Number(match[1]); receipt.passed = true;
  receipt.testOutputSha256 = createHash('sha256').update(output).digest('hex');
} catch (error) {
  process.exitCode = 1;
  receipt.failure = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gu, '[redacted]') : 'Local PostgreSQL stage failed';
} finally {
  try {
    if (created) {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      const rows = await admin.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = ${schema}) AS present`;
      receipt.cleanupComplete = rows[0]?.present === false;
      if (!receipt.cleanupComplete) {
        process.exitCode = 1; receipt.passed = false; receipt.failure = 'Isolated schema cleanup could not be confirmed';
      }
    }
  } catch {
    process.exitCode = 1; receipt.passed = false; receipt.failure = 'Isolated schema cleanup failed';
  } finally { await admin.$disconnect(); }
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ ...receipt, receiptPath }));
}
