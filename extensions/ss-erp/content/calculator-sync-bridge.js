(function () {
  if (window.__OZON_CALC_CALC_SYNC_BRIDGE__) return;
  window.__OZON_CALC_CALC_SYNC_BRIDGE__ = true;

  function isTargetPage() {
    var href = String(window.location.href || '').toLowerCase();
    var pathname = String(window.location.pathname || '').toLowerCase();
    return pathname.indexOf('ozon-profit-calc.html') >= 0
      || href.indexOf('ozon-profit-calc.html') >= 0;
  }

  if (!isTargetPage()) return;

  var bridgeNodeId = 'ozon-calc-sync-bridge-node';

  try {
    document.documentElement.setAttribute('data-ozon-calc-bridge', 'ready');
  } catch (error) {}

  try {
    var script = document.createElement('script');
    script.textContent = [
      '(function(){',
      '  try {',
      '    window.__OZON_CALC_BRIDGE_READY__ = true;',
      '    document.documentElement && document.documentElement.setAttribute("data-ozon-calc-bridge","ready");',
      '  } catch (e) {}',
      '}());'
    ].join('');
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  } catch (error) {}

  function ensureBridgeNode() {
    var existing = document.getElementById(bridgeNodeId);
    if (existing) return existing;
    var node = document.createElement('div');
    node.id = bridgeNodeId;
    node.style.display = 'none';
    node.setAttribute('data-status', 'idle');
    (document.documentElement || document.body).appendChild(node);
    return node;
  }

  function respond(node, requestId, ok, errorText) {
    node.setAttribute('data-request-id', requestId || '');
    node.setAttribute('data-status', ok ? 'success' : 'error');
    node.setAttribute('data-error', errorText || '');
  }

  function respondWithPayload(node, requestId, ok, errorText, payload, entryCount) {
    if (payload) {
      node.textContent = JSON.stringify(payload);
    } else {
      node.textContent = '';
    }
    node.setAttribute('data-entry-count', entryCount == null ? '' : String(entryCount));
    respond(node, requestId, ok, errorText);
  }

  function handleSyncPayload(node, requestId, payload) {
    var normalized = window.OZON_CALC_SYNC_SCHEMA.normalizeSnapshot(payload);
    var validation = window.OZON_CALC_SYNC_SCHEMA.validateSnapshot(normalized);

    if (!validation.valid) {
      respond(node, requestId, false, validation.errors.join('；'));
      return;
    }

    chrome.runtime.sendMessage({
      type: 'ozon-calc:sync-config',
      payload: normalized,
    }, function (response) {
      var errorText = '';
      if (chrome.runtime.lastError) {
        errorText = chrome.runtime.lastError.message;
      } else if (!response || !response.ok) {
        errorText = response && response.error ? response.error : '同步失败';
      }
      respond(node, requestId, !errorText, errorText);
    });
  }

  function handleCapturedHarPull(node, requestId) {
    var mode = String(node.getAttribute('data-mode') || 'all').toLowerCase();
    chrome.runtime.sendMessage({
      type: 'ozon-calc:get-captured-har',
      mode: mode,
    }, function (response) {
      var errorText = '';
      if (chrome.runtime.lastError) {
        errorText = chrome.runtime.lastError.message;
      } else if (!response || !response.ok) {
        errorText = response && response.error ? response.error : '读取插件捕获数据失败';
      }
      respondWithPayload(
        node,
        requestId,
        !errorText,
        errorText,
        response && response.payload ? response.payload : null,
        response && response.entryCount != null ? response.entryCount : 0
      );
    });
  }

  var bridgeNode = ensureBridgeNode();
  var observer = new MutationObserver(function () {
    var requestId = bridgeNode.getAttribute('data-request-id') || '';
    var status = bridgeNode.getAttribute('data-status') || '';
    if (!requestId || status !== 'pending') return;
    var action = bridgeNode.getAttribute('data-action') || 'sync-config';
    if (action === 'pull-captured-har') {
      handleCapturedHarPull(bridgeNode, requestId);
      return;
    }
    if (action !== 'sync-config') {
      respond(bridgeNode, requestId, false, '未知桥接动作：' + action);
      return;
    }
    var payloadText = bridgeNode.getAttribute('data-payload') || '';
    if (!payloadText) {
      respond(bridgeNode, requestId, false, '同步 payload 为空');
      return;
    }
    try {
      handleSyncPayload(bridgeNode, requestId, JSON.parse(payloadText));
    } catch (error) {
      respond(bridgeNode, requestId, false, error && error.message ? error.message : String(error));
    }
  });

  observer.observe(bridgeNode, {
    attributes: true,
    attributeFilter: ['data-status', 'data-request-id', 'data-payload'],
  });
}());
