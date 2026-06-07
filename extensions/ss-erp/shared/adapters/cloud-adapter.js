// 云端模式适配器
// 使用 API token、云端队列、OSS 预签名上传
// 不同步 cookie，不依赖本地浏览器登录态

(function () {
  function isAlibaba1688Payload(payload) {
    var data = payload && typeof payload === 'object' ? payload : {};
    var platform = String(data.sourcePlatform || data.platform || '').toLowerCase();
    var url = String(data.sourceUrl || data.tabUrl || data.sourceHost || '');
    return platform === '1688' || /(^|\.)1688\.com/i.test(url);
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
    if (!isAlibaba1688Payload(payload)) {
      return { path: '/api/collect', body: payload || {} };
    }
    var data = payload && typeof payload === 'object' ? payload : {};
    return {
      path: '/api/collect/1688',
      body: {
        title: data.title,
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
      const normalized = normalizeCollectPayload(payload);
      return this.request(normalized.path, {
        method: 'POST',
        body: JSON.stringify(normalized.body),
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
