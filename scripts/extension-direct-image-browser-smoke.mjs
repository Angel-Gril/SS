// 直连生图流程的浏览器冒烟验收（本地夹具，不联网、不产生费用、不写 Ozon/ERP）。
//
// 在独立的无头 Chromium 里，以 https://detail.1688.com 夹具页承载真实的工作台页面与模块，
// 把 chrome.runtime / chrome.storage 换成内存桩，把 ERP 桥接命令全部应答为“未连接”，
// 以此证明 dev-docs/extension-direction.md 的几条规则在真实 DOM 里成立：
//   - 工作台在 ERP 不可用时仍能加载并完成生图；
//   - 生图只有一个入口、三种模式，没有“自带 API”和旁路按钮；
//   - 结果进入「处理结果」，单张失败不丢已完成的图片，可只重试失败项；
//   - 结果落盘，可勾选用于上架。
//
// 用法：node scripts/extension-direct-image-browser-smoke.mjs [--screenshot <png 路径>]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
const PAGE_ORIGIN = 'https://detail.1688.com';
const PAGE_URL = `${PAGE_ORIGIN}/offer/715234567890.html`;
const IMAGE_ORIGIN = 'https://images.ss-erp-fixture.invalid';
const SCREENSHOT = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : '';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 20_000) {
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

function fixtureProduct() {
  return {
    productId: '715234567890', title: '夏季连衣裙 · 测试商品',
    captureV2: {
      sourceIdentity: { productId: '715234567890', canonicalUrl: PAGE_URL },
      sourceCategory: { name: '连衣裙', path: [] },
      skus: ['粉色 / M', '蓝色 / L'].map((specText, index) => ({
        key: 'sku-' + index, sourceSkuId: 'source-' + index, specText, priceCny: 39.9, stock: 99, mediaKeys: ['sku-image-' + index],
      })),
      media: [
        ...[0, 1, 2].map(index => ({ key: 'main-' + index, role: 'product_main', disposition: 'accepted', url: `${IMAGE_ORIGIN}/main-${index}.png`, skuKeys: [] })),
        ...[0, 1, 2, 3].map(index => ({ key: 'detail-' + index, role: 'product_detail', disposition: 'accepted', url: `${IMAGE_ORIGIN}/detail-${index}.png`, skuKeys: [] })),
        ...[0, 1].map(index => ({ key: 'sku-image-' + index, role: 'sku', disposition: 'accepted', url: `${IMAGE_ORIGIN}/sku-${index}.png`, skuKeys: ['sku-' + index] })),
      ],
    },
  };
}

// 夹具父页面：只提供采集投影；其余 ERP 桥接命令一律应答“未连接”。
function parentHtml() {
  return `<!doctype html><html><head><script src="/shared/donor-workbench/product-preparation-client.js"></script><script src="/shared/donor-workbench/workspace-contract.js"></script></head>
  <body style="margin:0;background:linear-gradient(120deg,#ffd9a8,#9fd3ff 55%,#ffc0d9)"><iframe id="workspace" src="/pages/precision-workbench.html" referrerpolicy="no-referrer"
  style="position:fixed;inset:0;width:100vw;height:100vh;border:0"></iframe>
  <script>
  const contract=SS_ERP_DONOR_WORKBENCH_CONTRACT;
  window.__smokeErrors=[]; window.__smokeCommands=[]; window.__smokeDirect=[]; window.__smokeStorage={};
  const projection=()=>contract.createProjection({platform:'1688',product:${JSON.stringify(fixtureProduct())},shops:[]});
  window.addEventListener('message',event=>{
    const frame=document.getElementById('workspace');
    if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
    let command; try{command=contract.parseFrameCommand(event.data);}catch(error){window.__smokeErrors.push('bad command: '+error.message);return;}
    window.__smokeCommands.push(command.type);
    const reply=(body)=>frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,...body},location.origin);
    if(command.type==='READY'||command.type==='REFRESH'){
      reply({ok:true,error:'',data:null});
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'PROJECTION',projection:projection()},location.origin);
      return;
    }
    reply({ok:false,error:'ERP 未连接（夹具）',outcome:'NOT_SUBMITTED',code:'DEVICE_UNPAIRED'});
  });
  </script></body></html>`;
}

// 工作台 iframe 内的 chrome 桩：直连消息由内存夹具应答，存储落在父页面便于断言。
const chromeFixtureScript = `(() => {
  const report = (text) => { try { parent.__smokeErrors.push(String(text)); } catch {} };
  window.addEventListener('error', event => report(event.error?.stack || event.message || 'script error'));
  window.addEventListener('unhandledrejection', event => report(event.reason?.stack || event.reason || 'unhandled rejection'));
  if (location.pathname !== '/pages/precision-workbench.html') return;
  const failedOnce = new Set();
  let generated = 0;
  const area = () => ({
    get: async (key) => (Object.prototype.hasOwnProperty.call(parent.__smokeStorage, key) ? { [key]: structuredClone(parent.__smokeStorage[key]) } : {}),
    set: async (value) => { for (const [key, entry] of Object.entries(value)) parent.__smokeStorage[key] = structuredClone(entry); },
    remove: async (key) => { delete parent.__smokeStorage[key]; },
  });
  const runtime = { lastError: null, id: 'fixture-extension', getURL: (value) => location.origin + '/' + String(value).replace(/^\\//, ''),
    getManifest: () => ({ version: '0.0.0-smoke' }),
    sendMessage(message, callback) {
      const type = message.type, payload = message.payload || {};
      const done = (response, delay = 0) => setTimeout(() => callback(response), delay);
      if (!String(type).startsWith('ss-erp:direct-')) {
        return done(type === 'ss-erp:precision-frame-ui-register'
          ? { ok: true, data: { state: 'UI_REGISTERED', registered: true } } : { ok: false, errorCode: 'FIXTURE_OPERATION_NOT_IMPLEMENTED' });
      }
      parent.__smokeDirect.push({ type, jobId: payload.jobId || null, refs: (payload.inputImageUrls || []).length, shopId: payload.shopId || null });
      if (type === 'ss-erp:direct-ozon-credentials-read') return done({ ok: true, result: null });
      if (type === 'ss-erp:direct-ozon-probe') return done({ ok: true, result: { ok: false, kind: 'NO_CREDENTIALS', message: '尚未配置 Ozon 直连凭据' } });
      if (type === 'ss-erp:direct-image-probe') return done({ ok: true, result: { ok: true, kind: 'OK', message: '生图 Provider 正常（夹具）' } });
      if (type === 'ss-erp:direct-image-generate') {
        if (payload.jobId === 'gallery:shared_gallery_2' && !failedOnce.has(payload.jobId)) {
          failedOnce.add(payload.jobId);
          return done({ ok: false, error: '生图返回 429（限流，请降低并发）' }, 40);
        }
        generated += 1;
        return done({ ok: true, result: { url: '${IMAGE_ORIGIN}/generated-' + generated + '.png', hosted: true, elapsedMs: 40 } }, 40);
      }
      return done({ ok: false, error: '夹具未实现：' + type });
    } };
  const patch = { runtime, storage: { local: area(), session: area() }, permissions: { request: (_input, callback) => callback(true) } };
  try { Object.assign(window.chrome, patch); }
  catch { Object.defineProperty(window, 'chrome', { value: Object.assign({}, window.chrome || {}, patch), configurable: true, writable: true }); }
})();`;

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

async function run() {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-direct-smoke-')));
  const blocked = [], pageErrors = [];
  const child = spawn(chromeExecutable(), ['--headless=new', '--window-size=1440,1000', '--user-data-dir=' + profile,
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
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
    const workspace = (expression) => evaluate('(() => {const window=globalThis.document.getElementById("workspace").contentWindow;const document=window.document;return (' + expression + ');})()');
    cdp.on('Runtime.exceptionThrown', (event) => {
      pageErrors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text);
    });
    cdp.on('Fetch.requestPaused', (event, observed) => {
      if (observed !== sessionId) return;
      void (async () => {
        const url = new URL(event.request.url);
        let body, type;
        if (url.href === PAGE_URL) { body = Buffer.from(parentHtml()); type = 'text/html'; }
        else if (url.origin === PAGE_ORIGIN && url.pathname === '/favicon.ico') {
          await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204 }); return;
        } else if (url.origin === PAGE_ORIGIN) {
          const relative = decodeURIComponent(url.pathname).replace(/^\//u, '');
          const absolute = path.resolve(EXTENSION_ROOT, relative);
          assert.ok(absolute.startsWith(EXTENSION_ROOT + path.sep) && !relative.includes('..'));
          body = await readFile(absolute);
          type = relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html'
            : relative.endsWith('.png') ? 'image/png' : 'text/javascript';
        } else if (url.origin === IMAGE_ORIGIN) {
          body = await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon128.png')); type = 'image/png';
        } else {
          blocked.push(event.request.url);
          await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); return;
        }
        await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: type + (type.startsWith('image/') ? '' : '; charset=utf-8') }], body: body.toString('base64') });
      })().catch(async (error) => {
        pageErrors.push('fixture: ' + error.message);
        try { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); } catch {}
      });
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: chromeFixtureScript });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: PAGE_URL });

    const click = async (selector) => {
      const point = await until(() => workspace('(() => {const node=[...document.querySelectorAll(' + JSON.stringify(selector)
        + ')].find(item=>item.getClientRects().length>0&&!item.disabled);if(!node)return null;node.scrollIntoView({block:"center",inline:"center"});'
        + 'const rect=node.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()'), 'clickable ' + selector);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const errors = async () => [...pageErrors, ...(await evaluate('window.__smokeErrors'))];
    const shot = async (suffix) => {
      if (!SCREENSHOT) return;
      const image = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(SCREENSHOT.replace(/\.png$/u, '') + suffix + '.png', Buffer.from(image.data, 'base64'));
    };

    // 1. ERP 全部“未连接”的情况下，工作台仍然加载并显示采集到的商品
    await until(() => evaluate('!!document.getElementById("workspace")?.contentDocument?.getElementById("start-btn")'), 'workbench document');
    await until(() => workspace('document.querySelectorAll("[data-image-sku-key]").length === 2'), 'two SKU image rows');
    assert.deepEqual(await errors(), [], '工作台加载不应有脚本错误');

    // 2. 一个入口、三种模式：没有“自带 API”，没有旁路直连按钮
    assert.deepEqual(await workspace('[...document.querySelectorAll("input[name=image-workflow-mode]")].map(input=>input.value)'),
      ['translate', 'ai-main-translate', 'ai-suite']);
    assert.equal(await workspace('!!document.getElementById("precision-direct-generate-btn")||!!document.getElementById("precision-direct-generate-all-btn")'), false);
    await shot('-1-loaded');

    // 3. 打开图片工作区 → 生成套图 → 工作区内确认
    await click('#image-workflow-start-btn');
    await until(() => workspace('document.getElementById("precision-image-manager").hidden === false'), 'image workspace open');
    assert.deepEqual(await workspace('[...document.querySelectorAll("#precision-image-manager [data-image-mode]")].map(node=>node.dataset.imageMode)'),
      ['translate', 'ai-main-translate', 'ai-suite']);
    assert.equal(await workspace('document.getElementById("precision-image-primary").textContent'), '生成套图');
    for (const id of ['precision-assign', 'precision-vision-open', 'precision-image-refresh', 'precision-translation-panel']) {
      assert.equal(await workspace(`document.getElementById(${JSON.stringify(id)}).getClientRects().length`), 0, `${id} 属于托管流程，不应再显示`);
    }
    await click('#precision-image-primary');
    const confirmText = await until(() => workspace('(() => {const panel=[...document.querySelectorAll("[data-inline-confirmation]")].find(node=>!node.hidden);return panel?panel.querySelector(".precision-inline-confirmation-message").textContent:"";})()'), 'inline confirmation');
    assert.match(confirmText, /将生成 9 张图片/u);
    await shot('-2-confirm');
    await click('[data-inline-confirmation]:not([hidden]) [data-inline-confirm="accept"]');

    // 4. 单张失败不丢已完成的图片：8 张完成、1 张失败
    await until(() => workspace('document.querySelectorAll(".ss-direct-image.is-done, .ss-direct-image.is-failed").length === 9'
      + ' && document.getElementById("precision-image-primary").textContent === "生成套图"'), 'first run finished', 30_000);
    assert.equal(await workspace('document.querySelectorAll(".ss-direct-image.is-done").length'), 8);
    assert.equal(await workspace('document.querySelectorAll(".ss-direct-image.is-failed").length'), 1);
    assert.match(await workspace('document.querySelector("#precision-direct-images header strong").textContent'), /已完成 8\/9 张，1 张失败可重试/u);
    assert.match(await workspace('document.querySelector(".ss-direct-image.is-failed .ss-direct-image-error").textContent'), /429/u);
    // 结果图是懒加载的：首屏以外的图片此刻可能尚未解码，所以只要求每张都指向托管链接、首张已解码
    assert.equal(await workspace('[...document.querySelectorAll(".ss-direct-image.is-done img")].every(image=>image.src.startsWith(' + JSON.stringify(IMAGE_ORIGIN + '/generated-') + '))'), true);
    await until(() => workspace('(()=>{const image=document.querySelector(".ss-direct-image.is-done img");return image.complete&&image.naturalWidth>0;})()'), 'first result image decoded');
    await shot('-3-results');

    // 5. 只重试失败项：不重复生成（也就不重复付费）已完成的 8 张
    const before = (await evaluate('window.__smokeDirect')).filter(call => call.type === 'ss-erp:direct-image-generate').length;
    assert.equal(before, 9);
    await click('#precision-direct-images header button:not([hidden])');
    await until(() => workspace('!![...document.querySelectorAll("[data-inline-confirmation]")].find(node=>!node.hidden)'), 'retry confirmation');
    await click('[data-inline-confirmation]:not([hidden]) [data-inline-confirm="accept"]');
    await until(() => workspace('document.querySelectorAll(".ss-direct-image.is-done").length === 9'), 'retry finished', 30_000);
    const calls = (await evaluate('window.__smokeDirect')).filter(call => call.type === 'ss-erp:direct-image-generate');
    assert.equal(calls.length, 10, '重试只应多发 1 次生图请求');
    assert.equal(calls.at(-1).jobId, 'gallery:shared_gallery_2');
    assert.ok(calls.every(call => call.refs >= 1), '每张图都带参考图');

    // 6. 结果落盘、默认用于上架；SKU 行显示生成进度与缩略图
    const stored = await evaluate('window.__smokeStorage["ss-erp:direct-images:v1:1688:715234567890"]');
    assert.equal(stored.results.length, 9);
    assert.ok(stored.results.every(item => item.status === 'done' && item.publishable && item.selected && item.hosted));
    assert.equal(await workspace('[...document.querySelectorAll(".ss-direct-image-use input")].every(input=>input.checked&&!input.disabled)'), true);
    await click('#precision-image-close');
    await until(() => workspace('document.getElementById("precision-image-manager").hidden === true'), 'image workspace closed');
    assert.match(await workspace('document.querySelector("[data-image-sku-key=\\"sku-0\\"] .image-manager-summary-task").textContent'), /生图 · 已完成 8\/8/u);
    assert.equal(await workspace('document.querySelector(".stepper-step[data-step=image]").dataset.state'), 'done');
    await shot('-4-summary');

    assert.deepEqual(await errors(), [], '整个流程不应有脚本错误');
    assert.deepEqual(blocked, [], '不应有任何对外网络请求');
    console.log(JSON.stringify({ ok: true, scope: 'LOCAL_BROWSER_FIXTURE', generateCalls: calls.length,
      erpCommands: [...new Set(await evaluate('window.__smokeCommands'))], providerRequests: 0, ozonRequests: 0 }));
  } finally {
    try { cdp?.socket.close(); } catch {}
    child.kill();
    await pause(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
