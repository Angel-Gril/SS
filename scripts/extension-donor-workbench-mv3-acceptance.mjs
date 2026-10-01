#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
const PRODUCT_URL = 'https://detail.1688.com/offer/990499606077.html';
const NEGATIVE_PRODUCT_URL = 'https://detail.1688.com/offer/990499606078.html';
const FEATURE_KEY = 'ss-erp:donor-workbench-preview-enabled';
const ALLOWLIST_KEY = 'ss-erp:donor-workbench-preview-allowlist:v1';
const ALLOWED_SOURCE_KEY = '1688:990499606077';
const NEGATIVE_SOURCE_KEY = '1688:990499606078';
export function selectAcceptanceMode(argumentsList) {
  const precisionPreview = argumentsList.includes('--precision');
  const mediaChannelOnly = argumentsList.includes('--probe-media-channel-only');
  const mediaChannelProbe = mediaChannelOnly || argumentsList.includes('--probe-media-channel');
  assert.ok(!mediaChannelProbe || precisionPreview, 'media channel probing requires --precision');
  return { precisionPreview, mediaChannelProbe, mediaChannelOnly };
}
const {
  precisionPreview: PRECISION_PREVIEW,
  mediaChannelProbe: PROBE_MEDIA_CHANNEL,
  mediaChannelOnly: MEDIA_CHANNEL_ONLY,
} = selectAcceptanceMode(process.argv.slice(2));
const WORKSPACE_PAGE = PRECISION_PREVIEW ? 'pages/precision-workbench.html' : 'pages/source-workbench-shell.html';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await pause(75);
  }
  throw new Error(`Timed out: ${label}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
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
      const timeout = setTimeout(() => reject(new Error('CDP connection timeout')), 5_000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  assert.ok(executable, 'Independent Chromium is required');
  return executable;
}

async function terminateProfileChromium(profile) {
  const script = [
    '$profilePath = $args[0]',
    "$processes = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*\\chrome.exe' -and ([string]$_.CommandLine).Contains($profilePath) }",
    '$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
  ].join('; ');
  const process = spawn('powershell.exe', ['-NoProfile', '-Command', script, profile], {
    windowsHide: true, stdio: 'ignore',
  });
  await Promise.race([new Promise((resolve) => process.once('exit', resolve)), pause(5_000)]);
}

function productHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <title>Synthetic storage organizer - 1688</title>
    <meta property="og:title" content="Synthetic storage organizer">
    <meta property="og:image" content="https://detail.1688.com/media/main.png">
    </head><body>
    <main><h1 class="title-text">Synthetic storage organizer</h1>
    ${PRECISION_PREVIEW ? `<script type="application/json">${JSON.stringify({ skuModel: {
      skuProps: [{ prop: '规格', value: Array.from({ length: 16 }, (_, index) => ({ name: 'White ' + index })) }],
      skuInfoMap: Object.fromEntries(Array.from({ length: 16 }, (_, index) => ['White ' + index, { skuId: 'native-' + index, price: 12.8, canBookCount: index === 0 ? 0 : 100 }])),
    } })}</script>` : ''}
    <div class="price">12.80</div>
    <ul class="offer-attr-list"><li class="offer-attr-item">材质：PP</li><li class="offer-attr-item">颜色：白色</li></ul>
    <img class="detail-gallery-img" width="320" height="320" src="https://detail.1688.com/media/main.png" alt="storage organizer">
    <div class="sku-item" title="White / Small">White / Small</div>
    <div class="sku-item" title="Green / Large">Green / Large</div>
    </main></body></html>`;
}

