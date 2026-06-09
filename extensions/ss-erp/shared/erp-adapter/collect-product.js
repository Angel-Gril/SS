(function () {
  function getErpConfig(callback) {
    chrome.storage.local.get('ss_erp_connection', function (data) {
      callback(data.ss_erp_connection || {});
    });
  }

  function toNumber(value, fallback) {
    if (value == null || value === '') return fallback;
    var text = String(value).replace(/,/g, '.');
    var match = text.match(/-?\d+(?:\.\d+)?/);
    var n = Number(match ? match[0] : value);
    return Number.isFinite(n) ? n : fallback;
  }

  function firstSkuPrice(payload) {
    var items = Array.isArray(payload && payload.skuItems) ? payload.skuItems : [];
    for (var i = 0; i < items.length; i += 1) {
      var price = toNumber(items[i] && items[i].price, NaN);
      if (Number.isFinite(price) && price > 0) return price;
    }
    return 0;
  }

  function extract1688ProductId(sourceUrl) {
    var match = String(sourceUrl || '').match(/\/offer\/(\d+)\.html/i) || String(sourceUrl || '').match(/[?&](?:offerId|id)=(\d+)/i);
    return match && match[1] ? match[1] : '';
  }

  function is1688CollectPayload(payload) {
    var platform = String((payload && (payload.sourcePlatform || payload.platform)) || '').toLowerCase();
    var sourceUrl = String((payload && (payload.sourceUrl || payload.tabUrl)) || '').toLowerCase();
    var host = String((payload && payload.sourceHost) || '').toLowerCase();
    return platform === '1688' || platform.indexOf('1688') >= 0 || sourceUrl.indexOf('1688.com') >= 0 || host.indexOf('1688.com') >= 0;
  }

  function normalize1688ImportPayload(payload) {
    var sourceUrl = payload.sourceUrl || payload.tabUrl || '';
    var sourceProductId = payload.sourceProductId || payload.productId || payload.offerId || extract1688ProductId(sourceUrl);
    var purchasePrice = toNumber(payload.purchasePriceCny || payload.purchasePrice || payload.price || payload.priceText, 0);
    if (!(purchasePrice > 0)) purchasePrice = firstSkuPrice(payload);
    var weightG = toNumber(payload.weightG || payload.grossWeightGrams || payload.weight, 0);

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

  function collectProduct(payload) {
    return new Promise(function (resolve, reject) {
      getErpConfig(function (conn) {
        if (!conn.baseUrl || !conn.token) {
          reject(new Error('请先在扩展设置中配置 ERP 地址和 Token'));
          return;
        }

        var path = is1688CollectPayload(payload) ? '/api/supply/1688/import' : '/api/collect';
        var url = conn.baseUrl + path;
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + conn.token,
          },
          body: JSON.stringify(normalizeCollectPayload(payload)),
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
