// 在 ozon.ru 前台商品列表页注入「采集状态 / ERP 利润预估」小卡片。
// 数据源：OZON 公开 entrypoint API（不需要 seller cookie）
// 通信：通过 chrome.runtime.sendMessage 查询 ERP 后端商品采集状态

(function () {
  if (window.__SS_ERP_LIST_OVERLAY__) return;
  window.__SS_ERP_LIST_OVERLAY__ = true;

  const PROCESSED_ATTR = 'data-ss-erp-overlay';
  const CARD_SELECTORS = [
    '[data-widget="searchResultsV2"] [data-index]',
    '[data-widget="skuShelfGoods"] [data-index]',
    '[data-widget="skuGrid"] [data-index]',
    '[data-widget="tileGridDesktop"] [data-index]',
  ];

  function isProductPage() {
    const href = location.href;
    if (href.includes('/product/')) return false;
    if (href.includes('seller.ozon.')) return false;
    return /ozon\.(ru|kz|by)/.test(href);
  }

  function extractSku(card) {
    const link = card.querySelector('a[href*="/product/"]');
    if (!link) return null;
    const m = link.getAttribute('href').match(/\/product\/[^/]*-(\d+)/);
    return m ? m[1] : null;
  }

  function buildOverlay(sku) {
    const wrap = document.createElement('div');
    wrap.className = 'ss-erp-overlay-card';
    wrap.style.cssText = [
      'margin-top: 8px',
      'padding: 8px 10px',
      'border-radius: 8px',
      'background: linear-gradient(135deg, #f0f7ff, #e8f0fe)',
      'border: 1px solid #c7d2fe',
      'font-size: 12px',
      'color: #1e3a8a',
      'box-shadow: 0 1px 2px rgba(0,0,0,0.04)',
    ].join(';');
    wrap.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center">',
      '  <span style="font-weight:600">SS ERP</span>',
      '  <span style="font-size:10px;opacity:0.6">SKU ' + sku + '</span>',
      '</div>',
      '<div class="ss-erp-overlay-status" style="margin-top:4px;color:#475569">查询中...</div>',
      '<div class="ss-erp-overlay-actions" style="margin-top:6px;display:flex;gap:6px">',
      '  <button class="ss-erp-collect-btn" type="button" style="flex:1;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#1e40af">采集到 ERP</button>',
      '</div>',
    ].join('');
    return wrap;
  }

  function queryErpStatus(sku) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(
          { type: 'ss-erp:query-collect-status', sku: sku },
          function (resp) {
            if (chrome.runtime.lastError || !resp) {
              resolve({ ok: false });
              return;
            }
            resolve(resp);
          },
        );
      } catch (e) {
        resolve({ ok: false });
      }
    });
  }

  function attachOverlay(card) {
    if (card.getAttribute(PROCESSED_ATTR)) return;
    const sku = extractSku(card);
    if (!sku) return;
    card.setAttribute(PROCESSED_ATTR, '1');

    const overlay = buildOverlay(sku);
    const statusEl = overlay.querySelector('.ss-erp-overlay-status');
    const collectBtn = overlay.querySelector('.ss-erp-collect-btn');

    card.appendChild(overlay);

    queryErpStatus(sku).then(function (resp) {
      if (resp && resp.ok && resp.collected) {
        statusEl.textContent = '已在 ERP 中（' + (resp.shopName || '已采集') + '）';
        statusEl.style.color = '#15803d';
        collectBtn.disabled = true;
        collectBtn.textContent = '已采集';
        collectBtn.style.opacity = '0.5';
        collectBtn.style.cursor = 'default';
      } else if (resp && resp.ok) {
        statusEl.textContent = '未采集';
      } else {
        statusEl.textContent = '未连接 ERP（请在扩展配置中登录）';
        statusEl.style.color = '#92400e';
      }
    });

    collectBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      collectBtn.disabled = true;
      collectBtn.textContent = '提交中...';
      const productUrl = (card.querySelector('a[href*="/product/"]') || {}).href || '';
      chrome.runtime.sendMessage(
        { type: 'ss-erp:collect-product', sku: sku, url: productUrl },
        function (resp) {
          if (resp && resp.ok) {
            statusEl.textContent = '已提交采集任务';
            statusEl.style.color = '#15803d';
            collectBtn.textContent = '已提交';
          } else {
            statusEl.textContent = (resp && resp.msg) || '提交失败';
            statusEl.style.color = '#b91c1c';
            collectBtn.disabled = false;
            collectBtn.textContent = '重试';
          }
        },
      );
    });
  }

  function scan() {
    if (!isProductPage()) return;
    CARD_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(attachOverlay);
    });
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(function () {
      scanScheduled = false;
      scan();
    }, 300);
  }

  function init() {
    if (!isProductPage()) return;
    scan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
