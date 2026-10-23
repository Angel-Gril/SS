import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  extractOzonCalls,
  analyzeOzonCompatibility,
} from './ozon-api-compatibility-check.mjs';

const endpoint = '/v1/example/list';
const sourceName = 'apps/server/src/services/ozon-client.ts';
const source = `class Client {
  read() { return this.request<{ rows: { id: number }[] }>('${endpoint}'); }
}`;
const calls = [{ path: endpoint, method: 'POST', source: sourceName, line: 2 }];
const makeSpec = (operation = {}) => ({
  openapi: '3.0.0', info: { version: 'synthetic-test' },
  paths: { [endpoint]: { post: { operationId: 'ExampleList', ...operation } } },
});

test('AST extraction reads nested generics and explicit verbs without comments or string decoys', () => {
  const result = extractOzonCalls(`${source}
  // this.request('/v9/comment');
  const decoy = "this.request('/v9/string')";
  client.request('/v1/actions', { method: 'GET' });
  client.requestBinary('/v1/example/pdf', {});`, sourceName);
  assert.deepEqual(result.calls.map(({ path: p, method }) => [p, method]), [
    [endpoint, 'POST'], ['/v1/actions', 'GET'], ['/v1/example/pdf', 'POST'],
  ]);
  assert.deepEqual(result.unresolved, []);
});

test('AST extraction supports top-level fixed constants but reports dynamic paths and methods', () => {
  const result = extractOzonCalls(`const fixed = '/v1/example/list';
  const verb = 'GET';
  client.request(fixed, { method: verb });
  client.request(dynamicPath);
  client.request('/v1/example/list', { method: runtimeMethod });
  client.request('/v1/example/list', runtimeOptions);`, sourceName);
  assert.deepEqual(result.calls.map(({ path: p, method }) => [p, method]), [[endpoint, 'GET']]);
  assert.equal(result.unresolved.length, 3);
  assert.ok(result.unresolved.every((item) => item.line > 0 && item.source === sourceName));
});

