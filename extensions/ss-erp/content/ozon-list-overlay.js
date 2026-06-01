// SS ERP Ozon 列表页增强 - 企鹅店长式商品信息卡片
// 数据来源（多层降级）：
//   1. DOM 提取（标题/价格/评分/评论/图片/SKU）
//   2. OZON 公开 entrypoint API（销量/卖家/库存等，无需登录）
//   3. seller-analytics API（Premium 数据，需登录 + Premium）
//   4. SS ERP 缓存（其他用户已提交的数据）
//   5. 实在拿不到的字段显示 "--"，不阻塞卡片渲染
// 设计原则：
//   - 不主动请求 ERP 检测采集状态，避免给服务器加负担。点击采集失败再显示原因。
//   - 进入视口自动加载 Premium 数据，不等用户展开。

(function () {
  if (window.__SS_ERP_LIST_OVERLAY__) return;
  window.__SS_ERP_LIST_OVERLAY__ = true;

  const PROCESSED_ATTR = 'data-ss-erp-overlay';
  const CARD_CLASS = 'ss-erp-overlay-card';
  const CARD_SELECTORS = [
    '[data-widget="searchResultsV2"] [data-index]',
    '[data-widget="skuShelfGoods"] [data-index]',
    '[data-widget="skuGrid"] [data-index]',
    '[data-widget="tileGridDesktop"] [data-index]',
    '[data-widget="tileGrid"] [data-index]',
  ];

  const PREMIUM_TTL_MS = 10 * 60 * 1000;

  // === 工具：缓存 ===
  const premiumCache = new Map();  // sku -> { data, ts }
  const failedPremiumCache = new Map(); // sku -> ts （失败 30 分钟内不再请求）

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

  // === 工具：DOM 解析 ===
  function isProductPage() {
    const href = location.href;
    if (href.includes('/product/')) return false;
    if (href.includes('seller.ozon.')) return false;
    return /ozon\.(ru|kz|by)/.test(href);
  }

  function extractSku(card) {
    const link = card.querySelector('a[href*="/product/"]');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const m = href.match(/\/product\/[^/]*-(\d+)/) || href.match(/\/product\/(\d+)/);
    return m ? m[1] : null;
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

  // === 公开 API：拉商品基础信息（含销量/卖家等可选字段）===
  // 通过 background 聚合 seller-analytics、公开 entrypoint 和 ERP 缓存；失败时保持基础卡片。
  async function fetchPublicProduct(sku) {
    const cached = getCached(premiumCache, sku, PREMIUM_TTL_MS);
    if (cached) return cached;

    const failTs = failedPremiumCache.get(sku);
    if (failTs && Date.now() - failTs < 30 * 60 * 1000) return null;

    const resp = await send(
      { type: 'spb-self-hosted:aggregate-product-insights', productId: sku },
      20000,
    );
    if (!resp || !resp.ok || !resp.item) {
      failedPremiumCache.set(sku, Date.now());
      return null;
    }

    const data = Object.assign({}, resp.item, { _sources: resp.sources || [] });
    setCached(premiumCache, sku, data);
    return data;
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
      'overflow:hidden',
    ].join(';');

    wrap.innerHTML = [
      '<div class="ss-erp-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
      '  <span style="font-weight:700;color:#c2410c;font-size:13px">SS ERP</span>',
      '  <span class="ss-erp-status-pill" style="font-size:10px;padding:2px 8px;border-radius:10px;background:#ffedd5;color:#9a3412;border:1px solid #fdba74">加载中…</span>',
      '</div>',
      '<div class="ss-erp-metrics" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px"></div>',
      '<div class="ss-erp-actions" style="display:flex;gap:6px">',
      '  <button class="ss-erp-collect-btn" type="button" style="flex:1;padding:5px 8px;border:1px solid #f97316;border-radius:6px;background:#f97316;color:#fff;cursor:pointer;font-size:11px;font-weight:600">采集到 ERP</button>',
      '  <button class="ss-erp-expand-btn" type="button" style="padding:5px 10px;border:1px solid #fdba74;border-radius:6px;background:#fff7ed;color:#c2410c;cursor:pointer;font-size:11px">展开</button>',
      '</div>',
      '<div class="ss-erp-expanded" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #fdba74"></div>',
    ].join('');

    renderMetrics(wrap, sku, dom, null);
    return wrap;
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

    const expanded = wrap.querySelector('.ss-erp-expanded');
    if (expanded.style.display !== 'none' || expanded.getAttribute('data-rendered') === '1') {
      expanded.innerHTML = renderExpandedFields(sku, dom, premium);
      expanded.setAttribute('data-rendered', '1');
    }
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

  // === 注入卡片 + 绑定事件 ===
  async function attachOverlay(card) {
    if (card.getAttribute(PROCESSED_ATTR)) return;
    const sku = extractSku(card);
    if (!sku) return;
    card.setAttribute(PROCESSED_ATTR, '1');

    const dom = extractCardData(card);
    const wrap = buildCard(sku, dom);
    insertOverlay(card, wrap);

    wrap.addEventListener('click', (e) => e.stopPropagation());

    const collectBtn = wrap.querySelector('.ss-erp-collect-btn');
    const expandBtn = wrap.querySelector('.ss-erp-expand-btn');
    const expanded = wrap.querySelector('.ss-erp-expanded');

    expandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = expanded.style.display !== 'none';
      expanded.style.display = isOpen ? 'none' : 'block';
      expandBtn.textContent = isOpen ? '展开' : '收起';
      // 展开时若数据已加载则立即渲染
      if (!isOpen) {
        const cached = premiumCache.get(sku);
        const premium = cached ? cached.data : null;
        expanded.innerHTML = renderExpandedFields(sku, dom, premium);
        expanded.setAttribute('data-rendered', '1');
      }
    });

    collectBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      collectBtn.disabled = true;
      const oldText = collectBtn.textContent;
      collectBtn.textContent = '采集中…';
      collectBtn.style.opacity = '0.7';

      const resp = await send({ type: 'ss-erp:collect-product', sku, url: dom.url }, 60000);

      if (resp && resp.ok) {
        collectBtn.textContent = '✓ 已采集';
        collectBtn.style.background = '#10b981';
        collectBtn.style.borderColor = '#10b981';
      } else {
        collectBtn.disabled = false;
        collectBtn.textContent = '✗ ' + (resp && resp.msg ? truncate(resp.msg, 12) : '失败');
        collectBtn.style.background = '#ef4444';
        collectBtn.style.borderColor = '#ef4444';
        setTimeout(() => {
          collectBtn.textContent = oldText;
          collectBtn.style.background = '#f97316';
          collectBtn.style.borderColor = '#f97316';
          collectBtn.style.opacity = '1';
        }, 4000);
      }
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
    const io = ensureIntersectionObserver();
    CARD_SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((card) => {
        if (card.getAttribute(PROCESSED_ATTR)) return;
        if (io) io.observe(card);
        else attachOverlay(card);
      });
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
