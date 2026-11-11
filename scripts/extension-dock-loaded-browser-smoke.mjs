// 统一悬浮入口在真实扩展形态下的接线验收（本地夹具，不联网）。
//
// extension-dock-browser-smoke.mjs 把 ss-dock.js 当普通脚本加载、由测试手写注册桩，证明的是入口自身的行为。
// 这里让 Chromium 按 manifest 加载 extensions/ss-erp，证明：
//   - 各功能的内容脚本确实排在入口脚本之后并接入了它（标签可用与否由真实注册决定）；
//   - 各功能原来的悬浮按钮确实被接管隐藏，页面加载稳定后入口仍然可见；
//   - 皮肤变量（shared/ui/tokens.css）确实注入到了来源页与 Ozon 页；
//   - 从入口能打开真实的功能面板，面板展开期间入口收起、关闭后回来；
//   - Ozon 单页应用里离开商品页后，不再适用的标签回到置灰。
// 「上架工作台」标签打开后的工作台投影由 extension-donor-workbench-mv3-acceptance.mjs 覆盖，这里不重复。
//
// 用法：node scripts/extension-dock-loaded-browser-smoke.mjs [--screenshot-dir <目录>]
import assert from 'node:assert/strict';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { centerOf, pause, until, withLoadedExtensionBrowser } from './extension-browser-fixture.mjs';

const SCREENSHOT_DIR = process.argv.includes('--screenshot-dir') ? process.argv[process.argv.indexOf('--screenshot-dir') + 1] : '';

// 每个场景：页面地址、四个标签各自是否可用、页面级次要动作、应被接管的原悬浮入口、用来验证“能打开真实面板”的标签。
const SCENES = [
  { name: '1688', url: 'https://detail.1688.com/offer/990499606077.html', lang: 'zh-CN', title: '夹具收纳盒 - 1688',
    tabs: { workbench: true, collect: false, profit: true, product: false }, actions: [],
    legacy: ['ss-erp-donor-workbench-trigger', 'ss-erp-source-costing-fab'],
    panel: { tab: 'profit', isOpen: 'document.getElementById("ss-erp-source-costing-panel").classList.contains("open")',
      close: '#ss-erp-source-costing-panel [data-action="close"]' } },
  { name: 'ozon', url: 'https://www.ozon.ru/product/fixture-organizer-123456789/', lang: 'ru', title: 'Fixture organizer',
    tabs: { workbench: false, collect: true, profit: true, product: true }, actions: ['ozon-cookie'],
    legacy: ['ss-erp-ozon-quick-actions', 'ozon-calc-fab'],
    panel: { tab: 'profit', isOpen: 'document.getElementById("ozon-calc-drawer").classList.contains("open")',
      close: '#ozon-calc-drawer .ozon-calc-close' } },
];

