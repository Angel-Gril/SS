#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  assertExclusiveTargetOwnership,
  attachSuiteMutationNetworkCapture,
} from './qa04-suite-transport-capture.mjs';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params, message.sessionId);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) || []), listener]);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
    this.socket.close();
  }
}

function parseOptions(args) {
  const values = new Map();
  if (!Array.isArray(args) || args.length % 2 !== 0) throw new Error('options must be pairs');
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!['--cdp-url', '--extension-id', '--output', '--timeout-ms',
      '--minimum-reviews', '--minimum-assignments'].includes(key)
      || !value || value.startsWith('--') || values.has(key)) throw new Error('invalid capture options');
    values.set(key, value);
  }
  for (const key of ['--cdp-url', '--extension-id', '--output']) {
    if (!values.has(key)) throw new Error(`${key} is required`);
  }
  const cdpUrl = new URL(values.get('--cdp-url'));
  if (cdpUrl.protocol !== 'http:' || cdpUrl.hostname !== '127.0.0.1'
    || cdpUrl.pathname !== '/' || cdpUrl.search || cdpUrl.hash) throw new Error('cdp-url must be loopback origin');
  const extensionId = values.get('--extension-id');
  if (!/^[a-p]{32}$/u.test(extensionId)) throw new Error('extension-id is invalid');
  const output = path.resolve(values.get('--output'));
  if (!path.isAbsolute(output) || existsSync(output) || path.extname(output) !== '.json') {
    throw new Error('output must be a new absolute JSON file');
  }
  const timeoutMs = Number(values.get('--timeout-ms') || 120_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) {
    throw new Error('timeout-ms is invalid');
  }
  const minimumReviews = Number(values.get('--minimum-reviews') || 2);
  const minimumAssignments = Number(values.get('--minimum-assignments') || 2);
  if (![minimumReviews, minimumAssignments].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 8)) {
    throw new Error('minimum mutation counts are invalid');
  }
  return { cdpUrl: cdpUrl.origin, extensionId, output, timeoutMs, minimumReviews, minimumAssignments };
}

