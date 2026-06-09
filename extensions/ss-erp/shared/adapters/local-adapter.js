// 本地模式适配器
// 保留原有行为：本地 cookie、本地 OZON CDN、直连本地 API

(function () {
  function toNumber(value, fallback) {
    if (value == null || value === '') return fallback;
    const text = String(value).replace(/,/g, '.');
    const match = text.match(/-?\d+(?:\.\d+)?/);
    const n = Number(match ? match[0] : value);
    return Number.isFinite(n) ? n : fallback;
  }

  function firstSkuPrice(payload) {
    const items = Array.isArray(payload && payload.skuItems) ? payload.skuItems : [];
    for (let i = 0; i < items.length; i += 1) {
      const price = toNumber(items[i] && items[i].price, NaN);
      if (Number.isFinite(price) && price > 0) return price;
    }
    return 0;
  }

  function extract1688ProductId(sourceUrl) {
    const match = String(sourceUrl || '').match(/\/offer\/(\d+)\.html/i)
      || String(sourceUrl || '').match(/[?&](?:offerId|id)=(\d+)/i);
    return match && match[1] ? match[1] : '';
  }

  function is1688CollectPayload(payload) {
    const platform = String((payload && (payload.sourcePlatform || payload.platform)) || '').toLowerCase();
    const sourceUrl = String((payload && (payload.sourceUrl || payload.tabUrl)) || '').toLowerCase();
    const host = String((payload && payload.sourceHost) || '').toLowerCase();
    return platform === '1688' || platform.indexOf('1688') >= 0 || sourceUrl.indexOf('1688.com') >= 0 || host.indexOf('1688.com') >= 0;
  }

  function normalize1688ImportPayload(payload) {
    const sourceUrl = payload.sourceUrl || payload.tabUrl || '';
    const sourceProductId = payload.sourceProductId || payload.productId || payload.offerId || extract1688ProductId(sourceUrl);
    let purchasePrice = toNumber(payload.purchasePriceCny || payload.purchasePrice || payload.price || payload.priceText, 0);
    if (!(purchasePrice > 0)) purchasePrice = firstSkuPrice(payload);
    const weightG = toNumber(payload.weightG || payload.grossWeightGrams || payload.weight, 0);

    return {
      sourceUrl: sourceUrl || undefined,
      title: payload.title || payload.name || payload.tabTitle || '未命名1688商品',
      sourceProductId: sourceProductId || undefined,
      sourceCategoryId: payload.sourceCategoryId || payload.categoryId || undefined,
      sourceCategoryName: payload.sourceCategoryName || payload.categoryName || payload.category || undefined,
      sourceCategoryPath: payload.sourceCategoryPath || payload.categoryPath || undefined,
      supplier: payload.supplier || payload.shopName || payload.sellerName || undefined,
      sku: payload.sku || sourceProductId || undefined,
      images: Array.isArray(payload.images) ? payload.images : undefined,
      notes: payload.notes || payload.description || undefined,
      purchasePriceCny: purchasePrice,
      domesticShippingCny: toNumber(payload.domesticShippingCny, 0),
      weightG: weightG,
      packageFeeCny: toNumber(payload.packageFeeCny, 0),
      commissionPct: toNumber(payload.commissionPct, 12),
      logisticsFeeCny: toNumber(payload.logisticsFeeCny, 0),
      exchangeRateRubToCny: toNumber(payload.exchangeRateRubToCny, 0.08),
      targetMarginPct: toNumber(payload.targetMarginPct, 30),
    };
  }

  function normalizeCollectPayload(payload) {
    return is1688CollectPayload(payload) ? normalize1688ImportPayload(payload || {}) : payload;
  }

  function resolveCollectPath(payload) {
    return is1688CollectPayload(payload) ? '/api/supply/1688/import' : '/api/collect';
  }

  async function fileToDataUrl(file) {
    const mimeType = file.type || 'image/jpeg';
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return 'data:' + mimeType + ';base64,' + btoa(binary);
  }

  const adapter = {
    name: 'local',

    // 本地模式：保留 cookie 行为，同时兼容现有 Bearer token 配置。
    async request(path, options) {
      const config = await self.SS_ERP_CONFIG.getConfig();
      const url = config.baseUrl.replace(/\/$/, '') + path;
      const headers = { ...((options && options.headers) || {}) };
      if (config.token) {
        headers.Authorization = 'Bearer ' + config.token;
      }
      const res = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });
      return res.json();
    },

    // 本地模式：cookie 同步到本地服务器
    async syncCookie(shopId, cookie, companyId) {
      return this.request('/api/extension/sync-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, cookie, companyId }),
      });
    },

    // 本地模式：采集直接推到本地 API
    async submitCollect(payload) {
      return this.request(resolveCollectPath(payload), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizeCollectPayload(payload)),
      });
    },

    // 本地模式：图片走本地上传或 OZON CDN
    async uploadImage(file) {
      const dataUrl = await fileToDataUrl(file);
      return this.request('/api/images/upload-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl,
          filename: file.name || 'upload.jpg',
        }),
      });
    },
  };

  if (typeof self !== 'undefined') self.SS_ERP_LOCAL_ADAPTER = adapter;
  if (typeof window !== 'undefined') window.SS_ERP_LOCAL_ADAPTER = adapter;
}());
