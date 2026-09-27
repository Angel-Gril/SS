#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
const PRODUCT_URL = 'https://detail.1688.com/offer/990499606077.html';
const FEATURE_KEY = 'ss-erp:donor-workbench-preview-enabled';
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
    <main><h1>Synthetic storage organizer</h1>
    <div class="price">12.80</div>
    <ul class="offer-attr-list"><li class="offer-attr-item">材质：PP</li><li class="offer-attr-item">颜色：白色</li></ul>
    <img src="https://detail.1688.com/media/main.png" alt="storage organizer">
    <div class="sku-item" title="White / Small">White / Small</div>
    <div class="sku-item" title="Green / Large">Green / Large</div>
    </main></body></html>`;
}

async function run() {
  const artifacts = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-mv3-evidence-'));
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-donor-mv3-profile-')));
  const summary = {
    contractVersion: 'ss-erp-donor-workbench-mv3-acceptance/v1', ok: false,
    artifacts, screenshot: null, extensionId: null, sourceTitle: null,
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
      expression: `chrome.storage.local.set({${JSON.stringify(FEATURE_KEY)}: true})`,
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
      if (sessionId !== pageSession) return;
      void (async () => {
        const url = new URL(event.request.url);
        if (url.href === PRODUCT_URL) {
          const body = Buffer.from(productHtml());
          await send('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: body.toString('base64'),
          });
          return;
        }
        if (url.origin === 'https://detail.1688.com' && url.pathname === '/media/main.png') {
          const body = await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon128.png'));
          await send('Fetch.fulfillRequest', {
            requestId: event.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/png' }], body: body.toString('base64'),
          });
          return;
        }
        if (url.origin === 'https://detail.1688.com' && url.pathname === '/favicon.ico') {
          await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204 });
          return;
        }
        if (url.protocol === 'chrome-extension:' && url.hostname === summary.extensionId) {
          await send('Fetch.continueRequest', { requestId: event.requestId });
          return;
        }
        summary.blockedRequests.push({ method: event.request.method, url: event.request.url });
        await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      })().catch(async (error) => {
        summary.pageErrors.push(error.message);
        try { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); } catch {}
      });
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: PRODUCT_URL });
    await until(() => evaluate('document.readyState === "complete"'), 'synthetic source page load');
    await until(() => evaluate('!!document.querySelector("#ss-erp-donor-workbench-trigger")'), 'donor workbench trigger injection');

    const point = await evaluate(`(() => { const n=document.querySelector('#ss-erp-donor-workbench-trigger'); const r=n.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await until(() => evaluate('document.querySelector("#ss-erp-donor-workbench-frame")?.hidden === false'), 'iframe open');

    const iframeTarget = await until(async () => {
      const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
      return targets.find((item) => item.type === 'iframe'
        && item.url === `chrome-extension://${summary.extensionId}/pages/source-workbench-shell.html`);
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
      const title = await iframeEvaluate('document.querySelector("[data-role=source-title]")?.textContent || ""');
      return title && title !== '正在读取商品' ? title : null;
    }, 'capture projection in extension iframe');
    assert.match(summary.sourceTitle, /Synthetic storage organizer/i);
    assert.equal(await iframeEvaluate('document.querySelector("[data-view=collection]").hidden'), false);
    assert.equal(await iframeEvaluate('document.querySelector("[data-role=product-id]").textContent'), '990499606077');
    assert.equal(await iframeEvaluate('document.querySelectorAll(".media-thumb").length >= 1'), true);
    assert.equal(await iframeEvaluate('document.documentElement.scrollWidth <= innerWidth'), true);

    await send('Page.bringToFront');
    await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    await pause(80);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    summary.screenshot = path.join(artifacts, 'source-page-workbench.png');
    await writeFile(summary.screenshot, Buffer.from(screenshot.data, 'base64'));

    assert.deepEqual(summary.pageErrors, []);
    assert.deepEqual(summary.blockedRequests, []);
    summary.ok = true;
    summary.browser = (await cdp.send('Browser.getVersion')).product;
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch {}
    }
    await terminateProfileChromium(profile);
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 });
  }
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
