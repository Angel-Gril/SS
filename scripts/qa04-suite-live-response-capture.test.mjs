import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './qa04-suite-live-response-capture.mjs';

test('browser auto-attach uses params.sessionId, and enables Network on its own targets', async () => {
  const extensionId = 'a'.repeat(32);
  const targets = [
    { targetId: 'worker', type: 'service_worker', url: `chrome-extension://${extensionId}/background/service-worker.js`, attached: true },
    { targetId: 'frame', type: 'iframe', url: `chrome-extension://${extensionId}/pages/precision-workbench.html`, attached: true },
  ];
  const enabled = [];
  const originalFetch = globalThis.fetch, originalWebSocket = globalThis.WebSocket;
  class Socket extends EventTarget {
    constructor() { super(); setImmediate(() => this.dispatchEvent(new Event('open'))); }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.method === 'Target.setAutoAttach') {
        for (const targetInfo of targets) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
          method: 'Target.attachedToTarget', params: { sessionId: `${targetInfo.targetId}-session`, targetInfo },
        }) }));
      }
      if (message.method === 'Network.enable') enabled.push(message.sessionId);
      const result = message.method === 'Target.getTargets' ? { targetInfos: targets } : {};
      setImmediate(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, result }) })));
    }
    close() {}
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa04-cdp-attach-test-'));
  const output = path.join(directory, 'capture.json');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9481/devtools/browser/test-browser',
  }) });
  globalThis.WebSocket = Socket;
  try {
    assert.equal(await main(['--cdp-url', 'http://127.0.0.1:9481', '--extension-id', extensionId,
      '--output', output, '--minimum-reviews', '0', '--minimum-assignments', '0']), 0);
    assert.deepEqual(enabled.sort(), ['frame-session', 'worker-session']);
    const receipt = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(receipt.targetDiagnostics.filter(item => item.phase === 'attached').length, 2);
    assert.equal(receipt.errors.length, 0);
  } finally {
    globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket;
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.rmdirSync(directory);
  }
});

test('normal capture cannot succeed with reviews and assignments but no START/CONTINUE originals', async () => {
  const extensionId = 'a'.repeat(32), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa04-incomplete-test-'));
  const output = path.join(directory, 'capture.json');
  const originalFetch = globalThis.fetch, originalWebSocket = globalThis.WebSocket;
  const targetInfos = [
    { targetId: 'worker', type: 'service_worker', url: `chrome-extension://${extensionId}/background/service-worker.js`, attached: true },
    { targetId: 'frame', type: 'iframe', url: `chrome-extension://${extensionId}/pages/precision-workbench.html`, attached: true },
  ];
  const bodies = new Map();
  class Socket extends EventTarget {
    constructor() { super(); setImmediate(() => this.dispatchEvent(new Event('open'))); }
    emit(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.method === 'Target.setAutoAttach') {
        for (const targetInfo of targetInfos) this.emit({ method: 'Target.attachedToTarget', params: {
          sessionId: `${targetInfo.targetId}-session`, targetInfo,
        } });
        setTimeout(() => {
          for (let index = 0; index < 4; index++) {
            const requestId = `request-${index}`, assignment = index >= 2;
            const url = assignment
              ? 'https://ss-erp.com/api/extension-device/source-workbench/ai-image-suite/listing-assignments'
              : 'https://ss-erp.com/api/extension-device/media-workflows/execute';
            bodies.set(requestId, JSON.stringify({ code: 1, data: { replayed: index === 3 } }));
            this.emit({ sessionId: 'worker-session', method: 'Network.requestWillBeSent', params: { requestId,
              request: { method: 'POST', url, postData: JSON.stringify(assignment ? { idempotencyKey: 'same-assignment' }
                : { operation: 'MEDIA_REVIEW', command: { action: 'REVIEW_SLOT' } }) } } });
            this.emit({ sessionId: 'worker-session', method: 'Network.responseReceived', params: { requestId, response: { status: 200, url } } });
            this.emit({ sessionId: 'worker-session', method: 'Network.loadingFinished', params: { requestId } });
          }
        }, 150);
      }
      const result = message.method === 'Target.getTargets' ? { targetInfos }
        : message.method === 'Network.getResponseBody' ? { body: bodies.get(message.params.requestId) } : {};
      setImmediate(() => this.emit({ id: message.id, result }));
    }
    close() {}
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9481/devtools/browser/test-browser' }) });
  globalThis.WebSocket = Socket;
  try {
    await assert.rejects(main(['--cdp-url', 'http://127.0.0.1:9481', '--extension-id', extensionId,
      '--output', output, '--timeout-ms', '5000']), /START|CONTINUE/u);
    const evidence = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.complete, false);
    assert.equal(evidence.reviews.length, 2);
    assert.equal(evidence.assignments.length, 2);
  } finally {
    globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket;
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.rmdirSync(directory);
  }
});

