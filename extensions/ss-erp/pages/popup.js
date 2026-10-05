(function () {
  'use strict';

  var SYNC_STORAGE_KEY = 'ss_erp_sync_times';
  var SOURCE_SEARCH_PLATFORM_PREFS_KEY = 'ss-erp:source-search-platforms';
  var SOURCE_SEARCH_PLATFORM_OPTIONS = [
    { platform: '1688', label: '1688' },
    { platform: 'pdd', label: 'PDD' },
    { platform: 'taobao', label: '淘宝' }
  ];
  var DEFAULT_SOURCE_SEARCH_PLATFORMS = ['1688', 'pdd'];
  var STALE_THRESHOLD = 24 * 60 * 60 * 1000;

  var erpStatusRow = document.getElementById('erpStatus');
  var ozonStatusRow = document.getElementById('ozonStatus');
  var analyticsSyncTime = document.getElementById('analyticsSyncTime');
  var graphsSyncTime = document.getElementById('graphsSyncTime');
  var syncAnalyticsBtn = document.getElementById('syncAnalyticsBtn');
  var syncGraphsBtn = document.getElementById('syncGraphsBtn');
  var sellerCountNode = document.getElementById('sellerCount');
  var selectedCountNode = document.getElementById('selectedCount');
  var allCountNode = document.getElementById('allCount');
  var openSettingsBtn = document.getElementById('openSettingsBtn');
  var versionText = document.getElementById('versionText');
  var exportSourceQuotesBtn = document.getElementById('exportSourceQuotesBtn');
  var activePageLabel = document.getElementById('activePageLabel');
  var primaryActionTitle = document.getElementById('primaryActionTitle');
  var primaryActionHint = document.getElementById('primaryActionHint');
  var primaryActionBtn = document.getElementById('primaryActionBtn');
  var secondaryActionBtn = document.getElementById('secondaryActionBtn');
  var sourceSearchPlatformPrefs = document.getElementById('sourceSearchPlatformPrefs');
  var primaryActionStatus = document.getElementById('primaryActionStatus');
  var primaryActionState = { type: 'loading', tab: null, productId: '' };
  var primaryActionRevision = 0;
  var secondaryActionState = { type: 'hidden' };
  var sourceSearchPlatformSelection = DEFAULT_SOURCE_SEARCH_PLATFORMS.slice();

  var manifest = chrome.runtime.getManifest();
  if (versionText) versionText.textContent = 'v' + (manifest.version || '1.0.0');

  function setText(node, text) {
    if (node) node.textContent = text == null ? '' : String(text);
  }

  function setActionStatus(text, kind) {
    if (!primaryActionStatus) return;
    primaryActionStatus.textContent = text || '';
    primaryActionStatus.className = 'action-status' + (kind ? ' ' + kind : '');
  }

  function setPrimaryAction(state) {
    primaryActionRevision += 1;
    primaryActionState = state || { type: 'unsupported', tab: null, productId: '' };
    setText(activePageLabel, primaryActionState.label || '当前页面');
    setText(primaryActionTitle, primaryActionState.title || '当前页面暂不支持');
    setText(primaryActionHint, primaryActionState.hint || '');
    if (primaryActionBtn) {
      primaryActionBtn.disabled = Boolean(primaryActionState.disabled);
      primaryActionBtn.textContent = primaryActionState.buttonText || '打开设置';
    }
    setSecondaryAction(primaryActionState.secondaryAction || null);
    setActionStatus('', '');
  }

  function setSecondaryAction(action) {
    secondaryActionState = action || { type: 'hidden' };
    if (!secondaryActionBtn) return;
    var hidden = !action || action.type === 'hidden';
    secondaryActionBtn.hidden = hidden;
    secondaryActionBtn.disabled = hidden || Boolean(action && action.disabled);
    secondaryActionBtn.textContent = action && action.buttonText ? action.buttonText : '找同款';
    renderSourceSearchPlatformPrefs(action && action.type === 'searchSourcesByImage');
  }

  function normalizeSourceSearchPlatforms(value) {
    var allowed = {};
    SOURCE_SEARCH_PLATFORM_OPTIONS.forEach(function (option) {
      allowed[option.platform] = true;
    });
    var selected = [];
    (Array.isArray(value) ? value : []).forEach(function (item) {
      var platform = String(item || '').trim().toLowerCase();
      if (platform === 'ali1688') platform = '1688';
      if (platform === 'pinduoduo') platform = 'pdd';
      if (platform === 'tb') platform = 'taobao';
      if (allowed[platform] && selected.indexOf(platform) < 0) selected.push(platform);
    });
    return selected.length ? selected : DEFAULT_SOURCE_SEARCH_PLATFORMS.slice();
  }

  function getSourceSearchPlatformInput(platform) {
    return document.querySelector('[data-source-search-platform="' + platform + '"]');
  }

  function renderSourceSearchPlatformPrefs(visible) {
    if (!sourceSearchPlatformPrefs) return;
    sourceSearchPlatformPrefs.hidden = !visible;
    SOURCE_SEARCH_PLATFORM_OPTIONS.forEach(function (option) {
      var input = getSourceSearchPlatformInput(option.platform);
      if (input) input.checked = sourceSearchPlatformSelection.indexOf(option.platform) >= 0;
    });
  }

  function loadSourceSearchPlatformPrefs() {
    chrome.storage.local.get([SOURCE_SEARCH_PLATFORM_PREFS_KEY], function (result) {
      sourceSearchPlatformSelection = normalizeSourceSearchPlatforms(result[SOURCE_SEARCH_PLATFORM_PREFS_KEY]);
      renderSourceSearchPlatformPrefs(secondaryActionState.type === 'searchSourcesByImage');
    });
  }

  function getSelectedSourceSearchPlatforms() {
    var selected = [];
    SOURCE_SEARCH_PLATFORM_OPTIONS.forEach(function (option) {
      var input = getSourceSearchPlatformInput(option.platform);
      if (input && input.checked) selected.push(option.platform);
    });
    return selected;
  }

  function saveSourceSearchPlatformPrefs(event) {
    var selected = getSelectedSourceSearchPlatforms();
    if (!selected.length) {
      if (event && event.target) event.target.checked = true;
      setActionStatus('至少保留一个核价网站', 'fail');
      return;
    }
    sourceSearchPlatformSelection = selected;
    chrome.storage.local.set({ [SOURCE_SEARCH_PLATFORM_PREFS_KEY]: selected });
    setActionStatus('已保存核价网站：' + selected.map(function (platform) {
      var option = SOURCE_SEARCH_PLATFORM_OPTIONS.find(function (item) { return item.platform === platform; });
      return option ? option.label : platform;
    }).join(' / '), 'ok');
  }

  function setStatus(row, connected, label) {
    if (!row) return;
    var dot = row.querySelector('.dot');
    var val = row.querySelector('.status-value');
    if (dot) {
      dot.className = 'dot ' + (connected ? 'dot-green' : 'dot-red');
    }
    if (val) val.textContent = label || (connected ? '已连接' : '未连接');
  }

  function formatRuntimeError(message) {
    var text = String(message || '');
    if (/Extension context invalidated|context invalidated|Receiving end does not exist/i.test(text)) {
      return '扩展刚刚被重新加载，请关闭并重新打开扩展弹窗后重试。';
    }
    return text || '扩展后台未响应';
  }

  function formatErpCollectTargetLabel(connection) {
    connection = connection && typeof connection === 'object' ? connection : {};
    var user = connection.user && typeof connection.user === 'object' ? connection.user : {};
    var account = user.accountCode || user.phone || user.nickname || (user.id ? ('ID ' + String(user.id).slice(0, 8)) : '');
    var baseUrl = normalizeErpBaseUrl(connection.baseUrl || '');
    var host = '';
    try {
      host = baseUrl ? new URL(baseUrl).host : '';
    } catch {
      host = baseUrl.replace(/^https?:\/\//, '');
    }
    var parts = [account, host].filter(Boolean);
    return parts.length ? '（' + parts.join(' · ') + '）' : '';
  }

  function requestSellerOzonAccess(callback) {
    var access = globalThis.SS_ERP_SELLER_ORIGIN_ACCESS;
    if (!access || typeof access.request !== 'function') {
      callback({ ok: false, error: 'Seller 站点权限组件未加载，请重新加载扩展后重试。' });
      return;
    }
    access.request(function (result) {
      callback(result && result.ok ? result : {
        ok: false,
        errorCode: result && result.errorCode,
        error: formatRuntimeError(result && result.error),
      });
    });
  }

  function sendRuntimeMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          callback({ ok: false, error: formatRuntimeError(chrome.runtime.lastError.message) });
          return;
        }
        callback(response || { ok: false, error: '无响应' });
      });
    } catch (error) {
      callback({ ok: false, error: formatRuntimeError(error && error.message ? error.message : String(error)) });
    }
  }

  function getActiveTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      callback(tabs && tabs.length ? tabs[0] : null);
    });
  }

  function getHost(url) {
    try {
      return new URL(url || '').hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function parseOzonProductId(url) {
    var path = String(url || '').split(/[?#]/)[0];
    var match = path.match(/(?:-|\/)([0-9]{6,})\/?$/i);
    return match ? match[1] : '';
  }

  function isOzonProductUrl(url) {
    return /^https:\/\/(?:www\.)?ozon\.(?:ru|kz|by)\/product\//i.test(String(url || ''));
  }

  function detectSourcePlatform(host) {
    if (host.indexOf('1688.com') >= 0) return '1688';
    if (host.indexOf('pinduoduo.com') >= 0 || host.indexOf('yangkeduo.com') >= 0) return 'pdd';
    if (host.indexOf('taobao.com') >= 0) return 'taobao';
    if (host.indexOf('tmall.com') >= 0) return 'tmall';
    return '';
  }

  function sourcePlatformLabel(platform) {
    return { '1688': '1688', pdd: 'PDD', taobao: '淘宝', tmall: '天猫' }[platform] || '货源';
  }

  function buildOzonCandidateContext(tab, productId, product) {
    product = product && typeof product === 'object' ? product : {};
    return {
      productId: product.productId || productId || parseOzonProductId(tab && tab.url),
      title: product.title || product.sourceTitleRaw || (tab && tab.title ? tab.title : ''),
      url: product.sourceUrl || (tab && tab.url ? tab.url : ''),
      price: { value: product.pagePriceValue || product.price || product.currentPriceValue || 0, currency: product.pagePriceCurrency || product.currency || 'RUB' },
      currentPriceValue: product.currentPriceValue || product.pagePriceValue || product.price || 0,
      pagePriceValue: product.pagePriceValue || product.price || 0,
      pagePriceCurrency: product.pagePriceCurrency || product.currency || 'RUB',
      weightG: product.weightG || product.grossWeightGrams || 0,
      categoryHints: [product.categoryName, product.title, product.sourceTitleRaw].filter(Boolean)
    };
  }

  function rememberOzonCandidateContext(tab, productId, product) {
    var ozon = buildOzonCandidateContext(tab, productId, product);
    if (!ozon.productId && !ozon.url) return;
    sendRuntimeMessage({
      type: 'ss-erp:source-candidate-context-save',
      payload: { ozon: ozon }
    }, function (response) {
      if (!response || !response.ok) {
        console.warn('[popup] source candidate context save failed:', response && response.error);
      }
    });
  }

  function updateSourceContextHint(host) {
    sendRuntimeMessage({ type: 'ss-erp:source-candidate-context-get' }, function (response) {
      if (!response || !response.ok || primaryActionState.type !== 'openPrecisionWorkbench' || !secondaryActionBtn) return;
      var ozon = response.context && response.context.ozon;
      if (ozon && (ozon.productId || ozon.title)) {
        var label = ozon.productId ? ('Ozon ' + ozon.productId) : String(ozon.title).slice(0, 16);
        secondaryActionBtn.title = host + ' · 核价将回填 ' + label;
      } else {
        secondaryActionBtn.title = host + ' · 在 Ozon 商品页选择“核价找货源”建立关联';
      }
    });
  }

  function configurePrimaryAction() {
    getActiveTab(function (tab) {
      var url = tab && tab.url ? tab.url : '';
      var host = getHost(url);
      var sourcePlatform = detectSourcePlatform(host);

      if (!tab || !url) {
        setPrimaryAction({
          type: 'unsupported',
          label: '未识别页面',
          title: '打开设置',
          hint: '未读取到当前标签页。',
          buttonText: '打开设置'
        });
        return;
      }

      if (isOzonProductUrl(url)) {
        var productId = parseOzonProductId(url);
        rememberOzonCandidateContext(tab, productId);
        setPrimaryAction({
          type: 'collectOzonToErp',
          tab: tab,
          productId: productId,
          sourceUrl: url,
          label: 'Ozon 商品页',
          title: '采集到 ERP',
          hint: productId ? ('SKU ' + productId + ' · 货源将自动关联') : '未识别 SKU',
          buttonText: '采集到 ERP',
          disabled: !productId,
          secondaryAction: {
            type: 'searchSourcesByImage',
            tab: tab,
            productId: productId,
            buttonText: '核价找货源',
            disabled: !productId
          }
        });
        return;
      }

      if (sourcePlatform) {
        setPrimaryAction({
          type: 'openPrecisionWorkbench',
          tab: tab,
          sourcePlatform: sourcePlatform,
          label: sourcePlatformLabel(sourcePlatform) + ' 货源页',
          title: '精铺工作台',
          hint: host + ' · 在当前商品页选择 SKU、编辑价格和处理图片',
          buttonText: '打开精铺工作台',
          secondaryAction: {
            type: 'quoteSourcePage',
            tab: tab,
            buttonText: '货源核价'
          }
        });
        updateSourceContextHint(host);
        return;
      }

      if (host === 'seller.ozon.ru') {
        setPrimaryAction({
          type: 'syncCookie',
          tab: tab,
          label: 'Ozon Seller',
          title: '同步 Cookie',
          hint: '当前店铺认证',
          buttonText: '同步 Cookie'
        });
        return;
      }

      setPrimaryAction({
        type: 'unsupported',
        tab: tab,
        label: '普通页面',
        title: '打开设置',
        hint: host || 'chrome 页面',
        buttonText: '打开设置'
      });
    });
  }

  function setPrimaryButtonBusy(text) {
    if (!primaryActionBtn) return;
    primaryActionBtn.disabled = true;
    primaryActionBtn.textContent = text || '处理中...';
  }

  function restorePrimaryButton() {
    if (!primaryActionBtn) return;
    primaryActionBtn.disabled = Boolean(primaryActionState.disabled);
    primaryActionBtn.textContent = primaryActionState.buttonText || '打开设置';
  }

  function setSecondaryButtonBusy(text) {
    if (!secondaryActionBtn) return;
    secondaryActionBtn.disabled = true;
    secondaryActionBtn.textContent = text || '处理中...';
  }

  function restoreSecondaryButton() {
    if (!secondaryActionBtn || secondaryActionBtn.hidden) return;
    secondaryActionBtn.disabled = Boolean(secondaryActionState.disabled);
    secondaryActionBtn.textContent = secondaryActionState.buttonText || '找同款';
  }

  function openSettings() {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings.html') });
    }
  }

  function downloadExportResponse(response, fallbackFilename, callback) {
    if (!response || !response.ok) {
      callback({ ok: false, error: response && response.error ? response.error : '导出失败' });
      return;
    }
    var content = response.content == null ? '' : String(response.content);
    var blob = new Blob([content], { type: response.mimeType || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: response.filename || fallbackFilename,
      saveAs: true
    }, function () {
      var runtimeError = chrome.runtime.lastError;
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      if (runtimeError) {
        callback({ ok: false, error: formatRuntimeError(runtimeError.message) });
        return;
      }
      callback({ ok: true, count: response.count || 0 });
    });
  }

  function exportSourceQuotes() {
    if (!exportSourceQuotesBtn) return;
    exportSourceQuotesBtn.disabled = true;
    exportSourceQuotesBtn.textContent = '导出中...';
    setActionStatus('', '');
    sendRuntimeMessage({ type: 'ss-erp:source-quote-export' }, function (response) {
      downloadExportResponse(response, 'ss-erp-source-quotes.csv', function (result) {
        exportSourceQuotesBtn.disabled = false;
        exportSourceQuotesBtn.textContent = '导出';
        if (result && result.ok) {
          setActionStatus('已导出核价记录：' + (result.count || 0) + ' 条', 'ok');
          return;
        }
        setActionStatus((result && result.error) || '导出核价记录失败', 'fail');
      });
    });
  }

  function collectOzonToErp() {
    if (!primaryActionState.productId) {
      setActionStatus('未识别 Ozon SKU', 'fail');
      return;
    }
    rememberOzonCandidateContext(primaryActionState.tab, primaryActionState.productId);
    setPrimaryButtonBusy('采集中...');
    setActionStatus('', '');
    sendRuntimeMessage({
      type: 'spb-self-hosted:fetch-ozon-product-to-erp',
      productIds: [primaryActionState.productId],
      productUrls: [primaryActionState.sourceUrl],
      collectMode: 'complete'
    }, function (response) {
      restorePrimaryButton();
      if (response && response.ok) {
        var count = response.data && response.data.collected ? response.data.collected : 1;
        var connectionLabel = formatErpCollectTargetLabel(response.data && response.data.connection);
        setActionStatus('已采集 ' + count + ' 件商品' + connectionLabel, 'ok');
      } else {
        setActionStatus((response && response.error) || '采集失败', 'fail');
      }
    });
  }

  function openPrecisionWorkbench() {
    var tab = primaryActionState.tab;
    var revision = primaryActionRevision;
    if (!tab || !Number.isSafeInteger(tab.id)) return;
    setPrimaryButtonBusy('打开中...');
    setActionStatus('', '');
    chrome.tabs.get(tab.id, function (current) {
      if (revision !== primaryActionRevision) return;
      if (chrome.runtime.lastError || !current || current.url !== tab.url) {
        restorePrimaryButton();
        setActionStatus('商品页已变化，请重新打开扩展弹窗。', 'fail');
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'ss-erp:precision-workbench-open' }, { frameId: 0 }, function (response) {
        if (revision !== primaryActionRevision) return;
        restorePrimaryButton();
        if (chrome.runtime.lastError || !response || response.ok !== true || response.state !== 'WORKBENCH_OPENED') {
          setActionStatus('精铺工作台未能打开，请刷新商品页后重试。', 'fail');
          return;
        }
        setActionStatus('已在当前商品页打开精铺工作台。', 'ok');
      });
    });
  }

  function quoteSourcePage() {
    setSecondaryButtonBusy('核价中...');
    setActionStatus('', '');
    sendRuntimeMessage({ type: 'spb-self-hosted:collect-current-tab' }, function (response) {
      if (!response || !response.ok) {
        restoreSecondaryButton();
        setActionStatus((response && response.error) || '读取货源页失败', 'fail');
        return;
      }
      sendRuntimeMessage({
        type: 'ss-erp:source-quote-save',
        payload: { sourceProduct: response.data || {} }
      }, function (quoteResponse) {
        restoreSecondaryButton();
        if (quoteResponse && quoteResponse.ok) {
          setActionStatus('已记录采购价，正在回填 Ozon 核价面板', 'ok');
          return;
        }
        setActionStatus((quoteResponse && quoteResponse.error) || '核价记录失败', 'fail');
      });
    });
  }

  function sendRuntimeMessageAsync(message) {
    return new Promise(function (resolve) {
      sendRuntimeMessage(message, resolve);
    });
  }

  function pickSearchImage(product) {
    var images = product && Array.isArray(product.images) ? product.images : [];
    for (var index = 0; index < images.length; index += 1) {
      var imageUrl = String(images[index] || '').trim();
      if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
    }
    return '';
  }

  async function fetchImageBlob(imageUrl) {
    var response = await fetch(imageUrl, { credentials: 'omit' });
    if (!response.ok) {
      throw new Error('读取 Ozon 主图失败：HTTP ' + response.status);
    }
    var blob = await response.blob();
    if (!/^image\//i.test(blob.type || '')) {
      throw new Error('Ozon 主图响应不是图片');
    }
    return blob;
  }

  async function imageBlobToSearchImageData(blob, options) {
    options = options || {};
    if (!blob || !blob.size) {
      throw new Error('Ozon 主图为空，无法以图搜图');
    }
    if (!window.createImageBitmap) {
      var fallbackDataUrl = await blobToDataUrl(blob);
      return {
        imageBase64: stripDataUrlPrefix(fallbackDataUrl),
        imagePreviewDataUrl: fallbackDataUrl,
        imageSize: ''
      };
    }

    var bitmap = await createImageBitmap(blob);
    var maxSize = options.maxSize || 360;
    var quality = options.quality || 0.86;
    var scale = bitmap.width > maxSize && bitmap.height > maxSize
      ? Math.min(maxSize / bitmap.width, maxSize / bitmap.height)
      : 1;
    var width = Math.max(1, Math.round(bitmap.width * scale));
    var height = Math.max(1, Math.round(bitmap.height * scale));
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    if (canvasLooksBlank(context, width, height)) {
      throw new Error('识别到的 Ozon 主图疑似为空白或占位图，请刷新 Ozon 商品页后重试');
    }
    var previewDataUrl = canvas.toDataURL('image/jpeg', quality);
    return {
      imageBase64: stripDataUrlPrefix(previewDataUrl),
      imagePreviewDataUrl: previewDataUrl,
      imageSize: width + 'x' + height
    };
  }

  function canvasLooksBlank(context, width, height) {
    var sampleSize = 32;
    var stepX = Math.max(1, Math.floor(width / sampleSize));
    var stepY = Math.max(1, Math.floor(height / sampleSize));
    var min = 255;
    var max = 0;
    var total = 0;
    var count = 0;
    var nonWhite = 0;

    for (var y = 0; y < height; y += stepY) {
      for (var x = 0; x < width; x += stepX) {
        var data = context.getImageData(x, y, 1, 1).data;
        var value = Math.round((data[0] + data[1] + data[2]) / 3);
        min = Math.min(min, value);
        max = Math.max(max, value);
        total += value;
        count += 1;
        if (data[0] < 246 || data[1] < 246 || data[2] < 246) nonWhite += 1;
      }
    }

    var average = count ? total / count : 255;
    return nonWhite < 3 && (max - min) < 8 && average > 245;
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('读取 Ozon 主图失败')); };
      reader.readAsDataURL(blob);
    });
  }

  function stripDataUrlPrefix(dataUrl) {
    var base64 = String(dataUrl || '').replace(/^data:.*;base64,/i, '');
    if (!base64) {
      throw new Error('Ozon 主图转码失败，无法以图搜图');
    }
    return base64;
  }

  async function searchSourcesByImage() {
    if (!primaryActionState.productId) {
      setActionStatus('未识别 Ozon SKU', 'fail');
      return;
    }
    rememberOzonCandidateContext(primaryActionState.tab, primaryActionState.productId);
    setSecondaryButtonBusy('准备中...');
    setActionStatus('', '');

    try {
      var collectResponse = await sendRuntimeMessageAsync({ type: 'spb-self-hosted:collect-current-tab' });
      if (!collectResponse || !collectResponse.ok) {
        throw new Error((collectResponse && collectResponse.error) || '采集 Ozon 商品失败');
      }
      var product = collectResponse.data || {};
      var imageUrl = pickSearchImage(product);
      if (!imageUrl) {
        throw new Error('当前 Ozon 商品没有可用于搜图的主图');
      }
      setSecondaryButtonBusy('转图中...');
      var imageData = await imageBlobToSearchImageData(await fetchImageBlob(imageUrl), {
        maxSize: 360,
        quality: 0.86
      });
      setSecondaryButtonBusy('打开中...');
      var ozon = buildOzonCandidateContext(primaryActionState.tab, primaryActionState.productId, product);
      rememberOzonCandidateContext(primaryActionState.tab, primaryActionState.productId, product);
      var selectedPlatforms = getSelectedSourceSearchPlatforms();
      if (!selectedPlatforms.length) throw new Error('请至少选择一个核价网站');
      sourceSearchPlatformSelection = selectedPlatforms.slice();
      var platformPayloads = selectedPlatforms.map(function (platform) {
        return { platform: platform };
      });
      var results = await Promise.all(platformPayloads.map(function (item) {
        return sendRuntimeMessageAsync({
          type: 'ss-erp:image-search-create',
          payload: {
            platform: item.platform,
            imageUrl: imageUrl,
            imageBase64: imageData.imageBase64,
            imagePreviewDataUrl: imageData.imagePreviewDataUrl,
            imageSize: imageData.imageSize,
            ozon: ozon
          }
        });
      }));
      var failed = results.find(function (jobResponse) {
        return !jobResponse || !jobResponse.ok || !jobResponse.url;
      });
      if (failed) {
        throw new Error((failed && failed.error) || '创建搜图任务失败');
      }
      results.forEach(function (jobResponse) {
        chrome.tabs.create({ url: jobResponse.url });
      });
      var openedLabels = selectedPlatforms.map(function (platform) {
        var option = SOURCE_SEARCH_PLATFORM_OPTIONS.find(function (item) { return item.platform === platform; });
        return option ? option.label : platform;
      });
      setActionStatus('已打开 ' + openedLabels.join(' / ') + ' 找货源', 'ok');
    } catch (error) {
      setActionStatus(error && error.message ? error.message : String(error), 'fail');
    } finally {
      restoreSecondaryButton();
    }
  }

  function runPrimaryAction() {
    if (primaryActionState.type === 'collectOzonToErp') {
      collectOzonToErp();
      return;
    }
    if (primaryActionState.type === 'openPrecisionWorkbench') {
      openPrecisionWorkbench();
      return;
    }
    if (primaryActionState.type === 'syncCookie' && syncCookieBtn) {
      syncCookieBtn.click();
      return;
    }
    openSettings();
  }

  function runSecondaryAction() {
    if (secondaryActionState.type === 'searchSourcesByImage') {
      searchSourcesByImage();
      return;
    }
    if (secondaryActionState.type === 'quoteSourcePage') {
      quoteSourcePage();
    }
  }

  function formatTimeAgo(isoStr) {
    if (!isoStr) return '未同步';
    var diff = Date.now() - new Date(isoStr).getTime();
    if (diff < 0) return '刚刚';
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + '小时前';
    var days = Math.floor(hours / 24);
    return days + '天前';
  }

  function isStale(isoStr) {
    if (!isoStr) return true;
    return (Date.now() - new Date(isoStr).getTime()) > STALE_THRESHOLD;
  }

  function renderSyncTime(node, isoStr) {
    if (!node) return;
    var text = formatTimeAgo(isoStr);
    node.textContent = text;
    node.className = 'sync-time' + (isStale(isoStr) ? ' warn' : '');
  }

  function normalizeErpBaseUrl(value) {
    return String(value || '').trim().replace(/\/api\/.*$/, '').replace(/\/+$/, '');
  }

  function getErpConnectionStorage(extraKeys, callback) {
    var keys = ['ss_erp_connection', 'ozon-calc:erp-endpoint', 'ozon-calc:erp-token'];
    (extraKeys || []).forEach(function (key) {
      if (keys.indexOf(key) < 0) keys.push(key);
    });
    chrome.storage.local.get(keys, function (result) {
      var legacyConn = result.ss_erp_connection || {};
      var baseUrl = normalizeErpBaseUrl(result['ozon-calc:erp-endpoint'] || legacyConn.baseUrl);
      var token = String(result['ozon-calc:erp-token'] || legacyConn.token || '').trim();
      if (baseUrl && token && (legacyConn.baseUrl !== baseUrl || legacyConn.token !== token)) {
        chrome.storage.local.set({ ss_erp_connection: { baseUrl: baseUrl, token: token } });
      }
      callback({ baseUrl: baseUrl, token: token }, result);
    });
  }

  function erpEndpointHost(value) {
    var endpoint = normalizeErpBaseUrl(value || '');
    try {
      return endpoint ? new URL(endpoint).host : '';
    } catch {
      return endpoint.replace(/^https?:\/\//, '');
    }
  }

  function renderScopedDeviceStatus(deviceStatus) {
    if (!deviceStatus) return false;
    var statePolicy = globalThis.SS_ERP_EXTENSION_DEVICE_CONNECTION_STATE;
    if (!statePolicy || typeof statePolicy.isScopedStateAuthoritative !== 'function') {
      setStatus(erpStatusRow, false, '设备状态模块不可用');
      return true;
    }
    if (!statePolicy.isScopedStateAuthoritative(deviceStatus.state)) return false;
    var deviceHost = erpEndpointHost(deviceStatus.endpoint);
    if (deviceStatus.state === 'paired') {
      setStatus(erpStatusRow, true, deviceHost ? ('设备已连接 · ' + deviceHost) : '设备已连接');
    } else if (deviceStatus.state === 'invalid') {
      setStatus(erpStatusRow, false, deviceHost ? ('设备授权失效 · ' + deviceHost) : '设备授权失效');
    } else if (deviceStatus.state === 'unreachable') {
      setStatus(erpStatusRow, false, deviceHost ? ('设备验证失败 · ' + deviceHost) : '设备验证失败');
    } else {
      setStatus(erpStatusRow, false, deviceHost ? ('设备待授权 · ' + deviceHost) : '设备等待 ERP 授权');
    }
    return true;
  }

  function checkLegacyErpConnection(deviceStatus) {
    if (renderScopedDeviceStatus(deviceStatus)) return;
    getErpConnectionStorage([], function (conn) {
      var baseUrl = conn.baseUrl;
      var token = conn.token;
      if (!baseUrl || !token) {
        setStatus(
          erpStatusRow,
          false,
          deviceStatus && deviceStatus.state === 'unconfigured' ? '未检测到 ERP' : '未配置'
        );
        return;
      }

      fetch(baseUrl + '/api/user/me', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (res.ok && data && data.code === 1 && data.data) {
            setStatus(
              erpStatusRow,
              true,
              '兼容模式 · ' + formatErpCollectTargetLabel({ baseUrl: baseUrl, user: data.data }).replace(/[（）]/g, '')
            );
          } else if (res.ok) {
            setStatus(erpStatusRow, true, '兼容模式 · ' + baseUrl.replace(/https?:\/\//, ''));
          } else {
            setStatus(erpStatusRow, false, 'Token 无效');
          }
        });
      }).catch(function () {
        setStatus(erpStatusRow, false, '无法连接');
      });
    });
  }

  // Prefer the scoped, rotating device session used by the source/AI workbench.
  // Legacy account tokens remain a compatibility fallback for older collection actions.
  function checkErpConnection() {
    sendRuntimeMessage({ type: 'ss-erp:extension-device-status', verify: true }, function (response) {
      var deviceStatus = response && response.ok && response.data;
      checkLegacyErpConnection(deviceStatus || null);
    });
  }

  // Check OZON login
  function checkOzonLogin() {
    chrome.tabs.query({ url: 'https://seller.ozon.ru/*' }, function (tabs) {
      if (tabs && tabs.length > 0) {
        setStatus(ozonStatusRow, true, '已登录');
      } else {
        setStatus(ozonStatusRow, false, '未打开');
      }
    });
  }

  // Load sync times
  function loadSyncTimes() {
    chrome.storage.local.get([SYNC_STORAGE_KEY], function (result) {
      var times = result[SYNC_STORAGE_KEY] || {};
      renderSyncTime(analyticsSyncTime, times.analytics);
      renderSyncTime(graphsSyncTime, times.graphs);
    });
  }

  // Load calculator status
  function loadCalculatorStatus() {
    sendRuntimeMessage({ type: 'ozon-calculator:status' }, function (response) {
      if (!response || !response.ok) return;
      var counts = response.counts || {};
      setText(sellerCountNode, counts.seller || 0);
      setText(selectedCountNode, response.selectedServiceCount || 0);
      setText(allCountNode, counts.all || 0);
    });
  }

  // Sync handlers
  function readAuthorizedOzonShops(callback) {
    sendRuntimeMessage({ type: 'spb-self-hosted:get-ozon-shops' }, function (response) {
      if (!response || !response.ok || !Array.isArray(response.data)) {
        callback((response && response.error) || '暂时无法读取授权店铺', []);
        return;
      }
      callback(null, response.data.filter(function (shop) {
        return String(shop && shop.platform || '').toUpperCase() === 'OZON';
      }));
    });
  }

  function getSelectedShopId(callback) {
    chrome.storage.local.get(['ss_erp_selected_shop'], function (result) {
      readAuthorizedOzonShops(function (_error, shops) {
        if (!shops.length) {
          chrome.storage.local.remove(['ss_erp_selected_shop']);
          callback(null);
          return;
        }
        var uiShopId = cookieShopSelect && cookieShopSelect.value ? cookieShopSelect.value : '';
        var uiShop = shops.find(function (shop) { return shop.id === uiShopId; });
        if (uiShop) {
          chrome.storage.local.set({ ss_erp_selected_shop: uiShop.id, ss_erp_cookie_shop: uiShop.id });
          callback(uiShop.id);
          return;
        }
        var cachedShop = shops.find(function (shop) { return shop.id === result.ss_erp_selected_shop; });
        if (cachedShop) {
          callback(cachedShop.id);
          return;
        }
        chrome.storage.local.set({ ss_erp_selected_shop: shops[0].id });
        callback(shops[0].id);
      });
    });
  }

  function getManualSellerCompanyIdOverride() {
    if (!cookieCompanyIdInput || cookieCompanyIdInput.dataset.source !== 'manual') return '';
    return cookieCompanyIdInput.value.trim();
  }

  if (syncAnalyticsBtn) {
    syncAnalyticsBtn.addEventListener('click', function () {
      syncAnalyticsBtn.disabled = true;
      syncAnalyticsBtn.textContent = '...';
      requestSellerOzonAccess(function (permission) {
        if (!permission.ok) {
          syncAnalyticsBtn.textContent = '需授权';
          setStatus(ozonStatusRow, false, permission.error || '未授权');
          setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2500);
          return;
        }
        getSelectedShopId(function (shopId) {
          if (!shopId) {
            syncAnalyticsBtn.textContent = '无店铺';
            setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2000);
            return;
          }
          var companyId = getManualSellerCompanyIdOverride();
          sendRuntimeMessage({
            type: 'spb-self-hosted:sync-shop-analytics',
            shopId: shopId,
            companyId: companyId || undefined
          }, function (response) {
          if (response && response.ok) {
            syncAnalyticsBtn.textContent = 'OK';
            var now = new Date().toISOString();
            chrome.storage.local.get([SYNC_STORAGE_KEY], function (r) {
              var times = r[SYNC_STORAGE_KEY] || {};
              times.analytics = now;
              chrome.storage.local.set({ [SYNC_STORAGE_KEY]: times });
              renderSyncTime(analyticsSyncTime, now);
            });
          } else {
            syncAnalyticsBtn.textContent = '失败';
            if (response && response.error) setStatus(ozonStatusRow, false, response.error);
          }
          setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2000);
          });
        });
      });
    });
  }

  if (syncGraphsBtn) {
    syncGraphsBtn.addEventListener('click', function () {
      syncGraphsBtn.disabled = true;
      syncGraphsBtn.textContent = '...';
      requestSellerOzonAccess(function (permission) {
        if (!permission.ok) {
          syncGraphsBtn.textContent = '需授权';
          setStatus(ozonStatusRow, false, permission.error || '未授权');
          setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2500);
          return;
        }
        getSelectedShopId(function (shopId) {
          if (!shopId) {
            syncGraphsBtn.textContent = '无店铺';
            setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2000);
            return;
          }
          var companyId = getManualSellerCompanyIdOverride();
          sendRuntimeMessage({
            type: 'spb-self-hosted:sync-shop-graphs',
            shopId: shopId,
            companyId: companyId || undefined
          }, function (response) {
          if (response && response.ok) {
            syncGraphsBtn.textContent = 'OK';
            var now = new Date().toISOString();
            chrome.storage.local.get([SYNC_STORAGE_KEY], function (r) {
              var times = r[SYNC_STORAGE_KEY] || {};
              times.graphs = now;
              chrome.storage.local.set({ [SYNC_STORAGE_KEY]: times });
              renderSyncTime(graphsSyncTime, now);
            });
          } else {
            syncGraphsBtn.textContent = '失败';
            if (response && response.error) setStatus(ozonStatusRow, false, response.error);
          }
          setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2000);
          });
        });
      });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', function (e) {
      e.preventDefault();
      openSettings();
    });
  }

  if (exportSourceQuotesBtn) {
    exportSourceQuotesBtn.addEventListener('click', exportSourceQuotes);
  }

  // Cookie sync button
  var syncCookieBtn = document.getElementById('syncCookieBtn');
  var cookieSyncTime = document.getElementById('cookieSyncTime');
  var cookieShopSelect = document.getElementById('cookieShopSelect');
  var cookieCompanyIdInput = document.getElementById('cookieCompanyIdInput');
  var shopAuthLoadSeq = 0;

  if (cookieCompanyIdInput) {
    cookieCompanyIdInput.addEventListener('input', function () {
      cookieCompanyIdInput.dataset.source = 'manual';
    });
  }

  // 加载店铺列表到下拉框
  function loadShopsToSelect() {
    if (!cookieShopSelect) return;
    chrome.storage.local.get(['ss_erp_cookie_shop'], function (result) {
      readAuthorizedOzonShops(function (error, shops) {
        cookieShopSelect.innerHTML = '<option value="">选择目标店铺</option>';
        if (error) {
          cookieShopSelect.options[0].textContent = error;
          return;
        }
        if (!shops.length) {
          cookieShopSelect.options[0].textContent = '没有已授权的 OZON 店铺';
          chrome.storage.local.remove(['ss_erp_cookie_shop']);
          return;
        }
        shops.forEach(function (shop) {
          var opt = document.createElement('option');
          opt.value = shop.id;
          opt.textContent = shop.name || shop.id;
          cookieShopSelect.appendChild(opt);
        });
        var selected = shops.find(function (shop) { return shop.id === result.ss_erp_cookie_shop; }) || shops[0];
        cookieShopSelect.value = selected.id;
        chrome.storage.local.set({
          ss_erp_cookie_shop: selected.id,
          ss_erp_selected_shop: selected.id
        });
        loadShopAuthInfo(selected.id);
      });
    });
  }

  // 加载所选店铺的现有认证信息
  function readShopAuthInfo(shopId, callback) {
    if (!shopId) {
      callback({ companyId: '', updatedAt: '' });
      return;
    }
    sendRuntimeMessage({
      type: 'ozon-calc:get-ozon-cdn-auth',
      payload: { shopId: shopId }
    }, function (response) {
      var data = response && response.ok && response.data;
      callback({
        companyId: data && data.companyId ? String(data.companyId) : '',
        updatedAt: data && data.updatedAt ? data.updatedAt : ''
      });
    });
  }

  function loadShopAuthInfo(shopId) {
    shopAuthLoadSeq += 1;
    var seq = shopAuthLoadSeq;
    if (cookieCompanyIdInput) {
      cookieCompanyIdInput.value = '';
      cookieCompanyIdInput.dataset.source = '';
      cookieCompanyIdInput.placeholder = shopId ? '正在读取店铺同步状态...' : '可选：留空自动识别当前 seller 店铺';
    }
    renderSyncTime(cookieSyncTime, '');
    if (!shopId) return;
    readShopAuthInfo(shopId, function (auth) {
      if (seq !== shopAuthLoadSeq) return;
      if (cookieCompanyIdInput) {
        cookieCompanyIdInput.value = '';
        cookieCompanyIdInput.dataset.source = '';
        cookieCompanyIdInput.dataset.savedCompanyId = auth.companyId || '';
        cookieCompanyIdInput.placeholder = auth.companyId
          ? '可选：留空将使用当前 seller 店铺'
          : '可选：留空自动识别当前 seller 店铺';
      }
      renderSyncTime(cookieSyncTime, auth.updatedAt || '');
    });
  }

  if (cookieShopSelect) {
    cookieShopSelect.addEventListener('change', function () {
      chrome.storage.local.set({ ss_erp_cookie_shop: cookieShopSelect.value });
      loadShopAuthInfo(cookieShopSelect.value);
    });
  }

  if (syncCookieBtn) {
    syncCookieBtn.addEventListener('click', function () {
      var shopId = cookieShopSelect ? cookieShopSelect.value : '';
      if (!shopId) {
        alert('请先选择目标店铺');
        return;
      }
      syncCookieBtn.disabled = true;
      syncCookieBtn.textContent = '...';
      requestSellerOzonAccess(function (permission) {
        if (!permission.ok) {
          syncCookieBtn.textContent = '需授权';
          setStatus(ozonStatusRow, false, permission.error || '未授权');
          setTimeout(function () { syncCookieBtn.textContent = '同步'; syncCookieBtn.disabled = false; }, 2500);
          return;
        }
        // 只有用户手动编辑过输入框才优先使用它；ERP 自动加载的旧值不能覆盖当前 seller 店铺。
        var manualId = cookieCompanyIdInput && cookieCompanyIdInput.dataset.source === 'manual' ? cookieCompanyIdInput.value.trim() : '';
        var companyId = manualId || '';
        if (companyId && cookieCompanyIdInput) cookieCompanyIdInput.value = companyId;

        sendRuntimeMessage({
          type: 'ozon-calc:sync-ozon-cookie',
          payload: { shopId: shopId, companyId: companyId || undefined, useStoredCompanyId: Boolean(manualId) }
        }, function (response) {
          if (response && response.ok) {
            syncCookieBtn.textContent = 'OK';
            if (primaryActionState.type === 'syncCookie') {
              setActionStatus('Cookie 已同步', 'ok');
            }
            if (cookieCompanyIdInput && response.data && response.data.companyId) {
              cookieCompanyIdInput.value = '';
              cookieCompanyIdInput.dataset.source = '';
              cookieCompanyIdInput.dataset.savedCompanyId = response.data.companyId;
              cookieCompanyIdInput.placeholder = '已同步当前 seller 店铺';
            }
            var now = new Date().toISOString();
            chrome.storage.local.get([SYNC_STORAGE_KEY], function (r) {
              var times = r[SYNC_STORAGE_KEY] || {};
              times.cookie = now;
              chrome.storage.local.set({ [SYNC_STORAGE_KEY]: times });
              renderSyncTime(cookieSyncTime, now);
            });
          } else {
            syncCookieBtn.textContent = '失败';
            console.warn('[popup] cookie sync failed:', response && response.error);
            if (primaryActionState.type === 'syncCookie') {
              setActionStatus((response && response.error) || '同步失败', 'fail');
            }
            if (response && response.error) alert('同步失败: ' + response.error);
          }
          setTimeout(function () { syncCookieBtn.textContent = '同步'; syncCookieBtn.disabled = false; }, 2000);
        });
      });
    });
  }

  // Load cookie sync time
  function loadCookieSyncTime() {
    chrome.storage.local.get([SYNC_STORAGE_KEY], function (result) {
      var times = result[SYNC_STORAGE_KEY] || {};
      renderSyncTime(cookieSyncTime, times.cookie);
    });
  }

  function triggerOzonAutoSyncMaintenance() {
    sendRuntimeMessage({
      type: 'ozon-calc:auto-sync-maintenance',
      payload: { reason: 'popup_open' }
    }, function (response) {
      if (!response || response.skipped) return;
      chrome.storage.local.get([SYNC_STORAGE_KEY], function (result) {
        var times = result[SYNC_STORAGE_KEY] || {};
        renderSyncTime(cookieSyncTime, times.cookie);
        renderSyncTime(analyticsSyncTime, times.analytics);
        renderSyncTime(graphsSyncTime, times.graphs);
      });
    });
  }

  // Init
  if (primaryActionBtn) {
    primaryActionBtn.addEventListener('click', runPrimaryAction);
  }
  if (secondaryActionBtn) {
    secondaryActionBtn.addEventListener('click', runSecondaryAction);
  }
  SOURCE_SEARCH_PLATFORM_OPTIONS.forEach(function (option) {
    var input = getSourceSearchPlatformInput(option.platform);
    if (input) input.addEventListener('change', saveSourceSearchPlatformPrefs);
  });
  loadSourceSearchPlatformPrefs();
  configurePrimaryAction();
  checkErpConnection();
  checkOzonLogin();
  loadSyncTimes();
  loadCalculatorStatus();
  loadCookieSyncTime();
  loadShopsToSelect();
  triggerOzonAutoSyncMaintenance();
}());
