(function () {
  'use strict';

  var COMPOSER_PATH = '/api/composer-api.bx/page/json/v2';
  var FETCH_DELAY_MS = 800;

  function fetchOzonProduct(productId, options) {
    options = options || {};
    // 强制俄语：把 language=ru 放到内嵌 url 的 query 里，避免被中文 cookie 覆盖
    var productPath = normalizeOzonProductPathForFetch(options.sourceUrl || options.productPath, productId);
    var url = COMPOSER_PATH + '?url=' + encodeURIComponent(productPath);
    return fetchOzonJson(url)
    .then(function (data) {
      var result = parseWidgetStates(productId, data);
      return fetchOzonDescriptionPage(productId, productPath)
        .then(function (descriptionData) {
          if (descriptionData) mergeDescriptionWidgetStates(result, descriptionData);
          return result;
        })
        .catch(function () {
          return result;
        });
    });
  }

  function fetchOzonJson(url) {
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
    });
  }

  function fetchOzonDescriptionPage(productId, productPath) {
    var paths = buildDescriptionFetchPaths(productId, productPath);
    var index = 0;
    function next() {
      if (index >= paths.length) return Promise.resolve(null);
      var path = paths[index++];
      var url = '/api/entrypoint-api.bx/page/json/v2?url=' + encodeURIComponent(path);
      return fetchOzonJson(url)
        .catch(function () { return null; })
        .then(function (data) {
          if (hasDescriptionWidgetStates(data)) return data;
          return next();
        });
    }
    return next();
  }

  function normalizeOzonProductPathForFetch(value, fallbackProductId) {
    var path = '';
    var raw = String(value || '').trim();
    if (raw) {
      try {
        var url = new URL(raw, 'https://www.ozon.ru');
        if (/^\/product\//i.test(url.pathname)) path = url.pathname + url.search;
      } catch (e) {}
    }
    if (!path) path = '/product/' + fallbackProductId + '/';
    try {
      var parsed = new URL(path, 'https://www.ozon.ru');
      parsed.searchParams.set('language', 'ru');
      return parsed.pathname + parsed.search;
    } catch (e) {
      return path.indexOf('?') >= 0 ? path + '&language=ru' : path + '?language=ru';
    }
  }

  function buildDescriptionFetchPaths(productId, productPath) {
    var bases = [];
    function addBase(path) {
      path = String(path || '').split('?')[0];
      if (!path || !/^\/product\//i.test(path)) return;
      if (!/\/$/.test(path)) path += '/';
      if (bases.indexOf(path) < 0) bases.push(path);
    }
    addBase(productPath);
    addBase('/product/' + productId + '/');
    return bases.map(function (base) {
      return base + '?layout_container=pdpPage2column&layout_page_index=2&oos_search=false&language=ru';
    });
  }

  function hasDescriptionWidgetStates(data) {
    var states = data && data.widgetStates;
    if (!states || typeof states !== 'object') return false;
    return Object.keys(states).some(function (key) {
      return /^(webDescription|webRichAnnotation|description)/.test(key);
    });
  }

  function mergeDescriptionWidgetStates(result, data) {
    var states = data && data.widgetStates;
    if (!result || !states || typeof states !== 'object') return result;
    var keys = Object.keys(states);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var state;
      try { state = JSON.parse(states[key]); } catch (e) { continue; }
      extractDescription(key, state, result);
      extractVideos(key, state, result);
      extractCharacteristics(key, state, result);
    }
    return result;
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
      richDescriptionJson: null,
      sourceVideos: [],
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
      extractVideos(key, s, result);
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
    if (!/^(webDescription|webRichAnnotation|description)/.test(key)) return;
    if (!s) return;
    var payload = extractDescriptionPayload(s);
    if (payload.text && (!r.description || payload.text.length > r.description.length)) {
      r.description = payload.text.slice(0, 5000);
    }
    if (!r.richDescriptionJson && payload.richJson) {
      try {
        r.richDescriptionJson = JSON.stringify(payload.richJson).slice(0, 30000);
      } catch (e) {}
    }
  }

  function isStructuredRichValue(value, depth) {
    if (value == null || depth > 5) return false;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        if (isStructuredRichValue(value[i], depth + 1)) return true;
      }
      return false;
    }
    if (typeof value !== 'object') return false;
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (/^(?:richannotationjson|richannotation|content|blocks|children|items|nodes|widgets|gallery|img|image|picture|text|description|title)$/i.test(key)) {
        return true;
      }
      if (isStructuredRichValue(value[key], depth + 1)) return true;
    }
    return false;
  }

  function pickRichJsonCandidate(state) {
    var objectCandidates = [
      { key: 'richAnnotationJson', value: state && state.richAnnotationJson },
      { key: 'richAnnotation', value: state && state.richAnnotation },
      { key: 'content', value: state && state.content },
      { key: 'description', value: state && state.description },
      { key: 'blocks', value: state && state.blocks },
      { key: 'items', value: state && state.items },
      { key: 'children', value: state && state.children },
      { key: 'nodes', value: state && state.nodes },
      { key: 'widgets', value: state && state.widgets }
    ];
    for (var i = 0; i < objectCandidates.length; i++) {
      var entry = objectCandidates[i];
      var candidate = entry.value;
      if ((candidate && typeof candidate === 'object') || Array.isArray(candidate)) {
        if (!isStructuredRichValue(candidate, 0)) continue;
        if (entry.key === 'richAnnotationJson' || entry.key === 'richAnnotation') return candidate;
        if (Array.isArray(candidate)) {
          var wrapped = {};
          wrapped[entry.key] = candidate;
          return wrapped;
        }
        return candidate;
      }
    }
    return null;
  }

  function extractDescriptionPayload(state) {
    var richJson = pickRichJsonCandidate(state);
    var candidates = [state.richAnnotation, state.description, state.text, state.content, state.blocks, richJson];
    var text = '';
    for (var i = 0; i < candidates.length; i++) {
      var next = extractTextFromRichValue(candidates[i]);
      if (next && next.length > text.length) text = next;
    }
    return { text: text, richJson: richJson };
  }

  function extractVideos(key, s, r) {
    if (!s || typeof s !== 'object') return;
    if (!/(video|видео|gallery|media|rich)/i.test(key)) return;
    var found = collectVideoEntries(s);
    for (var i = 0; i < found.length; i++) {
      addSourceVideo(r.sourceVideos, found[i]);
    }
  }

  function collectVideoEntries(value) {
    var entries = [];
    visitVideoValue(value, entries, [], 0);
    return entries;
  }

  function visitVideoValue(value, entries, seen, depth) {
    if (value == null || depth > 8 || entries.length >= 10) return;
    if (typeof value !== 'object') return;
    if (seen.indexOf(value) >= 0) return;
    seen.push(value);

    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) visitVideoValue(value[i], entries, seen, depth + 1);
      return;
    }

    var videoUrl = pickVideoUrl(value);
    if (videoUrl) {
      entries.push({
        url: videoUrl,
        coverUrl: pickCoverUrl(value),
        title: pickVideoTitle(value)
      });
    }

    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      visitVideoValue(value[keys[k]], entries, seen, depth + 1);
    }
  }

  function pickVideoUrl(obj) {
    var fields = ['videoUrl', 'videoURL', 'video', 'mp4', 'hls', 'src', 'url', 'link'];
    for (var i = 0; i < fields.length; i++) {
      var raw = obj && obj[fields[i]];
      if (typeof raw === 'string' && isVideoUrl(raw)) return raw.trim();
    }
    return '';
  }

  function pickCoverUrl(obj) {
    var fields = ['coverUrl', 'coverURL', 'coverImage', 'cover', 'poster', 'preview', 'thumbnail', 'image', 'src'];
    for (var i = 0; i < fields.length; i++) {
      var raw = obj && obj[fields[i]];
      if (typeof raw === 'string' && isHttpUrl(raw) && !isVideoUrl(raw)) return raw.trim();
    }
    return '';
  }

  function pickVideoTitle(obj) {
    var raw = obj && (obj.title || obj.name || obj.caption);
    return typeof raw === 'string' ? normalizeText(raw).slice(0, 200) : '';
  }

  function addSourceVideo(target, entry) {
    if (!entry || !entry.url || !isHttpUrl(entry.url)) return;
    for (var i = 0; i < target.length; i++) {
      if (target[i].url === entry.url) return;
    }
    var next = { url: entry.url };
    if (entry.coverUrl && isHttpUrl(entry.coverUrl)) next.coverUrl = entry.coverUrl;
    if (entry.title) next.title = entry.title;
    target.push(next);
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function isVideoUrl(value) {
    var text = String(value || '').trim();
    return isHttpUrl(text) && (/\.(?:mp4|m3u8|webm|mov)(?:[?#].*)?$/i.test(text) || /(?:stream|playlist)/i.test(text));
  }

  function extractTextFromRichValue(value) {
    var parts = [];
    visitRichValue(value, parts, [], 0);
    return normalizeText(parts.join('\n')).slice(0, 5000);
  }

  function visitRichValue(value, parts, seen, depth) {
    if (value == null || depth > 8) return;
    if (typeof value === 'string') {
      var text = normalizeText(value);
      if (text) parts.push(text);
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.indexOf(value) >= 0) return;
    seen.push(value);
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) visitRichValue(value[i], parts, seen, depth + 1);
      return;
    }
    var preferredKeys = ['content', 'text', 'value', 'title', 'description', 'children', 'items', 'blocks', 'nodes'];
    for (var k = 0; k < preferredKeys.length; k++) {
      var key = preferredKeys[k];
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        visitRichValue(value[key], parts, seen, depth + 1);
      }
    }
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

  function normalizeText(value) {
    return String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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
