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

  function getErpConfig(callback) {
    chrome.storage.local.get('ss_erp_connection', function (data) {
      callback(data.ss_erp_connection || {});
    });
  }

  function collectProduct(payload) {
    return new Promise(function (resolve, reject) {
      getErpConfig(function (conn) {
        if (!conn.baseUrl || !conn.token) {
          reject(new Error('请先在扩展设置中配置 ERP 地址和 Token'));
          return;
        }

        var normalized = normalizeCollectPayload(payload);
        var url = conn.baseUrl.replace(/\/+$/, '') + normalized.path;
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + conn.token,
          },
          body: JSON.stringify(normalized.body),
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.code === 1) {
            resolve({ ok: true, type: 'collectProduct', data: data });
          } else {
            reject(new Error(data.msg || '推送失败'));
          }
        })
        .catch(function (err) {
          reject(err);
        });
      });
    });
  }

  window.OZON_CALC_ERP_COLLECT_PRODUCT = {
    collectProduct: collectProduct,
  };
}());
