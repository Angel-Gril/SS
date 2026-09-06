import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scriptUrl = new URL('./sandbox/ozon-source-listing-contract.mjs', import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const source = readFileSync(scriptUrl, 'utf8');
const runbook = readFileSync(
  new URL('../docs/runbooks/ozon-source-listing-sandbox.md', import.meta.url),
  'utf8',
);

function cleanEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra };
  for (const key of [
    'OZON_SANDBOX_CONFIRM',
    'OZON_SANDBOX_READONLY_CONFIRM',
    'OZON_SANDBOX_TEST_SHOP',
    'OZON_SANDBOX_TEST_CLIENT_ID',
    'OZON_SANDBOX_TEST_API_KEY',
  ]) {
    if (!(key in extra)) delete environment[key];
  }
  return environment;
}

function run(args, environment = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: cleanEnvironment(environment),
    timeout: 10_000,
  });
}

test('sandbox probe refuses execution by default before payload or network access', () => {
  const result = run([]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /explicit --execute flag/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /fetch failed|api-seller\.ozon\.ru/u);
});

test('sandbox probe requires the independent confirmation and test-shop gates', () => {
  const missingConfirmation = run(['--execute']);
  assert.notEqual(missingConfirmation.status, 0);
  assert.match(missingConfirmation.stderr, /exact OZON_SANDBOX_CONFIRM phrase/u);

  const missingTestShop = run(['--execute'], {
    OZON_SANDBOX_CONFIRM: 'CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING',
  });
  assert.notEqual(missingTestShop.status, 0);
  assert.match(missingTestShop.stderr, /OZON_SANDBOX_TEST_SHOP=true/u);

  const missingDedicatedCredentials = run(['--execute'], {
    OZON_SANDBOX_CONFIRM: 'CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING',
    OZON_SANDBOX_TEST_SHOP: 'true',
  });
  assert.notEqual(missingDedicatedCredentials.status, 0);
  assert.match(missingDedicatedCredentials.stderr, /Dedicated OZON_SANDBOX_TEST_CLIENT_ID/u);
});

