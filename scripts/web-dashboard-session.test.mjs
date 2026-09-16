import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const WEB_SOURCE = path.resolve('apps/web/src');
const SESSION_MODULE = path.join(WEB_SOURCE, 'lib/dashboard-session.ts');
const TOKEN_KEY = 'sserp.token';
const SYNTHETIC_TOKEN = 'SYNTHETIC_LOCAL_STORAGE_TOKEN_NOT_A_CREDENTIAL';
const USER = { id: 'synthetic-session-user', nickname: 'Synthetic user', role: 'USER', status: 'ACTIVE' };
const RETURN_TO = '/listing-logs?jobId=synthetic-session-job';
const GUARD_MS = 1_200;
const watchdog = setTimeout(() => {
  process.stderr.write('FAIL dashboard session fixture exceeded its process guard\n');
  process.exit(1);
}, 20_000).unref();
after(() => clearTimeout(watchdog));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TEST_GUARD_EXPIRED: ${label}`)), GUARD_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sourceLoader(origin, window, localStorage, observedFetch) {
  const modules = new Map();
  const context = vm.createContext({
    process: { env: { NEXT_PUBLIC_API_BASE_URL: origin } },
    window, localStorage, fetch: observedFetch,
    Headers, URL, Response, AbortController, AbortSignal, DOMException,
    Error, TypeError, RangeError, setTimeout, clearTimeout,
  });
  function load(filename) {
    const absolute = path.resolve(filename);
    assert.ok(absolute.startsWith(`${WEB_SOURCE}${path.sep}`), 'fixture may load only the real Web source');
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const require = specifier => {
      assert.ok(specifier.startsWith('@/') || specifier.startsWith('./') || specifier.startsWith('../'));
      const target = specifier.startsWith('@/')
        ? path.join(WEB_SOURCE, specifier.slice(2))
        : path.resolve(path.dirname(absolute), specifier);
      return load(path.extname(target) ? target : `${target}.ts`);
    };
    const initialize = vm.runInContext(`(function(exports, require, module) {\n${compiled}\n})`, context, { filename: absolute });
    initialize(module.exports, require, module);
    return module.exports;
  }
  return load;
}

async function withSessionServer(respond, run) {
  const requests = [];
  const sockets = new Set();
  const received = deferred();
  const removedKeys = [];
  const stored = new Map([[TOKEN_KEY, SYNTHETIC_TOKEN]]);
  const localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: key => { removedKeys.push(key); stored.delete(key); },
    clear: () => { removedKeys.push('*'); stored.clear(); },
  };
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    received.resolve();
    respond(request, response);
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const initialHref = origin + RETURN_TO;
    const window = { localStorage, location: {
      hostname: '127.0.0.1', origin, protocol: 'http:', pathname: '/listing-logs',
      search: '?jobId=synthetic-session-job', href: initialHref,
    } };
    const load = sourceLoader(origin, window, localStorage, (url, options) => {
      assert.equal(new URL(url).origin, origin, 'no external host is permitted');
      return fetch(url, options); // Real native HTTP; no mocked api.get or apiFetch.
    });
    const apiModule = load(path.join(WEB_SOURCE, 'lib/api.ts'));
    assert.equal(apiModule.getApiBase(), origin);
    const { loadDashboardSession } = load(SESSION_MODULE);
    assert.equal(typeof loadDashboardSession, 'function');
    await run({
      loadDashboardSession, requests, received: received.promise, window,
      assertSessionUntouched() {
        assert.equal(stored.get(TOKEN_KEY), SYNTHETIC_TOKEN, 'unavailable requests must preserve local session state');
        assert.deepEqual(removedKeys, []);
        assert.equal(window.location.href, initialHref, 'only a real 401 may invoke the existing login redirect');
      },
      assertSingleGet() {
        assert.deepEqual(requests, [{ method: 'GET', url: '/api/user/me' }]);
      },
      stored, removedKeys,
    });
  } finally {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    await closed;
  }
}

const plain = value => JSON.parse(JSON.stringify(value));
const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

test('dashboard session authenticates only the successful real user response', { timeout: 5_000 }, async () => {
  await withSessionServer((_request, response) => json(response, 200, { code: 1, msg: 'ok', data: USER }), async fixture => {
    const result = await bounded(fixture.loadDashboardSession({ timeoutMs: 500 }), 'successful identity');
    assert.deepEqual(plain(result), { status: 'authenticated', user: USER });
    fixture.assertSessionUntouched();
    fixture.assertSingleGet();
  });
});

for (const phase of ['headers', 'body']) {
  test(`dashboard ${phase} timeout stays unavailable and retains session state`, { timeout: 5_000 }, async () => {
    await withSessionServer((_request, response) => {
      if (phase === 'headers') return;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{"code":1,"data":');
    }, async fixture => {
      const result = await bounded(fixture.loadDashboardSession({ timeoutMs: 100 }), `${phase} timeout`);
      assert.deepEqual(plain(result), { status: 'unavailable', reason: 'timeout' });
      fixture.assertSessionUntouched();
      fixture.assertSingleGet();
    });
  });
}

test('dashboard connection failure is unavailable without clearing a token or granting a user', { timeout: 5_000 }, async () => {
  await withSessionServer(request => request.socket.destroy(), async fixture => {
    const result = await bounded(fixture.loadDashboardSession({ timeoutMs: 500 }), 'connection failure');
    assert.deepEqual(plain(result), { status: 'unavailable', reason: 'network' });
    fixture.assertSessionUntouched();
    fixture.assertSingleGet();
  });
});

test('dashboard 503 maintenance preserves session state and is distinguished from authentication', { timeout: 5_000 }, async () => {
  await withSessionServer((_request, response) => json(response, 503, { maintenance: true, msg: 'Synthetic maintenance' }), async fixture => {
    const result = await bounded(fixture.loadDashboardSession({ timeoutMs: 500 }), 'maintenance');
    assert.deepEqual(plain(result), { status: 'unavailable', reason: 'maintenance' });
    fixture.assertSessionUntouched();
    fixture.assertSingleGet();
  });
});

test('dashboard missing identity or non-success business code never grants user access', { timeout: 5_000 }, async () => {
  for (const body of [
    { code: 1 }, { code: 1, data: null }, { code: 1, data: {} }, { code: 1, data: [] },
    { code: 1, data: { ...USER, id: '' } }, { code: 1, data: { ...USER, role: 'UNKNOWN' } },
    { code: 0, data: USER }, { code: '1', data: USER },
  ]) {
    await withSessionServer((_request, response) => json(response, 200, body), async fixture => {
      const result = await bounded(fixture.loadDashboardSession({ timeoutMs: 500 }), 'missing identity');
      assert.deepEqual(plain(result), { status: 'unavailable', reason: 'response' });
      fixture.assertSessionUntouched();
      fixture.assertSingleGet();
    });
  }
});

test('dashboard caller cancellation is silent and preserves session state', { timeout: 5_000 }, async () => {
  await withSessionServer(() => {}, async fixture => {
    const caller = new AbortController();
    const operation = fixture.loadDashboardSession({ timeoutMs: 1_000, signal: caller.signal });
    await bounded(fixture.received, 'cancellable request readiness');
    caller.abort(new DOMException('Synthetic dashboard unmount', 'AbortError'));
    const result = await bounded(operation, 'caller cancellation');
    assert.deepEqual(plain(result), { status: 'cancelled' });
    fixture.assertSessionUntouched();
    fixture.assertSingleGet();
  });
});

test('real 401 keeps apiFetch token clearing and the existing login returnTo redirect', { timeout: 5_000 }, async () => {
  await withSessionServer((_request, response) => json(response, 401, { code: 0, msg: 'Synthetic expired session' }), async fixture => {
    const result = await bounded(fixture.loadDashboardSession({ timeoutMs: 500 }), '401 response');
    assert.deepEqual(plain(result), { status: 'unavailable', reason: 'response' });
    assert.equal(fixture.stored.has(TOKEN_KEY), false);
    assert.deepEqual(fixture.removedKeys, [TOKEN_KEY]);
    assert.equal(fixture.window.location.href, `/login?returnTo=${encodeURIComponent(RETURN_TO)}`);
    fixture.assertSingleGet();
  });
});
