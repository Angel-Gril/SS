import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const apiSource = compile('apps/web/src/lib/api.ts');
const authSource = compile('apps/web/src/lib/auth-return-to.ts');

function loadApi(
  browserOrigin,
  configuredBase,
  observedFetch = () => assert.fail('URL selection must not send a request'),
  deploymentEnv = {},
) {
  const auth = { exports: {} };
  vm.runInNewContext(authSource, { module: auth, exports: auth.exports, URL });
  const api = { exports: {} };
  vm.runInNewContext(apiSource, {
    module: api,
    exports: api.exports,
    require(specifier) {
      assert.equal(specifier, '@/lib/auth-return-to');
      return auth.exports;
    },
    process: { env: { NEXT_PUBLIC_API_BASE_URL: configuredBase, ...deploymentEnv } },
    window: browserOrigin ? { location: new URL(browserOrigin) } : undefined,
    fetch: observedFetch,
    URL, Headers, AbortController, setTimeout, clearTimeout,
  }, { filename: 'apps/web/src/lib/api.ts' });
  return api.exports;
}

async function observeRequests(browserOrigin, configuredBase, deploymentEnv = {}) {
  const calls = [];
  const failure = new TypeError('Synthetic unavailable transport');
  const api = loadApi(browserOrigin, configuredBase, async (url, options) => {
    calls.push({ url, method: options.method || 'GET', credentials: options.credentials });
    throw failure;
  }, deploymentEnv);
  await assert.rejects(api.api.get('/api/user/me'), error => error === failure);
  await assert.rejects(api.api.download('/api/synthetic-download', 'fixture.txt'), error => error === failure);
  return { api, calls };
}

for (const webKind of ['erp', 'admin']) {
  test(`configured custom ${webKind} host uses its same-origin API proxy`, async () => {
    const webOrigin = `https://${webKind}.internal.example`;
    const apiOrigin = 'https://api.internal.example';
    const { api, calls } = await observeRequests(webOrigin, apiOrigin, {
      NEXT_PUBLIC_USER_HOSTNAME: 'erp.internal.example',
      NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.internal.example',
    });
    assert.equal(api.getApiBase(), apiOrigin);
    assert.equal(api.apiUrl('/api/user/me'), `${apiOrigin}/api/user/me`);
    assert.deepEqual(calls, [
      { url: `${webOrigin}/api/user/me`, method: 'GET', credentials: 'include' },
      { url: `${webOrigin}/api/synthetic-download`, method: 'GET', credentials: 'include' },
    ]);
  });
}

for (const webOrigin of ['http://erp.internal.example', 'https://erp.internal.example:8443']) {
  test(`configured custom Web origin keeps the canonical API on an unsafe transport: ${webOrigin}`, async () => {
    const apiOrigin = 'https://api.internal.example';
    const { calls } = await observeRequests(webOrigin, apiOrigin, {
      NEXT_PUBLIC_USER_HOSTNAME: 'erp.internal.example',
      NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.internal.example',
    });
    assert.deepEqual(calls, [
      { url: `${apiOrigin}/api/user/me`, method: 'GET', credentials: 'include' },
      { url: `${apiOrigin}/api/synthetic-download`, method: 'GET', credentials: 'include' },
    ]);
  });
}

for (const region of ['com', 'cn']) {
  const apiOrigin = `https://ss-erp.${region}`;
  for (const webKind of ['app', 'admin']) {
    const webOrigin = `https://${webKind}.ss-erp.${region}`;
    for (const suffix of ['', '/']) {
      test(`${region} ${webKind} Web requests use their same-origin API proxy while public addresses stay canonical${suffix ? ' with a trailing slash' : ''}`, async () => {
        const { api, calls } = await observeRequests(webOrigin, apiOrigin + suffix);
        assert.equal(api.getApiBase(), apiOrigin, 'extension pairing keeps the canonical API origin');
        assert.equal(api.apiUrl('/api/user/me'), `${apiOrigin}/api/user/me`, 'published URLs keep their canonical host');
        assert.deepEqual(calls, [
          { url: `${webOrigin}/api/user/me`, method: 'GET', credentials: 'include' },
          { url: `${webOrigin}/api/synthetic-download`, method: 'GET', credentials: 'include' },
        ]);
      });
    }
  }
  test(`${region} SSR preserves the configured canonical API origin`, async () => {
    const { api, calls } = await observeRequests(undefined, apiOrigin);
    assert.equal(api.getApiBase(), apiOrigin);
    assert.equal(api.apiUrl('/api/user/me'), `${apiOrigin}/api/user/me`);
    assert.deepEqual(calls, [
      { url: `${apiOrigin}/api/user/me`, method: 'GET', credentials: 'include' },
      { url: `${apiOrigin}/api/synthetic-download`, method: 'GET', credentials: 'include' },
    ]);
  });
}

