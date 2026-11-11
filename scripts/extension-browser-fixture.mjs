// 浏览器夹具公用部分：启动独立的无头 Chromium、接管全部网络请求（不联网）、用真实鼠标事件点击。
// 供 scripts/extension-*-browser-smoke.mjs 使用。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(80);
  }
  throw new Error(`Timed out: ${label}`);
}

function chromeExecutable() {
  const base = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    base && path.join(base, 'chromium-1217/chrome-win64/chrome.exe'),
    base && path.join(base, 'chromium-1208/chrome-win64/chrome.exe')].filter(Boolean);
  const executable = candidates.find(existsSync);
  assert.ok(executable, '需要独立的 Chromium（设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH）');
  return executable;
}

/** 读取扩展目录里的文件作为夹具响应；路径越界时抛错。 */
export async function extensionFile(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\//u, '');
  const absolute = path.resolve(EXTENSION_ROOT, relative);
  assert.ok(absolute.startsWith(EXTENSION_ROOT + path.sep) && !relative.includes('..'));
  const type = relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html'
    : relative.endsWith('.png') ? 'image/png' : 'text/javascript';
  return { body: await readFile(absolute), type };
}

/** 在页面里求值的表达式：选择器命中元素的可点击中心 {x,y}；元素不存在或不可见时为 null。配合 page.clickAt 使用。 */
export const centerOf = (selector) => '(() => {const node=document.querySelector(' + JSON.stringify(selector)
  + ');if(!node||!node.getClientRects().length)return null;const rect=node.getBoundingClientRect();'
  + 'return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()';

class Cdp {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params, message.sessionId);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
    });
    return new Cdp(socket);
  }
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) || []), listener]); }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

/**
 * 启动独立 Chromium 并跑一段用例。
 *
 * @param options.route      async (URL) => { body: Buffer|string, type: string, status?: number } | null
 *                           返回 null 的请求会被拦截并记入 blocked
 * @param options.initScript 每个文档加载前注入的脚本
 * @param options.loadExtension true 时以真实扩展形态加载 extensions/ss-erp（默认 false：不加载扩展，用内存桩）
 * @param options.interceptPatterns Fetch 拦截范围；加载真实扩展时应收窄到被测站点，
 *                           否则扩展自身的页面与资源也会被拦截
 * @param run                async (page) => void
 */
async function withBrowser(options, run) {
  const { route, initScript = '', width = 1440, height = 1000, loadExtension = false,
    interceptPatterns = ['*'] } = options;
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-browser-fixture-')));
  const blocked = [], pageErrors = [];
  const child = spawn(chromeExecutable(), ['--headless=new', `--window-size=${width},${height}`, '--user-data-dir=' + profile,
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    ...(loadExtension
      ? [`--disable-extensions-except=${EXTENSION_ROOT}`, `--load-extension=${EXTENSION_ROOT}`]
      : ['--disable-extensions']),
    '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let cdp;
  try {
    const port = await until(async () => {
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/u); } catch { return null; }
    }, 'browser startup');
    cdp = await Cdp.connect('ws://127.0.0.1:' + port[0] + port[1]);
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const sessionId = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    cdp.on('Runtime.exceptionThrown', (event) => {
      pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text);
    });
    cdp.on('Fetch.requestPaused', (event, observed) => {
      if (observed !== sessionId) return;
      void (async () => {
        const url = new URL(event.request.url);
        const response = url.pathname === '/favicon.ico' ? { status: 204 } : await route(url);
        if (!response) {
          blocked.push(event.request.url);
          await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); return;
        }
        if (response.status === 204) { await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204 }); return; }
        await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: response.type + (response.type.startsWith('image/') ? '' : '; charset=utf-8') }],
          body: Buffer.from(response.body).toString('base64') });
      })().catch(async (error) => {
        pageErrors.push('fixture: ' + error.message);
        try { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); } catch {}
      });
    });
    await send('Page.enable'); await send('Runtime.enable');
    if (initScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
    await send('Fetch.enable', { patterns: interceptPatterns.map((urlPattern) => ({ urlPattern })) });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await run({
      send, evaluate, blocked, pageErrors, cdp,
      navigate: (url) => send('Page.navigate', { url }),
      /** 真实扩展形态下，等扩展的 service worker 出现并返回它的扩展 ID。 */
      async extensionId(timeout = 30_000) {
        return until(async () => {
          const targets = (await cdp.send('Target.getTargets')).targetInfos || [];
          const worker = targets.find((item) => item.type === 'service_worker'
            && /^chrome-extension:\/\/[^/]+\/background\/service-worker\.js$/u.test(item.url));
          return worker ? new URL(worker.url).hostname : null;
        }, 'extension service worker', timeout);
      },
      /** 用真实（可信）鼠标事件点击；locate 是在页面里求值、返回 {x,y} 或 null 的表达式 */
      async clickAt(locate, label) {
        const point = await until(() => evaluate(locate), 'clickable ' + label);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      },
      async screenshot(file) {
        const image = await send('Page.captureScreenshot', { format: 'png' });
        await writeFile(file, Buffer.from(image.data, 'base64'));
      },
    });
  } finally {
    try { cdp?.socket.close(); } catch {}
    child.kill();
    await pause(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

/** 不加载扩展，用内存桩替代 chrome.*（既有冒烟脚本用这个）。 */
export const withFixtureBrowser = (options, run) => withBrowser({ ...options, loadExtension: false }, run);

/** 以真实扩展形态加载 extensions/ss-erp，用于验证内容脚本注入与真实接线。 */
export const withLoadedExtensionBrowser = (options, run) => withBrowser({ ...options, loadExtension: true }, run);
