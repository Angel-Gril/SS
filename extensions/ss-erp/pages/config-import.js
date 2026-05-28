(function () {
  var fileInput = document.getElementById('fileInput');
  var importBtn = document.getElementById('importBtn');
  var erpEndpointInput = document.getElementById('erpEndpoint');
  var erpTokenInput = document.getElementById('erpToken');
  var saveErpEndpointBtn = document.getElementById('saveErpEndpointBtn');
  var statusNode = document.getElementById('status');

  function setStatus(text) {
    if (statusNode) statusNode.textContent = text;
  }

  function formatErpPackageSummary(response) {
    if (window.OZON_CALC_ERP_PACKAGE_SUMMARY && typeof window.OZON_CALC_ERP_PACKAGE_SUMMARY.formatSummary === 'function') {
      return window.OZON_CALC_ERP_PACKAGE_SUMMARY.formatSummary(response || {});
    }
    return {
      statusText: response && response.ready ? '可推送' : '不可推送',
      countText: '选品 ' + ((response && response.counts && response.counts.productPool) || 0),
      endpointText: 'ERP 地址：' + (response && response.endpointConfigured ? '已配置' : '未配置'),
      tokenText: 'Token：' + (response && response.hasToken ? '已保存' : '未保存'),
      blockers: [],
      lastPushText: '最近推送：暂无',
    };
  }

  function buildErpPackageSummaryText(response) {
    var summary = formatErpPackageSummary(response || {});
    var lines = [
      '数据包预检：' + summary.statusText,
      summary.countText,
      summary.endpointText + '，' + summary.tokenText,
      summary.lastPushText,
    ];
    if (summary.blockers && summary.blockers.length) {
      lines.push('待处理：' + summary.blockers.join('；'));
    }
    return lines.join('\n');
  }

  function loadErpPackageSummary(prefixText) {
    chrome.runtime.sendMessage({
      type: 'ozon-calc:erp-package-summary',
    }, function (response) {
      if (chrome.runtime.lastError) return;
      if (!response || !response.ok) return;
      setStatus((prefixText ? prefixText + '\n' : '') + buildErpPackageSummaryText(response));
    });
  }

  function importSnapshot(payload) {
    var normalized = window.OZON_CALC_SYNC_SCHEMA.normalizeSnapshot(payload);
    var validation = window.OZON_CALC_SYNC_SCHEMA.validateSnapshot(normalized);
    if (!validation.valid) {
      setStatus('导入失败：' + validation.errors.join('；'));
      return;
    }

    chrome.runtime.sendMessage({
      type: 'ozon-calc:sync-config',
      payload: normalized,
    }, function (response) {
      if (chrome.runtime.lastError) {
        setStatus('导入失败：' + chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.ok) {
        setStatus('导入失败：' + (response && response.error ? response.error : '未知错误'));
        return;
      }
      setStatus('导入成功：' + new Date().toLocaleString('zh-CN', { hour12: false }));
    });
  }

	  function loadErpEndpoint() {
	    chrome.runtime.sendMessage({
	      type: 'ozon-calc:erp-endpoint-get',
	    }, function (response) {
	      if (chrome.runtime.lastError) return;
	      if (response && response.ok && erpEndpointInput) {
	        erpEndpointInput.value = response.endpoint || '';
	        if (erpTokenInput) {
	          erpTokenInput.value = '';
	          erpTokenInput.placeholder = response.hasToken ? '已保存 token；留空会清除' : '可选，保存后不会回显明文';
	        }
	      }
	      loadErpPackageSummary();
	    });
	  }

  function saveErpEndpoint() {
    var endpoint = erpEndpointInput ? erpEndpointInput.value : '';
    var token = erpTokenInput ? erpTokenInput.value : '';
    chrome.runtime.sendMessage({
      type: 'ozon-calc:erp-endpoint-save',
      payload: { endpoint: endpoint, token: token },
    }, function (response) {
      if (chrome.runtime.lastError) {
        setStatus('保存 ERP 地址失败：' + chrome.runtime.lastError.message);
        return;
      }
      if (!response || !response.ok) {
        setStatus('保存 ERP 地址失败：' + (response && response.error ? response.error : '未知错误'));
        return;
      }
	      if (erpTokenInput) {
	        erpTokenInput.value = '';
	        erpTokenInput.placeholder = response.hasToken ? '已保存 token；留空会清除' : '可选，保存后不会回显明文';
	      }
	      loadErpPackageSummary('ERP 地址已保存：' + response.endpoint + (response.hasToken ? '\nToken 已保存。' : '\n未保存 Token。'));
	    });
	  }

  importBtn.addEventListener('click', function () {
    if (fileInput) fileInput.click();
  });

  fileInput.addEventListener('change', function (event) {
    var file = event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;
    file.text().then(function (rawText) {
      importSnapshot(JSON.parse(rawText));
    }).catch(function (error) {
      setStatus('读取文件失败：' + (error && error.message ? error.message : String(error)));
    }).finally(function () {
      event.target.value = '';
    });
  });

  if (saveErpEndpointBtn) {
    saveErpEndpointBtn.addEventListener('click', saveErpEndpoint);
  }

	  loadErpEndpoint();
	}());