for (const scenario of [
  { name: 'COM Web with explicit CN API', web: 'https://app.ss-erp.com', configured: 'https://ss-erp.cn' },
  { name: 'CN Web with explicit COM API', web: 'https://app.ss-erp.cn', configured: 'https://ss-erp.com' },
  { name: 'custom API hostname', web: 'https://app.ss-erp.com', configured: 'https://api.custom.example' },
  { name: 'custom API path', web: 'https://app.ss-erp.com', configured: 'https://ss-erp.com/custom-api' },
  { name: 'custom API port', web: 'https://app.ss-erp.com', configured: 'https://ss-erp.com:8443' },
  { name: 'explicit default API port', web: 'https://app.ss-erp.com', configured: 'https://ss-erp.com:443' },
  { name: 'HTTP API', web: 'https://app.ss-erp.com', configured: 'http://ss-erp.com' },
  { name: 'HTTP Web', web: 'http://app.ss-erp.com', configured: 'https://ss-erp.com' },
  { name: 'nonstandard Web port', web: 'https://app.ss-erp.com:8443', configured: 'https://ss-erp.com' },
  { name: 'custom Web domain', web: 'https://erp.custom.example', configured: 'https://ss-erp.com' },
  { name: 'hostname suffix lookalike', web: 'https://app.ss-erp.com.example', configured: 'https://ss-erp.com' },
  { name: 'local Web with explicit cloud API', web: 'http://localhost:3000', configured: 'https://ss-erp.com' },
]) {
  test(`${scenario.name} retains explicit API configuration for requests and published URLs`, async () => {
    const { api, calls } = await observeRequests(scenario.web, scenario.configured);
    assert.equal(api.getApiBase(), scenario.configured);
    assert.equal(api.apiUrl('/api/user/me'), `${scenario.configured}/api/user/me`);
    assert.deepEqual(calls, [
      { url: `${scenario.configured}/api/user/me`, method: 'GET', credentials: 'include' },
      { url: `${scenario.configured}/api/synthetic-download`, method: 'GET', credentials: 'include' },
    ]);
  });
}

for (const scenario of [
  { name: 'localhost without configuration', web: 'http://localhost:3000', configured: undefined, expected: 'http://localhost:3001' },
  { name: 'loopback without configuration', web: 'http://127.0.0.1:3000', configured: undefined, expected: 'http://127.0.0.1:3001' },
  { name: 'localhost with loopback API alias', web: 'http://localhost:3000', configured: 'http://127.0.0.1:3001/', expected: 'http://localhost:3001' },
  { name: 'loopback with localhost API alias', web: 'http://127.0.0.1:3000', configured: 'http://localhost:3001', expected: 'http://127.0.0.1:3001' },
  { name: 'cloud Web without configuration', web: 'https://app.ss-erp.com', configured: undefined, expected: 'https://app.ss-erp.com' },
  { name: 'cloud Web ignores a stale loopback build value', web: 'https://app.ss-erp.com', configured: 'http://127.0.0.1:3001', expected: 'https://app.ss-erp.com' },
  { name: 'SSR without configuration', web: undefined, configured: undefined, expected: 'http://localhost:3001' },
]) {
  test(`${scenario.name} keeps existing resolution`, async () => {
    const { api, calls } = await observeRequests(scenario.web, scenario.configured);
    assert.equal(api.getApiBase(), scenario.expected);
    assert.deepEqual(calls, [
      { url: `${scenario.expected}/api/user/me`, method: 'GET', credentials: 'include' },
      { url: `${scenario.expected}/api/synthetic-download`, method: 'GET', credentials: 'include' },
    ]);
  });
}

test('a failed write goes to the same-origin proxy exactly once without retrying the canonical host', async () => {
  const calls = [];
  const failure = new TypeError('Synthetic unavailable transport');
  const api = loadApi('https://app.ss-erp.com', 'https://ss-erp.com', async (url, options) => {
    calls.push({ url, method: options.method, credentials: options.credentials });
    throw failure;
  });
  await assert.rejects(api.api.post('/api/synthetic-write', { fixture: true }), error => error === failure);
  assert.deepEqual(calls, [{
    url: 'https://app.ss-erp.com/api/synthetic-write', method: 'POST', credentials: 'include',
  }]);
});
