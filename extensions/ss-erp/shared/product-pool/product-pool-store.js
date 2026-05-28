(function (root) {
  function toText(value) {
    return value == null ? '' : String(value);
  }

  function safeIsoDate(value) {
    var text = toText(value).trim();
    if (text) {
      var parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  }

  function normalizeUrl(value) {
    var text = toText(value).trim();
    if (!text) return '';
    var clean = text.split('#')[0].split('?')[0];
    clean = clean.replace(/\/+$/, '');
    if (/^https?:\/\/[^/]+\/product\//i.test(clean)) return clean + '/';
    return clean;
  }

  function normalizeCurrency(value) {
    var text = toText(value).trim().toUpperCase();
    return text || 'RUB';
  }

  function normalizeTags(tags) {
    var seen = {};
    return (Array.isArray(tags) ? tags : toText(tags).split(/[,\n，；;]/)).map(function (tag) {
      return toText(tag).trim();
    }).filter(function (tag) {
      if (!tag || seen[tag]) return false;
      seen[tag] = true;
      return true;
    });
  }

  function inferProductId(product, url) {
    var explicit = toText(product && product.productId).trim();
    if (explicit) return explicit;
    var match = toText(url).match(/\/product\/[^/]*-(\d+)\/?$/i) || toText(url).match(/-(\d+)\/?$/);
    return match ? match[1] : '';
  }

  function normalizePrice(product) {
    var rawPrice = Number(product && product.currentPriceValue) > 0
      ? Number(product.currentPriceValue)
      : Number(product && product.pagePriceValue) > 0
        ? Number(product.pagePriceValue)
        : Number(product && product.price && product.price.value) || 0;
    return {
      value: rawPrice,
      currency: normalizeCurrency(product && (product.pagePriceCurrency || product.currency || product.price && product.price.currency)),
      pagePriceValue: Number(product && product.pagePriceValue) || 0,
      currentPriceValue: Number(product && product.currentPriceValue) || 0,
      oldPriceValue: Number(product && product.oldPriceValue) || 0,
      bankPriceValue: Number(product && product.bankPriceValue) || 0,
    };
  }

  function normalizeMonitor(meta, fallbackCurrency) {
    meta = meta && typeof meta === 'object' ? meta : {};
    var priceValue = Number(meta.monitorPriceValue || meta.monitor && meta.monitor.priceValue) || 0;
    var currency = normalizeCurrency(meta.monitorCurrency || meta.monitor && meta.monitor.currency || fallbackCurrency || 'RUB');
    return {
      enabled: priceValue > 0,
      priceValue: priceValue,
      currency: currency,
    };
  }

  function buildProductKey(productId, url) {
    if (productId) return 'ozon:product:' + productId;
    if (url) return 'ozon:url:' + encodeURIComponent(url);
    return 'ozon:manual:' + safeIsoDate();
  }

  function buildSnapshot(price, now) {
    return {
      value: Number(price && price.value) || 0,
      currency: normalizeCurrency(price && price.currency),
      capturedAt: safeIsoDate(now),
    };
  }

  function normalizeProduct(product, options) {
    product = product && typeof product === 'object' ? product : {};
    options = options && typeof options === 'object' ? options : {};
    var now = safeIsoDate(options.now);
    var url = normalizeUrl(product.url);
    var productId = inferProductId(product, url);
    var price = normalizePrice(product);
    var key = buildProductKey(productId, url);
    var snapshot = buildSnapshot(price, now);

    return {
      key: key,
      platform: 'ozon',
      productId: productId,
      sku: toText(product.structuredSku || product.sku).trim(),
      title: toText(product.title).trim(),
      url: url,
      pageType: toText(product.pageType || 'detail').trim() || 'detail',
      specificationSummary: toText(product.specificationSummary).trim(),
      weightG: Number(product.weightG) || 0,
      price: price,
      priceSnapshots: snapshot.value > 0 ? [snapshot] : [],
      favorite: Boolean(product.favorite),
      tags: normalizeTags(product.tags),
      note: toText(product.note).trim(),
      monitor: normalizeMonitor(product, price.currency),
      createdAt: now,
      updatedAt: now,
      lastPriceChangedAt: snapshot.value > 0 ? now : '',
    };
  }

  function mergeProduct(existing, incoming, now) {
    var previousSnapshots = Array.isArray(existing.priceSnapshots) ? existing.priceSnapshots.slice() : [];
    var latestSnapshot = previousSnapshots.length ? previousSnapshots[previousSnapshots.length - 1] : null;
    var nextSnapshots = previousSnapshots.slice();
    var priceChanged = Number(incoming.price.value) > 0 && (
      !latestSnapshot
      || Number(latestSnapshot.value) !== Number(incoming.price.value)
      || normalizeCurrency(latestSnapshot.currency) !== normalizeCurrency(incoming.price.currency)
    );

    if (priceChanged) {
      nextSnapshots.push(buildSnapshot(incoming.price, now));
    }

    return Object.assign({}, existing, incoming, {
      title: incoming.title || existing.title,
      url: incoming.url || existing.url,
      productId: incoming.productId || existing.productId,
      sku: incoming.sku || existing.sku,
      specificationSummary: incoming.specificationSummary || existing.specificationSummary,
      weightG: incoming.weightG || existing.weightG || 0,
      favorite: Boolean(existing.favorite),
      tags: normalizeTags(existing.tags),
      note: toText(existing.note).trim(),
      monitor: existing.monitor || incoming.monitor || normalizeMonitor({}, incoming.price.currency),
      createdAt: existing.createdAt || incoming.createdAt,
      updatedAt: safeIsoDate(now),
      lastPriceChangedAt: priceChanged ? safeIsoDate(now) : (existing.lastPriceChangedAt || incoming.lastPriceChangedAt || ''),
      priceSnapshots: nextSnapshots,
    });
  }

  function upsertProduct(existingProducts, product, options) {
    var products = Array.isArray(existingProducts) ? existingProducts.slice() : [];
    options = options && typeof options === 'object' ? options : {};
    var now = safeIsoDate(options.now);
    var incoming = normalizeProduct(product, { now: now });
    var index = products.findIndex(function (item) {
      return item && item.key === incoming.key;
    });
    if (index < 0 && incoming.url) {
      index = products.findIndex(function (item) {
        return item && normalizeUrl(item.url) === incoming.url;
      });
    }

    if (index >= 0) {
      products[index] = mergeProduct(products[index], incoming, now);
      return products;
    }

    products.push(incoming);
    return products;
  }

  function updateProductMeta(existingProducts, key, meta, options) {
    var products = Array.isArray(existingProducts) ? existingProducts.slice() : [];
    options = options && typeof options === 'object' ? options : {};
    meta = meta && typeof meta === 'object' ? meta : {};
    var now = safeIsoDate(options.now);
    return products.map(function (product) {
      if (!product || product.key !== key) return product;
      return Object.assign({}, product, {
        favorite: meta.favorite == null ? Boolean(product.favorite) : Boolean(meta.favorite),
        tags: meta.tags == null ? normalizeTags(product.tags) : normalizeTags(meta.tags),
        note: meta.note == null ? toText(product.note).trim() : toText(meta.note).trim(),
        monitor: (meta.monitorPriceValue == null && meta.monitorCurrency == null && meta.monitor == null)
          ? (product.monitor || normalizeMonitor({}, product.price && product.price.currency))
          : normalizeMonitor(meta, product.price && product.price.currency),
        updatedAt: now,
      });
    });
  }

  function evaluatePriceAlert(record, product) {
    var monitor = record && record.monitor ? record.monitor : {};
    var currentPrice = normalizePrice(product || record || {});
    if (!monitor.enabled || !(Number(monitor.priceValue) > 0) || !(Number(currentPrice.value) > 0)) {
      return {
        alert: false,
        message: '未设置监控价或当前价不可用。',
        delta: 0,
      };
    }
    var sameCurrency = normalizeCurrency(monitor.currency) === normalizeCurrency(currentPrice.currency);
    if (!sameCurrency) {
      return {
        alert: false,
        message: '监控价币种与当前价币种不一致。',
        delta: 0,
      };
    }
    var delta = Number(currentPrice.value) - Number(monitor.priceValue);
    if (delta <= 0) {
      return {
        alert: true,
        message: '当前价 ' + currentPrice.value + ' ' + currentPrice.currency + ' 已低于监控价 ' + monitor.priceValue + ' ' + monitor.currency + '。',
        delta: delta,
      };
    }
    return {
      alert: false,
      message: '当前价高于监控价 ' + delta + ' ' + currentPrice.currency + '。',
      delta: delta,
    };
  }

  function exportProductsAsJson(products) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      products: Array.isArray(products) ? products : [],
    }, null, 2);
  }

  function csvEscape(value) {
    var text = toText(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportProductsAsCsv(products) {
    var columns = [
      'key',
      'platform',
      'productId',
      'sku',
      'title',
      'url',
      'price',
      'currency',
      'weightG',
      'favorite',
      'tags',
      'note',
      'monitorPrice',
      'monitorCurrency',
      'createdAt',
      'updatedAt',
      'lastPriceChangedAt',
    ];
    var rows = [columns.join(',')];
    (Array.isArray(products) ? products : []).forEach(function (product) {
      var price = product && product.price ? product.price : {};
      var monitor = product && product.monitor ? product.monitor : {};
      rows.push([
        product && product.key,
        product && product.platform,
        product && product.productId,
        product && product.sku,
        product && product.title,
        product && product.url,
        Number(price.value) || 0,
        normalizeCurrency(price.currency),
        Number(product && product.weightG) || 0,
        Boolean(product && product.favorite),
        Array.isArray(product && product.tags) ? product.tags.join('|') : '',
        product && product.note,
        Number(monitor.priceValue) || 0,
        monitor.currency || '',
        product && product.createdAt,
        product && product.updatedAt,
        product && product.lastPriceChangedAt,
      ].map(csvEscape).join(','));
    });
    return rows.join('\n');
  }

  var api = {
    normalizeProduct: normalizeProduct,
    upsertProduct: upsertProduct,
    updateProductMeta: updateProductMeta,
    evaluatePriceAlert: evaluatePriceAlert,
    exportProductsAsJson: exportProductsAsJson,
    exportProductsAsCsv: exportProductsAsCsv,
  };

  root.OZON_CALC_PRODUCT_POOL_STORE = api;
  if (root.window && root.window !== root) {
    root.window.OZON_CALC_PRODUCT_POOL_STORE = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : window));