async function browserWebSocket(cdpUrl) {
  const response = await fetch(`${cdpUrl}/json/version`, {
    headers: { Accept: 'application/json' }, redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('CDP version endpoint failed');
  const value = await response.json();
  const socket = new URL(value.webSocketDebuggerUrl);
  if (socket.protocol !== 'ws:' || socket.hostname !== '127.0.0.1'
    || socket.username || socket.password || socket.search || socket.hash
    || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/u.test(socket.pathname)) {
    throw new Error('CDP browser WebSocket is invalid');
  }
  return socket.href;
}

function targetMatches(target, extensionId) {
  if (!target || !target.targetId) return false;
  if (target.type === 'service_worker') {
    return target.url === `chrome-extension://${extensionId}/background/service-worker.js`;
  }
  return target.type === 'iframe'
    && target.url === `chrome-extension://${extensionId}/pages/precision-workbench.html`;
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node scripts/qa04-suite-live-response-capture.mjs --cdp-url http://127.0.0.1:9468 --extension-id <id> --output <private-new.json> [--timeout-ms 120000]\n');
    return 0;
  }
  const options = parseOptions(args);
  const cdp = await Cdp.connect(await browserWebSocket(options.cdpUrl));
  // Only sessions acquired by this browser connection may supply evidence.
  const sessions = new Set();
  const ownedTargets = new Map();
  const targetDiagnostics = [];
  const attach = async (targetId, existingSession = '') => {
    const sessionId = existingSession || (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    if (!sessionId || sessions.has(sessionId)) return sessionId;
    ownedTargets.set(targetId, sessionId);
    sessions.add(sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);
    return sessionId;
  };
  cdp.on('Target.attachedToTarget', event => {
    const sessionId = event?.sessionId;
    if (!targetMatches(event?.targetInfo, options.extensionId) || !sessionId) return;
    targetDiagnostics.push({
      phase: 'attached',
      targetId: event.targetInfo.targetId,
      type: event.targetInfo.type,
      url: event.targetInfo.url,
      sessionId,
      at: new Date().toISOString(),
    });
    void attach(event.targetInfo.targetId, sessionId).catch(() => {});
  });
  cdp.on('Target.detachedFromTarget', event => {
    const sessionId = event?.sessionId;
    if (!sessionId) return;
    for (const [targetId, ownedSession] of ownedTargets.entries()) {
      if (ownedSession !== sessionId) continue;
      ownedTargets.delete(targetId);
      sessions.delete(sessionId);
      targetDiagnostics.push({ phase: 'detached', targetId, sessionId, at: new Date().toISOString() });
    }
  });
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
    for (const target of targets) {
      if (!targetMatches(target, options.extensionId)) continue;
      if (assertExclusiveTargetOwnership(target, ownedTargets) === 'owned') {
        continue;
      }
      try { await attach(target.targetId); }
      catch (error) {
        targetDiagnostics.push({ phase: 'attach-error', targetId: target.targetId,
          type: target.type, url: target.url,
          error: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString() });
      }
    }
    const attachedTypes = new Set(targets.filter(target => targetMatches(target, options.extensionId) && ownedTargets.has(target.targetId))
      .map(target => target.type));
    if (attachedTypes.has('service_worker') && attachedTypes.has('iframe')) break;
    await pause(100);
  }
  const finalTargets = (await cdp.send('Target.getTargets')).targetInfos || [];
  const missing = ['service_worker', 'iframe'].filter(type => !finalTargets.some(target =>
    targetMatches(target, options.extensionId) && target.type === type && ownedTargets.has(target.targetId)));
  if (missing.length) {
    cdp.close();
    throw new Error(`exclusive extension target attach incomplete: ${missing.join(',')}; diagnostics=${JSON.stringify(targetDiagnostics)}`);
  }
  const capture = attachSuiteMutationNetworkCapture(cdp, { sessions });
  const requiresLifecycle = options.minimumReviews > 0 || options.minimumAssignments > 0;
  const missingLifecycle = snapshot => requiresLifecycle ? ['START', 'CONTINUE'].filter(action =>
    !snapshot.responses.some(pair => pair.request.kind === 'suite' && pair.request.body?.command?.action === action
      && pair.response.status >= 200 && pair.response.status < 300 && pair.response.body?.code === 1)) : [];
  const captureDeadline = Date.now() + options.timeoutMs;
  while (Date.now() < captureDeadline) {
    const snapshot = capture.snapshot();
    const reviews = snapshot.responses.filter(value => value.request.kind === 'review');
    const assignments = snapshot.responses.filter(value => value.request.kind === 'assignment');
    if (reviews.length >= options.minimumReviews && assignments.length >= options.minimumAssignments
      && !missingLifecycle(snapshot).length
      && (snapshot.unresolvedRequests.length === 0 || snapshot.errors.length > 0)) break;
    await pause(100);
  }
  const snapshot = capture.snapshot();
  const reviews = snapshot.responses.filter(value => value.request.kind === 'review');
  const assignments = snapshot.responses.filter(value => value.request.kind === 'assignment');
  const suite = snapshot.responses.filter(value => value.request.kind === 'suite');
  const missingActions = missingLifecycle(snapshot);
  const complete = reviews.length >= options.minimumReviews && assignments.length >= options.minimumAssignments
    && missingActions.length === 0 && snapshot.errors.length === 0 && snapshot.unresolvedRequests.length === 0;
  const artifact = {
    schemaVersion: 1,
    kind: 'SS_ERP_QA04_SUITE_TRANSPORT_CAPTURE',
    complete,
    missingActions,
    observedAt: new Date().toISOString(),
    extensionId: options.extensionId,
    requests: snapshot.requests,
    unresolvedRequests: snapshot.unresolvedRequests,
    suite,
    reviews,
    assignments,
    errors: snapshot.errors,
    targetDiagnostics,
    captureSha256: createHash('sha256').update(JSON.stringify({ suite, reviews, assignments })).digest('hex'),
  };
  writeFileSync(options.output, JSON.stringify(artifact, null, 2), { mode: 0o600, flag: 'wx' });
  cdp.close();
  if (!complete) {
    throw new Error(`suite mutation capture incomplete: reviews=${reviews.length}, assignments=${assignments.length}, missing=${missingActions.join(',')}, unresolved=${snapshot.unresolvedRequests.length}, errors=${snapshot.errors.length}; partial evidence preserved at ${options.output}`);
  }
  process.stdout.write(JSON.stringify({ status: 'WRITTEN', output: options.output, reviews: reviews.length, assignments: assignments.length }) + '\n');
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

export { main, parseOptions, targetMatches, Cdp, browserWebSocket };