for (const failure of ['before-headers', 'no-response']) test('six complete mutations cannot hide an extra ' + failure + ' request', async () => {
  const extensionId = 'a'.repeat(32), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa04-unresolved-test-'));
  const output = path.join(directory, 'capture.json');
  const originalFetch = globalThis.fetch, originalWebSocket = globalThis.WebSocket;
  const targetInfos = [
    { targetId: 'worker', type: 'service_worker', url: `chrome-extension://${extensionId}/background/service-worker.js`, attached: true },
    { targetId: 'frame', type: 'iframe', url: `chrome-extension://${extensionId}/pages/precision-workbench.html`, attached: true },
  ];
  const bodies = new Map();
  class Socket extends EventTarget {
    constructor() { super(); setImmediate(() => this.dispatchEvent(new Event('open'))); }
    emit(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.method === 'Target.setAutoAttach') {
        for (const targetInfo of targetInfos) this.emit({ method: 'Target.attachedToTarget', params: {
          sessionId: `${targetInfo.targetId}-session`, targetInfo,
        } });
        setTimeout(() => {
          const assignmentUrl = 'https://ss-erp.com/api/extension-device/source-workbench/ai-image-suite/listing-assignments';
          this.emit({ sessionId: 'worker-session', method: 'Network.requestWillBeSent', params: { requestId: 'unresolved',
            request: { method: 'POST', url: assignmentUrl, postData: JSON.stringify({
              idempotencyKey: 'first-assignment-unknown-outcome', grantToken: 'QA_GRANT_SENTINEL',
            }) } } });
          if (failure === 'before-headers') this.emit({ sessionId: 'worker-session', method: 'Network.loadingFailed',
            params: { requestId: 'unresolved', errorText: 'net::ERR_CONNECTION_RESET' } });
          for (let index = 0; index < 6; index++) {
            const requestId = `complete-${index}`, assignment = index >= 4;
            const url = assignment ? assignmentUrl : 'https://ss-erp.com/api/extension-device/media-workflows/execute';
            const body = assignment ? { idempotencyKey: 'completed-assignment' }
              : index < 2 ? { command: { version: 'extension-ai-image-suite-execute-command/v1', action: index ? 'CONTINUE' : 'START' } }
                : { operation: 'MEDIA_REVIEW', command: { action: 'REVIEW_SLOT' } };
            bodies.set(requestId, JSON.stringify({ code: 1, data: { replayed: index === 5 } }));
            this.emit({ sessionId: 'worker-session', method: 'Network.requestWillBeSent', params: { requestId,
              request: { method: 'POST', url, postData: JSON.stringify(body) } } });
            this.emit({ sessionId: 'worker-session', method: 'Network.responseReceived', params: { requestId, response: { status: 200, url } } });
            this.emit({ sessionId: 'worker-session', method: 'Network.loadingFinished', params: { requestId } });
          }
        }, 150);
      }
      const result = message.method === 'Target.getTargets' ? { targetInfos }
        : message.method === 'Network.getResponseBody' ? { body: bodies.get(message.params.requestId) } : {};
      setImmediate(() => this.emit({ id: message.id, result }));
    }
    close() {}
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9481/devtools/browser/test-browser' }) });
  globalThis.WebSocket = Socket;
  try {
    await assert.rejects(main(['--cdp-url', 'http://127.0.0.1:9481', '--extension-id', extensionId,
      '--output', output, '--timeout-ms', '5000']), /incomplete/u);
    const evidence = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(evidence.complete, false);
    assert.equal(evidence.requests.length, 7);
    assert.equal(evidence.suite.length, 2);
    assert.equal(evidence.reviews.length, 2);
    assert.equal(evidence.assignments.length, 2);
    assert.equal(evidence.unresolvedRequests.length, 1);
    assert.equal(evidence.unresolvedRequests[0].body.idempotencyKey, 'first-assignment-unknown-outcome');
    assert.ok(!JSON.stringify(evidence).includes('QA_GRANT_SENTINEL'));
    if (failure === 'before-headers') assert.ok(evidence.errors.length > 0);
  } finally {
    globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket;
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.rmdirSync(directory);
  }
});
