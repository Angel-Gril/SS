import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const WEB_SOURCE = path.resolve('apps/web/src');
const API_MODULE = path.join(WEB_SOURCE, 'lib/api.ts');
const TIMEOUT_MS = 100;
const GUARD_MS = 1_200;
// A broken transport must fail this test rather than leave Node running forever.
const watchdog = setTimeout(() => {
  process.stderr.write('FAIL web API deadline fixture exceeded its process guard\n');
  process.exit(1);
}, 20_000).unref();
after(() => clearTimeout(watchdog));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function loadApi(origin, observedFetch, globals = {}) {
  const modules = new Map();
  function load(filename) {
    const absolute = path.resolve(filename);
    assert.ok(absolute.startsWith(`${WEB_SOURCE}${path.sep}`), 'fixture may load only real Web source modules');
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      module,
      exports: module.exports,
      require(specifier) {
        assert.ok(specifier.startsWith('@/') || specifier.startsWith('./') || specifier.startsWith('../'));
        const target = specifier.startsWith('@/')
          ? path.join(WEB_SOURCE, specifier.slice(2))
          : path.resolve(path.dirname(absolute), specifier);
        return load(path.extname(target) ? target : `${target}.ts`);
      },
      process: { env: { NEXT_PUBLIC_API_BASE_URL: origin } },
      fetch: observedFetch,
      Headers, URL, Response, AbortController, AbortSignal, DOMException,
      setTimeout: globals.setTimeout || setTimeout,
      clearTimeout: globals.clearTimeout || clearTimeout,
      window: globals.window,
      localStorage: globals.window?.localStorage,
    }, { filename: absolute });
    return module.exports;
  }
  return load(API_MODULE);
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

async function withHttpApi(respond, run, fixtureOptions = {}) {
  const received = deferred();
  const headersReceived = deferred();
  const sockets = new Set();
  const requests = [];
  const fetchCalls = [];
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Every call uses native HTTP. One late-response case deliberately leaves its
  // transport alive after cancellation so stale 401 side effects are exercised.
  const apiModule = loadApi(origin, async (url, requestOptions) => {
    assert.equal(new URL(url).origin, origin, 'no external host is permitted in this fixture');
    fetchCalls.push(requestOptions);
    const nativeOptions = { ...requestOptions };
    if (fixtureOptions.ignoreTransportAbort) delete nativeOptions.signal;
    const response = await fetch(url, nativeOptions);
    headersReceived.resolve();
    return response;
  }, { ...fixtureOptions.clock, window: fixtureOptions.createWindow?.(origin) });
  try {
    return await run({ apiModule, requests, fetchCalls, received: received.promise, headersReceived: headersReceived.promise });
  } finally {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    await closed;
  }
}

const capture = promise => promise.then(
  value => ({ kind: 'fulfilled', value }),
  error => ({ kind: 'rejected', error }),
);

test('JSON GET exposes the agreed 30-second default deadline', { timeout: 5_000 }, async () => {
  await withHttpApi((_request, response) => response.end('{}'), async ({ apiModule }) => {
    assert.equal(apiModule.API_GET_TIMEOUT_MS, 30_000);
    assert.equal(typeof apiModule.ApiRequestTimeoutError, 'function');
  });
});

