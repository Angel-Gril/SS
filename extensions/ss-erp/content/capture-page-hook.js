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
    for (var sensitiveIndex = 0; sensitiveIndex < SENSITIVE_KEYWORDS.length; sensitiveIndex += 1) {
      if (lower.indexOf(SENSITIVE_KEYWORDS[sensitiveIndex]) >= 0) return false;
    }
    for (var index = 0; index < SUPPORTED_KEYWORDS.length; index += 1) {
      if (text.indexOf(SUPPORTED_KEYWORDS[index]) >= 0) return true;
    }
    return false;
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
        var companyId = null;
        if (headers) {
          if (typeof headers.get === 'function') {
            companyId = headers.get('x-o3-company-id');
          } else if (typeof headers === 'object') {
            companyId = headers['x-o3-company-id'] || headers['X-O3-Company-Id'];
          }
        }
        if (companyId) {
          window.postMessage({ source: PAGE_MESSAGE_SOURCE, type: 'ozon-company-id', payload: String(companyId) }, '*');
        }
      } catch (e) {}

      return originalFetch.apply(this, arguments).then(function (response) {
        if (!isSupportedUrl(url)) return response;
        try {
          var responseClone = response.clone();
          responseClone.text().then(function (text) {
            postCapturedEntry({
              pageUrl: window.location.href,
              startedDateTime: startedDateTime,
              capturedAt: new Date().toISOString(),
              request: {
                method: toText(method).toUpperCase(),
                url: response.url || url,
                postData: { text: bodyToText(requestBody) },
              },
              response: {
                status: response.status,
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
      var originalSend = xhr.send;

      xhr.open = function (method, url) {
        request.method = toText(method).toUpperCase() || 'GET';
        request.url = toText(url);
        return originalOpen.apply(xhr, arguments);
      };

      xhr.send = function (body) {
        request.postData = { text: bodyToText(body) };
        request.startedDateTime = new Date().toISOString();
        xhr.addEventListener('loadend', function () {
          if (!isSupportedUrl(request.url)) return;
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
              url: request.url,
              postData: request.postData,
            },
            response: {
              status: xhr.status,
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
