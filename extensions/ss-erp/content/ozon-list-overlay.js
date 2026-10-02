// SS ERP Ozon 列表页增强
// 数据来源（多层降级）：
//   1. DOM 提取（标题/价格/评分/评论/图片/SKU）
//   2. OZON 公开 entrypoint API（销量/卖家/库存等，无需登录）
//   3. seller-analytics API（Premium 数据，需登录 + Premium）
//   4. SS ERP 缓存（其他用户已提交的数据）
//   5. 实在拿不到的字段显示 "--"，不阻塞卡片渲染
// 设计原则：
//   - 列表页只做分析和筛选投影，不发起 ERP 采集、图片或发布写入。
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
  const CARD_SELECTOR = CARD_SELECTORS.join(',');

  const PREMIUM_TTL_MS = 10 * 60 * 1000;
  const PREMIUM_FAILURE_TTL_MS = 90 * 1000;
  const LIST_DATA_COOKIE_AUTO_SYNC_TTL_MS = 5 * 60 * 1000;
  const PRODUCT_SELECTION_POOL_STATUS_TTL_MS = 2 * 60 * 1000;
  const PREMIUM_CONCURRENCY = 3;
  const PREMIUM_MAX_PENDING = 60;
  const PREMIUM_QUEUE_DEADLINE_MS = 15 * 1000;
  const PREMIUM_QUEUE_SKIPPED = Object.freeze({ skipped: true });
  const LIST_PRELOAD_ROOT_MARGIN = '600px 0px 900px 0px';
  const CARD_SCAN_SAFETY_MS = 10 * 1000;
  const CARD_SCAN_DEBOUNCE_MS = 80;
  // T6 自动滚动：防风控节流——随机步进间隔 + 到底判定的稳定轮次。
  const AUTO_SCROLL_STEP_DELAY_MIN_MS = 3000;
  const AUTO_SCROLL_STEP_DELAY_MAX_MS = 5000;
  const AUTO_SCROLL_STEP_RATIO = 0.85;      // 每步滚动视口高度占比（略小于一屏，避免跳过懒加载触发点）
  const AUTO_SCROLL_MAX_STABLE = 4;         // 连续 N 轮高度与 SKU 数都不增长即判定到底
  const AUTO_SCROLL_MAX_STEPS = 400;        // 硬上限，防止异常页面无限滚动
  const DISPLAY_FIELDS_STORAGE_KEY = 'ss-erp:ozon-list-display-fields';
  const PRODUCT_SELECTION_RULES_STORAGE_KEY = 'ss-erp:ozon-product-selection-rules';
  const PRODUCT_SELECTION_RULES_CHROME_STORAGE_KEY = 'productSelectionRules';
  const LIST_FIELD_CONFIG_MODAL_ID = 'ss-erp-list-field-config-modal';
  const LIST_SELECTION_RULES_MODAL_ID = 'ss-erp-list-selection-rules-modal';
  const LIST_QUICK_ACTIONS_ID = 'ss-erp-list-quick-actions';
  const DEFAULT_DISPLAY_FIELD_IDS = [
    'sku',
    'category',
    'brand',
    'soldCount',
    'soldSum',
    'adExpenseShare',
    'productCardViews',
    'weight',
  ];
  const DISPLAY_FIELD_DEFS = [
    { id: 'category', label: '类目', source: 'seller' },
    { id: 'sku', label: 'SKU', source: 'supplement' },
    { id: 'brand', label: '品牌', source: 'seller' },
    { id: 'soldCount', label: '月销量', source: 'seller' },
    { id: 'soldSum', label: '月销售额', source: 'seller' },
    { id: 'salesDynamics', label: '月周转动态', source: 'seller' },
    { id: 'adExpenseShare', label: '广告费占比', source: 'seller' },
    { id: 'convViewToOrder', label: '浏览下单率', source: 'seller' },
    { id: 'convToCartSearch', label: '搜索转换率', source: 'seller' },
    { id: 'nullableRedemptionRate', label: '结单率', source: 'seller' },
    { id: 'promoDays', label: '参与促销天数', source: 'seller' },
    { id: 'promoDiscountPercent', label: '折扣', source: 'seller' },
    { id: 'promoConversionRate', label: '促销转化率', source: 'seller' },
    { id: 'paidPromotionDays', label: '付费推广天数', source: 'seller' },
    { id: 'daysWithTrafarets', label: '模板活动天数', source: 'seller' },
    { id: 'promoRevenueShare', label: '促销收入占比', source: 'seller' },
    { id: 'productCardViews', label: '商品卡浏览量', source: 'seller' },
    { id: 'productCardAddToCartRate', label: '商品卡加购率', source: 'seller' },
    { id: 'searchCatalogViews', label: '搜索目录浏览量', source: 'seller' },
    { id: 'searchCatalogAddToCartRate', label: '搜索目录加购率', source: 'seller' },
    { id: 'showConversionRate', label: '展示转化率', source: 'seller' },
    { id: 'salesSchema', label: '发货模式', source: 'seller' },
    { id: 'createDate', label: '上架时间', source: 'seller' },
    { id: 'dimensions', label: '长宽高', source: 'supplement' },
    { id: 'weight', label: '重量', source: 'supplement' },
    { id: 'sellerList', label: '跟卖列表', source: 'supplement' },
    { id: 'minFollowPriceRub', label: '跟卖最低价', source: 'supplement' },
    { id: 'maxFollowPriceRub', label: '跟卖最高价', source: 'supplement' },
    { id: 'ptj', label: '价格指数', source: 'supplement' },
    { id: 'productClickRate', label: '商品点击率', source: 'computed' },
    { id: 'returnCancelRate', label: '退货取消率', source: 'computed' },
    { id: 'commission', label: '佣金', source: 'computed' },
    { id: 'rfbsCommission', label: 'rFBS佣金', source: 'computed' },
    { id: 'fbpCommission', label: 'FBP佣金', source: 'computed' },
  ];
  const DISPLAY_FIELD_SOURCE_LABELS = {
    seller: 'Ozon seller直出',
    supplement: '接口补充',
    computed: '规则/计算',
  };
  const SS_ERP_LIST_THEME = {
    primary: '#0f766e',
    primaryDark: '#115e59',
    primaryDarker: '#134e4a',
    primarySoft: '#f0fdfa',
    primarySoftAlt: '#e6fffb',
    border: '#cce5e2',
    borderStrong: '#99c9c3',
    blue: '#2563eb',
    surface: '#f8fafc',
    surfaceAlt: '#f1f5f9',
    text: '#172326',
    muted: '#5f6f73',
    danger: '#b42318',
    headerGradient: '#0f766e',
    cardGradient: '#f0fdfa',
    tableHeader: '#f1f5f9',
  };
  const LIST_OVERLAY_STYLE_ID = 'ss-erp-list-overlay-style';

  // === 工具：缓存 ===
  const premiumCache = new Map();  // sku -> { data, ts }
  const failedPremiumCache = new Map(); // sku -> ts
  const inFlightPremium = new Map(); // sku -> Promise
  const inFlightPremiumCallers = new Map(); // request key -> Set<isCancelled>
  const premiumQueue = [];
  let activePremiumRequests = 0;
  let listDataCookieAutoSyncPromise = null;
  let listDataCookieAutoSyncAt = 0;
  let listDataCookieCompanyId = '';
  let premiumContextEpoch = 0;
  let overlayIdCounter = 0;
  let activeExpandedPanel = null;
  let expandedPanelListenersInstalled = false;
  let productSelectionRulesCache = null;
  const observedListSkuSet = new Set();
  let observedListSkuPageKey = '';
  const observedCardSku = new WeakMap();
  const autoFavoriteProductPoolSet = new Set();
  const productSelectionPoolStatusCache = new Map();
  const productSelectionPoolStatusPending = new Set();
  let productSelectionPoolStatusTimer = null;

  function ensureListOverlayStyles() {
    if (document.getElementById(LIST_OVERLAY_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LIST_OVERLAY_STYLE_ID;
    style.textContent = [
      '@keyframes ssErpModalIn{from{opacity:0;transform:translate(-50%,-48%) scale(.985)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}',
      '@keyframes ssErpDockIn{from{opacity:0;transform:translate(8px,-50%) scale(.98)}to{opacity:1;transform:translate(0,-50%) scale(1)}}',
      '@keyframes ssErpRowIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
      `#${LIST_QUICK_ACTIONS_ID} button{transition:background-color .14s ease,border-color .14s ease,color .14s ease,transform .14s ease,box-shadow .14s ease;}`,
      `#${LIST_QUICK_ACTIONS_ID} button:hover{transform:translateY(-1px);box-shadow:0 2px 6px rgba(15,23,42,.14);}`,
    ].join('\n');
    document.documentElement.appendChild(style);
  }

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

  function selectedListFieldsNeedDetail() {
    return readSelectedDisplayFieldIds().some((field) => field === 'weight' || field === 'dimensions');
  }

  function premiumRequestKey(sku, includeDetail, epoch = premiumContextEpoch) {
    return `${epoch}:${String(sku || '').trim()}:${includeDetail ? 'detail' : 'summary'}`;
  }

  function getCachedPremium(sku, options = {}) {
    const includeDetail = options.includeDetail === true;
    const exact = getCached(premiumCache, premiumRequestKey(sku, includeDetail), PREMIUM_TTL_MS);
    if (exact || includeDetail) return exact;
    return getCached(premiumCache, premiumRequestKey(sku, true), PREMIUM_TTL_MS);
  }

  function getBestCachedPremium(sku) {
    return getCachedPremium(sku, { includeDetail: true })
      || getCachedPremium(sku, { includeDetail: false });
  }

  function invalidatePremiumContext() {
    premiumContextEpoch += 1;
    premiumCache.clear();
    failedPremiumCache.clear();
    inFlightPremium.clear();
    inFlightPremiumCallers.clear();
    listDataCookieAutoSyncAt = 0;
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((card) => {
      const wrap = card.querySelector(`.${CARD_CLASS}`);
      if (wrap) {
        removeExpandedPortal(wrap);
        wrap.remove();
      }
      card.removeAttribute(PROCESSED_ATTR);
      card.removeAttribute(SKU_ATTR);
    });
    scheduleScanRoot(document.body);
  }

  function enqueuePremiumRequest(task, options = {}) {
    if (premiumQueue.length >= PREMIUM_MAX_PENDING) return Promise.resolve(PREMIUM_QUEUE_SKIPPED);
    return new Promise((resolve) => {
      premiumQueue.push({
        task,
        resolve,
        queuedAt: Date.now(),
        isCancelled: typeof options.isCancelled === 'function' ? options.isCancelled : () => false,
      });
      drainPremiumQueue();
    });
  }

  function drainPremiumQueue() {
    while (activePremiumRequests < PREMIUM_CONCURRENCY && premiumQueue.length) {
      const next = premiumQueue.shift();
      if (next.isCancelled() || Date.now() - next.queuedAt > PREMIUM_QUEUE_DEADLINE_MS) {
        next.resolve(PREMIUM_QUEUE_SKIPPED);
        continue;
      }
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

  function getListSkuPageKey() {
    return [location.origin, location.pathname, location.search].join('');
  }

  function ensureListSkuPageContext() {
    const pageKey = getListSkuPageKey();
    if (pageKey !== observedListSkuPageKey) {
      observedListSkuSet.clear();
      observedListSkuPageKey = pageKey;
      return true;
    }
    return false;
  }

  function rememberVisibleListSkus(root = document.body) {
    ensureListSkuPageContext();
    if (root !== document.body && root.isConnected === false) {
      return Array.from(observedListSkuSet).slice(0, 1000);
    }
    collectDistinctProductSkus(root).forEach((sku) => observedListSkuSet.add(String(sku)));
    return Array.from(observedListSkuSet).slice(0, 1000);
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
    const parsedPrice = parsePriceWithCurrency(priceTexts[0] || '');
    const parsedOldPrice = parsePriceWithCurrency(priceTexts[1] || '', parsedPrice.currency);
    const price = parsedPrice.price;
    const oldPrice = parsedOldPrice.price;
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

    return {
      url,
      title,
      image,
      price,
      priceCurrency: parsedPrice.currency,
      oldPrice,
      oldPriceCurrency: parsedOldPrice.currency,
      discount,
      rating,
      reviews,
    };
  }

  function normalizePriceCurrency(value, fallback) {
    const text = String(value == null ? '' : value).trim().toUpperCase();
    if (!text) return fallback || null;
    if (text === 'RMB' || text === '￥' || text === '¥') return 'CNY';
    if (text === '₽' || text === 'РУБ') return 'RUB';
    if (text === '₸') return 'KZT';
    if (text === 'BR') return 'BYN';
    return text;
  }

  function parsePriceWithCurrency(text, fallbackCurrency) {
    const helper = globalThis.SS_ERP_PRICE_CURRENCY;
    if (helper && typeof helper.parsePriceWithCurrency === 'function') {
      const fallback = fallbackCurrency || (typeof helper.fallbackCurrencyByHost === 'function' ? helper.fallbackCurrencyByHost(location.hostname) : null);
      const parsed = helper.parsePriceWithCurrency(text, fallback);
      const n = parsed && parsed.price != null ? Number(parsed.price) : null;
      return {
        price: Number.isFinite(n) ? n : null,
        currency: normalizePriceCurrency(parsed && parsed.currency, fallbackCurrency || null),
      };
    }
    return {
      price: parsePrice(text),
      currency: normalizePriceCurrency(fallbackCurrency, null) || (/[¥￥]/.test(String(text || '')) ? 'CNY' : 'RUB'),
    };
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
        resolve({ ok: false, msg: '通信超时', timedOut: true });
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

  function rememberSourceErrors(sku, errors) {
    if (!Array.isArray(errors) || !errors.length) return;
    try {
      const bucket = globalThis.__SS_ERP_LIST_OVERLAY_SOURCE_ERRORS__ || {};
      bucket[String(sku)] = { errors, ts: Date.now() };
      globalThis.__SS_ERP_LIST_OVERLAY_SOURCE_ERRORS__ = bucket;
      if (globalThis.localStorage && localStorage.getItem('ss_erp_debug_list_overlay') === '1') {
        console.debug('[SS ERP] Ozon list insight source errors:', sku, errors);
      }
    } catch (e) {}
  }

  function autoSyncCurrentOzonCookieForListData() {
    const now = Date.now();
    if (listDataCookieAutoSyncPromise) return listDataCookieAutoSyncPromise;
    if (listDataCookieAutoSyncAt && now - listDataCookieAutoSyncAt < LIST_DATA_COOKIE_AUTO_SYNC_TTL_MS) {
      return Promise.resolve(null);
    }
    listDataCookieAutoSyncAt = now;
    listDataCookieAutoSyncPromise = send({
      type: 'ozon-calc:sync-current-ozon-cookie',
      payload: { reason: 'ozon_list_kpi_preload', automatic: true },
    }, 30000).then((response) => {
      if (response && response.ok) {
        const companyId = String(response.data && response.data.companyId || '').trim();
        if (companyId && listDataCookieCompanyId && companyId !== listDataCookieCompanyId) {
          invalidatePremiumContext();
        }
        if (companyId) listDataCookieCompanyId = companyId;
        failedPremiumCache.clear();
        try { globalThis.__SS_ERP_LIST_OVERLAY_SOURCE_ERRORS__ = {}; } catch (e) {}
      }
      return response;
    }).catch((error) => ({
      ok: false,
      error: error && error.message ? error.message : String(error),
    })).finally(() => {
      listDataCookieAutoSyncPromise = null;
    });
    return listDataCookieAutoSyncPromise;
  }

  function hasDisplayablePremiumData(data) {
    if (!data || typeof data !== 'object') return false;
    return Object.keys(data).some((key) => {
      if (!key || key[0] === '_') return false;
      const value = data[key];
      if (value == null || value === '') return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    });
  }

  // === 公开 API：拉商品基础信息（含销量/卖家等可选字段）===
  // 通过 background 聚合 seller-analytics、公开 entrypoint 和 ERP 缓存；失败时保持基础卡片。
  async function fetchPublicProduct(sku, options = {}) {
    const includeDetail = options.includeDetail === true;
    const requestEpoch = premiumContextEpoch;
    const requestKey = premiumRequestKey(sku, includeDetail, requestEpoch);
    const callerIsCancelled = typeof options.isCancelled === 'function'
      ? options.isCancelled
      : () => false;
    const resolveForCaller = (sharedRequest) => sharedRequest.then((result) => {
      if (requestEpoch !== premiumContextEpoch || callerIsCancelled()) return null;
      if (result === PREMIUM_QUEUE_SKIPPED) {
        if (typeof options.onSkipped === 'function') setTimeout(options.onSkipped, 1000);
        return null;
      }
      return result;
    });
    const cached = getCachedPremium(sku, { includeDetail });
    if (cached) return cached;

    autoSyncCurrentOzonCookieForListData();

    const failTs = failedPremiumCache.get(requestKey);
    if (failTs && Date.now() - failTs < PREMIUM_FAILURE_TTL_MS) return null;
    if (inFlightPremium.has(requestKey)) {
      const callers = inFlightPremiumCallers.get(requestKey);
      if (callers) callers.add(callerIsCancelled);
      return resolveForCaller(inFlightPremium.get(requestKey));
    }

    const callers = new Set([callerIsCancelled]);
    inFlightPremiumCallers.set(requestKey, callers);

    const request = enqueuePremiumRequest(async () => {
      const resp = await send(
        {
          type: 'spb-self-hosted:aggregate-product-insights',
          productId: sku,
          includeOffers: false,
          includeDetail,
          profile: 'list-card',
        },
        20000,
      );
      return resp;
    }, {
      isCancelled: () => requestEpoch !== premiumContextEpoch
        || Array.from(callers).every((isCancelled) => isCancelled()),
    }).then((resp) => {
      if (requestEpoch !== premiumContextEpoch) return null;
      if (resp === PREMIUM_QUEUE_SKIPPED) return PREMIUM_QUEUE_SKIPPED;
      if (!resp || !resp.ok || !resp.item) {
        if (requestEpoch === premiumContextEpoch) failedPremiumCache.set(requestKey, Date.now());
        rememberSourceErrors(sku, [{
          source: 'extension',
          error: (resp && (resp.error || resp.msg)) || '详细数据请求失败',
        }]);
        return null;
      }

      const data = Object.assign({}, resp.item, {
        _sources: resp.sources || [],
        _sourceErrors: resp.sourceErrors || resp.errors || [],
      });
      rememberSourceErrors(sku, data._sourceErrors);
      if (!hasDisplayablePremiumData(data)) {
        if (requestEpoch === premiumContextEpoch) failedPremiumCache.set(requestKey, Date.now());
        return null;
      }
      if (requestEpoch !== premiumContextEpoch) return null;
      setCached(premiumCache, requestKey, data);
      failedPremiumCache.delete(requestKey);
      return data;
    }).finally(() => {
      if (inFlightPremium.get(requestKey) === request) {
        inFlightPremium.delete(requestKey);
        inFlightPremiumCallers.delete(requestKey);
      }
    });

    inFlightPremium.set(requestKey, request);
    return resolveForCaller(request);
  }

  // === 字段提取（聚合接口扁平格式 + 兼容旧的 item/_insightsItem 嵌套）===
  function pickFlat(p, key) {
    if (!p) return null;
    if (p[key] != null) return p[key];
    const i = p._insightsItem || p.item;
    if (i && i[key] != null) return i[key];
    return null;
  }
  function pickFirstFlat(p, keys) {
    for (const key of keys) {
      const value = pickFlat(p, key);
      if (value != null && value !== '') return value;
    }
    return null;
  }
  function firstPresentValue(...values) {
    for (const value of values) {
      if (value != null && value !== '') return value;
    }
    return null;
  }
  function pickSales(p) { const v = pickFirstFlat(p, ['soldCount', 'monthlySales', 'orderedUnits']); return v == null ? null : Number(v) || 0; }
  function pickGmv(p) { const v = pickFirstFlat(p, ['soldSum', 'gmvSum', 'gmv']); return v == null ? null : Math.round(Number(v)); }
  function normalizePercentMetric(value) {
    if (value == null || value === '') return null;
    const n = Number(String(value).replace('%', '').replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return n > 0 && n <= 1 ? n * 100 : n;
  }
  function pickAddCart(p) { const v = pickFlat(p, 'convToCartPdp'); const n = normalizePercentMetric(v); return n == null ? null : n.toFixed(1); }
  function pickViews(p) { const v = pickFlat(p, 'views'); return v == null ? null : Number(v); }
  function pickStock(p) { const v = pickFlat(p, 'stock'); return v == null ? null : Number(v); }
  function pickSeller(p) { return pickFlat(p, 'sellerName'); }
  function pickAvgPrice(p) { const v = pickFlat(p, 'avgPrice'); return v == null ? null : Math.round(Number(v)); }
  function pickMinPrice(p) { const v = pickFlat(p, 'minSellerPrice'); return v == null ? null : Math.round(Number(v)); }
  function pickDeliveryDays(p) { return pickFlat(p, 'avgDeliveryDays'); }
  function pickSalesDynamics(p) { const v = pickFlat(p, 'salesDynamics'); return v == null ? null : Number(v).toFixed(1); }
  function pickWeight(p) { return pickFirstFlat(p, ['weightGrams', 'grossWeightGrams', 'weightG', 'pWeight', 'weight']); }
  function pickDims(p) {
    const dims = pickFlat(p, 'dimensionsMm');
    const l = pickFlat(p, 'lengthMm') || pickFlat(p, 'depth') || (dims && (dims.length || dims.depth));
    const w = pickFlat(p, 'widthMm') || (dims && dims.width);
    const h = pickFlat(p, 'heightMm') || (dims && dims.height);
    if (l == null && w == null && h == null) return null;
    return `${l || '?'}×${w || '?'}×${h || '?'}`;
  }
  function pickRawCreateDate(p) {
    return pickFirstFlat(p, ['nullableCreateDate', 'pCreateDate', 'createDate', 'createdAt', 'publishedAt']);
  }
  function pickCreateDate(p) {
    const v = pickRawCreateDate(p);
    return v ? formatDate(v) : null;
  }

  function pickCategoryIds(p) {
    const ids = [
      pickFlat(p, 'category1Id'),
      pickFlat(p, 'category2Id'),
      pickFlat(p, 'category3Id'),
      pickFlat(p, 'descriptionCategoryId'),
      pickFlat(p, 'description_category_id'),
    ].map((value) => String(value == null ? '' : value).trim()).filter(Boolean);
    return Array.from(new Set(ids));
  }

  function formatCategoryDisplay(p) {
    const path = pickFlat(p, 'categoryPath')
      || pickFlat(p, 'category')
      || [pickFlat(p, 'category1'), pickFlat(p, 'category3')].filter(Boolean).join(' / ');
    const ids = pickCategoryIds(p);
    const leafId = ids.length ? ids[ids.length - 1] : '';
    if (path && leafId) return `#${leafId} · ${path}`;
    if (path) return path;
    return ids.length ? ids.join(' / ') : null;
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

  function trustedHtml(html) {
    return { __ssErpTrustedHtml: true, html: String(html || '') };
  }

  function formatRub(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${formatNum(Math.round(number))} RUB` : '--';
  }

  function formatCny(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `¥${formatNum(Math.round(number * 100) / 100)}` : '--';
  }

  function formatWorkbenchPrice(row, dom) {
    const data = row || {};
    const cardDom = dom || {};
    const currency = normalizePriceCurrency(
      firstPresentValue(data.priceCurrency, data.pagePriceCurrency, data.currency, cardDom.priceCurrency),
      'RUB',
    );
    if (currency === 'CNY') {
      const cny = firstPresentValue(data.priceCny, data.pagePrice, cardDom.price);
      return cny != null ? formatCny(cny) : '--';
    }
    const rub = firstPresentValue(data.priceRub, data.pagePrice, data.avgPrice, cardDom.price);
    return rub != null ? formatRub(rub) : '--';
  }

  function resolvePriceRubEquivalent(row, dom) {
    const data = row || {};
    const cardDom = dom || {};
    const directRub = firstPresentValue(data.priceRub, data.avgPrice);
    if (directRub != null && directRub !== '') return Number(directRub) || 0;
    const currency = normalizePriceCurrency(
      firstPresentValue(data.priceCurrency, data.pagePriceCurrency, data.currency, cardDom.priceCurrency),
      'RUB',
    );
    const pagePrice = firstPresentValue(data.pagePrice, data.price, cardDom.price, 0);
    const number = Number(pagePrice) || 0;
    if (currency === 'CNY') {
      const fxRate = Number(data.fxRate) || 0.08;
      return fxRate > 0 ? Math.round((number / fxRate) * 100) / 100 : 0;
    }
    return number;
  }

  function formatPercentValue(value) {
    const number = normalizePercentMetric(value);
    return number == null ? '--' : `${Math.round(number * 100) / 100}%`;
  }

  function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function offerValue(offer, keys) {
    const object = asPlainObject(offer);
    for (const key of keys) {
      const value = object[key];
      if (value != null && value !== '') return value;
    }
    return null;
  }

  function sellerNameFromOffer(offer) {
    if (typeof offer === 'string') return offer;
    const object = asPlainObject(offer);
    const seller = asPlainObject(object.seller);
    return offerValue(object, ['sellerName', 'name', 'title'])
      || offerValue(seller, ['name', 'title'])
      || '';
  }

  function sellerLogoFromOffer(offer) {
    const object = asPlainObject(offer);
    const seller = asPlainObject(object.seller);
    return offerValue(object, ['logoImageUrl', 'logo', 'image'])
      || offerValue(seller, ['logoImageUrl', 'logo', 'image'])
      || '';
  }

  function sellerPriceFromOffer(offer) {
    const object = asPlainObject(offer);
    const price = object.price;
    if (typeof price === 'string' || typeof price === 'number') return String(price);
    const priceObject = asPlainObject(price);
    const cardPrice = asPlainObject(priceObject.cardPrice);
    return offerValue(cardPrice, ['price', 'value'])
      || offerValue(priceObject, ['price', 'value', 'text'])
      || offerValue(object, ['priceText', 'displayPrice', 'currentPrice'])
      || '';
  }

  function sellerUrlFromOffer(offer) {
    const object = asPlainObject(offer);
    const seller = asPlainObject(object.seller);
    const raw = offerValue(object, ['url', 'link', 'sellerUrl'])
      || offerValue(seller, ['url', 'link', 'sellerUrl'])
      || '';
    if (!raw) return '';
    if (/^https?:\/\//i.test(String(raw))) return String(raw);
    if (String(raw).startsWith('/')) return 'https://www.ozon.ru' + raw;
    return '';
  }

  function normalizeSellerRows(p) {
    const rawOffers = pickFlat(p, 'sellerOffers') || pickFlat(p, 'offers') || [];
    const sellerNames = pickFlat(p, 'sellerNames') || [];
    const rows = [];
    (Array.isArray(rawOffers) ? rawOffers : []).forEach((offer) => {
      const name = sellerNameFromOffer(offer);
      if (!name) return;
      rows.push({
        name,
        logo: sellerLogoFromOffer(offer),
        price: sellerPriceFromOffer(offer),
        url: sellerUrlFromOffer(offer),
      });
    });
    (Array.isArray(sellerNames) ? sellerNames : []).forEach((name) => {
      const text = String(name || '').trim();
      if (text && !rows.some((row) => row.name === text)) rows.push({ name: text, logo: '', price: '', url: '' });
    });
    return rows;
  }

  function formatSellerListTrigger(sku, p) {
    const rows = normalizeSellerRows(p);
    const count = Number(pickFlat(p, 'sellerCount')) || rows.length || 0;
    const rawText = pickFlat(p, 'sellerListText') || pickSeller(p) || '';
    const text = rawText || (rows.length ? `${rows[0].name}${count > 1 ? ` 等${count}个卖家` : ''}` : '');
    if (!text) return { value: '--', locked: true };
    return {
      value: trustedHtml(`<button type="button" data-role="open-seller-list" data-sku="${escapeHtml(sku)}" style="border:0;background:transparent;color:#2563eb;font:inherit;font-weight:700;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(text)}</button>`),
      locked: false,
    };
  }

  function readSelectedDisplayFieldIds() {
    try {
      const raw = localStorage.getItem(DISPLAY_FIELDS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const allowed = new Set(DISPLAY_FIELD_DEFS.map((field) => field.id));
        const selected = parsed.map((id) => String(id || '')).filter((id) => allowed.has(id));
        if (selected.length) return selected;
      }
    } catch (e) {}
    return DEFAULT_DISPLAY_FIELD_IDS.slice();
  }

  function writeSelectedDisplayFieldIds(ids) {
    const allowed = new Set(DISPLAY_FIELD_DEFS.map((field) => field.id));
    const selected = (Array.isArray(ids) ? ids : []).map((id) => String(id || '')).filter((id) => allowed.has(id));
    try {
      localStorage.setItem(DISPLAY_FIELDS_STORAGE_KEY, JSON.stringify(selected.length ? selected : DEFAULT_DISPLAY_FIELD_IDS));
    } catch (e) {}
  }

  function toFiniteNumber(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const normalized = String(value)
      .replace('%', '')
      .replace(/[^\d,.-]/g, '')
      .replace(',', '.')
      .trim();
    if (!normalized) return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeRuleNumber(value) {
    const number = toFiniteNumber(value);
    return number == null ? null : number;
  }

  function normalizeRuleBoolean(value) {
    if (value === true || value === false) return value;
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (!text) return null;
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no') return false;
    return null;
  }

  function normalizeSelectionRuleColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : SS_ERP_LIST_THEME.primary;
  }

  // 把命中规则的 color 派生成 { border, text, bg } —— 标签/卡片共用一处，避免两份逻辑。
  // 低透明度渐变底 + 规则 color 作描边/文字；无效 color 回退主题橙。
  function deriveSelectionRuleTint(value) {
    const color = normalizeSelectionRuleColor(value);
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return {
      color,
      border: color,
      text: color,
      bg: `linear-gradient(135deg,rgba(${r},${g},${b},0.16),rgba(${r},${g},${b},0.06))`,
      cardBg: `linear-gradient(135deg,rgba(${r},${g},${b},0.14),rgba(${r},${g},${b},0.04))`,
    };
  }

  // 多规则命中时挑选用于卡片底色的那条：priority 最大优先，相同则取数组第一条（即命中顺序）。
  function pickSelectionRuleForCard(matches) {
    if (!Array.isArray(matches) || matches.length === 0) return null;
    let best = matches[0];
    for (let i = 1; i < matches.length; i += 1) {
      const cur = matches[i];
      if (Number(cur && cur.priority || 0) > Number(best && best.priority || 0)) best = cur;
    }
    return best;
  }

  function normalizeProductSelectionRule(rule, index) {
    const item = asPlainObject(rule);
    const conditions = asPlainObject(item.conditions);
    const ruleValue = (key) => firstPresentValue(item[key], conditions[key]);
    const name = String(item.name || item.title || `选品规则 ${index + 1}`).trim();
    return {
      id: String(item.id || `local-${Date.now()}-${index}`),
      name: name || `选品规则 ${index + 1}`,
      enabled: item.enabled !== false && item.disabled !== true,
      tag: String(item.tag || name || '命中').trim() || '命中',
      color: normalizeSelectionRuleColor(item.color),
      autoFavorite: normalizeRuleBoolean(firstPresentValue(item.autoFavorite, item.auto_favorite, conditions.autoFavorite, conditions.auto_favorite)) === true,
      priority: normalizeRuleNumber(firstPresentValue(ruleValue('priority'), ruleValue('sort'), item.priority, item.sort)) || 0,
      createdAt: firstPresentValue(item.createdAt, item.created_at, conditions.createdAt),
      updatedAt: firstPresentValue(item.updatedAt, item.updated_at, conditions.updatedAt),
      minSoldCount: normalizeRuleNumber(ruleValue('minSoldCount')),
      minSoldSum: normalizeRuleNumber(ruleValue('minSoldSum')),
      minPriceRub: normalizeRuleNumber(ruleValue('minPriceRub')),
      maxPriceRub: normalizeRuleNumber(ruleValue('maxPriceRub')),
      minSalesDynamics: normalizeRuleNumber(ruleValue('minSalesDynamics')),
      maxSalesDynamics: normalizeRuleNumber(ruleValue('maxSalesDynamics')),
      maxAdExpenseShare: normalizeRuleNumber(ruleValue('maxAdExpenseShare')),
      maxReturnCancelRate: normalizeRuleNumber(ruleValue('maxReturnCancelRate')),
      minProfitMarginPct: normalizeRuleNumber(ruleValue('minProfitMarginPct')),
      maxSellerCount: normalizeRuleNumber(ruleValue('maxSellerCount')),
      minSearchCatalogViews: normalizeRuleNumber(ruleValue('minSearchCatalogViews')),
      minSearchCatalogAddToCartRate: normalizeRuleNumber(ruleValue('minSearchCatalogAddToCartRate')),
      maxWeightGrams: normalizeRuleNumber(ruleValue('maxWeightGrams')),
      minCreateDays: normalizeRuleNumber(ruleValue('minCreateDays')),
      maxCreateDays: normalizeRuleNumber(ruleValue('maxCreateDays')),
      minPromoDays: normalizeRuleNumber(ruleValue('minPromoDays')),
      maxPromoDays: normalizeRuleNumber(ruleValue('maxPromoDays')),
      minDiscountPercent: normalizeRuleNumber(ruleValue('minDiscountPercent')),
      maxDiscountPercent: normalizeRuleNumber(ruleValue('maxDiscountPercent')),
      minPromoRevenueShare: normalizeRuleNumber(ruleValue('minPromoRevenueShare')),
      maxPromoRevenueShare: normalizeRuleNumber(ruleValue('maxPromoRevenueShare')),
      minPaidPromotionDays: normalizeRuleNumber(ruleValue('minPaidPromotionDays')),
      maxPaidPromotionDays: normalizeRuleNumber(ruleValue('maxPaidPromotionDays')),
      minProductCardViews: normalizeRuleNumber(ruleValue('minProductCardViews')),
      minProductCardAddToCartRate: normalizeRuleNumber(ruleValue('minProductCardAddToCartRate')),
      minConvViewToOrder: normalizeRuleNumber(ruleValue('minConvViewToOrder')),
      maxFollowMinPriceRub: normalizeRuleNumber(ruleValue('maxFollowMinPriceRub')),
      salesSchema: String(ruleValue('salesSchema') || '').trim(),
      brandContains: String(ruleValue('brandContains') || '').trim(),
      hasBrand: normalizeRuleBoolean(ruleValue('hasBrand')),
    };
  }

  function getProductSelectionRuleListSource(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== 'object') return [];
    if (Array.isArray(parsed.enabledRules)) return parsed.enabledRules;
    if (Array.isArray(parsed.rules)) return parsed.rules;
    if (Array.isArray(parsed.list)) return parsed.list;
    if (Array.isArray(parsed.data)) return parsed.data;
    return [];
  }

  function sortProductSelectionRulesByPriority(rules) {
    return (Array.isArray(rules) ? rules : []).slice().sort((left, right) => {
      const leftPriority = normalizeRuleNumber(left && left.priority) || 0;
      const rightPriority = normalizeRuleNumber(right && right.priority) || 0;
      return rightPriority - leftPriority;
    });
  }

  function normalizeProductSelectionRuleList(rules) {
    const normalized = (Array.isArray(rules) ? rules : [])
      .map((rule, index) => normalizeProductSelectionRule(rule, index))
      .filter((rule) => rule.name || rule.tag);
    return sortProductSelectionRulesByPriority(normalized);
  }

  function readProductSelectionRulesFromLocalStorage() {
    try {
      const raw = localStorage.getItem(PRODUCT_SELECTION_RULES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return normalizeProductSelectionRuleList(getProductSelectionRuleListSource(parsed));
    } catch (e) {
      return [];
    }
  }

  function readProductSelectionRules() {
    if (Array.isArray(productSelectionRulesCache)) return productSelectionRulesCache.slice();
    return readProductSelectionRulesFromLocalStorage();
  }

  function buildProductSelectionRulesSnapshot(rules) {
    const normalized = normalizeProductSelectionRuleList(rules);
    const enabledRules = normalized.filter((rule) => rule.enabled);
    return {
      enabledRuleIds: enabledRules.map((rule) => rule.id),
      enabledRules,
      lastUpdated: new Date().toISOString(),
    };
  }

  function persistProductSelectionRulesSnapshot(rules) {
    const normalized = normalizeProductSelectionRuleList(rules);
    productSelectionRulesCache = normalized;
    const snapshot = buildProductSelectionRulesSnapshot(normalized);
    try {
      localStorage.setItem(PRODUCT_SELECTION_RULES_STORAGE_KEY, JSON.stringify(normalized));
    } catch (e) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          [PRODUCT_SELECTION_RULES_STORAGE_KEY]: normalized,
          [PRODUCT_SELECTION_RULES_CHROME_STORAGE_KEY]: snapshot,
        });
      }
    } catch (e) {}
    return normalized;
  }

  function writeProductSelectionRules(rules) {
    return persistProductSelectionRulesSnapshot(rules);
  }

  function hydrateProductSelectionRulesFromStorage() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return Promise.resolve(readProductSelectionRules());
      return new Promise((resolve) => {
        chrome.storage.local.get([PRODUCT_SELECTION_RULES_STORAGE_KEY, PRODUCT_SELECTION_RULES_CHROME_STORAGE_KEY], (result) => {
          const storedRules = getProductSelectionRuleListSource(result && result[PRODUCT_SELECTION_RULES_STORAGE_KEY]);
          const snapshotRules = getProductSelectionRuleListSource(result && result[PRODUCT_SELECTION_RULES_CHROME_STORAGE_KEY]);
          const normalized = normalizeProductSelectionRuleList(storedRules.length ? storedRules : snapshotRules);
          if (normalized.length) {
            productSelectionRulesCache = normalized;
            try { localStorage.setItem(PRODUCT_SELECTION_RULES_STORAGE_KEY, JSON.stringify(normalized)); } catch (e) {}
            rerenderAllListMetrics();
          }
          resolve(normalized);
        });
      });
    } catch (e) {
      return Promise.resolve(readProductSelectionRules());
    }
  }

  async function syncProductSelectionRulesFromCloud() {
    const response = await send({ type: 'spb-self-hosted:list-product-selection-rules' }, 12000);
    if (!response || !response.ok) throw new Error(response && (response.error || response.msg) || '选品规则同步失败');
    const rules = response.data && Array.isArray(response.data.rules) ? response.data.rules : [];
    return persistProductSelectionRulesSnapshot(rules);
  }

  async function saveProductSelectionRulesToCloud(rules) {
    const saved = [];
    for (const rule of normalizeProductSelectionRuleList(rules)) {
      const response = await send({ type: 'spb-self-hosted:save-product-selection-rule', rule }, 12000);
      if (!response || !response.ok) throw new Error(response && (response.error || response.msg) || '选品规则保存失败');
      if (response.data && response.data.rule) saved.push(response.data.rule);
      else saved.push(rule);
    }
    return persistProductSelectionRulesSnapshot(saved);
  }

  async function deleteProductSelectionRuleFromCloud(ruleId) {
    const id = String(ruleId || '').trim();
    if (!id || id.startsWith('local-')) return { ok: true };
    return await send({ type: 'spb-self-hosted:delete-product-selection-rule', ruleId: id }, 12000);
  }

  function getSelectionMetric(row, keys, percent) {
    const source = row || {};
    for (const key of keys) {
      const value = firstPresentValue(source[key], pickFlat(source, key));
      const number = percent ? normalizePercentMetric(value) : toFiniteNumber(value);
      if (number != null) return number;
    }
    return null;
  }

  function deriveSelectionReturnCancelRate(row) {
    const direct = getSelectionMetric(row, ['returnCancelRate', 'cancelReturnRate', 'returnRate', 'cancelRate'], true);
    if (direct != null) return direct;
    const redemption = getSelectionMetric(row, ['nullableRedemptionRate', 'redemptionRate', 'redemption_rate'], true);
    return redemption == null ? null : Math.max(0, Math.round((100 - redemption) * 100) / 100);
  }

  function deriveSelectionCreateDays(row) {
    const direct = getSelectionMetric(row, ['createDays', 'daysSinceCreate'], false);
    if (direct != null) return direct;
    const rawDate = firstPresentValue(
      row && row.nullableCreateDate,
      row && row.pCreateDate,
      row && row.createDate,
      row && row.createdAt,
      row && row.publishedAt,
      pickRawCreateDate(row),
    );
    if (!rawDate) return null;
    const createdAt = Date.parse(rawDate);
    if (!Number.isFinite(createdAt)) return null;
    return Math.max(0, Math.floor((Date.now() - createdAt) / 86400000));
  }

  function ruleNumberPass(actual, limit, direction) {
    if (limit == null) return true;
    if (actual == null) return false;
    return direction === 'max' ? actual <= limit : actual >= limit;
  }

  function matchProductSelectionRules(row) {
    const rules = readProductSelectionRules().filter((rule) => rule.enabled);
    if (!rules.length) return [];
    const source = row || {};
    const metrics = {
      soldCount: getSelectionMetric(source, ['soldCount', 'monthlySales', 'orderedUnits'], false),
      soldSum: getSelectionMetric(source, ['soldSum', 'gmvSum', 'gmv'], false),
      priceRub: getSelectionMetric(source, ['priceRub', 'pagePrice', 'avgPrice', 'price'], false),
      salesDynamics: getSelectionMetric(source, ['salesDynamics'], true),
      adExpenseShare: getSelectionMetric(source, ['adExpenseShare', 'drr'], true),
      returnCancelRate: deriveSelectionReturnCancelRate(source),
      profitMarginPct: getSelectionMetric(source, ['profitMarginPct', 'profitRate'], true),
      sellerCount: getSelectionMetric(source, ['sellerCount', 'followSellerCount'], false),
      followMinPriceRub: getSelectionMetric(source, ['minFollowPriceRub', 'followMinPriceRub', 'follow_min_price', 'followMinPrice'], false),
      searchCatalogViews: getSelectionMetric(source, ['searchCatalogViews', 'sessionCountSearch'], false),
      searchCatalogAddToCartRate: getSelectionMetric(source, ['searchCatalogAddToCartRate', 'convToCartSearch'], true),
      weightGrams: getSelectionMetric(source, ['weightGrams', 'grossWeightGrams', 'weightG', 'weight'], false),
      createDays: deriveSelectionCreateDays(source),
      promoDays: getSelectionMetric(source, ['promoDays', 'daysInPromo'], false),
      discountPercent: getSelectionMetric(source, ['promoDiscountPercent', 'discount'], true),
      promoRevenueShare: getSelectionMetric(source, ['promoRevenueShare', 'promoConversionRate'], true),
      paidPromotionDays: getSelectionMetric(source, ['paidPromotionDays', 'daysWithTrafarets'], false),
      productCardViews: getSelectionMetric(source, ['productCardViews', 'qtyViewPdp'], false),
      productCardAddToCartRate: getSelectionMetric(source, ['productCardAddToCartRate', 'convToCartPdp', 'pdpToCartConversion'], true),
      convViewToOrder: getSelectionMetric(source, ['convViewToOrder', 'showConversionRate'], true),
    };
    const brand = String(firstPresentValue(source.brand, pickFlat(source, 'brand'), '') || '').toLowerCase();
    const salesSchema = String(firstPresentValue(source.salesSchema, pickFlat(source, 'salesSchema'), '') || '').toLowerCase();

    return rules.filter((rule) => {
      if (!ruleNumberPass(metrics.soldCount, rule.minSoldCount, 'min')) return false;
      if (!ruleNumberPass(metrics.soldSum, rule.minSoldSum, 'min')) return false;
      if (!ruleNumberPass(metrics.priceRub, rule.minPriceRub, 'min')) return false;
      if (!ruleNumberPass(metrics.priceRub, rule.maxPriceRub, 'max')) return false;
      if (!ruleNumberPass(metrics.salesDynamics, rule.minSalesDynamics, 'min')) return false;
      if (!ruleNumberPass(metrics.salesDynamics, rule.maxSalesDynamics, 'max')) return false;
      if (!ruleNumberPass(metrics.adExpenseShare, rule.maxAdExpenseShare, 'max')) return false;
      if (!ruleNumberPass(metrics.returnCancelRate, rule.maxReturnCancelRate, 'max')) return false;
      if (!ruleNumberPass(metrics.profitMarginPct, rule.minProfitMarginPct, 'min')) return false;
      if (!ruleNumberPass(metrics.sellerCount, rule.maxSellerCount, 'max')) return false;
      if (!ruleNumberPass(metrics.followMinPriceRub, rule.maxFollowMinPriceRub, 'max')) return false;
      if (!ruleNumberPass(metrics.searchCatalogViews, rule.minSearchCatalogViews, 'min')) return false;
      if (!ruleNumberPass(metrics.searchCatalogAddToCartRate, rule.minSearchCatalogAddToCartRate, 'min')) return false;
      if (!ruleNumberPass(metrics.weightGrams, rule.maxWeightGrams, 'max')) return false;
      if (!ruleNumberPass(metrics.createDays, rule.minCreateDays, 'min')) return false;
      if (!ruleNumberPass(metrics.createDays, rule.maxCreateDays, 'max')) return false;
      if (!ruleNumberPass(metrics.promoDays, rule.minPromoDays, 'min')) return false;
      if (!ruleNumberPass(metrics.promoDays, rule.maxPromoDays, 'max')) return false;
      if (!ruleNumberPass(metrics.discountPercent, rule.minDiscountPercent, 'min')) return false;
      if (!ruleNumberPass(metrics.discountPercent, rule.maxDiscountPercent, 'max')) return false;
      if (!ruleNumberPass(metrics.promoRevenueShare, rule.minPromoRevenueShare, 'min')) return false;
      if (!ruleNumberPass(metrics.promoRevenueShare, rule.maxPromoRevenueShare, 'max')) return false;
      if (!ruleNumberPass(metrics.paidPromotionDays, rule.minPaidPromotionDays, 'min')) return false;
      if (!ruleNumberPass(metrics.paidPromotionDays, rule.maxPaidPromotionDays, 'max')) return false;
      if (!ruleNumberPass(metrics.productCardViews, rule.minProductCardViews, 'min')) return false;
      if (!ruleNumberPass(metrics.productCardAddToCartRate, rule.minProductCardAddToCartRate, 'min')) return false;
      if (!ruleNumberPass(metrics.convViewToOrder, rule.minConvViewToOrder, 'min')) return false;
      if (rule.salesSchema && !salesSchema.includes(rule.salesSchema.toLowerCase())) return false;
      if (rule.brandContains && !brand.includes(rule.brandContains.toLowerCase())) return false;
      if (rule.hasBrand === true && !brand) return false;
      if (rule.hasBrand === false && brand) return false;
      return true;
    }).map((rule) => ({
      id: rule.id,
      name: rule.name,
      tag: rule.tag || rule.name,
      color: rule.color,
      priority: rule.priority || 0,
      autoFavorite: rule.autoFavorite === true,
    }));
  }

  function buildSelectionMetricRow(sku, dom, row) {
    const p = row || {};
    const cardDom = dom || {};
    return Object.assign({}, cardDom, p, {
      sku,
      priceRub: firstPresentValue(p.priceRub, p.pagePrice, p.avgPrice, cardDom.price),
      soldCount: firstPresentValue(p.soldCount, p.monthlySales, pickSales(p)),
      soldSum: firstPresentValue(p.soldSum, p.gmvSum, pickGmv(p)),
      salesDynamics: firstPresentValue(p.salesDynamics),
      adExpenseShare: firstPresentValue(p.adExpenseShare, p.drr),
      returnCancelRate: deriveSelectionReturnCancelRate(p),
      sellerCount: firstPresentValue(p.sellerCount, p.followSellerCount),
      minFollowPriceRub: firstPresentValue(p.minFollowPriceRub, p.followMinPriceRub, p.follow_min_price),
      searchCatalogViews: firstPresentValue(p.searchCatalogViews, p.sessionCountSearch),
      searchCatalogAddToCartRate: firstPresentValue(p.searchCatalogAddToCartRate, p.convToCartSearch),
      weightGrams: firstPresentValue(p.weightGrams, p.grossWeightGrams, pickWeight(p)),
      createDays: firstPresentValue(p.createDays, deriveSelectionCreateDays(p)),
      nullableCreateDate: firstPresentValue(p.nullableCreateDate, p.pCreateDate, p.createDate, pickRawCreateDate(p)),
      promoDays: firstPresentValue(p.promoDays, p.daysInPromo),
      discountPercent: firstPresentValue(p.promoDiscountPercent, p.discount),
      promoRevenueShare: firstPresentValue(p.promoRevenueShare, p.promoConversionRate),
      paidPromotionDays: firstPresentValue(p.paidPromotionDays, p.daysWithTrafarets),
      productCardViews: firstPresentValue(p.productCardViews, p.qtyViewPdp),
      productCardAddToCartRate: firstPresentValue(p.productCardAddToCartRate, p.convToCartPdp, p.pdpToCartConversion),
      convViewToOrder: firstPresentValue(p.convViewToOrder, p.showConversionRate),
      brand: firstPresentValue(p.brand, cardDom.brand),
      salesSchema: firstPresentValue(p.salesSchema, cardDom.salesSchema),
    });
  }

  function renderProductSelectionTags(wrap, matches) {
    const tags = wrap.querySelector('.ss-erp-selection-tags');
    const matched = Array.isArray(matches) && matches.length > 0;
    wrap.setAttribute('data-ss-erp-selection-matched', matched ? '1' : '0');
    wrap.dataset.ssErpSelectionMatched = matched ? '1' : '0';
    if (matched) {
      // T3：卡片底色取命中规则（priority 最高）的 color 派生浅渐变。
      const cardTint = deriveSelectionRuleTint(pickSelectionRuleForCard(matches).color);
      wrap.style.borderColor = cardTint.border;
      wrap.style.background = cardTint.cardBg;
    } else {
      wrap.style.borderColor = SS_ERP_LIST_THEME.borderStrong;
      wrap.style.background = SS_ERP_LIST_THEME.cardGradient;
    }
    if (!tags) return;
    if (!matched) {
      tags.style.display = 'none';
      tags.innerHTML = '';
      return;
    }
    tags.style.display = 'flex';
    tags.innerHTML = matches.slice(0, 3).map((rule) => {
      // T2：标签背景改规则色浅渐变，规则色作描边/文字。
      const tint = deriveSelectionRuleTint(rule.color);
      return `<span title="${escapeHtml(rule.name)}" style="max-width:100%;border:1px solid ${tint.border};background:${tint.bg};color:${tint.text};border-radius:3px;padding:2px 5px;font-size:10px;font-weight:800;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(rule.tag || rule.name)}</span>`;
    }).join('');
  }

  function normalizeProductSelectionPoolStatusItem(item) {
    if (!item || typeof item !== 'object') return null;
    const sku = String(item.sku || item.productId || item.product_id || '').trim();
    if (!sku) return null;
    return {
      sku,
      inPool: item.inPool !== false && String(item.status || 'active') !== 'removed',
      title: String(item.title || ''),
      tags: Array.isArray(item.tags) ? item.tags : [],
      source: String(item.source || 'erp'),
      checkedAt: Date.now(),
    };
  }

  function getProductSelectionPoolStatus(sku) {
    const key = String(sku || '').trim();
    if (!key) return null;
    const cached = productSelectionPoolStatusCache.get(key);
    if (!cached) return null;
    if (Date.now() - Number(cached.checkedAt || 0) > PRODUCT_SELECTION_POOL_STATUS_TTL_MS) {
      productSelectionPoolStatusCache.delete(key);
      return null;
    }
    return cached;
  }

  function markProductSelectionPoolStatus(sku, patch) {
    const key = String(sku || '').trim();
    if (!key) return;
    productSelectionPoolStatusCache.set(key, Object.assign({
      sku: key,
      inPool: false,
      checkedAt: Date.now(),
      source: 'erp',
    }, patch || {}, { checkedAt: Date.now() }));
    updateProductSelectionPoolStatusViews(key);
  }

  function updateProductSelectionPoolStatusViews(sku) {
    const targetSku = String(sku || '').trim();
    if (!targetSku) return;
    const status = getProductSelectionPoolStatus(targetSku);
    document.querySelectorAll('[data-role="selection-pool-status"]').forEach((el) => {
      if (String(el.getAttribute('data-ss-erp-pool-sku') || '') !== targetSku) return;
      const inPool = Boolean(status && status.inPool);
      el.style.display = inPool ? 'inline-flex' : 'none';
      el.textContent = '已入池';
      el.setAttribute('title', status && status.source === 'local' ? '已加入本地选品池，等待 ERP 同步' : '已加入 ERP 选品池');
    });
    document.querySelectorAll(`[${SKU_ATTR}="${targetSku}"] .${CARD_CLASS}`).forEach((wrap) => {
      wrap.setAttribute('data-ss-erp-selection-pool', status && status.inPool ? '1' : '0');
    });
  }

  function scheduleProductSelectionPoolStatusFetch(skus) {
    const ids = (Array.isArray(skus) ? skus : [skus])
      .map((sku) => String(sku || '').trim())
      .filter(Boolean);
    ids.forEach((sku) => {
      if (getProductSelectionPoolStatus(sku)) return;
      productSelectionPoolStatusPending.add(sku);
    });
    if (!productSelectionPoolStatusPending.size || productSelectionPoolStatusTimer) return;
    productSelectionPoolStatusTimer = setTimeout(flushProductSelectionPoolStatusFetch, 180);
  }

  async function flushProductSelectionPoolStatusFetch() {
    const skus = Array.from(productSelectionPoolStatusPending).slice(0, 500);
    productSelectionPoolStatusPending.clear();
    productSelectionPoolStatusTimer = null;
    if (!skus.length) return;
    const response = await send({
      type: 'spb-self-hosted:get-product-selection-pool-status',
      platform: 'ozon',
      skus,
    }, 15000);
    const data = response && response.ok ? (response.data || {}) : {};
    const items = Array.isArray(data.items)
      ? data.items
      : Object.values(data.itemsBySku || {});
    const found = new Set();
    items.forEach((item) => {
      const normalized = normalizeProductSelectionPoolStatusItem(item);
      if (!normalized) return;
      found.add(normalized.sku);
      productSelectionPoolStatusCache.set(normalized.sku, normalized);
      updateProductSelectionPoolStatusViews(normalized.sku);
    });
    skus.forEach((sku) => {
      if (found.has(sku)) return;
      markProductSelectionPoolStatus(sku, { inPool: false, source: 'erp' });
    });
  }

  function buildProductSelectionPoolItem(productId, dom, row, autoRules, priceRub, tags, note, source) {
    const cardDom = dom || {};
    const data = row || {};
    return {
      platform: 'ozon',
      sku: productId,
      productId,
      title: firstPresentValue(data.title, data.name, cardDom.title, `Ozon SKU ${productId}`),
      url: firstPresentValue(cardDom.url, data.sourceUrl, data.url, `https://www.ozon.ru/product/${productId}/`),
      image: firstPresentValue(data.image, data.coverImage, cardDom.image, ''),
      priceRub: Number(priceRub) || null,
      currency: 'RUB',
      source: source || 'extension-auto-rule',
      ruleIds: (Array.isArray(autoRules) ? autoRules : []).map((rule) => String(rule.id || '')).filter(Boolean),
      tags,
      note,
      metrics: {
        soldCount: firstPresentValue(data.soldCount, data.monthlySales),
        soldSum: firstPresentValue(data.soldSum, data.gmvSum),
        sellerCount: firstPresentValue(data.sellerCount, data.followSellerCount),
        minFollowPriceRub: firstPresentValue(data.minFollowPriceRub, data.followMinPriceRub),
        adExpenseShare: firstPresentValue(data.adExpenseShare, data.drr),
        returnCancelRate: deriveSelectionReturnCancelRate(data),
        profitMarginPct: firstPresentValue(data.profitMarginPct),
        weightGrams: firstPresentValue(data.weightGrams, cardDom.weightGrams),
        brand: firstPresentValue(data.brand, cardDom.brand),
        salesSchema: firstPresentValue(data.salesSchema, cardDom.salesSchema),
      },
    };
  }

  async function syncProductSelectionPoolItem(item) {
    if (!item || !item.sku) return { ok: false, error: '缺少 SKU' };
    return await send({
      type: 'spb-self-hosted:upsert-product-selection-pool-item',
      item,
    }, 15000);
  }

  function maybeAutoFavoriteProductPool(sku, dom, row, matches) {
    const autoRules = (Array.isArray(matches) ? matches : []).filter((rule) => rule && rule.autoFavorite === true);
    const productId = String(sku || '').trim();
    if (!productId || !autoRules.length) return;
    const ruleKey = autoRules.map((rule) => String(rule.id || rule.tag || rule.name || '')).filter(Boolean).join('|');
    const poolKey = `${getListSkuPageKey()}:${productId}:${ruleKey}`;
    if (autoFavoriteProductPoolSet.has(poolKey)) return;
    autoFavoriteProductPoolSet.add(poolKey);

    const cardDom = dom || {};
    const data = row || {};
    const priceRub = resolvePriceRubEquivalent(data, cardDom);
    const tags = ['选品规则'].concat(autoRules.map((rule) => rule.tag || rule.name).filter(Boolean)).slice(0, 8);
    const note = `自动入池：${tags.slice(1).join('、') || '选品规则命中'}`;
    const poolItem = buildProductSelectionPoolItem(productId, cardDom, data, autoRules, priceRub, tags, note);
    send({
      type: 'ozon-calc:product-pool-upsert',
      payload: {
        now: new Date().toISOString(),
        product: {
          productId,
          sku: productId,
          structuredSku: productId,
          title: firstPresentValue(data.title, data.name, cardDom.title, `Ozon SKU ${productId}`),
          url: firstPresentValue(cardDom.url, data.sourceUrl, data.url, `https://www.ozon.ru/product/${productId}/`),
          pageType: 'list',
          pagePriceValue: Number(firstPresentValue(data.pagePrice, cardDom.price, priceRub)) || 0,
          currentPriceValue: Number(firstPresentValue(data.pagePrice, cardDom.price, priceRub)) || 0,
          pagePriceCurrency: normalizePriceCurrency(firstPresentValue(data.pagePriceCurrency, data.priceCurrency, cardDom.priceCurrency), 'RUB'),
          currency: normalizePriceCurrency(firstPresentValue(data.pagePriceCurrency, data.priceCurrency, cardDom.priceCurrency), 'RUB'),
          weightG: Number(firstPresentValue(data.weightGrams, cardDom.weightGrams, 0)) || 0,
          favorite: true,
          tags,
          note,
        },
        meta: {
          favorite: true,
          tags,
          note,
        },
      },
    }, 12000).then((response) => {
      if (!response || !response.ok) autoFavoriteProductPoolSet.delete(poolKey);
      else markProductSelectionPoolStatus(productId, { inPool: true, source: 'local', title: poolItem.title, tags });
    });
    syncProductSelectionPoolItem(poolItem).then((response) => {
      if (response && response.ok) {
        markProductSelectionPoolStatus(productId, { inPool: true, source: 'erp', title: poolItem.title, tags });
      }
    });
  }

  function getDisplayFieldValue(fieldId, sku, dom, p) {
    const lockedPremium = (value) => ({ value: value == null || value === '' ? '--' : value, locked: value == null || value === '' });
    switch (fieldId) {
      case 'sku':
        return { value: sku, locked: false };
      case 'category':
        return lockedPremium(formatCategoryDisplay(p));
      case 'brand':
        return lockedPremium(pickFlat(p, 'brand'));
      case 'soldCount':
        return { value: pickSales(p) == null ? 'Premium' : formatNum(pickSales(p)), locked: pickSales(p) == null };
      case 'soldSum':
        return { value: pickGmv(p) == null ? 'Premium' : formatRub(pickGmv(p)), locked: pickGmv(p) == null };
      case 'salesDynamics':
        return { value: pickSalesDynamics(p) == null ? '--' : `${pickSalesDynamics(p)}%`, locked: pickSalesDynamics(p) == null };
      case 'adExpenseShare':
        return { value: formatPercentValue(pickFlat(p, 'adExpenseShare')), locked: pickFlat(p, 'adExpenseShare') == null };
      case 'convViewToOrder':
        return { value: formatPercentValue(pickFlat(p, 'convViewToOrder')), locked: pickFlat(p, 'convViewToOrder') == null };
      case 'convToCartSearch':
        return { value: formatPercentValue(pickFlat(p, 'convToCartSearch')), locked: pickFlat(p, 'convToCartSearch') == null };
      case 'nullableRedemptionRate':
        return { value: formatPercentValue(pickFlat(p, 'nullableRedemptionRate')), locked: pickFlat(p, 'nullableRedemptionRate') == null };
      case 'promoDays':
        return { value: pickFlat(p, 'promoDays') == null ? '--' : formatNum(pickFlat(p, 'promoDays')), locked: pickFlat(p, 'promoDays') == null };
      case 'promoDiscountPercent':
        return { value: formatPercentValue(pickFlat(p, 'promoDiscountPercent')), locked: pickFlat(p, 'promoDiscountPercent') == null };
      case 'promoConversionRate':
        return { value: formatPercentValue(pickFlat(p, 'promoConversionRate')), locked: pickFlat(p, 'promoConversionRate') == null };
      case 'paidPromotionDays':
        return { value: pickFlat(p, 'paidPromotionDays') == null ? '--' : formatNum(pickFlat(p, 'paidPromotionDays')), locked: pickFlat(p, 'paidPromotionDays') == null };
      case 'daysWithTrafarets':
        return { value: pickFlat(p, 'daysWithTrafarets') == null ? '--' : formatNum(pickFlat(p, 'daysWithTrafarets')), locked: pickFlat(p, 'daysWithTrafarets') == null };
      case 'promoRevenueShare':
        return { value: formatPercentValue(pickFlat(p, 'promoRevenueShare')), locked: pickFlat(p, 'promoRevenueShare') == null };
      case 'productCardViews':
        return { value: pickFlat(p, 'productCardViews') == null ? 'Premium' : formatNum(pickFlat(p, 'productCardViews')), locked: pickFlat(p, 'productCardViews') == null };
      case 'productCardAddToCartRate':
        return { value: formatPercentValue(firstPresentValue(pickFlat(p, 'productCardAddToCartRate'), pickFlat(p, 'convToCartPdp'))), locked: firstPresentValue(pickFlat(p, 'productCardAddToCartRate'), pickFlat(p, 'convToCartPdp')) == null };
      case 'searchCatalogViews':
        return { value: pickFlat(p, 'searchCatalogViews') == null ? 'Premium' : formatNum(pickFlat(p, 'searchCatalogViews')), locked: pickFlat(p, 'searchCatalogViews') == null };
      case 'searchCatalogAddToCartRate':
        return { value: formatPercentValue(pickFlat(p, 'searchCatalogAddToCartRate')), locked: pickFlat(p, 'searchCatalogAddToCartRate') == null };
      case 'showConversionRate':
        return { value: formatPercentValue(pickFlat(p, 'showConversionRate')), locked: pickFlat(p, 'showConversionRate') == null };
      case 'productClickRate':
        return { value: formatPercentValue(firstPresentValue(pickFlat(p, 'productClickRate'), pickFlat(p, 'clickThroughRate'))), locked: firstPresentValue(pickFlat(p, 'productClickRate'), pickFlat(p, 'clickThroughRate')) == null };
      case 'salesSchema':
        return lockedPremium(pickFlat(p, 'salesSchema'));
      case 'returnCancelRate':
        return { value: formatPercentValue(pickFlat(p, 'returnCancelRate')), locked: pickFlat(p, 'returnCancelRate') == null };
      case 'dimensions':
        return { value: pickDims(p) || '--', locked: !pickDims(p) };
      case 'weight':
        return { value: pickWeight(p) == null ? '--' : `${formatNum(pickWeight(p))}g`, locked: pickWeight(p) == null };
      case 'createDate':
        return { value: pickCreateDate(p) || '--', locked: !pickCreateDate(p) };
      case 'sellerList':
        return formatSellerListTrigger(sku, p);
      case 'minFollowPriceRub':
        return { value: pickFlat(p, 'minFollowPriceRub') == null ? (pickMinPrice(p) == null ? '--' : formatRub(pickMinPrice(p))) : formatRub(pickFlat(p, 'minFollowPriceRub')), locked: pickFlat(p, 'minFollowPriceRub') == null && pickMinPrice(p) == null };
      case 'maxFollowPriceRub':
        return { value: pickFlat(p, 'maxFollowPriceRub') == null ? '--' : formatRub(pickFlat(p, 'maxFollowPriceRub')), locked: pickFlat(p, 'maxFollowPriceRub') == null };
      case 'commission':
        return { value: formatPercentValue(firstPresentValue(pickFlat(p, 'commissionRate'), pickFlat(p, 'commission'))), locked: firstPresentValue(pickFlat(p, 'commissionRate'), pickFlat(p, 'commission')) == null };
      case 'ptj':
        return lockedPremium(pickFlat(p, 'ptj'));
      case 'rfbsCommission':
        return { value: formatPercentValue(firstPresentValue(pickFlat(p, 'rfbsCommission'), pickFlat(p, 'commissionRfbs'))), locked: firstPresentValue(pickFlat(p, 'rfbsCommission'), pickFlat(p, 'commissionRfbs')) == null };
      case 'fbpCommission':
        return { value: formatPercentValue(firstPresentValue(pickFlat(p, 'fbpCommission'), pickFlat(p, 'commissionFbp'))), locked: firstPresentValue(pickFlat(p, 'fbpCommission'), pickFlat(p, 'commissionFbp')) == null };
      default:
        return { value: '--', locked: true };
    }
  }

  function rerenderAllListMetrics() {
    const includeDetail = selectedListFieldsNeedDetail();
    document.querySelectorAll(`.${CARD_CLASS}`).forEach((wrap) => {
      const sku = wrap.getAttribute('data-ss-erp-sku') || '';
      const dom = wrap.__ssErpDom || {};
      renderMetrics(wrap, sku, dom, getBestCachedPremium(sku) || wrap.__ssErpPremium || null);
      if (includeDetail && !getCachedPremium(sku, { includeDetail: true })) {
        const requestEpoch = premiumContextEpoch;
        void fetchPublicProduct(sku, {
          includeDetail: true,
          isCancelled: () => !wrap.isConnected,
        }).then((premium) => {
          if (premium && wrap.isConnected && premiumContextEpoch === requestEpoch) {
            renderMetrics(wrap, sku, dom, premium);
          }
        });
      }
    });
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
      `background:${SS_ERP_LIST_THEME.cardGradient}`,
      `border:1px solid ${SS_ERP_LIST_THEME.borderStrong}`,
      'font-size:12px',
      'color:#1e293b',
      'box-shadow:0 1px 4px rgba(15,118,110,0.10)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-sizing:border-box',
      'width:100%',
      'position:relative',
      'z-index:1',
      'overflow:visible',
    ].join(';');

    wrap.innerHTML = [
      '<div class="ss-erp-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
      `  <span style="font-weight:700;color:${SS_ERP_LIST_THEME.primaryDark};font-size:13px">SS ERP</span>`,
      '  <span style="display:flex;align-items:center;gap:5px;min-width:0;">',
      `    <span data-role="selection-pool-status" data-ss-erp-pool-sku="${escapeHtml(sku)}" style="display:none;align-items:center;border:1px solid #93c5fd;background:#eff6ff;color:#1d4ed8;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:800;line-height:1.4;white-space:nowrap;">已入池</span>`,
      '    <span class="ss-erp-status-pill" style="display:none">加载中…</span>',
      '  </span>',
      '</div>',
      '<div class="ss-erp-selection-tags" style="display:none;align-items:center;gap:4px;flex-wrap:wrap;margin:-2px 0 7px 0;min-height:0;"></div>',
      '<div class="ss-erp-metrics" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px"></div>',
      '<div class="ss-erp-actions" style="display:flex;gap:6px">',
      '</div>',
      `<button class="ss-erp-expand-btn" type="button" style="width:100%;margin-top:6px;padding:5px 10px;border:1px solid ${SS_ERP_LIST_THEME.borderStrong};border-radius:6px;background:${SS_ERP_LIST_THEME.primarySoft};color:${SS_ERP_LIST_THEME.primaryDarker};cursor:pointer;font-size:11px;font-weight:600">展开</button>`,
    ].join('');

    renderMetrics(wrap, sku, dom, null);
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
      `border:1px solid ${SS_ERP_LIST_THEME.borderStrong}`,
      'border-radius:8px',
      `background:${SS_ERP_LIST_THEME.primarySoft}`,
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
    const rect = activeExpandedPanel.wrap.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
    if (rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth) {
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
    wrap.__ssErpDom = dom || {};
    wrap.__ssErpPremium = premium || null;
    const matchedRules = matchProductSelectionRules(buildSelectionMetricRow(sku, dom || {}, premium || {}));
    maybeAutoFavoriteProductPool(sku, dom || {}, premium || {}, matchedRules);
    renderProductSelectionTags(wrap, matchedRules);
    scheduleProductSelectionPoolStatusFetch(sku);
    updateProductSelectionPoolStatusViews(sku);

    // 数据源徽章（替代原本的 ERP 状态徽章——不再依赖 ERP 检测）
    const sources = (premium && premium._sources) ? premium._sources : [];
    if (pill && sources.includes('seller-analytics')) {
      pill.textContent = 'Premium';
      pill.style.background = '#ffedd5';
      pill.style.color = '#c2410c';
      pill.style.borderColor = '#fdba74';
    } else if (pill && sources.includes('public-entrypoint')) {
      pill.textContent = '公开数据';
      pill.style.background = '#fef3c7';
      pill.style.color = '#92400e';
      pill.style.borderColor = '#fcd34d';
    } else if (pill && sources.includes('erp-cache')) {
      pill.textContent = 'ERP 缓存';
      pill.style.background = '#f5f5f4';
      pill.style.color = '#57534e';
      pill.style.borderColor = '#d6d3d1';
    } else if (pill && premium === null) {
      pill.textContent = '基础';
      pill.style.background = '#f1f5f9';
      pill.style.color = '#64748b';
      pill.style.borderColor = '#cbd5e1';
    }

    const selectedFields = readSelectedDisplayFieldIds();
    grid.innerHTML = selectedFields
      .map((fieldId) => {
        const field = DISPLAY_FIELD_DEFS.find((item) => item.id === fieldId);
        if (!field) return '';
        const result = getDisplayFieldValue(fieldId, sku, dom || {}, premium);
        return metricCell(field.label, result.value, result.locked);
      })
      .join('');
    grid.querySelectorAll('[data-role="open-seller-list"]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showSellerListModal(button.getAttribute('data-sku') || sku, premium);
      });
    });

    const expanded = getExpandedPanel(wrap);
    if (expanded && (expanded.style.display !== 'none' || expanded.getAttribute('data-rendered') === '1')) {
      expanded.innerHTML = renderExpandedFields(sku, dom, premium);
      expanded.setAttribute('data-rendered', '1');
      if (expanded.style.display !== 'none') positionExpandedPanel(wrap, expanded);
    }
  }

  function metricCell(label, value, locked) {
    const valueHtml = value && typeof value === 'object' && value.__ssErpTrustedHtml
      ? value.html
      : escapeHtml(value);
    return [
      '<div style="background:#fff;border:1px solid #fed7aa;border-radius:6px;padding:5px 8px;display:flex;flex-direction:column;gap:1px;min-width:0;overflow:hidden">',
      `  <span style="color:#a16207;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(label)}</span>`,
      `  <span style="color:${locked ? '#cbd5e1' : '#0f172a'};font-weight:600;font-size:13px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${valueHtml}</span>`,
      '</div>',
    ].join('');
  }

  function showSellerListModal(sku, premium) {
    const rows = normalizeSellerRows(premium);
    const old = document.getElementById('ss-erp-seller-list-modal');
    if (old) old.remove();
    const rowPrices = rows
      .map((row) => parsePrice(row.price))
      .filter((value) => value != null);
    const sellerCount = Number(pickFlat(premium, 'sellerCount')) || rows.length || 0;
    const minPrice = firstPresentValue(
      pickFlat(premium, 'minFollowPriceRub'),
      pickFlat(premium, 'minSellerPrice'),
      pickFlat(premium, 'followMinPriceRub'),
      rowPrices.length ? Math.min(...rowPrices) : null,
    );
    const maxPrice = firstPresentValue(
      pickFlat(premium, 'maxFollowPriceRub'),
      pickFlat(premium, 'maxSellerPrice'),
      pickFlat(premium, 'followMaxPriceRub'),
      rowPrices.length ? Math.max(...rowPrices) : null,
    );
    const modal = document.createElement('div');
    modal.id = 'ss-erp-seller-list-modal';
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:rgba(15,23,42,0.28)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#111827',
    ].join(';');
    const sellerText = pickFlat(premium, 'sellerListText') || '';
    modal.innerHTML = [
      '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 32px));background:#fff;border:1px solid #d1d5db;border-radius:6px;box-shadow:0 18px 48px rgba(15,23,42,0.24);display:flex;flex-direction:column;overflow:hidden;">',
      `  <div style="height:50px;background:${SS_ERP_LIST_THEME.headerGradient};color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid ${SS_ERP_LIST_THEME.primaryDark};">`,
      `    <div style="min-width:0;"><div style="font-size:15px;font-weight:800;">SS ERP 跟卖列表</div><div style="font-size:11px;color:rgba(255,255,255,0.78);margin-top:2px;">SKU ${escapeHtml(sku)}</div></div>`,
      '    <button type="button" data-role="close-seller-list" style="width:28px;height:28px;border:1px solid rgba(255,255,255,0.42);background:rgba(255,255,255,0.14);color:#fff;border-radius:4px;cursor:pointer;font-size:18px;line-height:26px;">×</button>',
      '  </div>',
      '  <div style="padding:12px 16px;overflow:auto;">',
      '    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px;">',
      `      <div style="border:1px solid ${SS_ERP_LIST_THEME.border};background:${SS_ERP_LIST_THEME.primarySoft};border-radius:4px;padding:8px 10px;"><div style="font-size:11px;color:${SS_ERP_LIST_THEME.primaryDark};">跟卖数</div><div style="font-size:18px;font-weight:800;color:${SS_ERP_LIST_THEME.text};line-height:1.2;">${sellerCount ? formatNum(sellerCount) : '--'}</div></div>`,
      `      <div style="border:1px solid ${SS_ERP_LIST_THEME.border};background:${SS_ERP_LIST_THEME.primarySoft};border-radius:4px;padding:8px 10px;"><div style="font-size:11px;color:${SS_ERP_LIST_THEME.primaryDark};">最低</div><div style="font-size:18px;font-weight:800;color:${SS_ERP_LIST_THEME.text};line-height:1.2;">${minPrice != null ? formatRub(minPrice) : '--'}</div></div>`,
      `      <div style="border:1px solid ${SS_ERP_LIST_THEME.border};background:${SS_ERP_LIST_THEME.primarySoft};border-radius:4px;padding:8px 10px;"><div style="font-size:11px;color:${SS_ERP_LIST_THEME.primaryDark};">最高</div><div style="font-size:18px;font-weight:800;color:${SS_ERP_LIST_THEME.text};line-height:1.2;">${maxPrice != null ? formatRub(maxPrice) : '--'}</div></div>`,
      '    </div>',
      rows.length
        ? [
            `<table style="width:100%;border-collapse:separate;border-spacing:0;font-size:13px;table-layout:fixed;border:1px solid ${SS_ERP_LIST_THEME.border};">`,
            `  <thead style="background:${SS_ERP_LIST_THEME.primarySoft};color:${SS_ERP_LIST_THEME.primaryDarker};"><tr>`,
            `    <th style="padding:8px;border:1px solid ${SS_ERP_LIST_THEME.border};text-align:left;">卖家</th>`,
            `    <th style="width:120px;padding:8px;border:1px solid ${SS_ERP_LIST_THEME.border};text-align:right;">价格</th>`,
            '  </tr></thead>',
            '  <tbody>',
            rows.map((row) => [
              '    <tr>',
              `      <td style="padding:7px;border:1px solid ${SS_ERP_LIST_THEME.border};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">`,
              row.logo ? `        <img src="${escapeHtml(row.logo)}" alt="" style="width:28px;height:28px;border:1px solid ${SS_ERP_LIST_THEME.border};border-radius:3px;object-fit:cover;margin-right:8px;vertical-align:middle;">` : `        <span style="display:inline-block;width:28px;height:28px;border:1px solid ${SS_ERP_LIST_THEME.border};border-radius:3px;background:${SS_ERP_LIST_THEME.primarySoft};margin-right:8px;vertical-align:middle;"></span>`,
              row.url
                ? `        <a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer" style="color:${SS_ERP_LIST_THEME.blue};font-weight:700;text-decoration:underline;text-underline-offset:2px;">${escapeHtml(row.name)}</a>`
                : `        <span style="font-weight:700;">${escapeHtml(row.name)}</span>`,
              '      </td>',
              `      <td style="padding:7px;border:1px solid ${SS_ERP_LIST_THEME.border};text-align:right;">${escapeHtml(row.price || '--')}</td>`,
              '    </tr>',
            ].join('')).join(''),
            '  </tbody>',
            '</table>',
          ].join('')
        : `<div style="padding:18px;border:1px dashed ${SS_ERP_LIST_THEME.borderStrong};border-radius:4px;color:${SS_ERP_LIST_THEME.muted};background:${SS_ERP_LIST_THEME.primarySoft};">${escapeHtml(sellerText || '当前数据源只返回了跟卖汇总，没有返回卖家明细。')}</div>`,
      '  </div>',
      '</div>',
    ].join('');
    document.body.appendChild(modal);
    modal.querySelector('[data-role="close-seller-list"]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (event) => {
      if (event.target === modal) modal.remove();
    });
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
    // T7：主段与可配置网格 DISPLAY_FIELD_DEFS 同源——逐字段走 getDisplayFieldValue，
    // 保证网格勾选的字段展开时必现，新增对标指标（rFBS/FBP佣金、搜索目录、展示转化率等）自动纳入，不再维护第二套清单。
    DISPLAY_FIELD_DEFS.forEach((field) => {
      const result = getDisplayFieldValue(field.id, sku, dom || {}, p);
      let value = result.value;
      // sellerList 等返回可信 HTML（按钮）——展开面板按纯文本渲染，跳过以免注入；卖家明细由下方"卖家"文本覆盖。
      if (value && typeof value === 'object' && value.__ssErpTrustedHtml) return;
      if (value == null || value === '') value = '--';
      else if (result.locked && value === 'Premium') value = '🔒 Premium'; // 保留展开面板的锁标记观感
      f.push([field.label, value, result.locked]);
    });
    // === 展开面板专属明细（不在网格 DISPLAY_FIELD_DEFS 中，仅展开时补充）===
    f.push(['评论数', dom.reviews != null ? formatNum(dom.reviews) : '--', dom.reviews == null]);
    f.push(['评分', dom.rating != null ? `${dom.rating} ⭐` : '--', dom.rating == null]);
    f.push(['类目ID', pickCategoryIds(p).join(' / ') || '--', !pickCategoryIds(p).length]);
    f.push(['一级类目', pickFlat(p, 'category1') || '--', !pickFlat(p, 'category1')]);
    f.push(['图片数', p && Array.isArray(p.images) ? p.images.length : '--', !p]);
    f.push(['变体数', p && Array.isArray(p.variants) ? p.variants.length : '--', !p]);
    f.push(['货币', pickFlat(p, 'currency') || 'RUB', false]);
    f.push(['平均价', pickAvgPrice(p) == null ? '--' : '₽' + formatNum(pickAvgPrice(p)), pickAvgPrice(p) == null]);
    f.push(['最低卖家价', pickMinPrice(p) == null ? '--' : '₽' + formatNum(pickMinPrice(p)), pickMinPrice(p) == null]);
    f.push(['浏览量', pickViews(p) == null ? '🔒 Premium' : formatNum(pickViews(p)), pickViews(p) == null]);
    f.push(['库存', pickStock(p) == null ? '🔒 Premium' : formatNum(pickStock(p)), pickStock(p) == null]);
    f.push(['卖家', pickSeller(p) || '--', !pickSeller(p)]);
    f.push(['卖家ID', pickFlat(p, 'sellerId') || '--', !pickFlat(p, 'sellerId')]);
    f.push(['配送天数', pickDeliveryDays(p) == null ? '--' : pickDeliveryDays(p) + '天', pickDeliveryDays(p) == null]);
    f.push(['模型ID', pickFlat(p, 'modelId') || '--', !pickFlat(p, 'modelId')]);
    f.push(['数据源', sources || '--', false]);
    return f;
  }

  function getCurrentPageSkus() {
    ensureListSkuPageContext();
    return Array.from(observedListSkuSet).slice(0, 1000);
  }

  function getCardDomBySku(sku) {
    const card = document.querySelector(`[${SKU_ATTR}="${sku}"]`);
    const wrap = card ? card.querySelector(`.${CARD_CLASS}`) : document.querySelector(`.${CARD_CLASS}[data-ss-erp-sku="${sku}"]`);
    return wrap && wrap.__ssErpDom ? wrap.__ssErpDom : {};
  }

  function quickActionButtonStyle(background, color, border) {
    return [
      'width:100%',
      'height:25px',
      'margin:4px 0',
      `border:${border ? `1px solid ${border}` : '0'}`,
      'border-radius:3px',
      `background:${background}`,
      `color:${color}`,
      'font-size:11px',
      'font-weight:800',
      'line-height:23px',
      'padding:0',
      'cursor:pointer',
      'white-space:nowrap',
      'box-sizing:border-box',
      `box-shadow:${border ? 'none' : '0 1px 2px rgba(15,23,42,0.12)'}`,
    ].join(';');
  }

  function setListQuickStatus(panel, text) {
    const status = panel && panel.querySelector('[data-role="quick-status"]');
    if (status) {
      status.textContent = text || '';
      status.style.color = /失败|请先|没有/.test(String(text || '')) ? '#dc2626' : '#2563eb';
    }
  }

  function openProfitCalculatorFromQuickAction() {
    const drawer = document.getElementById('ozon-calc-drawer');
    const drawerBody = drawer ? drawer.querySelector('.ozon-calc-body') : null;
    if (drawer && drawerBody && window.OZON_CALC_OZON_PANEL && typeof window.OZON_CALC_OZON_PANEL.renderDrawerContent === 'function') {
      drawer.classList.add('open');
      drawer.style.left = '';
      drawer.style.right = '16px';
      drawer.style.top = '80px';
      drawer.style.height = '';
      const fab = document.getElementById('ozon-calc-fab');
      if (fab) fab.style.display = 'none';
      window.OZON_CALC_OZON_PANEL.renderDrawerContent(drawerBody);
      return;
    }
    const fab = document.getElementById('ozon-calc-fab');
    if (fab && typeof fab.click === 'function') {
      fab.click();
      return;
    }
    // The calculator content script owns its own drawer lifecycle. Do not
    // open a legacy ERP page when that drawer is unavailable.
    return;
  }

  function openExtensionSettingsPage(section) {
    const hash = section ? `#${encodeURIComponent(section)}` : '';
    const url = chrome.runtime.getURL(`pages/settings.html${hash}`);
    const tab = window.open(url, '_blank');
    if (tab) {
      try { tab.opener = null; } catch (error) {}
    }
  }

  async function syncOzonCookieFromQuickAction(panel) {
    setListQuickStatus(panel, '同步Cookie...');
    try {
      const response = await send({ type: 'ozon-calc:sync-current-ozon-cookie', payload: {} }, 30000);
      if (response && response.ok) {
        const companyId = response.data && response.data.companyId ? ` · ${response.data.companyId}` : '';
        setListQuickStatus(panel, `Cookie已同步${companyId}`);
        return;
      }
      setListQuickStatus(panel, (response && response.error) || '同步失败');
    } catch (error) {
      setListQuickStatus(panel, error && error.message ? error.message : '同步失败');
    }
  }

  // T6：企鹅店长式列表自动滚动——触发 Ozon 懒加载抓全所有 SKU 卡片。
  // 单例状态：可启停、节流、连续多轮 SKU 无增长即判定到底自停，防风控。
  const autoScrollState = {
    running: false,
    timer: null,
    stableRounds: 0,
    steps: 0,
    lastCount: 0,
    lastScrollHeight: 0,
  };

  function isAutoScrollRunning() {
    return autoScrollState.running;
  }

  function updateAutoScrollButton() {
    const btn = document.querySelector(`#${LIST_QUICK_ACTIONS_ID} [data-role="quick-auto-scroll"]`);
    if (!btn) return;
    const running = autoScrollState.running;
    btn.textContent = running ? '停止滚动' : '自动滚动';
    btn.style.cssText = running
      ? quickActionButtonStyle(SS_ERP_LIST_THEME.danger, '#ffffff')
      : quickActionButtonStyle('#ffffff', '#1f2937', '#cbd5e1');
  }

  function getAutoScrollStepDelayMs() {
    const span = AUTO_SCROLL_STEP_DELAY_MAX_MS - AUTO_SCROLL_STEP_DELAY_MIN_MS;
    return AUTO_SCROLL_STEP_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
  }

  function stopAutoScroll(reason) {
    if (autoScrollState.timer) {
      clearTimeout(autoScrollState.timer);
      autoScrollState.timer = null;
    }
    const wasRunning = autoScrollState.running;
    autoScrollState.running = false;
    autoScrollState.stableRounds = 0;
    autoScrollState.steps = 0;
    updateAutoScrollButton();
    if (wasRunning) {
      const panel = document.getElementById(LIST_QUICK_ACTIONS_ID);
      if (panel) setListQuickStatus(panel, reason || `已停止 · ${getCurrentPageSkus().length} SKU`);
    }
  }

  function startAutoScroll() {
    if (autoScrollState.running) return;
    if (!isProductPage()) return;
    autoScrollState.running = true;
    autoScrollState.stableRounds = 0;
    autoScrollState.steps = 0;
    autoScrollState.lastCount = getCurrentPageSkus().length;
    autoScrollState.lastScrollHeight = document.documentElement.scrollHeight || 0;
    updateAutoScrollButton();

    const step = () => {
      if (!autoScrollState.running) return;
      // 页面切后台时暂停一拍，避免空滚 + 减少无谓请求。
      if (document.visibilityState !== 'visible') {
        autoScrollState.timer = setTimeout(step, getAutoScrollStepDelayMs());
        return;
      }
      // 硬上限保护：异常页面（无限流）避免无限滚动。
      if (autoScrollState.steps >= AUTO_SCROLL_MAX_STEPS) {
        stopAutoScroll(`已达上限 · ${getCurrentPageSkus().length} SKU`);
        return;
      }
      autoScrollState.steps += 1;
      const beforeBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      window.scrollBy({ top: Math.max(window.innerHeight * AUTO_SCROLL_STEP_RATIO, 400), behavior: 'smooth' });
      scheduleScan();

      autoScrollState.timer = setTimeout(() => {
        if (!autoScrollState.running) return;
        const count = getCurrentPageSkus().length;
        const scrollHeight = document.documentElement.scrollHeight || 0;
        const grew = count > autoScrollState.lastCount || scrollHeight > autoScrollState.lastScrollHeight + 8;
        autoScrollState.lastCount = count;
        autoScrollState.lastScrollHeight = scrollHeight;
        const atBottom = (scrollHeight - (window.scrollY + window.innerHeight)) < 24;
        if (grew) {
          autoScrollState.stableRounds = 0;
        } else {
          autoScrollState.stableRounds += 1;
        }
        const panel = document.getElementById(LIST_QUICK_ACTIONS_ID);
        if (panel) setListQuickStatus(panel, `滚动中 · ${count} SKU`);
        // 连续多轮无新增 + 确实到底才自停；中途懒加载慢时继续滚，硬上限负责兜底。
        if (autoScrollState.stableRounds >= AUTO_SCROLL_MAX_STABLE && atBottom) {
          stopAutoScroll(`${beforeBottom < 24 ? '已加载完' : '已停止（无新增）'} · ${count} SKU`);
          return;
        }
        step();
      }, getAutoScrollStepDelayMs());
    };

    step();
    const panel = document.getElementById(LIST_QUICK_ACTIONS_ID);
    if (panel) setListQuickStatus(panel, '自动滚动已开始 · 3-5秒随机间隔');
  }

  function toggleAutoScroll() {
    if (autoScrollState.running) stopAutoScroll('已手动停止');
    else startAutoScroll();
  }

  function ensureListQuickActions() {
    if (!isProductPage()) return;
    let panel = document.getElementById(LIST_QUICK_ACTIONS_ID);
    const count = getCurrentPageSkus().length;
    const matchedCount = document.querySelectorAll(`.${CARD_CLASS}[data-ss-erp-selection-matched="1"]`).length;
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = LIST_QUICK_ACTIONS_ID;
      panel.style.cssText = [
        'position:fixed',
        'right:10px',
        'top:50%',
        'transform:translateY(-50%)',
        'z-index:2147483646',
        'width:128px',
        'background:#ffffff',
        'border:1px solid #d1d5db',
        'border-radius:4px',
        'box-shadow:0 10px 28px rgba(15,23,42,0.16)',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'color:#111827',
        'padding:8px',
        'box-sizing:border-box',
        'user-select:none',
        'animation:ssErpDockIn .16s ease-out',
      ].join(';');
      panel.innerHTML = [
        '<div style="display:flex;align-items:center;justify-content:center;gap:5px;margin-bottom:8px;border-bottom:1px solid #e5e7eb;padding-bottom:7px;">',
        '  <span style="width:18px;height:18px;border-radius:3px;background:#111827;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;">SS</span>',
        '  <span style="font-size:11px;font-weight:800;color:#111827;white-space:nowrap;">ERP 工具</span>',
        '</div>',
        `<button type="button" data-role="quick-profit" title="打开本页 SKU 利润测算" style="${quickActionButtonStyle(SS_ERP_LIST_THEME.primaryDark, '#ffffff')}">利润测算</button>`,
        `<button type="button" data-role="quick-bind-cookie" title="同步当前 Ozon / Seller Cookie 到 ERP 店铺" style="${quickActionButtonStyle('#ffffff', '#1f2937', '#cbd5e1')}">绑定Cookie</button>`,
        `<div data-role="quick-match-summary" style="height:24px;margin:4px 0;border:1px solid ${SS_ERP_LIST_THEME.border};background:${SS_ERP_LIST_THEME.primarySoft};color:${SS_ERP_LIST_THEME.primaryDarker};border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;white-space:nowrap;"></div>`,
        `<button type="button" data-role="quick-selection-settings" title="设置选品规则" style="${quickActionButtonStyle('#ffffff', '#1f2937', '#cbd5e1')}">设置选品</button>`,
        `<button type="button" data-role="quick-field-config" title="选择列表卡片展示字段" style="${quickActionButtonStyle('#ffffff', '#1f2937', '#cbd5e1')}">展示字段</button>`,
        `<button type="button" data-role="quick-auto-scroll" title="自动滚动列表触发懒加载，抓全所有 SKU" style="${quickActionButtonStyle('#ffffff', '#1f2937', '#cbd5e1')}">自动滚动</button>`,
        '<div data-role="quick-status" style="min-height:16px;margin-top:5px;text-align:center;font-size:10px;line-height:1.25;color:#64748b;"></div>',
      ].join('');
      document.body.appendChild(panel);
      panel.querySelector('[data-role="quick-profit"]').addEventListener('click', () => {
        openProfitCalculatorFromQuickAction();
        setListQuickStatus(panel, '利润测算已打开');
      });
      panel.querySelector('[data-role="quick-bind-cookie"]').addEventListener('click', async () => {
        await syncOzonCookieFromQuickAction(panel);
      });
      panel.querySelector('[data-role="quick-selection-settings"]').addEventListener('click', () => {
        showProductSelectionRulesModal();
        setListQuickStatus(panel, '设置已打开');
      });
      panel.querySelector('[data-role="quick-field-config"]').addEventListener('click', () => {
        showListFieldConfigModal();
        setListQuickStatus(panel, '字段已打开');
      });
      panel.querySelector('[data-role="quick-auto-scroll"]').addEventListener('click', () => {
        toggleAutoScroll();
      });
    }
    const matchSummary = panel.querySelector('[data-role="quick-match-summary"]');
    if (matchSummary) matchSummary.textContent = `${count} SKU · 命中 ${matchedCount}`;
    // 面板可能被周期性重建——同步自动滚动按钮态；滚动进行中时不覆盖其状态文案。
    updateAutoScrollButton();
    if (!isAutoScrollRunning()) setListQuickStatus(panel, `${count} SKU · 命中 ${matchedCount}`);
  }

  function showListFieldConfigModal() {
    const old = document.getElementById(LIST_FIELD_CONFIG_MODAL_ID);
    if (old) old.remove();

    const selected = new Set(readSelectedDisplayFieldIds());
    const modal = document.createElement('div');
    modal.id = LIST_FIELD_CONFIG_MODAL_ID;
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:rgba(15,23,42,0.36)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#111827',
    ].join(';');
    modal.innerHTML = [
      '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 32px));background:#fff;border:1px solid #d1d5db;border-radius:4px;box-shadow:0 18px 48px rgba(15,23,42,0.26);display:flex;flex-direction:column;overflow:hidden;animation:ssErpModalIn .16s ease-out;">',
      `  <div style="height:50px;background:${SS_ERP_LIST_THEME.headerGradient};color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid ${SS_ERP_LIST_THEME.primaryDark};">`,
      '    <div style="font-size:15px;font-weight:800;">选择需要展示的数据</div>',
      '    <button type="button" data-role="close-field-config" style="width:28px;height:28px;border:1px solid rgba(255,255,255,0.42);background:rgba(255,255,255,0.14);color:#fff;border-radius:3px;cursor:pointer;font-size:18px;line-height:26px;">×</button>',
      '  </div>',
      '  <div style="padding:10px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:flex-end;background:#f9fafb;">',
      '    <div style="display:flex;gap:6px;">',
      '      <button type="button" data-role="select-all-fields" style="height:28px;border:1px solid #d1d5db;background:#fff;border-radius:3px;padding:0 10px;font-size:12px;cursor:pointer;">全选</button>',
      '      <button type="button" data-role="select-default-fields" style="height:28px;border:1px solid #d1d5db;background:#fff;border-radius:3px;padding:0 10px;font-size:12px;cursor:pointer;">默认</button>',
      '    </div>',
      '  </div>',
      '  <div style="padding:14px 16px;overflow:auto;">',
      ['seller', 'supplement', 'computed'].map((source) => [
        `    <div style="margin-bottom:14px;">`,
        `      <div style="display:flex;align-items:center;gap:8px;margin:0 0 8px 0;">`,
        `        <span style="font-size:12px;font-weight:800;color:#111827;">${escapeHtml(DISPLAY_FIELD_SOURCE_LABELS[source])}</span>`,
        `        <span style="height:1px;flex:1;background:#e5e7eb;"></span>`,
        '      </div>',
        '      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">',
        DISPLAY_FIELD_DEFS.filter((field) => field.source === source).map((field) => [
          `        <label style="display:flex;align-items:center;gap:7px;min-height:32px;border:1px solid #e5e7eb;background:#fff;border-radius:3px;padding:0 9px;font-size:12px;color:#374151;cursor:pointer;">`,
          `          <input type="checkbox" data-role="field-option" value="${escapeHtml(field.id)}" ${selected.has(field.id) ? 'checked' : ''} style="margin:0;">`,
          `          <span>${escapeHtml(field.label)}</span>`,
          '        </label>',
        ].join('')).join(''),
        '      </div>',
        '    </div>',
      ].join('')).join(''),
      '  </div>',
      '  <div style="height:54px;border-top:1px solid #e5e7eb;background:#f3f4f6;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 16px;">',
      '    <button type="button" data-role="cancel-field-config" style="height:32px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:3px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer;">取消</button>',
      `    <button type="button" data-role="save-field-config" style="height:32px;border:0;background:${SS_ERP_LIST_THEME.primary};color:#fff;border-radius:3px;padding:0 16px;font-size:13px;font-weight:800;cursor:pointer;">确定</button>`,
      '  </div>',
      '</div>',
    ].join('');
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector('[data-role="close-field-config"]').addEventListener('click', close);
    modal.querySelector('[data-role="cancel-field-config"]').addEventListener('click', close);
    modal.querySelector('[data-role="select-all-fields"]').addEventListener('click', () => {
      modal.querySelectorAll('[data-role="field-option"]').forEach((box) => { box.checked = true; });
    });
    modal.querySelector('[data-role="select-default-fields"]').addEventListener('click', () => {
      modal.querySelectorAll('[data-role="field-option"]').forEach((box) => {
        box.checked = DEFAULT_DISPLAY_FIELD_IDS.includes(box.value);
      });
    });
    modal.querySelector('[data-role="save-field-config"]').addEventListener('click', () => {
      const ids = Array.from(modal.querySelectorAll('[data-role="field-option"]:checked')).map((box) => box.value);
      writeSelectedDisplayFieldIds(ids);
      rerenderAllListMetrics();
      close();
    });
  }

  function createDefaultProductSelectionRule() {
    return normalizeProductSelectionRule({
      id: `local-${Date.now()}`,
      name: '潜力 SKU',
      enabled: true,
      tag: '潜力',
      color: '#2563eb',
      minSoldCount: 10,
      maxAdExpenseShare: 20,
      maxReturnCancelRate: 30,
      maxSellerCount: 8,
    }, 0);
  }

  function selectionRuleField(label, role, value, placeholder, type) {
    return [
      '<label style="display:flex;flex-direction:column;gap:3px;min-width:0;">',
      `  <span style="font-size:11px;font-weight:800;color:#475569;white-space:nowrap;">${escapeHtml(label)}</span>`,
      `  <input type="${escapeHtml(type || 'number')}" data-role="${escapeHtml(role)}" value="${value == null ? '' : escapeHtml(value)}" placeholder="${escapeHtml(placeholder || label)}" style="height:30px;border:1px solid #d1d5db;border-radius:3px;padding:0 7px;font-size:12px;min-width:0;background:#fff;">`,
      '</label>',
    ].join('');
  }

  function selectionRuleSelect(label, role, value, options) {
    const current = String(value == null ? '' : value);
    const optionHtml = options.map((option) => {
      const optionValue = String(option.value == null ? '' : option.value);
      return `<option value="${escapeHtml(optionValue)}" ${optionValue === current ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
    }).join('');
    return [
      '<label style="display:flex;flex-direction:column;gap:3px;min-width:0;">',
      `  <span style="font-size:11px;font-weight:800;color:#475569;white-space:nowrap;">${escapeHtml(label)}</span>`,
      `  <select data-role="${escapeHtml(role)}" style="height:30px;border:1px solid #d1d5db;border-radius:3px;padding:0 7px;font-size:12px;min-width:0;background:#fff;">${optionHtml}</select>`,
      '</label>',
    ].join('');
  }

  function selectionRuleToggle(label, role, checked) {
    return [
      '<label style="display:flex;align-items:center;gap:7px;height:32px;border:1px solid #d1d5db;border-radius:3px;background:#fff;padding:0 9px;font-size:12px;font-weight:800;color:#334155;min-width:0;">',
      `  <input type="checkbox" data-role="${escapeHtml(role)}" ${checked ? 'checked' : ''} style="margin:0;">`,
      `  <span style="white-space:nowrap;">${escapeHtml(label)}</span>`,
      '</label>',
    ].join('');
  }

  function selectionRuleSection(title, columns, fields) {
    return [
      '<section data-role="selection-rule-section" style="border-top:1px solid #e5e7eb;padding-top:12px;">',
      '  <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;">',
      `    <span style="font-size:12px;font-weight:900;color:#111827;white-space:nowrap;">${escapeHtml(title)}</span>`,
      '    <span style="height:1px;flex:1;background:#e5e7eb;"></span>',
      '  </div>',
      `  <div style="display:grid;grid-template-columns:repeat(${Number(columns) || 4},minmax(0,1fr));gap:10px;align-items:end;">`,
      fields.join(''),
      '  </div>',
      '</section>',
    ].join('');
  }

  function selectionRuleRange(label, minRole, minValue, maxRole, maxValue, unit, minPlaceholder, maxPlaceholder) {
    return [
      '<label style="display:flex;flex-direction:column;gap:3px;min-width:0;">',
      `  <span style="font-size:11px;font-weight:800;color:#475569;white-space:nowrap;">${escapeHtml(label)}</span>`,
      '  <span style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:6px;align-items:center;">',
      `    <input type="number" data-role="${escapeHtml(minRole)}" value="${minValue == null ? '' : escapeHtml(minValue)}" placeholder="${escapeHtml(minPlaceholder || (label + '≥'))}" style="height:30px;border:1px solid #d1d5db;border-radius:3px;padding:0 7px;font-size:12px;min-width:0;background:#fff;">`,
      '    <span style="font-size:11px;color:#94a3b8;">至</span>',
      `    <input type="number" data-role="${escapeHtml(maxRole)}" value="${maxValue == null ? '' : escapeHtml(maxValue)}" placeholder="${escapeHtml(maxPlaceholder || (label + '≤'))}" style="height:30px;border:1px solid #d1d5db;border-radius:3px;padding:0 7px;font-size:12px;min-width:0;background:#fff;">`,
      '  </span>',
      unit ? `  <span style="font-size:10px;color:#94a3b8;">${escapeHtml(unit)}</span>` : '',
      '</label>',
    ].join('');
  }

  function selectionRuleTableRow(rule, index) {
    const item = normalizeProductSelectionRule(rule, index);
    const color = normalizeSelectionRuleColor(item.color);
    return [
      `<tr data-role="selection-rule-list-row" data-rule-id="${escapeHtml(item.id)}" data-index="${index}" style="animation:ssErpRowIn .12s ease-out;">`,
      `  <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;"><span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${color};margin-right:7px;"></span>${escapeHtml(item.name)}</td>`,
      `  <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;"><span style="display:inline-block;border:1px solid ${color};color:${color};background:#fff;border-radius:3px;padding:2px 8px;font-size:12px;font-weight:800;">${escapeHtml(item.tag)}</span></td>`,
      `  <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:${item.autoFavorite ? '#1d4ed8' : '#64748b'};font-weight:700;">${item.autoFavorite ? '是' : '否'}</td>`,
      `  <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;"><input type="checkbox" data-role="toggle-rule-enabled" data-index="${index}" ${item.enabled ? 'checked' : ''}></td>`,
      `  <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:#334155;">${formatNum(item.priority || 0)}</td>`,
      `  <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;color:#64748b;">${escapeHtml(item.updatedAt ? formatDate(item.updatedAt) : '--')}</td>`,
      '  <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap;">',
      `    <button type="button" data-role="edit-selection-rule" data-index="${index}" style="height:28px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:3px;padding:0 10px;font-size:12px;font-weight:800;cursor:pointer;">编辑</button>`,
      `    <button type="button" data-role="delete-selection-rule" data-index="${index}" style="height:28px;margin-left:6px;border:1px solid #fecaca;background:#fff;color:#dc2626;border-radius:3px;padding:0 10px;font-size:12px;font-weight:800;cursor:pointer;">删除</button>`,
      '  </td>',
      '</tr>',
    ].join('');
  }

  function selectionRuleEditorRow(rule, index) {
    const item = normalizeProductSelectionRule(rule, index);
    const hasBrandValue = item.hasBrand == null ? '' : String(item.hasBrand);
    return [
      `<div data-role="selection-rule-editor-form" data-rule-id="${escapeHtml(item.id)}" data-index="${index}" style="display:flex;flex-direction:column;gap:12px;">`,
      selectionRuleSection('规则基础', 6, [
        selectionRuleToggle('是否启用', 'rule-enabled', item.enabled),
        selectionRuleToggle('自动入池', 'rule-auto-favorite', item.autoFavorite),
        selectionRuleField('规则名称', 'rule-name', item.name, '规则名称', 'text'),
        selectionRuleField('标签', 'rule-tag', item.tag, '标签', 'text'),
        selectionRuleField('优先级', 'rule-priority', item.priority, '0-100'),
        `<label style="display:flex;flex-direction:column;gap:3px;"><span style="font-size:11px;font-weight:800;color:#475569;white-space:nowrap;">颜色</span><input type="color" data-role="rule-color" value="${escapeHtml(item.color)}" title="标签颜色" style="width:52px;height:30px;border:1px solid #d1d5db;border-radius:3px;background:#fff;padding:1px;"></label>`,
      ]),
      selectionRuleSection('商品基础', 4, [
        selectionRuleField('品牌包含', 'brand-contains', item.brandContains, '品牌关键词', 'text'),
        selectionRuleSelect('有品牌', 'has-brand', hasBrandValue, [{ value: '', label: '不限' }, { value: 'true', label: '有品牌' }, { value: 'false', label: '无品牌' }]),
        selectionRuleField('发货模式', 'sales-schema', item.salesSchema, 'FBO/FBS/rFBS', 'text'),
        selectionRuleField('重量≤', 'max-weight-grams', item.maxWeightGrams, '克'),
      ]),
      selectionRuleSection('销售与价格', 4, [
        selectionRuleField('月销量≥', 'min-sold-count', item.minSoldCount, '件数'),
        selectionRuleField('月销售额≥', 'min-sold-sum', item.minSoldSum, 'RUB'),
        selectionRuleRange('价格', 'min-price-rub', item.minPriceRub, 'max-price-rub', item.maxPriceRub, 'RUB', '价格≥', '价格≤'),
        selectionRuleRange('周转动态', 'min-sales-dynamics', item.minSalesDynamics, 'max-sales-dynamics', item.maxSalesDynamics, '%', '周转动态≥', '周转动态≤'),
        selectionRuleField('广告%≤', 'max-ad-expense-share', item.maxAdExpenseShare, '%'),
        selectionRuleField('退取%≤', 'max-return-cancel-rate', item.maxReturnCancelRate, '%'),
        selectionRuleField('利润%≥', 'min-profit-margin-pct', item.minProfitMarginPct, '%'),
      ]),
      selectionRuleSection('流量转化', 4, [
        selectionRuleField('搜索浏览≥', 'min-search-catalog-views', item.minSearchCatalogViews, '次数'),
        selectionRuleField('搜索加购≥', 'min-search-catalog-add-to-cart-rate', item.minSearchCatalogAddToCartRate, '%'),
        selectionRuleField('展示转化≥', 'min-conv-view-to-order', item.minConvViewToOrder, '%'),
        selectionRuleField('商品卡浏览≥', 'min-product-card-views', item.minProductCardViews, '次数'),
        selectionRuleField('商品卡加购≥', 'min-product-card-add-to-cart-rate', item.minProductCardAddToCartRate, '%'),
      ]),
      selectionRuleSection('促销与时间', 4, [
        selectionRuleRange('上架天数', 'min-create-days', item.minCreateDays, 'max-create-days', item.maxCreateDays, '天', '上架天数≥', '上架天数≤'),
        selectionRuleRange('促销天数', 'min-promo-days', item.minPromoDays, 'max-promo-days', item.maxPromoDays, '天', '促销天数≥', '促销天数≤'),
        selectionRuleRange('折扣', 'min-discount-percent', item.minDiscountPercent, 'max-discount-percent', item.maxDiscountPercent, '%', '折扣≥', '折扣≤'),
        selectionRuleRange('促销转化', 'min-promo-revenue-share', item.minPromoRevenueShare, 'max-promo-revenue-share', item.maxPromoRevenueShare, '%', '促销转化≥', '促销转化≤'),
        selectionRuleRange('付费推广', 'min-paid-promotion-days', item.minPaidPromotionDays, 'max-paid-promotion-days', item.maxPaidPromotionDays, '天', '付费推广≥', '付费推广≤'),
      ]),
      selectionRuleSection('跟卖与利润', 4, [
        selectionRuleField('跟卖≤', 'max-seller-count', item.maxSellerCount, '卖家数'),
        selectionRuleField('跟卖最低≤', 'max-follow-min-price-rub', item.maxFollowMinPriceRub, 'RUB'),
      ]),
      '</div>',
    ].join('');
  }

  function readRuleRowNumber(row, role) {
    const input = row.querySelector(`[data-role="${role}"]`);
    return normalizeRuleNumber(input && input.value);
  }

  function readRuleRowText(row, role) {
    const input = row.querySelector(`[data-role="${role}"]`);
    return input && input.value ? String(input.value).trim() : '';
  }

  function readRuleRowBoolean(row, role) {
    const input = row.querySelector(`[data-role="${role}"]`);
    return normalizeRuleBoolean(input && input.value);
  }

  function collectProductSelectionRuleFromEditor(editor, index, previous) {
    const form = editor.querySelector('[data-role="selection-rule-editor-form"]') || editor;
    return normalizeProductSelectionRule({
      id: form.getAttribute('data-rule-id') || (previous && previous.id) || `local-${Date.now()}-${index}`,
      enabled: Boolean((form.querySelector('[data-role="rule-enabled"]') || {}).checked),
      autoFavorite: Boolean((form.querySelector('[data-role="rule-auto-favorite"]') || {}).checked),
      name: readRuleRowText(form, 'rule-name'),
      tag: readRuleRowText(form, 'rule-tag'),
      color: readRuleRowText(form, 'rule-color'),
      priority: readRuleRowNumber(form, 'rule-priority'),
      brandContains: readRuleRowText(form, 'brand-contains'),
      hasBrand: readRuleRowBoolean(form, 'has-brand'),
      minSoldCount: readRuleRowNumber(form, 'min-sold-count'),
      minSoldSum: readRuleRowNumber(form, 'min-sold-sum'),
      minPriceRub: readRuleRowNumber(form, 'min-price-rub'),
      maxPriceRub: readRuleRowNumber(form, 'max-price-rub'),
      maxWeightGrams: readRuleRowNumber(form, 'max-weight-grams'),
      minSalesDynamics: readRuleRowNumber(form, 'min-sales-dynamics'),
      maxSalesDynamics: readRuleRowNumber(form, 'max-sales-dynamics'),
      maxAdExpenseShare: readRuleRowNumber(form, 'max-ad-expense-share'),
      maxReturnCancelRate: readRuleRowNumber(form, 'max-return-cancel-rate'),
      minProfitMarginPct: readRuleRowNumber(form, 'min-profit-margin-pct'),
      minCreateDays: readRuleRowNumber(form, 'min-create-days'),
      maxCreateDays: readRuleRowNumber(form, 'max-create-days'),
      minPromoDays: readRuleRowNumber(form, 'min-promo-days'),
      maxPromoDays: readRuleRowNumber(form, 'max-promo-days'),
      minDiscountPercent: readRuleRowNumber(form, 'min-discount-percent'),
      maxDiscountPercent: readRuleRowNumber(form, 'max-discount-percent'),
      minPromoRevenueShare: readRuleRowNumber(form, 'min-promo-revenue-share'),
      maxPromoRevenueShare: readRuleRowNumber(form, 'max-promo-revenue-share'),
      minPaidPromotionDays: readRuleRowNumber(form, 'min-paid-promotion-days'),
      maxPaidPromotionDays: readRuleRowNumber(form, 'max-paid-promotion-days'),
      minProductCardViews: readRuleRowNumber(form, 'min-product-card-views'),
      minProductCardAddToCartRate: readRuleRowNumber(form, 'min-product-card-add-to-cart-rate'),
      maxSellerCount: readRuleRowNumber(form, 'max-seller-count'),
      minSearchCatalogViews: readRuleRowNumber(form, 'min-search-catalog-views'),
      minSearchCatalogAddToCartRate: readRuleRowNumber(form, 'min-search-catalog-add-to-cart-rate'),
      minConvViewToOrder: readRuleRowNumber(form, 'min-conv-view-to-order'),
      maxFollowMinPriceRub: readRuleRowNumber(form, 'max-follow-min-price-rub'),
      salesSchema: readRuleRowText(form, 'sales-schema'),
      createdAt: previous && previous.createdAt,
      updatedAt: previous && previous.updatedAt,
    }, index);
  }

  function collectProductSelectionRuleRows(modal) {
    return normalizeProductSelectionRuleList(modal.__ssErpSelectionRules || []);
  }

  function renderSelectionRulesTable(modal) {
    const body = modal.querySelector('[data-role="selection-rules-list"]');
    if (!body) return;
    const rules = collectProductSelectionRuleRows(modal);
    body.innerHTML = rules.length
      ? rules.map((rule, index) => selectionRuleTableRow(rule, index)).join('')
      : '<tr><td colspan="7" style="padding:28px;text-align:center;color:#64748b;border-bottom:1px solid #e5e7eb;">暂无规则</td></tr>';
  }

  function showSelectionRuleEditor(modal, rule, index) {
    const old = modal.querySelector('[data-role="selection-rule-editor"]');
    if (old) old.remove();
    const item = normalizeProductSelectionRule(rule || createDefaultProductSelectionRule(), Math.max(index, 0));
    const editor = document.createElement('div');
    editor.setAttribute('data-role', 'selection-rule-editor');
    editor.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:3',
      'background:rgba(15,23,42,0.30)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:18px',
      'box-sizing:border-box',
    ].join(';');
    editor.innerHTML = [
      '<div style="width:min(820px,calc(100vw - 64px));max-height:min(680px,calc(100vh - 64px));background:#fff;border:1px solid #cbd5e1;border-radius:4px;box-shadow:0 18px 44px rgba(15,23,42,0.28);display:flex;flex-direction:column;overflow:hidden;animation:ssErpRowIn .14s ease-out;">',
      '  <div style="height:48px;background:#f8fafc;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;padding:0 16px;">',
      `    <div style="font-size:15px;font-weight:800;color:#111827;">${index >= 0 ? '编辑选品规则' : '新增选品规则'}</div>`,
      '    <button type="button" data-role="cancel-selection-rule-editor" style="width:28px;height:28px;border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:3px;cursor:pointer;font-size:18px;line-height:26px;">×</button>',
      '  </div>',
      '  <div style="padding:14px 16px;overflow:auto;">',
      selectionRuleEditorRow(item, index),
      '  </div>',
      '  <div style="height:54px;border-top:1px solid #e5e7eb;background:#f8fafc;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 16px;">',
      '    <div data-role="selection-rule-editor-status" style="margin-right:auto;font-size:12px;color:#64748b;"></div>',
      '    <button type="button" data-role="cancel-selection-rule-editor" style="height:32px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:3px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer;">取消</button>',
      `    <button type="button" data-role="save-selection-rule-editor" style="height:32px;border:0;background:${SS_ERP_LIST_THEME.headerGradient};color:#fff;border-radius:3px;padding:0 16px;font-size:13px;font-weight:800;cursor:pointer;">保存</button>`,
      '  </div>',
      '</div>',
    ].join('');
    modal.appendChild(editor);
    editor.querySelectorAll('[data-role="cancel-selection-rule-editor"]').forEach((button) => {
      button.addEventListener('click', () => editor.remove());
    });
    editor.querySelector('[data-role="save-selection-rule-editor"]').addEventListener('click', () => {
      const rules = collectProductSelectionRuleRows(modal);
      const existing = index >= 0 ? rules[index] : null;
      const nextRule = collectProductSelectionRuleFromEditor(editor, index >= 0 ? index : rules.length, existing);
      if (!nextRule.name) {
        const status = editor.querySelector('[data-role="selection-rule-editor-status"]');
        if (status) status.textContent = '请填写规则名称';
        return;
      }
      if (index >= 0) rules[index] = nextRule;
      else rules.push(nextRule);
      modal.__ssErpSelectionRules = normalizeProductSelectionRuleList(rules);
      renderSelectionRulesTable(modal);
      editor.remove();
    });
  }

  function bindSelectionRulesModalEvents(modal) {
    modal.querySelector('[data-role="close-selection-rules"]').addEventListener('click', () => modal.remove());
    modal.querySelector('[data-role="cancel-selection-rules"]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (event) => {
      if (event.target === modal) modal.remove();
    });
    modal.querySelector('[data-role="add-selection-rule"]').addEventListener('click', () => {
      showSelectionRuleEditor(modal, createDefaultProductSelectionRule(), -1);
    });
    modal.addEventListener('click', (event) => {
      const editButton = event.target && event.target.closest ? event.target.closest('[data-role="edit-selection-rule"]') : null;
      if (editButton) {
        const index = Number(editButton.getAttribute('data-index'));
        const rules = collectProductSelectionRuleRows(modal);
        if (rules[index]) showSelectionRuleEditor(modal, rules[index], index);
        return;
      }
      const deleteButton = event.target && event.target.closest ? event.target.closest('[data-role="delete-selection-rule"]') : null;
      if (!deleteButton) return;
      const index = Number(deleteButton.getAttribute('data-index'));
      const rules = collectProductSelectionRuleRows(modal);
      const removed = rules.splice(index, 1)[0];
      if (removed) deleteProductSelectionRuleFromCloud(removed.id).catch(() => {});
      modal.__ssErpSelectionRules = normalizeProductSelectionRuleList(rules);
      renderSelectionRulesTable(modal);
    });
    modal.addEventListener('change', (event) => {
      const toggle = event.target && event.target.closest ? event.target.closest('[data-role="toggle-rule-enabled"]') : null;
      if (!toggle) return;
      const index = Number(toggle.getAttribute('data-index'));
      const rules = collectProductSelectionRuleRows(modal);
      if (!rules[index]) return;
      rules[index].enabled = Boolean(toggle.checked);
      modal.__ssErpSelectionRules = normalizeProductSelectionRuleList(rules);
    });
    modal.querySelector('[data-role="save-selection-rules"]').addEventListener('click', async () => {
      const saveButton = modal.querySelector('[data-role="save-selection-rules"]');
      const status = modal.querySelector('[data-role="selection-rules-status"]');
      if (saveButton) saveButton.disabled = true;
      if (status) status.textContent = '正在保存到 ERP...';
      try {
        const rules = await saveProductSelectionRulesToCloud(collectProductSelectionRuleRows(modal));
        writeProductSelectionRules(rules);
        rerenderAllListMetrics();
        modal.remove();
      } catch (error) {
        writeProductSelectionRules(collectProductSelectionRuleRows(modal));
        if (status) status.textContent = `云端保存失败，已写入本地缓存：${error && error.message ? error.message : String(error)}`;
      } finally {
        if (saveButton) saveButton.disabled = false;
      }
    });
  }

  async function showProductSelectionRulesModal() {
    const old = document.getElementById(LIST_SELECTION_RULES_MODAL_ID);
    if (old) old.remove();
    let rules = readProductSelectionRules();
    try {
      rules = await syncProductSelectionRulesFromCloud();
    } catch (error) {}
    const editableRules = normalizeProductSelectionRuleList(rules);
    const modal = document.createElement('div');
    modal.id = LIST_SELECTION_RULES_MODAL_ID;
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:rgba(15,23,42,0.34)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#111827',
    ].join(';');
    modal.innerHTML = [
      '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1240px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));background:#fff;border:1px solid #d1d5db;border-radius:4px;box-shadow:0 18px 48px rgba(15,23,42,0.26);display:flex;flex-direction:column;overflow:hidden;animation:ssErpModalIn .16s ease-out;">',
      `  <div style="height:52px;background:${SS_ERP_LIST_THEME.headerGradient};color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid ${SS_ERP_LIST_THEME.primaryDark};">`,
      '    <div style="font-size:15px;font-weight:800;line-height:1.2;">设置选品规则</div>',
      '    <button type="button" data-role="close-selection-rules" style="width:28px;height:28px;border:1px solid rgba(255,255,255,0.42);background:rgba(255,255,255,0.14);color:#fff;border-radius:3px;cursor:pointer;font-size:18px;line-height:26px;">×</button>',
      '  </div>',
      '  <div style="padding:10px 16px;border-bottom:1px solid #e5e7eb;background:#f9fafb;display:flex;align-items:center;justify-content:flex-end;gap:10px;">',
      '    <button type="button" data-role="add-selection-rule" style="height:30px;border:1px solid #cbd5e1;background:#fff;color:#1d4ed8;border-radius:3px;padding:0 12px;font-size:12px;font-weight:800;cursor:pointer;">新增规则</button>',
      '  </div>',
      '  <div style="padding:0 16px;overflow:auto;">',
      '    <table data-role="selection-rule-list-table" style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">',
      '      <thead style="position:sticky;top:0;z-index:2;background:#f8fafc;color:#475569;">',
      '        <tr>',
      '          <th style="width:26%;padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:left;">规则名称</th>',
      '          <th style="width:13%;padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">标签</th>',
      '          <th style="width:10%;padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">自动入池</th>',
      '          <th style="width:10%;padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">是否启用</th>',
      '          <th style="width:9%;padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">优先级</th>',
      '          <th style="width:15%;padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">更新时间</th>',
      '          <th style="width:17%;padding:9px 10px;border-bottom:1px solid #e5e7eb;text-align:center;">操作</th>',
      '        </tr>',
      '      </thead>',
      '      <tbody data-role="selection-rules-list"></tbody>',
      '    </table>',
      '  </div>',
      '  <div style="height:56px;border-top:1px solid #e5e7eb;background:#f3f4f6;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 16px;">',
      '    <div data-role="selection-rules-status" style="margin-right:auto;font-size:12px;color:#64748b;"></div>',
      '    <button type="button" data-role="cancel-selection-rules" style="height:32px;border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:3px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer;">取消</button>',
      `    <button type="button" data-role="save-selection-rules" style="height:32px;border:0;background:${SS_ERP_LIST_THEME.primary};color:#fff;border-radius:3px;padding:0 16px;font-size:13px;font-weight:800;cursor:pointer;">保存设置</button>`,
      '  </div>',
      '</div>',
    ].join('');
    document.body.appendChild(modal);
    modal.__ssErpSelectionRules = editableRules;
    renderSelectionRulesTable(modal);
    bindSelectionRulesModalEvents(modal);
  }

  function normalizeListWorkbenchRowFilter(value) {
    const raw = String(value || '').trim();
    if (raw === 'matched') return 'matched';
    if (raw.startsWith('rule:') && raw.slice(5).trim()) return raw;
    return 'all';
  }

  function syncListWorkbenchRuleFilterOptions(modal) {
    const select = modal && modal.querySelector ? modal.querySelector('[data-role="row-filter"]') : null;
    if (!select) {
      if (modal) modal.__ssErpRowFilter = 'all';
      return;
    }
    const rules = readProductSelectionRules().filter((rule) => rule && rule.enabled);
    const current = normalizeListWorkbenchRowFilter(modal.__ssErpRowFilter || select.value);
    const ruleOptions = rules.map((rule) => {
      const label = String(rule.tag || rule.name || rule.id || '').trim();
      return `<option value="rule:${escapeHtml(rule.id)}">${escapeHtml(label || rule.id)}</option>`;
    }).join('');
    select.innerHTML = [
      '<option value="all">全部商品</option>',
      '<option value="matched">仅规则命中</option>',
      ruleOptions,
    ].join('');
    const hasCurrent = Array.from(select.options).some((option) => option.value === current);
    select.value = hasCurrent ? current : 'all';
    modal.__ssErpRowFilter = select.value;
  }

  // === 注入卡片 + 绑定事件 ===
  async function attachOverlay(target) {
    if (!target || !target.isConnected) return;
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

    // 进入视口后自动加载 Premium 数据，不等用户展开
    const premium = await fetchPublicProduct(sku, {
      includeDetail: selectedListFieldsNeedDetail(),
      isCancelled: () => !card.isConnected || card.getAttribute(SKU_ATTR) !== sku,
      onSkipped: () => {
        if (!card.isConnected || card.getAttribute(SKU_ATTR) !== sku) return;
        card.removeAttribute(PROCESSED_ATTR);
        scheduleScanRoot(card);
      },
    });
    if (!wrap.isConnected || card.getAttribute(SKU_ATTR) !== sku) return;
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
    }, { rootMargin: LIST_PRELOAD_ROOT_MARGIN });
    return intersectionObserver;
  }

  function isSsErpOwnedNode(node) {
    const element = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!element || typeof element.matches !== 'function') return false;
    const ownSelector = `.${CARD_CLASS},[${PORTAL_ATTR}],[id^="ss-erp-"]`;
    return element.matches(ownSelector)
      || (typeof element.closest === 'function' && Boolean(element.closest(ownSelector)));
  }

  function collectCardCandidates(root) {
    const candidates = new Set();
    if (!root || typeof root.querySelectorAll !== 'function') return candidates;
    if (typeof root.matches === 'function' && root.matches(CARD_SELECTOR)) candidates.add(root);
    if (typeof root.closest === 'function') {
      const ancestor = root.closest(CARD_SELECTOR);
      if (ancestor) candidates.add(ancestor);
    }
    root.querySelectorAll(CARD_SELECTOR).forEach((candidate) => candidates.add(candidate));
    return candidates;
  }

  function scanRoot(root, options = {}) {
    if (!isProductPage() || !root || isSsErpOwnedNode(root)
      || (root !== document.body && root.isConnected === false)) return;
    const pageChanged = ensureListSkuPageContext();
    if (pageChanged && root !== document.body) {
      scanRoot(document.body, { refreshUi: true });
      return;
    }
    rememberVisibleListSkus(root);
    const io = ensureIntersectionObserver();
    const targets = new Set();
    collectCardCandidates(root).forEach((candidate) => {
      collectProductCardTargets(candidate).forEach((target) => addProductCardTarget(targets, target));
    });
    targets.forEach((target) => {
      if (!target.isConnected) return;
      const sku = extractSku(target);
      if (!sku) return;
      const previousSku = observedCardSku.get(target);
      observedCardSku.set(target, sku);
      if (target.getAttribute(PROCESSED_ATTR) && target.getAttribute(SKU_ATTR) === sku && target.querySelector(`.${CARD_CLASS}`)) return;
      if (io) {
        if (previousSku && previousSku !== sku) io.unobserve(target);
        io.observe(target);
      } else {
        attachOverlay(target);
      }
    });
    if (options.refreshUi) {
      cleanupDetachedExpandedPanels();
      ensureListWorkbenchBar();
      ensureListQuickActions();
    }
  }

  const pendingScanRoots = new Set();
  let scanScheduled = false;
  function scheduleScanRoot(root) {
    const element = root && root.nodeType === 1 ? root : document.body;
    if (isSsErpOwnedNode(element) || (element !== document.body && element.isConnected === false)) return;
    for (const existing of Array.from(pendingScanRoots)) {
      if (existing === element || (typeof existing.contains === 'function' && existing.contains(element))) return;
      if (typeof element.contains === 'function' && element.contains(existing)) pendingScanRoots.delete(existing);
    }
    pendingScanRoots.add(element);
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      const roots = Array.from(pendingScanRoots).filter((scanTarget) => (
        scanTarget === document.body || scanTarget.isConnected !== false
      ));
      pendingScanRoots.clear();
      roots.forEach((scanTarget) => scanRoot(scanTarget, { refreshUi: true }));
    }, CARD_SCAN_DEBOUNCE_MS);
  }

  function scheduleScan() {
    scheduleScanRoot(document.body);
  }

  function handleListMutations(records) {
    records.forEach((record) => {
      if (record.type === 'attributes') {
        scheduleScanRoot(record.target);
        return;
      }
      record.addedNodes.forEach((node) => {
        if (node && node.nodeType === 1) scheduleScanRoot(node);
      });
    });
  }

  function init() {
    if (!isProductPage()) return;
    ensureListOverlayStyles();
    hydrateProductSelectionRulesFromStorage();
    autoSyncCurrentOzonCookieForListData();
    scanRoot(document.body, { refreshUi: true });
    const observer = new MutationObserver(handleListMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    });
    startPeriodicSafetyScan();
  }

  function startPeriodicSafetyScan() {
    function tick() {
      if (!isProductPage()) return;
      if (document.visibilityState === 'visible') scheduleScanRoot(document.body);
      setTimeout(tick, CARD_SCAN_SAFETY_MS);
    }
    setTimeout(tick, CARD_SCAN_SAFETY_MS);
  }

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || message.type !== 'ss-erp:ozon-company-context-changed') return;
      listDataCookieCompanyId = '';
      invalidatePremiumContext();
      autoSyncCurrentOzonCookieForListData();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
