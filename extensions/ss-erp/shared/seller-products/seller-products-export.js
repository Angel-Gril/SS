(function (root) {
  function toText(value) {
    return value == null ? '' : String(value);
  }

  function toNumber(value) {
    if (value && typeof value === 'object') {
      if (value.value != null) return toNumber(value.value);
      if (value.amount != null) return toNumber(value.amount);
    }
    var number = Number(toText(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeCurrency(value) {
    return toText(value && typeof value === 'object' ? value.currency_code || value.currency : value).trim().toUpperCase() || 'RUB';
  }

  function parseJson(text) {
    try {
      return JSON.parse(toText(text));
    } catch (error) {
      return null;
    }
  }

  function getFirst(object, names) {
    if (!object || typeof object !== 'object') return '';
    for (var index = 0; index < names.length; index += 1) {
      var name = names[index];
      if (object[name] != null && object[name] !== '') return object[name];
    }
    return '';
  }

  function collectObjects(value, output, depth) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach(function (item) {
        collectObjects(item, output, depth + 1);
      });
      return;
    }
    if (typeof value !== 'object') return;
    output.push(value);
    Object.keys(value).forEach(function (key) {
      var child = value[key];
      if (child && typeof child === 'object') collectObjects(child, output, depth + 1);
    });
  }

  function getProductId(item) {
    return toText(getFirst(item, ['product_id', 'productId', 'productID', 'id', 'sku_id', 'skuId'])).trim();
  }

  function getOfferId(item) {
    return toText(getFirst(item, ['offer_id', 'offerId', 'offerID', 'sku', 'sku_id', 'skuId', 'article', 'vendor_code'])).trim();
  }

  function getTitle(item) {
    return toText(getFirst(item, ['name', 'title', 'product_name', 'productName', 'caption'])).trim();
  }

  function getPrice(item) {
    var price = getFirst(item, ['price', 'current_price', 'currentPrice', 'marketing_price', 'marketingPrice']);
    return toNumber(price);
  }

  function getOldPrice(item) {
    return toNumber(getFirst(item, ['old_price', 'oldPrice', 'original_price', 'originalPrice']));
  }

  function getPresentStock(item) {
    if (item && item.stocks && typeof item.stocks === 'object') {
      return toNumber(getFirst(item.stocks, ['present', 'available', 'stock', 'quantity']));
    }
    return toNumber(getFirst(item, ['present', 'available', 'stock', 'stocks', 'quantity', 'balance']));
  }

  function getReservedStock(item) {
    if (item && item.stocks && typeof item.stocks === 'object') {
      return toNumber(getFirst(item.stocks, ['reserved', 'reserve']));
    }
    return toNumber(getFirst(item, ['reserved', 'reserve']));
  }

  function getStatus(item) {
    var status = getFirst(item, ['status', 'state', 'visibility', 'moderation_status', 'moderationStatus']);
    if (status && typeof status === 'object') {
      return toText(getFirst(status, ['name', 'title', 'code', 'value'])).trim();
    }
    return toText(status).trim();
  }

  function mergeRecord(existing, partial) {
    return {
      key: existing.key || partial.key,
      productId: partial.productId || existing.productId || '',
      offerId: partial.offerId || existing.offerId || '',
      sku: partial.sku || existing.sku || partial.offerId || existing.offerId || '',
      title: partial.title || existing.title || '',
      price: partial.price || existing.price || 0,
      oldPrice: partial.oldPrice || existing.oldPrice || 0,
      currency: partial.currency || existing.currency || 'RUB',
      stockPresent: partial.stockPresent || existing.stockPresent || 0,
      stockReserved: partial.stockReserved || existing.stockReserved || 0,
      status: partial.status || existing.status || '',
      sourceUrl: partial.sourceUrl || existing.sourceUrl || '',
      capturedAt: partial.capturedAt || existing.capturedAt || '',
    };
  }

  function extractPartialProduct(item, entry) {
    var productId = getProductId(item);
    var offerId = getOfferId(item);
    var title = getTitle(item);
    var price = getPrice(item);
    var oldPrice = getOldPrice(item);
    var stockPresent = getPresentStock(item);
    var stockReserved = getReservedStock(item);
    var status = getStatus(item);
    if (!productId && !offerId && !title && !price && !stockPresent && !status) return null;
    var currency = normalizeCurrency(getFirst(item, ['currency_code', 'currency', 'currencyCode']) || (item.price && item.price.currency_code) || (item.price && item.price.currency));
    var key = (productId || '') + '|' + (offerId || '');
    if (key === '|') key = title || toText(entry && entry.request && entry.request.url);
    return {
      key: key,
      productId: productId,
      offerId: offerId,
      sku: offerId,
      title: title,
      price: price,
      oldPrice: oldPrice,
      currency: currency,
      stockPresent: stockPresent,
      stockReserved: stockReserved,
      status: status,
      sourceUrl: toText(entry && entry.request && entry.request.url),
      capturedAt: toText(entry && (entry.startedDateTime || entry.capturedAt)),
    };
  }

  function extractSellerProductsFromEntries(entries) {
    var map = {};
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      var text = entry && entry.response && entry.response.content ? entry.response.content.text : '';
      var parsed = parseJson(text);
      if (!parsed) return;
      var objects = [];
      collectObjects(parsed, objects, 0);
      objects.forEach(function (item) {
        var partial = extractPartialProduct(item, entry);
        if (!partial) return;
        var key = partial.key;
        map[key] = mergeRecord(map[key] || {}, partial);
      });
    });
    return Object.keys(map).map(function (key) {
      return map[key];
    }).filter(function (record) {
      return record.productId || record.offerId || record.title;
    }).sort(function (left, right) {
      return left.offerId.localeCompare(right.offerId) || left.productId.localeCompare(right.productId);
    });
  }

  function csvEscape(value) {
    var text = toText(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportSellerProductsAsJson(products) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      products: Array.isArray(products) ? products : [],
    }, null, 2);
  }

  function exportSellerProductsAsCsv(products) {
    var columns = [
      'key',
      'productId',
      'offerId',
      'sku',
      'title',
      'price',
      'oldPrice',
      'currency',
      'stockPresent',
      'stockReserved',
      'status',
      'sourceUrl',
      'capturedAt',
    ];
    var rows = [columns.join(',')];
    (Array.isArray(products) ? products : []).forEach(function (product) {
      rows.push([
        product && product.key,
        product && product.productId,
        product && product.offerId,
        product && product.sku,
        product && product.title,
        Number(product && product.price) || 0,
        Number(product && product.oldPrice) || 0,
        product && product.currency,
        Number(product && product.stockPresent) || 0,
        Number(product && product.stockReserved) || 0,
        product && product.status,
        product && product.sourceUrl,
        product && product.capturedAt,
      ].map(csvEscape).join(','));
    });
    return rows.join('\n');
  }

  var api = {
    extractSellerProductsFromEntries: extractSellerProductsFromEntries,
    exportSellerProductsAsJson: exportSellerProductsAsJson,
    exportSellerProductsAsCsv: exportSellerProductsAsCsv,
  };

  root.OZON_CALC_SELLER_PRODUCTS_EXPORT = api;
  if (root.window && root.window !== root) {
    root.window.OZON_CALC_SELLER_PRODUCTS_EXPORT = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : window));