for (const phase of ['headers', 'body-200', 'body-503']) {
  test(`GET deadline rejects a permanently pending ${phase} without resending`, { timeout: 5_000 }, async () => {
    await withHttpApi((_request, response) => {
      if (phase === 'headers') return;
      response.writeHead(phase === 'body-503' ? 503 : 200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{"code":'); // Real headers arrive, but the JSON body never finishes.
    }, async ({ apiModule, requests, fetchCalls }) => {
      const caller = new AbortController();
      const options = { method: 'GET', timeoutMs: TIMEOUT_MS, ...(phase === 'headers' ? {} : { signal: caller.signal }) };
      const outcome = await bounded(capture(apiModule.apiFetch('/api/deadline-fixture', options)), phase);
      assert.equal(outcome.kind, 'rejected', 'deadline must reject rather than manufacture an HTTP business response');
      assert.equal(outcome.error.name, 'TimeoutError');
      assert.equal(outcome.error.code, 'API_REQUEST_TIMEOUT');
      assert.ok(outcome.error instanceof apiModule.ApiRequestTimeoutError);
      assert.equal(caller.signal.aborted, false, 'the transport deadline must not cancel the caller controller');
      await new Promise(resolve => setTimeout(resolve, TIMEOUT_MS * 2));
      assert.equal(requests.length, 1, 'a timeout must not resend the HTTP request');
      assert.equal(fetchCalls.length, 1);
      assert.equal(Object.hasOwn(fetchCalls[0], 'timeoutMs'), false, 'transport options must not leak into native fetch');
    });
  });
}

for (const phase of ['headers', 'body']) {
  test(`caller cancellation is preserved while GET waits for ${phase}`, { timeout: 5_000 }, async () => {
    await withHttpApi((_request, response) => {
      if (phase === 'headers') return;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{"code":');
    }, async ({ apiModule, requests, received, headersReceived }) => {
      const caller = new AbortController();
      const reason = new DOMException('Synthetic caller cancellation', 'AbortError');
      const operation = capture(apiModule.apiFetch('/api/caller-cancellation', {
        method: 'GET', timeoutMs: 1_000, signal: caller.signal,
      }));
      await bounded(phase === 'body' ? headersReceived : received, 'cancellation fixture readiness');
      if (phase === 'body') await new Promise(resolve => setImmediate(resolve));
      caller.abort(reason);
      const outcome = await bounded(operation, 'caller cancellation');
      assert.equal(outcome.kind, 'rejected');
      assert.equal(outcome.error, reason, 'retain the caller AbortSignal reason through both fetch and JSON parsing');
      assert.equal(requests.length, 1);
    });
  });
}

for (const scenario of [
  { name: 'normal JSON', status: 200, body: { code: 1, msg: 'ok', data: { fixture: true } } },
  { name: '503 business gate', status: 503, body: { code: 'PROVIDER_NOT_READY', msg: 'Synthetic provider gate', data: { retryAllowed: false } } },
  { name: '503 maintenance', status: 503, body: { maintenance: true, msg: 'Synthetic maintenance' }, expected: { code: 0, msg: 'Synthetic maintenance', maintenance: true } },
]) {
  test(`deadline preserves ${scenario.name} response protocol`, { timeout: 5_000 }, async () => {
    await withHttpApi((_request, response) => {
      response.writeHead(scenario.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(scenario.body));
    }, async ({ apiModule, requests, fetchCalls }) => {
      const result = await bounded(apiModule.apiFetch('/api/json-protocol', { timeoutMs: 500 }), scenario.name);
      assert.deepEqual(JSON.parse(JSON.stringify(result)), scenario.expected || scenario.body);
      assert.equal(requests.length, 1);
      assert.equal(fetchCalls.length, 1);
    });
  });
}

test('POST keeps waiting beyond the GET default deadline and is sent exactly once', { timeout: 5_000 }, async () => {
  const deadlines = new Map();
  let clockNow = 0;
  let timerId = 0;
  const clock = {
    setTimeout(callback, milliseconds) {
      const id = ++timerId;
      deadlines.set(id, { at: clockNow + milliseconds, callback });
      return id;
    },
    clearTimeout(id) { deadlines.delete(id); },
  };
  const advance = milliseconds => {
    clockNow += milliseconds;
    for (const [id, entry] of [...deadlines]) {
      if (entry.at > clockNow) continue;
      deadlines.delete(id);
      entry.callback();
    }
  };
  const postReceived = deferred();
  const getReceived = deferred();
  let postResponse;
  await withHttpApi((request, response) => {
    if (request.method === 'POST') { postResponse = response; postReceived.resolve(); }
    else getReceived.resolve();
  }, async ({ apiModule, requests, fetchCalls }) => {
    let postOutcome = { kind: 'pending' };
    const posting = capture(apiModule.api.post('/api/write-default', { fixture: true }))
      .then(outcome => { postOutcome = outcome; return outcome; });
    const reading = capture(apiModule.api.get('/api/read-default'));
    await bounded(Promise.all([postReceived.promise, getReceived.promise]), 'both real HTTP requests received');
    advance(apiModule.API_GET_TIMEOUT_MS + 1);
    const readOutcome = await bounded(reading, 'GET default deadline control');
    assert.equal(readOutcome.kind, 'rejected');
    assert.equal(readOutcome.error.code, 'API_REQUEST_TIMEOUT');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(postOutcome.kind, 'pending', 'the GET default deadline must not interrupt a write');
    postResponse.writeHead(200, { 'content-type': 'application/json' });
    postResponse.end(JSON.stringify({ code: 1, msg: 'ok', data: { written: true } }));
    const completed = await bounded(posting, 'original POST response');
    assert.equal(completed.kind, 'fulfilled');
    assert.equal(completed.value.data.written, true);
    assert.deepEqual(requests.filter(request => request.method === 'POST'), [{ method: 'POST', url: '/api/write-default' }]);
    assert.equal(fetchCalls.filter(call => call.method === 'POST').length, 1);
    assert.equal(deadlines.size, 0);
  }, { clock });
});

for (const method of ['GET', 'POST']) {
  test(`an already cancelled ${method} sends no HTTP request`, { timeout: 5_000 }, async () => {
    await withHttpApi((_request, response) => response.end('{}'), async ({ apiModule, requests, fetchCalls }) => {
      const caller = new AbortController();
      const reason = new DOMException('Synthetic pre-dispatch cancellation', 'AbortError');
      caller.abort(reason);
      const outcome = await capture(apiModule.apiFetch('/api/pre-cancelled', { method, signal: caller.signal }));
      assert.equal(outcome.kind, 'rejected');
      assert.equal(outcome.error, reason);
      assert.equal(fetchCalls.length, 0);
      assert.equal(requests.length, 0);
    });
  });
}

test('a cancelled request receiving a late real 401 cannot clear the replacement session', { timeout: 5_000 }, async () => {
  const tokenKey = 'sserp.token';
  const storage = new Map([[tokenKey, 'SYNTHETIC_OLD_SESSION_NOT_A_CREDENTIAL']]);
  const removed = [];
  let window;
  let lateResponse;
  await withHttpApi((_request, response) => { lateResponse = response; }, async ({ apiModule, received, headersReceived, requests, fetchCalls }) => {
    const caller = new AbortController();
    const reason = new DOMException('Synthetic old screen closed', 'AbortError');
    const reading = capture(apiModule.api.get('/api/late-session-response', { timeoutMs: 1_000, signal: caller.signal }));
    await bounded(received, 'late response request readiness');
    caller.abort(reason);
    const cancelled = await bounded(reading, 'old caller cancellation');
    assert.equal(cancelled.kind, 'rejected');
    assert.equal(cancelled.error, reason);
    storage.set(tokenKey, 'SYNTHETIC_REPLACEMENT_SESSION_NOT_A_CREDENTIAL');
    window.location.pathname = '/replacement-session';
    const replacementHref = window.location.origin + '/replacement-session';
    window.location.href = replacementHref;
    lateResponse.writeHead(401, { 'content-type': 'application/json' });
    lateResponse.end(JSON.stringify({ code: 0, msg: 'Synthetic expired old session' }));
    await bounded(headersReceived, 'late 401 received from real HTTP');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(storage.get(tokenKey), 'SYNTHETIC_REPLACEMENT_SESSION_NOT_A_CREDENTIAL');
    assert.deepEqual(removed, [], 'the stale 401 must not clear any session state');
    assert.equal(window.location.href, replacementHref, 'the stale 401 must not navigate the new screen');
    assert.equal(requests.length, 1);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].signal.aborted, true, 'only the test transport ignores the already-aborted request signal');
  }, {
    ignoreTransportAbort: true,
    createWindow(origin) {
      window = {
        location: { hostname: '127.0.0.1', protocol: 'http:', origin, pathname: '/old-session', search: '', href: origin + '/old-session' },
        localStorage: {
          getItem: key => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: key => { removed.push(key); storage.delete(key); },
        },
      };
      return window;
    },
  });
});
