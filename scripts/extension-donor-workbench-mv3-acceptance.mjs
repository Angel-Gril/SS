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
const platformIndex = process.argv.indexOf('--source-platform');
const SOURCE_PLATFORM = platformIndex < 0 ? '1688' : process.argv[platformIndex + 1];
assert.ok(['1688', 'taobao', 'tmall', 'pdd'].includes(SOURCE_PLATFORM));
const sourceUrl = (id) => SOURCE_PLATFORM === '1688' ? `https://detail.1688.com/offer/${id}.html`
  : SOURCE_PLATFORM === 'pdd' ? `https://mobile.yangkeduo.com/goods.html?goods_id=${id}`
    : `https://${SOURCE_PLATFORM === 'taobao' ? 'item.taobao.com' : 'detail.tmall.com'}/item.htm?id=${id}`;
const PRODUCT_URL = sourceUrl('990499606077');
const ORDINARY_PRODUCT_URL = sourceUrl('990499606078');
const SOURCE_ORIGIN = new URL(PRODUCT_URL).origin;
const WORKSPACE_PAGE = 'pages/precision-workbench.html';
const PREVIEW_STORAGE_KEYS = [
  'ss-erp:donor-workbench-preview-enabled',
  'ss-erp:precision-workbench-preview-enabled',
  'ss-erp:donor-workbench-preview-allowlist:v1',
];
const REJECTED_SOURCE_URLS = [
  'https://detail.1688.com/login',
  'https://detail.1688.com/offer/990499606077.html/trailing',
  'https://detail.1688.com.example.test/offer/990499606077.html',
];
export function selectAcceptanceMode(argumentsList) {
  const mediaChannelOnly = argumentsList.includes('--probe-media-channel-only');
  const mediaChannelProbe = mediaChannelOnly || argumentsList.includes('--probe-media-channel');
  // --precision remains a compatible no-op: precision is the ordinary installation.
  return { precisionDefault: true, mediaChannelProbe, mediaChannelOnly };
}
const {
  mediaChannelProbe: PROBE_MEDIA_CHANNEL,
  mediaChannelOnly: MEDIA_CHANNEL_ONLY,
} = selectAcceptanceMode(process.argv.slice(2));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function assertPrecisionFrameObservation(value, { extensionId, sourceUrl }) {
  assert.ok(value, 'the source-page bridge must install the precision iframe');
  assert.equal(value.src, `chrome-extension://${extensionId}/${WORKSPACE_PAGE}`);
  assert.equal(value.sourceUrl, sourceUrl, 'opening the workbench must keep the source page');
  assert.equal(value.hidden, false, 'the precision workbench must open visibly');
  assert.equal(value.visible, true, 'the precision workbench must have a rendered frame');
}

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

