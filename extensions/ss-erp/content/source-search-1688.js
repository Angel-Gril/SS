(function () {
  'use strict';

  var STORAGE_KEY = 'ss-erp:image-search-jobs';
  var REQUEST_SOURCE = 'ss-erp-image-search-1688-bridge';
  var RESULT_SOURCE = 'ss-erp-image-search-1688-page';
  var STATUS_ID = 'ss-erp-1688-image-search-status';

  if (window.__ssErp1688ImageSearchBridgeLoaded) return;
  window.__ssErp1688ImageSearchBridgeLoaded = true;

  var params = readParams();
  if (params.get('ssErpImageSearch') !== '1688') return;

  var token = params.get('ssErpImageSearchToken') || '';
  if (!token) return;

  chrome.storage.local.get([STORAGE_KEY], function (items) {
    var jobs = items && items[STORAGE_KEY] && typeof items[STORAGE_KEY] === 'object'
      ? items[STORAGE_KEY]
      : {};
    var job = jobs[token];
    if (!job || !job.imageBase64) {
      console.warn('[SS ERP] 1688 image search job not found:', token);
      showBridgeStatus('未找到搜图任务，请回到 Ozon 商品页重新点击找同款。', true);
      return;
    }

    showBridgeStatus('正在用 Ozon 主图发起 1688 搜图...', false, job.imagePreviewDataUrl, job.imageSize);

    window.addEventListener('message', function (event) {
      var data = event.data || {};
      if (event.source !== window || data.source !== RESULT_SOURCE || data.token !== token) return;
      if (data.ok) {
        delete jobs[token];
        var update = {};
        update[STORAGE_KEY] = jobs;
        chrome.storage.local.set(update);
        showBridgeStatus('1688 已识别图片，正在打开结果...', false, job.imagePreviewDataUrl, job.imageSize);
      } else if (data.error) {
        console.warn('[SS ERP] 1688 image search failed:', data.error);
        showBridgeStatus('1688 搜图失败：' + data.error, true);
      }
    });

    injectPageBridge(function () {
      window.postMessage({
        source: REQUEST_SOURCE,
        token: token,
        imageBase64: job.imageBase64
      }, location.origin);
    });
  });

  function injectPageBridge(onReady) {
    if (window.__ssErp1688ImageSearchPageBridgeInjected) {
      onReady();
      return;
    }
    window.__ssErp1688ImageSearchPageBridgeInjected = true;
    var script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/source-search-1688-page.js');
    script.onload = function () {
      script.remove();
      onReady();
    };
    script.onerror = function () {
      console.warn('[SS ERP] failed to inject 1688 image search bridge');
      showBridgeStatus('1688 搜图桥接脚本加载失败。', true);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function readParams() {
    var merged = new URLSearchParams(location.search);
    var hash = location.hash.replace(/^#/, '');
    if (hash) {
      var hashParams = new URLSearchParams(hash);
      hashParams.forEach(function (value, key) {
        merged.set(key, value);
      });
    }
    return merged;
  }

  function showBridgeStatus(message, isError, previewDataUrl, imageSize) {
    var node = document.getElementById(STATUS_ID);
    if (!node) {
      node = document.createElement('div');
      node.id = STATUS_ID;
      node.style.cssText = [
        'position:fixed',
        'top:18px',
        'right:18px',
        'z-index:2147483647',
        'max-width:360px',
        'padding:10px 12px',
        'border-radius:6px',
        'box-shadow:0 6px 24px rgba(0,0,0,.16)',
        'font:14px/1.5 Arial,Microsoft YaHei,sans-serif',
        'background:#fff',
        'color:#222',
        'border:1px solid rgba(0,0,0,.12)'
      ].join(';');
      document.documentElement.appendChild(node);
    }

    node.innerHTML = '';
    var text = document.createElement('div');
    text.textContent = message;
    node.appendChild(text);

    if (previewDataUrl) {
      var img = document.createElement('img');
      img.src = previewDataUrl;
      img.alt = 'Ozon image preview';
      img.style.cssText = [
        'display:block',
        'width:96px',
        'height:96px',
        'object-fit:contain',
        'margin-top:8px',
        'border:1px solid rgba(0,0,0,.12)',
        'background:#fff'
      ].join(';');
      node.appendChild(img);
      if (imageSize) {
        var size = document.createElement('div');
        size.textContent = imageSize;
        size.style.cssText = 'margin-top:4px;color:#666;font-size:12px';
        node.appendChild(size);
      }
    }

    node.style.borderColor = isError ? '#dc2626' : 'rgba(0,0,0,.12)';
    node.style.color = isError ? '#b91c1c' : '#222';
  }
})();
