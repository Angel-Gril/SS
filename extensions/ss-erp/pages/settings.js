(function () {
  var SS_ERP_MESSAGE_TIMEOUT_MS = 60000;
  var logisticsDistributionFeature = globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE;
  var logisticsDistributionEnabled = Boolean(
    logisticsDistributionFeature && logisticsDistributionFeature.enabled === true
  );
  var logisticsDistributionFeatureSection = document.getElementById('logisticsDistributionFeatureSection');
  if (logisticsDistributionFeatureSection) {
    logisticsDistributionFeatureSection.hidden = !logisticsDistributionEnabled;
  }
  var sellerCountNode = document.getElementById('sellerCount');
  var officialCountNode = document.getElementById('officialCount');
  var officialSampleCountNode = document.getElementById('officialSampleCount');
  var selectedCountNode = document.getElementById('selectedCount');
  var allCountNode = document.getElementById('allCount');
  var configUpdatedAtNode = document.getElementById('configUpdatedAt');
  var selectedSummaryNode = document.getElementById('selectedSummary');
  var sellerBadgeNode = document.getElementById('sellerBadge');
  var officialBadgeNode = document.getElementById('officialBadge');
  var selectedBadgeNode = document.getElementById('selectedBadge');
  var refreshBtn = document.getElementById('refreshBtn');
  var refreshDiagnosticBtn = document.getElementById('refreshDiagnosticBtn');
  var openSellerBtn = document.getElementById('openSellerBtn');
  var openOfficialBtn = document.getElementById('openOfficialBtn');
  var syncAllBtn = document.getElementById('syncAllBtn');
  var syncOfficialBtn = document.getElementById('syncOfficialBtn');
  var refreshLogisticsBtn = document.getElementById('refreshLogisticsBtn');
  var sellerDiagnosticHarBtn = document.getElementById('sellerDiagnosticHarBtn');
  var videoUploadDiagnosticHarBtn = document.getElementById('videoUploadDiagnosticHarBtn');
  var officialDiagnosticHarBtn = document.getElementById('officialDiagnosticHarBtn');
  var autoCommissionSyncInput = document.getElementById('autoCommissionSyncInput');
  var syncCommissionRatesBtn = document.getElementById('syncCommissionRatesBtn');
  var commissionSyncStatusNode = document.getElementById('commissionSyncStatus');
  var autoFxSyncInput = document.getElementById('autoFxSyncInput');
  var syncFxRatesBtn = document.getElementById('syncFxRatesBtn');
  var fxSyncStatusNode = document.getElementById('fxSyncStatus');
  var openSelectorBtn = document.getElementById('openSelectorBtn');
  var saveServicesBtn = document.getElementById('saveServicesBtn');
  var cancelSelectorBtn = document.getElementById('cancelSelectorBtn');
  var selectVisibleBtn = document.getElementById('selectVisibleBtn');
  var clearSelectionBtn = document.getElementById('clearSelectionBtn');
  var importBtn = document.getElementById('importBtn');
  var exportSyncFileBtn = document.getElementById('exportSyncFileBtn');
  var fileInput = document.getElementById('fileInput');
  var clearBtn = document.getElementById('clearBtn');
  var serviceModal = document.getElementById('serviceModal');
  var serviceListNode = document.getElementById('serviceList');
  var selectedServiceListNode = document.getElementById('selectedServiceList');
  var serviceSearchInput = document.getElementById('serviceSearchInput');
  var filteredCountNode = document.getElementById('filteredCount');
  var modalSelectedCountNode = document.getElementById('modalSelectedCount');
  var configStatusNode = document.getElementById('configStatus');
  var diagnosticStatusNode = document.getElementById('diagnosticStatus');
  var bridgeStatusNode = document.getElementById('bridgeStatus');
  var lastRequestIdNode = document.getElementById('lastRequestId');
  var lastResponseStatusNode = document.getElementById('lastResponseStatus');
  var lastReadModeNode = document.getElementById('lastReadMode');
  var packingFeeInput = document.getElementById('packingFeeInput');
  var customFeesInput = document.getElementById('customFeesInput');
  var saveFeeSettingsBtn = document.getElementById('saveFeeSettingsBtn');
  var feeStatusNode = document.getElementById('feeStatus');
  var resolutionLowestInput = document.getElementById('resolutionLowestInput');
  var resolutionPriorityInput = document.getElementById('resolutionPriorityInput');
  var guideToggleBtn = document.getElementById('guideToggleBtn');
  var guideBody = document.getElementById('guideBody');
  var healthSummaryNode = document.getElementById('healthSummary');
  var healthLogisticsNode = document.getElementById('healthLogistics');
  var healthCommissionNode = document.getElementById('healthCommission');
  var healthFxNode = document.getElementById('healthFx');
  var extensionVersionNode = document.getElementById('extensionVersion');
  var currentSnapshot = null;
  var currentStatus = null;
  var draftSelectedIds = [];
  var visibleServiceIds = [];
  var modalReturnFocus = null;
  var selectorOpen = false;

  function on(node, eventName, handler) {
    if (node) node.addEventListener(eventName, handler);
  }

  function setText(node, text) {
    if (node) node.textContent = text == null ? '' : String(text);
  }

  function setStatus(node, text, tone) {
    if (!node) return;
    node.textContent = text == null ? '' : String(text);
    node.classList.remove('is-error', 'is-warn');
    if (tone === 'error') node.classList.add('is-error');
    if (tone === 'warn') node.classList.add('is-warn');
  }

  function setBadge(node, text, tone) {
    if (!node) return;
    node.textContent = text;
    node.className = 'badge ' + (tone === 'good' ? 'badge-good' : tone === 'warn' ? 'badge-warn' : 'badge-muted');
  }

  function uniqueStrings(values) {
    var seen = new Set();
    return (Array.isArray(values) ? values : []).map(String).map(function (value) {
      return value.trim();
    }).filter(function (value) {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function formatTime(value) {
    if (!value) return '无';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function formatFileDate(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      '-',
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join('');
  }

  function sendMessage(message) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        settle({
          ok: false,
          errorCode: 'runtime_timeout',
          error: '扩展后台响应超时，操作可能仍在后台执行，请刷新状态后重试。',
        });
      }, SS_ERP_MESSAGE_TIMEOUT_MS);

      function settle(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }

      try {
        chrome.runtime.sendMessage(message, function (response) {
          if (chrome.runtime.lastError) {
            settle({ ok: false, error: formatRuntimeError(chrome.runtime.lastError.message) });
            return;
          }
          settle(response || { ok: false, error: '无响应' });
        });
      } catch (error) {
        settle({ ok: false, error: formatRuntimeError(error && error.message ? error.message : String(error)) });
      }
    });
  }

  function formatRuntimeError(message) {
    var text = String(message || '');
    if (/Extension context invalidated|context invalidated|Receiving end does not exist/i.test(text)) {
      return '扩展刚刚被重新加载，请刷新当前扩展设置页后重试。';
    }
    return text || '扩展后台未响应';
  }

  function requestSellerOzonAccess() {
    return new Promise(function (resolve) {
      if (!chrome.permissions || typeof chrome.permissions.request !== 'function') {
        resolve({ ok: true });
        return;
      }

      var permissions = { origins: ['https://seller.ozon.ru/*'] };
      chrome.permissions.request(permissions, function (granted) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: formatRuntimeError(chrome.runtime.lastError.message) });
          return;
        }
        resolve(granted
          ? { ok: true }
          : { ok: false, error: '未授权访问 seller.ozon.ru，无法读取卖家后台分析数据。请允许扩展访问 seller.ozon.ru 后重试。' });
      });
    });
  }

  function runSellerOzonAction(action) {
    return requestSellerOzonAccess().then(function (permission) {
      if (!permission.ok) {
        return permission;
      }
      return action();
    });
  }

  function downloadText(filename, mimeType, content) {
    var blob = new Blob([content || ''], { type: mimeType || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[character];
    });
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function getServices(snapshot) {
    return snapshot && snapshot.catalogSnapshot && Array.isArray(snapshot.catalogSnapshot.services)
      ? snapshot.catalogSnapshot.services
      : [];
  }

  function getSelectedIds(snapshot) {
    return uniqueStrings(snapshot && snapshot.userConfig && snapshot.userConfig.selectedServiceIds);
  }

  function getResolutionMode(snapshot) {
    return snapshot && snapshot.userConfig && snapshot.userConfig.resolutionMode === 'priority'
      ? 'priority'
      : 'lowest_cost';
  }

  function getRuleCoverage(snapshot) {
    var ruleServices = snapshot && snapshot.ruleSnapshot && Array.isArray(snapshot.ruleSnapshot.services)
      ? snapshot.ruleSnapshot.services
      : [];
    var ruleIds = new Set();
    ruleServices.forEach(function (rule) {
      var id = String(rule && (rule.serviceId || rule.id || rule.templateId) || '').trim();
      if (id) ruleIds.add(id);
    });
    return ruleIds;
  }

  function getServiceByIdMap(snapshot) {
    var map = new Map();
    getServices(snapshot).forEach(function (service) {
      map.set(String(service.id), service);
    });
    return map;
  }

  function selectedServicesFromIds(snapshot, ids) {
    var serviceMap = getServiceByIdMap(snapshot);
    return uniqueStrings(ids).map(function (id) {
      return serviceMap.get(id);
    }).filter(Boolean);
  }

  function deliveryModeLabel(service) {
    var mode = String(service && service.deliveryMode || '').toLowerCase();
    if (mode.indexOf('pickup') >= 0 && mode.indexOf('courier') < 0) return '仅自提点';
    if (mode.indexOf('courier') >= 0 && mode.indexOf('pickup') < 0) return '仅宅配';
    if (mode.indexOf('pudo') >= 0) return '自提点';
    return '宅配 / 自提';
  }

  function batteryLabel(service) {
    var mode = String(service && service.batteryMode || '').toLowerCase();
    if (mode === 'disallowed' || mode === 'no_battery' || mode === 'forbidden') return '不可运输电池';
    return '支持可运输电池';
  }

  function serviceTags(service) {
    var tags = Array.isArray(service && service.tags) ? service.tags : [];
    return [deliveryModeLabel(service), batteryLabel(service)].concat(tags).filter(Boolean).slice(0, 4);
  }

  function matchesServiceSearch(service, query) {
    var terms = String(query || '').toLowerCase().split(/[\s,，;；]+/).filter(Boolean);
    if (!terms.length) return true;
    var haystack = [
      service && service.id,
      service && service.displayName,
      service && service.carrierName,
      service && service.serviceName,
      service && service.note,
      deliveryModeLabel(service),
      batteryLabel(service),
      Array.isArray(service && service.tags) ? service.tags.join(' ') : '',
    ].join(' ').toLowerCase();
    return terms.every(function (term) {
      return haystack.indexOf(term) >= 0;
    });
  }

  function renderSelectedSummary(snapshot) {
    var selectedIds = getSelectedIds(snapshot);
    var selectedServices = selectedServicesFromIds(snapshot, selectedIds);
    if (!selectedIds.length) {
      setText(selectedSummaryNode, '还没有选择物流集合。点击“重新选择物流”先选择实际发货模板。');
      return;
    }
    var names = selectedServices.slice(0, 4).map(function (service) {
      return service.displayName || service.id;
    });
    var suffix = selectedIds.length > names.length ? ' 等 ' + selectedIds.length + ' 个' : '';
    setText(selectedSummaryNode, '当前已选 ' + selectedIds.length + ' 个：' + names.join('、') + suffix);
  }

  function renderStrategy(snapshot) {
    var mode = getResolutionMode(snapshot);
    if (resolutionLowestInput) resolutionLowestInput.checked = mode === 'lowest_cost';
    if (resolutionPriorityInput) resolutionPriorityInput.checked = mode === 'priority';
  }

  function setHealthState(node, text, tone) {
    setText(node, text);
    var item = node && typeof node.closest === 'function' ? node.closest('.health-item') : null;
    if (!item) return;
    item.classList.remove('is-good', 'is-warn');
    item.classList.add(tone === 'good' ? 'is-good' : 'is-warn');
  }

  function renderExtensionVersion() {
    var version = '版本未识别';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
        var manifest = chrome.runtime.getManifest();
        version = manifest && manifest.version ? manifest.version : version;
      }
    } catch (error) {}
    setText(extensionVersionNode, version);
  }

  function renderHealthSummary() {
    var counts = currentStatus && currentStatus.counts ? currentStatus.counts : {};
    var services = getServices(currentSnapshot);
    var selectedIds = getSelectedIds(currentSnapshot);
    var sellerDisplayCount = services.length || counts.seller || 0;
    var officialSamples = currentStatus && currentStatus.officialSampleCount ? currentStatus.officialSampleCount : 0;
    var commissionRules = currentStatus && currentStatus.commissionRuleCount ? currentStatus.commissionRuleCount : 0;
    var fxCurrencies = currentStatus && currentStatus.fxCurrencyCount ? currentStatus.fxCurrencyCount : 0;
    var missing = [];

    if (selectedIds.length) {
      setHealthState(healthLogisticsNode, '可核价：已选 ' + selectedIds.length + ' 个物流，官方样本 ' + officialSamples + ' 个', 'good');
    } else if (sellerDisplayCount) {
      missing.push('选择我的物流');
      setHealthState(healthLogisticsNode, '待选择：目录 ' + sellerDisplayCount + ' 个，尚未选择我的物流', 'warn');
    } else {
      missing.push('同步物流');
      setHealthState(healthLogisticsNode, '待同步：没有物流目录', 'warn');
    }

    if (commissionRules) {
      setHealthState(healthCommissionNode, '已就绪：' + commissionRules + ' 个类目，更新 ' + formatTime(currentStatus && currentStatus.commissionUpdatedAt), 'good');
    } else {
      missing.push('同步官方佣金');
      setHealthState(healthCommissionNode, '待同步：商品页会使用手动佣金兜底', 'warn');
    }

    if (fxCurrencies) {
      setHealthState(healthFxNode, '已就绪：' + fxCurrencies + ' 个币种，更新 ' + formatTime(currentStatus && currentStatus.fxUpdatedAt), 'good');
    } else {
      missing.push('同步实时汇率');
      setHealthState(healthFxNode, '待同步：商品页会使用手动 RUB/CNY 汇率', 'warn');
    }

    if (healthSummaryNode) {
      var ready = !missing.length;
      healthSummaryNode.classList.remove('is-good', 'is-warn');
      healthSummaryNode.classList.add(ready ? 'is-good' : 'is-warn');
      setText(
        healthSummaryNode,
        ready
          ? '可用：商品页核价会使用我的物流、官方佣金和实时汇率。'
          : ('待处理：' + missing.join('、') + '。')
      );
    }
  }

  function renderStatus(response, prefix, tone) {
    currentStatus = response || currentStatus || {};
    var counts = currentStatus && currentStatus.counts ? currentStatus.counts : {};
    var services = getServices(currentSnapshot);
    var selectedIds = getSelectedIds(currentSnapshot);
    var officialSamples = currentStatus && currentStatus.officialSampleCount ? currentStatus.officialSampleCount : 0;
    var commissionRules = currentStatus && currentStatus.commissionRuleCount ? currentStatus.commissionRuleCount : 0;
    var fxCurrencies = currentStatus && currentStatus.fxCurrencyCount ? currentStatus.fxCurrencyCount : 0;
    var sellerDisplayCount = services.length || counts.seller || 0;
    var catalogTotal = services.length || 0;
    setText(sellerCountNode, sellerDisplayCount);
    setText(officialCountNode, counts.official || 0);
    setText(officialSampleCountNode, officialSamples);
    setText(selectedCountNode, selectedIds.length);
    setText(allCountNode, catalogTotal);
    setText(configUpdatedAtNode, formatTime(currentStatus && currentStatus.configUpdatedAt));
    setBadge(sellerBadgeNode, sellerDisplayCount ? '已导入' : '待读取', sellerDisplayCount ? 'good' : 'muted');
    setBadge(officialBadgeNode, officialSamples ? '已导入样本' : '待读取', officialSamples ? 'good' : 'muted');
    setBadge(selectedBadgeNode, selectedIds.length ? '已选择' : '未选择', selectedIds.length ? 'good' : 'warn');
    renderSelectedSummary(currentSnapshot);
    renderStrategy(currentSnapshot);
    if (commissionSyncStatusNode) {
      setStatus(
        commissionSyncStatusNode,
        commissionRules ? ('佣金费率：' + commissionRules + ' 个类目，更新 ' + formatTime(currentStatus && currentStatus.commissionUpdatedAt)) : '尚未同步 Ozon 佣金费率。',
        commissionRules ? 'success' : 'warn'
      );
    }
    if (fxSyncStatusNode) {
      setStatus(
        fxSyncStatusNode,
        fxCurrencies ? ('汇率币种：' + fxCurrencies + ' 个，更新 ' + formatTime(currentStatus && currentStatus.fxUpdatedAt)) : '尚未同步实时汇率，将使用手动 RUB/CNY 汇率。',
        fxCurrencies ? 'success' : 'warn'
      );
    }

    var lines = [
      prefix || '',
      '平台目录：' + catalogTotal + ' 个；我的物流：' + selectedIds.length + ' 个；官方样本：' + officialSamples + ' 个。',
      '佣金费率：' + commissionRules + ' 个类目；汇率币种：' + fxCurrencies + ' 个。',
      '最近数据更新：' + formatTime(currentStatus && currentStatus.latestCapturedAt) + '；配置保存：' + formatTime(currentStatus && currentStatus.configUpdatedAt) + '；官方样本保存：' + formatTime(currentStatus && currentStatus.officialUpdatedAt) + '。',
    ].filter(Boolean);
    setStatus(configStatusNode, lines.join('\n'), tone || (selectedIds.length ? 'success' : 'warn'));
    renderHealthSummary();
  }

  function setDiagnostic(requestId, responseText, readMode, tone) {
    setText(bridgeStatusNode, '已检测到');
    if (requestId) setText(lastRequestIdNode, requestId);
    if (responseText) setText(lastResponseStatusNode, responseText);
    if (readMode) setText(lastReadModeNode, readMode);
    if (responseText) setStatus(diagnosticStatusNode, responseText, tone);
  }

  function loadStatus(prefix, tone) {
    sendMessage({ type: 'ozon-calculator:status' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(configStatusNode, '读取状态失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        setDiagnostic('', '读取状态失败', '', 'error');
        return;
      }
      if (response.snapshot) currentSnapshot = response.snapshot;
      renderStatus(response, prefix, tone);
      renderFeeForm(currentSnapshot);
      renderServiceList(currentSnapshot);
      renderSelectedServices();
      setDiagnostic('', '成功', '', 'success');
    });
  }

  function selectedServiceIdsFromState() {
    return getSelectedIds(currentSnapshot);
  }

  function activeSelectorIds() {
    return selectorOpen ? draftSelectedIds : getSelectedIds(currentSnapshot);
  }

  function refreshLogisticsConfig(selectedServiceIds, prefix) {
    var requestId = 'pull-seller-' + Date.now();
    setDiagnostic(requestId, '同步中...', 'seller', 'warn');
    sendMessage({
      type: 'ozon-calculator:build-config-from-captured-seller',
      selectedServiceIds: selectedServiceIds || [],
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(configStatusNode, '生成物流配置失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        setDiagnostic(requestId, '失败', 'seller', 'error');
        return;
      }
      currentSnapshot = response.snapshot;
      renderServiceList(currentSnapshot);
      renderSelectedServices();
      renderFeeForm(currentSnapshot);
      loadStatus(prefix || 'seller 已同步，请检查“我的物流集合”后保存。');
    });
  }

  function saveUserConfig(options, prefix) {
    if (!currentSnapshot || !getServices(currentSnapshot).length) {
      setStatus(configStatusNode, '还没有可保存的物流目录。请先同步 seller 或导入同步文件。', 'warn');
      return Promise.resolve(false);
    }
    var snapshot = clone(currentSnapshot);
    var userConfig = snapshot.userConfig && typeof snapshot.userConfig === 'object' ? snapshot.userConfig : {};
    snapshot.userConfig = Object.assign({}, userConfig, {
      selectedServiceIds: options && Array.isArray(options.selectedServiceIds)
        ? uniqueStrings(options.selectedServiceIds)
        : getSelectedIds(snapshot),
      resolutionMode: options && options.resolutionMode
        ? options.resolutionMode
        : getResolutionMode(snapshot),
      updatedAt: new Date().toISOString(),
    });
    snapshot.generatedAt = new Date().toISOString();
    return sendMessage({
      type: 'ozon-calc:sync-config',
      payload: snapshot,
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(configStatusNode, '保存失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return false;
      }
      currentSnapshot = window.OZON_CALC_SYNC_SCHEMA.normalizeSnapshot(snapshot);
      renderSelectedSummary(currentSnapshot);
      renderStrategy(currentSnapshot);
      renderServiceList(currentSnapshot);
      renderSelectedServices();
      loadStatus(prefix || '配置已保存。');
      return true;
    });
  }

  function importSnapshot(payload) {
    var validation = window.OZON_CALC_SYNC_SCHEMA.validateRawSnapshot(payload);
    if (!validation.valid) {
      setStatus(configStatusNode, '导入失败：' + validation.errors.join('；'), 'error');
      return;
    }

    sendMessage({
      type: 'ozon-calc:sync-config',
      payload: payload,
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(configStatusNode, '导入失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return;
      }
      currentSnapshot = window.OZON_CALC_SYNC_SCHEMA.normalizeSnapshot(Object.assign({}, payload, { source: 'local-fallback' }));
      renderServiceList(currentSnapshot);
      renderSelectedServices();
      renderFeeForm(currentSnapshot);
      loadStatus('导入成功。');
    });
  }

  function exportCurrentSnapshot() {
    if (!currentSnapshot || !getServices(currentSnapshot).length) {
      setStatus(configStatusNode, '还没有可导出的物流配置。请先同步 seller 或导入同步文件。', 'warn');
      return;
    }
    var snapshot = clone(currentSnapshot);
    snapshot.generatedAt = new Date().toISOString();
    downloadText(
      'ozon-calculator-extension-sync-' + formatFileDate(new Date()) + '.json',
      'application/json;charset=utf-8',
      JSON.stringify(window.OZON_CALC_SYNC_SCHEMA.normalizeSnapshot(snapshot), null, 2)
    );
    setStatus(configStatusNode, '已导出插件同步文件。', 'success');
  }

  function exportDiagnostic(type, format, successText) {
    sendMessage({ type: type, format: format }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(diagnosticStatusNode, '导出失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return;
      }
      downloadText(response.filename, response.mimeType, response.content);
      setStatus(diagnosticStatusNode, successText + '，数量：' + (response.count || 0), 'success');
    });
  }

  function exportCapturedHar(mode, successText) {
    sendMessage({ type: 'ozon-calc:get-captured-har', mode: mode || 'all' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(diagnosticStatusNode, '导出失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return;
      }
      var normalizedMode = response.mode || mode || 'all';
      downloadText(
        'ozon-calc-captured-' + normalizedMode + '.har',
        'application/json;charset=utf-8',
        JSON.stringify(response.payload || { log: { entries: [] } }, null, 2)
      );
      setStatus(diagnosticStatusNode, successText + '，条目数：' + (response.entryCount || 0), 'success');
    });
  }

  function syncCommissionRates() {
    setStatus(commissionSyncStatusNode, '正在从 Ozon 帮助中心同步佣金费率...', 'warn');
    return sendMessage({ type: 'ozon-calculator:sync-commission-rates' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(commissionSyncStatusNode, '佣金费率同步失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return false;
      }
      setStatus(commissionSyncStatusNode, '佣金费率已同步：' + (response.ruleCount || 0) + ' 个类目。', 'success');
      loadStatus();
      return true;
    });
  }

  function syncFxRates() {
    setStatus(fxSyncStatusNode, '正在同步实时汇率...', 'warn');
    return sendMessage({ type: 'ozon-calculator:sync-fx-rates' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(fxSyncStatusNode, '汇率同步失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return false;
      }
      var rubRate = response.snapshot && response.snapshot.cnyPerCurrency ? response.snapshot.cnyPerCurrency.RUB : 0;
      setStatus(fxSyncStatusNode, '汇率已同步：' + (response.currencyCount || 0) + ' 个币种；RUB≈¥' + (Number(rubRate) || 0).toFixed(4) + '。', 'success');
      loadStatus();
      return true;
    });
  }

  function formatNumberInput(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? String(number) : '';
  }

  function parseCustomFeeLine(line) {
    var text = String(line || '').trim();
    if (!text) return null;
    var match = text.match(/^(.*?)[\s,，:：]+(-?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    var label = String(match[1] || '').trim();
    var amount = Number(match[2]);
    if (!label || !Number.isFinite(amount) || amount <= 0) return null;
    return { label: label, amount: amount };
  }

  function parseCustomFeesFromDom() {
    return String(customFeesInput && customFeesInput.value || '').split(/\r?\n/).map(parseCustomFeeLine).filter(Boolean);
  }

  function renderFeeForm(snapshot) {
    var formState = snapshot && snapshot.formState ? snapshot.formState : {};
    if (packingFeeInput) packingFeeInput.value = formatNumberInput(formState.packingFee);
    if (autoCommissionSyncInput) autoCommissionSyncInput.checked = formState.autoCommissionSync !== false;
    if (autoFxSyncInput) autoFxSyncInput.checked = formState.autoFxSync !== false;
    if (customFeesInput) {
      customFeesInput.value = (Array.isArray(formState.customFees) ? formState.customFees : []).map(function (fee) {
        return [fee.label, fee.amount].join(' ');
      }).join('\n');
    }
  }

  function collectFeeFormState() {
    return {
      packingFee: packingFeeInput ? packingFeeInput.value : '',
      autoCommissionSync: autoCommissionSyncInput ? Boolean(autoCommissionSyncInput.checked) : true,
      autoFxSync: autoFxSyncInput ? Boolean(autoFxSyncInput.checked) : true,
      customFees: parseCustomFeesFromDom(),
    };
  }

  function saveFeeSettings(successText) {
    return sendMessage({
      type: 'ozon-calculator:update-fee-settings',
      formState: collectFeeFormState(),
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(feeStatusNode, '保存失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return false;
      }
      currentSnapshot = response.snapshot;
      renderFeeForm(response.snapshot);
      setStatus(feeStatusNode, successText || '费用默认值已保存。', 'success');
      loadStatus();
      return true;
    });
  }

  function openServiceSelector() {
    modalReturnFocus = document.activeElement;
    selectorOpen = true;
    draftSelectedIds = getSelectedIds(currentSnapshot);
    renderServiceList(currentSnapshot);
    renderSelectedServices();
    if (serviceModal) serviceModal.hidden = false;
    document.body.style.overflow = 'hidden';
    window.setTimeout(function () {
      if (serviceSearchInput) serviceSearchInput.focus();
    }, 0);
  }

  function closeServiceSelector() {
    if (serviceModal) serviceModal.hidden = true;
    selectorOpen = false;
    document.body.style.overflow = '';
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') modalReturnFocus.focus();
  }

  function renderServiceList(snapshot) {
    if (!serviceListNode) return;
    var services = getServices(snapshot || currentSnapshot);
    var query = serviceSearchInput ? serviceSearchInput.value : '';
    var ruleCoverage = getRuleCoverage(snapshot || currentSnapshot);
    var selected = new Set(selectorOpen ? draftSelectedIds : getSelectedIds(snapshot || currentSnapshot));
    var filteredServices = services.filter(function (service) {
      return matchesServiceSearch(service, query);
    });
    visibleServiceIds = filteredServices.map(function (service) {
      return String(service.id || '');
    }).filter(Boolean);
    setText(filteredCountNode, filteredServices.length);
    if (!services.length) {
      serviceListNode.innerHTML = '<div class="empty-state">还没有可选物流。请先打开 Seller 物流页刷新，再点击“一键同步 seller+official”。</div>';
      setText(modalSelectedCountNode, selected.size);
      return;
    }
    if (!filteredServices.length) {
      serviceListNode.innerHTML = '<div class="empty-state">没有匹配的物流方式。多关键词会同时匹配，例如“RETS economy”。</div>';
      setText(modalSelectedCountNode, selected.size);
      return;
    }
    serviceListNode.innerHTML = filteredServices.map(function (service) {
      var id = String(service.id || '');
      var meta = [service.carrierName, service.note].filter(Boolean).join(' · ');
      var tags = serviceTags(service).map(function (tag) {
        return '<span class="tag">' + escapeHtml(tag) + '</span>';
      }).join('');
      var isSelected = selected.has(id);
      var coverageText = ruleCoverage.has(id) ? '已同步规则' : '待同步';
      var coverageTone = ruleCoverage.has(id) ? 'badge-good' : 'badge-warn';
      return [
        '<label class="service-item' + (isSelected ? ' is-selected' : '') + '" data-service-id="' + escapeHtml(id) + '">',
        '  <input type="checkbox" value="' + escapeHtml(id) + '"' + (isSelected ? ' checked' : '') + ' />',
        '  <span class="service-main">',
        '    <span class="service-topline">',
        '      <span>',
        '        <span class="service-name">' + escapeHtml(service.displayName || id) + '</span>',
        meta ? '        <span class="service-meta">' + escapeHtml(meta) + '</span>' : '',
        '      </span>',
        '      <span class="badge ' + coverageTone + '">' + coverageText + '</span>',
        '    </span>',
        tags ? '    <span class="tag-row">' + tags + '</span>' : '',
        '  </span>',
        '</label>',
      ].join('');
    }).join('');
    renderModalCounts();
  }

  function renderModalCounts() {
    setText(modalSelectedCountNode, draftSelectedIds.length);
  }

  function renderSelectedServices() {
    if (!selectedServiceListNode) return;
    var services = selectedServicesFromIds(currentSnapshot, activeSelectorIds());
    if (!services.length) {
      selectedServiceListNode.innerHTML = '<div class="empty-state">还没有选择任何物流方式</div>';
      renderModalCounts();
      return;
    }
    selectedServiceListNode.innerHTML = services.map(function (service, index) {
      var tags = serviceTags(service).slice(0, 3).map(function (tag) {
        return '<span class="tag">' + escapeHtml(tag) + '</span>';
      }).join('');
      return [
        '<article class="selected-service">',
        '  <div class="selected-service-body">',
        '    <div class="selected-service-name">' + (index + 1) + '. ' + escapeHtml(service.displayName || service.id) + '</div>',
        service.carrierName ? '    <div class="selected-service-meta">' + escapeHtml(service.carrierName) + '</div>' : '',
        tags ? '    <div class="selected-service-tags">' + tags + '</div>' : '',
        '  </div>',
        '  <div class="selected-actions">',
        '    <button class="tiny-btn" type="button" data-action="up" data-index="' + index + '"' + (index === 0 ? ' disabled' : '') + '>上移</button>',
        '    <button class="tiny-btn" type="button" data-action="down" data-index="' + index + '"' + (index === services.length - 1 ? ' disabled' : '') + '>下移</button>',
        '    <button class="tiny-btn danger" type="button" data-action="remove" data-index="' + index + '">删除</button>',
        '  </div>',
        '</article>',
      ].join('');
    }).join('');
    renderModalCounts();
  }

  function toggleDraftService(id, checked) {
    id = String(id || '').trim();
    if (!id) return;
    var next = draftSelectedIds.slice();
    var index = next.indexOf(id);
    if (checked && index < 0) next.push(id);
    if (!checked && index >= 0) next.splice(index, 1);
    draftSelectedIds = next;
    renderSelectedServices();
    renderModalCounts();
  }

  function moveDraftSelection(index, direction) {
    var targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || index >= draftSelectedIds.length || targetIndex >= draftSelectedIds.length) return;
    var next = draftSelectedIds.slice();
    var item = next[index];
    next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    draftSelectedIds = next;
    renderSelectedServices();
  }

  on(refreshBtn, 'click', function () {
    loadStatus();
  });

  on(refreshDiagnosticBtn, 'click', function () {
    loadStatus('同步诊断已刷新。');
  });

  on(openSellerBtn, 'click', function () {
    chrome.tabs.create({ url: 'https://seller.ozon.ru/app/postings/fbs' });
  });

  on(openOfficialBtn, 'click', function () {
    chrome.tabs.create({ url: 'https://globalcalculator.ozon.ru/' });
  });

  on(refreshLogisticsBtn, 'click', function () {
    refreshLogisticsConfig(selectedServiceIdsFromState());
  });

  on(syncOfficialBtn, 'click', function () {
    var requestId = 'pull-official-' + Date.now();
    setDiagnostic(requestId, '同步中...', 'official', 'warn');
    sendMessage({ type: 'ozon-calculator:sync-captured-official' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(configStatusNode, '读取 official 失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        setDiagnostic(requestId, '失败', 'official', 'error');
        return;
      }
      setDiagnostic(requestId, '成功', 'official', 'success');
      loadStatus('official 已同步：' + (response.officialEntryCount || 0) + ' 条，样本报价 ' + (response.officialSampleCount || 0) + ' 个。');
    });
  });

  on(sellerDiagnosticHarBtn, 'click', function () {
    exportCapturedHar('seller', '已导出后台诊断数据');
  });

  on(videoUploadDiagnosticHarBtn, 'click', function () {
    exportCapturedHar('ozon-video-upload', '已导出视频上传诊断 HAR');
  });

  on(officialDiagnosticHarBtn, 'click', function () {
    exportCapturedHar('official', '已导出官方参考诊断数据');
  });

  on(syncCommissionRatesBtn, 'click', syncCommissionRates);

  on(syncFxRatesBtn, 'click', syncFxRates);

  on(syncAllBtn, 'click', function () {
    var requestId = 'pull-all-' + Date.now();
    setDiagnostic(requestId, '同步中...', 'seller+official', 'warn');
    sendMessage({
      type: 'ozon-calculator:sync-captured-seller-official',
      selectedServiceIds: selectedServiceIdsFromState(),
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(configStatusNode, '一键同步失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        setDiagnostic(requestId, '失败', 'seller+official', 'error');
        return;
      }
      currentSnapshot = response.snapshot;
      draftSelectedIds = getSelectedIds(currentSnapshot);
      renderServiceList(currentSnapshot);
      renderSelectedServices();
      renderFeeForm(currentSnapshot);
      setDiagnostic(requestId, '成功', 'seller+official', 'success');
      var officialText = response.officialError
        ? ('official 未同步：' + response.officialError)
        : ('official ' + (response.officialEntryCount || 0) + ' 条');
      loadStatus('一键同步完成：seller ' + (response.sellerEntryCount || 0) + ' 条，' + officialText + '。请检查“我的物流集合”后保存。');
      if (!getSelectedIds(currentSnapshot).length) openServiceSelector();
    });
  });

  on(openSelectorBtn, 'click', openServiceSelector);

  on(saveServicesBtn, 'click', function () {
    saveUserConfig({ selectedServiceIds: draftSelectedIds }, '我的物流集合已保存。').then(function (saved) {
      if (saved) closeServiceSelector();
    });
  });

  on(cancelSelectorBtn, 'click', function () {
    draftSelectedIds = getSelectedIds(currentSnapshot);
    closeServiceSelector();
  });

  on(selectVisibleBtn, 'click', function () {
    var next = draftSelectedIds.slice();
    visibleServiceIds.forEach(function (id) {
      if (id && next.indexOf(id) < 0) next.push(id);
    });
    draftSelectedIds = next;
    renderServiceList(currentSnapshot);
    renderSelectedServices();
  });

  on(clearSelectionBtn, 'click', function () {
    draftSelectedIds = [];
    renderServiceList(currentSnapshot);
    renderSelectedServices();
  });

  on(serviceListNode, 'change', function (event) {
    var input = event.target;
    if (!input || input.type !== 'checkbox') return;
    toggleDraftService(input.value, input.checked);
    var item = input.closest('.service-item');
    if (item) item.classList.toggle('is-selected', input.checked);
  });

  on(selectedServiceListNode, 'click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
    if (!button) return;
    var action = button.getAttribute('data-action');
    var index = Number(button.getAttribute('data-index'));
    if (!Number.isFinite(index)) return;
    if (action === 'up') moveDraftSelection(index, -1);
    if (action === 'down') moveDraftSelection(index, 1);
    if (action === 'remove') {
      draftSelectedIds.splice(index, 1);
      renderServiceList(currentSnapshot);
      renderSelectedServices();
    }
  });

  // === ERP Connection ===
  var erpUrlInput = document.getElementById('erpUrlInput');
  var erpTokenInput = document.getElementById('erpTokenInput');
  var testErpBtn = document.getElementById('testErpBtn');
  var erpStatusNode = document.getElementById('erpStatus');
  var logisticsDeploymentInput = document.getElementById('logisticsDeploymentInput');
  var logisticsPairingCodeInput = document.getElementById('logisticsPairingCodeInput');
  var logisticsDeviceLabelInput = document.getElementById('logisticsDeviceLabelInput');
  var pairLogisticsDeviceBtn = document.getElementById('pairLogisticsDeviceBtn');
  var logisticsAssignmentSelect = document.getElementById('logisticsAssignmentSelect');
  var syncPublishedLogisticsBtn = document.getElementById('syncPublishedLogisticsBtn');
  var revokeLogisticsDeviceBtn = document.getElementById('revokeLogisticsDeviceBtn');
  var logisticsDistributionStatus = document.getElementById('logisticsDistributionStatus');
  var logisticsCaptureStatus = document.getElementById('logisticsCaptureStatus');
  var refreshLogisticsCaptureBtn = document.getElementById('refreshLogisticsCaptureBtn');
  var retryLogisticsCaptureBtn = document.getElementById('retryLogisticsCaptureBtn');
  var cancelLogisticsCaptureBtn = document.getElementById('cancelLogisticsCaptureBtn');
  var logisticsBindingProbeStatus = document.getElementById('logisticsBindingProbeStatus');
  var runLogisticsBindingProbeBtn = document.getElementById('runLogisticsBindingProbeBtn');
  var currentLogisticsCaptureTaskId = '';
  var logisticsDeviceIdKey = 'ss-erp:logistics-device-id';
  var logisticsDeploymentKey = 'ss-erp:logistics-deployment-id';

  function loadErpConfig() {
    chrome.storage.local.get(['ss_erp_connection', 'ozon-calc:erp-endpoint', 'ozon-calc:erp-token'], function (data) {
      var conn = data.ss_erp_connection || {};
      if (!conn.baseUrl && data['ozon-calc:erp-endpoint']) {
        conn.baseUrl = data['ozon-calc:erp-endpoint'].replace(/\/api\/collect$/, '');
      }
      if (!conn.token && data['ozon-calc:erp-token']) {
        conn.token = data['ozon-calc:erp-token'];
      }
      if (conn.baseUrl && conn.token) {
        chrome.storage.local.set({ ss_erp_connection: conn });
      }
      if (erpUrlInput && conn.baseUrl) erpUrlInput.value = conn.baseUrl;
      if (erpTokenInput && conn.token) erpTokenInput.value = conn.token;
    });
  }

  function renderLogisticsAssignments(assignments, selectedId) {
    if (!logisticsAssignmentSelect) return;
    var values = Array.isArray(assignments) ? assignments : [];
    logisticsAssignmentSelect.textContent = '';
    var automatic = document.createElement('option');
    automatic.value = '';
    automatic.textContent = values.length === 1 ? '自动：' + values[0].warehouseName : '请选择物流作用域';
    logisticsAssignmentSelect.appendChild(automatic);
    values.forEach(function (assignment) {
      var option = document.createElement('option');
      option.value = String(assignment.assignmentId || '');
      option.textContent = [
        assignment.shopName || assignment.shopId,
        assignment.warehouseName || assignment.warehouseId,
        assignment.originLabel,
        '→',
        assignment.destinationLabel,
      ].filter(Boolean).join(' · ');
      logisticsAssignmentSelect.appendChild(option);
    });
    if (selectedId && values.some(function (item) { return item.assignmentId === selectedId; })) {
      logisticsAssignmentSelect.value = selectedId;
    }
  }

  function ensureLogisticsDeviceId() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get([logisticsDeviceIdKey], function (data) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        var deviceId = String(data[logisticsDeviceIdKey] || '').trim();
        if (!deviceId) deviceId = crypto.randomUUID();
        chrome.storage.local.set({ [logisticsDeviceIdKey]: deviceId }, function () {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(deviceId);
        });
      });
    });
  }

  function loadLogisticsDistributionStatus() {
    chrome.storage.local.get([logisticsDeploymentKey], function (stored) {
      if (logisticsDeploymentInput && stored[logisticsDeploymentKey]) {
        logisticsDeploymentInput.value = stored[logisticsDeploymentKey];
      }
      sendMessage({ type: 'ss-erp:logistics-device-status' }).then(function (response) {
        var state = response && response.ok && response.data;
        if (!state || state.state !== 'paired') {
          setStatus(logisticsDistributionStatus, '设备未配对', 'warn');
          return;
        }
        if (logisticsDeploymentInput) logisticsDeploymentInput.value = state.deploymentId || '';
        setStatus(
          logisticsDistributionStatus,
          '已配对 · ' + (state.deploymentId || '') + ' · ' + (state.deviceId || ''),
          'success'
        );
      });
    });
  }

  function pairLogisticsDevice() {
    var baseUrl = String(erpUrlInput && erpUrlInput.value || '').trim().replace(/\/+$/, '');
    var deploymentId = String(logisticsDeploymentInput && logisticsDeploymentInput.value || '').trim();
    var code = String(logisticsPairingCodeInput && logisticsPairingCodeInput.value || '').trim();
    var deviceLabel = String(logisticsDeviceLabelInput && logisticsDeviceLabelInput.value || '').trim()
      || 'Chrome ' + navigator.platform;
    if (!baseUrl || !deploymentId || !code) {
      setStatus(logisticsDistributionStatus, '请填写 ERP 地址、部署标识和配对码', 'error');
      return Promise.resolve(false);
    }
    if (pairLogisticsDeviceBtn) pairLogisticsDeviceBtn.disabled = true;
    setStatus(logisticsDistributionStatus, '正在配对设备...', 'warn');
    return ensureLogisticsDeviceId().then(function (deviceId) {
      return sendMessage({
        type: 'ss-erp:logistics-device-claim',
        baseUrl: baseUrl,
        code: code,
        deploymentId: deploymentId,
        deviceId: deviceId,
        deviceLabel: deviceLabel,
      });
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(logisticsDistributionStatus, '设备配对失败', 'error');
        return false;
      }
      chrome.storage.local.set({ [logisticsDeploymentKey]: deploymentId });
      if (logisticsPairingCodeInput) logisticsPairingCodeInput.value = '';
      setStatus(logisticsDistributionStatus, '设备配对成功', 'success');
      return true;
    }).catch(function () {
      setStatus(logisticsDistributionStatus, '设备配对失败', 'error');
      return false;
    }).finally(function () {
      if (pairLogisticsDeviceBtn) pairLogisticsDeviceBtn.disabled = false;
    });
  }

  function syncPublishedLogistics() {
    var baseUrl = String(erpUrlInput && erpUrlInput.value || '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      setStatus(logisticsDistributionStatus, '请先填写 ERP 地址', 'error');
      return Promise.resolve(false);
    }
    if (syncPublishedLogisticsBtn) syncPublishedLogisticsBtn.disabled = true;
    setStatus(logisticsDistributionStatus, '正在同步已发布物流规则...', 'warn');
    return sendMessage({
      type: 'ss-erp:logistics-rules-sync',
      baseUrl: baseUrl,
      extensionVersion: chrome.runtime.getManifest().version,
      assignmentId: logisticsAssignmentSelect ? logisticsAssignmentSelect.value : '',
    }).then(function (response) {
      var result = response && response.ok && response.data;
      if (!result) {
        setStatus(logisticsDistributionStatus, '物流规则同步失败', 'error');
        return false;
      }
      if (Array.isArray(result.assignments)) {
        renderLogisticsAssignments(result.assignments, '');
      } else if (result.assignment) {
        renderLogisticsAssignments([result.assignment], result.assignment.assignmentId);
      }
      if (result.state === 'needs_selection') {
        setStatus(logisticsDistributionStatus, '请选择物流作用域后重新同步', 'warn');
        return false;
      }
      if (result.state === 'upgrade_required') {
        setStatus(logisticsDistributionStatus, '扩展版本过低，请先更新', 'error');
        return false;
      }
      if (result.state !== 'active' && result.state !== 'not_modified') {
        setStatus(logisticsDistributionStatus, '当前作用域暂无可用发布规则', 'warn');
        return false;
      }
      var assignment = result.assignment || {};
      setStatus(
        logisticsDistributionStatus,
        '同步完成 · ' + (assignment.originLabel || '') + ' → ' + (assignment.destinationLabel || ''),
        'success'
      );
      return true;
    }).catch(function () {
      setStatus(logisticsDistributionStatus, '物流规则同步失败', 'error');
      return false;
    }).finally(function () {
      if (syncPublishedLogisticsBtn) syncPublishedLogisticsBtn.disabled = false;
    });
  }

  function revokeLogisticsDevice() {
    return sendMessage({ type: 'ss-erp:logistics-device-clear' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(logisticsDistributionStatus, '解除配对失败', 'error');
        return false;
      }
      renderLogisticsAssignments([], '');
      setStatus(logisticsDistributionStatus, '设备已解除配对', 'warn');
      return true;
    });
  }

  function renderLogisticsBindingProbeState(value) {
    var state = value && typeof value === 'object' ? value : { state: 'idle' };
    var stateName = String(state.state || 'idle');
    var labels = {
      idle: '没有待验证的店铺或仓库',
      unpaired: '设备未配对',
      scope_missing: '设备缺少物流采集权限',
      pending: '等待当前 Seller 仓库信息',
      submitted: '验证证据已提交，等待管理员确认',
      scope_mismatch: '当前设备、店铺或仓库与验证任务不一致',
      expired: '验证任务已过期，请管理员重新签发',
      replayed: '验证任务已使用，请管理员检查结果',
      unavailable: '验证任务不可用',
      revoked: '设备授权已撤销，请重新配对',
      retryable: '验证请求暂时失败，可以重试',
      rejected: '验证证据被服务器拒绝',
    };
    var message = labels[stateName] || ('验证状态：' + stateName);
    if (state.probeId) message += ' · probe ' + String(state.probeId);
    var tone = stateName === 'submitted' ? 'success'
      : ['scope_mismatch', 'expired', 'replayed', 'unavailable', 'revoked', 'rejected'].indexOf(stateName) >= 0
        ? 'error'
        : stateName === 'idle' ? '' : 'warn';
    setStatus(logisticsBindingProbeStatus, message, tone);
  }

  function loadLogisticsBindingProbeStatus() {
    return sendMessage({ type: 'ss-erp:logistics-binding-probe-status' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(logisticsBindingProbeStatus, '无法读取店铺仓库验证状态', 'error');
        return null;
      }
      renderLogisticsBindingProbeState(response.data);
      return response.data;
    });
  }

  function runLogisticsBindingProbe() {
    if (runLogisticsBindingProbeBtn) runLogisticsBindingProbeBtn.disabled = true;
    setStatus(logisticsBindingProbeStatus, '正在验证当前 Seller 店铺与仓库...', 'warn');
    return sendMessage({
      type: 'ss-erp:logistics-binding-probe-run',
      extensionVersion: chrome.runtime.getManifest().version,
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(logisticsBindingProbeStatus, '店铺仓库验证失败', 'error');
        return false;
      }
      renderLogisticsBindingProbeState(response.data);
      return true;
    }).finally(function () {
      if (runLogisticsBindingProbeBtn) runLogisticsBindingProbeBtn.disabled = false;
    });
  }

  function renderLogisticsCaptureState(value) {
    var state = value && typeof value === 'object' ? value : { state: 'idle' };
    var stateName = String(state.state || 'idle');
    currentLogisticsCaptureTaskId = String(state.taskId || '');
    var terminal = ['idle', 'uploaded', 'cancelled', 'task_unavailable', 'revoked'].indexOf(stateName) >= 0;
    if (cancelLogisticsCaptureBtn) {
      cancelLogisticsCaptureBtn.disabled = !currentLogisticsCaptureTaskId || terminal;
    }
    var labels = {
      idle: '没有待处理采集任务',
      unpaired: '设备未配对',
      scope_missing: '设备缺少物流采集权限',
      waiting_for_provider_inventory: '等待完整 Provider 数据',
      waiting_for_capture: '等待 Seller / Official 页面数据',
      collecting: '正在读取 Provider 与发运点',
      ready_to_upload: '采集完成，正在提交候选',
      uploaded: '候选已提交，等待 ERP 审核',
      cancelled: '采集任务已取消',
      retryable: '采集暂时失败，可以重试',
      task_unavailable: '采集任务已失效',
      revoked: '设备授权已撤销',
      rejected: '采集候选被服务器拒绝',
      http_error: '采集接口请求失败',
    };
    var detail = [];
    if (currentLogisticsCaptureTaskId) detail.push('task ' + currentLogisticsCaptureTaskId);
    if (state.candidateId) detail.push('candidate ' + state.candidateId);
    var message = labels[stateName] || ('采集状态：' + stateName);
    if (detail.length) message += ' · ' + detail.join(' · ');
    var tone = stateName === 'uploaded' ? 'success'
      : ['revoked', 'rejected', 'http_error'].indexOf(stateName) >= 0 ? 'error'
        : stateName === 'idle' ? '' : 'warn';
    setStatus(logisticsCaptureStatus, message, tone);
  }

  function loadLogisticsCaptureStatus() {
    return sendMessage({ type: 'ss-erp:logistics-capture-status' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(logisticsCaptureStatus, '无法读取物流采集状态', 'error');
        return null;
      }
      renderLogisticsCaptureState(response.data);
      return response.data;
    });
  }

  function runLogisticsCapture(type) {
    if (refreshLogisticsCaptureBtn) refreshLogisticsCaptureBtn.disabled = true;
    if (retryLogisticsCaptureBtn) retryLogisticsCaptureBtn.disabled = true;
    setStatus(logisticsCaptureStatus, type === 'ss-erp:logistics-capture-retry'
      ? '正在重试物流采集...' : '正在刷新并采集物流数据...', 'warn');
    return sendMessage({
      type: type,
      extensionVersion: chrome.runtime.getManifest().version,
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(logisticsCaptureStatus, '物流采集操作失败', 'error');
        return false;
      }
      renderLogisticsCaptureState(response.data);
      return true;
    }).finally(function () {
      if (refreshLogisticsCaptureBtn) refreshLogisticsCaptureBtn.disabled = false;
      if (retryLogisticsCaptureBtn) retryLogisticsCaptureBtn.disabled = false;
    });
  }

  function cancelLogisticsCapture() {
    if (!currentLogisticsCaptureTaskId) return Promise.resolve(false);
    if (cancelLogisticsCaptureBtn) cancelLogisticsCaptureBtn.disabled = true;
    return sendMessage({
      type: 'ss-erp:logistics-capture-cancel',
      taskId: currentLogisticsCaptureTaskId,
      extensionVersion: chrome.runtime.getManifest().version,
    }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(logisticsCaptureStatus, '取消采集任务失败', 'error');
        return false;
      }
      renderLogisticsCaptureState(response.data);
      return true;
    }).finally(function () {
      if (cancelLogisticsCaptureBtn) cancelLogisticsCaptureBtn.disabled = !currentLogisticsCaptureTaskId;
    });
  }

  function saveErpConfig() {
    var conn = {
      baseUrl: (erpUrlInput && erpUrlInput.value || '').trim().replace(/\/+$/, ''),
      token: (erpTokenInput && erpTokenInput.value || '').trim(),
    };
    chrome.storage.local.set({
      ss_erp_connection: conn,
      'ozon-calc:erp-endpoint': conn.baseUrl ? conn.baseUrl + '/api/collect' : '',
      'ozon-calc:erp-token': conn.token,
    });
    return conn;
  }

  on(testErpBtn, 'click', function () {
    var conn = saveErpConfig();
    if (!conn.baseUrl || !conn.token) {
      if (erpStatusNode) erpStatusNode.textContent = '请填写 ERP 地址和 Token';
      return;
    }
    if (erpStatusNode) erpStatusNode.textContent = '连接中...';
    fetch(conn.baseUrl + '/api/user/me', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + conn.token },
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.code === 1 && d.data) {
        erpStatusNode.textContent = '连接成功: ' + (d.data.nickname || d.data.phone);
        erpStatusNode.style.color = '#16a34a';
      } else {
        erpStatusNode.textContent = '连接失败: ' + (d.msg || '未知错误');
        erpStatusNode.style.color = '#dc2626';
      }
    })
    .catch(function (err) {
      erpStatusNode.textContent = '无法连接: ' + err.message;
      erpStatusNode.style.color = '#dc2626';
    });
  });

  if (erpUrlInput) erpUrlInput.addEventListener('blur', saveErpConfig);
  if (erpTokenInput) erpTokenInput.addEventListener('blur', saveErpConfig);
  on(pairLogisticsDeviceBtn, 'click', pairLogisticsDevice);
  on(syncPublishedLogisticsBtn, 'click', syncPublishedLogistics);
  on(revokeLogisticsDeviceBtn, 'click', revokeLogisticsDevice);
  on(runLogisticsBindingProbeBtn, 'click', runLogisticsBindingProbe);
  on(refreshLogisticsCaptureBtn, 'click', function () { runLogisticsCapture('ss-erp:logistics-capture-refresh'); });
  on(retryLogisticsCaptureBtn, 'click', function () { runLogisticsCapture('ss-erp:logistics-capture-retry'); });
  on(cancelLogisticsCaptureBtn, 'click', cancelLogisticsCapture);
  loadErpConfig();
  if (logisticsDistributionEnabled) {
  loadLogisticsDistributionStatus();
  loadLogisticsBindingProbeStatus();
  loadLogisticsCaptureStatus();
  window.setInterval(loadLogisticsCaptureStatus, 5000);
  }

  // === Extra Fee Rules ===
  var extraFeeRules = [];
  var extraFeeContainer = document.getElementById('extraFeeRulesContainer');
  var addExtraFeeRuleBtn = document.getElementById('addExtraFeeRuleBtn');

  // === Shop Analytics Sync ===
  var analyticsShopSelect = document.getElementById('analyticsShopSelect');
  var syncAnalyticsBtn = document.getElementById('syncAnalyticsBtn');
  var syncGraphsBtn = document.getElementById('syncGraphsBtn');
  var analyticsStatusNode = document.getElementById('analyticsStatus');

  function setAnalyticsStatus(text, tone) {
    if (!analyticsStatusNode) return;
    analyticsStatusNode.textContent = text || '';
    analyticsStatusNode.style.color = tone === 'error' ? '#dc2626' : tone === 'success' ? '#16a34a' : '#64748b';
  }

  function loadAnalyticsShops() {
    sendMessage({ type: 'spb-self-hosted:get-ozon-shops' }).then(function (response) {
      if (!analyticsShopSelect) return;
      if (!response || !response.ok) {
        analyticsShopSelect.innerHTML = '<option value="">获取失败，请先配置 ERP 连接</option>';
        return;
      }
      var shops = response.data || [];
      if (!shops.length) {
        analyticsShopSelect.innerHTML = '<option value="">没有 OZON 店铺</option>';
        return;
      }
      analyticsShopSelect.innerHTML = shops.map(function (shop) {
        return '<option value="' + shop.id + '">' + escapeHtml(shop.name) + '</option>';
      }).join('');
    });
  }

  function sendSellerAnalyticsMessage(type, shopId) {
    return sendMessage({
      type: type,
      shopId: shopId || undefined
    });
  }

  on(syncAnalyticsBtn, 'click', function () {
    var shopId = analyticsShopSelect ? analyticsShopSelect.value : '';
    if (!shopId) {
      setAnalyticsStatus('请先选择店铺', 'error');
      return;
    }
    setAnalyticsStatus('正在请求 seller.ozon.ru 访问权限...', '');
    runSellerOzonAction(function () {
      setAnalyticsStatus('正在从 seller.ozon.ru 获取分析数据并推送到 ERP...', '');
      return sendSellerAnalyticsMessage('spb-self-hosted:sync-shop-analytics', shopId);
    }).then(function (response) {
      if (!response || !response.ok) {
        setAnalyticsStatus('同步失败: ' + (response && response.error ? response.error : '未知错误'), 'error');
        return;
      }
      var count = response.data && response.data.itemCount ? response.data.itemCount : 0;
      setAnalyticsStatus('同步成功: ' + count + ' 条商品分析数据已推送到 ERP', 'success');
    });
  });

  on(syncGraphsBtn, 'click', function () {
    var shopId = analyticsShopSelect ? analyticsShopSelect.value : '';
    if (!shopId) {
      setAnalyticsStatus('请先选择店铺', 'error');
      return;
    }
    setAnalyticsStatus('正在请求 seller.ozon.ru 访问权限...', '');
    runSellerOzonAction(function () {
      setAnalyticsStatus('正在从 seller.ozon.ru 获取 V3 经营数据（含环比+AI推荐）...', '');
      return sendSellerAnalyticsMessage('spb-self-hosted:sync-shop-graphs', shopId);
    }).then(function (response) {
      if (!response || !response.ok) {
        setAnalyticsStatus('同步失败: ' + (response && response.error ? response.error : '未知错误'), 'error');
        return;
      }
      var d = response.data || {};
      var skuCount = d.tableData && d.tableData.items ? d.tableData.items.length : 0;
      var recCount = d.recommendations && d.recommendations.items ? d.recommendations.items.length : 0;
      var msg = '同步成功：' + skuCount + ' 条SKU数据';
      if (recCount > 0) msg += ' + ' + recCount + ' 条AI推荐';
      if (d.salesFunnel && !d.salesFunnel.error) msg += ' + 销售漏斗';
      msg += ' 已推送到 ERP';
      setAnalyticsStatus(msg, 'success');
    });
  });

  var testMarketApisBtn = document.getElementById('testMarketApisBtn');
  var marketApiResults = document.getElementById('marketApiResults');

  on(testMarketApisBtn, 'click', function () {
    setAnalyticsStatus('正在请求 seller.ozon.ru 访问权限...', '');
    if (marketApiResults) { marketApiResults.style.display = 'none'; marketApiResults.innerHTML = ''; }
    runSellerOzonAction(function () {
      setAnalyticsStatus('正在检查市场数据权限（搜索词/趋势/爆品/竞争定位）...', '');
      var shopId = analyticsShopSelect ? analyticsShopSelect.value : '';
      return sendSellerAnalyticsMessage('spb-self-hosted:test-market-apis', shopId);
    }).then(function (response) {
      if (!response || !response.ok) {
        setAnalyticsStatus('检查失败: ' + (response && response.error ? response.error : '未知错误'), 'error');
        return;
      }
      var results = response.data || {};
      var available = [];
      var blocked = [];
      var apiNames = {
        allQueries: '搜索词分析 (Premium)',
        trends: '市场趋势 (Premium)',
        bestsellers: '爆品数据 (Premium)',
        competitivePosition: '竞争定位 (Premium)',
        salesFunnel: '销售漏斗',
        categoryTree: '品类树',
        chartsV3: '经营图表（新版）',
        chartsLegacy: '经营图表（旧版）',
        whatToSellOwn: '店铺商品分析'
      };
      Object.keys(results).forEach(function (key) {
        var name = apiNames[key] || key;
        if (results[key].available) {
          available.push(name + (results[key].sampleCount != null ? ' (' + results[key].sampleCount + '条)' : ''));
        } else {
          blocked.push(name + ': ' + (results[key].error || '不可用'));
        }
      });
      var summary = '';
      if (available.length) summary += '可用: ' + available.join(', ');
      if (blocked.length) summary += (summary ? ' | ' : '') + '不可用: ' + blocked.length + '个';
      setAnalyticsStatus(summary, available.length > 0 ? 'success' : 'error');

      if (marketApiResults) {
        var html = '<div style="font-size:12px;line-height:1.6;padding:8px 12px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">';
        html += '<strong>市场数据检查结果:</strong><br>';
        Object.keys(results).forEach(function (key) {
          var r = results[key];
          var name = apiNames[key] || key;
          var icon = r.available ? '&#9989;' : '&#10060;';
          html += icon + ' <b>' + name + '</b>: ';
          if (r.available) {
            html += '可用';
            if (r.sampleCount != null) html += ' (返回 ' + r.sampleCount + ' 条数据)';
          } else {
            html += '<span style="color:#dc2626;">' + escapeHtml(r.error || '不可用') + '</span>';
          }
          html += '<br>';
        });
        html += '</div>';
        marketApiResults.innerHTML = html;
        marketApiResults.style.display = 'block';
      }
    });
  });

  loadAnalyticsShops();

  function renderExtraFeeRules() {
    if (!extraFeeContainer) return;
    extraFeeContainer.innerHTML = '';
    extraFeeRules.forEach(function (rule, i) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
      row.innerHTML =
        '<select data-idx="' + i + '" style="height:28px;border:1px solid #ddd;border-radius:4px;font-size:12px;padding:0 4px;">' +
          '<option value="percent"' + (rule.type === 'percent' ? ' selected' : '') + '>百分比</option>' +
          '<option value="fixed"' + (rule.type === 'fixed' ? ' selected' : '') + '>固定金额</option>' +
        '</select>' +
        '<input type="text" data-idx="' + i + '" data-field="label" value="' + (rule.label || '') + '" placeholder="名称" style="height:28px;border:1px solid #ddd;border-radius:4px;padding:0 6px;font-size:12px;flex:1;">' +
        '<input type="number" data-idx="' + i + '" data-field="value" value="' + (rule.type === 'percent' ? (rule.percent || '') : (rule.amount || '')) + '" placeholder="' + (rule.type === 'percent' ? '%' : '¥') + '" step="0.1" min="0" style="height:28px;width:70px;border:1px solid #ddd;border-radius:4px;padding:0 6px;font-size:12px;">' +
        '<span style="font-size:11px;color:#888;width:14px;">' + (rule.type === 'percent' ? '%' : '¥') + '</span>' +
        '<button data-idx="' + i + '" style="height:24px;width:24px;border:none;background:#fee2e2;color:#dc2626;border-radius:4px;cursor:pointer;font-size:12px;">×</button>';
      extraFeeContainer.appendChild(row);
    });

    extraFeeContainer.querySelectorAll('select').forEach(function (el) {
      el.addEventListener('change', function () {
        extraFeeRules[Number(this.dataset.idx)].type = this.value;
        renderExtraFeeRules();
        saveExtraFeeRules();
      });
    });
    extraFeeContainer.querySelectorAll('input[data-field="label"]').forEach(function (el) {
      el.addEventListener('input', function () {
        extraFeeRules[Number(this.dataset.idx)].label = this.value;
        saveExtraFeeRules();
      });
    });
    extraFeeContainer.querySelectorAll('input[data-field="value"]').forEach(function (el) {
      el.addEventListener('input', function () {
        var idx = Number(this.dataset.idx);
        var val = parseFloat(this.value) || 0;
        if (extraFeeRules[idx].type === 'percent') extraFeeRules[idx].percent = val;
        else extraFeeRules[idx].amount = val;
        saveExtraFeeRules();
      });
    });
    extraFeeContainer.querySelectorAll('button').forEach(function (el) {
      el.addEventListener('click', function () {
        extraFeeRules.splice(Number(this.dataset.idx), 1);
        renderExtraFeeRules();
        saveExtraFeeRules();
      });
    });
  }

  function saveExtraFeeRules() {
    chrome.storage.local.set({ ss_erp_extra_fee_rules: extraFeeRules });
  }

  function loadExtraFeeRules() {
    chrome.storage.local.get('ss_erp_extra_fee_rules', function (data) {
      extraFeeRules = data.ss_erp_extra_fee_rules || [];
      renderExtraFeeRules();
    });
  }

  on(addExtraFeeRuleBtn, 'click', function () {
    extraFeeRules.push({ type: 'percent', label: '', percent: 0 });
    renderExtraFeeRules();
  });

  loadExtraFeeRules();

  on(serviceSearchInput, 'input', function () {
    renderServiceList(currentSnapshot);
  });

  on(serviceModal, 'click', function (event) {
    if (event.target === serviceModal) {
      draftSelectedIds = getSelectedIds(currentSnapshot);
      closeServiceSelector();
    }
  });

  on(document, 'keydown', function (event) {
    if (event.key === 'Escape' && serviceModal && !serviceModal.hidden) {
      draftSelectedIds = getSelectedIds(currentSnapshot);
      closeServiceSelector();
    }
  });

  on(saveFeeSettingsBtn, 'click', function () {
    saveFeeSettings('费用默认值已保存。');
  });

  on(autoCommissionSyncInput, 'change', function () {
    saveFeeSettings(autoCommissionSyncInput.checked ? '已开启自动佣金同步。' : '已关闭自动佣金同步。');
  });

  on(autoFxSyncInput, 'change', function () {
    saveFeeSettings(autoFxSyncInput.checked ? '已开启自动汇率同步。' : '已关闭自动汇率同步。');
  });

  on(resolutionLowestInput, 'change', function () {
    if (resolutionLowestInput.checked) saveUserConfig({ resolutionMode: 'lowest_cost' }, '自动命中策略已保存：最低运费优先。');
  });

  on(resolutionPriorityInput, 'change', function () {
    if (resolutionPriorityInput.checked) saveUserConfig({ resolutionMode: 'priority' }, '自动命中策略已保存：用户优先级优先。');
  });

  on(importBtn, 'click', function () {
    if (fileInput) fileInput.click();
  });

  on(exportSyncFileBtn, 'click', exportCurrentSnapshot);

  on(fileInput, 'change', function (event) {
    var file = event.target && event.target.files ? event.target.files[0] : null;
    if (!file) return;
    file.text().then(function (rawText) {
      importSnapshot(JSON.parse(rawText));
    }).catch(function (error) {
      setStatus(configStatusNode, '读取文件失败：' + (error && error.message ? error.message : String(error)), 'error');
    }).finally(function () {
      event.target.value = '';
    });
  });

  on(guideToggleBtn, 'click', function () {
    if (!guideBody) return;
    var willOpen = guideBody.hidden;
    guideBody.hidden = !willOpen;
    guideToggleBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  on(document.getElementById('sellerLogisticsJsonBtn'), 'click', function () {
    exportDiagnostic('ozon-calc:seller-logistics-export', 'json', '已导出后台物流模板 JSON');
  });

  on(document.getElementById('sellerLogisticsCsvBtn'), 'click', function () {
    exportDiagnostic('ozon-calc:seller-logistics-export', 'csv', '已导出后台物流模板 CSV');
  });

  on(document.getElementById('officialFreightJsonBtn'), 'click', function () {
    exportDiagnostic('ozon-calc:official-freight-export', 'json', '已导出官方运费参考 JSON');
  });

  on(document.getElementById('officialFreightCsvBtn'), 'click', function () {
    exportDiagnostic('ozon-calc:official-freight-export', 'csv', '已导出官方运费参考 CSV');
  });

  on(clearBtn, 'click', function () {
    sendMessage({ type: 'ozon-calculator:clear-captured-har' }).then(function (response) {
      if (!response || !response.ok) {
        setStatus(diagnosticStatusNode, '清空失败：' + (response && response.error ? response.error : '未知错误'), 'error');
        return;
      }
      setStatus(diagnosticStatusNode, '诊断数据已清空。', 'success');
      loadStatus();
    });
  });

  renderExtensionVersion();
  renderHealthSummary();
  loadStatus();
}());
