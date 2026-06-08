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
    return data.sourceProductId
      || data.productId
      || data.offerId
      || data.sourceOfferId
      || data.itemId
      || data.item_id
      || data.num_iid
      || data.numIid
      || data.wareId
      || data.ware_id
      || data.goodsId
      || data.goods_id;
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
