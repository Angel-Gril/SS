(function (root, factory) {
  var api = factory();
  root.SS_ERP_SOURCE_CANDIDATE_STORE = api;
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
    return text || 'CNY';
  }

  function parsePrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
    var text = toText(value).replace(/[\s,，]/g, '');
    var match = text.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) return 0;
    var num = Number(match[0]);
    return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
  }

  function uniqueStrings(values) {
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
    var text = toText(value);
    var direct = text.match(/^[0-9]{6,}$/);
    if (direct) return direct[0];
    var path = text.split(/[?#]/)[0];
    var match = path.match(/(?:-|\/)([0-9]{6,})\/?$/i);
    return match ? match[1] : '';
  }

  function normalizeOzonProduct(product, options) {
    product = product && typeof product === 'object' ? product : {};
    options = options && typeof options === 'object' ? options : {};
    var url = normalizeUrl(product.url || product.sourceUrl || product.tabUrl);
    var productId = toText(product.productId || product.sku || parseOzonProductId(url)).trim();
    var key = productId ? 'ozon:product:' + productId : 'ozon:url:' + encodeURIComponent(url);
    var priceObject = product.price && typeof product.price === 'object' ? product.price : {};
    var costingInputPriceCny = parsePrice(product.costingInputPriceCny || product.priceRMB || product.priceCny || product.pagePriceCny);
    var priceValue = parsePrice(costingInputPriceCny || product.pagePriceValue || product.currentPriceValue || priceObject.value || product.price);
    var pagePriceValue = parsePrice(product.pagePriceValue || priceValue || product.currentPriceValue || priceObject.value || product.price);
    var currentPriceValue = parsePrice(product.currentPriceValue || pagePriceValue || priceValue || priceObject.value || product.price);
    var currency = costingInputPriceCny ? 'CNY' : normalizeCurrency(product.pagePriceCurrency || priceObject.currency || product.currency, 'RUB');
    return {
      key: key,
      productId: productId,
      title: toText(product.title || product.sourceTitleRaw || product.name).trim(),
      url: url,
      images: uniqueStrings(product.images || product.imageUrls || (product.image ? [product.image] : [])),
      price: {
        value: priceValue,
        currency: currency
      },
      pagePriceValue: pagePriceValue,
      pagePriceCurrency: currency,
      currentPriceValue: currentPriceValue,
      weightG: Number(product.weightG || product.grossWeightGrams) || 0,
      categoryHints: Array.isArray(product.categoryHints)
        ? product.categoryHints.map(toText).filter(Boolean).slice(0, 8)
        : [product.categoryName, product.title, product.sourceTitleRaw].map(toText).filter(Boolean).slice(0, 8),
      capturedAt: safeIsoDate(product.capturedAt || options.now)
    };
  }

  function normalizePlatform(product) {
    var value = toText(product && (product.sourcePlatform || product.platform)).trim().toLowerCase();
    if (value === 'pdd' || value.indexOf('pinduoduo') >= 0 || value.indexOf('yangkeduo') >= 0) return 'pinduoduo';
    if (value === '1688' || value.indexOf('1688') >= 0) return '1688';
    if (value.indexOf('tmall') >= 0 || value.indexOf('天猫') >= 0) return 'tmall';
    if (value.indexOf('taobao') >= 0 || value.indexOf('淘宝') >= 0) return 'taobao';
    return value || 'source';
  }

  function inferSourceProductId(product, url) {
    var explicit = toText(product && (product.sourceProductId || product.productId || product.sku)).trim();
    if (explicit) return explicit;
    var text = toText(url);
    var match = text.match(/[?&](?:goods_id|id|itemId|offerId)=(\d+)/i) || text.match(/\/(?:offer|goods|item)\/?(\d+)/i);
    return match ? match[1] : '';
  }

  function buildCandidateKey(platform, sourceProductId, url) {
    if (platform && sourceProductId) return platform + ':' + sourceProductId;
    if (url) return platform + ':url:' + encodeURIComponent(url);
    return platform + ':manual';
  }

  function normalizeCandidate(product, existing, options) {
    product = product && typeof product === 'object' ? product : {};
    existing = existing && typeof existing === 'object' ? existing : null;
    options = options && typeof options === 'object' ? options : {};
    var now = safeIsoDate(options.now);
    var platform = normalizePlatform(product);
    var url = normalizeUrl(product.sourceUrl || product.url || product.tabUrl);
    var sourceProductId = inferSourceProductId(product, url);
    var priceValue = parsePrice(product.price || product.priceText || product.priceCny || product.currentPriceValue);
    var currency = normalizeCurrency(product.currency || product.priceCurrency, 'CNY');

    return {
      key: buildCandidateKey(platform, sourceProductId, url),
      platform: platform,
      sourceProductId: sourceProductId,
      title: toText(product.title || product.sourceTitleRaw || product.publishTitle).trim(),
      url: url,
      shopName: toText(product.shopName || product.supplier || product.shop).trim(),
      price: {
        value: priceValue,
        currency: currency,
        text: product.priceText ? toText(product.priceText).trim() : (priceValue ? priceValue + ' ' + currency : '')
      },
      images: uniqueStrings(product.images || product.imageUrls || (product.image ? [product.image] : [])),
      skuCount: Number(product.skuCount) || (Array.isArray(product.skuItems) ? product.skuItems.length : 0),
      skuItems: Array.isArray(product.skuItems) ? product.skuItems.slice(0, 100) : [],
      variants: Array.isArray(product.variants) ? product.variants.slice(0, 100) : [],
      grossWeightGrams: Number(product.grossWeightGrams || product.weightG) || null,
      lengthMm: Number(product.lengthMm) || null,
      widthMm: Number(product.widthMm) || null,
      heightMm: Number(product.heightMm) || null,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };
  }

  function upsertCandidateSet(existingSets, ozonProduct, sourceProduct, options) {
    var sets = Array.isArray(existingSets) ? existingSets.slice() : [];
    var now = safeIsoDate(options && options.now);
    var ozon = normalizeOzonProduct(ozonProduct, { now: now });
    if (!ozon.productId && !ozon.url) return sets;

    var setIndex = sets.findIndex(function (item) {
      return item && item.key === ozon.key;
    });
    var currentSet = setIndex >= 0 ? sets[setIndex] : {
      key: ozon.key,
      ozon: ozon,
      candidates: [],
      createdAt: now,
      updatedAt: now
    };

    var candidates = Array.isArray(currentSet.candidates) ? currentSet.candidates.slice() : [];
    var candidate = normalizeCandidate(sourceProduct, null, { now: now });
    var candidateIndex = candidates.findIndex(function (item) {
      return item && item.key === candidate.key;
    });
    if (candidateIndex >= 0) {
      candidate = normalizeCandidate(sourceProduct, candidates[candidateIndex], { now: now });
      candidates[candidateIndex] = candidate;
    } else {
      candidates.unshift(candidate);
    }

    currentSet = Object.assign({}, currentSet, {
      ozon: Object.assign({}, currentSet.ozon || {}, ozon, {
        title: ozon.title || currentSet.ozon && currentSet.ozon.title || '',
        images: ozon.images.length ? ozon.images : currentSet.ozon && currentSet.ozon.images || []
      }),
      candidates: candidates.slice(0, 50),
      updatedAt: now
    });

    if (setIndex >= 0) {
      sets[setIndex] = currentSet;
    } else {
      sets.unshift(currentSet);
    }
    return sets.slice(0, 100);
  }

  function listCandidatesForOzon(existingSets, ozonProductOrId) {
    var sets = Array.isArray(existingSets) ? existingSets : [];
    var probe = typeof ozonProductOrId === 'object'
      ? normalizeOzonProduct(ozonProductOrId)
      : normalizeOzonProduct({ productId: ozonProductOrId });
    return sets.filter(function (item) {
      return item && item.key === probe.key;
    });
  }

  return {
    normalizeOzonProduct: normalizeOzonProduct,
    normalizeCandidate: normalizeCandidate,
    upsertCandidateSet: upsertCandidateSet,
    listCandidatesForOzon: listCandidatesForOzon
  };
});
