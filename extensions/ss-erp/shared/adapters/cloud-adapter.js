// 云端模式适配器
// 使用 API token、云端队列、OSS 预签名上传
// 不同步 cookie，不依赖本地浏览器登录态

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
      skuItems: Array.isArray(payload.skuItems) ? payload.skuItems : undefined,
      purchasePriceCny: purchasePrice,
      domesticShippingCny: toNumber(payload.domesticShippingCny, 0),
      weightG: weightG,
      packageFeeCny: toNumber(payload.packageFeeCny, 0),
      commissionPct: toNumber(payload.commissionPct, 12),
      logisticsFeeCny: toNumber(payload.logisticsFeeCny, 0),
      exchangeRateRubToCny: toNumber(payload.exchangeRateRubToCny, 0.08),
      targetMarginPct: toNumber(payload.targetMarginPct, 30),
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined,
    };
  }

  function normalizeCollectPayload(payload) {
    return is1688CollectPayload(payload) ? normalize1688ImportPayload(payload || {}) : payload;
  }

  function resolveCollectPath(payload) {
    return is1688CollectPayload(payload) ? '/api/supply/1688/import' : '/api/collect';
  }

  const adapter = {
    name: 'cloud',

    // 云端模式：Bearer token 认证
    async request(path, options) {
      const config = await self.SS_ERP_CONFIG.getConfig();
      const url = config.baseUrl.replace(/\/$/, '') + path;
      const headers = {
        'Content-Type': 'application/json',
        ...(options && options.headers),
      };
      if (config.token) {
        headers['Authorization'] = 'Bearer ' + config.token;
      }
      const res = await fetch(url, {
        ...options,
        headers,
      });
      return res.json();
    },

    // 云端模式：不同步 cookie（服务端会拒绝）
    async syncCookie() {
      return { code: 0, msg: '云端模式不支持 cookie 同步' };
    },

    // 云端模式：采集推送到云端队列
    async submitCollect(payload) {
      return this.request(resolveCollectPath(payload), {
        method: 'POST',
        body: JSON.stringify(normalizeCollectPayload(payload)),
      });
    },

    // 云端模式：图片走 OSS 预签名上传
    async uploadImage(file) {
      const presignRes = await this.request('/api/images/presign', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'image/jpeg',
          sizeBytes: file.size,
        }),
      });

      if (presignRes.code !== 1 || !presignRes.data) {
        return { code: 0, msg: presignRes.msg || '获取上传凭证失败' };
      }

      const { uploadUrl, finalUrl, headers } = presignRes.data;
      try {
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': file.type || 'image/jpeg' },
          body: file,
        });
        if (!uploadRes.ok) {
          return { code: 0, msg: 'OSS 上传失败 (HTTP ' + uploadRes.status + ')' };
        }
      } catch (e) {
        return { code: 0, msg: '网络错误: ' + (e.message || 'unknown') };
      }

      return { code: 1, data: { url: finalUrl } };
    },
  };

  if (typeof self !== 'undefined') self.SS_ERP_CLOUD_ADAPTER = adapter;
  if (typeof window !== 'undefined') window.SS_ERP_CLOUD_ADAPTER = adapter;
}());
