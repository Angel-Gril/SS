(function (root, factory) {
  var api = factory();
  root.SS_ERP_SOURCE_QUOTE_STORE = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

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
    if (text.indexOf('//') === 0) text = 'https:' + text;
    return text.split('#')[0].replace(/\/+$/, '');
  }

  function normalizeCurrency(value, fallback) {
    var text = toText(value || fallback || '').trim().toUpperCase();
    if (text === 'RMB' || text === '￥' || text === '¥' || text === '元' || text === '人民币') return 'CNY';
    if (text === 'RUR' || text === 'РУБ' || text === '₽' || text === '卢布') return 'RUB';
    return text || 'CNY';
  }

  function parsePrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
    var text = toText(value).replace(/[\u00a0\u202f\s']/g, '');
    var match = text.match(/[-+]?\d[\d.,]*/);
    if (!match) return 0;
    var cleaned = match[0];
    var comma = cleaned.lastIndexOf(',');
    var dot = cleaned.lastIndexOf('.');
    if (comma >= 0 && dot >= 0) {
      cleaned = comma > dot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
    } else if (comma >= 0) {
      var commaDecimals = cleaned.length - comma - 1;
      cleaned = commaDecimals > 0 && commaDecimals <= 2
        ? cleaned.replace(',', '.')
        : cleaned.replace(/,/g, '');
    } else if (dot >= 0) {
      var dotDecimals = cleaned.length - dot - 1;
      if (!(dotDecimals > 0 && dotDecimals <= 2)) cleaned = cleaned.replace(/\./g, '');
    }
    var number = Number(cleaned);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
  }

  function uniqueUrls(values) {
    var seen = {};
    return (Array.isArray(values) ? values : []).map(function (value) {
      return normalizeUrl(value);
    }).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function parseOzonProductId(value) {
    var text = toText(value).trim();
    if (/^[0-9]{6,}$/.test(text)) return text;
    var path = text.split(/[?#]/)[0];
    var match = path.match(/(?:-|\/)([0-9]{6,})\/?$/i);
    return match ? match[1] : '';
  }

  function normalizeOzonProduct(product, options) {
    product = product && typeof product === 'object' ? product : {};
    options = options && typeof options === 'object' ? options : {};
    var url = normalizeUrl(product.url || product.sourceUrl || product.tabUrl);
    var productId = toText(product.productId || product.sku || parseOzonProductId(url)).trim();
    var priceObject = product.price && typeof product.price === 'object' ? product.price : {};
    var costingInputPriceCny = parsePrice(product.costingInputPriceCny || product.priceRMB || product.priceCny || product.pagePriceCny);
    var priceSource = costingInputPriceCny || product.pagePriceValue || product.currentPriceValue || priceObject.value || product.price;
    var currencySource = costingInputPriceCny ? 'CNY' : (product.pagePriceCurrency || priceObject.currency || product.currency);
    return {
      productId: productId,
      title: toText(product.title || product.sourceTitleRaw || product.name).trim(),
      url: url,
      price: {
        value: parsePrice(priceSource),
        currency: normalizeCurrency(currencySource, 'RUB')
      },
      capturedAt: safeIsoDate(product.capturedAt || options.now)
    };
  }

  function normalizePlatform(product) {
    var value = toText(product && (product.sourcePlatform || product.platform || product.sourceHost)).trim().toLowerCase();
    if (value === 'pdd' || value.indexOf('pinduoduo') >= 0 || value.indexOf('yangkeduo') >= 0 || value.indexOf('拼多多') >= 0) return 'pinduoduo';
    if (value === '1688' || value.indexOf('1688') >= 0) return '1688';
    if (value.indexOf('tmall') >= 0 || value.indexOf('天猫') >= 0) return 'tmall';
    if (value.indexOf('taobao') >= 0 || value.indexOf('淘宝') >= 0) return 'taobao';
    return value || 'source';
  }

  function inferSourceProductId(product, url) {
    var explicit = toText(product && (product.sourceProductId || product.productId || product.goodsId || product.offerId || product.itemId)).trim();
    if (explicit) return explicit;
    var text = toText(url);
    var match = text.match(/[?&](?:goods_id|id|itemId|item_id|offerId|offer_id)=(\d+)/i)
      || text.match(/\/(?:offer|goods|item)\/?(\d+)/i)
      || text.match(/\/(\d+)\.html/i);
    return match ? match[1] : '';
  }

  function inferSourceSku(product) {
    var selected = product && product.selectedSku && typeof product.selectedSku === 'object' ? product.selectedSku : null;
    var selectedSku = toText(selected && (selected.skuId || selected.sku || selected.id || selected.name || selected.specText)).trim();
    if (selectedSku) return selectedSku;
    var direct = toText(product && (product.sourceSku || product.sku || product.skuId || product.selectedSkuId)).trim();
    if (direct) return direct;
    var skuItems = product && Array.isArray(product.skuItems) ? product.skuItems : [];
    if (!skuItems.length) return '';
    return toText(skuItems[0].skuId || skuItems[0].sku || skuItems[0].id || skuItems[0].name || skuItems[0].specText).trim();
  }

  function inferSkuAttributes(product) {
    var selected = product && product.selectedSku && typeof product.selectedSku === 'object' ? product.selectedSku : null;
    if (selected && selected.attrs && typeof selected.attrs === 'object' && !Array.isArray(selected.attrs)) return Object.assign({}, selected.attrs);
    var selectedText = toText(selected && (selected.name || selected.specText || selected.spec)).trim();
    if (selectedText) return { spec: selectedText };
    var attrs = product && (product.selectedSkuAttributes || product.skuAttributes);
    if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) return Object.assign({}, attrs);
    var skuItems = product && Array.isArray(product.skuItems) ? product.skuItems : [];
    var first = skuItems[0] || {};
    if (first.attrs && typeof first.attrs === 'object') return Object.assign({}, first.attrs);
    var text = toText(first.name || first.specText || first.spec || '').trim();
    return text ? { spec: text } : {};
  }

  function inferPriceSource(product) {
    var selected = product && product.selectedSku && typeof product.selectedSku === 'object' ? product.selectedSku : null;
    if (selected && selected.price != null) return selected.price;
    var skuItems = product && Array.isArray(product.skuItems) ? product.skuItems : [];
    var skuPrice = skuItems.length ? skuItems[0].price : null;
    if (product && product.price && typeof product.price === 'object' && product.price.value != null) return product.price.value;
    return product && (
      product.priceCny
      || product.costCny
      || product.price
      || product.priceText
      || product.currentPriceValue
      || skuPrice
    );
  }

  function normalizeShippingFee(product, existing) {
    product = product && typeof product === 'object' ? product : {};
    existing = existing && typeof existing === 'object' ? existing : {};
    var objectValue = product.shippingFee && typeof product.shippingFee === 'object' ? product.shippingFee : {};
    var source = objectValue.value != null
      ? objectValue.value
      : (
        product.shippingCny
        || product.freightCny
        || product.freightFee
        || product.shippingFee
        || product.shippingText
        || product.freightText
      );
    var hasExplicitZero = source === 0 || source === '0' || source === '¥0' || source === '￥0';
    var value = parsePrice(source);
    if (!value && !hasExplicitZero && existing.shippingFee && existing.shippingFee.value) value = parsePrice(existing.shippingFee.value);
    var currency = normalizeCurrency(product.shippingCurrency || objectValue.currency || product.currency || 'CNY', 'CNY');
    var text = toText(product.shippingText || product.freightText || objectValue.text || (value ? value + ' ' + currency : '')).trim();
    return {
      value: hasExplicitZero ? 0 : value,
      currency: currency,
      text: text,
      free: Boolean(product.shippingFree || objectValue.free || hasExplicitZero || value === 0)
    };
  }

  function inferTotalCostCny(product, priceValue, shippingValue) {
    product = product && typeof product === 'object' ? product : {};
    var explicit = product.totalCostCny || product.purchaseCostCny || product.landedCostCny;
    if (explicit != null && explicit !== '') return parsePrice(explicit);
    var price = parsePrice(priceValue);
    var shipping = parsePrice(shippingValue);
    return Math.round((price + shipping) * 100) / 100;
  }

  function normalizeSourceProduct(product, existing) {
    product = product && typeof product === 'object' ? product : {};
    existing = existing && typeof existing === 'object' ? existing : {};
    var url = normalizeUrl(product.sourceUrl || product.url || product.tabUrl);
    var platform = normalizePlatform(product);
    var productId = inferSourceProductId(product, url);
    var priceSource = inferPriceSource(product);
    var priceValue = parsePrice(priceSource);
    var priceObject = product.price && typeof product.price === 'object' ? product.price : {};
    var currency = normalizeCurrency(product.currency || product.priceCurrency || priceObject.currency, 'CNY');
    var priceText = toText(product.priceText || priceObject.text).trim() || (priceValue ? priceValue + ' ' + currency : '');
    var shippingFee = normalizeShippingFee(product, existing);
    var totalCostCny = inferTotalCostCny(product, priceValue, shippingFee.value);
    return {
      platform: platform,
      productId: productId,
      sku: inferSourceSku(product),
      skuAttributes: inferSkuAttributes(product),
      url: url,
      title: toText(product.title || product.sourceTitleRaw || product.publishTitle || product.name || existing.title).trim(),
      shopName: toText(product.shopName || product.supplier || product.shop || existing.shopName).trim(),
      price: {
        value: priceValue,
        currency: currency,
        text: priceText
      },
      shippingFee: shippingFee,
      totalCostCny: totalCostCny,
      priceSourceType: toText(product.priceSourceType || existing.priceSourceType).trim(),
      images: uniqueUrls(product.images || product.imageUrls || (product.image ? [product.image] : existing.images)),
      skuItems: Array.isArray(product.skuItems) ? product.skuItems.slice(0, 100) : (Array.isArray(existing.skuItems) ? existing.skuItems : []),
      grossWeightGrams: Number(product.grossWeightGrams || product.weightG || existing.grossWeightGrams) || null,
      lengthMm: Number(product.lengthMm || existing.lengthMm) || null,
      widthMm: Number(product.widthMm || existing.widthMm) || null,
      heightMm: Number(product.heightMm || existing.heightMm) || null
    };
  }

  function buildQuoteKey(ozon, source) {
    var ozonPart = ozon.productId || (ozon.url ? 'url:' + encodeURIComponent(ozon.url) : 'unknown-ozon');
    var sourcePart = source.productId || (source.url ? 'url:' + encodeURIComponent(source.url) : 'manual-source');
    var skuPart = source.sku || 'default';
    return [ozonPart, source.platform || 'source', sourcePart, skuPart].join('|');
  }

  function normalizeQuote(payload, existing, options) {
    payload = payload && typeof payload === 'object' ? payload : {};
    existing = existing && typeof existing === 'object' ? existing : null;
    options = options && typeof options === 'object' ? options : {};
    var now = safeIsoDate(options.now);
    var ozon = normalizeOzonProduct(payload.ozon || payload.ozonProduct || (existing && existing.ozon) || {}, { now: now });
    var source = normalizeSourceProduct(payload.sourceProduct || payload.source || payload.product || payload, existing && existing.source);
    var key = payload.key || buildQuoteKey(ozon, source);
    var costCny = parsePrice(payload.costCny || source.totalCostCny || source.price.value);
    return {
      key: key,
      status: toText(payload.status || 'selected_for_costing').trim() || 'selected_for_costing',
      ozon: ozon,
      source: source,
      costCny: costCny,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };
  }

  function upsertQuote(existingQuotes, quote) {
    var quotes = Array.isArray(existingQuotes) ? existingQuotes.slice() : [];
    var normalized = normalizeQuote(quote, null, { now: quote && quote.updatedAt });
    var index = quotes.findIndex(function (item) {
      return item && item.key === normalized.key;
    });
    if (index >= 0) {
      normalized = normalizeQuote(normalized, quotes[index], { now: normalized.updatedAt });
      quotes[index] = normalized;
    } else {
      quotes.unshift(normalized);
    }
    return quotes.slice(0, 500);
  }

  function quoteMatchesOzon(quote, ozonProductOrId) {
    if (!quote || typeof quote !== 'object') return false;
    var probe = typeof ozonProductOrId === 'object'
      ? normalizeOzonProduct(ozonProductOrId)
      : normalizeOzonProduct({ productId: ozonProductOrId });
    if (probe.productId && quote.ozon && quote.ozon.productId === probe.productId) return true;
    if (probe.url && quote.ozon && normalizeUrl(quote.ozon.url) === probe.url) return true;
    return false;
  }

  function listQuotesForOzon(existingQuotes, ozonProductOrId) {
    var quotes = Array.isArray(existingQuotes) ? existingQuotes : [];
    if (!ozonProductOrId) return quotes;
    return quotes.filter(function (quote) {
      return quoteMatchesOzon(quote, ozonProductOrId);
    });
  }

  function csvEscape(value) {
    var text = toText(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportQuotesAsCsv(existingQuotes) {
    var rows = [[
      'ozonSku',
      'ozonUrl',
      'ozonTitle',
      'ozonCostingInputPriceCny',
      'sourcePlatform',
      'sourceProductId',
      'sourceSku',
      'sourceUrl',
      'sourceTitle',
      'purchaseCostCny',
      'sourceUnitPrice',
      'sourceShippingCny',
      'sourcePriceText',
      'status',
      'createdAt',
      'updatedAt'
    ].join(',')];
    (Array.isArray(existingQuotes) ? existingQuotes : []).forEach(function (quote) {
      var ozon = quote && quote.ozon || {};
      var source = quote && quote.source || {};
      rows.push([
        ozon.productId,
        ozon.url,
        ozon.title,
        ozon.price && ozon.price.value,
        source.platform,
        source.productId,
        source.sku,
        source.url,
        source.title,
        quote && quote.costCny,
        source.price && source.price.value,
        source.shippingFee && source.shippingFee.value,
        source.price && source.price.text,
        quote && quote.status,
        quote && quote.createdAt,
        quote && quote.updatedAt
      ].map(csvEscape).join(','));
    });
    return rows.join('\n');
  }

  return {
    normalizeOzonProduct: normalizeOzonProduct,
    normalizeSourceProduct: normalizeSourceProduct,
    normalizeQuote: normalizeQuote,
    upsertQuote: upsertQuote,
    quoteMatchesOzon: quoteMatchesOzon,
    listQuotesForOzon: listQuotesForOzon,
    exportQuotesAsCsv: exportQuotesAsCsv
  };
});
