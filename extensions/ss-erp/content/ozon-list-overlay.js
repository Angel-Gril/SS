// SS ERP Ozon 列表页增强
// 数据来源（多层降级）：
//   1. DOM 提取（标题/价格/评分/评论/图片/SKU）
//   2. OZON 公开 entrypoint API（销量/卖家/库存等，无需登录）
//   3. seller-analytics API（Premium 数据，需登录 + Premium）
//   4. SS ERP 缓存（其他用户已提交的数据）
//   5. 实在拿不到的字段显示 "--"，不阻塞卡片渲染
// 设计原则：
//   - 采集状态只走批量快照，失败时降级为未知状态，不阻塞列表卡片。
//   - 进入视口自动加载 Premium 数据，不等用户展开。

(function () {
  if (window.__SS_ERP_LIST_OVERLAY__) return;
  window.__SS_ERP_LIST_OVERLAY__ = true;

  const PROCESSED_ATTR = 'data-ss-erp-overlay';
  const SKU_ATTR = 'data-ss-erp-overlay-sku';
  const CARD_CLASS = 'ss-erp-overlay-card';
  const PORTAL_ATTR = 'data-ss-erp-portal';
  const CARD_SELECTORS = [
    '[data-widget="searchResultsV2"] [data-index]',
    '[data-widget="skuShelfGoods"] [data-index]',
    '[data-widget="skuGridSimple"] [data-index]',
    '[data-widget="skuGrid"] [data-index]',
    '[data-widget="tileGridDesktop"] [data-index]',
    '[data-widget="tileGrid"] [data-index]',
    '#layoutPage [data-index]',
  ];

  const PREMIUM_TTL_MS = 10 * 60 * 1000;
  const PREMIUM_FAILURE_TTL_MS = 90 * 1000;
  const PREMIUM_CONCURRENCY = 3;
  const COLLECT_SNAPSHOT_TTL_MS = 60 * 1000;
  const COLLECT_SNAPSHOT_BATCH_DELAY_MS = 120;
  const CARD_SCAN_FAST_MS = 500;
  const CARD_SCAN_SLOW_MS = 2000;
  const CARD_SCAN_FAST_UNTIL_MS = 20 * 1000;

  // === 工具：缓存 ===
  const premiumCache = new Map();  // sku -> { data, ts }
  const collectSnapshotCache = new Map(); // sku -> { data, ts }
  const failedPremiumCache = new Map(); // sku -> ts
  const inFlightPremium = new Map(); // sku -> Promise
  const premiumQueue = [];
  const pendingCollectSnapshotSkus = new Set();
  const collectSnapshotSubscribers = new Map();
  let activePremiumRequests = 0;
  let collectSnapshotTimer = null;
  let overlayIdCounter = 0;
  let activeExpandedPanel = null;
  let expandedPanelListenersInstalled = false;

  function getCached(map, key, ttl) {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > ttl) {
      map.delete(key);
      return null;
    }
    return hit.data;
  }

  function setCached(map, key, data) {
    map.set(key, { data, ts: Date.now() });
  }

  function enqueuePremiumRequest(task) {
    return new Promise((resolve) => {
      premiumQueue.push({ task, resolve });
      drainPremiumQueue();
    });
  }

  function drainPremiumQueue() {
    while (activePremiumRequests < PREMIUM_CONCURRENCY && premiumQueue.length) {
      const next = premiumQueue.shift();
      activePremiumRequests += 1;
      Promise.resolve()
        .then(next.task)
        .then(
          (value) => next.resolve(value),
          () => next.resolve(null),
        )
        .finally(() => {
          activePremiumRequests -= 1;
          drainPremiumQueue();
        });
    }
  }

  // === 工具：DOM 解析 ===
  function isProductPage() {
    const href = location.href;
    if (href.includes('/product/')) return false;
    if (href.includes('seller.ozon.')) return false;
    return /ozon\.(ru|kz|by)/.test(href);
  }

  function extractSkuFromHref(href) {
    if (!href) return null;
    const text = String(href);
    const m = text.match(/\/product\/[^/?#]*-(\d+)(?:[/?#]|$)/) || text.match(/\/product\/(\d+)(?:[/?#]|$)/);
    return m ? m[1] : null;
  }

  function getProductLinks(root) {
    if (!root || !root.querySelectorAll) return [];
    const links = [];
    if (root.matches && root.matches('a[href*="/product/"]')) links.push(root);
    root.querySelectorAll('a[href*="/product/"]').forEach((link) => links.push(link));
    return links;
  }

  function collectDistinctProductSkus(root) {
    const skus = new Set();
    getProductLinks(root).forEach((link) => {
      const sku = extractSkuFromHref(link.getAttribute('href') || '');
      if (sku) skus.add(sku);
    });
    return skus;
  }

  function countDistinctProductSkus(root) {
    return collectDistinctProductSkus(root).size;
  }

  function findSingleSkuAncestor(link, boundary) {
    let best = null;
    let el = link && link.parentElement;

    while (el && el !== document.body && el !== document.documentElement) {
      const skuCount = countDistinctProductSkus(el);
      if (skuCount === 1) best = el;
      if (skuCount > 1) break;
      if (el === boundary) break;
      el = el.parentElement;
    }

    return best;
  }

  function resolveProductCardTarget(candidate, link) {
    const target = link ? findSingleSkuAncestor(link, candidate) : candidate;
    if (!target || countDistinctProductSkus(target) !== 1) return null;
    return target;
  }

  function collectProductCardTargets(candidate) {
    const skuCount = countDistinctProductSkus(candidate);
    if (skuCount === 0) return [];
    if (skuCount === 1) {
      const target = resolveProductCardTarget(candidate);
      return target ? [target] : [];
    }

    const targetsBySku = new Map();
    getProductLinks(candidate).forEach((link) => {
      const sku = extractSkuFromHref(link.getAttribute('href') || '');
      if (!sku) return;

      const target = resolveProductCardTarget(candidate, link);
      if (!target) return;

      const existing = targetsBySku.get(sku);
      if (!existing || target.contains(existing)) targetsBySku.set(sku, target);
    });

    return Array.from(new Set(targetsBySku.values()));
  }

  function addProductCardTarget(targets, target) {
    const sku = extractSku(target);
    if (!sku) return;

    for (const existing of Array.from(targets)) {
      if (extractSku(existing) !== sku) continue;
      if (existing.contains(target)) return;
      if (target.contains(existing)) targets.delete(existing);
    }

    targets.add(target);
  }

  function extractSku(card) {
    const link = card.querySelector('a[href*="/product/"]');
    if (!link) return null;
    return extractSkuFromHref(link.getAttribute('href') || '');
  }

  function extractCardData(card) {
    const link = card.querySelector('a[href*="/product/"]');
    const href = link ? link.getAttribute('href') : '';
    const url = href ? (href.startsWith('http') ? href : 'https://www.ozon.ru' + href) : '';

    let title = '';
    if (link) {
      title = link.getAttribute('title') || '';
      if (!title) {
        const span = link.querySelector('span');
        title = span ? (span.textContent || '').trim() : (link.textContent || '').trim();
      }
    }

    const img = card.querySelector('img');
    const image = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';

    const priceTexts = [];
    card.querySelectorAll('span').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/\d.*(?:₽|¥|￥|₸|\b(?:CNY|RMB|RUB|BYN|KZT)\b)/i.test(t) && t.length < 30) priceTexts.push(t);
    });
    const price = parsePrice(priceTexts[0] || '');
    const oldPrice = parsePrice(priceTexts[1] || '');
    const discount = (price && oldPrice && oldPrice > price)
      ? Math.round((1 - price / oldPrice) * 100)
      : null;

    let rating = null;
    let reviews = null;
    const ratingEl = card.querySelector('[aria-label*="rating" i], [aria-label*="оценка" i]');
    if (ratingEl) {
      const lbl = ratingEl.getAttribute('aria-label') || '';
      const r = lbl.match(/(\d+[.,]\d+)/);
      if (r) rating = parseFloat(r[1].replace(',', '.'));
    }
    if (rating == null) {
      card.querySelectorAll('span').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (rating == null && /^[0-4]\.\d$|^5\.0$/.test(t)) rating = parseFloat(t);
      });
    }
    card.querySelectorAll('span').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (reviews == null) {
        let m = t.match(/^\((\d[\d\s]*)\)$/);
        if (!m) m = t.match(/(\d[\d\s]*)\s*(отзыв|review)/i);
        if (m) reviews = parseInt(m[1].replace(/\s/g, ''), 10);
      }
    });

    return { url, title, image, price, oldPrice, discount, rating, reviews };
  }

  function parsePrice(text) {
    if (!text) return null;
    const helper = globalThis.SS_ERP_PRICE_CURRENCY;
    const normalized = helper && helper.normalizePriceText
      ? helper.normalizePriceText(text)
      : String(text).replace(/[^\d.,]/g, '').replace(',', '.');
    if (!normalized) return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }

  // === 工具：消息发送 ===
  function send(msg, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, msg: '通信超时' });
      }, timeoutMs || 8000);
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ ok: false, msg: chrome.runtime.lastError.message || '通信失败' });
            return;
          }
          resolve(resp || { ok: false, msg: '无响应' });
        });
      } catch (e) {
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, msg: e && e.message ? e.message : String(e) });
      }
    });
  }

  function getCollectSnapshot(sku) {
    return getCached(collectSnapshotCache, sku, COLLECT_SNAPSHOT_TTL_MS);
  }

  function setCollectSnapshot(sku, data) {
    setCached(collectSnapshotCache, sku, data || { collected: false });
  }

  function subscribeCollectSnapshot(sku, callback) {
    if (!collectSnapshotSubscribers.has(sku)) {
      collectSnapshotSubscribers.set(sku, new Set());
    }
    collectSnapshotSubscribers.get(sku).add(callback);
    return () => {
      const subscribers = collectSnapshotSubscribers.get(sku);
      if (!subscribers) return;
      subscribers.delete(callback);
      if (!subscribers.size) collectSnapshotSubscribers.delete(sku);
    };
  }

  function notifyCollectSnapshot(sku) {
    const subscribers = collectSnapshotSubscribers.get(sku);
    if (!subscribers || !subscribers.size) return;
    const snapshot = getCollectSnapshot(sku);
    subscribers.forEach((callback) => {
      try { callback(snapshot); } catch (e) {}
    });
  }

  function queueCollectSnapshot(sku, force) {
    if (!sku) return;
    if (!force && getCollectSnapshot(sku)) return;
    pendingCollectSnapshotSkus.add(sku);
    if (collectSnapshotTimer) return;
    collectSnapshotTimer = setTimeout(() => {
      collectSnapshotTimer = null;
      fetchCollectSnapshots();
    }, COLLECT_SNAPSHOT_BATCH_DELAY_MS);
  }

  async function fetchCollectSnapshots() {
    const skus = Array.from(pendingCollectSnapshotSkus).slice(0, 100);
    pendingCollectSnapshotSkus.clear();
    if (!skus.length) return;

    const resp = await send(
      { type: 'ss-erp:query-collect-batch-snapshot', skus },
      12000,
    );

    if (!resp || !resp.ok) {
      skus.forEach((sku) => {
        setCollectSnapshot(sku, {
          collected: false,
          unavailable: true,
          error: (resp && (resp.msg || resp.error)) || 'ERP 未连接',
        });
        notifyCollectSnapshot(sku);
      });
      return;
    }

    const rows = resp.data || {};
    skus.forEach((sku) => {
      setCollectSnapshot(sku, rows[sku] || { collected: false });
      notifyCollectSnapshot(sku);
    });
  }

  // === 公开 API：拉商品基础信息（含销量/卖家等可选字段）===
  // 通过 background 聚合 seller-analytics、公开 entrypoint 和 ERP 缓存；失败时保持基础卡片。
  async function fetchPublicProduct(sku) {
    const cached = getCached(premiumCache, sku, PREMIUM_TTL_MS);
    if (cached) return cached;

    const failTs = failedPremiumCache.get(sku);
    if (failTs && Date.now() - failTs < PREMIUM_FAILURE_TTL_MS) return null;
    if (inFlightPremium.has(sku)) return inFlightPremium.get(sku);

    const request = enqueuePremiumRequest(async () => {
      const resp = await send(
        { type: 'spb-self-hosted:aggregate-product-insights', productId: sku },
        20000,
      );
      return resp;
    }).then((resp) => {
      if (!resp || !resp.ok || !resp.item) {
        failedPremiumCache.set(sku, Date.now());
        return null;
      }

      const data = Object.assign({}, resp.item, { _sources: resp.sources || [] });
      setCached(premiumCache, sku, data);
      failedPremiumCache.delete(sku);
      return data;
    }).finally(() => {
      inFlightPremium.delete(sku);
    });

    inFlightPremium.set(sku, request);
    return request;
  }

  // === 字段提取（聚合接口扁平格式 + 兼容旧的 item/_insightsItem 嵌套）===
  function pickFlat(p, key) {
    if (!p) return null;
    if (p[key] != null) return p[key];
    const i = p._insightsItem || p.item;
    if (i && i[key] != null) return i[key];
    return null;
  }
  function pickSales(p) { const v = pickFlat(p, 'soldCount'); return v == null ? null : Number(v) || 0; }
  function pickGmv(p) { const v = pickFlat(p, 'soldSum'); return v == null ? null : Math.round(Number(v)); }
  function pickAddCart(p) { const v = pickFlat(p, 'convToCartPdp'); return v == null ? null : (Number(v) * 100).toFixed(1); }
  function pickViews(p) { const v = pickFlat(p, 'views'); return v == null ? null : Number(v); }
  function pickStock(p) { const v = pickFlat(p, 'stock'); return v == null ? null : Number(v); }
  function pickSeller(p) { return pickFlat(p, 'sellerName'); }
  function pickAvgPrice(p) { const v = pickFlat(p, 'avgPrice'); return v == null ? null : Math.round(Number(v)); }
  function pickMinPrice(p) { const v = pickFlat(p, 'minSellerPrice'); return v == null ? null : Math.round(Number(v)); }
  function pickDeliveryDays(p) { return pickFlat(p, 'avgDeliveryDays'); }
  function pickSalesDynamics(p) { const v = pickFlat(p, 'salesDynamics'); return v == null ? null : Number(v).toFixed(1); }
  function pickWeight(p) { return pickFlat(p, 'weightGrams'); }
  function pickDims(p) {
    const l = pickFlat(p, 'lengthMm');
    const w = pickFlat(p, 'widthMm');
    const h = pickFlat(p, 'heightMm');
    if (l == null && w == null && h == null) return null;
    return `${l || '?'}×${w || '?'}×${h || '?'}`;
  }
  function pickCreateDate(p) {
    const v = pickFlat(p, 'nullableCreateDate');
    return v ? formatDate(v) : null;
  }

  // === 工具：格式化 ===
  function formatNum(n) {
    if (n == null) return '--';
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n);
    if (num >= 10000) return (num / 10000).toFixed(1) + '万';
    if (num >= 1000) return num.toLocaleString();
    return String(num);
  }
  function formatDate(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '--';
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      return sameDay
        ? d.toTimeString().slice(0, 5)
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch (e) {
      return '--';
    }
  }
  function truncate(s, n) {
    if (!s) return '--';
    s = String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function escapeHtml(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isShelfCard(card) {
    return Boolean(card.closest('[data-widget="skuShelfGoods"]'));
  }

  function findDeliveryDateBlock(card) {
    const monthPattern = '(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)';
    const dateRe = new RegExp(`\\b\\d{1,2}\\s+${monthPattern}\\b`, 'i');
    const candidates = Array.from(card.querySelectorAll('div, button'));
    let best = null;

    for (const el of candidates) {
      if (el.classList && el.classList.contains(CARD_CLASS)) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!dateRe.test(text)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 20 || rect.height > 80) continue;

      const style = getComputedStyle(el);
      const bg = style.backgroundColor || '';
      const looksLikeOzonDelivery = bg.includes('255') || text.length <= 20;
      if (!looksLikeOzonDelivery) continue;

      const area = rect.width * rect.height;
      if (!best || area < best.area) best = { el, area };
    }

    return best ? best.el : null;
  }

  function insertOverlay(card, wrap) {
    if (isShelfCard(card)) {
      const deliveryBlock = findDeliveryDateBlock(card);
      if (deliveryBlock && deliveryBlock.parentElement && card.contains(deliveryBlock.parentElement)) {
        deliveryBlock.parentElement.insertBefore(wrap, deliveryBlock);
        return;
      }
    }

    card.appendChild(wrap);
  }

  // === 渲染卡片 ===
  function buildCard(sku, dom) {
    const wrap = document.createElement('div');
    wrap.className = CARD_CLASS;
    wrap.setAttribute('data-ss-erp-sku', sku);
    wrap.style.cssText = [
      'margin:0',           // 紧贴上沿，不留缝
      'padding:8px 10px',
      'border-radius:8px',
      'background:linear-gradient(135deg,#fff7ed,#ffedd5)',
      'border:1px solid #fdba74',
      'font-size:12px',
      'color:#1e293b',
      'box-shadow:0 1px 4px rgba(249,115,22,0.12)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-sizing:border-box',
      'width:100%',
      'position:relative',
      'z-index:1',
      'overflow:visible',
    ].join(';');

    wrap.innerHTML = [
      '<div class="ss-erp-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
      '  <span style="font-weight:700;color:#c2410c;font-size:13px">SS ERP</span>',
      '  <span class="ss-erp-status-pill" style="font-size:10px;padding:2px 8px;border-radius:10px;background:#ffedd5;color:#9a3412;border:1px solid #fdba74">加载中…</span>',
      '</div>',
      '<div class="ss-erp-metrics" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px"></div>',
      '<div class="ss-erp-actions" style="display:flex;gap:6px;align-items:flex-start">',
      '  <div class="ss-erp-collect-actions" style="display:flex;flex:1;min-width:0"></div>',
      '  <button class="ss-erp-expand-btn" type="button" style="padding:5px 10px;border:1px solid #fdba74;border-radius:6px;background:#fff7ed;color:#c2410c;cursor:pointer;font-size:11px">展开</button>',
      '</div>',
    ].join('');

    renderMetrics(wrap, sku, dom, null);
    renderCollectActions(wrap, sku, dom, null);
    return wrap;
  }

  function getExpandedPanel(wrap) {
    return wrap && wrap.__ssErpExpandedPanel ? wrap.__ssErpExpandedPanel : null;
  }

  function createExpandedPortal(wrap, sku) {
    const expanded = document.createElement('div');
    const anchorId = `ss-erp-overlay-${Date.now()}-${++overlayIdCounter}`;

    wrap.setAttribute('data-ss-erp-overlay-id', anchorId);
    expanded.className = 'ss-erp-expanded';
    expanded.setAttribute(PORTAL_ATTR, '1');
    expanded.setAttribute('data-ss-erp-anchor-id', anchorId);
    expanded.setAttribute('data-ss-erp-sku', sku);
    expanded.setAttribute('aria-hidden', 'true');
    expanded.style.cssText = [
      'display:none',
      'position:fixed',
      'left:8px',
      'top:8px',
      'z-index:2147483000',
      'box-sizing:border-box',
      'padding:8px 10px',
      'border:1px solid #fdba74',
      'border-radius:8px',
      'background:#fff7ed',
      'box-shadow:0 10px 24px rgba(15,23,42,0.18)',
      'max-height:min(520px,70vh)',
      'overflow:auto',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');
    expanded.addEventListener('click', (e) => e.stopPropagation());

    document.body.appendChild(expanded);
    wrap.__ssErpExpandedPanel = expanded;
    return expanded;
  }

  function removeExpandedPortal(wrap) {
    const expanded = getExpandedPanel(wrap);
    if (!expanded) return;

    if (activeExpandedPanel && activeExpandedPanel.expanded === expanded) {
      activeExpandedPanel = null;
    }
    expanded.remove();
    wrap.__ssErpExpandedPanel = null;
  }

  function cleanupDetachedExpandedPanels() {
    document.querySelectorAll(`.ss-erp-expanded[${PORTAL_ATTR}="1"]`).forEach((expanded) => {
      const anchorId = expanded.getAttribute('data-ss-erp-anchor-id');
      if (anchorId && document.querySelector(`[data-ss-erp-overlay-id="${anchorId}"]`)) return;

      if (activeExpandedPanel && activeExpandedPanel.expanded === expanded) {
        activeExpandedPanel = null;
      }
      expanded.remove();
    });
  }

  function positionExpandedPanel(wrap, expanded) {
    if (!wrap || !wrap.isConnected || !expanded) return;

    const rect = wrap.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    const maxViewportWidth = Math.max(160, viewportWidth - viewportPadding * 2);
    const width = Math.max(220, Math.min(rect.width, maxViewportWidth));
    const leftLimit = viewportWidth - width - viewportPadding;
    const left = Math.max(viewportPadding, Math.min(rect.left, leftLimit));
    const spaceBelow = viewportHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    const availableHeight = Math.max(140, openBelow ? spaceBelow : spaceAbove);
    const maxHeight = Math.min(520, availableHeight);
    const top = openBelow
      ? Math.max(viewportPadding, rect.bottom + gap)
      : Math.max(viewportPadding, rect.top - gap - maxHeight);

    expanded.style.width = `${Math.round(width)}px`;
    expanded.style.left = `${Math.round(left)}px`;
    expanded.style.top = `${Math.round(top)}px`;
    expanded.style.maxHeight = `${Math.round(maxHeight)}px`;
  }

  function closeActiveExpandedPanel(exceptExpanded) {
    if (!activeExpandedPanel || activeExpandedPanel.expanded === exceptExpanded) return;

    const current = activeExpandedPanel;
    activeExpandedPanel = null;
    if (current.expanded && current.expanded.isConnected) {
      current.expanded.style.display = 'none';
      current.expanded.setAttribute('aria-hidden', 'true');
    }
    if (current.expandBtn) current.expandBtn.textContent = '展开';
    if (current.wrap) {
      current.wrap.classList.remove('ss-erp-overlay-card-expanded');
      current.wrap.style.zIndex = '1';
    }
  }

  function repositionActiveExpandedPanel() {
    if (!activeExpandedPanel) return;
    if (!activeExpandedPanel.wrap || !activeExpandedPanel.wrap.isConnected) {
      closeActiveExpandedPanel();
      return;
    }
    positionExpandedPanel(activeExpandedPanel.wrap, activeExpandedPanel.expanded);
  }

  function ensureExpandedPanelListeners() {
    if (expandedPanelListenersInstalled) return;
    expandedPanelListenersInstalled = true;

    window.addEventListener('scroll', repositionActiveExpandedPanel, true);
    window.addEventListener('resize', repositionActiveExpandedPanel);
    document.addEventListener('click', () => closeActiveExpandedPanel());
  }

  function setExpandedPanelOpen(wrap, expanded, expandBtn, isOpen) {
    if (!expanded) return;

    if (isOpen) {
      closeActiveExpandedPanel(expanded);
      ensureExpandedPanelListeners();
      positionExpandedPanel(wrap, expanded);
      activeExpandedPanel = { wrap, expanded, expandBtn };
    } else if (activeExpandedPanel && activeExpandedPanel.expanded === expanded) {
      activeExpandedPanel = null;
    }

    expanded.style.display = isOpen ? 'block' : 'none';
    expanded.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (expandBtn) expandBtn.textContent = isOpen ? '收起' : '展开';
    wrap.classList.toggle('ss-erp-overlay-card-expanded', isOpen);
    wrap.style.zIndex = isOpen ? '2147483000' : '1';
  }

  function renderMetrics(wrap, sku, dom, premium) {
    const grid = wrap.querySelector('.ss-erp-metrics');
    const pill = wrap.querySelector('.ss-erp-status-pill');

    // 数据源徽章（替代原本的 ERP 状态徽章——不再依赖 ERP 检测）
    const sources = (premium && premium._sources) ? premium._sources : [];
    if (sources.includes('seller-analytics')) {
      pill.textContent = 'Premium';
      pill.style.background = '#ffedd5';
      pill.style.color = '#c2410c';
      pill.style.borderColor = '#fdba74';
    } else if (sources.includes('public-entrypoint')) {
      pill.textContent = '公开数据';
      pill.style.background = '#fef3c7';
      pill.style.color = '#92400e';
      pill.style.borderColor = '#fcd34d';
    } else if (sources.includes('erp-cache')) {
      pill.textContent = 'ERP 缓存';
      pill.style.background = '#f5f5f4';
      pill.style.color = '#57534e';
      pill.style.borderColor = '#d6d3d1';
    } else if (premium === null) {
      pill.textContent = '基础';
      pill.style.background = '#f1f5f9';
      pill.style.color = '#64748b';
      pill.style.borderColor = '#cbd5e1';
    }

    // 紧凑版字段（按用户要求：上架日期/30天销量/评论数/重量）
    const createDate = pickCreateDate(premium);
    const sales30d = pickSales(premium);
    const reviews = dom.reviews;
    const weight = pickWeight(premium);

    grid.innerHTML = [
      metricCell('上架日期', createDate || '--', !createDate),
      metricCell('30天销量', sales30d == null ? '🔒' : formatNum(sales30d), sales30d == null),
      metricCell('评论数', reviews != null ? formatNum(reviews) : '--', reviews == null),
      metricCell('重量', weight == null ? '--' : weight + 'g', weight == null),
    ].join('');

    const expanded = getExpandedPanel(wrap);
    if (expanded && (expanded.style.display !== 'none' || expanded.getAttribute('data-rendered') === '1')) {
      expanded.innerHTML = renderExpandedFields(sku, dom, premium);
      expanded.setAttribute('data-rendered', '1');
      if (expanded.style.display !== 'none') positionExpandedPanel(wrap, expanded);
    }
  }

  function renderCollectActions(wrap, sku, dom, snapshot) {
    const actions = wrap.querySelector('.ss-erp-collect-actions');
    if (!actions) return;

    if (snapshot && snapshot.collected) {
      const statusText = snapshot.listed ? '已上架' : '已采集';
      const priceText = snapshot.price ? ' · 成本 ¥' + escapeHtml(snapshot.price) : '';
      const lastText = snapshot.lastCollectedAt ? ' · ' + escapeHtml(formatDate(snapshot.lastCollectedAt)) : '';
      actions.innerHTML = [
        '<div style="display:flex;flex-direction:column;gap:5px;min-width:0;flex:1">',
        `  <div class="ss-erp-collect-status" title="${escapeHtml(snapshot.title || dom.title || sku)}" style="font-size:10px;color:#047857;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${statusText}${priceText}${lastText}</div>`,
        '  <div style="display:flex;gap:5px;min-width:0">',
        '    <button class="ss-erp-open-btn" type="button" style="flex:1;padding:5px 7px;border:1px solid #10b981;border-radius:6px;background:#ecfdf5;color:#047857;cursor:pointer;font-size:11px;font-weight:600">查看 ERP</button>',
        '    <button class="ss-erp-recollect-btn" type="button" style="padding:5px 7px;border:1px solid #fdba74;border-radius:6px;background:#fff;color:#c2410c;cursor:pointer;font-size:11px;font-weight:600">重采集</button>',
        '  </div>',
        '</div>',
      ].join('');
      return;
    }

    const statusText = snapshot && snapshot.unavailable
      ? ('ERP 未连接：' + truncate(snapshot.error || '查询失败', 18))
      : '采集状态未知';
    actions.innerHTML = [
      '<div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1">',
      '  <button class="ss-erp-collect-btn" type="button" style="width:100%;padding:5px 8px;border:1px solid #f97316;border-radius:6px;background:#f97316;color:#fff;cursor:pointer;font-size:11px;font-weight:600">采集到 ERP</button>',
      `  <span class="ss-erp-collect-status" style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(statusText)}</span>`,
      '</div>',
    ].join('');
  }

  function metricCell(label, value, locked) {
    return [
      '<div style="background:#fff;border:1px solid #fed7aa;border-radius:6px;padding:5px 8px;display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden">',
      `  <span style="color:#a16207;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(label)}</span>`,
      `  <span style="color:${locked ? '#cbd5e1' : '#0f172a'};font-weight:600;font-size:13px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(value)}</span>`,
      '</div>',
    ].join('');
  }

  function renderExpandedFields(sku, dom, premium) {
    const fields = collectExpandedFields(sku, dom, premium);
    return [
      '<div style="display:grid;grid-template-columns:1fr;gap:0;font-size:11px;color:#475569">',
      ...fields.map(([k, v, locked]) => [
        '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed #fed7aa;padding:3px 0;gap:8px;min-width:0">',
        `  <span style="color:#a16207;flex-shrink:0;white-space:nowrap">${escapeHtml(k)}</span>`,
        `  <span style="color:${locked ? '#cbd5e1' : '#1e293b'};font-weight:${locked ? '400' : '500'};text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1">${escapeHtml(v)}</span>`,
        '</div>',
      ].join('')),
      '</div>',
    ].join('');
  }

  function collectExpandedFields(sku, dom, p) {
    const f = [];
    const sources = (p && p._sources) ? p._sources.join(',') : '';
    // === 关键销售数据（最先展示，按用户要求重要的提前）===
    f.push(['上架日期', pickCreateDate(p) || '--', !pickCreateDate(p)]);
    f.push(['30天销量', pickSales(p) == null ? '🔒 Premium' : formatNum(pickSales(p)), pickSales(p) == null]);
    f.push(['评论数', dom.reviews != null ? formatNum(dom.reviews) : '--', dom.reviews == null]);
    f.push(['重量', pickWeight(p) == null ? '--' : pickWeight(p) + 'g', pickWeight(p) == null]);
    f.push(['尺寸(mm)', pickDims(p) || '--', !pickDims(p)]);
    f.push(['评分', dom.rating != null ? `${dom.rating} ⭐` : '--', dom.rating == null]);
    // === 商品信息 ===
    f.push(['SKU', sku, false]);
    f.push(['品牌', pickFlat(p, 'brand') || '--', !pickFlat(p, 'brand')]);
    f.push(['类目', pickFlat(p, 'category') || pickFlat(p, 'category3') || '--', !(pickFlat(p, 'category') || pickFlat(p, 'category3'))]);
    f.push(['一级类目', pickFlat(p, 'category1') || '--', !pickFlat(p, 'category1')]);
    f.push(['图片数', p && Array.isArray(p.images) ? p.images.length : '--', !p]);
    f.push(['变体数', p && Array.isArray(p.variants) ? p.variants.length : '--', !p]);
    f.push(['货币', pickFlat(p, 'currency') || 'RUB', false]);
    // === Premium 销售指标 ===
    f.push(['30天GMV', pickGmv(p) == null ? '🔒 Premium' : '₽' + formatNum(pickGmv(p)), pickGmv(p) == null]);
    f.push(['销量环比', pickSalesDynamics(p) == null ? '--' : pickSalesDynamics(p) + '%', pickSalesDynamics(p) == null]);
    f.push(['平均价', pickAvgPrice(p) == null ? '--' : '₽' + formatNum(pickAvgPrice(p)), pickAvgPrice(p) == null]);
    f.push(['最低卖家价', pickMinPrice(p) == null ? '--' : '₽' + formatNum(pickMinPrice(p)), pickMinPrice(p) == null]);
    f.push(['加购率', pickAddCart(p) == null ? '🔒 Premium' : pickAddCart(p) + '%', pickAddCart(p) == null]);
    f.push(['浏览量', pickViews(p) == null ? '🔒 Premium' : formatNum(pickViews(p)), pickViews(p) == null]);
    f.push(['库存', pickStock(p) == null ? '🔒 Premium' : formatNum(pickStock(p)), pickStock(p) == null]);
    // === 卖家信息 ===
    f.push(['卖家', pickSeller(p) || '--', !pickSeller(p)]);
    f.push(['卖家ID', pickFlat(p, 'sellerId') || '--', !pickFlat(p, 'sellerId')]);
    f.push(['配送天数', pickDeliveryDays(p) == null ? '--' : pickDeliveryDays(p) + '天', pickDeliveryDays(p) == null]);
    f.push(['发货模式', pickFlat(p, 'salesSchema') || '--', !pickFlat(p, 'salesSchema')]);
    f.push(['模型ID', pickFlat(p, 'modelId') || '--', !pickFlat(p, 'modelId')]);
    f.push(['数据源', sources || '--', false]);
    return f;
  }

  async function collectSkuToErp(sku, dom, button) {
    button.disabled = true;
    const oldText = button.textContent;
    const oldBackground = button.style.background;
    const oldBorderColor = button.style.borderColor;
    button.textContent = '采集中…';
    button.style.opacity = '0.7';

    const resp = await send({ type: 'ss-erp:collect-product', sku, url: dom.url }, 60000);

    if (resp && resp.ok) {
      setCollectSnapshot(sku, {
        collected: true,
        sourceProductId: sku,
        sku,
        title: dom.title || sku,
        sourceUrl: dom.url || null,
        lastCollectedAt: new Date().toISOString(),
        pendingRefresh: true,
      });
      notifyCollectSnapshot(sku);
      queueCollectSnapshot(sku, true);
      return;
    }

    button.disabled = false;
    button.textContent = '✗ ' + (resp && resp.msg ? truncate(resp.msg, 12) : '失败');
    button.style.background = '#ef4444';
    button.style.borderColor = '#ef4444';
    setTimeout(() => {
      if (!button.isConnected) return;
      button.textContent = oldText;
      button.style.background = oldBackground;
      button.style.borderColor = oldBorderColor;
      button.style.opacity = '1';
    }, 4000);
  }

  // === 注入卡片 + 绑定事件 ===
  async function attachOverlay(target) {
    const card = resolveProductCardTarget(target);
    if (!card) return;

    const sku = extractSku(card);
    if (!sku) return;
    const existingSku = card.getAttribute(SKU_ATTR);
    if (card.getAttribute(PROCESSED_ATTR) && existingSku === sku && card.querySelector(`.${CARD_CLASS}`)) return;

    const oldWrap = card.querySelector(`.${CARD_CLASS}`);
    if (oldWrap) {
      removeExpandedPortal(oldWrap);
      oldWrap.remove();
    }

    card.setAttribute(PROCESSED_ATTR, '1');
    card.setAttribute(SKU_ATTR, sku);

    const dom = extractCardData(card);
    const wrap = buildCard(sku, dom);
    const expanded = createExpandedPortal(wrap, sku);
    insertOverlay(card, wrap);

    wrap.addEventListener('click', (e) => e.stopPropagation());

    const expandBtn = wrap.querySelector('.ss-erp-expand-btn');

    const unsubscribeSnapshot = subscribeCollectSnapshot(sku, (snapshot) => {
      if (!wrap.isConnected) {
        unsubscribeSnapshot();
        return;
      }
      renderCollectActions(wrap, sku, dom, snapshot);
    });
    queueCollectSnapshot(sku);

    expandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const willOpen = expanded.style.display === 'none';
      // 展开时若数据已加载则立即渲染
      if (willOpen) {
        const cached = premiumCache.get(sku);
        const premium = cached ? cached.data : null;
        expanded.innerHTML = renderExpandedFields(sku, dom, premium);
        expanded.setAttribute('data-rendered', '1');
      }
      setExpandedPanelOpen(wrap, expanded, expandBtn, willOpen);
    });

    wrap.addEventListener('click', async (e) => {
      const collectBtn = e.target && e.target.closest ? e.target.closest('.ss-erp-collect-btn, .ss-erp-recollect-btn') : null;
      const openBtn = e.target && e.target.closest ? e.target.closest('.ss-erp-open-btn') : null;
      if (!collectBtn && !openBtn) return;

      e.preventDefault();
      e.stopPropagation();

      if (openBtn) {
        openBtn.disabled = true;
        const oldText = openBtn.textContent;
        openBtn.textContent = '打开中…';
        const resp = await send({ type: 'ss-erp:open-erp-collect', sku }, 8000);
        if (!resp || !resp.ok) {
          openBtn.disabled = false;
          openBtn.textContent = truncate((resp && (resp.msg || resp.error)) || '打开失败', 12);
          setTimeout(() => { if (openBtn.isConnected) openBtn.textContent = oldText; }, 2500);
        }
        return;
      }

      await collectSkuToErp(sku, dom, collectBtn);
    });

    // 进入视口后自动加载 Premium 数据，不等用户展开
    const premium = await fetchPublicProduct(sku);
    renderMetrics(wrap, sku, dom, premium);
  }

  // === 扫描 + 视口加载 ===
  let intersectionObserver = null;
  function ensureIntersectionObserver() {
    if (intersectionObserver) return intersectionObserver;
    if (typeof IntersectionObserver === 'undefined') return null;
    intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          attachOverlay(entry.target);
          intersectionObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '200px' });
    return intersectionObserver;
  }

  function scan() {
    if (!isProductPage()) return;
    cleanupDetachedExpandedPanels();
    const io = ensureIntersectionObserver();
    const targets = new Set();

    CARD_SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((candidate) => {
        collectProductCardTargets(candidate).forEach((target) => addProductCardTarget(targets, target));
      });
    });

    targets.forEach((target) => {
      const sku = extractSku(target);
      if (!sku) return;
      if (target.getAttribute(PROCESSED_ATTR) && target.getAttribute(SKU_ATTR) === sku && target.querySelector(`.${CARD_CLASS}`)) return;
      if (io) io.observe(target);
      else attachOverlay(target);
    });
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, 300);
  }

  function init() {
    if (!isProductPage()) return;
    const startedAt = Date.now();
    scan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    startPeriodicScan(startedAt);
  }

  function startPeriodicScan(startedAt) {
    function tick() {
      if (!isProductPage()) return;
      if (document.visibilityState === 'visible') scan();
      const delay = Date.now() - startedAt < CARD_SCAN_FAST_UNTIL_MS
        ? CARD_SCAN_FAST_MS
        : CARD_SCAN_SLOW_MS;
      setTimeout(tick, delay);
    }
    setTimeout(tick, CARD_SCAN_FAST_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