test('unsupported or syntactically broken source is never counted as complete coverage', () => {
  assert.throws(() => extractOzonCalls('class Broken {', sourceName), /syntax/i);
  const result = extractOzonCalls(`client.request('/v1/example/list', { ...options });`, sourceName);
  assert.equal(result.calls.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test('a shadowed or mutable path cannot be mistaken for a fixed top-level constant', () => {
  const result = extractOzonCalls(`const fixed = '${endpoint}';
    function dynamic(fixed) { return client.request(fixed); }
    function local() { const fixed = '/v1/other/list'; return client.request(fixed); }
    let changed = '${endpoint}';
    client.request(changed);`, sourceName);
  assert.deepEqual(result.calls.map((call) => call.path), ['/v1/other/list']);
  assert.equal(result.unresolved.length, 2);
});

test('Premium source files are explicitly outside the scanner scope', () => {
  assert.throws(() => extractOzonCalls(source, 'extensions/premium/example.ts'), /excluded/i);
});

test('current paths have bounded factual status rather than claimed online/schema acceptance', () => {
  const result = analyzeOzonCompatibility(makeSpec(), { calls });
  assert.equal(result.status, 'no_alerts_in_checked_scope');
  assert.equal(result.exitCode, 0);
  assert.equal(result.coverage.onlineVerified, false);
  assert.equal(result.coverage.completeSchemaCompatibility, false);
  assert.match(result.coverage.limitations.join(' '), /field usage/i);
});

test('missing path and missing HTTP method are different actionable failures', () => {
  const missingPath = analyzeOzonCompatibility({ ...makeSpec(), paths: {} }, { calls });
  assert.equal(missingPath.exitCode, 1);
  assert.equal(missingPath.findings[0].code, 'PATH_MISSING');
  const missingMethod = analyzeOzonCompatibility(makeSpec(), { calls: [{ ...calls[0], method: 'GET' }] });
  assert.equal(missingMethod.findings[0].code, 'HTTP_METHOD_MISSING');
  assert.equal(missingMethod.exitCode, 1);
});

test('method deprecated and explicit retirement prose each require review', () => {
  const deprecated = analyzeOzonCompatibility(makeSpec({ deprecated: true }), { calls });
  assert.ok(deprecated.findings.some((finding) => finding.code === 'OPERATION_DEPRECATED'));
  const prose = analyzeOzonCompatibility(makeSpec({ description: 'This method will be removed on 2026-11-02.' }), { calls });
  assert.ok(prose.findings.some((finding) => finding.code === 'OPERATION_RETIREMENT_WARNING'));
  assert.equal(prose.exitCode, 1);
  for (const description of ['This method will no longer be available after November.', 'This field is scheduled for removal.']) {
    assert.equal(analyzeOzonCompatibility(makeSpec({ description }), { calls }).exitCode, 1);
  }
});

test('Russian/Chinese retirement prose is detected without treating normal remove actions as retirement', () => {
  for (const description of ['Метод будет отключён 2 ноября.', '此接口将在下月停用。']) {
    assert.equal(analyzeOzonCompatibility(makeSpec({ description }), { calls }).exitCode, 1);
  }
  for (const description of ['Remove postings from a container.', 'Удаление отправлений из грузоместа.', '删除组包内订单。']) {
    assert.equal(analyzeOzonCompatibility(makeSpec({ description }), { calls }).exitCode, 0);
  }
});

test('only operation-related schemas are traversed, including referenced fields and cycles', () => {
  const spec = makeSpec({ responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Rows' } } } } } });
  spec.components = { schemas: {
    Rows: { type: 'object', properties: {
      total: { type: 'integer', description: 'This field will be removed on 2026-11-23.' },
      legacy: { type: 'string', deprecated: true },
      next: { $ref: '#/components/schemas/Rows' },
    } },
    Unrelated: { description: 'This method is deprecated.' },
  } };
  const result = analyzeOzonCompatibility(spec, { calls });
  assert.ok(result.findings.some((item) => item.code === 'FIELD_RETIREMENT_WARNING' && item.location.includes('total')));
  assert.ok(result.findings.some((item) => item.code === 'FIELD_DEPRECATED' && item.location.includes('legacy')));
  assert.ok(result.findings.every((item) => !item.location?.includes('Unrelated')));
  assert.equal(result.exitCode, 1);
});

test('unresolved local/external refs require review and never trigger network reads', () => {
  for (const $ref of ['#/components/schemas/Missing', 'https://example.invalid/schema.json']) {
    const result = analyzeOzonCompatibility(makeSpec({ requestBody: { $ref } }), { calls });
    assert.ok(result.findings.some((item) => item.code === 'SPEC_REFERENCE_UNRESOLVED'));
    assert.equal(result.exitCode, 1);
  }
});

test('BetaMethod is reported as a warning, never as proof the current seller has access', () => {
  const result = analyzeOzonCompatibility(makeSpec({ tags: ['BetaMethod'] }), { calls });
  assert.ok(result.findings.some((item) => item.code === 'BETA_METHOD'));
  assert.equal(result.exitCode, 0);
  assert.equal(result.coverage.onlineVerified, false);
});

test('News includes matching paths/operations only and preserves date context for human review', () => {
  const spec = makeSpec();
  spec.tags = [{ name: 'News', description: '# 2026-10-22\n\nUpdated `/v1/example/list` price description.\n\n# 2026-10-21\n\nExampleList supports a new field.\n\n# 2026-10-20\n\nChanged /v1/example/list-other only.' }];
  const result = analyzeOzonCompatibility(spec, { calls });
  assert.equal(result.news.length, 2);
  assert.equal(result.news[0].date, '2026-10-22');
  assert.equal(result.news[1].date, '2026-10-21');
  assert.equal(result.exitCode, 0);
});

test('deduplicates calls but keeps each caller location', () => {
  const result = analyzeOzonCompatibility(makeSpec(), { calls: [...calls, { ...calls[0], line: 7 }] });
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].sources.length, 2);
});

test('empty and unresolved call coverage cannot claim a clean scan', () => {
  for (const input of [{ calls: [] }, { calls: [], unresolved: [{ source: sourceName, line: 1, reason: 'dynamic path' }] }]) {
    const result = analyzeOzonCompatibility(makeSpec(), input);
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, 'requires_review');
  }
});

test('malformed OpenAPI input fails explicitly', () => {
  for (const spec of [null, {}, { openapi: '3.0.0', paths: [] }, { swagger: '2.0', paths: {} }]) {
    assert.throws(() => analyzeOzonCompatibility(spec, { calls }), /OpenAPI/i);
  }
});

test('CLI validates saved files offline and uses 0 / 1 / 2 exit codes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ss-erp-ozon-api-check-'));
  try {
    const specFile = path.join(directory, 'synthetic-spec.json');
    const sourceFile = path.join(directory, 'synthetic-client.ts');
    writeFileSync(sourceFile, source);
    const run = () => spawnSync(process.execPath, ['scripts/ozon-api-compatibility-check.mjs', '--spec', specFile, '--source', sourceFile, '--json'], { encoding: 'utf8' });
    writeFileSync(specFile, JSON.stringify(makeSpec()));
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'no_alerts_in_checked_scope');
    writeFileSync(specFile, JSON.stringify(makeSpec({ deprecated: true })));
    result = run();
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).status, 'requires_review');
    writeFileSync(specFile, '{invalid');
    result = run();
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).status, 'input_error');
    assert.equal(JSON.parse(result.stdout).coverage.onlineVerified, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