async function extensionTreeSha256(root) {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await walk(root);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed`);
  return String(result.stdout || '').trim();
}

export function validateMediaChannelDelivery(value, expected) {
  const keys = ['probeId', 'direction', 'from', 'to', 'mimeType', 'byteLength', 'sha256', 'receivedAsBlob'];
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
    && value.receivedAsBlob === true && Number.isSafeInteger(value.byteLength) && value.byteLength > 0
    && /^[a-f0-9]{64}$/u.test(value.sha256)
    && keys.filter((key) => key !== 'receivedAsBlob').every((key) => value[key] === expected[key]));
}

export function selectMediaProbeWorkerContext(contexts, expectedWorkerUrl) {
  const workerUrl = new URL(expectedWorkerUrl);
  const expectedOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
  return contexts.find((context) => (context.origin === expectedOrigin || context.origin === expectedWorkerUrl)
    && (context.auxData?.isDefault === true || contexts.length === 1)) || null;
}

async function probeMediaChannel(cdp, options) {
  const probeId = randomBytes(16).toString('hex');
  const channelName = `ss-erp:precision-media-probe:${probeId}`;
  const traceKey = `__ssErpPrecisionMediaProbe_${probeId}`;
  const expectedOrigin = `chrome-extension://${options.extensionId}`;
  const expectedIframeUrl = `${expectedOrigin}/pages/precision-workbench.html`;
  const expectedWorkerUrl = `${expectedOrigin}/background/service-worker.js`;
  const blobBytes = await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon16.png'));
  const mimeType = 'image/png';
  assert.ok(blobBytes.length > 0 && blobBytes.length <= 32 * 1024, 'probe requires one small repository PNG');
  const sha256 = createHash('sha256').update(blobBytes).digest('hex');
  const receipt = {
    contractVersion: 'ss-erp-precision-media-channel-probe/v1', status: 'not_verified', ok: false,
    transport: 'BroadcastChannel', startedAt: new Date().toISOString(), channelName,
    blob: { mimeType, byteLength: blobBytes.length, sha256 }, contexts: null,
    directions: { iframeToWorker: null, workerToIframe: null }, trace: null, cleanup: false,
    ...(options.frameState ? { frameState: options.frameState } : {}),
  };
  const endpoints = [];
  const evaluateIn = async (endpoint, expression) => {
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression, contextId: endpoint.contextId, awaitPromise: true, returnByValue: true,
    }, endpoint.sessionId);
    if (evaluated.exceptionDetails) {
      throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text);
    }
    return evaluated.result.value;
  };
  try {
    await cdp.send('Page.enable', {}, options.iframeSession);
    await cdp.send('Runtime.enable', {}, options.iframeSession);
    const [sourceTree, iframeTree] = await Promise.all([
      cdp.send('Page.getFrameTree', {}, options.pageSession),
      cdp.send('Page.getFrameTree', {}, options.iframeSession),
    ]);
    const sourceFrame = sourceTree.frameTree.frame;
    const iframeFrame = iframeTree.frameTree.frame;
    receipt.observedContexts = {
      iframe: options.executionContexts.get(options.iframeSession) || [],
      worker: options.executionContexts.get(options.workerSession) || [],
    };
    assert.equal(sourceFrame.url, PRODUCT_URL);
    assert.equal(iframeFrame.url, expectedIframeUrl);
    assert.equal(iframeFrame.parentId, sourceFrame.id);
    const iframeContext = (options.executionContexts.get(options.iframeSession) || [])
      .find((context) => context.auxData?.isDefault === true && context.auxData.frameId === iframeFrame.id
        && context.origin === expectedOrigin);
    assert.ok(iframeContext, 'probe requires the exact extension iframe default execution context');
    const workerContexts = options.executionContexts.get(options.workerSession) || [];
    const workerContext = selectMediaProbeWorkerContext(workerContexts, expectedWorkerUrl);
    assert.ok(workerContext, 'probe requires the real extension service worker execution context');
    endpoints.push(
      { role: 'IFRAME', sessionId: options.iframeSession, contextId: iframeContext.id },
      { role: 'WORKER', sessionId: options.workerSession, contextId: workerContext.id },
    );
    const [iframeIdentity, workerIdentity] = await Promise.all(endpoints.map((endpoint) => evaluateIn(endpoint,
      '({url:location.href,origin:location.origin,extensionId:chrome.runtime.id,'
        + 'isEmbedded:typeof window!=="undefined"&&window.top!==window,'
        + 'isServiceWorker:typeof ServiceWorkerGlobalScope!=="undefined"&&globalThis instanceof ServiceWorkerGlobalScope})')));
    assert.deepEqual(iframeIdentity, {
      url: expectedIframeUrl, origin: expectedOrigin, extensionId: options.extensionId,
      isEmbedded: true, isServiceWorker: false,
    });
    assert.deepEqual(workerIdentity, {
      url: expectedWorkerUrl, origin: expectedOrigin, extensionId: options.extensionId,
      isEmbedded: false, isServiceWorker: true,
    });
    receipt.contexts = {
      iframe: { targetId: options.iframeTargetId, frameId: iframeFrame.id, contextId: iframeContext.id, ...iframeIdentity },
      worker: { targetId: options.workerTargetId, contextId: workerContext.id, ...workerIdentity },
      source: { frameId: sourceFrame.id, url: sourceFrame.url },
    };
    await Promise.all(endpoints.map((endpoint) => evaluateIn(endpoint, `(() => {
      const role=${JSON.stringify(endpoint.role)};
      const state={role,channel:new BroadcastChannel(${JSON.stringify(channelName)}),sent:[],received:[],errors:[]};
      globalThis[${JSON.stringify(traceKey)}]=state;
      state.channel.onmessage=async(event)=>{
        try {
          const packet=event.data;
          if(!packet||packet.probeId!==${JSON.stringify(probeId)}||packet.to!==role||!(packet.image instanceof Blob)) {
            state.errors.push('PROBE_PACKET_INVALID');return;
          }
          const bytes=await packet.image.arrayBuffer();
          const digest=await crypto.subtle.digest('SHA-256',bytes);
          state.received.push({probeId:packet.probeId,direction:packet.direction,from:packet.from,to:role,
            mimeType:packet.image.type,byteLength:bytes.byteLength,
            sha256:Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join(''),receivedAsBlob:true});
        }catch(error){state.errors.push(error&&error.name||'PROBE_RECEIVE_FAILED');}
      };
      return {ready:true,role};
    })()`)));
    await Promise.all(endpoints.map((endpoint) => evaluateIn(endpoint, `(() => {
      const state=globalThis[${JSON.stringify(traceKey)}];
      const to=state.role==='IFRAME'?'WORKER':'IFRAME';
      const direction=state.role+'_TO_'+to;
      const image=new Blob([Uint8Array.from(${JSON.stringify(Array.from(blobBytes))})],{type:${JSON.stringify(mimeType)}});
      state.channel.postMessage({probeId:${JSON.stringify(probeId)},direction,from:state.role,to,image});
      state.sent.push({direction,mimeType:image.type,byteLength:image.size});
      return {sent:true,direction};
    })()`)));
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const states = await Promise.all(endpoints.map((endpoint) => evaluateIn(endpoint, `(() => {
        const state=globalThis[${JSON.stringify(traceKey)}];
        return state?{role:state.role,sent:state.sent,received:state.received,errors:state.errors}:null;
      })()`)));
      receipt.trace = states;
      if (states.some((state) => !state || state.errors.length)) {
        receipt.status = 'failed';
        receipt.error = 'MEDIA_CHANNEL_RECEIVE_FAILED';
        break;
      }
      const iframePacket = states[0].received[0];
      const workerPacket = states[1].received[0];
      if (iframePacket) receipt.directions.workerToIframe = iframePacket;
      if (workerPacket) receipt.directions.iframeToWorker = workerPacket;
      if (iframePacket && workerPacket) {
        const expected = { probeId, mimeType, byteLength: blobBytes.length, sha256 };
        receipt.ok = states.every((state) => state.received.length === 1)
          && validateMediaChannelDelivery(iframePacket, { ...expected, direction: 'WORKER_TO_IFRAME', from: 'WORKER', to: 'IFRAME' })
          && validateMediaChannelDelivery(workerPacket, { ...expected, direction: 'IFRAME_TO_WORKER', from: 'IFRAME', to: 'WORKER' });
        receipt.status = receipt.ok ? 'passed' : 'failed';
        if (!receipt.ok) receipt.error = 'MEDIA_CHANNEL_DELIVERY_MISMATCH';
        break;
      }
      await pause(75);
    }
    if (receipt.status === 'not_verified') receipt.error = 'MEDIA_CHANNEL_DELIVERY_TIMEOUT';
  } catch (error) {
    receipt.status = 'failed';
    receipt.error = error.message;
  } finally {
    const closed = await Promise.allSettled(endpoints.map((endpoint) => evaluateIn(endpoint, `(() => {
      const state=globalThis[${JSON.stringify(traceKey)}];
      if(state){state.channel.onmessage=null;state.channel.close();}
      delete globalThis[${JSON.stringify(traceKey)}];
      return !Object.hasOwn(globalThis,${JSON.stringify(traceKey)});
    })()`)));
    receipt.cleanup = closed.every((result) => result.status === 'fulfilled' && result.value === true);
    if (!receipt.cleanup) { receipt.ok = false; receipt.status = 'failed'; receipt.cleanupError = 'MEDIA_CHANNEL_CLEANUP_FAILED'; }
    receipt.finishedAt = new Date().toISOString();
  }
  return receipt;
}

