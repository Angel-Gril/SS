(function () {
  if (window.__OZON_CALC_INJECTED__) return;
  window.__OZON_CALC_INJECTED__ = true;

  function mount() {
    if (!document.body) return;

    const fab = document.createElement('button');
    fab.id = 'ozon-calc-fab';
    fab.type = 'button';
    fab.classList.add('notranslate');
    fab.setAttribute('translate', 'no');
    fab.setAttribute('lang', 'zh-CN');
    fab.textContent = '算价';

    const drawer = document.createElement('aside');
    drawer.id = 'ozon-calc-drawer';
    drawer.classList.add('notranslate');
    drawer.setAttribute('translate', 'no');
    drawer.setAttribute('lang', 'zh-CN');
    drawer.innerHTML = [
      '<div class="ozon-calc-header">',
      '  <div class="ozon-calc-brand-mark">算</div>',
      '  <div class="ozon-calc-brand-text">',
      '    <div class="ozon-calc-brand-name">ozon计算器</div>',
      '    <div class="ozon-calc-brand-sub">价格核算 · 物流同步</div>',
      '  </div>',
      '  <div class="ozon-calc-header-spacer"></div>',
      '  <div class="ozon-calc-sku-chip" data-product-code>—</div>',
      '  <div class="ozon-calc-header-actions">',
      '    <button class="ozon-calc-refresh" type="button" aria-label="刷新">刷新</button>',
      '    <button class="ozon-calc-close" type="button" aria-label="关闭">×</button>',
      '  </div>',
      '</div>',
      '<div class="ozon-calc-body"></div>'
    ].join('');

    document.body.appendChild(fab);
    document.body.appendChild(drawer);

    const body = drawer.querySelector('.ozon-calc-body');
    const header = drawer.querySelector('.ozon-calc-header');
    const headerActions = drawer.querySelector('.ozon-calc-header-actions');
    const refreshButton = drawer.querySelector('.ozon-calc-refresh');
    const closeButton = drawer.querySelector('.ozon-calc-close');
    const storageKey = 'ozon-calc:fab-position';
    let pointerState = null;
    let moved = false;
    let drawerPointerState = null;
    let drawerMoved = false;

    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
          fab.style.left = parsed.left + 'px';
          fab.style.top = parsed.top + 'px';
          fab.style.right = 'auto';
          fab.style.transform = 'none';
        }
      }
    } catch (error) {}

    function openDrawer(options) {
      drawer.classList.add('open');
      if (!drawerMoved) {
        drawer.style.left = '';
        drawer.style.right = '16px';
        drawer.style.top = '80px';
        drawer.style.height = '';
      }
      fab.style.display = 'none';
      window.OZON_CALC_OZON_PANEL.renderDrawerContent(body);
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      fab.style.display = '';
    }

    function onDrawerPointerMove(event) {
      if (!drawerPointerState) return;
      const nextLeft = drawerPointerState.startLeft + (event.clientX - drawerPointerState.startX);
      const nextTop = drawerPointerState.startTop + (event.clientY - drawerPointerState.startY);
      drawerMoved = true;
      drawer.style.left = Math.max(0, Math.min(window.innerWidth - 220, nextLeft)) + 'px';
      drawer.style.right = 'auto';
      drawer.style.top = Math.max(0, Math.min(window.innerHeight - 120, nextTop)) + 'px';
      drawer.style.height = 'calc(100vh - ' + Math.max(0, nextTop) + 'px)';
    }

    function onDrawerPointerUp() {
      if (!drawerPointerState) return;
      drawerPointerState = null;
      window.removeEventListener('pointermove', onDrawerPointerMove);
      window.removeEventListener('pointerup', onDrawerPointerUp);
    }

    function onPointerMove(event) {
      if (!pointerState) return;
      const nextLeft = pointerState.startLeft + (event.clientX - pointerState.startX);
      const nextTop = pointerState.startTop + (event.clientY - pointerState.startY);
      if (Math.abs(event.clientX - pointerState.startX) > 4 || Math.abs(event.clientY - pointerState.startY) > 4) {
        moved = true;
      }
      fab.style.left = Math.max(8, Math.min(window.innerWidth - fab.offsetWidth - 8, nextLeft)) + 'px';
      fab.style.top = Math.max(8, Math.min(window.innerHeight - fab.offsetHeight - 8, nextTop)) + 'px';
      fab.style.right = 'auto';
      fab.style.transform = 'none';
    }

    function onPointerUp() {
      if (!pointerState) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({
          left: parseFloat(fab.style.left) || 0,
          top: parseFloat(fab.style.top) || 0,
        }));
      } catch (error) {}
      pointerState = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }

    fab.addEventListener('pointerdown', function (event) {
      moved = false;
      fab.setPointerCapture && fab.setPointerCapture(event.pointerId);
      const rect = fab.getBoundingClientRect();
      pointerState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    fab.addEventListener('click', function (event) {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
        return;
      }
      openDrawer({ manual: true });
    });

    header.addEventListener('pointerdown', function (event) {
      if (headerActions && headerActions.contains(event.target)) {
        return;
      }
      const rect = drawer.getBoundingClientRect();
      drawerPointerState = {
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      };
      header.setPointerCapture && header.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove', onDrawerPointerMove);
      window.addEventListener('pointerup', onDrawerPointerUp);
    });

    closeButton.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    closeButton.addEventListener('pointerup', function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
    });
    closeButton.addEventListener('click', closeDrawer);
    refreshButton.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    refreshButton.addEventListener('pointerup', function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.OZON_CALC_OZON_PANEL.renderDrawerContent(body);
    });
    refreshButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      window.OZON_CALC_OZON_PANEL.renderDrawerContent(body);
    });

    // 入口由统一 dock 接管时，隐藏自己的悬浮按钮（见 content/ss-dock.js）
    if (globalThis.SS_ERP_DOCK && globalThis.SS_ERP_DOCK.register('profit', {
      open: function () { openDrawer({ manual: true }); },
      close: closeDrawer,
      isOpen: function () { return drawer.classList.contains('open'); },
      title: '价格核算 · 物流同步',
    })) fab.dataset.ssDocked = 'true';

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}());
