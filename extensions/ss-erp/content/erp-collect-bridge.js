(function () {
  if (window.__SS_ERP_COLLECT_BRIDGE_BOOTSTRAPPED__) return;
  window.__SS_ERP_COLLECT_BRIDGE_BOOTSTRAPPED__ = true;

  var DIRECTION_TO_EXT = 'ss-erp:to-extension';
  var DIRECTION_FROM_EXT = 'ss-erp:from-extension';

  function isKnownLegacyErpOrigin() {
    var hostname = window.location.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === 'staging.ss-erp.com' ||
      hostname === 'ss-erp.com' ||
      hostname.endsWith('.ss-erp.com') ||
      hostname === 'ss-erp.cn' ||
      hostname.endsWith('.ss-erp.cn')
    );
  }

  function isPackagedErpOrigin() {
    var defaults = globalThis.SS_ERP_DEPLOYMENT_DEFAULTS || {};
    var currentOrigin = String(window.location.origin || '').trim();
    if (!currentOrigin) return false;
    return [defaults.erpBaseUrl, defaults.erpAdminBaseUrl].some(function (value) {
      try {
        return new URL(String(value || '').trim()).origin === currentOrigin;
      } catch (_error) {
        return false;
      }
    });
  }

  function shouldActivate() {
    return isPackagedErpOrigin() || isKnownLegacyErpOrigin();
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

      var runtimeMessage = Object.assign({}, message, { requestId: requestId });
      chrome.runtime.sendMessage(runtimeMessage, function (response) {
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
      if (msg.type === 'ss-erp:extension-progress') {
        window.postMessage({
          direction: DIRECTION_FROM_EXT,
          requestId: msg.requestId,
          progress: msg.progress || null,
        }, '*');
      }
    });

    document.documentElement.setAttribute('data-ss-erp-bridge', 'ready');
  }

  if (shouldActivate()) {
    activateBridge();
  }
}());
