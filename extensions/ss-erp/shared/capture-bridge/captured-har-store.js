(function (root) {
  var SUPPORTED_ENDPOINTS = [
    { mode: 'seller', source: 'seller-page-capture', keyword: '/provider/template/by-location/list' },
    { mode: 'seller', source: 'seller-page-capture', keyword: '/provider/template/category/list' },
    { mode: 'seller', source: 'seller-page-capture', keyword: '/provider/template/speed/list' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/product/list' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/product/info' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/product/price/list' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/product/stock/list' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/product/stocks' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/offer/list' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/offer/price' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/inventory' },
    { mode: 'seller-products', source: 'seller-products-capture', keyword: '/api/warehouse/stock' },
    { mode: 'official', source: 'official-page-capture', keyword: '/v1/provider/' },
    { mode: 'official', source: 'official-page-capture', keyword: '/v1/calculator/calculate' },
    { mode: 'official', source: 'official-page-capture', keyword: '/calculator/calculate' },
  ];

  var SENSITIVE_KEYWORDS = [
    '/auth',
    '/login',
    '/logout',
    '/session',
    '/profile',
    '/user',
    '/passport',
    '/oauth',
    '/token',
    '/settings/account',
  ];

  function toText(value) {
    return value == null ? '' : String(value);
  }

  var LEGACY_META_KEY = '_' + String.fromCharCode(113, 101, 104, 101, 108, 112);

  function captureMeta(entry) {
    return entry && (entry._ozonCalc || entry[LEGACY_META_KEY]) || {};
  }

  function safeIsoDate(value) {
    var text = toText(value).trim();
    if (text) {
      var parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  }

  function detectSupportedEndpoint(url) {
    var text = toText(url);
    var lower = text.toLowerCase();
    for (var sensitiveIndex = 0; sensitiveIndex < SENSITIVE_KEYWORDS.length; sensitiveIndex += 1) {
      if (lower.indexOf(SENSITIVE_KEYWORDS[sensitiveIndex]) >= 0) return null;
    }
    for (var index = 0; index < SUPPORTED_ENDPOINTS.length; index += 1) {
      if (text.indexOf(SUPPORTED_ENDPOINTS[index].keyword) >= 0) return SUPPORTED_ENDPOINTS[index];
    }
    return null;
  }

  function normalizePostData(rawPostData) {
    if (rawPostData == null) return undefined;
    if (typeof rawPostData === 'string') return { text: rawPostData };
    if (typeof rawPostData === 'object' && rawPostData.text != null) {
      return { text: toText(rawPostData.text) };
    }
    try {
      return { text: JSON.stringify(rawPostData) };
    } catch (error) {
      return { text: toText(rawPostData) };
    }
  }

  function normalizeResponseContent(rawContent) {
    if (rawContent == null) {
      return {
        mimeType: 'application/json',
        text: '',
      };
    }
    if (typeof rawContent === 'string') {
      return {
        mimeType: 'application/json',
        text: rawContent,
      };
    }
    return {
      mimeType: toText(rawContent.mimeType).trim() || 'application/json',
      text: rawContent.text == null ? '' : toText(rawContent.text),
    };
  }

  function normalizeCapturedEntry(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var rawRequest = raw.request && typeof raw.request === 'object' ? raw.request : {};
    var rawResponse = raw.response && typeof raw.response === 'object' ? raw.response : {};
    var url = toText(rawRequest.url).trim();
    var endpoint = detectSupportedEndpoint(url);
    if (!endpoint) return null;

    var request = {
      method: toText(rawRequest.method).trim().toUpperCase() || 'GET',
      url: url,
    };
    var postData = normalizePostData(rawRequest.postData);
    if (postData) request.postData = postData;

    return {
      startedDateTime: safeIsoDate(raw.startedDateTime || raw.capturedAt),
      request: request,
      response: {
        status: Number(rawResponse.status) || 0,
        content: normalizeResponseContent(rawResponse.content),
      },
      _ozonCalc: {
        mode: endpoint.mode,
        source: endpoint.source,
        pageUrl: toText(raw.pageUrl),
        capturedAt: safeIsoDate(raw.capturedAt || raw.startedDateTime),
      },
    };
  }

  function entryKey(entry) {
    return JSON.stringify({
      mode: captureMeta(entry).mode,
      startedDateTime: entry && entry.startedDateTime,
      method: entry && entry.request && entry.request.method,
      url: entry && entry.request && entry.request.url,
      requestText: entry && entry.request && entry.request.postData && entry.request.postData.text,
      responseText: entry && entry.response && entry.response.content && entry.response.content.text,
    });
  }

  function appendCapturedEntry(existingEntries, rawEntry, limit) {
    var normalized = normalizeCapturedEntry(rawEntry);
    var entries = Array.isArray(existingEntries) ? existingEntries.slice() : [];
    if (!normalized) return entries;

    var nextKey = entryKey(normalized);
    entries = entries.filter(function (entry) {
      return entryKey(entry) !== nextKey;
    });
    entries.push(normalized);

    var maxEntries = Math.max(1, Number(limit) || 200);
    if (entries.length > maxEntries) {
      entries = entries.slice(entries.length - maxEntries);
    }
    return entries;
  }

  function buildHarPayload(entries, mode) {
    var normalizedMode = toText(mode).trim().toLowerCase();
    var filtered = (Array.isArray(entries) ? entries : []).filter(function (entry) {
      if (!normalizedMode || normalizedMode === 'all') return true;
      if (normalizedMode === 'seller') {
        var sellerMeta = captureMeta(entry);
        return sellerMeta.mode === 'seller' || sellerMeta.mode === 'seller-products';
      }
      return captureMeta(entry).mode === normalizedMode;
    });
    return {
      log: {
        version: '1.2',
        creator: {
          name: 'ozon-calc',
          version: '0.1.0',
        },
        entries: filtered,
      },
    };
  }

  var api = {
    SUPPORTED_ENDPOINTS: SUPPORTED_ENDPOINTS,
    detectSupportedEndpoint: detectSupportedEndpoint,
    normalizeCapturedEntry: normalizeCapturedEntry,
    appendCapturedEntry: appendCapturedEntry,
    buildHarPayload: buildHarPayload,
  };
  root.OZON_CALC_CAPTURE_STORE = api;
  if (root.window && root.window !== root) {
    root.window.OZON_CALC_CAPTURE_STORE = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : window));
