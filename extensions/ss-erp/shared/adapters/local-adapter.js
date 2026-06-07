// 本地模式适配器
// 保留原有行为：本地 cookie、本地 OZON CDN、直连本地 API

(function () {
  const DOMESTIC_SUPPLY_PLATFORMS = ['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd'];

  function inferDomesticSupplyPlatform(payload) {
    var data = payload && typeof payload === 'object' ? payload : {};
    var platform = String(data.sourcePlatform || data.platform || '').trim().toLowerCase();
    if (DOMESTIC_SUPPLY_PLATFORMS.indexOf(platform) >= 0) return platform;
    var url = String(data.sourceUrl || data.tabUrl || data.sourceHost || '').toLowerCase();
    if (/(^|\.)1688\.com/i.test(url)) return '1688';
    if (/(^|\.)taobao\.com/i.test(url)) return 'taobao';
    if (/(^|\.)tmall\.com/i.test(url)) return 'tmall';
    if (/(^|\.)jd\.com/i.test(url)) return 'jd';
    if (/(^|\.)(pinduoduo|yangkeduo)\.com/i.test(url)) return 'pinduoduo';
    return '';
  }

  function isDomesticSupplyPayload(payload) {
    return !!inferDomesticSupplyPlatform(payload);
  }

  function normalizeAttributeRecord(attributes) {
    if (!Array.isArray(attributes)) {
      return attributes && typeof attributes === 'object' ? attributes : undefined;
    }
    return attributes.reduce(function (record, item) {
      if (!item || typeof item !== 'object') return record;
      var key = String(item.name || item.key || item.attrName || '').trim();
      var value = String(item.value || item.attrValue || item.text || '').trim();
      if (key && value) record[key] = value;
      return record;
    }, {});
  }

  function normalizeCollectPayload(payload) {
    if (!isDomesticSupplyPayload(payload)) {
      return { path: '/api/collect', body: payload || {} };
    }
    var data = payload && typeof payload === 'object' ? payload : {};
    return {
      path: '/api/collect/1688',
      body: {
        title: data.title,
        sourcePlatform: inferDomesticSupplyPlatform(data) || '1688',
        sourceUrl: data.sourceUrl || data.tabUrl,
        offerId: data.offerId || data.productId || data.sourceProductId || data.sku,
        sku: data.sku || data.productId,
        images: Array.isArray(data.images) ? data.images : undefined,
        price: data.price,
        priceText: data.priceText || data.price,
        currency: data.currency || 'CNY',
        categoryPath: data.categoryPath || data.categoryName,
        shopName: data.shopName,
        supplierName: data.supplierName || data.shopName,
        supplierLocation: data.supplierLocation,
        supplierYears: data.supplierYears,
        monthlySales: data.monthlySales,
        grossWeightGrams: data.grossWeightGrams,
        lengthMm: data.lengthMm,
        widthMm: data.widthMm,
        heightMm: data.heightMm,
        dimensionsText: data.dimensionsText,
        minOrderQty: data.minOrderQty,
        shippingInfo: data.shippingInfo,
        logisticsText: data.logisticsText,
        customizationInfo: data.customizationInfo,
        attributes: normalizeAttributeRecord(data.attributes),
        skuItems: Array.isArray(data.skuItems) ? data.skuItems : data.variants,
        description: data.description,
        notes: data.notes,
        raw: {
          extractor: data.extractor || null,
          warnings: data.warnings || [],
          debug: data.debug || null,
          priceCheckContext: data.priceCheckContext || null,
          collectedAt: data.collectedAt || null,
        },
      },
    };
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
      const normalized = normalizeCollectPayload(payload);
      return this.request(normalized.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized.body),
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
