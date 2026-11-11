// SS ERP 统一悬浮入口（dock）。
//
// 见 dev-docs/extension-direction.md 第 5 条：每个页面只有一个悬浮入口，各功能以标签形式挂在它下面。
// 功能脚本通过 SS_ERP_DOCK.register(id, handlers) 接入，并隐藏自己原来的悬浮按钮；
// 当前页面没有接入的标签置灰显示，用户始终看到同一组入口。
//
// 同一扩展的内容脚本共享一个隔离环境，所以直接挂在 globalThis 上即可互相访问。
(function () {
  'use strict';
  if (globalThis.SS_ERP_DOCK || window.top !== window) return;

  var TABS = [
    { id: 'workbench', label: '上架工作台', hint: '在 1688 商品页打开' },
    { id: 'collect', label: '采集 / 跟卖', hint: '在 Ozon 商品页使用' },
    { id: 'profit', label: '利润计算', hint: '在 Ozon 或 1688 商品页使用' },
    { id: 'product', label: '商品信息', hint: '在 Ozon 商品页使用' },
  ];
  var handlers = new Map();   // id -> { open, close?, isOpen?, isBusy?, label?, title? }
  var actions = new Map();    // id -> { label, run }
  var host = null, menu = null, list = null, extra = null, statusNode = null, toggle = null;
  var statusText = '';

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
  function isOpen(id) { var h = handlers.get(id); return Boolean(h && h.isOpen && safe(h.isOpen, false)); }

  function setMenu(open) {
    if (!menu) return;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) render();
  }

  function activate(id) {
    var handler = handlers.get(id);
    if (!handler) return;
    if (isOpen(id) && handler.close) { safe(handler.close); setMenu(false); return; }
    // 同一时间只展开一个功能面板
    handlers.forEach(function (other, otherId) { if (otherId !== id && other.close && isOpen(otherId)) safe(other.close); });
    setMenu(false);
    Promise.resolve().then(handler.open).catch(function (error) {
      setStatus(String(error && error.message || error).slice(0, 80));
      setMenu(true);
    });
  }

  function render() {
    if (!host) return;
    list.replaceChildren.apply(list, TABS.map(function (tab) {
      var handler = handlers.get(tab.id);
      var button = make('button', 'ss-dock-tab', handler && handler.label || tab.label);
      button.type = 'button';
      button.dataset.dockTab = tab.id;
      button.disabled = !handler || Boolean(handler.isBusy && safe(handler.isBusy, false));
      button.title = handler ? (handler.title || tab.label) : '当前页面不适用：' + tab.hint;
      if (isOpen(tab.id)) button.classList.add('is-active');
      button.addEventListener('click', function (event) { if (event.isTrusted) activate(tab.id); });
      return button;
    }));
    extra.replaceChildren.apply(extra, Array.from(actions.entries()).map(function (entry) {
      var button = make('button', 'ss-dock-action', entry[1].label);
      button.type = 'button';
      button.dataset.dockAction = entry[0];
      button.addEventListener('click', function (event) { if (event.isTrusted) safe(entry[1].run); });
      return button;
    }));
    extra.hidden = actions.size === 0;
    statusNode.textContent = statusText;
    statusNode.hidden = !statusText;
  }

  function mount() {
    if (host || !document.documentElement) return;
    host = make('div');
    host.id = 'ss-erp-dock';
    host.classList.add('notranslate');
    host.setAttribute('translate', 'no');
    toggle = make('button', 'ss-dock-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-controls', 'ss-erp-dock-menu');
    toggle.title = 'SS ERP';
    toggle.append(make('span', 'ss-dock-mark', 'SS'), make('span', 'ss-dock-name', 'ERP'));
    menu = make('div', 'ss-dock-menu');
    menu.id = 'ss-erp-dock-menu';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'SS ERP 功能');
    list = make('div', 'ss-dock-tabs');
    extra = make('div', 'ss-dock-actions');
    statusNode = make('p', 'ss-dock-status');
    statusNode.setAttribute('role', 'status');
    menu.append(list, extra, statusNode);
    host.append(toggle, menu);
    document.documentElement.appendChild(host);
    setMenu(false);
    toggle.addEventListener('click', function (event) { if (event.isTrusted) setMenu(menu.hidden); });
    document.addEventListener('pointerdown', function (event) { if (!menu.hidden && !host.contains(event.target)) setMenu(false); }, true);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !menu.hidden) setMenu(false); }, true);
    // 功能面板展开时收起入口，避免压在面板上；面板关闭后入口回来。
    setInterval(function () {
      var open = TABS.some(function (tab) { return isOpen(tab.id); });
      if (host.classList.contains('is-covered') !== open) host.classList.toggle('is-covered', open);
    }, 400);
  }

  function setStatus(text) {
    statusText = String(text || '').slice(0, 120);
    if (menu && menu.hidden && toggle) toggle.title = statusText ? 'SS ERP · ' + statusText : 'SS ERP';
    render();
  }

  globalThis.SS_ERP_DOCK = Object.freeze({
    /** 接入一个标签。返回 true 表示入口已由 dock 接管，调用方应隐藏自己的悬浮按钮。 */
    register: function (id, handler) {
      if (!TABS.some(function (tab) { return tab.id === id; }) || !handler || typeof handler.open !== 'function') return false;
      handlers.set(id, handler);
      mount();
      render();
      return true;
    },
    /** 功能离开当前页面时注销标签（例如单页应用里从商品页跳到列表页），标签回到置灰。 */
    unregister: function (id) {
      if (handlers.delete(id)) render();
    },
    /** 更新某个标签的文案或提示（例如加载失败）。 */
    update: function (id, patch) {
      var handler = handlers.get(id);
      if (!handler) return;
      handlers.set(id, Object.assign({}, handler, patch || {}));
      render();
    },
    /** 页面级的次要动作（不占标签位）。 */
    addAction: function (id, action) {
      if (!action || typeof action.run !== 'function') return;
      actions.set(String(id), { label: String(action.label || id), run: action.run });
      mount();
      render();
    },
    removeAction: function (id) {
      if (actions.delete(String(id))) render();
    },
    setStatus: setStatus,
    tabs: function () { return TABS.map(function (tab) { return tab.id; }); },
  });
})();