test('read-only preflight checks Seller Info and the reserved offer without import or archive', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-erp-ozon-readonly-preflight-'));
  const auditPath = join(directory, 'audit.json');
  const callLogPath = join(directory, 'calls.log');
  const preloadPath = join(directory, 'mock-fetch.mjs');
  const offerId = 'ss-erp-sbx-readonly-1';
  try {
    writeFileSync(preloadPath, `
import { appendFileSync } from 'node:fs';
const json = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

globalThis.fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  appendFileSync(process.env.SS_ERP_SANDBOX_CALL_LOG, path + '\\n');
  if (path === '/v1/seller/info') return json({ company: { name: 'Dedicated Test Shop' } });
  if (path === '/v3/product/info/list') return json({ items: [] });
  throw new Error('unexpected mocked endpoint: ' + path);
};
`);
    const result = spawnSync(process.execPath, [
      '--import',
      pathToFileURL(preloadPath).href,
      scriptPath,
      '--preflight',
      '--offer-id',
      offerId,
      '--audit',
      auditPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cleanEnvironment({
        OZON_SANDBOX_READONLY_CONFIRM: 'READ_ONLY_SELLER_INFO_AND_OFFER_CHECK',
        OZON_SANDBOX_TEST_SHOP: 'true',
        OZON_SANDBOX_TEST_CLIENT_ID: 'test-client-id',
        OZON_SANDBOX_TEST_API_KEY: 'test-api-key',
        SS_ERP_SANDBOX_CALL_LOG: callLogPath,
      }),
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readFileSync(callLogPath, 'utf8').trim().split(/\r?\n/u), [
      '/v1/seller/info',
      '/v3/product/info/list',
    ]);
    const auditText = readFileSync(auditPath, 'utf8');
    const audit = JSON.parse(auditText);
    assert.equal(audit.finalState, 'READY_FOR_SEPARATE_WRITE_APPROVAL');
    assert.equal(audit.networkWritesSent, false);
    assert.equal(audit.offerExists, false);
    assert.doesNotMatch(auditText, /test-client-id|test-api-key/u);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /test-client-id|test-api-key/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('read-only preflight rejects payload arguments and malformed Seller Info', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-erp-ozon-readonly-invalid-'));
  const payloadPath = join(directory, 'compiled.json');
  const preloadPath = join(directory, 'mock-fetch.mjs');
  try {
    writeFileSync(payloadPath, JSON.stringify({ items: [] }));
    writeFileSync(preloadPath, `
globalThis.fetch = async () => new Response(JSON.stringify({}), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
`);
    const result = spawnSync(process.execPath, [
      '--import',
      pathToFileURL(preloadPath).href,
      scriptPath,
      '--preflight',
      '--offer-id',
      'ss-erp-sbx-invalid-1',
      '--payload',
      payloadPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cleanEnvironment({
        OZON_SANDBOX_READONLY_CONFIRM: 'READ_ONLY_SELLER_INFO_AND_OFFER_CHECK',
        OZON_SANDBOX_TEST_SHOP: 'true',
        OZON_SANDBOX_TEST_CLIENT_ID: 'test-client-id',
        OZON_SANDBOX_TEST_API_KEY: 'test-api-key',
      }),
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--payload is only valid with --execute/u);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /api-seller\.ozon\.ru|test-client-id|test-api-key/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  const malformedDirectory = mkdtempSync(join(tmpdir(), 'ss-erp-ozon-readonly-malformed-'));
  const auditPath = join(malformedDirectory, 'audit.json');
  const malformedPreloadPath = join(malformedDirectory, 'mock-fetch.mjs');
  try {
    writeFileSync(malformedPreloadPath, `
globalThis.fetch = async () => new Response(JSON.stringify({ company: {} }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
`);
    const result = spawnSync(process.execPath, [
      '--import',
      pathToFileURL(malformedPreloadPath).href,
      scriptPath,
      '--preflight',
      '--offer-id',
      'ss-erp-sbx-invalid-2',
      '--audit',
      auditPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cleanEnvironment({
        OZON_SANDBOX_READONLY_CONFIRM: 'READ_ONLY_SELLER_INFO_AND_OFFER_CHECK',
        OZON_SANDBOX_TEST_SHOP: 'true',
        OZON_SANDBOX_TEST_CLIENT_ID: 'test-client-id',
        OZON_SANDBOX_TEST_API_KEY: 'test-api-key',
      }),
      timeout: 10_000,
    });
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(audit.finalState, 'PREFLIGHT_FAILED');
    assert.equal(audit.networkWritesSent, false);
    assert.doesNotMatch(readFileSync(auditPath, 'utf8'), /test-client-id|test-api-key/u);
  } finally {
    rmSync(malformedDirectory, { recursive: true, force: true });
  }
});

test('sandbox probe rejects a non-reserved offer before any network request', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-erp-ozon-sandbox-contract-'));
  const payloadPath = join(directory, 'compiled.json');
  try {
    writeFileSync(payloadPath, JSON.stringify({ items: [{ offer_id: 'production-offer-1' }] }));
    const result = run(['--execute', '--payload', payloadPath], {
      OZON_SANDBOX_CONFIRM: 'CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING',
      OZON_SANDBOX_TEST_SHOP: 'true',
      OZON_SANDBOX_TEST_CLIENT_ID: 'test-client-id',
      OZON_SANDBOX_TEST_API_KEY: 'test-api-key',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reserved ss-erp-sbx- lowercase prefix/u);
    assert.doesNotMatch(result.stderr, /fetch failed|api-seller\.ozon\.ru/u);
    assert.doesNotMatch(result.stderr, /test-client-id|test-api-key/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('UNKNOWN transport outcome is audited, redacted, archived, and never resubmitted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-erp-ozon-sandbox-unknown-'));
  const payloadPath = join(directory, 'compiled.json');
  const auditPath = join(directory, 'audit.json');
  const callLogPath = join(directory, 'calls.log');
  const preloadPath = join(directory, 'mock-fetch.mjs');
  const offerId = 'ss-erp-sbx-contract-unknown-1';
  try {
    writeFileSync(payloadPath, JSON.stringify({ items: [{ offer_id: offerId }] }));
    writeFileSync(preloadPath, `
import { appendFileSync } from 'node:fs';
let lookupCount = 0;
const json = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
globalThis.fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  appendFileSync(process.env.SS_ERP_SANDBOX_CALL_LOG, path + '\\n');
  if (path === '/v3/product/info/list') {
    lookupCount += 1;
    return json({ items: lookupCount === 1 ? [] : [{ offer_id: '${offerId}', id: 777 }] });
  }
  if (path === '/v3/product/import') {
    throw new Error('simulated transport loss ' + process.env.OZON_SANDBOX_TEST_API_KEY);
  }
  if (path === '/v1/product/archive') return json({ result: true });
  throw new Error('unexpected mocked endpoint: ' + path);
};
`);

    const environment = cleanEnvironment({
      OZON_SANDBOX_CONFIRM: 'CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING',
      OZON_SANDBOX_TEST_SHOP: 'true',
      OZON_SANDBOX_TEST_CLIENT_ID: 'test-client-credential',
      OZON_SANDBOX_TEST_API_KEY: 'test-api-secret',
      SS_ERP_SANDBOX_CALL_LOG: callLogPath,
    });
    const result = spawnSync(process.execPath, [
      '--import',
      pathToFileURL(preloadPath).href,
      scriptPath,
      '--execute',
      '--payload',
      payloadPath,
      '--audit',
      auditPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: environment,
      timeout: 10_000,
    });

    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    const calls = readFileSync(callLogPath, 'utf8').trim().split(/\r?\n/u);
    assert.equal(calls.filter((path) => path === '/v3/product/import').length, 1);
    assert.deepEqual(calls, [
      '/v3/product/info/list',
      '/v3/product/import',
      '/v3/product/info/list',
      '/v1/product/archive',
    ]);
    const auditText = readFileSync(auditPath, 'utf8');
    const audit = JSON.parse(auditText);
    assert.equal(audit.finalState, 'UNKNOWN');
    assert.equal(audit.automaticResubmitAllowed, false);
    assert.equal(audit.submit.callCount, 1);
    assert.equal(audit.cleanup.state, 'ARCHIVED');
    assert.deepEqual(audit.cleanup.productIds, [777]);
    assert.doesNotMatch(auditText, /test-client-credential|test-api-secret/u);
    assert.match(auditText, /\[REDACTED_SECRET\]/u);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /test-client-credential|test-api-secret/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('acknowledged submission polls import info and archives the returned product ID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-erp-ozon-sandbox-success-'));
  const payloadPath = join(directory, 'compiled.json');
  const auditPath = join(directory, 'audit.json');
  const callLogPath = join(directory, 'calls.log');
  const preloadPath = join(directory, 'mock-fetch.mjs');
  const offerId = 'ss-erp-sbx-contract-success-1';
  try {
    writeFileSync(payloadPath, JSON.stringify({ items: [{ offer_id: offerId }] }));
    writeFileSync(preloadPath, `
import { appendFileSync } from 'node:fs';
const json = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
globalThis.fetch = async (input) => {
  const path = new URL(String(input)).pathname;
  appendFileSync(process.env.SS_ERP_SANDBOX_CALL_LOG, path + '\\n');
  if (path === '/v3/product/info/list') return json({ items: [] });
  if (path === '/v3/product/import') return json({ result: { task_id: 123 } });
  if (path === '/v1/product/import/info') return json({
    result: { items: [{ offer_id: '${offerId}', product_id: 888, status: 'imported', errors: [] }] },
  });
  if (path === '/v1/product/archive') return json({ result: true });
  throw new Error('unexpected mocked endpoint: ' + path);
};
`);

    const result = spawnSync(process.execPath, [
      '--import',
      pathToFileURL(preloadPath).href,
      scriptPath,
      '--execute',
      '--payload',
      payloadPath,
      '--audit',
      auditPath,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: cleanEnvironment({
        OZON_SANDBOX_CONFIRM: 'CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING',
        OZON_SANDBOX_TEST_SHOP: 'true',
        OZON_SANDBOX_TEST_CLIENT_ID: 'test-client-id',
        OZON_SANDBOX_TEST_API_KEY: 'test-api-key',
        SS_ERP_SANDBOX_CALL_LOG: callLogPath,
      }),
      timeout: 10_000,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readFileSync(callLogPath, 'utf8').trim().split(/\r?\n/u), [
      '/v3/product/info/list',
      '/v3/product/import',
      '/v1/product/import/info',
      '/v1/product/archive',
    ]);
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
    assert.equal(audit.finalState, 'SUCCEEDED');
    assert.equal(audit.submit.taskId, '123');
    assert.equal(audit.poll.total, 1);
    assert.equal(audit.cleanup.state, 'ARCHIVED');
    assert.deepEqual(audit.cleanup.productIds, [888]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('sandbox source keeps submission single-shot, prefix-bound, redacted, and non-resubmitting', () => {
  assert.match(source, /const RESERVED_OFFER_PREFIX = 'ss-erp-sbx-'/u);
  assert.match(source, /payload\.items\.length !== 1/u);
  assert.match(source, /let importCallCount = 0/u);
  assert.match(source, /if \(importCallCount !== 1\)/u);
  assert.equal((source.match(/submitProductOnce\(/gu) || []).length, 2, 'one definition and one call are expected');
  assert.match(source, /automaticResubmitAllowed: false/u);
  assert.match(source, /UNKNOWN submission outcome recorded\. Automatic resubmission is forbidden\./u);
  assert.match(source, /SENSITIVE_KEY/u);
  assert.match(source, /'\[REDACTED\]'/u);
  assert.match(source, /redactCredentialValues/u);
  assert.match(source, /'\[REDACTED_SECRET\]'/u);
  assert.match(source, /OZON_SANDBOX_TEST_CLIENT_ID/u);
  assert.match(source, /OZON_SANDBOX_TEST_API_KEY/u);
  assert.doesNotMatch(source, /process\.env\.OZON_(?:CLIENT_ID|API_KEY)\b/u);
  for (const endpoint of [
    '/v3/product/import',
    '/v1/product/import/info',
    '/v3/product/info/list',
    '/v1/product/archive',
  ]) {
    assert.ok(source.includes(endpoint), `sandbox probe must retain ${endpoint}`);
  }
  const mainSource = source.slice(source.indexOf('async function main()'));
  assert.ok(
    mainSource.indexOf('requireExecutionGates(options, process.env)')
      < mainSource.indexOf('const payloadBytes = await readFile(options.payloadPath)'),
    'execution gates must run before payload access',
  );
  assert.ok(
    mainSource.indexOf('requireExecutionGates(options, process.env)')
      < mainSource.indexOf('existing = await lookupProducts(credentials, compiled.offerIds)'),
    'execution gates must run before any network call',
  );
});

test('runbook documents the live-write warning, UNKNOWN rule, and credential hygiene', () => {
  assert.match(runbook, /dedicated Ozon test shop/iu);
  assert.match(runbook, /ss-erp-sbx-/u);
  assert.match(runbook, /CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING/u);
  assert.match(runbook, /UNKNOWN[\s\S]*never run the payload again/iu);
  assert.match(runbook, /must not be written to the payload, audit file, shell history, or issue tracker/iu);
  assert.match(runbook, /\/v1\/product\/archive/u);
});
