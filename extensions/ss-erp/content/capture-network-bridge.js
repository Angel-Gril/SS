(function () {
  if (window.__OZON_CALC_CAPTURE_NETWORK_BRIDGE__) return;
  window.__OZON_CALC_CAPTURE_NETWORK_BRIDGE__ = true;

  var PAGE_MESSAGE_SOURCE = 'ozon-calc:page-network-capture';

  function isCaptureHost() {
    var hostname = String(window.location && window.location.hostname || '').toLowerCase();
    return hostname === 'seller.ozon.ru' || hostname === 'globalcalculator.ozon.ru';
  }

  if (!isCaptureHost()) return;

  function forwardCapturedEntry(payload) {
    if (!payload || !payload.request || !payload.request.url) return;
    chrome.runtime.sendMessage({
      type: 'ozon-calc:capture-har-entry',
      payload: payload,
    }, function () {
      if (chrome.runtime.lastError) {
        console.warn('[ozon-calc] capture forward failed', chrome.runtime.lastError.message);
      }
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data || {};
    if (data.source !== PAGE_MESSAGE_SOURCE) return;
    if (data.type === 'network-entry') {
      forwardCapturedEntry(data.payload);
    }
    if (data.type === 'ozon-company-id' && data.payload) {
      chrome.storage.local.set({
        'ss_erp_ozon_company_id': String(data.payload),
        'ss_erp_ozon_company_id_captured_at': Date.now()
      });
    }
  });

  function injectPageHook() {
    var script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/capture-page-hook.js');
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  injectPageHook();
}());
