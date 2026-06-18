(function () {
  if (window.__SS_ERP_COLLECT_BRIDGE_BOOTSTRAPPED__) return;
  window.__SS_ERP_COLLECT_BRIDGE_BOOTSTRAPPED__ = true;

  var DIRECTION_TO_EXT = 'ss-erp:to-extension';
  var DIRECTION_FROM_EXT = 'ss-erp:from-extension';
  var ACTIVATION_TIMEOUT_MS = 15000;

  function isKnownLegacyErpOrigin() {
    var hostname = window.location.hostname;
    return (
      window.location.protocol === 'file:' ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === 'staging.ss-erp.com' ||
      hostname === 'ss-erp.com' ||
      hostname.endsWith('.ss-erp.com')
    );
  }

  function hasErpMarker() {
    var root = document.documentElement;
    if (root && root.getAttribute('data-ss-erp-app') === 'true') return true;
    var meta = document.querySelector('meta[name="ss-erp-app"]');
    return !!(meta && meta.getAttribute('content') === 'true');
  }

  function shouldActivate() {
    return hasErpMarker() || isKnownLegacyErpOrigin();
  }

  function activateBridge() {
    if (window.__SS_ERP_COLLECT_BRIDGE__) return;
    window.__SS_ERP_COLLECT_BRIDGE__ = true;

    window.addEventListener('message', function (event) {
      if (event.source !== window) return;
      if (!event.data || event.data.direction !== DIRECTION_TO_EXT) return;

      var requestId = event.data.requestId;
      var message = event.data.message;
      if (!message || !message.type) return;

      chrome.runtime.sendMessage(message, function (response) {
        var lastError = chrome.runtime.lastError;
        var safeResponse = response || { ok: false, error: 'no response' };
        if (lastError) {
          safeResponse = {
            ok: false,
            error: lastError.message || String(lastError),
          };
        }
        window.postMessage({
          direction: DIRECTION_FROM_EXT,
          requestId: requestId,
          response: safeResponse
        }, '*');
      });
    });

    // 接收 background 主动推的事件（如 popup/侧栏触发的采集完成通知），转发到 ERP 页面
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || !msg.type) return;
      if (msg.type === 'ss-erp:collect-completed') {
        window.postMessage({
          direction: DIRECTION_FROM_EXT,
          broadcast: true,
          event: msg,
        }, '*');
      }
    });

    document.documentElement.setAttribute('data-ss-erp-bridge', 'ready');
  }

  if (shouldActivate()) {
    activateBridge();
    return;
  }

  var observer = new MutationObserver(function () {
    if (!shouldActivate()) return;
    observer.disconnect();
    activateBridge();
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ss-erp-app'],
    childList: true,
    subtree: true,
  });

  setTimeout(function () {
    observer.disconnect();
  }, ACTIVATION_TIMEOUT_MS);
}());
