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
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EXTENSION_ROOT, extensionFile, until, withFixtureBrowser } from './extension-browser-fixture.mjs';

const PAGE_ORIGIN = 'https://detail.1688.com';
const PAGE_URL = `${PAGE_ORIGIN}/offer/715234567890.html`;
const IMAGE_ORIGIN = 'https://images.ss-erp-fixture.invalid';
const SCREENSHOT = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : '';

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
  let ozonSaved = null, imageSaved = null;
  parent.__smokePermissions = [];
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
      if (type === 'ss-erp:direct-ozon-credentials-read') return done({ ok: true, result: ozonSaved });
      if (type === 'ss-erp:direct-ozon-credentials-write') {
        if (!/^[0-9]{4,12}$/.test(String(payload.clientId)) || String(payload.apiKey).length < 20) return done({ ok: false, error: 'Client-Id 应为 4-12 位数字' });
        ozonSaved = { clientId: String(payload.clientId), label: '' };
        return done({ ok: true, result: ozonSaved });
      }
      if (type === 'ss-erp:direct-ozon-probe') return done({ ok: true, result: ozonSaved
        ? { ok: true, kind: 'OK', message: 'Ozon 直连正常（夹具）' } : { ok: false, kind: 'NO_CREDENTIALS', message: '尚未配置 Ozon 直连凭据' } });
      if (type === 'ss-erp:direct-image-provider-read') return done({ ok: true, result: imageSaved });
      if (type === 'ss-erp:direct-image-provider-write') {
        imageSaved = { baseUrl: String(payload.baseUrl), model: String(payload.model), size: String(payload.size || '1008x1344'), mode: 'openai-images' };
        return done({ ok: true, result: imageSaved });
      }
      if (type === 'ss-erp:direct-image-probe') return done({ ok: true, result: imageSaved
        ? { ok: true, kind: 'OK', message: '生图 Provider 正常（夹具）' } : { ok: false, kind: 'NO_CREDENTIALS', message: '尚未配置生图 Provider' } });
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
  const patch = { runtime, storage: { local: area(), session: area() }, permissions: {
    contains: (input, callback) => callback(false),
    request: (input, callback) => { parent.__smokePermissions.push({ origins: input.origins, trusted: navigator.userActivation.isActive }); callback(true); } } };
  try { Object.assign(window.chrome, patch); }
  catch { Object.defineProperty(window, 'chrome', { value: Object.assign({}, window.chrome || {}, patch), configurable: true, writable: true }); }
})();`;

async function route(url) {
  if (url.href === PAGE_URL) return { body: parentHtml(), type: 'text/html' };
  if (url.origin === PAGE_ORIGIN) return extensionFile(url.pathname);
  if (url.origin === IMAGE_ORIGIN) return { body: await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon128.png')), type: 'image/png' };
  return null;
}

async function run() {
  await withFixtureBrowser({ route, initScript: chromeFixtureScript }, async (page) => {
    const { evaluate, blocked, pageErrors } = page;
    const workspace = (expression) => evaluate('(() => {const window=globalThis.document.getElementById("workspace").contentWindow;const document=window.document;return (' + expression + ');})()');
    const click = (selector) => page.clickAt('(() => {const document=globalThis.document.getElementById("workspace").contentWindow.document;'
      + 'const node=[...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(item=>item.getClientRects().length>0&&!item.disabled);'
      + 'if(!node)return null;node.scrollIntoView({block:"center",inline:"center"});const rect=node.getBoundingClientRect();'
      + 'return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()', selector);
    const errors = async () => [...pageErrors, ...(await evaluate('window.__smokeErrors'))];
    const shot = async (suffix) => { if (SCREENSHOT) await page.screenshot(SCREENSHOT.replace(/\.png$/u, '') + suffix + '.png'); };
    await page.navigate(PAGE_URL);

    // 1. ERP 全部“未连接”的情况下，工作台仍然加载并显示采集到的商品
    await until(() => evaluate('!!document.getElementById("workspace")?.contentDocument?.getElementById("start-btn")'), 'workbench document');
    await until(() => workspace('document.querySelectorAll("[data-image-sku-key]").length === 2'), 'two SKU image rows');
    assert.deepEqual(await errors(), [], '工作台加载不应有脚本错误');

    // 2. 一个入口、三种模式：没有“自带 API”，没有旁路直连按钮
    assert.deepEqual(await workspace('[...document.querySelectorAll("input[name=image-workflow-mode]")].map(input=>input.value)'),
      ['translate', 'ai-main-translate', 'ai-suite']);
    assert.equal(await workspace('!!document.getElementById("precision-direct-generate-btn")||!!document.getElementById("precision-direct-generate-all-btn")'), false);
    await shot('-1-loaded');

    // 2b. 直连密钥只有一个填写入口（设置 → 直连密钥）；保存后清空 Key 输入框，Key 不回显
    const type = async (selector, text) => { await click(selector); await page.send('Input.insertText', { text }); };
    await click('#settings-btn');
    await until(() => workspace('!!document.getElementById("precision-direct-credentials")&&document.getElementById("basic-modal").hidden===false'), 'credentials form');
    await until(() => workspace('document.querySelector("#direct-image-save").closest(".ss-direct-credentials-group").querySelector(".ss-direct-credentials-status").textContent==="尚未配置"'), 'unconfigured status');
    await type('#direct-ozon-client-id', '4980990');
    await type('#direct-ozon-api-key', 'fixture-ozon-key-0123456789');
    await click('#direct-ozon-save');
    await until(() => workspace('document.querySelector("#direct-ozon-save").closest(".ss-direct-credentials-group").querySelector(".ss-direct-credentials-status").textContent.includes("已保存并连接成功")'), 'ozon key saved');
    await type('#direct-image-base-url', 'https://provider.ss-erp-fixture.invalid/v1');
    await type('#direct-image-model', 'gpt-image-2');
    await type('#direct-image-api-key', 'fixture-image-key-0123456789');
    await click('#direct-image-save');
    await until(() => workspace('document.querySelector("#direct-image-save").closest(".ss-direct-credentials-group").querySelector(".ss-direct-credentials-status").textContent.includes("已保存并连接成功")'), 'image provider saved');
    // AI 文本（视觉描述 / 生成标题）同样只在这里填写：地址、模型、Key 一组
    await type('#direct-text-base-url', 'https://text.ss-erp-fixture.invalid/v1');
    await type('#direct-text-model', 'qwen3.5-plus');
    await type('#direct-text-api-key', 'fixture-text-key-0123456789');
    await click('#direct-text-save');
    await until(() => workspace('document.querySelector("#direct-text-save").closest(".ss-direct-credentials-group").querySelector(".ss-direct-credentials-status").textContent.includes("已保存：qwen3.5-plus")'), 'text service saved');
    const textConfig = await evaluate('window.__smokeStorage["ss-erp:title-ai:v1"]');
    assert.deepEqual([textConfig.baseUrl, textConfig.model, textConfig.apiKey],
      ['https://text.ss-erp-fixture.invalid/v1', 'qwen3.5-plus', 'fixture-text-key-0123456789']);
    assert.deepEqual(await workspace('["direct-ozon-api-key","direct-image-api-key","direct-text-api-key"].map(id=>document.getElementById(id).value)'), ['', '', '']);
    assert.deepEqual(await evaluate('window.__smokePermissions'),
      [{ origins: ['https://*/*'], trusted: true }, { origins: ['https://text.ss-erp-fixture.invalid/*'], trusted: true }],
      '保存时在可信点击内申请主机访问权限：生图服务一次（图片主机），AI 文本一次（服务地址）');
    // 上架面板不再有自己的一份 AI 配置：没有 Key 输入框，只显示当前使用的模型
    assert.equal(await workspace('document.querySelectorAll("[data-direct-lane] input[type=password]").length'), 0, '上架面板不再提供 Key 输入框');
    await until(() => workspace('document.querySelector("[data-direct-lane] [data-direct-text-ai]").textContent.includes("qwen3.5-plus")'), 'listing panel shows the configured text model');
    assert.equal(await workspace('document.getElementById("basic-modal").textContent.includes("fixture-")'), false, '设置里不回显任何 Key');
    await shot('-1b-credentials');
    await click('#basic-modal [data-close-modal="basic-modal"]');

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
    // 步骤条每 600ms 定时重画一次（precision-workbench.js），而夹具的应答是即时的，整段流程可能快过一次重画：
    // 等它重画，而不是立即读上一次重画留下的值。
    await until(() => workspace('document.querySelector(".stepper-step[data-step=image]").dataset.state === "done"'), 'image step marked done in the stepper');
    await shot('-4-summary');

    assert.deepEqual(await errors(), [], '整个流程不应有脚本错误');
    assert.deepEqual(blocked, [], '不应有任何对外网络请求');
    console.log(JSON.stringify({ ok: true, scope: 'LOCAL_BROWSER_FIXTURE', generateCalls: calls.length,
      erpCommands: [...new Set(await evaluate('window.__smokeCommands'))], providerRequests: 0, ozonRequests: 0 }));
  });
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