async function run() {
  assert.ok(!PROBE_MEDIA_CHANNEL || PRECISION_PREVIEW, '--probe-media-channel requires --precision');
  const artifacts = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-mv3-evidence-'));
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-mv3-profile-')));
  const sourceCommit = gitOutput(['rev-parse', 'HEAD']);
  const worktreeClean = gitOutput(['status', '--short']) === '';
  if (process.argv.includes('--require-clean')) assert.equal(worktreeClean, true, 'canary requires a clean worktree');
  const summary = {
    contractVersion: MEDIA_CHANNEL_ONLY
      ? 'ss-erp-precision-media-channel-only-acceptance/v1'
      : 'ss-erp-donor-workbench-mv3-acceptance/v2', ok: false,
    artifacts, receipt: path.join(artifacts, 'summary.json'),
    screenshot: null, extensionId: null, sourceTitle: null,
    sourceCommit, extensionTreeSha256: await extensionTreeSha256(EXTENSION_ROOT), worktreeClean,
    allowlistKey: ALLOWLIST_KEY, allowedSourceKey: ALLOWED_SOURCE_KEY,
    negativeSourceKey: NEGATIVE_SOURCE_KEY, negativeSourceBlocked: false,
    workspacePage: WORKSPACE_PAGE, precisionPreview: PRECISION_PREVIEW,
    ...(MEDIA_CHANNEL_ONLY ? { acceptanceScope: 'hidden-iframe-transport-only', uiOpenVerified: false } : {}),
    ...(PROBE_MEDIA_CHANNEL ? { mediaChannelProbe: { status: 'not_verified', ok: false } } : {}),
    pageErrors: [], blockedRequests: [], productionMutations: 0, providerRequests: 0, ozonRequests: 0,
  };
  let child;
  let cdp;
  try {
    child = spawn(chromeExecutable(), [
      '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      `--disable-extensions-except=${EXTENSION_ROOT}`, `--load-extension=${EXTENSION_ROOT}`,
      '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const activePort = await until(async () => {
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/u); } catch { return null; }
    }, 'MV3 Chromium startup');
    cdp = await Cdp.connect(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
    const executionContexts = new Map();
    if (PROBE_MEDIA_CHANNEL) {
      cdp.on('Runtime.executionContextCreated', (event, sessionId) => {
        const contexts = executionContexts.get(sessionId) || [];
        contexts.push(event.context);
        executionContexts.set(sessionId, contexts);
      });
      cdp.on('Runtime.executionContextDestroyed', (event, sessionId) => {
        executionContexts.set(sessionId, (executionContexts.get(sessionId) || [])
          .filter((context) => context.id !== event.executionContextId));
      });
      cdp.on('Runtime.executionContextsCleared', (_event, sessionId) => executionContexts.set(sessionId, []));
    }
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    const workerTargets = await until(async () => {
      const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
      const matching = targets.filter((item) => item.type === 'service_worker'
        && /^chrome-extension:\/\/[^/]+\/background\/service-worker\.js$/u.test(item.url));
      return matching.length ? matching : null;
    }, 'extension service worker');
    let workerTarget = null;
    let workerSession = null;
    const workerDiagnostics = [];
    for (const candidate of workerTargets) {
      const candidateSession = (await cdp.send('Target.attachToTarget', {
        targetId: candidate.targetId, flatten: true,
      })).sessionId;
      await cdp.send('Runtime.enable', {}, candidateSession);
      const identity = await until(async () => {
        try {
          const result = await cdp.send('Runtime.evaluate', {
            expression: '({ name: chrome.runtime?.getManifest?.().name || "", hasStorage: Boolean(chrome.storage?.local) })',
            returnByValue: true,
          }, candidateSession);
          return result.result?.value?.name ? result : null;
        } catch {
          return null;
        }
      }, `extension worker identity ${candidate.url}`, 5_000).catch(() => ({ result: { value: null } }));
      workerDiagnostics.push({ url: candidate.url, identity: identity.result?.value || null });
      if (identity.result?.value?.name === 'SS ERP - 松鼠跨境卖家助手'
        && identity.result.value.hasStorage === true) {
        workerTarget = candidate;
        workerSession = candidateSession;
        break;
      }
      await cdp.send('Target.detachFromTarget', { sessionId: candidateSession });
    }
    assert.ok(workerTarget && workerSession,
      `SS ERP extension service worker was not found: ${JSON.stringify(workerDiagnostics)}`);
    summary.extensionId = new URL(workerTarget.url).hostname;
    const workerEval = await cdp.send('Runtime.evaluate', {
      expression: `chrome.storage.local.set({
        ${JSON.stringify(FEATURE_KEY)}: true,
        'ss-erp:precision-workbench-preview-enabled': ${PRECISION_PREVIEW},
        ${JSON.stringify(ALLOWLIST_KEY)}: []
      })`,
      awaitPromise: true, returnByValue: true,
    }, workerSession);
    if (workerEval.exceptionDetails) {
      throw new Error('preview flag must be set in extension storage: '
        + (workerEval.exceptionDetails.exception?.description || workerEval.exceptionDetails.text));
    }

    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const pageSession = (await cdp.send('Target.attachToTarget', {
      targetId: target.targetId, flatten: true,
    })).sessionId;
    const send = (method, params = {}) => cdp.send(method, params, pageSession);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    cdp.on('Runtime.exceptionThrown', (event, sessionId) => {
      if (sessionId === pageSession) summary.pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text);
    });
    cdp.on('Fetch.requestPaused', (event, sessionId) => {
      if (!monitoredSessions.has(sessionId)) return;
      void (async () => {
        const reply = (method, params) => cdp.send(method, params, sessionId);
        const url = new URL(event.request.url);
        if (url.origin === 'https://detail.1688.com' && /^\/offer\/[^/]+\.html$/u.test(url.pathname)) {
          const body = Buffer.from(productHtml());
          await reply('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: body.toString('base64'),
          });
          return;
        }
        if (url.origin === 'https://detail.1688.com' && url.pathname === '/media/main.png') {
          const body = await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon128.png'));
          await reply('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: body.toString('base64'),
          });
          return;
        }
        if (url.origin === 'https://detail.1688.com' && url.pathname === '/favicon.ico') {
          await reply('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204 });
          return;
        }
        if (url.protocol === 'chrome-extension:' && url.hostname === summary.extensionId) {
          await reply('Fetch.continueRequest', { requestId: event.requestId });
          return;
        }
        summary.blockedRequests.push({ method: event.request.method, url: event.request.url });
        await reply('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      })().catch(async (error) => {
        summary.pageErrors.push(error.message);
        try { await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }, sessionId); } catch {}
      });
    });
    const monitoredSessions = new Set([pageSession]);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: PRODUCT_URL });
    await until(() => evaluate('document.readyState === "complete"'), 'synthetic source page load');
    await pause(300);
    assert.equal(await evaluate('!!document.querySelector("#ss-erp-donor-workbench-trigger")'), false,
      'feature flag alone must not bypass the exact product allowlist');
    const allowlistEval = await cdp.send('Runtime.evaluate', {
      expression: `chrome.storage.local.set({
        ${JSON.stringify(ALLOWLIST_KEY)}: [${JSON.stringify(ALLOWED_SOURCE_KEY)}]
      })`,
      awaitPromise: true, returnByValue: true,
    }, workerSession);
    if (allowlistEval.exceptionDetails) throw new Error('canary allowlist write failed');
    await until(() => evaluate('!!document.querySelector("#ss-erp-donor-workbench-trigger")'), 'donor workbench trigger injection');

    if (MEDIA_CHANNEL_ONLY) {
      const frameState = await evaluate(`(() => {
        const frame=document.querySelector('#ss-erp-donor-workbench-frame');
        return frame?{src:frame.src,hidden:frame.hidden,visible:frame.getClientRects().length>0,
          sourceUrl:location.href,sourceHost:location.hostname}:null;
      })()`);
      summary.installedFrame = frameState;
      assert.ok(frameState, 'transport-only probe requires the actual bridge-installed iframe');
      assert.equal(frameState.src, `chrome-extension://${summary.extensionId}/${WORKSPACE_PAGE}`);
      assert.equal(frameState.hidden, true);
      assert.equal(frameState.visible, false);
      assert.equal(frameState.sourceUrl, PRODUCT_URL);
      const hiddenTarget = await until(async () => {
        const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
        return targets.find((item) => item.type === 'iframe' && item.url === frameState.src);
      }, 'actual hidden precision iframe target');
      const hiddenSession = (await cdp.send('Target.attachToTarget', {
        targetId: hiddenTarget.targetId, flatten: true,
      })).sessionId;
      await cdp.send('Runtime.enable', {}, hiddenSession);
      await until(async () => {
        const loaded = await cdp.send('Runtime.evaluate', {
          expression: 'document.readyState === "complete"', returnByValue: true,
        }, hiddenSession);
        return loaded.result?.value === true;
      }, 'actual hidden precision iframe load');
      monitoredSessions.add(workerSession);
      monitoredSessions.add(hiddenSession);
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, workerSession);
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, hiddenSession);
      summary.mediaChannelProbe = await probeMediaChannel(cdp, {
        extensionId: summary.extensionId, executionContexts, frameState,
        workerSession, workerTargetId: workerTarget.targetId,
        iframeSession: hiddenSession, iframeTargetId: hiddenTarget.targetId, pageSession,
      });
      summary.browser = (await cdp.send('Browser.getVersion')).product;
      assert.deepEqual(summary.pageErrors, []);
      assert.deepEqual(summary.blockedRequests, []);
      assert.ok(summary.mediaChannelProbe.ok,
        `hidden precision media channel is ${summary.mediaChannelProbe.status}: ${summary.mediaChannelProbe.error || ''}`);
      summary.ok = true;
      return;
    }

    const point = await evaluate(`(() => { const n=document.querySelector('#ss-erp-donor-workbench-trigger'); const r=n.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await until(() => evaluate('document.querySelector("#ss-erp-donor-workbench-frame")?.hidden === false'), 'iframe open');

    const iframeTarget = await until(async () => {
      const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
      return targets.find((item) => item.type === 'iframe'
        && item.url === `chrome-extension://${summary.extensionId}/${WORKSPACE_PAGE}`);
    }, 'extension iframe target');
    const iframeSession = (await cdp.send('Target.attachToTarget', {
      targetId: iframeTarget.targetId, flatten: true,
    })).sessionId;
    const iframeEvaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, iframeSession);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    summary.sourceTitle = await until(async () => {
      const title = await iframeEvaluate(PRECISION_PREVIEW
        ? 'document.querySelector(".erp-source-band strong")?.textContent || ""'
        : 'document.querySelector("[data-role=source-title]")?.textContent || ""');
      return title && title !== '正在读取商品' ? title : null;
    }, 'capture projection in extension iframe');
    assert.match(summary.sourceTitle, /Synthetic storage organizer/i);
    if (PRECISION_PREVIEW) {
      assert.equal(await iframeEvaluate('!!document.getElementById("start-btn")'), true);
      assert.equal(await iframeEvaluate('document.querySelectorAll(".precision-source-tile").length >= 1'), true);
      assert.equal(await iframeEvaluate('document.querySelectorAll("tr[data-editor-row-index]").length'), 16);
    } else {
      assert.equal(await iframeEvaluate('document.querySelector("[data-view=collection]").hidden'), false);
      assert.equal(await iframeEvaluate('document.querySelector("[data-role=product-id]").textContent'), '990499606077');
      assert.equal(await iframeEvaluate('document.querySelectorAll(".media-thumb").length >= 1'), true);
    }
    assert.equal(await iframeEvaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    if (PROBE_MEDIA_CHANNEL) {
      monitoredSessions.add(workerSession);
      monitoredSessions.add(iframeSession);
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, workerSession);
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, iframeSession);
      summary.mediaChannelProbe = await probeMediaChannel(cdp, {
        extensionId: summary.extensionId, executionContexts,
        workerSession, workerTargetId: workerTarget.targetId,
        iframeSession, iframeTargetId: iframeTarget.targetId, pageSession,
      });
    }

    await send('Page.bringToFront');
    await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    await pause(80);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    summary.screenshot = path.join(artifacts, 'source-page-workbench.png');
    await writeFile(summary.screenshot, Buffer.from(screenshot.data, 'base64'));

    await send('Page.navigate', { url: NEGATIVE_PRODUCT_URL });
    await until(() => evaluate('document.readyState === "complete"'), 'non-allowlisted source page load');
    await pause(400);
    summary.negativeSourceBlocked = await evaluate(
      '!document.querySelector("#ss-erp-donor-workbench-trigger")',
    );
    assert.equal(summary.negativeSourceBlocked, true, 'a non-allowlisted product must not mount donor UI');

    assert.deepEqual(summary.pageErrors, []);
    assert.deepEqual(summary.blockedRequests, []);
    summary.browser = (await cdp.send('Browser.getVersion')).product;
    assert.ok(!PROBE_MEDIA_CHANNEL || summary.mediaChannelProbe.ok,
      `precision media channel is ${summary.mediaChannelProbe?.status}: ${summary.mediaChannelProbe?.error || ''}`);
    summary.ok = true;
  } catch (error) {
    summary.failure = error.message;
    throw error;
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch {}
    }
    try {
      await terminateProfileChromium(profile);
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
    } finally {
      await writeFile(summary.receipt, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(JSON.stringify(summary, null, 2));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
