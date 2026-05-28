(function () {
  var statusNode = document.getElementById('status');

  function setStatus(text) {
    if (statusNode) statusNode.textContent = text;
  }

  function notifyOpener(requestId, ok, error) {
    if (!window.opener || typeof window.opener.postMessage !== 'function') return;
    try {
      window.opener.postMessage({
        type: 'ozon-calc:sync-config-response',
        requestId: requestId,
        ok: ok,
        error: error || '',
      }, '*');
    } catch (notifyError) {}
  }

  function importSnapshot(payload, requestId) {
    var normalized = window.OZON_CALC_SYNC_SCHEMA.normalizeSnapshot(payload);
    var validation = window.OZON_CALC_SYNC_SCHEMA.validateSnapshot(normalized);
    if (!validation.valid) {
      var errorText = validation.errors.join('；');
      setStatus('配置无效：' + errorText);
      notifyOpener(requestId, false, errorText);
      return;
    }

    chrome.runtime.sendMessage({
      type: 'ozon-calc:sync-config',
      payload: normalized,
    }, function (response) {
      if (chrome.runtime.lastError) {
        setStatus('同步失败：' + chrome.runtime.lastError.message);
        notifyOpener(requestId, false, chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.ok) {
        setStatus('同步失败');
        notifyOpener(requestId, false, response && response.error ? response.error : '同步失败');
        return;
      }
      setStatus('同步成功：' + new Date().toLocaleString('zh-CN', { hour12: false }));
      notifyOpener(requestId, true, '');
    });
  }

  window.addEventListener('message', function (event) {
    var payload = event.data;
    if (!payload || payload.type !== 'ozon-calc:sync-config') return;
    importSnapshot(payload.payload, payload.requestId || '');
  });

  try {
    if (window.location.hash) {
      var hash = new URLSearchParams(window.location.hash.slice(1));
      var requestId = hash.get('requestId') || '';
      var payloadText = hash.get('payload') || '';
      if (payloadText) {
        importSnapshot(JSON.parse(decodeURIComponent(payloadText)), requestId);
      }
    }
  } catch (error) {
    setStatus('自动同步参数解析失败：' + (error && error.message ? error.message : String(error)));
  }
}());
