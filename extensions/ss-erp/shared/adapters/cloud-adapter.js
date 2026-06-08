// 云端模式适配器
// 使用 API token、云端队列、OSS 预签名上传
// 不同步 cookie，不依赖本地浏览器登录态

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

  function domesticSupplySourceProductId(data) {
    if (!data || typeof data !== 'object') return '';
    return data.sourceProductId || data.productId || data.offerId || data.sourceOfferId || data.itemId || data.goodsId;
  }

  function normalizeCollectPayload(payload) {
    if (!isDomesticSupplyPayload(payload)) {
      return { path: '/api/collect', body: payload || {} };
    }
    var data = payload && typeof payload === 'object' ? payload : {};
    var sourceProductId = domesticSupplySourceProductId(data);
    return {
      path: '/api/collect/1688',
      body: {
        title: data.title,
        sourcePlatform: inferDomesticSupplyPlatform(data) || '1688',
        sourceUrl: data.sourceUrl || data.tabUrl,
        sourceProductId: sourceProductId,
        offerId: sourceProductId,
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
          priceCheckContext: data.priceCheckContext || data.ozonPriceCheckContext || null,
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
