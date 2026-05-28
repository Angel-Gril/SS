(function () {
  if (window.__SS_ERP_COLLECT_BRIDGE__) return;
  window.__SS_ERP_COLLECT_BRIDGE__ = true;

  var DIRECTION_TO_EXT = 'ss-erp:to-extension';
  var DIRECTION_FROM_EXT = 'ss-erp:from-extension';

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.direction !== DIRECTION_TO_EXT) return;

    var requestId = event.data.requestId;
    var message = event.data.message;
    if (!message || !message.type) return;

    chrome.runtime.sendMessage(message, function (response) {
      window.postMessage({
        direction: DIRECTION_FROM_EXT,
        requestId: requestId,
        response: response || { ok: false, error: 'no response' }
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
}());
