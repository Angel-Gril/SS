// SS ERP Ozon 列表页增强 - 企鹅店长式商品信息卡片
// 数据来源（多层降级）：
//   1. DOM 提取（标题/价格/评分/评论/图片/SKU）
//   2. OZON 公开 entrypoint API（销量/卖家/库存等，无需登录）
//   3. seller-analytics API（Premium 数据，需登录 + Premium）
//   4. SS ERP 缓存（其他用户已提交的数据）
//   5. 实在拿不到的字段显示 "--"，不阻塞卡片渲染

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

  const BATCH_DEBOUNCE_MS = 400;
  const BATCH_MAX_SIZE = 50;
  const SNAPSHOT_TTL_MS = 5 * 60 * 1000;
  const PREMIUM_TTL_MS = 10 * 60 * 1000;

  // === 工具：缓存 ===
  const snapshotCache = new Map(); // sku -> { data, ts }
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

    // 标题：链接的 title 属性 或 链接内文本
    let title = '';
    if (link) {
      title = link.getAttribute('title') || '';
      if (!title) {
        const span = link.querySelector('span');
        title = span ? (span.textContent || '').trim() : (link.textContent || '').trim();
      }
    }

    // 主图
    const img = card.querySelector('img');
    const image = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';

    // 价格：从 card 内提取所有数字+卢布的文本
    const priceTexts = [];
    card.querySelectorAll('span').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/\d.*₽/.test(t) && t.length < 30) {
        priceTexts.push(t);
      }
    });
    // 当前价：第一个；原价：第二个（带删除线一般渲染顺序在后）
    const priceText = priceTexts[0] || '';
    const oldPriceText = priceTexts[1] || '';
    const price = parsePrice(priceText);
    const oldPrice = parsePrice(oldPriceText);
    const discount = (price && oldPrice && oldPrice > price)
      ? Math.round((1 - price / oldPrice) * 100)
      : null;

    // 评分（aria-label 或 visible 数字 4.x）
    let rating = null;
    let reviews = null;
    const ratingEl = card.querySelector('[aria-label*="rating" i], [aria-label*="оценка" i], [aria-label*="rating"]');
    if (ratingEl) {
      const lbl = ratingEl.getAttribute('aria-label') || '';
      const r = lbl.match(/(\d+[.,]\d+)/);
      if (r) rating = parseFloat(r[1].replace(',', '.'));
    }
    // 兜底：扫描 svg 旁的小数字
    if (rating == null) {
      card.querySelectorAll('span').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (rating == null && /^[0-4]\.\d$|^5\.0$/.test(t)) rating = parseFloat(t);
      });
    }
    // 评论数：括号内的整数 或 后跟"отзыв/review"
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
    const cleaned = String(text).replace(/[^\d]/g, '');
    if (!cleaned) return null;
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : null;
  }

  // === 工具：消息发送（带超时和异常保护） ===
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

  // === 批量查询 ERP 状态 ===
  const pendingSkus = new Map(); // sku -> [resolver]
  let flushTimer = null;

  function querySnapshot(sku) {
    const cached = getCached(snapshotCache, sku, SNAPSHOT_TTL_MS);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve) => {
      if (!pendingSkus.has(sku)) pendingSkus.set(sku, []);
      pendingSkus.get(sku).push(resolve);
      scheduleFlush();
    });
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushSnapshotQueue, BATCH_DEBOUNCE_MS);
  }

  async function flushSnapshotQueue() {
    flushTimer = null;
    if (!pendingSkus.size) return;

    const all = Array.from(pendingSkus.entries());
    pendingSkus.clear();

    // 分批，每批 BATCH_MAX_SIZE 个
    for (let i = 0; i < all.length; i += BATCH_MAX_SIZE) {
      const batch = all.slice(i, i + BATCH_MAX_SIZE);
      const skus = batch.map(([sku]) => sku);

      const resp = await send(
        { type: 'ss-erp:query-collect-batch-snapshot', skus },
        12000,
      );

      const dataMap = (resp && resp.ok && resp.data) ? resp.data : {};
      for (const [sku, resolvers] of batch) {
        const item = dataMap[sku] || {
          collected: false,
          _erpUnavailable: !resp.ok,
          _erpMsg: resp.ok ? null : (resp.msg || '未连接 ERP'),
        };
        setCached(snapshotCache, sku, item);
        resolvers.forEach((r) => r(item));
      }
    }
  }

  // === 公开 API：拉商品基础信息（含销量/卖家等可选字段）===
  // 通过 chrome.runtime 转发到 background 的聚合接口
  // 该接口会按降级顺序尝试 seller-analytics → 公开 entrypoint → ERP 缓存
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
    // 标准化为 overlay 渲染用的扁平结构
    const data = Object.assign({}, resp.item, { _sources: resp.sources || [] });
    setCached(premiumCache, sku, data);
    return data;
  }

  // === 渲染卡片 ===
  function buildCard(sku, dom) {
    const wrap = document.createElement('div');
    wrap.className = CARD_CLASS;
    wrap.setAttribute('data-ss-erp-sku', sku);
    wrap.style.cssText = [
      'margin-top:8px',
      'padding:10px 12px',
      'border-radius:10px',
      'background:linear-gradient(135deg,#f8faff,#eef2ff)',
      'border:1px solid #c7d2fe',
      'font-size:12px',
      'color:#1e293b',
      'box-shadow:0 2px 6px rgba(99,102,241,0.08)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');

    wrap.innerHTML = [
      '<div class="ss-erp-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
      '  <span style="font-weight:700;color:#4338ca;font-size:13px">SS ERP</span>',
      '  <span class="ss-erp-status-pill" style="font-size:10px;padding:2px 8px;border-radius:10px;background:#fff;color:#64748b;border:1px solid #e0e7ff">查询中…</span>',
      '</div>',
      '<div class="ss-erp-metrics" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px"></div>',
      '<div class="ss-erp-actions" style="display:flex;gap:6px">',
      '  <button class="ss-erp-collect-btn" type="button" style="flex:1;padding:5px 8px;border:1px solid #6366f1;border-radius:6px;background:#6366f1;color:#fff;cursor:pointer;font-size:11px;font-weight:600">采集到 ERP</button>',
      '  <button class="ss-erp-expand-btn" type="button" style="padding:5px 10px;border:1px solid #c7d2fe;border-radius:6px;background:#fff;color:#4338ca;cursor:pointer;font-size:11px">展开</button>',
      '</div>',
      '<div class="ss-erp-expanded" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed #c7d2fe"></div>',
    ].join('');

    // 注入基础字段
    renderMetrics(wrap, sku, dom, null, null);

    return wrap;
  }

  function renderMetrics(wrap, sku, dom, snapshot, premium) {
    const grid = wrap.querySelector('.ss-erp-metrics');
    const pill = wrap.querySelector('.ss-erp-status-pill');

    // 状态徽章
    if (snapshot && snapshot._erpUnavailable) {
      pill.textContent = '未连 ERP';
      pill.style.background = '#fef3c7';
      pill.style.color = '#92400e';
      pill.style.borderColor = '#fde68a';
    } else if (snapshot && snapshot.listed) {
      pill.textContent = '已上架';
      pill.style.background = '#d1fae5';
      pill.style.color = '#065f46';
      pill.style.borderColor = '#86efac';
    } else if (snapshot && snapshot.collected) {
      pill.textContent = '已采集';
      pill.style.background = '#dbeafe';
      pill.style.color = '#1e40af';
      pill.style.borderColor = '#93c5fd';
    } else if (snapshot) {
      pill.textContent = '未采集';
      pill.style.background = '#f1f5f9';
      pill.style.color = '#64748b';
      pill.style.borderColor = '#cbd5e1';
    }

    // 紧凑版字段（4 项）
    const price = (premium && premium.price) || dom.price || '--';
    const rating = dom.rating != null ? dom.rating : '--';
    const reviews = dom.reviews != null ? formatNum(dom.reviews) : '--';
    // Premium 字段：从 widgetStates 解析的 sales/stock，没有时显示锁
    const sales30d = pickSales(premium);
    const stock = pickStock(premium);

    grid.innerHTML = [
      metricCell('30天销量', sales30d == null ? '🔒' : formatNum(sales30d), sales30d == null),
      metricCell('当前价', price !== '--' ? '₽' + formatNum(price) : '--', false),
      metricCell('评分', rating !== '--' ? rating + ' ⭐' : '--', false),
      metricCell('评论', reviews, false),
    ].join('');

    // 展开版字段
    const expanded = wrap.querySelector('.ss-erp-expanded');
    expanded.innerHTML = renderExpandedFields(sku, dom, snapshot, premium);
  }

  function metricCell(label, value, locked) {
    return [
      '<div style="background:#fff;border:1px solid #e0e7ff;border-radius:6px;padding:5px 8px;display:flex;flex-direction:column;gap:1px">',
      `  <span style="color:#94a3b8;font-size:10px">${escapeHtml(label)}</span>`,
      `  <span style="color:${locked ? '#cbd5e1' : '#0f172a'};font-weight:600;font-size:13px;line-height:1.2">${escapeHtml(value)}</span>`,
      '</div>',
    ].join('');
  }

  function renderExpandedFields(sku, dom, snapshot, premium) {
    const fields = collectExpandedFields(sku, dom, snapshot, premium);
    return [
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px;color:#475569">',
      ...fields.map(([k, v, locked]) => [
        '<div style="display:flex;justify-content:space-between;border-bottom:1px dashed #e0e7ff;padding:3px 0">',
        `  <span style="color:#94a3b8">${escapeHtml(k)}</span>`,
        `  <span style="color:${locked ? '#cbd5e1' : '#1e293b'};font-weight:${locked ? '400' : '500'};text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(v)}</span>`,
        '</div>',
      ].join('')),
      '</div>',
      premium ? '' : '<div style="margin-top:6px;color:#94a3b8;font-size:10px;text-align:center">展开后会异步加载更多数据…</div>',
    ].join('');
  }

  function collectExpandedFields(sku, dom, snapshot, p) {
    const f = [];
    const sources = (p && p._sources) ? p._sources.join(',') : '';
    const hasPremium = sources.includes('seller-analytics');
    // === 基础字段（DOM/公开 API 来源，必有）===
    f.push(['SKU', sku, false]);
    f.push(['标题', truncate(dom.title || pickFlat(p, 'title') || '--', 20), false]);
    f.push(['当前价', dom.price ? '₽' + formatNum(dom.price) : '--', false]);
    f.push(['原价', dom.oldPrice ? '₽' + formatNum(dom.oldPrice) : '--', false]);
    f.push(['折扣', dom.discount != null ? `-${dom.discount}%` : '--', false]);
    f.push(['评分', dom.rating != null ? `${dom.rating} ⭐` : '--', false]);
    f.push(['评论数', dom.reviews != null ? formatNum(dom.reviews) : '--', false]);
    f.push(['品牌', pickFlat(p, 'brand') || '--', !pickFlat(p, 'brand')]);
    f.push(['类目', pickFlat(p, 'category') || pickFlat(p, 'category3') || '--', !(pickFlat(p, 'category') || pickFlat(p, 'category3'))]);
    f.push(['一级类目', pickFlat(p, 'category1') || '--', !pickFlat(p, 'category1')]);
    f.push(['图片数', p && Array.isArray(p.images) ? p.images.length : '--', !p]);
    f.push(['变体数', p && Array.isArray(p.variants) ? p.variants.length : '--', !p]);
    f.push(['货币', pickFlat(p, 'currency') || 'RUB', false]);
    // === Premium 字段（30+ 字段核心）===
    f.push(['30天销量', pickSales(p) == null ? (hasPremium ? '0' : '🔒 Premium') : formatNum(pickSales(p)), pickSales(p) == null]);
    f.push(['30天GMV', pickGmv(p) == null ? '🔒 Premium' : '₽' + formatNum(pickGmv(p)), pickGmv(p) == null]);
    f.push(['销量环比', pickSalesDynamics(p) == null ? '--' : pickSalesDynamics(p) + '%', pickSalesDynamics(p) == null]);
    f.push(['平均价', pickAvgPrice(p) == null ? '--' : '₽' + formatNum(pickAvgPrice(p)), pickAvgPrice(p) == null]);
    f.push(['最低卖家价', pickMinPrice(p) == null ? '--' : '₽' + formatNum(pickMinPrice(p)), pickMinPrice(p) == null]);
    f.push(['加购率', pickAddCart(p) == null ? '🔒 Premium' : pickAddCart(p) + '%', pickAddCart(p) == null]);
    f.push(['浏览量', pickViews(p) == null ? '🔒 Premium' : formatNum(pickViews(p)), pickViews(p) == null]);
    f.push(['库存', pickStock(p) == null ? '🔒 Premium' : formatNum(pickStock(p)), pickStock(p) == null]);
    f.push(['卖家', pickSeller(p) || '--', !pickSeller(p)]);
    f.push(['卖家ID', pickFlat(p, 'sellerId') || '--', !pickFlat(p, 'sellerId')]);
    f.push(['配送天数', pickDeliveryDays(p) == null ? '--' : pickDeliveryDays(p) + '天', pickDeliveryDays(p) == null]);
    f.push(['发货模式', pickFlat(p, 'salesSchema') || '--', !pickFlat(p, 'salesSchema')]);
    f.push(['上架时间', pickFlat(p, 'nullableCreateDate') ? formatTime(pickFlat(p, 'nullableCreateDate')) : '--', !pickFlat(p, 'nullableCreateDate')]);
    f.push(['重量', pickWeight(p) == null ? '--' : pickWeight(p) + 'g', pickWeight(p) == null]);
    f.push(['尺寸(mm)', pickDims(p) || '--', !pickDims(p)]);
    f.push(['模型ID', pickFlat(p, 'modelId') || '--', !pickFlat(p, 'modelId')]);
    f.push(['数据源', sources || '--', false]);
    // === ERP 字段 ===
    if (snapshot) {
      f.push(['ERP状态', snapshot.listed ? '已上架' : (snapshot.collected ? '已采集' : '未采集'), false]);
      f.push(['采集价', snapshot.price ? '¥' + snapshot.price : '--', !snapshot.price]);
      f.push(['采集时间', snapshot.lastCollectedAt ? formatTime(snapshot.lastCollectedAt) : '--', !snapshot.lastCollectedAt]);
      f.push(['图片数(ERP)', snapshot.imageCount != null ? snapshot.imageCount : '--', false]);
      f.push(['最近错误', snapshot.lastError ? truncate(String(snapshot.lastError), 18) : '无', false]);
    }
    return f;
  }

  // === 字段提取（聚合接口扁平格式 + 兼容旧的 item/_insightsItem 嵌套）===
  function pickFlat(p, key) {
    if (!p) return null;
    if (p[key] != null) return p[key];
    const i = p._insightsItem || p.item;
    if (i && i[key] != null) return i[key];
    return null;
  }
  function pickSales(p) {
    const v = pickFlat(p, 'soldCount');
    return v == null ? null : Number(v) || 0;
  }
  function pickGmv(p) {
    const v = pickFlat(p, 'soldSum');
    return v == null ? null : Math.round(Number(v));
  }
  function pickAddCart(p) {
    const v = pickFlat(p, 'convToCartPdp');
    return v == null ? null : (Number(v) * 100).toFixed(1);
  }
  function pickViews(p) {
    const v = pickFlat(p, 'views');
    return v == null ? null : Number(v);
  }
  function pickStock(p) {
    const v = pickFlat(p, 'stock');
    return v == null ? null : Number(v);
  }
  function pickSeller(p) {
    return pickFlat(p, 'sellerName');
  }
  function pickAvgPrice(p) {
    const v = pickFlat(p, 'avgPrice');
    return v == null ? null : Math.round(Number(v));
  }
  function pickMinPrice(p) {
    const v = pickFlat(p, 'minSellerPrice');
    return v == null ? null : Math.round(Number(v));
  }
  function pickDeliveryDays(p) {
    return pickFlat(p, 'avgDeliveryDays');
  }
  function pickSalesDynamics(p) {
    const v = pickFlat(p, 'salesDynamics');
    return v == null ? null : Number(v).toFixed(1);
  }
  function pickWeight(p) {
    return pickFlat(p, 'weightGrams');
  }
  function pickDims(p) {
    const l = pickFlat(p, 'lengthMm');
    const w = pickFlat(p, 'widthMm');
    const h = pickFlat(p, 'heightMm');
    if (l == null && w == null && h == null) return null;
    return `${l || '?'}×${w || '?'}×${h || '?'}`;
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
  function formatTime(iso) {
    try {
      const d = new Date(iso);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      return sameDay
        ? d.toTimeString().slice(0, 5)
        : `${d.getMonth() + 1}-${d.getDate()}`;
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

  // === 注入卡片 + 绑定事件 ===
  async function attachOverlay(card) {
    if (card.getAttribute(PROCESSED_ATTR)) return;
    const sku = extractSku(card);
    if (!sku) return;
    card.setAttribute(PROCESSED_ATTR, '1');

    const dom = extractCardData(card);
    const wrap = buildCard(sku, dom);
    card.appendChild(wrap);

    // 阻止事件冒泡到商品卡
    wrap.addEventListener('click', (e) => e.stopPropagation());

    const collectBtn = wrap.querySelector('.ss-erp-collect-btn');
    const expandBtn = wrap.querySelector('.ss-erp-expand-btn');
    const expanded = wrap.querySelector('.ss-erp-expanded');

    expandBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = expanded.style.display !== 'none';
      expanded.style.display = isOpen ? 'none' : 'block';
      expandBtn.textContent = isOpen ? '展开' : '收起';

      // 第一次展开时异步拉 Premium 数据
      if (!isOpen && !wrap.getAttribute('data-premium-loaded')) {
        wrap.setAttribute('data-premium-loaded', '1');
        const premium = await fetchPublicProduct(sku);
        const snapshot = await querySnapshot(sku);
        renderMetrics(wrap, sku, dom, snapshot, premium);
        // 保持展开状态
        expanded.style.display = 'block';
        expandBtn.textContent = '收起';
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
        // 失效缓存，下次刷新会重新查
        snapshotCache.delete(sku);
        // 立刻刷新 ERP 状态
        const fresh = await querySnapshot(sku);
        renderMetrics(wrap, sku, dom, fresh, premiumCache.get(sku) ? premiumCache.get(sku).data : null);
      } else {
        collectBtn.disabled = false;
        collectBtn.textContent = '✗ ' + (resp && resp.msg ? truncate(resp.msg, 12) : '失败');
        collectBtn.style.background = '#ef4444';
        collectBtn.style.borderColor = '#ef4444';
        setTimeout(() => {
          collectBtn.textContent = oldText;
          collectBtn.style.background = '#6366f1';
          collectBtn.style.borderColor = '#6366f1';
          collectBtn.style.opacity = '1';
        }, 4000);
      }
    });

    // 异步查 ERP 状态
    const snapshot = await querySnapshot(sku);
    renderMetrics(wrap, sku, dom, snapshot, null);

    // 如果 ERP 未连接，按钮变成"去配置"
    if (snapshot && snapshot._erpUnavailable) {
      collectBtn.textContent = '需配置 ERP';
      collectBtn.style.background = '#f59e0b';
      collectBtn.style.borderColor = '#f59e0b';
    }
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
        if (io) {
          io.observe(card);
        } else {
          attachOverlay(card);
        }
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
