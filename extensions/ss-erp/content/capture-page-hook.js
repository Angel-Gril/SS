(function () {
  if (window.__OZON_CALC_PAGE_NETWORK_HOOK__) return;
  window.__OZON_CALC_PAGE_NETWORK_HOOK__ = true;

  var PAGE_MESSAGE_SOURCE = 'ozon-calc:page-network-capture';
  var SUPPORTED_KEYWORDS = [
    '/provider/template/by-location/list',
    '/provider/template/category/list',
    '/provider/template/speed/list',
    '/api/product/list',
    '/api/product/info',
    '/api/product/price/list',
    '/api/product/stock/list',
    '/api/product/stocks',
    '/api/offer/list',
    '/api/offer/price',
    '/api/inventory',
    '/api/warehouse/stock',
    '/v1/provider/',
    '/v1/calculator/calculate',
    '/calculator/calculate',
  ];
  var VIDEO_UPLOAD_KEYWORDS = [
    'video',
    'media',
    'upload',
    'asset',
    'file',
    'transcode',
    'multimedia',
  ];
  var SAFE_HEADER_NAMES = [
    'accept',
    'content-type',
    'origin',
    'referer',
    'x-o3-app-name',
    'x-o3-company-id',
    'x-o3-language',
    'x-o3-page-type',
    'x-o3-platform',
    'x-request-id',
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

  function isSupportedUrl(url) {
    var text = toText(url);
    var lower = text.toLowerCase();
    if (isSensitiveUrl(lower)) return false;
    for (var index = 0; index < SUPPORTED_KEYWORDS.length; index += 1) {
      if (text.indexOf(SUPPORTED_KEYWORDS[index]) >= 0) return true;
    }
    if (isVideoUploadUrl(lower)) return true;
    return false;
  }

  function isVideoUploadUrl(lowerUrl) {
    var lower = toText(lowerUrl).toLowerCase();
    if (lower.indexOf('seller.ozon.ru') < 0 && lower.indexOf('.seller.ozon.ru') < 0 && lower.indexOf('.ozon.ru') < 0) return false;
    var matched = 0;
    for (var i = 0; i < VIDEO_UPLOAD_KEYWORDS.length; i += 1) {
      if (lower.indexOf(VIDEO_UPLOAD_KEYWORDS[i]) >= 0) matched += 1;
    }
    return matched >= 2;
  }

  function isSensitiveUrl(lowerUrl) {
    var lower = toText(lowerUrl).toLowerCase();
    for (var sensitiveIndex = 0; sensitiveIndex < SENSITIVE_KEYWORDS.length; sensitiveIndex += 1) {
      if (lower.indexOf(SENSITIVE_KEYWORDS[sensitiveIndex]) >= 0) return true;
    }
    return false;
  }

  function isUploadMethod(method) {
    var normalized = toText(method).trim().toUpperCase();
    return normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH';
  }

  function isBinaryBody(body) {
    if (body == null) return false;
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var hasBinary = false;
      body.forEach(function (value) {
        if (typeof value !== 'string') hasBinary = true;
      });
      return hasBinary;
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
    if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(body)) return true;
    return false;
  }

  function isPotentialVideoUploadRequest(url, method, body) {
    var lower = toText(url).toLowerCase();
    if (!isUploadMethod(method) || isSensitiveUrl(lower)) return false;
    if (isVideoUploadUrl(lower)) return true;
    if (isBinaryBody(body)) return true;
    return bodyToText(body).toLowerCase().indexOf('[binary') >= 0;
  }

  function isMediaEditPage(pageUrl) {
    var text = toText(pageUrl).toLowerCase();
    return text.indexOf('seller.ozon.ru/app/products/') >= 0 && text.indexOf('/edit/media') >= 0;
  }

  function isMediaEditMutationRequest(pageUrl, url, method) {
    var lower = toText(url).toLowerCase();
    if (!isMediaEditPage(pageUrl) || !isUploadMethod(method) || isSensitiveUrl(lower)) return false;
    return lower.indexOf('seller.ozon.ru') >= 0 || lower.indexOf('.seller.ozon.ru') >= 0 || lower.indexOf('/api/') === 0;
  }

  function redactUrlForCapture(url) {
    var text = toText(url).trim();
    if (!text || text.indexOf('?') < 0) return text;
    try {
      var isRelative = text.charAt(0) === '/';
      var parsed = new URL(text, isRelative ? 'https://seller.ozon.ru' : undefined);
      parsed.searchParams.forEach(function (_value, key) {
        parsed.searchParams.set(key, '[redacted]');
      });
      return isRelative
        ? parsed.pathname + parsed.search + parsed.hash
        : parsed.toString();
    } catch (error) {
      return text.replace(/([?&][^=&#]+)=([^&#]*)/g, '$1=[redacted]');
    }
  }

  function bodyToText(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var values = {};
      body.forEach(function (value, key) {
        values[key] = typeof value === 'string' ? value : '[binary]';
      });
      return JSON.stringify(values);
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      return '[binary:' + (body.type || 'application/octet-stream') + ':' + body.size + ']';
    }
    try {
      return JSON.stringify(body);
    } catch (error) {
      return toText(body);
    }
  }

  function postCapturedEntry(entry) {
    try {
      window.postMessage({
        source: PAGE_MESSAGE_SOURCE,
        type: 'network-entry',
        payload: entry,
      }, '*');
    } catch (error) {}
  }

  function postCompanyId(companyId) {
    var value = toText(companyId).trim();
    if (!value) return;
    try {
      window.postMessage({ source: PAGE_MESSAGE_SOURCE, type: 'ozon-company-id', payload: value }, '*');
    } catch (error) {}
  }

  function readHeader(headers, name) {
    var target = toText(name).toLowerCase();
    if (!headers) return '';
    try {
      if (typeof headers.get === 'function') return headers.get(name) || headers.get(target) || '';
      if (Array.isArray(headers)) {
        for (var i = 0; i < headers.length; i += 1) {
          var pair = headers[i] || [];
          if (toText(pair[0]).toLowerCase() === target) return pair[1] || '';
        }
        return '';
      }
      if (typeof headers === 'object') {
        var keys = Object.keys(headers);
        for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          var key = keys[keyIndex];
          if (toText(key).toLowerCase() === target) return headers[key] || '';
        }
      }
    } catch (error) {}
    return '';
  }

  function isSafeHeaderName(name) {
    var lower = toText(name).toLowerCase();
    for (var i = 0; i < SAFE_HEADER_NAMES.length; i += 1) {
      if (lower === SAFE_HEADER_NAMES[i]) return true;
    }
    return false;
  }

  function headersToSafeList(headers) {
    var out = [];
    function add(name, value) {
      var headerName = toText(name).toLowerCase();
      if (!headerName || !isSafeHeaderName(headerName)) return;
      out.push({ name: headerName, value: toText(value).slice(0, 500) });
    }
    try {
      if (!headers) return out;
      if (typeof headers.forEach === 'function') {
        headers.forEach(function (value, name) { add(name, value); });
        return out;
      }
      if (Array.isArray(headers)) {
        headers.forEach(function (pair) {
          pair = pair || [];
          add(pair[0], pair[1]);
        });
        return out;
      }
      if (typeof headers === 'object') {
        Object.keys(headers).forEach(function (name) { add(name, headers[name]); });
      }
    } catch (error) {}
    return out;
  }

  if (typeof window.fetch === 'function') {
    var originalFetch = window.fetch;
    window.fetch = function () {
      var args = Array.prototype.slice.call(arguments);
      var input = args[0];
      var init = args[1] || {};
      var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      var method = init.method || (input && input.method) || 'GET';
      var requestBody = init.body != null ? init.body : (input && input.body);
      var startedDateTime = new Date().toISOString();

      // 自动提取 x-o3-company-id
      try {
        var headers = init.headers || (input && input.headers);
        postCompanyId(readHeader(headers, 'x-o3-company-id'));
      } catch (e) {}

      return originalFetch.apply(this, arguments).then(function (response) {
        if (
          !isSupportedUrl(url)
          && !isPotentialVideoUploadRequest(url, method, requestBody)
          && !isMediaEditMutationRequest(window.location.href, response.url || url, method)
        ) return response;
        try {
          var responseClone = response.clone();
          responseClone.text().then(function (text) {
            postCapturedEntry({
              pageUrl: window.location.href,
              startedDateTime: startedDateTime,
              capturedAt: new Date().toISOString(),
              request: {
                method: toText(method).toUpperCase(),
                url: redactUrlForCapture(response.url || url),
                headers: headersToSafeList(init.headers || (input && input.headers)),
                postData: { text: bodyToText(requestBody) },
              },
              response: {
                status: response.status,
                headers: headersToSafeList(response.headers),
                content: {
                  mimeType: response.headers && response.headers.get ? (response.headers.get('content-type') || 'application/json') : 'application/json',
                  text: text,
                },
              },
            });
          }).catch(function () {});
        } catch (error) {}
        return response;
      });
    };
  }

  if (typeof window.XMLHttpRequest === 'function') {
    var OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      var xhr = new OriginalXHR();
      var request = {
        method: 'GET',
        url: '',
        postData: { text: '' },
        startedDateTime: '',
      };
      var originalOpen = xhr.open;
      var originalSetRequestHeader = xhr.setRequestHeader;
      var originalSend = xhr.send;
      var requestHeaders = [];

      xhr.open = function (method, url) {
        request.method = toText(method).toUpperCase() || 'GET';
        request.url = toText(url);
        return originalOpen.apply(xhr, arguments);
      };

      xhr.setRequestHeader = function (name, value) {
        if (toText(name).toLowerCase() === 'x-o3-company-id') {
          postCompanyId(value);
        }
        if (isSafeHeaderName(name)) {
          requestHeaders.push({ name: toText(name).toLowerCase(), value: toText(value).slice(0, 500) });
        }
        return originalSetRequestHeader.apply(xhr, arguments);
      };

      xhr.send = function (body) {
        request.postData = { text: bodyToText(body) };
        request.startedDateTime = new Date().toISOString();
        xhr.addEventListener('loadend', function () {
          if (
            !isSupportedUrl(request.url)
            && !isPotentialVideoUploadRequest(request.url, request.method, body)
            && !isMediaEditMutationRequest(window.location.href, request.url, request.method)
          ) return;
          var responseText = '';
          try {
            responseText = toText(xhr.responseText);
          } catch (error) {
            return;
          }
          postCapturedEntry({
            pageUrl: window.location.href,
            startedDateTime: request.startedDateTime,
            capturedAt: new Date().toISOString(),
            request: {
              method: request.method,
              url: redactUrlForCapture(request.url),
              headers: requestHeaders,
              postData: request.postData,
            },
            response: {
              status: xhr.status,
              headers: headersToSafeList({ 'content-type': xhr.getResponseHeader && xhr.getResponseHeader('content-type') || '' }),
              content: {
                mimeType: xhr.getResponseHeader && xhr.getResponseHeader('content-type') || 'application/json',
                text: responseText,
              },
            },
          });
        });
        return originalSend.apply(xhr, arguments);
      };

      return xhr;
    };
  }
}());
