// 统一悬浮入口（dock）的浏览器冒烟验收（本地夹具，不联网）。
// 证明：一个入口、四个固定标签；未接入的标签置灰；接入后可用真实点击打开；
// 同一时间只展开一个功能；功能面板展开时入口收起；被接管的旧悬浮按钮不再显示；功能注销后标签回到置灰。
// 这里的功能接入是测试手写的桩；真实内容脚本的接线见 extension-dock-loaded-browser-smoke.mjs。
//
// 用法：node scripts/extension-dock-browser-smoke.mjs [--screenshot <png 路径>]
import assert from 'node:assert/strict';
import { centerOf, extensionFile, until, withFixtureBrowser } from './extension-browser-fixture.mjs';

const ORIGIN = 'https://www.ozon.ru';
const PAGE_URL = `${ORIGIN}/product/fixture-123456789/`;
const SCREENSHOT = process.argv.includes('--screenshot') ? process.argv[process.argv.indexOf('--screenshot') + 1] : '';

const html = `<!doctype html><html><head>
  <link rel="stylesheet" href="/shared/ui/tokens.css"><link rel="stylesheet" href="/content/ss-dock.css">
  </head><body style="margin:0;min-height:100vh;background:linear-gradient(120deg,#ffd9a8,#9fd3ff 55%,#ffc0d9)">
  <button id="legacy-fab" style="position:fixed;right:12px;top:120px">算价</button>
  <script src="/content/ss-dock.js"></script></body></html>`;

async function route(url) {
  if (url.href === PAGE_URL) return { body: html, type: 'text/html' };
  if (url.origin === ORIGIN) return extensionFile(url.pathname);
  return null;
}

await withFixtureBrowser({ route }, async (page) => {
  const { evaluate } = page;
  await page.navigate(PAGE_URL);
  await until(() => evaluate('typeof globalThis.SS_ERP_DOCK === "object"'), 'dock script');

  // 没有任何功能接入时不出现入口
  assert.equal(await evaluate('!!document.getElementById("ss-erp-dock")'), false);

  // 接入两个功能；旧悬浮按钮被接管后隐藏
  await evaluate(`(() => {
    window.__calls = []; window.__open = { profit: false, collect: false };
    const fab = document.getElementById('legacy-fab');
    if (SS_ERP_DOCK.register('profit', { open: () => { __open.profit = true; __calls.push('profit:open'); },
      close: () => { __open.profit = false; __calls.push('profit:close'); }, isOpen: () => __open.profit })) fab.dataset.ssDocked = 'true';
    SS_ERP_DOCK.register('collect', { open: () => { __calls.push('collect:open'); } });
    SS_ERP_DOCK.addAction('ozon-cookie', { label: '同步 Ozon Cookie', run: () => __calls.push('cookie') });
    SS_ERP_DOCK.setStatus('SKU 123456789');
    return SS_ERP_DOCK.register('unknown', { open() {} });
  })()`).then(result => assert.equal(result, false, '未知标签不接受注册'));
  assert.equal(await evaluate('document.querySelectorAll("#ss-erp-dock").length'), 1);
  assert.equal(await evaluate('getComputedStyle(document.getElementById("legacy-fab")).display'), 'none');
  assert.equal(await evaluate('document.getElementById("ss-erp-dock-menu").hidden'), true);
  // 菜单收起时状态文字镜像到入口按钮的提示上；状态清空后提示复位，不残留上一条
  const toggleTitle = 'document.querySelector("#ss-erp-dock .ss-dock-toggle").title';
  assert.equal(await evaluate(toggleTitle), 'SS ERP · SKU 123456789');
  await evaluate('SS_ERP_DOCK.setStatus("")');
  assert.equal(await evaluate(toggleTitle), 'SS ERP');
  await evaluate('SS_ERP_DOCK.setStatus("SKU 123456789")');

  // 展开：四个固定标签，未接入的置灰并说明原因
  await page.clickAt(centerOf('#ss-erp-dock .ss-dock-toggle'), 'dock toggle');
  await until(() => evaluate('document.getElementById("ss-erp-dock-menu").hidden === false'), 'dock menu open');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#ss-erp-dock .ss-dock-tab")].map(node=>[node.dataset.dockTab,node.disabled])'),
    [['workbench', true], ['collect', false], ['profit', false], ['product', true]]);
  assert.match(await evaluate('document.querySelector("[data-dock-tab=workbench]").title'), /当前页面不适用/u);
  assert.equal(await evaluate('document.querySelector("#ss-erp-dock .ss-dock-status").textContent'), 'SKU 123456789');
  const blur = await evaluate('(()=>{const style=getComputedStyle(document.getElementById("ss-erp-dock-menu"));return style.backdropFilter||style.webkitBackdropFilter;})()');
  assert.match(blur, /blur\(18px\)/u, '入口使用 tokens 里的磨砂模糊');
  if (SCREENSHOT) await page.screenshot(SCREENSHOT);

  // 打开利润面板：菜单收起，入口在面板展开期间隐藏
  await page.clickAt(centerOf('[data-dock-tab=profit]'), 'profit tab');
  await until(() => evaluate('window.__open.profit === true'), 'profit opened');
  await until(() => evaluate('getComputedStyle(document.getElementById("ss-erp-dock")).display === "none"'), 'dock hides while a panel is open');

  // 面板自己关闭后入口回来；再打开采集时不会留下已展开的其它面板
  await evaluate('window.__open.profit = false');
  await until(() => evaluate('getComputedStyle(document.getElementById("ss-erp-dock")).display !== "none"'), 'dock returns');
  await evaluate('window.__open.profit = true');   // 模拟面板由别处打开
  await evaluate('document.getElementById("ss-erp-dock").classList.remove("is-covered")');
  await page.clickAt(centerOf('#ss-erp-dock .ss-dock-toggle'), 'dock toggle again');
  await page.clickAt(centerOf('[data-dock-tab=collect]'), 'collect tab');
  await until(() => evaluate('window.__calls.includes("collect:open")'), 'collect opened');
  assert.deepEqual(await evaluate('window.__calls'), ['profit:open', 'profit:close', 'collect:open']);

  // 次要动作
  await page.clickAt(centerOf('#ss-erp-dock .ss-dock-toggle'), 'dock toggle for action');
  await page.clickAt(centerOf('[data-dock-action="ozon-cookie"]'), 'cookie action');
  await until(() => evaluate('window.__calls.includes("cookie")'), 'action ran');

  // 功能离开当前页面后注销（单页应用里从商品页跳到列表页）：标签回到置灰，次要动作消失
  await evaluate('SS_ERP_DOCK.unregister("collect"); SS_ERP_DOCK.removeAction("ozon-cookie"); SS_ERP_DOCK.unregister("unknown")');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#ss-erp-dock .ss-dock-tab")].map(node=>[node.dataset.dockTab,node.disabled])'),
    [['workbench', true], ['collect', true], ['profit', false], ['product', true]]);
  assert.match(await evaluate('document.querySelector("[data-dock-tab=collect]").title'), /当前页面不适用/u);
  assert.equal(await evaluate('document.querySelector("#ss-erp-dock .ss-dock-actions").hidden'), true);

  assert.deepEqual(page.pageErrors, []);
  assert.deepEqual(page.blocked, []);
  console.log(JSON.stringify({ ok: true, scope: 'LOCAL_BROWSER_FIXTURE', tabs: await evaluate('SS_ERP_DOCK.tabs()') }));
});
