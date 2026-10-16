// Explicit local-only native integration check; not part of every quick test.
// node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test scripts/qa04-suite-current-runtime.postgres-check.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCurrentSuiteRuntime } from './qa04-suite-current-runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../apps/server/node_modules/@prisma/client');
const { parse } = require('../apps/server/node_modules/dotenv');

test('native current-runtime reads selected live config under PostgreSQL read-only enforcement and changes hash after credential rotation', async t => {
  const local = parse(readFileSync(path.join(ROOT, '.env'))), base = new URL(local.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'this test may only connect to a local database');
  base.hostname = '127.0.0.1';
  const schema = 'qa04_current_runtime_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^qa04_current_runtime_[a-f0-9]{32}$/u);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-suite-current-native-'));
  const repositoryRoot = path.join(temporary, 'source'), links = [];
  const admin = new PrismaClient({ datasourceUrl: base.toString(), log: [] });
  const git = args => {
    const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true, cwd: ROOT, timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const originalEnvironment = { DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: process.env.NODE_ENV, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
  try {
    git(['clone', '--shared', '--quiet', '--no-checkout', ROOT, repositoryRoot]);
    git(['-C', repositoryRoot, 'checkout', '--detach', '--quiet', 'HEAD']);
    const expectedCommit = git(['-C', repositoryRoot, 'rev-parse', 'HEAD']);
    for (const relative of ['node_modules', 'apps/server/node_modules']) {
      const target = path.join(repositoryRoot, relative); symlinkSync(path.join(ROOT, relative), target, 'junction'); links.push(target);
    }
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await admin.$executeRawUnsafe(`CREATE TABLE "${schema}".system_configs (id text PRIMARY KEY, key text UNIQUE NOT NULL, value text NOT NULL, revision integer NOT NULL, updated_at timestamp NOT NULL)`);
    const rows = { ai_image_suite_provider: 'custom', ai_image_suite_base_url: 'https://ai.big-model-api.top/v1',
      ai_image_suite_api_key: 'sentinel-fixture-not-a-provider-key', ai_image_suite_model: 'gpt-image-2-count',
      ai_image_suite_cost_cents: '10', ai_image_suite_currency: 'CNY' };
    for (const [key, value] of Object.entries(rows)) {
      await admin.$executeRawUnsafe(`INSERT INTO "${schema}".system_configs (id,key,value,revision,updated_at) VALUES ($1,$2,$3,1,NOW())`, key, key, value);
    }
    const isolated = new URL(base); isolated.searchParams.set('schema', schema);
    Object.assign(process.env, { DATABASE_URL: isolated.toString(), ENCRYPTION_KEY: 'synthetic-native-test-encryption-key', NODE_ENV: 'production' });
    const firstPath = path.join(temporary, 'first.json');
    const first = await readCurrentSuiteRuntime({ repositoryRoot, expectedCommit, outputPath: firstPath });
    const bytes = readFileSync(firstPath), receipt = JSON.parse(bytes);
    assert.equal(first.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(receipt.databaseReadOnly, true); assert.equal(receipt.providerRequests, 0);
    assert.equal(receipt.providerConfig.provider, 'custom'); assert.equal(receipt.providerConfig.model, 'gpt-image-2-count');
    assert.equal(receipt.providerConfig.estimatedCostPerImageCents, 10);
    assert.doesNotMatch(bytes.toString(), /sentinel|ENCRYPTION|api_key|recordId|postgresql/u);
    // This write belongs to the isolated test harness, never to the producer.
    await admin.$executeRawUnsafe(`UPDATE "${schema}".system_configs SET revision=2, updated_at=NOW() WHERE key='ai_image_suite_api_key'`);
    const secondPath = path.join(temporary, 'second.json');
    await readCurrentSuiteRuntime({ repositoryRoot, expectedCommit, outputPath: secondPath });
    const second = JSON.parse(readFileSync(secondPath));
    assert.notEqual(second.providerConfig.providerConfigHash, receipt.providerConfig.providerConfigHash);
    assert.equal(second.providerConfig.pricingVersion, receipt.providerConfig.pricingVersion);
    const count = await admin.$queryRawUnsafe(`SELECT count(*)::integer AS total FROM "${schema}".system_configs`);
    assert.equal(count[0].total, 6);
  } finally {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
    for (const [key, value] of Object.entries(originalEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const link of links.reverse()) unlinkSync(link);
    assert.equal(realpathSync(temporary), path.resolve(temporary));
    assert.ok(path.basename(temporary).startsWith('ss-erp-suite-current-native-'));
    rmSync(temporary, { recursive: true, force: true });
  }
});