function productHtml(url = PRODUCT_URL) {
  if (SOURCE_PLATFORM !== '1688') {
    const id = new URL(url).searchParams.get(SOURCE_PLATFORM === 'pdd' ? 'goods_id' : 'id');
    const image = SOURCE_PLATFORM === 'pdd' ? 'https://img.pddpic.com/media/main.png' : 'https://img.alicdn.com/media/main.png';
    const data = SOURCE_PLATFORM === 'pdd' ? { goods: { goodsID: id, goodsName: 'Synthetic storage organizer',
      topGallery: [{ url: image }], goodsSkuList: Array.from({ length: 16 }, (_, i) => ({ skuId: 'native-' + i,
        groupPrice: 1280, stock: i === 0 ? 0 : 100, specList: [{ spec_key: '颜色', spec_value: 'White ' + i }], image })) } }
      : { data: { item: { itemId: id, title: 'Synthetic storage organizer', images: [image] },
        skuBase: { props: [{ pid: '1', name: '颜色', values: Array.from({ length: 16 }, (_, i) => ({ vid: String(i), name: 'White ' + i, image })) }],
          skus: Array.from({ length: 16 }, (_, i) => ({ skuId: 'native-' + i, propPath: '1:' + i })) },
        skuCore: { sku2info: Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['native-' + i, { price: { priceText: '12.8' }, quantity: i === 0 ? 0 : 100 }])) } } };
    return `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic storage organizer</title>
      <script>window.${SOURCE_PLATFORM === 'pdd' ? 'rawData' : '__INITIAL_STATE__'}=${JSON.stringify(data)};</script>
      </head><body><h1>Synthetic storage organizer</h1><img src="${image}"></body></html>`;
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <title>Synthetic storage organizer - 1688</title>
    <meta property="og:title" content="Synthetic storage organizer">
    <meta property="og:image" content="https://detail.1688.com/media/main.png">
    </head><body>
    <main><h1 class="title-text">Synthetic storage organizer</h1>
    <script type="application/json">${JSON.stringify({ skuModel: {
      skuProps: [{ prop: '规格', value: Array.from({ length: 16 }, (_, index) => ({ name: 'White ' + index })) }],
      skuInfoMap: Object.fromEntries(Array.from({ length: 16 }, (_, index) => ['White ' + index, { skuId: 'native-' + index, price: 12.8, canBookCount: index === 0 ? 0 : 100 }])),
    } })}</script>
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
  const artifacts = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-mv3-evidence-'));
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-mv3-profile-')));
  const sourceCommit = gitOutput(['rev-parse', 'HEAD']);
  const worktreeClean = gitOutput(['status', '--short']) === '';
  if (process.argv.includes('--require-clean')) assert.equal(worktreeClean, true, 'canary requires a clean worktree');
  const summary = {
    contractVersion: MEDIA_CHANNEL_ONLY
      ? 'ss-erp-precision-media-channel-only-acceptance/v2'
      : 'ss-erp-donor-workbench-mv3-acceptance/v3', ok: false,
    artifacts, receipt: path.join(artifacts, 'summary.json'),
    screenshot: null, extensionId: null, sourceTitle: null,
    sourceCommit, extensionTreeSha256: await extensionTreeSha256(EXTENSION_ROOT), worktreeClean,
    sourceFixture: `synthetic-${SOURCE_PLATFORM}-product-served-by-CDP`,
    workspacePage: WORKSPACE_PAGE, precisionDefault: true, previewStorage: null,
    defaultUiOpenVerified: false, ordinaryProductOpenVerified: false,
    popupEntryVerified: false,
    forgedPageCommandRejected: false, rejectedSources: [],
    retiredFrameInterceptions: [],
    ...(MEDIA_CHANNEL_ONLY ? { acceptanceScope: 'opened-precision-ui-and-transport' } : {}),
    ...(PROBE_MEDIA_CHANNEL ? { mediaChannelProbe: { status: 'not_verified', ok: false } } : {}),
    pageErrors: [], blockedRequests: [], productionMutations: 0, providerRequests: 0, ozonRequests: 0,
  };
  let cdp;
  try {
    spawn(chromeExecutable(), [
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
      expression: `chrome.storage.local.get(${JSON.stringify(PREVIEW_STORAGE_KEYS)})`,
      awaitPromise: true, returnByValue: true,
    }, workerSession);
    if (workerEval.exceptionDetails) {
      throw new Error('default installation storage read failed: '
        + (workerEval.exceptionDetails.exception?.description || workerEval.exceptionDetails.text));
    }
    summary.previewStorage = workerEval.result.value;
    assert.deepEqual(summary.previewStorage, {}, 'default acceptance must not enable preview or product allowlists');

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
      if (monitoredSessions.has(sessionId)) summary.pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text);
    });
    cdp.on('Fetch.requestPaused', (event, sessionId) => {
      if (!monitoredSessions.has(sessionId)) return;
      void (async () => {
        const reply = (method, params) => cdp.send(method, params, sessionId);
        const url = new URL(event.request.url);
        if ([PRODUCT_URL, ORDINARY_PRODUCT_URL, ...REJECTED_SOURCE_URLS].includes(event.request.url)) {
          const body = Buffer.from(productHtml(event.request.url));
          await reply('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: body.toString('base64'),
          });
          return;
        }
        if (['https://detail.1688.com', 'https://img.alicdn.com', 'https://img.pddpic.com'].includes(url.origin) && url.pathname === '/media/main.png') {
          const body = await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon128.png'));
          await reply('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: body.toString('base64'),
          });
          return;
        }
        if ([SOURCE_ORIGIN, 'https://detail.1688.com', 'https://detail.1688.com.example.test'].includes(url.origin)
          && url.pathname === '/favicon.ico') {
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
    monitoredSessions.add(workerSession);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, workerSession);
    const attachedFrameSessions = new Map();
    const detachedSessions = new Set();
    cdp.on('Target.detachedFromTarget', (event) => detachedSessions.add(event.sessionId));
    cdp.on('Target.attachedToTarget', (event, parentSession) => {
      if (parentSession !== pageSession) return;
      void (async () => {
        monitoredSessions.add(event.sessionId);
        await cdp.send('Runtime.enable', {}, event.sessionId);
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, event.sessionId);
        await cdp.send('Runtime.runIfWaitingForDebugger', {}, event.sessionId);
        attachedFrameSessions.set(event.targetInfo.targetId, event.sessionId);
      })().catch(async (error) => {
        // Chrome can retire a provisional OOPIF while navigation commits. Accept
        // only its explicit detach; a missing active target remains a failure.
        if (detachedSessions.has(event.sessionId)
          && /Session with given id not found[.]/u.test(error.message)) {
          summary.retiredFrameInterceptions.push({ targetId: event.targetInfo.targetId,
            url: event.targetInfo.url, reason: 'NAVIGATION_DETACHED_PROVISIONAL_TARGET' });
          return;
        }
        summary.pageErrors.push(`${event.targetInfo.type} ${event.targetInfo.url}: ${error.message}`);
      });
    });
    // Pause the actual MV3 OOPIF before resource requests so synthetic images cannot
    // race ahead of isolation interception or silently become broken thumbnails.
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: PRODUCT_URL });
    await until(() => evaluate('document.readyState === "complete"'), 'synthetic source page load');
    await until(() => evaluate('!!document.querySelector("#ss-erp-donor-workbench-trigger")'), 'donor workbench trigger injection');

    await send('Page.bringToFront');
    const pageTargetsBefore = ((await cdp.send('Target.getTargets')).targetInfos || [])
      .filter(item => item.type === 'page').map(item => item.targetId);
    const openedPopup = await cdp.send('Runtime.evaluate', {
      expression: 'chrome.action.openPopup()', awaitPromise: true, returnByValue: true,
    }, workerSession);
    assert.equal(Boolean(openedPopup.exceptionDetails), false, 'Chrome must open the actual action popup');
    const popupTarget = await until(async () => {
      const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
      return targets.find(item => item.url === `chrome-extension://${summary.extensionId}/pages/popup.html`);
    }, 'actual extension popup target');
    const popupSession = (await cdp.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: true })).sessionId;
    const popupEvaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, popupSession);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await until(() => popupEvaluate(`document.getElementById('primaryActionBtn')?.textContent === '打开精铺工作台'
      && !document.getElementById('primaryActionBtn').disabled`), 'popup recognizes the current product');
    assert.equal(await popupEvaluate('document.body.textContent.includes("打开 ERP 继续")'), false);
    const popupPoint = await popupEvaluate(`(() => {
      const rect=document.getElementById('primaryActionBtn').getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...popupPoint, button: 'left', clickCount: 1 }, popupSession);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...popupPoint, button: 'left', clickCount: 1 }, popupSession);
    await until(() => evaluate('document.querySelector("#ss-erp-donor-workbench-frame")?.hidden === false'), 'popup opens the existing source-page iframe');
    assert.equal(await popupEvaluate('document.getElementById("primaryActionStatus").classList.contains("ok")'), true);
    const pageTargetsAfter = ((await cdp.send('Target.getTargets')).targetInfos || [])
      .filter(item => item.type === 'page' && item.targetId !== popupTarget.targetId).map(item => item.targetId);
    assert.deepEqual(pageTargetsAfter.sort(), pageTargetsBefore.sort(), 'popup entry must not create any ERP or other page tab');
    summary.popupEntryVerified = true;
    await cdp.send('Target.closeTarget', { targetId: popupTarget.targetId });
    await until(() => evaluate('document.querySelector("#ss-erp-donor-workbench-frame")?.hidden === false'), 'iframe open');
    const frameObservation = () => evaluate(`(() => {
      const frame=document.querySelector('#ss-erp-donor-workbench-frame');
      return frame?{src:frame.src,hidden:frame.hidden,visible:frame.getClientRects().length>0,
        sourceUrl:location.href,sourceHost:location.hostname}:null;
    })()`);
    summary.installedFrame = await frameObservation();
    assertPrecisionFrameObservation(summary.installedFrame, { extensionId: summary.extensionId, sourceUrl: PRODUCT_URL });
    summary.defaultUiOpenVerified = true;
    summary.transparentShell = await evaluate(`(() => {
      const frame = document.querySelector('#ss-erp-donor-workbench-frame'), style = getComputedStyle(frame);
      return { background: style.backgroundColor, boxShadow: style.boxShadow,
        sourceOverflow: document.documentElement.style.overflow,
        fullViewport: Math.abs(frame.getBoundingClientRect().width-innerWidth)<2 && Math.abs(frame.getBoundingClientRect().height-innerHeight)<2 };
    })()`);
    assert.equal(summary.transparentShell.background, 'rgba(0, 0, 0, 0)');
    assert.equal(summary.transparentShell.boxShadow, 'none');
    assert.notEqual(summary.transparentShell.sourceOverflow, 'hidden');
    assert.equal(summary.transparentShell.fullViewport, true);

    const iframeTarget = await until(async () => {
      const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
      return targets.find((item) => item.type === 'iframe'
        && item.url === `chrome-extension://${summary.extensionId}/${WORKSPACE_PAGE}`);
    }, 'extension iframe target');
    const iframeSession = await until(() => attachedFrameSessions.get(iframeTarget.targetId), 'intercepted precision iframe session');
    const iframeEvaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      }, iframeSession);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    summary.sourceTitle = await until(async () => {
      const title = await iframeEvaluate('document.querySelector(".erp-source-band strong")?.textContent || ""');
      return title && title !== '正在读取商品' ? title : null;
    }, 'capture projection in extension iframe');
    assert.match(summary.sourceTitle, /Synthetic storage organizer/i);
    assert.equal(await iframeEvaluate('!!document.getElementById("start-btn")'), true);
    assert.equal(await iframeEvaluate('document.querySelectorAll(".precision-source-tile").length >= 1'), true);
    assert.equal(await iframeEvaluate('document.querySelectorAll("tr[data-editor-row-index]").length'), 16);
    if (SOURCE_PLATFORM !== '1688') {
      const nativeObservation = await cdp.send('Runtime.evaluate', {
        expression: `(async()=>{const value=(await chrome.storage.local.get('spb_self_hosted_last_collected')).spb_self_hosted_last_collected;
          const capture=value?.captureV2;return {native:capture?.provenanceMode==='native_v2',platform:capture?.platform,
            productId:capture?.sourceIdentity.productId,skuCount:capture?.skus.length,stock:capture?.skus[0]?.stock,
            sourceSkuId:capture?.skus[0]?.sourceSkuId,attributes:capture?.skus[0]?.attributes.map(item=>({name:item.name,value:item.value}))};})()`,
        awaitPromise: true, returnByValue: true,
      }, workerSession);
      assert.equal(Boolean(nativeObservation.exceptionDetails), false);
      assert.equal(nativeObservation.result.value.native, true, 'the installed collector must produce native V2');
      assert.equal(nativeObservation.result.value.platform, SOURCE_PLATFORM);
      assert.equal(nativeObservation.result.value.productId, '990499606077');
      assert.equal(nativeObservation.result.value.skuCount, 16);
      assert.equal(nativeObservation.result.value.stock, 0, 'installed collection must preserve zero inventory');
      assert.equal(nativeObservation.result.value.sourceSkuId, 'native-0');
      assert.deepEqual(nativeObservation.result.value.attributes, [{name:'颜色',value:'White 0'}]);
      summary.nativeCollection = nativeObservation.result.value;
    }
    assert.equal(await iframeEvaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    summary.sourceImageRendered = await until(() => iframeEvaluate(`(() => {
      const image=document.querySelector('.precision-source-tile img');
      return Boolean(image?.complete && image.naturalWidth>0);
    })()`), 'rendered precision source image');

    if (PROBE_MEDIA_CHANNEL) {
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

    // A marketplace-page message must not impersonate the extension iframe.
    await evaluate(`window.postMessage({contractVersion:'ss-erp-donor-workbench/v1',
      type:'CLOSE',requestId:'forged-marketplace-close'},location.origin)`);
    await pause(150);
    assertPrecisionFrameObservation(await frameObservation(), { extensionId: summary.extensionId, sourceUrl: PRODUCT_URL });
    summary.forgedPageCommandRejected = true;

    await send('Page.navigate', { url: ORDINARY_PRODUCT_URL });
    await until(() => evaluate('document.readyState === "complete"'), 'ordinary source product load');
    await until(() => evaluate('!!document.querySelector("#ss-erp-donor-workbench-trigger")'), 'ordinary product precision trigger');
    const ordinaryPoint = await evaluate(`(() => {
      const rect=document.querySelector('#ss-erp-donor-workbench-trigger').getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...ordinaryPoint, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...ordinaryPoint, button: 'left', clickCount: 1 });
    await until(() => evaluate('document.querySelector("#ss-erp-donor-workbench-frame")?.hidden === false'), 'ordinary product precision open');
    summary.ordinaryProductFrame = await frameObservation();
    assertPrecisionFrameObservation(summary.ordinaryProductFrame, { extensionId: summary.extensionId, sourceUrl: ORDINARY_PRODUCT_URL });
    const ordinaryIframeTarget = await until(async () => {
      const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
      return targets.find((item) => item.type === 'iframe' && item.targetId !== iframeTarget.targetId
        && item.url === `chrome-extension://${summary.extensionId}/${WORKSPACE_PAGE}`);
    }, 'ordinary product precision iframe');
    const ordinaryIframeSession = await until(() => attachedFrameSessions.get(ordinaryIframeTarget.targetId), 'ordinary intercepted iframe session');
    await until(async () => {
      const state = await cdp.send('Runtime.evaluate', {
        expression: `document.readyState==='complete'
          && document.querySelector('.erp-source-band strong')?.textContent==='Synthetic storage organizer'
          && document.querySelectorAll('tr[data-editor-row-index]').length===16`,
        returnByValue: true,
      }, ordinaryIframeSession);
      return state.result?.value === true;
    }, 'ordinary product precision projection');
    summary.ordinaryProductOpenVerified = true;

    for (const url of REJECTED_SOURCE_URLS) {
      await send('Page.navigate', { url });
      await until(() => evaluate('document.readyState === "complete"'), `rejected source load ${url}`);
      await pause(400);
      const rejected = await evaluate(`!document.querySelector('#ss-erp-donor-workbench-trigger')
        && !document.querySelector('#ss-erp-donor-workbench-frame')`);
      summary.rejectedSources.push({ url, rejected });
      assert.equal(rejected, true, 'non-product paths and forged source hosts must not mount precision UI');
    }
    const finalStorage = await cdp.send('Runtime.evaluate', {
      expression: `chrome.storage.local.get(${JSON.stringify(PREVIEW_STORAGE_KEYS)})`,
      awaitPromise: true, returnByValue: true,
    }, workerSession);
    assert.equal(Boolean(finalStorage.exceptionDetails), false);
    assert.deepEqual(finalStorage.result.value, {}, 'ordinary entry must not write preview flags or an allowlist');

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