// 背景做成花色，截图里能看出磨砂面的效果
const html = ({ lang, title }) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title></head>
  <body style="margin:0;min-height:100vh;background:linear-gradient(120deg,#ffd9a8,#9fd3ff 55%,#ffc0d9)">
  <main><h1 class="title-text">${title}</h1><div class="price">12.80</div></main></body></html>`;

async function route(url) {
  const scene = SCENES.find(item => item.url === url.href);
  return scene ? { body: html(scene), type: 'text/html' } : null;
}

const DOCK_STATE = `(() => {
  const dock = document.getElementById('ss-erp-dock');
  if (!dock) return null;
  return { docks: document.querySelectorAll('#ss-erp-dock').length,
    tabs: Object.fromEntries([...dock.querySelectorAll('.ss-dock-tab')].map(node => [node.dataset.dockTab, !node.disabled])),
    actions: [...dock.querySelectorAll('.ss-dock-action')].map(node => node.dataset.dockAction) };
})()`;
const legacyState = (ids) => `Object.fromEntries(${JSON.stringify(ids)}.map(id => { const node = document.getElementById(id);
  return [id, node ? { docked: node.dataset.ssDocked === 'true', visible: node.getClientRects().length > 0 } : null]; }))`;
const DOCK_VISIBLE = 'getComputedStyle(document.getElementById("ss-erp-dock")).display !== "none"';
const MENU_HIDDEN = 'document.getElementById("ss-erp-dock-menu").hidden';
const INFO_PANEL = 'document.getElementById("spb-self-hosted-ozon-panel")';

await withLoadedExtensionBrowser({ route, interceptPatterns: SCENES.map(scene => new URL(scene.url).origin + '/*') }, async (page) => {
  const { evaluate } = page;
  /** 等页面状态稳定到期望值；超时后用 deepEqual 报出实际值，便于看出是哪一项没接上。 */
  const settle = async (expression, expected, label) => {
    let actual;
    await until(async () => isDeepStrictEqual(actual = await evaluate(expression), expected), label)
      .catch(() => assert.deepEqual(actual, expected, label));
  };
  const click = (selector, label) => page.clickAt(centerOf(selector), label);
  const ensureMenu = async (label) => {
    if (await evaluate(MENU_HIDDEN)) await click('#ss-erp-dock .ss-dock-toggle', `${label} dock toggle`);
    await until(() => evaluate(MENU_HIDDEN + ' === false'), `${label}: 入口菜单展开`);
  };
  /** 从入口打开一个真实面板：面板展开期间入口收起，用面板自己的关闭按钮关掉后入口回来。 */
  const openAndClose = async (label, tab, isOpen, close) => {
    await ensureMenu(label);
    await click(`#ss-erp-dock [data-dock-tab=${tab}]`, `${label} ${tab} tab`);
    await until(() => evaluate(isOpen), `${label}: 从入口打开 ${tab} 面板`);
    await until(() => evaluate('!(' + DOCK_VISIBLE + ')'), `${label}: ${tab} 面板展开期间入口收起`);
    await click(close, `${label} ${tab} close`);
    await until(() => evaluate(DOCK_VISIBLE), `${label}: ${tab} 面板关闭后入口回来`);
  };
  const extensionId = await page.extensionId();

  for (const scene of SCENES) {
    await page.navigate(scene.url);
    await settle(DOCK_STATE, { docks: 1, tabs: scene.tabs, actions: scene.actions }, `${scene.name}: 各功能接入统一入口`);
    await settle(legacyState(scene.legacy), Object.fromEntries(scene.legacy.map(id => [id, { docked: true, visible: false }])),
      `${scene.name}: 原来的悬浮入口被接管隐藏`);
    // 页面自己渲染完、入口轮询过几轮之后入口仍在：页面加载时自动出现的面板不能把入口挤掉
    await pause(1500);
    assert.equal(await evaluate(DOCK_VISIBLE), true, `${scene.name}: 页面加载稳定后入口可见`);

    await ensureMenu(scene.name);
    assert.match(await evaluate('getComputedStyle(document.documentElement).getPropertyValue("--ss-glass-blur")'), /blur\(18px\)/u,
      `${scene.name}: 皮肤变量由 manifest 注入到页面`);
    assert.match(await evaluate('(()=>{const style=getComputedStyle(document.getElementById("ss-erp-dock-menu"));return style.backdropFilter||style.webkitBackdropFilter;})()'),
      /blur\(18px\)/u, `${scene.name}: 入口使用皮肤里的磨砂模糊`);
    if (SCREENSHOT_DIR) await page.screenshot(path.join(SCREENSHOT_DIR, `dock-loaded-${scene.name}.png`));
    await openAndClose(scene.name, scene.panel.tab, scene.panel.isOpen, scene.panel.close);
  }

  // 以下停留在 Ozon 商品页。商品信息面板随页面加载读取数据（利润计算要用规格），但入口被接管后不再常驻，
  // 从「商品信息」标签打开，收起后不留悬浮条。
  await until(() => evaluate(`!!${INFO_PANEL}`), 'ozon: 商品信息面板已随页面加载渲染');
  assert.equal(await evaluate(`${INFO_PANEL}.getClientRects().length`), 0, 'ozon: 商品信息面板默认不常驻');
  await openAndClose('ozon', 'product', `${INFO_PANEL}.getBoundingClientRect().width > 300`,
    '#spb-self-hosted-ozon-panel [data-role="collapse"]');
  assert.equal(await evaluate(`${INFO_PANEL}.getClientRects().length`), 0, 'ozon: 商品信息面板收起后不留悬浮条');

  // 页面上残留着不是本次注入创建的面板时（例如扩展刚被重新加载），从入口仍能打开
  await evaluate(`${INFO_PANEL}.replaceWith(Object.assign(document.createElement('section'), { id: 'spb-self-hosted-ozon-panel', hidden: true }))`);
  await openAndClose('ozon', 'product', `${INFO_PANEL}.getBoundingClientRect().width > 300`,
    '#spb-self-hosted-ozon-panel [data-role="collapse"]');

  // 单页应用里离开商品页：采集与商品信息不再适用，标签回到置灰；利润计算仍可用
  await evaluate('history.pushState({}, "", "/category/fixture-7000/")');
  await settle(DOCK_STATE, { docks: 1, tabs: { workbench: false, collect: false, profit: true, product: false }, actions: [] },
    'ozon: 离开商品页后采集与商品信息标签置灰');
  assert.equal(await evaluate(`!!${INFO_PANEL} || !!document.getElementById("ss-erp-ozon-quick-actions")`), false,
    'ozon: 离开商品页后商品面板一并移除');
  assert.equal(await evaluate(DOCK_VISIBLE), true, 'ozon: 离开商品页后入口仍可见');

  assert.deepEqual(page.pageErrors, []);
  console.log(JSON.stringify({ ok: true, scope: 'LOADED_EXTENSION_LOCAL_FIXTURE', extensionId,
    scenes: SCENES.map(scene => scene.name), blocked: [...new Set(page.blocked)] }));
});
