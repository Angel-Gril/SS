(function () {
  'use strict';

  var COMPOSER_PATH = '/api/composer-api.bx/page/json/v2';
  var FETCH_DELAY_MS = 800;

  function fetchOzonProduct(productId) {
    // 强制俄语：把 language=ru 放到内嵌 url 的 query 里，避免被中文 cookie 覆盖
    var url = COMPOSER_PATH + '?url=' + encodeURIComponent('/product/' + productId + '/?language=ru');
    return fetch(url, {
      credentials: 'include',
      headers: {
        'x-o3-app-name': 'dweb_client',
        'accept': 'application/json',
        'x-o3-language': 'ru',
        'Accept-Language': 'ru'
      }
    })
    .then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + ': ' + t.slice(0, 200));
        });
      }
      return res.json();
    })
    .then(function (data) {
      return parseWidgetStates(productId, data);
    });
  }

  function parseWidgetStates(productId, data) {
    var priceCurrency = globalThis.SS_ERP_PRICE_CURRENCY || {};
    var fallbackCurrencyByHost = priceCurrency.fallbackCurrencyByHost || function () { return 'RUB'; };
    var states = data && data.widgetStates;
    if (!states || typeof states !== 'object') {
      return { ok: false, productId: productId, error: 'no widgetStates', _rawKeys: [] };
    }

    var widgets = [];
    var rawKeys = Object.keys(states);
    for (var i = 0; i < rawKeys.length; i++) {
      var key = rawKeys[i];
      var raw = states[key];
      if (typeof raw !== 'string') continue;
      try { widgets.push({ key: key, state: JSON.parse(raw) }); } catch (e) {}
    }

    var result = {
      ok: true,
      productId: Number(productId),
      title: '',
      images: [],
      price: null,
      oldPrice: null,
      currency: null,
      description: '',
      brand: null,
      category: null,
      attributes: [],
      url: 'https://www.ozon.ru/product/' + productId + '/',
      _rawKeys: rawKeys
    };

    for (var w = 0; w < widgets.length; w++) {
      var key = widgets[w].key;
      var s = widgets[w].state;
      extractTitle(key, s, result);
      extractImages(key, s, result);
      extractPrice(key, s, result);
      extractDescription(key, s, result);
      extractBreadcrumbs(key, s, result);
      extractCharacteristics(key, s, result);
    }

    if (!result.title) {
      result.ok = false;
      result.error = 'title not found (product may not exist)';
    }
    if (!result.currency) {
      var host = typeof location !== 'undefined' ? location.hostname : '';
      result.currency = fallbackCurrencyByHost(host);
    }

    for (var a = 0; a < result.attributes.length; a++) {
      var attr = result.attributes[a];
      if (!result.brand && /бренд|brand|品牌|Бренд/i.test(attr.name)) {
        result.brand = attr.value;
      }
    }

    return result;
  }

  function extractTitle(key, s, r) {
    if (r.title) return;
    if (/^(webProductHeading|webStickyProducts)/.test(key) && s && typeof s.title === 'string') {
      r.title = s.title;
    }
    if (!r.title && /^webProduct/.test(key) && s && typeof s.name === 'string') {
      r.title = s.name;
    }
  }

  function extractImages(key, s, r) {
    if (r.images.length) return;
    if (!/^(webGallery|webProductGallery|gallery)/.test(key)) return;
    if (!s) return;
    var sources = s.images || s.coverImage || s.gallery || s.photos;
    if (!Array.isArray(sources)) return;
    for (var i = 0; i < sources.length; i++) {
      var img = sources[i];
      var url = typeof img === 'string' ? img : (img && (img.src || img.url || img.originalUrl));
      if (typeof url === 'string' && url.indexOf('http') === 0) {
        r.images.push(url);
      }
    }
  }

  function extractPrice(key, s, r) {
    if (r.price) return;
    if (!/^(webPrice|webSale|price)/.test(key)) return;
    if (!s) return;
    var priceCurrency = globalThis.SS_ERP_PRICE_CURRENCY || {};
    var parsePriceWithCurrency = priceCurrency.parsePriceWithCurrency || function (text, fallback) {
      return { price: normalizePrice(text), currency: fallback || null };
    };
    var detectCurrencyFromText = priceCurrency.detectCurrencyFromText || function (text, fallback) {
      var raw = text == null ? '' : String(text);
      if (raw.indexOf('¥') >= 0 || raw.indexOf('￥') >= 0 || /\b(?:CNY|RMB)\b/i.test(raw)) return 'CNY';
      if (raw.indexOf('₽') >= 0 || /\bRUB\b/i.test(raw)) return 'RUB';
      if (raw.indexOf('₸') >= 0 || /\bKZT\b/i.test(raw)) return 'KZT';
      if (/\bBYN\b/i.test(raw)) return 'BYN';
      return fallback || null;
    };
    var raw = s.cardPrice || s.price || s.finalPrice || s.tradePrice;
    var rawOld = s.originalPrice || s.priceWithoutDiscount || s.oldPrice;
    if (typeof raw === 'string') {
      var parsed = parsePriceWithCurrency(raw, r.currency || s.currency);
      r.price = parsed.price;
      r.currency = parsed.currency || r.currency;
    }
    if (typeof rawOld === 'string') {
      var parsedOld = parsePriceWithCurrency(rawOld, r.currency || s.currency);
      r.oldPrice = parsedOld.price;
      r.currency = r.currency || parsedOld.currency;
    }
    r.currency = detectCurrencyFromText(s.disclaimerPriceHeader, r.currency || s.currency);
    if (Array.isArray(s.disclaimerPriceBodyRs)) {
      for (var i = 0; i < s.disclaimerPriceBodyRs.length; i++) {
        r.currency = detectCurrencyFromText(s.disclaimerPriceBodyRs[i] && s.disclaimerPriceBodyRs[i].content, r.currency);
      }
    }
    if (typeof s.currencySign === 'string' && !r.currency) {
      r.currency = detectCurrencyFromText(s.currencySign, null);
    }
  }

  function extractDescription(key, s, r) {
    if (r.description) return;
    if (!/^(webDescription|webRichAnnotation|description)/.test(key)) return;
    if (!s) return;
    if (typeof s.richAnnotation === 'string') r.description = s.richAnnotation;
    else if (typeof s.description === 'string') r.description = s.description;
    else if (typeof s.text === 'string') r.description = s.text;
  }

  function extractBreadcrumbs(key, s, r) {
    if (r.category) return;
    if (!/^breadCrumbs/.test(key)) return;
    if (!s || !Array.isArray(s.breadcrumbs)) return;
    var last = s.breadcrumbs[s.breadcrumbs.length - 1];
    if (last && last.text) r.category = String(last.text);
  }

  function extractCharacteristics(key, s, r) {
    if (!/^(webShortCharacteristics|webCharacteristics|characteristics)/.test(key)) return;
    if (!s) return;
    var groups = s.characteristics || s.short || s.groups;
    if (!Array.isArray(groups)) {
      if (Array.isArray(s.short)) groups = [{ short: s.short }];
      else return;
    }
    for (var g = 0; g < groups.length; g++) {
      var items = groups[g].short || groups[g].items || groups[g].characteristics;
      if (!Array.isArray(items)) continue;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var name = item.name || item.title || item.key;
        var value = '';
        if (Array.isArray(item.values)) {
          var parts = [];
          for (var v = 0; v < item.values.length; v++) {
            var val = item.values[v];
            parts.push(val.text || val.value || String(val));
          }
          value = parts.filter(Boolean).join(', ');
        } else if (item.value) {
          value = String(item.value);
        }
        if (name && value) r.attributes.push({ name: String(name), value: value });
      }
    }
  }

  function normalizePrice(raw) {
    return raw.replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.');
  }

  function fetchOzonProductBatch(productIds, onProgress) {
    var results = [];
    var index = 0;
    function next() {
      if (index >= productIds.length) return Promise.resolve(results);
      var pid = productIds[index];
      index++;
      return fetchOzonProduct(pid)
        .catch(function (err) {
          return { ok: false, productId: pid, error: err.message || String(err) };
        })
        .then(function (r) {
          results.push(r);
          if (typeof onProgress === 'function') {
            onProgress({ done: index, total: productIds.length, current: r });
          }
          if (index < productIds.length) {
            return new Promise(function (resolve) { setTimeout(resolve, FETCH_DELAY_MS); }).then(next);
          }
          return results;
        });
    }
    return next();
  }

  globalThis.OZON_PUBLIC_FETCHER = {
    fetchOzonProduct: fetchOzonProduct,
    fetchOzonProductBatch: fetchOzonProductBatch,
    parseWidgetStates: parseWidgetStates
  };
}());
